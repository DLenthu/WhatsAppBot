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

    if (command === '!contacts') {
      return await handleContacts(parts.slice(1).join(' '))
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

    // Try to resolve the contact name — store hints first, then history fallback
    const contact = store.resolveContact(nameQuery) ?? client.findContactByName(nameQuery)

    if (!contact) {
      const msg = `❌ No contact found for '${nameQuery}'. Make sure they've messaged you before, then try again.`
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

  async function handleContacts(query) {
    const selfJid = client.getSelfJid()
    const all = client.searchContacts('')
    const results = query ? all.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : all

    if (all.length === 0) {
      await client.sendMessage(selfJid, `⚠️ No contacts synced yet. Wait a few seconds after connecting and try again.`)
      return true
    }

    if (results.length === 0) {
      await client.sendMessage(selfJid, `No contacts matching '${query}'. Total known: ${all.length}. Try: !contacts (no query) to see all.`)
      return true
    }

    const lines = results.slice(0, 25).map(c => `• ${c.name}`)
    const header = query ? `${results.length} match(es) for '${query}':` : `All contacts (${results.length}):`
    await client.sendMessage(selfJid, `${header}\n${lines.join('\n')}`)
    return true
  }

  return { handle }
}
