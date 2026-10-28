/* Pencil Notes v21e5 — write “quote” with Apple Pencil on iPad Safari opens Quote form.
   Recognition: on-device HW → Grok/transcribe (V21e4.recognizeStrokes) → compact-word toast fallback.
   Builds on v21e4. Mock only. */
(function () {
  const QUOTE_WORD_RE = /^\s*quotes?\s*:?\s*$/i;
  const QUOTE_HAS_RE = /\bquotes?\b/i;
  const SETTLE_MS = 1150;
  const RECENT_MS = 5000;
  const Q = { timer: null, recent: [], probing: false, lastToastSig: '', lastToastAt: 0, lastAcceptSig: '' };

  function noteSealed(n) {
    try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; }
  }
  function insertFn() {
    if (window.V21e4 && typeof V21e4.insertQuoteForm === 'function') return V21e4.insertQuoteForm;
    if (window.V21e3 && typeof V21e3.insertQuoteForm === 'function') return V21e3.insertQuoteForm;
    return null;
  }
  function recognizeFn() {
    if (window.V21e4 && typeof V21e4.recognizeStrokes === 'function') return V21e4.recognizeStrokes;
    return null;
  }

  function trackStroke(pi, st) {
    if (!st || st.tool !== 'pen') return;
    Q.recent.push({ pi, id: st.id, t: Date.now() });
    if (Q.recent.length > 24) Q.recent.shift();
  }

  function scheduleQuoteInkProbe(pi) {
    clearTimeout(Q.timer);
    Q.timer = setTimeout(() => { probeQuoteInk(pi).catch(() => {}); }, SETTLE_MS);
  }

  function strokeBB(st) {
    return st.bb || (typeof bbox === 'function' ? bbox(st.points) : null);
  }

  function clusterBB(strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of strokes) {
      const b = strokeBB(st); if (!b) continue;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
      x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    if (!isFinite(x0)) return null;
    return [x0, y0, x1, y1];
  }

  /** Compact recent stroke group that looks like a single short word (e.g. “quote”). */
  function findWordCluster(pg, pi) {
    const now = Date.now();
    const recent = Q.recent
      .filter(r => r.pi === pi && now - r.t < RECENT_MS)
      .map(r => (pg.strokes || []).find(s => s.id === r.id))
      .filter(s => s && s.tool === 'pen' && !s.qf && s.tool !== 'highlighter');
    if (!recent.length) return null;

    // Seed from newest; grow by proximity (same “word”)
    const seed = recent[recent.length - 1];
    const cluster = [seed];
    const ids = new Set([seed.id]);
    let grew = true;
    while (grew) {
      grew = false;
      const bb = clusterBB(cluster); if (!bb) break;
      const href = Math.max(18, bb[3] - bb[1]);
      for (const s of recent) {
        if (ids.has(s.id)) continue;
        const b = strokeBB(s); if (!b) continue;
        const gapX = Math.max(0, b[0] - bb[2], bb[0] - b[2]);
        const gapY = Math.max(0, b[1] - bb[3], bb[1] - b[3]);
        if (gapX < href * 0.9 && gapY < href * 0.6) {
          ids.add(s.id); cluster.push(s); grew = true;
        }
      }
    }

    const bb = clusterBB(cluster); if (!bb) return null;
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    // Single short word — not a digit badge, not a paragraph
    if (cluster.length < 1 || cluster.length > 12) return null;
    if (h < 16 || h > 110 || w < 36 || w > 300) return null;
    if (w / Math.max(h, 1) > 7.5 || h / Math.max(w, 1) > 2.0) return null;
    // Skip left-margin lone digit-ish (number→badge territory): very narrow + far left
    if (w < 55 && bb[0] < 160 && cluster.length <= 2) return null;

    return {
      strokes: cluster,
      ids: [...ids],
      bb,
      sig: [...ids].sort().join(',')
    };
  }

  function looksQuoteSized(cluster) {
    if (!cluster) return false;
    const w = cluster.bb[2] - cluster.bb[0], h = cluster.bb[3] - cluster.bb[1];
    // “quote” / “quotes” / “quote:” — roughly 4–7 letters
    return w >= 55 && w <= 260 && h >= 18 && h <= 100 && cluster.strokes.length >= 2 && cluster.strokes.length <= 10;
  }

  function textLooksLikeQuote(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (QUOTE_WORD_RE.test(t)) return true;
    if (!QUOTE_HAS_RE.test(t)) return false;
    // Short phrase containing quote — treat as hit
    return t.split(/\s+/).length <= 3;
  }

  async function recognizeCluster(strokes) {
    // 1) Prefer stroke-level HW / Grok via v21e4
    const rec = recognizeFn();
    if (rec) {
      try {
        const t = await rec(strokes);
        if (t && String(t).trim()) return String(t).trim();
      } catch (_) {}
    }
    // 2) Legacy whole-page HW (Chrome) — only if stroke API unavailable
    try {
      if (typeof HW !== 'undefined' && HW.state === 'ready' && HW.recognizePage) {
        const fake = { strokes: strokes.filter(s => s.tool !== 'highlighter') };
        const t = await HW.recognizePage(fake);
        if (t && String(t).trim()) return String(t).trim();
      }
    } catch (_) {}
    return '';
  }

  function ocrAvailable() {
    try {
      if (typeof HW !== 'undefined' && HW.state === 'ready') return true;
    } catch (_) {}
    try {
      if (typeof aiReady === 'function' && aiReady()) return true;
    } catch (_) {}
    return false;
  }

  function acceptQuoteCluster(pi, cluster, opts = {}) {
    const n = curNote(); if (!n || noteSealed(n)) return null;
    const pg = n.pages[pi]; if (!pg || !cluster) return null;
    const insert = insertFn(); if (!insert) return null;
    if (Q.lastAcceptSig === cluster.sig && !opts.force) return null;
    Q.lastAcceptSig = cluster.sig;

    pushHistory();
    const keep = S.undo.length;
    const idset = new Set(cluster.ids);
    // Consume the “quote” ink like lasso / typed path
    pg.strokes = (pg.strokes || []).filter(s => !idset.has(s.id));
    const x = Math.max(16, cluster.bb[0]);
    const y = Math.max(16, cluster.bb[1]);
    const form = insert(pi, x, y, { force: true });
    S.undo.length = keep;
    if (typeof updateUndo === 'function') updateUndo();
    saveNote(n, true);
    if (typeof renderPageInk === 'function') renderPageInk(pi);
    if (typeof rerenderOverlays === 'function') rerenderOverlays();
    else if (typeof renderOverlay === 'function') renderOverlay(pi);
    return form;
  }

  async function probeQuoteInk(pi) {
    if (Q.probing) return;
    if (typeof drawing !== 'undefined' && drawing) {
      scheduleQuoteInkProbe(pi);
      return;
    }
    const n = curNote(); if (!n || noteSealed(n)) return;
    const pg = n.pages[pi]; if (!pg) return;
    // Don't auto-stack another form on a page that already has one
    if ((pg.quoteForms || []).length) return;

    const cluster = findWordCluster(pg, pi);
    if (!cluster) return;

    Q.probing = true;
    let text = '';
    try {
      // Call through V21e5 so tests (and future hooks) can stub recognition
      const rec = (window.V21e5 && typeof V21e5.recognizeCluster === 'function')
        ? V21e5.recognizeCluster : recognizeCluster;
      text = await rec(cluster.strokes);
    } finally {
      Q.probing = false;
    }

    // Cluster may have been erased/converted while we waited
    const still = cluster.ids.every(id => (pg.strokes || []).some(s => s.id === id));
    if (!still) return;
    if ((pg.quoteForms || []).length) return;

    if (textLooksLikeQuote(text)) {
      acceptQuoteCluster(pi, cluster);
      return;
    }

    // iPad fallback: no HW / no Grok — offer one-tap Insert for quote-sized word clusters
    if (!text && !ocrAvailable() && looksQuoteSized(cluster)) {
      const now = Date.now();
      if (cluster.sig === Q.lastToastSig && now - Q.lastToastAt < 8000) return;
      if (now - Q.lastToastAt < 2500) return; // global debounce
      Q.lastToastSig = cluster.sig;
      Q.lastToastAt = now;
      if (typeof actionToast === 'function') {
        actionToast(
          'Looks like a short word — open Quote form?',
          'Insert Quote form',
          () => {
            const n2 = curNote(); if (!n2) return;
            const pg2 = n2.pages[pi]; if (!pg2) return;
            // Rebuild cluster from surviving ids
            const strokes = cluster.ids.map(id => (pg2.strokes || []).find(s => s.id === id)).filter(Boolean);
            if (!strokes.length) {
              const ins = insertFn();
              if (ins) ins(pi, cluster.bb[0], cluster.bb[1], { force: true });
              return;
            }
            const bb = clusterBB(strokes) || cluster.bb;
            acceptQuoteCluster(pi, { strokes, ids: strokes.map(s => s.id), bb, sig: cluster.sig }, { force: true });
          },
          7000
        );
      }
    }
  }

  // Track strokes for clustering (v21e3 already schedules via onStrokeAdded)
  const _prev = window.onStrokeAdded;
  window.onStrokeAdded = function (pi, st) {
    if (typeof _prev === 'function') _prev(pi, st);
    trackStroke(pi, st);
  };

  window.V21e5 = {
    scheduleQuoteInkProbe,
    probeQuoteInk,
    findWordCluster,
    textLooksLikeQuote,
    looksQuoteSized,
    acceptQuoteCluster,
    recognizeCluster,
    trackStroke,
    _Q: Q,
    version: 'v21e5'
  };
})();
