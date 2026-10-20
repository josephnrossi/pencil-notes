'use strict';
/* Pencil Notes v11: Project Board template — Clear-style columns & cards.
   A board is a page with bg.name === 'board' and pg.board.columns = [{id, title}].
   Cards are ordinary tasks on that page (kind 'card', t.col = column id, t.ord = position, t.strokes = card ink),
   so reminders, Today, 📅 Add to Calendar, search, Export/Import and undo (pushHistory) all work unchanged.
   Gestures (Apple Pencil, finger and mouse alike): press & hold to lift a card or a column header,
   swipe a card right = done (moves to the last column), left = delete (Undo), pull down a column = new card. */
const INK_W = 300, INK_H = 240, TITLE_H = 58, H_MIN = 90, H_MAX = 760, B_LIFT = 420, B_SLOP = 8, CW_MIN = 0.75, CW_MAX = 3;
/* v12: t.h = body ink height (ink units; 300 units = card width), t.tstrokes = handwritten title, t.typed = typed title on;
   column.w = width factor (1 = a third of the board). */
const cardH = t => Math.max(H_MIN, Math.min(H_MAX, +t.h || INK_H));
const isTyped = t => t.typed ?? !!t.text;
const inkKey = which => which === 'title' ? 'tstrokes' : 'strokes';
const strokesBottom = st => (st || []).reduce((m, s) => Math.max(m, (s.bb || bbox(s.points))[3] + s.width), 0);
function cardFallback(o, note, pi) {
  const pg = note && note.pages[pi], c = pg && pg.board && pg.board.columns.find(x => x.id === o.col);
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
const boardBusy = () => BS.editing || !!(BS.g && (BS.g.mode !== 'pending' || BS.g.ink));
function buzz() { try { navigator.vibrate && navigator.vibrate(8); } catch (_) {} }
function suppressClicks() { BS.suppress = true; clearTimeout(suppressClicks.t); suppressClicks.t = setTimeout(() => BS.suppress = false, 400); }
const cardWrap = (pi, id) => pageEls[pi] && pageEls[pi].el.querySelector(`.bcard-wrap[data-id="${id}"]`);
const findCard = (pi, id) => { const n = curNote(), pg = n && n.pages[pi]; return pg ? pg.tasks.find(t => t.id === id) : null; };

/* ---------- render ---------- */
function cardHTML(t, now) {
  const od = t.due && !t.done && new Date(t.due) < now;
  return `<div class="bcard-wrap" data-id="${t.id}"><div class="bsw bsw-done">✓ Done</div><div class="bsw bsw-del">Delete 🗑</div>
    <div class="bcard ${t.done ? 'done' : ''} ${od ? 'overdue' : ''}" data-id="${t.id}">
      <div class="bc-grip" aria-label="Hold to drag · swipe to finish or delete">⠿</div>
      <div class="bc-main"><div class="bc-top">${isTyped(t) ? `<span class="bc-title ${t.text ? '' : 'ph'}" data-bact="title">${t.text ? esc(t.text) : 'Title'}</span>` : `<canvas class="bc-tink" data-ink="title" aria-label="Write the title"></canvas>`}
      <button class="bc-kb ${isTyped(t) ? 'on' : ''}" data-bact="kb" aria-label="${isTyped(t) ? 'Handwrite the title' : 'Type the title'}">${isTyped(t) ? '✍︎' : '⌨︎'}</button>
      ${t.due ? '' : `<button class="bc-due none" data-bact="due" aria-label="Reminder">⏰</button>`}</div>
      ${t.due ? `<div class="bc-meta"><button class="bc-due ${od ? 'overdue' : ''}" data-bact="due" aria-label="Reminder">⏰ ${esc(fmtDue(t.due)) + (t.repeat ? ' ↻' : '')}</button></div>` : ''}
      <canvas class="bc-ink" data-ink="body" aria-label="Write here"></canvas></div>
      <div class="bc-resize" aria-label="Drag to resize the card"></div></div></div>`;
}
function colStyle(w) { w = Math.max(CW_MIN, Math.min(CW_MAX, +w || 1)); return w === 1 ? '' : `flex-basis: calc((100% - 24px) / 3 * ${w}); min-width: ${Math.round(228 * w)}px`; }
function layoutCard(w, t) {
  const body = w.querySelector('.bc-ink'), k = (body.clientWidth || 200) / INK_W;
  body.style.height = Math.round(cardH(t) * k) + 'px';
  const ti = w.querySelector('.bc-tink'); if (ti) ti.style.height = Math.round(TITLE_H * k) + 'px';
  drawInk(body, t.strokes, k); if (ti) drawInk(ti, t.tstrokes, k);
}
function renderBoard(pi) {
  const note = curNote(), pg = note && note.pages[pi], rec = pageEls[pi]; if (!rec || !isBoardPage(pg)) return;
  if (boardBusy()) { BS.dirty = true; return; }
  rec.el.classList.add('board-page');
  let b = rec.el.querySelector('.board');
  const keep = b ? { left: b.querySelector('.bcols').scrollLeft, tops: Object.fromEntries([...b.querySelectorAll('.bcol')].map(c => [c.dataset.col, c.querySelector('.blist').scrollTop])) } : BS.keep[pg.id];
  if (!b) { b = document.createElement('div'); b.className = 'board'; rec.el.append(b); }
  const cols = boardCols(pg), ids = new Set(cols.map(c => c.id));
  for (const t of pg.tasks) if (isCard(t) && !ids.has(t.col)) t.col = cols[0].id;   // orphans land in the first column
  const now = Date.now(), cards = pg.tasks.filter(isCard), open = cards.filter(t => !t.done).length;
  b.innerHTML = `<div class="bhead"><span class="btitle">📋 Project Board</span><span class="bsum">${open} open · ${cards.length - open} done</span><div class="spacer"></div>
    <button class="bbtn" data-bact="addcol">＋ Column</button></div>
    <div class="bcols">${cols.map((c, ci) => { const cc = colCards(pg, c.id); return `<section class="bcol ${ci === cols.length - 1 && cols.length > 1 ? 'is-last' : ''}" data-col="${c.id}" style="${colStyle(c.w)}"><div class="bcol-resize" aria-label="Drag to widen the column"><i></i></div>
      <header class="bcol-head"><span class="bcol-title" data-bact="rename">${esc(c.title || 'Untitled')}</span><span class="bcount">${cc.length}</span>
      <button class="bbtn icon" data-bact="add" aria-label="Add card">＋</button><button class="bbtn icon" data-bact="colmenu" aria-label="Column options">⋯</button></header>
      <div class="blist"><div class="bpull"><span>↓ Pull to add a card</span></div>${cc.map(t => cardHTML(t, now)).join('')}<div class="bempty">${cc.length ? '' : 'Pull down or tap ＋ to add a card'}</div></div></section>`; }).join('')}</div>`;
  b.querySelectorAll('.bcard-wrap').forEach(w => { const t = pg.tasks.find(x => x.id === w.dataset.id); if (t) layoutCard(w, t); });
  if (keep) { b.querySelector('.bcols').scrollLeft = keep.left || 0; b.querySelectorAll('.bcol').forEach(c => { const v = keep.tops && keep.tops[c.dataset.col]; if (v) c.querySelector('.blist').scrollTop = v; }); }
  BS.keep[pg.id] = null;
}
function rerenderBoards() { BS.dirty = false; const n = curNote(); if (!n) return; n.pages.forEach((pg, i) => { if (isBoardPage(pg)) renderBoard(i); }); }
function afterChange(pi) { renderBoard(pi); renderSidebar(); renderPanel(); }

/* ---------- card ink (re-uses the page ink engine: drawStroke / drawPenSeg, pressure, colours, highlighter, eraser) ---------- */
// k = CSS px per ink unit (shared by a card's title and body so handwriting keeps one scale)
const pxPerUnit = cv => { const card = cv.closest('.bcard'), body = card && card.querySelector('.bc-ink'); return ((body || cv).getBoundingClientRect().width || 200) / INK_W; };
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
function inkPt(cv, e, k = pxPerUnit(cv)) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]; }
function startInk(g, cv, e) {
  const t = findCard(g.pi, g.wrap.dataset.id); if (!t) return;
  const k = pxPerUnit(cv), p = inkPt(cv, e, k), pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
  const tool = S.tool === 'eraser' ? 'eraser' : S.tool === 'highlighter' ? 'highlighter' : 'pen';
  g.ink = { cv, id: t.id, tool, k, key: inkKey(cv.dataset.ink) };
  if (tool === 'eraser') { g.ink.snap = snapshot(); g.ink.erased = false; inkErase(g, p); return; }
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
    if (I.tool === 'highlighter') { const t = findCard(g.pi, I.id); drawInk(I.cv, t[I.key], I.k); c.setTransform(I.kk, 0, 0, I.kk, 0, 0); drawStroke(c, I.stroke); }
    else { c.save(); c.lineCap = 'round'; c.strokeStyle = inkColor(I.stroke.color); drawPenSeg(c, I.stroke, pts.length - 1); c.restore(); }
  }
}
function inkErase(g, p) {
  const t = findCard(g.pi, g.ink.id), key = g.ink.key; if (!t || !t[key]) return;
  const R = 9, before = t[key].length;
  t[key] = t[key].filter(st => {
    const pts = st.points, lim = R + st.width / 2;
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > lim;
    for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= lim) return false;
    return true;
  });
  if (t[key].length !== before) { g.ink.erased = true; drawInk(g.ink.cv, t[key], g.ink.k); }
}
function inkEnd(g, discard) {
  const I = g.ink; g.ink = null; if (!I) return;
  const n = curNote(), t = findCard(g.pi, I.id); if (!t) return;
  if (I.tool === 'eraser') { if (I.erased) { S.undo.push(I.snap); S.redo = []; updateUndo(); saveNote(n, true); thumbCache.clear(); renderPanel(); } return; }
  if (discard) { drawInk(I.cv, t[I.key], I.k); return; }
  I.stroke.bb = bbox(I.stroke.points);
  pushHistory(); (t[I.key] ||= []).push(I.stroke); saveNote(n, true); thumbCache.clear();
  drawInk(I.cv, t[I.key], I.k); renderPanel(); renderSidebar();
}

/* ---------- gestures ---------- */
const PAGES = $('#pages');
PAGES.addEventListener('pointerdown', e => {
  const board = e.target.closest('.board'); if (!board) return;
  if ((e.pointerType === 'mouse' && e.button !== 0) || BS.g || BS.editing && e.target.closest('input')) return;
  if (e.target.closest('input')) return;
  const pi = +board.closest('.page').dataset.pi;
  if (e.pointerType === 'pen') notePen();
  const head = e.target.closest('.bcol-head'), wrap = e.target.closest('.bcard-wrap'), list = e.target.closest('.blist'), col = e.target.closest('.bcol'), btn = e.target.closest('button');
  const g = { pi, pid: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: 'pending', board, col, list, wrap };
  const rz = e.target.closest('.bc-resize'), crz = e.target.closest('.bcol-resize');
  if (rz && wrap) { e.preventDefault(); BS.g = g; resizeStart(g); return; }
  if (crz && col) { e.preventDefault(); BS.g = g; colResizeStart(g); return; }
  if (head && !btn) g.kind = 'colhold';
  else if (wrap && !btn) {
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
  if (g.kind === 'card') liftStart(g); else if (g.kind === 'colhold') colLiftStart(g);
}
window.addEventListener('pointermove', e => {
  const g = BS.g; if (!g || e.pointerId !== g.pid) return;
  g.x = e.clientX; g.y = e.clientY;
  const dx = g.x - g.x0, dy = g.y - g.y0;
  if (g.mode === 'pending') {
    if (g.ink) { if (Math.hypot(dx, dy) > B_SLOP) { clearTimeout(g.timer); g.mode = 'ink'; } inkMove(g, e); return; }
    if (Math.hypot(dx, dy) <= B_SLOP) return;
    clearTimeout(g.timer);
    if (g.kind === 'card' && Math.abs(dx) > Math.abs(dy) * 1.2) swipeStart(g);
    else if (g.canPull && dy > 0 && dy > Math.abs(dx) * 1.2) pullStart(g);
    else { BS.g = null; return; }      // it's a scroll
  }
  if (g.mode === 'ink') inkMove(g, e);
  else if (g.mode === 'swipe') swipeMove(g);
  else if (g.mode === 'pull') pullMove(g);
  else if (g.mode === 'resize') resizeMove(g);
  else if (g.mode === 'colresize') colResizeMove(g);
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
PAGES.addEventListener('contextmenu', e => { if (e.target.closest('.board')) e.preventDefault(); });
PAGES.addEventListener('click', e => { if (BS.suppress && e.target.closest('.board')) { e.stopPropagation(); e.preventDefault(); } }, true);

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
  const n = curNote(), pg = n.pages[pi], t = findCard(pi, id); if (!t) return;
  const cols = boardCols(pg), last = lastColId(pg);
  pushHistory();
  let msg = '';
  if (t.repeat && t.due && !t.done) { let d = t.due; do d = advance(d, t.repeat); while (new Date(d) < Date.now()); t.due = d; t.notified = false; msg = 'Done — next: ' + fmtDue(d); }
  else if (t.col === last && cols.length > 1 || (cols.length === 1 && t.done)) {
    t.done = false; t.doneAt = null; const from = t.col; t.col = cols[0].id; t.ord = -1; renumber(pg, t.col); if (from !== t.col) renumber(pg, from); msg = 'Reopened → ' + (cols[0].title || 'first column');
  } else {
    const from = t.col; t.done = true; t.doneAt = Date.now(); t.col = last; t.ord = -1; renumber(pg, last); if (from !== last) renumber(pg, from); msg = '✓ Done';
  }
  saveNote(n, true); afterChange(pi);
  const w = cardWrap(pi, id); if (w) { w.classList.add('flash-done'); w.scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => w.classList.remove('flash-done'), 700); }
  toast(msg, 1600);
}
function deleteCard(pi, id) {
  const n = curNote(), pg = n.pages[pi], t = findCard(pi, id); if (!t) return;
  pushHistory(); pg.tasks = pg.tasks.filter(x => x !== t); renumber(pg, t.col); saveNote(n, true); afterChange(pi);
  undoToast('Deleted “' + (t.text || ((t.strokes || []).length || (t.tstrokes || []).length ? 'handwritten card' : 'card')) + '”');
}
function undoToast(msg) {
  let u = document.getElementById('undoToast');
  if (!u) { u = document.createElement('div'); u.id = 'undoToast'; u.innerHTML = '<span></span><button>Undo</button>'; document.body.append(u);
    u.querySelector('button').onclick = () => { u.hidden = true; restore(S.undo, S.redo); toast('Undone', 1200); }; }
  u.querySelector('span').textContent = msg; u.hidden = false; u.classList.remove('pop'); void u.offsetWidth; u.classList.add('pop');
  clearTimeout(undoToast.t); undoToast.t = setTimeout(() => u.hidden = true, 5000);
}

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

/* press & hold: lift a card; others slide apart live; drop in any column at any position */
function liftStart(g) {
  g.mode = 'lift'; buzz();
  const wrap = g.wrap, card = wrap.querySelector('.bcard'), r = card.getBoundingClientRect();
  const ghost = card.cloneNode(true); ghost.classList.add('bghost'); ghost.removeAttribute('data-id');
  const srcs = card.querySelectorAll('canvas'), dsts = ghost.querySelectorAll('canvas');
  srcs.forEach((src, i) => { const dst = dsts[i]; if (dst && src.width) { dst.width = src.width; dst.height = src.height; dst.getContext('2d').drawImage(src, 0, 0); } });
  ghost.style.setProperty('--cc', getComputedStyle(card).getPropertyValue('--cc'));
  Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  document.body.append(ghost); void ghost.offsetWidth; ghost.classList.add('up');
  g.ghost = ghost; g.r0 = r; g.grab = [g.x0 - r.left, g.y0 - r.top];
  const cs = getComputedStyle(wrap); g.H = wrap.offsetHeight + parseFloat(cs.marginBottom || 0);
  wrap.classList.add('bplaceholder'); g.board.classList.add('bdragging'); document.body.classList.add('bcarrying');
  g.cols = [...g.board.querySelectorAll('.bcol')].map(c => ({ id: c.dataset.col, el: c, list: c.querySelector('.blist'), wraps: [...c.querySelectorAll('.bcard-wrap')], count: c.querySelector('.bcount'), n: c.querySelectorAll('.bcard-wrap').length }));
  g.src = g.cols.find(c => c.el === g.col); g.srcIdx = g.src.wraps.indexOf(wrap); g.tgt = null; g.k = -1;
  for (const c of g.cols) for (const w of c.wraps) if (w !== wrap) w.classList.add('bshift');
  const loop = () => { if (g.mode !== 'lift') return; liftFrame(g); g.raf = requestAnimationFrame(loop); };
  loop();
}
function autoScrollBoard(g, vertical) {
  const bc = g.board.querySelector('.bcols'), r = bc.getBoundingClientRect(), E = 60;
  if (g.x < r.left + E) bc.scrollLeft -= Math.ceil((r.left + E - g.x) / 4);
  else if (g.x > r.right - E) bc.scrollLeft += Math.ceil((g.x - r.right + E) / 4);
  const L = vertical && vertical.list; if (!L) return;
  const lr = L.getBoundingClientRect();
  if (g.y < lr.top + 36) L.scrollTop -= Math.ceil((lr.top + 36 - g.y) / 4);
  else if (g.y > lr.bottom - 36) L.scrollTop += Math.ceil((g.y - lr.bottom + 36) / 4);
}
function liftFrame(g) {
  autoScrollBoard(g, g.tgt);
  const gx = g.x - g.grab[0], gy = g.y - g.grab[1];
  g.ghost.style.transform = `translate(${gx - g.r0.left}px, ${gy - g.r0.top}px) scale(1.05) rotate(-1.2deg)`;
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
  document.body.classList.remove('bcarrying');
  const n = curNote(), pg = n.pages[g.pi], id = g.wrap.dataset.id, t = findCard(g.pi, id);
  let flash = '';
  if (!cancel && t && g.tgt) {
    const from = t.col, others = colCards(pg, g.tgt.id).filter(x => x !== t), oldIdx = colCards(pg, from).indexOf(t);
    if (g.tgt.id !== from || oldIdx !== g.k) {
      pushHistory();
      others.splice(g.k, 0, t); t.col = g.tgt.id; others.forEach((x, i) => x.ord = i); if (from !== t.col) renumber(pg, from);
      const cols = boardCols(pg), last = lastColId(pg);
      if (cols.length > 1 && t.col === last && !t.done) { t.done = true; t.doneAt = Date.now(); flash = 'flash-done'; }
      else if (cols.length > 1 && from === last && t.col !== last && t.done) { t.done = false; t.doneAt = null; }
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
  const n = curNote(), pg = n.pages[g.pi], cols = boardCols(pg), id = g.col.dataset.col;
  if (!cancel && g.newIdx !== g.idx) { pushHistory(); const i = cols.findIndex(c => c.id === id), [c] = cols.splice(i, 1); cols.splice(g.newIdx, 0, c); saveNote(n, true); }
  renderBoard(g.pi);
  const el = pageEls[g.pi].el.querySelector(`.bcol[data-col="${id}"]`); if (el) { el.classList.add('settle'); setTimeout(() => el.classList.remove('settle'), 500); }
}

/* ---------- taps: add / rename / menus / reminder ---------- */
PAGES.addEventListener('click', e => {
  const a = e.target.closest('[data-bact]'); if (!a || !e.target.closest('.board')) return;
  const pi = +a.closest('.page').dataset.pi, colEl = a.closest('.bcol'), wrap = a.closest('.bcard-wrap'), act = a.dataset.bact;
  if (act === 'addcol') addColumn(pi);
  else if (act === 'add') addCard(pi, colEl.dataset.col);
  else if (act === 'colmenu') colMenu(pi, colEl.dataset.col);
  else if (act === 'rename') renameColumn(pi, colEl.dataset.col);
  else if (act === 'title') editCardTitle(pi, wrap.dataset.id);
  else if (act === 'kb') toggleTyped(pi, wrap.dataset.id);
  else if (act === 'due') { const t = findCard(pi, wrap.dataset.id); if (t) openEditor({ type: 'task', note: curNote(), obj: t, page: pi }); }
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
    if (t && v !== null && v !== (t.text || '')) { pushHistory(); t.text = v; saveNote(curNote(), true); }
    afterChange(pi);
  });
}
function renameColumn(pi, colId, isNew) {
  const el = pageEls[pi].el.querySelector(`.bcol[data-col="${colId}"] .bcol-title`); if (!el) return;
  const c0 = boardCols(curNote().pages[pi]).find(c => c.id === colId);
  inlineEdit(el, c0.title || '', 'Column name', v => {
    const c = boardCols(curNote().pages[pi]).find(x => x.id === colId);
    if (c && v && v !== c.title) { if (!isNew) pushHistory(); c.title = v; saveNote(curNote(), true); }
    renderBoard(pi);
  });
}
function toggleTyped(pi, id) {
  const t = findCard(pi, id); if (!t) return;
  pushHistory(); const on = !isTyped(t); t.typed = on; saveNote(curNote(), true); afterChange(pi);
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
  if (!cancel && t && Math.abs(g.h - g.h0) >= 2) { pushHistory(); t.h = g.h; saveNote(curNote(), true); }
  renderBoard(g.pi);
}
/* widen / narrow a column (handle on its right edge, or ⋯ → Column width) */
function colResizeStart(g) {
  g.mode = 'colresize'; g.cid = g.col.dataset.col; g.w0px = g.col.getBoundingClientRect().width;
  const c = boardCols(curNote().pages[g.pi]).find(x => x.id === g.cid); g.f0 = +c.w || 1; g.f = g.f0;
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
  const n = curNote(), c = boardCols(n.pages[pi]).find(x => x.id === colId); if (!c) return;
  pushHistory(); c.w = Math.max(CW_MIN, Math.min(CW_MAX, f)); if (Math.abs(c.w - 1) < 0.03) delete c.w; saveNote(n, true); renderBoard(pi);
}
function addCard(pi, colId, edit = false) {
  const n = curNote(), pg = n.pages[pi], cols = boardCols(pg);
  pushHistory();
  const t = { id: uid('t'), kind: 'card', col: colId, ord: -1, text: '', strokes: [], done: cols.length > 1 && colId === lastColId(pg), due: null, repeat: '', notified: false, createdAt: Date.now() };
  if (t.done) t.doneAt = Date.now();
  pg.tasks.push(t); renumber(pg, colId); saveNote(n, true);
  const colEl = pageEls[pi].el.querySelector(`.bcol[data-col="${colId}"] .blist`); if (colEl) colEl.scrollTop = 0;
  afterChange(pi);
  const w = cardWrap(pi, t.id);
  if (w) { w.classList.add('appear'); w.closest('.bcol').scrollIntoView({ block: 'nearest', inline: 'nearest' }); setTimeout(() => w.classList.remove('appear'), 500); }
  if (edit) editCardTitle(pi, t.id);
  return t;
}
function addColumn(pi) {
  const n = curNote(), pg = n.pages[pi], cols = boardCols(pg);
  pushHistory();
  const c = { id: uid('c'), title: 'New column' };
  const lastIsDone = cols.length > 1 && /done|finished|complete/i.test(cols[cols.length - 1].title || '');
  cols.splice(lastIsDone ? cols.length - 1 : cols.length, 0, c);
  saveNote(n, true); renderBoard(pi);
  const el = pageEls[pi].el.querySelector(`.bcol[data-col="${c.id}"]`);
  if (el) { el.classList.add('appear'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  renameColumn(pi, c.id, true);
}
function moveColumn(pi, colId, d) {
  const n = curNote(), cols = boardCols(n.pages[pi]), i = cols.findIndex(c => c.id === colId), j = i + d;
  if (j < 0 || j >= cols.length) return;
  pushHistory(); const [c] = cols.splice(i, 1); cols.splice(j, 0, c); saveNote(n, true); renderBoard(pi);
}
function deleteColumn(pi, colId) {
  const n = curNote(), pg = n.pages[pi], cols = boardCols(pg);
  if (cols.length < 2) { toast('A board needs at least one column'); return; }
  const i = cols.findIndex(c => c.id === colId); if (i < 0) return;
  pushHistory();
  const moving = colCards(pg, colId), wasLast = i === cols.length - 1;
  cols.splice(i, 1);
  const dest = cols[0], base = colCards(pg, dest.id).length;
  moving.forEach((t, k) => { t.col = dest.id; t.ord = base + k; if (wasLast && t.done && cols.length > 1) { t.done = false; t.doneAt = null; } });
  saveNote(n, true); afterChange(pi);
  undoToast(moving.length ? `Column deleted — ${moving.length} card${moving.length > 1 ? 's' : ''} moved to “${dest.title}”` : 'Column deleted');
}
function colMenu(pi, colId) {
  const pg = curNote().pages[pi], cols = boardCols(pg), i = cols.findIndex(c => c.id === colId), c = cols[i], cnt = colCards(pg, colId).length;
  const dest = cols.find(x => x.id !== colId);
  actionSheet(c.title || 'Column', [
    { label: '✏️ Rename column', fn: () => renameColumn(pi, colId) },
    { label: '＋ Add card', fn: () => addCard(pi, colId) },
    { label: '↔︎ Column width…', fn: () => setTimeout(() => { const w = +c.w || 1, m = v => Math.abs(w - v) < 0.05 ? '✓ ' : ''; actionSheet('Width of “' + c.title + '”', [
      { label: m(0.75) + 'Narrow', fn: () => setColWidth(pi, colId, 0.75) }, { label: m(1) + 'Normal (3 across)', fn: () => setColWidth(pi, colId, 1) },
      { label: m(1.5) + 'Wide', fn: () => setColWidth(pi, colId, 1.5) }, { label: m(2) + 'Extra wide', fn: () => setColWidth(pi, colId, 2) }]); }, 0) },
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
  const cols = boardCols(pg), last = lastColId(pg); if (cols.length < 2) return;
  const from = o.col;
  if (o.done && o.col !== last) { o.col = last; o.ord = -1; renumber(pg, last); renumber(pg, from); }
  else if (!o.done && o.col === last) { o.col = cols[0].id; o.ord = -1; renumber(pg, o.col); renumber(pg, from); }
  else return;
  saveNote(it.note, true); if (it.note.id === S.cur) renderBoard(it.page);
};
function boardFlash(pi, id) {
  const rec = pageEls[pi], w = $('#pages'); if (!rec) return;
  w.scrollTo({ top: rec.el.offsetTop, behavior: 'smooth' });
  requestAnimationFrame(() => { const el = cardWrap(pi, id); if (!el) return; el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
}
function drawBoardExport(ctx, pg) {
  const c = tcol(), cols = boardCols(pg), n = cols.length, pad = 36, gap = 18, W = (PAGE_W - pad * 2 - gap * (n - 1)) / n;
  ctx.save(); ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.accent; ctx.font = `700 38px ${FONT}`; ctx.fillText('Project Board', pad, 78);
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
