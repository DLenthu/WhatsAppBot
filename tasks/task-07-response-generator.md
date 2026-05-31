# TASK-07 — Response Generator
**Recommended model:** Sonnet  
**Dependencies:** TASK-03 (state store), TASK-04 (LLM provider), TASK-08 + TASK-09 (style system — optional, fallback to generic if no profile)

---

## Goal
When a message arrives from the active contact, generate a reply in the user's style and send it. This is the brain of the bot — it assembles context, builds the right prompt, calls the LLM, sends the reply, and notifies the user via self-chat.

## File to Create: `src/response/generator.js`

## Interface This Module Must Export

```js
export function createResponseGenerator({ store, llmProvider, client })

// Returns:
// generator.handleMessage({ jid, senderName, text, timestamp }) → Promise<void>
```

This is the `onActiveMessage` callback passed to the message router (TASK-06).

## Full Flow

```
1. Fetch style profile: store.getProfile(jid)
   - If no profile: use generic fallback style
   
2. Fetch message history: store.getHistory(jid, 10)
   - Format as [{role: 'user'|'assistant', content: text}]

3. Build system prompt (see below)

4. Append incoming message to history before generating
   (already done by router — don't double-append)

5. Call: llmProvider.generate(systemPrompt, historyMessages)

6. Send reply: client.sendMessage(jid, generatedReply)

7. Store reply: store.appendMessage({ jid, role: 'bot', text: generatedReply, timestamp: Date.now() })

8. Notify self-chat:
   client.sendMessage(selfJid, `🤖 Replied to ${senderName}: ${generatedReply.slice(0, 60)}${generatedReply.length > 60 ? '...' : ''}`)
```

## System Prompt Construction

### With style profile:
```
You are [user's name] replying to a WhatsApp message from [contact name].

Your communication style with [contact name]:
- Tone: [profile.tone]
- Average message length: [profile.avgLength] words (short/medium/long)
- Language: [profile.language] (e.g. "English", "English mixed with Telugu")
- Common phrases you use: [profile.commonPhrases.join(', ')]
- Emoji usage: [profile.emojiFrequency] (none/occasional/frequent)
- Other style notes: [profile.styleNotes]

Rules:
- Reply as [user's name], NOT as an AI
- Match the tone and length naturally
- Do not add pleasantries or sign-offs that aren't in your style
- Reply only with the message text, nothing else
- Keep it authentic and conversational
```

### Without style profile (generic fallback):
```
You are replying to a WhatsApp message on behalf of the user.
Keep the reply natural, conversational, and concise.
Reply only with the message text, nothing else.
```

## History Message Format for LLM

```js
[
  { role: 'user', content: 'Hey what are you doing?' },        // from contact
  { role: 'assistant', content: 'Nothing much, you?' },         // from user (bot)
  { role: 'user', content: 'Was wondering if you free tmrw' }  // latest message
]
```

## Error Handling

- If LLM call fails: send to self-chat `⚠️ Bot failed to reply to [Name]. Error: [message]`
- Do NOT send a reply to the contact on error
- Log the full error to console

## Acceptance Criteria
- Generates a reply and sends it to the active contact
- Notifies self-chat with preview of reply
- Uses style profile if available, falls back gracefully if not
- Appends bot reply to message history after sending
- On LLM error: notifies self-chat, does not send to contact
- History is passed as alternating user/assistant turns to LLM
