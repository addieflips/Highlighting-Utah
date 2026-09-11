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
/* index.html IS CRLF, so a literal newline in this anchor matched NOTHING.
   indexOf returned -1, listenerEnd came out as 2, and the slice was the EMPTY
   STRING - so the real hashchange listener was never registered and SCENARIO 2
   failed for want of code that was never loaded. The harness then blamed the
   page - "the page is what changed, not this harness" - which sends whoever
   reads it into index.html after a bug that is not there.
   AND IT FAILS SILENTLY IN THE OTHER SENSE TOO: this gate prints no line
   containing the word FAIL, so grepping for FAIL reads clean while npm test
   exits 1. Both traps are in CLAUDE.md; this is the two of them together. */
const NL = String.fromCharCode(10), CR = String.fromCharCode(13);
const tailCRLF = '});' + CR + NL + 'navigate();';
const tailLF   = '});' + NL + 'navigate();';
let tailAt = src.indexOf(tailCRLF, listenerStart);
if(tailAt === -1) tailAt = src.indexOf(tailLF, listenerStart);
if(tailAt === -1) throw new Error('portal-repro: cannot find the end of the hashchange listener in index.html');
const listenerEnd = tailAt + 3;
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

  /* ================= SCENARIO 7 =================
     The changes form, saved with neither outlet radio ticked.

     ⚠ THIS IS A REAL CUSTOMER'S CRASH, NOT AN INVENTED ONE. From the Errors folder,
     2026-09-09: "null is not an object (evaluating 'document.querySelector('input
     [name="changes_outlet_timer"]:checked').value')" — an iPhone, on a page opened from
     an RSVP link. Neither radio carries `checked` in the markup, so a customer who never
     touched them took the whole save down before a single field was read.

     ⚠ AND THE CRASH WAS THE SMALL HALF. That page carried `&rsvp=yes`, so their answer
     went down with it; only people who have answered are scheduled, so nobody is sent to
     their house. The apology tells them to ring us and to them it looks like they already
     replied.

     ⚠ IT RUNS THE REAL LINES against the real page's DOM, sliced out of index.html — a
     check that asserted the SHAPE of the fix would pass on any rewrite that still
     crashed, and this whole file exists because a passing gate can be checking nothing. */
  console.log('\nSCENARIO 7 — the changes form saved with neither outlet radio ticked');
  const radioAt = src.indexOf('var outletTimerEl = document.querySelector(');
  const radioEnd = src.indexOf('var newSpecificOutletNotes', radioAt);
  report('the two radio reads were found in index.html',
    (radioAt !== -1 && radioEnd > radioAt) ? 'yes' : 'no', 'yes');
  const radioSrc = (radioAt === -1 || radioEnd <= radioAt) ? '' : src.slice(radioAt, radioEnd);
  const runRadios = function (record) {
    return new Function('document', 'currentJobAddressData',
      radioSrc + '\nreturn {timer: newOutletTimer, outlet: newSpecificOutlet};')(document, record);
  };
  /* Nothing ticked — exactly the state the crash arrived in. */
  document.querySelectorAll('input[name="changes_outlet_timer"], input[name="changes_specific_outlet"]')
    .forEach(function (r) { r.checked = false; });

  let blank = null, threw = '';
  try { blank = runRadios({}); } catch (e) { threw = String(e && e.message || e); }
  report('nothing ticked, and the save still gets past the radios', threw ? 'threw: ' + threw : 'no throw', 'no throw');
  report('an unanswered timer reads as No', blank ? String(blank.timer) : '(crashed)', 'No');
  report('an unanswered specific-outlet reads as No', blank ? String(blank.outlet) : '(crashed)', 'No');

  /* ⚠ 'No' IS NOT A DEFAULT PLUCKED OUT OF THE AIR — it is what the change comparison
     below these lines already reads a missing timer as. Any other fallback makes an
     untouched radio look CHANGED, and `outletTimer` is one of the three
     WAREHOUSE_BUILD_FIELDS, so that queues a bundle rebuild for a house nobody touched. */
  const cmp = src.indexOf("(currentJobAddressData.outletTimer || 'No') !== newOutletTimer");
  report('and that matches what the change test treats as missing', cmp === -1 ? 'no' : 'yes', 'yes');

  /* A value already on file is preserved, never overwritten with the fallback. */
  let kept = null;
  try { kept = runRadios({ outletTimer: 'Yes', specificOutlet: 'Yes' }); } catch (e) { kept = null; }
  report('a timer already on file survives an untouched form', kept ? String(kept.timer) : '(crashed)', 'Yes');
  report('and so does a specific outlet', kept ? String(kept.outlet) : '(crashed)', 'Yes');

  /* And a real answer still wins over both. */
  const yesRadio = document.querySelector('input[name="changes_outlet_timer"][value="Yes"]');
  if (yesRadio) yesRadio.checked = true;
  let ticked = null;
  try { ticked = runRadios({ outletTimer: 'No' }); } catch (e) { ticked = null; }
  report('a ticked radio beats both the record and the fallback',
    ticked ? String(ticked.timer) : '(crashed)', 'Yes');
  if (yesRadio) yesRadio.checked = false;

  /* The regression guard, across every page: reading `.value` straight off a
     `:checked` query is the whole family this bug belongs to. */
  /* ⚠ COMMENTS OUT FIRST, AND THIS CHECK EARNED THE RULE ON ITS OWN FIRST RUN. The
     comment added to index.html to EXPLAIN this fix quotes the customer's error message
     verbatim — which contains the very pattern being banned — so a correct file failed.
     Suites 58, 274, 275 and 300 each learned this separately; §7 has the general form.
     Match the code, never the prose describing the code. */
  const noComments = function (s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  };
  const unguarded = ['index.html', 'admin.html', 'employee.html'].filter(function (f) {
    return /:checked'\)\.value|:checked"\)\.value/
      .test(noComments(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  });
  report('no page reads .value straight off a :checked query',
    unguarded.length ? unguarded.join(', ') : 'none', 'none');

  /* ================= SCENARIO: a call that never got an answer =================
     Every one of the twelve urgent Member Errors raised from RSVP email links on
     8-10 September reported `deadline-exceeded` or `internal` — the two codes the
     callable CLIENT raises when the request never completed, rather than the server
     refusing anything. callPortalFn made exactly one attempt, so each of those was a
     customer's answer lost to one slow cold start.

     ⚠ THE REAL FUNCTION, SLICED VERBATIM, like everything else in this file — and
     with setTimeout stubbed out, so the gate proves the retry without sitting through
     the backoff it schedules. */
  console.log('\nSCENARIO 8 — a portal call that never gets an answer');
  const retryStart = src.indexOf('var PORTAL_RETRY_CODES');
  const cpfAt = src.indexOf('async function callPortalFn(', retryStart);
  let retrySrc = '';
  if (retryStart !== -1 && cpfAt !== -1) {
    let depth = 0, i = src.indexOf('{', cpfAt);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) break; }
    }
    retrySrc = src.slice(retryStart, i + 1);
  }
  report('callPortalFn and its retry rule are in index.html',
    retrySrc ? 'found' : 'MISSING', 'found');

  if (retrySrc) {
    let attempts = 0, mode = '';
    const fakeCallable = function () {
      return function () {
        attempts++;
        if (mode === 'transient-then-ok' && attempts < 3) throw errWith('functions/deadline-exceeded');
        if (mode === 'always-transient') throw errWith('functions/internal');
        if (mode === 'decided') throw errWith('functions/not-found');
        return Promise.resolve({ data: { ok: true } });
      };
    };
    function errWith(code) { const e = new Error(code.replace('functions/', '')); e.code = code; return e; }
    /* setTimeout fires straight away: the backoff is real in the page and pointless here. */
    const built = new Function('httpsCallable', 'fbFunctions', 'console', 'setTimeout',
      retrySrc + '; return callPortalFn;')(fakeCallable, {}, { warn: function () {} },
      function (f) { f(); });

    mode = 'transient-then-ok'; attempts = 0;
    let got = null;
    try { got = await built('portalRsvp', {}); } catch (e) { got = null; }
    report('a call that times out twice still gets the answer through',
      got && got.ok ? 'answered on attempt ' + attempts : 'gave up', 'answered on attempt 3');

    mode = 'decided'; attempts = 0;
    try { await built('portalRsvp', {}); } catch (e) { /* expected */ }
    report('a server that has DECIDED is not asked twice',
      'attempts: ' + attempts, 'attempts: 1');

    mode = 'always-transient'; attempts = 0;
    let threw = '';
    try { await built('portalRsvp', {}); } catch (e) { threw = String(e && e.code); }
    report('and when every attempt fails the original error still reaches the apology',
      threw + ' after ' + attempts, 'functions/internal after 3');
  }

  console.log('\n' + (failures ? failures + ' result(s) differed from a working portal' : 'everything behaved'));
  if (failures) {
    console.log('\nThe portal behaved differently from a working one. The scenario above');
    console.log('names which step, and the function it ran came straight out of');
    console.log('index.html — so the page is what changed, not this harness.\n');
  }
  process.exit(failures ? 1 : 0);
})();
