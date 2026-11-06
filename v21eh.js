/* Pencil Notes v21eh — follow-ups to v21eg.
   1. Theme: one-time migration (index.html inline script, before first paint): a missing or old “Dark” setting becomes
      Match iPad (system); an explicit Light stays. Repeated here in case the inline script was skipped. The Appearance
      sheet lists Match iPad first.
   2. Quick tour: gone (startTour is a no-op in audit.js, no Settings row, tourDone=1, no steps).
   3. Old first-run samples on existing installs (“Work — start here” / “Personal — start here”): the seed welcome text
      boxes and the seed demo task are removed; a note left with nothing of the user's becomes “Untitled note”.
      Anything the user wrote stays. Other notes are never touched.
   4. 🧾 Quote sheet + ✅ Daily To-Do are page templates in Add page… and New note (as well as ＋ Insert). */
(function () {
  'use strict';
  try {
    if (!localStorage.getItem('themeV21eh')) { const o = localStorage.getItem('theme'); if (!o || o === 'dark') localStorage.setItem('theme', 'system'); localStorage.setItem('themeV21eh', '1'); }
    localStorage.setItem('tourDone', '1');
    applyTheme();
  } catch (_) {}
  try { if (typeof TOUR !== 'undefined') TOUR.length = 0; } catch (_) {}
  try { startTour = function () {}; } catch (_) {}
  try { document.querySelectorAll('#tourWrap').forEach(w => { w.hidden = true; }); } catch (_) {}

  themeMenu = function () {
    const m = t => (themePref() === t ? '✓ ' : '');
    actionSheet('Appearance', [{ label: m('system') + 'Match iPad (system)', sub: 'Light or dark, following your iPad', fn: () => setTheme('system') },
      { label: m('light') + 'Light', fn: () => setTheme('light') }, { label: m('dark') + 'Dark', fn: () => setTheme('dark') }]);
  };

  const SEED_TITLES = ['Work — start here', 'Personal — start here'];
  const SEED_TASKS = ['Prep notes for Monday standup', 'Call the dentist'];
  const isSeedText = t => t && typeof t.text === 'string' && (/^Welcome to Pencil Notes/.test(t.text) || /^Circle handwriting with ➰ Lasso, then tap "Make task"\./.test(t.text));
  function cleanSeeds() {
    let changed = 0;
    for (const n of S.notes) {
      if (!SEED_TITLES.includes(n.title)) continue;
      try { if (typeof isSealed === 'function' && isSealed(n)) continue; } catch (_) {}
      const pg = n.pages && n.pages[0]; if (!pg || !(pg.texts || []).some(t => /^Welcome to Pencil Notes/.test(t.text || ''))) continue;
      pg.texts = pg.texts.filter(t => !isSeedText(t));
      pg.tasks = (pg.tasks || []).filter(t => !(t.kind === 'typed' && SEED_TASKS.includes(t.text) && !(t.strokes && t.strokes.length)));
      const empty = n.pages.every(p => !(p.strokes || []).length && !(p.texts || []).length && !(p.tasks || []).length && !(p.images || []).length && !(p.sections || []).length && !p.bg && !p.qsheet && !p.todo);
      if (empty) n.title = 'Untitled note';
      saveNote(n, true); changed++;
    }
    if (changed) { try { buildPages(); renderAll(); if (S.cur && $('#noteTitle')) $('#noteTitle').value = (S.notes.find(x => x.id === S.cur) || {}).title || ''; } catch (_) { try { renderSidebar(); } catch (__) {} } }
    return changed;
  }
  const run = () => { try { cleanSeeds(); } catch (e) { console.warn('v21eh seeds', e); } };
  if (window.__ready) run(); else { const t0 = Date.now(), iv = setInterval(() => { if (window.__ready || Date.now() - t0 > 10000) { clearInterval(iv); run(); } }, 100); }

  /* 4. 🧾 Quote sheet (and ✅ Daily To-Do) as first-class page templates: Add page… and New note pickers.
        Same behaviour as ＋ Insert: the current page becomes the template if it is blank, else a new page right after it. */
  const PAGE_TPL = { qsheet: () => window.V21ed && V21ed.insertSheet, todo: () => window.V21ee && V21ee.insertTodo };
  { const at = Math.max(0, TEMPLATES.findIndex(t => t[0] === 'blank') + 1);
    if (!TEMPLATES.some(t => t[0] === 'qsheet')) TEMPLATES.splice(at, 0, ['qsheet', '🧾 Quote sheet'], ['todo', '✅ Daily To-Do']); }
  const _ap = addPage;
  addPage = async function (kind) {
    if (typeof kind !== 'string') kind = await chooseTemplate('Add page');
    const f = PAGE_TPL[kind] && PAGE_TPL[kind]();
    if (f) { const pi = typeof currentPageIndex === 'function' ? currentPageIndex() : undefined; return f(pi); }
    return kind ? _ap.call(this, kind) : undefined;
  };
  const _cn = createNote;
  createNote = function (nbId, kind) {
    const f = PAGE_TPL[kind] && PAGE_TPL[kind]();
    if (!f) return _cn.apply(this, arguments);
    const r = _cn.call(this, nbId, 'blank');
    try { f(0); } catch (e) { console.warn('v21eh template', e); }
    return r;
  };
  { const s = document.querySelector('#insPage small'); if (s) s.textContent = 'Lined, grid, quote sheet, to-do, meeting…'; }

  window.V21eh = { version: 'v21eh', cleanSeeds };
})();
