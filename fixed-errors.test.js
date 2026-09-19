/* A FAULT THAT HAS BEEN FIXED CLEARS ITS OWN REPORTS
 * ==================================================
 * `npm run test:fixederrors` — its own file per R-018.
 *
 * Addie, 2026-09-19, asked how the Errors should be cleared — by a nightly age sweep, by
 * a button in the Inbox, or by me on demand: "I want you to clear those once you fix
 * them. thats how it should work." [[MSG-29]]
 *
 * So the clearing belongs to the FIX. An entry goes into FIXED_ERRORS in the same change
 * that repairs the fault, ships in that same push, and the reports of it are gone by her
 * next login. Nobody presses anything and no clock is involved.
 *
 * ⛔ THIS FILE IS MOSTLY ABOUT WHAT MUST SURVIVE, AND THAT IS DELIBERATE. The mechanism
 * DELETES, and a delete here has no undo and leaves nothing behind to notice — an
 * over-broad needle would silently destroy the evidence of a bug nobody has diagnosed
 * yet, and the only symptom would be a folder that looks reassuringly empty. So the
 * checks are weighted the other way round from usual: six say what is cleared, eleven say
 * what is not.
 *
 * THE TWO GUARANTEES THAT MATTER MOST
 *   1. A report written AFTER the fix shipped is NEVER cleared. A fix that did not take
 *      re-reports itself; sweeping on the fault alone would delete exactly that evidence,
 *      for ever and in silence. `fixedOn` is a floor and the day itself survives too.
 *   2. Nothing that is not an error report is ever touched. A customer's message can
 *      quote any words at all — including the words of a fault — and must be untouchable.
 *
 * ⚠ EVERY CLAIM IS RUN, NOT MATCHED. All of them are about which rows are still there
 * afterwards, which no regex can see. The two wiring checks at the end say in as many
 * words that they are structural, and why: this repo has shipped a mechanism that worked
 * perfectly and was never called at least three times (the recycle "bin says" box, the
 * Edit Customer tab strip, the referral banner), each with a green suite over it.
 *
 * ⚠ AND THE FUNCTIONS ARE LIFTED, NEVER STUBBED (CLAUDE.md §3). A stub of `toJsDate`
 * would decide the very thing under test — whether a row can be dated at all is half of
 * guarantee 1.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

/* Slices between two real structural markers. CLAUDE.md §7 bans fixed-length extraction
   windows by name — they go stale silently as the code between them grows. */
function between(src, startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error('could not find the start of ' + label + ' (' + startMarker + ')');
  const b = src.indexOf(endMarker, a);
  if (b === -1) throw new Error('could not find the end of ' + label + ' (' + endMarker + ')');
  return src.slice(a, b);
}

function extractFn(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i === -1) i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('could not find function ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('could not find the end of ' + name);
}

/* ---------------------------------------------------------------------------
 * The pieces, lifted.
 * ------------------------------------------------------------------------- */
const ERROR_CONSTS = between(admin, "const ERROR_FOLDER = 'Errors';",
  'const MESSAGE_HOME_FOLDER = {', 'the Errors folder constants');
/* ⚠ ENDS AT `let adminErrorsWritten`, which is the next declaration after the block and
   is what the splice was anchored on. Reaching further carries the admin reporter in,
   and every sandbox here would then need Firestore. */
const BLOCK = between(admin, 'const FIXED_ERROR_MIN_MATCH = 12;',
  'let adminErrorsWritten = 0;', 'the fixed-errors block');
const TO_JS_DATE = extractFn(admin, 'toJsDate');
const FLOOR_FN = extractFn(admin, 'fixedErrorFloor');

const MEMBER_TOPIC = 'Member Error';
const ADMIN_TOPIC = 'Admin Error';

/* A fresh sandbox per test, so one test's `fixedErrorsTried` set cannot decide another's.
   `allMessages`, `deleteDoc` and the rest arrive as parameters, which shadow the globals
   of the same name and are the same bindings the real page closes over. */
function sandbox(opts) {
  opts = opts || {};
  const deleted = [];
  const logged = [];
  const fakeConsole = {
    warn: function () { logged.push(['warn'].concat([].slice.call(arguments)).join(' ')); },
    log: function () { logged.push(['log'].concat([].slice.call(arguments)).join(' ')); },
    error: function () { logged.push(['error'].concat([].slice.call(arguments)).join(' ')); }
  };
  const messages = opts.messages || [];
  const body = ERROR_CONSTS + '\n' + TO_JS_DATE + '\n' + BLOCK + '\n' +
    'return { FIXED_ERRORS: FIXED_ERRORS, FIXED_ERROR_MIN_MATCH: FIXED_ERROR_MIN_MATCH,' +
    ' fixedErrorNeedle: fixedErrorNeedle, fixedErrorFloor: fixedErrorFloor,' +
    ' errorFixedBy: errorFixedBy, fixedErrorsBadEntries: fixedErrorsBadEntries,' +
    ' clearFixedErrors: clearFixedErrors };';
  const names = ['deleteDoc', 'doc', 'db', 'allMessages', 'console'];
  const api = new Function(...names, body)(
    function (ref) {
      if (opts.deleteThrows) throw new Error('permission denied');
      deleted.push(ref);
      return Promise.resolve();
    },
    function (_db, coll, id) { return coll + '/' + id; },
    {},
    messages,
    fakeConsole
  );
  api.deleted = deleted;
  api.logged = logged;
  api.messages = messages;
  return api;
}

const api = sandbox();

/* A report, shaped the way the real reporters write one. */
function row(id, topic, errorKey, when) {
  return { id: id, data: { topic: topic, errorKey: errorKey, createdAt: when } };
}
function daysBefore(iso, n) {
  const b = iso.split('-');
  const d = new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  d.setDate(d.getDate() - n);
  return d;
}
function daysAfter(iso, n) { return daysBefore(iso, -n); }

/* The first shipped entry, whatever it happens to be, so these checks do not go stale
   when the list is added to. */
const first = api.FIXED_ERRORS[0];

console.log('');
console.log('--- The list itself ---');
console.log('');

check('every shipped entry is usable',
  api.fixedErrorsBadEntries(api.FIXED_ERRORS).length === 0,
  'unusable: ' + JSON.stringify(api.fixedErrorsBadEntries(api.FIXED_ERRORS).map(e => e && e.match)));

/* ⚠ THE VACUITY GUARD. Every behavioural check below drives the list, so an empty list
   would make most of them pass by having nothing to find. */
check('the list is not empty',
  Array.isArray(api.FIXED_ERRORS) && api.FIXED_ERRORS.length >= 5,
  'found ' + (api.FIXED_ERRORS || []).length);

check('every entry carries a note saying which commit fixed it',
  api.FIXED_ERRORS.every(e => typeof e.note === 'string' && e.note.trim().length > 20),
  'a bare match with no note is a claim nobody can check');

check('a needle too short to be safe is refused',
  api.errorFixedBy(
    row('x', ADMIN_TOPIC, 'admin error|internal server wobble', daysBefore('2026-09-09', 5)).data,
    [{ match: 'internal', fixedOn: '2026-09-09', note: 'deliberately too short' }]
  ) === null,
  'an eight-letter needle sits inside ordinary words and would clear half the folder');

check('a needle at the minimum length is accepted',
  api.errorFixedBy(
    row('x', ADMIN_TOPIC, 'admin error|abcdefghijkl happened', daysBefore('2026-09-09', 5)).data,
    [{ match: 'abcdefghijkl', fixedOn: '2026-09-09', note: 'exactly at the floor' }]
  ) !== null,
  'the rule must be "shorter than", not "shorter than or equal to"');

check('an entry whose date will not read is refused',
  api.errorFixedBy(
    row('x', ADMIN_TOPIC, 'admin error|some long distinctive fault', daysBefore('2026-09-09', 5)).data,
    [{ match: 'some long distinctive fault', fixedOn: 'last tuesday', note: 'bad date' }]
  ) === null,
  'a typo in a date must not be read as "fixed at the dawn of time"');

/* ⚠ RUN IN A CHILD PROCESS UNDER MOUNTAIN TIME, AND THAT IS THE WHOLE CHECK. This
   container runs UTC, where local midnight and Date.parse('YYYY-MM-DD') are the same
   instant — so asserted in-process this passes whether the floor is built locally or not,
   which is exactly what the red-check caught it doing. Under America/Denver, the business's
   own timezone, the two are six hours apart, and those six hours are an evening in which a
   report written AFTER the fix would be cleared as though it predated it. */
check('an entry whose date will not read is named as unusable',
  api.fixedErrorsBadEntries([{ match: 'some long distinctive fault', fixedOn: 'last tuesday', note: 'bad date' }]).length === 1,
  'a typo in a date reads exactly like a fault that never got cleared, so it has to be said out loud');

check('the floor is local midnight, not UTC',
  (function () {
    const probe = FLOOR_FN + ';' +
      'const local = new Date(2026, 8, 10).getTime();' +
      'process.stdout.write(JSON.stringify([fixedErrorFloor("2026-09-10"), local, Date.parse("2026-09-10")]));';
    const out = execFileSync(process.execPath, ['-e', probe],
      { env: Object.assign({}, process.env, { TZ: 'America/Denver' }) }).toString();
    const got = JSON.parse(out);
    return got[0] === got[1] && got[1] !== got[2];
  })(),
  'Date.parse of a bare YYYY-MM-DD is UTC, which puts the floor in the previous evening');

console.log('');
console.log('--- What gets cleared ---');
console.log('');

check('an admin report of a fixed fault, from before the fix, is cleared',
  api.errorFixedBy(row('a', ADMIN_TOPIC,
    'admin error|' + String(first.match).toLowerCase(),
    daysBefore(first.fixedOn, 3)).data) !== null);

check('the member reporter\'s own key spelling matches too',
  api.errorFixedBy(row('m', MEMBER_TOPIC,
    'Changing their install preferences|Cannot read properties of null (reading \'value\')',
    daysBefore('2026-09-10', 2)).data) !== null,
  'index.html builds doing|reason and does NOT lowercase, admin.html does — both must match');

/* ⚠ THE NEEDLE CARRIES THE DIGITS HERE, WHICH THE CHECK BELOW DOES NOT. Its entry is
   typed with the real counts the office saw in the row; errorKeyFor had already collapsed
   them to # before it was stored, so without the same collapse on this side the two can
   never meet. The red-check found the check below passing with the normalisation deleted,
   because its needle happens to hold no digits at all. */
check('digits in the needle are normalised too, so an entry can be typed as the error reads',
  api.errorFixedBy(
    row('c', ADMIN_TOPIC, 'admin error|emails did not send: # of # failed', daysBefore('2026-09-11', 1)).data,
    [{ match: 'emails did not send: 1 of 258 failed', fixedOn: '2026-09-11', note: 'the real wording of that row, counts and all' }]
  ) !== null,
  'an entry has to be typeable as the error actually reads, not in the key\'s own spelling');

check('digits in the key do not stop a match',
  api.errorFixedBy(row('d', ADMIN_TOPIC,
    'admin error|document already exists: projects/x/messages/0hce7pw1zaaupdani5iq',
    daysBefore('2026-09-11', 1)).data) !== null,
  'errorKeyFor collapses runs of digits to #, so the needle must be normalised the same way');

check('Safari\'s wording for the portal crash is covered as well as Chrome\'s',
  api.errorFixedBy(row('s', MEMBER_TOPIC,
    'Something broke on the page while they were using their account|null is not an object (evaluating \'x.value\')',
    daysBefore('2026-09-10', 1)).data) !== null,
  'the report that found that crash came off a real iPhone');

check('the entry that matched is handed back, not just a yes',
  (function () {
    const hit = api.errorFixedBy(row('a', ADMIN_TOPIC,
      'admin error|' + String(first.match).toLowerCase(), daysBefore(first.fixedOn, 3)).data);
    return hit && hit.match === first.match;
  })(),
  'the caller has nothing to log about WHY a row went otherwise');

console.log('');
console.log('--- What must never be cleared ---');
console.log('');

/* ⛔ THE ONE THAT MATTERS MOST. */
check('a customer\'s own message is never cleared, whatever it says',
  api.errorFixedBy({
    topic: 'Light Colour Change',
    errorKey: 'admin error|' + String(first.match).toLowerCase(),
    createdAt: daysBefore(first.fixedOn, 3)
  }) === null,
  'a customer can quote any words at all, the fault\'s included');

check('a System notice is never cleared either',
  api.errorFixedBy({
    topic: 'System',
    errorKey: 'admin error|' + String(first.match).toLowerCase(),
    createdAt: daysBefore(first.fixedOn, 3)
  }) === null);

/* ⛔ GUARANTEE 1. */
check('a report written AFTER the fix shipped survives',
  api.errorFixedBy(row('a', ADMIN_TOPIC,
    'admin error|' + String(first.match).toLowerCase(),
    daysAfter(first.fixedOn, 1)).data) === null,
  'that row is the only evidence the fix did not take');

check('a report from the fix day itself survives',
  api.errorFixedBy(row('a', ADMIN_TOPIC,
    'admin error|' + String(first.match).toLowerCase(),
    new Date(api.fixedErrorFloor(first.fixedOn) + 6 * 3600 * 1000)).data) === null,
  'the fix landed at some hour of that day and nothing here knows which');

check('a report with no errorKey survives',
  api.errorFixedBy({ topic: ADMIN_TOPIC, createdAt: daysBefore(first.fixedOn, 3) }) === null,
  'those predate the field, so nothing can be shown about them');

check('a report with no date survives',
  api.errorFixedBy(row('a', ADMIN_TOPIC,
    'admin error|' + String(first.match).toLowerCase(), null).data) === null,
  'serverTimestamp reads back null on the writing tab\'s own first snapshot');

/* ⛔ THE INSTRUMENTED-NOT-FIXED CASE, NAMED. */
check('"Missing or insufficient permissions" is NOT treated as fixed',
  api.errorFixedBy(row('p', ADMIN_TOPIC,
    'admin error|unhandled promise: missing or insufficient permissions',
    daysBefore('2026-09-18', 4)).data) === null,
  'that was instrumented on 2026-09-18, not fixed — clearing it destroys the reports the fix is waiting for');

/* ⚠ REPOINTED, NOT WEAKENED (2026-09-19). This check used Edit Customer's own crash as its
   example office error — and that fault now has an entry of its own, so the row it built is
   legitimately cleared and the check failed on correct code. The CLAIM is unchanged: a
   portal-scoped entry must never reach an admin row. Its fixture is now a null dereference
   nobody has fixed, which is the only kind that can prove it. */
check('an entry scoped to the portal does not clear an office error',
  api.errorFixedBy(
    row('o', ADMIN_TOPIC, 'admin error|some unfixed office fault: cannot read properties of null (reading \'value\')',
      daysBefore('2026-09-10', 2)).data
  ) === null,
  'the two null-crash entries are the portal\'s; an office fault of the same wording is a different bug');

check('and Edit Customer\'s own crash IS cleared, by its own entry',
  (function () {
    const hit = api.errorFixedBy(
      row('ec', ADMIN_TOPIC, 'admin error|edit customer save failed: cannot read properties of null (reading \'indexof\')',
        daysBefore('2026-09-12', 3)).data);
    return hit && hit.match === 'Edit Customer save failed';
  })(),
  'both engine wordings share that prefix, which is why one entry covers the pair');

check('and it is not cleared for a report written after its fix landed',
  api.errorFixedBy(
    row('ec2', ADMIN_TOPIC, 'admin error|edit customer save failed: null is not an object (evaluating \'s.indexof\')',
      daysAfter('2026-09-12', 2)).data
  ) === null,
  'the fix went to main at 22:44 on the 12th; a report after that means it did not take');

check('and the same wording from the portal still is cleared',
  api.errorFixedBy(
    row('p2', MEMBER_TOPIC, 'Something broke|Cannot read properties of null (reading \'value\')',
      daysBefore('2026-09-10', 2)).data
  ) !== null,
  'scoping must narrow the entry, not disable it');

check('an entry naming a topic that is neither reporter is named as unusable',
  api.fixedErrorsBadEntries([{ match: 'some long distinctive fault', topic: 'Admin Errors', fixedOn: '2026-09-09', note: 'plural, so it matches nothing' }]).length === 1,
  'a typo in a topic silently never matches, which reads exactly like a fault that never got cleared');

check('a fault nobody has fixed survives',
  api.errorFixedBy(row('n', ADMIN_TOPIC,
    'admin error|somethingnobodyhasseen is not defined', daysBefore('2026-09-09', 3)).data) === null);

console.log('');
console.log('--- The sweep ---');
console.log('');

const sweepChecks = (async function () {
  {
    const s = sandbox({
      messages: [
        row('keep-customer', 'Light Colour Change', 'admin error|' + String(first.match).toLowerCase(), daysBefore(first.fixedOn, 3)),
        row('go-1', ADMIN_TOPIC, 'admin error|' + String(first.match).toLowerCase(), daysBefore(first.fixedOn, 3)),
        row('keep-after', ADMIN_TOPIC, 'admin error|' + String(first.match).toLowerCase(), daysAfter(first.fixedOn, 2)),
        row('keep-unknown', ADMIN_TOPIC, 'admin error|nobody has fixed this one', daysBefore(first.fixedOn, 3)),
        row('go-2', MEMBER_TOPIC, 'Their answer|deadline-exceeded', daysBefore('2026-09-11', 1))
      ]
    });
    await s.clearFixedErrors();
    check('the sweep deletes exactly the reports whose fault is fixed',
      s.deleted.join(',') === 'messages/go-1,messages/go-2',
      'deleted: ' + JSON.stringify(s.deleted));
    check('the sweep leaves the customer message alone',
      s.deleted.every(r => r.indexOf('keep-') === -1));
    check('the sweep says how many it cleared',
      s.logged.some(l => /cleared 2 error report/.test(l)),
      'a delete nobody is told about is the other half of "nothing should fail quietly"');
  }

  {
    const s = sandbox({
      messages: [row('go-1', ADMIN_TOPIC, 'admin error|' + String(first.match).toLowerCase(), daysBefore(first.fixedOn, 3))]
    });
    await s.clearFixedErrors();
    await s.clearFixedErrors();
    check('a row already attempted is not attempted again',
      s.deleted.length === 1,
      'deleting re-fires the messages listener, so without this it loops for ever');
  }

  {
    const s = sandbox({
      deleteThrows: true,
      messages: [row('go-1', ADMIN_TOPIC, 'admin error|' + String(first.match).toLowerCase(), daysBefore(first.fixedOn, 3))]
    });
    let threw = false;
    try { await s.clearFixedErrors(); } catch (e) { threw = true; }
    check('a refused delete does not take the sweep down',
      !threw && s.logged.some(l => /could not clear/.test(l)),
      'it runs off the messages snapshot; a rejection here is written back into the folder it is emptying');
  }

  {
    const s = sandbox({ messages: [] });
    let threw = false;
    try { await s.clearFixedErrors(); } catch (e) { threw = true; }
    check('an empty message list is not an error', !threw && s.deleted.length === 0);
  }

  {
    /* The cap is 300; this proves it is a cap rather than decoration. */
    const many = [];
    for (let i = 0; i < 350; i++) {
      many.push(row('go-' + i, ADMIN_TOPIC,
        'admin error|' + String(first.match).toLowerCase(), daysBefore(first.fixedOn, 3)));
    }
    const s = sandbox({ messages: many });
    await s.clearFixedErrors();
    check('one sweep is capped', s.deleted.length === 300,
      'deleted ' + s.deleted.length + ' — the rest go on the next login');
  }
})();

/* ---------------------------------------------------------------------------
 * Wiring. STRUCTURAL, and said so on purpose.
 * ------------------------------------------------------------------------- */
const loadMessages = extractFn(admin, 'loadMessages');

sweepChecks.then(() => {
  console.log('');
  console.log('--- Wiring (structural) ---');
  console.log('');

  /* ⚠ STRUCTURAL BECAUSE RUNNING IT WOULD MEAN A FAKE onSnapshot, a fake query and a fake
     renderer, and the claim is only that the call is there at all. Every behavioural check
     above calls clearFixedErrors from this file's own harness, so without this one the
     whole mechanism could be perfect and never run — which this repo has shipped three
     times. */
  check('the messages snapshot calls clearFixedErrors',
    /\bclearFixedErrors\(\)/.test(loadMessages),
    'the sweep is wired nowhere else');

  check('it runs after allMessages has been rebuilt',
    loadMessages.indexOf('allMessages = [];') !== -1 &&
    loadMessages.indexOf('allMessages = [];') < loadMessages.indexOf('clearFixedErrors()'),
    'sweeping the list from before the snapshot re-reads rows that may already be gone');

  console.log('');
  console.log('=== A fault that has been fixed clears its own reports ===');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch(err => {
  console.log('');
  console.log('  FAIL  the sweep checks crashed: ' + (err && err.stack || err));
  console.log('');
  console.log(passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
