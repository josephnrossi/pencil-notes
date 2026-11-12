const CACHE = 'pencil-notes-v21ff';
const ASSETS = ['./', 'index.html', 'styles.css', 'db.js', 'app.js', 'v7.js', 'board.js', 'assist-engine.js', 'assistant.js', 'assistant2.js', 'lock.js', 'record.js', 'audit.js', 'quotes.js', 'graph.js', 'v21.js', 'inbox.js', 'v21d.js', 'v21e.js', 'v21e2.js', 'v21e3.js', 'v21e4.js', 'v21e5.js', 'v21e6.js', 'v21e7.js', 'v21e8.js', 'v21e9.js', 'v21ea.js', 'v21eb.js', 'v21ec.js', 'v21ed.js', 'v21ee.js', 'calcrecog.js', 'calcboard.js', 'calcboard.css', 'v21eg.js', 'v21eg.css', 'v21eh.js', 'v21ei.js', 'v21ej.js', 'v21ek.js', 'v21el.js', 'v21em.js', 'v21en.js', 'v21eo.js', 'v21eo.css', 'v21ep.js', 'v21eq.js', 'v21er.js', 'v21es.js', 'v21ep.css', 'v21eq.css', 'v21er.css', 'v21es.css', 'v21et.js', 'v21et.css', 'v21eu.js', 'v21eu.css', 'v21ev.js', 'v21ev.css', 'v21ew.js', 'v21ew.css', 'v21ex.js', 'v21ex.css', 'v21ey.js', 'v21ey.css', 'v21ez.js', 'v21ez.css', 'v21fa.js', 'v21fa.css', 'v21fb.js', 'v21fb.css', 'v21fc.js', 'v21fc.css', 'v21fd.js', 'v21fd.css', 'v21fe.js', 'v21fe.css', 'v21ff.js', 'v21ff.css', 'resin-data.json', 'sales-leads-data.json', 'authcap.js', 'vendor/msal/msal-browser.min.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'manifest.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Stale-while-revalidate: instant offline loads, quietly picks up updates.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const u = new URL(req.url);
  if (u.pathname.endsWith('/cal.ics') && u.searchParams.get('e')) {
    // Serve a calendar event as a real .ics file so iPad shows Apple's "Add to Calendar" screen.
    let ics = '';
    try { const b = u.searchParams.get('e').replace(/-/g, '+').replace(/_/g, '/'); ics = decodeURIComponent(escape(atob(b))); } catch (err) { ics = ''; }
    // only well-formed single calendars are served; anything else is refused (no arbitrary content from a link)
    if (ics.length > 20000 || !/^BEGIN:VCALENDAR\r?\n/.test(ics) || !/END:VCALENDAR\s*$/.test(ics) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(ics) || (ics.match(/BEGIN:VCALENDAR/g) || []).length !== 1) { e.respondWith(new Response('Not a valid calendar event', { status: 400, headers: { 'Content-Type': 'text/plain' } })); return; }
    const name = (u.searchParams.get('n') || 'reminder').replace(/[^\w\- ]+/g, '') + '.ics';
    e.respondWith(new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="' + name + '"', 'Cache-Control': 'no-store' } }));
    return;
  }
  // resin-data.json (hourly) and sales-leads-data.json (daily): network-first so a fresh publish is not stuck behind stale-while-revalidate
  const live = ['resin-data.json', 'sales-leads-data.json'].find(f => u.pathname.endsWith(f));
  if (live) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(live, copy)); }
      return res;
    }).catch(async () => {
      const c = await caches.open(CACHE);
      return (await c.match(live)) || (await c.match(req, { ignoreSearch: true }));
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  const url = './index.html#note=' + (d.noteId || '') + (d.taskId ? '&task=' + d.taskId : '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { c.postMessage({ type: 'open', ...d }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
