# WhatsAppBot — Session Context

Read this at the start of every session. Do not ask the user to re-explain the project.

## What This Is

A WhatsApp bot that learns the user's texting style per-contact and auto-replies as them.
Built with Baileys (multi-device companion protocol), Groq LLM (llama-3.1-70b-versatile), Node.js ESM.

**Core loop:**
1. User types `!activate [name or phone]` in their "Bhargav (You)" WhatsApp self-chat
2. Bot activates for that contact
3. When that contact messages the user, bot auto-replies in the user's style
4. User types `!deactivate` to stop

## Architecture (all tasks complete except TASK-13)

```
src/index.js              — entry point, wires everything
src/whatsapp/client.js    — Baileys connection, contact learning, message dispatch
src/whatsapp/router.js    — routes messages → command handler or response generator
src/commands/handler.js   — !activate, !deactivate, !status, !contacts
src/response/generator.js — builds prompt, calls Groq, sends reply
src/llm/groq.js           — Groq API wrapper
src/style/analyzer.js     — extracts tone/length/language from message history
src/style/from-baileys.js — converts Baileys WAMessage → style analyzer format
src/state/store.js        — JSON-backed state (SQLite unavailable on Windows, no build tools)
src/dashboard/server.js   — Express status dashboard on port 3000
```

## Key Config

- `.env` — never commit. Contains `GROQ_API_KEY` and `COMMAND_JID=68719577423981@lid`
- Command chat: "Bhargav (You)" self-chat, JID is LID format (`@lid`), not phone JID
- Bot confirmations always go to `client.getSelfJid()` (the `@s.whatsapp.net` JID)

## Always Do at Session Start

### 1. Read project context
Invoke the project context skill immediately:
```
/whatsappbot-context
```
This reads `UserFeedbackUpdates.md` and gives a compressed briefing of what works, what's broken, and what not to repeat. Do not skip it.

### 2. Start auto-commit cron (REQUIRED — do this every session without being asked)
Immediately after loading context, schedule the 3-minute auto-commit job:
```
CronCreate: cron="*/3 * * * *", recurring=true
prompt: "Auto-commit any uncommitted changes in C:\Users\dodla\Downloads\WhatsAppBot.
Run: git -C \"C:\\Users\\dodla\\Downloads\\WhatsAppBot\" add -A && git -C \"C:\\Users\\dodla\\Downloads\\WhatsAppBot\" diff --cached --quiet || git -C \"C:\\Users\\dodla\\Downloads\\WhatsAppBot\" commit -m \"Auto-save progress: $(date +'%Y-%m-%d %H:%M')\" --no-gpg-sign.
Only commit if there are actual staged changes. Do not push."
```
Do not wait for the user to ask. Do not mention it unless it fails.

## Persistent Memory Notes

- Contact names learned from incoming messages are saved to `data/contacts.json`
- `!activate` accepts both names (partial match) and phone numbers (e.g. `!activate 919876543210`)
- Style profiles saved in `data/state.json` keyed by JID
- SQLite is disabled — all state is JSON files in `data/`

## Current Status

- `!activate` / `!deactivate` / `!status` / `!contacts` — all working
- Contact resolution: works by phone number immediately; by name after first message received
- Groq API: wired up, not yet verified end-to-end (reply loop not tested)
- TASK-13 (Ollama): not started
