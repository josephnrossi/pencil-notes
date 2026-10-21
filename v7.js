'use strict';
/* Pencil Notes v7: file store, PDF import/export, page templates (Meeting Notes, Daily Planner),
   drag-to-planner, photos & stickers, handwriting search labels (+ on-device recognition where the browser has it), Today. */

/* ---------- small date/time helpers ---------- */
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const addDaysISO = (iso, k) => { const [y, m, d] = iso.split('-').map(Number), x = new Date(y, m - 1, d + k); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
const hm = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const mh = m => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const fmt12 = t => { const m = hm(t), h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${pad2(mm)} ${h < 12 ? 'AM' : 'PM'}`; };
const longDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
const slotDate = (iso, time) => { const [y, m, d] = iso.split('-').map(Number), x = new Date(y, m - 1, d); x.setMinutes(hm(time)); return x; };

/* ---------- file store (blobs in IndexedDB 'assets') ---------- */
const Assets = {
  bitmaps: new Map(), loading: new Map(),
  // Bytes are stored as ArrayBuffer (Safari Private Browsing can't store Blob objects in IndexedDB).
  async put(blob, id = uid('a')) { await DB.put('assets', { id, data: await blob.arrayBuffer(), type: blob.type, size: blob.size, createdAt: Date.now() }); return id; },
  async blob(id) { const r = await DB.get('assets', id); return r ? (r.blob || new Blob([r.data], { type: r.type })) : null; },
  bitmap(id) {
    if (this.bitmaps.has(id)) return this.bitmaps.get(id);
    if (!this.loading.has(id)) this.loading.set(id, this.load(id).then(bm => { this.bitmaps.set(id, bm); this.loading.delete(id); onAssetLoaded(id); return bm; })
      .catch(() => { this.bitmaps.set(id, null); this.loading.delete(id); }));
    return undefined;
  },
  async load(id) {
    const b = await this.blob(id); if (!b) return null;
    if (self.createImageBitmap) { try { return await createImageBitmap(b); } catch (_) {} }
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(b); });
  },
  async ready(id) { const v = this.bitmap(id); if (v !== undefined) return v; await this.loading.get(id); return this.bitmaps.get(id); },
};
const pageAssetIds = pg => [pg.bg && pg.bg.asset, ...(pg.images || []).map(i => i.asset), ...((pg.rec && pg.rec.segs) || []).map(g => g.asset)].filter(Boolean);
function onAssetLoaded(id) {
  const n = curNote(); if (!n) return;
  n.pages.forEach((pg, i) => { if (pageAssetIds(pg).includes(id)) renderPageInk(i); });
}
const canvasBlob = (c, type = 'image/jpeg', q = 0.85) => new Promise(r => c.toBlob(r, type, q));

/* ---------- page backgrounds ---------- */
const tcol = () => isDark()
  ? { ink: '#dcdce2', muted: 'rgba(200,200,215,.55)', line: 'rgba(140,160,255,.20)', strong: 'rgba(150,165,255,.42)', accent: '#8b85ff', band: 'rgba(139,133,255,.07)' }
  : { ink: '#1d1d1f', muted: 'rgba(60,60,80,.55)', line: 'rgba(110,140,220,.28)', strong: 'rgba(80,110,200,.55)', accent: '#4f46e5', band: 'rgba(79,70,229,.04)' };
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
function drawPageBackground(ctx, note, pg) {
  const bg = pg.bg;
  if (bg && bg.type === 'pdf') {
    drawPaper(ctx, 'blank');
    const a = bg.aspect || 1.294; let w = PAGE_W, h = w * a; if (h > PAGE_H) { h = PAGE_H; w = h / a; }
    const x = (PAGE_W - w) / 2, im = Assets.bitmap(bg.asset);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, 0, w, h);
    if (im) ctx.drawImage(im, x, 0, w, h); else { ctx.fillStyle = '#888'; ctx.font = `24px ${FONT}`; ctx.fillText('Loading PDF page…', 40, 60); }
    return;
  }
  if (bg && bg.type === 'template') { drawPaper(ctx, bg.name === 'recording' ? 'lined' : 'blank'); if (bg.name === 'meeting') drawMeeting(ctx, bg); else if (bg.name === 'planner') drawPlanner(ctx, bg); else if (bg.name === 'assistant') drawAssistBg(ctx); return; }
  drawPaper(ctx, pg.paper || note.paper);
}
function drawPageImages(ctx, pg) {
  for (const im of pg.images || []) {
    if (im.kind === 'sticker') {
      ctx.save(); ctx.font = `${im.h * 0.86}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(im.emoji, im.x + im.w / 2, im.y + im.h * 0.54); ctx.restore();
    } else {
      const bm = Assets.bitmap(im.asset);
      if (bm) ctx.drawImage(bm, im.x, im.y, im.w, im.h);
      else { ctx.save(); ctx.fillStyle = 'rgba(128,128,128,.15)'; ctx.fillRect(im.x, im.y, im.w, im.h); ctx.restore(); }
    }
  }
}

/* Meeting Notes */
const MEET = { fields: [['Title', 150], ['Date', 215], ['Attendees', 280]], notesTop: 360, notesBottom: 990, actionsTop: 1050, rowH: 56 };
function drawMeeting(ctx, bg) {
  const c = tcol(); ctx.save();
  ctx.fillStyle = c.accent; ctx.font = `700 40px ${FONT}`; ctx.fillText('Meeting Notes', 60, 88);
  for (const [label, y] of MEET.fields) {
    ctx.fillStyle = c.muted; ctx.font = `700 19px ${FONT}`; ctx.fillText(label.toUpperCase(), 60, y - 10);
    ctx.strokeStyle = c.strong; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(210, y); ctx.lineTo(940, y); ctx.stroke();
  }
  if (bg.date) { ctx.fillStyle = c.ink; ctx.font = `26px ${FONT}`; ctx.fillText(longDate(bg.date), 222, 215 - 10); }
  ctx.fillStyle = c.accent; ctx.font = `700 26px ${FONT}`; ctx.fillText('Notes', 60, MEET.notesTop - 12);
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  for (let y = MEET.notesTop + 44; y <= MEET.notesBottom; y += 44) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(940, y); ctx.stroke(); }
  ctx.fillStyle = c.band; ctx.fillRect(40, MEET.actionsTop - 50, 920, PAGE_H - MEET.actionsTop + 30);
  ctx.fillStyle = c.accent; ctx.font = `700 26px ${FONT}`; ctx.fillText('Action Items', 60, MEET.actionsTop - 12);
  for (let y = MEET.actionsTop + MEET.rowH; y < PAGE_H - 20; y += MEET.rowH) {
    ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(940, y); ctx.stroke();
    ctx.strokeStyle = c.muted; ctx.lineWidth = 1.6; ctx.strokeRect(64, y - 40, 26, 26); ctx.lineWidth = 1;
  }
  ctx.restore();
}
function meetingActionRowY(y) { if (y < MEET.actionsTop) return null; const i = Math.floor((y - MEET.actionsTop) / MEET.rowH); return MEET.actionsTop + (i + 1) * MEET.rowH - 44; }

/* Daily Planner */
const PLAN_TOP = 180, PLAN_BOTTOM = PAGE_H - 30, TIME_COL = 150;
function plannerDefaults() { try { const d = JSON.parse(localStorage.getItem('plannerDefaults')); if (d && d.start && d.end && d.slot) return d; } catch (_) {} return { start: '07:00', end: '21:00', slot: 30 }; }
function plannerSlots(bg) {
  const s = hm(bg.start), e = hm(bg.end), step = +bg.slot, n = Math.max(1, Math.floor((e - s) / step)), h = (PLAN_BOTTOM - PLAN_TOP) / n;
  return Array.from({ length: n }, (_, i) => ({ i, time: mh(s + i * step), y0: PLAN_TOP + i * h, y1: PLAN_TOP + (i + 1) * h, h }));
}
function slotAtY(bg, y) { const sl = plannerSlots(bg); if (y < PLAN_TOP - 10 || y > PLAN_BOTTOM + 10) return null; return sl.find(s => y >= s.y0 && y < s.y1) || (y < PLAN_TOP ? sl[0] : sl[sl.length - 1]); }
function slotForTime(slots, time) { const m = hm(time); let best = slots[0]; for (const s of slots) if (hm(s.time) <= m) best = s; return best; }
function drawPlanner(ctx, bg) {
  const c = tcol(), slots = plannerSlots(bg); ctx.save();
  ctx.fillStyle = c.ink; ctx.font = `700 40px ${FONT}`; ctx.fillText(longDate(bg.date), 60, 92);
  ctx.fillStyle = c.accent; ctx.font = `700 19px ${FONT}`; ctx.fillText('DAILY PLANNER', 60, 132);
  ctx.fillStyle = c.muted; ctx.font = `19px ${FONT}`; ctx.textAlign = 'right';
  ctx.fillText(`${fmt12(bg.start)} – ${fmt12(bg.end)} · ${bg.slot} min`, 940, 132);
  ctx.strokeStyle = c.strong; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(TIME_COL, PLAN_TOP); ctx.lineTo(TIME_COL, PLAN_BOTTOM); ctx.stroke();
  for (const s of slots) {
    const onHour = hm(s.time) % 60 === 0;
    ctx.strokeStyle = onHour ? c.strong : c.line; ctx.lineWidth = onHour ? 1.4 : 1;
    ctx.beginPath(); ctx.moveTo(onHour ? 40 : TIME_COL, s.y0); ctx.lineTo(960, s.y0); ctx.stroke();
    if (onHour || +bg.slot >= 30 || hm(s.time) % 30 === 0) {
      const fs = Math.min(22, Math.max(12, s.h * 0.5));
      ctx.fillStyle = onHour ? c.ink : c.muted; ctx.font = `${onHour ? 600 : 400} ${fs}px ${FONT}`; ctx.textBaseline = 'middle';
      ctx.fillText(fmt12(s.time), TIME_COL - 12, s.y0 + Math.min(s.h / 2, 22));
    }
  }
  ctx.strokeStyle = c.strong; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(40, PLAN_BOTTOM); ctx.lineTo(960, PLAN_BOTTOM); ctx.stroke();
  ctx.restore();
}
// Put a task into a planner slot: position, size, and reminder = slot date + time.
function placeTaskInSlot(pg, t, sl, bg) {
  const step = +bg.slot, keep = t.slot && hm(t.slot.time) >= hm(sl.time) && hm(t.slot.time) < hm(sl.time) + step;
  t.slot = { time: keep ? t.slot.time : sl.time };
  const fs = Math.min(26, sl.h * 0.6); t.fs = fs;
  const due = slotDate(bg.date, t.slot.time).toISOString();
  if (due !== t.due) { t.due = due; t.notified = false; }
  if (t.kind === 'ink') fitInkInSlot(pg, t, sl);
  else { t.x = TIME_COL + 18; t.y = sl.y0 + (sl.h - fs * 1.4) / 2; }
}
function fitInkInSlot(pg, t, sl) {
  const strokes = pg.strokes.filter(s => t.strokeIds.includes(s.id)); if (!strokes.length) return;
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) { const b = bbox(s.points); bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])]; }
  const bw = Math.max(1, bb[2] - bb[0]), bh = Math.max(1, bb[3] - bb[1]);
  const X0 = TIME_COL + 66, sc = Math.min(1, (PAGE_W - X0 - 230) / bw, (sl.h * 0.8) / bh);
  const oy = sl.y0 + (sl.h - bh * sc) / 2;
  for (const s of strokes) { s.points = s.points.map(p => [+(X0 + (p[0] - bb[0]) * sc).toFixed(1), +(oy + (p[1] - bb[1]) * sc).toFixed(1), p[2]]); s.width = +(s.width * Math.max(0.5, sc)).toFixed(2); s.bb = bbox(s.points); }
  t.x = X0 - 6; t.w = bw * sc + 12; t.h = Math.min(sl.h - 4, bh * sc + 8); t.y = sl.y0 + (sl.h - t.h) / 2;
}
function relayoutPlanner(pg) {
  const slots = plannerSlots(pg.bg);
  for (const t of pg.tasks) if (t.slot) placeTaskInSlot(pg, t, slotForTime(slots, t.slot.time), pg.bg);
}

/* ---------- templates: choose when adding a page or creating a note ---------- */
const TEMPLATES = [['lined', '📝 Lined'], ['grid', '▦ Grid'], ['blank', '⬜ Blank'], ['meeting', '👥 Meeting Notes'], ['planner', '🗓 Daily Planner'], ['board', '📋 Project Board'], ['assistant', '🤖 Assistant'], ['recording', '🎙 Meeting Recording']];
function makeTemplatePage(kind, note, date) {
  const p = newPage();
  if (['blank', 'lined', 'grid'].includes(kind)) { p.paper = kind; return p; }
  p.paper = 'blank';
  if (kind === 'meeting') { p.bg = { type: 'template', name: 'meeting', date: date || todayISO() }; if (typeof newRec === 'function') p.rec = newRec(); }
  if (kind === 'recording') { p.bg = { type: 'template', name: 'recording', date: date || todayISO() }; p.rec = newRec(); }
  if (kind === 'board') { p.bg = { type: 'template', name: 'board' }; p.board = newBoard(); }
  if (kind === 'assistant') { p.bg = { type: 'template', name: 'assistant' }; p.assist = { cards: [] }; }
  if (kind === 'planner') {
    const d = plannerDefaults(), last = note && [...note.pages].reverse().find(q => q.bg && q.bg.name === 'planner');
    p.bg = { type: 'template', name: 'planner', date: date || (last ? addDaysISO(last.bg.date, 1) : todayISO()), start: d.start, end: d.end, slot: +d.slot };
  }
  return p;
}
function chooseTemplate(title, extra = []) {
  return new Promise(res => actionSheet(title, [...TEMPLATES, ...extra].map(([k, l]) => ({ label: l, fn: () => res(k) }))));
}
async function newNoteFlow(nbId) {
  const k = await chooseTemplate('New note', [['pdf', '📄 From PDF…']]);
  if (k === 'pdf') { pdfTargetNb = nbId || null; $('#pdfFile').click(); return; }
  createNote(nbId, k);
}
function currentPageIndex() {
  const w = $('#pages').getBoundingClientRect(), line = w.top + w.height * 0.35;
  for (let i = 0; i < pageEls.length; i++) if (pageEls[i].el.getBoundingClientRect().bottom > line) return i;
  return Math.max(0, pageEls.length - 1);
}

/* ---------- generic sheets ---------- */
function modalWrap(id) { let w = document.getElementById(id); if (!w) { w = document.createElement('div'); w.id = id; w.className = 'modal-wrap'; w.hidden = true; document.body.append(w); } return w; }
function formSheet(title, fields, okLabel = 'Save') {
  return new Promise(res => {
    const w = modalWrap('formWrap');
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${fields.map(f => f.type === 'select'
      ? `<label>${esc(f.label)}<select data-k="${f.key}">${f.options.map(([v, l]) => `<option value="${v}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
      : f.type === 'checkbox' ? `<label class="chkrow"><input type="checkbox" data-k="${f.key}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`
      : f.type === 'note' ? `<p class="fine">${f.html}</p>`
      : `<label>${esc(f.label)}<input type="${f.type}" data-k="${f.key}" value="${esc(f.value)}" ${f.step ? `step="${f.step}"` : ''}></label>`).join('')}
      <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div></div>`;
    w.hidden = false;
    const done = v => { w.hidden = true; res(v); };
    w.querySelector('[data-x]').onclick = () => done(null);
    w.onclick = e => { if (e.target === w) done(null); };
    w.querySelector('[data-ok]').onclick = () => { const out = {}; w.querySelectorAll('[data-k]').forEach(i => out[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value); done(out); };
  });
}
function pickSheet(title, items, { grid = false, sub = '' } = {}) {
  return new Promise(res => {
    const w = modalWrap('pickWrap');
    w.innerHTML = `<div class="sheet pick-sheet" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${sub ? `<p class="fine">${sub}</p>` : ''}
      <div class="pick-list ${grid ? 'grid' : ''}">${items.map((it, i) => `<button class="pick-item ${it.cls || ''}" data-i="${i}"><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('')}</div>
      <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-x>Cancel</button></div></div>`;
    w.hidden = false;
    const done = v => { w.hidden = true; res(v); };
    w.querySelector('[data-x]').onclick = () => done(null);
    w.onclick = e => { if (e.target === w) done(null); const b = e.target.closest('[data-i]'); if (b) done(items[+b.dataset.i].value); };
  });
}

/* ---------- planner settings ---------- */
async function plannerSettings() {
  const n = curNote(), pi = currentPageIndex(), pg = n && n.pages[pi], isPlan = pg && pg.bg && pg.bg.name === 'planner';
  const cur = isPlan ? pg.bg : plannerDefaults();
  const slotOpts = [[15, '15 minutes'], [30, '30 minutes'], [60, '60 minutes']];
  const fields = [
    ...(isPlan ? [{ key: 'date', label: 'Date', type: 'date', value: pg.bg.date }] : [{ type: 'note', html: 'These defaults apply to new Daily Planner pages. Open a planner page to change that page.' }]),
    { key: 'start', label: 'Day starts', type: 'time', value: cur.start, step: 900 },
    { key: 'end', label: 'Day ends', type: 'time', value: cur.end, step: 900 },
    { key: 'slot', label: 'Slot length', type: 'select', value: cur.slot, options: slotOpts },
    ...(isPlan ? [{ key: 'def', label: 'Also use for new planner pages', type: 'checkbox', value: true }] : []),
  ];
  const v = await formSheet(isPlan ? `Planner settings — page ${pi + 1}` : 'Planner defaults', fields);
  if (!v) return;
  const slot = +v.slot;
  if (!v.start || !v.end || hm(v.end) - hm(v.start) < slot) { toast('End time must be at least one slot after the start'); return; }
  const def = { start: v.start, end: v.end, slot };
  if (!isPlan || v.def) localStorage.setItem('plannerDefaults', JSON.stringify(def));
  if (isPlan) {
    pushHistory();
    Object.assign(pg.bg, def, v.date ? { date: v.date } : {});
    relayoutPlanner(pg);
    saveNote(n, true); thumbCache.clear(); renderPageInk(pi); renderOverlay(pi); renderAll();
    toast(`Planner: ${fmt12(def.start)} – ${fmt12(def.end)}, ${slot}-min slots`);
  } else toast('Planner defaults saved');
}

/* ---------- lift & move: ONE drag machine for lasso selections, tasks, text boxes, photos/stickers and
   numbered sections. Drop on: a planner slot (schedules), "Send to planner…" (picker), a slot inside an
   on-page list of tasks / sections (Clear-style reorder), or anywhere on any page of the note (move). ---------- */
let carry = null, taskDragSuppress = false, hold = null, liftHide = null, clip = null, selX = null, txtSel = null, txtDrag = null;
const LIST_GAP = 50, SEC_H = 44;
const emptyG = () => ({ strokes: [], tasks: [], texts: [], images: [], sections: [] });
const selGroup = sel => ({ strokes: sel.ids.slice(), tasks: (sel.tasks || []).slice(), texts: (sel.texts || []).slice(), images: (sel.images || []).slice(), sections: (sel.sections || []).slice() });
const pagePt = (e, pi) => { const r = pageEls[pi].el.getBoundingClientRect(); return [(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale]; };
function ensureDragUI() {
  if (!$('#dragGhost')) { const g = document.createElement('div'); g.id = 'dragGhost'; g.hidden = true; document.body.append(g); }
  if (!$('#sendTarget')) { const t = document.createElement('div'); t.id = 'sendTarget'; t.hidden = true; t.innerHTML = '📅 Send to planner…'; document.body.append(t); }
}
// Long-press: the pointer must stay within a few px (Pencil 4 px, finger 8 px) for the whole hold time.
function holdFor(e, fn, ms) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  clearTimeout(hold && hold.timer);
  const pen = e.pointerType === 'pen';
  hold = { pid: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, tol: pen ? 4 : 8 };
  hold.timer = setTimeout(() => { const h = hold; hold = null; if (!h) return; taskDragSuppress = true; fn(h.lx, h.ly, h.pid); }, ms || (pen ? 400 : 350));
}
function taskHoldStart(e, note, pi, taskId) { holdFor(e, (x, y, pid) => startCarry(x, y, pid, { kind: 'task', note, pi, taskId })); }
window.addEventListener('pointermove', e => {
  if (hold && e.pointerId === hold.pid) { if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > hold.tol) { clearTimeout(hold.timer); hold = null; } else { hold.lx = e.clientX; hold.ly = e.clientY; } }
  if (carry && e.pointerId === carry.pid) { carry.x = e.clientX; carry.y = e.clientY; carryMove(); }
  if (selX && e.pointerId === selX.pid) selXMove(e);
  if (txtDrag && e.pointerId === txtDrag.pid) txtDragMove(e);
}, { passive: true });
window.addEventListener('pointerup', e => { if (hold && e.pointerId === hold.pid) { clearTimeout(hold.timer); hold = null; } if (carry && e.pointerId === carry.pid) carryDrop(e.type); if (selX && e.pointerId === selX.pid) selXEnd(); if (txtDrag && e.pointerId === txtDrag.pid) txtDragEnd(); });
window.addEventListener('pointercancel', e => { if (hold && e.pointerId === hold.pid) { clearTimeout(hold.timer); hold = null; } if (carry && e.pointerId === carry.pid) carryDrop('pointercancel'); if (selX && e.pointerId === selX.pid) selXEnd(); if (txtDrag && e.pointerId === txtDrag.pid) txtDragEnd(); });
document.addEventListener('touchmove', e => { if ((carry || imgDrag || selX || txtDrag) && e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener('click', e => { if (taskDragSuppress) { e.stopPropagation(); e.preventDefault(); taskDragSuppress = false; } }, true);

/* geometry of a group, in page units */
function ovRect(pi, id) {
  const rec = pageEls[pi]; if (!rec) return null; const s = S.scale; let r = null;
  rec.ov.querySelectorAll(`[data-id="${id}"]`).forEach(el => {
    const x0 = el.offsetLeft / s, y0 = el.offsetTop / s, x1 = x0 + el.offsetWidth / s, y1 = y0 + el.offsetHeight / s;
    r = r ? [Math.min(r[0], x0), Math.min(r[1], y0), Math.max(r[2], x1), Math.max(r[3], y1)] : [x0, y0, x1, y1];
  });
  return r;
}
function strokesBB(pg, ids) {
  let bb = null;
  for (const s of pg.strokes) if (ids.includes(s.id)) { const b = s.bb || bbox(s.points), w = s.width / 2 + 1; bb = bb ? [Math.min(bb[0], b[0] - w), Math.min(bb[1], b[1] - w), Math.max(bb[2], b[2] + w), Math.max(bb[3], b[3] + w)] : [b[0] - w, b[1] - w, b[2] + w, b[3] + w]; }
  return bb;
}
function taskRect(pi, t) {        // model coordinates for the top (exact), DOM for the extent
  const r = ovRect(pi, t.id);
  if (t.kind === 'ink') return [Math.max(0, t.x - 44), t.y, t.x + t.w, Math.max(t.y + t.h, r ? r[3] : 0)];
  const w = r ? r[2] - r[0] : 320, h = r ? r[3] - r[1] : (t.fs || 26) * 1.4; return [t.x, t.y, t.x + w, t.y + h];
}
function groupBB(pi, G, domToo = true) {
  const pg = curNote().pages[pi]; let bb = strokesBB(pg, G.strokes);
  const add = r => { if (r) bb = bb ? [Math.min(bb[0], r[0]), Math.min(bb[1], r[1]), Math.max(bb[2], r[2]), Math.max(bb[3], r[3])] : r.slice(); };
  for (const im of pg.images || []) if (G.images.includes(im.id)) add([im.x, im.y, im.x + im.w, im.y + im.h]);
  if (domToo) {
    for (const t of pg.tasks) if (G.tasks.includes(t.id)) add(taskRect(pi, t));
    for (const id of [...G.texts, ...G.sections]) add(ovRect(pi, id));
  }
  return bb;
}
function groupCanvas(pg, G, bb, s) {
  const w = Math.max(1, (bb[2] - bb[0]) * s), h = Math.max(1, (bb[3] - bb[1]) * s);
  let d = Math.min(2, devicePixelRatio || 1); if (w * h * d * d > 4e6) d = Math.sqrt(4e6 / (w * h));
  const c = document.createElement('canvas'); c.width = Math.ceil(w * d); c.height = Math.ceil(h * d); c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d'); ctx.setTransform(s * d, 0, 0, s * d, -bb[0] * s * d, -bb[1] * s * d);
  drawPageImages(ctx, { images: (pg.images || []).filter(i => G.images.includes(i.id)) });
  const st = pg.strokes.filter(x => G.strokes.includes(x.id));
  for (const x of st) if (x.tool === 'highlighter') drawStroke(ctx, x);
  for (const x of st) if (x.tool !== 'highlighter') drawStroke(ctx, x);
  return c;
}
function buildGhost(pi, G, bb) {
  const pg = curNote().pages[pi], s = S.scale, box = document.createElement('div');
  box.style.cssText = `position:relative;width:${(bb[2] - bb[0]) * s}px;height:${(bb[3] - bb[1]) * s}px`;
  if (G.strokes.length || G.images.length) { const c = groupCanvas(pg, G, bb, s); c.style.position = 'absolute'; c.style.left = c.style.top = '0'; box.append(c); }
  for (const id of [...G.tasks, ...G.texts, ...G.sections]) pageEls[pi].ov.querySelectorAll(`[data-id="${id}"]`).forEach(el => {
    const k = el.cloneNode(true); k.classList.remove('lift-hidden', 'slide', 'flash', 'pop'); k.removeAttribute('contenteditable'); k.style.transform = '';
    k.style.left = (el.offsetLeft - bb[0] * s) + 'px'; k.style.top = (el.offsetTop - bb[1] * s) + 'px'; box.append(k);
  });
  return box;
}
// While lifted, the originals are hidden (canvas content via liftHide in drawPageContent; DOM via .lift-hidden).
function setLiftHide(pi, G, extra = emptyG()) {
  const pg = curNote().pages[pi];
  liftHide = { pg: pg.id, strokes: new Set([...G.strokes, ...extra.strokes]), images: new Set([...G.images, ...extra.images]), ids: new Set([...G.tasks, ...G.texts, ...G.sections]) };
  renderPageInk(pi); applyLiftHide(pi);
}
function applyLiftHide(pi) {
  const rec = pageEls[pi]; if (!rec) return; const pg = curNote().pages[pi], on = !!(liftHide && liftHide.pg === pg.id);
  rec.ov.querySelectorAll('[data-id]').forEach(el => el.classList.toggle('lift-hidden', on && liftHide.ids.has(el.dataset.id)));
  rec.ov.querySelectorAll('.ink-label').forEach(el => { const l = (pg.labels || []).find(q => q.id === el.dataset.label); el.classList.toggle('lift-hidden', !!(on && l && l.strokeIds.some(id => liftHide.strokes.has(id)))); });
}
function clearLiftHide() { const h = liftHide; liftHide = null; if (!h) return; const pi = curNote().pages.findIndex(p => p.id === h.pg); if (pi >= 0) { renderPageInk(pi); applyLiftHide(pi); } }

/* on-page lists: tasks stacked in one column (gap ≤ ~1 line), and numbered sections */
function taskColX(pi, t) {
  const el = pageEls[pi].ov.querySelector(`.task[data-id="${t.id}"] .chk`);
  return el ? (el.parentElement.offsetLeft + el.offsetLeft) / S.scale : (t.kind === 'ink' ? Math.max(0, t.x - 44) : t.x);
}
function taskList(pg, pi, id) {
  const items = pg.tasks.map(t => ({ t, id: t.id, r: taskRect(pi, t), cx: taskColX(pi, t) }));
  const me = items.find(i => i.id === id); if (!me) return null;
  const col = items.filter(i => Math.abs(i.cx - me.cx) <= 40).sort((a, b) => a.r[1] - b.r[1]);
  let lo = col.indexOf(me), hi = lo;
  while (lo > 0 && col[lo].r[1] - col[lo - 1].r[3] <= LIST_GAP) lo--;
  while (hi < col.length - 1 && col[hi + 1].r[1] - col[hi].r[3] <= LIST_GAP) hi++;
  const m = col.slice(lo, hi + 1); if (m.length < 2) return null;
  const members = m.map(i => ({ id: i.id, G: { ...emptyG(), strokes: i.t.kind === 'ink' ? i.t.strokeIds.slice() : [], tasks: [i.id] }, top: i.r[1], h: i.r[3] - i.r[1], r: i.r }));
  return { kind: 'tasks', pi, members, me: members[m.indexOf(me)], gaps: members.slice(1).map((x, j) => x.top - (members[j].top + members[j].h)),
    x0: Math.min(...m.map(i => i.r[0])), x1: Math.max(...m.map(i => i.r[2])), top: members[0].top, bottom: Math.max(...m.map(i => i.r[3])),
    uniform: members.every(x => Math.abs(x.h - members[0].h) <= 3) };
}
function inListZone(L, p) { return p[0] >= L.x0 - 90 && p[0] <= L.x1 + 90 && p[1] >= L.top - 70 && p[1] <= L.bottom + 70; }
function layoutList(L, k) {
  const order = L.members.filter(m => m !== L.me); order.splice(k, 0, L.me);
  const map = new Map();
  if (L.uniform) { order.forEach((m, j) => map.set(m, L.members[j].top)); return map; }   // same-size rows: permute the line slots exactly
  let y = L.members[0].top;
  order.forEach((m, j) => { map.set(m, y); y += m.h + (L.gaps[j] || 0); });
  return map;
}
function listIndexFor(L, meTop) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < L.members.length; k++) { const d = Math.abs(layoutList(L, k).get(L.me) - meTop); if (d < bd) { bd = d; best = k; } }
  return best;
}
function buildTiles(L) {
  const rec = pageEls[L.pi], pg = curNote().pages[L.pi], s = S.scale, layer = document.createElement('div');
  layer.className = 'tile-layer'; rec.el.append(layer); L.layer = layer;
  for (const m of L.members) {
    m.els = []; if (m === L.me) continue;
    const bb = groupBB(L.pi, m.G, false);
    if (bb) { const c = groupCanvas(pg, m.G, bb, s); c.className = 'tile'; c.style.left = bb[0] * s + 'px'; c.style.top = bb[1] * s + 'px'; layer.append(c); m.els.push(c); }
    for (const id of [...m.G.tasks, ...m.G.texts, ...m.G.sections]) rec.ov.querySelectorAll(`[data-id="${id}"]`).forEach(el => { el.classList.add('slide'); m.els.push(el); });
  }
}
function updateTiles(L, k) { const map = layoutList(L, k), s = S.scale; for (const m of L.members) { if (m === L.me) continue; const dy = map.get(m) - m.top; for (const el of m.els) el.style.transform = Math.abs(dy) > .5 ? `translateY(${dy * s}px)` : ''; } }
function clearTiles(L) { if (L.layer) L.layer.remove(); for (const m of L.members) for (const el of m.els || []) { el.style.transform = ''; el.classList.remove('slide'); } }

function startCarry(x, y, pid, P) {
  ensureDragUI(); flushSettle();
  const n = P.note, pi = P.pi, pg = n.pages[pi];
  if (P.kind === 'task') { const t = pg.tasks.find(q => q.id === P.taskId); if (!t) { taskDragSuppress = false; return; } P.G = { ...emptyG(), strokes: t.kind === 'ink' ? t.strokeIds.slice() : [], tasks: [t.id] }; }
  if (P.kind === 'image') P.G = { ...emptyG(), images: [P.id] };
  if (P.kind === 'text') P.G = { ...emptyG(), texts: [P.id] };
  if (P.kind === 'section') P.G = sectionGroup(pg, P.id);
  if (P.kind === 'sel') {         // a selection that is exactly one task (+ its own ink) behaves like that task
    const G = P.G, t = G.tasks.length === 1 && !G.texts.length && !G.images.length && !G.sections.length && pg.tasks.find(q => q.id === G.tasks[0]);
    const own = t ? (t.kind === 'ink' ? t.strokeIds : []) : null;
    if (t && G.strokes.length === own.length && G.strokes.every(id => own.includes(id))) { P.kind = 'task'; P.taskId = t.id; P.wasSel = true; }
  }
  P.ids = P.G.strokes;
  const bb = groupBB(pi, P.G); if (!bb) { taskDragSuppress = false; return; }
  const s = S.scale, r = pageEls[pi].el.getBoundingClientRect();
  P.bb = bb; P.start = [(x - r.left) / s, (y - r.top) / s]; P.grab = [P.start[0] - bb[0], P.start[1] - bb[1]];
  if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('textblock')) document.activeElement.blur();
  imgSel = null; txtSel = null; pageEls[pi].ov.querySelectorAll('.img-sel, .sel-box').forEach(e => e.remove());   // never rebuild the overlay mid-gesture
  clearLive(pageEls[pi]);
  const g = $('#dragGhost'); g.className = 'lift'; g.innerHTML = ''; g.style.transition = '';
  const inner = buildGhost(pi, P.G, bb); inner.className = 'ghost-inner'; inner.style.transformOrigin = `${P.grab[0] * s}px ${P.grab[1] * s}px`;
  g.append(inner); g.hidden = false;
  $('#sendTarget').hidden = !(P.kind === 'task' || (P.kind === 'sel' && P.G.strokes.length));
  $('#lassoMenu').hidden = true;
  const c = carry = { pid, x, y, payload: P, target: null };
  c.list = P.kind === 'task' ? taskList(pg, pi, P.taskId) : P.kind === 'section' ? sectionList(pg, pi, P.id) : null;
  const extra = emptyG(); if (c.list) for (const m of c.list.members) if (m !== c.list.me) { extra.strokes.push(...m.G.strokes); extra.images.push(...m.G.images); }
  if (c.list) { c.list.off = c.list.me.top - bb[1]; buildTiles(c.list); c.lastK = c.list.members.indexOf(c.list.me); }
  setLiftHide(pi, P.G, extra);
  document.body.classList.add('carrying');
  requestAnimationFrame(() => g.classList.add('up'));
  try { navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive) && navigator.vibrate(8); } catch (_) {}
  carryMove(); carryLoop();
}
function carryLoop() {
  if (!carry) return;
  const w = $('#pages'), r = w.getBoundingClientRect(), y = carry.y;
  if (y < r.top + 70 && y > r.top - 40) w.scrollTop -= Math.ceil((r.top + 70 - y) / 4);
  else if (y > r.bottom - 70 && y < r.bottom + 40) w.scrollTop += Math.ceil((y - r.bottom + 70) / 4);
  carryMove();
  carry.raf = requestAnimationFrame(carryLoop);
}
function clearSlotHL() { document.querySelectorAll('.slot-hl').forEach(e => e.remove()); }
function carryMove() {
  const c = carry; if (!c) return;
  const P = c.payload, s = S.scale, g = $('#dragGhost'), st = $('#sendTarget');
  g.style.transform = `translate(${c.x - P.grab[0] * s}px, ${c.y - P.grab[1] * s}px)`;
  let target = null;
  const els = document.elementsFromPoint(c.x, c.y);
  if (!st.hidden && els.includes(st)) target = { type: 'send' };
  else {
    const pageEl = els.find(e => e.classList && e.classList.contains('page'));
    if (pageEl && isBoardPage(curNote().pages[+pageEl.dataset.pi])) target = boardCarryTarget(c, +pageEl.dataset.pi, els);   // v13: ink → new card
    else if (pageEl) {
      const pi = +pageEl.dataset.pi, pg = curNote().pages[pi], r = pageEl.getBoundingClientRect(), p = [(c.x - r.left) / s, (c.y - r.top) / s];
      const G = P.G, plannable = P.kind === 'task' || (P.kind === 'sel' && G.strokes.length && !G.tasks.length && !G.texts.length && !G.images.length && !G.sections.length);
      if (plannable && pg.bg && pg.bg.name === 'planner') { const sl = slotAtY(pg.bg, p[1]); if (sl) target = { type: 'slot', pi, slot: sl }; }
      const L = c.list;
      if (!target && L && pi === L.pi && (L.kind === 'sections' || inListZone(L, p))) target = { type: 'list', pi, k: listIndexFor(L, p[1] - P.grab[1] + L.off) };
      if (!target) target = { type: 'move', pi, p };
    }
  }
  st.classList.toggle('hot', !!(target && target.type === 'send'));
  const key = target && target.type === 'slot' ? target.pi + ':' + target.slot.i : '';
  if (key !== (c.hlKey || '')) {
    clearSlotHL(); c.hlKey = key;
    if (key) {
      const d = document.createElement('div'); d.className = 'slot-hl';
      Object.assign(d.style, { left: TIME_COL * s + 'px', top: target.slot.y0 * s + 'px', width: (960 - TIME_COL) * s + 'px', height: target.slot.h * s + 'px' });
      d.innerHTML = `<span>${fmt12(target.slot.time)}</span>`; pageEls[target.pi].ov.append(d);
    }
  }
  if (c.list) { const k = target && target.type === 'list' ? target.k : c.list.members.indexOf(c.list.me); if (k !== c.lastK) { c.lastK = k; updateTiles(c.list, k); } }
  c.target = target;
}
function translateGroup(n, si, di, G, dx, dy) {
  const src = n.pages[si], dst = n.pages[di];
  const mv = key => { for (const o of [...(src[key] || [])]) if (G[key === 'texts' ? 'texts' : key].includes(o.id)) { o.x += dx; o.y += dy; if (src !== dst) { src[key] = src[key].filter(q => q !== o); (dst[key] ||= []).push(o); } } };
  moveStrokes(src, dst, G.strokes, dx, dy);
  mv('images'); mv('texts'); mv('sections');
  for (const t of [...src.tasks]) if (G.tasks.includes(t.id)) {
    t.x += dx; t.y += dy;
    if (src !== dst) { src.tasks = src.tasks.filter(q => q !== t); dst.tasks.push(t); }
    if (t.slot && !(dst.bg && dst.bg.name === 'planner')) { delete t.slot; delete t.fs; }
  }
}
function commitMove(P, dpi, p) {
  const w = P.bb[2] - P.bb[0], h = P.bb[3] - P.bb[1];
  const ox = Math.max(-w / 2, Math.min(PAGE_W - w / 2, p[0] - P.grab[0])), oy = Math.max(-h / 2, Math.min(PAGE_H - h / 2, p[1] - P.grab[1]));
  const dx = ox - P.bb[0], dy = oy - P.bb[1];
  if (dpi === P.pi && Math.hypot(dx, dy) < 2) return null;
  pushHistory(); translateGroup(P.note, P.pi, dpi, P.G, dx, dy); saveNote(P.note, true); thumbCache.clear();
  return [ox, oy];
}
function carryDrop(type) {
  const c = carry; carry = null; cancelAnimationFrame(c.raf);
  $('#sendTarget').hidden = true; $('#sendTarget').classList.remove('hot'); clearSlotHL();
  document.body.classList.remove('carrying');
  setTimeout(() => { taskDragSuppress = false; }, 400);
  const P = c.payload, n = P.note, t = type === 'pointercancel' ? null : c.target;
  let dst = null;
  if (t && t.type === 'list') {
    const L = c.list, map = layoutList(L, t.k);
    if (L.members.some(m => Math.abs(map.get(m) - m.top) > .5)) {
      pushHistory();
      for (const m of L.members) { const dy = map.get(m) - m.top; if (Math.abs(dy) > .5) translateGroup(n, P.pi, P.pi, m.G, 0, dy); }
      saveNote(n, true); thumbCache.clear();
      dst = [P.pi, [P.bb[0], P.bb[1] + map.get(L.me) - L.me.top]];
    }
  } else if (t && t.type === 'move') { const o = commitMove(P, t.pi, t.p); if (o) dst = [t.pi, o]; }
  if (c.list) clearTiles(c.list);
  clearBoardCarry();
  if (t && (t.type === 'send' || t.type === 'slot' || t.type === 'board')) {
    $('#dragGhost').hidden = true; $('#dragGhost').className = ''; liftHide = null;
    renderPageInk(P.pi); renderOverlay(P.pi);
    if (t.type === 'board') { cardFromInk({ note: n, pi: P.pi, ids: P.G.strokes.slice() }, n, t.pi, t.col, true); return; }
    if (t.type === 'send') openPlannerPicker(P); else scheduleToSlot(P, curNote(), t.pi, t.slot);
    return;
  }
  settle(P, dst || [P.pi, [P.bb[0], P.bb[1]]], !!dst);
}
// Drop: the ghost glides to its final spot and bounces; the committed content is revealed underneath.
let settling = null;
function settle(P, [pi, o], moved) {
  const n = curNote(), g = $('#dragGhost');
  if (liftHide) liftHide.pg = n.pages[pi].id;
  if (P.kind === 'section' || P.G.sections.length) rerenderOverlays(); else for (const i of new Set([P.pi, pi])) { renderPageInk(i); renderOverlay(i); }
  if (liftHide) for (const i of new Set([P.pi, pi])) { renderPageInk(i); applyLiftHide(i); }
  const r = pageEls[pi].el.getBoundingClientRect(), s = S.scale;
  g.style.transition = 'transform .16s cubic-bezier(.2,.8,.3,1)';
  g.style.transform = `translate(${r.left + o[0] * s}px, ${r.top + o[1] * s}px)`;
  g.classList.remove('up'); g.classList.add('drop');
  const finish = () => {
    settling = null; g.hidden = true; g.className = ''; g.style.transition = '';
    clearLiftHide(); renderOverlay(pi);
    if (P.kind === 'sel' || P.wasSel) setSelection(pi, P.G);
    else if (P.kind === 'image') selectImage(pi, P.id);
    else if (P.kind === 'text') { txtSel = { pi, id: P.id }; renderOverlay(pi); }
    if (moved && (P.kind === 'task')) renderAll();
  };
  settling = { t: setTimeout(finish, 330), finish };
}
function flushSettle() { if (settling) { clearTimeout(settling.t); settling.finish(); } }
function rerenderOverlays() { for (let i = 0; i < pageEls.length; i++) if (pageEls[i].alive) { renderPageInk(i); renderOverlay(i); } }

function moveStrokes(src, dst, ids, dx, dy) {
  const mv = src.strokes.filter(s => ids.includes(s.id));
  for (const s of mv) { if (dx || dy) { s.points = s.points.map(p => [+(p[0] + dx).toFixed(1), +(p[1] + dy).toFixed(1), p[2]]); } s.bb = bbox(s.points); }
  if (src !== dst) { src.strokes = src.strokes.filter(s => !ids.includes(s.id)); dst.strokes.push(...mv); }
  for (const l of [...(src.labels || [])]) if (l.strokeIds.length && l.strokeIds.every(id => ids.includes(id))) { l.x += dx; l.y += dy; if (src !== dst) { src.labels = src.labels.filter(q => q !== l); (dst.labels ||= []).push(l); } }
  return mv;
}
function scheduleToSlot(p, dstNote, dstPi, sl) {
  const srcNote = p.note, src = srcNote.pages[p.pi], dst = dstNote.pages[dstPi], bg = dst.bg;
  if (!bg || bg.name !== 'planner') return null;
  if (srcNote.id === S.cur || dstNote.id === S.cur) pushHistory();
  let t;
  if (p.kind === 'task') {
    t = src.tasks.find(x => x.id === p.taskId); if (!t) return null;
    src.tasks = src.tasks.filter(x => x !== t);
    if (t.kind === 'ink') moveStrokes(src, dst, t.strokeIds, 0, 0);
  } else {
    moveStrokes(src, dst, p.ids, 0, 0);
    t = { id: uid('t'), kind: 'ink', x: 0, y: 0, w: 0, h: 0, strokeIds: p.ids.slice(), text: '', done: false, due: null, repeat: '', notified: false, createdAt: Date.now() };
  }
  t.slot = null; t.done = false;
  placeTaskInSlot(dst, t, sl, bg);
  dst.tasks.push(t);
  thumbCache.clear(); hideLasso();
  saveNote(srcNote, true); if (dstNote !== srcNote) saveNote(dstNote, true);
  if (srcNote.id === S.cur || dstNote.id === S.cur) for (let i = 0; i < pageEls.length; i++) { renderPageInk(i); renderOverlay(i); }
  renderAll();
  toast(`📅 Scheduled ${fmtDue(t.due)} · ${dstNote.title}`, 3200);
  if (dstNote.id === S.cur) requestAnimationFrame(() => pageEls[dstPi] && pageEls[dstPi].ov.querySelectorAll(`[data-id="${t.id}"]`).forEach(el => el.classList.add('flash')));
  return t;
}

async function openPlannerPicker(p) {
  const list = [];
  for (const n of S.notes) n.pages.forEach((pg, i) => { if (pg.bg && pg.bg.name === 'planner') list.push({ n, i, date: pg.bg.date }); });
  list.sort((a, b) => a.date.localeCompare(b.date) || a.n.title.localeCompare(b.n.title));
  const today = todayISO();
  const items = list.map(x => ({ label: (x.date === today ? '☀️ Today · ' : '🗓 ') + longDate(x.date), sub: `${x.n.title} · page ${x.i + 1}`, value: x, cls: x.date === today ? 'today' : '' }));
  items.push({ label: '＋ New planner page for today', sub: `Adds a page to “${curNote().title}”`, value: 'new' });
  const ch = await pickSheet('Send to which planner?', items);
  if (!ch) { if (p.kind === 'sel' && selection) $('#lassoMenu').hidden = false; return; }
  let dst = ch;
  if (ch === 'new') { const n = curNote(); n.pages.push(makeTemplatePage('planner', n, today)); saveNote(n, true); buildPages(); dst = { n, i: n.pages.length - 1 }; }
  const pg = dst.n.pages[dst.i], slots = plannerSlots(pg.bg);
  const used = new Map(); for (const t of pg.tasks) if (t.slot) { const s = slotForTime(slots, t.slot.time); used.set(s.i, (used.get(s.i) || 0) + 1); }
  const sl = await pickSheet(longDate(pg.bg.date), slots.map(s => ({ label: fmt12(s.time), sub: used.get(s.i) ? '●'.repeat(Math.min(3, used.get(s.i))) : '', value: s, cls: used.get(s.i) ? 'busy' : '' })), { grid: true, sub: 'Pick a time slot. The reminder is set to that time.' });
  if (!sl) return;
  return scheduleToSlot(p, dst.n, dst.i, sl);
}

/* ---------- lasso: image hit / selection drag; photos & stickers ---------- */
let imgSel = null, imgDrag = null;
function hitImage(pi, p) { const imgs = curNote().pages[pi].images || []; for (let i = imgs.length - 1; i >= 0; i--) { const m = imgs[i]; if (p[0] >= m.x && p[0] <= m.x + m.w && p[1] >= m.y && p[1] <= m.y + m.h) return m; } return null; }
function v7LassoDown(e, pi) {
  const rec = pageEls[pi], r = rec.el.getBoundingClientRect(), p = [(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale];
  if (selection && selection.pi === pi) {
    const [x0, y0, x1, y1] = selection.bb;
    if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) { e.preventDefault(); startCarry(e.clientX, e.clientY, e.pointerId, { kind: 'sel', note: curNote(), pi, G: selGroup(selection) }); return true; }
  }
  const im = hitImage(pi, p);
  if (im) { e.preventDefault(); hideLasso(); selectImage(pi, im.id); startImgDrag(e, pi, im, 'move', p); return true; }
  if (imgSel) deselectImage();
  return false;
}
function selectImage(pi, id) { const old = imgSel; imgSel = { pi, id }; if (old && old.pi !== pi) renderOverlay(old.pi); renderOverlay(pi); }
function deselectImage() { const old = imgSel; imgSel = null; if (old && pageEls[old.pi]) renderOverlay(old.pi); }
function renderImgSel(pi) {
  if (!imgSel || imgSel.pi !== pi || carry) return;
  const pg = curNote().pages[pi], im = (pg.images || []).find(m => m.id === imgSel.id); if (!im) { imgSel = null; return; }
  const s = S.scale, d = document.createElement('div'); d.className = 'img-sel'; d.dataset.img = im.id;
  Object.assign(d.style, { left: im.x * s + 'px', top: im.y * s + 'px', width: im.w * s + 'px', height: im.h * s + 'px' });
  d.innerHTML = `<button class="img-del" aria-label="Delete">✕</button><span class="img-knob" aria-label="Resize"></span>`;
  d.querySelector('.img-del').addEventListener('pointerdown', ev => ev.stopPropagation());
  d.querySelector('.img-del').onclick = ev => { ev.stopPropagation(); pushHistory(); pg.images = pg.images.filter(m => m !== im); imgSel = null; saveNote(curNote()); renderPageInk(pi); renderOverlay(pi); toast('Removed'); };
  d.querySelector('.img-knob').addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); const r = pageEls[pi].el.getBoundingClientRect(); startImgDrag(ev, pi, im, 'resize', [(ev.clientX - r.left) / s, (ev.clientY - r.top) / s]); });
  d.addEventListener('pointerdown', ev => { if (ev.target !== d) return; ev.stopPropagation(); ev.preventDefault(); const r = pageEls[pi].el.getBoundingClientRect(); startImgDrag(ev, pi, im, 'move', [(ev.clientX - r.left) / s, (ev.clientY - r.top) / s]); });
  pageEls[pi].ov.append(d);
}
function startImgDrag(e, pi, im, mode, p) {
  pushHistory();
  imgDrag = { pid: e.pointerId, pi, im, mode, start: p, ox: im.x, oy: im.y, ow: im.w, oh: im.h };
}
let imgRaf = 0;
window.addEventListener('pointermove', e => {
  const d = imgDrag; if (!d || e.pointerId !== d.pid) return;
  const r = pageEls[d.pi].el.getBoundingClientRect(), p = [(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale];
  const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
  if (d.mode === 'move') { d.im.x = Math.max(-d.ow / 2, Math.min(PAGE_W - d.ow / 2, d.ox + dx)); d.im.y = Math.max(-d.oh / 2, Math.min(PAGE_H - d.oh / 2, d.oy + dy)); }
  else { const w = Math.max(40, Math.min(PAGE_W * 1.2, d.ow + Math.max(dx, dy * d.ow / d.oh))); d.im.w = w; d.im.h = w * d.oh / d.ow; }
  d.moved = true;
  if (!imgRaf) imgRaf = requestAnimationFrame(() => { imgRaf = 0; if (!imgDrag) return; renderPageInk(imgDrag.pi); const el = pageEls[imgDrag.pi].ov.querySelector('.img-sel'), s = S.scale, m = imgDrag.im; if (el) Object.assign(el.style, { left: m.x * s + 'px', top: m.y * s + 'px', width: m.w * s + 'px', height: m.h * s + 'px' }); });
}, { passive: true });
function endImgDrag(e) {
  const d = imgDrag; if (!d || e.pointerId !== d.pid) return; imgDrag = null;
  if (!d.moved) S.undo.pop(), updateUndo();
  saveNote(curNote()); renderPageInk(d.pi); renderOverlay(d.pi);
}
window.addEventListener('pointerup', endImgDrag); window.addEventListener('pointercancel', endImgDrag);

async function compressImage(file, max = 1600, q = 0.82) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
  const k = Math.min(1, max / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(src, 0, 0, w, h);
  return { blob: await canvasBlob(c, 'image/jpeg', q), w, h };
}
function visibleCenter(pi) {
  const w = $('#pages').getBoundingClientRect(), r = pageEls[pi].el.getBoundingClientRect();
  const cy = (Math.max(w.top, r.top) + Math.min(w.bottom, r.bottom)) / 2, cx = (Math.max(w.left, r.left) + Math.min(w.right, r.right)) / 2;
  return [(cx - r.left) / S.scale, (cy - r.top) / S.scale];
}
function insertOnPage(item) {
  const n = curNote(), pi = currentPageIndex(), pg = n.pages[pi], [cx, cy] = visibleCenter(pi);
  item.x = Math.max(10, Math.min(PAGE_W - item.w - 10, cx - item.w / 2)); item.y = Math.max(10, Math.min(PAGE_H - item.h - 10, cy - item.h / 2));
  pushHistory(); (pg.images ||= []).push(item); saveNote(n, true);
  selectTool('lasso'); imgSel = { pi, id: item.id }; renderPageInk(pi); renderOverlay(pi);
  hint('Drag to move · corner to resize · ✕ to delete');
  return item;
}
async function insertPhotoFile(file) {
  if (!file) return;
  try {
    const { blob, w, h } = await compressImage(file);
    const asset = await Assets.put(blob), W = 520, H = W * h / w;
    await Assets.ready(asset);
    return insertOnPage({ id: uid('i'), kind: 'photo', asset, w: W, h: Math.min(H, PAGE_H * 0.8), pw: w, ph: h });
  } catch (err) { toast('Could not read that image'); }
}
const STICKERS = ['⭐', '🌟', '✨', '✅', '✔️', '❌', '❗', '‼️', '❓', '⚠️', '🚩', '🏁', '🔴', '🟠', '🟡', '🟢', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↩️', '🔁', '💡', '📌', '📎', '🎯', '🔥', '❤️', '👍', '👀', '🎉', '📅', '⏰', '☕', '🧠'];
async function stickerPicker() {
  const e = await pickSheet('Stickers', STICKERS.map(s => ({ label: s, value: s, cls: 'sticker' })), { grid: true });
  if (e) insertOnPage({ id: uid('i'), kind: 'sticker', emoji: e, w: 120, h: 120 });
}

/* ---------- PDF import (pdf.js, vendored for offline) ---------- */
let pdfjsP = null, pdfTargetNb = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import(new URL('vendor/pdfjs/pdf.min.mjs', location.href).href).then(m => { m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href; return m; });
  return pdfjsP;
}
async function importPdf(file, nbId) {
  if (!file) return;
  toast('Importing PDF…', 60000);
  try {
    const pdfjs = await loadPdfjs(), buf = await file.arrayBuffer();
    const src = await Assets.put(new Blob([buf], { type: 'application/pdf' }));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    const n = makeNote(nbId || (curNote() && curNote().notebookId) || sortedNotebooks()[0].id, (file.name || 'PDF').replace(/\.pdf$/i, '') || 'PDF');
    n.pages = []; n.paper = 'blank';
    const max = Math.min(doc.numPages, 300);
    for (let i = 1; i <= max; i++) {
      const page = await doc.getPage(i), vp1 = page.getViewport({ scale: 1 }), scale = Math.min(3, 1600 / vp1.width), vp = page.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
      const asset = await Assets.put(await canvasBlob(c, 'image/jpeg', 0.86));
      const pg = newPage(); pg.paper = 'blank'; pg.bg = { type: 'pdf', asset, src, page: i, aspect: vp1.height / vp1.width };
      n.pages.push(pg); page.cleanup && page.cleanup();
      toast(`Importing PDF… page ${i} of ${max}`, 60000);
    }
    doc.destroy && doc.destroy();
    n.order = -1; S.notes.push(n); saveNote(n, true); normalizeOrder(); openNote(n.id);
    toast(`Imported ${max} page${max > 1 ? 's' : ''} — write on top`);
    return n;
  } catch (err) { console.warn(err); toast('Could not open that PDF'); }
}

/* ---------- PDF export (renders each page; tiny built-in PDF writer) ---------- */
let renderLight = false;
function drawOverlaysForExport(ctx, pg, note) {
  if (isBoardPage(pg)) { drawBoardExport(ctx, pg); return; }
  if (pg.assist) drawAssistExport(ctx, pg);
  if (pg.rec && typeof drawRecExport === 'function') drawRecExport(ctx, pg);
  ctx.save(); ctx.textBaseline = 'alphabetic';
  for (const sc of pg.sections || []) {
    const label = secNumber(note, pg, sc) + (sc.style || '.'); ctx.font = `800 28px ${FONT}`; const w = Math.max(SEC_H, ctx.measureText(label).width + 18);
    ctx.fillStyle = '#4f46e5'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(sc.x, sc.y, w, SEC_H, 10) : ctx.rect(sc.x, sc.y, w, SEC_H); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, sc.x + w / 2, sc.y + SEC_H * 0.7); ctx.textAlign = 'left';
  }
  for (const tb of pg.texts) {
    const size = tb.size || 24; ctx.fillStyle = inkColor(tb.color || INK); ctx.font = `${size}px ${FONT}`;
    String(tb.text).split('\n').forEach((line, i) => ctx.fillText(line, tb.x + 4, tb.y + size * (1.05 + i * 1.35)));
  }
  for (const t of pg.tasks) {
    const fs = t.fs || 26, bx = t.kind === 'ink' ? (t.x - 44 >= 0 ? t.x - 44 : t.x + 6) : t.x, by = t.kind === 'ink' ? t.y + Math.min(t.h / 2, 40) - 17 : t.y + fs * 0.05, b = fs * 1.35;
    if (t.kind === 'ink') { ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(79,70,229,.55)'; ctx.lineWidth = 2; ctx.strokeRect(t.x, t.y, t.w, t.h); ctx.restore(); }
    ctx.lineWidth = fs * 0.13; ctx.strokeStyle = t.done ? '#22a55a' : '#4f46e5'; ctx.fillStyle = t.done ? '#22a55a' : 'rgba(0,0,0,0)';
    ctx.beginPath(); ctx.rect(bx, by, b, b); if (t.done) ctx.fill(); ctx.stroke();
    if (t.done) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(bx + b * .22, by + b * .52); ctx.lineTo(bx + b * .42, by + b * .72); ctx.lineTo(bx + b * .8, by + b * .3); ctx.stroke(); }
    ctx.fillStyle = inkColor(t.color || INK); ctx.font = `500 ${fs}px ${FONT}`;
    const label = t.kind === 'ink' ? (t.text || '') : (t.text || 'Task'); let x = t.kind === 'ink' ? t.x + t.w + 10 : bx + b + fs * 0.35;
    const ty = t.kind === 'ink' ? t.y + t.h / 2 + fs * 0.35 : by + b * 0.78;
    if (label) { ctx.fillText(label, x, ty); x += ctx.measureText(label).width + fs * 0.4; }
    if (t.due) { ctx.fillStyle = '#6e6e76'; ctx.font = `700 ${fs * 0.7}px ${FONT}`; ctx.fillText('⏰ ' + fmtDue(t.due), x, ty); }
  }
  ctx.restore();
}
function buildPdf(pages, PW = 612, PH = Math.round(612 * PAGE_H / PAGE_W)) {
  const enc = new TextEncoder(), chunks = [], offsets = []; let len = 0;
  const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const N = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${N} /Kids [${kids}] >>`));
  pages.forEach((p, i) => {
    const pn = 3 + i * 3, cn = pn + 1, im = pn + 2, content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    obj(pn, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`));
    obj(cn, () => { push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); });
    obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
  });
  const xref = len, total = 3 + N * 3;
  push(`xref\n0 ${total}\n0000000000 65535 f \n` + offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
async function exportNotePdf(note = curNote()) {
  toast('Preparing PDF…', 30000);
  const W = 1240, H = Math.round(W * PAGE_H / PAGE_W), out = [];
  renderLight = true;
  try {
    for (const pg of note.pages) {
      await Promise.all(pageAssetIds(pg).map(id => Assets.ready(id)));
      const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
      ctx.setTransform(W / PAGE_W, 0, 0, W / PAGE_W, 0, 0);
      drawPageContent(ctx, note, pg); drawOverlaysForExport(ctx, pg, note);
      out.push({ jpeg: new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.88)).arrayBuffer()), w: W, h: H });
    }
  } finally { renderLight = false; }
  const blob = buildPdf(out), name = (note.title.replace(/[^\w\- ]+/g, '').trim() || 'note') + '.pdf';
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast(`PDF ready — ${out.length} page${out.length > 1 ? 's' : ''}`);
  return blob;
}

/* ---------- handwriting search ---------- */
// iPad Safari has no on-device handwriting recognition API. Where the browser ships one
// (Chrome's Handwriting Recognition API on ChromeOS/Android), recognized text is stored per page and searched.
const HW = {
  state: 'unknown', rec: null,
  async init() {
    if (!('createHandwritingRecognizer' in navigator)) { this.state = 'unsupported'; return false; }
    try {
      if (navigator.queryHandwritingRecognizer) { const q = await navigator.queryHandwritingRecognizer({ languages: ['en'] }); if (!q) { this.state = 'unsupported'; return false; } }
      this.rec = await navigator.createHandwritingRecognizer({ languages: ['en'] }); this.state = 'ready'; return true;
    } catch (_) { this.state = 'unsupported'; return false; }
  },
  sig: pg => pg.strokes.filter(s => s.tool !== 'highlighter').map(s => s.id).join(','),
  async recognizePage(pg) {
    const strokes = pg.strokes.filter(s => s.tool !== 'highlighter'); if (!strokes.length) return '';
    const d = this.rec.startDrawing({ recognitionType: 'text', inputType: 'stylus' }); let t = 0;
    for (const st of strokes) { const hs = new HandwritingStroke(); for (const p of st.points) hs.addPoint({ x: p[0], y: p[1], t: (t += 8) }); d.addStroke(hs); t += 120; }
    const preds = await d.getPrediction(); d.clear && d.clear();
    return (preds && preds[0] && preds[0].text) || '';
  },
};
let hwTimer = null;
window.onNoteSaved = note => {
  if (HW.state !== 'ready') return;
  clearTimeout(hwTimer);
  hwTimer = setTimeout(async () => {
    let changed = false;
    for (const pg of note.pages) { const sig = HW.sig(pg); if (sig === pg.inkSig) continue; try { pg.inkText = await HW.recognizePage(pg); pg.inkSig = sig; changed = true; } catch (_) {} }
    if (changed) { DB.put('notes', note); renderSidebar(); }
  }, 1500);
};
function searchHintText() {
  return HW.state === 'ready'
    ? 'Searching titles, typed text, tasks, 🏷 handwriting labels, and handwriting recognized on this device.'
    : 'Searching titles, typed text, tasks and 🏷 handwriting labels. This browser has no on-device handwriting recognition, so add a 🏷 label (Lasso → Label) to make ink findable.';
}
function searchMatch(n, q) {
  if (n.title.toLowerCase().includes(q)) return null;
  const snip = (s) => { const i = s.toLowerCase().indexOf(q); return (i > 20 ? '…' : '') + s.slice(Math.max(0, i - 20), i + q.length + 24).trim(); };
  for (const p of n.pages) {
    for (const l of p.labels || []) if (l.text.toLowerCase().includes(q)) return `🏷 ${snip(l.text)}`;
    for (const t of p.tasks) if ((t.text || '').toLowerCase().includes(q)) return `${t.kind === 'ink' ? '✍️ handwritten task' : '☑️ task'}: ${snip(t.text)}`;
    if ((p.inkText || '').toLowerCase().includes(q)) return `✍️ recognized: ${snip(p.inkText)}`;
    for (const t of p.texts) if (t.text.toLowerCase().includes(q)) return `🔤 ${snip(t.text)}`;
  }
  return null;
}
async function addLabelFromSelection() {
  const sel = selection; if (!sel) return;
  const v = prompt('Search keywords for this handwriting (what does it say?)');
  if (!v || !v.trim()) return;
  const n = curNote(), pg = n.pages[sel.pi]; pushHistory();
  const [x0, y0, x1, y1] = sel.bb;
  (pg.labels ||= []).push({ id: uid('l'), strokeIds: sel.ids.slice(), x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: v.trim() });
  saveNote(n, true); hideLasso(); renderOverlay(sel.pi); renderSidebar(); toast('🏷 Label added — it’s searchable now');
}
function renderLabels(pi) {
  const pg = curNote().pages[pi], s = S.scale, ov = pageEls[pi].ov;
  for (const l of pg.labels || []) {
    const d = document.createElement('button'); d.className = 'ink-label'; d.dataset.label = l.id; d.textContent = '🏷 ' + l.text;
    d.style.left = l.x * s + 'px'; d.style.top = Math.max(0, l.y - 30) * s + 'px'; d.style.fontSize = Math.max(10, 17 * s) + 'px';
    d.addEventListener('pointerdown', e => e.stopPropagation());
    d.onclick = e => { e.stopPropagation(); const v = prompt('Edit search label (empty to remove)', l.text); if (v === null) return; pushHistory(); if (v.trim()) l.text = v.trim(); else pg.labels = pg.labels.filter(q => q !== l); saveNote(curNote(), true); renderOverlay(pi); renderSidebar(); };
    ov.append(d);
  }
}

/* ---------- Today ---------- */
function todayItems() { const end = startOfDay(new Date()); end.setDate(end.getDate() + 1); return allItems().filter(i => !i.obj.done && i.obj.due && new Date(i.obj.due) < end); }
function openToday() {
  S.filter = 'today'; document.querySelectorAll('#filterSeg button').forEach(b => b.classList.toggle('on', b.dataset.f === 'today'));
  if (isDrawer()) setSidebar(false);
  setPanel(true); renderPanel();
}

/* ---------- backup with files ---------- */
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function exportAssets(notes) {
  const ids = new Set(); for (const n of notes) for (const pg of n.pages) { for (const id of pageAssetIds(pg)) ids.add(id); if (pg.bg && pg.bg.src) ids.add(pg.bg.src); }
  const out = [];
  for (const id of ids) { const b = await Assets.blob(id); if (b) out.push({ id, type: b.type, data: await blobToDataURL(b) }); }
  return out;
}
async function importAssets(list) {
  for (const a of list || []) { if (!/^data:/.test(a.data || '')) continue; const blob = await (await fetch(a.data)).blob(); await Assets.put(new Blob([blob], { type: a.type }), a.id); Assets.bitmaps.delete(a.id); }
}

/* ---------- lasso selection: box with resize (aspect kept) + rotate handles; cut/copy/paste/duplicate/delete ---------- */
function setSelection(pi, G) {
  ensureAlive(pi);
  const b = groupBB(pi, G); if (!b) { hideLasso(); return; }
  const pad = 8, bb = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  selection = { pi, ids: G.strokes.slice(), tasks: G.tasks.slice(), texts: G.texts.slice(), images: G.images.slice(), sections: G.sections.slice(), bb };
  clearLive(pageEls[pi]);
  $('#lassoPaste').hidden = !clip;
  renderOverlay(pi); $('#lassoMenu').hidden = false; positionLassoMenu();
}
function renderSelBox(pi) {
  if (!selection || selection.pi !== pi || carry) return;
  const [x0, y0, x1, y1] = selection.bb, s = S.scale, d = document.createElement('div'); d.className = 'sel-box';
  Object.assign(d.style, { left: x0 * s + 'px', top: y0 * s + 'px', width: (x1 - x0) * s + 'px', height: (y1 - y0) * s + 'px' });
  d.innerHTML = '<span class="sel-rot" title="Rotate"></span><span class="sel-knob" title="Resize"></span>';
  d.querySelector('.sel-knob').addEventListener('pointerdown', e => startSelX(e, 'scale'));
  d.querySelector('.sel-rot').addEventListener('pointerdown', e => startSelX(e, 'rotate'));
  pageEls[pi].ov.append(d);
}
function groupData(pg, G) {
  const pick = (arr, ids) => (arr || []).filter(o => ids.includes(o.id));
  return { strokes: pick(pg.strokes, G.strokes), images: pick(pg.images, G.images), tasks: pick(pg.tasks, G.tasks), texts: pick(pg.texts, G.texts), sections: pick(pg.sections, G.sections),
    labels: (pg.labels || []).filter(l => l.strokeIds.length && l.strokeIds.every(id => G.strokes.includes(id))) };
}
function restoreGroupData(pg, d) {
  for (const key of ['strokes', 'images', 'tasks', 'texts', 'sections', 'labels']) for (const o of d[key] || []) { const live = (pg[key] || []).find(q => q.id === o.id); if (live) Object.assign(live, JSON.parse(JSON.stringify(o))); }
}
function applyXform(pg, G, map, sc) {
  const has = id => G.strokes.includes(id);
  for (const s of pg.strokes) if (has(s.id)) { s.points = s.points.map(q => { const m = map(q); return [+m[0].toFixed(1), +m[1].toFixed(1), q[2]]; }); s.width = +(s.width * sc).toFixed(2); s.bb = bbox(s.points); }
  for (const im of pg.images || []) if (G.images.includes(im.id)) { const c = map([im.x + im.w / 2, im.y + im.h / 2]); im.w *= sc; im.h *= sc; im.x = c[0] - im.w / 2; im.y = c[1] - im.h / 2; }
  for (const tb of pg.texts) if (G.texts.includes(tb.id)) { const m = map([tb.x, tb.y]); tb.x = m[0]; tb.y = m[1]; tb.size = Math.max(8, Math.min(200, (tb.size || 24) * sc)); }
  for (const sc2 of pg.sections || []) if (G.sections.includes(sc2.id)) { const m = map([sc2.x, sc2.y + SEC_H / 2]); sc2.x = m[0]; sc2.y = m[1] - SEC_H / 2; }
  for (const t of pg.tasks) if (G.tasks.includes(t.id)) {
    if (t.kind === 'ink') { const b = strokesBB(pg, t.strokeIds); if (b) Object.assign(t, { x: b[0] - 8, y: b[1] - 8, w: b[2] - b[0] + 16, h: b[3] - b[1] + 16 }); }
    else { const m = map([t.x, t.y]); t.x = m[0]; t.y = m[1]; }
  }
  for (const l of pg.labels || []) if (l.strokeIds.length && l.strokeIds.every(has)) { const b = strokesBB(pg, l.strokeIds); if (b) Object.assign(l, { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }); }
}
function startSelX(e, mode) {
  e.stopPropagation(); e.preventDefault(); const sel = selection; if (!sel) return;
  const pg = curNote().pages[sel.pi], G = selGroup(sel);
  selX = { pid: e.pointerId, mode, pi: sel.pi, G, bb: sel.bb.slice(), hist: snapshot(), orig: JSON.stringify(groupData(pg, G)), start: pagePt(e, sel.pi), moved: false };
  $('#lassoMenu').hidden = true;
  liftHide = { pg: pg.id, strokes: new Set(), images: new Set(), ids: new Set([...G.tasks, ...G.texts, ...G.sections]) }; applyLiftHide(sel.pi);
}
let selXRaf = 0;
function selXMove(e) {
  const X = selX, pg = curNote().pages[X.pi], p = pagePt(e, X.pi), [x0, y0, x1, y1] = X.bb;
  let map, sc = 1;
  if (X.mode === 'scale') {
    const dw = x1 - x0, dh = y1 - y0; sc = Math.max(0.15, Math.min(6, ((p[0] - x0) * dw + (p[1] - y0) * dh) / (dw * dw + dh * dh)));
    map = q => [x0 + (q[0] - x0) * sc, y0 + (q[1] - y0) * sc];
  } else {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let a = Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(X.start[1] - cy, X.start[0] - cx);
    const q90 = Math.round(a / (Math.PI / 2)) * Math.PI / 2; if (Math.abs(a - q90) < 0.06) a = q90;
    const co = Math.cos(a), si = Math.sin(a); map = q => [cx + (q[0] - cx) * co - (q[1] - cy) * si, cy + (q[0] - cx) * si + (q[1] - cy) * co]; X.angle = a;
  }
  if (Math.abs(sc - 1) < 0.01 && !X.angle) return;
  restoreGroupData(pg, JSON.parse(X.orig)); applyXform(pg, X.G, map, sc); X.moved = true; X.sc = sc;
  if (!selXRaf) selXRaf = requestAnimationFrame(() => {
    selXRaf = 0; if (!selX) return; renderPageInk(selX.pi);
    const box = pageEls[selX.pi].ov.querySelector('.sel-box'), s = S.scale, [a0, b0, a1, b1] = selX.bb;
    if (box) { box.style.width = (a1 - a0) * s * (selX.sc || 1) + 'px'; box.style.height = (b1 - b0) * s * (selX.sc || 1) + 'px'; box.style.transform = selX.mode === 'rotate' ? `rotate(${selX.angle || 0}rad)` : ''; }
  });
}
function selXEnd() {
  const X = selX; selX = null; liftHide = null;
  if (X.moved) { S.undo.push(X.hist); S.redo = []; updateUndo(); saveNote(curNote(), true); thumbCache.clear(); }
  renderPageInk(X.pi); renderOverlay(X.pi); setSelection(X.pi, X.G);
  if (X.moved && X.G.sections.length) rerenderOverlays();
}
function copySelection(cut) {
  const sel = selection; if (!sel) return; const pg = curNote().pages[sel.pi];
  clip = { data: JSON.parse(JSON.stringify(groupData(pg, selGroup(sel)))), bb: sel.bb.slice(), pg: pg.id, n: 0 };
  if (cut) { deleteSelection(); toast('Cut'); } else { toast('Copied'); $('#lassoPaste').hidden = false; }
}
function deleteSelection() {
  const sel = selection; if (!sel) return; const n = curNote(), pg = n.pages[sel.pi], G = selGroup(sel);
  pushHistory();
  pg.strokes = pg.strokes.filter(s => !G.strokes.includes(s.id)); pg.tasks = pg.tasks.filter(t => !G.tasks.includes(t.id));
  pg.texts = pg.texts.filter(t => !G.texts.includes(t.id)); pg.images = (pg.images || []).filter(i => !G.images.includes(i.id)); pg.sections = (pg.sections || []).filter(x => !G.sections.includes(x.id));
  pg.labels = (pg.labels || []).filter(l => !l.strokeIds.some(id => G.strokes.includes(id)));
  for (const t of pg.tasks) if (t.kind === 'ink') t.strokeIds = t.strokeIds.filter(id => !G.strokes.includes(id));
  pg.tasks = pg.tasks.filter(t => t.kind !== 'ink' || t.strokeIds.length);
  saveNote(n, true); thumbCache.clear(); hideLasso(); renderAll(); rerenderOverlays();
}
function placeClone(pi, data, dx, dy) {
  const pg = curNote().pages[pi], ids = new Map(), d = JSON.parse(JSON.stringify(data)), G = emptyG();
  for (const s of d.strokes) { const id = uid('s'); ids.set(s.id, id); s.id = id; s.points = s.points.map(q => [+(q[0] + dx).toFixed(1), +(q[1] + dy).toFixed(1), q[2]]); s.bb = bbox(s.points); pg.strokes.push(s); G.strokes.push(id); }
  for (const im of d.images) { im.id = uid('i'); im.x += dx; im.y += dy; (pg.images ||= []).push(im); G.images.push(im.id); }
  for (const tb of d.texts) { tb.id = uid('x'); tb.x += dx; tb.y += dy; pg.texts.push(tb); G.texts.push(tb.id); }
  for (const sc of d.sections || []) { sc.id = uid('sec'); sc.x += dx; sc.y += dy; (pg.sections ||= []).push(sc); G.sections.push(sc.id); }
  for (const t of d.tasks) { t.id = uid('t'); t.x += dx; t.y += dy; t.notified = false; t.createdAt = Date.now(); delete t.slot; if (t.kind === 'ink') t.strokeIds = t.strokeIds.map(i => ids.get(i) || i); pg.tasks.push(t); G.tasks.push(t.id); }
  for (const l of d.labels || []) { l.id = uid('l'); l.x += dx; l.y += dy; l.strokeIds = l.strokeIds.map(i => ids.get(i) || i); (pg.labels ||= []).push(l); }
  return G;
}
function pasteClip() {
  if (!clip) return; const n = curNote(); if (!n) return;
  const pi = selection ? selection.pi : currentPageIndex(), pg = n.pages[pi]; let dx, dy;
  if (clip.pg === pg.id) { clip.n++; dx = dy = 30 * clip.n; }
  else { const [cx, cy] = visibleCenter(pi); dx = cx - (clip.bb[0] + clip.bb[2]) / 2; dy = cy - (clip.bb[1] + clip.bb[3]) / 2; }
  pushHistory(); const G = placeClone(pi, clip.data, dx, dy); saveNote(n, true); thumbCache.clear();
  if (S.tool !== 'lasso') selectTool('lasso'); else hideLasso();
  renderAll(); rerenderOverlays(); setSelection(pi, G); toast('Pasted');
}
function duplicateSelection() {
  const sel = selection; if (!sel) return; const pg = curNote().pages[sel.pi], data = groupData(pg, selGroup(sel));
  pushHistory(); const G = placeClone(sel.pi, data, 30, 30); saveNote(curNote(), true); thumbCache.clear();
  hideLasso(); renderAll(); rerenderOverlays(); setSelection(sel.pi, G);
}

/* ---------- text box handles (after a long-press move): drag to move, corner to resize (font size) ---------- */
function renderTextSel(pi) {
  if (!txtSel || txtSel.pi !== pi || carry) return;
  const pg = curNote().pages[pi], tb = pg.texts.find(t => t.id === txtSel.id), el = tb && pageEls[pi].ov.querySelector(`.textblock[data-id="${tb.id}"]`);
  if (!el) { txtSel = null; return; }
  const d = document.createElement('div'); d.className = 'img-sel txt-sel'; d.dataset.tsel = tb.id;
  Object.assign(d.style, { left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px' });
  d.innerHTML = '<button class="img-del" aria-label="Delete">✕</button><span class="img-knob" aria-label="Resize"></span>';
  d.querySelector('.img-del').addEventListener('pointerdown', ev => ev.stopPropagation());
  d.querySelector('.img-del').onclick = ev => { ev.stopPropagation(); pushHistory(); pg.texts = pg.texts.filter(t => t !== tb); txtSel = null; saveNote(curNote()); renderOverlay(pi); renderSidebar(); };
  d.querySelector('.img-knob').addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); startTxtDrag(ev, pi, tb, 'resize', el); });
  d.addEventListener('pointerdown', ev => { if (ev.target !== d) return; ev.stopPropagation(); ev.preventDefault(); startTxtDrag(ev, pi, tb, 'move', el); });
  pageEls[pi].ov.append(d);
}
function startTxtDrag(e, pi, tb, mode, el) { txtDrag = { pid: e.pointerId, pi, tb, mode, el, start: pagePt(e, pi), ox: tb.x, oy: tb.y, os: tb.size || 24, ow: el.offsetWidth / S.scale, hist: snapshot(), moved: false }; }
function txtDragMove(e) {
  const d = txtDrag, p = pagePt(e, d.pi), dx = p[0] - d.start[0], dy = p[1] - d.start[1], s = S.scale;
  if (!d.moved && Math.hypot(dx, dy) < 2) return; d.moved = true;
  if (d.mode === 'move') { d.tb.x = Math.max(0, Math.min(PAGE_W - 40, d.ox + dx)); d.tb.y = Math.max(0, Math.min(PAGE_H - 30, d.oy + dy)); }
  else d.tb.size = Math.max(10, Math.min(160, d.os * Math.max(0.2, (d.ow + dx) / d.ow)));
  const box = pageEls[d.pi].ov.querySelector('.txt-sel');
  Object.assign(d.el.style, { left: d.tb.x * s + 'px', top: d.tb.y * s + 'px', fontSize: d.tb.size * s + 'px', maxWidth: (PAGE_W - d.tb.x - 30) * s + 'px' });
  if (box) Object.assign(box.style, { left: d.el.offsetLeft + 'px', top: d.el.offsetTop + 'px', width: d.el.offsetWidth + 'px', height: d.el.offsetHeight + 'px' });
}
function txtDragEnd() {
  const d = txtDrag; txtDrag = null;
  if (d.moved) { S.undo.push(d.hist); S.redo = []; updateUndo(); saveNote(curNote(), true); renderOverlay(d.pi); }
  else if (S.tool === 'text') { txtSel = null; renderOverlay(d.pi); const el = pageEls[d.pi].ov.querySelector(`.textblock[data-id="${d.tb.id}"]`); el && el.focus(); }
}

/* ---------- canvas objects: long-press (Pencil ≈400 ms / finger ≈350 ms, stationary) lifts what is under it ---------- */
function hitObject(pi, p) {
  const pg = curNote().pages[pi], pad = 4, inR = r => r && p[0] >= r[0] - pad && p[0] <= r[2] + pad && p[1] >= r[1] - pad && p[1] <= r[3] + pad;
  for (const t of pg.tasks) if (inR(t.kind === 'ink' ? [t.x, t.y, t.x + t.w, t.y + t.h] : ovRect(pi, t.id))) return { kind: 'task', id: t.id };
  for (const tb of pg.texts) if (inR(ovRect(pi, tb.id))) return { kind: 'text', id: tb.id };
  const im = hitImage(pi, p); if (im) return { kind: 'image', id: im.id };
  if (selection && selection.pi === pi && inR(selection.bb)) return { kind: 'sel' };
  return null;
}
function v7ObjectDown(e, pi) {
  if (S.tool === 'eraser' || carry || selX || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.pointerType === 'touch' && (touches.size || pinch)) return;
  const hit = hitObject(pi, pagePt(e, pi));
  if (!hit) {
    if (imgSel && S.tool !== 'lasso') deselectImage();
    if (txtSel) { txtSel = null; renderOverlay(pi); }
    return;
  }
  // Fingers never draw (palm rejection) — they may only lift. Pencil/finger-draw strokes in progress are discarded on lift.
  holdFor(e, (x, y, pid) => {
    if (drawing && drawing.id === pid) cancelDrawing();
    const n = curNote(); if (!n.pages[pi]) return;
    if (hit.kind === 'sel' && !selection) return;
    startCarry(x, y, pid, { kind: hit.kind, note: n, pi, taskId: hit.id, id: hit.id, G: hit.kind === 'sel' ? selGroup(selection) : undefined });
  });
}
function v7TextHold(ov, pi) {
  ov.querySelectorAll('.textblock').forEach(el => el.addEventListener('pointerdown', e => holdFor(e, (x, y, pid) => startCarry(x, y, pid, { kind: 'text', note: curNote(), pi, id: el.dataset.id }))));
}

/* ---------- NUMBERED SECTIONS ----------
   pg.sections = [{id, x, y, style:'.'|')'}]. Numbers are not stored: they are the badge order down the note (1, 2, 3 …).
   A section owns everything whose vertical centre lies between its badge and the next badge (or the page end). */
let justMade = null;
function sectionRanges(pg) {
  const list = (pg.sections || []).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  return list.map((b, i) => ({ b, y0: b.y - 10, y1: i + 1 < list.length ? list[i + 1].y - 10 : PAGE_H + 2000 }));
}
function sectionGroup(pg, id) {
  const R = sectionRanges(pg).find(r => r.b.id === id), G = emptyG(); if (!R) return G;
  G.sections.push(id);
  const inR = y => y >= R.y0 && y < R.y1, owned = new Set();
  for (const t of pg.tasks) {
    if (t.kind === 'ink') { t.strokeIds.forEach(i => owned.add(i)); if (inR(t.y + t.h / 2)) { G.tasks.push(t.id); G.strokes.push(...t.strokeIds); } }
    else if (inR(t.y + (t.fs || 26) * 0.7)) G.tasks.push(t.id);
  }
  for (const s of pg.strokes) if (!owned.has(s.id)) { const b = s.bb || bbox(s.points); if (inR((b[1] + b[3]) / 2)) G.strokes.push(s.id); }
  for (const tb of pg.texts) if (inR(tb.y + (tb.size || 24) * 0.7)) G.texts.push(tb.id);
  for (const im of pg.images || []) if (inR(im.y + im.h / 2)) G.images.push(im.id);
  return G;
}
function sectionList(pg, pi, id) {
  const R = sectionRanges(pg); if (R.length < 2) return null;
  const members = R.map((r, i) => {
    const G = sectionGroup(pg, r.b.id); let h;
    if (i + 1 < R.length) h = R[i + 1].y0 - r.y0;
    else { const bb = groupBB(pi, G); h = Math.max(bb ? bb[3] : 0, r.b.y + SEC_H) + 24 - r.y0; }
    return { id: r.b.id, G, top: r.y0, h };
  });
  return { kind: 'sections', pi, members, me: members.find(m => m.id === id), gaps: members.slice(1).map(() => 0) };
}
function secNumber(note, pg, sec) {
  let k = 0;
  for (const p of note.pages) { const list = (p.sections || []).slice().sort((a, b) => a.y - b.y || a.x - b.x); if (p === pg) return k + list.indexOf(sec) + 1; k += list.length; }
  return 1;
}
function renderBadges(pi) {
  const n = curNote(), pg = n.pages[pi], s = S.scale, ov = pageEls[pi].ov;
  for (const sc of pg.sections || []) {
    const b = document.createElement('button'); b.className = 'sec-badge' + (sc.id === justMade ? ' pop' : ''); b.dataset.id = sc.id;
    b.textContent = secNumber(n, pg, sc) + (sc.style || '.'); b.title = 'Drag to move this section · long-press for options';
    Object.assign(b.style, { left: sc.x * s + 'px', top: sc.y * s + 'px', height: SEC_H * s + 'px', minWidth: SEC_H * s + 'px', fontSize: 28 * s + 'px' });
    b.addEventListener('pointerdown', e => badgeDown(e, pi, sc.id));
    b.addEventListener('click', e => e.stopPropagation());
    ov.append(b);
  }
}
// A badge is an object: drag it directly (finger or Pencil). Holding still ≈0.5 s opens Delete / Unnumber.
function badgeDown(e, pi, id) {
  e.stopPropagation(); e.preventDefault();
  if ((e.pointerType === 'mouse' && e.button !== 0) || carry) return;
  if (e.pointerType === 'pen') notePen();
  if (S.tool === 'eraser') { removeSectionNumber(pi, id); return; }
  const st = { pid: e.pointerId, x: e.clientX, y: e.clientY }, tol = e.pointerType === 'pen' ? 4 : 6;
  const cleanup = () => { clearTimeout(timer); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  const mv = ev => { if (ev.pointerId !== st.pid || Math.hypot(ev.clientX - st.x, ev.clientY - st.y) <= tol) return; cleanup(); taskDragSuppress = true; startCarry(st.x, st.y, st.pid, { kind: 'section', note: curNote(), pi, id }); if (carry) { carry.x = ev.clientX; carry.y = ev.clientY; carryMove(); } };
  const up = ev => { if (ev.pointerId === st.pid) { cleanup(); badgeMenu(pi, id); } };
  const timer = setTimeout(() => { cleanup(); badgeMenu(pi, id); }, 500);
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function badgeMenu(pi, id) {
  const n = curNote(), pg = n.pages[pi], sc = (pg.sections || []).find(x => x.id === id); if (!sc) return;
  actionSheet(`Section ${secNumber(n, pg, sc)}`, [
    { label: 'Remove number (keep the notes)', fn: () => removeSectionNumber(pi, id) },
    { label: `Use ${sc.style === ')' ? '1.' : '1)'} style`, fn: () => { pushHistory(); sc.style = sc.style === ')' ? '.' : ')'; saveNote(n, true); rerenderOverlays(); } },
    { label: 'Delete section and its notes', danger: true, fn: () => { const G = sectionGroup(pg, id); setSelection(pi, G); deleteSelection(); toast('Section deleted — Undo brings it back'); } },
  ]);
}
function removeSectionNumber(pi, id) {
  const n = curNote(), pg = n.pages[pi]; if (!(pg.sections || []).some(x => x.id === id)) return;
  pushHistory(); pg.sections = pg.sections.filter(x => x.id !== id);
  saveNote(n, true); thumbCache.clear(); renderPageInk(pi); rerenderOverlays();
  toast('Number removed — the other sections renumbered. Undo brings it back');
}
function eraseSectionsAt(pi, p) {
  const pg = curNote().pages[pi]; if (!pg.sections || !pg.sections.length) return false;
  const hit = pg.sections.find(sc => p[0] >= sc.x - 6 && p[0] <= sc.x + SEC_H * 1.6 && p[1] >= sc.y - 6 && p[1] <= sc.y + SEC_H + 6);
  if (!hit) return false;
  pg.sections = pg.sections.filter(x => x !== hit); saveNote(curNote(), true); thumbCache.clear(); rerenderOverlays(); return true;
}
function addSection(pi, x, y, style = '.') {
  const n = curNote(), pg = n.pages[pi]; pushHistory();
  const sc = { id: uid('sec'), x: Math.max(4, Math.min(PAGE_W - SEC_H, x)), y: Math.max(4, Math.min(PAGE_H - SEC_H, y)), style };
  (pg.sections ||= []).push(sc); justMade = sc.id; setTimeout(() => { if (justMade === sc.id) justMade = null; }, 900);
  saveNote(n, true); thumbCache.clear(); renderPageInk(pi); rerenderOverlays();
  return sc;
}
// Section tool: tap → next number badge (snapped to the left margin when tapped near it).
function insertSectionAt(pi, p) { const sc = addSection(pi, p[0] < 220 ? 24 : p[0] - SEC_H / 2, p[1] - SEC_H / 2); hint(`Section ${secNumber(curNote(), curNote().pages[pi], sc)} — drag the badge to move the whole section`); return sc; }
function sectionFromSelection() {
  const sel = selection; if (!sel || !sel.ids.length) return; const n = curNote(), pg = n.pages[sel.pi], b = strokesBB(pg, sel.ids);
  const term = pg.strokes.filter(s => sel.ids.includes(s.id)).map(termKind).find(Boolean);
  pushHistory(); const keep = S.undo.length;
  pg.strokes = pg.strokes.filter(s => !sel.ids.includes(s.id)); hideLasso();
  addSection(sel.pi, b[0], (b[1] + b[3]) / 2 - SEC_H / 2, term === 'paren' ? ')' : '.');
  S.undo.length = keep; updateUndo();        // one undo step for the whole conversion
}

/* ---------- handwritten "1." / "2)" → number badge ----------
   Small on-device recogniser: geometry finds "glyph + dot/paren at the start of a line", then a $P point-cloud
   matcher (digit templates + letter look-alikes as negatives) must agree it is a digit. Converts only when confident. */
const DIGIT_T = {
  '1': [[[.5, 0], [.5, 1]]], '1b': [[[.2, .25], [.5, 0], [.5, 1]]], '1c': [[[.2, .25], [.5, 0], [.5, 1]], [[.2, 1], [.8, 1]]],
  '2': [[[.1, .25], [.3, .02], [.7, .02], [.9, .25], [.85, .45], [.1, 1], [.9, 1]]],
  '3': [[[.1, .1], [.5, 0], [.85, .2], [.5, .48], [.9, .7], [.6, 1], [.1, .9]]],
  '4': [[[.65, 0], [.05, .65], [.95, .65]], [[.7, .3], [.7, 1]]], '4b': [[[.15, 0], [.1, .55], [.9, .55]], [[.7, 0], [.7, 1]]],
  '5': [[[.85, 0], [.2, 0], [.15, .45], [.6, .4], [.9, .65], [.6, 1], [.1, .9]]], '5b': [[[.2, 0], [.15, .45], [.6, .4], [.9, .65], [.6, 1], [.1, .9]], [[.2, 0], [.85, 0]]],
  '6': [[[.75, 0], [.3, .3], [.12, .7], [.35, 1], [.75, .9], [.8, .6], [.4, .5], [.15, .7]]],
  '7': [[[.05, 0], [.95, 0], [.4, 1]]], '7b': [[[.05, 0], [.95, 0], [.4, 1]], [[.3, .5], [.8, .5]]],
  '8': [[[.8, .15], [.5, 0], [.2, .15], [.5, .5], [.85, .75], [.5, 1], [.15, .75], [.5, .5], [.8, .15]]],
  '9': [[[.85, .25], [.5, 0], [.15, .2], [.3, .45], [.85, .3], [.85, .6], [.75, 1]]],
};
const NEG_T = {
  o: [[[.5, 0], [.15, .2], [0, .5], [.15, .85], [.5, 1], [.85, .85], [1, .5], [.85, .15], [.5, 0]]],
  a: [[[.8, .3], [.5, .1], [.15, .5], [.4, .9], [.8, .6], [.8, .2], [.85, 1]]],
  c: [[[.9, .15], [.5, 0], [.1, .3], [.1, .7], [.5, 1], [.9, .85]]],
  e: [[[.1, .5], [.9, .45], [.7, .05], [.3, .05], [.05, .5], [.3, .95], [.9, .85]]],
  s: [[[.85, .1], [.5, 0], [.15, .2], [.5, .5], [.85, .75], [.5, 1], [.1, .9]]],
  x: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]], t: [[[.5, 0], [.5, 1]], [[.1, .3], [.9, .3]]],
  n: [[[.1, .3], [.1, 1], [.15, .5], [.5, .3], [.85, .5], [.9, 1]]], m: [[[.05, .3], [.05, 1], [.1, .45], [.3, .3], [.5, .5], [.5, 1], [.55, .45], [.75, .3], [.95, .5], [.95, 1]]],
  u: [[[.1, 0], [.1, .7], [.5, 1], [.9, .7], [.9, 0], [.9, 1]]], v: [[[0, 0], [.5, 1], [1, 0]]], w: [[[0, 0], [.25, 1], [.5, .3], [.75, 1], [1, 0]]],
};
const PN = 32;
function cloudOf(strokes) {           // strokes: arrays of [x,y]; returns PN normalised points
  const pts = []; strokes.forEach((s, si) => { for (let i = 0; i < s.length; i++) { if (i && s.length > 1) { const a = s[i - 1], b = s[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02)); for (let j = 1; j <= k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k, si]); } else pts.push([s[i][0], s[i][1], si]); } });
  let L = 0; for (let i = 1; i < pts.length; i++) if (pts[i][2] === pts[i - 1][2]) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const I = L / (PN - 1) || 1, out = [pts[0].slice(0, 2)]; let D = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][2] !== pts[i - 1][2]) continue;
    let a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (D + d >= I && out.length < PN) { const t = (I - D) / d, q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; out.push(q); a = [q[0], q[1], b[2]]; d = Math.hypot(b[0] - a[0], b[1] - a[1]); D = 0; }
    D += d;
  }
  while (out.length < PN) out.push(pts[pts.length - 1].slice(0, 2));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of out) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const sz = Math.max(x1 - x0, y1 - y0) || 1, cx = out.reduce((a, p) => a + p[0], 0) / PN, cy = out.reduce((a, p) => a + p[1], 0) / PN;
  return out.map(p => [(p[0] - cx) / sz, (p[1] - cy) / sz]);
}
function cloudDist(a, b, start) {
  const used = new Array(PN).fill(false); let sum = 0, i = start;
  do { let min = Infinity, idx = -1; for (let j = 0; j < PN; j++) if (!used[j]) { const d = Math.hypot(a[i][0] - b[j][0], a[i][1] - b[j][1]); if (d < min) { min = d; idx = j; } }
    used[idx] = true; sum += (1 - ((i - start + PN) % PN) / PN) * min; i = (i + 1) % PN; } while (i !== start);
  return sum;
}
function cloudMatch(a, b) { let m = Infinity; const step = Math.floor(Math.sqrt(PN)); for (let i = 0; i < PN; i += step) m = Math.min(m, cloudDist(a, b, i), cloudDist(b, a, i)); return m; }
const TPL = { digits: Object.entries(DIGIT_T).map(([k, s]) => [k[0], cloudOf(s)]), neg: Object.entries(NEG_T).map(([k, s]) => [k, cloudOf(s)]) };
function classifyDigit(strokes) {
  const c = cloudOf(strokes.map(s => s.points.map(p => [p[0], p[1]])));
  let bd = Infinity, digit = null, bn = Infinity, neg = null;
  for (const [d, t] of TPL.digits) { const v = cloudMatch(c, t); if (v < bd) { bd = v; digit = d; } }
  for (const [d, t] of TPL.neg) { const v = cloudMatch(c, t); if (v < bn) { bn = v; neg = d; } }
  return { digit, dist: bd, neg, negDist: bn, ok: bd < 4.2 && bd < bn * 0.92 };
}
function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function termKind(s) {
  const b = s.bb || bbox(s.points), w = b[2] - b[0], h = b[3] - b[1];
  if (w <= 16 && h <= 16 && pathLen(s.points) <= 60) return 'dot';
  if (h >= 20 && w <= 0.5 * h && s.points.length >= 4) {
    const mid = s.points[Math.floor(s.points.length / 2)], ends = (s.points[0][0] + s.points[s.points.length - 1][0]) / 2;
    if (mid[0] - ends >= 0.1 * h) return 'paren';
  }
  return null;
}
function checkNumber(pg, glyph, term, kind) {
  const gb = strokesBB(pg, glyph.map(s => s.id)); if (!gb) return null;
  const gw = gb[2] - gb[0], gh = gb[3] - gb[1];
  if (gh < 22 || gh > 140 || gw > 1.15 * gh || gb[0] > 420) return null;
  const tb = term.bb || bbox(term.points), tcx = (tb[0] + tb[2]) / 2, tcy = (tb[1] + tb[3]) / 2;
  if (kind === 'dot') { if (tcx < gb[2] - 0.15 * gh || tcx > gb[2] + 0.9 * gh || tcy < gb[1] + 0.55 * gh || tcy > gb[3] + 0.35 * gh) return null; }
  else { const ov = Math.min(tb[3], gb[3]) - Math.max(tb[1], gb[1]); if (tb[0] < gb[2] - 0.2 * gh || tb[0] > gb[2] + 0.8 * gh || ov < 0.6 * gh) return null; }
  const ids = new Set([...glyph, term].map(s => s.id));
  for (const s of pg.strokes) {               // must start the line: nothing written to its left on the same line
    if (ids.has(s.id)) continue; const b = s.bb || bbox(s.points), vo = Math.min(b[3], gb[3]) - Math.max(b[1], gb[1]);
    if (vo > 0.4 * gh && b[2] < gb[0] + 2) return null;
  }
  for (const t of pg.tasks) { const r = t.kind === 'ink' ? [t.x, t.y, t.x + t.w, t.y + t.h] : [t.x, t.y, t.x + 60, t.y + 40]; if (gb[0] < r[2] && gb[2] > r[0] && gb[1] < r[3] && gb[3] > r[1]) return null; }
  for (const sc of pg.sections || []) if (Math.abs(sc.y + SEC_H / 2 - (gb[1] + gb[3]) / 2) < SEC_H) return null;
  if (pg.tasks.some(t => t.kind === 'ink' && t.strokeIds.some(id => ids.has(id)))) return null;
  const c = classifyDigit(glyph); if (!c.ok) return null;
  return { digit: c.digit, style: kind === 'dot' ? '.' : ')', gb };
}
const NUM = { timer: null, recent: [] };
window.onStrokeAdded = (pi, st) => {
  if (st.tool !== 'pen' || localStorage.getItem('autoNumber') === '0') return;
  NUM.recent.push({ pi, id: st.id, t: Date.now() }); if (NUM.recent.length > 12) NUM.recent.shift();
  clearTimeout(NUM.timer); NUM.timer = setTimeout(detectNumbers, 650);
};
function detectNumbers() {
  if (drawing) { NUM.timer = setTimeout(detectNumbers, 400); return; }
  const n = curNote(), now = Date.now(), recent = NUM.recent.filter(r => now - r.t < 10000); NUM.recent = [];
  if (!n) return;
  for (const pi of new Set(recent.map(r => r.pi))) {
    const pg = n.pages[pi]; if (!pg) continue;
    const strokes = recent.filter(r => r.pi === pi).map(r => pg.strokes.find(s => s.id === r.id)).filter(Boolean);
    for (let i = 1; i < strokes.length; i++) {
      const kind = termKind(strokes[i]); if (!kind) continue;
      for (const gl of [1, 2]) {
        if (i - gl < 0) break;
        const glyph = strokes.slice(i - gl, i); if (glyph.some(termKind) && gl === 2) continue;
        const res = checkNumber(pg, glyph, strokes[i], kind);
        if (res) { badgeFromInk(pi, [...glyph, strokes[i]], res); break; }
      }
    }
  }
}
function badgeFromInk(pi, strokes, res) {
  const n = curNote(), pg = n.pages[pi], ids = new Set(strokes.map(s => s.id));
  pushHistory(); const keep = S.undo.length;
  pg.strokes = pg.strokes.filter(s => !ids.has(s.id));
  const sc = addSection(pi, res.gb[0] - 4, (res.gb[1] + res.gb[3]) / 2 - SEC_H / 2, res.style); sc.auto = res.digit;
  S.undo.length = keep; updateUndo(); saveNote(n, true);
  hint(`Section ${secNumber(n, pg, sc)} recognized — drag the badge to move the section · Undo to keep the ink`);
}

function v7OverlayHook(pi) {
  renderBadges(pi); renderLabels(pi); renderImgSel(pi); renderTextSel(pi); renderSelBox(pi); v7TextHold(pageEls[pi].ov, pi); applyLiftHide(pi);
}
document.addEventListener('keydown', e => {
  if (e.target.matches('input, [contenteditable], textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'v' && clip) { e.preventDefault(); pasteClip(); return; }
  if (!selection) return;
  if (mod && k === 'c') { e.preventDefault(); copySelection(false); }
  else if (mod && k === 'x') { e.preventDefault(); copySelection(true); }
  else if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); }
});
$('#lassoCut').onclick = () => copySelection(true);
$('#lassoCopy').onclick = () => copySelection(false);
$('#lassoPaste').onclick = pasteClip;
$('#lassoDup').onclick = duplicateSelection;
$('#lassoSection').onclick = sectionFromSelection;

/* ---------- wiring ---------- */
$('#pdfFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importPdf(f, pdfTargetNb); pdfTargetNb = null; });
$('#photoFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; insertPhotoFile(f); });
$('#photoBtn').onclick = () => $('#photoFile').click();
$('#stickerBtn').onclick = stickerPicker;
$('#todayBtn').onclick = openToday;
$('#lassoPlanner').onclick = () => { const s = selection; if (!s) return; $('#lassoMenu').hidden = true; openPlannerPicker({ kind: 'sel', note: curNote(), pi: s.pi, ids: s.ids.slice(), bb: s.bb.slice(), start: [s.bb[0], s.bb[1]] }); };
$('#lassoLabel').onclick = addLabelFromSelection;
$('#search').addEventListener('focus', () => { $('#searchHint').textContent = searchHintText(); $('#searchHint').hidden = false; });
$('#search').addEventListener('blur', () => { if (!$('#search').value) $('#searchHint').hidden = true; });
HW.init().then(() => { if (!$('#searchHint').hidden) $('#searchHint').textContent = searchHintText(); });
