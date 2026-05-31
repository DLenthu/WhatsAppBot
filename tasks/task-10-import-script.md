# TASK-10 — Chat Import CLI Script
**Recommended model:** Haiku  
**Dependencies:** TASK-03 (state store), TASK-08 (parser), TASK-09 (style analyzer)

---

## Goal
A simple CLI script that takes a WhatsApp export .txt file, parses it, analyzes the user's style, and saves the profile to the database. Run once per contact before activating the bot for them.

## File to Create: `scripts/import-chat.js`

## Usage
```bash
node scripts/import-chat.js <path-to-export.txt> <your-name-in-export> [contact-jid]
```

Examples:
```bash
node scripts/import-chat.js "data/exports/chat-with-mom.txt" "Bhargav"
node scripts/import-chat.js "data/exports/chat-with-mom.txt" "Bhargav" "919876543210@s.whatsapp.net"
```

The `contact-jid` is optional. If not provided, the script saves the profile keyed by the contact's name (JID will be linked when first message arrives).

## Script Flow

```
1. Read args: filePath, myName, contactJid (optional)
2. Validate file exists and is .txt
3. Parse: parseWhatsAppExport(filePath, myName)
4. Print summary:
   "📊 Parsed [N] messages from [contactName]"
   "   Your messages: [M]"
   "   Date range: [first date] → [last date]"
5. Analyze: analyzeStyle(parsedExport)
6. Print profile preview:
   "✅ Style profile generated:"
   "   Language: [language]"
   "   Avg message length: [lengthCategory] (~[avgWordCount] words)"
   "   Emoji usage: [emojiFrequency]"
   "   Common phrases: [commonPhrases.slice(0,5).join(', ')]"
   "   Style notes: [styleNotes]"
7. Save: store.saveProfile(contactJid || contactName, profile)
8. Print: "💾 Profile saved for [contactName]"
```

## State Store Adaptation

If `contactJid` is not provided, use the contact name as the key temporarily. The message router (TASK-06) will call `store.saveContactHint(name, jid)` when the first message from that contact arrives — at that point the profile can be re-keyed. For v1, the response generator (TASK-07) should also try looking up profile by name if JID lookup fails.

## Acceptance Criteria
- Script runs with `node scripts/import-chat.js`
- Clear error message if file not found or not a .txt
- Prints a readable summary of what was found
- Profile is saved to SQLite and persists across restarts
- Works for the nominal case (a real WhatsApp export file)
