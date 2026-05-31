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

## Always Read Before Touching Code

**`UserFeedbackUpdates.md`** — full bug history, fixes applied, and what's still broken.
This is the most important file to read. Do not skip it.

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
