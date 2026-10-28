/* Pencil Notes v21e8 — Quote cards resize freely; handwriting autoscales to fit the ink pad.
   Reuses board.js .bc-resize + t.h. Quote Board (QPI) may shrink below ink bottom; ink is
   fit-scaled while dragging and normalized into t.strokes on release so it stays readable.
   Idea Board keeps the old “don’t clip ink” clamp. Mock only. */
(function () {
  const FIT_MIN = 0.12;
  const PAD = 8;

  function strokesBot(st) {
    return typeof strokesBottom === 'function' ? strokesBottom(st) : 0;
  }

  /** Uniform scale so stroke content fits in viewH ink-units (width still INK_W). */
  function fitScaleFor(strokes, viewH) {
    const bot = strokesBot(strokes);
    if (!strokes || !strokes.length || !viewH || bot <= viewH + 0.5) return 1;
    return Math.max(FIT_MIN, (viewH - PAD) / bot);
  }

  function scaleStrokeList(strokes, sc) {
    if (!strokes || !strokes.length || sc === 1) return strokes || [];
    return strokes.map(s => {
      const pts = (s.points || []).map(p => [+(p[0] * sc).toFixed(2), +(p[1] * sc).toFixed(2), p[2]]);
      const out = Object.assign({}, s, {
        points: pts,
        width: +Math.max(0.55, (s.width || 2) * sc).toFixed(2)
      });
      out.bb = typeof bbox === 'function' ? bbox(pts) : s.bb;
      return out;
    });
  }

  /** Permanently shrink card body ink so it fits in maxH (ink units). */
  function normalizeBodyInk(t, maxH) {
    if (!t || !(t.strokes || []).length) return false;
    const sc = fitScaleFor(t.strokes, maxH);
    if (sc >= 0.999) return false;
    t.strokes = scaleStrokeList(t.strokes, sc);
    return true;
  }

  function drawInkFitted(cv, strokes, k, viewH) {
    if (!cv) return null;
    const sc = fitScaleFor(strokes, viewH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const W = Math.round((cv.clientWidth || 200) * dpr);
    const H = Math.round((cv.clientHeight || 60) * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const kk = k * sc * dpr;
    ctx.setTransform(kk, 0, 0, kk, 0, 0);
    const st = strokes || [];
    for (const s of st) if (s.tool === 'highlighter') drawStroke(ctx, s);
    for (const s of st) if (s.tool !== 'highlighter') drawStroke(ctx, s);
    return { ctx, fit: sc };
  }

  // ---- layoutCard: fit body ink when content exceeds card height ----
  const _layoutCard = typeof layoutCard === 'function' ? layoutCard : null;
  window.layoutCard = function (w, t) {
    if (!_layoutCard) return;
    const body = w.querySelector('.bc-ink');
    if (!body) return _layoutCard(w, t);
    const k = (w.querySelector('.bc-main').clientWidth || 200) / INK_W;
    body.style.height = Math.round(cardH(t) * k) + 'px';
    const ti = w.querySelector('.bc-tink');
    if (ti) ti.style.height = Math.round(TITLE_H * k) + 'px';
    if (body.clientWidth) drawInkFitted(body, t.strokes, k, cardH(t));
    if (ti && ti.clientWidth) drawInk(ti, t.tstrokes, k);
    w.querySelectorAll('.bc-iink').forEach(cv => {
      const it = (t.items || []).find(x => x.id === cv.dataset.item);
      cv.style.height = Math.round(ITEM_H * k) + 'px';
      if (cv.clientWidth) drawInk(cv, it && it.strokes, k);
    });
  };

  // ---- resize: Quote Board can shrink below ink; Idea Board keeps clamp ----
  const _resizeStart = typeof resizeStart === 'function' ? resizeStart : null;
  const _resizeMove = typeof resizeMove === 'function' ? resizeMove : null;
  const _resizeEnd = typeof resizeEnd === 'function' ? resizeEnd : null;

  window.resizeStart = function (g) {
    const t = findCard(g.pi, g.wrap.dataset.id); if (!t) { BS.g = null; return; }
    g.mode = 'resize'; g.id = t.id; g.h0 = cardH(t); g.h = g.h0;
    g.body = g.wrap.querySelector('.bc-ink');
    g.k = pxPerUnit(g.body);
    g.autofit = (g.pi === QPI); // Quote Board: shrink + autosize ink
    g.hmin = g.autofit
      ? H_MIN
      : Math.max(H_MIN, Math.ceil(strokesBot(t.strokes) + 6));
    g.wrap.classList.add('resizing');
    if (g.autofit) g.wrap.classList.add('autofit');
    document.body.classList.add('bresizing');
    buzz();
  };

  window.resizeMove = function (g) {
    const h = Math.round(Math.max(g.hmin, Math.min(H_MAX, g.h0 + (g.y - g.y0) / g.k)));
    if (h === g.h) return;
    g.h = h;
    const t = findCard(g.pi, g.id);
    g.body.style.height = Math.round(h * g.k) + 'px';
    if (t) {
      if (g.autofit) drawInkFitted(g.body, t.strokes, g.k, h);
      else drawInk(g.body, t.strokes, g.k);
    }
    g.wrap.classList.toggle('at-min', h <= g.hmin);
    g.wrap.classList.toggle('at-max', h >= H_MAX);
  };

  window.resizeEnd = function (g, cancel) {
    suppressClicks();
    g.wrap.classList.remove('resizing', 'at-min', 'at-max', 'autofit');
    document.body.classList.remove('bresizing');
    const t = findCard(g.pi, g.id);
    if (!cancel && t && Math.abs(g.h - g.h0) >= 2) {
      bH(g.pi);
      t.h = g.h;
      if (g.autofit) normalizeBodyInk(t, t.h);
      saveNote(bN(g.pi), true);
      try { thumbCache.clear(); } catch (_) {}
    }
    renderBoard(g.pi);
  };

  // When Convert attaches tall stacked ink, size the pad to fit (still shrinkable later)
  function ensureCardInkHeight(card) {
    if (!card || !(card.strokes || []).length) return;
    const bot = Math.ceil(strokesBot(card.strokes) + 12);
    const h = Math.max(H_MIN, Math.min(H_MAX, bot));
    if (!card.h || card.h < h) card.h = h;
  }

  // Hook Quote form convert → after card created with strokes
  if (window.V21e4 && typeof V21e4.convertQuoteForm === 'function') {
    const _conv = V21e4.convertQuoteForm;
    V21e4.convertQuoteForm = async function (pi, id) {
      const before = typeof quoteCards === 'function' ? quoteCards().map(c => c.id) : [];
      const out = await _conv(pi, id);
      try {
        const cards = typeof quoteCards === 'function' ? quoteCards() : [];
        const neu = cards.find(c => !before.includes(c.id)) || cards[cards.length - 1];
        if (neu && (neu.strokes || []).length) {
          ensureCardInkHeight(neu);
          // If still taller than max, normalize into H_MAX
          if (strokesBot(neu.strokes) > cardH(neu)) normalizeBodyInk(neu, cardH(neu));
          const qn = typeof ensureQuoteNote === 'function' ? ensureQuoteNote() : null;
          if (qn) saveNote(qn, true);
          if (typeof renderBoard === 'function') renderBoard(QPI);
        }
      } catch (_) {}
      return out;
    };
    if (window.V21e3) V21e3.convertQuoteForm = V21e4.convertQuoteForm;
    if (window.V21e7) V21e7.convertQuoteForm = V21e4.convertQuoteForm;
  }

  // CSS: clearer resize affordance on Quote cards
  try {
    const st = document.createElement('style');
    st.id = 'v21e8-resize';
    st.textContent = `
      #qbHost .bc-resize { opacity: .85; background:
        linear-gradient(135deg, transparent 54%, color-mix(in srgb, var(--accent) 70%, transparent) 54%) !important; }
      #qbHost .bcard-wrap.resizing.autofit .bcard {
        box-shadow: 0 0 0 2px var(--accent), 0 10px 26px rgba(0,0,0,.4); }
      #qbHost .bcard-wrap.resizing.autofit.at-min .bc-ink {
        outline: 1px dashed color-mix(in srgb, var(--accent) 50%, transparent); outline-offset: -2px; }
    `;
    document.head.append(st);
  } catch (_) {}

  window.V21e8 = {
    fitScaleFor, normalizeBodyInk, drawInkFitted, scaleStrokeList, ensureCardInkHeight,
    version: 'v21e8'
  };
})();
