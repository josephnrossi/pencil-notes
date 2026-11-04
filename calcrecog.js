/* Pencil Notes v21ef — 🧮 Calculator Board handwriting pipeline (MOCK). Pure functions (load in Node for tests) + a browser renderer.
   1. group(strokes)       → which strokes belong to the same formula: same-line spacing scaled to the writing size, raised exponents,
                             stacked fractions (a bar with ink right above AND below — a minus sign is not one), roots / big brackets
                             (a stroke that contains others), and stacked column sums (rows over a long bar, answer under it).
   2. layout / read        → the structure inside one formula (fraction · root · exponent · column) so a flat, one-line reader
                             (the on-device one) is asked about each piece separately and the pieces are put back together as LaTeX.
   3. parseGrok / combine  → Grok's reply (expression · ALT · CONF lines) is validated by actually parsing it; the readers are compared
                             by the value they produce; when they disagree the candidates go to a one-tap picker. Confidence 0–1.
   4. Bias                 → remembers this writer's corrections (e.g. their “7” read as “1”) and uses them on later reads + in the prompt.
   5. prompt / renderInk   → few-shot transcription prompt + a tight, high-resolution crop of only this formula's ink.
   No network, no keys here: calcboard.js passes the readers in. */
(function (root) {
  'use strict';
  const bbOf = pts => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
  const BB = s => s.bb && s.bb.length === 4 ? s.bb : bbOf(s.points);
  const med = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const topMed = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => y - x); return med(b.slice(0, Math.max(1, Math.ceil(b.length / 2)))); };   // writing size ≈ the taller half (digits), not + − x or exponents
  const W = b => b[2] - b[0], Hh = b => b[3] - b[1], CX = b => (b[0] + b[2]) / 2, CY = b => (b[1] + b[3]) / 2;
  const union = bbs => bbs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const isBarBB = b => W(b) >= 6 && Hh(b) <= Math.max(4.5, 0.3 * W(b));
  const isDotBB = (b, H) => Math.max(W(b), Hh(b)) < Math.max(5, 0.22 * H);
  const glyphish = (b, H) => !isBarBB(b) && !isDotBB(b, H);

  /* writing size: median height of glyph-like strokes (not bars, not dots) near a point */
  function sizer(bbs) {
    const g = bbs.filter(b => Hh(b) > 5 && !isBarBB(b)).map(Hh), global = Math.max(10, Math.min(220, topMed(g) || 24));
    const glyphIdx = bbs.map((b, i) => i).filter(i => glyphish(bbs[i], global) && Hh(bbs[i]) >= 0.45 * global);
    const cache = new Map();
    return i => {
      if (cache.has(i)) return cache.get(i);
      const b = bbs[i], hs = [];
      for (const j of glyphIdx) { const o = bbs[j]; if (Math.abs(CY(o) - CY(b)) < 1.6 * global && Math.abs(CX(o) - CX(b)) < 9 * global) hs.push(Hh(o)); }
      let h = hs.length ? topMed(hs) : global; h = Math.max(10, Math.min(220, h)); cache.set(i, h); return h;
    };
  }

  /* ---------------- 1. grouping ---------------- */
  function group(strokes, opts = {}) {
    const n = strokes.length, bbs = strokes.map(BB), hl = sizer(bbs);
    const par = [...Array(n).keys()], f = i => par[i] === i ? i : (par[i] = f(par[i])), join = (i, j) => { const a = f(i), b = f(j); if (a !== b) par[a] = b; };
    const vov = (a, b) => Math.min(a[3], b[3]) - Math.max(a[1], b[1]), hgap = (a, b) => Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
    const gapK = opts.gapK || 1.15;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = bbs[i], b = bbs[j], H = (hl(i) + hl(j)) / 2, g = hgap(a, b), vg = -vov(a, b);
      const own = k => { const h = Hh(bbs[k]); return glyphish(bbs[k], hl(k)) && h >= 0.75 * hl(k) ? Math.min(h, hl(k) * 1.2) : hl(k); }, Hs = Math.min(own(i), own(j));   // big glyphs: their own size
      if (g > 3 * H || vg > 3 * H) continue;
      // (a) parts of one glyph: + = ÷ % x i … overlap in x, close in y, and together no taller than a line
      const u = union([a, b]);
      if (-g >= Math.min(0.35 * Math.min(W(a), W(b)) + 0.5, 0.9 * Math.min(W(a), W(b))) && g < 0 && vg < 0.32 * H && Hh(u) <= 1.35 * H) { join(i, j); continue; }
      // (b) same line, normal spacing
      const small = Math.min(Hh(a), Hh(b)), big = Hh(a) >= Hh(b) ? a : b, tiny = big === a ? b : a;
      const sameLine = (vov(a, b) >= 0.3 * small && small >= 0.3 * H) || (small < 0.3 * H && CY(tiny) >= big[1] - 0.05 * H && CY(tiny) <= big[3] + 0.12 * H);
      if (sameLine && g < gapK * Hs) { join(i, j); continue; }
      // (c) raised exponent written clear of its base: small, bottom near the base's top, just to the right
      const lo = a[0] <= b[0] ? a : b, hi = lo === a ? b : a;
      if (Hh(hi) <= 0.8 * Hh(lo) && Hh(lo) >= 0.6 * H && hi[3] >= lo[1] - 0.12 * H && hi[3] <= lo[1] + 0.55 * Hh(lo) && hi[0] >= lo[2] - 0.35 * H && hi[0] <= lo[2] + 0.7 * H) { join(i, j); continue; }
      // (d) containment: √ sign or big bracket around other strokes
      const cont = (o, inn) => W(o) >= 1.1 * H && W(inn) > 0 && (Math.min(o[2], inn[2]) - Math.max(o[0], inn[0])) >= 0.6 * W(inn) && inn[1] >= o[1] - 0.25 * H && inn[3] <= o[3] + 0.25 * H;
      if (cont(a, b) || cont(b, a)) { join(i, j); continue; }
    }
    // (e) fraction bars and (f) column sums — need the whole neighbourhood, after (a)–(d)
    for (let k = 0; k < n; k++) {
      const b = bbs[k]; if (!isBarBB(b)) continue; const H = hl(k); if (W(b) < 0.55 * H) continue;
      const fr = fractionAt(k, bbs, H);
      if (fr) { for (const i of [...fr.above, ...fr.below]) join(k, i); }
      const col = columnAt(k, bbs, H, f);
      if (col) for (const i of col) join(k, i);
    }
    const groups = new Map(); for (let i = 0; i < n; i++) { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    return [...groups.values()];
  }
  function fractionAt(k, bbs, H) {
    const b = bbs[k], w = W(b), x0 = b[0] - 0.12 * w, x1 = b[2] + 0.12 * w;
    const above = [], below = []; let gA = Infinity, gB = Infinity;
    bbs.forEach((o, i) => {
      if (i === k || CX(o) < x0 || CX(o) > x1 || W(o) > 1.3 * w + 4) return;
      if (o[3] <= b[1] + 2 && b[1] - o[3] < 0.6 * H && o[1] > b[1] - 2.2 * H) { above.push(i); gA = Math.min(gA, b[1] - o[3]); }
      else if (o[1] >= b[3] - 2 && o[1] - b[3] < 0.75 * H && o[3] < b[3] + 2.2 * H) { below.push(i); gB = Math.min(gB, o[1] - b[3]); }
    });
    const grow = (l, side) => {   // exponents / smaller pieces of the numerator or denominator that sit further from the bar
      const set = new Set(l); let u = l.length ? union(l.map(i => bbs[i])) : null;
      for (let more = true; more && u;) { more = false; bbs.forEach((o, i) => { if (set.has(i) || i === k || CX(o) < x0 || CX(o) > x1) return; if (side < 0 ? o[3] > b[1] + 2 : o[1] < b[3] - 2) return;
        const vg = Math.max(o[1], u[1]) - Math.min(o[3], u[3]); if (vg < 0.45 * H && Math.abs(CY(o) - CY(b)) < 2.6 * H) { set.add(i); u = union([u, o]); more = true; } }); }
      return [...set];
    };
    above.splice(0, above.length, ...grow(above, -1)); below.splice(0, below.length, ...grow(below, 1));
    const real = l => l.some(i => glyphish(bbs[i], H) && Hh(bbs[i]) >= 0.3 * H);
    if (!real(above) || !real(below)) return null;
    // a minus sign between stacked lines: the ink above / below is a whole line that runs well past the bar on a side
    // (a fraction's numerator and denominator stay within the bar)
    const rowExt = (seed, side) => {
      const set = new Set(seed); let ext = union(seed.map(i => bbs[i]));
      for (let grown = true; grown;) { grown = false; bbs.forEach((o, i) => { if (set.has(i) || i === k) return; if (side < 0 ? o[3] > b[1] + 2 : o[1] < b[3] - 2) return;
        const ov = Math.min(o[3], ext[3]) - Math.max(o[1], ext[1]), gap = Math.max(o[0], ext[0]) - Math.min(o[2], ext[2]);
        if (ov >= 0.3 * Math.min(Hh(o) || 1, Hh(ext)) && gap < 0.6 * H) { set.add(i); ext = union([ext, o]); grown = true; } }); }
      return ext;
    };
    const ea = rowExt(above, -1), eb = rowExt(below, 1), past = e => e[0] < b[0] - 0.35 * H || e[2] > b[2] + 0.35 * H;
    if (past(ea) || past(eb)) return null;
    // only the ink that is stacked tight to the bar (the nearest row each side)
    const near = (l, side) => { const g0 = side < 0 ? gA : gB; return l.filter(i => (side < 0 ? b[1] - bbs[i][3] : bbs[i][1] - b[3]) <= g0 + 0.9 * H); };
    return { above: near(above, -1), below: near(below, 1) };
  }
  function rowsOf(idx, bbs) {   // cluster stroke indices into text rows by vertical overlap
    const rows = [];
    for (const i of [...idx].sort((p, q) => CY(bbs[p]) - CY(bbs[q]))) {
      const b = bbs[i], r = rows.find(r => Math.min(r.bb[3], b[3]) - Math.max(r.bb[1], b[1]) >= 0.3 * Math.min(Hh(r.bb), Hh(b) || 1) || (Hh(b) < 0.35 * Hh(r.bb) && CY(b) > r.bb[1] && CY(b) < r.bb[3]));
      if (r) { r.idx.push(i); r.bb = union([r.bb, b]); } else rows.push({ idx: [i], bb: b.slice() });
    }
    return rows.sort((p, q) => p.bb[1] - q.bb[1]);
  }
  function columnAt(k, bbs, H, f) {
    const b = bbs[k]; if (W(b) < 1.4 * H) return null;
    const cand = []; bbs.forEach((o, i) => { if (i !== k && o[3] <= b[1] + 3 && b[1] - o[3] < 3.6 * H && Math.min(o[2], b[2]) - Math.max(o[0], b[0]) >= 0.6 * W(o)) cand.push(i); });
    const rows = rowsOf(cand, bbs).filter(r => r.idx.some(i => Hh(bbs[i]) >= 0.5 * H));
    if (rows.length < 2) return null;
    const stack = [rows[rows.length - 1]];
    if (b[1] - stack[0].bb[3] > 0.7 * H) return null;
    for (let r = rows.length - 2; r >= 0 && stack.length < 5; r--) { const up = rows[r], lo = stack[0]; if (lo.bb[1] - up.bb[3] > 0.8 * H || Math.abs(up.bb[2] - lo.bb[2]) > 1.1 * H) break; stack.unshift(up); }
    if (stack.length < 2) return null;
    const u = union(stack.map(r => r.bb)); if (W(b) < 0.7 * W(u)) return null;
    const ids = stack.flatMap(r => r.idx);
    bbs.forEach((o, i) => { if (i !== k && o[1] >= b[3] - 2 && o[1] - b[3] < 0.8 * H && CX(o) >= b[0] - 0.2 * H && CX(o) <= b[2] + 0.4 * H) ids.push(i); });   // the answer under the line
    return ids;
  }

  /* ---------------- 2. structure inside one formula ---------------- */
  function atoms(idx, bbs, H) {   // glyph clusters: strokes overlapping in x, close in y, no taller than a line together
    const at = idx.map(i => ({ idx: [i], bb: bbs[i].slice() }));
    for (let changed = true; changed;) {
      changed = false;
      for (let p = 0; p < at.length && !changed; p++) for (let q = p + 1; q < at.length && !changed; q++) {
        const a = at[p].bb, b = at[q].bb, ov = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), vg = Math.max(a[1], b[1]) - Math.min(a[3], b[3]), u = union([a, b]);
        if (ov > 0 && ov >= Math.min(0.35 * Math.min(W(a), W(b)) + 0.5, 0.9 * Math.min(W(a), W(b))) && vg < 0.32 * H && Hh(u) <= 1.35 * H) { at[p].idx.push(...at[q].idx); at[p].bb = u; at.splice(q, 1); changed = true; }
      }
    }
    return at.sort((p, q) => p.bb[0] - q.bb[0]);
  }
  function layout(strokes, idx) {
    const bbs = strokes.map(BB); idx = idx || strokes.map((_, i) => i);
    const all = bbs.filter(Boolean), g = all.filter(b => Hh(b) > 5 && !isBarBB(b)).map(Hh), H = Math.max(10, Math.min(220, topMed(g) || 24));
    return lay(idx, bbs, H, 0);
  }
  function lay(idx, bbs, H, depth) {
    if (!idx.length) return { t: 'seq', items: [] };
    if (depth > 6) return { t: 'seq', items: [{ t: 'ink', idx }] };
    const split = (cut0, cut1, used) => { const rest = idx.filter(i => !used.has(i)); return [rest.filter(i => CX(bbs[i]) < cut0), rest.filter(i => CX(bbs[i]) >= cut0)]; };
    const sub = l => lay(l, bbs, H, depth + 1);
    const bars = idx.filter(i => isBarBB(bbs[i]) && W(bbs[i]) >= 0.55 * H).sort((p, q) => W(bbs[q]) - W(bbs[p]));
    const sb = idx.map(i => bbs[i]);
    // column sum
    for (const k of bars) {
      const local = idx.map(i => bbs[i]), map = idx; const kk = map.indexOf(k);
      const ids = columnAt(kk, local, H); if (!ids) continue;
      const used = new Set([k, ...ids.map(j => map[j])]), b = bbs[k];
      const above = [...used].filter(i => i !== k && bbs[i][3] <= b[1] + 3), below = [...used].filter(i => i !== k && bbs[i][1] >= b[3] - 2);
      const rows = rowsOf(above, bbs).map(r => sub(r.idx));
      const [left, right] = split(b[0], b[2], used);
      return seq([...sub(left).items, { t: 'col', rows, ans: below.length ? sub(below) : null }, ...sub(right).items]);
    }
    // fraction (widest bar first)
    for (const k of bars) {
      const local = idx.map(i => bbs[i]), kk = idx.indexOf(k), fr = fractionAt(kk, local, H); if (!fr) continue;
      const num = fr.above.map(j => idx[j]), den = fr.below.map(j => idx[j]), used = new Set([k, ...num, ...den]), b = bbs[k];
      const rest = idx.filter(i => !used.has(i)), left = rest.filter(i => CX(bbs[i]) < CX(b)), right = rest.filter(i => CX(bbs[i]) >= CX(b));
      return seq([...sub(left).items, { t: 'frac', num: sub(num), den: sub(den) }, ...sub(right).items]);
    }
    // root / big bracket: a wide stroke that contains others
    for (const k of idx) {
      const o = bbs[k]; if (W(o) < 1.1 * H || isBarBB(o)) continue;
      const inner = idx.filter(i => i !== k && (Math.min(o[2], bbs[i][2]) - Math.max(o[0], bbs[i][0])) >= 0.6 * W(bbs[i]) && bbs[i][1] >= o[1] - 0.25 * H && bbs[i][3] <= o[3] + 0.25 * H && bbs[i][0] > o[0] + 0.15 * W(o));
      if (inner.length < 1) continue;
      const used = new Set([k, ...inner]), rest = idx.filter(i => !used.has(i)), left = rest.filter(i => CX(bbs[i]) < o[0] + 0.2 * W(o)), right = rest.filter(i => !left.includes(i));
      return seq([...sub(left).items, { t: 'sqrt', inner: sub(inner) }, ...sub(right).items]);
    }
    // flat line with raised exponents
    const at = atoms(idx, bbs, H), items = []; let base = null, run = [];
    const flush = () => { if (run.length) { items.push({ t: 'sup', inner: lay(run.flatMap(a => a.idx), bbs, H * 0.65, depth + 1) }); run = []; } };
    for (const a of at) {
      const raised = base && Hh(a.bb) <= 0.82 * Hh(base.bb) && Hh(base.bb) >= 0.55 * H && a.bb[3] <= base.bb[1] + 0.6 * Hh(base.bb) && CY(a.bb) < base.bb[1] + 0.3 * Hh(base.bb) && !isBarBB(a.bb) && !isDotBB(a.bb, H);
      if (raised) { run.push(a); continue; }
      flush();
      const last = items[items.length - 1];
      if (last && last.t === 'ink') last.idx.push(...a.idx); else items.push({ t: 'ink', idx: [...a.idx] });
      if (Hh(a.bb) >= 0.55 * H && !isBarBB(a.bb)) base = a;
    }
    flush();
    return { t: 'seq', items };
  }
  const seq = items => ({ t: 'seq', items: items.flatMap(it => it.t === 'seq' ? it.items : [it]) });
  /* read each piece with a flat reader (strokes → text), put LaTeX back together */
  async function assemble(node, strokes, readFlat) {
    const R = n => assemble(n, strokes, readFlat);
    switch (node.t) {
      case 'seq': { let s = ''; for (const it of node.items) s += await R(it); return s; }
      case 'ink': { const ss = [...node.idx].sort((a, b) => BB(strokes[a])[0] - BB(strokes[b])[0]).map(i => strokes[i]); return String(await readFlat(ss) || '').trim(); }
      case 'frac': return `\\frac{${await R(node.num)}}{${await R(node.den)}}`;
      case 'sqrt': return `\\sqrt{${await R(node.inner)}}`;
      case 'sup': return `^{${await R(node.inner)}}`;
      case 'col': {
        const rows = []; for (const r of node.rows) rows.push((await R(r)).replace(/\s+/g, ''));
        const opOf = r => (/^[-+−–x×*÷/]/.exec(r) || [''])[0], op = opOf(rows[rows.length - 1]) || '+';
        const body = rows.map((r, k) => k === 0 ? r.replace(/^[+]/, '') : (opOf(r) ? r : op + r)).join('');
        return node.ans ? `${body}=${(await R(node.ans)).replace(/\s+/g, '')}` : body;
      }
    }
    return '';
  }
  async function structuredRead(strokes, readFlat) { return assemble(layout(strokes), strokes, readFlat); }
  function describe(node) {     // short layout hint for the Grok prompt
    const f = { frac: 0, sqrt: 0, sup: 0, col: 0 };
    (function walk(n) { if (!n) return; if (f[n.t] !== undefined) f[n.t]++; (n.items || []).forEach(walk); ['num', 'den', 'inner', 'ans'].forEach(k => walk(n[k])); (n.rows || []).forEach(walk); })(node);
    const parts = [];
    if (f.col) parts.push('numbers stacked in a column over a line (a column sum — read as one expression, operator from the left of the last row)');
    if (f.frac) parts.push(`${f.frac} stacked fraction${f.frac > 1 ? 's' : ''}`);
    if (f.sqrt) parts.push(`${f.sqrt} root sign${f.sqrt > 1 ? 's' : ''}`);
    if (f.sup) parts.push(`${f.sup} small raised group${f.sup > 1 ? 's' : ''} (exponents)`);
    return parts.length ? 'Layout found on the page: ' + parts.join(', ') + '.' : '';
  }

  /* ---------------- 3. readers: parse Grok's reply, combine, confidence ---------------- */
  function parseGrok(t) {
    const lines = String(t || '').replace(/```[a-z]*|```/gi, '').split('\n').map(x => x.trim()).filter(Boolean);
    let expr = '', alts = [], conf = null;
    for (const l of lines) {
      let m;
      if ((m = /^ALT(?:ERNATIVES?)?\s*:\s*(.*)$/i.exec(l))) { alts.push(...m[1].split('|').map(x => x.trim()).filter(x => x && !/^none$/i.test(x))); continue; }
      if ((m = /^CONF(?:IDENCE)?\s*:\s*([\d.]+)/i.exec(l))) { conf = Math.max(0, Math.min(1, parseFloat(m[1]))); continue; }
      if (!expr) expr = l.replace(/^\s*(?:answer|expression|latex|expr|output)\s*:\s*/i, '').replace(/^\$+|\$+$/g, '').trim();
    }
    if (/\[unreadable\]/i.test(expr)) expr = '';
    return { text: expr, alts, conf };
  }
  const BASE_CONF = { grok: 0.78, device: 0.6, alt: 0.45, learned: 0.5, typed: 1 };
  /* readings: [{ src, text, conf?, alts? }] · evalFn(text) → { ok, value, display, error } · bias: Bias-like (optional) */
  function combine(readings, evalFn, bias) {
    const pool = [];
    for (const r of readings || []) {
      if (!r || !r.text) continue;
      pool.push({ src: r.src, text: r.text, conf: r.conf != null ? r.conf : BASE_CONF[r.src] || 0.5 });
      for (const a of r.alts || []) pool.push({ src: 'alt', text: a, conf: Math.min(BASE_CONF.alt, (r.conf != null ? r.conf : 0.7) * 0.6), of: r.src });
    }
    if (bias) for (const p of [...pool]) {
      const fixed = bias.applySafe(p.text); if (fixed !== p.text) { p.orig = p.text; p.text = fixed; p.learned = true; }
      if (p.src !== 'alt') for (const v of bias.variants(p.text)) pool.push({ src: 'learned', text: v, conf: BASE_CONF.learned });
    }
    if (!pool.length) return { text: '', cands: [], conf: 0, src: '' };
    for (const p of pool) {
      const r = evalFn(p.text); p.ok = !!(r && r.ok); p.display = r && r.ok ? r.display : ''; p.key = r && r.ok ? 'v:' + JSON.stringify(r.value) + ':' + (r.kind || '') : 't:' + p.text.replace(/\s+/g, '');
      p.score = p.conf + (p.ok ? 0.15 : -0.45) - (r && r.autoClosed ? 0.1 : 0) + (bias ? bias.srcBonus(p.src) : 0) + (p.learned ? 0.04 : 0);
    }
    const by = new Map(); for (const p of pool) { const g = by.get(p.key); if (!g) by.set(p.key, { ...p, votes: [p.src], n: 1 }); else { g.n++; g.votes.push(p.src); g.score = Math.max(g.score, p.score) + 0.12; if (BASE_CONF[p.src] > BASE_CONF[g.src] && p.src !== 'alt') { g.src = p.src; g.text = p.text; } } }
    const groups = [...by.values()].sort((a, b) => b.score - a.score), best = groups[0];
    const primaries = new Set(pool.filter(p => p.src === 'grok' || p.src === 'device').map(p => p.key));
    const okGroups = groups.filter(g => g.ok);
    let conf;
    if (primaries.size >= 2 && pool.filter(p => p.src === 'grok' || p.src === 'device').length >= 2) conf = 0.42;           // the two readers disagree
    else if (best.votes.includes('grok') && best.votes.includes('device')) conf = 0.96;                                   // both agree
    else conf = Math.max(0.05, Math.min(0.92, best.score - (okGroups.length > 1 ? 0.18 : 0)));
    if (!best.ok) conf = Math.min(conf, 0.3);
    const cands = okGroups.length > 1 || (!best.ok && okGroups.length) ? okGroups.slice(0, 4).map(g => ({ text: g.text, src: g.src, display: g.display, votes: g.votes })) : [];
    const pick = best.ok || !okGroups.length ? best : okGroups[0];
    return { text: pick.text, src: pick.src, conf: +conf.toFixed(2), cands, readings: pool.map(p => ({ src: p.src, text: p.text, ok: p.ok })) };
  }
  const confLevel = c => c == null ? '' : c >= 0.8 ? 'hi' : c >= 0.55 ? 'mid' : 'lo';

  /* ---------------- 4. Bias: learn from this writer's corrections ---------------- */
  function align(a, b) {   // char substitutions between two strings (Levenshtein backtrace)
    a = [...a.replace(/\s+/g, '')]; b = [...b.replace(/\s+/g, '')];
    if (a.length > 60 || b.length > 60) return [];
    const D = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? (j ? 0 : i) : j));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    const subs = []; let i = a.length, j = b.length;
    while (i > 0 && j > 0) { if (D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { if (a[i - 1] !== b[j - 1]) subs.push([a[i - 1], b[j - 1]]); i--; j--; } else if (D[i][j] === D[i - 1][j] + 1) i--; else j--; }
    return D[a.length][b.length] <= Math.max(2, Math.ceil(b.length / 3)) ? subs : [];
  }
  const NUMCTX = c => /[\d.]/.test(c || '');
  function makeBias(store) {
    let st = { subs: {}, picks: {}, n: 0 };
    try { const v = store && store.get(); if (v && v.subs) st = Object.assign(st, v); } catch (_) {}
    const save = () => { try { store && store.set(st); } catch (_) {} };
    const strong = () => Object.entries(st.subs).filter(([, c]) => c >= 2).map(([k, c]) => { const [from, to] = k.split('\u2192'); return { from, to, n: c }; }).sort((p, q) => q.n - p.n);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      get state() { return st; },
      learn(raw, fixed, src) {
        if (!raw || !fixed || raw === fixed) { if (src) { st.picks[src] = (st.picks[src] || 0) + 1; save(); } return []; }
        const subs = align(String(raw), String(fixed)).filter(([x, y]) => /[\dA-Za-z|+\-*/×÷x]/.test(x) && /[\d+\-*/×÷x]/.test(y));
        for (const [x, y] of subs) { const k = x + '\u2192' + y; st.subs[k] = (st.subs[k] || 0) + 1; }
        if (src) st.picks[src] = (st.picks[src] || 0) + 1;
        st.n++; save(); return subs;
      },
      strong,
      applySafe(text) {     // letter → digit/operator mixes this writer corrected twice or more, only next to digits
        let t = String(text || '');
        for (const s of strong()) { if (/\d/.test(s.from)) continue; t = t.replace(new RegExp(esc(s.from), 'g'), (m, off, str) => NUMCTX(str[off - 1]) || NUMCTX(str[off + m.length]) ? s.to : m); }
        return t;
      },
      variants(text) {      // digit ↔ digit mix-ups ("their 7 reads as 1") become alternative readings, never silent changes
        const out = [], t = String(text);
        for (const s of strong()) { if (!/^\d$/.test(s.from)) continue;     // one digit at a time: "17+1" with 1→7 offers 77+1 and 17+7, not 77+7
          for (let i = t.indexOf(s.from); i >= 0 && out.length < 3; i = t.indexOf(s.from, i + 1)) { const v = t.slice(0, i) + s.to + t.slice(i + 1); if (!out.includes(v)) out.push(v); }
          if (out.length >= 3) break; }
        return out;
      },
      srcBonus(src) { const g = st.picks.grok || 0, d = st.picks.device || 0, tot = g + d; if (tot < 3 || (src !== 'grok' && src !== 'device')) return 0; return 0.08 * (((src === 'grok' ? g : d) / tot) - 0.5); },
      hints() { const s = strong().slice(0, 6); return s.length ? 'This writer\'s past corrections (their handwriting): ' + s.map(x => `“${x.from}” was really “${x.to}” (${x.n}×)`).join('; ') + '.' : ''; },
      reset() { st = { subs: {}, picks: {}, n: 0 }; save(); },
    };
  }

  /* ---------------- 5. prompt + tight crop ---------------- */
  const PROMPT = ['TASK: transcribe math',
    'Transcribe the handwritten math in the image as ONE line of LaTeX-style calculator input. Use \\frac{a}{b} for stacked fractions, \\sqrt{x} or \\sqrt[n]{x} for roots, ^{ } for small raised exponents, \\times for a multiplication cross between numbers, / for ÷, % for percent, commas between list items.',
    'Keep capital-letter names (A, B…), a letter x that is an unknown (as in 2x + 3 = 11), units (ft, in, sq ft, m, lb, kg, gal…) and "=" exactly as written. Do NOT solve it and do not add an answer that is not written.',
    'Examples (what the ink shows → what you return):',
    '• a 3 over a bar over a 4, then + and a root sign over 16 → \\frac{3}{4}+\\sqrt{16}',
    '• 12, a cross between numbers, (3+4) and a small raised 2 → 12\\times(3+4)^{2}',
    '• 125 written above +37, right-aligned, with a line under both → 125+37',
    '• 2x + 3 = 11 where the x is a curvy letter next to the 2 → 2x+3=11',
    '• 1,5 + 2,25 written with comma decimals → 1.5+2.25',
    '• 24 x 36 in to sq ft → 24\\times36 in to sq ft',
    '• 15% of 80 → 15\\% of 80        • |−5| + 2 → |-5|+2        • A × B → A\\times B        • 5C2 → 5C2',
    'Reply in exactly this format:',
    'line 1: the expression only (or [unreadable])',
    'line 2, only if a symbol is genuinely ambiguous: ALT: <other full reading> | <another>',
    'line 3: CONF: <0.0–1.0 how sure you are>'].join('\n');
  function prompt(layoutHint, biasHint) { return [PROMPT, layoutHint, biasHint].filter(Boolean).join('\n'); }
  function renderInk(strokes, opts = {}) {     // tight crop, the writing scaled to ~60 px per line, dark on white
    if (typeof document === 'undefined' || !strokes.length) return '';
    const bbs = strokes.map(BB), u = union(bbs), g = bbs.filter(b => Hh(b) > 5 && !isBarBB(b)).map(Hh), H = Math.max(8, med(g) || 24);
    let sc = Math.max(0.6, Math.min(4, (opts.lineH || 60) / H)); const pad = Math.max(10, 0.35 * H * sc), maxSide = opts.max || 1600;
    sc = Math.min(sc, (maxSide - 2 * pad) / Math.max(1, W(u)), (maxSide - 2 * pad) / Math.max(1, Hh(u)));
    const c = document.createElement('canvas'); c.width = Math.max(64, Math.round(W(u) * sc + 2 * pad)); c.height = Math.max(48, Math.round(Hh(u) * sc + 2 * pad));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.strokeStyle = '#111'; x.lineCap = x.lineJoin = 'round';
    x.lineWidth = Math.max(2.2, Math.min(7, H * sc * 0.075));
    const ox = (c.width - W(u) * sc) / 2 - u[0] * sc, oy = (c.height - Hh(u) * sc) / 2 - u[1] * sc;
    for (const s of strokes) { const p = s.points; x.beginPath(); x.moveTo(ox + p[0][0] * sc, oy + p[0][1] * sc); if (p.length === 1) x.lineTo(ox + p[0][0] * sc + 0.5, oy + p[0][1] * sc); for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; x.quadraticCurveTo(ox + p[i][0] * sc, oy + p[i][1] * sc, ox + mx * sc, oy + my * sc); } if (p.length > 1) x.lineTo(ox + p[p.length - 1][0] * sc, oy + p[p.length - 1][1] * sc); x.stroke(); }
    return c.toDataURL('image/png');
  }

  /* the board's pause-flush: which existing formulas do the newly written strokes join?
     pending: [stroke] · exprs: [{ id, strokes: [stroke] }] → [{ pending: [stroke], exprIds: [id…] }] (one entry per new/extended formula) */
  function assign(pending, exprs) {
    if (!pending.length) return [];
    const pb = union(pending.map(BB)), hs = pending.map(BB).filter(b => Hh(b) > 5 && !isBarBB(b)).map(Hh), H = Math.max(10, Math.min(220, topMed(hs) || 24)), R = 4 * H;
    const nearX = exprs.filter(e => { if (!e.strokes.length) return false; const b = union(e.strokes.map(BB)); return b[0] < pb[2] + R && b[2] > pb[0] - R && b[1] < pb[3] + R && b[3] > pb[1] - R; });
    const strokes = [...pending], owner = pending.map(() => null);
    for (const e of nearX) for (const st of e.strokes) { strokes.push(st); owner.push(e.id); }
    const out = [];
    for (const g of group(strokes)) {
      const pend = g.filter(i => owner[i] === null); if (!pend.length) continue;
      out.push({ pending: pend.map(i => strokes[i]), exprIds: [...new Set(g.map(i => owner[i]).filter(Boolean))] });
    }
    return out;
  }

  const CalcRecog = { version: 'v21ef', group, assign, layout, structuredRead, assemble, describe, parseGrok, combine, confLevel, makeBias, align, prompt, PROMPT, renderInk, _bb: BB };
  if (typeof module === 'object' && module.exports) module.exports = CalcRecog; else root.CalcRecog = CalcRecog;
})(typeof window !== 'undefined' ? window : globalThis);
