/* Pencil Notes v21fg — Idea Board performance, typed card titles, smoother drag, capture audit.
   Overlay only: never deletes IndexedDB data. Additive title field uses existing t.text.
   Keeps the v21fe safe-area topbar and hidden Sales Leads button. No OCR added. */
(function () {
  'use strict';
  const HOLD_MS = 280;
  const SAVE_MS = 280;
  const SNAP = 8;
  const EDGE = 48;
  const SCROLL = 16;
  const TITLE_PH = 'Name this card…';
  const BUSY = /^(ink|cink|tink|lasso|erase)$/;  // not drag/resize: drop render must run

  const host = () => (window.V21eo && V21eo.host ? V21eo.host() : document.getElementById('ibHost'));
  const isOpen = () => !!(window.V21eo && V21eo.isOpen && V21eo.isOpen());
  const ideaN = () => (typeof ideaNote === 'function' ? ideaNote() : (S.notes || []).find(n => n && n.id === 'ideaboard'));
  const ideaPg = () => (window.V21eo && V21eo.ideaPg ? V21eo.ideaPg() : (ideaN() && ideaN().pages[0]));
  const toastMsg = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };

  const stats = { renderCore: [], renderFast: [], dragFrame: [], savesImmediate: 0, savesDebounced: 0, cacheHits: 0, cacheMiss: 0 };
  const inkCache = new Map();
  const dirtyCards = new Set();
  let inkDirty = true;
  let lastSig = { cards: '', kids: '', media: '', links: '' };
  let lastSel = '';
  let saveTimer = 0, savePending = null;
  let dragRaf = 0, dragEv = null, viewRaf = 0, viewPending = false;
  let lastPtr = { x: 0, y: 0 };
  let focusAfter = null;
  let hooked = false;

  function markInkDirty() { inkDirty = true; }
  function markCardDirty(id) { if (id) dirtyCards.add(id); }

  function strokeSig(strokes) {
    const s = strokes || [];
    if (!s.length) return '0';
    const last = s[s.length - 1];
    return s.length + ':' + (last && last.id || '') + ':' + (last && last.points && last.points.length || 0);
  }
  function blitCache(cv, w, h, sig) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const hit = inkCache.get(sig);
    if (hit && hit.w === w && hit.h === h && hit.dpr === dpr && hit.canvas) {
      const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pw, ph);
      ctx.drawImage(hit.canvas, 0, 0);
      stats.cacheHits++;
      return true;
    }
    return false;
  }
  function storeCache(cv, w, h, sig) {
    try {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const copy = document.createElement('canvas');
      copy.width = cv.width; copy.height = cv.height;
      copy.getContext('2d').drawImage(cv, 0, 0);
      inkCache.set(sig, { w, h, dpr, canvas: copy });
      if (inkCache.size > 400) inkCache.delete(inkCache.keys().next().value);
    } catch (e) {}
    stats.cacheMiss++;
  }

  function flushIdeaSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    const n = savePending || ideaN();
    savePending = null;
    if (n && typeof saveNote === 'function') {
      stats.savesImmediate++;
      hookSaveNote.flushing = true;
      try { hookSaveNote._orig ? hookSaveNote._orig(n, true) : saveNote(n, true); } finally { hookSaveNote.flushing = false; }
    }
  }
  function scheduleSave(note) {
    savePending = note || ideaN();
    stats.savesDebounced++;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = 0; flushIdeaSave(); }, SAVE_MS);
  }

  function membershipSig(pg) {
    const cards = (pg.tasks || []).filter(t => t && t.kind === 'card' && !t.parent).map(t => t.id).join(',');
    const kids = (pg.tasks || []).filter(t => t && t.kind === 'card' && t.parent).map(t => t.parent + ':' + t.id).join(',');
    const media = (pg.images || []).filter(im => im && im.kind !== 'pdfsource' && im.kind !== 'cardattach' && !im.hidden).map(im => (im.parent || '') + ':' + im.id).join(',');
    const links = (pg.links || []).filter(l => l).map(l => (l.parent || '') + ':' + l.id).join(',');
    return { cards, kids, media, links };
  }
  function patchCardEl(el, t) {
    if (!el || !t) return;
    const sel = !!(V21eo.ST && V21eo.ST.sel && V21eo.ST.sel.kind === 'card' && V21eo.ST.sel.id === t.id);
    el.style.left = (t.bx || 0) + 'px';
    el.style.top = (t.by || 0) + 'px';
    el.style.width = (t.bw || V21eo.CARD_W || 300) + 'px';
    el.style.height = (t.bh || el.offsetHeight) + 'px';
    el.classList.toggle('selected', sel);
    el.classList.toggle('done', !!t.done);
    const body = el.querySelector(':scope > .eo-card-body');
    if (body && typeof V21eo.bodyH === 'function') body.style.height = V21eo.bodyH(t, ideaPg()) + 'px';
    const inp = el.querySelector('.fg-title-input');
    if (inp && document.activeElement !== inp) {
      const v = (t.text || '').trim();
      if (inp.value !== v) inp.value = v;
    }
    if (!sel) el.querySelectorAll(':scope > .eo-sel-tools, :scope > .eo-resize').forEach(x => x.remove());
  }
  function selChromeMismatch(h) {
    if (!h) return false;
    const selId = V21eo.ST && V21eo.ST.sel && V21eo.ST.sel.kind === 'card' && V21eo.ST.sel.id;
    const cards = h.querySelectorAll('.eo-cards > .eo-card, .eo-world .eo-card');
    const list = cards.length ? cards : h.querySelectorAll('.eo-card');
    for (const el of list) {
      if (el.closest && el.closest('#esGhost, #eoCardWrap')) continue;
      const should = !!(selId && el.dataset.id === selId);
      const has = !!el.querySelector(':scope > .eo-resize');
      if (should !== has) return true;
    }
    return false;
  }
  function renderFast(core) {
    const ST = V21eo.ST;
    if (ST && ST.g && BUSY.test(ST.g.typ)) { ST.renderPending = true; return; }
    if (ST) ST.renderPending = false;
    const t0 = performance.now();
    const h = host();
    const pg = ideaPg();
    const mounted = !!(h && h.querySelector('.eo-view') && h.querySelector('.eo-cards'));
    const sig = pg ? membershipSig(pg) : { cards: '', kids: '', media: '', links: '' };
    const selKey = (ST && ST.sel && ST.sel.kind && ST.sel.id) ? (ST.sel.kind + ':' + ST.sel.id) : '';
    const same = mounted && isOpen() && sig.cards === lastSig.cards && sig.kids === lastSig.kids && sig.media === lastSig.media && sig.links === lastSig.links && selKey === lastSel;
    if (!same || !mounted || !isOpen() || selChromeMismatch(h)) {
      core();
      lastSig = sig;
      lastSel = selKey;
      inkDirty = false;
      dirtyCards.clear();
      sweepStrayCards(h, pg);
      enhanceTitles();
      bindBoardExtras();
      stats.renderCore.push(performance.now() - t0);
      return;
    }
    if (typeof V21eo.syncMount === 'function') V21eo.syncMount();
    if (typeof V21eo.growWorldToFit === 'function') V21eo.growWorldToFit(pg);
    if (typeof V21eo.sizeWorld === 'function') V21eo.sizeWorld();
    if (typeof V21eo.applyView === 'function') V21eo.applyView();
    const world = h.querySelector('.eo-cards');
    (pg.tasks || []).filter(t => t && t.kind === 'card' && !t.parent).forEach(t => {
      const el = world.querySelector('.eo-card[data-id="' + t.id + '"]');
      if (el) patchCardEl(el, t);
    });
    if (typeof V21eo.drawInkLayer === 'function') { V21eo.drawInkLayer(); inkDirty = false; }
    if (typeof V21eo.drawCardEl === 'function') {
      const only = dirtyCards.size ? dirtyCards : null;
      world.querySelectorAll('.eo-card').forEach(el => {
        if (only && !only.has(el.dataset.id)) return;
        V21eo.drawCardEl(el, ST && ST.hide);
      });
      dirtyCards.clear();
    }
    const hint = h.querySelector('.eo-empty');
    const emptyHtml = typeof V21eo.emptyHint === 'function' ? V21eo.emptyHint() : '';
    if (!emptyHtml && hint) hint.remove();
    sweepStrayCards(h, pg);
    enhanceTitles();
    stats.renderFast.push(performance.now() - t0);
  }

  function titleOf(t) { return ((t && (t.text || '')) || '').trim(); }
  function enhanceTitles(root) {
    const h = root || host(); if (!h) return;
    const pg = ideaPg(); if (!pg) return;
    h.querySelectorAll('.eo-card > .es-title').forEach(ti => {
      const card = ti.parentElement;
      const id = card && card.dataset.id;
      const t = id && (pg.tasks || []).find(x => x.id === id);
      if (!t) return;
      let inp = ti.querySelector('.fg-title-input');
      if (inp && inp.tagName === 'INPUT') {
        const ta = document.createElement('textarea');
        ta.className = 'fg-title-input'; ta.rows = 2; ta.maxLength = 80;
        ta.placeholder = TITLE_PH; ta.setAttribute('aria-label', 'Card name');
        ta.value = inp.value || titleOf(t);
        inp.replaceWith(ta); inp = ta;
      }
      if (!inp) {
        const ph0 = ti.querySelector('.es-title-ph');
        if (ph0) { ph0.textContent = TITLE_PH; ph0.classList.add('fg-title-ph'); }
        inp = document.createElement('textarea');
        inp.className = 'fg-title-input'; inp.rows = 2; inp.maxLength = 80;
        inp.placeholder = TITLE_PH; inp.setAttribute('aria-label', 'Card name');
        inp.value = titleOf(t);
        ti.appendChild(inp);
      } else if (document.activeElement !== inp && inp.value !== titleOf(t)) {
        inp.value = titleOf(t);
      }
      const titled = titleOf(t) || (t.titleInk || []).length || (t.tstrokes || []).length;
      const ph = ti.querySelector('.es-title-ph');
      if (ph && titled) ph.remove();
      const name = titleOf(t);
      let lab = ti.querySelector('.fg-title-label');
      if (!lab) { lab = document.createElement('div'); lab.className = 'fg-title-label'; ti.appendChild(lab); }
      lab.textContent = name || TITLE_PH;
      lab.classList.toggle('is-empty', !name);
      let hiddenTitle = ti.querySelector('.eo-card-title');
      if (name) {
        if (!hiddenTitle) { hiddenTitle = document.createElement('div'); hiddenTitle.className = 'eo-card-title'; ti.appendChild(hiddenTitle); }
        hiddenTitle.textContent = name;
        hiddenTitle.classList.toggle('es-under', !!((t.titleInk || []).length));
      }
      bindTitleInput(inp, t, card);
    });
    if (focusAfter) {
      const id = focusAfter; focusAfter = null;
      focusTitle(id);
    }
  }
  function bindTitleInput(inp, t, card) {
    if (inp._fg) return; inp._fg = true;
    const commit = () => {
      const v = String(inp.value || '').trim().slice(0, 80);
      if ((t.text || '') === v) return;
      if (typeof bH === 'function' && !inp._hist) { try { bH(IPI); } catch (e) {} }
      inp._hist = false;
      t.text = v; t.typed = !!v;
      if (card) card.setAttribute('aria-label', v || 'Card');
      scheduleSave(ideaN());
      if (typeof renderSidebar === 'function') try { renderSidebar(); } catch (e) {}
    };
    inp.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'pen') { ev.preventDefault(); return; }
      ev.stopPropagation();
    });
    inp.addEventListener('focus', () => { inp._hist = true; card && card.classList.add('fg-naming'); });
    inp.addEventListener('blur', () => { card && card.classList.remove('fg-naming'); requestAnimationFrame(() => { if (inp.isConnected) commit(); }); inp._hist = false; });
    inp.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { inp.value = titleOf(t); inp.blur(); }
    });
    inp.addEventListener('input', () => {
      t.text = String(inp.value || '').slice(0, 80); t.typed = !!t.text;
      const lab = card && card.querySelector('.fg-title-label');
      if (lab) { lab.textContent = (t.text || '').trim() || TITLE_PH; lab.classList.toggle('is-empty', !titleOf(t)); }
      scheduleSave(ideaN());
    });
  }
  function focusTitle(id) {
    const inp = host() && host().querySelector('.eo-card[data-id="' + id + '"] .fg-title-input');
    if (inp) { try { inp.focus(); inp.select(); } catch (e) {} }
  }
  function onTitleTap(ev) {
    if (!isOpen() || ev.pointerType === 'pen') return;
    if (V21eo.ST && Date.now() < (V21eo.ST.noClickUntil || 0)) return;
    const ti = ev.target.closest && ev.target.closest('.es-title');
    if (!ti || ev.target.closest('.fg-title-input')) return;
    const card = ti.closest('.eo-card'); if (!card) return;
    if (Math.hypot((ev.clientX || 0) - (onTitleTap.x || ev.clientX), (ev.clientY || 0) - (onTitleTap.y || ev.clientY)) > 10) return;
    focusTitle(card.dataset.id);
  }

  function decorateGhost(D) {
    const gl = document.getElementById('esGhost'); if (!gl) return;
    gl.classList.add('fg-lift');
    gl.style.willChange = 'transform';
    const x = parseFloat(gl.style.left) || 0, y = parseFloat(gl.style.top) || 0;
    D.ghost0 = [x, y];
    const dx0 = lastPtr.x ? (lastPtr.x - (D.sx || lastPtr.x)) : 0;
    const dy0 = lastPtr.y ? (lastPtr.y - (D.sy || lastPtr.y)) : 0;
    D.fgOff = [dx0, dy0];
    gl.style.transform = 'translate3d(' + dx0 + 'px,' + dy0 + 'px,0) scale(' + ((D.gs || 1) * 1.04) + ')';
  }
  function copyCardCanvases(from, to) {
    if (!from || !to) return 0;
    let n = 0;
    [':scope > .es-title canvas.es-title-ink', ':scope > .eo-card-body canvas.eo-card-ink', 'canvas.es-title-ink', 'canvas.eo-card-ink'].forEach(sel => {
      const s = from.querySelector(sel), d = to.querySelector(sel);
      if (!s || !d || s === d || !s.width || !s.height) return;
      d.width = s.width; d.height = s.height;
      if (s.style.width) d.style.width = s.style.width;
      if (s.style.height) d.style.height = s.style.height;
      try {
        const ctx = d.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, d.width, d.height);
        ctx.drawImage(s, 0, 0);
        n++;
      } catch (e) {}
    });
    return n;
  }
  function inkPixels(cv) {
    if (!cv || !cv.width || !cv.height) return 0;
    try {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
      return n;
    } catch (e) { return 0; }
  }
  function clearTitleSelection() {
    document.querySelectorAll('.fg-title-input').forEach(inp => {
      try { inp.blur(); if (inp.setSelectionRange) inp.setSelectionRange(0, 0); } catch (e) {}
    });
    try { if (window.getSelection) getSelection().removeAllRanges(); } catch (e) {}
  }
  function styleSrcSlot(el) {
    if (!el) return;
    el.classList.add('es-src-drag', 'fg-src-slot');
    el.classList.remove('selected', 'fg-naming');
  }
  function finishLift(D) {
    clearTitleSelection();
    if (V21eo.ST) V21eo.ST.sel = null;
    const gl = document.getElementById('esGhost'); if (!gl) return;
    const ce = gl.querySelector('.es-ghost-card, .eo-card');
    const src = (D && D.hideEls && D.hideEls[0]) || (D && D.card && host() && host().querySelector('.eo-card[data-id="' + D.card.id + '"]'));
    if (ce) {
      ce.classList.remove('selected', 'fg-naming', 'es-src-drag', 'fg-src-slot');
      ce.querySelectorAll('.eo-sel-tools, .eo-resize').forEach(x => x.remove());
      const inp = ce.querySelector('.fg-title-input');
      if (inp) { try { inp.blur(); if (inp.setSelectionRange) inp.setSelectionRange(0, 0); } catch (e) {} }
      if (D && D.card && typeof V21eo.drawCardEl === 'function') {
        try { V21eo.drawCardEl(ce); } catch (e) {}
      }
      if (src) copyCardCanvases(src, ce);
    }
    (D && D.hideEls || []).forEach(styleSrcSlot);
    if (src) styleSrcSlot(src);
  }
  function showDragPreview(id, dx, dy) {
    clearTitleSelection();
    if (V21eo.ST) V21eo.ST.sel = null;
    const t = (typeof V21eo.getItem === 'function' ? V21eo.getItem('card', id) : null)
      || (V21eo.cardsOf && V21eo.cardsOf().find(c => c.id === id));
    const src = host() && host().querySelector('.eo-card[data-id="' + id + '"]');
    if (!t || !src) return { ok: false };
    document.querySelectorAll('.es-src-drag, .fg-src-slot').forEach(e => e.classList.remove('es-src-drag', 'fg-src-slot'));
    const gl = (V21eo.ghostLayer ? V21eo.ghostLayer() : document.getElementById('esGhost')) || document.createElement('div');
    if (!gl.id) { gl.id = 'esGhost'; document.body.appendChild(gl); }
    gl.innerHTML = '';
    const html = (typeof V21eo.cardHtml === 'function') ? V21eo.cardHtml(t, { sheet: true }) : src.outerHTML;
    const box = document.createElement('div'); box.innerHTML = html;
    const ce = box.firstElementChild; ce.classList.add('es-ghost-card', 'eo-card');
    ce.classList.remove('selected', 'es-src-drag');
    ce.querySelectorAll('.eo-sel-tools, .eo-resize').forEach(x => x.remove());
    gl.appendChild(ce);
    const r = src.getBoundingClientRect();
    const ox = (dx == null ? 44 : dx), oy = (dy == null ? 36 : dy);
    Object.assign(gl.style, { left: (r.left + ox) + 'px', top: (r.top + oy) + 'px', transform: 'translate3d(0,0,0) scale(1.04)' });
    gl.classList.add('on', 'fg-lift'); gl.hidden = false;
    if (typeof V21eo.drawCardEl === 'function') { try { V21eo.drawCardEl(ce); } catch (e) {} }
    copyCardCanvases(src, ce);
    styleSrcSlot(src);
    const gInk = inkPixels(gl.querySelector('canvas.eo-card-ink')) + inkPixels(gl.querySelector('canvas.es-title-ink'));
    const srcTitle = src.querySelector('.fg-title-input');
    const srcTitleVis = !!(srcTitle && getComputedStyle(srcTitle).visibility !== 'hidden' && getComputedStyle(src).opacity !== '1' || false);
    const srcKidsHidden = [...src.children].every(ch => getComputedStyle(ch).visibility === 'hidden' || getComputedStyle(ch).display === 'none');
    const active = document.activeElement;
    const selLen = (active && active.classList && active.classList.contains('fg-title-input') && active.selectionEnd > active.selectionStart);
    return {
      ok: true, ghostInk: gInk, srcIsSlot: src.classList.contains('fg-src-slot') && src.classList.contains('es-src-drag'),
      srcShowsTitle: !srcKidsHidden, srcKidsHidden, titleSelected: !!selLen,
      ghostHasTitle: !!(ce.querySelector('.fg-title-input') && ce.querySelector('.fg-title-input').value)
    };
  }
  function clearDragPreview() {
    const gl = document.getElementById('esGhost');
    if (gl) { gl.classList.remove('on', 'fg-lift'); gl.innerHTML = ''; gl.hidden = true; gl.style.transform = ''; }
    document.querySelectorAll('.es-src-drag, .fg-src-slot').forEach(e => e.classList.remove('es-src-drag', 'fg-src-slot'));
  }
  function autoScroll(ev) {
    const v = V21eo.viewEl ? V21eo.viewEl() : (host() && host().querySelector('.eo-view'));
    if (!v) return false;
    const r = v.getBoundingClientRect();
    let ax = 0, ay = 0;
    if (ev.clientX < r.left + EDGE) ax = SCROLL;
    else if (ev.clientX > r.right - EDGE) ax = -SCROLL;
    if (ev.clientY < r.top + EDGE) ay = SCROLL;
    else if (ev.clientY > r.bottom - EDGE) ay = -SCROLL;
    if (!ax && !ay) return false;
    V21eo.VIEW.x += ax; V21eo.VIEW.y += ay;
    if (typeof V21eo.applyView === 'function') V21eo.applyView();
    return true;
  }
  function snapXY(x, y, w, h, skipId) {
    const pg = ideaPg(); if (!pg) return [x, y, false];
    let nx = Math.round(x / SNAP) * SNAP, ny = Math.round(y / SNAP) * SNAP, hit = false;
    const others = (pg.tasks || []).filter(t => t && t.kind === 'card' && !t.parent && t.id !== skipId);
    let best = 10, bx = nx, by = ny;
    for (const o of others) {
      const ox = o.bx || 0, oy = o.by || 0, ow = o.bw || 300, oh = o.bh || 200;
      for (const cand of [ox, ox + ow, ox - w]) {
        if (Math.abs(x - cand) < best) { best = Math.abs(x - cand); bx = cand; hit = true; }
      }
      for (const cand of [oy, oy + oh, oy - h]) {
        if (Math.abs(y - cand) < best) { best = Math.abs(y - cand); by = cand; hit = true; }
      }
    }
    if (hit && best <= 10) return [Math.round(bx), Math.round(by), true];
    return [nx, ny, false];
  }
  function runDragFrame(core, D) {
    dragRaf = 0;
    const ev = dragEv; if (!ev || !D) return;
    const t0 = performance.now();
    const gl = document.getElementById('esGhost'); if (!gl) return;
    const dx = ev.clientX - D.sx, dy = ev.clientY - D.sy;
    if (!D.moved && Math.hypot(dx, dy) > 2) D.moved = true;
    const sc = (D.gs || 1) * 1.04;
    gl.style.left = (D.ghost0 ? D.ghost0[0] : 0) + 'px';
    gl.style.top = (D.ghost0 ? D.ghost0[1] : 0) + 'px';
    gl.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sc + ')';
    autoScroll(ev);
    if (!D._tgtSkip) {
      D._tgtSkip = 1;
      document.querySelectorAll('.es-drop, .es-drop-bad, .fg-snap').forEach(e => e.classList.remove('es-drop', 'es-drop-bad', 'fg-snap'));
      if (typeof V21eo.dropTargetAt === 'function') {
        const T = V21eo.dropTargetAt(ev.clientX, ev.clientY, D);
        if (T && T.card && T.el) {
          const bad = D.card && typeof V21eo.canDropCardIn === 'function' ? V21eo.canDropCardIn(ideaPg(), D.card, T.card) : '';
          T.el.classList.add(bad ? 'es-drop-bad' : 'es-drop');
        }
      }
    } else D._tgtSkip = 0;
    D.last = { x: ev.clientX, y: ev.clientY };
    stats.dragFrame.push(performance.now() - t0);
  }

  function titleHay(t) {
    return ((t && (t.text || '')) + ' ' + ((t && t.titleText) || '')).trim().toLowerCase();
  }
  function cardOrKidsMatch(pg, t, q) {
    if (titleHay(t).indexOf(q) >= 0) return true;
    return (pg.tasks || []).some(c => c && c.kind === 'card' && c.parent === t.id && cardOrKidsMatch(pg, c, q));
  }
  function sweepStrayCards(h, pg) {
    if (!h || !pg) return;
    const world = h.querySelector('.eo-cards') || h.querySelector('.eo-world') || h;
    world.querySelectorAll(':scope > .eo-card').forEach(el => {
      const t = (pg.tasks || []).find(x => x && x.id === el.dataset.id);
      if (!t || t.parent) el.remove();
    });
    const gl = document.getElementById('esGhost');
    const dragging = V21eo.ST && V21eo.ST.g && V21eo.ST.g.typ === 'drag';
    if (gl && !dragging && !gl.classList.contains('on')) {
      if (gl.innerHTML) gl.innerHTML = '';
      gl.hidden = true;
    }
  }
  function filterCards(q) {
    q = String(q || '').trim().toLowerCase();
    const h = host(); if (!h) return 0;
    const pg = ideaPg(); if (!pg) return 0;
    sweepStrayCards(h, pg);
    let n = 0, first = null;
    (pg.tasks || []).filter(t => t && t.kind === 'card' && !t.parent).forEach(t => {
      const ok = !q || cardOrKidsMatch(pg, t, q);
      const el = [...h.querySelectorAll('.eo-card[data-id="' + t.id + '"]')].find(e => !e.closest('#esGhost, #eoCardWrap, .es-folder'));
      if (el) {
        el.classList.toggle('fg-miss', !!q && !ok);
        el.classList.toggle('fg-hit', !!q && ok);
        if (ok && !first) first = t;
      }
      if (ok && q) n++;
    });
    const meta = document.querySelector('.fg-search-n');
    if (meta) meta.textContent = q ? (n ? n + ' match' + (n === 1 ? '' : 'es') : 'No matches') : '';
    const clr = document.getElementById('fgSearchClear');
    if (clr) clr.hidden = !q;
    return n;
  }
  function ensureSearchClear(bar) {
    if (!bar) return;
    const wrap = bar.querySelector('.fg-search'); if (!wrap) return;
    let btn = document.getElementById('fgSearchClear');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'fgSearchClear'; btn.type = 'button'; btn.className = 'fg-search-clear';
      btn.setAttribute('aria-label', 'Clear search');
      btn.hidden = true; btn.textContent = '✕';
      wrap.appendChild(btn);
      btn.addEventListener('click', ev => {
        ev.preventDefault(); ev.stopPropagation();
        const inp = document.getElementById('fgCardSearch');
        if (inp) { inp.value = ''; inp.focus(); }
        filterCards('');
      });
    }
  }
  function mountChrome() {
    const drawer = document.getElementById('qbDrawer');
    if (!drawer) return;
    let bar = document.getElementById('fgBoardBar');
    if (!isOpen()) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fgBoardBar';
      bar.innerHTML = '<label class="fg-search"><span class="visually-hidden">Find cards</span>' +
        '<input type="search" id="fgCardSearch" placeholder="Find cards…" aria-label="Find cards by name" enterkeyhint="search">' +
        '<small class="fg-search-n" aria-live="polite"></small></label>' +
        '<button type="button" id="fgNewCard" class="fg-new" aria-label="New card">＋ New card</button>';
      const ib = document.getElementById('ibHost');
      if (ib && ib.parentNode) ib.parentNode.insertBefore(bar, ib);
      else drawer.appendChild(bar);
      const inp = bar.querySelector('#fgCardSearch');
      inp.addEventListener('input', () => filterCards(inp.value));
      inp.addEventListener('keydown', ev => ev.stopPropagation());
      bar.querySelector('#fgNewCard').addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); newCardFast(); });
    }
    ensureSearchClear(bar);
    bar.hidden = false;
    let fab = document.getElementById('fgFab');
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'fgFab'; fab.type = 'button';
      fab.setAttribute('aria-label', 'New card');
      fab.title = 'New card';
      fab.textContent = '＋';
      drawer.appendChild(fab);
      fab.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); newCardFast(); });
    }
    fab.hidden = true; // bar already has ＋ New card; a corner FAB covered ink
  }
  function unmountChrome() {
    const bar = document.getElementById('fgBoardBar'); if (bar) bar.hidden = true;
    const fab = document.getElementById('fgFab'); if (fab) fab.hidden = true;
  }
  function newCardFast() {
    if (typeof ibSealed === 'function' && ibSealed()) { toastMsg('🔒 Unlock the Idea Board first'); return null; }
    if (!isOpen() && typeof qbOpen === 'function') qbOpen(true, { mode: 'ideas' });
    const t = V21eo.addBlankCard && V21eo.addBlankCard();
    if (t) { focusAfter = t.id; enhanceTitles(); focusTitle(t.id); }
    return t;
  }
  function hookAddButton() {
    if (typeof ideaAddCard === 'function' && !ideaAddCard._fg) {
      const _ia = ideaAddCard;
      ideaAddCard = function () { return newCardFast() || _ia.apply(this, arguments); };
      ideaAddCard._fg = true;
    }
    const b = document.getElementById('qbAdd');
    if (b && !b._fg) {
      b._fg = true;
      b.addEventListener('click', ev => {
        if (!(typeof QB !== 'undefined' && QB.mode === 'ideas')) return;
        ev.preventDefault(); ev.stopPropagation();
        newCardFast();
      }, true);
    }
  }
  function bindBoardExtras() {
    mountChrome();
    const view = host() && host().querySelector('.eo-view');
    if (view && !view._fgTap) {
      view._fgTap = true;
      view.addEventListener('pointerdown', ev => { onTitleTap.x = ev.clientX; onTitleTap.y = ev.clientY; }, true);
      view.addEventListener('pointerup', onTitleTap, true);
    }
  }

  const hooks = {};
  hooks.render = function (core) { return renderFast(() => core.apply(null, [])); };
  hooks.saveWB = function (core) { scheduleSave(ideaN()); };
  hooks.drawInkLayer = function (core, ctx, args) { return core.apply(ctx, args); };
  hooks.paintInk = function (core, ctx, args) {
    const cv = args[0], w = args[1], h = args[2], strokes = args[3], k = args[4], hide = args[5], oy = args[6];
    const hid = hide && hide.size ? [...hide].join(',') : '';
    const sig = 'p:' + strokeSig(strokes) + ':' + w + 'x' + h + ':' + (k || 1) + ':' + (oy || 0) + ':' + hid;
    if (cv && blitCache(cv, w, h, sig)) {
      if (oy != null) cv.style.top = -oy + 'px';
      return cv.getContext('2d');
    }
    const r = core.apply(ctx, args);
    if (cv) storeCache(cv, w, h, sig);
    return r;
  };
  hooks.cardHtml = function (core, ctx, args) {
    const html = core.apply(ctx, args);
    const t = args[0]; if (!t) return html;
    const v = titleOf(t);
    const esc = String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const ph = TITLE_PH.replace(/"/g, '&quot;');
    const label = '<div class="fg-title-label' + (v ? '' : ' is-empty') + '">' + (esc || TITLE_PH.replace(/</g, '&lt;')) + '</div>';
    return html
      .replace(/(<div class="es-title"[^>]*>)/, '$1' +
        '<textarea class="fg-title-input" rows="2" maxlength="80" placeholder="' + ph +
        '" aria-label="Card name">' + esc + '</textarea>' + label);
  };
  hooks.makeCardFromSel = function (core, ctx, args) {
    const t = core.apply(ctx, args);
    if (t) { focusAfter = t.id; enhanceTitles(); focusTitle(t.id); toastMsg('Card made — name it at the top', 1800); }
    return t;
  };
  hooks.addBlankCard = function (core, ctx, args) {
    const t = core.apply(ctx, args);
    if (t) { focusAfter = t.id; enhanceTitles(); focusTitle(t.id); }
    return t;
  };
  hooks.liftDrag = function (core, ctx, args) {
    clearTitleSelection();
    if (V21eo.ST) V21eo.ST.sel = null;
    const r = core.apply(ctx, args);
    const D = V21eo.ST && V21eo.ST.g;
    if (D && D.typ === 'drag') { decorateGhost(D); finishLift(D); }
    return r;
  };
  hooks.dragMove = function (core, ctx, args) {
    const D = args[0], ev = args[1];
    dragEv = ev;
    if (!dragRaf) dragRaf = requestAnimationFrame(() => runDragFrame(core, D));
  };
  function bakeGhost(D, ev) {
    const gl = document.getElementById('esGhost'); if (!gl || !D) return;
    const e = ev || dragEv;
    if (e) {
      const dx = e.clientX - D.sx, dy = e.clientY - D.sy;
      if (!D.moved && Math.hypot(dx, dy) > 2) D.moved = true;
      D.last = { x: e.clientX, y: e.clientY };
      gl.style.left = ((D.ghost0 ? D.ghost0[0] : 0) + dx) + 'px';
      gl.style.top = ((D.ghost0 ? D.ghost0[1] : 0) + dy) + 'px';
    }
    gl.style.transform = 'scale(' + (D.gs || 1) + ')';
  }
  hooks.dragEnd = function (core, ctx, args) {
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    const D = args[0], ev = args[1];
    bakeGhost(D, ev);
    const moved = !!(D && D.moved);
    const card = D && D.card;
    lastSig = { cards: '', kids: '', media: '', links: '' };
    const r = core.apply(ctx, args);
    const gl = document.getElementById('esGhost');
    if (gl) { gl.classList.remove('fg-lift'); gl.style.willChange = ''; gl.style.transform = ''; }
    if (moved && card && !card.parent && ev && ev.type === 'pointerup') {
      const [sx, sy] = snapXY(card.bx, card.by, card.bw || 300, card.bh || 200, card.id);
      if (sx !== card.bx || sy !== card.by) { card.bx = Math.max(0, sx); card.by = Math.max(0, sy); if (typeof V21eo.render === 'function') V21eo.render(); }
    }
    if (moved && (card || (D && D.P))) {
      if (typeof actionToast === 'function') actionToast('Moved', 'Undo', () => { if (typeof bUndo === 'function') bUndo(IPI); toastMsg('Undone', 1200); }, 5000);
    }
    flushIdeaSave();
    markInkDirty();
    if (V21eo.ST && V21eo.ST.renderPending && typeof V21eo.render === 'function') V21eo.render();
    return r;
  };
  hooks.dropCancel = function (core, ctx, args) {
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    const gl = document.getElementById('esGhost');
    if (gl) { gl.classList.remove('fg-lift'); gl.style.willChange = ''; }
    document.querySelectorAll('.fg-src-slot').forEach(e => e.classList.remove('fg-src-slot'));
    return core.apply(ctx, args);
  };
  hooks.applyView = function (core, ctx, args) {
    if (V21eo.ST && V21eo.ST.g && (V21eo.ST.g.typ === 'pan' || V21eo.ST.g.typ === 'pinch')) {
      const w = V21eo.worldEl && V21eo.worldEl();
      const VIEW = V21eo.VIEW;
      if (w && VIEW) {
        if (typeof V21eo.clampView === 'function') V21eo.clampView();
        w.style.transform = 'translate(' + VIEW.x + 'px, ' + VIEW.y + 'px) scale(' + VIEW.s + ')';
      }
      viewPending = true;
      if (!viewRaf) viewRaf = requestAnimationFrame(() => {
        viewRaf = 0; viewPending = false;
        if (typeof V21eo.checkInkRegion === 'function') V21eo.checkInkRegion();
      });
      return;
    }
    return core.apply(ctx, args);
  };

  function hookSaveNote() {
    if (typeof saveNote !== 'function' || saveNote._fg) return;
    const _s = saveNote;
    hookSaveNote._orig = _s;
    saveNote = function (note, immediate) {
      if (note && note.id === 'ideaboard' && immediate && !hookSaveNote.flushing) {
        scheduleSave(note);
        if (window.onNoteSaved) try { window.onNoteSaved(note); } catch (e) {}
        return;
      }
      return _s.apply(this, arguments);
    };
    saveNote._fg = true;
  }

  function hookLifecycle() {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushIdeaSave(); });
    addEventListener('pagehide', flushIdeaSave);
    if (typeof qbOpen === 'function' && !qbOpen._fgFlush) {
      const _q = qbOpen;
      qbOpen = function (on, opts) {
        const r = _q.apply(this, arguments);
        if (!on) { flushIdeaSave(); unmountChrome(); }
        else if ((opts && opts.mode === 'ideas') || (typeof QB !== 'undefined' && QB.mode === 'ideas') || isOpen()) {
          mountChrome();
          enhanceTitles();
          lastSig = { cards: '', kids: '', media: '', links: '' };
          markInkDirty();
          try {
            if (typeof V21eo.sizeWorld === 'function') V21eo.sizeWorld();
            if (typeof V21eo.applyView === 'function') V21eo.applyView();
            if (typeof V21eo.drawInkLayer === 'function') V21eo.drawInkLayer();
            if (typeof V21eo.drawCardInks === 'function') V21eo.drawCardInks();
            else if (typeof V21eo.render === 'function') V21eo.render();
          } catch (e) {}
        }
        return r;
      };
      qbOpen._fgFlush = true;
    }
  }
  function hookPtrTrack() {
    const peekFab = ev => {
      lastPtr.x = ev.clientX; lastPtr.y = ev.clientY;
      const fab = document.getElementById('fgFab');
      if (fab) fab.style.pointerEvents = (ev.pointerType === 'pen' || ev.pointerType === 'mouse') ? 'none' : '';
    };
    addEventListener('pointermove', peekFab, { capture: true, passive: true });
    addEventListener('pointerdown', peekFab, { capture: true, passive: true });
    addEventListener('pointerup', ev => {
      const fab = document.getElementById('fgFab');
      if (fab && ev.pointerType !== 'pen' && ev.pointerType !== 'mouse') fab.style.pointerEvents = '';
    }, { capture: true, passive: true });
  }
  function hookSearchKeys() {
    addEventListener('keydown', ev => {
      if (!isOpen()) return;
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'f') {
        const inp = document.getElementById('fgCardSearch');
        if (inp) { ev.preventDefault(); inp.focus(); }
      }
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'n' && !/input|textarea|select/i.test((ev.target && ev.target.tagName) || '')) {
        ev.preventDefault(); newCardFast();
      }
    }, true);
  }

  function boot() {
    if (hooked || !window.V21eo) return;
    hooked = true;
    V21eo.ST.holdMs = HOLD_MS;
    hookSaveNote();
    if (typeof flushSaves === 'function' && !flushSaves._fg) {
      const _f = flushSaves;
      flushSaves = function () { flushIdeaSave(); return _f.apply(this, arguments); };
      flushSaves._fg = true;
    }
    hookLifecycle();
    hookPtrTrack();
    hookAddButton();
    hookSearchKeys();
    if (isOpen()) { mountChrome(); enhanceTitles(); bindBoardExtras(); }
  }

  if (window.V21eo) boot();
  else {
    const w = setInterval(() => { if (window.V21eo) { clearInterval(w); boot(); } }, 50);
    setTimeout(() => clearInterval(w), 15000);
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  const readyW = setInterval(() => { if (window.__ready) { clearInterval(readyW); boot(); } }, 200);
  setTimeout(() => clearInterval(readyW), 15000);

  window.V21fg = {
    version: 'v21fg', hooks, HOLD_MS, TITLE_PH, stats, inkCache, dirtyCards,
    flushSave: flushIdeaSave, focusTitle, newCardFast, filterCards, enhanceTitles,
    showDragPreview, clearDragPreview, finishLift, inkPixels,
    renderFast, markInkDirty, markCardDirty, scheduleSave, snapXY,
    measure: function (which, n) {
      const arr = stats[which] || [];
      const slice = arr.slice(-(n || arr.length));
      if (!slice.length) return { n: 0, ms: 0, avg: 0 };
      const sum = slice.reduce((a, b) => a + b, 0);
      return { n: slice.length, ms: sum, avg: sum / slice.length, last: slice[slice.length - 1], min: Math.min.apply(null, slice), max: Math.max.apply(null, slice) };
    },
    seedCards: function (n, withInk) {
      const pg = ideaPg(); if (!pg) return 0;
      const col = (typeof boardCols === 'function' ? boardCols(pg)[0] : (pg.board && pg.board.columns[0]));
      const start = (pg.tasks || []).filter(t => t && t.kind === 'card').length;
      for (let i = 0; i < n; i++) {
        const x = 40 + (i % 8) * 320, y = 40 + Math.floor(i / 8) * 240;
        const t = { id: (typeof uid === 'function' ? uid('t') : 't' + Date.now() + i), kind: 'card', col: col && col.id, ord: i, text: i % 5 === 0 ? 'Card ' + (i + 1) : '', typed: i % 5 === 0, tstrokes: [], titleInk: [], strokes: [], th: 44, unit: 1, bx: x, by: y, bw: 300, bh: 200, h: 200, done: false, due: null, repeat: '', notified: false, createdAt: Date.now(), attach: { images: [], links: [] } };
        if (withInk) {
          const pts = [[20, 60, 0.5], [80, 70, 0.5], [140, 60, 0.5], [200, 80, 0.5]];
          for (let k = 0; k < 6; k++) {
            const spts = pts.map(p => [p[0] + k * 4, p[1] + k * 6, p[2]]);
            t.strokes.push({ id: 's' + i + '-' + k, tool: 'pen', color: '#1a1a1a', width: 2, points: spts, bb: [spts[0][0], spts[0][1], spts[spts.length - 1][0], spts[spts.length - 1][1]] });
          }
        }
        pg.tasks = pg.tasks || []; pg.tasks.push(t);
      }
      markInkDirty();
      if (window.V21eo && V21eo.render) V21eo.render();
      return (pg.tasks || []).filter(t => t && t.kind === 'card').length - start;
    },
    timeRender: function (mode, reps) {
      reps = reps || 8;
      const times = [];
      for (let i = 0; i < reps; i++) {
        if (mode === 'core') {
          inkCache.clear();
          const core = V21eo.render && V21eo.render._core;
          const t0 = performance.now();
          if (core) core(); else V21eo.render();
          enhanceTitles();
          times.push(performance.now() - t0);
        } else {
          const t0 = performance.now();
          if (mode === 'full') { lastSig = { cards: '', media: '', links: '' }; inkCache.clear(); }
          V21eo.render();
          times.push(performance.now() - t0);
        }
      }
      const sum = times.reduce((a, b) => a + b, 0);
      return { mode, n: times.length, avg: sum / times.length, min: Math.min.apply(null, times), max: Math.max.apply(null, times), times };
    },
    timeDrag: function (steps) {
      steps = steps || 40;
      const times = [];
      const cards = V21eo.cardsOf ? V21eo.cardsOf().filter(t => !t.parent) : [];
      const t = cards[0]; if (!t) return { n: 0, avg: 0 };
      const el = host().querySelector('.eo-card[data-id="' + t.id + '"]');
      if (!el) return { n: 0, avg: 0 };
      const r = el.getBoundingClientRect();
      const D = { typ: 'drag', pid: 1, sx: r.left + 20, sy: r.top + 20, card: t, ghost0: [r.left, r.top], gs: 1, hideEls: [], moved: false };
      const gl = (V21eo.ghostLayer ? V21eo.ghostLayer() : document.getElementById('esGhost')) || document.createElement('div');
      if (!gl.id) { gl.id = 'esGhost'; document.body.appendChild(gl); }
      gl.classList.add('on', 'fg-lift'); gl.hidden = false;
      Object.assign(gl.style, { left: r.left + 'px', top: r.top + 'px' });
      decorateGhost(D);
      for (let i = 0; i < steps; i++) {
        const ev = { clientX: r.left + 20 + i * 4, clientY: r.top + 20 + i * 2, type: 'pointermove' };
        const t0 = performance.now();
        dragEv = ev;
        runDragFrame(null, D);
        times.push(performance.now() - t0);
      }
      gl.classList.remove('on', 'fg-lift'); gl.hidden = true; gl.style.transform = '';
      const sum = times.reduce((a, b) => a + b, 0);
      return { n: times.length, avg: sum / times.length, min: Math.min.apply(null, times), max: Math.max.apply(null, times), times };
    }
  };
})();
