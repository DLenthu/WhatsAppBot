# TASK-12 — Main Entry Point
**Recommended model:** Sonnet  
**Dependencies:** ALL other tasks (01–11) must be complete

---

## Goal
Wire all components together in `src/index.js`. This is the only file that imports from all modules. It initializes everything in the right order, connects the event flow, and handles graceful shutdown.

## File to Create: `src/index.js`

## Initialization Order

```js
import 'dotenv/config'
import { createStore } from './state/store.js'
import { createLLMProvider } from './llm/index.js'
import { createWhatsAppClient } from './whatsapp/client.js'
import { createCommandHandler } from './commands/handler.js'
import { createResponseGenerator } from './response/generator.js'
import { createMessageRouter } from './whatsapp/router.js'
import { createDashboard } from './dashboard/server.js'

async function main() {
  // 1. State store (no async, just file init)
  const store = createStore()

  // 2. LLM provider (validates API key early)
  const llmProvider = createLLMProvider()

  // 3. Dashboard (start early so it's available even before WhatsApp connects)
  const dashboard = createDashboard({ store, port: process.env.DASHBOARD_PORT || 3000 })
  dashboard.start()

  // 4. WhatsApp client — pass onMessage callback
  const client = await createWhatsAppClient(async (message) => {
    await router.route(message)
  })

  // 5. Command handler (needs store + client)
  const commandHandler = createCommandHandler({ store, client })

  // 6. Response generator (needs store + llmProvider + client)
  const responseGenerator = createResponseGenerator({ store, llmProvider, client })

  // 7. Message router (wires command handler + response generator)
  const router = createMessageRouter({
    store,
    commandHandler,
    onActiveMessage: (msg) => responseGenerator.handleMessage(msg)
  })

  // 8. Startup banner
  console.log('✅ WhatsAppBot running')
  console.log('   Type !activate [name] in your self-chat to begin')
  console.log(`   Dashboard: http://localhost:${process.env.DASHBOARD_PORT || 3000}`)

  // 9. Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...')
    dashboard.stop()
    process.exit(0)
  })
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
```

## Circular Reference Note
The `router` is used inside the WhatsApp client callback, but `router` is created after `client`. This works because the callback is a closure — by the time any message arrives, `router` will be assigned. **This is intentional and correct.** Do not restructure to avoid it.

## Startup Validation
Before starting, validate required env vars:
```js
const required = ['GROQ_API_KEY'] // or OLLAMA_BASE_URL if provider=ollama
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`)
    console.error(`   Copy .env.example to .env and fill in your values`)
    process.exit(1)
  }
}
```

## Acceptance Criteria
- `npm start` starts the bot, shows QR on first run
- After WhatsApp link: "✅ WhatsAppBot running" message in terminal
- Dashboard URL printed to console
- `!activate [name]` → bot responds to that contact
- `Ctrl+C` shuts down cleanly
- Missing `.env` values fail fast with a clear message
- No circular import errors
