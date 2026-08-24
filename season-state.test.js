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

/* ⚠ audienceIsNew LIFTED, NOT LEFT OUT — isOutForSeason guards its call with typeof,
   so omitting it silently skips the new-hang exemption instead of throwing. */
const audienceIsNewSrc = fn('audienceIsNew');
check('audienceIsNew is there to lift', !!audienceIsNewSrc,
  'without it the confirmed-only new-hang exemption is untested, silently');
const outForSeason = new Function('d',
  eligLine + audienceIsNewSrc + src.isOutForSeason + 'return isOutForSeason(d);');
/* The strict mode the owner is aiming at, so the rule is proved before it is live. */
const outStrict = new Function('d',
  "const SEASON_ELIGIBILITY = 'confirmed-only';" + audienceIsNewSrc + src.isOutForSeason +
  'return isOutForSeason(d);');

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

/* ⭐ ONE ANSWER FOR A YES, THREE DOORS (2026-08-22). The RSVP link, the office
   dropdown and approving a quote all mean the same thing, and seasonYesUpdates is the
   one place that says what a yes does. RUN, not read: a yes that only sets the status
   leaves the warehouse still queued to take their bundle apart, and that is a fact
   about behaviour, not about text. */
const yesAt = server.indexOf('function seasonYesUpdates');
const yesSrc = yesAt === -1 ? '' : server.slice(yesAt, server.indexOf('\n}', yesAt) + 2);
check('the server has one rule for what a yes does', !!yesSrc,
  'three doors writing their own version is three chances for one to do half the job');

if (yesSrc) {
  const fakeAdmin = { firestore: { FieldValue: { serverTimestamp: () => 'NOW' } } };
  const yes = new Function('admin', yesSrc + 'return seasonYesUpdates;')(fakeAdmin);

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
  check('the RSVP link answers a yes through it',
    /\(response === 'yes'\)\s*\n?\s*\? seasonYesUpdates\(oldData\)/.test(portalRsvp),
    'it used to be the only door that did the whole job');
  check('and approving a quote goes through it too',
    /update\(seasonYesUpdates\(memberRef\.data \|\| \{\}\)\)/.test(server),
    'owner, 2026-08-22: "go with option 2" — approving a quote is a yes now, and a ' +
    'status-only write would leave them in the season AND queued for recycle');
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
  check('and Start New Season clears the record as well as the instruction',
    /needsDayAssignedAt: null,[\s\S]{0,400}cameBackThisSeasonAt: null/.test(admin),
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
