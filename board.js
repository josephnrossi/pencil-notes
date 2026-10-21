'use strict';
/* Pencil Notes v11: Project Board template — Clear-style columns & cards.
   A board is a page with bg.name === 'board' and pg.board.columns = [{id, title}].
   Cards are ordinary tasks on that page (kind 'card', t.col = column id, t.ord = position, t.strokes = card ink),
   so reminders, Today, 📅 Add to Calendar, search, Export/Import and undo (pushHistory) all work unchanged.
   Gestures (Apple Pencil, finger and mouse alike): press & hold to lift a card or a column header,
   swipe a card right = done (moves to the last column), left = delete (Undo), pull down a column = new card. */
/* v13: t.items = checklist [{id, done, strokes, text, typed}], t.color, t.prio (0-3), t.plan = {noteId, pageId, time} (planner link),
   board.compact (collapsed cards). */
const LABELS = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7' };
const PRIO = ['None', 'Low', 'Medium', 'High'], ITEM_H = 46, SOON_MS = 864e5;
const INK_W = 300, INK_H = 240, TITLE_H = 58, H_MIN = 90, H_MAX = 760, B_LIFT = 420, B_SLOP = 8, CW_MIN = 0.75, CW_MAX = 3;
/* v12: t.h = body ink height (ink units; 300 units = card width), t.tstrokes = handwritten title, t.typed = typed title on;
   column.w = width factor (1 = a third of the board). */
const cardH = t => Math.max(H_MIN, Math.min(H_MAX, +t.h || INK_H));
const isTyped = t => t.typed ?? !!t.text;
const inkKey = which => which === 'title' ? 'tstrokes' : 'strokes';
const strokesBottom = st => (st || []).reduce((m, s) => Math.max(m, (s.bb || bbox(s.points))[3] + s.width), 0);
function cardFallback(o, note, pi) {
  const pg = bP(note, pi), c = pg && pg.board && pg.board.columns.find(x => x.id === o.col);
  return (o.tstrokes || []).length || (o.strokes || []).length ? `Handwritten card in ${c ? c.title : (note ? note.title : 'board')}` : `Card in ${c ? c.title : (note ? note.title : 'board')}`;
}
const isBoardPage = pg => !!(pg && pg.bg && pg.bg.name === 'board');
function newBoard() { return { columns: ['To Do', 'Doing', 'Done'].map(title => ({ id: uid('c'), title })) }; }
function boardCols(pg) { if (!pg.board || !Array.isArray(pg.board.columns) || !pg.board.columns.length) pg.board = newBoard(); return pg.board.columns; }
const isCard = t => t && t.kind === 'card';
function colCards(pg, colId) { return pg.tasks.filter(t => isCard(t) && t.col === colId).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0)); }
function renumber(pg, colId) { colCards(pg, colId).forEach((t, i) => t.ord = i); }
const lastColId = pg => { const c = boardCols(pg); return c[c.length - 1].id; };
const BS = { g: null, editing: false, dirty: false, suppress: false, keep: {} };
/* v19: board hosts. pi >= 0 = a board page of the open note; pi === QPI = the global Quote Board drawer
   (a hidden system note, so Pencil Lock, Export/Import, search, reminders and Today cover it for free). */
const QPI = -1, QUOTE_ID = 'quoteboard';
const QB = { undo: [], redo: [], host: null, open: false };
const quoteNote = () => S.notes.find(n => n.id === QUOTE_ID);
const bN = pi => pi === QPI ? quoteNote() : curNote();
const bP = (n, pi) => n ? (pi === QPI ? (n.id === QUOTE_ID ? n.pages[0] : null) : n.pages[pi]) : null;
const bE = pi => pi === QPI ? QB.host : pageEls[pi];
const bPi = el => +el.closest('[data-pi]').dataset.pi;
const bPage = pi => pi === QPI ? 0 : pi;           // real page index (reminder editor, items)
function bSnap(pi) { return pi === QPI ? JSON.stringify(quoteNote().pages) : snapshot(); }
function bPushSnap(pi, snap) { if (pi === QPI) { QB.undo.push(snap); if (QB.undo.length > 80) QB.undo.shift(); QB.redo = []; qbUndoUI(); } else { S.undo.push(snap); S.redo = []; updateUndo(); } }
function bH(pi) { if (pi === QPI) bPushSnap(QPI, bSnap(QPI)); else pushHistory(); }
function qbUndoUI() { if (typeof qbSyncUndo === 'function') qbSyncUndo(); }
function qbRestore(from, to) {
  const n = quoteNote(); if (!n || !from.length || (n.lock && !(typeof LK !== 'undefined' && LK.open && LK.open.has(n.id)))) return false;
  to.push(JSON.stringify(n.pages)); n.pages = JSON.parse(from.pop()); saveNote(n, true); renderBoard(QPI); renderPanel(); qbUndoUI(); return true;
}
function bUndo(pi) { if (pi === QPI) qbRestore(QB.undo, QB.redo); else restore(S.undo, S.redo); }
/* done columns: by default the last column; a board may list several (Quote Board: Won + Lost) */
const doneCols = pg => { const cols = boardCols(pg), d = (pg.board.doneCols || []).filter(id => cols.some(c => c.id === id)); return d.length ? d : [cols[cols.length - 1].id]; };
const isDoneCol = (pg, colId) => boardCols(pg).length > 1 && doneCols(pg).includes(colId);
const PAGES = $('#pages');
const BHOSTS = [PAGES, document.getElementById('qbHost')].filter(Boolean);
const onBoards = (type, fn, opt) => BHOSTS.forEach(h => h.addEventListener(type, fn, opt));
const boardBusy = () => BS.editing || !!(BS.g && (BS.g.mode !== 'pending' || BS.g.ink));
function buzz() { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(8); } catch (_) {} }
function suppressClicks() { BS.suppress = true; clearTimeout(suppressClicks.t); suppressClicks.t = setTimeout(() => BS.suppress = false, 400); }
const cardWrap = (pi, id) => bE(pi) && bE(pi).el.querySelector(`.bcard-wrap[data-id="${id}"]`);
const findCard = (pi, id) => { const n = bN(pi), pg = bP(n, pi); return pg ? pg.tasks.find(t => t.id === id) : null; };

/* ---------- render ---------- */
function warnOf(t, pg, now = Date.now()) {
  if (!t.due || t.done || isDoneCol(pg, t.col)) return '';
  const d = new Date(t.due) - now; return d < 0 ? 'overdue' : d < SOON_MS ? 'soon' : '';
}
function planOK(t) {   // a planner link is valid while the card's reminder still equals the slot time
  const p = t.plan; if (!p || !t.due) return null;
  const n = S.notes.find(x => x.id === p.noteId), pg = n && n.pages.find(q => q.id === p.pageId);
  if (!pg || !pg.bg || pg.bg.name !== 'planner') return null;
  return slotDate(pg.bg.date, p.time).toISOString() === t.due ? { n, pg } : null;
}
function itemHTML(it) {
  return `<div class="bc-item ${it.done ? 'done' : ''}" data-item="${it.id}"><button class="bc-tick" data-bact="tick" aria-label="Tick">${it.done ? '✓' : ''}</button>
    ${it.typed ? `<span class="bc-itext ${it.text ? '' : 'ph'}" data-bact="itext">${it.text ? esc(it.text) : 'Item'}</span>` : `<canvas class="bc-iink" data-ink="item" data-item="${it.id}" aria-label="Write the item"></canvas>`}
    <button class="bc-ikb" data-bact="ikb" aria-label="${it.typed ? 'Handwrite' : 'Type'} this item">${it.typed ? '✍︎' : '⌨︎'}</button></div>`;
}
function cardHTML(t, now, pg) {
  const w = warnOf(t, pg, now), items = t.items || [], nd = items.filter(i => i.done).length, plan = planOK(t);
  return `<div class="bcard-wrap" data-id="${t.id}"><div class="bsw bsw-done">✓ Done</div><div class="bsw bsw-del">Delete 🗑</div>
    <div class="bcard ${t.done ? 'done' : ''} ${w} ${t.color ? 'labeled' : ''} prio${t.prio || 0}" data-id="${t.id}" ${t.color ? `style="--lc:${LABELS[t.color]}"` : ''}>
      <div class="bc-grip" aria-label="Hold to drag · hold & release for color/priority · swipe to finish or delete">⠿</div>
      <div class="bc-main"><div class="bc-top">${isTyped(t) ? `<span class="bc-title ${t.text ? '' : 'ph'}" data-bact="title">${t.text ? esc(t.text) : 'Title'}</span>` : `<canvas class="bc-tink" data-ink="title" aria-label="Write the title"></canvas>`}
      <button class="bc-kb ${isTyped(t) ? 'on' : ''}" data-bact="kb" aria-label="${isTyped(t) ? 'Handwrite the title' : 'Type the title'}">${isTyped(t) ? '✍︎' : '⌨︎'}</button>
      <button class="bc-more" data-bact="cmenu" aria-label="Card options">⋯</button></div>
      ${typeof cardExtraTop === 'function' ? cardExtraTop(t, pg) : ''}<div class="bc-meta">${t.prio ? `<span class="bc-prio p${t.prio}">⚑ ${PRIO[t.prio]}</span>` : ''}
      ${t.due ? `<button class="bc-due" data-bact="due" aria-label="Reminder">${plan ? '🗓' : '⏰'} ${esc(fmtDue(t.due)) + (t.repeat ? ' ↻' : '')}</button>` : `<button class="bc-due none" data-bact="due" aria-label="Reminder">⏰</button>`}
      <span class="bc-od">Overdue</span><span class="bc-soon">Due soon</span>
      ${items.length ? `<span class="bc-prog" title="Checklist"><b><i style="width:${Math.round(nd / items.length * 100)}%"></i></b>${nd}/${items.length}</span>` : ''}
      <span class="spacer"></span><button class="bc-addi" data-bact="additem" aria-label="Add checklist item">☑︎</button></div>
      ${typeof cardExtra === 'function' ? cardExtra(t, pg) : ''}${items.length ? `<div class="bc-items">${items.map(itemHTML).join('')}</div>` : ''}
      <canvas class="bc-ink" data-ink="body" aria-label="Write here"></canvas></div>
      <div class="bc-resize" aria-label="Drag to resize the card"></div></div></div>`;
}
function colStyle(w) { w = Math.max(CW_MIN, Math.min(CW_MAX, +w || 1)); return w === 1 ? '' : `flex-basis: calc((100% - 24px) / 3 * ${w}); min-width: ${Math.round(228 * w)}px`; }
function layoutCard(w, t) {
  const body = w.querySelector('.bc-ink'), k = (w.querySelector('.bc-main').clientWidth || 200) / INK_W;
  body.style.height = Math.round(cardH(t) * k) + 'px';
  const ti = w.querySelector('.bc-tink'); if (ti) ti.style.height = Math.round(TITLE_H * k) + 'px';
  if (body.clientWidth) drawInk(body, t.strokes, k); if (ti) drawInk(ti, t.tstrokes, k);
  w.querySelectorAll('.bc-iink').forEach(cv => { const it = (t.items || []).find(x => x.id === cv.dataset.item); cv.style.height = Math.round(ITEM_H * k) + 'px'; if (cv.clientWidth) drawInk(cv, it && it.strokes, k); });
}
function renderBoard(pi) {
  const note = bN(pi), pg = bP(note, pi), rec = bE(pi); if (!rec || !isBoardPage(pg)) return;
  if (boardBusy()) { BS.dirty = true; return; }
  rec.el.classList.add('board-page');
  let b = rec.el.querySelector('.board');
  const keep = b ? { left: b.querySelector('.bcols').scrollLeft, tops: Object.fromEntries([...b.querySelectorAll('.bcol')].map(c => [c.dataset.col, c.querySelector('.blist').scrollTop])) } : BS.keep[pg.id];
  if (!b) { b = document.createElement('div'); b.className = 'board'; rec.el.append(b); }
  const cols = boardCols(pg), ids = new Set(cols.map(c => c.id));
  for (const t of pg.tasks) if (isCard(t) && !ids.has(t.col)) t.col = cols[0].id;   // orphans land in the first column
  const now = Date.now(), cards = pg.tasks.filter(isCard), open = cards.filter(t => !t.done).length, F = boardFilter(pg);
  b.classList.toggle('compact', !!pg.board.compact);
  b.innerHTML = `<div class="bhead"><span class="btitle">${esc(pg.board.title || '📋 Project Board')}</span><span class="bsum">${open} open · ${cards.length - open} done</span><span class="bwarn"></span><div class="spacer"></div>
    <button class="bbtn" data-bact="compact" aria-label="Compact cards">${pg.board.compact ? '▦ Full' : '▤ Compact'}</button><button class="bbtn" data-bact="addcol">＋ Column</button>${typeof boardHeadExtra === 'function' ? boardHeadExtra(pg, pi) : ''}</div>
    <div class="bfilter"><span class="bf-l">Filter</span>${Object.entries(LABELS).map(([k, c]) => `<button class="bf-dot ${F.colors.includes(k) ? 'on' : ''}" data-bact="fcolor" data-c="${k}" style="--lc:${c}" aria-label="${k}"></button>`).join('')}
      <button class="bf-dot none ${F.colors.includes('none') ? 'on' : ''}" data-bact="fcolor" data-c="none" aria-label="No color"></button>
      <span class="bf-sep"></span>${[1, 2, 3].map(p => `<button class="bf-chip ${F.minP === p ? 'on' : ''}" data-bact="fprio" data-p="${p}">⚑ ${PRIO[p]}${p < 3 ? '+' : ''}</button>`).join('')}
      <button class="bf-chip hi ${F.minP === 3 ? 'on' : ''}" data-bact="fhigh">‼︎ High only</button><span class="spacer"></span>
      <button class="bf-chip ${F.hide ? 'on' : ''}" data-bact="fhide">${F.hide ? 'Hiding' : 'Dimming'}</button>${filterActive(F) ? '<button class="bf-chip" data-bact="fclear">✕ Clear</button>' : ''}</div>
    <div class="bcols">${cols.map((c, ci) => { const cc = colCards(pg, c.id); return `<section class="bcol ${ci === cols.length - 1 && cols.length > 1 ? 'is-last' : ''}" data-col="${c.id}" style="${colStyle(c.w)}"><div class="bcol-resize" aria-label="Drag to widen the column"><i></i></div>
      <header class="bcol-head"><span class="bcol-title" data-bact="rename">${esc(c.title || 'Untitled')}</span><span class="bcount">${cc.length}</span>${typeof colHeadExtra === 'function' ? colHeadExtra(pg, c, cc) : ''}
      <button class="bbtn icon" data-bact="add" aria-label="Add card">＋</button><button class="bbtn icon" data-bact="colmenu" aria-label="Column options">⋯</button></header>
      <div class="blist"><div class="bpull"><span>↓ Pull to add a card</span></div>${cc.map(t => cardHTML(t, now, pg)).join('')}<div class="bempty">${cc.length ? '' : 'Pull down or tap ＋ to add a card'}</div></div></section>`; }).join('')}</div>`;
  b.querySelectorAll('.bcard-wrap').forEach(w => { const t = pg.tasks.find(x => x.id === w.dataset.id); if (t) layoutCard(w, t); });
  if (keep) { b.querySelector('.bcols').scrollLeft = keep.left || 0; b.querySelectorAll('.bcol').forEach(c => { const v = keep.tops && keep.tops[c.dataset.col]; if (v) c.querySelector('.blist').scrollTop = v; }); }
  BS.keep[pg.id] = null;
  applyFilter(b, pg); updateWarnings(pi);
}
function rerenderBoards() { BS.dirty = false; if (QB.open) renderBoard(QPI); const n = curNote(); if (!n) return; n.pages.forEach((pg, i) => { if (isBoardPage(pg)) renderBoard(i); }); }
function afterChange(pi) { renderBoard(pi); renderSidebar(); renderPanel(); }

/* ---------- card ink (re-uses the page ink engine: drawStroke / drawPenSeg, pressure, colours, highlighter, eraser) ---------- */
// k = CSS px per ink unit (shared by a card's title and body so handwriting keeps one scale)
const pxPerUnit = cv => { const card = cv.closest('.bcard'), m = card && card.querySelector('.bc-main'); return ((m || cv).getBoundingClientRect().width || 200) / INK_W; };
function drawInk(cv, strokes, k = pxPerUnit(cv)) {
  if (!cv) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), W = Math.round((cv.clientWidth || 200) * dpr), H = Math.round((cv.clientHeight || 60) * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
  const st = strokes || [];
  for (const s of st) if (s.tool === 'highlighter') drawStroke(ctx, s);
  for (const s of st) if (s.tool !== 'highlighter') drawStroke(ctx, s);
  return ctx;
}
function cardThumb(t, W = 128, H = 80) {
  const st = (t.tstrokes || []).length ? t.tstrokes : (t.strokes || []); if (!st.length) return '';
  const key = ['card', t.id, st.length, st[st.length - 1].id, W, isDark()].join(':'); if (thumbCache.has(key)) return thumbCache.get(key);
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of st) { const b = s.bb || bbox(s.points); bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])]; }
  const pad = 6, bw = Math.max(20, bb[2] - bb[0] + pad * 2), bh = Math.max(20, bb[3] - bb[1] + pad * 2);
  const c = document.createElement('canvas'), dpr = 2; c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d'), sc = Math.min(W / bw, H / bh) * dpr;
  ctx.setTransform(sc, 0, 0, sc, (W * dpr - bw * sc) / 2 - (bb[0] - pad) * sc, (H * dpr - bh * sc) / 2 - (bb[1] - pad) * sc);
  for (const s of st) drawStroke(ctx, s);
  const u = c.toDataURL(); thumbCache.set(key, u); return u;
}
function inkGet(t, I) { if (I.item) { const it = (t.items || []).find(x => x.id === I.item); return it ? (it.strokes ||= []) : null; } return (t[I.key] ||= []); }
function inkSet(t, I, arr) { if (I.item) { const it = (t.items || []).find(x => x.id === I.item); if (it) it.strokes = arr; } else t[I.key] = arr; }
function inkPt(cv, e, k = pxPerUnit(cv)) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; }
function startInk(g, cv, e) {
  const t = findCard(g.pi, g.wrap.dataset.id); if (!t) return;
  const k = pxPerUnit(cv), p = inkPt(cv, e, k), pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
  const tool = S.tool === 'eraser' ? 'eraser' : S.tool === 'highlighter' ? 'highlighter' : 'pen';
  g.ink = { cv, id: t.id, tool, k, key: inkKey(cv.dataset.ink), item: cv.dataset.item || null };
  if (tool === 'eraser') { g.ink.snap = bSnap(g.pi); g.ink.erased = false; inkErase(g, p); return; }
  const hl = tool === 'highlighter';
  g.ink.stroke = { id: uid('s'), tool, color: hl ? S.hlColor : S.penColor, width: hl ? S.hlWidth * 0.8 : S.penWidth, points: [[+p[0].toFixed(1), +p[1].toFixed(1), +pr.toFixed(2)]] };
  const ctx = cv.getContext('2d'), kk = cv.width / (cv.clientWidth || 1) * k; ctx.setTransform(kk, 0, 0, kk, 0, 0); g.ink.ctx = ctx; g.ink.kk = kk;
  if (!hl) { ctx.save(); ctx.fillStyle = inkColor(g.ink.stroke.color); ctx.beginPath(); ctx.arc(p[0], p[1], g.ink.stroke.width * pf(pr) / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
}
function inkMove(g, e) {
  const I = g.ink; if (!I) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) {
    const p = inkPt(I.cv, ev, I.k);
    if (I.tool === 'eraser') { inkErase(g, p); continue; }
    const pts = I.stroke.points, last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.6) continue;
    const pr = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
    pts.push([+p[0].toFixed(1), +p[1].toFixed(1), +pr.toFixed(2)]);
    const c = I.ctx;
    if (I.tool === 'highlighter') { const t = findCard(g.pi, I.id); drawInk(I.cv, inkGet(t, I), I.k); c.setTransform(I.kk, 0, 0, I.kk, 0, 0); drawStroke(c, I.stroke); }
    else { c.save(); c.lineCap = 'round'; c.strokeStyle = inkColor(I.stroke.color); drawPenSeg(c, I.stroke, pts.length - 1); c.restore(); }
  }
}
function inkErase(g, p) {
  const t = findCard(g.pi, g.ink.id), cur = t && inkGet(t, g.ink); if (!cur) return;
  const R = 9, before = cur.length;
  const next = cur.filter(st => {
    const pts = st.points, lim = R + st.width / 2;
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > lim;
    for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= lim) return false;
    return true;
  });
  if (next.length !== before) { inkSet(t, g.ink, next); g.ink.erased = true; drawInk(g.ink.cv, next, g.ink.k); }
}
function inkEnd(g, discard) {
  const I = g.ink; g.ink = null; if (!I) return;
  const n = bN(g.pi), t = findCard(g.pi, I.id); if (!t) return;
  if (I.tool === 'eraser') { if (I.erased) { bPushSnap(g.pi, I.snap); saveNote(n, true); thumbCache.clear(); renderPanel(); } return; }
  if (discard) { drawInk(I.cv, inkGet(t, I), I.k); return; }
  I.stroke.bb = bbox(I.stroke.points);
  bH(g.pi); const arr = inkGet(t, I); if (!arr) return; arr.push(I.stroke); saveNote(n, true); thumbCache.clear();
  drawInk(I.cv, arr, I.k); renderPanel(); renderSidebar(); if (typeof v7OverlayHook === 'function') refreshPlanChips();
}

/* ---------- gestures ---------- */
onBoards('pointerdown', e => {
  const board = e.target.closest('.board'); if (!board) return;
  if ((e.pointerType === 'mouse' && e.button !== 0) || BS.g || BS.pinch || BS.editing && e.target.closest('input')) return;
  if (e.target.closest('input')) return;
  const pi = bPi(board);
  if (e.pointerType === 'pen') notePen();
  const head = e.target.closest('.bcol-head'), wrap = e.target.closest('.bcard-wrap'), list = e.target.closest('.blist'), col = e.target.closest('.bcol'), btn = e.target.closest('button');
  const g = { pi, pid: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: 'pending', board, col, list, wrap };
  const rz = e.target.closest('.bc-resize'), crz = e.target.closest('.bcol-resize');
  if (rz && wrap) { e.preventDefault(); BS.g = g; resizeStart(g); return; }
  if (crz && col) { e.preventDefault(); BS.g = g; colResizeStart(g); return; }
  const row = e.target.closest('.bc-item');
  g.fromGrip = !!e.target.closest('.bc-grip');
  if (head && !btn) g.kind = 'colhold';
  else if (row && wrap && !btn) {
    g.kind = 'item'; g.row = row;
    const cv = e.target.closest('.bc-iink');
    if (cv && (e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && fingerDrawOn()))) startInk(g, cv, e);
  } else if (wrap && !btn) {
    g.kind = 'card';
    const cv = e.target.closest('.bc-ink, .bc-tink');
    if (cv && (e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && fingerDrawOn()))) startInk(g, cv, e);
  } else if (list) g.kind = 'list';
  else return;
  g.canPull = !!list && list.scrollTop <= 0;
  if (g.kind !== 'list') g.timer = setTimeout(() => holdFire(g), B_LIFT);
  BS.g = g;
  if (g.ink) { e.preventDefault(); try { e.target.setPointerCapture(e.pointerId); } catch (_) {} }
});
function holdFire(g) {
  if (BS.g !== g || g.mode !== 'pending') return;
  if (g.ink) inkEnd(g, true);           // Pencil held still on the ink area: it's a lift, not a dot
  if (g.kind === 'card') liftStart(g); else if (g.kind === 'colhold') colLiftStart(g); else if (g.kind === 'item') itemLiftStart(g);
}
window.addEventListener('pointermove', e => {
  const g = BS.g; if (!g || e.pointerId !== g.pid) return;
  g.x = e.clientX; g.y = e.clientY;
  const dx = g.x - g.x0, dy = g.y - g.y0;
  g.maxD = Math.max(g.maxD || 0, Math.hypot(dx, dy));
  if (g.mode === 'pending') {
    if (g.ink) { if (Math.hypot(dx, dy) > B_SLOP) { clearTimeout(g.timer); g.mode = 'ink'; } inkMove(g, e); return; }
    if (Math.hypot(dx, dy) <= B_SLOP) return;
    clearTimeout(g.timer);
    if (g.kind === 'item' && Math.abs(dx) > Math.abs(dy) * 1.2) itemSwipeStart(g);
    else if (g.kind === 'card' && Math.abs(dx) > Math.abs(dy) * 1.2) swipeStart(g);
    else if (g.canPull && dy > 0 && dy > Math.abs(dx) * 1.2) pullStart(g);
    else { BS.g = null; return; }      // it's a scroll
  }
  if (g.mode === 'ink') inkMove(g, e);
  else if (g.mode === 'swipe') swipeMove(g);
  else if (g.mode === 'pull') pullMove(g);
  else if (g.mode === 'resize') resizeMove(g);
  else if (g.mode === 'colresize') colResizeMove(g);
  else if (g.mode === 'itemdrag') itemDragMove(g);
  else if (g.mode === 'iswipe') itemSwipeMove(g);
}, { passive: true });
function boardUp(e) {
  const g = BS.g; if (!g || e.pointerId !== g.pid) return;
  BS.g = null; clearTimeout(g.timer);
  const cancel = e.type === 'pointercancel';
  if (g.ink) inkEnd(g, cancel);
  if (g.mode === 'swipe') swipeEnd(g, cancel);
  else if (g.mode === 'pull') pullEnd(g, cancel);
  else if (g.mode === 'lift') liftEnd(g, cancel);
  else if (g.mode === 'coldrag') colEnd(g, cancel);
  else if (g.mode === 'resize') resizeEnd(g, cancel);
  else if (g.mode === 'colresize') colResizeEnd(g, cancel);
  else if (g.mode === 'itemdrag') itemDragEnd(g, cancel);
  else if (g.mode === 'iswipe') itemSwipeEnd(g, cancel);
  if (BS.dirty && !boardBusy()) rerenderBoards();
}
window.addEventListener('pointerup', boardUp);
window.addEventListener('pointercancel', boardUp);
// Once a gesture owns the pointer, stop the page/column from scrolling under the finger or Pencil.
document.addEventListener('touchmove', e => {
  const g = BS.g; if (!g || !e.cancelable) return;
  if (g.mode !== 'pending' || g.ink) { e.preventDefault(); return; }
  const t = e.touches[0];
  if (g.canPull && t && t.clientY > g.y0 + 1 && Math.abs(t.clientY - g.y0) >= Math.abs(t.clientX - g.x0)) e.preventDefault();   // pull-to-add at the top of a column
}, { passive: false });
onBoards('contextmenu', e => { if (e.target.closest('.board')) e.preventDefault(); });
onBoards('click', e => { if (BS.suppress && e.target.closest('.board')) { e.stopPropagation(); e.preventDefault(); } }, true);

/* swipe: right = done (moves to the last column), left = delete */
function swipeStart(g) { g.mode = 'swipe'; g.card = g.wrap.querySelector('.bcard'); g.card.style.transition = 'none'; g.wrap.classList.add('swiping'); }
function swipeMove(g) {
  let dx = g.x - g.x0; const W = g.wrap.offsetWidth, arm = Math.min(110, W * 0.36);
  if (Math.abs(dx) > W * 0.7) dx = Math.sign(dx) * (W * 0.7 + (Math.abs(dx) - W * 0.7) * 0.3);
  g.dx = dx; g.card.style.transform = `translateX(${dx}px) rotate(${dx / W * 2}deg)`;
  g.wrap.classList.toggle('sw-right', dx > 0); g.wrap.classList.toggle('sw-left', dx < 0);
  const armed = Math.abs(dx) > arm;
  if (armed !== !!g.armed) { g.armed = armed; g.wrap.classList.toggle('armed', armed); if (armed) buzz(); }
}
function swipeEnd(g, cancel) {
  suppressClicks();
  const card = g.card, wrap = g.wrap, id = wrap.dataset.id;
  card.style.transition = '';
  if (!cancel && g.armed && g.dx > 0) {
    card.style.transform = ''; wrap.classList.add('flash-done');
    setTimeout(() => completeCard(g.pi, id), 260);
  } else if (!cancel && g.armed && g.dx < 0) {
    card.style.transform = 'translateX(-115%)'; wrap.style.height = wrap.offsetHeight + 'px'; void wrap.offsetHeight;
    wrap.classList.add('removing');
    setTimeout(() => deleteCard(g.pi, id), 260);
  } else { card.style.transform = ''; setTimeout(() => wrap.classList.remove('swiping', 'sw-right', 'sw-left', 'armed'), 250); }
}
function completeCard(pi, id) {
  const n = bN(pi), pg = bP(n, pi), t = findCard(pi, id); if (!t) return;
  const cols = boardCols(pg), last = doneCols(pg)[0];
  bH(pi);
  let msg = '';
  if (t.repeat && t.due && !t.done) { let d = t.due; do d = advance(d, t.repeat); while (new Date(d) < Date.now()); t.due = d; t.notified = false; msg = 'Done — next: ' + fmtDue(d); }
  else if (isDoneCol(pg, t.col) || (cols.length === 1 && t.done)) {
    t.done = false; t.doneAt = null; const from = t.col; t.col = cols[0].id; t.ord = -1; renumber(pg, t.col); if (from !== t.col) renumber(pg, from); msg = 'Reopened → ' + (cols[0].title || 'first column');
  } else {
    const from = t.col; t.done = true; t.doneAt = Date.now(); t.col = last; t.ord = -1; renumber(pg, last); if (from !== last) renumber(pg, from); msg = '✓ Done';
  }
  saveNote(n, true); afterChange(pi);
  const w = cardWrap(pi, id); if (w) { w.classList.add('flash-done'); w.scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => w.classList.remove('flash-done'), 700); }
  toast(msg, 1600);
}
function deleteCard(pi, id) {
  const n = bN(pi), pg = bP(n, pi), t = findCard(pi, id); if (!t) return;
  bH(pi); pg.tasks = pg.tasks.filter(x => x !== t); renumber(pg, t.col); saveNote(n, true); afterChange(pi);
  undoToast('Deleted “' + (t.text || ((t.strokes || []).length || (t.tstrokes || []).length ? 'handwritten card' : 'card')) + '”', pi);
}
function actionToast(msg, label, fn, ms = 6000) {
  let u = document.getElementById('undoToast');
  if (!u) { u = document.createElement('div'); u.id = 'undoToast'; u.innerHTML = '<span></span><button></button>'; document.body.append(u);
    u.querySelector('button').onclick = () => { u.hidden = true; const f = u._fn; u._fn = null; f && f(); }; }
  u.querySelector('span').textContent = msg; u.querySelector('button').textContent = label; u._fn = fn;
  u.hidden = false; u.classList.remove('pop'); void u.offsetWidth; u.classList.add('pop');
  clearTimeout(actionToast.t); actionToast.t = setTimeout(() => u.hidden = true, ms);
}
function undoToast(msg, pi) { actionToast(msg, 'Undo', () => { bUndo(pi); toast('Undone', 1200); }, 5000); }

/* pull down at the top of a column = new card at the top */
function pullStart(g) { g.mode = 'pull'; g.ind = g.list.querySelector('.bpull span'); g.list.classList.add('pulling'); }
function pullMove(g) {
  const off = Math.min(120, Math.max(0, g.y - g.y0) * 0.55); g.list.style.setProperty('--pull', off + 'px');
  const armed = off > 52;
  if (armed !== !!g.armed) { g.armed = armed; g.list.classList.toggle('pull-armed', armed); g.ind.textContent = armed ? '↑ Release to add a card' : '↓ Pull to add a card'; if (armed) buzz(); }
}
function pullEnd(g, cancel) {
  suppressClicks();
  g.list.classList.remove('pulling', 'pull-armed'); g.list.style.setProperty('--pull', '0px');
  setTimeout(() => { g.ind.textContent = '↓ Pull to add a card'; }, 250);
  if (!cancel && g.armed) addCard(g.pi, g.col.dataset.col);
}

/* press & hold: lift a card; others slide apart live; drop in any column at any position — or on a planner slot / the 🗓 dock */
function planDock() {
  let d = document.getElementById('bDock');
  if (!d) { d = document.createElement('div'); d.id = 'bDock'; d.innerHTML = '🗓 <b>Drop on Planner</b><small>pick a day & time</small>'; document.body.append(d); }
  return d;
}
function liftStart(g) {
  g.mode = 'lift'; buzz();
  const wrap = g.wrap, card = wrap.querySelector('.bcard'), r = card.getBoundingClientRect();
  const ghost = card.cloneNode(true); ghost.classList.add('bghost'); ghost.removeAttribute('data-id');
  if (g.board.classList.contains('compact')) ghost.classList.add('compact');
  const srcs = card.querySelectorAll('canvas'), dsts = ghost.querySelectorAll('canvas');
  srcs.forEach((src, i) => { const dst = dsts[i]; if (dst && src.width) { dst.width = src.width; dst.height = src.height; dst.getContext('2d').drawImage(src, 0, 0); } });
  ghost.style.setProperty('--cc', getComputedStyle(card).getPropertyValue('--cc'));
  Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  document.body.append(ghost); void ghost.offsetWidth; ghost.classList.add('up');
  g.ghost = ghost; g.r0 = r; g.grab = [g.x0 - r.left, g.y0 - r.top]; g.liftD = g.maxD || 0;
  const cs = getComputedStyle(wrap); g.H = wrap.offsetHeight + parseFloat(cs.marginBottom || 0);
  wrap.classList.add('bplaceholder'); g.board.classList.add('bdragging'); document.body.classList.add('bcarrying');
  const vis = w => w.offsetParent !== null;     // filtered-out (hidden) cards don't take part
  g.cols = [...g.board.querySelectorAll('.bcol')].map(c => ({ id: c.dataset.col, el: c, list: c.querySelector('.blist'), wraps: [...c.querySelectorAll('.bcard-wrap')].filter(vis), count: c.querySelector('.bcount'), n: c.querySelectorAll('.bcard-wrap').length }));
  g.src = g.cols.find(c => c.el === g.col); g.srcIdx = g.src.wraps.indexOf(wrap); g.tgt = null; g.k = -1;
  for (const c of g.cols) for (const w of c.wraps) if (w !== wrap) w.classList.add('bshift');
  planDock().classList.add('show');
  const loop = () => { if (g.mode !== 'lift') return; liftFrame(g); g.raf = requestAnimationFrame(loop); };
  loop();
}
function autoScrollBoard(g, vertical) {
  const bc = g.board.querySelector('.bcols'), r = bc.getBoundingClientRect(), E = 60;
  if (g.x < r.left + E && g.x > r.left - 30) bc.scrollLeft -= Math.ceil((r.left + E - g.x) / 4);
  else if (g.x > r.right - E && g.x < r.right + 30) bc.scrollLeft += Math.ceil((g.x - r.right + E) / 4);
  const L = vertical && vertical.list; if (!L) return;
  const lr = L.getBoundingClientRect();
  if (g.y < lr.top + 36 && g.y > lr.top - 30) L.scrollTop -= Math.ceil((lr.top + 36 - g.y) / 4);
  else if (g.y > lr.bottom - 36 && g.y < lr.bottom + 30) L.scrollTop += Math.ceil((g.y - lr.bottom + 36) / 4);
}
function clearPlanHL() { document.querySelectorAll('.slot-hl.bslot').forEach(e => e.remove()); }
function liftFrame(g) {
  const W = $('#pages'), wr = W.getBoundingClientRect(), dock = planDock(), dr = dock.getBoundingClientRect();
  const overDock = g.x >= dr.left - 8 && g.x <= dr.right + 8 && g.y >= dr.top - 8 && g.y <= dr.bottom + 8;
  const hits = document.elementsFromPoint(g.x, g.y), inDrawer = hits.some(e => e.id === 'qbDrawer');
  if (!overDock && !inDrawer && g.pi !== QPI) {   // page auto-scroll so a planner page further down the note can be reached
    if (g.y > wr.bottom - 70 && g.y < wr.bottom + 40) W.scrollTop += Math.ceil((g.y - wr.bottom + 70) / 4);
    else if (g.y < wr.top + 40 && g.y > wr.top - 40) W.scrollTop -= Math.ceil((wr.top + 40 - g.y) / 4);
  }
  const gx = g.x - g.grab[0], gy = g.y - g.grab[1];
  g.ghost.style.transform = `translate(${gx - g.r0.left}px, ${gy - g.r0.top}px) scale(${overDock ? 0.8 : 1.05}) rotate(-1.2deg)`;
  dock.classList.toggle('hot', overDock);
  // over a Daily Planner page of this note?
  let slot = null;
  let xb = null;     // v19: over another board (drawer ↔ note board page)?
  if (!overDock) { const col = hits.find(e => e.classList && e.classList.contains('bcol')), host = col && col.closest('[data-pi]');
    if (col && host && bPi(host) !== g.pi && !(inDrawer && bPi(host) !== QPI)) xb = { type: 'xboard', pi: bPi(host), col: col.dataset.col, el: col }; }
  document.querySelectorAll('.bcol.bdrop-x').forEach(e => { if (!xb || e !== xb.el) e.classList.remove('bdrop-x'); }); if (xb) xb.el.classList.add('bdrop-x');
  if (!overDock && !xb && !inDrawer) {
    const pageEl = hits.find(e => e.classList && e.classList.contains('page'));
    const pg = pageEl && curNote().pages[+pageEl.dataset.pi];
    if (pg && pg.bg && pg.bg.name === 'planner') { const r = pageEl.getBoundingClientRect(), sl = slotAtY(pg.bg, (g.y - r.top) / S.scale); if (sl) slot = { pi: +pageEl.dataset.pi, sl }; }
  }
  const key = overDock ? 'dock' : slot ? slot.pi + ':' + slot.sl.i : '';
  if (key !== (g.hlKey || '')) {
    g.hlKey = key; clearPlanHL();
    if (slot) { const s = S.scale, d = document.createElement('div'); d.className = 'slot-hl bslot';
      Object.assign(d.style, { left: TIME_COL * s + 'px', top: slot.sl.y0 * s + 'px', width: (960 - TIME_COL) * s + 'px', height: slot.sl.h * s + 'px' });
      d.innerHTML = `<span>${fmt12(slot.sl.time)}</span>`; pageEls[slot.pi].ov.append(d); buzz(); }
  }
  g.drop = overDock ? { type: 'dock' } : xb ? xb : slot ? { type: 'slot', ...slot } : null;
  if (g.drop) {     // close the gap on the board while hovering the planner
    if (g.tgt !== null) { g.tgt = null; g.k = -1; for (const c of g.cols) { c.el.classList.remove('bdrop'); c.count.textContent = c.n - (c === g.src ? 1 : 0); c.wraps.forEach((w, j) => { w.style.transform = c === g.src && j > g.srcIdx ? `translateY(${-g.H}px)` : ''; }); } }
    return;
  }
  autoScrollBoard(g, g.tgt);
  let tc = null, best = Infinity;
  for (const c of g.cols) { const r = c.el.getBoundingClientRect(), d = g.x < r.left ? r.left - g.x : g.x > r.right ? g.x - r.right : 0; if (d < best) { best = d; tc = c; } }
  const lr = tc.list.getBoundingClientRect(), cy = gy + g.r0.height / 2;
  let k = 0; tc.wraps.forEach(w => { if (w !== g.wrap && lr.top - tc.list.scrollTop + w.offsetTop + w.offsetHeight / 2 < cy) k++; });
  if (tc === g.tgt && k === g.k) return;
  g.tgt = tc; g.k = k;
  for (const c of g.cols) {
    c.el.classList.toggle('bdrop', c === tc && c !== g.src);
    c.count.textContent = c.n + (c === tc ? 1 : 0) - (c === g.src ? 1 : 0);
    c.wraps.forEach((w, j) => {
      if (w === g.wrap) return;
      let t = 0;
      if (c === g.src && c === tc) { const i = g.srcIdx; if (i < k && j > i && j <= k) t = -g.H; else if (k < i && j >= k && j < i) t = g.H; }
      else if (c === g.src) { if (j > g.srcIdx) t = -g.H; }
      else if (c === tc) { if (j >= k) t = g.H; }
      w.style.transform = t ? `translateY(${t}px)` : '';
    });
  }
}
function liftEnd(g, cancel) {
  cancelAnimationFrame(g.raf); g.mode = 'dropped'; suppressClicks();
  document.body.classList.remove('bcarrying'); planDock().classList.remove('show', 'hot'); clearPlanHL();
  document.querySelectorAll('.bcol.bdrop-x').forEach(e => e.classList.remove('bdrop-x'));
  const n = bN(g.pi), pg = bP(n, g.pi), id = g.wrap.dataset.id, t = findCard(g.pi, id);
  const still = g.fromGrip && (g.maxD || 0) < 12;     // lifted from the grip and released in place → color & priority
  let flash = '';
  if (!cancel && t && g.drop) {
    g.ghost.remove(); renderBoard(g.pi);
    if (g.drop.type === 'xboard') moveCardAcross(g.pi, id, g.drop.pi, g.drop.col);
    else if (g.drop.type === 'slot') linkCardToSlot(g.pi, id, curNote(), g.drop.pi, g.drop.sl);
    else cardPlannerPicker(g.pi, id);
    return;
  }
  if (!cancel && t && g.tgt && !still) {
    const from = t.col, before = colCards(pg, g.tgt.id).map(x => x.id).join(), others = colCards(pg, g.tgt.id).filter(x => x !== t);
    const vis = g.tgt.wraps.filter(w => w !== g.wrap).map(w => w.dataset.id);
    let at = others.length;
    if (g.k < vis.length) at = others.findIndex(x => x.id === vis[g.k]); else if (vis.length) at = others.findIndex(x => x.id === vis[vis.length - 1]) + 1;
    if (at < 0) at = others.length;
    const order = others.slice(); order.splice(at, 0, t);
    if (g.tgt.id !== from || order.map(x => x.id).join() !== before) {
      bH(g.pi);
      t.col = g.tgt.id; order.forEach((x, i) => x.ord = i); if (from !== t.col) renumber(pg, from);
      if (isDoneCol(pg, t.col) && !t.done) { t.done = true; t.doneAt = Date.now(); flash = 'flash-done'; }
      else if (isDoneCol(pg, from) && !isDoneCol(pg, t.col) && t.done) { t.done = false; t.doneAt = null; }
      saveNote(n, true);
    }
  }
  const ghost = g.ghost;
  renderBoard(g.pi); renderSidebar(); renderPanel();
  const w = cardWrap(g.pi, id);
  if (!w) { ghost.remove(); return; }
  w.classList.add('blanding');
  const r = w.querySelector('.bcard').getBoundingClientRect();
  ghost.classList.add('drop'); ghost.classList.remove('up');
  ghost.style.transform = `translate(${r.left - g.r0.left}px, ${r.top - g.r0.top}px) scale(1)`;
  setTimeout(() => { ghost.remove(); w.classList.remove('blanding'); w.classList.add('settle'); if (flash) w.classList.add(flash); setTimeout(() => w.classList.remove('settle', 'flash-done'), 650); }, 210);
  if (still && !cancel && t) setTimeout(() => labelSheet(g.pi, id), 230);
}

/* press & hold a column header: reorder columns */
function colLiftStart(g) {
  g.mode = 'coldrag'; buzz();
  const bc = g.board.querySelector('.bcols'); g.bc = bc; g.sl0 = bc.scrollLeft;
  g.cols = [...bc.querySelectorAll('.bcol')]; g.idx = g.cols.indexOf(g.col); g.newIdx = g.idx;
  const gap = parseFloat(getComputedStyle(bc).columnGap) || 12; g.W = g.col.offsetWidth + gap;
  g.mids = g.cols.map(c => c.offsetLeft + c.offsetWidth / 2);
  g.col.classList.add('blifted'); g.board.classList.add('bcoldrag'); document.body.classList.add('bcarrying');
  for (const c of g.cols) if (c !== g.col) c.classList.add('bshift');
  const loop = () => { if (g.mode !== 'coldrag') return; colFrame(g); g.raf = requestAnimationFrame(loop); };
  loop();
}
function colFrame(g) {
  autoScrollBoard(g, null);
  const dx = g.x - g.x0 + (g.bc.scrollLeft - g.sl0), dy = Math.max(-20, Math.min(20, (g.y - g.y0) * 0.15));
  g.col.style.transform = `translate(${dx}px, ${dy}px) scale(1.03) rotate(${Math.max(-1.5, Math.min(1.5, (g.x - (g.lx ?? g.x)) * 0.2))}deg)`; g.lx = g.x;
  const px = g.mids[g.idx] + dx; let ni = 0; g.mids.forEach((m, j) => { if (j !== g.idx && m < px) ni++; });
  if (ni === g.newIdx) return; g.newIdx = ni;
  g.cols.forEach((c, j) => { if (j === g.idx) return; let t = 0; if (g.idx < ni && j > g.idx && j <= ni) t = -g.W; else if (ni < g.idx && j >= ni && j < g.idx) t = g.W; c.style.transform = t ? `translateX(${t}px)` : ''; });
}
function colEnd(g, cancel) {
  cancelAnimationFrame(g.raf); g.mode = 'dropped'; suppressClicks(); document.body.classList.remove('bcarrying');
  const n = bN(g.pi), pg = bP(n, g.pi), cols = boardCols(pg), id = g.col.dataset.col;
  if (!cancel && g.newIdx !== g.idx) { bH(g.pi); const i = cols.findIndex(c => c.id === id), [c] = cols.splice(i, 1); cols.splice(g.newIdx, 0, c); saveNote(n, true); }
  renderBoard(g.pi);
  const el = bE(g.pi).el.querySelector(`.bcol[data-col="${id}"]`); if (el) { el.classList.add('settle'); setTimeout(() => el.classList.remove('settle'), 500); }
}

/* ---------- taps: add / rename / menus / reminder ---------- */
onBoards('click', e => {
  const a = e.target.closest('[data-bact]'); if (!a || !e.target.closest('.board')) return;
  const pi = bPi(a), colEl = a.closest('.bcol'), wrap = a.closest('.bcard-wrap'), act = a.dataset.bact;
  if (act === 'addcol') addColumn(pi);
  else if (act === 'add') addCard(pi, colEl.dataset.col);
  else if (act === 'colmenu') colMenu(pi, colEl.dataset.col);
  else if (act === 'rename') renameColumn(pi, colEl.dataset.col);
  else if (act === 'title') editCardTitle(pi, wrap.dataset.id);
  else if (act === 'kb') toggleTyped(pi, wrap.dataset.id);
  else if (act === 'cmenu') cardMenu(pi, wrap.dataset.id);
  else if (act === 'additem') addItem(pi, wrap.dataset.id);
  else if (act === 'tick') tickItem(pi, wrap.dataset.id, a.closest('.bc-item').dataset.item);
  else if (act === 'ikb') toggleItemTyped(pi, wrap.dataset.id, a.closest('.bc-item').dataset.item);
  else if (act === 'itext') editItemText(pi, wrap.dataset.id, a.closest('.bc-item').dataset.item);
  else if (act === 'compact') setCompact(pi, !bP(bN(pi), pi).board.compact);
  else if (act === 'fcolor' || act === 'fprio' || act === 'fhigh' || act === 'fhide' || act === 'fclear') filterAction(pi, act, a.dataset);
  else if (act === 'due') { const t = findCard(pi, wrap.dataset.id); if (t) openEditor({ type: 'task', note: bN(pi), obj: t, page: bPage(pi) }); }
});
function inlineEdit(el, value, placeholder, done) {
  const inp = document.createElement('input'); inp.className = 'binline ' + el.className; inp.value = value; inp.placeholder = placeholder; inp.enterKeyHint = 'done'; inp.autocomplete = 'off';
  el.replaceWith(inp); BS.editing = true; inp.focus(); try { inp.select(); } catch (_) {}
  let fin = false;
  const finish = save => { if (fin) return; fin = true; BS.editing = false; done(save ? inp.value.trim() : null); };
  inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } else if (ev.key === 'Escape') { finish(false); } });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('pointerdown', ev => ev.stopPropagation());
  return inp;
}
function editCardTitle(pi, id) {
  const w = cardWrap(pi, id), el = w && w.querySelector('.bc-title'); if (!el) return;
  const t0 = findCard(pi, id);
  inlineEdit(el, t0.text || '', 'Card title', v => {
    const t = findCard(pi, id);
    if (t && v !== null && v !== (t.text || '')) { bH(pi); t.text = v; saveNote(bN(pi), true); }
    afterChange(pi);
  });
}
function renameColumn(pi, colId, isNew) {
  const el = bE(pi).el.querySelector(`.bcol[data-col="${colId}"] .bcol-title`); if (!el) return;
  const c0 = boardCols(bP(bN(pi), pi)).find(c => c.id === colId);
  inlineEdit(el, c0.title || '', 'Column name', v => {
    const c = boardCols(bP(bN(pi), pi)).find(x => x.id === colId);
    if (c && v && v !== c.title) { if (!isNew) bH(pi); c.title = v; saveNote(bN(pi), true); }
    renderBoard(pi);
  });
}
function toggleTyped(pi, id) {
  const t = findCard(pi, id); if (!t) return;
  bH(pi); const on = !isTyped(t); t.typed = on; saveNote(bN(pi), true); afterChange(pi);
  if (on) editCardTitle(pi, id); else hint('Write the title with your Pencil');
}
/* resize a card (bottom-right handle) — ink keeps its position; can't shrink past existing strokes */
function resizeStart(g) {
  const t = findCard(g.pi, g.wrap.dataset.id); if (!t) { BS.g = null; return; }
  g.mode = 'resize'; g.id = t.id; g.h0 = cardH(t); g.h = g.h0; g.body = g.wrap.querySelector('.bc-ink'); g.k = pxPerUnit(g.body);
  g.hmin = Math.max(H_MIN, Math.ceil(strokesBottom(t.strokes) + 6));
  g.wrap.classList.add('resizing'); document.body.classList.add('bresizing'); buzz();
}
function resizeMove(g) {
  const h = Math.round(Math.max(g.hmin, Math.min(H_MAX, g.h0 + (g.y - g.y0) / g.k)));
  if (h === g.h) return; g.h = h;
  const t = findCard(g.pi, g.id); g.body.style.height = Math.round(h * g.k) + 'px'; drawInk(g.body, t && t.strokes, g.k);
  g.wrap.classList.toggle('at-min', h <= g.hmin); g.wrap.classList.toggle('at-max', h >= H_MAX);
}
function resizeEnd(g, cancel) {
  suppressClicks(); g.wrap.classList.remove('resizing', 'at-min', 'at-max'); document.body.classList.remove('bresizing');
  const t = findCard(g.pi, g.id);
  if (!cancel && t && Math.abs(g.h - g.h0) >= 2) { bH(g.pi); t.h = g.h; saveNote(bN(g.pi), true); }
  renderBoard(g.pi);
}
/* widen / narrow a column (handle on its right edge, or ⋯ → Column width) */
function colResizeStart(g) {
  g.mode = 'colresize'; g.cid = g.col.dataset.col; g.w0px = g.col.getBoundingClientRect().width;
  const c = boardCols(bP(bN(g.pi), g.pi)).find(x => x.id === g.cid); g.f0 = +c.w || 1; g.f = g.f0;
  g.col.classList.add('bcol-sizing'); document.body.classList.add('bcolsizing'); buzz();
}
function colResizeMove(g) {
  const f = Math.max(CW_MIN, Math.min(CW_MAX, g.f0 * (g.w0px + g.x - g.x0) / g.w0px)); g.f = Math.round(f * 100) / 100;
  g.col.setAttribute('style', colStyle(g.f) || ''); g.col.querySelectorAll('.bcard-wrap').forEach(w => { const t = findCard(g.pi, w.dataset.id); if (t) layoutCard(w, t); });
}
function colResizeEnd(g, cancel) {
  suppressClicks(); g.col.classList.remove('bcol-sizing'); document.body.classList.remove('bcolsizing');
  if (!cancel && Math.abs(g.f - g.f0) >= 0.03) setColWidth(g.pi, g.cid, g.f); else renderBoard(g.pi);
}
function setColWidth(pi, colId, f) {
  const n = bN(pi), c = boardCols(bP(n, pi)).find(x => x.id === colId); if (!c) return;
  bH(pi); c.w = Math.max(CW_MIN, Math.min(CW_MAX, f)); if (Math.abs(c.w - 1) < 0.03) delete c.w; saveNote(n, true); renderBoard(pi);
}
function addCard(pi, colId, edit = false) {
  const n = bN(pi), pg = bP(n, pi), cols = boardCols(pg);
  bH(pi);
  const t = { id: uid('t'), kind: 'card', col: colId, ord: -1, text: '', strokes: [], done: isDoneCol(pg, colId), due: null, repeat: '', notified: false, createdAt: Date.now() };
  if (t.done) t.doneAt = Date.now();
  pg.tasks.push(t); renumber(pg, colId); saveNote(n, true);
  const colEl = bE(pi).el.querySelector(`.bcol[data-col="${colId}"] .blist`); if (colEl) colEl.scrollTop = 0;
  afterChange(pi);
  const w = cardWrap(pi, t.id);
  if (w) { w.classList.add('appear'); w.closest('.bcol').scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => w.classList.remove('appear'), 500); }
  if (edit) editCardTitle(pi, t.id);
  return t;
}
function addColumn(pi) {
  const n = bN(pi), pg = bP(n, pi), cols = boardCols(pg);
  bH(pi);
  const c = { id: uid('c'), title: 'New column' };
  const lastIsDone = cols.length > 1 && /done|finished|complete/i.test(cols[cols.length - 1].title || ''), firstDone = pg.board.doneCols ? cols.findIndex(x => doneCols(pg).includes(x.id)) : -1;
  cols.splice(firstDone >= 0 ? firstDone : lastIsDone ? cols.length - 1 : cols.length, 0, c);
  saveNote(n, true); renderBoard(pi);
  const el = bE(pi).el.querySelector(`.bcol[data-col="${c.id}"]`);
  if (el) { el.classList.add('appear'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  renameColumn(pi, c.id, true);
}
function moveColumn(pi, colId, d) {
  const n = bN(pi), cols = boardCols(bP(n, pi)), i = cols.findIndex(c => c.id === colId), j = i + d;
  if (j < 0 || j >= cols.length) return;
  bH(pi); const [c] = cols.splice(i, 1); cols.splice(j, 0, c); saveNote(n, true); renderBoard(pi);
}
function deleteColumn(pi, colId) {
  const n = bN(pi), pg = bP(n, pi), cols = boardCols(pg);
  if (cols.length < 2) { toast('A board needs at least one column'); return; }
  const i = cols.findIndex(c => c.id === colId); if (i < 0) return;
  bH(pi);
  const moving = colCards(pg, colId), wasDone = isDoneCol(pg, colId);
  cols.splice(i, 1); if (pg.board.doneCols) pg.board.doneCols = pg.board.doneCols.filter(x => x !== colId);
  const dest = cols[0], base = colCards(pg, dest.id).length;
  moving.forEach((t, k) => { t.col = dest.id; t.ord = base + k; if (wasDone && t.done && !isDoneCol(pg, dest.id)) { t.done = false; t.doneAt = null; } });
  saveNote(n, true); afterChange(pi);
  undoToast(moving.length ? `Column deleted — ${moving.length} card${moving.length > 1 ? 's' : ''} moved to “${dest.title}”` : 'Column deleted', pi);
}
function colMenu(pi, colId) {
  const pg = bP(bN(pi), pi), cols = boardCols(pg), i = cols.findIndex(c => c.id === colId), c = cols[i], cnt = colCards(pg, colId).length;
  const dest = cols.find(x => x.id !== colId);
  actionSheet(c.title || 'Column', [
    { label: '✏️ Rename column', fn: () => renameColumn(pi, colId) },
    { label: '＋ Add card', fn: () => addCard(pi, colId) },
    { label: '↔︎ Column width…', fn: () => setTimeout(() => { const w = +c.w || 1, m = v => Math.abs(w - v) < 0.05 ? '✓ ' : ''; actionSheet('Width of “' + c.title + '”', [
      { label: m(0.75) + 'Narrow', fn: () => setColWidth(pi, colId, 0.75) }, { label: m(1) + 'Normal (3 across)', fn: () => setColWidth(pi, colId, 1) },
      { label: m(1.5) + 'Wide', fn: () => setColWidth(pi, colId, 1.5) }, { label: m(2) + 'Extra wide', fn: () => setColWidth(pi, colId, 2) }]); }, 0) },
    ...(cols.length > 1 ? [{ label: (doneCols(pg).includes(colId) ? '✓ ' : '') + 'Counts as done', sub: 'Cards here are finished (no due warnings)', fn: () => toggleDoneCol(pi, colId) }] : []),
    ...(i > 0 ? [{ label: '← Move left', fn: () => moveColumn(pi, colId, -1) }] : []),
    ...(i < cols.length - 1 ? [{ label: 'Move right →', fn: () => moveColumn(pi, colId, 1) }] : []),
    ...(cols.length > 1 ? [{ label: '🗑 Delete column…', danger: true, fn: () => setTimeout(() => actionSheet(`Delete “${c.title}”?`, [
      { label: cnt ? `Delete — move ${cnt} card${cnt > 1 ? 's' : ''} to “${dest.title}”` : 'Delete column', danger: true, fn: () => deleteColumn(pi, colId) }]), 0) }] : []),
  ]);
}

/* ---------- integration: reminders panel done-toggle keeps the board in sync; deep links; PDF export ---------- */
const _toggleDone = toggleDone;
toggleDone = function (it) {
  _toggleDone(it);
  const o = it.obj; if (!isCard(o) || it.type !== 'task') return;
  const pg = it.note.pages[it.page]; if (!isBoardPage(pg)) return;
  const cols = boardCols(pg), last = doneCols(pg)[0]; if (cols.length < 2) return;
  const from = o.col;
  if (o.done && !isDoneCol(pg, o.col)) { o.col = last; o.ord = -1; renumber(pg, last); renumber(pg, from); }
  else if (!o.done && isDoneCol(pg, o.col)) { o.col = cols[0].id; o.ord = -1; renumber(pg, o.col); renumber(pg, from); }
  else return;
  saveNote(it.note, true); if (it.note.id === QUOTE_ID) { if (QB.open) renderBoard(QPI); } else if (it.note.id === S.cur) renderBoard(it.page);
};
function boardFlash(pi, id) {
  const rec = bE(pi), w = $('#pages'); if (!rec) return;
  if (pi !== QPI) w.scrollTo({ top: rec.el.offsetTop, behavior: 'smooth' });
  requestAnimationFrame(() => { const el = cardWrap(pi, id); if (!el) return; el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
}
function drawBoardExport(ctx, pg) {
  const c = tcol(), cols = boardCols(pg), n = cols.length, pad = 36, gap = 18, W = (PAGE_W - pad * 2 - gap * (n - 1)) / n;
  ctx.save(); ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.accent; ctx.font = `700 38px ${FONT}`; ctx.fillText((pg.board.title || 'Project Board').replace(/^\W+\s*/, ''), pad, 78);
  cols.forEach((col, i) => {
    const x = pad + i * (W + gap), cards = colCards(pg, col.id);
    ctx.fillStyle = c.band; ctx.fillRect(x, 110, W, PAGE_H - 140);
    ctx.fillStyle = c.ink; ctx.font = `700 ${n > 4 ? 18 : 22}px ${FONT}`; ctx.fillText(`${col.title} (${cards.length})`, x + 10, 142, W - 20);
    let y = 162;
    for (const t of cards) {
      const iw = W - 20, u = iw / INK_W, th = (t.tstrokes || []).length && !isTyped(t) ? TITLE_H * u : 0, ih = (t.strokes || []).length ? Math.min(cardH(t), strokesBottom(t.strokes) + 8) * u : 0, h = 46 + th + ih;
      if (y + h > PAGE_H - 40) break;
      ctx.strokeStyle = c.strong; ctx.lineWidth = 1.5; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x + 4, y, W - 8, h, 10) : ctx.rect(x + 4, y, W - 8, h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = t.done ? '#22a55a' : c.ink; ctx.font = `600 19px ${FONT}`; ctx.fillText((t.done ? '✓ ' : '') + (t.text || ''), x + 14, y + 28, W - 30);
      if (t.due) { ctx.fillStyle = '#6e6e76'; ctx.font = `600 14px ${FONT}`; ctx.fillText('⏰ ' + fmtDue(t.due), x + 14, y + 44, W - 30); }
      if (th) { ctx.save(); ctx.translate(x + 10, y + 8); ctx.scale(u, u); for (const s of t.tstrokes) drawStroke(ctx, s); ctx.restore(); }
      if (ih) { ctx.save(); ctx.translate(x + 10, y + 46 + th); ctx.scale(u, u); for (const s of t.strokes) drawStroke(ctx, s); ctx.restore(); }
      y += h + 12;
    }
  });
  ctx.restore();
}

/* ================= v13 ================= */
const noteOfPage = pg => S.notes.find(n => n.pages.includes(pg));
/* ---------- checklists ---------- */
function addItem(pi, id) {
  const t = findCard(pi, id); if (!t) return;
  bH(pi); (t.items ||= []).push({ id: uid('i'), done: false, strokes: [], text: '', typed: false });
  saveNote(bN(pi), true); afterChange(pi);
  const w = cardWrap(pi, id), rows = w && w.querySelectorAll('.bc-item'); if (rows && rows.length) { const r = rows[rows.length - 1]; r.classList.add('appear'); setTimeout(() => r.classList.remove('appear'), 400); }
}
function tickItem(pi, id, itemId) {
  const t = findCard(pi, id), it = t && (t.items || []).find(x => x.id === itemId); if (!it) return;
  bH(pi); it.done = !it.done; saveNote(bN(pi), true); afterChange(pi); if (it.done) buzz();
  const pg = bP(bN(pi), pi), all = t.items.length && t.items.every(x => x.done), inLast = isDoneCol(pg, t.col);
  if (it.done && all && !inLast) actionToast(`All ${t.items.length} items ticked ✓`, 'Move to Done', () => { const c = findCard(pi, id); if (c && !isDoneCol(bP(bN(pi), pi), c.col)) completeCard(pi, id); }, 7000);
}
function toggleItemTyped(pi, id, itemId) {
  const t = findCard(pi, id), it = t && (t.items || []).find(x => x.id === itemId); if (!it) return;
  bH(pi); it.typed = !it.typed; saveNote(bN(pi), true); afterChange(pi);
  if (it.typed) editItemText(pi, id, itemId);
}
function editItemText(pi, id, itemId) {
  const w = cardWrap(pi, id), el = w && w.querySelector(`.bc-item[data-item="${itemId}"] .bc-itext`); if (!el) return;
  const t0 = findCard(pi, id), it0 = t0.items.find(x => x.id === itemId);
  inlineEdit(el, it0.text || '', 'Checklist item', v => {
    const t = findCard(pi, id), it = t && (t.items || []).find(x => x.id === itemId);
    if (it && v !== null && v !== (it.text || '')) { bH(pi); it.text = v; saveNote(bN(pi), true); }
    afterChange(pi);
  });
}
function itemLiftStart(g) {
  g.mode = 'itemdrag'; buzz();
  const box = g.row.parentElement; g.rows = [...box.children]; g.idx = g.rows.indexOf(g.row);
  const gap = parseFloat(getComputedStyle(g.row).marginBottom) || 0; g.H = g.row.offsetHeight + gap;
  g.mids = g.rows.map(r => r.offsetTop + r.offsetHeight / 2); g.newIdx = g.idx;
  g.row.classList.add('ilifted'); g.rows.forEach(r => { if (r !== g.row) r.classList.add('bshift'); });
  itemDragMove(g);
}
function itemDragMove(g) {
  const dy = g.y - g.y0; g.row.style.transform = `translateY(${dy}px) scale(1.03)`;
  const py = g.mids[g.idx] + dy; let ni = 0; g.mids.forEach((m, j) => { if (j !== g.idx && m < py) ni++; });
  if (ni === g.newIdx) return; g.newIdx = ni; buzz();
  g.rows.forEach((r, j) => { if (j === g.idx) return; let t = 0; if (g.idx < ni && j > g.idx && j <= ni) t = -g.H; else if (ni < g.idx && j >= ni && j < g.idx) t = g.H; r.style.transform = t ? `translateY(${t}px)` : ''; });
}
function itemDragEnd(g, cancel) {
  suppressClicks();
  const id = g.wrap.dataset.id, t = findCard(g.pi, id);
  if (!cancel && t && g.newIdx !== g.idx) { bH(g.pi); const [m] = t.items.splice(g.idx, 1); t.items.splice(g.newIdx, 0, m); saveNote(bN(g.pi), true); }
  renderBoard(g.pi);
}
function itemSwipeStart(g) { g.mode = 'iswipe'; g.row.classList.add('iswiping'); g.row.style.transition = 'none'; }
function itemSwipeMove(g) {
  const dx = Math.max(-g.row.offsetWidth, Math.min(g.row.offsetWidth * 0.5, g.x - g.x0)); g.dx = dx;
  g.row.style.transform = `translateX(${dx}px)`; g.row.classList.toggle('del-armed', dx < -70); g.row.classList.toggle('tick-armed', dx > 70);
}
function itemSwipeEnd(g, cancel) {
  suppressClicks(); g.row.style.transition = ''; const id = g.wrap.dataset.id, itemId = g.row.dataset.item;
  if (!cancel && g.dx < -70) {
    g.row.style.transform = 'translateX(-110%)'; g.row.style.opacity = '0';
    setTimeout(() => { const t = findCard(g.pi, id); if (!t) return; bH(g.pi); t.items = t.items.filter(x => x.id !== itemId); saveNote(bN(g.pi), true); afterChange(g.pi); undoToast('Checklist item deleted', g.pi); }, 180);
  } else if (!cancel && g.dx > 70) { g.row.style.transform = ''; tickItem(g.pi, id, itemId); }
  else { g.row.style.transform = ''; g.row.classList.remove('iswiping', 'del-armed', 'tick-armed'); }
}

/* ---------- color labels & priority ---------- */
async function labelSheet(pi, id) {
  const t = findCard(pi, id); if (!t) return;
  const items = [...Object.keys(LABELS).map(k => ({ label: (t.color === k ? '✓ ' : '') + k[0].toUpperCase() + k.slice(1), value: { c: k }, cls: 'lab lab-' + k })),
    { label: (!t.color ? '✓ ' : '') + 'No color', value: { c: null }, cls: 'lab' },
    ...[0, 1, 2, 3].map(p => ({ label: ((t.prio || 0) === p ? '✓ ' : '') + '⚑ ' + PRIO[p], value: { p }, cls: 'prio prio' + p }))];
  const v = await pickSheet('Color & priority', items, { grid: true, sub: 'Color label and priority flag for this card' });
  if (v) setLabel(pi, id, v);
}
function setLabel(pi, id, v) {
  const t = findCard(pi, id); if (!t) return;
  bH(pi); if ('c' in v) { if (v.c) t.color = v.c; else delete t.color; } if ('p' in v) { if (v.p) t.prio = v.p; else delete t.prio; }
  saveNote(bN(pi), true); afterChange(pi);
}
function cardMenu(pi, id) {
  const t = findCard(pi, id); if (!t) return;
  actionSheet(t.text || cardFallback(t, bN(pi), pi), [
    { label: '🎨 Color & priority…', fn: () => labelSheet(pi, id) },
    { label: '☑︎ Add checklist item', fn: () => addItem(pi, id) },
    { label: '⏰ Reminder…', fn: () => openEditor({ type: 'task', note: bN(pi), obj: findCard(pi, id), page: bPage(pi) }) },
    ...(typeof cardMenuExtra === 'function' ? cardMenuExtra(pi, id) : []),
    { label: '🗓 Put on planner…', fn: () => cardPlannerPicker(pi, id) },
    { label: '🗑 Delete card', danger: true, fn: () => deleteCard(pi, id) }]);
}

/* ---------- filter bar ---------- */
function boardFilter(pg) {
  BS.filters ||= {};
  if (!BS.filters[pg.id]) { let f = null; try { f = JSON.parse(localStorage.getItem('boardFilter:' + pg.id)); } catch (_) {} BS.filters[pg.id] = { colors: [], minP: 0, hide: false, ...(f || {}) }; }
  return BS.filters[pg.id];
}
const filterActive = F => F.colors.length > 0 || F.minP > 0;
const cardMatches = (t, F) => (!F.colors.length || F.colors.includes(t.color || 'none')) && (t.prio || 0) >= F.minP;
function applyFilter(b, pg) {
  const F = boardFilter(pg), on = filterActive(F);
  b.classList.toggle('filtering', on);
  b.querySelectorAll('.bcard-wrap').forEach(w => { const t = pg.tasks.find(x => x.id === w.dataset.id), m = !on || (t && cardMatches(t, F)); w.classList.toggle('fdim', !m && !F.hide); w.classList.toggle('fhide', !m && F.hide); });
}
function filterAction(pi, act, d) {
  const pg = bP(bN(pi), pi), F = boardFilter(pg);
  if (act === 'fcolor') F.colors = F.colors.includes(d.c) ? F.colors.filter(x => x !== d.c) : [...F.colors, d.c];
  if (act === 'fprio') F.minP = F.minP === +d.p ? 0 : +d.p;
  if (act === 'fhigh') F.minP = F.minP === 3 ? 0 : 3;
  if (act === 'fhide') F.hide = !F.hide;
  if (act === 'fclear') { F.colors = []; F.minP = 0; }
  localStorage.setItem('boardFilter:' + pg.id, JSON.stringify(F));
  renderBoard(pi);
}

/* ---------- due-date warnings (live, every minute) ---------- */
function updateWarnings(pi) {
  const n = bN(pi), pg = bP(n, pi), rec = bE(pi), b = rec && rec.el.querySelector('.board'); if (!b || !isBoardPage(pg)) return;
  const now = Date.now(); let od = 0, soon = 0;
  b.querySelectorAll('.bcard').forEach(c => { const t = pg.tasks.find(x => x.id === c.dataset.id); if (!t) return; const w = warnOf(t, pg, now); c.classList.toggle('overdue', w === 'overdue'); c.classList.toggle('soon', w === 'soon'); if (w === 'overdue') od++; if (w === 'soon') soon++; });
  const h = b.querySelector('.bwarn'); if (h) h.innerHTML = (od ? `<span class="w-od">${od} overdue</span>` : '') + (soon ? `<span class="w-soon">${soon} due soon</span>` : '');
}
function boardTick() { if (QB.open) updateWarnings(QPI); const n = curNote(); if (n) n.pages.forEach((pg, i) => { if (isBoardPage(pg)) updateWarnings(i); }); }
setInterval(boardTick, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) boardTick(); });

/* ---------- compact mode: pinch in = compact, pinch out = full (or the header button) ---------- */
function setCompact(pi, on) {
  const n = bN(pi), pg = bP(n, pi); if (!isBoardPage(pg) || !!pg.board.compact === !!on) return;
  pg.board.compact = !!on; saveNote(n, true);   // a view setting: saved, not an undo step
  renderBoard(pi); toast(on ? '▤ Compact cards — pinch out for full cards' : '▦ Full cards', 1400);
}
function cancelBoardGesture() { const g = BS.g; if (g) boardUp({ pointerId: g.pid, type: 'pointercancel' }); }
const tDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
onBoards('touchstart', e => {
  const b = e.target.closest && e.target.closest('.board'); if (!b || e.touches.length !== 2) return;
  if ([...e.touches].some(t => t.touchType === 'stylus')) return;
  e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
  cancelBoardGesture();            // a pinch never starts a drag or leaves ink
  BS.pinch = { d0: Math.max(20, tDist(e.touches[0], e.touches[1])), ratio: 1, pi: bPi(b), b };
}, { capture: true, passive: false });
onBoards('touchmove', e => {
  const P = BS.pinch; if (!P) return; e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault();
  if (e.touches.length < 2) return;
  P.ratio = tDist(e.touches[0], e.touches[1]) / P.d0;
  P.b.querySelector('.bcols').style.transform = `scale(${Math.max(0.9, Math.min(1.06, 1 + (P.ratio - 1) * 0.25))})`;
  P.b.classList.toggle('pinch-in', P.ratio < 0.8); P.b.classList.toggle('pinch-out', P.ratio > 1.25);
}, { capture: true, passive: false });
function pinchEnd(e) {
  const P = BS.pinch; if (!P || (e.touches && e.touches.length >= 2)) return;
  e.stopImmediatePropagation(); BS.pinch = null;
  P.b.querySelector('.bcols').style.transform = ''; P.b.classList.remove('pinch-in', 'pinch-out');
  suppressClicks();
  if (P.ratio < 0.8) setCompact(P.pi, true); else if (P.ratio > 1.25) setCompact(P.pi, false);
}
onBoards('touchend', pinchEnd, { capture: true });
onBoards('touchcancel', pinchEnd, { capture: true });

/* ---------- cards on the Daily Planner ---------- */
function linkCardToSlot(pi, id, plannerNote, plannerPi, sl, noHistory) {
  const n = bN(pi), t = findCard(pi, id), ppg = plannerNote.pages[plannerPi]; if (!t || !ppg || !ppg.bg || ppg.bg.name !== 'planner') return;
  if (!noHistory) bH(pi);
  t.due = slotDate(ppg.bg.date, sl.time).toISOString(); t.notified = false; t.plan = { noteId: plannerNote.id, pageId: ppg.id, time: sl.time };
  saveNote(n, true); afterChange(pi); refreshPlanChips();
  const w = cardWrap(pi, id); if (w) { w.classList.add('flash'); setTimeout(() => w.classList.remove('flash'), 1600); }
  toast(`🗓 On the planner · ${fmtDue(t.due)}${plannerNote.id !== n.id ? ' · ' + plannerNote.title : ''}`, 2600);
}
async function cardPlannerPicker(pi, id) {
  const list = [];
  for (const n of S.notes) n.pages.forEach((pg, i) => { if (pg.bg && pg.bg.name === 'planner') list.push({ n, i, date: pg.bg.date }); });
  list.sort((a, b) => a.date.localeCompare(b.date) || a.n.title.localeCompare(b.n.title));
  const today = todayISO();
  const items = list.map(x => ({ label: (x.date === today ? '☀️ Today · ' : '🗓 ') + longDate(x.date), sub: `${x.n.title} · page ${x.i + 1}`, value: x, cls: x.date === today ? 'today' : '' }));
  items.push({ label: '＋ New planner page for today', sub: `Adds a page to “${curNote().title}”`, value: 'new' });
  const ch = await pickSheet('Put this card on which planner?', items); if (!ch) return;
  let dst = ch, hist = false;
  if (ch === 'new') { const n = curNote(); pushHistory(); hist = true; n.pages.push(makeTemplatePage('planner', n, today)); saveNote(n, true); buildPages(); dst = { n, i: n.pages.length - 1 }; }
  const pg = dst.n.pages[dst.i], slots = plannerSlots(pg.bg);
  const sl = await pickSheet(longDate(pg.bg.date), slots.map(s => ({ label: fmt12(s.time), value: s })), { grid: true, sub: 'Pick a time slot. The card’s reminder is set to that time; the card stays on the board.' });
  if (!sl) return;
  linkCardToSlot(pi, id, dst.n, dst.i, sl, hist);
}
function planChipsFor(ppg) {    // every card (any note) linked to this planner page
  const out = [];
  for (const n of S.notes) n.pages.forEach((pg, pi) => { if (isBoardPage(pg)) for (const t of pg.tasks) if (isCard(t) && t.plan && t.plan.pageId === ppg.id && planOK(t)) out.push({ n, pi, t }); });
  return out;
}
function renderPlanChips(pi) {
  const n = curNote(), pg = n && n.pages[pi], rec = pageEls[pi]; if (!rec || !pg || !pg.bg || pg.bg.name !== 'planner') return;
  rec.ov.querySelectorAll('.plan-card').forEach(e => e.remove());
  const s = S.scale, slots = plannerSlots(pg.bg), per = new Map();
  for (const { n: cn, t } of planChipsFor(pg)) {
    const sl = slotForTime(slots, t.plan.time), k = per.get(sl.i) || 0; per.set(sl.i, k + 1);
    const h = Math.min(sl.h - 6, 44), w = 230, x = 940 - w - k * (w + 8);
    const d = document.createElement('button'); d.className = 'plan-card' + (t.done ? ' done' : ''); d.dataset.card = t.id;
    Object.assign(d.style, { left: x * s + 'px', top: (sl.y0 + (sl.h - h) / 2) * s + 'px', width: w * s + 'px', height: h * s + 'px', fontSize: Math.max(10, 17 * s) + 'px' });
    if (t.color) d.style.setProperty('--lc', LABELS[t.color]);
    const th = !t.text ? cardThumb(t, 150, 30) : '';
    d.innerHTML = `<span class="pc-ic">📋</span>${t.text ? `<span class="pc-t">${esc(t.text)}</span>` : th ? `<img src="${th}" alt="">` : `<span class="pc-t">${esc(cardFallback(t, cn, cn.pages.findIndex(q => q.tasks.includes(t))))}</span>`}`;
    d.title = 'Open the card on its board';
    d.addEventListener('pointerdown', e => e.stopPropagation());
    d.onclick = e => { e.stopPropagation(); jumpTo(cn.id, t.id); };
    rec.ov.append(d);
  }
}
function refreshPlanChips() { const n = curNote(); if (n) n.pages.forEach((pg, i) => { if (pg.bg && pg.bg.name === 'planner') renderPlanChips(i); }); }
const _v7OverlayHook = v7OverlayHook;
v7OverlayHook = function (pi) { _v7OverlayHook(pi); renderPlanChips(pi); };

/* ---------- lasso handwriting → a new card (drag onto a board page, or 📋 Send to board) ---------- */
// Called by the lasso carry machine while a selection hovers a board page.
function boardCarryTarget(c, pi, els) {
  const P = c.payload, ids = P.G ? P.G.strokes : [];
  document.querySelectorAll('.bcol.bdrop-ink').forEach(e => e.classList.remove('bdrop-ink'));
  if (!ids || !ids.length) return null;
  const col = els.find(e => e.classList && e.classList.contains('bcol')); if (!col) return null;
  col.classList.add('bdrop-ink');
  return { type: 'board', pi, col: col.dataset.col };
}
function clearBoardCarry() { document.querySelectorAll('.bcol.bdrop-ink').forEach(e => e.classList.remove('bdrop-ink')); }
function cardFromInk(src, dstNote, dstPi, colId, fromCarry) {
  const sn = src.note, spg = sn.pages[src.pi], ids = src.ids;
  const strokes = spg.strokes.filter(s => ids.includes(s.id));
  if (!strokes.length) { toast('Select some handwriting first'); return null; }
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) { const b = s.bb || bbox(s.points); bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])]; }
  const bw = Math.max(4, bb[2] - bb[0]), bh = Math.max(4, bb[3] - bb[1]), TW = 210, sc = Math.min(1.6, (TW - 12) / bw, (TITLE_H - 12) / bh);
  const ox = 6, oy = (TITLE_H - bh * sc) / 2;
  const tstrokes = strokes.map(st => { const pts = st.points.map(p => [+(ox + (p[0] - bb[0]) * sc).toFixed(1), +(oy + (p[1] - bb[1]) * sc).toFixed(1), p[2]]); return { id: uid('s'), tool: st.tool, color: st.color, width: +Math.max(0.8, st.width * Math.max(sc, 0.45)).toFixed(2), points: pts, bb: bbox(pts) }; });
  const dpg = bP(dstNote, dstPi); if (!isBoardPage(dpg)) return null;
  if (dstPi === QPI) bH(QPI); else if (dstNote.id === S.cur) pushHistory(); else pushHistoryMulti([dstNote.id]);
  const cols = boardCols(dpg), col = cols.find(c => c.id === colId) || cols[0];
  const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1, text: '', tstrokes, strokes: [], done: isDoneCol(dpg, col.id), due: null, repeat: '', notified: false, createdAt: Date.now() };
  if (t.done) t.doneAt = Date.now();
  dpg.tasks.push(t); renumber(dpg, col.id);
  saveNote(dstNote, true); if (dstNote !== sn) saveNote(sn, true);
  hideLasso(); thumbCache.clear();
  if (dstPi === QPI || dstNote.id === S.cur) { afterChange(dstPi); const w = cardWrap(dstPi, t.id); if (w) { w.classList.add('appear', 'flash'); setTimeout(() => w.classList.remove('appear', 'flash'), 1600); } }
  else { renderSidebar(); renderPanel(); }
  const srcNoteId = sn.id, srcPageId = spg.id, keepIds = ids.slice();
  actionToast(`📋 Card added to “${col.title}”${dstPi === QPI ? ' on the Quote Board' : dstNote.id !== S.cur ? ' in ' + dstNote.title : ''} · original ink kept`, 'Remove original', () => {
    const n2 = S.notes.find(x => x.id === srcNoteId), p2 = n2 && n2.pages.find(q => q.id === srcPageId); if (!p2 || n2.id !== S.cur) return;
    pushHistory(); p2.strokes = p2.strokes.filter(s => !keepIds.includes(s.id)); p2.labels = (p2.labels || []).filter(l => !l.strokeIds.every(id => keepIds.includes(id)));
    saveNote(n2, true); const i = n2.pages.indexOf(p2); renderPageInk(i); renderOverlay(i); toast('Original ink removed', 1400);
  }, 8000);
  return t;
}
async function sendInkToBoardPicker(src) {
  const list = [];
  for (const n of S.notes) if (n.id !== QUOTE_ID) n.pages.forEach((pg, i) => { if (isBoardPage(pg)) list.push({ n, i }); });
  const items = list.map(x => ({ label: '📋 ' + x.n.title, sub: `${x.n.id === S.cur ? 'This note · ' : ''}page ${x.i + 1} · ${boardCols(x.n.pages[x.i]).map(c => c.title).join(' · ')}`, value: x }));
  items.push({ label: '＋ New Project Board page', sub: `Adds a board page to “${curNote().title}”`, value: 'new' });
  const ch = await pickSheet('Send handwriting to which board?', items); if (!ch) { if (selection) $('#lassoMenu').hidden = false; return; }
  let dst = ch;
  if (ch === 'new') { const n = curNote(); pushHistory(); n.pages.push(makeTemplatePage('board', n)); saveNote(n, true); buildPages(); dst = { n, i: n.pages.length - 1 }; }
  const cols = boardCols(dst.n.pages[dst.i]);
  const col = await pickSheet('Which column?', cols.map(c => ({ label: c.title, sub: colCards(dst.n.pages[dst.i], c.id).length + ' cards', value: c.id }))); if (!col) return;
  const t = cardFromInk(src, dst.n, dst.i, col);
  if (t && dst.n.id === S.cur) boardFlash(dst.i, t.id);
}
$('#lassoBoard').onclick = () => { const s = selection; if (!s) return; if (!s.ids.length) { toast('Select some handwriting first'); return; } $('#lassoMenu').hidden = true; sendInkToBoardPicker({ note: curNote(), pi: s.pi, ids: s.ids.slice() }); };

/* v19: which columns count as done; move a card between two boards (Quote Board drawer ↔ a board page) */
function toggleDoneCol(pi, colId) {
  const n = bN(pi), pg = bP(n, pi), cur = doneCols(pg); bH(pi);
  let next = cur.includes(colId) ? cur.filter(x => x !== colId) : [...cur, colId];
  if (!next.length) { toast('At least one column counts as done'); next = cur; }
  pg.board.doneCols = next;
  for (const t of pg.tasks) if (isCard(t)) { const d = isDoneCol(pg, t.col); if (d !== !!t.done) { t.done = d; t.doneAt = d ? Date.now() : null; } }
  saveNote(n, true); afterChange(pi);
}
function moveCardAcross(fromPi, id, toPi, colId) {
  const sn = bN(fromPi), spg = bP(sn, fromPi), dn = bN(toPi), dpg = bP(dn, toPi), t = findCard(fromPi, id);
  if (!t || !isBoardPage(dpg)) return;
  bH(fromPi); if (dn !== sn || toPi !== fromPi) bH(toPi);
  spg.tasks = spg.tasks.filter(x => x !== t); renumber(spg, t.col);
  t.col = colId; t.ord = -1; const d = isDoneCol(dpg, colId); if (d !== !!t.done) { t.done = d; t.doneAt = d ? Date.now() : null; }
  dpg.tasks.push(t); renumber(dpg, colId);
  saveNote(sn, true); if (dn !== sn) saveNote(dn, true);
  renderBoard(fromPi); renderBoard(toPi); renderSidebar(); renderPanel();
  const col = boardCols(dpg).find(c => c.id === colId);
  actionToast(`📋 Moved to “${col ? col.title : 'board'}”${toPi === QPI ? ' on the Quote Board' : ' in ' + dn.title}`, 'Undo', () => { if (toPi === QPI || fromPi === QPI) { bUndo(QPI); } if (toPi !== QPI || fromPi !== QPI) restore(S.undo, S.redo); renderBoard(fromPi); renderBoard(toPi); }, 7000);
  const w = cardWrap(toPi, t.id); if (w) { w.classList.add('appear', 'flash'); setTimeout(() => w.classList.remove('appear', 'flash'), 1600); }
}
