/* Pencil Notes v14 — Pencil Lock.
   A note is locked with a personal shape drawn with the Pencil (recognised on-device) and a backup PIN.
   Crypto: per-note AES-GCM-256 data key (DK). Content (title, pages: ink, text, tasks, board cards & checklists, reminders) and the note's
   attachments are encrypted with DK. DK is wrapped with AES-KW under a key derived from the PIN (PBKDF2-SHA256, 310 000 iterations) — that wrap
   travels with the note (and its backups). A non-extractable copy of DK is kept in this device's IndexedDB so the shape can unlock it here.
   At rest a locked note is a "sealed" stub: generic title, one blank page, generic reminder stubs ('Locked note reminder') and the ciphertext. */
// Pencil Lock recognizer: $P-style point cloud (multistroke, stroke-order free) + resampling, scale/translation normalisation and a
// bounded rotation search (±30°), plus a direction-aware term so a shape drawn as a different path doesn't match.
const PRec = (() => {
  const N = 48;
  const len = s => { let d = 0; for (let i = 1; i < s.length; i++) d += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return d; };
  function resample(strokes) {
    strokes = strokes.filter(s => s.length > 0);
    const total = strokes.reduce((a, s) => a + len(s), 0) || 1, I = total / (N - 1), out = [];
    strokes.forEach((s, si) => {
      let D = 0; out.push([s[0][0], s[0][1], si]);
      for (let i = 1; i < s.length; i++) {
        let p = s[i - 1], q = s[i], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        while (D + d >= I && d > 0) { const t = (I - D) / d, r = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), si]; out.push(r); p = r; d = Math.hypot(q[0] - p[0], q[1] - p[1]); D = 0; }
        D += d;
      }
    });
    while (out.length < N) out.push(out[out.length - 1].slice());
    if (out.length > N) { const k = []; for (let i = 0; i < N; i++) k.push(out[Math.round(i * (out.length - 1) / (N - 1))]); return k; }
    return out;
  }
  function normalize(strokes) {
    const pts = resample(strokes);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const s = Math.max(x1 - x0, y1 - y0) || 1;
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    const raw = strokes.filter(q => q.length).reduce((a, q) => a + len(q), 0) / s;
    return { pts: pts.map(p => [+((p[0] - cx) / s).toFixed(4), +((p[1] - cy) / s).toFixed(4), p[2]]), n: strokes.filter(q => q.length).length, complexity: +raw.toFixed(3) };
  }
  const rot = (pts, a) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]); };
  function cloud(a, b, start) {
    const n = a.length, used = new Uint8Array(n); let sum = 0, i = start;
    do {
      let min = Infinity, idx = -1;
      for (let j = 0; j < n; j++) if (!used[j]) { const d = (a[i][0] - b[j][0]) ** 2 + (a[i][1] - b[j][1]) ** 2; if (d < min) { min = d; idx = j; } }
      used[idx] = 1; sum += (1 - ((i - start + n) % n) / n) * Math.sqrt(min); i = (i + 1) % n;
    } while (i !== start);
    return sum;
  }
  function cloudDist(a, b) { const n = a.length, step = Math.max(1, Math.floor(Math.sqrt(n))); let m = Infinity; for (let i = 0; i < n; i += step) m = Math.min(m, cloud(a, b, i), cloud(b, a, i)); return m / n; }
  // ordered (path) distance: catches a shape drawn "the same" as a cloud but as a completely different path (e.g. scribble filling the same area)
  const pathDist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]); return s / a.length; };
  const rev = pts => pts.slice().reverse();
  function score(g, t, W = 0.6) {
    const single = g.n === 1 && t.n === 1, gr = single ? rev(g.pts) : null;
    let best = Infinity, bestPath = Infinity;
    for (let deg = -30; deg <= 30; deg += 6) {
      const a = deg * Math.PI / 180, r = rot(g.pts, a); best = Math.min(best, cloudDist(r, t.pts));
      if (single) bestPath = Math.min(bestPath, pathDist(r, t.pts), pathDist(rot(gr, a), t.pts));
    }
    return single ? best + W * Math.min(bestPath, 0.6) : best * 1.8;
  }
  function match(g, tpl) {   // tpl = {samples:[norm], thr, nmin, nmax}
    const nz = normalize(g);
    if (nz.n < tpl.nmin || nz.n > tpl.nmax) return { ok: false, d: Infinity, why: 'strokes' };
    const d = Math.min(...tpl.samples.map(s => score(nz, s)));
    return { ok: d <= tpl.thr, d };
  }
  function train(samples) {  // samples: [[strokes], x3]
    const nz = samples.map(normalize); let intra = 0;
    for (let i = 0; i < nz.length; i++) for (let j = 0; j < nz.length; j++) if (i !== j) intra = Math.max(intra, score(nz[i], nz[j]));
    const thr = Math.min(0.09, Math.max(0.07, 0.045 + intra));
    return { v: 1, samples: nz, thr, intra, nmin: Math.min(...nz.map(z => z.n)), nmax: Math.max(...nz.map(z => z.n)) };
  }
  return { normalize, score, match, train, N };
})();

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
  for (const a of list || []) { if (!a.enc) { plain.push(a); continue; } const data = await (await (await fetch(a.data)).blob()).arrayBuffer(); await rawPut('assets', { id: a.id, data, type: 'application/octet-stream', size: data.byteLength, createdAt: Date.now(), enc: a.enc }); Assets.bitmaps.delete(a.id); }
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
      if (!kek) { const pin = await pinPrompt('Enter your Pencil Lock PIN', 'This device needs your PIN once to lock notes.'); if (!pin) return false; kek = await pinKek(pin, cfg.salt, cfg.iter); if (!(await checkPin(kek, cfg))) { toast('Wrong PIN'); return false; } await LockDB.put('pinkek', kek); }
      const dkx = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const w = await subtle.wrapKey('raw', dkx, kek, 'AES-KW'), raw = await subtle.exportKey('raw', dkx);
      dk = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); new Uint8Array(raw).fill(0);
      await LockDB.put('dk:' + n.id, dk);
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
    await LockDB.put('dk:' + n.id, dk);                         // the shape can unlock it on this device from now on
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
      if (a.dataset.l === 'pin') pinUnlockFlow(n); if (a.dataset.l === 'cancel') { LK.armed = null; syncLockUI(); clearTrail(); } if (a.dataset.l === 'setup') setupPencilLock(); }; }
  return b;
}
function syncLockUI() {
  const n = curNote(), sealed = isSealed(n), armed = !!(n && LK.armed === n.id);
  document.body.classList.toggle('note-locked', sealed); document.body.classList.toggle('lock-armed', armed);
  $('#noteTitle').readOnly = sealed;
  const btn = $('#lockBtn'); if (btn) { btn.classList.toggle('on', sealed || isLockedOpen(n)); btn.textContent = sealed ? '🔒' : isLockedOpen(n) ? '🔓' : '🔒'; btn.setAttribute('aria-label', sealed ? 'Locked note' : isLockedOpen(n) ? 'Unlocked note — lock again' : 'Lock note'); }
  const b = lockBar(), cfg = lockCfg(), fails = +(localStorage.getItem('lockFails') || 0);
  b.hidden = !sealed && !armed; b.className = sealed ? 'locked' : 'arming';
  if (sealed) b.innerHTML = cfg && fails < MAX_FAILS ? `<span class="lk-i">🔒</span><span class="lk-t">Locked · draw your shape with the Pencil to unlock</span><button data-l="pin">Use PIN</button>`
    : `<span class="lk-i">🔒</span><span class="lk-t">${cfg ? 'Too many tries — unlock with your PIN' : 'Locked on another device · unlock with your PIN'}</span><button data-l="pin" class="primary">Use PIN</button>`;
  else if (armed) b.innerHTML = `<span class="lk-i">✍︎</span><span class="lk-t">Draw your secret shape anywhere on the page to lock this note</span><button data-l="cancel">Cancel</button>`;
}
const _buildPages = buildPages;
buildPages = function () { _buildPages(); syncLockUI(); };
const _exportNotePdf = exportNotePdf;
exportNotePdf = async function (note = curNote()) { if (isSealed(note)) { toast('🔒 Unlock this note to export it as PDF'); return null; } return _exportNotePdf(note); };

/* ---- the "nonsense squiggles" view of a sealed note (pseudo-ink generated from the ciphertext) ---- */
const squigCache = new Map();
function squigStrokes(n) {
  const key = n.id + ':' + n.lock.ct.slice(0, 24); if (squigCache.has(key)) return squigCache.get(key);
  const by = unb64(n.lock.ct.slice(0, 64)); let s = 0x9e3779b9; for (const b of by) s = Math.imul(s ^ b, 2654435761) >>> 0;
  const R = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const lines = Math.max(4, Math.min(20, Math.round((n.lock.len || 2000) / 900))), out = [];
  for (let L = 0; L < lines; L++) {
    const base = 190 + L * 58; let x = 95 + (L === 0 ? 0 : R() * 30); const end = PAGE_W - 90 - (L === lines - 1 ? R() * 420 : R() * 60);
    while (x < end - 50) {
      const w = 50 + R() * 170, k = 3 + Math.round(w / 26), h = 16 + R() * 12, loops = R() < .6, ph = R() * 6, pts = [];
      for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * k * Math.PI * 2 + ph; pts.push([x + t * w + (loops ? 7 * Math.sin(a) : 0), base - h * (0.5 - 0.5 * Math.cos(a)) * (0.55 + 0.45 * Math.sin(t * 3 + ph)) - (R() < .05 ? 18 : 0), t * k * 6.283]); }
      out.push({ pts, base, ph: R() * 6 }); x += w + 16 + R() * 26;
    }
  }
  squigCache.set(key, out); return out;
}
function drawSquiggles(cv, n, now) {
  const c = cv.getContext('2d'), sc = S.scale, dpr = cv.width / (cv.clientWidth || 1); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
  let amp = 1, alpha = 0.62; const A = LK.anim;
  if (A) { const t = Math.min(1, (now - A.t0) / (A.kind === 'out' ? 600 : 700)); amp = A.kind === 'out' ? 1 - t : t; alpha *= A.kind === 'out' ? 1 - t * t : Math.min(1, t * 1.6); if (t >= 1 && A.kind === 'in') LK.anim = null; }
  c.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0); c.lineCap = c.lineJoin = 'round'; c.lineWidth = 2.4; c.strokeStyle = inkColor(INK); c.globalAlpha = alpha;
  for (const st of squigStrokes(n)) {
    c.beginPath(); const wob = Math.sin(now / 900 + st.ph) * 2.2;
    st.pts.forEach((p, i) => { const y = st.base + (p[1] - st.base) * amp + Math.sin(p[2] * .25 + now / 500 + st.ph) * wob * amp, x = p[0] + (1 - amp) * Math.sin(i + st.ph) * 3; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
  }
}
let squigRaf = 0, squigLast = 0;
function squigLoop(now) {
  squigRaf = 0; const n = curNote(), cvs = document.querySelectorAll('.lock-squig');
  if (!cvs.length || !n || !n.lock || !n.lock.ct) return;
  if (now - squigLast > 45 || LK.anim) { squigLast = now; cvs.forEach(cv => drawSquiggles(cv, n, now)); }
  squigRaf = requestAnimationFrame(squigLoop);
}
const _v7OverlayHookLock = v7OverlayHook;
v7OverlayHook = function (pi) {
  _v7OverlayHookLock(pi);
  const n = curNote(), rec = pageEls[pi]; if (!rec) return;
  rec.el.classList.toggle('locked-page', isSealed(n));
  if (!isSealed(n) && !(LK.anim && LK.anim.kind === 'out' && n && n.lock && n.lock.ct)) return;
  const cv = document.createElement('canvas'); cv.className = 'lock-squig'; cv.setAttribute('aria-label', 'Locked note');
  const wpx = Math.round(PAGE_W * S.scale), hpx = Math.round(PAGE_H * S.scale), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = wpx * dpr; cv.height = hpx * dpr; cv.style.width = wpx + 'px'; cv.style.height = hpx + 'px';
  const badge = document.createElement('div'); badge.className = 'lock-badge'; badge.textContent = '🔒';
  rec.ov.append(cv, badge); drawSquiggles(cv, n, performance.now());
  if (!squigRaf) squigRaf = requestAnimationFrame(squigLoop);
};
function lockAnim() { return new Promise(r => { const p = $('#pages'); p.classList.add('lock-hiding'); setTimeout(() => { p.classList.remove('lock-hiding'); r(); }, 380); }); }

/* ---- Pencil capture: drawing the shape (never saved as ink) ---- */
function trailCv() {
  let c = document.getElementById('lockTrail');
  if (!c) { c = document.createElement('canvas'); c.id = 'lockTrail'; document.body.append(c); }
  const dpr = Math.min(2, devicePixelRatio || 1); if (c.width !== innerWidth * dpr) { c.width = innerWidth * dpr; c.height = innerHeight * dpr; }
  return c;
}
function clearTrail() { const c = document.getElementById('lockTrail'); if (c) { c.getContext('2d').clearRect(0, 0, c.width, c.height); c.className = ''; } LK.strokes = []; clearTimeout(LK.timer); }
function drawTrail() {
  const c = trailCv(), x = c.getContext('2d'), dpr = c.width / innerWidth; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, innerWidth, innerHeight);
  x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#a5b4fc'; x.lineWidth = 4; x.shadowColor = '#6366f1'; x.shadowBlur = 14;
  for (const s of [...LK.strokes, ...(LK.g ? [LK.g.pts] : [])]) { x.beginPath(); s.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke(); }
}
const captureMode = () => { const n = curNote(); if (!n || LK.busy) return null; if (isSealed(n)) return 'unlock'; if (LK.armed === n.id) return 'lock'; return null; };
window.addEventListener('pointerdown', e => {
  const mode = captureMode(); if (!mode || !e.target.closest || !e.target.closest('#pages') || e.target.closest('button, input, #lockBar')) return;
  if (e.pointerType === 'touch' && !fingerDrawOn()) return;           // fingers keep scrolling; the Pencil draws the shape
  e.stopImmediatePropagation(); e.preventDefault();
  if (e.pointerType === 'pen' && typeof notePen === 'function') notePen();
  clearTimeout(LK.timer); clearTimeout(LK.fade); trailCv().className = 'on';
  LK.g = { pid: e.pointerId, mode, pts: [[e.clientX, e.clientY]] }; drawTrail();
}, true);
window.addEventListener('pointermove', e => { const g = LK.g; if (!g || e.pointerId !== g.pid) return; e.stopImmediatePropagation(); g.pts.push([e.clientX, e.clientY]); drawTrail(); }, true);
const lockUp = e => {
  const g = LK.g; if (!g || e.pointerId !== g.pid) return; e.stopImmediatePropagation(); LK.g = null;
  if (e.type === 'pointercancel') { clearTrail(); return; }
  if (g.pts.length > 1) LK.strokes.push(g.pts); drawTrail();
  LK.timer = setTimeout(() => recognizeShape(g.mode), 650);           // multistroke: wait a moment for the next stroke
};
window.addEventListener('pointerup', lockUp, true); window.addEventListener('pointercancel', lockUp, true);
document.addEventListener('touchmove', e => { if (LK.g && e.cancelable) e.preventDefault(); }, { passive: false, capture: true });

async function recognizeShape(mode) {
  const strokes = LK.strokes.slice(), n = curNote(), cfg = lockCfg(), c = trailCv();
  if (!strokes.length) { clearTrail(); return; }
  const res = cfg ? PRec.match(strokes, cfg.tpl) : { ok: false, d: Infinity };
  window.__lastLockMatch = res;
  LK.strokes = []; c.className = 'on ' + (res.ok ? 'ok' : 'bad');
  clearTimeout(LK.fade); LK.fade = setTimeout(() => { if (!LK.g && !LK.strokes.length) clearTrail(); }, res.ok ? 260 : 520);
  if (mode === 'lock') {
    if (res.ok) { LK.armed = null; syncLockUI(); toast('🔒 Locked', 1400); await lockNote(n); }
    else { lockBar().classList.add('shake'); setTimeout(() => lockBar().classList.remove('shake'), 500); toast('That isn’t your shape — try again', 1800); }
    return;
  }
  if (!cfg) { pinUnlockFlow(n); return; }
  const fails = +(localStorage.getItem('lockFails') || 0);
  if (fails >= MAX_FAILS) { pinUnlockFlow(n); return; }
  if (!res.ok) {
    localStorage.setItem('lockFails', fails + 1); document.querySelectorAll('.lock-squig').forEach(cv => { cv.classList.remove('shake'); void cv.offsetWidth; cv.classList.add('shake'); });
    toast(fails + 1 >= MAX_FAILS ? 'Too many tries — use your PIN' : 'Not your shape', 1600); syncLockUI(); return;
  }
  const dk = await LockDB.get('dk:' + n.id);
  if (!dk) { toast('Shape OK — this device needs your PIN once for this note', 2400); pinUnlockFlow(n); return; }
  unlockWith(n, dk);
}

/* ---- sheets ---- */
function pinPrompt(title, sub = '', { confirm = false } = {}) {
  return new Promise(res => {
    const w = modalWrap('pinWrap');
    w.innerHTML = `<div class="sheet pin-sheet" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${sub ? `<p class="fine">${esc(sub)}</p>` : ''}
      <input id="pinIn" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" placeholder="PIN" aria-label="PIN">
      <p class="fine pin-err" hidden></p><div class="sheet-actions"><div class="spacer"></div><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Unlock</button></div></div>`;
    w.hidden = false; const inp = w.querySelector('#pinIn'); setTimeout(() => inp.focus(), 30);
    const done = v => { w.hidden = true; res(v); };
    w.querySelector('[data-x]').onclick = () => done(null);
    w.querySelector('[data-ok]').onclick = () => done(inp.value);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); };
  });
}
async function pinUnlockFlow(n) {
  if (!isSealed(n)) return;
  for (let tries = 0; tries < 5; tries++) {
    const pin = await pinPrompt(tries ? 'Wrong PIN — try again' : 'Unlock with PIN', 'Enter the backup PIN you chose when setting up Pencil Lock.'); if (pin === null) return;
    toast('Checking…', 3000);
    if (await unlockWithPin(n, pin)) return;
  }
}
function lockMenu() {
  const n = curNote(); if (!n) return;
  const cfg = lockCfg(), rel = relockPref();
  const relockItems = () => actionSheet('Auto-relock', Object.entries(RELOCK_LABEL).map(([k, l]) => ({ label: (rel === k ? '✓ ' : '') + l, fn: () => { localStorage.setItem('lockRelock', k); toast('Auto-relock: ' + l); } })));
  if (!cfg && !n.lock) { setupPencilLock(); return; }
  if (isSealed(n)) { actionSheet('🔒 Locked note', [{ label: '🔢 Unlock with PIN…', primary: true, fn: () => pinUnlockFlow(n) }, { label: '⏱ Auto-relock: ' + RELOCK_LABEL[rel] + '…', fn: relockItems }]); return; }
  if (isLockedOpen(n)) { actionSheet('🔓 Unlocked note', [{ label: '🔒 Lock again now', primary: true, fn: () => lockNote(n) }, { label: '⏱ Auto-relock: ' + RELOCK_LABEL[rel] + '…', fn: relockItems }, { label: '🔓 Remove lock (store unencrypted)', danger: true, fn: () => removeLock(n) }]); return; }
  actionSheet('Lock this note', [
    { label: '✍︎ Draw my shape to lock', primary: true, fn: () => { LK.armed = n.id; syncLockUI(); hint('Draw your secret shape anywhere on the page'); } },
    { label: '⏱ Auto-relock: ' + RELOCK_LABEL[rel] + '…', fn: relockItems },
    { label: '⚙︎ Pencil Lock settings…', fn: setupPencilLock }]);
}
function settingsMenu() {
  const cfg = lockCfg();
  actionSheet('Settings', [
    { label: cfg ? '🔒 Pencil Lock: set up again (new shape & PIN)…' : '🔒 Set up Pencil Lock…', fn: setupPencilLock },
    { label: '⏱ Auto-relock: ' + RELOCK_LABEL[relockPref()] + '…', fn: () => actionSheet('Auto-relock', Object.entries(RELOCK_LABEL).map(([k, l]) => ({ label: (relockPref() === k ? '✓ ' : '') + l, fn: () => localStorage.setItem('lockRelock', k) }))) },
    { label: 'Appearance: ' + { dark: 'Dark', light: 'Light', system: 'System' }[themePref()] + '…', fn: themeMenu }]);
}

/* ---- setup: draw the shape 3×, then a 6+ digit PIN ---- */
function setupPencilLock() {
  const w = modalWrap('lockSetup'), samples = []; let cur = [], g = null, timer = 0;
  const had = !!lockCfg();
  w.innerHTML = `<div class="sheet lock-setup" role="dialog" aria-modal="true">
    <h3>🔒 Set up Pencil Lock</h3>
    <div class="ls-step" data-s="draw"><p class="fine">Draw a <b>secret shape</b> with your Pencil — something personal, like a squiggle, a monogram or a little drawing (not just a line or a plain circle). One or more strokes. You'll draw it <b>3 times</b>.</p>
      <div class="ls-dots"><i></i><i></i><i></i></div><p class="ls-msg">Draw your shape (1 of 3)</p>
      <canvas class="ls-pad" aria-label="Drawing pad for your secret shape"></canvas>
      <div class="sheet-actions"><button class="btn" data-a="clear">Clear</button><div class="spacer"></div><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="next" disabled>Next</button></div></div>
    <div class="ls-step" data-s="pin" hidden><p class="fine">Choose a <b>backup PIN</b> (at least 6 digits). You need it if the shape doesn't work, and to open locked notes from a backup on another device.</p>
      <label>PIN<input id="lsPin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]*"></label>
      <label>Repeat PIN<input id="lsPin2" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]*"></label>
      <div class="ls-warn">⚠️ Locked notes are really encrypted. <b>If you forget both your shape and your PIN, they can't be recovered</b> — not by you, not by anyone.</div>
      <label class="chkrow"><input type="checkbox" id="lsAck"> I understand</label>
      ${had ? '<p class="fine">Notes you locked before keep needing your previous PIN as their backup.</p>' : ''}
      <p class="fine ls-err" hidden></p>
      <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save Pencil Lock</button></div></div></div>`;
  w.hidden = false;
  const pad = w.querySelector('.ls-pad'), msg = w.querySelector('.ls-msg'), next = w.querySelector('[data-a="next"]'), dots = w.querySelectorAll('.ls-dots i');
  const fit = () => { const r = pad.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); pad.width = r.width * d; pad.height = r.height * d; };
  requestAnimationFrame(fit);
  const paint = () => { const x = pad.getContext('2d'), d = pad.width / (pad.clientWidth || 1); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, pad.width, pad.height); x.lineCap = x.lineJoin = 'round'; x.lineWidth = 4; x.strokeStyle = '#a5b4fc';
    for (const s of [...cur, ...(g ? [g] : [])]) { x.beginPath(); s.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke(); } };
  const pt = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  pad.onpointerdown = e => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (_) {} g = [pt(e)]; g.pid = e.pointerId; clearTimeout(timer); paint(); };
  pad.onpointermove = e => { if (!g || e.pointerId !== g.pid) return; g.push(pt(e)); paint(); };
  pad.onpointerup = pad.onpointercancel = e => { if (!g || e.pointerId !== g.pid) return; if (g.length > 1) cur.push(g); g = null; paint(); next.disabled = !cur.length; };
  const clear = () => { cur = []; paint(); next.disabled = true; };
  const accept = () => {
    if (!cur.length) return;
    const nz = PRec.normalize(cur);
    if (nz.complexity < 1.9) { msg.textContent = 'Too simple — draw something more distinctive'; msg.className = 'ls-msg bad'; clear(); return; }
    if (samples.length) { const d = PRec.score(nz, PRec.normalize(samples[0])); if (d > 0.13 || nz.n !== PRec.normalize(samples[0]).n && Math.abs(nz.n - PRec.normalize(samples[0]).n) > 0) { msg.textContent = `That didn't match your first drawing — draw it again (${samples.length + 1} of 3)`; msg.className = 'ls-msg bad'; clear(); return; } }
    samples.push(cur.map(s => s.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]))); dots.forEach((d, i) => d.classList.toggle('on', i < samples.length)); clear();
    if (samples.length < 3) { msg.textContent = `Great — again (${samples.length + 1} of 3)`; msg.className = 'ls-msg'; return; }
    const tpl = PRec.train(samples); window.__lockTrain = tpl;
    if (tpl.intra > 0.12) { samples.length = 0; dots.forEach(d => d.classList.remove('on')); msg.textContent = 'Your three drawings were too different — let\'s start over (1 of 3)'; msg.className = 'ls-msg bad'; return; }
    w._tpl = tpl; w.querySelector('[data-s="draw"]').hidden = true; w.querySelector('[data-s="pin"]').hidden = false; setTimeout(() => w.querySelector('#lsPin').focus(), 30);
  };
  w.onclick = async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'cancel') { w.hidden = true; return; }
    if (a.dataset.a === 'clear') clear();
    if (a.dataset.a === 'next') accept();
    if (a.dataset.a === 'save') {
      const p1 = w.querySelector('#lsPin').value, p2 = w.querySelector('#lsPin2').value, err = w.querySelector('.ls-err'), say = m => { err.textContent = m; err.hidden = false; };
      if (!/^\d{6,}$/.test(p1)) return say('The PIN needs at least 6 digits (numbers only).');
      if (/^(\d)\1+$/.test(p1) || '01234567890123456789'.includes(p1) || '98765432109876543210'.includes(p1)) return say('Pick a less guessable PIN (not 111111 or 123456).');
      if (p1 !== p2) return say('The two PINs don\'t match.');
      if (!w.querySelector('#lsAck').checked) return say('Please confirm you understand that a forgotten shape + PIN can\'t be recovered.');
      a.disabled = true; a.textContent = 'Saving…';
      const salt = rand(16), kek = await pinKek(p1, salt, PIN_ITER);
      const ck = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']), iv = rand(12);
      const check = { w: b64(await subtle.wrapKey('raw', ck, kek, 'AES-KW')), iv: b64(iv), ct: b64(await subtle.encrypt(gcm(iv, 'pin-check'), ck, te.encode('ok'))) };
      await LockDB.put('pinkek', kek);
      const t = w._tpl; localStorage.setItem('pencilLock', JSON.stringify({ v: 1, tpl: { samples: t.samples, thr: t.thr, intra: t.intra, nmin: t.nmin, nmax: t.nmax }, salt: b64(salt), iter: PIN_ITER, check, createdAt: Date.now() }));
      localStorage.removeItem('lockFails');
      w.hidden = true; syncLockUI(); toast('🔒 Pencil Lock is ready — tap 🔒 Lock on a note', 2600);
    }
  };
  w.addEventListener('keydown', e => { if (e.key === 'Enter' && !w.querySelector('[data-s="pin"]').hidden) w.querySelector('[data-a="save"]').click(); });
}

/* ---- wiring ---- */
(() => {
  const b = document.createElement('button'); b.className = 'icon-btn'; b.id = 'lockBtn'; b.title = 'Lock this note with your Pencil shape'; b.setAttribute('aria-label', 'Lock note'); b.textContent = '🔒'; b.onclick = lockMenu;
  $('#noteMenuBtn').before(b);
  const foot = $('#exportBtn').parentElement, sb = document.createElement('button'); sb.className = 'btn small'; sb.id = 'settingsBtn'; sb.textContent = '⚙︎ Settings'; sb.onclick = settingsMenu; foot.append(sb);
  const nm = $('#noteMenuBtn'), orig = nm.onclick;
  nm.onclick = e => { const n = curNote(); if (isSealed(n)) return actionSheet('🔒 Locked note', [{ label: '🔢 Unlock with PIN…', primary: true, fn: () => pinUnlockFlow(n) }, { label: 'Move / delete…', fn: () => noteMenu(n) }, { label: '⚙︎ Settings…', fn: settingsMenu }]); return orig(e); };
  syncLockUI();
})();
window.PencilLock = { PRec, lockNote, unlockWith, unlockWithPin, removeLock, isSealed, isLockedOpen, lockCfg, LockDB, sealNote, setupPencilLock, LK };
