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
    const { jid, senderName, text, timestamp } = message

    // 1. Check if this is a self-chat message (command)
    // getSelfJid() is called here (not at construction) because selfJid is null until WhatsApp connects
    if (jid === client.getSelfJid()) {
      await commandHandler.handle({ jid, text })
      return
    }

    // 2. Check if this is from the active contact
    const activeChat = store.getActiveChat()
    if (activeChat && activeChat.jid === jid) {
      // Save contact hint for future !activate commands
      store.saveContactHint(senderName, jid)

      // Append message to history
      store.appendMessage({ jid, role: 'user', text, timestamp })

      // Trigger the callback (response generator will handle generating a response)
      await onActiveMessage({ jid, senderName, text, timestamp })
      return
    }

    // 3. Otherwise, just learn this contact for future !activate commands
    store.saveContactHint(senderName, jid)
  }

  return { route }
}
