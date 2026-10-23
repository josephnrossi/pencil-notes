/* Pencil Notes v19 — 💲 Quote Board: a permanent slide-out board for RFQs / quote requests.
   Stored as one hidden system note (id 'quoteboard') with a single board page, rendered by board.js at pi = QPI,
   so cards keep every Project Board feature and Pencil Lock / Export / Import / search / reminders / Today just work.
   Intake: drop or paste an email on the drawer, ＋ Quote, lasso → Send to Quote Board, and email sync (pluggable providers). */
const QB_COLS = ['New RFQ', 'Reviewing', 'Quoting', 'Sent', 'Won', 'Lost'];
const isQuoteNote = n => !!(n && n.id === QUOTE_ID);
function makeQuoteNote() {
  const n = makeNote(S.notebooks[0] ? S.notebooks[0].id : '__quotes', 'Quote Board');
  n.id = QUOTE_ID; n.notebookId = '__quotes'; n.system = 'quotes'; n.order = 0;
  const pg = makeTemplatePage('board', n), cols = QB_COLS.map(title => ({ id: uid('c'), title }));
  pg.board = { title: '💲 Quote Board', quote: true, columns: cols, doneCols: [cols[4].id, cols[5].id] };
  n.pages = [pg]; return n;
}
function ensureQuoteNote() {
  let n = quoteNote(); if (n) return n;
  if (!window.__ready) throw new Error('Quote Board used before notes finished loading');   // never create over a board that is still loading
  n = makeQuoteNote(); S.notes.push(n); saveNote(n, true); return n;
}
const qbSealed = () => { const n = quoteNote(); return !!(n && typeof isSealed === 'function' && isSealed(n)); };
const qbPage = () => { const n = quoteNote(); return n && !qbSealed() ? n.pages[0] : null; };

/* ---------- detection ---------- */
const RFQ_RE = /\bRFQs?\b|\brequest(?:ing)?\s+(?:for|a)\s+(?:a\s+)?(?:quote|quotation)s?\b|\bquote\s+request(?:s|ed)?\b|\bquotations?\b|\bpricing\s+request(?:s)?\b/i;
const isRFQ = (subject, body) => RFQ_RE.test(String(subject || '')) || RFQ_RE.test(String(body || ''));

/* ---------- field extraction (built-in heuristics; Grok refines when the user's AI key is on) ---------- */
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|mail|zoho|comcast|att|verizon)$/i;
function parseAddr(s) {
  s = String(s || '').trim(); const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  const a = s.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/); return { name: a ? '' : s, address: a ? a[0].toLowerCase() : '' };
}
const titleCase = s => s.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
function domainCompany(addr) {
  const d = (addr.split('@')[1] || '').toLowerCase().split('.'); if (d.length < 2) return '';
  const core = d[d.length - 2] === 'co' && d.length > 2 ? d[d.length - 3] : d[d.length - 2];
  return FREE_MAIL.test(core) ? '' : titleCase(core.replace(/(mfg|inc|llc|corp)$/i, m => ' ' + m));
}
const CO_WORDS = /\b(inc\.?|llc|l\.l\.c\.|ltd\.?|limited|corp\.?|corporation|co\.|company|gmbh|s\.a\.|plc|manufacturing|mfg\.?|industries|industrial|technologies|tech|systems|group|aerospace|engineering|fabrication|fab|solutions|machine|machining|metals|electronics|automation|medical|labs?|works)\b/i;
const JOB_TITLE = /\b(manager|buyer|purchasing|procurement|director|engineer|engineering\s+manager|president|owner|founder|vp|vice\s+president|supervisor|coordinator|specialist|agent|analyst|assistant|officer|lead|planner|estimator|sales|account|team|department|dept)\b/i;
const SIG_SKIP = /@|https?:|www\.|\b(?:tel|phone|fax|mobile|cell|direct|office)\b|^\W*(?:re|fw|subject):|\d{3}[\s.)-]+\d{3}[\s.-]\d{4}|:/i;
function sigCompany(text, contactName) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean).slice(-14);
  for (const l of lines.slice().reverse()) {
    if (l.length > 70 || SIG_SKIP.test(l) || l.split(/\s+/).length > 8) continue;
    for (const part of l.split(/\s+[|•·–—]\s+|\s*\|\s*/)) { const c = part.replace(/^[|•\-–—\s]+|[|•\-–—\s]+$/g, ''); if (c && c !== contactName && CO_WORDS.test(c) && !JOB_TITLE.test(c.replace(CO_WORDS, ''))) return c; }
  }
  // "Thanks,\nMike Chen\nChen Custom Cabinetry" — the Title Case line right under the sender's name
  if (contactName) { const i = lines.findIndex(l => l.toLowerCase() === contactName.toLowerCase()); if (i >= 0) for (const l of lines.slice(i + 1, i + 3)) {
    if (SIG_SKIP.test(l) || JOB_TITLE.test(l) || /\d/.test(l)) continue;
    if (/^([A-Z][\w&'.-]*)(\s+(?:&|and|of|the|[A-Z][\w&'.-]*)){1,5}$/.test(l)) return l; } }
  return '';
}
const UNIT = '(?:pcs|pc|pieces?|ea|each|units?|sets?|lots?|kits?|assemblies|assys?|ft|feet|meters?|lbs?|kg|rolls?|boxes|cases|sheets?|parts?)';
const QTY_RES = [new RegExp(`\\b(?:qty|quantity|quan)\\.?\\s*(?:of\\s*)?[:=\\-]?\\s*([\\d][\\d,]*)\\s*(${UNIT})?`, 'i'), new RegExp(`\\b([\\d][\\d,]*)\\s*(${UNIT})\\b`, 'i'), /\(\s*([\d][\d,]*)\s*\)\s*$/, /\b[x×]\s*([\d][\d,]*)\b|\b([\d][\d,]*)\s*[x×]\s+(?=[a-z])/i];
const NOT_ITEM = /\b(due|deadline|respond|reply|by\s+\w+day|phone|tel|fax|cell|mobile|page \d|thanks|regards|lead\s*time|deliver|ship|net\s*\d+|terms)\b|https?:|@/i;
function itemsFrom(text) {
  const lines = String(text).split('\n'), out = [];
  // tables: "Part | Description | Qty" or tab separated
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/\s*\|\s*|\t+/).map(c => c.trim()).filter((c, j, a) => c || (j > 0 && j < a.length - 1));
    if (cells.length < 2) continue;
    const lc = cells.map(c => c.toLowerCase()), qi = lc.findIndex(c => /^(qty|quantity|quan\.?|q'ty)$/.test(c)), dd = lc.findIndex(c => /desc/.test(c)), di = dd >= 0 ? dd : lc.findIndex(c => /item|part|product|name/.test(c)), skipCol = k => /^(#|no\.?|line|item|ln)$/.test(lc[k] || '') && k !== di;
    if (qi < 0) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[\s|:+-]*$/.test(lines[j])) { if (out.length) break; continue; }
      const r = lines[j].split(/\s*\|\s*|\t+/).map(c => c.trim()).filter((c, k, a) => c || (k > 0 && k < a.length - 1)); if (r.length < 2) break;
      const qty = parseInt((r[qi] || '').replace(/,/g, ''), 10); if (!qty) continue;
      const desc = (di >= 0 ? [r[di], ...r.filter((c, k) => k !== di && k !== qi && !skipCol(k) && /[a-z]/i.test(c) && /part|p\/?n|sku|model|rev/i.test(lc[k] || ''))] : r.filter((c, k) => k !== qi && !skipCol(k) && !/^\d+$/.test(c))).filter(Boolean).join(' — ');
      out.push({ desc: desc.slice(0, 160), qty, unit: '' }); i = j;
    }
  }
  if (out.length) return out;
  for (let raw of lines) {
    const l = raw.replace(/^\s*(?:[-*•▪◦·]|\d{1,2}[.)]|\(?[a-z]\))\s+/i, '').trim();
    if (!l || l.length > 200 || NOT_ITEM.test(l) || /^(from|to|cc|subject|date|sent):/i.test(l)) continue;
    let m = null, ri = -1; for (let k = 0; k < QTY_RES.length; k++) { m = l.match(QTY_RES[k]); if (m) { ri = k; break; } }
    if (!m) continue;
    const qty = parseInt(String(m[1] || m[2]).replace(/,/g, ''), 10); if (!qty || qty > 1e7) continue;
    if (/\b(19|20)\d{2}\b/.test(String(qty)) && !m[2]) continue;
    let desc = (l.slice(0, m.index) + ' ' + l.slice(m.index + m[0].length)).replace(/\s*[,;:–—-]\s*$|^\s*[,;:–—-]\s*|\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    desc = desc.replace(/^(of|for|x)\s+/i, '').replace(/\s+(of|for|x)$/i, '').trim();
    if (!/[a-z]{3}/i.test(desc)) continue;
    out.push({ desc: desc.slice(0, 160), qty, unit: (ri < 2 && m[2] ? m[2] : '').toLowerCase() });
    if (out.length >= 12) break;
  }
  if (out.length) return out;
  // in a sentence: "Quote request for 75 laser-cut steel plates per drawing…", "we need 40 units of …"
  const SRE = new RegExp(`\\b(?:for|on|of|need|needs|require|requires|requesting|quote)\\s+([\\d][\\d,]*)\\s+(?:(${UNIT})\\s+(?:of\\s+)?)?((?:[A-Za-z0-9"'°/#-]+\\s*){1,6}?)(?=\\s+(?:per|to|in|with|for|at|from|by|and|that|which)\\b|[.,;:!?\\n]|$)`, 'gi');
  for (const mm of String(text).matchAll(SRE)) {
    const qty = parseInt(mm[1].replace(/,/g, ''), 10), desc = mm[3].trim();
    if (!qty || qty > 1e7 || !/[a-z]{3}/i.test(desc) || /^(days?|weeks?|months?|years?|hours?|am|pm|business)\b/i.test(desc) || NOT_ITEM.test(desc)) continue;
    out.push({ desc: desc.slice(0, 160), qty, unit: (mm[2] || '').toLowerCase() }); if (out.length >= 6) break;
  }
  return out;
}
const SPEC_RE = /\b(material|matl|finish|spec(?:s|ification)?|tolerance|tol\.|alloy|grade|thickness|thk|anodi[sz]e[d]?|powder[\s-]?coat(?:ed)?|plat(?:ed|ing)|passivat\w*|drawing|dwg|rev(?:ision)?\s*[a-z0-9]|heat[\s-]?treat\w*|astm|ansi|asme|mil-\w+|iso\s*\d+|rohs|reach|6061|7075|5052|304l?|316l?|17-4|stainless|alumin(?:um|ium)|steel|brass|copper|titanium|abs|nylon|delrin|acetal|peek|polycarbonate|hdpe|uhmw|±|\+\/-|ra\s*\d|surface\s*finish|cert(?:s|ification)?s?|psi|nema\s*\d\w*|ul\s*\d{2,}\w*|a36|ral\s*\d{4}|gauge|ga\.)\b/i;
function specsFrom(text, items) {
  const used = new Set(items.map(i => i.desc)), out = [];
  for (let raw of String(text).split('\n').flatMap(l => (l.match(/\|/g) || []).length >= 2 ? [l] : l.split(/(?<=[.;])\s+(?=[A-Z])/))) {
    const l = raw.replace(/^\s*(?:[-*•▪◦·]|\d{1,2}[.)])\s+/, '').trim();
    if (!l || l.length > 220 || (l.match(/\|/g) || []).length >= 2 || /\t/.test(l) || !SPEC_RE.test(l) || /^(from|to|cc|subject|date|sent):/i.test(l) || [...used].some(d => d && l.includes(d))) continue;
    if (!out.includes(l)) out.push(l); if (out.length >= 8) break;
  }
  return out;
}
const sentences = t => String(t).replace(/\r/g, '').split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
function dateIn(s, ref) { try { const ps = AssistEngine.parseDates(String(s), ref) || [], p = ps.find(x => x.kind === 'abs') || ps[0]; if (!p) return null; const d = new Date(p.date); d.__time = !!p.time; return d; } catch (_) { return null; } }
const DUE_RE = /\b(?:(?:quote|quotes|quotation|quotations|pricing|price|response|responses|bid|bids|proposal)s?\s+(?:is\s+|are\s+|must\s+be\s+)?(?:due|needed|required|requested)|(?:respond|reply|submit|send|return)\s+(?:your\s+|us\s+|a\s+)?(?:quote|quotation|pricing|price|bid|response)?\s*(?:back\s+)?(?:no\s+later\s+than|by|before)|deadline|due\s+(?:date|by|on)|closing\s+date|bid\s+date|need\s+(?:your\s+|the\s+)?(?:quote|pricing|price)s?\s+(?:back\s+)?by|quote\s+by)\b/i;
const DEL_RE = /\b(deliver(?:y|ed)?|ship(?:ment|ped|ping)?\s+(?:date|by)|ship\s+by|in[-\s]hand|on[-\s]site|need(?:ed)?\s+(?:the\s+)?(?:parts|material|items|units|them)|required\s+(?:delivery|date|by)|eta|lead\s*time|arrive|arrival)\b/i;
function extractQuote(e) {
  const text = String(e.text || ''), subj = String(e.subject || ''), all = subj + '\n' + text, ref = e.date && !isNaN(new Date(e.date)) ? new Date(e.date) : new Date();
  const from = typeof e.from === 'object' && e.from ? { name: e.from.name || '', address: (e.from.address || '').toLowerCase() } : parseAddr(e.from);
  const label = re => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const q = { contact: from.name || '', email: from.address || '' };
  q.customer = label(/^\s*(?:company|customer|organi[sz]ation|account|client)\s*(?:name)?\s*[:\-]\s*(.{2,80})$/im) || sigCompany(text, from.name) || domainCompany(from.address);
  const cn = label(/^\s*(?:contact|buyer|requested\s+by|attn)\s*(?:name)?\s*[:\-]\s*(.{2,60})$/im); if (cn && !q.contact) q.contact = cn.replace(/\s*<.*$/, '');
  let rfq = '';
  const rm = all.match(/\bRFQ\s*(?:#|no\.?|number|num\.?|ref\.?|id)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-_/.]*\d[A-Z0-9\-_/]*)(?!\s*(?:pcs|pc|pieces|ea|each|units?|sets?)\b)/i)
    || all.match(/\b(?:quote\s+request|request\s+for\s+quot(?:e|ation)|inquiry|enquiry|ref(?:erence)?|req(?:uest)?)\s*(?:#|no\.?|number|id)\s*[:#]?\s*([A-Z0-9][\w\-/]*\d[\w\-/]*)/i);
  if (rm) rfq = rm[1].replace(/[.,;:]+$/, '');
  q.rfq = rfq;
  q.items = itemsFrom(text); q.specs = specsFrom(text, q.items);
  let due = null, delivery = null, deliveryText = '';
  for (const s of sentences(all)) {
    if (!due && DUE_RE.test(s)) due = dateIn(s, ref);
    if (!delivery && DEL_RE.test(s) && !DUE_RE.test(s)) { delivery = dateIn(s, ref); if (delivery) delivery.setHours(12, 0, 0, 0); if (!delivery && !deliveryText) { const m = s.match(/(\d+\s*(?:-\s*\d+\s*)?(?:business\s+)?(?:days?|weeks?|wks?|months?)\s*(?:aro|after\s+(?:receipt\s+of\s+)?(?:po|order))?)/i); if (m) deliveryText = m[1]; } }
  }
  if (due && !due.__time) due.setHours(17, 0, 0, 0);     // a quote due "Friday" means end of day
  q.due = due && !isNaN(due) ? due.toISOString() : null;
  q.delivery = delivery && !isNaN(delivery) ? delivery.toISOString() : null; q.deliveryText = q.delivery ? '' : deliveryText;
  q.subject = subj; q.date = e.date && !isNaN(new Date(e.date)) ? new Date(e.date).toISOString() : null;
  return q;
}
async function aiRefineQuote(e, q) {
  const c = aiCfg(); if (!c.on || !c.key) return q;
  try {
    const o = await aiJSON([{ role: 'system', content: 'TASK: rfq_extract\nYou read one RFQ / quote-request email and return ONLY JSON: {"customer":str|null,"contact_name":str|null,"contact_email":str|null,"rfq_number":str|null,"items":[{"description":str,"quantity":number,"unit":str|null}],"specs":[str],"quote_due":ISO8601|null,"delivery_date":ISO8601|null,"delivery_text":str|null}. Use the email date to resolve relative dates. Never invent values.' },
      { role: 'user', content: `Email date: ${q.date || new Date().toISOString()}\nFrom: ${q.contact} <${q.email}>\nSubject: ${e.subject || ''}\n\n${String(e.text || '').slice(0, 12000)}` }]);
    const iso = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d.toISOString(); };
    const out = { ...q, ai: true };
    if (o.customer) out.customer = String(o.customer).slice(0, 80); if (o.contact_name) out.contact = String(o.contact_name).slice(0, 60);
    if (o.contact_email && /@/.test(o.contact_email)) out.email = String(o.contact_email).toLowerCase(); if (o.rfq_number) out.rfq = String(o.rfq_number).slice(0, 40);
    if (Array.isArray(o.items) && o.items.length) out.items = o.items.filter(i => i && i.description).slice(0, 20).map(i => ({ desc: String(i.description).slice(0, 160), qty: +i.quantity || null, unit: i.unit ? String(i.unit) : '' }));
    if (Array.isArray(o.specs) && o.specs.length) out.specs = o.specs.filter(x => typeof x === 'string').slice(0, 10);
    if (iso(o.quote_due)) out.due = iso(o.quote_due); if (iso(o.delivery_date)) { out.delivery = iso(o.delivery_date); out.deliveryText = ''; } else if (o.delivery_text && !out.delivery) out.deliveryText = String(o.delivery_text).slice(0, 60);
    return out;
  } catch (err) { console.warn('AI RFQ extraction failed, using built-in', err); return q; }
}

/* ---------- intake + dedupe ---------- */
const qStripRe = s => String(s || '').replace(/^\s*((re|fw|fwd|aw|wg|sv|tr)\s*(\[\d+\])?\s*:\s*|\[ext(ernal)?\]\s*)+/i, '').replace(/\s+/g, ' ').trim();
const qNormSubj = s => String(s || '').replace(/^\s*((re|fw|fwd|aw|wg|sv|tr)\s*(\[\d+\])?\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
const isReplySubj = s => /^\s*(re|fw|fwd|aw|wg|sv|tr)\s*(\[\d+\])?\s*:/i.test(String(s || ''));
const dayOf = d => d ? new Date(d).toISOString().slice(0, 10) : '';
const quoteCards = () => { const pg = qbPage(); return pg ? pg.tasks.filter(t => isCard(t) && t.q) : []; };
function msgKey(m) { return String(m.subject || '').replace(/\s+/g, ' ').trim().toLowerCase() + '|' + (m.fromAddr || '') + '|' + dayOf(m.date); }
function findQuoteMatch(m) {
  const cards = quoteCards(), mid = (m.messageId || '').toLowerCase();
  for (const t of cards) {
    const q = t.q, ids = [...(q.msgIds || []), ...(q.followups || []).map(f => f.msgId)].filter(Boolean).map(x => x.toLowerCase());
    if (mid && ids.includes(mid)) return { t, dup: true };
    if ((q.keys || []).includes(msgKey(m))) return { t, dup: true };
  }
  for (const t of cards) {
    const q = t.q, dom = a => (a || '').split('@')[1] || '';
    if (m.conversationId && q.convId && m.conversationId === q.convId) return { t, follow: true };
    if (m.rfq && q.rfq && m.rfq.toLowerCase() === q.rfq.toLowerCase()) return { t, follow: true };
    if (qNormSubj(m.subject) && qNormSubj(m.subject) === qNormSubj(q.subject) && (isReplySubj(m.subject) || dom(m.fromAddr) === dom(q.email))) return { t, follow: true };
  }
  return null;
}
function cardTitle(q) { return [q.customer || q.contact || '', q.rfq ? 'RFQ ' + q.rfq : ''].filter(Boolean).join(' · ') || qStripRe(q.subject) || 'New quote'; }
const snippet = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 220);
/* msg: { from: "Name <a@b>" | {name,address}, subject, date, text, messageId?, conversationId?, webLink?, attachments?[] , source } */
async function addQuoteFromEmail(msg, { source = 'email', silent = false, col, followOnly = false } = {}) {
  const n = ensureQuoteNote(); if (qbSealed()) { if (!silent) toast('🔒 Unlock the Quote Board to add quotes'); return { status: 'locked' }; }
  const fromP = typeof msg.from === 'object' && msg.from ? { name: msg.from.name || '', address: (msg.from.address || '').toLowerCase() } : parseAddr(msg.from);
  let q = extractQuote({ ...msg, from: fromP });
  const m = { subject: msg.subject || '', fromAddr: fromP.address, date: q.date, messageId: msg.messageId || '', conversationId: msg.conversationId || '', rfq: q.rfq };
  const hit = findQuoteMatch(m), pg = n.pages[0];
  if (hit && hit.dup) return { status: 'duplicate', card: hit.t };
  if (hit && hit.follow) {
    bH(QPI); const t = hit.t, tq = t.q;
    (tq.followups ||= []).push({ id: uid('f'), date: q.date || new Date().toISOString(), from: fromP.name || fromP.address, subject: msg.subject || '', snippet: snippet(AssistEngine.cleanEmail ? (AssistEngine.cleanEmail(msg.text || '').body || msg.text) : msg.text), msgId: msg.messageId || '', webLink: msg.webLink || '' });
    (tq.keys ||= []).push(msgKey(m)); if (msg.messageId) (tq.msgIds ||= []).push(msg.messageId);
    for (const k of ['customer', 'contact', 'email', 'rfq', 'deliveryText']) if (!tq[k] && q[k]) tq[k] = q[k];
    if (!(tq.items || []).length && q.items.length) tq.items = q.items; if (!(tq.specs || []).length && q.specs.length) tq.specs = q.specs;
    if (!tq.delivery && q.delivery) tq.delivery = q.delivery; if (!tq.due && q.due) { tq.due = q.due; t.due = q.due; t.notified = false; }
    if (!tq.convId && msg.conversationId) tq.convId = msg.conversationId; if (!tq.webLink && msg.webLink) tq.webLink = msg.webLink;
    tq.unread = true; saveNote(n, true); qbRefreshBoard(); renderPanel();
    return { status: 'followup', card: t };
  }
  if (followOnly) return { status: 'skipped' };
  if (!silent || aiCfg().on) q = await aiRefineQuote(msg, q);
  bH(QPI);
  const cols = boardCols(pg), c = cols.find(x => x.id === col) || cols[0];
  const t = { id: uid('t'), kind: 'card', col: c.id, ord: -1, text: cardTitle(q), strokes: [], done: isDoneCol(pg, c.id), due: q.due, repeat: '', notified: false, createdAt: Date.now(),
    q: { ...q, source, msgIds: msg.messageId ? [msg.messageId] : [], keys: [msgKey(m)], convId: msg.conversationId || '', webLink: msg.webLink || '', attachments: (msg.attachments || []).slice(0, 20), value: null, notes: '', followups: [], unread: true, body: snippet(msg.text) } };
  pg.tasks.push(t); renumber(pg, c.id); saveNote(n, true);
  qbRefreshBoard(); renderPanel(); renderSidebar();
  return { status: 'new', card: t };
}
function addManualQuote(fields = {}, col) {
  const n = ensureQuoteNote(); if (qbSealed()) { toast('🔒 Unlock the Quote Board first'); return null; }
  const pg = n.pages[0], cols = boardCols(pg), c = cols.find(x => x.id === col) || cols[0];
  bH(QPI);
  const q = { customer: '', contact: '', email: '', rfq: '', items: [], specs: [], due: null, delivery: null, deliveryText: '', subject: '', date: null, source: 'manual', msgIds: [], keys: [], convId: '', webLink: '', attachments: [], value: null, notes: '', followups: [], ...fields };
  const t = { id: uid('t'), kind: 'card', col: c.id, ord: -1, text: cardTitle(q) === 'New quote' ? '' : cardTitle(q), strokes: [], done: isDoneCol(pg, c.id), due: q.due, repeat: '', notified: false, createdAt: Date.now(), q };
  pg.tasks.push(t); renumber(pg, c.id); saveNote(n, true); qbRefreshBoard(); renderPanel();
  return t;
}

/* ======================= rendering hooks used by board.js ======================= */
const money = v => v == null || v === '' || isNaN(+v) ? '' : '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: +v % 1 ? 2 : 0, maximumFractionDigits: 2 });
function colHeadExtra(pg, c, cc) {
  if (!pg.board.quote) return '';
  const tot = cc.reduce((s, t) => s + (t.q && +t.q.value || 0), 0);
  return `<span class="qb-total" title="Total quoted in ${esc(c.title)}">${money(tot) || '$0'}</span>`;
}
function cardExtraTop(t, pg) {
  if (!pg.board.quote || !t.q) return '';
  const q = t.q, fu = (q.followups || []).length;
  return `<div class="qb-chips">${q.unread ? '<span class="qb-new">New</span>' : ''}${q.rfq ? `<span class="qb-rfq">RFQ ${esc(q.rfq)}</span>` : ''}${q.value != null && q.value !== '' ? `<span class="qb-val">${esc(money(q.value))}</span>` : ''}${fu ? `<span class="qb-fu">↩︎ ${fu} follow-up${fu > 1 ? 's' : ''}</span>` : ''}</div>`;
}
const safeHref = u => /^https:\/\/[\w.-]+(\/|$)/i.test(String(u || '')) ? esc(u) : '';
function cardExtra(t, pg) {
  if (!pg.board.quote || !t.q) return '';
  const q = t.q, items = q.items || [], rows = [];
  if (q.customer && q.contact) rows.push(`<div class="qd-l"><i>👤</i><span>${esc(q.contact)}${q.email ? `<br><span class="qd-m">${esc(q.email)}</span>` : ''}</span></div>`);
  else if (q.contact || q.email) rows.push(`<div class="qd-l"><i>👤</i>${esc(q.contact || q.email)}</div>`);
  if (items.length) rows.push(`<div class="qd-l"><i>📦</i><span>${items.slice(0, 3).map(i => `${i.qty ? `<b>${i.qty.toLocaleString()}${i.unit ? ' ' + esc(i.unit) : ''}</b> × ` : ''}${esc(i.desc)}`).join('<br>')}${items.length > 3 ? `<br><span class="qd-m">+${items.length - 3} more</span>` : ''}</span></div>`);
  if ((q.specs || []).length) rows.push(`<div class="qd-l"><i>🔧</i><span>${esc(q.specs.slice(0, 2).join(' · '))}${q.specs.length > 2 ? ' …' : ''}</span></div>`);
  if (q.delivery || q.deliveryText) rows.push(`<div class="qd-l"><i>🚚</i>Delivery ${esc(q.delivery ? new Date(q.delivery).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : q.deliveryText)}</div>`);
  if (q.subject) rows.push(`<div class="qd-l qd-src"><i>✉︎</i><span>${esc(q.subject)}${q.date ? ` · ${esc(new Date(q.date).toLocaleDateString([], { month: 'short', day: 'numeric' }))}` : ''}</span></div>`);
  if ((q.attachments || []).length) rows.push(`<div class="qd-l"><i>📎</i><span class="qd-m">${esc(q.attachments.slice(0, 3).join(', '))}${q.attachments.length > 3 ? ' …' : ''}</span></div>`);
  const fu = (q.followups || []).slice(-2).map(f => `<div class="qd-fu">↩︎ <b>${esc(f.from || '')}</b> ${f.date ? esc(new Date(f.date).toLocaleDateString([], { month: 'short', day: 'numeric' })) : ''} — ${esc(f.snippet || f.subject || '')}</div>`).join('');
  const link = safeHref(q.webLink);
  return `<div class="qb-det">${rows.join('')}${fu}<div class="qd-acts"><button class="qb-mini" data-qact="edit">✏️ Details</button>${link ? `<a class="qb-mini" href="${link}" target="_blank" rel="noopener noreferrer" data-qact="open">↗︎ Open in Outlook</a>` : ''}${q.email ? `<button class="qb-mini" data-qact="reply">✉︎ Reply</button>` : ''}</div></div>`;
}
function cardMenuExtra(pi, id) {
  const toQuotes = { label: '💲 Move to Quote Board', fn: () => { const qn = ensureQuoteNote(); if (qbSealed()) return toast('🔒 Unlock the Quote Board first'); qbOpen(true, { mode: 'quotes' }); moveCardAcross(pi, id, QPI, boardCols(qn.pages[0])[0].id); } };
  const toIdeas = { label: '💡 Move to Idea Board', fn: () => { const n = ensureIdeaNote(); if (ibSealed()) return toast('🔒 Unlock the Idea Board first'); qbOpen(true, { mode: 'ideas' }); moveCardAcross(pi, id, IPI, boardCols(n.pages[0])[0].id); } };
  if (pi === IPI) return [toQuotes];
  if (pi !== QPI) return [toIdeas, toQuotes];
  const t = findCard(QPI, id); if (!t) return [toIdeas];
  return [{ label: '✏️ Quote details…', fn: () => qbEdit(t) }, toIdeas, ...(safeHref(t.q && t.q.webLink) ? [{ label: '↗︎ Open in Outlook', fn: () => window.open(t.q.webLink, '_blank', 'noopener') }] : [])];
}

/* ======================= the drawer ======================= */
/* ======================= v21: the 💡 Idea Board (the former Project Board), a second board in the same drawer ======================= */
const IDEA_COLS = ['To Do', 'Doing', 'Done'];
function makeIdeaNote() {
  const n = makeNote(S.notebooks[0] ? S.notebooks[0].id : '__ideas', 'Idea Board');
  n.id = IDEA_ID; n.notebookId = '__ideas'; n.system = 'ideas'; n.order = 0;
  const pg = makeTemplatePage('board', n), cols = IDEA_COLS.map(title => ({ id: uid('c'), title }));
  pg.board = { title: '💡 Idea Board', idea: true, columns: cols };
  n.pages = [pg]; return n;
}
function ensureIdeaNote() {
  let n = ideaNote(); if (n) return n;
  if (!window.__ready) throw new Error('Idea Board used before notes finished loading');
  n = makeIdeaNote(); S.notes.push(n); saveNote(n, true); return n;
}
const isIdeaNote = n => !!(n && n.id === IDEA_ID);
const ibSealed = () => { const n = ideaNote(); return !!(n && typeof isSealed === 'function' && isSealed(n)); };
const ideaCards = () => { const n = ideaNote(); return n && !ibSealed() ? n.pages[0].tasks.filter(isCard) : []; };
const BOARDS = {
  quotes: { pi: QPI, ic: '💲', name: 'Quote Board', short: 'Quotes', note: () => quoteNote(), ensure: () => ensureQuoteNote(), sealed: () => qbSealed(), wkey: 'qbW', wdef: 0.5,
    sub: () => { const c = quoteCards(), o = c.filter(t => !t.done).length, u = c.filter(t => t.q.unread).length; return qbSealed() ? 'Locked' : `RFQs from email · ${o} open${u ? ` · ${u} new` : ''}`; } },
  ideas: { pi: IPI, ic: '💡', name: 'Idea Board', short: 'Ideas', note: () => ideaNote(), ensure: () => ensureIdeaNote(), sealed: () => ibSealed(), wkey: 'ibW', wdef: 0.66,
    sub: () => { if (ibSealed()) return 'Locked'; const n = ideaNote(), pg = n && n.pages[0]; if (!pg) return 'Projects, tasks & ideas'; const c = pg.tasks.filter(isCard); return `${boardCols(pg).map(x => x.title).join(' · ')} · ${c.filter(t => !t.done).length} open`; } },
};
/* v21b: the 📥 Inbox — the third option in the dropdown (rendered by inbox.js, not board.js) */
BOARDS.inbox = { pi: null, ic: '📥', name: 'Inbox', short: 'Inbox', note: () => inboxNote(), ensure: () => ensureInboxNote(), sealed: () => typeof inSealed === 'function' && inSealed(), wkey: 'inW', wdef: 0.5,
  sub: () => typeof inSub === 'function' ? inSub() : 'Emails & meeting briefs' };
BOARDS.quotes.badge = () => qbSealed() ? 0 : quoteCards().filter(t => t.q.unread).length;
BOARDS.ideas.badge = () => 0;
BOARDS.inbox.badge = () => typeof inUnread === 'function' ? inUnread() : 0;
const curB = () => BOARDS[QB.mode];
QB.mode = ['ideas', 'inbox'].includes(localStorage.getItem('drawerBoard')) ? localStorage.getItem('drawerBoard') : 'quotes';     // remember the last-selected board

const QD = $('#qbDrawer'), QHOST = $('#qbHost'), IHOST = $('#ibHost'), INHOST = $('#inHost');
QB.host = { el: QHOST, ov: QHOST }; IB.host = { el: IHOST, ov: IHOST };
QD.hidden = false;
const qbW = () => { const B = curB(), v = +localStorage.getItem(B.wkey); return v >= 0.3 && v <= 1 ? v : B.wdef; };
function qbApplyW(f = qbW()) { QD.style.width = f >= 0.99 ? '100vw' : `max(340px, ${Math.round(f * 1000) / 10}vw)`; QD.classList.toggle('full', f >= 0.99); }
function setDrawerBoard(mode, { render = true } = {}) {
  if (!BOARDS[mode]) return; const was = QB.mode; if (was !== mode) cancelBoardGesture();
  QB.mode = mode; localStorage.setItem('drawerBoard', mode);
  QD.dataset.board = mode; QHOST.hidden = mode !== 'quotes'; IHOST.hidden = mode !== 'ideas'; INHOST.hidden = mode !== 'inbox';
  const B = curB(); $('#dbName').innerHTML = `<i>${B.ic}</i>${B.name}`; QD.setAttribute('aria-label', B.name);
  $('#qbTab').querySelector('span').textContent = B.ic; $('#qbTab').querySelector('b').textContent = B.short; $('#qbTab').setAttribute('aria-label', 'Open the ' + B.name);
  $('#qbAdd').querySelector('span').textContent = { quotes: 'Quote', ideas: 'Card', inbox: 'Email' }[mode]; $('#qbAdd').setAttribute('aria-label', { quotes: 'Add a quote', ideas: 'Add a card', inbox: 'Add an email' }[mode]);
  $('#qbLock').setAttribute('aria-label', 'Lock the ' + B.name); $('#qbMore').setAttribute('aria-label', B.name + ' options');
  qbApplyW(); qbSyncStatus(); qbBadge();
  if (render && QB.open) { B.ensure(); qbRender(); }
}
function qbOpen(on = true, { quiet = false, mode = null } = {}) {
  if (mode) setDrawerBoard(mode, { render: false });
  const was = QB.open; QB.open = !!on; QD.classList.toggle('open', QB.open); document.body.classList.toggle('qb-open', QB.open);
  QD.setAttribute('aria-hidden', QB.open ? 'false' : 'true'); $('#qbTab').classList.toggle('hide', QB.open);
  localStorage.setItem('qbOpen', QB.open ? '1' : '0');
  if (QB.open) { ensureQuoteNote(); ensureIdeaNote(); if (typeof ensureInboxNote === 'function') ensureInboxNote(); qbApplyW(); qbRender(); if (!was && !quiet) qbSyncStatus(); }
  else if (was) { cancelBoardGesture(); dbMenu(false); for (const n of [quoteNote(), ideaNote(), inboxNote()]) if (n && isLockedOpen(n) && relockPref() === 'leave') lockNote(n, { animate: false }); }
}
function qbRender() {
  qbSyncUndo(); qbBadge(); if (QB.mode !== 'quotes') qbSyncStatus();
  const B = curB(), n = B.note(), sealed = B.sealed(); $('#qbLock').textContent = n && (sealed || isLockedOpen(n)) ? (sealed ? '🔒' : '🔓') : '🔒';
  QD.classList.toggle('locked', sealed);
  if (!QB.open) return;
  const host = QB.mode === 'ideas' ? IHOST : QB.mode === 'inbox' ? INHOST : QHOST;
  if (sealed) {
    host.innerHTML = QB.mode === 'inbox'
      ? `<div class="qb-locked"><div class="qb-lk-i">🔒</div><h3>The Inbox is locked</h3><p class="fine">Email summaries, action items and meeting briefs are encrypted with Pencil Lock.</p><button class="btn primary" data-qact="unlock">Unlock with PIN</button></div>`
      : QB.mode === 'ideas'
      ? `<div class="qb-locked"><div class="qb-lk-i">🔒</div><h3>The Idea Board is locked</h3><p class="fine">Cards, checklists and handwriting are encrypted with Pencil Lock.</p><button class="btn primary" data-qact="unlock">Unlock with PIN</button></div>`
      : `<div class="qb-locked"><div class="qb-lk-i">🔒</div><h3>The Quote Board is locked</h3><p class="fine">Quotes, contacts and prices are encrypted with Pencil Lock. Email sync waits until you unlock.</p><button class="btn primary" data-qact="unlock">Unlock with PIN</button></div>`;
    return;
  }
  if (host.querySelector('.qb-locked')) host.innerHTML = '';
  if (QB.mode === 'inbox') return inRender();
  renderBoard(B.pi);
}
function qbRefreshBoard() { if (QB.open && !boardBusy()) qbRender(); else { BS.dirty = BS.dirty || QB.open; qbBadge(); } }
/* v21b: the tab badge shows the CURRENT board's count — 💲 unread quotes on the Quote Board, 📥 unread emails on the Inbox, nothing on the Idea Board.
   The ▾ dot means another board has something new; the 📋 top-bar dot means any board does. */
function qbBadge() {
  const cnt = Object.fromEntries(Object.entries(BOARDS).map(([k, B]) => [k, B.badge ? B.badge() : 0])), u = cnt[QB.mode] || 0, b = $('#qbTabBadge');
  b.hidden = !u; b.textContent = u; b.classList.toggle('inb', QB.mode === 'inbox'); b.title = u ? (QB.mode === 'inbox' ? u + ' unread in the Inbox' : u + ' new quote' + (u > 1 ? 's' : '')) : '';
  $('#quotesBtn').classList.toggle('dot', Object.values(cnt).some(Boolean));
  const d = document.getElementById('dbDot'); if (d) d.hidden = !Object.entries(cnt).some(([k, v]) => v && k !== QB.mode);
}
function qbSyncUndo() { const st = QB.mode === 'inbox' ? INB : sysSt(curB().pi), sealed = curB().sealed(); $('#qbUndo').disabled = !st.undo.length || sealed; $('#qbRedo').disabled = !st.redo.length || sealed; }
$('#qbUndo').onclick = () => { if (QB.mode === 'inbox') { if (inRestore(INB.undo, INB.redo)) toast('Undone', 1000); return; } const pi = curB().pi, st = sysSt(pi); if (qbRestore(st.undo, st.redo, pi)) toast('Undone', 1000); };
$('#qbRedo').onclick = () => { if (QB.mode === 'inbox') { if (inRestore(INB.redo, INB.undo)) toast('Redone', 1000); return; } const pi = curB().pi, st = sysSt(pi); if (qbRestore(st.redo, st.undo, pi)) toast('Redone', 1000); };
$('#qbClose').onclick = () => qbOpen(false);
$('#qbTab').onclick = () => qbOpen(true);
$('#quotesBtn').onclick = () => qbOpen(!QB.open);
$('#qbLock').onclick = async () => {
  const B = curB(), n = B.ensure();
  if (B.sealed()) { await pinUnlockFlow(n); qbRender(); return; }
  if (!lockCfg()) { toast(`Set up Pencil Lock first — then the ${B.name} can be locked`); setupPencilLock(); return; }
  await lockNote(n, { animate: false }); qbRender(); toast('🔒 ' + B.name + ' locked');
};
const widthRow = () => ({ label: qbW() >= 0.99 ? '◧ Half width' : '⬜ Full width', sub: 'Or drag the left edge · double-tap it to switch', fn: () => { const B = curB(); localStorage.setItem(B.wkey, qbW() >= 0.99 ? String(B.wdef) : '1'); qbApplyW(); qbRender(); } });
$('#qbMore').onclick = () => QB.mode === 'inbox' ? inMoreMenu() : QB.mode === 'ideas' ? actionSheet('Idea Board', [
  widthRow(),
  { label: (() => { const n = ideaNote(); return n && n.pages[0].board.compact; })() ? '▦ Full cards' : '▤ Compact cards', fn: () => setCompact(IPI, !ideaNote().pages[0].board.compact) },
  { label: '＋ Add a column', fn: () => { const b = IHOST.querySelector('[data-bact="addcol"]'); if (b) b.click(); } },
  ...(typeof legacyBoardPages === 'function' && legacyBoardPages().length ? [{ label: `📥 Bring in old Project Board pages (${legacyBoardPages().length})…`, fn: () => importLegacyBoards() }] : []),
  { label: '⚙︎ Settings…', fn: () => openSettings('quotes') }]) : actionSheet('Quote Board', [
  { label: '📧 Email sync…', sub: syncProviderLabel(), fn: () => qbEmailSettings() },
  widthRow(),
  { label: '📋 Paste an email', fn: () => qbPasteClipboard() },
  { label: `🙈 Skipped emails (${qbSkipped().length})…`, fn: () => qbSkippedSheet() },
  { label: '⚙︎ Settings…', fn: () => openSettings('quotes') }]);
function ideaAddCard() {
  const n = ensureIdeaNote(); if (ibSealed()) return toast('🔒 Unlock the Idea Board first');
  const b = IHOST.querySelector('.bcol [data-bact="add"]'); if (b) b.click();
}
/* the board dropdown at the top of the drawer */
function dbMenu(on) {
  const m = $('#dbMenu'), btn = $('#dbSwitch'); if (!m) return;
  if (on === undefined) on = m.hidden;
  if (!on) { m.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
  m.innerHTML = Object.entries(BOARDS).map(([k, B]) => { const c = B.badge ? B.badge() : 0; return `<button role="option" class="db-opt ${QB.mode === k ? 'on' : ''}" data-board="${k}" aria-selected="${QB.mode === k}"><i>${B.ic}</i><span><b>${B.name}</b><small>${esc(B.sub())}</small></span>${c ? `<mark class="db-n ${k}" aria-label="${c} new">${c}</mark>` : ''}${QB.mode === k ? '<em>✓</em>' : ''}</button>`; }).join('');
  m.hidden = false; btn.setAttribute('aria-expanded', 'true');
}
$('#dbSwitch').onclick = e => { e.stopPropagation(); dbMenu(); };
$('#dbMenu').addEventListener('click', e => { const o = e.target.closest('[data-board]'); if (!o) return; dbMenu(false); setDrawerBoard(o.dataset.board); });
document.addEventListener('pointerdown', e => { const m = $('#dbMenu'); if (m && !m.hidden && !m.contains(e.target) && !$('#dbSwitch').contains(e.target)) dbMenu(false); }, true);
$('#qbAdd').onclick = () => QB.mode === 'inbox' ? inAddMenu() : QB.mode === 'ideas' ? ideaAddCard() : actionSheet('Add a quote', [
  { label: '✍︎ New quote…', sub: 'Customer, RFQ #, items, due date, value', primary: true, fn: () => qbEdit(null) },
  { label: '📋 Paste an email', sub: 'Copy the RFQ in Mail first', fn: () => qbPasteClipboard() },
  { label: '✏️ Blank card to handwrite', fn: () => { const t = addManualQuote(); if (t) boardFlash(QPI, t.id); } }]);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && QB.open && !document.querySelector('.modal-wrap:not([hidden])')) { if (!$('#dbMenu').hidden) dbMenu(false); else qbOpen(false); } });

/* resize: drag the left edge; snaps to half / full; double-tap toggles */
{ const h = $('#qbResize'); let rz = null, lastTap = 0;
  h.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); rz = { pid: e.pointerId, x0: e.clientX, moved: false }; try { h.setPointerCapture(e.pointerId); } catch (_) {} QD.classList.add('resizing'); });
  window.addEventListener('pointermove', e => { if (!rz || e.pointerId !== rz.pid) return; if (Math.abs(e.clientX - rz.x0) > 4) rz.moved = true; if (!rz.moved) return; const f = Math.max(0.3, Math.min(1, (innerWidth - e.clientX) / innerWidth)); rz.f = f; qbApplyW(f); });
  const end = e => { if (!rz || e.pointerId !== rz.pid) return; QD.classList.remove('resizing'); const r = rz; rz = null;
    if (!r.moved) { const now = Date.now(); if (now - lastTap < 350) { localStorage.setItem(curB().wkey, qbW() >= 0.99 ? String(curB().wdef) : '1'); qbApplyW(); qbRender(); } lastTap = now; return; }
    let f = r.f || qbW(); if (f > 0.86) f = 1; else if (Math.abs(f - 0.5) < 0.07) f = 0.5; else if (f < 0.34) { qbApplyW(); qbOpen(false); return; }
    localStorage.setItem(curB().wkey, String(Math.round(f * 1000) / 1000)); qbApplyW(f); qbRender(); };
  window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true); }

/* open by swiping in from the right edge (finger or Pencil); close by swiping the header right; pull the header down to check email */
{ let es = null;
  document.addEventListener('pointerdown', e => { if (QB.open || e.clientX < innerWidth - 24 || (e.pointerType === 'mouse' && e.button)) return;
    if (!e.target.closest || !e.target.closest('#pages, #qbTab, #main, #topbar, #toolbar') || e.target.closest('#panel, #sidebar, .modal-wrap, #sheetWrap, #actionWrap, input, textarea') || document.querySelector('.modal-wrap:not([hidden]), #sheetWrap:not([hidden]), #actionWrap:not([hidden])') || document.getElementById('app').classList.contains('side-open') || (isDrawer() && !document.getElementById('app').classList.contains('panel-closed'))) return; es = { pid: e.pointerId, x0: e.clientX, y0: e.clientY }; }, true);
  window.addEventListener('pointermove', e => { if (!es || e.pointerId !== es.pid) return; const dx = es.x0 - e.clientX, dy = Math.abs(e.clientY - es.y0); if (dy > 60) { es = null; return; } if (dx > 36 && dx > dy) { es = null; if (typeof cancelBoardGesture === 'function') cancelBoardGesture(); qbOpen(true); } }, { passive: true });
  window.addEventListener('pointerup', () => { es = null; }, true);
  const head = $('#qbHead'), pull = $('#qbPull'); let hg = null;
  head.addEventListener('pointerdown', e => { if (e.target.closest('button, a, input') || (e.pointerType === 'mouse' && e.button)) return; hg = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, mode: '' }; try { head.setPointerCapture(e.pointerId); } catch (_) {} });
  window.addEventListener('pointermove', e => {
    if (!hg || e.pointerId !== hg.pid) return; const dx = e.clientX - hg.x0, dy = e.clientY - hg.y0;
    if (!hg.mode) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) hg.mode = 'x'; else if (dy > 8 && dy > Math.abs(dx) && QB.mode === 'quotes') hg.mode = 'pull'; else return; }
    if (hg.mode === 'pull') { const off = Math.min(90, dy * 0.55); hg.armed = off > 44; QD.style.setProperty('--qpull', off + 'px'); QD.classList.add('pulling'); QD.classList.toggle('pull-armed', hg.armed); pull.firstElementChild.textContent = hg.armed ? '↑ Release to check email' : '↓ Pull to check email'; }
    else { QD.style.transform = dx > 0 ? `translateX(${dx}px)` : ''; hg.close = dx > 90; }
  });
  const hend = e => { if (!hg || e.pointerId !== hg.pid) return; const g = hg; hg = null; QD.classList.remove('pulling', 'pull-armed'); QD.style.setProperty('--qpull', '0px'); QD.style.transform = '';
    if (e.type === 'pointercancel') return; if (g.mode === 'pull' && g.armed) syncNow({ manual: true, via: 'pull' }); if (g.mode === 'x' && g.close) qbOpen(false); };
  window.addEventListener('pointerup', hend, true); window.addEventListener('pointercancel', hend, true); }

/* drawer taps */
QD.addEventListener('click', e => {
  const a = e.target.closest('[data-qact]'); if (!a) return;
  if (a.dataset.qact === 'unlock') { pinUnlockFlow(curB().note()).then(qbRender); return; }
  if (a.closest('#ibHost')) return;
  const w = a.closest('.bcard-wrap'), t = w && findCard(QPI, w.dataset.id); if (!t) return;
  if (a.dataset.qact === 'edit') { e.preventDefault(); qbEdit(t); }
  if (a.dataset.qact === 'reply') { e.preventDefault(); const q = t.q; location.href = `mailto:${encodeURIComponent(q.email)}?subject=${encodeURIComponent(('Re: ' + (q.subject || 'Your RFQ' + (q.rfq ? ' ' + q.rfq : ''))).replace(/[\r\n]+/g, ' '))}`; }
  if (a.dataset.qact === 'open' && t.q.unread) { t.q.unread = false; saveNote(quoteNote(), true); qbBadge(); }
});

/* ======================= quote details sheet ======================= */
const isoLocal = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const isoDate = iso => isoLocal(iso).slice(0, 10);
function itemsToText(items) { return (items || []).map(i => (i.qty ? `${i.qty}${i.unit ? ' ' + i.unit : ''} × ` : '') + i.desc).join('\n'); }
function textToItems(s) { return String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^([\d,]+)\s*([a-z]{1,10})?\s*[×x*]\s*(.+)$/i); return m ? { qty: +m[1].replace(/,/g, ''), unit: (m[2] || '').toLowerCase(), desc: m[3].trim() } : { qty: null, unit: '', desc: l }; }); }
function qbEdit(t) {
  if (qbSealed()) return toast('🔒 Unlock the Quote Board first');
  const isNew = !t, q = t ? t.q || (t.q = {}) : {};
  if (t && q.unread) { q.unread = false; saveNote(quoteNote(), true); qbBadge(); }
  const w = modalWrap('qbEditWrap');
  const fld = (k, l, v, type = 'text', extra = '') => `<label>${l}<input data-q="${k}" type="${type}" value="${esc(v ?? '')}" ${extra}></label>`;
  const area = (k, l, v, ph) => `<label>${l}<textarea data-q="${k}" rows="3" placeholder="${esc(ph)}">${esc(v || '')}</textarea></label>`;
  const fus = (q.followups || []).map(f => `<li><b>${esc(f.from || '')}</b> · ${f.date ? esc(new Date(f.date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}<br>${esc(f.snippet || f.subject || '')}${safeHref(f.webLink) ? ` <a href="${safeHref(f.webLink)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}</li>`).join('');
  w.innerHTML = `<div class="sheet qb-edit" role="dialog" aria-modal="true" aria-label="Quote details"><h3>${isNew ? '＋ New quote' : '💲 Quote details'}</h3>
    <div class="qe-grid">${fld('customer', 'Customer / company', q.customer)}${fld('rfq', 'RFQ #', q.rfq)}
    ${fld('contact', 'Contact name', q.contact)}${fld('email', 'Contact email', q.email, 'email', 'autocomplete="off"')}
    ${fld('value', 'Quoted value ($)', q.value ?? '', 'number', 'step="0.01" min="0" inputmode="decimal"')}${fld('due', 'Quote due (reminder)', isoLocal(q.due || (t && t.due)), 'datetime-local')}
    ${fld('delivery', 'Requested delivery', isoDate(q.delivery), 'date')}${fld('deliveryText', 'or delivery note', q.deliveryText, 'text', 'placeholder="e.g. 4 weeks ARO"')}</div>
    ${area('items', 'Parts / items (one per line: qty × description)', itemsToText(q.items), '500 pcs × 6061-T6 mounting bracket, rev C')}
    ${area('specs', 'Specs & materials', (q.specs || []).join('\n'), 'Material, finish, tolerances, certs…')}
    ${area('notes', 'Notes', q.notes, 'Pricing notes, supplier quotes, follow-up plan…')}
    ${q.subject ? `<p class="fine">✉︎ From the email “${esc(q.subject)}”${q.date ? ' · ' + esc(new Date(q.date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}${safeHref(q.webLink) ? ` · <a href="${safeHref(q.webLink)}" target="_blank" rel="noopener noreferrer">Open in Outlook</a>` : ''}</p>` : ''}
    ${fus ? `<div class="qe-fu"><b>↩︎ Follow-ups</b><ul>${fus}</ul></div>` : ''}
    <p class="fine">Handwrite on the card itself — its ink area is your notepad.</p>
    <div class="sheet-actions"><div class="spacer"></div><button class="btn" data-qe="x">Cancel</button><button class="btn primary" data-qe="ok">${isNew ? 'Add quote' : 'Save'}</button></div></div>`;
  w.hidden = false;
  const close = () => { w.hidden = true; };
  w.onclick = e => { if (e.target === w) close(); const b = e.target.closest('[data-qe]'); if (!b) return; if (b.dataset.qe === 'x') return close();
    const v = {}; w.querySelectorAll('[data-q]').forEach(i => v[i.dataset.q] = i.value.trim());
    const dueD = v.due ? new Date(v.due) : null, delD = v.delivery ? new Date(v.delivery + 'T12:00') : null;
    const out = { customer: v.customer, rfq: v.rfq, contact: v.contact, email: v.email.toLowerCase(), value: v.value === '' ? null : Math.round(+v.value * 100) / 100,
      due: dueD && !isNaN(dueD) ? dueD.toISOString() : null, delivery: delD && !isNaN(delD) ? delD.toISOString() : null, deliveryText: v.deliveryText, items: textToItems(v.items), specs: v.specs.split('\n').map(s => s.trim()).filter(Boolean), notes: v.notes };
    close();
    if (isNew) { const nt = addManualQuote(out); if (nt) { nt.text = cardTitle({ ...nt.q }) === 'New quote' ? '' : cardTitle(nt.q); saveNote(quoteNote(), true); qbRender(); boardFlash(QPI, nt.id); toast('💲 Quote added'); } return; }
    const tt = findCard(QPI, t.id); if (!tt) return;
    bH(QPI); const oldTitle = cardTitle(tt.q); Object.assign(tt.q, out);
    if (!tt.text || tt.text === oldTitle) tt.text = cardTitle(tt.q);
    if ((tt.due || null) !== out.due) { tt.due = out.due; tt.notified = false; }
    saveNote(quoteNote(), true); qbRender(); renderPanel(); toast('Saved', 1000);
  };
}

/* ======================= intake: drop / paste on the drawer, clipboard, lasso ======================= */
const TZ_OFF = { EDT: '-0400', EST: '-0500', CDT: '-0500', CST: '-0600', MDT: '-0600', MST: '-0700', PDT: '-0700', PST: '-0800', AKDT: '-0800', AKST: '-0900', HST: '-1000', BST: '+0100', CET: '+0100', CEST: '+0200', GMT: '+0000', UTC: '+0000' };
function parseMailDate(s) {
  if (!s) return null; let d = new Date(s); if (!isNaN(d)) return d;
  const t = String(s).replace(/^\s*[A-Za-z]+,\s*/, '').replace(/\s+at\s+/i, ' ').replace(/\b([A-Z]{3,4})\b\s*$/, (m, z) => TZ_OFF[z] ? 'GMT' + TZ_OFF[z] : m).replace(/(\d)\s*(AM|PM)\b/i, '$1 $2').trim();
  d = new Date(t); if (!isNaN(d)) return d;
  try { const p = AssistEngine.parseDates(t, new Date())[0]; return p ? new Date(p.date) : null; } catch (_) { return null; }
}
function emailFromSnap(snap) {
  const S0 = snap.strings, html = S0['text/html'], plain = S0['text/plain'] || S0['Text'];
  const fromRaw = raw => { const e = AssistEngine.parseEml(raw.replace(/^\d+\s*\n/, '')); const hdr = raw.slice(0, Math.max(0, raw.search(/\r?\n\r?\n/))) || raw.slice(0, 4000); const mid = hdr.match(/^message-id:\s*(<[^>\s]+>)/im); return { ...e, messageId: mid ? mid[1] : '' }; };
  const fromText = text => { const { h, body } = AssistEngine.splitHeaderBlock(String(text).replace(/\r/g, '')); const d = parseMailDate(h.date || h.sent); return { from: h.from || '', subject: h.subject || '', date: d && !isNaN(d) ? d : null, text: body }; };
  if (plain && /^(received|return-path|mime-version|delivered-to|message-id):/im.test(plain.slice(0, 400)) && /^subject:/im.test(plain)) return fromRaw(plain);
  if (plain && plain.trim() && !linkOnly(plain)) return fromText(plain);
  if (html && html.trim()) { const t = AssistEngine.htmlToText(html); if (t.trim() && !linkOnly(t)) return fromText(t); }
  return null;
}
async function intakeToQuotes(email, via) {
  if (!email || !String(email.text || email.subject || '').trim()) { toast('Nothing readable arrived — select the email text in Mail, then drag or Copy → 📋 Paste'); return null; }
  if (!isRFQ(email.subject, email.text)) {
    const go = await new Promise(res => { actionSheet('This doesn’t look like an RFQ', [{ label: 'Add it as a quote anyway', primary: true, fn: () => res(true) }, { label: 'Don’t add', fn: () => res(false) }]); $('#actionWrap').addEventListener('click', e => { if (e.target.id === 'actionWrap' || e.target.textContent === 'Cancel') res(false); }, { once: true }); });
    if (!go) return null;
  }
  const r = await addQuoteFromEmail(email, { source: via });
  qbOpen(true, { quiet: true });
  if (r.status === 'new') { toast(`💲 Added “${r.card.text}”`, 2600); boardFlash(QPI, r.card.id); }
  else if (r.status === 'followup') { toast(`↩︎ Follow-up added to “${r.card.text}”`, 2600); boardFlash(QPI, r.card.id); }
  else if (r.status === 'duplicate') { toast('Already on the Quote Board', 2200); boardFlash(QPI, r.card.id); }
  return r;
}
async function intakeSnapToQuotes(snap, via) {
  for (const f of snap.files) {
    const name = (f.name || '').toLowerCase(), type = (f.type || '').toLowerCase();
    if (/\.eml$|\.emlx$/.test(name) || type === 'message/rfc822') return intakeToQuotes(emailFromSnap({ strings: { 'text/plain': await f.text() } }), via + ' · ' + (f.name || 'email file'));
    if (type.startsWith('text/') || /\.(txt|md|html?)$/.test(name)) { const t = await f.text(); return intakeToQuotes(emailFromSnap({ strings: { [type.includes('html') || /\.html?$/.test(name) ? 'text/html' : 'text/plain']: t } }), via); }
  }
  return intakeToQuotes(emailFromSnap(snap), via);
}
QD.addEventListener('dragover', e => { if (QB.mode === 'ideas' || curB().sealed()) return; e.preventDefault(); e.stopPropagation(); QD.classList.add('dropping'); });
QD.addEventListener('dragleave', e => { if (!QD.contains(e.relatedTarget)) QD.classList.remove('dropping'); });
QD.addEventListener('drop', e => { if (QB.mode === 'ideas') return; e.preventDefault(); e.stopPropagation(); QD.classList.remove('dropping');
  if (QB.mode === 'inbox') { if (inSealed()) return toast('🔒 Unlock the Inbox first'); return inIntake(snapTransfer(e.dataTransfer), 'drop'); }
  if (qbSealed()) return toast('🔒 Unlock the Quote Board first'); intakeSnapToQuotes(snapTransfer(e.dataTransfer), 'drop'); });
let qbTouchAt = 0; QD.addEventListener('pointerdown', () => { qbTouchAt = Date.now(); }, true);
document.addEventListener('paste', e => {
  if (!QB.open || QB.mode === 'ideas' || Date.now() - qbTouchAt > 120000 || e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (QB.mode === 'inbox') { if (inSealed()) return toast('🔒 Unlock the Inbox first'); return inIntake(snapTransfer(e.clipboardData), 'paste'); }
  intakeSnapToQuotes(snapTransfer(e.clipboardData), 'paste');
}, true);
async function qbPasteClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.read) { const items = await navigator.clipboard.read(); const strings = {};
      for (const it of items) for (const ty of it.types) if (/^text\//.test(ty)) strings[ty] = await (await it.getType(ty)).text();
      return intakeSnapToQuotes({ strings, files: [], types: Object.keys(strings), items: [], lengths: {} }, 'paste'); }
    const t = await navigator.clipboard.readText(); return intakeSnapToQuotes({ strings: { 'text/plain': t }, files: [], types: ['text/plain'], items: [], lengths: {} }, 'paste');
  } catch (err) { toast('Paste was blocked — long-press inside the Quote Board and choose Paste', 4000); }
}
{ const b = document.createElement('button'); b.id = 'lassoQuote'; b.textContent = '💲 To Quote Board'; $('#lassoBoard').after(b);
  b.onclick = () => { const s = selection; if (!s) return; if (!s.ids.length) { toast('Select some handwriting first'); return; } $('#lassoMenu').hidden = true;
    const qn = ensureQuoteNote(); if (qbSealed()) return toast('🔒 Unlock the Quote Board first');
    const t = cardFromInk({ note: curNote(), pi: s.pi, ids: s.ids.slice() }, qn, QPI, boardCols(qn.pages[0])[0].id);
    if (t) { t.q = { customer: '', contact: '', email: '', rfq: '', items: [], specs: [], due: null, delivery: null, deliveryText: '', subject: '', date: null, source: 'ink', msgIds: [], keys: [], convId: '', webLink: '', attachments: [], value: null, notes: '', followups: [] }; saveNote(qn, true); qbOpen(true, { quiet: true, mode: 'quotes' }); boardFlash(QPI, t.id); } }; }

/* ======================= integration: lock, notes, search, deep links, settings ======================= */
{ const _ln = lockNote; lockNote = async function (n, ...a) { const r = await _ln.call(this, n, ...a); if (isQuoteNote(n)) { QB.undo = []; QB.redo = []; qbRender(); } if (isIdeaNote(n)) { IB.undo = []; IB.redo = []; qbRender(); } if (n && n.id === INBOX_ID) { INB.undo = []; INB.redo = []; qbRender(); qbBadge(); } return r; }; if (window.PencilLock) PencilLock.lockNote = lockNote;
  for (const nm of ['unlockWithPin', 'unlockWith']) { const f = window[nm]; if (typeof f !== 'function') continue; const w = async function (n, ...a) { const r = await f.call(this, n, ...a); if (isQuoteNote(n) || isIdeaNote(n) || (n && n.id === INBOX_ID)) { qbRender(); qbBadge(); } return r; }; window[nm] = w; if (window.PencilLock) PencilLock[nm] = w; } }
{ const _on = openNote; openNote = function (id) {
    const SYS = [QUOTE_ID, IDEA_ID, INBOX_ID];
    if (!SYS.includes(id)) return _on(id);
    if (!curNote() || SYS.includes(S.cur)) { const alt = S.notes.filter(n => !SYS.includes(n.id)).sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (alt) _on(alt.id); else createNote(S.notebooks[0].id); }
    if (window.__ready) qbOpen(true, { mode: id === IDEA_ID ? 'ideas' : id === INBOX_ID ? 'inbox' : 'quotes' });     // at boot (most-recent note = the board) just open a real note
  }; }
{ const _jt = jumpTo; jumpTo = function (noteId, taskId) { if (noteId === INBOX_ID) { if (isDrawer()) setPanel(false); qbOpen(true, { mode: 'inbox' }); if (taskId) setTimeout(() => inFlash(taskId), 60); return; } const pi = piOfSysNote(noteId); if (pi === null) return _jt(noteId, taskId); if (isDrawer()) setPanel(false); qbOpen(true, { mode: pi === IPI ? 'ideas' : 'quotes' }); if (taskId) setTimeout(() => boardFlash(pi, taskId), 60); }; }
{ const _nst = noteSearchText; noteSearchText = function (n) { const base = _nst(n); if (!isQuoteNote(n) || qbSealed()) return base;
    return base + ' ' + quoteCards().map(t => { const q = t.q; return [q.customer, q.contact, q.email, q.rfq, q.subject, q.notes, q.deliveryText, ...(q.items || []).map(i => i.desc), ...(q.specs || []), ...(q.followups || []).map(f => f.snippet)].join(' '); }).join(' ').toLowerCase(); }; }
{ const _rs = renderSidebar; renderSidebar = function () {
    _rs(); const n = quoteNote(), box = $('#notebookList'); if (!n || !box || box.querySelector('#qbRow')) return;
    const q = S.search.trim().toLowerCase(); if (q && !noteSearchText(n).includes(q)) return;
    const cards = quoteCards(), open = cards.filter(t => !t.done).length, hit = q && !qbSealed() ? cards.find(t => [t.text, t.q.customer, t.q.rfq, t.q.subject, ...(t.q.items || []).map(i => i.desc)].join(' ').toLowerCase().includes(q)) : null;
    const row = document.createElement('div'); row.className = 'today-row qb-row'; row.id = 'qbRow'; row.setAttribute('role', 'button');
    row.innerHTML = `💲 <span class="name">Quote Board${hit ? `<small class="s hit">${esc(hit.text)}</small>` : ''}</span><span class="cnt ${open ? 'on' : ''}">${qbSealed() ? '🔒' : open}</span>`;
    const t = box.querySelector('#todayRow'); t ? t.after(row) : box.prepend(row);
    const ib = ideaNote(); if (!ib || box.querySelector('#ibRow') || (q && !noteSearchText(ib).includes(q))) return;
    const ic = ideaCards(), iopen = ic.filter(c => !c.done).length, ihit = q && !ibSealed() ? ic.find(c => String(c.text || '').toLowerCase().includes(q)) : null;
    const r2 = document.createElement('div'); r2.className = 'today-row qb-row'; r2.id = 'ibRow'; r2.setAttribute('role', 'button');
    r2.innerHTML = `💡 <span class="name">Idea Board${ihit ? `<small class="s hit">${esc(ihit.text)}</small>` : ''}</span><span class="cnt ${iopen ? 'on' : ''}">${ibSealed() ? '🔒' : iopen}</span>`;
    row.before(r2);
  }; }
$('#notebookList').addEventListener('click', e => { const ir = e.target.closest('#ibRow'); if (ir) { e.stopPropagation(); if (isDrawer()) setSidebar(false); qbOpen(true, { mode: 'ideas' }); const q = S.search.trim().toLowerCase(); if (q) { const t = ideaCards().find(c => String(c.text || '').toLowerCase().includes(q)); if (t) setTimeout(() => boardFlash(IPI, t.id), 80); } return; }
  const r = e.target.closest('#qbRow'); if (!r) return; e.stopPropagation(); if (isDrawer()) setSidebar(false); qbOpen(true, { mode: 'quotes' }); const q = S.search.trim().toLowerCase(); if (q) { const t = quoteCards().find(c => [c.text, c.q.customer, c.q.rfq, c.q.subject, ...(c.q.items || []).map(i => i.desc)].join(' ').toLowerCase().includes(q)); if (t) setTimeout(() => boardFlash(QPI, t.id), 80); } }, true);
{ const _ra = renderAll; renderAll = function (...a) { const r = _ra.apply(this, a); if (QB.open) qbRefreshBoard(); else qbBadge(); return r; }; }
{ const _ss = settingsSections; settingsSections = function () {
    const secs = _ss(), i = secs.findIndex(s => s.id === 'storage');
    const sec = { id: 'quotes', h: 'Boards (slide-out)', note: 'The 💲 Quote Board, 💡 Idea Board and 📥 Inbox share one slide-out panel — tap 📋 in the top bar or swipe in from the right edge, then pick a board from the dropdown at the top.', rows: [
      { label: '💡 Open the Idea Board', sub: 'Projects, tasks & ideas — To Do · Doing · Done', fn: () => qbOpen(true, { mode: 'ideas' }) },
      { label: '📧 Email sync: ' + syncProviderLabel() + '…', sub: 'Work email (Microsoft 365 / Exchange) — even if you read mail in Apple Mail', fn: () => qbEmailSettings() },
      { label: '⟳ Check email now', fn: () => { qbOpen(true, { quiet: true, mode: 'quotes' }); syncNow({ manual: true }); } },
      { label: '💲 Open the Quote Board', fn: () => qbOpen(true, { mode: 'quotes' }) },
      { label: '🙈 Skipped emails…', sub: 'Emails the sync passed over — add any it got wrong', fn: () => qbSkippedSheet() },
      { label: '🔒 Lock the Quote Board…', sub: 'Encrypts quotes, contacts and prices with Pencil Lock', fn: () => { qbOpen(true, { mode: 'quotes' }); $('#qbLock').click(); } },
      { label: '🔒 Lock the Idea Board…', fn: () => { qbOpen(true, { mode: 'ideas' }); $('#qbLock').click(); } },
      { label: '📥 Open the Inbox', sub: 'Emails you paste or drop, with summaries, priorities and threads — plus meeting briefs', fn: () => qbOpen(true, { mode: 'inbox' }) },
      { label: '📧 Emails the quote sync skips → Inbox: ' + (localStorage.getItem('inboxFromSync') === '1' ? 'On' : 'Off'), sub: 'Off: they only go to 🙈 Skipped emails. On: they also get a summary card in the 📥 Inbox', fn: () => { const on = localStorage.getItem('inboxFromSync') === '1'; localStorage.setItem('inboxFromSync', on ? '0' : '1'); toast(on ? 'Skipped emails stay out of the Inbox' : 'Skipped work emails will also land in the 📥 Inbox'); openSettings('quotes'); } },
      { label: '🔒 Lock the Inbox…', fn: () => { qbOpen(true, { mode: 'inbox' }); $('#qbLock').click(); } }] };
    secs.splice(i < 0 ? secs.length : i, 0, sec); return secs; }; }

/* ======================= email sync layer =======================
   A provider is { id, label, status() → {configured, signedIn, account}, signIn(), signOut(), backfillDays(), fetchCandidates(since: Date) → [msg] }
   msg = { messageId, conversationId, subject, from: {name,address}|string, date, text, webLink, attachments: [names] } */
const QSync = { providers: {}, order: [], running: false, err: '', timer: null };
function registerQuoteProvider(p) { if (!QSync.providers[p.id]) QSync.order.push(p.id); QSync.providers[p.id] = p; qbSyncStatus(); }
function activeProvider() { if (window.__qbMockProvider) return window.__qbMockProvider; for (const id of QSync.order) { const p = QSync.providers[id]; if (p.status().configured) return p; } return QSync.providers[QSync.order[0]] || null; }
function syncProviderLabel() { const p = activeProvider(); if (!p) return 'Not connected'; const s = p.status(); return s.signedIn ? `${p.label} · ${s.account || 'signed in'}` : s.configured ? `${p.label} · not signed in` : 'Not connected'; }
const qbLastSync = () => +localStorage.getItem('qbLastSync') || 0;
function agoText(ms) { const s = (Date.now() - ms) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
function qbSyncStatus() {
  const el = $('#qbSync'); if (!el) return;
  if (QB.mode !== 'quotes') { el.classList.remove('err'); el.textContent = curB().sub(); return; }
  const p = activeProvider(), st = p && p.status();
  el.classList.toggle('err', !!QSync.err && !QSync.running);
  el.textContent = QSync.running ? 'Checking…' : QSync.err ? '⚠︎ ' + QSync.err : !st || !st.signedIn ? 'Email not connected — tap ⟳ Refresh' : qbLastSync() ? 'Synced ' + agoText(qbLastSync()) : 'Not synced yet';
}
setInterval(qbSyncStatus, 30000);
function qbSpin(on) { QD.classList.toggle('syncing', on); const b = $('#qbRefresh'); b.setAttribute('aria-busy', on ? 'true' : 'false'); b.querySelector('span').textContent = on ? 'Checking…' : 'Refresh'; }
const plural = (n, w) => `${n} new ${w}${n === 1 ? '' : 's'}`;
async function syncNow({ manual = false, via = 'button' } = {}) {
  if (QSync.running) return { status: 'busy' };
  const p = activeProvider(), st = p && p.status();
  if (!p || !st.signedIn) { if (manual) qbEmailSettings({ signIn: true }); return { status: 'signin' }; }
  if (qbSealed()) { if (manual) toast('🔒 Unlock the Quote Board to check email'); return { status: 'locked' }; }
  QSync.running = true; QSync.err = ''; qbSpin(true); qbSyncStatus();
  try {
    const last = qbLastSync(), days = (p.backfillDays && p.backfillDays()) || 90;
    const since = last ? new Date(last - 15 * 60000) : new Date(Date.now() - days * 864e5);
    const started = Date.now(), msgs = await p.fetchCandidates(since);
    let added = 0, fu = 0, skipped = 0;
    msgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));   // oldest first so replies attach to the original
    const keep = [];
    for (const m of msgs) { if (isRFQ(m.subject, m.text)) keep.push(m); else if (!m.fromSelf) { qbSkip(m, 'No RFQ / quote wording'); skipped++; if (typeof inFromSync === 'function') await inFromSync(m); } }
    const verdicts = await grokClassify(keep.filter(m => !m.fromSelf && !findQuoteMatch({ subject: m.subject || '', fromAddr: (m.from && m.from.address) || parseAddr(m.from).address, date: m.date, messageId: m.messageId || '', conversationId: m.conversationId || '' })));
    for (const m of keep) {
      const v = verdicts.get(m);
      if (v && !v.rfq) { qbSkip(m, 'Grok: ' + (v.reason || 'not a request for a quote')); skipped++; if (typeof inFromSync === 'function') await inFromSync(m); continue; }
      const r = await addQuoteFromEmail(m, { source: p.label, silent: true, followOnly: !!m.fromSelf });
      if (r.status === 'new') added++; else if (r.status === 'followup') fu++; else if (r.status === 'locked') break;
    }
    qbBadge();
    localStorage.setItem('qbLastSync', String(started));
    const msg = (added || fu ? [added ? plural(added, 'quote') : '', fu ? `${fu} follow-up${fu > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') : 'No new RFQs') + (skipped ? ` · ${skipped} skipped` : '');
    if (manual || added || fu) toast((added || fu ? '💲 ' : '✓ ') + msg, 2600);
    qbRefreshBoard(); renderSidebar();
    return { status: 'ok', added, followups: fu, skipped, checked: msgs.length };
  } catch (err) {
    QSync.err = err.short || 'Couldn’t check email'; const full = err.userMessage || err.message || String(err);
    if (manual) toast('⚠︎ ' + full, 6000);
    if (manual && err.needsSignIn) setTimeout(() => qbEmailSettings({ signIn: true }), 300);
    return { status: 'error', error: full };
  } finally { QSync.running = false; qbSpin(false); qbSyncStatus(); }
}
$('#qbRefresh').onclick = () => syncNow({ manual: true });
function qbAutoSync() { const p = activeProvider(); if (!p || !p.status().signedIn || qbSealed() || document.hidden) return; if (Date.now() - qbLastSync() > 4.5 * 60000) syncNow({}); }
QSync.every = 5 * 60000; QSync.timer = setInterval(qbAutoSync, QSync.every);
document.addEventListener('visibilitychange', () => { if (!document.hidden) qbAutoSync(); });
/* ---------- Grok classification (only when the user's AI key is on) + the Skipped list ---------- */
async function grokClassify(list) {
  const out = new Map(), c = aiCfg(); if (!c.on || !c.key || !list.length) return out;
  for (let i = 0; i < list.length; i += 15) {
    const chunk = list.slice(i, i + 15);
    try {
      const o = await aiJSON([{ role: 'system', content: 'TASK: rfq_classify\nFor each email decide if it is a customer or prospect asking US to provide a price quote (an RFQ / request for quotation / pricing request), including follow-ups to such a request. Newsletters, marketing, supplier quotes sent to us for our own purchases, invoices, and automated mail are NOT. Return ONLY JSON: {"results":[{"i":number,"rfq":boolean,"reason":string (max 8 words)}]}' },
        { role: 'user', content: chunk.map((m, k) => `#${k}\nFrom: ${typeof m.from === 'object' ? (m.from.name || '') + ' <' + (m.from.address || '') + '>' : m.from}\nSubject: ${m.subject || ''}\n${String(m.text || '').slice(0, 1200)}`).join('\n\n---\n\n') }]);
      for (const r of (o && o.results) || []) if (chunk[r.i]) out.set(chunk[r.i], { rfq: r.rfq !== false, reason: String(r.reason || '').slice(0, 80) });
    } catch (err) { console.warn('Grok RFQ classification failed — keeping keyword matches', err); }
  }
  return out;
}
const qbSkipped = () => { try { return JSON.parse(localStorage.getItem('qbSkipped') || '[]'); } catch (_) { return []; } };
function qbSkip(m, reason) {
  const list = qbSkipped(), key = m.messageId || (m.subject + '|' + m.date); if (list.some(x => x.key === key)) return;
  list.unshift({ key, reason, subject: m.subject || '', from: typeof m.from === 'object' ? m.from : parseAddr(m.from), date: m.date || null, messageId: m.messageId || '', conversationId: m.conversationId || '', webLink: m.webLink || '', attachments: m.attachments || [], text: String(m.text || '').slice(0, 3000), at: Date.now() });
  localStorage.setItem('qbSkipped', JSON.stringify(list.slice(0, 40)));
}
function qbSkippedSheet() {
  if (qbSealed()) return toast('🔒 Unlock the Quote Board first');
  const list = qbSkipped(), w = modalWrap('qbSkipWrap');
  w.innerHTML = `<div class="sheet qb-edit" role="dialog" aria-modal="true" aria-label="Skipped emails"><h3>🙈 Skipped emails</h3><p class="fine">Emails the sync looked at but didn’t turn into quotes. Add any it got wrong.</p>
    ${list.length ? `<ul class="qb-skip">${list.map((x, i) => `<li><div><b>${esc(x.subject || '(no subject)')}</b><small>${esc((x.from && (x.from.name || x.from.address)) || '')}${x.date ? ' · ' + esc(new Date(x.date).toLocaleDateString([], { month: 'short', day: 'numeric' })) : ''} · ${esc(x.reason)}</small></div><button class="btn" data-sk="${i}">＋ Quote</button><button class="btn" data-ski="${i}" title="Add to the Inbox instead">📥 Inbox</button></li>`).join('')}</ul>` : '<p class="fine">Nothing skipped.</p>'}
    <div class="sheet-actions">${list.length ? '<button class="btn danger" data-sk="clear">Clear list</button>' : ''}<div class="spacer"></div><button class="btn primary" data-sk="x">Done</button></div></div>`;
  w.hidden = false;
  w.onclick = async e => { if (e.target === w) { w.hidden = true; return; }
    const bi = e.target.closest('[data-ski]'); if (bi) { const x = list[+bi.dataset.ski]; localStorage.setItem('qbSkipped', JSON.stringify(list.filter((_, j) => j !== +bi.dataset.ski))); w.hidden = true; await inFromSync(x, { force: true, open: true }); return; }
    const b = e.target.closest('[data-sk]'); if (!b) return; const k = b.dataset.sk;
    if (k === 'x') { w.hidden = true; return; } if (k === 'clear') { localStorage.removeItem('qbSkipped'); w.hidden = true; toast('Skipped list cleared'); return; }
    const x = list[+k]; const r = await addQuoteFromEmail(x, { source: 'skipped' }); localStorage.setItem('qbSkipped', JSON.stringify(list.filter((_, j) => j !== +k)));
    w.hidden = true; qbOpen(true, { quiet: true, mode: 'quotes' }); if (r.card) boardFlash(QPI, r.card.id); toast(r.status === 'new' ? '💲 Added from Skipped' : r.status === 'followup' ? '↩︎ Added as a follow-up' : 'Already on the Quote Board'); };
}
function qbEmailSettings(opt = {}) {
  const p = activeProvider();
  if (p && p.settings) return p.settings(opt);
  actionSheet('Email sync', [{ label: 'Work email (Microsoft 365 / Exchange) — loading…', fn: () => setTimeout(() => qbEmailSettings(opt), 400) }]);
}

/* ======================= startup (after notes have loaded from IndexedDB) ======================= */
const whenAppReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 40); };
setDrawerBoard(QB.mode, { render: false });
whenAppReady(() => {
  try { ensureIdeaNote(); } catch (e) { console.warn(e); }
  if (localStorage.getItem('qbOpen') === '1') qbOpen(true, { quiet: true }); else qbBadge();
  renderSidebar(); qbSyncStatus();
  setTimeout(qbAutoSync, 2500);
});
window.QuoteBoard = { qbBadge, setDrawerBoard, ensureIdeaNote, ideaNote, BOARDS, dbMenu, whenAppReady, isRFQ, extractQuote, addQuoteFromEmail, addManualQuote, findQuoteMatch, quoteNote, ensureQuoteNote, qbOpen, qbRender, syncNow, QSync, registerQuoteProvider, activeProvider, emailFromSnap, intakeSnapToQuotes, qbEdit, money, QB, grokClassify, qbSkipped, qbSkippedSheet };
{ const _ss2 = setSidebar; setSidebar = function (open, ...a) { if (open && QB.open && qbW() >= 0.99) qbOpen(false); return _ss2.call(this, open, ...a); }; }
