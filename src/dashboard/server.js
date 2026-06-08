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

  // API endpoint for status (supports parallel multi-account: multiple active chats)
  app.get('/api/status', (req, res) => {
    try {
      const activeChats = store.getActiveChats()
      const profiles = store.listProfiles()

      // Collect bot replies across every active contact, plus every profile we have history for
      const seen = new Set()
      const sources = [
        ...activeChats.map(c => ({ jid: c.jid, name: c.name })),
        ...profiles.map(p => ({ jid: p.jid, name: p.name })),
      ]

      const allMessages = []
      for (const src of sources) {
        if (seen.has(src.jid)) continue
        seen.add(src.jid)
        const history = store.getHistory(src.jid, 50)
        for (const msg of history) {
          if (msg.role !== 'bot') continue
          allMessages.push({
            contact: src.name || src.jid,
            text: msg.text,
            timestamp: msg.timestamp,
          })
        }
      }

      const recentReplies = allMessages
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5)

      res.json({
        active: activeChats.length > 0,
        activeContacts: activeChats,
        profiles,
        recentReplies,
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
