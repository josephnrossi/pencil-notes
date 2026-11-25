/* Pencil Notes v21fp — Clear board on the Idea Board.
   More menu → Clear board (hidden when the board is already empty) opens a
   confirm dialog that lists what will be removed. Confirm takes one undo step,
   clears only the current board (ink, notes, cards, frames, arrows), toasts
   with an Undo action, and keeps pg.board.preClearBackup in case undo history
   is reset. IndexedDB is never opened for deletion; other notes are untouched.
   No mid-stroke work. Resin Board and Sales Leads stay hidden. */
(function () {
  'use strict';
  const VERSION = 'v21fp';
  const FM = () => window.V21fm;
  const FN = () => window.V21fn;
  const EXT = window.V21fmExt || (window.V21fmExt = {});
  const copy = o => JSON.parse(JSON.stringify(o));
  const ideaN = () => (typeof ideaNote === 'function' ? ideaNote() : (S.notes || []).find(n => n && n.id === 'ideaboard'));
  const ideaPg = () => { const n = ideaN(); return n && n.pages && n.pages[0] ? n.pages[0] : null; };
  const isMedia = n => { const fm = FM(); return fm && typeof fm.isMedia === 'function' ? fm.isMedia(n) : !!(n && n.kind && n.kind !== 'note' && n.media); };
  const sayAct = (m, label, fn, ms) => { try { if (typeof actionToast === 'function') return actionToast(m, label, fn, ms || 6000); } catch (_) {} try { toast(m, ms || 6000); } catch (_) {} };

  const ENTRY = { v: VERSION, d: 'Nov 2026', items: [
    'Idea Board: More now has Clear board. It lists what will be removed, asks you to confirm, and a single Undo brings everything back.',
    'A snapshot of the board is kept on the page, so the last clear isn’t lost if undo history is reset.'
  ] };
  function addChangelog() { const fn = FN(); if (fn && Array.isArray(fn.CHANGELOG) && !fn.CHANGELOG.some(c => c.v === VERSION)) fn.CHANGELOG.unshift(ENTRY); }
  addChangelog();

  function counts(fm) {
    fm = fm || (FM() && FM().model()) || { notes: [], arrows: [], frames: [], strokes: [] };
    const notes = fm.notes || [];
    const stickies = notes.filter(n => !isMedia(n)).length;
    const kinds = { photo: 0, pdf: 0, link: 0, clip: 0, text: 0 };
    for (const n of notes) if (isMedia(n) && kinds[n.kind] != null) kinds[n.kind]++;
    else if (isMedia(n)) kinds.clip++; // unknown media counted with clips
    const c = {
      strokes: (fm.strokes || []).length,
      stickies,
      photos: kinds.photo, pdfs: kinds.pdf, links: kinds.link, clips: kinds.clip, texts: kinds.text,
      frames: (fm.frames || []).length,
      arrows: (fm.arrows || []).length
    };
    c.cards = c.photos + c.pdfs + c.links + c.clips + c.texts;
    c.total = c.strokes + c.stickies + c.cards + c.frames + c.arrows;
    return c;
  }
  const isEmpty = c => !c || !c.total;

  function snapOf(fm) {
    fm = fm || FM().model();
    return { notes: copy(fm.notes || []), arrows: copy(fm.arrows || []), frames: copy(fm.frames || []), strokes: copy(fm.strokes || []) };
  }
  function applySnap(s) {
    const fm = FM(), m = fm.model();
    m.notes = copy(s.notes || []); m.arrows = copy(s.arrows || []); m.frames = copy(s.frames || []); m.strokes = copy(s.strokes || []);
    fm.ST.sel = null;
    if (fm.clearCaches) fm.clearCaches();
    fm.paintAll(); fm.scheduleSave();
    if (fm.placeSelChrome) fm.placeSelChrome();
  }
  function writeBackup(s) {
    const pg = ideaPg(); if (!pg) return null;
    pg.board = pg.board || { title: 'Idea Board', idea: true, columns: [] };
    pg.board.preClearBackup = { at: Date.now(), notes: s.notes, arrows: s.arrows, frames: s.frames, strokes: s.strokes };
    return pg.board.preClearBackup;
  }
  function readBackup() { const pg = ideaPg(); return pg && pg.board && pg.board.preClearBackup; }

  const WORD = {
    strokes: ['handwriting stroke', 'handwriting strokes'],
    stickies: ['sticky note', 'sticky notes'],
    photos: ['photo', 'photos'],
    pdfs: ['PDF', 'PDFs'],
    links: ['link', 'links'],
    clips: ['clip', 'clips'],
    texts: ['text card', 'text cards'],
    frames: ['frame', 'frames'],
    arrows: ['arrow', 'arrows']
  };
  function phrase(n, pair) { return n + ' ' + (n === 1 ? pair[0] : pair[1]); }
  function cardLine(c) {
    const parts = [];
    for (const k of ['photos', 'pdfs', 'links', 'clips', 'texts']) if (c[k]) parts.push(phrase(c[k], WORD[k]));
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] + ' and ' + parts[1];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }
  function lines(c) {
    const out = [];
    if (c.strokes) out.push(phrase(c.strokes, WORD.strokes));
    if (c.stickies) out.push(phrase(c.stickies, WORD.stickies));
    const cards = cardLine(c); if (cards) out.push(cards);
    if (c.frames) out.push(phrase(c.frames, WORD.frames));
    if (c.arrows) out.push(phrase(c.arrows, WORD.arrows));
    return out;
  }

  EXT.syncOverflow = function (ov) {
    ov = ov || (document.querySelector('.fm-overflow'));
    if (!ov) return;
    let b = ov.querySelector('[data-act="clear"]');
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'fm-clear danger'; b.dataset.act = 'clear';
      b.textContent = 'Clear board'; ov.append(b);
    }
    b.hidden = isEmpty(counts());
  };

  let dlg = null;
  function dialogEl() {
    if (dlg) return dlg;
    dlg = document.createElement('div'); dlg.id = 'fpClear'; dlg.hidden = true;
    dlg.innerHTML = '<div class="fp-clear-card" role="dialog" aria-modal="true" aria-labelledby="fpClearTitle">' +
      '<h3 id="fpClearTitle">Clear this board?</h3>' +
      '<p class="fp-lead">This removes everything on the Idea Board. Your other notes are not changed.</p>' +
      '<ul class="fp-list"></ul>' +
      '<div class="fp-btns"><button type="button" data-fp="cancel">Cancel</button>' +
      '<button type="button" class="danger" data-fp="ok">Clear board</button></div></div>';
    document.body.append(dlg);
    dlg.addEventListener('click', ev => {
      if (ev.target === dlg || ev.target.closest('[data-fp="cancel"]')) { closeDialog(); return; }
      if (ev.target.closest('[data-fp="ok"]')) { closeDialog(); doClear(); }
    });
    return dlg;
  }
  function closeDialog() { if (dlg) dlg.hidden = true; }
  function openDialog() {
    const c = counts(); if (isEmpty(c)) return;
    const el = dialogEl();
    const ul = el.querySelector('.fp-list');
    ul.innerHTML = lines(c).map(t => '<li>' + t.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</li>').join('');
    el.hidden = false;
    const cancel = el.querySelector('[data-fp="cancel"]');
    setTimeout(() => cancel && cancel.focus(), 30);
  }
  EXT.clearBoardAsk = function () { openDialog(); };

  function doClear() {
    const fm = FM(); if (!fm || !fm.isOpen() || typeof fm.pushUndo !== 'function') return false;
    if (fm.strokeActive && fm.strokeActive()) return false; // never mid-stroke
    const c = counts(); if (isEmpty(c)) return false;
    const before = snapOf();
    fm.pushUndo();                 // one undo step that restores the whole board
    writeBackup(before);
    const m = fm.model();
    m.notes = []; m.arrows = []; m.frames = []; m.strokes = [];
    fm.ST.sel = null;
    if (fm.clearCaches) fm.clearCaches();
    fm.paintAll(); fm.scheduleSave();
    if (fm.placeSelChrome) fm.placeSelChrome();
    EXT.syncOverflow();
    sayAct('Board cleared · Undo', 'Undo', () => undoClear(), 6000);
    return true;
  }
  function undoClear() {
    const fm = FM(); if (!fm) return false;
    const before = counts();
    try { fm.undo(); } catch (_) {}
    if (!isEmpty(counts())) return true;
    // Undo history was reset (or the clear was already undone): use the snapshot.
    if (restoreBackup()) return true;
    return false;
  }
  function restoreBackup() {
    const s = readBackup(); if (!s) return false;
    applySnap(s);
    EXT.syncOverflow();
    return true;
  }

  function boot() {
    addChangelog();
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && dlg && !dlg.hidden) { ev.preventDefault(); closeDialog(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.V21fp = {
    version: VERSION, ENTRY, counts, isEmpty, lines, cardLine,
    ask: openDialog, close: closeDialog, clear: doClear, undo: undoClear, restore: restoreBackup,
    backup: readBackup, snapOf
  };
})();
