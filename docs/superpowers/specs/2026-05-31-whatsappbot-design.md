# WhatsAppBot Design Spec
**Date:** 2026-05-31  
**Status:** Approved

---

## Clarifying Questions & Answers

**Q: Where do you want this bot to run?**  
A: Home laptop/PC (always-on or when needed). Bot runs as a Node.js process on the laptop.

**Q: Is building for WhatsApp Web mode enough, or do we need phone-specific changes?**  
A: Yes — Baileys links as a companion device (like WhatsApp Web), which works regardless of whether the user is on phone or laptop. No phone-specific changes needed for core functionality.

**Q: The "@myself activate" command — should it be intercepted before sending?**  
A: Yes, must NOT be sent to the recipient. Solution: user types the command in their self-chat (message yourself). It never reaches any contact.

**Q: Scope — one active chat at a time or multiple?**  
A: One active chat at a time to start. Extendable to multiple later.

**Q: How should the bot know your style?**  
A: Phase 1 — analyze past WhatsApp chat exports (.txt). Phase 2 — add persona prompts on top of history analysis.

**Q: LLM — local or cloud?**  
A: Phase 1 — Groq free API tier (Llama 3.1 70B). Phase 2 — swap to Ollama (local). LLM layer is pluggable.

**Q: Does the Claude $20/month subscription or ChatGPT Go subscription give API access?**  
A: No — those are consumer subscriptions, not API access. Groq has a free API tier that works for this use case.

**Q: Indicator for active chats?**  
A: Self-chat confirmation messages. When bot activates: "✅ Bot active for Mom". When it replies: "🤖 Replied to Mom: [preview]". When deactivated: "🔴 Bot off for Mom".

---

## Architecture Overview

The system runs entirely on the user's laptop as a Node.js process. It links to the WhatsApp account as a companion device via **Baileys** — no browser, just a one-time QR scan. The phone uses WhatsApp normally; the bot listens silently alongside it.

### Components

1. **WhatsApp Client** (`src/whatsapp/client.js`)  
   Baileys connection manager. Handles QR code auth, reconnection, session persistence. Exposes `sendMessage(jid, text)` and an event emitter for incoming messages.

2. **Command Handler** (`src/commands/handler.js`)  
   Watches the self-chat JID for commands. Parses and executes:
   - `!activate [contact name]` → sets active chat, confirms to self-chat
   - `!deactivate` → clears active chat, confirms to self-chat
   - `!status` → replies with current active contact or "inactive"

3. **Message Router** (`src/whatsapp/router.js`)  
   On every incoming message: checks if sender matches active contact. If yes → triggers Response Generator. If no → ignores (lets user reply manually).

4. **Style Profiler** (`src/style/`)  
   - `parser.js` — reads WhatsApp `.txt` export, splits messages by sender, extracts user's own messages
   - `analyzer.js` — detects: avg message length, vocabulary patterns, emoji frequency, language mixing (e.g. Telugu/English), common phrases, tone markers
   - Outputs `style_profile.json` per contact, stored in `data/profiles/`

5. **Response Generator** (`src/response/generator.js`)  
   Assembles system prompt: style profile + persona (Phase 2) + last 10 messages as context + incoming message. Calls LLM Provider. Returns generated reply.

6. **LLM Provider** (`src/llm/`)  
   - `interface.js` — abstract base: `generate(systemPrompt, messages) → string`
   - `groq.js` — Groq SDK implementation (Phase 1)
   - `ollama.js` — Ollama local implementation (Phase 2)
   - Active provider set via `LLM_PROVIDER=groq|ollama` in `.env`

7. **State Store** (`src/state/store.js`)  
   SQLite via `better-sqlite3`. Tables:
   - `active_chat`: current active contact JID + name
   - `style_profiles`: contact → profile JSON
   - `message_history`: last N messages per contact (rolling window)

8. **Web Dashboard** (`src/dashboard/`)  
   Express server + simple HTML page. Shows: active chat, list of contacts with loaded profiles, recent bot replies. Accessible from phone browser on same WiFi at `http://[laptop-ip]:3000`.

---

## Data Flow

### Activation
```
User types "!activate Mom" in self-chat
  → WhatsApp Client receives it
  → Command Handler: resolve "Mom" to contact JID
  → State Store: set active_chat = Mom's JID
  → WhatsApp Client: send "✅ Bot active for Mom" to self-chat
```

### Reply cycle
```
Mom sends a message
  → Message Router: active contact? yes
  → Response Generator:
      - fetch style_profile[Mom] from State Store
      - fetch last 10 messages[Mom] from State Store
      - build prompt
  → Groq API → generated reply text
  → WhatsApp Client: sendMessage(Mom's JID, reply)
  → State Store: append reply to message_history[Mom]
  → WhatsApp Client: send "🤖 Replied to Mom: [first 50 chars]" to self-chat
```

### Deactivation
```
User types "!deactivate" in self-chat
  → Command Handler: clear active_chat
  → WhatsApp Client: send "🔴 Bot off for Mom" to self-chat
```

---

## File Structure

```
WhatsAppBot/
├── src/
│   ├── index.js                # Entry point, wires all components
│   ├── whatsapp/
│   │   ├── client.js           # Baileys connection + auth
│   │   └── router.js           # Incoming message routing
│   ├── commands/
│   │   └── handler.js          # Self-chat command parsing
│   ├── llm/
│   │   ├── interface.js        # Abstract LLMProvider
│   │   ├── groq.js             # Groq implementation
│   │   └── ollama.js           # Ollama implementation (Phase 2)
│   ├── style/
│   │   ├── parser.js           # WhatsApp .txt export parser
│   │   └── analyzer.js         # Style feature extraction
│   ├── response/
│   │   └── generator.js        # Prompt assembly + LLM call
│   ├── state/
│   │   └── store.js            # SQLite state management
│   └── dashboard/
│       ├── server.js           # Express server
│       └── public/index.html   # Status dashboard UI
├── data/
│   ├── exports/                # Drop WhatsApp .txt exports here
│   └── profiles/               # Generated style_profile.json files
├── scripts/
│   └── import-chat.js          # CLI: node scripts/import-chat.js [file]
├── .env.example
├── package.json
└── TODO.md
```

---

## Tech Stack

| Layer | Library | Reason |
|---|---|---|
| WhatsApp protocol | `@whiskeysockets/baileys` | Lightweight, no browser, multi-device |
| State storage | `better-sqlite3` | Simple, local, fast |
| LLM (Phase 1) | `groq-sdk` | Free tier, fast inference |
| LLM (Phase 2) | Ollama REST API | Local, private |
| Web dashboard | `express` | Minimal, familiar |
| Runtime | Node.js 20+ | Baileys requirement |

---

## Phases

| Phase | Description |
|---|---|
| 1 | Core bot: Baileys + command handler + Groq responses (no style learning yet) |
| 2 | Style learning: chat export parser + analyzer + style-aware prompts |
| 3 | Persona prompts: user-written persona layered on top of style profiles |
| 4 | Ollama swap: replace Groq with local model via config change |
| 5 | Multi-chat: support multiple simultaneously active contacts |

---

## Error Handling

- Baileys disconnects: auto-reconnect with exponential backoff, notify self-chat on failure
- Groq API errors: retry once, then notify self-chat "⚠️ Bot failed to reply to Mom"
- Unknown contact in `!activate`: reply to self-chat "❌ Contact not found: [name]"
- No style profile loaded: use generic style prompt, warn in self-chat

---

## Out of Scope (v1)

- iOS phone app (companion device approach covers this natively)
- Voice message handling
- Group chat activation
- Multi-user (single user only)
