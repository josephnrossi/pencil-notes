/* Pencil Notes v17 — 🎙 meeting & conversation recorder.
   Data lives in the page (pg.rec) so saving, Export, Search and Pencil Lock encryption cover it:
   pg.rec = { id, segs:[{asset, mime, start, dur, bytes}], dur, status, live:[{t,text}], transcript:{segs:[{t,end,sp,text}], engine, at},
              speakers:{ '1': {name, ink} }, interrupted:[{t, reason, at}], startedAt }
   Audio = MediaRecorder parts (a new self-contained part every 10 min, so long meetings upload in chunks), each saved as an asset.
   While recording, 2-second chunks are written to IndexedDB (encrypted when the note is a Pencil-Locked note) so a crash / iPadOS kill
   loses at most ~2 s; they're stitched back on next launch. Strokes written while recording carry stroke.t (ms into the recording). */
const REC_SEG_MS = 10 * 60 * 1000, REC_SLICE = 2000;
const R = { active: null, player: null, replay: false, busy: new Map(), lastErr: new Map() };
const newRec = () => ({ id: uid('r'), segs: [], dur: 0, status: 'idle', live: [], speakers: {}, interrupted: [], createdAt: Date.now() });
const isRecPage = pg => !!(pg && pg.bg && pg.bg.type === 'template' && pg.bg.name === 'recording');
function safeInk(u) { return typeof u === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(u) ? `<img alt="" src="${u}">` : ''; }
const mmss = ms => { ms = Math.max(0, Math.round((ms || 0) / 1000)); const h = Math.floor(ms / 3600), m = Math.floor(ms / 60) % 60, s = ms % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
function findRec(recId) { for (const n of S.notes) for (let i = 0; i < n.pages.length; i++) { const pg = n.pages[i]; if (pg.rec && pg.rec.id === recId) return { n, pi: i, pg, rec: pg.rec }; } return null; }
const recNoteLocked = n => typeof PencilLock !== 'undefined' && PencilLock.isSealed(n);
const lockedOpen = id => typeof LK !== 'undefined' && LK.open && LK.open.has(id);
function pickMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || '';
}
const mimeExt = m => /mp4|aac|m4a/.test(m || '') ? 'm4a' : /ogg/.test(m || '') ? 'ogg' : /webm/.test(m || '') ? 'webm' : /wav/.test(m || '') ? 'wav' : /mpeg|mp3/.test(m || '') ? 'mp3' : 'm4a';

/* ---------- settings: transcription provider ---------- */
const STT_PRESETS = { xai: { label: 'xAI speech-to-text (/v1/stt)', base: 'https://api.x.ai/v1', model: 'grok-voice-transcribe-2.0' }, openai: { label: 'OpenAI-compatible (/audio/transcriptions)', base: 'https://api.openai.com/v1', model: 'whisper-1' } };
function sttCfg() { try { return { provider: 'auto', base: '', model: '', key: '', live: true, auto: true, ...JSON.parse(localStorage.getItem('recSTT') || '{}') }; } catch (_) { return { provider: 'auto', live: true, auto: true }; } }
function sttResolved() {
  const c = sttCfg(), ai = aiCfg(); if (c.provider === 'live') return null;
  const host = u => { try { return new URL(u).host; } catch (_) { return ''; } };
  if (c.provider === 'auto') {
    if (!ai.key || !AI_URL_OK.test(ai.base || '')) return null;
    return /(^|\.)x\.ai$/.test(host(ai.base)) ? { api: 'xai', base: ai.base, model: STT_PRESETS.xai.model, key: ai.key } : { api: 'openai', base: ai.base, model: STT_PRESETS.openai.model, key: ai.key };
  }
  const P = STT_PRESETS[c.provider] || STT_PRESETS.openai, base = c.base || P.base;
  const key = c.key || (ai.key && host(ai.base) === host(base) ? ai.key : '');
  return key && AI_URL_OK.test(base) ? { api: c.provider === 'xai' ? 'xai' : 'openai', base, model: c.model || P.model, key } : null;
}
const sttLabel = () => { const c = sttResolved(); return c ? (c.api === 'xai' ? 'xAI ' + c.model : c.model) : null; };
function recSettings() {
  const c = sttCfg(), w = modalWrap('recSetWrap');
  w.innerHTML = `<div class="sheet ai-sheet" role="dialog" aria-modal="true"><h3>🎙 Recording &amp; transcription</h3>
    <p class="fine">Live captions use Safari’s built-in speech recognition while you record (free, may miss words). For an accurate transcript with speakers, the audio is sent after you stop to the provider below, with <b>your own</b> key — stored only on this device, never in notes or backups.</p>
    <label class="chkrow"><input type="checkbox" id="rsLive" ${c.live ? 'checked' : ''}> Live captions while recording</label>
    <label class="chkrow"><input type="checkbox" id="rsAuto" ${c.auto ? 'checked' : ''}> Transcribe &amp; summarize automatically when I stop</label>
    <label>Transcription<select id="rsProv">
      <option value="auto" ${c.provider === 'auto' ? 'selected' : ''}>Same as Smarter AI (xAI key → xAI speech-to-text)</option>
      <option value="xai" ${c.provider === 'xai' ? 'selected' : ''}>${STT_PRESETS.xai.label}</option>
      <option value="openai" ${c.provider === 'openai' ? 'selected' : ''}>${STT_PRESETS.openai.label}</option>
      <option value="live" ${c.provider === 'live' ? 'selected' : ''}>Live captions only (audio never leaves the iPad)</option></select></label>
    <div id="rsCustom" ${['xai', 'openai'].includes(c.provider) ? '' : 'hidden'}>
      <label>Base URL<input id="rsBase" value="${esc(c.base)}" placeholder="${esc((STT_PRESETS[c.provider] || STT_PRESETS.xai).base)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>Model<input id="rsModel" value="${esc(c.model)}" placeholder="${esc((STT_PRESETS[c.provider] || STT_PRESETS.xai).model)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>API key<input id="rsKey" type="password" value="${esc(c.key)}" placeholder="blank = reuse the Smarter AI key (same provider)" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>
    <p class="fine">Now: <b>${esc(sttLabel() || 'live captions only')}</b> · Summaries: <b>${esc(aiReady() ? aiModel() : 'built-in (connect AI for Grok analysis)')}</b></p>
    <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-rs="x">Cancel</button><button class="btn primary" data-rs="save">Save</button></div></div>`;
  w.hidden = false; const $w = s => w.querySelector(s);
  $w('#rsProv').onchange = () => { const v = $w('#rsProv').value; $w('#rsCustom').hidden = !['xai', 'openai'].includes(v); const P = STT_PRESETS[v]; if (P) { $w('#rsBase').placeholder = P.base; $w('#rsModel').placeholder = P.model; } };
  w.onclick = e => { const a = e.target.closest('[data-rs]'); if (!a) return; if (a.dataset.rs === 'save') {
    const v = { provider: $w('#rsProv').value, base: $w('#rsBase').value.trim(), model: $w('#rsModel').value.trim(), key: $w('#rsKey').value.trim(), live: $w('#rsLive').checked, auto: $w('#rsAuto').checked };
    if (v.base && !AI_URL_OK.test(v.base)) { toast('Base URL must be https'); return; }
    localStorage.setItem('recSTT', JSON.stringify(v)); toast('🎙 Saved — ' + (sttLabel() || 'live captions only')); rerenderRec(); }
    w.hidden = true; };
}

/* ---------- consent & capability ---------- */
function consentSheet() {
  return new Promise(res => {
    const w = modalWrap('recConsentWrap');
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>🎙 Before you record</h3>
      <p>Tell everyone in the conversation that you’re recording, and get their OK. In many places recording without everyone’s consent is illegal.</p>
      <p class="fine">Keep Pencil Notes open with the screen on while recording. iPadOS turns the microphone off if the screen locks or you switch apps — Pencil Notes saves everything captured up to that moment and tells you.</p>
      <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-c="0">Cancel</button><button class="btn primary" data-c="1">Everyone agreed — record</button></div></div>`;
    w.hidden = false; w.onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; w.hidden = true; res(b.dataset.c === '1'); };
  });
}
function infoSheet(title, html) { const w = modalWrap('recInfoWrap'); w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>${title}</h3>${html}<div class="sheet-actions"><div class="spacer"></div><button class="btn primary" data-i="ok">OK</button></div></div>`; w.hidden = false; w.onclick = e => { if (e.target.closest('[data-i]')) w.hidden = true; }; }

/* ---------- recorder ---------- */
const recElapsed = (A = R.active) => A ? A.base + A.segMs + (A.paused ? 0 : performance.now() - A.runAt) : 0;
function recStamp() { const A = R.active; return A && !A.paused && A.noteId === S.cur ? Math.round(recElapsed(A)) : null; }
async function recStart(pi) {
  const n = curNote(); let pg = n && n.pages[pi]; if (!pg) return;
  if (R.active) { toast('Already recording — stop it first'); return; }
  if (recNoteLocked(n)) { toast('Unlock the note first'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    infoSheet('🎙 Recording isn’t available', '<p>This browser can’t record audio. On iPad use Safari (iPadOS 14.5 or later) and open Pencil Notes from the Home Screen or Safari — not from inside another app.</p>'); return; }
  if (!localStorage.getItem('recConsent')) { if (!(await consentSheet())) return; localStorage.setItem('recConsent', String(Date.now())); }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) {
    infoSheet('🎙 Microphone blocked', e && e.name === 'NotAllowedError' ? '<p>Pencil Notes isn’t allowed to use the microphone.</p><p class="fine">On iPad: tap <b>aA</b> in Safari’s address bar → <b>Website Settings</b> → Microphone → Allow (or Settings → Apps → Safari → Microphone). Then tap Record again.</p>'
      : `<p>The microphone couldn’t start (${esc(e && (e.name || e.message) || 'unknown error')}). Another app may be using it — close it and try again.</p>`); return; }
  pg = curNote().pages[pi]; if (!pg.rec) pg.rec = newRec();
  const rec = pg.rec, A = R.active = { noteId: n.id, pageId: pg.id, recId: rec.id, stream, mime: pickMime(), base: rec.dur || 0, segMs: 0, runAt: performance.now(), paused: false, seg: null, srT: new Map(), srGen: 0, interim: '', liveState: 'off' };
  rec.status = 'recording'; rec.startedAt ||= Date.now(); saveNote(n);
  const tr = stream.getAudioTracks()[0];
  if (tr) { tr.onended = () => recInterrupted('the microphone was turned off (screen lock, app switch or another app took it)');
    tr.onmute = () => { if (A.sr && performance.now() - A.srAt < 4000) { liveOff(A, 'conflict'); return; } setTimeout(() => { if (R.active === A && tr.muted && !A.paused) recInterrupted(document.hidden ? 'iPadOS paused the microphone while Pencil Notes was in the background' : 'the microphone was taken by a call or another app'); }, 2500); }; }
  startSegment(A); startMeter(A); wakeOn(A); startLive(A);
  A.tick = setInterval(() => recTick(A), 500);
  rerenderRec(); syncMini(); toast('🎙 Recording — write with Pencil; tap ink later to hear that moment');
}
function startSegment(A) {
  let mr; const opts = { audioBitsPerSecond: 64000 }; if (A.mime) opts.mimeType = A.mime;
  try { mr = new MediaRecorder(A.stream, opts); } catch (_) { mr = new MediaRecorder(A.stream); }
  const seg = A.seg = { idx: (A.segN = (A.segN || 0) + 1) + '_' + Date.now().toString(36), start: Math.round(A.base), chunks: [], ids: [], n: 0, mime: '', mr };
  mr.ondataavailable = e => { if (e.data && e.data.size) saveChunk(A, seg, e.data); };
  mr.onstop = () => { seg.stopped = true; finishSegment(A, seg); };
  mr.onerror = ev => { console.warn('MediaRecorder error', ev.error || ev); recInterrupted('the recorder hit an error (' + ((ev.error && ev.error.name) || 'unknown') + ')'); };
  mr.start(REC_SLICE); seg.mime = mr.mimeType || A.mime || 'audio/mp4';
}
async function encChunk(noteId, id, data) {
  if (!lockedOpen(noteId)) return { data };
  const iv = rand(12), ct = await subtle.encrypt(gcm(iv, 'chunk:' + id), LK.open.get(noteId).dk, data);
  return { data: ct, enc: { iv: b64(iv) } };
}
function saveChunk(A, seg, blob) {
  if (R.unloading) return;
  seg.chunks.push(blob); const id = `rch_${A.recId}_${seg.idx}_${seg.n++}`; seg.ids.push(id);
  seg.dur = Math.round(recElapsed(A) - seg.start);
  const job = (async () => { const e = await encChunk(A.noteId, id, await blob.arrayBuffer()); await DB.put('assets', { id, ...e, type: seg.mime || blob.type, size: blob.size, createdAt: Date.now(), chunk: 1 }); })()
    .catch(err => { console.warn('chunk save failed', err); if (/quota/i.test(String(err && (err.name || err.message)))) toast('⚠︎ Storage is full — the recording can’t be saved safely. Stop, Export a backup, then delete old recordings.', 6000); });
  seg.saving = Promise.all([seg.saving, job]);
  localStorage.setItem('recActive', JSON.stringify({ noteId: A.noteId, pageId: A.pageId, recId: A.recId, start: seg.start, dur: seg.dur, ids: seg.ids, mime: seg.mime, at: Date.now() }));
}
async function finishSegment(A, seg) {
  if (seg.finished) return; seg.finished = true;
  await seg.saving;
  const blob = new Blob(seg.chunks, { type: seg.mime }), dur = Math.max(0, Math.round(seg.endAt != null ? seg.endAt - seg.start : (seg.dur || 0)));
  if (blob.size) {
    const asset = await Assets.put(blob);
    let f = findRec(A.recId);
    if (!f) { const n = S.notes.find(x => x.id === A.noteId); if (n && !recNoteLocked(n)) { const p = makeTemplatePage('recording', n); p.rec.id = A.recId; n.pages.push(p); f = findRec(A.recId); if (n.id === S.cur) buildPages(); } }
    if (f) { const r = f.rec; r.segs.push({ asset, mime: seg.mime, start: seg.start, dur, bytes: blob.size }); r.segs.sort((a, b) => a.start - b.start); r.dur = Math.max(r.dur || 0, seg.start + dur); saveNote(f.n); }
  }
  for (const id of seg.ids) DB.del('assets', id).catch(() => {});
  const st = JSON.parse(localStorage.getItem('recActive') || 'null'); if (st && st.recId === A.recId && st.start === seg.start) localStorage.removeItem('recActive');
  if (seg.after) seg.after();
}
function recTick(A) {
  if (R.active !== A) return;
  if (!A.paused && A.seg && performance.now() - A.runAt + A.segMs >= (window.__recSegMs || REC_SEG_MS)) {   // roll over to a new self-contained part
    const old = A.seg, now = recElapsed(A); old.endAt = now; A.base = now; A.segMs = 0; A.runAt = performance.now();
    try { old.mr.stop(); } catch (_) {} startSegment(A);
  }
  updateRecUI();
}
function recPause() { const A = R.active; if (!A) return; if (!A.paused) { A.segMs += performance.now() - A.runAt; A.paused = true; try { A.seg.mr.pause(); } catch (_) {} stopLive(A); }
  else { A.runAt = performance.now(); A.paused = false; try { A.seg.mr.resume(); } catch (_) {} startLive(A); } rerenderRec(); syncMini(); }
function recStop(reason) {
  const A = R.active; if (!A || A.stopping) return Promise.resolve(); A.stopping = true;
  const t = recElapsed(A); A.seg.endAt = t; clearInterval(A.tick); stopLive(A);
  return new Promise(done => {
    A.seg.after = () => {
      A.stream.getTracks().forEach(x => { try { x.stop(); } catch (_) {} });
      stopMeter(A); wakeOff(A); R.active = null;
      const f = findRec(A.recId);
      if (f) { const r = f.rec; r.status = 'done'; if (reason) (r.interrupted ||= []).push({ t: Math.round(t), reason, at: Date.now() }); saveNote(f.n); }
      rerenderRec(); syncMini(); done();
      if (reason) infoSheet('⚠︎ Recording stopped', `<p>Recording stopped at <b>${mmss(t)}</b> because ${esc(reason)}.</p><p>Everything up to then is saved. Tap <b>⏺ Continue</b> to keep recording — it adds a new part to the same recording.</p><p class="fine">iPadOS only lets web apps use the microphone while they’re on screen. Keep Pencil Notes open and the screen awake during meetings.</p>`);
      else toast(`🎙 Saved ${mmss(t)} of audio`);
      if (f && !reason && sttCfg().auto) setTimeout(() => analyzeRec(f.rec.id), 300);
    };
    if (A.seg.stopped) finishSegment(A, A.seg); else { try { A.seg.mr.state === 'inactive' ? finishSegment(A, A.seg) : A.seg.mr.stop(); } catch (_) { finishSegment(A, A.seg); } }
  });
}
function recInterrupted(reason) { if (R.active && !R.active.stopping) recStop(reason); }
document.addEventListener('visibilitychange', () => {
  const A = R.active; if (!A) return;
  if (document.hidden) { A.hiddenAt = Date.now(); if (!R.unloading) try { A.seg.mr.requestData(); } catch (_) {} return; }
  wakeOn(A); const tr = A.stream.getAudioTracks()[0];
  if (!tr || tr.readyState === 'ended' || tr.muted || A.seg.mr.state === 'inactive') recInterrupted('iPadOS turned the microphone off while Pencil Notes was in the background or the screen was locked');
  else if (!A.sr && A.liveState === 'on') startLive(A);
});
window.addEventListener('beforeunload', () => { R.unloading = true; });

/* level meter + wake lock */
function startMeter(A) {
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { const ac = A.ac = new AC(), src = ac.createMediaStreamSource(A.stream), an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); A.an = an; A.buf = new Uint8Array(an.fftSize); if (ac.state === 'suspended') ac.resume().catch(() => {}); } } catch (_) {}
  const loop = () => { if (R.active !== A) return; let lv = 0; if (A.an && !A.paused) { A.an.getByteTimeDomainData(A.buf); let s = 0; for (const v of A.buf) { const d = (v - 128) / 128; s += d * d; } lv = Math.min(1, Math.sqrt(s / A.buf.length) * 4); }
    A.level = A.level ? A.level * 0.6 + lv * 0.4 : lv; document.querySelectorAll('.rc-meter i').forEach(el => el.style.width = Math.round(A.level * 100) + '%'); A.raf = requestAnimationFrame(loop); };
  A.raf = requestAnimationFrame(loop);
}
function stopMeter(A) { cancelAnimationFrame(A.raf); try { A.ac && A.ac.close(); } catch (_) {} }
function wakeOn(A) { if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(l => { A.wake = l; }).catch(() => { A.wake = null; }); }
function wakeOff(A) { try { A.wake && A.wake.release(); } catch (_) {} A.wake = null; }

/* live captions (Safari webkitSpeechRecognition) */
function startLive(A) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!sttCfg().live) { A.liveState = 'off'; return; } if (!SR) { A.liveState = 'unsupported'; return; } if (A.liveState === 'conflict' || A.liveState === 'blocked') return;
  const sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-US';
  const gen = ++A.srGen;
  sr.onresult = e => {
    const f = findRec(A.recId); if (!f) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], k = gen + ':' + i; if (!A.srT.has(k)) A.srT.set(k, Math.max(0, Math.round(recElapsed(A) - 1500)));
      if (r.isFinal) { const text = (r[0] && r[0].transcript || '').trim(); if (text) { f.rec.live.push({ t: A.srT.get(k), text }); saveNote(f.n); } A.interim = ''; }
      else A.interim = r[0] ? r[0].transcript : '';
    }
    updateLiveUI(A);
  };
  sr.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') liveOff(A, 'blocked'); };
  sr.onend = () => { if (A.sr === sr && R.active === A && !A.paused && !A.stopping) setTimeout(() => { if (A.sr === sr && R.active === A && !A.paused) try { sr.start(); A.srAt = performance.now(); } catch (_) {} }, 300); };
  try { sr.start(); A.sr = sr; A.srAt = performance.now(); A.liveState = 'on'; } catch (_) { A.liveState = 'unsupported'; }
}
function stopLive(A) { const sr = A.sr; A.sr = null; if (sr) try { sr.onend = null; sr.stop(); } catch (_) {} }
function liveOff(A, why) { stopLive(A); A.liveState = why; rerenderRec(); if (why === 'conflict') toast('Live captions turned off — on this iPad they block the recording mic. Your recording continues; transcribe it after you stop.', 6000); }

/* ---------- crash / kill recovery ---------- */
async function recRecover() {
  let st; try { st = JSON.parse(localStorage.getItem('recActive') || 'null'); } catch (_) {} if (!st || R.active) return;
  const n = S.notes.find(x => x.id === st.noteId); if (!n) { localStorage.removeItem('recActive'); return; }
  if (recNoteLocked(n)) { toast(`Unlock “${n.title}” to recover an interrupted recording`, 4000); return; }
  const parts = [];
  for (const id of st.ids || []) { const r = await DB.get('assets', id); if (!r) continue;
    let data = r.data; if (r.enc) { if (!lockedOpen(n.id)) return; try { data = await subtle.decrypt(gcm(unb64(r.enc.iv), 'chunk:' + id), LK.open.get(n.id).dk, r.data); } catch (_) { continue; } }
    parts.push(data); }
  localStorage.removeItem('recActive');
  if (!parts.length) return;
  const blob = new Blob(parts, { type: st.mime || 'audio/mp4' }), asset = await Assets.put(blob);
  let f = findRec(st.recId); if (!f) { const p = makeTemplatePage('recording', n); p.rec.id = st.recId; n.pages.push(p); f = findRec(st.recId); }
  const r = f.rec; r.segs.push({ asset, mime: blob.type, start: st.start, dur: st.dur || 0, bytes: blob.size }); r.segs.sort((a, b) => a.start - b.start);
  r.dur = Math.max(r.dur || 0, st.start + (st.dur || 0)); r.status = 'done'; (r.interrupted ||= []).push({ t: r.dur, reason: 'Pencil Notes was closed or reloaded while recording', at: Date.now() });
  saveNote(f.n, true); for (const id of st.ids) DB.del('assets', id).catch(() => {});
  if (f.n.id === S.cur) buildPages();
  toast(`🎙 Recovered ${mmss(st.dur)} from an interrupted recording in “${f.n.title}”`, 5000);
}
window.addEventListener('load', () => setTimeout(() => recRecover().catch(e => console.warn('recover', e)), 900));

/* ---------- undo never loses audio: keep the newest pg.rec through undo/redo ---------- */
const _recRestore = restore;
restore = function (from, to) {
  const keep = new Map(); const n = curNote(); if (n) for (const pg of n.pages) if (pg.rec) keep.set(pg.rec.id, pg.rec);
  const out = _recRestore(from, to);
  const m = curNote(); if (m) { let ch = false; for (const pg of m.pages) if (pg.rec && keep.has(pg.rec.id) && keep.get(pg.rec.id) !== pg.rec) { pg.rec = keep.get(pg.rec.id); ch = true; } if (ch) { saveNote(m); rerenderRec(); } }
  return out;
};

/* ---------- player ---------- */
function playerFor(recId) { if (!R.player || R.player.recId !== recId) { stopPlayer(); R.player = { recId, pos: 0, playing: false, rate: +(localStorage.getItem('recRate') || 1), audio: null, segI: -1 }; } return R.player; }
function releaseAudio(a, url) { try { a.pause(); a.onended = a.ontimeupdate = null; a.removeAttribute('src'); a.load(); } catch (_) {} if (url) setTimeout(() => URL.revokeObjectURL(url), 1500); }
function stopPlayer() { const P = R.player; if (!P) return; if (P.audio) releaseAudio(P.audio, P.url); R.player = null; }
async function loadSeg(P, rec, i) {
  if (P.segI === i && P.audio) return true;
  const g = rec.segs[i]; const b = g && await Assets.blob(g.asset); if (!b) { toast(g ? 'This recording’s audio isn’t on this device (restored from a backup without audio?)' : 'Nothing recorded yet'); return false; }
  if (P.audio) releaseAudio(P.audio, P.url);
  const a = P.audio = new Audio(); P.url = URL.createObjectURL(b); a.src = P.url; a.preload = 'auto'; P.segI = i; a.playbackRate = P.rate;
  a.ontimeupdate = () => { if (P.audio === a && P.segI === i && P.playing) { P.pos = g.start + a.currentTime * 1000; updatePlayUI(); } };
  a.onended = () => { if (P.audio !== a) return; if (i + 1 < rec.segs.length) playAt(rec.id, rec.segs[i + 1].start); else { P.playing = false; P.pos = rec.dur; rerenderRec(); } };
  return true;
}
const segIndexAt = (rec, ms) => { let k = 0; rec.segs.forEach((g, i) => { if (ms >= g.start) k = i; }); return k; };
async function playAt(recId, ms) {
  const f = findRec(recId); if (!f || !f.rec.segs.length) return; const rec = f.rec, P = playerFor(recId);
  P.pos = Math.max(0, Math.min(rec.dur, ms)); const i = segIndexAt(rec, P.pos);
  if (!(await loadSeg(P, rec, i))) return;
  const a = P.audio, off = (P.pos - rec.segs[i].start) / 1000;
  P.playing = true; rerenderRec();
  const go = () => { try { a.currentTime = off; } catch (_) {} a.playbackRate = P.rate; const pr = a.play(); if (pr && pr.catch) pr.catch(err => { if (err && err.name === 'NotAllowedError') { P.playing = false; rerenderRec(); toast('Tap ▶ to play'); } }); };
  if (a.readyState >= 1) go(); else { a.addEventListener('loadedmetadata', go, { once: true }); a.addEventListener('error', () => { if (P.audio === a) { P.playing = false; rerenderRec(); toast('This audio can’t be played on this device'); } }, { once: true }); try { a.load(); } catch (_) {} }
}
function pausePlay(recId) { const P = R.player; if (P && P.recId === recId) { P.playing = false; if (P.audio) P.audio.pause(); rerenderRec(); } }
function seekTo(recId, ms) { const P = playerFor(recId); if (P.playing) playAt(recId, ms); else { const f = findRec(recId); P.pos = Math.max(0, Math.min(f ? f.rec.dur : 0, ms)); updatePlayUI(); } }
function setRate(recId, r) { const P = playerFor(recId); P.rate = r; localStorage.setItem('recRate', r); if (P.audio) P.audio.playbackRate = r; rerenderRec(); }

/* tap ink to jump (while "Tap ink to replay" is on) */
function strokeAt(pg, p, tol = 26) {
  let best = null, bd = tol;
  for (const s of pg.strokes || []) { if (s.t == null) continue; const bb = s.bb || bbox(s.points); if (bb && (p[0] < bb[0] - tol || p[0] > bb[2] + tol || p[1] < bb[1] - tol || p[1] > bb[3] + tol)) continue;
    for (const q of s.points) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = s; } } }
  return best;
}
const noteRecs = n => n ? n.pages.filter(pg => pg.rec && pg.rec.segs && pg.rec.segs.length).map(pg => pg.rec) : [];
const recForTime = (n, t) => { const rs = noteRecs(n); return rs.find(r => t <= r.dur + 2000) || rs[0]; };
PAGES.addEventListener('pointerdown', e => {
  if (!R.replay || e.button > 0) return; const page = e.target.closest('.page'); if (!page || e.target.closest('.rc-panel, .as-layer, .page-foot, button, input, textarea')) return;
  e.preventDefault(); e.stopPropagation(); R.tap = { x: e.clientX, y: e.clientY, pi: +page.dataset.pi, id: e.pointerId };
}, true);
PAGES.addEventListener('pointerup', e => {
  const t = R.tap; if (!t || t.id !== e.pointerId) return; R.tap = null; if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 14) return;
  const n = curNote(), pg = n && n.pages[t.pi], rec = pageEls[t.pi]; if (!pg || !rec) return;
  const s = strokeAt(pg, toPage(e, rec.base));
  if (!s) { toast('No ink from the recording there — tap something you wrote while recording'); return; }
  const r = recForTime(n, s.t); if (!r) { toast('That recording’s audio isn’t available'); return; }
  flashStroke(t.pi, s); playAt(r.id, Math.max(0, s.t - 1500));
}, true);
function flashStroke(pi, s) {
  const rec = pageEls[pi]; if (!rec) return; const bb = s.bb || bbox(s.points), sc = S.scale, d = document.createElement('div'); d.className = 'rc-flash';
  Object.assign(d.style, { left: (bb[0] - 10) * sc + 'px', top: (bb[1] - 10) * sc + 'px', width: (bb[2] - bb[0] + 20) * sc + 'px', height: (bb[3] - bb[1] + 20) * sc + 'px' });
  rec.ov.append(d); setTimeout(() => d.remove(), 1200);
}
function setReplay(on) { R.replay = on; document.body.classList.toggle('rc-replaying', on); rerenderRec(); if (on) hint('🔊 Tap ink you wrote while recording to hear that moment · tap “Tap ink to replay” again to write'); }

/* ---------- panel on the page ---------- */
const liveTail = (rec, A) => { const l = rec.live.slice(-2).map(x => x.text).join(' '); return ((l ? l + ' ' : '') + (A.interim || '')).slice(-220) || 'Listening…'; };
function recPanelHTML(n, pg, compact) {
  const rec = pg.rec, A = R.active && R.active.recId === rec.id ? R.active : null, P = R.player && R.player.recId === rec.id ? R.player : null, busy = R.busy.get(rec.id), err = R.lastErr.get(rec.id);
  const has = rec.segs.length > 0, brief = briefPagesOf(n, rec.id).length, other = R.active && !A;
  if (A) {
    const live = A.liveState === 'on' ? `<div class="rc-live" aria-live="polite"><span class="rc-lbl">CC Live · Safari speech recognition, may miss words</span><span class="rc-lt">${esc(liveTail(rec, A))}</span></div>`
      : `<div class="rc-live"><span class="rc-lbl">${A.liveState === 'conflict' ? 'Live captions off (they block the mic on this iPad)' : A.liveState === 'blocked' ? 'Live captions blocked — allow Speech Recognition for Safari' : A.liveState === 'unsupported' ? 'Live captions aren’t available in this browser' : 'Live captions off'}${sttLabel() ? ' · full transcript after you stop' : ''}</span></div>`;
    return `<div class="rc-row"><span class="rc-dot ${A.paused ? 'paused' : ''}"></span><b class="rc-time">${mmss(recElapsed(A))}</b><span class="rc-meter" aria-hidden="true"><i></i></span>
      <button class="rc-btn" data-rc="pause">${A.paused ? '▶ Resume' : '⏸ Pause'}</button><button class="rc-btn stop" data-rc="stop">⏹ Stop</button></div>
      ${compact ? '' : live + '<p class="rc-fine">Keep Pencil Notes open and the screen on · ink you write now is linked to this moment</p>'}`;
  }
  const intr = (rec.interrupted || []).slice(-1)[0];
  if (!has) return `<div class="rc-row"><button class="rc-rec" data-rc="rec" ${other ? 'disabled' : ''} aria-label="Start recording">⏺</button><div class="rc-intro"><b>${other ? 'Another recording is running' : rec.audioDeleted ? 'Audio deleted · record again' : 'Record this meeting'}</b>${compact ? '' : '<span>Ask everyone first · ink you write is synced to the audio · live captions + optional AI transcript</span>'}</div>${rec.transcript && brief ? '<button class="rc-chip" data-rc="brief">📋 Meeting Brief</button>' : ''}</div>`;
  return `<div class="rc-row"><button class="rc-play" data-rc="${P && P.playing ? 'pause-play' : 'play'}" aria-label="${P && P.playing ? 'Pause' : 'Play'}">${P && P.playing ? '⏸' : '▶'}</button>
      <input class="rc-scrub" type="range" min="0" max="${Math.round(rec.dur)}" step="100" value="${Math.round(P ? P.pos : 0)}" aria-label="Playback position"><span class="rc-pt">${mmss(P ? P.pos : 0)} / ${mmss(rec.dur)}</span>
      ${compact ? '' : `<span class="rc-rates">${[1, 1.5, 2].map(r => `<button class="rc-chip ${(P ? P.rate : +(localStorage.getItem('recRate') || 1)) === r ? 'on' : ''}" data-rc="rate" data-r="${r}">${r}×</button>`).join('')}</span>`}</div>
    <div class="rc-row rc-acts"><button class="rc-chip ${R.replay ? 'on' : ''}" data-rc="replay" aria-pressed="${R.replay}">✍︎ Tap ink to replay</button>
      <button class="rc-chip" data-rc="rec" ${other ? 'disabled' : ''}>⏺ Continue</button>
      ${busy ? `<span class="rc-busy">⏳ ${esc(busy)}</span>` : brief ? `<button class="rc-chip" data-rc="brief">📋 Meeting Brief</button>${compact ? '' : '<button class="rc-chip" data-rc="analyze">↻ Redo</button>'}` : `<button class="rc-chip pri" data-rc="analyze">✨ Transcribe &amp; summarize</button>`}
      <button class="rc-chip" data-rc="more" aria-label="More recording options">⋯</button></div>
    ${compact ? '' : `<p class="rc-fine">${rec.segs.length > 1 ? rec.segs.length + ' parts · ' : ''}${new Date(rec.startedAt || rec.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${rec.transcript ? ' · transcript: ' + esc(rec.transcript.engine) : rec.live.length ? ' · live captions: ' + rec.live.length + ' lines' : ''}</p>`}
    ${intr && !compact ? `<p class="rc-warn">⚠︎ Stopped at ${mmss(intr.t)}: ${esc(intr.reason)}. Audio up to then is saved.</p>` : ''}${err && !compact ? `<p class="rc-warn">✗ ${esc(err)}</p>` : ''}`;
}
function renderRecPanel(pi) {
  const n = curNote(), pg = n && n.pages[pi], el = pageEls[pi]; if (!el) return;
  el.ov.querySelectorAll('.rc-layer').forEach(x => x.remove()); if (!pg || !pg.rec || recNoteLocked(n)) return;
  const s = S.scale, compact = !isRecPage(pg), L = document.createElement('div'); L.className = 'rc-layer'; L.style.fontSize = (20 * s) + 'px';
  const box = compact ? { x: 500, y: 14, w: 480 } : { x: 24, y: 24, w: PAGE_W - 48 };
  L.innerHTML = `<div class="rc-panel ${compact ? 'compact' : ''} ${R.active && R.active.recId === pg.rec.id ? 'live' : ''}" data-rec="${pg.rec.id}" style="left:${box.x * s}px;top:${box.y * s}px;width:${box.w * s}px">${compact ? '' : '<div class="rc-title">🎙 Meeting Recording</div>'}${recPanelHTML(n, pg, compact)}</div>`;
  el.ov.append(L);
}
const rerenderRec = () => { const n = curNote(); if (n) n.pages.forEach((pg, i) => { if (pg.rec) renderRecPanel(i); else if (pg.assist && pg.assist.brief) renderAssist(i); }); syncMini(); };
function updateRecUI() { const A = R.active; if (!A) return; document.querySelectorAll(`.rc-panel[data-rec="${A.recId}"] .rc-time, #recMini .rc-time`).forEach(el => el.textContent = mmss(recElapsed(A))); }
function updateLiveUI(A) { const f = findRec(A.recId); if (!f) return; document.querySelectorAll(`.rc-panel[data-rec="${A.recId}"] .rc-lt`).forEach(el => el.textContent = liveTail(f.rec, A)); }
function updatePlayUI() { const P = R.player; if (!P) return; const f = findRec(P.recId); document.querySelectorAll(`.rc-panel[data-rec="${P.recId}"]`).forEach(p => { const sc = p.querySelector('.rc-scrub'); if (sc && document.activeElement !== sc) sc.value = Math.round(P.pos); const t = p.querySelector('.rc-pt'); if (t && f) t.textContent = mmss(P.pos) + ' / ' + mmss(f.rec.dur); }); }
const _rcOverlayHook = v7OverlayHook;
v7OverlayHook = function (pi) { _rcOverlayHook(pi); const n = curNote(); if (n && n.pages[pi] && n.pages[pi].rec) renderRecPanel(pi); if (R.player && !findRec(R.player.recId)) stopPlayer(); };
PAGES.addEventListener('input', e => { const sc = e.target.closest && e.target.closest('.rc-scrub'); if (sc) seekTo(sc.closest('.rc-panel').dataset.rec, +sc.value); });
PAGES.addEventListener('pointerdown', e => { if (e.target.closest('.rc-panel')) e.stopPropagation(); });
PAGES.addEventListener('click', e => {
  const b = e.target.closest('[data-rc]'); if (!b || !b.closest('.rc-panel')) return; e.stopPropagation();
  const recId = b.closest('.rc-panel').dataset.rec, f = findRec(recId); if (!f) return; const a = b.dataset.rc;
  if (a === 'rec') recStart(f.pi); else if (a === 'pause') recPause(); else if (a === 'stop') recStop();
  else if (a === 'play') playAt(recId, R.player && R.player.recId === recId && R.player.pos < f.rec.dur - 300 ? R.player.pos : 0); else if (a === 'pause-play') pausePlay(recId);
  else if (a === 'rate') setRate(recId, +b.dataset.r); else if (a === 'replay') setReplay(!R.replay);
  else if (a === 'analyze') analyzeRec(recId); else if (a === 'brief') gotoBrief(recId);
  else if (a === 'more') actionSheet('Recording', [
    { label: '⚙︎ Recording & transcription settings…', fn: recSettings },
    { label: '✏️ Rename speakers…', fn: () => speakerList(recId) },
    { label: '⬇︎ Save audio file' + (f.rec.segs.length > 1 ? 's' : ''), fn: () => saveAudio(recId) },
    { label: '🗑 Delete audio (keep notes & transcript)', danger: true, fn: () => deleteAudio(recId) }]);
});
async function saveAudio(recId) { const f = findRec(recId); for (const [i, g] of f.rec.segs.entries()) { const b = await Assets.blob(g.asset); if (!b) continue; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(f.n.title || 'meeting').replace(/[^\w\- ]+/g, '').trim() || 'meeting'}${f.rec.segs.length > 1 ? '-part' + (i + 1) : ''}.${mimeExt(g.mime)}`; document.body.append(a); a.click(); a.remove(); } }
function deleteAudio(recId) { const f = findRec(recId); if (!f) return; stopPlayer(); const ids = f.rec.segs.map(g => g.asset); f.rec.segs = []; f.rec.audioDeleted = Date.now(); saveNote(f.n, true); for (const id of ids) if (!S.notes.some(n => n.pages.some(pg => pageAssetIds(pg).includes(id)))) DB.del('assets', id).catch(() => {}); rerenderRec(); toast('Audio deleted — notes, transcript and brief kept'); }

/* floating mini bar (always reachable while recording) */
function syncMini() {
  let m = document.getElementById('recMini'); const A = R.active;
  if (!A) { if (m) m.hidden = true; return; }
  if (!m) { m = document.createElement('div'); m.id = 'recMini'; m.setAttribute('role', 'status'); document.body.append(m);
    m.onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; if (b.dataset.m === 'pause') recPause(); else if (b.dataset.m === 'stop') recStop(); else gotoRec(); }; }
  m.hidden = false; m.innerHTML = `<button class="rc-mgo" data-m="go" aria-label="Go to recording"><span class="rc-dot ${A.paused ? 'paused' : ''}"></span><b class="rc-time">${mmss(recElapsed(A))}</b></button><button data-m="pause" aria-label="${A.paused ? 'Resume' : 'Pause'}">${A.paused ? '▶' : '⏸'}</button><button data-m="stop" aria-label="Stop">⏹</button>`;
}
function gotoRec() { const A = R.active; if (!A) return; if (S.cur !== A.noteId) openNote(A.noteId); const f = findRec(A.recId); if (f && pageEls[f.pi]) pageEls[f.pi].el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }

/* top-bar 🎙 */
function recButton() {
  if (R.active) { gotoRec(); return; }
  const n = curNote(); if (!n) { toast('Open or create a note first'); return; } if (recNoteLocked(n)) { toast('Unlock the note first'); return; }
  const pi = typeof currentPageIndex === 'function' ? currentPageIndex() : 0, pg = n.pages[pi];
  if (pg && pg.rec && !pg.rec.segs.length) { pageEls[pi] && pageEls[pi].el.scrollIntoView({ block: 'start' }); recStart(pi); return; }
  const canHere = pg && !pg.board && !isAssistPage(pg) && !pg.rec;
  actionSheet('🎙 Record', [
    { label: '🎙 New Meeting Recording page', sub: 'Big controls, live captions, room for notes', primary: true, fn: () => { pushHistory(); const p = makeTemplatePage('recording', n); n.pages.splice(pi + 1, 0, p); saveNote(n, true); buildPages(); renderAll(); requestAnimationFrame(() => { pageEls[pi + 1].el.scrollIntoView({ block: 'start' }); recStart(pi + 1); }); } },
    ...(pg && pg.rec ? [{ label: '⏺ Continue recording on this page', fn: () => recStart(pi) }] : canHere ? [{ label: '⏺ Record on this page', sub: 'Adds a small recorder in the top corner', fn: () => { pushHistory(); pg.rec = newRec(); saveNote(n, true); renderOverlay(pi); recStart(pi); } }] : []),
    { label: '⚙︎ Recording & transcription settings…', fn: recSettings }]);
}

/* ---------- transcription ---------- */
async function sttRequest(cfg, blob, mime) {
  const fd = new FormData(); fd.append('model', cfg.model);
  if (cfg.api === 'xai') fd.append('diarize', 'true');
  else if (/diariz/i.test(cfg.model)) { fd.append('response_format', 'diarized_json'); fd.append('chunking_strategy', 'auto'); }
  else if (/whisper/i.test(cfg.model)) { fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'segment'); }
  else fd.append('response_format', 'json');
  fd.append('file', blob, 'meeting.' + mimeExt(mime));      // xAI: file must be the last field
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 300000);
  try {
    const res = await fetch(cfg.base.replace(/\/+$/, '') + (cfg.api === 'xai' ? '/stt' : '/audio/transcriptions'), { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key }, body: fd, signal: ctl.signal });
    if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 300); } catch (_) {} const e = new Error(res.status === 401 ? 'the transcription key was rejected (401)' : res.status === 413 ? 'the audio part is too large for this provider' : res.status === 429 ? 'rate limited — try again in a minute' : 'transcription failed (HTTP ' + res.status + ')'); e.status = res.status; e.detail = d; throw e; }
    return await res.json();
  } catch (e) { if (e.name === 'AbortError') throw new Error('transcription timed out'); if (e instanceof TypeError) throw new Error('couldn’t reach the transcription service (offline, or it blocks browser requests)'); throw e; }
  finally { clearTimeout(to); }
}
function parseSTT(j, off, durMs) {
  const sp = v => { if (v == null || v === '') return null; if (typeof v === 'number') return String(v + 1); const m = String(v).match(/\d+/); return m ? String(+m[0] + 1) : String(Math.max(1, String(v).toUpperCase().charCodeAt(0) - 64)); };
  const out = [];
  if (Array.isArray(j.words) && j.words.length) {
    let cur = null;
    for (const w of j.words) {
      const s = sp(w.speaker), t = off + (w.start || 0) * 1000, text = String(w.text || w.word || '').trim(); if (!text) continue;
      const brk = !cur || s !== cur.sp || t - cur.end > 1500 || (cur.n > 45 && /[.?!]$/.test(cur.text));
      if (brk) { cur = { t: Math.round(t), end: Math.round(off + (w.end || w.start || 0) * 1000), sp: s, text, n: 1 }; out.push(cur); }
      else { cur.text += (/^[.,!?;:%)]/.test(text) ? '' : ' ') + text; cur.end = Math.round(off + (w.end || w.start || 0) * 1000); cur.n++; }
    }
    out.forEach(x => delete x.n); return out;
  }
  if (Array.isArray(j.segments) && j.segments.length) return j.segments.map(g => ({ t: Math.round(off + (g.start || 0) * 1000), end: Math.round(off + (g.end || 0) * 1000), sp: sp(g.speaker), text: String(g.text || '').trim() })).filter(x => x.text);
  const sents = String(j.text || '').match(/[^.!?]+[.!?]*\s*/g) || [], total = sents.join('').length || 1; let acc = 0;
  return sents.map(x => { const t = off + durMs * acc / total; acc += x.length; return { t: Math.round(t), end: Math.round(off + durMs * acc / total), sp: null, text: x.trim() }; }).filter(x => x.text);
}
async function transcribeRec(rec, prog) {
  const cfg = sttResolved(); if (!cfg) return null;
  const segs = [];
  for (const [i, g] of rec.segs.entries()) {
    prog(`Transcribing${rec.segs.length > 1 ? ` part ${i + 1} of ${rec.segs.length}` : ''} with ${cfg.api === 'xai' ? 'xAI' : cfg.model}…`);
    const b = await Assets.blob(g.asset); if (!b) throw new Error('the audio isn’t on this device');
    segs.push(...parseSTT(await sttRequest(cfg, b, g.mime), g.start, g.dur));
  }
  return { segs, engine: cfg.api === 'xai' ? 'xAI ' + cfg.model : cfg.model, diarized: segs.some(s => s.sp), at: Date.now() };
}
const liveTranscript = rec => ({ segs: rec.live.map((l, i) => ({ t: l.t, end: (rec.live[i + 1] || { t: l.t + 4000 }).t, sp: null, text: l.text })), engine: 'Live captions (Safari)', live: true, at: Date.now() });
const spName = (rec, sp) => sp ? ((rec.speakers[sp] && rec.speakers[sp].name) || 'Speaker ' + sp) : '';
const trLines = (rec, withTime = true) => rec.transcript.segs.map(s => `${withTime ? '[' + mmss(s.t) + '] ' : ''}${s.sp ? spName(rec, s.sp) + ': ' : ''}${s.text}`);
async function inferSpeakers(rec, prog) {   // no diarization from the transcription → Grok labels the speakers
  const segs = rec.transcript.segs; if (segs.length < 2) return;
  prog('Grok is working out who said what…'); const names = {};
  for (let i = 0; i < segs.length; i += 150) {
    const part = segs.slice(i, i + 150);
    const j = await aiJSON([{ role: 'system', content: 'TASK: diarize\nThe numbered lines are consecutive utterances from one meeting recording with no speaker labels. Assign each line to a speaker, using "Speaker 1", "Speaker 2", … consistently (keep labels from earlier parts). If a speaker states or is addressed by their name, put it in "names". Return JSON: {"lines":[{"i":0,"speaker":"Speaker 1"}],"names":{"Speaker 1":"Name"}}' + (Object.keys(names).length ? '\nNames known so far: ' + JSON.stringify(names) : '') },
      { role: 'user', content: part.map((s, k) => `${i + k}: ${s.text}`).join('\n') }]);
    for (const l of j.lines || []) { const s = segs[+l.i]; const m = String(l.speaker || '').match(/(\d+)/); if (s && m) s.sp = m[1]; }
    Object.assign(names, j.names || {});
  }
  for (const [k, v] of Object.entries(names)) { const m = k.match(/(\d+)/); if (m && v && !rec.speakers[m[1]]) rec.speakers[m[1]] = { name: String(v).slice(0, 40), guessed: true }; }
  rec.transcript.speakersBy = aiModel();
}

/* ---------- Grok analysis → Meeting Brief ---------- */
const BRIEF_SHAPE = `{"title":"short meeting title","overview":"3-5 sentence overview","participants":[{"name":"speaker name or label","role":"if stated","key_points":[],"positions":[],"concerns":[],"commitments":[]}],"decisions":[{"text":"","by":""}],"action_items":[{"text":"imperative task","owner":"","due":"ISO 8601 or null","priority":"urgent|high|normal|low"}],"problems":[{"title":"","whys":["why 1","why 2","…up to 5"],"fishbone":{"People":[],"Process":[],"Tools":[],"Environment":[],"Materials":[],"Measurement":[]},"root_cause":"","corrective_actions":[],"preventive_actions":[]}],"risks":[],"open_questions":[],"disagreements":[{"topic":"","sides":["who: position"]}],"other_discussion":[],"solutions":[{"problem":"","options":[{"title":"","pros":[],"cons":[]}],"recommendation":"","next_step":""}],"follow_up_email":{"subject":"","body":"plain-text recap email"}}`;
const briefRules = date => `Rules: participants are the transcript's speakers (use their names/labels exactly as given). Everything except "solutions" must come from the transcript — don't invent facts. For each problem discussed, do a 5-whys root-cause analysis (stop when the root is reached), sort contributing causes into fishbone categories (omit empty ones), then corrective actions (fix this instance) and preventive actions (stop it recurring). In "solutions", reason beyond the transcript: for each problem give 2-3 logical options with pros and cons, your recommendation and one concrete next step. Resolve relative due dates against the meeting date ${date}. Keep bullets short. Empty arrays are fine.`;
async function grokBrief(rec, title, prog) {
  const date = new Date(rec.startedAt || rec.createdAt).toString(), lines = trLines(rec), CH = 45000;
  const chunks = []; let cur = ''; for (const l of lines) { if (cur.length + l.length > CH && cur) { chunks.push(cur); cur = ''; } cur += l + '\n'; } if (cur) chunks.push(cur);
  if (chunks.length <= 1) { prog('Grok is analyzing the meeting…'); return aiJSON([{ role: 'system', content: `TASK: brief\nYou are an expert meeting analyst and problem solver. Analyze the meeting transcript. Return ONLY JSON shaped like:\n${BRIEF_SHAPE}\n${briefRules(date)}${prefsBlock()}` }, { role: 'user', content: `Meeting: ${title}\nDate: ${date}\nLength: ${mmss(rec.dur)}\n\nTranscript:\n${chunks[0] || ''}` }]); }
  const parts = [];   // map-reduce for long meetings
  for (const [i, ch] of chunks.entries()) { prog(`Grok is reading part ${i + 1} of ${chunks.length}…`); parts.push(await aiJSON([{ role: 'system', content: `TASK: brief_part\nYou are analyzing PART ${i + 1} of ${chunks.length} of a long meeting transcript. Extract notes from this part only, as JSON shaped like:\n${BRIEF_SHAPE}\nLeave "solutions" and "follow_up_email" empty. ${briefRules(date)}` }, { role: 'user', content: ch }])); }
  prog('Grok is combining the parts…');
  return aiJSON([{ role: 'system', content: `TASK: brief_merge\nMerge these partial analyses of ONE meeting (in order) into a single analysis: merge each participant across parts, dedupe decisions and action items (later parts win), combine problems, then write the final "overview", "solutions" and "follow_up_email". Return ONLY JSON shaped like:\n${BRIEF_SHAPE}\n${briefRules(date)}${prefsBlock()}` }, { role: 'user', content: `Meeting: ${title}\nDate: ${date}\n\n` + parts.map((p, i) => `PART ${i + 1}:\n${JSON.stringify(p)}`).join('\n\n') }]);
}
function builtinBrief(rec, title) {
  const segs = rec.transcript ? rec.transcript.segs : [], text = segs.map(s => s.text).join('\n'), date = new Date(rec.startedAt || rec.createdAt);
  const r = text ? AssistEngine.extract({ from: 'Meeting', subject: title, text, date, prefs: typeof memPrefs === 'function' ? memPrefs() : {} }) : { summary: '', points: [], actions: [] };
  const by = {}; for (const s of segs) if (s.sp) (by[s.sp] ||= []).push(s.text);
  const pick = rx => segs.filter(s => rx.test(s.text)).map(s => (s.sp ? spName(rec, s.sp) + ': ' : '') + s.text).slice(0, 6);
  return { title, overview: r.summary || (text ? text.slice(0, 300) : 'No transcript yet.'), key_points: r.points || [], builtin: true,
    participants: Object.entries(by).map(([sp, l]) => ({ name: spName(rec, sp), key_points: l.slice().sort((a, b) => b.length - a.length).slice(0, 3), concerns: l.filter(x => /\b(worr|concern|risk|afraid|not sure|problem)/i.test(x)).slice(0, 2), commitments: l.filter(x => /\bI('ll| will| can)\b/i.test(x)).slice(0, 3) })),
    decisions: pick(/\b(we('ll| will)|let'?s|decided|agreed|go with)\b/i).map(t => ({ text: t })), action_items: (r.actions || []).map(a => ({ text: a.text, owner: a.owner || '', due: a.due || null, priority: 'normal' })),
    problems: pick(/\b(problem|issue|bug|broke|fail|delay|blocked|outage|late|complain|crash)/i).map(t => ({ title: t })), risks: pick(/\b(risk|could slip|worried|concern)\b/i), open_questions: segs.filter(s => /\?\s*$/.test(s.text)).map(s => s.text).slice(0, 6) };
}
function normBrief(b) {
  const A = x => Array.isArray(x) ? x.filter(v => v != null && v !== '') : x ? [x] : [], T = x => typeof x === 'string' ? x : x == null ? '' : String(x.text || x.title || JSON.stringify(x));
  b = b && typeof b === 'object' ? b : {};
  return { title: T(b.title), overview: T(b.overview), builtin: !!b.builtin, key_points: A(b.key_points).map(T),
    participants: A(b.participants).map(p => typeof p === 'string' ? { name: p, key_points: [], positions: [], concerns: [], commitments: [] } : { name: T(p.name) || 'Speaker', role: T(p.role), key_points: A(p.key_points).map(T), positions: A(p.positions).map(T), concerns: A(p.concerns).map(T), commitments: A(p.commitments).map(T) }),
    decisions: A(b.decisions).map(d => typeof d === 'string' ? { text: d } : { text: T(d.text), by: T(d.by) }).filter(d => d.text),
    action_items: A(b.action_items).map(a => typeof a === 'string' ? { text: a } : { text: T(a.text), owner: T(a.owner), due: a.due && !isNaN(new Date(a.due)) ? new Date(a.due).toISOString() : null, priority: ['urgent', 'high', 'normal', 'low'].includes(a.priority) ? a.priority : 'normal' }).filter(a => a.text),
    problems: A(b.problems).map(p => typeof p === 'string' ? { title: p } : { title: T(p.title), whys: A(p.whys).map(T), fishbone: p.fishbone && typeof p.fishbone === 'object' ? Object.fromEntries(Object.entries(p.fishbone).map(([k, v]) => [k, A(v).map(T)]).filter(([, v]) => v.length)) : {}, root_cause: T(p.root_cause), corrective_actions: A(p.corrective_actions).map(T), preventive_actions: A(p.preventive_actions).map(T) }),
    risks: A(b.risks).map(T), open_questions: A(b.open_questions).map(T), other_discussion: A(b.other_discussion).map(T),
    disagreements: A(b.disagreements).map(d => typeof d === 'string' ? { topic: d, sides: [] } : { topic: T(d.topic), sides: A(d.sides).map(T) }),
    solutions: A(b.solutions).map(s => ({ problem: T(s.problem), options: A(s.options).map(o => ({ title: T(o.title), pros: A(o.pros).map(T), cons: A(o.cons).map(T) })), recommendation: T(s.recommendation), next_step: T(s.next_step) })),
    follow_up_email: b.follow_up_email && typeof b.follow_up_email === 'object' ? { subject: T(b.follow_up_email.subject), body: T(b.follow_up_email.body) } : null };
}
function builtinRecap(b, title) {
  const L = (h, l) => l.length ? `\n${h}\n${l.map(x => '• ' + x).join('\n')}\n` : '', me = typeof memPrefs === 'function' ? memPrefs().me : '';
  return { subject: 'Recap: ' + title, body: `Hi all,\n\nThanks for your time today. Here’s a quick recap of “${title}”.\n\n${b.overview || ''}\n${L('Decisions', b.decisions.map(d => d.text))}${L('Action items', b.action_items.map(a => a.text + (a.owner ? ' — ' + a.owner : '') + (a.due ? ' (by ' + fmtDueShort(a.due) + ')' : '')))}${L('Open questions', b.open_questions)}\nLet me know if I missed anything.${me ? '\n\n' + me : ''}` };
}
async function analyzeRec(recId) {
  let f = findRec(recId); if (!f || R.busy.has(recId)) return;
  if (R.active && R.active.recId === recId) { toast('Stop the recording first'); return; }
  const prog = m => { R.busy.set(recId, m); rerenderRec(); };
  R.lastErr.delete(recId); let warn = '';
  try {
    prog('Preparing…'); const rec = f.rec;
    if (sttResolved() && rec.segs.length) { try { rec.transcript = await transcribeRec(rec, prog); } catch (e) { warn = 'Transcription: ' + e.message + (rec.live.length ? ' — used live captions instead' : ''); if (!rec.live.length) throw new Error('Transcription: ' + e.message); rec.transcript = liveTranscript(rec); } }
    else if (!rec.transcript || rec.transcript.live) rec.transcript = liveTranscript(rec);
    f = findRec(recId); f.rec.transcript = rec.transcript; saveNote(f.n);
    if (!rec.transcript.segs.length) throw new Error(sttResolved() ? 'No speech was found in the audio.' : 'No transcript: live captions caught nothing. Add an xAI (or OpenAI-compatible) key in Settings → 🎙 Recording & transcription for a full transcript.');
    let brief = null, engine = 'Built-in';
    if (aiReady()) {
      try { if (!rec.transcript.diarized && !rec.transcript.speakersBy) await inferSpeakers(rec, prog); brief = normBrief(await grokBrief(rec, f.n.title || 'Meeting', prog)); engine = aiModel(); }
      catch (e) { warn = (warn ? warn + ' · ' : '') + 'Analysis: ' + (e.name === 'AbortError' ? 'timed out' : e.message) + ' — showing the built-in summary'; brief = null; }
    }
    if (!brief) brief = normBrief(builtinBrief(rec, f.n.title || 'Meeting'));
    f = findRec(recId); f.rec.transcript = rec.transcript; f.rec.brief = { engine, at: Date.now(), warn };
    writeBrief(f, brief, engine, warn);
    if (warn) R.lastErr.set(recId, warn);
    toast(engine === 'Built-in' ? '📋 Meeting Brief ready (built-in — connect Grok in Settings for the full analysis)' : '📋 Meeting Brief ready ✨ ' + engine, 4000);
  } catch (e) { R.lastErr.set(recId, e.message || String(e)); toast('✗ ' + (e.message || e), 5000); }
  finally { R.busy.delete(recId); rerenderRec(); }
}

/* ---------- Meeting Brief pages (assistant pages with pg.assist.brief; cards of kind 'brief') ---------- */
const briefPagesOf = (n, recId) => n ? n.pages.map((pg, i) => [pg, i]).filter(([pg]) => pg.assist && pg.assist.brief && pg.assist.brief.rec === recId) : [];
function gotoBrief(recId) { const f = findRec(recId); if (!f) return; if (f.n.id !== S.cur) openNote(f.n.id); const b = briefPagesOf(curNote(), recId)[0]; if (b && pageEls[b[1]]) pageEls[b[1]].el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
const bcard = (btype, icon, subject, raw, extra = {}) => ({ id: uid('ac'), kind: 'brief', btype, icon, subject, raw, from: 'Meeting Brief', x: 24, y: 0, w: PAGE_W - 48, h: 300, createdAt: Date.now(), ...extra });
const lst = l => (l || []).map(x => '- ' + x).join('\n');
function briefCardsFrom(b, rec, engine) {
  const out = [], E = { engine, rec: rec.id };
  out.push(bcard('overview', '🧭', b.title || 'Overview', b.overview + (b.key_points.length ? '\nKey points:\n' + lst(b.key_points) : ''), { ...E, summary: b.overview, points: b.key_points, builtin: b.builtin, dur: rec.dur }));
  for (const p of b.participants) out.push(bcard('person', '👤', p.name, [p.role, 'Key points:', lst(p.key_points), 'Positions:', lst(p.positions), 'Concerns:', lst(p.concerns), 'Commitments:', lst(p.commitments)].filter(Boolean).join('\n'), { ...E, person: p, w: (PAGE_W - 64) / 2 }));
  if (b.decisions.length) out.push(bcard('decisions', '✅', 'Decisions', lst(b.decisions.map(d => d.text + (d.by ? ' (' + d.by + ')' : ''))), { ...E, decisions: b.decisions }));
  out.push(bcard('actions', '☑️', 'Action items', lst(b.action_items.map(a => a.text + (a.owner ? ' — ' + a.owner : '') + (a.due ? ' — due ' + a.due : ''))), { ...E, actions: b.action_items.map(a => ({ id: uid('aa'), text: a.text, owner: a.owner || '', due: a.due || null, prio: a.priority || 'normal' })) }));
  for (const p of b.problems) out.push(bcard('problem', '🩺', p.title || 'Problem', [p.title, p.root_cause && 'Root cause: ' + p.root_cause, (p.whys || []).length && '5 whys:\n' + lst(p.whys), Object.entries(p.fishbone || {}).map(([k, v]) => k + ': ' + v.join('; ')).join('\n'), (p.corrective_actions || []).length && 'Corrective:\n' + lst(p.corrective_actions), (p.preventive_actions || []).length && 'Preventive:\n' + lst(p.preventive_actions)].filter(Boolean).join('\n'), { ...E, problem: p }));
  if (b.risks.length || b.open_questions.length || b.disagreements.length || b.other_discussion.length)
    out.push(bcard('risks', '⚠︎', 'Risks, open questions & other discussion', ['Risks:', lst(b.risks), 'Open questions:', lst(b.open_questions), 'Disagreements:', lst(b.disagreements.map(d => d.topic + ': ' + d.sides.join(' / '))), 'Other discussion:', lst(b.other_discussion)].join('\n'), { ...E, risks: b.risks, questions: b.open_questions, disagreements: b.disagreements, other: b.other_discussion }));
  if (b.solutions.length) out.push(bcard('solutions', '💡', 'Logical solutions & recommendations', b.solutions.map(s => `Problem: ${s.problem}\n${s.options.map(o => `Option: ${o.title}\n  Pros: ${o.pros.join('; ')}\n  Cons: ${o.cons.join('; ')}`).join('\n')}\nRecommendation: ${s.recommendation}\nNext step: ${s.next_step}`).join('\n\n'), { ...E, solutions: b.solutions }));
  const ai = b.follow_up_email && b.follow_up_email.body, em = ai ? b.follow_up_email : builtinRecap(b, b.title || 'our meeting');
  out.push(bcard('followup', '✉︎', 'Follow-up email', em.subject + '\n\n' + em.body, { ...E, email: { subject: em.subject, body: em.body, by: ai ? engine : 'Built-in' } }));
  out.push(bcard('transcript', '📝', 'Transcript', '', { ...E }));
  return out;
}
function estH(c) {
  if (c.btype === 'transcript') return 700;
  const cpl = c.w > 600 ? 88 : 40, lines = (c.raw || '').split('\n').reduce((k, l) => k + Math.max(1, Math.ceil(l.length / cpl)), 0);
  return Math.max(c.btype === 'followup' ? 340 : 170, Math.min(980, 118 + lines * 29));
}
function writeBrief(f, b, engine, warn) {
  const n = f.n; if (n.id === S.cur) pushHistory();
  for (const [, i] of briefPagesOf(n, f.rec.id).reverse()) n.pages.splice(i, 1);
  const recPi = n.pages.findIndex(pg => pg.rec && pg.rec.id === f.rec.id), cards = briefCardsFrom(b, f.rec, engine), pages = [], TOP = 176;
  const newBriefPage = () => { const p = makeTemplatePage('assistant', n); p.assist.brief = { rec: f.rec.id, title: b.title || n.title, engine, warn: warn || '', at: Date.now() }; pages.push(p); return p; };
  let pg = newBriefPage(), y = TOP, col = 0, rowH = 0;
  const fit = h => { if (y + h > PAGE_H - 24 && y > TOP) { pg = newBriefPage(); y = TOP; } };
  for (const c of cards) {
    c.h = estH(c);
    if (c.w < PAGE_W / 2) { if (col === 1) { c.x = 24 + c.w + 16; c.y = y; rowH = Math.max(rowH, c.h); col = 0; y += rowH + 16; rowH = 0; } else { fit(c.h); c.x = 24; c.y = y; rowH = c.h; col = 1; } }
    else { if (col === 1) { y += rowH + 16; col = 0; rowH = 0; } fit(c.h); c.h = Math.min(c.h, PAGE_H - 24 - y); c.x = 24; c.y = y; y += c.h + 16; }
    pg.assist.cards.push(c);
  }
  n.pages.splice(recPi + 1, 0, ...pages); saveNote(n, true);
  if (n.id === S.cur) { buildPages(); renderAll(); }
}
const ul = (l, cls = '') => l && l.length ? `<ul class="mb-ul ${cls}">${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
const sec = (h, l, cls) => l && l.length ? `<h4>${h}</h4>${ul(l, cls)}` : '';
function briefHeadHTML(pg, s) {
  const B = pg.assist.brief, f = findRec(B.rec), rec = f && f.rec, P = R.player && rec && R.player.recId === rec.id ? R.player : null;
  return `<div class="mb-head as-drop" style="left:${24 * s}px;top:${24 * s}px;width:${(PAGE_W - 48) * s}px;height:${136 * s}px">
    <div class="mb-t1">📋 Meeting Brief</div><div class="mb-t2">${esc(B.title || '')}</div>
    <div class="mb-meta">${rec ? esc(new Date(rec.startedAt || rec.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) + ' · ' + mmss(rec.dur) + ' · ' : ''}<span class="as-eng ${B.engine === 'Built-in' ? '' : 'ai'}">${B.engine === 'Built-in' ? '⚙︎ Built-in' : '✨ ' + esc(B.engine)}</span>${rec && rec.transcript ? ' · transcript: ' + esc(rec.transcript.engine) : ''}${B.warn ? ` <span class="mb-warn" title="${esc(B.warn)}">⚠︎ ${esc(B.warn.slice(0, 90))}</span>` : ''}</div>
    <div class="as-dbtns">${rec && rec.segs.length ? `<button class="as-btn" data-mb="${P && P.playing ? 'pause' : 'play'}">${P && P.playing ? '⏸ Pause' : '▶ Play recording'}</button>` : ''}<button class="as-btn" data-mb="torec">🎙 Recording page</button><button class="as-btn" data-mb="redo">↻ Redo analysis</button><button class="as-btn" data-mb="speakers">✏️ Speakers</button></div></div>`;
}
function briefCardHTML(c, ctx = {}) {
  const f = findRec(c.rec), rec = f && f.rec; let body = '';
  switch (c.btype) {
    case 'overview': body = `<p class="as-sum">${esc(c.summary || '')}</p>${sec('Key points', c.points)}${c.builtin ? `<p class="mb-note">⚙︎ Built-in summary of the transcript. ${aiReady() ? 'Tap ↻ Redo analysis for Grok’s full analysis.' : 'Connect Grok (Settings → ✨ Smarter AI) for each person’s positions, root causes and solutions.'}</p>` : ''}`; break;
    case 'person': { const p = c.person || {}, sp = (String(p.name).match(/^Speaker (\d+)$/) || [])[1];
      body = `${p.role ? `<p class="mb-role">${esc(p.role)}</p>` : ''}${sec('Key points', p.key_points)}${sec('Positions', p.positions)}${sec('Concerns', p.concerns)}${sec('Commitments', p.commitments, 'mb-commit')}${sp ? `<button class="as-btn sm" data-mb="spk" data-sp="${esc(sp)}">✏️ Name this speaker</button>` : ''}`; break; }
    case 'decisions': body = `<ul class="mb-ul mb-dec">${(c.decisions || []).map(d => `<li>✅ ${esc(d.text)}${d.by ? ` <span class="mb-by">— ${esc(d.by)}</span>` : ''}</li>`).join('')}</ul>`; break;
    case 'actions': body = `${actsHTML(c)}<div class="as-arow">${(c.actions || []).length ? '<button class="as-btn" data-aa="sendall">📋 Send all to board…</button>' : ''}<button class="as-btn" data-aa="addact">＋ Add</button></div><p class="mb-note">Hold ⠿ and drag an item onto a 📋 board or 🗓 planner.</p>`; break;
    case 'problem': { const p = c.problem || {};
      body = `${p.root_cause ? `<div class="mb-root"><b>Root cause</b> ${esc(p.root_cause)}</div>` : ''}${(p.whys || []).length ? `<h4>5 whys</h4><ol class="mb-whys">${p.whys.map(w => `<li>${esc(w)}</li>`).join('')}</ol>` : ''}
        ${Object.keys(p.fishbone || {}).length ? `<h4>Contributing causes (fishbone)</h4><div class="mb-fish">${Object.entries(p.fishbone).map(([k, v]) => `<div><b>${esc(k)}</b>${ul(v)}</div>`).join('')}</div>` : ''}
        ${sec('Corrective actions', p.corrective_actions, 'mb-fix')}${sec('Preventive actions', p.preventive_actions, 'mb-prev')}${!p.root_cause && !(p.whys || []).length ? `<p class="mb-note">${aiReady() ? 'Redo the analysis for a root-cause breakdown.' : 'Connect Grok for root cause, corrective and preventive actions.'}</p>` : ''}`; break; }
    case 'risks': body = `${sec('Risks', c.risks)}${sec('Open questions', c.questions)}${(c.disagreements || []).length ? `<h4>Disagreements</h4><ul class="mb-ul">${c.disagreements.map(d => `<li><b>${esc(d.topic)}</b>${d.sides.length ? ': ' + d.sides.map(esc).join(' <i>vs</i> ') : ''}</li>`).join('')}</ul>` : ''}${sec('Other discussion', c.other)}`; break;
    case 'solutions': body = (c.solutions || []).map(s => `<div class="mb-sol"><h4>${esc(s.problem)}</h4>${s.options.map(o => `<div class="mb-opt"><b>${esc(o.title)}</b><div class="mb-pc"><div>${o.pros.map(x => `<span class="mb-pro">✓ ${esc(x)}</span>`).join('')}</div><div>${o.cons.map(x => `<span class="mb-con">✗ ${esc(x)}</span>`).join('')}</div></div></div>`).join('')}
      ${s.recommendation ? `<div class="mb-rec">★ <b>Recommendation</b> ${esc(s.recommendation)}</div>` : ''}${s.next_step ? `<div class="mb-next">➜ <b>Next step</b> ${esc(s.next_step)}</div>` : ''}</div>`).join(''); break;
    case 'followup': { const e = c.email || {}; body = `<p class="mb-subj"><b>Subject:</b> ${esc(e.subject || '')}</p><pre class="mb-mail">${esc(e.body || '')}</pre><div class="as-arow"><button class="as-btn" data-mb="recap">✉︎ Edit &amp; open in Mail</button><button class="as-btn" data-mb="copy">⧉ Copy</button></div><p class="mb-note">${e.by && e.by !== 'Built-in' ? '✨ Drafted by ' + esc(e.by) : '⚙︎ Built-in template'} · Pencil Notes never sends email — Mail opens with this text.</p>`; break; }
    case 'transcript': { const t = rec && rec.transcript;
      body = t ? `<p class="mb-note">${t.live ? 'Live captions (Safari speech recognition) — may miss words.' : '✨ ' + esc(t.engine)}${t.speakersBy ? ' · speakers inferred by ' + esc(t.speakersBy) : t.diarized ? ' · speakers from the transcription service' : ''} · tap a time to play · tap a name to rename</p>
        <div class="mb-tr">${t.segs.map(sg => `<div class="mb-line"><button class="mb-ts" data-mb="seek" data-t="${+sg.t || 0}">${mmss(sg.t)}</button>${sg.sp ? `<button class="mb-sp sp${(+sg.sp - 1) % 6}" data-mb="spk" data-sp="${esc(sg.sp)}">${rec.speakers[sg.sp] && rec.speakers[sg.sp].ink ? `${safeInk(rec.speakers[sg.sp].ink)}` : ''}${esc(spName(rec, sg.sp))}</button>` : ''}<span>${esc(sg.text)}</span></div>`).join('') || '<p class="as-none">No words were transcribed.</p>'}</div>` : '<p class="as-none">No transcript yet.</p>'; break; }
  }
  const cls = ['brief', 'b-' + c.btype, ctx.dim ? 'dim' : '', c.chatOpen ? 'chatting' : ''].join(' ');
  return `<div class="as-card ${cls}" data-card="${c.id}"><div class="as-head" title="Hold to move"><div class="as-hl"><div class="as-from">${c.icon || '📋'} ${esc(c.btype === 'person' ? 'Participant' : c.btype === 'overview' ? 'Overview' : 'Meeting Brief')}</div><div class="as-subj">${esc(c.subject || '')}</div>
      <div class="as-meta"><span class="as-eng ${c.engine === 'Built-in' ? '' : 'ai'}">${c.engine === 'Built-in' ? '⚙︎ Built-in' : '✨ ' + esc(c.engine)}</span>${c.btype === 'overview' && c.dur ? ' · ' + mmss(c.dur) : ''}</div></div>
      <div class="as-hbtns"><button class="as-hb" data-aa="chat" aria-label="Ask about this section" title="Ask about this section">💬</button><button class="as-more" data-aa="menu" aria-label="Card options">⋯</button></div></div>
    <div class="as-body">${body}</div>${c.chatOpen ? chatHTML(c) : ''}<div class="as-resize" aria-label="Resize"></div></div>`;
}
function briefBlock(c) {   // context for 💬 questions about a section
  const f = findRec(c.rec), rec = f && f.rec, tr = rec && rec.transcript ? trLines(rec).join('\n') : '';
  return `Meeting: ${f ? f.n.title : ''}\nDate: ${rec ? new Date(rec.startedAt || rec.createdAt).toString() : ''}\nSection: ${c.subject}\n${c.raw || ''}\n\nFull transcript:\n${tr.slice(0, 30000)}`;
}
PAGES.addEventListener('click', e => {
  const b = e.target.closest('[data-mb]'); if (!b) return; e.stopPropagation();
  const page = b.closest('.page'), pi = +page.dataset.pi, n = curNote(), pg = n.pages[pi], cardEl = b.closest('.as-card'), fc = cardEl && findAsCard(cardEl.dataset.card);
  const recId = (pg.assist && pg.assist.brief && pg.assist.brief.rec) || (fc && fc.c.rec), a = b.dataset.mb;
  if (a === 'play') playAt(recId, R.player && R.player.recId === recId ? R.player.pos : 0); else if (a === 'pause') pausePlay(recId);
  else if (a === 'seek') playAt(recId, +b.dataset.t);
  else if (a === 'torec') { const f = findRec(recId); if (f && pageEls[f.pi]) pageEls[f.pi].el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  else if (a === 'redo') analyzeRec(recId); else if (a === 'speakers') speakerList(recId);
  else if (a === 'spk') renameSpeaker(recId, b.dataset.sp);
  else if (a === 'recap' && fc) openRecap(fc); else if (a === 'copy' && fc) copyText(fc.c.email.subject + '\n\n' + fc.c.email.body);
});
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch (_) { toast('Couldn’t copy — select the text and copy it'); } }

/* ---------- speakers: rename (typed or handwritten) and propagate ---------- */
function speakerList(recId) {
  const f = findRec(recId); if (!f || !f.rec.transcript) { toast('Transcribe the recording first'); return; }
  const ids = [...new Set(f.rec.transcript.segs.map(s => s.sp).filter(Boolean))].sort((a, b) => a - b);
  if (!ids.length) { toast(aiReady() ? 'No speakers were detected' : 'No speakers yet — connect AI (or a transcription service with speakers) and redo the analysis'); return; }
  actionSheet('Rename speakers', ids.map(sp => ({ label: '✏️ ' + spName(f.rec, sp), sub: f.rec.transcript.segs.filter(s => s.sp === sp).length + ' lines', fn: () => renameSpeaker(recId, sp) })));
}
function renameSpeaker(recId, sp) {
  const f = findRec(recId); if (!f) return; const old = spName(f.rec, sp), w = modalWrap('spkWrap'), strokes = [];
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>✏️ Who is ${esc(old)}?</h3>
    <label>Name<input id="spkName" value="${esc(/^Speaker \d+$/.test(old) || old.startsWith('✍︎') ? '' : old)}" placeholder="Type a name…" autocomplete="off"></label>
    <p class="fine">…or write it with Apple Pencil${aiReady() ? ' (read by ' + esc(aiModel()) + ')' : ' (kept as handwriting — connect AI to turn it into text)'}:</p>
    <canvas class="spk-pad" width="600" height="140" aria-label="Write the name"></canvas>
    <div class="sheet-actions"><button class="btn" data-k="clr">Clear ink</button><div class="spacer"></div><button class="btn" data-k="x">Cancel</button><button class="btn primary" data-k="ok">Rename everywhere</button></div></div>`;
  w.hidden = false; const cv = w.querySelector('.spk-pad'), x = cv.getContext('2d'); let cur = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height, e.pressure || .5]; };
  const redraw = () => { x.clearRect(0, 0, cv.width, cv.height); for (const s of strokes) drawStroke(x, s); };
  cv.onpointerdown = e => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {} cur = { tool: 'pen', color: '#e5e7eb', width: 4, points: [pt(e)] }; strokes.push(cur); };
  cv.onpointermove = e => { if (!cur) return; cur.points.push(pt(e)); redraw(); };
  cv.onpointerup = cv.onpointercancel = () => { cur = null; };
  w.onclick = async e => {
    const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k;
    if (k === 'clr') { strokes.length = 0; redraw(); return; } if (k === 'x') { w.hidden = true; return; }
    let name = w.querySelector('#spkName').value.trim(), ink = null;
    if (!name && strokes.length) {
      const png = inkToPNG(strokes, inkBB(strokes));
      if (aiReady()) { b.disabled = true; b.textContent = 'Reading…'; try { name = (await aiTranscribe(png)).trim().split('\n')[0].slice(0, 40); if (/unreadable/i.test(name)) name = ''; } catch (err) { toast(visionMsg(err)); } b.disabled = false; b.textContent = 'Rename everywhere'; }
      if (!name) { ink = png; name = '✍︎ Speaker ' + sp; }
    }
    if (!name) { toast('Type or write a name'); return; }
    w.hidden = true; applySpeakerName(recId, sp, name.replace(/[<>]/g, ''), ink);
  };
}
function applySpeakerName(recId, sp, name, ink) {
  const f = findRec(recId); if (!f) return; const old = spName(f.rec, sp);
  f.rec.speakers[sp] = { name, ...(ink ? { ink } : {}) };
  const q = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rx = new RegExp('(^|[^\\w])' + q(old) + '(?![\\w])', 'g'), labelRx = new RegExp('\\bSpeaker ' + sp + '(?!\\d)', 'g');
  const fix = v => typeof v === 'string' ? v.replace(rx, (m, p) => p + name).replace(labelRx, name) : Array.isArray(v) ? v.map(fix) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ['id', 'rec', 'btype', 'kind', 'engine', 'icon', 'chat'].includes(k) ? x : fix(x)])) : v;
  for (const [pg] of briefPagesOf(f.n, recId)) { pg.assist.cards = pg.assist.cards.map(fix); pg.assist.brief.title = fix(pg.assist.brief.title); }
  saveNote(f.n, true); rerenderRec(); toast(`Renamed ${old} → ${name} everywhere`);
}

/* ---------- recap email (mailto only — the app never sends) ---------- */
function recapHref(v) {
  const to = String(v.to || '').split(/[,;\s]+/).filter(x => /^[^\s@<>"?&]+@[^\s@<>"?&]+$/.test(x)).map(encodeURIComponent).join(',');
  let body = String(v.body || ''); if (body.length > 6000) body = body.slice(0, 6000) + '\n…';
  return `mailto:${to}?subject=${encodeURIComponent(String(v.subject || '').replace(/[\r\n]+/g, ' '))}&body=${encodeURIComponent(body)}`;
}
function openRecap(fc) {
  const c = fc.c, e = c.email || {}, w = modalWrap('recapWrap');
  w.innerHTML = `<div class="sheet as-reply-sheet" role="dialog" aria-modal="true"><h3>✉︎ Follow-up email</h3>
    <label>To<input id="rcTo" value="${esc(e.to || '')}" placeholder="addresses, separated by commas (optional)" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label>Subject<input id="rcSub" value="${esc(e.subject || '')}"></label>
    <label>Message<textarea id="rcBody" rows="12">${esc(e.body || '')}</textarea></label>
    <p class="fine">Pencil Notes never sends email. “Open in Mail” starts a new message with this text for you to check and send.</p>
    <div class="sheet-actions"><button class="btn" data-r="copy">⧉ Copy</button><div class="spacer"></div><button class="btn" data-r="x">Done</button><a class="btn primary" data-r="mail" href="#">Open in Mail</a></div></div>`;
  w.hidden = false; const $w = s => w.querySelector(s), cur = () => ({ to: $w('#rcTo').value.trim(), subject: $w('#rcSub').value, body: $w('#rcBody').value });
  const save = () => { const f = findAsCard(c.id); if (!f) return; const v = { ...f.c.email, ...cur() }; if (JSON.stringify(v) !== JSON.stringify(f.c.email)) { pushHistory(); f.c.email = v; saveNote(f.n, true); renderAssist(f.pi); } };
  const mail = $w('[data-r="mail"]'), upd = () => { mail.href = recapHref(cur()); }; upd(); w.addEventListener('input', upd);
  w.onclick = ev => { const b = ev.target.closest('[data-r]'); if (!b) return; save(); const k = b.dataset.r;
    if (k === 'copy') copyText($w('#rcSub').value + '\n\n' + $w('#rcBody').value);
    if (k === 'mail') { upd(); R.lastMailto = mail.href; }
    if (k === 'x') w.hidden = true; };
}

/* ---------- export, search, settings, locking ---------- */
function drawRecExport(ctx, pg) {
  const rec = pg.rec; if (!rec || (!rec.segs.length && !rec.transcript)) return; const compact = !isRecPage(pg), c = tcol();
  ctx.save(); ctx.fillStyle = c.accent; ctx.font = `700 ${compact ? 18 : 30}px ${FONT}`;
  const t = `🎙 ${compact ? 'Recorded' : 'Meeting recording'} · ${mmss(rec.dur)}${rec.startedAt ? ' · ' + new Date(rec.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}`;
  if (compact) ctx.fillText(t, 520, 50); else { ctx.fillText(t, 48, 80); ctx.fillStyle = c.muted; ctx.font = `20px ${FONT}`; ctx.fillText(rec.transcript ? `Transcript (${rec.transcript.engine}) and Meeting Brief follow on the next pages.` : 'Audio is stored with this note in Pencil Notes.', 48, 120); }
  ctx.restore();
}
function recAudioStats() { const ids = []; let bytes = 0, n = 0; for (const no of S.notes) for (const pg of no.pages) if (pg.rec && pg.rec.segs.length) { n++; for (const g of pg.rec.segs) { ids.push(g.asset); bytes += g.bytes || 0; } } return { n, ids, mb: Math.max(0.1, Math.round(bytes / 1e5) / 10) }; }
const _rcSearch = noteSearchText;
noteSearchText = n => _rcSearch(n) + ' ' + n.pages.map(p => [p.rec ? [...(p.rec.transcript ? p.rec.transcript.segs.map(s => (s.sp ? spName(p.rec, s.sp) + ' ' : '') + s.text) : []), ...(p.rec.live || []).map(l => l.text)].join(' ') : '',
  p.assist && p.assist.brief ? p.assist.cards.map(c => c.raw || '').join(' ') : ''].join(' ')).join(' ').toLowerCase();
const _rcSettings = assistSettingsItems;
assistSettingsItems = () => [..._rcSettings(), { label: '🎙 Recording & transcription: ' + (sttLabel() || 'live captions only') + '…', fn: recSettings }];
// never auto-relock a note mid-recording; a manual lock stops the recording cleanly first
const _ra = relockAll; relockAll = (filter = () => true) => _ra(n => filter(n) && !(R.active && R.active.noteId === n.id));
const _ln = lockNote; lockNote = async (n, o) => { if (R.active && n && R.active.noteId === n.id) await recStop(); if (R.player) stopPlayer(); if (R.replay) setReplay(false); return _ln(n, o); };
if (window.PencilLock) PencilLock.lockNote = lockNote;
if (document.getElementById('recBtn')) document.getElementById('recBtn').onclick = recButton;
