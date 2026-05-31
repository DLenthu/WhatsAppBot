# TASK-13 — Ollama LLM Provider (Phase 2)
**Recommended model:** Haiku  
**Dependencies:** TASK-04 (LLM provider interface + factory)

---

## Goal
Add a local Ollama provider that implements the same interface as the Groq provider. Swapping from Groq to Ollama requires only a `.env` change: `LLM_PROVIDER=ollama`.

## File to Create: `src/llm/ollama.js`
## File to Modify: `src/llm/index.js` (add Ollama to factory)

---

## `src/llm/ollama.js`

Ollama exposes a local REST API at `http://localhost:11434`.

```js
export function createOllamaProvider({ baseUrl, model }) {
  return {
    async generate(systemPrompt, messages) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          stream: false,
          options: {
            temperature: 0.8,
            num_predict: 300
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${await response.text()}`)
      }

      const data = await response.json()
      return data.message.content.trim()
    }
  }
}
```

## Update `src/llm/index.js`

Add Ollama to the factory:
```js
import { createOllamaProvider } from './ollama.js'

// Inside createLLMProvider():
if (provider === 'ollama') {
  return createOllamaProvider({
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.2'
  })
}
```

## Setup Instructions for User (add to README)

```
# Switching to local Ollama

1. Install Ollama: https://ollama.com
2. Pull a model: ollama pull llama3.2
3. In .env: LLM_PROVIDER=ollama
4. Restart the bot
```

Recommended models for WhatsApp chat style:
- `llama3.2` — 3B, fast, good quality for short conversational replies
- `mistral` — 7B, slightly slower but very good at following style instructions
- `gemma3:4b` — Google's model, excellent instruction following

## Acceptance Criteria
- Setting `LLM_PROVIDER=ollama` in `.env` and restarting uses Ollama
- Generates replies with same interface as Groq provider
- Clear error message if Ollama is not running locally
- No changes required to any other module (interface is identical)
