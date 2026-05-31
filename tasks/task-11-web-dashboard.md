# TASK-11 — Web Dashboard
**Recommended model:** Haiku  
**Dependencies:** TASK-03 (state store), TASK-01 (scaffold)

---

## Goal
A minimal Express web server with a simple HTML page the user can open on their phone browser (on the same WiFi). Shows current bot status, active contact, and recent replies.

## Files to Create

- `src/dashboard/server.js`
- `src/dashboard/public/index.html`

## Interface This Module Must Export

```js
export function createDashboard({ store, port })
// Returns:
// dashboard.start() → void  (starts Express server)
// dashboard.stop() → void
```

## API Endpoints (`server.js`)

```
GET /api/status
Response:
{
  "active": true | false,
  "activeContact": { "jid": "...", "name": "Mom" } | null,
  "profiles": [{ "jid": "...", "name": "Mom" }],
  "recentReplies": [{ "contact": "Mom", "text": "...", "timestamp": 1234567890 }]
}

GET /
Serve public/index.html
```

## HTML Dashboard (`public/index.html`)

Single-page, no frameworks, vanilla JS + CSS. Should show:

**Header:** "WhatsAppBot 🤖"

**Status card:**
- Big colored dot: green if active, grey if inactive
- "Active for: Mom" or "Inactive"

**Loaded profiles:**
- Simple list: "✅ Mom", "✅ Work Friend" — contacts with style profiles loaded

**Recent bot replies** (last 5):
- "Mom — 2 min ago: Hey just heading out..."
- Auto-refreshes every 10 seconds via `setInterval + fetch('/api/status')`

**Style:** Minimal CSS, mobile-friendly (works well on phone browser). Dark background preferred.

## Acceptance Criteria
- Server starts on `DASHBOARD_PORT` from `.env` (default 3000)
- `/api/status` returns correct JSON from SQLite
- Dashboard HTML auto-refreshes every 10s
- Accessible from phone browser on same WiFi at `http://[laptop-local-ip]:3000`
- No authentication needed (local network only)
- Server startup logs: `🌐 Dashboard running at http://localhost:3000`
