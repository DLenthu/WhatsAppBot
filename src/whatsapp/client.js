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

/**
 * Create and return a connected WhatsApp client.
 *
 * @param {(msg: { jid: string, senderName: string, text: string, timestamp: number }) => void} onMessage
 * @returns {Promise<{ sendMessage: Function, getSelfJid: Function, getContactName: Function }>}
 */
export async function createWhatsAppClient(onMessage) {
  let selfJid = null
  let sock = null
  const historyStore = new Map()  // jid → WAMessage[]
  const contactsStore = new Map() // jid → { id, name, notify }
  const chatsStore = new Map()    // jid → { id, name, ... }

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

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) {
        if (c.id) contactsStore.set(c.id, c)
      }
    })

    sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) {
        if (!u.id) continue
        const existing = contactsStore.get(u.id) ?? {}
        contactsStore.set(u.id, { ...existing, ...u })
      }
    })

    // chats.set fires on connect with ALL known chats (including name/metadata)
    sock.ev.on('chats.set', ({ chats }) => {
      for (const chat of chats) {
        if (chat.id) chatsStore.set(chat.id, chat)
      }
      console.log(`[client] Loaded ${chatsStore.size} chats`)
    })

    sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (chat.id) chatsStore.set(chat.id, chat)
      }
    })

    sock.ev.on('chats.update', (updates) => {
      for (const u of updates) {
        if (!u.id) continue
        const existing = chatsStore.get(u.id) ?? {}
        chatsStore.set(u.id, { ...existing, ...u })
      }
    })

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        qrcode.generate(qr, { small: true })
        console.log('Scan the QR code above with WhatsApp to link this bot.')
      }

      if (connection === 'open') {
        // Normalize strips the :0 device suffix so it matches remoteJid in self-chat
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
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return

      for (const msg of messages) {
        const { key, message, pushName, messageTimestamp } = msg

        if (!message) continue

        const remoteJid = key.remoteJid
        const fromMe = key.fromMe === true

        // Extract text from supported message types
        const text =
          message.conversation ||
          message.extendedTextMessage?.text ||
          null

        if (!text) continue

        // Drop append-type messages that aren't commands (reduces noise)
        if (type === 'append' && !text.trimStart().startsWith('!')) continue

        // Drop outgoing messages unless they're a command (start with !)
        if (fromMe && !text.trimStart().startsWith('!')) continue

        const senderName = pushName || remoteJid

        const timestamp =
          typeof messageTimestamp === 'number'
            ? messageTimestamp
            : messageTimestamp?.toNumber?.() ?? Date.now()

        // Commands can come from any chat — pass selfJid so router can identify them
        onMessage({ jid: remoteJid, senderName, text, timestamp, fromMe })
      }
    })
  }

  await connect()

  return {
    /**
     * Send a text message to a JID.
     * @param {string} jid
     * @param {string} text
     */
    async sendMessage(jid, text) {
      await sock.sendMessage(jid, { text })
    },

    /**
     * Return the bot's own WhatsApp JID.
     * @returns {string}
     */
    getSelfJid() {
      return selfJid
    },

    /**
     * Return a contact's display name if available, otherwise null.
     * @param {string} jid
     * @returns {string | null}
     */
    getContactName(jid) {
      const contact = sock.store?.contacts?.[jid]
      return contact?.name ?? contact?.notify ?? null
    },

    searchContacts(nameQuery) {
      const q = (nameQuery ?? '').toLowerCase()
      const seen = new Set()
      const results = []

      const add = (jid, name) => {
        if (!jid || !name || seen.has(jid)) return
        if (jid === 'status@broadcast') return
        if (q && !name.toLowerCase().includes(q)) return
        seen.add(jid)
        results.push({ jid, name })
      }

      // 1. chats.set — all chats with their display name (most complete source)
      for (const [jid, chat] of chatsStore) {
        const name = chat.name || contactsStore.get(jid)?.name || contactsStore.get(jid)?.notify
        if (name) add(jid, name)
      }

      // 2. contacts.upsert — phone-saved names
      for (const [jid, c] of contactsStore) {
        add(jid, c.name || c.notify)
      }

      // 3. messaging-history pushNames as last resort
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
