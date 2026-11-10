/* Pencil Notes v21er — mock only. Loads after v21eq.
   1. Meeting Notes: no more auto-grow (v21ep.js patched). Each action item gets its own "+ line" button
      (inside the Action Items box, in the right-hand bell column on the item's last line — beside the bell on a
      1-line item; no extra height, never over the ink area) that adds exactly ONE ruled line to that item
      (same checkbox). A small "−" shows only on an EMPTY extra last line and removes it. "+ Action task" is unchanged.
   2. Audit fixes: Cmd/Ctrl+Z on the Idea Board · lasso "Send to Idea Board" (copy → new card in empty visible space) ·
      board tool resets to Pen when the board closes · tidy copy · 44px chips · stop the retired email-sync timer.
   (Board canvas cap, Escape, Backspace, https:// links: v21eo.js · thumbnails, backup banner: v21eq.js.)
   IndexedDB data is never deleted. */
(function () {
  'use strict';
  const VERSION = 'v21er';
  const $1 = s => document.querySelector(s);
  const t0 = (m, ms) => { if (typeof toast === 'function') toast(m, ms); };
  const ready = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 50); setTimeout(() => clearInterval(t), 15000); };
  const sealed = n => typeof isSealed === 'function' && n && isSealed(n);
  const EP = window.V21ep;
  const ROW = typeof MEET !== 'undefined' ? MEET.rowH : 56;
  const boardOpen = () => !!(window.V21eo && V21eo.isOpen && V21eo.isOpen());

  /* ======================= 1. "+ line" per action item ======================= */
  function addLine(pi, id) {
    const n = curNote(), pg = n && n.pages[pi]; if (!EP || !pg || sealed(n)) return false;
    const t = (pg.tasks || []).find(x => x.id === id); if (!t) return false;
    pushHistory();
    const before = EP.linesOf(t);
    const ok = EP.growTask(pi, t);
    if (!ok) { S.undo.pop(); if (typeof updateUndo === 'function') updateUndo(); return false; }
    if (EP.linesOf(t) === before) t0('Continued on the next page', 1400);
    return true;
  }
  function removeLine(pi, id) {
    const n = curNote(), pg = n && n.pages[pi]; if (!EP || !pg) return false;
    const t = (pg.tasks || []).find(x => x.id === id); if (!t) return false;
    return EP.shrinkLast(pi, t);
  }
  function lineButtons(pi) {
    const n = curNote(), pg = n && n.pages[pi], rec = pageEls[pi];
    if (!rec) return;
    rec.ov.querySelectorAll('.meet-addline, .meet-delline').forEach(b => b.remove());
    if (!EP || !EP.isMeeting(pg) || sealed(n)) return;
    const s = S.scale;
    /* v21er right column: the bell column (x 848–960, right of the ink area which ends at 840), inside the box.
       Each item's LAST line holds [＋ line | slot]; the slot is the bell for a 1-line item, or "−" on an empty extra
       line. The bell stays on line 1 (full column width on multi-line items). No extra height, never over ink. */
    const colL = EP.BELL_X * s, colR = (EP.BELL_X + EP.BELL_W) * s, SLOT = 44;
    const plusW = Math.max(44, colR - SLOT - colL), plusL = colR - SLOT - plusW;
    const h = Math.max(44, Math.round(52 * s));
    for (const t of EP.meetTasks(pg)) {
      const lines = EP.linesOf(t);
      const lastTop = (t.y - 8 + (lines - 1) * ROW) * s;
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'meet-addline'; add.dataset.id = t.id; add.textContent = '＋ line';
      add.setAttribute('aria-label', 'Add a writing line to this action item'); add.title = 'Add one more line to this action item';
      Object.assign(add.style, { left: plusL + 'px', top: lastTop + 'px', width: plusW + 'px', height: h + 'px' });
      rec.ov.append(add);
      if (lines === 1) {
        /* 1-line item: the bell shares line 1 → compact 44px bell at the far right, "＋ line" to its left */
        const bell = rec.ov.querySelector(`.meet-bell[data-id="${t.id}"]`);
        if (bell) { bell.classList.add('er-compact'); Object.assign(bell.style, { left: colR - SLOT + 'px', width: SLOT + 'px', height: h + 'px' }); }
      } else if (EP.lastLineEmpty(pg, t)) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'meet-delline'; del.dataset.id = t.id; del.textContent = '−';
        del.setAttribute('aria-label', 'Remove the empty last line'); del.title = 'Remove this empty line';
        Object.assign(del.style, { left: colR - SLOT + 'px', top: lastTop + 'px', width: SLOT + 'px', height: h + 'px' });
        rec.ov.append(del);
      }
    }
  }
  const PAGES = $1('#pages');
  if (PAGES) {
    PAGES.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.meet-addline, .meet-delline')) e.stopPropagation(); }, true);  // a control, never a stroke
    PAGES.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.meet-addline, .meet-delline'); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const pi = +b.closest('.page[data-pi]').dataset.pi;
      if (b.classList.contains('meet-addline')) addLine(pi, b.dataset.id); else removeLine(pi, b.dataset.id);
    }, true);
  }

  /* ======================= overlay hook: + line buttons, chip hit areas ======================= */
  const _ov = v7OverlayHook;
  v7OverlayHook = function (pi) {
    const r = _ov.apply(this, arguments);
    try { lineButtons(pi); } catch (e) { console.warn('v21er lines', e); }
    try { chipVars(pi); clampDelButtons(pi); } catch (e) { console.warn('v21er chips', e); }
    return r;
  };
  /* status chip colours move from inline background/border to the ::before pill (44px hit area, same look) */
  function chipVars(pi) {
    const rec = pageEls[pi]; if (!rec) return;
    rec.ov.querySelectorAll('.qs-meta').forEach(b => {
      if (b.style.background) { b.style.setProperty('--er-chip-bg', b.style.background); b.style.background = ''; }
      if (b.style.borderColor) { b.style.setProperty('--er-chip-bd', b.style.borderColor); b.style.borderColor = ''; }
    });
  }
  /* portrait: the 44px "−" targets in the left margin no longer hang off the screen edge */
  function clampDelButtons(pi) {
    const rec = pageEls[pi]; if (!rec) return;
    const vw = document.documentElement.clientWidth;
    rec.ov.querySelectorAll('.qs-delrow, .td-delrow').forEach(b => {
      const r = b.getBoundingClientRect(); if (!r.width) return;
      if (r.left < 0) b.style.left = (parseFloat(b.style.left) - r.left) + 'px';
      if (r.right > vw) b.style.left = (parseFloat(b.style.left) - (r.right - vw)) + 'px';
    });
  }

  /* ======================= F2. Cmd/Ctrl+Z on the open Idea Board undoes the board ======================= */
  addEventListener('keydown', e => {
    if (!boardOpen()) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable], [contenteditable] *')) return;
    const k = (e.key || '').toLowerCase();
    if (!(e.metaKey || e.ctrlKey) || (k !== 'z' && k !== 'y')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const redo = k === 'y' || e.shiftKey;
    const b = document.getElementById(redo ? 'qbRedo' : 'qbUndo');
    if (b && !b.disabled) b.click();
  }, true);

  /* ======================= F5. lasso → 💡 Send to Idea Board (a copy, on a new card in empty visible space) ======================= */
  async function sendToIdeaBoard() {
    const s = selection; if (!s) return null;
    if (!s.ids || !s.ids.length) { t0('Select some handwriting first'); return null; }
    const m = $1('#lassoMenu');
    const n = ensureIdeaNote(); if (typeof ibSealed === 'function' && ibSealed()) { t0('🔒 Unlock the Idea Board first'); return null; }
    if (m) m.hidden = true;
    const src = { note: curNote(), pi: s.pi, ids: s.ids.slice(), quiet: true, move: false };
    if (!boardOpen()) { qbOpen(true, { quiet: true, mode: 'ideas' }); await new Promise(r => setTimeout(r, 40)); }
    const pg = n.pages[0];
    const t = cardFromInk(src, n, IPI, boardCols(pg)[0].id);
    if (!t) return null;
    /* place it in the first empty spot of what is visible on the board */
    const keep = [t.bx, t.by]; t.bx = -1e6; t.by = -1e6;
    let spot = null; try { spot = V21eo.freeSpot(t.bw, t.bh); } catch (_) {}
    if (spot) { t.bx = Math.max(20, Math.round(spot[0])); t.by = Math.max(20, Math.round(spot[1])); } else { t.bx = keep[0]; t.by = keep[1]; }
    try { V21eo.growWorldToFit(pg); } catch (_) {}
    saveNote(n, true);
    if (window.V21eo) { V21eo.ST.sel = { kind: 'card', id: t.id }; V21eo.render(); }
    t0('💡 Copied to the Idea Board — your note keeps the ink', 2200);
    return t;
  }
  function wireSend() {
    const send = $1('#lassoSend'); if (!send) return;
    send.innerHTML = '💡 Send to Idea Board';
    send.title = 'Copy the selected handwriting onto a new card on the Idea Board';
    send.setAttribute('aria-label', 'Send to Idea Board — copies the selection onto a new card');
    send.onclick = () => { sendToIdeaBoard(); };
    /* ⧉ rendered as an empty box on some systems: a drawn copy icon instead */
    const cp = $1('#lassoCopy');
    if (cp && !cp.querySelector('svg')) cp.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 15.5H5A1.5 1.5 0 0 1 3.5 14V5A1.5 1.5 0 0 1 5 3.5h9A1.5 1.5 0 0 1 15.5 5v.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
  }
  wireSend(); ready(wireSend);

  /* ======================= F9. board closes → the note tool is Pen again (not Lasso) ======================= */
  if (typeof qbOpen === 'function') {
    const _qo = qbOpen;
    qbOpen = function (on) {
      const wasBoard = boardOpen();
      const r = _qo.apply(this, arguments);
      if (on === false && wasBoard && typeof S !== 'undefined' && S.tool === 'lasso') {
        S.tool = 'pen'; try { localStorage.setItem('tool', 'pen'); } catch (_) {}
        if (typeof renderToolbar === 'function') renderToolbar();
      }
      return r;
    };
  }

  /* ======================= F10. stop the retired Quote Board email auto-sync (its data stays stored) ======================= */
  try {
    if (typeof QSync !== 'undefined' && QSync.timer) { clearInterval(QSync.timer); QSync.timer = null; }
    if (typeof qbAutoSync === 'function') {
      const _as = qbAutoSync;
      qbAutoSync = function () { const qn = typeof quoteNote === 'function' ? quoteNote() : null; if (!qn) return; return _as.apply(this, arguments); };
    }
  } catch (e) { console.warn('v21er sync', e); }

  /* ======================= boot ======================= */
  ready(() => {
    wireSend();
    try { if (curNote()) buildPages(); } catch (_) {}
  });

  window.V21er = { version: VERSION, addLine, removeLine, lineButtons, sendToIdeaBoard, ROW };
})();
