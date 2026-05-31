import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'

const logger = pino({ level: 'warn' }).child({ module: 'whatsapp-client' })

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

  async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState('./data/session')

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        qrcode.generate(qr, { small: true })
        console.log('Scan the QR code above with WhatsApp to link this bot.')
      }

      if (connection === 'open') {
        selfJid = sock.user.id
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
      if (type !== 'notify') return

      for (const msg of messages) {
        const { key, message, pushName, messageTimestamp } = msg

        if (!message) continue

        // Extract text from supported message types
        const text =
          message.conversation ||
          message.extendedTextMessage?.text ||
          null

        if (!text) continue

        const remoteJid = key.remoteJid

        // Skip fromMe messages EXCEPT when it's the self-chat (own JID)
        if (key.fromMe && remoteJid !== selfJid) continue

        const senderName = pushName || remoteJid

        const timestamp =
          typeof messageTimestamp === 'number'
            ? messageTimestamp
            : messageTimestamp?.toNumber?.() ?? Date.now()

        onMessage({ jid: remoteJid, senderName, text, timestamp })
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
