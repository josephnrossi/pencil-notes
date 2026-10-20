/* Pencil Notes v15 — built-in (offline, no account) email assistant engine.
   parseEml · htmlToText · cleanEmail (quotes, signatures) · parseDates · extract(summary, key points, action items, deadlines, meetings). */
const AssistEngine = (() => {
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const STOP = new Set('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they me him her us them my your our their re fw fwd hi hello hey dear please thanks thank regards just also so do does did have has had will would can could should may might not no yes up out about into over than then there here what when where who how all any some more most very really get got let know new'.split(' '));

  /* ---------- MIME ---------- */
  function decodeBytes(bytes, cs) { try { return new TextDecoder((cs || 'utf-8').toLowerCase().replace(/^(us-ascii|ascii)$/, 'utf-8')).decode(bytes); } catch (_) { return new TextDecoder('utf-8').decode(bytes); } }
  const strBytes = s => Uint8Array.from(s, c => c.charCodeAt(0) & 255);
  function qpDecode(s, cs) {
    s = s.replace(/=\r?\n/g, '');
    const out = []; for (let i = 0; i < s.length; i++) { if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else { const c = s.charCodeAt(i); if (c < 128) out.push(c); else out.push(...new TextEncoder().encode(s[i])); } }
    return decodeBytes(new Uint8Array(out), cs);
  }
  function b64Decode(s, cs) { try { return decodeBytes(strBytes(atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))), cs); } catch (_) { return s; } }
  const encWords = s => String(s || '').replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs, e, t) => e.toUpperCase() === 'B' ? b64Decode(t, cs) : qpDecode(t.replace(/_/g, ' '), cs));
  function parseHeaders(block) {
    const h = {}; block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(l => { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) { const k = m[1].toLowerCase(); if (!(k in h)) h[k] = m[2]; } }); return h;
  }
  const param = (v, k) => { const m = String(v || '').match(new RegExp(k + '\\s*=\\s*("([^"]*)"|[^;\\s]+)', 'i')); return m ? (m[2] ?? m[1]) : ''; };
  function parsePart(raw) {
    const i = raw.search(/\r?\n\r?\n/), head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
    const h = parseHeaders(head), ct = (h['content-type'] || 'text/plain').toLowerCase(), cte = (h['content-transfer-encoding'] || '').toLowerCase(), cs = param(h['content-type'], 'charset') || 'utf-8';
    if (ct.startsWith('multipart/')) {
      const b = param(h['content-type'], 'boundary'); if (!b) return { h, text: body };
      const parts = body.split(new RegExp('\\r?\\n?--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?\\s*\\r?\\n?')).filter(p => p.trim() && !/^--\s*$/.test(p.trim()));
      const sub = parts.map(parsePart), plain = sub.find(p => p.type === 'text/plain' && p.text.trim()), html = sub.find(p => p.type === 'text/html'), alt = sub.find(p => p.text && p.text.trim());
      return { h, type: ct.split(';')[0], text: plain ? plain.text : html ? htmlToText(html.text) : alt ? alt.text : '' };
    }
    let text = cte === 'base64' ? b64Decode(body, cs) : cte === 'quoted-printable' ? qpDecode(body, cs) : (/[\u0080-\u00ff]/.test(body) ? decodeBytes(strBytes(body), cs) : body);
    return { h, type: ct.split(';')[0], text: ct.startsWith('text/html') ? text : text };
  }
  function parseEml(raw) {
    raw = String(raw).replace(/^\uFEFF/, '');
    const p = parsePart(raw), h = p.h;
    const text = p.type === 'text/html' ? htmlToText(p.text) : p.text;
    return { from: encWords(h.from || ''), to: encWords(h.to || ''), subject: encWords(h.subject || ''), date: h.date ? new Date(h.date) : null, text };
  }

  /* ---------- HTML → text ---------- */
  function htmlToText(html) {
    html = String(html || '');
    if (typeof DOMParser !== 'undefined') {
      const d = new DOMParser().parseFromString(html, 'text/html');
      d.querySelectorAll('script, style, head, title, meta').forEach(e => e.remove());
      d.querySelectorAll('blockquote, .gmail_quote, #appendonsend, [type="cite"]').forEach(e => { e.replaceWith(d.createTextNode('\n[[QUOTE]]\n')); });
      d.querySelectorAll('li').forEach(e => e.prepend(d.createTextNode('\n• ')));
      d.querySelectorAll('br').forEach(e => e.replaceWith(d.createTextNode('\n')));
      d.querySelectorAll('p, div, tr, h1, h2, h3, h4, h5, h6, ul, ol, table, section, article').forEach(e => { e.prepend(d.createTextNode('\n')); e.append(d.createTextNode('\n')); });
      d.querySelectorAll('td, th').forEach(e => e.append(d.createTextNode(' ')));
      return (d.body ? d.body.textContent : d.documentElement.textContent).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n[[QUOTE]]\n').replace(/<li[^>]*>/gi, '\n• ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|ul|ol)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- pasted / dropped text: pick up a header block (From:/Subject:/Date:) Mail puts on top when copying ---------- */
  function splitHeaderBlock(text) {
    const lines = String(text).replace(/\r/g, '').split('\n'), h = {}; let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    let seen = 0;
    for (; i < lines.length; i++) { const m = lines[i].match(/^(From|To|Cc|Bcc|Subject|Date|Sent|Reply-To):\s*(.*)$/i); if (!m) break; h[m[1].toLowerCase()] = m[2].trim(); seen++; }
    if (seen < 2) return { h: {}, body: String(text) };
    return { h, body: lines.slice(i).join('\n') };
  }

  /* ---------- cleaning ---------- */
  function cleanEmail(text) {
    let t = String(text || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/[\u200b\u200c\u200d\ufeff]/g, '');
    const cut = re => { const m = t.match(re); if (m && m.index > 0) t = t.slice(0, m.index); };
    cut(/\n\[\[QUOTE\]\]/);
    cut(/\n\s*On [^\n]{6,160}\n?[^\n]{0,80}wrote:\s*\n/);
    cut(/\n\s*Le [^\n]{6,120}a écrit\s*:/);
    cut(/\n-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i);
    cut(/\n_{8,}\s*\n/);
    cut(/\n\s*From:\s[^\n]+\n\s*(Sent|Date):\s[^\n]+/i);
    cut(/\n--\s*\n/);
    cut(/\n\s*(Sent from my (iPhone|iPad|Android|mobile)|Get Outlook for (iOS|Android))[^\n]*/i);
    cut(/\n\s*(CONFIDENTIALITY NOTICE|This (e-?mail|message) (and any attachments )?(is|may be) confidential|DISCLAIMER)/i);
    t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
    // sign-off: "Thanks,\nJane" near the end
    const lines = t.split('\n'); let greet = '';
    for (let i = 0; i < Math.min(3, lines.length); i++) { const m = lines[i].match(/^\s*(hi|hello|hey|dear|good (morning|afternoon|evening)|hiya|yo)\b[ ,]*([A-Z][\w'-]*(?:\s+(?:and|&)\s+[A-Z][\w'-]*)?)?\s*[,!:]?\s*$/i); if (m) { greet = (m[3] || '').trim(); lines.splice(i, 1); break; } if (lines[i].trim()) break; }
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
      if (/^\s*(thanks( so much| again| in advance)?|thank you|many thanks|best( regards| wishes)?|kind regards|warm regards|regards|cheers|sincerely|talk soon|speak soon|all the best|thx|ty|xo+|love|-\s*\w+)\s*[,!.]?\s*$/i.test(lines[i]) || /^\s*[—–-]{1,2}\s*\S.{0,40}$/.test(lines[i])) { lines.length = i; break; }
    }
    return { body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), greet };
  }

  /* ---------- dates ---------- */
  const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayIdx = s => DAYS.indexOf(s.slice(0, 3).toLowerCase());
  const monIdx = s => MONTHS.indexOf(s.slice(0, 3).toLowerCase());
  const WD = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
  const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const TIME = '(?:at\\s+|@\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?';
  function parseTime(s) {
    const m = s.match(/\b(noon|midday|midnight)\b/i); if (m) return { h: m[1].toLowerCase() === 'midnight' ? 0 : 12, m: 0, i: m.index, len: m[0].length };
    const re = /(?:\b(?:at|@|by|from|before|after|until|till)\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?:\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?|\b(\d{1,2}):(\d{2})\b(?:\s*(?:-|–|to)\s*(\d{1,2}):(\d{2}))?/gi;
    let r;
    while ((r = re.exec(s))) {
      if (r[1]) { let h = +r[1]; const ap = r[3][0].toLowerCase(); if (h > 12) continue; if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
        let end = null; if (r[4]) { let eh = +r[4]; const eap = (r[6] || r[3])[0].toLowerCase(); if (eap === 'p' && eh < 12) eh += 12; end = { h: eh, m: +(r[5] || 0) }; if (!r[6] && end.h < h) end.h += 12; }
        return { h, m: +(r[2] || 0), end, i: r.index, len: r[0].length };
      }
      if (r[7]) { const h = +r[7], mm = +r[8]; if (h > 23 || mm > 59) continue; const end = r[9] ? { h: +r[9], m: +r[10] } : null; let hh = h; if (h >= 1 && h <= 6 && !/\b\d{1,2}:\d{2}\s*(am|a\.m\.)/i.test(s)) hh = h + 12; return { h: hh, m: mm, end: end && { h: end.h < hh && end.h <= 12 ? end.h + 12 : end.h, m: end.m }, i: r.index, len: r[0].length }; }
    }
    return null;
  }
  // find date expressions in a sentence relative to `ref` (the email's date)
  function parseDates(s, ref = new Date()) {
    const out = [], R = new Date(ref), push = (d, m, kind, opts = {}) => out.push({ date: d, i: m.index, len: m[0].length, text: m[0].trim(), kind, ...opts });
    const low = s;
    let m;
    const rx = (src, f) => { const re = new RegExp(src, 'gi'); let r; while ((r = re.exec(low))) f(r); };
    rx('\\b(?:by\\s+|before\\s+|until\\s+)?(?:the\\s+)?(end of (?:the )?day|EOD|COB|close of business|end of business|EOB)\\b(?:\\s+(?:on\\s+)?' + WD + ')?', r => { let d = R; if (r[2]) d = nextWeekday(R, dayIdx(r[2]), false); push(at(d, 17), r, 'eod', { time: true }); });
    rx('\\b(?:by\\s+|before\\s+)?(?:the\\s+)?(end of (?:the |this )?week|EOW)\\b', r => push(at(nextWeekday(R, 5, false), 17), r, 'eow', { time: true }));
    rx('\\b(?:by\\s+|before\\s+)?(?:the\\s+)?(end of (?:the |this )?month|EOM)\\b', r => push(at(new Date(R.getFullYear(), R.getMonth() + 1, 0), 17), r, 'eom', { time: true }));
    rx('\\b(?:by\\s+|before\\s+)?(?:the\\s+)?end of next week\\b', r => push(at(addDays(nextWeekday(R, 5, false), 7), 17), r, 'eow', { time: true }));
    rx('\\b(today|tonight|this (?:morning|afternoon|evening))\\b', r => { const w = r[1].toLowerCase(); push(at(R, w === 'tonight' || w.endsWith('evening') ? 19 : w.endsWith('morning') ? 9 : w.endsWith('afternoon') ? 14 : 9), r, 'day', { time: w !== 'today' }); });
    rx('\\b(?:the\\s+)?day after tomorrow\\b', r => push(at(addDays(R, 2), 9), r, 'day'));
    rx('\\btomorrow(?:\\s+(morning|afternoon|evening|night))?\\b', r => { if (/after\s+$/i.test(low.slice(0, r.index))) return; const w = (r[1] || '').toLowerCase(); push(at(addDays(R, 1), w === 'morning' ? 9 : w === 'afternoon' ? 14 : w ? 19 : 9), r, 'day', { time: !!w }); });
    rx('\\b(?:(next|this|coming|on)\\s+)?' + WD + '\\b(?:,?\\s+' + MON + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?)?', r => { if (r[3]) return; const d = nextWeekday(R, dayIdx(r[2]), (r[1] || '').toLowerCase() === 'next'); push(at(d, 9), r, 'wd'); });
    rx('\\bnext week\\b', r => { if (/end of\s+$/i.test(low.slice(0, r.index))) return; push(at(addDays(nextWeekday(R, 1, false), dayIdx('mon') === R.getDay() ? 7 : 0), 9), r, 'week'); });
    rx('\\b(?:in|within)\\s+(\\d+|a|an|one|two|three|four|five|a couple of)\\s+(day|week|business day|working day)s?\\b', r => { const n = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, 'a couple of': 2 }[r[1].toLowerCase()] || +r[1]; push(at(addDays(R, /week/i.test(r[2]) ? n * 7 : /business|working/i.test(r[2]) ? Math.ceil(n * 7 / 5) : n), 9), r, 'rel'); });
    rx('\\b(?:' + WD + ',?\\s+)?' + MON + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', r => { const d = mkDate(R, monIdx(r[2]), +r[3], r[4]); if (d) push(d, r, 'abs'); });
    rx('\\b(?:' + WD + ',?\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON + '\\.?(?:,?\\s+(\\d{4}))?\\b', r => { const d = mkDate(R, monIdx(r[3]), +r[2], r[4]); if (d) push(d, r, 'abs'); });
    rx('\\b(\\d{4})-(\\d{2})-(\\d{2})\\b', r => push(new Date(+r[1], +r[2] - 1, +r[3], 9), r, 'abs'));
    rx('(?<![\\d/$#])\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b(?![\\d/%])', r => { const a = +r[1], b = +r[2]; if (a < 1 || a > 12 || b < 1 || b > 31) return; const y = r[3] ? (+r[3] < 100 ? 2000 + +r[3] : +r[3]) : null; const d = mkDate(R, a - 1, b, y); if (d) push(d, r, 'abs'); });
    // de-overlap (prefer longer), attach times
    out.sort((a, b) => b.len - a.len);
    const keep = []; for (const o of out) if (!keep.some(k => o.i < k.i + k.len && k.i < o.i + o.len)) keep.push(o);
    keep.sort((a, b) => a.i - b.i);
    const tm = parseTime(s);
    if (tm) {
      const near = keep.length ? keep.reduce((b, o) => Math.abs(o.i - tm.i) < Math.abs(b.i - tm.i) ? o : b) : null;
      if (near && !near.time && Math.abs(near.i - tm.i) < 60) { near.date = at(near.date, tm.h, tm.m); near.time = true; if (tm.end) near.end = at(near.date, tm.end.h, tm.end.m); near.text = s.slice(Math.min(near.i, tm.i), Math.max(near.i + near.len, tm.i + tm.len)).trim(); }
      else if (!keep.length) { let d = at(R, tm.h, tm.m); if (d < R) d = addDays(d, 1); keep.push({ date: d, i: tm.i, len: tm.len, text: s.substr(tm.i, tm.len).trim(), kind: 'time', time: true, end: tm.end ? at(d, tm.end.h, tm.end.m) : null }); }
    }
    for (const k of keep) if (!k.time && /\b(by|before|due|deadline|until|no later than)\s+(on\s+)?(the\s+)?$/i.test(s.slice(Math.max(0, k.i - 24), k.i) + (k.text.match(/^(by|before)\s/i) ? k.text.slice(0, 3) : ''))) k.date = at(k.date, 17);
    for (const k of keep) if (!k.time && /^(by|before)\s/i.test(k.text)) k.date = at(k.date, 17);
    return keep;
  }
  function nextWeekday(ref, wd, next) {
    const d = new Date(ref); d.setHours(0, 0, 0, 0); const cur = d.getDay();
    if (next) { const mon = addDays(d, ((8 - cur) % 7) || 7); return addDays(mon, (wd + 6) % 7); }    // the given day in next calendar week (Mon–Sun)
    return addDays(d, ((wd - cur + 7) % 7) || 7);     // same weekday → next week (people say "today" for today)
  }
  function mkDate(ref, mon, day, year) {
    if (mon < 0 || day < 1 || day > 31) return null;
    let d = new Date(year ? +year : ref.getFullYear(), mon, day, 9);
    if (!year && d < addDays(ref, -45)) d = new Date(ref.getFullYear() + 1, mon, day, 9);
    return d;
  }

  /* ---------- sentences ---------- */
  const BULLET = /^\s*(?:[-*•‣◦▪●]|\d{1,2}[.)]|\(?[a-z]\))\s+/;
  function units(body) {   // sentences and bullet lines, with paragraph index & heading context
    const out = []; let para = 0, heading = '';
    for (const block of body.split(/\n\s*\n/)) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean); if (!lines.length) continue;
      let buf = [];
      if (lines.length === 1 && !/[.!?:,;]$/.test(lines[0]) && lines[0].split(/\s+/).length <= 8 && !BULLET.test(lines[0]) && !/\?/.test(lines[0]) && out.length === 0) { heading = ''; para++; continue; }   // a title line
      const flush = () => { if (!buf.length) return; const txt = buf.join(' ').replace(/\s+/g, ' '); for (const s of splitSentences(txt)) out.push({ text: s, para, bullet: false, heading }); buf = []; };
      for (const l of lines) {
        if (BULLET.test(l)) { flush(); out.push({ text: l.replace(BULLET, '').trim(), para, bullet: true, heading }); continue; }
        if (/^[A-Z][^.!?]{1,40}:$/.test(l) || /^(action items?|next steps|to-?dos?|todo|tasks|follow[- ]ups?|deadlines?|agenda|key points|summary|highlights|updates?|asks?)\s*:?\s*$/i.test(l)) { flush(); heading = l.replace(/:$/, '').toLowerCase(); continue; }
        buf.push(l);
      }
      flush(); para++;
      if (!/^(action|next|to-?do|task|follow)/.test(heading)) heading = heading && lines.every(l => BULLET.test(l)) ? heading : '';
    }
    return out.filter(u => u.text.length > 2);
  }
  function splitSentences(t) {
    const prot = t.replace(/\b(Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Co|vs|etc|e\.g|i\.e|approx|no|St|Jr|Sr)\.\s/gi, m => m.replace('. ', '.\u0001'));
    return prot.split(/(?<=[.])\s+(?=["“(]?[A-Z0-9@])|(?<=[!?])\s+(?=\S)/).map(s => s.replace(/\u0001/g, ' ').trim()).filter(Boolean);
  }
  const words = s => (s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []);
  const content = s => words(s).filter(w => !STOP.has(w) && w.length > 2);

  /* ---------- classification ---------- */
  const PLEASANTRY = /^(i )?hope (you|this|all|your|everyone)|^(thanks|thank you)( so much)?( for| again|!|\.|,)|^(please )?(let (me|us) know|feel free|don'?t hesitate)( to reach out)?( if| should)( you)? (have|need) (any )?(questions?|anything|help)|^(happy|have a (great|good|nice))|^(sorry for|apologies for) the (delay|late)|^(looking forward|talk soon|see you)|^please (find|see) (attached|below|enclosed)|^(as always|cheers)|^(just )?(a )?(quick )?(note|heads[- ]up)( that)?:?$/i;
  const IMPERATIVE = /^(please\s+)?(send|share|review|confirm|approve|sign|submit|book|schedule|update|prepare|reply|respond|complete|fill( out| in)?|check|call|email|forward|rsvp|register|pay|finali[sz]e|draft|create|add|remove|fix|upload|download|read|join|attend|bring|pick up|order|buy|set up|follow up|reach out|ping|loop in|sync|send over|look (at|into|over)|go over|make sure|ensure|remember|don'?t forget|let (me|us) know|get back|circle back|provide|write|organi[sz]e|plan|invite|cancel|move|reschedule|renew|print|collect|grab|clean|tell|ask|text|test|deploy|merge|ship|publish|post|announce|coordinate|arrange|decide|choose|pick|vote|note|keep|start|stop|finish|hand in|turn in|file|log|track|investigate|escalate|remind|nudge|chase|contact|talk to|discuss|research|find|figure out|look up|notify|inform|verify|validate|approve)\b/i;
  const REQUEST = /\b(please|pls|kindly)\b|\b(can|could|would|will) (you|u|someone|anyone|y'?all)\b|\bwould you mind\b|\b(i|we)('d| would) (like|appreciate|love)( it)?( if)? (you|for you)\b|\bi need you to\b|\b(you|u) (need|have|must|should|will need) to\b|\b(need|needs) (you|someone) to\b|\bmake sure\b|\bdon'?t forget\b|\bremember to\b|\baction (required|needed|item)\b|\b(let me|let us|lmk) know\b|\bplease advise\b|\bawaiting your\b|\bwaiting (on|for) you\b|\bget back to me\b|\bmust be (submitted|completed|returned|paid|signed)\b|\brsvp\b/i;
  const COMMIT = /^(i'?ll|i will|i'?m going to|i am going to|i can|we'?ll|we will|i'?ll be)\b/i;
  const TEAM = /^(we|everyone|all|team|everybody|the team)\b.*\b(need|needs|must|should|have) to\b/i;
  const NOT_ACTION = /^please (find|see) (attached|below|enclosed)|let me know if you have any (other )?questions|feel free to|don'?t hesitate|if you have any questions|hope (you|this)|thanks? (you )?(for|again)|^(fyi|for your information)\b/i;
  const MEETING = /\b(meeting|meet|call|sync|stand-?up|1:1|one-on-one|kick-?off|demo|interview|lunch|dinner|coffee|catch[- ]up|webinar|workshop|review session|offsite|appointment|zoom|teams call|hangout|retro|planning session|all-hands|town hall|session|walkthrough|presentation)\b/i;

  function ownerOf(u, ctx) {
    const s = u.text;
    let m = s.match(/^@?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[:–-]\s+/); if (m && !/^(Note|Re|Fw|Fwd|Update|Reminder|Action|Deadline|Subject|Date|Time|Where|When|Location|Agenda|Next|Important|Also|PS)$/i.test(m[1])) return m[1];
    m = s.match(/@([A-Z]?[a-z]+)/); if (m) return m[1][0].toUpperCase() + m[1].slice(1);
    m = s.match(/^([A-Z][a-z]+)(?:,| and [A-Z][a-z]+,?)? (?:can|could|will|would|should|needs to|to|please)\b/); if (m && !/^(Please|We|You|They|It|This|That|Can|Could|Would|Will|Let|Also|Just|Then|And|But|So)$/.test(m[1])) return m[1];
    m = s.match(/^([A-Z][a-z]+),\s+(can|could|would|please|will)/); if (m) return m[1];
    if (COMMIT.test(s)) return ctx.senderFirst || 'Sender';
    if (TEAM.test(s)) return 'Team';
    return 'You';
  }
  function cleanAction(s) {
    let t = s.replace(/^(also|and|so|then|but|ok(ay)?|oh|btw|one more thing|quick (ask|request)|reminder|just a (quick )?reminder|friendly reminder|action (required|needed|item)|important|urgent|asap|ps|p\.s\.)\s*[:,–-]*\s*/i, '');
    t = t.replace(/^@?[A-Z][a-z]+(\s[A-Z][a-z]+)?\s*[:–-]\s+/, '');
    t = t.replace(/^(?:for|on|about|re|regarding|as for|with)\b[^,]{2,40},\s+(?=(?:can|could|would|will) (?:you|u)\b)/i, '');
    t = t.replace(/^(?:hey |hi )?(?:[A-Z][a-z]+,\s+)?(?:can|could|would|will) (?:you|u)(?: please)?(?: also)?\s+/i, '').replace(/^would you mind\s+/i, '').replace(/^(i|we)('d| would) (really )?(like|appreciate|love)( it)?( if)? (you|for you) (to )?(could )?/i, '').replace(/^i need you to\s+/i, '').replace(/^(you|u) (need|have|must|should|will need) to\s+/i, '')
      .replace(/^(please|pls|kindly)\s+/i, '').replace(/^(make sure|remember|don'?t forget) (to|that you)\s+/i, (m0, a) => /make sure/i.test(a) ? 'Make sure to ' : '').replace(/^(just|also)\s+/i, '').replace(/,?\s*(please|thanks|thank you|thx)[.!]*\s*$/i, '');
    t = t.replace(/\?+\s*$/, '').replace(/[.!]+$/, '').trim();
    if (t.length > 140) t = t.slice(0, 137).replace(/\s\S*$/, '') + '…';
    return t ? t[0].toUpperCase() + t.slice(1) : s;
  }
  const defill = s => s.replace(/^(also|and|oh|ps|p\.s\.|btw|plus|then)[,:]?\s+/i, '');
  function isAction(u) {
    const s = defill(u.text);
    if (NOT_ACTION.test(s) && !/\bby\b|\bbefore\b|\bdue\b/.test(s.replace(NOT_ACTION, ''))) return false;
    if (PLEASANTRY.test(s)) return false;
    if (/^(action|next|to-?do|task|follow)/.test(u.heading)) return true;
    if (u.bullet && (IMPERATIVE.test(s) || /^@?[A-Z][a-z]+\s*[:–-]\s+\w/.test(s))) return true;
    if (IMPERATIVE.test(s) && !/\?$/.test(s) && words(s).length > 1) return true;
    if (REQUEST.test(s)) return !/^(i|we) (just )?(wanted|want) to (let you know|share|give you|update)/i.test(s);
    if (/\?\s*$/.test(s) && /\b(you|your|u)\b/i.test(s) && !/^(how are|how'?s|how have|did you (have|enjoy)|hope)/i.test(s)) return true;
    if (COMMIT.test(s) && /\b(send|share|follow up|get back|update|prepare|draft|book|schedule|review|circle back|ping|look into|set up|reach out|call|email|fix|finish|have)\b/i.test(s)) return true;
    if (TEAM.test(s)) return true;
    return false;
  }

  /* ---------- main ---------- */
  function extract(input) {
    const ref = input.date && !isNaN(input.date) ? new Date(input.date) : new Date();
    const { body, greet } = cleanEmail(input.text || '');
    const subject = (input.subject || '').replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
    const senderName = String(input.from || '').replace(/<[^>]*>/, '').replace(/["']/g, '').trim() || String(input.from || '').split('@')[0];
    const ctx = { senderFirst: (senderName.split(/[\s,]+/)[0] || '').replace(/^\w/, c => c.toUpperCase()), reader: greet };
    const us = units(body);
    const subjW = new Set(content(subject)), freq = {};
    us.forEach(u => content(u.text).forEach(w => freq[w] = (freq[w] || 0) + 1));
    const KEY = /\b(deadline|due|decid|agreed|approv|launch|release|budget|priority|urgent|important|delay|blocked|risk|change|moved|postpon|cancel|confirmed|update|result|revenue|contract|invoice|offer|plan|proposal|schedule|meeting|issue|problem|fix|signed|hired|ship|goal|milestone|q[1-4]|\$\d|\d+%)/i;
    const P = input.prefs || {}, low = x => String(x || '').toLowerCase().trim();
    const notAct = (P.notAction || []).map(low).filter(Boolean), actPh = (P.actionPhrases || []).map(low).filter(Boolean), me = low(P.me);
    us.forEach((u, i) => {
      const w = content(u.text), n = words(u.text).length;
      let sc = 0;
      if (u.para === 0) sc += 1.6; if (i === 0) sc += 1.4; else if (i === 1) sc += 0.6;
      sc += Math.max(0, 1 - i / Math.max(4, us.length)) * 0.8;
      if (subjW.size) sc += 4 * w.filter(x => subjW.has(x)).length / Math.max(3, subjW.size);
      sc += (u.text.match(new RegExp(KEY.source, 'gi')) || []).length * 0.6;
      sc += w.reduce((a, x) => a + Math.min(3, freq[x] - 1) * 0.12, 0) / Math.max(1, Math.sqrt(w.length));
      if (parseDates(u.text, ref).length) sc += 0.5;
      if (/\d/.test(u.text)) sc += 0.2;
      if (n < 5) sc -= 1.2; if (n > 45) sc -= 1;
      if (PLEASANTRY.test(u.text) || NOT_ACTION.test(u.text) && n < 14) sc -= 4;
      if (/\?$/.test(u.text)) sc -= 0.5;
      u.score = sc; u.i = i; u.action = isAction(u); u.dates = parseDates(u.text, ref);
      const lt = low(defill(u.text)).replace(/^[-•*]\s*/, '');
      if (u.action && notAct.some(p => lt.startsWith(p))) { u.action = false; u.learned = 'not'; }
      else if (!u.action && actPh.some(p => lt.includes(p))) { u.action = true; u.learned = 'act'; }
    });
    us.forEach((u, i) => {
      if (u.dates.length && u.dates.every(d => d.kind === 'time')) {
        const prev = us.slice(Math.max(0, i - 2), i).reverse().find(p => p.para === u.para && p.dates.some(d => d.kind !== 'time'));
        if (prev) { const pd = prev.dates.find(d => d.kind !== 'time').date, t = u.dates[0]; const nd = new Date(pd); nd.setHours(t.date.getHours(), t.date.getMinutes(), 0, 0); const ne = t.end ? new Date(nd.getTime() + (t.end - t.date)) : null; u.dates = [{ ...t, date: nd, end: ne, kind: 'abs', time: true }]; }
      }
    });
    us.forEach((u, i) => {
      if (!u.action || u.dates.length) return;
      const near = us.filter(p => p !== u && Math.abs(p.para - u.para) <= 1 && Math.abs(p.i - i) <= 2 && !p.action && /\b(due|deadline|by|before|no later than)\b/i.test(p.text) && p.dates.length);
      if (near.length) u.dates = [{ ...near[0].dates[0], inherited: true }];
    });
    // a learned default due time replaces the built-in 5 PM / 9 AM for date-only deadlines
    function prefTime(d) { if (!P.dueTime || d.time || d.kind === 'time') return d.date; const x = new Date(d.date); if (x.getHours() === 17 || x.getHours() === 9) x.setHours(P.dueTime.h, P.dueTime.m || 0, 0, 0); return x; }
    // action items
    const actions = [];
    for (const u of us.filter(u => u.action)) {
      const d = u.dates.find(x => x.kind !== 'time' || u.dates.length === 1) || u.dates[0];
      const text = cleanAction(u.text); if (text.length < 3) continue;
      if (actions.some(a => a.text.toLowerCase() === text.toLowerCase())) continue;
      let owner = ownerOf(u, ctx); if (me && low(owner) === me) owner = 'You';
      actions.push({ text, owner, due: d ? prefTime(d).toISOString() : null, dueText: d ? d.text : '', src: u.text, ...(u.learned ? { learned: u.learned } : {}) });
    }
    // meetings
    const meetings = [];
    for (const u of us) {
      if (!MEETING.test(u.text) || !u.dates.length) continue;
      const d = u.dates.find(x => x.time) || u.dates.find(x => ['abs', 'wd'].includes(x.kind)); if (!d) continue;
      if (meetings.some(m => m.start === d.date.toISOString())) continue;
      const where = (u.text.match(/\b(?:in|at)\s+((?:room|conference room|the)\s+[\w-]+(?:\s[\w-]+)?|[A-Z][\w-]*(?:\s[A-Z0-9][\w-]*){0,2}\s+(?:room|office|cafe|café|hall))\b/i) || u.text.match(/https?:\/\/\S*(zoom|meet\.google|teams)\S*/i) || [])[0] || '';
      const kw = (u.text.match(MEETING) || ['meeting'])[0].toLowerCase();
      let title = (u.text.match(/\b((?:[A-Z][\w&-]*|Q[1-4]|\d+:\d+)(?:\s+[A-Z][\w&-]*){0,3})\s+(meeting|call|sync|stand-?up|kick-?off|demo|review|interview|lunch|retro|workshop|session|presentation)\b/) || [])[0];
      if (subject && new RegExp('\\b' + kw.replace(/[^a-z0-9]/g, '.?'), 'i').test(subject)) title = subject;
      else if (!title || /^(On|At|By|The|Our|My|Your|Please|Let)\b/.test(title)) title = (kw === 'meet' ? 'Meeting' : kw[0].toUpperCase() + kw.slice(1)) + (subject ? ' — ' + subject : '');
      meetings.push({ title: title.slice(0, 80), start: d.date.toISOString(), end: d.end ? d.end.toISOString() : null, hasTime: !!d.time, where: where.replace(/^(in|at)\s+/i, ''), text: u.text });
    }
    // deadlines (anything with a due-ish date that isn't a meeting)
    const deadlines = [];
    for (const u of us) for (const d of u.dates) {
      if (meetings.some(m => m.text === u.text)) continue;
      if (!/\b(by|before|due|deadline|until|no later than|expires?|closes?|ends?|eod|cob|end of)\b/i.test(u.text)) continue;
      const iso = prefTime(d).toISOString(); if (deadlines.some(x => x.due === iso)) continue;
      deadlines.push({ text: cleanAction(u.text), due: iso, dueText: d.text });
    }
    // summary: top sentences in original order
    const cand = us.filter(u => !u.bullet && words(u.text).length >= 4 && !PLEASANTRY.test(u.text));
    const nSum = us.length > 9 ? 3 : us.length > 3 ? 2 : Math.min(2, cand.length);
    let summary = cand.slice().sort((a, b) => b.score - a.score).slice(0, nSum).sort((a, b) => a.i - b.i).map(u => u.text);
    if (!summary.length && us.length) summary = us.slice(0, 2).map(u => u.text);
    let sumText = summary.join(' '); if (words(sumText).length > 75) sumText = summary.slice(0, 2).join(' ');
    // key points: non-summary, non-action informative units (bullets first)
    const used = new Set(summary);
    const points = us.filter(u => !used.has(u.text) && !u.action && !PLEASANTRY.test(u.text) && words(u.text).length >= 3 && u.score > -1)
      .sort((a, b) => (b.bullet - a.bullet) || (b.score - a.score)).slice(0, 5).sort((a, b) => a.i - b.i)
      .map(u => u.text.replace(/^(also|and|so|btw|fyi|just so you know|quick update)\s*[:,–-]?\s*/i, '').replace(/^\w/, c => c.toUpperCase()));
    if (points.length < 2) for (const a of actions) if (points.length < 2 && !points.includes(a.src)) { /* keep points informative: fall back to subject facts */ }
    return { summary: sumText, points, actions, meetings, deadlines, from: senderName, subject: input.subject || '', date: input.date && !isNaN(input.date) ? new Date(input.date).toISOString() : null, words: words(body).length };
  }
  return { parseEml, htmlToText, splitHeaderBlock, cleanEmail, parseDates, extract, units };
})();
if (typeof module !== 'undefined') module.exports = AssistEngine;
