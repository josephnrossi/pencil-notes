/* Pencil Notes v21eg — clean-up pass (MOCK).
   1. Retired from the UI (data kept, nothing deleted): 🗓 Daily Planner (template, Add page, lasso, card / assistant docks,
      Settings, ⋯ menu), 📥 Inbox board, 🧮 Calculator Board (its own IndexedDB stays untouched), 💲 Quote Board leftovers,
      🛰 Satellite orb (satellite.js no longer loaded). The Boards slide-out is just the 💡 Idea Board — no switcher.
   2. One ✨ Ask Grok: Summarize · Convert to text · Make tasks · Draft reply · Clean up · 🧮 Calculate · Ask.
   3. Lasso menu = ✨ Ask Grok · ☑️ Make task · 📤 Send to (→ Idea Board) · 1. Number · ✂️ ⧉ 🗑 · ⋯ More
      (More: 🧮 Calculate · ⎘ Duplicate · 📋 Paste · 🏷 Label · ✕ Deselect).
   4. 🧮 Calculate on any page: lasso written math → each formula is read (CalcRecog grouping + the Calculator readers),
      evaluated with CalcMath; then Margin / Markup / % change / ⇄ Compare / Sum / Average… on the lettered results (CalcFns).
      Tap a reading to fix it. “⤓ Write on page” drops the answer as a text box beside the ink. Nothing runs until you tap
      Calculate, so you can take your time writing.
   5. Drag a page onto another notebook: finger hold-drag (or the ⠿ grip) a page, slide to the left edge — the notebook list
      opens — and drop it on a NOTE row (page goes to the end of that note) or a NOTEBOOK name (a new note is made there,
      holding that page). Same page id, links follow it; Undo in the toast.
   6. Quote sheet Notes: ＋ line / － (in v21ed.js).
   7. Slimmer chrome: 🎙 Record and ⤢ Full screen moved into ⋯; 📋 Boards → 💡 Idea Board; Insert: Sticker + Reminder under ⋯ More.
   8. Theme defaults to Match iPad; no quick tour, no sample notes (app.js / audit.js / index.html). */
(function () {
  'use strict';
  const RX_GONE = /planner|\binbox\b|calculator board|satellite|quote board|quick tour/i;
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  try { localStorage.setItem('cbOn', '0'); if (['inbox', 'quotes', 'calc'].includes(localStorage.getItem('drawerBoard'))) localStorage.setItem('drawerBoard', 'ideas'); } catch (_) {}

  /* ==================== 1. retire Planner · Inbox · Calculator Board · Quote Board · Satellite ==================== */
  { const i = TEMPLATES.findIndex(t => t[0] === 'planner'); if (i >= 0) TEMPLATES.splice(i, 1); }
  const _as = actionSheet;
  actionSheet = function (title, actions) {
    if (/planner/i.test(title || '')) return;                            // old planner pickers
    if (title === 'This looks like a request for quote') return _as.call(this, title, actions);   // v21ed keeps it in the Inbox silently
    return _as.call(this, title, (actions || []).filter(a => !RX_GONE.test((a.label || '') + ' ' + (a.sub || ''))));
  };
  const _ps = pickSheet;
  pickSheet = function (title, items, opts) {
    if (/planner/i.test(title || '')) return Promise.resolve(null);
    return _ps.call(this, title, (items || []).filter(i => !['planner', 'inbox', 'quotes', 'calc'].includes(i.value) && !RX_GONE.test((i.label || '') + ' ' + (i.sub || ''))), opts);
  };
  const _mi = moreItems;
  moreItems = function () {
    const secs = _mi.apply(this, arguments).map(sec => ({ ...sec, rows: (sec.rows || []).filter(r => !(r.l && RX_GONE.test(r.l))).map(r => r.s ? { ...r, s: r.s.replace(/,? ?planner,?/i, m => m.endsWith(',') && m.startsWith(',') ? ',' : '').replace(/\s+,/, ',') } : r) }));
    const note = secs.find(s => s.h === 'Note');
    const extra = [{ ic: '🎙', l: 'Record a meeting', s: 'Live captions, then a Meeting Brief', fn: () => $('#recBtn').click() },
      { ic: '⤢', l: 'Full screen writing', s: 'Hide the bars — tap ⤡ to come back', fn: () => $('#focusBtn').click() }];
    secs.splice(note ? secs.indexOf(note) : secs.length, 0, { h: 'Write', rows: extra });
    return secs;
  };
  const _ss = settingsSections;
  settingsSections = function () {
    return _ss.apply(this, arguments).filter(sec => sec.id !== 'planner').map(sec => {
      const rows = (sec.rows || []).filter(r => !RX_GONE.test((r.label || '') + ' ' + (r.sub || '')));
      if (sec.id === 'quotes') return { ...sec, h: 'Idea Board', note: 'The 💡 Idea Board slides out from the right — tap 💡 Idea Board in the top bar or swipe in from the right edge. Quotes live on your note pages: ＋ Insert → 🧾 Quote sheet.', rows };
      return { ...sec, rows };
    });
  };
  try { const i = TOUR.findIndex(t => t[0] === '#toggleSidebar'); if (i >= 0) TOUR[i] = ['#toggleSidebar', '☰ Notes', 'Notebooks, 📁 Archive for recordings, search, and ⚙︎ Settings.']; } catch (_) {}
  try { TOUR.length = 0; } catch (_) {}                                   // no quick tour at all

  const css = document.createElement('style'); css.id = 'v21egHide';
  css.textContent = '#lassoPlanner, #lassoBoard, #lassoAssist, #lassoRead, #lassoCancel, #lassoPaste, #inRow, #inHost, #cbHost, #qbRefresh, #qbPull, #dbMenu, #dbSwitch .db-car, #dbDot, #bDock, [data-dock="planner"], #satOrb, #satPanel, #recBtn, #focusBtn, #todayBtn, .side-label.boards { display: none !important; }';
  document.head.append(css);

  function cleanBoards() {
    try {
      if (typeof BOARDS === 'undefined') return;
      if (QB.mode !== 'ideas') setDrawerBoard('ideas', { render: QB.open });
      delete BOARDS.calc; delete BOARDS.inbox;
      const B = BOARDS.ideas; if (B) { B.name = 'Idea Board'; B.short = 'Idea Board'; }
      syncTab();
      const qb = $('#quotesBtn'); if (qb) { qb.classList.add('eg-ideas'); if (!qb.querySelector('.eg-lab')) qb.innerHTML = '💡<span class="eg-lab">Idea Board</span>'; qb.title = 'Idea Board'; qb.setAttribute('aria-label', 'Idea Board'); }
      const sw = $('#dbSwitch'); if (sw) { sw.disabled = true; sw.removeAttribute('aria-haspopup'); sw.title = 'Idea Board'; }
      const ch = document.getElementById('cbHost'); if (ch) ch.hidden = true;
      document.querySelectorAll('#inRow, #satOrb, #satPanel').forEach(e => e.remove());
    } catch (e) { console.warn('v21eg boards', e); }
  }
  function syncTab() { const tab = $('#qbTab'); if (!tab) return; const sp = tab.querySelector('span'), b = tab.querySelector('b'); if (sp) sp.textContent = '💡'; if (b) b.textContent = 'Idea Board';
    tab.setAttribute('aria-label', 'Open the Idea Board'); tab.title = 'Idea Board — tap or swipe in from the right edge'; }
  const _qo = qbOpen; qbOpen = function () { const r = _qo.apply(this, arguments); syncTab(); return r; };
  const _dbm = dbMenu; dbMenu = function (on) { return _dbm.call(this, false); };   // one board → no dropdown
  const _sdb = setDrawerBoard;
  setDrawerBoard = function (mode, opts) { const r = _sdb.call(this, 'ideas', opts); syncTab(); return r; };   // only the Idea Board is left
  const _rs = renderSidebar;
  renderSidebar = function () { const r = _rs.apply(this, arguments); document.querySelectorAll('#inRow, #qbRow, .side-label.boards').forEach(x => x.remove()); return r; };

  /* ==================== 2. Insert: Sticker + Reminder under ⋯ More; Page… copy ==================== */
  function slimInsert() {
    const m = document.getElementById('insertMenu'); if (!m || m.querySelector('#insMore')) return;
    const s = m.querySelector('#insPage small'); if (s) s.textContent = 'Lined, grid, blank, meeting, recording…';
    const ip = m.querySelector('#insPage'); if (ip) ip.title = 'Add a page: lined, grid, blank, meeting or recording';
    const moved = ['stickerBtn', 'remindNoteBtn'].map(id => m.querySelector('#' + id)).filter(Boolean);
    moved.forEach(b => b.classList.add('eg-moved'));
    const more = document.createElement('button'); more.id = 'insMore'; more.className = 'ins-item'; more.setAttribute('role', 'menuitem');
    more.innerHTML = '<i>⋯</i><span>More</span><small>Sticker · Reminder</small>';
    more.onclick = () => { m.hidden = true; const ib = $('#insertBtn'); ib && ib.setAttribute('aria-expanded', 'false');
      actionSheet('Insert more', moved.map(b => ({ label: b.querySelector('i').textContent + ' ' + b.querySelector('span').textContent, sub: (b.querySelector('small') || {}).textContent || '', fn: () => b.click() }))); };
    m.append(more);
    const ib = $('#insertBtn'); if (ib) ib.title = 'Insert a task, number, quote sheet, daily to-do, photo, recording, page or PDF';
  }

  /* ==================== 3. lasso menu: Ask Grok · Make task · Send to · Number · Cut Copy Delete · More ==================== */
  function slimLasso() {
    const m = $('#lassoMenu'); if (!m || m.dataset.eg) return; m.dataset.eg = '1';
    ['lassoPlanner', 'lassoBoard', 'lassoAssist', 'lassoRead'].forEach(id => { const b = document.getElementById(id); if (b) b.classList.add('v21-moved'); });
    const task = $('#lassoTask'), send = $('#lassoSend'), sec = $('#lassoSection'), more = $('#lassoMore');
    task.innerHTML = '☑️ Make task';
    send.innerHTML = '📤 Send to'; send.title = 'Send to the 💡 Idea Board';
    sec.classList.remove('v21-moved'); sec.innerHTML = '1. Number'; sec.title = 'Make a section number here';
    send.after(sec);
    more.innerHTML = '⋯ More'; more.setAttribute('aria-label', 'More: calculate, duplicate, paste, label');
    send.onclick = async () => {
      const s = selection; if (!s) return; if (!s.ids.length) { toast('Select some handwriting first'); return; } m.hidden = true;
      const back = () => { if (selection) { m.hidden = false; positionLassoMenu(); } };
      const n = ensureIdeaNote(); if (ibSealed()) { back(); return toast('🔒 Unlock the Idea Board first'); }
      const cols = boardCols(n.pages[0]);
      const col = cols.length > 1 ? await pickSheet('Send to the 💡 Idea Board — which column?', cols.map(c => ({ label: c.title, sub: colCards(n.pages[0], c.id).length + ' cards', value: c.id }))) : cols[0].id;
      if (!col) return back();
      const t = cardFromInk({ note: curNote(), pi: s.pi, ids: s.ids.slice() }, n, IPI, col);
      if (t) { qbOpen(true, { quiet: true, mode: 'ideas' }); boardFlash(IPI, t.id); toast('💡 Sent to the Idea Board', 1600); }
    };
    more.onclick = () => { if (!selection) return; m.hidden = true;
      const back = () => { if (selection) { m.hidden = false; positionLassoMenu(); } };
      const hasClip = typeof clip !== 'undefined' && clip;
      actionSheet('Selection', [
        { label: '🧮 Calculate', sub: 'Work out the math you wrote — margin, markup, % change, compare…', fn: () => openCalc() },
        { label: '⎘ Duplicate', fn: () => $('#lassoDup').click() },
        ...(hasClip ? [{ label: '📋 Paste', fn: () => $('#lassoPaste').click() }] : []),
        { label: '🏷 Label (make it searchable by name)', fn: () => $('#lassoLabel').click() },
        { label: '✕ Deselect', fn: hideLasso }]);
      const w = $('#actionWrap'), obs = new MutationObserver(() => { if (w.hidden) { obs.disconnect(); setTimeout(back, 0); } }); obs.observe(w, { attributes: true, attributeFilter: ['hidden'] });
    };
  }

  /* ==================== 4. ✨ Ask Grok → 🧮 Calculate; on-page calculation ==================== */
  if (!GK_ACTS.some(a => a.id === 'calc')) GK_ACTS.splice(2, 0, { id: 'calc', ic: '🧮', l: 'Calculate', ink: true });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#grokPop [data-act="calc"]'); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    const pop = $('#grokPop'); if (pop) pop.hidden = true; try { V21.GK.ctx = null; } catch (_) {}
    openCalc();
  }, true);

  const LET = i => String.fromCharCode(65 + i);
  const C = { pi: -1, noteId: null, items: [], fn: 'margin', map: {}, reader: null, busy: false, bb: null, out: null };
  const FAV = ['margin', 'markup', 'pctChange', 'compare', 'profit', 'priceMarkup', 'priceMargin', 'discount', 'tax', 'sum', 'average', 'median', 'min', 'max', 'sqft', 'linft', 'costPerUnit'];
  const fnList = () => { const L = (window.CalcFns && CalcFns.list) || []; const fav = FAV.map(id => id === 'compare' ? { id: 'compare', label: '⇄ Compare', group: 'Compare' } : L.find(f => f.id === id)).filter(Boolean); return [...fav, ...L.filter(f => !FAV.includes(f.id))]; };
  const fnOf = id => id === 'compare' ? { id: 'compare', label: '⇄ Compare', inputs: [{ k: 'items', label: 'Values', multi: true }] } : CalcFns.get(id);
  async function readFormula(strokes) {
    const r = C.reader || (window.CalcBoard && CalcBoard._defaultRecognize);
    if (!r) return { text: '' };
    try { const res = await r(strokes, {}); return res && typeof res === 'object' ? res : { text: String(res || '') }; } catch (e) { console.warn('calc read', e); return { text: '' }; }
  }
  const clean = t => String(t || '').replace(/```[a-z]*|```/gi, '').replace(/\s*=\s*\??\s*$/, '').trim();
  function evalAll() {
    const env = idx => ({ resolve: nm => { const k = nm.charCodeAt(0) - 65; if (nm.length === 1 && k >= 0 && k < idx && C.items[k].res && C.items[k].res.ok) return C.items[k].res.value; return undefined; } });
    C.items.forEach((it, i) => { it.res = it.text ? CalcMath.evalText(clean(it.text), env(i)) : { ok: false, error: it.reading ? 'reading…' : 'Type what you wrote' }; });
  }
  async function openCalc() {
    const s = selection; if (!s) return toast('Lasso some written math first');
    const n = curNote(), pg = n.pages[s.pi], strokes = pg.strokes.filter(x => s.ids.includes(x.id));
    const texts = (s.texts || []).map(id => pg.texts.find(t => t.id === id)).filter(t => t && t.text && /\d/.test(t.text));
    if (!strokes.length && !texts.length) return toast('Lasso some written math first');
    $('#lassoMenu').hidden = true;
    Object.assign(C, { pi: s.pi, noteId: n.id, bb: s.bb.slice(), items: [], out: null, busy: true });
    const groups = strokes.length ? (window.CalcRecog ? CalcRecog.group(strokes) : [strokes.map((_, i) => i)]) : [];
    const gs = groups.map(g => g.map(i => strokes[i])).map(g => ({ strokes: g, bb: g.reduce((u, st) => { const b = st.bb || bbox(st.points); return [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]) }));
    for (const t of texts) gs.push({ strokes: [], typed: t.text, bb: [t.x, t.y, t.x + 100, t.y + 24] });
    gs.sort((a, b) => (Math.abs(a.bb[1] - b.bb[1]) < 18 ? a.bb[0] - b.bb[0] : a.bb[1] - b.bb[1]));
    C.items = gs.map(g => ({ ...g, text: g.typed || '', reading: !g.typed }));
    evalAll(); renderCalc();
    await Promise.all(C.items.map(async it => { if (!it.reading) return; const r = await readFormula(it.strokes); it.text = clean(r.text); it.cands = (r.cands || []).map(c => clean(c.text)).filter(Boolean); it.reading = false; evalAll(); renderCalc(); }));
    C.busy = false; autoMap(); renderCalc();
  }
  function autoMap() {
    const f = fnOf(C.fn); if (!f) return; const ok = C.items.map((it, i) => it.res && it.res.ok ? i : -1).filter(i => i >= 0);
    C.map = {}; let k = 0;
    for (const inp of f.inputs) { if (inp.param) continue; if (inp.multi) C.map[inp.k] = ok.slice(k); else C.map[inp.k] = ok[k++] != null ? ok[k - 1] : -1; }
  }
  function runFn() {
    const f = fnOf(C.fn); if (!f) return { ok: false, error: 'Pick a function' };
    const v = i => C.items[i] && C.items[i].res && C.items[i].res.ok ? C.items[i].res.value : undefined;
    try {
      if (C.fn === 'compare') { const ids = C.map.items || []; if (ids.length < 2) return { ok: false, error: 'Compare needs at least 2 values' };
        const c = CalcFns.compare(ids.map(i => ({ name: LET(i), value: v(i) }))); return { ok: true, card: c, display: c.display }; }
      const inp = {}; for (const i of f.inputs) { if (i.param) continue; const m = C.map[i.k]; inp[i.k] = i.multi ? (m || []).map(v).filter(x => x !== undefined) : v(m); if (!i.multi && inp[i.k] === undefined) return { ok: false, error: `Pick a value for ${i.label}` }; }
      return CalcFns.run(C.fn, inp);
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }
  const W = (() => { const w = document.createElement('div'); w.id = 'egCalcWrap'; w.className = 'modal-wrap'; w.hidden = true; document.body.append(w);
    w.addEventListener('pointerdown', e => { if (e.target === w) closeCalc(); }); return w; })();
  function closeCalc() { W.hidden = true; if (selection) { $('#lassoMenu').hidden = false; positionLassoMenu(); } }
  const fmt = r => r && r.ok ? (r.display != null ? r.display : CalcMath.format(r.value)) : '';
  function renderCalc() {
    const f = fnOf(C.fn), R = C.busy ? null : runFn();
    const opt = (sel, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${LET(i)}${C.items[i].res && C.items[i].res.ok ? ' = ' + esc(fmt(C.items[i].res)) : ''}</option>`;
    const inputs = f ? f.inputs.filter(i => !i.param).map(i => i.multi
      ? `<div class="eg-in"><span>${esc(i.label)}</span><div class="eg-chips">${C.items.map((_, k) => `<button class="eg-chip ${(C.map[i.k] || []).includes(k) ? 'on' : ''}" data-multi="${i.k}" data-k="${k}">${LET(k)}</button>`).join('')}</div></div>`
      : `<label class="eg-in"><span>${esc(i.label)}</span><select data-in="${i.k}"><option value="-1">—</option>${C.items.map((_, k) => opt(C.map[i.k], k)).join('')}</select></label>`).join('') : '';
    let res = '';
    if (R && R.ok && R.card) { const c = R.card; res = c.kind === 'scalars' ? `<div class="eg-cmp">${c.cols.map(x => `<div><b>${esc(x.name)}</b> ${esc(CalcMath.format(x.value))}${x.pct != null ? ` <em>${x.pct > 0 ? '+' : ''}${esc(CalcMath.format(x.pct))}%</em>` : ''}</div>`).join('')}
        <p>${c.higher ? `${esc(c.higher)} is higher by ${esc(CalcMath.format(c.spread))}` : 'They are equal'}${c.prices ? ` · as cost → price: margin ${esc(CalcMath.format(c.prices.margin))}% · markup ${esc(CalcMath.format(c.prices.markup))}%` : ''}</p></div>` : `<div class="eg-cmp"><p>${esc(c.display)}</p></div>`; }
    const resText = R && R.ok ? (R.card ? (R.card.kind === 'scalars' ? `${R.card.cols.map(x => x.name + ' ' + CalcMath.format(x.value)).join(' vs ')} → ${R.card.display}` : R.card.display) : `${f.label}: ${fmt(R)}`) : '';
    C.out = resText;
    W.innerHTML = `<div class="sheet eg-calc" role="dialog" aria-label="Calculate">
      <div class="eg-head"><h3>🧮 Calculate</h3><button class="icon-btn" data-c="close" aria-label="Close">✕</button></div>
      <p class="fine">${C.busy ? 'Reading your handwriting…' : 'Each formula you lassoed gets a letter. Tap a reading to fix it.'}</p>
      <ol class="eg-items">${C.items.map((it, i) => `<li><b class="eg-let">${LET(i)}</b><input data-item="${i}" value="${esc(it.text)}" placeholder="${it.reading ? 'reading…' : 'type what you wrote'}" autocomplete="off" spellcheck="false" inputmode="decimal"><span class="eg-val ${it.res && it.res.ok ? 'ok' : 'err'}">${it.res && it.res.ok ? '= ' + esc(fmt(it.res)) : esc(it.res ? it.res.error || '' : '')}</span>
        ${it.cands && it.cands.length > 1 ? `<div class="eg-cands">${it.cands.map(c => `<button class="eg-chip" data-cand="${i}" data-t="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</li>`).join('')}</ol>
      <label class="eg-in eg-fn"><span>Function</span><select data-c="fn">${fnList().map(x => `<option value="${x.id}" ${x.id === C.fn ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
      ${f && f.formula ? `<p class="fine eg-formula">${esc(f.formula)}</p>` : ''}
      ${inputs}
      <div class="eg-result ${R && R.ok ? 'ok' : ''}">${C.busy ? '…' : R && R.ok ? (R.card ? res : `<b>${esc(fmt(R))}</b>${R.extra ? `<small>${esc(R.extra)}</small>` : ''}`) : esc(R ? R.error : '')}</div>
      <div class="sheet-actions"><button class="btn" data-c="copy" ${resText ? '' : 'disabled'}>⧉ Copy</button><div class="spacer"></div><button class="btn primary" data-c="write" ${resText || C.items.some(i => i.res && i.res.ok) ? '' : 'disabled'}>⤓ Write on page</button></div>
    </div>`;
    W.hidden = false;
  }
  W.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.c === 'fn') { C.fn = t.value; autoMap(); renderCalc(); }
    else if (t.dataset.in) { C.map[t.dataset.in] = +t.value; renderCalc(); }
  });
  W.addEventListener('input', e => { const t = e.target; if (t.dataset.item == null) return; C.items[+t.dataset.item].text = t.value; evalAll();
    const li = t.closest('li'), it = C.items[+t.dataset.item], sp = li.querySelector('.eg-val'); sp.className = 'eg-val ' + (it.res.ok ? 'ok' : 'err'); sp.textContent = it.res.ok ? '= ' + fmt(it.res) : it.res.error || ''; });
  W.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.item != null) { autoMapKeep(); renderCalc(); } });
  function autoMapKeep() { const f = fnOf(C.fn); if (!f) return; if (f.inputs.some(i => !i.param && (i.multi ? !(C.map[i.k] || []).length : !(C.map[i.k] >= 0)))) autoMap(); }
  W.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c === 'close') return closeCalc();
    if (b.dataset.multi) { const a = C.map[b.dataset.multi] || [], k = +b.dataset.k; C.map[b.dataset.multi] = a.includes(k) ? a.filter(x => x !== k) : [...a, k]; return renderCalc(); }
    if (b.dataset.cand != null) { const it = C.items[+b.dataset.cand]; it.text = b.dataset.t; it.cands = null; evalAll(); autoMapKeep(); return renderCalc(); }
    if (b.dataset.c === 'copy') { try { navigator.clipboard.writeText(C.out); } catch (_) {} return toast('Copied', 1000); }
    if (b.dataset.c === 'write') return writeOnPage();
  });
  function writeOnPage() {
    const n = curNote(); if (!n || n.id !== C.noteId) return closeCalc(); const pg = n.pages[C.pi]; if (!pg) return closeCalc();
    if (sealed(n)) return toast('🔒 Unlock the note first');
    const lines = C.items.filter(i => i.res && i.res.ok && i.res.kind !== 'assign').map((it, k) => `${LET(C.items.indexOf(it))}: ${clean(it.text)} = ${fmt(it.res)}`);
    const txt = [C.out, ...(C.out ? [] : lines)].filter(Boolean).join('\n') || lines.join('\n');
    pushHistory();
    const x = Math.min(PAGE_W - 260, C.bb[2] + 16), y = Math.max(20, C.bb[1]);
    const t = { id: uid('x'), x, y, text: '= ' + txt, size: 22, color: typeof ACCENT_INK !== 'undefined' ? ACCENT_INK : INK };
    pg.texts.push(t); saveNote(n, true); renderOverlay(C.pi);
    W.hidden = true; hideLasso(); toast('⤓ Answer written on the page', 1600);
    return t;
  }

  /* ==================== 5. drag a page onto another notebook / note in the sidebar ==================== */
  const DROP = { opened: false, hint: null };
  const sideVisible = () => { const sb = $('#sidebar'), r = sb.getBoundingClientRect(); return r.right > 40 && getComputedStyle(sb).display !== 'none'; };
  function openSide() { if (sideVisible()) return; DROP.forceOpen = true; setSidebar(true); DROP.opened = true; }
  /* v21eh: the notebook list opens the moment a page is lifted and stays open for the whole drag —
     nothing may close it (scrim tap, note open, re-layout) until the drop or cancel. */
  const _ssb = setSidebar;
  setSidebar = function (open) { if (!open && (window.V21ec && V21ec.dragging || DROP.hold)) return; return _ssb.apply(this, arguments); };
  const _rl = relayout;
  relayout = function () { if (window.V21ec && V21ec.dragging) { DROP.relayout = true; return; } return _rl.apply(this, arguments); };   // a rebuild mid-drag would drop the finger's target
  { const sc = $('#scrim'); const _oc = sc.onclick; sc.onclick = function (e) { if ((window.V21ec && V21ec.dragging) || DROP.hold || Date.now() - (DROP.endAt || 0) < 500) return; return _oc && _oc.call(this, e); }; }
  /* v21eh: notebooks already slid out (portrait drawer)? press and hold the page next to them → that page lifts right there */
  { const sc = $('#scrim'); let h = null;
    sc.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY), pe = els.map(x => x.closest && x.closest('#pages .page[data-pi]')).find(Boolean); if (!pe) return;
      h = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, pi: +pe.dataset.pi, type: e.pointerType };
      h.t = setTimeout(() => { const g = h; h = null; if (!g) return; DROP.hold = true; DROP.opened = false; if (window.V21ec && V21ec.startAt(g.pid, g.pi, g.x0, g.y0, g.type)) { try { navigator.vibrate && navigator.vibrate(15); } catch (_) {} } DROP.hold = false; }, 450);
    });
    const off = e => { if (h && e.pointerId === h.pid && (e.type !== 'pointermove' || Math.hypot(e.clientX - h.x0, e.clientY - h.y0) > 10)) { clearTimeout(h.t); h = null; } };
    addEventListener('pointermove', off, true); addEventListener('pointerup', off, true); addEventListener('pointercancel', off, true); }
  function targetAt(x, y) {
    const els = document.elementsFromPoint(x, y); if (!els.some(e => e.id === 'sidebar' || e.closest && e.closest('#sidebar'))) return null;
    for (const el of els) {
      const row = el.closest && el.closest('.note-row[data-note]'); if (row) return { type: 'note', id: row.dataset.note, el: row };
      const nb = el.closest && el.closest('.nb[data-nbid]'); if (nb) { const h = nb.querySelector('.nb-head') || nb; return { type: 'nb', id: nb.dataset.nbid, el: h }; }
    }
    return { type: 'none' };
  }
  function labelFor(t) {
    const cur = curNote();
    if (t.type === 'note') { const n = S.notes.find(x => x.id === t.id); if (!n) return null; if (n.id === cur.id) return { bad: 'Already in this note' }; if (sealed(n)) return { bad: '🔒 Locked note' }; return { ok: `→ end of “${n.title || 'Untitled'}”` }; }
    if (t.type === 'nb') { const nb = S.notebooks.find(b => b.id === t.id); if (!nb) return null; return { ok: `→ new note in ${nb.name}` }; }
    return { bad: 'Drop on a notebook or a note' };
  }
  function clearHl() { document.querySelectorAll('.eg-droptgt, .eg-dropbad').forEach(e => e.classList.remove('eg-droptgt', 'eg-dropbad')); }
  function ensureHooks() {
    if (!window.V21ec || !V21ec.hooks || V21ec.hooks.eg) return; const H = V21ec.hooks; H.eg = true;
    H.track = D => {
      if (!DROP.hint) { DROP.hint = document.createElement('div'); DROP.hint.id = 'egSideHint'; DROP.hint.innerHTML = '<span>📚</span><b>Notebooks</b><small>slide here to move to another notebook</small>'; document.body.append(DROP.hint); }
      DROP.hint.hidden = sideVisible();
      if (D.x < 44) openSide();
      clearHl();
      const lab = D.ghost.querySelector('.pg-ghost-lab');
      const t = targetAt(D.x, D.y);
      if (!t) { if (lab) lab.textContent = `⠿ Page ${D.from + 1}`; return null; }
      const L = labelFor(t) || { bad: 'Drop on a notebook or a note' };
      if (t.el) t.el.classList.add(L.ok ? 'eg-droptgt' : 'eg-dropbad');
      { const sr = $('#sidebar').getBoundingClientRect(), gh = D.ghost.offsetHeight || 200;   // keep the page thumbnail clear of the notebook list
        D.ghost.style.transform = `translate(${Math.round(sr.right + 14)}px, ${Math.max(8, Math.min(innerHeight - gh - 8, D.y - gh * .35))}px) rotate(-2deg)`; }
      if (lab) lab.textContent = L.ok || L.bad;
      return L.ok ? t : { type: 'none', why: L.bad };
    };
    H.start = () => { openSide(); };
    H.end = (D, cancel) => { DROP.endAt = Date.now(); if (DROP.relayout) { DROP.relayout = false; setTimeout(() => { try { _rl(); } catch (_) {} }, 0); } clearHl(); if (DROP.hint) { DROP.hint.remove(); DROP.hint = null; } if (DROP.opened && (cancel || !D.tgt || D.tgt.type === 'none') && isDrawer()) setSidebar(false); if (cancel || !D.tgt) DROP.opened = false; };
    H.drop = D => { const t = D.tgt; const opened = DROP.opened; DROP.opened = false;
      if (!t || t.type === 'none') { toast(t && t.why ? t.why : 'Drop on a notebook or a note', 1600); return; }
      movePageTo(D.from, t); if (opened && isDrawer()) setSidebar(false); };
  }
  function relink(srcId, dstId, pageId) {   // links shaped { noteId, pageId } anywhere in notes follow the page
    let k = 0; const seen = new Set();
    const walk = o => { if (!o || typeof o !== 'object' || seen.has(o)) return; seen.add(o);
      if (o.noteId === srcId && o.pageId === pageId) { o.noteId = dstId; k++; }
      for (const v of Array.isArray(o) ? o : Object.values(o)) if (v && typeof v === 'object') walk(v); };
    for (const n of S.notes) { const before = k; walk(n.pages); if (k > before && n.id !== srcId && n.id !== dstId) saveNote(n, true); }
    return k;
  }
  function movePageTo(pi, t) {
    const src = curNote(); if (!src || !src.pages[pi]) return null;
    if (sealed(src)) { toast('🔒 Unlock the note first'); return null; }
    const pg = src.pages[pi];
    let dst, created = false;
    if (t.type === 'note') { dst = S.notes.find(x => x.id === t.id); if (!dst || dst.id === src.id) return null; if (sealed(dst)) { toast('🔒 Unlock that note first'); return null; } }
    else { const nb = S.notebooks.find(b => b.id === t.id); if (!nb) return null; dst = makeNote(nb.id, `${src.title || 'Untitled'} — page ${pi + 1}`); dst.pages = []; dst.paper = src.paper || 'lined'; created = true; }
    const paperWas = pg.paper; if (!pg.paper && dst.paper !== src.paper) pg.paper = src.paper || 'lined';   // keep the paper it was written on
    try { hideLasso(); } catch (_) {}
    if (!created) pushHistoryMulti([dst.id]);
    src.pages.splice(pi, 1); dst.pages.push(pg);
    if (!src.pages.length) src.pages.push(newPage());
    if (created) { dst.order = -1; S.notes.push(dst); }
    const links = relink(src.id, dst.id, pg.id);
    saveNote(src, true); saveNote(dst, true); try { thumbCache.clear(); } catch (_) {}
    if (created) S.collapsed && S.collapsed.delete && S.collapsed.delete(dst.notebookId);
    buildPages(); try { renderAll(); } catch (_) { renderSidebar(); }
    const nbName = (S.notebooks.find(b => b.id === dst.notebookId) || {}).name || '';
    const undo = () => {
      const k = dst.pages.indexOf(pg); if (k < 0) return; dst.pages.splice(k, 1); pg.paper = paperWas;
      if (src.pages.length === 1 && !src.pages[0].strokes.length && !src.pages[0].texts.length && pi === 0 && src.pages[0] !== pg) src.pages = [];
      src.pages.splice(Math.min(pi, src.pages.length), 0, pg); relink(dst.id, src.id, pg.id);
      if (created) { S.notes = S.notes.filter(x => x !== dst); try { DB.del('notes', dst.id); } catch (_) {} } else saveNote(dst, true);
      saveNote(src, true); if (S.cur !== src.id) openNote(src.id); buildPages(); try { renderAll(); } catch (_) {}
      toast('Page moved back', 1200);
    };
    actionToast(created ? `📄 Page moved to ${nbName} — new note “${dst.title}”` : `📄 Page moved to the end of “${dst.title}” (${nbName})`, 'Undo', undo, 6000);
    return { dst: dst.id, created, links };
  }

  /* ==================== boot ==================== */
  function boot() { cleanBoards(); slimInsert(); slimLasso(); ensureHooks(); try { renderSidebar(); } catch (_) {} }
  boot();
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  const t0 = Date.now(), iv = setInterval(() => { if (window.__ready || Date.now() - t0 > 8000) { clearInterval(iv); boot(); } }, 100);

  window.V21eg = { version: 'v21eg', openCalc, closeCalc, movePageTo, setReader(fn) { C.reader = fn; }, calcState: C, writeOnPage, boot };
})();
