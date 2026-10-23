/* Pencil Notes v21b — 📥 Inbox: the third option in the Boards slide-out (alongside 💲 Quote Board and 💡 Idea Board).
   The new home of the old 🤖 Assistant page's email features: paste / drop an email → a summary card (summary, sender, date,
   key asks, action items, meetings); 🚦 priority with the same learn-from-your-edits memory; 🔗 related emails grouped into threads
   (the same relatedMap / follow-up logic the Assistant page used). Each card has ✨ Ask Grok, 💲 Move to Quote Board (RFQs) and 💡 Send to Idea Board.
   Data: hidden system note 'inbox' whose page 0 is an assistant-type page (pg.assist.cards) — so Pencil Lock, Export/Import, search,
   undo snapshots and every assistant.js / assistant2.js helper (findAsCard, prioMenu, editAction, smarten…) work unchanged.
   The Inbox never sends email: replies open a draft in Mail. */
const INB = { undo: [], redo: [], active: false, exp: new Set(), raw: new Set(), rt: 0, flash: null };
const IN_PI = -3;                                   // intake() target meaning "the Inbox"
const inSealed = () => { const n = inboxNote(); return !!(n && typeof isSealed === 'function' && isSealed(n)); };
const isInboxNote = n => !!(n && n.id === INBOX_ID);
const SYS_IDS = [QUOTE_ID, IDEA_ID, INBOX_ID];
function makeInboxNote() {
  const n = makeNote(S.notebooks[0] ? S.notebooks[0].id : '__inbox', 'Inbox');
  n.id = INBOX_ID; n.notebookId = '__inbox'; n.system = 'inbox'; n.order = 0;
  const pg = makeTemplatePage('assistant', n); pg.assist.inbox = true; pg.assist.order = 'prio'; n.pages = [pg]; return n;
}
function ensureInboxNote() {
  let n = inboxNote(); if (n) return n;
  if (!window.__ready) throw new Error('Inbox used before notes finished loading');
  n = makeInboxNote(); S.notes.push(n); saveNote(n, true); return n;
}
const inPage = () => { const n = inboxNote(); return n && !inSealed() ? n.pages[0] : null; };
const inCards = () => { const pg = inPage(); return pg ? asCards(pg) : []; };
const inUnread = () => inCards().filter(c => c.unread).length;
function inSub() {
  if (inSealed()) return 'Locked'; const c = inCards(); if (!c.length) return 'Paste or drop emails · meeting briefs';
  const u = c.filter(x => x.unread).length, hi = c.filter(x => ['urgent', 'high'].includes(cardPrio(x).level)).length;
  return `${c.length} email${c.length === 1 ? '' : 's'}${u ? ` · ${u} unread` : ''}${hi ? ` · ${hi} high priority` : ''}`;
}

/* ---------- undo (its own stack, like the boards) ---------- */
function inPush() { const n = inboxNote(); if (!n || inSealed()) return; INB.undo.push(JSON.stringify(n.pages)); if (INB.undo.length > 80) INB.undo.shift(); INB.redo = []; if (QB.mode === 'inbox') qbSyncUndo(); }
function inRestore(from, to) { const n = inboxNote(); if (!n || inSealed() || !from.length) return false; to.push(JSON.stringify(n.pages)); n.pages = JSON.parse(from.pop()); saveNote(n, true); inRender(); qbSyncUndo(); qbBadge(); return true; }
// the reused assistant helpers call pushHistory(); while you're working in the Inbox it snapshots the Inbox instead of the open note
{ const _ph = pushHistory; pushHistory = function (...a) { if (INB.active && QB.open && QB.mode === 'inbox' && inboxNote() && !inSealed()) return inPush(); return _ph.apply(this, a); }; }
document.addEventListener('pointerdown', e => { const t = e.target; if (!t.closest) return;
  if (t.closest('#inHost')) INB.active = true;
  else if (!t.closest('#qbHead, #grokPop, .modal-wrap, #actionWrap, #sheetWrap, #undoToast, #toast, .gk-hl')) INB.active = false; }, true);

/* ---------- rendering ---------- */
const inSoon = () => { if (INB.rt) return; INB.rt = requestAnimationFrame(() => { INB.rt = 0; if (QB.open && QB.mode === 'inbox' && !inBusyUI()) inRender(); qbBadge(); }); };
const inBusyUI = () => { const a = document.activeElement; return !!(a && INHOST.contains(a) && a.matches('input, textarea, [contenteditable="true"]')); };
{ const _ons = window.onNoteSaved; window.onNoteSaved = n => { if (_ons) _ons(n); if (isInboxNote(n)) inSoon(); }; }
const inTime = c => +new Date(c.date || c.createdAt || 0);
const inWhen = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const now = new Date(), same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
const inIsRFQ = c => c.kind !== 'meeting' && typeof isRFQ === 'function' && isRFQ(c.subject || '', c.raw || '');
// related groups: the Assistant page's relatedMap, minus meeting-brief cards
function inUnits(n, pg) {
  const cards = asCards(pg), byId = new Map(cards.map(c => [c.id, c])), M = relatedMap(n), skip = new Set(cards.filter(c => c.kind === 'meeting').map(c => c.id));
  // stacks use the Assistant page's strong links (same thread, follow-up, ✨ similar topic, a shared order/ticket #, or several shared names);
  // its weak ones (same sender alone, two capitalised words in common) would pile unrelated mail together in a list view
  const strong = (a, r) => { if (r.why.some(w => w === 'same thread' || w === 'follow-up' || w === '✨ similar topic')) return true;
    const A = entities(byId.get(a) || {}), B = entities(byId.get(r.id) || {}), sh = [...A].filter(x => B.has(x));
    return sh.some(x => x.startsWith('id:')) || sh.length >= 3 || (r.why.includes('same sender') && sh.length >= 2); };
  for (const id of skip) M.delete(id); for (const [id, l] of M) M.set(id, l.filter(r => !skip.has(r.id) && strong(id, r)));
  const seen = new Set(), units = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    const ids = skip.has(c.id) ? new Set([c.id]) : relatedGroup(M, c.id), grp = [...ids].map(id => byId.get(id)).filter(Boolean).sort((a, b) => inTime(b) - inTime(a));
    grp.forEach(x => seen.add(x.id));
    const whys = grp.flatMap(x => (M.get(x.id) || []).filter(r => ids.has(r.id)).flatMap(r => r.why));
    const oldest = grp[grp.length - 1], why = grp.length < 2 ? '' : whys.some(w => w === 'same thread' || w === 'follow-up') ? 'Thread · ' + String(oldest.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
      : (whys.find(w => w.startsWith('shared: ')) || '').replace('shared: ', 'Related · ') || (whys.includes('same sender') ? 'From ' + (oldest.from || 'the same sender') : 'Related');
    units.push({ cards: grp, key: grp.map(x => x.id).sort()[0], lvl: Math.min(...grp.map(x => APRIO[cardPrio(x).level].i)), due: Math.min(...grp.map(earliestDue)), t: Math.max(...grp.map(inTime)), why });
  }
  return units;
}
function inCardHTML(c) {
  const P = cardPrio(c), acts = c.actions || [], open = acts.filter(a => !a.done), mt = c.meetings || [], dl = openDeadlines(c).filter(d => !mt.some(m => m.start === d.due) && !acts.some(a => a.due === d.due || overlap(a.text, d.text).j >= 0.5)), isM = c.kind === 'meeting';
  const icon = isM ? '📋' : c.kind === 'email' ? '✉️' : c.kind === 'ink' ? '✍︎' : '📝', rfq = inIsRFQ(c), pts = (c.points || []).slice(0, 4);
  return `<article class="ib-card p-${P.level} k-${c.kind} ${c.unread ? 'unread' : ''} ${INB.flash === c.id ? 'flash' : ''}" data-card="${c.id}">
    <header class="ib-h">
      <div class="ib-top"><span class="ib-from">${icon} ${esc(isM ? 'Meeting Brief' + (c.noteTitle ? ' · ' + c.noteTitle : '') : c.from || (c.kind === 'text' ? 'Note' : 'Unknown sender'))}</span><span class="ib-when">${esc(inWhen(c.date || c.createdAt))}</span>${c.unread ? '<i class="ib-dot" aria-label="Unread"></i>' : ''}</div>
      <div class="ib-subj">${esc(c.subject || '(no subject)')}</div>
      <div class="ib-tags"><button class="ib-prio p-${P.level}" data-ia="prio" aria-label="Priority: ${APRIO[P.level].label} — tap to change">${APRIO[P.level].icon} ${APRIO[P.level].label}</button><span class="ib-why">${P.by === 'user' ? '✋ ' : P.by === 'ai' ? '✨ ' : ''}${esc(P.reason || '')}</span>${rfq ? '<span class="ib-rfq">RFQ?</span>' : ''}</div>
      <div class="ib-hb"><button class="ib-grok" data-ia="grok" aria-label="Ask Grok about this email">✨ Ask Grok</button><button class="ib-more" data-ia="menu" aria-label="Email options">⋯</button></div>
    </header>
    ${c.followUp ? `<div class="ib-fu">↩︎ Follow-up to “${esc(c.followUp.subject || '')}”${c.followUp.done ? ` · ✓ ${c.followUp.done} earlier item${c.followUp.done > 1 ? 's' : ''} done` : ''}${c.followUp.updated ? ` · ${c.followUp.updated} updated` : ''}</div>` : ''}
    ${c.pending ? '<div class="ib-pend"><span class="gk-dots"><i></i><i></i><i></i></span> Grok is summarizing…</div>' : ''}
    ${c.locked ? '<p class="ib-sum">🔒 This brief belongs to a locked note — open the note to read it.</p>' : `<p class="ib-sum">${esc(c.summary || '')}</p>`}
    ${pts.length ? `<div class="ib-sec">${isM ? 'Key points' : 'Key asks & points'}</div><ul class="ib-pts">${pts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    ${c.locked ? '' : `<div class="ib-sec">Action items <b>${open.length}</b></div>
    ${acts.length ? `<ul class="ib-acts">${acts.map(a => `<li class="${a.done ? 'done' : ''}" data-act="${a.id}"><button class="ib-chk" data-ia="done" aria-label="${a.done ? 'Mark not done' : 'Mark done'}">${a.done ? '☑︎' : '☐'}</button><span class="ib-at" data-ia="editact" title="Tap to edit — the Inbox learns from your edits">${esc(a.text)}</span><span class="ib-chips">${a.owner && a.owner !== 'You' ? `<em>👤 ${esc(a.owner)}</em>` : ''}${a.due ? `<em class="due">⏰ ${esc(fmtDueShort(a.due))}</em>` : ''}${a.learned ? '<em title="Learned from your edits">🧠</em>' : ''}${a.sent && a.sent.to === 'ideas' ? '<em title="On the Idea Board">💡</em>' : ''}${a.updNote ? `<em>↻ ${esc(a.updNote)}</em>` : ''}</span></li>`).join('')}</ul>` : '<p class="ib-none">Nothing asked of you.</p>'}`}
    ${mt.length || dl.length ? `<ul class="ib-dl">${mt.map(m => `<li>📅 <b>${esc(m.title)}</b> · ${esc(fmtWhen(m.start))}${m.where ? ' · ' + esc(m.where) : ''} <button class="ib-btn sm" data-ia="cal" data-m="${m.id}">Add to Calendar</button></li>`).join('')}${dl.map(d => `<li>⏰ ${esc(fmtDueShort(d.due))} — ${esc(d.text)}</li>`).join('')}</ul>` : ''}
    ${c.ink ? `<img class="ib-ink" alt="Handwriting" src="${inkThumbURL(c.ink)}">${c.transcript ? `<p class="ib-tr">🔎 “${esc(c.transcript.text)}”</p>` : ''}` : ''}
    <div class="ib-row">${c.locked ? '' : '<button class="ib-btn" data-ia="addact">＋ Action</button>'}${open.length ? `<button class="ib-btn" data-ia="toideas">💡 To Idea Board</button>` : ''}${rfq ? '<button class="ib-btn rfq" data-ia="toquote">💲 To Quote Board</button>' : ''}${isM ? '<button class="ib-btn" data-ia="brief">📋 Open full brief</button>' + (c.email ? '<button class="ib-btn" data-ia="recap">✉︎ Follow-up email</button>' : '') : ''}${c.ink && !c.transcript ? '<button class="ib-btn" data-ia="read">🔎 Read handwriting</button>' : ''}</div>
    ${c.raw && c.raw.trim() && !isM ? `<details class="ib-raw" ${INB.raw.has(c.id) ? 'open' : ''}><summary>Original ${c.kind === 'email' ? 'email' : 'text'}${c.via ? ` <small>· ${esc(c.via)}</small>` : ''}</summary><pre>${esc(String(c.raw).slice(0, 8000))}</pre></details>` : ''}
    <footer class="ib-eng"><span class="gk-eng ${c.engine === 'Built-in' ? '' : 'ai'}">${c.engine === 'Built-in' ? '⚙︎ Built-in' : '✨ ' + esc(c.engine || '')}</span>${c.engineNote ? ` <small>${esc(c.engineNote)}</small>` : ''}</footer>
  </article>`;
}
const inMini = c => { const P = cardPrio(c); return `<button class="ib-mini" data-ia="grp"><i class="p-${P.level}"></i><span>${esc(c.from || 'Me')}</span><b>${esc(c.subject || '(no subject)')}</b><em>${esc(inWhen(c.date || c.createdAt))}</em></button>`; };
function inRender() {
  if (!QB.open || QB.mode !== 'inbox') return;
  const n = inboxNote(); if (!n) return; if (inSealed()) { qbRender(); return; }
  const pg = n.pages[0], cards = asCards(pg), order = pg.assist.order === 'new' ? 'new' : 'prio', top = INHOST.scrollTop;
  const units = inUnits(n, pg).sort(order === 'new' ? (a, b) => b.t - a.t : (a, b) => a.lvl - b.lvl || a.due - b.due || b.t - a.t);
  const legacy = legacyAssistPages(), lk = legacy.reduce((k, x) => k + asCards(x.pg).filter(c => c.kind !== 'brief').length, 0);
  const unitHTML = u => u.cards.length < 2 ? inCardHTML(u.cards[0]) : (() => { const open = INB.exp.has(u.key);
    return `<section class="ib-grp ${open ? 'open' : ''}" data-g="${u.key}"><div class="ib-gh"><span>🔗 ${esc(u.why)}</span><b>${u.cards.length} emails</b><button class="ib-btn sm" data-ia="grp">${open ? 'Collapse' : 'Show all'}</button></div>
      ${inCardHTML(u.cards[0])}${open ? u.cards.slice(1).map(inCardHTML).join('') : `<div class="ib-stack">${u.cards.slice(1).map(inMini).join('')}</div>`}</section>`; })();
  let body = '';
  if (!cards.length) body = `<div class="ib-empty"><div class="ib-e-i">📥</div><h3>Your Inbox is empty</h3><p class="fine">Copy an email in Mail and tap <b>📋 Paste</b>, or drag it onto this panel. Each one becomes a card with a summary, the key asks, action items and a priority — and related emails stack into threads.</p></div>`;
  else if (order === 'new') body = units.map(unitHTML).join('');
  else for (const [k, p] of Object.entries(APRIO)) { const us = units.filter(u => u.lvl === p.i); if (us.length) body += `<h4 class="ib-lvl p-${k}">${p.icon} ${p.label} <small>${us.reduce((s, u) => s + u.cards.length, 0)}</small></h4>` + us.map(unitHTML).join(''); }
  INHOST.innerHTML = `<div class="ib-bar">
      <div class="ib-drop"><b>📥 Paste or drop an email</b><small>Select the email text in Mail and drag it here — or copy it and tap Paste</small></div>
      <div class="ib-tools"><button class="ib-btn primary" data-ia="paste">📋 Paste</button><button class="ib-btn" data-ia="type">✍︎ Type…</button><span class="spacer"></span>
        <div class="ib-seg" role="group" aria-label="Sort"><button data-ia="order" data-o="prio" class="${order === 'prio' ? 'on' : ''}" aria-pressed="${order === 'prio'}">⇅ Priority</button><button data-ia="order" data-o="new" class="${order === 'new' ? 'on' : ''}" aria-pressed="${order === 'new'}">🕒 Newest</button></div></div>
      ${lk ? `<div class="ib-legacy">📥 ${lk} email card${lk > 1 ? 's' : ''} on ${legacy.length} old Assistant page${legacy.length > 1 ? 's' : ''}<button class="ib-btn sm" data-ia="import">Bring them in</button></div>` : ''}
    </div><div class="ib-list">${body}</div>`;
  INHOST.scrollTop = top;
  if (INB.flash) { const id = INB.flash; INB.flash = null; const el = INHOST.querySelector(`.ib-card[data-card="${id}"]`); if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTimeout(() => el.classList.remove('flash'), 1400); }); }
  qbSyncUndo();
}
function inFlash(id) { const u = inUnits(inboxNote(), inPage() || { assist: { cards: [] } }).find(x => x.cards.some(c => c.id === id)); if (u && u.cards.length > 1 && u.cards[0].id !== id) INB.exp.add(u.key); INB.flash = id; inRender(); }
INHOST.addEventListener('toggle', e => { const d = e.target; if (!d.matches || !d.matches('.ib-raw')) return; const id = d.closest('.ib-card').dataset.card; d.open ? INB.raw.add(id) : INB.raw.delete(id); }, true);

/* ---------- taps ---------- */
INHOST.addEventListener('click', async e => {
  const b = e.target.closest('[data-ia]'), el = e.target.closest('.ib-card'), f = el && findAsCard(el.dataset.card); INB.active = true;
  if (f && f.c.unread && !(b && b.dataset.ia === 'menu')) { f.c.unread = false; saveNote(f.n); el.classList.remove('unread'); const d = el.querySelector('.ib-dot'); if (d) d.remove(); qbBadge(); renderSidebar(); }
  if (!b) return; e.stopPropagation(); const a = b.dataset.ia, pg = inPage();
  if (a === 'paste') return inPasteButton();
  if (a === 'type') return inTypeSheet();
  if (a === 'import') return importAssistPages();
  if (a === 'order' && pg) { pg.assist.order = b.dataset.o; saveNote(inboxNote()); return inRender(); }
  if (a === 'grp') { const g = b.closest('.ib-grp'); if (!g) return; INB.exp.has(g.dataset.g) ? INB.exp.delete(g.dataset.g) : INB.exp.add(g.dataset.g); return inRender(); }
  if (!f) return;
  if (a === 'prio') return prioMenu(f);
  if (a === 'grok') return openGrok(inCtx(f.c.id));
  if (a === 'menu') return inCardMenu(f);
  if (a === 'editact') return editAction(f, b.closest('[data-act]').dataset.act);
  if (a === 'addact') return addActionManually(f);
  if (a === 'done') { const act = f.c.actions.find(x => x.id === b.closest('[data-act]').dataset.act); if (!act) return; inPush(); act.done = !act.done; if (act.done) act.doneNote = 'done'; saveNote(f.n, true); return; }
  if (a === 'toideas') return inToIdeas(f);
  if (a === 'toquote') return inToQuote(f);
  if (a === 'read') return readCardInk(f);
  if (a === 'cal') { const m = f.c.meetings.find(x => x.id === b.dataset.m); if (m) downloadIcs({ type: 'task', note: f.n, page: 0, obj: { id: m.id, text: m.title, due: m.start, end: m.end, where: m.where, repeat: '' } }); return; }
  if (a === 'brief') { if (qbW() >= 0.99) qbOpen(false); const r = findRec(f.c.rec); if (!r) return toast('That recording is no longer in your notes'); if (typeof isSealed === 'function' && isSealed(r.n)) { openNote(r.n.id); return; } gotoBrief(f.c.rec); return; }
  if (a === 'recap' && f.c.email) return openRecap(f);
});
function inCardMenu(f) {
  const c = f.c, open = (c.actions || []).filter(a => !a.done).length, P = cardPrio(c);
  actionSheet(c.subject || 'Email', [
    { label: '✨ Ask Grok…', sub: 'Draft a reply · make tasks · summarize · ask a question', fn: () => openGrok(inCtx(c.id)) },
    { label: '🚦 Priority…', sub: `Now ${APRIO[P.level].label} — setting it teaches the Inbox about this sender`, fn: () => prioMenu(f) },
    ...(inIsRFQ(c) ? [{ label: '💲 Move to Quote Board', sub: 'This looks like a request for quote', fn: () => inToQuote(f) }] : []),
    { label: '💡 Send to Idea Board', sub: open ? `${open} open action item${open > 1 ? 's' : ''} as a checklist or as cards` : 'As a card', fn: () => inToIdeas(f) },
    ...(aiReady() && c.raw && c.kind !== 'meeting' ? [{ label: '✨ Re-summarize with ' + aiModel(), fn: () => smarten(f.n.id, f.pg.id, c.id, { from: c.from, to: c.to, subject: c.subject, text: c.raw }, new Date(c.ref || Date.now())) }] : []),
    ...(c.raw && c.kind !== 'meeting' ? [{ label: '⚙︎ Re-summarize with the built-in engine', fn: () => { const fr = findAsCard(c.id); if (!fr) return; inPush(); Object.assign(fr.c, resultToCard(applyPrefsToResult(AssistEngine.extract({ from: fr.c.from, subject: fr.c.subject, date: new Date(fr.c.ref || Date.now()), text: fr.c.raw, prefs: memPrefs() }))), { engine: 'Built-in', engineNote: '' }); if (fr.c.prio && fr.c.prio.by === 'ai') delete fr.c.prio; saveNote(fr.n, true); } }] : []),
    { label: c.unread ? '✓ Mark as read' : '● Mark as unread', fn: () => { const fr = findAsCard(c.id); if (!fr) return; fr.c.unread = !fr.c.unread; saveNote(fr.n, true); renderSidebar(); } },
    { label: '🗑 Delete', danger: true, fn: () => { const fr = findAsCard(c.id); if (!fr) return; inPush(); fr.pg.assist.cards = fr.pg.assist.cards.filter(x => x.id !== c.id); saveNote(fr.n, true); actionToast('Email card deleted', 'Undo', () => { inRestore(INB.undo, INB.redo); toast('Restored', 1000); }, 5000); } }]);
}

/* ---------- ✨ Ask Grok on an Inbox card (reuses the v21 popover) ---------- */
function inCtx(id) {
  const f = findAsCard(id); if (!f) return null; const c = f.c;
  return { kind: 'inbox', cardId: id, typed: c.locked ? c.subject || '' : emailBlock(c) + (c.kind === 'meeting' && c.summary ? '\n\nSummary: ' + c.summary : ''), strokes: c.ink ? JSON.parse(JSON.stringify(c.ink.strokes)) : [], inkText: c.transcript ? c.transcript.text : '',
    what: (c.kind === 'meeting' ? 'meeting brief' : c.kind === 'email' ? 'email' : 'note') + (c.from && c.kind !== 'meeting' ? ' · ' + c.from : ''), from: c.kind === 'meeting' ? '' : c.from, fromAddr: c.fromAddr || '', subject: c.kind === 'meeting' && c.email ? c.email.subject : c.subject, isQuote: false, key: 'inb:' + id + ':' + (c.raw || '').length };
}
{ const _cr = ctxRect; ctxRect = function (c) { if (c && c.kind === 'inbox') { const el = INHOST.querySelector(`.ib-card[data-card="${c.cardId}"]`); return el ? el.getBoundingClientRect() : null; } return _cr(c); }; }
// built-in fallbacks work on the real card (its extracted actions, sender, memory) instead of re-parsing
{ const _pc = pseudoCard; pseudoCard = function (c, text) { if (c && c.kind === 'inbox') { const f = findAsCard(c.cardId); if (f) return f.c; } return _pc(c, text); }; }
{ const _dp = drawPop; drawPop = function () { _dp(); const c = GK.ctx; if (!c || c.kind !== 'inbox' || GK.view !== 'result') return;
    const b = pop.querySelector('[data-gk="checklist"]'); if (b) { b.dataset.gk = 'inacts'; b.textContent = '☑︎ Add to action items'; } placePop(); }; }
pop.addEventListener('click', e => {
  const b = e.target.closest('[data-gk="inacts"]'); if (!b || !GK.ctx || GK.ctx.kind !== 'inbox') return; e.stopImmediatePropagation();
  const ts = resultTasks(), f = findAsCard(GK.ctx.cardId); if (!f || !ts.length) return; inPush();
  f.c.actions.push(...ts.map(t => ({ id: uid('aa'), text: t.text, owner: 'You', due: t.due || null, dueText: '', manual: true, by: GK.res.engine }))); saveNote(f.n, true); closeGrok(); toast(`☑︎ ${ts.length} action item${ts.length > 1 ? 's' : ''} added`, 1600);
}, true);
INHOST.addEventListener('scroll', () => placePop(), { passive: true });

/* ---------- 💲 / 💡 moves ---------- */
async function inToQuote(f) {
  const c = f.c; if (qbSealed()) return toast('🔒 Unlock the Quote Board first');
  const qn = ensureQuoteNote(), qSnap = JSON.stringify(qn.pages), iSnap = JSON.stringify(f.n.pages);
  const r = await addQuoteFromEmail({ from: c.fromAddr ? { name: c.from || '', address: c.fromAddr } : (c.from || ''), subject: c.subject || '', date: c.date || null, text: c.raw || c.summary || '', messageId: c.msgId || '', conversationId: c.convId || '', webLink: c.webLink || '' }, { source: 'inbox' });
  if (!r || r.status === 'locked') return;
  const fr = findAsCard(c.id); if (fr) { INB.undo.push(iSnap); INB.redo = []; fr.pg.assist.cards = fr.pg.assist.cards.filter(x => x.id !== c.id); saveNote(fr.n, true); }
  qbOpen(true, { quiet: true, mode: 'quotes' }); if (r.card) setTimeout(() => boardFlash(QPI, r.card.id), 60);
  actionToast(r.status === 'new' ? `💲 Moved to the Quote Board — “${r.card.text}”` : r.status === 'followup' ? `↩︎ Added as a follow-up to “${r.card.text}”` : 'Already on the Quote Board — removed from the Inbox', 'Undo', () => {
    const q = quoteNote(), inb = inboxNote(); if (q && !qbSealed()) { q.pages = JSON.parse(qSnap); saveNote(q, true); } if (inb && !inSealed()) { inb.pages = JSON.parse(iSnap); saveNote(inb, true); }
    qbOpen(true, { quiet: true, mode: 'inbox' }); qbRender(); qbBadge(); toast('Back in the Inbox', 1400); }, 8000);
}
function inToIdeas(f) {
  const c = f.c, open = (c.actions || []).filter(a => !a.done);
  const go = per => {
    const n = ensureIdeaNote(); if (ibSealed()) return toast('🔒 Unlock the Idea Board first');
    const pg = n.pages[0], col = boardCols(pg)[0]; bH(IPI);
    const mk = (title, items, due) => ({ id: uid('t'), kind: 'card', col: col.id, ord: -1, text: String(title || 'Email').slice(0, 140), strokes: [], done: false, due: due || null, repeat: '', notified: false, createdAt: Date.now(), typed: true, from: { inbox: c.id, subject: c.subject || '' },
      ...(items.length ? { items: items.slice(0, 20).map(s => ({ id: uid('i'), done: false, strokes: [], text: s, typed: true })) } : {}) });
    const ts = per ? open.map(a => mk(a.text, [], a.due)) : [mk(c.subject || autoTitle(c.raw) || 'Email', open.map(a => a.text + (a.due ? ' — ' + fmtDueShort(a.due) : '')), open.map(a => a.due).filter(Boolean).sort()[0])];
    pg.tasks.push(...ts); renumber(pg, col.id); saveNote(n, true);
    const fr = findAsCard(c.id); if (fr) { inPush(); for (const a of fr.c.actions) if (!a.done) a.sent = { to: 'ideas', noteId: IDEA_ID }; saveNote(fr.n, true); }
    renderPanel(); renderSidebar();
    actionToast(`💡 ${ts.length === 1 ? 'Card' : ts.length + ' cards'} on the Idea Board`, 'Show', () => { qbOpen(true, { mode: 'ideas' }); setTimeout(() => ts.forEach(t => boardFlash(IPI, t.id)), 80); }, 6000);
  };
  if (open.length > 1) actionSheet('Send to the Idea Board', [{ label: '💡 One card with a checklist', sub: `“${c.subject || 'Email'}” · ${open.length} items`, primary: true, fn: () => go(false) }, { label: `☑️ ${open.length} cards — one per action item`, fn: () => go(true) }]);
  else go(false);
}

/* ---------- intake: paste, drop, type, lasso, sync ---------- */
const inIntake = (snap, source) => intake(snap, source, IN_PI);
// every assistant intake path (this panel, old Assistant pages, files, lasso) now lands in the Inbox; Meeting Brief pages are untouched
{ const _ae = addEmail; addEmail = async function (pi, email, opts = {}) { const n = curNote(), pg = n && pi >= 0 ? n.pages[pi] : null;
    if (pi === IN_PI || opts.toInbox || (pg && isAssistPage(pg) && !pg.assist.brief && !isInboxNote(n))) return inAddEmail(email, opts);
    return _ae.apply(this, arguments); }; }
async function inAddEmail(email, opts = {}) {
  const n = ensureInboxNote(); if (inSealed()) { toast('🔒 Unlock the Inbox to add emails'); return null; }
  const pg = n.pages[0], text = String(email.text || ''), subj = email.subject || '';
  if (!opts.noRfqAsk && typeof isRFQ === 'function' && isRFQ(subj, text)) {
    const ch = await new Promise(res => { actionSheet('This looks like a request for quote', [{ label: '💲 Add it to the Quote Board', sub: 'Customer, RFQ #, items and due date are filled in for you', primary: true, fn: () => res('q') }, { label: '📥 Keep it in the Inbox', fn: () => res('i') }]);
      $('#actionWrap').addEventListener('click', e => { if (e.target.id === 'actionWrap' || e.target.textContent === 'Cancel') res(null); }, { once: true }); });
    if (!ch) return null; if (ch === 'q') return intakeToQuotes(email, opts.via || 'inbox');
  }
  const addr = ((String(email.from || '').match(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/) || [])[0] || '').toLowerCase(), key = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 240).toLowerCase();
  const dup = asCards(pg).find(c => (email.messageId && c.msgId === email.messageId) || (key(c.raw) === key(text) && key(c.subject) === key(subj) && (c.fromAddr || '') === addr && text.trim()));
  if (dup) { if (opts.open !== false) { qbOpen(true, { quiet: true, mode: 'inbox' }); inFlash(dup.id); } if (!opts.quiet) toast('Already in the Inbox', 1800); return dup; }
  const now = new Date(), ref = email.date && !isNaN(new Date(email.date)) ? new Date(email.date) : now;
  const r = applyPrefsToResult(AssistEngine.extract({ ...email, date: ref, prefs: memPrefs() }));
  inPush();
  const card = { id: uid('ac'), x: 24, y: AS_TOP, w: AS_W, h: AS_H, kind: opts.kind || 'email', from: r.from || email.from || '', fromAddr: addr, to: email.to || '', subject: subj || autoTitle(text) || (opts.kind === 'text' ? 'Pasted text' : ''),
    date: email.date && !isNaN(new Date(email.date)) ? new Date(email.date).toISOString() : null, ref: ref.toISOString(), ...resultToCard(r), raw: text.slice(0, 20000), engine: 'Built-in', via: opts.via || '', createdAt: Date.now(),
    ...(opts.unread ? { unread: true } : {}), ...(email.messageId ? { msgId: email.messageId } : {}), ...(email.conversationId ? { convId: email.conversationId } : {}), ...(email.webLink ? { webLink: email.webLink } : {}), ...(opts.ink ? { ink: opts.ink } : {}) };
  if (opts.ink && !text.trim()) { card.summary = 'Handwritten note — attached below. Tap ✨ Ask Grok → Convert to text, or 🔎 Read handwriting, to summarize it.'; card.kind = 'ink'; card.subject = card.subject || 'Handwriting'; }
  asCards(pg).push(card); afterCardAdded(n, pg, card); saveNote(n, true);
  if (opts.open !== false) { qbOpen(true, { quiet: true, mode: 'inbox' }); inFlash(card.id); }
  if (!opts.quiet && aiReady() && card.kind !== 'ink') toast(`📥 Added to the Inbox — ✨ ${aiModel()} is summarizing…`, 2200);
  else if (!opts.quiet) { const P = cardPrio(card); toast(`📥 ${APRIO[P.level].icon} ${APRIO[P.level].label} · ${card.actions.length} action item${card.actions.length === 1 ? '' : 's'}${card.followUp ? ' · follow-up to an earlier email' : ''}`, 2200); }
  if (aiReady() && card.kind !== 'ink') smarten(n.id, pg.id, card.id, email, ref);
  qbBadge(); renderSidebar();
  return card;
}
async function inPasteButton() {
  if (inSealed()) return toast('🔒 Unlock the Inbox first');
  try {
    if (navigator.clipboard && navigator.clipboard.read) { const items = await navigator.clipboard.read(), strings = {}, lengths = {}, types = [];
      for (const it of items) for (const ty of it.types) { types.push(ty); if (ty.startsWith('text/')) { const v = await (await it.getType(ty)).text(); strings[ty] = v; lengths[ty] = v.length; } }
      return inIntake({ types, strings, lengths, files: [], items: types.map(ty => ({ kind: 'string', type: ty })) }, 'paste button'); }
    const v = await navigator.clipboard.readText(); return inIntake({ types: ['text/plain'], strings: { 'text/plain': v }, lengths: { 'text/plain': v.length }, files: [], items: [] }, 'paste button');
  } catch (err) { inTypeSheet(); toast('Long-press in the box and tap Paste', 3500); }
}
function inTypeSheet(prefill = '') {
  if (inSealed()) return toast('🔒 Unlock the Inbox first');
  const w = modalWrap('inTypeWrap');
  w.innerHTML = `<div class="sheet in-type" role="dialog" aria-modal="true" aria-label="Add an email to the Inbox"><h3>📥 Add an email</h3>
    <p class="fine">Paste the email — the From:, Subject: and Date: lines help — or type a note. ${aiReady() ? '✨ ' + esc(aiModel()) + ' writes the summary.' : '⚙︎ The built-in assistant summarizes it offline; connect Grok for smarter summaries.'}</p>
    <textarea id="inTypeText" rows="12" spellcheck="true" placeholder="From: Dana Ortiz &lt;dana@example.com&gt;&#10;Subject: Booth graphics for the expo&#10;&#10;Hi — could you…">${esc(prefill)}</textarea>
    <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-it="x">Cancel</button><button class="btn primary" data-it="ok">Add to Inbox</button></div></div>`;
  w.hidden = false; setTimeout(() => { const t = w.querySelector('#inTypeText'); if (t && !prefill) t.focus(); }, 60);
  w.onclick = async e => { if (e.target === w) { w.hidden = true; return; } const b = e.target.closest('[data-it]'); if (!b) return; if (b.dataset.it === 'x') { w.hidden = true; return; }
    const t = w.querySelector('#inTypeText').value; if (!t.trim()) return toast('Paste or type something first'); w.hidden = true; INB.active = true;
    await inIntake({ types: ['text/plain'], strings: { 'text/plain': t }, lengths: { 'text/plain': t.length }, files: [], items: [] }, 'typed'); };
}
function inAddMenu() { if (inSealed()) return toast('🔒 Unlock the Inbox first'); actionSheet('Add to the Inbox', [
  { label: '📋 Paste an email', sub: 'Copy it in Mail first', primary: true, fn: () => inPasteButton() },
  { label: '✍︎ Type or paste text…', sub: 'A note or an email you paste in by hand', fn: () => inTypeSheet() },
  { label: '↘︎ Drag from Mail', sub: 'Select the email text in Mail and drop it on this panel', fn: () => toast('Select the email text in Mail, then drag it onto the Inbox', 3500) }]); }
function inMoreMenu() {
  const pg = inPage(), L = legacyAssistPages().length, on = localStorage.getItem('inboxFromSync') === '1';
  actionSheet('Inbox', [widthRow(),
    { label: '📋 Paste an email', fn: () => inPasteButton() }, { label: '✍︎ Type or paste text…', fn: () => inTypeSheet() },
    ...(pg ? [{ label: pg.assist.order === 'new' ? '⇅ Sort by priority' : '🕒 Sort by newest', fn: () => { pg.assist.order = pg.assist.order === 'new' ? 'prio' : 'new'; saveNote(inboxNote()); inRender(); } }] : []),
    ...(inUnread() ? [{ label: `✓ Mark all ${inUnread()} as read`, fn: () => { inCards().forEach(c => delete c.unread); saveNote(inboxNote(), true); renderSidebar(); } }] : []),
    ...(L ? [{ label: `📥 Bring in old Assistant pages (${L})…`, fn: () => importAssistPages() }] : []),
    { label: '📧 Emails the quote sync skips: ' + (on ? 'also add here' : 'Skipped list only'), sub: 'Sync only looks at RFQ / quote emails; this decides where the non-RFQ ones go', fn: () => { localStorage.setItem('inboxFromSync', on ? '0' : '1'); toast(on ? 'Skipped emails stay in 🙈 Skipped only' : 'Skipped work emails will also land in the 📥 Inbox'); } },
    { label: `🧠 What the Inbox learned (${memRules().length})…`, sub: 'Rules from your edits to priorities, owners and action items', fn: memorySettings },
    { label: '⚙︎ Settings…', fn: () => openSettings('quotes') }]);
}
// lasso → 📤 Send to… → 📥 Inbox (the old “🤖 To assistant”, without the page picker)
lassoToAssistant = async function () {
  const sel = selection; if (!sel) return;
  const n = curNote(), pg = n.pages[sel.pi];
  const texts = (sel.texts || []).map(id => pg.texts.find(t => t.id === id)).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text);
  const tasks = (sel.tasks || []).map(id => pg.tasks.find(t => t.id === id)).filter(t => t && t.text).map(t => '- ' + t.text);
  const strokes = pg.strokes.filter(s => sel.ids.includes(s.id)), text = (AS.readText || [...texts, ...tasks].join('\n')).trim();
  if (!text && !strokes.length) { toast('Select some text or handwriting first'); return; }
  let ink = null; if (strokes.length) { let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of strokes) { const q = s.bb || bbox(s.points); bb = [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[2]), Math.max(bb[3], q[3])]; } ink = { strokes: JSON.parse(JSON.stringify(strokes)), bb }; }
  hideLasso(); const first = text.split('\n')[0].replace(/^- /, '');
  return inAddEmail({ from: 'Me', subject: text ? (first.length > 60 ? first.slice(0, 57) + '…' : first) : 'Handwriting', date: new Date(), text }, { kind: strokes.length && !text ? 'ink' : 'text', via: 'lasso · ' + n.title, ink, noRfqAsk: true });
};
{ const b = document.getElementById('lassoAssist'); if (b) b.onclick = lassoToAssistant; }
// email sync: the RFQ search can hand over emails that turn out not to be RFQs — opt-in, they get an Inbox card too
async function inFromSync(m, { force = false, open = false } = {}) {
  if (!force && localStorage.getItem('inboxFromSync') !== '1') return null;
  try { ensureInboxNote(); } catch (_) { return null; } if (inSealed()) return null;
  const fm = m.from && typeof m.from === 'object' ? (m.from.name ? `${m.from.name} <${m.from.address || ''}>` : m.from.address || '') : m.from || '';
  return inAddEmail({ from: fm, subject: m.subject || '', date: m.date ? new Date(m.date) : null, text: m.text || '', messageId: m.messageId || '', conversationId: m.conversationId || '', webLink: m.webLink || '' },
    { kind: 'email', via: force ? 'from 🙈 Skipped emails' : 'email sync', unread: !force, open, quiet: !open, noRfqAsk: true });
}

/* ---------- AI: smarter summaries see the other Inbox cards (related / follow-up detection), like the Assistant page did ---------- */
{ const _ac = aiContext; aiContext = function (cardId) { const f = findAsCard(cardId); if (!f || !isInboxNote(f.n)) return _ac(cardId);
    return asCards(f.pg).filter(c => c.id !== cardId && c.kind !== 'meeting').sort((a, b) => inTime(a) - inTime(b)).slice(-10).map(c => ({ id: c.id, subject: c.subject, from: c.from, date: c.date, summary: String(c.summary || '').slice(0, 200), open_actions: (c.actions || []).filter(a => !a.done).map(a => ({ id: a.id, text: a.text })) })); }; }
smarten = async function (noteId, pageId, cardId, email, ref) {
  const find = () => { const f = findAsCard(cardId); return f && f.n.id === noteId ? f : null; };
  let f = find(); if (!f) return; f.c.pending = true; if (f.n.id === S.cur) renderAssist(f.pi); if (isInboxNote(f.n)) inSoon();
  try {
    const r = await aiSummarize(email, ref, f.n.id === S.cur || isInboxNote(f.n) ? aiContext(cardId) : []); f = find(); if (!f) return;
    const sentById = new Map(f.c.actions.filter(a => a.sent).map(a => [a.text.toLowerCase(), a.sent]));
    Object.assign(f.c, resultToCard(r), { engine: aiModel(), engineNote: '' });
    f.c.actions.forEach(a => { const s = sentById.get(a.text.toLowerCase()); if (s) a.sent = s; });
    if (r.prio && !(f.c.prio && f.c.prio.by === 'user') && !memPrefs().senderPrio[senderKey(f.c)]) f.c.prio = r.prio;
    f.c.aiRelated = r.related;
    const prevId = (f.c.followUp && f.c.followUp.id) || r.followUpOf, prev = prevId && findAsCard(prevId);
    if (prev && prev.n.id === f.n.id) applyFollowUp(f.n, f.c, prev.c, r.done);
    if (f.pg.assist.sort) arrangeByPrio(f.pg, true);
  } catch (err) {
    f = find(); if (!f) return;
    f.c.engineNote = 'AI unavailable (' + (err.name === 'AbortError' ? 'timed out' : err.message) + ') — built-in summary shown';
    toast('✨ AI summary failed — kept the built-in one', 2600);
  }
  delete f.c.pending; saveNote(f.n, true); if (f.n.id === S.cur) rerenderAssist();
};
// helpers that re-render “the assistant page” also refresh the Inbox
{ const _ra = renderAssist; renderAssist = function (pi) { _ra(pi); try { inLegacyBanner(pi); } catch (e) { console.warn(e); } inSoon(); }; }

/* ---------- old 🤖 Assistant pages → the Inbox (once, automatically, with Undo) ---------- */
const legacyAssistPages = () => { const out = []; for (const n of S.notes) { if (SYS_IDS.includes(n.id) || (typeof isSealed === 'function' && isSealed(n))) continue;
  n.pages.forEach((pg, i) => { if (isAssistPage(pg) && !pg.assist.brief && asCards(pg).some(c => c.kind !== 'brief')) out.push({ n, i, pg }); }); } return out; };
function importAssistPages(list = legacyAssistPages(), { quiet = false, auto = false } = {}) {
  if (auto) list = list.filter(x => !x.n.lock);          // never copy a locked note's emails into the Inbox on its own
  if (!list.length) return 0;
  const inb = ensureInboxNote(); if (inSealed()) { if (!quiet) toast('🔒 Unlock the Inbox first'); return 0; }
  const notes = [...new Set(list.map(x => x.n))], before = new Map([[inb.id, JSON.stringify(inb.pages)], ...notes.map(n => [n.id, JSON.stringify(n.pages)])]), dst = inb.pages[0];
  let moved = 0;
  for (const { n, pg } of list) {
    const keep = [], go = []; for (const c of asCards(pg)) (c.kind === 'brief' ? keep : go).push(c);
    for (const c of go) { c.via = [c.via, 'from “' + n.title + '”'].filter(Boolean).join(' · '); c.fromNote = n.id; delete c.chatOpen; asCards(dst).push(c); moved++; }
    pg.assist.cards = keep; pg.assist.movedToInbox = { at: Date.now(), count: go.length + ((pg.assist.movedToInbox && pg.assist.movedToInbox.count) || 0) };
  }
  saveNote(inb, true); for (const n of notes) saveNote(n, true);
  INB.undo = []; INB.redo = []; if (notes.some(n => n.id === S.cur)) { S.undo = []; S.redo = []; updateUndo(); }
  rerenderAssist(); renderSidebar(); qbBadge(); if (QB.open && QB.mode === 'inbox') inRender();
  actionToast(`📥 ${moved} email card${moved === 1 ? '' : 's'} from ${list.length} old Assistant page${list.length === 1 ? '' : 's'} moved to the Inbox`, 'Undo', () => {
    for (const [id, pages] of before) { const x = S.notes.find(m => m.id === id); if (x && !(typeof isSealed === 'function' && isSealed(x))) { x.pages = JSON.parse(pages); saveNote(x, true); } }
    INB.undo = []; INB.redo = []; rerenderAssist(); renderSidebar(); qbBadge(); if (QB.open) qbRender(); toast('Assistant pages restored', 1600);
  }, 10000);
  return moved;
}
function inLegacyBanner(pi) {
  const n = curNote(), pg = n && n.pages[pi], rec = pageEls[pi]; if (!rec || !isAssistPage(pg) || pg.assist.brief || isInboxNote(n)) return;
  const dz = rec.ov.querySelector('.as-drop'); if (!dz) return;
  const k = asCards(pg).filter(c => c.kind !== 'brief').length, dt = dz.querySelector('.as-dt'), ds = dz.querySelector('.as-ds'), bt = dz.querySelector('.as-dbtns');
  if (dt) dt.innerHTML = '📥 <b>Emails now live in the Inbox</b>';
  if (ds) ds.textContent = k ? `${k} card${k > 1 ? 's' : ''} here can move to the 📥 Inbox in the 📋 Boards panel — summaries, priorities and threads come along.` : 'This was an Assistant page. Emails you drop or paste here go to the 📥 Inbox in the 📋 Boards panel.';
  if (bt) bt.innerHTML = `<button class="as-btn" data-inb="open">📥 Open the Inbox</button>${k ? `<button class="as-btn on" data-inb="move">Move ${k} card${k > 1 ? 's' : ''} to the Inbox</button>` : ''}<button class="as-btn" data-aa="paste">📋 Paste</button>`;
}
PAGES.addEventListener('click', e => { const b = e.target.closest('[data-inb]'); if (!b) return; e.stopPropagation();
  if (b.dataset.inb === 'open') return qbOpen(true, { mode: 'inbox' });
  const pi = +b.closest('.page').dataset.pi, n = curNote(), inb = ensureInboxNote();
  if (n.lock && !inb.lock && !confirm('This note is locked, but the Inbox isn’t. Move these emails into the Inbox anyway? (You can lock the Inbox with its 🔒 button.)')) return;
  importAssistPages([{ n, i: pi, pg: n.pages[pi] }]); qbOpen(true, { quiet: true, mode: 'inbox' }); }, true);

/* ---------- 🎙 Grok Meeting Brief → a meeting-brief card in the Inbox (the full brief pages stay with the recording) ---------- */
function syncMeetingCard(n, recId) {
  if (!n || SYS_IDS.includes(n.id)) return; let inb; try { inb = ensureInboxNote(); } catch (_) { return; } if (inSealed()) return;
  const pages = briefPagesOf(n, recId); if (!pages.length) return;
  const all = pages.flatMap(([p]) => p.assist.cards), B = pages[0][0].assist.brief, ov = all.find(c => c.btype === 'overview'), ac = all.find(c => c.btype === 'actions'), fu = all.find(c => c.btype === 'followup');
  const dst = inb.pages[0], cur = asCards(dst).find(c => c.kind === 'meeting' && c.rec === recId);
  const locked = !!n.lock;                                   // a locked note's brief never copies its content into the Inbox
  const data = { kind: 'meeting', rec: recId, noteId: n.id, noteTitle: n.title, from: 'Meeting Brief', fromAddr: '', subject: B.title || n.title, date: new Date(B.at || Date.now()).toISOString(), ref: new Date(B.at || Date.now()).toISOString(), engine: B.engine || 'Built-in', engineNote: B.warn || '', locked,
    summary: locked ? '' : (ov && ov.summary) || '', points: locked ? [] : ((ov && ov.points) || []).slice(0, 5), meetings: [], deadlines: [], raw: locked ? '' : [ov && ov.raw, ac && ac.raw].filter(Boolean).join('\n\n'),
    actions: locked ? [] : ((ac && ac.actions) || []).map(a => ({ id: a.id || uid('aa'), text: a.text, owner: a.owner || '', due: a.due && !isNaN(new Date(a.due)) ? new Date(a.due).toISOString() : null, dueText: a.due || '', prio: a.prio })),
    email: locked || !fu ? null : { ...fu.email } };
  if (cur) { const keepDone = new Map((cur.actions || []).map(a => [a.text, a])); Object.assign(cur, data, { unread: true }); cur.actions.forEach(a => { const o = keepDone.get(a.text); if (o) { a.done = o.done; a.sent = o.sent; } }); }
  else asCards(dst).push({ id: uid('ac'), x: 24, y: AS_TOP, w: AS_W, h: AS_H, createdAt: Date.now(), via: 'Grok Meeting Brief', unread: true, ...data });
  saveNote(inb, true); qbBadge(); renderSidebar();
}
{ const _wb = writeBrief; writeBrief = function (f, ...a) { const r = _wb.call(this, f, ...a); try { syncMeetingCard(f.n, f.rec.id); toast('📋 Meeting Brief ready — a summary card is in the 📥 Inbox', 3200); } catch (e) { console.warn('Inbox meeting card', e); } return r; }; }
{ const _as = applySpeakerName; applySpeakerName = function (recId, ...a) { const r = _as.call(this, recId, ...a); try { const f = findRec(recId); if (f) syncMeetingCard(f.n, recId); } catch (e) { console.warn(e); } return r; }; }

/* ---------- sidebar row, search, startup ---------- */
function inSidebarRow() {
  const n = inboxNote(), box = $('#notebookList'); if (!n || !box || box.querySelector('#inRow')) return;
  const q = S.search.trim().toLowerCase(); if (q && !noteSearchText(n).includes(q)) return;
  const u = inUnread(), hit = q && !inSealed() ? inCards().find(c => [c.from, c.subject, c.summary].join(' ').toLowerCase().includes(q)) : null;
  const r = document.createElement('div'); r.className = 'today-row qb-row'; r.id = 'inRow'; r.setAttribute('role', 'button');
  r.innerHTML = `📥 <span class="name">Inbox${hit ? `<small class="s hit">${esc(hit.subject || hit.from || '')}</small>` : ''}</span><span class="cnt ${u ? 'on' : ''}" ${u ? `aria-label="${u} unread"` : ''}>${inSealed() ? '🔒' : u || inCards().length}</span>`;
  const after = box.querySelector('#qbRow') || box.querySelector('#todayRow'); after ? after.after(r) : box.prepend(r);
}
{ const _rs = renderSidebar; renderSidebar = function (...a) { const r = _rs.apply(this, a); try { inSidebarRow(); } catch (e) { console.warn(e); } return r; }; }
$('#notebookList').addEventListener('click', e => { const r = e.target.closest('#inRow'); if (!r) return; e.stopPropagation(); if (isDrawer()) setSidebar(false); qbOpen(true, { mode: 'inbox' });
  const q = S.search.trim().toLowerCase(); if (q) { const c = inCards().find(x => [x.from, x.subject, x.summary, x.raw].join(' ').toLowerCase().includes(q)); if (c) setTimeout(() => inFlash(c.id), 60); } }, true);
whenAppReady(() => {
  try { ensureInboxNote(); } catch (e) { console.warn(e); return; }
  if (!localStorage.getItem('v21inbox')) { localStorage.setItem('v21inbox', '1'); try { importAssistPages(undefined, { auto: true }); } catch (e) { console.warn('Inbox migration', e); } }
  if (QB.open && QB.mode === 'inbox') qbRender(); qbBadge(); renderSidebar();
});
window.Inbox = { INB, inRender, inAddEmail, inIntake, inTypeSheet, inPasteButton, inCtx, importAssistPages, legacyAssistPages, syncMeetingCard, inFromSync, inToIdeas, inToQuote, inUnread, inCards, inFlash };
