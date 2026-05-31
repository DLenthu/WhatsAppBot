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
import { analyzeStyle } from '../style/analyzer.js'
import { fromBaileysMessages } from '../style/from-baileys.js'

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
    const contact = store.resolveContact(nameQuery)

    if (!contact) {
      const msg = `❌ No contact found for '${nameQuery}'. Wait for a message from them first, then try again.`
      await client.sendMessage(client.getSelfJid(), msg)
      return true
    }

    const activeChat = store.getActiveChat()
    if (activeChat) {
      const msg = `ℹ️ Already active for ${activeChat.name}. Use !deactivate first.`
      await client.sendMessage(client.getSelfJid(), msg)
      return true
    }

    // Auto-build style profile from history if none exists
    const selfJid = client.getSelfJid()
    const hasProfile = store.getProfile(contact.jid) || store.getProfile(contact.name)
    if (!hasProfile) {
      const rawMessages = client.getHistoryMessages(contact.jid, 200)
      if (rawMessages.length > 0) {
        await client.sendMessage(selfJid, `🔍 Building style profile from last ${rawMessages.length} messages...`)
        const parsed = fromBaileysMessages(rawMessages, selfJid, contact.name)
        const profile = analyzeStyle(parsed)
        store.saveProfile(contact.jid, profile)
        await client.sendMessage(selfJid, `📊 Style profile built from ${profile.sampleSize} of your messages (${profile.lengthCategory} messages, ${profile.language})`)
      } else {
        await client.sendMessage(selfJid, `ℹ️ No message history found for ${contact.name} yet — will use generic style. Import a chat export for better results.`)
      }
    }

    // Activate bot for this contact
    store.setActiveChat({ jid: contact.jid, name: contact.name })
    const msg = `✅ Bot active for ${contact.name}`
    await client.sendMessage(selfJid, msg)
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
