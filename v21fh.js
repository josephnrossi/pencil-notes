/* Pencil Notes v21fh — auto-continuation pages for templates, easier custom
   template builder, and more module types. Overlay on v21ff/v21fg.
   Does not open or upgrade the notes database (inkminder). Sales Leads stays
   hidden; safe-area topbar is left intact. No handwriting recognition/OCR. */
(() => {
  'use strict';
  const VERSION = 'v21fh';
  const X = 40, W = 920, GAP = 14, HEAD = 36, ROW = 48, BOX = 26, LH = 40, TOP = 36;
  const LIMIT = (typeof PAGE_H === 'number' ? PAGE_H : 1430) - 24;
  const CALC_PRESET = { S: 0.8, M: 1, L: 1.4 };
  const CALC_SZ_MIN = 0.75, CALC_SZ_MAX = 1.7;
  const CALC_BASE_W = 320, CALC_FACE_H = 480;
  const CALC_LS = 'pencil-notes-v21fh-calc-sz';
  function clampCalcSz(n) {
    n = +n;
    if (!isFinite(n)) return 1;
    return Math.max(CALC_SZ_MIN, Math.min(CALC_SZ_MAX, Math.round(n * 100) / 100));
  }
  function calcSzOf(m, st) {
    const v = (m && m.calcSz != null) ? m.calcSz : (st && st.calcSz);
    return clampCalcSz(v != null ? v : 1);
  }
  function calcPresetName(sz) {
    sz = clampCalcSz(sz);
    for (const k of ['S', 'M', 'L']) if (Math.abs(CALC_PRESET[k] - sz) < 0.04) return k;
    return '';
  }
  const NEW_TYPES = ['numbered', 'dotgrid', 'table', 'matrix', 'schedule', 'attendees', 'datestrip', 'habits', 'sketch', 'calc'];
  const LIST_TYPES = /^(checklist|actions|priorities|numbered|attendees|lines|columns|tomorrow|quote|table|grid|dotgrid|habits|schedule)$/;
  const ROW_TYPES = /^(checklist|actions|priorities|numbered|attendees)$/;
  const LINE_TYPES = /^(lines|columns|tomorrow)$/;
  const TABLE_TYPES = /^(quote|table)$/;
  const GRID_TYPES = /^(grid|dotgrid)$/;

  const hooks = {};
  let hist = [];
  let histI = -1;
  let skipHist = false;
  let suppressClose = false;

  const $1 = s => document.querySelector(s);
  const toastMsg = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  const persist = n => { if (n && !n.lock) { try { saveNote(n, true); } catch (_) {} } };
  const newId = p => (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const guardNote = () => {
    const n = typeof curNote === 'function' ? curNote() : null;
    if (!n) return null;
    if (sealed(n)) { toastMsg('Unlock the note first'); return null; }
    return n;
  };
  const sbb = s => { if (s.bb && s.bb.length) return s.bb; try { return (typeof bbox === 'function') ? bbox(s.points) : [0, 0, 0, 0]; } catch (_) { return [0, 0, 0, 0]; } };
  const ccx = s => { const b = sbb(s); return (b[0] + b[2]) / 2; };
  const ccy = s => { const b = sbb(s); return (b[1] + b[3]) / 2; };
  const inR = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const inkOf = pg => (pg && pg.strokes || []).filter(s => s.points && s.points.length);
  const pageHasWriting = pg => !!(inkOf(pg).length || (pg.texts || []).length || (pg.images || []).length || (pg.tasks || []).length || (pg.labels || []).length);
  function shiftInkLocal(pg, y0, dy) {
    if (!pg || !dy) return;
    for (const s of pg.strokes || []) if (ccy(s) >= y0) {
      s.points = s.points.map(pt => { const q = pt.slice(); q[1] += dy; return q; });
      try { s.bb = bbox(s.points); } catch (_) {}
    }
    for (const tx of pg.texts || []) if ((tx.y + 10) >= y0) tx.y += dy;
  }
  const TD = () => (window.V21ee && V21ee.TD) || { X, W, TOP: 104, GAP: 16, HEAD, ROW, ADD: 36, NOTES: 150, NOTE_LH: LH, TMR: 132, BOX, DEF: 1 };
  const pal = () => {
    const d = typeof isDark === 'function' && isDark();
    return {
      paper: d ? '#1f1f23' : '#fffdf8', box: d ? 'rgba(255,255,255,.03)' : '#ffffff',
      block: d ? 'rgba(255,255,255,.015)' : 'rgba(250,249,245,1)',
      edge: d ? 'rgba(200,200,220,.26)' : 'rgba(60,60,80,.24)',
      rule: d ? 'rgba(200,200,220,.20)' : 'rgba(60,60,80,.20)',
      gray: d ? 'rgba(200,200,215,.62)' : 'rgba(70,70,90,.6)',
      ink: d ? '#e6e6ea' : '#1d1d1f', accent: d ? '#8b85ff' : '#4f46e5'
    };
  };
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const lab = (ctx, c, t, x, y, size) => {
    const font = typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif';
    ctx.fillStyle = c.gray; ctx.font = '700 ' + (size || 12) + 'px ' + font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px';
    ctx.fillText(String(t || '').toUpperCase(), x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  };
  const fontFam = () => (typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif');

  function commitPages(n, focusPi, msg) {
    persist(n);
    try { if (window.thumbCache && thumbCache.clear) thumbCache.clear(); } catch (_) {}
    if (typeof buildPages === 'function') buildPages();
    else {
      if (typeof renderPageInk === 'function' && focusPi != null) renderPageInk(focusPi);
      if (typeof renderOverlay === 'function' && focusPi != null) renderOverlay(focusPi);
    }
    if (focusPi != null && typeof pageEls !== 'undefined' && pageEls[focusPi] && $1('#pages')) {
      try { $1('#pages').scrollTo({ top: pageEls[focusPi].el.offsetTop - 8, behavior: 'smooth' }); } catch (_) {}
    }
    if (msg && typeof actionToast === 'function') actionToast(msg, 'Undo', () => restore(S.undo, S.redo), 5000);
  }

  const SEC_TITLE = { tasks: 'To-Do (cont.)', pri: 'Priorities (cont.)', notes: 'Notes (cont.)', tomorrow: 'Tomorrow (cont.)' };
  function contTitle(sec, heading) {
    if (heading && String(heading).trim()) {
      const h = String(heading).trim();
      return /cont\.\s*$/i.test(h) ? h : h + ' (cont.)';
    }
    return SEC_TITLE[sec] || 'Continued (cont.)';
  }

  /* ---------- Daily To-Do continuation ---------- */
  function layoutTodo(t) { return window.V21ff && V21ff.layoutTodo ? V21ff.layoutTodo(t) : null; }

  function todoWouldOverflow(pg, sec) {
    const t = pg.todo; if (!t || !window.V21ff) return false;
    return V21ff.layoutTodo ? (function () {
      const t2 = JSON.parse(JSON.stringify(t));
      if (sec === 'pri') t2.pri = (t2.pri || []).concat([{ id: 'tmp', done: false }]);
      else if (sec === 'tasks') t2.rows = (t2.rows || []).concat([{ id: 'tmp', done: false }]);
      else if (sec === 'notes') t2.notesLines = (V21ff.notesCount(t2) + 1);
      else if (sec === 'tomorrow') t2.tmrLines = (V21ff.tmrCount(t2) + 1);
      else return false;
      const L = V21ff.layoutTodo(t2);
      return !!(L && L.bottom > LIMIT);
    })() : false;
  }

  function layoutTodoCont(pg) {
    const D = TD(), sec = pg.todoCont && pg.todoCont.section, t = pg.todoCont;
    const y0 = 108;
    const box = { x: D.X, y: y0, w: D.W };
    const row = (list, i) => ({
      i, id: list[i].id,
      y: y0 + D.HEAD + i * D.ROW, h: D.ROW,
      check: { x: D.X + 22, y: y0 + D.HEAD + i * D.ROW + (D.ROW - D.BOX) / 2 },
      write: { x: D.X + 62, y: y0 + D.HEAD + i * D.ROW, w: D.W - 74, h: D.ROW }
    });
    if (sec === 'pri' || sec === 'tasks') {
      const list = (sec === 'pri' ? t.pri : t.rows) || [];
      box.h = D.HEAD + list.length * D.ROW + D.ADD;
      const rows = list.map((_, i) => row(list, i));
      return { box, rows, list, add: { x: D.X + 12, y: y0 + D.HEAD + list.length * D.ROW }, bottom: y0 + box.h, sec };
    }
    const nL = sec === 'notes' ? Math.max(1, t.notesLines || 1) : Math.max(1, t.tmrLines || 1);
    box.h = D.HEAD + nL * D.NOTE_LH + 10;
    return { box, lineN: nL, bottom: y0 + box.h, sec };
  }

  function todoContFitsAdd(pg) {
    const L = layoutTodoCont(pg), D = TD();
    const dy = (pg.todoCont.section === 'pri' || pg.todoCont.section === 'tasks') ? D.ROW : D.NOTE_LH;
    return L.bottom + dy <= LIMIT;
  }

  function newTodoCont(origin, sec, first) {
    const p = (typeof newPage === 'function' ? newPage() : { id: newId('p'), strokes: [], texts: [], tasks: [], images: [] });
    p.paper = 'blank';
    const rec = { v: 1, of: origin.id, section: sec, title: contTitle(sec) };
    if (sec === 'pri') rec.pri = first ? [first] : [{ id: newId('tp'), done: false }];
    else if (sec === 'tasks') rec.rows = first ? [first] : [{ id: newId('tr'), done: false }];
    else if (sec === 'notes') rec.notesLines = 1;
    else if (sec === 'tomorrow') { rec.tmrLines = 1; rec.tomorrow = true; }
    p.todoCont = rec;
    return p;
  }

  function pagesOfCont(n, ofId, section) {
    return (n.pages || []).map((p, i) => ({ p, i })).filter(x => x.p.todoCont && x.p.todoCont.of === ofId && x.p.todoCont.section === section);
  }

  function originPage(n, pg) {
    if (!pg) return null;
    if (pg.todoCont) return (n.pages || []).find(p => p.id === pg.todoCont.of) || pg;
    return pg;
  }

  function ensureTodoCont(n, origin, sec, first) {
    const chain = pagesOfCont(n, origin.id, sec);
    for (let k = chain.length - 1; k >= 0; k--) if (todoContFitsAdd(chain[k].p)) return chain[k].i;
    const after = chain.length ? chain[chain.length - 1].i + 1 : n.pages.indexOf(origin) + 1;
    const p = newTodoCont(origin, sec, first);
    n.pages.splice(after, 0, p);
    return after;
  }

  function addLineToTodoCont(pg, sec) {
    const t = pg.todoCont;
    if (sec === 'pri') t.pri = (t.pri || []).concat([{ id: newId('tp'), done: false }]);
    else if (sec === 'tasks') t.rows = (t.rows || []).concat([{ id: newId('tr'), done: false }]);
    else if (sec === 'notes') t.notesLines = (t.notesLines || 1) + 1;
    else if (sec === 'tomorrow') t.tmrLines = (t.tmrLines || 1) + 1;
    else return false;
    return true;
  }

  function todoContLineCount(pg) {
    const t = pg.todoCont, sec = t && t.section;
    if (sec === 'pri') return (t.pri || []).length;
    if (sec === 'tasks') return (t.rows || []).length;
    if (sec === 'notes') return t.notesLines || 0;
    if (sec === 'tomorrow') return t.tmrLines || 0;
    return 0;
  }

  function maybeCollapseCont(n, pi) {
    const pg = n.pages[pi]; if (!pg) return pi;
    const emptyList = (pg.todoCont && todoContLineCount(pg) <= 0) || (pg.customTpl && pg.customTpl.cont && customContEmpty(pg));
    if (!emptyList) return pi;
    if (pageHasWriting(pg)) return pi;
    n.pages.splice(pi, 1);
    return Math.max(0, pi - 1);
  }

  hooks.todoAdd = function (core, ctx, args) {
    const pi = args[0], sec = args[1];
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg) return false;
    if (pg.todoCont) {
      if (pg.todoCont.section !== sec) return false;
      if (todoContFitsAdd(pg)) {
        if (typeof pushHistory === 'function') pushHistory();
        addLineToTodoCont(pg, sec);
        commitPages(n, pi);
        return true;
      }
      const origin = originPage(n, pg);
      if (typeof pushHistory === 'function') pushHistory();
      const dest = ensureTodoCont(n, origin, sec);
      if (dest !== pi) addLineToTodoCont(n.pages[dest], sec);
      commitPages(n, dest, 'Continued on the next page');
      return true;
    }
    if (!pg.todo) return core.apply(ctx, args);
    if (!todoWouldOverflow(pg, sec)) return core.apply(ctx, args);
    if (typeof pushHistory === 'function') pushHistory();
    const dest = ensureTodoCont(n, pg, sec);
    commitPages(n, dest, 'Continued on the next page');
    return true;
  };

  function todoChain(n, pg, sec) {
    const origin = originPage(n, pg);
    if (!origin) return [];
    const id = origin.id;
    const out = [];
    (n.pages || []).forEach((p, i) => {
      if (p === origin && p.todo) out.push({ p, i, origin: true });
      else if (p.todoCont && p.todoCont.of === id && p.todoCont.section === sec) out.push({ p, i, origin: false });
    });
    return out;
  }

  hooks.todoRemoveLast = async function (core, ctx, args) {
    const pi = args[0], sec = args[1];
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg) return false;
    const chain = todoChain(n, pg, sec);
    if (chain.length > 1 || (pg.todoCont && chain.length)) {
      const last = chain[chain.length - 1];
      if (last && !last.origin) {
        const t = last.p.todoCont;
        if (todoContLineCount(last.p) <= 1) {
          if (pageHasWriting(last.p) && !(window.V21ff && V21ff._autoConfirm)) {
            if (typeof V21ff.confirmBox === 'function') {
              const ok = await V21ff.confirmBox('Remove this page?', 'This continuation page has handwriting. Removing the last line also removes that writing. You can undo this.', 'Remove');
              if (!ok) return false;
            }
          }
          if (typeof pushHistory === 'function') pushHistory();
          if (sec === 'pri') t.pri = [];
          else if (sec === 'tasks') t.rows = [];
          else if (sec === 'notes') t.notesLines = 0;
          else if (sec === 'tomorrow') t.tmrLines = 0;
          const focus = maybeCollapseCont(n, last.i);
          commitPages(n, focus, 'Line removed');
          return true;
        }
        if (typeof pushHistory === 'function') pushHistory();
        if (sec === 'pri') t.pri = t.pri.slice(0, -1);
        else if (sec === 'tasks') t.rows = t.rows.slice(0, -1);
        else if (sec === 'notes') t.notesLines -= 1;
        else if (sec === 'tomorrow') t.tmrLines -= 1;
        const focus = maybeCollapseCont(n, last.i);
        commitPages(n, focus, 'Line removed');
        return true;
      }
    }
    return core.apply(ctx, args);
  };

  function afterSpecificRemove(n, pi) {
    const pg = n.pages[pi];
    if (pg && pg.todoCont && todoContLineCount(pg) <= 0) {
      const focus = maybeCollapseCont(n, pi);
      commitPages(n, focus, 'Line removed');
      return true;
    }
    return false;
  }

  hooks.todoRemoveTaskAt = async function (core, ctx, args) {
    const r = await core.apply(ctx, args);
    if (r) {
      const n = typeof curNote === 'function' ? curNote() : null;
      if (n) afterSpecificRemove(n, args[0]);
    }
    return r;
  };
  hooks.todoRemovePriAt = hooks.todoRemoveTaskAt;

  function drawTodoCont(ctx, pg) {
    const t = pg.todoCont, L = layoutTodoCont(pg), c = pal(), D = TD();
    if (!t || !L) return;
    const font = fontFam();
    const PW = typeof PAGE_W === 'number' ? PAGE_W : 1000, PH = typeof PAGE_H === 'number' ? PAGE_H : 1430;
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, PW, PH);
    ctx.fillStyle = c.ink; ctx.font = '700 32px ' + font;
    ctx.fillText(t.title || contTitle(t.section), D.X + 4, 62);
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(D.X, 90); ctx.lineTo(D.X + D.W, 90); ctx.stroke();
    rr(ctx, L.box.x, L.box.y, L.box.w, L.box.h, 10); ctx.fillStyle = c.block; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke();
    const label = t.section === 'pri' ? '★ Priorities' : t.section === 'tasks' ? 'Tasks' : t.section === 'notes' ? 'Notes' : 'Tomorrow';
    lab(ctx, c, label, L.box.x + 14, L.box.y + 23, 13);
    if (L.rows) {
      L.rows.forEach((r, i) => {
        const k = r.check; rr(ctx, k.x, k.y, D.BOX, D.BOX, 6); ctx.strokeStyle = c.gray; ctx.lineWidth = 2; ctx.stroke();
        if (t.section === 'pri') { ctx.fillStyle = c.accent; ctx.font = '800 15px ' + font; ctx.fillText(String(i + 1), L.box.x + 6, k.y + 19); }
        ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.moveTo(r.write.x, r.y + r.h - 10); ctx.lineTo(r.write.x + r.write.w, r.y + r.h - 10); ctx.stroke();
      });
    } else if (L.lineN) {
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = 0; i < L.lineN; i++) {
        const yy = L.box.y + 36 + D.NOTE_LH - 6 + i * D.NOTE_LH;
        ctx.moveTo(L.box.x + 14, yy); ctx.lineTo(L.box.x + L.box.w - 14, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function placePairLike(rec, box, html, attrs) {
    if (!box || !rec || !rec.ov) return null;
    const s = (typeof S !== 'undefined' && typeof S.scale === 'number' && S.scale > 0) ? S.scale : 1;
    const pw = 72, ph = 32, inset = 8;
    const wrap = document.createElement('div');
    wrap.className = 'ff-pm fh-pm';
    if (attrs) for (const k in attrs) wrap.setAttribute(k, attrs[k]);
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
    return wrap;
  }

  function drawTodoContUI(pi, rec) {
    const n = typeof curNote === 'function' ? curNote() : null;
    const pg = n && n.pages[pi];
    if (!pg || !pg.todoCont || sealed(n)) return;
    rec.ov.querySelectorAll('.fh-pm').forEach(b => b.remove());
    const L = layoutTodoCont(pg), s = (typeof S !== 'undefined' && typeof S.scale === 'number' && S.scale > 0) ? S.scale : 1, D = TD();
    const sec = pg.todoCont.section;
    placePairLike(rec, L.box,
      '<button type="button" class="ff-plus" data-fh-sec="' + sec + '" aria-label="Add a line">＋</button>' +
      '<button type="button" class="ff-minus" data-fh-sec="' + sec + '" aria-label="Remove the last line">−</button>',
      { 'data-fh-sec': sec });
    (L.rows || []).forEach((R, i) => {
      if ((L.list || []).length <= 1) return;
      const d = document.createElement('button');
      d.className = 'ff-delrow fh-pm'; d.dataset.fhSec = sec; d.dataset.id = R.id;
      d.title = 'Remove this line'; d.setAttribute('aria-label', 'Remove line ' + (i + 1));
      d.style.top = (R.y + D.ROW / 2) * s + 'px';
      rec.ov.append(d);
    });
  }

  /* ---------- Custom module continuation ---------- */
  function customWouldOverflow(pg, mid, dy) {
    if (!window.V21ff) return false;
    const L = V21ff.custLayout(pg);
    return L.bottom + dy > LIMIT;
  }
  function stepFor(m) {
    if (ROW_TYPES.test(m.type) || m.type === 'habits') return ROW;
    if (m.type === 'quote' || m.type === 'table') return 44;
    if (GRID_TYPES.test(m.type)) return 40;
    if (m.type === 'schedule') return 36;
    if (m.type === 'matrix') return 36;
    if (m.type === 'sketch' || m.type === 'blank') return 20;
    return LH;
  }
  function customContEmpty(pg) {
    const tpl = pg.customTpl; if (!tpl || !tpl.cont) return false;
    const m = (tpl.modules || [])[0]; if (!m) return true;
    const st = (tpl.state || {})[m.id] || {};
    if (ROW_TYPES.test(m.type) || m.type === 'habits') return !((st.rows || []).length);
    if (LINE_TYPES.test(m.type) || GRID_TYPES.test(m.type) || TABLE_TYPES.test(m.type) || m.type === 'schedule' || m.type === 'matrix') {
      const n = st.lines != null ? st.lines : (st.rows != null ? st.rows : 0);
      return n <= 0;
    }
    return false;
  }
  function pagesOfCustomCont(n, ofId, mid) {
    return (n.pages || []).map((p, i) => ({ p, i })).filter(x => x.p.customTpl && x.p.customTpl.cont && x.p.customTpl.cont.of === ofId && x.p.customTpl.cont.moduleId === mid);
  }
  function seedStateFor(m) {
    const st = {};
    if (ROW_TYPES.test(m.type) || m.type === 'habits') st.rows = [{ id: newId('cr'), done: false }];
    else if (LINE_TYPES.test(m.type)) st.lines = 1;
    else if (TABLE_TYPES.test(m.type) || GRID_TYPES.test(m.type) || m.type === 'schedule' || m.type === 'matrix') st.rows = 1;
    else if (m.type === 'sketch' || m.type === 'blank') st.height = m.height || 180;
    return st;
  }
  function customContFitsAdd(pg) {
    if (!window.V21ff) return false;
    const m = (pg.customTpl.modules || [])[0]; if (!m) return false;
    return !customWouldOverflow(pg, m.id, stepFor(m));
  }
  function ensureCustomCont(n, origin, mid) {
    const src = (origin.customTpl.modules || []).find(m => m.id === mid);
    if (!src) return -1;
    const chain = pagesOfCustomCont(n, origin.id, mid);
    for (let k = chain.length - 1; k >= 0; k--) if (customContFitsAdd(chain[k].p)) return chain[k].i;
    const after = chain.length ? chain[chain.length - 1].i + 1 : n.pages.indexOf(origin) + 1;
    const p = (typeof newPage === 'function' ? newPage() : { id: newId('p'), strokes: [], texts: [], tasks: [], images: [] });
    p.paper = 'blank';
    const mod = JSON.parse(JSON.stringify(src));
    mod.id = newId('tm');
    const heading = src.heading || src.text || src.type;
    mod.heading = contTitle('mod', heading);
    const st = {}; st[mod.id] = seedStateFor(src);
    p.customTpl = {
      v: 1, templateId: origin.customTpl.templateId, name: origin.customTpl.name, color: origin.customTpl.color,
      modules: [mod], state: st, cont: { of: origin.id, moduleId: mid, title: mod.heading }
    };
    p.bg = { type: 'template', name: 'custom', templateId: origin.customTpl.templateId, title: origin.customTpl.name };
    n.pages.splice(after, 0, p);
    return after;
  }

  function applyGrow(st, m) {
    if (ROW_TYPES.test(m.type) || m.type === 'habits') st.rows = (st.rows || []).concat([{ id: newId('cr'), done: false }]);
    else if (LINE_TYPES.test(m.type)) st.lines = ((st.lines != null) ? st.lines : (m.lines || 4)) + 1;
    else if (TABLE_TYPES.test(m.type) || GRID_TYPES.test(m.type) || m.type === 'schedule' || m.type === 'matrix') st.rows = ((st.rows != null) ? st.rows : (m.rows || 4)) + 1;
    else if (m.type === 'sketch' || m.type === 'blank') st.height = (st.height != null ? st.height : (m.height || 180)) + 20;
    else return false;
    return true;
  }

  hooks.custAdd = function (core, ctx, args) {
    const pi = args[0], mid = args[1];
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return false;
    const m = (pg.customTpl.modules || []).find(x => x.id === mid) || (pg.customTpl.modules || [])[0];
    if (!m) return core.apply(ctx, args);
    const useId = m.id;
    if (!customWouldOverflow(pg, useId, stepFor(m))) {
      if (ROW_TYPES.test(m.type) && /^(checklist|actions|priorities)$/.test(m.type)) return core.apply(ctx, args);
      if (LINE_TYPES.test(m.type) || m.type === 'quote' || m.type === 'grid') return core.apply(ctx, args);
      const box = (window.V21ff.custLayout(pg).boxes || []).find(b => b.m.id === useId);
      const y0 = box ? box.y + box.h : 0;
      if (typeof pushHistory === 'function') pushHistory();
      const st = (pg.customTpl.state[useId] || (pg.customTpl.state[useId] = {}));
      if (!applyGrow(st, m)) return core.apply(ctx, args);
      shiftInkLocal(pg, y0, stepFor(m));
      persist(n);
      try { if (window.thumbCache && thumbCache.clear) thumbCache.clear(); } catch (_) {}
      if (typeof renderPageInk === 'function') renderPageInk(pi);
      if (typeof renderOverlay === 'function') renderOverlay(pi);
      return true;
    }
    const origin = pg.customTpl.cont ? ((n.pages || []).find(p => p.id === pg.customTpl.cont.of) || pg) : pg;
    const srcId = pg.customTpl.cont ? pg.customTpl.cont.moduleId : useId;
    const beforeIds = pagesOfCustomCont(n, origin.id, srcId).map(x => x.p.id);
    if (typeof pushHistory === 'function') pushHistory();
    const dest = ensureCustomCont(n, origin, srcId);
    if (dest < 0) return false;
    const dpg = n.pages[dest];
    const dm = dpg.customTpl.modules[0];
    const st = dpg.customTpl.state[dm.id] || (dpg.customTpl.state[dm.id] = {});
    if (beforeIds.indexOf(dpg.id) >= 0) applyGrow(st, dm);
    commitPages(n, dest, 'Continued on the next page');
    return true;
  };

  hooks.custRemoveLast = async function (core, ctx, args) {
    const pi = args[0], mid = args[1];
    const n = guardNote(); if (!n) return false;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return core.apply(ctx, args);
    const origin = pg.customTpl.cont ? ((n.pages || []).find(p => p.id === pg.customTpl.cont.of) || pg) : pg;
    const srcId = pg.customTpl.cont ? pg.customTpl.cont.moduleId : mid;
    const chain = [{ p: origin, i: n.pages.indexOf(origin), origin: !origin.customTpl || !origin.customTpl.cont }].concat(pagesOfCustomCont(n, origin.id, srcId));
    /* unique by index */
    const seen = new Set(); const uniq = [];
    chain.forEach(x => { if (x.i >= 0 && !seen.has(x.i)) { seen.add(x.i); uniq.push(x); } });
    const last = uniq[uniq.length - 1];
    if (last && last.p.customTpl && last.p.customTpl.cont) {
      const m = last.p.customTpl.modules[0];
      const st = last.p.customTpl.state[m.id] || {};
      const count = (st.rows && st.rows.length) || st.lines || st.rows || 0;
      if (count <= 1) {
        if (typeof pushHistory === 'function') pushHistory();
        if (st.rows) st.rows = [];
        st.lines = 0; st.rows = st.rows && st.rows.length ? st.rows : (Array.isArray(st.rows) ? [] : 0);
        if (ROW_TYPES.test(m.type) || m.type === 'habits') st.rows = [];
        const focus = maybeCollapseCont(n, last.i);
        commitPages(n, focus, 'Line removed');
        return true;
      }
    }
    const r = await core.apply(ctx, args);
    if (r && n.pages[pi] && n.pages[pi].customTpl && n.pages[pi].customTpl.cont && customContEmpty(n.pages[pi])) {
      const focus = maybeCollapseCont(n, pi);
      commitPages(n, focus, 'Line removed');
    }
    return r;
  };

  /* ---------- New module types ---------- */
  const EXTRA = [
    { type: 'numbered', label: 'Numbered list', group: 'Lists', blurb: '1, 2, 3… with write-in lines', def: () => ({ heading: 'List', rows: 4 }) },
    { type: 'dotgrid', label: 'Dot grid', group: 'Pages', blurb: 'Dots for sketching or graphs', def: () => ({ heading: '', rows: 8 }) },
    { type: 'table', label: 'Table', group: 'Lists', blurb: 'Rows and named columns', def: () => ({ heading: 'Table', rows: 4, cols: ['A', 'B', 'C'] }) },
    { type: 'matrix', label: 'Priority matrix', group: 'Planning', blurb: 'Urgent / important quadrants', def: () => ({ heading: 'Priority matrix', rows: 3 }) },
    { type: 'schedule', label: 'Schedule / time blocks', group: 'Planning', blurb: 'Hour slots for a day', def: () => ({ heading: 'Schedule', start: '08:00', end: '18:00', slot: 60, rows: 10 }) },
    { type: 'attendees', label: 'Meeting attendees', group: 'Meeting', blurb: 'Names with checkboxes', def: () => ({ heading: 'Attendees', rows: 5, checks: true }) },
    { type: 'datestrip', label: 'Date strip', group: 'Decor', blurb: 'A clear date line', def: () => ({ heading: 'Date' }) },
    { type: 'habits', label: 'Habit tracker', group: 'Planning', blurb: 'Habits across the week', def: () => ({ heading: 'Habits', rows: 5, days: 7 }) },
    { type: 'sketch', label: 'Sketch box', group: 'Pages', blurb: 'Open box for a drawing', def: () => ({ heading: 'Sketch', height: 220 }) },
    { type: 'calc', label: 'Calculator', group: 'Tools', blurb: 'A keypad you can use on the page', def: () => ({ heading: 'Calculator' }) }
  ];
  const GROUPS = {
    title: 'Decor', heading: 'Decor', divider: 'Decor', datestrip: 'Decor',
    lines: 'Pages', columns: 'Pages', grid: 'Pages', dotgrid: 'Pages', blank: 'Pages', sketch: 'Pages',
    checklist: 'Lists', numbered: 'Lists', priorities: 'Lists', table: 'Lists', quote: 'Lists',
    meeting: 'Meeting', attendees: 'Meeting', actions: 'Meeting', tomorrow: 'Meeting',
    matrix: 'Planning', schedule: 'Planning', habits: 'Planning', calc: 'Tools'
  };
  const BLURBS = {
    title: 'Title and optional date', heading: 'Section label', divider: 'A thin rule',
    lines: 'Handwriting lines', columns: 'Two columns of lines', grid: 'Square grid',
    blank: 'Open drawing area', checklist: 'Tasks with checkboxes', priorities: 'Ranked list',
    meeting: 'Title, date, people, place', actions: 'Owners and follow-ups',
    tomorrow: 'Carry-over lines', quote: 'Quote / line-item table'
  };

  function installModules() {
    if (!window.V21ff || !V21ff.MODULES) return;
    const have = new Set(V21ff.MODULES.map(m => m.type));
    for (const m of V21ff.MODULES) {
      if (!m.group) m.group = GROUPS[m.type] || 'More';
      if (!m.blurb) m.blurb = BLURBS[m.type] || '';
    }
    for (const m of EXTRA) if (!have.has(m.type)) V21ff.MODULES.push(m);
  }

  function rowsOf(m, st) { return (st && st.rows && st.rows.length) ? st.rows.length : (typeof (st && st.rows) === 'number' ? st.rows : (m.rows || 3)); }
  function numRows(m, st) { return (st && st.rows != null && !Array.isArray(st.rows)) ? st.rows : (Array.isArray(st && st.rows) ? st.rows.length : (m.rows || 4)); }

  hooks.moduleHeight = function (core, ctx, args) {
    const m = args[0], st = args[1];
    if (!m) return core.apply(ctx, args);
    if (m.type === 'numbered' || m.type === 'attendees') return HEAD + rowsOf(m, st) * ROW + 8;
    if (m.type === 'dotgrid') return HEAD + numRows(m, st) * 40 + 8;
    if (m.type === 'table') return HEAD + 28 + numRows(m, st) * 44 + 8;
    if (m.type === 'matrix') return HEAD + 28 + 2 * (numRows(m, st) * 32 + 28) + 8;
    if (m.type === 'schedule') return HEAD + Math.max(1, numRows(m, st)) * 36 + 8;
    if (m.type === 'datestrip') return 56;
    if (m.type === 'habits') return HEAD + 28 + rowsOf(m, st) * 36 + 8;
    if (m.type === 'sketch') return HEAD + ((st && st.height != null) ? st.height : (m.height || 220));
    if (m.type === 'calc') return HEAD + Math.round(CALC_FACE_H * calcSzOf(m, st));
    return core.apply(ctx, args);
  };

  hooks.freshState = function (core, ctx, args) {
    const s = core.apply(ctx, args) || {};
    for (const m of (args[0] || [])) {
      if (s[m.id]) continue;
      if (m.type === 'numbered' || m.type === 'attendees' || m.type === 'habits') {
        const n = Math.max(1, m.rows || 4);
        s[m.id] = { rows: Array.from({ length: n }, () => ({ id: newId('cr'), done: false })) };
      } else if (m.type === 'table' || m.type === 'dotgrid' || m.type === 'schedule' || m.type === 'matrix') {
        s[m.id] = { rows: Math.max(1, m.rows || 4) };
      } else if (m.type === 'sketch') {
        s[m.id] = { height: m.height || 220 };
      } else if (m.type === 'calc') {
        s[m.id] = { expr: '', entry: '0', result: null, justEq: false, history: [] };
      }
    }
    return s;
  };

  hooks.growable = function (core, ctx, args) {
    const m = args[0];
    if (m && (LIST_TYPES.test(m.type) || m.type === 'sketch')) return true;
    return core.apply(ctx, args);
  };

  hooks.custLayout = function (core, ctx, args) {
    const L = core.apply(ctx, args);
    const pg = args[0];
    for (const box of (L && L.boxes) || []) {
      const m = box.m, st = box.st, y = box.y;
      if (m.type === 'numbered' || m.type === 'attendees') {
        const list = (st && st.rows) || [];
        box.rows = list.map((r, i) => ({
          i, id: r.id, y: y + HEAD + i * ROW, h: ROW,
          check: { x: X + 22, y: y + HEAD + i * ROW + (ROW - BOX) / 2 },
          write: { x: X + 62, y: y + HEAD + i * ROW, w: W - 74, h: ROW }
        }));
      }
      if (m.type === 'habits') {
        const list = (st && st.rows) || [];
        box.rows = list.map((r, i) => ({ i, id: r.id, y: y + HEAD + 28 + i * 36, h: 36 }));
      }
    }
    return L;
  };

  function parseHM(s) {
    const m = String(s || '08:00').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 8 * 60;
    return Math.max(0, Math.min(24 * 60 - 1, (+m[1]) * 60 + (+m[2])));
  }
  function fmtHM(mins) {
    const h = Math.floor(mins / 60) % 24, mm = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  hooks.drawCustom = function (core, ctx, args) {
    core.apply(ctx, args);
    const c2 = args[0], pg = args[1]; if (!pg || !pg.customTpl || !window.V21ff) return;
    const L = V21ff.custLayout(pg), c = pal(), font = fontFam();
    c2.save(); c2.textBaseline = 'alphabetic';
    /* Leave a gap at the right of the title DATE line so the builder Edit
       button (and the page edge) don't sit on the rule. */
    for (const b of L.boxes) {
      if (b.hidden || !b.m || b.m.type !== 'title' || b.m.showDate === false) continue;
      const y = b.y + b.h - 12;
      c2.fillStyle = c.paper || '#fffdf8';
      c2.fillRect(b.x + b.w - 86, y - 4, 88, 8);
    }
    for (const b of L.boxes) {
      if (b.hidden) continue;
      const m = b.m, st = b.st;
      const boxy = () => { rr(c2, b.x, b.y, b.w, b.h, 10); c2.fillStyle = c.block; c2.fill(); c2.strokeStyle = c.edge; c2.lineWidth = 1.2; c2.stroke(); };
      if (m.type === 'numbered') {
        boxy(); lab(c2, c, m.heading || 'List', b.x + 14, b.y + 23, 13);
        (b.rows || []).forEach((r, i) => {
          c2.fillStyle = c.accent; c2.font = '800 15px ' + font; c2.fillText(String(i + 1) + '.', b.x + 14, r.check.y + 19);
          c2.strokeStyle = c.rule; c2.lineWidth = 1.2; c2.beginPath();
          c2.moveTo(r.write.x, r.y + r.h - 10); c2.lineTo(r.write.x + r.write.w, r.y + r.h - 10); c2.stroke();
        });
      } else if (m.type === 'attendees') {
        boxy(); lab(c2, c, m.heading || 'Attendees', b.x + 14, b.y + 23, 13);
        (b.rows || []).forEach(r => {
          const k = r.check; rr(c2, k.x, k.y, BOX, BOX, 6); c2.strokeStyle = c.gray; c2.lineWidth = 2; c2.stroke();
          c2.strokeStyle = c.rule; c2.lineWidth = 1.2; c2.beginPath();
          c2.moveTo(r.write.x, r.y + r.h - 10); c2.lineTo(r.write.x + r.write.w, r.y + r.h - 10); c2.stroke();
        });
      } else if (m.type === 'dotgrid') {
        boxy(); if (m.heading) lab(c2, c, m.heading, b.x + 14, b.y + 23, 13);
        const top = b.y + (m.heading ? HEAD : 8), bot = b.y + b.h - 8, left = b.x + 10, right = b.x + b.w - 10;
        c2.fillStyle = c.rule;
        for (let yy = top; yy <= bot + 0.5; yy += 20)
          for (let xx = left; xx <= right + 0.5; xx += 20) { c2.beginPath(); c2.arc(xx, yy, 1.15, 0, Math.PI * 2); c2.fill(); }
      } else if (m.type === 'table') {
        boxy(); lab(c2, c, m.heading || 'Table', b.x + 14, b.y + 23, 13);
        const cols = m.cols && m.cols.length ? m.cols : ['A', 'B', 'C'];
        const rows = numRows(m, st);
        const cw = (b.w - 16) / cols.length;
        const headY = b.y + HEAD + 20;
        c2.fillStyle = c.gray; c2.font = '700 11px ' + font;
        cols.forEach((name, i) => c2.fillText(String(name).toUpperCase(), b.x + 12 + i * cw, headY - 6));
        c2.strokeStyle = c.rule; c2.lineWidth = 1.1; c2.beginPath();
        for (let r = 0; r <= rows; r++) { const yy = headY + r * 44; c2.moveTo(b.x + 8, yy); c2.lineTo(b.x + b.w - 8, yy); }
        for (let i = 0; i <= cols.length; i++) { const xx = b.x + 8 + i * cw; c2.moveTo(xx, headY - 22); c2.lineTo(xx, headY + rows * 44); }
        c2.stroke();
      } else if (m.type === 'matrix') {
        boxy(); lab(c2, c, m.heading || 'Priority matrix', b.x + 14, b.y + 23, 13);
        const midX = b.x + b.w / 2, top = b.y + HEAD + 8, midY = top + (b.y + b.h - 8 - top) / 2, bot = b.y + b.h - 8;
        const labels = [['Urgent · Important', 'Not urgent · Important'], ['Urgent · Not important', 'Not urgent · Not important']];
        const cells = [[b.x + 8, top, midX - 8, midY - 4], [midX + 8, top, b.x + b.w - 8, midY - 4], [b.x + 8, midY + 4, midX - 8, bot], [midX + 8, midY + 4, b.x + b.w - 8, bot]];
        c2.strokeStyle = c.edge; c2.lineWidth = 1.1; c2.beginPath(); c2.moveTo(midX, top); c2.lineTo(midX, bot); c2.moveTo(b.x + 8, midY); c2.lineTo(b.x + b.w - 8, midY); c2.stroke();
        const nR = numRows(m, st);
        cells.forEach((cell, ci) => {
          lab(c2, c, labels[ci >> 1][ci % 2], cell[0] + 4, cell[1] + 16, 10);
          c2.strokeStyle = c.rule; c2.lineWidth = 1; c2.beginPath();
          for (let i = 0; i < nR; i++) { const yy = cell[1] + 28 + i * 32; c2.moveTo(cell[0] + 6, yy); c2.lineTo(cell[2] - 6, yy); }
          c2.stroke();
        });
      } else if (m.type === 'schedule') {
        boxy(); lab(c2, c, m.heading || 'Schedule', b.x + 14, b.y + 23, 13);
        const start = parseHM(m.start || '08:00'), slot = Math.max(15, +(m.slot || 60));
        const nR = numRows(m, st);
        c2.font = '600 13px ' + font;
        for (let i = 0; i < nR; i++) {
          const yy = b.y + HEAD + 8 + i * 36;
          c2.fillStyle = c.gray; c2.fillText(fmtHM(start + i * slot), b.x + 16, yy + 22);
          c2.strokeStyle = c.rule; c2.lineWidth = 1.2; c2.beginPath();
          c2.moveTo(b.x + 90, yy + 24); c2.lineTo(b.x + b.w - 14, yy + 24); c2.stroke();
        }
      } else if (m.type === 'datestrip') {
        lab(c2, c, m.heading || 'Date', b.x + 4, b.y + 20, 12);
        c2.strokeStyle = c.rule; c2.lineWidth = 1.6; c2.beginPath();
        c2.moveTo(b.x + 80, b.y + 40); c2.lineTo(b.x + b.w, b.y + 40); c2.stroke();
      } else if (m.type === 'habits') {
        boxy(); lab(c2, c, m.heading || 'Habits', b.x + 14, b.y + 23, 13);
        const days = Math.max(5, Math.min(14, m.days || 7));
        const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];
        const left = b.x + 200, cell = Math.min(36, (b.w - 220) / days);
        c2.fillStyle = c.gray; c2.font = '700 11px ' + font;
        for (let d = 0; d < days; d++) c2.fillText(letters[d], left + d * cell + 8, b.y + HEAD + 16);
        (b.rows || []).forEach((r, i) => {
          c2.strokeStyle = c.rule; c2.lineWidth = 1.1; c2.beginPath();
          c2.moveTo(b.x + 14, r.y + 28); c2.lineTo(b.x + 190, r.y + 28); c2.stroke();
          for (let d = 0; d < days; d++) {
            const xx = left + d * cell + 4, yy = r.y + 8;
            rr(c2, xx, yy, 20, 20, 4); c2.strokeStyle = c.gray; c2.lineWidth = 1.4; c2.stroke();
          }
        });
      } else if (m.type === 'sketch') {
        boxy(); if (m.heading) lab(c2, c, m.heading, b.x + 14, b.y + 23, 13);
      } else if (m.type === 'calc') {
        boxy(); if (m.heading) lab(c2, c, m.heading, b.x + 14, b.y + 23, 13);
        drawCalcFace(c2, b.x + 10, b.y + (m.heading ? HEAD : 8), b.w - 20, b.h - (m.heading ? HEAD : 16) - 8, st);
      }
    }
    c2.restore();
  };

  /* ---------- Builder ease-of-use ---------- */
  const STARTERS = [
    { key: 'todo', label: 'Start from To-Do', mods: [['title', { heading: 'Daily To-Do', showDate: true }], ['priorities', { heading: 'Top 3 priorities', rows: 3 }], ['checklist', { heading: 'Tasks', rows: 8 }], ['lines', { heading: 'Notes', lines: 4 }]] },
    { key: 'meeting', label: 'Start from Meeting', mods: [['title', { heading: 'Meeting', showDate: true }], ['meeting', {}], ['attendees', { heading: 'Attendees', rows: 5 }], ['actions', { heading: 'Action items', rows: 4 }]] },
    { key: 'notes', label: 'Start from Notes', mods: [['title', { heading: '', showDate: true }], ['lines', { heading: 'Notes', lines: 14 }]] }
  ];

  function snapBuilder() {
    if (skipHist || !window.V21ff) return;
    const st = V21ff.builderState(); if (!st) return;
    const shot = { name: st.name, color: st.color, modules: JSON.parse(JSON.stringify(st.modules || [])) };
    hist = hist.slice(0, histI + 1);
    hist.push(shot);
    if (hist.length > 40) hist.shift();
    histI = hist.length - 1;
  }
  function repaintBuilder() {
    if (paintCore) hooks.paintBuilderPage(paintCore, null, []);
    const el = document.getElementById('ffBuilder');
    if (el) {
      const page = el.querySelector('#ffPage');
      if (page && window.V21ff && V21ff.builderState()) {
        const mods = el.querySelectorAll('.ff-mod');
        /* rebind hold-drag after paint: hookBuilderPageOnly is internal, so click/edit still works via existing delegation */
      }
    }
  }
  function applySnap(shot) {
    const st = V21ff.builderState(); if (!st || !shot) return;
    skipHist = true;
    st.name = shot.name; st.color = shot.color;
    st.modules.splice(0, st.modules.length, ...JSON.parse(JSON.stringify(shot.modules || [])));
    st.editing = (st.modules[0] && st.modules[0].id) || null;
    const inp = $1('#ffBuilder [data-k="name"]'); if (inp) inp.value = st.name || '';
    repaintBuilder();
    skipHist = false;
  }
  function builderUndo() { if (histI <= 0) return; histI--; applySnap(hist[histI]); }
  function builderRedo() { if (histI >= hist.length - 1) return; histI++; applySnap(hist[histI]); }

  hooks.openBuilder = function (core, ctx, args) {
    const r = core.apply(ctx, args);
    const st = V21ff.builderState();
    hist = st ? [{ name: st.name, color: st.color, modules: JSON.parse(JSON.stringify(st.modules || [])) }] : [];
    histI = 0;
    const el = document.getElementById('ffBuilder');
    if (el) { el.classList.add('fh-builder'); enhanceBuilder(el); }
    return r;
  };

  hooks.addModule = function (core, ctx, args) {
    const m = core.apply(ctx, args);
    const st = V21ff.builderState();
    if (m && st) st.editing = m.id;
    snapBuilder();
    return m;
  };
  hooks.reorderModule = function (core, ctx, args) { const r = core.apply(ctx, args); snapBuilder(); return r; };
  hooks.removeModule = function (core, ctx, args) { const r = core.apply(ctx, args); snapBuilder(); return r; };

  hooks.closeBuilder = function (core, ctx, args) {
    if (suppressClose || args[0] === true) return core.apply(ctx, args);
    const st = V21ff.builderState();
    if (st && st.dirty) {
      const go = window.V21ff && V21ff._autoConfirm ? Promise.resolve(true)
        : V21ff.confirmBox('Discard unsaved changes?', 'This template has changes that have not been saved.', 'Discard');
      Promise.resolve(go).then(ok => { if (ok) { suppressClose = true; try { core.apply(ctx, args); } finally { suppressClose = false; } } });
      return;
    }
    return core.apply(ctx, args);
  };

  hooks.saveBuilder = function (core, ctx, args) {
    suppressClose = true;
    try { return core.apply(ctx, args); } finally { suppressClose = false; }
  };

  hooks.editPanel = function (core, ctx, args) {
    const w = core.apply(ctx, args);
    const m = args[0]; if (!w || !m) return w;
    let extra = '';
    if (m.type === 'numbered' || m.type === 'attendees' || m.type === 'habits' || m.type === 'table' || m.type === 'dotgrid' || m.type === 'schedule' || m.type === 'matrix') {
      if (!w.querySelector('[data-f="rows"]')) {
        extra += '<label>Rows</label><div class="ff-step"><button type="button" data-step="-1">−</button><input type="number" min="1" max="24" data-f="rows" value="' + (m.rows || 4) + '"><button type="button" data-step="1">＋</button></div>';
      }
    }
    if (m.type === 'table' || m.type === 'quote') {
      extra += '<label>Columns (comma separated)<input type="text" data-f="cols" value="' + esc((m.cols || []).join(', ')) + '"></label>';
    }
    if (m.type === 'schedule') {
      extra += '<label>Start<input type="text" data-f="start" value="' + esc(m.start || '08:00') + '"></label>';
      extra += '<label>End<input type="text" data-f="end" value="' + esc(m.end || '18:00') + '"></label>';
      extra += '<label>Minutes per block<input type="number" min="15" step="15" data-f="slot" value="' + (m.slot || 60) + '"></label>';
    }
    if (m.type === 'habits') {
      extra += '<label>Days<input type="number" min="5" max="14" data-f="days" value="' + (m.days || 7) + '"></label>';
    }
    if (m.type === 'sketch') {
      if (!w.querySelector('[data-f="height"]')) {
        extra += '<label>Height</label><div class="ff-step"><button type="button" data-step="-20">−</button><input type="number" min="80" max="800" data-f="height" value="' + (m.height || 220) + '"><button type="button" data-step="20">＋</button></div>';
      }
    }
    if (m.type === 'calc' && !w.querySelector('[data-calc-sz]')) {
      const cur = calcSzOf(m);
      extra += '<label>Size</label><div class="fh-calc-sizes" role="group" aria-label="Calculator size">' +
        [['S', CALC_PRESET.S], ['M', CALC_PRESET.M], ['L', CALC_PRESET.L]].map(([lab, v]) =>
          '<button type="button" data-calc-sz="' + v + '" aria-label="' + ({ S: 'Small', M: 'Medium', L: 'Large' }[lab]) + '"' +
          (Math.abs(cur - v) < 0.04 ? ' class="on"' : '') + '>' + lab + '</button>'
        ).join('') + '</div>';
    }
    extra += '<div class="fh-mod-acts">' +
      '<button type="button" data-a="dupmod">Duplicate</button>' +
      '<button type="button" data-a="upmod">Move up</button>' +
      '<button type="button" data-a="downmod">Move down</button></div>';
    if (extra) w.insertAdjacentHTML('beforeend', extra);
    /* quote cols field was missing a friendly label already present as comma field in meeting only */
    return w;
  };

  let paintCore = null;
  hooks.paintBuilderPage = function (core, ctx, args) {
    paintCore = core;
    const r = core.apply(ctx, args);
    const page = document.getElementById('ffPage'); const st = window.V21ff && V21ff.builderState();
    if (!page || !st) return r;
    page.querySelectorAll('.ff-mod').forEach(el => {
      const m = (st.modules || []).find(x => x.id === el.dataset.id);
      if (m) el.dataset.type = m.type;
    });
    page.querySelectorAll('.ff-empty, .fh-overflow, .fh-resize').forEach(el => el.remove());
    if (!st.modules.length) {
      const empty = document.createElement('div');
      empty.className = 'ff-empty';
      empty.textContent = 'Tap a module on the left to add it, or use a starter above.';
      page.append(empty);
    }
    if (window.V21ff) {
      try {
        const L = V21ff.custLayout({ customTpl: { modules: st.modules, state: {} } });
        if (L && L.bottom > LIMIT) {
          const warn = document.createElement('div');
          warn.className = 'fh-overflow';
          warn.textContent = 'This is taller than one page. Extra lines will continue automatically when you use the template.';
          page.append(warn);
        }
      } catch (_) {}
    }
    return r;
  };

  hooks.hookBuilderEvents = function (core, ctx, args) {
    const el = args[0];
    const r = core.apply(ctx, args);
    enhanceBuilder(el);
    return r;
  };

  function enhanceBuilder(el) {
    if (!el || el._fhEnh) {
      /* re-run after full renderBuilder (innerHTML wipes); always try to inject missing chrome */
    }
    el.classList.add('fh-builder');
    const bar = el.querySelector('.ff-b-bar');
    if (bar && !bar.querySelector('.ff-hist')) {
      const h = document.createElement('div');
      h.className = 'ff-hist';
      h.innerHTML = '<button type="button" class="btn" data-a="undo" aria-label="Undo">Undo</button><button type="button" class="btn" data-a="redo" aria-label="Redo">Redo</button>';
      const save = bar.querySelector('[data-a="save"]');
      save ? bar.insertBefore(h, save) : bar.append(h);
    }
    const pal = el.querySelector('.ff-pal');
    if (pal) {
      if (!pal.querySelector('.ff-starters')) {
        const row = document.createElement('div');
        row.className = 'ff-starters';
        row.innerHTML = STARTERS.map(s => '<button type="button" class="ff-starter" data-starter="' + s.key + '">' + esc(s.label) + '</button>').join('');
        const h3 = pal.querySelector('h3');
        if (h3 && h3.nextSibling) pal.insertBefore(row, h3.nextSibling);
        else pal.insertBefore(row, pal.firstChild);
      }
      regroupPalette(pal);
    }
    if (!el._fhClicks) {
      el._fhClicks = true;
      el.addEventListener('click', ev => {
        const a = ev.target.closest && ev.target.closest('[data-a], [data-starter], [data-calc-sz], .ff-pal-add, .ff-pal-item');
        if (!a) return;
        if (a.dataset.a === 'undo') { ev.preventDefault(); ev.stopPropagation(); builderUndo(); return; }
        if (a.dataset.a === 'redo') { ev.preventDefault(); ev.stopPropagation(); builderRedo(); return; }
        const szBtn = ev.target.closest && ev.target.closest('[data-calc-sz]');
        if (szBtn && ev.target.closest('.ff-edit')) {
          ev.preventDefault(); ev.stopPropagation();
          const id = ev.target.closest('.ff-edit').dataset.id;
          const st = V21ff.builderState(); if (!st) return;
          const m = st.modules.find(x => x.id === id); if (!m) return;
          snapBuilder();
          m.calcSz = clampCalcSz(szBtn.dataset.calcSz);
          st.dirty = true; st.editing = m.id;
          V21ff.editModule(m.id, { calcSz: m.calcSz });
          return;
        }
        if (a.dataset.a === 'dupmod') {
          ev.preventDefault(); ev.stopPropagation();
          const id = a.closest('.ff-edit') && a.closest('.ff-edit').dataset.id;
          const st = V21ff.builderState(); if (!st) return;
          const i = st.modules.findIndex(m => m.id === id); if (i < 0) return;
          const copy = JSON.parse(JSON.stringify(st.modules[i]));
          copy.id = newId('tm');
          st.modules.splice(i + 1, 0, copy);
          st.dirty = true; st.editing = copy.id;
          V21ff.editModule(copy.id, {});
          snapBuilder();
          return;
        }
        if (a.dataset.a === 'upmod' || a.dataset.a === 'downmod') {
          ev.preventDefault(); ev.stopPropagation();
          const id = a.closest('.ff-edit') && a.closest('.ff-edit').dataset.id;
          const st = V21ff.builderState(); if (!st) return;
          const i = st.modules.findIndex(m => m.id === id); if (i < 0) return;
          const to = a.dataset.a === 'upmod' ? i - 1 : i + 1;
          if (to < 0 || to >= st.modules.length) return;
          V21ff.reorderModule(i, to);
          return;
        }
        const stBtn = ev.target.closest('[data-starter]');
        if (stBtn) { ev.preventDefault(); ev.stopPropagation(); applyStarter(stBtn.dataset.starter); return; }
        const add = ev.target.closest('.ff-pal-add');
        if (add) {
          ev.preventDefault(); ev.stopPropagation();
          const type = add.closest('.ff-pal-item') && add.closest('.ff-pal-item').dataset.type;
          if (type) V21ff.addModule(type);
        }
      }, true);
    }
    /* cols input support */
    const page = el.querySelector('#ffPage');
    if (page && !page._fhInput) {
      page._fhInput = true;
      page.addEventListener('input', ev => {
        const f = ev.target.dataset && ev.target.dataset.f;
        if (f !== 'cols' && f !== 'days' && f !== 'start' && f !== 'end' && f !== 'slot') return;
        const id = ev.target.closest('.ff-edit') && ev.target.closest('.ff-edit').dataset.id;
        const st = V21ff.builderState(); if (!st) return;
        const m = st.modules.find(x => x.id === id); if (!m) return;
        if (f === 'cols') m.cols = ev.target.value.split(',').map(s => s.trim()).filter(Boolean);
        else if (f === 'days' || f === 'slot') m[f] = Math.max(1, +ev.target.value || 1);
        else m[f] = ev.target.value;
        st.dirty = true;
      });
    }
  }

  function regroupPalette(pal) {
    const items = [...pal.querySelectorAll('.ff-pal-item')];
    if (!items.length || pal.querySelector('.ff-pal-group')) {
      items.forEach(decoratePalItem);
      return;
    }
    const order = ['Lists', 'Pages', 'Meeting', 'Planning', 'Tools', 'Decor', 'More'];
    const buckets = {};
    items.forEach(it => {
      decoratePalItem(it);
      const type = it.dataset.type;
      const g = (V21ff.MODULES.find(m => m.type === type) || {}).group || GROUPS[type] || 'More';
      (buckets[g] || (buckets[g] = [])).push(it);
    });
    const hint = pal.querySelector('p.fine');
    const starters = pal.querySelector('.ff-starters');
    const h3 = pal.querySelector('h3');
    items.forEach(it => it.remove());
    for (const g of order) {
      if (!buckets[g] || !buckets[g].length) continue;
      const labEl = document.createElement('div'); labEl.className = 'ff-pal-group'; labEl.textContent = g;
      pal.append(labEl);
      buckets[g].forEach(it => pal.append(it));
    }
    if (hint) { hint.textContent = 'Tap ＋ (or the module) to add it. Hold and drag to place it. You can also drag modules on the page to reorder them.'; pal.append(hint); }
  }

  function decoratePalItem(it) {
    if (it.querySelector('.ff-pal-add')) return;
    const type = it.dataset.type;
    const meta = (window.V21ff && V21ff.MODULES.find(m => m.type === type)) || {};
    const label = (it.querySelector('span:last-child') || it).textContent.trim();
    const grip = it.querySelector('.ff-grip');
    it.innerHTML = '';
    if (grip) it.append(grip);
    else it.insertAdjacentHTML('afterbegin', '<span class="ff-grip" aria-hidden="true">⋮⋮</span>');
    const copy = document.createElement('span');
    copy.className = 'ff-pal-copy';
    copy.innerHTML = '<span>' + esc(label) + '</span>' + (meta.blurb ? '<span class="ff-pal-blurb">' + esc(meta.blurb) + '</span>' : '');
    it.append(copy);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'ff-pal-add'; add.dataset.type = type;
    add.setAttribute('aria-label', 'Add ' + label); add.textContent = '＋';
    it.append(add);
  }

  function applyStarter(key) {
    const spec = STARTERS.find(s => s.key === key); if (!spec || !window.V21ff) return;
    const st = V21ff.builderState(); if (!st) return;
    skipHist = true;
    st.modules.splice(0, st.modules.length);
    for (const [type, props] of spec.mods) {
      const m = V21ff.addModule(type);
      if (m && props) V21ff.editModule(m.id, props);
    }
    st.dirty = true;
    skipHist = false;
    snapBuilder();
  }

  hooks.showTplMenu = function (core, ctx, args) {
    /* wrap rename to avoid window.prompt */
    const id = args[1];
    const r = core.apply(ctx, args);
    const m = document.getElementById('ffMenu');
    if (!m) return r;
    const ren = m.querySelector('[data-a="rename"]');
    if (ren) {
      ren.addEventListener('click', ev => {
        ev.preventDefault(); ev.stopPropagation();
        ev.stopImmediatePropagation();
        m.remove();
        const t = V21ff.getTemplate(id); if (!t) return;
        openRename(t);
      }, true);
    }
    return r;
  };

  function openRename(t) {
    let el = document.getElementById('ffRename');
    if (el) el.remove();
    el = document.createElement('div'); el.id = 'ffRename'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div class="fh-ren-card"><h3>Rename template</h3><input type="text" maxlength="80" aria-label="Template name"><div class="fh-ren-acts"><button type="button" data-a="no">Cancel</button><button type="button" class="btn primary" data-a="ok">Rename</button></div></div>';
    document.body.append(el);
    const inp = el.querySelector('input'); inp.value = t.name; inp.focus(); inp.select();
    const done = async ok => {
      const name = inp.value.trim();
      el.remove();
      if (ok && name && name !== t.name) {
        await V21ff.renameTemplate(t.id, name);
        if (typeof V21ff.openPicker === 'function') { /* refresh if open */ }
        const p = document.getElementById('ffPicker');
        if (p && !p.hidden && V21ff.openPicker) {
          /* paintPickerIfOpen is internal; reopen is too heavy — update the label if present */
          p.querySelectorAll('.ff-item').forEach(b => { if (b.textContent.indexOf(t.name) >= 0 || (b.dataset.k === 'custom:' + t.id)) b.querySelector('.ff-name') && (b.querySelector('.ff-name').textContent = name); });
        }
      }
    };
    el.addEventListener('click', ev => {
      if (ev.target === el) done(false);
      const a = ev.target.closest('[data-a]'); if (!a) return;
      done(a.dataset.a === 'ok');
    });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
  }

  /* ---------- Overlay / background hooks ---------- */
  function hookDraw() {
    if (typeof drawPageBackground === 'function' && !drawPageBackground._fh) {
      const _d = drawPageBackground;
      drawPageBackground = function (ctx, note, pg) {
        const r = _d.apply(this, arguments);
        if (pg && pg.todoCont) { try { drawTodoCont(ctx, pg); } catch (e) { console.warn('v21fh todoCont', e); } }
        return r;
      };
      drawPageBackground._fh = true;
    }
    if (typeof v7OverlayHook === 'function' && !v7OverlayHook._fh) {
      const _ov = v7OverlayHook;
      v7OverlayHook = function (pi) {
        const r = _ov.apply(this, arguments);
        try {
          const n = typeof curNote === 'function' ? curNote() : null;
          const rec = typeof pageEls !== 'undefined' && pageEls[pi];
          if (rec && n && n.pages[pi] && n.pages[pi].todoCont && !sealed(n)) drawTodoContUI(pi, rec);
        } catch (e) { console.warn('v21fh overlay', e); }
        return r;
      };
      v7OverlayHook._fh = true;
    }
  }

  function hookClicks() {
    if (document._fhClicks) return;
    document._fhClicks = true;
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-fh-sec], .fh-pm .ff-plus, .fh-pm .ff-minus, .ff-delrow.fh-pm');
      if (!b) return;
      const page = b.closest('.page[data-pi]'); if (!page) return;
      e.stopPropagation(); e.preventDefault();
      const pi = +page.dataset.pi;
      const sec = b.getAttribute('data-fh-sec') || b.dataset.fhSec;
      if (b.classList.contains('ff-plus') && sec) V21ff.todoAdd(pi, sec);
      else if (b.classList.contains('ff-minus') && sec) V21ff.todoRemoveLast(pi, sec);
      else if (b.classList.contains('ff-delrow') && sec === 'tasks') {
        /* remove that row from the continuation */
        const n = curNote(), pg = n && n.pages[pi];
        if (!pg || !pg.todoCont) return;
        const id = b.dataset.id;
        const list = pg.todoCont.section === 'pri' ? pg.todoCont.pri : pg.todoCont.rows;
        const i = (list || []).findIndex(r => r.id === id); if (i < 0) return;
        if ((list || []).length <= 1) { V21ff.todoRemoveLast(pi, sec); return; }
        if (typeof pushHistory === 'function') pushHistory();
        list.splice(i, 1);
        const focus = maybeCollapseCont(n, pi);
        commitPages(n, focus, 'Line removed');
      }
    }, true);
  }

  function hookExport() {
    if (typeof drawOverlaysForExport !== 'function' || drawOverlaysForExport._fh) return;
    const _doe = drawOverlaysForExport;
    drawOverlaysForExport = function (ctx, pg, note) {
      const r = _doe.apply(this, arguments);
      try { if (pg && pg.todoCont) drawTodoCont(ctx, pg); } catch (_) {}
      return r;
    };
    drawOverlaysForExport._fh = true;
  }

  /* ---------- Public helpers (tests + shots) ---------- */
  async function addUntilCont(pi, sec) {
    const n = guardNote(); if (!n) return { ok: false };
    const start = n.pages.length;
    let steps = 0;
    while (n.pages.length === start && steps < 80) {
      const ok = await V21ff.todoAdd(pi, sec || 'tasks');
      steps++;
      if (!ok) break;
    }
    return { ok: n.pages.length > start, pages: n.pages.length, steps, addedOn: n.pages.length - 1 };
  }

  async function custAddUntilCont(pi, mid) {
    const n = guardNote(); if (!n) return { ok: false };
    const start = n.pages.length;
    let steps = 0;
    while (n.pages.length === start && steps < 80) {
      const ok = V21ff.custAdd(pi, mid);
      steps++;
      if (!ok) break;
    }
    return { ok: n.pages.length > start, pages: n.pages.length, steps, addedOn: n.pages.length - 1 };
  }


  /* ---------- Calculator (floating panel + page module) ---------- */
  const CALC_KEYS = [
    ['C', '⌫', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['±', '0', '.', '=']
  ];
  const CALC_OP = { '+': '+', '−': '-', '×': '*', '÷': '/' };

  function newCalcState() { return { expr: '', entry: '0', result: null, justEq: false, history: [] }; }
  function calcDisplay(st) { return st.justEq && st.result != null ? fmtNum(st.result) : (st.entry || '0'); }
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return 'Error';
    const s = Math.abs(n) >= 1e10 || (Math.abs(n) > 0 && Math.abs(n) < 1e-8)
      ? n.toExponential(6) : (roundCalc(n).toString());
    return s;
  }
  function roundCalc(n) { return Math.round(n * 1e12) / 1e12; }
  function parseNum(s) {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function evalExpr(src) {
    let s = String(src || '').trim();
    if (!s) return 0;
    s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
    s = s.replace(/[+\-*/]\s*$/, '');
    const toks = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ') { i++; continue; }
      if (ch === '(' || ch === ')') { toks.push(ch); i++; continue; }
      if ('+-*/'.indexOf(ch) >= 0) {
        const prev = toks[toks.length - 1];
        if ((prev == null || prev === '(' || '+-*/'.indexOf(prev) >= 0) && ch === '-') {
          let j = i + 1, num = '-';
          while (j < s.length && /[0-9.]/.test(s[j])) { num += s[j]; j++; }
          if (num.length > 1) { toks.push(num); i = j; continue; }
        }
        toks.push(ch); i++; continue;
      }
      if (/[0-9.]/.test(ch)) {
        let j = i, num = '';
        while (j < s.length && /[0-9.]/.test(s[j])) { num += s[j]; j++; }
        toks.push(num); i = j; continue;
      }
      i++;
    }
    function take(val, ops, apply) {
      const out = [], stack = [];
      for (const t of val) {
        if (ops.indexOf(t) >= 0) {
          while (stack.length && ops.indexOf(stack[stack.length - 1]) >= 0) out.push(stack.pop());
          stack.push(t);
        } else out.push(t);
      }
      while (stack.length) out.push(stack.pop());
      const st = [];
      for (const t of out) {
        if (ops.indexOf(t) >= 0) {
          const b = parseNum(st.pop()), a = parseNum(st.pop());
          const n = apply(t, a, b);
          if (!isFinite(n)) return NaN;
          st.push(n);
        } else st.push(t);
      }
      return st[0];
    }
    /* flatten * / first then + - ; parentheses via recursion */
    function ev(arr) {
      const flat = [];
      let k = 0;
      while (k < arr.length) {
        if (arr[k] === '(') {
          let d = 1, j = k + 1;
          while (j < arr.length && d) { if (arr[j] === '(') d++; if (arr[j] === ')') d--; j++; }
          flat.push(String(ev(arr.slice(k + 1, j - 1))));
          k = j; continue;
        }
        flat.push(arr[k++]);
      }
      const mid = [];
      const st = [];
      for (const t of flat) {
        if (t === '*' || t === '/') {
          st.push(t);
        } else if (t === '+' || t === '-') {
          while (st.length) mid.push(st.pop());
          st.push(t);
        } else {
          mid.push(t);
          if (st.length && (st[st.length - 1] === '*' || st[st.length - 1] === '/')) {
            mid.push(st.pop());
          }
        }
      }
      while (st.length) mid.push(st.pop());
      const stack = [];
      for (const t of mid) {
        if (t === '*' || t === '/' || t === '+' || t === '-') {
          const b = parseNum(stack.pop()), a = parseNum(stack.pop());
          let n = 0;
          if (t === '*') n = a * b;
          else if (t === '/') n = b === 0 ? NaN : a / b;
          else if (t === '+') n = a + b;
          else n = a - b;
          stack.push(n);
        } else stack.push(t);
      }
      return parseNum(stack[0]);
    }
    const n = ev(toks);
    return isFinite(n) ? roundCalc(n) : NaN;
  }
  function exprPlusEntry(st) {
    const e = st.expr || '';
    if (!e) return st.entry || '0';
    if (/[+\-×÷]\s*$/.test(e) || /[+\-*/]\s*$/.test(e)) return e + (st.entry || '0');
    return e;
  }
  function calcPress(st, key) {
    st = st || newCalcState();
    st.history = Array.isArray(st.history) ? st.history.slice() : [];
    const k = String(key);
    const startFresh = () => { st.entry = '0'; st.justEq = false; st.result = null; };
    if (k === 'C') { return Object.assign(st, newCalcState(), { history: st.history }); }
    if (k === '⌫') {
      if (st.justEq) { st.justEq = false; st.expr = ''; st.entry = fmtNum(st.result); st.result = null; return st; }
      if (st.entry.length <= 1 || (st.entry.length === 2 && st.entry[0] === '-')) st.entry = '0';
      else st.entry = st.entry.slice(0, -1);
      return st;
    }
    if (k === '±') {
      if (st.justEq) { st.entry = fmtNum(-(st.result || 0)); st.justEq = false; st.expr = ''; st.result = null; return st; }
      if (st.entry === '0') return st;
      st.entry = st.entry[0] === '-' ? st.entry.slice(1) : '-' + st.entry;
      return st;
    }
    if (k === '%') {
      let cur = parseNum(st.justEq ? st.result : st.entry);
      const m = (st.expr || '').match(/([+\-×÷/*])\s*$/);
      if (m && (m[1] === '+' || m[1] === '−' || m[1] === '-')) {
        const left = evalExpr((st.expr || '').replace(/[+\-×÷/*]\s*$/, ''));
        if (isFinite(left)) cur = left * (cur / 100);
        else cur = cur / 100;
      } else cur = cur / 100;
      st.entry = fmtNum(cur);
      st.justEq = false;
      return st;
    }
    if (k === '.') {
      if (st.justEq) { st.expr = ''; st.entry = '0.'; st.justEq = false; st.result = null; return st; }
      if (st.entry.indexOf('.') < 0) st.entry += '.';
      return st;
    }
    if (/^[0-9]$/.test(k)) {
      if (st.justEq) { st.expr = ''; st.entry = k; st.justEq = false; st.result = null; return st; }
      st.entry = (st.entry === '0') ? k : (st.entry + k);
      if (st.entry.replace(/^-/, '').length > 16) st.entry = st.entry.slice(0, st.entry[0] === '-' ? 17 : 16);
      return st;
    }
    if (CALC_OP[k] || k === '+' || k === '-') {
      const op = CALC_OP[k] ? k : k;
      const glyph = (k === '-') ? '−' : (CALC_OP[k] ? k : k);
      if (st.justEq) { st.expr = fmtNum(st.result) + ' ' + glyph + ' '; st.justEq = false; st.entry = '0'; return st; }
      if (/[+\-×÷]\s*$/.test(st.expr) && st.entry === '0') {
        st.expr = st.expr.replace(/[+\-×÷]\s*$/, glyph + ' ');
        return st;
      }
      st.expr = (st.expr || '') + (st.entry || '0') + ' ' + glyph + ' ';
      st.entry = '0';
      return st;
    }
    if (k === '=') {
      const src = exprPlusEntry(st);
      const n = evalExpr(src);
      const shown = fmtNum(n);
      st.history = [{ expr: src + ' = ' + shown, result: shown }].concat(st.history).slice(0, 8);
      st.result = isFinite(n) ? n : null;
      st.expr = src;
      st.entry = shown;
      st.justEq = true;
      return st;
    }
    return st;
  }

  function drawCalcFace(ctx, x, y, w, h, st) {
    const c = pal();
    rr(ctx, x, y, w, h, 12); ctx.fillStyle = '#1c1c22'; ctx.fill();
    ctx.fillStyle = '#b8b8c4'; ctx.font = '500 12px ' + fontFam(); ctx.textAlign = 'right';
    ctx.fillText(String((st && st.expr) || ''), x + w - 12, y + 18);
    ctx.fillStyle = '#f4f4f6'; ctx.font = '700 28px ' + fontFam();
    ctx.fillText(st ? calcDisplay(st) : '0', x + w - 12, y + 52);
    ctx.textAlign = 'left';
    const keysY = y + 64, keysH = h - 72, cellW = (w - 16) / 4, cellH = keysH / 5;
    CALC_KEYS.forEach((row, r) => row.forEach((labEl, c0) => {
      const kx = x + 8 + c0 * cellW + 3, ky = keysY + r * cellH + 3, kw = cellW - 6, kh = cellH - 6;
      rr(ctx, kx, ky, kw, kh, 8);
      ctx.fillStyle = labEl === '=' ? '#4f46e5' : (CALC_OP[labEl] ? '#3f3a88' : '#2f2f38');
      ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 16px ' + fontFam(); ctx.textAlign = 'center';
      ctx.fillText(labEl, kx + kw / 2, ky + kh / 2 + 6);
    }));
    ctx.textAlign = 'left';
  }

  function calcKeysHTML() {
    return CALC_KEYS.map(row => row.map(k => {
      const cls = k === '=' ? 'eq' : (CALC_OP[k] ? 'op' : (/^[C⌫%±]$/.test(k) ? 'fn' : ''));
      const label = ({
        'C': 'Clear', '⌫': 'Backspace', '%': 'Percent', '÷': 'Divide', '×': 'Multiply',
        '−': 'Subtract', '+': 'Add', '±': 'Change sign', '.': 'Decimal', '=': 'Equals'
      }[k] || k);
      const shown = k === '⌫' ? '←' : k;
      return '<button type="button" class="' + cls + '" data-k="' + k + '" aria-label="' + label + '">' + shown + '</button>';
    }).join('')).join('');
  }
  function histHTML(st) {
    if (!st || !st.history || !st.history.length) return '';
    return st.history.map((h, i) => '<button type="button" data-hist="' + i + '">' + esc(h.expr) + '</button>').join('');
  }
  function bindCalcRoot(root, getSt, setSt) {
    if (!root || root._fhCalc) return;
    root._fhCalc = true;
    root.addEventListener('pointerdown', ev => {
      const b = ev.target.closest && ev.target.closest('[data-k], [data-hist], [data-a]');
      if (!b) return;
      ev.stopPropagation();
      if (ev.pointerType === 'pen' && ev.target.closest('.fh-calc-head') && !b) return;
    }, true);
    root.addEventListener('click', ev => {
      const b = ev.target.closest && ev.target.closest('[data-k], [data-hist], [data-a="copy"]');
      if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      const st = getSt();
      if (b.dataset.hist != null) {
        const h = st.history && st.history[+b.dataset.hist];
        if (h) { st.entry = h.result; st.result = parseNum(h.result); st.justEq = true; st.expr = h.expr; setSt(st); }
        return;
      }
      if (b.getAttribute('data-a') === 'copy') { copyResult(getSt()); return; }
      setSt(calcPress(getSt(), b.dataset.k));
    });
  }
  function paintCalcRoot(root, st, opts) {
    if (!root) return;
    const expr = root.querySelector('.fh-calc-expr');
    const out = root.querySelector('.fh-calc-out');
    const hist = root.querySelector('.fh-calc-hist');
    if (expr) expr.textContent = st.justEq ? (st.expr || '') : (st.expr || '');
    if (out) out.textContent = calcDisplay(st);
    if (hist) hist.innerHTML = histHTML(st);
    if (opts && opts.aria) out && out.setAttribute('aria-live', 'polite');
  }
  function copyResult(st) {
    const v = calcDisplay(st);
    const ok = () => toastMsg('Copied ' + v, 1400);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(ok, () => fallbackCopy(v, ok));
      } else fallbackCopy(v, ok);
    } catch (_) { fallbackCopy(v, ok); }
  }
  function fallbackCopy(v, ok) {
    try {
      const ta = document.createElement('textarea'); ta.value = v; document.body.append(ta); ta.select();
      document.execCommand('copy'); ta.remove(); ok();
    } catch (_) { toastMsg('Could not copy'); }
  }

  let calcPanelSt = newCalcState();
  function ensureCalcPanel() {
    let el = document.getElementById('fhCalc');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fhCalc'; el.className = 'fh-calc'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Calculator');
    el.innerHTML = '<div class="fh-calc-head"><span class="fh-calc-title">Calculator</span>' +
      '<button type="button" data-a="copy" title="Copy result">Copy</button>' +
      '<button type="button" class="fh-calc-x" data-a="close" aria-label="Close">✕</button></div>' +
      '<div class="fh-calc-sizebar"><div class="fh-calc-sizes" role="group" aria-label="Calculator size">' +
        '<button type="button" data-calc-sz="' + CALC_PRESET.S + '" aria-label="Small">S</button>' +
        '<button type="button" data-calc-sz="' + CALC_PRESET.M + '" aria-label="Medium">M</button>' +
        '<button type="button" data-calc-sz="' + CALC_PRESET.L + '" aria-label="Large">L</button>' +
      '</div></div>' +
      '<div class="fh-calc-expr"></div><div class="fh-calc-out" aria-live="polite">0</div>' +
      '<div class="fh-calc-keys">' + calcKeysHTML() + '</div>' +
      '<div class="fh-calc-hist" aria-label="History"></div>' +
      '<button type="button" class="fh-calc-resize" aria-label="Resize calculator"></button>';
    document.body.append(el);
    bindCalcRoot(el, () => calcPanelSt, st => { calcPanelSt = st; paintCalcRoot(el, st); });
    el.querySelector('[data-a="close"]').addEventListener('click', ev => { ev.preventDefault(); closeCalc(); });
    el.querySelectorAll('[data-calc-sz]').forEach(b => b.addEventListener('click', ev => {
      ev.preventDefault(); ev.stopPropagation();
      setCalcPanelSize(+b.dataset.calcSz);
    }));
    bindCalcDrag(el);
    bindCalcResizeHandle(el.querySelector('.fh-calc-resize'), {
      getSz: () => calcPanelSz,
      setSz: (sz, meta) => setCalcPanelSize(sz, { silent: meta && meta.live })
    });
    applyCalcPanelSize(el, calcPanelSz);
    return el;
  }
  let calcPanelSz = loadCalcPanelSize();
  function loadCalcPanelSize() {
    try {
      const v = JSON.parse(localStorage.getItem(CALC_LS) || 'null');
      if (v && typeof v.sz === 'number') return clampCalcSz(v.sz);
      if (typeof v === 'number') return clampCalcSz(v);
    } catch (_) {}
    return 1;
  }
  function saveCalcPanelSize(sz) {
    try { localStorage.setItem(CALC_LS, JSON.stringify({ sz: clampCalcSz(sz) })); } catch (_) {}
  }
  function applyCalcPanelSize(el, sz) {
    if (!el) return;
    sz = clampCalcSz(sz);
    el.style.setProperty('--calc-sz', String(sz));
    el.style.width = (CALC_BASE_W * sz) + 'px';
    const name = calcPresetName(sz);
    el.querySelectorAll('.fh-calc-sizes [data-calc-sz]').forEach(b => {
      b.classList.toggle('on', Math.abs(+b.dataset.calcSz - sz) < 0.04);
    });
    if (name) el.dataset.size = name; else delete el.dataset.size;
  }
  function setCalcPanelSize(sz, opts) {
    calcPanelSz = clampCalcSz(sz);
    const el = document.getElementById('fhCalc') || ensureCalcPanel();
    applyCalcPanelSize(el, calcPanelSz);
    if (!(opts && opts.silent)) saveCalcPanelSize(calcPanelSz);
    return calcPanelSz;
  }
  function openCalc() {
    const el = ensureCalcPanel();
    applyCalcPanelSize(el, calcPanelSz);
    if (!el.style.left) {
      const vw = window.innerWidth;
      const w = CALC_BASE_W * calcPanelSz;
      el.style.left = Math.max(12, vw - w - 28) + 'px';
      el.style.top = Math.max((parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0) + 58, 80) + 'px';
    }
    el.hidden = false;
    paintCalcRoot(el, calcPanelSt);
    const b = document.getElementById('calcBtn'); if (b) b.classList.add('on');
    return el;
  }
  function closeCalc() {
    const el = document.getElementById('fhCalc'); if (el) el.hidden = true;
    const b = document.getElementById('calcBtn'); if (b) b.classList.remove('on');
  }
  function toggleCalc() {
    const el = ensureCalcPanel();
    if (el.hidden) openCalc(); else closeCalc();
    return !el.hidden;
  }
  function bindCalcResizeHandle(handle, opts) {
    if (!handle || handle._fhResize) return;
    handle._fhResize = true;
    let d = null;
    const okPtr = e => e.pointerType !== 'pen';
    handle.addEventListener('pointerdown', e => {
      if (!okPtr(e) || e.button) return;
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, sz: opts.getSz() };
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });
    handle.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      const ds = ((e.clientX - d.x) + (e.clientY - d.y)) / (2 * CALC_BASE_W);
      opts.setSz(clampCalcSz(d.sz + ds), { live: true });
    });
    const end = e => {
      if (!d || e.pointerId !== d.id) return;
      d = null;
      opts.setSz(opts.getSz(), { live: false });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  function bindCalcDrag(el) {
    const head = el.querySelector('.fh-calc-head');
    let d = null;
    const okPtr = e => e.pointerType !== 'pen'; /* finger (or mouse in tests) moves the panel; Pencil does not */
    head.addEventListener('pointerdown', e => {
      if (!okPtr(e) || e.button) return;
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      d = { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); e.stopPropagation();
    });
    head.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      const w = el.offsetWidth, h = el.offsetHeight;
      let x = e.clientX - d.x, y = e.clientY - d.y;
      x = Math.max(8 - w + 60, Math.min(window.innerWidth - 60, x));
      const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
      y = Math.max(sat + 8, Math.min(window.innerHeight - 40, y));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    });
    const end = e => { if (d && e.pointerId === d.id) d = null; };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }
  function mountCalcBtn() {
    if (document.getElementById('calcBtn')) return;
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.id = 'calcBtn';
    b.setAttribute('aria-label', 'Calculator');
    b.title = 'Calculator';
    b.textContent = '🧮';
    const after = document.getElementById('resinBtn') || document.getElementById('quotesBtn');
    const before = document.getElementById('togglePanel');
    if (after && after.parentNode) after.after(b);
    else if (before && before.parentNode) before.before(b);
    else { const tb = document.getElementById('topbar'); if (tb) tb.append(b); }
    b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); toggleCalc(); });
  }

  function mountPageCalcs(pi, pg, rec) {
    if (!rec || !rec.ov || !pg || !pg.customTpl) return;
    rec.ov.querySelectorAll('.fh-page-calc').forEach(el => el.remove());
    const L = window.V21ff && V21ff.custLayout(pg);
    const s = (typeof S !== 'undefined' && typeof S.scale === 'number' && S.scale > 0) ? S.scale : 1;
    (L && L.boxes || []).forEach(box => {
      if (box.m.type !== 'calc' || box.hidden) return;
      const st0 = (pg.customTpl.state[box.m.id] || (pg.customTpl.state[box.m.id] = newCalcState()));
      const sz = calcSzOf(box.m, st0);
      const el = document.createElement('div');
      el.className = 'fh-page-calc fh-calc';
      el.style.setProperty('--calc-sz', String(sz));
      el.style.left = (box.x + 8) * s + 'px';
      el.style.top = (box.y + (box.m.heading ? HEAD : 6)) * s + 'px';
      el.style.width = (box.w - 16) * s + 'px';
      el.style.height = (box.h - (box.m.heading ? HEAD : 12) - 6) * s + 'px';
      el.innerHTML = '<div class="fh-calc-head"><span class="fh-calc-title">Calculator</span>' +
        '<div class="fh-calc-sizes" role="group" aria-label="Calculator size">' +
          '<button type="button" data-calc-sz="' + CALC_PRESET.S + '" aria-label="Small">S</button>' +
          '<button type="button" data-calc-sz="' + CALC_PRESET.M + '" aria-label="Medium">M</button>' +
          '<button type="button" data-calc-sz="' + CALC_PRESET.L + '" aria-label="Large">L</button>' +
        '</div>' +
        '<button type="button" data-a="copy">Copy</button></div>' +
        '<div class="fh-calc-expr"></div><div class="fh-calc-out" aria-live="polite">0</div>' +
        '<div class="fh-calc-hist"></div>' +
        '<div class="fh-calc-keys">' + calcKeysHTML() + '</div>' +
        '<button type="button" class="fh-calc-resize" aria-label="Resize calculator"></button>';
      rec.ov.append(el);
      el.querySelectorAll('.fh-calc-head [data-calc-sz]').forEach(b => {
        b.classList.toggle('on', Math.abs(+b.dataset.calcSz - sz) < 0.04);
        b.addEventListener('click', ev => {
          ev.preventDefault(); ev.stopPropagation();
          setCalcModuleSize(pi, box.m.id, +b.dataset.calcSz);
        });
      });
      const getSt = () => pg.customTpl.state[box.m.id] || newCalcState();
      const setSt = st => {
        pg.customTpl.state[box.m.id] = st;
        paintCalcRoot(el, st);
        const n = typeof curNote === 'function' ? curNote() : null;
        persist(n);
      };
      bindCalcRoot(el, getSt, setSt);
      paintCalcRoot(el, getSt());
      bindCalcResizeHandle(el.querySelector('.fh-calc-resize'), {
        getSz: () => calcSzOf(box.m, getSt()),
        setSz: (next, meta) => {
          if (meta && meta.live) {
            box.m.calcSz = clampCalcSz(next);
            const h = (HEAD + Math.round(CALC_FACE_H * box.m.calcSz) - (box.m.heading ? HEAD : 12) - 6) * s;
            el.style.setProperty('--calc-sz', String(box.m.calcSz));
            el.style.height = h + 'px';
            el.querySelectorAll('.fh-calc-head [data-calc-sz]').forEach(b => {
              b.classList.toggle('on', Math.abs(+b.dataset.calcSz - box.m.calcSz) < 0.04);
            });
          } else {
            setCalcModuleSize(pi, box.m.id, next);
          }
        }
      });
    });
  }

  function setCalcModuleSize(pi, mid, sz) {
    const n = guardNote(); if (!n) return 1;
    const pg = n.pages[pi]; if (!pg || !pg.customTpl) return 1;
    const m = (pg.customTpl.modules || []).find(x => x.id === mid); if (!m) return 1;
    const next = clampCalcSz(sz);
    /* Don't grow off the bottom of the page. */
    const L = V21ff.custLayout(pg);
    const box = (L.boxes || []).find(b => b.m.id === mid);
    if (box) {
      const newH = HEAD + Math.round(CALC_FACE_H * next);
      const maxH = Math.max(HEAD + Math.round(CALC_FACE_H * CALC_SZ_MIN), LIMIT - box.y);
      if (box.y + newH > LIMIT && newH > (box.h || 0)) {
        const fit = clampCalcSz((maxH - HEAD) / CALC_FACE_H);
        m.calcSz = Math.min(next, fit);
      } else m.calcSz = next;
    } else m.calcSz = next;
    persist(n);
    try { if (typeof renderPageInk === 'function') renderPageInk(pi); } catch (_) {}
    try { if (typeof renderOverlay === 'function') renderOverlay(pi); } catch (_) {}
    return m.calcSz;
  }

  hooks.drawCustomUI = function (core, ctx, args) {
    const r = core.apply(ctx, args);
    try { mountPageCalcs(args[0], args[1], args[2]); } catch (e) { console.warn('v21fh calc ui', e); }
    return r;
  };


  function boot() {
    installModules();
    hookDraw();
    hookClicks();
    hookExport();
    mountCalcBtn();
  }

  window.V21fh = {
    version: VERSION,
    hooks,
    addUntilCont, custAddUntilCont,
    pagesOfCont, pagesOfCustomCont, layoutTodoCont, todoWouldOverflow, customWouldOverflow,
    NEW_TYPES, STARTERS,
    builderUndo, builderRedo,
    installModules,
    openCalc, closeCalc, toggleCalc, calcPress, calcEval: evalExpr, newCalcState, calcDisplay,
    calcPanelState: () => calcPanelSt, setCalcPanelState: s => { calcPanelSt = s; const el = document.getElementById('fhCalc'); if (el && !el.hidden) paintCalcRoot(el, calcPanelSt); },
    CALC_PRESET, CALC_SZ_MIN, CALC_SZ_MAX, CALC_BASE_W, CALC_LS,
    clampCalcSz, calcSzOf, setCalcPanelSize, calcPanelSize: () => calcPanelSz,
    setCalcModuleSize, loadCalcPanelSize
  };

  if (window.__ready) boot();
  else {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (window.__ready || Date.now() - t0 > 12000) { clearInterval(iv); boot(); }
    }, 40);
  }
  /* If V21ff is already present (it loads first), install modules now too. */
  if (window.V21ff) installModules();
  if (document.getElementById('topbar')) mountCalcBtn();
})();
