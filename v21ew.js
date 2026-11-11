/* Pencil Notes v21ew — remove the floating Qty/Price tap-to-type chips and number pad entirely.
   Joseph: "on quote remove transparent floating button to enter quantities. remove that feature entirely."
   The Quote sheet is a clean handwriting sheet again (Product / Size / Qty / Price, Pencil ink anywhere,
   quote number/date/status header, ＋ line / － row, ＋ Quote, trash, Notes with ＋ line). Stored q.typed
   values are left untouched and still go out in backup/export, but nothing in the UI reads or shows them.
   Mock only. Loads after v21ev. Does not touch meeting recordings, Idea Board, or action items. */
(function () {
  'use strict';
  const VERSION = 'v21ew';

  function drawTotalsUI() {
    // v21ew: no Qty/Price chips, no typed-value labels, no row/quote total pills.
  }
  function openPad() { /* feature removed — typing Qty/Price from a floating 123 target is gone */ }
  function openFix() { /* feature removed — the check-handwriting / number-pad sheets do not open */ }
  function closePad() { const w = document.getElementById('qtPad'); if (w) w.remove(); }
  function closeFix() { closePad(); const w = document.getElementById('qtFix'); if (w) w.remove(); }

  if (window.V21ee) {
    V21ee.drawTotalsUI = drawTotalsUI;
    V21ee.openFix = openFix;
    V21ee.closeFix = closeFix;
  }
  if (window.V21eu) {
    V21eu.drawTotalsUI = drawTotalsUI;
    V21eu.openFix = openFix;
    V21eu.openPad = openPad;
    V21eu.closeFix = closeFix;
    V21eu.closePad = closePad;
    // setVal / rawOf / onRemoveLine / migrateQuote / q.typed stay so stored values are not lost
  }
  if (window.V21et) V21et.chipAt = () => null;   // leftover chips, if any, are not hit-tested

  closeFix();

  window.V21ew = { version: VERSION, VERSION, drawTotalsUI, openPad, openFix, closePad, closeFix };

  const whenReady = f => { if (window.__ready) return f(); const t = setInterval(() => { if (window.__ready) { clearInterval(t); f(); } }, 60); setTimeout(() => clearInterval(t), 15000); };
  whenReady(() => {
    try {
      const n = curNote();
      if (n) (n.pages || []).forEach((pg, pi) => { if (pg.qsheet && pageEls[pi]) try { renderOverlay(pi); } catch (_) {} });
    } catch (_) {}
  });
})();
