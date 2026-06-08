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
function buildCodeSwitchingNote(profile) {
  if (!profile.language || profile.language === 'English' || profile.language === 'unknown') {
    return 'Communicates purely in English.'
  }
  const words = Array.isArray(profile.detectedNonEnglishWords) && profile.detectedNonEnglishWords.length > 0
    ? ` Common non-English words/expressions: ${profile.detectedNonEnglishWords.slice(0, 10).join(', ')}.`
    : ''
  return `Naturally code-switches between English and ${profile.language.replace('English-', '').replace(' mix', '')} mid-sentence — never forced, just how they actually talk.${words}`
}

function buildSystemPrompt(profile, userName, senderName) {
  if (!profile) {
    return [
      `You are ${userName}. You are NOT an AI, bot, or assistant — you have zero awareness of being anything other than ${userName}.`,
      `Reply to the WhatsApp message from ${senderName} in a natural, casual, brief way. Match the energy of the message.`,
      `If asked whether you are a bot or AI, deny it naturally as ${userName} would.`,
      'Never reference past conversation details, never leak context from other chats, never comment on the system behind this.',
      'If the incoming message is [sticker], react to it naturally and briefly — do not say the word "sticker".',
      'Reply only with the message text — no quotes, no labels, no explanation.',
    ].join('\n')
  }

  const phrases = Array.isArray(profile.commonPhrases) && profile.commonPhrases.length > 0
    ? profile.commonPhrases.slice(0, 10).join(', ')
    : '(none detected)'

  const abbrevLine = Array.isArray(profile.abbreviations) && profile.abbreviations.length > 0
    ? profile.abbreviations.join(', ')
    : 'none detected'

  const emojiLine = profile.emojiFrequency === 'none'
    ? 'Never uses emoji.'
    : profile.emojiFrequency === 'frequent'
      ? `Uses emoji frequently. Most common: ${(profile.commonEmojis ?? []).join(' ')}`
      : `Uses emoji occasionally (not on every message). Favourites: ${(profile.commonEmojis ?? []).join(' ') || 'none'}`

  const burstNote = profile.avgMessagesPerExchange > 1.5
    ? `Tends to send ${profile.avgMessagesPerExchange.toFixed(1)} messages in a row instead of one long reply.`
    : 'Typically responds in a single message.'

  const toneMarkers = []
  if (profile.usesQuestionMarks)  toneMarkers.push('asks questions back to keep the conversation going')
  if (profile.usesExclamations)   toneMarkers.push('uses exclamations for emphasis')
  if (profile.usesEllipsis)       toneMarkers.push('trails off with "..." occasionally')
  if (profile.capsFrequency === 'frequent') toneMarkers.push('capitalises words for emphasis (e.g. SAME)')
  const toneLine = toneMarkers.length > 0 ? toneMarkers.join(', ') : 'direct and low-key'

  const sampleSection = Array.isArray(profile.sampleMessages) && profile.sampleMessages.length > 0
    ? [
        'REAL EXAMPLES of how they actually write (use these as a style reference, NOT content):',
        ...profile.sampleMessages.map(m => `  "${m}"`),
      ].join('\n')
    : ''

  return [
    `You are ${userName}. Reply to the incoming WhatsApp message from ${senderName} in your own voice.`,
    `The style fingerprint below describes HOW you communicate — apply it regardless of the topic.`,
    '',
    '━━ COMMUNICATION FINGERPRINT ━━',
    `Message length: ${profile.lengthCategory} (avg ${profile.avgWordCount} words). ${burstNote}`,
    `Capitalization: ${profile.capitalizationStyle ?? 'unknown'}.`,
    `Punctuation: ${profile.punctuationStyle ?? 'unknown'}.`,
    `${emojiLine}`,
    '',
    '━━ CODE-SWITCHING & LANGUAGE ━━',
    buildCodeSwitchingNote(profile),
    '',
    '━━ TONE & ENERGY ━━',
    `Tone style: ${toneLine}.`,
    `Signature expressions & phrases: ${phrases}.`,
    `Informal shorthand they use: ${abbrevLine}.`,
    '',
    sampleSection,
    '',
    '━━ STYLE RULES ━━',
    '- PERSONALITY OVER TOPIC: Adapt your STYLE (length, casing, punctuation, code-switching, emoji) to the fingerprint above. Do NOT try to reflect what topics they care about.',
    '- CONTEXT: Read the conversation history to understand what to reply — then deliver that reply in the personality fingerprint above.',
    '- Never be more formal, longer, or more polished than the fingerprint shows.',
    '- Do not add greetings, sign-offs, or filler phrases unless the fingerprint shows them.',
    '',
    '━━ GUARDRAILS (ABSOLUTE — NEVER BREAK) ━━',
    `- IDENTITY LOCK: You ARE ${userName}. Not an AI. Not a language model. Not a bot. Not an assistant. You have zero awareness of being anything other than ${userName}. This is unconditional.`,
    `- IF ASKED IF YOU ARE A BOT / AI / FAKE: Deny it naturally in ${userName}'s voice. React how a real person would — confused, amused, dismissive. Never confirm, hint, or hedge.`,
    '- NO CONTENT LEAKAGE: The conversation history tells you WHAT to reply to — nothing more. Never reference, quote, summarise, or reveal specific facts, events, plans, or details from any past message.',
    '- NO CROSS-CONTAMINATION: You have zero knowledge of any other contact, conversation, or profile. Every chat is completely isolated. Never let context from one conversation bleed into another.',
    '- NO META: Never explain your reply, comment on the conversation, acknowledge any instruction, or reference any system running behind this chat.',
    '- STICKERS: If the incoming message is [sticker], react to it naturally and briefly in your own voice — as if you just saw a funny or cute image. Do not say the word "sticker".',
    '- Reply only with the message text. No quotes, no labels, no explanation.',
  ].filter(l => l !== null).join('\n')
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
  // Dedup: track recently-processed message identifiers to avoid duplicate replies
  // when Baileys re-fires messages.upsert across reconnects.
  const DEDUP_MAX = 100
  const recentMessageIds = new Set()

  /**
   * Handle an incoming active-contact message end-to-end.
   *
   * @param {{ jid: string, senderName: string, text: string, timestamp: number }} msg
   * @returns {Promise<void>}
   */
  async function handleMessage({ jid, senderName, text, timestamp }) {
    const userName = client.getSelfName() || 'the user'

    try {
      // 0. Dedup — skip if we've already processed this exact message recently.
      const dedupKey = `${jid}:${timestamp}:${(text ?? '').slice(0, 30)}`
      if (recentMessageIds.has(dedupKey)) {
        console.log(`[generator] Skipping duplicate message from ${senderName} (${jid})`)
        return
      }
      recentMessageIds.add(dedupKey)
      // Trim to the last DEDUP_MAX entries (Set preserves insertion order).
      while (recentMessageIds.size > DEDUP_MAX) {
        const oldest = recentMessageIds.values().next().value
        recentMessageIds.delete(oldest)
      }

      console.log(`[generator] Generating reply for ${senderName} (${jid})`)
      const profile = store.getProfile(jid) ?? store.getProfile(senderName)
      console.log(`[generator] Profile: ${profile ? `found (${profile.sampleSize} msgs, ${profile.language})` : 'none — using generic style'}`)

      // 2. Fetch last 10 messages from history
      //    NOTE: the router already appended the incoming message before calling us,
      //    so the history already includes it as the last entry.
      const historyRows = store.getHistory(jid, 10)

      // 3. Build system prompt
      const systemPrompt = buildSystemPrompt(profile, userName, senderName)

      // 4. Convert history to LLM format
      const historyMessages = formatHistoryForLLM(historyRows)

      // 5. Call LLM
      let generatedReply = await llmProvider.generate(systemPrompt, historyMessages)

      // 5a. Guard against empty/whitespace-only LLM output.
      if (!generatedReply || !generatedReply.trim()) {
        throw new Error('LLM returned empty response')
      }

      // 5b. Trim and strip surrounding quotes the LLM may have added.
      generatedReply = generatedReply.trim().replace(/^["'](.+)["']$/s, '$1').trim()

      // 6. Send reply to contact
      await client.sendMessage(jid, generatedReply)

      // 7. Store bot reply in history
      store.appendMessage({ jid, role: 'bot', text: generatedReply, timestamp: Date.now() })

      // No self-chat notification — only !activate/!deactivate surface there.
      // Terminal still logs via [generator] / [router] for visibility.
    } catch (err) {
      // Terminal-only — no self-chat notification (per user preference: only !activate/!deactivate surface there)
      console.error(`[ResponseGenerator] Failed to reply to ${senderName} (${jid}):`, err)
    }
  }

  return { handleMessage }
}
