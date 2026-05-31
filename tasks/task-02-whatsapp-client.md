# TASK-02 — WhatsApp Client (Baileys)
**Recommended model:** Sonnet  
**Dependencies:** TASK-01 (scaffold must be done first)

---

## Goal
Implement the WhatsApp companion device connection using Baileys. This is the core integration layer — handles authentication, session persistence, sending messages, and emitting incoming message events.

## File to Create: `src/whatsapp/client.js`

## Interface This Module Must Export

```js
// Initialize connection, display QR code, return client object
export async function createWhatsAppClient(onMessage)

// Returns object with:
// client.sendMessage(jid, text) → Promise<void>
// client.getSelfJid() → string  (your own WhatsApp JID)
// client.getContactName(jid) → string | null
```

The `onMessage` callback receives: `{ jid, senderName, text, timestamp }`

## Key Implementation Details

**Library:** `@whiskeysockets/baileys`

**Auth:** Use `useMultiFileAuthState('./data/session')` for persistent session. On first run, print QR to terminal using `qrcode-terminal`. After scan, session is saved and future runs skip QR.

**Reconnection:** Listen for `connection.update` events. On `DisconnectReason.loggedOut`, delete session and exit. On other disconnects, reconnect automatically.

**Incoming messages:** Listen for `messages.upsert` event. Filter for:
- `type === 'notify'` (real new messages, not history sync)
- `message.conversation` or `message.extendedTextMessage.text` (text only, ignore media)
- Not from yourself (skip messages where `key.fromMe === true`) EXCEPT messages in your self-chat (where `key.remoteJid === client.getSelfJid()`) — those are commands

**Self-JID:** After connection, store `sock.user.id` (your own JID).

**Logging:** Use `pino` with level `warn` to suppress Baileys verbose output. Create a named child logger for this module.

**Message sending:**
```js
await sock.sendMessage(jid, { text: message })
```

## Example Baileys Bootstrap

```js
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'

const { state, saveCreds } = await useMultiFileAuthState('./data/session')
const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pinoLogger })
sock.ev.on('creds.update', saveCreds)
```

## Acceptance Criteria
- On first run: QR code appears in terminal, scan with WhatsApp links the bot
- On subsequent runs: connects without QR
- `sendMessage` successfully delivers a message to a given JID
- Incoming messages call the `onMessage` callback with correct fields
- Self-chat messages (to own JID) are included in callback (needed for commands)
- Reconnects automatically on network drop
