/* Pencil Notes v21et — Quote sheet Qty / Price: audit fixes. Mock only. Loads after v21es.
   Root causes fixed (see V21ET-AUDIT in the report; code changes marked "v21et" in v21ee.js / v21el.js):
   1. A failed Grok read (timeout, HTTP 429, offline) was swallowed and cached as '' → "? can't read" stuck on the cell. Now retried with backoff.
   2. Reads wrapped in words/markdown ("The quantity is 3725", "**74.26**") were flagged as text. Now the wrapper is stripped.
   3. A decimal point written as a short dash/tick ("5-46") was two numbers → flagged. Now a price decimal (also put back from the ink).
   4. The read-value chips straddle each row's bottom rule and their 44px tap targets covered the whole Qty + Price area of the row
      above AND the row below (after ＋ line, the new row's top half). A Pencil stroke starting there began on a <button>: on iPad that
      touch is not prevented (only CANVAS targets are), so Safari may scroll and send pointercancel → the stroke is dropped, digits go
      missing. Now the chips take no touches; Pencil always lands on the page canvas; a finger tap on a chip is hit-tested here. */
(function () {
  'use strict';
  const VERSION = 'v21et';
  const PAGES = document.getElementById('pages'); if (!PAGES) return;
  const chipAt = (x, y) => {   // finger tap → the chip under it (44px-tall target, ≥44px wide), nearest centre wins
    let best = null, bd = Infinity;
    for (const b of PAGES.querySelectorAll('.qt-wrapui .qt-ui')) { const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hw = Math.max(22, r.width / 2), hh = Math.max(22, r.height / 2); if (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh) continue;
      const d = Math.hypot(x - cx, (y - cy) * 2); if (d < bd) { bd = d; best = b; } }
    return best;
  };
  let tap = null;
  PAGES.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') { PAGES.classList.add('qt-pen'); clearTimeout(fadeT); return; }
    tap = e.isPrimary && chipAt(e.clientX, e.clientY) ? { x: e.clientX, y: e.clientY, at: Date.now(), id: e.pointerId } : null;
  }, true);
  let fadeT = 0;
  const penUp = e => { if (e.pointerType === 'pen') { clearTimeout(fadeT); fadeT = setTimeout(() => PAGES.classList.remove('qt-pen'), 900); } };
  addEventListener('pointerup', penUp, true); addEventListener('pointercancel', penUp, true);
  PAGES.addEventListener('pointerup', e => {
    const t = tap; tap = null; if (!t || e.pointerId !== t.id || e.pointerType === 'pen' || Date.now() - t.at > 600 || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) return;
    const b = chipAt(e.clientX, e.clientY); if (!b) return;
    e.stopPropagation(); e.preventDefault();
    const pg = b.closest('.page[data-pi]'); if (!pg || !window.V21ee) return;
    const row = b.dataset.row != null ? b.dataset.row : b.dataset.vrow;
    V21ee.openFix(+pg.dataset.pi, b.dataset.q, row != null ? +row : null, b.dataset.f || null);
  }, true);
  // a click that follows the tap (mouse / synthetic) must not also reach the page
  PAGES.addEventListener('click', e => { if (e.pointerType !== 'pen' && chipAt(e.clientX, e.clientY) && document.getElementById('qtFix')) { e.stopPropagation(); } }, true);
  window.V21et = { version: VERSION, VERSION, chipAt };
})();
