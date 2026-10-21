/* v19: runs first. If Microsoft sign-in just redirected back here (#code=…&state=… or #error=…),
   keep that response for MSAL (graph.js) and clean the address bar before the app reads location.hash. */
(function () {
  try {
    var h = location.hash || '', q = location.search || '';
    var src = /[#&](code|error)=/.test(h) && /[#&]state=/.test(h) ? h : /[?&](code|error)=/.test(q) && /[?&]state=/.test(q) ? '#' + q.slice(1) : '';
    if (src) { sessionStorage.setItem('qbAuthResp', src); history.replaceState(null, '', location.pathname); }
  } catch (_) {}
})();
