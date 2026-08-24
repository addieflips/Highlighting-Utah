/*
 * Member Portal repro — runs the REAL functions out of index.html against the
 * REAL index.html DOM, with only the Cloud Function call faked.
 *
 * Nothing here is a rewrite of the page's logic: every function under test is
 * sliced verbatim out of index.html by brace matching, the same way run-all.js
 * does it. If the page changes, this picks up the change.
 *
 * ⚠ WHY IT LIVES AT THE ROOT AND NOT IN test/ (moved 2026-08-24). It spent some
 * time as `test/portal.spec.js`, pasted over the ten Playwright specs that file
 * held — its own header still called it portal-repro.js, which is the tell. The
 * cost was invisible because everything stayed GREEN: Playwright found no test()
 * calls in it and quietly reported 3 specs instead of 13, and the selector
 * contract, which scans the specs for the ids they drive, dropped from 18 checks
 * to 1. Two required gates passing because there was nothing left to check.
 *
 * ⚠ SO THE TWO ARE NOT ALTERNATIVES AND BOTH ARE KEPT. The specs drive a real
 * browser through the real page and are what the required check runs; this runs
 * the same page's functions head-on in jsdom, which is faster and says exactly
 * which function misbehaved. Losing either one loses something the other cannot
 * give. It sits at the repo root with the other standalone gates
 * (money-parity, options-audit, season-state) so no spec glob can ever pick it
 * up again.
 *
 * ⚠ AND IT EXITS NON-ZERO NOW. It counted failures and printed them and then
 * returned 0 regardless, so wiring it into `npm test` in that state would have
 * added a gate that could never fail — the same silence this file was rescued
 * from. A gate that cannot go red is decoration.
 *
 * Run:  node portal-repro.test.js      (or: npm run test:portal)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/* ⚠ Relative to THIS file, not the working directory — every other gate here
   resolves its own root the same way, so `npm test` works from anywhere. */
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/* ---- slice a function out of the page, verbatim ---- */
function grab(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at === -1) throw new Error('not found in index.html: ' + name);
  const start = at + 1;
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const REAL = [
  'navigate',
  'loadPortalByToken',
  'tryShowQuoteReview',
  'hideLoginPrompt',
  'hidePortalLoading',
  'showPortalLoading',
  'showLookupFormAgain',
  'openPortalFromQuote',
  'showLoginPrompt',
  'portalSessionActive',
  'resetPaymentPage',
];

const dom = new JSDOM(src, { url: 'https://highlightingutah.com/#/payment?token=QUOTE_TOKEN', runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

/* ---- the only fakes: the server, and the leaves we are not testing ---- */
const calls = [];
let SERVER = {};
window.callPortalFn = function (fn, payload) {
  calls.push(fn);
  const answer = SERVER[fn];
  return Promise.resolve(typeof answer === 'function' ? answer(payload) : answer);
};
let portalRendered = false;
window.renderCustomerInvoicePage = function () { portalRendered = true; };
window.performSignInLookup = function () { portalRendered = true; };
window.savePortalLogin = function () {};
window.clearPortalLogin = function () {};
window.clearPortalCreds = function () {};
window.showLookupError = function () {};
window.setQuoteConfirmSub = function () {};
window.handleRsvpLink = function () {};
window.handleQuoteLink = function () {};
window.handleBackNextYear = function () {};
window.fmt = function (n) { return '$' + n; };
window.portalKeyClean = function (s) { return String(s || ''); };
window.portalHouses = [];
window.portalLoadingTimer = null;
window.currentQuoteId = null;
window.currentQuoteData = null;
window.quoteDetailToken = null;
window.quoteDetailQuoteId = null;
window.quoteLinkPortalToken = null;
window.routes = ['/', '/how-it-works', '/gallery', '/reviews', '/areas', '/faq', '/contact', '/quote', '/quote-details', '/payment'];
window.pageIds = {
  '/': 'page-home', '/how-it-works': 'page-how', '/gallery': 'page-gallery', '/reviews': 'page-reviews',
  '/areas': 'page-areas', '/faq': 'page-faq', '/contact': 'page-contact', '/quote': 'page-quote',
  '/quote-details': 'page-quote-details', '/payment': 'page-payment'
};

/* ---- load the real code into that window ---- */
window.eval(REAL.map(grab).join('\n\n'));

/* the real hashchange listener, sliced verbatim, so the nav-button test drives
   the same code the browser does */
const listenerStart = src.indexOf("window.addEventListener('hashchange'");
const listenerEnd = src.indexOf('});\nnavigate();', listenerStart) + 3;
window.eval(src.slice(listenerStart, listenerEnd));

/* ---- observation helpers (inline display only — that is what the code sets) ---- */
const inlineHidden = id => {
  const el = document.getElementById(id);
  return !el ? 'MISSING' : (el.style.display === 'none' ? 'hidden' : (el.style.display || 'visible'));
};
const tick = () => new Promise(r => setTimeout(r, 0));

const APPROVED_QUOTE = {
  quotes: [{
    id: 'q1',
    data: {
      phone: '8015550123', name: 'Jane Petersen', quotedPrice: 640,
      address: '123 Main St', lightColors: ['Warm White'],
      approvalStatus: 'approved', formCompleted: true
    }
  }]
};

let failures = 0;
function report(label, got, expected) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`   ${ok ? 'as expected' : 'DIFFERENT '}  ${label}: ${got}`);
}

(async function () {
  /* ================= SCENARIO 1 =================
     A quote-email token for a quote that is already approved.        */
  console.log('\nSCENARIO 1 — arrive at #/payment?token=<quote token>, quote already approved');
  SERVER = {
    portalLookup: { found: true, isQuote: true, record: { phone: '8015550123' } },
    publicQuoteLookup: APPROVED_QUOTE
  };
  window.loadPortalByToken('QUOTE_TOKEN');
  await tick(); await tick(); await tick();

  console.log('  server calls made:', calls.join(' -> '));
  console.log('  did the portal render?', portalRendered);
  report('sign-in form  (#lookupFormWrap)', inlineHidden('lookupFormWrap'), 'visible');
  report('page heading  (#paymentPageHero)', inlineHidden('paymentPageHero'), 'visible');
  report('spinner       (#portalLoading)', inlineHidden('portalLoading'), 'hidden');
  report('message       (#quoteResolvedMsg)', inlineHidden('quoteResolvedMsg'), 'block');
  console.log('  message text:', JSON.stringify(document.getElementById('quoteResolvedMsg').textContent));

  /* ================= SCENARIO 2 =================
     From that screen, click "Member Portal" in the header.           */
  console.log('\nSCENARIO 2 — now click the "Member Portal" button in the nav');
  const before = {
    form: inlineHidden('lookupFormWrap'),
    hero: inlineHidden('paymentPageHero'),
    msg: inlineHidden('quoteResolvedMsg')
  };
  window.location.hash = '/payment';       // exactly what the nav <a href> does
  await tick();                             // let the real hashchange listener run
  const after = {
    form: inlineHidden('lookupFormWrap'),
    hero: inlineHidden('paymentPageHero'),
    msg: inlineHidden('quoteResolvedMsg')
  };
  console.log('  before:', JSON.stringify(before));
  console.log('  after :', JSON.stringify(after));
  report('sign-in form now on screen?', after.form === 'hidden' ? 'no' : 'yes', 'yes');
  report('stale message cleared?', after.msg === 'none' || after.msg === 'hidden' ? 'yes' : 'no', 'yes');
  report('is #page-payment the active page?',
    document.getElementById('page-payment').classList.contains('active') ? 'yes' : 'no', 'yes');

  /* ================= SCENARIO 3 (control) =================
     A real portal token, same page, same code.                       */
  console.log('\nSCENARIO 3 (control) — same page, but a real portal token');
  portalRendered = false;
  SERVER = { portalLookup: { found: true, isQuote: false, invoiceKey: '8015550123', token: 'PORTAL_TOKEN', record: { phone: '8015550123' } } };
  window.loadPortalByToken('PORTAL_TOKEN');
  await tick(); await tick();
  report('portal rendered?', portalRendered ? 'yes' : 'no', 'yes');

  /* ================= SCENARIO 4 =================
     "Yes, I'd like to make a change" with no portal token and no saved login,
     on a page where the sign-in form has already been hidden.        */
  console.log('\nSCENARIO 4 — openPortalFromQuote() fallback, sign-in form already hidden');
  document.getElementById('lookupFormWrap').style.display = 'none';
  window.quoteLinkPortalToken = null;
  window.openPortalFromQuote('8015550123');
  report('sign-in form  (#lookupFormWrap)', inlineHidden('lookupFormWrap'), 'visible');
  console.log('  value it typed into the contact box:',
    JSON.stringify(document.getElementById('lookupPhone').value));

  /* ================= SCENARIO 5 =================
     Does navigate() clear quote-minimal the way it clears rsvp-minimal?  */
  console.log('\nSCENARIO 5 — leaving a minimal screen');
  document.body.classList.add('quote-minimal');
  document.body.classList.add('rsvp-minimal');
  window.location.hash = '/payment';
  window.navigate();
  report('rsvp-minimal still on body', document.body.classList.contains('rsvp-minimal') ? 'yes' : 'no', 'no');
  report('quote-minimal still on body', document.body.classList.contains('quote-minimal') ? 'yes' : 'no', 'no');

  /* ================= SCENARIO 6 =================
     A signed-in customer presses "Member Portal" in the header. The reset must
     NOT throw them back to the sign-in box. */
  console.log('\nSCENARIO 6 — signed-in customer clicks "Member Portal" in the nav');
  document.getElementById('invoiceCard').classList.add('show');
  document.getElementById('lookupFormWrap').style.display = 'none';
  window.location.hash = '/quote';
  await tick();
  window.location.hash = '/payment';
  await tick();
  report('portal still open (#invoiceCard.show)',
    document.getElementById('invoiceCard').classList.contains('show') ? 'yes' : 'no', 'yes');
  report('thrown back to sign-in?', inlineHidden('lookupFormWrap') === 'hidden' ? 'no' : 'yes', 'no');

  console.log('\n' + (failures ? failures + ' result(s) differed from a working portal' : 'everything behaved'));
  if (failures) {
    console.log('\nThe portal behaved differently from a working one. The scenario above');
    console.log('names which step, and the function it ran came straight out of');
    console.log('index.html — so the page is what changed, not this harness.\n');
  }
  process.exit(failures ? 1 : 0);
})();
