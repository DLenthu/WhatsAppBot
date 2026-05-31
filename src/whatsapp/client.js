import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'

const logger = pino({ level: 'silent' }).child({ module: 'whatsapp-client' })

export async function createWhatsAppClient(onMessage) {
  let selfJid = null
  let sock = null
  const historyStore = new Map()  // jid → WAMessage[]
  const contactsMap = new Map()   // jid → { name, notify }

  function upsertContact(c) {
    if (!c.id) return
    const existing = contactsMap.get(c.id) ?? {}
    contactsMap.set(c.id, { ...existing, ...c })
  }

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

    sock.ev.on('creds.update', saveCreds)

    // Full contacts sync fired on connect — captures ALL contacts in batches
    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) upsertContact(c)
      console.log(`[client] Contacts synced: ${contactsMap.size} total`)
    })

    sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) upsertContact(u)
    })

    // chats.set fires on connect with metadata for ALL known chats
    sock.ev.on('chats.set', ({ chats }) => {
      for (const chat of chats) {
        if (!chat.id || chat.id === 'status@broadcast') continue
        // chats carry a name for groups; for DMs merge into contactsMap
        if (chat.name && !chat.id.endsWith('@g.us')) {
          upsertContact({ id: chat.id, notify: chat.name })
        }
      }
      console.log(`[client] Chats loaded: ${chats.length}`)
    })

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
        // Extract pushName into contactsMap for any unknown contact
        if (msg.pushName && !msg.key.fromMe) {
          upsertContact({ id: jid, notify: msg.pushName })
        }
        if (!historyStore.has(jid)) historyStore.set(jid, [])
        historyStore.get(jid).push(msg)
      }
      console.log(`[client] History loaded: ${historyStore.size} chats, ${contactsMap.size} contacts known`)
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return

      for (const msg of messages) {
        const { key, message, pushName, messageTimestamp } = msg

        if (!message) continue

        const remoteJid = key.remoteJid
        const fromMe = key.fromMe === true

        // Learn contact name from incoming messages
        if (pushName && !fromMe) upsertContact({ id: remoteJid, notify: pushName })

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
     * Search all known contacts by name (partial, case-insensitive).
     * Uses: contacts.upsert name/notify, chats.set names, history pushNames.
     */
    searchContacts(nameQuery) {
      const q = (nameQuery ?? '').toLowerCase()
      const results = []

      for (const [jid, c] of contactsMap) {
        if (jid === 'status@broadcast' || jid.endsWith('@lid')) continue
        const name = c.name || c.notify
        if (!name) continue
        if (q && !name.toLowerCase().includes(q)) continue
        results.push({ jid, name })
      }

      return results
    },

    findContactByName(nameQuery) {
      return this.searchContacts(nameQuery)[0] ?? null
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
