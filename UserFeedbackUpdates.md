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

## Current known issues / next steps

1. **Verify `!contacts` lists ALL chats** after `chats.set` sync — user needs to restart and test.
2. **Verify `!activate [name]` works end-to-end** after contact resolution fix — activate → receive message → auto-reply in style.
3. **TASK-13: Ollama provider** (Phase 2) — not started. Groq is working fine for now.
4. **Style profile quality** — untested end-to-end. The `analyzeStyle` + `fromBaileysMessages` pipeline needs a real activation to verify output quality.

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
