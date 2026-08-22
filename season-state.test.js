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
  /* ⚠ IT MUST NOT WRITE maybeNextYear — READING IT IS FINE. The first version of
     this banned the WORD anywhere in the function, and on 2026-08-22 that fired on a
     perfectly correct read (`oldData.maybeNextYear === true`, deciding whether this
     is somebody coming back in). A check that cannot tell a read from a write is a
     check that gets edited away the first time it cries wolf.
     The pattern below catches an object-literal `maybeNextYear:` and an assignment
     `updates.maybeNextYear =`, and deliberately does NOT catch `===`. */
  check('and portalRsvp writes the status without the office flag',
    /rsvpStatus: response,/.test(updates) && !/maybeNextYear\s*[:=][^=]/.test(portalRsvp),
    'that badge is what the OFFICE sets and sees — writing it from a customer\'s own ' +
    'click overrules an office decision silently');
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
  const svrStamp = /if \(response === 'yes' && wasOut\) \{[\s\S]{0,600}updates\.rejoinedForSeasonAt/
    .test(portalRsvp);
  check('the RSVP link marks somebody who has just come back in', svrStamp,
    'without the flag the planner has no way to tell a rejoiner from anybody else');
  /* ⭐ AND WRITES THE DURABLE RECORD BESIDE IT (2026-08-22). Owner, told the marker
     was invisible: "I thought this was already visable." Two fields, two jobs — the
     instruction is consumed by the planner, the record is what the badge reads, and
     one field cannot be both without one job breaking the other. */
  check('and writes the record the badge reads, not just the instruction',
    /updates\.cameBackThisSeasonAt = admin\.firestore\.FieldValue\.serverTimestamp\(\);/
      .test(portalRsvp),
    'the instruction clears the moment they are scheduled — a badge reading it would ' +
    'vanish exactly when it started being true');
  check('and it counts BOTH ways out — an RSVP of no and Back Next Year',
    /const wasOut = wasNo \|\|[\s\S]{0,180}backnextyear/.test(portalRsvp),
    'they are different states — one recycles, one does not — but coming back from ' +
    'either one is the same event');
  /* ⚠ AND THE BADGE IS DRAWN WHERE THE OFFICE ACTUALLY LOOKS. A record nothing
     renders is the invisible marker all over again. Three surfaces, one helper —
     three hand-written copies is how one of them quietly stops matching. */
  check('one helper answers "did they change their mind"',
    !!fn('cameBackThisSeason') && !!fn('cameBackBadge'),
    'three screens drawing it by hand is three chances to disagree');
  check('and it reads the RECORD, falling back to the instruction',
    /cameBackThisSeasonAt \|\| d\.rejoinedForSeasonAt/.test(admin),
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
  check('and there is a card to list all of them',
    /key:'cameback'[\s\S]{0,200}cameBackThisSeason\(a\.data\)/.test(admin),
    'a badge you cannot filter by means opening every customer to find them');
  check('and Start New Season clears the record as well as the instruction',
    /rejoinedForSeasonAt: null,[\s\S]{0,400}cameBackThisSeasonAt: null/.test(admin),
    'a badge that survives the reset says they changed their mind this year when ' +
    'they did it last year');

  check('and the office dropdown stamps BOTH fields too',
    /newRsvp === 'yes' && \(oldRsvpForRecycle === 'no' \|\| oldRsvpForRecycle === 'backnextyear'/
      .test(admin) && /addrUpdates\.rejoinedForSeasonAt = serverTimestamp\(\);[\s\S]{0,120}addrUpdates\.cameBackThisSeasonAt = serverTimestamp\(\);/.test(admin),
    'an answer taken over the phone is how most of these will arrive, and it has to ' +
    'raise the badge as well as the instruction');

  /* ⚠ AND IT IS A ONE-SHOT INSTRUCTION, NOT A LABEL. Left standing it would fire
     again after Start New Season — when everybody is off the plan — and drop the
     whole book onto the earliest days one at a time instead of letting the builder
     lay the season out by town. */
  const placer = fn('placeRejoinersOnNextDay');
  check('the planner has a placer to run', !!placer);
  /* ⚠ BOTH HALVES, and this file has been bitten before by matching only one: the
     flag is cleared in the LOCAL cache and in Firestore, and a check that finds
     either one alone stays green with the other deleted. The mirror is what stops a
     second pass in the same session double-placing them while the write is still in
     flight; the write is what stops it surviving a reload. */
  check('and it clears the flag once they have a day — in the cache AND in Firestore',
    /d\.rejoinedForSeasonAt = null;/.test(placer) &&
    /updateDoc\([\s\S]{0,80}\{rejoinedForSeasonAt: null\}\)/.test(placer),
    'an instruction that is never withdrawn is a label, and this one would empty ' +
    'the whole book onto the first days of next season');
  check('and Start New Season clears it in the same write as the rest of the reset',
    /chargeNewMemberFee: false,[\s\S]{0,600}rejoinedForSeasonAt: null/.test(admin),
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
    /rejoin=placeRejoinersOnNextDay\(\)/.test(sync),
    'unhooked, every other check in this section still passes and no rejoiner is ' +
    'ever scheduled');
  /* ⚠ BEFORE THE TIMING SWEEP, so a house placed this tick is held to its own
     timing in the same pass rather than sitting on a wrong day until the next one. */
  check('and runs it BEFORE the timing sweep',
    sync.indexOf('placeRejoinersOnNextDay()') < sync.indexOf('enforceInstallTiming()'),
    'placed after it, a rejoiner waits five minutes to be checked against their ' +
    'own install timing');
  /* ⚠ AND A THROW IN IT CANNOT TAKE THE SYNC DOWN, same as the two beside it. */
  check('and a failure in it cannot take the sync down',
    /try\{ rejoin=placeRejoinersOnNextDay\(\); \}catch/.test(sync),
    'the town sync and the timing sweep either side of it are both wrapped');

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
