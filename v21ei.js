/* Pencil Notes v21ei — Quote sheet: Pencil ink lands exactly under the tip · wider Size column (MOCK, not published).
   Root cause (reproduced): writing with the palm resting on the glass, iPad sends the palm's contact points as touches.
   Two palm contacts look like a two-finger pinch, so the pinch-zoom preview scaled/moved #pagesInner with a CSS transform
   (as low as 0.85×) while the Pencil was writing. toPage() divided by S.scale (the un-transformed scale), so every point
   landed at y × k — above the tip, and further above the lower on the page you wrote. When the palm lifted, the preview
   snapped back to 100% and the ink stayed above the line.
   1. Palm contacts no longer shrink/shift the page: two contacts show no zoom preview until they really pinch (±6 %) or
      pan (14 px); a pinch can't start while the Pencil is in use (down, hovering, or lifted < 1.2 s); and if a preview is
      already on screen when the Pencil lands, it is frozen exactly as seen and the palm lifting never zooms.
   2. toPage() maps with the page's real on-screen size (getBoundingClientRect ÷ PAGE_W/PAGE_H), so ink is exact even if a
      transform is ever on screen — same result as before on every normal page (lined, grid, meeting, Daily To-Do, Quote).
   Size column: see v21ed.js (CW_WIDE). */
(function () {
  const inner = () => document.getElementById('pagesInner');
  const DEAD_R = 0.06, DEAD_PX = 14;          // a palm's contacts drift a little; a real pinch / pan moves much more
  const count = why => { window.__v21eiPinch = window.__v21eiPinch || {}; window.__v21eiPinch[why] = (window.__v21eiPinch[why] || 0) + 1; };
  function abortPinch(why) {
    if (!pinch) return false;
    pinch = null; const el = inner(); if (el) { el.style.transform = ''; el.style.transformOrigin = ''; }
    count(why); return true;
  }
  // 2. exact mapping from the rendered page box (identical to S.scale when nothing is transformed)
  toPage = function (e, cv) {
    const r = cv.getBoundingClientRect();
    const sx = r.width > 0 ? r.width / PAGE_W : S.scale, sy = r.height > 0 ? r.height / PAGE_H : S.scale;
    return [(e.clientX - r.left) / sx, (e.clientY - r.top) / sy];
  };
  // 1a. Pencil touches the glass while two contacts are "pinching" (= the palm):
  //     preview not visible yet → drop it; preview visible → freeze it exactly as seen (ink maps through it, see toPage)
  //     and never zoom when the palm lifts. Runs in the capture phase, before app.js reads the first point.
  let penAt = 0, penDown = false;
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'pen') return; penDown = true; penAt = Date.now();
    if (!pinch) return;
    if (!pinch.live) abortPinch('pen-down');
    else { pinch.frozen = inner().style.transform; count('frozen'); }
  }, true);
  const penUp = e => { if (e.pointerType === 'pen') { penDown = false; penAt = Date.now(); } };
  window.addEventListener('pointerup', penUp, true); window.addEventListener('pointercancel', penUp, true);
  window.addEventListener('pointermove', e => { if (e.pointerType === 'pen') penAt = Date.now(); }, true);   // Pencil hover counts as "in use"
  const PAGES = document.getElementById('pages');
  // (bubble listeners added after app.js's own → they run right after it, in the same task, before any paint)
  // 1b. palm contacts while the Pencil is in use never start a pinch
  PAGES.addEventListener('touchstart', e => {
    const pen = penDown || Date.now() - penAt < 1200 || [...e.touches].some(t => t.touchType === 'stylus');
    if (pen && pinch && !pinch.frozen) abortPinch('palm');
  }, { passive: true });
  // 1c. dead zone: no zoom preview until the two contacts really pinch or pan; a frozen preview stays put
  PAGES.addEventListener('touchmove', () => {
    if (!pinch) return; const el = inner();
    if (pinch.frozen != null) { el.style.transform = pinch.frozen; return; }
    if (!pinch.live) {
      if (Math.abs(pinch.ratio - 1) >= DEAD_R || Math.hypot(pinch.cx - pinch.cx0, pinch.cy - pinch.cy0) >= DEAD_PX) pinch.live = true;
      else el.style.transform = '';
    }
  }, { passive: true });
  // a pinch that never went live, or was frozen under the Pencil, ends without zooming or panning
  const neutral = e => { if (!pinch || (e.touches && e.touches.length >= 2)) return;
    if (!pinch.live || pinch.frozen != null) { pinch.ratio = 1; pinch.cx = pinch.cx0; pinch.cy = pinch.cy0; count(pinch.frozen != null ? 'frozen-end' : 'dead-end'); } };
  PAGES.addEventListener('touchend', neutral, true); PAGES.addEventListener('touchcancel', neutral, true);
  window.V21ei = { version: 'v21ei', abortPinch, toPage, DEAD_R, DEAD_PX };
})();
