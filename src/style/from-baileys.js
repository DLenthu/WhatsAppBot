/**
 * Converts Baileys WAMessage objects into the format expected by analyzeStyle().
 */

function extractText(message) {
  return message?.conversation || message?.extendedTextMessage?.text || null
}

function extractTimestamp(messageTimestamp) {
  if (typeof messageTimestamp === 'number') return new Date(messageTimestamp * 1000)
  if (messageTimestamp?.toNumber) return new Date(messageTimestamp.toNumber() * 1000)
  return new Date()
}

export function fromBaileysMessages(messages, selfJid, contactName) {
  const myName = selfJid?.split('@')[0] ?? 'me'

  const parsed = messages
    .filter(msg => extractText(msg.message))
    .map(msg => ({
      timestamp: extractTimestamp(msg.messageTimestamp),
      sender: msg.key.fromMe ? myName : (msg.pushName || contactName),
      text: extractText(msg.message),
      isMe: msg.key.fromMe === true,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  return { messages: parsed, contactName, myName }
}
