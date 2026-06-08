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
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs'

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
  const historyStore = new Map()               // in-memory only; populated by Baileys sync on connect
  const contactsMap = loadPersistedContacts()  // survives restarts
  // WhatsApp's newer protocol uses @lid (link id) JIDs for personal chats instead of @s.whatsapp.net.
  // Same person can appear under both. We track the mapping so active-chat matching works for either.
  const jidAliasMap = new Map()                // bidirectional: lid ↔ phone JID

  function recordJidAlias(a, b) {
    if (!a || !b || a === b) return
    jidAliasMap.set(a, b)
    jidAliasMap.set(b, a)
  }

  let saveContactsTimer = null
  function scheduleSaveContacts() {
    if (saveContactsTimer) clearTimeout(saveContactsTimer)
    saveContactsTimer = setTimeout(() => {
      saveContactsTimer = null
      savePersistedContacts(contactsMap)
    }, 2000)
  }

  function upsertContact(c) {
    if (!c.id) return
    const existing = contactsMap.get(c.id) ?? {}
    const merged = { ...existing, ...c }
    contactsMap.set(c.id, merged)
    scheduleSaveContacts()
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
      syncFullHistory: false,
      getMessage: async () => ({ conversation: '' }),
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts) upsertContact(c)
    })

    sock.ev.on('contacts.update', (updates) => {
      for (const u of updates) upsertContact(u)
    })

    sock.ev.on('chats.set', ({ chats }) => {
      for (const chat of chats) {
        if (!chat.id || chat.id === 'status@broadcast') continue
        if (chat.name) upsertContact({ id: chat.id, notify: chat.name })
      }
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
      }

      if (connection === 'close') {
        const err = lastDisconnect?.error
        const statusCode = err instanceof Boom ? err.output?.statusCode : null
        console.log(`WhatsApp disconnected. Code: ${statusCode} | Reason: ${err?.message ?? 'unknown'}`)
        if (statusCode === DisconnectReason.loggedOut) {
          console.log('Logged out (device forgotten) — clearing session, reconnecting for new QR...')
          try { rmSync('./data/session', { recursive: true, force: true }) } catch {}
          try { sock.ev.removeAllListeners() } catch {}
          try { sock.end?.() } catch {}
          setImmediate(() => connect().catch(err => console.error('[client] reconnect failed:', err)))
        } else {
          console.log('Reconnecting in 3s...')
          await new Promise(r => setTimeout(r, 3000))
          try { sock.ev.removeAllListeners() } catch {}
          try { sock.end?.() } catch {}
          setImmediate(() => connect().catch(err => console.error('[client] reconnect failed:', err)))
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
        const arr = historyStore.get(jid)
        arr.push(msg)
        if (arr.length > 1000) arr.splice(0, arr.length - 1000)
      }
      console.log(`[client] History synced: ${historyStore.size} chats`)
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return

      for (const msg of messages) {
        const { key, message, pushName, messageTimestamp } = msg
        if (!message) continue

        const remoteJid = key.remoteJid
        if (!remoteJid || remoteJid === 'status@broadcast') continue
        if (remoteJid.endsWith('@newsletter')) continue
        const isGroup = remoteJid.endsWith('@g.us')
        const fromMe = key.fromMe === true

        // WhatsApp's newer protocol: messages arrive with @lid as remoteJid; the phone-JID is in senderPn.
        // Record the mapping so we can match active chats stored under either format.
        // Skip alias recording for group JIDs — senderPn there refers to the participant, not the group.
        const senderPn = !isGroup ? (key.senderPn || null) : null
        if (senderPn) recordJidAlias(remoteJid, senderPn)

        // Learn sender names from live messages.
        // For groups, pushName is the individual sender — don't overwrite the group's own name with it.
        if (pushName && !fromMe && !isGroup) {
          upsertContact({ id: remoteJid, notify: pushName })
          if (senderPn) upsertContact({ id: senderPn, notify: pushName })
        }

        // Extract thumbnails for vision analysis — stickers (PNG) and images (JPEG)
        const stickerThumbnail = message.stickerMessage?.pngThumbnail
          ? Buffer.from(message.stickerMessage.pngThumbnail).toString('base64')
          : null

        const imageThumbnail = message.imageMessage?.jpegThumbnail
          ? Buffer.from(message.imageMessage.jpegThumbnail).toString('base64')
          : null

        const imageCaption = message.imageMessage?.caption || null

        const text =
          message.conversation ||
          message.extendedTextMessage?.text ||
          (message.stickerMessage ? '[sticker]' : null) ||
          (message.imageMessage ? (imageCaption ? `[image caption: ${imageCaption}]` : '[image]') : null)

        if (!text) continue
        if (type === 'append' && !text.trimStart().startsWith('!')) continue
        if (fromMe && !text.trimStart().startsWith('!')) continue

        const senderName = pushName || remoteJid.replace(/@.*/, '')
        const timestamp =
          typeof messageTimestamp === 'number'
            ? messageTimestamp
            : messageTimestamp?.toNumber?.() ?? Date.now()

        onMessage({ jid: remoteJid, altJid: senderPn, senderName, text, timestamp, fromMe, stickerThumbnail, imageThumbnail }).catch(err =>
          console.error('[client] Unhandled error in message handler:', err)
        )
      }
    })
  }

  await connect()

  return {
    async sendMessage(jid, text) {
      return await sock.sendMessage(jid, { text })
    },

    async sendSticker(jid, filePath) {
      const buffer = readFileSync(filePath)
      return await sock.sendMessage(jid, { sticker: buffer })
    },

    // Returns list of available stickers from data/stickers/ (filename + description derived from name)
    getStickerLibrary() {
      try {
        const dir = './data/stickers'
        if (!existsSync(dir)) return []
        return readdirSync(dir)
          .filter(f => f.endsWith('.webp'))
          .map(f => ({ filename: f, description: f.replace('.webp', '').replace(/[-_]/g, ' ') }))
      } catch {
        return []
      }
    },

    async editMessage(jid, key, text) {
      try {
        return await sock.sendMessage(jid, { text, edit: key })
      } catch {
        // Some WhatsApp clients/versions don't accept edits — silently skip
        return null
      }
    },

    getSelfJid() {
      return selfJid
    },

    getSelfName() {
      return sock?.user?.name || sock?.user?.verifiedName || sock?.user?.notify || null
    },

    // Returns the alternate JID (LID ↔ phone) for the given JID, if we've seen the mapping.
    getAltJid(jid) {
      return jidAliasMap.get(jid) || null
    },

    async close() {
      try { sock?.end?.() } catch {}
      if (saveContactsTimer) {
        clearTimeout(saveContactsTimer)
        saveContactsTimer = null
      }
      savePersistedContacts(contactsMap)
    },

    /**
     * Search contacts by name OR phone number (partial match, case-insensitive).
     * Contacts accumulate in data/contacts.json from every incoming message.
     */
    searchContacts(nameQuery) {
      const q = (nameQuery ?? '').trim().toLowerCase()
      const qDigits = q.replace(/\D/g, '')
      const cmdJid = process.env.COMMAND_JID
      const results = []
      const seenNames = new Set()  // dedupe — a contact under both @lid and @s.whatsapp.net

      for (const [jid, c] of contactsMap) {
        if (jid === 'status@broadcast') continue
        if (jid.endsWith('@newsletter')) continue
        if (jid === selfJid || jid === cmdJid) continue

        const isGroup = jid.endsWith('@g.us')
        const name = c.name || c.notify || ''
        // For @lid JIDs we can't extract a phone from the JID itself; use the alias map.
        // Groups don't have phone numbers — skip phone matching for them.
        const phoneJid = !isGroup && jid.endsWith('@s.whatsapp.net')
          ? jid
          : !isGroup ? jidAliasMap.get(jid) : null
        const phone = phoneJid ? phoneJid.replace('@s.whatsapp.net', '') : ''

        const matchesName = name && name.toLowerCase().includes(q)
        const matchesPhone = !isGroup && qDigits && phone.includes(qDigits)

        if (!q || matchesName || matchesPhone) {
          const displayName = name || phone || jid
          const dedupeKey = displayName.toLowerCase()
          if (seenNames.has(dedupeKey)) continue
          seenNames.add(dedupeKey)
          results.push({ jid, name: displayName })
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
      // Direct group JID (user typed full JID like 120363XXXX@g.us)
      if (query.endsWith('@g.us')) {
        const c = contactsMap.get(query)
        return { jid: query, name: c?.name || c?.notify || query }
      }

      const known = this.findContactByName(query)
      if (known) return known

      const digits = query.replace(/\D/g, '')
      if (digits.length >= 7) {
        // WhatsApp group JIDs are 18+ digit numeric IDs — phone numbers are ≤15 digits
        if (digits.length > 15) {
          const groupJid = `${digits}@g.us`
          const c = contactsMap.get(groupJid)
          return { jid: groupJid, name: c?.name || c?.notify || query }
        }
        return { jid: `${digits}@s.whatsapp.net`, name: query }
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
