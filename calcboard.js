/* Pencil Notes — 🧮 Calculator Board (v21ee part B, MOCK).
   A second freeform board in the Boards drawer, next to the 💡 Idea Board: write math with the Apple Pencil, pause (or write "=")
   and the typed result appears beside the ink. Tap a result to correct what was recognized.
   ◌ Lasso several areas → they become linked values (A, B, C…). Σ Sum / x̄ Average / ƒ Functions ▾ (Margin, Markup, % change,
   % of, stats, weighted average, tax / discount…) create a linked result block that recalculates whenever a source changes.
   Names can be used in later formulas (write "A*B"). Everything persists with the board (its own IndexedDB store) and has Undo.
   Recognition reuses the app's path (Grok via the user's saved AI key → V21e4.recognizeStrokes); no key lives in this file.
   Sections: 1. CalcMath (normalizer, parser, evaluator) · 2. CalcFns (business + stats) · 3. the board UI. 1–2 also load in Node for tests. */
(function (root) {
  'use strict';

  /* ============================== 1. CalcMath ============================== */
  class CalcError extends Error { constructor(msg) { super(msg); this.calc = true; } }
  const fail = m => { throw new CalcError(m); };

  // matching close brace for LaTeX groups
  function braceGroup(s, i) {          // s[i] === '{' → [inner, indexAfter]
    let d = 0;
    for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}') { d--; if (!d) return [s.slice(i + 1, j), j + 1]; } }
    return [s.slice(i + 1), s.length];
  }
  function latexArg(s, i) {            // a {group} or a single char/number after \frac, \sqrt
    while (s[i] === ' ') i++;
    if (s[i] === '{') return braceGroup(s, i);
    const m = /^(\d+(?:\.\d+)?|[A-Za-z]|\\[A-Za-z]+)/.exec(s.slice(i)); if (m) return [m[0], i + m[0].length];
    return ['', i];
  }
  function delatex(s) {
    let out = '', i = 0;
    while (i < s.length) {
      if (s.startsWith('\\frac', i) || s.startsWith('\\dfrac', i) || s.startsWith('\\tfrac', i)) {
        i += s.startsWith('\\frac', i) ? 5 : 6;
        const [a, j] = latexArg(s, i), [b, k] = latexArg(s, j); out += `((${delatex(a)})/(${delatex(b)}))`; i = k; continue;
      }
      if (s.startsWith('\\sqrt', i)) {
        i += 5; while (s[i] === ' ') i++;
        let n = null; if (s[i] === '[') { const e = s.indexOf(']', i); n = s.slice(i + 1, e < 0 ? s.length : e); i = e < 0 ? s.length : e + 1; }
        const [a, j] = latexArg(s, i); out += n ? `root((${delatex(a)}),(${delatex(n)}))` : `sqrt(${delatex(a)})`; i = j; continue;
      }
      const t = /^\\(?:text|mathrm|mathbf|operatorname)\s*\{/.exec(s.slice(i));
      if (t) { const [a, j] = braceGroup(s, i + t[0].length - 1); out += a; i = j; continue; }
      out += s[i++];
    }
    return out;
  }
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
  /* handwriting / LaTeX-ish → one plain calculator string: "\frac{3}{4}\times 2^{3}" → "((3)/(4))*2^(3)" */
  function normalize(src) {
    let s = String(src == null ? '' : src).trim();
    s = s.replace(/^\$+|\$+$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '');
    s = s.replace(/\\left|\\right|\\[,;:! ]|\\displaystyle/g, '').replace(/\\%/g, '%').replace(/\\\$/g, '');
    s = delatex(s);
    s = s.replace(/\\(?:cdot|times|ast)/g, '*').replace(/\\div/g, '/').replace(/\\pi/g, 'pi').replace(/\\(?:le|leq)\b/g, '<=')
      .replace(/\\(sin|cos|tan|ln|log|exp|min|max)/g, '$1').replace(/\\[A-Za-z]+/g, '');
    s = s.replace(/[×✕✖·∙•⋅]/g, '*').replace(/[÷∶]/g, '/').replace(/[−–—‒]/g, '-').replace(/π/g, 'pi').replace(/[＝]/g, '=')
      .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[，]/g, ',').replace(/\^\s*\{/g, '^{').replace(/\*\*/g, '^');
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => '^(' + [...m].map(c => SUP[c]).join('') + ')');
    s = s.replace(/∛\s*/g, ' cbrt ').replace(/√\s*/g, ' sqrt ');
    s = s.replace(/[{\[]/g, '(').replace(/[}\]]/g, ')');
    s = s.replace(/\$/g, '');                                                    // currency signs: "$12.50" → 12.50
    s = s.replace(/(\d)\s*%\s*of\b/gi, '$1%*').replace(/\bof\b/gi, '*');         // "15% of 80"
    for (let k = 0; k < 2; k++) s = s.replace(/([\d.)])\s*[xX]\s*(?=[\d.(]|sqrt|pi)/g, '$1*');   // handwritten "3 x 4" means ×
    for (let k = 0; k < 2; k++) s = s.replace(/([A-Za-z\d.)])\s+[xX]\s+(?=[A-Za-z\d.(])/g, '$1*');                  // "A x B" with spaces
    return s.replace(/\s+/g, ' ').trim();
  }

  const FUNCS = {};
  const num1 = (name, f) => FUNCS[name] = { n: 1, f: a => f(scalar(a[0], name)) };
  const deg = x => x * Math.PI / 180;
  const roundTrig = v => Math.abs(v) < 1e-12 ? 0 : Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v;
  num1('sqrt', x => x < 0 ? fail('Square root of a negative number') : Math.sqrt(x));
  num1('cbrt', x => Math.cbrt(x));
  num1('abs', Math.abs); num1('floor', Math.floor); num1('ceil', Math.ceil); num1('exp', Math.exp);
  num1('ln', x => x <= 0 ? fail('ln needs a number above 0') : Math.log(x));
  num1('sin', x => roundTrig(Math.sin(deg(x)))); num1('cos', x => roundTrig(Math.cos(deg(x))));
  num1('tan', x => { const c = Math.cos(deg(x)); return Math.abs(c) < 1e-12 ? fail('tan is undefined there') : roundTrig(Math.tan(deg(x))); });
  num1('asin', x => Math.abs(x) > 1 ? fail('asin needs −1…1') : Math.asin(x) * 180 / Math.PI);
  num1('acos', x => Math.abs(x) > 1 ? fail('acos needs −1…1') : Math.acos(x) * 180 / Math.PI);
  num1('atan', x => Math.atan(x) * 180 / Math.PI);
  FUNCS.log = { n: [1, 2], f: a => { const x = scalar(a[0], 'log'), b = a.length > 1 ? scalar(a[1], 'log') : 10; if (x <= 0) fail('log needs a number above 0'); if (b <= 0 || b === 1) fail('Bad log base'); return Math.log(x) / Math.log(b); } };
  FUNCS.root = { n: 2, f: a => { const x = scalar(a[0], 'root'), n = scalar(a[1], 'root'); if (n === 0) fail('0th root is undefined'); if (x < 0) { if (Number.isInteger(n) && n % 2) return -Math.pow(-x, 1 / n); fail('Even root of a negative number'); } return Math.pow(x, 1 / n); } };
  FUNCS.round = { n: [1, 2], f: a => { const x = scalar(a[0], 'round'), d = a.length > 1 ? scalar(a[1], 'round') : 0; const p = Math.pow(10, d); return Math.round((x + Math.sign(x) * Number.EPSILON) * p) / p; } };
  function scalar(v, ctx) { if (Array.isArray(v)) { if (v.length === 1) return v[0]; fail((ctx ? ctx + ' expects' : 'Expected') + ' one number, got a list of ' + v.length); } return v; }
  const flat = a => a.flat(Infinity);

  const ID_RE = /^[A-Za-z_][A-Za-z_0-9]*$/;
  function tokenize(s) {
    const toks = [], stack = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      const rest = s.slice(i);
      let m;
      if (stack[stack.length - 1] !== 'call' && (m = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d,]*\d)/.exec(rest)) && !/^,\d/.test(rest.slice(m[0].length))) { toks.push({ t: 'num', v: parseFloat(m[0].replace(/,/g, '')), s: m[0] }); i += m[0].length; continue; }
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) { toks.push({ t: 'num', v: parseFloat(m[0]), s: m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_]+/.exec(rest))) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ('+-*/^%!(),;='.includes(c)) {
        if (c === '(') stack.push(toks.length && toks[toks.length - 1].t === 'id' && FUNCS_ALL()[toks[toks.length - 1].v.toLowerCase()] ? 'call' : 'group');
        if (c === ')') stack.pop();
        toks.push({ t: 'op', v: c === ';' ? ',' : c }); i++; continue;
      }
      fail(`Can't read “${c}”`);
    }
    return toks;
  }

  /* recursive-descent parser. Precedence (low→high): list "," · + − · × ÷ (and implicit 2(3), 2pi, 3A) · unary − · ^ (right-assoc) · postfix % ! */
  function parse(src) {
    const toks = tokenize(src); let p = 0, autoClosed = 0;
    const peek = () => toks[p], isOp = (v, t = toks[p]) => t && t.t === 'op' && t.v === v;
    const next = () => toks[p++];
    function list() {
      const items = [add()];
      while (isOp(',')) { next(); items.push(add()); }
      return items.length > 1 ? { t: 'list', items } : items[0];
    }
    function add() {
      let a = mul();
      while (isOp('+') || isOp('-')) {
        const op = next().v, b = mul();
        a = b.t === 'pct' ? { t: 'pctadd', op, a, p: b.a } : { t: 'bin', op, a, b };   // calculator rule: 200 + 10% = 220
      }
      return a;
    }
    const startsPrimary = t => t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '('));
    function mul() {
      let a = unary();
      for (;;) {
        if (isOp('*') || isOp('/')) { const op = next().v; a = { t: 'bin', op, a, b: unary() }; continue; }
        if (startsPrimary(peek())) { a = { t: 'bin', op: '*', a, b: unary(), implicit: true }; continue; }
        return a;
      }
    }
    function unary() {
      if (isOp('-')) { next(); return { t: 'neg', a: unary() }; }
      if (isOp('+')) { next(); return unary(); }
      return power();
    }
    function power() {
      const base = postfix();
      if (isOp('^')) { next(); return { t: 'bin', op: '^', a: base, b: unary() }; }
      return base;
    }
    function postfix() {
      let a = primary();
      while (isOp('%') || isOp('!')) a = next().v === '%' ? { t: 'pct', a } : { t: 'fact', a };
      return a;
    }
    function primary() {
      const t = next();
      if (!t) fail('The formula ends too early');
      if (t.t === 'num') return { t: 'num', v: t.v };
      if (t.t === 'op' && t.v === '(') {
        if (isOp(')')) fail('Empty brackets');
        const e = list(); if (isOp(')')) next(); else autoClosed++;
        return e.t === 'list' ? e : { t: 'group', a: e };
      }
      if (t.t === 'id') {
        const name = t.v, fn = FUNCS_ALL()[name.toLowerCase()];
        if (fn && isOp('(')) {
          next(); const args = [];
          if (!isOp(')')) { args.push(add()); while (isOp(',')) { next(); args.push(add()); } }
          if (isOp(')')) next(); else autoClosed++;
          return { t: 'call', name: name.toLowerCase(), args };
        }
        if (fn && fn.n === 1 && startsPrimary(peek())) return { t: 'call', name: name.toLowerCase(), args: [postfix()] };   // √9, sqrt 9
        if (/^(pi|e)$/i.test(name) && !/^E$/.test(name)) return { t: 'const', name: name.toLowerCase() };
        return { t: 'var', name };
      }
      if (t.t === 'op' && t.v === ')') fail('Extra “)”');
      fail(`Unexpected “${t.v}”`);
    }
    if (!toks.length) fail('Nothing to calculate');
    const ast = list();
    if (p < toks.length) { const t = toks[p]; fail(t.v === ')' ? 'Extra “)”' : `Unexpected “${t.v}”`); }
    ast.autoClosed = autoClosed;
    return ast;
  }
  let EXTRA_FUNCS = {};
  const FUNCS_ALL = () => EXTRA_FUNCS;

  function fact(n) {
    if (n < 0 || !Number.isInteger(n)) fail('! needs a whole number ≥ 0');
    if (n > 170) fail('Too large'); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
  }
  function evaluate(ast, env = {}) {
    const resolve = env.resolve || (n => (env.vars && Object.prototype.hasOwnProperty.call(env.vars, n)) ? env.vars[n] : undefined);
    const refs = new Set();
    function lookup(name) {
      let v = resolve(name); if (v !== undefined) { refs.add(name); return v; }
      const up = name.toUpperCase(); if (up !== name) { v = resolve(up); if (v !== undefined) { refs.add(up); return v; } }
      if (/^[A-Za-z]{2,4}$/.test(name)) {                          // "AB" = A·B when both are names
        const parts = [...name].map(ch => resolve(ch) !== undefined ? ch : resolve(ch.toUpperCase()) !== undefined ? ch.toUpperCase() : null);
        if (parts.every(Boolean)) return parts.reduce((acc, ch) => { refs.add(ch); return acc * scalar(resolve(ch), ch); }, 1);
      }
      fail(`Unknown name “${name}”`);
    }
    function ev(n) {
      switch (n.t) {
        case 'num': return n.v;
        case 'const': return n.name === 'pi' ? Math.PI : Math.E;
        case 'var': return lookup(n.name);
        case 'group': return ev(n.a);
        case 'list': return flat(n.items.map(ev));
        case 'neg': { const a = ev(n.a); return Array.isArray(a) ? a.map(x => -x) : -a; }
        case 'pct': return scalar(ev(n.a), '%') / 100;
        case 'fact': return fact(scalar(ev(n.a), '!'));
        case 'pctadd': { const a = scalar(ev(n.a)), q = scalar(ev(n.p)) / 100; return n.op === '+' ? a * (1 + q) : a * (1 - q); }
        case 'bin': {
          const a = scalar(ev(n.a)), b = scalar(ev(n.b));
          switch (n.op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': if (b === 0) fail(a === 0 ? '0 ÷ 0 is undefined' : "Can't divide by 0"); return a / b;
            case '^': {
              if (a === 0 && b === 0) fail('0⁰ is undefined'); if (a === 0 && b < 0) fail("Can't divide by 0");
              if (a < 0 && !Number.isInteger(b)) { const inv = 1 / b; if (Number.isInteger(Math.round(inv * 1e9) / 1e9) && Math.round(inv) % 2) return -Math.pow(-a, b); fail('Fractional power of a negative number'); }
              return Math.pow(a, b);
            }
          }
          break;
        }
        case 'call': {
          const f = FUNCS_ALL()[n.name]; if (!f) fail(`Unknown function “${n.name}”`);
          const args = n.args.map(ev);
          if (f.n !== undefined) { const [lo, hi] = Array.isArray(f.n) ? f.n : [f.n, f.n]; if (args.length < lo || args.length > hi) fail(`${n.name} needs ${lo === hi ? lo : lo + '–' + hi} input${hi > 1 ? 's' : ''}`); }
          return f.f(args);
        }
      }
      fail('Bad formula');
    }
    const v = ev(ast);
    const chk = x => { if (typeof x !== 'number' || Number.isNaN(x)) fail('Not a number'); if (!Number.isFinite(x)) fail('Too large'); return clean(x); };
    return { value: Array.isArray(v) ? v.map(chk) : chk(v), refs: [...refs] };
  }
  const clean = x => x === 0 ? 0 : +x.toPrecision(14);        // 0.1 + 0.2 → 0.3

  function format(v, { unit = '' } = {}) {
    if (Array.isArray(v)) return v.map(x => format(x)).join(', ');
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    let s;
    if (a !== 0 && (a >= 1e15 || a < 1e-6)) { const [m, e] = v.toExponential(6).split('e'); s = `${(+m < 0 ? '−' : '') + Math.abs(+m)}×10^${+e}`; }
    else {
      const r = +v.toPrecision(14), maxD = unit === '%' ? 2 : 6;
      const [ip, fp] = r.toFixed(Math.min(maxD, Math.max(0, 12 - String(Math.trunc(Math.abs(r))).length))).split('.');
      const f2 = (fp || '').replace(/0+$/, '');
      s = (r < 0 && (+ip !== 0 || f2) ? '−' : '') + ip.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f2 ? '.' + f2 : '');
    }
    return s + unit;
  }

  /* one handwritten line → result. Handles "expr", "expr =", "expr = 12" (checks it), "r = 12" (defines r), and lists "4, 8, 15". */
  function evalText(text, env = {}) {
    const raw = String(text || ''); const s = normalize(raw);
    const out = { raw, normalized: s, ok: false, kind: 'value', value: null, display: '', error: '', refs: [], name: '' };
    try {
      if (!s || /^=*$/.test(s)) fail('Nothing to calculate');
      const parts = s.split('=').map(x => x.trim());
      let lhs = parts[0], rhs = parts.length > 1 ? parts.slice(1).filter(Boolean).pop() || '' : '';
      if (parts.length > 1 && ID_RE.test(lhs) && !FUNCS_ALL()[lhs.toLowerCase()] && rhs && !/^(pi|e)$/i.test(lhs)) { out.kind = 'assign'; out.name = lhs; lhs = rhs; rhs = ''; }
      if (!lhs) fail('Nothing to calculate');
      const ast = parse(lhs), r = evaluate(ast, env);
      out.value = r.value; out.refs = r.refs; out.ok = true; out.autoClosed = ast.autoClosed || 0;
      if (Array.isArray(r.value)) out.kind = out.kind === 'assign' ? 'assign' : 'list';
      if (rhs && out.kind !== 'assign') {
        try { const want = evaluate(parse(rhs), env).value; out.kind = 'check'; out.expected = want; out.correct = !Array.isArray(want) && Math.abs(want - r.value) <= 1e-9 * Math.max(1, Math.abs(r.value)); } catch (_) { /* a scribble after "=" is ignored */ }
      }
      out.display = format(r.value);
    } catch (e) { if (!e.calc) throw e; out.error = e.message; }
    return out;
  }

  /* ============================== 2. CalcFns ============================== */
  const need = (x, label) => { if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${label} needs a number`); return x; };
  const nums = (v, label, min = 1) => { const a = flat([v]).filter(x => x !== undefined && x !== null); a.forEach(x => need(x, label)); if (a.length < min) fail(`${label} needs at least ${min} value${min > 1 ? 's' : ''}`); return a; };
  const sum = a => clean(a.reduce((s, x) => s + x, 0));
  const mean = a => sum(a) / a.length;
  const median = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  function modes(a) {
    const cnt = new Map(); for (const x of a) cnt.set(x, (cnt.get(x) || 0) + 1);
    const top = Math.max(...cnt.values()); if (top === 1 && a.length > 1) return [];
    return [...cnt].filter(([, c]) => c === top).map(([x]) => x).sort((x, y) => x - y);
  }
  const variance = (a, sample) => { if (sample && a.length < 2) fail('Sample needs at least 2 values'); const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - (sample ? 1 : 0)); };
  const S1 = (id, label, short, fn, extra = {}) => ({ id, label, short, group: 'Statistics', inputs: [{ k: 'values', label: 'Values', multi: true }], formula: extra.formula || '', run: i => fn(nums(i.values, label, extra.min || 1)), ...extra });
  const FN_LIST = [
    { id: 'margin', label: 'Margin', short: 'Margin', group: 'Business', unit: '%', inputs: [{ k: 'cost', label: 'Cost' }, { k: 'price', label: 'Price' }], formula: '(price − cost) ÷ price',
      run: ({ cost, price }) => { need(cost, 'Cost'); need(price, 'Price'); if (price === 0) fail('Price is 0 — margin is undefined'); return (price - cost) / price * 100; },
      extra: ({ cost, price }) => `profit ${format(price - cost)}` },
    { id: 'markup', label: 'Markup', short: 'Markup', group: 'Business', unit: '%', inputs: [{ k: 'cost', label: 'Cost' }, { k: 'price', label: 'Price' }], formula: '(price − cost) ÷ cost',
      run: ({ cost, price }) => { need(cost, 'Cost'); need(price, 'Price'); if (cost === 0) fail('Cost is 0 — markup is undefined'); return (price - cost) / cost * 100; },
      extra: ({ cost, price }) => `profit ${format(price - cost)}` },
    { id: 'priceMarkup', label: 'Price from markup %', short: 'Price', group: 'Business', inputs: [{ k: 'cost', label: 'Cost' }, { k: 'pct', label: 'Markup %' }], formula: 'cost × (1 + markup%)',
      run: ({ cost, pct }) => need(cost, 'Cost') * (1 + need(pct, 'Markup %') / 100) },
    { id: 'priceMargin', label: 'Price from margin %', short: 'Price', group: 'Business', inputs: [{ k: 'cost', label: 'Cost' }, { k: 'pct', label: 'Margin %' }], formula: 'cost ÷ (1 − margin%)',
      run: ({ cost, pct }) => { need(cost, 'Cost'); need(pct, 'Margin %'); if (pct >= 100) fail('Margin must be under 100%'); return cost / (1 - pct / 100); } },
    { id: 'pctChange', label: '% increase / decrease', short: '% change', group: 'Business', unit: '%', signed: true, inputs: [{ k: 'old', label: 'Old' }, { k: 'new', label: 'New' }], formula: '(new − old) ÷ |old|',
      run: i => { const o = need(i.old, 'Old'), n = need(i.new, 'New'); if (o === 0) fail('Old value is 0 — % change is undefined'); return (n - o) / Math.abs(o) * 100; },
      extra: i => (i.new - i.old >= 0 ? 'increase of ' : 'decrease of ') + format(Math.abs(i.new - i.old)) },
    { id: 'pctOf', label: '% of', short: '% of', group: 'Business', inputs: [{ k: 'pct', label: 'Percent' }, { k: 'of', label: 'Of' }], formula: 'percent ÷ 100 × value',
      run: ({ pct, of }) => need(pct, 'Percent') / 100 * need(of, 'Of') },
    { id: 'tax', label: 'Add tax', short: 'With tax', group: 'Business', inputs: [{ k: 'amount', label: 'Amount' }, { k: 'rate', label: 'Tax %' }], formula: 'amount × (1 + tax%)',
      run: ({ amount, rate }) => need(amount, 'Amount') * (1 + need(rate, 'Tax %') / 100), extra: ({ amount, rate }) => `tax ${format(amount * rate / 100)}` },
    { id: 'discount', label: 'Discount', short: 'After discount', group: 'Business', inputs: [{ k: 'amount', label: 'Amount' }, { k: 'rate', label: 'Discount %' }], formula: 'amount × (1 − discount%)',
      run: ({ amount, rate }) => need(amount, 'Amount') * (1 - need(rate, 'Discount %') / 100), extra: ({ amount, rate }) => `saves ${format(amount * rate / 100)}` },
    S1('sum', 'Sum', 'Sum', sum, { formula: 'a + b + …' }),
    S1('average', 'Average', 'Average', mean, { formula: 'sum ÷ count' }),
    S1('median', 'Median', 'Median', median, { formula: 'middle value' }),
    S1('mode', 'Mode', 'Mode', a => { const m = modes(a); if (!m.length) fail('No mode — every value appears once'); return m.length === 1 ? m[0] : m; }, { formula: 'most frequent' }),
    S1('min', 'Min', 'Min', a => Math.min(...a)),
    S1('max', 'Max', 'Max', a => Math.max(...a)),
    S1('range', 'Range', 'Range', a => Math.max(...a) - Math.min(...a), { formula: 'max − min' }),
    S1('stdevS', 'Std dev (sample)', 'Std dev s', a => Math.sqrt(variance(a, true)), { formula: '√(Σ(x−x̄)² ÷ (n−1))', min: 2 }),
    S1('stdevP', 'Std dev (population)', 'Std dev σ', a => Math.sqrt(variance(a, false)), { formula: '√(Σ(x−μ)² ÷ n)' }),
    S1('varS', 'Variance (sample)', 'Variance s²', a => variance(a, true), { formula: 'Σ(x−x̄)² ÷ (n−1)', min: 2 }),
    S1('varP', 'Variance (population)', 'Variance σ²', a => variance(a, false), { formula: 'Σ(x−μ)² ÷ n' }),
    S1('count', 'Count', 'Count', a => a.length),
    { id: 'wavg', label: 'Weighted average', short: 'Weighted avg', group: 'Statistics', inputs: [{ k: 'values', label: 'Values', multi: true }, { k: 'weights', label: 'Weights', multi: true }], formula: 'Σ(value × weight) ÷ Σweight',
      run: i => { const v = nums(i.values, 'Values'), w = nums(i.weights, 'Weights'); if (v.length !== w.length) fail(`${v.length} values but ${w.length} weights`); const sw = sum(w); if (sw === 0) fail('Weights add up to 0'); return v.reduce((s, x, k) => s + x * w[k], 0) / sw; } },
  ];
  const FN = Object.fromEntries(FN_LIST.map(f => [f.id, f]));
  function runFn(id, inputs) {
    const f = FN[id]; if (!f) return { ok: false, error: 'Unknown function' };
    try {
      const v = f.run(inputs), value = Array.isArray(v) ? v.map(clean) : clean(v);
      if ((Array.isArray(value) ? value : [value]).some(x => !Number.isFinite(x))) fail('Too large');
      let extra = ''; try { extra = f.extra ? f.extra(inputs) : ''; } catch (_) {}
      return { ok: true, value, display: (f.signed && value > 0 ? '+' : '') + format(value, { unit: f.unit || '' }), extra };
    } catch (e) { if (!e.calc) throw e; return { ok: false, error: e.message }; }
  }
  // formula-callable versions: sum(A, B), avg(...), median, mode, stdev, margin(cost, price)…
  const stat = id => ({ f: a => { const r = runFn(id, { values: flat(a) }); if (!r.ok) fail(r.error); return Array.isArray(r.value) ? r.value[0] : r.value; } });
  const two = (id, k1, k2) => ({ n: 2, f: a => { const r = runFn(id, { [k1]: scalar(a[0]), [k2]: scalar(a[1]) }); if (!r.ok) fail(r.error); return r.value; } });
  EXTRA_FUNCS = Object.assign({}, FUNCS, {
    sum: stat('sum'), avg: stat('average'), mean: stat('average'), average: stat('average'), median: stat('median'), mode: stat('mode'),
    min: stat('min'), max: stat('max'), range: stat('range'), count: stat('count'), stdev: stat('stdevS'), sd: stat('stdevS'), stdevp: stat('stdevP'),
    var: stat('varS'), varp: stat('varP'),
    margin: two('margin', 'cost', 'price'), markup: two('markup', 'cost', 'price'), pctchange: two('pctChange', 'old', 'new'), pctof: two('pctOf', 'pct', 'of'),
    tax: two('tax', 'amount', 'rate'), discount: two('discount', 'amount', 'rate'),
  });

  const CalcMath = { normalize, tokenize, parse, evaluate, evalText, format, CalcError };
  const CalcFns = { list: FN_LIST, get: id => FN[id], run: runFn, modes };
  if (typeof module === 'object' && module.exports) { module.exports = { CalcMath, CalcFns }; return; }
  root.CalcMath = CalcMath; root.CalcFns = CalcFns;
  /* ============================== 3. the board UI ============================== */
  if (typeof document === 'undefined') return;
  const G = name => { switch (name) { case 'BOARDS': return typeof BOARDS !== 'undefined' ? BOARDS : undefined; case 'QB': return typeof QB !== 'undefined' ? QB : undefined; case 'V21e4': return typeof V21e4 !== 'undefined' ? V21e4 : undefined; case 'actionSheet': return typeof actionSheet !== 'undefined' ? actionSheet : undefined; case 'aiReady': return typeof aiReady !== 'undefined' ? aiReady : undefined; case 'aiRequest': return typeof aiRequest !== 'undefined' ? aiRequest : undefined; case 'drawStroke': return typeof drawStroke !== 'undefined' ? drawStroke : undefined; case 'inkBB': return typeof inkBB !== 'undefined' ? inkBB : undefined; case 'inkToPNG': return typeof inkToPNG !== 'undefined' ? inkToPNG : undefined; case 'isDark': return typeof isDark !== 'undefined' ? isDark : undefined; case 'qbBadge': return typeof qbBadge !== 'undefined' ? qbBadge : undefined; case 'qbOpen': return typeof qbOpen !== 'undefined' ? qbOpen : undefined; case 'qbRender': return typeof qbRender !== 'undefined' ? qbRender : undefined; case 'qbSyncUndo': return typeof qbSyncUndo !== 'undefined' ? qbSyncUndo : undefined; case 'setDrawerBoard': return typeof setDrawerBoard !== 'undefined' ? setDrawerBoard : undefined; case 'toast': return typeof toast !== 'undefined' ? toast : undefined; case 'widthRow': return typeof widthRow !== 'undefined' ? widthRow : undefined; } return undefined; };   // app globals (classic-script scope), read live so later wrappers count
  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toastc = (m, ms) => { const t = G('toast'); if (t) t(m, ms); else console.log(m); };
  const COLORS = ['#e5484d', '#0ea5e9', '#22a55a', '#d97706', '#8b5cf6', '#db2777', '#14b8a6', '#65a30d'];
  const uidc = p => p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 7);
  const emptyBoard = () => ({ v: 1, strokes: [], exprs: [], blocks: [], view: { x: 40, y: 30, z: 1 } });
  const CB = { board: emptyBoard(), undo: [], redo: [], tool: 'pen', sel: [], vals: new Map(), recog: null, pending: new Set(), timer: 0, loaded: false, el: null, g: null, ptrs: new Map(), menu: null };
  const PAUSE_MS = 900, EQUALS_MS = 160;

  /* ---------- storage: one record in its own IndexedDB database (never touches the notes store) ---------- */
  const IDB = {
    p: null,
    open() { return this.p || (this.p = new Promise((res, rej) => { const r = indexedDB.open('pencil-calc', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
    async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
    async put(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
  };
  let saveT = 0;
  const plain = () => JSON.parse(JSON.stringify(CB.board, (k, v) => k === 'bb' && Array.isArray(v) && v.length === 4 ? v : k === 'rtok' ? undefined : v));
  function save(now) { clearTimeout(saveT); const run = () => IDB.put('board', plain()).catch(e => toastc('⚠︎ Calculator Board save failed: ' + e.message, 4000)); if (now) return run(); saveT = setTimeout(run, 300); return Promise.resolve(); }
  async function load() {
    try { const b = await IDB.get('board'); if (b && b.v === 1) CB.board = Object.assign(emptyBoard(), b); } catch (e) { console.warn('calc board load', e); }
    CB.loaded = true; recalc();
    for (const e of CB.board.exprs) if (e.status === 'reading') recognize(e);
    if (isOpen()) render();
  }

  /* ---------- undo ---------- */
  const snap = () => JSON.stringify({ strokes: CB.board.strokes, exprs: CB.board.exprs, blocks: CB.board.blocks });
  function hist() { CB.undo.push(snap()); if (CB.undo.length > 80) CB.undo.shift(); CB.redo = []; syncUndo(); }
  function undoRedo(from, to) {
    if (!from.length) return false;
    flushPending(true); to.push(snap()); Object.assign(CB.board, JSON.parse(from.pop()));
    CB.sel = CB.sel.filter(node); CB.pending.clear();
    const inExpr = new Set(CB.board.exprs.flatMap(e => e.sids)); for (const s of CB.board.strokes) if (!inExpr.has(s.id)) CB.pending.add(s.id);
    if (CB.pending.size) schedule(PAUSE_MS);
    recalc(); render(); save(); syncUndo(); return true;
  }
  const undo = () => undoRedo(CB.undo, CB.redo), redo = () => undoRedo(CB.redo, CB.undo);
  function syncUndo() { if (!isOpen()) return; const u = document.getElementById('qbUndo'), r = document.getElementById('qbRedo'); if (u) u.disabled = !CB.undo.length; if (r) r.disabled = !CB.redo.length; }

  /* ---------- model helpers ---------- */
  const node = id => CB.board.exprs.find(e => e.id === id) || CB.board.blocks.find(b => b.id === id) || null;
  const strokeById = id => CB.board.strokes.find(s => s.id === id);
  const bboxOf = pts => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; };
  const sbb = s => s.bb || (s.bb = bboxOf(s.points));
  const union = bbs => bbs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const exprBB = e => { const bbs = e.sids.map(strokeById).filter(Boolean).map(sbb); if (!bbs.length && e.typed && e.bb) return e.bb; return (e.bb = union(bbs)); };   // typed exprs (sent by the 🛰 Satellite) keep their own box
  function nodeBB(n) {
    if (n.sids) { const c = CB.el && CB.el.items.querySelector(`.cb-res[data-eid="${n.id}"]`); return c ? [n.bb[0], Math.min(n.bb[1], c.offsetTop), Math.max(n.bb[2], c.offsetLeft + c.offsetWidth), Math.max(n.bb[3], c.offsetTop + c.offsetHeight)] : n.bb; } const el = CB.el && CB.el.items.querySelector(`[data-bid="${n.id}"]`); const w = el ? el.offsetWidth : 170, h = el ? el.offsetHeight : 90; return [n.x, n.y, n.x + w, n.y + h]; }
  const named = () => [...CB.board.exprs, ...CB.board.blocks].filter(n => n.name);
  function nextName() { const used = new Set(named().map(n => n.name.toUpperCase())); for (let i = 0; ; i++) { const nm = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + i % 26); if (nm !== 'X' && nm !== 'E' && !used.has(nm)) return nm; } }
  function nextColor() { const used = named().map(n => n.color); return COLORS.find(c => !used.includes(c)) || COLORS[named().length % COLORS.length]; }
  function ensureName(n) { if (!n.name) { n.name = nextName(); n.color = n.color || nextColor(); return true; } if (!n.color) n.color = nextColor(); return false; }
  const readingOrder = (a, b) => { const A = nodeBB(a), B = nodeBB(b), ay = (A[1] + A[3]) / 2, by = (B[1] + B[3]) / 2; return Math.abs(ay - by) > 30 ? ay - by : A[0] - B[0]; };

  /* ---------- evaluation graph: expressions + linked blocks, by name and by link; cycles reported ---------- */
  function recalc() {
    const vals = new Map(), byName = new Map(), visiting = new Set();
    for (const n of named()) byName.set(n.name, n.id);
    const get = id => {
      if (vals.has(id)) return vals.get(id);
      if (visiting.has(id)) return { ok: false, error: 'Circular link' };
      visiting.add(id); const n = node(id);
      const r = !n ? { ok: false, error: 'Source was deleted', gone: true } : n.fn ? calcBlock(n) : calcExpr(n);
      visiting.delete(id); vals.set(id, r); return r;
    };
    const resolve = (self, nm) => { if (nm === self) return undefined; const id = byName.get(nm); if (!id) return undefined; const r = get(id); if (!r.ok) throw new CalcError(`${nm} ${r.empty ? 'is empty' : 'has an error'}`); return r.value; };
    function calcExpr(e) {
      if (!e.text) return { ok: false, empty: true, error: e.status === 'reading' ? '' : 'Not recognized', refs: [] };
      return evalText(e.text, { resolve: nm => resolve(e.name, nm) });
    }
    function calcBlock(b) {
      const f = CalcFns.get(b.fn); if (!f) return { ok: false, error: 'Unknown function' };
      const inp = {};
      for (const i of f.inputs) {
        const ids = (b.inputs && b.inputs[i.k]) || []; if (!ids.length) return { ok: false, error: `Pick ${i.label.toLowerCase()}` };
        const vs = [];
        for (const id of ids) { const r = get(id); if (!r.ok) { const nm = (node(id) || {}).name || 'A source'; return { ok: false, error: r.gone ? 'A source was deleted' : `${nm} ${r.empty ? 'is empty' : 'has an error'}` }; } vs.push(r.value); }
        const v = vs.flat();
        if (i.multi) inp[i.k] = v; else { if (v.length !== 1) return { ok: false, error: `${i.label} needs one number` }; inp[i.k] = v[0]; }
      }
      const r = CalcFns.run(b.fn, inp); r.inputs = inp; return r;
    }
    for (const n of [...CB.board.exprs, ...CB.board.blocks]) get(n.id);
    CB.vals = vals; return vals;
  }
  const val = id => CB.vals.get(id) || { ok: false };

  /* ---------- recognition (app path; tests swap in a stub with CalcBoard.setRecognizer) ---------- */
  const MATH_PROMPT = 'TASK: transcribe math\nTranscribe the handwritten math in the image as ONE line of LaTeX-style calculator input. Use \\frac{a}{b} for fractions, \\sqrt{x} or \\sqrt[n]{x} for roots, ^{ } for powers, * for ×, / for ÷, % for percent, commas between list items. Keep capital-letter names (A, B…) and "=" exactly as written. Do NOT solve it. Return only the expression, or [unreadable].';
  async function defaultRecognize(strokes) {
    const aiReady = G('aiReady'), aiRequest = G('aiRequest'), inkToPNG = G('inkToPNG'), inkBB = G('inkBB');
    if (aiReady && aiRequest && inkToPNG && aiReady()) {        // Grok (or the user's chosen model) with the key saved in Settings
      try {
        const t = await aiRequest([{ role: 'system', content: MATH_PROMPT }, { role: 'user', content: [{ type: 'text', text: 'Transcribe this handwritten math.' }, { type: 'image_url', image_url: { url: inkToPNG(strokes, inkBB ? inkBB(strokes) : undefined) } }] }], { json: false, timeout: 30000 });
        if (t && !/\[unreadable\]/i.test(t)) return t;
      } catch (e) { console.warn('calc recognize (AI)', e); }
    }
    const V = G('V21e4'); if (V && typeof V.recognizeStrokes === 'function') { try { return await V.recognizeStrokes(strokes); } catch (_) {} }   // on-device HW → Grok transcribe
    return '';
  }
  const cleanRecognized = t => String(t || '').replace(/```[a-z]*|```/gi, '').replace(/^\s*(?:answer|expression|latex)\s*:\s*/i, '').split('\n').map(x => x.trim()).filter(Boolean).join(' ').trim();
  async function recognize(e) {
    const tok = (e.rtok = (e.rtok || 0) + 1); e.status = 'reading'; e.text = ''; recalc(); renderOverlay();
    const strokes = e.sids.map(strokeById).filter(Boolean);
    let txt = ''; try { txt = await (CB.recog || defaultRecognize)(strokes, { bb: e.bb, id: e.id }); } catch (err) { console.warn(err); }
    const cur = CB.board.exprs.find(x => x.id === e.id); if (!cur || cur.rtok !== tok) return;
    cur.raw = cleanRecognized(txt); cur.text = cur.raw; cur.status = cur.text ? 'ok' : 'empty';
    adoptAssignName(cur); recalc(); renderOverlay(); save();
  }
  function adoptAssignName(e) {   // "r = 12" names this area r
    const r = evalText(e.text); if (r.kind !== 'assign' || !r.name) return;
    const taken = named().find(n => n !== e && n.name === r.name); if (taken) return;
    e.name = r.name; if (!e.color) e.color = nextColor();
  }

  /* ---------- grouping ink into expressions ---------- */
  function near(a, b) {
    const hGap = Math.max(a[0], b[0]) - Math.min(a[2], b[2]), vGap = Math.max(a[1], b[1]) - Math.min(a[3], b[3]);
    const ha = a[3] - a[1], hb = b[3] - b[1], wa = a[2] - a[0], wb = b[2] - b[0], lineH = Math.max(28, Math.min(90, Math.max(ha, hb)));
    const small = Math.min(ha, hb), big = ha < hb ? b : a, tiny = ha < hb ? a : b, tcy = (tiny[1] + tiny[3]) / 2;
    const sameLine = (-vGap >= 0.3 * small && small > 10) || (small <= 12 && tcy >= big[1] - 10 && tcy <= big[3] + 10);
    if (sameLine && hGap < Math.max(40, 0.9 * lineH)) return true;
    const isBar = (h, w) => w > 10 && h < 0.3 * w;                                   // fraction bar, "=" stroke, minus
    if (hGap < 0 && vGap < 22 && ((isBar(ha, wa) && wa >= 0.6 * wb) || (isBar(hb, wb) && wb >= 0.6 * wa))) return true;
    if (Math.max(wa, ha) < 9 || Math.max(wb, hb) < 9) return hGap < 24 && vGap < 24;   // dots (÷, decimals)
    return false;
  }
  function schedule(ms) { clearTimeout(CB.timer); CB.timer = setTimeout(() => flushPending(), ms); }
  function flushPending(noRecognize) {
    clearTimeout(CB.timer); if (!CB.pending.size) return [];
    const ps = [...CB.pending].map(strokeById).filter(Boolean); CB.pending.clear(); if (!ps.length) return [];
    const items = [...ps.map(s => ({ s, bb: sbb(s) })), ...CB.board.exprs.filter(e => !e.typed).map(e => ({ e, bb: e.bb }))];
    const par = items.map((_, i) => i), f = i => par[i] === i ? i : (par[i] = f(par[i]));
    for (let i = 0; i < ps.length; i++) for (let j = 0; j < items.length; j++) if (i !== j && near(items[i].bb, items[j].bb)) par[f(i)] = f(j);
    const groups = new Map(); items.forEach((it, i) => { const r = f(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
    const touched = [];
    for (const g of groups.values()) {
      const ss = g.filter(x => x.s).map(x => x.s), es = g.filter(x => x.e).map(x => x.e); if (!ss.length) continue;
      let e = es[0];
      if (!e) { e = { id: uidc('e'), sids: [], bb: null, raw: '', text: '', status: 'reading', name: '', color: '' }; CB.board.exprs.push(e); }
      for (const o of es.slice(1)) {        // ink bridged two areas → merge, keep the first one's name and links
        e.sids.push(...o.sids); if (!e.name && o.name) { e.name = o.name; e.color = o.color; }
        for (const b of CB.board.blocks) for (const k in b.inputs) b.inputs[k] = [...new Set(b.inputs[k].map(id => id === o.id ? e.id : id))];
        CB.board.exprs = CB.board.exprs.filter(x => x !== o); CB.sel = CB.sel.map(id => id === o.id ? e.id : id);
      }
      e.sids.push(...ss.map(s => s.id)); exprBB(e); e.fixed = false; touched.push(e);
    }
    for (const e of touched) { if (noRecognize) { e.status = 'reading'; } else recognize(e); }
    renderOverlay(); save(); return touched;
  }
  const isBarStroke = s => { const b = sbb(s), w = b[2] - b[0], h = b[3] - b[1]; return w > 8 && w < 120 && h < Math.max(6, 0.3 * w); };
  function looksLikeEquals(s) {   // the last two strokes are short stacked bars → "=" was just written
    const i = CB.board.strokes.indexOf(s), p = CB.board.strokes[i - 1]; if (!p || !CB.pending.has(p.id) || !isBarStroke(s) || !isBarStroke(p)) return false;
    const a = sbb(s), b = sbb(p), hOv = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), vGap = Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2);
    return hOv > 0.5 * Math.min(a[2] - a[0], b[2] - b[0]) && vGap > 3 && vGap < 26;
  }

  /* ---------- DOM ---------- */
  const isOpen = () => { const QB = G('QB'); return !!(QB && QB.open && QB.mode === 'calc'); };
  const HINT = { pen: 'Write math · pause or write = for the answer · tap an answer to fix it · finger pans', erase: 'Rub out ink — answers update', lasso: 'Circle numbers to link them (A, B…) · lasso more areas to add · then Σ, x̄ or ƒ' };
  function mount() {
    if (CB.el) return CB.el;
    const host = document.createElement('div'); host.id = 'cbHost'; host.className = 'dr-host cb-host'; host.hidden = true;
    host.innerHTML = `<div class="cb-bar" role="toolbar" aria-label="Calculator Board tools">
        <button class="cb-tool on" data-tool="pen" aria-label="Write" aria-pressed="true"><i>✏️</i><span>Write</span></button>
        <button class="cb-tool" data-tool="erase" aria-label="Eraser" aria-pressed="false"><i>⌫</i><span>Erase</span></button>
        <button class="cb-tool" data-tool="lasso" aria-label="Lasso" aria-pressed="false"><i>◌</i><span>Lasso</span></button>
        <span class="cb-sep"></span>
        <button class="cb-fnbtn" data-cb="fns" aria-haspopup="menu" aria-label="Functions"><i>ƒ</i><span>Functions</span><em>▾</em></button>
        <span class="cb-hint"></span>
        <button class="cb-tool icon" data-cb="fit" aria-label="Fit everything on screen" title="Fit everything">⤢</button>
      </div>
      <div class="cb-stage">
        <canvas class="cb-cv"></canvas>
        <div class="cb-layer"><svg class="cb-links" width="1" height="1" aria-hidden="true"></svg><div class="cb-items"></div></div>
        <svg class="cb-lasso" aria-hidden="true"><path/></svg>
        <div class="cb-empty"><b>🧮 Calculator Board</b><span>Write any math with your Pencil — <i>12×(3+4)²</i>, <i>¾ + √16</i>, <i>15% of 80</i>. Pause or write “=” and the answer appears.<br>◌ Lasso numbers to link them, then pick Sum, Average, Margin, Markup… from ƒ Functions.</span></div>
        <div class="cb-selbar" hidden></div>
        <div class="cb-menu" role="menu" hidden></div>
      </div>
      <div class="cb-sheet-wrap" hidden><div class="cb-sheet" role="dialog" aria-modal="true"></div></div>`;
    const ref = document.getElementById('inHost') || document.getElementById('ibHost') || document.getElementById('qbHost');
    if (ref) ref.parentNode.insertBefore(host, ref.nextSibling); else document.body.append(host);
    const el = CB.el = { host, stage: host.querySelector('.cb-stage'), cv: host.querySelector('.cb-cv'), layer: host.querySelector('.cb-layer'), links: host.querySelector('.cb-links'), items: host.querySelector('.cb-items'),
      lasso: host.querySelector('.cb-lasso path'), selbar: host.querySelector('.cb-selbar'), menu: host.querySelector('.cb-menu'), sheetWrap: host.querySelector('.cb-sheet-wrap'), sheet: host.querySelector('.cb-sheet'), hint: host.querySelector('.cb-hint'), empty: host.querySelector('.cb-empty') };
    el.ctx = el.cv.getContext('2d');
    host.querySelector('.cb-bar').addEventListener('click', e => {
      const t = e.target.closest('button[data-tool]'); if (t) return setTool(t.dataset.tool);
      const c = e.target.closest('[data-cb]'); if (!c) return;
      if (c.dataset.cb === 'fns') return fnMenu(c);
      if (c.dataset.cb === 'fit') return fit();
    });
    el.selbar.addEventListener('click', selAction);
    el.menu.addEventListener('click', menuClick);
    el.sheetWrap.addEventListener('pointerdown', e => { if (e.target === el.sheetWrap) closeSheet(); });
    el.stage.addEventListener('pointerdown', down);
    el.stage.addEventListener('pointermove', move);
    el.stage.addEventListener('pointerup', up);
    el.stage.addEventListener('pointercancel', e => up(e, true));
    el.stage.addEventListener('wheel', wheel, { passive: false });
    el.stage.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    el.stage.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerdown', e => { if (!el.menu.hidden && !el.menu.contains(e.target) && !e.target.closest('[data-cb="fns"], [data-sa="fns"]')) closeMenu(); }, true);
    if (window.ResizeObserver) new ResizeObserver(() => { if (!host.hidden) draw(); }).observe(el.stage);
    setTool(CB.tool);
    return el;
  }
  function setTool(t) {
    CB.tool = t; if (!CB.el) return;
    CB.el.host.querySelectorAll('button[data-tool]').forEach(b => { b.classList.toggle('on', b.dataset.tool === t); b.setAttribute('aria-pressed', b.dataset.tool === t); });
    CB.el.host.dataset.cbtool = t; CB.el.hint.textContent = HINT[t];
    if (t !== 'lasso' && CB.sel.length) { CB.sel = []; renderOverlay(); }
  }

  /* ---------- view ---------- */
  const V = () => CB.board.view;
  function toWorld(e) { const r = CB.el.stage.getBoundingClientRect(), v = V(); return [(e.clientX - r.left - v.x) / v.z, (e.clientY - r.top - v.y) / v.z]; }
  function applyView() { const v = V(); CB.el.layer.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`; draw(); positionSelbar(); }
  function fit(ids) {
    const pick = Array.isArray(ids) ? ids.map(node).filter(Boolean) : [...CB.board.exprs, ...CB.board.blocks];
    const bbs = pick.map(nodeBB);
    const W = CB.el.stage.clientWidth, H = CB.el.stage.clientHeight;
    if (!bbs.length) { Object.assign(V(), { x: 40, y: 30, z: 1 }); return applyView(); }
    const u = union(bbs), z = Math.max(0.3, Math.min(1.6, Math.min((W - 60) / (u[2] - u[0] || 1), (H - 120) / (u[3] - u[1] || 1))));
    Object.assign(V(), { z, x: (W - (u[2] - u[0]) * z) / 2 - u[0] * z, y: 70 + (H - 120 - (u[3] - u[1]) * z) / 2 - u[1] * z }); applyView(); save();
  }
  let rafQ = 0;
  const drawSoon = () => { if (!rafQ) rafQ = requestAnimationFrame(() => { rafQ = 0; draw(); }); };
  function draw() {
    const el = CB.el; if (!el || el.host.hidden) return;
    const W = el.stage.clientWidth, H = el.stage.clientHeight, dpr = window.devicePixelRatio || 1;
    if (el.cv.width !== Math.round(W * dpr) || el.cv.height !== Math.round(H * dpr)) { el.cv.width = Math.round(W * dpr); el.cv.height = Math.round(H * dpr); el.cv.style.width = W + 'px'; el.cv.style.height = H + 'px'; }
    const ctx = el.ctx, v = V(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const dark = G('isDark') ? G('isDark')() : true, step = 40 * v.z;
    if (step >= 10) { ctx.fillStyle = dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.12)'; for (let gx = ((v.x % step) + step) % step; gx < W; gx += step) for (let gy = ((v.y % step) + step) % step; gy < H; gy += step) ctx.fillRect(gx - 1, gy - 1, 2, 2); }
    ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
    const selS = new Set(); for (const id of CB.sel) { const n = node(id); if (n && n.sids) n.sids.forEach(s => selS.add(s)); }
    const drawStroke = G('drawStroke');
    for (const s of CB.board.strokes) {
      if (selS.has(s.id)) { ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = '#8b85ff'; ctx.lineWidth = (s.width || 3) + 7; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath(); s.points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.restore(); }
      if (drawStroke) { try { drawStroke(ctx, s); continue; } catch (_) {} }
      ctx.save(); ctx.strokeStyle = s.color === 'ink' ? (dark ? '#ececf0' : '#1d1d1f') : s.color; ctx.lineWidth = s.width || 3; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath(); s.points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (s.points.length === 1) ctx.lineTo(s.points[0][0] + .1, s.points[0][1]); ctx.stroke(); ctx.restore();
    }
    if (CB.g && CB.g.type === 'erase' && CB.g.at) { ctx.beginPath(); ctx.arc(CB.g.at[0], CB.g.at[1], CB.g.r, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(229,72,77,.6)'; ctx.lineWidth = 1.5 / v.z; ctx.stroke(); }
  }

  /* ---------- overlay: answers, names, linked blocks, connectors ---------- */
  const SUPS = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  const pretty = s => { let t = String(s || ''); for (let k = 0; k < 3; k++) t = t.replace(/\((-?[\d.]+|[A-Za-z]+)\)/g, (m, x, i, str) => /[A-Za-z]$/.test(str.slice(0, i)) && !/^(-?[\d.]+)$/.test(x) ? m : x);
    t = t.replace(/\^(-?\d+)(?![\d.])/g, (m, d) => [...d].map(c => SUPS[c]).join(''));
    return t.replace(/\*/g, '×').replace(/\//g, '÷').replace(/sqrt/g, '√').replace(/\bpi\b/g, 'π').replace(/-/g, '−'); };
  function resHTML(e) {
    const r = val(e.id);
    if (e.status === 'reading') return { cls: 'reading', main: '…', sub: 'reading' };
    if (!e.text) return { cls: 'empty', main: '? tap to type', sub: '' };
    const sub = pretty(evalText(e.text).normalized || e.text);
    if (!r.ok) return { cls: 'err', main: '⚠︎ ' + r.error, sub };
    if (r.kind === 'check') return { cls: r.correct ? 'ok check' : 'err check', main: r.correct ? '✓ ' + r.display : '✗ = ' + r.display, sub };
    if (r.kind === 'list') return { cls: 'ok list', main: `${r.value.length} values · Σ ${CalcMath.format(r.value.reduce((s, x) => s + x, 0))}`, sub };
    return { cls: 'ok', main: '= ' + r.display, sub };
  }
  function renderOverlay() {
    const el = CB.el; if (!el) return;
    const usedBy = new Map(); for (const b of CB.board.blocks) for (const k in b.inputs) for (const id of b.inputs[k]) { if (!usedBy.has(id)) usedBy.set(id, []); usedBy.get(id).push(b.color); }
    let h = '';
    for (const e of CB.board.exprs) {
      if (!e.bb) exprBB(e); const [x0, y0, x1, y1] = e.bb, cy = (y0 + y1) / 2, r = resHTML(e);
      if (e.name) h += `<b class="cb-name" data-nid="${e.id}" style="left:${x0 - 14}px;top:${y0 - 18}px;--c:${e.color}">${escH(e.name)}${(usedBy.get(e.id) || []).map(c => `<i class="cb-dot" style="--c:${c}"></i>`).join('')}</b>`;
      if (e.typed) h += `<div class="cb-typed" data-eid="${e.id}" style="left:${x0}px;top:${y0}px;height:${y1 - y0}px" title="Typed by 🛰 Satellite — tap to edit">${escH(pretty(evalText(e.text).normalized || e.text))}</div>`;
      h += `<button class="cb-res ${r.cls}" data-eid="${e.id}" style="left:${x1 + 14}px;top:${cy - 21}px" aria-label="Result ${escH(r.main)} — tap to fix the formula"><small>${escH(r.sub)}</small><span>${escH(r.main)}</span></button>`;
    }
    for (const b of CB.board.blocks) {
      const f = CalcFns.get(b.fn) || { label: b.fn, inputs: [] }, r = val(b.id);
      const ins = f.inputs.map(i => `${i.label.replace(/ %$/, '%')} = ${(b.inputs[i.k] || []).map(id => (node(id) || {}).name || '?').join(', ') || '—'}`).join(' · ');
      h += `<div class="cb-block ${r.ok ? '' : 'err'}" data-bid="${b.id}" style="left:${b.x}px;top:${b.y}px;--c:${b.color}" role="button" aria-label="${escH(f.label)} result">
        <div class="cb-bh"><b class="cb-bname">${escH(b.name)}</b><span>${escH(b.label || f.label)}</span></div>
        <div class="cb-bv">${escH(r.ok ? r.display : '⚠︎ ' + (r.error || ''))}</div>
        ${r.ok && r.extra ? `<div class="cb-bx">${escH(r.extra)}</div>` : ''}
        <div class="cb-bf">${escH(f.formula || '')}</div><div class="cb-bi">${escH(ins)}</div></div>`;
    }
    for (const [i, id] of CB.sel.entries()) { const n = node(id); if (!n) continue; const bb = nodeBB(n); h += `<div class="cb-selbox" style="left:${bb[0] - 10}px;top:${bb[1] - 10}px;width:${bb[2] - bb[0] + 20}px;height:${bb[3] - bb[1] + 20}px;--c:${n.color || '#8b85ff'}"><i>${i + 1}${n.name ? ' · ' + escH(n.name) : ''}</i></div>`; }
    el.items.innerHTML = h;
    el.empty.hidden = !!(CB.board.strokes.length || CB.board.blocks.length);
    renderLinks(); renderSelbar(); draw();
    const st = isOpen() && document.getElementById('qbSync'); if (st && QBsub) st.textContent = QBsub();
  }
  let QBsub = null;
  function boxOf(id) {   // a source's visible box: its answer chip (expressions) or the block
    const n = node(id); if (!n) return null;
    const c = n.sids ? CB.el.items.querySelector(`.cb-res[data-eid="${id}"]`) : CB.el.items.querySelector(`[data-bid="${id}"]`);
    if (c) { const x = n.sids ? c.offsetLeft : n.x, y = n.sids ? c.offsetTop : n.y; return [x, y, x + c.offsetWidth, y + c.offsetHeight]; }
    return n.sids ? n.bb : [n.x, n.y, n.x + 170, n.y + 90];
  }
  function curve(a, b, color, label, dashed, vertical) {
    let d;
    if (vertical === 'down-right') { const dy = Math.max(36, (b[1] - a[1]) * 0.7), dx = Math.max(50, (b[0] - a[0]) / 2); d = `M${a[0]},${a[1]} C${a[0]},${a[1] + dy} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`; }
    else if (vertical) { const dy = Math.max(30, Math.abs(b[1] - a[1]) / 2); d = `M${a[0]},${a[1]} C${a[0]},${a[1] + dy} ${b[0]},${b[1] - dy} ${b[0]},${b[1]}`; }
    else { const dx = Math.max(40, Math.abs(b[0] - a[0]) / 2); d = `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`; }
    return `<path d="${d}" stroke="${color}" ${dashed ? 'stroke-dasharray="6 6"' : ''}/><circle cx="${a[0]}" cy="${a[1]}" r="4.5" fill="${color}"/><circle cx="${b[0]}" cy="${b[1]}" r="4.5" fill="${color}"/>` +
      (label ? `<text x="${(a[0] + b[0]) / 2}" y="${(a[1] + b[1]) / 2 - 7}" fill="${color}">${escH(label)}</text>` : '');
  }
  // connect source box → target box: sideways when the target is to the right, otherwise from the source's bottom into the target's top
  function link(sb, tb, k, n, color, label, dashed, srcId) {
    if (tb[0] > sb[2] + 24) {
      const sy = (sb[1] + sb[3]) / 2, ty = tb[1] + (tb[3] - tb[1]) * (k + 1) / (n + 1);
      const blocked = CB.board.exprs.some(e => { if (e.id === srcId) return false; const b = nodeBB(e); return b[0] > sb[2] - 4 && b[2] < tb[0] && b[1] - 6 < Math.max(sy, Math.min(sy, ty) + 1) && b[3] + 6 > sy; });   // another formula sits in the way → leave from underneath
      if (blocked) return curve([(sb[0] + sb[2]) / 2, sb[3]], [tb[0], ty], color, label, dashed, 'down-right');
      return curve([sb[2], (sb[1] + sb[3]) / 2], [tb[0], tb[1] + (tb[3] - tb[1]) * (k + 1) / (n + 1)], color, label, dashed, false);
    }
    if (tb[1] > sb[3] + 16) return curve([(sb[0] + sb[2]) / 2, sb[3]], [tb[0] + (tb[2] - tb[0]) * (k + 1) / (n + 1), tb[1]], color, label, dashed, true);
    if (tb[3] < sb[1] - 16) return curve([(sb[0] + sb[2]) / 2, sb[1]], [tb[0] + (tb[2] - tb[0]) * (k + 1) / (n + 1), tb[3]], color, label, dashed, true);
    return curve([sb[0], (sb[1] + sb[3]) / 2], [tb[2], tb[1] + (tb[3] - tb[1]) * (k + 1) / (n + 1)], color, label, dashed, false);
  }
  function renderLinks() {
    let s = '';
    for (const b of CB.board.blocks) {
      const f = CalcFns.get(b.fn); if (!f) continue; const tb = boxOf(b.id);
      const links = f.inputs.flatMap(i => (b.inputs[i.k] || []).map(id => [id, f.inputs.length > 1 ? i.label.replace(/ %$/, '%').toLowerCase() : '']));
      links.forEach(([id, lab], k) => { const sb = boxOf(id); if (sb) s += link(sb, tb, k, links.length, b.color, lab, false, id); });
    }
    for (const e of CB.board.exprs) {
      const r = val(e.id), refs = (r.refs || []).map(nm => named().find(n => n.name === nm)).filter(n => n && n !== e);
      const tb = [e.bb[0] - 6, e.bb[1] - 4, e.bb[2], e.bb[3] + 4];
      refs.forEach((src, k) => { const sb = boxOf(src.id); if (sb) s += link(sb, tb, k, refs.length, src.color || '#8b85ff', '', true, src.id); });
    }
    CB.el.links.innerHTML = s;
  }

  /* ---------- selection bar + Functions menu ---------- */
  function renderSelbar() {
    const sb = CB.el.selbar, ns = CB.sel.map(node).filter(Boolean);
    if (!ns.length) { sb.hidden = true; return; }
    sb.innerHTML = `<b>${ns.length} area${ns.length > 1 ? 's' : ''}</b><span class="cb-chips">${ns.map(n => `<em style="--c:${n.color}">${escH(n.name)}</em>`).join('')}</span>
      <button data-sa="sum">Σ Sum</button><button data-sa="average">x̄ Average</button><button data-sa="fns" aria-haspopup="menu">ƒ Functions ▾</button><button data-sa="name">🏷 Name</button><button data-sa="clear" aria-label="Clear selection">✕</button>`;
    sb.hidden = false; positionSelbar();
  }
  function positionSelbar() {   // float just under the selection (or above it when there is no room), never over the lassoed ink
    const sb = CB.el && CB.el.selbar; if (!sb || sb.hidden) return;
    const ns = CB.sel.map(node).filter(Boolean); if (!ns.length) return;
    const u = union(ns.map(nodeBB)), v = V(), W = CB.el.stage.clientWidth, H = CB.el.stage.clientHeight, h = sb.offsetHeight || 52, w = sb.offsetWidth || 480;
    const top = u[1] * v.z + v.y - 14, bot = u[3] * v.z + v.y + 16;
    let y = bot + h + 8 <= H ? bot : top - h - 6 >= 0 ? top - h - 6 : 10;
    const x = Math.max(8, Math.min(W - w - 8, ((u[0] + u[2]) / 2) * v.z + v.x - w / 2));
    sb.style.left = x + 'px'; sb.style.top = y + 'px';
  }
  function selAction(e) {
    const b = e.target.closest('[data-sa]'); if (!b) return;
    const a = b.dataset.sa;
    if (a === 'clear') { CB.sel = []; closeMenu(); renderOverlay(); return; }
    if (a === 'fns') return fnMenu(b);
    if (a === 'name') return nameSel();
    if (a === 'sum' || a === 'average') return createBlock(a, { values: CB.sel.slice() });
  }
  const FN_IC = { margin: '📈', markup: '🏷', priceMarkup: '💲', priceMargin: '💲', pctChange: '↕︎', pctOf: '％', tax: '🧾', discount: '✂︎', sum: 'Σ', average: 'x̄', median: '◫', mode: '⌗', min: '↓', max: '↑', range: '↔︎', stdevS: 's', stdevP: 'σ', varS: 's²', varP: 'σ²', count: '#', wavg: '⚖︎' };
  function fnMenu(anchor) {
    const m = CB.el.menu; if (!m.hidden && CB.menu === 'fns') return closeMenu();
    const groups = {}; for (const f of CalcFns.list) (groups[f.group] = groups[f.group] || []).push(f);
    m.innerHTML = `<div class="cb-mh">ƒ Functions${CB.sel.length ? ` · ${CB.sel.length} selected` : ' · pick inputs next'}</div>` + Object.entries(groups).map(([g, fs]) => `<div class="cb-mg">${g}</div>` +
      fs.map(f => `<button role="menuitem" data-fn="${f.id}"><i>${FN_IC[f.id] || 'ƒ'}</i><span>${escH(f.label)}</span><small>${escH(f.formula || '')}</small></button>`).join('')).join('');
    const sr = CB.el.stage.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    const below = sr.bottom - ar.bottom, above = ar.top - sr.top, up = below < 320 && above > below;
    m.style.left = Math.max(8, Math.min(sr.width - 300, ar.left - sr.left)) + 'px';
    m.style.top = up ? '' : Math.max(4, ar.bottom - sr.top + 6) + 'px'; m.style.bottom = up ? (sr.bottom - ar.top + 6) + 'px' : '';
    m.style.maxHeight = Math.max(200, (up ? above : below) - 20) + 'px';
    m.hidden = false; CB.menu = 'fns';
  }
  function closeMenu() { if (CB.el) { CB.el.menu.hidden = true; CB.menu = null; } }
  function menuClick(e) {
    const f = e.target.closest('[data-fn]'); if (f) { closeMenu(); return assignSheet(f.dataset.fn); }
    const b = e.target.closest('[data-ba]'); if (!b) return; const id = CB.menu && CB.menu.bid; closeMenu(); const bl = node(id); if (!bl) return;
    if (b.dataset.ba === 'inputs') return assignSheet(bl.fn, bl);
    if (b.dataset.ba === 'rename') return renameSheet(bl);
    if (b.dataset.ba === 'del') { hist(); CB.board.blocks = CB.board.blocks.filter(x => x !== bl); CB.sel = CB.sel.filter(x => x !== id); recalc(); renderOverlay(); save(); toastc('Result deleted — ↶ Undo brings it back', 2200); }
  }
  function blockMenu(b, clientX, clientY) {
    const m = CB.el.menu, sr = CB.el.stage.getBoundingClientRect(), f = CalcFns.get(b.fn);
    m.innerHTML = `<div class="cb-mh">${escH(b.name)} · ${escH(f ? f.label : '')}</div><button data-ba="inputs"><i>✎</i><span>Change inputs…</span></button><button data-ba="rename"><i>🏷</i><span>Rename…</span></button><button data-ba="del" class="danger"><i>🗑</i><span>Delete result</span></button>`;
    m.style.left = Math.max(8, Math.min(sr.width - 300, clientX - sr.left)) + 'px'; m.style.top = Math.min(sr.height - 190, clientY - sr.top + 10) + 'px'; m.style.bottom = ''; m.style.maxHeight = '';
    m.hidden = false; CB.menu = { bid: b.id };
  }

  /* ---------- sheets: assign inputs · fix a formula · rename ---------- */
  function openSheet(html) { CB.el.sheet.innerHTML = html; CB.el.sheetWrap.hidden = false; }
  function closeSheet() { if (CB.el) { CB.el.sheetWrap.hidden = true; CB.el.sheet.innerHTML = ''; } }
  const candLabel = n => { const r = val(n.id); return `${n.name || '?'} · ${r.ok ? CalcMath.format(r.value) : '⚠︎'}`; };
  function candidates(edit) {
    if (CB.sel.length) return CB.sel.map(node).filter(Boolean);
    const all = [...CB.board.exprs, ...CB.board.blocks].filter(n => n !== edit && (val(n.id).ok || (edit && Object.values(edit.inputs).flat().includes(n.id))));
    return all.sort(readingOrder);
  }
  function defaults(f, cands) {
    const ids = cands.map(n => n.id), out = {};
    const multi = f.inputs.filter(i => i.multi), single = f.inputs.filter(i => !i.multi);
    if (multi.length === 1 && !single.length) out[multi[0].k] = ids.slice();
    else if (multi.length === 2) { const h = Math.ceil(ids.length / 2); out[multi[0].k] = ids.slice(0, h); out[multi[1].k] = ids.slice(h); }
    else single.forEach((i, k) => out[i.k] = ids[k] ? [ids[k]] : []);
    return out;
  }
  function assignSheet(fnId, edit) {
    const f = CalcFns.get(fnId); if (!f) return;
    let cands = candidates(edit);
    if (edit) { const extra = Object.values(edit.inputs).flat().map(node).filter(n => n && !cands.includes(n)); cands = [...cands, ...extra]; }
    if (!cands.length) return toastc('◌ Lasso the numbers to use first, or write a few formulas', 2600);
    const cur = edit ? JSON.parse(JSON.stringify(edit.inputs)) : defaults(f, cands);
    const rows = f.inputs.map(i => i.multi
      ? `<div class="cb-in"><label>${escH(i.label)}</label><div class="cb-checks" data-k="${i.k}">${cands.map(n => `<label class="cb-ck" style="--c:${n.color || '#8b85ff'}"><input type="checkbox" value="${n.id}" ${(cur[i.k] || []).includes(n.id) ? 'checked' : ''}><span>${escH(candLabel(n))}</span></label>`).join('')}</div></div>`
      : `<div class="cb-in"><label for="cbi-${i.k}">${escH(i.label)}</label><select id="cbi-${i.k}" data-k="${i.k}"><option value="">— pick —</option>${cands.map(n => `<option value="${n.id}" ${(cur[i.k] || [])[0] === n.id ? 'selected' : ''}>${escH(candLabel(n))}</option>`).join('')}</select></div>`).join('');
    openSheet(`<h3><i>${FN_IC[f.id] || 'ƒ'}</i> ${escH(f.label)}</h3><p class="cb-formula">${escH(f.short)} = ${escH(f.formula || '')}</p>${rows}
      <div class="cb-preview" aria-live="polite"></div>
      <div class="cb-acts"><button class="btn" data-sh="cancel">Cancel</button><button class="btn primary" data-sh="ok">${edit ? 'Update result' : 'Add result'}</button></div>`);
    const sh = CB.el.sheet;
    const read = () => { const o = {}; for (const i of f.inputs) { if (i.multi) o[i.k] = [...sh.querySelectorAll(`[data-k="${i.k}"] input:checked`)].map(x => x.value); else { const v = sh.querySelector(`select[data-k="${i.k}"]`).value; o[i.k] = v ? [v] : []; } } return o; };
    const preview = () => { const tmp = { id: '__tmp', fn: f.id, inputs: read(), x: 0, y: 0 }; CB.board.blocks.push(tmp); recalc(); const r = val('__tmp'); CB.board.blocks.pop(); recalc(); sh.querySelector('.cb-preview').innerHTML = r.ok ? `<b>${escH(f.short)}: ${escH(r.display)}</b>${r.extra ? ` <small>${escH(r.extra)}</small>` : ''}` : `<span class="err">⚠︎ ${escH(r.error)}</span>`; };
    sh.onchange = preview; preview();
    sh.onclick = e => {
      const b = e.target.closest('[data-sh]'); if (!b) return;
      if (b.dataset.sh === 'cancel') return closeSheet();
      const inputs = read(); closeSheet();
      if (edit) { hist(); edit.inputs = inputs; recalc(); renderOverlay(); save(); return; }
      createBlock(f.id, inputs);
    };
  }
  function createBlock(fnId, inputs, opts = {}) {
    const f = CalcFns.get(fnId); if (!f) return null;
    const srcIds = [...new Set(Object.values(inputs).flat())]; if (!srcIds.length) { toastc('Pick at least one input'); return null; }
    hist();
    for (const id of srcIds) { const n = node(id); if (n) ensureName(n); }
    const bbs = srcIds.map(node).filter(Boolean).map(nodeBB), u = union(bbs);
    const v = V(), visR = CB.el ? (CB.el.stage.clientWidth - v.x) / v.z - 16 : Infinity;
    const b = { id: uidc('b'), fn: fnId, inputs, name: nextName(), color: nextColor(), label: f.label, x: u[2] + 90, y: (u[1] + u[3]) / 2 - 50 };
    if (b.x + 180 > visR) { b.x = Math.max(u[0], Math.min(u[2] - 200, visR - 210)); b.y = u[3] + 70; }   // no room on the right → below the sources
    if (opts.x != null) b.x = opts.x; if (opts.y != null) b.y = opts.y;
    const hit = () => CB.board.blocks.some(o => { const ob = nodeBB(o); return b.x < ob[2] + 16 && b.x + 200 > ob[0] - 16 && b.y < ob[3] + 16 && b.y + 120 > ob[1] - 16; }) ||
      CB.board.exprs.some(e => { const eb = nodeBB(e); return b.x < eb[2] + 10 && b.x + 200 > eb[0] - 10 && b.y < eb[3] + 10 && b.y + 120 > eb[1] - 10; });
    for (let k = 0; k < 30 && hit(); k++) b.y += 40;
    CB.board.blocks.push(b); CB.sel = []; closeMenu(); recalc(); renderOverlay(); save();
    const r = val(b.id); toastc(`${b.name} · ${f.label}: ${r.ok ? r.display : '⚠︎ ' + r.error}`, 2200);
    return b;
  }
  function nameSel() {
    const ns = CB.sel.map(node).filter(Boolean); if (!ns.length) return;
    if (ns.length === 1) return renameSheet(ns[0]);
    hist(); let k = 0; for (const n of ns) if (ensureName(n)) k++; renderOverlay(); save();
    toastc(`Named ${ns.map(n => n.name).join(', ')} — use them in formulas, e.g. ${ns[0].name}×${ns[1].name}`, 3000);
  }
  function renameSheet(n) {
    openSheet(`<h3>🏷 Name</h3><p class="cb-formula">Use the name in any formula on this board, e.g. “${escH(n.name || 'A')} × 2”.</p>
      <div class="cb-in"><label for="cbName">Name</label><input id="cbName" maxlength="12" autocomplete="off" autocapitalize="characters" value="${escH(n.name || nextName())}"></div><div class="cb-preview"></div>
      <div class="cb-acts"><button class="btn" data-sh="cancel">Cancel</button><button class="btn primary" data-sh="ok">Save</button></div>`);
    const sh = CB.el.sheet, inp = sh.querySelector('#cbName'); setTimeout(() => inp.select(), 30);
    sh.onchange = null;
    sh.onclick = e => {
      const b = e.target.closest('[data-sh]'); if (!b) return; if (b.dataset.sh === 'cancel') return closeSheet();
      const v = inp.value.trim();
      if (!/^[A-Za-z][A-Za-z_]{0,11}$/.test(v) || /^(pi|e|x)$/i.test(v) || EXTRA_FUNCS[v.toLowerCase()]) { sh.querySelector('.cb-preview').innerHTML = '<span class="err">Use letters only (not a function name, π, e or x)</span>'; return; }
      if (named().some(o => o !== n && o.name === v)) { sh.querySelector('.cb-preview').innerHTML = `<span class="err">${escH(v)} is already used</span>`; return; }
      hist(); const old = n.name; n.name = v; if (!n.color) n.color = nextColor();
      if (old && old !== v) for (const e2 of CB.board.exprs) if (e2.text && new RegExp(`\\b${old}\\b`).test(e2.text) && e2 !== n) e2.text = e2.text.replace(new RegExp(`\\b${old}\\b`, 'g'), v);   // formulas follow the rename
      closeSheet(); recalc(); renderOverlay(); save();
    };
  }
  function fixSheet(e) {
    const KEYS = ['√', '^', '(', ')', '×', '÷', '%', 'π', '−', ','];
    openSheet(`<h3>✎ Fix the formula</h3><p class="cb-formula">${e.raw ? `Recognized: <code>${escH(e.raw)}</code>` : 'Nothing was recognized — type what you wrote.'}</p>
      <div class="cb-in"><label for="cbFix">Formula</label><input id="cbFix" autocomplete="off" autocorrect="off" spellcheck="false" value="${escH(e.text)}"></div>
      <div class="cb-keys">${KEYS.map(k => `<button data-key="${k}">${k}</button>`).join('')}</div>
      <div class="cb-preview" aria-live="polite"></div>
      <div class="cb-acts"><button class="btn danger" data-sh="del">🗑 Delete</button><button class="btn" data-sh="again">↻ Read again</button><span class="spacer"></span><button class="btn" data-sh="cancel">Cancel</button><button class="btn primary" data-sh="ok">Save</button></div>`);
    const sh = CB.el.sheet, inp = sh.querySelector('#cbFix');
    const preview = () => { const r = evalText(inp.value, { resolve: nm => { if (nm === e.name) return undefined; const n = named().find(o => o.name === nm); if (!n) return undefined; const v = val(n.id); return v.ok ? v.value : undefined; } }); sh.querySelector('.cb-preview').innerHTML = r.ok ? `<b>${escH(pretty(r.normalized))} = ${escH(r.display)}</b>` : `<span class="err">⚠︎ ${escH(r.error)}</span>`; };
    inp.oninput = preview; preview();
    sh.onchange = null;
    sh.onclick = ev => {
      const k = ev.target.closest('[data-key]'); if (k) { const map = { '×': '*', '÷': '/', '−': '-', '√': 'sqrt(' }; const s = map[k.dataset.key] || k.dataset.key, p = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, p) + s + inp.value.slice(inp.selectionEnd ?? p); inp.focus(); inp.setSelectionRange(p + s.length, p + s.length); preview(); return; }
      const b = ev.target.closest('[data-sh]'); if (!b) return; const a = b.dataset.sh;
      if (a === 'cancel') return closeSheet();
      if (a === 'again') { closeSheet(); return recognize(e); }
      if (a === 'del') { closeSheet(); return deleteExpr(e); }
      hist(); e.text = inp.value.trim(); e.fixed = true; e.status = e.text ? 'ok' : 'empty'; adoptAssignName(e); closeSheet(); recalc(); renderOverlay(); save();
    };
  }
  function deleteExpr(e) {
    hist(); const ids = new Set(e.sids);
    CB.board.strokes = CB.board.strokes.filter(s => !ids.has(s.id)); CB.board.exprs = CB.board.exprs.filter(x => x !== e); CB.sel = CB.sel.filter(id => id !== e.id);
    recalc(); renderOverlay(); save(); toastc('Formula deleted — ↶ Undo brings it back', 2200);
  }

  /* ---------- pointer input: Pencil / mouse write · finger pans & pinches · items tap/drag ---------- */
  const penLike = e => e.pointerType !== 'touch' || localStorage.getItem('fingerDraw') === '1' && CB.ptrs.size === 0 && !CB.g;
  function down(e) {
    if (e.button > 0) return;
    const el = CB.el; closeMenuIfOutside(e);
    const res = e.target.closest('.cb-res, .cb-typed'), blk = e.target.closest('.cb-block'), nm = e.target.closest('.cb-name');
    if (e.target.closest('.cb-selbar, .cb-menu')) return;
    e.preventDefault();
    if (e.pointerType === 'touch') CB.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (CB.g && CB.g.type === 'draw' && e.pointerType === 'touch') return;             // palm while writing
    try { el.stage.setPointerCapture(e.pointerId); } catch (_) {}
    if (e.pointerType === 'touch' && CB.ptrs.size === 2) { const [a, b] = [...CB.ptrs.values()]; if (CB.g && CB.g.type === 'draw') abortStroke(); CB.g = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]), m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...V() } }; return; }
    if (blk) { CB.g = { type: 'block', pid: e.pointerId, id: blk.dataset.bid, x0: e.clientX, y0: e.clientY, moved: false }; return; }
    if (res || nm) { CB.g = { type: 'tap', pid: e.pointerId, id: (res || nm).dataset.eid || (res || nm).dataset.nid, x0: e.clientX, y0: e.clientY }; return; }
    if (!penLike(e)) { CB.g = { type: 'pan', pid: e.pointerId, x0: e.clientX, y0: e.clientY, v0: { ...V() }, moved: false }; return; }
    const p = toWorld(e), pr = e.pressure > 0 && e.pointerType === 'pen' ? +e.pressure.toFixed(2) : 0.5;
    clearTimeout(CB.timer);
    if (CB.tool === 'pen') { hist(); const s = { id: uidc('s'), tool: 'pen', color: 'ink', width: 3, points: [[+p[0].toFixed(1), +p[1].toFixed(1), pr]] }; CB.board.strokes.push(s); CB.g = { type: 'draw', pid: e.pointerId, s }; el.empty.hidden = true; drawSoon(); return; }
    if (CB.tool === 'erase') { CB.g = { type: 'erase', pid: e.pointerId, r: 12 / V().z, hit: new Set(), histed: false, at: p }; eraseAt(p); return; }
    if (CB.tool === 'lasso') { CB.g = { type: 'lasso', pid: e.pointerId, pts: [p], scr: [[e.clientX, e.clientY]] }; return; }
  }
  function closeMenuIfOutside(e) { if (CB.el && !CB.el.menu.hidden && !CB.el.menu.contains(e.target)) closeMenu(); }
  function move(e) {
    if (e.pointerType === 'touch' && CB.ptrs.has(e.pointerId)) CB.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const g = CB.g; if (!g) return;
    if (g.type === 'pinch') { if (CB.ptrs.size < 2) return; const [a, b] = [...CB.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = CB.el.stage.getBoundingClientRect();
      const z = Math.max(0.3, Math.min(3, g.v0.z * d / (g.d0 || 1))), wx = (g.m0[0] - r.left - g.v0.x) / g.v0.z, wy = (g.m0[1] - r.top - g.v0.y) / g.v0.z;
      Object.assign(V(), { z, x: m[0] - r.left - wx * z, y: m[1] - r.top - wy * z }); return applyView(); }
    if (e.pointerId !== g.pid) return;
    if (g.type === 'pan') { const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (Math.hypot(dx, dy) > 3) g.moved = true; Object.assign(V(), { x: g.v0.x + dx, y: g.v0.y + dy }); return applyView(); }
    if (g.type === 'block') { const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (!g.moved && Math.hypot(dx, dy) < 6) return; const b = node(g.id); if (!b) return; if (!g.moved) { g.moved = true; hist(); g.bx = b.x; g.by = b.y; } b.x = g.bx + dx / V().z; b.y = g.by + dy / V().z; const bel = CB.el.items.querySelector(`[data-bid="${b.id}"]`); if (bel) { bel.style.left = b.x + 'px'; bel.style.top = b.y + 'px'; } renderLinks(); return; }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (g.type === 'draw') { for (const ce of evs.length ? evs : [e]) { const p = toWorld(ce), pr = ce.pressure > 0 && ce.pointerType === 'pen' ? +ce.pressure.toFixed(2) : 0.5, l = g.s.points[g.s.points.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.8) continue; g.s.points.push([+p[0].toFixed(1), +p[1].toFixed(1), pr]); } return drawSoon(); }
    if (g.type === 'erase') { for (const ce of evs.length ? evs : [e]) eraseAt(toWorld(ce)); return; }
    if (g.type === 'lasso') { g.pts.push(toWorld(e)); const r = CB.el.stage.getBoundingClientRect(); g.scr.push([e.clientX - r.left, e.clientY - r.top]); CB.el.lasso.setAttribute('d', 'M' + g.scr.map(p => p.join(',')).join(' L') + ' Z'); }
  }
  function abortStroke() { const g = CB.g; if (g && g.type === 'draw') { CB.board.strokes = CB.board.strokes.filter(s => s !== g.s); CB.undo.pop(); syncUndo(); } CB.g = null; drawSoon(); }
  function up(e, cancel) {
    if (e.pointerType === 'touch') CB.ptrs.delete(e.pointerId);
    const g = CB.g; if (!g) return;
    if (g.type === 'pinch') { if (CB.ptrs.size < 2) { CB.g = null; save(); } return; }
    if (e.pointerId !== g.pid) return;
    CB.g = null;
    if (g.type === 'pan') { if (g.moved) save(); else if (CB.tool === 'lasso' && CB.sel.length) { CB.sel = []; renderOverlay(); } return; }
    if (g.type === 'block') { if (g.moved) { renderOverlay(); save(); } else if (!cancel) blockMenu(node(g.id), e.clientX, e.clientY); return; }
    if (g.type === 'tap') { if (cancel || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 10) return; const ex = node(g.id); if (!ex) return;
      if (CB.tool === 'lasso') { CB.sel = CB.sel.includes(ex.id) ? CB.sel.filter(x => x !== ex.id) : [...CB.sel, ex.id]; if (ensureName(ex)) save(); renderOverlay(); return; }
      return fixSheet(ex); }
    if (g.type === 'draw') {
      if (cancel) return abortStroke();
      sbb(g.s); g.s.bb = bboxOf(g.s.points); CB.pending.add(g.s.id); draw();
      schedule(looksLikeEquals(g.s) ? EQUALS_MS : PAUSE_MS); save(); return;
    }
    if (g.type === 'erase') { draw(); if (g.hit.size) { const touched = CB.board.exprs.filter(x => x.sids.some(id => g.hit.has(id))); for (const x of touched) { x.sids = x.sids.filter(id => !g.hit.has(id)); if (!x.sids.length) CB.board.exprs = CB.board.exprs.filter(y => y !== x); else { exprBB(x); recognize(x); } } for (const id of g.hit) CB.pending.delete(id); CB.sel = CB.sel.filter(node); recalc(); renderOverlay(); save(); } return; }
    if (g.type === 'lasso') { CB.el.lasso.setAttribute('d', ''); if (!cancel) finishLasso(g.pts); }
  }
  function eraseAt(p) {
    const g = CB.g; g.at = p; const r2 = g.r * g.r;
    const keep = [];
    for (const s of CB.board.strokes) {
      const b = sbb(s); if (p[0] < b[0] - g.r || p[0] > b[2] + g.r || p[1] < b[1] - g.r || p[1] > b[3] + g.r) { keep.push(s); continue; }
      if (s.points.some(q => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r2)) { if (!g.histed) { hist(); g.histed = true; } g.hit.add(s.id); } else keep.push(s);
    }
    if (keep.length !== CB.board.strokes.length) CB.board.strokes = keep;
    drawSoon();
  }
  const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  function finishLasso(poly) {
    const lb = bboxOf(poly);
    if (poly.length < 4 || (lb[2] - lb[0] < 12 && lb[3] - lb[1] < 12)) { if (CB.sel.length) { CB.sel = []; renderOverlay(); } return; }
    flushPending();
    const hits = [];
    for (const e of CB.board.exprs) { const pts = e.sids.map(strokeById).filter(Boolean).flatMap(s => s.points); const inside = pts.filter(p => inPoly(p, poly)).length; const c = [(e.bb[0] + e.bb[2]) / 2, (e.bb[1] + e.bb[3]) / 2]; if ((pts.length && inside / pts.length >= 0.5) || inPoly(c, poly)) hits.push(e); }
    for (const b of CB.board.blocks) { const bb = nodeBB(b); if (inPoly([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], poly)) hits.push(b); }
    hits.sort(readingOrder);
    const fresh = hits.filter(n => !CB.sel.includes(n.id)); if (!fresh.length) { toastc(hits.length ? 'Already selected' : 'Nothing with a value inside the lasso', 1600); return; }
    let changed = false; const pre = snap();
    for (const n of fresh) if (!n.name) changed = true;
    if (changed) { CB.undo.push(pre); CB.redo = []; syncUndo(); }
    for (const n of fresh) ensureName(n);
    CB.sel.push(...fresh.map(n => n.id)); recalc(); renderOverlay(); save();
  }
  function wheel(e) {
    e.preventDefault(); const v = V(), r = CB.el.stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) { const z = Math.max(0.3, Math.min(3, v.z * Math.exp(-e.deltaY / 300))), wx = (e.clientX - r.left - v.x) / v.z, wy = (e.clientY - r.top - v.y) / v.z; Object.assign(v, { z, x: e.clientX - r.left - wx * z, y: e.clientY - r.top - wy * z }); }
    else { v.x -= e.deltaX; v.y -= e.deltaY; }
    applyView(); save();
  }

  function render() { const el = mount(); if (el.host.hidden) return; applyView(); recalc(); renderOverlay(); syncUndo(); }

  /* ---------- drawer integration: 🧮 Calculator Board next to 💡 Idea Board in the Boards dropdown ---------- */
  function integrate() {
    const BOARDS = G('BOARDS'), QB = G('QB'); if (!BOARDS || !QB || typeof G('setDrawerBoard') !== 'function') return false;
    const sub = () => { const e = CB.board.exprs.length, b = CB.board.blocks.length; return e || b ? `${e} formula${e === 1 ? '' : 's'} · ${b} linked result${b === 1 ? '' : 's'}` : 'Write math with the Pencil — it calculates'; };
    QBsub = sub;
    const calc = { pi: null, ic: '🧮', name: 'Calculator Board', short: 'Calc', note: () => null, ensure: () => null, sealed: () => false, wkey: 'cbW', wdef: 1, sub, badge: () => 0 };
    const tail = {}; let after = false;
    for (const k of Object.keys(BOARDS)) { if (after) { tail[k] = BOARDS[k]; delete BOARDS[k]; } if (k === 'ideas') after = true; }
    BOARDS.calc = calc; Object.assign(BOARDS, tail);
    mount();
    const $ = id => document.getElementById(id);
    const _sdb = G('setDrawerBoard');
    const wrapSet = function (mode, opts) {
      const r = _sdb.apply(this, arguments);
      const on = QB.mode === 'calc'; CB.el.host.hidden = !on; try { localStorage.setItem('cbOn', on ? '1' : '0'); } catch (_) {}
      $('qbDrawer').dataset.board = QB.mode;
      if (on) { const a = $('qbAdd'); if (a) { a.querySelector('span').textContent = 'Function'; a.setAttribute('aria-label', 'Add a function result'); } closeMenu(); if (QB.open) render(); }
      else { closeMenu(); closeSheet(); }
      return r;
    };
    const _render = G('qbRender'), _sync = G('qbSyncUndo');
    const wrapRender = function () { if (QB.mode !== 'calc') return _render.apply(this, arguments); const lk = $('qbLock'); if (lk) lk.textContent = '🔒'; G('qbBadge') && G('qbBadge')(); const st = $('qbSync'); if (st) { st.classList.remove('err'); st.textContent = sub(); } CB.el.host.hidden = false; render(); };
    const wrapSync = function () { if (QB.mode !== 'calc') return _sync.apply(this, arguments); syncUndo(); };
    setGlobal('setDrawerBoard', wrapSet); setGlobal('qbRender', wrapRender); setGlobal('qbSyncUndo', wrapSync);
    const wrapClick = (id, fn) => { const b = $(id); if (!b) return; const o = b.onclick; b.onclick = function (e) { if (QB.mode === 'calc') return fn(e); return o && o.call(this, e); }; };
    wrapClick('qbUndo', () => { if (undo()) toastc('Undone', 1000); });
    wrapClick('qbRedo', () => { if (redo()) toastc('Redone', 1000); });
    wrapClick('qbAdd', () => { if (CB.el) fnMenu(CB.el.host.querySelector('[data-cb="fns"]')); });
    wrapClick('qbLock', () => toastc('🔒 Pencil Lock for the Calculator Board isn’t in this mock yet', 2600));
    wrapClick('qbMore', () => { const as = G('actionSheet'), wr = G('widthRow'); if (!as) return; as('Calculator Board', [...(wr ? [wr()] : []), { label: '⤢ Fit everything on screen', fn: () => fit() },
      { label: '↻ Read all handwriting again', fn: () => CB.board.exprs.filter(x => !x.fixed).forEach(recognize) },
      { label: '🗑 Clear the board…', sub: 'Undo brings it back', fn: () => { hist(); CB.board.strokes = []; CB.board.exprs = []; CB.board.blocks = []; CB.sel = []; recalc(); render(); save(); } }]); });
    if (localStorage.getItem('cbOn') === '1') G('setDrawerBoard')('calc', { render: QB.open });   // reopen on the board the user left (quotes.js resets drawerBoard at load)
    return true;
  }
  function setGlobal(name, fn) {   // reassign a classic-script global function binding (function declarations live on window)
    window[name] = fn;
  }

  /* a typed formula on the board (no ink) — used by the 🛰 Satellite assistant's “send to Calculator Board” */
  function addTyped(text, opts = {}) {
    const t = String(text || '').trim(); if (!t) return null;
    let x = opts.x, y = opts.y;
    if (x == null || y == null) {
      const bbs = [...CB.board.exprs.map(nodeBB), ...CB.board.blocks.map(nodeBB)];
      if (bbs.length) { const u = union(bbs); x = x == null ? Math.max(30, Math.min(...CB.board.exprs.map(e => e.bb[0]).concat([u[0]]))) : x; y = y == null ? u[3] + 40 : y; }
      else { x = x == null ? 40 : x; y = y == null ? 40 : y; }
    }
    const w = Math.max(40, Math.min(520, pretty(normalize(t)).length * 13 + 16));
    hist();
    const e = { id: uidc('e'), sids: [], bb: [x, y, x + w, y + 34], raw: t, text: t, status: 'ok', name: opts.name || '', color: '', typed: true, fixed: true };
    if (e.name) e.color = nextColor(); else { adoptAssignName(e); if (!e.name) ensureName(e); }   // typed formulas get a name so later ones (and Grok) can refer to them
    CB.board.exprs.push(e); recalc(); if (CB.el && !CB.el.host.hidden) renderOverlay(); save();
    return { id: e.id, name: e.name, ...val(e.id) };
  }

  const CalcBoard = {
    version: 'v21ee-b', state: CB, recalc, render, flush: () => flushPending(), save: () => save(true), load, undo, redo, setTool, fit: () => fit(), fitTo: ids => fit(ids), createBlock, assignSheet,
    addTyped, setRecognizer(fn) { CB.recog = fn; }, _defaultRecognize: defaultRecognize, open() { const qo = G('qbOpen'); if (qo) qo(true, { mode: 'calc' }); },
    worldToClient(x, y) { const r = CB.el.stage.getBoundingClientRect(), v = V(); return [r.left + v.x + x * v.z, r.top + v.y + y * v.z]; },
    async reset() { CB.board = emptyBoard(); CB.undo = []; CB.redo = []; CB.sel = []; CB.pending.clear(); recalc(); await save(true); if (isOpen()) render(); },
    value(name) { const n = named().find(x => x.name === name); return n ? val(n.id) : null; },
  };
  root.CalcBoard = CalcBoard;
  const boot = () => { try { integrate(); } catch (e) { console.warn('Calculator Board integrate failed', e); } load(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
