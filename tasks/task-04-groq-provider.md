# TASK-04 — LLM Provider Interface + Groq Implementation
**Recommended model:** Haiku  
**Dependencies:** TASK-01 (scaffold must be done first)

---

## Goal
Create a pluggable LLM provider system. Define a common interface, implement it for Groq, and add a factory function that returns the right provider based on env config. Ollama will be added in TASK-13 using the same interface.

## Files to Create

### `src/llm/interface.js`
Documents the expected interface (JSDoc only, no class needed in ESM):

```js
/**
 * @typedef {Object} LLMProvider
 * @property {function(string, Array<{role:string, content:string}>): Promise<string>} generate
 *   systemPrompt: string
 *   messages: [{role: 'user'|'assistant', content: string}]
 *   returns: generated reply string
 */

export function validateProvider(provider) {
  if (typeof provider.generate !== 'function') {
    throw new Error('LLM provider must implement generate(systemPrompt, messages)')
  }
}
```

### `src/llm/groq.js`

```js
import Groq from 'groq-sdk'

export function createGroqProvider({ apiKey, model }) {
  const client = new Groq({ apiKey })
  
  return {
    async generate(systemPrompt, messages) {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 300,
        temperature: 0.8
      })
      return completion.choices[0].message.content.trim()
    }
  }
}
```

### `src/llm/index.js` — Factory

```js
import { createGroqProvider } from './groq.js'

export function createLLMProvider() {
  const provider = process.env.LLM_PROVIDER || 'groq'
  
  if (provider === 'groq') {
    return createGroqProvider({
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile'
    })
  }
  
  throw new Error(`Unknown LLM_PROVIDER: ${provider}. Valid values: groq, ollama`)
}
```

## Acceptance Criteria
- `createLLMProvider()` returns a Groq provider when `LLM_PROVIDER=groq`
- `provider.generate(systemPrompt, messages)` returns a non-empty string
- Throws clear error if `GROQ_API_KEY` is missing or invalid
- `max_tokens: 300` keeps responses concise (chat-length replies)
- `temperature: 0.8` gives natural variation without being incoherent
- Factory throws on unknown provider value
