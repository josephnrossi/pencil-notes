/* Pencil Notes v21e4 — refine post-transcribe landing + Boards/Archive clarity.
   Stay on Notes after analyze; chip opens Brief; qbTab says Boards; Archive Undo. */
(function () {
  /* ---- 1. After analyze: stay on recording page; Brief chip + banner ---- */
  function showBriefReadyBanner(recId) {
    let ban = document.getElementById('briefReadyBan');
    if (!ban) {
      ban = document.createElement('div');
      ban.id = 'briefReadyBan';
      ban.setAttribute('role', 'status');
      document.body.append(ban);
      ban.addEventListener('click', e => {
        const b = e.target.closest('[data-br]');
        if (!b) return;
        if (b.dataset.br === 'open') { ban.hidden = true; if (typeof gotoBrief === 'function') gotoBrief(ban.dataset.rec); }
        else if (b.dataset.br === 'x') ban.hidden = true;
      });
    }
    ban.dataset.rec = recId || '';
    ban.hidden = false;
    ban.innerHTML = `<span><b>📋 Meeting Brief ready</b> — same note · your handwriting is on Notes</span>
      <button class="btn primary" data-br="open">Open Brief</button>
      <button class="btn small" data-br="x" aria-label="Dismiss">✕</button>`;
    const toastEl = document.getElementById('toast'); if (toastEl) toastEl.hidden = true;
    clearTimeout(showBriefReadyBanner._t);
    showBriefReadyBanner._t = setTimeout(() => { if (ban) ban.hidden = true; }, 12000);
  }

  function stayOnRecordingPage(recId) {
    const f = typeof findRec === 'function' && findRec(recId);
    if (f && pageEls[f.pi] && pageEls[f.pi].el) {
      pageEls[f.pi].el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return true;
    }
    if (window.V21e && V21e.goToNotesPage) { V21e.goToNotesPage(recId); return true; }
    return false;
  }

  if (typeof writeBrief === 'function') {
    const _wb = writeBrief;
    writeBrief = function (f, b, engine, warn) {
      const out = _wb.apply(this, arguments);
      const recId = f && f.rec && f.rec.id;
      // After pages rebuild, stay on the recording/ink page — don’t strand on Brief
      requestAnimationFrame(() => {
        stayOnRecordingPage(recId);
        if (recId) showBriefReadyBanner(recId);
        try { rerenderRec(); } catch (_) {}
      });
      return out;
    };
  }

  if (typeof analyzeRec === 'function') {
    const _an = analyzeRec;
    analyzeRec = async function (recId) {
      const out = await _an.apply(this, arguments);
      // Replace the generic toast with a clearer one (banner carries the CTA)
      setTimeout(() => {
        toast('📋 Brief ready — you’re still on your notes. Tap the chip or banner to open it.', 4200);
        stayOnRecordingPage(recId);
        showBriefReadyBanner(recId);
        try { rerenderRec(); } catch (_) {}
      }, 200);
      return out;
    };
  }

  /* Emphasize Brief chip on the recording panel */
  if (typeof recPanelHTML === 'function') {
    const _rp = recPanelHTML;
    recPanelHTML = function (n, pg, compact) {
      let html = _rp(n, pg, compact);
      html = html.replace(/>📋 Meeting Brief</g, '>📋 Meeting Brief ready — open<');
      return html;
    };
  }

  /* Larger ← Notes + clearer same-note line on Brief */
  if (typeof briefHomeHTML === 'function') {
    const _bh = briefHomeHTML;
    briefHomeHTML = function (pg, s) {
      let html = _bh(pg, s);
      // Upgrade back row copy if v21e already injected it
      html = html.replace(
        /<span class="mb-back-hint">[^<]*<\/span>/,
        '<span class="mb-back-hint">Same note · your handwriting is on Notes</span>'
      );
      html = html.replace('class="mb-back"', 'class="mb-back mb-back-lg"');
      return html;
    };
  }

  /* ---- 2. qbTab always says Boards when drawer is closed ---- */
  function syncBoardsTab() {
    const tab = document.getElementById('qbTab'); if (!tab) return;
    const open = typeof QB !== 'undefined' && QB.open;
    const span = tab.querySelector('span'), b = tab.querySelector('b');
    if (!open) {
      if (span) span.textContent = '📋';
      if (b) b.textContent = 'Boards';
      tab.setAttribute('aria-label', 'Open Boards — Quote Board, Idea Board & Inbox');
      tab.title = 'Boards — tap or swipe in from the right edge';
    } else if (typeof BOARDS !== 'undefined' && QB.mode && BOARDS[QB.mode]) {
      const B = BOARDS[QB.mode];
      if (span) span.textContent = B.ic;
      if (b) b.textContent = B.short;
      tab.setAttribute('aria-label', 'Open the ' + B.name);
    }
  }
  if (typeof qbOpen === 'function') {
    const _qo = qbOpen;
    qbOpen = function () {
      const r = _qo.apply(this, arguments);
      syncBoardsTab();
      return r;
    };
  }
  if (typeof setDrawerBoard === 'function') {
    const _sd = setDrawerBoard;
    setDrawerBoard = function () {
      const r = _sd.apply(this, arguments);
      syncBoardsTab();
      return r;
    };
  }
  // Initial + keep visible on narrow widths
  const bootTab = () => {
    syncBoardsTab();
    const tab = document.getElementById('qbTab'), btn = document.getElementById('quotesBtn');
    if (tab) { tab.classList.remove('hide'); tab.style.display = ''; }
    if (btn) { btn.style.display = ''; btn.hidden = false; }
  };
  if (window.__ready) bootTab();
  else { const t = setInterval(() => { if (window.__ready) { clearInterval(t); bootTab(); } }, 50); setTimeout(() => clearInterval(t), 12000); }

  /* ---- 3. Archive with Undo “Keep in {notebook}” ---- */
  if (window.V21d && V21d.fileNoteToArchive) {
    const _file = V21d.fileNoteToArchive;
    V21d.fileNoteToArchive = function (n, opts = {}) {
      if (!n || (window.V21d && n.notebookId === V21d.ARCHIVE_ID)) return _file.call(this, n, opts);
      if (!V21d.noteHasRecording(n)) return _file.call(this, n, opts);
      const prev = S.notebooks.find(b => b.id === n.notebookId);
      const prevSnap = prev ? { id: prev.id, name: prev.name } : null;
      // Let underlying set archivedFrom; force quiet then our undo toast
      const r = _file.call(this, n, { quiet: true });
      if (r && !opts.quiet && prevSnap && typeof actionToast === 'function') {
        n.archivedFrom = n.archivedFrom || prevSnap;
        actionToast('📁 In Archive — still the same note (from ' + prevSnap.name + ')', 'Keep in ' + prevSnap.name, () => {
          if (window.V21d && V21d.moveBackFromArchive) V21d.moveBackFromArchive(n);
          else {
            n.notebookId = prevSnap.id; n.order = -1; delete n.archivedAt; delete n.archivedFrom;
            saveNote(n); normalizeOrder(); renderSidebar();
            toast('Kept in ' + prevSnap.name, 2000);
          }
        }, 7000);
      } else if (r && !opts.quiet) {
        toast('📁 In Archive — still the same note', 3200);
      }
      return r;
    };
  }

  /* ---- 4. Recording panel chip opens Brief (already data-rc=brief); ensure banner visible after stop+auto ---- */
  window.V21e2 = { showBriefReadyBanner, stayOnRecordingPage, syncBoardsTab };
})();
