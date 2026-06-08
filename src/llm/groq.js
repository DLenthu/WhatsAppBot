import Groq from 'groq-sdk'

const REQUEST_TIMEOUT_MS = 30_000

export function createGroqProvider({ apiKey, model }) {
  const client = new Groq({ apiKey })

  return {
    async generate(systemPrompt, messages) {
      const completionPromise = client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        max_tokens: 300,
        temperature: 0.8
      })

      let timeoutHandle
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('LLM request timed out after 30s'))
        }, REQUEST_TIMEOUT_MS)
      })

      let completion
      try {
        completion = await Promise.race([completionPromise, timeoutPromise])
      } finally {
        clearTimeout(timeoutHandle)
      }

      const content = completion?.choices?.[0]?.message?.content
      if (content == null) {
        throw new Error('LLM response missing choices[0].message.content')
      }
      return content.trim()
    }
  }
}
