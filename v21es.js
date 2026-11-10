/* Pencil Notes v21es — mock only. Loads after v21er.
   1. Meeting Notes: every action item gets a "＋ | −" pair in the right-hand bell column (on the item's last line, beside the
      bell on a 1-line item — no extra height, never over the writing lines). "＋" adds one line; "−" removes the LAST extra line
      (a line with writing asks first), and on a 1-line item removes the WHOLE item (asks first when it has writing or a
      reminder). Items below move up with their ink, items waiting on a continuation page come back, and an emptied
      continuation page goes away. Everything is one Undo step. A removed item's reminder is cancelled with it.
   2. Idea Board (handwritten card titles, items inside cards, cards inside cards, hold-drag, vanishing-ink fixes): v21eo.js.
   3. Quote sheet totals (code in v21ee.js / v21el.js, marked v21es): integer-cent qty × price, per-M / per-C prices, commas,
      $, ea, leading-decimal prices, O/0 l/1 G/6 S/5; sizes never leak into Qty/Price; a digit that runs over a column divider
      stays in its own cell; the decimal point is recovered from the ink on every reader; blank/unread fields show "?" and are
      left out of the total; the read Qty and Price sit next to the ink as 44px tap-to-correct chips (a Pencil stroke that
      starts on a chip still writes — forwarded below).
   IndexedDB data is never deleted (removal edits the note itself and is undoable like any other edit). */
(function () {
  'use strict';
  const VERSION = 'v21es';
  const $1 = s => document.querySelector(s);
  const EP = window.V21ep;
  const ROW = typeof MEET !== 'undefined' ? MEET.rowH : 56;
  const sealed = n => typeof isSealed === 'function' && n && isSealed(n);
  const t0 = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  if (!EP || !EP.relayoutKeepInk) { console.warn('v21es: V21ep internals missing'); return; }
  const { INK_LEFT, INK_RIGHT, BELL_X, BELL_W } = EP;

  /* ---------------- geometry: the [＋][−] pair (+ bell on 1-line items) ---------------- */
  const TAP = 44;
  function cluster(s) {
    const inkR = INK_RIGHT * s, colR = (BELL_X + BELL_W) * s, pageR = PAGE_W * s, W = TAP * 3;
    let left = Math.max(inkR, colR - W);                                    // inside the box when it fits (landscape)
    if (left + W > pageR) left = Math.max(inkR, pageR - W);                 // portrait: run to the page edge, never over the writing lines
    /* an 820px-wide portrait iPad (scale 0.82) has 131.2px right of the lines → three 43.7px targets; 834px+ gets the full 44px */
    left = Math.ceil(left * 64) / 64;                                       // layout snaps to 1/64 px: never round onto the line
    const w = Math.min(TAP, Math.floor((pageR - left) / 3 * 64) / 64);
    return { left, w };
  }
  /* strokes that belong to an item: they start inside its rows (same rule the layout uses to move ink with items) */
  function ownStrokes(pg, t, fromLine = 0) {
    const y0 = fromLine ? t.y - 8 + fromLine * ROW : t.y - 12, y1 = t.y - 8 + EP.linesOf(t) * ROW + 6;
    const ids = new Set(t.kind === 'ink' && fromLine === 0 ? (t.strokeIds || []) : []);
    return (pg.strokes || []).filter(st => {
      if (st.id && ids.has(st.id)) return true;
      const pts = st.points || []; if (!pts.length) return false;
      if (!pts.some(q => q[0] >= INK_LEFT - 24 && q[0] <= INK_RIGHT + 40)) return false;
      const minY = Math.min(...pts.map(q => q[1]));
      return minY >= y0 && minY < y1;
    });
  }
  const textsIn = (pg, y0, y1) => (pg.texts || []).filter(x => x.y + 10 >= y0 && x.y + 10 < y1 && x.x < 960);
  const lineHasWriting = (pg, t) => !EP.lastLineEmpty(pg, t);
  const itemHasWriting = (pg, t) => {
    if (EP.hasInk(pg, t) || ownStrokes(pg, t).length) return true;
    const tx = (t.text || '').trim(); if (t.kind === 'typed' && tx && tx !== 'Action task' && tx !== 'New task') return true;   // the placeholder is not writing
    return textsIn(pg, t.y - 12, t.y - 8 + EP.linesOf(t) * ROW + 6).some(x => (x.text || '').trim());
  };
  const later = (n, pi) => n.pages.slice(pi + 1);

  /* ---------------- confirm sheet ---------------- */
  function confirmBox(title, body, okLabel) {
    return new Promise(res => {
      let el = document.getElementById('esConfirm');
      if (!el) { el = document.createElement('div'); el.id = 'esConfirm'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.append(el); }
      el.innerHTML = `<div class="es-c-card"><h3></h3><p></p><div class="es-c-acts"><button type="button" data-a="no">Cancel</button><button type="button" class="danger" data-a="ok"></button></div></div>`;
      el.querySelector('h3').textContent = title; el.querySelector('p').textContent = body; el.querySelector('[data-a="ok"]').textContent = okLabel || 'Remove';
      el.hidden = false;
      const done = v => { el.hidden = true; el.onclick = null; removeEventListener('keydown', key, true); res(v); };
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
      addEventListener('keydown', key, true);
      el.onclick = e => { const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === 'ok'); else if (e.target === el) done(false); };
      setTimeout(() => el.querySelector('[data-a="ok"]').focus(), 0);
    });
  }
  confirmBox.open = () => { const el = document.getElementById('esConfirm'); return !!(el && !el.hidden); };

  /* ---------------- core edits (pure: note in, note changed; callers handle history/render) ---------------- */
  function dropItemFromPage(pg, t) {
    EP.relayoutKeepInk(pg, null, () => {
      const kill = new Set(ownStrokes(pg, t));
      pg.strokes = (pg.strokes || []).filter(st => !kill.has(st));
      const y0 = t.y - 12, y1 = t.y - 8 + EP.linesOf(t) * ROW + 6, tk = new Set(textsIn(pg, y0, y1));
      if (tk.size) pg.texts = pg.texts.filter(x => !tk.has(x));
      const al = pg.bg && pg.bg.actionLines;
      pg.tasks = (pg.tasks || []).filter(x => x !== t);
      EP.reindex(pg);
      const real = EP.meetTasks(pg).filter(x => !x.continueFrom).length;
      if (pg.bg && Number.isInteger(al) && !t.continueFrom) pg.bg.actionLines = Math.max(real, al - 1);
      if (pg.bg && Number.isInteger(al) && t.continueFrom) pg.bg.actionLines = Math.max(real, al);
    });
  }
  function removeLastLine(pg, t) {
    const old = EP.linesOf(t); if (old < 2) return false;
    const kill = new Set(ownStrokes(pg, t, old - 1));
    /* plus any other mark sitting on that line (highlighter, a stray dot) */
    const y0 = t.y - 8 + (old - 1) * ROW, y1 = t.y - 8 + old * ROW + 8;
    for (const st of pg.strokes || []) { const pts = st.points || []; if (pts.length && pts.every(p => p[1] >= y0 && p[1] <= y1 && p[0] >= 40 && p[0] <= 960)) kill.add(st); }
    pg.strokes = (pg.strokes || []).filter(st => !kill.has(st));
    const tk = new Set(textsIn(pg, y0, y1)); if (tk.size) pg.texts = pg.texts.filter(x => !tk.has(x));
    t.meetLines = old - 1;
    EP.shiftBelow(pg, t.y + old * ROW - 8, -ROW);
    EP.relayout(pg);
    return true;
  }
  /* bring items back from the following continuation page while they fit; an item's own continuation merges back */
  function pullBack(n, pi) {
    const pg = n.pages[pi]; let changed = false, guard = 0;
    while (guard++ < 40) {
      const next = n.pages[pi + 1];
      if (!EP.isMeeting(next) || !next.bg.actionContinuation) break;
      const L = EP.layout(next);
      const first = EP.meetTasks(next).sort((a, b) => L.map.get(a) - L.map.get(b))[0];
      if (!first) break;
      const lines = EP.linesOf(first);
      if (EP.visualRows(pg) + lines > EP.maxRows(pg)) break;
      if (first.continueFrom) {
        const Lp = EP.layout(pg), mine = EP.meetTasks(pg).sort((a, b) => Lp.map.get(a) - Lp.map.get(b));
        const parent = mine[mine.length - 1];
        if (!parent || (parent.id !== first.continueFrom && parent.continueFrom !== first.continueFrom)) break;
        const strokes = ownStrokes(next, first), old = EP.linesOf(parent);
        EP.relayoutKeepInk(next, null, () => {
          const k = new Set(strokes); next.strokes = next.strokes.filter(s => !k.has(s));
          next.tasks = next.tasks.filter(x => x !== first); EP.reindex(next);
        });
        const dy = (parent.y + old * ROW) - first.y;
        for (const st of strokes) { for (const q of st.points) q[1] = +(q[1] + dy).toFixed(1); if (st.bb) { st.bb[1] += dy; st.bb[3] += dy; } }
        parent.meetLines = old + lines;
        pg.strokes = pg.strokes || []; pg.strokes.push(...strokes);
        EP.relayout(pg);
      } else {
        const strokes = ownStrokes(next, first);
        EP.relayoutKeepInk(next, null, () => {
          const k = new Set(strokes); next.strokes = next.strokes.filter(s => !k.has(s));
          next.tasks = next.tasks.filter(x => x !== first); EP.reindex(next);
        });
        first.meetingRow = 1e6;
        pg.tasks = pg.tasks || []; pg.strokes = pg.strokes || [];
        pg.tasks.push(first); pg.strokes.push(...strokes);
        EP.reindex(pg);
        EP.relayoutKeepInk(pg, new Map([[first, strokes]]));
      }
      changed = true;
    }
    /* an automatic continuation page that is now completely empty goes away (Undo brings it back) */
    if (emptyCont(n.pages[pi + 1])) { n.pages.splice(pi + 1, 1); changed = 'page'; }
    return changed;
  }
  function emptyCont(pg) {
    return !!(EP.isMeeting(pg) && pg.bg.actionContinuation && !(pg.tasks || []).length && !(pg.strokes || []).length &&
      !(pg.texts || []).some(x => (x.text || '').trim()) && !(pg.images || []).length && !(pg.links || []).length && !(pg.pdfs || []).length);
  }
  function removeItem(n, pi, t) {
    const pg = n.pages[pi];
    dropItemFromPage(pg, t);
    /* its continuation lines on the following pages go with it */
    const rootId = t.continueFrom || t.id;
    if (!t.continueFrom) for (const p of later(n, pi)) { if (!EP.isMeeting(p)) break; for (const f of EP.meetTasks(p).filter(x => x.continueFrom === rootId)) dropItemFromPage(p, f); }
    const pc = pullBack(n, pi);
    if (pi > 0 && emptyCont(n.pages[pi])) { n.pages.splice(pi, 1); return 'page'; }   // removed the last thing on a continuation page
    return pc;
  }

  /* ---------------- actions ---------------- */
  function rerender(n, pi, pagesChanged) {
    saveNote(n, true);
    if (pagesChanged) { buildPages(); }
    else { renderPageInk(pi); renderOverlay(pi); for (let k = pi + 1; k < n.pages.length; k++) if (pageEls[k]) { renderPageInk(k); renderOverlay(k); } }
    if (typeof renderPanel === 'function') renderPanel();
    if (typeof renderSidebar === 'function') renderSidebar();
  }
  let busy = false;
  async function minus(pi, id) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || sealed(n) || busy) return false;
    const t = (pg.tasks || []).find(x => x.id === id); if (!t) return false;
    busy = true;
    try {
      const lines = EP.linesOf(t);
      if (lines > 1) {
        if (lineHasWriting(pg, t) && !(await confirmBox('Remove this line and its writing?', 'The writing on this item’s last line will be removed with it. You can undo this.', 'Remove line'))) return false;
        pushHistory();
        removeLastLine(pg, t);
        const pc = pullBack(n, pi);
        rerender(n, pi, pc === 'page' || pc === true);
        return 'line';
      }
      const ink = itemHasWriting(pg, t), rem = !!t.due;
      if (ink || rem) {
        const body = (ink && rem) ? 'Its handwriting and its reminder will be removed too. You can undo this.'
          : rem ? 'Its reminder will be cancelled. You can undo this.' : 'Its handwriting will be removed too. You can undo this.';
        if (!(await confirmBox(rem && !ink ? 'Remove this action item and its reminder?' : 'Remove this action item and its writing?', body, 'Remove'))) return false;
      }
      pushHistory();
      const pc = removeItem(n, pi, t);
      rerender(n, pi, true);
      if (typeof actionToast === 'function') actionToast(rem ? 'Action item and its reminder removed' : 'Action item removed', 'Undo', () => restore(S.undo, S.redo));
      return 'item';
    } finally { busy = false; }
  }
  function plus(pi, id) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || sealed(n)) return false;
    const t = (pg.tasks || []).find(x => x.id === id); if (!t) return false;
    pushHistory();
    const before = EP.linesOf(t);
    const ok = EP.growTask(pi, t);
    if (!ok) { S.undo.pop(); if (typeof updateUndo === 'function') updateUndo(); return false; }
    if (EP.linesOf(t) === before) t0('Continued on the next page', 1400);
    return true;
  }

  /* ---------------- buttons ---------------- */
  function pairButtons(pi) {
    const n = curNote(), pg = n && n.pages[pi], rec = pageEls[pi];
    if (!rec) return;
    rec.ov.querySelectorAll('.es-pm').forEach(b => b.remove());
    rec.ov.querySelectorAll('.meet-addline, .meet-delline').forEach(b => b.remove());
    if (!EP.isMeeting(pg) || sealed(n)) return;
    const s = S.scale, C = cluster(s), h = Math.max(44, Math.round(52 * s));
    for (const t of EP.meetTasks(pg)) {
      const lines = EP.linesOf(t);
      const top = (t.y - 8 + (lines - 1) * ROW) * s;
      const box = document.createElement('div');
      box.className = 'es-pm'; box.dataset.id = t.id;
      Object.assign(box.style, { left: C.left + 'px', top: top + 'px', width: C.w * 2 + 'px', height: h + 'px' });
      const lastIsItem = lines === 1;
      box.innerHTML = `<button type="button" class="es-plus" data-id="${t.id}" aria-label="Add a line to this action item" title="Add a line">＋</button>` +
        `<button type="button" class="es-minus${lastIsItem ? ' es-item' : ''}" data-id="${t.id}" aria-label="${lastIsItem ? 'Remove this action item' : 'Remove the last line of this action item'}" title="${lastIsItem ? 'Remove this action item' : 'Remove the last line'}">−</button>`;
      box.querySelectorAll('button').forEach(b => { b.style.width = C.w + 'px'; });
      rec.ov.append(box);
      const bell = rec.ov.querySelector(`.meet-bell[data-id="${t.id}"]`);
      if (bell && lines === 1) {
        bell.classList.add('es-compact', 'er-compact');
        Object.assign(bell.style, { left: C.left + C.w * 2 + 'px', width: C.w + 'px', minWidth: C.w + 'px', height: h + 'px' });
      }
    }
  }
  const PAGES = $1('#pages');
  if (PAGES) {
    PAGES.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.es-pm button')) e.stopPropagation(); }, true);   // a control, never a stroke
    PAGES.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.es-pm button'); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const pi = +b.closest('.page[data-pi]').dataset.pi;
      if (b.classList.contains('es-plus')) plus(pi, b.dataset.id); else minus(pi, b.dataset.id);
    }, true);
  }
  const _ov = v7OverlayHook;
  v7OverlayHook = function (pi) {
    const r = _ov.apply(this, arguments);
    try { pairButtons(pi); } catch (e) { console.warn('v21es pair', e); }
    return r;
  };
  if (window.__ready && typeof curNote === 'function' && curNote()) { try { buildPages(); } catch (_) {} }

  /* ---------------- Idea Board: the left-edge resize strip no longer eats Pencil strokes ----------------
     (vanishing-ink cause: on the full-width board the 24px resize strip covers the whole left edge, top to bottom; a Pencil
     stroke starting there never wrote — it dragged the panel narrower, and a long one closed the board.) Now the strip is
     only the small grip in the middle (CSS), and a Pencil that lands on the grip writes on the board underneath. */
  const ideasOpen = () => !!(window.V21eo && V21eo.isOpen && V21eo.isOpen());
  window.addEventListener('pointerdown', e => {
    const h = e.target && e.target.closest && e.target.closest('#qbResize'); if (!h || e.pointerType === 'touch' || !ideasOpen()) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const under = document.elementsFromPoint(e.clientX, e.clientY).find(el => el !== h && !h.contains(el));
    if (under) under.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, pressure: e.pressure, buttons: e.buttons, button: e.button, tiltX: e.tiltX, tiltY: e.tiltY, width: e.width, height: e.height }));
  }, true);

  // Item 6: the read-value chips under a quote line have 44px tap targets; a Pencil stroke that starts on one still writes
  // (it is re-dispatched to the page underneath), a finger tap opens the correction sheet.
  let qtPenAt = 0;
  window.addEventListener('click', e => { if (Date.now() - qtPenAt < 1500 && e.target && e.target.closest && e.target.closest('.qt-wrapui')) { qtPenAt = 0; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'pen' || !e.isTrusted) return;
    const h = e.target && e.target.closest && e.target.closest('.qt-wrapui'); if (!h) return;
    e.stopImmediatePropagation(); e.preventDefault(); qtPenAt = Date.now();
    const under = document.elementsFromPoint(e.clientX, e.clientY).find(el => !el.closest('.qt-wrapui'));
    if (under) under.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, pressure: e.pressure, buttons: e.buttons, button: e.button, tiltX: e.tiltX, tiltY: e.tiltY, width: e.width, height: e.height }));
  }, true);

  window.V21es = { version: VERSION, VERSION, minus, plus, removeItem, removeLastLine, pullBack, pairButtons, cluster, confirmBox, ownStrokes, itemHasWriting };
})();
