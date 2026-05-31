/**
 * Command handler for WhatsApp bot.
 * Processes commands from self-chat and manages bot activation state.
 */

/**
 * Create a command handler instance.
 * @param {Object} deps - Dependencies
 * @param {Object} deps.store - State store instance
 * @param {Object} deps.client - WhatsApp client instance
 * @returns {Object} Handler with handle() method
 */
export function createCommandHandler({ store, client }) {
  /**
   * Handle a message and execute if it's a command.
   * @param {Object} msg - Message object
   * @param {string} msg.jid - Sender's JID
   * @param {string} msg.text - Message text
   * @returns {Promise<boolean>} True if message was a command, false otherwise
   */
  async function handle({ jid, text }) {
    if (!text || typeof text !== 'string') {
      return false
    }

    const trimmed = text.trim()
    const parts = trimmed.split(/\s+/)
    const command = parts[0].toLowerCase()

    // Check if this is a command
    if (command === '!activate') {
      return await handleActivate(parts.slice(1).join(' '))
    }

    if (command === '!deactivate') {
      return await handleDeactivate()
    }

    if (command === '!status') {
      return await handleStatus()
    }

    // Not a command
    return false
  }

  /**
   * Handle !activate command
   * @param {string} nameQuery - Contact name to activate for
   * @returns {Promise<boolean>}
   */
  async function handleActivate(nameQuery) {
    if (!nameQuery) {
      return true // Command was recognized, but no argument provided
    }

    // Try to resolve the contact name
    const contactJid = store.resolveContact(nameQuery)

    if (!contactJid) {
      // Contact not found
      const msg = `❌ No contact found for '${nameQuery}'. Wait for a message from them first, then try again.`
      await client.sendMessage(client.getSelfJid(), msg)
      return true
    }

    // Check if already active for a different contact
    const activeChat = store.getActiveChat()
    if (activeChat && activeChat.jid === contactJid) {
      // Already active for this contact
      const msg = `ℹ️ Already active for ${activeChat.name}. Use !deactivate first.`
      await client.sendMessage(client.getSelfJid(), msg)
      return true
    }

    if (activeChat && activeChat.jid !== contactJid) {
      // Already active for a different contact
      const msg = `ℹ️ Already active for ${activeChat.name}. Use !deactivate first.`
      await client.sendMessage(client.getSelfJid(), msg)
      return true
    }

    // Activate bot for this contact
    store.setActiveChat({ jid: contactJid, name: nameQuery })
    const msg = `✅ Bot active for ${nameQuery}`
    await client.sendMessage(client.getSelfJid(), msg)
    return true
  }

  /**
   * Handle !deactivate command
   * @returns {Promise<boolean>}
   */
  async function handleDeactivate() {
    const activeChat = store.getActiveChat()

    if (!activeChat) {
      // Not currently active
      const msg = 'ℹ️ Bot is not currently active.'
      await client.sendMessage(client.getSelfJid(), msg)
      return true
    }

    // Deactivate bot
    store.clearActiveChat()
    const msg = `🔴 Bot off for ${activeChat.name}`
    await client.sendMessage(client.getSelfJid(), msg)
    return true
  }

  /**
   * Handle !status command
   * @returns {Promise<boolean>}
   */
  async function handleStatus() {
    const activeChat = store.getActiveChat()

    if (activeChat) {
      const msg = `🤖 Bot active for: ${activeChat.name}`
      await client.sendMessage(client.getSelfJid(), msg)
    } else {
      const msg = '💤 Bot is inactive.'
      await client.sendMessage(client.getSelfJid(), msg)
    }

    return true
  }

  return { handle }
}
