/* Pencil Notes v21eo — Idea Board becomes a whiteboard.
   v21eq rebuild (this file is patched in place): the board uses the normal note toolbar (Pen · Highlight · Erase · Lasso · Text ·
   colours · size · ＋ Insert · Finger), real undo/redo for every board change, a lasso menu above the board (Make card · Delete · Cancel),
   slim cards (finger press-and-hold to move, Pencil always writes, corner handle only when selected) and ink drawn UNDER cards.
   Does not delete IndexedDB data; v21eo boards migrate (wbSlim) so ink stays where it was.
   v21er (patched in place): the board ink canvases cover only the visible part of the board (plus a margin),
   never more than 16,000,000 pixels each (iPad Safari's per-canvas limit), and the live stroke clears only its
   own dirty box. Ink coordinates are unchanged (world units). Escape in a board prompt closes only the prompt. */
(function () {
  'use strict';
  const PDF_CAP = 20;
  const MIN_W = 160, MIN_H = 120, FINGER_SLOP = 20;
  const HEAD = 48 /* v21eo card header (legacy, migration only) */, TITLE_H = 30, ATTACH_H = 80, HOLD_MS = 350, HOLD_SLOP = 10, WORLD0_W = 2400, WORLD0_H = 1800, GROW = 800;
  const COL_W = 340, CARD_W = 300, START_X = 64, START_Y = 72, CARD_GAP = 28;
  const STATUSES = [
    { id: 'todo', title: 'To Do' },
    { id: 'doing', title: 'Doing' },
    { id: 'done', title: 'Done' }
  ];
  const VIEW = { x: 24, y: 24, s: 1 };
  const urlCache = new Map();
  const ST = { tool: 'pen', sel: null, g: null, list: false, lastTap: 0, lastTapId: null, ptrs: null, full: null, selLasso: null, noClickUntil: 0 };

  const host = () => document.getElementById('ibHost');
  const ideaPg = () => { const n = typeof ideaNote === 'function' ? ideaNote() : null; return n && n.pages && n.pages[0] ? n.pages[0] : null; };
  const ideaN = () => typeof ideaNote === 'function' ? ideaNote() : null;
  const isOpen = () => typeof QB !== 'undefined' && QB.open && QB.mode === 'ideas' && !(typeof ibSealed === 'function' && ibSealed());
  const statusOf = t => {
    const pg = ideaPg(); if (!pg || !t) return 'todo';
    const cols = typeof boardCols === 'function' ? boardCols(pg) : (pg.board && pg.board.columns) || [];
    const i = cols.findIndex(c => c.id === t.col);
    if (i <= 0) return 'todo';
    if (i >= cols.length - 1 || /done|finished|complete/i.test((cols[i] && cols[i].title) || '')) return 'done';
    return 'doing';
  };
  const colForStatus = (pg, st) => {
    const cols = boardCols(pg);
    if (st === 'done') return cols[cols.length - 1] || cols[0];
    if (st === 'doing') return cols[1] || cols[0];
    return cols[0];
  };
  const cardsOf = () => { const pg = ideaPg(); return pg ? (pg.tasks || []).filter(t => t && t.kind === 'card') : []; };
  const byId = (arr, id) => (arr || []).find(x => x && x.id === id);
  const pushWB = () => { if (typeof bH === 'function') bH(IPI); };
  const saveWB = () => { const n = ideaN(); if (n && typeof saveNote === 'function') saveNote(n, true); };
  const toastMsg = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  const extraAssetIds = pg => {
    const s = new Set();
    if (!pg) return s;
    for (const im of pg.images || []) { if (im.asset) s.add(im.asset); if (im.src) s.add(im.src); }
    for (const p of pg.pdfs || []) if (p.src) s.add(p.src);
    for (const t of pg.tasks || []) for (const im of t.images || []) { if (im.asset) s.add(im.asset); if (im.src) s.add(im.src); }
    return s;
  };
  // pageAssetIds / noteAssetIds are const. Photos and rasterized PDF pages
  // already live in pg.images[].asset (picked up by pageAssetIds). Original PDFs
  // are also stored as a hidden pg.images kind=pdfsource so lock + backup see them.

  function ensureWB(note) {
    const n = note || (typeof ensureIdeaNote === 'function' ? ensureIdeaNote() : ideaN());
    if (!n || !n.pages || !n.pages[0]) return null;
    const pg = n.pages[0];
    pg.board = pg.board || { title: 'Idea Board', idea: true, columns: [] };
    if (!pg.board.columns || !pg.board.columns.length) {
      const titles = (typeof IDEA_COLS !== 'undefined' ? IDEA_COLS : ['To Do', 'Doing', 'Done']);
      pg.board.columns = titles.map(title => ({ id: uid('c'), title }));
    }
    pg.strokes = pg.strokes || [];
    pg.images = pg.images || [];
    pg.links = pg.links || [];
    pg.pdfs = pg.pdfs || [];
    pg.tasks = pg.tasks || [];
    pg.board.wb = pg.board.wb || { v: 1, w: WORLD0_W, h: WORLD0_H };
    if (!pg.board.wb.w) pg.board.wb.w = WORLD0_W;
    if (!pg.board.wb.h) pg.board.wb.h = WORLD0_H;
    if (!pg.board.wbMigrated) {
      const cols = boardCols(pg);
      cols.forEach((c, ci) => {
        const list = colCards(pg, c.id);
        list.forEach((t, ri) => {
          if (t.bx == null || t.by == null) {
            t.bx = START_X + ci * (COL_W + 36);
            t.by = START_Y + ri * (defaultCardH(t) + CARD_GAP);
            t.bw = t.bw || CARD_W;
            t.bh = t.bh || defaultCardH(t);
          }
        });
      });
      growWorldToFit(pg);
      pg.board.wbMigrated = 1;
      pg.board.wbSlim = 1;            // laid out fresh: already in the slim-card geometry
      saveNote(n, true);
    }
    if (!pg.board.wbSlim) {
      /* v21eq: v21eo cards had a 48px header and an 8px body inset. Slim cards draw the body from the top-left,
         so shift each card box by that amount: the ink inside stays exactly where it was on the board. */
      for (const t of (pg.tasks || []).filter(x => x && x.kind === 'card' && x.bx != null)) {
        const th = (t.text || '').trim() ? TITLE_H : 0;
        t.bx += 8; t.by += HEAD - th;
        if (t.bw) t.bw = Math.max(MIN_W, t.bw - 16);
        if (t.bh) t.bh = Math.max(MIN_H, t.bh - (HEAD - th) - 8);
      }
      pg.board.wbSlim = 1;
      saveNote(n, true);
    }
    return pg;
  }
  function defaultCardH(t) {
    const body = (typeof cardH === 'function' ? cardH(t) : 240);
    const k = CARD_W / (typeof INK_W === 'number' ? INK_W : 300);
    return Math.max(160, Math.round(((t.text || '').trim() ? TITLE_H : 0) + body * k));
  }
  function growWorldToFit(pg) {
    const wb = pg.board.wb;
    let maxX = wb.w, maxY = wb.h;
    const bump = (x, y, w, h) => { maxX = Math.max(maxX, (x || 0) + (w || 0) + 200); maxY = Math.max(maxY, (y || 0) + (h || 0) + 200); };
    for (const t of (pg.tasks || []).filter(x => x && x.kind === 'card')) bump(t.bx, t.by, t.bw, t.bh);
    for (const im of pg.images || []) bump(im.x, im.y, im.w, im.h);
    for (const l of pg.links || []) bump(l.x, l.y, l.w || 260, l.h || 72);
    for (const s of pg.strokes || []) {
      const b = s.bb || (s.points && typeof bbox === 'function' ? bbox(s.points) : null);
      if (b) bump(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    if (maxX > wb.w) wb.w = Math.ceil(maxX / GROW) * GROW;
    if (maxY > wb.h) wb.h = Math.ceil(maxY / GROW) * GROW;
  }
  function growWorldAt(wx, wy) {
    const pg = ideaPg(); if (!pg) return;
    const wb = pg.board.wb;
    let ch = false;
    if (wx > wb.w - 160) { wb.w += GROW; ch = true; }
    if (wy > wb.h - 160) { wb.h += GROW; ch = true; }
    if (ch) { saveWB(); sizeWorld(); drawInkLayer(); }
  }
  function strokesBBList(strokes) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const s of strokes || []) {
      const bb = s.bb || (s.points && s.points.length && (typeof bbox === 'function' ? bbox(s.points) : null));
      if (!bb) continue;
      a = Math.min(a, bb[0]); b = Math.min(b, bb[1]); c = Math.max(c, bb[2]); d = Math.max(d, bb[3]);
    }
    if (!isFinite(a)) return [0, 0, 4, 4];
    return [a, b, c, d];
  }
  function copyStrokesLocal(strokes, ox, oy) {
    return (strokes || []).map(st => {
      const pts = (st.points || []).map(p => [+(p[0] - ox).toFixed(1), +(p[1] - oy).toFixed(1), p[2]]);
      const ns = { id: uid('s'), tool: st.tool, color: st.color, width: st.width, points: pts };
      if (typeof bbox === 'function' && pts.length) ns.bb = bbox(pts);
      return ns;
    });
  }
  cardFromInk = function (src, dstNote, dstPi, colId, fromCarry) {
    const sn = src && src.note, spg = sn && ((typeof isSysPi === 'function' && isSysPi(src.pi)) || src.pi === IPI || (sn.id === 'ideaboard' && (src.pi == null || src.pi < 0)) ? sn.pages[0] : sn.pages[src.pi]), ids = (src && src.ids) || [];
    const strokes = spg ? spg.strokes.filter(s => ids.includes(s.id)) : [];
    if (!strokes.length && !(src.images && src.images.length) && !(src.links && src.links.length)) {
      toastMsg('Select some handwriting first'); return null;
    }
    const dpg = typeof bP === 'function' ? bP(dstNote, dstPi) : (dstNote && dstNote.pages[0]);
    if (!dpg) return null;
    if (typeof isSysPi === 'function' && isSysPi(dstPi)) bH(dstPi);
    else if (dstNote && typeof S !== 'undefined' && dstNote.id === S.cur && typeof pushHistory === 'function') pushHistory();
    else if (typeof pushHistoryMulti === 'function') pushHistoryMulti([dstNote.id]);

    const cols = boardCols(dpg), col = cols.find(c => c.id === colId) || cols[0];
    const move = !!(src && src.move);
    const attImgs = (src.images || []).slice();
    const attLinks = (src.links || []).slice();
    const sbb = strokesBBList(strokes);
    let bb0 = sbb[0], bb1 = sbb[1], bb2 = sbb[2], bb3 = sbb[3];
    if (!strokes.length) { bb0 = 80; bb1 = 80; bb2 = 80; bb3 = 80; }
    for (const im of attImgs) { bb0 = Math.min(bb0, im.x || 0); bb1 = Math.min(bb1, im.y || 0); bb2 = Math.max(bb2, (im.x || 0) + (im.w || 280)); bb3 = Math.max(bb3, (im.y || 0) + (im.h || 200)); }
    for (const lk of attLinks) { bb0 = Math.min(bb0, lk.x || 0); bb1 = Math.min(bb1, lk.y || 0); bb2 = Math.max(bb2, (lk.x || 0) + (lk.w || 260)); bb3 = Math.max(bb3, (lk.y || 0) + (lk.h || 72)); }
    const pad = 16, hasAtt = !!(attImgs.length || attLinks.length), th = src.title ? TITLE_H : 0;
    const bw = Math.max(MIN_W, hasAtt ? 320 : (sbb[2] - sbb[0]) + pad * 2);
    const bhBody = Math.max(80, strokes.length ? (sbb[3] - sbb[1]) + pad * 2 : 80);
    const body = copyStrokesLocal(strokes, (strokes.length ? sbb[0] : bb0) - pad, (strokes.length ? sbb[1] : bb1) - pad);
    const t = {
      id: uid('t'), kind: 'card', col: col.id, ord: -1, text: src.title || '', typed: !!src.title,
      tstrokes: [], strokes: body, unit: 1, bw, bh: th + bhBody + (hasAtt ? ATTACH_H : 0), bx: 80, by: 80,
      h: bhBody, done: typeof isDoneCol === 'function' && isDoneCol(dpg, col.id),
      due: null, repeat: '', notified: false, createdAt: Date.now(),
      attach: { images: attImgs, links: attLinks }
    };
    if (t.done) t.doneAt = Date.now();
    if (dstPi === IPI || (dstNote && dstNote.id === 'ideaboard')) {
      ensureWB(dstNote);
      /* the body's local origin is (ink left - pad, ink top - pad): put the card there so the ink does not jump */
      t.bx = Math.max(0, (strokes.length ? sbb[0] : bb0) - pad - 1);
      t.by = Math.max(0, (strokes.length ? sbb[1] : bb1) - pad - 1 - th);
      growWorldToFit(dpg);
    }
    if (move && spg) {
      const imgIds = new Set(attImgs.map(i => i.id));
      const linkIds = new Set(attLinks.map(i => i.id));
      spg.strokes = (spg.strokes || []).filter(s => !ids.includes(s.id));
      spg.images = (spg.images || []).filter(im => !imgIds.has(im.id));
      spg.links = (spg.links || []).filter(lk => !linkIds.has(lk.id));
      for (const im of attImgs) {
        const asset = im.asset || im.src;
        if (asset) spg.images.push({ id: uid('im'), kind: 'cardattach', hidden: 1, asset: asset, src: asset, x: 0, y: 0, w: 0, h: 0, cardId: t.id });
      }
    }
    dpg.tasks.push(t);
    if (typeof renumber === 'function') renumber(dpg, col.id);
    saveNote(dstNote, true);
    if (sn && dstNote !== sn) saveNote(sn, true);
    if (typeof hideLasso === 'function') hideLasso();
    if (typeof thumbCache !== 'undefined' && thumbCache && thumbCache.clear) thumbCache.clear();
    if (typeof afterChange === 'function' && (dstPi === IPI || (typeof isSysPi === 'function' && isSysPi(dstPi)) || (dstNote && typeof S !== 'undefined' && dstNote.id === S.cur))) {
      afterChange(dstPi);
    }
    if (dstPi === IPI) render();
    if (!move && !src.quiet && typeof actionToast === 'function' && strokes.length) {
      const srcNoteId = sn && sn.id, srcPageId = spg && spg.id, keepIds = ids.slice();
      actionToast('Card added — original ink kept', 'Remove original', () => {
        const n2 = S.notes.find(x => x.id === srcNoteId), p2 = n2 && n2.pages.find(q => q.id === srcPageId);
        if (!p2 || (typeof S !== 'undefined' && n2.id !== S.cur)) return;
        pushHistory(); p2.strokes = p2.strokes.filter(s => !keepIds.includes(s.id));
        saveNote(n2, true);
        const i = n2.pages.indexOf(p2);
        if (typeof renderPageInk === 'function') renderPageInk(i);
        if (typeof renderOverlay === 'function') renderOverlay(i);
        toastMsg('Original ink removed', 1400);
      }, 8000);
    }
    return t;
  };


  /* ===================== v21eq: board view (normal toolbar, slim cards, layers) ===================== */
  function viewEl() { return host() && host().querySelector('.eo-view'); }
  function worldEl() { return host() && host().querySelector('.eo-world'); }
  function screenToWorld(cx, cy) {
    const v = viewEl(); if (!v) return [0, 0];
    const r = v.getBoundingClientRect();
    return [(cx - r.left - VIEW.x) / VIEW.s, (cy - r.top - VIEW.y) / VIEW.s];
  }
  /* v21eq: new items land in the first empty spot of the visible board instead of on top of what is there */
  function freeSpot(w, h) {
    const v = viewEl(); const pg = ideaPg();
    const r = v ? v.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 900 };
    const [x0, y0] = v ? screenToWorld(r.left + 24, r.top + 24) : [40, 40];
    const vw = Math.max(w + 40, r.width / VIEW.s - 48), vh = Math.max(h + 40, r.height / VIEW.s - 48);
    const boxes = [];
    if (pg) {
      for (const t of (pg.tasks || [])) if (t && t.kind === 'card' && t.bx != null) boxes.push([t.bx, t.by, t.bx + (t.bw || CARD_W), t.by + (t.bh || 200)]);
      for (const i of (pg.images || [])) if (i && !i.hidden && i.w) boxes.push([i.x, i.y, i.x + i.w, i.y + i.h]);
      for (const l of (pg.links || [])) if (l) boxes.push([l.x, l.y, l.x + (l.w || 260), l.y + (l.h || 72)]);
      for (const s of (pg.strokes || [])) if (s && s.bb) boxes.push([s.bb[0] - 6, s.bb[1] - 6, s.bb[2] + 6, s.bb[3] + 6]);
    }
    const hit = (x, y) => boxes.some(b => x < b[2] + 16 && x + w + 16 > b[0] && y < b[3] + 16 && y + h + 16 > b[1]);
    for (let y = Math.max(20, y0); y + h <= y0 + vh; y += 24)
      for (let x = Math.max(20, x0); x + w <= x0 + vw; x += 24) if (!hit(x, y)) return [x, y];
    const n = boxes.length % 8;
    return [Math.max(20, x0 + 36 + n * 28), Math.max(20, y0 + 36 + n * 28)];
  }
  function applyView() {
    const w = worldEl(); if (!w) return;
    w.style.transform = 'translate(' + VIEW.x + 'px, ' + VIEW.y + 'px) scale(' + VIEW.s + ')';
    checkInkRegion();
  }
  /* v21er: viewport-sized ink canvases. INK = the board rectangle (world units) the two canvases cover and
     k = backing pixels per world unit. w*k × h*k never exceeds CANVAS_CAP. */
  const CANVAS_CAP = 16000000, INK_MARGIN = 0.25;
  const INK = { x0: 0, y0: 0, w: 0, h: 0, k: 1, s: 1 };
  let inkRaf = 0, inkZoomT = 0;
  function wantRegion() {
    const pg = ideaPg(), v = viewEl(); if (!pg || !v) return null;
    const ww = pg.board.wb.w, hh = pg.board.wb.h;
    const vw = Math.max(1, v.clientWidth || 800) / VIEW.s, vh = Math.max(1, v.clientHeight || 900) / VIEW.s;
    const vx = -VIEW.x / VIEW.s, vy = -VIEW.y / VIEW.s;
    let x0 = Math.max(0, Math.floor(vx - vw * INK_MARGIN)), y0 = Math.max(0, Math.floor(vy - vh * INK_MARGIN));
    let x1 = Math.min(ww, Math.ceil(vx + vw * (1 + INK_MARGIN))), y1 = Math.min(hh, Math.ceil(vy + vh * (1 + INK_MARGIN)));
    if (x1 - x0 < 8) { x0 = Math.max(0, Math.min(x0, ww - 8)); x1 = Math.min(ww, x0 + 8); }
    if (y1 - y0 < 8) { y0 = Math.max(0, Math.min(y0, hh - 8)); y1 = Math.min(hh, y0 + 8); }
    const w = Math.max(8, x1 - x0), h = Math.max(8, y1 - y0);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let k = dpr * VIEW.s;
    if (w * k * h * k > CANVAS_CAP) k = Math.sqrt(CANVAS_CAP / (w * h)) * 0.999;
    return { x0, y0, w, h, k, s: VIEW.s, vx, vy, vw, vh };
  }
  function placeInk(force) {
    const R = wantRegion(); if (!R) return false;
    const cvs = [host() && host().querySelector('canvas.eo-ink'), host() && host().querySelector('canvas.eo-live')];
    Object.assign(INK, { x0: R.x0, y0: R.y0, w: R.w, h: R.h, k: R.k, s: R.s });
    for (const cv of cvs) {
      if (!cv) continue;
      cv.style.left = R.x0 + 'px'; cv.style.top = R.y0 + 'px'; cv.style.width = R.w + 'px'; cv.style.height = R.h + 'px';
      const pw = Math.max(1, Math.floor(R.w * R.k)), ph = Math.max(1, Math.floor(R.h * R.k));
      if (force || cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      inkCtx(cv);
    }
    return true;
  }
  function inkCtx(cv) {
    const ctx = cv.getContext('2d');
    const kx = cv.width / INK.w, ky = cv.height / INK.h;
    ctx.setTransform(kx, 0, 0, ky, -INK.x0 * kx, -INK.y0 * ky);
    return ctx;
  }
  function clearCanvas(cv) {
    const ctx = cv.getContext('2d'); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore(); inkCtx(cv); return ctx;
  }
  /* after a pan / zoom: re-place only when the visible board leaves the covered box or the zoom changed a lot */
  function checkInkRegion() {
    if (!INK.w || !host() || !host().querySelector('canvas.eo-ink')) return;
    const R = wantRegion(); if (!R) return;
    const out = R.vx < INK.x0 - 1 && INK.x0 > 0 || R.vy < INK.y0 - 1 && INK.y0 > 0 ||
      R.vx + R.vw > INK.x0 + INK.w + 1 && INK.x0 + INK.w < ideaPg().board.wb.w || R.vy + R.vh > INK.y0 + INK.h + 1 && INK.y0 + INK.h < ideaPg().board.wb.h;
    const zoomed = Math.abs(R.k - INK.k) / INK.k > 0.2;
    const redo = () => { inkRaf = 0; if (ST.g && (ST.g.typ === 'ink' || ST.g.typ === 'lasso')) return; placeInk(); drawInkLayer(); if (ST.selLasso && ST.selLasso.poly) drawLassoLive(ST.selLasso.poly, true); };
    if (out) { if (!inkRaf) inkRaf = requestAnimationFrame(redo); }
    else if (zoomed) { clearTimeout(inkZoomT); inkZoomT = setTimeout(() => { if (!inkRaf) inkRaf = requestAnimationFrame(redo); }, 140); }
  }
  function sizeWorld() {
    const pg = ideaPg(); if (!pg) return;
    const w = worldEl();
    const ww = pg.board.wb.w, hh = pg.board.wb.h;
    if (w) { w.style.width = ww + 'px'; w.style.height = hh + 'px'; }
    placeInk();
    const grid = host() && host().querySelector('.eo-grid');
    if (grid) { grid.style.width = ww + 'px'; grid.style.height = hh + 'px'; }
  }
  function emptyHint() {
    const pg = ideaPg();
    const looseIm = (pg && pg.images || []).some(im => im && !im.hidden && im.kind !== 'pdfsource' && im.kind !== 'cardattach');
    const empty = !cardsOf().length && !(pg && pg.strokes && pg.strokes.length) && !looseIm && !(pg && pg.links && pg.links.length) && !(pg && (pg.pdfs || []).length);
    return empty ? '<div class="eo-empty"><div class="eo-empty-card"><h3>Start the whiteboard</h3><p>Write anywhere with Apple Pencil. Use ＋ Insert for photos, links, PDFs and cards. Lasso ink to make a card.</p></div></div>' : '';
  }
  const isSel = (k, id) => !!(ST.sel && ST.sel.kind === k && ST.sel.id === id);
  const titleH = t => ((t && (t.text || '').trim()) ? TITLE_H : 0);
  const hasAttach = t => { const a = attachOf(t); return !!(((a.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach').length) || (a.links || []).length); };
  function statusChip(t) {
    const st = statusOf(t);
    return '<button type="button" class="eo-chip ' + st + '" data-act="status" data-id="' + t.id + '">' + statusLabel(t) + '</button>';
  }
  function statusLabel(t) { return (STATUSES.find(s => s.id === statusOf(t)) || STATUSES[0]).title; }
  function selTools(kind, id) {
    return '<div class="eo-sel-tools">' +
      (kind === 'card' ? '<button type="button" class="eo-icon" data-act="expand" data-id="' + id + '" aria-label="Expand card" title="Open full size">⤢</button>' : '') +
      '<button type="button" class="eo-icon" data-act="menu" data-kind="' + kind + '" data-id="' + id + '" aria-label="' + (kind === 'card' ? 'Card options' : kind === 'img' ? 'Photo options' : 'Link options') + '">⋯</button></div>' +
      '<div class="eo-resize" data-act="resize" data-id="' + id + '" aria-label="Resize"></div>';
  }
  function cardHtml(t) {
    const sel = isSel('card', t.id), title = (t.text || '').trim();
    return '<div class="eo-card slim' + (t.color ? ' c-' + t.color : '') + (t.done ? ' done' : '') + (sel ? ' selected' : '') + '" data-kind="card" data-id="' + t.id + '" style="left:' + t.bx + 'px;top:' + t.by + 'px;width:' + (t.bw || CARD_W) + 'px;height:' + (t.bh || defaultCardH(t)) + 'px">' +
      (title ? '<div class="eo-card-title">' + esc(title) + '</div>' : '') +
      '<div class="eo-card-body"><canvas class="eo-card-ink"></canvas></div>' +
      attachHtml(t) + (sel ? selTools('card', t.id) : '') + '</div>';
  }
  function attachOf(t) {
    return { images: (t && t.attach && t.attach.images) || (t && t.images) || [], links: (t && t.attach && t.attach.links) || (t && t.links) || [] };
  }
  function attachHtml(t) {
    const att = attachOf(t);
    const imgs = (att.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach');
    const lks = att.links || [];
    if (!imgs.length && !lks.length) return '';
    const thumbs = imgs.map(im => '<div class="eo-att-img" data-att-img="' + im.id + '"><img alt=""></div>').join('');
    const chips = lks.map(lk => {
      const href = safeLink(lk.href);
      const hostn = href ? hostnameOf(href) : '';
      const fav = href ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostn) + '&sz=64' : '';
      return '<a class="eo-att-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" data-att-link="' + lk.id + '">' +
        (fav ? '<img class="eo-fav" alt="" src="' + fav + '" width="16" height="16">' : '') +
        '<span class="eo-att-title">' + esc(lk.title || hostn || 'Link') + '</span></a>';
    }).join('');
    return '<div class="eo-card-attach">' + thumbs + chips + '</div>';
  }
  function imgHtml(im) {
    let src = typeof assetUrl === 'function' ? (assetUrl(im.asset || im.src) || '') : (im.src || '');
    if (!/^(data:|blob:|https?:|\.?\/)/.test(src)) src = urlCache.get(im.asset || im.src) || '';   /* v21eq: a bare asset id is not a URL (avoids a 404); fillAssetImgs fills it */
    const sel = isSel('img', im.id);
    return '<div class="eo-img' + (im.pdfId ? ' pdf' : '') + (sel ? ' selected' : '') + '" data-kind="img" data-id="' + im.id + '" style="left:' + (im.x || 0) + 'px;top:' + (im.y || 0) + 'px;width:' + (im.w || 280) + 'px;height:' + (im.h || 200) + 'px">' +
      (src ? '<img alt="" src="' + src + '">' : '<img alt="">') +
      (im.pdfId ? '<span class="eo-pdf-badge">PDF p.' + (im.page || 1) + '</span>' : '') + (sel ? selTools('img', im.id) : '') + '</div>';
  }
  function linkHtml(lk) {
    const href = safeLink(lk.href);
    const hostn = href ? hostnameOf(href) : '';
    const fav = href ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostn) + '&sz=64' : '';
    const sel = isSel('link', lk.id);
    return '<div class="eo-link' + (sel ? ' selected' : '') + '" data-kind="link" data-id="' + lk.id + '" style="left:' + (lk.x || 0) + 'px;top:' + (lk.y || 0) + 'px;width:' + (lk.w || 260) + 'px;height:' + (lk.h || 72) + 'px">' +
      (fav ? '<img class="eo-fav" alt="" src="' + fav + '" width="28" height="28">' : '') +
      '<div class="eo-lmeta"><div class="eo-ltitle">' + esc(lk.title || hostn || 'Link') + '</div><div class="eo-lhost">' + esc(hostn) + '</div></div>' + (sel ? selTools('link', lk.id) : '') + '</div>';
  }
  function safeLink(u) {
    try {
      const x = new URL(String(u || ''), location.href);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
      return x.href;
    } catch (e) { return ''; }
  }
  function hostnameOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function parseUrlTitle(raw) {
    let t = String(raw || '').trim();
    /* v21er: a typed "airbnb.com/rooms/…" or "www.site.com" gets https:// added (never for other schemes) */
    if (!/https?:\/\//i.test(t) && !/^[a-z][a-z0-9+.-]*:/i.test(t) && /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([\/?#][^\s<>"]*)?$/i.test(t)) t = 'https://' + t;
    const m = t.match(/https?:\/\/[^\s<>"]+/i);
    if (!m) return null;
    const href = safeLink(m[0]); if (!href) return null;
    let title = '';
    const hm = t.match(/<a[^>]+>([^<]+)<\/a>/i) || t.match(/<title>([^<]+)<\/title>/i);
    if (hm) title = hm[1].trim();
    if (!title) {
      try {
        const path = decodeURIComponent(new URL(href).pathname || '').replace(/\/+/g, ' ').replace(/[-_]/g, ' ').trim();
        title = path && path !== '/' ? path.replace(/\s+/g, ' ') : hostnameOf(href);
      } catch (e) { title = hostnameOf(href); }
    }
    return { href, title: title || hostnameOf(href) || 'Link' };
  }

  /* ---------- the normal note toolbar lives on the board while it is open ---------- */
  let tbHome = null;
  function mountToolbar(on) {
    const tb = document.getElementById('toolbar'), drawer = document.getElementById('qbDrawer'), ib = host();
    if (!tb || !drawer || !ib) return;
    if (!tbHome) tbHome = { parent: tb.parentNode };
    if (on) {
      if (tb.parentNode !== drawer) { drawer.insertBefore(tb, ib); }
      tb.classList.add('on-board'); document.body.classList.add('eq-board-tools');
    } else if (tb.parentNode === drawer) {
      const anchor = document.getElementById('noteReminders');
      if (anchor && anchor.parentNode === tbHome.parent) tbHome.parent.insertBefore(tb, anchor); else tbHome.parent.appendChild(tb);
      tb.classList.remove('on-board'); document.body.classList.remove('eq-board-tools');
      closeInsertMenu(); cancelLasso();
    } else { tb.classList.remove('on-board'); document.body.classList.remove('eq-board-tools'); }
    if (typeof window.__eqFitToolbar === 'function') try { window.__eqFitToolbar(); } catch (e) {}
  }
  function syncMount() { mountToolbar(isOpen()); }

  function render() {
    syncMount();
    if (!isOpen()) return;
    const h = host(); if (!h) return;
    const pg = ensureWB(); if (!pg) return;
    growWorldToFit(pg);
    const images = (pg.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach' && !im.hidden).map(imgHtml).join('');
    const links = (pg.links || []).map(linkHtml).join('');
    const cards = cardsOf().map(cardHtml).join('');
    h.innerHTML = '<div class="eo-view">' + emptyHint() + '<div class="eo-world"><div class="eo-grid"></div>' +
      '<div class="eo-layer eo-media">' + images + links + '</div>' +
      '<canvas class="eo-ink"></canvas>' +
      '<div class="eo-layer eo-cards">' + cards + '</div>' +
      '<canvas class="eo-live"></canvas></div></div>' +
      '<input type="file" class="eo-photo-in" accept="image/*" hidden>' +
      '<input type="file" class="eo-pdf-in" accept="application/pdf,.pdf" hidden>';
    sizeWorld(); applyView(); bindBoard(); drawInkLayer(); drawCardInks();
    fillAssetImgs();
    if (ST.selLasso && ST.selLasso.poly) drawLassoLive(ST.selLasso.poly, true);
    if (typeof storeView === 'function') try { storeView(); } catch (e) {}
  }
  function drawInkLayer() {
    const cv = host() && host().querySelector('canvas.eo-ink');
    const pg = ideaPg(); if (!cv || !pg) return;
    if (!INK.w) placeInk();
    const ctx = clearCanvas(cv);
    if (typeof drawStroke !== 'function') return;
    /* only strokes that touch the covered box */
    const X0 = INK.x0 - 40, Y0 = INK.y0 - 40, X1 = INK.x0 + INK.w + 40, Y1 = INK.y0 + INK.h + 40;
    const st = (pg.strokes || []).filter(s => { const b = s.bb || (s.points && s.points.length && typeof bbox === 'function' ? (s.bb = bbox(s.points)) : null); return !b || !(b[2] < X0 || b[0] > X1 || b[3] < Y0 || b[1] > Y1); });
    st.forEach(s => { if (s.tool === 'highlighter') drawStroke(ctx, s); });
    st.forEach(s => { if (s.tool !== 'highlighter') drawStroke(ctx, s); });
  }
  function cardScale(t, bodyW) { const inkW = typeof INK_W === 'number' ? INK_W : 300; return t.unit === 1 ? 1 : bodyW / inkW; }
  function drawCardInks(only) {
    const pg = ideaPg(); if (!pg || !host()) return;
    host().querySelectorAll('.eo-card').forEach(el => {
      if (only && el.dataset.id !== only) return;
      const t = byId(pg.tasks, el.dataset.id); if (!t) return;
      const cv = el.querySelector('canvas.eo-card-ink'); if (!cv) return;
      const body = el.querySelector('.eo-card-body');
      const rw = Math.max(8, body.clientWidth), rh = Math.max(8, body.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(rw * dpr); cv.height = Math.round(rh * dpr);
      cv.style.width = rw + 'px'; cv.style.height = rh + 'px';
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rw, rh);
      const scale = cardScale(t, rw);
      ctx.save(); ctx.scale(scale, scale);
      if (typeof drawStroke === 'function') {
        (t.strokes || []).forEach(s => { if (s.tool === 'highlighter') drawStroke(ctx, s); });
        (t.strokes || []).forEach(s => { if (s.tool !== 'highlighter') drawStroke(ctx, s); });
      }
      ctx.restore();
    });
  }

  function bindBoard() {
    const h = host(), view = viewEl(), world = worldEl();
    if (!h || !view) return;
    h.querySelectorAll('[data-act="menu"]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); openItemMenu(b.dataset.kind || 'card', b.dataset.id, b); }));
    h.querySelectorAll('[data-act="expand"]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); openCardFull(b.dataset.id); }));
    const photoIn = h.querySelector('.eo-photo-in'), pdfIn = h.querySelector('.eo-pdf-in');
    if (photoIn) photoIn.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) addPhotoFile(f); });
    if (pdfIn) pdfIn.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) importPdfToBoard(f); });
    world.querySelectorAll('.eo-link').forEach(el => el.addEventListener('click', ev => {
      if (ev.target.closest('button,.eo-resize')) return;
      if (Date.now() < ST.noClickUntil) { ev.preventDefault(); return; }
      const pg = ideaPg(), lk = byId(pg.links, el.dataset.id);
      const href = lk && safeLink(lk.href); if (!href) return;
      ev.preventDefault(); ev.stopPropagation();
      const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    }));
    world.querySelectorAll('.eo-img.pdf').forEach(el => el.addEventListener('click', ev => {
      if (ev.target.closest('button,.eo-resize')) return;
      if (Date.now() < ST.noClickUntil) return;
      ev.preventDefault(); ev.stopPropagation();
      const im = byId(ideaPg().images, el.dataset.id);
      if (im && im.pdfId) openPdfViewer(im.pdfId, im.page);
    }));
    view.addEventListener('pointerdown', onPtrDown);
    view.addEventListener('wheel', onWheel, { passive: false });
    view.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    view.addEventListener('drop', onDrop);
    view.addEventListener('contextmenu', ev => ev.preventDefault());
  }
  function onTool(act) {
    closeInsertMenu();
    if (act === 'photo') { const i = host().querySelector('.eo-photo-in'); if (i) i.click(); }
    else if (act === 'pdf') { const i = host().querySelector('.eo-pdf-in'); if (i) i.click(); }
    else if (act === 'link') promptLink();
    else if (act === 'card') addBlankCard();
  }
  /* ＋ Insert on the board: Photo · Link · PDF · Card */
  function closeInsertMenu() { const m = document.getElementById('eqBoardIns'); if (m) m.remove(); const b = document.getElementById('insertBtn'); if (b) b.setAttribute('aria-expanded', 'false'); }
  function openInsertMenu(anchor) {
    if (document.getElementById('eqBoardIns')) { closeInsertMenu(); return; }
    const m = document.createElement('div'); m.id = 'eqBoardIns'; m.className = 'eq-pop'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Insert on the Idea Board');
    m.innerHTML = [['photo', '🖼', 'Photo', 'From Photos or the camera'], ['link', '🔗', 'Link', 'Paste a web address'], ['pdf', '📑', 'PDF', 'Pick pages to place'], ['card', '🗂', 'Card', 'A blank card to write in']]
      .map(([a, i, l, s]) => '<button type="button" role="menuitem" data-ins="' + a + '"><i>' + i + '</i><span>' + l + '<small>' + s + '</small></span></button>').join('');
    document.body.appendChild(m);
    const r = (anchor || document.body).getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    m.style.top = (r.bottom + 6) + 'px';
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    m.addEventListener('click', ev => { const b = ev.target.closest('[data-ins]'); if (!b) return; ev.stopPropagation(); onTool(b.dataset.ins); });
  }
  document.addEventListener('click', ev => {
    const ib = ev.target.closest && ev.target.closest('#insertBtn');
    if (ib && isOpen() && ib.closest('#qbDrawer')) { ev.preventDefault(); ev.stopImmediatePropagation(); openInsertMenu(ib); return; }
    const tool = ev.target.closest && ev.target.closest('#toolbar .tool');
    if (tool && isOpen()) { cancelLasso(); if (ST.sel) { ST.sel = null; render(); } closeInsertMenu(); }
  }, true);
  document.addEventListener('pointerdown', ev => {
    const m = document.getElementById('eqBoardIns');
    if (m && !m.contains(ev.target) && !(ev.target.closest && ev.target.closest('#insertBtn'))) closeInsertMenu();
    const lm = document.querySelector('.eo-lasso-menu');
    if (lm && !lm.contains(ev.target)) cancelLasso();
  }, true);

  function cycleStatus(id) {
    const pg = ideaPg(), t = byId(pg.tasks, id); if (!t) return;
    const order = ['todo', 'doing', 'done'];
    const next = order[(order.indexOf(statusOf(t)) + 1) % 3];
    pushWB(); setStatus(t, next); saveWB(); render();
  }
  function setStatus(t, st) {
    const pg = ideaPg(), col = colForStatus(pg, st);
    t.col = col.id; t.done = st === 'done'; t.doneAt = t.done ? Date.now() : null;
    if (typeof renumber === 'function') renumber(pg, col.id);
  }

  function midOf(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; }
  function isPen(ev) { return ev.pointerType === 'pen' || ev.pointerType === 'mouse'; }
  function onHandle(el, ev) {
    const h = el.querySelector(':scope > .eo-resize'); if (!h) return false;
    const r = h.getBoundingClientRect();
    const slop = ev.pointerType === 'touch' ? FINGER_SLOP : 0;
    return ev.clientX >= r.left - slop && ev.clientX <= r.right + slop && ev.clientY >= r.top - slop && ev.clientY <= r.bottom + slop;
  }
  function findTarget(ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-kind]') : null;
    if (!el || !el.classList.contains('eo-card') && !el.classList.contains('eo-img') && !el.classList.contains('eo-link')) return null;
    return { el, kind: el.dataset.kind, id: el.dataset.id, resize: onHandle(el, ev) };
  }
  function cardLocal(el, t, cx, cy) {
    const body = el.querySelector('.eo-card-body'); if (!body) return null;
    const br = body.getBoundingClientRect();
    if (cx < br.left || cy < br.top || cx > br.right || cy > br.bottom) return null;
    const sc = cardScale(t, body.clientWidth);
    return [(cx - br.left) / (VIEW.s * sc), (cy - br.top) / (VIEW.s * sc)];
  }
  const inkStyle = () => {
    const hl = typeof S !== 'undefined' && S.tool === 'highlighter';
    return hl ? { tool: 'highlighter', color: S.hlColor || '#ffd60a', width: S.hlWidth || 18 }
      : { tool: 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2 };
  };
  const curTool = () => (typeof S !== 'undefined' && S.tool) || 'pen';
  const fingerDraws = () => typeof fingerDrawOn === 'function' && fingerDrawOn();
  function listen(ev) {
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.target.addEventListener('pointermove', onPtrMove);
    ev.target.addEventListener('pointerup', onPtrUp);
    ev.target.addEventListener('pointercancel', onPtrUp);
  }
  function startGesture(ev, tgt) {
    /* Pencil (or mouse, or finger with ☝️ Finger on): the current tool */
    const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
    const tool = curTool();
    if (tool === 'lasso' || (isPen(ev) && ev.buttons === 32)) { cancelLasso(); ST.g = { typ: 'lasso', pts: [[wx, wy]] }; return; }
    if (tool === 'eraser') { ST.g = { typ: 'erase', snap: bSnapNow(), changed: false }; eraseAt(ev.clientX, ev.clientY); return; }
    if (tool === 'text') { ST.g = { typ: 'textTap', sx: ev.clientX, sy: ev.clientY, wx, wy }; return; }
    const style = inkStyle();
    if (tgt && tgt.kind === 'card') {
      const t = getItem('card', tgt.id), loc = t && cardLocal(tgt.el, t, ev.clientX, ev.clientY);
      if (loc) { ST.g = { typ: 'cink', id: t.id, style, bw0: t.bw, bh0: t.bh, pts: [[+loc[0].toFixed(2), +loc[1].toFixed(2), ev.pressure || 0.5]], el: tgt.el, sx: ev.clientX, sy: ev.clientY }; return; }
    }
    ST.g = { typ: 'ink', style, pts: [[+wx.toFixed(2), +wy.toFixed(2), ev.pressure || 0.5]], sx: ev.clientX, sy: ev.clientY };
  }
  function onPtrDown(ev) {
    if (ev.button && ev.button !== 0 && ev.button !== 5) return;
    if (ev.target.closest && ev.target.closest('button,a,input,.eo-lasso-menu,.eo-att-link')) return;
    const tgt = findTarget(ev);
    ST.ptrs = ST.ptrs || new Map();
    ST.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: ev.pointerType });
    if (ev.pointerType === 'touch' && [...ST.ptrs.values()].filter(p => p.type === 'touch').length === 2) {
      ev.preventDefault();
      if (ST.g && ST.g.timer) clearTimeout(ST.g.timer);
      if (ST.g && (ST.g.typ === 'ink' || ST.g.typ === 'cink')) clearLive();
      const pts = [...ST.ptrs.values()].filter(p => p.type === 'touch');
      ST.g = { typ: 'pinch', mid: midOf(pts[0], pts[1]), vx: VIEW.x, vy: VIEW.y, vs: VIEW.s };
      listen(ev); return;
    }
    if (!isPen(ev) && ev.isPrimary === false) return;
    if (ST.g && ST.g.typ !== 'pinch' && isPen(ev) === false && ST.g.pen) return;   // palm while Pencil is down
    ev.preventDefault();
    listen(ev);
    if (tgt && tgt.resize) {
      const item = getItem(tgt.kind, tgt.id);
      ST.g = { typ: 'resize', kind: tgt.kind, id: tgt.id, sx: ev.clientX, sy: ev.clientY, ow: itemW(item, tgt.kind), oh: itemH(item, tgt.kind), snap: bSnapNow() };
      return;
    }
    if (isPen(ev)) { startGesture(ev, tgt); if (ST.g) ST.g.pen = true; return; }
    /* finger */
    if (tgt) {
      const g = { typ: 'hold', kind: tgt.kind, id: tgt.id, el: tgt.el, sx: ev.clientX, sy: ev.clientY, vx: VIEW.x, vy: VIEW.y, pid: ev.pointerId, ev0: { clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, buttons: ev.buttons, pointerType: ev.pointerType, target: ev.target } };
      g.timer = setTimeout(() => {
        if (ST.g !== g) return;
        const it = getItem(g.kind, g.id); if (!it) return;
        Object.assign(g, { typ: 'move', ox: itemX(it, g.kind), oy: itemY(it, g.kind), snap: bSnapNow(), moved: false, timer: null });
        ST.sel = { kind: g.kind, id: g.id };
        const el = worldEl() && worldEl().querySelector('[data-kind="' + g.kind + '"][data-id="' + g.id + '"]');
        if (el) el.classList.add('lifted', 'selected');
        try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
      }, HOLD_MS);
      ST.g = g; return;
    }
    if (fingerDraws() && ['pen', 'highlighter', 'eraser', 'lasso', 'text'].includes(curTool())) { startGesture(ev, null); return; }
    ST.g = { typ: 'pan', sx: ev.clientX, sy: ev.clientY, vx: VIEW.x, vy: VIEW.y, tap: true };
  }
  function bSnapNow() { try { return typeof bSnap === 'function' ? bSnap(IPI) : null; } catch (e) { return null; } }
  function pushSnap(snap) { if (snap && typeof bPushSnap === 'function') bPushSnap(IPI, snap); else pushWB(); }
  function getItem(kind, id) {
    const pg = ideaPg(); if (!pg) return null;
    if (kind === 'card') return byId(pg.tasks, id);
    if (kind === 'img') return byId(pg.images, id);
    if (kind === 'link') return byId(pg.links, id);
    return null;
  }
  function itemW(it, k) { return k === 'card' ? (it.bw || CARD_W) : (it.w || (k === 'link' ? 260 : 280)); }
  function itemH(it, k) { return k === 'card' ? (it.bh || defaultCardH(it)) : (it.h || (k === 'link' ? 72 : 200)); }
  function itemX(it, k) { return k === 'card' ? it.bx : it.x; }
  function itemY(it, k) { return k === 'card' ? it.by : it.y; }
  function setItemBox(it, k, x, y, w, h) {
    if (k === 'card') { if (x != null) it.bx = x; if (y != null) it.by = y; if (w != null) it.bw = w; if (h != null) it.bh = h; }
    else { if (x != null) it.x = x; if (y != null) it.y = y; if (w != null) it.w = w; if (h != null) it.h = h; }
  }
  function onPtrMove(ev) {
    if (ST.ptrs && ST.ptrs.has(ev.pointerId)) ST.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: ev.pointerType });
    const g = ST.g; if (!g) return;
    ev.preventDefault();
    if (g.typ === 'pinch') {
      const pts = [...ST.ptrs.values()].filter(p => p.type === 'touch'); if (pts.length < 2) return;
      const m = midOf(pts[0], pts[1]);
      const s = g.vs * (m.d / (g.mid.d || 1));
      VIEW.s = Math.max(0.35, Math.min(3, s));
      VIEW.x = g.vx + (m.x - g.mid.x);
      VIEW.y = g.vy + (m.y - g.mid.y);
      applyView(); return;
    }
    if (g.typ === 'hold') {
      if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > HOLD_SLOP) {
        clearTimeout(g.timer);
        /* moved before the hold: it is a pan (or a finger stroke when ☝️ Finger draws) */
        if (fingerDraws() && ['pen', 'highlighter', 'eraser', 'lasso'].includes(curTool())) { ST.g = null; startGesture(Object.assign({}, g.ev0), { el: g.el, kind: g.kind, id: g.id }); if (ST.g) onPtrMove(ev); }
        else ST.g = { typ: 'pan', sx: g.sx, sy: g.sy, vx: g.vx, vy: g.vy };
        if (ST.g && ST.g.typ === 'pan') { VIEW.x = ST.g.vx + (ev.clientX - ST.g.sx); VIEW.y = ST.g.vy + (ev.clientY - ST.g.sy); applyView(); }
      }
      return;
    }
    if (g.typ === 'pan') {
      if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 6) g.tap = false;
      VIEW.x = g.vx + (ev.clientX - g.sx); VIEW.y = g.vy + (ev.clientY - g.sy); applyView(); return;
    }
    if (g.typ === 'move') {
      const it = getItem(g.kind, g.id); if (!it) return;
      const dx = (ev.clientX - g.sx) / VIEW.s, dy = (ev.clientY - g.sy) / VIEW.s;
      if (!g.moved && Math.hypot(dx, dy) > 1) { g.moved = true; pushSnap(g.snap); }
      setItemBox(it, g.kind, Math.max(0, g.ox + dx), Math.max(0, g.oy + dy));
      const el = worldEl().querySelector('[data-kind="' + g.kind + '"][data-id="' + g.id + '"]');
      if (el) { el.style.left = itemX(it, g.kind) + 'px'; el.style.top = itemY(it, g.kind) + 'px'; }
      growWorldAt(itemX(it, g.kind) + itemW(it, g.kind), itemY(it, g.kind) + itemH(it, g.kind));
      return;
    }
    if (g.typ === 'resize') {
      const it = getItem(g.kind, g.id); if (!it) return;
      const dw = (ev.clientX - g.sx) / VIEW.s, dh = (ev.clientY - g.sy) / VIEW.s;
      const w = Math.max(MIN_W, g.ow + dw), h = Math.max(g.kind === 'link' ? 56 : MIN_H, g.oh + dh);
      if (!g.changed && (Math.abs(dw) > 1 || Math.abs(dh) > 1)) { g.changed = true; pushSnap(g.snap); }
      setItemBox(it, g.kind, null, null, w, h);
      const el = worldEl().querySelector('[data-kind="' + g.kind + '"][data-id="' + g.id + '"]');
      if (el) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
      if (g.kind === 'card') drawCardInks(g.id);
      growWorldAt(itemX(it, g.kind) + w, itemY(it, g.kind) + h);
      return;
    }
    if (g.typ === 'erase') { eraseAt(ev.clientX, ev.clientY); return; }
    if (g.typ === 'textTap') return;
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    const list = evs.length ? evs : [ev];
    if (g.typ === 'ink') {
      for (const e of list) { const [wx, wy] = screenToWorld(e.clientX, e.clientY); g.pts.push([+wx.toFixed(2), +wy.toFixed(2), e.pressure || 0.5]); }
      const last = g.pts[g.pts.length - 1];
      drawLive(g.pts, g.style); growWorldAt(last[0], last[1]); return;
    }
    if (g.typ === 'cink') {
      const el = g.el, t = getItem('card', g.id); if (!el || !t) return;
      const body = el.querySelector('.eo-card-body'); if (!body) return;
      const br = body.getBoundingClientRect(), sc = cardScale(t, body.clientWidth);
      for (const e of list) g.pts.push([+((e.clientX - br.left) / (VIEW.s * sc)).toFixed(2), +((e.clientY - br.top) / (VIEW.s * sc)).toFixed(2), e.pressure || 0.5]);
      const last = g.pts[g.pts.length - 1];
      autoGrowCard(t, last[0] * sc, last[1] * sc, el);
      drawLiveCard(el, t, g.pts, g.style);
      return;
    }
    if (g.typ === 'lasso') {
      const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
      g.pts.push([wx, wy]);
      drawLassoLive(g.pts);
    }
  }
  let liveBB = null;
  function clearLive() {
    const cv = host() && host().querySelector('canvas.eo-live');
    if (cv) clearCanvas(cv);
    liveBB = null;
  }
  /* v21er: clear only the live stroke's own dirty box, then draw the stroke (no full-board clear per move) */
  function drawLive(pts, style) {
    const cv = host() && host().querySelector('canvas.eo-live'); if (!cv) return;
    const ctx = inkCtx(cv);
    const s = Object.assign({}, style || inkStyle(), { points: pts });
    const bb = typeof bbox === 'function' ? bbox(pts) : null; if (bb) s.bb = bb;
    const pad = (s.width || 3) * 2 + 4;
    const box = bb ? [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad] : null;
    const u = liveBB && box ? [Math.min(liveBB[0], box[0]), Math.min(liveBB[1], box[1]), Math.max(liveBB[2], box[2]), Math.max(liveBB[3], box[3])] : (box || liveBB);
    if (u) ctx.clearRect(u[0], u[1], u[2] - u[0], u[3] - u[1]); else clearCanvas(cv);
    liveBB = box;
    if (typeof drawStroke === 'function') drawStroke(ctx, s);
  }
  function drawLassoLive(pts, closed) {
    const cv = host() && host().querySelector('canvas.eo-live'); if (!cv) return;
    const ctx = clearCanvas(cv); liveBB = null;
    ctx.save(); ctx.strokeStyle = 'rgba(90,130,220,.95)'; ctx.lineWidth = 1.5 / VIEW.s; ctx.setLineDash([6 / VIEW.s, 4 / VIEW.s]);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath(); ctx.stroke();
    if (closed) { ctx.fillStyle = 'rgba(90,130,220,.07)'; ctx.fill(); }
    ctx.restore();
  }
  function drawLiveCard(el, t, pts, style) {
    const cv = el.querySelector('canvas.eo-card-ink'); if (!cv) return;
    const body = el.querySelector('.eo-card-body');
    const rw = body.clientWidth, rh = body.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(rw * dpr) || cv.height !== Math.round(rh * dpr)) { cv.width = Math.round(rw * dpr); cv.height = Math.round(rh * dpr); cv.style.width = rw + 'px'; cv.style.height = rh + 'px'; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rw, rh);
    const scale = cardScale(t, rw);
    ctx.save(); ctx.scale(scale, scale);
    if (typeof drawStroke === 'function') {
      (t.strokes || []).forEach(s => drawStroke(ctx, s));
      const s = Object.assign({}, style || inkStyle(), { points: pts });
      if (typeof bbox === 'function') s.bb = bbox(pts);
      drawStroke(ctx, s);
    }
    ctx.restore();
  }
  function autoGrowCard(t, lx, ly, el) {
    const pad = 28;
    const att = hasAttach(t) ? ATTACH_H : 0;
    const needW = Math.max(t.bw || CARD_W, Math.ceil(lx + pad + 8));
    const needH = Math.max(t.bh || defaultCardH(t), Math.ceil(titleH(t) + ly + pad + att));
    if (needW > (t.bw || 0) || needH > (t.bh || 0)) {
      t.bw = needW; t.bh = needH;
      if (el) { el.style.width = needW + 'px'; el.style.height = needH + 'px'; }
      if (t.bx != null) growWorldAt(t.bx + needW, t.by + needH);
    }
  }
  /* stroke eraser (same idea as notes: a touched stroke goes away whole) */
  function segD(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let u = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy); }
  function strokeHit(st, p, R) {
    const pts = st.points || []; if (!pts.length) return false;
    const bb = st.bb || (typeof bbox === 'function' ? bbox(pts) : null), pad = R + (st.width || 2);
    if (bb && (p[0] < bb[0] - pad || p[0] > bb[2] + pad || p[1] < bb[1] - pad || p[1] > bb[3] + pad)) return false;
    const lim = R + (st.width || 2) / 2;
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= lim;
    for (let i = 1; i < pts.length; i++) if (segD(p, pts[i - 1], pts[i]) <= lim) return true;
    return false;
  }
  function eraseAt(cx, cy) {
    const g = ST.g, pg = ideaPg(); if (!pg) return;
    let changed = false;
    const cardEl = document.elementsFromPoint(cx, cy).find(e => e.classList && e.classList.contains('eo-card') && host().contains(e));
    if (cardEl) {
      const t = getItem('card', cardEl.dataset.id), loc = t && cardLocal(cardEl, t, cx, cy);
      if (t && loc) {
        const sc = cardScale(t, cardEl.querySelector('.eo-card-body').clientWidth);
        const before = (t.strokes || []).length;
        const keep = (t.strokes || []).filter(s => !strokeHit(s, loc, 10 / (VIEW.s * sc)));
        if (keep.length !== before) { if (g && !g.changed) { g.changed = true; pushSnap(g.snap); } t.strokes = keep; changed = true; drawCardInks(t.id); }
      }
    } else {
      const p = screenToWorld(cx, cy), before = (pg.strokes || []).length;
      const keep = (pg.strokes || []).filter(s => !strokeHit(s, p, 10 / VIEW.s));
      if (keep.length !== before) { if (g && !g.changed) { g.changed = true; pushSnap(g.snap); } pg.strokes = keep; changed = true; drawInkLayer(); }
    }
    if (changed) saveWB();
  }
  function onPtrUp(ev) {
    ev.target.removeEventListener('pointermove', onPtrMove);
    ev.target.removeEventListener('pointerup', onPtrUp);
    ev.target.removeEventListener('pointercancel', onPtrUp);
    try { ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (ST.ptrs) ST.ptrs.delete(ev.pointerId);
    const g = ST.g; ST.g = null;
    if (!g) return;
    if (g.typ === 'pinch') { if (ST.ptrs && ST.ptrs.size) ST.g = null; return; }
    if (g.typ === 'hold') {
      clearTimeout(g.timer);
      /* a finger tap on an item selects it (links / PDF pages also open on the click) */
      const was = isSel(g.kind, g.id);
      ST.sel = { kind: g.kind, id: g.id };
      if (!was) render();
      return;
    }
    if (g.typ === 'pan') { if (g.tap && ev.type === 'pointerup') { if (ST.sel) { ST.sel = null; render(); } } else saveWB(); return; }
    if (g.typ === 'move') { ST.noClickUntil = Date.now() + 400; if (g.moved) saveWB(); render(); return; }
    if (g.typ === 'resize') { ST.noClickUntil = Date.now() + 400; if (g.changed) saveWB(); render(); return; }
    if (g.typ === 'erase') { return; }
    if (g.typ === 'textTap') {
      if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < 12) openPrompt('Text card', 'Type something', '', v => { v = String(v || '').trim(); if (v) addTextCard(v, [g.wx, g.wy]); }, 'text');
      return;
    }
    const moved = g.sx != null && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 4;
    if (moved) ST.noClickUntil = Date.now() + 350;
    if (g.typ === 'ink') {
      clearLive();
      if (g.pts.length > 1 && moved) {
        const s = Object.assign({ id: uid('s') }, g.style, { points: g.pts });
        if (typeof bbox === 'function') s.bb = bbox(g.pts);
        pushWB();
        const pg = ideaPg(); pg.strokes.push(s); saveWB();
        drawInkLayer();
        const hint = host().querySelector('.eo-empty'); if (hint) hint.remove();
      } else if (ST.sel && !(ev.target.closest && ev.target.closest('.selected'))) { ST.sel = null; render(); }
      return;
    }
    if (g.typ === 'cink') {
      const t = getItem('card', g.id); if (!t) return;
      if (g.pts.length > 1 && moved) {
        const s = Object.assign({ id: uid('s') }, g.style, { points: g.pts });
        if (typeof bbox === 'function') s.bb = bbox(g.pts);
        /* one undo step: restores the card size from before auto-grow too */
        const cur = { bw: t.bw, bh: t.bh }; t.bw = g.bw0 != null ? g.bw0 : t.bw; t.bh = g.bh0 != null ? g.bh0 : t.bh;
        pushWB(); t.bw = cur.bw; t.bh = cur.bh;
        t.strokes = t.strokes || []; t.strokes.push(s); saveWB();
      }
      drawCardInks(t.id); return;
    }
    if (g.typ === 'lasso') {
      if (g.pts.length > 4) finishLasso(g.pts); else clearLive();
    }
  }
  function onWheel(ev) {
    ev.preventDefault();
    const v = viewEl(); if (!v) return;
    const r = v.getBoundingClientRect();
    if (!ev.ctrlKey && !ev.metaKey) { VIEW.x -= ev.deltaX; VIEW.y -= ev.deltaY; applyView(); return; }
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const old = VIEW.s;
    const next = Math.max(0.35, Math.min(3, VIEW.s * (ev.deltaY < 0 ? 1.08 : 0.92)));
    VIEW.x = px - (px - VIEW.x) * (next / old);
    VIEW.y = py - (py - VIEW.y) * (next / old);
    VIEW.s = next; applyView();
  }

  function polyHit(poly, x, y) {
    let n = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1e-6) + a[0])) n++;
    }
    return n % 2 === 1;
  }
  function strokeInLasso(st, poly) {
    const pts = st.points || [];
    if (!pts.length) return false;
    const inside = pts.filter(p => polyHit(poly, p[0], p[1])).length;
    if (inside / pts.length >= 0.5) return true;
    const bb = st.bb;
    if (bb && inside) return polyHit(poly, (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
    return false;
  }
  function finishLasso(poly) {
    const pg = ideaPg();
    const ids = (pg.strokes || []).filter(s => strokeInLasso(s, poly)).map(s => s.id);
    const images = (pg.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach' && !im.hidden && polyHit(poly, (im.x || 0) + (im.w || 0) / 2, (im.y || 0) + (im.h || 0) / 2));
    const links = (pg.links || []).filter(lk => polyHit(poly, (lk.x || 0) + (lk.w || 260) / 2, (lk.y || 0) + (lk.h || 72) / 2));
    if (!ids.length && !images.length && !links.length) { clearLive(); toastMsg('Nothing inside the lasso', 1200); return; }
    ST.selLasso = { ids, images: images.map(i => i.id), links: links.map(l => l.id), poly };
    drawLassoLive(poly, true);
    showLassoMenu(poly);
  }
  function cancelLasso() {
    const had = !!ST.selLasso;
    ST.selLasso = null;
    const m = document.querySelector('.eo-lasso-menu'); if (m) m.remove();
    if (had) clearLive();
  }
  function showLassoMenu(poly) {
    const old = document.querySelector('.eo-lasso-menu'); if (old) old.remove();
    let x2 = -Infinity, y1 = Infinity, y2 = -Infinity, x1 = Infinity;
    for (const p of poly) { x1 = Math.min(x1, p[0]); x2 = Math.max(x2, p[0]); y1 = Math.min(y1, p[1]); y2 = Math.max(y2, p[1]); }
    const v = viewEl(); if (!v) return;
    const r = v.getBoundingClientRect();
    const m = document.createElement('div');
    m.className = 'eo-lasso-menu'; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Lasso selection');
    const n = ST.selLasso, cnt = n.ids.length + n.images.length + n.links.length;
    m.innerHTML = '<span class="eo-lm-n">' + cnt + ' selected</span><button type="button" class="primary" data-act="make">🗂 Make card</button><button type="button" data-act="delete">🗑 Delete</button><button type="button" data-act="cancel">Cancel</button>';
    document.body.appendChild(m);
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let sx = r.left + VIEW.x + ((x1 + x2) / 2) * VIEW.s - mw / 2, sy = r.top + VIEW.y + y1 * VIEW.s - mh - 10;
    if (sy < r.top + 6) sy = r.top + VIEW.y + y2 * VIEW.s + 10;
    sy = Math.max(r.top + 6, Math.min(window.innerHeight - mh - 8, sy));
    sx = Math.max(r.left + 6, Math.min(window.innerWidth - mw - 8, sx));
    m.style.left = sx + 'px'; m.style.top = sy + 'px';
    m.querySelector('[data-act="make"]').onclick = ev => { ev.stopPropagation(); makeCardFromSel(); };
    m.querySelector('[data-act="delete"]').onclick = ev => { ev.stopPropagation(); deleteSel(); };
    m.querySelector('[data-act="cancel"]').onclick = ev => { ev.stopPropagation(); cancelLasso(); };
  }
  function deleteSel() {
    const sel = ST.selLasso; cancelLasso(); if (!sel) return 0;
    const pg = ideaPg();
    pushWB();
    const before = (pg.strokes || []).length + (pg.images || []).length + (pg.links || []).length;
    pg.strokes = (pg.strokes || []).filter(s => !sel.ids.includes(s.id));
    pg.images = (pg.images || []).filter(i => !sel.images.includes(i.id));
    pg.links = (pg.links || []).filter(l => !sel.links.includes(l.id));
    const gone = before - ((pg.strokes || []).length + (pg.images || []).length + (pg.links || []).length);
    saveWB(); render();
    if (typeof actionToast === 'function') actionToast('Deleted ' + gone + ' item' + (gone === 1 ? '' : 's'), 'Undo', () => { if (typeof bUndo === 'function') bUndo(IPI); }, 5000);
    return gone;
  }
  function makeCardFromSel() {
    const sel = ST.selLasso; cancelLasso();
    if (!sel) return null;
    const n = ideaN(), pg = ideaPg();
    const imgs = (pg.images || []).filter(i => sel.images.includes(i.id));
    const lks = (pg.links || []).filter(i => sel.links.includes(i.id));
    const t = cardFromInk({ note: n, pi: IPI, ids: sel.ids, images: imgs, links: lks, move: true }, n, IPI, boardCols(pg)[0].id);
    if (t) { ST.sel = { kind: 'card', id: t.id }; render(); toastMsg('Card made — hold with a finger to move it', 1800); }
    return t;
  }

  function addBlankCard(at) {
    const n = ideaN(), pg = ensureWB(n);
    const col = boardCols(pg)[0];
    const vr = viewEl() && viewEl().getBoundingClientRect();
    const pos = at || (vr ? freeSpot(CARD_W, 200) : [80, 80]);
    pushWB();
    const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1, text: '', typed: false, tstrokes: [], strokes: [], unit: 1, bx: Math.max(20, pos[0]), by: Math.max(20, pos[1]), bw: CARD_W, bh: 200, h: 200, done: false, due: null, repeat: '', notified: false, createdAt: Date.now(), attach: { images: [], links: [] } };
    pg.tasks.push(t); if (typeof renumber === 'function') renumber(pg, col.id); growWorldToFit(pg); ST.sel = { kind: 'card', id: t.id }; saveWB(); render();
    return t;
  }
  function addTextCard(text, at) {
    const t = addBlankCard(at); if (!t) return null;
    t.text = text; t.typed = true; t.bh = Math.max(TITLE_H + 40, 90); saveWB(); render();
    return t;
  }

  async function addPhotoFile(file, at) {
    if (!file) return null;
    const pg = ensureWB(), n = ideaN();
    let src = '', asset = '';
    try {
      let blob = file;
      if (typeof compressImage === 'function') {
        const out = await compressImage(file);
        blob = out && out.blob ? out.blob : out;
      }
      if (typeof Assets !== 'undefined' && Assets && Assets.put) {
        asset = await Assets.put(blob);
        src = asset;
      } else {
        src = URL.createObjectURL(blob);
      }
    } catch (e) { toastMsg('Could not add photo'); return null; }
    const pos = at || freeSpot(280, 200);
    const im = { id: uid('im'), x: pos[0], y: pos[1], w: 280, h: 200, src: src, asset: asset || src };
    pushWB();
    pg.images.push(im); growWorldToFit(pg); saveWB(); render();
    return im;
  }
  function onDrop(ev) {
    ev.preventDefault();
    const dt = ev.dataTransfer; if (!dt) return;
    const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
    const files = [...(dt.files || [])];
    const img = files.find(f => /^image\//.test(f.type));
    const pdf = files.find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    const text = dt.getData('text/uri-list') || dt.getData('text/plain') || dt.getData('text/html') || '';
    if (img) addPhotoFile(img, [wx, wy]);
    else if (pdf) importPdfToBoard(pdf, [wx, wy]);
    else { const p = parseUrlTitle(text); if (p) addLink(p.href, p.title, [wx, wy]); }
  }
  function onPaste(ev) {
    if (!isOpen()) return;
    const cd = ev.clipboardData; if (!cd) return;
    const items = [...(cd.items || [])];
    const imgItem = items.find(i => i.type && i.type.startsWith('image/'));
    if (imgItem) { ev.preventDefault(); const f = imgItem.getAsFile(); if (f) addPhotoFile(f); return; }
    const text = cd.getData('text/html') || cd.getData('text/plain') || '';
    const p = parseUrlTitle(text);
    if (p) { ev.preventDefault(); addLink(p.href, p.title); }
  }
  function addLink(href, title, at) {
    const pg = ensureWB();
    const safe = safeLink(href); if (!safe) { toastMsg('That link is not allowed'); return null; }
    const pos = at || freeSpot(260, 72);
    const lk = { id: uid('lk'), href: safe, title: title || hostnameOf(safe) || 'Link', x: pos[0], y: pos[1], w: 260, h: 72 };
    pushWB();
    pg.links.push(lk); growWorldToFit(pg); saveWB(); render();
    if (typeof aiReady === 'function' && aiReady() && typeof aiRequest === 'function' && !title) {
      aiRequest({ task: 'title', prompt: 'Short title (max 8 words) for this URL, no quotes: ' + safe }).then(res => {
        const t = (res && (res.text || res.title || res) || '').toString().trim().replace(/^["']|["']$/g, '');
        if (t && t.length < 80) { lk.title = t; saveWB(); render(); }
      }).catch(() => {});
    }
    return lk;
  }
  function promptLink() {
    openPrompt('Add a link', 'Paste a URL', '', val => {
      const p = parseUrlTitle(val);
      if (!p) { toastMsg('Enter an http or https URL'); return; }
      addLink(p.href, p.title);
    });
  }
  function openPrompt(title, ph, start, done, type) {
    let wrap = document.getElementById('eoLinkWrap');
    if (wrap) wrap.remove();
    /* v21er: was class "eo-sheet" with no position, so the prompt rendered off-screen behind the board; now a real modal */
    wrap = document.createElement('div'); wrap.id = 'eoLinkWrap'; wrap.className = 'eo-modal eo-prompt';
    wrap.addEventListener('pointerdown', ev => { if (ev.target === wrap) { ev.preventDefault(); wrap.remove(); } });
    wrap.innerHTML = '<div class="eo-sheet-card"><h3>' + esc(title) + '</h3><input type="' + (type || 'url') + '" class="eo-url" placeholder="' + esc(ph) + '" value="' + esc(start || '') + '"><div class="eo-sheet-actions"><button type="button" data-act="ok">Add</button><button type="button" data-act="cancel">Cancel</button></div></div>';
    document.body.appendChild(wrap);
    const inp = wrap.querySelector('.eo-url'); setTimeout(() => inp.focus(), 50);
    wrap.querySelector('[data-act="ok"]').onclick = () => { const v = inp.value; wrap.remove(); done(v); };
    wrap.querySelector('[data-act="cancel"]').onclick = () => wrap.remove();
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); wrap.querySelector('[data-act="ok"]').click(); } });
  }
  async function importPdfToBoard(file, at) {
    if (!file) return null;
    if (typeof loadPdfjs !== 'function' && typeof Assets === 'undefined') { toastMsg('PDF import is not available'); return null; }
    toastMsg('Opening PDF…', 60000);
    try {
      const pdfjs = await loadPdfjs();
      const buf = await file.arrayBuffer();
      const src = await Assets.put(new Blob([buf], { type: 'application/pdf' }));
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
      const total = doc.numPages;
      let warn = '';
      if (total > PDF_CAP) warn = 'This PDF has ' + total + ' pages. At most ' + PDF_CAP + ' pages can be placed on the board. The full file is still saved and can be opened in the viewer.';
      const max = Math.min(total, PDF_CAP);
      const thumbs = [];
      for (let i = 1; i <= max; i++) {
        const page = await doc.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(1.2, 280 / vp1.width);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
        thumbs.push({ i, url: c.toDataURL('image/jpeg', 0.7), w: vp1.width, h: vp1.height });
        if (page.cleanup) page.cleanup();
      }
      const chosen = await pickPdfPages(thumbs, total, warn);
      if (!chosen || !chosen.length) { doc.destroy && doc.destroy(); toastMsg('PDF not placed'); return null; }
      const pg = ensureWB(), n = ideaN();
      pushWB();
      const rec = { id: uid('pdf'), src: src, name: file.name || 'PDF', pages: total };
      pg.pdfs = pg.pdfs || []; pg.pdfs.push(rec);
      pg.images.push({ id: uid('im'), kind: 'pdfsource', hidden: 1, asset: src, src: src, x: 0, y: 0, w: 0, h: 0, pdfId: rec.id });
      const origin = at || freeSpot(300, 300);
      let x = origin[0], y = origin[1];
      for (const num of chosen) {
        const page = await doc.getPage(num);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(2.2, 1400 / vp1.width);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
        const asset = await Assets.put(await canvasBlob(c, 'image/jpeg', 0.86));
        const w = 320, h = Math.round(w * (vp1.height / vp1.width));
        pg.images.push({ id: uid('im'), x: x, y: y, w: w, h: h, src: asset, asset: asset, pdfId: rec.id, page: num });
        x += w + 24;
        if (page.cleanup) page.cleanup();
      }
      doc.destroy && doc.destroy();
      growWorldToFit(pg); saveWB(); render();
      toastMsg('Placed ' + chosen.length + ' PDF page' + (chosen.length > 1 ? 's' : '') + ' — tap to open the full file');
      return rec;
    } catch (err) { console.warn(err); toastMsg('Could not open that PDF'); return null; }
  }
  function pickPdfPages(thumbs, total, warn) {
    return new Promise(resolve => {
      let wrap = document.getElementById('eoPickWrap'); if (wrap) wrap.remove();
      wrap = document.createElement('div'); wrap.id = 'eoPickWrap'; wrap.className = 'eo-modal';
      const allOn = thumbs.length <= 6;
      wrap.innerHTML = '<div class="eo-sheet"><h3>Place PDF pages</h3>' +
        (warn ? '<p class="eo-warn">' + esc(warn) + '</p>' : '') +
        '<p>This file has ' + total + ' page' + (total === 1 ? '' : 's') + '. Choose which to put on the board (max ' + PDF_CAP + ').</p>' +
        '<div class="eo-picker">' + thumbs.map(t => '<label class="' + (allOn ? 'on' : '') + '"><input type="checkbox"' + (allOn ? ' checked' : '') + ' value="' + t.i + '"><img alt="Page ' + t.i + '" src="' + t.url + '"><span>Page ' + t.i + '</span></label>').join('') + '</div>' +
        '<div class="eo-sheet-actions"><button type="button" data-act="ok" class="primary">Place selected</button><button type="button" data-act="cancel">Cancel</button></div></div>';
      document.body.appendChild(wrap);
      wrap.querySelectorAll('label').forEach(lab => lab.addEventListener('click', ev => {
        ev.preventDefault();
        const cb = lab.querySelector('input'); cb.checked = !cb.checked; lab.classList.toggle('on', cb.checked);
      }));
      wrap.querySelector('[data-act="ok"]').onclick = () => {
        const sel = [...wrap.querySelectorAll('input:checked')].map(i => +i.value).filter(Boolean).slice(0, PDF_CAP);
        wrap.remove(); resolve(sel);
      };
      wrap.querySelector('[data-act="cancel"]').onclick = () => { wrap.remove(); resolve(null); };
    });
  }
  async function openPdfViewer(pdfId, startPage) {
    const pg = ideaPg(); const rec = byId(pg.pdfs, pdfId); if (!rec || !rec.src) return toastMsg('Original PDF is missing');
    let wrap = document.getElementById('eoPdfWrap'); if (wrap) wrap.remove();
    wrap = document.createElement('div'); wrap.id = 'eoPdfWrap'; wrap.className = 'eo-modal';
    wrap.innerHTML = '<div class="eo-sheet"><div class="eo-full-tools"><strong>' + esc(rec.name || 'PDF') + '</strong><span class="spacer"></span><button type="button" data-act="close">Close</button></div><div class="eo-pdf-view">Opening…</div></div>';
    document.body.appendChild(wrap);
    wrap.querySelector('[data-act="close"]').onclick = () => wrap.remove();
    try {
      const pdfjs = await loadPdfjs();
      const blob = await Assets.blob(rec.src);
      const data = blob ? await blob.arrayBuffer() : null;
      if (!data) throw new Error('missing pdf');
      const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
      const box = wrap.querySelector('.eo-pdf-view'); box.innerHTML = '';
      const max = Math.min(doc.numPages, 80);
      for (let i = 1; i <= max; i++) {
        const page = await doc.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 860 / vp1.width);
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
        if (i === (startPage || 1)) c.dataset.start = '1';
        box.appendChild(c);
        if (page.cleanup) page.cleanup();
      }
      const start = box.querySelector('[data-start]'); if (start) start.scrollIntoView({ block: 'start' });
      doc.destroy && doc.destroy();
    } catch (err) { console.warn(err); toastMsg('Could not open the PDF viewer'); }
  }
  function openCardFull(id) {
    const t = getItem('card', id); if (!t) return;
    ST.full = id;
    let wrap = document.getElementById('eoCardWrap'); if (wrap) wrap.remove();
    wrap = document.createElement('div'); wrap.id = 'eoCardWrap'; wrap.className = 'eo-modal';
    wrap.innerHTML = '<div class="eo-sheet"><div class="eo-full-tools"><input class="eo-title-in" value="' + esc(t.text || '') + '" placeholder="Card title">' + statusChip(t) +
      '<span class="spacer"></span><button type="button" data-act="close">Done</button></div><div class="eo-full-body"><canvas></canvas></div>' + attachHtml(t) + '</div>';
    document.body.appendChild(wrap);
    (async () => {
      for (const el of wrap.querySelectorAll('.eo-att-img')) {
        const attId = el.dataset.attImg;
        const im = ((t.attach && t.attach.images) || []).find(x => x && x.id === attId);
        if (!im) continue;
        const id = im.asset || im.src; if (!id) continue;
        const img = el.querySelector('img'); if (!img) continue;
        if (/^data:|^blob:|^https?:/.test(id)) { img.src = id; continue; }
        if (!urlCache.has(id)) { try { const b = await Assets.blob(id); if (b) urlCache.set(id, URL.createObjectURL(b)); } catch (e) {} }
        if (urlCache.get(id)) img.src = urlCache.get(id);
      }
    })();
    wrap.querySelector('[data-act="close"]').onclick = () => closeCardFull();
    wrap.querySelector('.eo-title-in').addEventListener('change', ev => { pushWB(); t.text = ev.target.value; t.typed = true; saveWB(); });
    wrap.querySelector('[data-act="status"]').addEventListener('click', ev => { ev.preventDefault(); cycleStatus(t.id); openCardFull(id); });
    const body = wrap.querySelector('.eo-full-body'), cv = body.querySelector('canvas');
    const paint = () => {
      const rw = Math.max(320, body.clientWidth), rh = Math.max(420, body.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(rw * dpr); cv.height = Math.round(rh * dpr);
      cv.style.width = rw + 'px'; cv.style.height = rh + 'px';
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rw, rh);
      if (typeof drawStroke === 'function') (t.strokes || []).forEach(s => drawStroke(ctx, s));
    };
    paint();
    let ink = null;
    const down = ev => {
      if (ev.pointerType === 'touch' && ev.isPrimary === false) return;
      ev.preventDefault();
      const r = cv.getBoundingClientRect();
      const lx = (ev.clientX - r.left) * (cv.clientWidth / r.width);
      const ly = (ev.clientY - r.top) * (cv.clientHeight / r.height);
      ink = { pts: [[+lx.toFixed(2), +ly.toFixed(2), ev.pressure || 0.5]] };
      try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    };
    const move = ev => {
      if (!ink) return;
      const r = cv.getBoundingClientRect();
      const lx = (ev.clientX - r.left) * (cv.clientWidth / r.width);
      const ly = (ev.clientY - r.top) * (cv.clientHeight / r.height);
      ink.pts.push([+lx.toFixed(2), +ly.toFixed(2), ev.pressure || 0.5]);
      autoGrowCard(t, lx, ly);
      const ctx = cv.getContext('2d');
      if (typeof drawStroke === 'function') {
        const s = Object.assign({}, inkStyle(), { points: ink.pts });
        if (typeof bbox === 'function') s.bb = bbox(ink.pts);
        drawStroke(ctx, s);
      }
    };
    const up = ev => {
      if (!ink || ink.pts.length < 2) { ink = null; return; }
      const s = Object.assign({ id: uid('s') }, inkStyle(), { points: ink.pts });
      if (typeof bbox === 'function') s.bb = bbox(ink.pts);
      pushWB(); t.strokes = t.strokes || []; t.strokes.push(s); saveWB(); ink = null; paint();
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }
  function closeCardFull() {
    const wrap = document.getElementById('eoCardWrap'); if (wrap) wrap.remove();
    ST.full = null; render();
  }
  function openCardMenu(id, btn) { return openItemMenu('card', id, btn); }
  function openItemMenu(kind, id, btn) {
    const it = getItem(kind, id); if (!it) return;
    const pg = ideaPg();
    const del = () => {
      pushWB();
      if (kind === 'card') { pg.tasks = pg.tasks.filter(x => x.id !== id); pg.images = (pg.images || []).filter(im => im.cardId !== id); }
      else if (kind === 'img') pg.images = (pg.images || []).filter(im => im.id !== id);
      else pg.links = (pg.links || []).filter(l => l.id !== id);
      ST.sel = null; saveWB(); render();
    };
    if (kind === 'card') {
      const t = it;
      actionSheet((t.text || '').trim() || 'Card', [
        { label: '⤢ Open full size', fn: () => openCardFull(id) },
        { label: '✏️ Title…', fn: () => openPrompt('Card title', 'Title', t.text || '', v => { pushWB(); t.text = v; t.typed = !!v; saveWB(); render(); }, 'text') },
        ...STATUSES.map(s => ({ label: (statusOf(t) === s.id ? '✓ ' : '') + 'Status: ' + s.title, fn: () => { pushWB(); setStatus(t, s.id); saveWB(); render(); } })),
        { label: '🗑 Delete card', danger: true, fn: del }
      ]);
    } else if (kind === 'img') {
      actionSheet(it.pdfId ? 'PDF page' : 'Photo', [
        ...(it.pdfId ? [{ label: '📑 Open the full PDF', fn: () => openPdfViewer(it.pdfId, it.page) }] : []),
        { label: '🗑 Delete', danger: true, fn: del }]);
    } else {
      actionSheet(it.title || 'Link', [
        { label: '↗︎ Open link', fn: () => { const h = safeLink(it.href); if (h) { const a = document.createElement('a'); a.href = h; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click(); } } },
        { label: '✏️ Rename…', fn: () => openPrompt('Link title', 'Title', it.title || '', v => { pushWB(); it.title = v || it.title; saveWB(); render(); }, 'text') },
        { label: '🗑 Delete', danger: true, fn: del }]);
    }
  }

  async function fillAssetImgs() {
    const h = host(); if (!h) return;
    for (const el of h.querySelectorAll('.eo-img')) {
      const im = byId(ideaPg().images, el.dataset.id); if (!im) continue;
      const id = im.asset || im.src; if (!id || /^data:|^blob:|^https?:/.test(id)) continue;
      if (!urlCache.has(id)) {
        try { const b = await Assets.blob(id); if (b) urlCache.set(id, URL.createObjectURL(b)); } catch (e) {}
      }
      const img = el.querySelector('img');
      if (img && urlCache.get(id) && img.src !== urlCache.get(id)) img.src = urlCache.get(id);
    }
    for (const el of h.querySelectorAll('.eo-att-img')) {
      const attId = el.dataset.attImg;
      let im = null;
      for (const t of cardsOf()) {
        const found = ((t.attach && t.attach.images) || []).find(x => x && x.id === attId);
        if (found) { im = found; break; }
      }
      if (!im) continue;
      const id = im.asset || im.src; if (!id) continue;
      if (/^data:|^blob:|^https?:/.test(id)) { const img = el.querySelector('img'); if (img && !img.src) img.src = id; continue; }
      if (!urlCache.has(id)) {
        try { const b = await Assets.blob(id); if (b) urlCache.set(id, URL.createObjectURL(b)); } catch (e) {}
      }
      const img = el.querySelector('img');
      if (img && urlCache.get(id) && img.src !== urlCache.get(id)) img.src = urlCache.get(id);
    }
  }
  if (typeof renderBoard === 'function') {
    const _rb = renderBoard;
    renderBoard = function (pi) {
      if (pi === IPI && isOpen()) { ensureWB(); render(); return; }
      return _rb(pi);
    };
  }
  if (typeof qbOpen === 'function') {
    const _qo = qbOpen;
    qbOpen = function (on, opts) {
      opts = opts || {};
      if (on && !localStorage.getItem('v21eoW')) {
        localStorage.setItem('ibW', '1');
        localStorage.setItem('v21eoW', '1');
      }
      const r = _qo.apply(this, arguments);
      if (on && (opts.mode === 'ideas' || (!opts.mode && QB.mode === 'ideas') || QB.mode === 'ideas')) {
        setTimeout(() => { if (isOpen()) render(); }, 0);
        slimIdeasChrome();
      }
      if (!on) { ST.sel = null; cancelLasso(); closeInsertMenu(); }
      syncMount();
      return r;
    };
  }
  if (typeof qbRender === 'function') {
    const _qr = qbRender;
    qbRender = function () {
      const r = _qr.apply(this, arguments);
      if (isOpen()) render(); else syncMount();
      slimIdeasChrome();
      return r;
    };
  }
  if (typeof insertPhotoFile === 'function') {
    const _ip = insertPhotoFile;
    insertPhotoFile = async function (file) {
      if (isOpen()) return addPhotoFile(file);
      return _ip.apply(this, arguments);
    };
  }
  if (typeof importPdf === 'function') {
    const _imp = importPdf;
    importPdf = async function (file, nbId) {
      if (isOpen() || window.__eoPdfForBoard) return importPdfToBoard(file);
      return _imp.apply(this, arguments);
    };
  }
  if (typeof ensureQuoteNote === 'function') {
    const _eq = ensureQuoteNote;
    ensureQuoteNote = function () {
      const n = typeof quoteNote === 'function' ? quoteNote() : null;
      if (n) return n;
      return null;
    };
    ensureQuoteNote._orig = _eq;
  }
  if (typeof ensureInboxNote === 'function') {
    const _ei = ensureInboxNote;
    ensureInboxNote = function () {
      const n = typeof inboxNote === 'function' ? inboxNote() : null;
      if (n) return n;
      return null;
    };
    ensureInboxNote._orig = _ei;
  }
  if (typeof moreItems === 'function') {
    const _mi = moreItems;
    moreItems = function () {
      const secs = _mi.apply(this, arguments);
      return (secs || []).map(sec => {
        if (!sec || !sec.rows) return sec;
        return Object.assign({}, sec, { rows: sec.rows.filter(r => !r || (r.l !== 'Quote Board' && r.l !== 'Inbox' && r.l !== 'Calculator Board')) });
      });
    };
  }

  function slimIdeasChrome() {
    const btn = document.getElementById('quotesBtn');
    if (btn) { btn.title = 'Idea Board'; btn.setAttribute('aria-label', 'Idea Board'); }
    const name = document.getElementById('dbName');
    if (name && QB && QB.mode === 'ideas') name.innerHTML = '<i>💡</i>Idea Board';
    ['qbTab', 'qbTabBadge', 'ibRow', 'qbRow', 'inRow'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
    /* v21eq: no dead ▾ caret, and labels that say Idea Board (not Quote Board) */
    document.querySelectorAll('#dbSwitch .db-car').forEach(c => c.remove());
    const sw = document.getElementById('dbSwitch'); if (sw) { sw.removeAttribute('aria-haspopup'); sw.removeAttribute('aria-expanded'); sw.setAttribute('aria-label', 'Idea Board'); sw.title = 'Idea Board'; }
    const L = { qbUndo: 'Undo on the Idea Board', qbRedo: 'Redo on the Idea Board', qbLock: 'Lock the Idea Board', qbMore: 'Idea Board options', qbClose: 'Close the Idea Board', qbAdd: 'Add a card' };
    for (const id in L) { const el = document.getElementById(id); if (el) { el.setAttribute('aria-label', L[id]); el.title = L[id]; } }
    const d = document.getElementById('qbDrawer'); if (d) d.setAttribute('aria-label', 'Idea Board');
    const tab = document.getElementById('qbTab'); if (tab) { tab.setAttribute('aria-label', 'Open the Idea Board'); tab.title = 'Idea Board'; }
  }
  /* Idea Board ⋯: width, old-board import, Settings (no "Add a column" / "Compact cards" leftovers) */
  (function () {
    const b = document.getElementById('qbMore'); if (!b) return;
    const o = b.onclick;
    b.onclick = function (e) {
      if (typeof QB === 'undefined' || QB.mode !== 'ideas') return o && o.call(this, e);
      const legacy = typeof legacyBoardPages === 'function' ? legacyBoardPages().length : 0;
      actionSheet('Idea Board', [
        ...(typeof widthRow === 'function' ? [widthRow()] : []),
        ...(legacy ? [{ label: '📥 Bring in old Project Board pages (' + legacy + ')…', fn: () => importLegacyBoards() }] : []),
        { label: '⚙︎ Settings…', fn: () => openSettings('quotes') }]);
    };
  })();
  document.addEventListener('paste', onPaste);
  /* v21er: Escape closes the top-most board prompt / sheet only (capture, before quotes.js closes the drawer);
     Backspace / Delete removes a board lasso selection. */
  const topSheet = () => document.getElementById('eoLinkWrap') || document.getElementById('eoPickWrap') || document.getElementById('eoPdfWrap') || document.getElementById('eoCardWrap') ||
    [...document.querySelectorAll('.eo-sheet')].filter(x => x.isConnected && x.offsetParent !== null).pop() || null;
  addEventListener('keydown', ev => {
    if (!isOpen()) return;
    if (ev.key === 'Escape') {
      const sh = topSheet();
      if (sh) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        const cancel = sh.querySelector('[data-act="cancel"], [data-act="close"]');
        if (sh.id === 'eoCardWrap') closeCardFull(); else if (cancel) cancel.click(); else sh.remove();
        return;
      }
      if (ST.selLasso || document.getElementById('eqBoardIns') || ST.sel) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        cancelLasso(); closeInsertMenu(); if (ST.sel) { ST.sel = null; render(); }
      }
      return;
    }
    if ((ev.key === 'Backspace' || ev.key === 'Delete') && ST.selLasso && !(ev.target && ev.target.matches && ev.target.matches('input, textarea, [contenteditable], select'))) {
      ev.preventDefault(); ev.stopImmediatePropagation(); deleteSel();
    }
  }, true);
  const drawerEl = document.getElementById('qbDrawer');
  if (drawerEl && window.MutationObserver) new MutationObserver(() => syncMount()).observe(drawerEl, { attributes: true, attributeFilter: ['class', 'data-board', 'hidden'] });

  function boot() {
    slimIdeasChrome();
    if (isOpen()) { ensureWB(); render(); }
  }
  if (window.__ready) boot();
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 50));
  const _readyWatch = setInterval(() => { if (window.__ready) { clearInterval(_readyWatch); boot(); } }, 200);
  setTimeout(() => clearInterval(_readyWatch), 15000);

  window.V21eo = {
    version: 'v21eo', ensureWB, migrate: ensureWB, render, VIEW, ST,
    cardFromInk, makeCardFromSel, addBlankCard, addLink, addPhotoFile, importPdfToBoard,
    openPdfViewer, openCardFull, closeCardFull, setStatus, statusOf, safeLink, parseUrlTitle,
    cardsOf, ideaPg, screenToWorld, autoGrowCard, PDF_CAP, growWorldToFit, cancelLasso,
    HANDLE: 44, MIN_W, MIN_H, HOLD_MS, TITLE_H, deleteSel, finishLasso, openInsertMenu, closeInsertMenu, mountToolbar, addTextCard, openItemMenu,
    rebuilt: 'v21eq', freeSpot, INK, CANVAS_CAP, placeInk, drawInkLayer, isOpen, topSheet, applyView
  };
})();
