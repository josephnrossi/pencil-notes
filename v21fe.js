/* Pencil Notes v21fe
   1. Keep the topbar below the iOS status bar (CSS safe-area; this file only defends the layout).
   2. Hide the Sales Leads button (standalone app). v21fb code and data stay; IndexedDB is never deleted.
   3. Notes whose title is still empty / “Untitled” / “Untitled note” get
      “<Template display name> – <date of the note’s createdAt>”. User-typed titles are never overwritten.
      New notes already get this default from v21fc; this also covers “+ New note”, Daily To-Do, and Today. */
(() => {
  const VERSION = 'v21fe';
  const PLACEHOLDERS = new Set(['', 'untitled', 'untitled note']);

  function hideSalesBtn() {
    const b = document.getElementById('salesBtn');
    if (!b) return;
    b.hidden = true;
    b.setAttribute('aria-hidden', 'true');
    b.tabIndex = -1;
    if (typeof window.V21fb === 'object' && V21fb.isOpen && V21fb.isOpen() && typeof V21fb.close === 'function') {
      try { V21fb.close(); } catch (_) {}
    }
  }

  function noteKind(n) {
    if (!n || !n.pages || !n.pages.length) return n && n.paper ? n.paper : 'lined';
    for (const p of n.pages) {
      if (!p) continue;
      if (p.todo) return 'todo';
      if (p.qsheet) return 'qsheet';
      if (p.bg && p.bg.name) return p.bg.name;
      if (p.paper && p.paper !== 'blank' && p.paper !== 'lined') return p.paper;
    }
    if (n.paper && n.paper !== 'blank') return n.paper;
    return 'lined';
  }
  function isPlaceholderTitle(t) {
    return PLACEHOLDERS.has(String(t || '').trim().toLowerCase());
  }
  function isUserNote(n) {
    if (!n || n.system || (n.id && ['quoteboard', 'ideaboard', 'inbox'].includes(n.id))) return false;
    try { if (typeof isSealed === 'function' && isSealed(n)) return false; } catch (_) {}
    return true;
  }
  function defaultTitleFor(n) {
    const fn = window.V21fc && V21fc.defaultNoteTitle;
    const created = n && n.createdAt ? new Date(n.createdAt) : new Date();
    if (typeof fn === 'function') return fn(noteKind(n), created);
    const kind = noteKind(n);
    const names = { lined: 'Lined', grid: 'Grid', blank: 'Blank', qsheet: 'Quote sheet', todo: 'Daily To-Do', meeting: 'Meeting', planner: 'Planner', board: 'Project Board', assistant: 'Assistant', recording: 'Meeting Recording' };
    const d = created.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    return (names[kind] || 'Note') + ' – ' + d;
  }
  function fillPlaceholderTitles() {
    const notes = (typeof S !== 'undefined' && S.notes) || [];
    let changed = 0;
    for (const n of notes) {
      if (!isUserNote(n) || !isPlaceholderTitle(n.title)) continue;
      n.title = defaultTitleFor(n);
      try { saveNote(n, true); } catch (_) { try { saveNote(n); } catch (__) {} }
      changed++;
      if (typeof S !== 'undefined' && S.cur === n.id) {
        const inp = document.getElementById('noteTitle');
        if (inp && document.activeElement !== inp) {
          inp.value = n.title;
          inp.dataset.defaultTitle = n.title;
        }
      }
    }
    if (changed) {
      try { renderSidebar(); } catch (_) {}
    }
    return changed;
  }

  function wrap(name, after) {
    const fn = window[name];
    if (typeof fn !== 'function' || fn._v21fe) return;
    const wrapped = function () {
      const r = fn.apply(this, arguments);
      if (r && typeof r.then === 'function') return r.then(v => { try { after(); } catch (e) { console.warn('v21fe', name, e); } return v; });
      try { after(); } catch (e) { console.warn('v21fe', name, e); }
      return r;
    };
    wrapped._v21fe = true;
    window[name] = wrapped;
  }

  function boot() {
    hideSalesBtn();
    fillPlaceholderTitles();
    wrap('renderAll', () => { hideSalesBtn(); fillPlaceholderTitles(); });
    wrap('openNote', () => { fillPlaceholderTitles(); });
    wrap('createNote', () => { hideSalesBtn(); });
    wrap('renderSidebar', () => { fillPlaceholderTitles(); });
  }

  window.V21fe = {
    version: VERSION,
    hideSalesBtn,
    fillPlaceholderTitles,
    isPlaceholderTitle,
    noteKind,
    defaultTitleFor
  };

  hideSalesBtn();
  if (window.__ready) boot();
  else {
    const t0 = Date.now();
    const iv = setInterval(() => {
      hideSalesBtn();
      if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); boot(); }
    }, 50);
  }
})();
