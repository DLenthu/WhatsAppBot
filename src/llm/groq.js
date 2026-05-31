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
