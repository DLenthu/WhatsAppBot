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
