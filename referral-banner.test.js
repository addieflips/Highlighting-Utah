/*
 * The referral waiver banner — Highlighting Utah
 *
 * Addie, 2026-09-12: "we need to make sure referals are getting there 30 dollar
 * installation fee waived since that is what we promised them." And 2026-09-09, on the
 * wording: "lets just do your 30 dollar installation fee is waived. Nothing more to add
 * under that."
 *
 * The waiver itself has worked since [[REF-25]] and Suite 312 guards it. What was missing
 * for six days is the BANNER on the page the friend lands on — deliberately, because
 * nothing in a browser can tell a real token from one typed into the address bar. Q-032
 * laid out three ways and her answer picked the middle one: ask the server, draw the line
 * only on yes. This file is that change's gate.
 *
 * Every way it can go wrong is a promise broken to somebody who is not a customer yet:
 *
 *   - the banner is drawn on the strength of the token alone, so `/r/anything` typed into
 *     the address bar is promised $30 the office then charges;
 *   - the server answers for a RETIRED token, so last season's link gets a banner while
 *     [[REF-25]] — her own ruling — still charges it. The banner and the money would then
 *     disagree, which is the exact failure the banner was held back to avoid;
 *   - the endpoint names the referrer, turning a public callable into a way to read the
 *     customer book one token at a time;
 *   - a late reply unhides the line on whatever page the visitor moved to;
 *   - generalising checkRateLimit quietly changes what SIGN-IN does;
 *   - a refusal reaches the visitor as an error, on the one page whose job is turning a
 *     stranger into a customer.
 *
 * ⚠ THE BEHAVIOURAL CHECKS ARE THE ONES THAT EARN THE FILE. The two claims that matter are
 * about a line ON SCREEN and about a counter that guards SIGN-IN, and this repo has been
 * caught three times by a check that matched the source of a message that could never
 * reach the page. So refreshReferralBanner and checkRateLimit are both LIFTED AND RUN.
 *
 * R-018 says not to add checks to run-all.js, so this is one file, one job.
 *
 * Run:  node referral-banner.test.js      (or: npm run test:referral-banner)
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : path.join(__dirname, '..');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fns = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Comments are stripped before any search, or this file fails on correct code: the block
   explaining the callable names `referralTokensPast` as the thing it deliberately does NOT
   query. Suites 58, 274, 275 and 300 each learned this separately. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const idxCode = stripComments(idx);
const fnsCode = stripComments(fns);

/* Brace-walk, never a fixed window — CLAUDE.md §7 bans those and run-all enforces it. */
function lift(src, head) {
  const at = src.indexOf(head);
  if (at === -1) return '';
  let i = src.indexOf('{', at), d = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (!d) return src.slice(at, i + 1); }
  }
  return '';
}

/* ---- 1. the endpoint exists and answers one boolean ---------------------- */

/* ⚠ THE BRACE WALK HAS TO START AT THE ARROW, NOT AT THE HEAD. `onCall({ cors: true },
   async (request) => {` opens an OPTIONS object first, so a walk from the declaration
   returns `{ cors: true }` and every check below passes or fails on the wrong text — which
   is what it did on the first run of this file. */
function liftCallable(name) {
  const at = fnsCode.indexOf('exports.' + name + ' = onCall(');
  if (at === -1) return '';
  const arrow = fnsCode.indexOf('=> {', at);
  if (arrow === -1) return '';
  let i = arrow + 3, d = 0;
  for (; i < fnsCode.length; i++) {
    if (fnsCode[i] === '{') d++;
    else if (fnsCode[i] === '}') { d--; if (!d) return fnsCode.slice(at, i + 1); }
  }
  return '';
}
const callable = liftCallable('referralWaiverCheck');
check('the referral check callable exists', callable.length > 0);

/* ⛔ THE SECURITY CLAIM. Everything this can return is a `waived` boolean. A name, an id,
   a phone or a house would make a public endpoint into a reader of the customer book. */
const returns = callable.match(/return\s*\{[^}]*\}/g) || [];
check('it only ever returns a waived boolean', returns.length > 0 &&
  returns.every(r => /^return\s*\{\s*waived:/.test(r) && !/name|phone|email|id\b|address|item/i.test(r)),
  returns.join(' | '));

/* ⛔ AND THE PARITY CLAIM, which is why the banner can be trusted at all.
   `quoteChargesSetupFee` waives on `holder.current` — the token IS the one on that record
   now. A rotated token lives in referralTokensPast and must NOT be matched here, or last
   season's link is promised a waiver and then charged ([[REF-25]]). */
check('it asks for the CURRENT referral token', /referralToken['"]\s*,\s*['"]==/.test(callable),
  'expected a where() on referralToken');
check('it never matches a retired token', callable.indexOf('referralTokensPast') === -1);

/* ⚠ NEVER THROWS AT THE PAGE. Q-032 settled that the two errors are not symmetric. */
check('every failure answers waived:false rather than throwing',
  callable.indexOf('catch') !== -1 && !/throw new HttpsError/.test(callable),
  'the callable must not throw at a public page');

/* ⚠ KEYED ON THE CALLER, NOT THE TOKEN. Keyed on the token, an attacker tries a different
   one and every guess gets a fresh counter — a limiter that limits nothing. */
check('the rate limit is keyed on the caller, not the token',
  /checkRateLimit\(\s*'refcheck_'\s*\+/.test(callable) &&
  !/checkRateLimit\([^)]*token/.test(callable), callable.match(/checkRateLimit\([^;]*/) || '');

/* ---- 2. generalising checkRateLimit left SIGN-IN alone ------------------- */

const limiter = lift(fnsCode, 'async function checkRateLimit(');
check('checkRateLimit was found to run', limiter.length > 0);

/* Runs the real limiter against a fake Firestore. The claim is not "it has defaults" —
   that is readable — but that the defaults are the numbers sign-in had before this change,
   which is the thing a careless edit would move. */
function fakeDb(state) {
  return {
    collection: () => ({ doc: () => ({ id: 'k' }) }),
    runTransaction: async function (fn) {
      return fn({
        get: async () => ({ exists: state.data !== null, data: () => state.data }),
        set: (_r, v) => { state.data = v; },
        update: (_r, v) => { state.data = Object.assign({}, state.data, v); }
      });
    }
  };
}
function makeLimiter(state) {
  class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  return Function('db', 'HttpsError', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS', `
    ${limiter}
    return checkRateLimit;
  `)(fakeDb(state), FakeHttpsError, 5, 15 * 60 * 1000);
}

(async function runLimiter() {
  /* Sign-in, untouched: the sixth attempt inside the window is refused. */
  const s = { data: null };
  const fn = makeLimiter(s);
  let refusedAt = 0;
  for (let i = 1; i <= 7; i++) {
    try { await fn('someone@example.com'); }
    catch (e) { refusedAt = i; break; }
  }
  check('sign-in is still refused on the 6th attempt in the window', refusedAt === 6,
    'refused at ' + refusedAt);

  /* ⚠ AND THE RED-CHECK FOR IT: with a looser max passed in, the same six go through. If
     this ever fails the check above has stopped testing the default and is testing the
     opts. */
  const s2 = { data: null };
  const fn2 = makeLimiter(s2);
  let refused2 = 0;
  for (let i = 1; i <= 7; i++) {
    try { await fn2('someone@example.com', { max: 30 }); }
    catch (e) { refused2 = i; break; }
  }
  check('red-check: a looser max really does let those same attempts through', refused2 === 0,
    'refused at ' + refused2);

  const s3 = { data: null };
  const fn3 = makeLimiter(s3);
  let msg = '';
  try { for (let i = 0; i < 8; i++) await fn3('x', { max: 2, message: 'Too many checks.' }); }
  catch (e) { msg = e.message; }
  check('a caller can give the refusal its own words', msg === 'Too many checks.', msg);
})().then(runBanner).catch(function (e) {
  check('the limiter ran without throwing', false, String((e && e.message) || e));
  runBanner();
});

/* ---- 3. RUN the banner against a document -------------------------------- */

function runBanner() {
  const banner = lift(idxCode, 'function refreshReferralBanner(');
  check('the banner function was found to run', banner.length > 0);

  /* ⛔ THE MARKUP CARRIES NO FIGURE. S312 fails any page that types the set-up fee, and its
     own note argues an empty slot is also what the page should show if the script dies. */
  const markup = (idx.match(/<div id="referralWaiverNote"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
  check('the banner markup ships empty, with no fee typed into it',
    typeof markup === 'string' && markup.trim() === '', JSON.stringify(markup));

  function harness(opts) {
    const o = opts || {};
    const el = { hidden: true, textContent: '' };
    const calls = [];
    let resolveCall;
    const pending = new Promise(function (r) { resolveCall = r; });

    const fn = Function('document', 'callPortalFn', 'readReferralToken', 'NEW_MEMBER_FEE', 'console', `
      ${banner}
      return refreshReferralBanner;
    `)(
      { getElementById: function (id) { return id === 'referralWaiverNote' ? el : null; } },
      function (name, payload) { calls.push({ name: name, payload: payload }); return pending; },
      function () { return o.token === undefined ? 'abc12345' : o.token; },
      30,
      { error: function () {} }
    );
    return { fn: fn, el: el, calls: calls, answer: resolveCall };
  }

  /* A yes draws the line, with the fee read rather than typed. */
  const a = harness();
  a.fn('/quote');
  a.answer({ waived: true });
  return Promise.resolve().then(function () {
    check('a live link is asked about', a.calls.length === 1 &&
      a.calls[0].name === 'referralWaiverCheck' && a.calls[0].payload.token === 'abc12345',
      JSON.stringify(a.calls));
  }).then(function () {
    check('a yes shows the line, with the fee read from NEW_MEMBER_FEE',
      a.el.hidden === false && a.el.textContent === 'Your $30 installation fee is waived.',
      'hidden=' + a.el.hidden + ' text=' + JSON.stringify(a.el.textContent));

    /* ⛔ THE CHECK THIS WHOLE CHANGE EXISTS FOR: a made-up or retired token draws nothing. */
    const b = harness();
    b.fn('/quote');
    b.answer({ waived: false });
    return Promise.resolve().then(function () {
      check('a token nobody holds draws no banner and makes no promise',
        b.el.hidden === true && b.el.textContent === '');

      /* ⚠ A VISITOR WITH NO REFERRAL AT ALL IS NEVER ASKED ABOUT. */
      const c = harness({ token: '' });
      c.fn('/quote');
      check('somebody who came directly is not asked about', c.calls.length === 0);

      /* ⚠ ANOTHER ROUTE HIDES IT AND ASKS NOTHING. The site is one document with seven
         addresses, so a line left showing follows the visitor to the gallery. */
      const d = harness();
      d.el.hidden = false;
      d.fn('/gallery');
      check('leaving the quote page hides the line again',
        d.el.hidden === true && d.calls.length === 0);

      /* ⛔ AND THE LATE ANSWER IS DROPPED. Staged by hand, because no click path can
         reliably land a reply after a navigation — the unreachable-state lesson
         [[MEM-01]] records. */
      const e = harness();
      e.fn('/quote');
      e.fn('/gallery');
      e.answer({ waived: true });
      return Promise.resolve().then(function () {
        check('a reply that lands after the visitor has moved on draws nothing',
          e.el.hidden === true, 'hidden=' + e.el.hidden);
        done();
      });
    });
  });
}

function done() {
  console.log('');
  console.log('=== The referral waiver banner ===');
  console.log('');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  if (failures.length) console.log('');
  console.log('  NOTE  This adds a PUBLIC endpoint. It answers one boolean, names nobody,');
  console.log('        and matches only a token somebody holds right now — but it is a new');
  console.log('        door on a page anybody can open, and it should not be merged');
  console.log('        without Addie reading that trade.');
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
