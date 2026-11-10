/* Pencil Notes v21eo — Idea Board becomes a whiteboard (mock only).
   Loads after v21en. Does not delete IndexedDB data. */
(function () {
  'use strict';
  const PDF_CAP = 20;
  const MIN_W = 160, MIN_H = 120, FINGER_SLOP = 20;
  const HEAD = 48, WORLD0_W = 2400, WORLD0_H = 1800, GROW = 800;
  const COL_W = 340, CARD_W = 300, START_X = 64, START_Y = 72, CARD_GAP = 28;
  const STATUSES = [
    { id: 'todo', title: 'To Do' },
    { id: 'doing', title: 'Doing' },
    { id: 'done', title: 'Done' }
  ];
  const VIEW = { x: 24, y: 24, s: 1 };
  const ST = { tool: 'pen', sel: null, g: null, list: false, lastTap: 0, lastTapId: null, ptrs: null, full: null };

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
      saveNote(n, true);
    }
    return pg;
  }
  function defaultCardH(t) {
    const body = (typeof cardH === 'function' ? cardH(t) : 240);
    const k = CARD_W / (typeof INK_W === 'number' ? INK_W : 300);
    return Math.max(200, Math.round(HEAD + body * k));
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
    const pad = 16, hasAtt = !!(attImgs.length || attLinks.length), ATTACH_H = 80;
    const bw = Math.max(MIN_W, hasAtt ? 320 : (sbb[2] - sbb[0]) + pad * 2);
    const bhBody = Math.max(80, strokes.length ? (sbb[3] - sbb[1]) + pad * 2 : 80);
    const body = copyStrokesLocal(strokes, (strokes.length ? sbb[0] : bb0) - pad, (strokes.length ? sbb[1] : bb1) - pad);
    const t = {
      id: uid('t'), kind: 'card', col: col.id, ord: -1, text: src.title || '', typed: !!src.title,
      tstrokes: [], strokes: body, unit: 1, bw, bh: HEAD + bhBody + (hasAtt ? ATTACH_H : 0), bx: 80, by: 80,
      h: bhBody, done: typeof isDoneCol === 'function' && isDoneCol(dpg, col.id),
      due: null, repeat: '', notified: false, createdAt: Date.now(),
      attach: { images: attImgs, links: attLinks }
    };
    if (t.done) t.doneAt = Date.now();
    if (dstPi === IPI || (dstNote && dstNote.id === 'ideaboard')) {
      ensureWB(dstNote);
      t.bx = Math.max(40, bb0 - 8);
      t.by = Math.max(40, bb1 - HEAD - 8);
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
    if (!move && typeof actionToast === 'function' && strokes.length) {
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

  function viewEl() { return host() && host().querySelector('.eo-view'); }
  function worldEl() { return host() && host().querySelector('.eo-world'); }
  function screenToWorld(cx, cy) {
    const v = viewEl(); if (!v) return [0, 0];
    const r = v.getBoundingClientRect();
    return [(cx - r.left - VIEW.x) / VIEW.s, (cy - r.top - VIEW.y) / VIEW.s];
  }
  function applyView() {
    const w = worldEl(); if (!w) return;
    w.style.transform = 'translate(' + VIEW.x + 'px, ' + VIEW.y + 'px) scale(' + VIEW.s + ')';
  }
  function sizeWorld() {
    const pg = ideaPg(); if (!pg) return;
    const w = worldEl(), ink = host() && host().querySelector('canvas.eo-ink'), live = host() && host().querySelector('canvas.eo-live');
    const ww = pg.board.wb.w, hh = pg.board.wb.h;
    if (w) { w.style.width = ww + 'px'; w.style.height = hh + 'px'; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const cv of [ink, live]) {
      if (!cv) continue;
      cv.style.width = ww + 'px'; cv.style.height = hh + 'px';
      const pw = Math.round(ww * dpr), ph = Math.round(hh * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const grid = host() && host().querySelector('.eo-grid');
    if (grid) { grid.style.width = ww + 'px'; grid.style.height = hh + 'px'; }
  }
  function emptyHint() {
    const pg = ideaPg();
    const looseIm = (pg && pg.images || []).some(im => im && !im.hidden && im.kind !== 'pdfsource' && im.kind !== 'cardattach');
    const empty = !cardsOf().length && !(pg && pg.strokes && pg.strokes.length) && !looseIm && !(pg && pg.links && pg.links.length) && !(pg && (pg.pdfs || []).length);
    return empty ? '<div class="eo-empty"><div class="eo-empty-card"><h3>Start the whiteboard</h3><p>Write anywhere with Apple Pencil. Drop a photo or paste a link. Lasso ink to make a card.</p></div></div>' : '';
  }
  function statusChip(t) {
    const st = statusOf(t);
    const label = (STATUSES.find(s => s.id === st) || STATUSES[0]).title;
    return '<button type="button" class="eo-chip ' + st + '" data-act="status" data-id="' + t.id + '">' + label + '</button>';
  }
  function cardHtml(t) {
    const compact = typeof S !== 'undefined' && S && S.ideaCompact;
    return '<div class="eo-card' + (compact ? ' compact' : '') + (t.color ? ' c-' + t.color : '') + (t.done ? ' done' : '') + (ST.sel && ST.sel.kind === 'card' && ST.sel.id === t.id ? ' selected' : '') + '" data-kind="card" data-id="' + t.id + '" style="left:' + t.bx + 'px;top:' + t.by + 'px;width:' + (t.bw || CARD_W) + 'px;height:' + (t.bh || defaultCardH(t)) + 'px">' +
      '<div class="eo-card-head"><span class="eo-card-title">' + esc((t.text || '').trim() || 'Card') + '</span><span class="eo-card-tools">' + statusChip(t) +
      '<button type="button" class="eo-icon" data-act="menu" data-id="' + t.id + '" aria-label="Card menu">···</button></span></div>' +
      '<div class="eo-card-body"><canvas class="eo-card-ink"></canvas></div>' +
      attachHtml(t) +
      (compact ? '<span class="eo-compact-tag">Compact</span>' : '') +
      '<div class="eo-resize" data-act="resize" data-id="' + t.id + '" aria-label="Resize"></div></div>';
  }
  function attachOf(t) {
    return { images: (t && t.attach && t.attach.images) || t.images || [], links: (t && t.attach && t.attach.links) || t.links || [] };
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
    const src = typeof assetUrl === 'function' ? (assetUrl(im.asset || im.src) || '') : (im.src || '');
    const cls = 'eo-img' + (im.pdfId ? ' pdf' : '') + (ST.sel && ST.sel.kind === 'img' && ST.sel.id === im.id ? ' selected' : '');
    return '<div class="' + cls + '" data-kind="img" data-id="' + im.id + '" style="left:' + (im.x || 0) + 'px;top:' + (im.y || 0) + 'px;width:' + (im.w || 280) + 'px;height:' + (im.h || 200) + 'px">' +
      (src ? '<img alt="" src="' + src + '">' : '') +
      (im.pdfId ? '<span class="eo-pdf-badge">PDF p.' + (im.page || 1) + '</span>' : '') +
      '<div class="eo-resize" data-act="resize" data-id="' + im.id + '" aria-label="Resize"></div></div>';
  }
  function linkHtml(lk) {
    const href = safeLink(lk.href);
    const hostn = href ? hostnameOf(href) : '';
    const fav = href ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(hostn) + '&sz=64' : '';
    return '<div class="eo-link' + (ST.sel && ST.sel.kind === 'link' && ST.sel.id === lk.id ? ' selected' : '') + '" data-kind="link" data-id="' + lk.id + '" style="left:' + (lk.x || 0) + 'px;top:' + (lk.y || 0) + 'px;width:' + (lk.w || 260) + 'px;height:' + (lk.h || 72) + 'px">' +
      (fav ? '<img class="eo-fav" alt="" src="' + fav + '" width="28" height="28">' : '') +
      '<div class="eo-lmeta"><div class="eo-ltitle">' + esc(lk.title || hostn || 'Link') + '</div><div class="eo-lhost">' + esc(hostn) + '</div></div></div>';
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
    const t = String(raw || '').trim();
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

  function render() {
    if (!isOpen()) return;
    const h = host(); if (!h) return;
    const pg = ensureWB(); if (!pg) return;
    growWorldToFit(pg);
    const tools = '<div class="eo-t eo-tools">' +
      '<button type="button" class="eo-t eo-tool' + (ST.tool === 'pen' ? ' on' : '') + '" data-tool="pen">Pencil</button>' +
      '<button type="button" class="eo-t eo-tool' + (ST.tool === 'lasso' ? ' on' : '') + '" data-tool="lasso">Lasso</button>' +
      '<button type="button" class="eo-t eo-tool" data-act="photo">Photo</button>' +
      '<button type="button" class="eo-t eo-tool" data-act="link">Link</button>' +
      '<button type="button" class="eo-t eo-tool" data-act="pdf">PDF</button>' +
      '<button type="button" class="eo-t eo-tool" data-act="card">Card</button>' +
      '<button type="button" class="eo-t eo-tool' + (ST.list ? ' on' : '') + '" data-act="list">List</button>' +
      '<button type="button" class="eo-t eo-tool" data-act="close">Close</button></div>';
    const items = ST.list ? '' : (
      (pg.images || []).filter(im => im && im.kind !== 'pdfsource' && !im.hidden).map(imgHtml).join('') +
      (pg.links || []).map(linkHtml).join('') +
      cardsOf().map(cardHtml).join('')
    );
    const list = ST.list ? '<div class="eo-list">' + cardsOf().map(t =>
      '<div class="eo-row" data-id="' + t.id + '">' + statusChip(t) + '<span>' + esc((t.text || '').trim() || 'Card') + '</span></div>'
    ).join('') + '</div>' : '';
    h.innerHTML = tools + '<div class="eo-view">' + emptyHint() + '<div class="eo-world"><div class="eo-grid"></div>' + items +
      '<canvas class="eo-ink"></canvas><canvas class="eo-live"></canvas></div></div>' + list +
      '<input type="file" class="eo-photo-in" accept="image/*" hidden>' +
      '<input type="file" class="eo-pdf-in" accept="application/pdf,.pdf" hidden>';
    sizeWorld(); applyView(); bindBoard(); drawInkLayer(); drawCardInks();
    fillAssetImgs();
    if (typeof storeView === 'function') storeView();
  }
  function drawInkLayer() {
    const cv = host() && host().querySelector('canvas.eo-ink');
    const pg = ideaPg(); if (!cv || !pg) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, pg.board.wb.w, pg.board.wb.h);
    if (typeof drawStroke === 'function') (pg.strokes || []).forEach(s => drawStroke(ctx, s));
  }
  function drawCardInks() {
    const pg = ideaPg(); if (!pg) return;
    host().querySelectorAll('.eo-card').forEach(el => {
      const t = byId(pg.tasks, el.dataset.id); if (!t) return;
      const cv = el.querySelector('canvas.eo-card-ink'); if (!cv) return;
      const body = el.querySelector('.eo-card-body');
      const rw = Math.max(8, body.clientWidth), rh = Math.max(8, body.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(rw * dpr); cv.height = Math.round(rh * dpr);
      cv.style.width = rw + 'px'; cv.style.height = rh + 'px';
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rw, rh);
      const inkW = typeof INK_W === 'number' ? INK_W : 300;
      const scale = t.unit === 1 ? 1 : rw / inkW;
      ctx.save(); ctx.scale(scale, scale);
      if (typeof drawStroke === 'function') (t.strokes || []).forEach(s => drawStroke(ctx, s));
      ctx.restore();
    });
  }

  function bindBoard() {
    const h = host(), view = viewEl(), world = worldEl();
    if (!h || !view) return;
    h.querySelectorAll('.eo-tool[data-tool]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ST.tool = b.dataset.tool; render(); }));
    h.querySelectorAll('.eo-tool[data-act]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); onTool(b.dataset.act); }));
    h.querySelectorAll('[data-act="status"]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); cycleStatus(b.dataset.id); }));
    h.querySelectorAll('[data-act="menu"]').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); openCardMenu(b.dataset.id, b); }));
    const photoIn = h.querySelector('.eo-photo-in'), pdfIn = h.querySelector('.eo-pdf-in');
    if (photoIn) photoIn.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) addPhotoFile(f); });
    if (pdfIn) pdfIn.addEventListener('change', ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) importPdfToBoard(f); });
    world.querySelectorAll('.eo-link').forEach(el => el.addEventListener('click', ev => {
      if (ST.g) return;
      const pg = ideaPg(), lk = byId(pg.links, el.dataset.id);
      const href = lk && safeLink(lk.href); if (!href) return;
      ev.preventDefault(); ev.stopPropagation();
      const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    }));
    world.querySelectorAll('.eo-img.pdf').forEach(el => el.addEventListener('click', ev => {
      if (ST.g) return;
      ev.preventDefault(); ev.stopPropagation();
      const im = byId(ideaPg().images, el.dataset.id);
      if (im && im.pdfId) openPdfViewer(im.pdfId, im.page);
    }));
    world.addEventListener('pointerdown', onPtrDown);
    view.addEventListener('wheel', onWheel, { passive: false });
    view.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    view.addEventListener('drop', onDrop);
  }
  function onTool(act) {
    if (act === 'photo') { const i = host().querySelector('.eo-photo-in'); if (i) i.click(); }
    else if (act === 'pdf') { const i = host().querySelector('.eo-pdf-in'); if (i) i.click(); }
    else if (act === 'link') promptLink();
    else if (act === 'card') addBlankCard();
    else if (act === 'list') { ST.list = !ST.list; render(); }
    else if (act === 'close') { if (typeof qbClose === 'function') qbClose(); }
  }
  function cycleStatus(id) {
    const pg = ideaPg(), t = byId(pg.tasks, id); if (!t) return;
    const order = ['todo', 'doing', 'done'];
    const next = order[(order.indexOf(statusOf(t)) + 1) % 3];
    setStatus(t, next); saveWB(); render();
  }
  function setStatus(t, st) {
    const pg = ideaPg(), col = colForStatus(pg, st);
    t.col = col.id; t.done = st === 'done'; t.doneAt = t.done ? Date.now() : null;
    if (typeof renumber === 'function') renumber(pg, col.id);
  }

  function midOf(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; }
  function isPen(ev) { return ev.pointerType === 'pen' || ev.pointerType === 'mouse'; }
  function handleHit(el, ev, kind) {
    const h = el.querySelector('.eo-resize'); if (!h) return false;
    const r = h.getBoundingClientRect();
    const slop = (ev.pointerType === 'touch' || ev.pointerType === 'finger') ? FINGER_SLOP : 0;
    return ev.clientX >= r.left - slop && ev.clientX <= r.right + slop && ev.clientY >= r.top - slop && ev.clientY <= r.right + slop && ev.clientY <= r.bottom + slop;
  }
  /* tighter: use r.right / r.bottom */
  function onHandle(el, ev) {
    const h = el.querySelector('.eo-resize'); if (!h) return false;
    const r = h.getBoundingClientRect();
    const slop = ev.pointerType === 'touch' ? FINGER_SLOP : 0;
    return ev.clientX >= r.left - slop && ev.clientX <= r.right + slop && ev.clientY >= r.top - slop && ev.clientY <= r.bottom + slop;
  }

  function findTarget(ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-kind]') : null;
    if (!el) return null;
    return { el, kind: el.dataset.kind, id: el.dataset.id, resize: onHandle(el, ev) };
  }

  function onPtrDown(ev) {
    if (ev.button && ev.button !== 0) return;
    const view = viewEl(); if (!view) return;
    if (ev.target.closest && ev.target.closest('.eo-tools,.eo-list,button,a,.eo-lasso-menu,.eo-att-link,.eo-card-attach')) return;
    const now = ev.timeStamp || Date.now();
    const tgt = findTarget(ev);

    if (!isPen(ev) && ev.isPrimary === false) return;
    ST.ptrs = ST.ptrs || new Map();
    ST.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, type: ev.pointerType });
    if (ST.ptrs.size === 2 && ![...ST.ptrs.values()].every(p => p.type === 'pen')) {
      ev.preventDefault();
      const pts = [...ST.ptrs.values()];
      ST.g = { typ: 'pinch', mid: midOf(pts[0], pts[1]), vx: VIEW.x, vy: VIEW.y, vs: VIEW.s };
      try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.target.addEventListener('pointermove', onPtrMove);
      ev.target.addEventListener('pointerup', onPtrUp);
      ev.target.addEventListener('pointercancel', onPtrUp);
      return;
    }
    if (!isPen(ev) && ST.tool !== 'lasso' && !(tgt && (tgt.resize || ev.pointerType === 'touch'))) {
      /* finger pan (or drag item if started on an item) */
    }

    ev.preventDefault();
    try { ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.target.addEventListener('pointermove', onPtrMove);
    ev.target.addEventListener('pointerup', onPtrUp);
    ev.target.addEventListener('pointercancel', onPtrUp);

    const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);

    if (tgt && tgt.resize) {
      const item = getItem(tgt.kind, tgt.id);
      ST.g = { typ: 'resize', kind: tgt.kind, id: tgt.id, sx: ev.clientX, sy: ev.clientY, ow: itemW(item, tgt.kind), oh: itemH(item, tgt.kind) };
      ST.sel = { kind: tgt.kind, id: tgt.id }; return;
    }
    if (ST.tool === 'lasso' || (isPen(ev) && ev.buttons === 32)) {
      ST.g = { typ: 'lasso', pts: [[wx, wy]], evc: ev.target };
      return;
    }
    if (isPen(ev) && ST.tool === 'pen') {
      if (tgt && tgt.kind === 'card' && !tgt.resize) {
        const t = getItem('card', tgt.id);
        const body = tgt.el.querySelector('.eo-card-body');
        const br = body.getBoundingClientRect();
        if (ev.clientY >= br.top && ev.clientX >= br.left) {
          const inkW = typeof INK_W === 'number' ? INK_W : 300;
          const scale = t.unit === 1 ? 1 : (br.width / inkW);
          const lx = (ev.clientX - br.left) / (VIEW.s * scale);
          const ly = (ev.clientY - br.top) / (VIEW.s * scale);
          ST.g = { typ: 'cink', id: t.id, pts: [[+lx.toFixed(2), +ly.toFixed(2), ev.pressure || 0.5]], evc: ev.target, el: tgt.el };
          maybeDouble(tgt, now); return;
        }
      }
      ST.g = { typ: 'ink', pts: [[+wx.toFixed(2), +wy.toFixed(2), ev.pressure || 0.5]], evc: ev.target };
      return;
    }
    if (tgt && (tgt.kind === 'card' || tgt.kind === 'img' || tgt.kind === 'link')) {
      const item = getItem(tgt.kind, tgt.id);
      ST.g = { typ: 'move', kind: tgt.kind, id: tgt.id, sx: ev.clientX, sy: ev.clientY, ox: itemX(item, tgt.kind), oy: itemY(item, tgt.kind) };
      ST.sel = { kind: tgt.kind, id: tgt.id };
      maybeDouble(tgt, now);
      return;
    }
    ST.g = { typ: 'pan', sx: ev.clientX, sy: ev.clientY, vx: VIEW.x, vy: VIEW.y };
  }
  function maybeDouble(tgt, now) {
    if (tgt.kind === 'card' && ST.lastTapId === tgt.id && now - ST.lastTap < 420) {
      ST.g = null; openCardFull(tgt.id);
    }
    ST.lastTap = now; ST.lastTapId = tgt.id;
  }
  function getItem(kind, id) {
    const pg = ideaPg();
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
    if (g.typ === 'pinch' && ST.ptrs && ST.ptrs.size >= 2) {
      const pts = [...ST.ptrs.values()];
      const m = midOf(pts[0], pts[1]);
      const s = g.vs * (m.d / (g.mid.d || 1));
      VIEW.s = Math.max(0.35, Math.min(3, s));
      VIEW.x = g.vx + (m.x - g.mid.x);
      VIEW.y = g.vy + (m.y - g.mid.y);
      applyView(); return;
    }
    if (g.typ === 'pan') {
      VIEW.x = g.vx + (ev.clientX - g.sx); VIEW.y = g.vy + (ev.clientY - g.sy); applyView(); return;
    }
    if (g.typ === 'move') {
      const it = getItem(g.kind, g.id); if (!it) return;
      const dx = (ev.clientX - g.sx) / VIEW.s, dy = (ev.clientY - g.sy) / VIEW.s;
      setItemBox(it, g.kind, Math.max(0, g.ox + dx), Math.max(0, g.oy + dy));
      const el = worldEl().querySelector('[data-kind="' + g.kind + '"][data-id="' + g.id + '"]');
      if (el) { el.style.left = itemX(it, g.kind) + 'px'; el.style.top = itemY(it, g.kind) + 'px'; }
      growWorldAt(itemX(it, g.kind) + itemW(it, g.kind), itemY(it, g.kind) + itemH(it, g.kind));
      return;
    }
    if (g.typ === 'resize') {
      const it = getItem(g.kind, g.id); if (!it) return;
      const dw = (ev.clientX - g.sx) / VIEW.s, dh = (ev.clientY - g.sy) / VIEW.s;
      const w = Math.max(MIN_W, g.ow + dw), h = Math.max(MIN_H, g.oh + dh);
      setItemBox(it, g.kind, null, null, w, h);
      const el = worldEl().querySelector('[data-kind="' + g.kind + '"][data-id="' + g.id + '"]');
      if (el) { el.style.width = w + 'px'; el.style.height = h + 'px'; }
      if (g.kind === 'card') drawCardInks();
      growWorldAt(itemX(it, g.kind) + w, itemY(it, g.kind) + h);
      return;
    }
    const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
    if (g.typ === 'ink') {
      g.pts.push([+wx.toFixed(2), +wy.toFixed(2), ev.pressure || 0.5]);
      drawLive(g.pts, 'ink'); growWorldAt(wx, wy); return;
    }
    if (g.typ === 'cink') {
      const el = g.el, body = el && el.querySelector('.eo-card-body');
      const t = getItem('card', g.id); if (!body || !t) return;
      const br = body.getBoundingClientRect();
      const inkW = typeof INK_W === 'number' ? INK_W : 300;
      const scale = t.unit === 1 ? 1 : (br.width / inkW);
      const lx = (ev.clientX - br.left) / (VIEW.s * scale);
      const ly = (ev.clientY - br.top) / (VIEW.s * scale);
      g.pts.push([+lx.toFixed(2), +ly.toFixed(2), ev.pressure || 0.5]);
      autoGrowCard(t, lx, ly, el);
      drawLiveCard(el, t, g.pts);
      return;
    }
    if (g.typ === 'lasso') {
      g.pts.push([wx, wy]);
      drawLassoLive(g.pts);
    }
  }
  function drawLive(pts, typ) {
    const cv = host() && host().querySelector('canvas.eo-live'); if (!cv) return;
    const ctx = cv.getContext('2d'), pg = ideaPg();
    ctx.clearRect(0, 0, pg.board.wb.w, pg.board.wb.h);
    const s = { tool: typ === 'lasso' ? 'lasso' : (typeof tool === 'string' ? tool : 'pen'), color: typ === 'lasso' ? 'rgba(90,130,220,.9)' : ((typeof S !== 'undefined' && S.penColor) || '#1d1d1f'), width: typ === 'lasso' ? 1.5 : ((typeof S !== 'undefined' && S.penWidth) || 2.2), points: pts };
    if (typeof bbox === 'function') s.bb = bbox(pts);
    if (typ === 'lasso') {
      ctx.save(); ctx.strokeStyle = 'rgba(90,130,220,.95)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.restore();
    } else if (typeof drawStroke === 'function') drawStroke(ctx, s);
  }
  function drawLassoLive(pts) { drawLive(pts, 'lasso'); }
  function drawLiveCard(el, t, pts) {
    const cv = el.querySelector('canvas.eo-card-ink'); if (!cv) return;
    const body = el.querySelector('.eo-card-body');
    const rw = body.clientWidth, rh = body.clientHeight;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rw, rh);
    const inkW = typeof INK_W === 'number' ? INK_W : 300;
    const scale = t.unit === 1 ? 1 : rw / inkW;
    ctx.save(); ctx.scale(scale, scale);
    if (typeof drawStroke === 'function') {
      (t.strokes || []).forEach(s => drawStroke(ctx, s));
      const s = { tool: 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2, points: pts };
      if (typeof bbox === 'function') s.bb = bbox(pts);
      drawStroke(ctx, s);
    }
    ctx.restore();
  }
  function autoGrowCard(t, lx, ly, el) {
    const pad = 28;
    const needW = Math.max(t.bw || CARD_W, Math.ceil(lx + pad + 8));
    const needH = Math.max(t.bh || defaultCardH(t), Math.ceil(HEAD + ly + pad));
    if (needW > (t.bw || 0) || needH > (t.bh || 0)) {
      t.bw = needW; t.bh = needH;
      if (el) { el.style.width = needW + 'px'; el.style.height = needH + 'px'; }
      growWorldAt(t.bx + needW, t.by + needH);
    }
  }
  function onPtrUp(ev) {
    ev.target.removeEventListener('pointermove', onPtrMove);
    ev.target.removeEventListener('pointerup', onPtrUp);
    ev.target.removeEventListener('pointercancel', onPtrUp);
    try { ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (ST.ptrs) ST.ptrs.delete(ev.pointerId);
    const g = ST.g; ST.g = null;
    const live = host() && host().querySelector('canvas.eo-live');
    if (g && g.typ === 'pinch') return;
    if (g && (g.typ === 'pan' || g.typ === 'move' || g.typ === 'resize')) { saveWB(); if (g.typ !== 'pan') render(); return; }
    if (g && g.typ === 'ink' && g.pts.length > 1) {
      const s = { id: uid('s'), tool: typeof tool === 'string' ? tool : 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2, points: g.pts };
      if (typeof bbox === 'function') s.bb = bbox(g.pts);
      const pg = ideaPg(); pg.strokes.push(s); saveWB();
      if (live) live.getContext('2d').clearRect(0, 0, ideaPg().board.wb.w, ideaPg().board.wb.h);
      drawInkLayer();
      const hint = host().querySelector('.eo-empty'); if (hint) hint.remove();
      return;
    }
    if (g && g.typ === 'cink' && g.pts.length > 1) {
      const t = getItem('card', g.id); if (!t) return;
      const s = { id: uid('s'), tool: 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2, points: g.pts };
      if (typeof bbox === 'function') s.bb = bbox(g.pts);
      t.strokes = t.strokes || []; t.strokes.push(s); saveWB(); drawCardInks(); return;
    }
    if (g && g.typ === 'lasso') {
      if (live) live.getContext('2d').clearRect(0, 0, ideaPg().board.wb.w, ideaPg().board.wb.h);
      if (g.pts.length > 4) finishLasso(g.pts);
    }
  }
  function onWheel(ev) {
    ev.preventDefault();
    const v = viewEl(); if (!v) return;
    const r = v.getBoundingClientRect();
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
    if (pts.some(p => polyHit(poly, p[0], p[1]))) return true;
    const bb = st.bb;
    if (bb) return polyHit(poly, (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
    return false;
  }
  function finishLasso(poly) {
    const pg = ideaPg();
    const ids = (pg.strokes || []).filter(s => strokeInLasso(s, poly)).map(s => s.id);
    const images = (pg.images || []).filter(im => im && im.kind !== 'pdfsource' && !im.hidden && polyHit(poly, (im.x || 0) + (im.w || 0) / 2, (im.y || 0) + (im.h || 0) / 2));
    const links = (pg.links || []).filter(lk => polyHit(poly, (lk.x || 0) + (lk.w || 260) / 2, (lk.y || 0) + (lk.h || 72) / 2));
    if (!ids.length && !images.length && !links.length) return;
    ST.selLasso = { ids, images: images.map(i => i.id), links: links.map(l => l.id), poly };
    showLassoMenu(poly);
  }
  function cancelLasso() {
    ST.selLasso = null;
    const m = document.querySelector('.eo-lasso-menu'); if (m) m.remove();
  }
  function showLassoMenu(poly) {
    const old = document.querySelector('.eo-lasso-menu'); if (old) old.remove();
    const bb = strokesBBList(poly.map((p, i) => ({ bb: [p[0], p[1], p[0], p[1]], points: [p] })));
    const v = viewEl(); if (!v) return;
    const r = v.getBoundingClientRect();
    const sx = r.left + VIEW.x + bb[2] * VIEW.s, sy = r.top + VIEW.y + bb[1] * VIEW.s;
    const m = document.createElement('div');
    m.className = 'eo-lasso-menu';
    m.style.left = Math.min(window.innerWidth - 180, Math.max(8, sx)) + 'px';
    m.style.top = Math.max(8, sy - 8) + 'px';
    m.innerHTML = '<button type="button" data-act="make">Make card</button><button type="button" data-act="cancel">Cancel</button>';
    document.body.appendChild(m);
    m.querySelector('[data-act="make"]').onclick = () => { m.remove(); makeCardFromSel(); };
    m.querySelector('[data-act="cancel"]').onclick = () => { m.remove(); ST.selLasso = null; };
  }
  function makeCardFromSel() {
    const sel = ST.selLasso; ST.selLasso = null;
    const m = document.querySelector('.eo-lasso-menu'); if (m) m.remove();
    if (!sel) return;
    const n = ideaN(), pg = ideaPg();
    const imgs = (pg.images || []).filter(i => sel.images.includes(i.id));
    const lks = (pg.links || []).filter(i => sel.links.includes(i.id));
    const t = cardFromInk({ note: n, pi: IPI, ids: sel.ids, images: imgs, links: lks, move: true }, n, IPI, boardCols(pg)[0].id);
    if (t) { ST.sel = { kind: 'card', id: t.id }; render(); toastMsg('Card made'); }
    return t;
  }

  function addBlankCard() {
    const n = ideaN(), pg = ensureWB(n);
    const col = boardCols(pg)[0];
    const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1, text: '', typed: false, tstrokes: [], strokes: [], unit: 1, bx: 80 + VIEW.x * -0 + 40, by: 80, bw: CARD_W, bh: 240, h: 200, done: false, due: null, repeat: '', notified: false, createdAt: Date.now(), attach: { images: [], links: [] } };
    const vis = screenToWorld(200, 200); t.bx = Math.max(40, vis[0]); t.by = Math.max(40, vis[1]);
    pg.tasks.push(t); if (typeof renumber === 'function') renumber(pg, col.id); growWorldToFit(pg); saveWB(); render();
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
    const pos = at || screenToWorld((viewEl().getBoundingClientRect().left + 80), (viewEl().getBoundingClientRect().top + 80));
    const im = { id: uid('im'), x: pos[0], y: pos[1], w: 280, h: 200, src: src, asset: asset || src };
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
    const pos = at || screenToWorld(160, 160);
    const lk = { id: uid('lk'), href: safe, title: title || hostnameOf(safe) || 'Link', x: pos[0], y: pos[1], w: 260, h: 72 };
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
  function openPrompt(title, ph, start, done) {
    let wrap = document.getElementById('eoLinkWrap');
    if (wrap) wrap.remove();
    wrap = document.createElement('div'); wrap.id = 'eoLinkWrap'; wrap.className = 'eo-sheet';
    wrap.innerHTML = '<div class="eo-sheet-card"><h3>' + esc(title) + '</h3><input type="url" class="eo-url" placeholder="' + esc(ph) + '" value="' + esc(start || '') + '"><div class="eo-sheet-actions"><button type="button" data-act="ok">Add</button><button type="button" data-act="cancel">Cancel</button></div></div>';
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
      const rec = { id: uid('pdf'), src: src, name: file.name || 'PDF', pages: total };
      pg.pdfs = pg.pdfs || []; pg.pdfs.push(rec);
      pg.images.push({ id: uid('im'), kind: 'pdfsource', hidden: 1, asset: src, src: src, x: 0, y: 0, w: 0, h: 0, pdfId: rec.id });
      const origin = at || screenToWorld(120, 120);
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
    wrap.querySelector('.eo-title-in').addEventListener('change', ev => { t.text = ev.target.value; t.typed = true; saveWB(); });
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
        const s = { tool: 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2, points: ink.pts };
        if (typeof bbox === 'function') s.bb = bbox(ink.pts);
        drawStroke(ctx, s);
      }
    };
    const up = ev => {
      if (!ink || ink.pts.length < 2) { ink = null; return; }
      const s = { id: uid('s'), tool: 'pen', color: (typeof S !== 'undefined' && S.penColor) || '#1d1d1f', width: (typeof S !== 'undefined' && S.penWidth) || 2.2, points: ink.pts };
      if (typeof bbox === 'function') s.bb = bbox(ink.pts);
      t.strokes = t.strokes || []; t.strokes.push(s); saveWB(); ink = null; paint();
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
  function openCardMenu(id, btn) {
    const t = getItem('card', id); if (!t) return;
    actionSheet((t.text || '').trim() || 'Card', [
      { label: 'Open full size', fn: () => openCardFull(id) },
      { label: 'Cycle status (now ' + (STATUSES.find(s => s.id === statusOf(t)) || STATUSES[0]).title + ')', fn: () => cycleStatus(id) },
      { label: 'Rename…', fn: () => openPrompt('Card title', 'Title', t.text || '', v => { t.text = v; t.typed = true; saveWB(); render(); }) },
      { label: 'Delete card', fn: () => { const pg = ideaPg(); pg.tasks = pg.tasks.filter(x => x.id !== id); pg.images = (pg.images || []).filter(im => im.cardId !== id); saveWB(); render(); } }
    ]);
  }

  const urlCache = new Map();
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
      return r;
    };
  }
  if (typeof qbRender === 'function') {
    const _qr = qbRender;
    qbRender = function () {
      const r = _qr.apply(this, arguments);
      if (isOpen()) render();
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
  }
  document.addEventListener('paste', onPaste);
  document.addEventListener('click', ev => {
    if (ev.target.closest && ev.target.closest('.eo-lasso-menu')) return;
    if (ST.selLasso && ev.target.closest && !ev.target.closest('.eo-lasso-menu')) { /* keep until cancel */ }
  });

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
    HANDLE: 44, MIN_W, MIN_H
  };
})();
