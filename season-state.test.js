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

/* ⚠ THE FILE'S OTHER LIFTER CANNOT READ A ONE-LINER. fn() slices to the next
   "\n}", which is right for a function whose closing brace sits at column 0 and
   catastrophically wrong for `function cityOf(h){return (h.city||'').trim();}` —
   that has no newline before its brace, so the slice ran on and swallowed a later
   `const CREWS`, and the sandbox died with "already declared". Four of the seven
   helpers this needs are one-liners. This counts braces instead, skipping quoted
   text so a brace inside a string cannot close the function early. */
const fnBraced = (name) => {
  const at = admin.indexOf('function ' + name + '(');
  if (at === -1) return '';
  let i = admin.indexOf('{', at), depth = 0, q = '', com = '';
  for (; i < admin.length; i++) {
    const c = admin[i], prev = admin[i - 1], next = admin[i + 1];
    /* ⚠ COMMENTS ARE SKIPPED, AND THIS FILE EARNED THE RULE (2026-09-02). An
       apostrophe inside a /* *​/ comment — "the office's own badge" — opened a string
       that never closed, so the brace counting ran on past the real end and the lift
       came back as a syntax error hundreds of lines long. Every prose comment in
       admin.html is a candidate; it only had not bitten yet because the functions
       lifted so far happened not to contain one. */
    if (com) {
      if (com === '*' && c === '*' && next === '/') { com = ''; i++; }
      else if (com === '/' && c === '\n') com = '';
      continue;
    }
    if (!q && c === '/' && next === '*') { com = '*'; i++; continue; }
    if (!q && c === '/' && next === '/') { com = '/'; i++; continue; }
    if (q) { if (c === q && prev !== '\\') q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return admin.slice(at, i + 1) + '\n'; }
  }
  return '';
};

/* ⚠ houseLightsText joined the list on 2026-08-24: the build queue and the recycle
   queue both read it now, because colours live in TWO fields and reading only
   lightsDescription put every ordinary house into the blocked block. Lifted, not
   stubbed — a stub would decide which field wins, which is the thing under test. */
const NEEDED = ['isOutForSeason', 'whBuildQueueGroups', 'whRecycleGroups', 'whHouseBuildStatus',
                'houseLightsText'];
const src = {};
let missing = false;
NEEDED.forEach(n => {
  src[n] = fn(n);
  const ok = !!src[n];
  check('admin.html still has ' + n + '()', ok, ok ? '' : 'renamed or removed');
  if (!ok) missing = true;
});

const eligLine = (admin.match(/(?:const|let) SEASON_ELIGIBILITY = '[^']*';/) || [])[0] || '';
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

/* ⚠ THE NEW-HANG EXEMPTION IS LIFTED, NOT LEFT OUT — isOutForSeason guards its call
   with typeof, so omitting it silently SKIPS the exemption instead of throwing. That
   is not theoretical: on 2026-08-26 the exemption moved from audienceIsNew to the
   wider audienceNeverAsked, this sandbox went on supplying only the old one, and the
   preview check below started counting 3 people instead of 2 — a real answer, quietly
   wrong, from a rule that was never there.
   ⚠ EVERY PIECE IS THE SHIPPED ONE. quotesCache is declared empty, which is the
   honest default: with no quotes loaded the rule falls back to the fee box exactly as
   it does in the page before the quotes listener reports. */
const audienceIsNewSrc = 'let quotesCache = [];\n' +
  (fs.readFileSync(path.join(__dirname, 'js', 'money.js'), 'utf8')
     .match(/export function enrollmentYearOf[\s\S]*?\n}/) || [''])[0].replace(/^export /, '') + '\n' +
  fn('quoteMatchAddress') + fn('isRequote') + fn('audienceIsNew') +
  fn('audienceQuoteJoinYear') + fn('audienceNeverAsked');
check('the new-hang exemption is there to lift',
  !!fn('audienceNeverAsked') && !!fn('audienceQuoteJoinYear') && !!fn('audienceIsNew'),
  'without it the confirmed-only new-hang exemption is untested, silently');
/* ⚠ AND THE RULE'S OWN GATE (2026-08-26). isOutForSeason's confirmed-only branch asks
   seasonRuleIsLive, which reads the RSVP-sent marker and the reply window — so a
   sandbox has to say WHICH of the two states it is testing rather than inheriting one.
   No marker = the rule is not live = the lenient answer, which is what the page does
   before the RSVP goes out. A send 400 days back = the window has closed = strict. */
const ruleSrc = (sentAt) =>
  'let rsvpSentAtCache = ' + sentAt + ';\n' +
  /* ⚠ THE MEASUREMENT LEVER HAS TO BE DECLARED OR THE WHOLE FILE DIES ON LINE ONE.
     seasonRuleIsLive reads it, and a sandbox that omits a name the lifted function
     READS throws a bare ReferenceError with no suite attached — the failure
     `sandboxDeps` exists to name in run-all.js, which this file does not have. It is
     always false here: nothing in a test is measuring, so the rule is simply on. */
  'let seasonRuleOffForMeasurement = ' + (sentAt === 'null' ? 'true' : 'false') + ';\n' +
  (admin.match(/const RSVP_REPLY_DAYS = \d+;/) || [''])[0] + '\n' +
  fn('toJsDate') + '\n' + fn('seasonRuleIsLive') + '\n';
const outForSeason = new Function('d',
  ruleSrc('null') + eligLine + audienceIsNewSrc + src.isOutForSeason +
  'return isOutForSeason(d);');
/* The strict mode the owner is aiming at, so the rule is proved before it is live. */
const outStrict = new Function('d',
  /* ⚠ NOTHING IS SET HERE ANY MORE. The mode was a `let` that a sandbox could flip;
     since 2026-08-27 it is a const and the send marker above is the whole of what makes
     the rule live. Assigning it would now throw. */
  ruleSrc('new Date(Date.now() - 400*86400000)') +
  eligLine + audienceIsNewSrc + src.isOutForSeason +
  'return isOutForSeason(d);');

const groupKey = (p, w) => (p || '') + '|' + (w || '');
const bundleStub = () => ({ bundles: 1, estimated: false, topUp: false });

const buildQueue = (d) => new Function('jobAddresses', 'warehouseExtras', 'whGroupKey',
  'houseBundleNeed', ruleSrc('null') + eligLine + src.houseLightsText + src.isOutForSeason + src.whBuildQueueGroups +
  'return whBuildQueueGroups();')([{ id: 'x', data: d }], [], groupKey, bundleStub);

const onBuildQueue = (d) => {
  const r = buildQueue(d);
  return r.keys.length > 0 || (r.blocked || []).length > 0;
};

const onRecycleQueue = (d, archived) => new Function('jobAddresses', 'whArchivedPending',
  'whGroupKey', src.houseLightsText + src.whRecycleGroups + 'return whRecycleGroups();')(
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

/* ⭐ ONE ANSWER FOR A YES, THREE DOORS (2026-08-22). The RSVP link, the office
   dropdown and approving a quote all mean the same thing, and seasonYesUpdates is the
   one place that says what a yes does. RUN, not read: a yes that only sets the status
   leaves the warehouse still queued to take their bundle apart, and that is a fact
   about behaviour, not about text. */
/* ⭐ ONE LIFTER FOR THE SERVER FILE (2026-08-28). Three sandboxes in this repo lift
   seasonYesUpdates, and adding one helper call inside it broke them one at a time — the
   "five sandboxes broke, one after another" pattern CLAUDE.md records. Defined once so
   the next dependency is one edit, not a hunt through failing suites. */
function liftServerFn(name) {
  const at = server.indexOf('function ' + name + '(');
  if (at === -1) return '';
  let d = 0, k = server.indexOf('{', at);
  for (; k < server.length; k++) {
    if (server[k] === '{') d++;
    else if (server[k] === '}') { d--; if (!d) break; }
  }
  return server.slice(at, k + 1) + '\n';
}
const yesAt = server.indexOf('function seasonYesUpdates');
const yesSrc = yesAt === -1 ? '' : server.slice(yesAt, server.indexOf('\n}', yesAt) + 2);
check('the server has one rule for what a yes does', !!yesSrc,
  'three doors writing their own version is three chances for one to do half the job');

if (yesSrc) {
  const fakeAdmin = { firestore: { FieldValue: { serverTimestamp: () => 'NOW' } } };
  /* ⚠ THE TIMESTAMP IS A PARAMETER NOW (2026-08-24), so the office copy in admin.html
     and this one can be handed the same sentinel and compared. The fakeAdmin above is
     still supplied because the module reads it elsewhere; only this rule takes ts. */
  /* ⚠ THE HELPERS seasonYesUpdates CALLS ARE LIFTED, NEVER STUBBED (2026-08-28). A yes
     can re-queue a build and cancel a recycle, and both now stamp a date — so this
     sandbox has to supply those two rules or the lift dies with a bare ReferenceError
     that names neither the suite nor the missing function. It did exactly that in CI:
     `stampBuildQueuedServer is not defined`, from a change that had touched
     functions/index.js and never this file.
     ⚠ LIFTED, because a stub would keep this suite green through a change to whether a
     rejoining customer's build date is recorded at all — which is the one thing these
     checks exist to hold. §3's rule, and the reason sandboxDeps exists in run-all.js. */
  const yesDeps = liftServerFn('stampBuildQueuedServer') + liftServerFn('stampRecycleRequestedServer');
  check('the stamp rules a yes depends on could be lifted too',
    /stampBuildQueuedServer/.test(yesDeps) && /stampRecycleRequestedServer/.test(yesDeps),
    'without them the lift below dies with a ReferenceError naming neither this suite ' +
    'nor the function it wanted — which is how this failed in CI rather than locally');
  const rawYes = new Function('admin', yesDeps + yesSrc + 'return seasonYesUpdates;')(fakeAdmin);
  const yes = (d) => rawYes(d, () => 'NOW');

  check('a yes sets the status and stamps when they answered',
    yes({}).rsvpStatus === 'yes' && yes({}).rsvpRespondedAt === 'NOW');
  /* ⚠ THE HALF THAT IS EASY TO FORGET. This file's own history warns that flipping
     somebody to yes "leaves needsLightRecycle set behind them — the record then says
     two opposite things at once": in the season and queued to be taken apart. */
  check('and cancels a queued recycle, always',
    yes({ rsvpStatus: 'no', needsLightRecycle: true }).needsLightRecycle === false &&
    yes({}).needsLightRecycle === false,
    'in the season and queued to have their lights pulled apart is two opposite ' +
    'things on one record');
  /* ⚠ AND A REBUILD ONLY WHEN THE RECYCLE ACTUALLY HAPPENED. Owner: "we won\'t
     recycle till end of year so shouldn\'t be taken apart." */
  check('and re-queues the build ONLY when the recycle really happened',
    yes({ rsvpStatus: 'no', needsLightRecycle: false }).needsLightBuild === true &&
    yes({ rsvpStatus: 'no', needsLightRecycle: true }).needsLightBuild === undefined,
    'their set is still in the bin mid-season — a build makes a second one');
  check('and marks a rejoiner from EITHER way out',
    !!yes({ rsvpStatus: 'no' }).needsDayAssignedAt &&
    !!yes({ rsvpStatus: 'backnextyear' }).needsDayAssignedAt &&
    !!yes({ maybeNextYear: true }).needsDayAssignedAt,
    'they are different states — one recycles, one does not — but coming back from ' +
    'either is the same event');
  check('and writes the record the badge reads, not just the instruction',
    !!yes({ rsvpStatus: 'no' }).cameBackThisSeasonAt,
    'the instruction clears the moment they are scheduled — a badge reading it ' +
    'would vanish exactly when it started being true');
  /* ⚠ SOMEBODY WHO NEVER LEFT IS NOT A REJOINER. Marking every yes would badge the
     whole book and hand the placer the entire customer list. */
  check('but somebody who never said otherwise is not marked',
    yes({ rsvpStatus: '' }).needsDayAssignedAt === undefined &&
    yes({ rsvpStatus: 'yes' }).cameBackThisSeasonAt === undefined,
    'a badge everybody has is a badge nobody reads');
  /* ⭐ AND IT CLEARS THE MAYBE NEXT YEAR BADGE (changed 2026-08-22). Owner: "we
     shouldn't have to clear a badge to get someone updated. That badge should update
     once they approve it."

     ⚠ THIS CHECK USED TO ASSERT THE OPPOSITE — that the badge was the office's alone
     and a customer's click must never touch it. Kept as history because the argument
     is worth reading and was answering the wrong question: the badge does not record
     an opinion the office holds ABOUT them, it records what they SAID, and the office
     set it from what it had been told at the time. A newer answer from the customer
     supersedes an older one taken on their behalf. Left standing, somebody who had
     actively re-committed sat out the season until a human noticed. */
  check('and it clears the Maybe Next Year badge, so nobody has to',
    yes({ maybeNextYear: true }).maybeNextYear === false,
    'a customer who has re-committed should not wait for somebody to notice a badge');
  /* ⚠ AND THE DATE GOES WITH IT. Left behind, a customer reads as not-sitting-out
     with a date stamped for when they were — the same pair the office's own un-toggle
     clears in one write. */
  check('and the date the badge was raised goes with it',
    yes({ maybeNextYear: true }).maybeNextYearAt === null,
    'not-sitting-out with a sitting-out date on it is two answers on one record');
  /* ⚠ AND UNCONDITIONALLY, WHICH REVERSES A NARROWER VERSION OF THIS CHECK. It used
     to assert the badge was left alone when none was set, on the reasoning that
     writing false onto ~960 records is a decision written where none was made. A
     parallel session proved that wrong from the other end on the same day: the RSVP
     reset sweep leaves maybeNextYear standing while moving everyone to 'unanswered',
     so the flag and the status drift apart and "is there a badge to clear" stops being
     answerable from the record alone. Two fields describing one fact are written
     together, on every answer, everywhere. */
  check('and it writes the badge on every yes, not only when one is set',
    yes({ rsvpStatus: '' }).maybeNextYear === false &&
    yes({ rsvpStatus: 'no' }).maybeNextYearAt === null,
    'the reset sweep leaves the flag standing while the status moves — the two have ' +
    'to be written together or they drift');
  /* ⚠ AND AN RSVP ANSWER CLOSES THE "ask them what they want" QUESTION. Without it
     they stay on that list for ever and get mailed again after replying. */
  check('and an answer closes the ask-them-again question',
    yes({}).askSameAsLastYear === false,
    'an RSVP answer IS them telling us');

  /* ⭐ ALL THREE DOORS GO THROUGH IT. A helper nothing calls is the most expensive
     kind of green — this repo has shipped exactly that. */
  /* ⚠ MATCHED WITHOUT PINNING THE ARGUMENT LIST. Both of these used to require the
     exact call — `seasonYesUpdates(oldData)` — and both went red the moment the rule
     took a second parameter, on a change that did not touch a single door. A check
     that pins a spelling fails on a correct edit and passes a wrong one that keeps the
     words; what matters here is that the door goes THROUGH the shared rule. */
  check('the RSVP link answers a yes through it',
    /\(response === 'yes'\)\s*\n?\s*\? seasonYesUpdates\(oldData\b/.test(portalRsvp),
    'it used to be the only door that did the whole job');
  check('and approving a quote goes through it too',
    /update\(seasonYesUpdates\(memberRef\.data \|\| \{\}/.test(server),
    'owner, 2026-08-22: "go with option 2" — approving a quote is a yes now, and a ' +
    'status-only write would leave them in the season AND queued for recycle');
  /* ⭐ AND THE OFFICE DOOR, added 2026-08-24. Owner: "for old costumers that have an
     extension on house or have a new address they should be approved to once they
     approve there new quote." Marking a quote approved by hand is the same event as
     the customer clicking Approve — she takes those on the phone — and until this it
     wrote to the quote document alone, so the same approval read two different ways
     depending on which door it came in by. */
  /* ⚠ SCOPED TO THE HANDLER AND TO ITS GUARD, because a file-wide search for the call
     is vacuous: a red-check that wrapped the whole block in `if(false)` left every word
     in place and passed. What has to be true is that the write is reached WHEN THE
     OFFICE MARKS IT APPROVED — so the guard is asserted as part of the shape, and a
     constant condition fails it. */
  const mkAt = admin.indexOf("list.querySelectorAll('[data-markapproval]')");
  const mkBlk = mkAt > 0
    ? admin.slice(mkAt, admin.indexOf('});', admin.indexOf('toast(label', mkAt)))
    : '';
  check('the Mark Approved handler was found', !!mkBlk,
    'a gate that cannot find its target must FAIL, not skip');
  check('and the office marking a quote approved goes through the shared rule',
    /if\(value === 'approved'\)\{[\s\S]{0,2500}seasonYesUpdates\(cust\.data \|\| \{\}/.test(mkBlk),
    'an approval taken over the phone is still an approval — leaving it on the quote ' +
    'document alone is what left those customers Pending');
  check('and it actually writes it to their record',
    /updateDoc\(doc\(db,\s*'jobAddresses',\s*cust\.id\),\s*seasonUpdates\)/.test(mkBlk),
    'computing the updates and never writing them is a silent no-op that reads as done');
  check('and repaints the panel from the cache it just changed',
    /Object\.assign\(cust\.data,\s*seasonUpdates/.test(mkBlk),
    'the panel repaints from the cache, not from Firestore — without the mirror the ' +
    'tag springs back and the office presses it again');
  /* ⚠ AND IT FINDS THEM BY THE LINKED ID, NEVER BY THE PHONE NUMBER. 17 numbers in the
     real book are shared and 14 of those are two genuinely different households — a
     parent paying for a child's house. Joining on the phone would mark the WRONG
     household in for the season off somebody else's approval, and the two would be
     indistinguishable afterwards. Same test the server's quoteCustomerRef makes, and
     the same one showConvertQuoteChoice already makes before it diverts. */
  check('and it finds the customer by the linked id, not the phone',
    /convertedToCustomerId \|\| q\.data\.existingCustomerId/.test(mkBlk) &&
    !/seasonYesUpdates[\s\S]{0,400}\bphone\b/.test(mkBlk),
    'a shared phone number is two households, and this repo has already duplicated ' +
    'the whole book once by matching on one');
  /* ⚠ THE LATEST ANSWER STILL WINS, which she asked about specifically: yes then no
     is a no. The quote path only ever writes a yes, so a later no through the link or
     the office overrides it — there is no branch here that could pin somebody. */
  check('and nothing in it can pin somebody as a yes',
    !/rsvpStatus: response/.test(yesSrc) && yes({ rsvpStatus: 'no' }).rsvpStatus === 'yes',
    'a yes then a no must still be a no — this writes one answer, it does not lock one');
}

/* ⭐ AND THE WAY BACK IN IS REAL, not just possible in principle. Owner: "they can
   change there decisions to Yes or back next year and it will update."

   ⚠ THE YES SIDE IS PROVED ABOVE, by running seasonYesUpdates. What is left to check
   is the OTHER branch: a no and a back next year are only ever said through this door,
   and portalRsvp has to keep writing whatever they answered or nothing is sticky in
   either direction. */
if (portalRsvp) {
  check('portalRsvp writes whatever they now say, so no is never sticky',
    /rsvpStatus: response,/.test(portalRsvp),
    'a customer who cannot change their mind is a customer who rings the office');
  /* ⭐ AND THE RECYCLE IS WRITTEN PER ANSWER, NOT FROM A VARIABLE (hole G's fifth
     path, closed by a parallel session 2026-08-21). `needsLightRecycle: response ===
     'no'` reads as harmless and quietly writes FALSE for backnextyear, wiping a
     collection that was already owed: the bin stays on the shelf and nobody is ever
     told to fetch it. A yes cancels one — that lives in seasonYesUpdates. Back next
     year says nothing either way. */
  check('and a no through the link queues the recycle',
    /if \(response === 'no'\) updates\.needsLightRecycle = true;/.test(portalRsvp),
    'that is the half of the answer the warehouse acts on');
  /* ⚠ WITH COMMENTS STRIPPED. The rule is WRITTEN DOWN in the code — the note above
     that line quotes the bad expression to explain why it is gone — so a plain search
     finds the explanation and calls it a violation. This file already carries that
     lesson for Suite 58; it caught this check on its first run. */
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('and back next year neither creates one nor destroys one',
    !/needsLightRecycle: response === 'no'/.test(noComments(portalRsvp)),
    'that expression writes FALSE for backnextyear and cancels an owed collection');
}

/* ⭐ CHANGING YOUR MIND BEFORE THE RECYCLE HAS HAPPENED (added 2026-08-22). Owner:
   "we won't recycle till end of year so shouldn't be taken apart."

   ⚠ THAT MAKES THE MID-SEASON CASE THE NORMAL ONE, and it was the one case this
   table did not cover. Somebody says no in September, changes their mind in October:
   the warehouse has not been near their bin, so there is nothing to rebuild and
   queueing a build would have the warehouse make a SECOND set for a house that
   already has one sitting on the shelf under its own number.

   ⚠ AND THE OTHER DIRECTION IS JUST AS WRONG. Once the recycle really has happened —
   at year end — the bundle is gone, and putting them back on a route without
   rebuilding sends a crew to an empty bin. So the answer cannot be a flat yes or no;
   it turns on whether the flag is still standing.

   ⚠ THE RULE IS WRITTEN TWICE, so both copies are run here against the same records.
   The office dropdown and the portal disagreeing about this means one of the two
   builds a set nobody needs, or skips one somebody does. */
{
  /* ⚠ LIFTED BY SHAPE, NOT BY EXACT TEXT — and that distinction was worth catching.
     The first version matched both assignments character for character, which meant
     ANY rewrite failed the lift before a single behavioural check ran: four sabotages
     all "passed" on the presence check alone, and the checks below were never
     exercised. Matching the assignment and running whatever expression it holds is
     what makes a WRONG rewrite fail on its answers rather than on its spelling. */
  const grab = (src, name) => {
    const m = src.match(new RegExp('const ' + name + ' = ([^;]+);'));
    return m ? m[1] : null;
  };
  const wasNoExpr = grab(server, 'wasNo');
  const svrExpr = grab(server, 'rejoinedAfterRecycle');
  const offExpr = grab(admin, 'rejoinedAfterRecycle');
  check('the server still decides a rejoin, under that name',
    !!wasNoExpr && !!svrExpr,
    'renaming it means nothing runs this rule through a test again');
  check('and the office dropdown has its own copy of the same decision',
    !!offExpr, 'the two copies are what this section exists to compare');

  if (svrExpr && offExpr && wasNoExpr) {
    const svr = new Function('oldData', 'response',
      'const wasNo = ' + wasNoExpr + '; return ' + svrExpr + ';');
    const off = new Function('item', 'newRsvp',
      "const oldRsvpForRecycle = String(item.data.rsvpStatus || '').toLowerCase(); " +
      'return ' + offExpr + ';');
    const both = (old, next) => {
      const a = svr(old, next), b = off({ data: old }, next);
      return { a: a, b: b, agree: a === b };
    };

    const midSeason = both({ rsvpStatus: 'no', needsLightRecycle: true }, 'yes');
    check('a no changed back to yes BEFORE year end queues no rebuild',
      midSeason.a === false && midSeason.agree,
      'the warehouse has not been near their bin — a rebuild makes a second set ' +
      'for a house whose lights are already on the shelf');

    const afterRecycle = both({ rsvpStatus: 'no', needsLightRecycle: false }, 'yes');
    check('but once the recycle really has happened, it does',
      afterRecycle.a === true && afterRecycle.agree,
      'their bundle is gone — putting them on a route without rebuilding sends a ' +
      'crew to an empty bin');

    /* ⚠ AND NEITHER OF THE OTHER ANSWERS REBUILDS. Back Next Year keeps their set in
       their bin, and somebody who never said no has nothing to rejoin. */
    check('and nothing else triggers a rebuild',
      both({ rsvpStatus: 'no', needsLightRecycle: true }, 'backnextyear').a === false &&
      both({ rsvpStatus: '', needsLightRecycle: false }, 'yes').a === false &&
      both({ rsvpStatus: 'yes', needsLightRecycle: false }, 'yes').a === false);

    check('the office and the portal agree on every one of them',
      [['no', true], ['no', false], ['', false], ['yes', false], ['backnextyear', false]]
        .every(([st, fl]) => ['yes', 'no', 'backnextyear']
          .every(next => both({ rsvpStatus: st, needsLightRecycle: fl }, next).agree)),
      'one of the two would build a set nobody needs, or skip one somebody does');
  }
}

/* ⭐ COMING BACK IN EARNS THE NEXT SLOT GOING (added 2026-08-22). Owner: "The ones
   that are marked as a yes after saying no should be scheduled at next available time
   for schedule for crews", and "Same with saying yes after pressing back next year."

   ⚠ SAYING NO OR BACK NEXT YEAR TAKES THEM OFF THE PLAN, and until this was built,
   saying yes again put them back in the SEASON without putting them back on a DAY —
   the only route onto one was somebody pressing Recalculate everything. The screen
   said they were in the season the whole time, which is the worst version of it.

   ⚠ BOTH WRITERS HAVE TO STAMP IT. The RSVP link is one route in; an answer taken
   over the phone and typed into Edit Customer is the other, and is how most of these
   will actually arrive. A flag written by only one of them works in testing and
   silently does nothing for half the real cases. */
{
  /* ⚠ THE THREE CHECKS THAT USED TO SIT HERE read portalRsvp's own inline `updates`
     literal — that it stamped the rejoin flag, that it wrote the durable record
     beside it, and that it counted both ways out. All three moved into
     seasonYesUpdates on 2026-08-22 and are asserted above by RUNNING it, which is
     both stronger and no longer tied to one door's spelling. */
  /* ⚠ AND THE BADGE IS DRAWN WHERE THE OFFICE ACTUALLY LOOKS. A record nothing
     renders is the invisible marker all over again. Three surfaces, one helper —
     three hand-written copies is how one of them quietly stops matching. */
  check('one helper answers "did they change their mind"',
    !!fn('cameBackThisSeason') && !!fn('cameBackBadge'),
    'three screens drawing it by hand is three chances to disagree');
  check('and it reads the RECORD, falling back to the instruction',
    /cameBackThisSeasonAt \|\| d\.needsDayAssignedAt/.test(admin),
    'reading only the instruction makes the badge vanish once they are scheduled; ' +
    'the fallback is what covers somebody stamped before this existed');
  check('the customer row shows it beside the RSVP pill',
    /rsvpPill \+ backPill/.test(admin) && /const backPill = cameBackBadge\(d\)/.test(admin),
    'built and never rendered is the bug this whole change exists to fix');
  check('the RSVP panel row shows it too',
    /statusLabel\+'<\/span>'\+cameBackBadge\(d\)/.test(admin),
    'that panel is where the office reads RSVP state');
  /* ⚠ AND IT CAN BE SEARCHED. Same rule the soft-lights filter was built under:
     keeping a label without a way to list everybody who has it is a label, not a
     list. */
  /* ⚠ AND IT IS A FILTER, NOT A SIXTH STAT CARD. The five cards PARTITION the book —
     every customer is in exactly one and they sum to the total. Everybody who changed
     their mind is also a Yes, so as a card it stopped the numbers adding up, and a
     tally that does not add up looks broken whichever number you check. It belongs
     with Gate Code and Payment, which cut across the states the same way. */
  check('and there is a filter to list all of them',
    /id="dashRsvpFilterCameBack"/.test(admin) &&
    /dashRsvpFilterCameBack === 'yes'\) activeList = activeList\.filter\(a => cameBackThisSeason\(a\.data\)\)/.test(admin),
    'a badge you cannot filter by means opening every customer to find them');
  check('and that dropdown is actually listened to',
    /getElementById\('dashRsvpFilterCameBack'\)\.addEventListener\('change'/.test(admin),
    'a select that renders and does nothing when used is worse than not offering one');
  check('and it is NOT a sixth stat card',
    !/key:'cameback'/.test(admin),
    'the five cards partition the book and must keep summing to the total');
  /* ⚠ AND THE WORDING CANNOT BE READ AS "next season". The owner read "Came back in"
     as somebody returning NEXT year — which is Back Next Year, the opposite state and
     the one thing this badge must never be confused with. */
  check('the badge says "Changed to Yes", which can only mean one thing',
    /Changed to Yes<\/span>/.test(admin) && !/Came back in<\/span>/.test(admin),
    '"came back" reads as next season, which is the opposite state');
  /* ⚠ REPOINTED 2026-09-01, NOT WEAKENED — and NOT by raising the number, which would
     re-arm the same trap for whoever adds the next field. This asserted
     `needsDayAssignedAt: null,[\s\S]{0,400}cameBackThisSeasonAt: null` — a fixed-length
     character window, which §7 of CLAUDE.md bans by name precisely because it goes stale
     as the real code grows and turns a true pass into a false FAIL. Adding one more
     season-scoped field to that write (arrearsPaidNoticeAt) pushed the two apart and
     failed a check about code that was right.

     The guarantee was never "within 400 characters of each other" — it is "both cleared
     in the SAME write", so the write is sliced and both are asserted to be in it. */
  const custResetAt = admin.indexOf("return updateDoc(doc(db,'jobAddresses', a.id), {");
  const custReset = custResetAt === -1 ? ''
    : admin.slice(custResetAt, admin.indexOf('seasonResetAt: serverTimestamp()', custResetAt));
  check('the customer half of Start New Season was found at all',
    custReset.length > 0 && /completed: false/.test(custReset),
    'a check that cannot find its target reports green for the worst possible reason');
  check('and Start New Season clears the record as well as the instruction',
    /needsDayAssignedAt: null,/.test(custReset) && /cameBackThisSeasonAt: null,?/.test(custReset),
    'a badge that survives the reset says they changed their mind this year when ' +
    'they did it last year');

  check('and the office dropdown stamps BOTH fields too',
    /newRsvp === 'yes' && \(oldRsvpForRecycle === 'no' \|\| oldRsvpForRecycle === 'backnextyear'/
      .test(admin) && /addrUpdates\.needsDayAssignedAt = serverTimestamp\(\);[\s\S]{0,120}addrUpdates\.cameBackThisSeasonAt = serverTimestamp\(\);/.test(admin),
    'an answer taken over the phone is how most of these will arrive, and it has to ' +
    'raise the badge as well as the instruction');

  /* ⚠ AND IT IS A ONE-SHOT INSTRUCTION, NOT A LABEL. Left standing it would fire
     again after Start New Season — when everybody is off the plan — and drop the
     whole book onto the earliest days one at a time instead of letting the builder
     lay the season out by town. */
  const placer = fn('placeUnscheduledOnNextDay');
  check('the planner has a placer to run', !!placer);
  /* ⚠ BOTH HALVES, and this file has been bitten before by matching only one: the
     flag is cleared in the LOCAL cache and in Firestore, and a check that finds
     either one alone stays green with the other deleted. The mirror is what stops a
     second pass in the same session double-placing them while the write is still in
     flight; the write is what stops it surviving a reload. */
  check('and it clears the flag once they have a day — in the cache AND in Firestore',
    /d\.needsDayAssignedAt = null;/.test(placer) &&
    /updateDoc\([\s\S]{0,120}\{needsDayAssignedAt: null, rejoinedForSeasonAt: null\}\)/.test(placer),
    'an instruction that is never withdrawn is a label, and this one would empty ' +
    'the whole book onto the first days of next season');
  check('and Start New Season clears it in the same write as the rest of the reset',
    /chargeNewMemberFee: false,[\s\S]{0,600}needsDayAssignedAt: null/.test(admin),
    'a separate write can fail on its own and carry the flag into the new season');
  check('it never places somebody who is out for the season',
    /isOutForSeason\(d\)\) return;/.test(placer),
    'the flag can outlive the answer — somebody who rejoined and then said no again ' +
    'must not be scheduled off a stale instruction');
  check('and never places somebody already on the plan',
    /have\.has\(item\.id\)\) return;/.test(placer),
    'a second day for one house is a crew sent to a house another crew already did');
  /* ⚠ NEVER FORCES A DAY. nextInstallDayFor returns null rather than crowding one. */
  check('and reports anybody no day can take, rather than crowding one',
    /if\(!target\)\{ stuck\.push/.test(placer),
    'owner, 2026-08-20: "we should never have a day with 5 towns no exceptions"');

  /* ⭐ AND SOMETHING ACTUALLY CALLS IT. Owner has asked for this class of check by
     name: "just make sure that if i click a button the function that is supposed to
     happen actually does." A red-check proved it was missing — the placer could be
     unhooked from the sync entirely and every other check here stayed green, because
     they all read the function rather than its caller. A feature nothing runs is the
     most expensive kind of green. */
  const syncAt = admin.indexOf('window.scheduleSyncFromCustomers=function');
  const sync = syncAt === -1 ? '' : admin.slice(syncAt, admin.indexOf('\n  };', syncAt));
  check('the periodic sync is still findable', !!sync,
    'without it nothing below can prove the placer is wired to anything');
  check('and the sync actually runs the placer',
    /rejoin=placeUnscheduledOnNextDay\(\)/.test(sync),
    'unhooked, every other check in this section still passes and no rejoiner is ' +
    'ever scheduled');
  /* ⚠ BEFORE THE TIMING SWEEP, so a house placed this tick is held to its own
     timing in the same pass rather than sitting on a wrong day until the next one. */
  check('and runs it BEFORE the timing sweep',
    sync.indexOf('placeUnscheduledOnNextDay()') < sync.indexOf('enforceInstallTiming()'),
    'placed after it, a rejoiner waits five minutes to be checked against their ' +
    'own install timing');
  /* ⚠ AND A THROW IN IT CANNOT TAKE THE SYNC DOWN, same as the two beside it. */
  check('and a failure in it cannot take the sync down',
    /try\{ rejoin=placeUnscheduledOnNextDay\(\); \}catch/.test(sync),
    'the town sync and the timing sweep either side of it are both wrapped');

  /* ⭐ AND A BRAND-NEW CUSTOMER IS STAMPED THE SAME WAY (added 2026-08-22). Owner:
     "The new costumer should be assigned to and scheduled our right away when we'll be
     in that city."

     ⚠ THE ONLY ROUTE ONTO A DAY USED TO BE ⚙ Recalculate everything, so a customer
     converted this afternoon sat on no day until somebody pressed it. The instruction
     field is the same one a rejoiner gets — which is why it is no longer called
     rejoinedForSeasonAt; a field named for one of its two callers is a name that goes
     stale the moment the second one arrives. */
  /* ⚠ ANCHORED ON newAddrRef, WHICH IS UNIQUE. Six places call
     addDoc(collection(db,'jobAddresses')) — test records, the bulk tools — and slicing
     from the first one lands in a different writer entirely. That is how a check ends
     up reporting a failure that is not there; it did, on the first run. */
  const addAt = admin.indexOf('newAddrRef = await addDoc');
  check('the Add Customer write is findable', addAt !== -1,
    'renamed — retarget this rather than deleting it');
  const addCust = addAt === -1 ? '' : admin.slice(addAt, addAt + 8000);
  check('creating a customer asks for a day straight away',
    /needsDayAssignedAt: serverTimestamp\(\)/.test(addCust),
    'without it a converted quote waits for a button press to reach the schedule');
  /* ⚠ AND THE OLD NAME IS STILL READ. The field was rejoinedForSeasonAt for a few
     hours before new customers started using it; anything stamped in that window still
     has to be placed. A rename that silently strands records is worse than a bad name. */
  check('and the placer still honours anything stamped under the old name',
    /!d\.needsDayAssignedAt && !d\.rejoinedForSeasonAt/.test(placer),
    'a rename that strands live records is worse than the name it fixed');
  check('and Start New Season clears both names',
    /needsDayAssignedAt: null,[\s\S]{0,80}rejoinedForSeasonAt: null,/.test(admin),
    'a stale instruction under either name would dribble the book onto the first days');
  /* ⚠ "WHEN WE'LL BE IN THAT CITY" IS THE WHOLE REQUEST, and it is the picker's first
     preference — asserted below with the rest of nextInstallDayFor. */

  /* ⭐ ONE RULE FOR WHICH DAY. The timing sweep and the placer run minutes apart on
     the same timer; two copies of "which day can take this house" is two answers. */
  const picker = fn('nextInstallDayFor');
  const sweep = fn('enforceInstallTiming');
  check('the day-picker is shared, not copied', !!picker &&
    /nextInstallDayFor\(h\)/.test(placer) && /nextInstallDayFor\(h, \{exclude: day\}\)/.test(sweep),
    'the timing sweep and the placer must not disagree about which day is available');
  /* ⚠ AND IT NEVER DROPS A HOUSE ONTO A PRINTED SHEET. This was a real gap in the
     timing sweep: it could move a house onto a day inside the 48-hour lock — a stop
     appearing on a sheet already printed and a van already loaded. */
  check('and it refuses a day inside the 48-hour lock',
    /routeDayIsLocked\(ts\)\) return false;/.test(picker),
    'every other writer in the planner honours that lock; this was the one that did not');
  check('and it still prefers a day already working their town',
    /extractCleanCity\(x\.city\) === town/.test(picker) &&
    picker.indexOf('sameTown || roomy') !== -1,
    'the crew is driving there anyway — and a stray house in a town nobody is ' +
    'visiting is the thing the town rules exist to prevent');
}

/* ⭐ BACK NEXT YEAR CLEARS THE BUILD AND LEAVES THE RECYCLE ALONE (corrected
   2026-08-22 by the merge with hole G).

   ⚠ THIS CHECK ASSERTED THE BUG. It required the office badge path to write
   `needsLightRecycle = false`, which is exactly what a parallel session removed the
   day before: "do not create one" and "write false" are not the same thing, and the
   unconditional false silently CANCELLED a collection that was already owed. Somebody
   answers no — the warehouse is queued to fetch their bin — then changes to Back Next
   Year, and the flag is wiped with nothing on any screen to say why. A set of lights
   lost for a year.

   The owner's "back next year won't go to recycle" is still honoured: that path does
   not CREATE one. It just no longer destroys one that was already owed. */
check('badging Back Next Year clears the build but not the recycle',
  /rsvpStatus = 'backnextyear';[\s\S]{0,1800}needsLightBuild = false;/.test(admin) &&
  !/rsvpStatus = 'backnextyear';[\s\S]{0,1800}needsLightRecycle = false;[\s\S]{0,200}needsLightBuild = false;/.test(admin),
  'you do not build for somebody sitting the season out, and you do not cancel a ' +
  'collection that was already owed');

/* ⭐ THE TWO COPIES OF "WHAT SAYING YES DOES" MUST AGREE (added 2026-08-24).

   seasonYesUpdates exists TWICE — in admin.html for the office, and in
   functions/index.js for the RSVP link and the quote-approval email — because one
   runs as a browser module and the other on Node inside Cloud Functions, so they
   cannot share a file. That is the same trade computeInvoiceStatus makes, and it
   carries the same risk: the copy nobody is looking at drifts, and then the office
   screen and the customer's own answer disagree about whether they are in the season.

   ⚠ THIS RUNS BOTH, it does not read them. A regex over two function bodies proves
   the words match, which is a weaker claim than the answers matching — and the whole
   failure this guards against is two implementations of one rule.

   ⚠ THE TIMESTAMP IS HANDED IN so both copies can be given the same sentinel. Without
   that, every comparison fails on two different clock objects and the check would have
   to ignore the very fields it is checking got written. */
{
  const bSrc = fn('seasonYesUpdates');
  const sAt = server.indexOf('function seasonYesUpdates(');
  const sSrc = sAt === -1 ? '' : server.slice(sAt, server.indexOf('\n}', sAt) + 2);
  check('the season-yes rule exists on both sides', !!bSrc && !!sSrc,
    'a rename that finds only one copy must FAIL, never skip — a gate that cannot ' +
    'find its target reporting green is how a money bug shipped for a day');
  if (bSrc && sSrc) {
    /* ⚠ EACH SIDE NEEDS THE STAMP RULES IT CALLS, and they are named differently —
       stampBuildQueued in the browser, stampBuildQueuedServer on the server. Lifted from
       their own file so the parity below still compares the real rules. */
    const officeDeps = (fn('stampBuildQueued') || '') + '\n' + (fn('stampRecycleRequested') || '') + '\n';
    const srvDeps = liftServerFn('stampBuildQueuedServer') + liftServerFn('stampRecycleRequestedServer');
    const office = new Function('serverTimestamp', officeDeps + bSrc + 'return seasonYesUpdates;')(() => '<<stamp>>');
    const srv    = new Function('admin', srvDeps + sSrc + 'return seasonYesUpdates;')(
      { firestore: { FieldValue: { serverTimestamp: () => '<<stamp>>' } } });
    const TS = () => '<<stamp>>';
    /* Every shape a customer can be in when a yes arrives. The out-for-season ones
       matter most: those are the rejoiners, and they are where the two copies have
       the most to do. */
    const CASES = [
      ['never answered',            {}],
      ['already yes',               { rsvpStatus: 'yes', rsvpRespondedAt: 1 }],
      ['said no, nothing pulled',   { rsvpStatus: 'no' }],
      ['said no, recycle under way',{ rsvpStatus: 'no', needsLightRecycle: true }],
      ['back next year',            { rsvpStatus: 'backnextyear' }],
      ['badged maybe next year',    { maybeNextYear: true }],
      ['badged AND said no',        { rsvpStatus: 'no', maybeNextYear: true }],
      ['unanswered',                { rsvpStatus: 'unanswered' }],
      ['messy casing and spaces',   { rsvpStatus: '  YES  ' }],
      ['null record',               null]
    ];
    let same = true, firstBad = '';
    CASES.forEach(([name, rec]) => {
      const a = JSON.stringify(office(rec, TS), Object.keys(office(rec, TS)).sort());
      const b = JSON.stringify(srv(rec, TS), Object.keys(srv(rec, TS)).sort());
      if (a !== b && !firstBad) { firstBad = name + ': office ' + a + ' vs server ' + b; }
      if (a !== b) same = false;
    });
    check('and the office and the server write exactly the same thing', same,
      firstBad || 'change one copy, change the other, in the same push');

    /* ⚠ AND IT IS RIGHT, NOT MERELY EQUAL. Two copies wrong in the same way agree
       perfectly, which is the one thing a parity test cannot see on its own. */
    const back = office({ rsvpStatus: 'no' }, TS);
    check('a yes over a no cancels the recycle and re-queues the build',
      back.rsvpStatus === 'yes' && back.needsLightRecycle === false &&
      back.needsLightBuild === true && !!back.needsDayAssignedAt,
      'their set was never pulled apart, so it has to be built again — and they need ' +
      'a day, or they are back in the season with nowhere to go');
    const started = office({ rsvpStatus: 'no', needsLightRecycle: true }, TS);
    check('but not when the warehouse had already started', !('needsLightBuild' in started),
      'once the flag is the warehouse\'s, the bundle really is coming apart — ' +
      'guessing a build here is how two bins end up wearing one number');
    const plain = office({}, TS);
    check('and a yes from somebody who never said anything moves no flags',
      !('needsLightBuild' in plain) && !('needsDayAssignedAt' in plain) &&
      !('cameBackThisSeasonAt' in plain),
      'they were never out, so there is nothing to undo — writing a rejoin stamp on ' +
      'every yes badges ~960 people as having come back from somewhere');
    check('and every yes clears the office badge',
      plain.maybeNextYear === false && plain.maybeNextYearAt === null,
      'owner 2026-08-22: "we shouldn\'t have to clear a badge to get someone updated"');
  }
}

/* ⭐ SOMEBODY WHO MOVED HOUSE IS TAKEN OFF THE OLD TOWN'S DAY (added 2026-08-24).
   Owner: "they will also need to be reschedules were they go if they have a new
   address."

   ⚠ THIS RUNS THE REAL FUNCTION. Every existing check on the customer sync reads it as
   text, and the bug this closes was invisible to all of them: the town was pulled
   across correctly, the toast said so, and the house never moved. The words were all
   present and the van still went to the old address. A regex proves the code exists,
   which is a different and weaker claim than the house ending up on the right day. */
{
    const src = fnBraced('rehomeMovedHouses');
  check('the re-homer is there to run', !!src,
    'a gate that cannot find its target must FAIL, never skip');

  /* ⚠ AND SOMETHING CALLS IT. A helper nothing calls is the most expensive kind of
     green, and this repo has shipped exactly that. Matched as the direct assignment
     rather than "the name appears somewhere", so a red-check that short-circuits it
     (`rehome = ({moved:[]}) || rehomeMovedHouses(...)`) fails instead of passing on
     text that can no longer run. */
  check('and the five-minute customer sync calls it',
    /rehome\s*=\s*rehomeMovedHouses\(/.test(admin),
    'the sync is the only thing that notices a town changed — unwired, this whole ' +
    'function is decoration');
  /* ⚠ AND IT IS HANDED THE TOWN CHANGES ONLY. Passing every change would re-home
     somebody whose phone number was corrected. */
  check('and only about the customers whose TOWN changed',
    /rehomeMovedHouses\(moved\.filter\(function\(c\)\{ return c\.field===['"]town['"]/.test(admin),
    'a changed note or phone number does not move anybody');
  /* ⚠ AND THE CHANGE RECORD HAS TO CARRY THE HOUSE ID. Without it the filter above
     hands over a list of names, and two customers in the real book share one. */
  check('and a town change names which house it was',
    /changed\.push\(\{name: h\.name \|\| '\(no name\)', field: f\.label, id: h\.id,/.test(admin),
    'matching a house back by name is how the wrong household gets rescheduled');
  if (src) {
    /* The real helpers, lifted rather than stubbed: unassignedHousesFor is the whole
       question ("do this day's crews go to their new town"), so a stub would make the
       test agree with itself. Only nextInstallDayFor and routeDayIsLocked are handed
       in, because those are what each case is varying. */
    const deps = ['unassignedHousesFor', 'crewTownsFor', 'cityOf', 'sameCity',
                  'extractCleanCity', 'isoOf', 'dayDate'].map(fnBraced);
    const missingDep = deps.some(d => !d);
    check('and its helpers were all found', !missingDep,
      'a sandbox missing a helper reaches for a global left behind by another suite ' +
      'and passes on code it never supplied');

    const build = (nextDay, locked) => new Function(
      'SEASON', 'nextInstallDayFor', 'routeDayIsLocked', 'dayCrewTowns', 'planCities', 'CREWS',
      deps.join('\n') + src + 'return rehomeMovedHouses;');

    const mk = (iso, houses) => ({ _date: new Date(iso + 'T00:00:00'), houses: houses });
    const H = (id, city, extra) => Object.assign({ id: id, name: id, city: city }, extra || {});

    /* Two days. Monday is a Lehi day; Tuesday is a Provo day. The customer was on
       Monday and has moved to Provo. */
    const run = (season, opts) => {
      const o = opts || {};
      const f = build()(season,
        o.next === undefined ? (h, x) => season.find(d => d !== x.exclude) : o.next,
        o.locked || (() => false),
        (day) => [[ (day.houses[0]||{}).city ], []],
        () => [], [{}, {}]);
      return f(o.ids || ['h1']);
    };

    (function movedHouseIsRehomed(){
      const mon = mk('2026-10-05', [H('a', 'Lehi'), H('h1', 'Provo')]);
      const tue = mk('2026-10-06', [H('b', 'Provo')]);
      const season = [mon, tue];
      const out = run(season, { next: (h, x) => season.find(d => d !== x.exclude) });
      check('a customer who moved town leaves the day their old town was on',
        out.moved.length === 1 && mon.houses.indexOf(season[0].houses.find(x => x.id === 'h1')) === -1 &&
        tue.houses.some(x => x.id === 'h1'),
        'the town was already being corrected on the house — what never happened is ' +
        'the house moving, so the crew drove to the old address');
    })();

    (function alreadyRightDayIsLeftAlone(){
      const mon = mk('2026-10-05', [H('h1', 'Lehi'), H('a', 'Lehi')]);
      const season = [mon, mk('2026-10-06', [H('b', 'Provo')])];
      const out = run(season, {});
      check('but somebody whose new town the crew already works is not moved',
        !out.moved.length && mon.houses.some(x => x.id === 'h1'),
        'moving a house onto a different day when the crew was going there anyway is ' +
        'churn — and it rewrites a route for nothing');
    })();

    (function lockedDayIsReportedNotTouched(){
      const mon = mk('2026-10-05', [H('a', 'Lehi'), H('h1', 'Provo')]);
      const season = [mon, mk('2026-10-06', [H('b', 'Provo')])];
      const out = run(season, { locked: () => true });
      check('a day already printed is reported, never quietly re-homed',
        !out.moved.length && out.locked.length === 1 && mon.houses.some(x => x.id === 'h1'),
        'inside 48 hours the sheet is printed and the truck is loaded — and silence ' +
        'is the worst of the three outcomes, because only the office can fix it');
    })();

    (function nowhereToGoIsReported(){
      const mon = mk('2026-10-05', [H('a', 'Lehi'), H('h1', 'Provo')]);
      const season = [mon, mk('2026-10-06', [H('b', 'Provo')])];
      const out = run(season, { next: () => null });
      check('and no day going to their new town is reported, not swallowed',
        !out.moved.length && out.stuck.length === 1 && mon.houses.some(x => x.id === 'h1'),
        'a house that silently stays put on the old day is the original bug wearing ' +
        'a different hat');
    })();

    (function onlyTheNamedHouses(){
      const mon = mk('2026-10-05', [H('a', 'Lehi'), H('h1', 'Provo'), H('h2', 'Ogden')]);
      const season = [mon, mk('2026-10-06', [H('b', 'Provo')])];
      const out = run(season, { ids: ['h1'] });
      check('and a house nobody said moved is left where it is',
        out.moved.length === 1 && mon.houses.some(x => x.id === 'h2'),
        'a house can be unassigned on PURPOSE — an unknown town pairing is left ' +
        'visible rather than loaded onto a crew driving fifty miles for it. Sweeping ' +
        'every unassigned house would silently overturn that');
    })();

    (function doneAndCopiesAreNeverMoved(){
      const mon = mk('2026-10-05', [H('a', 'Lehi'), H('h1', 'Provo', { done: true }),
                                    H('h3', 'Provo', { isTakedown: true })]);
      const season = [mon, mk('2026-10-06', [H('b', 'Provo')])];
      const out = run(season, { ids: ['h1', 'h3'] });
      check('a house already done, and a takedown copy, are never moved',
        !out.moved.length && mon.houses.some(x => x.id === 'h1') && mon.houses.some(x => x.id === 'h3'),
        'their lights are up at the old address — moving the row rewrites what the ' +
        'crew actually did, and a takedown is a copy, not the house');
    })();

    (function nothingToDoDoesNothing(){
      const out = run([mk('2026-10-05', [H('a', 'Lehi')])], { ids: [] });
      check('and an empty list moves nobody',
        !out.moved.length && !out.stuck.length && !out.locked.length,
        'the commonest tick by far is the one where nothing changed');
    })();
  }
}

/* ⭐ WHO THE RULE IS LEAVING OUT — THE COUNT, NOT A SWITCH (2026-08-24, rewritten
   2026-08-27). This began as the preview behind an office control: press Check first,
   see how many would drop, then decide. The control is gone — Addie: "I tried to make
   it clear I didn't want a switch" — and the count is the half that survived, because
   her earlier ruling was "Both — hardcode it AND warn me". It is now the only thing the
   Dashboard row does, and it feeds Health Check's chase-these-people list.

   ⚠ RUN, NOT READ. The whole risk here is which customers stop being in the season, and
   a regex over the source cannot see that. */
{
  const dropSrc = fnBraced('seasonEligibilityWouldDrop');
  check('the eligibility preview is there to run', !!dropSrc,
    'a gate that cannot find its target must FAIL, never skip');
  if (dropSrc) {
    /* The REAL isOutForSeason and audienceIsNew, lifted — the preview exists to answer
       "who leaves the season", and a stub would answer it with a fiction. */
    const mk = (book) => {
      /* ⚠ NOTHING SETS THE MODE ANY MORE — it is a const, and assigning it would throw.
         The rule is live because ruleSrc supplies a send marker, which is the whole of
         what makes it live now. */
      const sandbox = new Function('jobAddresses',
        ruleSrc('new Date(Date.now() - 400*86400000)') +
        audienceIsNewSrc + src.isOutForSeason + dropSrc +
        ';return {drop: seasonEligibilityWouldDrop, suspended: () => seasonRuleOffForMeasurement};');
      return sandbox(book);
    };
    const answeredYes = { rsvpStatus: 'yes', rsvpRespondedAt: 1 };
    const neverAsked  = {};
    const saidNo      = { rsvpStatus: 'no' };
    const newHang     = { chargeNewMemberFee: true };
    const book = [
      { data: answeredYes }, { data: neverAsked }, { data: neverAsked },
      { data: saidNo }, { data: newHang }
    ];
    const s1 = mk(book);
    const dropped = s1.drop();
    /* ⚠ THE TWO WHO NEVER ANSWERED ARE THE WHOLE POINT. Somebody who said no is
       already out, so they are not "dropped" by the switch; a new hang is kept in by
       isOutForSeason's own rule, because we never send them an RSVP to answer. */
    check('the preview counts exactly the people who never answered',
      dropped.length === 2,
      'it counted ' + dropped.length + ' — somebody already out is not dropped BY the ' +
      'switch, and a new hang is deliberately kept in because we never ask them');
    /* ⚠ AND IT PUTS THE LEVER BACK. Measuring the damage must not cause it: while the
       lever is on, isOutForSeason answers the LENIENT way for the whole page, which is
       the season silently counting everybody again. */
    check('and measuring it leaves the rule exactly as it was',
      s1.suspended() === false,
      'the count suspends the rule to run isOutForSeason both ways, and leaving it ' +
      'suspended puts every unanswered customer back into the season with nobody ' +
      'having chosen that');
    /* ⚠ RESTORED IN A `finally`, asserted structurally because the behavioural check
       above passes on the happy path whether or not the guard is there.
       ⚠ SLICED, NOT WINDOWED — dropSrc is already the function's own braces, so this is
       scoped without a character count (CLAUDE.md §7). */
    check('and the restore is in a finally, not just on the happy path',
      /finally\s*\{[\s\S]*seasonRuleOffForMeasurement = was;/.test(dropSrc),
      'a throw mid-count would leave the rule suspended for the whole page');
    /* ⚠ AND IT ASKS THE REAL PREDICATE BOTH WAYS rather than re-deciding. A second
       opinion about who is in the season is the drift isOutForSeason exists to stop —
       and this is the number the office acts on. */
    check('and it measures by running isOutForSeason, not by re-deciding',
      /isOutForSeason\(/.test(dropSrc) && !/rsvpRespondedAt/.test(dropSrc),
      'a second copy of "is this customer in the season" is how two screens start ' +
      'disagreeing about the same person');
    const empty = mk([]);
    check('and an empty book previews nobody rather than throwing',
      empty.drop().length === 0);
  }

  /* ⭐ THERE IS NO SWITCH, AND THAT IS NOW THE THING BEING CHECKED (2026-08-27).
     Everything between here and the run below used to be about an office control on the
     Dashboard: that it was refused before the RSVP had gone out, that the safe direction
     was never blocked, that an unrecognised saved value left the default standing. Addie
     removed the control — "I tried to make it clear I didn't want a switch and that RSVP
     Approved in any of the approval ways should be hardcoded". The old checks are gone
     WITH the thing they guarded rather than weakened; what replaces them is stricter,
     because a value that cannot be written cannot be written wrongly.

     ⚠ THE THREE OLD GUARANTEES DID NOT DISAPPEAR, they collapsed into one: nothing may
     put the rule back to "everybody". A settings read that could do it was the largest
     of the three, and it is the one checked first. */
  /* ⚠ REPOINTED 2026-08-31, NOT DROPPED. Addie turned confirmed-only off for the
     testing weeks — "if its no rsvp that shouldnt effect it because we still need to
     test if its no rsvp so tht is irrelevant" — after it was measured holding 951 of
     her 956 customers out of the season. THE GUARANTEE THIS CHECK EXISTS FOR IS
     UNCHANGED and is what is still asserted: it is a `const`, so nothing stored can
     move the rule either way behind somebody's back. Which value it holds is a ruling
     (MON-47), asserted where the ruling is, not here.
     ⚠ A `let` here is still the failure: that is a value a stored setting, a handler
     or a stray line can put back to everybody. */
  check('the season rule is hardcoded, not a variable something can reassign',
    /const SEASON_ELIGIBILITY = '(confirmed-only|all-but-maybe-next-year)';/.test(admin) &&
    !/let SEASON_ELIGIBILITY/.test(admin),
    'a `let` is a value a stored setting, a handler or a stray line can put back to ' +
    'everybody — which is a season quietly counting people nobody asked');

  {
    /* ⚠ COMMENTS STRIPPED. The rule is explained at length in prose right beside the
       declaration, and every one of those paragraphs contains the words this is looking
       for — a plain search finds the explanation and calls it an assignment. */
    const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const writes = (bare.match(/SEASON_ELIGIBILITY\s*=/g) || []).length;
    check('and exactly one thing in the file assigns it — the declaration',
      writes === 1,
      'found ' + writes + '. Anything past the declaration is a switch by another name');
    check('and no stored setting can turn it off',
      !/seasonEligibility\s*\|\|/.test(bare) && !/setSeasonEligibility/.test(bare),
      'a value written weeks ago by a control that no longer exists must not decide ' +
      'who a crew is sent to');
  }

  /* ⭐ THE ONE LEVER, AND WHY IT IS NOT THE SWITCH COMING BACK. The count of who the
     rule leaves out is measured by RUNNING isOutForSeason both ways — that is what makes
     it trustworthy, since a second opinion about who is in the season is the exact drift
     the predicate exists to stop. With the mode a const there is nothing to flip, so one
     `let` exists purely for that measurement. It is a switch the moment anything else
     touches it, which is why this counts the writers. */
  {
    const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const writes = (bare.match(/seasonRuleOffForMeasurement\s*=/g) || []).length;
    check('the measurement lever is written only by its declaration and the measurement',
      writes === 4,
      'found ' + writes + ' assignments (expected 4: the declaration, off, back on, and ' +
      'the restore in finally). Anything else can leave the rule suspended for the whole ' +
      'page, which is the season silently counting everybody again');
    check('and it is put back in a finally, so a throw cannot leave the rule suspended',
      /finally\s*\{[^}]*seasonRuleOffForMeasurement = was;/.test(admin),
      'a throw part-way through the count would otherwise leave every screen reading ' +
      'the lenient answer with nobody having chosen it');
  }
  /* ⚠ REPOINTED 2026-08-26, AND THE GUARANTEE IS UNCHANGED. This asserted the literal
     read 'all-but-maybe-next-year', because that string was the only thing keeping a
     failed settings read from emptying the season. Addie then asked for the rule to be
     the DEFAULT rather than a switch she has to remember, so the literal is now
     'confirmed-only' and the protection moved into `seasonRuleIsLive`.
     What must still be true: A FAILED SETTINGS READ CANNOT EMPTY THE SEASON BEFORE
     PEOPLE HAVE BEEN ASKED. That is RUN below rather than matched, which the old
     string compare could not do. ⚠ Once the RSVP has gone out AND the reply window has
     closed, the strict answer IS the intended one — so the guarantee is about the
     before, not for ever. */
  {
    const live = (sentAt) => new Function(
      'let rsvpSentAtCache = ' + sentAt + ';\n' +
      (admin.match(/const RSVP_REPLY_DAYS = \d+;/) || [''])[0] + '\n' +
      (admin.match(/(?:const|let) SEASON_ELIGIBILITY = '[^']*';/) || [''])[0] + '\n' +
      'let seasonRuleOffForMeasurement = false;\n' +
      fn('toJsDate') + '\n' + fn('seasonRuleIsLive') + '\nreturn seasonRuleIsLive();')();
    /* ⭐ REVERSED 2026-08-27, AND THE OLD ASSERTION IS KEPT IN WORDS BECAUSE IT WAS RIGHT
       UNTIL THE ANSWER CHANGED. It required that the rule could not empty the season
       before anybody was asked. It can, and Addie chose that: "we cannot schedule people
       that haven't RSVP." The protection did not disappear, it MOVED — nobody is lost,
       they are listed on Schedule › Waiting on RSVP with a phone number, which is the
       half that had to exist before this line could change. */
    check('the rule applies whether or not the RSVP has been marked sent',
      live('null') === true && live('undefined') === true,
      'a marker that gates the rule is a switch by another name, and it is the one ' +
      'somebody forgets to press in October');
    /* ⭐ REPOINTED 2026-08-26, AND IT IS THE OPPOSITE ASSERTION ON PURPOSE — questions
       map RS-15. This used to require that the rule was NOT live the moment she pressed
       send, protecting a 14-day reply window. Addie removed the window: "a house won't
       be a yes or no because of how long they haven't responded for. They are just
       unresponsive and we won't do there house unless we get a yes from them."
       So the guarantee flipped rather than weakened. What is asserted now is that
       nothing except the SEND decides it — before, not live; after, live immediately;
       and elapsed time changes nothing either way. */
    check('it becomes the rule the moment the RSVP goes out',
      live('new Date()') === true,
      'waiting is not an answer — an unresponsive house is unresponsive on day one, ' +
      'and holding the rule off would route and build for somebody who never said yes');
    check('and waiting neither starts nor stops it',
      live('new Date(Date.now() - 400*86400000)') === true &&
      live('new Date(Date.now() - 86400000)') === true,
      'time was the only thing here that changed an answer without a customer doing ' +
      'anything, which is the whole of what RS-15 removed');
  }
  /* ⭐ REPOINTED WITH THE BEHAVIOUR, NOT DROPPED (2026-08-27). This asserted that the
     Dashboard SWITCH redrew everything that reads the season. The switch is gone, but
     the guarantee is not — it moved to the thing that now flips the season: the
     RSVP-sent mark. Set it and ~960 unanswered customers leave the routes, the schedule
     and the build queue; clear it and they come back.

     ⚠ AND THAT MOVE FOUND A REAL HOLE. Both mark handlers redrew the banner alone, and
     the clear dialog said in as many words "This only changes what this banner says" —
     true when it was written, false the moment the rule was hardcoded to the mark. The
     routes, the warehouse and the customer table would have gone on showing the old
     season until something else happened to repaint them.

     ⚠ ONE FUNCTION, THREE CALLERS — the two buttons and the automatic stamp from an
     RSVP sent through Automation Emails. Three copies is how one of them quietly stops
     redrawing, so the count is asserted. */
  {
    const changed = fnBraced('rsvpMarkChanged');
    check('the mark-changed redraw exists and does not call renderAll',
      /renderJobAddressPanels\(\)/.test(changed) && !/[^a-zA-Z]renderAll\(\)/.test(changed),
      'renderAll belongs to the schedule widget\'s scope — calling it from the main app ' +
      'throws "is not defined" and kills the handler silently');
    const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const calls = (bare.match(/rsvpMarkChanged\(\);/g) || []).length;
    check('and all three routes that move the mark call it',
      calls === 3,
      'found ' + calls + ' (expected 3: mark by hand, clear by hand, and the automatic ' +
      'stamp from an RSVP send). A route that skips it leaves the routes and the ' +
      'warehouse showing the season as it was before the RSVP went out');
    /* ⚠ SLICED TO THE HANDLER AND CHECKED FOR REACHABILITY, NOT JUST FOR THE WORDS.
       The first version of this matched the sentence anywhere in admin.html, and a
       red-check wrapping the guard as `if(false && confirm(...))` left every word in
       place and it PASSED — a warning that is in the source and can never reach the
       screen, which is the failure this repo has now shipped four times. What is
       asserted is the SHAPE (`if(!confirm(`) and the ORDER: it has to refuse before
       anything is written, because once the mark is set the season has already
       changed. */
    const markH = (function(){
      const at = admin.indexOf("markBtn.addEventListener('click'");
      if (at === -1) return '';
      let d = 0;
      for (let k = admin.indexOf('{', at); k < admin.length; k++) {
        if (admin[k] === '{') d++;
        else if (admin[k] === '}') { d--; if (!d) return admin.slice(at, k + 1); }
      }
      return '';
    })();
    /* ⭐ THE CLAIM FLIPPED TWICE IN ONE DAY, so what is asserted is that it does not
       OVERCLAIM. For about an hour the mark was the trigger and this dialog correctly
       warned that pressing it took ~960 people off the routes. The rule applies always
       now, so the mark moves nobody — and a dialog still saying it does would send the
       office looking for a change that never happened. */
    check('and setting the mark does not claim to move anybody',
      /if\(!confirm\(/.test(markH) &&
      /does not move anybody/.test(markH) &&
      !/come off the routes, the schedule and the warehouse queue/.test(markH) &&
      markH.indexOf('confirm(') < markH.indexOf('markRsvpSent('),
      'people who have not answered are already off the routes — the mark changes what ' +
      'the waiting list SAYS about them, and nothing else');
    /* ⚠ COMMENT-STRIPPED. The note recording WHY that sentence went quotes the sentence
       itself, three lines above the dialog — so a raw match finds the explanation and
       fails on code that is right. The same trap this file has hit three times. */
    check('and clearing it does not claim to put anybody back',
      !/This only changes what this banner says/.test(bare) &&
      /moves nobody on or off a route/.test(bare),
      'that sentence was true until the rule was hardcoded to this mark, and a dialog ' +
      'promising it changes nothing while it puts ~960 people back is the quiet ' +
      'failure this repo keeps writing rules about');
  }
}

/* ⭐ WHY THIS PERSON IS IN THE SEASON WITHOUT AN RSVP REPLY (added 2026-08-27).
   Addie, settling the one exception to "we need a yes": "once we convert a quote to
   costumer that is the only exception... they are already approved through converting
   to costumer this year and 2 they don't get send an RSVP. If we need to put a badge on
   new member for converted costumer to make this easier that they are approved than we
   can do that."

   ⚠ RUN, NOT READ. The claim is about a label appearing on a row, and a regex over the
   source proves the words exist — a weaker claim, and the one this repo has been caught
   by three times. */
{
  const badgeSrc = fnBraced('approvedOnJoinBadge');
  check('the badge is there to run', !!badgeSrc,
    'a gate that cannot find its target must FAIL, never skip');

  if (badgeSrc) {
    const api = new Function(
      audienceIsNewSrc + badgeSrc + fn('effectiveRsvpStatus') + fn('rsvpStatusLabel') +
      'return {badge: approvedOnJoinBadge, eff: effectiveRsvpStatus, label: rsvpStatusLabel};')();
    const has = (d) => !!api.badge(d);

    check('a new customer from a quote this year carries it',
      has({ chargeNewMemberFee: true }),
      'this is the whole exception — they were approved when the quote was converted ' +
      'and are deliberately never sent an RSVP');
    check('somebody who actually replied does NOT',
      !has({ rsvpStatus: 'yes', rsvpRespondedAt: 1 }),
      'they answered; the badge is for people who did not have to');
    check('and nor does a returning customer who never replied',
      !has({}) && !has({ rsvpStatus: 'yes' }),
      'badging them would say they are approved when the season rule leaves them off ' +
      'every route — a confident label on the one screen somebody checks before ringing');

    /* ⚠ THE BADGE AND THE SEASON MUST AGREE, ALWAYS. This is the real risk: a badge
       with its own idea of "new this year" is worse than no badge, because it is a
       wrong answer somebody acts on. Asserted by RUNNING both over the same records. */
    const outStrictLocal = (d) => outStrict(d);
    [{ chargeNewMemberFee: true }, { rsvpStatus: 'yes', rsvpRespondedAt: 1 },
     {}, { rsvpStatus: 'yes' }, { rsvpStatus: 'no' }].forEach(function (d) {
      if (!has(d)) return;
      check('a badged customer is genuinely in the season: ' + JSON.stringify(d),
        outStrictLocal(d) === false,
        'the badge says approved and the rule leaves them out — two screens ' +
        'disagreeing about one customer, which is the failure the shared predicate exists to stop');
    });

    check('and it asks the shared predicate rather than deciding for itself',
      /audienceNeverAsked/.test(badgeSrc) && !/chargeNewMemberFee/.test(badgeSrc),
      'a second definition of "new this year" here would eventually contradict the ' +
      'season it is describing');
  }

  /* ⚠ ALL THREE RSVP PILLS CARRY IT. Three copies of a pill is how one of them quietly
     stops showing the badge — and the row that stops showing it is the row somebody
     reads before deciding this customer never replied. */
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const calls = (bare.match(/approvedOnJoinBadge\(/g) || []).length;
  check('every place that draws an RSVP pill draws the badge',
    calls === 4,
    'found ' + calls + ' (expected 4: the declaration plus the invoice card, the ' +
    'Dashboard RSVP list and the All Customers row)');

  /* ⭐ AND THE ROW UNDER IT TELLS THE TRUTH. Found while adding the badge: the All
     Customers row printed the RAW rsvpStatus, so a record holding a bare 'yes' with no
     reply behind it read "RSVP: Yes" there while the Dashboard said Pending and the
     season rule left them off every route. The badge would have sat on a row already
     contradicting it. */
  check('the All Customers row shows the effective status, not the stored field',
    /const rsvpEff = effectiveRsvpStatus\(r\.d\);/.test(admin) &&
    !/rsvpStatusLabel\(r\.d\.rsvpStatus\)/.test(bare),
    'a bare stored yes is not an answer — printing it raw is one screen calling ' +
    'somebody confirmed while every other one calls them Pending');
}

/* ⭐ WAITING ON RSVP — THE OTHER HALF OF THE RULE (added 2026-08-27).
   Addie, told that people who had not replied were still being scheduled: "we cannot
   schedule people that haven't RSVP. could we make another section in schedule were it
   just has pending people."

   ⚠ THIS LIST IS WHAT MAKES THE RULE SURVIVABLE, not a nicety. Applying it with nowhere
   for these people to go means ~960 customers are simply absent from every screen. With
   the list, an empty season is a stack of phone calls.

   ⚠ RUN, NOT READ. Every claim here is about WHO IS ON A LIST. */
{
  const waitSrc = fnBraced('waitingOnRsvpHouses');
  check('the waiting list is there to run', !!waitSrc,
    'a gate that cannot find its target must FAIL, never skip');

  if (waitSrc) {
    const book = [
      { id: 'a', data: { name: 'Replied Yes', city: 'Lehi', rsvpStatus: 'yes', rsvpRespondedAt: 1 } },
      { id: 'b', data: { name: 'Never Replied', city: 'Lehi', phone: '8015550002' } },
      { id: 'c', data: { name: 'No Contact', city: 'Draper' } },
      { id: 'd', data: { name: 'Said No', city: 'Lehi', rsvpStatus: 'no' } },
      { id: 'e', data: { name: 'Back Next Year', city: 'Draper', rsvpStatus: 'backnextyear' } },
      { id: 'f', data: { name: 'New This Year', city: 'Draper', chargeNewMemberFee: true } },
      { id: 'g', data: { name: 'Being Recycled', city: 'Lehi', needsLightRecycle: true } }
    ];
    const api = new Function('jobAddresses',
      ruleSrc('null') + eligLine + audienceIsNewSrc + src.isOutForSeason +
      fn('extractCleanCity') + fnBraced('seasonEligibilityWouldDrop') + waitSrc +
      'return {wait: waitingOnRsvpHouses, out: isOutForSeason};')(book);
    const names = api.wait().map(r => r.d.name);

    check('somebody who never replied is waiting',
      names.indexOf('Never Replied') !== -1 && names.indexOf('No Contact') !== -1,
      'this is the list, and they are the people on it');
    check('somebody who answered yes is not',
      names.indexOf('Replied Yes') === -1,
      'they are in the season — a list that includes them is a call nobody needs to make');
    /* ⚠ OUT OF THE SEASON IS NOT THE SAME AS WAITING, and this is the distinction that
       makes the list worth ringing down. Somebody who said no, or Back Next Year, or
       whose lights are queued to be collected, is not waiting on anything. */
    ['Said No', 'Back Next Year', 'Being Recycled'].forEach(function (n) {
      check(n + ' is out of the season but NOT waiting',
        api.out(book.find(b => b.data.name === n).data) === true && names.indexOf(n) === -1,
        'ringing them to ask for an answer they have already given is worse than not ' +
        'ringing at all');
    });
    check('a new customer this year is not waiting either',
      names.indexOf('New This Year') === -1,
      'converting their quote was the approval, and we never send them an RSVP');
    /* Chasing is done a town at a time, and a list that reshuffles under somebody
       working down it is a list they lose their place in. */
    check('and it is ordered by town, then name',
      JSON.stringify(names) === JSON.stringify(['No Contact', 'Never Replied']),
      'got ' + JSON.stringify(names));

    check('it asks the season rule rather than re-deciding who is waiting',
      /seasonEligibilityWouldDrop/.test(waitSrc) && !/rsvpRespondedAt/.test(waitSrc),
      'a second opinion here — "everybody whose rsvpStatus is blank", say — drifts from ' +
      'the routes within a week, and the drift is invisible on both screens');
  }

  /* ⚠ THE PANE LIST IS THE TRAP CLAUDE.md NAMES BY NAME, twice, having been caught by
     it twice. A pane left out of it never HIDES — it sits underneath whichever tab is
     showing. */
  /* ⚠ REPOINTED 2026-08-31, NOT WEAKENED. This asserted the exact array literal
     ['schedule','fixes','oneman','waiting','printing','takedowns'], which is a check
     pinned to the SPELLING of a list rather than to what must be true of it — so
     adding a legitimate pane (Owes from last year) failed a check about code that was
     right. Same slow-fuse shape as S82, S129 and the folder-names suite. It reads the
     real list out of the page and asserts MEMBERSHIP, so it still fails for the reason
     it was written — a pane missing from the switcher — and no longer fails for a
     reason it was never about. */
  const paneList = (admin.match(/\[((?:'[a-z]+',)+'[a-z]+')\]\.forEach\(n=>RT\.getElementById\('pane-'\+n\)/) || [])[1] || '';
  const panes = paneList.split(',').map(function (x) { return x.replace(/'/g, '').trim(); });
  check('the tab switcher list was found at all',
    panes.length >= 2,
    'a check that cannot find its target reports green for the worst possible reason — ' +
    'got ' + JSON.stringify(paneList));
  check('the Waiting pane is in the tab switcher list',
    panes.indexOf('waiting') !== -1,
    'a pane left out of that list sits underneath whichever tab is open');
  /* ⭐ THE MONEY HOLD'S OWN PANE, added with it. Held customers must be visible
     somewhere or the season quietly shrinks — the same argument the Waiting list is
     built on, and the reason both panes exist rather than one. */
  check('the Owes from last year pane is in the tab switcher list too',
    panes.indexOf('owes') !== -1,
    'a pane left out of that list sits underneath whichever tab is open');
  check('and its tab, pane and renderer all exist',
    /data-tab=\\"owes\\"/.test(admin) && /id=\\"pane-owes\\"/.test(admin) &&
    /id=\\"owesLastYearPane\\"/.test(admin) && /function renderOwesLastYear\(/.test(admin),
    'a tab with no pane, or a pane with no renderer, is a blank screen and no error');
  check('and opening it is what draws it',
    /activeTab==='owes'\)\{renderOwesLastYear\(\)/.test(admin),
    'without this the tab is permanently empty');
  check('and the tab, the pane and the renderer all exist',
    /data-tab=\\"waiting\\"/.test(admin) && /id=\\"pane-waiting\\"/.test(admin) &&
    /id=\\"waitingRsvpPane\\"/.test(admin) && /function renderWaitingRsvp\(/.test(admin),
    'a tab with no pane, or a pane with no renderer, is a blank screen and no error');
  check('and opening the tab is what draws it',
    /activeTab==='waiting'\)\{renderWaitingRsvp\(\)/.test(admin),
    'without this the tab is permanently empty');
  /* The phone number is the point. A name and an address is a report. */
  check('and the list shows a way to contact them',
    /no phone or email on file/.test(admin),
    'somebody with neither has to be visible as such, or they look like a call that ' +
    'was simply not made');
}

/* ---------------------------------------------------------------------------
 * WHAT THE OFFICE'S CARD CALLS THEM (added 2026-09-02)
 *
 * Addie: "it says pending for RSVP. However the last button I pushed was no."
 * The No turned out to be fine end to end — but the card in her screenshot also
 * carried the office's own Maybe Next Year badge, and THAT read as Pending.
 *
 * ⚠ ONE LINE, DOING THE OPPOSITE OF WHAT IT SAID. `|| dd.maybeNextYear` sat inside
 * the test and then `return said` — so for a badged customer with no reply of their
 * own it handed back '', the very value it was meant to overrule. The comment above
 * it says the badge always WINS.
 *
 * ⚠ IT CHANGED NO SEASON BEHAVIOUR, WHICH IS EXACTLY WHY IT SURVIVED: isOutForSeason
 * and seasonHold read `maybeNextYear` directly, so these customers were correctly off
 * every route the whole time. Only the words were wrong, on every screen at once.
 *
 * ⚠ AND IT IS ASSERTED AS THE LABEL A PERSON READS, not as the raw status, because
 * "Pending" is what she saw and what made it a bug worth reporting.
 * ------------------------------------------------------------------------- */
{
  const badgeFn = new Function('audienceNeverAsked', 'seasonRuleIsLive',
    /* fnBraced, not fn: these are lifted for their VALUES and a slice that runs on
       past the closing brace would drag in whatever follows. The file's own note
       above fnBraced explains why the simpler lifter is not safe here. */
    fnBraced('effectiveRsvpStatus') + fnBraced('rsvpStatusLabel') +
    'return function(r){ return rsvpStatusLabel(effectiveRsvpStatus(r)); };'
  )(function(){ return false; }, function(){ return false; });

  check('a customer who pressed No reads as No',
    badgeFn({ rsvpStatus: 'no', rsvpRespondedAt: 'x' }) === 'No',
    'got ' + badgeFn({ rsvpStatus: 'no', rsvpRespondedAt: 'x' }));

  check('the office\u2019s Maybe Next Year badge does not read as Pending',
    badgeFn({ maybeNextYear: true }) === 'Back Next Year',
    'the office recorded an answer and the card called them Pending; got ' +
    badgeFn({ maybeNextYear: true }));

  /* ⚠ THE BADGE STILL DOES NOT PROMOTE A BARE YES. That normalisation is the whole
     reason this function exists, and it must survive the fix above. */
  check('a bare stored yes under the badge is still not a yes',
    badgeFn({ rsvpStatus: 'yes', maybeNextYear: true }) === 'Back Next Year',
    'got ' + badgeFn({ rsvpStatus: 'yes', maybeNextYear: true }));

  /* ⚠ AND A REAL ANSWER STILL BEATS THE BADGE, which is the older rule and the one
     that must not be traded away for the new one. */
  check('somebody who actually said no beats the badge',
    badgeFn({ rsvpStatus: 'no', rsvpRespondedAt: 'x', maybeNextYear: true }) === 'No',
    'got ' + badgeFn({ rsvpStatus: 'no', rsvpRespondedAt: 'x', maybeNextYear: true }));

  check('and a record with nothing on it is still Pending',
    badgeFn({}) === 'Pending',
    'Pending must keep meaning "nobody has answered"; got ' + badgeFn({}));
}

/* ---------------------------------------------------------------------------
 * TWO PILLS ON ONE ROW MUST NOT BORROW EACH OTHER'S WORDS (added 2026-09-02)
 *
 * Addie: "Says yes in one spot but pending in the other." Both pills were right and
 * they answer DIFFERENT questions -- the RSVP pill says whether they approved, the
 * season pill says whether they are in the season -- but the season pill said
 * "Pending", which is the RSVP vocabulary for NOBODY HAS ANSWERED. So a customer who
 * had approved sat under a chip stating, in the other column's own language, that
 * they had not.
 *
 * ⚠ THE GUARD IS ABOUT VOCABULARY, NOT LOGIC, because the logic was never wrong.
 * Nothing here says which state a customer is in; it says the two columns may not
 * use one word for two different questions.
 * ------------------------------------------------------------------------- */
{
  const labelFn = new Function(fnBraced('rsvpStatusLabel') + 'return rsvpStatusLabel;')();
  const rsvpWords = ['', 'yes', 'no', 'backnextyear', 'unanswered', 'anything-else']
    .map(labelFn).map(x => String(x).toLowerCase());

  /* The season cell's three chips, read out of the row builder rather than restated. */
  const cellAt = admin.indexOf('const maybeCell = badgeKey === ');
  const cell = cellAt === -1 ? '' : admin.slice(cellAt, admin.indexOf('return \'<tr', cellAt));
  check('the season status cell was found', !!cell && cell.length > 200,
    'the checks below slice this — an empty slice would pass them vacuously');

  const chipWords = (cell.match(/font-weight:700;"[^>]*>([^<]+)<\/span>/g) || [])
    .map(m => (/>([^<]+)<\/span>/.exec(m) || [])[1])
    .map(x => String(x).trim().toLowerCase())
    .filter(Boolean);

  check('the season cell still draws its chips', chipWords.length >= 2,
    'got ' + JSON.stringify(chipWords));

  /* ⚠ "Back Next Year" IS THE ONE DELIBERATE OVERLAP and is excluded by name — it is
     the same state in both columns, said the same way on purpose, which is the whole
     point of the rename below. Everything else borrowing an RSVP word is the collision
     this closes.
     ⚠ IT USED TO BE "Maybe Next Year" HERE, and that was the collision rather than the
     exception. Addie, 2026-09-02: "its back next year the quotes is maybe next year" —
     the RSVP has three answers (Yes / Back Next Year / No) and Maybe Next Year is the
     QUOTE's word. The office side was using the quote's vocabulary for an RSVP state,
     one row speaking two languages, exactly as "Pending" was. */
  const shared = chipWords.filter(w => w !== 'back next year' && rsvpWords.indexOf(w) !== -1);
  check('no season chip uses an RSVP word for a different question',
    shared.length === 0,
    'the season cell says ' + JSON.stringify(shared) + ', which the RSVP pill uses to ' +
    'mean something else on the same row — that is what Addie read as a contradiction');

  check('and the blocked state no longer says Pending',
    chipWords.indexOf('pending') === -1,
    'got ' + JSON.stringify(chipWords));

  /* ⚠ AND THE QUOTE'S WORD STAYS OUT OF THE RSVP COLUMNS. The quote flow keeps
     "Maybe Next Year" — its own approvalStatus, its response buttons and the
     Quote Maybe Next Year Follow-up template are all untouched — but the season
     cell must not borrow it for an RSVP answer. */
  check('the season cell does not use the quote\u2019s Maybe Next Year wording',
    chipWords.indexOf('maybe next year') === -1,
    'the RSVP answers are Yes / Back Next Year / No; Maybe Next Year belongs to ' +
    'quotes. Got ' + JSON.stringify(chipWords));
}

/* ---------------------------------------------------------------------------
 * THE OFFICE'S OWN DROPDOWN WAS BEING OVERRULED (added 2026-09-02)
 *
 * Addie, after setting the RSVP dropdown to Back Next Year: "RSVP still says yes even
 * though I just tried to update it and still says yes."
 *
 * ⚠ TWO CONTROLS DESCRIBE ONE STATE -- the Back Next Year checkbox and the RSVP
 * dropdown -- and the save read an unticked box as "the office is bringing them back
 * in", so it cleared rsvpStatus to blank. That is right for a STALE dropdown left
 * reading backnextyear from an earlier answer, and exactly wrong for one the office
 * has just set; nothing told them apart. Her customer already carried the flag from an
 * earlier test, so choosing Back Next Year ran that branch, blanked the answer, and the
 * blank then read as "Yes" because a quote-converted customer with no answer on file is
 * treated as approved.
 *
 * ⚠ THE FIX IS "CHANGED", NOT "EQUALS backnextyear". Comparing against the STORED value
 * is what separates a fresh choice from a stale one -- and the case the old line was
 * written for still has to work, which is the second check below.
 * ------------------------------------------------------------------------- */
{
  const at = admin.indexOf('const seasonMaybeFromDropdown =');
  const endM = "if(newRsvp === 'backnextyear'){ addrUpdates.rsvpStatus = ''; addrUpdates.rsvpRespondedAt = null; }";
  let src = at === -1 ? '' : admin.slice(at, admin.indexOf(endM, at) + endM.length);
  check('the season block was found to run', !!src && src.length > 200,
    'the checks below RUN it — an empty slice would pass them vacuously');

  if (src) {
    /* The slice stops mid-block, so close what it left open rather than guessing a
       line count — a fixed window here is exactly what §7 bans. */
    let depth = 0, q = '', com = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i], prev = src[i - 1], next = src[i + 1];
      if (com) { if (com === '*' && c === '*' && next === '/') { com = ''; i++; }
                 else if (com === '/' && c === '\n') com = ''; continue; }
      if (!q && c === '/' && next === '*') { com = '*'; i++; continue; }
      if (!q && c === '/' && next === '/') { com = '/'; i++; continue; }
      if (q) { if (c === q && prev !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++; else if (c === '}') depth--;
    }
    src += '\n' + '}'.repeat(Math.max(0, depth));

    const run = (prevFlag, checkbox, dropdown, stored) => {
      const addrUpdates = { rsvpStatus: dropdown };
      new Function('item', 'newSeasonMaybe', 'newRsvp', 'oldRsvpForRecycle',
                   'addrUpdates', 'serverTimestamp', src)(
        { data: { maybeNextYear: prevFlag } }, checkbox, dropdown, stored, addrUpdates,
        function () { return 'STAMPED'; });
      return addrUpdates;
    };

    /* ⭐ HER CASE. The flag was already on, the box is unticked, and the office picks
       Back Next Year in the dropdown. */
    const chosen = run(true, false, 'backnextyear', 'yes');
    check('choosing Back Next Year in the dropdown is not wiped by the unticked box',
      chosen.rsvpStatus === 'backnextyear',
      'the office picked an answer and the save threw it away; got ' +
      JSON.stringify(chosen.rsvpStatus));

    /* ⚠ AND THE TWO CONTROLS END UP AGREEING. Storing backnextyear with the flag off is
       what put the badge and the RSVP pill on opposite sides of one row. */
    check('and the badge flag is set to match it',
      chosen.maybeNextYear === true,
      'got ' + JSON.stringify(chosen.maybeNextYear));

    /* ⚠ THE CASE THE OLD LINE PROTECTED, which must survive: unticking the box to bring
       somebody back, with the dropdown still sitting on a stale backnextyear. */
    const broughtBack = run(true, false, 'backnextyear', 'backnextyear');
    check('unticking the box still clears a stale Back Next Year dropdown',
      broughtBack.rsvpStatus === '' && broughtBack.maybeNextYear === false,
      'coming back in behind a dropdown still reading Back Next Year leaves them ' +
      'unroutable behind a Confirmed badge; got ' + JSON.stringify(broughtBack));
  }
}

/* ---------------------------------------------------------------------------
 * THE OFFICE DROPDOWN NAMES THE ANSWERS THE WAY THE EMAIL DOES (added 2026-09-02)
 *
 * Addie, reading the RSVP dropdown: "I noticed there isn't a no". There was — it said
 * "No — Skip This Year", and the explanatory tail was what hid it. The customer presses
 * Yes / Back Next Year / No, so anything else here is a fourth vocabulary for three
 * answers and the office has to translate between them.
 *
 * ⚠ THE TWO STATES ABOVE KEEP THEIR TAILS, and that is not an inconsistency: Pending
 * and Unanswered are not RSVP answers and have no button. They say who has been ASKED,
 * which is Addie's own 2026-08-20 ruling ("add a third for unanswered") and the thing
 * that makes a stale Yes impossible to mistake for this year's.
 * ------------------------------------------------------------------------- */
{
  const at = admin.indexOf('<select id="editCustRsvp">');
  const sel = at === -1 ? '' : admin.slice(at, admin.indexOf('</select>', at));
  check('the RSVP dropdown was found', !!sel && sel.indexOf('<option') !== -1);

  const opts = {};
  (sel.match(/<option value="([^"]*)"[^>]*>([^<]*)</g) || []).forEach(function (m) {
    const p = /<option value="([^"]*)"[^>]*>([^<]*)</.exec(m);
    if (p) opts[p[1]] = p[2].trim();
  });

  /* The three the customer is actually offered, named exactly as the email names them. */
  check('the three RSVP answers are named as the email names them',
    opts.yes === 'Yes' && opts.no === 'No' && opts.backnextyear === 'Back Next Year',
    'the office has to match these against the buttons a customer pressed; got ' +
    JSON.stringify({yes: opts.yes, no: opts.no, backnextyear: opts.backnextyear}));

  /* ⚠ AND ALL FIVE STATES ARE STILL OFFERED. Renaming must not quietly drop one —
     Pending and Unanswered are different questions and both have to be settable. */
  check('and all five states are still offered',
    Object.keys(opts).length === 5 && '' in opts && 'unanswered' in opts,
    'got ' + JSON.stringify(Object.keys(opts)));
}

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
