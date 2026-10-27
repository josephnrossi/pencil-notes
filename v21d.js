/* Pencil Notes v21d — shell tighten: one Settings home, Archive for recordings, denser sidebar.
   Process flow: open → write/record → Meeting Brief → recordings live in Archive (left). */
(function () {
  const ARCHIVE_ID = 'archive';
  const SYS_NOTE_IDS = ['quoteboard', 'ideaboard', 'inbox'];
  const isSysNote = n => n && SYS_NOTE_IDS.includes(n.id);
  const isArchiveNb = nb => nb && nb.id === ARCHIVE_ID;

  function ensureArchiveNb() {
    let nb = S.notebooks.find(b => b.id === ARCHIVE_ID);
    if (!nb) {
      nb = { id: ARCHIVE_ID, name: 'Archive', createdAt: 0, order: 1e6, system: 'archive' };
      S.notebooks.push(nb);
      try { saveNotebook(nb); } catch (_) {}
    } else {
      nb.system = 'archive';
      if (nb.name !== 'Archive') { nb.name = 'Archive'; try { saveNotebook(nb); } catch (_) {} }
    }
    return nb;
  }

  function noteHasRecording(n) {
    if (!n || isSysNote(n)) return false;
    return n.pages.some(pg => pg.rec && ((pg.rec.segs && pg.rec.segs.length) || pg.rec.transcript || pg.rec.live && pg.rec.live.length));
  }

  function fileNoteToArchive(n, { quiet } = {}) {
    if (!n || isSysNote(n)) return false;
    ensureArchiveNb();
    if (n.notebookId === ARCHIVE_ID) return false;
    if (!noteHasRecording(n)) return false;
    n.notebookId = ARCHIVE_ID;
    n.order = -1;
    n.archivedAt = Date.now();
    try { saveNote(n); } catch (_) {}
    try { normalizeOrder(); } catch (_) {}
    try { renderSidebar(); } catch (_) {}
    if (!quiet) toast('📁 Filed to Archive', 2200);
    return true;
  }

  function migrateRecordingsToArchive({ quiet } = {}) {
    ensureArchiveNb();
    let k = 0;
    for (const n of S.notes) if (fileNoteToArchive(n, { quiet: true })) k++;
    if (k && !quiet) toast(`📁 ${k} recording${k === 1 ? '' : 's'} in Archive`, 2200);
    return k;
  }

  /* ---- Sidebar: user notebooks, then Archive pinned at the bottom ---- */
  const _renderSidebar = renderSidebar;
  renderSidebar = function () {
    if (typeof drag !== 'undefined' && drag) { sidebarDirty = true; return; }
    ensureArchiveNb();
    const box = $('#notebookList'), q = S.search.trim().toLowerCase(), cur = curNote(), now = Date.now();
    const tc = todayItems().length;
    const userNbs = sortedNotebooks().filter(nb => !isArchiveNb(nb));
    const arch = S.notebooks.find(isArchiveNb);

    const noteRow = n => {
      const tasks = n.pages.flatMap(p => p.tasks).concat(n.reminders || []).filter(t => !t.done);
      const od = tasks.filter(t => t.due && new Date(t.due) < now).length;
      const next = tasks.filter(t => t.due && new Date(t.due) >= now).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
      const sub = [new Date(n.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })];
      if (noteHasRecording(n)) sub.unshift('🎙');
      if (tasks.length) sub.push(`${tasks.length} open`);
      const hit = q ? searchMatch(n, q) : null;
      return `<div class="note-row ${cur && cur.id === n.id ? 'active' : ''}" data-note="${n.id}" role="button"><div class="meta"><div class="t">${esc(n.title)}</div>
        ${hit ? `<div class="s hit">${esc(hit)}</div>` : ''}<div class="s">${sub.join(' · ')}${od ? ` · <span class="od">${od} overdue</span>` : next ? ' · ⏰ ' + esc(fmtDue(next.due)) : ''}</div></div>
        <button class="more" data-more aria-label="Note options">⋯</button></div>`;
    };

    const nbBlock = (nb, { archive } = {}) => {
      let notes = notesIn(nb.id);
      if (q) notes = notes.filter(n => noteSearchText(n).includes(q));
      const col = S.collapsed.has(nb.id) && !q;
      const empty = archive
        ? '<div class="note-row empty"><div class="meta"><div class="s">No recordings yet — stop a meeting to file it here.</div></div></div>'
        : '<div class="note-row empty"><div class="meta"><div class="s">No notes</div></div></div>';
      return `<div class="nb ${archive ? 'nb-archive' : ''}" data-nbid="${nb.id}"><div class="nb-head ${cur && cur.notebookId === nb.id ? 'current' : ''}" data-nb="${nb.id}">
        <button data-toggle aria-label="Collapse">${col ? '▸' : '▾'}</button>
        <span class="name">${archive ? '📁 Archive' : esc(nb.name)}</span>
        ${archive ? `<span class="cnt">${notes.length || ''}</span>` : '<button data-add aria-label="New note here">＋</button><button data-nbmore aria-label="Notebook options">⋯</button>'}
      </div>
      ${col ? '' : (notes.map(noteRow).join('') || (q ? '' : empty))}</div>`;
    };

    box.innerHTML =
      `<div class="today-row" id="todayRow" role="button">☀️ <span class="name">Today</span><span class="cnt ${tc ? 'on' : ''}">${tc}</span></div>` +
      (userNbs.length ? `<div class="side-label">Notebooks</div>` : '') +
      userNbs.map(nb => nbBlock(nb)).join('') +
      (arch ? `<div class="side-label soft">Recordings</div>${nbBlock(arch, { archive: true })}` : '');
  };


  /* Boards always reachable: ensure system notes, then pin Idea / Quote / Inbox under Today.
     Root cause of “boards gone”: v21d replaced renderSidebar (breaking quotes.js wrappers), and
     the reinjection only ran when quoteNote() already existed — but startup only ensureIdeaNote(),
     so Quote (and often Idea row nested under it) never appeared. */
  {
    const _ours = renderSidebar;
    renderSidebar = function () {
      _ours();
      try {
        const box = $('#notebookList'); if (!box) return;
        if (window.__ready) {
          try { if (typeof ensureIdeaNote === 'function') ensureIdeaNote(); } catch (_) {}
          try { if (typeof ensureQuoteNote === 'function') ensureQuoteNote(); } catch (_) {}
          try { if (typeof ensureInboxNote === 'function') ensureInboxNote(); } catch (_) {}
        }
        const q = S.search.trim().toLowerCase();
        const tod = box.querySelector('#todayRow');
        let anchor = tod;

        // Idea Board
        if (!box.querySelector('#ibRow') && typeof ideaNote === 'function') {
          const ib = ideaNote();
          if (ib && !(q && typeof noteSearchText === 'function' && !noteSearchText(ib).includes(q))) {
            const ic = typeof ideaCards === 'function' ? ideaCards() : [];
            const iopen = ic.filter(c => !c.done).length;
            const ihit = q && !(typeof ibSealed === 'function' && ibSealed()) ? ic.find(c => String(c.text || '').toLowerCase().includes(q)) : null;
            const r2 = document.createElement('div'); r2.className = 'today-row qb-row'; r2.id = 'ibRow'; r2.setAttribute('role', 'button');
            r2.innerHTML = `💡 <span class="name">Idea Board${ihit ? `<small class="s hit">${esc(ihit.text)}</small>` : ''}</span><span class="cnt ${iopen ? 'on' : ''}">${typeof ibSealed === 'function' && ibSealed() ? '🔒' : iopen}</span>`;
            if (anchor && anchor.nextSibling) box.insertBefore(r2, anchor.nextSibling);
            else if (anchor) anchor.after(r2);
            else box.prepend(r2);
            anchor = r2;
          }
        } else if (box.querySelector('#ibRow')) anchor = box.querySelector('#ibRow');

        // Quote Board
        if (!box.querySelector('#qbRow') && typeof quoteNote === 'function' && typeof quoteCards === 'function') {
          const n = quoteNote();
          if (n && !(q && typeof noteSearchText === 'function' && !noteSearchText(n).includes(q))) {
            const cards = quoteCards(), open = cards.filter(t => !t.done).length;
            const hit = q && !(typeof qbSealed === 'function' && qbSealed()) ? cards.find(t => [t.text, t.q.customer, t.q.rfq, t.q.subject, ...(t.q.items || []).map(i => i.desc)].join(' ').toLowerCase().includes(q)) : null;
            const row = document.createElement('div'); row.className = 'today-row qb-row'; row.id = 'qbRow'; row.setAttribute('role', 'button');
            row.innerHTML = `💲 <span class="name">Quote Board${hit ? `<small class="s hit">${esc(hit.text)}</small>` : ''}</span><span class="cnt ${open ? 'on' : ''}">${typeof qbSealed === 'function' && qbSealed() ? '🔒' : open}</span>`;
            if (anchor && anchor.nextSibling) box.insertBefore(row, anchor.nextSibling);
            else if (anchor) anchor.after(row);
            else box.prepend(row);
            anchor = row;
          }
        } else if (box.querySelector('#qbRow')) anchor = box.querySelector('#qbRow');

        // Inbox (inbox.js helper)
        if (typeof inSidebarRow === 'function') inSidebarRow();

        // Label the board cluster once
        if (!box.querySelector('.side-label.boards') && (box.querySelector('#ibRow') || box.querySelector('#qbRow') || box.querySelector('#inRow'))) {
          const lab = document.createElement('div');
          lab.className = 'side-label boards';
          lab.textContent = 'Boards';
          const first = box.querySelector('#ibRow') || box.querySelector('#qbRow') || box.querySelector('#inRow');
          if (first) box.insertBefore(lab, first);
        }
      } catch (e) { console.warn('v21d board rows', e); }
    };
  }

  /* Protect Archive from delete / rename / new-note-into via ⋯ */
  const list = $('#notebookList');
  if (list && !list._v21d) {
    list._v21d = true;
    list.addEventListener('click', e => {
      const head = e.target.closest('[data-nb]');
      if (!head || head.dataset.nb !== ARCHIVE_ID) return;
      if (e.target.closest('[data-add]') || e.target.closest('[data-nbmore]')) {
        e.stopPropagation();
        actionSheet('📁 Archive', [
          { label: 'Recordings file here automatically when you stop', fn: () => {} },
          { label: S.collapsed.has(ARCHIVE_ID) ? 'Expand Archive' : 'Collapse Archive', fn: () => {
            S.collapsed.has(ARCHIVE_ID) ? S.collapsed.delete(ARCHIVE_ID) : S.collapsed.add(ARCHIVE_ID);
            localStorage.setItem('collapsed', JSON.stringify([...S.collapsed])); renderSidebar();
          } }
        ]);
      }
    }, true);
  }

  /* Hook stop → Archive */
  if (typeof recStop === 'function') {
    const _recStop = recStop;
    recStop = function (reason) {
      const A = R.active, noteId = A && A.noteId;
      const p = _recStop.apply(this, arguments);
      const go = () => {
        const n = noteId && S.notes.find(x => x.id === noteId);
        if (n && noteHasRecording(n)) fileNoteToArchive(n, { quiet: !!reason });
      };
      return p && typeof p.then === 'function' ? p.then(r => { go(); return r; }) : (go(), p);
    };
  }

  /* After Meeting Brief is written, ensure the note is in Archive */
  if (typeof writeBrief === 'function') {
    const _wb = writeBrief;
    writeBrief = function (f, b, engine, warn) {
      const out = _wb.apply(this, arguments);
      if (f && f.n) fileNoteToArchive(f.n, { quiet: true });
      return out;
    };
  }

  /* New meeting-template notes with a recorder stay where created until stop — OK */

  /* Block deleting the Archive notebook */
  if (typeof deleteNotebook === 'function') {
    const _del = deleteNotebook;
    deleteNotebook = async function (nb) {
      if (isArchiveNb(nb)) { toast('Archive keeps your recordings — move notes out instead of deleting it'); return; }
      return _del.apply(this, arguments);
    };
  }

  /* Move-to picker: include Archive for manual filing, exclude dumping boards */
  if (typeof noteMenu === 'function') {
    const _nm = noteMenu;
    noteMenu = function (n) {
      if (isSysNote(n)) return _nm(n);
      ensureArchiveNb();
      const others = S.notebooks.filter(b => b.id !== n.notebookId);
      actionSheet(n.title, [
        { label: 'Rename', fn: () => { const v = prompt('Note title', n.title); if (v && v.trim()) { n.title = v.trim(); saveNote(n); renderAll(); } } },
        ...(others.length ? [{ label: 'Move to notebook…', fn: () => actionSheet('Move to…', others.map(b => ({
          label: (isArchiveNb(b) ? '📁 ' : '') + b.name + (isArchiveNb(b) ? ' (recordings)' : ''),
          fn: () => { n.notebookId = b.id; n.order = -1; if (isArchiveNb(b)) n.archivedAt = Date.now(); saveNote(n); normalizeOrder(); renderSidebar(); toast(isArchiveNb(b) ? '📁 Moved to Archive' : 'Moved to ' + b.name); }
        }))) }] : []),
        { label: 'Delete note', danger: true, fn: () => deleteNote(n) }
      ]);
    };
  }


  if (typeof normalizeOrder === 'function') {
    const _norm = normalizeOrder;
    normalizeOrder = function () {
      ensureArchiveNb();
      const arch = S.notebooks.find(isArchiveNb);
      if (arch) arch.order = 1e6;
      return _norm.apply(this, arguments);
    };
  }

  /* One-time / every-load ensure Archive exists; migrate recording notes once */
  const boot = () => {
    try {
      ensureArchiveNb();
      if (!localStorage.getItem('v21dArchive')) {
        migrateRecordingsToArchive({ quiet: true });
        localStorage.setItem('v21dArchive', '1');
      }
      renderSidebar();
    } catch (e) { console.warn('v21d archive boot', e); }
  };
  if (window.__ready) boot();
  else {
    const t = setInterval(() => { if (window.__ready) { clearInterval(t); boot(); } }, 50);
    setTimeout(() => clearInterval(t), 15000);
  }

  window.V21d = { ARCHIVE_ID, ensureArchiveNb, fileNoteToArchive, noteHasRecording, migrateRecordingsToArchive, isArchiveNb };
})();
