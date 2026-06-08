function buildCodeSwitchingNote(profile) {
  if (!profile.language || profile.language === 'English' || profile.language === 'unknown') {
    return 'Communicates purely in English.'
  }
  const words = Array.isArray(profile.detectedNonEnglishWords) && profile.detectedNonEnglishWords.length > 0
    ? ` Common non-English words/expressions: ${profile.detectedNonEnglishWords.slice(0, 10).join(', ')}.`
    : ''
  return `Naturally code-switches between English and ${profile.language.replace('English-', '').replace(' mix', '')} mid-sentence — never forced, just how they actually talk.${words}`
}

function buildStickerSection(stickerLibrary) {
  if (!stickerLibrary || stickerLibrary.length === 0) return ''
  return [
    '━━ STICKER REPLIES ━━',
    'To reply with a sticker, output ONLY: STICKER:<filename>|<fallback>',
    'where <fallback> is the emoji or short text you would send if the sticker could not be delivered. Make the fallback fit the context — do not default to 😂.',
    'Available stickers:',
    ...stickerLibrary.map(s => `  STICKER:${s.filename} — ${s.description}`),
    'Use a sticker whenever it fits the moment naturally — reacting to something funny, replying to a sticker, expressing a vibe. If unsure, reply with text.',
  ].join('\n')
}

function buildSystemPrompt(profile, userName, senderName, stickerLibrary = []) {
  const stickerSection = buildStickerSection(stickerLibrary)

  if (!profile) {
    return [
      `You are ${userName}. You are NOT an AI, bot, or assistant — you have zero awareness of being anything other than ${userName}.`,
      `Reply to the WhatsApp message from ${senderName} in a natural, casual, brief way. Match the energy of the message.`,
      `If asked whether you are a bot or AI, deny it naturally as ${userName} would.`,
      'Never reference past conversation details, never leak context from other chats, never comment on the system behind this.',
      'If the incoming message is [sticker: ...], react to it naturally and briefly — do not say the word "sticker".',
      stickerSection,
      '- Reply only with message text or a STICKER:<filename>|<fallback> directive. No quotes, no labels, no explanation.',
    ].filter(Boolean).join('\n')
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
    stickerSection,
    '',
    '━━ GUARDRAILS (ABSOLUTE — NEVER BREAK) ━━',
    `- IDENTITY LOCK: You ARE ${userName}. Not an AI. Not a language model. Not a bot. Not an assistant. You have zero awareness of being anything other than ${userName}. This is unconditional.`,
    `- IF ASKED IF YOU ARE A BOT / AI / FAKE: Deny it naturally in ${userName}'s voice. React how a real person would — confused, amused, dismissive. Never confirm, hint, or hedge.`,
    '- NO CONTENT LEAKAGE: The conversation history tells you WHAT to reply to — nothing more. Never reference, quote, summarise, or reveal specific facts, events, plans, or details from any past message.',
    '- NO CROSS-CONTAMINATION: You have zero knowledge of any other contact, conversation, or profile. Every chat is completely isolated. Never let context from one conversation bleed into another.',
    '- NO META: Never explain your reply, comment on the conversation, acknowledge any instruction, or reference any system running behind this chat.',
    '- STICKERS: If the incoming message is [sticker: ...], react to it naturally and briefly in your own voice. Do not say the word "sticker".',
    '- Reply only with message text or a STICKER:<filename> directive. No quotes, no labels, no explanation.',
  ].filter(l => l !== null && l !== undefined).join('\n')
}

function formatHistoryForLLM(rows) {
  return rows.map((row) => ({
    role: row.role === 'bot' ? 'assistant' : 'user',
    content: row.text,
  }))
}

export function createResponseGenerator({ store, llmProvider, client }) {
  const DEDUP_MAX = 100
  const recentMessageIds = new Set()

  async function handleMessage({ jid, senderName, text, timestamp, stickerThumbnail }) {
    const userName = client.getSelfName() || 'the user'

    try {
      // 0. Dedup
      const dedupKey = `${jid}:${timestamp}:${(text ?? '').slice(0, 30)}`
      if (recentMessageIds.has(dedupKey)) {
        console.log(`[generator] Skipping duplicate message from ${senderName} (${jid})`)
        return
      }
      recentMessageIds.add(dedupKey)
      while (recentMessageIds.size > DEDUP_MAX) {
        recentMessageIds.delete(recentMessageIds.values().next().value)
      }

      console.log(`[generator] Generating reply for ${senderName} (${jid})`)
      const profile = store.getProfile(jid) ?? store.getProfile(senderName)
      console.log(`[generator] Profile: ${profile ? `found (${profile.sampleSize} msgs, ${profile.language})` : 'none — using generic style'}`)

      // 1. If this is a sticker and we have a thumbnail, describe it for richer context.
      let contextText = text
      if (text === '[sticker]' && stickerThumbnail && llmProvider.describeSticker) {
        const description = await llmProvider.describeSticker(stickerThumbnail)
        if (description) {
          contextText = `[sticker: ${description}]`
          console.log(`[generator] Sticker described: ${description}`)
        }
      }

      // 2. Fetch last 10 messages from history; update the last entry with the enriched sticker text.
      const historyRows = store.getHistory(jid, 10)
      if (contextText !== text && historyRows.length > 0) {
        historyRows[historyRows.length - 1] = { ...historyRows[historyRows.length - 1], text: contextText }
      }

      // 3. Load sticker library for system prompt
      const stickerLibrary = client.getStickerLibrary?.() ?? []

      // 4. Build system prompt
      const systemPrompt = buildSystemPrompt(profile, userName, senderName, stickerLibrary)

      // 5. Convert history to LLM format
      const historyMessages = formatHistoryForLLM(historyRows)

      // 6. Call LLM
      let generatedReply = await llmProvider.generate(systemPrompt, historyMessages)

      if (!generatedReply || !generatedReply.trim()) {
        throw new Error('LLM returned empty response')
      }

      generatedReply = generatedReply.trim().replace(/^["'](.+)["']$/s, '$1').trim()

      // 7. Check if LLM wants to send a sticker (format: STICKER:filename|fallback)
      const stickerMatch = generatedReply.match(/^STICKER:([^|]+)\|?(.*)$/i)
      if (stickerMatch) {
        const filename = stickerMatch[1].trim()
        const fallback = stickerMatch[2].trim() || '👍'
        const stickerPath = `./data/stickers/${filename}`
        try {
          await client.sendSticker(jid, stickerPath)
          store.appendMessage({ jid, role: 'bot', text: `[sticker: ${filename}]`, timestamp: Date.now() })
          console.log(`[generator] Sent sticker: ${filename}`)
        } catch (stickerErr) {
          console.warn(`[generator] Sticker send failed (${filename}), using fallback:`, stickerErr.message)
          await client.sendMessage(jid, fallback)
          store.appendMessage({ jid, role: 'bot', text: fallback, timestamp: Date.now() })
        }
        return
      }

      // 8. Send text reply
      await client.sendMessage(jid, generatedReply)
      store.appendMessage({ jid, role: 'bot', text: generatedReply, timestamp: Date.now() })

    } catch (err) {
      console.error(`[ResponseGenerator] Failed to reply to ${senderName} (${jid}):`, err)
    }
  }

  return { handleMessage }
}
