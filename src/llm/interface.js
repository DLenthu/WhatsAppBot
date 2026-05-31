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
