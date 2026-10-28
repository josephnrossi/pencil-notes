/* Pencil Notes v21e6 — Quote form pad ink is visible (canvas in each blank) + live Pencil preview.
   Field strokes stay claimed on the page for Convert/OCR; pads paint a copy so ink isn’t hidden under .qf-block.
   Trigger “Q” lives in v21e3/v21e5. Builds on v21e5. Mock only. */
(function () {
  const QF_FIELDS = (window.V21e4 && V21e4.QUOTE_FIELDS) || (window.V21e3 && V21e3.QUOTE_FIELDS) || [
    { key: 'distb', label: 'Distb' },
    { key: 'product', label: 'Product' },
    { key: 'size', label: 'Size' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'other', label: 'Other' }
  ];

  function fieldPadRect(form, key) {
    if (window.V21e4 && typeof V21e4.fieldPadRect === 'function') return V21e4.fieldPadRect(form, key);
    return null;
  }
  function strokesForField(pg, form, key) {
    if (window.V21e4 && typeof V21e4.strokesForField === 'function') return V21e4.strokesForField(pg, form, key);
    return [];
  }

  function padSurfaceIsDark(padEl) {
    try {
      const bg = getComputedStyle(padEl).backgroundColor || '';
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (m) {
        const r = +m[1], g = +m[2], b = +m[3];
        // relative luminance
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 140;
      }
    } catch (_) {}
    try { return typeof isDark === 'function' ? isDark() : true; } catch (_) { return true; }
  }

  function strokeForPad(st, darkPad) {
    if (!st) return st;
    const c = st.color;
    if (c && c !== 'ink' && c !== (typeof INK !== 'undefined' ? INK : 'ink')) return st;
    // Theme ink color can disagree with pad surface (light pad in a dark app chrome) — force contrast
    return Object.assign({}, st, { color: darkPad ? '#f4f4f7' : '#1a1a1e' });
  }

  /** Paint claimed (+ optional live) strokes into a pad canvas, page coords → pad-local. */
  function paintPadInk(cv, strokes, rect, liveStroke) {
    if (!cv || !rect) return false;
    const padEl = cv.parentElement;
    const cssW = cv.clientWidth || (padEl && padEl.clientWidth) || 0;
    const cssH = cv.clientHeight || (padEl && padEl.clientHeight) || 0;
    if (cssW < 4 || cssH < 4) return false;
    const padW = Math.max(1, rect[2] - rect[0]);
    const padH = Math.max(1, rect[3] - rect[1]);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const tw = Math.round(cssW * dpr), th = Math.round(cssH * dpr);
    if (cv.width !== tw || cv.height !== th) { cv.width = tw; cv.height = th; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tw, th);
    ctx.setTransform(dpr * cssW / padW, 0, 0, dpr * cssH / padH, 0, 0);
    ctx.translate(-rect[0], -rect[1]);
    const darkPad = padSurfaceIsDark(padEl);
    const list = strokes ? strokes.slice() : [];
    if (liveStroke) list.push(liveStroke);
    for (const st of list) {
      if (!st || !st.points || !st.points.length) continue;
      const draw = strokeForPad(st, darkPad);
      if (typeof drawStroke === 'function') drawStroke(ctx, draw);
    }
    return list.length > 0;
  }

  function refreshFormPads(pi, formEl, form, liveStroke, liveKey) {
    const n = curNote(); if (!n || !formEl) return;
    const pg = n.pages[pi]; if (!pg) return;
    for (const { key } of QF_FIELDS) {
      const pad = formEl.querySelector(`.qf-row[data-field="${key}"] .qf-pad`);
      if (!pad) continue;
      let cv = pad.querySelector('canvas.qf-ink-cv');
      if (!cv) {
        cv = document.createElement('canvas');
        cv.className = 'qf-ink-cv';
        cv.setAttribute('aria-hidden', 'true');
        pad.insertBefore(cv, pad.firstChild);
      }
      const rect = fieldPadRect(form, key);
      const strokes = strokesForField(pg, form, key);
      const extra = (liveStroke && liveKey === key) ? liveStroke : null;
      const painted = paintPadInk(cv, strokes, rect, extra);
      const hint = pad.querySelector('.qf-pad-hint');
      if (hint) {
        const typed = (form.fields && form.fields[key]) || '';
        const nInk = strokes.length + (extra ? 1 : 0);
        if (nInk) hint.textContent = '✍︎ ' + nInk + ' stroke' + (nInk > 1 ? 's' : '');
        else if (!typed) hint.textContent = 'Write here';
        else hint.textContent = '';
        hint.hidden = !!(typed && form._typeOpen && form._typeOpen[key]);
      }
      cv.style.opacity = painted || extra ? '1' : '0';
    }
  }

  function activePadHit(pi, pageX, pageY) {
    const n = curNote(); if (!n) return null;
    const pg = n.pages[pi]; if (!pg || !(pg.quoteForms || []).length) return null;
    for (const form of pg.quoteForms) {
      for (const { key } of QF_FIELDS) {
        const r = fieldPadRect(form, key);
        if (r && pageX >= r[0] && pageX <= r[2] && pageY >= r[1] && pageY <= r[3]) {
          return { form, key, rect: r };
        }
      }
    }
    return null;
  }

  function formElFor(pi, formId) {
    const rec = pageEls[pi]; if (!rec || !rec.ov) return null;
    return rec.ov.querySelector(`.qf-block[data-id="${formId}"]`);
  }

  /** After v21e4 rebuilds the form DOM, paint pad canvases. */
  function enhanceRenderedForms(pi) {
    const n = curNote(); if (!n || !pageEls[pi]) return;
    const pg = n.pages[pi];
    for (const form of (pg.quoteForms || [])) {
      const el = formElFor(pi, form.id); if (!el) continue;
      // Ensure each pad has a canvas before paint
      el.querySelectorAll('.qf-pad').forEach(pad => {
        if (!pad.querySelector('canvas.qf-ink-cv')) {
          const cv = document.createElement('canvas');
          cv.className = 'qf-ink-cv';
          cv.setAttribute('aria-hidden', 'true');
          pad.insertBefore(cv, pad.firstChild);
        }
      });
      refreshFormPads(pi, el, form, null, null);
    }
  }

  // Wrap v21e4 render so pads always get ink canvases
  const _render = window.V21e4 && V21e4.renderQuoteForms;
  function renderQuoteFormsV6(pi) {
    if (typeof _render === 'function') _render(pi);
    else if (window.V21e3 && typeof V21e3.renderQuoteForms === 'function') V21e3.renderQuoteForms(pi);
    try { enhanceRenderedForms(pi); } catch (e) { console.warn('qf pad ink', e); }
  }
  if (window.V21e4) V21e4.renderQuoteForms = renderQuoteFormsV6;
  if (window.V21e3) V21e3.renderQuoteForms = renderQuoteFormsV6;

  // After claim: refresh pads without relying solely on full rebuild timing
  const _prevStroke = window.onStrokeAdded;
  window.onStrokeAdded = function (pi, st) {
    if (typeof _prevStroke === 'function') _prevStroke(pi, st);
    try {
      // v21e4 claimStroke already ran inside _prevStroke chain; refresh pad canvases
      enhanceRenderedForms(pi);
    } catch (_) {}
  };

  // Live preview while Pencil is down over a pad (page live canvas is under .qf-block)
  let liveRaf = 0;
  function tickLivePad() {
    liveRaf = 0;
    if (typeof drawing === 'undefined' || !drawing || !drawing.stroke) return;
    const pi = drawing.pi;
    const pts = drawing.stroke.points; if (!pts || !pts.length) return;
    const last = pts[pts.length - 1];
    const hit = activePadHit(pi, last[0], last[1]) || activePadHit(pi, drawing.start[0], drawing.start[1]);
    if (!hit) return;
    const el = formElFor(pi, hit.form.id); if (!el) return;
    refreshFormPads(pi, el, hit.form, drawing.stroke, hit.key);
  }
  function scheduleLivePad() {
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(tickLivePad);
  }

  window.addEventListener('pointermove', e => {
    if (typeof drawing === 'undefined' || !drawing || e.pointerId !== drawing.id) return;
    if (!drawing.stroke) return;
    scheduleLivePad();
  }, true);
  window.addEventListener('pointerup', e => {
    if (typeof drawing === 'undefined' || !drawing) {
      // stroke may already be cleared; enhance after a tick (claim runs in endPointer)
      setTimeout(() => {
        try {
          const n = curNote(); if (!n) return;
          for (let i = 0; i < n.pages.length; i++) {
            if ((n.pages[i].quoteForms || []).length) enhanceRenderedForms(i);
          }
        } catch (_) {}
      }, 0);
    }
  }, true);

  // Overlay hook: ensure paint after other layers
  const _ov = typeof v7OverlayHook === 'function' ? v7OverlayHook : null;
  if (_ov) {
    v7OverlayHook = function (pi) {
      _ov(pi);
      try { enhanceRenderedForms(pi); } catch (_) {}
    };
  }

  // Initial paint if forms already on screen
  try {
    if (window.__ready) {
      const n = curNote();
      if (n) for (let i = 0; i < n.pages.length; i++) if ((n.pages[i].quoteForms || []).length) renderQuoteFormsV6(i);
    }
  } catch (_) {}

  window.V21e6 = {
    paintPadInk,
    refreshFormPads,
    enhanceRenderedForms,
    renderQuoteForms: renderQuoteFormsV6,
    activePadHit,
    version: 'v21e6'
  };
})();
