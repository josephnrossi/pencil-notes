'use strict';
/* v19 — Work email (Microsoft 365 / Exchange) provider for the Quote Board.
   Microsoft Graph, delegated + read-only (User.Read, Mail.Read), MSAL.js auth-code + PKCE (SPA), redirect flow only
   (popups break in iOS home-screen apps). MSAL keeps its tokens in localStorage under its own keys; nothing about the
   account or tokens is written into notes, and Export never includes localStorage. */
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GR_SCOPES = ['User.Read', 'Mail.Read'];
const GR_PROD = 'https://josephnrossi.github.io/pencil-notes/';
const GR = { pca: null, key: '', loading: null, err: '', waitScale: 1 };
const grCfg = () => { let c = {}; try { c = JSON.parse(localStorage.getItem('qbGraph') || '{}') || {}; } catch (_) {} return { clientId: '', tenantId: '', authority: 'organizations', backfill: 90, attachments: true, ...c }; };
const grSaveCfg = c => localStorage.setItem('qbGraph', JSON.stringify({ clientId: (c.clientId || '').trim(), tenantId: (c.tenantId || '').trim(), authority: c.authority === 'common' ? 'common' : 'organizations', backfill: [30, 90, 365].includes(+c.backfill) ? +c.backfill : 90, attachments: c.attachments !== false }));
const grAcct = () => { try { return JSON.parse(localStorage.getItem('qbGraphAcct') || 'null'); } catch (_) { return null; } };
const grRedirect = () => location.origin === 'https://josephnrossi.github.io' ? GR_PROD : location.origin + location.pathname;
const grAuthority = c => 'https://login.microsoftonline.com/' + encodeURIComponent(c.tenantId || c.authority || 'organizations');
const grSleep = ms => new Promise(r => setTimeout(r, ms * (window.__qbGraphWaitScale ?? GR.waitScale)));

function grLoadMsal() {
  if (window.msal) return Promise.resolve();
  return GR.loading || (GR.loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/msal/msal-browser.min.js'; s.onload = () => res(); s.onerror = () => { GR.loading = null; rej(grError('Couldn’t load Microsoft sign-in — check your connection', { short: 'Offline' })); }; document.head.append(s); }));
}
async function grPca() {
  const c = grCfg(); if (!c.clientId) return null;
  const key = c.clientId + '|' + grAuthority(c) + '|' + grRedirect();
  if (GR.pca && GR.key === key) return GR.pca;
  await grLoadMsal();
  const pca = new msal.PublicClientApplication({
    auth: { clientId: c.clientId, authority: grAuthority(c), redirectUri: grRedirect(), postLogoutRedirectUri: grRedirect() },
    cache: { cacheLocation: 'localStorage' },
    system: { loggerOptions: { logLevel: 0, piiLoggingEnabled: false, loggerCallback: () => {} } },
  });
  await pca.initialize();
  GR.pca = pca; GR.key = key; return pca;
}

/* ---------- errors → plain English ---------- */
function grError(msg, extra = {}) { const e = new Error(msg); e.userMessage = msg; Object.assign(e, extra); return e; }
const CONSENT_MSG = 'Your company’s IT needs to approve this app before it can read your mail. Send them the setup guide (admin consent for User.Read and Mail.Read).';
function grErrMsg(e) {
  const s = [e && e.errorCode, e && e.errorMessage, e && e.subError, e && e.message].filter(Boolean).join(' ');
  if (/AADSTS65001|AADSTS90094|AADSTS90008|consent_required|admin.?consent|ErrorAccessDenied/i.test(s)) return CONSENT_MSG;
  if (/AADSTS50011/i.test(s)) return 'The redirect URI in your Entra app registration must be exactly ' + grRedirect() + ' (platform: Single-page application).';
  if (/AADSTS9002326|AADSTS9002327/i.test(s)) return 'In Entra, the redirect URI must be under “Single-page application”, not “Web”.';
  if (/AADSTS700016|AADSTS700054|unauthorized_client/i.test(s)) return 'Microsoft doesn’t recognise that Application (client) ID in your organisation — check it in Settings.';
  if (/AADSTS50020|AADSTS50194|AADSTS500200|AADSTS50128|AADSTS90072/i.test(s)) return 'This account type isn’t allowed by the app registration — check “Supported account types”, or enter your Tenant ID.';
  if (/AADSTS53003|AADSTS53000|AADSTS530/i.test(s)) return 'Your company’s sign-in policy blocked this device or app — ask IT (Conditional Access).';
  if (/user_cancelled|access_denied/i.test(s)) return 'Sign-in was cancelled.';
  if (/network|Failed to fetch|Load failed|no_network/i.test(s)) return 'Couldn’t reach Microsoft — check your connection.';
  return 'Microsoft sign-in failed: ' + (String((e && (e.errorMessage || e.message)) || e).split(/\r?\n|Trace ID/)[0].slice(0, 160));
}
const isConsent = e => grErrMsg(e) === CONSENT_MSG;

/* ---------- sign-in (redirect) ---------- */
function grSetAcct(a) { if (!a) { localStorage.removeItem('qbGraphAcct'); return; } localStorage.setItem('qbGraphAcct', JSON.stringify({ username: a.username || '', name: a.name || '', homeAccountId: a.homeAccountId || '' })); }
async function grSignIn() {
  const c = grCfg(); if (!c.clientId) { toast('Enter your Application (client) ID first'); return grSettings({ signIn: true }); }
  try {
    const pca = await grPca(); await pca.handleRedirectPromise({ navigateToLoginRequestUrl: false }).catch(() => null);
    sessionStorage.setItem('qbAuthPending', '1'); if (typeof flushSaves === 'function') flushSaves();
    const hint = grAcct();
    await pca.loginRedirect({ scopes: GR_SCOPES, prompt: hint ? undefined : 'select_account', loginHint: hint && hint.username || undefined, redirectStartPage: grRedirect() });
  } catch (e) { sessionStorage.removeItem('qbAuthPending'); GR.err = grErrMsg(e); toast('⚠︎ ' + GR.err, 7000); grSettings(); }
}
async function grSignOut() {
  try { const pca = await grPca(); const a = pca && (pca.getActiveAccount() || pca.getAllAccounts()[0]); if (pca) await pca.clearCache(a ? { account: a } : undefined); } catch (_) {}
  grSetAcct(null); localStorage.removeItem('qbLastSync'); GR.err = ''; QSync.err = ''; qbSyncStatus(); toast('Signed out of work email on this iPad');
}
async function grHandleRedirect() {
  const hash = sessionStorage.getItem('qbAuthResp'), pending = sessionStorage.getItem('qbAuthPending');
  sessionStorage.removeItem('qbAuthResp'); sessionStorage.removeItem('qbAuthPending');
  if (!grCfg().clientId || (!hash && !pending)) return null;
  try {
    const pca = await grPca();
    const r = await pca.handleRedirectPromise(hash ? { hash, navigateToLoginRequestUrl: false } : { navigateToLoginRequestUrl: false });
    if (r && r.account) {
      pca.setActiveAccount(r.account); grSetAcct(r.account); GR.err = ''; QSync.err = '';
      toast('✓ Signed in as ' + (r.account.username || r.account.name), 2600);
      qbOpen(true, { quiet: true }); setTimeout(() => syncNow({ manual: true, via: 'signin' }), 50);
    }
    return r;
  } catch (e) {
    GR.err = grErrMsg(e); QSync.err = isConsent(e) ? 'IT approval needed' : 'Sign-in failed'; qbSyncStatus();
    toast('⚠︎ ' + GR.err, 8000); setTimeout(() => grSettings(), 50); return null;
  }
}

/* ---------- tokens ---------- */
async function grToken({ force = false } = {}) {
  const pca = await grPca(); if (!pca) throw grError('Set up work email in Settings first', { needsSignIn: true, short: 'Not set up' });
  const hint = grAcct(), all = pca.getAllAccounts();
  const acct = pca.getActiveAccount() || (hint && all.find(a => a.homeAccountId === hint.homeAccountId)) || all[0];
  if (!acct) throw grError('Sign in to Microsoft again to keep checking work email', { needsSignIn: true, short: 'Sign in again' });
  try {
    const r = await pca.acquireTokenSilent({ scopes: GR_SCOPES, account: acct, forceRefresh: force, cacheLookupPolicy: force ? msal.CacheLookupPolicy.RefreshToken : msal.CacheLookupPolicy.AccessTokenAndRefreshToken });
    if (r.account) grSetAcct(r.account);
    return r.accessToken;
  } catch (e) {
    if (isConsent(e)) throw grError(CONSENT_MSG, { short: 'IT approval needed', consent: true });
    if (/network|fetch/i.test(String(e && (e.errorCode || e.message)))) throw grError('Couldn’t reach Microsoft — check your connection', { short: 'Offline' });
    throw grError('Your Microsoft sign-in expired — sign in again to keep checking work email', { needsSignIn: true, short: 'Sign in again' });
  }
}

/* ---------- Graph calls: 401 → one forced refresh; 429/503/504 → honour Retry-After ---------- */
async function grGet(url, st = { tries: 0, refreshed: false }) {
  const tok = await grToken({ force: st.refreshed });
  let r;
  try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok, Prefer: 'outlook.body-content-type="text"', Accept: 'application/json' } }); }
  catch (e) { throw grError('Couldn’t reach Microsoft 365 — check your connection', { short: 'Offline' }); }
  if (r.status === 401 && !st.refreshed) return grGet(url, { ...st, refreshed: true });
  if ([429, 503, 504].includes(r.status) && st.tries < 4) {
    const ra = parseFloat(r.headers.get('Retry-After')), wait = Math.min(30, ra > 0 ? ra : 2 * 2 ** st.tries);
    QSync.err = ''; $('#qbSync').textContent = `Microsoft asked us to wait ${Math.ceil(wait)} s…`;
    await grSleep(wait * 1000); return grGet(url, { ...st, tries: st.tries + 1 });
  }
  if (!r.ok) {
    let j = {}; try { j = await r.json(); } catch (_) {}
    const code = j.error && j.error.code || '', msg = j.error && j.error.message || r.statusText;
    if (r.status === 401) throw grError('Your Microsoft sign-in expired — sign in again', { needsSignIn: true, short: 'Sign in again' });
    if (r.status === 403 || /ErrorAccessDenied|Authorization_RequestDenied/i.test(code)) throw grError(CONSENT_MSG, { short: 'IT approval needed', consent: true });
    if (/MailboxNotEnabledForRESTAPI|MailboxNotSupportedForRESTAPI|ResourceNotFound/i.test(code)) throw grError('This mailbox isn’t on Microsoft 365 (on-premises Exchange?) — drag or paste RFQ emails into the Quote Board instead.', { short: 'Mailbox not supported' });
    if ([429, 503, 504].includes(r.status)) throw grError('Microsoft 365 is busy — try again in a minute', { short: 'Busy — try later' });
    throw grError(`Microsoft 365 error ${r.status}${code ? ' (' + code + ')' : ''}: ${String(msg).slice(0, 140)}`, { short: 'Error ' + r.status });
  }
  return r.json();
}
const GR_SELECT = 'id,internetMessageId,subject,from,receivedDateTime,body,bodyPreview,webLink,conversationId,hasAttachments,isDraft';
function grSearchUrl(since) {
  const day = new Date(since).toISOString().slice(0, 10);
  const kql = `(RFQ OR \\"request for quote\\" OR \\"request for quotation\\" OR quotation OR \\"quote request\\" OR \\"pricing request\\") AND received>=${day}`;
  // $search can't be combined with $orderby (results come back by relevance/date) and only limited $filter, so the date lives in the KQL.
  return `${GRAPH_BASE}/me/messages?$search=${encodeURIComponent('"' + kql + '"')}&$select=${GR_SELECT}&$top=50`;
}
async function grFetchCandidates(since) {
  const c = grCfg(), me = (grAcct() || {}).username?.toLowerCase() || '', sinceMs = +new Date(since);
  let url = grSearchUrl(since), pages = 0; const seen = new Set(), out = [];
  while (url && pages < 20) {
    const j = await grGet(url); pages++;
    for (const m of j.value || []) {
      if (m.isDraft || seen.has(m.internetMessageId || m.id)) continue; seen.add(m.internetMessageId || m.id);
      if (m.receivedDateTime && +new Date(m.receivedDateTime) < sinceMs) continue;
      const text = (m.body && m.body.contentType === 'html' ? AssistEngine.htmlToText(m.body.content || '') : (m.body && m.body.content)) || m.bodyPreview || '';
      const from = m.from && m.from.emailAddress ? { name: m.from.emailAddress.name || '', address: (m.from.emailAddress.address || '').toLowerCase() } : { name: '', address: '' };
      out.push({ id: m.id, messageId: m.internetMessageId || '', conversationId: m.conversationId || '', subject: m.subject || '', from, date: m.receivedDateTime, text, webLink: m.webLink || '', hasAttachments: !!m.hasAttachments, attachments: [], fromSelf: !!me && from.address === me });
    }
    url = j['@odata.nextLink'] || null;
  }
  if (c.attachments) for (const m of out.filter(x => x.hasAttachments).slice(0, 15)) {
    try { const j = await grGet(`${GRAPH_BASE}/me/messages/${encodeURIComponent(m.id)}/attachments?$select=name,isInline`); m.attachments = (j.value || []).filter(a => !a.isInline).map(a => a.name).filter(Boolean).slice(0, 20); } catch (e) { if (e.needsSignIn || e.consent) throw e; }
  }
  return out;
}

/* ---------- Settings sheet ---------- */
function grSettings(opt = {}) {
  const c = grCfg(), a = grAcct(), w = modalWrap('qbGraphWrap');
  const sel = (k, opts, v) => `<select data-g="${k}">${opts.map(([val, l]) => `<option value="${val}"${String(v) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  w.innerHTML = `<div class="sheet qb-gsheet" role="dialog" aria-modal="true" aria-label="Work email (Microsoft 365 / Exchange)">
    <h3>📧 Work email (Microsoft 365 / Exchange)</h3>
    <p class="fine">Pulls RFQ and quote emails onto the Quote Board — read-only. Works even though you read this mail in Apple Mail: Pencil Notes reads the same mailbox straight from Microsoft 365.</p>
    <div class="qg-status ${a ? 'on' : ''}">${a ? `✓ Signed in as <b>${esc(a.username || a.name)}</b>${qbLastSync() ? ` · synced ${esc(agoText(qbLastSync()))}` : ''}` : 'Not signed in'}</div>
    ${GR.err ? `<p class="qg-err" role="alert">⚠︎ ${esc(GR.err)}</p>` : ''}
    <label>Application (client) ID<input data-g="clientId" value="${esc(c.clientId)}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label>Directory (tenant) ID <small>optional</small><input data-g="tenantId" value="${esc(c.tenantId)}" placeholder="Leave blank unless sign-in asks for it" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <div class="qe-grid"><label>Accounts${sel('authority', [['organizations', 'Work or school (recommended)'], ['common', 'Work, school or personal']], c.authority)}</label>
    <label>First check looks back${sel('backfill', [[30, '30 days'], [90, '90 days'], [365, '1 year']], c.backfill)}</label></div>
    <label class="qg-chk"><input type="checkbox" data-g="attachments" ${c.attachments ? 'checked' : ''}> List attachment names on cards</label>
    <p class="fine">Redirect URI for your Entra app (Single-page application): <code>${esc(grRedirect())}</code><br>One-time setup: register an app at entra.microsoft.com → App registrations, add that redirect URI under “Single-page application”, and grant the delegated permissions User.Read and Mail.Read. If your company requires it, IT approves the app once.</p>
    <p class="fine">On-premises Exchange (if signing in at outlook.office.com doesn’t work)? Microsoft 365 sign-in won’t work for that mailbox — drag or paste RFQ emails onto the Quote Board instead.</p>
    <div class="sheet-actions">${a ? '<button class="btn danger" data-ga="out">Sign out</button>' : ''}<div class="spacer"></div><button class="btn" data-ga="x">Close</button>
    ${a ? '<button class="btn" data-ga="sync">⟳ Check now</button>' : ''}<button class="btn primary" data-ga="in">${a ? 'Sign in again' : 'Sign in with Microsoft'}</button></div></div>`;
  w.hidden = false;
  const read = () => { const v = {}; w.querySelectorAll('[data-g]').forEach(i => v[i.dataset.g] = i.type === 'checkbox' ? i.checked : i.value); return v; };
  const save = () => { const before = grCfg(), v = read(); grSaveCfg(v); const now = grCfg(); if (before.clientId !== now.clientId || before.tenantId !== now.tenantId || before.authority !== now.authority) { GR.pca = null; GR.key = ''; if (before.clientId !== now.clientId) { grSetAcct(null); localStorage.removeItem('qbLastSync'); } } qbSyncStatus(); };
  w.onclick = e => {
    if (e.target === w) { save(); w.hidden = true; return; }
    const b = e.target.closest('[data-ga]'); if (!b) return; const act = b.dataset.ga;
    if (act !== 'out') save(); w.hidden = true;
    if (act === 'in') grSignIn();
    if (act === 'out') grSignOut();
    if (act === 'sync') { qbOpen(true, { quiet: true }); syncNow({ manual: true }); }
  };
  if (opt.signIn) setTimeout(() => w.querySelector(grCfg().clientId ? '[data-ga="in"]' : '[data-g="clientId"]')?.focus(), 50);
}

const GraphProvider = {
  id: 'graph', label: 'Work email (Microsoft 365 / Exchange)',
  status: () => { const c = grCfg(), a = grAcct(); return { configured: !!c.clientId, signedIn: !!(c.clientId && a), account: a ? a.username || a.name : '' }; },
  signIn: grSignIn, signOut: grSignOut, backfillDays: () => grCfg().backfill, fetchCandidates: grFetchCandidates, settings: grSettings,
};
registerQuoteProvider(GraphProvider);
window.GraphProvider = Object.assign(GraphProvider, { GR, grCfg, grSaveCfg, grSearchUrl, grErrMsg, grToken, grGet, grHandleRedirect, grRedirect, CONSENT_MSG });
whenAppReady(grHandleRedirect);
