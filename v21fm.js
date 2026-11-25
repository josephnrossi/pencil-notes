/* Pencil Notes v21fm — Idea Board redesign: an open Pencil canvas.
   Write anywhere (no card required). Sticky notes, lasso → Make note, connector
   arrows, labeled frames, pinch-zoom, two-finger pan, mini-map, fit-to-screen,
   and a short toolbar (Pen, Eraser, Lasso, Note, Arrow, Frame + overflow).
   Performance: no page/canvas rebuilds, no reflow, and no IndexedDB saves during
   a stroke. Ink rendering is never skipped (that is what broke erasing in v21fk).
   Saves are debounced after pointerup. Incremental live-layer drawing, viewport
   culling, and a cached bitmap per note. Existing Idea Board cards migrate into
   notes (titles, ink, positions) non-destructively; a snapshot of the old store
   is kept on the note. IndexedDB is never opened for deletion and no store is
   removed. Resin Board and Sales Leads stay hidden. */
(() => {
  'use strict';
  const VERSION = 'v21fm';
  // v21fn: extension hooks (media cards, insert button) live in v21fn.js
  const EXT = window.V21fmExt || (window.V21fmExt = {});
  const isMedia = n => !!(n && n.kind && n.kind !== 'note' && n.media);
  const NOTE_W = 220, NOTE_H = 170, TILE = 512, HOLD_MS = 280, HOLD_SLOP = 12, SAVE_MS = 220;
  const COLORS = {
    yellow: { fill: '#ffeaa3', edge: '#e2c46a', ink: '#3a2f10' },
    pink:   { fill: '#ffc6d6', edge: '#e89ab0', ink: '#4a2030' },
    blue:   { fill: '#cde6ff', edge: '#8eb8e6', ink: '#1c3350' },
    green:  { fill: '#d4f0c4', edge: '#9ccc84', ink: '#1e3a18' },
    purple: { fill: '#e4d4ff', edge: '#b79ee0', ink: '#2e1d4a' }
  };
  const COLOR_KEYS = ['yellow', 'pink', 'blue', 'green', 'purple'];
  const PEN_COLORS = ['#1d1d1f', '#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c'];
  const PEN_SIZES = [1.6, 2.4, 3.6, 5.4];
  const MAP_W = 132, MAP_H = 100;

  const ST = {
    tool: 'pen', penColor: '#1d1d1f', penWidth: 2.4, noteColor: 'yellow',
    view: { x: 0, y: 0, s: 1 },
    g: null, ptrs: new Map(),
    sel: null, lasso: null, overflow: false,
    stroke: false, resizePending: false
  };
  const caches = { notes: new Map(), tiles: new Map(), dirtyTiles: new Set(), dirtyNotes: new Set() };
  let saveTimer = 0, savePending = null, mounted = false, sceneRaf = 0, liveDirty = false;
  const undo = { stack: [], redo: [], locked: false };
  const stats = { longTasks: 0, midStrokeSaves: 0, midStrokeRebuilds: 0 };

  const host = () => document.getElementById('ibHost');
  const ideaN = () => (typeof ideaNote === 'function' ? ideaNote() : (S.notes || []).find(n => n && n.id === 'ideaboard'));
  const ideaPg = () => { const n = ideaN(); return n && n.pages && n.pages[0] ? n.pages[0] : null; };
  const isIdeasOpen = () => typeof QB !== 'undefined' && QB.open && QB.mode === 'ideas' && !(typeof ibSealed === 'function' && ibSealed());
  const toastMsg = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  const newId = (p) => (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9));
  const strokeActive = () => !!(ST.stroke || (ST.g && /^(ink|erase|lasso)$/.test(ST.g.typ)));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const copy = (o) => JSON.parse(JSON.stringify(o));

  function sbb(s) {
    if (s.bb && s.bb.length === 4) return s.bb;
    const pts = s.points || [];
    if (!pts.length) return (s.bb = [0, 0, 0, 0]);
    let x0 = pts[0][0], y0 = pts[0][1], x1 = x0, y1 = y0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]; if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
    }
    const pad = (s.width || 2) + 2;
    return (s.bb = [x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
  }
  function shiftStroke(s, dx, dy) {
    s.points = (s.points || []).map(p => [p[0] + dx, p[1] + dy, p[2]]);
    if (s.bb) s.bb = [s.bb[0] + dx, s.bb[1] + dy, s.bb[2] + dx, s.bb[3] + dy];
    else sbb(s);
  }
  function hitStroke(s, x, y, r) {
    const b = sbb(s), pad = r + (s.width || 2);
    if (x < b[0] - pad || y < b[1] - pad || x > b[2] + pad || y > b[3] + pad) return false;
    const pts = s.points || [], lim = r + (s.width || 2) / 2;
    if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= lim;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
      const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
      let t = l ? ((x - ax) * dx + (y - ay) * dy) / l : 0;
      t = clamp(t, 0, 1);
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= lim) return true;
    }
    return false;
  }
  function inPoly(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + b[0]) c = !c;
    }
    return c;
  }
  function mapCardColor(c) {
    if (!c) return 'yellow';
    if (COLORS[c]) return c;
    if (c === 'red' || c === 'orange') return 'pink';
    return 'yellow';
  }

  /* ---------- model / migration / backup (non-destructive) ---------- */
  function emptyFm() { return { v: 1, notes: [], arrows: [], frames: [], strokes: [] }; }

  function snapshotOldBoard(pg) {
    if (pg.board && pg.board.preFmBackup) return pg.board.preFmBackup;
    const snap = {
      at: Date.now(),
      v: 'pre-v21fm',
      board: pg.board ? { title: pg.board.title, idea: pg.board.idea, columns: copy(pg.board.columns || []), wb: copy(pg.board.wb || {}), compact: pg.board.compact } : null,
      tasks: copy(pg.tasks || []),
      strokes: copy(pg.strokes || []),
      links: copy(pg.links || []),
      images: (pg.images || []).map(im => ({ id: im.id, x: im.x, y: im.y, w: im.w, h: im.h, kind: im.kind, asset: im.asset, src: typeof im.src === 'string' && im.src.length < 200 ? im.src : undefined, parent: im.parent }))
    };
    pg.board = pg.board || { title: 'Idea Board', idea: true, columns: [] };
    pg.board.preFmBackup = snap;
    return snap;
  }

  function cardWorld(t, byId) {
    if (!t.parent) return { x: t.bx || 0, y: t.by || 0 };
    const p = byId.get(t.parent);
    if (!p) return { x: t.bx || 0, y: t.by || 0 };
    const pp = cardWorld(p, byId);
    return { x: pp.x + (t.bx || 8), y: pp.y + (t.by || 36) };
  }

  function migrate(pg) {
    if (!pg) return emptyFm();
    pg.board = pg.board || { title: 'Idea Board', idea: true, columns: [] };
    if (pg.board.fm && pg.board.fm.v >= 1 && Array.isArray(pg.board.fm.notes)) return pg.board.fm;
    snapshotOldBoard(pg);
    const fm = emptyFm();
    fm.migratedAt = Date.now();
    fm.strokes = copy(pg.strokes || []);
    const tasks = (pg.tasks || []).filter(t => t && t.kind === 'card');
    const byId = new Map(tasks.map(t => [t.id, t]));
    for (const t of tasks) {
      const pos = cardWorld(t, byId);
      const strokes = copy(t.strokes || []);
      const titleInk = copy(t.titleInk || t.tstrokes || []);
      let w = Math.max(140, t.bw || NOTE_W), h = Math.max(110, t.bh || NOTE_H);
      fm.notes.push({
        id: t.id || newId('n'),
        x: pos.x, y: pos.y, w, h,
        color: mapCardColor(t.color),
        title: String(t.text || t.titleText || '').trim(),
        strokes, titleInk,
        fromCard: t.id,
        z: fm.notes.length
      });
    }
    pg.board.fm = fm;
    // Original tasks/strokes/links remain on the page. We only add fm + preFmBackup.
    return fm;
  }

  function model() {
    const pg = ideaPg(); if (!pg) return emptyFm();
    return migrate(pg);
  }

  function scheduleSave() {
    if (strokeActive()) { stats.midStrokeSaves++; return; } // never mid-stroke
    savePending = ideaN();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_MS);
  }
  function flushSave() {
    if (strokeActive()) { scheduleSave(); return; }
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    const n = savePending || ideaN();
    savePending = null;
    if (n && typeof saveNote === 'function') {
      try { saveNote(n, false); } catch (e) { console.warn('v21fm save', e); }
    }
  }

  function pushCmd(cmd) {
    if (undo.locked) return;
    undo.stack.push(cmd);
    if (undo.stack.length > 40) undo.stack.shift();
    undo.redo = [];
    syncUndoBtns();
  }
  // Legacy name used by many call sites: a full snapshot is only taken when idle and cheap
  // enough. Prefer pushCmd for ink/erase/move so a 150-note board does not hitch.
  function pushUndo() {
    if (undo.locked || strokeActive()) return;
    const fm = model();
    pushCmd({ typ: 'snap', snap: { notes: copy(fm.notes), arrows: copy(fm.arrows), frames: copy(fm.frames), strokes: copy(fm.strokes) } });
  }
  function applySnap(s) {
    const fm = model();
    fm.notes = copy(s.notes); fm.arrows = copy(s.arrows); fm.frames = copy(s.frames); fm.strokes = copy(s.strokes);
    caches.notes.clear(); caches.tiles.clear(); caches.dirtyTiles.clear(); caches.dirtyNotes.clear();
    paintAll(); scheduleSave();
  }
  function applyCmd(cmd, dir) {
    const fm = model();
    const back = dir === 'undo';
    if (cmd.typ === 'snap') {
      const cur = { notes: copy(fm.notes), arrows: copy(fm.arrows), frames: copy(fm.frames), strokes: copy(fm.strokes) };
      applySnap(cmd.snap);
      cmd.snap = cur;
      return;
    }
    if (cmd.typ === 'addStroke') {
      if (back) {
        if (cmd.noteId) {
          const n = noteById(cmd.noteId);
          if (n) n.strokes = (n.strokes || []).filter(s => s.id !== cmd.stroke.id);
          invalidateNote(cmd.noteId);
        } else {
          const s = fm.strokes.find(s => s.id === cmd.stroke.id);
          fm.strokes = fm.strokes.filter(s => s.id !== cmd.stroke.id);
          if (s) invalidateStroke(s);
        }
      } else {
        if (cmd.noteId) {
          const n = noteById(cmd.noteId);
          if (n) n.strokes = (n.strokes || []).concat([copy(cmd.stroke)]);
          invalidateNote(cmd.noteId);
        } else {
          fm.strokes.push(copy(cmd.stroke));
          invalidateStroke(cmd.stroke);
        }
      }
      paintAll(); scheduleSave();
      return;
    }
    if (cmd.typ === 'erase') {
      const applyGone = !back;
      if (cmd.free && cmd.free.length) {
        if (applyGone) {
          const ids = new Set(cmd.free.map(s => s.id));
          fm.strokes = fm.strokes.filter(s => !ids.has(s.id));
        } else {
          fm.strokes = fm.strokes.concat(cmd.free.map(copy));
        }
        cmd.free.forEach(invalidateStroke);
      }
      (cmd.notes || []).forEach(ch => {
        const n = noteById(ch.id); if (!n) return;
        if (applyGone) {
          const ids = new Set(ch.gone.map(s => s.id));
          n.strokes = (n.strokes || []).filter(s => !ids.has(s.id));
        } else {
          n.strokes = (n.strokes || []).concat(ch.gone.map(copy));
        }
        invalidateNote(ch.id);
      });
      paintAll(); scheduleSave();
      return;
    }
    if (cmd.typ === 'moveNote') {
      const n = noteById(cmd.id); if (!n) return;
      const p = back ? cmd.from : cmd.to;
      n.x = p.x; n.y = p.y;
      if (cmd.memFrom) memApply(back ? cmd.memFrom : cmd.memTo);
      paintAll(); scheduleSave();
      return;
    }
    if (cmd.typ === 'resizeNote') {
      const n = noteById(cmd.id); if (!n) return;
      const p = back ? cmd.from : cmd.to;
      n.w = p.w; n.h = p.h; invalidateNote(n.id);
      paintAll(); scheduleSave();
      return;
    }
    if (cmd.typ === 'moveFrame') {
      const f = fm.frames.find(x => x.id === cmd.id); if (!f) return;
      const now = back ? cmd.to : cmd.from;
      const dest = back ? cmd.from : cmd.to;
      moveFrame(f, dest.x - now.x, dest.y - now.y);
      paintAll(); scheduleSave();
      return;
    }
  }
  function doUndo() {
    if (!undo.stack.length) return;
    undo.locked = true;
    const cmd = undo.stack.pop();
    applyCmd(cmd, 'undo');
    undo.redo.push(cmd);
    undo.locked = false;
    syncUndoBtns();
  }
  function doRedo() {
    if (!undo.redo.length) return;
    undo.locked = true;
    const cmd = undo.redo.pop();
    applyCmd(cmd, 'redo');
    undo.stack.push(cmd);
    undo.locked = false;
    syncUndoBtns();
  }
  function syncUndoBtns() {
    const u = document.getElementById('fmUndo'); if (u) u.disabled = !undo.stack.length;
    const r = document.querySelector('.fm-redo'); if (r) r.disabled = !undo.redo.length;
  }

  /* ---------- view / hit testing ---------- */
  function stageEl() { return host() && host().querySelector('.fm-stage'); }
  function baseCv() { return host() && host().querySelector('canvas.fm-base'); }
  function liveCv() { return host() && host().querySelector('canvas.fm-live'); }
  function mapCv() { return host() && host().querySelector('.fm-map canvas'); }

  function screenToWorld(cx, cy) {
    const st = stageEl(); if (!st) return [0, 0];
    const r = st.getBoundingClientRect(), v = ST.view;
    return [(cx - r.left) / v.s + v.x, (cy - r.top) / v.s + v.y];
  }
  function worldToScreen(x, y) {
    const st = stageEl(); if (!st) return [0, 0];
    const r = st.getBoundingClientRect(), v = ST.view;
    return [r.left + (x - v.x) * v.s, r.top + (y - v.y) * v.s];
  }
  function viewBox() {
    const st = stageEl(); if (!st) return { x: 0, y: 0, w: 1, h: 1 };
    const v = ST.view;
    return { x: v.x, y: v.y, w: st.clientWidth / v.s, h: st.clientHeight / v.s };
  }
  function vis(x, y, w, h, pad) {
    const b = viewBox(), p = pad || 24;
    return x + w >= b.x - p && y + h >= b.y - p && x <= b.x + b.w + p && y <= b.y + b.h + p;
  }
  function noteAt(x, y) {
    const fm = model();
    for (let i = fm.notes.length - 1; i >= 0; i--) {
      const n = fm.notes[i];
      if (x >= n.x && y >= n.y && x <= n.x + n.w && y <= n.y + n.h) return n;
    }
    return null;
  }
  function frameAt(x, y) {
    const fm = model();
    for (let i = fm.frames.length - 1; i >= 0; i--) {
      const f = fm.frames[i];
      const onHead = x >= f.x && x <= f.x + f.w && y >= f.y - 22 && y <= f.y + 10;
      const onEdge = x >= f.x - 8 && x <= f.x + f.w + 8 && y >= f.y - 8 && y <= f.y + f.h + 8
        && !(x >= f.x + 12 && x <= f.x + f.w - 12 && y >= f.y + 12 && y <= f.y + f.h - 12);
      if (onHead || onEdge) return f;
    }
    return null;
  }
  function arrowAt(x, y) {
    const fm = model();
    for (const a of fm.arrows) {
      const pts = arrowPts(a);
      if (!pts) continue;
      const [x1, y1, x2, y2] = pts;
      const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
      let t = l ? ((x - x1) * dx + (y - y1) * dy) / l : 0;
      t = clamp(t, 0, 1);
      if (Math.hypot(x - x1 - t * dx, y - y1 - t * dy) <= 10 / ST.view.s) return a;
    }
    return null;
  }
  function noteById(id) { return model().notes.find(n => n.id === id); }
  function sidePoint(n, side) {
    if (side === 'l') return [n.x, n.y + n.h / 2];
    if (side === 'r') return [n.x + n.w, n.y + n.h / 2];
    if (side === 't') return [n.x + n.w / 2, n.y];
    return [n.x + n.w / 2, n.y + n.h];
  }
  function bestSides(a, b) {
    const sides = ['l', 'r', 't', 'b'];
    let best = ['r', 'l'], bestD = Infinity;
    for (const sa of sides) for (const sb of sides) {
      const p = sidePoint(a, sa), q = sidePoint(b, sb);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < bestD) { bestD = d; best = [sa, sb]; }
    }
    return best;
  }
  function arrowPts(a) {
    const A = noteById(a.from), B = noteById(a.to);
    if (!A || !B) return null;
    const sa = a.fromSide || bestSides(A, B)[0], sb = a.toSide || bestSides(A, B)[1];
    const p = sidePoint(A, sa), q = sidePoint(B, sb);
    return [p[0], p[1], q[0], q[1]];
  }

  /* ---------- caches ---------- */
  function drawStroke(ctx, s, ox, oy) {
    const pts = s.points; if (!pts || !pts.length) return;
    const x = ox || 0, y = oy || 0;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color || '#1d1d1f';
    ctx.fillStyle = s.color || '#1d1d1f';
    ctx.lineWidth = s.width || 2.2;
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.38 : 1;
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0][0] + x, pts[0][1] + y, (s.width || 2) / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(pts[0][0] + x, pts[0][1] + y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + x, pts[i][1] + y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function paintNoteBmp(n) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let rec = caches.notes.get(n.id);
    const w = Math.max(8, n.w), h = Math.max(8, n.h);
    if (!rec || rec.w !== w || rec.h !== h || rec.dpr !== dpr) {
      rec = { canvas: document.createElement('canvas'), w, h, dpr };
      caches.notes.set(n.id, rec);
    }
    const cv = rec.canvas, pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (isMedia(n) && typeof EXT.paintMedia === 'function') {
      try { EXT.paintMedia(ctx, n, w, h); } catch (err) { console.warn('paintMedia', err); }
      (n.strokes || []).forEach(s => drawStroke(ctx, s, 0, 8));
      rec.y0 = 8;
      return rec;
    }
    const c = COLORS[n.color] || COLORS.yellow;
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8);
    ctx.fillStyle = c.fill; ctx.fill();
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke();
    // folded corner
    ctx.beginPath(); ctx.moveTo(w - 18, 0.5); ctx.lineTo(w - 0.5, 18); ctx.lineTo(w - 0.5, 0.5); ctx.closePath();
    ctx.fillStyle = c.edge; ctx.globalAlpha = .45; ctx.fill(); ctx.globalAlpha = 1;
    if (n.title) {
      ctx.fillStyle = c.ink; ctx.font = '700 14px -apple-system, system-ui, sans-serif';
      ctx.fillText(n.title.slice(0, 28), 10, 20);
    }
    const y0 = n.title || (n.titleInk && n.titleInk.length) ? 28 : 8;
    if (n.titleInk && n.titleInk.length) n.titleInk.forEach(s => drawStroke(ctx, s, 0, 4));
    (n.strokes || []).forEach(s => drawStroke(ctx, s, 0, y0));
    rec.y0 = y0;
    return rec;
  }
  function invalidateNote(id) { caches.dirtyNotes.add(id); caches.notes.delete(id); }
  function tileKey(tx, ty) { return tx + ',' + ty; }
  function tilesForBox(b) {
    const x0 = Math.floor(b[0] / TILE), y0 = Math.floor(b[1] / TILE);
    const x1 = Math.floor(b[2] / TILE), y1 = Math.floor(b[3] / TILE);
    const out = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push([tx, ty]);
    return out;
  }
  function invalidateStroke(s) {
    tilesForBox(sbb(s)).forEach(([tx, ty]) => caches.dirtyTiles.add(tileKey(tx, ty)));
  }
  function paintTile(tx, ty, strokes) {
    const key = tileKey(tx, ty);
    let rec = caches.tiles.get(key);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!rec) { rec = { canvas: document.createElement('canvas'), dpr, tx, ty }; caches.tiles.set(key, rec); }
    const cv = rec.canvas, pw = Math.round(TILE * dpr);
    if (cv.width !== pw || cv.height !== pw || rec.dpr !== dpr) { cv.width = pw; cv.height = pw; rec.dpr = dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, TILE, TILE);
    const ox = -tx * TILE, oy = -ty * TILE;
    const box = [tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE];
    for (const s of strokes) {
      const b = sbb(s);
      if (b[2] < box[0] || b[3] < box[1] || b[0] > box[2] || b[1] > box[3]) continue;
      drawStroke(ctx, s, ox, oy);
    }
    caches.dirtyTiles.delete(key);
    return rec;
  }

  /* ---------- render ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
  }
  function ensureCanvasSize(cv, w, h) {
    // Never resize mid-stroke (that is a rebuild).
    if (strokeActive()) { ST.resizePending = true; return false; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw; cv.height = ph;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      return true;
    }
    return false;
  }
  function paintAll() {
    if (sceneRaf) return;
    sceneRaf = requestAnimationFrame(() => { sceneRaf = 0; paintScene(); paintMap(); });
  }
  function paintScene() {
    const cv = baseCv(), st = stageEl(); if (!cv || !st || !mounted) return;
    const w = st.clientWidth, h = st.clientHeight;
    if (!strokeActive()) ensureCanvasSize(cv, w, h);
    const live = liveCv(); if (live && !strokeActive()) ensureCanvasSize(live, w, h);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = ST.view;
    ctx.save();
    ctx.translate(-v.x * v.s, -v.y * v.s);
    ctx.scale(v.s, v.s);
    const fm = model();
    // frames under notes
    for (const f of fm.frames) {
      if (!vis(f.x, f.y, f.w, f.h, 40)) continue;
      ctx.save();
      roundRect(ctx, f.x, f.y, f.w, f.h, 14);
      ctx.fillStyle = 'rgba(79,70,229,.04)'; ctx.fill();
      ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(79,70,229,.7)'; ctx.lineWidth = 1.6 / v.s; ctx.stroke();
      ctx.setLineDash([]);
      const label = f.label || 'Group';
      ctx.font = '700 ' + (12 / v.s) + 'px -apple-system, system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 16 / v.s;
      const th = 20 / v.s;
      roundRect(ctx, f.x, f.y - th - 4 / v.s, tw, th, 6 / v.s);
      ctx.fillStyle = '#4f46e5'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, f.x + 8 / v.s, f.y - 9 / v.s);
      ctx.restore();
    }
    // free ink tiles
    const vb = viewBox();
    const tx0 = Math.floor(vb.x / TILE) - 1, ty0 = Math.floor(vb.y / TILE) - 1;
    const tx1 = Math.floor((vb.x + vb.w) / TILE) + 1, ty1 = Math.floor((vb.y + vb.h) / TILE) + 1;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = tileKey(tx, ty);
      if (caches.dirtyTiles.has(key) || !caches.tiles.has(key)) paintTile(tx, ty, fm.strokes);
      const rec = caches.tiles.get(key); if (!rec) continue;
      ctx.drawImage(rec.canvas, tx * TILE, ty * TILE, TILE, TILE);
    }
    // notes (cached bitmaps)
    for (const n of fm.notes) {
      if (!vis(n.x, n.y, n.w, n.h, 8)) continue;
      if (caches.dirtyNotes.has(n.id) || !caches.notes.has(n.id)) { paintNoteBmp(n); caches.dirtyNotes.delete(n.id); }
      const rec = caches.notes.get(n.id);
      if (rec) ctx.drawImage(rec.canvas, n.x, n.y, n.w, n.h);
      if (ST.sel && ST.sel.id === n.id && ST.sel.kind === 'note') {
        ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2 / v.s;
        roundRect(ctx, n.x - 3, n.y - 3, n.w + 6, n.h + 6, 10); ctx.stroke();
      }
    }
    // arrows on top
    for (const a of fm.arrows) {
      const pts = arrowPts(a); if (!pts) continue;
      drawArrow(ctx, pts[0], pts[1], pts[2], pts[3], a.color || '#4f46e5', 2.2 / v.s);
    }
    ctx.restore();
    if (!strokeActive()) placeSelChrome();
  }
  /* v21fn: selection bar (Open · Delete) and a corner resize handle for the selected note */
  function placeSelChrome() {
    const hs = host(); if (!hs) return;
    const bar = hs.querySelector('.fm-sel-bar'), hd = hs.querySelector('.fm-resize'), st = stageEl();
    if (!bar || !hd || !st) return;
    const n = ST.sel && ST.sel.kind === 'note' ? noteById(ST.sel.id) : null;
    const busy = ST.g && /^(pinch|moveNote|moveFrame)$/.test(ST.g.typ);
    if (!n || busy) { bar.hidden = true; hd.hidden = true; return; }
    const v = ST.view, sw = st.clientWidth, sh = st.clientHeight;
    const x0 = (n.x - v.x) * v.s, y0 = (n.y - v.y) * v.s, x1 = (n.x + n.w - v.x) * v.s, y1 = (n.y + n.h - v.y) * v.s;
    if (x1 < 0 || y1 < 0 || x0 > sw || y0 > sh) { bar.hidden = true; hd.hidden = true; return; }
    const op = bar.querySelector('[data-sel="open"]');
    if (op) { op.hidden = !isMedia(n); op.textContent = n.kind === 'pdf' ? 'Open PDF' : n.kind === 'link' ? 'Open link' : 'View photo'; }
    bar.hidden = false;
    const bw = bar.offsetWidth || 160, bh = bar.offsetHeight || 40;
    let bx = clamp((x0 + x1) / 2 - bw / 2, 6, Math.max(6, sw - bw - 6));
    let by = y0 - bh - 10; if (by < 60) by = Math.min(sh - bh - 6, y1 + 10);
    bar.style.transform = 'translate(' + Math.round(bx) + 'px,' + Math.round(by) + 'px)';
    hd.hidden = false;
    hd.style.transform = 'translate(' + Math.round(x1 - 18) + 'px,' + Math.round(y1 - 18) + 'px)';
  }
  function deleteNote(id) {
    const fm = model(), n = noteById(id); if (!n) return false;
    pushUndo();
    fm.notes = fm.notes.filter(x => x.id !== id);
    fm.arrows = fm.arrows.filter(a => a.from !== id && a.to !== id);
    for (const f of fm.frames) if (f.members) f.members = f.members.filter(m => m !== id);
    caches.notes.delete(id); caches.dirtyNotes.delete(id);
    if (ST.sel && ST.sel.id === id) ST.sel = null;
    paintAll(); scheduleSave();
    const label = isMedia(n) ? (n.kind === 'pdf' ? 'PDF' : n.kind === 'link' ? 'Link' : 'Photo') + ' removed' : 'Note removed';
    if (typeof actionToast === 'function') actionToast(label, 'Undo', () => doUndo(), 6000); else toastMsg(label, 2000);
    return true;
  }
  function resizeNote(n, w, h) {
    const minW = isMedia(n) ? 120 : 140, minH = isMedia(n) ? 90 : 110;
    n.w = Math.round(clamp(w, minW, 1600)); n.h = Math.round(clamp(h, minH, 1600));
    invalidateNote(n.id);
  }
  function frameOf(n) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    let best = null;
    for (const f of model().frames) if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) { if (!best || f.w * f.h < best.w * best.h) best = f; }
    return best;
  }
  function memSnap() { return model().frames.map(f => ({ id: f.id, members: (f.members || []).slice() })); }
  function memApply(snap) { if (!snap) return; const fm = model(); for (const m of snap) { const f = fm.frames.find(x => x.id === m.id); if (f) f.members = m.members.slice(); } }
  function updateMembership(n) {   // a note dragged into a frame joins it; dragged out, it leaves
    const fm = model(), target = frameOf(n);
    let changed = false;
    for (const f of fm.frames) {
      const has = (f.members || []).includes(n.id);
      if (f === target && !has) { f.members = (f.members || []).concat([n.id]); changed = true; }
      if (f !== target && has) { f.members = f.members.filter(m => m !== n.id); changed = true; }
    }
    return changed;
  }
  function drawArrow(ctx, x1, y1, x2, y2, color, lw) {
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 4) return;
    const head = 12;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw || 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - Math.cos(ang) * 8, y2 - Math.sin(ang) * 8); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.4) * head, y2 - Math.sin(ang - 0.4) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.4) * head, y2 - Math.sin(ang + 0.4) * head);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function clearLive() {
    const cv = liveCv(); if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
  }
  function liveCtx() {
    const cv = liveCv(); if (!cv) return null;
    const st = stageEl(); if (!st) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  function paintLiveStroke(s, origin) {
    const ctx = liveCtx(); if (!ctx) return;
    const st = stageEl();
    ctx.clearRect(0, 0, st.clientWidth, st.clientHeight);
    const v = ST.view;
    ctx.save();
    ctx.translate(-v.x * v.s, -v.y * v.s);
    ctx.scale(v.s, v.s);
    const ox = origin ? origin[0] : 0, oy = origin ? origin[1] : 0;
    drawStroke(ctx, s, ox, oy);
    ctx.restore();
  }
  function paintLasso(poly, closed) {
    const ctx = liveCtx(); if (!ctx) return;
    const st = stageEl();
    ctx.clearRect(0, 0, st.clientWidth, st.clientHeight);
    if (!poly || poly.length < 2) return;
    const v = ST.view;
    ctx.save();
    ctx.translate(-v.x * v.s, -v.y * v.s);
    ctx.scale(v.s, v.s);
    ctx.setLineDash([8 / v.s, 6 / v.s]);
    ctx.strokeStyle = '#4f46e5'; ctx.fillStyle = 'rgba(79,70,229,.08)'; ctx.lineWidth = 2 / v.s;
    ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    if (closed) ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function worldBounds() {
    const fm = model();
    let x0 = 0, y0 = 0, x1 = 800, y1 = 600;
    const bump = (x, y, w, h) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
    fm.notes.forEach(n => bump(n.x, n.y, n.w, n.h));
    fm.frames.forEach(f => bump(f.x, f.y - 24, f.w, f.h + 24));
    fm.strokes.forEach(s => { const b = sbb(s); bump(b[0], b[1], b[2] - b[0], b[3] - b[1]); });
    if (!fm.notes.length && !fm.strokes.length && !fm.frames.length) return { x: 0, y: 0, w: 1200, h: 900 };
    return { x: x0 - 40, y: y0 - 40, w: (x1 - x0) + 80, h: (y1 - y0) + 80 };
  }
  function paintMap() {
    const cv = mapCv(); if (!cv || !mounted) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(MAP_W * dpr) || cv.height !== Math.round(MAP_H * dpr)) {
      if (strokeActive()) return;
      cv.width = Math.round(MAP_W * dpr); cv.height = Math.round(MAP_H * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, MAP_W, MAP_H);
    const wb = worldBounds(), vb = viewBox();
    const sx = MAP_W / wb.w, sy = MAP_H / wb.h, sc = Math.min(sx, sy);
    const ox = (MAP_W - wb.w * sc) / 2 - wb.x * sc, oy = (MAP_H - wb.h * sc) / 2 - wb.y * sc;
    const fm = model();
    for (const f of fm.frames) {
      ctx.strokeStyle = 'rgba(79,70,229,.5)'; ctx.strokeRect(f.x * sc + ox, f.y * sc + oy, f.w * sc, f.h * sc);
    }
    for (const n of fm.notes) {
      const c = isMedia(n) ? { fill: n.kind === 'photo' ? '#9fb4cc' : n.kind === 'pdf' ? '#e8b4ae' : '#c9c4f2' } : (COLORS[n.color] || COLORS.yellow);
      ctx.fillStyle = c.fill; ctx.fillRect(n.x * sc + ox, n.y * sc + oy, Math.max(2, n.w * sc), Math.max(2, n.h * sc));
    }
    for (const a of fm.arrows) {
      const p = arrowPts(a); if (!p) continue;
      ctx.strokeStyle = '#4f46e5'; ctx.beginPath();
      ctx.moveTo(p[0] * sc + ox, p[1] * sc + oy); ctx.lineTo(p[2] * sc + ox, p[3] * sc + oy); ctx.stroke();
    }
    ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.4;
    ctx.strokeRect(vb.x * sc + ox, vb.y * sc + oy, vb.w * sc, vb.h * sc);
  }
  function fitToScreen() {
    const st = stageEl(); if (!st) return;
    const b = worldBounds();
    const s = clamp(Math.min(st.clientWidth / Math.max(200, b.w), st.clientHeight / Math.max(200, b.h)) * 0.92, 0.2, 2.2);
    ST.view.s = s;
    ST.view.x = b.x - (st.clientWidth / s - b.w) / 2;
    ST.view.y = b.y - (st.clientHeight / s - b.h) / 2;
    paintAll();
  }

  /* ---------- mutations ---------- */
  function addNote(opt) {
    const fm = model();
    const n = {
      id: newId('n'),
      x: opt.x, y: opt.y,
      w: opt.w || NOTE_W, h: opt.h || NOTE_H,
      color: opt.color || ST.noteColor || 'yellow',
      title: opt.title || '',
      strokes: opt.strokes || [],
      titleInk: opt.titleInk || [],
      z: fm.notes.length
    };
    fm.notes.push(n);
    invalidateNote(n.id);
    paintAll(); scheduleSave();
    return n;
  }
  function addArrow(from, to) {
    if (!from || !to || from === to) return null;
    const A = noteById(from), B = noteById(to); if (!A || !B) return null;
    const fm = model();
    if (fm.arrows.some(a => a.from === from && a.to === to)) return fm.arrows.find(a => a.from === from && a.to === to);
    const sides = bestSides(A, B);
    const a = { id: newId('a'), from, to, fromSide: sides[0], toSide: sides[1], color: '#4f46e5' };
    fm.arrows.push(a); paintAll(); scheduleSave(); return a;
  }
  function addFrame(box, label, members) {
    const fm = model();
    const f = { id: newId('f'), x: box.x, y: box.y, w: box.w, h: box.h, label: label || 'Group', members: members || [] };
    if (!f.members.length) {
      f.members = fm.notes.filter(n => n.x + n.w / 2 >= f.x && n.x + n.w / 2 <= f.x + f.w && n.y + n.h / 2 >= f.y && n.y + n.h / 2 <= f.y + f.h).map(n => n.id);
    }
    fm.frames.push(f); paintAll(); scheduleSave(); return f;
  }
  function moveNote(n, dx, dy) {
    n.x += dx; n.y += dy;
  }
  function moveFrame(f, dx, dy) {
    f.x += dx; f.y += dy;
    const fm = model();
    const ids = new Set(f.members || []);
    for (const n of fm.notes) if (ids.has(n.id)) { n.x += dx; n.y += dy; }
  }
  function eraseAtWorld(x, y, bag) {
    const fm = model();
    const r = 10 / ST.view.s;
    const n = noteAt(x, y);
    if (n) {
      const y0 = (n.title || (n.titleInk && n.titleInk.length)) ? 28 : 8;
      const lx = x - n.x, ly = y - n.y - y0;
      const kept = [], gone = [];
      for (const s of (n.strokes || [])) { if (hitStroke(s, lx, ly, r)) gone.push(s); else kept.push(s); }
      if (gone.length) {
        n.strokes = kept;
        if (bag) {
          bag.notes = bag.notes || {};
          const rec = bag.notes[n.id] || (bag.notes[n.id] = { id: n.id, gone: [] });
          rec.gone.push.apply(rec.gone, gone);
        }
        invalidateNote(n.id); paintScene(); paintMap(); return true;
      }
    }
    const kept = [], gone = [];
    for (const s of fm.strokes) { if (hitStroke(s, x, y, r)) gone.push(s); else kept.push(s); }
    if (gone.length) {
      fm.strokes = kept;
      if (bag && bag.free) bag.free.push.apply(bag.free, gone);
      gone.forEach(invalidateStroke);
      gone.forEach(s => tilesForBox(sbb(s)).forEach(([tx, ty]) => paintTile(tx, ty, fm.strokes)));
      paintScene(); paintMap();
      return true;
    }
    return false;
  }

  /* ---------- pointer ---------- */
  function onDown(e) {
    if (!mounted || !isIdeasOpen()) return;
    if (e.target && e.target.closest && e.target.closest('.fm-tools, .fm-overflow, .fm-lasso-menu, .fm-fit, .fm-map, .fm-sel-bar, .fm-resize, .fn-insert-pop')) return;
    const stage = stageEl(); if (!stage) return;
    ST.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, typ: e.pointerType, t: Date.now() });
    if (ST.ptrs.size === 2 && e.pointerType !== 'pen' && !(ST.g && ST.g.typ === 'ink')) {
      startPinch();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const isPen = e.pointerType === 'pen';
    const tool = ST.tool;
    // Pencil never pans — only writes (or uses the chosen ink-like tool).
    if (isPen || (e.pointerType === 'mouse' && (tool === 'pen' || tool === 'eraser' || tool === 'lasso'))) {
      if (tool === 'pen') startInk(e, wx, wy);
      else if (tool === 'eraser') startErase(e, wx, wy);
      else if (tool === 'lasso') startLasso(e, wx, wy);
      else if (tool === 'arrow') startArrow(e, wx, wy);
      else if (tool === 'note') { /* tap on up */ ST.g = { typ: 'noteTap', pid: e.pointerId, x: wx, y: wy }; }
      else if (tool === 'frame') startFrame(e, wx, wy);
      e.preventDefault(); e.stopPropagation();
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    // Finger / mouse (non-ink tools)
    if (tool === 'note') { ST.g = { typ: 'noteTap', pid: e.pointerId, x: wx, y: wy, cx: e.clientX, cy: e.clientY }; return; }
    if (tool === 'arrow') { startArrow(e, wx, wy); return; }
    if (tool === 'frame') { startFrame(e, wx, wy); return; }
    if (tool === 'lasso') { startLasso(e, wx, wy); return; }
    if (tool === 'eraser') { startErase(e, wx, wy); return; }
    const n = noteAt(wx, wy);
    const f = frameAt(wx, wy);
    const a = !n && arrowAt(wx, wy);
    ST.g = {
      typ: 'pending', pid: e.pointerId, x: wx, y: wy, cx: e.clientX, cy: e.clientY, t0: Date.now(),
      note: n, frame: f, arrow: a
    };
    ST.g.timer = setTimeout(() => {
      if (!ST.g || ST.g.typ !== 'pending') return;
      if (ST.g.note) startMoveNote(ST.g.note, ST.g.x, ST.g.y);
      else if (ST.g.frame) startMoveFrame(ST.g.frame, ST.g.x, ST.g.y);
    }, HOLD_MS);
  }
  function startInk(e, wx, wy) {
    ST.stroke = true;
    if (ST.sel) { ST.sel = null; const hs = host(); if (hs) hs.querySelectorAll('.fm-sel-bar, .fm-resize').forEach(x => { x.hidden = true; }); }
    const n = noteAt(wx, wy);
    const y0 = n && (n.title || (n.titleInk && n.titleInk.length)) ? 28 : 8;
    const origin = n ? [n.x, n.y + y0] : [0, 0];
    const lx = wx - origin[0], ly = wy - origin[1];
    const pr = e.pressure || 0.5;
    const s = { id: newId('s'), tool: 'pen', color: ST.penColor, width: ST.penWidth, points: [[+lx.toFixed(1), +ly.toFixed(1), +pr.toFixed(2)]] };
    ST.g = { typ: 'ink', pid: e.pointerId, stroke: s, note: n, origin, last: [wx, wy] };
    paintLiveStroke(s, origin);
  }
  function startErase(e, wx, wy) {
    ST.stroke = true;
    ST.g = { typ: 'erase', pid: e.pointerId, erased: false, free: [], notes: {} };
    if (eraseAtWorld(wx, wy, ST.g)) ST.g.erased = true;
    clearLive();
  }
  function startLasso(e, wx, wy) {
    hideLassoMenu();
    ST.g = { typ: 'lasso', pid: e.pointerId, poly: [[wx, wy]] };
    ST.lasso = null;
    paintLasso(ST.g.poly, false);
  }
  function startArrow(e, wx, wy) {
    const n = noteAt(wx, wy);
    ST.g = { typ: 'arrow', pid: e.pointerId, from: n && n.id, x: wx, y: wy };
  }
  function startFrame(e, wx, wy) {
    ST.g = { typ: 'frame', pid: e.pointerId, x0: wx, y0: wy, x1: wx, y1: wy };
  }
  function startMoveNote(n, wx, wy) {
    ST.g = { typ: 'moveNote', pid: ST.g && ST.g.pid, note: n, lx: wx, ly: wy, from: { x: n.x, y: n.y } };
    ST.sel = { kind: 'note', id: n.id };
    const st = stageEl(); if (st) st.classList.add('fm-grabbing');
  }
  function startMoveFrame(f, wx, wy) {
    ST.g = { typ: 'moveFrame', pid: ST.g && ST.g.pid, frame: f, lx: wx, ly: wy, from: { x: f.x, y: f.y } };
    const st = stageEl(); if (st) st.classList.add('fm-grabbing');
  }
  function startPinch() {
    if (ST.g && ST.g.timer) clearTimeout(ST.g.timer);
    { const hs = host(); if (hs) hs.querySelectorAll('.fm-sel-bar, .fm-resize').forEach(x => { x.hidden = true; }); }
    const pts = [...ST.ptrs.values()];
    if (pts.length < 2) return;
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    ST.g = {
      typ: 'pinch',
      dist: Math.hypot(dx, dy) || 1,
      mid: [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2],
      view: { x: ST.view.x, y: ST.view.y, s: ST.view.s }
    };
    const base = baseCv(), live = liveCv();
    [base, live].forEach(cv => { if (cv) { cv.style.transformOrigin = '0 0'; cv.style.willChange = 'transform'; } });
  }
  function onMove(e) {
    if (!mounted) return;
    if (ST.ptrs.has(e.pointerId)) ST.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, typ: e.pointerType, t: Date.now() });
    const g = ST.g; if (!g) {
      if (ST.ptrs.size === 2) startPinch();
      return;
    }
    if (g.typ === 'pinch') {
      const pts = [...ST.ptrs.values()];
      if (pts.length < 2) return;
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy) || 1;
      const mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
      const scale = clamp(g.view.s * (dist / g.dist), 0.2, 4);
      const st = stageEl(); if (!st) return;
      const r = st.getBoundingClientRect();
      // Keep the world point under the original midpoint stable, then pan by mid delta.
      const wx = (g.mid[0] - r.left) / g.view.s + g.view.x;
      const wy = (g.mid[1] - r.top) / g.view.s + g.view.y;
      ST.view.s = scale;
      ST.view.x = wx - (mid[0] - r.left) / scale;
      ST.view.y = wy - (mid[1] - r.top) / scale;
      // During the gesture, slide/scale the already-painted bitmap — no scene rebuild.
      const k = scale / g.view.s;
      const tx = (g.view.x - ST.view.x) * scale;
      const ty = (g.view.y - ST.view.y) * scale;
      const base = baseCv(), live = liveCv();
      const tf = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')';
      if (base) base.style.transform = tf;
      if (live) live.style.transform = tf;
      e.preventDefault();
      return;
    }
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    if (g.typ === 'pending') {
      if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) > HOLD_SLOP) {
        clearTimeout(g.timer);
        // Finger moved — do not pan with one finger. Cancel.
        ST.g = null;
      }
      return;
    }
    if (g.typ === 'ink') {
      const raw = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      const evs = raw.length ? raw : [e];
      for (const ev of evs) {
        const [x, y] = screenToWorld(ev.clientX, ev.clientY);
        const lx = x - g.origin[0], ly = y - g.origin[1];
        const last = g.stroke.points[g.stroke.points.length - 1];
        if (Math.hypot(lx - last[0], ly - last[1]) < 0.55) continue;
        const pr = ev.pressure || 0.5;
        g.stroke.points.push([+lx.toFixed(1), +ly.toFixed(1), +pr.toFixed(2)]);
      }
      g.stroke.bb = null;
      paintLiveStroke(g.stroke, g.origin);
      e.preventDefault();
      return;
    }
    if (g.typ === 'erase') {
      if (eraseAtWorld(wx, wy, g)) g.erased = true;
      e.preventDefault();
      return;
    }
    if (g.typ === 'lasso') {
      const last = g.poly[g.poly.length - 1];
      if (Math.hypot(wx - last[0], wy - last[1]) >= 2) g.poly.push([wx, wy]);
      paintLasso(g.poly, false);
      e.preventDefault();
      return;
    }
    if (g.typ === 'arrow') {
      const ctx = liveCtx(); const st = stageEl(); if (ctx) {
        ctx.clearRect(0, 0, st.clientWidth, st.clientHeight);
        const v = ST.view;
        ctx.save(); ctx.translate(-v.x * v.s, -v.y * v.s); ctx.scale(v.s, v.s);
        const A = g.from && noteById(g.from);
        const x1 = A ? A.x + A.w / 2 : g.x, y1 = A ? A.y + A.h / 2 : g.y;
        drawArrow(ctx, x1, y1, wx, wy, '#4f46e5', 2.2 / v.s);
        ctx.restore();
      }
      e.preventDefault();
      return;
    }
    if (g.typ === 'frame') {
      g.x1 = wx; g.y1 = wy;
      const ctx = liveCtx(); const st = stageEl(); if (ctx) {
        ctx.clearRect(0, 0, st.clientWidth, st.clientHeight);
        const v = ST.view;
        ctx.save(); ctx.translate(-v.x * v.s, -v.y * v.s); ctx.scale(v.s, v.s);
        const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1), w = Math.abs(g.x1 - g.x0), h = Math.abs(g.y1 - g.y0);
        ctx.setLineDash([8 / v.s, 6 / v.s]); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1.6 / v.s;
        ctx.strokeRect(x, y, w, h); ctx.restore();
      }
      e.preventDefault();
      return;
    }
    if (g.typ === 'resize' && g.note) {
      const n = g.note, dx = (e.clientX - g.cx) / ST.view.s, dy = (e.clientY - g.cy) / ST.view.s;
      if (g.aspect) { const w = g.from.w + Math.max(dx, dy * g.aspect); resizeNote(n, w, w / g.aspect); if (n.w / n.h !== g.aspect) n.h = Math.round(n.w / g.aspect); }
      else resizeNote(n, g.from.w + dx, g.from.h + dy);
      paintAll();
      e.preventDefault();
      return;
    }
    if (g.typ === 'moveNote' && g.note) {
      const dx = wx - g.lx, dy = wy - g.ly;
      moveNote(g.note, dx, dy); g.lx = wx; g.ly = wy;
      paintAll();
      e.preventDefault();
      return;
    }
    if (g.typ === 'moveFrame' && g.frame) {
      const dx = wx - g.lx, dy = wy - g.ly;
      moveFrame(g.frame, dx, dy); g.lx = wx; g.ly = wy;
      paintAll();
      e.preventDefault();
      return;
    }
  }
  function onUp(e) {
    if (!mounted) return;
    ST.ptrs.delete(e.pointerId);
    const g = ST.g;
    if (g && g.timer) clearTimeout(g.timer);
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    if (g && g.typ === 'ink') {
      const s = g.stroke; s.bb = null; sbb(s);
      if (g.note) {
        g.note.strokes = (g.note.strokes || []).concat([s]);
        invalidateNote(g.note.id);
      } else {
        // stroke was in world coords already (origin 0,0)
        model().strokes.push(s);
        invalidateStroke(s);
      }
      pushCmd({ typ: 'addStroke', noteId: g.note && g.note.id, stroke: copy(s) });
      ST.stroke = false; ST.g = null;
      clearLive(); paintAll();
      scheduleSave();
      if (ST.resizePending) { ST.resizePending = false; sizeCanvases(); paintAll(); }
      return;
    }
    if (g && g.typ === 'erase') {
      if (g.erased) {
        const notes = Object.keys(g.notes || {}).map(k => g.notes[k]);
        pushCmd({ typ: 'erase', free: g.free || [], notes });
      }
      ST.stroke = false; ST.g = null;
      clearLive(); paintAll();
      scheduleSave();
      if (ST.resizePending) { ST.resizePending = false; sizeCanvases(); paintAll(); }
      return;
    }
    if (g && g.typ === 'lasso') {
      const poly = g.poly;
      ST.g = null;
      if (poly.length >= 5) finishLasso(poly);
      else { clearLive(); hideLassoMenu(); }
      return;
    }
    if (g && g.typ === 'arrow') {
      const to = noteAt(wx, wy);
      ST.g = null; clearLive();
      if (g.from && to && to.id !== g.from) { pushUndo(); addArrow(g.from, to.id); }
      return;
    }
    if (g && g.typ === 'frame') {
      const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1), w = Math.abs(g.x1 - g.x0), h = Math.abs(g.y1 - g.y0);
      ST.g = null; clearLive();
      if (w > 36 && h > 36) { pushUndo(); addFrame({ x, y, w, h }, 'Group'); }
      return;
    }
    if (g && g.typ === 'noteTap') {
      const moved = Math.hypot((e.clientX || 0) - (g.cx || e.clientX || 0), (e.clientY || 0) - (g.cy || e.clientY || 0));
      ST.g = null;
      if (moved < 8) { pushUndo(); addNote({ x: g.x - NOTE_W / 2, y: g.y - 20, color: ST.noteColor }); }
      return;
    }
    if (g && g.typ === 'moveNote') {
      const st = stageEl(); if (st) st.classList.remove('fm-grabbing');
      if (g.note) {
        const memFrom = memSnap(), changed = updateMembership(g.note);
        pushCmd({ typ: 'moveNote', id: g.note.id, from: g.from, to: { x: g.note.x, y: g.note.y }, memFrom: changed ? memFrom : null, memTo: changed ? memSnap() : null });
      }
      ST.g = null; scheduleSave(); paintAll();
      return;
    }
    if (g && g.typ === 'resize') {
      ST.g = null;
      if (g.note && (g.note.w !== g.from.w || g.note.h !== g.from.h)) pushCmd({ typ: 'resizeNote', id: g.note.id, from: g.from, to: { w: g.note.w, h: g.note.h } });
      scheduleSave(); paintAll();
      return;
    }
    if (g && g.typ === 'moveFrame') {
      const st = stageEl(); if (st) st.classList.remove('fm-grabbing');
      if (g.frame) pushCmd({ typ: 'moveFrame', id: g.frame.id, from: g.from, to: { x: g.frame.x, y: g.frame.y } });
      ST.g = null; scheduleSave(); paintAll();
      return;
    }
    if (g && g.typ === 'pending') {
      const n = g.note, a = g.arrow, f = g.frame;
      ST.g = null;
      if (a && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < 8) {
        pushUndo();
        const fm = model();
        fm.arrows = fm.arrows.filter(x => x.id !== a.id);
        paintAll(); scheduleSave();
        toastMsg('Arrow removed', 1200);
        return;
      }
      const again = n && ST.sel && ST.sel.id === n.id && isMedia(n) && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < 8;
      ST.sel = n ? { kind: 'note', id: n.id } : f ? { kind: 'frame', id: f.id } : null;
      paintAll();
      if (again && typeof EXT.openMedia === 'function') EXT.openMedia(n);
      return;
    }
    if (g && g.typ === 'pinch') {
      if (ST.ptrs.size < 2) {
        ST.g = null;
        const base = baseCv(), live = liveCv();
        [base, live].forEach(cv => { if (cv) { cv.style.transform = ''; cv.style.willChange = ''; } });
        paintAll();
      }
      return;
    }
    if (ST.ptrs.size === 0) ST.g = null;
  }
  function finishLasso(poly) {
    const fm = model();
    const ids = [];
    for (const s of fm.strokes) {
      const b = sbb(s), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      if (inPoly(c, poly) || (s.points || []).some(p => inPoly(p, poly))) ids.push(s.id);
    }
    ST.lasso = { poly, ids };
    paintLasso(poly, true);
    showLassoMenu(poly);
  }
  function lassoToNote() {
    const L = ST.lasso; if (!L || !L.ids.length) { hideLassoMenu(); clearLive(); return; }
    pushUndo();
    const fm = model();
    const take = fm.strokes.filter(s => L.ids.includes(s.id));
    fm.strokes = fm.strokes.filter(s => !L.ids.includes(s.id));
    take.forEach(invalidateStroke);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    take.forEach(s => { const b = sbb(s); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); });
    const pad = 18;
    const nx = x0 - pad, ny = y0 - pad, nw = Math.max(NOTE_W, x1 - x0 + pad * 2), nh = Math.max(120, y1 - y0 + pad * 2);
    const strokes = take.map(s => {
      const c = copy(s); c.points = (c.points || []).map(p => [p[0] - nx, p[1] - ny - 8, p[2]]); c.bb = null; sbb(c); return c;
    });
    addNote({ x: nx, y: ny, w: nw, h: nh, color: ST.noteColor, strokes });
    ST.lasso = null; hideLassoMenu(); clearLive(); paintAll(); scheduleSave();
  }
  function lassoDelete() {
    const L = ST.lasso; if (!L) { hideLassoMenu(); return; }
    pushUndo();
    const fm = model();
    const gone = fm.strokes.filter(s => L.ids.includes(s.id));
    fm.strokes = fm.strokes.filter(s => !L.ids.includes(s.id));
    gone.forEach(invalidateStroke);
    ST.lasso = null; hideLassoMenu(); clearLive(); paintAll(); scheduleSave();
  }
  function lassoStageBox(poly) {
    const stEl = stageEl(); if (!stEl) return { x: 0, y: 0, w: 0, h: 0 };
    const st = stEl.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const bump = (wx, wy) => {
      const [sx, sy] = worldToScreen(wx, wy);
      const x = sx - st.left, y = sy - st.top;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    };
    (poly || []).forEach(p => bump(p[0], p[1]));
    if (ST.lasso && ST.lasso.ids && ST.lasso.ids.length) {
      const fm = model();
      (fm.strokes || []).forEach(s => {
        if (!ST.lasso.ids.includes(s.id)) return;
        const b = sbb(s);
        bump(b[0], b[1]); bump(b[2], b[3]);
      });
    }
    if (!isFinite(x0)) return { x: 8, y: 8, w: 0, h: 0 };
    const pad = 8; // include the dashed selection outline
    return { x: x0 - pad, y: y0 - pad, w: (x1 - x0) + pad * 2, h: (y1 - y0) + pad * 2 };
  }
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function showLassoMenu(poly) {
    const menu = host() && host().querySelector('.fm-lasso-menu'); if (!menu) return;
    const stEl = stageEl(); if (!stEl) return;
    const sw = stEl.clientWidth, sh = stEl.clientHeight;
    const sel = lassoStageBox(poly);
    menu.hidden = false;
    menu.style.left = '0px'; menu.style.top = '0px';
    const mw = menu.offsetWidth || 260, mh = menu.offsetHeight || 48;
    const margin = 8, gap = 12;
    const clampX = (x) => clamp(x, margin, Math.max(margin, sw - mw - margin));
    const clampY = (y) => clamp(y, margin, Math.max(margin, sh - mh - margin));
    const midX = clampX(sel.x + sel.w / 2 - mw / 2);
    const midY = clampY(sel.y + sel.h / 2 - mh / 2);
    const candidates = [
      { left: midX, top: sel.y - gap - mh },           // above, centered
      { left: midX, top: sel.y + sel.h + gap },        // below, centered
      { left: sel.x - gap - mw, top: midY },           // left
      { left: sel.x + sel.w + gap, top: midY }         // right
    ];
    const onScreen = (c) => c.left >= margin && c.top >= margin && c.left + mw <= sw - margin && c.top + mh <= sh - margin;
    const clearOfSel = (c) => !rectsOverlap({ x: c.left, y: c.top, w: mw, h: mh }, sel);
    let pick = candidates.find(c => onScreen(c) && clearOfSel(c));
    if (!pick) {
      // Prefer above/below even if x must be clamped, as long as we stay clear of the selection.
      const fallback = [
        { left: clampX(midX), top: sel.y - gap - mh },
        { left: clampX(midX), top: sel.y + sel.h + gap }
      ];
      pick = fallback.find(c => onScreen(c) && clearOfSel(c));
    }
    if (!pick) {
      // Last resort: clamp to the screen, still preferring the side with more room, and shift
      // horizontally if that would avoid the selection.
      const roomAbove = sel.y - margin;
      const roomBelow = sh - (sel.y + sel.h) - margin;
      let top = roomAbove >= roomBelow ? clampY(sel.y - gap - mh) : clampY(sel.y + sel.h + gap);
      let left = midX;
      const trial = { x: left, y: top, w: mw, h: mh };
      if (rectsOverlap(trial, sel)) {
        if (sel.x - margin >= mw + gap) left = sel.x - gap - mw;
        else if (sw - (sel.x + sel.w) - margin >= mw + gap) left = sel.x + sel.w + gap;
        left = clampX(left);
      }
      pick = { left: clampX(left), top: clampY(top) };
    }
    menu.style.left = Math.round(pick.left) + 'px';
    menu.style.top = Math.round(pick.top) + 'px';
  }
  function hideLassoMenu() {
    const menu = host() && host().querySelector('.fm-lasso-menu');
    if (menu) menu.hidden = true;
  }

  /* ---------- chrome ---------- */
  function icon(name) {
    const p = {
      pen: '<path d="M4 20l1.5-5.5L15 5a2.1 2.1 0 0 1 3 3L9.5 16.5 4 20z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
      eraser: '<path d="M5 15.5L13.5 7l4 4L9 19.5H5v-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
      lasso: '<path d="M6 16c0-5 3-9 8-9 4 0 6 3 6 6 0 2-1 4-3 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="7" cy="17.5" r="1.6" fill="currentColor"/>',
      note: '<rect x="5" y="4" width="13" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h7M8 13h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      arrow: '<path d="M5 16L17 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 6h6v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
      frame: '<rect x="4" y="6" width="15" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2"/>',
      undo: '<path d="M8 11H5l4-5M5 11c2 5 12 6 14 1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
      more: '<circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="11.5" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="12" r="1.5" fill="currentColor"/>',
      insert: '<rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v6M9 12h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      fit: '<path d="M6 9V6h3M16 6h3v3M19 16v3h-3M9 19H6v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (p[name] || '') + '</svg>';
  }
  function setTool(t) {
    ST.tool = t;
    const root = host() && host().querySelector('.fm-root');
    if (root) {
      root.querySelectorAll('.fm-tools .fm-tb[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
      const st = root.querySelector('.fm-stage');
      if (st) st.className = 'fm-stage fm-tool-' + t;
    }
    hideOverflow();
  }
  function toolbarHTML() {
    const tools = [['pen', 'Pen'], ['eraser', 'Eraser'], ['lasso', 'Lasso'], ['note', 'Note'], ['arrow', 'Arrow'], ['frame', 'Frame']];
    return '<div class="fm-tools" role="toolbar" aria-label="Idea Board tools">' +
      tools.map(([k, l]) => '<button type="button" class="fm-tb' + (ST.tool === k ? ' on' : '') + '" data-tool="' + k + '" aria-label="' + l + '" title="' + l + '">' + icon(k) + '<span>' + l + '</span></button>').join('') +
      '<button type="button" class="fm-tb" id="fmInsert" aria-label="Insert photo, PDF or link" title="Insert a photo, PDF or link" aria-haspopup="menu">' + icon('insert') + '<span>Insert</span></button>' +
      '<span class="fm-flex"></span>' +
      '<button type="button" class="fm-tb" id="fmUndo" aria-label="Undo" title="Undo">' + icon('undo') + '<span>Undo</span></button>' +
      '<button type="button" class="fm-tb" id="fmMore" aria-label="More" title="Color, size and Find notes">' + icon('more') + '<span>More</span></button>' +
      '</div>';
  }
  function overflowHTML() {
    return '<div class="fm-overflow" hidden>' +
      '<h3>Pen color</h3><div class="fm-row" id="fmPenColors">' +
      PEN_COLORS.map(c => '<button type="button" class="fm-swatch' + (ST.penColor === c ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Pen ' + c + '"></button>').join('') +
      '</div>' +
      '<h3>Pen size</h3><div class="fm-row" id="fmPenSizes">' +
      PEN_SIZES.map(s => '<button type="button" class="fm-size' + (ST.penWidth === s ? ' on' : '') + '" data-w="' + s + '" aria-label="Size ' + s + '"><i style="width:' + (s * 2 + 2) + 'px;height:' + (s * 2 + 2) + 'px"></i></button>').join('') +
      '</div>' +
      '<h3>Note color</h3><div class="fm-row" id="fmNoteColors">' +
      COLOR_KEYS.map(k => '<button type="button" class="fm-ncolor' + (ST.noteColor === k ? ' on' : '') + '" data-n="' + k + '" style="background:' + COLORS[k].fill + '" aria-label="' + k + ' note"></button>').join('') +
      '</div>' +
      '<h3>Find notes</h3>' +
      '<input type="search" id="fmFind" placeholder="Find notes…" aria-label="Find notes">' +
      '<div class="fm-hits" id="fmHits"></div>' +
      '<div class="fm-actions"><button type="button" class="fm-redo" aria-label="Redo">Redo</button>' +
      '<button type="button" data-act="fit">Fit to screen</button></div></div>';
  }
  function mountDOM() {
    const h = host(); if (!h) return;
    h.hidden = false;
    h.innerHTML = '<div class="fm-root">' + toolbarHTML() +
      '<div class="fm-stage fm-tool-' + ST.tool + '">' +
      '<canvas class="fm-base"></canvas><canvas class="fm-live"></canvas>' +
      '<div class="fm-lasso-menu" hidden>' +
      '<button type="button" class="primary" data-lasso="make">Make note</button>' +
      '<button type="button" class="danger" data-lasso="del">Delete</button>' +
      '<button type="button" data-lasso="cancel">Cancel</button></div>' +
      '<div class="fm-sel-bar" role="toolbar" aria-label="Selected note" hidden><button type="button" data-sel="open" hidden>Open</button><button type="button" class="danger" data-sel="del">Delete</button></div>' +
      '<button type="button" class="fm-resize" aria-label="Resize" title="Drag to resize" hidden></button></div>' +
      '<div class="fn-insert-pop" role="menu" hidden>' +
      '<button type="button" role="menuitem" data-ins="photo"><i>📷</i><span>Photo</span><small>Camera or library</small></button>' +
      '<button type="button" role="menuitem" data-ins="pdf"><i>📄</i><span>PDF</span><small>First page as a card</small></button>' +
      '<button type="button" role="menuitem" data-ins="link"><i>🔗</i><span>Link</span><small>Web address card</small></button></div>' +
      '<button type="button" class="fm-fit" aria-label="Fit to screen" title="Fit to screen">' + icon('fit') + '</button>' +
      '<div class="fm-map" aria-label="Board overview"><canvas></canvas></div>' +
      overflowHTML() + '</div>';
    mounted = true;
    bindChrome();
    sizeCanvases();
    bindStage();
  }
  function sizeCanvases() {
    const st = stageEl(), base = baseCv(), live = liveCv();
    if (!st || !base || !live) return;
    if (strokeActive()) { ST.resizePending = true; stats.midStrokeRebuilds++; return; }
    ensureCanvasSize(base, st.clientWidth, st.clientHeight);
    ensureCanvasSize(live, st.clientWidth, st.clientHeight);
  }
  function bindStage() {
    const st = stageEl(); if (!st || st._fmBound) return;
    st._fmBound = true;
    st.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });
    st.addEventListener('wheel', ev => {
      if (!isIdeasOpen()) return;
      ev.preventDefault();
      const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
      const ns = clamp(ST.view.s * (ev.deltaY > 0 ? 0.92 : 1.08), 0.2, 4);
      const r = st.getBoundingClientRect();
      ST.view.s = ns;
      ST.view.x = wx - (ev.clientX - r.left) / ns;
      ST.view.y = wy - (ev.clientY - r.top) / ns;
      paintAll();
    }, { passive: false });
    st.addEventListener('contextmenu', ev => ev.preventDefault());
  }
  function bindChrome() {
    const root = host() && host().querySelector('.fm-root'); if (!root) return;
    root.querySelector('.fm-tools').addEventListener('click', ev => {
      const b = ev.target.closest('[data-tool]');
      if (b) setTool(b.dataset.tool);
    });
    root.querySelector('#fmUndo').addEventListener('click', doUndo);
    root.querySelector('#fmMore').addEventListener('click', () => { hideInsert(); toggleOverflow(); });
    const pop = root.querySelector('.fn-insert-pop');
    root.querySelector('#fmInsert').addEventListener('click', () => { hideOverflow(); pop.hidden = !pop.hidden; root.querySelector('#fmInsert').classList.toggle('on', !pop.hidden); });
    pop.addEventListener('click', ev => { const b = ev.target.closest('[data-ins]'); if (!b) return; hideInsert(); if (typeof EXT.insert === 'function') EXT.insert(b.dataset.ins); });
    const bar = root.querySelector('.fm-sel-bar');
    bar.addEventListener('click', ev => {
      const b = ev.target.closest('[data-sel]'); if (!b || !ST.sel) return;
      const n = noteById(ST.sel.id); if (!n) return;
      if (b.dataset.sel === 'del') deleteNote(n.id);
      else if (b.dataset.sel === 'open' && typeof EXT.openMedia === 'function') EXT.openMedia(n);
    });
    const hd = root.querySelector('.fm-resize');
    hd.addEventListener('pointerdown', ev => {
      const n = ST.sel && noteById(ST.sel.id); if (!n) return;
      ev.preventDefault(); ev.stopPropagation();
      const aspect = isMedia(n) && (n.kind === 'photo' || n.kind === 'pdf') ? n.w / n.h : 0;
      ST.g = { typ: 'resize', pid: ev.pointerId, note: n, cx: ev.clientX, cy: ev.clientY, from: { w: n.w, h: n.h }, aspect };
      bar.hidden = true;
      try { hd.setPointerCapture(ev.pointerId); } catch (_) {}
    });
    root.querySelector('.fm-fit').addEventListener('click', fitToScreen);
    root.querySelector('.fm-lasso-menu').addEventListener('click', ev => {
      const a = ev.target.closest('[data-lasso]'); if (!a) return;
      if (a.dataset.lasso === 'make') lassoToNote();
      else if (a.dataset.lasso === 'del') lassoDelete();
      else { ST.lasso = null; hideLassoMenu(); clearLive(); }
    });
    const ov = root.querySelector('.fm-overflow');
    ov.addEventListener('click', ev => {
      const sw = ev.target.closest('.fm-swatch'); if (sw) { ST.penColor = sw.dataset.c; ov.querySelectorAll('.fm-swatch').forEach(x => x.classList.toggle('on', x === sw)); return; }
      const sz = ev.target.closest('.fm-size'); if (sz) { ST.penWidth = +sz.dataset.w; ov.querySelectorAll('.fm-size').forEach(x => x.classList.toggle('on', x === sz)); return; }
      const nc = ev.target.closest('.fm-ncolor'); if (nc) { ST.noteColor = nc.dataset.n; ov.querySelectorAll('.fm-ncolor').forEach(x => x.classList.toggle('on', x === nc)); return; }
      if (ev.target.closest('[data-act="fit"]')) { fitToScreen(); hideOverflow(); }
      if (ev.target.closest('.fm-redo')) doRedo();
    });
    const find = ov.querySelector('#fmFind');
    find.addEventListener('input', () => renderHits(find.value));
    const ro = new ResizeObserver(() => { if (!strokeActive()) { sizeCanvases(); paintAll(); } else ST.resizePending = true; });
    ro.observe(stageEl());
  }
  function toggleOverflow() {
    const ov = host() && host().querySelector('.fm-overflow'); if (!ov) return;
    ov.hidden = !ov.hidden;
    ST.overflow = !ov.hidden;
    if (!ov.hidden) ov.querySelector('#fmFind').focus();
  }
  function hideInsert() {
    const r = host() && host().querySelector('.fm-root'); if (!r) return;
    const pop = r.querySelector('.fn-insert-pop'); if (pop) pop.hidden = true;
    const b = r.querySelector('#fmInsert'); if (b) b.classList.remove('on');
  }
  function hideOverflow() {
    const ov = host() && host().querySelector('.fm-overflow');
    if (ov) ov.hidden = true;
    ST.overflow = false;
  }
  function renderHits(q) {
    const box = host() && host().querySelector('#fmHits'); if (!box) return;
    const s = String(q || '').trim().toLowerCase();
    if (!s) { box.innerHTML = ''; return; }
    const label = n => (n.title || (n.media && (n.media.title || n.media.name || n.media.domain)) || 'Untitled note');
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const hits = model().notes.filter(n => [n.title, n.media && n.media.title, n.media && n.media.name, n.media && n.media.domain].some(t => (t || '').toLowerCase().includes(s)));
    box.innerHTML = hits.slice(0, 8).map(n => '<button type="button" data-hit="' + n.id + '">' + esc(label(n)) + '</button>').join('') || '<p class="fine">No notes match</p>';
    box.onclick = ev => {
      const b = ev.target.closest('[data-hit]'); if (!b) return;
      const n = noteById(b.dataset.hit); if (!n) return;
      const st = stageEl();
      ST.view.x = n.x - (st.clientWidth / ST.view.s - n.w) / 2;
      ST.view.y = n.y - (st.clientHeight / ST.view.s - n.h) / 2;
      ST.sel = { kind: 'note', id: n.id };
      hideOverflow(); paintAll();
    };
  }

  function slimChrome(on) {
    document.body.classList.toggle('fm-ideas', !!on);
    document.body.classList.toggle('fm-hide-qbundo', !!on);
    if (on && window.V21eo && typeof V21eo.mountToolbar === 'function') {
      try { V21eo.mountToolbar(false); } catch (_) {}
    }
    // Resin / Sales stay hidden (CSS + existing v21fi hooks).
  }

  function openBoard() {
    if (!isIdeasOpen()) return;
    const pg = ideaPg();
    if (pg) migrate(pg);
    if (!mounted || !host() || !host().querySelector('.fm-root')) mountDOM();
    slimChrome(true);
    sizeCanvases();
    paintAll();
    syncUndoBtns();
  }
  function closeBoard() {
    slimChrome(false);
    hideOverflow();
    if (savePending) flushSave();
  }

  /* ---------- hooks ---------- */
  function hookRender() {
    if (!window.V21eo || V21eo.render && V21eo.render._v21fm) return;
    const wrap = (fn) => {
      const w = function () {
        if (isIdeasOpen()) { openBoard(); return; }
        closeBoard();
        if (typeof fn === 'function') return fn.apply(this, arguments);
      };
      w._v21fm = true;
      w._core = w;
      return w;
    };
    if (typeof V21eo.render === 'function') V21eo.render = wrap(V21eo.render);
    else V21eo.render = wrap(function () {});
    if (typeof V21eo.flushRender === 'function') {
      const _fr = V21eo.flushRender;
      V21eo.flushRender = function () { if (isIdeasOpen()) return; return _fr.apply(this, arguments); };
    }
    if (typeof V21eo.syncMount === 'function') {
      const _sm = V21eo.syncMount;
      V21eo.syncMount = function () {
        if (isIdeasOpen()) { try { V21eo.mountToolbar(false); } catch (_) {} return; }
        return _sm.apply(this, arguments);
      };
    }
    if (typeof V21eo.mountToolbar === 'function') {
      const _mt = V21eo.mountToolbar;
      V21eo.mountToolbar = function (on) {
        if (isIdeasOpen()) return _mt.call(this, false);
        return _mt.apply(this, arguments);
      };
    }
  }
  function hookSave() {
    if (typeof saveNote !== 'function' || saveNote._v21fm) return;
    const _sv = saveNote;
    saveNote = function (n, immediate) {
      if (n && n.id === 'ideaboard' && strokeActive()) {
        stats.midStrokeSaves++;
        savePending = n;
        return; // debounce after pointerup; never a synchronous mid-stroke write
      }
      return _sv.apply(this, arguments);
    };
    saveNote._v21fm = true;
    saveNote._orig = _sv;
  }
  function hookQb() {
    if (typeof qbOpen === 'function' && !qbOpen._v21fm) {
      const _qo = qbOpen;
      qbOpen = function (on, opts) {
        const r = _qo.apply(this, arguments);
        if (on && isIdeasOpen()) setTimeout(openBoard, 0);
        if (!on) closeBoard();
        return r;
      };
      qbOpen._v21fm = true;
    }
    if (typeof qbRender === 'function' && !qbRender._v21fm) {
      const _qr = qbRender;
      qbRender = function () {
        const r = _qr.apply(this, arguments);
        if (isIdeasOpen()) openBoard();
        return r;
      };
      qbRender._v21fm = true;
    }
    if (typeof ideaAddCard === 'function' && !ideaAddCard._v21fm) {
      const _ia = ideaAddCard;
      ideaAddCard = function () {
        if (!isIdeasOpen()) return _ia.apply(this, arguments);
        const vb = viewBox();
        pushUndo();
        addNote({ x: vb.x + vb.w / 2 - NOTE_W / 2, y: vb.y + 80, color: ST.noteColor });
      };
      ideaAddCard._v21fm = true;
    }
    const u = document.getElementById('qbUndo');
    if (u && !u._fm) {
      u.addEventListener('click', ev => { if (isIdeasOpen()) { ev.stopImmediatePropagation(); doUndo(); } }, true);
      u._fm = true;
    }
    const rd = document.getElementById('qbRedo');
    if (rd && !rd._fm) {
      rd.addEventListener('click', ev => { if (isIdeasOpen()) { ev.stopImmediatePropagation(); doRedo(); } }, true);
      rd._fm = true;
    }
  }

  /* ---------- test helpers ---------- */
  function seedPerfBoard(nNotes, nArrows) {
    const pg = ideaPg(); if (!pg) return null;
    migrate(pg);
    const fm = model();
    fm.notes = []; fm.arrows = []; fm.frames = []; fm.strokes = [];
    const cols = 15;
    for (let i = 0; i < nNotes; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      fm.notes.push({
        id: 'perf-n' + i, x: 40 + col * 250, y: 40 + row * 210, w: NOTE_W, h: NOTE_H,
        color: COLOR_KEYS[i % 5], title: 'Note ' + (i + 1),
        strokes: [{ id: 'ps' + i, tool: 'pen', color: '#1d1d1f', width: 2, points: [[20, 50, .5], [80, 54, .5], [140, 48, .5]], bb: [20, 46, 140, 58] }],
        titleInk: [], z: i
      });
    }
    const count = Math.min(nArrows, Math.max(0, nNotes - 1));
    for (let i = 0; i < count; i++) {
      const a = fm.notes[i], b = fm.notes[i + 1];
      const sides = bestSides(a, b);
      fm.arrows.push({ id: 'perf-a' + i, from: a.id, to: b.id, fromSide: sides[0], toSide: sides[1], color: '#4f46e5' });
    }
    caches.notes.clear(); caches.tiles.clear();
    paintAll();
    return { notes: fm.notes.length, arrows: fm.arrows.length };
  }

  function boot() {
    hookRender(); hookSave(); hookQb();
    if (isIdeasOpen()) openBoard();
  }
  if (window.__ready) boot();
  else {
    const t0 = Date.now();
    const iv = setInterval(() => { if (window.__ready || Date.now() - t0 > 12000) { clearInterval(iv); boot(); } }, 40);
  }

  window.V21fm = {
    version: VERSION, isOpen: isIdeasOpen, open: openBoard, migrate, model, view: () => ST.view,
    setTool, tool: () => ST.tool, strokeActive, addNote, addArrow, addFrame, fit: fitToScreen,
    scheduleSave, flushSave, undo: doUndo, redo: doRedo, paintAll, paintScene,
    screenToWorld, worldToScreen, seedPerfBoard, ST, COLORS, COLOR_KEYS, stats,
    find: (q) => { const ov = host() && host().querySelector('.fm-overflow'); if (ov) { ov.hidden = false; const i = ov.querySelector('#fmFind'); i.value = q; renderHits(q); } },
    setNoteColor: (c) => { ST.noteColor = c; },
    setPen: (c, w) => { if (c) ST.penColor = c; if (w) ST.penWidth = w; },
    lassoToNote, hideOverflow, toggleOverflow, snapshotOldBoard, showLassoMenu,
    clearCaches: () => { caches.notes.clear(); caches.tiles.clear(); caches.dirtyTiles.clear(); caches.dirtyNotes.clear(); },
    stageEl, baseCv, liveCv,
    // v21fn
    EXT, isMedia, invalidateNote, pushUndo, pushCmd, noteById, noteAt, viewBox, deleteNote, resizeNote, frameOf,
    select: (id) => { ST.sel = id ? { kind: 'note', id } : null; paintAll(); }, hideInsert, placeSelChrome
  };
})();
