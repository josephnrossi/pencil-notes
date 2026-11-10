/* Pencil Notes — 🛰 Satellite (v21ee part C, MOCK): Grok as a floating, context-aware assistant inside the app.
   · A small orb you can drag and dock to any screen edge (remembered). Finger / mouse tap opens it; the Apple Pencil never
     opens it, and while you write it fades and lets every touch through.
   · A compact chat panel that talks to Grok with the key saved in Settings → Smarter AI (via the app's aiRequest — no key in
     this file). No key → a friendly card linking to Settings; local actions (Find, Insert, Calculate) still work.
   · Context-aware: current notebook / note / page (its recognized handwriting from v21ee's index, typed text, tasks…),
     an active lasso selection, and whether the Calculator Board or Idea Board is open — shown in a context chip.
   · Grok answers with tool-style JSON ({"reply", "actions":[{tool,args}]}); the app runs the actions: search notes,
     insert Quote sheet / Daily To-Do / Number, add a page, create an Idea Board card, calculate (CalcMath) and send to the
     Calculator Board, open a board, delete a page (asks first). Every action card has Undo.
   · Quick chips: Summarize · Find · Insert · Calculate. 🎤 voice input when the Web Speech API exists. Chat history per notebook. */
(function () {
  'use strict';
  const G = name => { switch (name) {
    case 'QB': return typeof QB !== 'undefined' ? QB : undefined; case 'selection': return typeof selection !== 'undefined' ? selection : undefined;
    case 'pageEls': return typeof pageEls !== 'undefined' ? pageEls : undefined; case 'aiReady': return typeof aiReady !== 'undefined' ? aiReady : undefined;
    case 'aiRequest': return typeof aiRequest !== 'undefined' ? aiRequest : undefined; case 'aiModel': return typeof aiModel !== 'undefined' ? aiModel : undefined;
    case 'isSealed': return typeof isSealed !== 'undefined' ? isSealed : undefined; case 'IPI': return typeof IPI !== 'undefined' ? IPI : undefined;
    case 'ideaNote': return typeof ideaNote !== 'undefined' ? ideaNote : undefined; case 'ensureIdeaNote': return typeof ensureIdeaNote !== 'undefined' ? ensureIdeaNote : undefined;
    case 'ibSealed': return typeof ibSealed !== 'undefined' ? ibSealed : undefined; case 'boardCols': return typeof boardCols !== 'undefined' ? boardCols : undefined;
    case 'bH': return typeof bH !== 'undefined' ? bH : undefined; case 'bUndo': return typeof bUndo !== 'undefined' ? bUndo : undefined;
    case 'renumber': return typeof renumber !== 'undefined' ? renumber : undefined; case 'qbOpen': return typeof qbOpen !== 'undefined' ? qbOpen : undefined;
    case 'qbRender': return typeof qbRender !== 'undefined' ? qbRender : undefined; case 'insertSectionAt': return typeof insertSectionAt !== 'undefined' ? insertSectionAt : undefined;
    case 'openSettings': return typeof openSettings !== 'undefined' ? openSettings : undefined; case 'restore': return typeof restore !== 'undefined' ? restore : undefined;
    case 'transcribe': return typeof transcribe !== 'undefined' ? transcribe : undefined; case 'noteSearchText': return typeof noteSearchText !== 'undefined' ? noteSearchText : undefined;
    case 'isBoardPage': return typeof isBoardPage !== 'undefined' ? isBoardPage : undefined;
  } return undefined; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const say = (m, ms) => { try { toast(m, ms); } catch (_) {} };
  const sid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ORB = 56, MARGIN = 8;
  const ST = { open: false, busy: false, msgs: [], key: '', undo: new Map(), pending: new Map(), penAt: 0, rec: null, ctx: null };

  /* ==================== context ==================== */
  function visiblePi() {
    const els = G('pageEls') || [], w = document.getElementById('pages'); if (!w || !els.length) return 0;
    const wr = w.getBoundingClientRect(), mid = wr.top + wr.height * 0.4; let best = 0, bd = Infinity;
    els.forEach((r, i) => { const b = r.el.getBoundingClientRect(); const d = b.top <= mid && b.bottom >= mid ? 0 : Math.min(Math.abs(b.top - mid), Math.abs(b.bottom - mid)); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  const sealedNote = n => { const f = G('isSealed'); try { return !!(f && f(n)); } catch (_) { return false; } };
  function pageText(pg) {
    if (!pg) return '';
    const out = [], idx = (pg.hwIdx && pg.hwIdx.items) || [];
    for (const it of idx) out.push(it.k === 'ink' ? it.t : `${it.label}: ${it.t}`);
    if (pg.inkText && !idx.length) out.push(pg.inkText);
    for (const t of pg.texts || []) if (t.text) out.push(t.text);
    for (const t of pg.tasks || []) if (t.text && t.kind !== 'card') out.push((t.done ? '☑ ' : '☐ ') + t.text);
    for (const l of pg.labels || []) if (l.text) out.push('🏷 ' + l.text);
    if (pg.qsheet) out.unshift('[This page is a Quote sheet]'); if (pg.todo) out.unshift('[This page is a Daily To-Do page]');
    return out.filter(Boolean).join('\n');
  }
  const ovl = (a, b) => a && b && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  function selInfo(n) {
    const sel = G('selection'); if (!sel || !n || !n.pages[sel.pi]) return null;
    const pg = n.pages[sel.pi], strokes = pg.strokes.filter(s => (sel.ids || []).includes(s.id));
    let bb = null; for (const s of strokes) for (const p of s.points) bb = bb ? [Math.min(bb[0], p[0]), Math.min(bb[1], p[1]), Math.max(bb[2], p[0]), Math.max(bb[3], p[1])] : [p[0], p[1], p[0], p[1]];
    const parts = [];
    for (const it of (pg.hwIdx && pg.hwIdx.items) || []) if (it.bb && ovl(it.bb, bb)) parts.push(it.t);
    for (const id of sel.texts || []) { const t = (pg.texts || []).find(x => x.id === id); if (t) parts.push(t.text); }
    for (const id of sel.tasks || []) { const t = (pg.tasks || []).find(x => x.id === id); if (t && t.text) parts.push('☐ ' + t.text); }
    return { pi: sel.pi, strokes, bb, text: parts.join('\n'), count: strokes.length + (sel.texts || []).length + (sel.tasks || []).length };
  }
  async function readSelection(si) {   // recognize lassoed ink that the index doesn't cover yet
    if (!si || si.text || !si.strokes.length) return si;
    try { const f = (window.V21e4 && V21e4.recognizeStrokes) || G('transcribe'); if (f) si.text = String(await f(si.strokes) || '').trim(); } catch (_) {}
    return si;
  }
  function boardInfo() {
    const QB = G('QB'); if (!QB || !QB.open) return null;
    if (QB.mode === 'calc' && window.CalcBoard) {
      const b = CalcBoard.state.board, vals = CalcBoard.state.vals || new Map();
      const lines = b.exprs.map(e => { const r = vals.get(e.id) || {}; return `${e.name ? e.name + ': ' : ''}${e.text || '(unread)'}${r.ok ? ' = ' + r.display : r.error ? ' ⚠ ' + r.error : ''}`; });
      for (const bl of b.blocks) { const r = vals.get(bl.id) || {}; const f = CalcFns.get(bl.fn); lines.push(`${bl.name}: ${f ? f.label : bl.fn} = ${r.ok ? r.display : '⚠ ' + (r.error || '')}`); }
      return { kind: 'calc', label: '🧮 Calculator Board', sub: `${b.exprs.length} formula${b.exprs.length === 1 ? '' : 's'} · ${b.blocks.length} result${b.blocks.length === 1 ? '' : 's'}`, text: lines.join('\n') };
    }
    if (QB.mode === 'ideas') {
      const n = (G('ideaNote') || (() => null))(), sealed = (G('ibSealed') || (() => false))();
      if (!n || sealed) return { kind: 'ideas', label: '💡 Idea Board', sub: sealed ? 'locked' : 'empty', text: '' };
      const pg = n.pages[0], cols = (pg.board && pg.board.columns) || [], cards = pg.tasks.filter(t => t.kind === 'card');
      const text = cols.map(c => `${c.title}: ${cards.filter(t => t.col === c.id).map(t => t.text || '(handwritten card)').join('; ') || '—'}`).join('\n');
      return { kind: 'ideas', label: '💡 Idea Board', sub: `${cards.filter(t => !t.done).length} open card${cards.length === 1 ? '' : 's'}`, text };
    }
    if (QB.mode === 'inbox') return { kind: 'inbox', label: '📥 Inbox', sub: 'not shared with the Satellite', text: '' };
    return null;
  }
  function context() {
    const n = curNote(), nb = n && S.notebooks.find(b => b.id === n.notebookId);
    const c = { notebook: nb ? nb.name : '', notebookId: n ? n.notebookId : 'none', note: n ? n.title : '', locked: n ? sealedNote(n) : false, pi: 0, pages: n ? n.pages.length : 0, page: '', sel: null, board: boardInfo() };
    if (n && !c.locked) { c.pi = visiblePi(); c.page = pageText(n.pages[c.pi]); c.sel = selInfo(n); }
    c.words = c.page ? c.page.split(/\s+/).filter(Boolean).length : 0;
    return (ST.ctx = c);
  }
  function chipHTML(c) {
    const bits = [];
    if (c.board) bits.push(`<b>${esc(c.board.label)}</b><small>${esc(c.board.sub)}</small>`);
    if (c.locked) bits.push('<b>🔒 Locked note</b><small>not shared</small>');
    else if (c.note) bits.push(`<b>📓 ${esc(c.notebook || 'Notes')} › ${esc(c.note)}</b><small>page ${c.pi + 1}/${c.pages} · ✍️ ${c.words} word${c.words === 1 ? '' : 's'}</small>`);
    if (c.sel) bits.push(`<b class="sat-selb">◌ Selection</b><small>${c.sel.count === c.sel.strokes.length ? `${c.sel.count} stroke${c.sel.count === 1 ? '' : 's'}` : `${c.sel.count} item${c.sel.count === 1 ? '' : 's'}`}</small>`);
    return bits.map(b => `<span class="sat-cbit">${b}</span>`).join('');
  }
  function contextBlock(c) {
    const L = [];
    if (c.board) L.push(`OPEN BOARD: ${c.board.label} (${c.board.sub})\n${c.board.text || '(nothing readable)'}`);
    if (c.locked) L.push('CURRENT NOTE: locked with Pencil Lock — content not shared.');
    else if (c.note) L.push(`NOTEBOOK: ${c.notebook}\nNOTE: ${c.note}\nPAGE ${c.pi + 1} of ${c.pages} — recognized text:\n${c.page.slice(0, 6000) || '(no recognized handwriting yet)'}`);
    if (c.sel) L.push(`LASSO SELECTION (on page ${c.sel.pi + 1}):\n${c.sel.text || '(handwriting not recognized)'}`);
    return L.join('\n\n');
  }

  /* ==================== chat storage (per notebook) ==================== */
  const keyFor = c => 'satChat:' + (c && c.notebookId || 'none');
  function loadChat() { const k = keyFor(context()); if (k === ST.key) return; ST.key = k; try { ST.msgs = JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { ST.msgs = []; } }
  function saveChat() { try { localStorage.setItem(ST.key, JSON.stringify(ST.msgs.slice(-80))); } catch (_) {} }
  function push(m) { m.id = m.id || sid(); m.at = Date.now(); ST.msgs.push(m); saveChat(); renderMsgs(); return m; }

  /* ==================== DOM ==================== */
  const orb = document.createElement('button');
  orb.id = 'satOrb'; orb.type = 'button'; orb.setAttribute('aria-label', 'Open the Grok assistant'); orb.title = 'Grok assistant — tap to chat · drag to move';
  orb.innerHTML = '<span class="sat-ring"></span><span class="sat-core">✦</span><span class="sat-moon"></span>';
  const panel = document.createElement('section');
  panel.id = 'satPanel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Grok assistant');
  panel.innerHTML = `<header class="sat-head"><div class="sat-title"><i>✦</i><b>Grok</b><small class="sat-model"></small></div>
      <button class="sat-ib" data-s="menu" aria-label="Assistant options">⋯</button><button class="sat-ib" data-s="close" aria-label="Close the assistant">✕</button></header>
    <button class="sat-ctx" data-s="ctx" aria-label="What Grok can see"></button>
    <div class="sat-ctxd" hidden></div>
    <div class="sat-msgs" aria-live="polite"></div>
    <div class="sat-chips"><button data-q="summarize">📝 Summarize</button><button data-q="find">🔎 Find</button><button data-q="insert">＋ Insert</button><button data-q="calc">🧮 Calculate</button></div>
    <div class="sat-ins" hidden><button data-ins="quote_sheet">🧾 Quote sheet</button><button data-ins="daily_todo">✅ Daily To-Do</button><button data-ins="number">1. Number</button><button data-ins="page">📄 Page</button><button data-ins="idea">💡 Idea card</button></div>
    <form class="sat-form"><input class="sat-in" autocomplete="off" placeholder="Ask Grok about this page…" aria-label="Message Grok"><button type="button" class="sat-ib sat-mic" data-s="mic" aria-label="Speak" ${SR ? '' : 'hidden'}>🎤</button><button class="sat-send" aria-label="Send">↑</button></form>
    <div class="sat-menu" hidden><button data-s="clear">🗑 Clear this notebook's chat…</button><button data-s="settings">⚙︎ AI settings…</button></div>`;
  document.body.append(orb, panel);
  const $p = s => panel.querySelector(s), msgsEl = $p('.sat-msgs'), inp = $p('.sat-in');

  /* ---------- orb: dock to any edge, remembered ---------- */
  function loadPos() { try { const p = JSON.parse(localStorage.getItem('satPos') || 'null'); if (p && ['left', 'right', 'top', 'bottom'].includes(p.edge) && p.t >= 0 && p.t <= 1) return p; } catch (_) {} return { edge: 'right', t: 0.82 }; }
  let pos = loadPos();
  function place(p = pos) {
    const W = innerWidth, H = innerHeight;
    const x = p.edge === 'left' ? MARGIN : p.edge === 'right' ? W - ORB - MARGIN : MARGIN + p.t * (W - ORB - 2 * MARGIN);
    const y = p.edge === 'top' ? MARGIN + 52 : p.edge === 'bottom' ? H - ORB - MARGIN - 4 : MARGIN + 52 + p.t * (H - ORB - 2 * MARGIN - 56);
    orb.style.left = x + 'px'; orb.style.top = y + 'px'; orb.dataset.edge = p.edge;
    if (ST.open) placePanel();
  }
  function snap(x, y) {   // nearest edge for the orb's centre
    const W = innerWidth, H = innerHeight, cx = x + ORB / 2, cy = y + ORB / 2;
    const d = { left: cx, right: W - cx, top: cy, bottom: H - cy }, edge = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
    const t = edge === 'left' || edge === 'right' ? (y - MARGIN - 52) / Math.max(1, H - ORB - 2 * MARGIN - 56) : (x - MARGIN) / Math.max(1, W - ORB - 2 * MARGIN);
    return { edge, t: Math.max(0, Math.min(1, +t.toFixed(4))) };
  }
  let drag = null;
  orb.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') { ghost(); return; }            // the Pencil never opens or moves the orb
    if (e.button > 0) return;
    e.preventDefault(); orb.setPointerCapture(e.pointerId);
    const r = orb.getBoundingClientRect(); drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: r.left, oy: r.top, moved: false };
  });
  orb.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true; orb.classList.add('dragging');
    orb.style.left = Math.max(0, Math.min(innerWidth - ORB, drag.ox + dx)) + 'px'; orb.style.top = Math.max(0, Math.min(innerHeight - ORB, drag.oy + dy)) + 'px';
  });
  const endDrag = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; orb.classList.remove('dragging');
    if (d.moved) { const r = orb.getBoundingClientRect(); pos = snap(r.left, r.top); localStorage.setItem('satPos', JSON.stringify(pos)); place(); return; }
    if (!cancel) toggle();
  };
  orb.addEventListener('pointerup', e => endDrag(e)); orb.addEventListener('pointercancel', e => endDrag(e, true));
  orb.addEventListener('click', e => { if (e.detail === 0) toggle(); });      // keyboard / VoiceOver activation
  addEventListener('resize', () => place());
  // while the Pencil writes anywhere, the orb fades and lets touches through
  function ghost() { ST.penAt = Date.now(); orb.classList.add('ghost'); clearTimeout(ghost.t); ghost.t = setTimeout(() => { if (Date.now() - ST.penAt >= 1400) orb.classList.remove('ghost'); }, 1500); }
  addEventListener('pointerdown', e => { if (e.pointerType === 'pen' && !panel.contains(e.target)) ghost(); }, true);
  addEventListener('pointermove', e => { if (e.pointerType === 'pen' && e.buttons) ghost(); }, true);

  /* ---------- panel ---------- */
  function placePanel() {
    const W = innerWidth, H = innerHeight, pw = Math.min(390, W - 16), ph = Math.min(580, H - 90), r = orb.getBoundingClientRect();
    panel.classList.toggle('sheet', W < 600);
    if (W < 600) { panel.style.cssText = ''; return; }
    let left, top;
    if (pos.edge === 'right') { left = r.left - pw - 10; top = r.top + ORB / 2 - ph / 2; }
    else if (pos.edge === 'left') { left = r.right + 10; top = r.top + ORB / 2 - ph / 2; }
    else if (pos.edge === 'top') { left = r.left + ORB / 2 - pw / 2; top = r.bottom + 10; }
    else { left = r.left + ORB / 2 - pw / 2; top = r.top - ph - 10; }
    left = Math.max(8, Math.min(W - pw - 8, left)); top = Math.max(56, Math.min(H - ph - 8, top));
    panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.width = pw + 'px'; panel.style.height = ph + 'px';
  }
  function open() {
    if (ST.open) return; ST.open = true; loadChat(); panel.hidden = false; orb.classList.add('on'); orb.setAttribute('aria-expanded', 'true');
    placePanel(); refreshCtx(); renderMsgs();
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => inp.focus(), 30);
  }
  function close() { if (!ST.open) return; ST.open = false; panel.hidden = true; orb.classList.remove('on'); orb.setAttribute('aria-expanded', 'false'); $p('.sat-menu').hidden = true; $p('.sat-ins').hidden = true; stopMic(); }
  const toggle = () => ST.open ? close() : open();
  function refreshCtx() {
    const c = context(); loadChat();
    $p('.sat-ctx').innerHTML = `<span class="sat-eye">👁</span>${chipHTML(c) || '<span class="sat-cbit"><b>Nothing open</b></span>'}`;
    const ready = hasKey(), m = G('aiModel');
    $p('.sat-model').textContent = ready ? (m ? m() : 'Grok') : 'not connected';
    const d = $p('.sat-ctxd'); if (!d.hidden) d.innerHTML = ctxDetail(c);
    if (!ST.msgs.length) renderMsgs();      // the hello / Connect card depends on the key
  }
  function ctxDetail(c) {
    const t = contextBlock(c) || 'Nothing from your notes is visible right now.';
    return `<div class="sat-ctxh">What Grok can see <small>(sent only when you ask)</small></div><pre>${esc(t.slice(0, 1500))}${t.length > 1500 ? '\n…' : ''}</pre>`;
  }
  const hasKey = () => { const f = G('aiReady'); try { return !!(f && f()); } catch (_) { return false; } };
  // refresh the chip as the user moves around
  let ctxT = 0; const ctxSoon = () => { if (!ST.open) return; clearTimeout(ctxT); ctxT = setTimeout(refreshCtx, 250); };
  ['pointerup', 'scroll', 'keyup'].forEach(ev => addEventListener(ev, e => { if (!panel.contains(e.target)) ctxSoon(); }, true));
  window.addEventListener('hashchange', ctxSoon);

  /* ---------- rendering messages ---------- */
  function md(t) {   // tiny, safe markdown: **bold**, bullets, line breaks
    const lines = esc(t).split('\n'); let out = '', inList = false;
    for (const l of lines) {
      const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(l);
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      if (l.trim()) out += `<p>${l}</p>`;
    }
    if (inList) out += '</ul>';
    return out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function cardHTML(m) {
    const c = m.card; if (!c) return '';
    if (c.type === 'nokey') return `<div class="sat-card nokey"><b>Connect Grok to chat</b><p>Add your xAI API key in <b>Settings → Connect Grok</b> and I can summarize pages, answer questions and act on your notes. Find, Insert and Calculate work without it.</p><button data-a="settings">⚙︎ Open AI settings</button></div>`;
    if (c.type === 'summary') return `<div class="sat-card summary"><div class="sat-ch">📝 ${esc(c.title || 'Summary')}</div>${md(c.text)}</div>`;
    if (c.type === 'hits') return `<div class="sat-card hits"><div class="sat-ch">🔎 ${c.hits.length ? `${c.hits.length} match${c.hits.length === 1 ? '' : 'es'} for “${esc(c.q)}”` : `Nothing found for “${esc(c.q)}”`}</div>${c.hits.map((h, i) => `<button class="sat-hit" data-a="hit" data-i="${i}"><b>${esc(h.title)}</b><small>p.${h.pi + 1} · ${esc(h.kind || '')}</small><span>${h.m ? `${esc(h.m[0])}<mark>${esc(h.m[1])}</mark>${esc(h.m[2])}` : esc(h.s)}</span></button>`).join('')}</div>`;
    if (c.type === 'action') return `<div class="sat-card action ${c.ok ? 'ok' : 'err'}"><div class="sat-ch">${c.ok ? '✓' : '⚠︎'} ${esc(c.text)}</div>${c.ok && ST.undo.has(m.id) ? `<div class="sat-acts">${c.go ? '<button data-a="go">Show me</button>' : ''}<button data-a="undo">↶ Undo</button></div>` : ''}</div>`;
    if (c.type === 'confirm') return `<div class="sat-card confirm"><div class="sat-ch">⚠︎ ${esc(c.text)}</div>${ST.pending.has(m.id) ? '<div class="sat-acts"><button data-a="cancel">Cancel</button><button class="danger" data-a="confirm">' + esc(c.yes || 'Yes, do it') + '</button></div>' : `<small>${esc(c.done || 'Cancelled')}</small>`}</div>`;
    if (c.type === 'calc') return `<div class="sat-card calc"><div class="sat-ch">🧮 Calculated</div>${c.rows.map(r => `<div class="sat-row ${r.ok ? '' : 'err'}"><code>${esc(r.expr)}</code><b>${esc(r.ok ? '= ' + r.display : '⚠︎ ' + r.error)}</b></div>`).join('')}<div class="sat-acts">${c.sent ? '<small>✓ On the Calculator Board</small><button data-a="board">Open board</button>' : '<button data-a="send">Send to Calculator Board</button>'}</div></div>`;
    return '';
  }
  function renderMsgs() {
    if (!ST.open) return;
    if (!ST.msgs.length) {
      msgsEl.innerHTML = `<div class="sat-hello"><b>Hi! I'm Grok, right inside your notes.</b><p>I can see what's on this page${hasKey() ? '' : ' (once you connect me)'} — try <i>Summarize</i>, <i>Find “Acme”</i>, <i>Insert a Quote sheet</i> or <i>12% of 480</i>.</p></div>` + (hasKey() ? '' : cardHTML({ card: { type: 'nokey' } }));
    } else {
      msgsEl.innerHTML = ST.msgs.map(m => `<div class="sat-m ${m.role}" data-id="${m.id}">${m.text ? `<div class="sat-b">${m.role === 'bot' ? md(m.text) : esc(m.text)}</div>` : ''}${cardHTML(m)}</div>`).join('') + (ST.busy ? '<div class="sat-m bot"><div class="sat-b sat-typing"><i></i><i></i><i></i></div></div>' : '');
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  /* ==================== actions ==================== */
  function pageAction(label, fn) {   // run a page change; undo = the app's own undo stack
    const n = curNote(); if (!n) return { ok: false, text: 'Open a note first' };
    if (sealedNote(n)) return { ok: false, text: 'This note is locked — unlock it first' };
    const QB = G('QB'); if (QB && QB.open && QB.mode !== 'inbox' && document.getElementById('qbDrawer').classList.contains('full')) { const q = G('qbOpen'); if (q) q(false); }   // a full-width board would hide the page
    const before = S.undo.length, top = S.undo[S.undo.length - 1], pages = n.pages.map(p => p.id);
    let r; try { r = fn(n); } catch (e) { console.warn(e); return { ok: false, text: `Couldn't ${label}: ${e.message}` }; }
    if (r && r.ok === false) return r;
    const added = n.pages.findIndex(p => !pages.includes(p.id));
    return { ok: true, text: typeof r === 'string' ? r : (r && r.text) || label, undo: S.undo.length !== before || S.undo[S.undo.length - 1] !== top ? () => { const rs = G('restore'); if (rs) rs(S.undo, S.redo); } : null, go: added >= 0 ? added : (r && r.pi != null ? r.pi : null) };
  }
  function scrollToPage(pi) { const els = G('pageEls') || [], w = document.getElementById('pages'); if (els[pi] && w) w.scrollTo({ top: els[pi].el.offsetTop - 8, behavior: 'smooth' }); }
  function lowestY(pg) {
    let y = 60;
    for (const s of pg.strokes || []) for (const p of s.points) y = Math.max(y, p[1]);
    for (const t of pg.texts || []) y = Math.max(y, t.y + (t.size || 24) * 1.3);
    for (const t of pg.tasks || []) if (t.kind !== 'card') y = Math.max(y, t.y + (t.h || 40));
    for (const sc of pg.sections || []) y = Math.max(y, sc.y + 36);
    return y;
  }
  const TOOLS = {
    insert_template({ template }) {
      const t = String(template || '').toLowerCase();
      if (/quote/.test(t)) { if (!window.V21ed || !V21ed.insertSheet) return { ok: false, text: 'Quote sheets need v21ed' }; return pageAction('Inserted a 🧾 Quote sheet', () => { V21ed.insertSheet(); return 'Inserted a 🧾 Quote sheet'; }); }
      if (/to-?do|daily/.test(t)) { if (!window.V21ee || !V21ee.insertTodo) return { ok: false, text: 'The Daily To-Do page isn’t available in this build yet' }; return pageAction('Inserted a ✅ Daily To-Do page', () => { V21ee.insertTodo(); return 'Inserted a ✅ Daily To-Do page'; }); }
      if (/num/.test(t)) {
        const ins = G('insertSectionAt'); if (!ins) return { ok: false, text: 'Numbers aren’t available' };
        return pageAction('Added a number', n => { const pi = visiblePi(), pg = n.pages[pi]; if (pg.qsheet || pg.todo || (G('isBoardPage') && G('isBoardPage')(pg))) return { ok: false, text: 'Numbers go on a writing page — this one is a template' };
          const y = Math.min(1400, lowestY(pg) + 56); const sc = ins(pi, [30, y]); let k = 0; try { k = typeof secNumber === 'function' ? secNumber(n, pg, sc) : 0; } catch (_) {}
          return { ok: true, text: `Added number ${k ? k + '. ' : ''}on page ${pi + 1} — write next to it`, pi }; });
      }
      return { ok: false, text: `I don't know the “${template}” template` };
    },
    add_page({ paper }) {
      return pageAction('Added a page', n => { const pi = visiblePi(); const kind = ['lined', 'grid', 'blank'].includes(paper) ? paper : null;
        if (window.V21ec && V21ec.insertPage) { const p = V21ec.insertPage(pi, 'after'); if (kind && p) { p.paper = kind; saveNote(n); buildPages(); } }
        else { pushHistory(); const p = makeTemplatePage(kind || 'lined', n); n.pages.splice(pi + 1, 0, p); saveNote(n); buildPages(); }
        return `Added a ${kind ? kind + ' ' : ''}page after page ${pi + 1}`; });
    },
    create_idea({ title, column }) {
      const ens = G('ensureIdeaNote'), cols = G('boardCols'), IPI = G('IPI'); if (!ens || !cols) return { ok: false, text: 'The Idea Board isn’t available' };
      if ((G('ibSealed') || (() => false))()) return { ok: false, text: 'Unlock the Idea Board first' };
      const text = String(title || '').trim().slice(0, 200); if (!text) return { ok: false, text: 'What should the idea say?' };
      const n = ens(), pg = n.pages[0], cs = cols(pg), col = cs.find(c => c.title.toLowerCase() === String(column || '').toLowerCase()) || cs[0];
      const h = G('bH'); if (h) h(IPI);
      const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1, text, strokes: [], done: false, due: null, repeat: '', notified: false, createdAt: Date.now(), src: 'satellite' };
      pg.tasks.push(t); const rn = G('renumber'); if (rn) rn(pg, col.id); saveNote(n, true);
      const QB = G('QB'); if (QB && QB.open && QB.mode === 'ideas') { const r = G('qbRender'); if (r) r(); }
      return { ok: true, text: `Added “${text}” to 💡 Idea Board › ${col.title}`, undo: () => { const u = G('bUndo'); if (u) u(IPI); const QB2 = G('QB'); if (QB2 && QB2.open && QB2.mode === 'ideas') { const r = G('qbRender'); if (r) r(); } }, board: 'ideas' };
    },
    calculate({ expressions, send_to_board }) {
      const list = (Array.isArray(expressions) ? expressions : [expressions]).map(x => String(x || '').trim()).filter(Boolean).slice(0, 12);
      if (!list.length || !window.CalcMath) return { ok: false, text: 'Nothing to calculate' };
      const resolve = nm => { if (!window.CalcBoard) return undefined; const v = CalcBoard.value(nm); return v && v.ok ? v.value : undefined; };
      const rows = list.map(expr => { const r = CalcMath.evalText(expr, { resolve }); return { expr, ok: r.ok, display: r.display, error: r.error }; });
      const QB = G('QB'), onCalc = QB && QB.open && QB.mode === 'calc';
      const card = { type: 'calc', rows, sent: false };
      if ((send_to_board || onCalc) && window.CalcBoard) { sendToBoard(card); }
      return { card };
    },
    search_notes({ query }) { return { card: searchCard(query) }; },
    open_board({ board }) { const b = /calc/i.test(board) ? 'calc' : /idea/i.test(board) ? 'ideas' : null; if (!b) return { ok: false, text: 'Unknown board' }; const q = G('qbOpen'); if (q) q(true, { mode: b }); return { ok: true, text: `Opened the ${b === 'calc' ? '🧮 Calculator Board' : '💡 Idea Board'}` }; },
    delete_page({ page }) {
      const n = curNote(); if (!n) return { ok: false, text: 'Open a note first' };
      const pi = Math.round(+page || 0) - 1; if (!(pi >= 0 && pi < n.pages.length)) return { ok: false, text: `There is no page ${page}` };
      if (n.pages.length < 2) return { ok: false, text: 'A note needs at least one page' };
      return { confirm: { text: `Delete page ${pi + 1} of “${n.title}”?`, yes: `Delete page ${pi + 1}`, run: () => pageAction(`Deleted page ${pi + 1}`, nn => { pushHistory(); nn.pages.splice(pi, 1); saveNote(nn); buildPages(); renderAll(); return `Deleted page ${pi + 1}`; }) } };
    },
  };
  const DESTRUCTIVE = new Set(['delete_page']);
  function sendToBoard(card) {
    if (!window.CalcBoard || !CalcBoard.addTyped) return false;
    for (const r of card.rows) if (r.ok || r.expr) CalcBoard.addTyped(r.expr);
    card.sent = true; return true;
  }
  function searchCard(query) {
    const q = String(query || '').trim(); let hits = [];
    if (q.length >= 2) {
      if (window.V21ee && V21ee.search) hits = V21ee.search(q, 8).map(h => { const sn = h.s && typeof h.s === 'object' ? [h.s.pre || '', h.s.hit || '', h.s.post || ''] : null; return { noteId: h.note.id, pageId: h.pg.id, pi: h.pi, title: h.note.title, kind: h.kind === 'ink' ? '✍️ handwriting' : h.kind, s: sn ? sn.join('') : String(h.s || h.t || '').slice(0, 80), m: sn, bb: h.bb }; });
      else { const nq = q.toLowerCase(); for (const n of S.notes) { if (sealedNote(n)) continue; n.pages.forEach((pg, pi) => { const t = pageText(pg) + ' ' + n.title; const i = t.toLowerCase().indexOf(nq); if (i >= 0 && hits.length < 8) hits.push({ noteId: n.id, pageId: pg.id, pi, title: n.title, kind: 'text', s: t.slice(Math.max(0, i - 30), i + 50) }); }); } }
    }
    return { type: 'hits', q, hits };
  }
  function openHit(h) {
    const n = S.notes.find(x => x.id === h.noteId); if (!n) return say('That note is gone');
    const pg = n.pages.find(p => p.id === h.pageId) || n.pages[h.pi];
    if (window.V21ee && V21ee.openHit) return V21ee.openHit({ note: n, pg, pi: n.pages.indexOf(pg), bb: h.bb });
    openNote(n.id); setTimeout(() => scrollToPage(n.pages.indexOf(pg)), 80);
  }
  function runAction(a) {
    const name = String(a && a.tool || ''), fn = TOOLS[name]; if (!fn) return push({ role: 'bot', card: { type: 'action', ok: false, text: `I can't do “${name}” here` } });
    let r; try { r = fn(a.args || {}); } catch (e) { console.warn(e); r = { ok: false, text: 'Something went wrong: ' + e.message }; }
    if (r.confirm) { const m = push({ role: 'bot', card: { type: 'confirm', text: r.confirm.text, yes: r.confirm.yes } }); ST.pending.set(m.id, r.confirm.run); renderMsgs(); return m; }
    if (r.card) return push({ role: 'bot', card: r.card });
    const m = { role: 'bot', id: sid(), card: { type: 'action', ok: !!r.ok, text: r.text, go: r.go != null } };
    if (r.ok && r.undo) ST.undo.set(m.id, { undo: r.undo, go: r.go, board: r.board });
    push(m); if (r.ok) refreshCtx(); return m;
  }

  /* ==================== talking to Grok ==================== */
  const SYS = `You are Grok, the assistant built into Pencil Notes — a handwriting notes app on iPad (Apple Pencil). You see the user's current context (notebook, note, the page's recognized handwriting, any lasso selection, and an open board) in CONTEXT below. Be brief and practical; plain words, no filler.
Respond ONLY with a JSON object: {"reply": "markdown text for the user", "summary_title": "optional short title when you summarize", "actions": [ {"tool": "<name>", "args": { ... }} ]}
Use actions only when the user asks for something to be done. Tools:
- search_notes {"query": string} — find text across all notes (handwriting included)
- insert_template {"template": "quote_sheet" | "daily_todo" | "number"} — Quote sheet / Daily To-Do page, or the next section number on the current page
- add_page {"paper": "lined" | "grid" | "blank"} — new page after the current one
- create_idea {"title": string, "column": "To Do" | "Doing" | "Done"} — a card on the Idea Board
- calculate {"expressions": [string], "send_to_board": boolean} — exact math by the app (use * / ^ % sqrt(), names like A or B from the Calculator Board); never do arithmetic yourself, call this
- open_board {"board": "calc" | "ideas"}
- delete_page {"page": number} — destructive; the app asks the user to confirm
When summarizing, put a one-line summary_title and 3–6 bullet points in reply. Only use facts from CONTEXT; if the page has no recognized text, say so.`;
  async function askGrok(text, { summarize } = {}) {
    if (!hasKey()) { push({ role: 'bot', card: { type: 'nokey' } }); return; }
    const c = context(); if (c.sel) await readSelection(c.sel);
    if (summarize && !c.page && !c.sel && !c.board) {    // let part A read the page first
      const n = curNote(); if (n && window.V21ee && V21ee.indexPage) { try { await V21ee.indexPage(n, n.pages[c.pi]); c.page = pageText(n.pages[c.pi]); } catch (_) {} }
    }
    const hist = ST.msgs.filter(m => m.text).slice(-9, -1).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text.slice(0, 1500) }));
    const msgs = [{ role: 'system', content: SYS }, { role: 'system', content: 'CONTEXT:\n' + (contextBlock(c) || '(nothing open)') }, ...hist, { role: 'user', content: text }];
    ST.busy = true; renderMsgs();
    let raw = '', j = null;
    try { raw = await G('aiRequest')(msgs, { json: true, timeout: 45000 }); }
    catch (e) { ST.busy = false; push({ role: 'bot', card: { type: 'action', ok: false, text: `Grok couldn’t answer (${e.name === 'AbortError' ? 'timed out' : e.message})` } }); return; }
    ST.busy = false;
    try { const t = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, '').trim(), m = t.match(/\{[\s\S]*\}/); j = JSON.parse(m ? m[0] : t); } catch (_) { j = { reply: String(raw || '') }; }
    const reply = String(j.reply || '').trim(), acts = Array.isArray(j.actions) ? j.actions.slice(0, 5) : [];
    if (summarize || j.summary_title) push({ role: 'bot', card: { type: 'summary', title: j.summary_title || (c.sel ? 'Selection summary' : 'Page summary'), text: reply || '(nothing to summarize)' } });
    else if (reply) push({ role: 'bot', text: reply });
    for (const a of acts) runAction(a);
    if (!reply && !acts.length && !summarize) push({ role: 'bot', text: 'Sorry, I didn’t get that.' });
  }
  // fast local paths (no Grok round-trip; also what works without a key)
  function localIntent(t) {
    let m;
    if ((m = /^(?:find|search(?: for)?)\s+["“]?(.+?)["”]?$/i.exec(t))) return { tool: 'search_notes', args: { query: m[1] } };
    if ((m = /^(?:=|calc(?:ulate)?:?)\s*(.+)$/i.exec(t))) return { tool: 'calculate', args: { expressions: m[1].split(/\s*;\s*|\n/) } };
    if (window.CalcMath && /\d/.test(t) && /[-+*/^%×÷√=]|\bof\b/.test(t) && !/[a-z]{4,}/i.test(t.replace(/\b(?:of|sqrt|round|sum|avg|median|margin|markup)\b/gi, ''))) { const r = CalcMath.evalText(t, {}); if (r.ok || /divide|undefined/i.test(r.error)) return { tool: 'calculate', args: { expressions: [t] } }; }
    if (!hasKey()) {
      if (/quote\s*sheet|insert.*quote/i.test(t)) return { tool: 'insert_template', args: { template: 'quote_sheet' } };
      if (/to-?do|daily/i.test(t) && /insert|add|new|page/i.test(t)) return { tool: 'insert_template', args: { template: 'daily_todo' } };
      if (/insert.*number|add.*number/i.test(t)) return { tool: 'insert_template', args: { template: 'number' } };
      if (/^(?:add|new|insert)\s+(?:a\s+)?page/i.test(t)) return { tool: 'add_page', args: {} };
      if ((m = /^(?:idea|new idea|add idea)[:\s]+(.+)$/i.exec(t))) return { tool: 'create_idea', args: { title: m[1] } };
    }
    return null;
  }
  async function send(text, opts = {}) {
    const t = String(text || '').trim(); if (!t || ST.busy) return;
    loadChat(); push({ role: 'user', text: t }); inp.value = '';
    const li = opts.summarize ? null : localIntent(t);
    if (li) { runAction(li); return; }
    await askGrok(t, opts);
  }

  /* ---------- panel events ---------- */
  $p('.sat-form').addEventListener('submit', e => { e.preventDefault(); send(inp.value); });
  panel.addEventListener('click', e => {
    const s = e.target.closest('[data-s]'), q = e.target.closest('[data-q]'), ins = e.target.closest('[data-ins]'), a = e.target.closest('[data-a]');
    if (s) {
      const k = s.dataset.s;
      if (k === 'close') return close();
      if (k === 'menu') { $p('.sat-menu').hidden = !$p('.sat-menu').hidden; return; }
      if (k === 'ctx') { const d = $p('.sat-ctxd'); d.hidden = !d.hidden; if (!d.hidden) d.innerHTML = ctxDetail(context()); return; }
      if (k === 'mic') return toggleMic();
      if (k === 'settings') { $p('.sat-menu').hidden = true; const o = G('openSettings'); if (o) o('ai'); return; }
      if (k === 'clear') { $p('.sat-menu').hidden = true; const m = push({ role: 'bot', card: { type: 'confirm', text: `Clear the Grok chat for “${ST.ctx && ST.ctx.notebook || 'this notebook'}”?`, yes: 'Clear chat' } }); ST.pending.set(m.id, () => { ST.msgs = []; saveChat(); return { ok: true, text: 'Chat cleared', silent: true }; }); renderMsgs(); return; }
    }
    if (q) {
      const k = q.dataset.q; $p('.sat-ins').hidden = k !== 'insert' || !$p('.sat-ins').hidden;
      if (k === 'summarize') { const c = context(); return send(c.sel ? 'Summarize my lasso selection' : c.board && !c.note ? `Summarize the ${c.board.label}` : 'Summarize this page', { summarize: true }); }
      if (k === 'find') { inp.value = 'Find '; inp.focus(); inp.setSelectionRange(5, 5); return; }
      if (k === 'calc') { const c = context(); if (c.sel && c.sel.text) return send('calc ' + c.sel.text.replace(/\n/g, '; ')); inp.value = '= '; inp.focus(); inp.setSelectionRange(2, 2); return; }
      return;
    }
    if (ins) {
      $p('.sat-ins').hidden = true; const k = ins.dataset.ins;
      if (k === 'idea') { inp.value = 'idea: '; inp.focus(); if (hasKey()) inp.value = 'Add an idea: '; inp.setSelectionRange(inp.value.length, inp.value.length); return; }
      loadChat(); push({ role: 'user', text: { quote_sheet: 'Insert a Quote sheet', daily_todo: 'Insert a Daily To-Do page', number: 'Insert the next number', page: 'Add a page' }[k] });
      return runAction(k === 'page' ? { tool: 'add_page', args: {} } : { tool: 'insert_template', args: { template: k } });
    }
    if (a) {
      const mEl = a.closest('.sat-m'), m = mEl && ST.msgs.find(x => x.id === mEl.dataset.id), k = a.dataset.a;
      if (k === 'settings') { const o = G('openSettings'); if (o) o('ai'); return; }
      if (!m) return;
      if (k === 'hit') return openHit(m.card.hits[+a.dataset.i]);
      if (k === 'undo') { const u = ST.undo.get(m.id); if (u) { u.undo(); ST.undo.delete(m.id); m.card.text += ' — undone'; m.card.ok = true; saveChat(); renderMsgs(); refreshCtx(); say('Undone', 1200); } return; }
      if (k === 'go') { const u = ST.undo.get(m.id); if (u && u.go != null) scrollToPage(u.go); return; }
      if (k === 'send') { if (sendToBoard(m.card)) { saveChat(); renderMsgs(); say('🧮 Sent to the Calculator Board', 1500); } return; }
      if (k === 'board') { const qo = G('qbOpen'); if (qo) qo(true, { mode: 'calc' }); return; }
      if (k === 'cancel' || k === 'confirm') {
        const run = ST.pending.get(m.id); ST.pending.delete(m.id);
        if (k === 'cancel' || !run) { m.card.done = 'Cancelled — nothing changed'; saveChat(); renderMsgs(); return; }
        const r = run(); m.card.done = r && r.ok ? '✓ Done' : '⚠︎ ' + (r && r.text || 'Failed');
        if (r && r.silent) { renderMsgs(); return; }
        saveChat(); const nm = { role: 'bot', id: sid(), card: { type: 'action', ok: !!(r && r.ok), text: r ? r.text : 'Failed', go: false } };
        if (r && r.ok && r.undo) ST.undo.set(nm.id, { undo: r.undo }); push(nm); refreshCtx();
      }
    }
  });
  document.addEventListener('pointerdown', e => { const m = $p('.sat-menu'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('[data-s="menu"]')) m.hidden = true; }, true);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  /* ---------- 🎤 voice (Web Speech API, where the browser has it) ---------- */
  function toggleMic() { if (ST.rec) return stopMic(); if (!SR) return;
    const r = new SR(); ST.rec = r; r.lang = navigator.language || 'en-US'; r.interimResults = true; r.continuous = false;
    const base = inp.value; $p('.sat-mic').classList.add('on');
    r.onresult = e => { let t = ''; for (const x of e.results) t += x[0].transcript; inp.value = (base ? base + ' ' : '') + t; if (e.results[e.results.length - 1].isFinal) { stopMic(); send(inp.value); } };
    r.onerror = () => stopMic(); r.onend = () => stopMic();
    try { r.start(); } catch (_) { stopMic(); } }
  function stopMic() { const r = ST.rec; ST.rec = null; $p('.sat-mic').classList.remove('on'); if (r) { try { r.stop(); } catch (_) {} } }

  place();
  window.Satellite = { version: 'v21ee-c', open, close, toggle, send, context, contextBlock, pageText, state: ST, tools: TOOLS, runAction, localIntent, SYS,
    get pos() { return { ...pos }; }, dock(edge, t) { pos = { edge, t }; localStorage.setItem('satPos', JSON.stringify(pos)); place(); }, refresh: refreshCtx };
})();
