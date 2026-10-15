/* THE SERVER IS NOT ANSWERING, SAID ON SCREEN (added 2026-10-12).
 *
 *   node server-down.test.js        (npm run test:serverdown)
 *
 * Its own file per R-018. Billing on the Firebase project lapsed on the evening of
 * 8 October 2026 and Google refused every Cloud Function call for four days. The admin
 * page looked healthy throughout, because it talks to Firestore directly and Firestore
 * stayed up. Addie: "build the server is down banner".
 *
 * WHAT THIS HOLDS
 *   1. The decision is RUN, not matched: two no-answers in a row raise the banner, one
 *      does not, any reply at all clears it.
 *   2. A refusal from our own code is the server being UP. Only the codes the callable
 *      client raises when nothing came back count against it.
 *   3. The whole path is run against a fake callable and a fake page: the bar shows, one
 *      System notice is left per outage, and nothing polls a server that is down.
 *   4. Wiring, structural and labelled so: without it every check above passes while
 *      nothing in the real page ever calls pingServer.
 *
 * WHAT IT CANNOT HOLD
 *   That the bar is readable on screen. jsdom does no layout and this file uses a fake
 *   element, so position and overlap are not proved here.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const fns = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

/* Slices between two real markers. Fixed-length windows are banned in this repo. */
function between(src, a, b) {
  const i = src.indexOf(a);
  if (i === -1) return '';
  const j = src.indexOf(b, i);
  return j === -1 ? '' : src.slice(i, j);
}
/* Comments out, so a check cannot be satisfied by the paragraph explaining the code. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const BLOCK = between(admin, 'const SERVER_DOWN_AFTER = 2;', 'function runHealthCheckAuto(){');
const CODE = stripComments(BLOCK);

check('the server-health block was found',
  BLOCK.length > 1500 && /function serverHealthStep\(/.test(BLOCK) && /async function pingServer\(/.test(BLOCK),
  'the anchors moved, so everything below would run against nothing');

/* A fresh sandbox per scenario. Everything the block closes over arrives as a parameter,
   which is the same binding the real page uses. */
function sandbox(opts) {
  opts = opts || {};
  const calls = { pings: 0, writes: [], timers: [], listeners: 0, errors: [] };
  const el = () => ({ style: { display: 'none' }, textContent: '', addEventListener() { calls.listeners++; } });
  const els = { serverDownBanner: el(), serverDownText: el(), serverDownRetry: el() };
  const script = opts.script || [];
  let turn = 0;
  const names = ['httpsCallable', 'fbFunctions', 'HU_SIGNED_OUT', 'whileSignedIn', 'document', 'navigator',
    'allMessages', 'toJsDate', 'addDoc', 'collection', 'db', 'serverTimestamp', 'setTimeout', 'console'];
  const body = BLOCK + '\nreturn { pingServer: pingServer, serverHealthStep: serverHealthStep,' +
    ' serverPingOutcome: serverPingOutcome, serverDownBannerText: serverDownBannerText,' +
    ' state: function(){ return serverHealth; }, SERVER_RECHECK_MS: SERVER_RECHECK_MS,' +
    ' SERVER_DOWN_AFTER: SERVER_DOWN_AFTER, SERVER_DOWN_TOPIC: SERVER_DOWN_TOPIC,' +
    ' SERVER_NO_ANSWER_CODES: SERVER_NO_ANSWER_CODES };';
  const api = new Function(...names, body)(
    function (f, name, o) {
      calls.callable = name; calls.callableOpts = o;
      return function () {
        calls.pings++;
        const step = script[Math.min(turn++, script.length - 1)];
        return step ? Promise.reject(step) : Promise.resolve({ data: {} });
      };
    },
    {}, !!opts.signedOut, function (fn) { return fn; },
    { getElementById: function (id) { return els[id] || null; } },
    { onLine: opts.offline ? false : true },
    opts.messages || [],
    function (v) { return v instanceof Date ? v : (v ? new Date(v) : null); },
    function (ref, data) {
      if (opts.writeThrows) return Promise.reject(new Error('Missing or insufficient permissions.'));
      calls.writes.push(data); return Promise.resolve({ id: 'x' });
    },
    function () { return {}; }, {}, function () { return 'ts'; },
    function (fn, ms) { calls.timers.push({ fn: fn, ms: ms }); return calls.timers.length; },
    { error: function () { calls.errors.push([].slice.call(arguments).join(' ')); }, log() {}, warn() {} }
  );
  return { api: api, calls: calls, els: els };
}
const E = code => ({ code: code, message: code });

/* ---------------------------------------------------------------------------
 * 1. What counts as no answer.
 * ------------------------------------------------------------------------- */
const base = sandbox();
const A = base.api;

['internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted'].forEach(function (c) {
  check('"' + c + '" is the server not answering',
    A.serverPingOutcome(E(c)) === 'noanswer' && A.serverPingOutcome(E('functions/' + c)) === 'noanswer',
    'the callable client spells it with and without the functions/ prefix');
});
['permission-denied', 'not-found', 'unauthenticated', 'invalid-argument', 'failed-precondition'].forEach(function (c) {
  check('"' + c + '" is the server ANSWERING',
    A.serverPingOutcome(E(c)) === 'ok',
    'a refusal written by our own code means the function ran');
});
check('a clean reply is ok', A.serverPingOutcome(null) === 'ok', '');
check('an error with no code at all is not held against the server',
  A.serverPingOutcome({ message: 'something odd' }) === 'ok',
  'unknown fails towards no banner: a red bar on a guess is the cries-wolf failure');

/* ---------------------------------------------------------------------------
 * 2. The decision, as arithmetic.
 * ------------------------------------------------------------------------- */
const zero = { fails: 0, down: false, lastOkAt: null, firstFailAt: null, lastCode: '' };
const s1 = A.serverHealthStep(zero, 'noanswer', 1000, 'internal');
const s2 = A.serverHealthStep(s1, 'noanswer', 2000, 'internal');
const s3 = A.serverHealthStep(s2, 'noanswer', 3000, 'unavailable');
const sUp = A.serverHealthStep(s3, 'ok', 4000, '');

check('one no-answer does not raise the banner',
  s1.down === false && s1.changed === null && s1.fails === 1,
  'a single failed call is a cold start or a blip');
check('the second in a row raises it, and says so once',
  s2.down === true && s2.changed === 'down',
  'two is the threshold');
check('the third leaves it up without announcing it again',
  s3.down === true && s3.changed === null,
  'a note per failed tick is how one outage becomes a hundred writes');
check('the outage keeps the time of its FIRST failure',
  s2.firstFailAt === 1000 && s3.firstFailAt === 1000,
  'the banner says since when, and that is when it started, not the latest tick');
check('one reply clears it, announces the recovery and resets the count',
  sUp.down === false && sUp.changed === 'up' && sUp.fails === 0 && sUp.firstFailAt === null && sUp.lastOkAt === 4000,
  '');
check('a reply while healthy announces nothing',
  A.serverHealthStep(zero, 'ok', 5, '').changed === null, '');
{
  const a = A.serverHealthStep(zero, 'noanswer', 1, 'internal');
  const b = A.serverHealthStep(a, 'ok', 2, '');
  const c = A.serverHealthStep(b, 'noanswer', 3, 'internal');
  check('fail, answer, fail is NOT two in a row',
    c.down === false && c.fails === 1,
    'the count must reset on a reply or a flaky afternoon raises the bar');
}
check('the step does not change the state it was handed',
  zero.fails === 0 && s1.fails === 1 && s2.fails === 2,
  'pure: the caller decides what to keep');
check('the threshold the arithmetic uses is the declared one',
  A.SERVER_DOWN_AFTER === 2, 'change it deliberately, with the checks above');

/* ---------------------------------------------------------------------------
 * 3. The whole path, run.
 * ------------------------------------------------------------------------- */
(async function () {
  /* two failures */
  {
    const t = sandbox({ script: [E('functions/internal')] });
    await t.api.pingServer();
    check('after one failure the bar is still hidden',
      t.els.serverDownBanner.style.display === 'none', '');
    check('and exactly one re-check is booked, a minute out',
      t.calls.timers.length === 1 && t.calls.timers[0].ms === t.api.SERVER_RECHECK_MS && t.api.SERVER_RECHECK_MS === 60000,
      'without it a real outage waits for the next ten-minute tick');
    await t.calls.timers[0].fn();
    check('the re-check failing raises the bar',
      t.els.serverDownBanner.style.display === 'block' && t.api.state().down === true, '');
    check('the bar says what stops working and where to look first',
      /RSVP/.test(t.els.serverDownText.textContent) && /nightly invoices/.test(t.els.serverDownText.textContent) &&
      /console\.cloud\.google\.com\/billing/.test(t.els.serverDownText.textContent),
      'a bar that only says "down" sends nobody anywhere');
    check('one System notice is left',
      t.calls.writes.length === 1 && t.calls.writes[0].topic === t.api.SERVER_DOWN_TOPIC && t.calls.writes[0].folder === 'System',
      'the record for whoever was not looking at the screen');
    check('and the notice warns that RSVP answers in that time are probably not saved',
      /probably NOT saved/.test(t.calls.writes[0].message),
      'that is the sentence the Member Error rows got wrong for four days');
    check('the notice fits the 5,000-character rule on messages',
      t.calls.writes[0].message.length < 5000, 'firestore.rules refuses a longer create');
    /* ⚠ COUNTED FROM THE START, NOT FROM HERE. The first draft took the count after
       the bar went up and compared against that — and the re-check that RAISES the bar
       is exactly where a poll-while-down bug books its next timer, so the sabotage was
       already inside the baseline and passed. One timer, ever, for this whole outage. */
    await t.api.pingServer();
    await t.api.pingServer();
    check('while the bar is up nothing faster than the tick is booked',
      t.calls.timers.length === 1,
      'a page that polls a server during an outage is part of the outage');
    check('and no second notice is written for the same outage',
      t.calls.writes.length === 1, '');
  }
  /* recovery */
  {
    const t = sandbox({ script: [E('unavailable'), E('unavailable'), null] });
    await t.api.pingServer();
    await t.api.pingServer();
    const up = t.els.serverDownBanner.style.display;
    await t.api.pingServer();
    check('a reply takes the bar down again',
      up === 'block' && t.els.serverDownBanner.style.display === 'none' && t.api.state().down === false, '');
  }
  /* "Rate exceeded" */
  {
    const t = sandbox({ script: [E('functions/resource-exhausted')] });
    await t.api.pingServer();
    await t.api.pingServer();
    check('"Rate exceeded" twice running raises the bar too',
      t.els.serverDownBanner.style.display === 'block',
      'that is what the project answered for half an hour on the day billing came back');
  }
  /* a refusal is an answer */
  {
    const t = sandbox({ script: [E('functions/permission-denied')] });
    await t.api.pingServer(); await t.api.pingServer(); await t.api.pingServer();
    check('a refusal from our own code never raises the bar',
      t.els.serverDownBanner.style.display === 'none' && t.calls.writes.length === 0 && t.calls.timers.length === 0, '');
  }
  /* already noted by another tab */
  {
    const recent = { data: { topic: 'The Server Is Not Answering', createdAt: new Date(Date.now() - 3600 * 1000) } };
    const t = sandbox({ script: [E('internal')], messages: [recent] });
    await t.api.pingServer(); await t.api.pingServer();
    check('a notice left an hour ago by another tab is not repeated',
      t.els.serverDownBanner.style.display === 'block' && t.calls.writes.length === 0,
      'two people are in admin every day');
    const old = { data: { topic: 'The Server Is Not Answering', createdAt: new Date(Date.now() - 7 * 3600 * 1000) } };
    const u = sandbox({ script: [E('internal')], messages: [old] });
    await u.api.pingServer(); await u.api.pingServer();
    check('but one from seven hours ago is a different outage',
      u.calls.writes.length === 1, '');
    const other = { data: { topic: 'A Background Check Has Stopped', createdAt: new Date() } };
    const v = sandbox({ script: [E('internal')], messages: [other] });
    await v.api.pingServer(); await v.api.pingServer();
    check('and an unrelated System notice does not stand in for it',
      v.calls.writes.length === 1, '');
  }
  /* not asked when it cannot mean anything */
  {
    const t = sandbox({ script: [E('internal')], offline: true });
    await t.api.pingServer(); await t.api.pingServer();
    check('an offline browser is not asked',
      t.calls.pings === 0 && t.els.serverDownBanner.style.display === 'none',
      'her Wi-Fi being off is not the server being down, and both read as internal');
    const u = sandbox({ script: [E('internal')], signedOut: true });
    await u.api.pingServer();
    check('nor is a signed-out tab', u.calls.pings === 0, '');
  }
  /* never rejects */
  {
    const t = sandbox({ script: [E('internal')], writeThrows: true });
    let threw = false;
    try { await t.api.pingServer(); await t.api.pingServer(); } catch (e) { threw = true; }
    await new Promise(r => setTimeout(r, 0));
    check('a notice that cannot be saved does not reject the check',
      threw === false && t.els.serverDownBanner.style.display === 'block',
      'it is called bare from the health tick');
    check('and that failure is said, not swallowed',
      t.calls.errors.some(x => /note about it could not be saved/.test(x)),
      'nothing fails quietly');
  }
  /* the callable */
  const one = sandbox({ script: [null] });
  await one.api.pingServer();
  check('the check calls publicConfig, with a short timeout',
    one.calls.callable === 'publicConfig' && one.calls.callableOpts && one.calls.callableOpts.timeout <= 25000,
    'the default is 70 seconds, which is a long time to learn nothing');

  /* -------------------------------------------------------------------------
   * 4. Wiring. STRUCTURAL, and said so.
   * ----------------------------------------------------------------------- */
  console.log('');
  console.log('--- Wiring (structural) ---');
  console.log('');

  const tick = stripComments(between(admin, 'function runHealthCheckAuto(){', 'function startHealthCheckAuto(){'));
  check('the ten-minute health tick calls pingServer',
    /\bpingServer\(\);/.test(tick), 'the mechanism above is wired nowhere else that runs by itself');
  check('and does so before the cache guard',
    tick.indexOf('pingServer();') !== -1 && tick.indexOf('pingServer();') < tick.indexOf('hcCachesReady()'),
    'whether the server answers has nothing to do with whether the customer list has loaded');
  check('the block adds no interval of its own',
    !/setInterval\(/.test(CODE), 'connections.test.js names every long-lived timer in this page');
  /* The button is wired beside Run Health Check, outside the lifted block, so nothing in
     the block touches the page at load (run-all Suite 7 lifts it into a bare sandbox). */
  const wire = stripComments(between(admin, "const retry = document.getElementById('serverDownRetry');",
    "if(btn) btn.addEventListener('click', runHealthCheck);"));
  check('the Check again button is listened to, and calls pingServer',
    /retry\.addEventListener\('click',\s*function\(\)\{\s*pingServer\(\);\s*\}\)/.test(wire),
    'a button with no handler is identical on screen to one that works');
  check('and the block itself touches neither the page nor the callable at load',
    base.calls.listeners === 0 && base.calls.pings === 0 && base.calls.callable === undefined,
    'run-all Suite 7 lifts this stretch into a sandbox with no document and no httpsCallable');
  ['serverDownBanner', 'serverDownText', 'serverDownRetry'].forEach(function (id) {
    check('#' + id + ' exists in the page, once',
      admin.split('id="' + id + '"').length === 2, 'getElementById returns null and the bar silently never shows');
  });
  check('the bar starts hidden',
    /id="serverDownBanner"[^>]*display:none/.test(admin), 'a red bar on every page load');
  check('the notice topic is a System notice',
    between(admin, 'const SYSTEM_NOTICE_TOPICS = [', '];').indexOf("'" + A.SERVER_DOWN_TOPIC + "'") !== -1,
    'otherwise it is filed as a customer message');

  const pc = stripComments(between(fns, 'exports.publicConfig = onCall(', '\n});'));
  check('publicConfig was found on the server', pc.length > 50, 'the read-only check below would pass on nothing');
  check('and it writes nothing',
    !/\.(set|update|add|delete|create)\(/.test(pc) && !/batch|runTransaction/.test(pc),
    'this is called every ten minutes from every open admin tab');

  console.log('');
  console.log('=== The server is not answering, said on screen ===');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.log('');
  console.log('  FAIL  the run crashed: ' + (err && err.stack || err));
  console.log(passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
