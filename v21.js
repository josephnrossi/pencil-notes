'use strict';
/* Pencil Notes v21 — revamp.
   1. One slide-out board panel (💲 Quote Board / 💡 Idea Board dropdown — see quotes.js). Project Board pages are retired as a page type;
      existing ones keep working and move into the Idea Board (automatically once, with Undo, or from the banner on the page).
   2. ✨ Ask Grok: the assistant is a lasso / highlight action instead of a page. Summarize · Convert to text · Make tasks · Draft reply ·
      Clean up · Ask. Results open in a small popover next to the selection with Insert / Copy / Add as card.
      Board cards (Quote Board emails included) get the same actions from their ⋯ menu and a ✨ chip.
   3. Clean-up: a shorter top bar, one grouped ⋯ menu, a shorter lasso menu (Send to… and ⋯ More), no duplicate doors. */


/* ======================= 1. retire the Project Board / Assistant page templates ======================= */
for (const k of ['board', 'assistant']) { const i = TEMPLATES.findIndex(t => t[0] === k); if (i >= 0) TEMPLATES.splice(i, 1); }
{ const s = document.querySelector('#insPage small'); if (s) s.textContent = 'Lined, grid, meeting, planner, recording…'; const b = $('#insPage'); if (b) b.title = 'Add a page: lined, grid, blank, meeting, planner or recording'; }

/* legacy board pages (pi ≥ 0) → the Idea Board */
const legacyBoardPages = () => { const out = []; for (const n of S.notes) if (!piOfSysNote(n.id) && !(typeof isSealed === 'function' && isSealed(n))) n.pages.forEach((pg, i) => { if (isBoardPage(pg)) out.push({ n, i, pg }); }); return out; };
function moveBoardPageIntoIdeas(n, pg, idea) {
  const ipg = idea.pages[0], icols = boardCols(ipg), last = icols[icols.length - 1];
  let moved = 0;
  for (const c of boardCols(pg)) {
    let dst = icols.find(x => String(x.title).trim().toLowerCase() === String(c.title).trim().toLowerCase());
    if (!dst) { dst = { id: uid('c'), title: c.title || 'Column', ...(c.w ? { w: c.w } : {}) }; icols.splice(icols.indexOf(last), 0, dst); }   // new columns go before Done
    for (const t of colCards(pg, c.id)) { pg.tasks = pg.tasks.filter(x => x !== t); t.col = dst.id; t.ord = 999 + moved; ipg.tasks.push(t); moved++; }
    renumber(ipg, dst.id);
  }
  for (const t of ipg.tasks) if (isCard(t)) { const d = isDoneCol(ipg, t.col); if (d !== !!t.done) { t.done = d; t.doneAt = d ? (t.doneAt || Date.now()) : null; } }
  const title = (pg.board && pg.board.title) || 'Project Board';
  pg.bg = null; pg.paper = 'lined'; delete pg.board;
  pg.texts.push({ id: uid('x'), x: 100, y: 112, text: `📋 This ${title.replace(/^\W+\s*/, '')} moved to the 💡 Idea Board (${new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}).\nOpen it from 📋 in the top bar or swipe in from the right edge.`, size: 24, color: INK });
  return moved;
}
function importLegacyBoards(list = legacyBoardPages(), { quiet = false } = {}) {
  if (!list.length) return 0;
  const idea = ensureIdeaNote(); if (ibSealed()) { if (!quiet) toast('🔒 Unlock the Idea Board first'); return 0; }
  const notes = [...new Set(list.map(x => x.n))], before = new Map([[idea.id, JSON.stringify(idea.pages)], ...notes.map(n => [n.id, JSON.stringify(n.pages)])]);
  let moved = 0; for (const { n, pg } of list) moved += moveBoardPageIntoIdeas(n, pg, idea);
  saveNote(idea, true); for (const n of notes) saveNote(n, true);
  IB.undo = []; IB.redo = []; S.undo = []; S.redo = []; updateUndo();
  buildPages(); renderAll(); if (QB.open && QB.mode === 'ideas') qbRender();
  actionToast(`💡 ${moved} card${moved === 1 ? '' : 's'} from ${list.length} Project Board page${list.length === 1 ? '' : 's'} moved to the Idea Board`, 'Undo', () => {
    for (const [id, pages] of before) { const x = S.notes.find(m => m.id === id); if (x && !(typeof isSealed === 'function' && isSealed(x))) { x.pages = JSON.parse(pages); saveNote(x, true); } }
    buildPages(); renderAll(); if (QB.open) qbRender(); toast('Project Board pages restored', 1600);
  }, 10000);
  return moved;
}
/* a banner on any remaining (e.g. just-unlocked) board page */
{ const _rb = renderBoard; renderBoard = function (pi) {
    _rb(pi); if (isSysPi(pi)) return;
    const rec = pageEls[pi], pg = curNote() && curNote().pages[pi]; if (!rec || !isBoardPage(pg)) return;
    rec.el.classList.add('has-legacy');
    if (!rec.el.querySelector('.legacy-board-bar')) { const b = document.createElement('div'); b.className = 'legacy-board-bar';
      b.innerHTML = `<span>📋 Project Boards now live in the slide-out <b>💡 Idea Board</b>.</span><button class="btn primary" data-lb="move">Move cards to Idea Board</button>`;
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.querySelector('[data-lb]').onclick = () => { const n = curNote(); if (importLegacyBoards([{ n, i: pi, pg: n.pages[pi] }])) qbOpen(true, { mode: 'ideas' }); };
      rec.el.append(b); }
  }; }
QuoteBoard.whenAppReady(() => setTimeout(() => {      // one-time automatic move on the first v21 launch (Undo offered)
  if (localStorage.getItem('v21boards')) return; const list = legacyBoardPages();
  localStorage.setItem('v21boards', '1'); if (list.length) importLegacyBoards(list, { quiet: true });
}, 600));

/* ======================= 2. ✨ Ask Grok — the assistant as a lasso / highlight action ======================= */
const GK = { ctx: null, cache: new Map(), busy: false, view: 'menu', res: null };
const GK_ACTS = [
  { id: 'summarize', ic: '📝', l: 'Summarize' },
  { id: 'read', ic: '🔤', l: 'Convert to text', ink: true },
  { id: 'tasks', ic: '☑️', l: 'Make tasks' },
  { id: 'reply', ic: '✉️', l: 'Draft reply' },
  { id: 'rewrite', ic: '✨', l: 'Clean up' },
];
const pop = (() => { const d = document.createElement('div'); d.id = 'grokPop'; d.hidden = true; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Ask Grok'); document.body.append(d); return d; })();
const plural2 = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
function selContext(sel) {
  const n = curNote(), pg = n.pages[sel.pi];
  const texts = (sel.texts || []).map(id => pg.texts.find(t => t.id === id)).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x).map(t => t.text);
  const tasks = (sel.tasks || []).map(id => pg.tasks.find(t => t.id === id)).filter(t => t && t.text).map(t => '- ' + t.text);
  const strokes = pg.strokes.filter(s => sel.ids.includes(s.id));
  const labels = (pg.labels || []).filter(l => l.strokeIds.length && l.strokeIds.every(id => sel.ids.includes(id))).map(l => l.text);
  const parts = [strokes.length && 'handwriting', texts.length && plural2(texts.length, 'text box'), tasks.length && plural2(tasks.length, 'task')].filter(Boolean);
  return { kind: 'sel', noteId: n.id, pi: sel.pi, bb: sel.bb.slice(), ids: sel.ids.slice(), typed: [...texts, ...tasks].join('\n'), strokes: JSON.parse(JSON.stringify(strokes)),
    inkText: labels.length && labels.join(' ').length > 2 ? labels.join('\n') : '', what: parts.join(' · ') || 'selection', key: 'sel:' + sel.ids.join(',') };
}
function cardContext(pi, id) {
  const t = findCard(pi, id); if (!t) return null;
  const q = t.q, lines = [];
  if (t.text) lines.push(t.text);
  for (const it of t.items || []) if (it.text) lines.push((it.done ? '[x] ' : '- ') + it.text);
  let from = '', fromAddr = '', subject = '';
  if (q) { from = q.contact || q.customer || ''; fromAddr = q.email || ''; subject = q.subject || (q.rfq ? 'RFQ ' + q.rfq : '');
    lines.push(...[q.customer && 'Customer: ' + q.customer, q.contact && 'Contact: ' + q.contact + (q.email ? ' <' + q.email + '>' : ''), q.rfq && 'RFQ #: ' + q.rfq, q.subject && 'Subject: ' + q.subject,
      (q.items || []).length && 'Items:\n' + q.items.map(i => `- ${i.qty ? i.qty + (i.unit ? ' ' + i.unit : '') + ' × ' : ''}${i.desc}`).join('\n'), (q.specs || []).length && 'Specs: ' + q.specs.join('; '),
      q.due && 'Quote due: ' + new Date(q.due).toString(), (q.delivery || q.deliveryText) && 'Delivery: ' + (q.delivery ? new Date(q.delivery).toDateString() : q.deliveryText),
      q.value != null && q.value !== '' && 'Our quote value: ' + money(q.value), q.notes && 'Notes: ' + q.notes, q.body && 'Email excerpt: ' + q.body,
      ...(q.followups || []).map(f => `Follow-up from ${f.from || ''} ${f.date ? new Date(f.date).toDateString() : ''}: ${f.snippet || f.subject || ''}`)].filter(Boolean)); }
  else if (t.due) lines.push('Due: ' + new Date(t.due).toString());
  const ink = [...(t.tstrokes || []), ...(t.strokes || [])];
  return { kind: 'card', pi, cardId: id, typed: lines.join('\n'), strokes: JSON.parse(JSON.stringify(t.tstrokes || [])), strokes2: JSON.parse(JSON.stringify(t.strokes || [])), inkText: '', what: q ? 'quote · ' + (from || subject || 'card') : 'card' + (ink.length ? ' · handwriting' : ''),
    from, fromAddr, subject, isQuote: !!q, key: 'card:' + id + ':' + ink.length + ':' + (t.text || '') };
}
/* anchor rect (viewport px) for the popover */
function ctxRect(c) {
  if (c.rect) return c.rect;
  if (c.kind === 'sel') { const rec = pageEls[c.pi]; if (!rec) return null; const r = rec.el.getBoundingClientRect(), s = S.scale; return { left: r.left + c.bb[0] * s, top: r.top + c.bb[1] * s, right: r.left + c.bb[2] * s, bottom: r.top + c.bb[3] * s }; }
  const w = cardWrap(c.pi, c.cardId); return w ? w.getBoundingClientRect() : null;
}
function placePop() {
  if (pop.hidden || !GK.ctx) return;
  const r = ctxRect(GK.ctx) || { left: innerWidth / 2 - 10, right: innerWidth / 2 + 10, top: 120, bottom: 140 };
  const W = Math.min(440, innerWidth - 24); pop.style.width = W + 'px';
  const H = pop.offsetHeight, gap = 14, top0 = 64;
  let x = Math.max(12, Math.min(innerWidth - W - 12, r.left)), y, side = 'below';
  if (r.bottom + gap + H <= innerHeight - 12) y = r.bottom + gap;
  else if (r.top - gap - H >= top0) { y = r.top - gap - H; side = 'above'; }
  else if (innerWidth - r.right > W + 24) { x = r.right + gap; y = Math.max(top0, Math.min(innerHeight - H - 12, r.top)); side = 'right'; }
  else if (r.left > W + 24) { x = r.left - gap - W; y = Math.max(top0, Math.min(innerHeight - H - 12, r.top)); side = 'left'; }
  else y = Math.max(top0, innerHeight - H - 12);
  pop.style.left = x + 'px'; pop.style.top = y + 'px'; pop.dataset.side = side;
  pop.style.setProperty('--ax', Math.max(18, Math.min(W - 18, (r.left + r.right) / 2 - x)) + 'px');
}
const engChip = (e, note) => `<span class="gk-eng ${e === 'Built-in' ? '' : 'ai'}">${e === 'Built-in' ? '⚙︎ Built-in' : '✨ ' + esc(e)}</span>${note ? `<span class="gk-note">${esc(note)}</span>` : ''}`;
function gkHead(title, back) { return `<header class="gk-head">${back ? '<button class="gk-ib" data-gk="back" aria-label="Back">‹</button>' : '<span class="gk-spark">✨</span>'}<b>${title}</b><small>${esc(GK.ctx.what)}</small><button class="gk-ib" data-gk="close" aria-label="Close">✕</button></header>`; }
function drawPop() {
  const c = GK.ctx; if (!c) return;
  if (GK.view === 'menu') {
    const hasInk = c.strokes.length || (c.strokes2 || []).length, ai = aiReady();
    pop.innerHTML = `${gkHead('Ask Grok')}
      <div class="gk-acts">${GK_ACTS.filter(a => !(a.ink && !hasInk)).map(a => `<button class="gk-act" data-act="${a.id}"><i>${a.ic}</i><span>${a.l}</span></button>`).join('')}
        <button class="gk-act" data-act="card"><i>💡</i><span>Add to Idea Board</span></button></div>
      <form class="gk-ask" data-gk="ask"><input id="gkQ" placeholder="Ask about this…" autocomplete="off" enterkeyhint="send"><button class="btn primary" type="submit">Ask</button></form>
      ${ai ? '' : `<p class="gk-foot">⚙︎ Built-in mode — <button class="gk-link" data-gk="connect">connect Grok</button> to read handwriting and get smarter answers.</p>`}`;
  } else if (GK.view === 'busy') {
    pop.innerHTML = `${gkHead(esc(GK.busyTitle || 'Working…'), true)}<div class="gk-busy"><span class="gk-dots"><i></i><i></i><i></i></span>${esc(GK.busyMsg || '')}</div>`;
  } else if (GK.view === 'result') {
    const r = GK.res, sel = c.kind === 'sel';
    let body = '';
    if (r.tasks) body = `<ul class="gk-tasks">${r.tasks.map((t, i) => `<li><label><input type="checkbox" data-ti="${i}" checked><span contenteditable="true" data-tt="${i}">${esc(t.text)}</span></label>${t.due ? `<em>⏰ ${esc(fmtDue(t.due))}</em>` : ''}</li>`).join('')}</ul>`;
    else body = `<textarea id="gkText" rows="${Math.min(11, Math.max(3, String(r.text).split('\n').reduce((k, l) => k + Math.max(1, Math.ceil(l.length / 46)), 0) + 1))}" spellcheck="true">${esc(r.text)}</textarea>`;
    const tones = r.kind === 'reply' ? `<div class="gk-tones">${Object.entries(TONES).map(([k, t]) => `<button class="gk-chip ${r.tone === k ? 'on' : ''}" data-tone="${k}">${t.label}</button>`).join('')}</div>` : '';
    const btns = r.tasks
      ? [`<button class="btn primary" data-gk="cards">💡 Add ${r.tasks.length} to Idea Board</button>`, sel ? '<button class="btn" data-gk="instasks">☑️ Insert as tasks</button>' : '<button class="btn" data-gk="checklist">☑︎ Add as checklist</button>', '<button class="btn" data-gk="copy">⧉ Copy</button>']
      : [sel ? `<button class="btn primary" data-gk="insert">⤓ Insert</button>` : '', r.kind === 'read' && sel ? '<button class="btn" data-gk="replace">↺ Replace ink</button>' : '', '<button class="btn" data-gk="copy">⧉ Copy</button>',
         `<button class="btn ${sel ? '' : 'primary'}" data-gk="card">💡 Add as card</button>`, r.kind === 'read' && sel ? '<button class="btn" data-gk="label">🔎 Make searchable</button>' : '',
         r.kind === 'reply' ? `<a class="btn" id="gkMail" href="#">✉︎ Open in Mail</a>` : ''];
    pop.innerHTML = `${gkHead(esc(r.title), true)}${tones}<div class="gk-meta">${engChip(r.engine, r.note)}</div>${body}<div class="gk-btns">${btns.filter(Boolean).join('')}</div>
      ${r.kind === 'reply' ? '<p class="gk-foot">Pencil Notes never sends email — Open in Mail starts a draft you review and send yourself.</p>' : ''}`;
    if (r.kind === 'reply') { const a = pop.querySelector('#gkMail'), ta = pop.querySelector('#gkText'); const upd = () => a.href = `mailto:${c.fromAddr ? encodeURIComponent(c.fromAddr).replace(/%40/g, '@') : ''}?subject=${encodeURIComponent(c.subject ? 'Re: ' + String(c.subject).replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '') : '')}&body=${encodeURIComponent(ta.value)}`; upd(); ta.addEventListener('input', upd);
      a.addEventListener('click', e => { if (window.__mailtoDryRun) { e.preventDefault(); window.__lastMailto = a.href; } }); }
  } else if (GK.view === 'need') {
    pop.innerHTML = `${gkHead('Connect Grok', true)}<p class="gk-msg">${esc(GK.needMsg)}</p><div class="gk-btns"><button class="btn primary" data-gk="connect">✨ Connect Grok…</button><button class="btn" data-gk="back">Back</button></div>
      <p class="gk-foot">Uses your own xAI key, stored only on this iPad.</p>`;
  }
  placePop();
}
function openGrok(ctx) {
  if (!ctx) return; GK.ctx = ctx; GK.view = 'menu'; GK.res = null;
  if (ctx.kind === 'sel') $('#lassoMenu').hidden = true;
  pop.hidden = false; drawPop(); setTimeout(() => placePop(), 0);
}
function closeGrok({ keepSel = true } = {}) {
  if (pop.hidden) return; pop.hidden = true; const c = GK.ctx; GK.ctx = null; GK.busy = false;
  if (c && c.kind === 'sel' && keepSel && selection) { $('#lassoMenu').hidden = false; positionLassoMenu(); }
}
function busy(title, msg) { GK.view = 'busy'; GK.busyTitle = title; GK.busyMsg = msg; drawPop(); }
const NEED_AI = 'NEED_AI';
async function transcribe(strokes) { const bb = inkBB(strokes); return (await aiTranscribe(inkToPNG(strokes, bb))).trim().replace(/^\[unreadable\]$/i, ''); }
async function ctxText(c, { needInk = false } = {}) {
  const ink = [c.strokes, c.strokes2 || []].filter(s => s && s.length);
  if (ink.length && !c.inkText) {
    const hit = GK.cache.get(c.key); if (hit) c.inkText = hit;
    else if (aiReady()) { busy('Reading handwriting', `${aiModel()} is reading your handwriting…`); const parts = []; for (const s of ink) parts.push(await transcribe(s)); c.inkText = parts.filter(Boolean).join('\n'); if (c.inkText) GK.cache.set(c.key, c.inkText); }
    else if (needInk || !c.typed.trim()) throw Object.assign(new Error(NEED_AI), { need: 'Reading handwriting needs Grok. Connect your xAI key once and Ask Grok can read, summarize and rewrite your ink.' });
  }
  return [c.inkText, c.typed].filter(s => s && s.trim()).join('\n').trim();
}
const today = () => new Date().toString();
const bulletsOf = txt => String(txt || '').split('\n').map(l => l.replace(/^\s*(?:[-*•☐▢]|\[[ x]\]|\d+[.)])\s*/, '').trim()).filter(l => l.length > 1);
function tidy(t) { return String(t).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).map(l => l.replace(/^[-*•]\s*/, '• ').replace(/^(• )?([a-z])/, (m, b, ch) => (b || '') + ch.toUpperCase()).replace(/\bi\b/g, 'I')).join('\n'); }
function pseudoCard(c, text) {
  const r = applyPrefsToResult(AssistEngine.extract({ from: c.from || 'Me', subject: c.subject || '', date: new Date(), text, prefs: memPrefs() }));
  return { from: c.from || '', fromAddr: c.fromAddr || '', subject: c.subject || '', raw: text, ...resultToCard(r) };
}
async function runAct(act, extra = {}) {
  const c = GK.ctx; if (!c || GK.busy) return; GK.busy = true;
  const ai = aiReady(), M = aiModel(), sys = (task, rules) => ({ role: 'system', content: `TASK: ${task}\n${rules}${prefsBlock()}` });
  try {
    const text = await ctxText(c, { needInk: act === 'read' }); if (GK.ctx !== c) return;
    if (!text) throw Object.assign(new Error(NEED_AI), { need: 'Nothing readable in this selection yet.' });
    const userMsg = { role: 'user', content: `Today: ${today()}\n${c.isQuote ? 'Customer quote request (RFQ) details:' : 'Notes:'}\n${text.slice(0, 12000)}` };
    let res = null;
    if (act === 'read') res = { kind: 'read', title: '🔤 Converted to text', text: c.inkText || text, engine: c.inkText ? M : 'Built-in' };
    else if (act === 'summarize') {
      busy('Summarizing', ai ? `${M} is summarizing…` : 'Summarizing…');
      if (ai) res = { text: await aiRequest([sys('summarize_note', 'Summarize the text for its owner. Start with one or two plain sentences, then up to 5 short "• " bullet points with the key facts, names, numbers and dates. Plain text, no markdown headings. Never invent facts.'), userMsg], { json: false }), engine: M };
      else { const p = pseudoCard(c, text); res = { text: [p.summary, ...(p.points || []).map(x => '• ' + x)].filter(Boolean).join('\n') || text.slice(0, 400), engine: 'Built-in' }; }
      Object.assign(res, { kind: 'summary', title: '📝 Summary' });
    } else if (act === 'tasks') {
      busy('Making tasks', ai ? `${M} is pulling out the to-dos…` : 'Finding the to-dos…');
      let tasks = [];
      if (ai) { const o = await aiJSON([sys('tasks', 'Turn the text into a short list of concrete to-dos for its owner. Return ONLY JSON: {"tasks":[{"text": string (imperative, max 12 words), "due": string|null (ISO 8601 local "YYYY-MM-DDTHH:mm", resolve relative dates against Today; 17:00 for date-only)}]}. At most 10 tasks. Never invent tasks.'), userMsg]);
        tasks = (o.tasks || []).filter(t => t && t.text).map(t => ({ text: String(t.text).trim(), due: t.due && !isNaN(new Date(t.due)) ? new Date(t.due).toISOString() : null })); }
      else { const p = pseudoCard(c, text); tasks = (p.actions || []).map(a => ({ text: a.text, due: a.due || null })); if (!tasks.length) tasks = bulletsOf(text).slice(0, 10).map(l => ({ text: l, due: null })); }
      if (!tasks.length) tasks = [{ text: text.split('\n')[0].slice(0, 80), due: null }];
      res = { kind: 'tasks', title: '☑️ Tasks', tasks: tasks.slice(0, 12), engine: ai ? M : 'Built-in' };
    } else if (act === 'reply') {
      const tone = extra.tone || 'friendly'; busy('Drafting a reply', ai ? `${M} is drafting a ${TONES[tone].label.replace(/^\S+\s/, '').toLowerCase()} reply…` : 'Drafting…');
      const me = memPrefs().me;
      if (ai) { try { res = { text: (await aiRequest([sys('reply', `Write a reply to the message below on behalf of its reader${c.isQuote ? ' (we are the supplier answering a customer\'s request for quote)' : ''}. Tone: ${TONES[tone].d}. Plain text only: greeting, body, sign-off${me ? ` signed "${me}"` : ' (no name)'}. Don't invent prices, dates or commitments. Under 150 words. Return only the reply body.`), userMsg], { json: false })).replace(/^subject:.*\n+/i, '').trim(), engine: M }; }
        catch (e) { res = { text: builtinReply(pseudoCard(c, text), tone), engine: 'Built-in', note: `${M} unavailable — template used` }; } }
      else res = { text: builtinReply(pseudoCard(c, text), tone), engine: 'Built-in' };
      Object.assign(res, { kind: 'reply', title: '✉️ Reply' + (c.from ? ' to ' + c.from : ''), tone });
    } else if (act === 'rewrite') {
      busy('Cleaning up', ai ? `${M} is rewriting…` : 'Tidying…');
      res = ai ? { text: await aiRequest([sys('rewrite', 'Rewrite the text as clean, well-organized notes: fix spelling and grammar, expand obvious shorthand, keep every fact and number, keep lists as "• " bullets. Plain text only. Return only the rewritten text.'), userMsg], { json: false }), engine: M }
        : { text: tidy(text), engine: 'Built-in', note: 'spacing & capitals only — connect Grok for a real rewrite' };
      Object.assign(res, { kind: 'rewrite', title: '✨ Cleaned up' });
    } else if (act === 'ask') {
      const q = String(extra.q || '').trim(); if (!q) { GK.busy = false; return; }
      busy('Asking', ai ? `${M} is thinking…` : 'Looking…');
      res = ai ? { text: await aiRequest([sys('ask', 'Answer the question using the text below. Be brief: at most 4 sentences or a short list. Plain text. If the text does not say, say so plainly.'), { role: 'user', content: userMsg.content + '\n\nQuestion: ' + q }], { json: false }), engine: M }
        : { text: builtinAnswer(pseudoCard(c, text), q), engine: 'Built-in' };
      Object.assign(res, { kind: 'ask', title: '💬 ' + (q.length > 34 ? q.slice(0, 32) + '…' : q), q });
    }
    if (GK.ctx !== c) return;
    res.text = res.text != null ? String(res.text).trim() : res.text; GK.res = res; GK.view = 'result'; GK.busy = false; drawPop();
  } catch (e) {
    GK.busy = false; if (GK.ctx !== c) return;
    if (e.message === NEED_AI) { GK.view = 'need'; GK.needMsg = e.need; drawPop(); return; }
    GK.view = 'menu'; drawPop(); toast('✨ ' + (typeof visionMsg === 'function' && act === 'read' ? visionMsg(e) : 'Grok couldn’t do that (' + (e.name === 'AbortError' ? 'timed out' : e.message) + ')'), 4000);
  }
}
/* result actions */
function resultText() { const ta = pop.querySelector('#gkText'); return ta ? ta.value.trim() : GK.res && GK.res.text || ''; }
function resultTasks() { return (GK.res.tasks || []).map((t, i) => ({ ...t, text: (pop.querySelector(`[data-tt="${i}"]`) || {}).textContent || t.text, on: (pop.querySelector(`[data-ti="${i}"]`) || {}).checked !== false })).filter(t => t.on && t.text.trim()); }
function addIdeaCards(list) {
  const n = ensureIdeaNote(); if (ibSealed()) { toast('🔒 Unlock the Idea Board first'); return []; }
  const pg = n.pages[0], col = boardCols(pg)[0]; bH(IPI);
  const out = list.map(x => { const t = { id: uid('t'), kind: 'card', col: col.id, ord: -1, text: String(x.title || '').slice(0, 140), strokes: [], done: false, due: x.due || null, repeat: '', notified: false, createdAt: Date.now(), typed: true,
    ...(x.items && x.items.length ? { items: x.items.slice(0, 20).map(s => ({ id: uid('i'), done: false, strokes: [], text: s, typed: true })) } : {}) }; pg.tasks.push(t); return t; });
  renumber(pg, col.id); saveNote(n, true); renderPanel(); renderSidebar();
  qbOpen(true, { quiet: true, mode: 'ideas' }); if (out[0]) setTimeout(() => out.forEach(t => boardFlash(IPI, t.id)), 80);
  return out;
}
function grokInsertText(c, text) {
  const n = S.notes.find(x => x.id === c.noteId); if (!n || n.id !== S.cur) return toast('Open the note first');
  const pg = n.pages[c.pi]; if (!pg) return; pushHistory();
  const x = Math.max(20, Math.min(c.bb[0] + 8, PAGE_W - 360)), y = Math.min(PAGE_H - 60, c.bb[3] + 14);
  const tb = { id: uid('x'), x, y, text, size: 22, color: INK }; pg.texts.push(tb); saveNote(n, true); renderOverlay(c.pi); renderSidebar(); return tb;
}
pop.addEventListener('submit', e => { e.preventDefault(); const v = pop.querySelector('#gkQ').value; if (v.trim()) runAct('ask', { q: v }); });
pop.addEventListener('pointerdown', e => e.stopPropagation());
pop.addEventListener('click', async e => {
  const c = GK.ctx; if (!c) return;
  const act = e.target.closest('[data-act]'); if (act) {
    if (act.dataset.act === 'card') { const text = await ctxText(c).catch(() => ''); const lines = bulletsOf(text); if (c.kind === 'sel' && c.ids.length && typeof cardFromInk === 'function' && !text) { const n = ensureIdeaNote(); closeGrok({ keepSel: false }); cardFromInk({ note: curNote(), pi: c.pi, ids: c.ids }, n, IPI, boardCols(n.pages[0])[0].id); qbOpen(true, { quiet: true, mode: 'ideas' }); return; }
      if (c.kind === 'sel' && c.ids.length && !c.typed && typeof cardFromInk === 'function') { const n = ensureIdeaNote(); closeGrok({ keepSel: false }); const t = cardFromInk({ note: curNote(), pi: c.pi, ids: c.ids }, n, IPI, boardCols(n.pages[0])[0].id); qbOpen(true, { quiet: true, mode: 'ideas' }); if (t) boardFlash(IPI, t.id); return; }
      addIdeaCards([{ title: lines[0] || text.slice(0, 80) || 'Idea', items: lines.slice(1) }]); closeGrok({ keepSel: false }); if (c.kind === 'sel') hideLasso(); toast('💡 Added to the Idea Board', 1600); return; }
    runAct(act.dataset.act); return; }
  const tone = e.target.closest('[data-tone]'); if (tone) { runAct('reply', { tone: tone.dataset.tone }); return; }
  const b = e.target.closest('[data-gk]'); if (!b) return; const k = b.dataset.gk;
  if (k === 'close') return closeGrok();
  if (k === 'back') { GK.view = 'menu'; GK.busy = false; drawPop(); return; }
  if (k === 'connect') { closeGrok(); aiSettings(); return; }
  if (k === 'copy') { const v = GK.res.tasks ? resultTasks().map(t => '☐ ' + t.text).join('\n') : resultText(); try { await navigator.clipboard.writeText(v); } catch (_) {} window.__lastCopied = v; toast('⧉ Copied', 1200); return; }
  if (k === 'insert') { const v = resultText(); if (!v) return; grokInsertText(c, v); closeGrok({ keepSel: false }); hideLasso(); toast('⤓ Inserted below your selection', 1600); return; }
  if (k === 'replace') { const v = resultText(); const n = curNote(), pg = n && n.pages[c.pi]; if (!v || !pg || n.id !== c.noteId) return; pushHistory();
    pg.strokes = pg.strokes.filter(s => !c.ids.includes(s.id)); pg.labels = (pg.labels || []).filter(l => !l.strokeIds.every(id => c.ids.includes(id)));
    pg.texts.push({ id: uid('x'), x: Math.max(4, c.bb[0] + 8), y: Math.max(4, c.bb[1] + 4), text: v, size: 24, color: INK }); saveNote(n, true); closeGrok({ keepSel: false }); hideLasso(); renderPageInk(c.pi); renderOverlay(c.pi); renderSidebar(); toast('↺ Handwriting replaced with text · Undo with ↶', 2400); return; }
  if (k === 'label') { const v = resultText(); const n = curNote(), p = n.pages[c.pi]; if (!v) return; pushHistory(); const bb = inkBB(c.strokes); (p.labels ||= []).push({ id: uid('l'), strokeIds: c.ids, x: bb[0], y: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1], text: v, by: GK.res.engine }); saveNote(n, true); closeGrok({ keepSel: false }); hideLasso(); renderOverlay(c.pi); renderSidebar(); toast('🔎 Searchable now', 1600); return; }
  if (k === 'card') { const v = resultText(); const lines = v.split('\n').map(s => s.trim()).filter(Boolean); const title = GK.res.kind === 'ask' ? GK.res.q : GK.res.kind === 'reply' ? 'Reply' + (c.from ? ' to ' + c.from : '') : (lines[0] || '').replace(/^•\s*/, '');
    const items = GK.res.kind === 'ask' || GK.res.kind === 'reply' ? [v.slice(0, 600)] : lines.slice(1).map(s => s.replace(/^•\s*/, ''));
    addIdeaCards([{ title, items }]); closeGrok({ keepSel: false }); if (c.kind === 'sel') hideLasso(); toast('💡 Added to the Idea Board', 1600); return; }
  if (k === 'cards') { const ts = resultTasks(); if (!ts.length) return; addIdeaCards(ts.map(t => ({ title: t.text, due: t.due }))); closeGrok({ keepSel: false }); if (c.kind === 'sel') hideLasso(); toast(`💡 ${ts.length} card${ts.length > 1 ? 's' : ''} on the Idea Board`, 1800); return; }
  if (k === 'instasks') { const ts = resultTasks(); const n = curNote(), pg = n && n.pages[c.pi]; if (!ts.length || !pg) return; pushHistory(); let y = Math.min(PAGE_H - 60, c.bb[3] + 16);
    for (const t of ts) { pg.tasks.push({ id: uid('t'), kind: 'typed', x: Math.max(20, c.bb[0] + 8), y, text: t.text, color: INK, done: false, due: t.due, repeat: '', notified: false, createdAt: Date.now() }); y = Math.min(PAGE_H - 40, y + 44); }
    saveNote(n, true); closeGrok({ keepSel: false }); hideLasso(); renderOverlay(c.pi); renderPanel(); renderSidebar(); toast(`☑️ ${ts.length} task${ts.length > 1 ? 's' : ''} added`, 1600); return; }
  if (k === 'checklist') { const ts = resultTasks(); const t = findCard(c.pi, c.cardId); if (!t || !ts.length) return; bH(c.pi); (t.items ||= []).push(...ts.map(x => ({ id: uid('i'), done: false, strokes: [], text: x.text, typed: true }))); saveNote(bN(c.pi), true); afterChange(c.pi); closeGrok(); toast('☑︎ Checklist updated', 1400); return; }
});
document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.modal-wrap, #actionWrap, #lassoMenu, .gk-hl')) closeGrok(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) closeGrok(); });
$('#pages').addEventListener('scroll', () => placePop(), { passive: true });
window.addEventListener('resize', () => placePop());

/* card entry points: ⋯ menu on every board card, and a ✨ chip on Quote Board cards */
{ const _cme = cardMenuExtra; cardMenuExtra = function (pi, id) { return [{ label: '✨ Ask Grok…', sub: 'Summarize, make tasks, draft a reply, ask a question', fn: () => openGrok(cardContext(pi, id)) }, ..._cme(pi, id)]; }; }
{ const _ce = cardExtra; cardExtra = function (t, pg) { const h = _ce(t, pg); return h ? h.replace('<div class="qd-acts">', '<div class="qd-acts"><button class="qb-mini gk-mini" data-qact="grok">✨ Ask Grok</button>') : h; }; }
QD.addEventListener('click', e => { const a = e.target.closest('[data-qact="grok"]'); if (!a) return; e.preventDefault(); e.stopPropagation(); const w = a.closest('.bcard-wrap'); if (w) openGrok(cardContext(bPi(w), w.dataset.id)); }, true);

/* typed-text highlight → a small ✨ chip */
const hlChip = (() => { const b = document.createElement('button'); b.className = 'gk-hl'; b.hidden = true; b.innerHTML = '✨ Ask Grok'; document.body.append(b); return b; })();
let hlCtx = null;
document.addEventListener('selectionchange', () => {
  const s = document.getSelection(); const el = s && s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
  const tb = el && el.closest && el.closest('#pages .textblock');
  if (!tb || s.isCollapsed || !String(s).trim()) { hlChip.hidden = true; hlCtx = null; return; }
  const r = s.getRangeAt(0).getBoundingClientRect(), page = tb.closest('.page'), pi = page ? +page.dataset.pi : 0, n = curNote(), pg = n.pages[pi], t = pg && pg.texts.find(x => x.id === tb.dataset.id);
  const s2 = S.scale, pr = page.getBoundingClientRect();
  hlCtx = { kind: 'sel', noteId: n.id, pi, bb: [(r.left - pr.left) / s2, (r.top - pr.top) / s2, (r.right - pr.left) / s2, (tb.getBoundingClientRect().bottom - pr.top) / s2], ids: [], typed: String(s).trim(), strokes: [], inkText: '', what: 'highlighted text', key: 'hl', rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, textId: t && t.id };
  hlChip.hidden = false; hlChip.style.left = Math.max(8, Math.min(innerWidth - 130, r.left)) + 'px'; hlChip.style.top = Math.max(60, r.top - 48) + 'px';
});
hlChip.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
hlChip.addEventListener('click', () => { const c = hlCtx; hlChip.hidden = true; if (c) openGrok(c); });

/* ======================= 3. lasso menu: ✨ Ask Grok · ☑️ Task · 📤 Send to… · ✂️ ⧉ 📋 🗑 · ⋯ More ======================= */
{ const m = $('#lassoMenu'), g = document.createElement('button'), send = document.createElement('button'), more = document.createElement('button');
  g.id = 'lassoGrok'; g.className = 'grok'; g.innerHTML = '✨ Ask Grok'; g.title = 'Summarize, convert to text, make tasks, draft a reply, clean up or ask';
  send.id = 'lassoSend'; send.innerHTML = '📤 Send to…'; send.title = 'Idea Board, Quote Board, planner or Inbox';
  more.id = 'lassoMore'; more.innerHTML = '⋯'; more.setAttribute('aria-label', 'More: duplicate, label, section number');
  m.prepend(g); $('#lassoTask').after(send); $('#lassoCancel').before(more);
  $('#lassoTask').classList.remove('primary'); $('#lassoTask').innerHTML = '☑️ Task';
  const icon = (id, ic, label) => { const b = $(id); if (b) { b.innerHTML = ic; b.setAttribute('aria-label', label); b.title = label; b.classList.add('ic'); } };
  icon('#lassoCut', '✂️', 'Cut'); icon('#lassoCopy', '⧉', 'Copy'); icon('#lassoPaste', '📋', 'Paste'); icon('#lassoDelete', '🗑', 'Delete');
  for (const id of ['lassoPlanner', 'lassoBoard', 'lassoQuote', 'lassoAssist', 'lassoRead', 'lassoLabel', 'lassoSection', 'lassoDup']) { const b = document.getElementById(id); if (b) b.classList.add('v21-moved'); }
  g.onclick = () => { if (!selection) return; openGrok(selContext(selection)); };
  send.onclick = async () => {
    const s = selection; if (!s) return; if (!s.ids.length) { toast('Select some handwriting first'); return; } m.hidden = true;
    const legacy = legacyBoardPages().length;
    const ch = await pickSheet('Send handwriting to…', [
      { label: '💡 Idea Board', sub: 'A new card — pick the column', value: 'ideas' },
      { label: '💲 Quote Board', sub: 'A new handwritten quote card in New RFQ', value: 'quotes' },
      { label: '📅 Planner', sub: 'Drop it into a time slot', value: 'planner' },
      { label: '📥 Inbox', sub: 'A note card with the handwriting attached — summarize & prioritize it there', value: 'inbox' },
      ...(legacy ? [{ label: '📋 A Project Board page', sub: `${legacy} older board page${legacy > 1 ? 's' : ''} in your notes`, value: 'page' }] : [])]);
    if (!ch) { if (selection) { m.hidden = false; positionLassoMenu(); } return; }
    if (ch === 'quotes') return $('#lassoQuote').click();
    if (ch === 'planner') return $('#lassoPlanner').click();
    if (ch === 'inbox') return lassoToAssistant();
    if (ch === 'page') return $('#lassoBoard').click();
    const n = ensureIdeaNote(); if (ibSealed()) return toast('🔒 Unlock the Idea Board first');
    const cols = boardCols(n.pages[0]);
    const col = cols.length > 1 ? await pickSheet('Which column?', cols.map(c => ({ label: c.title, sub: colCards(n.pages[0], c.id).length + ' cards', value: c.id }))) : cols[0].id;
    if (!col) { if (selection) { m.hidden = false; positionLassoMenu(); } return; }
    const t = cardFromInk({ note: curNote(), pi: s.pi, ids: s.ids.slice() }, n, IPI, col); if (t) { qbOpen(true, { quiet: true, mode: 'ideas' }); boardFlash(IPI, t.id); }
  };
  more.onclick = () => { if (!selection) return; m.hidden = true;
    const back = () => { if (selection) { m.hidden = false; positionLassoMenu(); } };
    actionSheet('Selection', [{ label: '⎘ Duplicate', fn: () => { $('#lassoDup').click(); } }, { label: '🏷 Label (make it searchable by name)', fn: () => $('#lassoLabel').click() }, { label: '1. Make section number', fn: () => $('#lassoSection').click() }, { label: '✕ Deselect', fn: hideLasso }]);
    const w = $('#actionWrap'), obs = new MutationObserver(() => { if (w.hidden) { obs.disconnect(); setTimeout(back, 0); } }); obs.observe(w, { attributes: true, attributeFilter: ['hidden'] }); };
}

/* ======================= 4. top bar + one grouped ⋯ menu ======================= */
{ const tb = $('#topbar'), nm = $('#noteMenuBtn');
  ['#undoBtn', '#redoBtn', '#recBtn', '#focusBtn', '#quotesBtn', '#togglePanel', '#lockBtn'].forEach(s => { const b = $(s); if (b) tb.append(b); });
  tb.append(nm);
  $('#todayBtn').classList.add('v21-moved');
  $('#undoBtn').classList.add('tb-gap');
  nm.title = 'More: page, note, go to'; nm.setAttribute('aria-label', 'More');
  ['exportBtn', 'importBtn'].forEach(id => document.getElementById(id).classList.add('v21-moved'));     // in ⚙︎ Settings → Storage & backup
}
const MM = (() => { const d = document.createElement('div'); d.id = 'moreMenu'; d.hidden = true; d.setAttribute('role', 'menu'); document.body.append(d); return d; })();
function moreItems() {
  const n = curNote(), hasPlanner = n.pages.some(p => p.bg && p.bg.name === 'planner'), locked = typeof isLockedOpen === 'function' && isLockedOpen(n);
  return [
    { h: 'Page', rows: [
      { id: 'paper', seg: [['lined', 'Lined'], ['grid', 'Grid'], ['blank', 'Blank']], cur: n.paper || 'lined' },
      { ic: '＋', l: 'Add page…', s: 'Lined, grid, meeting, planner, recording', fn: () => addPage() },
      ...(hasPlanner ? [{ ic: '🗓', l: 'This planner page…', s: 'Times & slots for the open page — defaults live in ⚙︎ Settings', fn: plannerSettings }] : [])] },
    { h: 'Note', rows: [
      { ic: locked ? '🔓' : '🔒', l: locked ? 'Unlocked — lock again…' : 'Lock note…', s: 'Pencil Lock with your secret shape', fn: () => lockMenu() },
      { ic: '⬇︎', l: 'Export as PDF', fn: () => exportNotePdf(n) },
      ...(clip ? [{ ic: '📋', l: 'Paste', fn: pasteClip }] : []),
      { ic: '✏️', l: 'Rename, move or delete…', fn: () => noteMenu(n) }] },
    { h: 'Go to', rows: [
      { ic: '☀️', l: 'Today', s: 'Everything due today, from every note', fn: () => openToday() },
      { ic: '💡', l: 'Idea Board', fn: () => qbOpen(true, { mode: 'ideas' }) },
      { ic: '💲', l: 'Quote Board', fn: () => qbOpen(true, { mode: 'quotes' }) },
      { ic: '📥', l: 'Inbox', s: 'Emails & meeting briefs', fn: () => qbOpen(true, { mode: 'inbox' }) },
      { ic: '📁', l: 'Archive', s: 'Recordings filed after you stop', fn: () => { if (window.V21d) { V21d.ensureArchiveNb(); S.collapsed.delete(V21d.ARCHIVE_ID); localStorage.setItem('collapsed', JSON.stringify([...S.collapsed])); renderSidebar(); setSidebar(true); const first = notesIn(V21d.ARCHIVE_ID)[0]; if (first) openNote(first.id); else toast('Archive is empty — stop a meeting to file one'); } } }] },
  ];
}
function openMore() {
  const secs = moreItems(), flat = [];
  MM.innerHTML = secs.map(sec => `<section>${sec.h ? `<h5>${sec.h}</h5>` : ''}${sec.rows.map(r => { if (r.seg) return `<div class="mm-seg" role="group" aria-label="Paper">${r.seg.map(([k, l]) => `<button data-paper="${k}" class="${r.cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    flat.push(r); return `<button class="mm-row" role="menuitem" data-mi="${flat.length - 1}"><i>${r.ic}</i><span>${esc(r.l)}${r.s ? `<small>${esc(r.s)}</small>` : ''}</span></button>`; }).join('')}</section>`).join('');
  MM.hidden = false; const b = $('#noteMenuBtn').getBoundingClientRect(), w = MM.offsetWidth;
  MM.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.right - w)) + 'px'; MM.style.top = (b.bottom + 6) + 'px';
  MM.onclick = e => { const p = e.target.closest('[data-paper]'); if (p) { const n = curNote(); n.paper = p.dataset.paper; saveNote(n); for (let i = 0; i < pageEls.length; i++) renderPageInk(i); MM.querySelectorAll('[data-paper]').forEach(x => x.classList.toggle('on', x === p)); return; }
    const r = e.target.closest('[data-mi]'); if (!r) return; MM.hidden = true; flat[+r.dataset.mi].fn(); };
}
$('#noteMenuBtn').onclick = e => { e.stopPropagation(); const n = curNote(); if (isSealed(n)) return actionSheet('🔒 Locked note', [{ label: '🔢 Unlock with PIN…', primary: true, fn: () => pinUnlockFlow(n) }, { label: 'Move / delete…', fn: () => noteMenu(n) }]); MM.hidden ? openMore() : (MM.hidden = true); };
document.addEventListener('pointerdown', e => { if (!MM.hidden && !MM.contains(e.target) && !e.target.closest('#noteMenuBtn')) MM.hidden = true; }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') MM.hidden = true; });

/* Settings: handwritten 1. 2. 3. detection moves here; Gestures listed once (Help) */
{ const _ss = settingsSections; settingsSections = function () {
    const secs = _ss(), w = secs.find(s => s.id === 'writing');
    if (w) { w.rows = w.rows.filter(r => !/Gestures/.test(r.label)); const on = localStorage.getItem('autoNumber') !== '0';
      w.rows.push({ label: 'Handwritten 1. 2. 3. → section numbers: ' + (on ? 'On' : 'Off'), sub: 'Turns a handwritten “1.” at the start of a line into a numbered section badge', fn: () => { localStorage.setItem('autoNumber', on ? '0' : '1'); toast(on ? 'Handwritten numbers stay as ink' : 'Handwritten numbers become section badges'); openSettings('writing'); } }); }
    const ai = secs.find(s => s.id === 'ai'); if (ai) { ai.h = 'AI — ✨ Ask Grok'; ai.note = 'Lasso ink or text, then tap ✨ Ask Grok. Works offline in a basic built-in mode; connect your own xAI key for Grok. The key stays on this iPad and is never saved in notes or backups.'; }
    return secs; }; }
/* tour mentions the new doors */
{ const i = TOUR.findIndex(t => t[0] === '#togglePanel'); TOUR.splice(i < 0 ? TOUR.length : i, 0, ['#quotesBtn', '📋 Boards', 'Your 💲 Quote Board, 💡 Idea Board and 📥 Inbox slide out from the right — switch with the dropdown at the top.'], ['#toolbar [data-tool="lasso"]', '✨ Ask Grok', 'Lasso handwriting or text, then tap ✨ Ask Grok to summarize, convert to text, make tasks or draft a reply.']); }
GESTURES[1][0] = 'Lists, boards & reminders';
GESTURES[3][1] = GESTURES[3][1].map(r => r[1] === 'Note options' || r[1] === 'More' ? ['⋯', 'More', 'paper, pages, lock, PDF, Today, boards — Settings is the gear in the sidebar'] : r);
GESTURES[0][1].push(['✨', 'Lasso → Ask Grok', 'summarize · convert to text · make tasks · draft a reply · clean up · ask']);
window.V21 = { openGrok, closeGrok, selContext, cardContext, runAct, GK, legacyBoardPages, importLegacyBoards, openMore, addIdeaCards };
