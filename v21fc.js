/* Pencil Notes v21fc — default note titles are “<Template> – <date>”, plus a handwritten title strip.
   1. New notes (every createNote path, including Quote sheet / Daily To-Do which go through v21eh, and
      first-launch notes created with makeNote and no title) get a default title like “Meeting – Nov 12, 2026”.
      En dash, locale short-month date with year. Existing notes and user-typed titles are never overwritten.
      The field stays editable; first focus of a still-default title selects all so typing replaces it.
   2. Every regular note has a title ink strip at the top of the note view. Apple Pencil writes there;
      a finger tap focuses the typed title; finger hold-drag does not write. Ink is stored as n.titleInk
      (additive). No OCR — the typed/default title stays the searchable text and a subtitle when ink exists.
      A Clear control (and the Eraser tool) removes title ink and reverts the display to the text title.
   Never deletes IndexedDB data. */
(() => {
  const VERSION = 'v21fc';
  const SYS = ['quoteboard', 'ideaboard', 'inbox'];
  const TITLE_W = 1000, TITLE_H = 80, BASELINE = 56;   // logical ink units; rule sits at 70% (56/80)
  const FALLBACK = {
    lined: 'Lined', grid: 'Grid', blank: 'Blank', qsheet: 'Quote sheet', todo: 'Daily To-Do',
    meeting: 'Meeting', planner: 'Planner', board: 'Project Board', assistant: 'Assistant',
    recording: 'Meeting Recording'
  };

  function templateDisplayName(kind) {
    const k = kind || 'lined';
    const row = (typeof TEMPLATES !== 'undefined' ? TEMPLATES : []).find(t => t && t[0] === k);
    let label = row ? String(row[1]) : '';
    try { label = label.replace(/^[^\p{L}\p{N}]+/u, '').trim(); } catch (_) { label = label.replace(/^[^A-Za-z0-9]+/, '').trim(); }
    if (k === 'meeting') return 'Meeting';
    return label || FALLBACK[k] || 'Note';
  }
  function formatTitleDate(d) {
    return (d || new Date()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function defaultNoteTitle(kind, d) {
    return templateDisplayName(kind || 'lined') + ' – ' + formatTitleDate(d);   // en dash
  }
  function isUserNote(n) { return n && !SYS.includes(n.id) && !n.system; }
  function hasTitleInk(n) { return !!(n && Array.isArray(n.titleInk) && n.titleInk.length); }
  function sealedNote(n) { return !!(n && typeof isSealed === 'function' && isSealed(n)); }

  /* ---------------- default titles for new notes ---------------- */
  if (typeof makeNote === 'function') {
    const _mn = makeNote;
    makeNote = function (notebookId, title) {
      const n = _mn.apply(this, arguments);
      if (!title) n.title = defaultNoteTitle('lined');
      return n;
    };
  }
  if (typeof createNote === 'function') {
    const _cn = createNote;
    createNote = function (nbId, kind) {
      const done = () => {
        const n = typeof curNote === 'function' ? curNote() : null;
        if (n && isUserNote(n)) {
          n.title = defaultNoteTitle(kind);
          try { saveNote(n); } catch (_) {}
          const inp = document.getElementById('noteTitle');
          if (inp && S.cur === n.id) { inp.value = n.title; inp.dataset.defaultTitle = n.title; }
          syncTitleStrip();
          try { renderSidebar(); } catch (_) {}
        }
      };
      const r = _cn.apply(this, arguments);
      if (r && typeof r.then === 'function') return r.then(v => { done(); return v; });
      done();
      return r;
    };
  }

  /* select-all on first focus while the value is still the default; never clear the field */
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (!el || el.id !== 'noteTitle') return;
    const def = el.dataset.defaultTitle;
    if (def && el.value === def) {
      requestAnimationFrame(() => { try { el.select(); } catch (_) {} });
    }
  }, true);
  // window capture runs before v21fa's document-capture listener (which stopImmediatePropagation's title input)
  window.addEventListener('input', e => {
    const el = e.target;
    if (!el || el.id !== 'noteTitle') return;
    if (el.dataset.defaultTitle && el.value !== el.dataset.defaultTitle) delete el.dataset.defaultTitle;
  }, true);

  /* ---------------- lock payload: keep title ink across lock/unlock ---------------- */
  if (typeof sealNote === 'function') {
    sealNote = async function (n, dk) {
      const payload = JSON.stringify({
        title: n.title, paper: n.paper, pages: n.pages, reminders: n.reminders,
        titleInk: n.titleInk || [], titleInkSize: n.titleInkSize || null
      });
      const stubs = reminderStubs(n), iv = rand(12);
      const meta = {}; for (const k of ['id', 'notebookId', 'order', 'createdAt', 'updatedAt', 'v']) if (k in n) meta[k] = n[k];
      const ct = await subtle.encrypt(gcm(iv, 'note:' + n.id), dk, te.encode(payload));
      const stub = { ...newPage(), id: n.lock.stub };
      return { ...meta, title: LOCKED_TITLE, paper: 'lined', pages: [stub], reminders: stubs, lock: { ...n.lock, iv: b64(iv), ct: b64(ct), len: payload.length } };
    };
  }
  if (typeof unlockWith === 'function') {
    const _uw = unlockWith;
    unlockWith = async function (n, dk, opts) {
      let extra = null;
      try {
        const payload = JSON.parse(td.decode(await subtle.decrypt(gcm(unb64(n.lock.iv), 'note:' + n.id), dk, unb64(n.lock.ct))));
        if (payload && (payload.titleInk || payload.titleInkSize)) extra = { titleInk: payload.titleInk || [], titleInkSize: payload.titleInkSize || null };
      } catch (_) {}
      const ok = await _uw.apply(this, arguments);
      if (ok && extra && n) {
        if (extra.titleInk && extra.titleInk.length) n.titleInk = extra.titleInk;
        if (extra.titleInkSize) n.titleInkSize = extra.titleInkSize;
        syncTitleStrip();
      }
      return ok;
    };
  }

  /* ---------------- title strip UI ---------------- */
  function mountStrip() {
    if (document.getElementById('titleStrip')) return document.getElementById('titleStrip');
    const top = document.getElementById('topbar'), inp = document.getElementById('noteTitle');
    if (!top || !inp) return null;
    // keep the existing top-bar buttons on row 1; the title ink strip is row 2 of the same header
    // (a separate 80px row shrank #pages enough to push page controls off-screen)
    if (!document.getElementById('topbarRow')) {
      const row = document.createElement('div'); row.id = 'topbarRow';
      while (top.firstChild) row.append(top.firstChild);
      top.append(row);
    }
    const strip = document.createElement('div');
    strip.id = 'titleStrip';
    strip.innerHTML = '<div class="fc-ink-area"><canvas id="titleInkCv" aria-hidden="true"></canvas><div class="fc-rule" aria-hidden="true"></div></div>';
    const area = strip.querySelector('.fc-ink-area');
    area.append(inp);
    const clr = document.createElement('button');
    clr.type = 'button'; clr.id = 'titleInkClear'; clr.setAttribute('aria-label', 'Clear handwritten title');
    clr.textContent = 'Clear';
    strip.append(clr);
    top.append(strip);
    inp.placeholder = inp.placeholder || 'Untitled';
    return strip;
  }

  function toTitlePoint(e, cv) {
    const r = (cv || document.getElementById('titleInkCv')).getBoundingClientRect();
    const sx = r.width > 0 ? r.width / TITLE_W : 1, sy = r.height > 0 ? r.height / TITLE_H : 1;
    return [(e.clientX - r.left) / sx, (e.clientY - r.top) / sy];
  }

  function paintStrokes(cv, strokes, w, h, { fit = false } = {}) {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = w || cv.clientWidth || 1, cssH = h || cv.clientHeight || 1;
    const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
    const list = strokes || [];
    let ox = 0, oy = 0, k = cssW / TITLE_W, kY = cssH / TITLE_H;
    if (fit && list.length && typeof bbox === 'function') {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const s of list) {
        const bb = s.bb || (s.points && bbox(s.points)); if (!bb) continue;
        a = Math.min(a, bb[0] - (s.width || 2)); b = Math.min(b, bb[1] - (s.width || 2));
        c = Math.max(c, bb[2] + (s.width || 2)); d = Math.max(d, bb[3] + (s.width || 2));
      }
      if (isFinite(a) && c > a && d > b) {
        const pad = 3;
        k = Math.min(cssW / Math.max(8, (c - a)), cssH / Math.max(8, (d - b))) * 0.92;
        ox = (cssW - (c - a) * k) / 2 - a * k; oy = (cssH - (d - b) * k) / 2 - b * k;
        kY = k;
      }
    }
    ctx.save();
    if (fit) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(ox, oy); ctx.scale(k, kY);
    if (typeof drawStroke === 'function') {
      list.forEach(s => { if (s.tool === 'highlighter') drawStroke(ctx, s); });
      list.forEach(s => { if (s.tool !== 'highlighter') drawStroke(ctx, s); });
    }
    ctx.restore();
  }

  function renderTitleInk(n) {
    const cv = document.getElementById('titleInkCv'), strip = document.getElementById('titleStrip');
    if (!cv || !strip) return;
    const inked = hasTitleInk(n);
    strip.classList.toggle('has-ink', inked);
    const area = strip.querySelector('.fc-ink-area');
    const w = area ? area.clientWidth : cv.clientWidth, h = area ? area.clientHeight : cv.clientHeight;
    paintStrokes(cv, inked ? n.titleInk : [], w, h, { fit: false });
  }

  function paintPreview(cv, strokes, w, h) {
    paintStrokes(cv, strokes, w, h, { fit: true });
  }

  function syncTitleStrip() {
    mountStrip();
    const n = typeof curNote === 'function' ? curNote() : null;
    const inp = document.getElementById('noteTitle');
    if (inp && n && inp.value !== (n.title || '') && document.activeElement !== inp) inp.value = n.title || '';
    renderTitleInk(isUserNote(n) && !sealedNote(n) ? n : null);
    const clr = document.getElementById('titleInkClear');
    if (clr) clr.hidden = !(isUserNote(n) && hasTitleInk(n) && !sealedNote(n));
  }

  function clearTitleInk(n) {
    n = n || (typeof curNote === 'function' ? curNote() : null);
    if (!n || !hasTitleInk(n) || sealedNote(n)) return false;
    n.titleInk = [];
    try { saveNote(n, true); } catch (_) { try { saveNote(n); } catch (__) {} }
    syncTitleStrip();
    try { renderSidebar(); } catch (_) {}
    return true;
  }

  /* Pencil writes / erases on the strip; finger tap types; finger never leaves ink */
  let inkDraw = null;
  function canInk(n) { return isUserNote(n) && !sealedNote(n); }
  function startInk(e, n) {
    const cv = document.getElementById('titleInkCv'); if (!cv) return;
    const p = toTitlePoint(e, cv), tool = (typeof S !== 'undefined' && S.tool) || 'pen';
    const pr = e.pressure || 0.5;
    if (tool === 'eraser') {
      inkDraw = { id: e.pointerId, tool: 'eraser', erased: false };
      eraseTitleAt(n, p);
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    const hl = tool === 'highlighter';
    const width = hl
      ? Math.max(8, (typeof S !== 'undefined' && S.hlWidth) || 12)
      : Math.max(2.4, (typeof S !== 'undefined' && S.penWidth) || 3);
    const color = hl
      ? ((typeof S !== 'undefined' && S.hlColor) || '#fde047')
      : ((typeof S !== 'undefined' && S.penColor) || '#1a1a1a');
    inkDraw = {
      id: e.pointerId, tool: hl ? 'highlighter' : 'pen',
      stroke: { id: uid('s'), tool: hl ? 'highlighter' : 'pen', color, width, points: [[+p[0].toFixed(1), +p[1].toFixed(1), +pr.toFixed(2)]] }
    };
    try { e.target.closest('#titleStrip').setPointerCapture(e.pointerId); } catch (_) {}
    renderTitleInk(n);
    // live preview: include the in-progress stroke
    const live = (n.titleInk || []).concat([inkDraw.stroke]);
    const area = document.querySelector('#titleStrip .fc-ink-area');
    paintStrokes(document.getElementById('titleInkCv'), live, area.clientWidth, area.clientHeight);
  }
  function moveInk(e, n) {
    if (!inkDraw || e.pointerId !== inkDraw.id) return;
    const cv = document.getElementById('titleInkCv'); if (!cv) return;
    const p = toTitlePoint(e, cv);
    if (inkDraw.tool === 'eraser') { eraseTitleAt(n, p); return; }
    const pts = inkDraw.stroke.points, last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.7) return;
    const pr = e.pressure || 0.5;
    pts.push([+p[0].toFixed(1), +p[1].toFixed(1), +pr.toFixed(2)]);
    const area = document.querySelector('#titleStrip .fc-ink-area');
    paintStrokes(cv, (n.titleInk || []).concat([inkDraw.stroke]), area.clientWidth, area.clientHeight);
  }
  function endInk(e, n) {
    if (!inkDraw || e.pointerId !== inkDraw.id) { inkDraw = null; return; }
    const d = inkDraw; inkDraw = null;
    if (d.tool === 'eraser') {
      if (d.erased) { try { saveNote(n, true); } catch (_) { try { saveNote(n); } catch (__) {} } try { renderSidebar(); } catch (__) {} }
      syncTitleStrip();
      return;
    }
    if (d.stroke) {
      d.stroke.bb = typeof bbox === 'function' ? bbox(d.stroke.points) : null;
      n.titleInk = n.titleInk || [];
      n.titleInk.push(d.stroke);
      n.titleInkSize = { w: TITLE_W, h: TITLE_H };
      try { saveNote(n, true); } catch (_) { try { saveNote(n); } catch (__) {} }
      syncTitleStrip();
      try { renderSidebar(); } catch (_) {}
    }
  }
  function eraseTitleAt(n, p) {
    const list = n.titleInk || []; if (!list.length) return;
    const R = 14;
    const before = list.length;
    n.titleInk = list.filter(st => {
      const bb = st.bb || (st.points && typeof bbox === 'function' && (st.bb = bbox(st.points)));
      const pad = R + (st.width || 2);
      if (bb && (p[0] < bb[0] - pad || p[0] > bb[2] + pad || p[1] < bb[1] - pad || p[1] > bb[3] + pad)) return true;
      const pts = st.points || [], lim = R + (st.width || 2) / 2;
      if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > lim;
      if (typeof segDist === 'function') {
        for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= lim) return false;
        return true;
      }
      for (const q of pts) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= lim) return false;
      return true;
    });
    if (n.titleInk.length !== before) {
      if (inkDraw) inkDraw.erased = true;
      const area = document.querySelector('#titleStrip .fc-ink-area'), cv = document.getElementById('titleInkCv');
      if (cv && area) paintStrokes(cv, n.titleInk, area.clientWidth, area.clientHeight);
      document.getElementById('titleStrip').classList.toggle('has-ink', hasTitleInk(n));
    }
  }

  function onStripDown(e) {
    const strip = e.target.closest && e.target.closest('#titleStrip'); if (!strip) return;
    if (e.target.closest('#titleInkClear')) return;
    const n = typeof curNote === 'function' ? curNote() : null;
    if (!canInk(n)) return;
    if (e.pointerType === 'pen') {
      e.preventDefault(); e.stopPropagation();
      try { document.activeElement && document.activeElement.blur(); } catch (_) {}
      startInk(e, n);
    } else if (e.pointerType === 'touch') {
      strip._fcTap = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
    }
    // mouse on the input: typing. mouse on the canvas/area (not the input or button): treat as ink for desktop tests
    else if (e.pointerType === 'mouse' && !e.target.closest('#noteTitle, #titleInkClear, button')) {
      e.preventDefault();
      startInk(e, n);
    }
  }
  function onStripMove(e) {
    if (inkDraw && e.pointerId === inkDraw.id) {
      const n = typeof curNote === 'function' ? curNote() : null; if (n) moveInk(e, n);
    }
  }
  function onStripUp(e) {
    const strip = document.getElementById('titleStrip');
    if (inkDraw && e.pointerId === inkDraw.id) {
      const n = typeof curNote === 'function' ? curNote() : null; if (n) endInk(e, n);
      return;
    }
    if (e.pointerType === 'touch' && strip && strip._fcTap && strip._fcTap.id === e.pointerId) {
      const t = strip._fcTap; strip._fcTap = null;
      if (Date.now() - t.t < 450 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) {
        const inp = document.getElementById('noteTitle');
        if (inp && !inp.readOnly) { inp.focus(); if (inp.dataset.defaultTitle && inp.value === inp.dataset.defaultTitle) try { inp.select(); } catch (_) {} }
      }
    }
  }

  /* ---------------- sidebar / search / recordings previews ---------------- */
  function decorateLists() {
    document.querySelectorAll('.note-row[data-note]').forEach(row => {
      const n = (S.notes || []).find(x => x.id === row.dataset.note);
      const show = n && hasTitleInk(n) && !sealedNote(n);
      row.classList.toggle('fc-has-ink', !!show);
      let prev = row.querySelector('canvas.fc-ink-preview');
      if (!show) { if (prev) prev.remove(); return; }
      const meta = row.querySelector('.meta');
      const t = row.querySelector('.t');
      if (!prev) {
        prev = document.createElement('canvas');
        prev.className = 'fc-ink-preview';
        prev.setAttribute('aria-hidden', 'true');
        if (t) t.before(prev); else if (meta) meta.prepend(prev);
      }
      paintPreview(prev, n.titleInk, 108, 28);
    });
    document.querySelectorAll('#hwResults .hw-res').forEach(b => {
      let n = null;
      const t = ((b.querySelector('.hw-t') || {}).textContent || '').replace(/ · p\.\d+$/, '');
      if (t) n = (S.notes || []).find(x => x.title === t) || null;
      const show = n && hasTitleInk(n) && !sealedNote(n);
      let prev = b.querySelector('canvas.fc-ink-preview');
      if (!show) { if (prev) prev.remove(); return; }
      if (!prev) {
        prev = document.createElement('canvas');
        prev.className = 'fc-ink-preview';
        prev.setAttribute('aria-hidden', 'true');
        const meta = b.querySelector('.hw-meta'); if (meta) meta.prepend(prev); else b.prepend(prev);
      }
      paintPreview(prev, n.titleInk, 72, 22);
    });
    document.querySelectorAll('.ev-row, .ev-meta').forEach(el => {
      const titleEl = el.querySelector('.ev-t, b.ev-t');
      if (!titleEl) return;
      const title = titleEl.textContent;
      const n = (S.notes || []).find(x => x.title === title);
      const show = n && hasTitleInk(n) && !sealedNote(n);
      let prev = el.querySelector('canvas.fc-ink-preview');
      if (!show) { if (prev) prev.remove(); return; }
      if (!prev) {
        prev = document.createElement('canvas');
        prev.className = 'fc-ink-preview';
        prev.setAttribute('aria-hidden', 'true');
        titleEl.before(prev);
      }
      paintPreview(prev, n.titleInk, 96, 24);
    });
  }

  if (typeof renderSidebar === 'function') {
    const _rs = renderSidebar;
    renderSidebar = function () {
      const r = _rs.apply(this, arguments);
      if (typeof drag !== 'undefined' && drag) return r;
      try { decorateLists(); } catch (e) { console.warn('v21fc decorate', e); }
      return r;
    };
  }
  if (typeof renderAll === 'function') {
    const _ra = renderAll;
    renderAll = function () {
      const r = _ra.apply(this, arguments);
      try { syncTitleStrip(); } catch (e) { console.warn('v21fc strip', e); }
      return r;
    };
  }
  if (typeof openNote === 'function') {
    const _on = openNote;
    openNote = function (id) {
      const r = _on.apply(this, arguments);
      try { syncTitleStrip(); } catch (_) {}
      return r;
    };
  }

  function bind() {
    mountStrip();
    const strip = document.getElementById('titleStrip'); if (!strip) return;
    strip.addEventListener('pointerdown', onStripDown, true);
    window.addEventListener('pointermove', onStripMove, { passive: true });
    window.addEventListener('pointerup', onStripUp, true);
    window.addEventListener('pointercancel', e => { if (inkDraw && e.pointerId === inkDraw.id) { inkDraw = null; syncTitleStrip(); } }, true);
    const clr = document.getElementById('titleInkClear');
    if (clr) clr.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearTitleInk(); });
    window.addEventListener('resize', () => { try { syncTitleStrip(); decorateLists(); } catch (_) {} });
  }

  window.V21fc = {
    version: VERSION, TITLE_W, TITLE_H, BASELINE,
    templateDisplayName, defaultNoteTitle, formatTitleDate,
    hasTitleInk, clearTitleInk, toTitlePoint, renderTitleInk, syncTitleStrip, decorateLists,
    addTitleStroke(n, stroke) {
      n = n || curNote(); if (!n || sealedNote(n)) return null;
      n.titleInk = n.titleInk || [];
      const s = Object.assign({ id: uid('s'), tool: 'pen', color: '#1a1a1a', width: 3, points: [] }, stroke || {});
      if (s.points && s.points.length && typeof bbox === 'function') s.bb = bbox(s.points);
      n.titleInk.push(s); n.titleInkSize = { w: TITLE_W, h: TITLE_H };
      try { saveNote(n, true); } catch (_) { try { saveNote(n); } catch (__) {} }
      syncTitleStrip(); try { renderSidebar(); } catch (_) {}
      return s;
    }
  };

  const ready = () => { try { bind(); syncTitleStrip(); decorateLists(); } catch (e) { console.warn('v21fc ready', e); } };
  if (window.__ready) ready();
  else { const t0 = Date.now(), iv = setInterval(() => { if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); ready(); } }, 50); }
})();
