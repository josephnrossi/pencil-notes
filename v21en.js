/* Pencil Notes v21en — Quote date: new empty quotes get today, not the note's age.
   Mock only. Loads after v21em.
   Bug: v21em ensureMeta treated any quote without a date (and without opts.fresh) as
   legacy and stamped the NOTE's createdAt/updatedAt. Paths that create a new Quote sheet
   (Add page, Insert, ＋ Quote overflow) often ran ensureMeta via buildPages/migrate/search
   before the fresh stamp, so a new quote in an older note showed 11/6 instead of today.
   Rule: a quote with no date and no content (no ink in its fields, no typed values, no
   filled rows) gets today's date and a today-based Q number, whichever path touches it
   first. Only quotes that already have content when first migrated use the note date
   (updatedAt preferred over createdAt).
   Repair: an empty quote whose date was auto-filled from the note date (and not user-
   edited) is re-dated to today when its page is opened. openDateEdit sets q.dateEdited
   so a date the user picked is never overwritten. IndexedDB data is never deleted. */
(function () {
  if (!window.V21em) { console.warn('v21en: v21em missing'); return; }

  const todayStr = V21em.todayStr;
  const mmdd = V21em.mmdd;
  const parseDateStr = V21em.parseDateStr;
  const nextQnum = V21em.nextQnum;
  const STATUSES = V21em.STATUSES;

  function pageOf(note, q) {
    if (!note || !q) return null;
    return (note.pages || []).find(pg => ((pg.qsheet && pg.qsheet.quotes) || []).some(x => x === q || x.id === q.id)) || null;
  }
  function inBox(r, x, y) {
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  function strokeCenter(s) {
    const b = s && (s.bb || (s.points && s.points.length && (typeof bbox === 'function' ? bbox(s.points) : null)));
    if (b) return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    if (s && s.points && s.points.length) {
      let a = Infinity, b1 = Infinity, c = -Infinity, d = -Infinity;
      for (const p of s.points) { if (p[0] < a) a = p[0]; if (p[1] < b1) b1 = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; }
      return [(a + c) / 2, (b1 + d) / 2];
    }
    return null;
  }

  /** True if the quote already has ink, typed text, or filled row values. */
  function quoteHasContent(q, note, pg) {
    if (!q) return false;
    if (q.fix && Object.values(q.fix).some(v => String(v == null ? '' : v).trim())) return true;
    pg = pg || pageOf(note, q);
    if (!pg || !window.V21ed) return false;
    let L;
    try { L = V21ed.qLayout(q); } catch (_) { return false; }
    const box = { x: L.x, y: L.y, w: L.w, h: L.h };
    if ((pg.strokes || []).some(s => { const c = strokeCenter(s); return c && inBox(box, c[0], c[1]); })) return true;
    if ((pg.texts || []).some(t => String(t.text || '').trim() && inBox(box, (t.x || 0) + 4, (t.y || 0) + 10))) return true;
    return false;
  }

  function noteDates(note) {
    const out = [];
    for (const t of [note && note.updatedAt, note && note.createdAt]) {
      if (t == null || t === '') continue;
      const d = new Date(t);
      if (!isNaN(d)) out.push(todayStr(d));
    }
    return out;
  }
  function noteStampDate(note) {
    const t = note && (note.updatedAt || note.createdAt);
    if (t == null || t === '') return null;
    const d = new Date(t);
    return isNaN(d) ? null : d;
  }

  /** Empty, not user-edited, auto-stamped from the note date → today + today-based Q number. */
  function repairEmptyNoteDate(q, note) {
    if (!q || q.dateEdited) return false;
    if (quoteHasContent(q, note)) return false;
    if (!q.date) return false;
    const today = todayStr();
    if (q.date === today) return false;
    if (!noteDates(note).includes(q.date)) return false;
    const old = q.date;
    q.date = today;
    const oldD = parseDateStr(old);
    if (oldD && q.qnum && String(q.qnum).startsWith('Q-' + mmdd(oldD) + '-')) {
      q.qnum = nextQnum(new Date());
    }
    return true;
  }

  function ensureMeta(q, note, opts = {}) {
    if (!q) return false;
    let changed = false;
    if (!STATUSES.some(s => s.id === q.status)) { q.status = 'open'; changed = true; }
    if (repairEmptyNoteDate(q, note)) changed = true;
    if (!('date' in q)) {
      const has = quoteHasContent(q, note);
      if (!has || opts.fresh) q.date = todayStr();
      else {
        const d = noteStampDate(note);
        q.date = d ? todayStr(d) : '';
      }
      changed = true;
    }
    if (!q.qnum) {
      const d = parseDateStr(q.date) || new Date();
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

  V21em.ensureMeta = ensureMeta;
  V21em.migratePage = migratePage;
  V21em.migrateNote = migrateNote;
  V21em.version = 'v21en';

  window.V21en = {
    version: 'v21en', ensureMeta, migratePage, migrateNote, quoteHasContent, repairEmptyNoteDate, pageOf
  };
})();
