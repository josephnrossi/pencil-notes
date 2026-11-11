/* Pencil Notes v21ey — meeting transcript archive, remove lasso Calculate, red-team cleanup.
   Joseph: when a meeting is recorded, auto-archive the recording as a TRANSCRIPT in the current
   formatting (📁 Recordings), and keep the handwritten meeting template in its notebook.
   Remove the lasso → 🧮 Calculate feature (too cumbersome). Then audit the app for redundant areas.
   Mock only. Loads after v21ex. Never deletes IndexedDB data. Never publishes. */
(function () {
  'use strict';
  const VERSION = 'v21ey';
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const fmt = ms => (typeof mmss === 'function' ? mmss(ms) : Math.round((ms || 0) / 1000) + 's');
  const escH = s => (typeof esc === 'function' ? esc(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const recHas = r => !!(r && ((r.segs && r.segs.length) || (r.transcript && r.transcript.segs && r.transcript.segs.length) || (r.live && r.live.length)));
  const hasTr = r => !!(r && r.transcript && r.transcript.segs && r.transcript.segs.length);
  const live = r => !!(r && typeof R !== 'undefined' && R.active && R.active.recId === r.id);
  const busyOf = id => typeof R !== 'undefined' && R.busy && R.busy.get(id);
  const errOf = id => typeof R !== 'undefined' && R.lastErr && R.lastErr.get(id);

  /* ---------------- briefPack: copy cards off any leftover Meeting Brief page (do not delete the page) ---------------- */
  function packFromPage(n, rec) {
    if (!n || !rec || (rec.briefPack && rec.briefPack.cards && rec.briefPack.cards.length)) return false;
    const pages = typeof briefPagesOf === 'function' ? briefPagesOf(n, rec.id) : [];
    if (!pages.length) return false;
    const [pg] = pages[0], B = pg.assist && pg.assist.brief || {};
    rec.briefPack = { rec: rec.id, title: B.title || n.title, engine: B.engine || (rec.brief && rec.brief.engine) || '', warn: B.warn || '', at: B.at || Date.now(), unified: true, tab: 'transcript', filterSp: '', cards: (pg.assist.cards || []).map(c => Object.assign({}, c)) };
    return true;
  }
  function ensurePack(rec, n) {
    if (rec && rec.briefPack && rec.briefPack.cards) return rec.briefPack;
    if (n && rec) packFromPage(n, rec);
    if (rec && !rec.briefPack) rec.briefPack = { rec: rec.id, title: (n && n.title) || 'Meeting', engine: (rec.transcript && rec.transcript.engine) || '', warn: '', at: Date.now(), unified: true, tab: 'transcript', filterSp: '', cards: [] };
    return rec.briefPack;
  }
  function packPage(rec, n) {
    const B = ensurePack(rec, n);
    return { assist: { brief: B, cards: B.cards || [] } };
  }

  /* ---------------- 📝 Transcript viewer in 📁 Recordings (same Brief/Transcript formatting) ---------------- */
  let trTick = null;
  function closeTranscript() {
    const w = document.getElementById('eyTrWrap'); if (w) w.hidden = true;
    clearInterval(trTick); trTick = null;
  }
  function renderTranscript(recId) {
    const w = document.getElementById('eyTrWrap'); if (!w || w.hidden) return;
    const f = typeof findRec === 'function' && findRec(recId); if (!f) { closeTranscript(); return; }
    const rec = f.rec, n = f.n, B = ensurePack(rec, n), tab = (typeof briefNormTab === 'function' ? briefNormTab(B.tab) : (B.tab || 'transcript'));
    if (B.tab !== tab) B.tab = tab;
    const P = typeof R !== 'undefined' && R.player && R.player.recId === rec.id ? R.player : null;
    const when = new Date(rec.startedAt || rec.createdAt || n.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const nb = (S.notebooks.find(b => b.id === n.notebookId) || {}).name || 'Notes';
    const fake = packPage(rec, n);
    const body = tab === 'brief' && typeof briefHomeHTML === 'function'
      ? (() => { /* reuse section blocks only: render via briefHomeHTML then strip the page chrome */ return null; })()
      : null;
    const trHTML = hasTr(rec) && typeof briefTranscriptHTML === 'function'
      ? briefTranscriptHTML(rec, B, typeof briefCardsBy === 'function' ? briefCardsBy(fake) : {}, { focus: true })
      : `<p class="mb-empty ey-pending">${errOf(rec.id) ? '⚠︎ ' + escH(errOf(rec.id)) + ' — the audio is safe. Tap ↻ Retry to try again.'
        : busyOf(rec.id) ? '⏳ ' + escH(busyOf(rec.id))
        : 'No transcript yet. Tap ✨ Transcribe to build one from the audio (or live captions). The recording is already saved.'}</p>`;
    const briefHTML = briefBodyHTML(fake, rec, B);
    w.innerHTML = `<div class="sheet ev-sheet ey-tr-sheet" role="dialog" aria-modal="true" aria-label="Transcript">
      <div class="mb-home doc ey-tr-home">
        <header class="mb-home-head mb-head sticky">
          <div class="mb-head-row">
            <div class="mb-title-stack">
              <div class="mb-t2">${escH(B.title || n.title || 'Meeting')}</div>
              <div class="mb-meta">${escH(when)} · ${fmt(rec.dur)} · 📓 ${escH(nb)}${rec.transcript ? ' · ' + escH(rec.transcript.engine) : ''}${B.warn ? ' · ⚠︎' : ''}</div>
            </div>
            <div class="mb-tools ey-tr-tools">
              ${rec.segs && rec.segs.length ? `<button type="button" class="mb-ico ey-44" data-ey="${P && P.playing ? 'pause' : 'play'}" aria-label="${P && P.playing ? 'Pause' : 'Play'}">${P && P.playing ? '⏸' : '▶'}</button>` : ''}
              <button type="button" class="mb-ico ey-44" data-ey="page" title="Open the handwritten meeting page" aria-label="Open page">📄</button>
              <button type="button" class="mb-ico ey-44" data-ey="close" aria-label="Close">✕</button>
            </div>
          </div>
          ${P ? `<div class="ey-pos">${fmt(P.pos)} / ${fmt(rec.dur)}</div>` : ''}
          <nav class="mb-modes" aria-label="Meeting mode">
            <button type="button" class="mb-mode ${tab === 'brief' ? 'on' : ''}" data-ey="tab" data-tab="brief">Brief</button>
            <button type="button" class="mb-mode ${tab !== 'brief' ? 'on' : ''}" data-ey="tab" data-tab="transcript">Transcript${hasTr(rec) ? `<span class="mb-tab-n">${rec.transcript.segs.length}</span>` : ''}</button>
          </nav>
        </header>
        <div class="mb-home-body ey-tr-body" data-rec="${escH(rec.id)}">
          <div class="mb-brief" ${tab === 'brief' ? '' : 'hidden'}>${briefHTML}</div>
          <div class="mb-tr-focus" ${tab !== 'brief' ? '' : 'hidden'}>${trHTML}</div>
        </div>
      </div>
    </div>`;
  }
  function briefBodyHTML(pg, rec, B) {
    const C = typeof briefCardsBy === 'function' ? briefCardsBy(pg) : {};
    const ov = C.overview, decisions = (C.decisions && C.decisions.decisions) || [];
    const allActs = (C.actions && C.actions.actions) || [];
    const sumText = (ov && ov.summary) || '';
    const points = (ov && ov.points) || [];
    if (!sumText && !points.length && !decisions.length && !allActs.length && !(C.people || []).length) {
      return `<p class="mb-empty">${hasTr(rec) ? 'Transcript is ready. A short brief is included when transcription finishes — open the Transcript tab to read it.' : 'Transcribe the recording to fill the brief.'}</p>`;
    }
    const blocks = [];
    if (sumText || points.length) {
      blocks.push(`<section class="mb-block"><div class="mb-label">Overview</div>
        ${sumText ? `<p class="mb-sum">${escH(sumText)}</p>` : ''}
        ${points.length ? `<ul class="mb-keys">${points.slice(0, 8).map(x => `<li>${escH(x)}</li>`).join('')}</ul>` : ''}
        ${ov && ov.builtin ? '<p class="mb-note">⚙︎ Built-in summary of the transcript.</p>' : ''}</section>`);
    }
    if (decisions.length) {
      blocks.push(`<section class="mb-block"><div class="mb-label">Decisions</div>${decisions.map(d =>
        `<div class="mb-row dec"><span class="mb-ic">✓</span><span class="mb-row-t">${escH(d.text)}</span><span class="mb-own">${d.by ? escH(d.by) : ''}</span></div>`).join('')}</section>`);
    }
    if (allActs.length) {
      const open = allActs.filter(a => !a.done), done = allActs.filter(a => a.done);
      blocks.push(`<section class="mb-block"><div class="mb-label">Actions</div>
        ${open.length ? `<ul class="mb-keys">${open.map(a => `<li>${escH(a.text)}${a.owner ? ' — ' + escH(a.owner) : ''}</li>`).join('')}</ul>` : '<p class="mb-empty">No open actions.</p>'}
        ${done.length ? `<p class="fine">Done (${done.length})</p>` : ''}</section>`);
    }
    if ((C.people || []).length) {
      blocks.push(`<section class="mb-block"><div class="mb-label">People</div><ul class="mb-keys">${C.people.map(c => {
        const p = c.person || {}; return `<li>${escH(p.name || 'Speaker')}${p.role ? ' · ' + escH(p.role) : ''}</li>`;
      }).join('')}</ul></section>`);
    }
    return blocks.join('') || '<p class="mb-empty">Nothing in this brief yet.</p>';
  }
  function openTranscript(recId, tab) {
    const f = typeof findRec === 'function' && findRec(recId); if (!f) return null;
    ensurePack(f.rec, f.n);
    if (tab) f.rec.briefPack.tab = tab;
    const w = typeof modalWrap === 'function' ? modalWrap('eyTrWrap') : (() => { let el = document.getElementById('eyTrWrap'); if (!el) { el = document.createElement('div'); el.id = 'eyTrWrap'; el.className = 'modal-wrap'; document.body.append(el); } return el; })();
    w.hidden = false;
    w.onclick = e => {
      if (e.target === w) return closeTranscript();
      const b = e.target.closest('[data-ey], [data-mb]'); if (!b) return;
      const a = b.dataset.ey || b.dataset.mb;
      const rec = f.rec;
      if (a === 'close') return closeTranscript();
      if (a === 'play') playAt(recId, R.player && R.player.recId === recId && R.player.pos < rec.dur - 300 ? R.player.pos : 0);
      else if (a === 'pause') pausePlay(recId);
      else if (a === 'seek') playAt(recId, +b.dataset.t);
      else if (a === 'page') {
        closeTranscript();
        try { if (window.V21ev && V21ev.closeArchive) V21ev.closeArchive(); } catch (_) {}
        goHandwritten(f);
      } else if (a === 'tab') { rec.briefPack.tab = b.dataset.tab; try { saveNote(f.n); } catch (_) {} }
      else if (a === 'filter') { rec.briefPack.filterSp = b.dataset.sp || ''; try { saveNote(f.n); } catch (_) {} }
      else if (a === 'spk') { if (typeof renameSpeaker === 'function') renameSpeaker(recId, b.dataset.sp); }
      else if (a === 'copytr') {
        if (!hasTr(rec)) return toast('No transcript');
        const lines = typeof trLines === 'function' ? trLines(rec).join('\n') : rec.transcript.segs.map(s => s.text).join('\n');
        if (typeof copyText === 'function') copyText(lines); else try { navigator.clipboard.writeText(lines); toast('Copied'); } catch (_) {}
      }
      setTimeout(() => renderTranscript(recId), 40);
    };
    w.addEventListener('input', e => {
      const inp = e.target.closest && e.target.closest('input.mb-search[data-mb="trq"]'); if (!inp) return;
      f.rec.briefPack.trQuery = inp.value;
      clearTimeout(w._q); w._q = setTimeout(() => { try { saveNote(f.n); } catch (_) {} renderTranscript(recId); const el = w.querySelector('.mb-search'); if (el) { el.focus(); const v = el.value; el.setSelectionRange(v.length, v.length); } }, 160);
    });
    renderTranscript(recId);
    clearInterval(trTick);
    trTick = setInterval(() => { if (w.hidden) { clearInterval(trTick); trTick = null; return; } if (R.player && R.player.recId === recId) renderTranscript(recId); }, 500);
    return w;
  }
  function goHandwritten(f) {
    const go = () => { const el = pageEls[f.pi]; if (el) el.el.scrollIntoView({ block: 'start' }); };
    if (S.cur !== f.n.id) { const r = openNote(f.n.id); if (r && r.then) r.then(() => requestAnimationFrame(go)); else requestAnimationFrame(go); } else go();
  }

  /* ---------------- Recordings list: Transcript / Transcribe / Retry, errors, never lose audio ---------------- */
  let enhancing = false;
  function enhanceArchiveItems() {
    const w = document.getElementById('evArchWrap'); if (!w || w.hidden || enhancing) return;
    enhancing = true;
    try {
    w.querySelectorAll('.ev-item').forEach(el => {
      const id = el.dataset.rec, f = typeof findRec === 'function' && findRec(id); if (!f) return;
      const rec = f.rec, acts = el.querySelector('.ev-acts'); if (!acts) return;
      const busy = busyOf(id), err = errOf(id);
      const sig = (hasTr(rec) ? 'tr' : 'no') + '|' + (busy ? 'b' : '') + '|' + (err ? 'e' : '');
      if (el.dataset.ey === sig) return;
      el.dataset.ey = sig;
      acts.querySelectorAll('[data-ev="brief"], [data-ev="analyze"], [data-ev="transcript"], [data-ev="retry"]').forEach(b => b.remove());
      acts.querySelectorAll('.ev-busy').forEach(b => b.remove());
      let btn = null;
      if (busy) {
        const sp = document.createElement('span'); sp.className = 'ev-busy'; sp.textContent = '⏳ ' + busy; acts.insertBefore(sp, acts.querySelector('[data-ev="more"]') || acts.querySelector('[data-ev="del"]'));
      } else if (hasTr(rec)) {
        btn = document.createElement('button'); btn.type = 'button'; btn.dataset.ev = 'transcript'; btn.className = 'pri'; btn.textContent = '📝 Transcript';
      } else {
        btn = document.createElement('button'); btn.type = 'button'; btn.dataset.ev = 'retry'; btn.textContent = err ? '↻ Retry transcript' : '✨ Transcribe';
      }
      if (btn) acts.insertBefore(btn, acts.querySelector('[data-ev="more"]') || acts.querySelector('[data-ev="del"]'));
      el.querySelectorAll('.ey-err').forEach(x => x.remove());
      if (err && !busy) {
        const p = document.createElement('p'); p.className = 'ey-err fine'; p.textContent = '⚠︎ ' + err + ' — the recording is saved. Tap Retry to try again.';
        el.append(p);
      }
      const meta = el.querySelectorAll('.ev-s');
      if (meta[0] && hasTr(rec) && !/transcript/i.test(meta[0].textContent)) meta[0].append(' · transcript');
    });
    } finally { enhancing = false; }
  }
  if (window.V21ev) {
    if (typeof V21ev.renderArchive === 'function') {
      const _ra = V21ev.renderArchive;
      V21ev.renderArchive = function () { const r = _ra.apply(this, arguments); try { enhanceArchiveItems(); } catch (e) { console.warn('v21ey archive', e); } return r; };
    }
    if (typeof V21ev.openArchive === 'function') {
      const _oa = V21ev.openArchive;
      V21ev.openArchive = function () { const r = _oa.apply(this, arguments); setTimeout(() => { try { enhanceArchiveItems(); } catch (_) {} }, 0); return r; };
    }
  }
  if (window.MutationObserver) {
    const hookList = () => {
      const w = document.getElementById('evArchWrap');
      if (!w || w._eyObs) return;
      w._eyObs = new MutationObserver(() => enhanceArchiveItems());
      w._eyObs.observe(w, { childList: true, subtree: true });
    };
    hookList();
    new MutationObserver(hookList).observe(document.body, { childList: true });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#evArchWrap [data-ev]');
    if (!b) return;
    const a = b.dataset.ev;
    if (a !== 'transcript' && a !== 'brief' && a !== 'retry' && a !== 'analyze') return;
    const id = b.closest('[data-rec]') && b.closest('[data-rec]').dataset.rec; if (!id) return;
    if (a === 'transcript' || a === 'brief') {
      e.stopImmediatePropagation(); e.preventDefault();
      openTranscript(id, a === 'brief' ? 'brief' : 'transcript');
    } else if (a === 'retry') {
      e.stopImmediatePropagation(); e.preventDefault();
      if (typeof analyzeRec === 'function') analyzeRec(id);
      setTimeout(() => { try { V21ev.renderArchive(id); } catch (_) {} }, 80);
    }
  }, true);

  if (typeof gotoBrief === 'function') {
    gotoBrief = function (recId) { openTranscript(recId, 'brief'); };
  }

  /* ---------------- badge on the handwritten page: Recording / Transcribing / Transcript / Retry ---------------- */
  function badgeLabel(rec) {
    if (live(rec)) return 'Recording';
    if (busyOf(rec.id)) return 'Transcribing';
    if (hasTr(rec)) return 'Transcript';
    if (errOf(rec.id)) return 'Retry';
    return 'Recording';
  }
  function retitleBadges() {
    const n = typeof curNote === 'function' && curNote(); if (!n) return;
    document.querySelectorAll('#pages .ev-recbadge').forEach(b => {
      const f = findRec(b.dataset.evrec); if (!f) return;
      const lab = badgeLabel(f.rec);
      const dur = b.querySelector('.ev-dur'); const d = dur ? dur.textContent : fmt(f.rec.dur);
      b.innerHTML = `🎙 <b>${lab}</b> · <span class="ev-dur">${d}</span> · <u>Open</u>`;
      b.setAttribute('aria-label', lab + ', ' + d + '. Open in Recordings');
    });
  }
  if (typeof renderRecPanel === 'function') {
    const _rr = renderRecPanel;
    renderRecPanel = function (pi) {
      const r = _rr.apply(this, arguments);
      try { retitleBadges(); } catch (_) {}
      return r;
    };
  }
  const PG = document.getElementById('pages');
  if (PG) {
    PG.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.ev-recbadge'); if (!b) return;
      const f = findRec(b.dataset.evrec);
      if (f && hasTr(f.rec) && !live(f.rec)) {
        e.stopImmediatePropagation(); e.preventDefault();
        openTranscript(b.dataset.evrec);
      }
    }, true);
  }

  /* v21e2 still pops a “Open Brief” banner + late toast after analyze (it used to jump to a Brief page). Rewrite both. */
  if (typeof toast === 'function') {
    const _toast = toast;
    toast = function (msg) {
      const s = String(msg || '');
      if (/📋 Brief ready|📋 Meeting Brief ready|summary card is in the 📥 Inbox/.test(s)) return;
      return _toast.apply(this, arguments);
    };
  }
  function showTranscriptReadyBanner(recId) {
    let ban = document.getElementById('briefReadyBan');
    if (!ban) {
      ban = document.createElement('div'); ban.id = 'briefReadyBan'; ban.setAttribute('role', 'status'); document.body.append(ban);
    }
    if (!ban._ey) {
      ban._ey = true;
      ban.addEventListener('click', e => {
        const b = e.target.closest('[data-br]'); if (!b) return;
        e.stopPropagation();
        if (b.dataset.br === 'open') { ban.hidden = true; openTranscript(ban.dataset.rec); }
        else if (b.dataset.br === 'x') ban.hidden = true;
      }, true);
    }
    ban.dataset.rec = recId || '';
    ban.hidden = false;
    ban.innerHTML = `<span><b>📝 Transcript saved</b> — in 📁 Recordings · your page stays here</span>
      <button class="btn primary" data-br="open">Open transcript</button>
      <button class="btn small" data-br="x" aria-label="Dismiss">✕</button>`;
    const toastEl = document.getElementById('toast'); if (toastEl) toastEl.hidden = true;
    clearTimeout(showTranscriptReadyBanner._t);
    showTranscriptReadyBanner._t = setTimeout(() => { if (ban) ban.hidden = true; }, 8000);
  }
  if (window.MutationObserver) {
    const fixBan = () => {
      const ban = document.getElementById('briefReadyBan');
      if (!ban || ban.hidden) return;
      if (/Open Brief|Meeting Brief ready/.test(ban.textContent || '')) showTranscriptReadyBanner(ban.dataset.rec);
    };
    new MutationObserver(fixBan).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* after analyzeRec finishes, refresh list + badges (audio is never touched) */
  if (typeof analyzeRec === 'function') {
    const _an = analyzeRec;
    analyzeRec = async function (recId) {
      const f0 = findRec(recId);
      const segs = f0 && f0.rec && (f0.rec.segs || []).slice();
      const r = await _an.apply(this, arguments);
      try {
        const f = findRec(recId);
        if (f && segs && segs.length && !(f.rec.segs && f.rec.segs.length)) { f.rec.segs = segs; saveNote(f.n, true); } // never lose audio if a path cleared it
        if (f && recHas(f.rec) && !f.rec.archivedAt) { f.rec.archivedAt = Date.now(); saveNote(f.n); }
        if (window.V21ev && V21ev.renderArchive) V21ev.renderArchive(recId);
        if (f && f.n.id === S.cur) { try { renderRecPanel(f.pi); retitleBadges(); } catch (_) {} }
        const ok = f && hasTr(f.rec);
        setTimeout(() => {
          if (ok) showTranscriptReadyBanner(recId);
          else { const ban = document.getElementById('briefReadyBan'); if (ban) ban.hidden = true; }
        }, 250);
      } catch (e) { console.warn('v21ey analyze', e); }
      return r;
    };
  }

  /* ---------------- 2. Remove lasso → 🧮 Calculate (keep lasso for everything else; keep stored calc data) ---------------- */
  try {
    if (typeof GK_ACTS !== 'undefined') {
      const i = GK_ACTS.findIndex(a => a.id === 'calc'); if (i >= 0) GK_ACTS.splice(i, 1);
    }
  } catch (_) {}
  const pop = document.getElementById('grokPop');
  if (pop && window.MutationObserver) new MutationObserver(() => { pop.querySelectorAll('.gk-act[data-act="calc"]').forEach(b => b.remove()); }).observe(pop, { childList: true, subtree: true });
  function wireLassoMore() {
    const more = document.getElementById('lassoMore'); if (!more) return;
    more.setAttribute('aria-label', 'More: duplicate, paste, label');
    more.onclick = () => {
      if (typeof selection === 'undefined' || !selection) return;
      const m = document.getElementById('lassoMenu'); if (m) m.hidden = true;
      const back = () => { if (selection) { if (m) m.hidden = false; if (typeof positionLassoMenu === 'function') positionLassoMenu(); } };
      const hasClip = typeof clip !== 'undefined' && clip;
      actionSheet('Selection', [
        { label: '⎘ Duplicate', fn: () => { const b = document.getElementById('lassoDup'); if (b) b.click(); } },
        ...(hasClip ? [{ label: '📋 Paste', fn: () => { const b = document.getElementById('lassoPaste'); if (b) b.click(); } }] : []),
        { label: '🏷 Label (make it searchable by name)', fn: () => { const b = document.getElementById('lassoLabel'); if (b) b.click(); } },
        { label: '✕ Deselect', fn: hideLasso }
      ]);
      const w = document.getElementById('actionWrap');
      if (w && window.MutationObserver) { const obs = new MutationObserver(() => { if (w.hidden) { obs.disconnect(); setTimeout(back, 0); } }); obs.observe(w, { attributes: true, attributeFilter: ['hidden'] }); }
    };
  }
  wireLassoMore();
  if (typeof V21eg === 'object' && V21eg) {
    const noop = () => { toast('🧮 Calculate was removed — lasso still selects, moves, makes a card and sends to the Idea Board.'); return null; };
    V21eg.openCalc = noop;
  }
  const calcWrap = document.getElementById('egCalcWrap'); if (calcWrap) { calcWrap.hidden = true; calcWrap.innerHTML = ''; }
  if (typeof actionSheet === 'function') {
    const _as = actionSheet;
    actionSheet = function (title, actions) {
      return _as.call(this, title, (actions || []).filter(a => !/🧮\s*Calculate|^Calculate$/.test(a.label || '')));
    };
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#grokPop [data-act="calc"], #egCalcWrap');
    if (!b) return;
    e.stopPropagation(); e.preventDefault();
    const w = document.getElementById('egCalcWrap'); if (w) w.hidden = true;
  }, true);

  /* ---------------- 3. Red-team clean-up of leftover visible redundancy (data kept) ---------------- */
  // Insert copy still said "recording" after v21ev removed Insert → Recording
  try {
    const ib = document.getElementById('insertBtn');
    if (ib) { ib.title = 'Insert a task, number, quote sheet, daily to-do, photo, page or PDF'; }
    document.querySelectorAll('#insPage small').forEach(e => { if (/planner|board|assistant|recording/i.test(e.textContent)) e.textContent = 'Lined, grid, quote sheet, to-do, meeting…'; });
  } catch (_) {}
  // Gestures / Ask Grok titles that still advertised Calculate
  try {
    const ls = document.getElementById('lassoGrok');
    if (ls && /calculat/i.test(ls.title || '')) ls.title = 'Summarize, convert to text, make tasks, clean up or ask';
  } catch (_) {}
  try {
    if (typeof GESTURES !== 'undefined' && Array.isArray(GESTURES)) {
      const walk = arr => arr.forEach((row, i) => {
        if (Array.isArray(row)) walk(row);
        else if (typeof row === 'string' && /🧮|Calculate/.test(row)) arr[i] = row.replace(/\s*·\s*🧮 Calculate/g, '').replace(/🧮 Calculate\s*·\s*/g, '').replace(/🧮 Calculate/g, '');
      });
      walk(GESTURES);
    }
  } catch (_) {}

  /* ---------------- boot ---------------- */
  const whenReady = fn => { if (window.__ready) return fn(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); fn(); } }, 60); setTimeout(() => clearInterval(t), 15000); };
  whenReady(() => {
    try {
      wireLassoMore();
      let k = 0;
      for (const n of S.notes || []) {
        if (sealed(n)) continue;
        for (const pg of n.pages || []) if (pg.rec && recHas(pg.rec)) {
          if (packFromPage(n, pg.rec)) { DB.put('notes', n).catch(() => {}); k++; }
        }
      }
      const n = typeof curNote === 'function' && curNote();
      if (n) n.pages.forEach((pg, i) => { try { if (pg.rec) renderRecPanel(i); } catch (_) {} });
      retitleBadges();
      if (typeof renderSidebar === 'function') renderSidebar();
    } catch (e) { console.warn('v21ey boot', e); }
  });

  window.V21ey = { version: VERSION, VERSION, openTranscript, closeTranscript, renderTranscript, ensurePack, packFromPage, hasTr, badgeLabel, enhanceArchiveItems };
})();
