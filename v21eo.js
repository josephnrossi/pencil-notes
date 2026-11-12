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
  let saveWB = () => { const n = ideaN(); if (n && typeof saveNote === 'function') saveNote(n, true); };
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
    if ((pg.board.wbVersion || 1) < WB_VERSION) migrateV2(pg, n);   // v21es: title strip, items inside cards, groups
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
    for (const t of (pg.tasks || []).filter(x => x && x.kind === 'card' && !x.parent)) bump(t.bx, t.by, t.bw, t.bh);
    for (const im of pg.images || []) if (!im.parent) bump(im.x, im.y, im.w, im.h);
    for (const l of pg.links || []) if (!l.parent) bump(l.x, l.y, l.w || 260, l.h || 72);
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
    /* v21es: every card has a title strip (TITLE_H2) to write its title in; lassoed photos / links become items INSIDE the card */
    const pad = 16, hasAtt = !!(attImgs.length || attLinks.length), th = TITLE_H2;
    const ox = (strokes.length ? Math.min(sbb[0], bb0) : bb0) - pad, oy = (strokes.length ? Math.min(sbb[1], bb1) : bb1) - pad;
    const bw = Math.max(MIN_W, (bb2 - ox) + pad + 2);
    const bhBody = Math.max(80, (bb3 - oy) + pad);
    const body = copyStrokesLocal(strokes, ox, oy);
    const t = {
      id: uid('t'), kind: 'card', col: col.id, ord: -1, text: src.title || '', typed: !!src.title,
      tstrokes: [], titleInk: [], th, strokes: body, unit: 1, bw, bh: th + bhBody + 2, bx: 80, by: 80,
      h: bhBody, done: typeof isDoneCol === 'function' && isDoneCol(dpg, col.id),
      due: null, repeat: '', notified: false, createdAt: Date.now(),
      attach: { images: [], links: [] }
    };
    if (t.done) t.doneAt = Date.now();
    if (dstPi === IPI || (dstNote && dstNote.id === 'ideaboard')) {
      ensureWB(dstNote);
      /* the body's local origin is (left - pad, top - pad): put the card there so the ink does not jump */
      t.bx = Math.max(0, ox - 1);
      t.by = Math.max(0, oy - 1 - th);
      growWorldToFit(dpg);
    }
    const imgIds = new Set(attImgs.map(i => i.id)), linkIds = new Set(attLinks.map(i => i.id));
    if (move && spg) {
      spg.strokes = (spg.strokes || []).filter(s => !ids.includes(s.id));
    }
    for (const im of attImgs) {
      const it = spg === dpg ? im : Object.assign({}, im, { id: uid('im') });
      it.parent = t.id; it.x = Math.round((im.x || 0) - ox); it.y = Math.round((im.y || 0) - oy);
      if (spg !== dpg) dpg.images.push(it);
    }
    for (const lk of attLinks) {
      const it = spg === dpg ? lk : Object.assign({}, lk, { id: uid('lk') });
      it.parent = t.id; it.x = Math.round((lk.x || 0) - ox); it.y = Math.round((lk.y || 0) - oy);
      if (spg !== dpg) { dpg.links = dpg.links || []; dpg.links.push(it); }
    }
    if (move && spg && spg !== dpg) {
      spg.images = (spg.images || []).filter(im => !imgIds.has(im.id));
      spg.links = (spg.links || []).filter(lk => !linkIds.has(lk.id));
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


  /* ===================== v21es: data model v2 — handwritten title strip, items inside cards, cards inside cards ===================== */
  /* Card t (pg.tasks kind 'card'): t.th = title strip height, t.titleInk = Pencil strokes in title-local units, t.titleText = optional
     recognised title (Ask Grok), t.text = typed title (kept), t.parent = id of the master card it sits in (none = on the board),
     t.cord = order inside its master. Loose items inside a card: pg.images[] / pg.links[] with .parent = card id and x/y LOCAL to that
     card's body. Ink inside a card: t.strokes (body-local, unit 1). Everything stays in the same arrays, so lock, backup and asset
     lookups see it. pg.board.wbVersion = 2 once migrated. */
  const TITLE_H2 = 44, TH_MAX = 140, TILE_W = 84, TILE_H = 64, TILE_GAP = 8, FOLD_PAD = 8, FOLD_HEAD = 22, MAX_DEPTH = 2, WB_VERSION = 2;
  const thOf = t => (t && t.th) || TITLE_H2;
  const pgCards = pg => (pg && pg.tasks || []).filter(t => t && t.kind === 'card');
  const kidsOf = (pg, id) => pgCards(pg).filter(t => t.parent === id).sort((a, b) => (a.cord || 0) - (b.cord || 0));
  const loose = (pg, id) => ({ images: (pg.images || []).filter(im => im && im.parent === id && !im.hidden && im.kind !== 'pdfsource' && im.kind !== 'cardattach'), links: (pg.links || []).filter(l => l && l.parent === id) });
  const isTopImg = im => im && !im.parent && im.kind !== 'pdfsource' && im.kind !== 'cardattach' && !im.hidden;
  function foldCols(t) { return Math.max(1, Math.floor(((t.bw || CARD_W) - 2 - 2 * FOLD_PAD + TILE_GAP) / (TILE_W + TILE_GAP))); }
  function folderH(t, pg) {
    const n = kidsOf(pg || ideaPg(), t.id).length; if (!n) return 0;
    return FOLD_HEAD + Math.ceil(n / foldCols(t)) * (TILE_H + TILE_GAP) - TILE_GAP + FOLD_PAD;
  }
  function bodyH(t, pg) { return Math.max(40, (t.bh || defaultCardH(t)) - 2 - thOf(t) - folderH(t, pg)); }
  /* keep the body the same size when the folder strip of a master grows / shrinks */
  function fitFolder(t, pg) { if (!t) return; const f = folderH(t, pg), old = t.fh || 0; if (f !== old) { t.bh = (t.bh || defaultCardH(t)) + (f - old); t.fh = f; } }
  function parentChain(pg, t) { const out = []; let c = t, guard = 0; while (c && c.parent && guard++ < 20) { c = byId(pg.tasks, c.parent); if (c) out.push(c); } return out; }
  const depthOf = (pg, t) => parentChain(pg, t).length;
  function subH(pg, t, guard) { guard = (guard || 0) + 1; if (guard > 20) return 0; const k = kidsOf(pg, t.id); return k.length ? 1 + Math.max(...k.map(c => subH(pg, c, guard))) : 0; }
  function isInside(pg, a, b) { return parentChain(pg, a).some(c => c.id === b.id); }     // a sits (somewhere) inside b
  function scaleStroke(s, k, dx, dy) {
    const pts = (s.points || []).map(p => [+(p[0] * k + (dx || 0)).toFixed(1), +(p[1] * k + (dy || 0)).toFixed(1), p[2]]);
    const ns = Object.assign({}, s, { points: pts, width: +((s.width || 2.2) * (k === 1 ? 1 : k)).toFixed(2) });
    if (typeof bbox === 'function' && pts.length) ns.bb = bbox(pts);
    return ns;
  }
  function moveStroke(s, dx, dy) { for (const p of s.points || []) { p[0] = +(p[0] + dx).toFixed(1); p[1] = +(p[1] + dy).toFixed(1); } if (typeof bbox === 'function' && (s.points || []).length) s.bb = bbox(s.points); }
  function migrateV2(pg, n) {
    const B = pg.board;
    const cards = pgCards(pg);
    for (const t of cards) {
      /* 0. pre-whiteboard cards kept ink in 300-unit "INK_W" space scaled to the card width: bake that scale in (no visual change) */
      if (t.unit !== 1) {
        const inkW = typeof INK_W === 'number' ? INK_W : 300, sc = Math.max(8, (t.bw || CARD_W) - 2) / inkW;
        t.strokes = (t.strokes || []).map(s => scaleStroke(s, sc));
        if ((t.tstrokes || []).length && !(t.titleInk || []).length) t.titleInk = t.tstrokes.map(s => scaleStroke(s, sc * 0.7));   // legacy handwritten title
        t.unit = 1;
      }
      /* 1. every card gets the title strip; the card grows upward so its body ink stays exactly where it was on the board */
      if (!t.th) {
        const oldTh = (t.text || '').trim() ? TITLE_H : 0, oldBh = t.bh || defaultCardH(t);
        const hadAtt = (() => { const a = attachOf(t); return ((a.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach').length || (a.links || []).length) ? ATTACH_H : 0; })();
        const oldBody = Math.max(40, oldBh - oldTh - hadAtt);
        const d = TITLE_H2 - oldTh;
        t.th = TITLE_H2; t.titleInk = t.titleInk || [];
        t.by = (t.by || 0) - d;                 // may go negative: step 3 shifts the whole board, so nothing moves relative to anything else
        t.bh = TITLE_H2 + oldBody + 2;
        /* 2. old attachment strip → real items inside the card body (can be dragged out) */
        const a = attachOf(t), ims = (a.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach'), lks = a.links || [];
        if (ims.length || lks.length) {
          let x = 8, y = oldBody + 8, rowH = 0; const bw = Math.max(t.bw || CARD_W, MIN_W) - 2;
          const place = (w, h) => { if (x + w > bw - 8 && x > 8) { x = 8; y += rowH + 8; rowH = 0; } const at = [x, y]; x += w + 8; rowH = Math.max(rowH, h); return at; };
          for (const im of ims) {
            const [px, py] = place(120, 90);
            pg.images.push({ id: uid('im'), parent: t.id, x: px, y: py, w: 120, h: 90, asset: im.asset || im.src, src: im.asset || im.src, pdfId: im.pdfId, page: im.page, fromAttach: im.id || 1 });
          }
          for (const lk of lks) { const [px, py] = place(200, 56); pg.links.push({ id: uid('lk'), parent: t.id, href: lk.href, title: lk.title, x: px, y: py, w: 200, h: 56, fromAttach: lk.id || 1 }); }
          t.bh = TITLE_H2 + Math.max(oldBody, y + rowH + 8) + 2;
          t.attachV1 = t.attach || null;        // the original attachment list is kept (not deleted), just no longer drawn
          t.attach = { images: [], links: [] };
        }
      }
      t.titleInk = t.titleInk || [];
    }
    /* 3. nothing may sit left of / above the board origin (ink there was saved but could never be drawn) */
    let mx = Infinity, my = Infinity;
    for (const s of pg.strokes || []) { const b = s.bb || ((s.points || []).length ? bbox(s.points) : null); if (b) { mx = Math.min(mx, b[0]); my = Math.min(my, b[1]); } }
    for (const t of cards) if (!t.parent && t.bx != null) { mx = Math.min(mx, t.bx); my = Math.min(my, t.by); }
    for (const im of pg.images || []) if (isTopImg(im)) { mx = Math.min(mx, im.x || 0); my = Math.min(my, im.y || 0); }
    for (const l of pg.links || []) if (!l.parent) { mx = Math.min(mx, l.x || 0); my = Math.min(my, l.y || 0); }
    const dx = isFinite(mx) && mx < 0 ? Math.ceil(20 - mx) : 0, dy = isFinite(my) && my < 0 ? Math.ceil(20 - my) : 0;
    if (dx || dy) {
      for (const s of pg.strokes || []) moveStroke(s, dx, dy);
      for (const t of cards) if (!t.parent && t.bx != null) { t.bx += dx; t.by += dy; }
      for (const im of pg.images || []) if (isTopImg(im)) { im.x = (im.x || 0) + dx; im.y = (im.y || 0) + dy; }
      for (const l of pg.links || []) if (!l.parent) { l.x = (l.x || 0) + dx; l.y = (l.y || 0) + dy; }
      B.wbShifted = [dx, dy];
    }
    B.wbVersion = WB_VERSION;
    growWorldToFit(pg);
    if (n && typeof saveNote === 'function') saveNote(n, true);
  }


  /* ===================== v21eq: board view (normal toolbar, slim cards, layers) ===================== */
  function viewEl() { return host() && host().querySelector('.eo-view'); }
  function worldEl() { return host() && host().querySelector('.eo-world'); }
  function screenToWorld(cx, cy) {
    const v = viewEl(); if (!v) return [0, 0];
    const r = v.getBoundingClientRect();
    return [(cx - r.left - VIEW.x) / VIEW.s, (cy - r.top - VIEW.y) / VIEW.s];
  }
  function worldToScreen(wx, wy) {
    const v = viewEl(); if (!v) return [0, 0];
    const r = v.getBoundingClientRect();
    return [r.left + VIEW.x + wx * VIEW.s, r.top + VIEW.y + wy * VIEW.s];
  }
  /* v21eq: new items land in the first empty spot of the visible board instead of on top of what is there */
  function freeSpot(w, h) {
    const v = viewEl(); const pg = ideaPg();
    const r = v ? v.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 900 };
    const [x0, y0] = v ? screenToWorld(r.left + 24, r.top + 24) : [40, 40];
    const vw = Math.max(w + 40, r.width / VIEW.s - 48), vh = Math.max(h + 40, r.height / VIEW.s - 48);
    const boxes = [];
    if (pg) {
      for (const t of (pg.tasks || [])) if (t && t.kind === 'card' && t.bx != null && !t.parent) boxes.push([t.bx, t.by, t.bx + (t.bw || CARD_W), t.by + (t.bh || 200)]);
      for (const i of (pg.images || [])) if (isTopImg(i) && i.w) boxes.push([i.x, i.y, i.x + i.w, i.y + i.h]);
      for (const l of (pg.links || [])) if (l && !l.parent) boxes.push([l.x, l.y, l.x + (l.w || 260), l.y + (l.h || 72)]);
      for (const s of (pg.strokes || [])) if (s && s.bb) boxes.push([s.bb[0] - 6, s.bb[1] - 6, s.bb[2] + 6, s.bb[3] + 6]);
    }
    const hit = (x, y) => boxes.some(b => x < b[2] + 16 && x + w + 16 > b[0] && y < b[3] + 16 && y + h + 16 > b[1]);
    for (let y = Math.max(20, y0); y + h <= y0 + vh; y += 24)
      for (let x = Math.max(20, x0); x + w <= x0 + vw; x += 24) if (!hit(x, y)) return [x, y];
    const n = boxes.length % 8;
    return [Math.max(20, x0 + 36 + n * 28), Math.max(20, y0 + 36 + n * 28)];
  }
  /* v21es: the view can't be dragged so far that the board origin (or the far edge) comes loose — ink is only stored and drawn
     inside the board, so blank space outside it used to swallow strokes */
  const PAN_EDGE = 48, PAN_FAR = 200;
  function clampView() {
    const v = viewEl(), pg = ideaPg(); if (!v || !pg) return;
    const vw = v.clientWidth || 800, vh = v.clientHeight || 900, ww = pg.board.wb.w * VIEW.s, hh = pg.board.wb.h * VIEW.s;
    VIEW.x = Math.min(PAN_EDGE, Math.max(Math.min(PAN_EDGE, vw - ww - PAN_FAR), VIEW.x));
    VIEW.y = Math.min(PAN_EDGE, Math.max(Math.min(PAN_EDGE, vh - hh - PAN_FAR), VIEW.y));
  }
  function applyView() {
    const w = worldEl(); if (!w) return;
    clampView();
    w.style.transform = 'translate(' + VIEW.x + 'px, ' + VIEW.y + 'px) scale(' + VIEW.s + ')';
    checkInkRegion();
  }
  /* v21er: viewport-sized ink canvases. INK = the board rectangle (world units) the two canvases cover and
     k = backing pixels per world unit. w*k × h*k never exceeds CANVAS_CAP.
     v21es: the box may reach INK_OUT world units past the board edges (left/top margin strip, far edge before it grows). */
  const CANVAS_CAP = 16000000, INK_MARGIN = 0.25, INK_OUT = 64;
  const INK = { x0: 0, y0: 0, w: 0, h: 0, k: 1, s: 1 };
  let inkRaf = 0, inkZoomT = 0;
  function wantRegion() {
    const pg = ideaPg(), v = viewEl(); if (!pg || !v) return null;
    const ww = pg.board.wb.w + INK_OUT, hh = pg.board.wb.h + INK_OUT;
    const vw = Math.max(1, v.clientWidth || 800) / VIEW.s, vh = Math.max(1, v.clientHeight || 900) / VIEW.s;
    const vx = -VIEW.x / VIEW.s, vy = -VIEW.y / VIEW.s;
    let x0 = Math.max(-INK_OUT, Math.floor(vx - vw * INK_MARGIN)), y0 = Math.max(-INK_OUT, Math.floor(vy - vh * INK_MARGIN));
    let x1 = Math.min(ww, Math.ceil(vx + vw * (1 + INK_MARGIN))), y1 = Math.min(hh, Math.ceil(vy + vh * (1 + INK_MARGIN)));
    if (x1 - x0 < 8) { x0 = Math.max(-INK_OUT, Math.min(x0, ww - 8)); x1 = Math.min(ww, x0 + 8); }
    if (y1 - y0 < 8) { y0 = Math.max(-INK_OUT, Math.min(y0, hh - 8)); y1 = Math.min(hh, y0 + 8); }
    const w = Math.max(8, x1 - x0), h = Math.max(8, y1 - y0);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let k = dpr * VIEW.s;
    if (w * k * h * k > CANVAS_CAP) k = Math.sqrt(CANVAS_CAP / (w * h)) * 0.999;
    return { x0, y0, w, h, k, s: VIEW.s, vx, vy, vw, vh, ww, hh };
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
  /* after a pan / zoom: re-place only when the visible board leaves the covered box or the zoom changed a lot.
     v21es: a re-place that had to wait for a stroke is remembered and done when the stroke ends (it used to be dropped). */
  let inkStale = false;
  function checkInkRegion() {
    if (!INK.w || !host() || !host().querySelector('canvas.eo-ink')) return;
    const R = wantRegion(); if (!R) return;
    const out = R.vx < INK.x0 - 1 && INK.x0 > -INK_OUT || R.vy < INK.y0 - 1 && INK.y0 > -INK_OUT ||
      R.vx + R.vw > INK.x0 + INK.w + 1 && INK.x0 + INK.w < R.ww || R.vy + R.vh > INK.y0 + INK.h + 1 && INK.y0 + INK.h < R.hh;
    const zoomed = Math.abs(R.k - INK.k) / INK.k > 0.2;
    const redo = () => { inkRaf = 0; if (ST.g && /^(ink|cink|tink|lasso)$/.test(ST.g.typ)) { inkStale = true; return; } inkStale = false; placeInk(); drawInkLayer(); if (ST.selLasso && ST.selLasso.poly) drawLassoLive(ST.selLasso.poly, true); };
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
    const looseIm = (pg && pg.images || []).some(isTopImg);
    const empty = !cardsOf().length && !(pg && pg.strokes && pg.strokes.length) && !looseIm && !(pg && pg.links && pg.links.length) && !(pg && (pg.pdfs || []).length);
    return empty ? '<div class="eo-empty"><div class="eo-empty-card"><h3>Start the whiteboard</h3><p>Write anywhere with Apple Pencil. Use ＋ Insert for photos, links, PDFs and cards. Lasso ink to make a card. Hold a finger on anything to drag it into a card.</p></div></div>' : '';
  }
  const isSel = (k, id) => !!(ST.sel && ST.sel.kind === k && ST.sel.id === id);
  const titleH = t => thOf(t);
  const hasAttach = t => { const a = attachOf(t); return !!(((a.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach').length) || (a.links || []).length); };
  function statusChip(t) {
    const st = statusOf(t);
    return '<button type="button" class="eo-chip ' + st + '" data-act="status" data-id="' + t.id + '">' + statusLabel(t) + '</button>';
  }
  function statusLabel(t) { return (STATUSES.find(s => s.id === statusOf(t)) || STATUSES[0]).title; }
  function selTools(kind, id) {
    return '<div class="eo-sel-tools">' +
      (kind === 'card' ? '<button type="button" class="eo-icon" data-act="expand" data-id="' + id + '" aria-label="Open card" title="Open">⤢</button>' : '') +
      '<button type="button" class="eo-icon" data-act="menu" data-kind="' + kind + '" data-id="' + id + '" aria-label="' + (kind === 'card' ? 'Card options' : kind === 'img' ? 'Photo options' : 'Link options') + '">⋯</button></div>' +
      '<div class="eo-resize" data-act="resize" data-id="' + id + '" aria-label="Resize"></div>';
  }
  /* v21es card: [title strip (Pencil writes the title)] [body: loose items + ink] [folder strip: child cards as mini tiles] */
  function cardHtml(t, o) {
    o = o || {};
    const pg = ideaPg(), sel = !o.sheet && isSel('card', t.id), typed = (t.text || '').trim(), inked = (t.titleInk || []).length;
    const kids = kidsOf(pg, t.id), L = loose(pg, t.id), th = thOf(t), fh = o.noFolder ? 0 : folderH(t, pg), bh = bodyH(t, pg);
    const H = o.noFolder ? th + bh + 2 : (t.bh || defaultCardH(t));
    const pos = o.sheet ? 'width:' + (t.bw || CARD_W) + 'px;height:' + H + 'px' : 'left:' + t.bx + 'px;top:' + t.by + 'px;width:' + (t.bw || CARD_W) + 'px;height:' + H + 'px';
    const titleTxt = esc(typed || t.titleText || '');
    return '<div class="eo-card slim es-card' + (kids.length ? ' es-master' : '') + (t.color ? ' c-' + t.color : '') + (t.done ? ' done' : '') + (sel ? ' selected' : '') + (o.sheet ? ' es-in-sheet' : '') + '" data-kind="card" data-id="' + t.id + '"' + (t.parent ? ' data-parent="' + t.parent + '"' : '') + ' style="' + pos + '" aria-label="' + (titleTxt || 'Card') + (kids.length ? ' — group of ' + kids.length + ' cards' : '') + '">' +
      '<div class="es-title" data-title="' + t.id + '" style="height:' + th + 'px"><canvas class="es-title-ink"></canvas>' +
      (typed ? '<div class="eo-card-title' + (inked ? ' es-under' : '') + '">' + esc(typed) + '</div>' : '') +   // a typed title stays visible; Pencil can write over it
      (!typed && !inked ? '<span class="es-title-ph">Title</span>' : '') + '</div>' +
      '<div class="eo-card-body" style="height:' + bh + 'px">' + L.images.map(im => imgHtml(im, t.id)).join('') + L.links.map(lk => linkHtml(lk, t.id)).join('') + '<canvas class="eo-card-ink"></canvas></div>' +
      (fh ? '<div class="es-folder" style="height:' + fh + 'px"><div class="es-folder-h">▦ ' + kids.length + ' card' + (kids.length === 1 ? '' : 's') + ' · tap to open</div><div class="es-tiles" style="grid-template-columns:repeat(' + foldCols(t) + ',' + TILE_W + 'px)">' +
        kids.map(k => '<div class="es-tile" data-tile="' + k.id + '" data-in="' + t.id + '" aria-label="' + esc((k.text || k.titleText || 'Card').trim() || 'Card') + '"><canvas></canvas>' + (kidsOf(pg, k.id).length ? '<i class="es-tile-n">' + kidsOf(pg, k.id).length + '</i>' : '') + '</div>').join('') + '</div></div>' : '') +
      (sel ? selTools('card', t.id) : '') + '</div>';
  }
  function attachOf(t) {
    return { images: (t && t.attach && t.attach.images) || (t && t.images) || [], links: (t && t.attach && t.attach.links) || (t && t.links) || [] };
  }
  function imgHtml(im, parent) {
    let src = typeof assetUrl === 'function' ? (assetUrl(im.asset || im.src) || '') : (im.src || '');
    if (!/^(data:|blob:|https?:|\.?\/)/.test(src)) src = urlCache.get(im.asset || im.src) || '';   /* v21eq: a bare asset id is not a URL (avoids a 404); fillAssetImgs fills it */
    const sel = isSel('img', im.id);
    return '<div class="eo-img' + (im.pdfId ? ' pdf' : '') + (sel ? ' selected' : '') + (parent ? ' es-child' : '') + '" data-kind="img" data-id="' + im.id + '"' + (parent ? ' data-parent="' + parent + '"' : '') + ' style="left:' + (im.x || 0) + 'px;top:' + (im.y || 0) + 'px;width:' + (im.w || 280) + 'px;height:' + (im.h || 200) + 'px">' +
      (src ? '<img alt="" src="' + src + '">' : '<img alt="">') +
      (im.pdfId ? '<span class="eo-pdf-badge">PDF p.' + (im.page || 1) + '</span>' : '') + (sel ? selTools('img', im.id) : '') + '</div>';
  }
  function linkHtml(lk, parent) {
    const href = safeLink(lk.href);
    const hostn = href ? hostnameOf(href) : '';
    const fav = href ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostn) + '&sz=64' : '';
    const sel = isSel('link', lk.id);
    return '<div class="eo-link' + (sel ? ' selected' : '') + (parent ? ' es-child' : '') + '" data-kind="link" data-id="' + lk.id + '"' + (parent ? ' data-parent="' + parent + '"' : '') + ' style="left:' + (lk.x || 0) + 'px;top:' + (lk.y || 0) + 'px;width:' + (lk.w || 260) + 'px;height:' + (lk.h || 72) + 'px">' +
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


  /* v21es: a render asked for while a stroke / drag / resize is in progress waits until it ends — rebuilding the board under the
     Pencil used to orphan the stroke (its element vanished, the stroke never finished and was lost) */
  const BUSY = /^(ink|cink|tink|lasso|move|drag|resize|erase)$/;
  function render() {
    if (ST.g && BUSY.test(ST.g.typ)) { ST.renderPending = true; return; }
    ST.renderPending = false;
    syncMount();
    if (!isOpen()) return;
    const h = host(); if (!h) return;
    const pg = ensureWB(); if (!pg) return;
    growWorldToFit(pg);
    const images = (pg.images || []).filter(isTopImg).map(im => imgHtml(im)).join('');
    const links = (pg.links || []).filter(l => l && !l.parent).map(l => linkHtml(l)).join('');
    const cards = cardsOf().filter(t => !t.parent).map(t => cardHtml(t)).join('');
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
    if (ST.full && document.getElementById('eoCardWrap')) renderSheet();
    if (typeof storeView === 'function') try { storeView(); } catch (e) {}
  }
  function flushRender() { if (ST.renderPending) render(); }
  function drawInkLayer() {
    const cv = host() && host().querySelector('canvas.eo-ink');
    const pg = ideaPg(); if (!cv || !pg) return;
    if (!INK.w) placeInk();
    const ctx = clearCanvas(cv);
    if (typeof drawStroke !== 'function') return;
    /* only strokes that touch the covered box */
    const X0 = INK.x0 - 40, Y0 = INK.y0 - 40, X1 = INK.x0 + INK.w + 40, Y1 = INK.y0 + INK.h + 40, hide = ST.hide;
    const st = (pg.strokes || []).filter(s => { if (hide && hide.has(s.id)) return false; const b = s.bb || (s.points && s.points.length && typeof bbox === 'function' ? (s.bb = bbox(s.points)) : null); return !b || !(b[2] < X0 || b[0] > X1 || b[3] < Y0 || b[1] > Y1); });
    st.forEach(s => { if (s.tool === 'highlighter') drawStroke(ctx, s); });
    st.forEach(s => { if (s.tool !== 'highlighter') drawStroke(ctx, s); });
  }
  function cardScale(t, bodyW) { const inkW = typeof INK_W === 'number' ? INK_W : 300; return t.unit === 1 ? 1 : bodyW / inkW; }
  function paintInk(cv, w, h, strokes, k, hide, oy) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    if (oy != null) cv.style.top = -oy + 'px';        // v21es: card canvases cover the whole card, so nothing is cut at the title/body line
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.save(); if (oy) ctx.translate(0, oy); if (k && k !== 1) ctx.scale(k, k);
    if (typeof drawStroke === 'function') {
      const list = (strokes || []).filter(s => !(hide && hide.has(s.id)));
      list.forEach(s => { if (s.tool === 'highlighter') drawStroke(ctx, s); });
      list.forEach(s => { if (s.tool !== 'highlighter') drawStroke(ctx, s); });
    }
    ctx.restore();
    return ctx;
  }
  /* a child card as a mini tile: its title ink over its body ink, scaled to fit */
  function paintTile(cv, t, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const th = thOf(t), cw = Math.max(40, (t.bw || CARD_W) - 2), ch = Math.max(40, th + bodyH(t));
    const k = Math.min(w / cw, h / ch);
    ctx.save(); ctx.scale(k, k);
    if (typeof drawStroke === 'function') {
      (t.titleInk || []).forEach(s => drawStroke(ctx, s));
      ctx.save(); ctx.translate(0, th); (t.strokes || []).forEach(s => drawStroke(ctx, s)); ctx.restore();
    }
    ctx.restore();
    if (!(t.titleInk || []).length && (t.text || t.titleText)) { ctx.fillStyle = getComputedStyle(cv).color || '#333'; ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.fillText(String(t.text || t.titleText).slice(0, 18), 4, 12); }
  }
  function drawCardEl(el, hideCard) {
    const pg = ideaPg(); if (!pg || !el) return;
    const t = byId(pg.tasks, el.dataset.id); if (!t) return;
    const body = el.querySelector(':scope > .eo-card-body'), cv = body && body.querySelector(':scope > canvas.eo-card-ink');
    const G = cardInkBox(el, t);
    if (cv) paintInk(cv, G.w, G.h, t.strokes, cardScale(t, Math.max(8, body.clientWidth)), hideCard, G.th);
    const ti = el.querySelector(':scope > .es-title'), tcv = ti && ti.querySelector('canvas.es-title-ink');
    if (tcv) paintInk(tcv, G.w, G.h, t.titleInk, 1, hideCard, 0);
    el.querySelectorAll(':scope > .es-folder .es-tile').forEach(tile => { const k = byId(pg.tasks, tile.dataset.tile); const c = tile.querySelector('canvas'); if (k && c) paintTile(c, k, TILE_W - 2, TILE_H - 2); });
  }
  function drawCardInks(only) {
    const pg = ideaPg(); if (!pg) return;
    const roots = [host(), document.getElementById('eoCardWrap')].filter(Boolean);
    for (const r of roots) r.querySelectorAll('.eo-card').forEach(el => { if (only && el.dataset.id !== only) return; drawCardEl(el, ST.hide); });
  }


  function bindBoard() {
    const h = host(), view = viewEl(), world = worldEl();
    if (!h || !view) return;
    h.querySelectorAll('[data-act="menu"]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); openItemMenu(b.dataset.kind || 'card', b.dataset.id, b); }));
    h.querySelectorAll('[data-act="expand"]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); openCardFull(b.dataset.id); }));
    const photoIn = h.querySelector('.eo-photo-in'), pdfIn = h.querySelector('.eo-pdf-in');
    if (photoIn) photoIn.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) addPhotoFile(f); });
    if (pdfIn) pdfIn.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) importPdfToBoard(f); });
    bindItemClicks(world);
    view.addEventListener('pointerdown', onPtrDown);
    view.addEventListener('wheel', onWheel, { passive: false });
    view.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    view.addEventListener('drop', onDrop);
    view.addEventListener('contextmenu', ev => ev.preventDefault());
  }
  function bindItemClicks(root) {
    root.querySelectorAll('.eo-link').forEach(el => el.addEventListener('click', ev => {
      if (ev.target.closest('button,.eo-resize')) return;
      if (Date.now() < ST.noClickUntil) { ev.preventDefault(); return; }
      const pg = ideaPg(), lk = byId(pg.links, el.dataset.id);
      const href = lk && safeLink(lk.href); if (!href) return;
      ev.preventDefault(); ev.stopPropagation();
      const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    }));
    root.querySelectorAll('.eo-img.pdf').forEach(el => el.addEventListener('click', ev => {
      if (ev.target.closest('button,.eo-resize')) return;
      if (Date.now() < ST.noClickUntil) return;
      ev.preventDefault(); ev.stopPropagation();
      const im = byId(ideaPg().images, el.dataset.id);
      if (im && im.pdfId) openPdfViewer(im.pdfId, im.page);
    }));
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
    if (lm && !lm.contains(ev.target) && !(ev.pointerType === 'touch' && lassoHas(ev.clientX, ev.clientY))) cancelLasso();   // v21es: a finger hold inside the lasso drags the selection
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



  /* ===================== input (v21es: one pointer per gesture, Pencil first, nothing dropped) ===================== */
  function midOf(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; }
  function isPen(ev) { return ev.pointerType === 'pen' || ev.pointerType === 'mouse'; }
  function onHandle(el, ev) {
    const h = el.querySelector(':scope > .eo-resize'); if (!h) return false;
    const r = h.getBoundingClientRect();
    const slop = ev.pointerType === 'touch' ? FINGER_SLOP : 0;
    return ev.clientX >= r.left - slop && ev.clientX <= r.right + slop && ev.clientY >= r.top - slop && ev.clientY <= r.bottom + slop;
  }
  const sheetEl = () => document.getElementById('eoCardWrap');
  function findTarget(ev) {
    const t = ev.target && ev.target.closest ? ev.target : null; if (!t) return null;
    const tile = t.closest('.es-tile');
    if (tile) return { el: tile, kind: 'card', id: tile.dataset.tile, tile: true, parent: tile.dataset.in, resize: false };
    const el = t.closest('.eo-card, .eo-img, .eo-link');
    if (!el || !el.dataset.kind) return null;
    return { el, kind: el.dataset.kind, id: el.dataset.id, parent: el.dataset.parent || null, resize: !el.classList.contains('es-in-sheet') && onHandle(el, ev) };
  }
  /* local units of an element under a screen point (k = screen px per local unit: zoom × any CSS scale) */
  function localIn(el, cx, cy) { const r = el.getBoundingClientRect(), k = (r.width / (el.offsetWidth || r.width || 1)) || 1; return [(cx - r.left) / k, (cy - r.top) / k, k]; }
  function cardLocal(el, t, cx, cy) {
    const body = el.querySelector(':scope > .eo-card-body'); if (!body) return null;
    const br = body.getBoundingClientRect();
    if (cx < br.left || cy < br.top || cx > br.right || cy > br.bottom) return null;
    const l = localIn(body, cx, cy); return [l[0], l[1]];
  }
  const inkStyle = () => {
    const hl = typeof S !== 'undefined' && S.tool === 'highlighter';
    return hl ? { tool: 'highlighter', color: S.hlColor || '#ffd60a', width: S.hlWidth || 18 }
      : { tool: 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2 };
  };
  const curTool = () => (typeof S !== 'undefined' && S.tool) || 'pen';
  const fingerDraws = () => typeof fingerDrawOn === 'function' && fingerDrawOn();
  const r2 = v => +v.toFixed(2);
  function startGesture(ev, tgt, inSheet) {
    const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
    const tool = curTool(), base = { sx: ev.clientX, sy: ev.clientY, pid: ev.pointerId, t0: Date.now() };
    if (!inSheet && (tool === 'lasso' || (isPen(ev) && ev.buttons === 32))) {
      cancelLasso();
      const ce = ev.target.closest && ev.target.closest('.eo-card'), tc = ce && !ce.classList.contains('es-in-sheet') ? getItem('card', ce.dataset.id) : null;
      ST.g = Object.assign({ typ: 'lasso', pts: [[wx, wy]], card: tc && !tc.parent && cardLocal(ce, tc, ev.clientX, ev.clientY) ? tc.id : null }, base); return;
    }
    if (tool === 'eraser') { ST.g = Object.assign({ typ: 'erase', snap: bSnapNow(), changed: false }, base); eraseAt(ev.clientX, ev.clientY); return; }
    if (tool === 'text' && !inSheet) { ST.g = Object.assign({ typ: 'textTap', wx, wy }, base); return; }
    if (tool === 'lasso' || tool === 'text') return;
    const style = inkStyle(), pr = ev.pressure || 0.5;
    const ce = ev.target.closest && ev.target.closest('.eo-card');
    const t = ce && getItem('card', ce.dataset.id);
    if (t) {
      /* v21es: the Pencil on ANY part of a card writes on that card — title strip → the title, everything else → the card
         (before, a stroke starting on the title line, the attachment strip or the border went to the board UNDER the card) */
      const ti = ce.querySelector(':scope > .es-title'), body = ce.querySelector(':scope > .eo-card-body');
      const tr = ti && ti.getBoundingClientRect();
      if (ti && ev.clientY < tr.bottom && ev.clientY >= tr.top - 6) {
        const l = localIn(ti, ev.clientX, ev.clientY);
        ST.g = Object.assign({ typ: 'tink', id: t.id, el: ce, style, snap: bSnapNow(), th0: thOf(t), bh0: t.bh, pts: [[r2(l[0]), r2(l[1]), pr]] }, base); return;
      }
      if (body) {
        const l = localIn(body, ev.clientX, ev.clientY);
        ST.g = Object.assign({ typ: 'cink', id: t.id, el: ce, style, snap: bSnapNow(), pts: [[r2(l[0]), r2(l[1]), pr]] }, base); return;
      }
    }
    if (inSheet) return;
    ST.g = Object.assign({ typ: 'ink', style, pts: [[r2(wx), r2(wy), pr]] }, base);
    growWorldAt(wx, wy);
  }
  function onPtrDown(ev) {
    if (ev.button && ev.button !== 0 && ev.button !== 5) return;
    const inSheet = !!(ev.currentTarget && ev.currentTarget.id === 'eoCardWrap');
    if (ev.target.closest && ev.target.closest('button, input, textarea, select, .eo-lasso-menu, .eo-att-link, .eo-full-tools')) return;   // controls never become ink
    const pen = isPen(ev);
    ST.ptrs = ST.ptrs || new Map();
    const g0 = ST.g;
    if (!pen) {
      /* v21es: a palm or finger that lands while the Pencil is writing is ignored — it used to start a pinch that threw the
         stroke away, or its lift ended the stroke early */
      if (g0 && g0.pen) { if (ev.cancelable) ev.preventDefault(); return; }
      ST.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: 'touch' });
      const touches = [...ST.ptrs.values()].filter(p => p.type === 'touch');
      if (touches.length >= 2) {
        if (g0 && g0.typ === 'drag') return;            // a second finger during a drag changes nothing
        if (inSheet) return;
        ev.preventDefault();
        if (g0 && g0.timer) clearTimeout(g0.timer);
        if (g0 && (g0.typ === 'ink' || g0.typ === 'cink' || g0.typ === 'tink')) clearLive();
        ST.g = { typ: 'pinch', mid: midOf(touches[0], touches[1]), vx: VIEW.x, vy: VIEW.y, vs: VIEW.s };
        return;
      }
    } else {
      if (g0 && g0.pen && g0.pid !== ev.pointerId) return;
      if (g0 && !g0.pen) { if (g0.timer) clearTimeout(g0.timer); if (g0.typ === 'drag') dropCancel(g0); ST.g = null; }   // the Pencil wins over a finger
      ST.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: 'pen' });
    }
    if (!isPen(ev) && ev.isPrimary === false) return;
    ev.preventDefault();
    const tgt = findTarget(ev);
    if (tgt && tgt.resize) {
      const item = getItem(tgt.kind, tgt.id);
      ST.g = { typ: 'resize', kind: tgt.kind, id: tgt.id, sx: ev.clientX, sy: ev.clientY, ow: itemW(item, tgt.kind), oh: itemH(item, tgt.kind), snap: bSnapNow(), pid: ev.pointerId, pen, k: localIn(tgt.el, ev.clientX, ev.clientY)[2] };
      return;
    }
    if (pen) { startGesture(ev, tgt, inSheet); if (ST.g) ST.g.pen = true; return; }
    /* finger */
    const inSel = !inSheet && ST.selLasso && lassoHas(ev.clientX, ev.clientY);
    if (tgt || inSel) {
      const g = { typ: 'hold', tgt: inSel ? { sel: true } : tgt, sx: ev.clientX, sy: ev.clientY, vx: VIEW.x, vy: VIEW.y, pid: ev.pointerId, inSheet, t0: Date.now(), ev0: { clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, buttons: ev.buttons, pointerType: ev.pointerType, target: ev.target, pointerId: ev.pointerId } };
      g.timer = setTimeout(() => { if (ST.g !== g) return; liftDrag(g); }, (ST.holdMs != null ? ST.holdMs : HOLD_MS));
      ST.g = g; return;
    }
    if (fingerDraws() && ['pen', 'highlighter', 'eraser', 'lasso', 'text'].includes(curTool())) { startGesture(ev, null, inSheet); return; }
    if (inSheet) { ST.g = { typ: 'stap', sx: ev.clientX, sy: ev.clientY, pid: ev.pointerId, back: ev.target === ev.currentTarget }; return; }
    ST.g = { typ: 'pan', sx: ev.clientX, sy: ev.clientY, vx: VIEW.x, vy: VIEW.y, tap: true, pid: ev.pointerId };
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
  function pushPts(g, list, toLocal) { for (const e of list) { const q = toLocal(e.clientX, e.clientY); g.pts.push([r2(q[0]), r2(q[1]), e.pressure || 0.5]); } }
  function onPtrMove(ev) {
    if (!ST.ptrs || !ST.ptrs.has(ev.pointerId)) return;
    ST.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: ST.ptrs.get(ev.pointerId).type });
    const g = ST.g; if (!g) return;
    if (g.typ === 'pinch') {
      if (ev.cancelable) ev.preventDefault();
      const pts = [...ST.ptrs.values()].filter(p => p.type === 'touch'); if (pts.length < 2) return;
      const m = midOf(pts[0], pts[1]);
      const s = g.vs * (m.d / (g.mid.d || 1));
      VIEW.s = Math.max(0.35, Math.min(3, s));
      VIEW.x = g.vx + (m.x - g.mid.x);
      VIEW.y = g.vy + (m.y - g.mid.y);
      applyView(); return;
    }
    if (g.pid != null && ev.pointerId !== g.pid) return;      // v21es: only this gesture's own pointer moves it
    if (ev.cancelable) ev.preventDefault();
    if (g.typ === 'hold') {
      if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > HOLD_SLOP) {
        clearTimeout(g.timer);
        /* moved before the hold: it is a pan (or a finger stroke when ☝️ Finger draws) */
        if (fingerDraws() && ['pen', 'highlighter', 'eraser', 'lasso'].includes(curTool())) { ST.g = null; startGesture(Object.assign({}, g.ev0), g.tgt && g.tgt.el ? g.tgt : null, g.inSheet); if (ST.g) onPtrMove(ev); }
        else if (g.inSheet) ST.g = { typ: 'stap', sx: g.sx, sy: g.sy, pid: g.pid, moved: true };
        else ST.g = { typ: 'pan', sx: g.sx, sy: g.sy, vx: g.vx, vy: g.vy, pid: g.pid };
        if (ST.g && ST.g.typ === 'pan') { VIEW.x = ST.g.vx + (ev.clientX - ST.g.sx); VIEW.y = ST.g.vy + (ev.clientY - ST.g.sy); applyView(); }
      }
      return;
    }
    if (g.typ === 'pan') {
      if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 6) g.tap = false;
      VIEW.x = g.vx + (ev.clientX - g.sx); VIEW.y = g.vy + (ev.clientY - g.sy); applyView(); return;
    }
    if (g.typ === 'stap') { if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > 8) g.moved = true; return; }
    if (g.typ === 'drag') { dragMove(g, ev); return; }
    if (g.typ === 'resize') {
      const it = getItem(g.kind, g.id); if (!it) return;
      const dw = (ev.clientX - g.sx) / (g.k || VIEW.s), dh = (ev.clientY - g.sy) / (g.k || VIEW.s);
      const w = Math.max(g.kind === 'card' ? MIN_W : 60, g.ow + dw), h = Math.max(g.kind === 'link' ? 44 : g.kind === 'card' ? thOf(it) + 44 + folderH(it) : 40, g.oh + dh);
      if (!g.changed && (Math.abs(dw) > 1 || Math.abs(dh) > 1)) { g.changed = true; pushSnap(g.snap); }
      setItemBox(it, g.kind, null, null, w, h);
      const el = document.querySelector('#ibHost [data-kind="' + g.kind + '"][data-id="' + g.id + '"]');
      if (el) { el.style.width = w + 'px'; el.style.height = h + 'px'; const b = el.querySelector(':scope > .eo-card-body'); if (b && g.kind === 'card') b.style.height = bodyH(it) + 'px'; }
      if (g.kind === 'card') drawCardInks(g.id);
      if (!it.parent) growWorldAt(itemX(it, g.kind) + w, itemY(it, g.kind) + h);
      return;
    }
    if (g.typ === 'erase') { eraseAt(ev.clientX, ev.clientY); return; }
    if (g.typ === 'textTap') return;
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    const list = evs.length ? evs : [ev];
    if (g.typ === 'ink') {
      pushPts(g, list, screenToWorld);
      const last = g.pts[g.pts.length - 1];
      drawLive(g.pts, g.style); growWorldAt(last[0], last[1]); return;
    }
    if (g.typ === 'cink' || g.typ === 'tink') {
      const el = g.el, t = getItem('card', g.id); if (!el || !t || !el.isConnected) return;
      const box = el.querySelector(g.typ === 'tink' ? ':scope > .es-title' : ':scope > .eo-card-body'); if (!box) return;
      pushPts(g, list, (x, y) => localIn(box, x, y));
      const last = g.pts[g.pts.length - 1];
      if (g.typ === 'cink') autoGrowCard(t, last[0], last[1], el); else growTitle(t, last[0], last[1], el);
      drawLiveCard(el, t, g.pts, g.style, g.typ === 'tink');
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
  /* v21es: both card canvases span the card's whole inside (title + body + group strip); body ink is offset by the title height */
  function cardInkBox(el, t) {
    const ti = el.querySelector(':scope > .es-title'), th = ti ? ti.offsetHeight : thOf(t);
    return { w: Math.max(8, el.clientWidth), h: Math.max(8, el.clientHeight), th };
  }
  function drawLiveCard(el, t, pts, style, title) {
    const box = el.querySelector(title ? ':scope > .es-title' : ':scope > .eo-card-body'); if (!box) return;
    const cv = box.querySelector(title ? 'canvas.es-title-ink' : ':scope > canvas.eo-card-ink'); if (!cv) return;
    const G = cardInkBox(el, t);
    const ctx = paintInk(cv, G.w, G.h, title ? t.titleInk : t.strokes, 1, null, title ? 0 : G.th);
    if (title) { const ph = box.querySelector('.es-title-ph'); if (ph) ph.style.visibility = 'hidden'; const ty = box.querySelector('.eo-card-title'); if (ty) ty.classList.add('es-under'); }
    const s = Object.assign({}, style || inkStyle(), { points: pts });
    if (typeof bbox === 'function') s.bb = bbox(pts);
    ctx.save(); if (!title) ctx.translate(0, G.th);
    if (typeof drawStroke === 'function') drawStroke(ctx, s);
    ctx.restore();
  }
  /* the card grows (right / down) as the Pencil writes near its edge; the body keeps its origin, so nothing jumps */
  function autoGrowCard(t, lx, ly, el) {
    const pad = 28, fh = folderH(t), th = thOf(t);
    const needW = Math.max(t.bw || CARD_W, Math.ceil(lx + pad + 2));
    const needH = Math.max(t.bh || defaultCardH(t), Math.ceil(2 + th + ly + pad + fh));
    if (needW > (t.bw || 0) || needH > (t.bh || 0)) {
      t.bw = needW; t.bh = needH;
      if (el) { el.style.width = needW + 'px'; el.style.height = needH + 'px'; const b = el.querySelector(':scope > .eo-card-body'); if (b) b.style.height = bodyH(t) + 'px'; }
      if (t.bx != null && !t.parent) growWorldAt(t.bx + needW, t.by + needH);
    }
  }
  function growTitle(t, lx, ly, el) {
    const th = thOf(t), need = th;   // v21es: the strip no longer grows under the Pencil (ink may run past it; nothing below moves)
    if (need > th) {
      const d = need - th; t.th = need; t.bh = (t.bh || defaultCardH(t)) + d;
      if (el) { el.style.height = t.bh + 'px'; const ti = el.querySelector(':scope > .es-title'); if (ti) ti.style.height = need + 'px'; }
    }
    if (lx + 10 > (t.bw || CARD_W)) { t.bw = Math.ceil(lx + 12); if (el) el.style.width = t.bw + 'px'; }
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
    const cardEl = document.elementsFromPoint(cx, cy).find(e => e.classList && e.classList.contains('eo-card') && (host().contains(e) || (sheetEl() && sheetEl().contains(e))));
    const hit = (list, p, R) => { const keep = (list || []).filter(s => !strokeHit(s, p, R)); return keep.length !== (list || []).length ? keep : null; };
    if (cardEl) {
      const t = getItem('card', cardEl.dataset.id);
      const ti = cardEl.querySelector(':scope > .es-title'), body = cardEl.querySelector(':scope > .eo-card-body');
      if (t) for (const [box, key] of [[ti, 'titleInk'], [body, 'strokes']]) {
        if (!box) continue; const l = localIn(box, cx, cy), keep = hit(t[key], [l[0], l[1]], 10 / l[2]);
        if (keep) { if (g && !g.changed) { g.changed = true; pushSnap(g.snap); } t[key] = keep; changed = true; }
      }
      if (changed) drawCardInks(t.id);
    } else if (!sheetEl()) {
      const p = screenToWorld(cx, cy), keep = hit(pg.strokes, p, 10 / VIEW.s);
      if (keep) { if (g && !g.changed) { g.changed = true; pushSnap(g.snap); } pg.strokes = keep; changed = true; drawInkLayer(); }
    }
    if (changed) saveWB();
  }
  /* geometry of a card on the board (world units) */
  function cardOrigin(t) { return [(t.bx || 0) + 1, (t.by || 0) + 1 + thOf(t)]; }
  function topAncestor(pg, t) { const c = parentChain(pg, t); return c.length ? c[c.length - 1] : t; }
  function cardForBoardStroke(pts) {
    /* a board stroke that mostly lies on a card belongs to that card (it began just outside its edge) */
    const cards = cardsOf().filter(t => !t.parent && t.bx != null);
    for (let i = cards.length - 1; i >= 0; i--) {
      const t = cards[i], x0 = t.bx, y0 = t.by, x1 = t.bx + (t.bw || CARD_W), y1 = t.by + (t.bh || defaultCardH(t));
      const n = pts.filter(p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1).length;
      if (n / pts.length >= 0.6) return t;
    }
    return null;
  }
  /* put a stroke (body- or title-local points) into a card so all of it shows: the card grows left/up/right/down as needed */
  function fitStrokeInCard(t, s, title) {
    /* s is already in t.titleInk / t.strokes. If it runs off the card's left or top edge the card grows that way: the card
       moves out and EVERYTHING inside (title ink, body ink, items) moves back by the same amount, so nothing moves on the board. */
    const bb = bbox(s.points), th = thOf(t), top = title ? bb[1] : bb[1] + th;
    const dx = bb[0] < -1 ? Math.ceil(2 - bb[0]) : 0, dy = top < -1 ? Math.ceil(2 - top) : 0;
    if (dx || dy) {
      const pg = ideaPg();
      for (const q of (t.strokes || []).concat(t.titleInk || [])) moveStroke(q, dx, dy);
      const L = loose(pg, t.id); for (const it of L.images.concat(L.links)) { it.x = (it.x || 0) + dx; it.y = (it.y || 0) + dy; }
      t.bx = (t.bx || 0) - dx; t.by = (t.by || 0) - dy; t.bw = (t.bw || CARD_W) + dx; t.bh = (t.bh || defaultCardH(t)) + dy;
      if (!t.parent && (t.bx < 0 || t.by < 0)) { t.bx = Math.max(0, t.bx); t.by = Math.max(0, t.by); }
    }
    const b2 = bbox(s.points);
    if (title) {
      if (b2[2] + 8 > (t.bw || CARD_W)) t.bw = Math.ceil(b2[2] + 10);
      if (b2[3] + 6 > (t.bh || defaultCardH(t)) - 2) t.bh = Math.ceil(b2[3] + 10);
      return;
    }
    autoGrowCard(t, b2[2] - 18, b2[3] - 18 + 10, null);
  }
  function commitStroke(g, ev) {
    const s = Object.assign({ id: uid('s') }, g.style, { points: g.pts });
    if (typeof bbox === 'function') s.bb = bbox(g.pts);
    return s;
  }
  function onPtrUp(ev) {
    if (!ST.ptrs || !ST.ptrs.has(ev.pointerId)) return;
    ST.ptrs.delete(ev.pointerId);
    const g = ST.g;
    if (!g) return;
    if (g.typ === 'pinch') { if ([...ST.ptrs.values()].filter(p => p.type === 'touch').length < 2) { ST.g = null; saveWB(); flushRender(); } return; }
    if (g.pid != null && ev.pointerId !== g.pid) return;
    ST.g = null;
    try { endGesture(g, ev); } finally { if (inkStale) checkInkRegion(); flushRender(); }
  }
  function endGesture(g, ev) {
    if (g.pen) ST.noClickUntil = Date.now() + 350;       // a Pencil tap writes a dot — it never opens a link or PDF
    if (g.typ === 'hold') {
      clearTimeout(g.timer);
      const tg = g.tgt || {};
      if (tg.sel) return;
      if (tg.tile) { openCardFull(tg.parent || tg.id); return; }
      if (g.inSheet) { if (tg.kind === 'card' && tg.el && tg.el.closest('.es-kid')) openCardFull(tg.id); return; }
      /* v21es: a tap on a group's card strip, or a double tap on any card, opens it */
      const t0 = g.ev0 && g.ev0.target;
      if (tg.kind === 'card' && t0 && t0.closest && t0.closest('.es-folder')) { openCardFull(tg.id); return; }
      if (tg.kind === 'card' && ST.lastTapId === tg.id && Date.now() - ST.lastTap < 380) { ST.lastTapId = null; openCardFull(tg.id); return; }
      ST.lastTap = Date.now(); ST.lastTapId = tg.id;
      /* a finger tap on an item selects it (links / PDF pages also open on the click) */
      const was = isSel(tg.kind, tg.id);
      ST.sel = { kind: tg.kind, id: tg.id };
      if (!was) render();
      return;
    }
    if (g.typ === 'stap') { if (!g.moved && g.back && ev.type === 'pointerup') closeCardFull(); return; }
    if (g.typ === 'pan') { if (g.tap && ev.type === 'pointerup') { if (ST.sel) { ST.sel = null; render(); } } else saveWB(); return; }
    if (g.typ === 'drag') { dragEnd(g, ev); return; }
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
      /* v21es: every Pencil stroke is kept — dots (i, j, full stops), taps and strokes that end where they began (o, 0, e)
         used to be thrown away because the pen-up point was within 4px of the pen-down point */
      if (!g.pts.length) return;
      const s = commitStroke(g, ev);
      const pg = ideaPg();
      const t = cardForBoardStroke(g.pts);
      if (t) {
        pushWB();
        const o = cardOrigin(t), inTitle = s.bb[3] <= t.by + 1 + thOf(t) + 4 && s.bb[1] >= t.by - 4;
        const ox = o[0], oy = inTitle ? t.by + 1 : o[1];
        moveStroke(s, -ox, -oy);
        if (inTitle) { t.titleInk = t.titleInk || []; t.titleInk.push(s); fitStrokeInCard(t, s, true); recognizeTitle(t); }
        else { t.strokes = t.strokes || []; t.strokes.push(s); fitStrokeInCard(t, s, false); }
        saveWB(); ST.renderPending = true;
      } else {
        pushWB();
        pg.strokes.push(s); saveWB();
        drawInkLayer();
      }
      const hint = host() && host().querySelector('.eo-empty'); if (hint) hint.remove();
      if (!moved && !g.pen && ST.sel) { ST.sel = null; ST.renderPending = true; }
      return;
    }
    if (g.typ === 'cink' || g.typ === 'tink') {
      const t = getItem('card', g.id); if (!t) return;
      if (!g.pts.length) { drawCardInks(t.id); return; }
      const s = commitStroke(g, ev); let title = g.typ === 'tink';
      /* v21es: title or body is decided by where the stroke mostly is, not only where it started — a tall letter that
         dips out of the title stays in the title (the strip grows), a stroke that starts on the title's rule but is
         written in the body goes to the body (and the strip growth it caused is undone) */
      { const th0 = g.th0 != null ? g.th0 : thOf(t), b0 = bbox(s.points), cyS = (b0[1] + b0[3]) / 2;
        if (title && cyS > th0) { if (g.th0 != null) { t.th = g.th0; t.bh = g.bh0; } moveStroke(s, 0, -th0); title = false; }
        else if (!title && cyS < 0 && cyS > -thOf(t) - 6) { moveStroke(s, 0, thOf(t)); title = true; } }
      /* a stroke that started on a card's edge but lies (almost) all on the board belongs to the board */
      const bw = t.bw || CARD_W, bhh = t.bh || defaultCardH(t), th = thOf(t), oy = title ? 0 : th;
      const onCard = g.pts.filter(p => p[0] >= -2 && p[0] <= bw && p[1] + oy >= -2 && p[1] + oy <= bhh).length / g.pts.length;
      pushSnap(g.snap);
      if (onCard < 0.3 && !t.parent && !g.el.classList.contains('es-in-sheet') && t.bx != null) {
        const o = title ? [t.bx + 1, t.by + 1] : cardOrigin(t);
        moveStroke(s, o[0], o[1]);
        ideaPg().strokes.push(s);
      } else if (title) { t.titleInk = t.titleInk || []; t.titleInk.push(s); fitStrokeInCard(t, s, true); recognizeTitle(t); }
      else { t.strokes = t.strokes || []; t.strokes.push(s); fitStrokeInCard(t, s, false); }
      saveWB(); ST.renderPending = true;
      return;
    }
    if (g.typ === 'lasso') {
      if (g.pts.length > 4) finishLasso(g.pts, g.card); else clearLive();
    }
  }
  addEventListener('pointermove', onPtrMove, { capture: true, passive: false });
  addEventListener('pointerup', onPtrUp, true);
  addEventListener('pointercancel', onPtrUp, true);
  /* a lifted item must not scroll the sheet / page under the finger */
  addEventListener('touchmove', ev => { if (ST.g && (ST.g.typ === 'drag' || ST.g.typ === 'hold' || (ST.g.pen && BUSY.test(ST.g.typ))) && ev.cancelable) ev.preventDefault(); }, { capture: true, passive: false });
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

  /* ===================== v21es: hold a finger on anything, drag it into a card, out of a card, or into another card ===================== */
  /* the dragged content is described in its source units relative to an origin O, drawn in a floating ghost, and dropped into a
     card body (local units) or on the board (world units). One undo step. */
  function pieceSet(src, strokes, images, links) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const s of strokes) { const bb = s.bb || bbox(s.points); a = Math.min(a, bb[0]); b = Math.min(b, bb[1]); c = Math.max(c, bb[2]); d = Math.max(d, bb[3]); }
    for (const it of images.concat(links)) { a = Math.min(a, it.x || 0); b = Math.min(b, it.y || 0); c = Math.max(c, (it.x || 0) + (it.w || 120)); d = Math.max(d, (it.y || 0) + (it.h || 60)); }
    if (!isFinite(a)) { a = 0; b = 0; c = 10; d = 10; }
    return { src, strokes, images, links, O: [a, b], W: c - a, H: d - b };
  }
  function srcScreen(src) {
    /* screen position of source-unit (0,0) and screen px per unit */
    if (src.card) {
      const el = document.querySelector('#ibHost .eo-card[data-id="' + src.card + '"], #eoCardWrap .eo-card[data-id="' + src.card + '"]');
      const body = el && el.querySelector(':scope > .eo-card-body'); if (!body) return null;
      const r = body.getBoundingClientRect(), k = (r.width / (body.offsetWidth || 1)) || 1; return { x: r.left, y: r.top, k };
    }
    const o = worldToScreen(0, 0); return { x: o[0], y: o[1], k: VIEW.s };
  }
  function ghostLayer() { let gl = document.getElementById('esGhost'); if (!gl) { gl = document.createElement('div'); gl.id = 'esGhost'; gl.setAttribute('aria-hidden', 'true'); document.body.appendChild(gl); } return gl; }
  function liftDrag(g) {
    const pg = ideaPg(), tg = g.tgt; if (!pg || !tg) return;
    const D = { typ: 'drag', pid: g.pid, sx: g.sx, sy: g.sy, snap: bSnapNow(), inSheet: g.inSheet, hideEls: [] };
    const gl = ghostLayer(); gl.innerHTML = ''; gl.hidden = false;
    let scr = null;
    if (tg.sel) {
      const sel = ST.selLasso; if (!sel) return;
      const from = sel.card ? byId(pg.tasks, sel.card) : null;
      const strokes = (from ? from.strokes : pg.strokes || []).filter(s => sel.ids.includes(s.id));
      const images = (pg.images || []).filter(i => sel.images.includes(i.id)), links = (pg.links || []).filter(l => sel.links.includes(l.id));
      D.P = pieceSet(from ? { card: from.id } : {}, strokes, images, links);
      cancelLasso(true);
    } else if (tg.kind === 'card') {
      const t = byId(pg.tasks, tg.id); if (!t) return;
      D.card = t; D.from = t.parent || null;
    } else {
      const it = getItem(tg.kind, tg.id); if (!it) return;
      D.P = pieceSet(it.parent ? { card: it.parent } : {}, [], tg.kind === 'img' ? [it] : [], tg.kind === 'link' ? [it] : []);
    }
    if (D.card) {
      const t = D.card, el = tg.el, r = el.getBoundingClientRect();
      const box = document.createElement('div'); box.innerHTML = cardHtml(t, { sheet: true }); const ce = box.firstChild;
      const sc = tg.tile ? Math.min(0.7, Math.max(0.35, (TILE_W * 2) / (t.bw || CARD_W))) : (r.width / ((t.bw || CARD_W)) || 1);
      gl.appendChild(ce); ce.classList.add('es-ghost-card');
      Object.assign(gl.style, { left: (tg.tile ? g.sx - (t.bw || CARD_W) * sc / 2 : r.left) + 'px', top: (tg.tile ? g.sy - 20 * sc : r.top) + 'px', transform: 'scale(' + sc + ')' });
      drawCardEl(ce);
      D.ghost0 = [parseFloat(gl.style.left), parseFloat(gl.style.top)]; D.gs = sc;
      el.classList.add('es-src-drag'); D.hideEls.push(el);
    } else {
      const P = D.P; scr = srcScreen(P.src); if (!scr) return;
      const box = document.createElement('div'); box.className = 'es-ghost-box'; Object.assign(box.style, { width: P.W + 'px', height: P.H + 'px' });
      for (const im of P.images) { const w = document.createElement('div'); w.innerHTML = imgHtml(Object.assign({}, im, { x: im.x - P.O[0], y: im.y - P.O[1] })); const e = w.firstChild; e.classList.remove('selected'); e.querySelectorAll('.eo-sel-tools, .eo-resize').forEach(x => x.remove()); box.appendChild(e); }
      for (const lk of P.links) { const w = document.createElement('div'); w.innerHTML = linkHtml(Object.assign({}, lk, { x: lk.x - P.O[0], y: lk.y - P.O[1] })); const e = w.firstChild; e.classList.remove('selected'); e.querySelectorAll('.eo-sel-tools, .eo-resize').forEach(x => x.remove()); box.appendChild(e); }
      if (P.strokes.length) {
        const cv = document.createElement('canvas'); cv.className = 'es-ghost-ink'; box.appendChild(cv);
        paintInk(cv, Math.max(8, P.W + 8), Math.max(8, P.H + 8), P.strokes.map(s => scaleStroke(s, 1, 4 - P.O[0], 4 - P.O[1])), 1);
        Object.assign(cv.style, { left: '-4px', top: '-4px' });
      }
      gl.appendChild(box);
      Object.assign(gl.style, { left: (scr.x + P.O[0] * scr.k) + 'px', top: (scr.y + P.O[1] * scr.k) + 'px', transform: 'scale(' + scr.k + ')' });
      D.ghost0 = [parseFloat(gl.style.left), parseFloat(gl.style.top)]; D.gs = scr.k;
      /* hide the originals while they are carried */
      ST.hide = new Set(P.strokes.map(s => s.id));
      for (const it of P.images.concat(P.links)) { const e = document.querySelector('[data-id="' + it.id + '"][data-kind]'); if (e) { e.classList.add('es-src-drag'); D.hideEls.push(e); } }
      if (P.strokes.length) { if (P.src.card) drawCardInks(P.src.card); else drawInkLayer(); }
      fillAssetImgs(gl);
    }
    gl.classList.add('on');
    ST.sel = null;
    ST.g = D;
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
  }
  function dropTargetAt(cx, cy, D) {
    const pg = ideaPg(), sh = sheetEl();
    const els = document.elementsFromPoint(cx, cy);
    if (sh) {
      const panel = sh.querySelector('.es-sheet'), pr = panel && panel.getBoundingClientRect();
      if (!pr || cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) return { board: true };
      const ce = els.find(e => e.classList && e.classList.contains('eo-card') && sh.contains(e) && !e.classList.contains('es-src-drag'));
      if (ce) return { card: byId(pg.tasks, ce.dataset.id), el: ce };
      const kids = els.find(e => e.classList && e.classList.contains('es-kids'));
      if (kids && D.card) return { reorder: kids.dataset.kids, el: kids };
      return { none: true };
    }
    const ce = els.find(e => e.classList && e.classList.contains('eo-card') && host().contains(e) && !e.classList.contains('es-src-drag'));
    if (ce) return { card: byId(pg.tasks, ce.dataset.id), el: ce };
    return { board: true };
  }
  function canDropCardIn(pg, c, T) {
    if (!T || T.id === c.id || isInside(pg, T, c)) return 'self';
    if (depthOf(pg, T) + 1 + subH(pg, c) > MAX_DEPTH) return 'deep';
    return '';
  }
  function dragMove(D, ev) {
    const gl = document.getElementById('esGhost'); if (!gl) return;
    const dx = ev.clientX - D.sx, dy = ev.clientY - D.sy;
    if (!D.moved && Math.hypot(dx, dy) > 2) D.moved = true;
    gl.style.left = (D.ghost0[0] + dx) + 'px'; gl.style.top = (D.ghost0[1] + dy) + 'px';
    const T = dropTargetAt(ev.clientX, ev.clientY, D);
    document.querySelectorAll('.es-drop, .es-drop-bad').forEach(e => e.classList.remove('es-drop', 'es-drop-bad'));
    if (T.card && T.el) {
      const bad = D.card ? canDropCardIn(ideaPg(), D.card, T.card) : '';
      T.el.classList.add(bad ? 'es-drop-bad' : 'es-drop');
    }
    D.last = { x: ev.clientX, y: ev.clientY };
  }
  function dropCancel(D) {
    const gl = document.getElementById('esGhost'); if (gl) { gl.innerHTML = ''; gl.classList.remove('on'); }
    (D.hideEls || []).forEach(e => e.classList.remove('es-src-drag'));
    document.querySelectorAll('.es-drop, .es-drop-bad').forEach(e => e.classList.remove('es-drop', 'es-drop-bad'));
    ST.hide = null;
    drawInkLayer(); drawCardInks();
  }
  /* body origin (screen) and px-per-unit of a card element */
  function bodyScreen(el) { const b = el && el.querySelector(':scope > .eo-card-body'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, k: (r.width / (b.offsetWidth || 1)) || 1 }; }
  function growToFit(t, maxX, maxY) {
    const fh = folderH(t), th = thOf(t);
    t.bw = Math.max(t.bw || CARD_W, Math.ceil(maxX + 10 + 2));
    t.bh = Math.max(t.bh || defaultCardH(t), Math.ceil(2 + th + maxY + 10 + fh));
  }
  /* move a piece set from its source into a card body at local origin L, or onto the board at world origin W */
  function placePieces(pg, P, dest, at) {
    const from = P.src.card ? byId(pg.tasks, P.src.card) : null;
    const ids = new Set(P.strokes.map(s => s.id));
    if (from) from.strokes = (from.strokes || []).filter(s => !ids.has(s.id)); else pg.strokes = (pg.strokes || []).filter(s => !ids.has(s.id));
    const dx = at[0] - P.O[0], dy = at[1] - P.O[1];
    let mx = 0, my = 0;
    for (const s of P.strokes) { moveStroke(s, dx, dy); const b = s.bb; mx = Math.max(mx, b[2]); my = Math.max(my, b[3]); }
    for (const it of P.images.concat(P.links)) {
      it.x = Math.round((it.x || 0) + dx); it.y = Math.round((it.y || 0) + dy);
      if (dest) it.parent = dest.id; else delete it.parent;
      mx = Math.max(mx, it.x + (it.w || 120)); my = Math.max(my, it.y + (it.h || 60));
    }
    if (dest) { dest.strokes = (dest.strokes || []).concat(P.strokes); growToFit(dest, mx, my); }
    else { pg.strokes = (pg.strokes || []).concat(P.strokes); }
  }
  function nextCord(pg, pid) { const k = kidsOf(pg, pid); return k.length ? Math.max(...k.map(c => c.cord || 0)) + 1 : 0; }
  function cardLabel(t) { return ((t && (t.text || t.titleText)) || '').trim(); }
  function dragEnd(D, ev) {
    const pg = ideaPg(), gl = document.getElementById('esGhost');
    const gx = gl ? parseFloat(gl.style.left) : 0, gy = gl ? parseFloat(gl.style.top) : 0;
    ST.noClickUntil = Date.now() + 450;
    const T = dropTargetAt(ev.clientX, ev.clientY, D);
    dropCancel(D);
    if (!D.moved && ev.type === 'pointerup') {          // held, lifted, put back down in place: just select it
      if (D.card && !D.from) ST.sel = { kind: 'card', id: D.card.id };
      else if (D.P && D.P.images.length + D.P.links.length === 1 && !D.P.strokes.length) { const it = D.P.images[0] || D.P.links[0]; ST.sel = { kind: D.P.images.length ? 'img' : 'link', id: it.id }; }
      render(); return;
    }
    if (ev.type === 'pointercancel' && !D.moved) { render(); return; }
    let msg = '', changed = false;
    if (D.card) {
      const c = D.card, old = c.parent ? byId(pg.tasks, c.parent) : null;
      if (T.card) {
        const bad = canDropCardIn(pg, c, T.card);
        if (bad) { toastMsg(bad === 'deep' ? 'Groups go ' + MAX_DEPTH + ' levels deep — drop it on the board or another card' : 'A card can’t go inside itself', 2200); render(); return; }
        if (c.parent !== T.card.id) {
          pushSnap(D.snap); c.parent = T.card.id; c.cord = nextCord(pg, T.card.id); fitFolder(T.card, pg); if (old) fitFolder(old, pg); changed = true;
          msg = 'Added to ' + (cardLabel(T.card) ? '“' + cardLabel(T.card) + '”' : 'the group');
        }
      } else if (T.reorder) {
        const kids = kidsOf(pg, T.reorder).filter(k => k.id !== c.id);
        const els = [...document.querySelectorAll('#eoCardWrap .es-kids > .es-kid > .eo-card')].filter(e => e.dataset.id !== c.id);
        /* cards flow left→right in rows: the drop goes before the first card whose row is below the finger, or that is on the finger's row and right of it */
        let at = els.findIndex(e => { const r = e.getBoundingClientRect(), rowTop = r.top - 52; if (ev.clientY < rowTop) return true; if (ev.clientY <= r.bottom + 9) return ev.clientX < r.left + r.width / 2; return false; });
        if (at < 0) at = kids.length;
        pushSnap(D.snap);
        if (c.parent !== T.reorder) { c.parent = T.reorder; if (old) fitFolder(old, pg); }
        kids.splice(at, 0, c); kids.forEach((k, i) => { k.cord = i; }); fitFolder(byId(pg.tasks, T.reorder), pg); changed = true;
      } else if (T.board) {
        const [wx, wy] = D.inSheet || c.parent ? screenToWorld(ev.clientX - 40, ev.clientY - 20) : screenToWorld(gx, gy);
        pushSnap(D.snap);
        c.bx = Math.max(0, Math.round(wx)); c.by = Math.max(0, Math.round(wy));
        if (c.parent) { delete c.parent; delete c.cord; if (old) fitFolder(old, pg); msg = 'Moved out onto the board'; }
        changed = true;
      }
    } else if (D.P) {
      const P = D.P;
      if (T.card) {
        const el = T.el, bs = bodyScreen(el); if (!bs) { render(); return; }
        const L = [Math.max(6, (gx - bs.x) / bs.k), Math.max(6, (gy - bs.y) / bs.k)];
        pushSnap(D.snap); placePieces(pg, P, T.card, L); changed = true;
        if (P.src.card !== T.card.id) msg = 'Moved into ' + (cardLabel(T.card) ? '“' + cardLabel(T.card) + '”' : 'the card');
      } else if (T.board) {
        const W = screenToWorld(gx, gy);
        pushSnap(D.snap); placePieces(pg, P, null, [Math.max(0, W[0]), Math.max(0, W[1])]); changed = true;
        if (P.src.card) msg = 'Moved out onto the board';
      }
    }
    if (changed) { growWorldToFit(pg); saveWB(); }
    render();
    if (msg) toastMsg(msg, 1600);
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
  function lassoHas(cx, cy) { const s = ST.selLasso; if (!s || !s.poly) return false; const p = screenToWorld(cx, cy); return polyHit(s.poly, p[0], p[1]); }
  /* v21es: a lasso that starts inside a card selects that card's ink / photos / links (to delete or move them out) */
  function finishLasso(poly, cardId) {
    const pg = ideaPg();
    const C = cardId ? byId(pg.tasks, cardId) : null;
    if (C) {
      const o = cardOrigin(C), lp = poly.map(p => [p[0] - o[0], p[1] - o[1]]), L = loose(pg, C.id);
      const ids = (C.strokes || []).filter(s => strokeInLasso(s, lp)).map(s => s.id);
      const images = L.images.filter(im => polyHit(lp, (im.x || 0) + (im.w || 0) / 2, (im.y || 0) + (im.h || 0) / 2));
      const links = L.links.filter(lk => polyHit(lp, (lk.x || 0) + (lk.w || 200) / 2, (lk.y || 0) + (lk.h || 56) / 2));
      if (ids.length || images.length || links.length) {
        ST.selLasso = { card: C.id, ids, images: images.map(i => i.id), links: links.map(l => l.id), poly };
        drawLassoLive(poly, true); showLassoMenu(poly); return;
      }
    }
    const ids = (pg.strokes || []).filter(s => strokeInLasso(s, poly)).map(s => s.id);
    const images = (pg.images || []).filter(im => isTopImg(im) && polyHit(poly, (im.x || 0) + (im.w || 0) / 2, (im.y || 0) + (im.h || 0) / 2));
    const links = (pg.links || []).filter(lk => !lk.parent && polyHit(poly, (lk.x || 0) + (lk.w || 260) / 2, (lk.y || 0) + (lk.h || 72) / 2));
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
    m.innerHTML = '<span class="eo-lm-n">' + cnt + ' selected · hold to drag</span>' +
      (n.card ? '<button type="button" class="primary" data-act="out">↗︎ Move out</button>' : '<button type="button" class="primary" data-act="make">🗂 Make card</button>') +
      '<button type="button" data-act="delete">🗑 Delete</button><button type="button" data-act="cancel">Cancel</button>';
    document.body.appendChild(m);
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let sx = r.left + VIEW.x + ((x1 + x2) / 2) * VIEW.s - mw / 2, sy = r.top + VIEW.y + y1 * VIEW.s - mh - 10;
    if (sy < r.top + 6) sy = r.top + VIEW.y + y2 * VIEW.s + 10;
    sy = Math.max(r.top + 6, Math.min(window.innerHeight - mh - 8, sy));
    sx = Math.max(r.left + 6, Math.min(window.innerWidth - mw - 8, sx));
    m.style.left = sx + 'px'; m.style.top = sy + 'px';
    const mk = m.querySelector('[data-act="make"]'); if (mk) mk.onclick = ev => { ev.stopPropagation(); makeCardFromSel(); };
    const out = m.querySelector('[data-act="out"]'); if (out) out.onclick = ev => { ev.stopPropagation(); moveSelOut(); };
    m.querySelector('[data-act="delete"]').onclick = ev => { ev.stopPropagation(); deleteSel(); };
    m.querySelector('[data-act="cancel"]').onclick = ev => { ev.stopPropagation(); cancelLasso(); };
  }
  function deleteSel() {
    const sel = ST.selLasso; cancelLasso(); if (!sel) return 0;
    const pg = ideaPg();
    pushWB();
    const C = sel.card ? byId(pg.tasks, sel.card) : null;
    const before = (C ? (C.strokes || []).length : (pg.strokes || []).length) + (pg.images || []).length + (pg.links || []).length;
    if (C) C.strokes = (C.strokes || []).filter(s => !sel.ids.includes(s.id)); else pg.strokes = (pg.strokes || []).filter(s => !sel.ids.includes(s.id));
    pg.images = (pg.images || []).filter(i => !sel.images.includes(i.id));
    pg.links = (pg.links || []).filter(l => !sel.links.includes(l.id));
    const gone = before - ((C ? (C.strokes || []).length : (pg.strokes || []).length) + (pg.images || []).length + (pg.links || []).length);
    saveWB(); render();
    if (typeof actionToast === 'function') actionToast('Deleted ' + gone + ' item' + (gone === 1 ? '' : 's'), 'Undo', () => { if (typeof bUndo === 'function') bUndo(IPI); }, 5000);
    return gone;
  }
  /* in-card lasso → ↗︎ Move out: the selection goes onto the board right where it is */
  function moveSelOut() {
    const sel = ST.selLasso; cancelLasso(); if (!sel || !sel.card) return false;
    const pg = ideaPg(), C = byId(pg.tasks, sel.card); if (!C) return false;
    const P = pieceSet({ card: C.id }, (C.strokes || []).filter(s => sel.ids.includes(s.id)), (pg.images || []).filter(i => sel.images.includes(i.id)), (pg.links || []).filter(l => sel.links.includes(l.id)));
    const o = cardOrigin(C);
    pushWB(); placePieces(pg, P, null, [o[0] + P.O[0], o[1] + P.O[1]]);
    /* the board ink sits under cards: put it just right of the card so it shows */
    const dx = (C.bx + (C.bw || CARD_W) + 24) - (o[0] + P.O[0]);
    for (const s of P.strokes) moveStroke(s, dx, 0);
    for (const it of P.images.concat(P.links)) it.x += dx;
    growWorldToFit(pg); saveWB(); render(); toastMsg('Moved out onto the board', 1500);
    return true;
  }
  function makeCardFromSel() {
    const sel = ST.selLasso; cancelLasso();
    if (!sel || sel.card) return null;
    const n = ideaN(), pg = ideaPg();
    const imgs = (pg.images || []).filter(i => sel.images.includes(i.id));
    const lks = (pg.links || []).filter(i => sel.links.includes(i.id));
    const t = cardFromInk({ note: n, pi: IPI, ids: sel.ids, images: imgs, links: lks, move: true }, n, IPI, boardCols(pg)[0].id);
    if (t) { ST.sel = { kind: 'card', id: t.id }; render(); toastMsg('Card made — write its title on the top line', 1800); }
    return t;
  }

  function addBlankCard(at) {
    const n = ideaN(), pg = ensureWB(n);
    const col = boardCols(pg)[0];
    const vr = viewEl() && viewEl().getBoundingClientRect();
    const pos = at || (vr ? freeSpot(CARD_W, 200) : [80, 80]);
    pushWB();
    const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1, text: '', typed: false, tstrokes: [], strokes: [], titleInk: [], th: TITLE_H2, unit: 1, bx: Math.max(20, pos[0]), by: Math.max(20, pos[1]), bw: CARD_W, bh: TITLE_H2 + 154 + 2, h: 200, done: false, due: null, repeat: '', notified: false, createdAt: Date.now(), attach: { images: [], links: [] } };
    pg.tasks.push(t); if (typeof renumber === 'function') renumber(pg, col.id); growWorldToFit(pg); ST.sel = { kind: 'card', id: t.id }; saveWB(); render();
    return t;
  }
  function addTextCard(text, at) {
    const t = addBlankCard(at); if (!t) return null;
    t.text = text; t.typed = true; t.bh = TITLE_H2 + 60 + 2; saveWB(); render();
    return t;
  }

  async function addPhotoFile(file, at, into) {
    if (typeof into === 'string') into = getItem('card', into);
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
    if (into) { im.parent = into.id; im.w = 160; im.h = 120; growToFit(into, im.x + im.w, im.y + im.h); }   // v21es: dropped on a card → inside it
    pg.images.push(im); growWorldToFit(pg); saveWB(); render();
    return im;
  }
  function onDrop(ev) {
    ev.preventDefault();
    const dt = ev.dataTransfer; if (!dt) return;
    const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
    const ce = document.elementsFromPoint(ev.clientX, ev.clientY).find(e => e.classList && e.classList.contains('eo-card') && host().contains(e));
    const into = ce ? getItem('card', ce.dataset.id) : null, bs = ce && bodyScreen(ce), lp = bs ? [Math.max(6, (ev.clientX - bs.x) / bs.k), Math.max(6, (ev.clientY - bs.y) / bs.k)] : null;
    const files = [...(dt.files || [])];
    const img = files.find(f => /^image\//.test(f.type));
    const pdf = files.find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    const text = dt.getData('text/uri-list') || dt.getData('text/plain') || dt.getData('text/html') || '';
    if (img) addPhotoFile(img, into ? lp : [wx, wy], into);
    else if (pdf) importPdfToBoard(pdf, [wx, wy]);
    else { const p = parseUrlTitle(text); if (p) addLink(p.href, p.title, into ? lp : [wx, wy], into); }
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
  function addLink(href, title, at, into) {
    if (typeof into === 'string') into = getItem('card', into);
    const pg = ensureWB();
    const safe = safeLink(href); if (!safe) { toastMsg('That link is not allowed'); return null; }
    const pos = at || freeSpot(260, 72);
    const lk = { id: uid('lk'), href: safe, title: title || hostnameOf(safe) || 'Link', x: pos[0], y: pos[1], w: 260, h: 72 };
    pushWB();
    if (into) { lk.parent = into.id; lk.w = 220; lk.h = 56; growToFit(into, lk.x + lk.w, lk.y + lk.h); }
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

  /* ===================== v21es: open a card / group (sheet) — write in every card, retitle, reorder, drag out ===================== */
  function openCardFull(id) {
    const t = getItem('card', id); if (!t) return;
    ST.full = id; ST.sel = null;
    let wrap = document.getElementById('eoCardWrap');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.id = 'eoCardWrap'; wrap.className = 'eo-modal es-sheet-wrap';
      wrap.addEventListener('pointerdown', onPtrDown);
      wrap.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-act]'); if (!b) return;
        ev.preventDefault(); ev.stopPropagation();
        const a = b.dataset.act;
        if (a === 'close') closeCardFull();
        else if (a === 'back') { const c = getItem('card', ST.full); if (c && c.parent) openCardFull(c.parent); else closeCardFull(); }
        else if (a === 'open') openCardFull(b.dataset.id);
        else if (a === 'menu') openItemMenu(b.dataset.kind || 'card', b.dataset.id, b);
        else if (a === 'status') { cycleStatus(b.dataset.id); }
      });
      document.body.appendChild(wrap);
    }
    renderSheet();
  }
  function renderSheet() {
    const wrap = document.getElementById('eoCardWrap'); if (!wrap) return;
    const pg = ideaPg(), t = ST.full && getItem('card', ST.full);
    if (!pg || !t) { closeCardFull(); return; }
    const kids = kidsOf(pg, t.id), par = t.parent ? byId(pg.tasks, t.parent) : null;
    const lbl = c => esc(cardLabel(c) || 'Card');
    wrap.innerHTML = '<div class="eo-sheet es-sheet" role="dialog" aria-modal="true" aria-label="' + (kids.length ? 'Group' : 'Card') + '">' +
      '<div class="eo-full-tools">' + (par ? '<button type="button" data-act="back" aria-label="Back to ' + lbl(par) + '">‹ ' + lbl(par) + '</button>' : '') +
      '<strong>' + (kids.length ? '▦ Group · ' + kids.length + ' card' + (kids.length === 1 ? '' : 's') : 'Card') + '</strong>' + statusChip(t) +
      '<span class="spacer"></span><button type="button" data-act="menu" data-kind="card" data-id="' + t.id + '" aria-label="Card options">⋯</button><button type="button" data-act="close">Done</button></div>' +
      '<div class="es-sheet-main eo-full-body">' + cardHtml(t, { sheet: true, noFolder: true }) + '</div>' +
      (kids.length ? '<h4 class="es-kids-h">Cards in this group</h4><div class="es-kids" data-kids="' + t.id + '">' +
        kids.map(k => '<div class="es-kid">' + cardHtml(k, { sheet: true }) + '<div class="es-kid-tools"><button type="button" class="eo-icon" data-act="open" data-id="' + k.id + '" aria-label="Open ' + lbl(k) + '">⤢</button><button type="button" class="eo-icon" data-act="menu" data-kind="card" data-id="' + k.id + '" aria-label="Options for ' + lbl(k) + '">⋯</button></div></div>').join('') + '</div>' : '') +
      '<p class="es-hint">Write with Apple Pencil — the top line is the title. Hold a finger on a card, photo or link to drag it into another card, drop it between cards to reorder, or out of this sheet onto the board.</p></div>';
    wrap.querySelectorAll('.eo-card').forEach(el => drawCardEl(el));
    bindItemClicks(wrap);
    fillAssetImgs(wrap);
  }
  function closeCardFull() {
    const wrap = document.getElementById('eoCardWrap'); if (wrap) wrap.remove();
    ST.full = null; render();
  }
  function openCardMenu(id, btn) { return openItemMenu('card', id, btn); }
  function descendants(pg, id, acc) { acc = acc || new Set(); for (const k of kidsOf(pg, id)) { if (acc.has(k.id)) continue; acc.add(k.id); descendants(pg, k.id, acc); } return acc; }
  function moveOut(kind, id) {
    const pg = ideaPg(), it = getItem(kind, id); if (!it || !it.parent) return false;
    const par = byId(pg.tasks, it.parent), top = par ? topAncestor(pg, par) : null;
    pushWB();
    if (kind === 'card') {
      const base = top && top !== it ? top : null;
      it.bx = base ? base.bx + (base.bw || CARD_W) + 28 : 80; it.by = base ? base.by : 80;
      delete it.parent; delete it.cord; if (par) fitFolder(par, pg);
    } else {
      const o = top && !top.parent ? (par === top ? cardOrigin(par) : [top.bx + (top.bw || CARD_W) + 28, top.by]) : [80, 80];
      if (par === top) { it.x = (top.bx + (top.bw || CARD_W) + 28); it.y = o[1] + (it.y || 0); } else { it.x = o[0]; it.y = o[1]; }
      delete it.parent;
    }
    growWorldToFit(pg); saveWB(); render(); toastMsg('Moved out onto the board', 1500);
    return true;
  }
  function ungroup(id) {
    const pg = ideaPg(), t = getItem('card', id); if (!t) return;
    const kids = kidsOf(pg, id); if (!kids.length) return;
    pushWB();
    let y = t.parent ? 80 : t.by;
    const x = t.parent ? 80 : t.bx + (t.bw || CARD_W) + 28;
    for (const k of kids) { k.bx = x; k.by = y; y += (k.bh || defaultCardH(k)) + 20; if (t.parent) k.parent = t.parent; else delete k.parent; delete k.cord; }
    fitFolder(t, pg); if (t.parent) fitFolder(byId(pg.tasks, t.parent), pg);
    growWorldToFit(pg); saveWB(); render(); toastMsg('Cards moved out of the group', 1500);
  }
  function deleteCard(id) {
    const pg = ideaPg(), t = getItem('card', id); if (!t) return;
    const gone = descendants(pg, id); gone.add(id);
    pushWB();
    const par = t.parent ? byId(pg.tasks, t.parent) : null;
    pg.tasks = pg.tasks.filter(x => !gone.has(x.id));
    pg.images = (pg.images || []).filter(im => !gone.has(im.cardId) && !gone.has(im.parent));
    pg.links = (pg.links || []).filter(l => !gone.has(l.parent));
    if (par) fitFolder(par, pg);
    if (ST.full && gone.has(ST.full)) { const w = document.getElementById('eoCardWrap'); if (w) w.remove(); ST.full = par ? par.id : null; if (par) openCardFull(par.id); }
    ST.sel = null; saveWB(); render();
    if (typeof actionToast === 'function') actionToast(gone.size > 1 ? 'Group deleted (' + gone.size + ' cards)' : 'Card deleted', 'Undo', () => { if (typeof bUndo === 'function') bUndo(IPI); }, 6000);
  }
  function openItemMenu(kind, id, btn) {
    const it = getItem(kind, id); if (!it) return;
    const pg = ideaPg();
    const del = () => {
      if (kind === 'card') return deleteCard(id);
      pushWB();
      if (kind === 'img') pg.images = (pg.images || []).filter(im => im.id !== id);
      else pg.links = (pg.links || []).filter(l => l.id !== id);
      ST.sel = null; saveWB(); render();
    };
    const out = it.parent ? [{ label: '↗︎ Move out to the board', fn: () => moveOut(kind, id) }] : [];
    if (kind === 'card') {
      const t = it, kids = kidsOf(pg, id);
      actionSheet(cardLabel(t) || (kids.length ? 'Group' : 'Card'), [
        { label: kids.length ? '▦ Open group (' + kids.length + ')' : '⤢ Open', fn: () => openCardFull(id) },
        ...((t.titleInk || []).length ? [{ label: '✍️ Clear handwritten title', fn: () => { pushWB(); t.titleInk = []; delete t.titleText; saveWB(); render(); } }] : []),
        { label: '⌨︎ Type a title…', fn: () => openPrompt('Card title', 'Title', t.text || '', v => { pushWB(); t.text = v; t.typed = !!v; if (v) t.titleInk = []; saveWB(); render(); }, 'text') },
        ...STATUSES.map(s => ({ label: (statusOf(t) === s.id ? '✓ ' : '') + 'Status: ' + s.title, fn: () => { pushWB(); setStatus(t, s.id); saveWB(); render(); } })),
        ...out,
        ...(kids.length ? [{ label: '▤ Ungroup — move the cards out', fn: () => ungroup(id) }] : []),
        { label: kids.length ? '🗑 Delete group and its ' + descendants(pg, id).size + ' cards' : '🗑 Delete card', danger: true, fn: del }
      ]);
    } else if (kind === 'img') {
      actionSheet(it.pdfId ? 'PDF page' : 'Photo', [
        ...(it.pdfId ? [{ label: '📑 Open the full PDF', fn: () => openPdfViewer(it.pdfId, it.page) }] : []),
        ...out,
        { label: '🗑 Delete', danger: true, fn: del }]);
    } else {
      actionSheet(it.title || 'Link', [
        { label: '↗︎ Open link', fn: () => { const h = safeLink(it.href); if (h) { const a = document.createElement('a'); a.href = h; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click(); } } },
        { label: '✏️ Rename…', fn: () => openPrompt('Link title', 'Title', it.title || '', v => { pushWB(); it.title = v || it.title; saveWB(); render(); }, 'text') },
        ...out,
        { label: '🗑 Delete', danger: true, fn: del }]);
    }
  }
  /* handwritten title → optional text (Ask Grok / aiTranscribe) for search and labels; the ink is what shows */
  const recT = new Map();
  function recognizeTitle(t) {
    try { if (!(typeof aiReady === 'function' && aiReady()) || typeof aiTranscribe !== 'function' || typeof inkToPNG !== 'function') return; } catch (e) { return; }
    clearTimeout(recT.get(t.id));
    recT.set(t.id, setTimeout(async () => {
      try {
        const ink = (t.titleInk || []); if (!ink.length) return;
        const s = String(await aiTranscribe(inkToPNG(ink), { field: 'title' }) || '').trim();
        if (s && !/unreadable/i.test(s)) { t.titleText = s.split('\n')[0].slice(0, 80); saveWB(); }
      } catch (e) {}
    }, 1500));
  }

  async function fillAssetImgs(root) {
    const h = root || host(); if (!h) return;
    const pg = ideaPg(); if (!pg) return;
    for (const el of h.querySelectorAll('.eo-img')) {
      const im = byId(pg.images, el.dataset.id); if (!im) continue;
      const id = im.asset || im.src; if (!id || /^data:|^blob:|^https?:/.test(id)) continue;
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

  function fgHook(name, core) {
    const wrapped = function () {
      const h = window.V21fg && V21fg.hooks && V21fg.hooks[name];
      return h ? h(core, this, arguments) : core.apply(this, arguments);
    };
    wrapped._core = core;
    return wrapped;
  }
  render = fgHook('render', render);
  saveWB = fgHook('saveWB', saveWB);
  liftDrag = fgHook('liftDrag', liftDrag);
  dragMove = fgHook('dragMove', dragMove);
  dragEnd = fgHook('dragEnd', dragEnd);
  dropCancel = fgHook('dropCancel', dropCancel);
  drawInkLayer = fgHook('drawInkLayer', drawInkLayer);
  drawCardEl = fgHook('drawCardEl', drawCardEl);
  paintInk = fgHook('paintInk', paintInk);
  cardHtml = fgHook('cardHtml', cardHtml);
  makeCardFromSel = fgHook('makeCardFromSel', makeCardFromSel);
  addBlankCard = fgHook('addBlankCard', addBlankCard);
  sizeWorld = fgHook('sizeWorld', sizeWorld);
  applyView = fgHook('applyView', applyView);

  window.V21eo = {
    version: 'v21eo', ensureWB, migrate: ensureWB, render, VIEW, ST,
    cardFromInk, makeCardFromSel, addBlankCard, addLink, addPhotoFile, importPdfToBoard,
    openPdfViewer, openCardFull, closeCardFull, setStatus, statusOf, safeLink, parseUrlTitle,
    cardsOf, ideaPg, screenToWorld, autoGrowCard, PDF_CAP, growWorldToFit, cancelLasso,
    HANDLE: 44, MIN_W, MIN_H, HOLD_MS, TITLE_H, deleteSel, finishLasso, openInsertMenu, closeInsertMenu, mountToolbar, addTextCard, openItemMenu,
    rebuilt: 'v21eq', freeSpot, INK, CANVAS_CAP, placeInk, drawInkLayer, isOpen, topSheet, applyView,
    /* v21es */
    wbVersion: WB_VERSION, TITLE_H2, MAX_DEPTH, HOLD_MS_ES: HOLD_MS, migrateV2, kidsOf, loose, folderH, bodyH, fitFolder, depthOf, worldToScreen, clampView,
    moveOut, ungroup, deleteCard, renderSheet, moveSelOut, cardOrigin, canDropCardIn, recognizeTitle, lassoHas, placePieces, pieceSet, cardHtml, drawCardEl, paintInk, saveWB, liftDrag, dragMove, dragEnd, dropCancel, sizeWorld, syncMount, bindBoard, bindItemClicks, emptyHint, fillAssetImgs, flushRender, growWorldAt, checkInkRegion, ghostLayer, dropTargetAt, bodyScreen, srcScreen, worldEl, viewEl, host, CARD_W, TITLE_H2
  };
})();
