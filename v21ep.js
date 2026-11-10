/* Pencil Notes v21ep — Meeting action items grow writing lines; reminder is a bell at the far right.
   Mock only. Loads after v21eo.
   - The + Remind pill is replaced by a ≥36px bell pinned outside the ink area.
   - "Action task" is a faint placeholder and hides once the item has ink.
   - Writing near/onto the last line adds a ruled continuation line to the SAME item
     (one checkbox). Later items shift down. Overflow follows v21ek (continuation page).
   - New checkbox items still come only from + Action task (one per tap).
   - Extra empty lines may shrink back on reopen; ink is never discarded.
   v21er (patched in place): auto-grow is OFF and nothing shrinks on reopen. Each item gets its own
   "+ line" button (v21er.js) that calls growTask(); shrinkLast() removes one EMPTY extra line only.
   v21er: "+ line" / "−" live in the right-hand bell column (v21er.js) — items keep their original line heights, so
   there is no extra row and no layout migration. One shared layout() places, draws and overflows items in the same
   order as v21ep's rowY (checkbox slots, then continuation fragments); moved items carry their own ink.
   IndexedDB data is never deleted. */
(function () {
  'use strict';

  const ROW = MEET.rowH;
  const INK_LEFT = 108;
  const INK_RIGHT = 840;
  const BELL_X = 848;
  const BELL_W = 112;
  const GROW_PAD = 18;
  const AUTO_GROW = false;        // v21er: writing on the last line no longer adds lines (use "+ line")
  const SHRINK_ON_OPEN = false;   // v21er: saved meetLines are kept on reopen (an empty extra line may stay)

  const isMeeting = pg => !!(pg && pg.bg && pg.bg.name === 'meeting');
  const actionTop = pg => pg?.bg?.actionContinuation ? 180 : MEET.actionsTop;
  const maxRows = pg => Math.floor((PAGE_H - 21 - actionTop(pg)) / ROW);
  const linesOf = t => Math.max(1, Number.isInteger(t?.meetLines) ? t.meetLines : 1);
  let blockRowTap = false;                           // v21er: set for one guarded tap (see the pointerup guard)
  const spanOf = t => linesOf(t);                    // rows an item occupies in the box (no extra strip)
  const sealed = n => typeof isSealed === 'function' && n && isSealed(n);

  function isMeetTask(pg, t) {
    if (!t || !pg) return false;
    if (t.continueFrom) return true;
    if (t.meetingRow != null) return true;
    return t.y >= actionTop(pg) - 8;
  }
  function meetTasks(pg) {
    return (pg.tasks || []).filter(t => isMeetTask(pg, t))
      .sort((a, b) => (a.meetingRow ?? 1e9) - (b.meetingRow ?? 1e9) || a.y - b.y);
  }
  function slotTask(pg, i) { return meetTasks(pg).find(t => t.meetingRow === i); }

  /* v21er: one layout used by placement, drawing and overflow — continuation fragments first, then the
     checkbox slots in order, then continuation fragments (the same order v21ep's rowY used, so live notes open
     with every item exactly where it was); an item = its lines, an empty reserved slot = 1 row. */
  function layout(pg) {
    const tasks = meetTasks(pg);
    const real = tasks.filter(t => !t.continueFrom), frags = tasks.filter(t => t.continueFrom);
    const slots = Math.max(Number.isInteger(pg?.bg?.actionLines) ? pg.bg.actionLines : real.length, real.length);
    const byRow = new Map(real.filter(t => t.meetingRow != null).map(t => [t.meetingRow, t]));
    const map = new Map(), slotStart = [];
    let v = 0;
    for (let i = 0; i < slots; i++) {
      slotStart[i] = v;
      const t = byRow.get(i);
      if (t) { map.set(t, v); v += spanOf(t); } else v += 1;
    }
    for (const t of real) if (!map.has(t)) { map.set(t, v); v += spanOf(t); }
    for (const f of frags) { map.set(f, v); v += spanOf(f); }
    return { map, slotStart, total: v };
  }
  const yOfRow = (pg, v) => actionTop(pg) + (v + 1) * ROW - 44;

  function rowY(i, pg) {
    const L = layout(pg);
    const v = L.slotStart[i] != null ? L.slotStart[i] : L.total + Math.max(0, i - L.slotStart.length);
    return yOfRow(pg, v);
  }

  function visualRows(pg) {
    if (!pg) return 0;
    return layout(pg).total;
  }

  function rowsBefore(pg, t) {
    const v = layout(pg).map.get(t);
    return v == null ? 0 : v;
  }

  function itemBand(t) {
    const y0 = t.y - 10;
    const y1 = t.y - 8 + linesOf(t) * ROW + 6;
    return { x0: INK_LEFT - 12, y0, x1: INK_RIGHT + 8, y1 };
  }

  function strokeInBand(s, band) {
    if (!s || s.tool === 'highlighter') return false;
    return (s.points || []).some(p => p[0] >= band.x0 && p[0] <= band.x1 && p[1] >= band.y0 && p[1] <= band.y1);
  }

  function hasInk(pg, t) {
    if (!t || !pg) return false;
    if (t.kind === 'ink' && t.strokeIds && t.strokeIds.length) return true;
    const band = itemBand(t);
    return (pg.strokes || []).some(s => strokeInBand(s, band));
  }

  function lastUsedLine(pg, t) {
    let last = -1;
    const yBase = t.y - 8;
    const y1 = yBase + linesOf(t) * ROW + 8;
    for (const s of pg.strokes || []) {
      if (s.tool === 'highlighter') continue;
      for (const p of s.points || []) {
        if (p[0] < INK_LEFT - 8 || p[0] > INK_RIGHT + 16) continue;
        if (p[1] < t.y - 12 || p[1] > y1) continue;
        last = Math.max(last, Math.floor((p[1] - yBase) / ROW));
      }
    }
    if (t.kind === 'ink' && t.strokeIds && t.strokeIds.length && last < 0) last = 0;
    return last;
  }

  function shiftStrokes(pg, yCut, dy) {
    if (!dy || !pg) return;
    for (const s of pg.strokes || []) {
      const pts = s.points || [];
      if (!pts.length) continue;
      const minY = Math.min(...pts.map(p => p[1]));
      const inX = pts.some(p => p[0] >= INK_LEFT - 24 && p[0] <= INK_RIGHT + 40);
      if (!inX || minY < yCut - 2) continue;
      for (const p of pts) p[1] = +(p[1] + dy).toFixed(1);
      if (s.bb) { s.bb[1] += dy; s.bb[3] += dy; }
    }
  }

  function shiftBelow(pg, yCut, dy) {
    if (!dy) return;
    for (const t of meetTasks(pg)) if (t.y >= yCut - 2) t.y += dy;
    shiftStrokes(pg, yCut, dy);
  }

  function reindex(pg) {
    const tasks = meetTasks(pg).filter(t => !t.continueFrom);
    const frags = meetTasks(pg).filter(t => t.continueFrom);
    tasks.forEach((t, i) => { t.meetingRow = i; });
    frags.forEach((t, i) => { t.meetingRow = tasks.length + i; });
    if (pg.bg) pg.bg.actionLines = tasks.length;
  }

  function relayout(pg) {
    if (!isMeeting(pg)) return;
    const tasks = meetTasks(pg);
    for (const t of tasks) {
      if (!Number.isInteger(t.meetLines) || t.meetLines < 1) t.meetLines = 1;
      if (t.meetingRow == null && !t.continueFrom) {
        const i = tasks.filter(x => !x.continueFrom).indexOf(t);
        t.meetingRow = i < 0 ? 0 : i;
      }
    }
    const L = layout(pg);
    for (const t of tasks) {
      t.y = yOfRow(pg, L.map.has(t) ? L.map.get(t) : 0);
      if (t.kind === 'ink') t.x = Math.max(t.x || INK_LEFT, INK_LEFT - 4);
      else t.x = 62;
      t.h = Math.max(36, linesOf(t) * ROW - 20);
      t.w = Math.min(t.w || (INK_RIGHT - 62), INK_RIGHT - (t.x || 62));
    }
    const real = tasks.filter(t => !t.continueFrom).length;
    if (!Number.isInteger(pg.bg.actionLines) || pg.bg.actionLines < real) pg.bg.actionLines = real;
  }

  function migrateMeet(pg) {
    if (!isMeeting(pg)) return;
    const tasks = meetTasks(pg);
    const legacy = new Set();
    for (const t of tasks) {
      if (!Number.isInteger(t.meetLines) || t.meetLines < 1) { t.meetLines = 1; legacy.add(t); }
    }
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.continueFrom) continue;
      /* v21er: items that already carry a saved meetLines keep it (no ink-driven growth = no auto-grow) */
      if (!AUTO_GROW && !legacy.has(t)) continue;
      const reserved = (pg.bg.actionLines > (t.meetingRow ?? i) + 1) && !tasks[i + 1];
      const nextY = tasks[i + 1]
        ? tasks[i + 1].y - 8
        : (reserved ? rowY((t.meetingRow ?? i) + 1, pg) - 8 : actionTop(pg) + maxRows(pg) * ROW);
      let cover = linesOf(t);
      const yBase = t.y - 8;
      for (const s of pg.strokes || []) {
        if (s.tool === 'highlighter') continue;
        for (const p of s.points || []) {
          if (p[0] < INK_LEFT - 8 || p[0] > INK_RIGHT + 16) continue;
          if (p[1] >= t.y - 12 && p[1] < nextY) cover = Math.max(cover, Math.floor((p[1] - yBase) / ROW) + 1);
        }
      }
      const room = Math.max(1, maxRows(pg) - rowsBefore(pg, t));
      t.meetLines = Math.max(1, Math.min(cover, room));
    }
    if (!Number.isInteger(pg.bg.actionLines)) pg.bg.actionLines = tasks.filter(t => !t.continueFrom).length;
    else pg.bg.actionLines = Math.max(pg.bg.actionLines, tasks.filter(t => !t.continueFrom).length);
  }

  function takeItemStrokes(pg, t) {
    const band = itemBand(t);
    const keep = [], move = [];
    for (const s of pg.strokes || []) (strokeInBand(s, band) ? move : keep).push(s);
    pg.strokes = keep;
    return move;
  }

  /* v21er: relayout a page and move every item's own ink (strokes starting in its band) by exactly
     as much as the item moved. `extra` = Map(task → strokes) for items whose ink was just brought over. */
  function relayoutKeepInk(pg, extra, mutate) {
    const tasks = meetTasks(pg), owned = new Map(), oldY = new Map(tasks.map(t => [t, t.y]));
    const claimed = new Set();
    if (extra) for (const [t, list] of extra) { owned.set(t, list.slice()); list.forEach(x => claimed.add(x)); }
    for (const st of pg.strokes || []) {
      if (claimed.has(st)) continue;
      const pts = st.points || []; if (!pts.length) continue;
      if (!pts.some(q => q[0] >= INK_LEFT - 24 && q[0] <= INK_RIGHT + 40)) continue;
      const minY = Math.min(...pts.map(q => q[1]));
      const own = tasks.find(t => !(extra && extra.has(t)) && minY >= t.y - 12 && minY < t.y - 8 + linesOf(t) * ROW + 6);
      if (own) { if (!owned.has(own)) owned.set(own, []); owned.get(own).push(st); }
    }
    if (mutate) mutate();
    relayout(pg);
    for (const [t, list] of owned) {
      const dy = t.y - oldY.get(t); if (!dy) continue;
      for (const st of list) { for (const q of st.points) q[1] = +(q[1] + dy).toFixed(1); if (st.bb) { st.bb[1] += dy; st.bb[3] += dy; } }
    }
  }

  function ensureContPage(n, pi, date) {
    let next = n.pages[pi + 1];
    if (isMeeting(next) && next.bg.actionContinuation) return { pg: next, pi: pi + 1, inserted: false };
    const pg = makeTemplatePage('meeting', n, date); delete pg.rec;
    pg.bg.actionContinuation = true;
    pg.bg.actionLines = 0;
    n.pages.splice(pi + 1, 0, pg);
    return { pg, pi: pi + 1, inserted: true };
  }

  function evictAfter(pi, t, nOpt) {
    const n = nOpt || curNote(), pg = n.pages[pi];
    const later = meetTasks(pg).filter(x => x !== t && !x.continueFrom && (x.meetingRow ?? 0) > (t.meetingRow ?? 0));
    if (!later.length) return false;
    const next = ensureContPage(n, pi, pg.bg.date);
    const dest = next.pg;
    /* Evicted items belong immediately after t, so they go to the top of the continuation (before its own items).
       v21er: positions come from the shared layout and each item's ink moves with it (relayoutKeepInk). */
    const brought = new Map();
    later.forEach((ev, k) => { ev.meetingRow = -1000 + k; });
    dest.tasks = dest.tasks || []; dest.strokes = dest.strokes || [];
    for (const ev of later) {
      const strokes = takeItemStrokes(pg, ev);
      pg.tasks = pg.tasks.filter(x => x !== ev);
      dest.tasks.push(ev);
      dest.strokes.push(...strokes);
      brought.set(ev, strokes);
    }
    reindex(dest);
    relayoutKeepInk(dest, brought);
    reindex(pg); relayout(pg);
    return next.inserted;
  }

  function addContFragment(pi, t) {
    const n = curNote(), pg = n.pages[pi];
    const next = ensureContPage(n, pi, pg.bg.date);
    const dest = next.pg;
    let frag = meetTasks(dest).find(x => x.continueFrom === t.id);
    if (!frag) {
      frag = {
        id: uid('t'), kind: 'typed', x: 62, y: actionTop(dest) + ROW - 44, w: INK_RIGHT - 62, h: 36, fs: 26,
        strokeIds: [], text: '', continueFrom: t.id, meetLines: 1, meetingRow: 0,
        done: !!t.done, due: t.due || null, repeat: t.repeat || '', notified: false, createdAt: Date.now()
      };
      dest.tasks = dest.tasks || [];
      dest.tasks.unshift(frag);
      reindex(dest); relayoutKeepInk(dest, new Map([[frag, []]]));
    } else {
      const cap = maxRows(dest);
      if (visualRows(dest) + 1 <= cap) {
        relayoutKeepInk(dest, null, () => { frag.meetLines = linesOf(frag) + 1; });
      }
    }
    return next.inserted;
  }

  let growing = false;
  function growTask(pi, t) {
    const n = curNote(), pg = n && n.pages[pi];
    if (!isMeeting(pg) || !t || sealed(n) || growing) return false;
    growing = true;
    try {
      migrateMeet(pg); relayout(pg);
      const cap = maxRows(pg);
      const old = linesOf(t);
      let inserted = false;
      // Make room by moving later items onto a continuation page when this page would overflow.
      if (visualRows(pg) + 1 > cap && meetTasks(pg).some(x => x !== t && (x.meetingRow ?? 0) > (t.meetingRow ?? 0))) {
        inserted = evictAfter(pi, t) || inserted;
      }
      if (rowsBefore(pg, t) + linesOf(t) + 1 > cap) {
        inserted = addContFragment(pi, t) || inserted;
        saveNote(n, true);
        if (inserted) { if (!(typeof drawing === 'object' && drawing)) buildPages(); else { renderPageInk(pi); renderOverlay(pi); } }
        else { renderPageInk(pi); renderOverlay(pi); if (n.pages[pi + 1] && pageEls[pi + 1]) { renderPageInk(pi + 1); renderOverlay(pi + 1); } }
        return true;
      }
      t.meetLines = old + 1;
      shiftBelow(pg, t.y + old * ROW, ROW);
      relayout(pg);
      saveNote(n, true);
      renderPageInk(pi); renderOverlay(pi);
      if (inserted) { if (!(typeof drawing === 'object' && drawing)) buildPages(); }
      return true;
    } finally { growing = false; }
  }

  function itemAtLastLine(pg, x, y) {
    if (!pg || x < INK_LEFT - 36 || x > INK_RIGHT + 24) return null;
    for (const t of meetTasks(pg)) {
      const lastTop = t.y + (linesOf(t) - 1) * ROW - 12;
      const lastBot = t.y - 8 + linesOf(t) * ROW + GROW_PAD;
      if (y >= lastTop && y <= lastBot) return t;
    }
    return null;
  }

  function maybeGrow(pi, stroke) {
    const n = curNote(), pg = n && n.pages[pi];
    if (!isMeeting(pg) || sealed(n) || !stroke || stroke.tool === 'highlighter') return false;
    const pts = (stroke.points || []).filter(p => p[0] >= INK_LEFT - 24 && p[0] <= INK_RIGHT + 24);
    if (!pts.length) return false;
    let best = pts[0];
    for (const p of pts) if (p[1] > best[1]) best = p;
    const t = itemAtLastLine(pg, best[0], best[1]);
    if (!t) return false;
    return growTask(pi, t);
  }

  function shrinkNote(n) {
    if (!n || n._epShrunk) return false;
    n._epShrunk = true;
    let changed = false;
    for (const pg of n.pages || []) {
      if (!isMeeting(pg)) continue;
      migrateMeet(pg);
      for (const t of meetTasks(pg)) {
        const used = lastUsedLine(pg, t);
        const need = Math.max(1, used + 1);
        if (need < linesOf(t)) {
          const old = linesOf(t);
          t.meetLines = need;
          shiftBelow(pg, t.y + need * ROW, (need - old) * ROW);
          changed = true;
        }
      }
      if (changed) { reindex(pg); relayout(pg); }
    }
    return changed;
  }

  /* v21er: remove ONE extra line from an item, only when that last line is empty (never loses ink) */
  function lastLineEmpty(pg, t) {
    if (!pg || !t || linesOf(t) < 2) return false;
    const y0 = t.y - 8 + (linesOf(t) - 1) * ROW, y1 = t.y - 8 + linesOf(t) * ROW + 8;
    /* any tool (highlighter too), anywhere across the band, plus typed text and photos */
    const inLast = (x, y) => x >= 40 && x <= 960 && y >= y0 && y <= y1;
    if ((pg.strokes || []).some(s => (s.points || []).some(p => inLast(p[0], p[1])))) return false;
    if ((pg.texts || []).some(x => inLast(x.x + 1, x.y + 10))) return false;
    if ((pg.images || []).some(im => im && !im.hidden && im.y + (im.h || 0) >= y0 && im.y <= y1 && im.x + (im.w || 0) >= 40)) return false;
    return lastUsedLine(pg, t) < linesOf(t) - 1;
  }
  function shrinkLast(pi, t) {
    const n = curNote(), pg = n && n.pages[pi];
    if (!isMeeting(pg) || !t || sealed(n) || !lastLineEmpty(pg, t)) return false;
    pushHistory();
    const old = linesOf(t);
    t.meetLines = old - 1;
    shiftBelow(pg, t.y + old * ROW - 8, -ROW);
    relayout(pg);
    saveNote(n, true);
    renderPageInk(pi); renderOverlay(pi);
    return true;
  }

  /* ---------- add / overflow (replaces v21ej addAction; + Action task still adds one item) ---------- */
  function addAction(pi, row = null) {
    const n = curNote(), pg = n && n.pages[pi];
    if (!isMeeting(pg) || sealed(n)) return null;
    migrateMeet(pg);
    const _ensure = ensureMeetingActionLines; _ensure(pg);
    relayout(pg);
    if (row == null) {
      if (visualRows(pg) >= maxRows(pg)) {
        pushHistory();
        const next = makeTemplatePage('meeting', n, pg.bg.date); delete next.rec;
        next.bg.actionContinuation = true; next.bg.actionLines = 1;
        n.pages.splice(pi + 1, 0, next);
        const t = {
          id: uid('t'), kind: 'typed', x: 62, y: rowY(0, next), w: INK_RIGHT - 62, h: 36, fs: 26,
          strokeIds: [], text: 'Action task', meetingRow: 0, meetLines: 1, done: false, due: null, repeat: '', notified: false, createdAt: Date.now()
        };
        next.tasks.push(t); saveNote(n, true); buildPages();
        pageEls[pi + 1]?.el.scrollIntoView({ block: 'end' }); return t;
      }
      pushHistory();
      pg.bg.actionLines = Math.max(Number(pg.bg.actionLines) || 0, meetTasks(pg).filter(t => !t.continueFrom).length) + 1;
      row = pg.bg.actionLines - 1;
      const y = rowY(row, pg);
      const t = {
        id: uid('t'), kind: 'typed', x: 62, y, w: INK_RIGHT - 62, h: 36, fs: 26,
        strokeIds: [], text: 'Action task', meetingRow: row, meetLines: 1, done: false, due: null, repeat: '', notified: false, createdAt: Date.now()
      };
      pg.tasks.push(t); saveNote(n, true); renderPageInk(pi); renderOverlay(pi); renderSidebar(); return t;
    }
    // A provided row: toggle the item that owns that slot, or fill a reserved empty slot.
    const owner = meetTasks(pg).find(t => {
      if (t.continueFrom) return false;
      const a = t.meetingRow, b = a + 1; // only the checkbox slot toggles
      return a === row;
    });
    if (owner) { pushHistory(); toggleDone({ type: 'task', note: n, obj: owner, page: pi }); return owner; }
    // Continuation line of a multi-line item: do not invent a new checkbox.
    const covering = meetTasks(pg).find(t => {
      if (t.continueFrom || t.meetingRow == null) return false;
      const start = rowsBefore(pg, t);
      return row >= t.meetingRow && false; // meetingRow is item index, not visual
    });
    void covering;
    const visOwner = meetTasks(pg).find(t => {
      const y0 = t.y - 8, y1 = t.y - 8 + linesOf(t) * ROW;
      const y = rowY(row, pg);
      return y >= y0 && y < y1;
    });
    if (visOwner) return visOwner;
    if (row < 0 || row >= (pg.bg.actionLines || 0)) return null;
    pushHistory();
    const y = rowY(row, pg);
    const ids = (pg.strokes || []).filter(s => s.tool !== 'highlighter' && s.points?.some(p => p[0] >= 104 && p[1] >= y - 8 && p[1] < y + 42)).map(s => s.id);
    const t = {
      id: uid('t'), kind: ids.length ? 'ink' : 'typed', x: ids.length ? 108 : 62, y, w: INK_RIGHT - 62, h: 36, fs: 26,
      strokeIds: ids, text: ids.length ? '' : 'Action task', meetingRow: row, meetLines: 1, done: false, due: null, repeat: '', notified: false, createdAt: Date.now()
    };
    pg.tasks.push(t); saveNote(n, true); renderOverlay(pi); renderSidebar(); return t;
  }

  /* ---------- draw action band: checkboxes only on the first line of each item ---------- */
  const _drawMeeting = drawMeeting;
  drawMeeting = function (ctx, bg, pg) {
    const c = tcol(); ctx.save();
    if (pg) { migrateMeet(pg); relayout(pg); }
    const top = bg.actionContinuation ? 180 : MEET.actionsTop;
    const cap = Math.floor((PAGE_H - 21 - top) / ROW);
    const nVis = Math.max(0, Math.min(cap, pg ? visualRows(pg) : (Number.isInteger(bg.actionLines) ? bg.actionLines : 0)));
    if (bg.actionContinuation) {
      ctx.fillStyle = c.accent; ctx.font = `700 36px ${FONT}`; ctx.fillText('Meeting · Action Items (continued)', 60, 88);
    } else {
      ctx.fillStyle = c.accent; ctx.font = `700 40px ${FONT}`; ctx.fillText('Meeting Notes', 60, 88);
      for (const [label, y] of MEET.fields) {
        ctx.fillStyle = c.muted; ctx.font = `700 19px ${FONT}`; ctx.fillText(label.toUpperCase(), 60, y - 10);
        ctx.strokeStyle = c.strong; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(210, y); ctx.lineTo(940, y); ctx.stroke();
      }
      if (bg.date) { ctx.fillStyle = c.ink; ctx.font = `26px ${FONT}`; ctx.fillText(longDate(bg.date), 222, 215 - 10); }
      ctx.fillStyle = c.accent; ctx.font = `700 26px ${FONT}`; ctx.fillText('Notes', 60, MEET.notesTop - 12);
      ctx.strokeStyle = c.line; ctx.lineWidth = 1;
      for (let y = MEET.notesTop + 44; y <= MEET.notesBottom; y += 44) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(940, y); ctx.stroke(); }
    }
    ctx.fillStyle = c.band; ctx.fillRect(40, top - 50, 920, Math.max(70, 50 + nVis * ROW + 30));
    if (!bg.actionContinuation) {
      ctx.fillStyle = c.accent; ctx.font = `700 26px ${FONT}`; ctx.fillText('Action Items', 60, top - 12);
    }
    const tasks = pg ? meetTasks(pg) : [];
    const real = tasks.filter(t => !t.continueFrom);
    const frags = tasks.filter(t => t.continueFrom);
    const slots = Math.max(Number.isInteger(bg.actionLines) ? bg.actionLines : real.length, real.length);
    const byRow = new Map(real.map(t => [t.meetingRow, t]));
    let visual = 0;
    const drawLine = (y, check) => {
      if (visual >= cap) return;
      ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(INK_RIGHT, y); ctx.stroke();
      if (check) { ctx.strokeStyle = c.muted; ctx.lineWidth = 1.6; ctx.strokeRect(64, y - 40, 26, 26); }
    };
    /* v21er: same order as layout()/rowY — checkbox slots first, then continuation fragments — so drawn rules and
       checkboxes always line up with the items and their ink */
    for (let i = 0; i < slots && visual < cap; i++) {
      const t = byRow.get(i);
      const nLines = t ? linesOf(t) : 1;
      for (let k = 0; k < nLines && visual < cap; k++, visual++) drawLine(top + (visual + 1) * ROW, k === 0 && !t?.continueFrom);
    }
    for (const t of frags) {
      if (visual >= cap) break;
      for (let k = 0; k < linesOf(t) && visual < cap; k++, visual++) drawLine(top + (visual + 1) * ROW, false);
    }
    ctx.restore();
  };
  void _drawMeeting;

  const _ensure = ensureMeetingActionLines;
  ensureMeetingActionLines = function (pg) {
    if (blockRowTap) return 0;   // v21er: only during a guarded tap (see the pointerup guard below)
    if (!isMeeting(pg)) return _ensure(pg);
    migrateMeet(pg);
    const cap = maxRows(pg);
    if (!Number.isInteger(pg.bg.actionLines)) pg.bg.actionLines = meetTasks(pg).filter(t => !t.continueFrom).length;
    pg.bg.actionLines = Math.max(0, Math.min(Math.max(pg.bg.actionLines, meetTasks(pg).filter(t => !t.continueFrom).length), cap));
    return pg.bg.actionLines;
  };

  /* ---------- overlay: hide the pill, faint placeholder, bell at the right ---------- */
  function bellSvg(filled) {
    if (filled) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a6 6 0 0 0-6 6v2.2c0 .7-.2 1.4-.7 2L4 15.8c-.4.5 0 1.2.7 1.2h14.6c.7 0 1.1-.7.7-1.2l-1.3-2.6c-.5-.6-.7-1.3-.7-2V9a6 6 0 0 0-6-6zm0 18a3 3 0 0 0 2.8-2H9.2A3 3 0 0 0 12 21z"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6.4 17.2 7.6 14c.5-.8.8-1.8.8-2.7V9a4.6 4.6 0 1 1 9.2 0v2.3c0 .9.3 1.9.8 2.7l1.2 3.2H6.4z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M10 17.6a2 2 0 0 0 4 0"/></svg>';
  }
  function shortDue(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const days = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
    if (days === 0) return time;
    if (days === 1) return 'Tmrw ' + time;
    if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  const prevOv = v7OverlayHook;
  v7OverlayHook = function (pi) {
    prevOv(pi);
    const n = curNote(), pg = n?.pages[pi], rec = pageEls[pi];
    if (!rec || !isMeeting(pg) || sealed(n)) return;
    const addBtn = rec.ov.querySelector('.meet-add');
    if (addBtn) addBtn.onclick = ev => { ev.stopPropagation(); addAction(pi); };
    rec.ov.querySelectorAll('.meet-bell').forEach(el => el.remove());
    const now = Date.now();
    for (const t of meetTasks(pg)) {
      rec.ov.querySelectorAll(`.task[data-id="${t.id}"] .due`).forEach(el => el.remove());
      rec.ov.querySelectorAll(`.task-region[data-id="${t.id}"]`).forEach(el => el.remove());
      const ink = hasInk(pg, t);
      rec.ov.querySelectorAll(`.task[data-id="${t.id}"] .label`).forEach(lab => {
        const isPh = !t.text || t.text === 'Action task' || t.text === 'New task';
        lab.classList.toggle('meet-ph', isPh && !ink);
        lab.classList.toggle('meet-ph-hide', isPh && ink);
        if (isPh && ink) lab.setAttribute('hidden', ''); else lab.removeAttribute('hidden');
        if (isPh && !ink) lab.textContent = 'Action task';
      });
      if (t.continueFrom) continue;
      const overdue = t.due && !t.done && new Date(t.due) < now;
      const bell = document.createElement('button');
      bell.type = 'button';
      bell.className = 'meet-bell' + (t.due ? (overdue ? ' set overdue' : ' set') : '');
      bell.dataset.id = t.id;
      bell.setAttribute('aria-label', t.due ? ('Reminder ' + fmtDue(t.due)) : 'Set reminder');
      const hPx = Math.max(36, Math.round(52 * S.scale));
      Object.assign(bell.style, {
        left: BELL_X * S.scale + 'px',
        top: (t.y - 8) * S.scale + 'px',
        width: BELL_W * S.scale + 'px',
        height: hPx + 'px'
      });
      bell.innerHTML = t.due
        ? `<span class="mb-icon">${bellSvg(true)}</span><span class="mb-time">${esc(shortDue(t.due))}</span>`
        : `<span class="mb-icon">${bellSvg(false)}</span>`;
      bell.onpointerdown = ev => ev.stopPropagation();
      bell.onclick = ev => { ev.stopPropagation(); openEditor({ type: 'task', note: n, obj: t, page: pi }); };
      rec.ov.append(bell);
    }
  };

  let epTap = null;
  document.addEventListener('pointerdown', e => { epTap = e.pointerType === 'pen' ? null : { x: e.clientX, y: e.clientY, at: Date.now(), pid: e.pointerId }; }, true);
  /* Don't let a tap on a continuation line create a new checkbox (v21ej capture handler). */
  document.addEventListener('pointerup', e => {
    if (e.pointerType === 'pen' || !e.target?.closest?.('.page')) return;
    const el = e.target.closest('.page'), pi = +el.dataset.pi, pg = curNote()?.pages[pi];
    if (!isMeeting(pg) || !pageEls[pi]) return;
    const rect = pageEls[pi].base.getBoundingClientRect();
    const y = (e.clientY - rect.top) * PAGE_H / rect.height;
    const x = (e.clientX - rect.left) * PAGE_W / rect.width;
    if (x < 40 || x > INK_RIGHT + 8) return;
    const t = meetTasks(pg).find(it => y >= it.y - 12 && y <= it.y - 8 + linesOf(it) * ROW + 4);
    if (!t) return;
    /* v21er: v21ej maps a tap to a visual row, which is not the item index once an item has several lines —
       so the first line toggles THIS item here, and continuation lines never create a checkbox. */
    /* v21er: don't stopImmediatePropagation (that also swallowed the pointerup the v7 press/hold handlers need, so
       a finger tap could leave a task "lifted"); instead make v21ej's row-tap see zero rows for this one event. */
    blockRowTap = true; setTimeout(() => { blockRowTap = false; }, 0);
    const d = epTap; epTap = null;
    const quick = d && d.pid === e.pointerId && Date.now() - d.at <= 350 && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 6;
    if (quick && y <= t.y + 40 && !t.continueFrom && !e.target.closest('button, .task, input, .rec-panel')) addAction(pi, t.meetingRow);
  }, true);

  const prevEd = openEditor;
  openEditor = function (item, isNew) {
    const pg0 = item?.note?.pages[item.page], t0 = item?.obj;
    /* v21er: a visual row is not the slot index once items have several lines — map the drop point to its slot first */
    let slot = null, linesBefore = null;
    if (isNew && item?.type === 'task' && isMeeting(pg0) && t0 && !t0.continueFrom && t0.y >= actionTop(pg0)) {
      const L = layout(pg0), vr = Math.floor((t0.y - actionTop(pg0)) / ROW);
      linesBefore = Number.isInteger(pg0.bg.actionLines) ? pg0.bg.actionLines : 0;
      const slots = L.slotStart.length;
      for (let i = 0; i < slots; i++) {
        const st = L.slotStart[i], owner = slotTask(pg0, i), span = owner && owner !== t0 ? spanOf(owner) : 1;
        if (vr >= st && vr < st + span) { slot = i; break; }   // same slot as before v21er (even if taken)
      }
      if (slot == null) slot = vr >= L.total ? slots + Math.max(0, vr - L.total) : slots;
    }
    const r = prevEd.apply(this, arguments);
    const pg = item?.note?.pages[item.page], t = item?.obj;
    if (slot != null && pg && t) {
      t.meetingRow = slot;
      pg.bg.actionLines = Math.max(linesBefore, slot + 1, meetTasks(pg).filter(x => !x.continueFrom && x !== t).length + 1);
    }
    if (item?.type === 'task' && isMeeting(pg) && t && t.meetingRow != null && !t.continueFrom) {
      t.y = rowY(t.meetingRow, pg);
    }
    return r;
  };

  const prevStroke = window.onStrokeAdded;
  window.onStrokeAdded = function (pi, st) {
    if (typeof prevStroke === 'function') prevStroke(pi, st);
    if (AUTO_GROW) maybeGrow(pi, st);
    const pg = curNote()?.pages[pi];
    // Re-render after the stroke is in IndexedDB-backed page data so the placeholder can hide.
    if (isMeeting(pg) && st && st.tool !== 'highlighter') renderOverlay(pi);
  };

  // Grow as the Pencil reaches the last line so the new rule appears under the stroke.
  window.addEventListener('pointermove', e => {
    const d = typeof drawing !== 'undefined' ? drawing : null;
    if (!d || !d.stroke || d.stroke.tool === 'highlighter' || e.pointerId !== d.id) return;
    const last = d.stroke.points && d.stroke.points[d.stroke.points.length - 1];
    if (!last) return;
    const pg = curNote()?.pages[d.pi];
    if (!AUTO_GROW || !isMeeting(pg) || growing) return;
    if (itemAtLastLine(pg, last[0], last[1])) growTask(d.pi, itemAtLastLine(pg, last[0], last[1]));
  }, { passive: true });

  const prevOpen = openNote;
  openNote = function (id) {
    const n = S.notes.find(x => x.id === id);
    if (n && SHRINK_ON_OPEN) {
      const changed = shrinkNote(n);
      if (changed) saveNote(n, true);
    }
    return prevOpen.apply(this, arguments);
  };

  if (V21ej) {
    V21ej.addAction = addAction;
    V21ej.rowY = rowY;
    V21ej.maxRows = maxRows;
    V21ej.countRows = pg => { ensureMeetingActionLines(pg); return pg.bg.actionLines; };
  }

  window.V21ep = {
    version: 'v21ep', addAction, rowY, maxRows, visualRows, linesOf, hasInk, growTask, maybeGrow,
    shrinkNote, meetTasks, INK_LEFT, INK_RIGHT, BELL_X, BELL_W, migrateMeet, relayout,
    shrinkLast, lastLineEmpty, lastUsedLine, isMeeting, AUTO_GROW, SHRINK_ON_OPEN,
    layout
  };

  const ready = () => {
    const n = typeof curNote === 'function' && curNote();
    if (n && SHRINK_ON_OPEN && shrinkNote(n)) {
      saveNote(n, true);
      if (typeof buildPages === 'function' && document.getElementById('pagesInner')) buildPages();
    }
  };
  if (window.__ready) ready();
  else {
    const t = setInterval(() => { if (window.__ready) { clearInterval(t); ready(); } }, 100);
  }
})();
