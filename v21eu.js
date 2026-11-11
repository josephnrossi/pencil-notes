/* Pencil Notes v21eu — Quote sheet: stop reading Qty/Price handwriting; tap to type the numbers. Mock only. Loads after v21et.
   Joseph: handwriting reading of Qty and Price never worked; keep the option of tapping and inserting values.
   1. No recognizer / Grok / aiTranscribe / on-device read of Qty or Price. No "reading…", "? can't read", "N lines to check",
      no retry, no read-value chips from ink. Pencil still writes ink in those cells (ink is just ink; never deleted).
      Product / Size / Distributor / Customer / Notes ink, and handwriting recognition elsewhere, are unchanged.
   2. Each Qty and Price cell has a small finger-only tap target (same v21et pattern: pointer-events none on the chip,
      Pencil always lands on the canvas; a finger tap is hit-tested) that opens a number pad. Typed values persist on
      the quote (q.typed), survive reload and backup/export, show as a clean label that does not hide the ink, and are clearable.
   3. A row total appears only when both Qty and Price are typed (integer-cent math, /M and /C). Quote total = sum of row
      totals. One-sided rows show nothing (no warnings). + line / − row keep typed values with their rows.
   4. Cached handwriting reads for Qty/Price (pg.hwc) are dropped. v21es/v21et tap-to-correct values in q.fix are migrated. */
(function () {
  'use strict';
  const VERSION = 'v21eu';
  const QF = { qty: 2, price: 3 };
  const valKey = (f, r) => f + '|' + r;
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const locked = n => !!(n && n.lock);
  const persist = n => { if (n && !n.lock && typeof DB !== 'undefined') DB.put('notes', n).catch(() => {}); };
  const sigOf = strokes => (strokes || []).map(s => s.id + ':' + s.points.length).sort().join(',');
  const fmtNum = v => (Math.round(v * 1000) / 1000).toLocaleString('en-US');
  const perTxt = p => p.per === 1000 ? '/M' : p.per === 100 ? '/C' : '';
  const fmtPrice = p => '$' + p.v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + perTxt(p);
  const fmtCents = c => window.V21ee ? V21ee.fmtCents(c) : '';
  const refresh = pi => { const n = curNote(); if (n && pageEls[pi]) try { renderOverlay(pi); } catch (_) {} };

  /* ---------- migrate q.fix (v21es/v21et tap-to-correct) → q.typed; drop Qty/Price hwc ---------- */
  function migrateQuote(q, pg) {
    if (!q || q.typedV === 1) return false;
    let changed = false;
    q.typed = q.typed || {};
    const fix = q.fix || {};
    for (const k of Object.keys(fix)) {
      const m = /^(qty|price)\|e:(\d+)$/.exec(k);
      if (m && fix[k] != null && String(fix[k]).trim() !== '' && q.typed[valKey(m[1], +m[2])] == null) {
        q.typed[valKey(m[1], +m[2])] = String(fix[k]); changed = true;
      }
    }
    if (pg && window.V21ee) {
      for (let r = 0; r < q.lines; r++) for (const f of ['qty', 'price']) {
        const ink = V21ee.rowInk(pg, q, r)[QF[f]] || [];
        const k = f + '|s:' + sigOf(ink), tk = valKey(f, r);
        if (ink.length && fix[k] != null && String(fix[k]).trim() !== '' && q.typed[tk] == null) { q.typed[tk] = String(fix[k]); changed = true; }
      }
    }
    q.typedV = 1;   // run once so leftover s: keys are not applied to the wrong row after − row
    return changed;
  }
  function scrubPage(pg) {
    if (!pg || !pg.qsheet || !window.V21ee) return false;
    let changed = false;
    for (const q of pg.qsheet.quotes) if (migrateQuote(q, pg)) changed = true;
    if (pg.hwc) {
      const drop = new Set();
      for (const q of pg.qsheet.quotes) for (let r = 0; r < q.lines; r++) for (const f of ['qty', 'price']) {
        const ink = V21ee.rowInk(pg, q, r)[QF[f]] || [], sig = sigOf(ink);
        if (ink.length && sig && sig in pg.hwc) { drop.add(sig); delete pg.hwc[sig]; changed = true; }
      }
      if (pg.hwIdx && Array.isArray(pg.hwIdx.items)) {
        const n0 = pg.hwIdx.items.length;
        pg.hwIdx.items = pg.hwIdx.items.filter(it => !/·\s*(Qty|Price)(\s|$)/i.test(it.label || ''));
        if (pg.hwIdx.items.length !== n0) changed = true;
      }
    }
    return changed;
  }
  function scrubNote(n) {
    if (!n || locked(n)) return false;
    let ch = false; for (const pg of n.pages || []) if (scrubPage(pg)) ch = true;
    return ch;
  }
  function scrubAll() {
    if (typeof S === 'undefined' || !S.notes) return;
    for (const n of S.notes) if (scrubNote(n)) persist(n);
  }

  function onRemoveLine(q, r) {
    if (!q) return;
    const t = q.typed || (q.typed = {});
    for (const f of ['qty', 'price']) {
      delete t[valKey(f, r)];
      for (let i = r + 1; i <= q.lines; i++) {
        const from = valKey(f, i), to = valKey(f, i - 1);
        if (t[from] != null) t[to] = t[from]; else delete t[to];
        delete t[from];
      }
    }
  }

  function rawOf(q, r, f) { return q && q.typed && q.typed[valKey(f, r)] != null ? String(q.typed[valKey(f, r)]) : ''; }
  function setTyped(q, r, f, text) {
    q.typed = q.typed || {};
    const k = valKey(f, r), v = text == null ? '' : String(text).trim();
    if (v) q.typed[k] = v; else delete q.typed[k];
  }

  /* ---------- cell / totals: typed values only (never a recognizer result) ---------- */
  function cellVal(pg, q, r, f) {
    migrateQuote(q, pg);
    const L = window.V21ed.qLayout(q), cell = L.rows[r][QF[f]];
    const ink = window.V21ee ? V21ee.rowInk(pg, q, r)[QF[f]] : [];
    const text = rawOf(q, r, f), parse = f === 'qty' ? V21ee.qtyOf : V21ee.priceOf;
    const base = { cell, sig: sigOf(ink), ink, has: !!ink.length, text, src: text ? 'manual' : 'empty' };
    if (!text) return { ...base, v: null, p: null, why: 'empty' };
    const p = parse(text);
    return { ...base, v: p.ok ? p.v : null, p: p.ok ? p : null, why: p.ok ? null : p.why, src: p.ok ? 'manual' : 'unreadable' };
  }
  function quoteTotals(pg, q) {
    migrateQuote(q, pg);
    const lines = []; let cents = 0, any = false;
    for (let r = 0; r < q.lines; r++) {
      const qty = cellVal(pg, q, r, 'qty'), price = cellVal(pg, q, r, 'price');
      const c = (qty.p && price.p) ? V21ee.lineCents(qty.p, price.p) : null;
      if (c != null) { cents += c; any = true; }
      lines.push({ r, qty, price, cents: c, total: c == null ? null : c / 100, flag: null });
    }
    return { lines, totalCents: any ? cents : null, total: any ? cents / 100 : null, flagged: 0, pending: 0 };
  }
  async function readTotals() { return false; }   // never call a recognizer for Qty/Price

  function valLabel(c, f) {
    if (!c.text) return '123';
    if (c.p) return f === 'qty' ? fmtNum(c.v) : fmtPrice(c.p);
    return c.text;
  }

  function drawTotalsUI(pi, pg, rec) {
    if (!window.V21ed) return;
    const s = S.scale;
    pg.qsheet.quotes.forEach((q, qi) => {
      const L = V21ed.qLayout(q), T = quoteTotals(pg, q);
      T.lines.forEach(ln => {
        for (const f of ['qty', 'price']) {
          const v = ln[f], cell = L.rows[ln.r][QF[f]], has = !!v.text;
          const wrap = document.createElement('div');
          wrap.className = 'qt-wrapui qt-cellui' + (has ? ' has' : ' empty') + (f === 'price' ? ' qt-price-pos' : '');
          // Qty: bottom-right of its cell. Price: bottom-left, so the row total can sit at the right without covering it.
          if (f === 'price') { wrap.style.left = (cell.x + 6) * s + 'px'; wrap.style.top = (cell.y + cell.h - 4) * s + 'px'; }
          else { wrap.style.left = (cell.x + cell.w - 5) * s + 'px'; wrap.style.top = (cell.y + cell.h - 4) * s + 'px'; }
          const b = document.createElement('button');
          b.className = 'qt-ui qt-val qt-' + f + (has ? ' typed' : ' empty');
          b.textContent = valLabel(v, f);
          b.dataset.q = q.id; b.dataset.vrow = ln.r; b.dataset.f = f;
          b.setAttribute('aria-label', has
            ? `Line ${ln.r + 1} ${f === 'qty' ? 'quantity' : 'price'} ${valLabel(v, f)} — tap to edit`
            : `Line ${ln.r + 1} ${f === 'qty' ? 'quantity' : 'price'} — tap to type`);
          wrap.append(b); rec.ov.append(wrap);
        }
        if (ln.total != null) {
          const c = L.rows[ln.r][3], b = document.createElement('div');
          b.className = 'qt-ui qt-line' + (ln.r === q.lines - 1 ? ' last' : '');
          b.textContent = '= ' + fmtCents(ln.cents);
          b.dataset.q = q.id; b.dataset.row = ln.r;
          b.setAttribute('aria-label', `Line ${ln.r + 1} total ${fmtCents(ln.cents)}`);
          b.style.left = (c.x + c.w - 6) * s + 'px';
          b.style.top = (c.y + c.h - 2) * s + 'px';   // on the row rule, not over the writing
          rec.ov.append(b);
        }
      });
      if (T.total == null) return;
      const b = document.createElement('button');
      b.className = 'qt-ui qt-total';
      b.style.left = (L.x + L.w - 14) * s + 'px';
      b.style.top = (L.add.y + 5) * s + 'px';
      b.innerHTML = `<small>Total</small> ${typeof esc === 'function' ? esc(fmtCents(T.totalCents)) : fmtCents(T.totalCents)}`;
      b.dataset.q = q.id;
      b.setAttribute('aria-label', `Quote ${qi + 1} total ${fmtCents(T.totalCents)}`);
      rec.ov.append(b);
    });
  }

  /* ---------- number pad (finger tap on a Qty / Price chip) ---------- */
  function closePad() { const w = document.getElementById('qtPad'); if (w) w.remove(); }
  function closeFix() { closePad(); const w = document.getElementById('qtFix'); if (w) w.remove(); }
  function openPad(pi, qid, row, field) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || !pg.qsheet || sealed(n) || row == null || (field !== 'qty' && field !== 'price')) return;
    const q = pg.qsheet.quotes.find(x => x.id === qid); if (!q || row < 0 || row >= q.lines) return;
    migrateQuote(q, pg); closePad();
    const w = document.createElement('div'); w.id = 'qtPad'; w.className = 'qt-fix-wrap qt-pad-wrap';
    const title = `Line ${row + 1} · ${field === 'qty' ? 'Quantity' : 'Price'}`;
    const keys = field === 'price'
      ? [['1', '2', '3', '/M'], ['4', '5', '6', '/C'], ['7', '8', '9', 'ea'], ['.', '0', ',', '$']]
      : [['1', '2', '3', ','], ['4', '5', '6', ''], ['7', '8', '9', ''], ['.', '0', '', '']];
    w.innerHTML = `<div class="sheet qt-pad" role="dialog" aria-modal="true" aria-label="${title}">
      <h3>${title}</h3>
      <p class="fine">${field === 'price' ? 'Type the price. Use /M for per thousand, /C for per hundred.' : 'Type the quantity.'} Your handwriting is never changed.</p>
      <input class="qt-disp" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${title}" value="${(typeof esc === 'function' ? esc(rawOf(q, row, field)) : rawOf(q, row, field))}">
      <div class="qt-keys">${keys.map(rowK => rowK.map(k => k ? `<button type="button" data-k="${k}">${k}</button>` : '<span></span>').join('')).join('')}<button type="button" data-k="bs" aria-label="Backspace">⌫</button><button type="button" data-k="clear" class="qt-clear">Clear</button></div>
      <div class="sheet-actions"><button class="btn" data-a="cancel">Cancel</button><div class="spacer"></div><button class="btn primary" data-a="done">Done</button></div>
    </div>`;
    document.body.append(w);
    const inp = w.querySelector('.qt-disp');
    setTimeout(() => { try { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {} }, 40);
    const ins = k => {
      const el = inp, s = el.selectionStart == null ? el.value.length : el.selectionStart, e = el.selectionEnd == null ? s : el.selectionEnd;
      if (k === '/M' || k === '/C' || k === 'ea' || k === '$') {
        if (k === '$') { if (!el.value.includes('$')) { el.value = '$' + el.value; el.setSelectionRange(el.value.length, el.value.length); } return; }
        el.value = el.value.replace(/\s*(\/M|\/C|ea)$/i, '') + k; el.setSelectionRange(el.value.length, el.value.length); return;
      }
      el.value = el.value.slice(0, s) + k + el.value.slice(e); el.setSelectionRange(s + k.length, s + k.length);
    };
    w.addEventListener('click', e => {
      if (e.target === w) return closePad();
      const k = e.target.closest('[data-k]'); const a = e.target.closest('[data-a]');
      if (k) { e.preventDefault(); const v = k.dataset.k;
        if (v === 'bs') { const el = inp, s = el.selectionStart == null ? el.value.length : el.selectionStart, e0 = el.selectionEnd == null ? s : el.selectionEnd;
          if (s !== e0) { el.value = el.value.slice(0, s) + el.value.slice(e0); el.setSelectionRange(s, s); }
          else if (s > 0) { el.value = el.value.slice(0, s - 1) + el.value.slice(s); el.setSelectionRange(s - 1, s - 1); }
        } else if (v === 'clear') { inp.value = ''; }
        else ins(v);
        inp.focus(); return; }
      if (!a) return;
      if (a.dataset.a === 'cancel') return closePad();
      if (a.dataset.a === 'done') {
        pushHistory(); setTyped(q, row, field, inp.value); saveNote(n, true); closePad(); refresh(pi);
        try { if (typeof toast === 'function') toast('✓ ' + (field === 'qty' ? 'Quantity' : 'Price') + ' saved'); } catch (_) {}
      }
    });
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); closePad(); } if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); w.querySelector('[data-a="done"]').click(); } };
    addEventListener('keydown', key, true);
    const obs = new MutationObserver(() => { if (!document.getElementById('qtPad')) { removeEventListener('keydown', key, true); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  }
  function openFix(pi, qid, focusRow, focusField) {
    if (focusField === 'qty' || focusField === 'price') return openPad(pi, qid, focusRow, focusField);
    // v21eu: tapping a total no longer opens the handwriting check sheet (that feature is gone)
  }

  /* ---------- install over V21ee (call sites already dispatch through window.V21ee) ---------- */
  if (window.V21ee) {
    V21ee.cellVal = cellVal;
    V21ee.quoteTotals = quoteTotals;
    V21ee.readTotals = readTotals;
    V21ee.drawTotalsUI = drawTotalsUI;
    V21ee.openFix = openFix;
    V21ee.closeFix = closeFix;
  }

  /* finger tap: CDP / iPad touch events may not produce a pointerup that v21et sees, so hit-test touchend too (stylus still writes) */
  const PAGES = document.getElementById('pages');
  const hit = (x, y) => (window.V21et && V21et.chipAt) ? V21et.chipAt(x, y) : null;
  let t0 = null;
  if (PAGES) {
    PAGES.addEventListener('touchstart', e => {
      const t = e.changedTouches && e.changedTouches[0]; if (!t || t.touchType === 'stylus') { t0 = null; return; }
      t0 = hit(t.clientX, t.clientY) ? { x: t.clientX, y: t.clientY, at: Date.now(), id: t.identifier } : null;
    }, { capture: true, passive: true });
    PAGES.addEventListener('touchend', e => {
      const st = t0; t0 = null; if (!st) return;
      const ct = [...(e.changedTouches || [])].find(x => x.identifier === st.id) || (e.changedTouches && e.changedTouches[0]);
      if (!ct || Date.now() - st.at > 600 || Math.hypot(ct.clientX - st.x, ct.clientY - st.y) > 12) return;
      const b = hit(ct.clientX, ct.clientY); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const pg = b.closest('.page[data-pi]'); if (!pg) return;
      const row = b.dataset.row != null ? b.dataset.row : b.dataset.vrow;
      openPad(+pg.dataset.pi, b.dataset.q, row != null ? +row : null, b.dataset.f);
    }, { capture: true, passive: false });
  }

    window.V21eu = { version: VERSION, VERSION, cellVal, quoteTotals, readTotals, drawTotalsUI, openFix, closeFix, closePad, openPad,
    migrateQuote, scrubPage, scrubNote, onRemoveLine, setTyped, rawOf, valKey,
    setVal(pi, qid, r, f, text) { const n = curNote(), pg = n && n.pages[pi], q = pg && pg.qsheet && pg.qsheet.quotes.find(x => x.id === qid);
      if (!q) return false; pushHistory(); setTyped(q, r, f, text); saveNote(n, true); refresh(pi); return true; } };

  const whenReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 60); setTimeout(() => clearInterval(t), 15000); };
  whenReady(() => { try { scrubAll(); const n = curNote(); if (n) { scrubNote(n); buildPages(); } } catch (_) {} });
})();
