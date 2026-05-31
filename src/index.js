import 'dotenv/config'
import { createStore } from './state/store.js'
import { createLLMProvider } from './llm/index.js'
import { createWhatsAppClient } from './whatsapp/client.js'
import { createCommandHandler } from './commands/handler.js'
import { createResponseGenerator } from './response/generator.js'
import { createMessageRouter } from './whatsapp/router.js'
import { createDashboard } from './dashboard/server.js'

function validateEnv() {
  const provider = process.env.LLM_PROVIDER || 'groq'

  if (provider === 'groq') {
    if (!process.env.GROQ_API_KEY) {
      console.error('❌ Missing required env var: GROQ_API_KEY')
      console.error('   Copy .env.example to .env and fill in your values')
      process.exit(1)
    }
  }

  if (provider === 'ollama') {
    if (!process.env.OLLAMA_BASE_URL) {
      console.error('❌ Missing required env var: OLLAMA_BASE_URL')
      console.error('   Copy .env.example to .env and fill in your values')
      process.exit(1)
    }
  }
}

async function main() {
  // Validate required env vars before doing anything else
  validateEnv()

  // 1. State store (synchronous init, creates data dir if needed)
  const store = createStore()

  // 2. LLM provider (reads API key from env)
  const llmProvider = createLLMProvider()

  // 3. Dashboard — start early so it's accessible even while WhatsApp is connecting
  const dashboard = createDashboard({
    store,
    port: process.env.DASHBOARD_PORT || 3000,
  })
  dashboard.start()

  // 4. WhatsApp client — pass onMessage as a closure so router can be assigned later
  let router
  const client = await createWhatsAppClient(async (message) => {
    await router.route(message)
  })

  // 5. Command handler (needs store + client)
  const commandHandler = createCommandHandler({ store, client })

  // 6. Response generator (needs store + llmProvider + client)
  const responseGenerator = createResponseGenerator({ store, llmProvider, client })

  // 7. Message router — wire command handler + response generator
  //    selfJid is read from the client after it has connected
  router = createMessageRouter({
    store,
    commandHandler,
    onActiveMessage: (msg) => responseGenerator.handleMessage(msg),
    selfJid: client.getSelfJid(),
  })

  // 8. Startup banner
  const dashboardPort = process.env.DASHBOARD_PORT || 3000
  console.log('✅ WhatsAppBot running')
  console.log('   Type !activate [name] in your self-chat to begin')
  console.log(`   Dashboard: http://localhost:${dashboardPort}`)

  // 9. Graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...')
    dashboard.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
