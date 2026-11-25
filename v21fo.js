/* Pencil Notes v21fo — Idea Board productivity
   1. PDF viewer on the board: select an area → Clip to board (image card, 2× render) / Text card / Copy text
      (pdf.js text layer only — never OCR). Clip & text cards link back to the source page with a highlight.
      Clip cards: Save image, Add to note.
   2. Frames: Make note (reading order, regular lined note) + "Open note" link on the frame.
   3. Sticky notes: Add to To-Do (today's Daily To-Do) and Remind me… (existing reminder sheet), ✓ / ⏰ badges.
   4. Pros / Cons template (Insert menu) — a frame with two coloured columns and "+ note" buttons.
   Storage is additions-only: new assets via Assets.put, hidden refs on the board page; nothing is deleted. */
(function () {
  'use strict';
  const VERSION = 'v21fo';
  const FM = () => window.V21fm;
  const FN = () => window.V21fn;
  const EXT = window.V21fmExt || (window.V21fmExt = {});
  const newId = p => (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9));
  const FONT = '-apple-system, system-ui, sans-serif';
  const say = (m, ms) => { try { toast(m, ms || 2400); } catch (_) {} };
  const sayAct = (m, label, fn, ms) => { try { if (typeof actionToast === 'function') return actionToast(m, label, fn, ms || 5000); } catch (_) {} say(m, ms); };
  const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ideaPage = () => { const n = typeof ideaNote === 'function' ? ideaNote() : null; return n && n.pages && n.pages[0]; };
  const dayKey = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const shortDate = (d = new Date()) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });

  /* ---------------- changelog ---------------- */
  const ENTRY = { v: VERSION, d: 'Nov 2026', items: [
    'PDF clips: open a PDF on the Idea Board, tap ✂︎ Select and drag over a picture or passage, then Clip to board. Tap a clip to jump back to its page.',
    'Copy text from a PDF selection, or make a Text card that links back to its page. Scanned pages have no text to copy.',
    'Clip cards: Save image, or Add to note to put the picture in any note.',
    'Frames: tap a frame’s label, then Make note to turn its contents into a regular note. An “Open note” link appears on the frame.',
    'Sticky notes: Add to To-Do puts one on today’s Daily To-Do, and Remind me… sets a reminder. A ✓ or ⏰ badge shows on the note.',
    'New Pros / Cons template under Insert, with green and red columns and + note buttons.'
  ] };
  function addChangelog() { const fn = FN(); if (fn && Array.isArray(fn.CHANGELOG) && !fn.CHANGELOG.some(c => c.v === VERSION)) fn.CHANGELOG.unshift(ENTRY); }
  addChangelog();

  /* ---------------- shared helpers ---------------- */
  function addRefs(ids) {
    const pg = ideaPage(); if (!pg) return;
    pg.images = pg.images || [];
    for (const id of ids.filter(Boolean)) if (!pg.images.some(im => im && im.asset === id)) pg.images.push({ id: newId('im'), kind: 'pdfsource', fm: 1, hidden: 1, asset: id, x: 0, y: 0, w: 0, h: 0 });
  }
  const toBlob = (c, type = 'image/jpeg', q = 0.9) => new Promise(r => c.toBlob(r, type, q));
  async function decodeImage(blob) {
    if (self.createImageBitmap) { try { return await createImageBitmap(blob); } catch (_) {} }
    const url = URL.createObjectURL(blob);
    try { const im = new Image(); im.src = url; await im.decode(); return im; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const loading = new Map();
  function img(id) {
    const fn = FN(); const cache = fn && fn.thumbs; if (!id || !cache) return null;
    if (cache.has(id)) return cache.get(id);
    if (!loading.has(id)) loading.set(id, (async () => {
      let bm = null; try { const b = await Assets.blob(id); if (b) bm = await decodeImage(b); } catch (err) { console.warn('v21fo img', err); }
      cache.set(id, bm); loading.delete(id);
      const fm = FM(); if (fm && fm.isOpen()) { for (const n of fm.model().notes) if (n.media && (n.media.asset === id || n.media.thumb === id)) fm.invalidateNote(n.id); fm.paintAll(); }
    })());
    return undefined;
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fitText(ctx, t, maxW) { t = String(t || ''); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
  function wrapLines(ctx, text, maxW, maxLines) {
    const out = [];
    for (const para of String(text || '').split(/\n/)) {
      let cur = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const nx = cur ? cur + ' ' + w : w;
        if (ctx.measureText(nx).width > maxW && cur) { out.push(cur); cur = w; } else cur = nx;
      }
      out.push(cur);
    }
    if (maxLines && out.length > maxLines) { const k = out.slice(0, maxLines); k[maxLines - 1] = fitText(ctx, k[maxLines - 1] + ' …', maxW); return k; }
    return out;
  }
  function measureCtx() { const c = measureCtx.c || (measureCtx.c = document.createElement('canvas').getContext('2d')); return c; }
  async function shareOrSave(blob, name) {
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
    const sa = (() => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; } })();
    if (sa && file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return 'share'; } catch (_) { return 'cancel'; } }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); return 'download';
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (_) {}
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (_) { return false; }
  }
  const nameOf = m => String(m.name || m.title || 'Document').replace(/\.pdf$/i, '');

  /* ============================== 1. PDF viewer, clips, text ============================== */
  const V = { el: null, doc: null, pdfjs: null, src: null, name: '', card: null, pages: [], sel: null, selMode: false, io: null, cssW: 0, flashT: 0 };
  function viewerEl() {
    if (V.el) return V.el;
    const el = document.createElement('div'); el.id = 'foPdf'; el.hidden = true;
    el.innerHTML = '<div class="fo-bar"><button type="button" data-v="close" aria-label="Close PDF">✕ Close</button><div class="fo-ttl"><b></b><small></small></div>' +
      '<button type="button" data-v="sel" class="fo-selbtn" aria-pressed="false">✂︎ Select</button><button type="button" data-v="share">Share</button></div>' +
      '<div class="fo-hint" hidden>Drag over a picture or passage with your Pencil or finger</div>' +
      '<div class="fo-body"><div class="fo-pages"></div></div>' +
      '<div class="fo-pop" hidden><button type="button" data-v="clip" class="primary">✂︎ Clip to board</button><button type="button" data-v="tcard">Aa Text card</button><button type="button" data-v="copy">Copy text</button><button type="button" data-v="cancel" aria-label="Cancel selection">✕</button></div>';
    document.body.append(el); V.el = el;
    el.querySelector('.fo-bar').addEventListener('click', ev => {
      const b = ev.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === 'close') closeViewer();
      else if (b.dataset.v === 'sel') setSelMode(!V.selMode);
      else if (b.dataset.v === 'share') sharePdf();
    });
    el.querySelector('.fo-pop').addEventListener('click', ev => {
      const b = ev.target.closest('[data-v]'); if (!b || !V.sel) return;
      const s = V.sel;
      if (b.dataset.v === 'cancel') return clearSel();
      if (b.dataset.v === 'clip') return busy(b, clipToBoard(s.page, s.rect));
      if (b.dataset.v === 'tcard') return busy(b, textCard(s.page, s.rect));
      if (b.dataset.v === 'copy') return busy(b, copySel(s.page, s.rect));
    });
    const body = el.querySelector('.fo-body');
    body.addEventListener('pointerdown', selDown);
    body.addEventListener('pointermove', selMove);
    body.addEventListener('pointerup', selUp);
    body.addEventListener('pointercancel', selUp);
    body.addEventListener('scroll', () => { updateTitle(); placePop(); }, { passive: true });
    window.addEventListener('resize', () => { if (!el.hidden) layoutPages(); });
    return el;
  }
  async function busy(btn, p) { btn.disabled = true; try { await p; } catch (err) { console.warn('v21fo', err); say('Something went wrong — try again'); } finally { btn.disabled = false; } }
  function setSelMode(on) {
    V.selMode = !!on; const el = viewerEl();
    el.classList.toggle('fo-selecting', V.selMode);
    const b = el.querySelector('.fo-selbtn'); b.setAttribute('aria-pressed', String(V.selMode)); b.classList.toggle('on', V.selMode);
    el.querySelector('.fo-hint').hidden = !V.selMode;
    if (!V.selMode) clearSel();
  }
  async function openViewer(assetId, opt = {}) {
    if (!assetId) return;
    const blob = await Assets.blob(assetId); if (!blob) { say('PDF not found on this iPad', 2000); return; }
    const el = viewerEl();
    closeDoc();
    V.src = assetId; V.name = opt.name || 'Document.pdf'; V.card = opt.card || null; V.blob = blob;
    el.querySelector('.fo-ttl b').textContent = nameOf({ name: V.name });
    el.hidden = false; document.body.classList.add('fo-pdf-open');
    setSelMode(!!opt.select);
    const pagesEl = el.querySelector('.fo-pages'); pagesEl.innerHTML = '<div class="fo-loading">Opening PDF…</div>';
    try {
      V.pdfjs = await loadPdfjs();
      V.doc = await V.pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    } catch (err) { console.warn('v21fo pdf', err); pagesEl.innerHTML = '<div class="fo-loading">Could not open this PDF</div>'; return; }
    const n = V.doc.numPages; V.pages = [];
    pagesEl.innerHTML = '';
    for (let i = 1; i <= n; i++) {
      const pg = await V.doc.getPage(i), vp = pg.getViewport({ scale: 1 });
      const d = document.createElement('div'); d.className = 'fo-pg'; d.dataset.p = i;
      d.innerHTML = '<canvas></canvas><span class="fo-pnum">' + i + '</span>';
      pagesEl.append(d);
      V.pages.push({ i, el: d, w: vp.width, h: vp.height, page: pg, done: 0 });
    }
    layoutPages();
    V.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(+e.target.dataset.p); }), { root: el.querySelector('.fo-body'), rootMargin: '800px 0px' });
    V.pages.forEach(p => V.io.observe(p.el));
    const page = Math.min(n, Math.max(1, opt.page || 1));
    await renderPage(page);
    goTo(page, opt.rect, !!opt.flash);
    updateTitle();
  }
  function layoutPages() {
    const body = V.el.querySelector('.fo-body');
    V.cssW = Math.min(900, Math.max(280, body.clientWidth - 32));
    for (const p of V.pages) {
      const h = V.cssW * p.h / p.w;
      p.el.style.width = V.cssW + 'px'; p.el.style.height = Math.round(h) + 'px';
      if (p.done && Math.abs(p.done - V.cssW) > 4) { p.done = 0; renderPage(p.i); }
    }
  }
  async function renderPage(i) {
    const p = V.pages[i - 1]; if (!p || p.done === V.cssW || p.rendering) return;
    p.rendering = true;
    try {
      const dpr = Math.min(2, window.devicePixelRatio || 1), k = V.cssW / p.w * dpr;
      const vp = p.page.getViewport({ scale: k }), cv = p.el.querySelector('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
      p.done = V.cssW;
    } catch (err) { console.warn('v21fo render', err); } finally { p.rendering = false; }
  }
  function goTo(i, rect, flash) {
    const p = V.pages[i - 1]; if (!p) return;
    const body = V.el.querySelector('.fo-body');
    const ph = p.el.offsetHeight;
    let top = p.el.offsetTop - 12;
    if (rect) top = p.el.offsetTop + (rect[1] + rect[3] / 2) * ph - body.clientHeight / 2;
    body.scrollTop = Math.max(0, top);
    if (rect && flash) {
      p.el.querySelectorAll('.fo-flash').forEach(x => x.remove());
      const f = document.createElement('div'); f.className = 'fo-flash';
      Object.assign(f.style, { left: rect[0] * 100 + '%', top: rect[1] * 100 + '%', width: rect[2] * 100 + '%', height: rect[3] * 100 + '%' });
      p.el.append(f); clearTimeout(V.flashT); V.flashT = setTimeout(() => f.classList.add('fo-fade'), 2200);
      setTimeout(() => f.remove(), 3400);
    }
  }
  function curPage() {
    const body = V.el.querySelector('.fo-body'), mid = body.scrollTop + body.clientHeight / 3;
    let best = 1; for (const p of V.pages) if (p.el.offsetTop <= mid) best = p.i; return best;
  }
  function updateTitle() { if (!V.el || !V.pages.length) return; V.el.querySelector('.fo-ttl small').textContent = 'Page ' + curPage() + ' of ' + V.pages.length; }
  function closeDoc() {
    if (V.io) { try { V.io.disconnect(); } catch (_) {} V.io = null; }
    if (V.doc) { try { V.doc.destroy(); } catch (_) {} V.doc = null; }
    V.pages = []; V.sel = null;
  }
  function closeViewer() {
    if (!V.el) return; clearSel(); closeDoc();
    V.el.hidden = true; V.el.querySelector('.fo-pages').innerHTML = ''; document.body.classList.remove('fo-pdf-open');
    const fm = FM(); if (fm && fm.isOpen()) fm.paintAll();
  }
  function sharePdf() { if (V.blob) shareOrSave(new Blob([V.blob], { type: 'application/pdf' }), V.name || 'Document.pdf'); }

  // ---- area selection ----
  let drag = null;
  function pageFromEvent(e) { const d = e.target.closest && e.target.closest('.fo-pg'); return d ? V.pages[+d.dataset.p - 1] : null; }
  function norm(p, e) { const r = p.el.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; }
  function selDown(e) {
    if (e.target.closest('.fo-pop')) return;
    const p = pageFromEvent(e); if (!p) return;
    if (!(V.selMode || e.pointerType === 'pen')) return;
    e.preventDefault(); clearSel();
    drag = { p, a: norm(p, e), b: norm(p, e), id: e.pointerId };
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    showBox(p, drag.a, drag.b);
  }
  function selMove(e) { if (!drag || e.pointerId !== drag.id) return; e.preventDefault(); drag.b = norm(drag.p, e); showBox(drag.p, drag.a, drag.b); }
  function selUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    const x = Math.min(d.a[0], d.b[0]), y = Math.min(d.a[1], d.b[1]), w = Math.abs(d.a[0] - d.b[0]), h = Math.abs(d.a[1] - d.b[1]);
    const r = d.p.el.getBoundingClientRect();
    if (w * r.width < 14 || h * r.height < 14) { clearSel(); return; }
    V.sel = { page: d.p.i, rect: [x, y, w, h] };
    placePop();
  }
  function showBox(p, a, b) {
    let box = p.el.querySelector('.fo-sel'); if (!box) { box = document.createElement('div'); box.className = 'fo-sel'; p.el.append(box); }
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
    Object.assign(box.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: h * 100 + '%' });
  }
  function clearSel() { if (!V.el) return; V.el.querySelectorAll('.fo-sel').forEach(x => x.remove()); V.sel = null; V.el.querySelector('.fo-pop').hidden = true; }
  function chromeBottom() {
    const bar = V.el.querySelector('.fo-bar').getBoundingClientRect();
    const hint = V.el.querySelector('.fo-hint');
    let t = bar.bottom;
    if (hint && !hint.hidden) t = Math.max(t, hint.getBoundingClientRect().bottom);
    return t;
  }
  function placePop() {
    const pop = V.el && V.el.querySelector('.fo-pop'); if (!pop) return;
    if (!V.sel) { pop.hidden = true; return; }
    const p = V.pages[V.sel.page - 1], box = p && p.el.querySelector('.fo-sel'); if (!box) { pop.hidden = true; return; }
    pop.hidden = false;
    const r = box.getBoundingClientRect();
    const GAP = 36;   // clear the next line of text, then a little air
    const PAD = 10, pw = pop.offsetWidth, ph = pop.offsetHeight, vw = innerWidth, vh = innerHeight;
    const topBound = chromeBottom() + 8, botBound = vh - PAD;
    let x = Math.min(vw - pw - PAD, Math.max(PAD, r.left + r.width / 2 - pw / 2));
    const below = r.bottom + GAP, above = r.top - ph - GAP;
    let y;
    if (below + ph <= botBound && below >= topBound) y = below;
    else if (above >= topBound && above + ph <= botBound) y = above;
    else if (r.bottom + GAP + Math.min(ph, 20) <= botBound) y = Math.min(botBound - ph, below);
    else if (r.top - GAP >= topBound + 20) y = Math.max(topBound, above);
    else {
      // tight vertically: sit beside the selection so we never cover it or the next line
      const right = r.right + GAP, left = r.left - pw - GAP;
      if (right + pw <= vw - PAD) x = right;
      else if (left >= PAD) x = left;
      y = Math.min(botBound - ph, Math.max(topBound, r.top + r.height / 2 - ph / 2));
    }
    pop.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  // ---- render a crop at good resolution (≥ 2× what you see, ≥ 2× PDF points) ----
  async function renderCrop(pi, rect) {
    const p = V.pages[pi - 1]; const W = p.w, H = p.h;
    const cw = rect[2] * W, ch = rect[3] * H;
    let k = Math.max(2, 2 * V.cssW / W);
    k = Math.min(k, 2400 / Math.max(cw, ch)); k = Math.max(k, 1);
    const vp = p.page.getViewport({ scale: k, offsetX: -rect[0] * W * k, offsetY: -rect[1] * H * k });
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }
  // ---- text layer (embedded text only; never OCR) ----
  async function textIn(pi, rect) {
    const p = V.pages[pi - 1]; const tc = await p.page.getTextContent(); const vp = p.page.getViewport({ scale: 1 });
    const X0 = rect[0] * p.w, Y0 = rect[1] * p.h, X1 = X0 + rect[2] * p.w, Y1 = Y0 + rect[3] * p.h;
    const items = [];
    for (const it of tc.items || []) {
      if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
      const t = V.pdfjs.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(t[2], t[3]) || 10, x = t[4], y = t[5], w = it.width || fh * it.str.length * 0.5;
      const cx = x + w / 2, cy = y - fh * 0.35;
      if (cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1) items.push({ s: it.str, x, y, w, fh });
    }
    if (!items.length) return '';
    items.sort((a, b) => Math.abs(a.y - b.y) > Math.min(a.fh, b.fh) * 0.5 ? a.y - b.y : a.x - b.x);
    const lines = []; let line = null;
    for (const it of items) {
      if (!line || Math.abs(it.y - line.y) > it.fh * 0.5) { line = { y: it.y, fh: it.fh, parts: [it] }; lines.push(line); }
      else line.parts.push(it);
    }
    let out = '';
    lines.forEach((l, li) => {
      let s = '';
      l.parts.forEach((it, i) => { if (i) { const pr = l.parts[i - 1]; const gap = it.x - (pr.x + pr.w); if (gap > it.fh * 0.15 && !/\s$/.test(s) && !/^\s/.test(it.s)) s += ' '; } s += it.s; });
      s = s.replace(/\s+/g, ' ').trim();
      if (li) { const prev = lines[li - 1]; out += (l.y - prev.y > prev.fh * 1.9) ? '\n\n' : (/-$/.test(out) ? '' : ' '); if (/-$/.test(out) && !(l.y - prev.y > prev.fh * 1.9)) out = out.slice(0, -1); }
      out += s;
    });
    return out.trim();
  }
  const NO_TEXT = 'No text in this area (scanned page)';
  async function copySel(pi, rect) {
    const t = await textIn(pi, rect);
    if (!t) { say(NO_TEXT, 2600); return ''; }
    const ok = await copyText(t);
    say(ok ? '📋 Copied ' + t.split(/\s+/).length + ' words' : 'Could not copy — try again', 2000);
    return t;
  }
  function srcCard() { const fm = FM(); return V.card && fm ? fm.model().notes.find(n => n.id === V.card) : null; }
  function spotNear(w, h) {
    const fm = FM(), src = srcCard(); const fmm = fm.model();
    const kids = fmm.notes.filter(n => n.media && n.media.src === V.src).length;
    if (src) return { x: Math.round(src.x + src.w + 40 + (kids % 3) * 24), y: Math.round(src.y + (kids % 6) * 36) };
    const vb = fm.viewBox(); return { x: Math.round(vb.x + vb.w / 2 - w / 2 + (kids % 5) * 24), y: Math.round(vb.y + vb.h / 2 - h / 2 + (kids % 5) * 24) };
  }
  function addCard(kind, media, w, h) {
    const fm = FM(); if (!fm) return null;
    fm.pushUndo();
    const at = spotNear(w, h);
    const n = fm.addNote({ x: at.x, y: at.y, w: Math.round(w), h: Math.round(h), color: 'yellow', title: '' });
    n.kind = kind; n.media = media; n.color = 'none';
    const f = fm.frameOf ? fm.frameOf(srcCard() || {}) : null;
    if (f && f.members && !f.members.includes(n.id)) f.members.push(n.id);
    fm.invalidateNote(n.id); fm.select(n.id); fm.scheduleSave(); fm.paintAll();
    return n;
  }
  const FOOT = 24;
  async function clipToBoard(pi, rect) {
    const c = await renderCrop(pi, rect);
    const blob = await toBlob(c, 'image/jpeg', 0.9);
    const aid = await Assets.put(blob);
    addRefs([aid, V.src]);
    const fn = FN(); if (fn && fn.thumbs) fn.thumbs.set(aid, await decodeImage(blob));
    const asp = c.width / c.height, w = asp >= 1 ? 300 : Math.max(170, 300 * asp), ih = Math.min(380, (w - 10) / asp);
    const t = await textIn(pi, rect).catch(() => '');
    const n = addCard('clip', { asset: aid, thumb: aid, src: V.src, srcCard: V.card, name: V.name, page: pi, rect: rect.map(v => +v.toFixed(4)), px: { w: c.width, h: c.height }, text: t ? t.slice(0, 2000) : '', title: nameOf({ name: V.name }) + ' · p. ' + pi }, w, ih + 10 + FOOT);
    clearSel();
    if (n) sayAct('✂︎ Clipped to the board (' + c.width + '×' + c.height + ')', 'Show', () => closeViewer(), 4000);
    return n;
  }
  async function textCard(pi, rect) {
    const t = await textIn(pi, rect);
    if (!t) { say(NO_TEXT, 2600); return null; }
    const ctx = measureCtx(); ctx.font = '500 13.5px ' + FONT;
    const w = 300, lines = wrapLines(ctx, t, w - 30, 14).length, h = Math.min(360, Math.max(90, 18 + lines * 19 + FOOT + 8));
    const n = addCard('text', { text: t.slice(0, 4000), src: V.src, srcCard: V.card, name: V.name, page: pi, rect: rect.map(v => +v.toFixed(4)), title: nameOf({ name: V.name }) + ' · p. ' + pi }, w, h);
    clearSel();
    if (n) sayAct('Aa Text card added to the board', 'Show', () => closeViewer(), 4000);
    return n;
  }

  /* ---- card painting / opening ---- */
  const _paint = EXT.paintMedia;
  EXT.paintMedia = function (ctx, n, w, h) {
    if (n.kind !== 'clip' && n.kind !== 'text') return _paint ? _paint.apply(this, arguments) : undefined;
    const m = n.media || {};
    rr(ctx, 0.5, 0.5, w - 1, h - 1, 10); ctx.fillStyle = n.kind === 'text' ? '#fbfaf6' : '#ffffff'; ctx.fill();
    ctx.strokeStyle = '#d6d8de'; ctx.lineWidth = 1.2; ctx.stroke();
    if (n.kind === 'clip') {
      const bm = img(m.asset), bx = 5, by = 5, bw = w - 10, bh = h - 10 - FOOT;
      if (bm) {
        const d = { w: bm.naturalWidth || bm.width, h: bm.naturalHeight || bm.height }, k = Math.min(bw / d.w, bh / d.h), dw = d.w * k, dh = d.h * k;
        ctx.save(); rr(ctx, bx, by, bw, bh, 6); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, bw, bh);
        ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bm, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh); ctx.restore();
      } else { ctx.fillStyle = '#eef0f4'; ctx.fillRect(bx, by, bw, bh); }
    } else {
      ctx.fillStyle = '#4f46e5'; ctx.fillRect(10, 12, 3, h - FOOT - 22);
      ctx.fillStyle = '#1d1d1f'; ctx.font = '500 13.5px ' + FONT;
      const lines = wrapLines(ctx, m.text, w - 34, Math.max(1, Math.floor((h - FOOT - 16) / 19)));
      lines.forEach((l, i) => ctx.fillText(l, 22, 26 + i * 19));
    }
    ctx.strokeStyle = '#eceef2'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, h - FOOT); ctx.lineTo(w - 8, h - FOOT); ctx.stroke();
    ctx.fillStyle = '#5b5f6b'; ctx.font = '650 11.5px ' + FONT;
    ctx.fillText(fitText(ctx, (n.kind === 'clip' ? '✂︎ ' : '❝ ') + 'p. ' + (m.page || 1) + ' · ' + nameOf(m), w - 26), 10, h - 8);
  };
  const _open = EXT.openMedia;
  EXT.openMedia = function (n) {
    if (!n || !n.media) return;
    if (n.kind === 'pdf') return openViewer(n.media.asset, { name: n.media.name, card: n.id, page: 1 });
    if (n.kind === 'clip' || n.kind === 'text') return openViewer(n.media.src, { name: n.media.name, card: n.media.srcCard, page: n.media.page, rect: n.media.rect, flash: true });
    return _open ? _open.apply(this, arguments) : undefined;
  };
  EXT.tapOpens = n => n && (n.kind === 'clip' || n.kind === 'text');

  /* ---- clip card actions ---- */
  async function saveImage(n) {
    const b = await Assets.blob(n.media.asset); if (!b) { say('Image not found on this iPad'); return; }
    const nm = (nameOf(n.media) + ' p' + (n.media.page || 1)).replace(/[^\w .-]+/g, '').trim() + '.jpg';
    const r = await shareOrSave(new Blob([b], { type: 'image/jpeg' }), nm || 'clip.jpg');
    if (r === 'download') say('🖼 Image saved — find it in Downloads / Files', 2600);
  }
  const userNotes = () => (S.notes || []).filter(x => x && !x.system && !['quoteboard', 'ideaboard', 'inbox'].includes(x.id) && x.notebookId !== 'archive' && !(typeof isSealed === 'function' && (() => { try { return isSealed(x); } catch (_) { return false; } })()));
  function addToNotePicker(n) {
    const cur = typeof curNote === 'function' ? curNote() : null;
    const list = userNotes().sort((a, b) => b.updatedAt - a.updatedAt);
    const pick = [];
    if (cur && list.includes(cur)) pick.push(cur);
    for (const x of list) { if (pick.length >= 5) break; if (!pick.includes(x)) pick.push(x); }
    const acts = pick.map((x, i) => ({ label: (i === 0 && x === cur ? 'Current note: ' : '') + (x.title || 'Untitled'), primary: i === 0, fn: () => insertImageInNote(x, n) }));
    acts.push({ label: '＋ New note', fn: () => { const nn = newUserNote('Clips – ' + shortDate()); if (nn) insertImageInNote(nn, n); } });
    actionSheet('Add this clip to a note', acts);
    const w = document.getElementById('actionWrap'); if (w) w.classList.add('fo-over');
  }
  function contentBottom(pg) {
    let b = 0;
    for (const s of pg.strokes || []) for (const p of s.points || []) if (p[1] > b) b = p[1];
    for (const t of pg.texts || []) b = Math.max(b, t.y + (t.size || 20) * 1.4);
    for (const im of pg.images || []) if (!im.hidden) b = Math.max(b, im.y + im.h);
    if (pg.todo || pg.qsheet || pg.bg) b = Math.max(b, PAGE_H * 0.92);
    return b;
  }
  function insertImageInNote(note, card) {
    const m = card.media, px = m.px || { w: 600, h: 400 };
    const maxW = PAGE_W - 160, w = Math.min(maxW, Math.max(240, px.w / 2)), h = w * px.h / px.w;
    const hh = Math.min(h, PAGE_H - 200), ww = hh < h ? hh * px.w / px.h : w;
    let pi = note.pages.length - 1, pg = note.pages[pi], y = Math.max(80, contentBottom(pg) + 30);
    if (y + hh > PAGE_H - 60) { pg = newPage(); note.pages.push(pg); pi = note.pages.length - 1; y = 80; }
    pg.images = pg.images || [];
    pg.images.push({ id: newId('im'), asset: m.asset, x: Math.round(80), y: Math.round(y), w: Math.round(ww), h: Math.round(hh) });
    pg.texts = pg.texts || [];
    pg.texts.push({ id: newId('t'), x: 80, y: Math.round(y + hh + 6), text: '✂︎ ' + nameOf(m) + ' · p. ' + (m.page || 1), size: 16, color: '#5b5f6b' });
    note.updatedAt = Date.now(); saveNote(note, true);
    try { if (S.cur === note.id) buildPages(); renderSidebar(); } catch (_) {}
    sayAct('🖼 Added to “' + (note.title || 'Untitled') + '” (page ' + (pi + 1) + ')', 'Open', () => openUserNote(note.id), 5000);
  }
  function openUserNote(id) {
    try { closeViewer(); } catch (_) {}
    try { if (typeof qbOpen === 'function') qbOpen(false); } catch (_) {}
    try { openNote(id); } catch (err) { console.warn('v21fo open', err); }
  }

  /* ============================== 2. Make note from a frame ============================== */
  function targetNotebook() {
    const nbs = S.notebooks || [];
    const cur = typeof curNote === 'function' ? curNote() : null;
    if (cur && cur.notebookId && cur.notebookId !== 'archive' && nbs.some(b => b.id === cur.notebookId) && !['quoteboard', 'ideaboard', 'inbox'].includes(cur.id)) return cur.notebookId;
    const last = (() => { try { return localStorage.getItem('foLastNb'); } catch (_) { return null; } })();
    if (last && nbs.some(b => b.id === last)) return last;
    const work = nbs.find(b => /^work$/i.test(String(b.name || '').trim()));
    if (work) return work.id;
    const s = (typeof sortedNotebooks === 'function' ? sortedNotebooks() : nbs).filter(b => b.id !== 'archive');
    return s[0] && s[0].id;
  }
  function newUserNote(title, nbId) {
    const nb = nbId || targetNotebook(); if (!nb) { say('Make a notebook first'); return null; }
    const n = makeNote(nb, title); n.title = title; n.paper = 'lined';
    n.order = -1; S.notes.push(n); saveNote(n, true);
    try { normalizeOrder(); } catch (_) {}
    try { renderSidebar(); } catch (_) {}
    return n;
  }
  function frameMembers(f) {
    const fm = FM(), all = fm.model().notes, ids = new Set(f.members || []);
    for (const n of all) if (n.x + n.w / 2 >= f.x && n.x + n.w / 2 <= f.x + f.w && n.y + n.h / 2 >= f.y && n.y + n.h / 2 <= f.y + f.h) ids.add(n.id);
    return all.filter(n => ids.has(n.id));
  }
  function readingOrder(list) {
    const left = list.slice().sort((a, b) => a.y - b.y), rows = [];
    for (const n of left) {
      const r = rows.find(r => n.y < r.top + r.minH * 0.6);
      if (r) { r.items.push(n); r.minH = Math.min(r.minH, n.h); } else rows.push({ top: n.y, minH: n.h, items: [n] });
    }
    return rows.flatMap(r => r.items.sort((a, b) => a.x - b.x));
  }
  function colOf(f, n) { return n.x + n.w / 2 < f.x + f.w / 2 ? 0 : 1; }
  async function canvasAsset(cv) { return Assets.put(await toBlob(cv, 'image/png')); }
  async function makeNoteFromFrame(f) {
    const fm = FM(); const items = frameMembers(f);
    const groups = f.cols ? f.cols.map((c, i) => ({ head: c.label, color: c.color, items: items.filter(n => colOf(f, n) === i).sort((a, b) => a.y - b.y || a.x - b.x) })) : [{ head: null, items: readingOrder(items) }];
    const title = String(f.label || 'Group').trim() || 'Group';
    const note = newUserNote(title); if (!note) return null;
    const X0 = 80, X1 = PAGE_W - 70, TOP = 96, BOT = PAGE_H - 70, GAP = 22;
    let pg = note.pages[0], x = X0, y = TOP, rowH = 0;
    const newPg = () => { pg = newPage(); note.pages.push(pg); x = X0; y = TOP; rowH = 0; };
    const nl = () => { if (rowH) { y += rowH + GAP; } x = X0; rowH = 0; };
    const place = (w, h) => {
      if (x > X0 && x + w > X1) nl();
      if (y + h > BOT) newPg();
      const at = { x, y }; x += w + GAP; rowH = Math.max(rowH, h); return at;
    };
    const textLine = (t, size, color) => {
      const ctx = measureCtx(); ctx.font = '400 ' + size + 'px ' + FONT;
      for (const line of wrapLines(ctx, t, X1 - X0 - 8)) {
        nl(); const h = Math.round(size * 1.5); if (y + h > BOT) newPg();
        pg.texts.push({ id: newId('t'), x: X0, y: Math.round(y), text: line, size, color: color || null });
        y += h; rowH = 0;
      }
      y += 6;
    };
    for (const g of groups) {
      if (g.head) { nl(); if (y > TOP) y += 10; textLine(g.head, 26, g.color === 'green' ? '#16a34a' : '#dc2626'); }
      for (const n of g.items) {
        const m = n.media || {}, kind = fm.isMedia(n) ? n.kind : 'note';
        if (kind === 'link') { textLine('🔗 ' + (m.title || m.domain || 'Link') + ' — ' + (m.href || ''), 20, '#2563eb'); continue; }
        if (kind === 'text') { textLine('❝ ' + m.text, 20); textLine('— ' + nameOf(m) + ', p. ' + (m.page || 1), 16, '#5b5f6b'); continue; }
        let asset = null, aw = n.w, ah = n.h, cap = '';
        if (kind === 'note') {
          if (!(n.strokes && n.strokes.length) && !(n.titleInk && n.titleInk.length) && !n.title) continue;   // empty sticky
          asset = await canvasAsset(fm.renderNoteImage(n, 2));
        } else if (kind === 'photo') { asset = m.asset || m.thumb; const s = m.stored || m.thumbPx || { w: n.w, h: n.h }; aw = s.w; ah = s.h; cap = m.title || ''; }
        else if (kind === 'pdf') { asset = m.thumb; aw = n.w; ah = n.w * 1.294; cap = '📄 ' + nameOf(m) + (m.pages ? ' · ' + m.pages + (m.pages === 1 ? ' page' : ' pages') : ''); }
        else if (kind === 'clip') { asset = m.asset; const s = m.px || { w: n.w, h: n.h }; aw = s.w; ah = s.h; cap = '✂︎ ' + nameOf(m) + ' · p. ' + (m.page || 1); }
        if (!asset) continue;
        const maxW = kind === 'note' ? Math.min(400, n.w * 1.35) : 400, maxH = 440;
        let w = Math.min(maxW, kind === 'note' ? n.w * 1.35 : aw), h = w * ah / aw;
        if (h > maxH) { h = maxH; w = h * aw / ah; }
        if (kind !== 'note' && w < 220 && aw >= 220) { w = 220; h = w * ah / aw; }
        const capH = cap ? 30 : 0;
        const at = place(Math.round(w), Math.round(h + capH));
        pg.images.push({ id: newId('im'), asset, x: Math.round(at.x), y: Math.round(at.y), w: Math.round(w), h: Math.round(h) });
        if (cap) pg.texts.push({ id: newId('t'), x: Math.round(at.x) - 4, y: Math.round(at.y + h + 4), text: cap.slice(0, 60), size: 15, color: '#5b5f6b' });
      }
    }
    nl();
    if (BOT - y < 320) note.pages.push(newPage());   // always leave room to keep writing
    note.updatedAt = Date.now(); saveNote(note, true);
    try { renderSidebar(); } catch (_) {}
    fm.pushUndo(); f.noteId = note.id; fm.scheduleSave(); fm.paintAll(); fm.placeSelChrome && fm.placeSelChrome();
    const nb = (S.notebooks || []).find(b => b.id === note.notebookId);
    sayAct('📝 Made “' + title + '”' + (nb ? ' in ' + nb.name : '') + ' — ' + note.pages.length + (note.pages.length === 1 ? ' page' : ' pages'), 'Open', () => openUserNote(note.id), 6000);
    return note;
  }
  const noteExists = id => !!(id && (S.notes || []).some(n => n.id === id));
  function openFrameNote(f) {
    if (!noteExists(f.noteId)) { say('That note was removed — tap Make note to make a new one', 2600); return; }
    openUserNote(f.noteId);
  }

  /* ---- frame decorations: "Open note" link + Pros/Cons columns ---- */
  const COLCOL = { green: { ink: '#15803d', fill: '#dcfce7', edge: '#86efac' }, pink: { ink: '#b91c1c', fill: '#fee2e2', edge: '#fca5a5' } };
  const HEAD = 54;
  EXT.paintFrameExtra = function (ctx, f, s, o) {
    const hits = [];
    if (noteExists(f.noteId)) {
      const t = '↗ Open note', lw = ctx.measureText(t).width + 16 / s, lx = f.x + o.tw + 6 / s, ly = f.y - o.th - 4 / s;
      o.roundRect(ctx, lx, ly, lw, o.th, 6 / s);
      ctx.fillStyle = '#eef2ff'; ctx.fill(); ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 1 / s; ctx.stroke();
      ctx.fillStyle = '#4338ca'; ctx.fillText(t, lx + 8 / s, f.y - 9 / s);
      hits.push({ x: lx, y: ly, w: lw, h: o.th, act: 'opennote' });
    }
    if (f.cols && f.cols.length === 2) {
      const cw = f.w / 2;
      ctx.save();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(79,70,229,.35)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(f.x + cw, f.y + 12); ctx.lineTo(f.x + cw, f.y + f.h - 12); ctx.stroke(); ctx.setLineDash([]);
      f.cols.forEach((c, i) => {
        const cc = COLCOL[c.color] || COLCOL.green, x0 = f.x + i * cw;
        o.roundRect(ctx, x0 + 14, f.y + 12, cw - 28, 34, 9); ctx.fillStyle = cc.fill; ctx.fill(); ctx.strokeStyle = cc.edge; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = cc.ink; ctx.font = '800 17px ' + FONT; ctx.fillText((i ? '−  ' : '+  ') + c.label, x0 + 28, f.y + 35);
        const bt = '+ note'; ctx.font = '700 13px ' + FONT; const bw = ctx.measureText(bt).width + 22, bx = x0 + cw - 22 - bw, by = f.y + 17;
        o.roundRect(ctx, bx, by, bw, 24, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = cc.edge; ctx.stroke();
        ctx.fillStyle = cc.ink; ctx.fillText(bt, bx + 11, by + 16.5);
        hits.push({ x: bx, y: by, w: bw, h: 24, act: 'add:' + i });
      });
      ctx.restore();
    }
    return hits;
  };
  EXT.frameHit = function (f, act) {
    if (act === 'opennote') return openFrameNote(f);
    if (/^add:\d$/.test(act)) return addColNote(f, +act.slice(4));
  };
  const NW = 230, NH = 150;
  function addColNote(f, i, quiet) {
    const fm = FM(), c = f.cols[i], cw = f.w / 2, x0 = f.x + i * cw;
    const inCol = frameMembers(f).filter(n => colOf(f, n) === i);
    const y = inCol.length ? Math.max(...inCol.map(n => n.y + n.h)) + 16 : f.y + HEAD + 14;
    if (!quiet) fm.pushUndo();
    const n = fm.addNote({ x: Math.round(x0 + (cw - NW) / 2), y: Math.round(y), w: NW, h: NH, color: c.color, title: '' });
    f.members = f.members || []; f.members.push(n.id);
    if (y + NH + 18 > f.y + f.h) f.h = Math.round(y + NH + 18 - f.y);
    if (!quiet) { fm.select(n.id); fm.scheduleSave(); fm.paintAll(); }
    return n;
  }
  function insertProsCons() {
    const fm = FM(); if (!fm || !fm.isOpen()) return null;
    const W = 2 * (NW + 50), H = HEAD + 14 + 2 * (NH + 16) + 4, vb = fm.viewBox();
    fm.pushUndo();
    const f = fm.addFrame({ x: Math.round(vb.x + vb.w / 2 - W / 2), y: Math.round(vb.y + Math.max(60, vb.h / 2 - H / 2)), w: W, h: H }, 'Pros / Cons', []);
    f.members = []; f.cols = [{ label: 'Pros', color: 'green' }, { label: 'Cons', color: 'pink' }];
    for (let k = 0; k < 2; k++) for (let i = 0; i < 2; i++) addColNote(f, i, true);
    fm.ST.sel = { kind: 'frame', id: f.id };
    fm.scheduleSave(); fm.paintAll();
    sayAct('⚖️ Pros / Cons added — write on the notes, tap + note for more', 'Undo', () => fm.undo(), 5000);
    return f;
  }
  const _ins = EXT.insert;
  EXT.insert = function (kind) { if (kind === 'proscons') return insertProsCons(); return _ins ? _ins.apply(this, arguments) : undefined; };
  function ensureInsertBtn() {
    const pop = document.querySelector('.fn-insert-pop'); if (!pop || pop.querySelector('[data-ins="proscons"]')) return;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.ins = 'proscons';
    b.setAttribute('role', 'menuitem'); b.innerHTML = '<i>⚖️</i><span>Pros / Cons</span><small>Two-column frame</small>'; pop.append(b);
  }

  /* ============================== 3. Sticky → To-Do / reminder ============================== */
  function isSticky(n) { const fm = FM(); return n && !(fm && fm.isMedia(n)); }
  function stickyReminder(n) { const b = typeof ideaNote === 'function' ? ideaNote() : null; return b && (b.reminders || []).find(r => r.fmNote === n.id && !r.done); }
  function newTodo() {
    const TD = (window.V21ee && V21ee.TD) || { DEF: 6 };
    return { v: 1, pri: [0, 1, 2].map(() => ({ id: newId('tp'), done: false })), rows: Array.from({ length: TD.DEF || 6 }, () => ({ id: newId('tr'), done: false })), tomorrow: true };
  }
  const layoutTodo = t => (window.V21ff && V21ff.layoutTodo ? V21ff.layoutTodo(t) : V21ee.tdLayout(t));
  const LIMIT = () => PAGE_H - 24;
  function sameDay(ts) { return ts && dayKey(new Date(ts)) === dayKey(); }
  function findTodayTodo() {
    const today = dayKey();
    const cands = userNotes().filter(n => n.pages.some(p => p.todo) && (n.foTodoDay === today || sameDay(n.createdAt)));
    cands.sort((a, b) => (b.foTodoDay === today) - (a.foTodoDay === today) || b.updatedAt - a.updatedAt);
    return cands[0] || null;
  }
  function createTodayTodo() {
    const n = newUserNote('Daily To-Do – ' + shortDate()); if (!n) return null;
    const p = n.pages[0]; p.paper = 'blank'; p.todo = newTodo(); n.foTodoDay = dayKey();
    saveNote(n, true); return n;
  }
  function bandEmpty(pg, r) {
    const x0 = r.write.x, x1 = r.write.x + r.write.w, y0 = r.y + 2, y1 = r.y + r.h - 2;
    for (const s of pg.strokes || []) for (const p of s.points || []) if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) return false;
    for (const t of pg.texts || []) { const cy = t.y + (t.size || 20) * 0.6; if (cy >= y0 && cy <= y1 && t.x + 10 >= x0 - 20 && t.x <= x1) return false; }
    return true;
  }
  function shiftBelow(pg, y0, dy) {
    for (const s of pg.strokes || []) { const ys = (s.points || []).map(p => p[1]); const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0; if (cy >= y0) { s.points = s.points.map(p => { const q = p.slice(); q[1] += dy; return q; }); if (typeof bbox === 'function') try { s.bb = bbox(s.points); } catch (_) {} } }
    for (const t of pg.texts || []) if (t.y + (t.size || 20) * 0.6 >= y0) t.y += dy;
  }
  function freeRow(note) {
    for (let pi = note.pages.length - 1; pi >= 0; pi--) {
      const pg = note.pages[pi]; if (!pg.todo) continue;
      const L = layoutTodo(pg.todo);
      const r = L.rows.find(r => bandEmpty(pg, r)); if (r) return { pi, pg, r };
      // add a line at the end of the task list if it still fits
      const y0 = L.rowsBottom, t = pg.todo; t.rows.push({ id: newId('tr'), done: false });
      if (layoutTodo(t).bottom > LIMIT()) { t.rows.pop(); break; }
      const L2 = layoutTodo(t); shiftBelow(pg, y0, L2.rowsBottom - y0);
      return { pi, pg, r: L2.rows[L2.rows.length - 1] };
    }
    // page full → a continuation Daily To-Do page
    const p = newPage(); p.paper = 'blank'; p.todo = newTodo(); note.pages.push(p);
    return { pi: note.pages.length - 1, pg: p, r: layoutTodo(p.todo).rows[0] };
  }
  function inkStrokes(n) {
    const y0 = n.title || (n.titleInk && n.titleInk.length) ? 28 : 8, out = [];
    for (const s of n.titleInk || []) out.push({ s, dy: 4 });
    for (const s of n.strokes || []) out.push({ s, dy: y0 });
    return out.filter(o => o.s && o.s.points && o.s.points.length);
  }
  function addToTodo(n) {
    let note = findTodayTodo(), made = false;
    if (!note) { note = createTodayTodo(); made = true; }
    if (!note) return null;
    const { pi, pg, r } = freeRow(note);
    const title = String(n.title || '').trim() || 'Idea from board', size = 21;
    const ty = Math.round(r.y + (r.h - size * 1.35) / 2);
    pg.texts = pg.texts || [];
    pg.texts.push({ id: newId('t'), x: r.write.x + 2, y: ty, text: title, size, color: null });
    // small copy of the sticky's ink, as vector strokes so it stays with the line
    const ink = inkStrokes(n);
    if (ink.length) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const o of ink) for (const p of o.s.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1] + o.dy); y1 = Math.max(y1, p[1] + o.dy); }
      const ctx = measureCtx(); ctx.font = '400 ' + size + 'px ' + FONT;
      const tx = r.write.x + 2 + ctx.measureText(title).width + 28;
      const boxH = r.h - 14, boxW = Math.max(60, Math.min(260, r.write.x + r.write.w - tx - 6));
      const k = Math.min(boxH / Math.max(1, y1 - y0), boxW / Math.max(1, x1 - x0), 0.6);
      const ox = tx, oy = r.y + (r.h - (y1 - y0) * k) / 2 - 3;
      pg.strokes = pg.strokes || [];
      if (boxW >= 60) for (const o of ink) {
        const pts = o.s.points.map(p => { const q = p.slice(); q[0] = +(ox + (p[0] - x0) * k).toFixed(1); q[1] = +(oy + (p[1] + o.dy - y0) * k).toFixed(1); return q; });
        const st = { id: newId('s'), tool: 'pen', color: o.s.color || '#1d1d1f', width: Math.max(1, (o.s.width || 2.2) * Math.max(k, 0.55)), points: pts };
        if (typeof bbox === 'function') try { st.bb = bbox(pts); } catch (_) {}
        pg.strokes.push(st);
      }
    }
    note.updatedAt = Date.now(); saveNote(note, true);
    try { if (S.cur === note.id) buildPages(); renderSidebar(); } catch (_) {}
    const fm = FM(); fm.pushUndo(); n.foTodo = { note: note.id, row: r.id, at: Date.now() }; fm.invalidateNote(n.id); fm.scheduleSave(); fm.paintAll();
    sayAct('✓ Added to ' + (made ? 'a new ' : '') + 'today’s To-Do', 'Open', () => openUserNote(note.id), 5000);
    return { note, pi, row: r.id };
  }
  function remindMe(n) {
    const b = typeof ideaNote === 'function' ? ideaNote() : null; if (!b || typeof openEditor !== 'function') return;
    b.reminders = b.reminders || [];
    const ex = stickyReminder(n);
    const obj = ex || { id: newId('r'), title: String(n.title || '').trim() || 'Idea from board', due: null, repeat: '', done: false, notified: false, createdAt: Date.now(), fmNote: n.id };
    const w = document.getElementById('sheetWrap'); if (w) w.classList.add('fo-over');
    openEditor({ type: 'note', note: b, obj, page: -1 }, !ex);
    const st = document.getElementById('sheetTitle'); if (st) st.textContent = ex ? 'Sticky note reminder' : 'Remind me about this sticky note';
    try {
      const fm = FM(), cv = fm.renderNoteImage(n, 2), th = document.getElementById('sheetThumb');
      if (th) th.innerHTML = '<img alt="" class="fo-sticky-thumb" src="' + cv.toDataURL('image/png') + '">';
    } catch (_) {}
    if (!ex) {
      const due = new Date(); due.setDate(due.getDate() + 1); due.setHours(9, 0, 0, 0);
      const fd = document.getElementById('fDue'); if (fd && typeof toLocalInput === 'function') { fd.value = toLocalInput(due.toISOString()); const ic = document.getElementById('fIcs'); if (ic) ic.style.display = ''; }
    }
  }
  function afterSheet() { setTimeout(() => { const fm = FM(); if (!fm || !fm.isOpen()) return; for (const n of fm.model().notes) if (!fm.isMedia(n)) fm.invalidateNote(n.id); fm.paintAll(); }, 30); }
  function bindSheet() { for (const id of ['fSave', 'fDelete']) { const b = document.getElementById(id); if (b && !b._fo) { b._fo = 1; b.addEventListener('click', afterSheet); } } }
  // reminder notifications for a sticky open the board instead of the hidden board note
  if (typeof jumpTo === 'function' && !jumpTo._fo) {
    const _j = jumpTo;
    jumpTo = function (noteId, taskId) {
      if (noteId === 'ideaboard' && typeof qbOpen === 'function') { try { qbOpen(true, { mode: 'ideas' }); } catch (_) {} return; }
      return _j.apply(this, arguments);
    };
    jumpTo._fo = true;
  }
  EXT.paintNoteExtra = function (ctx, n, w, h) {
    if (!isSticky(n)) return;
    const marks = []; if (n.foTodo) marks.push('✓'); if (stickyReminder(n)) marks.push('⏰');
    if (!marks.length) return;
    ctx.save(); ctx.font = '700 12px ' + FONT;
    let x = w - 4; const y = h - 24;
    for (const m of marks.reverse()) {
      const bw = 24; x -= bw;
      rr(ctx, x, y, bw - 3, 19, 9.5); ctx.fillStyle = m === '✓' ? '#16a34a' : '#ffffff'; ctx.fill();
      ctx.strokeStyle = m === '✓' ? '#15803d' : '#d6d8de'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = m === '✓' ? '#fff' : '#1d1d1f'; ctx.textAlign = 'center'; ctx.fillText(m, x + (bw - 3) / 2, y + 14); ctx.textAlign = 'left';
    }
    ctx.restore();
  };

  /* ============================== selection bar actions ============================== */
  EXT.selActions = function (kind, t) {
    const del = { k: 'del', label: 'Delete', cls: 'danger' };
    if (kind === 'frame') return [{ k: 'mknote', label: '📝 Make note' }, ...(noteExists(t.noteId) ? [{ k: 'opennote', label: 'Open note' }] : [])];
    const fm = FM();
    if (!fm.isMedia(t)) return [{ k: 'todo', label: t.foTodo ? '✓ Add to To-Do again' : '✓ Add to To-Do' }, { k: 'remind', label: stickyReminder(t) ? '⏰ Reminder…' : '⏰ Remind me…' }, del];
    if (t.kind === 'clip') return [{ k: 'open', label: 'Open source' }, { k: 'saveimg', label: 'Save image' }, { k: 'addnote', label: 'Add to note' }, del];
    if (t.kind === 'text') return [{ k: 'open', label: 'Open source' }, { k: 'copytext', label: 'Copy text' }, del];
    return [{ k: 'open', label: t.kind === 'pdf' ? 'Open PDF' : t.kind === 'link' ? 'Open link' : 'View photo' }, del];
  };
  EXT.selAction = function (k, t, kind) {
    if (kind === 'frame') { if (k === 'mknote') makeNoteFromFrame(t).catch(err => { console.warn(err); say('Could not make the note'); }); else if (k === 'opennote') openFrameNote(t); return true; }
    if (k === 'todo') { addToTodo(t); return true; }
    if (k === 'remind') { remindMe(t); return true; }
    if (k === 'saveimg') { saveImage(t); return true; }
    if (k === 'addnote') { addToNotePicker(t); return true; }
    if (k === 'copytext') { copyText(t.media.text || '').then(ok => say(ok ? '📋 Text copied' : 'Could not copy')); return true; }
    return false;
  };

  /* ============================== boot ============================== */
  function boot() {
    addChangelog(); bindSheet();
    if (typeof qbOpen === 'function' && !qbOpen._fo) {
      const _q = qbOpen;
      qbOpen = function (on) { const r = _q.apply(this, arguments); setTimeout(ensureInsertBtn, 0); if (!on) closeViewer(); return r; };
      qbOpen._fo = true;
    }
    ensureInsertBtn();
    document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#fmInsert')) ensureInsertBtn(); }, true);
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#fmInsert')) ensureInsertBtn(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && V.el && !V.el.hidden) closeViewer(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.V21fo = { version: VERSION, ENTRY, openViewer, closeViewer, setSelMode, viewer: V, clipToBoard, textCard, copySel, textIn, renderCrop,
    makeNoteFromFrame, openFrameNote, insertProsCons, addColNote, addToTodo, findTodayTodo, remindMe, saveImage, insertImageInNote, addToNotePicker, targetNotebook, readingOrder,
    select: (page, rect) => { V.sel = { page, rect }; const p = V.pages[page - 1]; showBox(p, [rect[0], rect[1]], [rect[0] + rect[2], rect[1] + rect[3]]); placePop(); } };
})();
