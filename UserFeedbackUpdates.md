# User Feedback & Session Updates

A running log of bugs found, fixes applied, and user preferences discovered during testing.
A new session should read this top-to-bottom before touching any code.

---

## Session 2 — 2026-06-01

### Issue: "Bad MAC" / "Failed to decrypt" spam in terminal
**Symptom:** Terminal flooded with libsignal stack traces on every incoming WhatsApp message.
**Root cause:** WhatsApp encrypts messages for the user's phone; the companion device (bot) can't decrypt them. This is expected behavior, not a real error.
**Fix:** Added `console.error` filter at the very top of `src/index.js` (before any imports) that silences lines containing `bad mac`, `session error`, `failed to decrypt`, `skipping message`, `no session record`, `decrypt`.
**File:** `src/index.js` lines 3–15

---

### Issue: !activate command not being detected
**Symptom:** User types `!activate [name]` in their command chat but bot does nothing.
**Root cause (1):** `COMMAND_JID` was set to a group JID (`918971255638-1580452195@g.us`). User's actual preferred command chat is "Bhargav (You)" — their WhatsApp self-chat.
**Root cause (2):** Newer WhatsApp uses **LID format** (`@lid`) for the self-chat JID instead of the phone number JID (`@s.whatsapp.net`). The debug log showed:
```
jid=68719577423981@lid  commandJid=918971255638@s.whatsapp.net
```
These don't match, so commands were silently dropped.
**Fix:**
- Set `COMMAND_JID=68719577423981@lid` in `.env`
- Updated router (`src/whatsapp/router.js`) to also accept `@lid` JIDs when `fromMe=true` and no COMMAND_JID is set, as a resilience fallback.
**File:** `.env`, `src/whatsapp/router.js`

---

### Issue: !activate can't find contact by saved name
**Symptom:** `!activate Lakshmi Mobile` returns "No contact found" even though the contact has previous chat history.
**Root cause:** The store's `resolveContact()` only knows contacts that have *sent a message since the bot started* (populated via `saveContactHint` in the router). "Lakshmi Mobile" hadn't sent a new message, so she was unknown to the store.
**Fix (partial):** Added `findContactByName()` to `client.js` that searches `historyStore` (messages loaded from `messaging-history.set`) as a fallback after `store.resolveContact()` returns null. Updated `handler.js` to use `store.resolveContact(name) ?? client.findContactByName(name)`.

---

### Issue: findContactByName only finds recently active contacts
**Symptom:** `!contacts` only lists contacts from the current active session, missing contacts with old chats.
**Root cause:** `historyStore` is populated from `messaging-history.set` which Baileys fires once on connect with recent messages (not all-time history). Contacts with no recent messages are absent.
**Fix (in progress):**
- Added `chatsStore` Map in `client.js` populated from `chats.set` and `chats.upsert` events — Baileys fires `chats.set` on connect with metadata for ALL known chats including their display names.
- Added `contactsStore` Map populated from `contacts.upsert` and `contacts.update` events — provides phone-saved contact names when WhatsApp syncs them.
- Added `searchContacts(query)` method that checks `chatsStore` → `contactsStore` → `historyStore` in priority order.
- Added `!contacts [query]` command that calls `searchContacts` and lists results in the self-chat.
- On connect, logs: `[client] Loaded N chats` so user can verify sync happened.
**Status:** Code written, pending user restart + test to confirm `!contacts` now shows all contacts.
**Files:** `src/whatsapp/client.js`, `src/commands/handler.js`

---

## Key user preferences (apply in all sessions)

- **Command chat:** "Bhargav (You)" self-chat. JID: `68719577423981@lid`. Set in `.env` as `COMMAND_JID`.
- **Bot confirmation messages** go to `client.getSelfJid()` (the `@s.whatsapp.net` JID), not the LID.
- **LLM:** Groq, model `llama-3.1-70b-versatile`. API key in `.env` — never commit `.env`.
- **One chat active at a time** — multi-chat support is a future phase.
- **Style profile** is auto-built from last 200 messages on first `!activate` — no manual export needed.
- **Contact resolution priority:** store hints → chatsStore (all chats) → contactsStore (phone names) → historyStore pushNames.

---

### Issue: !contacts only showing actively messaging contacts, not full contact list
**Symptom:** `!contacts` returns only a handful of contacts who sent messages during the current session.
**Root cause:** Manual `contacts.upsert` / `chats.set` listeners miss the bulk sync that Baileys does on connect. `makeInMemoryStore` is the correct Baileys API for this — it subscribes to ALL relevant events internally and builds a complete snapshot.
**Fix:** Replaced all manual `contactsStore`/`chatsStore` Maps with `makeInMemoryStore` from Baileys.
- `waStore.bind(sock.ev)` wires it to all sync events automatically
- `waStore.contacts` → plain object keyed by JID, has `.name` (phone-saved) and `.notify` (WA name)
- `waStore.chats.all()` → all known chats
- Store is persisted to `data/wa-store.json` every 30s, loaded on restart
- `searchContacts()` now searches `waStore.contacts` → `waStore.chats` → `historyStore` in order
**File:** `src/whatsapp/client.js` (full rewrite of contact tracking)

---

---

## Session 3 — 2026-06-08

### Issue: No QR code shown after forgetting device on WhatsApp
**Symptom:** User forgets the linked device in WhatsApp settings. Bot receives a `loggedOut` disconnect but never shows a new QR code — just exits with a message telling the user to manually delete `data/session`.
**Root cause:** `connection.update` handler on `DisconnectReason.loggedOut` called `process.exit(1)` instead of clearing stale auth and reconnecting.
**Fix:**
- Import `rmSync` from `fs`
- On `loggedOut`, delete `./data/session` with `rmSync(..., { recursive: true, force: true })` then call `connect()` again
- `useMultiFileAuthState` finds no session → Baileys generates fresh QR → shown in terminal as normal
**File:** `src/whatsapp/client.js`

---

---

## Session 3 (continued) — 2026-06-08

### Bug: LLM prompt used wrong field names from style profile
**Symptom:** LLM receives `undefined` for tone and message length — quality of auto-replies would be degraded.
**Root cause:** `generator.js` referenced `profile.tone` and `profile.avgLength`, but `analyzeStyle()` returns `profile.styleNotes`, `profile.lengthCategory`, and `profile.avgWordCount`. Field names never matched.
**Fix:** Updated `buildSystemPrompt()` in `generator.js`:
- `profile.tone` → removed; `profile.styleNotes` used for the Style line
- `profile.avgLength` → `profile.lengthCategory` + `profile.avgWordCount`
**File:** `src/response/generator.js`

---

### Bug: historyStore (personality data) lost on restart
**Symptom:** After bot restart, `!activate [name]` always falls back to "no history found / generic style" even though history was synced in a prior session.
**Root cause:** `historyStore` was an in-memory `new Map()` — cleared on every restart. Baileys re-syncs history on connect but that takes a few seconds and the data is otherwise ephemeral.
**Fix:** Persisted `historyStore` to `data/message-history.json`:
- `loadHistoryStore()` loads on startup so history is immediately available
- `saveHistoryStore()` writes after `messaging-history.set` fires (bulk sync from WhatsApp)
- Timestamps normalized from Baileys Long objects to plain numbers for clean JSON serialization
- Capped at 500 messages per JID to keep file size reasonable
**File:** `src/whatsapp/client.js`

---

### Answer: Does the bot use past chats for personality?
**YES** — when `!activate [name]` is called and no profile exists, the bot:
1. Calls `client.getHistoryMessages(contact.jid, 200)` → reads up to 200 messages from `historyStore`
2. Converts with `fromBaileysMessages()` → extracts your sent messages (isMe=true)
3. Runs `analyzeStyle()` → detects language, tone, length, emoji use, common phrases
4. Saves profile to `data/bot.json` under the contact's JID

History comes from Baileys `syncFullHistory: true` on connect. With the persistence fix, this survives restarts. The profile is saved after first activation so subsequent activations are instant (no re-analysis needed unless profile is deleted).

---

---

### Feature: Personality persistence + weekly auto-refresh
**Requirement:** Style profile must survive restarts and stay fresh (rebuild weekly from latest history).
**Implementation:**
- `analyzedAt: Date.now()` stored on every saved profile
- On `!activate`, checks if profile is older than 7 days (`ONE_WEEK_MS`):
  - Fresh profile → skip rebuild, activate immediately
  - Stale profile → rebuild from latest historyStore messages, send "🔄 rebuilding" notice to self-chat
  - Stale + no history → keep old profile, warn user
  - No profile at all → build from scratch (existing behavior)
- historyStore is populated only from Baileys bulk sync (`messaging-history.set`) on connect — weekly rebuild reads from that snapshot, not live messages
**Files:** `src/commands/handler.js`, `src/whatsapp/client.js`

---

---

### Feature: Terminal activation animation
**Requirement:** On first activate (or weekly refresh), show a phased animation in the terminal reflecting what's happening.
**Implementation:** `Spinner` class in `handler.js` using braille dot frames, printing in-place with `\r`. Three phases with a minimum display time each (via `withMinTime` — runs work + timer in parallel, never slower than the work itself):
1. `⠋ Fetching chat history for [name]...` — 600ms min
2. `⠋ Reading your texting style (N messages)...` — 500ms min
3. `⠋ Fitting personality profile...` — 500ms min
4. `✅ Bot activated for [name] — 142 messages · short · English-Telugu mix`

WhatsApp gets a **single final message** only when everything is done (no intermediate chatty messages).
If profile is already fresh: activates silently (no spinner, just the WhatsApp "✅ Bot active" message).
**File:** `src/commands/handler.js`

---

---

### Feature: Parallel multi-account support
**Requirement:** Multiple contacts can be active simultaneously, each with their own independent personality and reply loop.
**Architecture change:** Replaced single `active_chat` (one slot) with `active_chats` map (JID → {jid, name}) in both SQLite and JSON stores.

New store methods: `addActiveChat`, `removeActiveChat`, `getActiveChatByJid`, `getActiveChats`, `clearAllActiveChats`.

Router now calls `store.getActiveChatByJid(jid)` — if the incoming JID is in the active set, it routes to the response generator. Multiple contacts can message simultaneously and each gets their own reply using their own profile + history.

Command changes:
- `!activate [name/phone]` — adds to active set (no limit); shows activation animation only on first-time or stale profiles
- `!deactivate` — deactivates ALL active bots
- `!deactivate [name/phone]` — deactivates specific contact only
- `!status` — lists all currently active bots

**Note:** Response generator and style profiles are already per-JID — no changes needed there.
**Files:** `src/state/store.js`, `src/whatsapp/router.js`, `src/commands/handler.js`

---

### Feature: Comprehensive personality prompt + richer style analysis
**Requirement:** Prompt must capture HOW the user communicates (style fingerprint), not WHAT they talk about. Explicitly separate personality from conversation context.

**New analyzer signals added to `analyzeStyle()`:**
- `capitalizationStyle` — "mostly lowercase" / "mixed case" / "normally capitalized"
- `punctuationStyle` — "rarely uses end punctuation" / "sometimes omits" / "normally punctuated"
- `abbreviations` — WhatsApp shorthand detected in their messages (u, bro, da, lol, idk, etc.)
- `sampleMessages` — 6 representative short messages (1–15 words) spread across history, used as direct style examples in the prompt

**Template substitutions:**
- `[userName]` = `client.getSelfName()` → actual WhatsApp display name (e.g. "Bhargav Dodla"), falls back to "the user" if unavailable. Previously broken (gave phone number from JID prefix).
- `[senderName]` = incoming message's `pushName` → the contact's display name. Only used in the two-line context header; the fingerprint sections are entirely profile-data-driven.
- All fingerprint fields come from `analyzeStyle()` output for that contact's JID.

**Finalized prompt template (with profile):**
```
You are [userName]. Reply to the incoming WhatsApp message from [senderName] in your own voice.
The style fingerprint below describes HOW you communicate — apply it regardless of the topic.

━━ COMMUNICATION FINGERPRINT ━━
Message length: short (avg 8 words). Tends to send 2.3 messages in a row instead of one long reply.
Capitalization: mostly lowercase.
Punctuation: rarely uses end punctuation.
Uses emoji occasionally (not on every message). Favourites: 😂 👍

━━ CODE-SWITCHING & LANGUAGE ━━
Naturally code-switches between English and Telugu mid-sentence — never forced, just how they actually talk. Common non-English words/expressions: da, ra, na, bro, cheppindi, vachadu.

━━ TONE & ENERGY ━━
Tone style: asks questions back to keep the conversation going, uses exclamations for emphasis.
Signature expressions & phrases: bro, da, okay, let me know, will do, same here.
Informal shorthand they use: u, k, bro, da, lol, idk.

REAL EXAMPLES of how they actually write (use these as a style reference, NOT content):
  "bro chill, will figure it out"
  "ya same here 😂"
  "okay da will check"
  "when r u free"
  "lol same"
  "idk man just go"

━━ RULES ━━
- You ARE Bhargav. You are NOT an AI, assistant, or bot.
- PERSONALITY OVER TOPIC: Adapt your STYLE (length, casing, punctuation, code-switching, emoji) to the fingerprint above. Do NOT try to reflect what topics they care about.
- CONTEXT: Read the conversation history to understand what to reply — then deliver that reply in the personality fingerprint above.
- Never be more formal, longer, or more polished than the fingerprint shows.
- Do not add greetings, sign-offs, or filler phrases unless the fingerprint shows them.
- Reply only with the message text. No quotes, no labels, no explanation.
```

**Fallback prompt (no profile):** Just asks the LLM to be natural, casual, brief, and match energy — no fingerprint applied.
**Files:** `src/style/analyzer.js`, `src/response/generator.js`

---

---

### Fix: historyStore per-JID cap + self-chat activation indicator
**Issues:**
1. historyStore had no per-JID cap — `messaging-history.set` can fire multiple times, each push unbounded. `getHistoryMessages(jid, 500)` caps what is *used* but not what is *stored*. Fixed: added `if (arr.length > 500) arr.splice(0, arr.length - 500)` after each push.
2. Self-chat only received the final "✅ ready" message. User had no feedback that adaptation was in progress. Fixed: added `⏳ Adapting personality for [name]...` sent immediately when build starts, before any analysis runs.

Self-chat flow on `!activate [name]` (first time or weekly refresh):
```
⏳ Adapting personality for Lakshmi...        ← sent immediately
✅ Bot ready for Lakshmi                       ← sent when done
📊 142 messages analysed · short · English-Telugu mix · emoji: occasional
```
**Files:** `src/whatsapp/client.js`, `src/commands/handler.js`

---

### Bug: Bot loading entire chat history instead of capping at 200 messages
**Symptom:** `[client] History synced: 1163 chats` — Baileys was downloading the full all-time history for every chat.
**Root cause:** `syncFullHistory: true` in `makeWASocket` options instructs WhatsApp to push the complete message history. We only need recent messages for the 200-message personality window.
**Fix:** Set `syncFullHistory: false`. Baileys will now only sync recent messages (last ~50–100 per chat), which is more than enough for personality analysis.
**File:** `src/whatsapp/client.js`

---

### Bug: Bot hangs indefinitely after history sync
**Symptom:** Terminal shows `[client] History synced: 1163 chats, saved to disk` then freezes.
**Root cause:** `saveHistoryStore()` was called after `messaging-history.set` — it iterated all 1163 chats, serialized up to 500 messages each, and called `writeFileSync` on the result. Potentially tens of MB written synchronously, blocking the Node.js event loop entirely.
**Fix:** Removed historyStore disk persistence entirely. historyStore is now in-memory only (`new Map()`), populated fresh from Baileys on every connect. The style *profile* (the output of analysis) was already persisted in `bot.json` — that's the only thing that needs to survive restarts.
- Added `historyReady` flag set to `true` after `messaging-history.set` fires
- Added `isHistoryReady()` method on client
- `!activate` now returns "⏳ still syncing, try again in a few seconds" if history isn't ready yet AND no existing profile exists
**Files:** `src/whatsapp/client.js`, `src/commands/handler.js`

---

---

### Bug: `!activate [phone]` immediately says bot not activated
**Symptom:** User runs `!activate 919876543210` right after connect and sees a "still syncing" message with no activation.
**Root cause:** An `isHistoryReady()` guard was added that blocked activation if `messaging-history.set` hadn't fired yet. Since this fires a few seconds after connect, any early `!activate` hit the early-return path and never called `store.addActiveChat`.
**Fix:** Removed the guard entirely. The handler already handles missing history gracefully — if no messages found, activates with generic style. The bot is always activated; profile quality depends on whether history has synced.
**Files:** `src/commands/handler.js`, `src/whatsapp/client.js`

---

---

### Bug: Bot not responding on activated chat
**Symptom:** Contact sends a message, bot stays silent.
**Fixes applied:**
1. `onMessage()` was called without `.catch()` in the Baileys event handler — any error in the router/generator chain became an unhandled promise rejection, potentially crashing the process silently. Fixed with `.catch(err => console.error(...))`.
2. Groq model `llama-3.1-70b-versatile` was deprecated in early 2025. Updated default to `llama-3.3-70b-versatile`. Override via `GROQ_MODEL` in `.env`.
3. Added console logs at router and generator entry points so the terminal shows exactly where a message goes: `[router] Active message from X → generating reply`, `[generator] Generating reply for X`, `[generator] Profile: found / none`.
**Files:** `src/whatsapp/client.js`, `src/whatsapp/router.js`, `src/response/generator.js`, `src/llm/index.js`

---

---

## Session 4 — 2026-06-08 — Full Bug Bash (4 parallel subagents)

Comprehensive sweep across all source files, dispatched 4 isolated subagents to fix in parallel. All changes integrate cleanly.

### Handler fixes (`src/commands/handler.js`)
- **CRASH:** `!contacts` was calling `.join('\n')` on an already-joined string → TypeError on every call. Removed redundant join.
- **!deactivate by name fails when activated by phone:** Added fallback name-search across `getActiveChats()` if JID lookup misses.
- **Unhandled exceptions in commands:** Wrapped `handle()` in try/catch, sends `⚠️ Command failed: …` to self-chat on error.
- **Spinner left running on error:** Wrapped phases in try/finally so `spinner.stop()` always fires.

### Client hardening (`src/whatsapp/client.js`)
- **Blocking I/O during bulk sync:** `savePersistedContacts` was writing on every `upsertContact` call (1163+ writes during `chats.set`). Added 2-second debounce.
- **JID-as-name pollution:** `senderName = pushName || remoteJid` saved full JID as contact name when pushName empty. Changed fallback to digit portion only.
- **Group/newsletter messages routed:** Added skip for `@newsletter` and `@g.us` JIDs in `messages.upsert` (kept `@lid` for self-chat).
- **Reconnect memory leak:** Old socket's event listeners weren't removed. Now calls `sock.ev.removeAllListeners()` + `sock.end?.()` before reconnect, and uses `setImmediate(...)` to break promise chain accumulation.
- **Graceful shutdown:** Added `client.close()` method that ends socket and flushes contacts synchronously.
- **`getSelfName` fallback chain:** Now `name → verifiedName → notify → null`.

### Store concurrency safety (`src/state/store.js`)
- **Per-call file I/O:** JSON store was reading + parsing `bot.json` on every method call. Now loaded once into in-memory `state`, all reads instant.
- **Race conditions:** Concurrent writes (multiple active contacts replying simultaneously) were losing data via read-modify-write. Now single in-memory state with debounced (300ms) async writes.
- **Schema migration:** Auto-migrates legacy `active_chat` (singular) to `active_chats` (plural) on load — no lost active chats on version upgrade.
- **Missing-field hardening:** `normalizeState()` ensures all four top-level keys exist on every load, regardless of file age/partial schema.
- **Atomic writes:** Writes to `.tmp` then renames, preventing corrupted JSON on mid-write crash.
- **Sync flush on shutdown:** `store.flush()` writes synchronously for SIGINT.

### Generator robustness (`src/response/generator.js` + `src/llm/groq.js`)
- **Empty LLM response:** Now throws `'LLM returned empty response'` instead of trying to send empty text.
- **LLM timeout:** 30-second timeout via `Promise.race` — no more hanging if Groq is slow.
- **Message deduplication:** Module-scoped `recentMessageIds` Set tracks last 100 `jid:timestamp:text-prefix` keys, prevents duplicate replies if Baileys re-fires `messages.upsert` for the same message.
- **Quote stripping:** Strips surrounding quotes the LLM sometimes adds despite prompt instructions.
- **Verified safe (no change):** Bot's `🤖 Replied to ...` self-chat notification can't recurse because the `fromMe && !startsWith('!')` filter in `messages.upsert` drops it.

### Wiring in `src/index.js`
- **Graceful shutdown:** SIGINT and SIGTERM now call `dashboard.stop()`, `store.flush()`, `client.close()` in order, with per-step error handling. `shuttingDown` flag prevents double-call.

---

---

### Feature: Live self-chat progress bar with elapsed timer
**Requirement:** Self-chat should show a live timer indicator during personality adaptation (not just terminal spinner).
**Implementation:** Single WhatsApp message that gets edited in place via Baileys' `edit` feature (cleaner than spamming multiple messages).
- `client.sendMessage()` now returns the WAMessage so caller can grab `msg.key`
- `client.editMessage(jid, key, text)` wraps `sock.sendMessage(jid, { text, edit: key })` — silently no-ops if editing isn't supported
- `handleActivate` sends initial message, then edits with progress block + elapsed seconds at each phase

Self-chat now shows (one message, updating live):
```
⏳ Adapting personality for Lakshmi
▱▱▱  0.0s  Starting...
```
↓ edited to ↓
```
⏳ Adapting personality for Lakshmi
▰▱▱  0.6s  📥 Loading chat history...
```
↓
```
⏳ Adapting personality for Lakshmi
▰▰▱  1.1s  🧠 Reading texting style (187 msgs)...
```
↓
```
⏳ Adapting personality for Lakshmi
▰▰▰  1.6s  ✨ Fitting personality profile...
```
↓ final ↓
```
✅ Bot ready for Lakshmi  (took 1.7s)
📊 142 messages analysed · short · English-Telugu mix · emoji: occasional
```

Falls back to sending new messages if the edit API fails on the user's WhatsApp version.
**Files:** `src/whatsapp/client.js`, `src/commands/handler.js`

---

---

## Session 4 (continued) — Cleanup Pass

### Critical integration bug found & fixed
**`src/dashboard/server.js`** was calling `store.getActiveChat()` (singular, old API removed in the parallel multi-account refactor). Every hit to `/api/status` would throw `TypeError`. Also filtered `msg.role === 'assistant'` but the store actually uses `role === 'bot'` — so recent replies would always be empty even if the call hadn't crashed.
**Fix:** Rewrote `/api/status` to use `store.getActiveChats()` (plural), aggregate bot replies across all active+profiled contacts, and filter on `role === 'bot'`. Returns `activeContacts: []` array instead of singular `activeContact`.

### Dead code & file removals
- **Deleted** `src/style/parser.js` — `parseWhatsAppExport` had no consumer in `src/` (only the removed `scripts/import-chat.js` used it).
- **Deleted** `src/llm/interface.js` — `validateProvider` was never imported anywhere.
- **Deleted** `scripts/import-chat.js` — orphaned after parser.js removal; was only consumer of parser; no `src/` import.
- **Removed** the `"import-chat"` npm script from `package.json` (would have been broken).

### Stale code removed
- **`migrateProfileToJid`** in `router.js` — was a no-op (profiles are always JID-keyed by the current `!activate` flow). Function definition + both call sites removed.
- Stale comment about "import-chat.js" in router.js removed with the function.

### Deliberately NOT changed
- `store.getProfile(senderName)` / `store.getProfile(contact.name)` fallback lookups in `generator.js` and `handler.js` — vestigial but no-op; removing them is a behavioral change (per cleanup brief: no behavior changes).
- SQLite store kept — it's a runtime-switched branch, not dead code (works as fallback if better-sqlite3 builds successfully).
- `llm/index.js` error message mentioning `ollama` — stale docs, not dead code.

### Final state
All source files pass syntax check. Grep for `migrateProfileToJid|parseWhatsAppExport|validateProvider|import-chat` in `src/` returns zero hits. The codebase is now coherent with the parallel multi-account, debounced-store, progress-bar feature set.

---

---

## Session 5 — 2026-06-08 — LID protocol fix (CRITICAL)

### Bug: Bot ignores all incoming messages — "Ignored message from Maha (88983166029846@lid) — not in active set"
**Root cause:** WhatsApp's new **LID (link id)** protocol. Same contact has two JID forms:
- `919876543210@s.whatsapp.net` (phone JID — what `!activate` constructs when user gives a phone number)
- `88983166029846@lid` (the link-id — what incoming messages actually arrive under in newer WA versions)

These never match by string equality, so every incoming message from contacts using the LID protocol was dropped at the router with "not in active set". Also: `searchContacts` was filtering out `@lid` JIDs entirely, so name-based activation couldn't find contacts that only had an LID.

### Fix (full end-to-end)

**`src/whatsapp/client.js`:**
- Added `jidAliasMap` — bidirectional Map tracking LID ↔ phone-JID pairs
- In `messages.upsert`, extract `key.senderPn` (the phone JID Baileys provides alongside the LID), record the alias, and upsert the contact under both JIDs
- Pass `altJid: senderPn` through to `onMessage(...)`
- Added `client.getAltJid(jid)` accessor
- `searchContacts` no longer filters `@lid` — they're valid personal chats. Filters bot's own self-chat JID instead. Dedupes results by display name (since same contact appears under both JIDs)

**`src/whatsapp/router.js`:**
- Active-chat match now tries: `jid` → `altJid` → `client.getAltJid(jid)` in order
- Logs which JID matched: `[router] Active message ... → matched as <jid>`
- Improved ignore log shows both JIDs

**`src/commands/handler.js`:**
- `!activate` now stores active chat under BOTH the resolved JID AND its alias (if known) — so matching works even if messages arrive under the unexpected form
- `!deactivate [name]` uses new `removeAllAliases()` helper that removes every active entry sharing the JID, an alias of it, or the same display name
- `!deactivate` (no args) deduplicates the deactivation message
- `!status` dedupes by display name so users don't see "Active bots (2): • Maha • Maha"
- Added explicit console logs: `[handler] Activated/Deactivated X — JIDs: ...`

### Why this also fixes "bot says active after deactivate"
The bot was activated under JID-A, then a message arrived from JID-B (the LID), got ignored at router, never replied. When user did `!deactivate Maha`, the OLD code tried `getActiveChatByJid(contact.jid)` (the JID the user resolved Maha to — which may or may not match what was stored). With `removeAllAliases`, every related entry is now wiped regardless of which JID form the user used.
**Files:** `src/whatsapp/client.js`, `src/whatsapp/router.js`, `src/commands/handler.js`

---

## Current known issues / next steps

1. **Verify end-to-end**: `!activate [name]` → contact messages → bot auto-replies with correct style. All bugs above fixed but untested with a live reply.
2. **Existing `data/bot.json`** will have old `active_chat` key — harmless (ignored), but active chats from before this change won't carry over. Re-activate manually.
3. **TASK-13: Ollama provider** (Phase 2) — not started. Groq is working fine for now.

---

## File map (files most likely to need changes)

| File | Purpose |
|------|---------|
| `src/index.js` | Entry point, console.error noise filter |
| `src/whatsapp/client.js` | Baileys connection, chatsStore/contactsStore/historyStore, searchContacts |
| `src/whatsapp/router.js` | Routes messages to command handler or response generator, LID fix |
| `src/commands/handler.js` | !activate, !deactivate, !status, !contacts |
| `src/state/store.js` | JSON-backed state (SQLite unavailable on Windows without VS Build Tools) |
| `src/response/generator.js` | Calls LLM to generate reply in user's style |
| `src/style/analyzer.js` | Detects message length, language mix, emoji frequency |
| `src/style/from-baileys.js` | Converts Baileys WAMessage objects to style analyzer format |
| `.env` | GROQ_API_KEY, COMMAND_JID — never commit |
