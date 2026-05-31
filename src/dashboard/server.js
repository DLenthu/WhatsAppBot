import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Create a dashboard server
 * @param {Object} options
 * @param {Object} options.store - State store instance
 * @param {number} options.port - Port to run the server on
 * @returns {Object} Dashboard with start() and stop() methods
 */
export function createDashboard({ store, port }) {
  const app = express()
  let server = null

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, 'public')))

  // API endpoint for status
  app.get('/api/status', (req, res) => {
    try {
      const activeChat = store.getActiveChat()
      const profiles = store.listProfiles()

      // Get recent replies (last 5 bot messages from all contacts or active contact)
      let recentReplies = []

      if (activeChat && activeChat.jid) {
        // Get history for active contact
        const history = store.getHistory(activeChat.jid, 50)
        // Filter for bot messages (role === 'assistant') and take last 5
        recentReplies = history
          .filter(msg => msg.role === 'assistant')
          .slice(-5)
          .map(msg => ({
            contact: activeChat.name || activeChat.jid,
            text: msg.text,
            timestamp: msg.timestamp
          }))
      } else {
        // Get recent bot messages from all profiles
        const allMessages = []
        profiles.forEach(profile => {
          const history = store.getHistory(profile.jid, 50)
          const botMessages = history
            .filter(msg => msg.role === 'assistant')
            .map(msg => ({
              contact: profile.name || profile.jid,
              text: msg.text,
              timestamp: msg.timestamp,
              jid: profile.jid
            }))
          allMessages.push(...botMessages)
        })
        // Sort by timestamp descending and take last 5
        recentReplies = allMessages
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 5)
          .map(({ contact, text, timestamp }) => ({ contact, text, timestamp }))
      }

      res.json({
        active: activeChat !== null,
        activeContact: activeChat ? { jid: activeChat.jid, name: activeChat.name } : null,
        profiles: profiles,
        recentReplies: recentReplies
      })
    } catch (error) {
      console.error('[Dashboard] Error in /api/status:', error)
      res.status(500).json({ error: 'Failed to retrieve status' })
    }
  })

  // Serve index.html for root and any other routes
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  })

  return {
    start() {
      server = app.listen(port, () => {
        console.log(`🌐 Dashboard running at http://localhost:${port}`)
      })
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`⚠️  Dashboard: port ${port} in use — dashboard unavailable. Bot will still work.`)
        } else {
          console.error('Dashboard error:', err.message)
        }
      })
    },

    stop() {
      if (server) {
        server.close()
      }
    }
  }
}
