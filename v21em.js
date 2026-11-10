/* Pencil Notes v21em — Quote sheet: Date, Quote number, Status tag on every quote.
   Mock only. Loads after v21el.
   Each quote block gains three header fields (overlay chips; painted into PDF export):
     • Date — auto-filled with today (M/D/YY), tappable to edit (date picker / typed)
     • Quote number — Q-MMDD-NN, unique across all quotes, editable
     • Status — Open / Sent / Won / Lost colored chip (tap → pick), default Open
   Legacy quotes (no fields) migrate non-destructively on first draw: date from note
   createdAt/updatedAt when available (else blank, chip prompts with today), a fresh
   quote number, status Open. IndexedDB data is never deleted.
   Layout: chips sit in the existing header band to the right of “Quote N”, left of 🗑 —
   BAND height unchanged, so handwriting boxes, ＋ Quote overflow, and totals stay put. */
(function () {
  const STATUSES = [
    { id: 'open', label: 'Open', fg: '#3730a3', bg: 'rgba(99,102,241,.16)', bd: 'rgba(99,102,241,.45)' },
    { id: 'sent', label: 'Sent', fg: '#92400e', bg: 'rgba(245,158,11,.18)', bd: 'rgba(245,158,11,.5)' },
    { id: 'won',  label: 'Won',  fg: '#166534', bg: 'rgba(34,197,94,.18)', bd: 'rgba(34,197,94,.5)' },
    { id: 'lost', label: 'Lost', fg: '#9f1239', bg: 'rgba(244,63,94,.14)', bd: 'rgba(244,63,94,.45)' }
  ];
  const statusOf = id => STATUSES.find(s => s.id === id) || STATUSES[0];
  const sealed = n => { try { return typeof isSealed === 'function' && isSealed(n); } catch (_) { return false; } };

  const st = document.createElement('style');
  st.textContent = `
    .page .overlay .qs-meta-row { position: absolute; pointer-events: none; z-index: 3; display: flex; align-items: center; gap: 6px; height: 26px; overflow: visible; }
    .page .overlay .qs-meta { pointer-events: auto; position: relative; left: auto !important; top: auto !important; height: 24px; line-height: 22px; padding: 0 9px; font: 700 11.5px -apple-system, system-ui, sans-serif; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
    .page .overlay .qs-meta.qs-qnum { letter-spacing: .02em; color: var(--muted); }
    .page .overlay .qs-meta.qs-date { font-variant-numeric: tabular-nums; }
    .page .overlay .qs-meta.qs-date.blank { color: var(--muted); font-weight: 600; border-style: dashed; }
    .page .overlay .qs-meta.qs-status { text-transform: none; }
    .qm-wrap { position: fixed; inset: 0; height: 100dvh; z-index: 96; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .qm-sheet { width: min(420px, 100%); background: var(--surface); color: var(--text); border-radius: 16px; padding: 18px 18px 14px; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
    .qm-sheet h3 { margin: 0 0 4px; font-size: 18px; } .qm-sheet .fine { margin: 0 0 12px; color: var(--muted); font-size: 13px; }
    .qm-sheet label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 10px; }
    .qm-sheet input { height: 42px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface2, var(--surface)); padding: 0 12px; font-size: 17px; color: var(--text); }
    .qm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    .qm-status-list { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 4px; }
    .qm-status-list button { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface2, var(--surface)); font: 700 15px -apple-system, system-ui, sans-serif; color: var(--text); text-align: left; }
    .qm-status-list button[aria-current="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }
    .qm-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
    .hw-res .hw-status-chip { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 8px; font: 700 10px -apple-system, system-ui, sans-serif; vertical-align: middle; }
  `;
  document.head.append(st);

  /* ---------- date / number helpers ---------- */
  function todayStr(d = new Date()) {
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2);
  }
  function mmdd(d = new Date()) {
    return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }
  function parseDateStr(s) {
    if (!s) return null;
    const t = String(s).trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);                     // ISO from <input type=date>
    if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d) ? null : d; }
    m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);            // M/D/YY or M/D/YYYY
    if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[1] - 1, +m[2]); return isNaN(d) ? null : d; }
    return null;
  }
  function toISODate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function allQnums() {
    const out = [];
    for (const n of (S.notes || [])) for (const pg of (n.pages || [])) for (const q of ((pg.qsheet && pg.qsheet.quotes) || [])) if (q.qnum) out.push(String(q.qnum));
    return out;
  }
  function nextQnum(forDate) {
    const d = forDate instanceof Date && !isNaN(forDate) ? forDate : new Date();
    const prefix = 'Q-' + mmdd(d) + '-';
    let max = 0;
    for (const n of allQnums()) if (n.startsWith(prefix)) { const seq = parseInt(n.slice(prefix.length), 10); if (seq > max) max = seq; }
    return prefix + String(max + 1).padStart(2, '0');
  }

  /** Assign missing meta. Never overwrites an existing date/qnum/status. Returns true if anything was set. */
  function ensureMeta(q, note, opts = {}) {
    if (!q) return false;
    let changed = false;
    if (!STATUSES.some(s => s.id === q.status)) { q.status = 'open'; changed = true; }
    if (!('date' in q)) {
      if (opts.fresh) q.date = todayStr();
      else {
        const t = note && (note.createdAt || note.updatedAt);
        q.date = t ? todayStr(new Date(t)) : '';          // blank → chip prompts with today
      }
      changed = true;
    }
    if (!q.qnum) {
      const d = parseDateStr(q.date) || (opts.fresh ? new Date() : (note && (note.createdAt || note.updatedAt) ? new Date(note.createdAt || note.updatedAt) : new Date()));
      q.qnum = nextQnum(d);
      changed = true;
    }
    return changed;
  }
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

  /* ---------- quiet persist (no updatedAt bump — same idea as v21ei widenSize) ---------- */
  function quietSave(note) {
    try { DB.put('notes', note); } catch (_) {}
  }

  /* ---------- edit sheets ---------- */
  function closeQm() { document.getElementById('qmWrap')?.remove(); }
  function openDateEdit(pi, qid) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || !pg.qsheet || sealed(n)) return;
    const q = pg.qsheet.quotes.find(x => x.id === qid); if (!q) return;
    closeQm();
    const cur = parseDateStr(q.date) || new Date();
    const w = document.createElement('div'); w.id = 'qmWrap'; w.className = 'qm-wrap';
    w.innerHTML = `<div class="qm-sheet" role="dialog" aria-modal="true" aria-label="Quote date">
      <h3>Quote date</h3>
      <p class="fine">Auto-filled today. Change it with the picker or type M/D/YY.</p>
      <label>Date<input type="date" data-f="iso" value="${toISODate(cur)}"></label>
      <label>Or type it<input inputmode="numeric" autocomplete="off" data-f="txt" placeholder="${todayStr()}" value="${esc(q.date || '')}"></label>
      <div class="qm-actions"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div>
    </div>`;
    document.body.append(w);
    const iso = w.querySelector('[data-f="iso"]'), txt = w.querySelector('[data-f="txt"]');
    iso.addEventListener('change', () => { const d = parseDateStr(iso.value); if (d) txt.value = todayStr(d); });
    txt.addEventListener('input', () => { const d = parseDateStr(txt.value); if (d) iso.value = toISODate(d); });
    w.addEventListener('click', e => {
      if (e.target === w) return closeQm();
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'cancel') return closeQm();
      if (a.dataset.a === 'save') {
        const d = parseDateStr(txt.value) || parseDateStr(iso.value);
        if (!d) { toast('Enter a date like 11/9/26'); return; }
        pushHistory(); q.date = todayStr(d); saveNote(n, true); closeQm();
        try { renderOverlay(pi); } catch (_) {}
        toast('Date updated');
      }
    });
  }
  function openQnumEdit(pi, qid) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || !pg.qsheet || sealed(n)) return;
    const q = pg.qsheet.quotes.find(x => x.id === qid); if (!q) return;
    closeQm();
    const w = document.createElement('div'); w.id = 'qmWrap'; w.className = 'qm-wrap';
    w.innerHTML = `<div class="qm-sheet" role="dialog" aria-modal="true" aria-label="Quote number">
      <h3>Quote number</h3>
      <p class="fine">Auto-generated as Q-MMDD-NN. Edit freely — keep it unique if you can.</p>
      <label>Number<input autocomplete="off" spellcheck="false" data-f="num" value="${esc(q.qnum || '')}"></label>
      <div class="qm-actions"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div>
    </div>`;
    document.body.append(w);
    const inp = w.querySelector('[data-f="num"]'); setTimeout(() => { inp.focus(); inp.select(); }, 50);
    w.addEventListener('click', e => {
      if (e.target === w) return closeQm();
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'cancel') return closeQm();
      if (a.dataset.a === 'save') {
        const v = inp.value.trim(); if (!v) { toast('Enter a quote number'); return; }
        pushHistory(); q.qnum = v; saveNote(n, true); closeQm();
        try { renderOverlay(pi); } catch (_) {}
        toast('Quote number updated');
      }
    });
  }
  function openStatusPick(pi, qid) {
    const n = curNote(), pg = n && n.pages[pi]; if (!pg || !pg.qsheet || sealed(n)) return;
    const q = pg.qsheet.quotes.find(x => x.id === qid); if (!q) return;
    closeQm();
    const w = document.createElement('div'); w.id = 'qmWrap'; w.className = 'qm-wrap';
    w.innerHTML = `<div class="qm-sheet" role="dialog" aria-modal="true" aria-label="Quote status">
      <h3>Status</h3>
      <p class="fine">Open → Sent → Won or Lost.</p>
      <div class="qm-status-list">${STATUSES.map(s =>
        `<button type="button" data-st="${s.id}" aria-current="${q.status === s.id ? 'true' : 'false'}" style="border-color:${s.bd};background:${s.bg};color:${s.fg}"><span class="qm-dot" style="background:${s.fg}"></span>${s.label}</button>`
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

  /* ---------- overlay chips ---------- */
  function drawMetaUI(pi, pg, rec, note) {
    if (!pg.qsheet || sealed(note)) return;
    let migrated = false;
    const s = S.scale;
    pg.qsheet.quotes.forEach((q, i) => {
      if (ensureMeta(q, note)) migrated = true;
      const L = V21ed.qLayout(q);
      const row = document.createElement('div');
      row.className = 'qs-meta-row';
      row.style.left = (L.x + 92) * s + 'px';
      row.style.top = (L.y + 3) * s + 'px';
      row.style.width = (L.w - 92 - 36) * s + 'px';
      const mk = (cls, text, title, attrs = {}) => {
        const b = document.createElement('button');
        b.className = 'qs-ui qs-meta ' + cls; b.textContent = text; b.title = title;
        b.dataset.q = q.id; for (const k in attrs) b.setAttribute(k, attrs[k]);
        row.append(b); return b;
      };
      mk('qs-qnum', q.qnum || 'Q-—', `Quote number ${q.qnum || ''} — tap to edit`, { 'aria-label': `Quote ${i + 1} number ${q.qnum || ''}` });
      const blank = !q.date;
      const dateBtn = mk('qs-date' + (blank ? ' blank' : ''), blank ? todayStr() : q.date, blank ? 'Tap to set the quote date' : `Date ${q.date} — tap to edit`, { 'aria-label': `Quote ${i + 1} date` });
      if (blank) dateBtn.dataset.blank = '1';
      const stt = statusOf(q.status);
      const sb = mk('qs-status', stt.label, `Status ${stt.label} — tap to change`, { 'aria-label': `Quote ${i + 1} status ${stt.label}`, 'data-st': stt.id });
      sb.style.color = stt.fg; sb.style.background = stt.bg; sb.style.borderColor = stt.bd;
      rec.ov.append(row);
    });
    if (migrated) setTimeout(() => quietSave(note), 0);
  }

  const _ovh = v7OverlayHook;
  v7OverlayHook = function (pi) {
    _ovh.apply(this, arguments);
    const n = curNote(), rec = pageEls[pi], pg = n && n.pages[pi];
    if (!rec || !pg || !pg.qsheet) return;
    try { drawMetaUI(pi, pg, rec, n); } catch (e) { console.warn('v21em overlay', e); }
  };

  /* clicks on meta chips (capture, before page ink) */
  const PAGES = document.getElementById('pages');
  PAGES.addEventListener('click', e => {
    const b = e.target.closest('.qs-meta'); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    const pi = +b.closest('.page[data-pi]').dataset.pi, id = b.dataset.q;
    if (b.classList.contains('qs-date')) openDateEdit(pi, id);
    else if (b.classList.contains('qs-qnum')) openQnumEdit(pi, id);
    else if (b.classList.contains('qs-status')) openStatusPick(pi, id);
  }, true);

  /* ---------- wrap create paths so new quotes get meta immediately ---------- */
  function stampNew(n, pi) {
    const pg = n && n.pages[pi]; if (!pg || !pg.qsheet) return;
    let ch = false;
    for (const q of pg.qsheet.quotes) if (ensureMeta(q, n, { fresh: true })) ch = true;
    if (ch) { try { saveNote(n, true); } catch (_) {} try { renderOverlay(pi); } catch (_) {} }
  }
  if (window.V21ed) {
    const _aq = V21ed.addQuote;
    V21ed.addQuote = function (pi) {
      const r = _aq.apply(this, arguments);
      if (r) {
        const n = curNote(), q = n && n.pages[r.pi] && n.pages[r.pi].qsheet.quotes.find(x => x.id === r.id);
        if (q) { ensureMeta(q, n, { fresh: true }); try { saveNote(n, true); renderOverlay(r.pi); } catch (_) {} }
        // overflow may have created a page of quotes via newQ — stamp any still missing
        if (n) n.pages.forEach((p, i) => { if (p.qsheet) { let ch = false; for (const qq of p.qsheet.quotes) if (ensureMeta(qq, n, { fresh: !('date' in qq) && !qq.qnum })) ch = true; if (ch) try { renderOverlay(i); } catch (_) {} } });
      }
      return r;
    };
    const _is = V21ed.insertSheet;
    V21ed.insertSheet = function (pi) {
      const at = _is.apply(this, arguments);
      if (at != null) stampNew(curNote(), at);
      return at;
    };
  }

  /* migrate whatever is on screen now */
  try {
    const n = curNote();
    if (n && migrateNote(n)) { quietSave(n); try { buildPages(); } catch (_) {} }
  } catch (_) {}

  /* ---------- PDF export: paint meta into the header band ---------- */
  const _doe = drawOverlaysForExport;
  drawOverlaysForExport = function (ctx, pg, note) {
    const r = _doe.apply(this, arguments);
    try {
      if (pg && pg.qsheet) {
        migratePage(note, pg);
        ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        for (const q of pg.qsheet.quotes) {
          const L = V21ed.qLayout(q), stt = statusOf(q.status);
          const y = L.y + 20, x0 = L.x + 100;
          ctx.font = `700 12px ${FONT}`;
          ctx.fillStyle = isDark() ? 'rgba(200,200,215,.75)' : 'rgba(70,70,90,.7)';
          const bits = [q.qnum || '', q.date || '', stt.label].filter(Boolean);
          let x = x0;
          for (let i = 0; i < bits.length; i++) {
            const t = bits[i];
            if (i === bits.length - 1) { ctx.fillStyle = stt.fg; }
            ctx.fillText(t, x, y);
            x += ctx.measureText(t).width + 14;
          }
        }
        ctx.restore();
      }
    } catch (e) { console.warn('v21em export', e); }
    return r;
  };

  /* ---------- handwriting search: quote # / date / status ----------
     v21ee's search() is closed over inside its IIFE, so we (1) extend noteSearchText
     for the notebook filter and (2) append meta hits into #hwResults after render. */
  try {
    if (typeof noteSearchText === 'function') {
      const _nst = noteSearchText;
      noteSearchText = function (n) {
        const extra = (n.pages || []).flatMap(p => ((p.qsheet && p.qsheet.quotes) || []).map(q => {
          ensureMeta(q, n); return [q.qnum, q.date, statusOf(q.status).label].join(' ');
        })).join(' ');
        return _nst.apply(this, arguments) + ' ' + extra.toLowerCase();
      };
    }
  } catch (e) { console.warn('v21em noteSearchText', e); }

  function metaHits(query) {
    const q = String(query || '').trim().toLowerCase(); if (q.length < 2) return [];
    const out = [];
    for (const n of S.notes || []) {
      if (typeof locked === 'function' && locked(n)) continue;
      n.pages.forEach((pg, pi) => {
        if (!pg.qsheet) return;
        pg.qsheet.quotes.forEach((qq, qi) => {
          ensureMeta(qq, n);
          const stt = statusOf(qq.status);
          const blob = [qq.qnum, qq.date, stt.label, 'Quote ' + (qi + 1)].filter(Boolean).join(' ');
          if (!blob.toLowerCase().includes(q)) return;
          const L = V21ed.qLayout(qq);
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
    // remove prior injects, then append
    box.querySelectorAll('.hw-res.qm-hit').forEach(el => el.remove());
    const head = box.querySelector('.hw-head b');
    hits.forEach(h => {
      const b = document.createElement('button');
      b.className = 'hw-res qm-hit';
      b.innerHTML = `<span class="hw-meta"><span class="hw-t">${esc(h.note.title)} · p.${h.pi + 1}</span>` +
        `<span class="hw-k">🧾 ${esc(h.q.qnum || 'Quote')} · ${esc(h.stt.label)}` +
        `<span class="hw-status-chip" style="color:${h.stt.fg};background:${h.stt.bg};border:1px solid ${h.stt.bd}">${esc(h.stt.label)}</span></span>` +
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
  const _rs2 = renderSidebar;
  renderSidebar = function () {
    const r = _rs2.apply(this, arguments);
    try { injectMetaHits(); } catch (e) { console.warn('v21em hits', e); }
    return r;
  };
  if (window.V21ee && typeof V21ee.search === 'function') {
    const _search = V21ee.search;
    V21ee.search = function (query, limit) {
      const hits = _search.apply(this, arguments) || [];
      const extra = metaHits(query);
      for (const h of extra) hits.push({ note: h.note, pi: h.pi, pg: h.pg, kind: '🧾 ' + (h.q.qnum || 'Quote') + ' · ' + h.stt.label, t: h.blob, bb: h.bb, s: { pre: '', hit: h.blob, post: '' }, status: h.q.status });
      return hits.slice(0, limit || 60);
    };
  }

  window.V21em = {
    version: 'v21em', STATUSES, statusOf, todayStr, mmdd, parseDateStr, nextQnum, ensureMeta, migrateNote, migratePage,
    openDateEdit, openQnumEdit, openStatusPick, allQnums
  };
})();
