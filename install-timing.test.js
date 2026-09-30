/*
 * EARLIEST POSSIBLE / LATEST POSSIBLE — WHERE IN THE SEASON  ([[SCH-102]])
 * Added 2026-09-30. Its own file per R-018.
 *
 * Addie: "Also for earliest as possible, lastest as possible then calendar of dont do
 *         during this timeframe and during this timeframe it should be on costumers to
 *         edit there."
 *
 * The two calendars in that sentence already existed ([[SCH-98]] away dates, [[SCH-99]] the
 * wanted window) and are gated by away-calendar.test.js. What did not exist is the pair she
 * names first: the install-season mirror of the Soonest / Latest choice the TAKEDOWN season
 * has had since [[SCH-92]]. "Earliest" was half-built as the rush tick and lived on Edit
 * Customer only; "latest" had no expression anywhere in the app.
 *
 * ⛔ THE CHECK THAT EARNS THIS FILE IS THE LAPSE. A bottom tier alone would have been the
 * one rule in this app that pushes somebody OUT of the month they asked for — an October
 * customer marked latest would be passed over all month and then passed over into November,
 * silently, on a setting meant only to say "no hurry". `!pressed` is what stops that: once
 * their own window is a week from closing the late request is spent and they revert to their
 * ordinary tier with the -5 every house running out of month gets. That single condition is
 * red-checked here on its own, because deleting it leaves every other check in this file
 * green while quietly breaking the limit Addie has restated more often than any other.
 *
 * ⛔ AND THE SECOND ONE IS THAT THE MONTH DROPDOWN STILL DECIDES WHAT IT DECIDED. Every
 * preference is run with neither flag set and required to give the answer it gave before
 * this existed — the same guarantee away-calendar.test.js holds for the calendars, for the
 * same reason: these settings sit BESIDE October / November / Thanksgiving, never instead
 * of them.
 *
 * ⛔ AND THE THIRD IS THAT LATEST TOUCHES ORDER AND NOTHING ELSE. It is absent from
 * houseAllowedFrom, from houseDeadline and from every rule that can take a customer out of
 * the season, and the timing sweep is RUN to prove a latest-marked house is not moved and
 * not dropped. That is what keeps it inside the headline rule ([[SCH-85]]): a Confirmed
 * customer marked latest is ordered last and is still on a day.
 *
 * Everything about the ordering RUNS the shipped function. A regex cannot see arithmetic.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(title, ok, why) {
  if (ok) { pass++; console.log('  PASS  ' + title); }
  else { fail++; fails.push(title); console.log('  FAIL  ' + title + (why ? '\n          ' + why : '')); }
}
function suite(t) { console.log('\n=== ' + t + ' ==='); }

/* Brace-matched lift, async tried first — a plain `function NAME(` search drops the async
   keyword and hands back a body full of bare await, a parse error that kills the whole run
   as one unattributable crash. CLAUDE.md records it costing a suite three times. */
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
/* ⚠ COMMENTS STRIPPED BEFORE ANY TEXT CHECK. Every rule in this repo is explained in a
   paragraph above itself — and this feature's paragraphs NAME `lateInstall`, `rushInstall`,
   `houseAllowedFrom` and `houseDeadline` while arguing about them, so an unstripped search
   finds the argument and calls it the code. Suites 58, 274, 275, 287 and 300 each learned
   this the same way, one of them inside the comment defending the rule being checked. */
function bare(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const LF = String.fromCharCode(10);
const num = re => { const m = admin.match(re); return m ? m[1] : null; };

/* ===================================================================== */
suite('The rules exist, and the gate FAILS rather than skips without them');
const NEEDED = ['isRushInstall', 'isLateInstall', 'houseInstallPriority',
                'houseAllowedFrom', 'houseDeadline', 'deadlineIsClose',
                'newHangWaitDays', 'houseMissedCount', 'stopFlagBadges'];
{
  const missing = NEEDED.filter(n => !lift(admin, n));
  check('every piece of the pair is findable', missing.length === 0,
    'missing: ' + missing.join(', ') + ' — a gate that cannot find its target must FAIL, ' +
    'never skip: a skip reads exactly like a clean repo');
}

/* ⛔ BOTH READERS LIVE ABOVE THE SCHEDULE WIDGET. That widget is a self-contained IIFE, so
   a helper declared inside it is invisible to Add Customer and Edit Customer — the two forms
   Addie asked for this on — and the save would throw "is not defined" and take the whole
   handler with it. `isRushInstall`'s own comment records that trap; the twin inherits it. */
{
  const widget = admin.indexOf('const MARKUP=');
  const late = admin.indexOf('function isLateInstall(');
  const rush = admin.indexOf('function isRushInstall(');
  check('both readers are declared in shared scope, above the schedule widget',
    late > -1 && rush > -1 && widget > -1 && late < widget && rush < widget,
    'declared inside the widget IIFE they are invisible to both customer forms');
}

/* ===================================================================== */
suite('One answer to "did they ask to go last" — run, not read');
const READ = eval('(function(){' + lift(admin, 'isRushInstall') + LF +
  lift(admin, 'isLateInstall') + LF +
  'return {rush: isRushInstall, late: isLateInstall};})()');

check('latest is read off the record', READ.late({ lateInstall: true }) === true);
check('and nobody else is ever latest',
  READ.late({}) === false && READ.late({ lateInstall: false }) === false &&
  READ.late(null) === false && READ.late(undefined) === false,
  'the short-circuit is what makes this free for the other ~960 customers');
/* ⛔ THE ONE THAT PROTECTS A CUSTOMER, and it is arithmetic rather than a convention: the
   form is a radio group, so both-set can only arrive from an import or a hand-edited record
   — and there EARLIEST has to win. A stray "latest" pushes a house to the back of a season
   that can run out; a stray "earliest" only ever hangs somebody early. So a state nobody
   chose degrades to exactly today's behaviour. */
check('a record carrying BOTH reads as earliest, never as latest',
  READ.late({ rushInstall: true, lateInstall: true }) === false &&
  READ.rush({ rushInstall: true, lateInstall: true }) === true,
  'the safe direction: being hung early is a harm this app absorbs, being left to the end ' +
  'of a season it cannot');
/* ⚠ `=== true`, NEVER TRUTHY. These come back out of Firestore and out of imported rows, so
   a string "false" or the number 0 must not read as an answer somebody gave. */
check('a truthy non-true value is not an answer',
  READ.late({ lateInstall: 'false' }) === false && READ.late({ lateInstall: 1 }) === false,
  'read truthily, the string "false" off an import would hold that house to the end of ' +
  'the season');

/* ===================================================================== */
suite('Where in the season — the real ordering, run');
const P = (function () {
  const deps = ['isRushInstall', 'isLateInstall', 'prefSpecificDate', 'houseMissedDays',
                'houseMissedCount', 'houseInstallPriority', 'deadlineIsClose', 'houseDeadline',
                'houseAllowedFrom', 'newHangWaitDays', 'thanksgivingDate', 'isThanksgivingDay',
                'isWorkingDay', 'isoOf', 'isoToLocalDate', 'addWorkingDays',
                'workingDaysBetween', 'staffDateWindowEnd', 'anyStampMillis'];
  const bad = deps.filter(n => !lift(admin, n));
  check('every dependency of the ordering was lifted, never stubbed', bad.length === 0,
    'missing: ' + bad.join(', ') + ' — a stub here would decide the very thing under test');
  const consts = ['DEADLINE_PRESSURE_DAYS', 'NEW_HANG_TARGET_DAYS', 'NEW_HANG_LIMIT_DAYS',
                  'STAFF_DATE_WINDOW_DAYS', 'PRE_THANKSGIVING_DAYS']
    .map(n => 'const ' + n + ' = ' + num(new RegExp('const ' + n + ' = (\\d+);')) + ';').join(LF);
  return eval('(function(){' +
    'const BASE_START = new Date(2026, 9, 1);' + LF + consts + LF +
    deps.map(n => lift(admin, n)).join(LF) + LF +
    'return {tier: houseInstallPriority, from: houseAllowedFrom, until: houseDeadline,' +
    ' close: deadlineIsClose};})()');
})();

const PREFS = ['October', 'November', 'November - Before Thanksgiving',
               'After Thanksgiving', 'Normal Schedule'];
/* ⛔⛔ THE MONTH DROPDOWN STILL DECIDES WHAT IT DECIDED. Run with NEITHER flag set, every
   preference has to give the tier it gave before this change. If this block goes red, the
   new pair has eaten the old rules and the change is wrong however good the rest looks. */
check('October is still 30, November still 50, Before Thanksgiving still 30',
  P.tier({ pref: 'October' }, {}) === 30 &&
  P.tier({ pref: 'November' }, {}) === 50 &&
  P.tier({ pref: 'November - Before Thanksgiving' }, {}) === 30);
check('After Thanksgiving is still 60 and no preference is still 40',
  P.tier({ pref: 'After Thanksgiving' }, {}) === 60 &&
  P.tier({ pref: 'Normal Schedule' }, {}) === 40 && P.tier({}, {}) === 40);
check('a new hang is still 10 and a named day is still 40',
  P.tier({}, { chargeNewMemberFee: true }) === 10 &&
  P.tier({ pref: '11/9+' }, {}) === 40);
check("the office's own typed date is still 20",
  P.tier({ notBefore: '2026-10-12' }, {}) === 20);
check('and the rush tick is still 10, unchanged by any of this',
  P.tier({}, { rushInstall: true }) === 10 &&
  P.tier({ pref: 'November' }, { rushInstall: true }) === 10,
  'rushInstall is read in four places and Suite 300 fails if one stops reading it — this ' +
  'change may not touch it');

/* ⭐ THE NEW HALF. Seventy is below every month, so a house marked latest fills in at the
   very end of the season rather than at the back of its own tier. */
check('somebody who asked to go last is 70 — below every month',
  P.tier({}, { lateInstall: true }) === 70);
check('and latest is worse than the unmarked answer for every single preference',
  PREFS.every(p => P.tier({ pref: p }, { lateInstall: true }) > P.tier({ pref: p }, {})),
  PREFS.map(p => p + ': ' + P.tier({ pref: p }, {}) + ' -> ' +
    P.tier({ pref: p }, { lateInstall: true })).join('; '));
check('earliest still beats latest when a record somehow carries both',
  P.tier({}, { rushInstall: true, lateInstall: true }) === 10,
  'decided once, in isLateInstall, rather than restated in the ordering');

/* ===================================================================== */
suite('⛔ AND IT LAPSES — the check that earns this file');
/* An October house marked latest is passed over all month. What must NOT happen is that it
   is then passed over into November. `deadlineIsClose` fires a week out ([[SCH-51]]), the
   late request is spent, and they revert to their ordinary tier with the -5 that every
   house running out of month gets. 2026-10-28 is inside the last week of October. */
const LATE_OCT = '2026-10-28';
check('their own deadline is genuinely close on the day this test uses',
  P.close({ pref: 'October' }, LATE_OCT) === true,
  'if this is false the lapse checks below prove nothing — the fixture, not the rule');
check('an October house marked latest is still 70 early in the month',
  P.tier({ pref: 'October' }, { lateInstall: true }, { today: '2026-10-05' }) === 70);
check('⛔ and reverts to its ordinary October rank once the month is running out',
  P.tier({ pref: 'October' }, { lateInstall: true }, { today: LATE_OCT }) === 25 &&
  P.tier({ pref: 'October' }, {}, { today: LATE_OCT }) === 25,
  'got ' + P.tier({ pref: 'October' }, { lateInstall: true }, { today: LATE_OCT }) +
  ' — a bottom tier with no lapse pushes her October customers into November, silently, ' +
  'on a setting that only meant "no hurry"');
check('so a latest October house is not left behind a November house in the last week',
  P.tier({ pref: 'October' }, { lateInstall: true }, { today: LATE_OCT }) <
  P.tier({ pref: 'November' }, {}, { today: LATE_OCT }));
/* ⚠ AND THE ASYMMETRY IS THE RULE WORKING, NOT AN EDGE TO CLOSE. A house with no month has
   no deadline, so nothing ever fires and they genuinely go last — which is what "as late as
   possible" means for somebody who never named a month. */
check('a house with no preference has no deadline, so it never lapses and truly goes last',
  P.until({ pref: 'Normal Schedule' }) === '' &&
  P.tier({ pref: 'Normal Schedule' }, { lateInstall: true }, { today: LATE_OCT }) === 70);
check('Before Thanksgiving lapses on its own holiday window, not on October',
  P.tier({ pref: 'November - Before Thanksgiving' }, { lateInstall: true },
         { today: '2026-11-23' }) === 25 &&
  P.tier({ pref: 'November - Before Thanksgiving' }, { lateInstall: true },
         { today: '2026-10-05' }) === 70);

/* ===================================================================== */
suite('What still outranks a late request');
/* ⛔ A NEW MEMBER OUT OF TIME BEATS IT OUTRIGHT. Those branches RETURN above the late move,
   so a sale we have held a fortnight is hung whatever the box says — [[SCH-52]], and the only
   thing in this app ever put above a rush install. */
check('a new member past two weeks still comes first, late box or not',
  P.tier({}, { chargeNewMemberFee: true, lateInstall: true,
               createdAt: new Date(2026, 8, 1) }, { today: '2026-10-05' }) === -10);
/* ⛔ AND A HOUSE WE PROMISED A DAY AND MISSED STILL COMES BACK UP. The floor is applied after
   the late move, so being missed pulls them to 15 — we told them a date and did not turn up,
   which [[SCH-61]] ranks above every month. Asking to go last is not a licence to keep
   missing somebody. */
check('a missed house still climbs to 15 even when it asked to go last',
  P.tier({ missedDays: ['2026-10-14'] }, { lateInstall: true }) === 15);
check('and a pin still holds them to their exact day — latest cannot move a window',
  P.from({ stuck: '2026-11-12' }, '2026-10-01') === '2026-11-12' &&
  P.until({ stuck: '2026-11-12' }) === '2026-11-12',
  'the pin is read in houseAllowedFrom / houseDeadline, which this change does not touch');

/* ===================================================================== */
suite('A town, and the asymmetry with the rush box');
/* ⚠ `forTown` EXISTS TO STOP ONE CUSTOMER'S REQUEST INVENTING A CREW-DAY — the Darlene Price
   shape ([[SCH-54]]) — so the rush box and the office's date are both dropped for a town.
   Lowering a town's urgency cannot invent anything; it can only make a town wait, and
   nobody is stranded by that because placeConfirmedLeftOff still guarantees a day. So this
   one is NOT dropped, deliberately, and the asymmetry is asserted in both directions. */
check('the rush box is still dropped when a TOWN is asking',
  P.tier({}, { rushInstall: true }, { forTown: true }) === 40,
  'a town of one would otherwise win a crew-day of its own');
check('but a late request DOES move the town, because it can only ever make it wait',
  P.tier({}, { lateInstall: true }, { forTown: true }) === 70,
  'nothing is invented by a town waiting, and the Confirmed placer still guarantees a day');
/* ⚠ allowedStats takes the BEST number in a town, so one latest house among thirty October
   houses moves that town not at all — only a town where EVERY house asked to go last scores
   70. Asserted as the arithmetic rather than left as a claim in a comment. */
check('one latest house among October houses does not drag its town down',
  Math.min(P.tier({ pref: 'October' }, {}, { forTown: true }),
           P.tier({ pref: 'October' }, { lateInstall: true }, { forTown: true })) === 30);

/* ===================================================================== */
suite('⛔ IT TOUCHES ORDER AND NOTHING ELSE — so nobody can fall off a day');
/* Every claim below is the headline rule ([[SCH-85]]) from a different side: a Confirmed
   customer marked latest is ordered last and is STILL ON A DAY. */
const FROM_SRC = bare(lift(admin, 'houseAllowedFrom'));
const UNTIL_SRC = bare(lift(admin, 'houseDeadline'));
check('the floor does not read the late flag',
  FROM_SRC.indexOf('lateInstall') === -1 && FROM_SRC.indexOf('isLateInstall') === -1,
  'in houseAllowedFrom it would become a date rule and could hold somebody out of a month');
check('and neither does the ceiling',
  UNTIL_SRC.indexOf('lateInstall') === -1 && UNTIL_SRC.indexOf('isLateInstall') === -1,
  'in houseDeadline it could hand the tail packer an impossible window, which reads as ' +
  '"never move this house"');
/* Run as well as read: the allowed window is byte-identical with and without the flag, for
   every preference. That is the "never moves them into a month they did not ask for"
   promise as arithmetic rather than as a sentence on a form. */
check('the allowed window is identical with and without the late flag, for every preference',
  PREFS.every(p => P.from({ pref: p }, '2026-10-01') === P.from({ pref: p, lateInstall: true }, '2026-10-01') &&
                   P.until({ pref: p }) === P.until({ pref: p, lateInstall: true })),
  'a latest customer is ordered last INSIDE their own window, never given a different one');
/* ⛔ AND IT IS IN NO RULE THAT CAN TAKE SOMEBODY OUT OF THE SEASON. A flag read there would
   be the headline rule broken in silence — absent from the plan is how this app says a
   customer said no. */
['isOutForSeason', 'confirmedNotOnAnyDay', 'seasonBadgeKey', 'isHeldFromRoutes',
 'scheduleHoldEndsMillis'].forEach(function (fn) {
  const src = bare(lift(admin, fn));
  check(fn + ' does not read the late flag', src !== '' && src.indexOf('lateInstall') === -1,
    src === '' ? fn + ' could not be lifted — the check must fail, not skip'
               : 'a late request that could take somebody OUT of the season would leave a ' +
                 'Confirmed customer off the schedule, which [[SCH-85]] forbids outright');
});

/* ⛔ AND THE TIMING SWEEP IS RUN. `lateInstall` is not a date rule, so the sweep — which
   moves any house that is in the wrong PLACE, on every customer change and on a five-minute
   timer — must leave a latest-marked house exactly where it is and must not drop it. This is
   the runtime half of "it touches order and nothing else"; the reads above are the static
   half, and neither alone would catch the flag leaking into a placement decision. */
{
  const names = ['dayTownList', 'dayTownCount', 'maxTownsPerDay', 'thanksgivingDate',
                 'isThanksgivingDay', 'isWorkingDay', 'isoToLocalDate', 'addWorkingDays',
                 'staffDateWindowEnd', 'prefSpecificDate', 'houseAllowedFrom', 'houseDeadline',
                 'awayDayAfter', 'awayKeyToList', 'houseAwayOn', 'awayClearFrom',
                 'nextInstallDayFor', 'enforceInstallTiming'];
  const absent = names.filter(n => !lift(admin, n));
  check('the timing sweep and everything it calls were lifted', absent.length === 0,
    'missing: ' + absent.join(', '));
  const BODY = 'const AWAY_MAX_RANGES=' + num(/const AWAY_MAX_RANGES = (\d+);/) + ';' + LF +
    (admin.match(/const AWAY_ISO_DAY = [^;]+;/) || [''])[0] + LF +
    'const MAX_TOWNS_PER_CREW=' + num(/const MAX_TOWNS_PER_CREW = (\d+);/) + ';' + LF +
    'const STAFF_DATE_WINDOW_DAYS=' + num(/const STAFF_DATE_WINDOW_DAYS = (\d+);/) + ';' + LF +
    'const PRE_THANKSGIVING_DAYS=' + num(/const PRE_THANKSGIVING_DAYS = (\d+);/) + ';' + LF +
    'const CREWS_PER_DAY=2;' + LF + 'function dayLimitFor(){return null;}' + LF +
    names.map(n => lift(admin, n)).join(LF) + LF + 'this.sweep = enforceInstallTiming;';
  const sweepOnce = function (house, onIso) {
    const SEASON = [{ id: 'd1', _iso: '2026-11-12', houses: [] },
                    { id: 'd2', _iso: '2026-11-25', houses: [] }];
    SEASON.filter(d => d._iso === onIso)[0].houses.push(house);
    const ctx = {};
    new Function('SEASON', 'isoOf', 'seasonStartDate', 'dayDate', 'extractCleanCity',
      'maxStopsPerWorkingDay', 'BASE_START', 'routeDayIsLocked', BODY)
      .call(ctx, SEASON,
        d => d.toISOString().slice(0, 10),
        () => new Date(2026, 9, 1),
        d => new Date(d._iso + 'T00:00:00'),
        c => String(c == null ? '' : c).trim(),
        () => 40, new Date(2026, 9, 1), () => false);
    const res = ctx.sweep();
    const on = SEASON.filter(d => (d.houses || []).indexOf(house) !== -1)[0];
    return { landed: on ? on._iso : null, moved: res.moved.length };
  };
  const H = o => Object.assign({ id: 'h', name: 'Test', city: 'Lehi', pref: 'November' }, o);
  {
    const r = sweepOnce(H({ lateInstall: true }), '2026-11-12');
    check('the sweep leaves a latest-marked house on its day and does not drop it',
      r.landed === '2026-11-12' && r.moved === 0,
      'landed on ' + r.landed + ', moved ' + r.moved + ' — asking to go last changes the ' +
      'ORDER within a day, never which day, and never whether they have one');
  }
  {
    const r = sweepOnce(H({ rushInstall: true }), '2026-11-25');
    check('and it leaves an earliest-marked house alone too, exactly as before',
      r.landed === '2026-11-25' && r.moved === 0, 'landed on ' + r.landed);
  }
}

/* ===================================================================== */
suite('The nightly sweep and the Schedule cannot disagree about who goes last');
/* `installPriority`'s own comment is the rule here: the two planners must not disagree about
   who is in a hurry, so the rush flag is read on the pool sort that feeds fillDays. The late
   flag is read in the same place for the same reason — this sweep has no month TIER for a
   late request to sit below, it has this sort. */
{
  const pool = bare(admin.slice(admin.indexOf('pool.push({id: a.id'),
                                admin.indexOf('const topped = fillDays')));
  check('the nightly pool records who asked to go last', /late:\s*isLateInstall\(d\)/.test(pool),
    'without it Recalculate everything and the 15-minute sweep order the same book two ways');
  check('and sorts them behind everybody', /a\.late\s*\?\s*1\s*:\s*0/.test(pool) &&
    /b\.late\s*\?\s*1\s*:\s*0/.test(pool));
  /* ⛔ A TIEBREAK BELOW THE RUSH KEY, NEVER A KEY ABOVE IT. The rush comparison has to be
     able to return first, or a record carrying both flags is ordered by the wrong one —
     the same direction isLateInstall settles. */
  check('the rush key still decides first, and late only breaks its tie',
    pool.indexOf('br - ar') > -1 && pool.indexOf('br - ar') < pool.indexOf('a.late'),
    'sorted on late first, a both-set record would be pushed to the back of the season');
}

/* ===================================================================== */
suite('Both forms ask it, and both record it');
/* ⭐ "IT SHOULD BE ON COSTUMERS TO EDIT THERE" — BOTH FORMS. Edit Customer has carried the
   rush tick since [[SCH-44]]; Add a Customer had neither half, so a customer typed in with a
   request to go sooner had to be saved and re-opened to record it. */
[['addCust', 'addCustSeasonPos'], ['editCust', 'editCustSeasonPos']].forEach(function (pair) {
  const p = pair[0], group = pair[1];
  ['PosNormal', 'RushInstall', 'LateInstall'].forEach(function (id) {
    check(p + ' offers ' + id, admin.indexOf('id="' + p + id + '"') > -1);
  });
  /* ⚠ ONE RADIO GROUP, WHICH IS WHAT MAKES THEM ONE CHOICE. Three loose checkboxes and both
     flags can be ticked from the form, at which point isLateInstall's both-set rule stops
     being a guard against bad DATA and becomes a guard against this screen. */
  check(p + ' makes them one choice, not three loose ticks',
    (admin.match(new RegExp('name="' + group + '"', 'g')) || []).length === 3 &&
    (admin.match(new RegExp('id="' + p + 'RushInstall"[^>]*type="checkbox"')) || []).length === 0,
    'read as separate ticks the office could set both, and one of the two would be ignored');
});
/* ⚠ NORMAL IS SET EXPLICITLY on the way in, not left to fall out of the other two being
   false. An empty radio group reads on screen as a control that failed to load, and the save
   would then find neither and could never tell "normal" from "the form never filled in". */
{
  const open = bare(admin.slice(admin.indexOf('const posRush ='),
                                admin.indexOf('const posRush =') + 900));
  check('Edit Customer ticks Normal explicitly when neither flag is set',
    /editCustPosNormal'\)\.checked = !posRush && !posLate/.test(open),
    'left unticked the group is empty, which reads as a broken control');
  check('and it fills both halves from the record',
    /editCustRushInstall'\)\.checked = posRush/.test(open) &&
    /editCustLateInstall'\)\.checked = posLate/.test(open));
}
/* ⛔ WRITTEN UNCONDITIONALLY, both of them. An `if (newLateInstall)` would make "latest" a
   one-way door with nothing on screen able to undo it — the same trap `blankClears` exists
   for on the calendar fields. */
{
  const save = bare(admin.slice(admin.indexOf('addrUpdates.rushInstall'),
                                admin.indexOf('addrUpdates.rushInstall') + 700));
  check('the Edit Customer save writes both, always, so Normal can take an answer back',
    /addrUpdates\.rushInstall = newRushInstall === true;/.test(save) &&
    /addrUpdates\.lateInstall = newLateInstall === true;/.test(save),
    'written conditionally, picking Normal would leave the old answer in place');
}
{
  const add = bare(admin.slice(admin.indexOf('stuckOnDate: newCalendar.fields.stuckOnDate'),
                               admin.indexOf('chargeNewMemberFee: chargeNewMemberFee')));
  check('Add a Customer writes both onto the new record',
    /rushInstall: rushInstall === true/.test(add) && /lateInstall: lateInstall === true/.test(add));
}
/* ⚠ AND THE FORM IS PUT BACK TO NORMAL AFTER A SAVE, or the next customer typed in silently
   inherits the last one's place in the season with nothing on the new record saying why. */
/* ⚠ THE END ANCHOR IS SOUGHT **AFTER** THE START, and that is not a nicety: the first draft
   of this check sliced to `indexOf("awayFillHost('addCustAwayList', [])")`, which also spells
   the start-up call thousands of lines EARLIER — so the slice came back backwards and empty,
   and the check failed on correct code. The anchors-matched-twice trap CLAUDE.md records for
   Suites 82, 129 and the folder-names suite. */
{
  const at = admin.indexOf("document.getElementById('addCustInstallPref').value = 'Normal Schedule'");
  const end = admin.indexOf("awayFillHost('addCustAwayList', [])", at);
  check('the Add a Customer reset block was found, both ends of it', at > -1 && end > at,
    'an empty slice makes every check below it pass or fail for the wrong reason');
  const reset = bare(admin.slice(at, end));
  check('the Add a Customer form resets to Normal',
    /addCustPosNormal'\)\.checked = true/.test(reset) &&
    /addCustRushInstall'\)\.checked = false/.test(reset) &&
    /addCustLateInstall'\)\.checked = false/.test(reset),
    'the next customer would inherit the last one\'s place in the season');
}

/* ===================================================================== */
suite('The office can see it, and the season forgets it');
/* ⚠ A BADGE, because "why is this house at the BACK of the route" is asked as often as why
   one is at the front — and without an answer on screen the office re-orders the day by hand
   and the next sweep puts it back. Same reason ASKED SOONER, MISSED and 📌 STUCK are badges. */
/* ⛔ RUN, NOT MATCHED, and the red-check is why. The first draft of this block tested that
   `isLateInstall(cust&&cust.data)` APPEARED in the renderer — and a sabotage turning the
   whole branch into `if(false && ...)` sailed straight through it, because every character
   the check was looking for was still there. A text check cannot tell a live guard from a
   dead one; the renderer is executed against a fake customer instead. The `if(false &&`
   trap, which rsvp-text-link.test.js hit in exactly the same shape. */
{
  const BADGE = eval('(function(){' +
    [lift(admin, 'isRushInstall'), lift(admin, 'isLateInstall'),
     lift(admin, 'houseMissedDays'), lift(admin, 'houseMissedCount'),
     lift(admin, 'stopFlagBadges')].join(LF) + LF +
    'function esc(s){return String(s==null?"":s);}' + LF +
    /* The house carries its own customer here, so the ONE thing being tested is which
       badges the renderer emits for which flag. */
    'function customerForHouse(h){return {data: h.cust || {}};}' + LF +
    'function stuckDayOf(h){return (h && h.stuck) || "";}' + LF +
    'return stopFlagBadges;})()');
  check('the day panel badges a house that asked to go last',
    BADGE({ cust: { lateInstall: true } }).indexOf('latebadge') > -1 &&
    BADGE({ cust: { lateInstall: true } }).indexOf('ASKED LATER') > -1,
    'got: ' + BADGE({ cust: { lateInstall: true } }));
  check('and it still badges one that asked to go sooner',
    BADGE({ cust: { rushInstall: true } }).indexOf('rushbadge') > -1 &&
    BADGE({ cust: { rushInstall: true } }).indexOf('ASKED SOONER') > -1);
  /* ⚠ AND AN ORDINARY HOUSE GETS NEITHER. Without this the block passes on a renderer that
     badges everybody, which is worse than badging nobody: ~950 rows of noise and the two
     badges that mean something lost in it. */
  check('an ordinary house is badged neither way',
    BADGE({ cust: {} }) === '' && BADGE({}) === '');
  /* ⚠ A RECORD CARRYING BOTH SHOWS ONE BADGE, THE ONE THAT DECIDES. Two contradictory
     badges on one name is the screen arguing with itself about which rule ran. */
  check('a record carrying both flags shows ASKED SOONER only',
    BADGE({ cust: { rushInstall: true, lateInstall: true } }).indexOf('ASKED SOONER') > -1 &&
    BADGE({ cust: { rushInstall: true, lateInstall: true } }).indexOf('ASKED LATER') === -1);
  /* ⚠ AND THE OTHER BADGES STILL WORK. This renderer was edited, so the check that it was
     not broken in passing belongs here rather than being assumed. */
  check('the missed and stuck badges still render',
    BADGE({ missedDays: ['2026-10-14'], cust: {} }).indexOf('missbadge') > -1 &&
    BADGE({ stuck: '2026-11-12', cust: {} }).indexOf('stuckbadge') > -1);
  check('the badge has a style, so it is not invisible white-on-white',
    admin.indexOf('.latebadge{display:inline-block') > -1,
    'the widget is a shadow root — an unstyled class inherits nothing');
}
/* ⚠ IN THE HISTORY, because it moves this customer to the END of the season, so "why were
   they so late" is a question somebody will ask. An unlabelled field makes the edit
   invisible, which reads exactly like the setting never having been touched. */
check('both halves are labelled for the customer history',
  /rushInstall: \{label: 'Moved up the schedule', kind: 'yesno'\}/.test(admin) &&
  /lateInstall: \{label: '[^']+', kind: 'yesno'\}/.test(admin));
/* ⛔ AND START NEW SEASON CLEARS BOTH ([[SCH-93]] applied to the same question: "yes clear it
   each season"). Somebody who asked to go early — or last — this year has not asked for next
   year. ⚠ THIS IS A CHANGE TO `rushInstall`, which nothing had ever cleared, and it is
   checked here so it cannot quietly come undone: left standing, the pair would be asymmetric
   on one radio group, Latest forgotten each season and Earliest remembered for ever. */
{
  const reset = bare(admin.slice(admin.indexOf('takedownTiming: null'),
                                 admin.indexOf('chargeNewMemberFee: false')));
  check('Start New Season clears BOTH halves of the pair',
    /rushInstall: false/.test(reset) && /lateInstall: false/.test(reset),
    'a phone call made last October would otherwise move that house up the schedule for ever');
  check('and it is the same write as the rest of the customer reset',
    reset.length > 0 && reset.indexOf('updateDoc') === -1 && reset.indexOf('await') === -1,
    'a separate write can fail on its own and leave half the season reset');
}

/* ===================================================================== */
console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
