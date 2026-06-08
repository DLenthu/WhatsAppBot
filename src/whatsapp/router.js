/**
 * Message router for WhatsApp bot.
 * Routes incoming messages to appropriate handlers based on sender and active chat state.
 */

/**
 * Create a message router instance.
 * @param {Object} deps - Dependencies
 * @param {Object} deps.store - State store instance
 * @param {Object} deps.commandHandler - Command handler instance
 * @param {Function} deps.onActiveMessage - Callback for messages from active contact
 * @param {string} deps.selfJid - The bot's own WhatsApp JID
 * @returns {Object} Router with route() method
 */
const COMMAND_JID = process.env.COMMAND_JID

export function createMessageRouter({ store, commandHandler, onActiveMessage, client }) {
  /**
   * Route an incoming message to the appropriate handler.
   * @param {Object} message - Message object
   * @param {string} message.jid - Sender's JID
   * @param {string} message.senderName - Sender's display name
   * @param {string} message.text - Message text
   * @param {number} message.timestamp - Message timestamp
   * @returns {Promise<void>}
   */
  async function route(message) {
    const { jid, altJid, senderName, text, timestamp, fromMe } = message

    // 1. Commands: messages from your designated command chat only
    const commandJid = COMMAND_JID || client.getSelfJid()
    const isCommand = fromMe && (jid === commandJid || jid === client.getSelfJid() || (!COMMAND_JID && jid.endsWith('@lid')))
    if (isCommand) {
      await commandHandler.handle({ jid, text })
      return
    }

    // 2. Active-chat match. WhatsApp's new LID protocol: same contact has TWO JIDs (lid + phone).
    // Try the remoteJid first, then the alt (senderPn), then via the client's alias map.
    let activeChat = store.getActiveChatByJid(jid)
    let matchedJid = jid
    if (!activeChat && altJid) {
      activeChat = store.getActiveChatByJid(altJid)
      if (activeChat) matchedJid = altJid
    }
    if (!activeChat) {
      const alias = client.getAltJid?.(jid)
      if (alias) {
        activeChat = store.getActiveChatByJid(alias)
        if (activeChat) matchedJid = alias
      }
    }

    if (activeChat) {
      console.log(`[router] Active message from ${senderName} (${jid}) → matched as ${matchedJid} → generating reply`)
      store.saveContactHint(senderName, jid)
      // Use the actual remote JID (where messages arrive) for history & reply destination
      store.appendMessage({ jid, role: 'user', text, timestamp })
      await onActiveMessage({ jid, senderName, text, timestamp })
      return
    }

    // 3. Otherwise, just silently learn this contact for future activation lookups
    store.saveContactHint(senderName, jid)
  }

  return { route }
}
