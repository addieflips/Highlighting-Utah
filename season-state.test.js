/*
 * Where each RSVP answer ends up — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * The owner asked, 2026-08-22, in as many words: "back next year will go to 2027
 * right? And won't go to recycle or be approved for this year?", then "yeah a no
 * or cancel should show in recycle. yes if someone moves theyll get requoted for
 * new house.", and then, correcting the last thing I told her: "someones that says
 * no should go to recycle. But they can change there decisions to Yes or back next
 * year and it will update."
 *
 * ⭐ THAT LAST ONE REVERSED A DECISION FROM 2026-08-15, deliberately. Until then an
 * RSVP of "no" kept somebody out only while their bundle was queued to be taken
 * apart — and the warehouse CLEARS that flag when the job is done, so "no" lasted
 * exactly as long as the warehouse queue and the customer silently rejoined the
 * season a week later having never changed their mind. The answer decides now; the
 * flag only ever backed it up. Two rows below exist for that alone.
 *
 * Those are four sentences describing ONE table: for each thing a customer can
 * say, which of five lists do they land on. Answering it took running five
 * predicates by hand, and it turned up SIX places that had the answer wrong —
 * every one of them reading `d.maybeNextYear` while portalRsvp writes the STATUS
 * alone. The table is the thing worth freezing, not any one of the predicates.
 *
 * R-018 says not to add checks to run-all.js, so this follows the pattern the
 * other gates use — one file, one job, wired into `npm test`.
 *
 * ⚠ IT RUNS THE REAL PREDICATES, lifted out of admin.html, never a local copy.
 * The whole failure this exists to catch is two places answering "is this
 * customer in the season" differently, so a second opinion written here would
 * agree with itself and prove nothing.
 *
 * ⚠ AND IT CHECKS THE WRITERS AS WELL AS THE LISTS. A recycle queue that reads
 * needsLightRecycle correctly is worth nothing if nothing ever sets the flag —
 * that is the same shape as the Contact 2027 tab reading a field nobody wrote,
 * which shipped and stayed broken because only the reader was tested.
 *
 * Run:  node season-state.test.js      (or: npm run test:season)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lifts a function by name, brace-free: the file uses one-tab-stop closing
   braces at column 0, which every other harness in this repo relies on too.
   Missing means FAIL loudly, never skip — a gate that cannot find its target
   must not report green. */
function fn(name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = admin.indexOf(opener);
    if (at === -1) continue;
    return admin.slice(at, admin.indexOf('\n}', at) + 2);
  }
  return '';
}

const NEEDED = ['isOutForSeason', 'whBuildQueueGroups', 'whRecycleGroups', 'whHouseBuildStatus'];
const src = {};
let missing = false;
NEEDED.forEach(n => {
  src[n] = fn(n);
  const ok = !!src[n];
  check('admin.html still has ' + n + '()', ok, ok ? '' : 'renamed or removed');
  if (!ok) missing = true;
});

const eligLine = (admin.match(/const SEASON_ELIGIBILITY = '[^']*';/) || [])[0] || '';
check('the season setting is still one line', !!eligLine,
  'isOutForSeason cannot be run without it');

const tabsSrc = (admin.match(/const HLX_STATE_TABS = \[[\s\S]*?\n\];/) || [])[0] || '';
check('the Excel tab table is still there', !!tabsSrc);

if (missing || !eligLine || !tabsSrc) {
  console.log('\n=== Where each RSVP answer ends up ===\n');
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The five lists, each answered by the code that really answers it
// ---------------------------------------------------------------------------
const TABS = new Function(tabsSrc + 'return HLX_STATE_TABS;')();
const holds = (tab, d) => TABS.filter(t => t.tab === tab).map(t => t.holds(d))[0] === true;

const outForSeason = new Function('d', eligLine + src.isOutForSeason + 'return isOutForSeason(d);');

const groupKey = (p, w) => (p || '') + '|' + (w || '');
const bundleStub = () => ({ bundles: 1, estimated: false, topUp: false });

const buildQueue = (d) => new Function('jobAddresses', 'warehouseExtras', 'whGroupKey',
  'houseBundleNeed', eligLine + src.isOutForSeason + src.whBuildQueueGroups +
  'return whBuildQueueGroups();')([{ id: 'x', data: d }], [], groupKey, bundleStub);

const onBuildQueue = (d) => {
  const r = buildQueue(d);
  return r.keys.length > 0 || (r.blocked || []).length > 0;
};

const onRecycleQueue = (d, archived) => new Function('jobAddresses', 'whArchivedPending',
  'whGroupKey', src.whRecycleGroups + 'return whRecycleGroups();')(
  d ? [{ id: 'x', data: d }] : [], archived || [], groupKey).keys.length > 0;

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------
const answered = new Date('2026-09-01T00:00:00Z');
const withLights = { name: 'X', lightsDescription: 'Warm White', wireColor: 'White',
                     measuredFeet: 200, rsvpRespondedAt: answered };
const CASES = [
  /* ⚠ THE PORTAL SHAPE IS THE ONE THAT WAS BROKEN, and it is most of them: it is
     what the RSVP email's own button produces. No maybeNextYear flag anywhere. */
  { name: 'Back Next Year, answered through the RSVP link',
    d: Object.assign({}, withLights, { rsvpStatus: 'backnextyear', needsLightBuild: true }),
    want: { tab2027: true, tabYes: false, inSeason: false, build: false, recycle: false } },
  { name: 'Back Next Year, badged by the office',
    d: Object.assign({}, withLights, { maybeNextYear: true, rsvpStatus: 'backnextyear' }),
    want: { tab2027: true, tabYes: false, inSeason: false, build: false, recycle: false } },
  /* ⭐ Owner, 2026-08-22: "a no or cancel should show in recycle." Both writers set
     needsLightRecycle, which is what that queue reads. */
  { name: 'No, answered through the RSVP link',
    d: Object.assign({}, withLights, { rsvpStatus: 'no', needsLightRecycle: true,
                                       needsLightBuild: true }),
    want: { tab2027: false, tabYes: false, inSeason: false, build: false, recycle: true } },
  { name: 'No, set on the office dropdown',
    d: Object.assign({}, withLights, { rsvpStatus: 'no', needsLightRecycle: true }),
    want: { tab2027: false, tabYes: false, inSeason: false, build: false, recycle: true } },
  /* ⭐ THE CASE THE OWNER CORRECTED, 2026-08-22: "someones that says no should go to
     recycle. But they can change there decisions to Yes or back next year and it will
     update." Until then, out-for-the-season leaned on needsLightRecycle — which the
     warehouse CLEARS the moment the job is done. So "no" lasted exactly as long as
     the warehouse queue, and the customer silently rejoined the season a week later
     having never changed their mind. They are off the recycle list here because the
     lights have already come back; they are still out of the season because that is
     what they said. */
  { name: 'No — and the warehouse has finished the recycle',
    d: Object.assign({}, withLights, { rsvpStatus: 'no', needsLightRecycle: false }),
    want: { tab2027: false, tabYes: false, inSeason: false, build: false, recycle: false } },
  /* ⚠ AND THE WAY BACK IN. Nothing about "no" is sticky — every route that takes a new
     answer rewrites rsvpStatus, so this is the same record after they change their
     mind. If this row ever fails, a customer cannot rejoin the season by answering. */
  { name: 'No, then changed their mind to Yes',
    d: Object.assign({}, withLights, { rsvpStatus: 'yes', needsLightRecycle: false,
                                       needsLightBuild: true }),
    want: { tab2027: false, tabYes: true, inSeason: true, build: true, recycle: false } },
  { name: 'No, then changed their mind to Back Next Year',
    d: Object.assign({}, withLights, { rsvpStatus: 'backnextyear', needsLightRecycle: false }),
    want: { tab2027: true, tabYes: false, inSeason: false, build: false, recycle: false } },
  /* ⭐ Owner: "yes if someone moves theyll get requoted for new house." The old set
     comes back AND a new one is built, and they never leave the season — which is
     exactly why recycleKeepingCustomer had to be its own flag. */
  { name: 'Moved — re-quote applied, recycle old and build new',
    d: Object.assign({}, withLights, { rsvpStatus: 'yes', needsLightRecycle: true,
                                       recycleKeepingCustomer: true, needsLightBuild: true }),
    want: { tab2027: false, tabYes: true, inSeason: true, build: true, recycle: true } },
  { name: 'An ordinary customer, for contrast',
    d: Object.assign({}, withLights, { rsvpStatus: 'yes', needsLightBuild: true }),
    want: { tab2027: false, tabYes: true, inSeason: true, build: true, recycle: false } }
];

const COLS = [
  ['tab2027',  'Contact 2027', (d) => holds('Contact 2027', d)],
  ['tabYes',   'Yes tab',      (d) => holds('Yes', d)],
  ['inSeason', 'in season',    (d) => !outForSeason(d)],
  ['build',    'build queue',  onBuildQueue],
  ['recycle',  'recycle queue', (d) => onRecycleQueue(d)]
];

const rows = [];
CASES.forEach(c => {
  const got = {};
  COLS.forEach(([k, , f]) => { got[k] = f(c.d) === true; });
  rows.push([c.name, got]);
  COLS.forEach(([k, label]) => {
    check(c.name + ' → ' + label, got[k] === c.want[k],
      'expected ' + (c.want[k] ? 'YES' : 'no') + ', got ' + (got[k] ? 'YES' : 'no'));
  });
});

/* ⚠ SOMEBODY THE OFFICE REMOVED ALTOGETHER — the "cancel" half of her sentence.
   They are not a customer any more, which is exactly why they are on this list:
   their lights are still out there. The archive row nests the record one level
   down, and reading only the flat shape is a bug this repo has already had. */
check('A cancelled customer, removed to the archive → recycle queue',
  onRecycleQueue(null, [{ id: 'a', data: { customer: { name: 'Cancelled',
    customerNumber: '412', lightsDescription: 'Warm White', wireColor: 'White' } } }]),
  'they are not a customer any more, and their lights have not come back yet');

// ---------------------------------------------------------------------------
// The writers — a list that reads the right flag is worth nothing if nothing sets it
// ---------------------------------------------------------------------------
const portalRsvpAt = server.indexOf('exports.portalRsvp');
const portalRsvp = portalRsvpAt === -1 ? ''
  : server.slice(portalRsvpAt, server.indexOf('\n});', portalRsvpAt));
check('functions/index.js still has portalRsvp', !!portalRsvp);

/* ⚠ SCOPED TO THE `updates` OBJECT, not the whole function. portalRsvp also RETURNS
   `rsvpStatus: response` to the browser, so a loose search for that text passes while
   the write itself is broken — which a red-check proved: renaming the written field
   left every check here green. The write is the only half that matters. */
const updAt = portalRsvp.indexOf('const updates = {');
const updates = updAt === -1 ? '' : portalRsvp.slice(updAt, portalRsvp.indexOf('};', updAt));
check('portalRsvp still has an updates object to read', !!updates,
  'without it the three checks below would silently pass against the return value');

if (portalRsvp && updates) {
  /* ⭐ THIS IS THE LINE THE WHOLE THING TURNS ON. "no" queues the recycle; back next
     year does not, because their bundle is staying in their bin for next season. */
  check('portalRsvp queues the recycle for a "no" and only for a "no"',
    /needsLightRecycle: response === 'no'/.test(updates),
    'a queue reading the flag correctly is worth nothing if nothing sets it');
  /* ⚠ AND IT WRITES THE STATUS ALONE. This is not a defect to fix — the flag is what
     the OFFICE sets and sees, and writing it from a customer's own answer would badge
     them Maybe Next Year without anybody choosing to. It is recorded here so that if
     it ever changes, the comments in admin.html that explain why isOutForSeason reads
     BOTH get revisited rather than quietly going stale. */
  check('and portalRsvp writes the status without the office flag',
    /rsvpStatus: response,/.test(updates) && !/maybeNextYear/.test(portalRsvp),
    'if this changes, the reasoning in isOutForSeason needs rewriting');
}

const saveAt = admin.indexOf("const oldRsvpForRecycle");
const saveBlk = saveAt === -1 ? '' : admin.slice(saveAt, saveAt + 4000);
check('the office dropdown queues the recycle on a change to "no"',
  /newRsvp === 'no' && oldRsvpForRecycle !== 'no'[\s\S]{0,120}needsLightRecycle = true/.test(saveBlk),
  'the two ways of saying no have to reach the same queue');
/* ⚠ ON THE CHANGE, NOT ON EVERY SAVE. Re-deriving it each time put a customer whose
   recycle was long finished straight back in the queue with no lights left to pull,
   months later, because somebody fixed their phone number. */
check('and only on the change, not on every save of that record',
  /oldRsvpForRecycle !== 'no'/.test(saveBlk),
  'once the job is under way the warehouse owns the flag');

/* ⭐ AND THE WAY BACK IN IS REAL, not just possible in principle. Owner: "they can
   change there decisions to Yes or back next year and it will update." portalRsvp
   writes whatever they answered, and a "yes" from somebody whose set was already
   pulled apart re-queues the build rather than sending a crew to an empty bin. */
if (portalRsvp && updates) {
  check('portalRsvp writes whatever they now say, so no is never sticky',
    /rsvpStatus: response,/.test(updates),
    'a customer who cannot change their mind is a customer who rings the office');
  check('and a yes after the recycle already happened re-queues the build',
    /rejoinedAfterRecycle[\s\S]{0,200}needsLightBuild = true/.test(portalRsvp),
    'their bundle was taken apart — putting them back on a route without rebuilding ' +
    'sends a crew to an empty bin');
}

/* ⭐ Back Next Year clears both queues: nothing to build, and their set stays in
   their bin. Owner: "back next year ... won't go to recycle." */
check('badging Back Next Year clears both warehouse queues',
  /rsvpStatus = 'backnextyear';[\s\S]{0,400}needsLightRecycle = false;[\s\S]{0,120}needsLightBuild = false;/
    .test(admin),
  'their bundle is staying in their bin for next season');

// ---------------------------------------------------------------------------
const w = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };
console.log('\n=== Where each RSVP answer ends up ===\n');
console.log('  ' + w('', 52) + COLS.map(c => w(c[1], 14)).join(''));
rows.forEach(([name, got]) => {
  console.log('  ' + w(name, 52) + COLS.map(c => w(got[c[0]] ? 'YES' : '\u2014', 14)).join(''));
});
console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('One of the six lists disagrees with the others about the same customer.');
  console.log('That is worse than any single one being wrong: whichever runs last wins,');
  console.log('and neither says a word. Fix the predicate, not this table.\n');
}
process.exit(fail ? 1 : 0);
