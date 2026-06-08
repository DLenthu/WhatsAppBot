import { analyzeStyle } from '../style/analyzer.js'
import { fromBaileysMessages } from '../style/from-baileys.js'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

class Spinner {
  constructor() {
    this.i = 0
    this.timer = null
  }

  start(label) {
    this.stop()
    this.timer = setInterval(() => {
      process.stdout.write(`\r${SPINNER_FRAMES[this.i++ % SPINNER_FRAMES.length]}  ${label}   `)
    }, 80)
  }

  done(label) {
    this.stop()
    process.stdout.write(`\r✅ ${label}\n`)
  }

  warn(label) {
    this.stop()
    process.stdout.write(`\rℹ️  ${label}\n`)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

// Runs work and a minimum timer in parallel — each phase stays visible for at least `ms` ms.
async function withMinTime(ms, fn) {
  const [result] = await Promise.all([Promise.resolve(fn()), new Promise(r => setTimeout(r, ms))])
  return result
}

export function createCommandHandler({ store, client }) {
  async function handle({ jid, text }) {
    try {
      if (!text || typeof text !== 'string') return false

      const trimmed = text.trim()
      const parts = trimmed.split(/\s+/)
      const command = parts[0].toLowerCase()
      const args = parts.slice(1).join(' ')

      if (command === '!activate')   return await handleActivate(args)
      if (command === '!deactivate') return await handleDeactivate(args)
      if (command === '!status')     return await handleStatus()
      if (command === '!contacts')   return await handleContacts(args)

      return false
    } catch (err) {
      try {
        await client.sendMessage(client.getSelfJid(), `⚠️ Command failed: ${err.message}`)
      } catch (sendErr) {
        console.error('Command failed and error reply also failed:', err, sendErr)
        return false
      }
      return false
    }
  }

  async function handleActivate(nameQuery) {
    if (!nameQuery) {
      await client.sendMessage(client.getSelfJid(), 'Usage: !activate [name or phone number]')
      return true
    }

    const contact = store.resolveContact(nameQuery) ?? client.resolveContact(nameQuery)
    if (!contact) {
      await client.sendMessage(client.getSelfJid(), `❌ No contact found for '${nameQuery}'.\nTry their phone number: !activate 91XXXXXXXXXX`)
      return true
    }

    // Already active for this specific contact
    if (store.getActiveChatByJid(contact.jid)) {
      await client.sendMessage(client.getSelfJid(), `ℹ️ Already active for ${contact.name}.`)
      return true
    }

    const selfJid = client.getSelfJid()
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const existing = store.getProfile(contact.jid) ?? store.getProfile(contact.name)
    const isStale = existing && (Date.now() - (existing.analyzedAt ?? 0)) > ONE_WEEK_MS
    const needsBuild = !existing || isStale

    if (needsBuild) {
      const refreshTag = isStale ? ' (weekly refresh)' : ''
      const startTs = Date.now()
      const elapsed = () => `${((Date.now() - startTs) / 1000).toFixed(1)}s`

      const initialMsg = await client.sendMessage(
        selfJid,
        `⏳ Adapting personality for ${contact.name}${refreshTag}\n` +
        `▱▱▱  0.0s  Starting...`
      )
      const progressKey = initialMsg?.key ?? null

      const updateProgress = async (text) => {
        if (!progressKey) {
          await client.sendMessage(selfJid, text)
        } else {
          await client.editMessage(selfJid, progressKey, text)
        }
      }

      const spinner = new Spinner()
      console.log()

      try {
        // Phase 1 — fetch history
        spinner.start(`Fetching chat history for ${contact.name}...`)
        await updateProgress(
          `⏳ Adapting personality for ${contact.name}${refreshTag}\n` +
          `▰▱▱  ${elapsed()}  📥 Loading chat history...`
        )
        const rawMessages = await withMinTime(600, () => client.getHistoryMessages(contact.jid, 500))

        if (rawMessages.length > 0) {
          // Phase 2 — parse messages
          spinner.start(`Reading your texting style (${rawMessages.length} messages)...`)
          await updateProgress(
            `⏳ Adapting personality for ${contact.name}${refreshTag}\n` +
            `▰▰▱  ${elapsed()}  🧠 Reading texting style (${rawMessages.length} msgs)...`
          )
          const parsed = await withMinTime(500, () => fromBaileysMessages(rawMessages, selfJid, contact.name))

          // Phase 3 — build profile
          spinner.start(`Fitting personality profile...`)
          await updateProgress(
            `⏳ Adapting personality for ${contact.name}${refreshTag}\n` +
            `▰▰▰  ${elapsed()}  ✨ Fitting personality profile...`
          )
          const profile = await withMinTime(500, () => analyzeStyle(parsed))

          spinner.done(`Bot ready for ${contact.name} — ${profile.sampleSize} messages · ${profile.lengthCategory} · ${profile.language}`)

          store.saveProfile(contact.jid, { ...profile, analyzedAt: Date.now() })

          await updateProgress(
            `✅ Bot ready for ${contact.name}  (took ${elapsed()})\n` +
            `📊 ${profile.sampleSize} messages analysed · ${profile.lengthCategory} · ${profile.language} · emoji: ${profile.emojiFrequency}`
          )
        } else if (isStale) {
          spinner.warn(`No new history — keeping existing profile for ${contact.name}`)
          await updateProgress(`✅ Bot ready for ${contact.name} (kept profile from ${new Date(existing.analyzedAt).toLocaleDateString()})`)
        } else {
          spinner.warn(`No chat history for ${contact.name} — using generic style`)
          await updateProgress(`✅ Bot ready for ${contact.name} (no history — generic style)`)
        }
      } finally {
        spinner.stop()
      }
    } else {
      await client.sendMessage(selfJid, `✅ Bot ready for ${contact.name}`)
    }

    // Activate under BOTH JID forms (LID + phone) so messages match either way.
    store.addActiveChat({ jid: contact.jid, name: contact.name })
    const alt = client.getAltJid?.(contact.jid)
    if (alt) store.addActiveChat({ jid: alt, name: contact.name })
    console.log(`[handler] Activated ${contact.name} under: ${contact.jid}${alt ? ` + ${alt}` : ''}`)
    return true
  }

  // Remove every active-chat entry that shares the same display name OR is an alias of the JID.
  function removeAllAliases(jid, name) {
    const removed = []
    const lcName = (name ?? '').toLowerCase()
    for (const chat of store.getActiveChats()) {
      const sameJid = chat.jid === jid
      const aliasJid = client.getAltJid?.(chat.jid) === jid || client.getAltJid?.(jid) === chat.jid
      const sameName = lcName && chat.name && chat.name.toLowerCase() === lcName
      if (sameJid || aliasJid || sameName) {
        store.removeActiveChat(chat.jid)
        removed.push(chat.jid)
      }
    }
    return removed
  }

  async function handleDeactivate(nameQuery) {
    const selfJid = client.getSelfJid()

    if (!nameQuery) {
      const all = store.getActiveChats()
      if (all.length === 0) {
        await client.sendMessage(selfJid, 'ℹ️ No active bots.')
        return true
      }
      store.clearAllActiveChats()
      // Dedupe display names (same contact may be stored under both JIDs)
      const names = [...new Set(all.map(c => c.name))].join(', ')
      console.log(`[handler] Deactivated all (${all.length} entries): ${names}`)
      await client.sendMessage(selfJid, `🔴 Deactivated all: ${names}`)
      return true
    }

    const contact = store.resolveContact(nameQuery) ?? client.resolveContact(nameQuery)
    if (!contact) {
      await client.sendMessage(selfJid, `❌ No contact found for '${nameQuery}'.`)
      return true
    }

    // Try direct JID first; if missing, fall back to name match in active set
    let displayName = contact.name
    let removed = removeAllAliases(contact.jid, contact.name)

    if (removed.length === 0) {
      const q = nameQuery.toLowerCase()
      const match = store.getActiveChats().find(c => c.name && c.name.toLowerCase().includes(q))
      if (match) {
        displayName = match.name
        removed = removeAllAliases(match.jid, match.name)
      }
    }

    if (removed.length === 0) {
      await client.sendMessage(selfJid, `ℹ️ ${contact.name} is not currently active.`)
      return true
    }

    console.log(`[handler] Deactivated ${displayName} — removed JIDs: ${removed.join(', ')}`)
    await client.sendMessage(selfJid, `🔴 Bot off for ${displayName}`)
    return true
  }

  async function handleStatus() {
    const selfJid = client.getSelfJid()
    const all = store.getActiveChats()

    if (all.length === 0) {
      await client.sendMessage(selfJid, '💤 No active bots.')
      return true
    }

    // Dedupe by display name (same contact often stored under both LID and phone JID)
    const uniqueNames = [...new Set(all.map(c => c.name))]
    const lines = uniqueNames.map(n => `• ${n}`).join('\n')
    await client.sendMessage(selfJid, `🤖 Active bots (${uniqueNames.length}):\n${lines}`)
    return true
  }

  async function handleContacts(query) {
    const selfJid = client.getSelfJid()
    const all = client.searchContacts('')
    const results = query ? all.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : all

    if (all.length === 0) {
      await client.sendMessage(selfJid, `⚠️ No contacts synced yet. Wait a few seconds after connecting and try again.`)
      return true
    }
    if (results.length === 0) {
      await client.sendMessage(selfJid, `No contacts matching '${query}'. Total known: ${all.length}. Try !contacts with no query to see all.`)
      return true
    }

    const lines = results.slice(0, 25).map(c => `• ${c.name}`).join('\n')
    const header = query ? `${results.length} match(es) for '${query}':` : `All contacts (${results.length}):`
    await client.sendMessage(selfJid, `${header}\n${lines}`)
    return true
  }

  return { handle }
}
