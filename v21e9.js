/* Pencil Notes v21e9 — Quote resize min↔max (display-only ink fit); all column widths
   incl. last (pixel flex + scroll); Price + Total value = qty × price with OCR;
   column sum of Total value. Builds on v21e8. Mock only. */
(function () {
  /* ---------- money / total helpers (OCR + typed) ---------- */
  function parseMoneyText(s) {
    if (s == null || s === '') return NaN;
    let t = String(s).trim();
    // "$1,250.50", "1250", "12.5 ea", "USD 9.99"
    t = t.replace(/^(usd|us\$|\$)\s*/i, '').replace(/\s*(ea|each|\/ea|pcs?)?$/i, '');
    t = t.replace(/[^\d.,\-]/g, '');
    // keep last decimal point if multiple commas/dots
    if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, (m, i, str) => i === str.lastIndexOf('.') ? '.' : '');
    t = t.replace(/,/g, '');
    const n = parseFloat(t);
    return isFinite(n) ? n : NaN;
  }

  function calcTotalValue(qty, price) {
    if (qty == null || qty === '' || price == null || price === '') return null;
    const q = +qty, p = +price;
    if (!isFinite(q) || !isFinite(p)) return null;
    return Math.round(q * p * 100) / 100;
  }

  function cardQty(t) {
    if (!t || !t.q) return null;
    const items = t.q.items || [];
    let q = 0, any = false;
    for (const it of items) {
      if (it && it.qty != null && isFinite(+it.qty)) { q += +it.qty; any = true; }
    }
    return any ? q : null;
  }

  function cardUnitPrice(t) {
    if (!t || !t.q) return null;
    if (t.q.price != null && t.q.price !== '' && isFinite(+t.q.price)) return +t.q.price;
    const it = (t.q.items || []).find(i => i && i.price != null && isFinite(+i.price));
    return it ? +it.price : null;
  }

  /** Prefer stored q.value; else qty × price. */
  function cardTotalValue(t) {
    if (!t || !t.q) return 0;
    if (t.q.value != null && t.q.value !== '' && isFinite(+t.q.value)) return +t.q.value;
    const tot = calcTotalValue(cardQty(t), cardUnitPrice(t));
    return tot == null ? 0 : tot;
  }

  function syncCardTotal(t) {
    if (!t || !t.q) return null;
    const qty = cardQty(t), price = cardUnitPrice(t);
    // Only overwrite value when both qty and unit price are known (never treat missing price as $0)
    if (qty == null || price == null) return t.q.value != null ? +t.q.value : null;
    const tot = calcTotalValue(qty, price);
    if (tot != null) t.q.value = tot;
    return tot;
  }

  /**
   * OCR path for qty/price: reuse recognizeStrokes (HW / Grok), then parse.
   * Typed text wins over ink when both present (same as resolveFieldValue).
   */
  async function recognizeQtyPrice(vals) {
    const qtyText = (vals.quantity && vals.quantity.text) || '';
    const priceText = (vals.price && vals.price.text) || '';
    let qty = parseFloat(String(qtyText).replace(/,/g, ''));
    let price = parseMoneyText(priceText);
    // If typed empty but ink present, resolveFieldValue already put recognized text in .text.
    // Extra: if still empty and strokes remain, try recognizeStrokes again.
    const recog = (window.V21e4 && V21e4.recognizeStrokes) || null;
    if ((!isFinite(qty) || !qtyText) && recog && vals.quantity && (vals.quantity.strokes || []).length) {
      const r = await recog(vals.quantity.strokes);
      if (r) qty = parseFloat(String(r).replace(/,/g, ''));
    }
    if ((!isFinite(price) || !priceText) && recog && vals.price && (vals.price.strokes || []).length) {
      const r = await recog(vals.price.strokes);
      if (r) price = parseMoneyText(r);
    }
    return {
      qty: isFinite(qty) ? qty : null,
      price: isFinite(price) ? price : null,
      total: calcTotalValue(qty, price)
    };
  }

  window.parseMoneyText = parseMoneyText;

  /* ---------- 1) Card resize: display-only fit (shrink → expand restores) ---------- */
  // v21e8 permanently normalized strokes on resizeEnd, so expand left ink tiny.
  // Keep original strokes; layoutCard/drawInkFitted already scale for display.
  window.resizeEnd = function (g, cancel) {
    suppressClicks();
    g.wrap.classList.remove('resizing', 'at-min', 'at-max', 'autofit');
    document.body.classList.remove('bresizing');
    const t = findCard(g.pi, g.id);
    if (!cancel && t && Math.abs(g.h - g.h0) >= 2) {
      bH(g.pi);
      t.h = g.h;
      // Do NOT normalizeBodyInk — preserve full-size strokes for expand
      saveNote(bN(g.pi), true);
      try { thumbCache.clear(); } catch (_) {}
    }
    renderBoard(g.pi);
  };

  // Still allow fitScaleFor to shrink visually when content > viewH
  // (drawInkFitted / layoutCard from v21e8). On expand, bot <= viewH → scale 1.

  /* ---------- 2) Column widths: last col grow + reachable handle ---------- */
  try {
    const st = document.createElement('style');
    st.id = 'v21e9-cols';
    st.textContent = `
      /* Room for last-column resize handle; prefer scroll over trapping width */
      .bcols { padding-right: 28px !important; scroll-padding-right: 28px; }
      #qbHost .bcols { padding-right: 32px !important; }
      /* Keep handle inside the column box so last col's handle is hit-testable */
      .bcol-resize { right: 0 !important; width: 16px; }
      #qbHost .bcol-resize { right: 1px !important; }
      /* Don't let full-drawer % basis override explicit pixel widths */
      #qbHost .bcol[style*="flex"] { flex-grow: 0 !important; flex-shrink: 0 !important; }
      #qbDrawer.full #qbHost .bcol[style*="width"] { max-width: none; }
      /* Column total value chip */
      .qb-total { font-variant-numeric: tabular-nums; font-weight: 800; font-size: 12px;
        padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--ok) 18%, transparent);
        color: var(--ok); margin-left: 4px; white-space: nowrap; }
      .qb-price { font-variant-numeric: tabular-nums; }
      .qd-l .qb-tot-lbl { color: var(--muted); font-weight: 600; }
    `;
    document.head.append(st);
  } catch (_) {}

  /* ---------- 3) Column sum + card Price/Total display ---------- */
  const _colHeadExtra = typeof colHeadExtra === 'function' ? colHeadExtra : null;
  window.colHeadExtra = function (pg, c, cc) {
    if (!pg.board || !pg.board.quote) return _colHeadExtra ? _colHeadExtra(pg, c, cc) : '';
    const tot = (cc || []).reduce((s, t) => s + cardTotalValue(t), 0);
    const m = typeof money === 'function' ? money(tot) : ('$' + tot);
    return `<span class="qb-total" title="Sum of Total value in ${esc(c.title || 'column')}">${m || '$0'}</span>`;
  };

  const _cardExtraTop = typeof cardExtraTop === 'function' ? cardExtraTop : null;
  window.cardExtraTop = function (t, pg) {
    if (!pg || !pg.board || !pg.board.quote || !t.q) return _cardExtraTop ? _cardExtraTop(t, pg) : '';
    const q = t.q, fu = (q.followups || []).length;
    const tot = cardTotalValue(t);
    const price = cardUnitPrice(t);
    const chips = [];
    if (q.unread) chips.push('<span class="qb-new">New</span>');
    if (q.rfq) chips.push(`<span class="qb-rfq">RFQ ${esc(q.rfq)}</span>`);
    if (price != null) chips.push(`<span class="qb-price" title="Unit price">${esc(money(price))}</span>`);
    if (tot) chips.push(`<span class="qb-val" title="Total value (qty × price)">${esc(money(tot))}</span>`);
    else if (q.value != null && q.value !== '') chips.push(`<span class="qb-val">${esc(money(q.value))}</span>`);
    if (fu) chips.push(`<span class="qb-fu">↩︎ ${fu} follow-up${fu > 1 ? 's' : ''}</span>`);
    return chips.length ? `<div class="qb-chips">${chips.join('')}</div>` : '';
  };

  const _cardExtra = typeof cardExtra === 'function' ? cardExtra : null;
  window.cardExtra = function (t, pg) {
    let html = _cardExtra ? _cardExtra(t, pg) : '';
    if (!pg || !pg.board || !pg.board.quote || !t.q) return html;
    const price = cardUnitPrice(t);
    const qty = cardQty(t);
    const tot = cardTotalValue(t);
    const bits = [];
    if (price != null || (qty != null && tot)) {
      bits.push(`<div class="qd-l"><i>💵</i><span>`);
      if (qty != null) bits.push(`<b>${(+qty).toLocaleString()}</b>`);
      if (price != null) bits.push(`${qty != null ? ' × ' : ''}<span class="qb-price">${esc(money(price))}</span>`);
      if (tot) bits.push(` = <b title="Total value">${esc(money(tot))}</b>`);
      bits.push(`</span></div>`);
    }
    if (!bits.length) return html;
    // Inject before closing .qb-det if present
    if (html.indexOf('class="qb-det"') >= 0) {
      return html.replace('<div class="qb-det">', '<div class="qb-det">' + bits.join(''));
    }
    return bits.join('') + html;
  };

  /* ---------- 4) qbEdit: Price field + live Total = qty × price ---------- */
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
      const price0 = q.price != null ? q.price : '';
      const valInp = sheet.querySelector('input[data-q="value"]');
      if (valInp) {
        const lab = valInp.closest('label');
        if (lab) {
          const first = lab.childNodes[0];
          if (first && first.nodeType === 3) first.textContent = 'Total value ($)';
          valInp.title = 'Quantity × Price (auto when both set)';
        }
        if (!sheet.querySelector('input[data-q="price"]')) {
          const priceLab = document.createElement('label');
          priceLab.innerHTML = `Price ($)<input data-q="price" type="number" value="${esc(price0)}" step="0.01" min="0" inputmode="decimal" title="Unit price">`;
          if (lab && lab.parentNode) lab.parentNode.insertBefore(priceLab, lab);
        }
      }
      const recalc = () => {
        const priceEl = sheet.querySelector('input[data-q="price"]');
        const valueEl = sheet.querySelector('input[data-q="value"]');
        const itemsEl = sheet.querySelector('textarea[data-q="items"]');
        if (!priceEl || !valueEl) return;
        const price = parseMoneyText(priceEl.value);
        let qty = null;
        if (itemsEl && typeof textToItems === 'function') {
          const items = textToItems(itemsEl.value);
          const any = items.some(it => it.qty != null);
          qty = any ? items.reduce((s, it) => s + (it.qty != null && isFinite(+it.qty) ? +it.qty : 0), 0) : null;
        }
        const tot = calcTotalValue(qty, price);
        if (tot != null) valueEl.value = String(tot);
      };
      sheet.querySelectorAll('input[data-q="price"], textarea[data-q="items"]').forEach(el => {
        el.addEventListener('input', recalc);
        el.addEventListener('change', recalc);
      });
      recalc();

      // Wrap sheet save so Price is persisted and Total recalculated
      const prevClick = w.onclick;
      w.onclick = function (e) {
        const b = e.target.closest && e.target.closest('[data-qe="ok"]');
        if (!b) return prevClick && prevClick.call(this, e);
        // Snapshot price before original closes/clears the sheet
        const priceEl = sheet.querySelector('input[data-q="price"]');
        const priceSnap = priceEl ? priceEl.value.trim() : '';
        const valueEl = sheet.querySelector('input[data-q="value"]');
        const itemsEl = sheet.querySelector('textarea[data-q="items"]');
        // Ensure total is up to date before original reads inputs
        recalc();
        const result = prevClick && prevClick.call(this, e);
        // After original save, attach price + resync total
        setTimeout(() => {
          try {
            let card = editingId ? findCard(QPI, editingId) : null;
            if (!card && isNew) {
              const cards = typeof quoteCards === 'function' ? quoteCards() : [];
              card = cards[cards.length - 1] || null;
            }
            if (!card) return;
            card.q = card.q || {};
            if (priceSnap !== '') {
              const p = parseMoneyText(priceSnap);
              if (isFinite(p)) {
                card.q.price = p;
                if (card.q.items && card.q.items[0]) card.q.items[0].price = p;
                syncCardTotal(card); // only recalc when a unit price was provided
              }
            }
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

  /* ---------- Wrap convert to ensure value = qty × price after OCR ---------- */
  function patchConvert(fn) {
    if (typeof fn !== 'function') return fn;
    return async function (pi, id) {
      const before = typeof quoteCards === 'function' ? quoteCards().map(c => c.id) : [];
      const out = await fn(pi, id);
      try {
        const cards = typeof quoteCards === 'function' ? quoteCards() : [];
        const neu = cards.find(c => !before.includes(c.id)) || (typeof out === 'object' && out) || null;
        if (neu && neu.q) {
          // If convert left value empty but qty+price present, calc
          if ((neu.q.value == null || neu.q.value === '') && (neu.q.price != null || (neu.q.items || []).some(i => i && i.price != null))) {
            syncCardTotal(neu);
          }
          // Also derive price from items[0].price
          if (neu.q.price == null && neu.q.items && neu.q.items[0] && neu.q.items[0].price != null) {
            neu.q.price = neu.q.items[0].price;
            syncCardTotal(neu);
          }
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

  // Expose helpers for tests
  window.V21e9 = {
    version: 'v21e9',
    parseMoneyText, calcTotalValue, cardTotalValue, cardQty, cardUnitPrice,
    syncCardTotal, recognizeQtyPrice,
    // Resize: confirm no permanent normalize on end
    resizePreservesStrokes: true
  };
})();
