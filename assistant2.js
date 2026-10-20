/* Pencil Notes v16 — assistant upgrades: 💬 ask about a card · ✉︎ draft replies · priority & sorting · 🔗 related emails & follow-ups
   · 🔎 read handwriting · 🧠 learn from edits. Every feature uses the user's own AI key when connected, and a labelled built-in fallback.
   All card data lives in pg.assist (→ undo, export and Pencil Lock encryption). Learned rules live in localStorage only. */

/* ---------- AI core ---------- */
const aiReady = () => { const c = aiCfg(); return !!(c.on && c.key && c.base && c.model && AI_URL_OK.test(c.base)); };
const aiModel = () => aiCfg().model || 'AI';
async function aiRequest(messages, { json = true, timeout = 30000 } = {}) {
  const c = aiCfg(); if (!c.key || !c.base || !c.model) throw new Error('not configured'); if (!AI_URL_OK.test(c.base)) throw new Error('base URL must be https');
  if (navigator.onLine === false) throw new Error('offline');
  const call = async rf => {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(c.base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify({ model: c.model, messages, ...(rf ? { response_format: { type: 'json_object' } } : {}) }) });
      if (!res.ok) { let msg = ''; try { const t = await res.text(); try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || t; } catch (_) { msg = t; } } catch (_) {}
        const e = new Error('HTTP ' + res.status + (msg ? ': ' + String(msg).slice(0, 120) : '')); e.status = res.status; e.detail = String(msg || ''); throw e; }
      return res.json();
    } finally { clearTimeout(to); }
  };
  let j; try { j = await call(json); } catch (e) { if (json && e.status === 400) j = await call(false); else throw e; }
  let txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; if (Array.isArray(txt)) txt = txt.map(p => p.text || '').join('');
  return String(txt || '').trim();
}
async function aiJSON(messages) { const t = (await aiRequest(messages, { json: true })).replace(/^```(?:json)?\s*|\s*```$/g, '').trim(); const m = t.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : t); }
const isVisionErr = e => e && ((e.status && [400, 404, 415, 422].includes(e.status) && /image|vision|multi-?modal|modalit|content type|image_url|not support/i.test(e.detail || e.message)) || /image|vision/i.test(e.detail || ''));
const prefsBlock = () => { const r = memRules(); return r.length ? '\nUser preferences (learned from their edits — follow them):\n' + r.map(x => '- ' + x.text).join('\n') : ''; };
const emailBlock = c => `From: ${c.from || ''}${c.fromAddr ? ' <' + c.fromAddr + '>' : ''}\nSubject: ${c.subject || ''}\nDate: ${c.date ? new Date(c.date).toString() : 'unknown'}\n\n${String(c.raw || '').slice(0, 12000)}`;

/* ---------- 🧠 memory: learned preferences ---------- */
const MEM_KEY = 'assistMemory';
function memRules() { try { return JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); } catch (_) { return []; } }
const memSave = l => localStorage.setItem(MEM_KEY, JSON.stringify(l));
function memAdd(rule, quiet) {
  const l = memRules().filter(r => !(r.type === rule.type && r.key === rule.key));
  if (rule.type === 'me' || rule.type === 'dueTime') for (let i = l.length - 1; i >= 0; i--) if (l[i].type === rule.type) l.splice(i, 1);
  l.unshift({ id: uid('m'), at: Date.now(), ...rule }); memSave(l.slice(0, 40)); if (!quiet) toast('🧠 Learned: ' + rule.text, 2600);
}
function memPrefs() {
  const P = { notAction: [], actionPhrases: [], me: '', dueTime: null, senderPrio: {}, strip: [] };
  for (const r of memRules()) {
    if (r.type === 'notAction') P.notAction.push(r.key); else if (r.type === 'actionPhrase') P.actionPhrases.push(r.key); else if (r.type === 'me') P.me = r.key;
    else if (r.type === 'dueTime') P.dueTime = { h: r.h, m: r.m }; else if (r.type === 'senderPrio') P.senderPrio[r.key] = r.level; else if (r.type === 'strip') P.strip.push(r.key);
  }
  return P;
}
// post-processing the engine can't do itself
function applyPrefsToResult(r) { const P = memPrefs(); if (P.strip.length) for (const a of r.actions || []) for (const p of P.strip) if (a.text.toLowerCase().startsWith(p)) { const t = a.text.slice(p.length).replace(/^[\s:,–—-]+/, ''); if (t) a.text = t[0].toUpperCase() + t.slice(1); } return r; }
const asHM = (h, m) => new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const MARKERS = /^(fyi|note|nb|ps|p\.s\.|info|update|reminder|heads[- ]?up|btw|aside|context|background|for reference|just so you know)\b/i;
function learnFromEdit(c, before, after) {
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  if (!after) {                                               // deleted
    const src = String(before.src || before.text).replace(/^[-•*]\s*/, '').trim();
    const m = src.match(/^([A-Za-z][\w' ]{1,18}?)\s*[:–—]\s+/) || src.match(MARKERS);
    if (m) { const k = m[1].toLowerCase().trim(); memAdd({ type: 'notAction', key: k, text: `Items starting “${cap(k)}” aren’t action items` }); }
    return;
  }
  if (!before) {                                              // added by hand: learn the phrase if it's in the email
    const w = after.text.toLowerCase().replace(/[^\w\s']/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    if (w.split(' ').length >= 2 && String(c.raw || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').includes(w)) memAdd({ type: 'actionPhrase', key: w, text: `Sentences with “${w}” are action items` });
    return;
  }
  if (before.owner !== after.owner && /^(you|me|myself|i)$/i.test(after.owner.trim()) && before.owner && !/^(you|team|everyone)$/i.test(before.owner)) memAdd({ type: 'me', key: before.owner.trim(), text: `My name is ${before.owner.trim()} — “${before.owner.trim()}” means me` });
  if (before.due && after.due && before.due !== after.due) {
    const b = new Date(before.due), a = new Date(after.due);
    if (ymdOf(b) === ymdOf(a) && [9, 17].includes(b.getHours()) && b.getMinutes() === 0 && !/\d\s*(am|pm|:)|noon|eod|end of/i.test(before.dueText || '')) memAdd({ type: 'dueTime', key: 'dueTime', h: a.getHours(), m: a.getMinutes(), text: `Default due time for date-only deadlines: ${asHM(a.getHours(), a.getMinutes())}` });
  }
  if (before.text !== after.text && before.text.toLowerCase().endsWith(after.text.toLowerCase()) && after.text.length >= 3) {
    const p = before.text.slice(0, before.text.length - after.text.length).replace(/[\s:,–—-]+$/, '').trim().toLowerCase();
    if (p && p.split(/\s+/).length <= 3) memAdd({ type: 'strip', key: p, text: `Drop “${cap(p)}” from the start of action items` });
  }
}
const ymdOf = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function memorySettings() {
  const w = modalWrap('memWrap'), draw = () => {
    const l = memRules();
    w.innerHTML = `<div class="sheet mem-sheet" role="dialog" aria-modal="true"><h3>🧠 Assistant memory</h3>
      <p class="fine">Rules the assistant learned from your edits to action items, owners, due times and priorities. They shape the built-in engine and are sent to your AI provider as a short “user preferences” list. Stored only on this device (not in notes or Export).</p>
      ${l.length ? `<ul class="mem-list">${l.map(r => `<li data-id="${r.id}"><span>${esc(r.text)}</span><button class="btn" data-m="del" aria-label="Forget this rule">✕</button></li>`).join('')}</ul>` : '<p class="as-none">Nothing learned yet. Edit, delete or add action items on assistant cards and it learns.</p>'}
      <div class="sheet-actions">${l.length ? '<button class="btn danger" data-m="reset">Reset memory</button>' : ''}<div class="spacer"></div><button class="btn primary" data-m="x">Done</button></div></div>`;
  };
  draw(); w.hidden = false;
  w.onclick = e => { const b = e.target.closest('[data-m]'); if (!b) { if (e.target === w) w.hidden = true; return; }
    if (b.dataset.m === 'x') w.hidden = true;
    if (b.dataset.m === 'del') { memSave(memRules().filter(r => r.id !== b.closest('li').dataset.id)); draw(); rerenderAssist(); }
    if (b.dataset.m === 'reset') { if (confirm('Forget everything the assistant learned on this device?')) { localStorage.removeItem(MEM_KEY); draw(); rerenderAssist(); toast('🧠 Assistant memory reset'); } } };
}

/* ---------- ✏️ action item editor (feeds memory) ---------- */
const asLocalInput = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
async function editAction(f, aid) {
  const a = f.c.actions.find(x => x.id === aid); if (!a) return;
  const v = await formSheet('Edit action item', [{ key: 'text', label: 'What', type: 'text', value: a.text }, { key: 'owner', label: 'Owner', type: 'text', value: a.owner || 'You' },
    { key: 'due', label: 'Due', type: 'datetime-local', value: asLocalInput(a.due) }, { key: 'done', label: 'Done', type: 'checkbox', value: !!a.done },
    { key: 'del', label: 'Remove — this isn’t an action item', type: 'checkbox', value: false }]);
  if (!v) return;
  const fr = findAsCard(f.c.id); if (!fr) return; const live = fr.c.actions.find(x => x.id === aid); if (!live) return;
  pushHistory();
  if (v.del) { fr.c.actions = fr.c.actions.filter(x => x !== live); learnFromEdit(fr.c, live, null); }
  else {
    const before = { ...live }, due = v.due ? new Date(v.due).toISOString() : null;
    Object.assign(live, { text: v.text.trim() || live.text, owner: v.owner.trim() || 'You', due, done: !!v.done, edited: true });
    if (due !== before.due) live.dueText = '';
    learnFromEdit(fr.c, before, live);
  }
  saveNote(fr.n, true); afterAssistChange(fr);
}
async function addActionManually(f) {
  const v = await formSheet('Add action item', [{ key: 'text', label: 'What', type: 'text', value: '' }, { key: 'owner', label: 'Owner', type: 'text', value: 'You' }, { key: 'due', label: 'Due', type: 'datetime-local', value: '' }], 'Add');
  if (!v || !v.text.trim()) return;
  const fr = findAsCard(f.c.id); if (!fr) return; pushHistory();
  const a = { id: uid('aa'), text: v.text.trim(), owner: v.owner.trim() || 'You', due: v.due ? new Date(v.due).toISOString() : null, dueText: '', manual: true };
  fr.c.actions.push(a); learnFromEdit(fr.c, null, a); saveNote(fr.n, true); afterAssistChange(fr);
}
function afterAssistChange(f) { if (f.pg.assist.sort) arrangeByPrio(f.pg, true); if (f.n.id === S.cur) renderAssist(f.pi); renderSidebar(); }

/* ---------- 🚦 priority ---------- */
const APRIO = { urgent: { i: 0, label: 'Urgent', icon: '🔴' }, high: { i: 1, label: 'High', icon: '🟠' }, normal: { i: 2, label: 'Normal', icon: '🔵' }, low: { i: 3, label: 'Low', icon: '⚪' } };
const URGENT_RX = /\b(urgent|asap|a\.s\.a\.p|immediately|right away|time[- ]sensitive|critical|action required|high priority|overdue|final notice|last chance|by (today|tonight|eod)|end of (the )?day today|emergency)\b/i;
const senderKey = c => String(c.fromAddr || (c.from && c.from !== 'Me' ? c.from : '') || '').toLowerCase().trim();
const openMine = c => (c.actions || []).filter(a => !a.done && (!a.owner || a.owner === 'You'));
const openDeadlines = c => (c.deadlines || []).filter(d => !(c.actions || []).some(a => (a.done || a.updNote) && overlap(a.text, d.text).j >= 0.5));
function earliestDue(c) { const t = [...openMine(c).map(a => a.due), ...openDeadlines(c).map(d => d.due), ...(c.meetings || []).map(m => m.start)].filter(Boolean).map(d => +new Date(d)); return t.length ? Math.min(...t) : Infinity; }
function builtinPrio(c, now = Date.now()) {
  const P = memPrefs(), sk = senderKey(c);
  if (sk && P.senderPrio[sk]) return { level: P.senderPrio[sk], reason: `🧠 you mark ${c.from || sk} as ${APRIO[P.senderPrio[sk]].label.toLowerCase()} priority`, by: 'memory' };
  const why = []; let sc = 0;
  const ts = [...openMine(c).map(a => a.due), ...openDeadlines(c).map(d => d.due), ...(c.meetings || []).map(m => m.start)].filter(Boolean).map(d => +new Date(d)).filter(t => t > now - 3 * 864e5);
  const soon = ts.length ? Math.min(...ts) - now : Infinity;
  if (soon < 0) { sc += 3; why.push('overdue'); } else if (soon < 864e5) { sc += 3; why.push('due within a day'); } else if (soon < 3 * 864e5) { sc += 2; why.push('due within 3 days'); } else if (soon < 7 * 864e5) { sc += 1; why.push('due this week'); }
  if (URGENT_RX.test((c.subject || '') + '\n' + String(c.raw || '').slice(0, 4000))) { sc += 2; why.unshift('marked urgent'); }
  if (openMine(c).length && c.kind === 'email') { sc += 1; why.push('asks you directly'); }
  if ((c.actions || []).filter(a => !a.done).length >= 3) { sc += 1; why.push(`${c.actions.filter(a => !a.done).length} action items`); }
  const any = (c.actions || []).some(a => !a.done) || (c.meetings || []).length;
  const level = sc >= 5 ? 'urgent' : sc >= 3 ? 'high' : any ? 'normal' : 'low';
  if (level === 'low') why.push('FYI — nothing asked of you');
  return { level, reason: why.slice(0, 3).join(' · ') || 'nothing time-sensitive', by: 'built-in' };
}
const cardPrio = c => c.prio && (c.prio.by === 'user' || c.prio.by === 'ai') ? c.prio : builtinPrio(c);
function prioMenu(f) {
  const cur = cardPrio(f.c), set = level => { const fr = findAsCard(f.c.id); if (!fr) return; pushHistory();
    if (level) { fr.c.prio = { level, reason: 'set by you', by: 'user' }; const sk = senderKey(fr.c); if (sk && fr.c.kind === 'email' && level !== 'normal') memAdd({ type: 'senderPrio', key: sk, level, text: `${fr.c.from || sk} is always ${APRIO[level].label.toLowerCase()} priority` }); }
    else delete fr.c.prio;
    saveNote(fr.n, true); afterAssistChange(fr); };
  actionSheet(`Priority · now ${APRIO[cur.level].label}`, [...Object.entries(APRIO).map(([k, p]) => ({ label: `${p.icon} ${p.label}${k === cur.level ? '  ✓' : ''}`, fn: () => set(k) })),
    ...(f.c.prio && f.c.prio.by === 'user' ? [{ label: '↺ Back to automatic', fn: () => set(null) }] : [])]);
}
function arrangeByPrio(pg, flip) {
  if (flip) AS.flip = new Map(asCards(pg).map(c => [c.id, [c.x, c.y]]));
  const cs = asCards(pg).slice().sort((a, b) => APRIO[cardPrio(a).level].i - APRIO[cardPrio(b).level].i || earliestDue(a) - earliestDue(b) || a.createdAt - b.createdAt);
  const colY = [AS_TOP, AS_TOP];
  for (const c of cs) { const k = c.w > AS_W + 40 ? (colY[0] = colY[1] = Math.max(...colY), 0) : colY[0] <= colY[1] ? 0 : 1; c.x = 24 + k * (AS_W + 28); c.y = colY[k]; colY[k] += c.h + 24; if (c.w > AS_W + 40) colY[1] = colY[0]; }
}

/* ---------- 🔗 related emails & follow-ups ---------- */
const normSubj = s => String(s || '').toLowerCase().replace(/^\s*((re|fw|fwd|aw|sv|wg|antw|tr)\s*(\[\d+\])?\s*:\s*|\[ext(ernal)?\]\s*)+/i, '').replace(/[^\w\s#&-]/g, ' ').replace(/\s+/g, ' ').trim();
const ENT_STOP = new Set('hi hey hello dear thanks thank best regards cheers please the a an i we you our your this that it in on at for to of and or but if so as is are be will can could would should my me us they he she team all everyone monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december today tomorrow re fwd fw subject from date sent quick also just let note fyi hope great good next new update meeting call email per as'.split(' '));
const entCache = new WeakMap();
function entities(c) {
  if (entCache.has(c)) return entCache.get(c);
  const txt = [c.subject, c.summary, ...(c.points || []), ...(c.actions || []).map(a => a.text), AssistEngine.cleanEmail(String(c.raw || '').slice(0, 5000)).body].join('\n');
  const E = new Set();
  for (const m of txt.matchAll(/#\d{3,}|\b[A-Z]{2,}-\d+\b|\b(?:invoice|order|ticket|case|po|project)\s*#?\s*[\w-]*\d[\w-]*/gi)) E.add('id:' + m[0].toLowerCase().replace(/\s+/g, ''));
  for (const m of txt.matchAll(/\b(?:[A-Z][a-zà-ÿ]+|[A-Z]{2,}\d*|Q[1-4])(?:\s+(?:[A-Z][a-zà-ÿ]+|[A-Z]{2,}\d*|&))*/g)) {
    const words = m[0].split(/\s+/).filter(w => !ENT_STOP.has(w.toLowerCase())); if (!words.length) continue;
    const p = words.join(' ').toLowerCase(); if (p.length < 3) continue;
    if (words.length > 1 || /\d|^[A-Z]{2,}/.test(words[0]) || /^[A-Z][a-zà-ÿ]{3,}$/.test(words[0])) E.add('e:' + p);
  }
  for (const a of c.actions || []) if (a.owner && !/^(you|team|everyone|sender)$/i.test(a.owner)) E.add('e:' + a.owner.toLowerCase());
  entCache.set(c, E); return E;
}
function relatedMap(n) {
  const all = n.pages.flatMap((pg, pi) => isAssistPage(pg) ? asCards(pg).map(c => ({ c, pi })) : []), M = new Map(all.map(x => [x.c.id, []]));
  const link = (a, b, why) => { const la = M.get(a.id), lb = M.get(b.id); if (!la || !lb) return; const ea = la.find(x => x.id === b.id); if (ea) { if (!ea.why.includes(why)) ea.why.push(why); } else la.push({ id: b.id, why: [why] }); const eb = lb.find(x => x.id === a.id); if (eb) { if (!eb.why.includes(why)) eb.why.push(why); } else lb.push({ id: a.id, why: [why] }); };
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i].c, b = all[j].c, sa = normSubj(a.subject), sb = normSubj(b.subject);
    if (sa.length >= 4 && sa === sb) link(a, b, 'same thread');
    const ka = senderKey(a); if (ka && ka === senderKey(b) && ka !== 'me') link(a, b, 'same sender');
    const ea = entities(a), eb = entities(b), shared = [...ea].filter(x => eb.has(x));
    if (shared.some(x => x.startsWith('id:')) || shared.length >= 2) link(a, b, 'shared: ' + shared.slice(0, 3).map(x => x.replace(/^(id|e):/, '')).join(', '));
    if ((a.aiRelated || []).includes(b.id) || (b.aiRelated || []).includes(a.id)) link(a, b, '✨ similar topic');
    if (a.followUp && a.followUp.id === b.id || b.followUp && b.followUp.id === a.id) link(a, b, 'follow-up');
  }
  return M;
}
function relatedGroup(M, id) { const seen = new Set([id]), q = [id]; while (q.length) for (const r of M.get(q.shift()) || []) if (!seen.has(r.id)) { seen.add(r.id); q.push(r.id); } return seen; }
const DONE_RX = /\b(done|completed?|finished|sent( it| them| over)?|signed|paid|booked|submitted|shared|uploaded|reviewed|approved|taken care of|sorted( out)?|handled|confirmed|no longer needed|not needed anymore|already|cancel(l)?ed)\b/i;
const cw = s => String(s || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !ENT_STOP.has(w));
const stem = w => w.replace(/(ing|ed|es|s)$/, '');
function overlap(a, b) { const A = new Set(cw(a).map(stem)), B = new Set(cw(b).map(stem)); let k = 0; for (const x of A) if (B.has(x)) k++; return { k, j: k / Math.max(1, Math.min(A.size, B.size)) }; }
function findThreadParent(n, card) {
  const s = normSubj(card.subject); if (s.length < 4) return null;
  const t = c => +new Date(c.date || c.createdAt);
  const cands = n.pages.flatMap(pg => isAssistPage(pg) ? asCards(pg) : []).filter(c => c !== card && normSubj(c.subject) === s && t(c) <= t(card));
  return cands.sort((a, b) => t(b) - t(a))[0] || null;
}
function applyFollowUp(n, card, prev, aiDone = []) {
  card.followUp = { id: prev.id, subject: prev.subject, date: prev.date || new Date(prev.createdAt).toISOString(), done: 0, updated: 0, merged: 0 };
  const body = AssistEngine.cleanEmail(card.raw || '').body, own = new Set((card.actions || []).map(a => a.src).filter(Boolean));
  const sents = AssistEngine.units(body).map(u => u.text).filter(t => !own.has(t) && DONE_RX.test(t) && !/\?\s*$/.test(t));
  for (const a of prev.actions || []) {
    if (a.done) continue;
    const ai = aiDone.includes(a.id), hit = ai || sents.some(t => { const o = overlap(t, a.text); return o.k >= 2 || (o.k >= 1 && cw(a.text).length <= 3); });
    if (hit) { a.done = true; a.doneBy = card.id; a.doneNote = ai ? '✨ done per follow-up' : 'done per follow-up'; card.followUp.done++; }
  }
  const keep = [];
  for (const na of card.actions || []) {
    const pa = (prev.actions || []).find(a => !a.done && overlap(a.text, na.text).j >= 0.6);
    if (pa) { if (na.due && na.due !== pa.due) { pa.due = na.due; pa.dueText = na.dueText; pa.text = na.text.replace(/[,\s]+(instead|then|please)$/i, ''); pa.updNote = 'due updated per follow-up'; card.followUp.updated++; } card.followUp.merged++; }
    else keep.push(na);
  }
  card.actions = keep;
}
function afterCardAdded(n, pg, card) {
  card.prio = undefined; delete card.prio;
  const prev = findThreadParent(n, card); if (prev) applyFollowUp(n, card, prev);
  if (pg.assist.sort) arrangeByPrio(pg, true);
}
function stackGroup(f) {
  const n = f.n, M = relatedMap(n), ids = relatedGroup(M, f.c.id), pg = f.pg;
  const grp = asCards(pg).filter(c => ids.has(c.id)).sort((a, b) => +new Date(a.date || a.createdAt) - +new Date(b.date || b.createdAt));
  if (grp.length < 2) { toast('Related cards on other pages stay where they are'); return; }
  pushHistory(); AS.flip = new Map(asCards(pg).map(c => [c.id, [c.x, c.y]]));
  const bx = Math.min(...grp.map(c => c.x)), by = Math.min(...grp.map(c => c.y));
  grp.forEach((c, i) => { c.x = Math.min(PAGE_W - c.w, bx + i * 26); c.y = Math.min(PAGE_H - 120, by + i * 46); });
  pg.assist.cards = [...asCards(pg).filter(c => !ids.has(c.id)), ...grp]; if (pg.assist.sort) pg.assist.sort = false;
  saveNote(n, true); renderAssist(f.pi); undoToast(`🗂 Stacked ${grp.length} related cards`);
}
function showRelated(f) {
  const M = relatedMap(f.n), ids = relatedGroup(M, f.c.id), why = [...new Set((M.get(f.c.id) || []).flatMap(r => r.why))].slice(0, 3).join(' · ');
  AS.hl = ids; renderAssist(f.pi); clearTimeout(AS.hlT); AS.hlT = setTimeout(() => { AS.hl = null; const n = curNote(); if (n) rerenderAssist(); }, 6500);
  actionToast(`🔗 ${ids.size} related · ${why}`, 'Stack', () => { const fr = findAsCard(f.c.id); if (fr) stackGroup(fr); }, 6500);
}
// connector lines between related cards on one page
function linksSVG(pg, M, s) {
  const cs = asCards(pg), byId = new Map(cs.map(c => [c.id, c])), seen = new Set(); let out = '';
  for (const c of cs) for (const r of M.get(c.id) || []) {
    const d = byId.get(r.id); if (!d) continue; const k = [c.id, d.id].sort().join(); if (seen.has(k)) continue; seen.add(k);
    const a = [c.x + c.w / 2, c.y + c.h / 2], b = [d.x + d.w / 2, d.y + d.h / 2], mx = (a[0] + b[0]) / 2;
    const hot = AS.hl && AS.hl.has(c.id) && AS.hl.has(d.id);
    out += `<path class="as-link ${hot ? 'hot' : ''}" data-a="${c.id}" data-b="${d.id}" d="M${a[0] * s},${a[1] * s} C${mx * s},${a[1] * s} ${mx * s},${b[1] * s} ${b[0] * s},${b[1] * s}"/>`;
  }
  return `<svg class="as-links" width="${PAGE_W * s}" height="${PAGE_H * s}">${out}</svg>`;
}

/* ---------- 💬 ask about a card ---------- */
AS.drafts = new Map(); AS.chatBusy = new Set(); AS.reading = new Set();
const askMode = () => localStorage.getItem('assistAskMode') || 'ink';
function chatHTML(c) {
  const msgs = (c.chat || []).map(m => m.role === 'user'
    ? `<div class="as-msg-u">${m.ink ? `<img class="as-qink" alt="Handwritten question" src="${inkThumbURL(m.ink, 300, 70)}">${m.read ? `<small>“${esc(m.read)}”</small>` : ''}` : esc(m.text)}</div>`
    : `<div class="as-msg-a"><div>${esc(m.text).replace(/\n/g, '<br>')}</div><small class="as-eng ${m.engine && m.engine !== 'Built-in' ? 'ai' : ''}">${m.engine === 'Built-in' ? '⚙︎ Built-in' : m.engine === 'note' ? 'ℹ︎' : '✨ ' + esc(m.engine)}</small></div>`).join('');
  const kb = askMode() === 'kb';
  return `<div class="as-chat"><div class="as-chat-h">💬 Ask about this email <button class="as-x" data-aa="chat" aria-label="Close chat">✕</button></div>
    <div class="as-msgs">${msgs || `<div class="as-hintmsg">${kb ? 'Type' : 'Write'} a question — “what’s due?”, “who needs to act?”, “when is the meeting?”${aiReady() ? '' : '<br>⚙︎ Built-in answers simple lookups · connect AI in Settings for open questions.'}</div>`}${AS.chatBusy.has(c.id) ? '<div class="as-msg-a busy"><span class="as-spin">Thinking…</span></div>' : ''}</div>
    <div class="as-ask ${kb ? 'kb' : 'ink'}"><canvas class="as-strip" aria-label="Write your question with Apple Pencil"></canvas><input class="as-q" type="text" placeholder="Ask about this email…" enterkeyhint="send">
      <button class="as-tog" data-aa="askmode" title="${kb ? 'Write with Pencil' : 'Type instead'}">${kb ? '✍︎' : '⌨︎'}</button>${kb ? '' : '<button class="as-tog" data-aa="askclr" title="Clear ink">⌫</button>'}<button class="as-btn" data-aa="ask">Ask</button></div></div>`;
}
function wireChat(L, pg) {
  L.querySelectorAll('.as-card').forEach(el => {
    const id = el.dataset.card, cv = el.querySelector('.as-strip'), q = el.querySelector('.as-q'); if (!cv) return;
    const draw = () => { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; if (!r.width) return; cv.width = r.width * d; cv.height = r.height * d; const x = cv.getContext('2d'); x.setTransform(d * S.scale, 0, 0, d * S.scale, 0, 0); for (const st of AS.drafts.get(id) || []) drawStroke(x, st); };
    requestAnimationFrame(draw);
    let cur = null;
    cv.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.pointerType === 'touch' && !fingerDrawOn()) { hint('Write with Apple Pencil — or tap ⌨︎ to type'); return; } e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (_) {} const r = cv.getBoundingClientRect(); cur = { pid: e.pointerId, r, st: { id: uid('s'), points: [[(e.clientX - r.left) / S.scale, (e.clientY - r.top) / S.scale, e.pressure || .5]], color: INK, width: 3.2, tool: 'pen' } };
      const l = AS.drafts.get(id) || []; l.push(cur.st); AS.drafts.set(id, l); draw(); });
    cv.addEventListener('pointermove', e => { if (!cur || e.pointerId !== cur.pid) return; e.stopPropagation(); cur.st.points.push([(e.clientX - cur.r.left) / S.scale, (e.clientY - cur.r.top) / S.scale, e.pressure || .5]); draw(); });
    const up = e => { if (cur && e.pointerId === cur.pid) { e.stopPropagation(); cur = null; } }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    if (q) q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const f = findAsCard(id); if (f) askCard(f); } });
  });
  const open = L.querySelector('.as-msgs'); L.querySelectorAll('.as-msgs').forEach(m => m.scrollTop = m.scrollHeight); void open;
}
function inkBB(strokes) { let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of strokes) for (const p of s.points) { bb = [Math.min(bb[0], p[0]), Math.min(bb[1], p[1]), Math.max(bb[2], p[0]), Math.max(bb[3], p[1])]; } return bb.map((v, i) => v + (i < 2 ? -4 : 4)); }
// render ink to a PNG for vision models: dark ink on white, longest side ≤ 1024 px
function inkToPNG(strokes, bb, max = 1024) {
  bb = bb || inkBB(strokes); const pad = 24, w = Math.max(1, bb[2] - bb[0]), h = Math.max(1, bb[3] - bb[1]);
  const sc = Math.min((max - 2 * pad) / Math.max(w, h), 3), c = document.createElement('canvas'); c.width = Math.round(w * sc + 2 * pad); c.height = Math.round(h * sc + 2 * pad);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.translate(pad - bb[0] * sc, pad - bb[1] * sc); x.scale(sc, sc);
  const was = renderLight; renderLight = true; try { for (const st of strokes) drawStroke(x, { ...st, width: Math.max(st.width || 3, 2.4) }); } finally { renderLight = was; }
  return c.toDataURL('image/png');
}
function builtinAnswer(c, q) {
  const s = q.toLowerCase(), acts = (c.actions || []).filter(a => !a.done), mine = openMine(c), others = acts.filter(a => a.owner && a.owner !== 'You');
  const li = l => l.map(a => `• ${a.text}${a.due ? ' — ' + fmtDueShort(a.due) : ''}${a.owner && a.owner !== 'You' ? ' (' + a.owner + ')' : ''}`).join('\n');
  if (/\b(meeting|call|kick-?off|what time|where is|where are|where'?s|appointment|session)\b/.test(s)) return (c.meetings || []).length ? (c.meetings.map(m => `📅 ${m.title} — ${fmtWhen(m.start)}${m.where ? ' · ' + m.where : ''}`).join('\n')) : 'The email doesn’t mention a meeting time.';
  if (/\b(deadline|due|by when|when (do|does|should|must|is)|how long|how much time)\b/.test(s)) {
    const l = [...acts.filter(a => a.due).map(a => `• ${a.text} — ${fmtDueShort(a.due)}${a.owner && a.owner !== 'You' ? ' (' + a.owner + ')' : ''}`), ...openDeadlines(c).filter(d => !acts.some(a => a.due === d.due)).map(d => `• ${d.text} — ${fmtDueShort(d.due)}`)];
    return l.length ? 'Deadlines:\n' + [...new Set(l)].join('\n') : 'No deadlines are mentioned.';
  }
  if (/\b(what|anything)\b.*\b(me|i)\b.*\b(do|asked|need|should|supposed)\b|\bmy (tasks?|actions?|to-?dos?)\b|\basked of me\b|\bto-?do\b|\baction items?\b|\bwhat do (i|we) (need|have)/.test(s))
    return (mine.length ? 'You’re asked to:\n' + li(mine) : 'Nothing is asked of you directly.') + (others.length ? '\nOthers: \n' + li(others) : '');
  if (/\bwho\b|\bsender\b|\bfrom whom\b/.test(s)) {
    if (/who (sent|wrote|is (this|it) from|emailed)|sender|from whom/.test(s)) return `${c.from || 'Unknown sender'}${c.fromAddr ? ' <' + c.fromAddr + '>' : ''}${c.date ? ' · ' + fmtWhen(c.date) : ''}`;
    const ppl = [...new Set(acts.map(a => a.owner || 'You'))];
    return ppl.length ? 'Who needs to act:\n' + ppl.map(p => `• ${p}: ${acts.filter(a => (a.owner || 'You') === p).map(a => a.text).join('; ')}`).join('\n') : `It’s from ${c.from || 'an unknown sender'}; nobody is asked to do anything.`;
  }
  if (/\b(summar|tl;?dr|about|gist|main point|key point|what does it say)/.test(s)) return c.summary + ((c.points || []).length ? '\n' + c.points.map(p => '• ' + p).join('\n') : '');
  return null;
}
async function askCard(f) {
  const id = f.c.id, kb = askMode() === 'kb', el = document.querySelector(`.as-card[data-card="${id}"]`);
  const text = kb ? (el && el.querySelector('.as-q').value || '').trim() : '', strokes = kb ? [] : (AS.drafts.get(id) || []);
  if (!text && !strokes.length) { toast(kb ? 'Type a question first' : 'Write a question with Apple Pencil first'); return; }
  pushHistory();
  const msg = { id: uid('m'), role: 'user', at: Date.now(), ...(text ? { text } : { ink: { strokes: JSON.parse(JSON.stringify(strokes)), bb: inkBB(strokes) } }) };
  (f.c.chat ||= []).push(msg); f.c.chatOpen = true; AS.drafts.delete(id); saveNote(f.n, true);
  const reply = (t, engine) => { const fr = findAsCard(id); if (!fr) return; fr.c.chat.push({ id: uid('m'), role: 'assistant', text: t, engine, at: Date.now() }); AS.chatBusy.delete(id); saveNote(fr.n, true); if (fr.n.id === S.cur) renderAssist(fr.pi); };
  if (!aiReady()) {
    if (msg.ink) return reply('✍︎ Handwritten questions need AI connected (Settings → Smarter AI summaries). Tap ⌨︎ to type your question instead.', 'note');
    return reply(builtinAnswer(f.c, text) || 'I can answer simple lookups (deadlines, who, what’s asked of you, meeting time). Connect AI in Settings for open questions.', 'Built-in');
  }
  AS.chatBusy.add(id); renderAssist(f.pi);
  const hist = f.c.chat.slice(0, -1).slice(-10).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.ink ? '[handwritten question' + (m.read ? ': ' + m.read : '') + ']' : m.text }));
  const last = msg.ink ? [{ type: 'text', text: 'My question is handwritten in this image. Read it, then answer it. Start your answer with the question in quotes on its own line.' }, { type: 'image_url', image_url: { url: inkToPNG(msg.ink.strokes, msg.ink.bb) } }] : text;
  const messages = [{ role: 'system', content: `TASK: chat\nYou answer the reader's questions about one email. Be brief (at most 4 sentences or a short list), plain text, no markdown headings. Use only the email and this conversation; if the email doesn't say, say so. Today is ${new Date().toString()}.${prefsBlock()}` },
    { role: 'user', content: 'The email:\n' + emailBlock(f.c) }, { role: 'assistant', content: 'Got it. What would you like to know?' }, ...hist, { role: 'user', content: last }];
  try {
    let a = await aiRequest(messages, { json: false });
    if (msg.ink) { const m = a.match(/^\s*[“"]([^”"\n]{2,200})[”"]\s*\n+/); if (m) { msg.read = m[1]; a = a.slice(m[0].length).trim(); const fr = findAsCard(id); const mm = fr && fr.c.chat.find(x => x.id === msg.id); if (mm) mm.read = m[1]; } }
    reply(a || '(empty answer)', aiModel());
  } catch (e) {
    if (msg.ink && isVisionErr(e)) return reply(`${aiModel()} can’t read handwriting images. Tap ⌨︎ to type your question — or choose a vision-capable model in Settings.`, 'note');
    const b = text && builtinAnswer(f.c, text);
    reply((b ? b + '\n' : msg.ink ? 'Couldn’t read your handwriting right now. ' : 'Connect AI in Settings for open questions. ') + `(AI unavailable: ${e.name === 'AbortError' ? 'timed out' : e.message})`, 'Built-in');
  }
}

/* ---------- ✉︎ draft replies ---------- */
const TONES = { friendly: { label: '😊 Friendly', d: 'warm and friendly' }, professional: { label: '💼 Professional', d: 'polished and professional' }, brief: { label: '⚡︎ Brief', d: 'very brief — two or three short sentences' }, decline: { label: '🙅 Decline politely', d: 'politely declining the request while staying positive' }, time: { label: '⏳ Ask for more time', d: 'acknowledging the request and politely asking for more time, proposing a concrete later date' } };
function builtinReply(c, tone) {
  const first = (String(c.from || '').replace(/<.*>/, '').trim().split(/[\s,]+/)[0] || '').replace(/^(me|unknown)$/i, '') || 'there';
  const subj = String(c.subject || 'your email').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, ''), me = memPrefs().me, mine = openMine(c);
  const items = mine.map(a => `• ${a.text}${a.due ? ' — by ' + fmtDueShort(a.due) : ''}`).join('\n'), sig = n => n + (me ? '\n' + me : '');
  const due = mine.map(a => a.due).filter(Boolean).sort()[0], later = due ? (() => { const d = new Date(due); d.setDate(d.getDate() + (d.getDay() === 5 ? 3 : d.getDay() === 4 ? 4 : 2)); return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); })() : 'early next week';
  switch (tone) {
    case 'professional': return `Hello ${first},\n\nThank you for your email regarding “${subj}”.${items ? ` I will take care of the following:\n\n${items}\n\nI will follow up once these are complete.` : ' I have noted the details.'} Please let me know if anything else is needed.\n\n${sig('Best regards,')}`;
    case 'brief': return `Hi ${first} — ${items ? `got it, I’ll ${mine.length === 1 ? mine[0].text.replace(/^\w/, ch => ch.toLowerCase()) + (mine[0].due ? ' by ' + fmtDueShort(mine[0].due) : '') : 'take care of these'}.` : 'thanks, noted.'} ${sig('Thanks!')}`.replace(/\.\./g, '.');
    case 'decline': return `Hi ${first},\n\nThank you for thinking of me regarding “${subj}”. Unfortunately I won’t be able to take this on right now${mine.length ? ' — my plate is full with existing commitments' : ''}. I’m sorry I can’t help this time, and I hope it goes well. Happy to help another time.\n\n${sig('Best,')}`;
    case 'time': return `Hi ${first},\n\nThanks for your note about “${subj}”. I’m working on it, but I need a little more time to do it properly${due ? ` than ${fmtDueShort(due)}` : ''}. Would it be OK if I got back to you by ${later}?${items ? `\n\nFor reference:\n${items}` : ''}\n\nThanks for understanding,${me ? '\n' + me : ''}`;
    default: return `Hi ${first},\n\nThanks for the email about “${subj}”!${items ? ` I’m on it:\n\n${items}\n\nI’ll let you know if anything comes up.` : ' Sounds good.'}\n\n${sig('Thanks,')}`;
  }
}
async function genReply(f, tone) {
  if (!aiReady()) return { text: builtinReply(f.c, tone), engine: 'Built-in' };
  try {
    const me = memPrefs().me;
    const t = await aiRequest([{ role: 'system', content: `TASK: reply\nWrite a reply to the email below on behalf of its reader. Tone: ${TONES[tone].d}. Plain text only: greeting, body, sign-off${me ? ` signed "${me}"` : ' (no name)'}. Don't invent facts, dates or commitments beyond the email. Under 150 words. Return only the reply body, no subject line.${prefsBlock()}` },
      { role: 'user', content: emailBlock(f.c) + '\n\nAction items for me: ' + (openMine(f.c).map(a => a.text + (a.due ? ' (due ' + fmtWhen(a.due) + ')' : '')).join('; ') || 'none') }], { json: false });
    return { text: t.replace(/^subject:.*\n+/i, '').trim(), engine: aiModel() };
  } catch (e) { return { text: builtinReply(f.c, tone), engine: 'Built-in', note: `AI unavailable (${e.name === 'AbortError' ? 'timed out' : e.message}) — built-in template used` }; }
}
const replySubject = c => 'Re: ' + String(c.subject || '').replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '');
const mailtoFor = (c, body) => `mailto:${c.fromAddr ? encodeURIComponent(c.fromAddr).replace(/%40/g, '@') : ''}?subject=${encodeURIComponent(replySubject(c))}&body=${encodeURIComponent(body)}`;
async function openReply(f, tone) {
  const w = modalWrap('replyWrap'); let c = f.c;
  const draw = (busy) => {
    const r = c.reply || {};
    w.innerHTML = `<div class="sheet as-reply-sheet" role="dialog" aria-modal="true"><h3>✉︎ Reply to ${esc(c.from || 'sender')}</h3>
      <p class="fine as-rsub">${esc(c.fromAddr ? 'To: ' + c.fromAddr + ' · ' : 'No address found — add it in Mail · ')}${esc(replySubject(c))}</p>
      <div class="as-tones">${Object.entries(TONES).map(([k, t]) => `<button class="as-btn ${r.tone === k ? 'on' : ''}" data-tone="${k}">${t.label}</button>`).join('')}</div>
      <div class="as-reng">${busy ? '<span class="as-spin">✨ Drafting with ' + esc(aiModel()) + '…</span>' : r.engine === 'Built-in' ? `<span class="as-eng">⚙︎ Built-in template</span>${r.note ? ' · ' + esc(r.note) : aiReady() ? '' : ' · connect AI in Settings for tailored replies'}` : `<span class="as-eng ai">✨ ${esc(r.engine || '')}</span>`}</div>
      <textarea id="replyText" rows="12" spellcheck="true">${esc(r.text || '')}</textarea>
      <div class="sheet-actions"><button class="btn" data-r="copy">📋 Copy</button><a class="btn primary" id="replyMail" href="${esc(mailtoFor(c, r.text || ''))}">✉︎ Open in Mail</a><div class="spacer"></div><button class="btn" data-r="x">Done</button></div>
      <p class="fine">Pencil Notes never sends email. Open in Mail starts a draft you review and send yourself.</p></div>`;
    const ta = w.querySelector('#replyText'), a = w.querySelector('#replyMail');
    ta.addEventListener('input', () => { const fr = findAsCard(c.id); if (!fr) return; (fr.c.reply ||= {}).text = ta.value; fr.c.reply.edited = true; a.href = mailtoFor(fr.c, ta.value); clearTimeout(openReply.t); openReply.t = setTimeout(() => saveNote(fr.n), 400); });
    a.addEventListener('click', e => { const fr = findAsCard(c.id); if (fr) saveNote(fr.n, true); if (window.__mailtoDryRun) { e.preventDefault(); window.__lastMailto = a.href; } });
  };
  const gen = async t => {
    (c.reply ||= {}).tone = t; draw(aiReady()); const res = await genReply(f, t); const fr = findAsCard(c.id); if (!fr) return;
    if (fr.n.id === S.cur) pushHistory(); fr.c.reply = { tone: t, text: res.text, engine: res.engine, ...(res.note ? { note: res.note } : {}), at: Date.now() }; c = fr.c; saveNote(fr.n, true); if (!w.hidden) draw(false);
  };
  w.hidden = false; draw(false);
  w.onclick = async e => {
    if (e.target === w) { w.hidden = true; return; }
    const tb = e.target.closest('[data-tone]'); if (tb) { const cur = findAsCard(c.id); if (cur && cur.c.reply && cur.c.reply.edited && !confirm('Replace your edited draft with a new one?')) return; await gen(tb.dataset.tone); return; }
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'x') { w.hidden = true; const fr = findAsCard(c.id); if (fr) { saveNote(fr.n, true); if (fr.n.id === S.cur) renderAssist(fr.pi); } }
    if (b.dataset.r === 'copy') { const t = w.querySelector('#replyText'); try { await navigator.clipboard.writeText(t.value); } catch (_) { t.select(); try { document.execCommand('copy'); } catch (__) {} } window.__lastCopied = t.value; toast('📋 Reply copied', 1500); }
  };
  if (tone || !c.reply || !c.reply.text) await gen(tone || (c.reply && c.reply.tone) || 'friendly');
}

/* ---------- 🔎 read handwriting ---------- */
async function aiTranscribe(png) {
  return aiRequest([{ role: 'system', content: 'TASK: transcribe\nTranscribe the handwriting in the image exactly as written. Return only the text, keeping line breaks. If it is unreadable, return [unreadable].' },
    { role: 'user', content: [{ type: 'text', text: 'Transcribe this handwriting.' }, { type: 'image_url', image_url: { url: png } }] }], { json: false, timeout: 45000 });
}
const visionMsg = e => isVisionErr(e) ? `${aiModel()} can’t read images — choose a vision-capable model in Settings` : `Couldn’t read the handwriting (${e.name === 'AbortError' ? 'timed out' : e.message})`;
async function readCardInk(f) {
  if (!aiReady()) { toast('🔎 Needs AI connected — Settings → Smarter AI summaries', 3000); return; }
  const id = f.c.id; AS.reading.add(id); renderAssist(f.pi);
  let t; try { t = (await aiTranscribe(inkToPNG(f.c.ink.strokes, f.c.ink.bb))).trim(); } catch (e) { AS.reading.delete(id); const fr = findAsCard(id); if (fr && fr.n.id === S.cur) renderAssist(fr.pi); toast('🔎 ' + visionMsg(e), 4000); return; }
  AS.reading.delete(id); const fr = findAsCard(id); if (!fr) return;
  if (!t || /^\[unreadable\]$/i.test(t)) { renderAssist(fr.pi); toast('🔎 The model couldn’t make out this handwriting', 3000); return; }
  if (fr.n.id === S.cur) pushHistory();
  const c = fr.c, text = (c.raw && c.raw.trim() ? c.raw.trim() + '\n' : '') + t;
  c.transcript = { text: t, engine: aiModel(), at: Date.now() }; c.raw = text;
  const r = applyPrefsToResult(AssistEngine.extract({ from: c.from, subject: '', date: new Date(c.ref || Date.now()), text, prefs: memPrefs() }));
  Object.assign(c, resultToCard(r), { kind: 'text', engine: 'Built-in', engineNote: '' }); if (!c.subject || c.subject === 'Handwriting') c.subject = autoTitle(t) || 'Handwriting';
  saveNote(fr.n, true); afterAssistChange(fr); toast('🔎 Read: “' + (t.length > 40 ? t.slice(0, 38) + '…' : t) + '”', 2600);
  smarten(fr.n.id, fr.pg.id, c.id, { from: c.from, subject: c.subject, text }, new Date(c.ref || Date.now()));
}
function syncReadBtn() { const b = document.getElementById('lassoRead'); if (!b) return; const ok = aiReady(); b.classList.toggle('disabled', !ok); b.setAttribute('aria-disabled', String(!ok)); b.innerHTML = ok ? '🔎 Read handwriting' : '🔎 Read handwriting <small>Needs AI connected</small>'; }
async function lassoRead() {
  const sel = selection; if (!sel) return;
  if (!aiReady()) { toast('🔎 Needs AI connected — Settings → Smarter AI summaries', 3000); return; }
  const n = curNote(), pg = n.pages[sel.pi], strokes = pg.strokes.filter(s => sel.ids.includes(s.id));
  if (!strokes.length) { toast('Lasso some handwriting first'); return; }
  const bb = sel.bb || inkBB(strokes), selIds = sel.ids.slice(), pi = sel.pi;
  $('#lassoMenu').hidden = true; toast('🔎 Reading handwriting…', 20000);
  let t; try { t = (await aiTranscribe(inkToPNG(strokes, bb))).trim(); } catch (e) { toast('🔎 ' + visionMsg(e), 4000); if (selection) $('#lassoMenu').hidden = false; return; }
  $('#toast').hidden = true;
  const w = modalWrap('readWrap');
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>🔎 Handwriting</h3><p class="fine">Read by <span class="as-eng ai">✨ ${esc(aiModel())}</span> — fix anything it got wrong:</p>
    <textarea id="readText" rows="5">${esc(t)}</textarea>
    <div class="sheet-actions"><button class="btn" data-rd="copy">📋 Copy</button><button class="btn" data-rd="assist">🤖 Send to assistant</button><div class="spacer"></div><button class="btn" data-rd="x">Close</button><button class="btn primary" data-rd="label">🔎 Make searchable</button></div></div>`;
  w.hidden = false;
  w.onclick = async e => {
    const b = e.target.closest('[data-rd]'); if (!b) { if (e.target === w) w.hidden = true; return; } const v = w.querySelector('#readText').value.trim();
    if (b.dataset.rd === 'x') { w.hidden = true; if (selection) $('#lassoMenu').hidden = false; }
    if (b.dataset.rd === 'copy') { try { await navigator.clipboard.writeText(v); } catch (_) {} toast('📋 Copied', 1200); }
    if (b.dataset.rd === 'label' && v) { const nn = curNote(), p = nn.pages[pi]; pushHistory(); (p.labels ||= []).push({ id: uid('l'), strokeIds: selIds, x: bb[0], y: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1], text: v, by: aiModel() }); saveNote(nn, true); w.hidden = true; hideLasso(); renderOverlay(pi); renderSidebar(); toast('🔎 Searchable now — “' + (v.length > 30 ? v.slice(0, 28) + '…' : v) + '”'); }
    if (b.dataset.rd === 'assist' && v) { w.hidden = true; AS.readText = v; try { await lassoToAssistant(); } finally { AS.readText = null; } }
  };
}

/* ---------- settings & search hooks ---------- */
const _assistSettingsItems = assistSettingsItems;
assistSettingsItems = () => [..._assistSettingsItems(), { label: `🧠 Assistant memory (${memRules().length})…`, fn: memorySettings }];
const _noteSearchText2 = noteSearchText;
noteSearchText = n => _noteSearchText2(n) + ' ' + n.pages.flatMap(p => (p.assist ? p.assist.cards : []).map(c => [c.transcript && c.transcript.text, ...(c.chat || []).map(m => m.text || m.read || '')].join(' '))).join(' ').toLowerCase();
$('#lassoRead').onclick = lassoRead; syncReadBtn();
