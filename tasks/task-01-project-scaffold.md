# TASK-01 — Project Scaffold
**Recommended model:** Haiku  
**Dependencies:** None (do this first)

---

## Goal
Create the complete project structure, install all dependencies, and set up config files. No logic — just scaffolding.

## Files to Create

### `package.json`
```json
{
  "name": "whatsappbot",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "import-chat": "node scripts/import-chat.js"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.0",
    "better-sqlite3": "^9.4.3",
    "groq-sdk": "^0.7.0",
    "express": "^4.18.2",
    "qrcode-terminal": "^0.12.0",
    "dotenv": "^16.4.5",
    "pino": "^8.19.0",
    "pino-pretty": "^11.0.0"
  }
}
```

### Folder structure to create (empty, with `.gitkeep`):
```
src/
src/whatsapp/
src/commands/
src/llm/
src/style/
src/response/
src/state/
src/dashboard/
src/dashboard/public/
data/
data/exports/
data/profiles/
scripts/
tasks/         (already exists)
docs/          (already exists)
```

### `.env.example`
```
# LLM Provider: groq or ollama
LLM_PROVIDER=groq

# Groq API key (get free at console.groq.com)
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.1-70b-versatile

# Ollama (Phase 2 - leave blank for now)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Dashboard
DASHBOARD_PORT=3000

# WhatsApp session storage path
SESSION_PATH=./data/session
```

### `.gitignore`
```
node_modules/
.env
data/session/
data/exports/
*.db
```

## Acceptance Criteria
- `npm install` runs without errors
- All folders exist
- `.env.example` is present
- `.gitignore` excludes secrets and session data
- No logic files — only scaffolding
