const CACHE = 'pencil-notes-v21e5';
const ASSETS = ['./', 'index.html', 'styles.css', 'db.js', 'app.js', 'v7.js', 'board.js', 'assist-engine.js', 'assistant.js', 'assistant2.js', 'lock.js', 'record.js', 'audit.js', 'quotes.js', 'graph.js', 'v21.js', 'inbox.js', 'v21d.js', 'v21e.js', 'v21e2.js', 'v21e3.js', 'v21e4.js', 'v21e5.js', 'authcap.js', 'vendor/msal/msal-browser.min.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'manifest.json',
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
