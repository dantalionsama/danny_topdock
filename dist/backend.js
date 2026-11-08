const clean = (c) =>
  c ? { id: c.id, character_id: c.character_id, name: c.name, updated_at: c.updated_at } : null

let lastUserId = null

async function readAll(chatId, userId) {
  try {
    return await spindle.chat.getMessages(chatId, { userId })
  } catch (e) {
    return await spindle.chat.getMessages(chatId)
  }
}

function searchMessages(msgs, query, limit = 100) {
  const q = query.toLowerCase()
  const out = []
  for (let i = 0; i < msgs.length && out.length < limit; i++) {
    const m = msgs[i]
    if (!m || typeof m.content !== 'string') continue
    const text = m.content
    const at = text.toLowerCase().indexOf(q)
    if (at === -1) continue
    const end = at + q.length
    out.push({
      id: m.id,
      index: i,
      role: m.role,
      before: (at > 70 ? '…' : '') + text.slice(Math.max(0, at - 70), at),
      match: text.slice(at, end),
      after: text.slice(end, end + 110) + (end + 110 < text.length ? '…' : ''),
    })
  }
  return out
}

async function resolveChat(chatId, userId) {
  if (chatId === null) return null
  if (chatId === undefined) return await spindle.chats.getActive(userId)
  return await spindle.chats.get(chatId, userId)
}

async function pushState(userId, chatId) {
  if (!userId) {
    spindle.log.info('Top Info Bar v2: no userId available, skipping state push')
    return
  }
  try {
    const chat = await resolveChat(chatId, userId)
    spindle.sendToFrontend({ type: 'state', chat: clean(chat) }, userId)
  } catch (err) {
    spindle.log.info('Top Info Bar v2: state push failed (userId ' + typeof userId + '): ' + (err && err.message))
  }
}

spindle.on('CHAT_SWITCHED', (payload, userId) => {
  const uid =
    (typeof userId === 'string' && userId) ||
    (payload && typeof payload.userId === 'string' && payload.userId) ||
    lastUserId
  pushState(uid, payload && payload.chatId ? payload.chatId : null)
})

spindle.onFrontendMessage(async (payload, userId) => {
  if (!payload || typeof payload.type !== 'string') return
  if (typeof userId === 'string' && userId) lastUserId = userId
  const reply = (data) =>
    spindle.sendToFrontend({ requestId: payload.requestId, ...data }, userId)

  try {
    switch (payload.type) {
      case 'get_state': {
        await pushState(userId)
        break
      }

      case 'list_chats': {
        let characterId = payload.characterId
        if (!characterId) {
          const active = await spindle.chats.getActive(userId)
          characterId = active && active.character_id
        }
        if (!characterId) {
          reply({ type: 'chats', chats: [] })
          break
        }
        const res = await spindle.chats.list({ characterId, limit: 200, userId })
        const chats = res.data
          .slice()
          .sort((a, b) => b.updated_at - a.updated_at)
          .map((c) => ({ id: c.id, name: c.name, updated_at: c.updated_at }))
        reply({ type: 'chats', chats })
        break
      }

      case 'rename': {
        const name = String(payload.name || '').trim().slice(0, 200)
        if (!payload.chatId || !name) throw new Error('Missing chat or name')
        const chat = await spindle.chats.update(payload.chatId, { name }, userId)
        reply({ type: 'renamed', chat: clean(chat) })
        break
      }

      case 'delete': {
        if (!payload.chatId) throw new Error('Missing chat')
        const ok = await spindle.chats.delete(payload.chatId, userId)
        if (!ok) throw new Error('Chat not found')
        reply({ type: 'deleted', chatId: payload.chatId })
        break
      }

      case 'search': {
        const query = String(payload.query || '').trim().slice(0, 200)
        if (!payload.characterId || query.length < 2) {
          reply({ type: 'results', results: [] })
          break
        }
        const res = await spindle.chats.list({ characterId: payload.characterId, limit: 200, userId })
        const chats = res.data.slice().sort((a, b) => b.updated_at - a.updated_at)
        const results = []
        let scanned = 0
        let lastError = ''
        for (const chat of chats) {
          if (results.length >= 100) break
          let msgs
          try {
            msgs = await readAll(chat.id, userId)
            scanned++
          } catch (e) {
            lastError = e && e.message ? e.message : String(e)
            spindle.log.info('Top Info Bar search: read failed: ' + lastError)
            continue
          }
          for (const h of searchMessages(msgs, query, 5)) {
            results.push({ ...h, chatId: chat.id, chatName: chat.name })
          }
        }
        reply({ type: 'results', results: results.slice(0, 100), scanned, total: chats.length, error: lastError })
        break
      }
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    if (payload.requestId) reply({ type: 'error', message })
    else spindle.log.info('Top Info Bar v2 error: ' + message)
  }
})

spindle.log.info('Top Info Bar v2 loaded')