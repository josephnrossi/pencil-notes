/* Pencil Notes v21ed — Quote Board retired from the UI; ＋ Insert → Quote template (all handwriting).
   1. The 💲 Quote Board, quote cards and every path that made one are gone from the UI: Boards dropdown, sidebar row,
      ⋯ menu “Go to”, Settings rows, lasso “Send to…” / 💲 Quote form, the handwritten-“Q” / typed-“Q” form triggers,
      Insert → Quote form, Idea Board / Inbox “Move to Quote Board”, the Inbox “looks like an RFQ” prompt and quote email
      sync. The Boards slide-out keeps 💡 Idea Board and 📥 Inbox. Nothing is deleted: the Quote Board note, its cards
      and any old quote forms stay in storage (old forms simply stop drawing; their ink stays on the page).
   2. ＋ Insert → 🧾 Quote sheet: a full page (new page after the current one, or the current page if it is blank) printed
      with stacked quotes — Distributor | Customer, a Product | Size | Qty | Price line table (2 lines to start) and Notes.
      All handwriting: plain page ink, no typing, no OCR; it saves / undoes / reorders / exports with the page.
      ＋ line adds a row to that quote (rows and quotes below shift down, ink moves with them); － removes a line
      (asks first if it has writing). ＋ Quote adds a quote below the last; when the page is full it continues on a
      Quote sheet page right after (quotes pushed past the bottom by ＋ line move there too, with their ink).
      🗑 deletes a quote, with or without its handwriting. Every action is one Undo step.
   Builds on v21ec. Mock only. */
(function () {
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const hasQ = s => /quote board|quote form|quote card/i.test(String(s || ''));

  /* ==================== 1. retire the Quote Board from the UI ==================== */
  const _sdb = setDrawerBoard;
  setDrawerBoard = function (mode, opts) { return _sdb.call(this, mode === 'quotes' ? 'ideas' : mode, opts); };
  const _qbo = qbOpen;
  qbOpen = function (on = true, opts = {}) { if (opts && opts.mode === 'quotes') opts = { ...opts, mode: 'ideas' }; if (on && QB.mode === 'quotes') _sdb('ideas', { render: false }); return _qbo.call(this, on, opts); };
  try { BOARDS.quotes.badge = () => 0; } catch (_) {}
  if (QB.mode === 'quotes') { try { _sdb('ideas', { render: QB.open }); } catch (_) {} }
  const _dbm = dbMenu;
  dbMenu = function (on) { const r = _dbm.apply(this, arguments); document.querySelectorAll('#dbMenu [data-board="quotes"]').forEach(b => b.remove()); return r; };
  // quote email sync only ever filled the Quote Board
  try { clearInterval(QSync.timer); QSync.timer = null; } catch (_) {}

  const _as = actionSheet;
  actionSheet = function (title, actions) {
    if (title === 'This looks like a request for quote') {            // Inbox RFQ prompt → just keep it in the Inbox
      const keep = (actions || []).find(a => /Keep it in the Inbox/.test(a.label)); if (keep && keep.fn) return void keep.fn();
    }
    return _as.call(this, title, (actions || []).filter(a => !hasQ(a.label)));
  };
  const _ps = pickSheet;
  pickSheet = function (title, items, opts) { return _ps.call(this, title, (items || []).filter(i => i.value !== 'quotes' && !hasQ(i.label)), opts); };
  if (typeof cardMenuExtra === 'function') { const _cm = cardMenuExtra; cardMenuExtra = function () { return (_cm.apply(this, arguments) || []).filter(a => !hasQ(a.label)); }; }
  const _mi = moreItems;
  moreItems = function () { return _mi.apply(this, arguments).map(sec => ({ ...sec, rows: (sec.rows || []).filter(r => !(r.l && hasQ(r.l))) })); };
  const _ss = settingsSections;
  settingsSections = function () {
    return _ss.apply(this, arguments).map(sec => sec.id !== 'quotes' ? sec : { ...sec,
      note: 'The 💡 Idea Board and 📥 Inbox share one slide-out panel — tap 📋 in the top bar or swipe in from the right edge, then pick a board from the dropdown at the top. Quotes now live on your note pages: ＋ Insert → 🧾 Quote template.',
      rows: sec.rows.filter(r => !/quote|email sync|check email|skipped emails/i.test(r.label + ' ' + (r.sub || ''))) });
  };
  const _rs = renderSidebar;
  renderSidebar = function () { const r = _rs.apply(this, arguments); document.querySelectorAll('#qbRow').forEach(x => x.remove()); return r; };
  try { const i = TOUR.findIndex(t => t[0] === '#quotesBtn'); if (i >= 0) TOUR[i] = ['#quotesBtn', '📋 Boards', 'Your 💡 Idea Board and 📥 Inbox slide out from the right — switch with the dropdown at the top.']; } catch (_) {}
  const label = (sel, attr, v) => { const e = document.querySelector(sel); if (e) e.setAttribute(attr, v); };
  label('#quotesBtn', 'title', 'Boards — Idea Board & Inbox'); label('#quotesBtn', 'aria-label', 'Boards');
  label('#qbTab', 'title', 'Boards — tap or swipe in from the right edge');
  label('#insertBtn', 'title', 'Insert a task, section number, quote template, photo, sticker, reminder, recording, page or PDF');
  label('#lassoSend', 'title', 'Idea Board, planner or Inbox');
  ['lassoQuoteForm', 'lassoQuote', 'insQuoteForm'].forEach(id => { const b = document.getElementById(id); if (b) { b.onclick = null; b.remove(); } });
  // handwritten “Q” → form (v21e5) and the older ink probe (v21e3): switched off
  try { if (window.V21e5) { V21e5.scheduleQuoteInkProbe = () => {}; Object.defineProperty(V21e5._Q, 'probing', { get: () => true, set() {}, configurable: true }); } } catch (_) {}
  // typed “Q” → form (v21e3: document capture focusout): stop that one focusout at window capture. Text boxes save on
  // 'blur' (a separate event), so nothing else is affected.
  addEventListener('focusout', e => {
    const d = e.target && e.target.closest && e.target.closest('.overlay [contenteditable], .tbox, .text-box');
    if (d && /^\s*[Qq]\s*:?\s*$/.test(d.innerText || d.textContent || '')) e.stopPropagation();
  }, true);
  // old v21e3–v21ea quote forms: data kept, no longer drawn / interactive (their ink is ordinary page ink)
  const st = document.createElement('style'); st.textContent = '.qf-block, .qf-pad, #lassoQuoteForm, #lassoQuote, #insQuoteForm, [data-ia="toquote"], #qbRow, #dbMenu [data-board="quotes"] { display: none !important; }';
  document.head.append(st);
  if (window.V21e4) { V21e4.insertQuoteForm = () => null; }
  if (window.V21e3) { V21e3.insertQuoteForm = () => null; }

  /* ==================== 2. ＋ Insert → Quote sheet (full page, many quotes, ＋ line) ====================
     pg.qsheet = { v: 2, quotes: [{ id, y, lines }] }  — everything else (boxes, columns, rules) is computed and painted
     into the page canvas, so Apple Pencil ink is plain page ink. Ink belongs to whatever box its centre sits in. */
  const X = 40, BW = 920, TOP = 96, GAP = 16, LIMIT = PAGE_H - 24;
  const BAND = 30, PARTY = 70, THEAD = 24, LINE = 52, ADD = 36, NOTES = 104, NOTE_LH = 41, PAD = 10, DEF_LINES = 2, DEF_QUOTES = 2;
  const COLS = [['product', 'Product', .44], ['size', 'Size', .22], ['qty', 'Qty', .12], ['price', 'Price', .22]];
  const nH = q => NOTES + NOTE_LH * Math.max(0, q.nlines || 0);   // v21eg: ＋ note line adds NOTE_LH to the Notes box
  const qH = q => BAND + PARTY + 8 + THEAD + LINE * q.lines + ADD + nH(q) + PAD;
  const MAXL = Math.floor((LIMIT - TOP - qH({ lines: 0 })) / LINE);
  /** Every box of one quote block, in page units. */
  function qLayout(q) {
    const y = q.y, x = X + 12, w = BW - 24, half = (w - 12) / 2;
    const party = [{ key: 'distributor', label: 'Distributor', x, y: y + BAND, w: half, h: PARTY }, { key: 'customer', label: 'Customer', x: x + half + 12, y: y + BAND, w: half, h: PARTY }];
    const ty = y + BAND + PARTY + 8, rows = [];
    for (let r = 0; r < q.lines; r++) { let cx = x; rows.push(COLS.map(([k, l, f]) => { const c = { key: k, label: l, row: r, x: cx, y: ty + THEAD + r * LINE, w: w * f, h: LINE }; cx += w * f; return c; })); }
    const rowsBottom = ty + THEAD + q.lines * LINE;
    return { x: X, y, w: BW, h: qH(q), party, table: { x, y: ty, w, h: THEAD + q.lines * LINE }, rows, rowsBottom, add: { x, y: rowsBottom, h: ADD },
      notes: { key: 'notes', label: 'Notes', x, y: rowsBottom + ADD, w, h: nH(q) } };
  }
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  function pal() {
    const d = isDark();
    return { d, paper: d ? '#1f1f23' : '#fffdf8', box: d ? 'rgba(255,255,255,.03)' : '#ffffff', block: d ? 'rgba(255,255,255,.015)' : 'rgba(250,249,245,1)',
      edge: d ? 'rgba(200,200,220,.26)' : 'rgba(60,60,80,.24)', rule: d ? 'rgba(200,200,220,.20)' : 'rgba(60,60,80,.20)', gray: d ? 'rgba(200,200,215,.62)' : 'rgba(70,70,90,.6)', ink: d ? '#e6e6ea' : '#1d1d1f' };
  }
  function lab(ctx, c, t, x, y, size = 12) {
    ctx.fillStyle = c.gray; ctx.font = `700 ${size}px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
    ctx.fillText(t.toUpperCase(), x, y); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  function drawSheet(ctx, pg) {
    const S2 = pg.qsheet, c = pal(); ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.fillStyle = c.ink; ctx.font = `700 30px ${FONT}`; ctx.fillText('Quotes', X + 4, 58);
    ctx.fillStyle = c.gray; ctx.font = `500 15px ${FONT}`; ctx.fillText('write with Apple Pencil · ＋ line adds a product row', X + 116, 57);
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, 76); ctx.lineTo(X + BW, 76); ctx.stroke();
    S2.quotes.forEach((q, i) => {
      const L = qLayout(q);
      rr(ctx, L.x, L.y, L.w, L.h, 14); ctx.fillStyle = c.block; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.5; ctx.stroke();
      lab(ctx, c, `Quote ${i + 1}`, L.x + 14, L.y + 21, 13);
      for (const f of [...L.party, L.notes]) {
        rr(ctx, f.x, f.y, f.w, f.h, 8); ctx.fillStyle = c.box; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.stroke();
        lab(ctx, c, f.label, f.x + 12, f.y + 20);
        ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
        if (f.key === 'notes') for (let k = 1; k <= 2 + Math.max(0, q.nlines || 0); k++) { const yy = f.y + 22 + k * NOTE_LH - 4; ctx.moveTo(f.x + 12, yy); ctx.lineTo(f.x + f.w - 12, yy); }
        else { ctx.moveTo(f.x + 12, f.y + f.h - 16); ctx.lineTo(f.x + f.w - 12, f.y + f.h - 16); }
        ctx.stroke();
      }
      const T = L.table;
      rr(ctx, T.x, T.y, T.w, T.h, 8); ctx.fillStyle = c.box; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = c.edge; ctx.beginPath(); ctx.moveTo(T.x, T.y + THEAD); ctx.lineTo(T.x + T.w, T.y + THEAD); ctx.stroke();
      let cx = T.x; COLS.forEach(([, l, f], k) => { lab(ctx, c, l, cx + 12, T.y + 17); cx += T.w * f; if (k < COLS.length - 1) { ctx.strokeStyle = c.rule; ctx.beginPath(); ctx.moveTo(cx, T.y + 4); ctx.lineTo(cx, T.y + T.h - 4); ctx.stroke(); } });
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.beginPath();
      for (let r = 1; r < q.lines; r++) { const yy = T.y + THEAD + r * LINE; ctx.moveTo(T.x + 8, yy); ctx.lineTo(T.x + T.w - 8, yy); }
      ctx.stroke();
    });
    ctx.restore();
  }
  const _dpb = drawPageBackground;
  drawPageBackground = function (ctx, note, pg) { const r = _dpb.apply(this, arguments); if (pg && pg.qsheet) try { drawSheet(ctx, pg); } catch (e) { console.warn('qsheet', e); } return r; };

  /* ---------- ink helpers ---------- */
  const sbb = s => s.bb || (s.bb = bbox(s.points));
  const cy = s => { const b = sbb(s); return (b[1] + b[3]) / 2; }, cxs = s => { const b = sbb(s); return (b[0] + b[2]) / 2; };
  const inR = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const tc = t => [t.x + 4, t.y + 10];
  function shiftBelow(pg, y0, dy) {                                     // all ink / typed text whose centre is at or below y0
    for (const s of pg.strokes || []) if (cy(s) >= y0) { s.points = s.points.map(p => { const q = p.slice(); q[1] += dy; return q; }); s.bb = bbox(s.points); }
    for (const t of pg.texts || []) if (tc(t)[1] >= y0) t.y += dy;
  }
  function inkIn(pg, r) { return { strokes: (pg.strokes || []).filter(s => inR(r, cxs(s), cy(s))), texts: (pg.texts || []).filter(t => inR(r, ...tc(t))) }; }
  function takeInk(pg, r) { const G = inkIn(pg, r); pg.strokes = pg.strokes.filter(s => !G.strokes.includes(s)); pg.texts = pg.texts.filter(t => !G.texts.includes(t)); return G; }
  function putInk(pg, G, dy) {
    for (const s of G.strokes) { s.points = s.points.map(p => { const q = p.slice(); q[1] += dy; return q; }); s.bb = bbox(s.points); pg.strokes.push(s); }
    for (const t of G.texts) { t.y += dy; pg.texts.push(t); }
  }
  const lastBottom = pg => { const Q = pg.qsheet.quotes; return Q.length ? Q[Q.length - 1].y + qH(Q[Q.length - 1]) : TOP - GAP; };
  const isBlank = pg => !pg.qsheet && !pg.bg && !(pg.strokes || []).length && !(pg.texts || []).length && !(pg.tasks || []).length && !(pg.images || []).length && !(pg.sections || []).length && !(pg.quoteForms || []).length;
  const newQ = y => ({ id: uid('q'), y, lines: DEF_LINES });
  function sheetPage(n, likePi) {
    const p = newPage(); p.paper = 'blank'; p.qsheet = { v: 2, quotes: [] };
    let y = TOP; for (let i = 0; i < DEF_QUOTES; i++) { p.qsheet.quotes.push(newQ(y)); y += qH(p.qsheet.quotes[i]) + GAP; }
    return p;
  }
  /** Next page is a Quote sheet? use it; else insert a fresh (empty) sheet right after. */
  function nextSheet(n, pi) {
    const nx = n.pages[pi + 1]; if (nx && nx.qsheet) return pi + 1;
    const p = newPage(); p.paper = 'blank'; p.qsheet = { v: 2, quotes: [] }; n.pages.splice(pi + 1, 0, p); return pi + 1;
  }
  /** Push quote qi of page pi (with its ink) to the top of the next sheet; that sheet makes room and overflows in turn. */
  function moveToNext(n, pi, qi) {
    const pg = n.pages[pi], q = pg.qsheet.quotes[qi], G = takeInk(pg, qLayout(q));
    pg.qsheet.quotes.splice(qi, 1);
    const ti = nextSheet(n, pi), tp = n.pages[ti], h = qH(q) + GAP;
    if (tp.qsheet.quotes.length) { const top = tp.qsheet.quotes[0].y; tp.qsheet.quotes.forEach(o => { o.y += h - (top - TOP); }); shiftBelow(tp, top, h - (top - TOP)); }
    const dy = TOP - q.y; q.y = TOP; tp.qsheet.quotes.unshift(q); putInk(tp, G, dy);
    overflow(n, ti);
    return ti;
  }
  function overflow(n, pi) {
    const pg = n.pages[pi]; let moved = false;
    while (pg.qsheet.quotes.length > 1 && lastBottom(pg) > LIMIT) { moveToNext(n, pi, pg.qsheet.quotes.length - 1); moved = true; }
    return moved;
  }
  function commit(n, pis, msg, focus) {
    saveNote(n, true); try { thumbCache.clear(); } catch (_) {}
    if (pis === 'all') buildPages(); else for (const pi of pis) { renderPageInk(pi); renderOverlay(pi); }
    if (msg) actionToast(msg, 'Undo', () => restore(S.undo, S.redo), 5000);
    if (focus != null) requestAnimationFrame(() => { const r = pageEls[focus.pi]; if (r) $('#pages').scrollTo({ top: r.el.offsetTop + (focus.y || 0) * S.scale - 60, behavior: 'smooth' }); });
  }
  const findQ = (pg, id) => (pg.qsheet && pg.qsheet.quotes.findIndex(q => q.id === id));
  const guard = () => { const n = curNote(); if (!n) return null; if (sealed(n)) { toast('🔒 Unlock the note first'); return null; } return n; };

  /* ---------- actions ---------- */
  function visiblePi() {
    const w = $('#pages'); if (!w || !pageEls.length) return 0;
    const wr = w.getBoundingClientRect(), mid = wr.top + wr.height * 0.4; let best = 0, bd = Infinity;
    pageEls.forEach((r, i) => { const b = r.el.getBoundingClientRect(); const d = b.top <= mid && b.bottom >= mid ? 0 : Math.min(Math.abs(b.top - mid), Math.abs(b.bottom - mid)); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function insertSheet(pi) {
    const n = guard(); if (!n) return null;
    if (pi == null) pi = visiblePi();
    const cur = n.pages[pi]; pushHistory();
    let at;
    if (cur && isBlank(cur)) { const p = sheetPage(n); cur.paper = 'blank'; cur.qsheet = p.qsheet; at = pi; }
    else { n.pages.splice(pi + 1, 0, sheetPage(n)); at = pi + 1; }
    commit(n, 'all', null, { pi: at, y: 0 });
    toast(at === pi ? '🧾 This page is now a Quote sheet — write with Apple Pencil' : `🧾 Quote sheet added as page ${at + 1} — write with Apple Pencil`, 2800);
    return at;
  }
  function addLine(pi, id) {
    const n = guard(); if (!n) return false; const pg = n.pages[pi], qi = findQ(pg, id); if (qi < 0) return false;
    const q = pg.qsheet.quotes[qi];
    if (q.lines >= MAXL) { toast('This quote already fills a page — add another quote to continue'); return false; }
    pushHistory();
    const y0 = qLayout(q).rowsBottom; q.lines++;
    pg.qsheet.quotes.slice(qi + 1).forEach(o => { o.y += LINE; }); shiftBelow(pg, y0, LINE);
    if (qi === 0 && q.y + qH(q) > LIMIT) { q.lines--; pg.qsheet.quotes.slice(qi + 1).forEach(o => { o.y -= LINE; }); shiftBelow(pg, y0 + LINE, -LINE); S.undo.pop(); updateUndo(); toast('This quote already fills a page — add another quote to continue'); return false; }
    const moved = overflow(n, pi);
    commit(n, moved ? 'all' : [pi], moved ? '＋ Line added — the quotes below moved to the next page' : null);
    return true;
  }
  function removeLine(pi, id, r, force) {
    const n = guard(); if (!n) return false; const pg = n.pages[pi], qi = findQ(pg, id); if (qi < 0) return false;
    const q = pg.qsheet.quotes[qi]; if (q.lines <= 1) { toast('A quote keeps at least one line'); return false; }
    const L = qLayout(q), row = { x: L.table.x, y: L.rows[r][0].y, w: L.table.w, h: LINE }, G = inkIn(pg, row);
    if ((G.strokes.length || G.texts.length) && !force) {
      actionSheet('This line has handwriting', [{ label: '🗑 Remove the line and its handwriting', danger: true, fn: () => removeLine(pi, id, r, true) }]);
      return false;
    }
    pushHistory(); takeInk(pg, row);
    q.lines--; pg.qsheet.quotes.slice(qi + 1).forEach(o => { o.y -= LINE; }); shiftBelow(pg, row.y + LINE, -LINE);
    commit(n, [pi], '－ Line removed');
    return true;
  }
  /* v21eg: ＋ / － note lines in the Notes box (same pattern as product lines: quotes + ink below shift, overflow to next sheet) */
  function addNoteLine(pi, id) {
    const n = guard(); if (!n) return false; const pg = n.pages[pi], qi = findQ(pg, id); if (qi < 0) return false;
    const q = pg.qsheet.quotes[qi], y0 = qLayout(q).notes.y + qLayout(q).notes.h;
    if (q.y + qH(q) + NOTE_LH > LIMIT && qi === 0) { toast('This quote already fills a page — add another quote to continue'); return false; }
    pushHistory();
    q.nlines = (q.nlines || 0) + 1;
    pg.qsheet.quotes.slice(qi + 1).forEach(o => { o.y += NOTE_LH; }); shiftBelow(pg, y0, NOTE_LH);
    const moved = overflow(n, pi);
    commit(n, moved ? 'all' : [pi], moved ? '＋ Note line added — the quotes below moved to the next page' : null);
    return true;
  }
  function removeNoteLine(pi, id, force) {
    const n = guard(); if (!n) return false; const pg = n.pages[pi], qi = findQ(pg, id); if (qi < 0) return false;
    const q = pg.qsheet.quotes[qi]; if (!(q.nlines > 0)) { toast('Notes keep their first two lines'); return false; }
    const N = qLayout(q).notes, row = { x: N.x, y: N.y + N.h - NOTE_LH, w: N.w, h: NOTE_LH }, G = inkIn(pg, row);
    if ((G.strokes.length || G.texts.length) && !force) {
      actionSheet('The last note line has handwriting', [{ label: '🗑 Remove the line and its handwriting', danger: true, fn: () => removeNoteLine(pi, id, true) }]);
      return false;
    }
    pushHistory(); takeInk(pg, row);
    q.nlines--; pg.qsheet.quotes.slice(qi + 1).forEach(o => { o.y -= NOTE_LH; }); shiftBelow(pg, row.y + NOTE_LH, -NOTE_LH);
    commit(n, [pi], '－ Note line removed');
    return true;
  }
  function addQuote(pi) {
    const n = guard(); if (!n) return null; let pg = n.pages[pi]; if (!pg || !pg.qsheet) return null;
    pushHistory();
    let y = lastBottom(pg) + GAP, q = newQ(y), at = pi;
    if (y + qH(q) > LIMIT) { at = nextSheet(n, pi); pg = n.pages[at]; y = lastBottom(pg) + GAP; q = newQ(y);
      if (y + qH(q) > LIMIT) { const p = newPage(); p.paper = 'blank'; p.qsheet = { v: 2, quotes: [] }; n.pages.splice(at, 0, p); pg = p; q = newQ(TOP); } }
    pg.qsheet.quotes.push(q);
    commit(n, 'all', at !== pi ? `＋ Quote continues on page ${at + 1}` : null, { pi: at, y: q.y });
    return { pi: at, id: q.id };
  }
  function deleteQuote(pi, id, withInk) {
    const n = guard(); if (!n) return; const pg = n.pages[pi], qi = findQ(pg, id); if (qi < 0) return;
    const q = pg.qsheet.quotes[qi], L = qLayout(q); pushHistory();
    pg.qsheet.quotes.splice(qi, 1);
    if (withInk) { takeInk(pg, L); const h = qH(q) + GAP; pg.qsheet.quotes.slice(qi).forEach(o => { o.y -= h; }); shiftBelow(pg, L.y + L.h, -h); }
    commit(n, [pi], withInk ? '🗑 Quote deleted' : '🗑 Quote boxes removed — handwriting kept');
  }
  function askDeleteQuote(pi, id) {
    actionSheet('Delete this quote?', [
      { label: '🗑 Delete the quote and its handwriting', danger: true, fn: () => deleteQuote(pi, id, true) },
      { label: 'Remove the boxes, keep the handwriting', fn: () => deleteQuote(pi, id, false) }]);
  }

  /* ---------- on-page controls (DOM, not printed): ＋ line · － per line (left margin, clear of the Boards tab) · 🗑 per quote · ＋ Quote ---------- */
  const _ovh = v7OverlayHook;
  v7OverlayHook = function (pi) {
    _ovh.apply(this, arguments);
    const n = curNote(), rec = pageEls[pi], pg = n && n.pages[pi]; if (!rec || !pg) return;
    rec.ov.querySelectorAll('.qs-ui').forEach(b => b.remove());
    if (!pg.qsheet || sealed(n)) return;
    const s = S.scale, el = (cls, x, y, html, attrs = {}) => { const b = document.createElement('button'); b.className = 'qs-ui ' + cls; b.style.left = x * s + 'px'; b.style.top = y * s + 'px'; b.innerHTML = html; for (const k in attrs) b.setAttribute(k, attrs[k]); rec.ov.append(b); return b; };
    pg.qsheet.quotes.forEach((q, i) => {
      const L = qLayout(q);
      el('qs-addline', L.add.x, L.add.y + 5, '＋ line', { 'data-q': q.id, title: 'Add another Product / Size / Qty / Price line', 'aria-label': `Add a line to quote ${i + 1}` });
      el('qs-delq', L.x + L.w - 12, L.y + 4, '🗑', { 'data-q': q.id, title: 'Delete this quote', 'aria-label': `Delete quote ${i + 1}` });
      el('qs-addnote', L.notes.x + 86, L.notes.y + 5, '＋ line', { 'data-q': q.id, title: 'Add another note line', 'aria-label': `Add a note line to quote ${i + 1}` });
      if (q.nlines > 0) el('qs-delnote', L.notes.x + 156, L.notes.y + 5, '－', { 'data-q': q.id, title: 'Remove the last note line', 'aria-label': `Remove a note line from quote ${i + 1}` });
      if (q.lines > 1) L.rows.forEach((row, r) => el('qs-delrow', L.x - 5, row[0].y + LINE / 2, '－', { 'data-q': q.id, 'data-row': r, title: 'Remove this line', 'aria-label': `Remove line ${r + 1} of quote ${i + 1}` }));
    });
    const lb = lastBottom(pg), room = lb + GAP + 44 <= PAGE_H - 8;
    el('qs-addq' + (room ? '' : ' top'), room ? X + BW / 2 : X + BW, room ? lb + GAP : 30, '＋ Quote', { title: 'Add another quote below', 'aria-label': 'Add another quote' });
  };
  const PAGES = $('#pages');
  PAGES.addEventListener('click', e => {
    const b = e.target.closest('.qs-ui'); if (!b) return; e.stopPropagation(); e.preventDefault();
    const pi = +b.closest('.page[data-pi]').dataset.pi, id = b.dataset.q;
    if (b.classList.contains('qs-addline')) addLine(pi, id);
    else if (b.classList.contains('qs-addnote')) addNoteLine(pi, id);
    else if (b.classList.contains('qs-delnote')) removeNoteLine(pi, id);
    else if (b.classList.contains('qs-delrow')) removeLine(pi, id, +b.dataset.row);
    else if (b.classList.contains('qs-delq')) askDeleteQuote(pi, id);
    else if (b.classList.contains('qs-addq')) addQuote(pi);
  }, true);
  PAGES.addEventListener('pointerdown', e => { if (e.target.closest('.qs-ui')) e.stopPropagation(); }, true);   // a control is never a page hold / stroke

  // Insert menu item, right after 1. Number
  function addInsertItem() {
    const m = document.getElementById('insertMenu'); if (!m || m.querySelector('#insQuoteSheet')) return;
    const b = document.createElement('button'); b.id = 'insQuoteSheet'; b.className = 'ins-item'; b.setAttribute('role', 'menuitem');
    b.title = 'A full page of handwritten quotes: Distributor, Customer, Product / Size / Qty / Price lines and Notes';
    b.innerHTML = '<i>🧾</i><span>Quote sheet</span><small>Full page · several quotes · ＋ line for more products</small>';
    b.onclick = () => { m.hidden = true; const ib = $('#insertBtn'); ib && ib.setAttribute('aria-expanded', 'false'); insertSheet(); };
    const num = m.querySelector('[data-tool="section"]'); num ? num.after(b) : m.append(b);
  }
  addInsertItem();

  if (curNote()) { try { buildPages(); } catch (_) {} }
  try { renderSidebar(); } catch (_) {}
  window.V21ed = { version: 'v21ed', insertSheet, addLine, removeLine, addNoteLine, removeNoteLine, NOTE_LH, addQuote, deleteQuote, qLayout, qH, MAXL, TOP, GAP, LIMIT, LINE };
})();
