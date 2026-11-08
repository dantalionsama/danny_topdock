export function setup(ctx) {
  const MOUNT = '[data-spindle-mount="chat_top_dock"]'
  const state = { chat: null }
  const pending = new Map()
  let bar = null
  let switcher = null
  let renameModal = null
  let flashTimer = null
  let raf = 0

  const svg = (p) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
  const ICON = {
    chevron: svg('<path d="m6 9 6 6 6-6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  }

  const removeStyle = ctx.dom.addStyle(`
    .tib-bar{display:flex;align-items:center;gap:4px;width:100%;min-width:0}
    .tib-name{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:4px 8px;
      background:transparent;border:1px solid transparent;border-radius:var(--lumiverse-radius);
      color:var(--lumiverse-text);font-size:13px;cursor:pointer;text-align:left}
    .tib-name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .tib-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;
      background:transparent;border:1px solid transparent;border-radius:var(--lumiverse-radius);
      color:var(--lumiverse-text-muted);cursor:pointer;flex-shrink:0}
    .tib-name:hover,.tib-btn:hover{background:var(--lumiverse-fill-subtle);border-color:var(--lumiverse-border);color:var(--lumiverse-text)}
    .tib-btn.danger:hover{color:#e5484d}
    .tib-name:disabled,.tib-btn:disabled{opacity:.4;cursor:default;pointer-events:none}
    .tib-list{display:flex;flex-direction:column;gap:4px}
    .tib-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;
      background:var(--lumiverse-fill-subtle);border:1px solid var(--lumiverse-border);
      border-radius:var(--lumiverse-radius);color:var(--lumiverse-text);cursor:pointer;text-align:left}
    .tib-item:hover{border-color:var(--lumiverse-border-hover)}
    .tib-item.active{border-color:var(--lumiverse-accent)}
    .tib-item-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    .tib-item-date{flex-shrink:0;font-size:11px;color:var(--lumiverse-text-dim)}
    .tib-empty{text-align:center;color:var(--lumiverse-text-dim);font-size:13px;padding:12px}
    .tib-row{display:flex;gap:8px}
    .tib-input{flex:1;padding:6px 10px;background:var(--lumiverse-fill);color:var(--lumiverse-text);
      border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius)}
    .tib-save{padding:6px 14px;background:var(--lumiverse-accent);color:var(--lumiverse-accent-fg);
      border:none;border-radius:var(--lumiverse-radius);cursor:pointer}
    .tib-res{flex-direction:column;align-items:stretch;gap:4px}
    .tib-res-meta{font-size:11px;color:var(--lumiverse-text-dim)}
    .tib-res-text{font-size:12.5px;line-height:1.4;text-align:left;white-space:normal;word-break:break-word}
    .tib-res mark{background:var(--lumiverse-accent);color:var(--lumiverse-accent-fg);border-radius:3px;padding:0 2px}
    .tib-hit{outline:2px solid var(--lumiverse-accent);outline-offset:2px;border-radius:var(--lumiverse-radius)}
    .tib-group{font-size:11px;font-weight:600;color:var(--lumiverse-text-dim);margin:8px 2px 2px}
    .tib-search{width:100%;box-sizing:border-box;margin-bottom:4px}
  `)

  const html = `
    <div class="tib-bar">
      <button type="button" class="tib-name" data-act="switch" title="Switch chat">
        <span class="tib-name-text">…</span>${ICON.chevron}
      </button>
      <button type="button" class="tib-btn" data-act="search" title="Search all chats with this character">${ICON.search}</button>
      <button type="button" class="tib-btn" data-act="new" title="New chat">${ICON.plus}</button>
      <button type="button" class="tib-btn" data-act="rename" title="Rename chat">${ICON.edit}</button>
      <button type="button" class="tib-btn danger" data-act="delete" title="Delete chat">${ICON.trash}</button>
    </div>`

  function el(tag, cls, text) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }
  const errMsg = (e) => (e && e.message ? e.message : String(e))

  // ---- backend requests ----
  function ask(type, data = {}) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID()
      const t = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('Timed out'))
      }, 15000)
      pending.set(requestId, { resolve, reject, t })
      ctx.sendToBackend({ type, requestId, ...data })
    })
  }

  const offBackend = ctx.onBackendMessage((p) => {
    if (!p) return
    if (p.requestId && pending.has(p.requestId)) {
      const r = pending.get(p.requestId)
      pending.delete(p.requestId)
      clearTimeout(r.t)
      if (p.type === 'error') r.reject(new Error(p.message))
      else r.resolve(p)
      return
    }
    if (p.type === 'state') {
      state.chat = p.chat || null
      render()
    }
  })

  // ---- host actions ----
  async function goToChat(chatId) {
    const s = ctx.host && ctx.host.surfaces
    if (!s) throw new Error('Host navigation unavailable')
    const route = s.list(['route']).find((r) => String(r.id).includes('/chat/:chatId'))
    await s.invoke({ kind: 'route', id: route ? route.id : '/chat/:chatId' }, { chatId })
  }

  async function startNewChat(characterId) {
    const s = ctx.host && ctx.host.surfaces
    if (!s) throw new Error('Host actions unavailable')
    await s.invoke({ kind: 'entity_action', id: 'character_chat' }, { characterId, mode: 'new' })
  }

  // ---- bar ----
  function render() {
    if (!bar) return
    const chat = state.chat
    const text = bar.querySelector('.tib-name-text')
    if (text) text.textContent = chat ? chat.name || 'Untitled chat' : 'No chat open'
    bar.querySelectorAll('[data-act]').forEach((b) => {
      b.disabled = !chat
    })
  }

  function flash(msg) {
    const text = bar && bar.querySelector('.tib-name-text')
    if (!text) return
    text.textContent = msg
    clearTimeout(flashTimer)
    flashTimer = setTimeout(render, 2500)
  }

  function ensureBar() {
    const mount = document.querySelector(MOUNT)
    if (!mount) return
    if (bar && bar.isConnected && mount.contains(bar)) return
    if (bar) {
      try { ctx.dom.uninject(bar) } catch (e) {}
      bar = null
    }
    bar = ctx.dom.inject(MOUNT, html)
    if (!bar) return
    bar.style.cssText = 'flex:1 1 auto;min-width:0;'
    bar.addEventListener('click', onClick)
    render()
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]')
    if (!btn || btn.disabled) return
    const act = btn.dataset.act
    if (act === 'switch') openSwitcher()
    else if (act === 'search') openSearch()
    else if (act === 'new') newChat()
    else if (act === 'rename') openRename()
    else if (act === 'delete') deleteChat()
  }

  // ---- switcher ----
  function openSwitcher() {
    if (!state.chat || switcher) return
    const m = ctx.ui.showModal({ title: 'Switch chat', width: 380 })
    switcher = m
    m.root.replaceChildren(el('div', 'tib-empty', 'Loading…'))
    m.onDismiss(() => {
      if (switcher === m) switcher = null
    })
    ask('list_chats', { characterId: state.chat.character_id })
      .then((res) => {
        if (switcher !== m) return
        m.root.replaceChildren()
        if (!res.chats.length) {
          m.root.append(el('div', 'tib-empty', 'No chats found'))
          return
        }
        const list = el('div', 'tib-list')
        for (const c of res.chats) {
          const item = el('button', 'tib-item' + (c.id === state.chat.id ? ' active' : ''))
          item.type = 'button'
          item.append(
            el('span', 'tib-item-name', c.name || 'Untitled chat'),
            el('span', 'tib-item-date', new Date(c.updated_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
          )
          item.addEventListener('click', async () => {
            try {
              if (c.id !== state.chat.id) await goToChat(c.id)
            } catch (err) {
              flash(errMsg(err))
            }
            m.dismiss()
          })
          list.append(item)
        }
        m.root.append(list)
      })
      .catch((err) => {
        if (switcher === m) m.root.replaceChildren(el('div', 'tib-empty', errMsg(err)))
      })
  }

  // ---- search ----
  let searchModal = null
  let lastQuery = ''

  async function revealMessage(id) {
    const ids = ctx.messages.listMessageIds()
    const target = ids.indexOf(id)
    const sc = document.querySelector('[data-chat-scroll="true"]')
    if (target < 0 || !sc) return null
    for (let i = 0; i < 40; i++) {
      const found = ctx.dom.findMessageElement(id)
      if (found) return found
      const mounted = ctx.dom
        .listMessageElements()
        .map((m) => ids.indexOf(m.messageId))
        .filter((n) => n >= 0)
      if (!mounted.length) return null
      const lo = Math.min(...mounted)
      const hi = Math.max(...mounted)
      const gap = target < lo ? lo - target : target - hi
      const avg = sc.scrollHeight / Math.max(ids.length, 1)
      const step = Math.max(sc.clientHeight * 0.5, gap * avg * 0.8)
      sc.scrollTop += (target < lo ? -1 : 1) * step
      await new Promise((r) => setTimeout(r, 80))
    }
    return ctx.dom.findMessageElement(id)
  }

  async function jumpTo(id) {
    try {
      const node = await revealMessage(id)
      if (!node) return flash('Could not find that message')
      node.scrollIntoView({ block: 'center' })
      node.classList.add('tib-hit')
      setTimeout(() => node.classList.remove('tib-hit'), 2200)
    } catch (err) {
      flash(errMsg(err))
    }
  }

  async function openHit(r) {
    try {
      if (!ctx.messages.listMessageIds().includes(r.id)) {
        await goToChat(r.chatId)
        for (let i = 0; i < 40; i++) {
          await new Promise((res) => setTimeout(res, 150))
          if (ctx.messages.listMessageIds().includes(r.id)) break
        }
        await new Promise((res) => setTimeout(res, 300))
      }
      await jumpTo(r.id)
    } catch (err) {
      flash(errMsg(err))
    }
  }

  function openSearch() {
    const chat = state.chat
    if (!chat || !chat.character_id || searchModal) return
    const m = ctx.ui.showModal({
      title: 'Search all chats',
      width: Math.min(820, window.innerWidth - 32),
      maxHeight: Math.floor(window.innerHeight * 0.88),
    })
    searchModal = m
    m.onDismiss(() => {
      if (searchModal === m) searchModal = null
    })
    const input = el('input', 'tib-input tib-search')
    input.type = 'text'
    input.placeholder = 'Search every chat with this character…'
    input.value = lastQuery
    const status = el('div', 'tib-empty', '')
    const list = el('div', 'tib-list')
    m.root.append(input, status, list)

    let timer = null
    let seq = 0
    const run = async () => {
      lastQuery = input.value
      const query = input.value.trim()
      list.replaceChildren()
      if (query.length < 2) {
        status.textContent = 'Type at least 2 characters'
        return
      }
      status.textContent = 'Searching…'
      const mine = ++seq
      try {
        const res = await ask('search', { characterId: chat.character_id, query })
        if (mine !== seq || searchModal !== m) return
        const n = res.results.length
        const chatCount = new Set(res.results.map((r) => r.chatId)).size
        status.textContent = n
          ? `${n}${n >= 100 ? '+' : ''} match${n === 1 ? '' : 'es'} in ${chatCount} chat${chatCount === 1 ? '' : 's'}`
          : res.error
            ? 'Could not read chats: ' + res.error
            : `No matches (searched ${res.scanned} of ${res.total} chats)`
        let lastChat = null
        for (const r of res.results) {
          if (r.chatId !== lastChat) {
            lastChat = r.chatId
            list.append(
              el('div', 'tib-group', (r.chatName || 'Untitled chat') + (r.chatId === chat.id ? ' · current' : '')),
            )
          }
          const item = el('button', 'tib-item tib-res')
          item.type = 'button'
          const meta = el('span', 'tib-res-meta', `#${r.index + 1} · ${r.role === 'user' ? 'You' : 'Character'}`)
          const text = el('span', 'tib-res-text')
          text.append(document.createTextNode(r.before), el('mark', null, r.match), document.createTextNode(r.after))
          item.append(meta, text)
          item.addEventListener('click', () => {
            m.dismiss()
            openHit(r)
          })
          list.append(item)
        }
      } catch (err) {
        if (mine === seq) status.textContent = errMsg(err)
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(run, 700)
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer)
        run()
      }
    })
    setTimeout(() => { input.focus(); input.select() }, 50)
    run()
  }

  // ---- new / rename / delete ----
  async function newChat() {
    const chat = state.chat
    if (!chat || !chat.character_id) return flash('No character for this chat')
    try {
      await startNewChat(chat.character_id)
    } catch (err) {
      flash(errMsg(err))
    }
  }

  function openRename() {
    const chat = state.chat
    if (!chat || renameModal) return
    const m = ctx.ui.showModal({ title: 'Rename chat', width: 380 })
    renameModal = m
    m.onDismiss(() => {
      if (renameModal === m) renameModal = null
    })
    const input = el('input', 'tib-input')
    input.type = 'text'
    input.maxLength = 200
    input.value = chat.name || ''
    const save = el('button', 'tib-save', 'Save')
    save.type = 'button'
    const submit = async () => {
      const name = input.value.trim()
      if (!name) return
      try {
        const res = await ask('rename', { chatId: chat.id, name })
        if (state.chat && state.chat.id === chat.id) state.chat = res.chat
        render()
        m.dismiss()
      } catch (err) {
        m.dismiss()
        flash(errMsg(err))
      }
    }
    save.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
    })
    const row = el('div', 'tib-row')
    row.append(input, save)
    m.root.append(row)
    setTimeout(() => { input.focus(); input.select() }, 50)
  }

  async function deleteChat() {
    const chat = state.chat
    if (!chat) return
    const { confirmed } = await ctx.ui.showConfirm({
      title: 'Delete chat',
      message: `Delete "${chat.name || 'Untitled chat'}" and all its messages? This can't be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!confirmed) return
    try {
      // move off the chat first, then delete it
      const res = await ask('list_chats', { characterId: chat.character_id })
      const other = res.chats.find((c) => c.id !== chat.id)
      if (other) await goToChat(other.id)
      else await startNewChat(chat.character_id)
      await ask('delete', { chatId: chat.id })
    } catch (err) {
      flash(errMsg(err))
    }
  }

  // ---- keep the bar mounted ----
  const observer = new MutationObserver(() => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      ensureBar()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })

  ensureBar()
  ctx.sendToBackend({ type: 'get_state' })

  return () => {
    observer.disconnect()
    if (raf) cancelAnimationFrame(raf)
    clearTimeout(flashTimer)
    pending.forEach((r) => {
      clearTimeout(r.t)
      r.reject(new Error('Unloaded'))
    })
    pending.clear()
    offBackend()
    if (switcher) switcher.dismiss()
    if (renameModal) renameModal.dismiss()
    if (searchModal) searchModal.dismiss()
    removeStyle()
    ctx.dom.cleanup()
  }
}