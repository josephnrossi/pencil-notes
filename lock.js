/* Pencil Notes v21ej — numeric-code locks; AES-GCM note/asset encryption and PBKDF2 wrapping retained. */
const LOCKED_TITLE = 'Locked note', LOCKED_REM = 'Locked note reminder', PIN_ITER = 310000, MAX_FAILS = 5;
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const subtle = crypto.subtle;

/* ---- device key store (separate IndexedDB: CryptoKeys are stored as non-extractable objects) ---- */
const LockDB = (() => {
  let dbp; const open = () => dbp ||= new Promise((res, rej) => { const r = indexedDB.open('pencil-lock', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const run = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('keys', mode), q = fn(t.objectStore('keys')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: k => run('readonly', s => s.get(k)), put: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k)), clear: () => run('readwrite', s => s.clear()) };
})();

const lockCfg = () => { try { return JSON.parse(localStorage.getItem('pencilLock') || 'null'); } catch (_) { return null; } };
async function pinKek(pin, salt, iter, store = false) {
  const base = await subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: typeof salt === 'string' ? unb64(salt) : salt, iterations: iter }, base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
const gcm = (iv, aad) => ({ name: 'AES-GCM', iv, additionalData: te.encode(aad) });

/* ---- sessions: notes unlocked in this tab keep their (non-extractable) DK in memory only ---- */
const LK = { open: new Map(), assetKeys: new Map(), q: new Map(), armed: null, g: null, strokes: [], timer: 0, busy: false, anim: null, lastAct: Date.now() };
const isSealed = n => !!(n && n.lock && !LK.open.has(n.id));
const isLockedOpen = n => !!(n && n.lock && LK.open.has(n.id));
const lockChain = (id, fn) => { const p = (LK.q.get(id) || Promise.resolve()).then(fn, fn); LK.q.set(id, p.catch(() => {})); return p; };
const noteAssetIds = n => { const s = new Set(); for (const pg of n.pages || []) { for (const id of pageAssetIds(pg)) s.add(id); if (pg.bg && pg.bg.src) s.add(pg.bg.src); } return [...s]; };

function reminderStubs(n) {   // what notifications & Today may know about a locked note: times only
  const out = [], add = o => { if (o.due) out.push({ id: o.id, title: LOCKED_REM, due: o.due, repeat: o.repeat || '', done: !!o.done, doneAt: o.doneAt || null, notified: !!o.notified, createdAt: o.createdAt || 0, lockStub: 1 }); };
  for (const r of n.reminders || []) add(r);
  for (const pg of n.pages || []) for (const t of pg.tasks || []) if (!t.done) add(t);
  return out;
}
// Build the at-rest (sealed) form of an unlocked note. The plaintext snapshot is taken synchronously.
async function sealNote(n, dk) {
  const payload = JSON.stringify({ title: n.title, paper: n.paper, pages: n.pages, reminders: n.reminders });
  const stubs = reminderStubs(n), iv = rand(12);
  const meta = {}; for (const k of ['id', 'notebookId', 'order', 'createdAt', 'updatedAt', 'v']) if (k in n) meta[k] = n[k];
  const ct = await subtle.encrypt(gcm(iv, 'note:' + n.id), dk, te.encode(payload));
  const stub = { ...newPage(), id: n.lock.stub };
  return { ...meta, title: LOCKED_TITLE, paper: 'lined', pages: [stub], reminders: stubs, lock: { ...n.lock, iv: b64(iv), ct: b64(ct), len: payload.length } };
}
function applySealed(n, sealed) { for (const k of Object.keys(n)) delete n[k]; Object.assign(n, sealed); }

// every write of an unlocked locked-note goes to IndexedDB sealed (plaintext never hits storage)
const rawPut = DB.put;
DB.put = (store, obj) => {
  if (store === 'notes' && obj && obj.lock) return lockChain(obj.id, async () => rawPut(store, LK.open.has(obj.id) ? await sealNote(obj, LK.open.get(obj.id).dk) : obj));
  return rawPut(store, obj);
};
async function sealedNotesForExport() { flushSaves(); const out = []; for (const n of S.notes) out.push(isLockedOpen(n) ? await sealNote(n, LK.open.get(n.id).dk) : n); return out; }

/* ---- attachments ---- */
async function encryptAssets(n, dk) {
  const ids = noteAssetIds(n), others = S.notes.filter(x => x !== n), usedElsewhere = id => others.some(o => noteAssetIds(o).includes(id) || (o.lock && (o.lock.assets || []).includes(id)));
  const final = [];
  for (let id of ids) {
    let r = await DB.get('assets', id); if (!r) continue;
    if (r.enc && (n.lock.assets || []).includes(id)) { final.push(id); continue; }
    if (usedElsewhere(id) || r.enc) {   // shared with another note → give this note its own encrypted copy
      const nid = uid('a'); for (const pg of n.pages) { if (pg.bg && pg.bg.asset === id) pg.bg.asset = nid; if (pg.bg && pg.bg.src === id) pg.bg.src = nid; for (const im of pg.images || []) if (im.asset === id) im.asset = nid; }
      if (r.enc) r = { ...r, data: await (await Assets.blob(id)).arrayBuffer(), enc: null }; id = nid;
    }
    const iv = rand(12), ct = await subtle.encrypt(gcm(iv, 'asset:' + id), dk, r.data || await r.blob.arrayBuffer());
    await rawPut('assets', { id, data: ct, type: 'application/octet-stream', size: ct.byteLength, createdAt: r.createdAt, enc: { iv: b64(iv), type: r.type } });
    Assets.bitmaps.delete(id); final.push(id);
  }
  return final;
}
const _assetBlob = Assets.blob.bind(Assets);
Assets.blob = async function (id) {
  const r = await DB.get('assets', id); if (!r) return null;
  if (!r.enc) return r.blob || new Blob([r.data], { type: r.type });
  const k = LK.assetKeys.get(id); if (!k) return null;          // locked: no plaintext
  const pt = await subtle.decrypt(gcm(unb64(r.enc.iv), 'asset:' + id), k, r.data);
  return new Blob([pt], { type: r.enc.type });
};
exportAssets = async function (notes) {   // locked notes' files are exported as ciphertext
  const ids = new Set(); for (const n of notes) { for (const id of noteAssetIds(n)) ids.add(id); for (const id of (n.lock && n.lock.assets) || []) ids.add(id); }
  const out = [];
  for (const id of ids) {
    const r = await DB.get('assets', id); if (!r) continue;
    if (r.enc) out.push({ id, type: 'application/octet-stream', enc: r.enc, data: await blobToDataURL(new Blob([r.data])) });
    else { const b = await Assets.blob(id); if (b) out.push({ id, type: b.type, data: await blobToDataURL(b) }); }
  }
  return out;
};
const _importAssets = importAssets;
importAssets = async function (list) {
  const plain = [];
  for (const a of list || []) { if (!/^data:/.test(a.data || '')) continue; if (!a.enc) { plain.push(a); continue; } const data = await (await (await fetch(a.data)).blob()).arrayBuffer(); await rawPut('assets', { id: a.id, data, type: 'application/octet-stream', size: data.byteLength, createdAt: Date.now(), enc: a.enc }); Assets.bitmaps.delete(a.id); }
  return _importAssets(plain);
};

/* ---- lock / unlock ---- */
async function lockNote(n, { animate = true } = {}) {
  if (!n || isSealed(n) || LK.busy) return false;
  LK.busy = true;
  try {
    let dk;
    if (isLockedOpen(n)) dk = LK.open.get(n.id).dk;
    else {
      const cfg = lockCfg(); if (!cfg) { setupPencilLock(); return false; }
      let kek = await LockDB.get('pinkek');
      if (!kek) { const pin = await pinPrompt('Enter your 5-digit code', 'This device needs your code once to lock notes.'); if (!pin) return false; kek = await pinKek(pin, cfg.salt, cfg.iter); if (!(await checkPin(kek, cfg))) { toast('Wrong PIN'); return false; } await LockDB.put('pinkek', kek); }
      const dkx = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const w = await subtle.wrapKey('raw', dkx, kek, 'AES-KW'), raw = await subtle.exportKey('raw', dkx);
      dk = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); new Uint8Array(raw).fill(0);
      await LockDB.del('dk:' + n.id);
      n.lock = { v: 1, alg: 'AES-GCM-256', kdf: 'PBKDF2-SHA256', pin: { salt: cfg.salt, iter: cfg.iter, w: b64(w) }, stub: uid('p'), assets: [], lockedAt: Date.now() };
    }
    clearTimeout(saveTimers.get(n.id)); saveTimers.delete(n.id);
    n.lock.assets = await encryptAssets(n, dk);
    if (animate && n.id === S.cur) await lockAnim('hide');
    const sealed = await sealNote(n, dk);
    await lockChain(n.id, () => rawPut('notes', sealed));
    for (const id of n.lock.assets) { LK.assetKeys.delete(id); Assets.bitmaps.delete(id); }
    LK.open.delete(n.id); applySealed(n, sealed); thumbCache.clear();
    if (n.id === S.cur) { S.undo = []; S.redo = []; updateUndo(); hideLasso && hideLasso(); LK.anim = animate ? { kind: 'in', t0: performance.now() } : null; buildPages(); }
    renderAll();
    return true;
  } finally { LK.busy = false; }
}
async function unlockWith(n, dk, { animate = true } = {}) {
  let payload;
  try { payload = JSON.parse(td.decode(await subtle.decrypt(gcm(unb64(n.lock.iv), 'note:' + n.id), dk, unb64(n.lock.ct)))); }
  catch (_) { toast('This note could not be decrypted'); return false; }
  if (animate && n.id === S.cur) { LK.anim = { kind: 'out', t0: performance.now() }; await new Promise(r => setTimeout(r, 620)); }
  // reminder state that changed while locked (fired / done / snoozed) flows back into the real items
  const st = new Map((n.reminders || []).filter(r => r.lockStub).map(r => [r.id, r]));
  const sync = o => { const s = st.get(o.id); if (s) { o.due = s.due; o.done = s.done; o.doneAt = s.doneAt; o.notified = s.notified; } };
  (payload.reminders || []).forEach(sync); for (const pg of payload.pages) (pg.tasks || []).forEach(sync);
  const lock = { ...n.lock }; delete lock.ct; delete lock.iv;
  n.title = payload.title; n.paper = payload.paper; n.pages = payload.pages; n.reminders = payload.reminders || []; n.lock = lock;
  LK.open.set(n.id, { dk, at: Date.now() }); for (const id of lock.assets || []) { LK.assetKeys.set(id, dk); Assets.bitmaps.delete(id); }
  localStorage.removeItem('lockFails'); LK.lastAct = Date.now(); LK.anim = null; thumbCache.clear();
  if (n.id === S.cur) { S.undo = []; S.redo = []; updateUndo(); buildPages(); if (animate) { const p = $('#pages'); p.classList.remove('lock-reveal'); void p.offsetWidth; p.classList.add('lock-reveal'); setTimeout(() => p.classList.remove('lock-reveal'), 900); } }
  renderAll(); toast('🔓 Unlocked', 1400);
  return true;
}
async function unlockWithPin(n, pin) {
  try {
    const kek = await pinKek(pin, n.lock.pin.salt, n.lock.pin.iter);
    const dk = await subtle.unwrapKey('raw', unb64(n.lock.pin.w), kek, 'AES-KW', 'AES-GCM', false, ['encrypt', 'decrypt']);
    await LockDB.del('dk:' + n.id);                         // no persistent shape-unlock data key
    const cfg = lockCfg(); if (cfg && cfg.salt === n.lock.pin.salt && !(await LockDB.get('pinkek'))) await LockDB.put('pinkek', kek);
    return unlockWith(n, dk);
  } catch (_) { return false; }
}
async function removeLock(n) {
  if (!isLockedOpen(n)) return;
  const dk = LK.open.get(n.id).dk;
  for (const id of n.lock.assets || []) { const b = await Assets.blob(id); if (b) await rawPut('assets', { id, data: await b.arrayBuffer(), type: b.type, size: b.size, createdAt: Date.now() }); LK.assetKeys.delete(id); }
  delete n.lock; LK.open.delete(n.id); await LockDB.del('dk:' + n.id);
  await lockChain(n.id, () => rawPut('notes', n)); renderAll(); syncLockUI(); toast('Lock removed — this note is stored unencrypted again');
}
async function checkPin(kek, cfg) {
  try { const k = await subtle.unwrapKey('raw', unb64(cfg.check.w), kek, 'AES-KW', 'AES-GCM', false, ['decrypt']); await subtle.decrypt(gcm(unb64(cfg.check.iv), 'pin-check'), k, unb64(cfg.check.ct)); return true; } catch (_) { return false; }
}

/* ---- auto-relock ---- */
const relockPref = () => localStorage.getItem('lockRelock') || 'leave';     // 'leave' | '1' | '5' | '15' | 'never'
const RELOCK_LABEL = { leave: 'When I leave the note', 1: 'After 1 minute', 5: 'After 5 minutes', 15: 'After 15 minutes', never: 'Only when I lock it' };
function relockAll(filter = () => true) { for (const n of S.notes) if (isLockedOpen(n) && filter(n)) lockNote(n, { animate: n.id === S.cur }); }
const _openNote = openNote;
openNote = function (id) { const prev = S.cur; LK.armed = null; _openNote(id); if (prev && prev !== id && relockPref() !== 'never') { const p = S.notes.find(n => n.id === prev); if (isLockedOpen(p) && relockPref() === 'leave') lockNote(p, { animate: false }); } syncLockUI(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && relockPref() === 'leave') relockAll(); });
['pointerdown', 'keydown'].forEach(t => window.addEventListener(t, () => { LK.lastAct = Date.now(); }, true));
function relockTick() { const m = +relockPref(); if (m && Date.now() - LK.lastAct > m * 60000) relockAll(); }
setInterval(relockTick, 10000);

/* ---- UI: lock bar, toolbar state ---- */
function lockBar() {
  let b = document.getElementById('lockBar');
  if (!b) { b = document.createElement('div'); b.id = 'lockBar'; $('#main').append(b);
    b.onclick = e => { const a = e.target.closest('[data-l]'); if (!a) return; const n = curNote();
      if (a.dataset.l === 'pin') pinUnlockFlow(n); if (a.dataset.l === 'cancel') { LK.armed = null; syncLockUI();  } if (a.dataset.l === 'setup') setupPencilLock(); }; }
  return b;
}
function syncLockUI() {
  const n = curNote(), sealed = isSealed(n), armed = !!(n && LK.armed === n.id);
  document.body.classList.toggle('note-locked', sealed); document.body.classList.toggle('lock-armed', armed);
  $('#noteTitle').readOnly = sealed;
  const btn = $('#lockBtn'); if (btn) { btn.classList.toggle('on', sealed || isLockedOpen(n)); btn.textContent = sealed ? '🔒' : isLockedOpen(n) ? '🔓' : '🔒'; btn.setAttribute('aria-label', sealed ? 'Locked note' : isLockedOpen(n) ? 'Unlocked note — lock again' : 'Lock note'); }
  const b = lockBar(), cfg = lockCfg(), fails = +(localStorage.getItem('lockFails') || 0);
  b.hidden = !sealed && !armed; b.className = sealed ? 'locked' : 'arming';
  if (sealed) b.innerHTML = `<span class="lk-i">🔒</span><span class="lk-t">Locked · enter your code to open</span><button data-l="pin" class="primary">Unlock</button>`;

}
const _buildPages = buildPages;
buildPages = function () { _buildPages(); syncLockUI(); };
const _exportNotePdf = exportNotePdf;
exportNotePdf = async function (note = curNote()) { if (isSealed(note)) { toast('🔒 Unlock this note to export it as PDF'); return null; } return _exportNotePdf(note); };

/* ---- sealed note view: clear code lock, no drawing capture or shape/trail UI ---- */
const _v7OverlayHookLock = v7OverlayHook;
v7OverlayHook = function (pi) {
  _v7OverlayHookLock(pi);
  const n = curNote(), rec = pageEls[pi]; if (!rec || !isSealed(n)) return;
  rec.el.classList.add('locked-page');
  const card = document.createElement('div'); card.className = 'code-lock-card';
  card.innerHTML = '<div aria-hidden="true">🔒</div><h3>Locked</h3><p>Enter your code to open this note.</p><button class="btn primary">Unlock</button>';
  card.querySelector('button').onclick = () => { const nb = S.notebooks.find(b => b.id === n.notebookId); if (nb?.codeLock && window.V21ej) V21ej.unlockNotebook(nb); else pinUnlockFlow(n); };
  rec.ov.append(card);
};
async function lockAnim() {}

/* ---- sheets ---- */
function pinPrompt(title, sub = '', { confirm = false, legacy = false } = {}) {
  return new Promise(res => {
    const w = modalWrap('pinWrap');
    w.innerHTML = `<div class="sheet pin-sheet" role="dialog" aria-modal="true" aria-label="Code keypad"><h3>${esc(title)}</h3><p class="fine">${esc(sub)}</p>
      <input id="pinIn" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" ${legacy ? '' : 'maxlength="5"'} placeholder="${legacy ? 'Existing PIN' : '5 digits'}" aria-label="${legacy ? 'Existing PIN' : '5-digit code'}">
      <div class="code-keypad">${['1','2','3','4','5','6','7','8','9','Clear','0','⌫'].map(k => `<button class="btn" data-digit="${k}" type="button">${k}</button>`).join('')}</div>
      <p class="fine pin-err" hidden></p><div class="sheet-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${confirm ? 'Continue' : 'Unlock'}</button></div></div>`;
    w.hidden = false; const inp = w.querySelector('#pinIn'), err = w.querySelector('.pin-err');
    const done = v => { w.hidden = true; inp.value = ''; res(v); };
    const submit = () => { if (!(legacy ? /^\d+$/ : /^\d{5}$/).test(inp.value)) { err.hidden = false; err.textContent = legacy ? 'Enter your existing numeric PIN.' : 'Enter exactly 5 digits.'; return; } done(inp.value); };
    inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, legacy ? 64 : 5); };
    w.querySelectorAll('[data-digit]').forEach(b => b.onclick = () => { const d = b.dataset.digit; inp.value = d === 'Clear' ? '' : d === '⌫' ? inp.value.slice(0, -1) : (inp.value + d).slice(0, legacy ? 64 : 5); });
    w.querySelector('[data-x]').onclick = () => done(null); w.querySelector('[data-ok]').onclick = submit;
    inp.onkeydown = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') done(null); };
  });
}
async function pinUnlockFlow(n) {
  if (!isSealed(n)) return;
  const legacy = !lockCfg() || n.lock.pin.salt !== lockCfg().salt || lockCfg().v !== 2;
  for (let tries = 0; tries < 5; tries++) {
    const pin = await pinPrompt(tries ? 'Wrong code — try again' : legacy ? 'Unlock with your existing PIN' : 'Unlock note', legacy ? 'Use your previous PIN once. Then choose a 5-digit code.' : 'Enter your 5-digit code.', { legacy });
    if (pin === null) return false;
    if (await unlockWithPin(n, pin)) {
      // Old/imported locks remain recoverable even if they use a different historical PIN.
      if (legacy) {
        const cfg = lockCfg();
        if (!cfg || cfg.v !== 2) await setupPencilLock({ verifiedKek: cfg && cfg.salt === n.lock.pin.salt ? await pinKek(pin, cfg.salt, cfg.iter) : null });
        const current = lockCfg();
        if (current && current.v === 2 && n.lock.pin.salt !== current.salt) {
          const oldKek = await pinKek(pin, n.lock.pin.salt, n.lock.pin.iter); let newKek = await LockDB.get('pinkek');
          if (!newKek) {
            const code = await pinPrompt('Enter your current 5-digit code', 'Use your new code to migrate this older note.');
            if (code === null) return true;
            newKek = await pinKek(code, current.salt, current.iter);
            if (!(await checkPin(newKek, current))) { toast('Wrong code — older note keeps its existing PIN'); return true; }
            await LockDB.put('pinkek', newKek);
          }
          const dk = await subtle.unwrapKey('raw', unb64(n.lock.pin.w), oldKek, 'AES-KW', 'AES-GCM', true, ['encrypt','decrypt']);
          n.lock.pin = { salt: current.salt, iter: current.iter, w: b64(await subtle.wrapKey('raw', dk, newKek, 'AES-KW')) }; await DB.put('notes', n);
        }
      }
      return true;
    }
  }
  toast('Too many tries — try again later'); return false;
}
function lockMenu() {
  const n = curNote(); if (!n) return;
  if (isSealed(n)) return pinUnlockFlow(n);
  actionSheet('Note lock', [
    { label: '🔒 Lock note with 5-digit code', primary: true, fn: async () => { if ((!lockCfg() || lockCfg().v !== 2) && !(await setupPencilLock())) return; await lockNote(n); } },
    ...(isLockedOpen(n) && !S.notebooks.find(b => b.id === n.notebookId)?.codeLock ? [{ label: 'Remove note lock', fn: () => removeLock(n) }] : []),
    { label: 'Change 5-digit code…', fn: setupPencilLock }
  ]);
}
function settingsMenu() {
  if (typeof openSettings === 'function') return openSettings();
  const cfg = lockCfg();
  actionSheet('Settings', [
    { label: cfg ? '🔒 Change 5-digit code…' : '🔒 Set up 5-digit code…', fn: setupPencilLock },
    ...(typeof assistSettingsItems === 'function' ? assistSettingsItems() : []),
    { label: '⏱ Auto-relock: ' + RELOCK_LABEL[relockPref()] + '…', fn: () => actionSheet('Auto-relock', Object.entries(RELOCK_LABEL).map(([k, l]) => ({ label: (relockPref() === k ? '✓ ' : '') + l, fn: () => localStorage.setItem('lockRelock', k) }))) },
    { label: 'Appearance: ' + { dark: 'Dark', light: 'Light', system: 'System' }[themePref()] + '…', fn: themeMenu }]);
}

/* ---- setup: code only. Existing encrypted notes retain their PIN wrap until migrated. ---- */
async function setupPencilLock({ verifiedKek = null } = {}) {
  const old = lockCfg();
  let oldKek = verifiedKek;
  if (old && !oldKek) {
    const pin = await pinPrompt(old.v === 2 ? 'Current 5-digit code' : 'Enter your existing PIN', 'Confirm your current code before changing it.', { legacy: old.v !== 2 });
    if (pin === null) return false;
    oldKek = await pinKek(pin, old.salt, old.iter);
    if (!(await checkPin(oldKek, old))) { toast('Wrong code'); return false; }
  }
  const p1 = await pinPrompt('Choose a 5-digit code', 'Use this code for notebooks, Archive and individual notes. Forgotten codes cannot be recovered.', { confirm: true });
  if (p1 === null) return false;
  const p2 = await pinPrompt('Repeat your 5-digit code', '', { confirm: true });
  if (p2 !== p1) { toast('Codes do not match'); return false; }
  const salt = rand(16), kek = await pinKek(p1, salt, PIN_ITER);
  const ck = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']), iv = rand(12);
  const cfg = { v: 2, salt: b64(salt), iter: PIN_ITER, check: { w: b64(await subtle.wrapKey('raw', ck, kek, 'AES-KW')), iv: b64(iv), ct: b64(await subtle.encrypt(gcm(iv, 'pin-check'), ck, te.encode('ok'))) }, createdAt: Date.now() };
  // Rewrap every accessible old-code note, without decrypting or rewriting its content.
  for (const n of S.notes) if (n.lock && old && n.lock.pin.salt === old.salt) {
    const dk = await subtle.unwrapKey('raw', unb64(n.lock.pin.w), oldKek, 'AES-KW', 'AES-GCM', true, ['encrypt', 'decrypt']);
    n.lock.pin = { salt: cfg.salt, iter: cfg.iter, w: b64(await subtle.wrapKey('raw', dk, kek, 'AES-KW')) };
    await DB.put('notes', n);
  }
  for (const nb of S.notebooks) if (nb.codeLock && old && nb.codeLock.salt === old.salt) { nb.codeLock = cfg; await saveNotebook(nb); }
  await LockDB.put('pinkek', kek);
  localStorage.setItem('pencilLock', JSON.stringify(cfg)); localStorage.removeItem('lockFails');
  syncLockUI(); renderSidebar(); toast('5-digit code ready'); return true;
}
/* ---- wiring ---- */
(() => {
  const b = document.createElement('button'); b.className = 'icon-btn'; b.id = 'lockBtn'; b.title = 'Lock this note with a 5-digit code'; b.setAttribute('aria-label', 'Lock note'); b.textContent = '🔒'; b.onclick = lockMenu;
  $('#noteMenuBtn').before(b);
  const foot = $('#exportBtn').parentElement, sb = document.createElement('button'); sb.className = 'btn small'; sb.id = 'settingsBtn'; sb.textContent = '⚙︎ Settings'; sb.onclick = settingsMenu; foot.append(sb);
  const nm = $('#noteMenuBtn'), orig = nm.onclick;
  nm.onclick = e => { const n = curNote(); if (isSealed(n)) return actionSheet('🔒 Locked note', [{ label: '🔢 Unlock with code…', primary: true, fn: () => pinUnlockFlow(n) }, { label: 'Move / delete…', fn: () => noteMenu(n) }, { label: '⚙︎ Settings…', fn: () => (typeof openSettings === 'function' ? openSettings() : settingsMenu()) }]); return orig(e); };
  syncLockUI();
})();
window.PencilLock = { lockNote, unlockWith, unlockWithPin, removeLock, isSealed, isLockedOpen, lockCfg, LockDB, sealNote, setupPencilLock, LK };
