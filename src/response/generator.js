/**
 * Response Generator
 *
 * Assembles context (style profile + message history), builds a system prompt,
 * calls the LLM, sends the reply to the active contact, and notifies self-chat.
 */

/**
 * Build a system prompt from the user's style profile.
 *
 * @param {Object|null} profile - Style profile returned by store.getProfile()
 * @param {string} userName - The bot user's own name (derived from self JID)
 * @param {string} senderName - The contact's display name
 * @returns {string}
 */
function buildSystemPrompt(profile, userName, senderName) {
  if (!profile) {
    return [
      'You are replying to a WhatsApp message on behalf of the user.',
      'Keep the reply natural, conversational, and concise.',
      'Reply only with the message text, nothing else.',
    ].join('\n')
  }

  const commonPhrases =
    Array.isArray(profile.commonPhrases) && profile.commonPhrases.length > 0
      ? profile.commonPhrases.join(', ')
      : '(none recorded)'

  return [
    `You are ${userName} replying to a WhatsApp message from ${senderName}.`,
    '',
    `Your communication style with ${senderName}:`,
    `- Tone: ${profile.tone}`,
    `- Average message length: ${profile.avgLength} words (short/medium/long)`,
    `- Language: ${profile.language} (e.g. "English", "English mixed with Telugu")`,
    `- Common phrases you use: ${commonPhrases}`,
    `- Emoji usage: ${profile.emojiFrequency} (none/occasional/frequent)`,
    `- Other style notes: ${profile.styleNotes}`,
    '',
    'Rules:',
    `- Reply as ${userName}, NOT as an AI`,
    '- Match the tone and length naturally',
    "- Do not add pleasantries or sign-offs that aren't in your style",
    '- Reply only with the message text, nothing else',
    '- Keep it authentic and conversational',
  ].join('\n')
}

/**
 * Convert store history rows to the LLM message format.
 * Store roles: 'user' (contact) | 'bot' (our reply)
 * LLM roles:  'user'           | 'assistant'
 *
 * @param {Array<{role: string, text: string}>} rows
 * @returns {Array<{role: string, content: string}>}
 */
function formatHistoryForLLM(rows) {
  return rows.map((row) => ({
    role: row.role === 'bot' ? 'assistant' : 'user',
    content: row.text,
  }))
}

/**
 * Create a response generator that handles incoming messages and replies.
 *
 * @param {{ store: Object, llmProvider: Object, client: Object }} deps
 * @returns {{ handleMessage: Function }}
 */
export function createResponseGenerator({ store, llmProvider, client }) {
  /**
   * Handle an incoming active-contact message end-to-end.
   *
   * @param {{ jid: string, senderName: string, text: string, timestamp: number }} msg
   * @returns {Promise<void>}
   */
  async function handleMessage({ jid, senderName, text, timestamp }) {
    const selfJid = client.getSelfJid()

    // Derive a human-readable user name from the self JID (strip @s.whatsapp.net etc.)
    const userName = selfJid ? selfJid.split('@')[0].split(':')[0] : 'User'

    try {
      // 1. Fetch style profile (null if not yet built)
      const profile = store.getProfile(jid)

      // 2. Fetch last 10 messages from history
      //    NOTE: the router already appended the incoming message before calling us,
      //    so the history already includes it as the last entry.
      const historyRows = store.getHistory(jid, 10)

      // 3. Build system prompt
      const systemPrompt = buildSystemPrompt(profile, userName, senderName)

      // 4. Convert history to LLM format
      const historyMessages = formatHistoryForLLM(historyRows)

      // 5. Call LLM
      const generatedReply = await llmProvider.generate(systemPrompt, historyMessages)

      // 6. Send reply to contact
      await client.sendMessage(jid, generatedReply)

      // 7. Store bot reply in history
      store.appendMessage({ jid, role: 'bot', text: generatedReply, timestamp: Date.now() })

      // 8. Notify self-chat with a preview
      const preview =
        generatedReply.length > 60
          ? `${generatedReply.slice(0, 60)}...`
          : generatedReply

      await client.sendMessage(selfJid, `🤖 Replied to ${senderName}: ${preview}`)
    } catch (err) {
      console.error(`[ResponseGenerator] Failed to reply to ${senderName} (${jid}):`, err)

      // Notify self-chat of the failure; do NOT send anything to the contact
      try {
        await client.sendMessage(
          selfJid,
          `⚠️ Bot failed to reply to ${senderName}. Error: ${err.message}`
        )
      } catch (notifyErr) {
        console.error('[ResponseGenerator] Failed to send error notification to self:', notifyErr)
      }
    }
  }

  return { handleMessage }
}
