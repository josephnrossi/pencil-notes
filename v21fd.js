/* Pencil Notes v21fd
   1. Remove the v21fc handwritten title strip from the UI and restore the v21fb
      topbar / toolbar layout. Default titles stay “<Template> – <date>” with
      select-all on first focus (handled by v21fc). Existing n.titleInk stays
      stored and unused; IndexedDB data is never deleted. The text title is the
      visible title in the note header, sidebar, and search, even when titleInk
      is present.
   2. Resin Board: show GPPS (general purpose PS) from the pla365/生意社 PS
      benchmark (GPPS 525 specification). HIPS has no public daily grade quote
      from a fetchable source — show that honestly, never invent a number. */
(() => {
  const VERSION = 'v21fd';
  const GPPS = 'GPPS (general purpose PS)';
  const HIPS = 'HIPS (high impact PS)';
  const PS_ALIAS = 'PS (China)';

  function displayResin(name) {
    return name === PS_ALIAS ? GPPS : name;
  }

  function restoreTopbar() {
    const top = document.getElementById('topbar');
    const inp = document.getElementById('noteTitle');
    if (!top) return;
    const strip = document.getElementById('titleStrip');
    const row = document.getElementById('topbarRow');
    const toggle = document.getElementById('toggleSidebar');
    if (inp && toggle) {
      if (inp.previousElementSibling !== toggle || (inp.parentElement !== (row || top) && inp.parentElement !== top)) {
        toggle.after(inp);
      }
    } else if (inp && inp.parentElement !== top && inp.parentElement !== row) {
      const spacer = (row || top).querySelector('.spacer');
      if (spacer) spacer.before(inp);
      else (row || top).insertBefore(inp, (row || top).firstChild);
    }
    if (strip) strip.remove();
    if (row && row.parentElement === top) {
      while (row.firstChild) top.appendChild(row.firstChild);
      row.remove();
      if (inp && toggle && toggle.parentElement === top && inp.previousElementSibling !== toggle) toggle.after(inp);
    }
  }

  function cleanListInk() {
    document.querySelectorAll('canvas.fc-ink-preview').forEach(el => el.remove());
    document.querySelectorAll('.fc-has-ink').forEach(el => el.classList.remove('fc-has-ink'));
  }

  function disarmInk() {
    if (!window.V21fc) return;
    V21fc.syncTitleStrip = function () {
      restoreTopbar();
      const n = typeof curNote === 'function' ? curNote() : null;
      const inp = document.getElementById('noteTitle');
      if (inp && n && document.activeElement !== inp && inp.value !== (n.title || '')) inp.value = n.title || '';
    };
    V21fc.decorateLists = function () { cleanListInk(); };
    V21fc.clearTitleInk = function () { return false; };
    V21fc.addTitleStroke = function () { return null; };
  }

  function wrap(name, after) {
    const fn = window[name];
    if (typeof fn !== 'function' || fn._v21fd) return;
    const wrapped = function () {
      const r = fn.apply(this, arguments);
      if (r && typeof r.then === 'function') return r.then(v => { try { after(); } catch (e) { console.warn('v21fd', name, e); } return v; });
      try { after(); } catch (e) { console.warn('v21fd', name, e); }
      return r;
    };
    wrapped._v21fd = true;
    window[name] = wrapped;
  }

  /* v21fc’s createNote / renderAll call the IIFE-local syncTitleStrip, which remounts
     the strip. Watch the topbar and unwrap whenever it comes back. */
  let topObs = null;
  function watchTopbar() {
    const top = document.getElementById('topbar');
    if (!top || topObs) return;
    topObs = new MutationObserver(() => {
      if (document.getElementById('titleStrip') || document.getElementById('topbarRow')) {
        try { restoreTopbar(); } catch (e) { console.warn('v21fd restore', e); }
      }
    });
    topObs.observe(top, { childList: true, subtree: true });
  }

  function hipsNoteText(file) {
    const rows = ((file && (file.rows || file.latest)) || []).filter(r => r && r.resin === HIPS);
    const failed = rows.find(r => r.status === 'fetch_failed');
    const reason = (failed && failed.notes) || (file && Array.isArray(file.gaps) && file.gaps.find(g => /HIPS/i.test(g))) ||
      'No public daily HIPS grade quote was fetchable. pla365 publishes the 生意社 PS benchmark on the GPPS 525 specification only, and says HIPS has no public daily grade quote.';
    return HIPS + ': ' + reason;
  }

  function enhanceResin() {
    const drawer = document.getElementById('rbDrawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    document.querySelectorAll('#rbChips button[data-r], #rbLogBody .rb-resin, #rbPrice .rb-unit, #rbResinFilter option').forEach(el => {
      if (el.tagName === 'OPTION' && el.value === PS_ALIAS && el.textContent === PS_ALIAS) el.textContent = GPPS;
      else if (el.matches && el.matches('#rbChips button[data-r]') && el.dataset.r === PS_ALIAS && el.textContent === PS_ALIAS) el.textContent = GPPS;
      else if (el.classList.contains('rb-resin') && el.textContent === PS_ALIAS) el.textContent = GPPS;
      else if (el.classList.contains('rb-unit') && el.textContent && el.textContent.indexOf(PS_ALIAS) === 0) {
        el.textContent = el.textContent.replace(PS_ALIAS, GPPS);
      }
    });

    const chips = document.getElementById('rbChips');
    const price = document.getElementById('rbPrice');
    if (chips && !chips.querySelector('[data-r="' + HIPS.replace(/"/g, '') + '"]') && !chips.querySelector('.rb-hips-gap')) {
      // Only add the HIPS gap chip on the China market (pla365 coverage).
      const chinaOn = document.querySelector('#rbSeg button[data-m="china"].on');
      if (chinaOn) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rb-hips-gap';
        b.dataset.r = HIPS;
        b.style.minHeight = '44px';
        b.textContent = HIPS;
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          chips.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
          if (price) price.innerHTML = '<div class="rb-empty">' + hipsNoteText(window.V21ez && V21ez.data && V21ez.data()) + '</div>';
        });
        chips.append(b);
      }
    }

    let note = document.getElementById('rbHipsNote');
    const chinaOn = document.querySelector('#rbSeg button[data-m="china"].on');
    if (chinaOn) {
      if (!note) {
        note = document.createElement('p');
        note.id = 'rbHipsNote';
        const live = drawer.querySelector('.rb-live');
        const after = document.getElementById('rbChips') || document.getElementById('rbSeg');
        if (after && after.parentNode) after.after(note);
        else if (live) live.prepend(note);
      }
      const msg = hipsNoteText(window.V21ez && V21ez.data && V21ez.data());
      if (note.hidden) note.hidden = false;
      if (note.textContent !== msg) note.textContent = msg;
    } else if (note) {
      note.hidden = true;
    }
  }

  let resinObs = null;
  function scheduleEnhance() { setTimeout(() => { try { enhanceResin(); } catch (e) { console.warn('v21fd resin', e); } }, 0); }
  function hookResin() {
    if (!window.V21ez) return;
    const hook = key => {
      const fn = V21ez[key];
      if (typeof fn !== 'function' || fn._v21fd) return;
      V21ez[key] = function () {
        const r = fn.apply(this, arguments);
        if (r && typeof r.then === 'function') return r.then(v => { scheduleEnhance(); return v; });
        scheduleEnhance();
        return r;
      };
      V21ez[key]._v21fd = true;
    };
    hook('open'); hook('refresh'); hook('toggle');
    const d = document.getElementById('rbDrawer');
    if (d && !d._fdBound) {
      d._fdBound = true;
      d.addEventListener('click', scheduleEnhance, true);
    }
    if (d && !resinObs) {
      let scheduled = false;
      resinObs = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => { scheduled = false; try { enhanceResin(); } catch (_) {} }, 0);
      });
      resinObs.observe(d, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    if (!hookResin._poll) {
      hookResin._poll = setInterval(() => {
        const box = document.getElementById('rbDrawer');
        if (box && box.classList.contains('open')) {
          hookResin();
          try { enhanceResin(); } catch (_) {}
        }
      }, 400);
    }
  }

  function boot() {
    disarmInk();
    restoreTopbar();
    cleanListInk();
    wrap('renderAll', () => { restoreTopbar(); cleanListInk(); });
    wrap('openNote', () => { restoreTopbar(); });
    wrap('createNote', () => { restoreTopbar(); cleanListInk(); });
    wrap('unlockWith', () => { restoreTopbar(); });
    wrap('renderSidebar', () => { cleanListInk(); });
    watchTopbar();
    hookResin();
  }

  window.V21fd = {
    version: VERSION,
    restoreTopbar,
    displayResin,
    GPPS, HIPS,
    defaultNoteTitle: (...a) => window.V21fc && V21fc.defaultNoteTitle(...a),
    templateDisplayName: (...a) => window.V21fc && V21fc.templateDisplayName(...a)
  };

  disarmInk();
  restoreTopbar();
  watchTopbar();
  if (window.__ready) boot();
  else {
    const t0 = Date.now();
    const iv = setInterval(() => {
      disarmInk(); restoreTopbar();
      if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); boot(); }
    }, 50);
  }
})();
