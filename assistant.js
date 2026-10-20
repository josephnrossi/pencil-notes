/* Pencil Notes v15 — 🤖 Assistant whiteboard.
   Drop / paste an email (or any text) → an assistant card: sender · subject · date, summary, key points, action items (owner + due),
   deadlines & meetings, original text. Data: pg.bg = {type:'template', name:'assistant'}, pg.assist = {cards:[…]} (page content → undo,
   export and Pencil Lock encryption come for free). Engines: AssistEngine (built-in, offline) or the user's own OpenAI-compatible key. */
const AS_W = 462, AS_H = 560, AS_TOP = 236, AS_MIN_W = 300, AS_MIN_H = 240;
const AS = { g: null, busy: false };
const isAssistPage = pg => !!(pg && pg.bg && pg.bg.type === 'template' && pg.bg.name === 'assistant');
const asCards = pg => (pg.assist ||= { cards: [] }).cards;
const fmtWhen = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const fmtDueShort = iso => typeof fmtDue === 'function' ? fmtDue(iso) : fmtWhen(iso);

function drawAssistBg(ctx) {
  ctx.save(); ctx.fillStyle = isDark() ? 'rgba(165,180,252,.10)' : 'rgba(79,70,229,.12)';
  for (let y = 40; y < PAGE_H; y += 40) for (let x = 40; x < PAGE_W; x += 40) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

/* ---------- drop / paste intake ---------- */
const ASLOG_KEY = 'assistDropLog';
function logTransfer(entry) { let l = []; try { l = JSON.parse(localStorage.getItem(ASLOG_KEY) || '[]'); } catch (_) {} l.unshift(entry); localStorage.setItem(ASLOG_KEY, JSON.stringify(l.slice(0, 8))); document.querySelectorAll('.as-dbg pre').forEach(p => p.textContent = dbgText()); }
function dbgText() { let l = []; try { l = JSON.parse(localStorage.getItem(ASLOG_KEY) || '[]'); } catch (_) {} return l.length ? l.map(e => `${new Date(e.at).toLocaleTimeString()} · ${e.source}\n  types: ${e.types.join(', ') || '(none)'}\n${e.items.length ? '  items: ' + e.items.map(i => i.kind + ':' + (i.type || '?')).join(', ') + '\n' : ''}${e.files.length ? '  files: ' + e.files.map(f => `${f.name || '(no name)'} [${f.type || '?'}] ${f.size}B`).join(', ') + '\n' : ''}  lengths: ${Object.entries(e.lengths).map(([k, v]) => k + '=' + v).join(', ') || '—'}`).join('\n\n') : 'Nothing received yet. Drag an email here and this shows exactly what iPadOS handed over (types and sizes only, never the content).'; }
// Snapshot a DataTransfer synchronously (its data disappears after the event)
function snapTransfer(dt) {
  const types = [...(dt.types || [])], strings = {}, lengths = {};
  for (const t of types) { if (t === 'Files') continue; try { const v = dt.getData(t); if (v) { strings[t] = v; lengths[t] = v.length; } } catch (_) {} }
  for (const t of ['text/plain', 'text/html', 'text/uri-list', 'URL', 'Text']) if (!strings[t]) { try { const v = dt.getData(t); if (v) { strings[t] = v; lengths[t] = v.length; } } catch (_) {} }
  const files = [...(dt.files || [])];
  const items = [...(dt.items || [])].map(i => ({ kind: i.kind, type: i.type }));
  return { types, strings, lengths, files, items };
}
const linkOnly = s => s && s.trim().split(/\s+/).every(l => /^(message|https?|mailto|x-apple[\w.-]*|mail):/i.test(l) || l.startsWith('#'));
async function intake(snap, source, pi) {
  logTransfer({ at: Date.now(), source, types: snap.types, items: snap.items, files: snap.files.map(f => ({ name: f.name, type: f.type, size: f.size })), lengths: snap.lengths });
  const S0 = snap.strings;
  // 1. files: .eml / message/rfc822, .txt, .html
  for (const f of snap.files) {
    const name = (f.name || '').toLowerCase(), type = (f.type || '').toLowerCase();
    if (/\.eml$|\.emlx$|\.msg$/.test(name) || type === 'message/rfc822') { const raw = await f.text(); return addEmail(pi, AssistEngine.parseEml(raw.replace(/^\d+\s*\n/, '')), { kind: 'email', via: source + ' · ' + (f.name || 'email file') }); }
    if (type.startsWith('text/html') || /\.html?$/.test(name)) return addText(pi, AssistEngine.htmlToText(await f.text()), { via: source + ' · ' + f.name });
    if (type.startsWith('text/') || /\.(txt|md|text)$/.test(name)) { const t = await f.text(); return /^(received|return-path|mime-version|from|message-id|delivered-to):/im.test(t.slice(0, 600)) && /\n\s*\n/.test(t) && /^subject:/im.test(t) ? addEmail(pi, AssistEngine.parseEml(t), { kind: 'email', via: source + ' · ' + f.name }) : addText(pi, t, { via: source + ' · ' + f.name }); }
  }
  // 2. text
  const html = S0['text/html'], plain = S0['text/plain'] || S0['Text'], uri = S0['text/uri-list'] || S0['URL'];
  if (plain && /^(received|return-path|mime-version|delivered-to|message-id):/im.test(plain.slice(0, 400)) && /^subject:/im.test(plain)) return addEmail(pi, AssistEngine.parseEml(plain), { kind: 'email', via: source + ' · raw email' });
  if (plain && plain.trim() && !linkOnly(plain)) return addText(pi, plain, { via: source + ' · text', html });
  if (html && html.trim()) { const t = AssistEngine.htmlToText(html); if (t.trim() && !linkOnly(t)) return addText(pi, t, { via: source + ' · html' }); }
  if (snap.files.length) { toast('That file type isn’t supported yet — drop an email (.eml), text or HTML', 4200); return null; }
  if (uri || linkOnly(plain)) { const msg = /message:/i.test(uri || plain || '') ? 'Mail only shared a link — select the email text and drag it, or use Copy → Paste' : 'Only a link arrived — select the text itself and drag it, or use Copy → Paste'; toast(msg, 6000); flashDrop(pi, msg); return null; }
  toast('Nothing readable arrived — try Copy → 📋 Paste', 4200); return null;
}
function flashDrop(pi, msg) { const z = pageEls[pi] && pageEls[pi].ov.querySelector('.as-drop'); if (!z) return; const m = z.querySelector('.as-msg'); if (m) { m.textContent = msg; m.hidden = false; } z.classList.remove('nope'); void z.offsetWidth; z.classList.add('nope'); }
function addText(pi, text, opts = {}) {
  const { h, body } = AssistEngine.splitHeaderBlock(String(text).replace(/\r/g, ''));
  const date = h.date || h.sent ? new Date(h.date || h.sent) : null;
  return addEmail(pi, { from: h.from || '', to: h.to || '', subject: h.subject || '', date: date && !isNaN(date) ? date : null, text: body }, { kind: h.from || h.subject ? 'email' : 'text', ...opts });
}

/* ---------- cards ---------- */
function autoTitle(t) {
  const l = String(t || '').split('\n').map(x => x.trim()).find(x => x && !/^(hi|hey|hello|dear|good (morning|afternoon|evening))\b/i.test(x)); if (!l) return '';
  const s = l.split(/(?<=[.!?])\s/)[0].replace(/[.!?:]+$/, ''); return s.length > 64 ? s.slice(0, 61).replace(/\s+\S*$/, '') + '…' : s;
}
function freeSlot(pg) {
  const cards = asCards(pg), slots = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) slots.push([24 + c * (AS_W + 28), AS_TOP + r * (AS_H + 24)]);
  return slots.find(([x, y]) => !cards.some(k => x < k.x + k.w && k.x < x + AS_W && y < k.y + k.h && k.y < y + AS_H)) || null;
}
function resultToCard(r) {
  return { summary: r.summary || '', points: (r.points || []).slice(0, 6), actions: (r.actions || []).map(a => ({ id: uid('aa'), text: a.text, owner: a.owner || '', due: a.due || null, dueText: a.dueText || '' })),
    meetings: (r.meetings || []).map(m => ({ id: uid('am'), title: m.title, start: m.start, end: m.end || null, where: m.where || '' })), deadlines: (r.deadlines || []).map(d => ({ text: d.text, due: d.due })) };
}
async function addEmail(pi, email, opts = {}) {
  let n = curNote(), pg = n.pages[pi]; if (!isAssistPage(pg)) return null;
  const now = new Date(), ref = email.date && !isNaN(email.date) ? email.date : now;
  const r = AssistEngine.extract({ ...email, date: ref });
  pushHistory();
  let slot = freeSlot(pg);
  if (!slot) { const np = makeTemplatePage('assistant', n); n.pages.splice(pi + 1, 0, np); pi = pi + 1; pg = np; slot = freeSlot(pg); }
  const card = { id: uid('ac'), x: slot[0], y: slot[1], w: AS_W, h: AS_H, kind: opts.kind || 'email', from: r.from || email.from || '', to: email.to || '', subject: email.subject || autoTitle(email.text) || (opts.kind === 'text' ? 'Pasted text' : ''),
    date: email.date && !isNaN(email.date) ? new Date(email.date).toISOString() : null, ref: ref.toISOString(), ...resultToCard(r), raw: String(email.text || '').slice(0, 20000), engine: 'Built-in', via: opts.via || '', createdAt: Date.now(), ...(opts.ink ? { ink: opts.ink } : {}) };
  if (opts.ink && !String(email.text || '').trim()) { card.summary = 'Handwritten note — attached below. Handwriting can’t be read by the assistant; add typed text to get a summary.'; card.kind = 'ink'; card.subject = card.subject || 'Handwriting'; }
  asCards(pg).push(card); saveNote(n, true);
  if (opts.rebuild !== false) buildPages(); else renderOverlay(pi);
  requestAnimationFrame(() => { const el = document.querySelector(`.as-card[data-card="${card.id}"]`); if (el) { el.classList.add('appear'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTimeout(() => el.classList.remove('appear'), 900); } });
  toast(`🤖 ${r.actions.length} action item${r.actions.length === 1 ? '' : 's'} found`, 1800);
  if (aiCfg().on && aiCfg().key && card.kind !== 'ink') smarten(n.id, pg.id, card.id, email, ref);
  return card;
}
function findAsCard(id) { for (const n of S.notes) for (let i = 0; i < n.pages.length; i++) { const c = (n.pages[i].assist || { cards: [] }).cards.find(k => k.id === id); if (c) return { n, pi: i, pg: n.pages[i], c }; } return null; }

/* ---------- rendering ---------- */
function inkThumbURL(ink, W = 360, H = 120) {
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2; const x = c.getContext('2d');
  const bb = ink.bb, sc = Math.min((W - 16) / Math.max(1, bb[2] - bb[0]), (H - 16) / Math.max(1, bb[3] - bb[1]), 1.5);
  x.scale(2, 2); x.translate(8 - bb[0] * sc, 8 - bb[1] * sc); x.scale(sc, sc);
  for (const st of ink.strokes) drawStroke(x, st);
  return c.toDataURL();
}
function cardHTMLAs(c) {
  const acts = c.actions || [], mt = c.meetings || [], dl = (c.deadlines || []).filter(d => !mt.some(m => m.start === d.due));
  return `<div class="as-card ${c.kind}" data-card="${c.id}">
    <div class="as-head" title="Hold to move"><div class="as-hl"><div class="as-from">${c.kind === 'email' ? '✉️ ' : c.kind === 'ink' ? '✍︎ ' : '📝 '}${esc(c.from || (c.kind === 'text' ? 'Text' : 'Unknown sender'))}</div>
      <div class="as-subj">${esc(c.subject || '(no subject)')}</div>
      <div class="as-meta">${c.date ? esc(fmtWhen(c.date)) + ' · ' : ''}<span class="as-eng ${c.engine === 'Built-in' ? '' : 'ai'}" title="${esc(c.engineNote || '')}">${c.engine === 'Built-in' ? '⚙︎ Built-in' : '✨ ' + esc(c.engine)}${c.engineNote ? ' ⚠︎' : ''}</span>${c.pending ? ' <span class="as-spin">AI summarizing…</span>' : ''}</div></div>
      <button class="as-more" data-aa="menu" aria-label="Card options">⋯</button></div>
    <div class="as-body">
      <p class="as-sum">${esc(c.summary || '')}</p>
      ${(c.points || []).length ? `<h4>Key points</h4><ul class="as-pts">${c.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      <h4>Action items <span class="as-n">${acts.length}</span></h4>
      ${acts.length ? `<ul class="as-acts">${acts.map(a => `<li class="as-act ${a.sent ? 'sent' : ''}" data-act="${a.id}"><span class="as-grip" aria-label="Drag to a board or planner">⠿</span><span class="as-at">${esc(a.text)}</span>
        <span class="as-chips">${a.owner ? `<span class="as-own">👤 ${esc(a.owner)}</span>` : ''}${a.due ? `<span class="as-due">⏰ ${esc(fmtDueShort(a.due))}</span>` : ''}${a.sent ? `<span class="as-sent">${a.sent.to === 'board' ? '📋 on board' : '🗓 on planner'}</span>` : ''}</span></li>`).join('')}</ul>
        <button class="as-btn" data-aa="sendall">📋 Send all to board…</button>` : '<p class="as-none">No action items found.</p>'}
      ${mt.length || dl.length ? `<h4>Deadlines &amp; meetings</h4><ul class="as-dl">${mt.map(m => `<li>📅 <b>${esc(m.title)}</b> · ${esc(fmtWhen(m.start))}${m.where ? ' · ' + esc(m.where) : ''} <button class="as-btn sm" data-aa="cal" data-m="${m.id}">📅 Add to Calendar</button></li>`).join('')}${dl.map(d => `<li>⏰ ${esc(fmtDueShort(d.due))} — ${esc(d.text)}</li>`).join('')}</ul>` : ''}
      ${c.ink ? `<h4>Handwriting (attachment)</h4><img class="as-ink" alt="Handwriting attachment" src="${inkThumbURL(c.ink)}">` : ''}
      ${c.raw && c.raw.trim() ? `<details class="as-raw" ${c.open ? 'open' : ''}><summary>Original text</summary><pre>${esc(c.raw)}</pre></details>` : ''}
    </div><div class="as-resize" aria-label="Resize"></div></div>`;
}
function renderAssist(pi) {
  const n = curNote(), pg = n && n.pages[pi], rec = pageEls[pi]; if (!rec || !isAssistPage(pg)) return;
  rec.ov.querySelectorAll('.as-layer').forEach(e => e.remove());
  const s = S.scale, L = document.createElement('div'); L.className = 'as-layer'; L.style.fontSize = (20 * s) + 'px';
  L.innerHTML = `<div class="as-drop" style="left:${24 * s}px;top:${24 * s}px;width:${(PAGE_W - 48) * s}px;height:${190 * s}px">
      <div class="as-dt">🤖 <b>Drop an email or text here</b></div><div class="as-ds">Drag a message from Mail (select its text first for best results) · or copy it and tap Paste</div>
      <div class="as-dbtns"><button class="as-btn" data-aa="paste">📋 Paste</button><button class="as-btn" data-aa="lasso">✍︎ Lasso into assistant</button><span class="as-msg" hidden></span></div>
      <details class="as-dbg"><summary>What did Mail send?</summary><pre>${esc(dbgText())}</pre></details>
      <div class="as-catch" contenteditable="true" aria-label="Paste target"></div></div>`
    + asCards(pg).map(cardHTMLAs).join('');
  rec.ov.append(L);
  for (const c of asCards(pg)) { const el = L.querySelector(`.as-card[data-card="${c.id}"]`); Object.assign(el.style, { left: c.x * s + 'px', top: c.y * s + 'px', width: c.w * s + 'px', height: c.h * s + 'px' }); }
  L.querySelectorAll('.as-raw').forEach(d => d.addEventListener('toggle', () => { const f = findAsCard(d.closest('.as-card').dataset.card); if (f && f.c.open !== d.open) { f.c.open = d.open; saveNote(f.n); } }));
}
const _asOverlayHook = v7OverlayHook;
v7OverlayHook = function (pi) { _asOverlayHook(pi); const n = curNote(); if (n && isAssistPage(n.pages[pi])) renderAssist(pi); };
const rerenderAssist = () => { const n = curNote(); if (n) n.pages.forEach((pg, i) => { if (isAssistPage(pg)) renderAssist(i); }); };

/* ---------- drop targets: anywhere on an assistant page ---------- */
const asPageAt = e => { const p = e.target.closest && e.target.closest('.page'); if (!p) return -1; const pi = +p.dataset.pi; return isAssistPage(curNote() && curNote().pages[pi]) ? pi : -1; };
PAGES.addEventListener('dragenter', e => { const pi = asPageAt(e); if (pi < 0) return; e.preventDefault(); pageEls[pi].ov.querySelector('.as-drop')?.classList.add('over'); });
PAGES.addEventListener('dragover', e => { const pi = asPageAt(e); if (pi < 0) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; pageEls[pi].ov.querySelector('.as-drop')?.classList.add('over'); });
PAGES.addEventListener('dragleave', e => { const pi = asPageAt(e); if (pi < 0) return; if (!e.relatedTarget || !pageEls[pi].el.contains(e.relatedTarget)) pageEls[pi].ov.querySelector('.as-drop')?.classList.remove('over'); });
PAGES.addEventListener('drop', e => {
  const pi = asPageAt(e); if (pi < 0) return;
  e.preventDefault(); e.stopPropagation(); pageEls[pi].ov.querySelector('.as-drop')?.classList.remove('over');
  if (isSealedNote()) return;
  const snap = snapTransfer(e.dataTransfer); intake(snap, 'drop', pi);
});
// never let a dropped file navigate the app away
window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => { if (e.defaultPrevented) return; if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); toast('Drop emails on a 🤖 Assistant page'); } });
const isSealedNote = () => typeof PencilLock !== 'undefined' && PencilLock.isSealed(curNote());
function assistPageInView() {
  const n = curNote(); if (!n) return -1; const cur = typeof currentPageIndex === 'function' ? currentPageIndex() : 0;
  if (isAssistPage(n.pages[cur])) return cur; return n.pages.findIndex(isAssistPage);
}
document.addEventListener('paste', e => {
  const t = e.target, inCatch = t.closest && t.closest('.as-catch');
  if (!inCatch && t.matches && t.matches('input, textarea, [contenteditable="true"], select')) return;
  const pi = inCatch ? +t.closest('.page').dataset.pi : assistPageInView(); if (pi < 0 || isSealedNote()) return;
  const n = curNote(); if (!inCatch && (typeof currentPageIndex !== 'function' || !isAssistPage(n.pages[currentPageIndex()]))) return;
  e.preventDefault(); if (inCatch) inCatch.textContent = '';
  intake(snapTransfer(e.clipboardData), 'paste', pi);
});
async function pasteButton(pi) {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read(), strings = {}, lengths = {}, types = [];
      for (const it of items) for (const ty of it.types) { types.push(ty); if (ty.startsWith('text/')) { const v = await (await it.getType(ty)).text(); strings[ty] = v; lengths[ty] = v.length; } }
      return intake({ types, strings, lengths, files: [], items: types.map(ty => ({ kind: 'string', type: ty })) }, 'paste button', pi);
    }
    const v = await navigator.clipboard.readText();
    return intake({ types: ['text/plain'], strings: { 'text/plain': v }, lengths: { 'text/plain': v.length }, files: [], items: [] }, 'paste button', pi);
  } catch (err) {
    const c = pageEls[pi] && pageEls[pi].ov.querySelector('.as-catch'); if (c) { c.classList.add('show'); c.focus(); }
    toast('Long-press here and tap Paste (or ⌘V)', 4000);
  }
}

/* ---------- card gestures: hold to move, resize, drag action items ---------- */
const AS_HOLD = 420, AS_SLOP = 8;
PAGES.addEventListener('pointerdown', e => {
  const card = e.target.closest('.as-card'); if (!card || AS.g || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const f = findAsCard(card.dataset.card); if (!f) return;
  const g = { pid: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, card, f, mode: 'pending' };
  const act = e.target.closest('.as-act'), btn = e.target.closest('button, summary, a, pre, .as-catch');
  if (e.target.closest('.as-resize')) { e.preventDefault(); e.stopPropagation(); g.mode = 'resize'; g.w0 = f.c.w; g.h0 = f.c.h; card.classList.add('sizing'); AS.g = g; return; }
  if (act) { g.act = act; g.fromGrip = !!e.target.closest('.as-grip'); if (g.fromGrip) { e.preventDefault(); e.stopPropagation(); } }
  else if (btn) return;
  g.timer = setTimeout(() => { if (AS.g !== g || g.mode !== 'pending') return; if (g.act) actLiftStart(g); else moveStart(g); }, g.fromGrip ? 160 : AS_HOLD);
  AS.g = g;
});
window.addEventListener('pointermove', e => {
  const g = AS.g; if (!g || e.pointerId !== g.pid) return;
  g.x = e.clientX; g.y = e.clientY; const dx = g.x - g.x0, dy = g.y - g.y0;
  if (g.mode === 'pending') {
    if (Math.hypot(dx, dy) < AS_SLOP) return;
    if (g.fromGrip) { clearTimeout(g.timer); actLiftStart(g); }
    else { clearTimeout(g.timer); AS.g = null; return; }           // a scroll / a pen stroke
  }
  if (g.mode === 'move') { g.card.style.transform = `translate(${dx}px, ${dy}px) rotate(-.6deg) scale(1.02)`; asAutoScroll(g); }
  else if (g.mode === 'resize') { const s = S.scale; g.f.c.w = Math.round(Math.max(AS_MIN_W, Math.min(PAGE_W - g.f.c.x - 8, g.w0 + dx / s))); g.f.c.h = Math.round(Math.max(AS_MIN_H, Math.min(PAGE_H - g.f.c.y - 8, g.h0 + dy / s))); g.card.style.width = g.f.c.w * s + 'px'; g.card.style.height = g.f.c.h * s + 'px'; }
  else if (g.mode === 'act') actMove(g);
}, { passive: true });
const asUp = e => {
  const g = AS.g; if (!g || e.pointerId !== g.pid) return; AS.g = null; clearTimeout(g.timer);
  const cancel = e.type === 'pointercancel';
  if (g.mode === 'move') moveEnd(g, cancel); else if (g.mode === 'resize') resizeEndAs(g, cancel); else if (g.mode === 'act') actEnd(g, cancel);
};
window.addEventListener('pointerup', asUp); window.addEventListener('pointercancel', asUp);
document.addEventListener('touchmove', e => { const g = AS.g; if (g && g.mode !== 'pending' && e.cancelable) e.preventDefault(); }, { passive: false });
function asSuppress() { AS.suppress = true; setTimeout(() => AS.suppress = false, 350); }
PAGES.addEventListener('click', e => { if (AS.suppress && e.target.closest('.as-layer')) { e.stopPropagation(); e.preventDefault(); } }, true);
function moveStart(g) { g.mode = 'move'; buzz(); g.card.classList.add('lifted'); }
function asAutoScroll(g) { const W = $('#pages'), r = W.getBoundingClientRect(); if (g.y > r.bottom - 60) W.scrollTop += 12; else if (g.y < r.top + 50) W.scrollTop -= 12; }
function moveEnd(g, cancel) {
  asSuppress(); g.card.classList.remove('lifted'); g.card.style.transform = '';
  if (cancel) return;
  const s = S.scale, c = g.f.c, pageR = g.card.closest('.page').getBoundingClientRect(), cr = g.card.getBoundingClientRect();
  const nx = Math.round(Math.max(0, Math.min(PAGE_W - 120, c.x + (g.x - g.x0) / s))), ny = Math.round(Math.max(0, Math.min(PAGE_H - 80, c.y + (g.y - g.y0) / s)));
  void pageR; void cr;
  if (nx === c.x && ny === c.y) return;
  pushHistory(); c.x = nx; c.y = ny; saveNote(g.f.n, true); renderAssist(g.f.pi);
}
function resizeEndAs(g, cancel) {
  asSuppress(); g.card.classList.remove('sizing'); const c = g.f.c;
  if (cancel || (c.w === g.w0 && c.h === g.h0)) { c.w = g.w0; c.h = g.h0; renderAssist(g.f.pi); return; }
  const w = c.w, h = c.h; c.w = g.w0; c.h = g.h0; pushHistory(); c.w = w; c.h = h; saveNote(g.f.n, true); renderAssist(g.f.pi);
}

/* ---- action item → board column / planner slot / dock ---- */
function asDock() {
  let d = document.getElementById('aDock');
  if (!d) { d = document.createElement('div'); d.id = 'aDock'; d.innerHTML = '<div data-dock="board">📋 <b>To a board</b><small>pick board & column</small></div><div data-dock="planner">🗓 <b>To a planner</b><small>pick day & time</small></div>'; document.body.append(d); }
  return d;
}
function actLiftStart(g) {
  g.mode = 'act'; buzz(); g.a = g.f.c.actions.find(a => a.id === g.act.dataset.act);
  const r = g.act.getBoundingClientRect(), gh = document.createElement('div'); gh.className = 'as-ghost'; gh.textContent = '⠿ ' + g.a.text + (g.a.due ? '  ⏰ ' + fmtDueShort(g.a.due) : '');
  Object.assign(gh.style, { left: r.left + 'px', top: r.top + 'px', maxWidth: Math.max(220, r.width) + 'px' }); document.body.append(gh);
  g.ghost = gh; g.grab = [g.x0 - r.left, g.y0 - r.top]; g.act.classList.add('lifting'); document.body.classList.add('as-carrying');
  asDock().classList.add('show'); actMove(g);
}
function actMove(g) {
  g.ghost.style.transform = `translate(${g.x - g.x0}px, ${g.y - g.y0}px) rotate(-1deg)`;
  const dock = asDock(), W = $('#pages'), wr = W.getBoundingClientRect(), dr = dock.getBoundingClientRect();
  const inDock = g.y >= dr.top - 8 && g.y <= dr.bottom + 8 && g.x >= dr.left - 8 && g.x <= dr.right + 8;
  let tgt = null;
  if (inDock) { const half = [...dock.children].find(c => { const r = c.getBoundingClientRect(); return g.x >= r.left - 6 && g.x <= r.right + 6; }) || dock.children[0]; tgt = { type: 'dock', to: half.dataset.dock }; }
  else {
    g.vs = g.y > wr.bottom - 90 && g.y < wr.bottom + 40 ? Math.min(28, Math.ceil((g.y - wr.bottom + 90) / 3)) : g.y < wr.top + 50 ? -Math.min(28, Math.ceil((wr.top + 50 - g.y) / 3)) : 0;
    if (g.vs && !g.raf) { const step = () => { if (AS.g !== g || g.mode !== 'act' || !g.vs) { g.raf = 0; return; } const b = W.scrollTop; W.scrollTop += g.vs; g.raf = requestAnimationFrame(step); if (W.scrollTop !== b) actMove(g); }; g.raf = requestAnimationFrame(step); }
    const els = document.elementsFromPoint(g.x, g.y), pageEl = els.find(e => e.classList && e.classList.contains('page')), pg = pageEl && curNote().pages[+pageEl.dataset.pi];
    if (pg && isBoardPage(pg)) { const col = els.find(e => e.classList && e.classList.contains('bcol')); if (col) tgt = { type: 'col', pi: +pageEl.dataset.pi, col: col.dataset.col }; }
    else if (pg && pg.bg && pg.bg.name === 'planner') { const r = pageEl.getBoundingClientRect(), sl = slotAtY(pg.bg, (g.y - r.top) / S.scale); if (sl) tgt = { type: 'slot', pi: +pageEl.dataset.pi, sl }; }
  }
  const key = tgt ? tgt.type + ':' + (tgt.to || tgt.col || (tgt.pi + ':' + tgt.sl.i)) : '';
  if (key !== (g.key || '')) {
    g.key = key; document.querySelectorAll('.bcol.bdrop-ink').forEach(e => e.classList.remove('bdrop-ink')); document.querySelectorAll('.slot-hl.as-slot').forEach(e => e.remove());
    [...dock.children].forEach(c => c.classList.toggle('hot', !!(tgt && tgt.type === 'dock' && tgt.to === c.dataset.dock)));
    if (tgt && tgt.type === 'col') { const c = document.querySelector(`.page[data-pi="${tgt.pi}"] .bcol[data-col="${tgt.col}"]`); if (c) c.classList.add('bdrop-ink'); }
    if (tgt && tgt.type === 'slot') { const s = S.scale, d = document.createElement('div'); d.className = 'slot-hl as-slot'; Object.assign(d.style, { left: TIME_COL * s + 'px', top: tgt.sl.y0 * s + 'px', width: (960 - TIME_COL) * s + 'px', height: tgt.sl.h * s + 'px' }); d.innerHTML = `<span>${fmt12(tgt.sl.time)}</span>`; pageEls[tgt.pi].ov.append(d); }
    if (tgt) buzz();
  }
  g.tgt = tgt;
}
function actEnd(g, cancel) {
  asSuppress(); g.ghost.remove(); g.act.classList.remove('lifting'); document.body.classList.remove('as-carrying'); asDock().classList.remove('show'); [...asDock().children].forEach(c => c.classList.remove('hot'));
  document.querySelectorAll('.bcol.bdrop-ink').forEach(e => e.classList.remove('bdrop-ink')); document.querySelectorAll('.slot-hl.as-slot').forEach(e => e.remove());
  const t = g.tgt; if (cancel || !t) return;
  const n = curNote(), ids = [g.a.id];
  if (t.type === 'col') { pushHistory(); actionsToBoard(g.f, ids, n, t.pi, t.col); }
  else if (t.type === 'slot') { pushHistory(); actionToPlanner(g.f, g.a, n, t.pi, t.sl); }
  else if (t.to === 'board') pickBoardFor(g.f, ids);
  else pickPlannerFor(g.f, g.a);
}
function actionsToBoard(f, ids, dn, dpi, colId) {
  const dpg = dn.pages[dpi], cols = boardCols(dpg), col = cols.find(c => c.id === colId) || cols[0], last = cols.length > 1 && col.id === lastColId(dpg); let k = 0;
  for (const a of f.c.actions.filter(x => ids.includes(x.id))) {
    const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1 - (k++) / 100, text: a.text, typed: true, tstrokes: [], strokes: [], done: last, ...(last ? { doneAt: Date.now() } : {}), due: a.due || null, repeat: '', notified: false, createdAt: Date.now(), from: { assist: f.c.id, subject: f.c.subject } };
    dpg.tasks.push(t); a.sent = { to: 'board', noteId: dn.id, id: t.id };
  }
  renumber(dpg, col.id); saveNote(dn, true); if (dn !== f.n) saveNote(f.n, true);
  if (dn.id === S.cur) { afterChange(dpi); renderAssist(f.pi); } else { renderAssist(f.pi); renderSidebar(); renderPanel(); }
  toast(`📋 ${ids.length === 1 ? 'Card' : ids.length + ' cards'} added to “${col.title}”${dn.id !== S.cur ? ' in ' + dn.title : ''}`, 2200);
}
function actionToPlanner(f, a, dn, dpi, sl) {
  const pg = dn.pages[dpi], t = { id: uid('t'), kind: 'typed', text: a.text, done: false, due: null, repeat: '', notified: false, createdAt: Date.now() };
  pg.tasks.push(t); placeTaskInSlot(pg, t, sl, pg.bg); a.sent = { to: 'planner', noteId: dn.id, id: t.id };
  saveNote(dn, true); if (dn !== f.n) saveNote(f.n, true);
  if (dn.id === S.cur) { renderOverlay(dpi); renderAssist(f.pi); } else renderAssist(f.pi);
  renderSidebar(); renderPanel(); toast(`🗓 On the planner · ${fmtDueShort(t.due)}`, 2200);
}
async function pickBoardFor(f, ids) {
  const list = []; for (const n of S.notes) n.pages.forEach((pg, i) => { if (isBoardPage(pg)) list.push({ n, i }); });
  const items = list.map(x => ({ label: '📋 ' + x.n.title, sub: `${x.n.id === S.cur ? 'This note · ' : ''}page ${x.i + 1} · ${boardCols(x.n.pages[x.i]).map(c => c.title).join(' · ')}`, value: x }));
  items.push({ label: '＋ New Project Board page', sub: `Adds a board page to “${curNote().title}”`, value: 'new' });
  const ch = await pickSheet(ids.length > 1 ? `Send ${ids.length} action items to which board?` : 'Send to which board?', items); if (!ch) return;
  const n = curNote(); let dst = ch;
  if (ch === 'new') { pushHistory(); n.pages.push(makeTemplatePage('board', n)); saveNote(n, true); buildPages(); dst = { n, i: n.pages.length - 1 }; }
  const col = await pickSheet('Which column?', boardCols(dst.n.pages[dst.i]).map(c => ({ label: c.title, sub: colCards(dst.n.pages[dst.i], c.id).length + ' cards', value: c.id }))); if (!col) return;
  if (ch !== 'new') { if (dst.n.id === S.cur) pushHistory(); else pushHistoryMulti([dst.n.id]); }
  const fresh = findAsCard(f.c.id); actionsToBoard(fresh, ids, dst.n, dst.i, col);
}
async function pickPlannerFor(f, a) {
  const list = []; for (const n of S.notes) n.pages.forEach((pg, i) => { if (pg.bg && pg.bg.name === 'planner') list.push({ n, i, date: pg.bg.date }); });
  list.sort((x, y) => x.date.localeCompare(y.date)); const today = todayISO(), want = a.due ? todayISOOf(new Date(a.due)) : null;
  const items = list.map(x => ({ label: (x.date === today ? '☀️ Today · ' : x.date === want ? '⏰ Due day · ' : '🗓 ') + longDate(x.date), sub: `${x.n.title} · page ${x.i + 1}`, value: x }));
  items.push({ label: '＋ New planner page' + (want && want !== today ? ' for ' + longDate(want) : ' for today'), sub: `Adds a page to “${curNote().title}”`, value: 'new' });
  const ch = await pickSheet('Put this on which planner?', items); if (!ch) return;
  const n = curNote(); let dst = ch, hist = false;
  if (ch === 'new') { pushHistory(); hist = true; n.pages.push(makeTemplatePage('planner', n, want || today)); saveNote(n, true); buildPages(); dst = { n, i: n.pages.length - 1 }; }
  const pg = dst.n.pages[dst.i], slots = plannerSlots(pg.bg);
  const sl = await pickSheet(longDate(pg.bg.date), slots.map(s => ({ label: fmt12(s.time), value: s })), { grid: true, sub: 'Pick a time slot — the reminder is set to that time.' }); if (!sl) return;
  if (!hist) { if (dst.n.id === S.cur) pushHistory(); else pushHistoryMulti([dst.n.id]); }
  const fresh = findAsCard(f.c.id); actionToPlanner(fresh, fresh.c.actions.find(x => x.id === a.id), dst.n, dst.i, sl);
}
const todayISOOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------- buttons ---------- */
PAGES.addEventListener('click', e => {
  const b = e.target.closest('.as-layer [data-aa]'); if (!b || AS.suppress) return;
  e.stopPropagation(); const pi = +b.closest('.page').dataset.pi, cardEl = b.closest('.as-card'), f = cardEl && findAsCard(cardEl.dataset.card);
  const a = b.dataset.aa;
  if (a === 'paste') pasteButton(pi);
  else if (a === 'lasso') { selectTool('lasso'); hint('Circle handwriting or text on any page, then tap 🤖 To assistant'); }
  else if (a === 'sendall' && f) pickBoardFor(f, f.c.actions.map(x => x.id));
  else if (a === 'cal' && f) { const m = f.c.meetings.find(x => x.id === b.dataset.m); if (m) downloadIcs({ type: 'task', note: f.n, page: f.pi, obj: { id: m.id, text: m.title, due: m.start, end: m.end, where: m.where, repeat: '' } }); }
  else if (a === 'menu' && f) actionSheet(f.c.subject || 'Assistant card', [
    ...(f.c.actions.length ? [{ label: '📋 Send all action items to a board…', fn: () => pickBoardFor(f, f.c.actions.map(x => x.id)) }] : []),
    ...(aiCfg().key && f.c.raw ? [{ label: '✨ Re-summarize with ' + aiCfg().model, fn: () => smarten(f.n.id, f.pg.id, f.c.id, { from: f.c.from, to: f.c.to, subject: f.c.subject, text: f.c.raw }, new Date(f.c.ref || Date.now())) }] : []),
    ...(f.c.raw ? [{ label: '⚙︎ Re-summarize with the built-in engine', fn: () => { pushHistory(); Object.assign(f.c, resultToCard(AssistEngine.extract({ from: f.c.from, subject: f.c.subject, date: new Date(f.c.ref || Date.now()), text: f.c.raw })), { engine: 'Built-in', engineNote: '' }); saveNote(f.n, true); renderAssist(f.pi); } }] : []),
    { label: '🗑 Delete card', danger: true, fn: () => { pushHistory(); f.pg.assist.cards = f.pg.assist.cards.filter(x => x !== f.c); saveNote(f.n, true); renderAssist(f.pi); undoToast('Assistant card deleted'); } }]);
});

/* ---------- lasso → assistant ---------- */
async function lassoToAssistant() {
  const sel = selection; if (!sel) return;
  const n = curNote(), pg = n.pages[sel.pi];
  const texts = (sel.texts || []).map(id => pg.texts.find(t => t.id === id)).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text);
  const tasks = (sel.tasks || []).map(id => pg.tasks.find(t => t.id === id)).filter(t => t && t.text).map(t => '- ' + t.text);
  const strokes = pg.strokes.filter(s => sel.ids.includes(s.id));
  const text = [...texts, ...tasks].join('\n').trim();
  if (!text && !strokes.length) { toast('Select some text or handwriting first'); return; }
  let ink = null;
  if (strokes.length) { let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of strokes) { const b = s.bb || bbox(s.points); bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])]; } ink = { strokes: JSON.parse(JSON.stringify(strokes)), bb }; }
  $('#lassoMenu').hidden = true;
  const list = []; for (const x of S.notes) x.pages.forEach((p, i) => { if (isAssistPage(p)) list.push({ n: x, i }); });
  const items = list.map(x => ({ label: '🤖 ' + x.n.title, sub: `${x.n.id === S.cur ? 'This note · ' : ''}page ${x.i + 1} · ${asCards(x.n.pages[x.i]).length} cards`, value: x }));
  items.push({ label: '＋ New Assistant page', sub: `Adds an assistant page to “${n.title}”`, value: 'new' });
  const ch = await pickSheet('Send to which assistant page?', items); if (!ch) { if (selection) $('#lassoMenu').hidden = false; return; }
  hideLasso();
  let dst = ch;
  if (ch === 'new') { n.pages.push(makeTemplatePage('assistant', n)); saveNote(n, true); buildPages(); dst = { n, i: n.pages.length - 1 }; }
  if (dst.n.id !== S.cur) openNote(dst.n.id);
  const first = text.split('\n')[0].replace(/^- /, '');
  await addEmail(dst.i, { from: 'Me', subject: text ? (first.length > 60 ? first.slice(0, 57) + '…' : first) : 'Handwriting', date: new Date(), text }, { kind: strokes.length && !text ? 'ink' : 'text', via: 'lasso', ink });
  if (strokes.length && !text) toast('Handwriting attached — the assistant can only read typed text', 3200);
}
$('#lassoAssist').onclick = lassoToAssistant;

/* ---------- optional AI tier (user's own key, OpenAI-compatible) ---------- */
const AI_PRESETS = { xai: { label: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-4.7' }, openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-6-luna' }, custom: { label: 'Custom (OpenAI-compatible)', base: '', model: '' } };
const AI_URL_OK = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$))/i;
function aiCfg() { try { return { on: false, provider: 'xai', base: AI_PRESETS.xai.base, model: AI_PRESETS.xai.model, key: '', ...JSON.parse(localStorage.getItem('assistAI') || '{}') }; } catch (_) { return { on: false }; } }
const AI_SYS = `You are a personal assistant that reads one email (or note) and returns ONLY a JSON object, no prose, matching:
{"summary": string (2-3 sentences, plain), "key_points": string[] (max 5, short facts, not actions), "action_items": [{"text": string (imperative, what to do), "owner": string ("You" for the reader, else a first name or "Team"), "due": string|null (ISO 8601 local "YYYY-MM-DDTHH:mm" or null)}], "meetings": [{"title": string, "start": string (ISO 8601 local), "end": string|null, "where": string|null}]}
Ignore quoted replies, signatures and disclaimers. Resolve relative dates ("Friday", "EOD", "next Tue") against the email date. Use 17:00 for date-only deadlines. Never invent facts.`;
async function aiSummarize(email, ref) {
  const c = aiCfg(); if (!c.key || !c.base || !c.model) throw new Error('not configured'); if (!AI_URL_OK.test(c.base)) throw new Error('base URL must be https');
  if (navigator.onLine === false) throw new Error('offline');
  const body = String(email.text || '').slice(0, 14000);
  const user = `Email date: ${ref.toString()}\nFrom: ${email.from || ''}\nSubject: ${email.subject || ''}\n\n${body}`;
  const call = async rf => {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 30000);
    try {
      const res = await fetch(c.base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: AI_SYS }, { role: 'user', content: user }], ...(rf ? { response_format: { type: 'json_object' } } : {}) }) });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      return res.json();
    } finally { clearTimeout(to); }
  };
  let j; try { j = await call(true); } catch (e) { if (e.status === 400) j = await call(false); else throw e; }
  let txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; if (Array.isArray(txt)) txt = txt.map(p => p.text || '').join('');
  txt = String(txt || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim(); const m = txt.match(/\{[\s\S]*\}/); const o = JSON.parse(m ? m[0] : txt);
  const isoOk = s => { if (!s) return null; const d = new Date(s); if (!isNaN(d)) return d.toISOString(); const p = AssistEngine.parseDates(String(s), ref)[0]; return p ? p.date.toISOString() : null; };
  if (typeof o.summary !== 'string' || !Array.isArray(o.action_items)) throw new Error('bad JSON shape');
  return { summary: o.summary.trim(), points: (o.key_points || []).filter(x => typeof x === 'string').slice(0, 6),
    actions: o.action_items.filter(a => a && a.text).map(a => ({ text: String(a.text).trim(), owner: a.owner ? String(a.owner) : 'You', due: isoOk(a.due), dueText: a.due ? String(a.due) : '' })),
    meetings: (o.meetings || []).filter(m => m && m.title && isoOk(m.start)).map(m => ({ title: String(m.title), start: isoOk(m.start), end: isoOk(m.end), where: m.where ? String(m.where) : '' })), deadlines: [] };
}
async function smarten(noteId, pageId, cardId, email, ref) {
  const find = () => { const f = findAsCard(cardId); return f && f.n.id === noteId ? f : null; };
  let f = find(); if (!f) return; f.c.pending = true; if (f.n.id === S.cur) renderAssist(f.pi);
  try {
    const r = await aiSummarize(email, ref); f = find(); if (!f) return;
    const sentById = new Map(f.c.actions.filter(a => a.sent).map(a => [a.text.toLowerCase(), a.sent]));
    Object.assign(f.c, resultToCard(r), { engine: aiCfg().model || 'AI', engineNote: '' });
    f.c.actions.forEach(a => { const s = sentById.get(a.text.toLowerCase()); if (s) a.sent = s; });
  } catch (err) {
    f = find(); if (!f) return;
    f.c.engineNote = 'AI unavailable (' + (err.name === 'AbortError' ? 'timed out' : err.message) + ') — built-in summary shown';
    toast('✨ AI summary failed — kept the built-in one', 2600);
  }
  delete f.c.pending; saveNote(f.n, true); if (f.n.id === S.cur) renderAssist(f.pi);
}
function aiSettings() {
  const c = aiCfg(), w = modalWrap('aiWrap');
  w.innerHTML = `<div class="sheet ai-sheet" role="dialog" aria-modal="true"><h3>✨ Smarter AI summaries</h3>
    <p class="fine">Optional. The built-in assistant works offline with no account. If you add <b>your own</b> API key, new emails are also summarized by that provider. The key is stored only on this device (not in backups) and sent only to the address below, together with the email text you drop.</p>
    <label class="chkrow"><input type="checkbox" id="aiOn" ${c.on ? 'checked' : ''}> Use AI for new assistant cards</label>
    <label>Provider<select id="aiProv">${Object.entries(AI_PRESETS).map(([k, p]) => `<option value="${k}" ${c.provider === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
    <label>Base URL<input id="aiBase" value="${esc(c.base)}" placeholder="https://…/v1" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label>Model<input id="aiModel" value="${esc(c.model)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label>API key<input id="aiKey" type="password" value="${esc(c.key)}" placeholder="paste your key" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <p class="fine ai-res" hidden></p>
    <div class="sheet-actions"><button class="btn" data-ai="clear">Remove key</button><button class="btn" data-ai="test">Test</button><div class="spacer"></div><button class="btn" data-ai="x">Cancel</button><button class="btn primary" data-ai="save">Save</button></div></div>`;
  w.hidden = false;
  const $w = s => w.querySelector(s), read = () => ({ on: $w('#aiOn').checked, provider: $w('#aiProv').value, base: $w('#aiBase').value.trim(), model: $w('#aiModel').value.trim(), key: $w('#aiKey').value.trim() });
  $w('#aiProv').onchange = () => { const p = AI_PRESETS[$w('#aiProv').value]; if (p.base) { $w('#aiBase').value = p.base; $w('#aiModel').value = p.model; } };
  w.onclick = async e => {
    const a = e.target.closest('[data-ai]'); if (!a) return; const res = $w('.ai-res');
    if (a.dataset.ai === 'x') w.hidden = true;
    if (a.dataset.ai === 'clear') { localStorage.removeItem('assistAI'); w.hidden = true; toast('AI key removed — using the built-in assistant'); }
    if (a.dataset.ai === 'save') { const v = read(); if (v.on && (!v.key || !AI_URL_OK.test(v.base) || !v.model)) { res.hidden = false; res.textContent = 'Add an https base URL (http only for localhost / .local), a model and your key (or turn AI off).'; return; } localStorage.setItem('assistAI', JSON.stringify(v)); w.hidden = true; toast(v.on ? '✨ AI summaries on (' + v.model + ')' : 'AI summaries off'); }
    if (a.dataset.ai === 'test') { const prev = localStorage.getItem('assistAI'); localStorage.setItem('assistAI', JSON.stringify(read())); res.hidden = false; res.textContent = 'Testing…';
      try { const r = await aiSummarize({ from: 'Test', subject: 'Test', text: 'Hi, can you send me the report by Friday? Thanks.' }, new Date()); res.textContent = '✓ Works — ' + r.actions.length + ' action item(s) found.'; }
      catch (err) { res.textContent = '✗ ' + (err.name === 'AbortError' ? 'Timed out' : err.message) + (err.message === 'Failed to fetch' ? ' (network or the provider blocks browser requests)' : ''); }
      finally { prev === null ? localStorage.removeItem('assistAI') : localStorage.setItem('assistAI', prev); } }
  };
}
function assistSettingsItems() { const c = aiCfg(); return [{ label: '✨ Smarter AI summaries: ' + (c.on && c.key ? 'On (' + c.model + ')' : 'Off') + '…', fn: aiSettings }]; }

/* ---------- search & PDF ---------- */
const _noteSearchText = noteSearchText;
noteSearchText = n => _noteSearchText(n) + ' ' + n.pages.flatMap(p => (p.assist ? p.assist.cards : []).map(c => [c.from, c.subject, c.summary, ...(c.points || []), ...(c.actions || []).map(a => a.text)].join(' '))).join(' ').toLowerCase();
function drawAssistExport(ctx, pg) {
  ctx.save(); ctx.textBaseline = 'top';
  const wrap = (t, x, y, w, lh, font, color, max = 99) => { ctx.font = font; ctx.fillStyle = color; const ws = String(t).split(/\s+/); let line = '', n = 0; for (const wd of ws) { const tt = line ? line + ' ' + wd : wd; if (ctx.measureText(tt).width > w && line) { ctx.fillText(line, x, y); y += lh; line = wd; if (++n >= max) return y; } else line = tt; } if (line) { ctx.fillText(line, x, y); y += lh; } return y; };
  for (const c of asCards(pg)) {
    ctx.fillStyle = '#f5f5fa'; ctx.strokeStyle = '#c7c7d9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(c.x, c.y, c.w, c.h, 14) : ctx.rect(c.x, c.y, c.w, c.h); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
    let y = c.y + 14; const x = c.x + 16, w = c.w - 32;
    y = wrap(c.from || '', x, y, w, 20, `600 15px ${FONT}`, '#555', 1); y = wrap(c.subject || '', x, y, w, 24, `800 19px ${FONT}`, '#111', 2); y += 6;
    y = wrap(c.summary || '', x, y, w, 21, `16px ${FONT}`, '#222', 6); y += 8;
    for (const p of c.points || []) y = wrap('• ' + p, x, y, w, 20, `15px ${FONT}`, '#333', 2);
    if ((c.actions || []).length) { y += 6; y = wrap('Action items', x, y, w, 22, `800 15px ${FONT}`, '#4f46e5', 1); for (const a of c.actions) y = wrap('☐ ' + a.text + (a.owner ? ' — ' + a.owner : '') + (a.due ? ' · ' + fmtWhen(a.due) : ''), x, y, w, 20, `15px ${FONT}`, '#111', 2); }
    for (const m of c.meetings || []) y = wrap('📅 ' + m.title + ' · ' + fmtWhen(m.start), x, y + 4, w, 20, `15px ${FONT}`, '#111', 2);
    ctx.restore();
  }
  ctx.restore();
}
