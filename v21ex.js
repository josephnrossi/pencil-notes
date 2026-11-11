/* Pencil Notes v21ex — Quote status classifications + translucent number-chip colors.
   Joseph: replace Open/Sent/Won/Lost with Just Quote, Live, Dead, Lost Lead-time,
   Lost Price, Awarded. Shade the quote NUMBER chip (beige / red / gray / purple /
   green / red-and-white stripes), translucent so the number stays readable.
   New quotes default to Just Quote. Existing statuses migrate without data loss
   (Open→Just Quote, Sent→Live, Won→Awarded, Lost→Dead) and the original value is
   kept on q.statusOrig. Search, export and status chips use the new names (old
   names still match in search). Mock only. Loads after v21ew. Does not touch
   handwriting, ink, Qty/Price chips, or totals. IndexedDB data is never deleted. */
(function () {
  'use strict';
  const VERSION = 'v21ex';

  const STATUSES = [
    { id: 'justquote', label: 'Just Quote',       fg: '#3b3226', bg: 'rgba(210,180,140,.42)', bd: 'rgba(166,124,82,.55)', stripe: false },
    { id: 'live',      label: 'Live',             fg: '#3b1414', bg: 'rgba(220,38,38,.26)',   bd: 'rgba(185,28,28,.50)',  stripe: false },
    { id: 'dead',      label: 'Dead',             fg: '#2a2d33', bg: 'rgba(107,114,128,.34)', bd: 'rgba(75,85,99,.55)',   stripe: false },
    { id: 'lostlead',  label: 'Lost Lead-time',   fg: '#2e1065', bg: 'rgba(126,34,206,.26)',  bd: 'rgba(107,33,168,.50)', stripe: false },
    { id: 'lostprice', label: 'Lost Price',       fg: '#14532d', bg: 'rgba(22,163,74,.28)',   bd: 'rgba(21,128,61,.50)',  stripe: false },
    { id: 'awarded',   label: 'Awarded',          fg: '#3b1414', bg: 'rgba(220,38,38,.22)',   bd: 'rgba(185,28,28,.50)',  stripe: true }
  ];
  const DEFAULT_ID = 'justquote';
  const MAP = { open: 'justquote', sent: 'live', won: 'awarded', lost: 'dead' };
  const OLD_LABELS = { open: 'Open', sent: 'Sent', won: 'Won', lost: 'Lost' };
  const statusOf = id => STATUSES.find(s => s.id === id) || STATUSES[0];
  const known = id => STATUSES.some(s => s.id === id);
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };

  function aliasesOf(q) {
    const st = statusOf(q && q.status);
    const out = [st.label, st.id];
    if (q && q.statusOrig) {
      out.push(q.statusOrig);
      if (OLD_LABELS[q.statusOrig]) out.push(OLD_LABELS[q.statusOrig]);
    }
    // so a search for an old name still finds the migrated status
    for (const [oldId, newId] of Object.entries(MAP)) {
      if (newId === st.id) { out.push(oldId, OLD_LABELS[oldId]); }
    }
    return out;
  }

  /* ---------- install the new palette onto v21em's live array (drawMetaUI / picker closures) ---------- */
  if (window.V21em && Array.isArray(V21em.STATUSES)) {
    V21em.STATUSES.splice(0, V21em.STATUSES.length, ...STATUSES);
    V21em.statusOf = statusOf;
  }

  /* ---------- migrate a stored status; never deletes the original value ---------- */
  function migrateStatus(q) {
    if (!q) return false;
    const cur = q.status;
    if (known(cur)) return false;
    const next = MAP[cur] || DEFAULT_ID;
    if (cur != null && cur !== '' && q.statusOrig == null) q.statusOrig = cur;
    q.status = next;
    return true;
  }

  const _enEnsure = window.V21en && typeof V21en.ensureMeta === 'function' ? V21en.ensureMeta : null;
  const _emEnsure = window.V21em && typeof V21em.ensureMeta === 'function' ? V21em.ensureMeta : null;
  function ensureMeta(q, note, opts) {
    if (!q) return false;
    let changed = migrateStatus(q);
    const inner = _enEnsure || _emEnsure;
    if (inner && inner !== ensureMeta) {
      if (inner(q, note, opts || {})) changed = true;
      if (migrateStatus(q)) changed = true;   // in case the inner defaulted an unknown id to 'open'
    } else if (!known(q.status)) {
      if (migrateStatus(q)) changed = true;
    }
    return changed;
  }
  if (window.V21en) V21en.ensureMeta = ensureMeta;
  if (window.V21em) V21em.ensureMeta = ensureMeta;

  function migratePage(note, pg) {
    if (!pg || !pg.qsheet) return false;
    let ch = false;
    for (const q of pg.qsheet.quotes || []) if (ensureMeta(q, note)) ch = true;
    return ch;
  }
  function migrateNote(note) {
    if (!note) return false;
    let ch = false;
    for (const pg of note.pages || []) if (migratePage(note, pg)) ch = true;
    return ch;
  }
  if (window.V21en) { V21en.migratePage = migratePage; V21en.migrateNote = migrateNote; }
  if (window.V21em) { V21em.migratePage = migratePage; V21em.migrateNote = migrateNote; }

  function quietSave(note) {
    try { DB.put('notes', note); } catch (_) {}
  }

  /* ---------- status picker (six 44px choices) ---------- */
  function closeQm() { document.getElementById('qmWrap')?.remove(); }
  function openStatusPick(pi, qid) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || !pg.qsheet || sealed(n)) return;
    const q = pg.qsheet.quotes.find(x => x.id === qid); if (!q) return;
    ensureMeta(q, n);
    closeQm();
    const w = document.createElement('div'); w.id = 'qmWrap'; w.className = 'qm-wrap';
    w.innerHTML = `<div class="qm-sheet qm-status-sheet" role="dialog" aria-modal="true" aria-label="Quote status">
      <h3>Status</h3>
      <p class="fine">Just Quote, Live, Dead, Lost Lead-time, Lost Price, or Awarded.</p>
      <div class="qm-status-list">${STATUSES.map(s =>
        `<button type="button" data-st="${s.id}" aria-current="${q.status === s.id ? 'true' : 'false'}" class="${s.stripe ? 'qs-st-awarded' : ''}" style="border-color:${s.bd};background:${s.stripe ? 'transparent' : s.bg};color:${s.fg}"><span class="qm-dot${s.stripe ? ' qm-dot-awarded' : ''}" style="${s.stripe ? '' : 'background:' + s.fg}"></span>${s.label}</button>`
      ).join('')}</div>
      <div class="qm-actions"><button class="btn" data-a="cancel">Cancel</button></div>
    </div>`;
    document.body.append(w);
    w.addEventListener('click', e => {
      if (e.target === w || e.target.closest('[data-a="cancel"]')) return closeQm();
      const b = e.target.closest('[data-st]'); if (!b) return;
      pushHistory(); q.status = b.dataset.st; saveNote(n, true); closeQm();
      try { renderOverlay(pi); } catch (_) {}
      toast('Status: ' + statusOf(q.status).label);
    });
  }
  if (window.V21em) V21em.openStatusPick = openStatusPick;

  // v21em's click handler closes over its own openStatusPick, so intercept earlier
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.qs-meta.qs-status'); if (!b) return;
    const page = b.closest('.page[data-pi]'); if (!page) return;
    e.stopPropagation(); e.preventDefault();
    openStatusPick(+page.dataset.pi, b.dataset.q);
  }, true);

  /* ---------- color the quote NUMBER chip (and tint the status pill to match) ---------- */
  function paintChips(pi) {
    const n = curNote(), rec = pageEls[pi], pg = n && n.pages[pi];
    if (!rec || !rec.ov || !pg || !pg.qsheet) return;
    rec.ov.querySelectorAll('.qs-qnum, .qs-status').forEach(b => {
      const q = (pg.qsheet.quotes || []).find(x => x.id === b.dataset.q); if (!q) return;
      const stt = statusOf(q.status);
      b.dataset.st = stt.id;
      b.classList.toggle('qs-st-awarded', !!stt.stripe);
      b.style.setProperty('--er-chip-bg', stt.bg);
      b.style.setProperty('--er-chip-bd', stt.bd);
      if (b.classList.contains('qs-status')) {
        b.style.color = '';          // CSS sets a readable fg per theme / status
        b.style.background = '';
        b.style.borderColor = '';
      }
    });
  }

  const _ovh = typeof v7OverlayHook === 'function' ? v7OverlayHook : function () {};
  v7OverlayHook = function (pi) {
    _ovh.apply(this, arguments);
    try { paintChips(pi); } catch (e) { console.warn('v21ex overlay', e); }
  };

  /* ---------- PDF export: paint a translucent capsule behind the quote number ---------- */
  const _doe = typeof drawOverlaysForExport === 'function' ? drawOverlaysForExport : function () {};
  drawOverlaysForExport = function (ctx, pg, note) {
    const r = _doe.apply(this, arguments);
    try {
      if (pg && pg.qsheet && window.V21ed) {
        migratePage(note, pg);
        ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        const dark = typeof isDark === 'function' && isDark();
        for (const q of pg.qsheet.quotes) {
          const L = V21ed.qLayout(q), stt = statusOf(q.status);
          const y = L.y + 20, x0 = L.x + 100;
          ctx.font = `700 12px ${typeof FONT === 'string' ? FONT : 'sans-serif'}`;
          const qnum = q.qnum || '';
          if (qnum) {
            const tw = ctx.measureText(qnum).width;
            const pad = 6, h = 16, rx = 8, bx = x0 - pad, by = y - 12, bw = tw + pad * 2;
            ctx.beginPath();
            ctx.moveTo(bx + rx, by); ctx.arcTo(bx + bw, by, bx + bw, by + h, rx);
            ctx.arcTo(bx + bw, by + h, bx, by + h, rx); ctx.arcTo(bx, by + h, bx, by, rx);
            ctx.arcTo(bx, by, bx + bw, by, rx); ctx.closePath();
            if (stt.stripe) {
              ctx.save(); ctx.clip();
              const step = 8;
              for (let i = -h; i < bw + h; i += step) {
                ctx.fillStyle = (Math.floor((i + h) / step) % 2 === 0)
                  ? (dark ? 'rgba(239,68,68,.40)' : 'rgba(220,38,38,.32)')
                  : (dark ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.55)');
                ctx.beginPath();
                ctx.moveTo(bx + i, by); ctx.lineTo(bx + i + step * 0.55, by);
                ctx.lineTo(bx + i + step * 0.55 - h, by + h); ctx.lineTo(bx + i - h, by + h);
                ctx.closePath(); ctx.fill();
              }
              ctx.restore();
              ctx.strokeStyle = stt.bd; ctx.lineWidth = 1; ctx.stroke();
            } else {
              ctx.fillStyle = stt.bg; ctx.fill();
              ctx.strokeStyle = stt.bd; ctx.lineWidth = 1; ctx.stroke();
            }
            ctx.fillStyle = dark ? '#f4f4f7' : '#1d1d1f';
            ctx.fillText(qnum, x0, y);
          }
        }
        ctx.restore();
      }
    } catch (e) { console.warn('v21ex export', e); }
    return r;
  };

  /* ---------- search / filter: new labels + old names so existing queries still hit ---------- */
  try {
    if (typeof noteSearchText === 'function') {
      const _nst = noteSearchText;
      noteSearchText = function (n) {
        const extra = (n.pages || []).flatMap(p => ((p.qsheet && p.qsheet.quotes) || []).map(q => {
          ensureMeta(q, n); return aliasesOf(q).join(' ');
        })).join(' ');
        return _nst.apply(this, arguments) + ' ' + extra.toLowerCase();
      };
    }
  } catch (e) { console.warn('v21ex noteSearchText', e); }

  function metaHits(query) {
    const q = String(query || '').trim().toLowerCase(); if (q.length < 2) return [];
    const out = [];
    for (const n of S.notes || []) {
      if (typeof locked === 'function' && locked(n)) continue;
      (n.pages || []).forEach((pg, pi) => {
        if (!pg.qsheet) return;
        (pg.qsheet.quotes || []).forEach((qq, qi) => {
          ensureMeta(qq, n);
          const stt = statusOf(qq.status);
          const blob = [qq.qnum, qq.date, stt.label, ...aliasesOf(qq), 'Quote ' + (qi + 1)].filter(Boolean).join(' ');
          if (!blob.toLowerCase().includes(q)) return;
          const L = window.V21ed ? V21ed.qLayout(qq) : { x: 0, y: 0, w: 0 };
          out.push({ note: n, pi, pg, q: qq, stt, blob, bb: [L.x, L.y, L.x + L.w, L.y + 30] });
        });
      });
    }
    return out;
  }
  function injectMetaHits() {
    const box = document.getElementById('hwResults'); if (!box || box.hidden) return;
    const q = (S.search || '').trim(); if (q.length < 2) return;
    const hits = metaHits(q); if (!hits.length) return;
    box.querySelectorAll('.hw-res.qm-hit').forEach(el => el.remove());
    const head = box.querySelector('.hw-head b');
    hits.forEach(h => {
      const b = document.createElement('button');
      b.className = 'hw-res qm-hit';
      b.innerHTML = `<span class="hw-meta"><span class="hw-t">${esc(h.note.title)} · p.${h.pi + 1}</span>` +
        `<span class="hw-k">🧾 ${esc(h.q.qnum || 'Quote')} · ${esc(h.stt.label)}` +
        `<span class="hw-status-chip${h.stt.stripe ? ' qs-st-awarded' : ''}" style="color:${h.stt.fg};background:${h.stt.stripe ? 'transparent' : h.stt.bg};border:1px solid ${h.stt.bd}">${esc(h.stt.label)}</span></span>` +
        `<span class="hw-s"><mark>${esc(h.blob)}</mark></span></span>`;
      b.addEventListener('click', () => {
        try {
          if (window.V21ee && V21ee.openHit) V21ee.openHit({ note: h.note, pi: h.pi, pg: h.pg, bb: h.bb, kind: '🧾', t: h.blob, s: { pre: '', hit: h.blob, post: '' } });
          else { openNote(h.note.id); }
        } catch (_) {}
      });
      box.append(b);
    });
    if (head) {
      const n = box.querySelectorAll('.hw-res').length;
      head.textContent = n ? `${n} match${n === 1 ? '' : 'es'} in pages` : head.textContent;
    }
  }
  if (typeof renderSidebar === 'function') {
    const _rs = renderSidebar;
    renderSidebar = function () {
      const r = _rs.apply(this, arguments);
      try { injectMetaHits(); } catch (e) { console.warn('v21ex hits', e); }
      return r;
    };
  }
  if (window.V21ee && typeof V21ee.search === 'function') {
    const _search = V21ee.search;
    V21ee.search = function (query, limit) {
      const hits = _search.apply(this, arguments) || [];
      for (const h of metaHits(query)) {
        hits.push({ note: h.note, pi: h.pi, pg: h.pg, kind: '🧾 ' + (h.q.qnum || 'Quote') + ' · ' + h.stt.label, t: h.blob, bb: h.bb, s: { pre: '', hit: h.blob, post: '' }, status: h.q.status });
      }
      return hits.slice(0, limit || 60);
    };
  }

  window.V21ex = {
    version: VERSION, VERSION, STATUSES, statusOf, MAP, OLD_LABELS, DEFAULT_ID,
    migrateStatus, ensureMeta, migratePage, migrateNote, openStatusPick, aliasesOf, paintChips
  };

  const whenReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 60); setTimeout(() => clearInterval(t), 15000); };
  whenReady(() => {
    try {
      for (const n of (S.notes || [])) {
        if (migrateNote(n)) quietSave(n);
      }
      const cur = typeof curNote === 'function' ? curNote() : null;
      if (cur) (cur.pages || []).forEach((pg, pi) => { if (pg.qsheet && pageEls[pi]) try { renderOverlay(pi); } catch (_) {} });
    } catch (_) {}
  });
})();
