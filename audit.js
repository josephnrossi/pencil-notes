/* v18 — streamline & harden (red-team audit).
   One ＋ Insert menu, one grouped Settings screen, a Gestures sheet, a short first-run tour,
   Undo for every delete, a safe importer, storage-full handling and lock hardening.
   Nothing is removed — features are only reached through fewer, more consistent doors. */
const APP_VERSION = 'v21';

/* ---------- import sanitizer: hostile backups must not inject markup ----------
   Rendering escapes free text, but ids/enums/colors are interpolated into attributes, so they are
   normalised here, at the only door untrusted note data comes in through. */
const SAFE_DATA_URL = /^data:[\w.+-]+\/[\w.+-]+(;[\w.+-]+=[\w.+-]+)*;base64,[A-Za-z0-9+/=\s]*$/;
const STRUCT_KEY = /^(id|\w*Id|\w*_id|ids|col|rec|asset|assets|stub|sp|t|prio|level|kind|type|mime|mode|repeat|sort|w|h|x|y|dur|start|end|due|lane|status|bg|name_key|tool|paper|engine_id)$/;
const COLOR_KEY = /^(c|color|lc|hlColor|penColor|bgColor)$/;
const URLISH_KEY = /^(ink|thumb|src|data|png|img)$/;
function sanitizeImport(v, key = '', st = { fixed: 0 }) {
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = sanitizeImport(v[i], key, st); return v; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') { delete v[k]; st.fixed++; continue; } v[k] = sanitizeImport(v[k], k, st); } return v; }
  if (typeof v !== 'string') return v;
  if (URLISH_KEY.test(key)) { if (v === '' || SAFE_DATA_URL.test(v)) return v; st.fixed++; return ''; }
  if (COLOR_KEY.test(key)) { if (/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20})$/.test(v)) return v; st.fixed++; return '#2563eb'; }
  if (STRUCT_KEY.test(key)) { const c = v.replace(/["'<>`\\]/g, ''); if (c !== v) st.fixed++; return c; }
  return v;
}
function validNote(n) { return n && typeof n === 'object' && typeof n.id === 'string' && n.id && Array.isArray(n.pages) && n.pages.every(p => p && typeof p === 'object'); }
const okPt = q => Array.isArray(q) && q.length >= 2 && q.every(v => typeof v === 'number' && isFinite(v));
function normPage(p) { for (const k of ['strokes', 'texts', 'tasks', 'images', 'labels', 'sections']) p[k] = Array.isArray(p[k]) ? p[k].filter(o => o && typeof o === 'object') : [];
  p.strokes = p.strokes.filter(st => Array.isArray(st.points) && st.points.length && st.points.every(okPt));   /* a malformed stroke used to crash the whole note */
  if (!('bg' in p)) p.bg = null; if (!('paper' in p)) p.paper = null; if (!p.id) p.id = uid('p'); return p; }

/* ---------- safe import: validate, newer-wins merge, assets before anything is cleared ---------- */
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); }
  catch (_) { return actionSheet('That file can’t be read', [{ label: 'It isn’t valid JSON — choose a “pencil-notes-backup-….json” file made with Export backup', fn: () => {} }]); }
  if (!data || data.app !== 'inkminder' || !Array.isArray(data.notes)) return actionSheet('Not a Pencil Notes backup', [{ label: 'Choose a file made with ⚙︎ Settings → Export backup (pencil-notes-backup-….json)', fn: () => {} }]);
  const st = { fixed: 0 }; sanitizeImport(data, '', st);
  const notes = data.notes.filter(validNote), bad = data.notes.length - notes.length;
  const nbs = (Array.isArray(data.notebooks) ? data.notebooks : []).filter(b => b && typeof b.id === 'string' && b.id).map(b => ({ ...b, name: String(b.name || 'Notebook') }));
  const assets = (Array.isArray(data.assets) ? data.assets : []).filter(a => a && typeof a.id === 'string' && SAFE_DATA_URL.test(a.data || ''));
  const badA = (data.assets || []).length - assets.length;
  for (const n of notes) { n.reminders = Array.isArray(n.reminders) ? n.reminders : []; n.pages.forEach(normPage); n.title = String(n.title ?? 'Untitled'); }
  const run = async replace => {
    try {
      const local = new Map(S.notes.map(n => [n.id, n])); let kept = 0;
      const incoming = replace ? notes : notes.filter(n => { const l = local.get(n.id); if (l && (+l.updatedAt || 0) > (+n.updatedAt || 0)) { kept++; return false; } return true; });
      const keepIds = new Set(); if (!replace) for (const n of S.notes) if (!incoming.find(x => x.id === n.id)) { noteAssetIds(n).forEach(i => keepIds.add(i)); ((n.lock && n.lock.assets) || []).forEach(i => keepIds.add(i)); }
      await importAssets(assets.filter(a => !keepIds.has(a.id)));          // 1. assets first — nothing has been removed yet
      if (replace) { flushSaves(); await DB.clear('notes'); await DB.clear('notebooks'); S.notes = []; S.notebooks = []; }
      for (const nb of nbs) { S.notebooks = S.notebooks.filter(x => x.id !== nb.id).concat(nb); await saveNotebook(nb); }
      for (const n of incoming) { S.notes = S.notes.filter(x => x.id !== n.id).concat(n); await DB.put('notes', n); }
      if (!S.notebooks.length) { const nb = { id: uid('nb'), name: 'Notebook', order: 0 }; S.notebooks.push(nb); await saveNotebook(nb); }
      for (const n of S.notes) if (!['quoteboard', 'ideaboard', 'inbox'].includes(n.id) && !S.notebooks.find(b => b.id === n.notebookId)) { n.notebookId = S.notebooks[0].id; DB.put('notes', n); }
      normalizeOrder(); if (!S.notes.some(n => !['quoteboard', 'ideaboard', 'inbox'].includes(n.id))) createNote(S.notebooks[0].id);
      openNote((curNote() || S.notes.find(n => !['quoteboard', 'ideaboard', 'inbox'].includes(n.id))).id); renderAll();
      const extra = [kept && `kept ${kept} newer on this iPad`, bad && `skipped ${bad} damaged`, badA && `skipped ${badA} unsafe attachment${badA > 1 ? 's' : ''}`, st.fixed && `cleaned ${st.fixed} unsafe value${st.fixed > 1 ? 's' : ''}`].filter(Boolean);
      toast(`Imported ${incoming.length} note${incoming.length === 1 ? '' : 's'}` + (extra.length ? ' · ' + extra.join(' · ') : ''), 5000);
    } catch (err) { console.error(err); toast('Import stopped: ' + (err && err.message || err) + (replace ? '' : ' — your notes were not changed'), 6000); }
  };
  const mine = S.notes.filter(n => !n.system).length, nIn = notes.filter(n => !n.system).length;
  actionSheet(`Import ${nIn} note${nIn === 1 ? '' : 's'}?` + (bad ? ` (${bad} damaged will be skipped)` : ''), [
    { label: 'Merge — keep whichever copy is newer', primary: true, fn: () => run(false) },
    { label: `Replace everything — deletes your ${mine} current note${mine === 1 ? '' : 's'}`, danger: true, fn: () => actionSheet('Replace all notes on this iPad?', [
      { label: '⬇︎ Export my current notes first', fn: () => $('#exportBtn').click() },
      { label: 'Replace now', danger: true, fn: () => run(true) }]) }]);
};

/* ---------- Undo for every delete ---------- */
function recOn(noteId) { return typeof R !== 'undefined' && R.active && R.active.noteId === noteId; }
deleteNote = async function (n) {
  if (recOn(n.id)) await recStop('deleted');
  flushSaves(); const wasCur = S.cur === n.id;
  S.notes = S.notes.filter(x => x !== n); await DB.del('notes', n.id);
  if (wasCur) { const next = S.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (next) openNote(next.id); else createNote(n.notebookId); }
  renderAll();
  actionToast(`Deleted “${n.title || 'Untitled'}”`, 'Undo', async () => {
    if (!S.notebooks.find(b => b.id === n.notebookId)) n.notebookId = S.notebooks[0].id;
    S.notes.push(n); await DB.put('notes', n); normalizeOrder(); openNote(n.id); renderAll(); toast('Note restored');
  }, 8000);
};
deleteNotebook = async function (nb) {
  if (S.notebooks.length === 1) { toast('You need at least one notebook — rename it instead'); return; }
  const gone = S.notes.filter(x => x.notebookId === nb.id);
  const go = async () => {
    for (const n of gone) { if (recOn(n.id)) await recStop('deleted'); }
    flushSaves(); for (const n of gone) await DB.del('notes', n.id);
    S.notes = S.notes.filter(x => x.notebookId !== nb.id); S.notebooks = S.notebooks.filter(b => b !== nb); await DB.del('notebooks', nb.id);
    if (!curNote()) { if (S.notes.length) openNote(S.notes[0].id); else createNote(S.notebooks[0].id); }
    renderAll();
    actionToast(`Deleted notebook “${nb.name}”` + (gone.length ? ` and ${gone.length} note${gone.length > 1 ? 's' : ''}` : ''), 'Undo', async () => {
      S.notebooks.push(nb); await saveNotebook(nb); for (const n of gone) { S.notes.push(n); await DB.put('notes', n); }
      normalizeOrder(); renderAll(); toast('Notebook restored');
    }, 8000);
  };
  if (!gone.length) return go();
  actionSheet(`Delete “${nb.name}” and its ${gone.length} note${gone.length > 1 ? 's' : ''}?`, [{ label: `Delete notebook and ${gone.length} note${gone.length > 1 ? 's' : ''}`, danger: true, fn: go }]);
};
deleteItem = function (it) {
  const n = it.note, pg = it.type === 'note' ? null : n.pages[it.page];
  const arr = it.type === 'note' ? n.reminders : pg.tasks, idx = arr.indexOf(it.obj), title = itemTitle(it);
  if (it.type === 'note') n.reminders = n.reminders.filter(r => r !== it.obj);
  else { if (n.id === S.cur) pushHistory(); pg.tasks = pg.tasks.filter(t => t !== it.obj); }
  saveNote(n, true); renderAll();
  actionToast(`Deleted “${title}”`, 'Undo', () => {
    const a = it.type === 'note' ? n.reminders : (n.pages.includes(pg) ? pg.tasks : null); if (!a) return toast('That page is gone — can’t restore');
    a.splice(Math.min(idx, a.length), 0, it.obj); saveNote(n, true); if (n.id === S.cur) buildPages(); renderAll();
  });
};

/* ---------- Pencil Lock hardening ---------- */
function sealedId(id) { const o = S.notes.find(x => x.id === id); return !!(o && o.lock && !(LK.open && LK.open.has(id))); }
function touchesSealed(e) { if (!e.startsWith('M:')) return false; try { return Object.keys(JSON.parse(e.slice(2)).others || {}).some(sealedId); } catch (_) { return true; } }
function scrubAfterLock() {
  clip = null; const lp = $('#lassoPaste'); if (lp) lp.hidden = true;          // lasso clipboard could carry ink out of a locked note
  S.undo = S.undo.filter(e => !touchesSealed(e)); S.redo = S.redo.filter(e => !touchesSealed(e)); updateUndo();
}
{ const _lock = lockNote; lockNote = async function (...a) { const r = await _lock.apply(this, a); scrubAfterLock(); return r; }; if (window.PencilLock) PencilLock.lockNote = lockNote;
  const _rel = relockAll; relockAll = async function (...a) { const r = await _rel.apply(this, a); scrubAfterLock(); return r; }; }
{ const _restore = restore; restore = function (from, to) {
    // an undo step that spans another note must never write plaintext pages into a note that has since been locked
    while (from.length && touchesSealed(from[from.length - 1])) { from.pop(); toast('Skipped an undo step that touches a locked note'); }
    return _restore(from, to);
  }; }

/* ---------- saving: storage-full & failure messages, persistent storage ---------- */
let saveBad = new Set();
function saveFailed(err, note) {
  if (note) saveBad.add(note.id);
  const full = err && (err.name === 'QuotaExceededError' || /quota|space|full/i.test(err.message || ''));
  let b = document.getElementById('saveWarn');
  if (!b) { b = document.createElement('div'); b.id = 'saveWarn'; b.setAttribute('role', 'alert'); document.body.append(b); }
  b.innerHTML = `<span>${full ? '⚠️ Storage is full — your latest changes are <b>not saved</b>. Export a backup, then delete big PDFs or recordings.' : '⚠️ Couldn’t save your latest changes (' + esc(err && err.message || err) + ').'}</span>
    <button class="btn small" data-sw="retry">Try again</button><button class="btn small" data-sw="storage">Storage…</button>`;
  b.hidden = false;
  b.onclick = ev => { const a = ev.target.closest('[data-sw]'); if (!a) return; if (a.dataset.sw === 'retry') retrySaves(); else openSettings('storage'); };
}
async function retrySaves() {
  const ids = [...saveBad]; saveBad = new Set();
  for (const id of ids) { const n = S.notes.find(x => x.id === id); if (n) { try { await DB.put('notes', n); } catch (e) { saveFailed(e, n); return; } } }
  const b = document.getElementById('saveWarn'); if (b) b.hidden = true; toast('Saved ✓');
}
function saveOk(note) { if (saveBad.has(note.id)) { saveBad.delete(note.id); if (!saveBad.size) { const b = document.getElementById('saveWarn'); if (b) b.hidden = true; } } }
async function storageInfo() {
  const s = navigator.storage; let used = 0, quota = 0, persisted = false;
  try { if (s && s.estimate) ({ usage: used = 0, quota = 0 } = await s.estimate()); if (s && s.persisted) persisted = await s.persisted(); } catch (_) {}
  return { used, quota, persisted };
}
const fmtMB = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB';
async function askPersist(manual) {
  const s = navigator.storage; if (!s || !s.persist) { if (manual) toast('This browser doesn’t offer persistent storage — keep regular backups'); return false; }
  const ok = await s.persist().catch(() => false); localStorage.setItem('persistAsked', '1');
  if (manual) toast(ok ? 'Storage kept on this device ✓' : 'Safari decides this itself — adding Pencil Notes to the Home Screen helps; keep regular backups', 5000);
  return ok;
}
setTimeout(() => { if (!localStorage.getItem('persistAsked') && S.notes.length) askPersist(false); }, 4000);

/* ======================= UI: one ＋ Insert menu ======================= */
const INSERT_ITEMS = [
  { tool: 'task', ic: '☑️', l: 'Task', s: 'Tap the page to drop a checkbox' },
  { tool: 'section', ic: '1.', l: 'Number', s: 'Numbered section — tap the start of a line; drag the number to move the section' },
  { id: 'photoBtn', ic: '🖼', l: 'Photo', s: 'From Photos or the camera' },
  { id: 'stickerBtn', ic: '⭐', l: 'Sticker', s: 'Stars, arrows, tabs…' },
  { id: 'remindNoteBtn', ic: '⏰', l: 'Reminder', s: 'Remind me about this note' },
  { id: 'insRec', ic: '🎙', l: 'Recording', s: 'Record a meeting on this note', fn: () => recButton() },
  { id: 'insPage', ic: '📄', l: 'Page…', s: 'Lined, planner, board, assistant…', fn: () => addPage() },
  { id: 'insPdf', ic: '📑', l: 'PDF…', s: 'Import a PDF to write on', fn: () => { pdfTargetNb = curNote().notebookId; $('#pdfFile').click(); } },
];
function buildInsert() {
  const misc = $('#toolbar .group.misc');
  $('#toolbar .group.tools [data-tool="task"]')?.remove();   // v20: the 1. Number tool stays visible in the toolbar (and is in ＋ Insert too)
  const btn = document.createElement('button');
  Object.assign(btn, { id: 'insertBtn', className: 'ins-btn', title: 'Insert a task, section number, photo, sticker, reminder, recording, page or PDF' });
  btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); btn.innerHTML = '<b>＋</b><span>Insert</span>';
  misc.prepend(btn);
  const m = document.createElement('div'); m.id = 'insertMenu'; m.hidden = true; m.setAttribute('role', 'menu'); m.setAttribute('aria-label', 'Insert');
  for (const it of INSERT_ITEMS) {
    let b = it.id && document.getElementById(it.id);
    if (!b) { b = document.createElement('button'); if (it.id) b.id = it.id; }
    b.className = 'ins-item' + (it.tool ? ' tool' + (it.tool === 'task' ? ' task-tool' : '') : ''); if (it.tool) b.dataset.tool = it.tool;
    b.setAttribute('role', 'menuitem'); b.title = it.s; b.innerHTML = `<i>${it.ic}</i><span>${it.l}</span><small>${it.s}</small>`;
    if (it.fn) b.onclick = it.fn;
    m.append(b);
  }
  document.body.append(m);
  const close = () => { m.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    const r = btn.getBoundingClientRect(); m.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const w = m.offsetWidth; m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
  };
  btn.onclick = () => m.hidden ? open() : close();
  m.addEventListener('click', e => { const b = e.target.closest('.ins-item'); if (!b) return; close(); if (b.dataset.tool) selectTool(b.dataset.tool); }, true);
  document.addEventListener('pointerdown', e => { if (!m.hidden && !m.contains(e.target) && !btn.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) close(); });
}
buildInsert();
{ const _rt = renderToolbar; renderToolbar = function () {
    _rt(); const b = $('#insertBtn'); if (!b) return;
    const sub = INSERT_ITEMS.find(i => i.tool && i.tool === S.tool && !document.querySelector(`#toolbar .group.tools [data-tool="${i.tool}"]`));
    b.classList.toggle('on', !!sub); b.innerHTML = sub ? `<b>${sub.ic}</b><span>${sub.l.split(' ')[0]} ▾</span>` : '<b>＋</b><span>Insert</span>';
  }; renderToolbar(); }

/* line widths: one button showing the current width, tap for the others (keeps the toolbar on one iPad-portrait row) */
{ const wl = $('#widths');
  const closeW = () => { wl.classList.remove('open'); wl.style.left = wl.style.top = ''; };
  wl.addEventListener('click', e => {
    const b = e.target.closest('.wbtn'); if (!b) return;
    if (!wl.classList.contains('open')) { e.stopPropagation(); const r = wl.getBoundingClientRect(); wl.classList.add('open'); const n = wl.querySelectorAll('.wbtn').length;
      wl.style.left = Math.max(8, Math.min(innerWidth - n * 48 - 16, r.left - (n - 1) * 22)) + 'px'; wl.style.top = (r.bottom + 6) + 'px'; return; }
    setTimeout(closeW, 0);
  }, true);
  document.addEventListener('pointerdown', e => { if (wl.classList.contains('open') && !wl.contains(e.target)) closeW(); }, true);
  wl.title = 'Line width'; }
/* ☝️ Finger: a compact labelled toggle like the tools */
{ const _af = applyFingerMode; applyFingerMode = function () { _af(); const on = fingerDrawOn(), b = $('#fingerBtn');
    b.classList.add('tb-col'); b.innerHTML = `<b>☝️</b><span>${on ? 'Finger ✓' : 'Finger'}</span>`; b.setAttribute('aria-pressed', on); b.title = on ? 'Finger draws — two fingers scroll. Tap to let your finger scroll.' : 'Finger scrolls, Pencil writes. Tap to draw with your finger.'; };
  applyFingerMode(); }

/* ======================= UI: one Settings screen ======================= */
function settingsSections() {
  const ai = (typeof assistSettingsItems === 'function' ? assistSettingsItems() : []);
  const rec = ai.filter(i => /Recording/.test(i.label)), aiOnly = ai.filter(i => !rec.includes(i));
  const cfg = lockCfg(), finger = $('#fingerBtn').classList.contains('on');
  return [
    { id: 'appearance', h: 'Appearance', rows: [{ label: 'Appearance: ' + { dark: 'Dark', light: 'Light', system: 'Match iPad' }[themePref()] + '…', fn: themeMenu }] },
    { id: 'writing', h: 'Writing & Pencil', rows: [
      { label: '☝️ Draw with finger: ' + (finger ? 'On' : 'Off'), sub: 'Off = finger scrolls, Pencil writes (recommended)', fn: () => { $('#fingerBtn').click(); openSettings('writing'); } },
      { label: '✋ Gestures…', sub: 'Every swipe, hold and pinch on one screen', fn: gesturesSheet }] },
    { id: 'lock', h: 'Privacy & Pencil Lock', rows: [
      { label: cfg ? '🔒 Pencil Lock: set up again (new shape & PIN)…' : '🔒 Set up Pencil Lock…', fn: setupPencilLock },
      { label: '⏱ Auto-relock: ' + RELOCK_LABEL[relockPref()] + '…', fn: () => actionSheet('Auto-relock', Object.entries(RELOCK_LABEL).map(([k, l]) => ({ label: (relockPref() === k ? '✓ ' : '') + l, fn: () => localStorage.setItem('lockRelock', k) }))) }] },
    { id: 'ai', h: 'AI & Assistant', note: 'Your AI key stays on this iPad and is only sent to the provider you choose. It is never saved in notes or backups.', rows: aiOnly },
    { id: 'recording', h: 'Recording', rows: rec },
    { id: 'storage', h: 'Storage & backup', dyn: true, rows: [
      { label: '⬇︎ Export backup…', sub: 'Everything in one file. Locked notes stay encrypted.', fn: () => $('#exportBtn').click() },
      { label: '⬆︎ Import backup…', sub: 'Merge keeps whichever copy is newer', fn: () => $('#importBtn').click() },
      { label: '📌 Keep my notes on this device', sub: 'Asks Safari not to clear storage when space is low', fn: () => askPersist(true).then(() => openSettings('storage')) }] },
    { id: 'help', h: 'Help', rows: [
      { label: '✋ Gestures…', fn: gesturesSheet },
      { label: '👋 Show the quick tour', fn: () => startTour(true) }] },
  ];
}
async function openSettings(focus) {
  const w = modalWrap('settingsWrap');
  w.innerHTML = `<div class="sheet set-sheet" role="dialog" aria-modal="true" aria-label="Settings">
    <div class="set-head"><h3>Settings</h3><button class="icon-btn" data-set="close" aria-label="Close settings">✕</button></div>
    <div class="set-body">${settingsSections().filter(s => s.rows.length).map(s => `<section class="set-sec" data-sec="${s.id}"><h4>${esc(s.h)}</h4>
      ${s.dyn ? '<p class="fine set-usage">Checking storage…</p>' : ''}${s.note ? `<p class="fine">${esc(s.note)}</p>` : ''}
      ${s.rows.map((r, i) => `<button class="set-row" data-s="${s.id}" data-i="${i}"><span>${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span><b aria-hidden="true">›</b></button>`).join('')}</section>`).join('')}
      <p class="fine set-about">Pencil Notes ${APP_VERSION} · Your notes live on this iPad. Nothing is uploaded unless you use AI features or transcription.</p></div></div>`;
  w.hidden = false;
  const secs = settingsSections();
  w.onclick = e => {
    if (e.target === w || e.target.closest('[data-set="close"]')) { w.hidden = true; return; }
    const r = e.target.closest('.set-row'); if (!r) return;
    const row = secs.find(s => s.id === r.dataset.s).rows[+r.dataset.i]; w.hidden = true; row.fn && row.fn();
  };
  const info = await storageInfo(), u = w.querySelector('.set-usage');
  if (u) u.textContent = (info.quota ? `Using ${fmtMB(info.used)} of about ${fmtMB(info.quota)}` : 'Storage size unknown') + ' · ' + (info.persisted ? 'kept on this device ✓' : 'Safari may clear it if the iPad runs low on space — keep backups');
  if (focus) w.querySelector(`[data-sec="${focus}"]`)?.scrollIntoView({ block: 'start' });
}
settingsMenu = openSettings;
$('#settingsBtn').onclick = () => openSettings();

/* ======================= UI: Gestures sheet ======================= */
const GESTURES = [
  ['Writing', [['✏️', 'Pencil', 'writes · finger scrolls (turn on ☝️ Finger to draw with a finger)'], ['🤏', 'Two fingers', 'pan · pinch to zoom · tap the % chip to reset'], ['➰', 'Lasso', 'circle ink, photos or stickers → drag to move, corner to resize, ↻ to rotate']]],
  ['Lists, boards & reminders', [['👉', 'Swipe right', 'done'], ['👈', 'Swipe left', 'more actions · swipe all the way to delete (Undo)'], ['✋', 'Hold the ⠿ grip / card header', 'drag to move'], ['⬇️', 'Pull down a board column', 'new card'], ['🤏', 'Pinch a board', 'compact view']]],
  ['Recordings', [['👆', 'Tap ink (▶ Replay on)', 'jump the audio to when you wrote it'], ['🎚', 'Drag the scrubber', 'seek · tap 1× to change speed']]],
  ['Everywhere', [['↶ ↷', 'Undo / Redo', 'top bar · every delete also offers Undo'], ['⋯', 'Note options', 'paper, pages, PDF, rename, move']]],
];
function gesturesSheet() {
  const w = modalWrap('gestWrap');
  w.innerHTML = `<div class="sheet gest-sheet" role="dialog" aria-modal="true" aria-label="Gestures"><div class="set-head"><h3>✋ Gestures</h3><button class="icon-btn" data-g="close" aria-label="Close">✕</button></div>
    ${GESTURES.map(([h, rows]) => `<h4>${h}</h4><div class="g-grid">${rows.map(([i, g, d]) => `<div class="g-row"><i>${i}</i><b>${g}</b><span>${d}</span></div>`).join('')}</div>`).join('')}</div>`;
  w.hidden = false; w.onclick = e => { if (e.target === w || e.target.closest('[data-g="close"]')) w.hidden = true; };
}

/* ======================= UI: short first-run tour ======================= */
const TOUR = [
  ['#toolbar .group.tools', 'Write', 'Pen, highlighter, eraser, lasso and text. Your Pencil writes; your finger scrolls.'],
  ['#insertBtn', '＋ Insert', 'Tasks, section numbers, photos, stickers, reminders, recordings, pages and PDFs live here.'],
  ['#recBtn', '🎙 Record a meeting', 'Captions while you write, then a summary with decisions, action items and next steps.'],
  ['#togglePanel', '🔔 Reminders & tasks', 'Everything that’s due, from every note. Swipe right for done.'],
  ['#toggleSidebar', '☰ Notes & Settings', 'Notebooks, search, backup and ⚙︎ Settings (including ✋ Gestures).'],
];
function startTour(force) {
  if (!force && (localStorage.getItem('tourDone') || navigator.webdriver)) return;
  let i = 0; const w = modalWrap('tourWrap'); w.classList.add('tour-wrap');
  const done = () => { w.hidden = true; localStorage.setItem('tourDone', '1'); };
  const show = () => {
    const [sel, h, p] = TOUR[i], el = document.querySelector(sel), r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: 80, width: 0, height: 0, bottom: 80 };
    const top = Math.min(innerHeight - 230, r.bottom + 14), left = Math.max(12, Math.min(innerWidth - 352, r.left + r.width / 2 - 170));
    w.innerHTML = `<div class="tour-hole" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>
      <div class="tour-card" role="dialog" aria-label="Quick tour" style="left:${left}px;top:${top}px"><small>${i + 1} of ${TOUR.length}</small><h3>${h}</h3><p>${p}</p>
      <div class="sheet-actions"><button class="btn" data-t="skip">Skip tour</button><div class="spacer"></div>${i ? '<button class="btn" data-t="back">Back</button>' : ''}<button class="btn primary" data-t="next">${i === TOUR.length - 1 ? 'Done' : 'Next'}</button></div></div>`;
  };
  w.onclick = e => { const a = e.target.closest('[data-t]'); if (!a) return; if (a.dataset.t === 'skip') return done(); if (a.dataset.t === 'back') i--; else if (++i >= TOUR.length) return done(); show(); };
  w.hidden = false; show();
}
setTimeout(() => startTour(new URLSearchParams(location.search).has('tour')), 900);

/* ======================= gestures: unify swipe-left in Reminders ======================= */
// Board cards: swipe left = delete (Undo). Reminders rows now match: a short swipe reveals Snooze/Delete,
// a full swipe deletes with Undo.
{ let fs = null; const RLs = $('#reminderList'), FULL = 300;
  RLs.addEventListener('pointerdown', e => { const row = e.target.closest('.ritem'); fs = row && !e.target.closest('.ractions') ? { row, pid: e.pointerId, x: e.clientX, y: e.clientY, base: row.style.transform.includes('-') ? -ACT_W : 0, dx: 0 } : null; }, true);
  window.addEventListener('pointermove', e => { if (!fs || e.pointerId !== fs.pid) return; fs.dx = e.clientX - fs.x; fs.row.parentElement.classList.toggle('armed-del', fs.base + fs.dx < -FULL && Math.abs(fs.dx) > Math.abs(e.clientY - fs.y)); }, { passive: true });
  window.addEventListener('pointerup', e => {
    if (!fs || e.pointerId !== fs.pid) return; const s = fs; fs = null; const wrap = s.row.parentElement; wrap.classList.remove('armed-del');
    if (s.base + s.dx < -FULL) { const it = itemById(s.row.dataset.id); setTimeout(() => { closeSwipe(s.row, true); if (it) deleteItem(it); }, 30); }
  }, true);
}
