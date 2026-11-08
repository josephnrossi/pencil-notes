/* Pencil Notes v21ee (part A) — Quote sheet totals · handwriting search · Daily To-Do page · iPad polish.
   1. Quote sheet totals: every Quote sheet line reads its handwritten Qty and Price with the app's existing recognition
      path (V21e4.recognizeStrokes → on-device Handwriting API where the browser has one, else your connected Grok key via
      transcribe()). It shows “= line total” and “Total” pills as DOM overlays — never ink, never saved into strokes. It
      re-reads ~1.2 s after you stop writing, only cells whose ink changed (results cached per page by ink signature).
      Lines it can't read are flagged; tap any total to check / correct the values (corrections stick until that cell's
      ink changes). Without a recognizer (iPad Safari with no Grok key) every written cell is flagged “tap to enter”.
   2. Handwriting search: each page's handwriting is read in the background in small groups (Quote / To-Do fields one
      box at a time, other ink line by line) and cached on the page (pg.hwIdx + pg.hwc), re-read on edit. The sidebar
      search shows page results with thumbnails and the matched text; tapping one opens the page and highlights the match.
      Typed text, tasks, 🏷 labels and Quote sheet / To-Do fields all count. Locked notes are never indexed.
   3. ＋ Insert → ✅ Daily To-Do: a full page printed onto the paper (like the Quote sheet) — Date, Top 3 priorities, a task
      list of checkbox rows (＋ line / －), Notes and an optional Tomorrow box. All handwriting. Tapping a checkbox ticks
      it (overlay; included in PDF export). Saved with the page, so it survives reload, Undo and page reordering.
   4. iPad polish (see the CSS block “v21ee” in styles.css and section 4 below).
   Builds on v21ed. Mock only. */
(function () {
  'use strict';
  const Q = window.V21ed;
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const locked = n => !!(n && n.lock);
  const PAGES = $('#pages');
  const LIMIT = PAGE_H - 24;
  const stats = { calls: 0, errors: 0 };

  /* ==================== shared: recognition engine + ink helpers ==================== */
  let testRecognizer = null;
  function engine() {
    if (testRecognizer) return { name: 'test', fn: testRecognizer };
    const fn = (window.V21e4 && V21e4.recognizeStrokes) || (typeof transcribe === 'function' ? transcribe : null);
    if (!fn) return null;
    if (typeof HW !== 'undefined' && HW.state === 'ready') return { name: 'device', fn };
    try { if (typeof aiReady === 'function' && aiReady()) return { name: 'grok', fn }; } catch (_) {}
    return null;
  }
  const engineLabel = () => { const e = engine(); return !e ? '' : e.name === 'device' ? 'on-device handwriting recognition' : e.name === 'grok' ? (typeof aiModel === 'function' ? aiModel() : 'Grok') : 'test recognizer'; };
  async function recognize(strokes, context = {}) {
    const e = engine(); if (!e) throw Object.assign(new Error('no recognizer'), { none: true });
    stats.calls++;
    try { return String((await e.fn(strokes, context)) || '').replace(/\s+/g, ' ').trim(); } catch (err) { stats.errors++; throw err; }
  }
  const BB = new WeakMap();   // never write .bb onto strokes (page data must stay byte-identical)
  const sbb = s => { if (s.bb) return s.bb; let b = BB.get(s); if (!b || b.n !== s.points.length || b.p !== s.points) { b = bbox(s.points); b.n = s.points.length; b.p = s.points; BB.set(s, b); } return b; };
  const ccx = s => { const b = sbb(s); return (b[0] + b[2]) / 2; }, ccy = s => { const b = sbb(s); return (b[1] + b[3]) / 2; };
  const inR = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const tcen = t => [t.x + 4, t.y + 10];
  const inkOf = pg => (pg.strokes || []).filter(s => s.tool !== 'highlighter' && s.points && s.points.length);
  const strokesIn = (pg, r) => inkOf(pg).filter(s => inR(r, ccx(s), ccy(s)));
  const textsIn = (pg, r) => (pg.texts || []).filter(t => inR(r, ...tcen(t)));
  const sigOf = strokes => strokes.map(s => s.id + ':' + s.points.length).sort().join(',');
  const persist = n => { if (n && !n.lock) DB.put('notes', n).catch(() => {}); };
  const bbOf = strokes => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const s of strokes) { const q = sbb(s); a = Math.min(a, q[0]); b = Math.min(b, q[1]); c = Math.max(c, q[2]); d = Math.max(d, q[3]); } return [a, b, c, d]; };
  const fmtMoney = v => { try { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); } catch (_) { return '$' + v.toFixed(2); } };
  const fmtNum = v => (Math.round(v * 1000) / 1000).toLocaleString('en-US');

  /* ---------- number parsing (handwriting reads are messy) ---------- */
  function fixDigits(s) {   // common recognizer letter/digit confusions, only inside tokens that already contain a digit
    return String(s).replace(/[\w.,$/]+/g, tok => /\d/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5') : tok);
  }
  function parseQty(s) {
    if (s == null) return null; let t = fixDigits(String(s)).toLowerCase().replace(/,/g, '').trim(); if (!t) return null;
    let m = t.match(/(\d+)\s*\/\s*(\d+)/); if (m && !/\d\s*\/\s*\d+\s*(ea|pc)/.test(t) && +m[2]) return +m[1] / +m[2];
    m = t.match(/-?\d*\.?\d+/); if (!m) return null; const v = parseFloat(m[0]); return isFinite(v) ? v : null;
  }
  function parsePrice(s) {
    if (s == null) return null; let t = fixDigits(String(s)).toLowerCase().trim(); if (!t || !/\d/.test(t)) return null;
    const k = /\d\s*k\b/.test(t) ? 1000 : 1;
    t = t.replace(/^(usd|us\$|\$)\s*/, '').replace(/\s*(\/\s*)?(ea|each|pcs?|pc|per\s*\w+)\.?$/, '');
    let v = typeof parseMoneyText === 'function' ? parseMoneyText(t) : NaN;
    if (!isFinite(v)) { const m = t.replace(/,/g, '').match(/-?\d*\.?\d+/); v = m ? parseFloat(m[0]) : NaN; }
    return isFinite(v) ? v * k : null;
  }

  /* ==================== 1. Quote sheet totals ==================== */
  const QF = { qty: 2, price: 3 };
  const fixKey = (f, r, sig) => f + '|' + (sig ? 's:' + sig : 'e:' + r);
  /** One field (qty|price) of one line: typed text > correction > cached read > state. */
  function cellVal(pg, q, r, f) {
    const L = Q.qLayout(q), cell = L.rows[r][QF[f]], ink = strokesIn(pg, cell), sig = sigOf(ink), typed = textsIn(pg, cell).map(t => t.text).join(' ').trim();
    const parse = f === 'qty' ? parseQty : parsePrice, fx = q.fix && q.fix[fixKey(f, r, sig)];
    const base = { cell, sig, has: !!(ink.length || typed) };
    if (fx != null && fx !== '') return { ...base, v: parse(fx), text: String(fx), src: 'manual' };
    if (typed) { const v = parse(typed); return { ...base, v, text: typed, src: v == null ? 'unreadable' : 'typed' }; }
    if (!ink.length) return { ...base, v: null, text: '', src: 'empty' };
    const hwc = pg.hwc || {};
    if (sig in hwc) { const v = parse(hwc[sig]); return { ...base, v, text: hwc[sig], src: v == null ? 'unreadable' : 'read' }; }
    return { ...base, v: null, text: '', src: engine() ? (failed.has(sig) ? 'error' : 'pending') : 'noengine' };
  }
  const failed = new Set();
  /** Totals for one quote: lines [{r, qty, price, total, flag}], total, flagged count. */
  function quoteTotals(pg, q) {
    const lines = []; let total = 0, any = false, flagged = 0, pending = 0;
    for (let r = 0; r < q.lines; r++) {
      const qty = cellVal(pg, q, r, 'qty'), price = cellVal(pg, q, r, 'price');
      if (!qty.has && !price.has && qty.src !== 'manual' && price.src !== 'manual') { lines.push({ r, qty, price, total: null, flag: null }); continue; }
      let flag = null;
      const bad = c => c.src === 'unreadable' || c.src === 'error' || c.src === 'noengine';
      if (qty.src === 'pending' || price.src === 'pending') { flag = 'reading'; pending++; }
      else if (bad(qty) || bad(price)) flag = qty.src === 'noengine' || price.src === 'noengine' ? 'noengine' : 'unreadable';
      else if (qty.v == null) flag = 'noqty'; else if (price.v == null) flag = 'noprice';
      const t = flag ? null : qty.v * price.v;
      if (t != null) { total += t; any = true; } else if (flag !== 'reading') flagged++;
      lines.push({ r, qty, price, total: t, flag });
    }
    return { lines, total: any ? Math.round(total * 100) / 100 : null, flagged, pending };
  }
  /** Read every qty/price cell whose ink changed (one recognizer call per cell, cached by ink signature). */
  async function readTotals(n, pi) {
    const pg = n.pages[pi]; if (!pg || !pg.qsheet || !engine() || locked(n)) return false;
    let changed = false; pg.hwc = pg.hwc || {};
    for (const q of pg.qsheet.quotes) for (let r = 0; r < q.lines; r++) for (const f of ['qty', 'price']) {
      const L = Q.qLayout(q), cell = L.rows[r][QF[f]], ink = strokesIn(pg, cell); if (!ink.length) continue;
      const sig = sigOf(ink); if (sig in pg.hwc) continue;
      try { pg.hwc[sig] = await recognize(ink, { field: f }); failed.delete(sig); changed = true; } catch (e) { if (!e.none) failed.add(sig); }
      if (curNote() === n) refreshOverlay(pi);
    }
    return changed;
  }
  const refreshOverlay = pi => { const n = curNote(); if (n && pageEls[pi]) try { renderOverlay(pi); } catch (_) {} };

  const FLAG_TXT = { reading: 'reading…', unreadable: '? can’t read', noengine: 'tap to enter', noqty: '? no qty', noprice: '? no price' };
  function drawTotalsUI(pi, pg, rec) {
    const s = S.scale;
    pg.qsheet.quotes.forEach((q, qi) => {
      const L = Q.qLayout(q), T = quoteTotals(pg, q);
      T.lines.forEach(ln => {
        if (!ln.flag && ln.total == null) return;
        const c = L.rows[ln.r][3], b = document.createElement('button');
        b.className = 'qt-ui qt-line' + (ln.flag ? ' flag ' + ln.flag : '') + (ln.r === q.lines - 1 ? ' last' : '');   // last row: sit inside, clear of the Total pill
        b.style.left = (c.x + c.w - 4) * s + 'px'; b.style.top = (c.y + c.h) * s + 'px';   // straddles the row's bottom rule at the right edge: below the baseline, above the next row's capitals
        b.textContent = ln.flag ? FLAG_TXT[ln.flag] : '= ' + fmtMoney(ln.total);
        b.dataset.q = q.id; b.dataset.row = ln.r;
        b.setAttribute('aria-label', ln.flag ? `Line ${ln.r + 1}: ${FLAG_TXT[ln.flag]}` : `Line ${ln.r + 1} total ${fmtMoney(ln.total)} — tap to correct`);
        rec.ov.append(b);
      });
      if (T.total == null && !T.flagged && !T.pending) return;
      const b = document.createElement('button');
      b.className = 'qt-ui qt-total' + (T.flagged ? ' partial' : '');
      b.style.left = (L.x + L.w - 14) * s + 'px'; b.style.top = (L.add.y + 5) * s + 'px';
      b.innerHTML = `<small>Total</small> ${T.total == null ? '—' : esc(fmtMoney(T.total))}${T.flagged ? ` <em>· ${T.flagged} line${T.flagged > 1 ? 's' : ''} to check</em>` : T.pending ? ' <em>· reading…</em>' : ''}`;
      b.dataset.q = q.id; b.setAttribute('aria-label', `Quote ${qi + 1} total — tap to check the numbers`);
      rec.ov.append(b);
    });
  }

  /* ---------- tap a total → check / correct sheet ---------- */
  function openFix(pi, qid, focusRow) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || !pg.qsheet) return;
    const qi = pg.qsheet.quotes.findIndex(q => q.id === qid); if (qi < 0) return; const q = pg.qsheet.quotes[qi], T = quoteTotals(pg, q);
    closeFix();
    const w = document.createElement('div'); w.id = 'qtFix'; w.className = 'qt-fix-wrap';
    const src = c => c.src === 'manual' ? 'your correction' : c.src === 'typed' ? 'typed' : c.src === 'read' ? `read “${c.text}”` : c.src === 'unreadable' ? `couldn’t read${c.text ? ` (“${c.text}”)` : ''}` : c.src === 'noengine' ? 'no handwriting reader — connect Grok or type it' : c.src === 'pending' ? 'reading…' : c.src === 'error' ? 'read failed' : 'empty';
    const val = c => c.src === 'manual' || c.v != null ? (c.src === 'manual' ? c.text : String(c.v)) : '';
    w.innerHTML = `<div class="sheet qt-fix" role="dialog" aria-modal="true" aria-label="Check quote ${qi + 1} numbers">
      <h3>Quote ${qi + 1} — check the numbers</h3>
      <p class="fine">Read from your handwriting. Fix anything that's wrong; your ink is never changed.</p>
      <div class="qt-rows">${T.lines.map(ln => `<div class="qt-row" data-row="${ln.r}"><b>Line ${ln.r + 1}</b>
        <label>Qty<input inputmode="decimal" autocomplete="off" data-f="qty" value="${esc(val(ln.qty))}"><small>${esc(src(ln.qty))}</small></label>
        <span class="qt-x">×</span>
        <label>Price<input inputmode="decimal" autocomplete="off" data-f="price" value="${esc(val(ln.price))}"><small>${esc(src(ln.price))}</small></label>
        <span class="qt-eq" data-eq></span></div>`).join('')}</div>
      <div class="qt-sum"><span>Quote total</span><b data-sum></b></div>
      <div class="sheet-actions"><button class="btn" data-a="reread">↻ Re-read handwriting</button><div class="spacer"></div><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div></div>`;
    document.body.append(w);
    const calc = () => { let sum = 0, any = false; w.querySelectorAll('.qt-row').forEach(row => { const a = parseQty(row.querySelector('[data-f="qty"]').value), b = parsePrice(row.querySelector('[data-f="price"]').value), e = row.querySelector('[data-eq]');
      if (a != null && b != null) { e.textContent = '= ' + fmtMoney(a * b); sum += a * b; any = true; } else e.textContent = ''; }); w.querySelector('[data-sum]').textContent = any ? fmtMoney(sum) : '—'; };
    w.addEventListener('input', calc); calc();
    w.addEventListener('click', e => {
      const a = e.target.closest('[data-a]'); if (e.target === w) return closeFix(); if (!a) return;
      if (a.dataset.a === 'cancel') return closeFix();
      if (a.dataset.a === 'reread') { for (const ln of T.lines) for (const c of [ln.qty, ln.price]) if (c.sig && pg.hwc) delete pg.hwc[c.sig];
        pushHistory(); q.fix = {}; saveNote(n, true); closeFix(); refreshOverlay(pi); readTotals(n, pi).then(() => { persist(n); refreshOverlay(pi); }); toast('Re-reading the handwriting…'); return; }
      if (a.dataset.a === 'save') {
        pushHistory(); const fix = { ...(q.fix || {}) };
        w.querySelectorAll('.qt-row').forEach(row => { const r = +row.dataset.row, ln = T.lines[r];
          for (const f of ['qty', 'price']) { const c = ln[f], v = row.querySelector(`[data-f="${f}"]`).value.trim(), k = fixKey(f, r, c.sig);
            const readV = c.src === 'manual' ? null : c.v == null ? '' : String(c.v);
            if (c.src === 'manual' && v === '') delete fix[k]; else if (v !== readV && !(v === '' && readV === '')) fix[k] = v; else if (c.src === 'manual') fix[k] = v; } });
        q.fix = fix; saveNote(n, true); closeFix(); refreshOverlay(pi); toast('✓ Quote numbers updated');
      }
    });
    setTimeout(() => { const i = w.querySelector(`.qt-row[data-row="${focusRow != null ? focusRow : -1}"] input`); if (i) i.focus(); }, 60);
  }
  function closeFix() { const w = document.getElementById('qtFix'); if (w) w.remove(); }

  /* ==================== 3. Daily To-Do page ==================== */
  const TD = { X: 40, W: 920, TOP: 104, GAP: 16, HEAD: 36, ROW: 48, ADD: 36, NOTES: 150, NOTE_LH: 40, TMR: 132, BOX: 26, DEF: 12 };
  const newTodo = () => ({ v: 1, pri: [0, 1, 2].map(() => ({ id: uid('tp'), done: false })), rows: Array.from({ length: TD.DEF }, () => ({ id: uid('tr'), done: false })), tomorrow: true });
  function tdLayout(t) {
    const X = TD.X, W = TD.W, x = X, date = { key: 'date', label: 'Date', x: X + W - 330, y: 26, w: 330, h: 58 };
    const pri = { key: 'pri', label: 'Top 3 priorities', x, y: TD.TOP, w: W, h: TD.HEAD + 3 * TD.ROW + 8 };
    const row = (box, i, list) => ({ i, id: list[i].id, y: box.y + TD.HEAD + i * TD.ROW, h: TD.ROW, check: { x: box.x + 22, y: box.y + TD.HEAD + i * TD.ROW + (TD.ROW - TD.BOX) / 2 }, write: { x: box.x + 62, y: box.y + TD.HEAD + i * TD.ROW, w: box.w - 74, h: TD.ROW } });
    const priRows = t.pri.map((_, i) => row(pri, i, t.pri));
    const tasks = { key: 'tasks', label: 'Tasks', x, y: pri.y + pri.h + TD.GAP, w: W, h: TD.HEAD + t.rows.length * TD.ROW + TD.ADD };
    const rows = t.rows.map((_, i) => row(tasks, i, t.rows));
    const rowsBottom = tasks.y + TD.HEAD + t.rows.length * TD.ROW;
    const notes = { key: 'notes', label: 'Notes', x, y: tasks.y + tasks.h + TD.GAP, w: W, h: TD.NOTES };
    const tomorrow = t.tomorrow ? { key: 'tomorrow', label: 'Tomorrow', x, y: notes.y + notes.h + TD.GAP, w: W, h: TD.TMR } : null;
    const bottom = (tomorrow || notes).y + (tomorrow || notes).h;
    return { date, pri, priRows, tasks, rows, rowsBottom, add: { x: x + 12, y: rowsBottom }, notes, tomorrow, bottom };
  }
  const tdFits = t => tdLayout(t).bottom <= LIMIT;
  function tdPal() { const d = isDark(); return { paper: d ? '#1f1f23' : '#fffdf8', box: d ? 'rgba(255,255,255,.03)' : '#ffffff', block: d ? 'rgba(255,255,255,.015)' : 'rgba(250,249,245,1)', edge: d ? 'rgba(200,200,220,.26)' : 'rgba(60,60,80,.24)', rule: d ? 'rgba(200,200,220,.20)' : 'rgba(60,60,80,.20)', gray: d ? 'rgba(200,200,215,.62)' : 'rgba(70,70,90,.6)', ink: d ? '#e6e6ea' : '#1d1d1f', accent: d ? '#8b85ff' : '#4f46e5' }; }
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  function lab(ctx, c, t, x, y, size = 12) { ctx.fillStyle = c.gray; ctx.font = `700 ${size}px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px'; ctx.fillText(t.toUpperCase(), x, y); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }
  function drawTodo(ctx, pg) {
    const t = pg.todo, L = tdLayout(t), c = tdPal(); ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.fillStyle = c.ink; ctx.font = `700 32px ${FONT}`; ctx.fillText('Daily To-Do', TD.X + 4, 62);
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(TD.X, 90); ctx.lineTo(TD.X + TD.W, 90); ctx.stroke();
    const box = (f, fill = c.box) => { rr(ctx, f.x, f.y, f.w, f.h, 10); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke(); };
    // date
    lab(ctx, c, 'Date', L.date.x + 2, L.date.y + 16); ctx.strokeStyle = c.rule; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(L.date.x + 56, L.date.y + L.date.h - 12); ctx.lineTo(L.date.x + L.date.w, L.date.y + L.date.h - 12); ctx.stroke();
    const rows = (bx, list, numbered) => list.forEach((r, i) => {
      const k = r.check; rr(ctx, k.x, k.y, TD.BOX, TD.BOX, 6); ctx.strokeStyle = c.gray; ctx.lineWidth = 2; ctx.stroke();
      if (numbered) { ctx.fillStyle = c.accent; ctx.font = `800 15px ${FONT}`; ctx.fillText(String(i + 1), bx.x + 6, k.y + 19); }
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(r.write.x, r.y + r.h - 10); ctx.lineTo(r.write.x + r.write.w, r.y + r.h - 10); ctx.stroke();
    });
    box(L.pri, c.block); lab(ctx, c, '★ Top 3 priorities', L.pri.x + 14, L.pri.y + 23, 13); rows(L.pri, L.priRows, true);
    box(L.tasks, c.block); lab(ctx, c, 'Tasks', L.tasks.x + 14, L.tasks.y + 23, 13); rows(L.tasks, L.rows, false);
    for (const f of [L.notes, L.tomorrow].filter(Boolean)) {
      box(f); lab(ctx, c, f.label, f.x + 14, f.y + 23, 13);
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let yy = f.y + 36 + TD.NOTE_LH - 6; yy < f.y + f.h - 8; yy += TD.NOTE_LH) { ctx.moveTo(f.x + 14, yy); ctx.lineTo(f.x + f.w - 14, yy); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawTick(ctx, k, s = 1) { const b = TD.BOX; ctx.save(); rr(ctx, k.x, k.y, b, b, 6); ctx.fillStyle = '#22a55a'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(k.x + b * .24, k.y + b * .54); ctx.lineTo(k.x + b * .43, k.y + b * .72); ctx.lineTo(k.x + b * .78, k.y + b * .3); ctx.stroke(); ctx.restore(); }

  const _dpb = drawPageBackground;
  drawPageBackground = function (ctx, note, pg) { const r = _dpb.apply(this, arguments); if (pg && pg.todo && !pg.qsheet) try { drawTodo(ctx, pg); } catch (e) { console.warn('todo', e); } return r; };

  const pageBlank = pg => !pg.qsheet && !pg.todo && !pg.bg && !(pg.strokes || []).length && !(pg.texts || []).length && !(pg.tasks || []).length && !(pg.images || []).length && !(pg.sections || []).length && !(pg.quoteForms || []).length && !pg.assist && !pg.rec;
  const guard = () => { const n = curNote(); if (!n) return null; if (sealed(n)) { toast('🔒 Unlock the note first'); return null; } return n; };
  function visiblePi() {
    if (!pageEls.length) return 0; const wr = PAGES.getBoundingClientRect(), mid = wr.top + wr.height * 0.4; let best = 0, bd = Infinity;
    pageEls.forEach((r, i) => { const b = r.el.getBoundingClientRect(); const d = b.top <= mid && b.bottom >= mid ? 0 : Math.min(Math.abs(b.top - mid), Math.abs(b.bottom - mid)); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function scrollToPage(pi, y = 0, smooth = true) { requestAnimationFrame(() => { const r = pageEls[pi]; if (r) PAGES.scrollTo({ top: r.el.offsetTop + y * S.scale - 60, behavior: smooth ? 'smooth' : 'auto' }); }); }
  function commit(n, pis, msg) {
    saveNote(n, true); try { thumbCache.clear(); } catch (_) {}
    if (pis === 'all') buildPages(); else for (const pi of pis) { renderPageInk(pi); renderOverlay(pi); }
    if (msg) actionToast(msg, 'Undo', () => restore(S.undo, S.redo), 5000);
  }
  function insertTodo(pi) {
    const n = guard(); if (!n) return null; if (pi == null) pi = visiblePi();
    const cur = n.pages[pi]; pushHistory(); let at;
    if (cur && pageBlank(cur)) { cur.paper = 'blank'; cur.todo = newTodo(); at = pi; }
    else { const p = newPage(); p.paper = 'blank'; p.todo = newTodo(); n.pages.splice(pi + 1, 0, p); at = pi + 1; }
    commit(n, 'all'); scrollToPage(at);
    toast(at === pi ? '✅ This page is now a Daily To-Do — write with Apple Pencil' : `✅ Daily To-Do added as page ${at + 1} — write with Apple Pencil`, 2800);
    return at;
  }
  function shiftInk(pg, y0, dy) {
    for (const s of pg.strokes || []) if (ccy(s) >= y0) { s.points = s.points.map(p => { const q = p.slice(); q[1] += dy; return q; }); s.bb = bbox(s.points); }
    for (const t of pg.texts || []) if (tcen(t)[1] >= y0) t.y += dy;
  }
  function takeInkIn(pg, r) { const s = new Set(strokesIn(pg, r).concat((pg.strokes || []).filter(x => x.tool === 'highlighter' && inR(r, ccx(x), ccy(x))))), t = new Set(textsIn(pg, r)); pg.strokes = pg.strokes.filter(x => !s.has(x)); pg.texts = pg.texts.filter(x => !t.has(x)); return s.size + t.size; }
  function tdAddRow(pi) {
    const n = guard(); if (!n) return false; const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo, y0 = tdLayout(t).rowsBottom; t.rows.push({ id: uid('tr'), done: false });
    if (!tdFits(t)) { t.rows.pop(); toast(t.tomorrow ? 'The page is full — remove the Tomorrow box or add another To-Do page' : 'The page is full — add another To-Do page'); return false; }
    t.rows.pop(); pushHistory(); t.rows.push({ id: uid('tr'), done: false }); shiftInk(pg, y0, TD.ROW);
    commit(n, [pi]); return true;
  }
  function tdRemoveRow(pi, rid, force) {
    const n = guard(); if (!n) return false; const pg = n.pages[pi]; if (!pg || !pg.todo) return false;
    const t = pg.todo, i = t.rows.findIndex(r => r.id === rid); if (i < 0) return false;
    if (t.rows.length <= 1) { toast('The task list keeps at least one line'); return false; }
    const R = tdLayout(t).rows[i], band = { x: TD.X, y: R.y, w: TD.W, h: TD.ROW };
    if (!force && (strokesIn(pg, band).length || textsIn(pg, band).length)) { actionSheet('This line has handwriting', [{ label: '🗑 Remove the line and its handwriting', danger: true, fn: () => tdRemoveRow(pi, rid, true) }]); return false; }
    pushHistory(); takeInkIn(pg, band); t.rows.splice(i, 1); shiftInk(pg, R.y + TD.ROW, -TD.ROW);
    commit(n, [pi], '－ Line removed'); return true;
  }
  function tdToggleTomorrow(pi, force) {
    const n = guard(); if (!n) return; const pg = n.pages[pi]; if (!pg || !pg.todo) return; const t = pg.todo;
    if (t.tomorrow) {
      const f = tdLayout(t).tomorrow;
      if (!force && (strokesIn(pg, f).length || textsIn(pg, f).length)) return actionSheet('The Tomorrow box has handwriting', [{ label: '🗑 Remove the box and its handwriting', danger: true, fn: () => tdToggleTomorrow(pi, true) }]);
      pushHistory(); takeInkIn(pg, f); t.tomorrow = false; commit(n, [pi], 'Tomorrow box removed');
    } else {
      t.tomorrow = true; if (!tdFits(t)) { t.tomorrow = false; return toast('No room — remove a task line first'); }
      t.tomorrow = false; pushHistory(); t.tomorrow = true; commit(n, [pi]);
    }
  }
  function tdToggle(pi, id) {
    const n = guard(); if (!n) return; const pg = n.pages[pi]; if (!pg || !pg.todo) return;
    const r = pg.todo.pri.concat(pg.todo.rows).find(x => x.id === id); if (!r) return;
    pushHistory(); r.done = !r.done; r.doneAt = r.done ? Date.now() : null; saveNote(n, true); renderOverlay(pi);
  }
  function drawTodoUI(pi, pg, rec) {
    const s = S.scale, t = pg.todo, L = tdLayout(t);
    const el = (cls, x, y, html, attrs = {}) => { const b = document.createElement('button'); b.className = 'td-ui ' + cls; b.style.left = x * s + 'px'; b.style.top = y * s + 'px'; b.innerHTML = html; for (const k in attrs) b.setAttribute(k, attrs[k]); rec.ov.append(b); return b; };
    const checks = (rows, list, what) => rows.forEach((R, i) => {
      const done = list[i].done, b = el('td-check' + (done ? ' on' : ''), R.check.x + TD.BOX / 2, R.check.y + TD.BOX / 2, done ? '✓' : '', { 'data-id': R.id, role: 'checkbox', 'aria-checked': String(done), 'aria-label': `${what} ${i + 1}` });
      b.style.setProperty('--box', TD.BOX * s + 'px');
      if (done) { const st = document.createElement('div'); st.className = 'td-ui td-strike'; st.style.left = R.write.x * s + 'px'; st.style.top = (R.y + R.h * 0.62) * s + 'px'; st.style.width = R.write.w * s + 'px'; rec.ov.append(st); }
    });
    checks(L.priRows, t.pri, 'Priority'); checks(L.rows, t.rows, 'Task');
    el('td-addline', L.add.x, L.add.y + 5, '＋ line', { title: 'Add another task line', 'aria-label': 'Add a task line' });
    if (t.rows.length > 1) L.rows.forEach((R, i) => el('td-delrow', TD.X - 5, R.y + TD.ROW / 2, '－', { 'data-id': R.id, title: 'Remove this line', 'aria-label': `Remove task line ${i + 1}` }));
    el('td-tmr', L.notes.x + L.notes.w - 12, L.notes.y + 6, t.tomorrow ? '✕ Tomorrow box' : '＋ Tomorrow box', { title: t.tomorrow ? 'Remove the Tomorrow box' : 'Add a Tomorrow box' });
  }

  /* ---------- overlays (DOM, never ink) + clicks ---------- */
  const _ovh = v7OverlayHook;
  v7OverlayHook = function (pi) {
    _ovh.apply(this, arguments);
    const n = curNote(), rec = pageEls[pi], pg = n && n.pages[pi]; if (!rec || !pg) return;
    rec.ov.querySelectorAll('.qt-ui, .td-ui, .hw-hit').forEach(b => b.remove());
    if (sealed(n)) return;
    try { if (pg.qsheet) drawTotalsUI(pi, pg, rec); else if (pg.todo) drawTodoUI(pi, pg, rec); } catch (e) { console.warn('v21ee overlay', e); }
    if (HL && HL.note === n.id && HL.page === pg.id && Date.now() < HL.until) drawHit(rec, HL.bb);
  };
  PAGES.addEventListener('click', e => {
    const b = e.target.closest('.qt-ui, .td-ui'); if (!b || b.classList.contains('td-strike')) return; e.stopPropagation(); e.preventDefault();
    const pi = +b.closest('.page[data-pi]').dataset.pi;
    if (b.classList.contains('qt-ui')) openFix(pi, b.dataset.q, b.dataset.row != null ? +b.dataset.row : null);
    else if (b.classList.contains('td-check')) tdToggle(pi, b.dataset.id);
    else if (b.classList.contains('td-addline')) tdAddRow(pi);
    else if (b.classList.contains('td-delrow')) tdRemoveRow(pi, b.dataset.id);
    else if (b.classList.contains('td-tmr')) tdToggleTomorrow(pi);
  }, true);
  PAGES.addEventListener('pointerdown', e => { if (e.target.closest('.qt-ui, .td-ui')) e.stopPropagation(); }, true);   // Pencil or finger: a control, never a stroke / page hold

  /* ---------- PDF export: To-Do ticks + quote totals (light, small) ---------- */
  const _doe = drawOverlaysForExport;
  drawOverlaysForExport = function (ctx, pg, note) {
    const r = _doe.apply(this, arguments);
    try {
      if (pg.todo && !pg.qsheet) { const L = tdLayout(pg.todo); L.priRows.concat(L.rows).forEach((R, i) => { const it = pg.todo.pri.concat(pg.todo.rows)[i]; if (it.done) { drawTick(ctx, R.check); ctx.save(); ctx.strokeStyle = 'rgba(34,165,90,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(R.write.x, R.y + R.h * 0.62); ctx.lineTo(R.write.x + R.write.w, R.y + R.h * 0.62); ctx.stroke(); ctx.restore(); } }); }
      if (pg.qsheet) {
        ctx.save(); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        for (const q of pg.qsheet.quotes) { const L = Q.qLayout(q), T = quoteTotals(pg, q);
          ctx.fillStyle = 'rgba(79,70,229,.85)'; ctx.font = `600 13px ${FONT}`;
          for (const ln of T.lines) if (ln.total != null) { const c = L.rows[ln.r][3]; ctx.fillText('= ' + fmtMoney(ln.total), c.x + c.w - 8, c.y + c.h - 5); }
          if (T.total != null) { ctx.font = `700 17px ${FONT}`; ctx.fillStyle = '#1d1d1f'; ctx.fillText('Total ' + fmtMoney(T.total) + (T.flagged ? ` (${T.flagged} line${T.flagged > 1 ? 's' : ''} unread)` : ''), L.x + L.w - 16, L.add.y + 25); } }
        ctx.restore();
      }
    } catch (e) { console.warn('v21ee export', e); }
    return r;
  };

  /* ==================== 2. handwriting search ==================== */
  /** Recognition groups on a page: Quote / To-Do boxes one by one, other ink clustered into lines. */
  function groupsFor(pg) {
    const boxes = [];
    if (pg.qsheet) pg.qsheet.quotes.forEach((q, qi) => { const L = Q.qLayout(q);
      for (const f of L.party) boxes.push({ ...f, label: `Quote ${qi + 1} · ${f.label}` });
      L.rows.forEach((row, r) => row.forEach(c => boxes.push({ ...c, label: `Quote ${qi + 1} · ${c.label}${q.lines > 1 ? ' ' + (r + 1) : ''}` })));
      boxes.push({ ...L.notes, label: `Quote ${qi + 1} · Notes` }); });
    else if (pg.todo) { const L = tdLayout(pg.todo);
      boxes.push({ ...L.date, label: 'To-Do · Date' });
      L.priRows.forEach((R, i) => boxes.push({ x: TD.X, y: R.y, w: TD.W, h: R.h, label: `To-Do · Priority ${i + 1}` }));
      L.rows.forEach((R, i) => boxes.push({ x: TD.X, y: R.y, w: TD.W, h: R.h, label: `To-Do · Task ${i + 1}` }));
      boxes.push({ ...L.notes, label: 'To-Do · Notes' }); if (L.tomorrow) boxes.push({ ...L.tomorrow, label: 'To-Do · Tomorrow' }); }
    const out = boxes.map(b => ({ label: b.label, box: b, strokes: [] })), rest = [];
    for (const s of inkOf(pg)) { const x = ccx(s), y = ccy(s), g = out.find(g => inR(g.box, x, y)); if (g) g.strokes.push(s); else rest.push(s); }
    // line clustering for loose ink: strokes whose (padded) vertical extents overlap and sit close together form one line
    const ext = s => { const b = sbb(s), c = (b[1] + b[3]) / 2; return [b[0], Math.min(b[1], c - 7), b[2], Math.max(b[3], c + 7)]; };
    const sameLine = (A, B) => { const ov = Math.min(A[3], B[3]) - Math.max(A[1], B[1]), gap = Math.max(B[0] - A[2], A[0] - B[2]); return ov > 0.35 * Math.min(A[3] - A[1], B[3] - B[1]) && gap < 170; };
    const grow = (A, b) => { A.bb = [Math.min(A.bb[0], b[0]), Math.min(A.bb[1], b[1]), Math.max(A.bb[2], b[2]), Math.max(A.bb[3], b[3])]; };
    let lines = [];
    for (const s of rest.slice().sort((a, b) => ccy(a) - ccy(b))) { const e = ext(s), l = lines.find(l => sameLine(l.bb, e)); if (l) { l.strokes.push(s); grow(l, e); } else lines.push({ strokes: [s], bb: e }); }
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < lines.length && !merged; i++) for (let j = i + 1; j < lines.length; j++) if (sameLine(lines[i].bb, lines[j].bb)) {
        const A = lines[i], B = lines[j]; A.strokes.push(...B.strokes); A.bb = [Math.min(A.bb[0], B.bb[0]), Math.min(A.bb[1], B.bb[1]), Math.max(A.bb[2], B.bb[2]), Math.max(A.bb[3], B.bb[3])]; lines.splice(j, 1); merged = true; break; }
    }
    lines.sort((a, b) => a.bb[1] - b.bb[1] || a.bb[0] - b.bb[0]);
    for (const l of lines) out.push({ label: 'Handwriting', strokes: l.strokes });
    return out.filter(g => g.strokes.length).map(g => ({ ...g, sig: sigOf(g.strokes), bb: bbOf(g.strokes) }));
  }
  const pageSig = pg => sigOf(inkOf(pg)) + '#' + (pg.qsheet ? JSON.stringify(pg.qsheet.quotes.map(q => [q.y, q.lines])) : '') + (pg.todo ? pg.todo.rows.length + ':' + pg.todo.tomorrow : '');
  /** (Re)index one page: recognizes only groups whose ink changed. Returns true if the page data changed. */
  async function indexPage(n, pg) {
    if (!pg || locked(n) || isBoardPage(pg)) return false;
    const sig = pageSig(pg); if (pg.hwIdx && pg.hwIdx.sig === sig && !pg.hwIdx.partial) return false;
    const groups = groupsFor(pg), have = engine(), had = pg.hwc || {};
    if (!groups.length) { if (!pg.hwIdx && !pg.hwc) return false; delete pg.hwIdx; delete pg.hwc; return true; }
    if (!have && !groups.some(g => g.sig in had)) return false;          // nothing to read with and nothing cached: leave the page untouched
    pg.hwc = had; let partial = false;
    for (const g of groups) {
      if (g.sig in pg.hwc) continue;
      if (!have) { partial = true; continue; }
      try { pg.hwc[g.sig] = await recognize(g.strokes, { field: g.box && g.box.key || 'text' }); failed.delete(g.sig); } catch (e) { partial = true; if (!e.none) failed.add(g.sig); }
      if (pageSig(pg) !== sig) return indexPage(n, pg);      // edited while reading → start that page over
    }
    const keep = new Set(groups.map(g => g.sig)), hwc = {};
    for (const k in pg.hwc) if (keep.has(k)) hwc[k] = pg.hwc[k];
    // the qty / price cells are groups too, so the totals cache survives this prune
    pg.hwc = hwc;
    pg.hwIdx = { v: 1, sig, partial, at: Date.now(), items: groups.filter(g => hwc[g.sig]).map(g => ({ k: g.label === 'Handwriting' ? 'ink' : 'field', label: g.label, t: hwc[g.sig], bb: g.bb.map(v => Math.round(v)) })) };
    return true;
  }
  const IX = { queue: [], running: false, done: 0, total: 0, timers: new Map(), backfilled: false };
  function enqueue(n, front) { if (!n || locked(n)) return; IX.queue = IX.queue.filter(x => x !== n); front ? IX.queue.unshift(n) : IX.queue.push(n); IX.total = Math.max(IX.total, IX.done + IX.queue.length); runQueue(); }
  async function runQueue() {
    if (IX.running) return; IX.running = true;
    try {
      while (IX.queue.length) {
        const n = IX.queue.shift(); let changed = false;
        for (const pg of n.pages.slice()) { try { if (await indexPage(n, pg)) changed = true; } catch (e) { console.warn('index', e); } }
        if (changed) { persist(n); if (curNote() === n) n.pages.forEach((p, i) => { if (p.qsheet) refreshOverlay(i); }); }
        IX.done++; renderResults();
      }
    } finally { IX.running = false; IX.done = 0; IX.total = 0; renderResults(); }
  }
  function backfill() { if (IX.backfilled || !engine()) return; IX.backfilled = true; S.notes.filter(n => !locked(n) && n.pages.some(p => inkOf(p).length && !(p.hwIdx && p.hwIdx.sig === pageSig(p) && !p.hwIdx.partial))).forEach(n => enqueue(n)); }

  /* ---------- re-read after writing pauses ---------- */
  const _ons = window.onNoteSaved;
  window.onNoteSaved = function (note) {
    if (_ons) try { _ons.apply(this, arguments); } catch (_) {}
    if (!note || locked(note)) return;
    clearTimeout(IX.timers.get('t' + note.id)); clearTimeout(IX.timers.get('i' + note.id));
    if (note.pages.some(p => p.qsheet)) IX.timers.set('t' + note.id, setTimeout(async () => {
      let ch = false; for (let i = 0; i < note.pages.length; i++) if (note.pages[i].qsheet) { if (await readTotals(note, i)) ch = true; if (curNote() === note) refreshOverlay(i); }
      if (ch) persist(note);
    }, V21ee.TOTALS_DELAY));
    IX.timers.set('i' + note.id, setTimeout(() => enqueue(note, true), V21ee.INDEX_DELAY));
  };

  /* ---------- search over the index ---------- */
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ');
  function snip(s, q) { const i = norm(s).indexOf(q); if (i < 0) return { pre: '', hit: '', post: String(s).slice(0, 80) }; const a = Math.max(0, i - 28); return { pre: (a > 0 ? '…' : '') + s.slice(a, i), hit: s.slice(i, i + q.length), post: s.slice(i + q.length, i + q.length + 40) + (i + q.length + 40 < s.length ? '…' : '') }; }
  function search(query, limit = 60) {
    const q = norm(query).trim(); if (q.length < 2) return [];
    const out = [];
    for (const n of S.notes) {
      if (locked(n) || isBoardPage(n.pages[0] || {}) && n.pages.length === 1 && false) continue;
      n.pages.forEach((pg, pi) => {
        const cand = [];
        for (const it of (pg.hwIdx && pg.hwIdx.items) || []) cand.push({ kind: it.k === 'ink' ? '✍️ handwriting' : '✍️ ' + it.label, t: it.t, bb: it.bb });
        for (const t of pg.texts || []) cand.push({ kind: '🔤 typed', t: t.text, bb: [t.x, t.y, t.x + 300, t.y + (t.size || 24) * 1.4] });
        for (const t of pg.tasks || []) if (t.text) cand.push({ kind: '☑️ task', t: t.text, bb: t.kind === 'ink' ? [t.x, t.y, t.x + t.w, t.y + t.h] : [t.x, t.y, t.x + 320, t.y + 40] });
        for (const l of pg.labels || []) cand.push({ kind: '🏷 label', t: l.text, bb: [l.x, l.y, l.x + l.w, l.y + l.h] });
        if (pg.inkText && !(pg.hwIdx && pg.hwIdx.items && pg.hwIdx.items.length)) cand.push({ kind: '✍️ handwriting', t: pg.inkText, bb: null });
        for (const c of cand) if (norm(c.t).includes(q)) out.push({ note: n, pi, pg, ...c, s: snip(String(c.t), q) });
      });
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }
  // keep the notebook filter in step: notes whose handwriting matches stay listed
  const _nst = noteSearchText;
  noteSearchText = function (n) { return _nst.apply(this, arguments) + ' ' + n.pages.flatMap(p => ((p.hwIdx && p.hwIdx.items) || []).map(i => i.t)).join(' ').toLowerCase(); };

  const thumbs = new Map();
  function pageThumb(n, pg, W = 72) {
    const key = [n.id, pg.id, n.updatedAt, isDark(), W].join(':'); if (thumbs.has(key)) return thumbs.get(key);
    const H = Math.round(W * PAGE_H / PAGE_W), c = document.createElement('canvas'), dpr = 2; c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(W * dpr / PAGE_W, 0, 0, W * dpr / PAGE_W, 0, 0);
    try { drawPageContent(ctx, n, pg); } catch (_) {}
    const u = c.toDataURL('image/jpeg', 0.8); if (thumbs.size > 120) thumbs.clear(); thumbs.set(key, u); return u;
  }
  function statusLine() {
    const e = engine();
    if (IX.running || IX.queue.length) return `Reading handwriting with ${engineLabel()}… ${IX.done} of ${IX.total} note${IX.total === 1 ? '' : 's'}`;
    if (!e) return 'Searching typed text, tasks, labels and handwriting already read. To read new handwriting on iPad, connect your Grok key (⋯ → Settings → Assistant).';
    return `Handwriting read with ${engineLabel()} · re-read a moment after you write`;
  }
  let lastHits = [];
  function renderResults() {
    let box = document.getElementById('hwResults');
    if (!box) { box = document.createElement('div'); box.id = 'hwResults'; box.setAttribute('aria-label', 'Search results'); const h = $('#searchHint'); h ? h.after(box) : $('#search').after(box); box.addEventListener('click', onResultClick); }
    const q = (S.search || '').trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = lastHits = search(q);
    box.hidden = false;
    box.innerHTML = `<div class="hw-head"><b>${hits.length ? `${hits.length}${hits.length >= 60 ? '+' : ''} match${hits.length === 1 ? '' : 'es'} in pages` : 'No matches in page text or handwriting'}</b></div>
      <p class="fine hw-status">${esc(statusLine())}</p>` +
      hits.map((h, i) => `<button class="hw-res" data-i="${i}"><img alt="" draggable="false" data-thumb="${i}" width="44" height="63"><span class="hw-meta"><span class="hw-t">${esc(h.note.title)} · p.${h.pi + 1}</span><span class="hw-k">${esc(h.kind)}</span><span class="hw-s">${esc(h.s.pre)}<mark>${esc(h.s.hit)}</mark>${esc(h.s.post)}</span></span></button>`).join('');
    // thumbnails after paint, capped
    requestAnimationFrame(() => box.querySelectorAll('img[data-thumb]').forEach((im, k) => { if (k > 24) return; const h = hits[+im.dataset.thumb]; if (h) im.src = pageThumb(h.note, h.pg); }));
  }
  let HL = null;
  function drawHit(rec, bb) {
    const s = S.scale, d = document.createElement('div'); d.className = 'hw-hit';
    const pad = 10, [x0, y0, x1, y1] = bb; Object.assign(d.style, { left: (x0 - pad) * s + 'px', top: (y0 - pad) * s + 'px', width: (x1 - x0 + 2 * pad) * s + 'px', height: (y1 - y0 + 2 * pad) * s + 'px' });
    rec.ov.append(d);
  }
  function openHit(h) {
    if (!h) return;
    if (curNote() !== h.note) openNote(h.note.id);
    const pi = h.note.pages.indexOf(h.pg); if (pi < 0) return;
    if (isDrawer()) setSidebar(false);
    const bb = h.bb || [40, 40, PAGE_W - 40, PAGE_H - 40];
    HL = { note: h.note.id, page: h.pg.id, bb, until: Date.now() + 5000 };
    ensureAlive(pi); renderOverlay(pi);
    requestAnimationFrame(() => { const r = pageEls[pi]; if (r) PAGES.scrollTo({ top: r.el.offsetTop + Math.max(0, bb[1] - 160) * S.scale, behavior: 'auto' }); });
    setTimeout(() => { if (HL && HL.page === h.pg.id && Date.now() >= HL.until) { HL = null; pageEls[pi] && pageEls[pi].ov.querySelectorAll('.hw-hit').forEach(x => x.remove()); } }, 5100);
  }
  function onResultClick(e) { const b = e.target.closest('.hw-res'); if (!b) return; openHit(lastHits[+b.dataset.i]); }
  const _rs = renderSidebar;
  renderSidebar = function () { const r = _rs.apply(this, arguments); try { renderResults(); } catch (e) { console.warn('hw results', e); } return r; };
  $('#search').setAttribute('placeholder', 'Search notes, typed text & handwriting');
  $('#search').addEventListener('focus', () => backfill());
  $('#search').addEventListener('keydown', e => { if (e.key === 'Enter' && lastHits[0]) { e.preventDefault(); $('#search').blur(); openHit(lastHits[0]); } });
  try { searchHintText = function () { return engine() ? `Searching titles, typed text, tasks, labels, Quote / To-Do fields and handwriting (read with ${engineLabel()}).` : 'This browser has no on-device handwriting recognition — connect Grok (⋯ → Settings → Assistant) to read new handwriting. Searching titles, typed text, tasks, labels and handwriting already read.'; }; } catch (_) {}

  /* ==================== Insert menu: Daily To-Do (and keep Quote sheet off To-Do pages) ==================== */
  function addInsertItems() {
    const m = document.getElementById('insertMenu'); if (!m) return;
    if (!m.querySelector('#insTodo')) {
      const b = document.createElement('button'); b.id = 'insTodo'; b.className = 'ins-item'; b.setAttribute('role', 'menuitem');
      b.title = 'A full handwritten day page: Date, Top 3 priorities, checkbox task lines, Notes and Tomorrow';
      b.innerHTML = '<i>✅</i><span>Daily To-Do</span><small>Full page · tick boxes · ＋ line for more tasks</small>';
      b.onclick = () => { m.hidden = true; const ib = $('#insertBtn'); ib && ib.setAttribute('aria-expanded', 'false'); insertTodo(); };
      const qs = m.querySelector('#insQuoteSheet'); qs ? qs.after(b) : m.append(b);
    }
    const qs = m.querySelector('#insQuoteSheet');
    if (qs && !qs._v21ee) { qs._v21ee = true; const orig = qs.onclick; qs.onclick = function () {
      const n = curNote(), pi = visiblePi(), wasTodo = n && n.pages[pi] && n.pages[pi].todo;
      const r = orig.apply(this, arguments);
      if (wasTodo && n.pages[pi].qsheet) {                // v21ed treats an empty To-Do page as blank → put the sheet after it instead
        const p = newPage(); p.paper = 'blank'; p.qsheet = n.pages[pi].qsheet; delete n.pages[pi].qsheet; n.pages.splice(pi + 1, 0, p);
        saveNote(n, true); buildPages(); scrollToPage(pi + 1); toast(`🧾 Quote sheet added as page ${pi + 2} — write with Apple Pencil`, 2800);
      }
      return r; }; }
  }
  addInsertItems();

  /* ==================== 4. iPad polish (JS side; CSS side is the “v21ee” block in styles.css) ==================== */
  // a) iOS Safari ignores user-scalable=no: a pinch on the toolbar / sidebar zoomed the whole app. Pages keep their own pinch zoom
  //    (touch events, app.js), which these WebKit-only gesture events don't affect.
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => { if (!e.target.closest || !e.target.closest('#pages')) e.preventDefault(); }, { passive: false });
  // b) Home-screen app: a blob “download” opens an in-app PDF viewer with no way back on iPadOS. Offer the share sheet instead.
  const standalone = () => { try { return isStandalone; } catch (_) { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } };
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[download]'); if (!a || !/^blob:/.test(a.href) || !/\.pdf$/i.test(a.download || '')) return;
    if (!(standalone() && isIOS && navigator.canShare)) return;
    e.preventDefault(); const href = a.href, name = a.download;
    fetch(href).then(r => r.blob()).then(b => { const f = new File([b], name, { type: 'application/pdf' }); if (!navigator.canShare({ files: [f] })) return;
      const share = () => navigator.share({ files: [f], title: name }).catch(() => {});
      share().catch(() => {}); setTimeout(() => actionToast('PDF ready', 'Share / Save', share, 8000), 200); });
  }, true);
  // c) the soft keyboard on iPad resizes the visual viewport, not the layout one: keep the check-numbers sheet above it
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { const w = document.getElementById('qtFix'); if (w) w.style.height = visualViewport.height + 'px'; });
  // d) standalone-mode flag for CSS (status-bar spacing is handled with env(safe-area-inset-*) there)
  document.documentElement.classList.toggle('standalone', !!standalone());

  if (curNote()) { try { buildPages(); } catch (_) {} }
  try { renderSidebar(); } catch (_) {}
  const whenReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 60); setTimeout(() => clearInterval(t), 15000); };
  // free on-device recognizers backfill at once; Grok backfills when you first open search (it uses your key)
  whenReady(() => setTimeout(() => { if (engine() && engine().name === 'device') backfill(); const n = curNote(); if (n) enqueue(n); }, 1500));

  window.V21ee = { version: 'v21ee', TOTALS_DELAY: 1200, INDEX_DELAY: 2500, stats,
    setRecognizer(fn) { testRecognizer = fn; }, engine, parseQty, parsePrice, quoteTotals, readTotals, openFix, closeFix,
    insertTodo, tdLayout, tdAddRow, tdRemoveRow, tdToggle, tdToggleTomorrow, TD,
    groupsFor, indexPage, enqueue, backfill, search, openHit, renderResults, pageThumb, IX, idle: () => !IX.running && !IX.queue.length };
})();
