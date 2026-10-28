/* Pencil Notes v21e7 — Quote Convert maps fields once (no Size duplicate); pad claim uses DOM rects.
   Builds on v21e6. Mock only. */
(function () {
  const QF_FIELDS = (window.V21e3 && V21e3.QUOTE_FIELDS) || [
    { key: 'distb', label: 'Distb' },
    { key: 'product', label: 'Product' },
    { key: 'size', label: 'Size' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'other', label: 'Other' }
  ];

  const _geomPad = window.V21e4 && typeof V21e4.fieldPadRect === 'function'
    ? V21e4.fieldPadRect.bind(V21e4)
    : null;

  /** Page-space rect from the live .qf-pad element (matches Pencil hit). */
  function domPadRect(pi, form, key) {
    try {
      const rec = pageEls[pi]; if (!rec || !rec.ov || !rec.el) return null;
      const pad = rec.ov.querySelector(`.qf-block[data-id="${form.id}"] .qf-row[data-field="${key}"] .qf-pad`);
      if (!pad) return null;
      const pageR = rec.el.getBoundingClientRect();
      const br = pad.getBoundingClientRect();
      const s = (typeof S !== 'undefined' && S.scale) ? S.scale : 1;
      if (br.width < 4 || br.height < 4) return null;
      return [
        (br.left - pageR.left) / s,
        (br.top - pageR.top) / s,
        (br.right - pageR.left) / s,
        (br.bottom - pageR.top) / s
      ];
    } catch (_) { return null; }
  }

  function fieldPadRect(form, key, pi) {
    if (pi == null) {
      try {
        const n = curNote();
        if (n) {
          for (let i = 0; i < n.pages.length; i++) {
            if ((n.pages[i].quoteForms || []).some(f => f.id === form.id)) { pi = i; break; }
          }
        }
      } catch (_) {}
    }
    if (pi != null && form) {
      const d = domPadRect(pi, form, key);
      if (d) return d;
    }
    return _geomPad ? _geomPad(form, key) : null;
  }

  function pointInRect(x, y, r) {
    return r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  }

  function claimStroke(pi, st) {
    if (!st || st.tool === 'highlighter' || st.tool === 'eraser') return null;
    const n = curNote(); if (!n) return null;
    try { if (typeof isSealed === 'function' && isSealed(n)) return null; } catch (_) {}
    const pg = n.pages[pi]; if (!pg || !(pg.quoteForms || []).length) return null;
    const b = st.bb || (st.bb = bbox(st.points));
    // Prefer last point (where Pencil lifted) then centroid — reduces “next field” misses
    const last = st.points && st.points[st.points.length - 1];
    const probes = [];
    if (last) probes.push([last[0], last[1]]);
    probes.push([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    if (st.points && st.points[0]) probes.push([st.points[0][0], st.points[0][1]]);

    for (const form of pg.quoteForms) {
      if (!form.inkIds) form.inkIds = { distb: [], product: [], size: [], quantity: [], other: [] };
      for (const { key } of QF_FIELDS) {
        const r = fieldPadRect(form, key, pi);
        if (!r) continue;
        const hit = probes.some(([x, y]) => pointInRect(x, y, r));
        if (!hit) continue;
        if (!form.inkIds[key].includes(st.id)) form.inkIds[key].push(st.id);
        st.qf = { form: form.id, field: key };
        saveNote(n);
        if (typeof NUM !== 'undefined' && NUM.recent) NUM.recent = NUM.recent.filter(r => r.id !== st.id);
        return { form, key };
      }
    }
    return null;
  }

  /** Build card fields without duplicating Size into the product/item line. */
  function mapFormToQuoteFields(vals) {
    const distb = vals.distb || {}, product = vals.product || {}, size = vals.size || {};
    const quantity = vals.quantity || {}, other = vals.other || {};
    const qtyRaw = String(quantity.text || '').replace(/,/g, '');
    const qty = parseFloat(qtyRaw);
    let itemDesc = '';
    if (product.text) itemDesc = product.text;
    else if (product.hasInk) itemDesc = '✍︎ Product';
    const items = (itemDesc || quantity.text || quantity.hasInk) ? [{
      desc: itemDesc || (quantity.hasInk ? '✍︎ Item' : 'Item'),
      qty: isFinite(qty) ? qty : null,
      unit: null
    }] : [];
    const customer = distb.text || (distb.hasInk ? '✍︎ Distb' : '');
    const notesParts = [];
    if (other.text) notesParts.push(other.text);
    else if (other.hasInk) notesParts.push('✍︎ Other (handwritten on card)');
    const inkOnly = QF_FIELDS.filter(({ key }) => vals[key] && vals[key].hasInk && !vals[key].text).map(f => f.label);
    if (inkOnly.length && !other.text) notesParts.push('Ink fields: ' + inkOnly.join(', '));
    return {
      customer,
      notes: notesParts.join('\n'),
      specs: size.text ? [size.text] : (size.hasInk ? ['✍︎ Size'] : []),
      items: items.map(it => ({ desc: it.desc, qty: it.qty, unit: it.unit })),
      source: 'quote-form',
      subject: product.text ? ('Quote · ' + product.text) : (product.hasInk ? 'Quote · ✍︎' : 'Quote form'),
      date: Date.now()
    };
  }

  // Install overrides
  if (window.V21e4) {
    V21e4.fieldPadRect = function (form, key) { return fieldPadRect(form, key); };
    V21e4.claimStroke = claimStroke;
    V21e4.mapFormToQuoteFields = mapFormToQuoteFields;
  }

  // Wrap convert to force clean mapping even if older convert still joins size into desc
  const _convert = window.V21e4 && V21e4.convertQuoteForm;
  if (typeof _convert === 'function') {
    // Patch by wrapping resolve path: monkey-patch after convert builds fields is hard.
    // Instead re-bind convertQuoteForm with a thin wrapper that rewrites q before save is late.
    // Safest: replace convert entirely by calling original resolve pieces — override install below.
  }

  function clearStrokeClaim(pi, st) {
    if (!st || !st.qf) return;
    try {
      const n = curNote(); const pg = n && n.pages[pi]; if (!pg) return;
      for (const form of (pg.quoteForms || [])) {
        const ids = form.inkIds || {};
        for (const k of Object.keys(ids)) ids[k] = (ids[k] || []).filter(id => id !== st.id);
      }
      delete st.qf;
    } catch (_) {}
  }

  // Re-bind claim: v21e4 closed over its local claimStroke — re-run with DOM rects
  const _prev = window.onStrokeAdded;
  window.onStrokeAdded = function (pi, st) {
    if (typeof _prev === 'function') _prev(pi, st);
    if (!st || st.tool === 'highlighter' || st.tool === 'eraser') return;
    try {
      clearStrokeClaim(pi, st);
      const hit = claimStroke(pi, st);
      if (hit) {
        if (window.V21e6 && typeof V21e6.enhanceRenderedForms === 'function') V21e6.enhanceRenderedForms(pi);
        else if (window.V21e4 && typeof V21e4.renderQuoteForms === 'function') V21e4.renderQuoteForms(pi);
      }
    } catch (_) {}
  };

  // Patch convertQuoteFormV4 result mapping: intercept addManualQuote for quote-form source
  // Cleaner: override V21e4.convertQuoteForm by wrapping vals→fields inside a new convert.
  // Copy convert from v21e4 is heavy; instead patch the join at runtime via mapFormToQuoteFields
  // by replacing convertQuoteForm with async function that duplicates v21e4 flow briefly.

  async function convertQuoteFormV7(pi, id) {
    // Delegate to v21e4 convert but fix card.q after if size leaked into item desc
    if (typeof _convert === 'function') {
      // Pre-hook: temporarily wrap addManualQuote
      const _add = typeof addManualQuote === 'function' ? addManualQuote : null;
      let fixedCard = null;
      if (_add) {
        window.addManualQuote = function (fields, col) {
          if (fields && fields.source === 'quote-form') {
            // If caller still stuffed size into item desc, strip: rebuild from known pattern
            // Prefer explicit remap when we can read the form again
            const n = curNote(); const pg = n && n.pages[pi];
            const form = pg && (pg.quoteForms || []).find(f => f.id === id);
            // fields already built — sanitize:
            const specs = fields.specs || [];
            const items = (fields.items || []).map(it => {
              let desc = it.desc || '';
              for (const sp of specs) {
                if (!sp || sp.indexOf('✍') === 0) continue;
                // Remove " · <size>" or " <size>" suffix duplicates
                const esc = sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                desc = desc.replace(new RegExp('(?:\\s*·\\s*|\\s+)' + esc + '\\s*$'), '').trim();
                if (desc === sp) desc = '';
              }
              return { desc: desc || it.desc, qty: it.qty, unit: it.unit };
            }).filter(it => it.desc || it.qty != null);
            fields = Object.assign({}, fields, { items, specs });
          }
          fixedCard = _add(fields, col);
          return fixedCard;
        };
      }
      try {
        await _convert(pi, id);
      } finally {
        if (_add) window.addManualQuote = _add;
      }
      return fixedCard;
    }
  }

  if (window.V21e4) V21e4.convertQuoteForm = convertQuoteFormV7;
  if (window.V21e3) V21e3.convertQuoteForm = convertQuoteFormV7;

  // Also update V21e6 activePadHit to use DOM rects via V21e4.fieldPadRect override
  if (window.V21e6) {
    V21e6.fieldPadRect = fieldPadRect;
    V21e6.domPadRect = domPadRect;
  }

  window.V21e7 = {
    fieldPadRect, domPadRect, claimStroke, mapFormToQuoteFields, convertQuoteForm: convertQuoteFormV7,
    version: 'v21e7'
  };
})();
