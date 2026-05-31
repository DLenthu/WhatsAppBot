# TASK-05 — Command Handler
**Recommended model:** Haiku  
**Dependencies:** TASK-02 (WhatsApp client), TASK-03 (state store)

---

## Goal
Parse and execute commands typed in the user's self-chat. Commands control bot activation and status. The handler must resolve contact names to JIDs and send confirmation messages back to self-chat.

## File to Create: `src/commands/handler.js`

## Interface This Module Must Export

```js
export function createCommandHandler({ store, client })

// Returns object with:
// handler.handle({ jid, text }) → Promise<boolean>
//   Returns true if message was a command (caller should not process further)
//   Returns false if not a command
```

## Commands to Support

| Command | Action |
|---|---|
| `!activate [name]` | Activate bot for contact matching [name] |
| `!deactivate` | Deactivate bot for current active chat |
| `!status` | Report current active contact or "inactive" |

Commands are **case-insensitive**. Leading/trailing whitespace is trimmed.

## Contact Resolution

When user types `!activate Mom`, we need to resolve "Mom" to a WhatsApp JID. Strategy:
1. Call `client.getContactName(jid)` for all known contacts — but Baileys doesn't expose a contact list easily
2. Better: maintain a simple name→JID map by learning from incoming messages. Store in state.
3. For v1: require user to use the exact phone number OR the display name as Baileys knows it

**Pragmatic v1 approach:**
- Add a method `store.saveContactHint(name, jid)` called whenever a message arrives (TASK-06 will call this)
- `!activate [name]` searches saved contact hints (case-insensitive partial match)
- If no match found: reply "❌ No contact found for '[name]'. Wait for a message from them first, then try again."

## Confirmation Messages

Send to self-JID (`client.getSelfJid()`):

- Activation success: `✅ Bot active for [Name]`
- Deactivation: `🔴 Bot off for [Name]`
- Already active: `ℹ️ Already active for [Name]. Use !deactivate first.`
- Not active (on !deactivate): `ℹ️ Bot is not currently active.`
- Status when active: `🤖 Bot active for: [Name]`
- Status when inactive: `💤 Bot is inactive.`
- Contact not found: `❌ No contact found for '[name]'. Wait for a message from them first, then try again.`

## Acceptance Criteria
- `!activate Mom` sets active chat when Mom's JID is known, confirms to self-chat
- `!deactivate` clears active chat, confirms to self-chat
- `!status` replies with current state
- Commands are detected regardless of case (`!ACTIVATE`, `!Activate` all work)
- Non-command messages return `false` immediately without side effects
- Self-chat messages that ARE commands return `true`
