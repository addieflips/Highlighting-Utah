/*
 * GMAIL FIRST, THE ADMIN INBOX ONLY IF THE GMAIL DID NOT GO  ([[MSG-30]], 2026-09-19)
 * ...ON THE SERVER TOO  ([[MSG-31]], 2026-09-21 — see the second half of this file)
 *
 * Addie: "Currently we have the admin inbox and the gmail inbox but messages are getting
 * sent to gmail and admin. I only want them sent to gmail and if they fail to send to
 * gmail they will send to admin inbox but that is the only reason. Also with Have a
 * question on home page those should be sent to gmail and not admin inbox."
 *
 * ⛔ WHY THIS FILE EXISTS RATHER THAN A BROWSER SPEC. The Playwright stub never configures
 * EmailJS, so `window.emailjs` is absent and EVERY spec takes the fallback branch — which
 * is the old behaviour exactly. All 177 of them passed against this change without
 * touching the half that is new. A suite that can only reach one branch proves the branch
 * it was already proving; this runs both.
 *
 * ⛔ AND IT RUNS THE REAL PAIR, NEVER A STUB OF EITHER. The whole claim is about how
 * `tellOffice` and `notifyBusinessOfMessage` COMPOSE — which outcome causes a write — so a
 * stubbed sender would decide the very thing under test. Both are lifted out of
 * index.html and driven against a fake EmailJS and a fake addDoc.
 *
 * Run:  node message-fallback.test.js      (or: npm run test:msgfallback)
 */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const fns = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, why) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (why ? ' — ' + why : '')); console.log('  FAIL  ' + name); }
}

/* ⚠ COMMENTS STRIPPED BEFORE ANY SOURCE CHECK. Every rule below is written out in prose
   beside the code it governs, so a plain search finds the explanation and calls it the
   thing — Suites 58, 274, 275 and 300 each learned this the same way. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/* ⚠ indexOf, NOT a regex, and it tries `async function` first. §5 records that
   `extractFn`'s `function NAME(` cut drops the async keyword and hands a sandbox a body
   full of bare `await` — a parse error that kills a whole run with no clue which function
   caused it. Neither function lifted here is async today; this is what keeps that true
   cheaply if one ever becomes so. */
function lift(src, name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start === -1) start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  return null;
}

console.log('\n=== Gmail first, the Inbox only on failure ===\n');

const notifySrc = lift(idx, 'notifyBusinessOfMessage');
const tellSrc   = lift(idx, 'tellOffice');

/* ⛔ THE GUARD THAT STOPS EVERYTHING BELOW PASSING VACUOUSLY. An empty lift makes the
   sandbox throw on construction, which would be reported as one failure while a dozen
   behavioural checks never ran at all — the shape `sandboxDeps` exists to name. */
check('both halves of the rule were found to lift', !!notifySrc && !!tellSrc,
  'renamed or gone — repoint this gate rather than deleting it; every check below is ' +
  'about how these two compose');

if (!notifySrc || !tellSrc) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(1);
}

/* ---- the harness ---------------------------------------------------------- *
 * `opts.send` decides what the fake EmailJS does: 'ok', 'reject', 'throw', or
 * 'missing' / 'unconfigured' to reach the two early exits. `opts.addDocThrows`
 * is the both-channels-gone case.
 * -------------------------------------------------------------------------- */
function run(opts) {
  const log = { sent: [], wrote: [] };
  const o = opts || {};

  const emailjs = {
    init: function () { if (o.send === 'throw') throw new Error('init blew up'); },
    send: function (svc, tpl, p) {
      log.sent.push(p);
      if (o.send === 'reject') return Promise.reject(new Error('refused'));
      return Promise.resolve({ status: 200 });
    }
  };

  const make = new Function(
    'emailjs', 'win', 'settings', 'addDocFake', 'stampFake', 'collFake', 'dbFake', 'logRef',
    `
    var window = win;
    var emailjsSettings = settings;
    var console = { warn: function(){}, error: function(){} };
    var db = dbFake;
    var addDoc = addDocFake;
    var collection = collFake;
    var serverTimestamp = stampFake;
    ${notifySrc}
    ${tellSrc}
    return { tellOffice: tellOffice, notifyBusinessOfMessage: notifyBusinessOfMessage };
  `);

  const api = make(
    emailjs,
    { emailjs: o.send === 'missing' ? undefined : emailjs },
    o.send === 'unconfigured'
      ? null
      : { serviceId: 's', notifyTemplateId: 't', publicKey: 'p' },
    function (col, row) {
      if (o.addDocThrows) return Promise.reject(new Error('firestore refused'));
      log.wrote.push(row);
      return Promise.resolve({ id: 'msg1' });
    },
    function () { return '__SERVER_TIME__'; },
    function () { return 'messages'; },
    {},
    log
  );

  return { api: api, log: log };
}

const ROW = { topic: 'General Question', folder: 'Inbox', name: 'Addie', message: 'hello' };
const MAIL = { customer_name: 'Addie', customer_phone: '3853584716', customer_email: '',
               topic: 'General Question', message: 'hello' };

(async function () {

  /* ⭐ THE CHECK THE WHOLE FILE IS FOR. */
  {
    const r = run({ send: 'ok' });
    const out = await r.api.tellOffice(MAIL, ROW);
    check('a delivered alert writes NOTHING to the admin Inbox',
      r.log.wrote.length === 0,
      'this is the double-post Addie asked to end — one message, two places, every time');
    check('and it reports that it sent',
      out && out.sent === true && out.ref === null,
      'the caller shows the customer a success screen off this answer');
    check('and the Gmail actually got it',
      r.log.sent.length === 1 && r.log.sent[0].message === 'hello',
      'writing nothing is only correct if something was sent — otherwise this is ' +
      'the message being dropped on the floor');
  }

  /* ⛔ THE THREE SILENT EXITS. Under the old design these cost only the nudge, because
     the Inbox write was unconditional and had already happened. They are now the
     difference between a message kept and a message lost, and an exit that reported
     success would lose EVERY message the moment settings/emailjs broke — which is a
     thing that has actually happened here, when that document went staff-only. */
  for (const [mode, label] of [
    ['unconfigured', 'EmailJS is not set up'],
    ['missing',      'the EmailJS script did not load'],
    ['throw',        'the send threw before it started'],
    ['reject',       'the mail service refused the send']
  ]) {
    const r = run({ send: mode });
    const out = await r.api.tellOffice(MAIL, ROW);
    check('when ' + label + ', the message falls back to the Inbox',
      r.log.wrote.length === 1,
      'the customer pressed send, the Gmail never got it, and nothing anywhere kept it');
    check('  ...and the row says it is a fallback',
      r.log.wrote.length === 1 && r.log.wrote[0].alertFailed === true,
      'a row with no marker is indistinguishable from the double-post she asked to ' +
      'remove, so the first reading is that the change did not work');
    check('  ...and it names why the Gmail missed it',
      r.log.wrote.length === 1 &&
      typeof r.log.wrote[0].alertFailReason === 'string' &&
      r.log.wrote[0].alertFailReason.length > 0,
      '"something went wrong" sends somebody to check three settings boxes, a script ' +
      'tag and the mail service');
    check('  ...and it reports that it did not send',
      out && out.sent === false,
      'the caller cannot tell the two outcomes apart');
  }

  /* ⚠ THE FALLBACK ROW IS THE CALLER'S ROW, not an invention of the funnel — the topic,
     the folder and the flags a caller passes are what the Inbox filters and renders on. */
  {
    const r = run({ send: 'reject' });
    await r.api.tellOffice(MAIL, { topic: 'Cancellation Request', folder: 'Inbox',
      important: true, name: 'Addie', message: 'moving out' });
    const w = r.log.wrote[0] || {};
    check('the fallback row keeps the caller\'s own topic, folder and flags',
      w.topic === 'Cancellation Request' && w.folder === 'Inbox' && w.important === true,
      'a row filed somewhere else, or stripped of important, is a row she does not see');
    check('and the funnel stamps the time itself',
      w.createdAt === '__SERVER_TIME__',
      'a caller-supplied date is one that arrives missing the day somebody forgets it');
  }

  /* ⛔ BOTH CHANNELS GONE IS THE ONE CASE THAT MUST REACH THE CUSTOMER. Every caller
     wraps this in a catch that tells them to phone instead; swallowing it here would
     show a success screen for a message that exists nowhere. */
  {
    const r = run({ send: 'reject', addDocThrows: true });
    let threw = false;
    try { await r.api.tellOffice(MAIL, ROW); } catch (e) { threw = true; }
    check('when the Gmail AND the Inbox both fail, it throws',
      threw,
      'the customer is shown "sent" for a message that reached nobody — the one ' +
      'outcome worse than either failure alone');
  }

  /* ⚠ AND A DELIVERED ALERT MUST NOT THROW ON A BROKEN FIRESTORE. The write is not
     attempted at all in that branch, so a customer whose message went to the Gmail is
     never told it failed because of a collection nobody touched. */
  {
    const r = run({ send: 'ok', addDocThrows: true });
    let threw = false;
    try { await r.api.tellOffice(MAIL, ROW); } catch (e) { threw = true; }
    check('a delivered alert does not touch Firestore at all',
      !threw && r.log.wrote.length === 0,
      'the success path would depend on a collection it has no reason to write to');
  }

  /* ---- the wiring, asserted separately from the mechanism ------------------ *
   * ⛔ EVERY CHECK ABOVE CALLS `tellOffice` DIRECTLY. Delete the call from a form and
   * all of them stay green while that form goes back to double-posting — the
   * mechanism-without-wiring trap this repo has shipped twice.
   * ------------------------------------------------------------------------ */
  const bare = stripComments(idx);

  /* ⚠ A CENSUS, NOT A FLOOR, and the first draft got that wrong: `>= 11` against twelve
     real call sites let one disappear in silence, which is the whole failure mode here —
     a path that stops telling anybody looks exactly like a quiet week. Thirteen is one
     declaration plus twelve callers. Change the number deliberately, in the same commit
     that adds or removes a path, the way this repo writes down its other censuses: a
     caller vanishing is as interesting as one arriving. */
  const funnelUses = (bare.match(/tellOffice\(/g) || []).length;
  check('every customer message path goes through the one funnel',
    funnelUses === 13,
    'found ' + funnelUses + ', expected 13 (one declaration + twelve callers) — either ' +
    'a path stopped telling the office at all, or a new one is double-posting beside it');

  /* ⛔ AND NOTHING WRITES A CUSTOMER MESSAGE DIRECTLY ANY MORE. The ONE exception is the
     Member Errors reporter, which never went to the Gmail and never should ([[MSG-17]]:
     "Errors and system notices stay in the admin Inbox and email nobody"). Routing it
     through here would make an error report conditional on the mail service that may
     itself be what failed. */
  const directWrites = (bare.match(/addDoc\(collection\(db,'messages'\)/g) || []).length;
  check('only two direct writes to messages are left in index.html',
    directWrites === 2,
    'found ' + directWrites + ' — one is the funnel\'s own fallback write and one is ' +
    'the Member Errors reporter; a third is a path that still double-posts');

  /* ⚠ ANCHORED ON THE WRITE, NOT ON THE NAME. The first mention of MEMBER_ERROR_TOPIC is
     its `var` declaration seventy lines above the addDoc, so a window around THAT failed
     on correct code — which is the §7 trap this gate is otherwise written to avoid. */
  const errWriteAt = bare.indexOf('topic: MEMBER_ERROR_TOPIC');
  check('the Member Errors reporter still writes straight to the Inbox',
    errWriteAt > -1 &&
    /addDoc\(collection\(db,'messages'\)/.test(bare.slice(Math.max(0, errWriteAt - 200), errWriteAt)) &&
    !/tellOffice\(/.test(bare.slice(Math.max(0, errWriteAt - 400), errWriteAt)),
    'an error report that depends on the email service cannot report the email ' +
    'service being down — which is one of the things it exists to report');

  /* ======================================================================== *
   * ⭐ AND THE SERVER OBEYS THE SAME RULE ([[MSG-31]], 2026-09-21)
   *
   * Addie: "No messages coming from members or member portal changes should be going
   * to admin inbox. There shouldn't even be duplicated emails in the admin inbox."
   *
   * ⛔ [[MSG-30]] ONLY EVER TOUCHED index.html, AND THAT IS WHY SHE WAS STILL READING
   * THEM. Everything above this line is about the browser. functions/index.js went on
   * writing its own rows unconditionally from five member PORTAL ACTIONS — a colour
   * change made after the route was built, a rejoin after recycling, an RSVP no or back
   * next year, a declined re-quote and a declined add-on. The rule was half-applied, and
   * the half nobody could see from index.html was the half still filling her Inbox.
   * ⛔ AND THE COLOUR CHANGE WAS THE LITERAL DUPLICATE. The browser emails and writes a
   * row only when that send fails; the server wrote one every time. One member action,
   * two rows, different wording.
   *
   * ⚠ WHAT IS CHECKED HERE IS OWNERSHIP, NOT BEHAVIOUR. run-all's Suites 117, 137, 138
   * and the portalRsvp harness RUN `tellOfficeServer` against a fake mail service and
   * prove both branches — that a successful send writes no row, that a refusal files one
   * marked `alertFailed`. What only a census can hold is that no SIXTH member action
   * quietly goes back to writing its own row beside it, which is exactly how this came
   * back the first time.
   * ======================================================================== */
  const bareFns = stripComments(fns);

  const serverFunnel = (bareFns.match(/tellOfficeServer\(/g) || []).length;
  check('every member-action notice on the server goes through the one funnel',
    serverFunnel === 7,
    'found ' + serverFunnel + ', expected 7 (one declaration + six callers: the colour ' +
    'change after routing, the rejoin, the RSVP decline, the decline reason follow-up, ' +
    'the re-quote decline and the add-on decline) — either a path stopped telling the ' +
    'office at all, or a new one is writing its own row beside it');

  /* ⚠ A CENSUS, NOT A FLOOR, AND THE FLOOR IS WHY. This check read `>= 8` until today
     and passed at twelve, at ten and at nine alike — so five member notices could be
     added to the Inbox with nothing going red. It was the count going DOWN that finally
     failed it. Six is five notices that are genuinely about US plus the funnel's own
     fallback write. Change it deliberately, in the same commit, the way this repo writes
     down its other censuses: a writer vanishing is as interesting as one arriving. */
  const sysNotices = (bareFns.match(/collection\('messages'\)\.add\(/g) || []).length;
  check('and the six direct writes left on the server are all about us, not about a member',
    sysNotices === 6,
    'found ' + sysNotices + ' — expected 6: Payment With No Bill, Referral Taken Back, ' +
    'Maybe Next Year — New Record, Nightly Billing Needs You, Cannot Be Billed, and ' +
    'the funnel\'s own fallback write');

  /* ⛔ AND EACH OF THOSE FIVE IS NAMED, because a bare number cannot tell a member
     notice sneaking back in from one of these being renamed. [[MSG-17]] settled that
     system notices email nobody — they were never part of the double-post, and making
     them conditional on the mail service would silence the nightly billing run, which
     is the one notice that exists because money did not move. */
  const STAY_DIRECT = ['Payment With No Bill', 'Referral Taken Back',
    'Maybe Next Year — New Record', 'Nightly Billing Needs You', 'Cannot Be Billed'];
  const lost = STAY_DIRECT.filter(t => bareFns.indexOf("topic: '" + t + "'") === -1);
  check('and the five that stay direct are still there by name',
    lost.length === 0,
    'missing: ' + lost.join(', ') + ' — a count alone cannot tell one of these being ' +
    'renamed from a member notice quietly taking its place');

  /* ⛔ THE BROWSER'S OWN "Quote Declined" REPORT IS DELIBERATELY KEPT, AND IT IS NOT A
     DUPLICATE. `declineAsksAboutLastYear` returns BEFORE its notice when the decliner is
     not a customer of ours, so for a plain quote — somebody who was never converted —
     the browser's note is the only report there is. Removing it to stop a double-up for
     members would silence every non-member decline. The cost, stated rather than fixed
     by deleting a notice: an existing member who declines produces two Gmail emails
     carrying different facts, and no Inbox row either way. */
  const declineFn = lift(fns, 'declineAsksAboutLastYear') || '';
  const guardAt = stripComments(declineFn).indexOf('if (!cust) return');
  const noticeAt = stripComments(declineFn).indexOf('tellOfficeServer(');
  check('a decline by somebody who is not a customer raises no server notice at all',
    guardAt > -1 && noticeAt > -1 && guardAt < noticeAt,
    'if that guard ever moves below the notice, the browser\'s Quote Declined really ' +
    'does become a duplicate — and until then it is the only report a plain quote gets');

  console.log('');
  failures.forEach(f => console.log('  FAIL  ' + f + '\n'));
  console.log(pass + ' passed, ' + fail + ' failed\n');
  if (fail) {
    console.log('Gmail-first is broken. A message that reaches neither the Gmail nor the');
    console.log('Inbox is a customer who thinks they have told us something and has not.\n');
  }
  process.exit(fail ? 1 : 0);
})();
