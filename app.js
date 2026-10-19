'use strict';
/* Pencil Notes — handwritten notes with tasks & reminders anchored on the page. */
const PAGE_W = 1000, PAGE_H = 1430; // ≈ iPad portrait screen aspect (820×1180, 834×1194)
const INK = 'ink';
const PEN_COLORS = [INK, '#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c'];
const HL_COLORS = ['#ffd60a', '#4ade80', '#f472b6', '#60a5fa'];
const PEN_WIDTHS = [1.6, 3, 5, 8];
const HL_WIDTHS = [14, 22, 32];
const $ = s => document.querySelector(s);
const drawerMQ = matchMedia('(max-width: 1100px), (orientation: portrait)');
const isDrawer = () => drawerMQ.matches; // portrait iPad & phones: sidebar/panel are overlay drawers, page is edge-to-edge
const uid = p => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sysDarkMQ = matchMedia('(prefers-color-scheme: dark)');
const themePref = () => { const t = localStorage.getItem('theme'); return ['light', 'dark', 'system'].includes(t) ? t : 'dark'; };
const isDark = () => { const p = themePref(); return p === 'system' ? sysDarkMQ.matches : p === 'dark'; };
function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#111114' : '#f4f4f7';
}
applyTheme();
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const S = {
  notebooks: [], notes: [], cur: null,
  tool: localStorage.getItem('tool') || 'pen',
  penColor: localStorage.getItem('penColor') || INK,
  hlColor: localStorage.getItem('hlColor') || HL_COLORS[0],
  penWidth: +localStorage.getItem('penWidth') || PEN_WIDTHS[1],
  hlWidth: +localStorage.getItem('hlWidth') || HL_WIDTHS[1],
  filter: 'due', search: '', collapsed: new Set(JSON.parse(localStorage.getItem('collapsed') || '[]')),
  undo: [], redo: [], scale: 1, pageW: 0,
};
const penSeen = () => localStorage.getItem('penSeen') === '1';
function fingerDrawOn() {
  const v = localStorage.getItem('fingerDraw');
  return v === null ? !penSeen() : v === '1';
}

/* ---------- persistence ---------- */
const saveTimers = new Map();
function saveNote(note, immediate) {
  note.updatedAt = Date.now();
  clearTimeout(saveTimers.get(note.id));
  const run = () => { saveTimers.delete(note.id); DB.put('notes', note).catch(err => toast('Save failed: ' + err.message)); };
  if (immediate) run(); else saveTimers.set(note.id, setTimeout(run, 250));
}
function flushSaves() { for (const [id, t] of saveTimers) { clearTimeout(t); const n = S.notes.find(x => x.id === id); if (n) DB.put('notes', n); } saveTimers.clear(); }
const saveNotebook = nb => DB.put('notebooks', nb);

function newPage() { return { id: uid('p'), strokes: [], texts: [], tasks: [] }; }
function makeNote(notebookId, title) {
  return { id: uid('n'), notebookId, title: title || 'Untitled note', paper: 'lined', pages: [newPage()], reminders: [], createdAt: Date.now(), updatedAt: Date.now() };
}

async function load() {
  S.notebooks = await DB.all('notebooks');
  S.notes = await DB.all('notes');
  if (!S.notebooks.length) {
    const firstLaunch = !S.notes.length && !localStorage.getItem('seeded');
    if (firstLaunch) {
      const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
      const seeds = [['Work', 'Work — start here', 'Prep notes for Monday standup'], ['Personal', 'Personal — start here', 'Call the dentist']];
      seeds.forEach(([name, title, task], i) => {
        const nb = { id: uid('b'), name, createdAt: Date.now() + i };
        const n = makeNote(nb.id, title); n.updatedAt = Date.now() - i;
        const pg = n.pages[0];
        pg.texts.push({ id: uid('x'), x: 100, y: 112, text: 'Welcome to Pencil Notes ✍️', size: 34, color: INK });
        pg.texts.push({ id: uid('x'), x: 100, y: 190, text: 'Circle handwriting with ➰ Lasso, then tap "Make task".\nTap ☑️ Task to drop a checkbox anywhere on the page.\nTasks with a time show up in 🔔 Reminders.', size: 24, color: INK });
        pg.tasks.push({ id: uid('t'), kind: 'typed', x: 100, y: 330, text: task, done: false, due: t.toISOString(), repeat: '', notified: false, createdAt: Date.now() });
        S.notebooks.push(nb); S.notes.push(n);
      });
      for (const nb of S.notebooks) await saveNotebook(nb);
      for (const n of S.notes) await DB.put('notes', n);
    } else {
      const nb = { id: uid('b'), name: 'Notes', createdAt: Date.now() };
      S.notebooks.push(nb); await saveNotebook(nb);
      for (const n of S.notes) if (!n.notebookId || !S.notebooks.find(b => b.id === n.notebookId)) { n.notebookId = nb.id; await DB.put('notes', n); }
    }
  }
  localStorage.setItem('seeded', '1');
  for (const n of S.notes) { n.reminders = n.reminders || []; for (const p of n.pages) { p.strokes ||= []; p.texts ||= []; p.tasks ||= []; } }
  if (!S.notes.length) { const n = makeNote(S.notebooks[0].id); S.notes.push(n); await DB.put('notes', n); }
}

/* ---------- utilities ---------- */
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function hint(msg) { const h = $('#toolHint'); h.textContent = msg; h.hidden = false; clearTimeout(hint._t); hint._t = setTimeout(() => h.hidden = true, 2600); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function inkColor(c) { return c === INK ? (isDark() ? '#ececf0' : '#1d1d1f') : c; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtDue(iso) {
  if (!iso) return 'No date';
  const d = new Date(iso), now = new Date();
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return 'Today ' + time;
  if (days === 1) return 'Tomorrow ' + time;
  if (days === -1) return 'Yesterday ' + time;
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }) + ', ' + time;
}
function toLocalInput(iso) { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
function advance(iso, rep) { const d = new Date(iso); if (rep === 'daily') d.setDate(d.getDate() + 1); else if (rep === 'weekly') d.setDate(d.getDate() + 7); else if (rep === 'monthly') d.setMonth(d.getMonth() + 1); return d.toISOString(); }
const curNote = () => S.notes.find(n => n.id === S.cur);

/* ---------- rendering strokes ---------- */
const pf = p => 0.35 + 1.3 * Math.max(0.05, Math.min(1, p));
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function drawPenSeg(ctx, st, i) {
  const pts = st.points, a = pts[i - 1], b = pts[i];
  const start = i === 1 ? a : mid(pts[i - 2], a), end = mid(a, b);
  ctx.lineWidth = st.width * pf((a[2] + b[2]) / 2);
  ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.quadraticCurveTo(a[0], a[1], end[0], end[1]); ctx.stroke();
}
function drawStroke(ctx, st) {
  const pts = st.points; if (!pts.length) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const col = inkColor(st.color); ctx.strokeStyle = col; ctx.fillStyle = col;
  if (st.tool === 'highlighter') {
    if (isDark()) ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = isDark() ? 0.42 : 0.38; ctx.lineWidth = st.width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
    for (let i = 1; i < pts.length; i++) { const m = mid(pts[i - 1], pts[i]); ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], m[0], m[1]); }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); ctx.stroke();
  } else if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], st.width * pf(pts[0][2]) / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    for (let i = 1; i < pts.length; i++) drawPenSeg(ctx, st, i);
    const n = pts.length, m = mid(pts[n - 2], pts[n - 1]);
    ctx.lineWidth = st.width * pf(pts[n - 1][2]); ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(pts[n - 1][0], pts[n - 1][1]); ctx.stroke();
  }
  ctx.restore();
}
function bbox(points) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of points) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; }
function drawPaper(ctx, paper) {
  const dark = isDark();
  ctx.fillStyle = dark ? '#1f1f23' : '#fffdf8'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.lineWidth = 1;
  if (paper === 'lined') {
    ctx.strokeStyle = dark ? 'rgba(140,160,255,.18)' : 'rgba(110,140,220,.28)';
    for (let y = 150; y < PAGE_H - 30; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
    ctx.strokeStyle = dark ? 'rgba(255,110,110,.25)' : 'rgba(230,80,80,.35)';
    ctx.beginPath(); ctx.moveTo(80, 0); ctx.lineTo(80, PAGE_H); ctx.stroke();
  } else if (paper === 'grid') {
    ctx.strokeStyle = dark ? 'rgba(140,160,255,.14)' : 'rgba(110,140,220,.22)';
    for (let x = 40; x < PAGE_W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); ctx.stroke(); }
    for (let y = 40; y < PAGE_H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
  }
}
function setupCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(S.pageW * dpr); cv.height = Math.round(PAGE_H * S.scale * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr * S.scale, 0, 0, dpr * S.scale, 0, 0); return ctx;
}
function renderPageInk(pi) {
  const note = curNote(), el = pageEls[pi]; if (!el) return;
  const ctx = el.ctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, el.base.width, el.base.height); ctx.restore();
  drawPaper(ctx, note.paper);
  const pg = note.pages[pi];
  for (const st of pg.strokes) if (st.tool === 'highlighter') drawStroke(ctx, st);
  for (const st of pg.strokes) if (st.tool !== 'highlighter') drawStroke(ctx, st);
}
function clearLive(el) { const c = el.lctx; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, el.live.width, el.live.height); c.restore(); }

/* ---------- pages DOM ---------- */
let pageEls = [];
function buildPages() {
  const wrap = $('#pages'), note = curNote();
  hideLasso();
  wrap.innerHTML = '';
  pageEls = [];
  if (!note) return;
  const edge = isDrawer() || $('#app').classList.contains('focus');
  S.pageW = edge ? Math.max(280, wrap.clientWidth) : Math.max(280, Math.min(980, wrap.clientWidth - 32));
  S.scale = S.pageW / PAGE_W;
  note.pages.forEach((pg, pi) => {
    const el = document.createElement('div');
    el.className = 'page'; el.dataset.pi = pi;
    el.style.width = S.pageW + 'px'; el.style.height = PAGE_H * S.scale + 'px';
    const base = document.createElement('canvas'), live = document.createElement('canvas'), ov = document.createElement('div');
    live.className = 'live'; ov.className = 'overlay';
    const foot = document.createElement('div'); foot.className = 'page-foot';
    foot.innerHTML = `<span>Page ${pi + 1} of ${note.pages.length}</span>` + (note.pages.length > 1 ? `<button data-delpage="${pi}">Delete page</button>` : '');
    el.append(base, live, ov, foot); wrap.append(el);
    const rec = { el, base, live, ov, ctx: setupCanvas(base), lctx: setupCanvas(live) };
    pageEls.push(rec);
    base.addEventListener('pointerdown', e => onDown(e, pi));
    renderPageInk(pi); renderOverlay(pi);
  });
  const add = document.createElement('button'); add.className = 'btn add-page'; add.textContent = '＋ Add page'; add.onclick = addPage; wrap.append(add);
  applyFingerMode();
}
function addPage() { const n = curNote(); pushHistory(); n.pages.push(newPage()); saveNote(n); buildPages(); const w = $('#pages'); w.scrollTo({ top: w.scrollHeight, behavior: 'smooth' }); }
$('#pages').addEventListener('click', e => {
  const b = e.target.closest('[data-delpage]'); if (!b) return;
  const n = curNote(), pi = +b.dataset.delpage;
  actionSheet('Delete page ' + (pi + 1) + '?', [{ label: 'Delete page', danger: true, fn: () => { pushHistory(); n.pages.splice(pi, 1); saveNote(n); buildPages(); renderAll(); } }]);
});

function renderOverlay(pi) {
  const note = curNote(), rec = pageEls[pi]; if (!rec) return;
  const pg = note.pages[pi], s = S.scale, ov = rec.ov;
  ov.innerHTML = '';
  for (const tb of pg.texts) {
    const d = document.createElement('div');
    d.className = 'textblock'; d.contentEditable = 'true'; d.dataset.id = tb.id; d.spellcheck = false;
    d.style.left = tb.x * s + 'px'; d.style.top = tb.y * s + 'px'; d.style.fontSize = (tb.size || 24) * s + 'px';
    d.style.color = inkColor(tb.color || INK); d.style.maxWidth = (PAGE_W - tb.x - 30) * s + 'px';
    d.textContent = tb.text;
    d.addEventListener('focus', () => { pushHistory(); d._dirty = false; });
    d.addEventListener('input', () => { tb.text = d.innerText.replace(/\n$/, ''); saveNote(note); });
    d.addEventListener('blur', () => { if (!tb.text.trim()) { pg.texts = pg.texts.filter(t => t !== tb); saveNote(note); renderOverlay(pi); renderSidebar(); } else renderSidebar(); });
    ov.append(d);
  }
  const now = Date.now();
  for (const t of pg.tasks) {
    const overdue = t.due && !t.done && new Date(t.due) < now;
    const chip = `<button class="due ${t.due ? (overdue ? 'overdue' : '') : 'none'}" data-act="edit">${t.due ? '⏰ ' + esc(fmtDue(t.due)) + (t.repeat ? ' ↻' : '') : '＋ Remind'}</button>`;
    const chk = `<button class="chk" data-act="toggle" aria-label="Mark done">${t.done ? '✓' : ''}</button>`;
    const fs = 26 * s;
    if (t.kind === 'ink') {
      const r = document.createElement('div'); r.className = 'task-region' + (t.done ? ' done' : ''); r.dataset.id = t.id;
      Object.assign(r.style, { left: t.x * s + 'px', top: t.y * s + 'px', width: t.w * s + 'px', height: t.h * s + 'px' });
      ov.append(r);
      const left = document.createElement('div'); left.className = 'task' + (t.done ? ' done' : ''); left.dataset.id = t.id;
      left.style.fontSize = fs + 'px';
      const cx = t.x - 44 >= 0 ? t.x - 44 : t.x + 6;
      left.style.left = cx * s + 'px'; left.style.top = (t.y + Math.min(t.h / 2, 40) - 17) * s + 'px';
      left.innerHTML = chk; ov.append(left);
      const c2 = document.createElement('div'); c2.className = 'task'; c2.dataset.id = t.id; c2.style.fontSize = fs + 'px';
      c2.style.left = t.x * s + 'px'; c2.style.top = (t.y + t.h + 4) * s + 'px';
      c2.innerHTML = (t.text ? `<span class="label" data-act="edit" style="font-size:.7em;opacity:.75">${esc(t.text)}</span>` : '') + chip;
      ov.append(c2);
    } else {
      const d = document.createElement('div'); d.className = 'task' + (t.done ? ' done' : ''); d.dataset.id = t.id;
      d.style.fontSize = fs + 'px'; d.style.left = t.x * s + 'px'; d.style.top = t.y * s + 'px';
      d.style.color = inkColor(t.color || INK);
      d.innerHTML = chk + `<span class="label" data-act="edit">${esc(t.text || 'New task')}</span>` + chip;
      ov.append(d);
    }
  }
  ov.querySelectorAll('[data-act]').forEach(b => {
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => {
      e.stopPropagation();
      const id = b.closest('[data-id]').dataset.id, t = pg.tasks.find(x => x.id === id);
      if (b.dataset.act === 'toggle') { pushHistory(); toggleDone({ type: 'task', note, obj: t, page: pi }); }
      else openEditor({ type: 'task', note, obj: t, page: pi });
    });
  });
}

/* ---------- input ---------- */
let drawing = null;
const touches = new Map();
let pan = null;
function toPage(e, cv) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale]; }
function applyFingerMode() {
  const on = fingerDrawOn();
  $('#fingerBtn').classList.toggle('on', on);
  $('#fingerBtn').textContent = on ? '☝️ Finger draws' : '☝️ Finger scrolls';
  for (const r of pageEls) { r.base.classList.toggle('ink-draw', on); r.base.classList.toggle('ink-pan', !on); }
}
function notePen() {
  if (!penSeen()) {
    localStorage.setItem('penSeen', '1');
    if (localStorage.getItem('fingerDraw') === null) { applyFingerMode(); toast('Apple Pencil detected — fingers now scroll (palm rejection on)'); }
  }
}
function onDown(e, pi) {
  const cv = pageEls[pi].base;
  if (e.pointerType === 'pen') notePen();
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now(), pi });
    if (drawing && drawing.pointerType === 'pen') return;           // palm rejection while pencil is down
    if (!fingerDrawOn()) return;                                     // fingers scroll natively
    if (touches.size >= 2) { cancelDrawing(); pan = { y: avgY(), x: avgX() }; return; } // two-finger pan
  }
  if (drawing || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  const p = toPage(e, cv), pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
  const note = curNote();
  hideLasso();
  drawing = { id: e.pointerId, pointerType: e.pointerType, pi, tool: S.tool, start: p, moved: 0 };
  if (S.tool === 'pen' || S.tool === 'highlighter') {
    const hl = S.tool === 'highlighter';
    drawing.stroke = { id: uid('s'), tool: S.tool, color: hl ? S.hlColor : S.penColor, width: hl ? S.hlWidth : S.penWidth, points: [[+p[0].toFixed(1), +p[1].toFixed(1), +pr.toFixed(2)]] };
  } else if (S.tool === 'eraser') {
    drawing.snap = snapshot(); drawing.erased = false; eraseAt(pi, p);
  } else if (S.tool === 'lasso') {
    drawing.lasso = [p];
  }
  if (document.activeElement && document.activeElement.classList.contains('textblock')) document.activeElement.blur();
  void note;
}
function avgY() { let s = 0; for (const t of touches.values()) s += t.y; return s / touches.size; }
function avgX() { let s = 0; for (const t of touches.values()) s += t.x; return s / touches.size; }
function cancelDrawing() { if (!drawing) return; const r = pageEls[drawing.pi]; if (r) clearLive(r); drawing = null; }

window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    const t = touches.get(e.pointerId); t.x = e.clientX; t.y = e.clientY;
    if (pan && touches.size >= 2) { const w = $('#pages'), y = avgY(), x = avgX(); w.scrollTop -= y - pan.y; w.scrollLeft -= x - pan.x; pan.y = y; pan.x = x; return; }
  }
  if (!drawing || e.pointerId !== drawing.id) return;
  const rec = pageEls[drawing.pi]; if (!rec) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) {
    const p = toPage(ev, rec.base);
    drawing.moved = Math.max(drawing.moved, Math.hypot(p[0] - drawing.start[0], p[1] - drawing.start[1]));
    if (drawing.stroke) {
      const pts = drawing.stroke.points, last = pts[pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.7) continue;
      const pr = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
      pts.push([+p[0].toFixed(1), +p[1].toFixed(1), +pr.toFixed(2)]);
      if (drawing.stroke.tool === 'highlighter') { clearLive(rec); drawStroke(rec.lctx, drawing.stroke); }
      else { const c = rec.lctx; c.save(); c.lineCap = 'round'; c.strokeStyle = inkColor(drawing.stroke.color); drawPenSeg(c, drawing.stroke, pts.length - 1); c.restore(); }
    } else if (S.tool === 'eraser' && drawing.tool === 'eraser') {
      eraseAt(drawing.pi, p);
    } else if (drawing.lasso) {
      drawing.lasso.push(p); clearLive(rec); drawLassoPath(rec.lctx, drawing.lasso);
    }
  }
}, { passive: true });

function endPointer(e) {
  if (e.pointerType === 'touch') {
    const t = touches.get(e.pointerId); touches.delete(e.pointerId);
    if (touches.size < 2) pan = null;
    // Tap with finger places a text box / task even when fingers scroll.
    if (t && e.type === 'pointerup' && !drawing && (S.tool === 'task' || S.tool === 'text') && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && Date.now() - t.t < 600) {
      const rec = pageEls[t.pi]; if (rec && e.target === rec.base) placeAt(t.pi, toPage(e, rec.base));
      return;
    }
  }
  if (!drawing || e.pointerId !== drawing.id) return;
  const d = drawing; drawing = null;
  const rec = pageEls[d.pi], note = curNote(), pg = note.pages[d.pi];
  if (e.type === 'pointercancel') { clearLive(rec); return; }
  if (d.stroke) {
    d.stroke.bb = bbox(d.stroke.points);
    pushHistory(); pg.strokes.push(d.stroke); saveNote(note);
    clearLive(rec); renderPageInk(d.pi);
  } else if (d.tool === 'eraser') {
    if (d.erased) { S.undo.push(d.snap); S.redo = []; updateUndo(); saveNote(note); }
  } else if (d.lasso) {
    clearLive(rec); finishLasso(d.pi, d.lasso);
  } else if ((d.tool === 'task' || d.tool === 'text') && d.moved < 8) {
    placeAt(d.pi, d.start);
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

// iOS: stop Apple Pencil from scrolling the page while letting fingers scroll.
$('#pages').addEventListener('touchstart', e => { if ([...e.touches].some(t => t.touchType === 'stylus') && e.target.tagName === 'CANVAS') e.preventDefault(); }, { passive: false });
$('#pages').addEventListener('touchmove', e => { if ([...e.touches].some(t => t.touchType === 'stylus') && e.target.tagName === 'CANVAS') e.preventDefault(); }, { passive: false });

function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function eraseAt(pi, p) {
  const pg = curNote().pages[pi], R = 10;
  const before = pg.strokes.length;
  pg.strokes = pg.strokes.filter(st => {
    const bb = st.bb || (st.bb = bbox(st.points)), pad = R + st.width;
    if (p[0] < bb[0] - pad || p[0] > bb[2] + pad || p[1] < bb[1] - pad || p[1] > bb[3] + pad) return true;
    const pts = st.points, lim = R + st.width / 2;
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > lim;
    for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= lim) return false;
    return true;
  });
  if (pg.strokes.length !== before) { if (drawing) drawing.erased = true; renderPageInk(pi); }
}

/* ---------- lasso → task ---------- */
let selection = null;
function drawLassoPath(ctx, pts, closed) {
  ctx.save(); ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#4f46e5'; ctx.fillStyle = 'rgba(79,70,229,.07)';
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function finishLasso(pi, poly) {
  if (poly.length < 5) return;
  const pg = curNote().pages[pi];
  const ids = pg.strokes.filter(st => { let n = 0; for (const p of st.points) if (inPoly(p, poly)) n++; return n / st.points.length >= 0.6; }).map(s => s.id);
  if (!ids.length) { hint('Nothing selected — circle some handwriting'); return; }
  const strokes = pg.strokes.filter(s => ids.includes(s.id));
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) { const b = s.bb || bbox(s.points); bb = [Math.min(bb[0], b[0] - s.width), Math.min(bb[1], b[1] - s.width), Math.max(bb[2], b[2] + s.width), Math.max(bb[3], b[3] + s.width)]; }
  const pad = 8; bb = [Math.max(0, bb[0] - pad), Math.max(0, bb[1] - pad), Math.min(PAGE_W, bb[2] + pad), Math.min(PAGE_H, bb[3] + pad)];
  selection = { pi, ids, bb };
  const rec = pageEls[pi]; clearLive(rec);
  const c = rec.lctx; c.save(); c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeStyle = '#4f46e5'; c.fillStyle = 'rgba(79,70,229,.08)';
  c.fillRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]); c.strokeRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]); c.restore();
  positionLassoMenu(); $('#lassoMenu').hidden = false;
}
function positionLassoMenu() {
  if (!selection) return;
  const m = $('#lassoMenu'), rec = pageEls[selection.pi]; if (!rec) return;
  const r = rec.el.getBoundingClientRect(), mr = $('#main').getBoundingClientRect();
  let x = r.left - mr.left + selection.bb[0] * S.scale, y = r.top - mr.top + selection.bb[1] * S.scale - 58;
  if (y < 110) y = r.top - mr.top + selection.bb[3] * S.scale + 10;
  m.style.left = Math.max(8, Math.min(x, mr.width - 300)) + 'px'; m.style.top = y + 'px';
}
function hideLasso() { if (selection) { const rec = pageEls[selection.pi]; if (rec) clearLive(rec); } selection = null; $('#lassoMenu').hidden = true; }
$('#pages').addEventListener('scroll', positionLassoMenu, { passive: true });
$('#lassoCancel').onclick = hideLasso;
$('#lassoDelete').onclick = () => { const n = curNote(), sel = selection; pushHistory(); const pg = n.pages[sel.pi]; pg.strokes = pg.strokes.filter(s => !sel.ids.includes(s.id)); saveNote(n); hideLasso(); renderPageInk(sel.pi); };
$('#lassoTask').onclick = () => {
  const n = curNote(), sel = selection; if (!sel) return;
  const [x0, y0, x1, y1] = sel.bb;
  const t = { id: uid('t'), kind: 'ink', x: x0, y: y0, w: x1 - x0, h: y1 - y0, strokeIds: sel.ids, text: '', done: false, due: null, repeat: '', notified: false, createdAt: Date.now() };
  hideLasso();
  openEditor({ type: 'task', note: n, obj: t, page: sel.pi }, true);
};

function placeAt(pi, p) {
  const n = curNote(), pg = n.pages[pi];
  if (S.tool === 'task') {
    const t = { id: uid('t'), kind: 'typed', x: Math.max(4, Math.min(p[0] - 14, PAGE_W - 200)), y: Math.max(4, p[1] - 18), text: '', color: S.penColor, done: false, due: null, repeat: '', notified: false, createdAt: Date.now() };
    openEditor({ type: 'task', note: n, obj: t, page: pi }, true);
  } else if (S.tool === 'text') {
    const tb = { id: uid('x'), x: Math.max(4, p[0] - 4), y: Math.max(4, p[1] - 18), text: '', size: 24, color: S.penColor };
    pg.texts.push(tb); renderOverlay(pi);
    const el = pageEls[pi].ov.querySelector(`[data-id="${tb.id}"]`); el && el.focus();
  }
}

/* ---------- undo / redo ---------- */
const snapshot = () => JSON.stringify(curNote().pages);
function pushHistory() { const n = curNote(); if (!n) return; S.undo.push(snapshot()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; updateUndo(); }
function restore(from, to) {
  const n = curNote(); if (!from.length) return;
  to.push(snapshot()); n.pages = JSON.parse(from.pop()); saveNote(n); buildPages(); renderPanel(); renderSidebar(); updateUndo();
}
function updateUndo() { $('#undoBtn').disabled = $('#fUndo').disabled = !S.undo.length; $('#redoBtn').disabled = $('#fRedo').disabled = !S.redo.length; }
$('#undoBtn').onclick = () => restore(S.undo, S.redo);
$('#redoBtn').onclick = () => restore(S.redo, S.undo);
document.addEventListener('keydown', e => {
  if (e.target.matches('input, [contenteditable], textarea, select')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? restore(S.redo, S.undo) : restore(S.undo, S.redo); }
});

/* ---------- toolbar ---------- */
function renderToolbar() {
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  const hl = S.tool === 'highlighter';
  const cols = hl ? HL_COLORS : PEN_COLORS, curC = hl ? S.hlColor : S.penColor;
  $('#colors').innerHTML = cols.map(c => `<button class="swatch ${c === curC ? 'on' : ''}" data-c="${c}" style="background:${c === INK ? 'linear-gradient(135deg,#1d1d1f 50%,#ececf0 50%)' : c}" aria-label="Color"></button>`).join('');
  const ws = hl ? HL_WIDTHS : PEN_WIDTHS, curW = hl ? S.hlWidth : S.penWidth;
  $('#widths').innerHTML = ws.map((w, i) => { const d = hl ? 6 + i * 5 : 3 + i * 3.5; return `<button class="wbtn ${w === curW ? 'on' : ''}" data-w="${w}" aria-label="Width"><i style="width:${d}px;height:${d}px"></i></button>`; }).join('');
  const showStyle = ['pen', 'highlighter', 'text', 'task'].includes(S.tool);
  $('#colors').style.display = showStyle ? '' : 'none';
  $('#widths').style.display = (S.tool === 'pen' || hl) ? '' : 'none';
  $('#pages').classList.toggle('mode-text', S.tool === 'text');
}
$('#toolbar').addEventListener('click', e => {
  const t = e.target.closest('.tool'), c = e.target.closest('.swatch'), w = e.target.closest('.wbtn');
  if (t) selectTool(t.dataset.tool);
  if (c) { if (S.tool === 'highlighter') { S.hlColor = c.dataset.c; localStorage.setItem('hlColor', S.hlColor); } else { S.penColor = c.dataset.c; localStorage.setItem('penColor', S.penColor); } renderToolbar(); }
  if (w) { if (S.tool === 'highlighter') { S.hlWidth = +w.dataset.w; localStorage.setItem('hlWidth', S.hlWidth); } else { S.penWidth = +w.dataset.w; localStorage.setItem('penWidth', S.penWidth); } renderToolbar(); }
});
function selectTool(tool) {
  S.tool = tool; localStorage.setItem('tool', S.tool); hideLasso(); renderToolbar();
  if (S.tool === 'task') hint('Tap anywhere on the page to add a task');
  if (S.tool === 'lasso') hint('Circle handwriting, then tap "Make task"');
  if (S.tool === 'text') hint('Tap the page to type');
}
$('#focusBar').addEventListener('click', e => {
  const t = e.target.closest('.tool'); if (t) return selectTool(t.dataset.tool);
  const a = e.target.closest('[data-fa]'); if (!a) return;
  if (a.dataset.fa === 'undo') restore(S.undo, S.redo);
  if (a.dataset.fa === 'redo') restore(S.redo, S.undo);
  if (a.dataset.fa === 'exit') setFocus(false);
});
function setFocus(on) {
  const app = $('#app'); if (app.classList.contains('focus') === on) return;
  const w = $('#pages'), frac = w.scrollTop / (w.scrollHeight || 1);
  app.classList.toggle('focus', on); hideLasso();
  const de = document.documentElement;
  try {
    if (on && !document.fullscreenElement && !document.webkitFullscreenElement) { const r = (de.requestFullscreen || de.webkitRequestFullscreen)?.call(de); r && r.catch && r.catch(() => {}); }
    if (!on && (document.fullscreenElement || document.webkitFullscreenElement)) { const r = (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); r && r.catch && r.catch(() => {}); }
  } catch (_) {}
  lastW = 0; relayout(); w.scrollTop = frac * w.scrollHeight;
  if (on) hint('Full screen — tap ⤡ to exit');
}
$('#focusBtn').onclick = () => setFocus(true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#app').classList.contains('focus')) setFocus(false); });
$('#fingerBtn').onclick = () => { const on = !fingerDrawOn(); localStorage.setItem('fingerDraw', on ? '1' : '0'); applyFingerMode(); toast(on ? 'Finger drawing on — use two fingers to scroll' : 'Finger drawing off — fingers scroll, Pencil draws'); };
$('#remindNoteBtn').onclick = () => { const n = curNote(); openEditor({ type: 'note', note: n, obj: { id: uid('r'), title: n.title, due: null, repeat: '', done: false, notified: false, createdAt: Date.now() }, page: -1 }, true); };

/* ---------- note reminders bar ---------- */
function renderNoteReminders() {
  const n = curNote(), box = $('#noteReminders'); if (!n) { box.innerHTML = ''; return; }
  const now = Date.now();
  box.innerHTML = n.reminders.map(r => `<button class="nr-chip ${r.done ? 'done' : (r.due && new Date(r.due) < now ? 'overdue' : '')}" data-id="${r.id}">⏰ ${esc(r.title || 'Reminder')} · ${esc(fmtDue(r.due))}${r.repeat ? ' ↻' : ''}<b data-x>${r.done ? '↺' : '✓'}</b></button>`).join('');
  box.querySelectorAll('.nr-chip').forEach(b => b.onclick = e => {
    const r = n.reminders.find(x => x.id === b.dataset.id), item = { type: 'note', note: n, obj: r, page: -1 };
    if (e.target.closest('[data-x]')) toggleDone(item); else openEditor(item);
  });
}

/* ---------- editor sheet ---------- */
let editing = null;
function openEditor(item, isNew) {
  editing = { item, isNew };
  const o = item.obj;
  $('#sheetTitle').textContent = item.type === 'note' ? (isNew ? 'Remind me about this note' : 'Note reminder') : (isNew ? (o.kind === 'ink' ? 'Turn handwriting into a task' : 'New task') : 'Task');
  $('#fTitle').value = item.type === 'note' ? (o.title || '') : (o.text || '');
  $('#fTitle').placeholder = o.kind === 'ink' ? 'Optional label (your handwriting is the task)' : 'What needs doing?';
  $('#fDue').value = toLocalInput(o.due); $('#fRepeat').value = o.repeat || '';
  $('#fDelete').style.display = isNew ? 'none' : '';
  $('#fIcs').style.display = o.due ? '' : 'none';
  const th = $('#sheetThumb'); th.innerHTML = '';
  if (o.kind === 'ink') { const u = inkThumb(item.note, item.page, o, 400, 160); if (u) th.innerHTML = `<img src="${u}" alt="">`; }
  $('#sheetWrap').hidden = false;
  if (!(o.kind === 'ink') && isNew) setTimeout(() => $('#fTitle').focus(), 50);
}
function closeEditor() { $('#sheetWrap').hidden = true; editing = null; }
$('#fDue').addEventListener('input', () => { $('#fIcs').style.display = $('#fDue').value ? '' : 'none'; });
$('#quickDue').onclick = e => {
  const q = e.target.dataset.q; if (!q) return; const d = new Date();
  if (q === '1h') d.setTime(d.getTime() + 36e5);
  if (q === 'tonight') { d.setHours(18, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); }
  if (q === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  if (q === 'nextweek') { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }
  $('#fDue').value = q === 'clear' ? '' : toLocalInput(d.toISOString()); $('#fIcs').style.display = $('#fDue').value ? '' : 'none';
};
$('#fCancel').onclick = closeEditor;
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeEditor(); });
function applyEditorFields() {
  const { item } = editing, o = item.obj;
  const title = $('#fTitle').value.trim(), due = fromLocalInput($('#fDue').value);
  if (item.type === 'note') o.title = title || item.note.title; else o.text = title;
  if (due !== o.due) { o.notified = false; if (due && new Date(due) > Date.now()) o.done = false; }
  o.due = due; o.repeat = $('#fRepeat').value;
}
$('#fSave').onclick = () => {
  const { item, isNew } = editing, n = item.note;
  if (item.type === 'task' && n.id === S.cur) pushHistory();
  applyEditorFields();
  if (isNew) { if (item.type === 'note') n.reminders.push(item.obj); else n.pages[item.page].tasks.push(item.obj); }
  saveNote(n, true); closeEditor(); renderAll();
  if (item.obj.due && typeof Notification !== 'undefined' && Notification.permission === 'default') maybeAskNotif();
};
$('#fDelete').onclick = () => {
  const { item } = editing, n = item.note;
  if (item.type === 'note') n.reminders = n.reminders.filter(r => r !== item.obj);
  else { if (n.id === S.cur) pushHistory(); const pg = n.pages[item.page]; pg.tasks = pg.tasks.filter(t => t !== item.obj); }
  saveNote(n, true); closeEditor(); renderAll();
};
$('#fIcs').onclick = () => { applyEditorFields(); downloadIcs(editing.item); };

function actionSheet(title, actions) {
  $('#actionTitle').textContent = title;
  const box = $('#actionBtns'); box.innerHTML = '';
  for (const a of [...actions, { label: 'Cancel' }]) {
    const b = document.createElement('button'); b.className = 'btn' + (a.danger ? ' danger' : '') + (a.primary ? ' primary' : ''); b.textContent = a.label;
    b.onclick = () => { $('#actionWrap').hidden = true; a.fn && a.fn(); }; box.append(b);
  }
  $('#actionWrap').hidden = false;
}
$('#actionWrap').addEventListener('click', e => { if (e.target.id === 'actionWrap') $('#actionWrap').hidden = true; });

/* ---------- reminders model ---------- */
function allItems() {
  const out = [];
  for (const note of S.notes) {
    for (const r of note.reminders) out.push({ type: 'note', note, obj: r, page: -1 });
    note.pages.forEach((pg, pi) => pg.tasks.forEach(t => out.push({ type: 'task', note, obj: t, page: pi })));
  }
  return out;
}
const itemTitle = it => it.type === 'note' ? (it.obj.title || it.note.title) : (it.obj.text || (it.obj.kind === 'ink' ? 'Handwritten task' : 'Untitled task'));
function toggleDone(it) {
  const o = it.obj;
  if (!o.done && o.repeat && o.due) { let d = o.due; do d = advance(d, o.repeat); while (new Date(d) < Date.now()); o.due = d; o.notified = false; toast('Done — next: ' + fmtDue(d)); }
  else { o.done = !o.done; o.doneAt = o.done ? Date.now() : null; }
  saveNote(it.note, true); renderAll();
}
const thumbCache = new Map();
function inkThumb(note, pi, t, W = 128, H = 80) {
  const key = [t.id, note.updatedAt, W, isDark()].join(':'); if (thumbCache.has(key)) return thumbCache.get(key);
  const pg = note.pages[pi]; if (!pg) return '';
  const strokes = pg.strokes.filter(s => t.strokeIds.includes(s.id)); if (!strokes.length) return '';
  const c = document.createElement('canvas'), dpr = 2; c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d'), sc = Math.min(W / t.w, H / t.h) * dpr;
  ctx.setTransform(sc, 0, 0, sc, (W * dpr - t.w * sc) / 2 - t.x * sc, (H * dpr - t.h * sc) / 2 - t.y * sc);
  for (const s of strokes) drawStroke(ctx, s);
  const u = c.toDataURL(); thumbCache.set(key, u); return u;
}

/* ---------- panel ---------- */
function renderPanel() {
  const list = $('#reminderList'), now = new Date(), sod = startOfDay(now);
  let items = allItems();
  if (S.filter === 'due') items = items.filter(i => !i.obj.done && i.obj.due);
  else if (S.filter === 'open') items = items.filter(i => !i.obj.done);
  else items = items.filter(i => i.obj.done);
  const groups = new Map();
  const put = (k, it) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); };
  if (S.filter === 'done') { items.sort((a, b) => (b.obj.doneAt || 0) - (a.obj.doneAt || 0)); items.forEach(i => put('Completed', i)); }
  else {
    items.sort((a, b) => (a.obj.due ? new Date(a.obj.due) : 9e15) - (b.obj.due ? new Date(b.obj.due) : 9e15));
    for (const i of items) {
      if (!i.obj.due) { put('No date', i); continue; }
      const d = new Date(i.obj.due), days = Math.round((startOfDay(d) - sod) / 864e5);
      put(d < now ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 7 ? 'Next 7 days' : 'Later', i);
    }
  }
  const order = ['Overdue', 'Today', 'Tomorrow', 'Next 7 days', 'Later', 'No date', 'Completed'];
  if (!items.length) {
    list.innerHTML = `<div class="empty">${S.filter === 'done' ? 'Nothing completed yet.' : 'No reminders yet.<br><br>Open a note, tap <b>☑️ Task</b> and tap the page — or lasso some handwriting and tap <b>Make task</b>. Add a time to get reminded.'}</div>`;
  } else {
    list.innerHTML = order.filter(k => groups.has(k)).map(k => `<div class="rgroup ${k === 'Overdue' ? 'overdue' : ''}"><h4>${k}</h4>${groups.get(k).map(rowHTML).join('')}</div>`).join('');
  }
  const map = new Map(allItems().map(i => [i.obj.id, i]));
  list.querySelectorAll('.ritem').forEach(row => {
    const it = map.get(row.dataset.id);
    row.onclick = e => {
      if (e.target.closest('.rchk')) { toggleDone(it); return; }
      if (e.target.closest('.rcal')) { downloadIcs(it); return; }
      jumpTo(it.note.id, it.type === 'task' ? it.obj.id : null);
    };
  });
  const od = allItems().filter(i => !i.obj.done && i.obj.due && new Date(i.obj.due) < now).length;
  const b = $('#dueBadge'); b.hidden = !od; b.textContent = od;
  renderNotifUI();
}
function rowHTML(it) {
  const o = it.obj, od = o.due && !o.done && new Date(o.due) < Date.now();
  const thumb = o.kind === 'ink' ? inkThumb(it.note, it.page, o) : '';
  return `<div class="ritem ${o.done ? 'done' : ''}" data-id="${o.id}" role="button">
    <button class="rchk ${it.type === 'note' ? 'note' : ''}" aria-label="Done">${o.done ? '✓' : ''}</button>
    ${thumb ? `<img class="rthumb" src="${thumb}" alt="">` : ''}
    <div class="rbody"><div class="rt">${it.type === 'note' ? '⏰ ' : ''}${esc(itemTitle(it))}</div>
    <div class="rs">${o.due ? `<span class="${od ? 'od' : ''}">${esc(fmtDue(o.due))}${o.repeat ? ' ↻' : ''}</span> · ` : ''}${esc(it.note.title)}${it.page >= 0 ? ' · p' + (it.page + 1) : ''}</div></div>
    ${o.due ? '<button class="rcal" title="Add to Calendar" aria-label="Add to Calendar">📅</button>' : ''}</div>`;
}
$('#filterSeg').onclick = e => { const f = e.target.dataset.f; if (!f) return; S.filter = f; document.querySelectorAll('#filterSeg button').forEach(b => b.classList.toggle('on', b.dataset.f === f)); renderPanel(); };

function jumpTo(noteId, taskId) {
  if (!S.notes.find(n => n.id === noteId)) return;
  if (S.cur !== noteId) openNote(noteId);
  if (isDrawer()) setPanel(false);
  if (!taskId) { $('#pages').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const n = curNote(); let pi = -1, t;
  n.pages.forEach((pg, i) => { const f = pg.tasks.find(x => x.id === taskId); if (f) { pi = i; t = f; } });
  if (pi < 0) return;
  requestAnimationFrame(() => {
    const rec = pageEls[pi], w = $('#pages');
    w.scrollTo({ top: rec.el.offsetTop + t.y * S.scale - w.clientHeight / 3, behavior: 'smooth' });
    rec.ov.querySelectorAll(`[data-id="${taskId}"]`).forEach(el => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
  });
}

/* ---------- alerts ---------- */
function checkDue() {
  const now = Date.now();
  for (const it of allItems()) {
    const o = it.obj;
    if (o.done || !o.due || o.notified || new Date(o.due) > now) continue;
    o.notified = true; saveNote(it.note, true);
    showBanner(it); systemNotify(it);
  }
  renderPanel();
  if (curNote()) { renderNoteReminders(); }
}
function showBanner(it) {
  const b = document.createElement('div'); b.className = 'banner';
  b.innerHTML = `<div class="bt">⏰ ${esc(itemTitle(it))}</div><div class="bs">${esc(fmtDue(it.obj.due))} · ${esc(it.note.title)}</div>
    <div class="bb"><button data-a="snooze">Snooze 10 min</button><button data-a="done">Mark done</button><button data-a="open" class="primary">Open</button><button data-a="x" aria-label="Dismiss">✕</button></div>`;
  b.onclick = e => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'snooze') { it.obj.due = new Date(Date.now() + 6e5).toISOString(); it.obj.notified = false; saveNote(it.note, true); renderAll(); toast('Snoozed 10 minutes'); }
    if (a === 'done') toggleDone(it);
    if (a === 'open') jumpTo(it.note.id, it.type === 'task' ? it.obj.id : null);
    b.remove();
  };
  $('#banners').append(b);
  try { navigator.vibrate && navigator.vibrate(200); } catch (_) {}
  setTimeout(() => b.remove(), 60000);
}
async function systemNotify(it) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const opts = { body: `${fmtDue(it.obj.due)} · ${it.note.title}`, tag: it.obj.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { noteId: it.note.id, taskId: it.type === 'task' ? it.obj.id : null } };
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) return reg.showNotification('⏰ ' + itemTitle(it), opts); } catch (_) {}
  try { new Notification('⏰ ' + itemTitle(it), opts); } catch (_) {}
}
function renderNotifUI() {
  const btn = $('#notifBtn'), note = $('#notifNote');
  const supported = typeof Notification !== 'undefined';
  if (!supported) {
    btn.style.display = 'none';
    note.innerHTML = isIOS && !isStandalone ? 'Tip: tap Share → <b>Add to Home Screen</b>, then open from there to allow notifications. Alerts only fire while the app is open; use 📅 to get a guaranteed Calendar alert.' : 'Alerts show while the app is open. Use 📅 Add to Calendar for an alert even when it’s closed.';
  } else if (Notification.permission === 'granted') {
    btn.style.display = 'none'; note.innerHTML = 'Notifications on. They fire while the app is open or recently used — iOS can’t wake a closed web app. Use 📅 for a guaranteed alert.';
  } else {
    btn.style.display = ''; note.innerHTML = Notification.permission === 'denied' ? 'Notifications are blocked in Settings. In-app banners still work; use 📅 for Calendar alerts.' : 'Alerts show while the app is open. Use 📅 Add to Calendar for an alert even when it’s closed.';
  }
}
async function maybeAskNotif() { if (localStorage.getItem('askedNotif')) return; localStorage.setItem('askedNotif', '1'); hint('Tip: enable notifications in the 🔔 panel'); }
$('#notifBtn').onclick = async () => { try { const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notifications enabled' : 'Notifications not allowed'); } catch (e) { toast('Notifications unavailable here'); } renderNotifUI(); };

/* ---------- calendar (.ics) ---------- */
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function fold(line) { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); }
function buildIcs(it) {
  const o = it.obj, start = new Date(o.due), end = new Date(start.getTime() + 15 * 6e4), title = itemTitle(it);
  const url = location.origin + location.pathname + '#note=' + it.note.id + (it.type === 'task' ? '&task=' + o.id : '');
  const rr = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[o.repeat];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pencil Notes//Notes & Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + o.id + '@inkminder', 'DTSTAMP:' + icsDate(new Date()), 'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end),
    'SUMMARY:' + icsEscape(title), 'DESCRIPTION:' + icsEscape(`From note "${it.note.title}"${it.page >= 0 ? ' (page ' + (it.page + 1) + ')' : ''} in Pencil Notes.\n${url}`),
    'URL:' + url, ...(rr ? ['RRULE:FREQ=' + rr] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(title), 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
async function downloadIcs(it) {
  if (!it.obj.due) { toast('Set a date first'); return; }
  const ics = buildIcs(it), name = (itemTitle(it).replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'reminder') + '.ics';
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  if (isIOS && isStandalone && navigator.canShare) {
    const file = new File([blob], name, { type: 'text/calendar' });
    if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: itemTitle(it) }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  toast('Calendar file ready — open it and tap “Add”');
}

/* ---------- sidebar ---------- */
function noteSearchText(n) { return (n.title + ' ' + n.pages.map(p => p.texts.map(t => t.text).join(' ') + ' ' + p.tasks.map(t => t.text).join(' ')).join(' ')).toLowerCase(); }
function renderSidebar() {
  const box = $('#notebookList'), q = S.search.trim().toLowerCase(), cur = curNote(), now = Date.now();
  box.innerHTML = S.notebooks.sort((a, b) => a.createdAt - b.createdAt).map(nb => {
    let notes = S.notes.filter(n => n.notebookId === nb.id).sort((a, b) => b.updatedAt - a.updatedAt);
    if (q) notes = notes.filter(n => noteSearchText(n).includes(q));
    const col = S.collapsed.has(nb.id) && !q;
    return `<div class="nb"><div class="nb-head ${cur && cur.notebookId === nb.id ? 'current' : ''}" data-nb="${nb.id}">
      <button data-toggle aria-label="Collapse">${col ? '▸' : '▾'}</button><span class="name">${esc(nb.name)}</span>
      <button data-add aria-label="New note here">＋</button><button data-nbmore aria-label="Notebook options">⋯</button></div>
      ${col ? '' : notes.map(n => {
        const tasks = n.pages.flatMap(p => p.tasks).concat(n.reminders).filter(t => !t.done);
        const od = tasks.filter(t => t.due && new Date(t.due) < now).length;
        const next = tasks.filter(t => t.due && new Date(t.due) >= now).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
        const sub = [new Date(n.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })];
        if (tasks.length) sub.push(`${tasks.length} open`);
        return `<div class="note-row ${cur && cur.id === n.id ? 'active' : ''}" data-note="${n.id}" role="button"><div class="meta"><div class="t">${esc(n.title)}</div>
          <div class="s">${sub.join(' · ')}${od ? ` · <span class="od">${od} overdue</span>` : next ? ' · ⏰ ' + esc(fmtDue(next.due)) : ''}</div></div>
          <button class="more" data-more aria-label="Note options">⋯</button></div>`;
      }).join('') || (q ? '' : '<div class="note-row"><div class="meta"><div class="s">No notes</div></div></div>')}</div>`;
  }).join('');
}
$('#notebookList').addEventListener('click', e => {
  const head = e.target.closest('[data-nb]'), row = e.target.closest('[data-note]');
  if (head) {
    const nb = S.notebooks.find(b => b.id === head.dataset.nb);
    if (e.target.closest('[data-add]')) return createNote(nb.id);
    if (e.target.closest('[data-nbmore]')) return actionSheet(nb.name, [
      { label: 'Rename notebook', fn: () => { const v = prompt('Notebook name', nb.name); if (v && v.trim()) { nb.name = v.trim(); saveNotebook(nb); renderSidebar(); } } },
      { label: 'Delete notebook and its notes', danger: true, fn: () => deleteNotebook(nb) }]);
    S.collapsed.has(nb.id) ? S.collapsed.delete(nb.id) : S.collapsed.add(nb.id);
    localStorage.setItem('collapsed', JSON.stringify([...S.collapsed])); renderSidebar(); return;
  }
  if (row && row.dataset.note) {
    const n = S.notes.find(x => x.id === row.dataset.note);
    if (e.target.closest('[data-more]')) return noteMenu(n);
    openNote(n.id); if (isDrawer()) setSidebar(false);
  }
});
function noteMenu(n) {
  actionSheet(n.title, [
    { label: 'Rename', fn: () => { const v = prompt('Note title', n.title); if (v && v.trim()) { n.title = v.trim(); saveNote(n); renderAll(); } } },
    ...(S.notebooks.length > 1 ? [{ label: 'Move to notebook…', fn: () => actionSheet('Move to…', S.notebooks.filter(b => b.id !== n.notebookId).map(b => ({ label: b.name, fn: () => { n.notebookId = b.id; saveNote(n); renderSidebar(); } }))) }] : []),
    { label: 'Delete note', danger: true, fn: () => deleteNote(n) }]);
}
async function deleteNote(n) {
  S.notes = S.notes.filter(x => x !== n); await DB.del('notes', n.id);
  if (S.cur === n.id) { const next = S.notes.sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (next) openNote(next.id); else createNote(n.notebookId); }
  renderAll(); toast('Note deleted');
}
async function deleteNotebook(nb) {
  if (S.notebooks.length === 1) { toast('You need at least one notebook'); return; }
  for (const n of S.notes.filter(x => x.notebookId === nb.id)) await DB.del('notes', n.id);
  S.notes = S.notes.filter(x => x.notebookId !== nb.id); S.notebooks = S.notebooks.filter(b => b !== nb); await DB.del('notebooks', nb.id);
  if (!curNote()) { if (S.notes.length) openNote(S.notes[0].id); else createNote(S.notebooks[0].id); }
  renderAll();
}
function createNote(nbId) {
  const n = makeNote(nbId || (curNote() && curNote().notebookId) || S.notebooks[0].id);
  S.notes.push(n); saveNote(n, true); openNote(n.id);
  if (isDrawer()) setSidebar(false);
  setTimeout(() => { $('#noteTitle').focus(); $('#noteTitle').select(); }, 60);
}
$('#newNote').onclick = () => createNote();
$('#newNotebook').onclick = () => { const v = prompt('New notebook name'); if (!v || !v.trim()) return; const nb = { id: uid('b'), name: v.trim(), createdAt: Date.now() }; S.notebooks.push(nb); saveNotebook(nb); createNote(nb.id); };
$('#search').addEventListener('input', e => { S.search = e.target.value; renderSidebar(); });

$('#noteTitle').addEventListener('input', e => { const n = curNote(); n.title = e.target.value || 'Untitled note'; saveNote(n); renderSidebar(); });
$('#noteTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#noteTitle').addEventListener('blur', () => renderPanel());
$('#noteMenuBtn').onclick = () => {
  const n = curNote(), mark = p => n.paper === p ? '✓ ' : '';
  const setPaper = p => () => { n.paper = p; saveNote(n); for (let i = 0; i < pageEls.length; i++) renderPageInk(i); };
  actionSheet('Note options', [
    { label: mark('lined') + 'Lined paper', fn: setPaper('lined') }, { label: mark('grid') + 'Grid paper', fn: setPaper('grid') }, { label: mark('blank') + 'Blank paper', fn: setPaper('blank') },
    { label: '＋ Add page', fn: addPage }, { label: 'Rename / move / delete…', fn: () => noteMenu(n) },
    { label: 'Appearance: ' + { dark: 'Dark', light: 'Light', system: 'System' }[themePref()] + '…', fn: themeMenu }]);
};
function themeMenu() {
  const m = t => (themePref() === t ? '✓ ' : '');
  actionSheet('Appearance', [{ label: m('dark') + 'Dark', fn: () => setTheme('dark') }, { label: m('light') + 'Light', fn: () => setTheme('light') }, { label: m('system') + 'Match system', fn: () => setTheme('system') }]);
};

/* ---------- layout ---------- */
function setSidebar(open) {
  if (isDrawer()) $('#app').classList.toggle('side-open', open);
  else { $('#app').classList.toggle('side-collapsed', !open); setTimeout(relayout, 0); }
}
$('#toggleSidebar').onclick = () => setSidebar(isDrawer() ? !$('#app').classList.contains('side-open') : $('#app').classList.contains('side-collapsed'));
$('#closeSidebar').onclick = () => setSidebar(false);
$('#scrim').onclick = () => setSidebar(false);
function setPanel(open) { $('#app').classList.toggle('panel-closed', !open); if (!isDrawer()) setTimeout(relayout, 0); }
$('#togglePanel').onclick = () => setPanel($('#app').classList.contains('panel-closed'));
$('#closePanel').onclick = () => setPanel(false);
let lastW = 0;
function relayout() { const w = $('#pages').clientWidth; if (w && w !== lastW) { lastW = w; const st = $('#pages').scrollTop / ($('#pages').scrollHeight || 1); buildPages(); $('#pages').scrollTop = st * $('#pages').scrollHeight; } }
let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(relayout, 150); });
drawerMQ.addEventListener?.('change', () => { const app = $('#app'); app.classList.remove('side-open'); if (isDrawer()) app.classList.add('panel-closed'); setTimeout(() => { lastW = 0; relayout(); }, 50); });
sysDarkMQ.addEventListener?.('change', () => { if (themePref() === 'system') setTheme('system'); });
function setTheme(t) { localStorage.setItem('theme', t); applyTheme(); thumbCache.clear(); renderToolbar(); buildPages(); renderAll(); }

function openNote(id) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  S.cur = id; localStorage.setItem('cur', id); S.undo = []; S.redo = []; updateUndo();
  const n = curNote(); $('#noteTitle').value = n.title;
  lastW = $('#pages').clientWidth; buildPages(); $('#pages').scrollTop = 0;
  renderNoteReminders(); renderSidebar();
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}
function renderAll() {
  const n = curNote();
  if (n) { $('#noteTitle').value = n.title; for (let i = 0; i < pageEls.length; i++) renderOverlay(i); renderNoteReminders(); }
  renderSidebar(); renderPanel();
}

/* ---------- backup ---------- */
$('#exportBtn').onclick = () => {
  flushSaves();
  const data = { app: 'inkminder', version: 1, exportedAt: new Date().toISOString(), notebooks: S.notebooks, notes: S.notes };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'pencil-notes-backup-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.append(a); a.click(); a.remove();
  toast('Backup downloaded');
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data; try { data = JSON.parse(await f.text()); if (data.app !== 'inkminder' || !Array.isArray(data.notes)) throw 0; } catch (_) { toast('That file is not a Pencil Notes backup'); return; }
  const run = async replace => {
    if (replace) { await DB.clear('notes'); await DB.clear('notebooks'); S.notes = []; S.notebooks = []; }
    for (const nb of data.notebooks || []) { S.notebooks = S.notebooks.filter(x => x.id !== nb.id).concat(nb); await saveNotebook(nb); }
    for (const n of data.notes) { n.reminders ||= []; S.notes = S.notes.filter(x => x.id !== n.id).concat(n); await DB.put('notes', n); }
    for (const n of S.notes) if (!S.notebooks.find(b => b.id === n.notebookId)) n.notebookId = S.notebooks[0]?.id;
    if (!S.notebooks.length) await load();
    openNote((curNote() || S.notes[0]).id); renderAll(); toast(`Imported ${data.notes.length} notes`);
  };
  actionSheet(`Import ${data.notes.length} notes?`, [{ label: 'Merge with my notes', primary: true, fn: () => run(false) }, { label: 'Replace everything', danger: true, fn: () => run(true) }]);
};

/* ---------- deep links ---------- */
function handleHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('note')) jumpTo(h.get('note'), h.get('task'));
}
window.addEventListener('hashchange', handleHash);
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'open') jumpTo(e.data.noteId, e.data.taskId); });

/* ---------- boot ---------- */
(async function boot() {
  const initialHash = location.hash;
  await load();
  if (isDrawer()) $('#app').classList.add('panel-closed');
  renderToolbar();
  const last = localStorage.getItem('cur');
  openNote(S.notes.find(n => n.id === last) ? last : S.notes.sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
  renderPanel(); if (initialHash) { history.replaceState(null, '', initialHash); handleHash(); }
  checkDue(); setInterval(checkDue, 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); else checkDue(); });
  window.addEventListener('pagehide', flushSaves);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__ready = true;
})();
