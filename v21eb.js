/* Pencil Notes v21eb — numbered section badges come only from ＋ Insert → Number (tap a line start to place
   the next 1. 2. 3.; badges stay draggable/reorderable). Handwritten digits always stay plain ink — the
   automatic “1.” → badge conversion is removed (v7/v21e3 detection made inert). Toolbar/focus-bar Number
   buttons removed so Insert is the single entry point. Existing badges in saved notes render and move as before.
   Quote form Quantity/Price OCR is unaffected (separate path). Mock only. */
(function () {
  try { localStorage.removeItem('autoNumber'); } catch (_) {}
  if (typeof NUM !== 'undefined') { clearTimeout(NUM.timer); NUM.recent = []; }
  window.V21eb = { version: 'v21eb', autoNumber: false };
})();
