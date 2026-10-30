/* Pencil Notes v21ec — move whole pages + add pages between pages, right in the note view.
   • Press and hold a page, then drag it up / down and drop it between any two pages (whole page moves: ink, text, tasks,
     badges, images, quote forms, recordings — same page id, so every link keeps working). One Undo step.
       – Finger: hold still ~0.45 s on an empty part of the page (fingers-scroll mode, i.e. once an Apple Pencil is in use).
         Moving the finger first = normal scroll; a second finger, the Pencil, or an object under the finger cancels it.
       – Footer grip “⠿ Page N of M” under every page: hold with finger, Pencil or mouse (always works, incl. board pages
         and finger-draws mode).
       – Apple Pencil on the page itself never picks the page up — it keeps writing.
   • “＋ Add page” sits right next to “Delete page” in each page footer and inserts a page directly after that page,
     matching its paper / template (planner → next day; PDF / recording → plain paper).
   Builds on v21eb. Mock only. */
(function () {
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  const TPL_COPY = ['planner', 'meeting', 'board', 'assistant'];
  const HOLD_TOUCH = 450, HOLD_GRIP = 300, SLOP = 10, EDGE = 90;

  /** A blank page that matches its neighbour's paper / template. */
  function pageLike(n, nb) {
    const k = nb && nb.bg && nb.bg.type === 'template' ? nb.bg.name : null;
    if (k && TPL_COPY.includes(k)) {
      const p = makeTemplatePage(k, n, k === 'planner' && nb.bg.date ? addDaysISO(nb.bg.date, 1) : undefined);
      if (k === 'planner') Object.assign(p.bg, { start: nb.bg.start, end: nb.bg.end, slot: nb.bg.slot });
      return p;
    }
    const p = newPage();
    p.paper = nb && nb.paper && !(nb.bg && nb.bg.type === 'pdf') ? nb.paper : null;   // null → follows the note's paper
    return p;
  }
  function afterPagesChange(n, focusPi) {
    saveNote(n, true); try { thumbCache.clear(); } catch (_) {}
    buildPages(); try { renderAll(); } catch (_) { renderPanel(); renderSidebar(); }
    if (focusPi != null) requestAnimationFrame(() => { const r = pageEls[focusPi]; if (r) $('#pages').scrollTo({ top: r.el.offsetTop - 8 }); });
  }
  function insertPageAt(at, likePi) {
    const n = curNote(); if (!n) return null;
    if (sealed(n)) { toast('🔒 Unlock the note first'); return null; }
    at = Math.max(0, Math.min(n.pages.length, at));
    const nb = n.pages[likePi != null ? likePi : (at > 0 ? at - 1 : 0)];
    pushHistory();
    const p = pageLike(n, nb); n.pages.splice(at, 0, p);
    afterPagesChange(n, at);
    toast(`＋ New page ${at + 1} of ${n.pages.length}`, 1600);
    return p;
  }
  const insertPage = (pi, where) => insertPageAt(where === 'before' ? pi : pi + 1, pi);
  function movePage(from, to) {
    const n = curNote(); if (!n) return false;
    if (sealed(n)) { toast('🔒 Unlock the note first'); return false; }
    to = Math.max(0, Math.min(n.pages.length - 1, to));
    if (from === to || !n.pages[from]) return false;
    pushHistory();
    const [pg] = n.pages.splice(from, 1); n.pages.splice(to, 0, pg);
    afterPagesChange(n, to);
    actionToast(`↕︎ Page ${from + 1} → position ${to + 1}`, 'Undo', () => restore(S.undo, S.redo), 5000);
    return true;
  }

  /* ---------- footer: ⠿ grip · ＋ Add page · Delete page ---------- */
  const _bp = buildPages;
  buildPages = function () {
    _bp.apply(this, arguments);
    pageEls.forEach((r, pi) => { const f = r.el.querySelector('.page-foot'); if (!f || f.querySelector('[data-addafter]')) return;
      const lab = f.querySelector('span');
      if (lab) { lab.classList.add('pg-grip'); lab.dataset.grip = pi; lab.title = 'Hold and drag to move this page'; lab.insertAdjacentHTML('afterbegin', '<b aria-hidden="true">⠿</b> '); }
      const add = document.createElement('button'); add.dataset.addafter = pi; add.textContent = '＋ Add page'; add.title = 'Insert a new page right after this one';
      const del = f.querySelector('[data-delpage]'); del ? f.insertBefore(add, del) : f.append(add); });
  };
  const PAGES = $('#pages');
  PAGES.addEventListener('click', e => { const b = e.target.closest('[data-addafter]'); if (!b) return; e.stopPropagation(); insertPage(+b.dataset.addafter, 'after'); });

  /* ---------- press-and-hold → drag whole page ---------- */
  let pend = null, D = null, swallowClick = false;
  const activeTouches = new Set();
  const piOf = el => { const p = el && el.closest('.page[data-pi]'); return p ? +p.dataset.pi : -1; };
  function bodyHoldOK(e) {
    if (e.pointerType !== 'touch' || fingerDrawOn() || activeTouches.size > 1) return false;
    if (!e.target.matches('.page canvas')) return false;               // only plain paper: not boards, overlays, buttons, badges
    const pi = piOf(e.target); if (pi < 0) return false;
    try { if (hitObject(pi, pagePt(e, pi))) return false; } catch (_) {}   // tasks / text / photos keep their own long-press
    return true;
  }
  PAGES.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') activeTouches.add(e.pointerId);
    if (D) return;
    if (pend) { cancelPend(); return; }                                 // 2nd finger / Pencil → it's a pinch or writing
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const grip = e.target.closest('.pg-grip');
    if (!grip && !bodyHoldOK(e)) return;
    const pi = grip ? +grip.dataset.grip : piOf(e.target);
    const n = curNote(); if (!n || !n.pages[pi] || n.pages.length < 2 || sealed(n)) return;
    if (grip) e.preventDefault();
    pend = { pid: e.pointerId, pi, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, type: e.pointerType, grip: !!grip };
    pend.timer = setTimeout(() => lift(pend), grip ? HOLD_GRIP : HOLD_TOUCH);
  }, true);
  function cancelPend() { if (pend) clearTimeout(pend.timer); pend = null; }
  addEventListener('pointermove', e => {
    if (pend && e.pointerId === pend.pid) { pend.x = e.clientX; pend.y = e.clientY; if (Math.hypot(pend.x - pend.x0, pend.y - pend.y0) > SLOP) cancelPend(); }
    if (D && e.pointerId === D.pid) { D.x = e.clientX; D.y = e.clientY; e.preventDefault(); track(); }
  }, true);
  const up = e => {
    activeTouches.delete(e.pointerId);
    if (pend && e.pointerId === pend.pid) cancelPend();
    if (D && e.pointerId === D.pid) drop(e.type === 'pointercancel');
  };
  addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  PAGES.addEventListener('scroll', () => { if (pend && !pend.grip) cancelPend(); }, { passive: true });
  document.addEventListener('touchmove', e => { if (D) e.preventDefault(); }, { passive: false });      // lifted: finger drags the page, not the scroll
  document.addEventListener('contextmenu', e => { if (pend || D) e.preventDefault(); }, true);
  document.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape' && D) drop(true); });

  function thumbOf(n, pg, w) {
    const c = document.createElement('canvas'), d = 2, h = Math.round(w * PAGE_H / PAGE_W); c.width = w * d; c.height = h * d;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    try { const ctx = c.getContext('2d'); ctx.scale(w * d / PAGE_W, h * d / PAGE_H); drawPageContent(ctx, n, pg);
      for (const t of pg.texts || []) { if (!t.text) continue; const sz = t.size || 24;
        ctx.fillStyle = typeof inkColor === 'function' ? inkColor(t.color || INK) : '#ddd'; ctx.font = `600 ${sz}px -apple-system, system-ui, sans-serif`; ctx.textBaseline = 'top';
        String(t.text).split('\n').slice(0, 12).forEach((ln, k) => ctx.fillText(ln, t.x + 4, t.y + 4 + k * sz * 1.3)); } } catch (_) {}
    return c;
  }
  function lift(p) {
    if (pend !== p) return; pend = null;
    if (typeof carry !== 'undefined' && carry) return;                 // an object long-press won the race
    if (typeof drawing !== 'undefined' && drawing && drawing.id === p.pid) try { cancelDrawing(); } catch (_) {}
    const n = curNote(), rec = pageEls[p.pi]; if (!n || !rec) return;
    try { navigator.vibrate && navigator.vibrate(15); } catch (_) {}
    const W = Math.min(220, Math.round(innerWidth * .3));
    const ghost = document.createElement('div'); ghost.className = 'pg-ghost';
    ghost.append(thumbOf(n, n.pages[p.pi], W)); ghost.insertAdjacentHTML('beforeend', `<div class="pg-ghost-lab">⠿ Page ${p.pi + 1}</div>`);
    const bar = document.createElement('div'); bar.className = 'pg-dropbar'; bar.hidden = true; bar.innerHTML = '<span></span>';
    document.body.append(ghost, bar); document.body.classList.add('pg-dragging'); rec.el.classList.add('pg-lifted');
    D = { pid: p.pid, from: p.pi, x: p.x, y: p.y, ghost, bar, W, ins: null, raf: 0 };
    track(); D.raf = requestAnimationFrame(autoScroll);
  }
  function track() {
    if (!D) return;
    const gh = D.ghost.offsetHeight || D.W * 1.43, left = D.x + 28 + D.W > innerWidth - 8 ? D.x - D.W - 28 : D.x + 28;   // beside the finger, never under it
    D.ghost.style.transform = `translate(${left}px, ${Math.max(8, Math.min(innerHeight - gh - 8, D.y - gh * .35))}px) rotate(-2deg)`;
    const rects = pageEls.map(r => r.el.getBoundingClientRect());
    let ins = rects.filter(r => r.top + r.height / 2 < D.y).length;
    if (ins === D.from || ins === D.from + 1) ins = null;              // dropping where it already is → no move
    D.ins = ins;
    if (ins == null) { D.bar.hidden = true; return; }
    const N = rects.length, a = rects[ins - 1], b = rects[ins], ref = b || a;
    const y = a && b ? (a.bottom + b.top) / 2 : b ? b.top - 10 : a.bottom + 10;
    D.bar.hidden = false; D.bar.style.left = ref.left + 'px'; D.bar.style.width = ref.width + 'px'; D.bar.style.top = (y - 3) + 'px';
    D.bar.firstChild.textContent = ins === 0 ? 'Move to the top — page 1' : ins === N ? `Move to the end — page ${N}` : `Drop between page ${ins} and ${ins + 1}`;
  }
  function autoScroll() {
    if (!D) return;
    const r = PAGES.getBoundingClientRect(); let v = 0;
    if (D.y < r.top + EDGE) v = -Math.ceil(36 * Math.min(1, (r.top + EDGE - D.y) / EDGE));
    else if (D.y > r.bottom - EDGE) v = Math.ceil(36 * Math.min(1, (D.y - (r.bottom - EDGE)) / EDGE));
    if (v) { PAGES.scrollTop += v; track(); }
    D.raf = requestAnimationFrame(autoScroll);
  }
  function drop(cancel) {
    const d = D; if (!d) return; D = null; cancelAnimationFrame(d.raf);
    d.ghost.remove(); d.bar.remove(); document.body.classList.remove('pg-dragging');
    document.querySelectorAll('.pg-lifted').forEach(x => x.classList.remove('pg-lifted'));
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
    if (!cancel && d.ins != null) movePage(d.from, d.ins > d.from ? d.ins - 1 : d.ins);
  }

  if (curNote()) buildPages();
  window.V21ec = { version: 'v21ec', insertPage, insertPageAt, movePage, pageLike, get dragging() { return !!D; }, get pending() { return !!pend; }, HOLD_TOUCH, HOLD_GRIP };
})();
