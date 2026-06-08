# Stable Versions

A running log of known-good checkpoints. Each entry includes a brief of what worked, the git tag, and how to roll back.

When adding a new entry, append to the top — newest first.

---

## stable-2026-06-08

**Commit:** `d536eca` — "Quiet self-chat: only !activate/!deactivate surface there"
**Branch:** `main`

### What works in this version

**Core loop**
- `!activate [name or phone]` activates the bot for a contact. Builds a per-contact personality profile from up to 500 recent messages of chat history (auto-refreshed weekly).
- `!deactivate [name]` removes one contact; `!deactivate` (no arg) removes all.
- `!status` shows currently active bots (deduped by display name).
- `!contacts [query]` lists/filters known synced contacts.

**Parallel multi-account**
- Multiple contacts can be active simultaneously; each gets its own profile + reply loop.

**LID protocol support**
- Handles WhatsApp's new `@lid` JID format. Tracks LID ↔ phone-JID aliases via `key.senderPn`. Active chats stored under both forms so matching works regardless of which arrives.

**Personality prompt**
- Comprehensive style fingerprint: message length, language/code-switching, capitalization, punctuation habits, common phrases, abbreviations, emoji frequency, and 6 real message samples. Explicitly separates style (HOW) from topic/content (WHAT).
- Uses Groq with `llama-3.3-70b-versatile` (configurable via `GROQ_MODEL` in `.env`).

**Robustness**
- 30s LLM timeout, empty-response guard, quote stripping
- Message deduplication (prevents double-replies on Baileys re-fires)
- In-memory state cache with 300ms debounced atomic writes (.tmp + rename)
- 2s debounced contact persistence (no blocking writes during bulk sync)
- Graceful SIGINT/SIGTERM shutdown (store.flush + client.close)
- Auto QR re-pairing on device-forget
- Reconnect with old-socket cleanup

**Self-chat UX**
- Live progress indicator during activation (edits a single message in place with progress bar + elapsed timer)
- Only `!activate`/`!deactivate`/`!status`/`!contacts` surface in self-chat — no per-reply previews, no per-error notifications
- Terminal still logs everything via `[router]`/`[generator]`/`[client]`/`[handler]` prefixes

### How to roll back to this version

```bash
git reset --hard stable-2026-06-08
```

Or to check it out without resetting main:
```bash
git checkout stable-2026-06-08
```

Or to view what's in this version without checking out:
```bash
git show stable-2026-06-08
```

### Configuration at this version
- `.env`: `LLM_PROVIDER=groq`, `GROQ_MODEL=llama-3.3-70b-versatile`, `COMMAND_JID=68719577423981@lid`, `DASHBOARD_PORT=3000`
- Dashboard: `http://localhost:3000`
- State files: `data/bot.json`, `data/contacts.json`, `data/session/` (Baileys auth)

### Known limitations at this version
- First few seconds after bot start: name-based `!activate` may miss until Baileys sync completes — phone-number activation works instantly
- If Baileys doesn't sync history for a contact, profile falls back to generic style (still functional, less personalised)
- SQLite store branch is present but disabled on Windows (no build tools) — JSON store is what runs

---
