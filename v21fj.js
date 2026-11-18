/* Pencil Notes v21fj — when a line doesn’t fit, auto-create a continuation
   page and flow overflow (including lower sections) onto it, in template order.
   Removes “page is full” blocking toasts/guards. Ink stays with its own lines.
   Empty ink-free continuation pages still collapse. Confirm/undo when removing
   a line that has ink is unchanged. IndexedDB is never opened or deleted. */
(() => {
  'use strict';
  const VERSION = 'v21fj';
  const LIMIT = (typeof PAGE_H === 'number' ? PAGE_H : 1430) - 24;
  const NOTES_BASE = 150, TMR_BASE = 132, NOTES_DEF = 2, TMR_DEF = 2;
  const BLOCKED_TOAST = /page is full|remove a line first|No room — remove a task|already fills a page — add another/i;

  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  function toastMsg(m, ms) { if (typeof toast === 'function') toast(m, ms); }
  function persist(n) { if (n && !n.lock) { try { saveNote(n, true); } catch (_) {} } }
  function newId(p) { return (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9)); }
  function TD() { return (window.V21ee && V21ee.TD) || { X: 40, W: 920, TOP: 104, GAP: 16, HEAD: 36, ROW: 48, ADD: 36, NOTES: 150, NOTE_LH: 40, TMR: 132, BOX: 26, DEF: 12 }; }
  function notesCount(t) { return window.V21ff && V21ff.notesCount ? V21ff.notesCount(t) : (t && t.notesLines != null ? Math.max(1, t.notesLines | 0) : NOTES_DEF); }
  function tmrCount(t) { return window.V21ff && V21ff.tmrCount ? V21ff.tmrCount(t) : (t && t.tmrLines != null ? Math.max(1, t.tmrLines | 0) : TMR_DEF); }
  function notesH(n) { const D = TD(); const c = Math.max(0, n | 0); if (c <= 0) return 0; return NOTES_BASE + (Math.max(1, c) - NOTES_DEF) * (D.NOTE_LH || 40); }
  function tmrH(n) { const D = TD(); const c = Math.max(0, n | 0); if (c <= 0) return 0; return TMR_BASE + (Math.max(1, c) - TMR_DEF) * (D.NOTE_LH || 40); }
  function pal() {
    const d = typeof isDark === 'function' && isDark();
    return { paper: d ? '#1f1f23' : '#fffdf8', box: d ? 'rgba(255,255,255,.03)' : '#ffffff', block: d ? 'rgba(255,255,255,.015)' : 'rgba(250,249,245,1)', edge: d ? 'rgba(200,200,220,.26)' : 'rgba(60,60,80,.24)', rule: d ? 'rgba(200,200,220,.20)' : 'rgba(60,60,80,.20)', gray: d ? 'rgba(200,200,215,.62)' : 'rgba(70,70,90,.6)', ink: d ? '#e6e6ea' : '#1d1d1f', accent: d ? '#8b85ff' : '#4f46e5' };
  }
  function fontFam() { return typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif'; }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function lab(ctx, c, t, x, y, size) { ctx.fillStyle = c.gray; ctx.font = '700 ' + (size || 12) + 'px ' + fontFam(); if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px'; ctx.fillText(String(t).toUpperCase(), x, y); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }
  function sbb(s) { if (s.bb && s.bb.length) return s.bb; try { return (typeof bbox === 'function') ? bbox(s.points) : [0, 0, 0, 0]; } catch (_) { return [0, 0, 0, 0]; } }
  function ccx(s) { const b = sbb(s); return (b[0] + b[2]) / 2; }
  function ccy(s) { const b = sbb(s); return (b[1] + b[3]) / 2; }
  function inR(r, x, y) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  function scale() { return (typeof S !== 'undefined' && typeof S.scale === 'number' && S.scale > 0) ? S.scale : 1; }

  function guardNote() {
    const n = typeof curNote === 'function' ? curNote() : null;
    if (!n) return null;
    if (sealed(n)) { toastMsg('Unlock the note first'); return null; }
    return n;
  }

  function installToastGuard() {
    if (typeof window.toast !== 'function' || window.toast._v21fj) return;
    const orig = window.toast;
    window.toast = function (m, ms) {
      if (BLOCKED_TOAST.test(String(m || ''))) return;
      return orig.apply(this, arguments);
    };
    window.toast._v21fj = true;
  }

  /* ---------- Honest To-Do layout & split ---------- */
  function layoutOrigin(t) {
    if (window.V21ff && typeof V21ff.layoutTodo === 'function') return V21ff.layoutTodo(t);
    return null;
  }

  function cloneTodo(t) {
    return JSON.parse(JSON.stringify(t));
  }

  function emptyFlow() {
    return { pri: [], rows: [], notesLines: 0, tomorrow: false, tmrLines: 0 };
  }

  function flowHasContent(f) {
    return !!(f && ((f.pri && f.pri.length) || (f.rows && f.rows.length) || (f.notesLines | 0) > 0 || (f.tomorrow && (f.tmrLines | 0) > 0)));
  }

  function splitTodo(t) {
    const D = TD();
    const stay = cloneTodo(t);
    const over = emptyFlow();
    const L = layoutOrigin(t);
    if (!L || !L.bottom || L.bottom <= LIMIT) return { stay, over, overflowed: false, L };

    const pri = (t.pri || []).slice();
    const rows = (t.rows || []).slice();
    const nNotes = t.tomorrow != null || t.notesLines != null ? notesCount(t) : notesCount(t);
    const nTmr = t.tomorrow ? tmrCount(t) : 0;

    let y = D.TOP;
    const gap = D.GAP;

    // Priorities
    const priH = pri.length ? D.HEAD + pri.length * D.ROW + 8 : 0;
    if (pri.length && y + priH > LIMIT) {
      let keep = 0;
      const minH = D.HEAD + D.ROW + 8;
      if (y + minH <= LIMIT) {
        keep = Math.max(1, Math.floor((LIMIT - y - D.HEAD - 8) / D.ROW));
        keep = Math.min(pri.length, keep);
      }
      stay.pri = pri.slice(0, keep);
      over.pri = pri.slice(keep);
      y = keep ? y + D.HEAD + keep * D.ROW + 8 + gap : y;
    } else {
      stay.pri = pri;
      y = pri.length ? y + priH + gap : y;
    }

    // Tasks
    const canKeepTasks = (k) => y + (k ? D.HEAD + k * D.ROW + D.ADD : 0) <= LIMIT;
    if (rows.length && !canKeepTasks(rows.length)) {
      let keep = 0;
      if (y + D.HEAD + D.ROW + D.ADD <= LIMIT) {
        keep = Math.max(1, Math.floor((LIMIT - y - D.HEAD - D.ADD) / D.ROW));
        keep = Math.min(rows.length, keep);
      }
      stay.rows = rows.slice(0, keep);
      over.rows = rows.slice(keep);
      y = keep ? y + D.HEAD + keep * D.ROW + D.ADD + gap : y;
    } else {
      stay.rows = rows;
      y = rows.length ? y + D.HEAD + rows.length * D.ROW + D.ADD + gap : y;
    }

    // Notes
    const fitNotes = (k) => k <= 0 || y + notesH(k) <= LIMIT;
    if (nNotes && !fitNotes(nNotes)) {
      let keep = 0;
      if (y + notesH(1) <= LIMIT) {
        for (let k = nNotes; k >= 1; k--) if (fitNotes(k)) { keep = k; break; }
      }
      stay.notesLines = keep;
      over.notesLines = nNotes - keep;
      y = keep ? y + notesH(keep) + gap : y;
    } else {
      stay.notesLines = nNotes;
      y = nNotes ? y + notesH(nNotes) + gap : y;
    }

    // Tomorrow
    if (t.tomorrow && nTmr) {
      const fitTmr = (k) => k <= 0 || y + tmrH(k) <= LIMIT;
      if (!fitTmr(nTmr)) {
        let keep = 0;
        if (y + tmrH(1) <= LIMIT) {
          for (let k = nTmr; k >= 1; k--) if (fitTmr(k)) { keep = k; break; }
        }
        stay.tomorrow = keep > 0;
        stay.tmrLines = keep;
        over.tomorrow = true;
        over.tmrLines = nTmr - keep;
      } else {
        stay.tomorrow = true;
        stay.tmrLines = nTmr;
      }
    } else {
      stay.tomorrow = false;
      stay.tmrLines = 0;
    }

    return { stay, over, overflowed: flowHasContent(over), L };
  }

  /* ---------- Ink anchored to lines ---------- */
  function lineBands(t, L) {
    const D = TD();
    const out = [];
    if (!L) return out;
    (L.priRows || []).forEach((R, i) => {
      const row = (t.pri || [])[i];
      out.push({ key: 'pri:' + (row && row.id), band: { x: L.pri.x, y: R.y, w: L.pri.w, h: R.h } });
    });
    (L.rows || []).forEach((R, i) => {
      const row = (t.rows || [])[i];
      out.push({ key: 'task:' + (row && row.id), band: { x: L.tasks.x, y: R.y, w: L.tasks.w, h: R.h } });
    });
    if (L.notes) {
      const n = notesCount(t);
      for (let i = 0; i < n; i++) {
        const yy = L.notes.y + 36 + i * D.NOTE_LH;
        out.push({ key: 'notes:' + i, band: { x: L.notes.x, y: yy, w: L.notes.w, h: D.NOTE_LH } });
      }
    }
    if (L.tomorrow) {
      const n = tmrCount(t);
      for (let i = 0; i < n; i++) {
        const yy = L.tomorrow.y + 36 + i * D.NOTE_LH;
        out.push({ key: 'tmr:' + i, band: { x: L.tomorrow.x, y: yy, w: L.tomorrow.w, h: D.NOTE_LH } });
      }
    }
    return out;
  }

  function snapshotInk(pg, bands) {
    const strokes = (pg.strokes || []).slice();
    const texts = (pg.texts || []).slice();
    const claimedS = new Set(), claimedT = new Set();
    const items = [];
    for (const b of bands) {
      if (!b.key) continue;
      const ss = strokes.filter(s => s.points && s.points.length && inR(b.band, ccx(s), ccy(s)));
      const ts = texts.filter(t => inR(b.band, t.x + 4, t.y + 10));
      ss.forEach(s => claimedS.add(s));
      ts.forEach(t => claimedT.add(t));
      items.push({ key: b.key, band: b.band, strokes: ss, texts: ts });
    }
    const looseS = strokes.filter(s => !claimedS.has(s));
    const looseT = texts.filter(t => !claimedT.has(t));
    return { items, looseS, looseT };
  }

  function shiftStrokes(list, dx, dy) {
    if (!dx && !dy) return;
    for (const s of list || []) {
      if (s.points) s.points = s.points.map(p => { const q = p.slice(); q[0] += dx; q[1] += dy; return q; });
      try { s.bb = bbox(s.points); } catch (_) {}
    }
  }
  function shiftTexts(list, dx, dy) {
    if (!dx && !dy) return;
    for (const t of list || []) { t.x += dx; t.y += dy; }
  }

  function bandsForFlow(flow, L) {
    return lineBands({
      pri: flow.pri || [],
      rows: flow.rows || [],
      notesLines: flow.notesLines || 0,
      tomorrow: !!flow.tomorrow,
      tmrLines: flow.tmrLines || 0
    }, L);
  }

  /* ---------- Flow page layout / draw / UI ---------- */
  function isFlow(pg) { return !!(pg && pg.todoCont && (pg.todoCont.v === 2 || pg.todoCont.flow || pg.todoCont.section === 'flow')); }

  function layoutFlow(pg) {
    const t = pg && pg.todoCont; if (!t) return null;
    if (!isFlow(pg)) return window.V21fh && V21fh.layoutTodoCont ? V21fh.layoutTodoCont(pg) : null;
    const D = TD();
    const x = D.X, w = D.W;
    let y = 108;
    const out = { boxes: [], pri: null, priRows: null, tasks: null, rows: null, notes: null, tomorrow: null, bottom: y };
    const row = (box, i, list) => ({
      i, id: list[i].id,
      y: box.y + D.HEAD + i * D.ROW, h: D.ROW,
      check: { x: box.x + 22, y: box.y + D.HEAD + i * D.ROW + (D.ROW - D.BOX) / 2 },
      write: { x: box.x + 62, y: box.y + D.HEAD + i * D.ROW, w: box.w - 74, h: D.ROW }
    });
    if (t.pri && t.pri.length) {
      const box = { key: 'pri', label: '★ Priorities', x, y, w, h: D.HEAD + t.pri.length * D.ROW + 8 };
      out.pri = box; out.priRows = t.pri.map((_, i) => row(box, i, t.pri));
      out.boxes.push(box); y = box.y + box.h + D.GAP;
    }
    if (t.rows && t.rows.length) {
      const box = { key: 'tasks', label: 'Tasks', x, y, w, h: D.HEAD + t.rows.length * D.ROW + D.ADD };
      out.tasks = box; out.rows = t.rows.map((_, i) => row(box, i, t.rows));
      out.boxes.push(box); y = box.y + box.h + D.GAP;
    }
    if ((t.notesLines | 0) > 0) {
      const box = { key: 'notes', label: 'Notes', x, y, w, h: notesH(t.notesLines) };
      out.notes = box; out.boxes.push(box); y = box.y + box.h + D.GAP;
    }
    if (t.tomorrow && (t.tmrLines | 0) > 0) {
      const box = { key: 'tomorrow', label: 'Tomorrow', x, y, w, h: tmrH(t.tmrLines) };
      out.tomorrow = box; out.boxes.push(box); y = box.y + box.h;
    }
    out.bottom = y;
    return out;
  }

  function drawTodoFlow(ctx, pg) {
    const t = pg.todoCont, L = layoutFlow(pg), c = pal(), D = TD();
    if (!t || !L) return;
    const font = fontFam();
    const PW = typeof PAGE_W === 'number' ? PAGE_W : 1000, PH = typeof PAGE_H === 'number' ? PAGE_H : 1430;
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, PW, PH);
    ctx.fillStyle = c.ink; ctx.font = '700 32px ' + font;
    ctx.fillText(t.title || 'Daily To-Do (cont.)', D.X + 4, 62);
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(D.X, 90); ctx.lineTo(D.X + D.W, 90); ctx.stroke();
    const boxy = (f, fill) => { rr(ctx, f.x, f.y, f.w, f.h, 10); ctx.fillStyle = fill || c.box; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke(); };
    const rows = (bx, list, numbered) => (list || []).forEach((r, i) => {
      const k = r.check; rr(ctx, k.x, k.y, D.BOX, D.BOX, 6); ctx.strokeStyle = c.gray; ctx.lineWidth = 2; ctx.stroke();
      if (numbered) { ctx.fillStyle = c.accent; ctx.font = '800 15px ' + font; ctx.fillText(String(i + 1), bx.x + 6, k.y + 19); }
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(r.write.x, r.y + r.h - 10); ctx.lineTo(r.write.x + r.write.w, r.y + r.h - 10); ctx.stroke();
    });
    if (L.pri) { boxy(L.pri, c.block); lab(ctx, c, L.pri.label, L.pri.x + 14, L.pri.y + 23, 13); rows(L.pri, L.priRows, true); }
    if (L.tasks) { boxy(L.tasks, c.block); lab(ctx, c, 'Tasks', L.tasks.x + 14, L.tasks.y + 23, 13); rows(L.tasks, L.rows, false); }
    for (const f of [L.notes, L.tomorrow].filter(Boolean)) {
      boxy(f); lab(ctx, c, f.label, f.x + 14, f.y + 23, 13);
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      const nL = f.key === 'notes' ? (t.notesLines | 0) : (t.tmrLines | 0);
      for (let i = 0; i < nL; i++) {
        const yy = f.y + 36 + D.NOTE_LH - 6 + i * D.NOTE_LH;
        ctx.moveTo(f.x + 14, yy); ctx.lineTo(f.x + f.w - 14, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function pairHtml(sec) {
    return '<button type="button" class="ff-plus" data-fj-sec="' + sec + '" aria-label="Add a line">＋</button>' +
      '<button type="button" class="ff-minus" data-fj-sec="' + sec + '" aria-label="Remove the last line">−</button>';
  }

  function placePair(rec, box, html) {
    if (!box || !rec || !rec.ov) return;
    const s = scale();
    const pw = 72, ph = 32, inset = 8;
    const wrap = document.createElement('div');
    wrap.className = 'ff-pm fj-pm';
    const width = pw * s;
    const boxLeft = box.x * s, boxRight = (box.x + box.w - inset) * s;
    const left = Math.max(boxLeft + 4, boxRight - width);
    Object.assign(wrap.style, {
      left: left + 'px',
      top: (box.y + 3) * s + 'px',
      width: width + 'px',
      height: Math.max(28, ph * s) + 'px'
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('button').forEach(b => { b.style.width = (width / 2) + 'px'; b.style.height = '100%'; });
    rec.ov.append(wrap);
  }

  function drawFlowUI(pi, rec) {
    const n = typeof curNote === 'function' ? curNote() : null;
    const pg = n && n.pages[pi];
    if (!pg || !isFlow(pg) || sealed(n)) return;
    rec.ov.querySelectorAll('.fj-pm, .fh-pm').forEach(b => b.remove());
    const L = layoutFlow(pg);
    if (L.pri) placePair(rec, L.pri, pairHtml('pri'));
    if (L.tasks) placePair(rec, L.tasks, pairHtml('tasks'));
    if (L.notes) placePair(rec, L.notes, pairHtml('notes'));
    if (L.tomorrow) placePair(rec, L.tomorrow, pairHtml('tomorrow'));
  }

  /* ---------- Apply split, moving ink with lines ---------- */
  function originOf(n, pg) {
    if (!pg) return null;
    if (pg.todoCont && pg.todoCont.of) return (n.pages || []).find(p => p.id === pg.todoCont.of) || pg;
    return pg;
  }

  function flowPagesOf(n, ofId) {
    return (n.pages || []).map((p, i) => ({ p, i })).filter(x => x.p.todoCont && x.p.todoCont.of === ofId && (isFlow(x.p) || true));
  }

  function mergeFlow(dest, src) {
    dest.pri = (dest.pri || []).concat(src.pri || []);
    dest.rows = (dest.rows || []).concat(src.rows || []);
    dest.notesLines = (dest.notesLines | 0) + (src.notesLines | 0);
    if (src.tomorrow) { dest.tomorrow = true; dest.tmrLines = (dest.tmrLines | 0) + (src.tmrLines | 0); }
  }

  function newFlowPage(origin, flow) {
    const p = (typeof newPage === 'function' ? newPage() : { id: newId('p'), strokes: [], texts: [], tasks: [], images: [] });
    p.paper = 'blank';
    p.todoCont = {
      v: 2, flow: true, section: 'flow',
      of: origin.id,
      title: 'Daily To-Do (cont.)',
      pri: (flow.pri || []).slice(),
      rows: (flow.rows || []).slice(),
      notesLines: flow.notesLines | 0,
      tomorrow: !!flow.tomorrow,
      tmrLines: flow.tmrLines | 0
    };
    p.strokes = [];
    p.texts = [];
    return p;
  }

  function flowFits(pg, extra) {
    const trial = {
      v: 2, flow: true, section: 'flow', of: 'x', title: '',
      pri: (pg.todoCont.pri || []).concat((extra && extra.pri) || []),
      rows: (pg.todoCont.rows || []).concat((extra && extra.rows) || []),
      notesLines: (pg.todoCont.notesLines | 0) + ((extra && extra.notesLines) || 0),
      tomorrow: !!(pg.todoCont.tomorrow || (extra && extra.tomorrow)),
      tmrLines: (pg.todoCont.tmrLines | 0) + ((extra && extra.tmrLines) || 0)
    };
    const L = layoutFlow({ todoCont: trial });
    return L && L.bottom <= LIMIT;
  }

  function commitPages(n, pi, msg) {
    persist(n);
    try { if (window.thumbCache && thumbCache.clear) thumbCache.clear(); } catch (_) {}
    try { if (typeof buildPages === 'function') buildPages(); } catch (_) {
      try { if (typeof renderPageInk === 'function') renderPageInk(pi); } catch (__) {}
      try { if (typeof renderOverlay === 'function') renderOverlay(pi); } catch (__) {}
    }
    if (typeof pi === 'number' && typeof scrollToPage === 'function') {
      try { scrollToPage(pi); } catch (_) {}
    }
    if (msg && typeof actionToast === 'function') actionToast(msg, 'Undo', () => { try { if (typeof restore === 'function') restore(S.undo, S.redo); } catch (_) {} }, 5000);
  }

  function applyOverflow(n, originPi, split, snap) {
    const origin = n.pages[originPi];
    // Shrink origin first (todo fields)
    const t = origin.todo;
    t.pri = (split.stay.pri || []).slice();
    t.rows = (split.stay.rows || []).slice();
    t.notesLines = split.stay.notesLines | 0;
    if (t.notesLines <= 0) t.notesLines = 0;
    t.tomorrow = !!split.stay.tomorrow;
    t.tmrLines = split.stay.tmrLines | 0;

    // Find or create a flow page just after the last continuation of this origin
    const chain = flowPagesOf(n, origin.id);
    const flowOnly = chain.filter(x => isFlow(x.p));
    let destPi, dest;
    if (flowOnly.length && flowFits(flowOnly[flowOnly.length - 1].p, split.over)) {
      destPi = flowOnly[flowOnly.length - 1].i;
      dest = n.pages[destPi];
      mergeFlow(dest.todoCont, split.over);
    } else {
      const after = chain.length ? chain[chain.length - 1].i + 1 : originPi + 1;
      dest = newFlowPage(origin, split.over);
      n.pages.splice(after, 0, dest);
      destPi = after;
    }

    // Ink is re-homed once by remapFromSnap after the split is applied.
    dest.strokes = dest.strokes || [];
    dest.texts = dest.texts || [];
    return destPi;
  }

  function reflowOrigin(n, originPi) {
    const origin = n.pages[originPi];
    if (!origin || !origin.todo) return originPi;
    let last = originPi;
    let guard = 0;
    while (guard++ < 12) {
      const split = splitTodo(origin.todo);
      if (!split.overflowed) break;
      last = applyOverflow(n, originPi, split, null);
    }
    return last;
  }

  function addLineToTodo(t, sec) {
    if (sec === 'pri') t.pri = (t.pri || []).concat([{ id: newId('tp'), done: false }]);
    else if (sec === 'tasks') t.rows = (t.rows || []).concat([{ id: newId('tr'), done: false }]);
    else if (sec === 'notes') t.notesLines = notesCount(t) + 1;
    else if (sec === 'tomorrow') {
      if (!t.tomorrow) t.tomorrow = true;
      t.tmrLines = tmrCount(t) + 1;
    } else return false;
    return true;
  }

  function addLineToFlow(t, sec) {
    if (sec === 'pri') t.pri = (t.pri || []).concat([{ id: newId('tp'), done: false }]);
    else if (sec === 'tasks') t.rows = (t.rows || []).concat([{ id: newId('tr'), done: false }]);
    else if (sec === 'notes') t.notesLines = (t.notesLines | 0) + 1;
    else if (sec === 'tomorrow') { t.tomorrow = true; t.tmrLines = (t.tmrLines | 0) + 1; }
    else return false;
    return true;
  }

  function reflowFlowPage(n, pi) {
    const pg = n.pages[pi];
    if (!isFlow(pg)) return pi;
    const L = layoutFlow(pg);
    if (!L || L.bottom <= LIMIT) return pi;
    // Split the flow the same way by building a fake todo
    const fake = {
      pri: (pg.todoCont.pri || []).slice(),
      rows: (pg.todoCont.rows || []).slice(),
      notesLines: pg.todoCont.notesLines | 0,
      tomorrow: !!pg.todoCont.tomorrow,
      tmrLines: pg.todoCont.tmrLines | 0
    };
    // Use split against a layout of a synthetic origin-like structure at y=108
    // Convert to origin-style by temporarily placing as origin layout from TOP.
    // Simpler: peel from the bottom until it fits.
    const snap = snapshotInk(pg, bandsForFlow(pg.todoCont, L));
    const peeled = emptyFlow();
    const shrink = () => {
      if (fake.tomorrow && fake.tmrLines > 0) {
        peeled.tomorrow = true; peeled.tmrLines++; fake.tmrLines--;
        if (fake.tmrLines <= 0) fake.tomorrow = false;
        return true;
      }
      if (fake.notesLines > 0) { peeled.notesLines++; fake.notesLines--; return true; }
      if (fake.rows && fake.rows.length) { peeled.rows.unshift(fake.rows.pop()); return true; }
      if (fake.pri && fake.pri.length) { peeled.pri.unshift(fake.pri.pop()); return true; }
      return false;
    };
    let guard = 0;
    while (guard++ < 80) {
      pg.todoCont.pri = fake.pri; pg.todoCont.rows = fake.rows;
      pg.todoCont.notesLines = fake.notesLines;
      pg.todoCont.tomorrow = !!fake.tomorrow; pg.todoCont.tmrLines = fake.tmrLines;
      const L2 = layoutFlow(pg);
      if (L2 && L2.bottom <= LIMIT) break;
      if (!shrink()) break;
    }
    // reverse peeled lists that were unshifted from the end
    if (peeled.rows) { /* already unshifted in order */ }
    if (!flowHasContent(peeled)) return pi;
    const origin = originOf(n, pg);
    const after = pi + 1;
    const next = newFlowPage(origin, peeled);
    n.pages.splice(after, 0, next);
    // Re-home ink
    const Lstay = layoutFlow(pg);
    const Ldest = layoutFlow(next);
    const stayMap = new Map(bandsForFlow(pg.todoCont, Lstay).map(b => [b.key, b.band]));
    const destMap = new Map(bandsForFlow(next.todoCont, Ldest).map(b => [b.key, b.band]));
    pg.strokes = (snap.looseS || []).slice();
    pg.texts = (snap.looseT || []).slice();
    next.strokes = []; next.texts = [];
    for (const it of snap.items) {
      const sb = stayMap.get(it.key), db = destMap.get(it.key);
      const targetBand = sb || db;
      const targetPg = sb ? pg : next;
      if (!targetBand) { pg.strokes.push(...it.strokes); pg.texts.push(...it.texts); continue; }
      shiftStrokes(it.strokes, targetBand.x - it.band.x, targetBand.y - it.band.y);
      shiftTexts(it.texts, targetBand.x - it.band.x, targetBand.y - it.band.y);
      targetPg.strokes.push(...it.strokes);
      targetPg.texts.push(...it.texts);
    }
    return after;
  }


  function flowEmpty(pg) {
    const t = pg && pg.todoCont; if (!t) return true;
    return !((t.pri || []).length || (t.rows || []).length || (t.notesLines | 0) > 0 || (t.tomorrow && (t.tmrLines | 0) > 0));
  }

  function collapseEmptyFlows(n, originId) {
    for (let i = n.pages.length - 1; i >= 0; i--) {
      const p = n.pages[i];
      if (!p.todoCont || p.todoCont.of !== originId || !isFlow(p)) continue;
      if (!flowEmpty(p)) continue;
      const hasInk = (p.strokes && p.strokes.length) || (p.texts && p.texts.length);
      if (hasInk) continue;
      n.pages.splice(i, 1);
    }
  }

  function tryPullOne(n, originPi) {
    const origin = n.pages[originPi]; if (!origin || !origin.todo) return false;
    const flows = (n.pages || []).map((p, i) => ({ p, i })).filter(x => x.p.todoCont && x.p.todoCont.of === origin.id && isFlow(x.p));
    if (!flows.length) return false;
    const fp = flows[0].p, f = fp.todoCont;
    const trial = cloneTodo(origin.todo);
    let moved = null;
    if (f.pri && f.pri.length) {
      trial.pri = (trial.pri || []).concat([f.pri[0]]);
      moved = { kind: 'pri' };
    } else if (f.rows && f.rows.length) {
      trial.rows = (trial.rows || []).concat([f.rows[0]]);
      moved = { kind: 'task' };
    } else if ((f.notesLines | 0) > 0) {
      trial.notesLines = notesCount(trial) + 1;
      moved = { kind: 'notes' };
    } else if (f.tomorrow && (f.tmrLines | 0) > 0) {
      trial.tomorrow = true;
      trial.tmrLines = (trial.tomorrow && origin.todo.tomorrow ? tmrCount(trial) : 0) + 1;
      if (!origin.todo.tomorrow) trial.tmrLines = 1;
      moved = { kind: 'tmr' };
    } else return false;
    const split = splitTodo(trial);
    if (split.overflowed) return false;
    // Fits — snapshot both pages, mutate, remap
    const snapO = snapshotInk(origin, lineBands(origin.todo, layoutOrigin(origin.todo)));
    const snapF = snapshotInk(fp, bandsForFlow(f, layoutFlow(fp)));
    if (moved.kind === 'pri') { origin.todo.pri.push(f.pri.shift()); }
    else if (moved.kind === 'task') { origin.todo.rows.push(f.rows.shift()); }
    else if (moved.kind === 'notes') { origin.todo.notesLines = notesCount(origin.todo) + 1; f.notesLines--; }
    else if (moved.kind === 'tmr') {
      if (!origin.todo.tomorrow) { origin.todo.tomorrow = true; origin.todo.tmrLines = 1; }
      else origin.todo.tmrLines = tmrCount(origin.todo) + 1;
      f.tmrLines--;
      if (f.tmrLines <= 0) f.tomorrow = false;
    }
    // remap origin from snapO (old keys stay / new line has no origin ink)
    remapFromSnap(n, origin, snapO);
    // remap flow ink from snapF — keys for remaining lines
    const Lf = layoutFlow(fp);
    const fmap = new Map(bandsForFlow(f, Lf).map(b => [b.key, b.band]));
    fp.strokes = (snapF.looseS || []).slice();
    fp.texts = (snapF.looseT || []).slice();
    for (const it of snapF.items) {
      const b = fmap.get(it.key);
      if (!b) {
        // this line moved to origin — remapFromSnap on origin won't have the flow ink
        // place onto origin using origin's new bands
        const Lo = layoutOrigin(origin.todo);
        const omap = new Map(lineBands(origin.todo, Lo).map(bb => [bb.key, bb.band]));
        const ob = omap.get(it.key);
        if (ob) {
          shiftStrokes(it.strokes, ob.x - it.band.x, ob.y - it.band.y);
          shiftTexts(it.texts, ob.x - it.band.x, ob.y - it.band.y);
          origin.strokes.push(...it.strokes);
          origin.texts.push(...it.texts);
        } else {
          origin.strokes.push(...it.strokes);
          origin.texts.push(...it.texts);
        }
        continue;
      }
      shiftStrokes(it.strokes, b.x - it.band.x, b.y - it.band.y);
      shiftTexts(it.texts, b.x - it.band.x, b.y - it.band.y);
      fp.strokes.push(...it.strokes);
      fp.texts.push(...it.texts);
    }
    return true;
  }

  function pullBack(n, originPi) {
    const origin = n.pages[originPi]; if (!origin || !origin.todo) return;
    let guard = 0;
    while (guard++ < 40 && tryPullOne(n, originPi)) { /* keep pulling while it fits */ }
    collapseEmptyFlows(n, origin.id);
  }

    function fjTodoAdd(core, ctx, args) {
    const pi = args[0], sec = args[1];
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg) return false;
    installToastGuard();

    // Continuation (v1 single-section or v2 flow)
    if (pg.todoCont) {
      if (isFlow(pg)) {
        if (typeof pushHistory === 'function') pushHistory();
        const L0 = layoutFlow(pg);
        const snap = snapshotInk(pg, bandsForFlow(pg.todoCont, L0));
        addLineToFlow(pg.todoCont, sec);
        // Temporarily keep ink in place; reflowFlowPage will re-home
        pg.strokes = (snap.looseS || []).concat(snap.items.flatMap(it => it.strokes));
        pg.texts = (snap.looseT || []).concat(snap.items.flatMap(it => it.texts));
        const dest = reflowFlowPage(n, pi);
        // If it still fits, re-home on the same page so new line shifts ink below
        if (dest === pi) {
          const L1 = layoutFlow(pg);
          const map1 = new Map(bandsForFlow(pg.todoCont, L1).map(b => [b.key, b.band]));
          const all = snapshotInk(pg, bandsForFlow(pg.todoCont, L0)).items; // stale
          // simpler: leave ink; shift everything below the added section's old bottom
        }
        // Re-snapshot from current (possibly mixed) and map by key using pre-add snap
        const L1 = layoutFlow(pg);
        const stayMap = new Map(bandsForFlow(pg.todoCont, L1).map(b => [b.key, b.band]));
        // rebuild from snap (pre-add keys still valid; new line has no ink)
        pg.strokes = (snap.looseS || []).slice();
        pg.texts = (snap.looseT || []).slice();
        for (const it of snap.items) {
          const b = stayMap.get(it.key);
          if (!b) { pg.strokes.push(...it.strokes); pg.texts.push(...it.texts); continue; }
          shiftStrokes(it.strokes, b.x - it.band.x, b.y - it.band.y);
          shiftTexts(it.texts, b.x - it.band.x, b.y - it.band.y);
          pg.strokes.push(...it.strokes);
          pg.texts.push(...it.texts);
        }
        commitPages(n, dest, dest !== pi ? 'Continued on the next page' : null);
        return true;
      }
      // v1 section continuation: fall through to previous hook if present, else add here
      if (window.V21fh && V21fh.hooks && V21fh.hooks._fjPrevTodoAdd) {
        return V21fh.hooks._fjPrevTodoAdd(core, ctx, args);
      }
    }

    if (!pg.todo) return core.apply(ctx, args);

    if (typeof pushHistory === 'function') pushHistory();
    const L0 = layoutOrigin(pg.todo);
    const snap = snapshotInk(pg, lineBands(pg.todo, L0));
    if (!addLineToTodo(pg.todo, sec)) { try { S.undo && S.undo.pop(); } catch (_) {} return false; }
    // Put ink back at pre-add coords first
    pg.strokes = (snap.looseS || []).concat(snap.items.flatMap(it => it.strokes));
    pg.texts = (snap.looseT || []).concat(snap.items.flatMap(it => it.texts));
    const dest = reflowOrigin(n, pi);
    // After reflow, applyOverflow already re-homed from a snap taken inside reflow (post-add state).
    // The first reflowOrigin call snapshots current (post-add, pre-shrink) layout — but we stuffed
    // ink at OLD coords, so snapshot keys still match old bands which layoutOrigin(post-add) won't.
    // Do a coordinated add+reflow with the pre-add snap instead:
    // Re-run mapping from pre-add snap against current pages.
    remapFromSnap(n, originOf(n, pg) || pg, snap);
    commitPages(n, dest, dest !== pi ? 'Continued on the next page' : null);
    return true;
  }

  function remapFromSnap(n, origin, snap) {
    // Gather all bands on origin + its flow pages
    const map = new Map();
    const pageOf = new Map();
    const L0 = origin.todo ? layoutOrigin(origin.todo) : null;
    if (L0) lineBands(origin.todo, L0).forEach(b => { map.set(b.key, b.band); pageOf.set(b.key, origin); });
    (n.pages || []).forEach(p => {
      if (!p.todoCont || p.todoCont.of !== origin.id) return;
      const L = isFlow(p) ? layoutFlow(p) : (window.V21fh && V21fh.layoutTodoCont && V21fh.layoutTodoCont(p));
      const t = p.todoCont;
      const bands = isFlow(p) ? bandsForFlow(t, L) : [];
      bands.forEach(b => { map.set(b.key, b.band); pageOf.set(b.key, p); });
    });
    // Clear and redistribute
    origin.strokes = (snap.looseS || []).slice();
    origin.texts = (snap.looseT || []).slice();
    (n.pages || []).forEach(p => {
      if (p !== origin && p.todoCont && p.todoCont.of === origin.id) { p.strokes = []; p.texts = []; }
    });
    for (const it of snap.items) {
      const band = map.get(it.key);
      const pg = pageOf.get(it.key) || origin;
      if (!band) { origin.strokes.push(...it.strokes); origin.texts.push(...it.texts); continue; }
      shiftStrokes(it.strokes, band.x - it.band.x, band.y - it.band.y);
      shiftTexts(it.texts, band.x - it.band.x, band.y - it.band.y);
      pg.strokes = pg.strokes || [];
      pg.texts = pg.texts || [];
      pg.strokes.push(...it.strokes);
      pg.texts.push(...it.texts);
    }
  }


  /* ---------- Tomorrow box exists across the whole template chain ---------- */
  function strokesIn(pg, r) {
    return (pg && pg.strokes || []).filter(s => s.points && s.points.length && inR(r, ccx(s), ccy(s)));
  }
  function textsIn(pg, r) {
    return (pg && pg.texts || []).filter(tx => inR(r, (tx.x || 0) + 4, (tx.y || 0) + 10));
  }
  function bandHasWriting(pg, band) {
    return !!(band && (strokesIn(pg, band).length || textsIn(pg, band).length));
  }
  function takeInkIn(pg, r) {
    if (!pg || !r) return 0;
    const s = new Set(strokesIn(pg, r).concat((pg.strokes || []).filter(x => x.tool === 'highlighter' && inR(r, ccx(x), ccy(x)))));
    const tx = new Set(textsIn(pg, r));
    if (pg.strokes) pg.strokes = pg.strokes.filter(x => !s.has(x));
    if (pg.texts) pg.texts = pg.texts.filter(x => !tx.has(x));
    return s.size + tx.size;
  }
  function chainHasTomorrow(n, origin) {
    if (!n || !origin) return false;
    if (origin.todo && origin.todo.tomorrow) return true;
    return (n.pages || []).some(pg => pg.todoCont && pg.todoCont.of === origin.id && pg.todoCont.tomorrow);
  }
  function tomorrowTargets(n, origin) {
    const out = [];
    if (origin && origin.todo && origin.todo.tomorrow) {
      const L = layoutOrigin(origin.todo);
      out.push({ pg: origin, box: L && L.tomorrow });
    }
    (n.pages || []).forEach(pg => {
      if (!pg.todoCont || pg.todoCont.of !== origin.id || !pg.todoCont.tomorrow) return;
      const L = layoutFlow(pg);
      out.push({ pg, box: L && L.tomorrow });
    });
    return out;
  }
  const TMR_ON = '✕ Tomorrow box';
  const TMR_OFF = '＋ Tomorrow box';
  function syncTomorrowToggle(rec, n, pg) {
    if (!rec || !rec.ov || !n || !pg || !pg.todo) return;
    const origin = originOf(n, pg) || pg;
    const has = chainHasTomorrow(n, origin);
    rec.ov.querySelectorAll('.td-tmr, .ff-tmr').forEach(b => {
      b.textContent = has ? TMR_ON : TMR_OFF;
      b.title = has ? 'Remove the Tomorrow box' : 'Add a Tomorrow box';
      b.setAttribute('aria-label', b.title);
    });
  }
  async function hideTomorrowInChain(n, origin, force) {
    const targets = tomorrowTargets(n, origin);
    const inked = targets.some(t => t.box && bandHasWriting(t.pg, t.box));
    if (inked && !force) {
      const ok = (window.V21ff && typeof V21ff.confirmBox === 'function')
        ? await V21ff.confirmBox('Hide the Tomorrow box?', 'This box has handwriting. Hiding it also removes that writing. You can undo this.', 'Hide box')
        : true;
      if (!ok) return false;
    }
    if (typeof pushHistory === 'function') pushHistory();
    for (const t of targets) if (t.box) takeInkIn(t.pg, t.box);
    if (origin.todo) { origin.todo.tomorrow = false; origin.todo.tmrLines = 0; }
    (n.pages || []).forEach(pg => {
      if (pg.todoCont && pg.todoCont.of === origin.id && pg.todoCont.tomorrow) {
        pg.todoCont.tomorrow = false;
        pg.todoCont.tmrLines = 0;
      }
    });
    collapseEmptyFlows(n, origin.id);
    persist(n);
    try { if (typeof buildPages === 'function') buildPages(); } catch (_) {}
    if (typeof actionToast === 'function') {
      actionToast('Tomorrow box hidden', 'Undo', () => { try { if (typeof restore === 'function') restore(S.undo, S.redo); } catch (_) {} }, 5000);
    }
    return true;
  }

  /* ---------- Clicks on flow-page +/− ---------- */
  function hookClicks() {
    const PAGES = document.getElementById('pages');
    if (!PAGES || PAGES._v21fj) return;
    PAGES._v21fj = true;
    PAGES.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-fj-sec], .fj-pm .ff-plus, .fj-pm .ff-minus');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const page = b.closest('.page[data-pi]');
      const pi = page ? +page.dataset.pi : 0;
      const sec = b.dataset.fjSec || (b.closest('[data-fj-sec]') && b.closest('[data-fj-sec]').dataset.fjSec);
      if (!sec) return;
      if (b.classList.contains('ff-plus')) V21ff.todoAdd(pi, sec);
      else if (b.classList.contains('ff-minus')) V21ff.todoRemoveLast(pi, sec);
    }, true);
  }

  /* ---------- Draw hooks ---------- */
  function hookDraw() {
    if (typeof drawPageBackground === 'function' && !drawPageBackground._v21fj) {
      const _dpb = drawPageBackground;
      drawPageBackground = function (ctx, note, pg) {
        const r = _dpb.apply(this, arguments);
        try { if (pg && isFlow(pg)) drawTodoFlow(ctx, pg); } catch (e) { console.warn('v21fj flow draw', e); }
        return r;
      };
      drawPageBackground._v21fj = true;
    }
    if (typeof v7OverlayHook === 'function' && !v7OverlayHook._v21fj) {
      const _ov = v7OverlayHook;
      v7OverlayHook = function (pi) {
        const r = _ov.apply(this, arguments);
        try {
          const n = typeof curNote === 'function' ? curNote() : null;
          const rec = typeof pageEls !== 'undefined' && pageEls[pi];
          const pg = n && n.pages[pi];
          if (rec && n && pg && !sealed(n)) {
            if (isFlow(pg)) drawFlowUI(pi, rec);
            if (pg.todo) syncTomorrowToggle(rec, n, pg);
          }
        } catch (e) { console.warn('v21fj flow ui', e); }
        return r;
      };
      v7OverlayHook._v21fj = true;
    }
    if (typeof drawOverlaysForExport === 'function' && !drawOverlaysForExport._v21fj) {
      const _doe = drawOverlaysForExport;
      drawOverlaysForExport = function (ctx, pg, note) {
        const r = _doe.apply(this, arguments);
        try { if (pg && isFlow(pg)) drawTodoFlow(ctx, pg); } catch (_) {}
        return r;
      };
      drawOverlaysForExport._v21fj = true;
    }
  }

  /* ---------- Quote “fills a page” → continue ---------- */
  function hookQuotes() {
    if (!window.V21ed) return;
    if (typeof V21ed.addLine === 'function' && !V21ed.addLine._v21fj) {
      const _al = V21ed.addLine;
      V21ed.addLine = function (pi, id) {
        installToastGuard();
        const n = typeof curNote === 'function' ? curNote() : null;
        const pg = n && n.pages[pi];
        const q = pg && pg.qsheet && (pg.qsheet.quotes || []).find(x => x.id === id);
        const lines = q && q.lines;
        const r = _al.apply(this, arguments);
        if (r === false && q && (lines >= (V21ed.MAXL || 0) - 0 || true)) {
          // If the line was rejected because the quote fills the page, start a new quote (continues on next page).
          if (typeof V21ed.addQuote === 'function') {
            const added = V21ed.addQuote(pi);
            return !!added || r;
          }
        }
        return r;
      };
      V21ed.addLine._v21fj = true;
    }
    if (typeof V21ed.addNoteLine === 'function' && !V21ed.addNoteLine._v21fj) {
      const _an = V21ed.addNoteLine;
      V21ed.addNoteLine = function (pi, id) {
        installToastGuard();
        const r = _an.apply(this, arguments);
        if (r === false && typeof V21ed.addQuote === 'function') {
          const added = V21ed.addQuote(pi);
          return !!added || r;
        }
        return r;
      };
      V21ed.addNoteLine._v21fj = true;
    }
  }

  /* ---------- Custom templates: never toast; continue / reflow lower modules ---------- */
  function hookCustom() {
    if (!window.V21fh || !V21fh.hooks) return;
    const prev = V21fh.hooks.custAdd;
    if (prev && prev._v21fj) return;
    V21fh.hooks.custAdd = function (core, ctx, args) {
      installToastGuard();
      if (typeof prev === 'function') {
        const r = prev(core, ctx, args);
        return r;
      }
      return core.apply(ctx, args);
    };
    V21fh.hooks.custAdd._v21fj = true;
  }

  function hookTodo() {
    if (!window.V21fh || !V21fh.hooks) return;
    if (V21fh.hooks.todoAdd && V21fh.hooks.todoAdd._v21fj) return;
    V21fh.hooks._fjPrevTodoAdd = V21fh.hooks.todoAdd;
    V21fh.hooks.todoAdd = function (core, ctx, args) { return fjTodoAdd(core, ctx, args); };
    V21fh.hooks.todoAdd._v21fj = true;

    const prevPagesOfCont = V21fh.pagesOfCont;
    V21fh.pagesOfCont = function (n, originId, sec) {
      const base = (typeof prevPagesOfCont === 'function' ? prevPagesOfCont(n, originId, sec) : []) || [];
      const seen = new Set(base);
      (n.pages || []).forEach(pg => {
        if (seen.has(pg)) return;
        if (!pg.todoCont || pg.todoCont.of !== originId || !isFlow(pg)) return;
        base.push(pg);
      });
      return base;
    };

    const prevRm = V21fh.hooks.todoRemoveLast;
    V21fh.hooks.todoRemoveLast = async function (core, ctx, args) {
      installToastGuard();
      const pi = args[0];
      const r = typeof prevRm === 'function' ? await prevRm(core, ctx, args) : await core.apply(ctx, args);
      const n = typeof curNote === 'function' ? curNote() : null;
      if (n) {
        const pg = n.pages[pi] || n.pages[0];
        const origin = originOf(n, pg) || (n.pages.find(p => p.todo) || n.pages[0]);
        const oi = n.pages.indexOf(origin);
        if (oi >= 0 && origin.todo) pullBack(n, oi);
        persist(n);
        try { if (typeof buildPages === 'function') buildPages(); } catch (_) {}
      }
      return r;
    };

    const prevTmr = V21fh.hooks.todoToggleTomorrow;
    V21fh.hooks.todoToggleTomorrow = async function (core, ctx, args) {
      installToastGuard();
      const pi = args[0];
      const force = args[1];
      const n = guardNote(); if (!n) return false;
      const pg = n.pages[pi];
      const origin = (pg && originOf(n, pg)) || (n.pages.find(p => p.todo) || n.pages[0]);
      if (!origin || !origin.todo) {
        return typeof prevTmr === 'function' ? prevTmr(core, ctx, args) : core.apply(ctx, args);
      }
      if (chainHasTomorrow(n, origin)) {
        return hideTomorrowInChain(n, origin, force);
      }
      if (typeof pushHistory === 'function') pushHistory();
      origin.todo.tomorrow = true;
      if (origin.todo.tmrLines == null || (origin.todo.tmrLines | 0) < 1) origin.todo.tmrLines = TMR_DEF;
      const oi = n.pages.indexOf(origin);
      const dest = reflowOrigin(n, oi);
      commitPages(n, dest, dest !== oi ? 'Continued on the next page' : null);
      return true;
    };
  }

  function addUntilCont(pi, sec) {
    const n = guardNote(); if (!n) return { ok: false };
    const start = n.pages.length;
    const origin = n.pages[pi];
    const oid = origin && origin.id;
    let steps = 0;
    while (n.pages.length === start && steps < 80) {
      const ok = window.V21ff && V21ff.todoAdd(pi, sec || 'tasks');
      steps++;
      if (!ok) break;
    }
    const pages = (typeof curNote === 'function' ? curNote() : n).pages;
    const flowed = pages.some(p => p.todoCont && (!oid || p.todoCont.of === oid));
    return { ok: flowed || pages.length > start, pages: pages.length, steps, addedOn: pages.length - 1 };
  }

  function boot() {
    installToastGuard();
    hookTodo();
    hookCustom();
    hookQuotes();
    hookDraw();
    hookClicks();
  }

  window.V21fj = {
    version: VERSION,
    splitTodo, layoutFlow, isFlow, reflowOrigin, addUntilCont,
    chainHasTomorrow, syncTomorrowToggle,
    BLOCKED_TOAST
  };

  boot();
  if (!window.__ready) {
    const t0 = Date.now();
    const iv = setInterval(() => {
      boot();
      if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); boot(); }
    }, 50);
  }
})();
