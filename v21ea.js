/* Pencil Notes v21ea — Quote details Quantity field (OCR/typed → details);
   deleting a Quote Board card clears linked note-page ink (form/pad strokes).
   Builds on v21e9. Mock only. */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseQtyText(s) {
    if (s == null || s === '') return NaN;
    const n = parseFloat(String(s).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  /** Prefer q.qty; else sum of items[].qty (for totals). */
  function cardQty(t) {
    if (!t || !t.q) return null;
    if (t.q.qty != null && t.q.qty !== '' && isFinite(+t.q.qty)) return +t.q.qty;
    const items = t.q.items || [];
    let q = 0, any = false;
    for (const it of items) {
      if (it && it.qty != null && isFinite(+it.qty)) { q += +it.qty; any = true; }
    }
    return any ? q : null;
  }

  /** Value for the Details Quantity field: q.qty, else first line item qty (never a multi-line sum). */
  function detailsQty(t) {
    if (!t || !t.q) return null;
    if (t.q.qty != null && t.q.qty !== '' && isFinite(+t.q.qty)) return +t.q.qty;
    const it = (t.q.items || []).find(i => i && i.qty != null && isFinite(+i.qty));
    return it ? +it.qty : null;
  }

  function applyQtyToCard(card, qty) {
    if (!card || !card.q) return;
    if (qty == null || qty === '' || !isFinite(+qty)) {
      card.q.qty = null;
      return;
    }
    const q = +qty;
    card.q.qty = q;
    if (!card.q.items || !card.q.items.length) {
      card.q.items = [{ desc: 'Item', qty: q, unit: null, price: card.q.price != null ? card.q.price : null }];
    } else {
      card.q.items[0].qty = q;
    }
  }

  function calcTotalValue(qty, price) {
    if (window.V21e9 && typeof V21e9.calcTotalValue === 'function') return V21e9.calcTotalValue(qty, price);
    if (qty == null || qty === '' || price == null || price === '') return null;
    const q = +qty, p = +price;
    if (!isFinite(q) || !isFinite(p)) return null;
    return Math.round(q * p * 100) / 100;
  }

  function syncCardTotal(t) {
    if (!t || !t.q) return null;
    const qty = cardQty(t);
    const price = (window.V21e9 && V21e9.cardUnitPrice) ? V21e9.cardUnitPrice(t)
      : (t.q.price != null && isFinite(+t.q.price) ? +t.q.price : null);
    if (qty == null || price == null) return t.q.value != null ? +t.q.value : null;
    const tot = calcTotalValue(qty, price);
    if (tot != null) t.q.value = tot;
    return tot;
  }

  /* ---------- 1) qbEdit: Quantity field near Price / Total ---------- */
  const _qbEdit = typeof qbEdit === 'function' ? qbEdit : null;
  if (_qbEdit) {
    window.qbEdit = function (t) {
      const editingId = t && t.id;
      const isNew = !t;
      _qbEdit(t);
      const w = document.getElementById('qbEditWrap');
      if (!w || w.hidden) return;
      const sheet = w.querySelector('.qb-edit');
      if (!sheet) return;
      const q = t ? (t.q || {}) : {};

      // Ensure Price label exists (v21e9 may have inserted it); then add Quantity before Price
      let priceEl = sheet.querySelector('input[data-q="price"]');
      const valInp = sheet.querySelector('input[data-q="value"]');
      if (valInp) {
        const lab = valInp.closest('label');
        if (lab) {
          const first = lab.childNodes[0];
          if (first && first.nodeType === 3) first.textContent = 'Total value ($)';
          valInp.title = 'Quantity × Price (auto when both set)';
        }
        if (!priceEl) {
          const price0 = q.price != null ? q.price : '';
          const priceLab = document.createElement('label');
          priceLab.innerHTML = `Price ($)<input data-q="price" type="number" value="${esc(price0)}" step="0.01" min="0" inputmode="decimal" title="Unit price">`;
          if (lab && lab.parentNode) lab.parentNode.insertBefore(priceLab, lab);
          priceEl = sheet.querySelector('input[data-q="price"]');
        }
      }

      if (!sheet.querySelector('input[data-q="qty"]')) {
        const qty0 = detailsQty(t) != null ? detailsQty(t) : '';
        const qtyLab = document.createElement('label');
        qtyLab.innerHTML = `Quantity<input data-q="qty" type="number" value="${esc(qty0)}" step="1" min="0" inputmode="decimal" title="Quantity (from Quote form or typed)">`;
        const priceLab = priceEl && priceEl.closest('label');
        if (priceLab && priceLab.parentNode) priceLab.parentNode.insertBefore(qtyLab, priceLab);
        else if (valInp && valInp.closest('label')) {
          const vLab = valInp.closest('label');
          vLab.parentNode.insertBefore(qtyLab, vLab);
        } else {
          const grid = sheet.querySelector('.qe-grid');
          if (grid) grid.appendChild(qtyLab);
        }
      }

      let qtyTouched = false;
      const recalc = (opts = {}) => {
        const qtyEl = sheet.querySelector('input[data-q="qty"]');
        const priceEl2 = sheet.querySelector('input[data-q="price"]');
        const valueEl = sheet.querySelector('input[data-q="value"]');
        const itemsEl = sheet.querySelector('textarea[data-q="items"]');
        if (!valueEl) return;
        let qty = null;
        if (qtyEl && qtyEl.value.trim() !== '') {
          const qn = parseQtyText(qtyEl.value);
          qty = isFinite(qn) ? qn : null;
        } else if (itemsEl && typeof textToItems === 'function') {
          const items = textToItems(itemsEl.value);
          // Prefer first-line qty for unit-price total when Quantity blank
          const first = items.find(it => it.qty != null && isFinite(+it.qty));
          qty = first ? +first.qty : null;
        }
        const price = priceEl2 ? (typeof parseMoneyText === 'function' ? parseMoneyText(priceEl2.value) : parseFloat(priceEl2.value)) : NaN;
        const tot = calcTotalValue(qty, isFinite(price) ? price : null);
        if (tot != null) valueEl.value = String(tot);
        // Only rewrite items when the user edited Quantity (never on open / price-only recalc)
        if (opts.syncItems && qtyTouched && qtyEl && qty != null && itemsEl && typeof textToItems === 'function' && typeof itemsToText === 'function') {
          const items = textToItems(itemsEl.value);
          if (items.length) {
            items[0].qty = qty;
            itemsEl.value = itemsToText(items);
          }
        }
      };

      const qtyEl0 = sheet.querySelector('input[data-q="qty"]');
      if (qtyEl0) {
        qtyEl0.addEventListener('input', () => { qtyTouched = true; recalc({ syncItems: true }); });
        qtyEl0.addEventListener('change', () => { qtyTouched = true; recalc({ syncItems: true }); });
      }
      sheet.querySelectorAll('input[data-q="price"], textarea[data-q="items"]').forEach(el => {
        el.addEventListener('input', () => recalc());
        el.addEventListener('change', () => recalc());
      });
      recalc();

      const prevClick = w.onclick;
      w.onclick = function (e) {
        const b = e.target.closest && e.target.closest('[data-qe="ok"]');
        if (!b) return prevClick && prevClick.call(this, e);
        const qtyEl = sheet.querySelector('input[data-q="qty"]');
        const priceEl2 = sheet.querySelector('input[data-q="price"]');
        const qtySnap = qtyEl ? qtyEl.value.trim() : '';
        const priceSnap = priceEl2 ? priceEl2.value.trim() : '';
        recalc();
        const result = prevClick && prevClick.call(this, e);
        setTimeout(() => {
          try {
            let card = editingId ? findCard(QPI, editingId) : null;
            if (!card && isNew) {
              const cards = typeof quoteCards === 'function' ? quoteCards() : [];
              card = cards[cards.length - 1] || null;
            }
            if (!card) return;
            card.q = card.q || {};
            // Persist Quantity only when the user edited it (avoids stamping first-line qty as q.qty on multi-item email cards)
            if (qtyTouched && qtySnap !== '') {
              const qn = parseQtyText(qtySnap);
              if (isFinite(qn)) applyQtyToCard(card, qn);
            }
            if (priceSnap !== '') {
              const p = typeof parseMoneyText === 'function' ? parseMoneyText(priceSnap) : parseFloat(priceSnap);
              if (isFinite(p)) {
                card.q.price = p;
                if (card.q.items && card.q.items[0]) card.q.items[0].price = p;
              }
            }
            syncCardTotal(card);
            const qn = typeof quoteNote === 'function' ? quoteNote() : null;
            if (qn) saveNote(qn, true);
            if (typeof qbRender === 'function') qbRender();
            if (typeof renderBoard === 'function') renderBoard(QPI);
          } catch (_) {}
        }, 0);
        return result;
      };
    };
  }

  /* ---------- 2) Convert: map Quantity → q.qty + record sourceInk for delete cleanup ---------- */
  function collectFormStrokeIds(pg, form) {
    const ids = new Set();
    if (!form) return ids;
    const inkIds = form.inkIds || {};
    for (const k of Object.keys(inkIds)) {
      for (const id of inkIds[k] || []) ids.add(id);
    }
    for (const st of (pg.strokes || [])) {
      if (st && st.qf && st.qf.form === form.id) ids.add(st.id);
    }
    return ids;
  }

  function purgeStrokeIdsFromNote(noteId, pageId, strokeIds) {
    if (!noteId || !pageId || !strokeIds || !strokeIds.length) return 0;
    const kill = new Set(strokeIds);
    const notes = (typeof S !== 'undefined' && S.notes) || [];
    const n = notes.find(x => x.id === noteId);
    if (!n) return 0;
    let removed = 0;
    for (const pg of (n.pages || [])) {
      if (pageId && pg.id !== pageId) continue;
      const before = (pg.strokes || []).length;
      pg.strokes = (pg.strokes || []).filter(s => !kill.has(s.id));
      removed += before - pg.strokes.length;
      // Drop empty qf tags if any leftovers
      for (const st of pg.strokes) {
        if (st.qf && kill.has(st.id)) delete st.qf;
      }
    }
    if (removed) {
      try { saveNote(n, true); } catch (_) {}
      try {
        if (typeof S !== 'undefined' && S.cur === noteId) {
          const pi = n.pages.findIndex(p => p.id === pageId);
          if (pi >= 0 && typeof renderPageInk === 'function') renderPageInk(pi);
          if (typeof rerenderOverlays === 'function') rerenderOverlays();
          else if (typeof renderOverlay === 'function' && pi >= 0) renderOverlay(pi);
        }
      } catch (_) {}
    }
    return removed;
  }

  function attachSourceInk(card, note, pg, strokeIds) {
    if (!card || !card.q || !note || !pg) return;
    const ids = [...strokeIds];
    card.q.sourceInk = {
      noteId: note.id,
      pageId: pg.id,
      strokeIds: ids
    };
    // Also stamp qty top-level from items if present
    if (card.q.qty == null && card.q.items && card.q.items[0] && card.q.items[0].qty != null) {
      card.q.qty = card.q.items[0].qty;
    }
  }

  function patchConvert(fn) {
    if (typeof fn !== 'function') return fn;
    return async function (pi, id) {
      const n = typeof curNote === 'function' ? curNote() : null;
      const pg = n && n.pages[pi];
      const form = pg && (pg.quoteForms || []).find(f => f.id === id);
      const preIds = form ? collectFormStrokeIds(pg, form) : new Set();
      const noteId = n && n.id;
      const pageId = pg && pg.id;
      const beforeCards = typeof quoteCards === 'function' ? quoteCards().map(c => c.id) : [];

      const out = await fn(pi, id);

      try {
        // Force-remove any claimed strokes that survived convert
        if (noteId && pageId && preIds.size) {
          purgeStrokeIdsFromNote(noteId, pageId, [...preIds]);
        }
        const cards = typeof quoteCards === 'function' ? quoteCards() : [];
        const neu = cards.find(c => !beforeCards.includes(c.id)) || (out && out.id ? out : null);
        if (neu && neu.q) {
          // Ensure qty is on the quote object
          if (neu.q.qty == null) {
            const items = neu.q.items || [];
            const any = items.some(it => it && it.qty != null && isFinite(+it.qty));
            if (any) {
              neu.q.qty = items.reduce((s, it) => s + (it && it.qty != null && isFinite(+it.qty) ? +it.qty : 0), 0);
            }
          }
          attachSourceInk(neu, { id: noteId }, { id: pageId }, preIds);
          syncCardTotal(neu);
          const qn = typeof ensureQuoteNote === 'function' ? ensureQuoteNote() : null;
          if (qn) saveNote(qn, true);
          if (typeof renderBoard === 'function') renderBoard(QPI);
          if (typeof qbRender === 'function') qbRender();
        }
      } catch (_) {}
      return out;
    };
  }

  if (window.V21e4 && V21e4.convertQuoteForm) {
    V21e4.convertQuoteForm = patchConvert(V21e4.convertQuoteForm);
  }
  if (window.V21e3) V21e3.convertQuoteForm = V21e4 && V21e4.convertQuoteForm;
  if (window.V21e7) V21e7.convertQuoteForm = V21e4 && V21e4.convertQuoteForm;
  if (window.V21e8) V21e8.convertQuoteForm = V21e4 && V21e4.convertQuoteForm;
  if (window.V21e9) V21e9.convertQuoteForm = V21e4 && V21e4.convertQuoteForm;

  // Also ensure mapFormToQuoteFields stamps qty
  if (window.V21e7 && typeof V21e7.mapFormToQuoteFields === 'function') {
    const _map = V21e7.mapFormToQuoteFields;
    V21e7.mapFormToQuoteFields = function (vals) {
      const fields = _map(vals);
      if (fields) {
        const items = fields.items || [];
        const any = items.some(it => it && it.qty != null && isFinite(+it.qty));
        if (any) fields.qty = items.reduce((s, it) => s + (it && it.qty != null && isFinite(+it.qty) ? +it.qty : 0), 0);
        else {
          const qtyRaw = String((vals.quantity && vals.quantity.text) || '').replace(/,/g, '');
          const qn = parseFloat(qtyRaw);
          if (isFinite(qn)) fields.qty = qn;
        }
      }
      return fields;
    };
  }

  /* ---------- 3) deleteCard: purge linked note-page ink ---------- */
  const _deleteCard = typeof deleteCard === 'function' ? deleteCard : null;
  if (_deleteCard) {
    window.deleteCard = function (pi, id) {
      let sourceInk = null;
      try {
        const t = typeof findCard === 'function' ? findCard(pi, id) : null;
        if (t && t.q && t.q.sourceInk && (t.q.sourceInk.strokeIds || []).length) {
          sourceInk = {
            noteId: t.q.sourceInk.noteId,
            pageId: t.q.sourceInk.pageId,
            strokeIds: t.q.sourceInk.strokeIds.slice()
          };
        }
      } catch (_) {}
      const result = _deleteCard(pi, id);
      if (sourceInk) {
        try {
          // Snapshot undo on the source note if it's the current note
          const notes = (typeof S !== 'undefined' && S.notes) || [];
          const sn = notes.find(x => x.id === sourceInk.noteId);
          if (sn && typeof S !== 'undefined' && S.cur === sn.id && typeof pushHistory === 'function') {
            pushHistory();
          }
          purgeStrokeIdsFromNote(sourceInk.noteId, sourceInk.pageId, sourceInk.strokeIds);
        } catch (_) {}
      }
      return result;
    };
  }

  // Prefer q.qty in V21e9 helpers when present
  if (window.V21e9) {
    const _cq = V21e9.cardQty;
    V21e9.cardQty = function (t) {
      if (t && t.q && t.q.qty != null && t.q.qty !== '' && isFinite(+t.q.qty)) return +t.q.qty;
      return typeof _cq === 'function' ? _cq(t) : cardQty(t);
    };
    V21e9.syncCardTotal = function (t) { return syncCardTotal(t); };
  }

  window.V21ea = {
    version: 'v21ea',
    cardQty, detailsQty, applyQtyToCard, syncCardTotal, parseQtyText,
    purgeStrokeIdsFromNote, collectFormStrokeIds, attachSourceInk
  };
})();
