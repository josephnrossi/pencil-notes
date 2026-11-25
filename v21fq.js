/* Pencil Notes v21fq — Title / Decision on Pros / Cons frames.
   A title band sits above the green and red columns. Apple Pencil writes on it
   (no handwriting recognition / OCR). A finger tap lets you type instead.
   The band moves and resizes with the frame. Make note uses the title as the
   note heading (typed text, or the ink as an image). Existing Pros / Cons
   frames gain the band without moving their notes. Hooks run on pointer
   down/up only — nothing mid-stroke. Resin Board and Sales Leads stay hidden. */
(function () {
  'use strict';
  const VERSION = 'v21fq';
  const FM = () => window.V21fm;
  const FN = () => window.V21fn;
  const FO = () => window.V21fo;
  const EXT = window.V21fmExt || (window.V21fmExt = {});
  const FONT = '-apple-system, system-ui, sans-serif';
  const TITLE_H = 72;          // caption + write well above the columns
  const COL_HEAD = 54;         // original column-header band (unchanged)
  const NW = 230, NH = 150;
  const PLACE = 'What are you deciding?';
  const CAP = 'Title / Decision';
  const COLCOL = { green: { ink: '#15803d', fill: '#dcfce7', edge: '#86efac' }, pink: { ink: '#b91c1c', fill: '#fee2e2', edge: '#fca5a5' } };
  const newId = p => (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9));
  const say = (m, ms) => { try { toast(m, ms || 2400); } catch (_) {} };
  const sayAct = (m, label, fn, ms) => { try { if (typeof actionToast === 'function') return actionToast(m, label, fn, ms || 5000); } catch (_) {} say(m, ms); };
  const toBlob = (c, type, q) => new Promise(r => c.toBlob(r, type || 'image/png', q || 0.92));

  const ENTRY = { v: VERSION, d: 'Nov 2026', items: [
    'Pros / Cons: a Title / Decision line sits above the columns. Write it with Apple Pencil, or tap to type.',
    'Make note uses that title as the heading of the new note. Existing Pros / Cons frames get the title line without losing anything.'
  ] };
  function addChangelog() { const fn = FN(); if (fn && Array.isArray(fn.CHANGELOG) && !fn.CHANGELOG.some(c => c.v === VERSION)) fn.CHANGELOG.unshift(ENTRY); }
  addChangelog();

  function isPros(f) { return !!(f && f.cols && f.cols.length === 2); }
  // Caption sits above a write well. The well starts below the 12px edge-hit strip so Pencil
  // can write and a finger tap is not treated as grabbing the frame.
  function titleRect(f) { return { x: f.x + 12, y: f.y + 24, w: Math.max(80, f.w - 24), h: 40 }; }
  function inRect(r, x, y, pad) { pad = pad || 0; return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad; }
  function hasTitle(f) { return !!(f && (String(f.title || '').trim() || (f.titleInk && f.titleInk.length))); }

  // Existing frames grow upward so notes, arrows and column contents keep their world positions.
  function ensureTitle(f) {
    if (!isPros(f) || f.titleBand) return f;
    f.y = Math.round(f.y - TITLE_H);
    f.h = Math.round(f.h + TITLE_H);
    f.titleBand = 1;
    f.titleInk = f.titleInk || [];
    if (f.title == null) f.title = '';
    const fm = FM(); if (fm && fm.scheduleSave && !(fm.strokeActive && fm.strokeActive())) fm.scheduleSave();
    return f;
  }
  function migrateOpen() {
    const fm = FM(); if (!fm || !fm.isOpen || !fm.isOpen()) return 0;
    if (fm.strokeActive && fm.strokeActive()) return 0;
    let n = 0;
    for (const f of fm.model().frames) if (isPros(f) && !f.titleBand) { ensureTitle(f); n++; }
    return n;
  }

  /* ---- painting (replaces v21fo's frame extras so columns sit below the title) ---- */
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawTitleWell(ctx, f, s, clip) {
    const r = titleRect(f);
    ctx.save();
    rr(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fillStyle = '#fbfaf6'; ctx.fill();
    ctx.strokeStyle = '#ddd8cc'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#8a8680';
    ctx.font = '700 11px ' + FONT;
    ctx.fillText(CAP, r.x + 2, r.y - 6);
    if (clip) { rr(ctx, r.x, r.y, r.w, r.h, 10); ctx.clip(); }
    const typed = String(f.title || '').trim();
    if (typed) {
      ctx.fillStyle = '#1d1d1f';
      ctx.font = '650 20px ' + FONT;
      let t = typed;
      while (t.length > 1 && ctx.measureText(t + '…').width > r.w - 24) t = t.slice(0, -1);
      if (t !== typed) t += '…';
      ctx.fillText(t, r.x + 12, r.y + 27);
    } else if (!(f.titleInk && f.titleInk.length)) {
      ctx.fillStyle = '#b0aea6';
      ctx.font = 'italic 500 18px ' + FONT;
      ctx.fillText(PLACE, r.x + 12, r.y + 27);
    }
    const draw = FM() && FM().drawStroke;
    if (draw && f.titleInk) f.titleInk.forEach(st => draw(ctx, st, f.x, f.y));
    ctx.restore();
  }
  EXT.paintFrameExtra = function (ctx, f, s, o) {
    const hits = [];
    if (isPros(f)) ensureTitle(f);
    if (f.noteId && (S.notes || []).some(n => n.id === f.noteId)) {
      const t = '↗ Open note', lw = ctx.measureText(t).width + 16 / s, lx = f.x + o.tw + 6 / s, ly = f.y - o.th - 4 / s;
      o.roundRect(ctx, lx, ly, lw, o.th, 6 / s);
      ctx.fillStyle = '#eef2ff'; ctx.fill(); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1 / s; ctx.stroke();
      ctx.fillStyle = '#4338ca'; ctx.fillText(t, lx + 8 / s, f.y - 9 / s);
      hits.push({ x: lx, y: ly, w: lw, h: o.th, act: 'opennote' });
    }
    if (!isPros(f)) return hits;
    drawTitleWell(ctx, f, s, true);
    const top = TITLE_H; // columns start below the title band
    const cw = f.w / 2;
    ctx.save();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(79,70,229,.35)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(f.x + cw, f.y + top + 12); ctx.lineTo(f.x + cw, f.y + f.h - 12); ctx.stroke(); ctx.setLineDash([]);
    f.cols.forEach((c, i) => {
      const cc = COLCOL[c.color] || COLCOL.green, x0 = f.x + i * cw;
      o.roundRect(ctx, x0 + 14, f.y + top + 12, cw - 28, 34, 9); ctx.fillStyle = cc.fill; ctx.fill(); ctx.strokeStyle = cc.edge; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = cc.ink; ctx.font = '800 17px ' + FONT; ctx.fillText((i ? '−  ' : '+  ') + c.label, x0 + 28, f.y + top + 35);
      const bt = '+ note'; ctx.font = '700 13px ' + FONT; const bw = ctx.measureText(bt).width + 22, bx = x0 + cw - 22 - bw, by = f.y + top + 17;
      o.roundRect(ctx, bx, by, bw, 24, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = cc.edge; ctx.stroke();
      ctx.fillStyle = cc.ink; ctx.fillText(bt, bx + 11, by + 16.5);
      hits.push({ x: bx, y: by, w: bw, h: 24, act: 'add:' + i });
    });
    ctx.restore();
    return hits;
  };

  /* ---- ink / erase / tap (down or up only) ---- */
  EXT.inkTarget = function (wx, wy) {
    const fm = FM(); if (!fm) return null;
    const frames = fm.model().frames;
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]; if (!isPros(f)) continue;
      ensureTitle(f);
      if (inRect(titleRect(f), wx, wy, 2)) return { frame: f, origin: [f.x, f.y] };
    }
    return null;
  };
  EXT.eraseAt = function (x, y, r, bag, api) {
    const hit = api && api.hitStroke; if (!hit) return false;
    const t = EXT.inkTarget(x, y); if (!t) return false;
    const f = t.frame, ox = f.x, oy = f.y;
    const kept = [], gone = [];
    for (const s of (f.titleInk || [])) { if (hit(s, x - ox, y - oy, r)) gone.push(s); else kept.push(s); }
    if (!gone.length) return false;
    f.titleInk = kept;
    if (bag) {
      bag.frames = bag.frames || {};
      const rec = bag.frames[f.id] || (bag.frames[f.id] = { id: f.id, gone: [] });
      rec.gone.push.apply(rec.gone, gone);
    }
    const fm = FM(); if (fm) { fm.paintAll(); }
    return true;
  };
  EXT.tapAt = function (wx, wy) {
    const t = EXT.inkTarget(wx, wy); if (!t) return false;
    openType(t.frame);
    return true;
  };

  /* ---- tap-to-type (secondary; Pencil is the primary way to title) ---- */
  let typeEl = null, typeFrame = null, typeWas = '';
  function typeBox() {
    if (typeEl) return typeEl;
    const wrap = document.createElement('div'); wrap.id = 'fqTitleWrap'; wrap.hidden = true;
    wrap.innerHTML = '<input id="fqTitle" type="text" maxlength="120" autocomplete="off" spellcheck="false" placeholder="' + PLACE + '" aria-label="' + CAP + '">';
    document.body.append(wrap);
    const inp = wrap.querySelector('input');
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); inp.value = typeWas; closeType(false); }
    });
    inp.addEventListener('blur', () => closeType(true));
    typeEl = wrap; return wrap;
  }
  function placeType(f) {
    const fm = FM(), r = titleRect(f), st = fm.worldToScreen(r.x, r.y), st2 = fm.worldToScreen(r.x + r.w, r.y + r.h);
    const x = st[0], y = st[1], w = Math.max(80, st2[0] - st[0]), h = Math.max(32, st2[1] - st[1]);
    const box = typeBox();
    box.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    box.style.width = Math.round(w) + 'px';
    const inp = box.querySelector('input');
    inp.style.height = Math.round(Math.max(36, h)) + 'px';
    inp.style.fontSize = Math.max(16, Math.min(22, 20 * fm.view().s)) + 'px';
  }
  function openType(f) {
    const fm = FM(); if (!fm) return;
    ensureTitle(f);
    typeFrame = f; typeWas = f.title || '';
    const box = typeBox(), inp = box.querySelector('input');
    inp.value = typeWas;
    box.hidden = false;
    placeType(f);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  }
  function closeType(save) {
    const box = typeEl; if (!box || box.hidden) return;
    const f = typeFrame, inp = box.querySelector('input');
    box.hidden = true; typeFrame = null;
    if (!f || !save) return;
    const v = String(inp.value || '').trim();
    if (v === String(f.title || '').trim()) return;
    const fm = FM(); if (fm && fm.pushUndo) fm.pushUndo();
    f.title = v;
    if (fm) { fm.scheduleSave(); fm.paintAll(); }
  }

  /* ---- template + column notes sit below the title ---- */
  function addColNote(f, i, quiet) {
    ensureTitle(f);
    const fm = FM(), c = f.cols[i], cw = f.w / 2, x0 = f.x + i * cw;
    const inCol = (fm.model().notes || []).filter(n => (f.members || []).includes(n.id) && (n.x + n.w / 2 < f.x + f.w / 2 ? 0 : 1) === i);
    const y = inCol.length ? Math.max(...inCol.map(n => n.y + n.h)) + 16 : f.y + TITLE_H + COL_HEAD + 14;
    if (!quiet) fm.pushUndo();
    const n = fm.addNote({ x: Math.round(x0 + (cw - NW) / 2), y: Math.round(y), w: NW, h: NH, color: c.color, title: '' });
    f.members = f.members || []; f.members.push(n.id);
    if (y + NH + 18 > f.y + f.h) f.h = Math.round(y + NH + 18 - f.y);
    if (!quiet) { fm.select(n.id); fm.scheduleSave(); fm.paintAll(); }
    return n;
  }
  function insertProsCons() {
    const fm = FM(); if (!fm || !fm.isOpen()) return null;
    const W = 2 * (NW + 50), H = TITLE_H + COL_HEAD + 14 + 2 * (NH + 16) + 4, vb = fm.viewBox();
    fm.pushUndo();
    const f = fm.addFrame({ x: Math.round(vb.x + vb.w / 2 - W / 2), y: Math.round(vb.y + Math.max(60, vb.h / 2 - H / 2)), w: W, h: H }, 'Pros / Cons', []);
    f.members = []; f.cols = [{ label: 'Pros', color: 'green' }, { label: 'Cons', color: 'pink' }];
    f.titleBand = 1; f.titleInk = []; f.title = '';
    for (let k = 0; k < 2; k++) for (let i = 0; i < 2; i++) addColNote(f, i, true);
    fm.ST.sel = { kind: 'frame', id: f.id };
    fm.scheduleSave(); fm.paintAll();
    sayAct('⚖️ Pros / Cons added — write a title at the top, then the notes', 'Undo', () => fm.undo(), 5000);
    return f;
  }
  const _ins = EXT.insert;
  EXT.insert = function (kind) { if (kind === 'proscons') return insertProsCons(); return _ins ? _ins.apply(this, arguments) : undefined; };
  const _hit = EXT.frameHit;
  EXT.frameHit = function (f, act) {
    if (/^add:\d$/.test(act)) return addColNote(f, +act.slice(4));
    return _hit ? _hit.apply(this, arguments) : undefined;
  };

  /* ---- Make note: title becomes the heading (typed text and/or ink image; no OCR) ---- */
  function decisionTitle(f) { return String(f.title || '').trim(); }
  // Ink-only heading image (no "Title / Decision" chrome, no OCR).
  async function titleImage(f) {
    const ink = f.titleInk || []; if (!ink.length) return null;
    const draw = FM() && FM().drawStroke; if (!draw) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const st of ink) for (const p of st.points || []) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    if (x1 <= x0) return null;
    const pad = 14, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2, k = 2;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
    ink.forEach(st => draw(ctx, st, pad - x0, pad - y0));
    const blob = await toBlob(c, 'image/png');
    return { asset: await Assets.put(blob), w: Math.min(PAGE_W - 160, Math.max(200, w)), h: Math.min(PAGE_W - 160, Math.max(200, w)) * h / w, rawW: w, rawH: h };
  }
  function shiftPage(pg, y0, dy) {
    for (const im of pg.images || []) if (im.y >= y0) im.y += dy;
    for (const t of pg.texts || []) if (t.y >= y0) t.y += dy;
  }
  async function makeNoteFromFrame(f) {
    ensureTitle(f);
    const fo = FO(); if (!fo || !fo.makeNoteFromFrame) return null;
    const typed = decisionTitle(f);
    const prev = f.label;
    if (typed) f.label = typed;
    let note = null;
    try { note = await fo.makeNoteFromFrame(f); } finally { f.label = prev; }
    if (!note) return null;
    if (typed) note.title = typed;
    const pg = note.pages[0], TOP = 96;
    let yAdd = 0;
    if (typed) yAdd += 44;
    const heading = await titleImage(f);
    if (heading) yAdd += heading.h + 12;
    if (yAdd) {
      shiftPage(pg, TOP - 1, yAdd);
      let y = TOP;
      if (typed) {
        pg.texts = pg.texts || [];
        pg.texts.unshift({ id: newId('t'), x: 80, y, text: typed, size: 32, color: null });
        y += 44;
      }
      if (heading) {
        pg.images = pg.images || [];
        pg.images.unshift({ id: newId('im'), asset: heading.asset, x: 80, y, w: heading.w, h: heading.h });
      }
      note.updatedAt = Date.now(); saveNote(note, true);
      try { if (S.cur === note.id) buildPages(); } catch (_) {}
    }
    const fm = FM(); if (fm) fm.paintAll();
    return note;
  }
  const _sel = EXT.selAction;
  EXT.selAction = function (k, t, kind) {
    if (kind === 'frame' && k === 'mknote') {
      makeNoteFromFrame(t).catch(err => { console.warn('v21fq make note', err); say('Could not make the note'); });
      return true;
    }
    return _sel ? _sel.apply(this, arguments) : false;
  };

  function boot() {
    addChangelog();
    migrateOpen();
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && typeEl && !typeEl.hidden) closeType(false); });
    if (typeof qbOpen === 'function' && !qbOpen._fq) {
      const _q = qbOpen;
      qbOpen = function (on) { const r = _q.apply(this, arguments); if (on) setTimeout(migrateOpen, 0); if (!on) closeType(true); return r; };
      qbOpen._fq = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.V21fq = {
    version: VERSION, ENTRY, TITLE_H, PLACE, CAP, titleRect, ensureTitle, migrateOpen, hasTitle,
    insertProsCons, addColNote, makeNoteFromFrame, openType, closeType, decisionTitle, titleImage
  };
})();
