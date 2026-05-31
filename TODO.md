# WhatsAppBot — Implementation Checklist

> Full design spec: `docs/superpowers/specs/2026-05-31-whatsappbot-design.md`
> Each task has a dedicated file in `tasks/` with full context for parallel agent execution.

---

## Phase 1 — Project Foundation

- [ ] **TASK-01** — Project scaffold (package.json, folder structure, .env) → `tasks/task-01-project-scaffold.md` *(Haiku)*
- [ ] **TASK-02** — WhatsApp client via Baileys (QR auth, session, send/receive) → `tasks/task-02-whatsapp-client.md` *(Sonnet)*
- [ ] **TASK-03** — SQLite state store (active chat, message history, profiles) → `tasks/task-03-state-store.md` *(Haiku)*
- [ ] **TASK-04** — LLM provider interface + Groq implementation → `tasks/task-04-groq-provider.md` *(Haiku)*

## Phase 2 — Core Bot Logic

- [ ] **TASK-05** — Command handler (self-chat: !activate, !deactivate, !status) → `tasks/task-05-command-handler.md` *(Haiku)*
- [ ] **TASK-06** — Message router (route incoming messages to response generator) → `tasks/task-06-message-router.md` *(Haiku)*
- [ ] **TASK-07** — Response generator (prompt assembly + LLM call + send reply) → `tasks/task-07-response-generator.md` *(Sonnet)*

## Phase 3 — Style Learning

- [ ] **TASK-08** — WhatsApp chat export parser (.txt → structured messages) → `tasks/task-08-chat-export-parser.md` *(Sonnet)*
- [ ] **TASK-09** — Style analyzer (extract tone, vocabulary, language patterns) → `tasks/task-09-style-analyzer.md` *(Sonnet)*
- [ ] **TASK-10** — Import CLI script (node scripts/import-chat.js [file] [contact]) → `tasks/task-10-import-script.md` *(Haiku)*

## Phase 4 — Dashboard & Wiring

- [ ] **TASK-11** — Web dashboard (Express + HTML, status page, active chat) → `tasks/task-11-web-dashboard.md` *(Haiku)*
- [ ] **TASK-12** — Main entry point (wire all components in src/index.js) → `tasks/task-12-main-entry.md` *(Sonnet)*

## Phase 5 — Local LLM (later)

- [ ] **TASK-13** — Ollama LLM provider (swap Groq → local model via config) → `tasks/task-13-ollama-provider.md` *(Haiku)*

---

## Dependency Order for Parallel Execution

```
TASK-01 (scaffold)
  ├── TASK-02 (WhatsApp client)    ─┐
  ├── TASK-03 (state store)         ├─ parallel
  ├── TASK-04 (Groq LLM)           ─┘
  └── TASK-08 (export parser)      ─┐ parallel with above
      └── TASK-09 (style analyzer)  │
          └── TASK-10 (import CLI)  ┘

After TASK-02 + TASK-03:
  ├── TASK-05 (command handler)    ─┐
  └── TASK-06 (message router)    ─┘ parallel

After TASK-04 + TASK-03:
  └── TASK-07 (response generator)

After TASK-03:
  └── TASK-11 (dashboard)

After ALL above:
  └── TASK-12 (main entry — wires everything)

Anytime after TASK-04:
  └── TASK-13 (Ollama provider — drop-in swap)
```

---

## Progress Key

- [ ] Not started
- [~] In progress
- [x] Complete
