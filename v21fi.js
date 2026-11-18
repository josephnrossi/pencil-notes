/* Pencil Notes v21fi — remove the Resin Board from the Pencil Notes UI.
   Hides the top-menu button, its pullout/panel, and any resin stale badge/alerts.
   Stops the app fetching resin-data.json.
   Does not delete resin-data.json from the repo, and never opens or deletes
   IndexedDB (inkminder / pencil-resin stay untouched). Sales Leads stays hidden. */
(() => {
  const VERSION = 'v21fi';
  const FILE_RE = /resin-data\.json(\?|$)/;

  function blockResinFetch() {
    if (blockResinFetch._done) return;
    const orig = window.fetch;
    if (typeof orig !== 'function') return;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (FILE_RE.test(String(url))) {
        window.__fiResinFetches = (window.__fiResinFetches || 0) + 1;
        return Promise.resolve(new Response('{"disabled":true}', {
          status: 404,
          statusText: 'Disabled',
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return orig.apply(this, arguments);
    };
    blockResinFetch._done = true;
  }

  function hideResinUi() {
    const btn = document.getElementById('resinBtn');
    if (btn) {
      btn.hidden = true;
      btn.setAttribute('aria-hidden', 'true');
      btn.tabIndex = -1;
      btn.style.display = 'none';
    }
    const d = document.getElementById('rbDrawer');
    if (d) {
      d.classList.remove('open', 'stale');
      d.setAttribute('aria-hidden', 'true');
      d.hidden = true;
      d.style.display = 'none';
    }
    document.body.classList.remove('rb-open');
    const stale = document.getElementById('rbStale');
    if (stale) {
      stale.hidden = true;
      stale.setAttribute('aria-hidden', 'true');
      stale.style.display = 'none';
    }
    document.querySelectorAll('.rb-stale, #rbOffline').forEach(el => {
      el.hidden = true;
      el.style.display = 'none';
    });
  }

  function stripBtnListeners() {
    const btn = document.getElementById('resinBtn');
    if (!btn || btn.dataset.fiStripped) return;
    const clone = btn.cloneNode(true);
    clone.dataset.fiStripped = '1';
    clone.hidden = true;
    clone.setAttribute('aria-hidden', 'true');
    clone.tabIndex = -1;
    clone.style.display = 'none';
    btn.replaceWith(clone);
  }

  function disarmV21ez() {
    if (typeof window.V21ez !== 'object' || !window.V21ez) return;
    const ez = window.V21ez;
    if (ez.open && !ez.open._v21fi) {
      const origClose = ez.close;
      const blocked = function () {
        try { if (typeof origClose === 'function') origClose.call(ez, { quiet: true }); } catch (_) {}
        hideResinUi();
        return Promise.resolve(null);
      };
      blocked._v21fi = true;
      ez.open = blocked;
      ez.toggle = blocked;
      ez.refresh = function () { return Promise.resolve(null); };
      ez.refresh._v21fi = true;
    }
    try { if (typeof ez.close === 'function' && ez.isOpen && ez.isOpen()) ez.close({ quiet: true }); } catch (_) {}
  }

  function placeCalcBtn() {
    const calc = document.getElementById('calcBtn');
    const q = document.getElementById('quotesBtn');
    if (calc && q && calc.parentNode && q.nextElementSibling !== calc) q.after(calc);
  }

  function hideSalesBtn() {
    const b = document.getElementById('salesBtn');
    if (!b) return;
    b.hidden = true;
    b.setAttribute('aria-hidden', 'true');
    b.tabIndex = -1;
  }

  function apply() {
    blockResinFetch();
    disarmV21ez();
    stripBtnListeners();
    hideResinUi();
    hideSalesBtn();
    placeCalcBtn();
  }

  function wrap(name, after) {
    const fn = window[name];
    if (typeof fn !== 'function' || fn._v21fi) return;
    const wrapped = function () {
      const r = fn.apply(this, arguments);
      if (r && typeof r.then === 'function') return r.then(v => { try { after(); } catch (e) { console.warn('v21fi', name, e); } return v; });
      try { after(); } catch (e) { console.warn('v21fi', name, e); }
      return r;
    };
    wrapped._v21fi = true;
    window[name] = wrapped;
  }

  function boot() {
    apply();
    wrap('renderAll', apply);
    wrap('createNote', apply);
    wrap('openNote', apply);
  }

  window.V21fi = {
    version: VERSION,
    hideResinUi,
    apply
  };

  blockResinFetch();
  apply();
  if (window.__ready) boot();
  else {
    const t0 = Date.now();
    const iv = setInterval(() => {
      apply();
      if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); boot(); }
    }, 50);
  }
})();
