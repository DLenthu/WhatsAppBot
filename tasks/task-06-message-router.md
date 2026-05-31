# TASK-06 — Message Router
**Recommended model:** Haiku  
**Dependencies:** TASK-02 (WhatsApp client), TASK-03 (state store), TASK-05 (command handler)

---

## Goal
Route every incoming message to the right handler. Self-chat messages go to the command handler. Messages from the active contact trigger the response generator. All other messages are ignored (user handles them manually).

## File to Create: `src/whatsapp/router.js`

## Interface This Module Must Export

```js
export function createMessageRouter({ store, commandHandler, onActiveMessage })

// Returns object with:
// router.route(message) → Promise<void>
//   message: { jid, senderName, text, timestamp }
```

The `onActiveMessage` callback is called when a message arrives from the active contact:
```js
onActiveMessage({ jid, senderName, text, timestamp })
```
This callback will be provided by the response generator (TASK-07).

## Routing Logic

```
Incoming message { jid, senderName, text, timestamp }

1. Is this from self-chat (jid === selfJid)?
   YES → commandHandler.handle({ jid, text })
         → store contact hint: store.saveContactHint(senderName, jid)  [skip for self-chat]
         → return

2. Is this from the active contact? (store.getActiveChat()?.jid === jid)
   YES → store.saveContactHint(senderName, jid)
         → store.appendMessage({ jid, role: 'user', text, timestamp })
         → onActiveMessage({ jid, senderName, text, timestamp })
         → return

3. Otherwise:
   → store.saveContactHint(senderName, jid)  [learn contact for future !activate]
   → ignore (do nothing)
```

## Notes

- `store.saveContactHint` must be added to the state store (TASK-03). It stores `name → jid` mappings so `!activate [name]` can resolve contacts. Add it as: `store.saveContactHint(name, jid)` and `store.resolveContact(nameQuery) → { jid, name } | null`
- The router does NOT send replies — that is TASK-07's responsibility
- The router does NOT generate responses — it only routes

## Acceptance Criteria
- Self-chat messages route to command handler only
- Messages from active contact: stored in history AND trigger `onActiveMessage`
- Messages from non-active contacts: contact hint saved, nothing else happens
- Router never sends messages itself
- `store.saveContactHint` is called for every non-self-chat message to build the contact directory
