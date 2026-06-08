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
    console.warn('[Store] SQLite unavailable (missing build tools), using JSON storage instead.')
    return createJSONStore(dbPath)
  }

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_chats (
      jid TEXT PRIMARY KEY,
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
    // Active chats management (parallel multi-account)
    addActiveChat({ jid, name }) {
      db.prepare('INSERT OR REPLACE INTO active_chats (jid, name) VALUES (?, ?)').run(jid, name)
    },

    removeActiveChat(jid) {
      db.prepare('DELETE FROM active_chats WHERE jid = ?').run(jid)
    },

    getActiveChatByJid(jid) {
      return db.prepare('SELECT jid, name FROM active_chats WHERE jid = ?').get(jid) ?? null
    },

    getActiveChats() {
      return db.prepare('SELECT jid, name FROM active_chats').all()
    },

    clearAllActiveChats() {
      db.prepare('DELETE FROM active_chats').run()
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
  const tmpPath = jsonPath + '.tmp'

  // Ensure directory exists
  const dir = path.dirname(jsonPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Fix 5: Initialize missing fields on load
  function normalizeState(data) {
    if (!data || typeof data !== 'object') {
      data = {}
    }
    if (!data.active_chats || typeof data.active_chats !== 'object') {
      data.active_chats = {}
    }
    if (!data.message_history || typeof data.message_history !== 'object') {
      data.message_history = {}
    }
    if (!data.style_profiles || typeof data.style_profiles !== 'object') {
      data.style_profiles = {}
    }
    if (!data.contact_hints || typeof data.contact_hints !== 'object') {
      data.contact_hints = {}
    }
    // Fix 4: Migrate legacy singular `active_chat` to `active_chats`
    if (data.active_chat) {
      if (Object.keys(data.active_chats).length === 0) {
        if (data.active_chat.jid) {
          data.active_chats[data.active_chat.jid] = data.active_chat
        }
      }
      delete data.active_chat
    }
    return data
  }

  // Fix 1: Load state into memory ONCE at startup
  let state
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, 'utf-8')
      state = normalizeState(JSON.parse(content))
    } catch (err) {
      console.warn('[Store] Failed to parse JSON data, using defaults:', err.message)
      state = normalizeState({})
    }
  } else {
    state = normalizeState({})
  }

  // Fix 2 + Fix 6: Debounced async writes with atomic rename
  let saveTimer = null
  let savePending = false
  let saveInFlight = false
  const SAVE_DEBOUNCE_MS = 300

  async function performSave() {
    if (saveInFlight) {
      // A save is already running. Mark pending so we save again after.
      savePending = true
      return
    }
    saveInFlight = true
    savePending = false
    try {
      const payload = JSON.stringify(state, null, 2)
      // Fix 6: Atomic write — write to .tmp then rename
      await fs.promises.writeFile(tmpPath, payload, 'utf-8')
      await fs.promises.rename(tmpPath, jsonPath)
    } catch (err) {
      console.error('[Store] Failed to save JSON data:', err)
    } finally {
      saveInFlight = false
      if (savePending) {
        // Coalesce: another change occurred while we were writing — flush again
        savePending = false
        scheduleSave()
      }
    }
  }

  function scheduleSave() {
    if (saveInFlight) {
      // Defer until current write completes
      savePending = true
      return
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      saveTimer = null
      performSave()
    }, SAVE_DEBOUNCE_MS)
  }

  return {
    // Active chats management (parallel multi-account)
    addActiveChat({ jid, name }) {
      state.active_chats[jid] = { jid, name }
      scheduleSave()
    },

    removeActiveChat(jid) {
      delete state.active_chats[jid]
      scheduleSave()
    },

    getActiveChatByJid(jid) {
      return state.active_chats[jid] ?? null
    },

    getActiveChats() {
      return Object.values(state.active_chats)
    },

    clearAllActiveChats() {
      state.active_chats = {}
      scheduleSave()
    },

    // Message history management
    appendMessage({ jid, role, text, timestamp }) {
      if (!state.message_history[jid]) {
        state.message_history[jid] = []
      }

      state.message_history[jid].push({ role, text, timestamp })

      // Prune to 50 messages per JID
      if (state.message_history[jid].length > 50) {
        state.message_history[jid] = state.message_history[jid].slice(-50)
      }

      scheduleSave()
    },

    getHistory(jid, limit = 10) {
      const history = state.message_history[jid] || []
      // Return in chronological order (oldest first), limited
      return history.slice(-limit)
    },

    // Style profile management
    saveProfile(jid, profileJson) {
      state.style_profiles[jid] =
        typeof profileJson === 'string' ? JSON.parse(profileJson) : profileJson
      scheduleSave()
    },

    getProfile(jid) {
      return state.style_profiles[jid] || null
    },

    listProfiles() {
      return Object.entries(state.style_profiles).map(([jid]) => ({ jid, name: null }))
    },

    // Contact hint management
    saveContactHint(name, jid) {
      state.contact_hints[jid] = name
      scheduleSave()
    },

    resolveContact(nameQuery) {
      if (!nameQuery) return null

      const q = nameQuery.toLowerCase()
      for (const [jid, name] of Object.entries(state.contact_hints)) {
        if (name.toLowerCase().includes(q)) {
          return { jid, name }
        }
      }
      return null
    },

    // Fix 3: Sync flush on shutdown — cancels pending debounce and writes immediately
    flush() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      try {
        const payload = JSON.stringify(state, null, 2)
        fs.writeFileSync(tmpPath, payload, 'utf-8')
        fs.renameSync(tmpPath, jsonPath)
      } catch (err) {
        console.error('[Store] Failed to flush JSON data:', err)
      }
    },
  }
}
