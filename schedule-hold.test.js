/*
 * THE SCHEDULE HOLD, AND WHERE AN APPROVED RE-QUOTE LANDS  (QT-21, 2026-08-31)
 *
 * Addie, in three messages:
 *   "as long as they kept details the same that should just be put in schedule
 *    after we price them but if they did get changes on houses than that gets
 *    sent to warehouse and isnt scheduled until 48 hours after sent to warehouse"
 *   "requote is same thing if requoted than it should be assigned after 48 hours"
 *   "lets do 72 hours instead of 48 hours then. And this is only bussiness hours
 *    not counting weekends"
 *
 * Asked which of the two readings of that last one she meant, she chose THREE
 * WORKING DAYS — the clock runs all 24 hours of Mon-Fri and pauses at weekends
 * and on Thanksgiving.
 *
 * Everything here RUNS the shipped functions. Every claim is about a DATE THE
 * ARITHMETIC PRODUCES or a FOLDER A CARD LANDS IN, and a regex cannot see either.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fns = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(title, ok, why) {
  if (ok) { pass++; console.log('  PASS  ' + title); }
  else { fail++; fails.push(title); console.log('  FAIL  ' + title + (why ? '\n          ' + why : '')); }
}
function suite(t) { console.log('\n=== ' + t + ' ==='); }

/* Brace-matched lift, async tried first — extractFn drops the keyword and hands
   back a body full of bare await, which is a parse error that kills the run as one
   unattributable crash. Written down in CLAUDE.md and it has cost a suite twice. */
function lift(src, name) {
  let at = src.indexOf('async function ' + name + '(');
  if (at < 0) at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  let d = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (!d) return src.slice(at, i + 1); }
  }
  return '';
}

suite('The 72-working-hour hold — run, not read');
{
  const names = ['thanksgivingDate', 'isThanksgivingDay', 'isWorkingDay', 'scheduleHoldUntil'];
  const src = names.map(n => lift(admin, n)).join('\n');
  check('every piece of the hold is findable', names.every(n => lift(admin, n)),
    'a gate that cannot find its target must FAIL, never skip');
  const hoursConst = admin.match(/const SCHEDULE_HOLD_HOURS = (\d+);/);
  check('the hold length is a named constant', !!hoursConst,
    'a 72 written into the arithmetic is a 72 that drifts from the one in the comment');
  check('and it is 72, which is what she asked for',
    hoursConst && hoursConst[1] === '72',
    'got ' + (hoursConst && hoursConst[1]));

  if (src && hoursConst) {
    const hold = new Function('const SCHEDULE_HOLD_HOURS=' + hoursConst[1] + ';' + src +
      '\nreturn scheduleHoldUntil;')();
    const at = (y, m, d, h) => new Date(y, m, d, h).getTime();
    const shows = t => new Date(t).toDateString() + ' ' + new Date(t).toTimeString().slice(0, 5);

    /* ⭐ HER OWN THREE EXAMPLES, from the option she picked. */
    check('Friday 2pm lands Wednesday 2pm',
      shows(hold(at(2026, 9, 2, 14))) === 'Wed Oct 07 2026 14:00',
      'got ' + shows(hold(at(2026, 9, 2, 14))));
    check('Monday 9am lands Thursday 9am',
      shows(hold(at(2026, 9, 5, 9))) === 'Thu Oct 08 2026 09:00',
      'got ' + shows(hold(at(2026, 9, 5, 9))));
    check('Wednesday 4pm lands Monday 4pm — the weekend costs nothing',
      shows(hold(at(2026, 9, 7, 16))) === 'Mon Oct 12 2026 16:00',
      'got ' + shows(hold(at(2026, 9, 7, 16))));

    /* ⚠ A HOLD THAT STARTS ON A NON-WORKING DAY spends none of its budget there.
       Without this a Saturday re-quote would burn two of its three days before
       anybody was at work. */
    check('a Saturday start spends nothing until Monday',
      shows(hold(at(2026, 9, 3, 10))) === 'Thu Oct 08 2026 00:00',
      'got ' + shows(hold(at(2026, 9, 3, 10))));

    /* ⚠ THANKSGIVING PAUSES IT TOO — her answer, and it comes free from reusing
       isWorkingDay. Mon 23 Nov 2026 + 72 working hours crosses Thanksgiving on the
       Thursday, so it lands Friday rather than Thursday. */
    check('Thanksgiving week pushes past the holiday',
      shows(hold(at(2026, 10, 23, 9))) === 'Fri Nov 27 2026 09:00',
      'got ' + shows(hold(at(2026, 10, 23, 9))) + ' — the crew calendar skips ' +
      'Thanksgiving and she asked for this to skip it too');

    /* ⚠ IT ALWAYS MOVES FORWARD. A hold that resolved to the past would release a
       house the moment it was queued, which is the bug wearing a fix's clothes. */
    const t0 = at(2026, 9, 5, 9);
    check('the answer is always later than the start',
      hold(t0) > t0 && hold(at(2026, 9, 3, 10)) > at(2026, 9, 3, 10));
    check('a missing or junk start holds nothing rather than guessing',
      hold(0) === 0 && hold(undefined) === 0 && hold(NaN) === 0,
      'a hold computed from no date at all is a number nobody can defend');
  }

  /* ⚠ ONE DEFINITION OF A WORKING DAY. A second weekend rule here is two calendars
     that drift, and the one nobody looks at is the one that goes wrong. */
  const holdSrc = lift(admin, 'scheduleHoldUntil');
  check('it asks isWorkingDay rather than testing the day itself',
    /isWorkingDay\(/.test(holdSrc) && !/getDay\(\)/.test(holdSrc),
    'the crew calendar and the hold must never disagree about what a working day is');
}

suite('The hold is NOT the free-colour-change window');
{
  /* ⚠ THE MONEY GUARD, AND THE REASON THIS IS A SEPARATE FIELD. applyLightChange
     decides whether a colour change is FREE with `withinFreeWindow = lockedUntil >
     now` against lightsLockedUntil. Stretching that field to 72 hours to satisfy a
     SCHEDULING request would quietly widen the fee-free window and charge the $30
     less often — a change to what customers pay that she never asked for. */
  const money = fs.readFileSync(path.join(ROOT, 'js', 'money.js'), 'utf8');
  const win = money.match(/export const LIGHT_WINDOW_MS = ([^;]+);/);
  check('the free-change window is still findable', !!win);
  check('and it is still 48 hours, untouched',
    win && /48 \* 60 \* 60 \* 1000/.test(win[1]),
    'got ' + (win && win[1]) + ' — widening this is a money change, not a scheduling one');
  check('the hold writes its own field, never lightsLockedUntil',
    /addrUpdates\.scheduleHoldUntil = /.test(admin) &&
    !/addrUpdates\.scheduleHoldUntil = new Date\(Date\.now\(\) \+ LIGHT_WINDOW_MS\)/.test(admin),
    'one field for two rules is how a scheduling change starts costing money');
}

suite('Sent to the warehouse means held — at one hook, and only when newly queued');
{
  const hookRe = /if\(addrUpdates\.needsLightBuild === true && !item\.data\.needsLightBuild\)\{[\s\S]{0,200}?scheduleHoldUntil/;
  check('the hold is set where the build is newly queued', hookRe.test(admin),
    'every route in — a re-quote topping up, a re-quote rebuilding, a colour, wire or ' +
    'timer change — ends at needsLightBuild going ON, so the hold belongs there and ' +
    'not in the re-quote branch alone');
  /* ⚠ ONLY WHEN NEWLY QUEUED. Without the second half of that test, an office that
     opens a record twice pushes the hold out again and keeps a built house off the
     routes for ever. */
  check('and NOT on a save that leaves it already queued',
    /&& !item\.data\.needsLightBuild\)/.test(admin),
    'reopening a record would extend the hold every time');

  /* ⚠ ALL THREE ROUTE CONSUMERS ASK THE SHARED QUESTION. A caller that honours one
     hold and forgets the other is how the sweep and the builder came to disagree
     about who was in the season — this file already carries that scar. */
  check('the route builder asks isHeldFromRoutes',
    /\(isTest \|\| !isHeldFromRoutes\(a\.data\)\)/.test(admin));
  check('so does the leftover check', /return a && isHeldFromRoutes\(a\.data\);/.test(admin));
  /* ⚠ REWRITTEN 2026-09-04. The third consumer was customersMissingFromSeason, which
     used a live hold to keep a customer OFF the plan altogether — the bug Addie reported
     as "some people are confirmed but still arent in schedule and I dont know why". The
     schedule now asks the same hold for a DATE instead (houseHoldFrom) and gives them the
     first day after it, so the rule is kept and nobody disappears. What matters here is
     unchanged and is what this checks: there is still exactly ONE place that knows about
     the two hold fields, and every consumer comes through it. */
  check('the schedule reads the same hold, as the earliest day it allows',
    /function houseHoldFrom\(/.test(admin) && /scheduleHoldEndsMillis\(custData\)/.test(admin),
    'a second reader of lightsLockedUntil and scheduleHoldUntil is how the plan and the ' +
    'routes start disagreeing about who may go out');
  check('and the yes/no answer is derived from that one reader, not a second copy',
    /function isHeldFromRoutes\(d\)\{ return scheduleHoldEndsMillis\(d\) > 0; \}/.test(admin),
    'two functions reading the same two fields is the drift this file already has a ' +
    'scar from');
  check('and no route filter still asks the old lock alone',
    !/!isLightsLocked\(a\.data\)/.test(admin),
    'a filter left on the colour-change lock would route a house whose bundle is unbuilt');

  const heldSrc = lift(admin, 'scheduleHoldEndsMillis');
  check('the shared question asks BOTH holds',
    /lightsLockMillis\(d\)/.test(heldSrc) && /scheduleHoldMillis\(d\)/.test(heldSrc),
    'dropping either one silently releases a house early');
  /* ⭐ AND THE PATHS THAT QUEUE A BUILD WITHOUT STAMPING A HOLD (2026-09-04). Her rule
     was only ever true for the one save that wrote the field. */
  check('and it derives her 72 hours where no hold was stamped',
    /needsLightBuild === true/.test(heldSrc) && /lightsQueuedAt/.test(heldSrc),
    'six of the seven paths that queue a build never write scheduleHoldUntil, so the ' +
    'rule reached none of them');
  check('but a queued build with no queue date on it holds nobody',
    /if\(queued\)/.test(heldSrc),
    'treating "unknown" as "now" restarts the clock every rebuild — a for-ever hold ' +
    'wearing a timestamp, which is the bug this whole change exists to remove');
}

suite('An approved re-quote reaches Ready to Convert');
{
  const names = ['quoteWasSentOut', 'quoteHasBeenSent', 'isRequote', 'quoteAlreadyACustomer', 'quoteStage'];
  const src = names.map(n => lift(admin, n)).join('\n');
  check('quoteStage and its dependencies are findable', names.every(n => lift(admin, n)));
  if (src) {
    const stage = new Function('jobAddresses', src + '\nreturn quoteStage;')([]);
    const sent = { quoteSentAt: { toDate: () => new Date() }, quoteManuallySent: true };
    const base = Object.assign({ quotedPrice: 400, status: 'new' }, sent);
    const S = extra => stage(Object.assign({}, base, extra));

    check('a member who said nothing is changing lands in Ready to Convert',
      S({ approvalStatus: 'approved', memberKeptDetails: true, existingCustomerId: 'c1' }) === 'form',
      'this is the whole bug: they are never shown the form, so nothing marked them done');
    /* ⚠ AND NOT BEFORE THEY ANSWER. Approving is not the same as settling the
       details — the three buttons come after the approval, and a card that jumped
       to Ready to Convert on approval alone would be back to guessing. */
    check('but an approval alone is still Awaiting Response',
      S({ approvalStatus: 'approved', existingCustomerId: 'c1' }) !== 'form',
      'they have not answered the "anything changing?" question yet');
    check('the two older routes still work',
      S({ approvalStatus: 'approved', formCompleted: true }) === 'form' &&
      S({ approvalStatus: 'approved', approvedByOffice: true }) === 'form',
      'the new case must be an addition, never a replacement');
    check('and a declined quote is untouched by any of it',
      S({ approvalStatus: 'declined', memberKeptDetails: true }) === 'closed');
  }
}

suite('The member answer is recorded, on the server, only on an approved quote');
{
  const fn = lift(fns, 'quoteMemberKeptDetails') ||
    (fns.indexOf('exports.quoteMemberKeptDetails') >= 0 ? fns.slice(
      fns.indexOf('exports.quoteMemberKeptDetails'),
      fns.indexOf('exports.quoteSaveDetails')) : '');
  check('the callable exists', !!fn);
  check('it finds the quote by token, like every other quote callable',
    /where\('quoteToken', '==', quoteToken\)/.test(fn),
    'a second way of resolving a quote is a second thing to keep in step');
  /* ⚠ A quoteToken IS MINTED IN THE VISITOR'S OWN BROWSER, so possessing one proves
     nothing. Without the approval test this would let anybody holding a token mark a
     quote settled and push it into the office's convert queue. */
  check('and it refuses a quote that has not been approved',
    /approvalStatus[\s\S]{0,80}!== 'approved'[\s\S]{0,160}HttpsError/.test(fn),
    'a token alone must never be able to settle a quote');
  check('it writes its own field, not formCompleted',
    /memberKeptDetails: true/.test(fn) && !/formCompleted: true/.test(fn),
    'faking formCompleted would make Ready to Convert lie about where the details came from');
  check('and it writes nothing about the house',
    !/lightColors|lightsDescription|needsLightBuild|wireColor/.test(fn),
    '"nothing is changing" is the whole claim — queueing a build would contradict it');

  /* The customer side actually calls it. */
  check('the No-keep-everything-the-same button calls it',
    /callPortalFn\('quoteMemberKeptDetails'/.test(index),
    'without the call the card sticks in Awaiting Response exactly as before');
  check('and a failure there is logged, not swallowed',
    /quoteMemberKeptDetails'[\s\S]{0,200}console\.error/.test(index),
    'nothing should fail quietly');
}

console.log('\n' + '='.repeat(55));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(55) + '\n');
process.exit(fail ? 1 : 0);
