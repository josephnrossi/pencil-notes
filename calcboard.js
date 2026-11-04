/* Pencil Notes — 🧮 Calculator Board (v21ef, MOCK — builds on v21ee part B).
   A second freeform board in the Boards drawer, next to the 💡 Idea Board: write math with the Apple Pencil, pause (or write "=")
   and the typed result appears beside the ink. Tap a result to correct what was recognized.
   v21ef: sharper reading (CalcRecog: stroke grouping for fractions / exponents / roots / stacked column sums, on-device + Grok
   readers combined with a one-tap picker when they disagree, confusion clean-up, confidence dots, learns from your fixes) ·
   many more calculations (log/trig deg↔rad/nCr/GCD…, solve for x, unit conversions incl. sq ft & linear ft, loans, ROI,
   break-even, percentiles, correlation, regression…) · one-tap ⇄ Compare card · Auto / Manual (= Calculate) mode.
   Sections: 1. CalcMath (normalizer, parser, evaluator, solver, units) · 2. CalcFns (business + stats + compare) · 3. the board UI.
   1–2 also load in Node for tests. Recognition uses the user's saved AI key through the app's aiRequest; no key lives in this file. */
(function (root) {
  'use strict';

  /* ============================== 1. CalcMath ============================== */
  class CalcError extends Error { constructor(msg) { super(msg); this.calc = true; } }
  const fail = m => { throw new CalcError(m); };
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

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
      if (s.startsWith('\\binom', i)) { i += 6; const [a, j] = latexArg(s, i), [b, k] = latexArg(s, j); out += `ncr((${delatex(a)}),(${delatex(b)}))`; i = k; continue; }
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

  /* v21ef — common handwriting-reader confusions, fixed only where a digit sits right next to them:
     l / I / | → 1 · O / o → 0 · S / s → 5 · Z / z / g / q → 2 / 9 (between digits) · t → + (between digits).
     A letter that is a name on the board (e.g. an area called S) is left alone. */
  const CONF = { l: '1', I: '1', '|': '1', O: '0', o: '0', S: '5', s: '5' };
  const CONF_BETWEEN = { Z: '2', z: '2', g: '9', q: '9', t: '+' };
  function fixConfusions(s, isName) {
    return s.replace(/[A-Za-z|]+/g, (run, off, str) => {
      if (run.length > 3 || isName(run)) return run;
      const prev = str[off - 1] || '', next = str[off + run.length] || '', dig = c => /[\d.]/.test(c), op = c => /[-+*/^=]/.test(c);
      if (next === '(') return run;
      if ([...run].every(c => hasOwn(CONF, c)) && (dig(prev) || dig(next) || ((op(prev) || op(next) || (!prev && op(next))) && /\d/.test(str) && !isName(run[0])))) {
        return [...run].map(c => CONF[c]).join('');
      }
      if (run.length === 1 && hasOwn(CONF_BETWEEN, run) && /\d/.test(prev) && /\d/.test(next)) return CONF_BETWEEN[run];
      return run;
    });
  }
  /* "1,5 + 2,25" (comma decimals) → 1.5 + 2.25 when the line has arithmetic; "4, 8, 15" stays a list, "1,234" stays a thousand,
     commas inside a function call stay separators, "1.234,56" → 1234.56 */
  function decimalCommas(s) {
    const inCall = k => { const st = []; for (let i = 0; i < k; i++) { if (s[i] === '(') { const fn = (s.slice(0, i).match(/([A-Za-z_]+)\s*$/) || [])[1]; st.push(fn && FUNCS_ALL()[fn.toLowerCase()] ? 'call' : 'group'); } else if (s[i] === ')') st.pop(); } return st[st.length - 1] === 'call'; };
    s = s.replace(/\b(\d{1,3}(?:\.\d{3})+),(\d+)\b/g, (m, a, b, k) => inCall(k) ? m : a.replace(/\./g, '') + '.' + b);
    if (!/[\d)]\s*[-+*/^]\s*[\d(.A-Za-z]/.test(s)) return s;
    let out = ''; const st = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(') { const fn = (out.match(/([A-Za-z_]+)\s*$/) || [])[1]; st.push(fn && FUNCS_ALL()[fn.toLowerCase()] ? 'call' : 'group'); }
      else if (c === ')') st.pop();
      if (c === ',' && st[st.length - 1] !== 'call' && /\d$/.test(out) && /^\d{1,2}(?![\d,])/.test(s.slice(i + 1)) && !/\d\.\d*$/.test(out)) { out += '.'; continue; }
      out += c;
    }
    return out;
  }
  /* handwriting / LaTeX-ish → one plain calculator string: "\frac{3}{4}\times 2^{3}" → "((3)/(4))*2^(3)".
     opts.isName(n) tells which letters are names on the board (so they are never "fixed" into digits). */
  /* in DEG mode a trig argument written with π is meant in radians: cos(π/3) = 0.5 either way */
  const piTrig = s => s.replace(/\b(sin|cos|tan|sec|csc|cot)\(([^()]*(?<![A-Za-z])pi(?![A-Za-z])[^()]*)\)/g, '$1(piarg($2))');
  function normalize(src, opts) { return piTrig(normalize0(src, opts)); }
  function normalize0(src, opts = {}) {
    const isName = opts.isName || (() => false);
    let s = String(src == null ? '' : src).trim();
    s = s.replace(/^\$+|\$+$/g, '').replace(/^\\\[|\\\]$/g, '').replace(/^\\\(|\\\)$/g, '');
    s = s.replace(/\\left|\\right|\\[,;:! ]|\\displaystyle|\\q?quad/g, '').replace(/\\[lr]?vert\b|\\mid\b/g, '|').replace(/\\%/g, '%').replace(/\\\$/g, '');
    s = s.replace(/\^\s*\{?\s*\\circ\s*\}?|\\degree\b/g, '°');
    s = delatex(s);
    s = s.replace(/\\(?:cdot|times|ast)/g, '*').replace(/\\div/g, '/').replace(/\\pi/g, 'pi').replace(/\\(?:le|leq)\b/g, '<=')
      .replace(/\\arc(sin|cos|tan)/g, 'a$1').replace(/\\(?:bmod|pmod|mod)\b/g, ' mod ')
      .replace(/\\(sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|ln|log|exp|min|max|gcd|lcm)/g, '$1').replace(/\\[A-Za-z]+/g, '');
    s = s.replace(/[×✕✖⨯·∙•⋅]/g, '*').replace(/[÷∶]/g, '/').replace(/[−–—‒―‐‑⁃﹣－]/g, '-').replace(/π/g, 'pi').replace(/[＝]/g, '=')
      .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[，]/g, ',').replace(/\^\s*\{/g, '^{').replace(/\*\*/g, '^').replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"');
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => '^(' + [...m].map(c => SUP[c]).join('') + ')');
    s = s.replace(/∛\s*/g, ' cbrt ').replace(/√\s*/g, ' sqrt ');
    s = s.replace(/[{\[]/g, '(').replace(/[}\]]/g, ')');
    s = s.replace(/\$/g, '');                                                    // currency signs: "$12.50" → 12.50
    s = s.replace(/(\d+(?:\.\d+)?)\s*°/g, 'deg($1)').replace(/°/g, '');          // "sin 30°" is degrees in either angle mode
    for (let k = 0; k < 3; k++) s = s.replace(/\|([^|]*[^|\s][^|]*)\|/g, 'abs($1)');   // |−5| → abs(−5)
    s = s.replace(/(\d)\s*:\s*(?=[\d.(])/g, '$1/');                               // 12 : 4 → 12 ÷ 4
    s = s.replace(/(\d)\s*%\s*of\b/gi, '$1%*').replace(/\bof\b/gi, '*');         // "15% of 80"
    s = s.replace(/(\d+)\s*([CP])\s*(\d+)(?![\d.])/g, (m, n, k, r) => isName(k) ? m : `${k === 'C' ? 'ncr' : 'npr'}(${n},${r})`);   // 5C2, 5P2
    s = fixConfusions(s, isName);
    for (let k = 0; k < 2; k++) s = s.replace(/([\d.)%])\s*[xX]\s*(?=[\d.(]|sqrt|pi)/g, '$1*');   // handwritten "3 x 4" means ×
    for (let k = 0; k < 2; k++) s = s.replace(/([A-Za-z\d.)])\s+[xX]\s+(?=[A-Za-z\d.(])/g, '$1*');                  // "A x B" with spaces
    s = decimalCommas(s);
    return s.replace(/\s+/g, ' ').trim();
  }

  /* angle mode for trig: 'deg' (default) or 'rad' — set per board (CalcMath.setAngle) or per call (env.angle) */
  let DEFAULT_ANGLE = 'deg', ANGLE = 'deg';
  const toR = x => ANGLE === 'deg' ? x * Math.PI / 180 : x, fromR = x => ANGLE === 'deg' ? x * 180 / Math.PI : x;
  const FUNCS = {};
  const num1 = (name, f) => FUNCS[name] = { n: 1, f: a => f(scalar(a[0], name)) };
  const roundTrig = v => Math.abs(v) < 1e-12 ? 0 : Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v;
  const cosR = x => roundTrig(Math.cos(toR(x))), sinR = x => roundTrig(Math.sin(toR(x)));
  num1('sqrt', x => x < 0 ? fail('Square root of a negative number') : Math.sqrt(x));
  num1('cbrt', x => Math.cbrt(x));
  num1('abs', Math.abs); num1('floor', Math.floor); num1('ceil', Math.ceil); num1('trunc', Math.trunc); num1('exp', Math.exp);
  num1('ln', x => x <= 0 ? fail('ln needs a number above 0') : Math.log(x));
  num1('log10', x => x <= 0 ? fail('log needs a number above 0') : Math.log10(x));
  num1('log2', x => x <= 0 ? fail('log needs a number above 0') : Math.log2(x));
  num1('sin', sinR); num1('cos', cosR);
  num1('tan', x => { const c = Math.cos(toR(x)); return Math.abs(c) < 1e-12 ? fail('tan is undefined there') : roundTrig(Math.tan(toR(x))); });
  num1('sec', x => { const c = cosR(x); return c === 0 ? fail('sec is undefined there') : roundTrig(1 / c); });
  num1('csc', x => { const s = sinR(x); return s === 0 ? fail('csc is undefined there') : roundTrig(1 / s); });
  num1('cot', x => { const s = sinR(x); return s === 0 ? fail('cot is undefined there') : roundTrig(cosR(x) / s); });
  num1('asin', x => Math.abs(x) > 1 ? fail('asin needs −1…1') : roundTrig(fromR(Math.asin(x))));
  num1('acos', x => Math.abs(x) > 1 ? fail('acos needs −1…1') : roundTrig(fromR(Math.acos(x))));
  num1('atan', x => roundTrig(fromR(Math.atan(x))));
  num1('sinh', Math.sinh); num1('cosh', Math.cosh); num1('tanh', Math.tanh);
  num1('deg', x => ANGLE === 'deg' ? x : x * Math.PI / 180);          // 30° in the current angle mode
  num1('piarg', x => ANGLE === 'deg' ? x * 180 / Math.PI : x);
  num1('torad', x => x * Math.PI / 180); num1('todeg', x => x * 180 / Math.PI);
  num1('fact', x => fact(x)); FUNCS.factorial = FUNCS.fact;
  num1('sci', x => x);                                                  // sci(x): same value, shown as a × 10ⁿ
  FUNCS.log = { n: [1, 2], f: a => { const x = scalar(a[0], 'log'), b = a.length > 1 ? scalar(a[1], 'log') : 10; if (x <= 0) fail('log needs a number above 0'); if (b <= 0 || b === 1) fail('Bad log base'); return Math.log(x) / Math.log(b); } };
  FUNCS.root = { n: 2, f: a => { const x = scalar(a[0], 'root'), n = scalar(a[1], 'root'); if (n === 0) fail('0th root is undefined'); if (x < 0) { if (Number.isInteger(n) && n % 2) return -Math.pow(-x, 1 / n); fail('Even root of a negative number'); } return Math.pow(x, 1 / n); } };
  FUNCS.round = { n: [1, 2], f: a => { const x = scalar(a[0], 'round'), d = a.length > 1 ? scalar(a[1], 'round') : 0; const p = Math.pow(10, d); return Math.round((x + Math.sign(x) * Number.EPSILON) * p) / p; } };
  FUNCS.mod = { n: 2, f: a => modF(scalar(a[0], 'mod'), scalar(a[1], 'mod')) };
  FUNCS.hypot = { f: a => Math.hypot(...flat(a)) };
  const whole = (x, what) => { if (!Number.isInteger(x) || x < 0) fail(`${what} needs whole numbers ≥ 0`); return x; };
  function ncr(n, r) { whole(n, 'nCr'); whole(r, 'nCr'); if (r > n) fail('nCr needs r ≤ n'); r = Math.min(r, n - r); let v = 1; for (let i = 1; i <= r; i++) v = v * (n - r + i) / i; if (!Number.isFinite(v)) fail('Too large'); return Math.round(v); }
  function npr(n, r) { whole(n, 'nPr'); whole(r, 'nPr'); if (r > n) fail('nPr needs r ≤ n'); let v = 1; for (let i = 0; i < r; i++) v *= n - i; if (!Number.isFinite(v)) fail('Too large'); return v; }
  FUNCS.ncr = { n: 2, f: a => ncr(scalar(a[0]), scalar(a[1])) }; FUNCS.npr = { n: 2, f: a => npr(scalar(a[0]), scalar(a[1])) }; FUNCS.comb = FUNCS.ncr; FUNCS.perm = FUNCS.npr;
  const gcd2 = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
  const ints = (a, what) => { const v = flat(a); if (v.length < 2 && what !== 'GCD/LCM') fail(`${what} needs at least 2 numbers`); v.forEach(x => { if (!Number.isInteger(x)) fail(`${what} needs whole numbers`); }); return v; };
  FUNCS.gcd = { f: a => { const v = ints(a, 'GCD'); return v.reduce(gcd2); } };
  FUNCS.lcm = { f: a => { const v = ints(a, 'LCM'); return v.reduce((x, y) => (x === 0 || y === 0) ? 0 : Math.abs(x * y) / gcd2(x, y)); } };
  function modF(a, b) { if (b === 0) fail("Can't take mod 0"); return ((a % b) + b) % b; }
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
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+(?![A-Za-z]))?/.exec(rest))) { toks.push({ t: 'num', v: parseFloat(m[0]), s: m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest)) && /^(log10|log2)$/i.test(m[0])) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
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

  /* recursive-descent parser. Precedence (low→high): list "," · + − · × ÷ mod (and implicit 2(3), 2pi, 3A) · unary − · ^ (right-assoc) · postfix % ! */
  function parse(src) {
    const toks = tokenize(src); let p = 0, autoClosed = 0;
    const peek = () => toks[p], isOp = (v, t = toks[p]) => t && t.t === 'op' && t.v === v;
    const next = () => toks[p++];
    const isMod = t => t && t.t === 'id' && t.v.toLowerCase() === 'mod';
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
        if (isMod(peek())) { next(); a = { t: 'bin', op: 'mod', a, b: unary() }; continue; }       // 17 mod 5
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
        if (fn && fn.n === 1 && startsPrimary(peek())) return { t: 'call', name: name.toLowerCase(), args: [postfix()] };   // √9, sqrt 9, sin 30
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
    const prevAngle = ANGLE; ANGLE = env.angle || DEFAULT_ANGLE;
    try { return evaluateIn(ast, env); } finally { ANGLE = prevAngle; }
  }
  function evaluateIn(ast, env) {
    const resolve = env.resolve || (n => (env.vars && hasOwn(env.vars, n)) ? env.vars[n] : undefined);
    const refs = new Set();
    function lookup(name) {
      let v = resolve(name); if (v !== undefined) { refs.add(name); return v; }
      const up = name.toUpperCase(); if (up !== name) { v = resolve(up); if (v !== undefined) { refs.add(up); return v; } }
      if (/^[A-Za-z]{2,4}$/.test(name)) {                          // "AB" = A·B when both are names
        const parts = [...name].map(ch => resolve(ch) !== undefined ? ch : resolve(ch.toUpperCase()) !== undefined ? ch.toUpperCase() : null);
        if (parts.every(Boolean)) return parts.reduce((acc, ch) => { refs.add(ch); return acc * scalar(resolve(ch), ch); }, 1);
      }
      if (name === 'x' || name === 'X') fail('Write “= …” to solve for x');
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
            case 'mod': return modF(a, b);
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
  function formatSci(v, digits = 4) {   // 123456 → "1.2346×10^5"
    if (Array.isArray(v)) return v.map(x => formatSci(x, digits)).join(', ');
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—'; if (v === 0) return '0';
    const [m, e] = v.toExponential(digits).split('e'); return `${(+m < 0 ? '−' : '') + Math.abs(+m)}×10^${+e}`;
  }

  /* ---------- units: "12 ft to m", "3.5 sq ft in sq m", "24 in x 36 in to sq ft", "5 ft 6 in to cm", "10 lb to kg" ---------- */
  const UNITS = {}, UALIAS = {};
  const UL = { m2: 'm²', cm2: 'cm²', mm2: 'mm²', km2: 'km²', in2: 'sq in', ft2: 'sq ft', yd2: 'sq yd', m3: 'm³', cm3: 'cm³', in3: 'cu in', ft3: 'cu ft', yd3: 'cu yd', floz: 'fl oz', l: 'L', ml: 'mL', cl: 'cL' };
  function addU(dim, f, key, ...aliases) { UNITS[key] = { key, dim, f, label: UL[key] || key }; for (const a of [key, ...aliases]) UALIAS[a] = key; }
  addU('length', 0.001, 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'); addU('length', 0.01, 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres');
  addU('length', 1, 'm', 'meter', 'meters', 'metre', 'metres'); addU('length', 1000, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres');
  addU('length', 0.0254, 'in', 'inch', 'inches', '"'); addU('length', 0.3048, 'ft', 'foot', 'feet', "'", 'lf', 'lin ft', 'linear ft', 'linear foot', 'linear feet', 'lnft', 'ft lin');
  addU('length', 0.9144, 'yd', 'yard', 'yards', 'yds'); addU('length', 1609.344, 'mi', 'mile', 'miles');
  addU('area', 1e-6, 'mm2'); addU('area', 1e-4, 'cm2'); addU('area', 1, 'm2', 'sqm'); addU('area', 1e6, 'km2'); addU('area', 0.0254 ** 2, 'in2', 'sqin', 'si');
  addU('area', 0.3048 ** 2, 'ft2', 'sqft', 'sf'); addU('area', 0.9144 ** 2, 'yd2', 'sqyd'); addU('area', 4046.8564224, 'acre', 'acres', 'ac'); addU('area', 1e4, 'ha', 'hectare', 'hectares');
  addU('volume', 0.001, 'ml', 'milliliter', 'milliliters', 'millilitre', 'cc'); addU('volume', 0.01, 'cl'); addU('volume', 1, 'l', 'liter', 'liters', 'litre', 'litres', 'ltr');
  addU('volume', 1000, 'm3'); addU('volume', 0.001, 'cm3'); addU('volume', 0.016387064, 'in3'); addU('volume', 28.316846592, 'ft3'); addU('volume', 764.554857984, 'yd3');
  addU('volume', 0.00492892159375, 'tsp', 'teaspoon', 'teaspoons'); addU('volume', 0.01478676478125, 'tbsp', 'tablespoon', 'tablespoons'); addU('volume', 0.0295735295625, 'floz', 'fl oz', 'fluid ounce', 'fluid ounces');
  addU('volume', 0.2365882365, 'cup', 'cups'); addU('volume', 0.473176473, 'pt', 'pint', 'pints'); addU('volume', 0.946352946, 'qt', 'quart', 'quarts'); addU('volume', 3.785411784, 'gal', 'gallon', 'gallons');
  addU('weight', 1e-6, 'mg', 'milligram', 'milligrams'); addU('weight', 0.001, 'g', 'gram', 'grams'); addU('weight', 1, 'kg', 'kilo', 'kilos', 'kilogram', 'kilograms');
  addU('weight', 1000, 't', 'tonne', 'tonnes', 'metric ton'); addU('weight', 0.028349523125, 'oz', 'ounce', 'ounces'); addU('weight', 0.45359237, 'lb', 'lbs', 'pound', 'pounds', '#');
  addU('weight', 907.18474, 'ton', 'tons', 'short ton'); addU('weight', 6.35029318, 'st', 'stone');
  function unitOf(str) {
    let k = String(str || '').trim().replace(/\.$/, '').replace(/\s+/g, ' ');
    if (!k) return null;
    if (UALIAS[k]) return UNITS[UALIAS[k]];
    k = k.toLowerCase(); if (UALIAS[k]) return UNITS[UALIAS[k]];
    let m = /^(?:sq\.?|square)\s*(.+)$/.exec(k) || /^(.+?)\s*(?:\^?2|²)$/.exec(k);
    if (m) { const b = UALIAS[m[1].trim()]; if (b && UNITS[b].dim === 'length' && UNITS[b + '2']) return UNITS[b + '2']; }
    m = /^(?:cu\.?|cubic)\s*(.+)$/.exec(k) || /^(.+?)\s*(?:\^?3|³)$/.exec(k);
    if (m) { const b = UALIAS[m[1].trim()]; if (b && UNITS[b].dim === 'length' && UNITS[b + '3']) return UNITS[b + '3']; }
    return null;
  }
  function qtyOf(left, env) {        // "5.5 ft" → { base, dim } ; "24 in x 36 in" → area ; "5 ft 6 in" → length
    const L = left.trim(); if (!L) return null;
    const num = t => { const r = evalText(t, Object.assign({}, env, { noUnits: true })); return r.ok && !Array.isArray(r.value) && r.kind !== 'solve' ? r.value : null; };
    const splitQ = t => {          // longest unit suffix after a number
      for (let i = 1; i < t.length; i++) {
        if (!/[\d\s.)]/.test(t[i - 1]) || !/[A-Za-z"'#²]/.test(t[i])) continue;
        const u = unitOf(t.slice(i)); if (!u) continue; const v = num(t.slice(0, i)); if (v !== null) return { v, u };
      }
      return null;
    };
    let m = /^([\d.,]+)\s*[x×*]\s*([\d.,]+)\s*([A-Za-z"'].*)$/.exec(L);       // "24x36 in" → area
    if (m) { const u = unitOf(m[3]), a = num(m[1]), b = num(m[2]); if (u && u.dim === 'length' && a !== null && b !== null) return { base: a * b * u.f * u.f, dim: 'area', from: `${format(a)} × ${format(b)} ${u.label}` }; }
    m = /^(.+?[A-Za-z"'.])\s*[x×*]\s*(.+)$/.exec(L);
    if (m) { const a = splitQ(m[1]), b = splitQ(m[2]); if (a && b && a.u.dim === 'length' && b.u.dim === 'length') return { base: a.v * a.u.f * b.v * b.u.f, dim: 'area', from: `${format(a.v)} ${a.u.label} × ${format(b.v)} ${b.u.label}` }; }
    m = /^(.*?[A-Za-z"'])\s+(\d[\d.,]*\s*[A-Za-z"'].*)$/.exec(L);
    if (m) { const a = splitQ(m[1]), b = splitQ(m[2]); if (a && b && a.u.dim === b.u.dim) return { base: a.v * a.u.f + b.v * b.u.f, dim: a.u.dim, from: `${format(a.v)} ${a.u.label} ${format(b.v)} ${b.u.label}` }; }
    const q = splitQ(L); return q ? { base: q.v * q.u.f, dim: q.u.dim, from: `${format(q.v)} ${q.u.label}` } : null;
  }
  function unitConvert(raw, env = {}) {
    const s = String(raw || '').trim().replace(/\s*=\s*\??\s*$/, '').replace(/[−–—]/g, '-').replace(/\\times\s*|\\cdot\s*|[×·]/g, 'x').replace(/[’′]/g, "'").replace(/[”″]/g, '"');
    if (!/[A-Za-z"']/.test(s) || !/\d/.test(s)) return null;
    const re = /\s+(?:to|into|in|as)(?=\s)|\s*(?:→|->|=>)\s*/gi, seps = []; let m;
    while ((m = re.exec(s))) seps.push([m.index, m.index + m[0].length]);
    for (let k = seps.length - 1; k >= 0; k--) {
      const to = unitOf(s.slice(seps[k][1])); if (!to) continue;
      const from = qtyOf(s.slice(0, seps[k][0]), env); if (!from) continue;
      if (from.dim !== to.dim) return { error: `Can't convert ${from.dim} to ${to.dim}` };
      return { value: clean(from.base / to.f), unit: to, from: from.from };
    }
    return null;
  }
  const unitList = () => Object.values(UNITS);

  /* ---------- solve for x: linear & quadratic exactly, anything else numerically ("2^x = 32", "√x + 3 = 7") ---------- */
  function usesX(ast) { let hit = false; (function walk(n) { if (!n || hit) return; if (n.t === 'var' && (n.name === 'x' || n.name === 'X')) hit = true; for (const k of ['a', 'b', 'p']) if (n[k]) walk(n[k]); (n.items || []).forEach(walk); (n.args || []).forEach(walk); })(ast); return hit; }
  function solveEq(L, R, env = {}) {
    const base = env.resolve || (n => (env.vars && hasOwn(env.vars, n)) ? env.vars[n] : undefined), refs = new Set();
    const f = X => { const r = n => (n === 'x' || n === 'X') ? X : base(n); const a = evaluate(L, { resolve: r, angle: env.angle }), b = evaluate(R, { resolve: r, angle: env.angle }); a.refs.concat(b.refs).forEach(x => x !== 'x' && x !== 'X' && refs.add(x)); return scalar(a.value) - scalar(b.value); };
    const safe = X => { try { const v = f(X); return Number.isFinite(v) ? v : NaN; } catch (e) { if (!e.calc) throw e; if (/^(Unknown name|.* has an error|.* is empty)/.test(e.message)) throw e; return NaN; } };
    const tol = (...v) => 1e-7 * Math.max(1, ...v.map(Math.abs));
    const P = [0, 1, -1, 2, -2, 3, 0.37].map(safe);
    let roots = null, note = '';
    if (P.every(Number.isFinite)) {
      const [c, f1, fm1, f2, fm2, f3, fq] = P, b = (f1 - fm1) / 2, a = (f1 + fm1) / 2 - c;
      const ok = (x, y) => Math.abs(a * x * x + b * x + c - y) <= tol(y, a * x * x, b * x, c);
      if (ok(2, f2) && ok(-2, fm2) && ok(3, f3) && ok(0.37, fq)) {
        const A = Math.abs(a) <= tol(b, c) ? 0 : a;
        if (!A) { if (Math.abs(b) <= tol(c)) fail(Math.abs(c) <= 1e-9 ? 'Every x works' : 'No solution — both sides never match'); roots = [-c / b]; note = 'linear'; }
        else {
          const d = b * b - 4 * A * c;
          if (d < -tol(b * b, 4 * A * c)) { const re = -b / (2 * A), im = Math.sqrt(-d) / (2 * Math.abs(A)); fail(`No real solution (x = ${format(clean(re))} ± ${format(clean(im))}i)`); }
          if (Math.abs(d) <= tol(b * b, 4 * A * c)) roots = [-b / (2 * A)];
          else { const q = -(b + Math.sign(b || 1) * Math.sqrt(d)) / 2; roots = [q / A, c / q].sort((x, y) => x - y); }
          note = 'quadratic';
        }
      }
    }
    if (!roots) {      // numeric: scan for sign changes, then bisect
      const xs = []; for (let x = -100; x <= 100; x += 0.25) xs.push(x); for (let k = 2; k <= 6; k += 0.25) { xs.push(10 ** k); xs.push(-(10 ** k)); }
      xs.sort((p, q) => p - q); const found = [];
      let px = xs[0], pv = safe(px);
      for (const x of xs.slice(1)) {
        const v = safe(x);
        if (Number.isFinite(v) && v === 0) found.push(x);
        else if (Number.isFinite(pv) && Number.isFinite(v) && Math.sign(pv) !== Math.sign(v) && pv !== 0) {
          let lo = px, hi = x, flo = pv; for (let i = 0; i < 90; i++) { const mid = (lo + hi) / 2, fm = safe(mid); if (!Number.isFinite(fm)) break; if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid; }
          const r = (lo + hi) / 2, fr = safe(r); if (Number.isFinite(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(pv), Math.abs(v)) ** 0.5) found.push(r);
        }
        px = x; pv = v; if (found.length >= 6) break;
      }
      roots = [...new Set(found.map(r => clean(Math.abs(r - Math.round(r)) < 1e-9 ? Math.round(r) : r)))];
      if (!roots.length) fail('No solution found for x'); note = 'numeric';
    }
    roots = roots.map(r => clean(Math.abs(r - Math.round(r)) < 1e-10 ? Math.round(r) : r)).map(r => r === 0 ? 0 : r);
    return { roots, note, refs: [...refs] };
  }

  /* one handwritten line → result. Handles "expr", "expr =", "expr = 12" (checks it), "r = 12" (defines r), lists "4, 8, 15",
     v21ef: "2x + 3 = 11" (solves for x), "12 ft to m" (converts), "sci(…)" (scientific notation). */
  function evalText(text, env = {}) {
    const raw = String(text || '');
    const isName = n => { try { return (env.resolve ? env.resolve(n) : (env.vars && hasOwn(env.vars, n) ? env.vars[n] : undefined)) !== undefined; } catch (_) { return true; } };
    const out = { raw, normalized: '', ok: false, kind: 'value', value: null, display: '', error: '', refs: [], name: '' };
    if (!env.noUnits) {
      const uc = unitConvert(raw, env);
      if (uc) { out.normalized = raw.trim(); if (uc.error) { out.error = uc.error; return out; } Object.assign(out, { ok: true, kind: 'convert', value: uc.value, unit: uc.unit.key, display: `${format(uc.value)} ${uc.unit.label}`, from: uc.from }); return out; }
    }
    const s = out.normalized = normalize(raw, { isName });
    try {
      if (!s || /^=*$/.test(s)) fail('Nothing to calculate');
      const parts = s.split('=').map(x => x.trim());
      let lhs = parts[0], rhs = parts.length > 1 ? parts.slice(1).filter(Boolean).pop() || '' : '';
      if (parts.length > 1 && ID_RE.test(lhs) && !FUNCS_ALL()[lhs.toLowerCase()] && rhs && !/^(pi|e)$/i.test(lhs)) { out.kind = 'assign'; out.name = lhs; lhs = rhs; rhs = ''; }
      if (!lhs) fail('Nothing to calculate');
      const ast = parse(lhs);
      if (out.kind !== 'assign' && rhs) {
        let rAst = null; try { rAst = parse(rhs); } catch (_) {}
        if (rAst && (usesX(ast) || usesX(rAst)) && !isName('x')) {
          const sv = solveEq(ast, rAst, env);
          Object.assign(out, { ok: true, kind: 'solve', value: sv.roots.length === 1 ? sv.roots[0] : sv.roots, roots: sv.roots, method: sv.note, refs: sv.refs, display: 'x = ' + sv.roots.map(r => format(r)).join(' or ') });
          return out;
        }
      }
      const r = evaluate(ast, env);
      out.value = r.value; out.refs = r.refs; out.ok = true; out.autoClosed = ast.autoClosed || 0;
      if (Array.isArray(r.value)) out.kind = out.kind === 'assign' ? 'assign' : 'list';
      if (rhs && out.kind !== 'assign') {
        try { const want = evaluate(parse(rhs), env).value; out.kind = 'check'; out.expected = want; out.correct = !Array.isArray(want) && Math.abs(want - r.value) <= 1e-9 * Math.max(1, Math.abs(r.value)); } catch (_) { /* a scribble after "=" is ignored */ }
      }
      out.display = /^sci\s*\(/i.test(lhs) ? formatSci(r.value) : format(r.value);
    } catch (e) { if (!e.calc) throw e; out.error = e.message; out.ok = false; }
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
  function percentile(a, p) {        // inclusive / linear interpolation (Excel PERCENTILE.INC)
    need(p, 'Percentile'); if (p < 0 || p > 100) fail('Percentile must be 0–100');
    const b = [...a].sort((x, y) => x - y), r = p / 100 * (b.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
    return b[lo] + (b[hi] - b[lo]) * (r - lo);
  }
  const quartiles = a => [percentile(a, 25), percentile(a, 50), percentile(a, 75)];
  function pairs(xv, yv) { const x = nums(xv, 'X values', 2), y = nums(yv, 'Y values', 2); if (x.length !== y.length) fail(`${x.length} X values but ${y.length} Y values`); return [x, y]; }
  function regress(xv, yv) {
    const [x, y] = pairs(xv, yv), mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    if (sxx === 0) fail('All X values are the same');
    const m = sxy / sxx, b = my - m * mx, r = syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
    return { m, b, r, r2: r * r, n: x.length };
  }
  function freq(a) { const c = new Map(); for (const x of a) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((p, q) => p[0] - q[0]); }
  const strength = r => { const a = Math.abs(r); return (a >= 0.9 ? 'very strong' : a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'no clear') + (a >= 0.2 ? (r > 0 ? ' positive' : ' negative') : '') + ' link'; };
  const signed = (v, unit = '') => (v > 0 ? '+' : '') + format(v, { unit });
  const P = (k, label, options, def) => ({ k, label, param: true, options, def });
  const PCTS = [[10, '10th'], [25, '25th'], [50, '50th (median)'], [75, '75th'], [90, '90th'], [95, '95th'], [99, '99th']];
  const S1 = (id, label, short, fn, extra = {}) => ({ id, label, short, group: 'Statistics', inputs: [{ k: 'values', label: 'Values', multi: true }], formula: extra.formula || '', run: i => fn(nums(i.values, label, extra.min || 1)), ...extra });
  const M1 = (id, label, short, fname, formula) => ({ id, label, short, group: 'Math', inputs: [{ k: 'x', label: 'Value' }], formula, run: ({ x }) => EXTRA_FUNCS[fname].f([need(x, 'Value')]) });
  const M2 = (id, label, short, fname, k1, k2, formula) => ({ id, label, short, group: 'Math', inputs: [k1, k2].map(([k, l]) => ({ k, label: l })), formula, run: i => EXTRA_FUNCS[fname].f([need(i[k1[0]], k1[1]), need(i[k2[0]], k2[1])]) });
  const UNIT_OPTS = () => unitList().map(u => [u.key, `${u.label} · ${u.dim}`]);
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
    // v21ef business
    { id: 'salesTax', label: 'Sales tax amount', short: 'Sales tax', group: 'Business', inputs: [{ k: 'amount', label: 'Amount' }, { k: 'rate', label: 'Tax %' }], formula: 'amount × tax%',
      run: ({ amount, rate }) => need(amount, 'Amount') * need(rate, 'Tax %') / 100, extra: ({ amount, rate }) => `total ${format(amount * (1 + rate / 100))}` },
    { id: 'tip', label: 'Tip', short: 'Tip', group: 'Business', inputs: [{ k: 'amount', label: 'Bill' }, { k: 'pct', label: 'Tip %' }, { k: 'people', label: 'Split between', optional: true }], formula: 'bill × tip%',
      run: ({ amount, pct }) => need(amount, 'Bill') * need(pct, 'Tip %') / 100,
      extra: ({ amount, pct, people }) => { const t = amount * (1 + pct / 100); return `total ${format(clean(t))}` + (people > 1 ? ` · each ${format(clean(t / people))}` : ''); } },
    { id: 'discountChain', label: 'Discount chain', short: 'After discounts', group: 'Business', inputs: [{ k: 'amount', label: 'Amount' }, { k: 'rates', label: 'Discounts %', multi: true }], formula: 'amount × (1 − d₁) × (1 − d₂) …',
      run: ({ amount, rates }) => nums(rates, 'Discounts %').reduce((v, d) => v * (1 - d / 100), need(amount, 'Amount')),
      extra: ({ amount, rates }) => { const f = nums(rates, 'Discounts %').reduce((v, d) => v * (1 - d / 100), 1); return `effective ${format(clean((1 - f) * 100), { unit: '%' })} off · saves ${format(clean(amount * (1 - f)))}`; } },
    { id: 'profit', label: 'Profit', short: 'Profit', group: 'Business', inputs: [{ k: 'revenue', label: 'Revenue' }, { k: 'cost', label: 'Cost' }], formula: 'revenue − cost',
      run: ({ revenue, cost }) => need(revenue, 'Revenue') - need(cost, 'Cost'), extra: ({ revenue, cost }) => revenue ? `margin ${format(clean((revenue - cost) / revenue * 100), { unit: '%' })}` : '' },
    { id: 'roi', label: 'ROI (return on investment)', short: 'ROI', group: 'Business', unit: '%', signed: true, inputs: [{ k: 'cost', label: 'Investment' }, { k: 'value', label: 'Return (final value)' }], formula: '(return − investment) ÷ investment',
      run: ({ cost, value }) => { need(cost, 'Investment'); need(value, 'Return'); if (cost === 0) fail('Investment is 0 — ROI is undefined'); return (value - cost) / Math.abs(cost) * 100; },
      extra: ({ cost, value }) => `${value - cost >= 0 ? 'gain' : 'loss'} ${format(clean(Math.abs(value - cost)))}` },
    { id: 'costPerUnit', label: 'Cost per unit', short: 'Per unit', group: 'Business', inputs: [{ k: 'total', label: 'Total cost' }, { k: 'qty', label: 'Quantity' }], formula: 'total ÷ quantity',
      run: ({ total, qty }) => { need(total, 'Total'); need(qty, 'Quantity'); if (qty === 0) fail('Quantity is 0'); return total / qty; } },
    { id: 'breakEven', label: 'Break-even units', short: 'Break-even', group: 'Business', inputs: [{ k: 'fixed', label: 'Fixed costs' }, { k: 'price', label: 'Price / unit' }, { k: 'varCost', label: 'Cost / unit' }], formula: 'fixed ÷ (price − cost per unit)',
      run: ({ fixed, price, varCost }) => { need(fixed, 'Fixed costs'); need(price, 'Price'); need(varCost, 'Cost / unit'); if (price <= varCost) fail('Price must be above cost per unit — never breaks even'); return fixed / (price - varCost); },
      extra: ({ fixed, price, varCost }) => `${format(Math.ceil(clean(fixed / (price - varCost))))} units · revenue ${format(clean(fixed / (price - varCost) * price))}` },
    { id: 'simpleInterest', label: 'Simple interest', short: 'Interest', group: 'Business', inputs: [{ k: 'principal', label: 'Principal' }, { k: 'rate', label: 'Rate % / yr' }, { k: 'years', label: 'Years' }], formula: 'principal × rate × years',
      run: ({ principal, rate, years }) => need(principal, 'Principal') * need(rate, 'Rate') / 100 * need(years, 'Years'),
      extra: ({ principal, rate, years }) => `total ${format(clean(principal * (1 + rate / 100 * years)))}` },
    { id: 'compound', label: 'Compound interest', short: 'Amount', group: 'Business', inputs: [{ k: 'principal', label: 'Principal' }, { k: 'rate', label: 'Rate % / yr' }, { k: 'years', label: 'Years' }, P('n', 'Compounded', [[1, 'yearly'], [2, 'twice a year'], [4, 'quarterly'], [12, 'monthly'], [365, 'daily']], 12)], formula: 'P × (1 + r/n)^(n × years)',
      run: ({ principal, rate, years, n }) => need(principal, 'Principal') * Math.pow(1 + need(rate, 'Rate') / 100 / (n || 1), (n || 1) * need(years, 'Years')),
      extra: ({ principal, rate, years, n }) => `interest ${format(clean(principal * Math.pow(1 + rate / 100 / (n || 1), (n || 1) * years) - principal))}` },
    { id: 'loan', label: 'Loan payment (monthly)', short: 'Per month', group: 'Business', inputs: [{ k: 'principal', label: 'Loan amount' }, { k: 'rate', label: 'APR %' }, { k: 'years', label: 'Years' }], formula: 'P·r ÷ (1 − (1+r)^−n), r = APR/12',
      run: ({ principal, rate, years }) => loanPay(principal, rate, years),
      extra: ({ principal, rate, years }) => { const p = loanPay(principal, rate, years), n = years * 12; return `total ${format(clean(p * n))} · interest ${format(clean(p * n - principal))}`; } },
    // statistics (v21ee) …
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
    // … v21ef statistics
    { id: 'percentile', label: 'Percentile', short: 'Percentile', group: 'Statistics', inputs: [{ k: 'values', label: 'Values', multi: true }, P('p', 'Percentile', PCTS, 90)], formula: 'value below which p% of the data falls',
      run: ({ values, p }) => percentile(nums(values, 'Values'), p) },
    S1('quartiles', 'Quartiles (Q1 · median · Q3)', 'Q1 · Q2 · Q3', quartiles, { formula: '25th · 50th · 75th percentile' }),
    S1('iqr', 'IQR (interquartile range)', 'IQR', a => { const q = quartiles(a); return q[2] - q[0]; }, { formula: 'Q3 − Q1', extra: i => { const q = quartiles(nums(i.values, 'Values')); return `Q1 ${format(clean(q[0]))} · Q3 ${format(clean(q[2]))}`; } }),
    { id: 'zscore', label: 'Z-score', short: 'z', group: 'Statistics', signed: true, inputs: [{ k: 'x', label: 'Value' }, { k: 'values', label: 'Data', multi: true }], formula: '(value − mean) ÷ std dev',
      run: ({ x, values }) => { const a = nums(values, 'Data', 2), sd = Math.sqrt(variance(a, true)); if (sd === 0) fail('Data has no spread (std dev 0)'); return (need(x, 'Value') - mean(a)) / sd; },
      extra: ({ x, values }) => { const a = nums(values, 'Data', 2); return `mean ${format(clean(mean(a)))} · s ${format(clean(Math.sqrt(variance(a, true))))}`; } },
    { id: 'correl', label: 'Correlation (r)', short: 'r', group: 'Statistics', signed: true, inputs: [{ k: 'xs', label: 'X list', multi: true }, { k: 'ys', label: 'Y list', multi: true }], formula: 'Pearson r between two lists',
      run: ({ xs, ys }) => { const g = regress(xs, ys); if (!Number.isFinite(g.r)) fail('All Y values are the same'); return g.r; }, extra: ({ xs, ys }) => strength(regress(xs, ys).r) },
    { id: 'regression', label: 'Linear regression', short: 'Slope', group: 'Statistics', inputs: [{ k: 'xs', label: 'X list', multi: true }, { k: 'ys', label: 'Y list', multi: true }], formula: 'best-fit line y = m·x + b',
      run: ({ xs, ys }) => regress(xs, ys).m,
      extra: ({ xs, ys }) => { const g = regress(xs, ys); return `y = ${format(clean(g.m))}x ${g.b < 0 ? '−' : '+'} ${format(clean(Math.abs(g.b)))}` + (Number.isFinite(g.r2) ? ` · r² ${format(clean(g.r2))}` : ''); } },
    S1('frequency', 'Frequency count', 'Distinct', a => freq(a).length, { formula: 'how often each value appears', extra: i => freq(nums(i.values, 'Values')).map(([v, c]) => `${format(v)} ×${c}`).join(' · ') }),
    // v21ef math
    M2('power', 'Power (xʸ)', 'Power', 'pow', ['x', 'Base'], ['y', 'Exponent'], 'base ^ exponent'),
    M1('sqrtFn', 'Square root', '√', 'sqrt', '√x'),
    M1('log10Fn', 'Log (base 10)', 'log', 'log10', 'log₁₀ x'),
    M1('lnFn', 'Natural log (ln)', 'ln', 'ln', 'logₑ x'),
    M1('expFn', 'eˣ', 'eˣ', 'exp', 'e ^ x'),
    M1('factorial', 'Factorial (n!)', 'n!', 'fact', 'n × (n−1) × … × 1'),
    M2('ncr', 'Combinations (nCr)', 'nCr', 'ncr', ['n', 'n'], ['r', 'r'], 'n! ÷ (r!(n−r)!)'),
    M2('npr', 'Permutations (nPr)', 'nPr', 'npr', ['n', 'n'], ['r', 'r'], 'n! ÷ (n−r)!'),
    M1('absFn', 'Absolute value', '|x|', 'abs', '|x|'),
    { id: 'roundFn', label: 'Round', short: 'Rounded', group: 'Math', inputs: [{ k: 'x', label: 'Value' }, P('d', 'Decimals', [[0, '0 (whole)'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], 2)], formula: 'round to d decimals',
      run: ({ x, d }) => EXTRA_FUNCS.round.f([need(x, 'Value'), d || 0]) },
    M1('floorFn', 'Round down (floor)', 'Floor', 'floor', '⌊x⌋'), M1('ceilFn', 'Round up (ceil)', 'Ceil', 'ceil', '⌈x⌉'),
    M2('modFn', 'Remainder (mod)', 'mod', 'mod', ['a', 'Number'], ['b', 'Divide by'], 'a mod b'),
    { id: 'gcdFn', label: 'GCD (greatest common divisor)', short: 'GCD', group: 'Math', inputs: [{ k: 'values', label: 'Whole numbers', multi: true }], formula: 'largest whole number dividing all', run: ({ values }) => EXTRA_FUNCS.gcd.f([nums(values, 'Values', 2)]) },
    { id: 'lcmFn', label: 'LCM (least common multiple)', short: 'LCM', group: 'Math', inputs: [{ k: 'values', label: 'Whole numbers', multi: true }], formula: 'smallest common multiple', run: ({ values }) => EXTRA_FUNCS.lcm.f([nums(values, 'Values', 2)]) },
    M1('sinFn', 'sin', 'sin', 'sin', 'sine (deg / rad toggle)'), M1('cosFn', 'cos', 'cos', 'cos', 'cosine (deg / rad toggle)'), M1('tanFn', 'tan', 'tan', 'tan', 'tangent (deg / rad toggle)'),
    { id: 'sciFn', label: 'Scientific notation', short: 'Scientific', group: 'Math', inputs: [{ k: 'x', label: 'Value' }], formula: 'a × 10ⁿ', run: ({ x }) => need(x, 'Value'), fmt: v => formatSci(v) },
    // v21ef equations
    { id: 'linear', label: 'Solve a·x + b = c', short: 'x', group: 'Equations', inputs: [{ k: 'a', label: 'a' }, { k: 'b', label: 'b' }, { k: 'c', label: 'c' }], formula: 'x = (c − b) ÷ a',
      run: ({ a, b, c }) => { need(a, 'a'); need(b, 'b'); need(c, 'c'); if (a === 0) fail('a is 0 — no single x'); return (c - b) / a; }, fmt: v => 'x = ' + format(v) },
    { id: 'quadratic', label: 'Quadratic a·x² + b·x + c = 0', short: 'x', group: 'Equations', inputs: [{ k: 'a', label: 'a' }, { k: 'b', label: 'b' }, { k: 'c', label: 'c' }], formula: 'x = (−b ± √(b² − 4ac)) ÷ 2a',
      run: ({ a, b, c }) => { need(a, 'a'); need(b, 'b'); need(c, 'c'); if (a === 0) { if (b === 0) fail('Not an equation in x'); return -c / b; } const r = solveEq(parse(`${a}*x^2+(${b})*x+(${c})`), parse('0')).roots; return r.length === 1 ? r[0] : r; },
      fmt: v => 'x = ' + (Array.isArray(v) ? v.map(x => format(x)).join(' or ') : format(v)), extra: ({ a, b, c }) => `discriminant ${format(clean(b * b - 4 * a * c))}` },
    // v21ef units & glass
    { id: 'unitConvert', label: 'Convert units', short: 'Converted', group: 'Units & glass', inputs: [{ k: 'x', label: 'Value' }, P('from', 'From', UNIT_OPTS, 'in'), P('to', 'To', UNIT_OPTS, 'cm')], formula: 'length · area · volume · weight',
      run: ({ x, from, to }) => { const a = UNITS[from], b = UNITS[to]; if (!a || !b) fail('Pick both units'); if (a.dim !== b.dim) fail(`Can't convert ${a.dim} to ${b.dim}`); return need(x, 'Value') * a.f / b.f; },
      fmt: (v, i) => `${format(v)} ${(UNITS[i.to] || {}).label || ''}`, extra: ({ x, from }) => `from ${format(x)} ${(UNITS[from] || {}).label || ''}` },
    { id: 'sqft', label: 'Square feet (W × H inches)', short: 'Sq ft', group: 'Units & glass', inputs: [{ k: 'w', label: 'Width (in)' }, { k: 'h', label: 'Height (in)' }, { k: 'qty', label: 'Pieces', optional: true }], formula: 'W × H ÷ 144 × pieces',
      run: ({ w, h, qty }) => need(w, 'Width') * need(h, 'Height') / 144 * (qty || 1), fmt: v => format(v) + ' sq ft', extra: ({ w, h }) => `${format(clean(w * h * 0.00064516))} m² each` },
    { id: 'linft', label: 'Linear feet (perimeter, inches)', short: 'Linear ft', group: 'Units & glass', inputs: [{ k: 'w', label: 'Width (in)' }, { k: 'h', label: 'Height (in)' }, { k: 'qty', label: 'Pieces', optional: true }], formula: '2 × (W + H) ÷ 12 × pieces',
      run: ({ w, h, qty }) => 2 * (need(w, 'Width') + need(h, 'Height')) / 12 * (qty || 1), fmt: v => format(v) + ' lin ft', extra: ({ w, h }) => `perimeter ${format(clean(2 * (w + h)))} in each` },
    { id: 'glassCost', label: 'Glass cost (W × H in @ $/sq ft)', short: 'Cost', group: 'Units & glass', inputs: [{ k: 'w', label: 'Width (in)' }, { k: 'h', label: 'Height (in)' }, { k: 'rate', label: '$ per sq ft' }, { k: 'qty', label: 'Pieces', optional: true }], formula: 'W × H ÷ 144 × $/sq ft × pieces',
      run: ({ w, h, rate, qty }) => need(w, 'Width') * need(h, 'Height') / 144 * need(rate, '$ per sq ft') * (qty || 1), extra: ({ w, h, qty }) => `${format(clean(w * h / 144 * (qty || 1)))} sq ft` },
    { id: 'diag', label: 'Diagonal √(W² + H²)', short: 'Diagonal', group: 'Units & glass', inputs: [{ k: 'w', label: 'Width' }, { k: 'h', label: 'Height' }], formula: '√(W² + H²)', run: ({ w, h }) => Math.hypot(need(w, 'Width'), need(h, 'Height')) },
  ];
  function loanPay(P0, apr, years) { need(P0, 'Loan amount'); need(apr, 'APR'); need(years, 'Years'); const n = Math.round(years * 12), r = apr / 100 / 12; if (n <= 0) fail('Years must be above 0'); return r === 0 ? P0 / n : P0 * r / (1 - Math.pow(1 + r, -n)); }
  const FN = Object.fromEntries(FN_LIST.map(f => [f.id, f]));
  function runFn(id, inputs, opts = {}) {
    const f = FN[id]; if (!f) return { ok: false, error: 'Unknown function' };
    const prevAngle = ANGLE; ANGLE = opts.angle || DEFAULT_ANGLE;
    try {
      for (const i of f.inputs) if (i.param && inputs[i.k] == null) inputs = Object.assign({}, inputs, { [i.k]: i.def });
      const v = f.run(inputs), value = Array.isArray(v) ? v.map(clean) : clean(v);
      if ((Array.isArray(value) ? value : [value]).some(x => !Number.isFinite(x))) fail('Too large');
      let extra = ''; try { extra = f.extra ? f.extra(inputs) : ''; } catch (_) {}
      return { ok: true, value, display: f.fmt ? f.fmt(value, inputs) : (f.signed && value > 0 ? '+' : '') + format(value, { unit: f.unit || '' }), extra };
    } catch (e) { if (!e.calc) throw e; return { ok: false, error: e.message }; }
    finally { ANGLE = prevAngle; }
  }

  /* ⇄ Compare — two or more values (or lists) side by side. Roles come from the order given (first = base / cost). */
  function compare(items, opts = {}) {
    if (!items || items.length < 2) fail('Compare needs at least 2 areas');
    const isList = v => Array.isArray(v) && v.length !== 1;
    if (items.some(i => isList(i.value))) {
      const cols = items.map(i => { const a = nums(i.value, i.name || 'List'); return { name: i.name, n: a.length, mean: clean(mean(a)), median: clean(median(a)), sd: a.length > 1 ? clean(Math.sqrt(variance(a, true))) : 0, min: Math.min(...a), max: Math.max(...a), range: clean(Math.max(...a) - Math.min(...a)), sum: sum(a) }; });
      const b = cols[0]; cols.forEach((c, k) => { c.dMean = k ? clean(c.mean - b.mean) : 0; c.pct = k && b.mean !== 0 ? clean((c.mean - b.mean) / Math.abs(b.mean) * 100) : null; });
      const hi = cols.reduce((p, c) => c.mean > p.mean ? c : p), lo = cols.reduce((p, c) => c.mean < p.mean ? c : p);
      return { kind: 'lists', cols, higher: hi.mean === lo.mean ? null : hi.name, lower: hi.mean === lo.mean ? null : lo.name, value: cols[1].dMean, display: signed(cols[1].dMean) };
    }
    const vals = items.map(i => need(scalar(i.value, i.name), i.name || 'Value'));
    const cols = items.map((i, k) => ({ name: i.name, value: vals[k] }));
    const a = vals[0];
    cols.forEach((c, k) => { c.diff = k ? clean(c.value - a) : 0; c.pct = k && a !== 0 ? clean((c.value - a) / Math.abs(a) * 100) : null; c.ratio = k && a !== 0 ? clean(c.value / a) : null; });
    const sorted = [...cols].sort((p, q) => q.value - p.value); sorted.forEach((c, k) => c.rank = k + 1);
    const allEq = sorted[0].value === sorted[sorted.length - 1].value;
    const out = { kind: 'scalars', cols, higher: allEq ? null : sorted[0].name, lower: allEq ? null : sorted[sorted.length - 1].name, spread: clean(sorted[0].value - sorted[sorted.length - 1].value) };
    if (cols.length === 2) {
      const b = vals[1]; Object.assign(out, { diff: cols[1].diff, pct: cols[1].pct, ratio: cols[1].ratio, value: cols[1].diff, display: signed(cols[1].diff) });
      if (a > 0 && b > 0) out.prices = { cost: cols[0].name, price: cols[1].name, margin: clean((b - a) / b * 100), markup: clean((b - a) / a * 100), profit: clean(b - a) };
    } else Object.assign(out, { value: out.spread, display: format(out.spread) });
    return out;
  }

  // formula-callable versions: sum(A, B), avg(...), median, mode, stdev, margin(cost, price)…
  const stat = id => ({ f: a => { const r = runFn(id, { values: flat(a) }); if (!r.ok) fail(r.error); return Array.isArray(r.value) && id !== 'quartiles' ? r.value[0] : r.value; } });
  const two = (id, k1, k2) => ({ n: 2, f: a => { const r = runFn(id, { [k1]: scalar(a[0]), [k2]: scalar(a[1]) }); if (!r.ok) fail(r.error); return r.value; } });
  const nArgs = (id, keys, lo) => ({ n: [lo == null ? keys.length : lo, keys.length], f: a => { const i = {}; keys.forEach((k, j) => { if (j < a.length) i[k] = scalar(a[j]); }); const r = runFn(id, i); if (!r.ok) fail(r.error); return r.value; } });
  const lastArg = (a, what) => { if (a.length < 2) fail(`${what} needs a list and a number`); return [flat(a.slice(0, -1)), scalar(a[a.length - 1])]; };
  const twoLists = (a, what) => { if (a.length !== 2) fail(`${what} needs two lists, e.g. ${what}(A, B)`); return [flat([a[0]]), flat([a[1]])]; };
  EXTRA_FUNCS = Object.assign({}, FUNCS, {
    sum: stat('sum'), avg: stat('average'), mean: stat('average'), average: stat('average'), median: stat('median'), mode: stat('mode'),
    min: stat('min'), max: stat('max'), range: stat('range'), count: stat('count'), stdev: stat('stdevS'), sd: stat('stdevS'), stdevp: stat('stdevP'),
    var: stat('varS'), varp: stat('varP'),
    margin: two('margin', 'cost', 'price'), markup: two('markup', 'cost', 'price'), pctchange: two('pctChange', 'old', 'new'), pctof: two('pctOf', 'pct', 'of'),
    tax: two('tax', 'amount', 'rate'), discount: two('discount', 'amount', 'rate'),
    // v21ef
    pow: { n: 2, f: a => { const x = scalar(a[0]), y = scalar(a[1]); if (x === 0 && y <= 0) fail(y ? "Can't divide by 0" : '0⁰ is undefined'); if (x < 0 && !Number.isInteger(y)) fail('Fractional power of a negative number'); return Math.pow(x, y); } },
    salestax: two('salesTax', 'amount', 'rate'), tip: nArgs('tip', ['amount', 'pct', 'people'], 2), profit: two('profit', 'revenue', 'cost'), roi: two('roi', 'cost', 'value'),
    costper: two('costPerUnit', 'total', 'qty'), unitcost: two('costPerUnit', 'total', 'qty'), breakeven: nArgs('breakEven', ['fixed', 'price', 'varCost']),
    simple: nArgs('simpleInterest', ['principal', 'rate', 'years']), compound: nArgs('compound', ['principal', 'rate', 'years', 'n'], 3), loan: nArgs('loan', ['principal', 'rate', 'years']),
    chain: { f: a => { const v = flat(a); if (v.length < 2) fail('chain needs an amount and at least one discount'); const r = runFn('discountChain', { amount: v[0], rates: v.slice(1) }); if (!r.ok) fail(r.error); return r.value; } },
    percentile: { f: a => { const [l, p] = lastArg(a, 'percentile'); return percentile(nums(l, 'Values'), p); } },
    quartiles: { f: a => quartiles(nums(flat(a), 'Values')) }, q1: { f: a => percentile(nums(flat(a), 'Values'), 25) }, q3: { f: a => percentile(nums(flat(a), 'Values'), 75) },
    iqr: stat('iqr'), freq: stat('frequency'),
    zscore: { f: a => { if (a.length < 2) fail('zscore needs a value and a list'); const r = runFn('zscore', { x: scalar(a[0]), values: flat(a.slice(1)) }); if (!r.ok) fail(r.error); return r.value; } },
    correl: { f: a => { const [x, y] = twoLists(a, 'correl'); const r = runFn('correl', { xs: x, ys: y }); if (!r.ok) fail(r.error); return r.value; } },
    slope: { f: a => { const [x, y] = twoLists(a, 'slope'); return regress(x, y).m; } }, intercept: { f: a => { const [x, y] = twoLists(a, 'intercept'); return regress(x, y).b; } },
    rsq: { f: a => { const [x, y] = twoLists(a, 'rsq'); const g = regress(x, y); if (!Number.isFinite(g.r2)) fail('All Y values are the same'); return g.r2; } },
    sqft: nArgs('sqft', ['w', 'h', 'qty'], 2), linft: nArgs('linft', ['w', 'h', 'qty'], 2), glass: nArgs('glassCost', ['w', 'h', 'rate', 'qty'], 3),
    quad: { n: 3, f: a => { const r = runFn('quadratic', { a: scalar(a[0]), b: scalar(a[1]), c: scalar(a[2]) }); if (!r.ok) fail(r.error); return r.value; } },
  });
  EXTRA_FUNCS.corr = EXTRA_FUNCS.correl;

  const CalcMath = { normalize, tokenize, parse, evaluate, evalText, format, formatSci, solve: (l, r, env) => solveEq(parse(normalize(l)), parse(normalize(r)), env), convert: unitConvert, unitOf, units: unitList, CalcError,
    setAngle(m) { DEFAULT_ANGLE = ANGLE = m === 'rad' ? 'rad' : 'deg'; }, get angle() { return DEFAULT_ANGLE; }, fnNames: () => Object.keys(EXTRA_FUNCS) };
  const CalcFns = { list: FN_LIST, get: id => FN[id], run: runFn, modes, compare, percentile, quartiles, regress };
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
  const CB = { board: emptyBoard(), undo: [], redo: [], tool: 'pen', sel: [], vals: new Map(), recog: null, readers: null, pending: new Set(), timer: 0, loaded: false, el: null, g: null, ptrs: new Map(), menu: null,
    mode: 'auto', angle: 'deg', bias: null, busy: 0, fnTab: 'All', fnQ: '' };
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };
  CB.mode = LS.get('cbCalcMode', 'auto') === 'manual' ? 'manual' : 'auto';
  CB.angle = LS.get('cbAngle', 'deg') === 'rad' ? 'rad' : 'deg'; CalcMath.setAngle(CB.angle);
  const RECOG = () => root.CalcRecog || null;
  CB.bias = RECOG() ? RECOG().makeBias({ get: () => JSON.parse(LS.get('cbReadBias', 'null')), set: v => LS.set('cbReadBias', JSON.stringify(v)) }) : null;
  /* ⇄ Compare is a board block like the functions, but its card is drawn by the board (CalcFns.compare does the math) */
  const COMPARE_FN = { id: 'compare', label: 'Compare', short: 'Compare', group: 'Compare', inputs: [{ k: 'items', label: 'Areas to compare', multi: true }], formula: 'side by side · difference · % · ratio' };
  const fnOf = id => id === 'compare' ? COMPARE_FN : CalcFns.get(id);
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
      if (!e.text) return { ok: false, empty: true, error: e.status === 'reading' || e.status === 'held' ? '' : 'Not recognized', refs: [] };
      return evalText(e.text, { resolve: nm => resolve(e.name, nm) });
    }
    function calcBlock(b) {
      if (b.fn === 'compare') return calcCompare(b);
      const f = CalcFns.get(b.fn); if (!f) return { ok: false, error: 'Unknown function' };
      const inp = {};
      for (const i of f.inputs) {
        if (i.param) { const pv = b.params && b.params[i.k] != null ? b.params[i.k] : i.def; inp[i.k] = typeof i.def === 'number' ? +pv : pv; continue; }
        const ids = (b.inputs && b.inputs[i.k]) || []; if (!ids.length) { if (i.optional) continue; return { ok: false, error: `Pick ${i.label.toLowerCase()}` }; }
        const vs = [];
        for (const id of ids) { const r = get(id); if (!r.ok) { const nm = (node(id) || {}).name || 'A source'; return { ok: false, error: r.gone ? 'A source was deleted' : `${nm} ${r.empty ? 'is empty' : 'has an error'}` }; } vs.push(r.value); }
        const v = vs.flat();
        if (i.multi) inp[i.k] = v; else { if (v.length !== 1) return { ok: false, error: `${i.label} needs one number` }; inp[i.k] = v[0]; }
      }
      const r = CalcFns.run(b.fn, inp); r.inputs = inp; return r;
    }
    function calcCompare(b) {
      const ids = (b.inputs && b.inputs.items) || []; if (ids.length < 2) return { ok: false, error: 'Pick at least 2 areas' };
      const items = [];
      for (const id of ids) { const r = get(id), n = node(id); if (!r.ok) return { ok: false, error: r.gone ? 'A source was deleted' : `${(n || {}).name || 'A source'} ${r.empty ? 'is empty' : 'has an error'}` }; items.push({ name: (n && n.name) || '?', value: r.value, id, text: n && n.text || '' }); }
      try { const c = CalcFns.compare(items); return { ok: true, value: c.value, display: c.display, card: c, items }; } catch (e) { if (!e.calc) throw e; return { ok: false, error: e.message }; }
    }
    for (const n of [...CB.board.exprs, ...CB.board.blocks]) get(n.id);
    CB.vals = vals; return vals;
  }
  const val = id => CB.vals.get(id) || { ok: false };

  /* ---------- recognition (app path; tests swap in a stub with CalcBoard.setRecognizer) ---------- */
  /* v21ef: two readers, combined. 🛰 Grok (the user's saved key, through the app's aiRequest) gets a few-shot prompt + a tight, high-res
     crop of only this formula; the on-device reader (the browser's Handwriting Recognition API where it exists — not on iPad Safari)
     reads each structural piece (fraction / root / exponent / column) separately. CalcRecog.combine validates both by parsing and
     compares their VALUES; disagreement → one-tap picker. Without AI or on-device HW we keep the old V21e4.recognizeStrokes fallback. */
  const MATH_PROMPT = (RECOG() && RECOG().PROMPT) || 'TASK: transcribe math\nTranscribe the handwritten math in the image as ONE line of LaTeX-style calculator input. Do NOT solve it. Return only the expression, or [unreadable].';
  async function grokRead(strokes) {
    const aiReady = G('aiReady'), aiRequest = G('aiRequest'), inkToPNG = G('inkToPNG'), inkBB = G('inkBB'), R = RECOG();
    if (!(aiReady && aiRequest && aiReady())) return null;
    const sys = R ? R.prompt(R.describe(R.layout(strokes)), CB.bias ? CB.bias.hints() : '') : MATH_PROMPT;
    const img = (R && R.renderInk(strokes)) || (inkToPNG ? inkToPNG(strokes, inkBB ? inkBB(strokes) : undefined) : '');
    const t = await aiRequest([{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'text', text: 'Transcribe this handwritten math.' }, { type: 'image_url', image_url: { url: img } }] }], { json: false, timeout: 30000 });
    const g = R ? R.parseGrok(t) : { text: String(t || '').trim() };
    return g.text ? g : null;
  }
  const hw = () => { try { return typeof HW !== 'undefined' && HW && HW.state === 'ready' && HW.rec ? HW : null; } catch (_) { return null; } };   // eslint-disable-line no-undef
  async function hwFlat(strokes) {
    const H = hw(); if (!H || !strokes.length) return '';
    const d = H.rec.startDrawing({ recognitionType: 'text', inputType: 'stylus' }); let t = 0;
    for (const st of strokes) { const hs = new HandwritingStroke(); for (const p of st.points) hs.addPoint({ x: p[0], y: p[1], t: (t += 8) }); d.addStroke(hs); t += 120; }   // eslint-disable-line no-undef
    const preds = await d.getPrediction(); if (d.clear) d.clear(); return ((preds && preds[0] && preds[0].text) || '').trim();
  }
  async function deviceRead(strokes) { if (!hw()) return null; const R = RECOG(); const t = R ? await R.structuredRead(strokes, hwFlat) : await hwFlat(strokes); return t ? { text: t } : null; }
  async function defaultRecognize(strokes, ctx = {}) {
    const rd = CB.readers || {}, R = RECOG(), safe = p => Promise.resolve().then(p).catch(e => { console.warn('calc reader', e); return null; });
    const [g, d] = await Promise.all([safe(() => (rd.grok || grokRead)(strokes)), safe(() => (rd.device || deviceRead)(strokes))]);
    const readings = [];
    if (g && g.text) readings.push({ src: 'grok', text: g.text, alts: g.alts, conf: g.conf });
    if (d && d.text) readings.push({ src: 'device', text: d.text, conf: d.conf });
    if (!readings.length && !rd.grok && !rd.device) { const V = G('V21e4'); if (V && typeof V.recognizeStrokes === 'function') { try { const t = await V.recognizeStrokes(strokes); if (t) readings.push({ src: 'device', text: String(t) }); } catch (_) {} } }   // on-device HW → Grok transcribe (v21e4)
    if (!readings.length) return { text: '', conf: 0, cands: [] };
    if (!R) return { text: readings[0].text, conf: null, cands: [] };
    return R.combine(readings, t => evalText(cleanRecognized(t), ctx.env || {}), CB.bias);
  }
  const cleanRecognized = t => String(t || '').replace(/```[a-z]*|```/gi, '').replace(/^\s*(?:answer|expression|latex)\s*:\s*/i, '').split('\n').map(x => x.trim()).filter(Boolean).join(' ').trim();
  const envFor = e => ({ resolve: nm => { if (nm === e.name) return undefined; const n = named().find(o => o.name === nm); if (!n) return undefined; const v = val(n.id); return v.ok ? v.value : undefined; } });
  async function recognize(e) {
    const tok = (e.rtok = (e.rtok || 0) + 1); e.status = 'reading'; e.text = ''; e.cands = null; recalc(); renderOverlay();
    const strokes = e.sids.map(strokeById).filter(Boolean);
    let res = null; CB.busy++;
    try { res = await (CB.recog || defaultRecognize)(strokes, { bb: e.bb, id: e.id, env: envFor(e) }); } catch (err) { console.warn(err); } finally { CB.busy--; }
    if (res == null || typeof res !== 'object') res = { text: String(res || '') };
    const cur = CB.board.exprs.find(x => x.id === e.id); if (!cur || cur.rtok !== tok) return;
    cur.raw = cleanRecognized(res.text); cur.text = cur.raw; cur.status = cur.text ? 'ok' : 'empty';
    const cands = (res.cands || []).map(c => ({ text: cleanRecognized(c.text), src: c.src || '' })).filter(c => c.text);
    cur.cands = cands.length > 1 ? cands : null; cur.src = res.src || '';
    cur.conf = res.conf != null ? res.conf : cur.text ? (evalText(cur.text, envFor(cur)).ok ? 0.8 : 0.3) : 0;
    adoptAssignName(cur); recalc(); renderOverlay(); save();
  }
  /* one tap on a candidate: that reading wins, and the board remembers the correction for next time */
  function pickCand(e, k) {
    const c = e.cands && e.cands[k]; if (!c) return;
    hist(); if (CB.bias) CB.bias.learn(e.raw || e.text, c.text, c.src);
    e.text = c.text; e.cands = null; e.conf = 1; e.fixed = true; e.pend = false; e.status = 'ok'; adoptAssignName(e); recalc(); renderOverlay(); save();
    toastc(`✓ Using ${c.src === 'grok' ? 'Grok’s' : c.src === 'device' ? 'the on-device' : 'that'} reading — I’ll remember it`, 1800);
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
    const R = RECOG(); if (R) return flushGrouped(ps, noRecognize, R);
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
  /* v21ef grouping (CalcRecog.assign): spacing scaled to the writing size, exponents, fractions, roots, column sums; Manual mode holds reads */
  function flushGrouped(ps, noRecognize, R) {
    const plan = R.assign(ps, CB.board.exprs.filter(e => !e.typed).map(e => ({ id: e.id, strokes: e.sids.map(strokeById).filter(Boolean) })));
    const touched = [];
    for (const a of plan) {
      const es = a.exprIds.map(id => CB.board.exprs.find(x => x.id === id)).filter(Boolean);
      let e = es[0];
      if (!e) { e = { id: uidc('e'), sids: [], bb: null, raw: '', text: '', status: 'reading', name: '', color: '' }; CB.board.exprs.push(e); }
      for (const o of es.slice(1)) {        // ink bridged two areas → merge, keep the first one's name and links
        e.sids.push(...o.sids); if (!e.name && o.name) { e.name = o.name; e.color = o.color; }
        for (const b of CB.board.blocks) for (const k in b.inputs) b.inputs[k] = [...new Set(b.inputs[k].map(id => id === o.id ? e.id : id))];
        CB.board.exprs = CB.board.exprs.filter(x => x !== o); CB.sel = CB.sel.map(id => id === o.id ? e.id : id);
      }
      e.sids.push(...a.pending.map(s => s.id)); exprBB(e); e.fixed = false; e.cands = null; touched.push(e);
    }
    for (const e of touched) { if (noRecognize) e.status = 'reading'; else if (CB.mode === 'manual') hold(e); else recognize(e); }
    renderOverlay(); save(); return touched;
  }
  function hold(e) { e.status = 'held'; e.pend = true; e.cands = null; }
  const isBarStroke = s => { const b = sbb(s), w = b[2] - b[0], h = b[3] - b[1]; return w > 8 && w < 120 && h < Math.max(6, 0.3 * w); };
  function looksLikeEquals(s) {   // the last two strokes are short stacked bars → "=" was just written
    const i = CB.board.strokes.indexOf(s), p = CB.board.strokes[i - 1]; if (!p || !CB.pending.has(p.id) || !isBarStroke(s) || !isBarStroke(p)) return false;
    const a = sbb(s), b = sbb(p), hOv = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), vGap = Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2);
    return hOv > 0.5 * Math.min(a[2] - a[0], b[2] - b[0]) && vGap > 3 && vGap < 26;
  }

  /* ---------- DOM ---------- */
  const isOpen = () => { const QB = G('QB'); return !!(QB && QB.open && QB.mode === 'calc'); };
  const HINT = { pen: 'Write math · pause or write = for the answer · tap an answer to fix it · finger pans', erase: 'Rub out ink — answers update', lasso: 'Circle numbers to link them (A, B…) · lasso more areas to add · then ⇄ Compare, Σ, x̄ or ƒ' };
  const HINT_MANUAL = 'Manual — write everything, then tap = Calculate · • marks a formula waiting to be calculated';
  function mount() {
    if (CB.el) return CB.el;
    const host = document.createElement('div'); host.id = 'cbHost'; host.className = 'dr-host cb-host'; host.hidden = true;
    host.innerHTML = `<div class="cb-bar" role="toolbar" aria-label="Calculator Board tools">
        <button class="cb-tool on" data-tool="pen" aria-label="Write" aria-pressed="true"><i>✏️</i><span>Write</span></button>
        <button class="cb-tool" data-tool="erase" aria-label="Eraser" aria-pressed="false"><i>⌫</i><span>Erase</span></button>
        <button class="cb-tool" data-tool="lasso" aria-label="Lasso" aria-pressed="false"><i>◌</i><span>Lasso</span></button>
        <span class="cb-sep"></span>
        <button class="cb-fnbtn" data-cb="fns" aria-haspopup="menu" aria-label="Functions"><i>ƒ</i><span>Functions</span><em>▾</em></button>
        <span class="cb-sep"></span>
        <span class="cb-seg" role="group" aria-label="When to calculate"><button data-cb="auto" aria-pressed="true" title="Calculate as you write">⚡ <span>Auto</span></button><button data-cb="manual" aria-pressed="false" title="Write everything first, then tap = Calculate">✋ <span>Manual</span></button></span>
        <button class="cb-calc" data-cb="calc" hidden aria-label="Calculate"><b>=</b> <span>Calculate</span><em class="cb-calcn"></em></button>
        <button class="cb-tool icon cb-ang" data-cb="angle" aria-label="Angle mode" title="Trig angle mode — tap to switch degrees / radians">DEG</button>
        <span class="cb-hint"></span>
        <button class="cb-tool icon" data-cb="fit" aria-label="Fit everything on screen" title="Fit everything">⤢</button>
      </div>
      <div class="cb-stage">
        <canvas class="cb-cv"></canvas>
        <button class="cb-fab" data-cb="calc" hidden aria-label="Calculate everything on the board"><b>=</b><span>Calculate</span><em class="cb-calcn"></em></button>
        <div class="cb-layer"><svg class="cb-links" width="1" height="1" aria-hidden="true"></svg><div class="cb-items"></div></div>
        <svg class="cb-lasso" aria-hidden="true"><path/></svg>
        <div class="cb-empty"><b>🧮 Calculator Board</b><span>Write any math with your Pencil — <i>12×(3+4)²</i>, <i>¾ + √16</i>, <i>15% of 80</i>, <i>2x + 3 = 11</i>, <i>24×36 in to sq ft</i>. Pause or write “=” and the answer appears — or switch to ✋ Manual and tap = Calculate when you’re done.<br>◌ Lasso two areas and tap ⇄ Compare, or pick Margin, Loan, Percentile… from ƒ Functions.</span></div>
        <div class="cb-selbar" hidden></div>
        <div class="cb-menu" role="menu" hidden></div>
      </div>
      <div class="cb-sheet-wrap" hidden><div class="cb-sheet" role="dialog" aria-modal="true"></div></div>`;
    const ref = document.getElementById('inHost') || document.getElementById('ibHost') || document.getElementById('qbHost');
    if (ref) ref.parentNode.insertBefore(host, ref.nextSibling); else document.body.append(host);
    const el = CB.el = { host, fab: host.querySelector('.cb-fab'), calcBtn: host.querySelector('.cb-calc'), stage: host.querySelector('.cb-stage'), cv: host.querySelector('.cb-cv'), layer: host.querySelector('.cb-layer'), links: host.querySelector('.cb-links'), items: host.querySelector('.cb-items'),
      lasso: host.querySelector('.cb-lasso path'), selbar: host.querySelector('.cb-selbar'), menu: host.querySelector('.cb-menu'), sheetWrap: host.querySelector('.cb-sheet-wrap'), sheet: host.querySelector('.cb-sheet'), hint: host.querySelector('.cb-hint'), empty: host.querySelector('.cb-empty') };
    el.ctx = el.cv.getContext('2d');
    host.querySelector('.cb-bar').addEventListener('click', e => {
      const t = e.target.closest('button[data-tool]'); if (t) return setTool(t.dataset.tool);
      const c = e.target.closest('[data-cb]'); if (!c) return;
      if (c.dataset.cb === 'fns') return fnMenu(c);
      if (c.dataset.cb === 'fit') return fit();
      if (c.dataset.cb === 'auto' || c.dataset.cb === 'manual') return setMode(c.dataset.cb);
      if (c.dataset.cb === 'calc') return calculate(CB.sel.length ? CB.sel.slice() : null);
      if (c.dataset.cb === 'angle') return setAngle(CB.angle === 'deg' ? 'rad' : 'deg');
    });
    el.fab.addEventListener('click', () => calculate(CB.sel.length ? CB.sel.slice() : null));
    el.menu.addEventListener('input', e => { if (e.target.matches('.cb-fq')) { CB.fnQ = e.target.value; renderFnList(); } });
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
    setTool(CB.tool); syncMode();
    return el;
  }
  function setTool(t) {
    CB.tool = t; if (!CB.el) return;
    CB.el.host.querySelectorAll('button[data-tool]').forEach(b => { b.classList.toggle('on', b.dataset.tool === t); b.setAttribute('aria-pressed', b.dataset.tool === t); });
    CB.el.host.dataset.cbtool = t; CB.el.hint.textContent = CB.mode === 'manual' && t === 'pen' ? HINT_MANUAL : HINT[t];
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
  /* Manual mode: what is still waiting for “= Calculate” (its own ink, or anything it links to) */
  function waitingSet() {
    const w = new Map();
    const isW = (id, seen = new Set()) => {
      if (w.has(id)) return w.get(id); if (seen.has(id)) return false; seen.add(id);
      const n = node(id); if (!n) return false; let r = !!n.pend || n.status === 'held';
      if (!r && n.fn) r = Object.values(n.inputs || {}).flat().some(x => isW(x, seen));
      if (!r && n.sids) { const v = val(n.id); r = (v.refs || []).some(nm => { const m = named().find(o => o.name === nm); return m && m !== n && isW(m.id, seen); }); }
      w.set(id, r); return r;
    };
    for (const n of [...CB.board.exprs, ...CB.board.blocks]) isW(n.id);
    return w;
  }
  const SRC = { grok: 'Grok', device: 'On-device', alt: 'Other reading', learned: 'Your usual' };
  function resHTML(e, waiting) {
    const r = val(e.id);
    if (waiting) return { cls: 'pend', main: '', sub: '', pend: true };
    if (e.status === 'reading') return { cls: 'reading', main: '…', sub: 'reading' };
    if (!e.text) return { cls: 'empty', main: '? tap to type', sub: '' };
    const sub = pretty(r.normalized || evalText(e.text).normalized || e.text);
    const conf = e.typed || e.fixed ? '' : RECOG() ? RECOG().confLevel(e.conf) : '';
    const amb = e.cands && e.cands.length > 1 ? ' amb' : '';
    if (!r.ok) return { cls: 'err' + amb, main: '⚠︎ ' + r.error, sub, conf };
    if (r.kind === 'check') return { cls: (r.correct ? 'ok check' : 'err check') + amb, main: r.correct ? '✓ ' + r.display : '✗ = ' + r.display, sub, conf };
    if (r.kind === 'list') return { cls: 'ok list' + amb, main: `${r.value.length} values · Σ ${CalcMath.format(r.value.reduce((s, x) => s + x, 0))}`, sub, conf };
    if (r.kind === 'solve' || r.kind === 'convert') return { cls: 'ok ' + r.kind + amb, main: (r.kind === 'convert' ? '= ' : '') + r.display, sub: r.kind === 'convert' ? r.from + ' →' : sub, conf };
    return { cls: 'ok' + amb, main: '= ' + r.display, sub, conf };
  }
  const CONF_T = { hi: 'Read with high confidence', mid: 'Read with medium confidence — check it', lo: 'Low confidence — tap to check what was read' };
  function candsHTML(e, x, y) {
    return `<div class="cb-cands" data-eid="${e.id}" style="left:${x}px;top:${y}px" role="group" aria-label="The readers disagree — tap the right one"><i>Which did you write?</i>${e.cands.map((c, k) => {
      const r = evalText(c.text, envFor(e)); return `<button data-pick="${k}" data-eid="${e.id}"><small>${escH(SRC[c.src] || c.src)}</small><span>${escH(pretty(r.normalized || c.text))}</span><b>${escH(r.ok ? (r.kind === 'solve' ? r.display : '= ' + r.display) : '⚠︎')}</b></button>`; }).join('')}</div>`;
  }
  const r2 = v => v == null || !Number.isFinite(v) ? v : Math.round(v * 100) / 100;   // percentages on cards: 2 decimals max
  const fmtC = v => v == null ? '—' : CalcMath.format(v), sgn = (v, u = '') => v == null ? '—' : (v > 0 ? '+' : '') + CalcMath.format(v, { unit: u });
  function compareHTML(b, r) {
    const c = r.card, items = r.items, col = id => (node(id) || {}).color || '#8b85ff';
    const head = items.map((it, k) => `<th style="--c:${col(it.id)}"><em>${escH(it.name)}</em>${k === 0 ? '<small>base</small>' : ''}</th>`).join('');
    let body = '';
    if (c.kind === 'lists') {
      const row = (lab, f) => `<tr><th>${lab}</th>${c.cols.map(f).join('')}</tr>`;
      body = row('Count', x => `<td>${x.n}</td>`) + row('Mean', x => `<td><b>${fmtC(x.mean)}</b></td>`) + row('Median', x => `<td>${fmtC(x.median)}</td>`) + row('Std dev', x => `<td>${fmtC(x.sd)}</td>`) + row('Range', x => `<td>${fmtC(x.range)} <small>(${fmtC(x.min)}–${fmtC(x.max)})</small></td>`) +
        row('Mean vs base', (x, k) => `<td>${k ? `${sgn(x.dMean)}${x.pct != null ? ` <small>(${sgn(r2(x.pct), '%')})</small>` : ''}` : '—'}</td>`);
      return { body: `<table class="cb-ctab"><tr><th></th>${head}</tr>${body}</table>`, foot: c.higher ? `Higher average: <b>${escH(c.higher)}</b>` : 'Same average' };
    }
    if (c.cols.length === 2) {
      const [A, B] = c.cols, priceOn = b.prices != null ? b.prices : items.some(it => /\$/.test(it.text));
      body = `<div class="cb-cvals">${c.cols.map((x, k) => `<div style="--c:${col(items[k].id)}"><em>${escH(x.name)}</em><b>${fmtC(x.value)}</b>${priceOn && c.prices ? `<small>${k ? 'price' : 'cost'}</small>` : ''}</div>`).join('<i>⇄</i>')}</div>
        <table class="cb-ctab"><tr><th>Difference</th><td><b>${sgn(c.diff)}</b> <small>${escH(B.name)} − ${escH(A.name)}</small></td></tr>
        <tr><th>% difference</th><td><b>${sgn(r2(c.pct), '%')}</b> <small>vs ${escH(A.name)}</small></td></tr>
        <tr><th>Ratio</th><td><b>${c.ratio == null ? '—' : fmtC(c.ratio) + '×'}</b> <small>${escH(B.name)} ÷ ${escH(A.name)}</small></td></tr>
        <tr><th>Higher</th><td>${c.higher ? `<b>${escH(c.higher)}</b> <small>by ${fmtC(Math.abs(c.diff))}</small>` : 'Equal'}</td></tr>
        ${priceOn && c.prices ? `<tr class="cb-cprice"><th>Cost → price</th><td>margin <b>${fmtC(r2(c.prices.margin))}%</b> · markup <b>${fmtC(r2(c.prices.markup))}%</b> · profit ${fmtC(c.prices.profit)}</td></tr>` : ''}</table>`;
      return { body, foot: '' };
    }
    const row = (lab, f) => `<tr><th>${lab}</th>${c.cols.map(f).join('')}</tr>`;
    body = row('Value', x => `<td><b>${fmtC(x.value)}</b></td>`) + row('vs base', (x, k) => `<td>${k ? sgn(x.diff) : '—'}</td>`) + row('% vs base', (x, k) => `<td>${k ? sgn(r2(x.pct), '%') : '—'}</td>`) + row('Rank', x => `<td>#${x.rank}</td>`);
    return { body: `<table class="cb-ctab"><tr><th></th>${head}</tr>${body}</table>`, foot: c.higher ? `Highest <b>${escH(c.higher)}</b> · lowest <b>${escH(c.lower)}</b> · spread ${fmtC(c.spread)}` : 'All equal' };
  }
  function renderOverlay() {
    const el = CB.el; if (!el) return;
    const usedBy = new Map(); for (const b of CB.board.blocks) for (const k in b.inputs) for (const id of b.inputs[k]) { if (!usedBy.has(id)) usedBy.set(id, []); usedBy.get(id).push(b.color); }
    let h = ''; const W8 = waitingSet(), manual = CB.mode === 'manual';
    for (const e of CB.board.exprs) {
      if (!e.bb) exprBB(e); const [x0, y0, x1, y1] = e.bb, cy = (y0 + y1) / 2, r = resHTML(e, manual && W8.get(e.id) || e.status === 'held');
      if (e.name) h += `<b class="cb-name" data-nid="${e.id}" style="left:${x0 - 14}px;top:${y0 - 18}px;--c:${e.color}">${escH(e.name)}${(usedBy.get(e.id) || []).map(c => `<i class="cb-dot" style="--c:${c}"></i>`).join('')}</b>`;
      if (e.typed) h += `<div class="cb-typed" data-eid="${e.id}" style="left:${x0}px;top:${y0}px;height:${y1 - y0}px" title="Typed by 🛰 Satellite — tap to edit">${escH(pretty(evalText(e.text).normalized || e.text))}</div>`;
      if (r.pend) { h += `<button class="cb-res pend" data-eid="${e.id}" style="left:${x1 + 10}px;top:${cy - 9}px" aria-label="Waiting for = Calculate — tap to calculate this one" title="Waiting for = Calculate"><i class="cb-pdot"></i></button>`; continue; }
      h += `<button class="cb-res ${r.cls}" data-eid="${e.id}" ${r.conf ? `data-conf="${r.conf}"` : ''} style="left:${x1 + 14}px;top:${cy - 21}px" aria-label="Result ${escH(r.main)} — tap to fix the formula${r.conf ? ' · ' + CONF_T[r.conf] : ''}" ${r.conf ? `title="${CONF_T[r.conf]}"` : ''}><small>${r.conf ? `<i class="cb-conf ${r.conf}" aria-hidden="true"><u></u><u></u><u></u></i>` : ''}${escH(r.sub)}</small><span>${escH(r.main)}</span></button>`;
      if (e.cands && e.cands.length > 1 && !r.pend) h += candsHTML(e, x1 + 14, cy + 26);
    }
    for (const b of CB.board.blocks) {
      const f = fnOf(b.fn) || { label: b.fn, inputs: [] }, r = val(b.id), wait = manual && W8.get(b.id);
      if (wait) { h += `<div class="cb-block pend" data-bid="${b.id}" style="left:${b.x}px;top:${b.y}px;--c:${b.color}" role="button" aria-label="${escH(f.label)} — waiting for = Calculate"><div class="cb-bh"><b class="cb-bname">${escH(b.name)}</b><span>${escH(b.label || f.label)}</span></div><div class="cb-bv"><i class="cb-pdot"></i> waiting for = Calculate</div><div class="cb-bi">${escH((Object.values(b.inputs || {}).flat()).map(id => (node(id) || {}).name || '?').join(' · '))}</div></div>`; continue; }
      if (b.fn === 'compare') {
        const cc = r.ok ? compareHTML(b, r) : null;
        h += `<div class="cb-block cb-cmp ${r.ok ? '' : 'err'}" data-bid="${b.id}" style="left:${b.x}px;top:${b.y}px;--c:${b.color}" role="button" aria-label="Compare ${escH((b.inputs.items || []).map(id => (node(id) || {}).name).join(' and '))}">
          <div class="cb-bh"><b class="cb-bname">${escH(b.name)}</b><span>⇄ Compare</span><span class="cb-cacts"><button data-cmp="swap" data-bid="${b.id}" title="Swap which one is the base">⇄ Swap</button>${r.ok && r.card.prices ? `<button data-cmp="price" data-bid="${b.id}" class="${(b.prices != null ? b.prices : r.items.some(it => /\$/.test(it.text))) ? 'on' : ''}" title="Treat as cost → price (margin & markup)">💲</button>` : ''}</span></div>
          ${r.ok ? cc.body + (cc.foot ? `<div class="cb-cfoot">${cc.foot}</div>` : '') : `<div class="cb-bv">⚠︎ ${escH(r.error || '')}</div>`}</div>`;
        continue;
      }
      const ins = f.inputs.map(i => i.param ? `${i.label} = ${paramLabel(i, b.params && b.params[i.k] != null ? b.params[i.k] : i.def)}` : `${i.label.replace(/ %$/, '%')} = ${(b.inputs[i.k] || []).map(id => (node(id) || {}).name || '?').join(', ') || '—'}`).filter(x => !/= —$/.test(x) || !f.inputs.find(i => x.startsWith(i.label) && i.optional)).join(' · ');
      h += `<div class="cb-block ${r.ok ? '' : 'err'}" data-bid="${b.id}" style="left:${b.x}px;top:${b.y}px;--c:${b.color}" role="button" aria-label="${escH(f.label)} result">
        <div class="cb-bh"><b class="cb-bname">${escH(b.name)}</b><span>${escH(b.label || f.label)}</span></div>
        <div class="cb-bv">${escH(r.ok ? r.display : '⚠︎ ' + (r.error || ''))}</div>
        ${r.ok && r.extra ? `<div class="cb-bx">${escH(r.extra)}</div>` : ''}
        <div class="cb-bf">${escH(f.formula || '')}</div><div class="cb-bi">${escH(ins)}</div></div>`;
    }
    for (const [i, id] of CB.sel.entries()) { const n = node(id); if (!n) continue; const bb = nodeBB(n); h += `<div class="cb-selbox" style="left:${bb[0] - 10}px;top:${bb[1] - 10}px;width:${bb[2] - bb[0] + 20}px;height:${bb[3] - bb[1] + 20}px;--c:${n.color || '#8b85ff'}"><i>${i + 1}${n.name ? ' · ' + escH(n.name) : ''}</i></div>`; }
    el.items.innerHTML = h;
    el.empty.hidden = !!(CB.board.strokes.length || CB.board.blocks.length);
    renderLinks(); renderSelbar(); draw(); syncCalcBtn(W8);
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
      const f = fnOf(b.fn); if (!f) continue; const tb = boxOf(b.id);
      const links = f.inputs.filter(i => !i.param).flatMap(i => (b.inputs[i.k] || []).map(id => [id, f.inputs.filter(x => !x.param).length > 1 ? i.label.replace(/ %$/, '%').toLowerCase() : '']));
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
      ${ns.length >= 2 ? '<button data-sa="compare" class="cb-sa-cmp">⇄ Compare</button>' : ''}${CB.mode === 'manual' ? '<button data-sa="calc" class="cb-sa-calc">= Calculate</button>' : ''}<button data-sa="sum">Σ Sum</button><button data-sa="average">x̄ Average</button><button data-sa="fns" aria-haspopup="menu">ƒ Functions ▾</button><button data-sa="name">🏷 Name</button><button data-sa="clear" aria-label="Clear selection">✕</button>`;
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
    if (a === 'compare') return createCompare(CB.sel.slice());
    if (a === 'calc') return calculate(CB.sel.slice());
  }
  const FN_IC = { margin: '📈', markup: '🏷', priceMarkup: '💲', priceMargin: '💲', pctChange: '↕︎', pctOf: '％', tax: '🧾', discount: '✂︎', sum: 'Σ', average: 'x̄', median: '◫', mode: '⌗', min: '↓', max: '↑', range: '↔︎', stdevS: 's', stdevP: 'σ', varS: 's²', varP: 'σ²', count: '#', wavg: '⚖︎',
    salesTax: '🧾', tip: '🍽', discountChain: '✂︎', profit: '💰', roi: '📊', costPerUnit: '÷', breakEven: '⚖︎', simpleInterest: '％', compound: '📈', loan: '🏦',
    percentile: 'P', quartiles: 'Q', iqr: 'IQR', zscore: 'z', correl: 'r', regression: '⟋', frequency: '▥',
    power: 'xʸ', sqrtFn: '√', log10Fn: 'log', lnFn: 'ln', expFn: 'eˣ', factorial: 'n!', ncr: 'C', npr: 'P', absFn: '|x|', roundFn: '≈', floorFn: '⌊⌋', ceilFn: '⌈⌉', modFn: 'mod', gcdFn: 'gcd', lcmFn: 'lcm', sinFn: 'sin', cosFn: 'cos', tanFn: 'tan', sciFn: '10ⁿ',
    linear: 'x', quadratic: 'x²', unitConvert: '⇆', sqft: 'ft²', linft: 'ft', glassCost: '🪟', diag: '⟋', compare: '⇄' };
  const FN_TABS = ['All', 'Business', 'Statistics', 'Math', 'Equations', 'Units & glass', '✍︎ Write it'];
  const WRITE_IT = [['log(1000)  ·  ln(e)  ·  log(8, 2)', 'logs'], ['sin 30°  ·  cos(π/3)  ·  tan 45', 'trig — DEG / RAD button'], ['5C2  ·  5P2  ·  6!', 'combinations, factorial'], ['17 mod 5  ·  gcd(12, 18)  ·  lcm(4, 6)', 'whole numbers'],
    ['|−5|  ·  round(2.345, 2)  ·  floor(2.7)', 'rounding'], ['6.02e23  ·  sci(123456)', 'scientific notation'], ['2x + 3 = 11  ·  x² − 5x + 6 = 0', 'solves for x'], ['12 ft to m  ·  5 ft 6 in to cm', 'length'],
    ['24×36 in to sq ft  ·  3.5 sq ft to m²', 'area — glass'], ['2 gal to L  ·  10 lb to kg', 'volume, weight'], ['loan(20000, 6, 5)  ·  compound(1000, 5, 10, 12)', 'money'], ['roi(100, 150)  ·  breakeven(500, 25, 15)', 'business'],
    ['tip(80, 18)  ·  salestax(100, 8.25)  ·  chain(100, 20, 10)', 'shopping'], ['percentile(A, 90)  ·  quartiles(A)  ·  zscore(7, A)', 'stats on a lassoed list'], ['correl(A, B)  ·  slope(A, B)', 'two lists'], ['sqft(24, 36)  ·  linft(24, 36, 4)', 'glass: inches → ft']];
  function renderFnList() {
    const m = CB.el.menu, list = m.querySelector('.cb-mlist'); if (!list) return;
    const q = (CB.fnQ || '').trim().toLowerCase(), tab = CB.fnTab;
    m.querySelectorAll('[data-ftab]').forEach(b => { b.classList.toggle('on', b.dataset.ftab === tab); b.setAttribute('aria-pressed', b.dataset.ftab === tab); });
    if (tab === '✍︎ Write it' && !q) { list.innerHTML = `<div class="cb-mg">Write these straight on the board</div>` + WRITE_IT.map(([t, d]) => `<div class="cb-wrow"><code>${escH(t)}</code><small>${escH(d)}</small></div>`).join(''); return; }
    const groups = {}; for (const f of [COMPARE_FN, ...CalcFns.list]) { if (tab !== 'All' && f.group !== tab && !(tab === 'Business' && f.group === 'Compare')) continue; if (q && !(f.label + ' ' + (f.formula || '') + ' ' + f.id + ' ' + f.group).toLowerCase().includes(q)) continue; (groups[f.group] = groups[f.group] || []).push(f); }
    list.innerHTML = Object.entries(groups).map(([g, fs]) => `<div class="cb-mg">${g}</div><div class="cb-mgrid">` +
      fs.map(f => `<button role="menuitem" data-fn="${f.id}" class="${f.id === 'compare' ? 'cb-mcmp' : ''}"><i>${FN_IC[f.id] || 'ƒ'}</i><span>${escH(f.label)}</span><small>${escH(f.formula || '')}</small></button>`).join('') + '</div>').join('') || '<div class="cb-mg">No match</div>';
  }
  function fnMenu(anchor) {
    const m = CB.el.menu; if (!m.hidden && CB.menu === 'fns') return closeMenu();
    m.innerHTML = `<div class="cb-mh">ƒ Functions${CB.sel.length ? ` · ${CB.sel.length} selected` : ' · pick inputs next'}<span class="cb-mcount">${CalcFns.list.length + 1} functions</span></div>
      <div class="cb-mtop"><input class="cb-fq" type="search" placeholder="Search — loan, sq ft, percentile…" aria-label="Search functions" value="${escH(CB.fnQ || '')}" autocomplete="off" autocorrect="off" spellcheck="false"></div>
      <div class="cb-mtabs" role="tablist">${FN_TABS.map(t => `<button data-ftab="${escH(t)}" role="tab">${escH(t)}</button>`).join('')}</div><div class="cb-mlist"></div>`;
    renderFnList();
    const sr = CB.el.stage.getBoundingClientRect(), ar = anchor.getBoundingClientRect(), mw = Math.min(600, sr.width - 16);
    const below = sr.bottom - ar.bottom, above = ar.top - sr.top, up = below < 320 && above > below;
    m.style.width = mw + 'px';
    m.style.left = Math.max(8, Math.min(sr.width - mw - 8, ar.left - sr.left)) + 'px';
    m.style.top = up ? '' : Math.max(4, ar.bottom - sr.top + 6) + 'px'; m.style.bottom = up ? (sr.bottom - ar.top + 6) + 'px' : '';
    m.style.maxHeight = Math.max(200, (up ? above : below) - 20) + 'px';
    m.hidden = false; CB.menu = 'fns';
  }
  function closeMenu() { if (CB.el) { CB.el.menu.hidden = true; CB.menu = null; } }
  function menuClick(e) {
    const t = e.target.closest('[data-ftab]'); if (t) { CB.fnTab = t.dataset.ftab; return renderFnList(); }
    const f = e.target.closest('[data-fn]'); if (f) { closeMenu(); if (f.dataset.fn === 'compare' && CB.sel.length >= 2) return createCompare(CB.sel.slice()); return assignSheet(f.dataset.fn); }
    const b = e.target.closest('[data-ba]'); if (!b) return; const id = CB.menu && CB.menu.bid; closeMenu(); const bl = node(id); if (!bl) return;
    if (b.dataset.ba === 'inputs') return assignSheet(bl.fn, bl);
    if (b.dataset.ba === 'rename') return renameSheet(bl);
    if (b.dataset.ba === 'swap') return cmpAct(bl, 'swap');
    if (b.dataset.ba === 'price') return cmpAct(bl, 'price');
    if (b.dataset.ba === 'del') { hist(); CB.board.blocks = CB.board.blocks.filter(x => x !== bl); CB.sel = CB.sel.filter(x => x !== id); recalc(); renderOverlay(); save(); toastc('Result deleted — ↶ Undo brings it back', 2200); }
  }
  function blockMenu(b, clientX, clientY) {
    const m = CB.el.menu, sr = CB.el.stage.getBoundingClientRect(), f = fnOf(b.fn); m.style.width = '';
    m.innerHTML = `<div class="cb-mh">${escH(b.name)} · ${escH(f ? f.label : '')}</div>${b.fn === 'compare' ? '<button data-ba="swap"><i>⇄</i><span>Swap the order</span></button><button data-ba="price"><i>💲</i><span>Cost → price on / off</span></button>' : ''}<button data-ba="inputs"><i>✎</i><span>Change inputs…</span></button><button data-ba="rename"><i>🏷</i><span>Rename…</span></button><button data-ba="del" class="danger"><i>🗑</i><span>Delete result</span></button>`;
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
    const multi = f.inputs.filter(i => i.multi && !i.param), single = f.inputs.filter(i => !i.multi && !i.param);
    if (multi.length === 1 && !single.length) out[multi[0].k] = ids.slice();
    else if (multi.length === 2) { const h = Math.ceil(ids.length / 2); out[multi[0].k] = ids.slice(0, h); out[multi[1].k] = ids.slice(h); }
    else single.forEach((i, k) => out[i.k] = ids[k] ? [ids[k]] : []);
    return out;
  }
  function assignSheet(fnId, edit) {
    const f = fnOf(fnId); if (!f) return;
    let cands = candidates(edit);
    if (edit) { const extra = Object.values(edit.inputs).flat().map(node).filter(n => n && !cands.includes(n)); cands = [...cands, ...extra]; }
    if (!cands.length) return toastc('◌ Lasso the numbers to use first, or write a few formulas', 2600);
    const cur = edit ? JSON.parse(JSON.stringify(edit.inputs)) : defaults(f, cands);
    const params = edit ? Object.assign({}, edit.params || {}) : {};
    const rows = f.inputs.map(i => i.param
      ? `<div class="cb-in"><label for="cbi-${i.k}">${escH(i.label)}</label><select id="cbi-${i.k}" data-k="${i.k}" data-param="1">${optsOf(i).map(([v, l]) => `<option value="${escH(v)}" ${String(params[i.k] != null ? params[i.k] : i.def) === String(v) ? 'selected' : ''}>${escH(l)}</option>`).join('')}</select></div>`
      : i.multi
      ? `<div class="cb-in"><label>${escH(i.label)}</label><div class="cb-checks" data-k="${i.k}">${cands.map(n => `<label class="cb-ck" style="--c:${n.color || '#8b85ff'}"><input type="checkbox" value="${n.id}" ${(cur[i.k] || []).includes(n.id) ? 'checked' : ''}><span>${escH(candLabel(n))}</span></label>`).join('')}</div></div>`
      : `<div class="cb-in"><label for="cbi-${i.k}">${escH(i.label)}</label><select id="cbi-${i.k}" data-k="${i.k}"><option value="">${i.optional ? '— none (optional) —' : '— pick —'}</option>${cands.map(n => `<option value="${n.id}" ${(cur[i.k] || [])[0] === n.id ? 'selected' : ''}>${escH(candLabel(n))}</option>`).join('')}</select></div>`).join('');
    openSheet(`<h3><i>${FN_IC[f.id] || 'ƒ'}</i> ${escH(f.label)}</h3><p class="cb-formula">${escH(f.short)} = ${escH(f.formula || '')}</p>${rows}
      <div class="cb-preview" aria-live="polite"></div>
      <div class="cb-acts"><button class="btn" data-sh="cancel">Cancel</button><button class="btn primary" data-sh="ok">${edit ? 'Update result' : 'Add result'}</button></div>`);
    const sh = CB.el.sheet;
    const read = () => { const o = {}; for (const i of f.inputs) { if (i.param) continue; if (i.multi) o[i.k] = [...sh.querySelectorAll(`[data-k="${i.k}"] input:checked`)].map(x => x.value); else { const v = sh.querySelector(`select[data-k="${i.k}"]`).value; o[i.k] = v ? [v] : []; } } return o; };
    const readP = () => { const o = {}; for (const i of f.inputs) if (i.param) { const v = sh.querySelector(`select[data-k="${i.k}"]`).value; o[i.k] = typeof i.def === 'number' ? +v : v; } return o; };
    const preview = () => { const tmp = { id: '__tmp', fn: f.id, inputs: read(), params: readP(), x: 0, y: 0 }; CB.board.blocks.push(tmp); recalc(); const r = val('__tmp'); CB.board.blocks.pop(); recalc(); sh.querySelector('.cb-preview').innerHTML = r.ok ? `<b>${escH(f.short)}: ${escH(r.display)}</b>${r.extra ? ` <small>${escH(r.extra)}</small>` : ''}` : `<span class="err">⚠︎ ${escH(r.error)}</span>`; };
    sh.onchange = preview; preview();
    sh.onclick = e => {
      const b = e.target.closest('[data-sh]'); if (!b) return;
      if (b.dataset.sh === 'cancel') return closeSheet();
      const inputs = read(), ps = readP(); closeSheet();
      if (edit) { hist(); edit.inputs = inputs; edit.params = ps; recalc(); renderOverlay(); save(); return; }
      createBlock(f.id, inputs, { params: ps });
    };
  }
  const optsOf = i => typeof i.options === 'function' ? i.options() : i.options || [];
  const paramLabel = (i, v) => { const o = optsOf(i).find(([x]) => String(x) === String(v)); return o ? o[1].split(' · ')[0] : String(v); };
  function createBlock(fnId, inputs, opts = {}) {
    const f = fnOf(fnId); if (!f) return null;
    const srcIds = [...new Set(Object.values(inputs).flat())]; if (!srcIds.length) { toastc('Pick at least one input'); return null; }
    hist();
    for (const id of srcIds) { const n = node(id); if (n) ensureName(n); }
    const bbs = srcIds.map(node).filter(Boolean).map(nodeBB), u = union(bbs);
    const v = V(), visR = CB.el ? (CB.el.stage.clientWidth - v.x) / v.z - 16 : Infinity;
    const b = { id: uidc('b'), fn: fnId, inputs, name: nextName(), color: nextColor(), label: f.label, x: u[2] + 90, y: (u[1] + u[3]) / 2 - 50 };
    if (opts.params && Object.keys(opts.params).length) b.params = opts.params;
    if (CB.mode === 'manual') b.pend = true;
    const bw = fnId === 'compare' ? 330 : 200;
    if (b.x + bw - 20 > visR) { b.x = Math.max(u[0], Math.min(u[2] - bw, visR - bw - 10)); b.y = u[3] + 70; }   // no room on the right → below the sources
    if (opts.x != null) b.x = opts.x; if (opts.y != null) b.y = opts.y;
    const bh = fnId === 'compare' ? 200 : 120;
    const hit = () => CB.board.blocks.some(o => { const ob = nodeBB(o); return b.x < ob[2] + 16 && b.x + bw > ob[0] - 16 && b.y < ob[3] + 16 && b.y + bh > ob[1] - 16; }) ||
      CB.board.exprs.some(e => { const eb = nodeBB(e); return b.x < eb[2] + 10 && b.x + bw > eb[0] - 10 && b.y < eb[3] + 10 && b.y + bh > eb[1] - 10; });
    for (let k = 0; k < 30 && hit(); k++) b.y += 40;
    CB.board.blocks.push(b); CB.sel = []; closeMenu(); recalc(); renderOverlay(); save();
    const r = val(b.id); toastc(b.pend ? `${b.name} · ${f.label} — waiting for = Calculate` : `${b.name} · ${f.label}: ${r.ok ? r.display : '⚠︎ ' + r.error}`, 2200);
    return b;
  }
  /* ⇄ Compare: one tap, roles from lasso order (first = base / cost), linked + recalculating */
  function createCompare(ids) {
    const ns = ids.map(node).filter(Boolean); if (ns.length < 2) { toastc('◌ Lasso two or more areas to compare', 2200); return null; }
    return createBlock('compare', { items: ns.map(n => n.id) });
  }
  function cmpAct(b, act) {
    if (!b || b.fn !== 'compare') return; hist();
    if (act === 'swap') { const it = b.inputs.items || []; b.inputs.items = it.length === 2 ? [it[1], it[0]] : [...it.slice(1), it[0]]; }
    if (act === 'price') { const r = val(b.id), auto = r.ok && r.items.some(x => /\$/.test(x.text)); b.prices = !(b.prices != null ? b.prices : auto); }
    recalc(); renderOverlay(); save();
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
      hist(); const nt = inp.value.trim(); if (CB.bias && e.raw && nt && nt !== e.raw && !e.typed) CB.bias.learn(e.raw, nt, null);
      e.text = nt; e.fixed = true; e.cands = null; e.conf = 1; e.pend = false; e.status = e.text ? 'ok' : 'empty'; adoptAssignName(e); closeSheet(); recalc(); renderOverlay(); save();
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
    if (e.target.closest('.cb-selbar, .cb-menu, .cb-fab')) return;
    const btn = e.target.closest('[data-cmp], [data-pick]');
    if (btn) { e.preventDefault(); CB.g = { type: 'btn', pid: e.pointerId, el: btn, x0: e.clientX, y0: e.clientY }; try { el.stage.setPointerCapture(e.pointerId); } catch (_) {} return; }
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
    if (g.type === 'block') { if (g.moved) { renderOverlay(); save(); } else if (!cancel) { const bl = node(g.id); if (bl && CB.mode === 'manual' && waitingSet().get(bl.id)) return calculate([bl.id]); blockMenu(bl, e.clientX, e.clientY); } return; }
    if (g.type === 'btn') { if (cancel || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 12) return; const d = g.el.dataset;
      if (d.cmp) return cmpAct(node(d.bid), d.cmp);
      if (d.pick != null) { const ex = node(d.eid); return ex && pickCand(ex, +d.pick); } return; }
    if (g.type === 'tap') { if (cancel || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 10) return; const ex = node(g.id); if (!ex) return;
      if (CB.tool !== 'lasso' && (ex.status === 'held' || (CB.mode === 'manual' && waitingSet().get(ex.id)))) return calculate([ex.id]);
      if (CB.tool === 'lasso') { CB.sel = CB.sel.includes(ex.id) ? CB.sel.filter(x => x !== ex.id) : [...CB.sel, ex.id]; if (ensureName(ex)) save(); renderOverlay(); return; }
      return fixSheet(ex); }
    if (g.type === 'draw') {
      if (cancel) return abortStroke();
      sbb(g.s); g.s.bb = bboxOf(g.s.points); CB.pending.add(g.s.id); draw();
      schedule(looksLikeEquals(g.s) ? EQUALS_MS : PAUSE_MS); save(); return;
    }
    if (g.type === 'erase') { draw(); if (g.hit.size) { const touched = CB.board.exprs.filter(x => x.sids.some(id => g.hit.has(id))); for (const x of touched) { x.sids = x.sids.filter(id => !g.hit.has(id)); if (!x.sids.length) CB.board.exprs = CB.board.exprs.filter(y => y !== x); else { exprBB(x); if (CB.mode === 'manual') hold(x); else recognize(x); } } for (const id of g.hit) CB.pending.delete(id); CB.sel = CB.sel.filter(node); recalc(); renderOverlay(); save(); } return; }
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

  /* ---------- ⚡ Auto / ✋ Manual (= Calculate) and DEG / RAD ---------- */
  function syncMode() {
    if (!CB.el) return; const host = CB.el.host; host.dataset.cbmode = CB.mode;
    host.querySelectorAll('[data-cb="auto"], [data-cb="manual"]').forEach(b => { const on = b.dataset.cb === CB.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const a = host.querySelector('[data-cb="angle"]'); if (a) { a.textContent = CB.angle.toUpperCase(); a.setAttribute('aria-label', `Angles in ${CB.angle === 'deg' ? 'degrees' : 'radians'} — tap to switch`); }
    setTool(CB.tool);
  }
  function syncCalcBtn(W8) {
    if (!CB.el) return; const manual = CB.mode === 'manual', w = W8 || waitingSet();
    const n = [...w.entries()].filter(([id, v]) => v && node(id)).length, sel = CB.sel.length;
    for (const b of [CB.el.fab, CB.el.calcBtn]) { b.hidden = !manual; b.classList.toggle('has', n > 0); b.classList.toggle('busy', CB.busy > 0); }
    CB.el.host.querySelectorAll('.cb-calcn').forEach(x => { x.textContent = n ? String(n) : ''; });
    const lab = CB.el.fab.querySelector('span'); if (lab) lab.textContent = sel ? `Calculate ${sel} selected` : 'Calculate';
    CB.el.fab.setAttribute('aria-label', sel ? `Calculate the ${sel} selected areas` : `Calculate everything on the board (${n} waiting)`);
  }
  function setMode(m) {
    m = m === 'manual' ? 'manual' : 'auto'; if (m === CB.mode) return syncMode();
    CB.mode = m; LS.set('cbCalcMode', m); syncMode();
    if (m === 'auto') { calculate(null, { quiet: true }); toastc('⚡ Auto — answers appear as you write', 1800); }
    else { renderOverlay(); toastc('✋ Manual — write it all, then tap = Calculate', 2200); }
  }
  function setAngle(a) { CB.angle = a === 'rad' ? 'rad' : 'deg'; LS.set('cbAngle', CB.angle); CalcMath.setAngle(CB.angle); syncMode(); recalc(); renderOverlay(); toastc(CB.angle === 'deg' ? 'Trig in degrees (sin 90 = 1)' : 'Trig in radians (sin(π/2) = 1)', 1600); }
  function closure(ids) {      // the picked areas + everything they read from (so a linked card is calculated with its sources)
    const out = new Set(), add = id => { if (out.has(id)) return; const n = node(id); if (!n) return; out.add(id);
      if (n.fn) Object.values(n.inputs || {}).flat().forEach(add);
      else { const v = val(n.id); (v.refs || []).forEach(nm => { const m = named().find(o => o.name === nm); if (m) add(m.id); }); } };
    ids.forEach(add); return out;
  }
  async function calculate(ids, opts = {}) {
    flushPending();                                             // ink still waiting for the pause
    const scope = ids && ids.length ? closure(ids) : new Set([...CB.board.exprs, ...CB.board.blocks].map(n => n.id));
    const toRead = CB.board.exprs.filter(e => scope.has(e.id) && (e.status === 'held' || e.status === 'reading'));
    if (toRead.length) { syncCalcBtn(); await Promise.all(toRead.map(e => recognize(e))); }
    const again = ids && ids.length ? closure(ids) : scope;        // names may have been read just now
    let k = 0; for (const n of [...CB.board.exprs, ...CB.board.blocks]) if (again.has(n.id) && (n.pend || n.status === 'held')) { n.pend = false; if (n.status === 'held') n.status = n.text ? 'ok' : 'empty'; k++; }
    recalc(); renderOverlay(); save();
    if (!opts.quiet) toastc(k ? `= Calculated ${k} ${ids && ids.length ? 'selected ' : ''}item${k === 1 ? '' : 's'}` : 'Everything is already calculated', 1600);
    return k;
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
    version: 'v21ef', state: CB, setMode, calculate, setAngle, compare: ids => createCompare(ids), pick: (id, k) => { const e = node(id); if (e) pickCand(e, k); },
    setReaders(r) { CB.readers = r; }, get bias() { return CB.bias; }, _grokRead: grokRead, recalc, render, flush: () => flushPending(), save: () => save(true), load, undo, redo, setTool, fit: () => fit(), fitTo: ids => fit(ids), createBlock, assignSheet,
    addTyped, setRecognizer(fn) { CB.recog = fn; }, _defaultRecognize: defaultRecognize, open() { const qo = G('qbOpen'); if (qo) qo(true, { mode: 'calc' }); },
    worldToClient(x, y) { const r = CB.el.stage.getBoundingClientRect(), v = V(); return [r.left + v.x + x * v.z, r.top + v.y + y * v.z]; },
    async reset() { CB.board = emptyBoard(); CB.undo = []; CB.redo = []; CB.sel = []; CB.pending.clear(); recalc(); await save(true); if (isOpen()) render(); },
    value(name) { const n = named().find(x => x.name === name); return n ? val(n.id) : null; },
  };
  root.CalcBoard = CalcBoard;
  const boot = () => { try { integrate(); } catch (e) { console.warn('Calculator Board integrate failed', e); } load(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
