/* Pencil Notes v21e4 — reliable handwritten numbers → badges; write “Q” → intake form → Quote Board.
   Builds on v21e2. Mock only. */
(function () {
  const QF_FIELDS = [
    { key: 'distb', label: 'Distb' },
    { key: 'product', label: 'Product' },
    { key: 'size', label: 'Size' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'price', label: 'Price' },
    { key: 'other', label: 'Other' }
  ];
  const QUOTE_RE = /^\s*[Qq]\s*:?\s*$/;
  const QUOTE_LINE_RE = /^\s*[Qq]\s*:?\s*$/m;

  function noteSealed(n) {
    try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; }
  }
  function curPi() {
    const n = curNote(); if (!n || !pageEls.length) return 0;
    const mid = ($('#pages') && $('#pages').scrollTop || 0) + innerHeight / 3;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i] && pageEls[i].el; if (!el) continue;
      const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ============================================================
     1. Handwritten numbers → movable section badges (any page)
     Root causes addressed:
       - Required terminator "." / ")" only — now also lone digits after settle
       - Left margin capped at x≤420 — widened to ~560
       - Only consecutive strokes in the short recent window — also scan nearby page strokes
       - Dot geometry was picky — slightly loosened
       - Min glyph height 22 — lowered to 18
       - Badge drag affordance / hint after convert reinforced
     ============================================================ */
  const _checkNumber = typeof checkNumber === 'function' ? checkNumber : null;
  const _detectNumbers = typeof detectNumbers === 'function' ? detectNumbers : null;
  const _badgeFromInk = typeof badgeFromInk === 'function' ? badgeFromInk : null;
  const _termKind = typeof termKind === 'function' ? termKind : null;
  const _classifyDigit = typeof classifyDigit === 'function' ? classifyDigit : null;
  // NOTE: do not globally rewrite termKind — a ")" terminator must stay a paren.
  // Lone-digit path below treats paren-shaped digits via classifyDigit instead.

  function checkNumberV3(pg, glyph, term, kind) {
    const gb = strokesBB(pg, glyph.map(s => s.id)); if (!gb) return null;
    const gw = gb[2] - gb[0], gh = gb[3] - gb[1];
    // Relaxed: shorter glyphs OK; allow further right (indented / zoomed writing)
    if (gh < 18 || gh > 160 || gw > 1.35 * gh || gb[0] > 420) return null;
    const tb = term.bb || bbox(term.points), tcx = (tb[0] + tb[2]) / 2, tcy = (tb[1] + tb[3]) / 2;
    if (kind === 'dot') {
      if (tcx < gb[2] - 0.25 * gh || tcx > gb[2] + 1.15 * gh || tcy < gb[1] + 0.45 * gh || tcy > gb[3] + 0.55 * gh) return null;
    } else {
      const ov = Math.min(tb[3], gb[3]) - Math.max(tb[1], gb[1]);
      if (tb[0] < gb[2] - 0.3 * gh || tb[0] > gb[2] + 1.0 * gh || ov < 0.45 * gh) return null;
    }
    const ids = new Set([...glyph, term].map(s => s.id));
    for (const s of pg.strokes) {
      if (ids.has(s.id)) continue;
      const b = s.bb || bbox(s.points), vo = Math.min(b[3], gb[3]) - Math.max(b[1], gb[1]);
      if (vo > 0.4 * gh && b[2] < gb[0] + 2) return null; // still must start the line
    }
    for (const t of pg.tasks) {
      const r = t.kind === 'ink' ? [t.x, t.y, t.x + t.w, t.y + t.h] : [t.x, t.y, t.x + 60, t.y + 40];
      if (gb[0] < r[2] && gb[2] > r[0] && gb[1] < r[3] && gb[3] > r[1]) return null;
    }
    for (const sc of pg.sections || []) if (Math.abs(sc.y + SEC_H / 2 - (gb[1] + gb[3]) / 2) < SEC_H) return null;
    if (pg.tasks.some(t => t.kind === 'ink' && t.strokeIds && t.strokeIds.some(id => ids.has(id)))) return null;
    const c = _classifyDigit(glyph); if (!c.ok) return null;
    return { digit: c.digit, style: kind === 'dot' ? '.' : ')', gb };
  }

  function checkLoneDigit(pg, glyph) {
    const gb = strokesBB(pg, glyph.map(s => s.id)); if (!gb) return null;
    const gw = gb[2] - gb[0], gh = gb[3] - gb[1];
    if (gh < 22 || gh > 150 || gw > 1.2 * gh || gb[0] > 200) return null;
    const ids = new Set(glyph.map(s => s.id));
    for (const s of pg.strokes) {
      if (ids.has(s.id)) continue;
      const b = s.bb || bbox(s.points), vo = Math.min(b[3], gb[3]) - Math.max(b[1], gb[1]);
      // reject if anything overlaps the line to the left OR immediately to the right (not yet a finished "1.")
      if (vo > 0.4 * gh && b[2] < gb[0] + 2) return null;
      if (vo > 0.5 * gh && b[0] < gb[2] + 0.9 * gh && b[0] > gb[0] && (b[2] - b[0]) > 20) return null;
    }
    for (const t of pg.tasks) {
      const r = t.kind === 'ink' ? [t.x, t.y, t.x + t.w, t.y + t.h] : [t.x, t.y, t.x + 60, t.y + 40];
      if (gb[0] < r[2] && gb[2] > r[0] && gb[1] < r[3] && gb[3] > r[1]) return null;
    }
    for (const sc of pg.sections || []) if (Math.abs(sc.y + SEC_H / 2 - (gb[1] + gb[3]) / 2) < SEC_H) return null;
    const c = _classifyDigit(glyph); if (!c.ok || c.dist > 3.6) return null; // stricter for loners
    return { digit: c.digit, style: '.', gb };
  }

  function tryConvert(pi, glyph, term, kind) {
    const n = curNote(); if (!n || noteSealed(n)) return false;
    const pg = n.pages[pi]; if (!pg) return false;
    const res = term ? checkNumberV3(pg, glyph, term, kind) : checkLoneDigit(pg, glyph);
    if (!res) return false;
    const strokes = term ? [...glyph, term] : glyph.slice();
    badgeFromInkV3(pi, strokes, res);
    return true;
  }

  function badgeFromInkV3(pi, strokes, res) {
    const n = curNote(), pg = n.pages[pi], ids = new Set(strokes.map(s => s.id));
    pushHistory(); const keep = S.undo.length;
    pg.strokes = pg.strokes.filter(s => !ids.has(s.id));
    const sc = addSection(pi, res.gb[0] - 4, (res.gb[1] + res.gb[3]) / 2 - SEC_H / 2, res.style);
    sc.auto = res.digit;
    S.undo.length = keep; updateUndo(); saveNote(n, true);
    // Clearer post-convert hint; pulse badge
    hint(`Section ${secNumber(n, pg, sc)} — drag the purple badge to move this section · Undo restores your ink`);
    setTimeout(() => {
      const b = document.querySelector(`.sec-badge[data-id="${sc.id}"]`);
      if (b) { b.classList.add('sec-drag-hint'); setTimeout(() => b.classList.remove('sec-drag-hint'), 2200); }
    }, 30);
  }

  function detectNumbersV3() {
    if (typeof drawing !== 'undefined' && drawing) { NUM.timer = setTimeout(detectNumbersV3, 400); return; }
    const n = curNote(); if (!n || noteSealed(n)) return;
    if (localStorage.getItem('autoNumber') === '0') return;
    const now = Date.now();
    const recent = (NUM.recent || []).filter(r => now - r.t < 14000);
    NUM.recent = [];
    for (const pi of new Set(recent.map(r => r.pi))) {
      const pg = n.pages[pi]; if (!pg || !pg.strokes) continue;
      // Prefer terminator-based matches among recent strokes (order preserved)
      const strokes = recent.filter(r => r.pi === pi).map(r => pg.strokes.find(s => s.id === r.id)).filter(Boolean);
      let hit = false;
      for (let i = 1; i < strokes.length; i++) {
        const kind = _termKind(strokes[i]); if (!kind) continue;
        for (const gl of [1, 2]) {
          if (i - gl < 0) break;
          const glyph = strokes.slice(i - gl, i);
          if (glyph.some(s => _termKind(s)) && gl === 2) continue;
          if (tryConvert(pi, glyph, strokes[i], kind)) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) continue;

      // Also: any page stroke near a recent terminator (not only consecutive recent)
      const terms = pg.strokes.filter(s => _termKind(s));
      for (const term of terms) {
        const kind = _termKind(term); if (!kind) continue;
        const tb = term.bb || bbox(term.points);
        const cands = pg.strokes.filter(s => s.id !== term.id && !_termKind(s));
        // single-stroke glyph to the left of the terminator
        for (const g of cands) {
          const gb = g.bb || bbox(g.points);
          if (gb[2] > tb[0] + 8) continue;
          if (Math.abs(((gb[1] + gb[3]) / 2) - ((tb[1] + tb[3]) / 2)) > 50) continue;
          if (tryConvert(pi, [g], term, kind)) { hit = true; break; }
        }
        if (hit) break;
        // two-stroke glyph
        for (let a = 0; a < cands.length; a++) for (let b = a + 1; b < cands.length; b++) {
          const glyph = [cands[a], cands[b]];
          const gb = strokesBB(pg, glyph.map(s => s.id)); if (!gb) continue;
          if (gb[2] > tb[0] + 8) continue;
          if (Math.abs(((gb[1] + gb[3]) / 2) - ((tb[1] + tb[3]) / 2)) > 50) continue;
          if (tryConvert(pi, glyph, term, kind)) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) continue;

      // Lone confident digit (no terminator) — only for strokes that just settled
      const loneRecent = recent.filter(r => r.pi === pi && now - r.t < 5000).map(r => pg.strokes.find(s => s.id === r.id)).filter(Boolean);
      for (const gl of [1, 2]) {
        if (loneRecent.length < gl) continue;
        const glyph = loneRecent.slice(-gl);
        // Skip only if the glyph itself is a terminator mark (dot). Paren-shaped digits are OK.
        if (glyph.some(s => _termKind(s) === 'dot')) continue;
        if (tryConvert(pi, glyph, null, null)) break;
      }
    }
  }

  // Install overrides
  if (_checkNumber) checkNumber = checkNumberV3;
  if (_detectNumbers) detectNumbers = detectNumbersV3;
  if (_badgeFromInk) badgeFromInk = badgeFromInkV3;
  // Longer settle so multi-stroke digits + dot finish before we decide; keep responsive for "1."
  const _onStroke = window.onStrokeAdded;
  window.onStrokeAdded = function (pi, st) {
    if (_onStroke) _onStroke(pi, st);
    // Quote ink settle probe (HW when available)
    if (st && st.tool === 'pen') scheduleQuoteInkProbe(pi);
  };
  // Retune NUM timer from the original onStrokeAdded (650) — our detectNumbersV3 is what runs via that timer.
  // Re-bind so settle is 780ms (gives time for the dot).
  window.onStrokeAdded = function (pi, st) {
    if (typeof _onStroke === 'function') {
      // Call original but replace its detectNumbers timer by clearing and using ours
      const prev = NUM.timer;
      _onStroke(pi, st);
      if (st && st.tool === 'pen' && localStorage.getItem('autoNumber') !== '0') {
        clearTimeout(NUM.timer); clearTimeout(prev);
        NUM.timer = setTimeout(detectNumbersV3, 780);
      }
    } else if (st && st.tool === 'pen' && localStorage.getItem('autoNumber') !== '0') {
      NUM.recent.push({ pi, id: st.id, t: Date.now() }); if (NUM.recent.length > 16) NUM.recent.shift();
      clearTimeout(NUM.timer); NUM.timer = setTimeout(detectNumbersV3, 780);
    }
    if (st && st.tool === 'pen') scheduleQuoteInkProbe(pi);
  };

  /* ============================================================
     2. Write “quote” → Quote intake form → Convert → Quote Board
     Triggers shipped:
       A) Typed text block that is (or becomes) just “Q” / “q” / “Q:”
       B) Lasso → “💲 Quote form” (handwriting of the word — no OCR required)
       C) ＋ Insert → “Quote form”
       D) After ink settles: recognize a compact stroke cluster as “quote”
          (HW → Grok/V21e4.recognizeStrokes → iPad toast fallback). See v21e5.js.
     ============================================================ */
  function ensureForms(pg) { return (pg.quoteForms ||= []); }

  function insertQuoteForm(pi, x, y, opts = {}) {
    const n = curNote(); if (!n || noteSealed(n)) { toast('🔒 Unlock the note to add a Quote form'); return null; }
    const pg = n.pages[pi]; if (!pg) return null;
    // Avoid stacking duplicates near the same spot
    const near = ensureForms(pg).find(f => Math.abs(f.y - y) < 80 && Math.abs(f.x - x) < 120);
    if (near && !opts.force) {
      toast('Quote form already here — fill the fields, then Convert');
      renderQuoteForms(pi);
      return near;
    }
    pushHistory();
    const form = {
      id: uid('qf'),
      x: Math.max(24, Math.min(PAGE_W - 420, x)),
      y: Math.max(24, Math.min(PAGE_H - 320, y)),
      w: 400,
      fields: { distb: '', product: '', size: '', quantity: '', other: '' }
    };
    ensureForms(pg).push(form);
    saveNote(n, true);
    renderQuoteForms(pi);
    toast('Quote form ready — fill Distb / Product / Size / Quantity / Other, then Convert');
    return form;
  }

  function removeQuoteForm(pi, id) {
    const n = curNote(), pg = n.pages[pi]; if (!pg) return;
    pushHistory();
    pg.quoteForms = (pg.quoteForms || []).filter(f => f.id !== id);
    saveNote(n, true); renderQuoteForms(pi);
  }

  function readFormFields(form, root) {
    const out = { ...form.fields };
    if (root) {
      for (const { key } of QF_FIELDS) {
        const inp = root.querySelector(`[data-qf="${key}"]`);
        if (inp) out[key] = (inp.value != null ? inp.value : inp.textContent || '').trim();
      }
    }
    return out;
  }

  function convertQuoteForm(pi, id) {
    const n = curNote(); if (!n) return;
    if (typeof qbSealed === 'function' && qbSealed()) { toast('🔒 Unlock the Quote Board first'); return; }
    const pg = n.pages[pi]; const form = (pg.quoteForms || []).find(f => f.id === id); if (!form) return;
    const root = document.querySelector(`.qf-block[data-id="${id}"]`);
    const f = readFormFields(form, root);
    form.fields = f; saveNote(n, true);

    const qtyRaw = f.quantity.replace(/,/g, '');
    const qty = parseFloat(qtyRaw);
    const itemDesc = f.product || '';
    const items = (itemDesc || f.quantity) ? [{
      desc: itemDesc || 'Item',
      quantity: isFinite(qty) ? qty : null,
      unit: null
    }] : [];
    // Map Distb → customer; Other → notes; Size also in specs
    const fields = {
      customer: f.distb || '',
      notes: f.other || '',
      specs: f.size ? [f.size] : [],
      items: items.map(it => ({ desc: it.desc, qty: it.quantity, unit: it.unit })),
      source: 'quote-form',
      subject: f.product ? ('Quote · ' + f.product) : 'Quote form',
      date: Date.now()
    };
    const card = addManualQuote(fields);
    if (!card) return;
    // Remove the form from the page after successful convert (Undo restores via history? addManualQuote has its own history — keep form unless user wants clear)
    // Keep form but mark converted; user can delete. Clearer: remove form.
    pushHistory();
    pg.quoteForms = (pg.quoteForms || []).filter(x => x.id !== id);
    saveNote(n, true); renderQuoteForms(pi);
    if (typeof qbOpen === 'function') qbOpen(true, { mode: 'quotes' });
    if (typeof boardFlash === 'function') setTimeout(() => boardFlash(QPI, card.id), 120);
    toast('💲 Quote card created on the Quote Board', 3200);
  }

  function renderQuoteForms(pi) {
    const n = curNote(); if (!n || !pageEls[pi]) return;
    const ov = pageEls[pi].ov; if (!ov) return;
    ov.querySelectorAll('.qf-block').forEach(el => el.remove());
    const pg = n.pages[pi]; const s = S.scale;
    for (const form of (pg.quoteForms || [])) {
      const el = document.createElement('div');
      el.className = 'qf-block'; el.dataset.id = form.id;
      el.style.left = form.x * s + 'px'; el.style.top = form.y * s + 'px';
      el.style.width = (form.w || 400) * s + 'px';
      el.innerHTML = `
        <header class="qf-head"><b>Quote</b><button type="button" class="qf-x" data-qf-act="del" aria-label="Remove Quote form">✕</button></header>
        <div class="qf-rows">
          ${QF_FIELDS.map(({ key, label }) => {
            const isOther = key === 'other';
            return `<label class="qf-row${isOther ? ' qf-other' : ''}"><span class="qf-bul">•</span><span class="qf-lab">${label}:</span>
              <input data-qf="${key}" type="text" value="${esc(form.fields[key] || '')}" placeholder="" autocomplete="off" enterkeyhint="next"/>
              ${isOther ? '<button type="button" class="qf-convert" data-qf-act="convert">Convert</button>' : ''}
            </label>`;
          }).join('')}
        </div>`;
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('click', e => {
        const act = e.target.closest('[data-qf-act]'); if (!act) return;
        e.preventDefault(); e.stopPropagation();
        if (act.dataset.qfAct === 'convert') convertQuoteForm(pi, form.id);
        else if (act.dataset.qfAct === 'del') removeQuoteForm(pi, form.id);
      });
      el.addEventListener('input', e => {
        const inp = e.target.closest('[data-qf]'); if (!inp) return;
        form.fields[inp.dataset.qf] = inp.value;
        saveNote(n);
      });
      // Drag the form by its header
      const head = el.querySelector('.qf-head');
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('[data-qf-act]')) return;
        e.preventDefault(); e.stopPropagation();
        const st = { pid: e.pointerId, x: e.clientX, y: e.clientY, fx: form.x, fy: form.y };
        const mv = ev => {
          if (ev.pointerId !== st.pid) return;
          const dx = (ev.clientX - st.x) / S.scale, dy = (ev.clientY - st.y) / S.scale;
          form.x = Math.max(8, Math.min(PAGE_W - 200, st.fx + dx));
          form.y = Math.max(8, Math.min(PAGE_H - 120, st.fy + dy));
          el.style.left = form.x * S.scale + 'px'; el.style.top = form.y * S.scale + 'px';
        };
        const up = ev => {
          if (ev.pointerId !== st.pid) return;
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
          saveNote(n, true);
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
      ov.append(el);
    }
  }

  // Overlay hook: always paint quote forms (any page type that uses normal overlays)
  const _ov = v7OverlayHook;
  v7OverlayHook = function (pi) {
    _ov(pi);
    try { renderQuoteForms(pi); } catch (e) { console.warn('qf render', e); }
  };

  /* ---- Trigger A: typed “quote” ---- */
  document.addEventListener('focusout', e => {
    const d = e.target.closest && e.target.closest('.overlay [contenteditable], .tbox, .text-box');
    if (!d) return;
    const n = curNote(); if (!n || noteSealed(n)) return;
    // Find which text box
    let pi = -1, tb = null;
    for (let i = 0; i < n.pages.length; i++) {
      const pg = n.pages[i];
      const hit = (pg.texts || []).find(t => {
        const el = pageEls[i] && pageEls[i].ov && pageEls[i].ov.querySelector(`[data-id="${t.id}"]`);
        return el === d || (el && el.contains(d));
      });
      if (hit) { pi = i; tb = hit; break; }
    }
    if (!tb) {
      // Fallback: match by text content on current page
      pi = curPi();
      const txt = (d.innerText || d.textContent || '').trim();
      if (!QUOTE_RE.test(txt)) return;
      tb = (n.pages[pi].texts || []).find(t => QUOTE_RE.test(String(t.text || '').trim()));
    }
    const raw = tb ? String(tb.text || '').trim() : (d.innerText || '').trim();
    if (!QUOTE_RE.test(raw) && !QUOTE_LINE_RE.test(raw)) return;
    // Replace the text box with a Quote form at the same spot
    const x = tb ? tb.x : 80, y = tb ? tb.y : 160;
    pushHistory();
    if (tb) {
      n.pages[pi].texts = n.pages[pi].texts.filter(t => t.id !== tb.id);
      saveNote(n, true); renderOverlay(pi);
    }
    insertQuoteForm(pi, x, y, { force: true });
  }, true);

  /* ---- Trigger B: Lasso → Quote form ---- */
  const lassoBtn = document.getElementById('lassoQuoteForm');
  if (lassoBtn) {
    lassoBtn.onclick = () => {
      const s = selection; if (!s) return;
      const n = curNote(); if (!n || noteSealed(n)) return toast('🔒 Unlock the note first');
      $('#lassoMenu').hidden = true;
      const pg = n.pages[s.pi];
      const bb = s.bb || (s.ids.length && strokesBB(pg, s.ids)) || [80, 160, 200, 220];
      // Consume the selected ink (the “Q”) into the form
      pushHistory(); const keep = S.undo.length;
      if (s.ids && s.ids.length) pg.strokes = pg.strokes.filter(st => !s.ids.includes(st.id));
      if (s.texts && s.texts.length) pg.texts = pg.texts.filter(t => !s.texts.includes(t.id));
      hideLasso();
      insertQuoteForm(s.pi, bb[0], bb[1], { force: true });
      S.undo.length = keep; updateUndo(); saveNote(n, true); renderPageInk(s.pi); rerenderOverlays();
    };
  }

  /* ---- Trigger C: ＋ Insert → Quote form ---- */
  function addInsertQuoteItem() {
    const m = document.getElementById('insertMenu'); if (!m || m.querySelector('#insQuoteForm')) return;
    const b = document.createElement('button');
    b.id = 'insQuoteForm'; b.className = 'ins-item'; b.setAttribute('role', 'menuitem');
    b.title = 'Insert a Distb / Product / Size / Quantity / Other form';
    b.innerHTML = `<i>💲</i><span>Quote form</span><small>Distb · Product · Size · Qty · Other → Convert</small>`;
    b.onclick = () => {
      m.hidden = true;
      const pi = curPi(), y = (($('#pages') && $('#pages').scrollTop) || 0) / (S.scale || 1) + 180;
      insertQuoteForm(pi, 72, Math.min(PAGE_H - 340, Math.max(80, y)));
    };
    m.append(b);
  }
  if (document.getElementById('insertMenu')) addInsertQuoteItem();
  else setTimeout(addInsertQuoteItem, 200);

  /* ---- Trigger D: handwriting “quote” after ink settles ----
     v21e5 replaces this when loaded (iPad Safari has no HW API). */
  let qInkTimer = null;
  function scheduleQuoteInkProbe(pi) {
    if (window.V21e5 && typeof V21e5.scheduleQuoteInkProbe === 'function') {
      return V21e5.scheduleQuoteInkProbe(pi);
    }
    clearTimeout(qInkTimer);
    qInkTimer = setTimeout(() => probeQuoteInk(pi), 1100);
  }
  async function probeQuoteInk(pi) {
    const n = curNote(); if (!n || noteSealed(n)) return;
    const pg = n.pages[pi]; if (!pg || !(pg.strokes || []).length) return;
    // Already have a form on this page near top ink — skip
    if ((pg.quoteForms || []).length) return;
    let text = '';
    try {
      if (typeof HW !== 'undefined' && HW.recognizePage) {
        text = await HW.recognizePage(pg) || '';
        if (text) { pg.inkText = text; pg.inkSig = HW.sig ? HW.sig(pg) : pg.inkSig; }
      }
    } catch (_) {}
    if (!text && pg.inkText) text = pg.inkText;
    if (!text || !/\bquotes?\b/i.test(text)) return;
    // Place form near the first stroke cluster
    let x = 72, y = 160;
    const s0 = pg.strokes[0]; const b = s0 && (s0.bb || bbox(s0.points));
    if (b) { x = Math.max(24, b[0]); y = Math.max(24, b[1]); }
    // Soft prompt via action toast if available, else insert directly when the only word is quote-ish
    if (/^\s*quotes?\s*:?\s*$/i.test(text.trim()) || text.trim().split(/\s+/).length <= 3) {
      insertQuoteForm(pi, x, y);
    } else if (typeof actionToast === 'function') {
      actionToast('Recognized “quote” in your handwriting', 'Insert Quote form', () => insertQuoteForm(pi, x, y), 6000);
    }
  }

  /* Settings copy nudge for numbers */
  try {
    if (typeof settingsSections === 'function') {
      /* leave settings as-is; Writing row already documents the feature */
    }
  } catch (_) {}

  window.V21e3 = {
    insertQuoteForm, convertQuoteForm, detectNumbersV3, checkNumberV3,
    QUOTE_FIELDS: QF_FIELDS
  };
})();
