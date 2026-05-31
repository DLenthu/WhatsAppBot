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
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { mkdirSync } from 'fs'

const logger = pino({ level: 'silent' }).child({ module: 'whatsapp-client' })
const CONTACTS_PATH = './data/contacts.json'

function loadPersistedContacts() {
  try {
    if (existsSync(CONTACTS_PATH)) {
      return new Map(Object.entries(JSON.parse(readFileSync(CONTACTS_PATH, 'utf8'))))
    }
  } catch {}
  return new Map()
}

function savePersistedContacts(map) {
  try {
    mkdirSync('./data', { recursive: true })
    writeFileSync(CONTACTS_PATH, JSON.stringify(Object.fromEntries(map)), 'utf8')
  } catch {}
}

export async function createWhatsAppClient(onMessage) {
  let selfJid = null
  let sock = null
  const historyStore = new Map()
  const contactsMap = loadPersistedContacts()  // survives restarts

  function upsertContact(c) {
    if (!c.id) return
    const existing = contactsMap.get(c.id) ?? {}
    const merged = { ...existing, ...c }
    contactsMap.set(c.id, merged)
    savePersistedContacts(contactsMap)
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
      syncFullHistory: true,
      getMessage: async () => ({ conversation: '' }),
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) upsertContact(c)
      console.log(`[client] contacts.upsert: ${contacts.length} received, ${contactsMap.size} total`)
    })

    sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) upsertContact(u)
    })

    sock.ev.on('chats.set', ({ chats }) => {
      for (const chat of chats) {
        if (!chat.id || chat.id === 'status@broadcast') continue
        if (chat.name) upsertContact({ id: chat.id, notify: chat.name })
      }
      console.log(`[client] chats.set: ${chats.length} chats`)
    })

    sock.ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        if (!chat.id || chat.id === 'status@broadcast') continue
        if (chat.name) upsertContact({ id: chat.id, notify: chat.name })
      }
    })

    sock.ev.on('chats.update', (updates) => {
      for (const chat of updates) {
        if (!chat.id || chat.id === 'status@broadcast') continue
        if (chat.name) upsertContact({ id: chat.id, notify: chat.name })
      }
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
        console.log(`[client] ${contactsMap.size} contacts loaded from disk`)
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
        if (msg.pushName && !msg.key.fromMe) {
          upsertContact({ id: jid, notify: msg.pushName })
        }
        if (!historyStore.has(jid)) historyStore.set(jid, [])
        historyStore.get(jid).push(msg)
      }
      console.log(`[client] history: ${historyStore.size} chats, ${contactsMap.size} contacts total`)
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return

      for (const msg of messages) {
        const { key, message, pushName, messageTimestamp } = msg
        if (!message) continue

        const remoteJid = key.remoteJid
        const fromMe = key.fromMe === true

        // Learn every sender's name from live messages
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
     * Search contacts by name OR phone number (partial match, case-insensitive).
     * Contacts accumulate in data/contacts.json from every incoming message.
     */
    searchContacts(nameQuery) {
      const q = (nameQuery ?? '').trim().toLowerCase()
      const results = []

      for (const [jid, c] of contactsMap) {
        if (jid === 'status@broadcast') continue
        if (jid.endsWith('@g.us') || jid.endsWith('@lid')) continue

        const name = c.name || c.notify || ''
        const phone = jid.replace('@s.whatsapp.net', '')

        const matchesName = name && name.toLowerCase().includes(q)
        const matchesPhone = phone.includes(q.replace(/\D/g, ''))

        if (!q || matchesName || matchesPhone) {
          results.push({ jid, name: name || phone })
        }
      }

      return results
    },

    findContactByName(nameQuery) {
      return this.searchContacts(nameQuery)[0] ?? null
    },

    /**
     * Resolve a contact by name or phone number, or construct a JID directly
     * from a phone number if no match found in known contacts.
     */
    resolveContact(query) {
      const known = this.findContactByName(query)
      if (known) return known

      // If query looks like a phone number, construct JID directly
      const digits = query.replace(/\D/g, '')
      if (digits.length >= 7) {
        const jid = `${digits}@s.whatsapp.net`
        return { jid, name: query }
      }

      return null
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
