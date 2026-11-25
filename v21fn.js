/* Pencil Notes v21fn — small-annoyance fixes + Idea Board media + quote PDF +
   calculator Board mode + one backup button + version badge / What's new.
   1. Toasts: one at a time (a new one replaces the old), always auto-dismiss,
      clear when you switch notes, and move to the top instead of covering the
      Daily To-Do Notes / Tomorrow boxes. Idea Board Settings copy refreshed;
      "Find cards…" is now "Find notes…" (in v21fm.js).
   2. Idea Board Insert → Photo / PDF / Link cards. They are v21fm notes with a
      `kind` + `media` field, so finger hold-drag, frames, arrows, resize and
      delete-with-undo are shared. Files go into the existing IndexedDB
      'assets' store (add only — nothing is ever deleted). Photos are
      downscaled once on insert (full ≤2048px, thumb ≤720px) and the decoded
      thumbnail is cached, so Pencil and pan never decode images.
   3. 📤 Send PDF on every quote: renders just that quote (ink, no on-page
      controls) into a one-page PDF and opens the share sheet (download fallback).
   4. Calculator "Board" mode: square feet, sheet count with waste %, markup /
      margin. Typed inputs only — no handwriting reading.
   5. One "Back up to Files / iCloud" action with the last-backup time, plus an
      optional end-of-day reminder banner (Settings switch).
   6. Version badge in the sidebar, a one-time "Updated to v21fn" card, a
      changelog in Settings, and an "Update ready — tap to reload" banner.
   Never opens IndexedDB for deletion. Resin Board and Sales Leads stay hidden. */
(() => {
  'use strict';
  const VERSION = 'v21fn';
  const appVersion = () => { try { return APP_VERSION; } catch (_) { return VERSION; } };
  const $1 = (s, r = document) => r.querySelector(s);
  const escH = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch (_) {} }
  };
  const newId = p => (typeof uid === 'function' ? uid(p) : p + Math.random().toString(36).slice(2, 9));
  const sealedNote = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; } };

  /* ============================== 6a. Changelog ============================== */
  const CHANGELOG = [
    { v: 'v21fn', d: 'Nov 2026', items: [
      'Idea Board: tap Insert to add photos, PDFs and links. Move them with a finger, put them in frames, connect them with arrows, resize or delete them.',
      'Quotes: tap 📤 Send PDF on a quote to share a clean PDF of just that quote.',
      'Calculator: new Board mode for square feet, sheet count with waste, and markup vs margin.',
      'One “Back up to Files / iCloud” button that shows your last backup, plus an optional end-of-day reminder.',
      'Messages at the bottom no longer pile up, clear when you switch notes and stay off your To-Do Notes and Tomorrow boxes.',
      'You can now see the version in the sidebar, and an “Update ready” banner appears when a new version is waiting.'
    ] },
    { v: 'v21fm', d: 'Nov 2026', items: ['Idea Board redesign: an open Pencil canvas with sticky notes, arrows, frames, zoom and a mini-map.', 'Toolbar icons have labels; the lasso menu sits next to your selection.'] },
    { v: 'v21fl', d: 'Nov 2026', items: ['Writing and the eraser back to the reliable v21fi behavior on every page template.', 'Daily To-Do continuation pages stay visible.'] },
    { v: 'v21fi', d: 'Nov 2026', items: ['Resin Board removed from the top bar.'] },
    { v: 'v21fh', d: 'Nov 2026', items: ['Calculator in the top bar, with S / M / L sizes.', 'Templates continue onto a new page when you run out of room.'] }
  ];
  const changes = v => (CHANGELOG.find(c => c.v === v) || CHANGELOG[0]).items;

  /* ============================== 1. Toasts ============================== */
  const tEl = () => document.getElementById('toast');
  const uEl = () => document.getElementById('undoToast');
  function hideToasts() {
    const t = tEl(), u = uEl();
    if (t) { t.hidden = true; t.classList.remove('fn-top'); }
    if (u) { u.hidden = true; u.classList.remove('fn-top'); u._fn = null; }
    try { clearTimeout(toast._t); } catch (_) {}
    try { clearTimeout(actionToast.t); } catch (_) {}
    clearTimeout(hideToasts._u);
  }
  // Screen rects of the Notes / Tomorrow boxes on Daily To-Do pages that are on screen.
  function todoBoxRects() {
    const out = [];
    try {
      const n = typeof curNote === 'function' && curNote(); if (!n || !window.V21ff || typeof V21ff.layoutTodo !== 'function') return out;
      const sc = (typeof S !== 'undefined' && S.scale) || 1;
      (typeof pageEls !== 'undefined' ? pageEls : []).forEach((rec, i) => {
        const pg = n.pages[i]; if (!rec || !rec.el || !pg || !pg.todo) return;
        const r = rec.el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
        let L = null; try { L = V21ff.layoutTodo(pg.todo); } catch (_) {}
        if (!L) return;
        for (const f of [L.notes, L.tomorrow]) if (f && f.w) out.push({ left: r.left + f.x * sc, top: r.top + f.y * sc, right: r.left + (f.x + f.w) * sc, bottom: r.top + (f.y + f.h) * sc });
      });
    } catch (_) {}
    return out;
  }
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  function topbarBottom() {   // bottom of the top bar and, when shown, the pen toolbar under it
    let b = 0;
    for (const s of ['#topbar', '#toolbar', '#qbHead']) { const e = $1(s); if (!e) continue; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (r.height && cs.display !== 'none' && cs.visibility !== 'hidden' && r.top < 200) b = Math.max(b, r.bottom); }
    return b || 64;
  }
  function placeToast(el) {
    if (!el || el.hidden) return;
    el.classList.remove('fn-top');
    document.documentElement.style.setProperty('--fn-toast-top', Math.round(topbarBottom() + 10) + 'px');
    const r = el.getBoundingClientRect(), pad = { left: r.left - 6, top: r.top - 6, right: r.right + 6, bottom: r.bottom + 6 };
    if (todoBoxRects().some(b => overlaps(pad, b))) el.classList.add('fn-top');
  }
  if (typeof toast === 'function' && !toast._v21fn) {
    const _toast = toast;
    toast = function (msg, ms) {
      const u = uEl(); if (u && !u.hidden) { u.hidden = true; u._fn = null; try { clearTimeout(actionToast.t); } catch (_) {} }
      const progress = /…\s*$/.test(String(msg || ''));
      let d = +ms || 2400; if (!progress) d = Math.min(Math.max(d, 1200), 4500); else d = Math.min(d, 60000);
      const r = _toast.call(this, msg, d);
      placeToast(tEl());
      return r;
    };
    toast._v21fn = true;
  }
  if (typeof actionToast === 'function' && !actionToast._v21fn) {
    const _at = actionToast;
    actionToast = function (msg, label, fn, ms) {
      const t = tEl(); if (t) { t.hidden = true; try { clearTimeout(toast._t); } catch (_) {} }
      const d = Math.min(Math.max(+ms || 6000, 2500), 8000);
      const r = _at.call(this, msg, label, fn, d);
      const u = uEl(); placeToast(u);
      clearTimeout(hideToasts._u); hideToasts._u = setTimeout(() => { const x = uEl(); if (x) x.hidden = true; }, d + 50);   // always goes away
      return r;
    };
    actionToast._v21fn = true;
  }
  if (typeof openNote === 'function' && !openNote._v21fn) {
    const _on = openNote;
    openNote = function () { hideToasts(); return _on.apply(this, arguments); };
    openNote._v21fn = true;
  }
  window.addEventListener('resize', () => { placeToast(tEl()); placeToast(uEl()); });

  /* ============================== 2. Idea Board media ============================== */
  const FM = () => window.V21fm;
  const EXT = window.V21fmExt || (window.V21fmExt = {});
  const thumbs = new Map();      // asset id → ImageBitmap | HTMLImageElement | null (failed) ; loading → Promise
  const loading = new Map();
  const PHOTO_FULL = 2048, PHOTO_THUMB = 720, PHOTO_SIDE = 300;
  const ideaPage = () => { const n = typeof ideaNote === 'function' ? ideaNote() : null; return n && n.pages && n.pages[0]; };

  // Hidden refs in pg.images (kind 'pdfsource', w/h 0, like v21eo) so backups and the code lock include the files.
  function addRefs(ids) {
    const pg = ideaPage(); if (!pg) return;
    pg.images = pg.images || [];
    for (const id of ids.filter(Boolean)) if (!pg.images.some(im => im && im.asset === id)) pg.images.push({ id: newId('im'), kind: 'pdfsource', fm: 1, hidden: 1, asset: id, x: 0, y: 0, w: 0, h: 0 });
  }
  async function decodeImage(blob) {
    if (self.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { try { return await createImageBitmap(blob); } catch (_) {} } }
    const url = URL.createObjectURL(blob);
    try { const im = new Image(); im.src = url; await im.decode(); return im; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const dims = im => ({ w: im.naturalWidth || im.width, h: im.naturalHeight || im.height });
  function scaledCanvas(im, max) {
    const { w, h } = dims(im), k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (c, type = 'image/jpeg', q = 0.85) => new Promise(r => c.toBlob(r, type, q));
  function thumb(id) {
    if (!id) return null;
    if (thumbs.has(id)) return thumbs.get(id);
    if (!loading.has(id)) {
      loading.set(id, (async () => {
        let bm = null;
        try { const b = await Assets.blob(id); if (b) bm = await decodeImage(b); } catch (err) { console.warn('v21fn thumb', err); }
        thumbs.set(id, bm); loading.delete(id);
        const fm = FM(); if (!fm || !fm.isOpen()) return bm;
        for (const n of fm.model().notes) if (n.media && n.media.thumb === id) fm.invalidateNote(n.id);
        fm.paintAll();
        return bm;
      })());
    }
    return undefined;
  }
  const mediaIdle = () => !loading.size;

  // ---- painting (called by v21fm.paintNoteBmp; result is cached per note) ----
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const FONT = '-apple-system, system-ui, sans-serif';
  function fitText(ctx, t, maxW) { t = String(t || ''); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
  function wrap2(ctx, t, maxW) {
    const words = String(t || '').split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const nx = cur ? cur + ' ' + w : w; if (ctx.measureText(nx).width > maxW && cur) { lines.push(cur); cur = w; if (lines.length === 2) break; } else cur = nx; }
    if (lines.length < 2 && cur) lines.push(cur);
    if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) lines[1] = fitText(ctx, lines[1] + ' …', maxW);
    return lines.slice(0, 2).map(l => fitText(ctx, l, maxW));
  }
  function drawCover(ctx, im, x, y, w, h, contain) {
    const d = dims(im); if (!d.w || !d.h) return;
    const k = contain ? Math.min(w / d.w, h / d.h) : Math.max(w / d.w, h / d.h);
    const dw = d.w * k, dh = d.h * k;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function placeholder(ctx, x, y, w, h, label) {
    ctx.fillStyle = '#eef0f4'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8a8f99'; ctx.font = '600 13px ' + FONT; ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 4); ctx.textAlign = 'left';
  }
  EXT.paintMedia = function (ctx, n, w, h) {
    const m = n.media || {};
    ctx.save();
    ctx.shadowColor = 'rgba(20,20,40,.12)'; ctx.shadowBlur = 0;
    rr(ctx, 0.5, 0.5, w - 1, h - 1, 10); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = '#d6d8de'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    if (n.kind === 'photo') {
      ctx.save(); rr(ctx, 5, 5, w - 10, h - 10, 7); ctx.clip();
      const im = thumb(m.thumb || m.asset);
      if (im) drawCover(ctx, im, 5, 5, w - 10, h - 10, false); else placeholder(ctx, 5, 5, w - 10, h - 10, im === null ? 'Photo unavailable' : 'Loading photo…');
      ctx.restore();
      return;
    }
    if (n.kind === 'pdf') {
      const strip = 44, ph = Math.max(20, h - strip - 6);
      ctx.save(); rr(ctx, 5, 5, w - 10, ph, 6); ctx.clip();
      const im = thumb(m.thumb);
      if (im) { ctx.fillStyle = '#fff'; ctx.fillRect(5, 5, w - 10, ph); drawCover(ctx, im, 5, 5, w - 10, ph, true); }
      else placeholder(ctx, 5, 5, w - 10, ph, m.thumb ? 'Loading preview…' : 'PDF');
      ctx.restore();
      ctx.strokeStyle = '#e4e5ea'; ctx.beginPath(); ctx.moveTo(6, h - strip); ctx.lineTo(w - 6, h - strip); ctx.stroke();
      ctx.fillStyle = '#c0362c'; rr(ctx, 10, h - strip + 9, 30, 26, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 10px ' + FONT; ctx.textAlign = 'center'; ctx.fillText('PDF', 25, h - strip + 26); ctx.textAlign = 'left';
      ctx.fillStyle = '#1d1d1f'; ctx.font = '700 13px ' + FONT; ctx.fillText(fitText(ctx, m.title || m.name || 'Document', w - 58), 48, h - strip + 19);
      ctx.fillStyle = '#6e6e76'; ctx.font = '500 11px ' + FONT; ctx.fillText(fitText(ctx, (m.pages ? m.pages + (m.pages === 1 ? ' page' : ' pages') + ' · ' : '') + 'tap again to open', w - 58), 48, h - strip + 35);
      return;
    }
    if (n.kind === 'link') {
      const dom = m.domain || '', hue = [...dom].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 210);
      ctx.fillStyle = 'hsl(' + hue + ',62%,46%)'; rr(ctx, 12, 14, 40, 40, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 20px ' + FONT; ctx.textAlign = 'center'; ctx.fillText((dom.replace(/^www\./, '')[0] || '🔗').toUpperCase(), 32, 41); ctx.textAlign = 'left';
      ctx.fillStyle = '#1d1d1f'; ctx.font = '700 14px ' + FONT;
      wrap2(ctx, m.title || dom || m.href, w - 76).forEach((l, i) => ctx.fillText(l, 62, 30 + i * 18));
      ctx.fillStyle = '#4f46e5'; ctx.font = '600 12px ' + FONT; ctx.fillText(fitText(ctx, '↗ ' + (dom || m.href || ''), w - 24), 12, h - 14);
      return;
    }
  };

  // ---- inserting ----
  let cascade = 0;
  function centerSpot(w, h) {
    const fm = FM(), vb = fm.viewBox(); cascade = (cascade + 1) % 6;
    return { x: Math.round(vb.x + vb.w / 2 - w / 2 + cascade * 24), y: Math.round(vb.y + vb.h / 2 - h / 2 + cascade * 24) };
  }
  function addMediaNote(kind, media, w, h, at) {
    const fm = FM(); if (!fm || !fm.isOpen()) return null;
    fm.pushUndo();
    const pos = at || centerSpot(w, h);
    const n = fm.addNote({ x: pos.x, y: pos.y, w: Math.round(w), h: Math.round(h), color: 'yellow', title: '' });
    n.kind = kind; n.media = media; n.color = 'none';
    fm.invalidateNote(n.id); fm.select(n.id); fm.scheduleSave();
    return n;
  }
  async function addPhotoBlob(blob, at, opt = {}) {
    const im = await decodeImage(blob);
    const d = dims(im);
    const fullC = Math.max(d.w, d.h) > PHOTO_FULL || !/jpe?g|png|webp/i.test(blob.type || '') ? scaledCanvas(im, PHOTO_FULL) : null;
    const full = fullC ? await toBlob(fullC, 'image/jpeg', 0.85) : blob;
    const thC = scaledCanvas(im, PHOTO_THUMB), th = await toBlob(thC, 'image/jpeg', 0.8);
    if (im.close) try { im.close(); } catch (_) {}
    const [aid, tid] = [await Assets.put(full), await Assets.put(th)];
    addRefs([aid, tid]);
    const bm = await decodeImage(th); thumbs.set(tid, bm);
    const asp = d.w / d.h || 1, side = opt.side || PHOTO_SIDE;
    const w = asp >= 1 ? side : side * asp, h = w / asp;
    const n = addMediaNote('photo', { asset: aid, thumb: tid, name: opt.name || blob.name || 'Photo', title: opt.title || '', w: d.w, h: d.h, aspect: asp, stored: { w: fullC ? fullC.width : d.w, h: fullC ? fullC.height : d.h }, thumbPx: { w: thC.width, h: thC.height } }, w + 10, h + 10, at);
    if (!opt.quiet && n) actionToast('📷 Photo added — hold with a finger to move it', 'Undo', () => FM().undo(), 5000);
    return n;
  }
  async function addPdfFile(file, at, opt = {}) {
    const aid = await Assets.put(file);
    let tid = null, pages = 0, asp = 0.77;
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      pages = doc.numPages;
      const page = await doc.getPage(1), v1 = page.getViewport({ scale: 1 });
      asp = v1.width / v1.height;
      const vp = page.getViewport({ scale: 600 / v1.width });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      tid = await Assets.put(await toBlob(c, 'image/jpeg', 0.82));
      try { doc.destroy(); } catch (_) {}
    } catch (err) { console.warn('v21fn pdf preview', err); }
    addRefs([aid, tid]);
    const name = String(file.name || 'Document.pdf');
    const w = 240, h = Math.min(420, w / asp) + 44 + 6;
    const n = addMediaNote('pdf', { asset: aid, thumb: tid, name, title: name.replace(/\.pdf$/i, ''), pages, type: 'application/pdf' }, w, h, at);
    if (!opt.quiet && n) actionToast('📄 PDF added' + (pages ? ' — ' + pages + (pages === 1 ? ' page' : ' pages') : ''), 'Undo', () => FM().undo(), 5000);
    return n;
  }
  function cleanUrl(raw) {
    let s = String(raw || '').trim(); if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    let u; try { u = new URL(s); } catch (_) { return null; }
    if (!/^https?:$/.test(u.protocol) || !u.hostname || !/\./.test(u.hostname) && u.hostname !== 'localhost') return null;
    return u;
  }
  function prettyTitle(u) {
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').trim();
    const dom = u.hostname.replace(/^www\./, '');
    return seg && seg.length > 2 && !/^\d+$/.test(seg) ? seg.charAt(0).toUpperCase() + seg.slice(1) : dom;
  }
  function addLink(raw, title, at, opt = {}) {
    const u = cleanUrl(raw); if (!u) { toast('That doesn’t look like a web address', 2200); return null; }
    const dom = u.hostname.replace(/^www\./, '');
    const n = addMediaNote('link', { href: u.href, domain: dom, title: String(title || '').trim() || prettyTitle(u) }, 280, 124, at);
    if (!opt.quiet && n) actionToast('🔗 Link added', 'Undo', () => FM().undo(), 5000);
    return n;
  }
  function pickFile(accept, cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.hidden = true;
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) cb(f); };
    document.body.append(inp); inp.click();
    setTimeout(() => { if (inp.isConnected && !inp.files.length) inp.remove(); }, 120000);
  }
  function linkSheet() {
    let w = document.getElementById('fnLinkSheet');
    if (!w) { w = document.createElement('div'); w.id = 'fnLinkSheet'; w.className = 'fn-sheet-wrap'; document.body.append(w); }
    w.innerHTML = '<form class="fn-sheet" role="dialog" aria-modal="true" aria-label="Add a link"><h3>Add a link</h3>' +
      '<label>Web address<input name="u" type="url" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="example.com/page" required></label>' +
      '<label>Title <small>(optional)</small><input name="t" type="text" placeholder="Shown on the card"></label>' +
      '<p class="fn-err" hidden></p><div class="fn-sheet-btns"><button type="button" data-x>Cancel</button><button type="submit" class="primary">Add link</button></div></form>';
    w.hidden = false;
    const f = w.querySelector('form'), close = () => { w.hidden = true; w.innerHTML = ''; };
    w.onclick = e => { if (e.target === w || e.target.closest('[data-x]')) close(); };
    f.onsubmit = e => {
      e.preventDefault();
      if (!cleanUrl(f.u.value)) { const er = f.querySelector('.fn-err'); er.hidden = false; er.textContent = 'Enter a web address like example.com'; return; }
      const v = f.u.value, t = f.t.value; close(); addLink(v, t);
    };
    setTimeout(() => f.u.focus(), 30);
  }
  async function guard(p, what) { try { return await p; } catch (err) { console.warn('v21fn ' + what, err); toast('Could not add that ' + what, 2400); return null; } }
  EXT.insert = function (kind) {
    if (kind === 'photo') pickFile('image/*', f => { toast('Adding photo…', 20000); guard(addPhotoBlob(f), 'photo'); });
    else if (kind === 'pdf') pickFile('application/pdf,.pdf', f => { toast('Adding PDF…', 20000); guard(addPdfFile(f), 'PDF'); });
    else if (kind === 'link') linkSheet();
  };

  // ---- opening ----
  async function shareOrOpenBlob(blob, name) {
    const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
    if (standalone() && file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return 'share'; } catch (_) { return 'cancel'; } }
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return win ? 'open' : 'download';
  }
  async function viewPhoto(n) {
    const b = await Assets.blob(n.media.asset || n.media.thumb); if (!b) { toast('Photo not found on this iPad', 2000); return; }
    let v = document.getElementById('fnViewer');
    if (!v) { v = document.createElement('div'); v.id = 'fnViewer'; document.body.append(v); }
    const url = URL.createObjectURL(b);
    v.innerHTML = '<img alt=""><button type="button" aria-label="Close photo">✕</button>';
    v.querySelector('img').src = url; v.hidden = false;
    v.onclick = () => { v.hidden = true; v.innerHTML = ''; URL.revokeObjectURL(url); };
  }
  EXT.openMedia = async function (n) {
    if (!n || !n.media) return;
    if (n.kind === 'photo') return viewPhoto(n);
    if (n.kind === 'link') { const u = cleanUrl(n.media.href); if (u) window.open(u.href, '_blank', 'noopener'); return; }
    if (n.kind === 'pdf') { const b = await Assets.blob(n.media.asset); if (!b) { toast('PDF not found on this iPad', 2000); return; } return shareOrOpenBlob(new Blob([b], { type: 'application/pdf' }), n.media.name || 'Document.pdf'); }
  };

  /* ============================== 3. Send quote as PDF ============================== */
  async function quotePdf(note, pi, qid) {
    const pg = note.pages[pi], qs = pg && pg.qsheet; if (!qs) return null;
    const qi = qs.quotes.findIndex(q => q.id === qid), q = qs.quotes[qi]; if (!q) return null;
    const L = V21ed.qLayout(q), pad = 10;
    const next = qs.quotes.filter(o => o !== q && o.y > q.y).reduce((m, o) => Math.min(m, o.y), PAGE_H);
    const x0 = Math.max(0, L.x - pad), y0 = Math.max(0, L.y - pad), x1 = Math.min(PAGE_W, L.x + L.w + pad), y1 = Math.min(PAGE_H, L.y + L.h + pad, next - 4);
    const crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const K = 2;   // render scale (page units → px)
    const src = document.createElement('canvas'); src.width = Math.round(PAGE_W * K); src.height = Math.round(PAGE_H * K);
    const sctx = src.getContext('2d');
    sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, src.width, src.height);
    sctx.setTransform(K, 0, 0, K, 0, 0);
    await Promise.all(pageAssetIds(pg).map(id => Assets.ready(id)));
    const wasLight = renderLight; renderLight = true;
    try { drawPageContent(sctx, note, pg); drawOverlaysForExport(sctx, pg, note); } finally { renderLight = wasLight; }
    // Letter page (8.5×11) at 150 dpi, quote fitted to the width with margins, top-aligned.
    const PW = 1275, PH = 1650, M = 90;
    const out = document.createElement('canvas'); out.width = PW; out.height = PH;
    const px = sctx.getImageData(Math.round((crop.x + 2) * K), Math.round((crop.y + 2) * K), 1, 1).data;   // paper colour, so the quote sits seamlessly on the page
    const o = out.getContext('2d'); o.fillStyle = 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')'; o.fillRect(0, 0, PW, PH);
    const k = Math.min((PW - 2 * M) / crop.w, (PH - 2 * M) / crop.h);
    o.imageSmoothingQuality = 'high';
    o.drawImage(src, crop.x * K, crop.y * K, crop.w * K, crop.h * K, (PW - crop.w * k) / 2, M, crop.w * k, crop.h * k);
    const jpeg = new Uint8Array(await (await toBlob(out, 'image/jpeg', 0.9)).arrayBuffer());
    const blob = buildPdf([{ jpeg, w: PW, h: PH }], 612, 792);
    const label = q.qnum ? String(q.qnum).replace(/^#?/, '') : String(qi + 1);
    const base = ((note.title || 'Quote').replace(/[^\w\- ]+/g, '').trim() || 'Quote');
    return { blob, name: 'Quote ' + label.replace(/[^\w\-]+/g, '') + ' - ' + base + '.pdf', crop, canvas: out };
  }
  async function sendQuote(pi, qid) {
    const note = curNote(); if (!note) return;
    if (sealedNote(note)) { toast('🔒 Unlock this note to send the quote', 2200); return; }
    toast('Preparing quote PDF…', 20000);
    let r; try { r = await quotePdf(note, pi, qid); } catch (err) { console.warn('v21fn quote pdf', err); toast('Could not make the quote PDF', 2400); return; }
    if (!r) { toast('Quote not found', 1800); return; }
    sendQuote.last = { name: r.name, size: r.blob.size, crop: r.crop };
    const file = typeof File === 'function' ? new File([r.blob], r.name, { type: 'application/pdf' }) : null;
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      hideToasts();
      try { await navigator.share({ files: [file], title: r.name }); toast('Quote sent ✓', 1600); sendQuote.last.via = 'share'; return 'share'; }
      catch (err) { if (err && err.name === 'AbortError') { toast('Quote not sent', 1400); return 'cancel'; } }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    sendQuote.last.via = 'download';
    toast('Quote PDF saved — ' + r.name, 3000);
    return 'download';
  }
  if (typeof v7OverlayHook === 'function') {
    const _ov = v7OverlayHook;
    v7OverlayHook = function (pi) {
      _ov.apply(this, arguments);
      try {
        const n = curNote(), rec = pageEls[pi], pg = n && n.pages[pi]; if (!rec || !rec.ov) return;
        rec.ov.querySelectorAll('.fn-qsend').forEach(b => b.remove());
        if (!pg || !pg.qsheet || sealedNote(n) || !window.V21ed) return;
        const s = S.scale;
        pg.qsheet.quotes.forEach((q, i) => {
          const L = V21ed.qLayout(q), b = document.createElement('button');
          b.type = 'button'; b.className = 'qs-ui fn-qsend'; b.dataset.q = q.id; b.textContent = '📤 Send PDF';
          b.title = 'Send this quote as a PDF'; b.setAttribute('aria-label', 'Send quote ' + (i + 1) + ' as a PDF');
          b.style.left = (L.notes.x + L.notes.w - 6) * s + 'px'; b.style.top = (L.notes.y + 4) * s + 'px';
          rec.ov.append(b);
        });
      } catch (err) { console.warn('v21fn quote button', err); }
    };
  }
  const PAGES = document.getElementById('pages');
  if (PAGES) {
    PAGES.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.fn-qsend'); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const pi = +b.closest('.page[data-pi]').dataset.pi; sendQuote(pi, b.dataset.q);
    }, true);
    PAGES.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.fn-qsend')) e.stopPropagation(); }, true);
  }

  /* ============================== 4. Calculator Board mode ============================== */
  const CB_LS = 'pencil-notes-v21fn-calc-board';
  const CB = Object.assign({ mode: 'calc', tab: 'area', w: '', l: '', unit: 'in', qty: '1', sheet: '4x8', cw: '', cl: '', waste: '10', cost: '', pct: '30', pmode: 'markup' }, (() => { try { return JSON.parse(LS.get(CB_LS, '{}')) || {}; } catch (_) { return {}; } })());
  const saveCB = () => LS.set(CB_LS, JSON.stringify(CB));
  const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(/[,$\s%]/g, '')); return isFinite(x) ? x : NaN; };
  const f2 = (x, d = 2) => isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d }) : '—';
  const money = x => isFinite(x) ? '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  function boardCalc(st = CB) {
    const toIn = v => st.unit === 'ft' ? v * 12 : v;
    const W = toIn(num(st.w)), Lh = toIn(num(st.l)), Q = Math.max(1, Math.round(num(st.qty) || 1));
    const each = W * Lh / 144, total = each * Q;
    const area = { each, total, qty: Q, ok: W > 0 && Lh > 0 };
    const SH = { '4x8': [48, 96], '5x10': [60, 120] };
    const sh = st.sheet === 'custom' ? [num(st.cw) * 12, num(st.cl) * 12] : SH[st.sheet] || SH['4x8'];
    const waste = Math.max(0, num(st.waste) || 0);
    let per = 0;
    if (area.ok && sh[0] > 0 && sh[1] > 0) per = Math.max(Math.floor(sh[0] / W) * Math.floor(sh[1] / Lh), Math.floor(sh[0] / Lh) * Math.floor(sh[1] / W));
    const sheetSq = sh[0] * sh[1] / 144;
    const byArea = area.ok && sheetSq > 0 ? Math.ceil(total * (1 + waste / 100) / sheetSq - 1e-9) : NaN;
    const byLayout = per > 0 ? Math.ceil(Q * (1 + waste / 100) / per - 1e-9) : NaN;
    const sheets = { per, sheetSq, waste, byArea, byLayout, count: per > 0 ? Math.max(byLayout, byArea) : byArea, tooBig: area.ok && per === 0, ok: area.ok && sheetSq > 0 };
    const cost = num(st.cost), pct = num(st.pct);
    let price = NaN, other = NaN;
    if (cost >= 0 && isFinite(pct)) {
      if (st.pmode === 'margin') { price = pct < 100 ? cost / (1 - pct / 100) : NaN; other = cost > 0 ? (price - cost) / cost * 100 : NaN; }
      else { price = cost * (1 + pct / 100); other = price > 0 ? (price - cost) / price * 100 : NaN; }
    }
    const pr = { cost, pct, price, profit: price - cost, other, ok: isFinite(price) && isFinite(cost) };
    return { area, sheets, price: pr };
  }
  function boardHTML() {
    const seg = (k, opts) => '<div class="fn-seg" data-seg="' + k + '">' + opts.map(([v, l]) => '<button type="button" data-v="' + v + '"' + (CB[k] === v ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>';
    const fld = (k, l, ph, mode = 'decimal') => '<label class="fn-f"><span>' + l + '</span><input data-k="' + k + '" inputmode="' + mode + '" autocomplete="off" placeholder="' + ph + '" value="' + escH(CB[k]) + '"></label>';
    const dimRows = '<div class="fn-grid">' + fld('w', 'Width', CB.unit === 'ft' ? 'ft' : 'in') + '<span class="fn-x">×</span>' + fld('l', 'Length', CB.unit === 'ft' ? 'ft' : 'in') + '</div>' +
      '<div class="fn-grid2">' + seg('unit', [['in', 'inches'], ['ft', 'feet']]) + fld('qty', 'Qty', '1', 'numeric') + '</div>';
    let body = '';
    if (CB.tab === 'area') body = dimRows + '<div class="fn-out" data-out="area"></div>';
    else if (CB.tab === 'sheets') body = dimRows + '<div class="fn-grid2">' + seg('sheet', [['4x8', '4×8'], ['5x10', '5×10'], ['custom', 'Custom']]) + fld('waste', 'Waste %', '10') + '</div>' +
      (CB.sheet === 'custom' ? '<div class="fn-grid">' + fld('cw', 'Sheet W (ft)', '4') + '<span class="fn-x">×</span>' + fld('cl', 'Sheet L (ft)', '8') + '</div>' : '') + '<div class="fn-out" data-out="sheets"></div>';
    else body = '<div class="fn-grid">' + fld('cost', 'Cost $', '0.00') + '<span class="fn-x">+</span>' + fld('pct', CB.pmode === 'margin' ? 'Margin %' : 'Markup %', '30') + '</div>' +
      seg('pmode', [['markup', 'Markup on cost'], ['margin', 'Target margin']]) + '<div class="fn-out" data-out="price"></div>';
    return '<div class="fn-tabs" role="tablist">' + [['area', 'Area'], ['sheets', 'Sheets'], ['price', 'Price']].map(([v, l]) => '<button type="button" role="tab" data-tab="' + v + '"' + (CB.tab === v ? ' class="on" aria-selected="true"' : '') + '>' + l + '</button>').join('') + '</div>' + body;
  }
  function boardResultText() {
    const r = boardCalc();
    if (CB.tab === 'area') return r.area.ok ? f2(r.area.total) + ' sq ft' : '';
    if (CB.tab === 'sheets') return r.sheets.ok && isFinite(r.sheets.count) ? r.sheets.count + ' sheets' : '';
    return r.price.ok ? money(r.price.price) : '';
  }
  function paintBoardOut(root) {
    const o = root.querySelector('.fn-out'); if (!o) return;
    const r = boardCalc();
    if (CB.tab === 'area') {
      o.innerHTML = r.area.ok ? '<b>' + f2(r.area.total) + ' sq ft</b><small>' + f2(r.area.each) + ' sq ft each × ' + r.area.qty + '</small>' : '<small>Type width and length</small>';
    } else if (CB.tab === 'sheets') {
      const s = r.sheets;
      if (!r.area.ok) o.innerHTML = '<small>Type the piece width and length</small>';
      else if (!s.ok) o.innerHTML = '<small>Type the sheet size</small>';
      else o.innerHTML = '<b>' + s.count + ' sheet' + (s.count === 1 ? '' : 's') + '</b><small>' + (s.tooBig ? 'Piece is bigger than the sheet — counted by area' : s.per + ' per sheet') + ' · ' + f2(r.area.total) + ' sq ft + ' + f2(s.waste, 1) + '% waste</small>';
    } else {
      const p = r.price;
      o.innerHTML = p.ok ? '<b>' + money(p.price) + '</b><small>Profit ' + money(p.profit) + ' · ' + (CB.pmode === 'margin' ? 'markup ' : 'margin ') + f2(p.other, 1) + '%</small>' : '<small>' + (CB.pmode === 'margin' && num(CB.pct) >= 100 ? 'Margin must be under 100%' : 'Type the cost') + '</small>';
    }
  }
  function renderBoard(root) {
    const pane = root.querySelector('.fn-board'); if (!pane) return;
    pane.innerHTML = boardHTML(); paintBoardOut(pane);
  }
  function setCalcMode(mode) {
    const el = document.getElementById('fhCalc'); if (!el) return;
    CB.mode = mode === 'board' ? 'board' : 'calc'; saveCB();
    el.classList.toggle('fn-board-on', CB.mode === 'board');
    el.querySelectorAll('.fn-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === CB.mode));
    const t = el.querySelector('.fh-calc-title'); if (t) t.textContent = CB.mode === 'board' ? 'Board math' : 'Calculator';
    if (CB.mode === 'board') renderBoard(el);
  }
  function enhanceCalc() {
    const el = document.getElementById('fhCalc'); if (!el || el._v21fn) return el;
    el._v21fn = true;
    const bar = el.querySelector('.fh-calc-sizebar');
    if (bar) bar.insertAdjacentHTML('afterbegin', '<div class="fn-mode" role="group" aria-label="Calculator mode"><button type="button" data-mode="calc">Calc</button><button type="button" data-mode="board">Board</button></div>');
    const keys = el.querySelector('.fh-calc-hist') || el.querySelector('.fh-calc-keys');
    const pane = document.createElement('div'); pane.className = 'fn-board'; keys.after(pane);
    el.addEventListener('pointerdown', ev => { if (ev.target.closest('.fn-board, .fn-mode')) ev.stopPropagation(); }, true);
    el.addEventListener('click', ev => {
      const m = ev.target.closest('.fn-mode [data-mode]'); if (m) { ev.preventDefault(); setCalcMode(m.dataset.mode); return; }
      if (CB.mode === 'board' && ev.target.closest('[data-a="copy"]')) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        const t = boardResultText(); if (!t) { toast('Nothing to copy yet', 1400); return; }
        (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Copied ' + t, 1400), () => toast(t, 2000));
        return;
      }
      const tb = ev.target.closest('.fn-board [data-tab]'); if (tb) { CB.tab = tb.dataset.tab; saveCB(); renderBoard(el); return; }
      const sg = ev.target.closest('.fn-board .fn-seg [data-v]');
      if (sg) { CB[sg.closest('.fn-seg').dataset.seg] = sg.dataset.v; saveCB(); renderBoard(el); }
    }, true);
    el.addEventListener('input', ev => {
      const i = ev.target.closest('.fn-board input[data-k]'); if (!i) return;
      CB[i.dataset.k] = i.value; saveCB(); paintBoardOut(el.querySelector('.fn-board'));
    });
    // keep the panel on screen when it grows (S/M/L or the resize handle)
    const clampPos = () => { if (el.hidden) return; const r = el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      if (r.right > vw - 8) el.style.left = Math.max(8, vw - r.width - 8) + 'px';
      if (r.bottom > vh - 8 && r.height < vh - 16) el.style.top = Math.max(8, vh - r.height - 8) + 'px'; };
    if (self.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(clampPos)).observe(el);
    setCalcMode(CB.mode);
    return el;
  }
  if (window.V21fh && typeof V21fh.openCalc === 'function') {
    const _open = V21fh.openCalc;
    V21fh.openCalc = function () { const r = _open.apply(this, arguments); enhanceCalc(); return r; };
    const _tog = V21fh.toggleCalc;
    if (_tog) V21fh.toggleCalc = function () { const r = _tog.apply(this, arguments); enhanceCalc(); return r; };
  }
  // The top-bar button calls the closure's own toggleCalc; enhance on its click too.
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#calcBtn')) setTimeout(enhanceCalc, 0); }, true);

  /* ============================== 5. One backup button + end-of-day reminder ============================== */
  const EOD_LS = 'pnEodReminder', EOD_DISMISS = 'pnEodDismissed', EDIT_LS = 'pnLastEditAt', FIRST_EDIT = 'pnFirstEditToday';
  const EOD_HOUR = 16, EOD_MIN_WORK = 30 * 60 * 1000;
  const dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return +d; };
  const lastBackup = () => +LS.get('lastBackupAt', 0) || 0;
  const eodOn = () => LS.get(EOD_LS, 'on') !== 'off';
  function lastBackupText() {
    const t = lastBackup(); if (!t) return 'No backup yet';
    const d = new Date(t), today = dayKey() === dayKey(t), yest = dayKey(t) === dayKey(Date.now() - 864e5);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return 'Last backup ' + (today ? 'today ' + time : yest ? 'yesterday ' + time : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + time);
  }
  function backup() { const f = window.V21eq && V21eq.backupNow; const p = f ? f() : Promise.resolve(document.getElementById('exportBtn') && document.getElementById('exportBtn').click()); return Promise.resolve(p).then(r => { checkEod(); refreshBackupLabels(); return r; }); }
  function refreshBackupLabels() {
    const b = document.getElementById('exportBtn');
    if (b) { b.textContent = '☁️ Back up'; b.title = 'Back up to Files / iCloud · ' + lastBackupText(); }
  }
  { const b = document.getElementById('exportBtn'); if (b) { b.onclick = e => { e && e.preventDefault(); backup(); }; refreshBackupLabels(); } }

  function noteEdit() {
    const now = Date.now();
    if (now - (+LS.get(EDIT_LS, 0) || 0) < 5000) return;
    LS.set(EDIT_LS, now);
    const fe = String(LS.get(FIRST_EDIT, '')).split('|');
    if (fe[0] !== dayKey()) LS.set(FIRST_EDIT, dayKey() + '|' + now);
    clearTimeout(noteEdit._t); noteEdit._t = setTimeout(checkEod, 1500);
  }
  if (typeof saveNote === 'function' && !saveNote._v21fn) {
    const _sn = saveNote;
    saveNote = function () { const r = _sn.apply(this, arguments); try { noteEdit(); } catch (_) {} return r; };
    saveNote._v21fn = true;
  }
  function eodDue(force) {
    if (force) return true;
    if (!eodOn() || LS.get(EOD_DISMISS, '') === dayKey()) return false;
    const now = Date.now(), last = +LS.get(EDIT_LS, 0) || 0;
    if (last < startOfDay() || lastBackup() >= startOfDay()) return false;   // no edits today, or already backed up today
    if (new Date().getHours() < EOD_HOUR) return false;
    const fe = String(LS.get(FIRST_EDIT, '')).split('|');
    return fe[0] === dayKey() && now - (+fe[1] || now) >= EOD_MIN_WORK;   // you have been working today, not just one quick edit
  }
  function checkEod(force) {
    let b = document.getElementById('fnEodBanner');
    if (!eodDue(force)) { if (b) b.hidden = true; document.body.classList.remove('fn-eod-show'); return false; }
    if (!b) {
      b = document.createElement('div'); b.id = 'fnEodBanner'; b.setAttribute('role', 'status');
      b.innerHTML = '<span class="fn-eod-t"><b>🌙 End of day</b> You edited notes today but haven’t backed up yet.</span>' +
        '<button type="button" class="primary" data-eod="now">Back up</button><button type="button" data-eod="later">Not today</button><button type="button" class="fn-eod-off" data-eod="off" aria-label="Turn off the end-of-day reminder">Turn off</button>';
      document.body.append(b);
      b.addEventListener('click', e => {
        const k = e.target.closest('[data-eod]'); if (!k) return;
        if (k.dataset.eod === 'now') { b.hidden = true; document.body.classList.remove('fn-eod-show'); backup(); }
        else if (k.dataset.eod === 'later') { LS.set(EOD_DISMISS, dayKey()); checkEod(); }
        else { LS.set(EOD_LS, 'off'); checkEod(); toast('End-of-day reminder off — turn it on in Settings › Storage & backup', 3200); }
      });
    }
    document.documentElement.style.setProperty('--fn-banner-top', Math.round(topbarBottom() + 8) + 'px');
    b.hidden = false; document.body.classList.add('fn-eod-show');
    return true;
  }
  setInterval(() => { if (!document.hidden) checkEod(); }, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkEod(); refreshBackupLabels(); } });

  // Settings: storage rows merged, Idea Board copy, version + changelog
  if (typeof settingsSections === 'function') {
    const _ss = settingsSections;
    settingsSections = function () {
      const secs = _ss.apply(this, arguments).map(sec => {
        if (sec.id === 'quotes') return Object.assign({}, sec, {
          h: 'Idea Board',
          note: 'Tap 💡 Idea Board in the top bar. Write anywhere with Apple Pencil, tap Note for a sticky note, link notes with Arrow and group them with Frame. Insert adds photos, PDFs and links. Hold a note with a finger to move it; tap it to resize or delete. Quotes live on your note pages: ＋ Insert → 🧾 Quote sheet.',
          rows: (sec.rows || []).map(r => /Open the Idea Board/.test(r.label || '') ? Object.assign({}, r, { sub: 'Pencil canvas · notes, arrows, frames, photos, PDFs and links' }) : r)
        });
        if (sec.id === 'storage') {
          const keep = (sec.rows || []).filter(r => !/Back up now|Export backup|Back up to Files/i.test(r.label || ''));
          const imp = keep.findIndex(r => /Import backup/i.test(r.label || ''));
          const rows = [{ label: '☁️ Back up to Files / iCloud', sub: lastBackupText() + ' · one file with everything; locked notes stay encrypted', fn: () => backup() }];
          const rem = { label: '🌙 End-of-day reminder: ' + (eodOn() ? 'On' : 'Off'), sub: 'A gentle banner after 4 PM if you edited notes and haven’t backed up today', fn: () => { LS.set(EOD_LS, eodOn() ? 'off' : 'on'); checkEod(); openSettings('storage'); } };
          if (imp >= 0) keep.splice(imp + 1, 0, rem); else keep.push(rem);
          return Object.assign({}, sec, { rows: rows.concat(keep) });
        }
        return sec;
      });
      secs.push({ id: 'about', h: 'Version', rows: [{ label: '✨ Pencil Notes ' + appVersion() + ' — What’s new…', sub: 'See what changed in this update', fn: () => showWhatsNew(true) }] });
      return secs;
    };
  }
  if (typeof openSettings === 'function' && !openSettings._v21fn) {
    const _os = openSettings;
    openSettings = async function () {
      const r = await _os.apply(this, arguments);
      try {
        const sec = document.querySelector('#settingsWrap .set-sec[data-sec="about"]');
        if (sec && !sec.querySelector('.fn-changelog')) sec.insertAdjacentHTML('beforeend', '<div class="fn-changelog">' + CHANGELOG.slice(0, 4).map(c => '<div class="fn-cl"><b>' + escH(c.v) + (c.v === appVersion() ? ' <i>this version</i>' : '') + '</b><ul>' + c.items.slice(0, c.v === appVersion() ? 6 : 2).map(t => '<li>' + escH(t) + '</li>').join('') + '</ul></div>').join('') + '</div>');
      } catch (_) {}
      return r;
    };
    openSettings._v21fn = true;
  }
  // More menu: the note's Share › backup row uses the same name
  try {
    if (typeof moreItems === 'function') {
      const _mi = moreItems;
      moreItems = function () {
        const r = _mi.apply(this, arguments);
        const fix = it => { if (it && /Back up all notes/.test(it.l || '')) { it.l = 'Back up to Files / iCloud'; it.s = lastBackupText(); it.fn = () => backup(); } };
        (Array.isArray(r) ? r : []).forEach(sec => { if (sec && Array.isArray(sec.rows)) sec.rows.forEach(fix); });
        return r;
      };
    }
  } catch (_) {}

  /* ============================== 6. Version badge, What's new, update banner ============================== */
  const SEEN_LS = 'pnLastSeenVersion';
  function makeBadge(id) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fn-ver'; b.id = id;
    b.textContent = appVersion(); b.title = 'Pencil Notes ' + appVersion() + ' — tap for what’s new';
    b.setAttribute('aria-label', 'Version ' + appVersion() + ', what’s new');
    b.addEventListener('click', e => { e.stopPropagation(); showWhatsNew(true); });
    return b;
  }
  function mountBadge() {
    const brand = $1('#sidebar .brand');
    if (brand && !brand.querySelector('.fn-ver')) brand.append(makeBadge('fnVersionBadge'));
    const title = $1('#noteTitle'), bar = $1('#topbar');
    if (bar && title && !document.getElementById('fnTopVer')) {
      const b = makeBadge('fnTopVer'); b.classList.add('fn-ver-top');
      title.after(b);   // sits next to the title, left of the spacer — never in the undo / Idea Board / calc / bell cluster
    }
  }
  function showWhatsNew(manual) {
    let w = document.getElementById('fnWhatsNew');
    if (!w) { w = document.createElement('div'); w.id = 'fnWhatsNew'; document.body.append(w); }
    const v = appVersion();
    w.innerHTML = '<div class="fn-wn" role="dialog" aria-label="What’s new in ' + escH(v) + '">' +
      '<div class="fn-wn-head"><span class="fn-wn-badge">' + escH(v) + '</span><h3>' + (manual ? 'What’s new in ' + escH(v) : 'Updated to ' + escH(v) + ' — What’s new') + '</h3>' +
      '<button type="button" class="fn-wn-x" data-wn="close" aria-label="Close">✕</button></div>' +
      '<ul>' + changes(v).map(t => '<li>' + escH(t) + '</li>').join('') + '</ul>' +
      '<div class="fn-wn-btns"><button type="button" data-wn="all">All versions</button><button type="button" class="primary" data-wn="close">Got it</button></div></div>';
    w.hidden = false;
    w.onclick = e => {
      const k = e.target.closest('[data-wn]'); if (!k && e.target !== w) return;
      LS.set(SEEN_LS, v); w.hidden = true;
      if (k && k.dataset.wn === 'all' && typeof openSettings === 'function') openSettings('about').then(() => { const s = document.querySelector('#settingsWrap .set-sec[data-sec="about"]'); if (s) s.scrollIntoView({ block: 'start' }); });
    };
    return w;
  }
  // One-time card: only for people updating from an older version (a fresh install has no old service worker).
  const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  function maybeWhatsNew() {
    const seen = LS.get(SEEN_LS, ''), v = appVersion();
    if (seen === v) return false;
    if (!seen && !hadController) { LS.set(SEEN_LS, v); return false; }   // brand-new install: nothing to announce
    showWhatsNew(false); return true;
  }
  function updateBanner(onTap) {
    let b = document.getElementById('fnUpdate');
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'fnUpdate'; document.body.append(b); }
    b.innerHTML = '<b>⬆︎ Update ready</b> — tap to reload';
    b.style.top = Math.round(topbarBottom() + 8) + 'px';
    b.hidden = false;
    b.onclick = () => { b.innerHTML = '<b>Updating…</b>'; onTap(); };
    return b;
  }
  function watchSW() {
    const sw = navigator.serviceWorker; if (!sw || location.protocol === 'file:') return;
    let reloading = false;
    const reloadOnce = () => { if (reloading) return; reloading = true; location.reload(); };
    const offer = reg => updateBanner(() => {
      if (reg && reg.waiting) { sw.addEventListener('controllerchange', reloadOnce); reg.waiting.postMessage({ type: 'SKIP_WAITING' }); setTimeout(reloadOnce, 2500); }
      else reloadOnce();
    });
    // sw.js activates new versions right away, so a controller change while this page runs means new files are ready.
    if (hadController) sw.addEventListener('controllerchange', () => { if (!reloading) offer(null); });
    sw.getRegistration().then(reg => {
      if (!reg) return;
      if (reg.waiting && sw.controller) offer(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && sw.controller && reg.waiting) offer(reg); });
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  function boot() {
    mountBadge(); refreshBackupLabels();
    setTimeout(() => { maybeWhatsNew(); checkEod(); }, 700);
    watchSW();
  }
  const whenReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 60); setTimeout(() => clearInterval(t), 20000); };
  whenReady(boot);
  try { if (typeof curNote === 'function' && curNote() && typeof buildPages === 'function') buildPages(); } catch (_) {}

  window.V21fn = {
    version: VERSION, CHANGELOG, hideToasts, placeToast, todoBoxRects,
    addPhotoBlob, addPdfFile, addLink, cleanUrl, prettyTitle, mediaIdle, thumbs, insert: EXT.insert, openMedia: EXT.openMedia,
    quotePdf, sendQuote, boardCalc, setCalcMode, enhanceCalc, CB,
    backup, lastBackupText, checkEod, eodDue, eodOn,
    showWhatsNew, maybeWhatsNew, updateBanner, mountBadge
  };
})();
