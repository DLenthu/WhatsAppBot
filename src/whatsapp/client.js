import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
  makeInMemoryStore,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const logger = pino({ level: 'silent' }).child({ module: 'whatsapp-client' })

const STORE_PATH = './data/wa-store.json'

export async function createWhatsAppClient(onMessage) {
  let selfJid = null
  let sock = null
  const historyStore = new Map()  // jid → WAMessage[]

  // makeInMemoryStore tracks contacts, chats, messages automatically
  const waStore = makeInMemoryStore({ logger })
  if (existsSync(STORE_PATH)) {
    try { waStore.readFromFile(STORE_PATH) } catch {}
  }
  // Persist store every 30s so contacts survive restarts
  setInterval(() => {
    try { waStore.writeToFile(STORE_PATH) } catch {}
  }, 30_000)

  async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('./data/session')
    const { version } = await fetchLatestBaileysVersion()

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      logger,
    })

    // Bind the in-memory store to the socket — it subscribes to all sync events
    waStore.bind(sock.ev)

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        qrcode.generate(qr, { small: true })
        console.log('Scan the QR code above with WhatsApp to link this bot.')
      }

      if (connection === 'open') {
        selfJid = jidNormalizedUser(sock.user.id)
        console.log(`WhatsApp connected as ${selfJid}`)
      }

      if (connection === 'close') {
        const err = lastDisconnect?.error
        const statusCode = err instanceof Boom ? err.output?.statusCode : null
        console.log(`WhatsApp disconnected. Code: ${statusCode} | Reason: ${err?.message ?? 'unknown'}`)

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('Logged out — delete data/session and restart.')
          process.exit(1)
        } else {
          console.log('Reconnecting in 3s...')
          await new Promise(r => setTimeout(r, 3000))
          await connect()
        }
      }
    })

    sock.ev.on('messaging-history.set', ({ messages }) => {
      for (const msg of messages) {
        const jid = msg.key?.remoteJid
        if (!jid || jid === 'status@broadcast') continue
        if (!historyStore.has(jid)) historyStore.set(jid, [])
        historyStore.get(jid).push(msg)
      }
      console.log(`[client] History loaded for ${historyStore.size} chats`)
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return

      for (const msg of messages) {
        const { key, message, pushName, messageTimestamp } = msg

        if (!message) continue

        const remoteJid = key.remoteJid
        const fromMe = key.fromMe === true

        const text =
          message.conversation ||
          message.extendedTextMessage?.text ||
          null

        if (!text) continue

        if (type === 'append' && !text.trimStart().startsWith('!')) continue
        if (fromMe && !text.trimStart().startsWith('!')) continue

        const senderName = pushName || remoteJid

        const timestamp =
          typeof messageTimestamp === 'number'
            ? messageTimestamp
            : messageTimestamp?.toNumber?.() ?? Date.now()

        onMessage({ jid: remoteJid, senderName, text, timestamp, fromMe })
      }
    })
  }

  await connect()

  return {
    async sendMessage(jid, text) {
      await sock.sendMessage(jid, { text })
    },

    getSelfJid() {
      return selfJid
    },

    /**
     * Search all known contacts and chats by name (partial, case-insensitive).
     * Sources in priority order:
     *   1. waStore.contacts — phone-saved names + WhatsApp notify names (full sync)
     *   2. waStore.chats — group/chat display names
     *   3. historyStore pushNames — fallback from message history
     */
    searchContacts(nameQuery) {
      const q = (nameQuery ?? '').toLowerCase()
      const seen = new Set()
      const results = []

      const add = (jid, name) => {
        if (!jid || !name || seen.has(jid)) return
        if (jid === 'status@broadcast') return
        if (jid.endsWith('@lid')) return  // skip LID shadow entries
        if (q && !name.toLowerCase().includes(q)) return
        seen.add(jid)
        results.push({ jid, name })
      }

      // 1. waStore.contacts — keyed by JID, has .name (phone-saved) and .notify (WA name)
      const contacts = waStore.contacts ?? {}
      for (const [jid, c] of Object.entries(contacts)) {
        add(jid, c.name || c.notify)
      }

      // 2. waStore.chats — covers any chat not in contacts (groups, businesses, etc.)
      const chats = waStore.chats?.all?.() ?? []
      for (const chat of chats) {
        const name = chat.name || contacts[chat.id]?.name || contacts[chat.id]?.notify
        if (name) add(chat.id, name)
      }

      // 3. historyStore pushNames — last resort
      for (const [jid, messages] of historyStore) {
        if (jid.endsWith('@g.us')) continue
        for (const msg of messages) {
          if (msg.pushName) { add(jid, msg.pushName); break }
        }
      }

      return results
    },

    findContactByName(nameQuery) {
      const results = this.searchContacts(nameQuery)
      return results[0] ?? null
    },

    getHistoryMessages(jid, limit = 200) {
      const msgs = historyStore.get(jid) ?? []
      return msgs
        .slice()
        .sort((a, b) => {
          const ta = typeof a.messageTimestamp === 'number' ? a.messageTimestamp : (a.messageTimestamp?.toNumber?.() ?? 0)
          const tb = typeof b.messageTimestamp === 'number' ? b.messageTimestamp : (b.messageTimestamp?.toNumber?.() ?? 0)
          return ta - tb
        })
        .slice(-limit)
    },
  }
}
