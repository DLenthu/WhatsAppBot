import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let Database = null
try {
  const module = await import('better-sqlite3')
  Database = module.default
} catch (err) {
  console.warn(
    '[Store] better-sqlite3 import failed, falling back to JSON file storage',
    err.message
  )
  Database = null
}

/**
 * Create and return a state store instance.
 * Uses SQLite if better-sqlite3 is available, falls back to JSON file storage.
 *
 * @param {string} dbPath - Path to database file (or JSON file for fallback)
 * @returns {Object} Store instance with all required methods
 */
export function createStore(dbPath = './data/bot.db') {
  if (Database) {
    return createSQLiteStore(dbPath)
  } else {
    return createJSONStore(dbPath)
  }
}

/**
 * SQLite-backed store implementation
 */
function createSQLiteStore(dbPath) {
  // Ensure directory exists
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  let db
  try {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
  } catch (err) {
    console.warn('[Store] Failed to initialize SQLite database, falling back to JSON storage:', err.message)
    return createJSONStore(dbPath)
  }

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_chat (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      jid TEXT,
      name TEXT
    );

    CREATE TABLE IF NOT EXISTS message_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_jid ON message_history(jid, timestamp DESC);

    CREATE TABLE IF NOT EXISTS style_profiles (
      jid TEXT PRIMARY KEY,
      name TEXT,
      profile_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      jid TEXT NOT NULL UNIQUE,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_contact_hints_name ON contact_hints(name);
  `)

  return {
    // Active chat management
    setActiveChat({ jid, name }) {
      const existing = db.prepare('SELECT id FROM active_chat WHERE id = 1').get()
      if (existing) {
        db.prepare('UPDATE active_chat SET jid = ?, name = ? WHERE id = 1').run(jid, name)
      } else {
        db.prepare('INSERT INTO active_chat (id, jid, name) VALUES (1, ?, ?)').run(jid, name)
      }
    },

    getActiveChat() {
      const row = db.prepare('SELECT jid, name FROM active_chat WHERE id = 1').get()
      return row || null
    },

    clearActiveChat() {
      db.prepare('DELETE FROM active_chat WHERE id = 1').run()
    },

    // Message history management
    appendMessage({ jid, role, text, timestamp }) {
      // Insert new message
      db.prepare(
        'INSERT INTO message_history (jid, role, text, timestamp) VALUES (?, ?, ?, ?)'
      ).run(jid, role, text, timestamp)

      // Prune oldest messages if exceeding 50 per JID
      const count = db
        .prepare('SELECT COUNT(*) as cnt FROM message_history WHERE jid = ?')
        .get(jid).cnt

      if (count > 50) {
        const idsToDelete = db
          .prepare(
            `SELECT id FROM message_history WHERE jid = ?
             ORDER BY timestamp ASC LIMIT ${count - 50}`
          )
          .all(jid)
          .map((row) => row.id)

        if (idsToDelete.length > 0) {
          const placeholders = idsToDelete.map(() => '?').join(',')
          db.prepare(`DELETE FROM message_history WHERE id IN (${placeholders})`).run(
            ...idsToDelete
          )
        }
      }
    },

    getHistory(jid, limit = 10) {
      const rows = db
        .prepare(
          `SELECT role, text, timestamp FROM message_history
           WHERE jid = ?
           ORDER BY timestamp ASC
           LIMIT ?`
        )
        .all(jid, limit)

      return rows
    },

    // Style profile management
    saveProfile(jid, profileJson) {
      const jsonString = typeof profileJson === 'string' ? profileJson : JSON.stringify(profileJson)
      const updatedAt = Date.now()

      const existing = db.prepare('SELECT jid FROM style_profiles WHERE jid = ?').get(jid)
      if (existing) {
        db.prepare(
          'UPDATE style_profiles SET profile_json = ?, updated_at = ? WHERE jid = ?'
        ).run(jsonString, updatedAt, jid)
      } else {
        db.prepare(
          'INSERT INTO style_profiles (jid, profile_json, updated_at) VALUES (?, ?, ?)'
        ).run(jid, jsonString, updatedAt)
      }
    },

    getProfile(jid) {
      const row = db.prepare('SELECT profile_json FROM style_profiles WHERE jid = ?').get(jid)
      if (!row) return null

      try {
        return JSON.parse(row.profile_json)
      } catch (err) {
        console.error(`[Store] Failed to parse profile for ${jid}:`, err)
        return null
      }
    },

    listProfiles() {
      const rows = db
        .prepare('SELECT jid, name FROM style_profiles ORDER BY updated_at DESC')
        .all()
      return rows
    },

    // Contact hint management
    saveContactHint(name, jid) {
      const updatedAt = Date.now()
      const existing = db.prepare('SELECT id FROM contact_hints WHERE jid = ?').get(jid)
      if (existing) {
        db.prepare('UPDATE contact_hints SET name = ?, updated_at = ? WHERE jid = ?').run(
          name,
          updatedAt,
          jid
        )
      } else {
        db.prepare(
          'INSERT INTO contact_hints (name, jid, updated_at) VALUES (?, ?, ?)'
        ).run(name, jid, updatedAt)
      }
    },

    resolveContact(nameQuery) {
      if (!nameQuery) return null

      const q = nameQuery.toLowerCase()
      const row = db
        .prepare("SELECT jid, name FROM contact_hints WHERE lower(name) LIKE '%' || ? || '%' LIMIT 1")
        .get(q)

      return row ? { jid: row.jid, name: row.name } : null
    },
  }
}

/**
 * JSON file-backed store implementation (fallback)
 */
function createJSONStore(dbPath) {
  // Convert db path to json path
  const jsonPath =
    dbPath === './data/bot.db'
      ? './data/bot.json'
      : dbPath.replace(/\.db$/, '.json')

  // Ensure directory exists
  const dir = path.dirname(jsonPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Initialize data structure
  const defaultData = {
    active_chat: null,
    message_history: {},
    style_profiles: {},
    contact_hints: {},
  }

  function loadData() {
    if (fs.existsSync(jsonPath)) {
      try {
        const content = fs.readFileSync(jsonPath, 'utf-8')
        return JSON.parse(content)
      } catch (err) {
        console.warn('[Store] Failed to parse JSON data, using defaults:', err.message)
        return defaultData
      }
    }
    return defaultData
  }

  function saveData(data) {
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Store] Failed to save JSON data:', err)
    }
  }

  return {
    // Active chat management
    setActiveChat({ jid, name }) {
      const data = loadData()
      data.active_chat = { jid, name }
      saveData(data)
    },

    getActiveChat() {
      const data = loadData()
      return data.active_chat || null
    },

    clearActiveChat() {
      const data = loadData()
      data.active_chat = null
      saveData(data)
    },

    // Message history management
    appendMessage({ jid, role, text, timestamp }) {
      const data = loadData()
      if (!data.message_history[jid]) {
        data.message_history[jid] = []
      }

      data.message_history[jid].push({ role, text, timestamp })

      // Prune to 50 messages per JID
      if (data.message_history[jid].length > 50) {
        data.message_history[jid] = data.message_history[jid].slice(-50)
      }

      saveData(data)
    },

    getHistory(jid, limit = 10) {
      const data = loadData()
      const history = data.message_history[jid] || []

      // Return in chronological order (oldest first), limited
      return history.slice(-limit)
    },

    // Style profile management
    saveProfile(jid, profileJson) {
      const data = loadData()
      data.style_profiles[jid] = typeof profileJson === 'string' ? JSON.parse(profileJson) : profileJson
      saveData(data)
    },

    getProfile(jid) {
      const data = loadData()
      return data.style_profiles[jid] || null
    },

    listProfiles() {
      const data = loadData()
      return Object.entries(data.style_profiles).map(([jid]) => ({ jid, name: null }))
    },

    // Contact hint management
    saveContactHint(name, jid) {
      const data = loadData()
      data.contact_hints[jid] = name
      saveData(data)
    },

    resolveContact(nameQuery) {
      if (!nameQuery) return null

      const q = nameQuery.toLowerCase()
      const data = loadData()
      for (const [jid, name] of Object.entries(data.contact_hints)) {
        if (name.toLowerCase().includes(q)) {
          return { jid, name }
        }
      }
      return null
    },
  }
}
