# TASK-08 — WhatsApp Chat Export Parser
**Recommended model:** Sonnet  
**Dependencies:** TASK-01 (scaffold)  
**Note:** This task is independent of the WhatsApp client — can run in parallel with TASK-02/03/04.

---

## Goal
Parse the `.txt` file that WhatsApp generates when you export a chat (Settings → Chat → Export Chat → Without Media). Extract messages, separate by sender, and return structured data.

## File to Create: `src/style/parser.js`

## WhatsApp Export Format

WhatsApp exports look like this (format varies slightly by region/version):
```
[DD/MM/YYYY, HH:MM:SS] Sender Name: Message text here
[DD/MM/YYYY, HH:MM:SS] Sender Name: Another message
[DD/MM/YYYY, HH:MM:SS] Sender Name: Multi-line messages
continue on next line without a timestamp
[01/01/2024, 10:30:00] You: My reply here
```

Some variations:
- `M/D/YY, H:MM AM/PM` (US format)
- `DD/MM/YY, HH:MM` (no seconds)
- System messages: `[timestamp] Messages and calls are end-to-end encrypted...` (no sender colon pattern — skip these)
- Media: `[timestamp] Sender: <Media omitted>` — skip these
- Deleted: `[timestamp] Sender: This message was deleted` — skip these

## Interface This Module Must Export

```js
export function parseWhatsAppExport(filePath, myName)
// myName: the name you appear as in the export (e.g. "Bhargav" or your number)
// Returns: { messages: [...], contactName: string, myName: string }
```

### Return Structure
```js
{
  contactName: "Mom",    // The other person's name (most frequent non-myName sender)
  myName: "Bhargav",    // As passed in
  messages: [
    {
      timestamp: Date,
      sender: "Mom",          // raw sender name from export
      text: "Hey how are you?",
      isMe: false             // true if sender matches myName
    },
    {
      timestamp: Date,
      sender: "Bhargav",
      text: "Good! You?",
      isMe: true
    }
  ]
}
```

## Parsing Strategy

1. Read file as UTF-8 (handle BOM if present: strip `﻿`)
2. Split into lines
3. Build a regex to match message start lines:
   ```
   /^\[?(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]?\s+-?\s+([^:]+):\s(.+)/i
   ```
4. For each line:
   - If it matches the pattern → start a new message
   - If it doesn't match AND there's a current message → append as continuation (multi-line)
5. Filter out:
   - Lines where text is `<Media omitted>`, `This message was deleted`, `null`, or matches system message patterns
6. Parse timestamps with multiple format attempts (try DD/MM/YYYY then MM/DD/YYYY)

## Acceptance Criteria
- Correctly parses both DD/MM/YYYY and MM/DD/YYYY timestamp formats
- Multi-line messages are joined correctly
- Media and deleted messages are filtered out
- `isMe` is set correctly based on `myName` parameter
- `contactName` is inferred as the most frequent non-myName sender
- Returns empty `messages: []` gracefully if file is unreadable or empty
- Handles UTF-8 BOM at start of file
