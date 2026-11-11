/* Pencil Notes v21ev — Meeting recordings archive ONLY the recording. Mock only. Loads after v21eu (keeps v21eu typed quotes).
   Joseph: "when a meeting is recorded, just archive the recording, not the entire handwritten template — keep that where it was."
   Before (v21d → v21eu): every Meeting Notes page carries pg.rec. On ⏹ Stop (v21d recStop hook) and again when the Meeting Brief
   was written (v21d writeBrief hook), the WHOLE note — handwritten template, ink, action items, reminders — was moved into the
   hidden-at-the-bottom "📁 Archive" notebook (n.notebookId = 'archive', order −1, archivedAt), i.e. it vanished from its notebook.
   v21d also ran a one-time boot migration that moved every note with audio into Archive.
   Now:
   1. Stopping a recording never moves the note. The recording (audio, captions, transcript, brief link) is filed into 📁 Recordings
      (rec.archivedAt). The handwritten page stays in its notebook in the same place and order. A Meeting Brief page for a recording made
      on a handwritten page is appended at the END of the note so existing pages keep their positions.
   2. A recorded handwritten page shows one small badge "🎙 Recording · 12:34 · Open" (44px) instead of the corner player.
   3. 📁 Recordings sheet: one place for every recording (title, date, length, where its page is) with Play, Open page,
      Transcribe/Brief, ⋯, Delete (confirms; Undo; the page is never deleted).
   4. Migration (idempotent, every load + after import): any note sitting in the old Archive notebook is put back in the notebook it
      came from (archivedFrom), or in a visible "Restored meetings" notebook. Nothing is deleted; the old Archive notebook record is
      kept (hidden). Old archive info is kept on the note as v21evRestored.
   5. Clean-up: one way to record (⋯ → Record a meeting), Insert → Recording duplicate removed, "Move to → 📁 Archive" removed,
      sidebar Archive folder replaced by one "📁 Recordings" row, Settings / Go to entries open the same sheet, stale copy rewritten. */
(function () {
  'use strict';
  const VERSION = 'v21ev';
  const ARCH = 'archive', RESTORED = 'restored-meetings';
  const SYS = ['quoteboard', 'ideaboard', 'inbox'];
  const isSys = n => !n || SYS.includes(n.id) || String(n.notebookId || '').startsWith('__');
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const recHas = r => !!(r && ((r.segs && r.segs.length) || (r.transcript && r.transcript.segs && r.transcript.segs.length) || (r.live && r.live.length)));
  const recPage = pg => typeof isRecPage === 'function' && isRecPage(pg);
  const live = r => !!(r && typeof R !== 'undefined' && R.active && R.active.recId === r.id);
  const fmt = ms => (typeof mmss === 'function' ? mmss(ms) : Math.round((ms || 0) / 1000) + 's');
  const escH = s => (typeof esc === 'function' ? esc(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

  // v21d's boot migration moved every recorded note into Archive the first time it ran on a device. Never again.
  try { localStorage.setItem('v21dArchive', '1'); } catch (_) {}

  /* ---------------- toasts from the old whole-note filing are stale copy ---------------- */
  if (typeof toast === 'function') {
    const _toast = toast;
    toast = function (msg) { if (/^📁 (Filed to Archive|In Archive|Moved to Archive)|^🎙 Saved \d/.test(String(msg || ''))) return; return _toast.apply(this, arguments); };
  }

  /* ---------------- recordings index (derived from notes — the audio stays with its page data) ---------------- */
  function recordings() {
    const out = [];
    for (const n of S.notes) {
      if (isSys(n) || sealed(n) || n.notebookId === ARCH) continue;
      (n.pages || []).forEach((pg, pi) => { if (pg && pg.rec && recHas(pg.rec)) out.push({ n, pg, pi, rec: pg.rec }); });
    }
    return out.sort((a, b) => (b.rec.startedAt || b.rec.createdAt || 0) - (a.rec.startedAt || a.rec.createdAt || 0));
  }
  const lockedCount = () => S.notes.filter(n => !isSys(n) && sealed(n)).length;
  function fileRecording(rec) { if (rec && recHas(rec) && !rec.archivedAt) { rec.archivedAt = Date.now(); return true; } return false; }

  /* ---------------- 1. stop / brief never move the note ---------------- */
  function snap(n) {
    if (!n) return null;
    const orders = new Map(S.notes.filter(x => x.notebookId === n.notebookId).map(x => [x.id, x.order]));
    return { id: n.id, nb: n.notebookId, orders };
  }
  function putBack(s, { quietSave } = {}) {
    if (!s) return false;
    const n = S.notes.find(x => x.id === s.id); if (!n) return false;
    let moved = false;
    if (n.notebookId !== s.nb) { n.notebookId = s.nb; moved = true; }
    if ('archivedAt' in n && s.nb !== ARCH) { delete n.archivedAt; moved = true; }
    if (n.archivedFrom && s.nb !== ARCH) { delete n.archivedFrom; moved = true; }
    if (moved) {
      for (const x of S.notes) if (s.orders.has(x.id) && x.order !== s.orders.get(x.id)) { x.order = s.orders.get(x.id); if (x !== n) DB.put('notes', x).catch(() => {}); }
      try { normalizeOrder(); } catch (_) {}
      if (!quietSave) saveNote(n);
      try { renderSidebar(); } catch (_) {}
    }
    return moved;
  }

  if (typeof recStop === 'function') {
    const _stop = recStop;
    recStop = function (reason) {
      const A = typeof R !== 'undefined' && R.active, n = A && S.notes.find(x => x.id === A.noteId), s = snap(n), recId = A && A.recId;
      const p = _stop.apply(this, arguments);
      const after = () => {
        putBack(s);
        const f = recId && typeof findRec === 'function' && findRec(recId);
        if (f && fileRecording(f.rec)) saveNote(f.n);
        if (f && recHas(f.rec) && !reason && !(A && A.stopping === 'v21ev-quiet')) toast(`🎙 ${fmt(f.rec.dur)} saved to 📁 Recordings — your page stays here`, 3200);
        try { if (f && f.n.id === S.cur) renderRecPanel(f.pi); } catch (_) {}
        try { renderSidebar(); } catch (_) {}
      };
      return p && typeof p.then === 'function' ? p.then(r => { after(); return r; }) : (after(), p);
    };
  }

  if (typeof writeBrief === 'function') {
    const _wb = writeBrief;
    writeBrief = function (f) {
      const s = snap(f && f.n);
      const out = _wb.apply(this, arguments);
      try {
        putBack(s);
        const n = f && f.n, recId = f && f.rec && f.rec.id;
        if (n && recId) {
          const ri = n.pages.findIndex(pg => pg.rec && pg.rec.id === recId);
          const bi = n.pages.findIndex(pg => pg.assist && pg.assist.brief && pg.assist.brief.rec === recId);
          // recording made on a handwritten page: don't wedge the Brief between handwritten pages — append it at the end
          if (ri >= 0 && bi === ri + 1 && !recPage(n.pages[ri]) && bi !== n.pages.length - 1) {
            const [bp] = n.pages.splice(bi, 1); n.pages.push(bp); saveNote(n, true);
            if (n.id === S.cur) { buildPages(); renderAll(); }
          }
          fileRecording(f.rec); saveNote(n);
        }
      } catch (e) { console.warn('v21ev brief', e); }
      return out;
    };
  }

  // anything still calling the old API files the RECORDING only
  if (window.V21d) {
    V21d.fileNoteToArchive = function (n) { let k = 0; if (n && !isSys(n)) for (const pg of n.pages || []) if (pg.rec && fileRecording(pg.rec)) k++; if (k) saveNote(n); return false; };
    V21d.migrateRecordingsToArchive = function () { return migrate(); };
  }

  /* ---------------- 4. migration: put whole-note archives back ---------------- */
  function ensureRestoredNb() {
    let nb = S.notebooks.find(b => b.id === RESTORED);
    if (!nb) { nb = { id: RESTORED, name: 'Restored meetings', createdAt: Date.now(), order: S.notebooks.filter(b => b.id !== ARCH).length }; S.notebooks.push(nb); saveNotebook(nb); }
    return nb;
  }
  let migrating = false;
  function migrate() {
    if (migrating) return 0; migrating = true;
    let k = 0;
    try {
      const list = S.notes.filter(n => n.notebookId === ARCH && !SYS.includes(n.id)).sort((a, b) => (a.archivedAt || 0) - (b.archivedAt || 0));
      for (const n of list) {
        const from = n.archivedFrom && n.archivedFrom.id;
        const target = (from && from !== ARCH && S.notebooks.find(b => b.id === from)) || ensureRestoredNb();
        // best guess at the original position: explicit order if we ever stored one, else by creation time among its neighbours
        const sibs = notesIn(target.id);
        let at = typeof (n.archivedFrom && n.archivedFrom.order) === 'number' ? n.archivedFrom.order : sibs.findIndex(x => (x.createdAt || 0) < (n.createdAt || 0));
        if (at < 0 || at > sibs.length) at = sibs.length;
        sibs.splice(at, 0, n);
        if (!sealed(n)) n.v21evRestored = { at: Date.now(), archivedAt: n.archivedAt || null, from: n.archivedFrom || null, to: target.id };
        if (!sealed(n)) { delete n.archivedAt; delete n.archivedFrom; }
        n.notebookId = target.id;
        sibs.forEach((x, i) => { if (x.order !== i || x === n) { x.order = i; DB.put('notes', x).catch(() => {}); } });
        if (!sealed(n)) for (const pg of n.pages || []) if (pg.rec) fileRecording(pg.rec);
        k++;
      }
      if (k) { try { normalizeOrder(); } catch (_) {} }
    } catch (e) { console.warn('v21ev migrate', e); }
    migrating = false;
    return k;
  }

  /* ---------------- 2. badge on the handwritten page ---------------- */
  function badgeHTML(rec, label) {
    return `<button type="button" class="ev-recbadge" data-evrec="${escH(rec.id)}" aria-label="Recording, ${fmt(rec.dur)}. Open in Recordings">🎙 <b>${label || 'Recording'}</b> · <span class="ev-dur">${fmt(rec.dur)}</span> · <u>Open</u></button>`;
  }
  function addBadge(pi, rec) {
    const el = pageEls[pi]; if (!el) return;
    const s = S.scale, L = document.createElement('div');
    L.className = 'rc-layer ev-badge-layer';
    L.innerHTML = badgeHTML(rec);
    const b = L.firstElementChild; b.style.position = 'absolute'; b.style.top = (34 * s) + 'px'; b.style.right = (40 * s) + 'px';
    el.ov.append(L);
  }
  if (typeof renderRecPanel === 'function') {
    const _rr = renderRecPanel;
    renderRecPanel = function (pi) {
      const r = _rr.apply(this, arguments);
      try {
        const n = curNote(), pg = n && n.pages[pi], el = pageEls[pi];
        if (el && pg && pg.rec && !recPage(pg) && !live(pg.rec) && recHas(pg.rec) && !sealed(n)) {
          el.ov.querySelectorAll('.rc-layer').forEach(x => x.remove());
          addBadge(pi, pg.rec);
        }
      } catch (e) { console.warn('v21ev badge', e); }
      return r;
    };
  }
  if (typeof v7OverlayHook === 'function') {
    const _ov = v7OverlayHook;
    v7OverlayHook = function (pi) {
      const r = _ov.apply(this, arguments);
      try {
        const n = curNote(); if (!n || pi !== 0 || sealed(n)) return r;
        const pg = n.pages[0], el = pageEls[0]; if (!el || !pg || recPage(pg) || (pg.rec && recHas(pg.rec))) return r;
        el.ov.querySelectorAll('.ev-badge-layer').forEach(x => x.remove());
        const other = n.pages.find(p => p.rec && recHas(p.rec) && !live(p.rec));
        if (other) addBadge(0, other.rec);
      } catch (e) { console.warn('v21ev badge0', e); }
      return r;
    };
  }
  const PG = document.getElementById('pages');
  if (PG) {
    PG.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.ev-recbadge')) e.stopPropagation(); }, true);
    PG.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.ev-recbadge'); if (!b) return; e.stopPropagation(); e.preventDefault(); openArchive(b.dataset.evrec); }, true);
  }

  /* ---------------- 3. the 📁 Recordings sheet ---------------- */
  let tick = null;
  function closeArchive() { const w = document.getElementById('evArchWrap'); if (w) w.hidden = true; clearInterval(tick); tick = null; }
  function nbName(n) { const nb = S.notebooks.find(b => b.id === n.notebookId); return nb ? nb.name : 'Notes'; }
  function itemHTML(it, focus) {
    const { n, pi, rec } = it, P = typeof R !== 'undefined' && R.player && R.player.recId === rec.id ? R.player : null;
    const date = new Date(rec.startedAt || rec.createdAt || n.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const brief = typeof briefPagesOf === 'function' && briefPagesOf(n, rec.id).length;
    const busy = typeof R !== 'undefined' && R.busy && R.busy.get(rec.id);
    const hasAudio = !!(rec.segs && rec.segs.length);
    return `<div class="ev-item ${focus ? 'focus' : ''}" data-rec="${escH(rec.id)}">
      <div class="ev-meta"><b class="ev-t">${escH(n.title || 'Meeting')}</b>
        <span class="ev-s">${escH(date)} · ${fmt(rec.dur)}${hasAudio ? '' : ' · audio deleted'}${rec.transcript ? ' · transcript' : ''}</span>
        <span class="ev-s">📓 ${escH(nbName(n))} · page ${pi + 1}${live(rec) ? ' · <b class="ev-live">● recording now</b>' : ''}</span></div>
      <div class="ev-acts">
        ${hasAudio ? `<button type="button" data-ev="${P && P.playing ? 'pause' : 'play'}" class="pri">${P && P.playing ? '⏸ Pause' : '▶ Play'}</button>` : ''}
        <button type="button" data-ev="page">↗ Open page</button>
        ${busy ? `<span class="ev-busy">⏳ ${escH(busy)}</span>` : brief ? '<button type="button" data-ev="brief">📋 Brief</button>' : `<button type="button" data-ev="analyze">✨ Summarize</button>`}
        <button type="button" data-ev="more" aria-label="More for this recording">⋯</button>
        <button type="button" data-ev="del" class="danger" aria-label="Delete recording">🗑</button>
      </div>
      ${P ? `<div class="ev-pos">${fmt(P.pos)} / ${fmt(rec.dur)}</div>` : ''}</div>`;
  }
  function renderArchive(focusId) {
    const w = document.getElementById('evArchWrap'); if (!w || w.hidden) return;
    const list = recordings(), lc = lockedCount();
    const body = w.querySelector('.ev-list');
    body.innerHTML = list.length ? list.map(it => itemHTML(it, it.rec.id === focusId)).join('')
      : '<p class="ev-empty">No recordings yet. Start one from ⋯ → 🎙 Record a meeting. When you stop, the recording files here and your handwritten page stays in its notebook.</p>';
    w.querySelector('.ev-lock').textContent = lc ? `🔒 ${lc} locked note${lc === 1 ? '' : 's'} not shown — open with your code to see recordings inside.` : '';
    w.querySelector('.ev-count').textContent = list.length ? `${list.length} recording${list.length === 1 ? '' : 's'}` : '';
  }
  function openArchive(focusId) {
    const w = modalWrap('evArchWrap');
    w.innerHTML = `<div class="sheet ev-sheet" role="dialog" aria-modal="true" aria-label="Recordings">
      <div class="ev-head"><h3>📁 Recordings <small class="ev-count"></small></h3><button type="button" class="ev-x" data-ev="close" aria-label="Close">✕</button></div>
      <p class="fine">Recordings file here when you stop. Your handwritten meeting pages stay in their notebooks — tap ↗ Open page to go to one.</p>
      <div class="ev-list"></div><p class="fine ev-lock"></p></div>`;
    w.hidden = false;
    w.onclick = e => {
      if (e.target === w) return closeArchive();
      const b = e.target.closest('[data-ev]'); if (!b) return;
      const a = b.dataset.ev; if (a === 'close') return closeArchive();
      const id = b.closest('[data-rec]') && b.closest('[data-rec]').dataset.rec, f = id && findRec(id); if (!f) return;
      if (a === 'play') playAt(id, R.player && R.player.recId === id && R.player.pos < f.rec.dur - 300 ? R.player.pos : 0);
      else if (a === 'pause') pausePlay(id);
      else if (a === 'page') { closeArchive(); goPage(f); }
      else if (a === 'brief') { closeArchive(); gotoBrief(id); }
      else if (a === 'analyze') { analyzeRec(id); }
      else if (a === 'more') actionSheet(f.n.title || 'Recording', [
        { label: '⏺ Continue this recording', sub: 'Opens the page and keeps recording', fn: () => { closeArchive(); goPage(f); setTimeout(() => recStart(f.pi), 250); } },
        { label: '✍︎ Tap ink to replay', sub: 'Open the page, then tap writing to hear that moment', fn: () => { closeArchive(); goPage(f); setTimeout(() => setReplay(true), 250); } },
        ...(f.rec.transcript ? [{ label: '✏️ Rename speakers…', fn: () => speakerList(id) }, { label: '↻ Redo transcript & brief', fn: () => analyzeRec(id) }] : []),
        ...(f.rec.segs.length ? [{ label: '⬇︎ Save audio file' + (f.rec.segs.length > 1 ? 's' : ''), fn: () => saveAudio(id) }] : []),
        { label: '⚙︎ Recording & transcription settings…', fn: recSettings }]);
      else if (a === 'del') deleteRecording(id);
      setTimeout(() => renderArchive(id), 60);
    };
    renderArchive(focusId);
    clearInterval(tick); tick = setInterval(() => { if (w.hidden) { clearInterval(tick); tick = null; return; } const P = R.player; if (P) w.querySelectorAll(`.ev-item[data-rec="${P.recId}"] .ev-pos`).forEach(x => { const f = findRec(P.recId); if (f) x.textContent = fmt(P.pos) + ' / ' + fmt(f.rec.dur); }); }, 400);
    if (focusId) requestAnimationFrame(() => { const el = w.querySelector(`.ev-item[data-rec="${focusId}"]`); if (el) el.scrollIntoView({ block: 'center' }); });
    return w;
  }
  function goPage(f) {
    try { if (typeof setSidebar === 'function' && typeof isDrawer === 'function' && isDrawer()) setSidebar(false); } catch (_) {}
    const go = () => { const el = pageEls[f.pi]; if (el) el.el.scrollIntoView({ block: 'start' }); };
    if (S.cur !== f.n.id) { const r = openNote(f.n.id); if (r && r.then) r.then(() => requestAnimationFrame(go)); else requestAnimationFrame(go); } else go();
  }

  const pendingDel = new Map();
  async function deleteRecording(id) {
    const f = findRec(id); if (!f) return false;
    if (live(f.rec)) { toast('Stop the recording first'); return false; }
    const ok = window.V21es && V21es.confirmBox
      ? await V21es.confirmBox('Delete this recording?', `The audio, captions and transcript are removed. Your handwritten page “${f.n.title || 'Meeting'}” stays in its notebook with all its writing.`, 'Delete recording')
      : confirm('Delete this recording? Your handwritten page stays.');
    if (!ok) return false;
    return deleteNow(id);
  }
  function deleteNow(id) {
    const f = findRec(id); if (!f) return false;
    if (R.player && R.player.recId === id) stopPlayer();
    const n = f.n, pageId = f.pg.id, removed = f.pg.rec, assets = (removed.segs || []).map(g => g.asset);
    if (f.pg.bg && f.pg.bg.name === 'meeting' && typeof newRec === 'function') f.pg.rec = newRec(); else delete f.pg.rec;   // meeting pages always carry an empty recorder
    saveNote(n, true);
    if (n.id === S.cur) { try { renderOverlay(f.pi); } catch (_) {} try { if (pageEls[0]) v7OverlayHook(0); } catch (_) {} }
    try { renderSidebar(); } catch (_) {}
    const t = setTimeout(() => {
      pendingDel.delete(id);
      const used = aid => S.notes.some(x => (x.pages || []).some(pg => (pg.rec && (pg.rec.segs || []).some(g => g.asset === aid)) || (typeof pageAssetIds === 'function' && pageAssetIds(pg).includes(aid))));
      for (const aid of assets) if (!used(aid)) DB.del('assets', aid).catch(() => {});
    }, 9000);
    pendingDel.set(id, t);
    const undo = () => {
      clearTimeout(pendingDel.get(id)); pendingDel.delete(id);
      const m = S.notes.find(x => x.id === n.id), pg = m && m.pages.find(p => p.id === pageId);
      if (!pg) { toast('That page is gone — can’t restore the recording'); return; }
      pg.rec = removed; saveNote(m, true);
      if (m.id === S.cur) { const pi = m.pages.indexOf(pg); try { renderOverlay(pi); } catch (_) {} }
      renderArchive(id); try { renderSidebar(); } catch (_) {}
    };
    if (typeof actionToast === 'function') actionToast('Recording deleted — your page is untouched', 'Undo', undo, 8000);
    else toast('Recording deleted — your page is untouched');
    renderArchive();
    return true;
  }

  /* ---------------- 5. clean-up: one way to record, one place for recordings ---------------- */
  // ⋯ → Record a meeting (the only entry). Records on the page you're on; the page is never moved.
  if (typeof recButton === 'function') {
    recButton = function () {
      if (R.active) { gotoRec(); return; }
      const n = curNote(); if (!n) { toast('Open or create a note first'); return; }
      if (recNoteLocked(n)) { toast('Unlock the note first'); return; }
      const pi = typeof currentPageIndex === 'function' ? currentPageIndex() : 0, pg = n.pages[pi];
      const canHere = pg && !pg.board && !(typeof isAssistPage === 'function' && isAssistPage(pg));
      const startHere = () => { if (!pg.rec) { pushHistory(); pg.rec = newRec(); saveNote(n, true); renderOverlay(pi); } recStart(pi); };
      const newPageAtEnd = () => { pushHistory(); const p = makeTemplatePage('recording', n); n.pages.push(p); saveNote(n, true); buildPages(); renderAll(); const i = n.pages.length - 1; requestAnimationFrame(() => { pageEls[i] && pageEls[i].el.scrollIntoView({ block: 'start' }); recStart(i); }); };
      const has = pg && pg.rec && recHas(pg.rec);
      actionSheet('🎙 Record a meeting', [
        canHere ? { label: has ? '⏺ Continue recording' : '⏺ Start recording', sub: 'Your page stays where it is — the recording files into 📁 Recordings when you stop', primary: true, fn: startHere }
                : { label: '⏺ Start recording', sub: 'Adds a recording page at the end of this note', primary: true, fn: newPageAtEnd },
        { label: '📁 Recordings', sub: 'Play, summarize or delete past recordings', fn: () => openArchive() },
        { label: '⚙︎ Recording & transcription settings…', fn: recSettings }]);
    };
    const rb = document.getElementById('recBtn'); if (rb) rb.onclick = () => recButton();
  }
  // Insert → Recording was a second way in; ⋯ → Record a meeting is the one place.
  try { if (typeof INSERT_ITEMS !== 'undefined') { const i = INSERT_ITEMS.findIndex(x => x.id === 'insRec'); if (i >= 0) INSERT_ITEMS.splice(i, 1); } } catch (_) {}
  const dropIns = () => { const b = document.getElementById('insRec'); if (b) b.remove(); };
  // menus: rewrite record copy, point Archive at the sheet, drop "Move to → 📁 Archive"
  if (typeof moreItems === 'function') {
    const _mi = moreItems;
    moreItems = function () {
      return _mi.apply(this, arguments).map(sec => ({ ...sec, rows: (sec.rows || []).map(r => {
        if (r.l === 'Record a meeting') return { ...r, ic: '🎙', s: R.active ? 'Recording now — tap to go to it' : 'Your page stays put · the recording files into 📁 Recordings', fn: () => recButton() };
        if (r.l === 'Archive') return { ...r, l: 'Recordings', s: 'Every meeting recording in one place', fn: () => openArchive() };
        return r;
      }) }));
    };
  }
  if (typeof settingsSections === 'function') {
    const _ss = settingsSections;
    settingsSections = function () {
      return _ss.apply(this, arguments).map(sec => sec.id !== 'recording' ? sec : ({ ...sec, rows: (sec.rows || []).map(r => /Archive recordings/.test(r.label || '')
        ? { label: '📁 Recordings', sub: 'Every recording in one place — your handwritten pages stay in their notebooks', fn: () => { try { closeSettings(); } catch (_) {} openArchive(); } } : r) }));
    };
  }
  if (typeof actionSheet === 'function') {
    const _as = actionSheet;
    actionSheet = function (title, actions) {
      if (/^Move to/.test(title || '')) actions = (actions || []).filter(a => !/📁|\(recordings\)|^Archive$/.test(a.label || ''));
      return _as.call(this, title, actions);
    };
  }
  // sidebar: the Archive folder becomes one "📁 Recordings" row (no notes live there any more)
  if (typeof renderSidebar === 'function') {
    const _rs = renderSidebar;
    renderSidebar = function () {
      if (!migrating && S.notes.some(n => n.notebookId === ARCH && !SYS.includes(n.id)) && window.__ready) migrate();
      const r = _rs.apply(this, arguments);
      try {
        const box = document.getElementById('notebookList'); if (!box || (typeof drag !== 'undefined' && drag)) return r;
        box.querySelectorAll('.nb-archive').forEach(el => { const prev = el.previousElementSibling; if (prev && prev.classList.contains('side-label') && prev.classList.contains('soft')) prev.remove(); el.remove(); });
        box.querySelectorAll('#evRecRow, .side-label.ev-rec').forEach(el => el.remove());
        const k = recordings().length;
        const lab = document.createElement('div'); lab.className = 'side-label soft ev-rec'; lab.textContent = 'Recordings';
        const row = document.createElement('div'); row.className = 'today-row ev-rec-row'; row.id = 'evRecRow'; row.setAttribute('role', 'button'); row.setAttribute('aria-label', 'Recordings');
        row.innerHTML = `📁 <span class="name">Recordings</span><span class="cnt ${k ? 'on' : ''}">${k || ''}</span>`;
        row.onclick = e => { e.stopPropagation(); openArchive(); };
        box.append(lab, row);
      } catch (e) { console.warn('v21ev sidebar', e); }
      return r;
    };
  }
  // the floating bar while recording: say so in words, not only a red dot
  if (typeof syncMini === 'function') {
    const _sm = syncMini;
    syncMini = function () {
      const r = _sm.apply(this, arguments);
      const m = document.getElementById('recMini');
      if (m && !m.hidden && R.active) { const g = m.querySelector('.rc-mgo'); if (g && !g.querySelector('.ev-rl')) g.insertAdjacentHTML('afterbegin', `<span class="ev-rl">${R.active.paused ? 'Paused' : 'REC'}</span>`); m.setAttribute('aria-label', R.active.paused ? 'Recording paused' : 'Recording'); }
      return r;
    };
  }
  // import: anything restored from an old backup into Archive is put back too
  const imp = document.getElementById('importFile');
  if (imp) imp.addEventListener('change', () => setTimeout(() => { if (migrate()) { renderSidebar(); toast('Meeting pages from the old Archive are back in their notebooks'); } }, 1500));

  const whenReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 60); setTimeout(() => clearInterval(t), 15000); };
  whenReady(() => {
    try {
      dropIns();
      const k = migrate();
      for (const it of recordings()) if (fileRecording(it.rec)) DB.put('notes', it.n).catch(() => {});
      renderSidebar();
      const n = curNote(); if (n) n.pages.forEach((pg, i) => { try { if (pg.rec) renderRecPanel(i); else if (i === 0) v7OverlayHook(0); } catch (_) {} });
      if (k) toast(`📓 ${k} meeting page${k === 1 ? '' : 's'} back in ${k === 1 ? 'its notebook' : 'their notebooks'} — recordings are in 📁 Recordings`, 4200);
    } catch (e) { console.warn('v21ev boot', e); }
  });

  window.V21ev = { version: VERSION, VERSION, recordings, openArchive, closeArchive, renderArchive, deleteRecording, deleteNow, migrate, fileRecording, recHas, RESTORED };
})();
