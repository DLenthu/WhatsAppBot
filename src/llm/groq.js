import Groq from 'groq-sdk'

const REQUEST_TIMEOUT_MS = 30_000
const VISION_MODEL = 'llama-3.2-11b-vision-preview'

export function createGroqProvider({ apiKey, model }) {
  const client = new Groq({ apiKey })

  async function withTimeout(promise, ms) {
    let handle
    const timeout = new Promise((_, reject) => {
      handle = setTimeout(() => reject(new Error('LLM request timed out')), ms)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      clearTimeout(handle)
    }
  }

  return {
    async generate(systemPrompt, messages) {
      const completion = await withTimeout(
        client.chat.completions.create({
          model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 300,
          temperature: 0.8,
        }),
        REQUEST_TIMEOUT_MS
      )
      const content = completion?.choices?.[0]?.message?.content
      if (content == null) throw new Error('LLM response missing choices[0].message.content')
      return content.trim()
    },

    // Describe a visual thumbnail (sticker or image) using a vision model.
    // base64 — base64-encoded image bytes (PNG for stickers, JPEG for images).
    // prompt — optional custom description prompt.
    // Returns a short description or null on failure.
    async describeSticker(base64, prompt) {
      try {
        const descPrompt = prompt || 'Describe this image/sticker in 3-8 words (e.g. "laughing face", "dog running on beach", "thumbs up meme"). Just the description, nothing else.'
        const mimeType = base64.startsWith('/9j') ? 'image/jpeg' : 'image/png'
        const completion = await withTimeout(
          client.chat.completions.create({
            model: VISION_MODEL,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                { type: 'text', text: descPrompt },
              ],
            }],
            max_tokens: 50,
            temperature: 0.1,
          }),
          10_000
        )
        return completion?.choices?.[0]?.message?.content?.trim() || null
      } catch {
        return null
      }
    },
  }
}
