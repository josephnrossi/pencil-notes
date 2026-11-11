/* Pencil Notes v21fa — colored notebook icons, page icons for notes, and a smoothness pass on notebooks & notes.
   1. Every notebook gets a bound-notebook icon in its own color (12-color palette, light + dark variants).
      The color is stored on the notebook record as nb.color (a palette key) — additive only. Existing notebooks
      get a deterministic default (oldest first, least-used color) the first time v21fa runs. ⋯ → 🎨 Notebook color… changes it.
   2. Every note gets a page icon (sheet with folded corner) tinted to its notebook, with a small mark for its kind
      (lined / grid / blank / meeting / quote / planner / board / recording). Shown in the sidebar, search results,
      Move-to pickers and 📁 Recordings.
   3. Smoothness (see AUDIT-v21fa.md): typing a title no longer rebuilds the whole sidebar per keystroke, search is
      coalesced while typing, deleting the open note opens its neighbour in the same notebook, the last visible
      notebook can't be deleted (the hidden Archive record no longer counts), search hides notebooks with no
      matches, the open note is scrolled into view when the sidebar opens, duplicate quote hits in V21ee.search are
      removed, and empty notebooks say how to add a note.
   Never deletes or clears IndexedDB data. */
(() => {
  const VERSION = 'v21fa';
  const ARCH = 'archive';
  const SYS = ['quoteboard', 'ideaboard', 'inbox'];
  const PALETTE = [
    { key: 'blue', name: 'Blue', light: '#3E63DD', dark: '#7B93F5' },
    { key: 'orange', name: 'Orange', light: '#E8590C', dark: '#FF8F4D' },
    { key: 'green', name: 'Green', light: '#2B9A5B', dark: '#4CC38A' },
    { key: 'purple', name: 'Purple', light: '#8E4EC6', dark: '#B98AEE' },
    { key: 'red', name: 'Red', light: '#DC3E42', dark: '#FF6B6F' },
    { key: 'teal', name: 'Teal', light: '#0F9488', dark: '#2EC8B4' },
    { key: 'pink', name: 'Pink', light: '#D23F95', dark: '#F27BC4' },
    { key: 'amber', name: 'Amber', light: '#C98A00', dark: '#F5C542' },
    { key: 'indigo', name: 'Indigo', light: '#4F46C8', dark: '#9A94F7' },
    { key: 'cyan', name: 'Cyan', light: '#0784A8', dark: '#3CC6EA' },
    { key: 'brown', name: 'Brown', light: '#9A6B47', dark: '#CFA27E' },
    { key: 'slate', name: 'Slate', light: '#5B6B82', dark: '#A3B1C6' },
  ];
  const KEYS = PALETTE.map(c => c.key);
  const byKey = k => PALETTE.find(c => c.key === k) || null;
  const isDarkNow = () => document.documentElement.dataset.theme === 'dark';
  const hexOf = k => { const c = byKey(k) || PALETTE[0]; return isDarkNow() ? c.dark : c.light; };
  const escA = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- colors: deterministic defaults, additive field ---------------- */
  const userNbs = () => (S.notebooks || []).filter(b => b && b.id !== ARCH);
  function defaultColorFor(nb, taken) {
    const use = {}; KEYS.forEach(k => use[k] = 0);
    for (const k of taken) if (k in use) use[k]++;
    let best = KEYS[0]; for (const k of KEYS) if (use[k] < use[best]) best = k;
    return best;
  }
  function ensureColors() {
    const list = userNbs().slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
    const taken = list.filter(b => KEYS.includes(b.color)).map(b => b.color);
    let changed = 0;
    for (const nb of list) {
      if (KEYS.includes(nb.color)) continue;
      nb.color = defaultColorFor(nb, taken); taken.push(nb.color); changed++;
      try { saveNotebook(nb); } catch (e) { console.warn('v21fa color save', e); }   // DB.put of the same record + one new field
    }
    return changed;
  }
  const colorOf = nb => (nb && KEYS.includes(nb.color)) ? nb.color : 'slate';
  function setColor(nb, key) {
    if (!nb || !KEYS.includes(key)) return false;
    nb.color = key; saveNotebook(nb); renderSidebar(); return true;
  }

  /* ---------------- icons ---------------- */
  const lockBadge = '<g class="fa-lockb"><circle cx="18.6" cy="18.6" r="5.2" fill="var(--surface,#fff)"/><rect x="15.9" y="17.6" width="5.4" height="4.2" rx="1" fill="currentColor"/><path d="M16.9 17.7v-1.3a1.7 1.7 0 0 1 3.4 0v1.3" fill="none" stroke="currentColor" stroke-width="1.2"/></g>';
  function nbIcon(key, { locked = false, size = 26 } = {}) {
    return `<svg class="fa-nbsvg fa-c-${key}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">
      <rect x="4.5" y="2.5" width="15" height="19" rx="2.6" fill="var(--nbc)"/>
      <rect x="4.5" y="2.5" width="4" height="19" rx="1.6" fill="#000" opacity=".2"/>
      <g fill="none" stroke="var(--nbring)" stroke-width="1.3" stroke-linecap="round"><path d="M3 6.5h3M3 10h3M3 13.5h3M3 17h3"/></g>
      <rect x="10.6" y="6" width="6.4" height="3.2" rx=".9" fill="#fff" opacity=".88"/>
      ${locked ? lockBadge : ''}</svg>`;
  }
  function noteKind(n) {
    if (!n) return 'lined';
    if (n.lock && typeof isSealed === 'function' && isSealed(n)) return 'locked';
    const pgs = n.pages || [];
    if (pgs.some(pg => pg && pg.rec && ((pg.rec.segs && pg.rec.segs.length) || pg.rec.transcript))) return 'rec';
    const bg = pgs[0] && pgs[0].bg && pgs[0].bg.name;
    if (pgs.some(pg => pg && pg.qsheet)) return 'quote';
    if (bg === 'meeting') return 'meeting';
    if (bg === 'planner') return 'planner';
    if (pgs.some(pg => pg && pg.board)) return 'board';
    if (n.paper === 'grid') return 'grid';
    if (n.paper === 'blank') return 'blank';
    return 'lined';
  }
  const MARKS = {
    lined: '<path d="M8 11.5h8M8 14.5h8M8 17.5h5.5"/>',
    grid: '<path d="M8 11h8M8 14h8M8 17h8M10.7 9v10M13.3 9v10"/>',
    blank: '',
    meeting: '<circle cx="10" cy="12" r="1.6"/><path d="M7.6 16.6c.4-1.6 1.3-2.3 2.4-2.3s2 .7 2.4 2.3M13.6 12.2h3M13.6 15h3"/>',
    quote: '<path d="M12 9.6v9M14.3 11.4c-.4-.8-1.2-1.2-2.3-1.2-1.3 0-2.2.7-2.2 1.6 0 2.2 4.6 1.2 4.6 3.6 0 1-.9 1.7-2.4 1.7-1.2 0-2.1-.5-2.5-1.3"/>',
    planner: '<path d="M8 10.5h8v8H8zM8 13h8M10.8 9.3v2.2M13.2 9.3v2.2"/>',
    board: '<path d="M7.8 10.5h2.6v7H7.8zM11.7 10.5h2.6v4.4h-2.6zM15.6 10.5h1v5.6"/>',
    rec: '<rect x="10.7" y="9.6" width="2.6" height="5.2" rx="1.3"/><path d="M9.3 13.2a2.7 2.7 0 0 0 5.4 0M12 16v2"/>',
    locked: '<rect x="9.2" y="13" width="5.6" height="4.4" rx="1"/><path d="M10.3 13v-1.4a1.7 1.7 0 0 1 3.4 0V13"/>',
  };
  function pageIcon(key, kind, size = 24) {
    return `<svg class="fa-pgsvg fa-c-${key}" data-kind="${kind}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">
      <path d="M6 2.8h8.4l4.6 4.6v12.6a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V4.4A1.6 1.6 0 0 1 6 2.8z" fill="var(--pgfill)" stroke="var(--nbc)" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M14.4 2.8v3.4c0 .7.5 1.2 1.2 1.2H19" fill="var(--pgfold)" stroke="var(--nbc)" stroke-width="1.4" stroke-linejoin="round"/>
      <g fill="none" stroke="var(--nbc)" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${MARKS[kind] || ''}</g></svg>`;
  }
  const nbById = id => (S.notebooks || []).find(b => b.id === id);
  const nbOpenSet = () => (window.V21ej && V21ej.nbOpen) || new Set();
  const nbLocked = nb => !!(nb && nb.codeLock && !nbOpenSet().has(nb.id));
  function iconForNote(n) {
    const nb = n && nbById(n.notebookId);
    const kind = nbLocked(nb) ? 'locked' : noteKind(n);
    return pageIcon(colorOf(nb), kind);
  }

  /* ---------------- sidebar decoration (runs after the full wrapper chain) ---------------- */
  function decorate() {
    const box = document.getElementById('notebookList'); if (!box) return;
    const q = (S.search || '').trim().toLowerCase();
    box.querySelectorAll('.nb[data-nbid]').forEach(el => {
      const nb = nbById(el.dataset.nbid); if (!nb) return;
      const key = colorOf(nb), locked = nbLocked(nb);
      KEYS.forEach(k => el.classList.remove('fa-c-' + k)); el.classList.add('fa-nb', 'fa-c-' + key);
      const head = el.querySelector('.nb-head');
      if (head && !head.querySelector('.fa-nbi')) {
        const s = document.createElement('span'); s.className = 'fa-nbi'; s.innerHTML = nbIcon(key, { locked });
        const nm = head.querySelector('.name'); nm ? nm.before(s) : head.prepend(s);
        // the ▾ button duplicated the whole-row tap (any tap on the header collapses) — hide it, keep a small chevron
        const tg = head.querySelector('[data-toggle]');
        if (tg) { tg.classList.add('fa-hide'); tg.tabIndex = -1; const ch = document.createElement('span'); ch.className = 'fa-chev' + (/▸/.test(tg.textContent) ? ' col' : ''); ch.setAttribute('aria-hidden', 'true'); s.before(ch); head.setAttribute('aria-expanded', /▸/.test(tg.textContent) ? 'false' : 'true'); head.setAttribute('role', 'button'); }
        if (locked) head.classList.add('fa-locked');
      }
      let rows = 0;
      el.querySelectorAll('.note-row[data-note]').forEach(row => {
        rows++;
        if (row.querySelector('.fa-pgi')) return;
        const n = (S.notes || []).find(x => x.id === row.dataset.note);
        const s = document.createElement('span'); s.className = 'fa-pgi'; s.innerHTML = locked ? pageIcon(key, 'locked') : iconForNote(n);
        row.prepend(s);
      });
      const empty = el.querySelector('.note-row.empty .s');
      if (empty && !q && !/tap/.test(empty.textContent)) empty.textContent = 'No notes yet — tap ＋ to add one';
      // search: hide notebooks with nothing to show (unless the notebook's own name matches)
      el.classList.toggle('fa-search-miss', !!q && !rows && !String(nb.name || '').toLowerCase().includes(q));
    });
    // a notebook label that only labels hidden blocks
    const lab = box.querySelector('.side-label:not(.soft):not(.boards)');
    if (lab) lab.classList.toggle('fa-search-miss', !!q && !box.querySelector('.nb[data-nbid]:not(.fa-search-miss)'));
    decorateResults();
  }
  function decorateResults() {
    const res = document.getElementById('hwResults'); if (!res || res.hidden) return;
    const q = (S.search || '').trim(); if (q.length < 2) return;
    let hits = null;
    try { hits = window.V21ee && typeof V21ee.search === 'function' ? V21ee.search(q, 60) : null; } catch (_) {}
    res.querySelectorAll('.hw-res').forEach(b => {
      if (b.querySelector('.fa-pgi')) return;
      let n = null;
      if (!b.classList.contains('qm-hit') && hits && b.dataset.i != null) n = (hits[+b.dataset.i] || {}).note || null;
      if (!n) { const t = ((b.querySelector('.hw-t') || {}).textContent || '').replace(/ · p\.\d+$/, ''); n = (S.notes || []).find(x => x.title === t) || null; }
      if (!n) return;
      const nb = nbById(n.notebookId);
      const meta = b.querySelector('.hw-meta'); if (!meta) return;
      const tag = document.createElement('span'); tag.className = 'fa-res-nb fa-c-' + colorOf(nb);
      tag.innerHTML = nbIcon(colorOf(nb), { size: 14, locked: nbLocked(nb) }) + '<span>' + escA(nb ? nb.name : '') + '</span>';
      const s = document.createElement('span'); s.className = 'fa-pgi fa-pgi-sm'; s.innerHTML = iconForNote(n);
      const t = meta.querySelector('.hw-t'); if (t) t.prepend(s);
      if (nb) meta.append(tag);
    });
  }
  let renders = 0;
  const _rs = renderSidebar;
  renderSidebar = function () {
    renders++;
    if (window.__ready) ensureColors();
    const r = _rs.apply(this, arguments);
    if (typeof drag !== 'undefined' && drag) return r;
    try { decorate(); } catch (e) { console.warn('v21fa decorate', e); }
    return r;
  };

  /* ---------------- coalesced sidebar renders (title typing, search typing) ---------------- */
  let rsTimer = 0, lastRs = 0;
  function renderSoon(delay) {
    clearTimeout(rsTimer);
    const now = performance.now();
    if (now - lastRs > delay) { lastRs = now; renderSidebar(); return; }   // leading edge: first keystroke is instant
    rsTimer = setTimeout(() => { rsTimer = 0; lastRs = performance.now(); renderSidebar(); }, delay);
  }
  function flushRender() { if (rsTimer) { clearTimeout(rsTimer); rsTimer = 0; lastRs = performance.now(); renderSidebar(); } }
  document.addEventListener('input', e => {
    const t = e.target;
    if (t && t.id === 'noteTitle') {
      e.stopImmediatePropagation();    // replaces app.js: save + full sidebar rebuild on every keystroke
      const n = curNote(); if (!n || t.readOnly) return;
      n.title = t.value || 'Untitled note'; saveNote(n);
      const row = document.querySelector(`#notebookList .note-row[data-note="${CSS.escape(n.id)}"] .t`);
      if (row) row.textContent = n.title;
      clearTimeout(titleTimer); titleTimer = setTimeout(() => renderSidebar(), 700);
    } else if (t && t.id === 'search') {
      e.stopImmediatePropagation();    // replaces app.js: S.search + renderSidebar, coalesced while typing
      S.search = t.value;
      renderSoon(140);
    }
  }, true);
  let titleTimer = 0;
  document.addEventListener('keydown', e => { if (e.target && e.target.id === 'search' && e.key === 'Enter') flushRender(); }, true);
  document.addEventListener('search', e => { if (e.target && e.target.id === 'search') { S.search = e.target.value; clearTimeout(rsTimer); rsTimer = 0; lastRs = performance.now(); renderSidebar(); } }, true);

  /* ---------------- open note stays in view when the sidebar opens ---------------- */
  function revealActive() {
    const list = document.getElementById('notebookList'), a = list && list.querySelector('.note-row.active');
    if (!a) return;
    const lr = list.getBoundingClientRect(), ar = a.getBoundingClientRect();
    if (ar.top < lr.top || ar.bottom > lr.bottom) a.scrollIntoView({ block: 'nearest' });
  }
  if (typeof setSidebar === 'function') {
    const _sb = setSidebar;
    setSidebar = function (open) { const r = _sb.apply(this, arguments); if (open) requestAnimationFrame(() => { try { revealActive(); } catch (_) {} }); return r; };
  }

  /* ---------------- delete: neighbour, last-notebook guard ---------------- */
  const sealedNote = n => !!(n && n.lock && typeof isSealed === 'function' && isSealed(n));
  const openable = n => n && !SYS.includes(n.id) && !n.system && n.notebookId !== ARCH && !sealedNote(n) && !nbLocked(nbById(n.notebookId));
  function neighbourOf(n) {
    const sib = notesIn(n.notebookId), i = sib.indexOf(n);
    const cand = [...sib.slice(i + 1), ...sib.slice(0, Math.max(0, i)).reverse()].filter(x => x !== n && openable(x));
    if (cand.length) return cand[0];
    return (S.notes || []).filter(x => x !== n && openable(x)).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }
  if (typeof deleteNote === 'function') {
    const _dn = deleteNote;
    deleteNote = async function (n) {
      try {
        const rec = typeof R !== 'undefined' && R.active && R.active.noteId === (n && n.id);
        if (n && S.cur === n.id && !rec) { const nx = neighbourOf(n); if (nx) openNote(nx.id); }
      } catch (e) { console.warn('v21fa neighbour', e); }
      return _dn.apply(this, arguments);
    };
  }
  if (typeof deleteNotebook === 'function') {
    const _dnb = deleteNotebook;
    deleteNotebook = async function (nb) {
      if (nb && nb.id !== ARCH && userNbs().length <= 1) { toast('You need at least one notebook — rename it instead'); return; }
      return _dnb.apply(this, arguments);
    };
  }

  /* ---------------- V21ee.search: v21em and v21ex both appended the same quote hits ---------------- */
  if (window.V21ee && typeof V21ee.search === 'function') {
    const _se = V21ee.search;
    V21ee.search = function (query, limit) {
      // keep the last copy of each quote (v21ex's, with the current status labels)
      const hits = _se.apply(this, arguments) || [], key = h => (h.note && h.note.id) + '|' + h.pi + '|' + (h.q && h.q.id || (h.bb || []).join(','));
      const lastAt = new Map(); hits.forEach((h, i) => { if (String(h.kind || '').startsWith('🧾')) lastAt.set(key(h), i); });
      return hits.filter((h, i) => !String(h.kind || '').startsWith('🧾') || lastAt.get(key(h)) === i);
    };
  }

  /* ---------------- notebook ⋯ menu: 🎨 color; Move-to pickers get icons ---------------- */
  let menuNb = null;
  document.addEventListener('click', e => {   // document capture runs before the stacked list handlers (v21eq / v21ej)
    const more = e.target.closest && e.target.closest('#notebookList [data-nbmore]');
    if (more) { const h = more.closest('[data-nb]'); menuNb = h ? h.dataset.nb : null; }
    else if (e.target.closest && e.target.closest('#notebookList')) menuNb = null;
  }, true);
  const _as = actionSheet;
  actionSheet = function (title, actions) {
    actions = actions || [];
    const nb = menuNb && nbById(menuNb);
    const ri = actions.findIndex(a => a && /^Rename notebook/.test(a.label || ''));
    if (nb && ri >= 0 && !actions.some(a => a && a.faColor)) {
      actions = actions.slice();
      actions.splice(ri + 1, 0, { label: '🎨 Notebook color…', faColor: true, sub: byKey(colorOf(nb)).name, fn: () => openColorPicker(nb) });
    }
    if (ri < 0) menuNb = null;
    const r = _as.call(this, title, actions);
    try { if (/^Move to/.test(title || '')) iconizeMoveSheet(); } catch (e) { console.warn('v21fa move icons', e); }
    return r;
  };
  function iconizeMoveSheet() {
    const box = document.getElementById('actionBtns'); if (!box) return;
    const cur = curNote();
    box.querySelectorAll('button').forEach(b => {
      if (b.querySelector('.fa-nbi')) return;
      const label = (b.textContent || '').replace(/^📁\s*/, '').replace(/\s*\(recordings\)$/, '').trim();
      const nb = userNbs().find(x => x.name === label && (!cur || x.id !== cur.notebookId)) || userNbs().find(x => x.name === label);
      if (!nb) return;
      const s = document.createElement('span'); s.className = 'fa-nbi fa-inline'; s.innerHTML = nbIcon(colorOf(nb), { locked: nbLocked(nb), size: 22 });
      b.classList.add('fa-move-nb'); b.prepend(s);
    });
  }

  /* ---------------- color picker ---------------- */
  function closePicker() { const w = document.getElementById('faColorWrap'); if (w) w.hidden = true; }
  function openColorPicker(nb) {
    let w = document.getElementById('faColorWrap');
    if (!w) { w = document.createElement('div'); w.id = 'faColorWrap'; w.className = 'modal-wrap fa-color-wrap'; document.body.append(w); }
    const cur = colorOf(nb);
    w.innerHTML = `<div class="sheet fa-color-sheet" role="dialog" aria-modal="true" aria-label="Notebook color">
      <div class="fa-color-head">${nbIcon(cur, { size: 34 })}<div><h3>Notebook color</h3><p class="fine">${escA(nb.name)}</p></div></div>
      <div class="fa-swatches" role="radiogroup" aria-label="Colors">${PALETTE.map(c => `<button type="button" class="fa-sw fa-c-${c.key}${c.key === cur ? ' on' : ''}" role="radio" aria-checked="${c.key === cur}" data-color="${c.key}" aria-label="${c.name}">${nbIcon(c.key, { size: 30 })}<span>${c.name}</span></button>`).join('')}</div>
      <div class="fa-color-foot"><button type="button" class="btn" data-fa="cancel">Cancel</button></div></div>`;
    w.hidden = false;
    w.onclick = e => {
      if (e.target === w || e.target.closest('[data-fa="cancel"]')) return closePicker();
      const sw = e.target.closest('[data-color]'); if (!sw) return;
      setColor(nb, sw.dataset.color); closePicker(); toast('🎨 ' + nb.name + ' is now ' + byKey(sw.dataset.color).name.toLowerCase(), 1400);
    };
    return w;
  }

  /* ---------------- 📁 Recordings sheet: page icons tinted to their notebook ---------------- */
  function decorateRecordings(root) {
    if (!root || !window.V21ev || typeof V21ev.recordings !== 'function') return;
    const items = root.querySelectorAll('.ev-item[data-rec]'); if (!items.length) return;
    let list = null;
    items.forEach(el => {
      const t = el.querySelector('.ev-t'); if (!t || t.querySelector('.fa-pgi')) return;
      list = list || V21ev.recordings();
      const it = list.find(x => x.rec && x.rec.id === el.dataset.rec); if (!it || !it.n) return;
      const s = document.createElement('span'); s.className = 'fa-pgi fa-pgi-sm'; s.innerHTML = pageIcon(colorOf(nbById(it.n.notebookId)), 'rec');
      t.prepend(s);
    });
  }
  const mo = new MutationObserver(() => { const w = document.getElementById('evArchWrap'); if (w && !w.hidden) decorateRecordings(w); });
  const watch = () => { const w = document.getElementById('evArchWrap'); if (w && !w._fa) { w._fa = true; mo.observe(w, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); decorateRecordings(w); } };
  new MutationObserver(watch).observe(document.body, { childList: true });

  /* theme switch needs no re-render: icon colors are CSS variables with a [data-theme=dark] variant */

  window.V21fa = { version: VERSION, VERSION, PALETTE, KEYS, ensureColors, colorOf, setColor, openColorPicker, nbIcon, pageIcon, noteKind, neighbourOf, hexOf, renders: () => renders, decorate };
  const ready = () => { try { ensureColors(); renderSidebar(); } catch (e) { console.warn('v21fa ready', e); } };
  if (window.__ready) ready(); else { const t = setInterval(() => { if (window.__ready) { clearInterval(t); ready(); } }, 80); setTimeout(() => clearInterval(t), 20000); }
})();
