/* Pencil Notes v21ff — +/− lines on Daily To-Do sections, and a custom template builder.
   Premade templates stay. Storage is a new IndexedDB database (pencil-notes-templates);
   the notes database (inkminder) is never opened for upgrade or cleared.
   v21fe chrome (safe-area topbar, hidden Sales Leads button) is left intact. */
(() => {
  'use strict';
  const VERSION = 'v21ff';
  const IDB_NAME = 'pencil-notes-templates';
  const IDB_STORE = 'templates';
  const HOLD_MS = 280;
  const COLORS = ['#4f46e5', '#0f766e', '#b45309', '#be185d', '#0369a1', '#15803d', '#7c3aed', '#c2410c'];
  const X = 40, W = 920, GAP = 14, HEAD = 36, ROW = 48, BOX = 26, LH = 40, TOP = 36;
  const NOTES_DEF = 2, TMR_DEF = 2;
  const LIMIT = (typeof PAGE_H === 'number' ? PAGE_H : 1430) - 24;

  const $1 = s => document.querySelector(s);
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const toastMsg = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  const persist = n => { if (n && !n.lock) { try { saveNote(n, true); } catch (_) {} } };
  const sbb = s => { if (s.bb && s.bb.length) return s.bb; try { return (typeof bbox === 'function') ? bbox(s.points) : [0,0,0,0]; } catch (_) { return [0,0,0,0]; } };
  const ccx = s => { const b = sbb(s); return (b[0] + b[2]) / 2; };
  const ccy = s => { const b = sbb(s); return (b[1] + b[3]) / 2; };
  const inR = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const tcen = t => [t.x + 4, t.y + 10];
  const inkOf = pg => (pg.strokes || []).filter(s => s.points && s.points.length);
  const strokesIn = (pg, r) => inkOf(pg).filter(s => inR(r, ccx(s), ccy(s)));
  const textsIn = (pg, r) => (pg.texts || []).filter(t => inR(r, ...tcen(t)));
  function shiftInk(pg, y0, dy) {
    if (!pg || !dy) return;
    for (const s of pg.strokes || []) if (ccy(s) >= y0) {
      s.points = s.points.map(p => { const q = p.slice(); q[1] += dy; return q; });
      try { s.bb = bbox(s.points); } catch (_) {}
    }
    for (const t of pg.texts || []) if (tcen(t)[1] >= y0) t.y += dy;
  }
  function takeInkIn(pg, r) {
    const s = new Set(strokesIn(pg, r).concat((pg.strokes || []).filter(x => x.tool === 'highlighter' && inR(r, ccx(x), ccy(x)))));
    const t = new Set(textsIn(pg, r));
    if (pg.strokes) pg.strokes = pg.strokes.filter(x => !s.has(x));
    if (pg.texts) pg.texts = pg.texts.filter(x => !t.has(x));
    return s.size + t.size;
  }
  function bandHasWriting(pg, band) { return !!(strokesIn(pg, band).length || textsIn(pg, band).length); }
  function newId(p) { return (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function confirmBox(title, body, okLabel) {
    if (V21ff._autoConfirm) return Promise.resolve(true);
    return new Promise(res => {
      let el = document.getElementById('ffConfirm');
      if (!el) { el = document.createElement('div'); el.id = 'ffConfirm'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.append(el); }
      el.innerHTML = '<div class="ff-c-card"><h3></h3><p></p><div class="ff-c-acts"><button type="button" data-a="no">Cancel</button><button type="button" class="danger" data-a="ok"></button></div></div>';
      el.querySelector('h3').textContent = title;
      el.querySelector('p').textContent = body;
      el.querySelector('[data-a="ok"]').textContent = okLabel || 'Remove';
      el.hidden = false;
      const done = v => { el.hidden = true; el.onclick = null; removeEventListener('keydown', key, true); res(v); };
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
      addEventListener('keydown', key, true);
      el.onclick = e => { const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === 'ok'); else if (e.target === el) done(false); };
      setTimeout(() => { try { el.querySelector('[data-a="ok"]').focus(); } catch (_) {} }, 0);
    });
  }
  confirmBox.open = () => { const el = document.getElementById('ffConfirm'); return !!(el && !el.hidden); };

  function TD() { return (window.V21ee && V21ee.TD) || { X, W, TOP: 104, GAP: 16, HEAD, ROW, ADD: 36, NOTES: 150, NOTE_LH: LH, TMR: 132, BOX, DEF: 1 }; }
  function notesCount(t) { return t && t.notesLines != null ? Math.max(1, t.notesLines | 0) : NOTES_DEF; }
  function tmrCount(t) { return t && t.tmrLines != null ? Math.max(1, t.tmrLines | 0) : TMR_DEF; }
  function notesH(t) { const D = TD(); return D.NOTES + (notesCount(t) - NOTES_DEF) * D.NOTE_LH; }
  function tmrH(t) { const D = TD(); return D.TMR + (tmrCount(t) - TMR_DEF) * D.NOTE_LH; }
  function applyTodoMetrics(t) {
    const D = TD(); if (!D || !t) return null;
    const saved = { NOTES: D.NOTES, TMR: D.TMR };
    D.NOTES = notesH(t); D.TMR = tmrH(t);
    return saved;
  }
  function restoreMetrics(saved) { const D = TD(); if (!D || !saved) return; D.NOTES = saved.NOTES; D.TMR = saved.TMR; }
  function withTodoMetrics(t, fn) { const s = applyTodoMetrics(t); try { return fn(); } finally { restoreMetrics(s); } }
  function fixTodoLayout(L, t) {
    if (!L || !t) return L;
    const D = TD();
    const nPri = (t.pri && t.pri.length) ? t.pri.length : 3;
    const wantH = D.HEAD + nPri * D.ROW + 8;
    const dy = wantH - (L.pri ? L.pri.h : wantH);
    if (L.pri) L.pri.h = wantH;
    const row = (box, i, list) => ({
      i, id: list[i].id,
      y: box.y + D.HEAD + i * D.ROW, h: D.ROW,
      check: { x: box.x + 22, y: box.y + D.HEAD + i * D.ROW + (D.ROW - D.BOX) / 2 },
      write: { x: box.x + 62, y: box.y + D.HEAD + i * D.ROW, w: box.w - 74, h: D.ROW }
    });
    if (L.pri && t.pri) L.priRows = t.pri.map((_, i) => row(L.pri, i, t.pri));
    if (dy) {
      const bump = b => { if (!b) return; b.y += dy; if (b.check) b.check.y += dy; if (b.write) b.write.y += dy; };
      bump(L.tasks);
      (L.rows || []).forEach(bump);
      if (L.add) L.add.y += dy;
      if (L.rowsBottom != null) L.rowsBottom += dy;
      bump(L.notes);
      bump(L.tomorrow);
      if (L.bottom != null) L.bottom += dy;
    }
    return L;
  }
  function layoutTodo(t) {
    if (window.V21ee && typeof V21ee.tdLayout === 'function') return withTodoMetrics(t, () => fixTodoLayout(V21ee.tdLayout(t), t));
    return null;
  }
  function drawTodoFixed(ctx, pg) {
    const t = pg.todo, L = layoutTodo(t), c = pal(), D = TD();
    if (!L) return;
    const font = typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif';
    const PW = typeof PAGE_W === 'number' ? PAGE_W : 1000, PH = typeof PAGE_H === 'number' ? PAGE_H : 1430;
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, PW, PH);
    ctx.fillStyle = c.ink; ctx.font = '700 32px ' + font; ctx.fillText('Daily To-Do', D.X + 4, 62);
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(D.X, 90); ctx.lineTo(D.X + D.W, 90); ctx.stroke();
    const box = (f, fill) => { rr(ctx, f.x, f.y, f.w, f.h, 10); ctx.fillStyle = fill || c.box; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke(); };
    lab(ctx, c, 'Date', L.date.x + 2, L.date.y + 16);
    ctx.strokeStyle = c.rule; ctx.lineWidth = 1.4; ctx.beginPath();
    ctx.moveTo(L.date.x + 56, L.date.y + L.date.h - 12); ctx.lineTo(L.date.x + L.date.w, L.date.y + L.date.h - 12); ctx.stroke();
    const rows = (bx, list, numbered) => (list || []).forEach((r, i) => {
      const k = r.check; rr(ctx, k.x, k.y, D.BOX, D.BOX, 6); ctx.strokeStyle = c.gray; ctx.lineWidth = 2; ctx.stroke();
      if (numbered) { ctx.fillStyle = c.accent; ctx.font = '800 15px ' + font; ctx.fillText(String(i + 1), bx.x + 6, k.y + 19); }
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(r.write.x, r.y + r.h - 10); ctx.lineTo(r.write.x + r.write.w, r.y + r.h - 10); ctx.stroke();
    });
    const priLabel = (t.pri && t.pri.length === 3) ? '★ Top 3 priorities' : '★ Priorities';
    box(L.pri, c.block); lab(ctx, c, priLabel, L.pri.x + 14, L.pri.y + 23, 13); rows(L.pri, L.priRows, true);
    box(L.tasks, c.block); lab(ctx, c, 'Tasks', L.tasks.x + 14, L.tasks.y + 23, 13); rows(L.tasks, L.rows, false);
    for (const f of [L.notes, L.tomorrow].filter(Boolean)) {
      box(f); lab(ctx, c, f.label, f.x + 14, f.y + 23, 13);
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let yy = f.y + 36 + D.NOTE_LH - 6; yy < f.y + f.h - 8; yy += D.NOTE_LH) {
        ctx.moveTo(f.x + 14, yy); ctx.lineTo(f.x + f.w - 14, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  function lineBand(box, i, lh, head) {
    const first = box.y + (head != null ? head : 36) + lh - 6;
    const yy = first + i * lh;
    return { x: box.x, y: yy - lh + 6, w: box.w, h: lh };
  }
  function commitTodo(n, pi, msg) {
    persist(n);
    try { if (window.thumbCache && thumbCache.clear) thumbCache.clear(); } catch (_) {}
    if (typeof renderPageInk === 'function') renderPageInk(pi);
    if (typeof renderOverlay === 'function') renderOverlay(pi);
    if (msg && typeof actionToast === 'function') actionToast(msg, 'Undo', () => restore(S.undo, S.redo), 5000);
  }
  function guardNote() {
    const n = typeof curNote === 'function' ? curNote() : null;
    if (!n) return null;
    if (sealed(n)) { toastMsg('Unlock the note first'); return null; }
    return n;
  }

  async function todoAdd(pi, sec) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo, D = TD();
    return withTodoMetrics(t, () => {
      const L = layoutTodo(t);
      if (sec === 'pri') {
        const y0 = L.pri.y + L.pri.h;
        t.pri.push({ id: newId('tp'), done: false });
        if (layoutTodo(t).bottom > LIMIT) { t.pri.pop(); toastMsg('The page is full — remove a line first'); return false; }
        t.pri.pop(); pushHistory(); t.pri.push({ id: newId('tp'), done: false });
        shiftInk(pg, y0, D.ROW); commitTodo(n, pi); return true;
      }
      if (sec === 'tasks') {
        const y0 = L.rowsBottom;
        t.rows.push({ id: newId('tr'), done: false });
        if (layoutTodo(t).bottom > LIMIT) { t.rows.pop(); toastMsg('The page is full — remove a line first'); return false; }
        t.rows.pop(); pushHistory(); t.rows.push({ id: newId('tr'), done: false });
        shiftInk(pg, y0, D.ROW); commitTodo(n, pi); return true;
      }
      if (sec === 'notes' || sec === 'tomorrow') {
        if (sec === 'tomorrow' && !t.tomorrow) return false;
        const box = sec === 'notes' ? L.notes : L.tomorrow;
        const y0 = box.y + box.h;
        if (sec === 'notes') t.notesLines = notesCount(t) + 1; else t.tmrLines = tmrCount(t) + 1;
        const L2 = layoutTodo(t);
        if (L2.bottom > LIMIT) {
          if (sec === 'notes') t.notesLines = notesCount(t) - 1; else t.tmrLines = tmrCount(t) - 1;
          toastMsg('The page is full — remove a line first'); return false;
        }
        if (sec === 'notes') t.notesLines = notesCount(t) - 1; else t.tmrLines = tmrCount(t) - 1;
        pushHistory();
        if (sec === 'notes') t.notesLines = notesCount(t) + 1; else t.tmrLines = tmrCount(t) + 1;
        shiftInk(pg, y0, D.NOTE_LH); commitTodo(n, pi); return true;
      }
      return false;
    });
  }

  async function todoRemoveLast(pi, sec) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo, D = TD();
    const plan = withTodoMetrics(t, () => {
      const L = layoutTodo(t);
      if (sec === 'pri') {
        if (t.pri.length <= 1) { toastMsg('Priorities keep at least one line'); return { block: true }; }
        const i = t.pri.length - 1, R = L.priRows[i], band = { x: D.X, y: R.y, w: D.W, h: D.ROW };
        return { kind: 'pri', i, band, y0: R.y + D.ROW, dy: -D.ROW, checked: !!t.pri[i].done, ink: bandHasWriting(pg, band) };
      }
      if (sec === 'tasks') {
        if (t.rows.length <= 1) { toastMsg('The task list keeps at least one line'); return { block: true }; }
        const i = t.rows.length - 1, R = L.rows[i], band = { x: D.X, y: R.y, w: D.W, h: D.ROW };
        return { kind: 'tasks', id: t.rows[i].id, i, band, checked: !!t.rows[i].done, ink: bandHasWriting(pg, band) };
      }
      if (sec === 'notes' || sec === 'tomorrow') {
        if (sec === 'tomorrow' && !t.tomorrow) return { block: true };
        const count = sec === 'notes' ? notesCount(t) : tmrCount(t);
        if (count <= 1) { toastMsg('This section keeps at least one line'); return { block: true }; }
        const box = sec === 'notes' ? L.notes : L.tomorrow;
        const band = lineBand(box, count - 1, D.NOTE_LH, 36);
        return { kind: sec, band, y0: box.y + box.h, dy: -D.NOTE_LH, ink: bandHasWriting(pg, band) };
      }
      return { block: true };
    });
    if (!plan || plan.block) return false;
    if (plan.ink || plan.checked) {
      const why = plan.ink && plan.checked ? 'This line has handwriting and is checked. Removing it also removes that writing. You can undo this.'
        : plan.ink ? 'This line has handwriting. Removing it also removes that writing. You can undo this.'
        : 'This line is checked. You can undo this.';
      if (!(await confirmBox('Remove this line?', why, 'Remove line'))) return false;
    }
    pushHistory();
    withTodoMetrics(t, () => {
      takeInkIn(pg, plan.band);
      if (plan.kind === 'pri') { t.pri.splice(plan.i, 1); shiftInk(pg, plan.y0, plan.dy); }
      else if (plan.kind === 'tasks') { t.rows.splice(plan.i, 1); shiftInk(pg, plan.band.y + D.ROW, -D.ROW); }
      else if (plan.kind === 'notes') { t.notesLines = notesCount(t) - 1; shiftInk(pg, plan.y0, plan.dy); }
      else if (plan.kind === 'tomorrow') { t.tmrLines = tmrCount(t) - 1; shiftInk(pg, plan.y0, plan.dy); }
    });
    commitTodo(n, pi, 'Line removed');
    return true;
  }

  async function todoRemovePriAt(pi, id, force) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo, D = TD();
    const i = t.pri.findIndex(r => r.id === id); if (i < 0) return false;
    if (t.pri.length <= 1) { toastMsg('Priorities keep at least one line'); return false; }
    const plan = withTodoMetrics(t, () => {
      const L = V21ee.tdLayout(t), R = L.priRows[i], band = { x: D.X, y: R.y, w: D.W, h: D.ROW };
      return { band, y0: R.y + D.ROW, checked: !!t.pri[i].done, ink: bandHasWriting(pg, band) };
    });
    if (!force && (plan.ink || plan.checked)) {
      if (!(await confirmBox('Remove this line?', plan.ink ? 'This line has handwriting. Removing it also removes that writing. You can undo this.' : 'This line is checked. You can undo this.', 'Remove line'))) return false;
    }
    pushHistory();
    takeInkIn(pg, plan.band); t.pri.splice(i, 1); shiftInk(pg, plan.y0, -D.ROW);
    commitTodo(n, pi, 'Line removed'); return true;
  }
  async function todoRemoveTaskAt(pi, id, force) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo, D = TD();
    const i = t.rows.findIndex(r => r.id === id); if (i < 0) return false;
    if (t.rows.length <= 1) { toastMsg('The task list keeps at least one line'); return false; }
    const plan = withTodoMetrics(t, () => {
      const L = layoutTodo(t), R = L.rows[i];
      const band = { x: D.X, y: R.y, w: D.W, h: D.ROW };
      return { band, y0: R.y + D.ROW, checked: !!t.rows[i].done, ink: bandHasWriting(pg, band) };
    });
    if (!force && (plan.ink || plan.checked)) {
      const why = plan.ink && plan.checked ? 'This line has handwriting and is checked. Removing it also removes that writing. You can undo this.'
        : plan.ink ? 'This line has handwriting. Removing it also removes that writing. You can undo this.'
        : 'This line is checked. You can undo this.';
      if (!(await confirmBox('Remove this line?', why, 'Remove line'))) return false;
    }
    pushHistory();
    takeInkIn(pg, plan.band);
    t.rows.splice(i, 1);
    shiftInk(pg, plan.y0, -D.ROW);
    commitTodo(n, pi, 'Line removed');
    return true;
  }
  async function todoToggleTomorrow(pi, force) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo;
    const L = layoutTodo(t);
    if (t.tomorrow) {
      const box = L.tomorrow;
      if (!force && bandHasWriting(pg, box)) {
        if (!(await confirmBox('Hide the Tomorrow box?', 'This box has handwriting. Hiding it also removes that writing. You can undo this.', 'Hide box'))) return false;
      }
      pushHistory();
      if (box) takeInkIn(pg, box);
      t.tomorrow = false;
      commitTodo(n, pi, 'Tomorrow box hidden');
      return true;
    }
    t.tomorrow = true;
    if (layoutTodo(t).bottom > LIMIT) { t.tomorrow = false; toastMsg('The page is full — remove a line first'); return false; }
    t.tomorrow = false; pushHistory(); t.tomorrow = true;
    commitTodo(n, pi); return true;
  }

  function placePair(rec, box, html, extra) {
    if (!box) return null;
    const s = S.scale, pw = 72, ph = 32, inset = 8;
    const wrap = document.createElement('div');
    wrap.className = 'ff-pm';
    if (extra) for (const k in extra) wrap.setAttribute(k, extra[k]);
    let right = (box.x + box.w - inset) * s;
    if (extra && extra['data-beside']) {
      const other = rec.ov.querySelector(extra['data-beside']);
      if (other) {
        const or_ = other.getBoundingClientRect(), ov = rec.ov.getBoundingClientRect();
        right = (or_.left - ov.left) - 8;
      }
    }
    const width = pw * s;
    const boxLeft = box.x * s, boxRight = (box.x + box.w - inset) * s;
    const left = Math.max(boxLeft + 4, Math.min(right - width, boxRight - width));
    Object.assign(wrap.style, {
      left: left + 'px',
      top: (box.y + 3) * s + 'px',
      width: width + 'px',
      height: Math.max(28, ph * s) + 'px'
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('button').forEach(b => { b.style.width = (width / 2) + 'px'; b.style.height = '100%'; });
    rec.ov.append(wrap);
    return wrap;
  }
  function pinLeftBubbles(rec, D, s) {
    rec.ov.querySelectorAll('.td-delrow, .ff-delrow').forEach(b => {
      b.style.transform = 'translateY(-50%)';
      b.style.left = Math.max(2, (D.X - 38) * s) + 'px';
    });
  }
  function drawTodoPairs(pi, pg, rec) {
    if (!pg.todo || !window.V21ee) return;
    rec.ov.querySelectorAll('.ff-pm, .ff-delrow').forEach(b => b.remove());
    rec.ov.querySelectorAll('.td-addline').forEach(b => { b.hidden = true; b.style.display = 'none'; });
    const s = S.scale, t = pg.todo, D = TD();
    const L = layoutTodo(t); if (!L) return;
    const tmr = rec.ov.querySelector('.td-tmr, .ff-tmr');
    if (tmr && L.notes) {
      // Cancel v21er's margin-top:-10px so the 44px hit area stays inside the Notes box.
      tmr.style.left = (L.notes.x + L.notes.w - 8) * s + 'px';
      tmr.style.top = (L.notes.y + 4) * s + 'px';
      tmr.style.marginTop = '0px';
      tmr.style.transform = 'translateX(-100%)';
    }
    const pairHtml = (sec, enabledMinus) =>
      '<button type="button" class="ff-plus" data-sec="' + sec + '" aria-label="Add a line to ' + sec + '" title="Add a line">＋</button>' +
      '<button type="button" class="ff-minus" data-sec="' + sec + '" ' + (enabledMinus ? '' : 'disabled') + ' aria-label="Remove the last line of ' + sec + '" title="Remove the last line">−</button>';
    placePair(rec, L.pri, pairHtml('pri', t.pri.length > 1), { 'data-sec': 'pri' });
    placePair(rec, L.tasks, pairHtml('tasks', t.rows.length > 1), { 'data-sec': 'tasks' });
    placePair(rec, L.notes, pairHtml('notes', notesCount(t) > 1), { 'data-sec': 'notes', 'data-beside': tmr ? '.td-tmr, .ff-tmr' : '' });
    if (L.tomorrow) placePair(rec, L.tomorrow, pairHtml('tomorrow', tmrCount(t) > 1), { 'data-sec': 'tomorrow' });
    if (t.pri.length > 1) (L.priRows || []).forEach((R, i) => {
      const b = document.createElement('button');
      b.className = 'ff-delrow'; b.dataset.id = R.id; b.dataset.sec = 'pri';
      b.title = 'Remove this line'; b.setAttribute('aria-label', 'Remove priority line ' + (i + 1));
      b.style.top = (R.y + D.ROW / 2) * s + 'px';
      rec.ov.append(b);
    });
    pinLeftBubbles(rec, D, s);
  }

  const MODULES = [
    { type: 'title', label: 'Title header + Date', def: () => ({ heading: '', showDate: true }) },
    { type: 'heading', label: 'Heading / label', def: () => ({ text: 'Heading' }) },
    { type: 'lines', label: 'Lined notes', def: () => ({ heading: 'Notes', lines: 6 }) },
    { type: 'checklist', label: 'Checklist / tasks', def: () => ({ heading: 'Tasks', rows: 4, checks: true }) },
    { type: 'priorities', label: 'Top-3 priorities', def: () => ({ heading: 'Top 3 priorities', rows: 3 }) },
    { type: 'grid', label: 'Grid area', def: () => ({ heading: '', rows: 6 }) },
    { type: 'blank', label: 'Blank drawing area', def: () => ({ heading: '', height: 180 }) },
    { type: 'columns', label: 'Two-column lines', def: () => ({ heading: '', lines: 8 }) },
    { type: 'meeting', label: 'Meeting fields', def: () => ({ fields: ['Title', 'Date', 'Attendees', 'Location'] }) },
    { type: 'actions', label: 'Action items', def: () => ({ heading: 'Action items', rows: 3 }) },
    { type: 'tomorrow', label: 'Tomorrow / follow-up', def: () => ({ heading: 'Tomorrow', lines: 2 }) },
    { type: 'divider', label: 'Divider', def: () => ({}) },
    { type: 'quote', label: 'Quote-style table', def: () => ({ heading: 'Quote', rows: 4, cols: ['Item', 'Qty', 'Price', 'Notes'] }) }
  ];
  const modDef = type => (MODULES.find(m => m.type === type) || MODULES[2]).def();
  function newModule(type) { return Object.assign({ id: newId('tm'), type }, modDef(type)); }

  let templates = [];
  let readyP = null;

  function openTplDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function loadTemplates() {
    try {
      const db = await openTplDb();
      const list = await new Promise((res, rej) => {
        const t = db.transaction(IDB_STORE, 'readonly');
        const q = t.objectStore(IDB_STORE).getAll();
        q.onsuccess = () => res(q.result || []);
        q.onerror = () => rej(q.error);
      });
      templates = (list || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } catch (e) { console.warn('v21ff templates load', e); templates = templates || []; }
    return templates;
  }
  async function putTemplate(obj) {
    const db = await openTplDb();
    await new Promise((res, rej) => {
      const t = db.transaction(IDB_STORE, 'readwrite');
      t.objectStore(IDB_STORE).put(obj);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    const i = templates.findIndex(x => x.id === obj.id);
    if (i >= 0) templates[i] = obj; else templates.push(obj);
    return obj;
  }
  async function delTemplate(id) {
    const db = await openTplDb();
    await new Promise((res, rej) => {
      const t = db.transaction(IDB_STORE, 'readwrite');
      t.objectStore(IDB_STORE).delete(id);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
    templates = templates.filter(x => x.id !== id);
    return true;
  }
  function getTemplate(id) { return templates.find(x => x.id === id) || null; }
  function listTemplates() { return templates.slice(); }
  function cloneModules(mods) { return (mods || []).map(m => JSON.parse(JSON.stringify(m))); }
  function freshState(mods) {
    const s = {};
    for (const m of mods || []) {
      if (m.type === 'checklist' || m.type === 'actions' || m.type === 'priorities') {
        const n = Math.max(1, m.rows || 3);
        s[m.id] = { rows: Array.from({ length: n }, () => ({ id: newId('cr'), done: false })) };
      } else if (m.type === 'lines' || m.type === 'columns') {
        s[m.id] = { lines: Math.max(1, m.lines || 4) };
      } else if (m.type === 'tomorrow') {
        s[m.id] = { lines: Math.max(1, m.lines || 2), on: true };
      } else if (m.type === 'quote') {
        s[m.id] = { rows: Math.max(1, m.rows || 4) };
      } else if (m.type === 'grid') {
        s[m.id] = { rows: Math.max(1, m.rows || 6) };
      } else if (m.type === 'blank') {
        s[m.id] = { height: m.height || 180 };
      }
    }
    return s;
  }
  function stOf(pg, m) { pg.customTpl.state = pg.customTpl.state || {}; return pg.customTpl.state[m.id] || (pg.customTpl.state[m.id] = {}); }

  function moduleHeight(m, st) {
    const rowsOf = () => (st && st.rows ? st.rows.length : (m.rows || 3));
    const linesOf = () => (st && st.lines != null ? st.lines : (m.lines || 4));
    switch (m.type) {
      case 'title': return 70;
      case 'heading': return 36;
      case 'divider': return 16;
      case 'lines': return HEAD + linesOf() * LH + 10;
      case 'columns': return HEAD + linesOf() * LH + 10;
      case 'checklist':
      case 'actions':
      case 'priorities': return HEAD + rowsOf() * ROW + 8;
      case 'grid': return HEAD + (st && st.rows != null ? st.rows : (m.rows || 6)) * 40 + 8;
      case 'blank': return HEAD + (st && st.height != null ? st.height : (m.height || 180));
      case 'meeting': return 16 + ((m.fields && m.fields.length) || 4) * 52;
      case 'tomorrow': {
        if (st && st.on === false) return 0;
        return HEAD + linesOf() * LH + 10;
      }
      case 'quote': {
        const rows = st && st.rows != null ? st.rows : (m.rows || 4);
        return HEAD + 28 + rows * 44 + 8;
      }
      default: return 40;
    }
  }
  function custLayout(pg) {
    const tpl = pg.customTpl, out = [];
    let y = TOP;
    for (const m of tpl.modules || []) {
      const st = (tpl.state || {})[m.id];
      const h = moduleHeight(m, st);
      if (h <= 0) { out.push({ m, st, x: X, y, w: W, h: 0, hidden: true }); continue; }
      const box = { m, st, x: X, y, w: W, h };
      if (m.type === 'checklist' || m.type === 'actions' || m.type === 'priorities') {
        const list = (st && st.rows) || [];
        box.rows = list.map((r, i) => ({
          i, id: r.id, y: y + HEAD + i * ROW, h: ROW,
          check: { x: X + 22, y: y + HEAD + i * ROW + (ROW - BOX) / 2 },
          write: { x: X + 62, y: y + HEAD + i * ROW, w: W - 74, h: ROW }
        }));
      }
      if (m.type === 'lines' || m.type === 'tomorrow' || m.type === 'columns') {
        box.lineN = (st && st.lines != null) ? st.lines : (m.lines || 4);
      }
      out.push(box);
      y += h + GAP;
    }
    return { boxes: out, bottom: y };
  }

  function pal() {
    const d = typeof isDark === 'function' && isDark();
    return {
      paper: d ? '#1f1f23' : '#fffdf8', box: d ? 'rgba(255,255,255,.03)' : '#ffffff',
      block: d ? 'rgba(255,255,255,.015)' : 'rgba(250,249,245,1)',
      edge: d ? 'rgba(200,200,220,.26)' : 'rgba(60,60,80,.24)',
      rule: d ? 'rgba(200,200,220,.20)' : 'rgba(60,60,80,.20)',
      gray: d ? 'rgba(200,200,215,.62)' : 'rgba(70,70,90,.6)',
      ink: d ? '#e6e6ea' : '#1d1d1f', accent: d ? '#8b85ff' : '#4f46e5'
    };
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function lab(ctx, c, t, x, y, size) {
    ctx.fillStyle = c.gray; ctx.font = '700 ' + (size || 12) + 'px ' + (typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif');
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
    ctx.fillText(String(t || '').toUpperCase(), x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  function drawCustom(ctx, pg) {
    const tpl = pg.customTpl, c = pal(), font = typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif';
    const L = custLayout(pg);
    ctx.save(); ctx.textBaseline = 'alphabetic';
    for (const b of L.boxes) {
      if (b.hidden) continue;
      const m = b.m, st = b.st;
      const boxy = () => { rr(ctx, b.x, b.y, b.w, b.h, 10); ctx.fillStyle = c.block; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke(); };
      if (m.type === 'title') {
        const heading = (m.heading && m.heading.trim()) || tpl.name || 'Note';
        ctx.fillStyle = c.ink; ctx.font = '700 32px ' + font; ctx.fillText(heading, b.x + 4, b.y + 44);
        if (m.showDate !== false) {
          lab(ctx, c, 'Date', b.x + b.w - 330, b.y + 16);
          ctx.strokeStyle = c.rule; ctx.lineWidth = 1.4; ctx.beginPath();
          ctx.moveTo(b.x + b.w - 270, b.y + b.h - 12); ctx.lineTo(b.x + b.w, b.y + b.h - 12); ctx.stroke();
        }
        ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.stroke();
      } else if (m.type === 'heading') {
        ctx.fillStyle = c.accent; ctx.font = '700 22px ' + font; ctx.fillText(m.text || 'Heading', b.x + 4, b.y + 26);
      } else if (m.type === 'divider') {
        ctx.strokeStyle = c.edge; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(b.x, b.y + 8); ctx.lineTo(b.x + b.w, b.y + 8); ctx.stroke();
      } else if (m.type === 'lines' || m.type === 'tomorrow') {
        boxy(); lab(ctx, c, m.heading || (m.type === 'tomorrow' ? 'Tomorrow' : 'Notes'), b.x + 14, b.y + 23, 13);
        ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < (b.lineN || 0); i++) {
          const yy = b.y + 36 + LH - 6 + i * LH;
          ctx.moveTo(b.x + 14, yy); ctx.lineTo(b.x + b.w - 14, yy);
        }
        ctx.stroke();
      } else if (m.type === 'columns') {
        boxy(); if (m.heading) lab(ctx, c, m.heading, b.x + 14, b.y + 23, 13);
        const mid = b.x + b.w / 2;
        ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mid, b.y + 32); ctx.lineTo(mid, b.y + b.h - 8); ctx.stroke();
        ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < (b.lineN || 0); i++) {
          const yy = b.y + 36 + LH - 6 + i * LH;
          ctx.moveTo(b.x + 14, yy); ctx.lineTo(mid - 12, yy);
          ctx.moveTo(mid + 12, yy); ctx.lineTo(b.x + b.w - 14, yy);
        }
        ctx.stroke();
      } else if (m.type === 'checklist' || m.type === 'actions' || m.type === 'priorities') {
        boxy(); lab(ctx, c, m.heading || (m.type === 'priorities' ? 'Top 3 priorities' : m.type === 'actions' ? 'Action items' : 'Tasks'), b.x + 14, b.y + 23, 13);
        (b.rows || []).forEach((r, i) => {
          const k = r.check; rr(ctx, k.x, k.y, BOX, BOX, 6); ctx.strokeStyle = c.gray; ctx.lineWidth = 2; ctx.stroke();
          if (m.type === 'priorities') { ctx.fillStyle = c.accent; ctx.font = '800 15px ' + font; ctx.fillText(String(i + 1), b.x + 6, k.y + 19); }
          ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
          ctx.moveTo(r.write.x, r.y + r.h - 10); ctx.lineTo(r.write.x + r.write.w, r.y + r.h - 10); ctx.stroke();
        });
      } else if (m.type === 'grid') {
        boxy(); if (m.heading) lab(ctx, c, m.heading, b.x + 14, b.y + 23, 13);
        const top = b.y + (m.heading ? HEAD : 8), bot = b.y + b.h - 8, left = b.x + 10, right = b.x + b.w - 10;
        ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.beginPath();
        for (let yy = top; yy <= bot + 0.5; yy += 40) { ctx.moveTo(left, yy); ctx.lineTo(right, yy); }
        for (let xx = left; xx <= right + 0.5; xx += 40) { ctx.moveTo(xx, top); ctx.lineTo(xx, bot); }
        ctx.stroke();
      } else if (m.type === 'blank') {
        boxy(); if (m.heading) lab(ctx, c, m.heading, b.x + 14, b.y + 23, 13);
      } else if (m.type === 'meeting') {
        const fields = m.fields && m.fields.length ? m.fields : ['Title', 'Date', 'Attendees', 'Location'];
        fields.forEach((f, i) => {
          const yy = b.y + 44 + i * 52;
          lab(ctx, c, f, b.x + 2, yy - 16, 12);
          ctx.strokeStyle = c.rule; ctx.lineWidth = 1.4; ctx.beginPath();
          ctx.moveTo(b.x + 8, yy); ctx.lineTo(b.x + b.w, yy); ctx.stroke();
        });
      } else if (m.type === 'quote') {
        boxy(); lab(ctx, c, m.heading || 'Quote', b.x + 14, b.y + 23, 13);
        const cols = m.cols && m.cols.length ? m.cols : ['Item', 'Qty', 'Price', 'Notes'];
        const rows = st && st.rows != null ? st.rows : (m.rows || 4);
        const widths = cols.length === 4 ? [0.40, 0.14, 0.18, 0.28] : cols.map(() => 1 / cols.length);
        let x = b.x + 8; const colX = [];
        for (let i = 0; i < cols.length; i++) { colX.push(x); x += (b.w - 16) * widths[i]; }
        colX.push(b.x + b.w - 8);
        const headY = b.y + HEAD + 20;
        ctx.fillStyle = c.gray; ctx.font = '700 11px ' + font;
        cols.forEach((name, i) => ctx.fillText(String(name).toUpperCase(), colX[i] + 4, headY - 6));
        ctx.strokeStyle = c.rule; ctx.lineWidth = 1.1; ctx.beginPath();
        for (let r = 0; r <= rows; r++) { const yy = headY + r * 44; ctx.moveTo(b.x + 8, yy); ctx.lineTo(b.x + b.w - 8, yy); }
        colX.forEach(xx => { ctx.moveTo(xx, headY - 22); ctx.lineTo(xx, headY + rows * 44); });
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function applyCustomToPage(p, template) {
    const mods = cloneModules(template.modules || []);
    p.paper = 'blank';
    p.bg = { type: 'template', name: 'custom', templateId: template.id, title: template.name };
    p.customTpl = { v: 1, templateId: template.id, name: template.name, color: template.color, modules: mods, state: freshState(mods) };
    return p;
  }

  function growable(m) {
    return /^(checklist|actions|priorities|lines|columns|tomorrow|quote|grid)$/.test(m.type);
  }
  function custAdd(pi, mid) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return false;
    const box = custLayout(pg).boxes.find(b => b.m.id === mid); if (!box || box.hidden) return false;
    const m = box.m, st = stOf(pg, m);
    const dy = (m.type === 'checklist' || m.type === 'actions' || m.type === 'priorities') ? ROW
      : (m.type === 'quote') ? 44
      : (m.type === 'grid') ? 40
      : LH;
    const y0 = box.y + box.h;
    if (custLayout(pg).bottom + dy > LIMIT) { toastMsg('The page is full — remove a line first'); return false; }
    pushHistory();
    if (m.type === 'checklist' || m.type === 'actions' || m.type === 'priorities') {
      st.rows = (st.rows || []).concat([{ id: newId('cr'), done: false }]);
    } else if (m.type === 'lines' || m.type === 'columns' || m.type === 'tomorrow') {
      st.lines = ((st.lines != null) ? st.lines : (m.lines || 4)) + 1;
    } else if (m.type === 'quote') { st.rows = ((st.rows != null) ? st.rows : (m.rows || 4)) + 1; }
    else if (m.type === 'grid') { st.rows = ((st.rows != null) ? st.rows : (m.rows || 6)) + 1; }
    else return false;
    shiftInk(pg, y0, dy); commitTodo(n, pi); return true;
  }
  async function custRemoveLast(pi, mid) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return false;
    const box = custLayout(pg).boxes.find(b => b.m.id === mid); if (!box || box.hidden) return false;
    const m = box.m, st = stOf(pg, m);
    let band, dy, apply;
    if (m.type === 'checklist' || m.type === 'actions' || m.type === 'priorities') {
      const rows = st.rows || []; if (rows.length <= 1) { toastMsg('This list keeps at least one line'); return false; }
      const R = box.rows[rows.length - 1];
      band = { x: box.x, y: R.y, w: box.w, h: ROW };
      dy = -ROW;
      apply = () => { st.rows = rows.slice(0, -1); };
      if (rows[rows.length - 1].done || bandHasWriting(pg, band)) {
        if (!(await confirmBox('Remove this line?', bandHasWriting(pg, band) ? 'This line has handwriting. Removing it also removes that writing. You can undo this.' : 'This line is checked. You can undo this.', 'Remove line'))) return false;
      }
    } else if (m.type === 'lines' || m.type === 'columns' || m.type === 'tomorrow') {
      const nL = (st.lines != null) ? st.lines : (m.lines || 4);
      if (nL <= 1) { toastMsg('This section keeps at least one line'); return false; }
      band = lineBand(box, nL - 1, LH, 36); dy = -LH;
      apply = () => { st.lines = nL - 1; };
      if (bandHasWriting(pg, band) && !(await confirmBox('Remove this line?', 'This line has handwriting. Removing it also removes that writing. You can undo this.', 'Remove line'))) return false;
    } else if (m.type === 'quote') {
      const nR = (st.rows != null) ? st.rows : (m.rows || 4);
      if (nR <= 1) { toastMsg('The table keeps at least one row'); return false; }
      const headY = box.y + HEAD + 20;
      band = { x: box.x, y: headY + (nR - 1) * 44, w: box.w, h: 44 }; dy = -44;
      apply = () => { st.rows = nR - 1; };
      if (bandHasWriting(pg, band) && !(await confirmBox('Remove this row?', 'This row has handwriting. Removing it also removes that writing. You can undo this.', 'Remove row'))) return false;
    } else if (m.type === 'grid') {
      const nR = (st.rows != null) ? st.rows : (m.rows || 6);
      if (nR <= 1) { toastMsg('The grid keeps at least one row'); return false; }
      band = { x: box.x, y: box.y + box.h - 48, w: box.w, h: 40 }; dy = -40;
      apply = () => { st.rows = nR - 1; };
      if (bandHasWriting(pg, band) && !(await confirmBox('Remove this row?', 'This row has handwriting. Removing it also removes that writing. You can undo this.', 'Remove row'))) return false;
    } else return false;
    pushHistory(); takeInkIn(pg, band); apply(); shiftInk(pg, box.y + box.h, dy);
    commitTodo(n, pi, 'Line removed'); return true;
  }
  async function custRemoveRow(pi, mid, rid) {
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return false;
    const box = custLayout(pg).boxes.find(b => b.m.id === mid); if (!box) return false;
    const st = stOf(pg, box.m), rows = st.rows || [];
    const i = rows.findIndex(r => r.id === rid); if (i < 0) return false;
    if (rows.length <= 1) { toastMsg('This list keeps at least one line'); return false; }
    const R = box.rows[i], band = { x: box.x, y: R.y, w: box.w, h: ROW };
    if ((rows[i].done || bandHasWriting(pg, band)) && !(await confirmBox('Remove this line?', bandHasWriting(pg, band) ? 'This line has handwriting. Removing it also removes that writing. You can undo this.' : 'This line is checked. You can undo this.', 'Remove line'))) return false;
    pushHistory(); takeInkIn(pg, band); st.rows.splice(i, 1); shiftInk(pg, R.y + ROW, -ROW);
    commitTodo(n, pi, 'Line removed'); return true;
  }
  function custToggle(pi, mid, rid) {
    const n = guardNote(); if (!n) return;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return;
    const m = (pg.customTpl.modules || []).find(x => x.id === mid); if (!m) return;
    const st = stOf(pg, m); const r = (st.rows || []).find(x => x.id === rid); if (!r) return;
    pushHistory(); r.done = !r.done; r.doneAt = r.done ? Date.now() : null; persist(n); renderOverlay(pi);
  }

  function drawCustomUI(pi, pg, rec) {
    rec.ov.querySelectorAll('.ff-pm, .ff-delrow, .ff-check, .ff-strike').forEach(b => b.remove());
    if (sealed(curNote())) return;
    const s = S.scale, L = custLayout(pg);
    const elBtn = (cls, x, y, html, attrs) => {
      const b = document.createElement('button'); b.className = cls; b.type = 'button';
      b.style.left = x * s + 'px'; b.style.top = y * s + 'px'; b.innerHTML = html;
      for (const k in (attrs || {})) b.setAttribute(k, attrs[k]); rec.ov.append(b); return b;
    };
    for (const box of L.boxes) {
      if (box.hidden) continue;
      const m = box.m;
      if (growable(m)) {
        placePair(rec, box,
          '<button type="button" class="ff-plus" data-mid="' + m.id + '" aria-label="Add a line">＋</button>' +
          '<button type="button" class="ff-minus" data-mid="' + m.id + '" aria-label="Remove the last line">−</button>',
          { 'data-mid': m.id });
      }
      if (box.rows) {
        box.rows.forEach((R, i) => {
          const row = (box.st.rows || [])[i]; if (!row) return;
          const done = !!row.done;
          const b = elBtn('td-ui td-check ff-check' + (done ? ' on' : ''), R.check.x + BOX / 2, R.check.y + BOX / 2, done ? '✓' : '', {
            'data-mid': m.id, 'data-id': R.id, role: 'checkbox', 'aria-checked': String(done)
          });
          b.style.setProperty('--box', BOX * s + 'px');
          if (done) {
            const stEl = document.createElement('div'); stEl.className = 'td-ui td-strike ff-strike';
            stEl.style.left = R.write.x * s + 'px'; stEl.style.top = (R.y + R.h * 0.62) * s + 'px'; stEl.style.width = R.write.w * s + 'px';
            rec.ov.append(stEl);
          }
          if (box.rows.length > 1) {
            const d = document.createElement('button');
            d.className = 'ff-delrow'; d.dataset.mid = m.id; d.dataset.id = R.id;
            d.title = 'Remove this line'; d.setAttribute('aria-label', 'Remove line ' + (i + 1));
            d.style.top = (R.y + ROW / 2) * s + 'px';
            rec.ov.append(d);
          }
        });
      }
    }
    pinLeftBubbles(rec, TD(), s);
  }

  let pickResolve = null;
  function closePicker(val) {
    const el = document.getElementById('ffPicker'); if (el) el.hidden = true;
    const m = document.getElementById('ffMenu'); if (m) m.remove();
    const r = pickResolve; pickResolve = null; if (r) r(val);
  }
  function premadeList() { return (typeof TEMPLATES !== 'undefined' ? TEMPLATES : []).slice(); }
  function pickerItem(k, label, color) {
    const dot = color ? '<span class="ff-dot" style="background:' + color + '"></span>' : '';
    const more = color != null ? '<button type="button" class="ff-more" data-more="' + k + '" aria-label="Template options">⋯</button>' : '';
    return '<div style="display:flex;align-items:center;gap:4px"><button type="button" class="ff-item" data-k="' + k + '">' + dot + '<span class="ff-name">' + esc(label) + '</span></button>' + more + '</div>';
  }
  function pickerHTML(title, extra) {
    const premade = premadeList().concat(extra || []);
    const mine = listTemplates();
    return '<div class="ff-pick"><h2>' + esc(title || 'Choose a template') + '</h2>' +
      '<div class="ff-sec">Premade</div>' + premade.map(t => pickerItem(t[0], t[1])).join('') +
      '<div class="ff-sec">My templates</div>' +
      (mine.length ? mine.map(t => pickerItem('custom:' + t.id, t.name, t.color || COLORS[0])).join('') : '<p class="fine" style="margin:8px 12px;color:var(--muted)">None yet — create one to see it here.</p>') +
      '<button type="button" class="ff-create" data-k="create-template">＋ Create template</button>' +
      '<button type="button" class="ff-cancel" data-k="">Cancel</button></div>';
  }
  function openPicker(title, extra) {
    return new Promise(res => {
      pickResolve = res;
      let el = document.getElementById('ffPicker');
      if (!el) { el = document.createElement('div'); el.id = 'ffPicker'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.append(el); }
      el.setAttribute('aria-label', title || 'Templates');
      el.innerHTML = pickerHTML(title, extra);
      el.hidden = false;
      el.onclick = ev => {
        const more = ev.target.closest('[data-more]');
        if (more) { ev.preventDefault(); ev.stopPropagation(); showTplMenu(more, more.getAttribute('data-more').slice(7)); return; }
        if (ev.target === el) { closePicker(null); return; }
        const b = ev.target.closest('[data-k]'); if (!b) return;
        const k = b.getAttribute('data-k');
        if (k === 'create-template') { closePicker(null); openBuilder(); return; }
        closePicker(k || null);
      };
    });
  }
  function paintPickerIfOpen() {
    const el = document.getElementById('ffPicker');
    if (!el || el.hidden) return;
    const title = el.querySelector('h2') ? el.querySelector('h2').textContent : 'Choose a template';
    el.innerHTML = pickerHTML(title, []);
  }
  function showTplMenu(anchor, id) {
    let m = document.getElementById('ffMenu'); if (m) m.remove();
    m = document.createElement('div'); m.id = 'ffMenu'; m.setAttribute('role', 'menu');
    m.innerHTML = '<button type="button" data-a="edit">Edit</button><button type="button" data-a="dup">Duplicate</button><button type="button" data-a="rename">Rename</button><button type="button" class="danger" data-a="del">Delete</button>';
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, r.right - 180) + 'px';
    m.style.top = (r.bottom + 4) + 'px';
    const close = () => { m.remove(); document.removeEventListener('pointerdown', out, true); };
    const out = ev => { if (!m.contains(ev.target) && ev.target !== anchor) close(); };
    setTimeout(() => document.addEventListener('pointerdown', out, true), 0);
    m.onclick = async ev => {
      const a = ev.target.closest('[data-a]'); if (!a) return;
      const act = a.dataset.a; close();
      const t = getTemplate(id); if (!t) return;
      if (act === 'edit') { closePicker(null); openBuilder(t); }
      else if (act === 'dup') { await duplicateTemplate(id); paintPickerIfOpen(); }
      else if (act === 'rename') {
        const name = typeof prompt === 'function' ? prompt('Rename template', t.name) : t.name;
        if (name && name.trim() && name.trim() !== t.name) { await renameTemplate(id, name.trim()); paintPickerIfOpen(); }
      } else if (act === 'del') {
        if (await confirmBox('Delete this template?', 'Notes you already made from it are not deleted.', 'Delete template')) {
          await delTemplate(id); paintPickerIfOpen();
        }
      }
    };
  }

  async function saveTemplateObj(partial) {
    const obj = {
      id: partial.id || newId('ct'),
      name: String(partial.name || 'Untitled template').trim() || 'Untitled template',
      color: partial.color || COLORS[0],
      modules: cloneModules(partial.modules || []),
      createdAt: partial.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    await putTemplate(obj);
    return obj;
  }
  async function duplicateTemplate(id) {
    const t = getTemplate(id); if (!t) return null;
    const copy = { id: newId('ct'), name: t.name + ' copy', color: t.color, createdAt: Date.now(), updatedAt: Date.now(), modules: cloneModules(t.modules) };
    return putTemplate(copy);
  }
  async function renameTemplate(id, name) {
    const t = getTemplate(id); if (!t) return null;
    t.name = name; t.updatedAt = Date.now();
    return putTemplate(t);
  }

  let builder = null;

  function openBuilder(existing) {
    builder = existing
      ? { id: existing.id, name: existing.name, color: existing.color || COLORS[0], modules: cloneModules(existing.modules || []), editing: null, dirty: false, createdAt: existing.createdAt }
      : { id: null, name: '', color: COLORS[0], modules: [], editing: null, dirty: false };
    renderBuilder();
  }
  function closeBuilder() {
    const el = document.getElementById('ffBuilder'); if (el) el.hidden = true;
    builder = null;
    if (builderFitRO) { try { builderFitRO.disconnect(); } catch (_) {} builderFitRO = null; }
    const g = document.getElementById('ffGhost'); if (g) g.remove();
  }
  let builderFitRO = null;
  function keepEditOnScreen() {
    const ed = document.querySelector('#ffBuilder .ff-edit');
    const wrap = document.querySelector('#ffBuilder .ff-canvas-wrap');
    if (!ed || !wrap) return;
    ed.style.left = ''; ed.style.right = '8px'; ed.style.top = '36px'; ed.style.bottom = '';
    const er = ed.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    if (er.right > wr.right - 8) { ed.style.right = 'auto'; ed.style.left = '8px'; }
    const er2 = ed.getBoundingClientRect();
    if (er2.bottom > wr.bottom - 8) { ed.style.top = 'auto'; ed.style.bottom = '8px'; }
    if (er2.left < wr.left + 4) { ed.style.left = '8px'; ed.style.right = 'auto'; }
  }
  function scaleForBuilder(pageEl, wrap) {
    if (!pageEl || !wrap) return 1;
    let sizer = wrap.querySelector('.ff-page-sizer');
    if (!sizer) {
      sizer = document.createElement('div');
      sizer.className = 'ff-page-sizer';
      wrap.append(sizer);
      sizer.append(pageEl);
    }
    const wr = wrap.getBoundingClientRect();
    const pad = 24;
    const availW = Math.max(80, wr.width - pad);
    const availH = Math.max(80, wr.height - pad);
    const sc = Math.max(0.2, Math.min(availW / 1000, availH / 1430));
    pageEl.style.transform = 'scale(' + sc + ')';
    pageEl.style.transformOrigin = 'top left';
    pageEl.style.margin = '0';
    sizer.style.width = (1000 * sc) + 'px';
    sizer.style.height = (1430 * sc) + 'px';
    pageEl.dataset.sc = String(sc);
    requestAnimationFrame(keepEditOnScreen);
    return sc;
  }
  function watchBuilderFit(wrap, page) {
    const fit = () => scaleForBuilder(page, wrap);
    if (builderFitRO) { try { builderFitRO.disconnect(); } catch (_) {} }
    if (typeof ResizeObserver === 'function') {
      builderFitRO = new ResizeObserver(fit);
      builderFitRO.observe(wrap);
    }
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    fit();
    requestAnimationFrame(fit);
  }
  function renderBuilder() {
    if (!builder) return;
    let el = document.getElementById('ffBuilder');
    if (!el) { el = document.createElement('div'); el.id = 'ffBuilder'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Template builder'); document.body.append(el); }
    const swatches = COLORS.map(c => '<button type="button" data-color="' + c + '" class="' + (c === builder.color ? 'on' : '') + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>').join('');
    const palHtml = MODULES.map(m => '<button type="button" class="ff-pal-item" data-type="' + m.type + '"><span class="ff-grip" aria-hidden="true">⋮⋮</span><span>' + esc(m.label) + '</span></button>').join('');
    el.innerHTML = '<div class="ff-b-bar">' +
        '<button type="button" class="btn" data-a="close">Close</button>' +
        '<input data-k="name" type="text" placeholder="Template name" value="' + esc(builder.name) + '" aria-label="Template name">' +
        '<div class="ff-swatches" role="listbox" aria-label="Icon color">' + swatches + '</div>' +
        '<button type="button" class="btn primary" data-a="save">Save</button>' +
      '</div>' +
      '<div class="ff-b-body">' +
        '<div class="ff-pal"><h3>Modules</h3>' + palHtml +
        '<p class="fine" style="margin:10px 8px;color:var(--muted);font:12px/1.35 sans-serif">Hold a module, then drag it onto the page. Tap to add it at the end. Tap a placed module’s Edit to rename it, set its lines, or delete it.</p></div>' +
        '<div class="ff-canvas-wrap"><div class="ff-page-sizer"><div class="ff-page" id="ffPage"></div></div></div>' +
      '</div>';
    el.hidden = false;
    paintBuilderPage();
    const wrap = el.querySelector('.ff-canvas-wrap'), page = el.querySelector('#ffPage');
    watchBuilderFit(wrap, page);
    hookBuilderEvents(el);
  }
  function paintBuilderPage() {
    const page = document.getElementById('ffPage'); if (!page || !builder) return;
    const pg = { customTpl: { name: builder.name || 'Template', modules: builder.modules, state: freshState(builder.modules) } };
    const L = custLayout(pg);
    page.innerHTML = '';
    const cv = document.createElement('canvas');
    cv.width = 1000; cv.height = 1430; cv.style.cssText = 'position:absolute;left:0;top:0;width:1000px;height:1430px;pointer-events:none';
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, 1000, 1430);
    try { drawCustom(ctx, pg); } catch (e) { console.warn('builder draw', e); }
    page.append(cv);
    L.boxes.forEach((b, i) => {
      if (b.hidden || b.h <= 0) return;
      const d = document.createElement('div');
      d.className = 'ff-mod' + (builder.editing === b.m.id ? ' on' : '');
      d.dataset.id = b.m.id; d.dataset.i = String(i);
      Object.assign(d.style, { top: b.y + 'px', height: b.h + 'px' });
      d.innerHTML = '<div class="ff-mod-tools"><button type="button" data-a="edit" data-id="' + b.m.id + '">Edit</button></div>';
      if (builder.editing === b.m.id) d.append(editPanel(b.m));
      page.append(d);
    });
    requestAnimationFrame(keepEditOnScreen);
  }
  function editPanel(m) {
    const w = document.createElement('div'); w.className = 'ff-edit'; w.dataset.id = m.id;
    const headingKey = m.type === 'heading' ? 'text' : 'heading';
    const showHead = m.type !== 'divider';
    let html = '';
    if (showHead) html += '<label>' + (m.type === 'heading' ? 'Label' : 'Heading') + '<input type="text" data-f="' + headingKey + '" value="' + esc(m[headingKey] || '') + '"></label>';
    if (m.type === 'title') html += '<label class="chk"><input type="checkbox" data-f="showDate" ' + (m.showDate !== false ? 'checked' : '') + '> Date field</label>';
    if (/^(lines|columns|tomorrow)$/.test(m.type)) html += '<label>Lines</label><div class="ff-step"><button type="button" data-step="-1">−</button><input type="number" min="1" max="24" data-f="lines" value="' + (m.lines || 4) + '"><button type="button" data-step="1">＋</button></div>';
    if (/^(checklist|actions|priorities|quote|grid)$/.test(m.type)) html += '<label>Rows</label><div class="ff-step"><button type="button" data-step="-1">−</button><input type="number" min="1" max="24" data-f="rows" value="' + (m.rows || 3) + '"><button type="button" data-step="1">＋</button></div>';
    if (m.type === 'checklist') html += '<label class="chk"><input type="checkbox" data-f="checks" ' + (m.checks !== false ? 'checked' : '') + '> Checkboxes</label>';
    if (m.type === 'blank') html += '<label>Height</label><div class="ff-step"><button type="button" data-step="-20">−</button><input type="number" min="80" max="800" data-f="height" value="' + (m.height || 180) + '"><button type="button" data-step="20">＋</button></div>';
    if (m.type === 'meeting') html += '<label>Fields (comma separated)<input type="text" data-f="fields" value="' + esc((m.fields || []).join(', ')) + '"></label>';
    html += '<button type="button" class="danger" data-a="delmod">Delete module</button>';
    w.innerHTML = html;
    return w;
  }
  function hookBuilderEvents(el) {
    el.querySelector('[data-k="name"]').addEventListener('input', e => { builder.name = e.target.value; builder.dirty = true; });
    el.querySelectorAll('.ff-swatches button').forEach(b => b.addEventListener('click', () => {
      builder.color = b.getAttribute('data-color'); builder.dirty = true;
      el.querySelectorAll('.ff-swatches button').forEach(x => x.classList.toggle('on', x === b));
    }));
    el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-a]');
      if (a && a.dataset.a === 'close') { closeBuilder(); return; }
      if (a && a.dataset.a === 'save') { saveBuilder(); return; }
    });
    el.querySelectorAll('.ff-pal-item').forEach(item => bindHoldDrag(item, { kind: 'palette', type: item.dataset.type, label: item.textContent.trim() }));
    bindPageInteractions(el);
  }
  function bindPageInteractions(el) {
    const page = el.querySelector('#ffPage');
    page.onclick = ev => {
      const ed = ev.target.closest('[data-a="edit"]');
      if (ed) { ev.preventDefault(); ev.stopPropagation(); builder.editing = ed.dataset.id; paintBuilderPage(); hookBuilderPageOnly(el); return; }
      const del = ev.target.closest('[data-a="delmod"]');
      if (del) { ev.preventDefault(); ev.stopPropagation(); removeModule(del.closest('.ff-edit').dataset.id); return; }
      const st = ev.target.closest('[data-step]');
      if (st) {
        const input = st.parentElement.querySelector('input'); if (!input) return;
        input.value = String(Math.max(+(input.min || 1), (+input.value || 0) + (+st.dataset.step)));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (ev.target.closest('.ff-edit')) return;
      if (!ev.target.closest('.ff-mod')) { builder.editing = null; paintBuilderPage(); hookBuilderPageOnly(el); }
    };
    page.oninput = ev => {
      const f = ev.target.dataset.f; if (!f) return;
      const id = ev.target.closest('.ff-edit').dataset.id;
      const m = builder.modules.find(x => x.id === id); if (!m) return;
      if (ev.target.type === 'checkbox') m[f] = ev.target.checked;
      else if (f === 'fields') m.fields = ev.target.value.split(',').map(s => s.trim()).filter(Boolean);
      else if (f === 'lines' || f === 'rows' || f === 'height') m[f] = Math.max(1, +ev.target.value || 1);
      else m[f] = ev.target.value;
      builder.dirty = true;
      paintBuilderPage(); hookBuilderPageOnly(el);
    };
    page.querySelectorAll('.ff-mod').forEach(mod => bindHoldDrag(mod, { kind: 'module', id: mod.dataset.id }));
  }
  function hookBuilderPageOnly(el) { bindPageInteractions(el); }

  function addModule(type, index) {
    if (!builder) return null;
    const m = newModule(type);
    if (index == null || index < 0 || index > builder.modules.length) builder.modules.push(m);
    else builder.modules.splice(index, 0, m);
    builder.dirty = true;
    if (document.getElementById('ffBuilder') && !document.getElementById('ffBuilder').hidden) {
      paintBuilderPage(); hookBuilderPageOnly(document.getElementById('ffBuilder'));
    }
    return m;
  }
  function reorderModule(from, to) {
    if (!builder) return false;
    const arr = builder.modules;
    if (from < 0 || from >= arr.length) return false;
    const [m] = arr.splice(from, 1);
    const at = Math.max(0, Math.min(arr.length, to));
    arr.splice(at, 0, m);
    builder.dirty = true;
    if (document.getElementById('ffBuilder') && !document.getElementById('ffBuilder').hidden) {
      paintBuilderPage(); hookBuilderPageOnly(document.getElementById('ffBuilder'));
    }
    return true;
  }
  function editModule(id, props) {
    if (!builder) return false;
    const m = builder.modules.find(x => x.id === id); if (!m) return false;
    Object.assign(m, props);
    builder.editing = id; builder.dirty = true;
    if (document.getElementById('ffBuilder') && !document.getElementById('ffBuilder').hidden) {
      paintBuilderPage(); hookBuilderPageOnly(document.getElementById('ffBuilder'));
    }
    return true;
  }
  function removeModule(id) {
    if (!builder) return false;
    builder.modules = builder.modules.filter(x => x.id !== id);
    if (builder.editing === id) builder.editing = null;
    builder.dirty = true;
    if (document.getElementById('ffBuilder') && !document.getElementById('ffBuilder').hidden) {
      paintBuilderPage(); hookBuilderPageOnly(document.getElementById('ffBuilder'));
    }
    return true;
  }
  async function saveBuilder() {
    if (!builder) return null;
    const name = (builder.name || '').trim();
    if (!name) { toastMsg('Give the template a name first'); const i = $1('#ffBuilder [data-k="name"]'); if (i) i.focus(); return null; }
    const obj = await saveTemplateObj({ id: builder.id, name, color: builder.color, modules: builder.modules, createdAt: builder.createdAt });
    builder.id = obj.id; builder.dirty = false;
    toastMsg('Template saved');
    closeBuilder();
    return obj;
  }

  function bindHoldDrag(el, info) {
    let st = null, timer = null, ghost = null, started = false;
    const isPen = e => e.pointerType === 'pen';
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } if (ghost) { ghost.remove(); ghost = null; } started = false; st = null; };
    const spawnGhost = (e, label) => {
      ghost = document.createElement('div'); ghost.id = 'ffGhost'; ghost.textContent = label;
      document.body.append(ghost);
      ghost.style.left = (e.clientX + 8) + 'px'; ghost.style.top = (e.clientY + 8) + 'px';
    };
    const indexAt = (clientY) => {
      const page = document.getElementById('ffPage'); if (!page || !builder) return 0;
      const sc = parseFloat(page.dataset.sc || '1') || 1;
      const r = page.getBoundingClientRect();
      const y = (clientY - r.top) / sc;
      const pg = { customTpl: { name: builder.name, modules: builder.modules, state: freshState(builder.modules) } };
      const L = custLayout(pg);
      for (let i = 0; i < L.boxes.length; i++) {
        if (y < L.boxes[i].y + L.boxes[i].h / 2) return i;
      }
      return L.boxes.length;
    };
    el.addEventListener('pointerdown', e => {
      if (isPen(e)) return;
      if (e.target.closest && e.target.closest('[data-a], .ff-edit, input, button:not(.ff-pal-item)')) return;
      if (e.button && e.button !== 0) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, info };
      started = false;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      timer = setTimeout(() => { timer = null; started = true; spawnGhost({ clientX: st.x, clientY: st.y }, info.kind === 'palette' ? info.label : 'Move'); }, HOLD_MS);
    });
    el.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      if (ghost) { ghost.style.left = (e.clientX + 8) + 'px'; ghost.style.top = (e.clientY + 8) + 'px'; }
      if (!started && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 14) {
        if (timer) { clearTimeout(timer); timer = null; }
      }
    });
    el.addEventListener('pointerup', e => {
      if (!st || e.pointerId !== st.id) return;
      const was = started, inf = st.info, cx = e.clientX, cy = e.clientY;
      clear();
      if (!builder) return;
      if (was) {
        const page = document.getElementById('ffPage'); if (!page) return;
        const r = page.getBoundingClientRect();
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
        const at = indexAt(cy);
        if (inf.kind === 'palette') addModule(inf.type, at);
        else if (inf.kind === 'module') {
          const from = builder.modules.findIndex(m => m.id === inf.id);
          if (from >= 0) {
            let to = at;
            if (to > from) to -= 1;
            reorderModule(from, to);
          }
        }
      } else if (inf.kind === 'palette') {
        addModule(inf.type);
      }
    });
    el.addEventListener('pointercancel', () => clear());
  }

  function customNameFromKind(kind) {
    if (!kind || !String(kind).startsWith('custom:')) return null;
    const key = String(kind).slice(7);
    const t = getTemplate(key);
    if (t) return t.name;
    const n = typeof curNote === 'function' ? curNote() : null;
    const p = n && n.pages && n.pages.find(pg => pg.customTpl && (pg.customTpl.templateId === key || pg.customTpl.name === key));
    return (p && p.customTpl && p.customTpl.name) || 'Note';
  }
  function hookTitles() {
    if (window.V21fc && typeof V21fc.templateDisplayName === 'function' && !V21fc.templateDisplayName._ff) {
      const _tdn = V21fc.templateDisplayName;
      V21fc.templateDisplayName = function (kind) {
        const c = customNameFromKind(kind);
        if (c) return c;
        return _tdn.apply(this, arguments);
      };
      V21fc.templateDisplayName._ff = true;
    }
    if (window.V21fe && typeof V21fe.noteKind === 'function' && !V21fe.noteKind._ff) {
      const _nk = V21fe.noteKind;
      V21fe.noteKind = function (n) {
        const p = n && n.pages && n.pages.find(pg => pg && pg.customTpl);
        if (p) return 'custom:' + (p.customTpl.templateId || p.customTpl.name || 'note');
        return _nk.apply(this, arguments);
      };
      V21fe.noteKind._ff = true;
    }
    if (window.V21fc && typeof V21fc.defaultNoteTitle === 'function' && !V21fc.defaultNoteTitle._ff) {
      const _dnt = V21fc.defaultNoteTitle;
      V21fc.defaultNoteTitle = function (kind, d) {
        const c = customNameFromKind(kind);
        if (c && c !== 'Note') {
          const fmt = V21fc.formatTitleDate || (x => (x || new Date()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }));
          return c + ' – ' + fmt(d);
        }
        return _dnt.apply(this, arguments);
      };
      V21fc.defaultNoteTitle._ff = true;
    }
    if (typeof createNote === 'function' && !createNote._ffTitle) {
      const _cn = createNote;
      createNote = function (nbId, kind) {
        const done = () => {
          if (!(kind && String(kind).startsWith('custom:'))) return;
          const n = typeof curNote === 'function' ? curNote() : null;
          const name = customNameFromKind(kind);
          if (!n || !name) return;
          const fmt = (window.V21fc && V21fc.formatTitleDate) ? V21fc.formatTitleDate : (x => (x || new Date()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }));
          n.title = name + ' – ' + fmt(n.createdAt ? new Date(n.createdAt) : new Date());
          try { saveNote(n, true); } catch (_) { try { saveNote(n); } catch (__) {} }
          const inp = document.getElementById('noteTitle');
          if (inp && S.cur === n.id) { inp.value = n.title; inp.dataset.defaultTitle = n.title; }
          try { renderSidebar(); } catch (_) {}
        };
        const r = _cn.apply(this, arguments);
        if (r && typeof r.then === 'function') return r.then(v => { done(); return v; });
        done();
        return r;
      };
      createNote._ffTitle = true;
    }
  }
  function hookMakePage() {
    if (typeof makeTemplatePage !== 'function' || makeTemplatePage._ff) return;
    const _mtp = makeTemplatePage;
    makeTemplatePage = function (kind, note, date) {
      if (kind && String(kind).startsWith('custom:')) {
        const t = getTemplate(String(kind).slice(7));
        const p = _mtp.call(this, 'blank', note, date);
        if (t) applyCustomToPage(p, t);
        return p;
      }
      return _mtp.apply(this, arguments);
    };
    makeTemplatePage._ff = true;
  }
  function hookChoose() {
    if (typeof chooseTemplate !== 'function' || chooseTemplate._ff) return;
    chooseTemplate = async function (title, extra) {
      await (readyP || Promise.resolve());
      return openPicker(title, extra || []);
    };
    chooseTemplate._ff = true;
    if (typeof newNoteFlow === 'function' && !newNoteFlow._ff) {
      newNoteFlow = async function (nbId) {
        const k = await chooseTemplate('New note', [['pdf', 'From PDF…']]);
        if (!k) return;
        if (k === 'pdf') { try { pdfTargetNb = nbId || null; $1('#pdfFile') && $1('#pdfFile').click(); } catch (_) {} return; }
        createNote(nbId, k);
      };
      newNoteFlow._ff = true;
    }
  }
  function hookTodoMetrics() {
    if (!window.V21ee) return;
    if (typeof V21ee.tdLayout === 'function' && !V21ee.tdLayout._ff) {
      const _lay = V21ee.tdLayout;
      V21ee.tdLayout = function (t) { return withTodoMetrics(t, () => fixTodoLayout(_lay(t), t)); };
      V21ee.tdLayout._ff = true;
    }
    if (typeof V21ee.tdAddRow === 'function' && !V21ee.tdAddRow._ffOwn) {
      V21ee.tdAddRow = function (pi) { return todoAdd(pi, 'tasks'); };
      V21ee.tdAddRow._ffOwn = true;
    }
    if (typeof V21ee.tdRemoveRow === 'function' && !V21ee.tdRemoveRow._ffOwn) {
      V21ee.tdRemoveRow = function (pi, id, force) { return todoRemoveTaskAt(pi, id, force); };
      V21ee.tdRemoveRow._ffOwn = true;
    }
    if (typeof V21ee.tdToggleTomorrow === 'function' && !V21ee.tdToggleTomorrow._ffOwn) {
      V21ee.tdToggleTomorrow = function (pi, force) { return todoToggleTomorrow(pi, force); };
      V21ee.tdToggleTomorrow._ffOwn = true;
    }
    if (typeof drawPageBackground === 'function' && !drawPageBackground._ffTodo) {
      const _dpb = drawPageBackground;
      drawPageBackground = function (ctx, note, pg) {
        const saved = pg && pg.todo ? applyTodoMetrics(pg.todo) : null;
        try {
          const r = _dpb.apply(this, arguments);
          if (pg && pg.todo && !pg.qsheet) { try { drawTodoFixed(ctx, pg); } catch (e) { console.warn('v21ff todo draw', e); } }
          if (pg && pg.customTpl) { try { drawCustom(ctx, pg); } catch (e) { console.warn('v21ff custom', e); } }
          return r;
        } finally { restoreMetrics(saved); }
      };
      drawPageBackground._ffTodo = true;
    }
  }
  function hookOverlay() {
    if (typeof v7OverlayHook !== 'function' || v7OverlayHook._ff) return;
    const _ov = v7OverlayHook;
    v7OverlayHook = function (pi) {
      const n = typeof curNote === 'function' ? curNote() : null, rec = typeof pageEls !== 'undefined' && pageEls[pi], pg = n && n.pages[pi];
      const saved = pg && pg.todo ? applyTodoMetrics(pg.todo) : null;
      try {
        const r = _ov.apply(this, arguments);
        if (rec && pg && !sealed(n)) {
          try {
            if (pg.todo) drawTodoPairs(pi, pg, rec);
            if (pg.customTpl) drawCustomUI(pi, pg, rec);
          } catch (e) { console.warn('v21ff overlay', e); }
        }
        return r;
      } finally { restoreMetrics(saved); }
    };
    v7OverlayHook._ff = true;
  }
  function hookClicks() {
    const PAGES = $1('#pages'); if (!PAGES || PAGES._ff) return;
    PAGES._ff = true;
    // Intercept on document (capture) so v21ee's earlier #pages listener never uses its 3-row layout.
    document.addEventListener('pointerdown', e => {
      if (e.target.closest && e.target.closest('.td-delrow, .td-tmr, .ff-tmr')) e.stopPropagation();
    }, true);
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.td-delrow, .td-tmr, .ff-tmr');
      if (!b || !b.closest('#pages')) return;
      const page = b.closest('.page[data-pi]'); if (!page) return;
      e.stopPropagation(); e.preventDefault();
      const pi = +page.dataset.pi;
      if (b.classList.contains('td-tmr') || b.classList.contains('ff-tmr')) todoToggleTomorrow(pi);
      else todoRemoveTaskAt(pi, b.dataset.id);
    }, true);
    PAGES.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.ff-pm button, .ff-delrow, .ff-check, .ff-tmr')) e.stopPropagation(); }, true);
    PAGES.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.ff-pm button, .ff-delrow, .ff-check, .ff-tmr'); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const page = b.closest('.page[data-pi]'); if (!page) return;
      const pi = +page.dataset.pi;
      if (b.classList.contains('ff-plus') && b.dataset.sec) todoAdd(pi, b.dataset.sec);
      else if (b.classList.contains('ff-minus') && b.dataset.sec) todoRemoveLast(pi, b.dataset.sec);
      else if (b.classList.contains('ff-plus') && b.dataset.mid) custAdd(pi, b.dataset.mid);
      else if (b.classList.contains('ff-minus') && b.dataset.mid) custRemoveLast(pi, b.dataset.mid);
      else if (b.classList.contains('ff-delrow') && b.dataset.sec === 'pri') todoRemovePriAt(pi, b.dataset.id);
      else if (b.classList.contains('ff-delrow') && (b.dataset.sec === 'tasks' || (!b.dataset.sec && !b.dataset.mid))) todoRemoveTaskAt(pi, b.dataset.id);
      else if (b.classList.contains('ff-delrow') && b.dataset.mid) custRemoveRow(pi, b.dataset.mid, b.dataset.id);
      else if (b.classList.contains('ff-check')) custToggle(pi, b.dataset.mid, b.dataset.id);
      else if (b.classList.contains('ff-tmr')) todoToggleTomorrow(pi);
    }, true);
  }
  function hookExport() {
    if (typeof drawOverlaysForExport !== 'function' || drawOverlaysForExport._ff) return;
    const _doe = drawOverlaysForExport;
    drawOverlaysForExport = function (ctx, pg, note) {
      const r = _doe.apply(this, arguments);
      try {
        if (pg && pg.customTpl) {
          const L = custLayout(pg);
          for (const box of L.boxes) {
            if (!box.rows) continue;
            (box.rows || []).forEach((R, i) => {
              const it = box.st && box.st.rows && box.st.rows[i];
              if (it && it.done) {
                const k = R.check, bsz = BOX;
                ctx.save(); rr(ctx, k.x, k.y, bsz, bsz, 6); ctx.fillStyle = '#22a55a'; ctx.fill();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.beginPath(); ctx.moveTo(k.x + bsz * .24, k.y + bsz * .54); ctx.lineTo(k.x + bsz * .43, k.y + bsz * .72); ctx.lineTo(k.x + bsz * .78, k.y + bsz * .3); ctx.stroke();
                ctx.strokeStyle = 'rgba(34,165,90,.55)'; ctx.lineWidth = 2; ctx.beginPath();
                ctx.moveTo(R.write.x, R.y + R.h * 0.62); ctx.lineTo(R.write.x + R.write.w, R.y + R.h * 0.62); ctx.stroke();
                ctx.restore();
              }
            });
          }
        }
      } catch (e) { console.warn('v21ff export', e); }
      return r;
    };
    drawOverlaysForExport._ff = true;
  }

  function boot() {
    hookTitles(); hookMakePage(); hookChoose(); hookTodoMetrics(); hookOverlay(); hookClicks(); hookExport();
    if (typeof curNote === 'function' && curNote() && typeof buildPages === 'function') {
      try { buildPages(); } catch (_) {}
    }
  }

  window.V21ff = {
    version: VERSION,
    ready: () => readyP,
    listTemplates, getTemplate, saveTemplate: saveTemplateObj, deleteTemplate: delTemplate,
    duplicateTemplate, renameTemplate,
    openPicker, closePicker, openBuilder, closeBuilder,
    addModule, reorderModule, editModule, removeModule, saveBuilder,
    createNoteFrom: function (id) {
      const nb = (S.notebooks || []).find(b => b.id !== 'archive') || (S.notebooks || [])[0];
      createNote(nb && nb.id, 'custom:' + id);
    },
    applyCustomToPage, custLayout, MODULES, COLORS,
    todoAdd, todoRemoveLast, todoRemovePriAt, todoRemoveTaskAt, todoToggleTomorrow, notesCount, tmrCount, notesH, tmrH, layoutTodo, fixTodoLayout,
    custAdd, custRemoveLast, custRemoveRow, custToggle,
    confirmBox,
    _autoConfirm: false,
    builderState: () => builder
  };

  readyP = loadTemplates().then(() => { hookTitles(); return templates; });
  if (window.__ready) boot();
  else {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.__ready || Date.now() - t0 > 12000) { clearInterval(iv); boot(); }
    }, 40);
  }
})();
