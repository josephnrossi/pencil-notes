/* Pencil Notes v21fk — handwriting stays responsive on template pages.
   Overflow / reflow / continuation work never runs during an active Pencil
   stroke. It is scheduled for structural changes only, then flushed when
   the pointer is idle after pointerup. Ink canvases and overlay DOM are
   not rebuilt mid-stroke. v21fj behavior (no “page is full” toast,
   auto-continuation, Tomorrow toggle, ink anchoring) is unchanged.
   IndexedDB is never opened or deleted here. */
(() => {
  'use strict';
  const VERSION = 'v21fk';
  const IDLE_MS = 48;

  function strokeActive() {
    try {
      return !!(typeof drawing === 'object' && drawing && (drawing.stroke || drawing.tool === 'eraser' || drawing.lasso));
    } catch (_) { return false; }
  }

  let pending = [];
  let idleTimer = 0;
  let wantBuild = false;
  let flushing = false;

  function scheduleIdle(fn) {
    if (typeof fn === 'function') pending.push(fn);
    armIdle();
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (strokeActive()) return;
    idleTimer = setTimeout(flushIdle, IDLE_MS);
  }

  function flushIdle() {
    if (strokeActive()) { armIdle(); return; }
    if (flushing) return;
    flushing = true;
    try {
      const jobs = pending.splice(0);
      const build = wantBuild;
      wantBuild = false;
      for (const fn of jobs) {
        try { fn(); } catch (e) { console.warn('v21fk idle', e); }
      }
      if (build && typeof _buildPages === 'function') {
        try { _buildPages(); } catch (e) { console.warn('v21fk build', e); }
      }
    } finally { flushing = false; }
  }

  window.addEventListener('pointerup', armIdle, { passive: true });
  window.addEventListener('pointercancel', armIdle, { passive: true });

  /* ---------- wrap rebuilds so they cannot run mid-stroke ---------- */
  let _buildPages = typeof buildPages === 'function' ? buildPages : null;
  if (_buildPages && !_buildPages._v21fk) {
    buildPages = function () {
      if (strokeActive() || flushing && wantBuild) {
        wantBuild = true;
        scheduleIdle(null);
        return;
      }
      return _buildPages.apply(this, arguments);
    };
    buildPages._v21fk = true;
  }

  let _renderPageInk = typeof renderPageInk === 'function' ? renderPageInk : null;
  if (_renderPageInk && !_renderPageInk._v21fk) {
    renderPageInk = function (pi) {
      if (strokeActive() && drawing && drawing.pi === pi) return;
      return _renderPageInk.apply(this, arguments);
    };
    renderPageInk._v21fk = true;
  }

  let _renderOverlay = typeof renderOverlay === 'function' ? renderOverlay : null;
  if (_renderOverlay && !_renderOverlay._v21fk) {
    renderOverlay = function (pi) {
      if (strokeActive() && drawing && (drawing.pi === pi || pi == null)) return;
      return _renderOverlay.apply(this, arguments);
    };
    renderOverlay._v21fk = true;
  }

  /* Immediate IndexedDB writes mid-stroke hitch iPad Pencil sampling. Debounce them. */
  let _saveNote = typeof saveNote === 'function' ? saveNote : null;
  if (_saveNote && !_saveNote._v21fk) {
    saveNote = function (note, immediate) {
      if (strokeActive() && immediate) return _saveNote.call(this, note, false);
      return _saveNote.apply(this, arguments);
    };
    saveNote._v21fk = true;
  }

  /* Meeting auto-grow was painting / sometimes rebuilding the page on pointermove. */
  function hookGrow() {
    if (!window.V21ep || typeof V21ep.growTask !== 'function' || V21ep.growTask._v21fk) return;
    const _grow = V21ep.growTask;
    V21ep.growTask = function () {
      if (strokeActive()) return false; // maybeGrow on pointerup still grows once the stroke has ended
      return _grow.apply(this, arguments);
    };
    V21ep.growTask._v21fk = true;
  }

  /* Extra v21fj overlay/draw work is cheap but must not run mid-stroke. */
  function hookDraw() {
    if (typeof v7OverlayHook === 'function' && !v7OverlayHook._v21fkStroke) {
      const _ov = v7OverlayHook;
      v7OverlayHook = function (pi) {
        if (strokeActive()) return;
        return _ov.apply(this, arguments);
      };
      v7OverlayHook._v21fkStroke = true;
    }
  }

  /* Reflow APIs: if invoked mid-stroke, run after pointerup. */
  function hookReflow() {
    if (!window.V21fj) return;
    ['reflowOrigin', 'addUntilCont'].forEach(key => {
      const fn = V21fj[key];
      if (typeof fn !== 'function' || fn._v21fk) return;
      V21fj[key] = function () {
        const args = arguments, ctx = this;
        if (strokeActive()) {
          let result;
          scheduleIdle(() => { result = fn.apply(ctx, args); });
          return result;
        }
        return fn.apply(ctx, args);
      };
      V21fj[key]._v21fk = true;
    });
  }

  function boot() {
    hookGrow();
    hookDraw();
    hookReflow();
  }
  boot();
  if (!window.__ready) {
    const t0 = Date.now();
    const iv = setInterval(() => {
      boot();
      if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); boot(); }
    }, 50);
  }

  window.V21fk = {
    version: VERSION,
    strokeActive, scheduleIdle, flushIdle,
    IDLE_MS
  };
})();
