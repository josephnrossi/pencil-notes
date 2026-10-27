/* Pencil Notes v21e4 — Quote form fields accept Apple Pencil handwriting.
   Write-in blanks on any page; Convert reads typed text and/or ink (HW / Grok / attach strokes).
   Builds on v21e2 + v21e3. Mock only. */
(function () {
  const QF_FIELDS = (window.V21e3 && V21e3.QUOTE_FIELDS) || [
    { key: 'distb', label: 'Distb' },
    { key: 'product', label: 'Product' },
    { key: 'size', label: 'Size' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'other', label: 'Other' }
  ];
  const HEAD_H = 44;   // ink units
  const ROW_H = 86;    // tall enough for Pencil
  const LAB_W = 108;
  const FORM_W = 560;
  const CONVERT_W = 108;

  function noteSealed(n) {
    try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; }
  }
  function ensureInkIds(form) {
    if (!form.inkIds) form.inkIds = { distb: [], product: [], size: [], quantity: [], other: [] };
    for (const { key } of QF_FIELDS) if (!Array.isArray(form.inkIds[key])) form.inkIds[key] = [];
    return form.inkIds;
  }
  function ensureFields(form) {
    form.fields = form.fields || { distb: '', product: '', size: '', quantity: '', other: '' };
    for (const { key } of QF_FIELDS) if (form.fields[key] == null) form.fields[key] = '';
    return form.fields;
  }

  function formHeight(form) {
    return HEAD_H + QF_FIELDS.length * ROW_H + 12;
  }

  /** Page-space rect for a field's write-in pad */
  function fieldPadRect(form, key) {
    const i = QF_FIELDS.findIndex(f => f.key === key); if (i < 0) return null;
    const isOther = key === 'other';
    const top = form.y + HEAD_H + i * ROW_H + 6;
    const left = form.x + LAB_W;
    const right = form.x + (form.w || FORM_W) - (isOther ? CONVERT_W + 8 : 10);
    const bottom = top + ROW_H - 14;
    return [left, top, right, bottom];
  }

  function pointInRect(x, y, r) {
    return r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  }

  function strokeInPad(st, rect) {
    const b = st.bb || bbox(st.points);
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return pointInRect(cx, cy, rect);
  }

  function findFormAt(pg, x, y) {
    for (const form of (pg.quoteForms || [])) {
      const h = formHeight(form), w = form.w || FORM_W;
      if (x >= form.x && x <= form.x + w && y >= form.y && y <= form.y + h) return form;
    }
    return null;
  }

  /** Claim a new stroke into a Quote form field when written in a pad. */
  function claimStroke(pi, st) {
    if (!st || st.tool === 'highlighter' || st.tool === 'eraser') return null;
    const n = curNote(); if (!n || noteSealed(n)) return null;
    const pg = n.pages[pi]; if (!pg || !(pg.quoteForms || []).length) return null;
    const b = st.bb || (st.bb = bbox(st.points));
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    for (const form of pg.quoteForms) {
      ensureInkIds(form);
      for (const { key } of QF_FIELDS) {
        const r = fieldPadRect(form, key);
        if (!pointInRect(cx, cy, r)) continue;
        // Avoid duplicates
        if (!form.inkIds[key].includes(st.id)) form.inkIds[key].push(st.id);
        // Tag stroke for debugging / later moves
        st.qf = { form: form.id, field: key };
        saveNote(n);
        // Don't let auto-number steal digits written in Quantity (etc.)
        if (typeof NUM !== 'undefined' && NUM.recent) NUM.recent = NUM.recent.filter(r => r.id !== st.id);
        return { form, key };
      }
    }
    return null;
  }

  function strokesForField(pg, form, key) {
    const ids = new Set(ensureInkIds(form)[key] || []);
    return (pg.strokes || []).filter(s => ids.has(s.id) || (s.qf && s.qf.form === form.id && s.qf.field === key));
  }

  /** Re-associate any page strokes that sit in pads (after load / move). */
  function reclaimInk(pi) {
    const n = curNote(); if (!n) return;
    const pg = n.pages[pi]; if (!pg || !(pg.quoteForms || []).length) return;
    for (const form of pg.quoteForms) {
      ensureInkIds(form);
      for (const { key } of QF_FIELDS) form.inkIds[key] = [];
      for (const st of pg.strokes || []) {
        if (st.tool === 'highlighter') continue;
        for (const { key } of QF_FIELDS) {
          if (strokeInPad(st, fieldPadRect(form, key))) {
            form.inkIds[key].push(st.id);
            st.qf = { form: form.id, field: key };
            break;
          }
        }
      }
    }
  }

  async function recognizeStrokes(strokes) {
    if (!strokes || !strokes.length) return '';
    // 1) On-device Handwriting Recognition API (not on iPad Safari)
    try {
      if (typeof HW !== 'undefined' && HW.state === 'ready' && HW.rec) {
        const d = HW.rec.startDrawing({ recognitionType: 'text', inputType: 'stylus' });
        let t = 0;
        for (const st of strokes) {
          const hs = new HandwritingStroke();
          for (const p of st.points) hs.addPoint({ x: p[0], y: p[1], t: (t += 8) });
          d.addStroke(hs); t += 120;
        }
        const preds = await d.getPrediction();
        if (d.clear) d.clear();
        const text = (preds && preds[0] && preds[0].text) || '';
        if (text.trim()) return text.trim();
      }
    } catch (_) {}
    // 2) Existing Grok / AI vision path when connected
    try {
      if (typeof aiReady === 'function' && aiReady() && typeof transcribe === 'function') {
        const t = await transcribe(strokes);
        if (t && t.trim()) return t.trim();
      }
    } catch (_) {}
    return '';
  }

  function cloneStrokesNorm(strokes, targetW) {
    if (!strokes.length) return [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of strokes) {
      const b = st.bb || bbox(st.points);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const tw = targetW || 260;
    const sc = Math.min(1.2, tw / w);
    const ox = 16, oy = 12;
    return strokes.map(st => {
      const pts = st.points.map(p => [+(ox + (p[0] - x0) * sc).toFixed(1), +(oy + (p[1] - y0) * sc).toFixed(1), p[2]]);
      return { id: uid('s'), tool: st.tool, color: st.color, width: +Math.max(0.8, (st.width || 2) * Math.max(sc, 0.45)).toFixed(2), points: pts, bb: bbox(pts) };
    });
  }

  async function resolveFieldValue(pg, form, key) {
    ensureFields(form);
    const typed = String(form.fields[key] || '').trim();
    const strokes = strokesForField(pg, form, key);
    let recognized = '';
    if (strokes.length) recognized = await recognizeStrokes(strokes);
    return {
      text: typed || recognized || '',
      typed,
      recognized,
      strokes,
      hasInk: strokes.length > 0
    };
  }

  function insertQuoteFormV4(pi, x, y, opts = {}) {
    const n = curNote(); if (!n || noteSealed(n)) { toast('🔒 Unlock the note to add a Quote form'); return null; }
    const pg = n.pages[pi]; if (!pg) return null;
    const near = (pg.quoteForms || []).find(f => Math.abs(f.y - y) < 80 && Math.abs(f.x - x) < 120);
    if (near && !opts.force) {
      toast('Quote form already here — write in the blanks, then Convert');
      renderQuoteFormsV4(pi);
      return near;
    }
    pushHistory();
    const form = {
      id: uid('qf'),
      x: Math.max(16, Math.min(PAGE_W - FORM_W - 8, x)),
      y: Math.max(16, Math.min(PAGE_H - formHeight({}), y)),
      w: FORM_W,
      fields: { distb: '', product: '', size: '', quantity: '', other: '' },
      inkIds: { distb: [], product: [], size: [], quantity: [], other: [] },
      v: 4
    };
    (pg.quoteForms ||= []).push(form);
    saveNote(n, true);
    renderQuoteFormsV4(pi);
    toast('Quote form — write with Pencil in each blank (or tap Aa to type), then Convert', 4200);
    return form;
  }

  function removeQuoteFormV4(pi, id) {
    const n = curNote(), pg = n.pages[pi]; if (!pg) return;
    pushHistory();
    const form = (pg.quoteForms || []).find(f => f.id === id);
    // Keep the ink on the page (user's handwriting) — only drop the form chrome
    if (form) {
      for (const st of pg.strokes || []) if (st.qf && st.qf.form === id) delete st.qf;
    }
    pg.quoteForms = (pg.quoteForms || []).filter(f => f.id !== id);
    saveNote(n, true); renderQuoteFormsV4(pi);
  }

  async function convertQuoteFormV4(pi, id) {
    const n = curNote(); if (!n) return;
    if (typeof qbSealed === 'function' && qbSealed()) { toast('🔒 Unlock the Quote Board first'); return; }
    const pg = n.pages[pi]; const form = (pg.quoteForms || []).find(f => f.id === id); if (!form) return;
    // Sync typed inputs from DOM if present
    const root = document.querySelector(`.qf-block[data-id="${id}"]`);
    ensureFields(form);
    if (root) {
      for (const { key } of QF_FIELDS) {
        const inp = root.querySelector(`input[data-qf="${key}"]`);
        if (inp && !inp.hidden) form.fields[key] = inp.value.trim();
      }
    }
    reclaimInk(pi);

    toast('Converting Quote form…', 1200);
    const vals = {};
    for (const { key } of QF_FIELDS) vals[key] = await resolveFieldValue(pg, form, key);

    const distb = vals.distb, product = vals.product, size = vals.size, quantity = vals.quantity, other = vals.other;
    const qtyRaw = (quantity.text || '').replace(/,/g, '');
    const qty = parseFloat(qtyRaw);
    const descParts = [];
    if (product.text) descParts.push(product.text);
    else if (product.hasInk) descParts.push('✍︎ Product');
    if (size.text) descParts.push(size.text);
    else if (size.hasInk && !size.text) descParts.push('✍︎ Size');
    let itemDesc = descParts.join(' · ');
    const items = (itemDesc || quantity.text || quantity.hasInk) ? [{
      desc: itemDesc || (quantity.hasInk ? '✍︎ Item' : 'Item'),
      qty: isFinite(qty) ? qty : null,
      unit: null
    }] : [];

    const customer = distb.text || (distb.hasInk ? '✍︎ Distb' : '');
    const notesParts = [];
    if (other.text) notesParts.push(other.text);
    else if (other.hasInk) notesParts.push('✍︎ Other (handwritten on card)');
    // Note which fields came from ink without text (iPad Safari)
    const inkOnly = QF_FIELDS.filter(({ key }) => vals[key].hasInk && !vals[key].text).map(f => f.label);
    if (inkOnly.length && !other.text) notesParts.push('Ink fields: ' + inkOnly.join(', '));

    const fields = {
      customer,
      notes: notesParts.join('\n'),
      specs: size.text ? [size.text] : (size.hasInk ? ['✍︎ Size'] : []),
      items: items.map(it => ({ desc: it.desc, qty: it.qty, unit: it.unit })),
      source: 'quote-form',
      subject: product.text ? ('Quote · ' + product.text) : (product.hasInk ? 'Quote · ✍︎' : 'Quote form'),
      date: Date.now()
    };

    const card = addManualQuote(fields);
    if (!card) return;

    // Attach all field ink onto the card body so Convert is never "empty" without OCR
    const allInk = [];
    for (const { key } of QF_FIELDS) allInk.push(...vals[key].strokes);
    if (allInk.length) {
      card.strokes = cloneStrokesNorm(allInk, 280);
      // Stack fields vertically with small gaps for readability on the card
      let yOff = 0;
      const stacked = [];
      for (const { key, label } of QF_FIELDS) {
        const sts = vals[key].strokes; if (!sts.length) continue;
        const chunk = cloneStrokesNorm(sts, 260);
        // label marker as tiny text via shifting
        for (const st of chunk) {
          st.points = st.points.map(p => [p[0], p[1] + yOff, p[2]]);
          st.bb = bbox(st.points);
          stacked.push(st);
        }
        let maxY = 0; for (const st of chunk) maxY = Math.max(maxY, st.bb[3]);
        yOff = maxY + 18;
      }
      card.strokes = stacked;
      card.q = card.q || {};
      card.q.inkFields = {};
      for (const { key } of QF_FIELDS) {
        if (vals[key].strokes.length) card.q.inkFields[key] = { n: vals[key].strokes.length, text: vals[key].text || '' };
      }
      const qn = ensureQuoteNote(); saveNote(qn, true);
    }

    // Remove claimed strokes from the note page + the form
    pushHistory();
    const kill = new Set(allInk.map(s => s.id));
    pg.strokes = (pg.strokes || []).filter(s => !kill.has(s.id));
    pg.quoteForms = (pg.quoteForms || []).filter(x => x.id !== id);
    saveNote(n, true); renderPageInk(pi); renderQuoteFormsV4(pi);

    if (typeof qbOpen === 'function') qbOpen(true, { mode: 'quotes' });
    if (typeof boardFlash === 'function') setTimeout(() => boardFlash(QPI, card.id), 120);
    const how = allInk.length
      ? (QF_FIELDS.some(({ key }) => vals[key].recognized) ? 'read handwriting + ink on card'
        : QF_FIELDS.some(({ key }) => vals[key].typed) ? 'typed + ink on card'
        : 'handwriting attached to card (no on-device OCR on this iPad)')
      : 'from typed fields';
    toast('💲 Quote card created — ' + how, 4200);
  }

  function renderQuoteFormsV4(pi) {
    const n = curNote(); if (!n || !pageEls[pi]) return;
    const ov = pageEls[pi].ov; if (!ov) return;
    ov.querySelectorAll('.qf-block').forEach(el => el.remove());
    const pg = n.pages[pi]; const s = S.scale;
    reclaimInk(pi);
    for (const form of (pg.quoteForms || [])) {
      ensureFields(form); ensureInkIds(form);
      if (!form.v || form.v < 4) { form.v = 4; form.w = FORM_W; ensureInkIds(form); }
      form.w = form.w || FORM_W;
      const el = document.createElement('div');
      el.className = 'qf-block qf-ink'; el.dataset.id = form.id;
      el.style.left = form.x * s + 'px';
      el.style.top = form.y * s + 'px';
      el.style.width = form.w * s + 'px';
      el.style.height = formHeight(form) * s + 'px';

      const rows = QF_FIELDS.map(({ key, label }, i) => {
        const isOther = key === 'other';
        const inkN = (form.inkIds[key] || []).length;
        const typed = form.fields[key] || '';
        const showType = !!form._typeOpen && form._typeOpen[key];
        return `<div class="qf-row" data-field="${key}" style="top:${(HEAD_H + i * ROW_H) * s}px;height:${ROW_H * s}px">
          <span class="qf-lab qf-hit">${label}:</span>
          <div class="qf-pad" aria-label="${label} — write here with Pencil">
            <span class="qf-pad-hint">${inkN ? '✍︎ ' + inkN + ' stroke' + (inkN > 1 ? 's' : '') : (typed ? '' : 'Write here')}</span>
            <input class="qf-type qf-hit" data-qf="${key}" type="text" value="${esc(typed)}" placeholder="Type…" autocomplete="off" ${showType || typed ? '' : 'hidden'} />
          </div>
          <button type="button" class="qf-aa qf-hit" data-qf-act="type" data-qf-key="${key}" title="Type instead">Aa</button>
          ${isOther ? '<button type="button" class="qf-convert qf-hit" data-qf-act="convert">Convert</button>' : ''}
        </div>`;
      }).join('');

      el.innerHTML = `
        <header class="qf-head qf-hit"><b>Quote</b><span class="qf-sub">Pencil in each blank</span>
          <button type="button" class="qf-x qf-hit" data-qf-act="del" aria-label="Remove Quote form">✕</button></header>
        <div class="qf-rows">${rows}</div>`;

      // Only .qf-hit receives pointer events — pads let Pencil through to the page
      el.addEventListener('click', e => {
        const act = e.target.closest('[data-qf-act]'); if (!act) return;
        e.preventDefault(); e.stopPropagation();
        const a = act.dataset.qfAct;
        if (a === 'convert') convertQuoteFormV4(pi, form.id);
        else if (a === 'del') removeQuoteFormV4(pi, form.id);
        else if (a === 'type') {
          form._typeOpen = form._typeOpen || {};
          form._typeOpen[act.dataset.qfKey] = !form._typeOpen[act.dataset.qfKey];
          const inp = el.querySelector(`input[data-qf="${act.dataset.qfKey}"]`);
          if (inp) {
            inp.hidden = !form._typeOpen[act.dataset.qfKey] && !inp.value;
            if (!inp.hidden) { inp.focus(); inp.select(); }
          }
        }
      });
      el.addEventListener('input', e => {
        const inp = e.target.closest('input[data-qf]'); if (!inp) return;
        form.fields[inp.dataset.qf] = inp.value;
        saveNote(n);
      });

      // Drag by header only
      const head = el.querySelector('.qf-head');
      head.addEventListener('pointerdown', e => {
        if (e.target.closest('[data-qf-act]')) return;
        e.preventDefault(); e.stopPropagation();
        const st = { pid: e.pointerId, x: e.clientX, y: e.clientY, fx: form.x, fy: form.y };
        const ids = new Set();
        for (const k of Object.keys(form.inkIds || {})) for (const id of form.inkIds[k]) ids.add(id);
        const mv = ev => {
          if (ev.pointerId !== st.pid) return;
          const dx = (ev.clientX - st.x) / S.scale, dy = (ev.clientY - st.y) / S.scale;
          form.x = Math.max(8, Math.min(PAGE_W - 200, st.fx + dx));
          form.y = Math.max(8, Math.min(PAGE_H - 120, st.fy + dy));
          el.style.left = form.x * S.scale + 'px'; el.style.top = form.y * S.scale + 'px';
          // Move claimed ink with the form
          for (const stroke of pg.strokes || []) {
            if (!ids.has(stroke.id)) continue;
            if (!stroke._qfOrig) stroke._qfOrig = stroke.points.map(p => p.slice());
            stroke.points = stroke._qfOrig.map(p => [p[0] + dx, p[1] + dy, p[2]]);
            stroke.bb = bbox(stroke.points);
          }
          renderPageInk(pi);
        };
        const up = ev => {
          if (ev.pointerId !== st.pid) return;
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
          for (const stroke of pg.strokes || []) if (ids.has(stroke.id)) delete stroke._qfOrig;
          reclaimInk(pi); saveNote(n, true); renderQuoteFormsV4(pi);
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });

      ov.append(el);
    }
  }

  // ---- Install overrides on V21e3 + stroke hook ----
  if (window.V21e3) {
    V21e3.insertQuoteForm = insertQuoteFormV4;
    V21e3.convertQuoteForm = convertQuoteFormV4;
    V21e3.renderQuoteForms = renderQuoteFormsV4;
  }

  // Replace overlay render used by v21e3
  const _ov = v7OverlayHook;
  v7OverlayHook = function (pi) {
    _ov(pi);
    // v21e3 also renders — remove its blocks then paint ours
    try {
      if (pageEls[pi] && pageEls[pi].ov) {
        // If v21e3 already painted .qf-block, we replace via renderQuoteFormsV4
      }
      renderQuoteFormsV4(pi);
    } catch (e) { console.warn('qf v4 render', e); }
  };

  // Claim strokes written into pads
  const _prevStroke = window.onStrokeAdded;
  window.onStrokeAdded = function (pi, st) {
    if (typeof _prevStroke === 'function') _prevStroke(pi, st);
    const hit = claimStroke(pi, st);
    if (hit) {
      // Refresh hint counts
      try { renderQuoteFormsV4(pi); } catch (_) {}
    }
  };


  // Re-bind UI that closed over v21e3's local insertQuoteForm (lasso / Insert / typed)
  const lassoBtn = document.getElementById('lassoQuoteForm');
  if (lassoBtn) {
    lassoBtn.onclick = () => {
      const sel = selection; if (!sel) return;
      const n = curNote(); if (!n || noteSealed(n)) return toast('🔒 Unlock the note first');
      const menu = document.getElementById('lassoMenu'); if (menu) menu.hidden = true;
      const pg = n.pages[sel.pi];
      const bb = sel.bb || (sel.ids.length && strokesBB(pg, sel.ids)) || [80, 160, 200, 220];
      pushHistory(); const keep = S.undo.length;
      if (sel.ids && sel.ids.length) pg.strokes = pg.strokes.filter(st => !sel.ids.includes(st.id));
      if (sel.texts && sel.texts.length) pg.texts = pg.texts.filter(tb => !sel.texts.includes(tb.id));
      if (typeof hideLasso === 'function') hideLasso();
      insertQuoteFormV4(sel.pi, bb[0], bb[1], { force: true });
      S.undo.length = keep; updateUndo(); saveNote(n, true); renderPageInk(sel.pi); rerenderOverlays();
    };
  }
  const ins = document.getElementById('insQuoteForm');
  if (ins) {
    ins.onclick = () => {
      const m = document.getElementById('insertMenu'); if (m) m.hidden = true;
      const pages = document.getElementById('pages');
      const pi = (typeof curPi === 'function') ? 0 : 0;
      let best = 0;
      try {
        const mid = ((pages && pages.scrollTop) || 0) + innerHeight / 3;
        let bd = Infinity;
        for (let i = 0; i < pageEls.length; i++) {
          const el = pageEls[i] && pageEls[i].el; if (!el) continue;
          const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid);
          if (d < bd) { bd = d; best = i; }
        }
      } catch (_) {}
      const y = (((pages && pages.scrollTop) || 0) / (S.scale || 1)) + 160;
      insertQuoteFormV4(best, 48, Math.min(PAGE_H - 420, Math.max(60, y)));
    };
  }

  // Expose
  window.V21e4 = {
    insertQuoteForm: insertQuoteFormV4,
    convertQuoteForm: convertQuoteFormV4,
    renderQuoteForms: renderQuoteFormsV4,
    claimStroke, fieldPadRect, recognizeStrokes, strokesForField, reclaimInk
  };
})();
