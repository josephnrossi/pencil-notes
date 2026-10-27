/* Pencil Notes v21e4 — find your notes after Transcribe.
   Meeting Brief stays the same IA; ← Notes always visible; Archive filing is clearer. */
(function () {
  function fromLabel(n) {
    if (!n || !n.archivedFrom) return '';
    const nb = S.notebooks.find(b => b.id === n.archivedFrom.id);
    const name = (nb && nb.name) || n.archivedFrom.name || '';
    return name ? 'from ' + name : '';
  }

  function goToNotesPage(recId) {
    const n = curNote(); if (!n) return;
    let pi = -1;
    const f = recId && typeof findRec === 'function' ? findRec(recId) : null;
    if (f && f.n && f.n.id === n.id && pageEls[f.pi]) pi = f.pi;
    if (pi < 0) {
      pi = n.pages.findIndex(pg => pg.rec && ((pg.rec.segs && pg.rec.segs.length) || pg.rec.transcript));
    }
    if (pi < 0) {
      pi = n.pages.findIndex(pg => !(pg.assist && pg.assist.brief) && ((pg.strokes && pg.strokes.length) || (pg.texts && pg.texts.length) || pg.rec));
    }
    if (pi < 0) pi = 0;
    if (pageEls[pi] && pageEls[pi].el) {
      pageEls[pi].el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      toast('Your handwritten notes & recording are on this page', 2800);
    }
  }

  /* ---- Brief header: always-visible ← Notes ---- */
  if (typeof briefHomeHTML === 'function') {
    const _bh = briefHomeHTML;
    briefHomeHTML = function (pg, s) {
      let html = _bh(pg, s);
      const n = curNote();
      const from = fromLabel(n);
      const back = `<div class="mb-back-row">
        <button class="mb-back" data-mb="notes" type="button" aria-label="Back to your notes">← Notes</button>
        <span class="mb-back-hint">Handwriting &amp; recording stay in this note</span>
        ${from ? `<span class="mb-from">${esc(from)}</span>` : ''}
      </div>`;
      html = html.replace('<header class="mb-home-head mb-head sticky">', '<header class="mb-home-head mb-head sticky">' + back);
      // Keep mic as secondary; label it so it’s not the only path
      html = html.replace('title="Recording page" aria-label="Recording">🎙</button>', 'title="Recording page — same as ← Notes" aria-label="Recording page">🎙</button>');
      return html;
    };
  }

  /* torec + new notes action */
  if (typeof PAGES !== 'undefined' && PAGES && PAGES.addEventListener) {
    PAGES.addEventListener('click', e => {
      const b = e.target.closest('[data-mb="notes"]');
      if (!b) return;
      e.stopPropagation();
      const page = b.closest('.page');
      const pi = page ? +page.dataset.pi : -1;
      const n = curNote(), pg = n && pi >= 0 && n.pages[pi];
      const recId = pg && pg.assist && pg.assist.brief && pg.assist.brief.rec;
      goToNotesPage(recId);
    }, true);
  }

  /* Stronger torec fallback */
  {
    const handler = e => {
      const b = e.target.closest('[data-mb="torec"]');
      if (!b) return;
      // Let record.js run first; if it didn't scroll, we still help via notes path after a tick
      setTimeout(() => {
        const page = b.closest('.page');
        const pi = page ? +page.dataset.pi : -1;
        const n = curNote(), pg = n && pi >= 0 && n.pages[pi];
        const recId = (pg && pg.assist && pg.assist.brief && pg.assist.brief.rec) || (b.closest('[data-rec]') && b.closest('[data-rec]').dataset.rec);
        const f = recId && findRec(recId);
        if (f && pageEls[f.pi] && Math.abs(pageEls[f.pi].el.getBoundingClientRect().top) < 80) return; // already there-ish
        goToNotesPage(recId);
      }, 50);
    };
    // Don't double-bind heavily; record.js already handles torec — enhance via notes button primarily
  }

  /* After analyze: tip once about ← Notes */
  if (typeof analyzeRec === 'function') {
    const _an = analyzeRec;
    analyzeRec = async function (recId) {
      const out = await _an.apply(this, arguments);
      try {
        const tipKey = 'v21eNotesTip';
        const tip = 'Your handwritten notes are still in this note — tap ← Notes';
        // Append tip after the Brief-ready toast (brief delay so it isn’t overwritten immediately)
        setTimeout(() => {
          if (!localStorage.getItem(tipKey)) {
            toast('← ' + tip, 5200);
            localStorage.setItem(tipKey, '1');
          } else {
            toast(tip, 3600);
          }
        }, 900);
        // Scroll Brief into view is already done by writeBrief; ensure ← Notes is above the fold
      } catch (_) {}
      return out;
    };
  }

  /* Archive: remember where it came from; clearer toast; Move back */
  function enhanceArchive() {
    if (!window.V21d || !V21d.fileNoteToArchive) return;
    const _file = V21d.fileNoteToArchive;
    V21d.fileNoteToArchive = function (n, opts = {}) {
      if (!n || n.notebookId === V21d.ARCHIVE_ID) return _file(n, opts);
      if (!V21d.noteHasRecording(n)) return _file(n, opts);
      const prev = S.notebooks.find(b => b.id === n.notebookId);
      if (prev && prev.id !== V21d.ARCHIVE_ID) {
        n.archivedFrom = { id: prev.id, name: prev.name };
      }
      const quiet = opts.quiet;
      const r = _file(n, { quiet: true });
      if (r && !quiet) {
        const nm = (n.archivedFrom && n.archivedFrom.name) || 'your notebook';
        toast('📁 In Archive — still the same note (from ' + nm + '). Tap ← Notes for handwriting.', 4200);
      }
      return r;
    };

    V21d.moveBackFromArchive = function (n) {
      if (!n || !n.archivedFrom) return false;
      let nb = S.notebooks.find(b => b.id === n.archivedFrom.id);
      if (!nb) {
        // recreate name-only notebook if deleted
        nb = { id: n.archivedFrom.id || uid('b'), name: n.archivedFrom.name || 'Notes', createdAt: Date.now(), order: S.notebooks.length };
        S.notebooks.push(nb); try { saveNotebook(nb); } catch (_) {}
      }
      n.notebookId = nb.id;
      n.order = -1;
      delete n.archivedAt;
      const from = n.archivedFrom; delete n.archivedFrom;
      try { saveNote(n); normalizeOrder(); renderSidebar(); } catch (_) {}
      toast('Moved back to ' + (from && from.name || nb.name), 2200);
      return true;
    };
  }
  enhanceArchive();

  /* noteMenu: Move back to {notebook} */
  if (typeof noteMenu === 'function') {
    const _nm = noteMenu;
    noteMenu = function (n) {
      if (n && n.notebookId === (window.V21d && V21d.ARCHIVE_ID) && n.archivedFrom) {
        const label = '↩︎ Move back to ' + (n.archivedFrom.name || 'notebook');
        actionSheet(n.title, [
          { label, primary: true, fn: () => V21d.moveBackFromArchive(n) },
          { label: 'Rename', fn: () => { const v = prompt('Note title', n.title); if (v && v.trim()) { n.title = v.trim(); saveNote(n); renderAll(); } } },
          { label: 'Move to notebook…', fn: () => {
            V21d.ensureArchiveNb();
            const others = S.notebooks.filter(b => b.id !== n.notebookId);
            actionSheet('Move to…', others.map(b => ({
              label: (V21d.isArchiveNb(b) ? '📁 ' : '') + b.name,
              fn: () => { n.notebookId = b.id; n.order = -1; if (!V21d.isArchiveNb(b)) { delete n.archivedAt; delete n.archivedFrom; } saveNote(n); normalizeOrder(); renderSidebar(); toast('Moved to ' + b.name); }
            })));
          } },
          { label: 'Delete note', danger: true, fn: () => deleteNote(n) }
        ]);
        return;
      }
      return _nm(n);
    };
  }

  /* Sidebar Archive rows: show from-label */
  if (typeof renderSidebar === 'function' && window.V21d) {
    const _rs = renderSidebar;
    renderSidebar = function () {
      _rs.apply(this, arguments);
      try {
        document.querySelectorAll('#notebookList .nb-archive .note-row[data-note]').forEach(row => {
          const n = S.notes.find(x => x.id === row.dataset.note);
          const lab = fromLabel(n);
          if (!lab) return;
          const s = row.querySelector('.meta .s');
          if (s && !s.textContent.includes('from ')) s.textContent = lab + ' · ' + s.textContent;
        });
      } catch (_) {}
    };
  }

  window.V21e = { goToNotesPage, fromLabel };
})();
