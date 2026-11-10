/* Pencil Notes v21eq — (A) Idea Board rebuild lives in v21eo.js (patched in place); this file is
   (B) app cleanup and (C) polish. Mock only. Never deletes IndexedDB data: retired Inbox / Quote Board /
   calculator data stays stored, only not surfaced.

   B. copy rewrites (Settings, Gestures, search, reminders, hints) · one “＋ Add page” · no record chip on Meeting
      pages · landscape toolbar always one row (panel overlays) · 🔐 only where a code is set · “Connect Grok…” ·
      hidden lasso leftovers removed · Ask Grok without Draft reply / Add to Idea Board.
   v21er (patched in place): thumbnails scroll with a finger and render lazily; backup banner keeps a short label,
   recounts its days each time it shows, sits clear of toasts, and only counts a download fallback that really started.
   C. 44px − / 🗑 targets · Daily To-Do starts with one task row (＋ Task adds one) · page thumbnails (tap
      “Page 1 of N”) · honest search empty state · Back up now (share sheet → Files / iCloud) + weekly reminder. */
(function () {
  'use strict';
  const VERSION = 'v21eq';
  const $1 = s => document.querySelector(s);
  const esc2 = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const t0 = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  const ready = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 50); setTimeout(() => clearInterval(t), 15000); };
  const grokOn = () => { try { return typeof aiReady === 'function' && aiReady(); } catch (_) { return false; } };
  const connectGrok = () => { if (typeof aiSettings === 'function') aiSettings(); };

  /* ======================= B1. copy ======================= */
  try {
    GESTURES.length = 0;
    GESTURES.push(
      ['Writing', [['✏️', 'Pencil', 'writes · finger scrolls (turn on ☝️ Finger to draw with a finger)'], ['🤏', 'Two fingers', 'scroll · pinch to zoom · tap the % chip to reset'], ['➰', 'Lasso', 'circle ink or photos → drag to move, corner to resize · ✨ Ask Grok · 💡 Send to Idea Board (copies it onto a new card)']]],
      ['Pages', [['✋', 'Hold a page with a finger', 'drag it to a new position'], ['🔢', 'Tap “Page 1 of N”', 'see every page as a thumbnail · tap one to jump · hold and drag to reorder'], ['＋', '＋ Add page', 'at the end of the note · or ＋ Insert → Page']]],
      ['Idea Board', [['✏️', 'Pencil', 'writes anywhere — inside a card it writes on the card'], ['☝️', 'One finger', 'pan the board · tap a card, photo or link to select it'], ['✋', 'Press and hold a card', 'then drag to move it'], ['↘︎', 'Drag the round corner', 'resize the selected card or photo'], ['➰', 'Lasso', 'Make card · Delete'], ['🤏', 'Pinch', 'zoom the board']]],
      ['Lists & reminders', [['👉', 'Swipe right on a reminder', 'done'], ['👈', 'Swipe left', 'more actions · swipe all the way to delete (Undo)']]],
      ['Recordings', [['👆', 'Tap ink (▶ Replay on)', 'jump the audio to when you wrote it'], ['🎚', 'Drag the scrubber', 'seek · tap 1× to change speed']]],
      ['Everywhere', [['↶ ↷', 'Undo / Redo', 'top bar (Idea Board: its own ↶ ↷) · every delete also offers Undo'], ['⋯', 'More', 'paper, lock, share / export as PDF, Today, Idea Board — Settings is in the sidebar']]]
    );
  } catch (e) { console.warn('v21eq gestures', e); }

  /* Settings: Idea Board copy, “Connect Grok…”, Back up now */
  const _ss = settingsSections;
  settingsSections = function () {
    const secs = _ss.apply(this, arguments);
    return secs.map(sec => {
      if (sec.id === 'quotes') return Object.assign({}, sec, {
        h: 'Idea Board',
        note: 'Tap 💡 in the top bar. Write anywhere with Apple Pencil, add photos, links and PDFs with ＋ Insert, and lasso ink to make a card. Quotes live on your note pages: ＋ Insert → 🧾 Quote sheet.',
        rows: (sec.rows || []).map(r => /Open the Idea Board/.test(r.label) ? Object.assign({}, r, { sub: 'Whiteboard · cards, photos, links and PDFs' }) : r)
      });
      if (sec.id === 'ai') return Object.assign({}, sec, {
        note: 'Lasso ink or text, then tap ✨ Ask Grok. It works offline in a basic built-in mode. Connect Grok to read handwriting for search and get smarter answers. Your key stays on this iPad and is never shown, saved in notes or put in backups.',
        rows: (sec.rows || []).map(r => /Smarter AI summaries/.test(r.label || '') ? Object.assign({}, r, { label: '✨ Connect Grok…', sub: grokOn() ? 'Connected — handwriting search and smarter answers are on' : 'Not connected — needed to read handwriting for search' }) : r)
      });
      if (sec.id === 'storage') {
        const last = +localStorage.getItem('lastBackupAt') || 0;
        return Object.assign({}, sec, { rows: [
          { label: '☁️ Back up now', sub: (last ? 'Last backup ' + new Date(last).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'No backup yet') + ' · save it to Files or iCloud Drive', fn: () => backupNow() },
          ...(sec.rows || [])] });
      }
      return sec;
    });
  };
  /* other places that pointed at the old names */
  try {
    searchHintText = function () {
      const e = window.V21ee && V21ee.engine && V21ee.engine();
      return e ? 'Searching titles, typed text and handwriting.' : 'Searching titles and typed text. Connect Grok in Settings to search handwriting.';
    };
  } catch (_) {}
  const _sf = typeof setFocus === 'function' ? setFocus : null;
  if (_sf) setFocus = function (on) {
    const r = _sf.apply(this, arguments);
    if (!on) { const h = $1('#toolHint'); if (h && /Full screen/.test(h.textContent || '')) { h.hidden = true; clearTimeout(typeof hint === 'function' && hint._t); } }
    return r;
  };
  const _rp = renderPanel;
  renderPanel = function () {
    const r = _rp.apply(this, arguments);
    const em = document.querySelector('#reminderList .empty');
    if (em && /☑️ Task/.test(em.innerHTML)) em.innerHTML = 'No reminders yet.<br><br>Lasso some handwriting and tap <b>☑️ Make task</b>, or tap <b>＋ Insert → Task</b> and tap the page. Add a time to get reminded.';
    return r;
  };

  /* ======================= B2. one Add page control (bottom of the note) · ⋯ → Share ======================= */
  const _mi = moreItems;
  moreItems = function () {
    const secs = _mi.apply(this, arguments).map(sec => Object.assign({}, sec, { rows: (sec.rows || []).filter(r => !(r && r.l && /^Add page/.test(r.l)) && !(r && r.l === 'Export as PDF')) }));
    const n = curNote();
    const share = { h: 'Share', rows: [
      { ic: '⬇︎', l: 'Export as PDF', s: 'This note, ready for Mail, Messages or Files', fn: () => exportNotePdf(n) },
      { ic: '☁️', l: 'Back up all notes', s: 'Save one backup file to Files or iCloud Drive', fn: () => backupNow() }] };
    const gi = secs.findIndex(s => s.h === 'Go to');
    secs.splice(gi < 0 ? secs.length : gi, 0, share);
    return secs.filter(s => s.rows && s.rows.length);
  };

  /* ======================= B5b. landscape: reminders panel is an overlay, so it starts closed ======================= */
  const overlayMQ = window.matchMedia('(min-width: 1101px) and (orientation: landscape)');
  const panelOverlay = () => overlayMQ.matches;
  function closePanelForOverlay() { const app = $1('#app'); if (app && panelOverlay()) app.classList.add('panel-closed'); }
  ready(closePanelForOverlay);
  if (overlayMQ.addEventListener) overlayMQ.addEventListener('change', closePanelForOverlay);
  /* tap outside the overlay panel closes it (the reminder sheets it opens are outside #panel, so leave those alone) */
  document.addEventListener('pointerdown', e => {
    const app = $1('#app'); if (!app || !panelOverlay() || app.classList.contains('panel-closed')) return;
    const t = e.target; if (!t.closest) return;
    if (t.closest('#panel, #togglePanel, #sheetWrap, #actionWrap, .modal-wrap, [role=dialog], #toast')) return;
    if (typeof setPanel === 'function') setPanel(false);
  }, true);

  /* ======================= B3. Meeting Notes: no Record chip on the page ======================= */
  if (typeof renderRecPanel === 'function') {
    const _rr = renderRecPanel;
    renderRecPanel = function (pi) {
      const r = _rr.apply(this, arguments);
      try {
        const n = curNote(), pg = n && n.pages[pi], el = pageEls[pi];
        const live = typeof R !== 'undefined' && R.active && pg && pg.rec && R.active.recId === pg.rec.id;
        const compact = pg && pg.rec && typeof isRecPage === 'function' && !isRecPage(pg);
        if (el && pg && pg.rec && compact && !live && !(pg.rec.segs || []).length) el.ov.querySelectorAll('.rc-layer').forEach(x => x.remove());
      } catch (e) { console.warn('v21eq rec chip', e); }
      return r;
    };
  }

  /* ======================= B4. landscape: one visible toolbar row ======================= */
  function fitToolbar() {
    const tb = $1('#toolbar'); if (!tb) return;
    const side = $1('#sidebar'), drawer = typeof isDrawer === 'function' && isDrawer();
    const sideOpen = !!(side && !drawer && getComputedStyle(side).display !== 'none' && side.getBoundingClientRect().width > 0);
    document.body.classList.toggle('eq-side-open', sideOpen && matchMedia('(orientation: landscape)').matches);
    const L = ['tb-tight', 'tb-tighter', 'tb-tightest'];
    tb.classList.remove(...L);
    for (const c of L) { if (tb.scrollWidth <= tb.clientWidth + 1) break; tb.classList.add(c); }
  }
  window.__eqFitToolbar = fitToolbar;
  if (typeof renderToolbar === 'function') { const _rt = renderToolbar; renderToolbar = function () { const r = _rt.apply(this, arguments); requestAnimationFrame(fitToolbar); return r; }; }
  if (typeof setSidebar === 'function') { const _sb = setSidebar; setSidebar = function () { const r = _sb.apply(this, arguments); setTimeout(fitToolbar, 320); requestAnimationFrame(fitToolbar); return r; }; }
  addEventListener('resize', () => requestAnimationFrame(fitToolbar));
  if (window.ResizeObserver) ready(() => { const tb = $1('#toolbar'); if (tb) new ResizeObserver(() => fitToolbar()).observe(tb); });

  /* ======================= B5. 🔐 only on notebooks that have a code ======================= */
  const _rs = renderSidebar;
  renderSidebar = function () {
    const r = _rs.apply(this, arguments);
    try {
      document.querySelectorAll('#notebookList [data-nblock]').forEach(b => {
        const nb = S.notebooks.find(x => x.id === b.dataset.nblock);
        const has = !!(nb && nb.codeLock);
        b.classList.toggle('eq-nolock', !has); b.hidden = !has;
      });
    } catch (e) { console.warn('v21eq locks', e); }
    try { searchEmpty(); } catch (e) { console.warn('v21eq search', e); }
    return r;
  };
  /* lock a notebook from its ⋯ menu instead */
  const list = $1('#notebookList');
  if (list) list.addEventListener('click', e => {
    const more = e.target.closest('[data-nbmore]'), head = e.target.closest('[data-nb]'); if (!more || !head) return;
    const nb = S.notebooks.find(b => b.id === head.dataset.nb); if (!nb || nb.codeLock) return;
    if (window.V21d && head.dataset.nb === V21d.ARCHIVE_ID) {
      e.stopImmediatePropagation(); e.preventDefault();
      return actionSheet('📁 Archive', [
        { label: '🔒 Lock with 5-digit code…', sub: 'Encrypt the recordings filed here', fn: () => window.V21ej && V21ej.lockNotebook(nb) },
        { label: S.collapsed.has(nb.id) ? 'Expand Archive' : 'Collapse Archive', fn: () => { S.collapsed.has(nb.id) ? S.collapsed.delete(nb.id) : S.collapsed.add(nb.id); localStorage.setItem('collapsed', JSON.stringify([...S.collapsed])); renderSidebar(); } }]);
    }
    e.stopImmediatePropagation(); e.preventDefault();
    actionSheet(nb.name, [
      { label: 'Rename notebook', fn: () => { const v = prompt('Notebook name', nb.name); if (v && v.trim()) { nb.name = v.trim(); saveNotebook(nb); renderSidebar(); } } },
      { label: '🔒 Lock with 5-digit code…', sub: 'Encrypt its notes and recordings', fn: () => window.V21ej && V21ej.lockNotebook(nb) },
      { label: 'Delete notebook and its notes', danger: true, fn: () => deleteNotebook(nb) }]);
  }, true);

  /* ======================= B6. lasso leftovers · Ask Grok ======================= */
  function dropLeftovers() {
    ['lassoPlanner', 'lassoBoard', 'lassoAssist', 'lassoQuote'].forEach(id => { const b = document.getElementById(id); if (b) b.remove(); });
    try { const i = GK_ACTS.findIndex(a => a.id === 'reply'); if (i >= 0) GK_ACTS.splice(i, 1); } catch (_) {}
    const ls = $1('#lassoGrok'); if (ls) ls.title = 'Summarize, convert to text, make tasks, clean up or ask';
  }
  dropLeftovers();
  const pop = $1('#grokPop');
  if (pop && window.MutationObserver) new MutationObserver(() => { pop.querySelectorAll('.gk-act[data-act="card"], .gk-act[data-act="reply"]').forEach(b => b.remove()); }).observe(pop, { childList: true, subtree: true });

  /* ======================= C1. 44px quote trash in the margin beside the quote header ======================= */
  if (typeof v7OverlayHook === 'function') {
    const _ov = v7OverlayHook;
    v7OverlayHook = function (pi) {
      const r = _ov.apply(this, arguments);
      try {
        const n = curNote(), rec = pageEls[pi], pg = n && n.pages[pi];
        if (rec && pg && pg.qsheet && window.V21ed) {
          const s = S.scale;
          rec.ov.querySelectorAll('.qs-delq').forEach(b => {
            const q = pg.qsheet.quotes.find(x => x.id === b.dataset.q); if (!q) return;
            const L = V21ed.qLayout(q);
            b.style.left = ((L.x + L.w) * s - 14) + 'px'; b.style.top = ((L.y + 2) * s - 10) + 'px';
          });
        }
        if (rec && pg && pg.todo) rec.ov.querySelectorAll('.td-addline').forEach(b => { b.textContent = '＋ Task'; b.title = 'Add one more task'; b.setAttribute('aria-label', 'Add a task'); });
      } catch (e) { console.warn('v21eq overlay', e); }
      return r;
    };
  }

  /* ======================= C2. Daily To-Do: one task row; ＋ Task adds one ======================= */
  if (window.V21ee && V21ee.TD) V21ee.TD.DEF = 1;
  function trimTodoRows(n) {
    if (!n || !window.V21ee || (typeof isSealed === 'function' && isSealed(n))) return false;
    let changed = false;
    const TD = V21ee.TD;
    for (const pg of n.pages || []) {
      const t = pg && pg.todo; if (!t || t.v21eq) continue;
      const strokesInBand = band => (pg.strokes || []).some(st => { const b = st.bb || bbox(st.points); const cy = (b[1] + b[3]) / 2, cx = (b[0] + b[2]) / 2; return cx >= band.x && cx <= band.x + band.w && cy >= band.y && cy <= band.y + band.h; });
      const textsInBand = band => (pg.texts || []).some(x => x.x >= band.x && x.x <= band.x + band.w && x.y + 10 >= band.y && x.y + 10 <= band.y + band.h);
      /* only trailing rows that are empty (no ink, no text, not ticked) and never the first row */
      while (t.rows.length > 1) {
        const L = V21ee.tdLayout(t), i = t.rows.length - 1, R = L.rows[i], row = t.rows[i];
        const band = { x: TD.X, y: R.y, w: TD.W, h: TD.ROW };
        if (row.done || Object.keys(row).some(k => k !== 'id' && k !== 'done' && row[k] != null && row[k] !== '' && row[k] !== false) || strokesInBand(band) || textsInBand(band)) break;
        const y0 = R.y + TD.ROW;
        t.rows.pop();
        for (const st of pg.strokes || []) { const b = st.bb || bbox(st.points); if ((b[1] + b[3]) / 2 >= y0) { st.points = st.points.map(p => { const q = p.slice(); q[1] -= TD.ROW; return q; }); st.bb = bbox(st.points); } }
        for (const x of pg.texts || []) if (x.y >= y0) x.y -= TD.ROW;
        changed = true;
      }
      t.v21eq = 1; changed = true;
    }
    if (changed) saveNote(n, true);
    return changed;
  }
  const _op = openNote;
  openNote = function (id) {
    const n = S.notes.find(x => x.id === id);
    if (n && n.pages && n.pages.some(p => p.todo && !p.todo.v21eq)) trimTodoRows(n);
    return _op.apply(this, arguments);
  };
  ready(() => { const n = curNote(); if (n && n.pages.some(p => p.todo && !p.todo.v21eq) && trimTodoRows(n)) { try { buildPages(); } catch (_) {} } });
  ready(() => {
    const it = $1('#insTodo small'); if (it) it.textContent = 'Full page · tick boxes · ＋ Task adds a line';
  });

  /* ======================= C3. page thumbnails (tap “Page 1 of N”) ======================= */
  function thumbURL(n, pg, w) {
    const c = document.createElement('canvas'), h = Math.round(w * PAGE_H / PAGE_W), d = 2;
    c.width = w * d; c.height = h * d;
    try { const ctx = c.getContext('2d'); ctx.scale(w * d / PAGE_W, h * d / PAGE_H); drawPageContent(ctx, n, pg); } catch (_) {}
    return c.toDataURL('image/jpeg', 0.75);
  }
  function visiblePage() {
    const W = $1('#pages'); if (!W || !pageEls.length) return 0;
    const r = W.getBoundingClientRect(), mid = r.top + r.height * 0.4; let best = 0, bd = Infinity;
    pageEls.forEach((p, i) => { const b = p.el.getBoundingClientRect(); const dd = b.top <= mid && b.bottom >= mid ? 0 : Math.min(Math.abs(b.top - mid), Math.abs(b.bottom - mid)); if (dd < bd) { bd = dd; best = i; } });
    return best;
  }
  function jumpTo(pi) {
    const r = pageEls[pi]; if (!r) return;
    const W = $1('#pages'); W.scrollTo({ top: r.el.offsetTop - 8, behavior: 'auto' });
  }
  function openThumbs() {
    const n = curNote(); if (!n) return;
    if (typeof isSealed === 'function' && isSealed(n)) return t0('🔒 Unlock the note first');
    let w = $1('#eqThumbs'); if (!w) { w = document.createElement('div'); w.id = 'eqThumbs'; document.body.appendChild(w); }
    const cur = visiblePage();
    w.innerHTML = '<div class="eq-th-sheet" role="dialog" aria-modal="true" aria-label="Pages"><header><h3>Pages <small>' + n.pages.length + ' · tap to jump' + (n.pages.length > 1 ? ' · hold and drag to reorder' : '') + '</small></h3><button type="button" data-th="close" aria-label="Close">✕</button></header>' +
      '<div class="eq-th-grid">' + n.pages.map((pg, i) => '<button type="button" class="eq-th' + (i === cur ? ' cur' : '') + '" data-th-pi="' + i + '" aria-label="Page ' + (i + 1) + '"><img alt="" data-th-img="' + i + '"><span>' + (i + 1) + '</span></button>').join('') + '</div></div>';
    w.hidden = false;
    lazyThumbs(w, n);
    w.onclick = e => {
      if (e.target === w || e.target.closest('[data-th="close"]')) { w.hidden = true; return; }
      const b = e.target.closest('[data-th-pi]'); if (!b || TH.swallow) return;
      w.hidden = true; jumpTo(+b.dataset.thPi);
    };
    w.onpointerdown = thDown;
  }
  /* v21er: draw thumbnails lazily — visible ones first, a few per frame (40 pages no longer block ~600ms) */
  const thCache = new WeakMap();
  const thSig = pg => [(pg.strokes || []).length, (pg.strokes || []).length ? pg.strokes[pg.strokes.length - 1].id : '', (pg.texts || []).length, (pg.tasks || []).length, (pg.images || []).length, pg.bg && pg.bg.name, document.documentElement.dataset.theme].join('|');
  function thumbFor(n, pg) {
    const c = thCache.get(pg), sig = thSig(pg);
    if (c && c.sig === sig) return c.url;
    const url = thumbURL(n, pg, 150); thCache.set(pg, { sig, url }); return url;
  }
  let thObs = null;
  function lazyThumbs(w, n) {
    if (thObs) { thObs.disconnect(); thObs = null; }
    const imgs = [...w.querySelectorAll('img[data-th-img]')];
    const queue = [], queued = new Set();
    const want = im => { if (!queued.has(im) && !im.src) { queued.add(im); queue.push(im); pump(); } };
    let pumping = false;
    function pump() {
      if (pumping) return; pumping = true;
      requestAnimationFrame(function step() {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < 10) {
          const im = queue.shift(); const pg = n.pages[+im.dataset.thImg];
          if (pg && im.isConnected) { try { im.src = thumbFor(n, pg); } catch (_) {} }
        }
        if (queue.length && !w.hidden) requestAnimationFrame(step); else pumping = false;
      });
    }
    const sheet = w.querySelector('.eq-th-sheet');
    if ('IntersectionObserver' in window) {
      thObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) want(e.target); }), { root: sheet, rootMargin: '400px 0px' });
      imgs.forEach(im => thObs.observe(im));
    } else imgs.forEach(want);
    /* the current page first */
    const cur = w.querySelector('.eq-th.cur img'); if (cur) want(cur);
  }
  const TH = { g: null, swallow: false };
  function thDown(e) {
    const b = e.target.closest('[data-th-pi]'); if (!b) return;
    const n = curNote(); if (!n || n.pages.length < 2) return;
    const g = { from: +b.dataset.thPi, el: b, x: e.clientX, y: e.clientY, pid: e.pointerId, live: false };
    g.timer = setTimeout(() => { g.live = true; b.classList.add('dragging'); try { navigator.vibrate && navigator.vibrate(10); } catch (_) {} }, 350);
    TH.g = g;
    /* v21er: tiles allow vertical finger scrolling (touch-action: pan-y); once a hold has lifted a tile,
       stop the sheet from scrolling so the drag reorders instead */
    const noScroll = ev => { if (g.live && ev.cancelable) ev.preventDefault(); };
    addEventListener('touchmove', noScroll, { passive: false, capture: true });
    const mv = ev => {
      if (ev.pointerId !== g.pid) return;
      if (!g.live) { if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) > 10) { clearTimeout(g.timer); end(); } return; }
      ev.preventDefault();
      document.querySelectorAll('.eq-th.drop-before').forEach(x => x.classList.remove('drop-before'));
      const over = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => x.dataset && x.dataset.thPi != null);
      g.to = over ? +over.dataset.thPi : null; if (over && over !== b) over.classList.add('drop-before');
    };
    const end = () => {
      removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
      removeEventListener('touchmove', noScroll, { capture: true });
      clearTimeout(g.timer); TH.g = null;
    };
    const up = ev => {
      if (ev.pointerId !== g.pid) return;
      const live = g.live; end();
      if (!live) return;
      TH.swallow = true; setTimeout(() => { TH.swallow = false; }, 300);
      if (g.to != null && g.to !== g.from && window.V21ec && V21ec.movePage) { V21ec.movePage(g.from, g.to); openThumbs(); }
      else b.classList.remove('dragging');
    };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  }
  const PAGES = $1('#pages');
  if (PAGES) PAGES.addEventListener('click', e => {
    const g = e.target.closest('.page-foot .pg-grip, .page-foot > span:first-child'); if (!g) return;
    e.stopPropagation(); openThumbs();
  });
  /* footer label is a button-like target even for 1-page notes */
  if (typeof buildPages === 'function') {
    const _bp = buildPages;
    buildPages = function () {
      const r = _bp.apply(this, arguments);
      try { pageEls.forEach(p => { const s = p.el.querySelector('.page-foot > span'); if (s) { s.setAttribute('role', 'button'); s.setAttribute('tabindex', '0'); s.setAttribute('aria-label', (s.textContent || '').replace('⠿', '').trim() + ' — show all pages'); s.title = 'Tap to see all pages · hold and drag to move this page'; } }); } catch (_) {}
      return r;
    };
  }

  /* ======================= C4. search: short placeholder, honest empty state ======================= */
  const sb = $1('#search'); if (sb) { sb.setAttribute('placeholder', 'Search notes'); sb.setAttribute('aria-label', 'Search notes'); }
  function searchEmpty() {
    const box = document.getElementById('hwResults'); const q = ((typeof S !== 'undefined' && S.search) || '').trim();
    if (!box || box.hidden || q.length < 2) return;
    const head = box.querySelector('.hw-head b'), status = box.querySelector('.hw-status');
    const hits = box.querySelectorAll('.hw-res').length;
    const ql = q.toLowerCase();
    const titles = (S.notes || []).filter(n => !n.hidden && n.id !== 'ideaboard' && n.id !== 'quoteboard' && n.id !== 'inbox' && String(n.title || '').toLowerCase().includes(ql)).length;
    const hwOn = !!(window.V21ee && V21ee.engine && V21ee.engine());
    if (!hits && head) head.textContent = titles ? titles + ' note title' + (titles === 1 ? '' : 's') + ' match — listed below' : 'No matches for “' + q + '”';
    if (status) { status.textContent = hwOn ? 'Handwriting is searched too.' : (hits ? 'Typed text and titles only — handwriting search needs Grok.' : ''); status.hidden = !status.textContent; }   /* the hint above already explains Grok when nothing matched */
    box.querySelectorAll('.hw-empty-acts').forEach(x => x.remove());
    if (!hwOn && !hits) {
      const d = document.createElement('div'); d.className = 'hw-empty-acts';
      d.innerHTML = '<button type="button" class="btn primary small" data-eq="grok">✨ Connect Grok</button>';
      d.querySelector('button').onclick = e => { e.stopPropagation(); connectGrok(); };
      (status || head || box).after(d);
    }
  }

  /* ======================= C5. Back up now + weekly reminder ======================= */
  async function backupBlob() {
    if (typeof flushSaves === 'function') flushSaves();
    const notes = typeof sealedNotesForExport === 'function' ? await sealedNotesForExport() : S.notes;   // locked notes stay encrypted
    const assets = typeof exportAssets === 'function' ? await exportAssets(notes) : [];
    const data = { app: 'inkminder', version: 2, exportedAt: new Date().toISOString(), notebooks: S.notebooks, notes, assets };
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }
  const markBackup = () => { localStorage.setItem('lastBackupAt', String(Date.now())); const nag = $1('#eqBackupNag'); if (nag) nag.hidden = true; nagLayout(); };
  async function backupNow() {
    try {
      const blob = await backupBlob();
      const name = 'pencil-notes-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
      if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Pencil Notes backup' }); markBackup(); t0('Backup saved ✓', 1800); return 'share'; }
        catch (err) { if (err && err.name === 'AbortError') { t0('Backup not saved', 1400); return 'cancel'; } }
      }
      /* v21er: the download fallback can't confirm the file was kept, so only count it when the download really started */
      const a = document.createElement('a');
      if (!('download' in a) || typeof URL.createObjectURL !== 'function') { t0('This browser can’t save the backup file — use ⋯ → Share → Export instead', 3200); return 'unsupported'; }
      let started = false;
      try { a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener'; document.body.append(a); a.click(); started = true; } catch (err) { console.warn('backup download', err); }
      a.remove(); setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (_) {} }, 30000);
      if (!started) { t0('Could not start the backup download', 2200); return 'error'; }
      markBackup(); t0('Backup download started — check Files › Downloads and keep it in iCloud Drive', 3200); return 'download';
    } catch (e) { console.warn('backup', e); t0('Could not make the backup'); return 'error'; }
  }
  if (typeof exportBackup === 'function') { const _eb = exportBackup; exportBackup = async function () { const r = await _eb.apply(this, arguments); markBackup(); return r; }; }
  const WEEK = 7 * 864e5;
  function backupNag() {
    if (!localStorage.getItem('eqFirstSeen')) localStorage.setItem('eqFirstSeen', String(Date.now()));
    const last = +localStorage.getItem('lastBackupAt') || 0, first = +localStorage.getItem('eqFirstSeen') || Date.now();
    const snooze = +localStorage.getItem('backupNagUntil') || 0, now = Date.now();
    const due = last ? now - last > WEEK : now - first > WEEK;
    const real = (S.notes || []).some(n => (n.pages || []).some(p => (p.strokes || []).length || (p.texts || []).length));
    let nag = $1('#eqBackupNag');
    if (!due || now < snooze || !real) { if (nag) nag.hidden = true; nagLayout(); return false; }
    if (!nag) {
      nag = document.createElement('div'); nag.id = 'eqBackupNag'; nag.setAttribute('role', 'status');
      nag.innerHTML = '<span class="nag-t"></span><button type="button" class="primary" data-nag="now">Back up</button><button type="button" class="x" data-nag="x" aria-label="Remind me next week">✕</button>';
      document.body.appendChild(nag);
      nag.onclick = e => {
        const b = e.target.closest('[data-nag]'); if (!b) return;
        if (b.dataset.nag === 'now') backupNow();
        else { localStorage.setItem('backupNagUntil', String(Date.now() + WEEK)); nag.hidden = true; nagLayout(); }
      };
    }
    /* v21er: short label, recounted every time it shows */
    const days = last ? Math.max(1, Math.floor((now - last) / 864e5)) : 0;
    const txt = last ? '☁️ Last backup ' + days + ' day' + (days === 1 ? '' : 's') + ' ago' : '☁️ Not backed up yet';
    const span = nag.querySelector('.nag-t'); if (span) span.textContent = txt;
    nag.title = 'Save a backup copy to Files or iCloud Drive';
    nag.querySelector('[data-nag="now"]').setAttribute('aria-label', 'Back up now — save a copy to Files or iCloud Drive');
    nag.hidden = false; nagLayout(); return true;
  }
  /* v21er: toasts sit just above the banner while it shows (never on top of it) */
  function nagLayout() {
    const nag = $1('#eqBackupNag'), on = !!(nag && !nag.hidden);
    document.body.classList.toggle('eq-nag-on', on);
    if (on) document.body.style.setProperty('--eq-nag-h', Math.ceil(nag.getBoundingClientRect().height) + 'px');
  }
  addEventListener('resize', () => nagLayout());
  ready(() => setTimeout(backupNag, 1200));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) backupNag(); });
  setInterval(() => { if (!document.hidden) backupNag(); }, 60 * 60 * 1000);

  /* ======================= boot ======================= */
  ready(() => {
    dropLeftovers(); fitToolbar();
    try { renderSidebar(); } catch (_) {}
    try { if (curNote()) buildPages(); } catch (_) {}
  });

  window.V21eq = { version: VERSION, fitToolbar, openThumbs, visiblePage, jumpTo, backupNow, backupBlob, backupNag, nagLayout, trimTodoRows, searchEmpty, connectGrok };
})();
