# TASK-03 — SQLite State Store
**Recommended model:** Haiku  
**Dependencies:** TASK-01 (scaffold must be done first)

---

## Goal
Create the SQLite state management module. This is the single source of truth for: which chat is currently active, style profiles per contact, and rolling message history per contact.

## File to Create: `src/state/store.js`

## Interface This Module Must Export

```js
export function createStore(dbPath = './data/bot.db')

// Returns object with these methods:

// Active chat
store.setActiveChat({ jid, name })   // set currently active contact
store.getActiveChat()                 // → { jid, name } | null
store.clearActiveChat()               // deactivate

// Message history (rolling window of last 50 per contact)
store.appendMessage({ jid, role, text, timestamp })  // role: 'user' | 'bot'
store.getHistory(jid, limit = 10)     // → [{ role, text, timestamp }]

// Style profiles
store.saveProfile(jid, profileJson)   // store style profile for a contact
store.getProfile(jid)                 // → object | null
store.listProfiles()                  // → [{ jid, name }]
```

## Database Schema

```sql
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
```

## Implementation Notes

- Use `better-sqlite3` (synchronous — no async needed)
- DB file: `./data/bot.db` (create `data/` dir if not exists)
- `appendMessage` must enforce rolling window: after insert, delete oldest rows beyond 50 for that JID
- `getProfile` parses JSON from `profile_json` column before returning
- `saveProfile` stringifies JSON before storing
- Initialize schema on `createStore` call (run CREATE TABLE IF NOT EXISTS statements)

## Acceptance Criteria
- Store persists across process restarts (SQLite file on disk)
- `setActiveChat` / `getActiveChat` / `clearActiveChat` work correctly
- Message history is capped at 50 per contact (oldest pruned automatically)
- `getHistory(jid, 10)` returns last 10 messages in chronological order
- Profile save/load round-trips without data loss
