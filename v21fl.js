/* Pencil Notes v21fl — revert writing/layout to v21fi behavior, and keep
   Daily To-Do continuation pages saved under v21fj/v21fk visible (v: 2 /
   section: 'flow') so their ink and sections still display. Display only:
   no overflow/reflow, no toast guards, no pointer or save hooks.
   IndexedDB is never opened or deleted. */
(() => {
  'use strict';
  const VERSION = 'v21fl';
  const NOTES_BASE = 150, TMR_BASE = 132, NOTES_DEF = 2, TMR_DEF = 2;

  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };
  function TD() { return (window.V21ee && V21ee.TD) || { X: 40, W: 920, TOP: 104, GAP: 16, HEAD: 36, ROW: 48, ADD: 36, NOTES: 150, NOTE_LH: 40, TMR: 132, BOX: 26, DEF: 12 }; }
  function notesH(n) { const D = TD(); const c = Math.max(0, n | 0); if (c <= 0) return 0; return NOTES_BASE + (Math.max(1, c) - NOTES_DEF) * (D.NOTE_LH || 40); }
  function tmrH(n) { const D = TD(); const c = Math.max(0, n | 0); if (c <= 0) return 0; return TMR_BASE + (Math.max(1, c) - TMR_DEF) * (D.NOTE_LH || 40); }
  function pal() {
    const d = typeof isDark === 'function' && isDark();
    return { paper: d ? '#1f1f23' : '#fffdf8', box: d ? 'rgba(255,255,255,.03)' : '#ffffff', block: d ? 'rgba(255,255,255,.015)' : 'rgba(250,249,245,1)', edge: d ? 'rgba(200,200,220,.26)' : 'rgba(60,60,80,.24)', rule: d ? 'rgba(200,200,220,.20)' : 'rgba(60,60,80,.20)', gray: d ? 'rgba(200,200,215,.62)' : 'rgba(70,70,90,.6)', ink: d ? '#e6e6ea' : '#1d1d1f', accent: d ? '#8b85ff' : '#4f46e5' };
  }
  function fontFam() { return typeof FONT === 'string' ? FONT : '-apple-system, system-ui, sans-serif'; }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function lab(ctx, c, t, x, y, size) { ctx.fillStyle = c.gray; ctx.font = '700 ' + (size || 12) + 'px ' + fontFam(); if ('letterSpacing' in ctx) ctx.letterSpacing = '1.4px'; ctx.fillText(String(t).toUpperCase(), x, y); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; }

  function isFlow(pg) { return !!(pg && pg.todoCont && (pg.todoCont.v === 2 || pg.todoCont.flow || pg.todoCont.section === 'flow')); }

  function layoutFlow(pg) {
    const t = pg && pg.todoCont; if (!t) return null;
    if (!isFlow(pg)) return window.V21fh && V21fh.layoutTodoCont ? V21fh.layoutTodoCont(pg) : null;
    const D = TD();
    const x = D.X, w = D.W;
    let y = 108;
    const out = { boxes: [], pri: null, priRows: null, tasks: null, rows: null, notes: null, tomorrow: null, bottom: y };
    const row = (box, i, list) => ({
      i, id: list[i].id,
      y: box.y + D.HEAD + i * D.ROW, h: D.ROW,
      check: { x: box.x + 22, y: box.y + D.HEAD + i * D.ROW + (D.ROW - D.BOX) / 2 },
      write: { x: box.x + 62, y: box.y + D.HEAD + i * D.ROW, w: box.w - 74, h: D.ROW }
    });
    if (t.pri && t.pri.length) {
      const box = { key: 'pri', label: '★ Priorities', x, y, w, h: D.HEAD + t.pri.length * D.ROW + 8 };
      out.pri = box; out.priRows = t.pri.map((_, i) => row(box, i, t.pri));
      out.boxes.push(box); y = box.y + box.h + D.GAP;
    }
    if (t.rows && t.rows.length) {
      const box = { key: 'tasks', label: 'Tasks', x, y, w, h: D.HEAD + t.rows.length * D.ROW + D.ADD };
      out.tasks = box; out.rows = t.rows.map((_, i) => row(box, i, t.rows));
      out.boxes.push(box); y = box.y + box.h + D.GAP;
    }
    if ((t.notesLines | 0) > 0) {
      const box = { key: 'notes', label: 'Notes', x, y, w, h: notesH(t.notesLines) };
      out.notes = box; out.boxes.push(box); y = box.y + box.h + D.GAP;
    }
    if (t.tomorrow && (t.tmrLines | 0) > 0) {
      const box = { key: 'tomorrow', label: 'Tomorrow', x, y, w, h: tmrH(t.tmrLines) };
      out.tomorrow = box; out.boxes.push(box); y = box.y + box.h;
    }
    out.bottom = y;
    return out;
  }

  function drawTodoFlow(ctx, pg) {
    const t = pg.todoCont, L = layoutFlow(pg), c = pal(), D = TD();
    if (!t || !L) return;
    const font = fontFam();
    const PW = typeof PAGE_W === 'number' ? PAGE_W : 1000, PH = typeof PAGE_H === 'number' ? PAGE_H : 1430;
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, PW, PH);
    ctx.fillStyle = c.ink; ctx.font = '700 32px ' + font;
    ctx.fillText(t.title || 'Daily To-Do (cont.)', D.X + 4, 62);
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(D.X, 90); ctx.lineTo(D.X + D.W, 90); ctx.stroke();
    const boxy = (f, fill) => { rr(ctx, f.x, f.y, f.w, f.h, 10); ctx.fillStyle = fill || c.box; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 1.2; ctx.stroke(); };
    const rows = (bx, list, numbered) => (list || []).forEach((r, i) => {
      const k = r.check; rr(ctx, k.x, k.y, D.BOX, D.BOX, 6); ctx.strokeStyle = c.gray; ctx.lineWidth = 2; ctx.stroke();
      if (numbered) { ctx.fillStyle = c.accent; ctx.font = '800 15px ' + font; ctx.fillText(String(i + 1), bx.x + 6, k.y + 19); }
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(r.write.x, r.y + r.h - 10); ctx.lineTo(r.write.x + r.write.w, r.y + r.h - 10); ctx.stroke();
    });
    if (L.pri) { boxy(L.pri, c.block); lab(ctx, c, L.pri.label, L.pri.x + 14, L.pri.y + 23, 13); rows(L.pri, L.priRows, true); }
    if (L.tasks) { boxy(L.tasks, c.block); lab(ctx, c, 'Tasks', L.tasks.x + 14, L.tasks.y + 23, 13); rows(L.tasks, L.rows, false); }
    for (const f of [L.notes, L.tomorrow].filter(Boolean)) {
      boxy(f); lab(ctx, c, f.label, f.x + 14, f.y + 23, 13);
      ctx.strokeStyle = c.rule; ctx.lineWidth = 1.2; ctx.beginPath();
      const nL = f.key === 'notes' ? (t.notesLines | 0) : (t.tmrLines | 0);
      for (let i = 0; i < nL; i++) {
        const yy = f.y + 36 + D.NOTE_LH - 6 + i * D.NOTE_LH;
        ctx.moveTo(f.x + 14, yy); ctx.lineTo(f.x + f.w - 14, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Hide v21fh's single-section +/- on flow pages — they would be misleading.
     Do not add new controls: this overlay is display-only. */
  function tidyFlowUI(pi, rec) {
    const n = typeof curNote === 'function' ? curNote() : null;
    const pg = n && n.pages[pi];
    if (!pg || !isFlow(pg) || !rec || !rec.ov) return;
    rec.ov.querySelectorAll('.fh-pm, .fj-pm').forEach(b => b.remove());
  }

  function hookDraw() {
    if (typeof drawPageBackground === 'function' && !drawPageBackground._v21fl) {
      const _dpb = drawPageBackground;
      drawPageBackground = function (ctx, note, pg) {
        const r = _dpb.apply(this, arguments);
        try { if (pg && isFlow(pg)) drawTodoFlow(ctx, pg); } catch (e) { console.warn('v21fl flow draw', e); }
        return r;
      };
      drawPageBackground._v21fl = true;
    }
    if (typeof v7OverlayHook === 'function' && !v7OverlayHook._v21fl) {
      const _ov = v7OverlayHook;
      v7OverlayHook = function (pi) {
        const r = _ov.apply(this, arguments);
        try {
          const rec = typeof pageEls !== 'undefined' && pageEls[pi];
          if (rec) tidyFlowUI(pi, rec);
        } catch (e) { console.warn('v21fl flow ui', e); }
        return r;
      };
      v7OverlayHook._v21fl = true;
    }
    if (typeof drawOverlaysForExport === 'function' && !drawOverlaysForExport._v21fl) {
      const _doe = drawOverlaysForExport;
      drawOverlaysForExport = function (ctx, pg, note) {
        const r = _doe.apply(this, arguments);
        try { if (pg && isFlow(pg)) drawTodoFlow(ctx, pg); } catch (_) {}
        return r;
      };
      drawOverlaysForExport._v21fl = true;
    }
  }

  function boot() {
    hookDraw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.V21fl = { version: VERSION, isFlow, layoutFlow, drawTodoFlow };
})();
