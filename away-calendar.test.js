/*
 * THEIR OWN CALENDAR — AWAY DATES, AND WHEN THEY WANT US  ([[SCH-98]], [[SCH-99]])
 * Added 2026-09-28. Its own file per R-018.
 *
 * Addie, in two messages:
 *   "Can we do a calendar for members for when they will be gone and not schedule them
 *    during that time frame and be able to add that on costumers?"
 *   "Also a calendar timeframe of when they want to be scheduled. But still keep be done
 *    in october, november before thanksgiving after thanksgiving?"
 *
 * TWO CALENDARS OF OPPOSITE SHAPES, which is why they are not one field:
 *   · AWAY is a HOLE. Nothing in this app could express one before — every date rule is
 *     a floor (houseAllowedFrom) or a ceiling (houseDeadline), and neither can say "any
 *     day but these". So away is asked PER CANDIDATE DAY, at eight sites.
 *   · WANTED is a WINDOW, so it rides the two functions that already do floors and
 *     ceilings rather than becoming a third mechanism.
 *
 * ⛔ THE CHECK THAT EARNS THIS FILE IS THE HEADLINE RULE. Both of these can only ever
 * move somebody LATER; neither may leave a Confirmed customer off a day. The builder's
 * jump-to-the-next-open-date step is where that could have broken silently — crews free,
 * everybody away, `break`, and the rest of the season falls out with no message — so it
 * is asserted by RUNNING the real builder against a town that is entirely away.
 *
 * ⛔ AND THE SECOND ONE IS THAT THE MONTH DROPDOWN STILL DECIDES WHAT IT DECIDED. That
 * was the whole of her second sentence. Every preference is run with no calendar set and
 * required to give the answer it gave before this existed.
 *
 * Everything here RUNS the shipped code. Every claim is about WHICH DAY A HOUSE LANDS
 * ON, and a regex cannot see a date.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
/* ⚠ ANYTHING ASYNC GOES ON HERE AND THE SUMMARY AWAITS IT. A check that scores AFTER the
   summary has printed can never fail the build — it reports into nothing. Same reason
   run-all.js keeps its own pendingAsync list. */
const pendingAsync = [];
function check(title, ok, why) {
  if (ok) { pass++; console.log('  PASS  ' + title); }
  else { fail++; fails.push(title); console.log('  FAIL  ' + title + (why ? '\n          ' + why : '')); }
}
function suite(t) { console.log('\n=== ' + t + ' ==='); }

/* Brace-matched lift, async tried first — a plain `function NAME(` search drops the
   async keyword and hands back a body full of bare await, which is a parse error that
   kills the whole run as one unattributable crash. CLAUDE.md records it costing a suite
   three times. */
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
/* ⚠ COMMENTS STRIPPED BEFORE ANY TEXT CHECK. Suites 58, 274, 275, 287 and 300 each had
   to learn this the same way: every rule in this repo is explained in a paragraph above
   itself, so a plain search finds the explanation and calls it the code. */
function bare(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const LF = String.fromCharCode(10);

/* ===================================================================== */
suite('The rules exist, and the gate fails rather than skips without them');
const NEEDED = ['awayDayAfter', 'awayListToKey', 'awayKeyToList', 'houseAwayOn',
                'awayClearFrom', 'houseAllowedFrom', 'houseDeadline',
                'awayRowHtml', 'awayFillHost', 'awayReadHost', 'awayWireHost',
                'calendarFieldsFrom', 'placeStuckHouses'];
const missing = NEEDED.filter(n => !lift(admin, n));
check('every piece of the two calendars is findable', missing.length === 0,
  'missing: ' + missing.join(', ') + ' — a gate that cannot find its target must FAIL, ' +
  'never skip: a skip reads exactly like a clean repo');

/* ⛔ AND THEY LIVE ABOVE THE SCHEDULE WIDGET. That widget is a self-contained IIFE, so a
   helper declared inside it is invisible to Add Customer and Edit Customer — the two
   forms Addie asked for these on. The first draft of this feature put them at
   houseAllowedFrom, inside it, where AWAY_MAX_RANGES would have been a ReferenceError
   the first time somebody pressed "+ Add another time they are away". Same trap
   prefNamedFloor and rushInstall are each on record for. */
{
  const widget = admin.indexOf('const MARKUP=');
  const cal = admin.indexOf('const AWAY_MAX_RANGES');
  check('the calendar rules are declared in shared scope, above the schedule widget',
    cal > -1 && widget > -1 && cal < widget,
    'declared inside the widget IIFE they are invisible to both customer forms');
}

/* ===================================================================== */
suite('One spelling of an away list — run, not read');
const R = (function () {
  const src = [lift(admin, 'awayDayAfter'),
               (admin.match(/const AWAY_MAX_RANGES = \d+;/) || [''])[0],
               (admin.match(/const AWAY_ISO_DAY = [^;]+;/) || [''])[0],
               lift(admin, 'awayListToKey'), lift(admin, 'awayKeyToList'),
               lift(admin, 'houseAwayOn'), lift(admin, 'awayClearFrom')].join(LF);
  return eval('(function(){' + src + LF +
    'return {key: awayListToKey, list: awayKeyToList, on: houseAwayOn, clear: awayClearFrom,' +
    ' after: awayDayAfter, MAX: AWAY_MAX_RANGES};})()');
})();

check('a whole range round-trips',
  R.key([{ from: '2026-11-10', to: '2026-11-20' }]) === '2026-11-10..2026-11-20' &&
  R.list('2026-11-10..2026-11-20').length === 1);

/* ⛔ THE ONE THAT PROTECTS A CUSTOMER. A row with one date typed in is NOT read as "gone
   from then onwards": that silently blocks the rest of their season, and the first thing
   anybody would learn about it is a crew not turning up. It is dropped, and the save says
   so out loud (asserted further down). */
check('a range with only one end filled in is dropped, never read as "gone from then on"',
  R.key([{ from: '2026-11-10', to: '' }]) === '' &&
  R.key([{ from: '', to: '2026-11-20' }]) === '',
  'a half-typed row that blocked the rest of the season would be invisible until a ' +
  'crew turned up at an empty house');

check('a backwards range is swapped rather than thrown away',
  R.key([{ from: '2026-11-20', to: '2026-11-10' }]) === '2026-11-10..2026-11-20',
  'there is no second reading of 20 Nov -> 10 Nov, and dropping it loses an instruction ' +
  'somebody meant to give');

check('junk is ignored without taking the good rows with it',
  R.key([{ from: 'soon', to: 'later' }, { from: '2026-11-10', to: '2026-11-20' }]) ===
  '2026-11-10..2026-11-20');

check('the list is capped, so one bad paste cannot make an unbounded record',
  R.key(Array.from({ length: R.MAX + 8 }, (_, i) =>
    ({ from: '2026-11-' + String((i % 28) + 1).padStart(2, '0'),
       to: '2026-11-' + String((i % 28) + 1).padStart(2, '0') }))).split('|').length <= R.MAX);

/* ===================================================================== */
suite('Is this house away on this day — the question every placement site asks');
const AWAY = { away: '2026-11-10..2026-11-20' };
check('the day in the middle is away', R.on(AWAY, '2026-11-15') === true);
/* ⚠ BOTH ENDS ARE INCLUSIVE, and this is worth a check of its own: somebody who says
   they are gone the 10th to the 20th means both of those days, and an exclusive end is
   a crew arriving on the morning they fly. */
check('and both named days are away too, not just the days between them',
  R.on(AWAY, '2026-11-10') === true && R.on(AWAY, '2026-11-20') === true);
check('the days either side are not', R.on(AWAY, '2026-11-09') === false &&
  R.on(AWAY, '2026-11-21') === false);
/* ⚠ THE SHORT-CIRCUIT IS WHAT MAKES THIS FREE FOR THE OTHER ~960 CUSTOMERS. */
check('a house with no away list is never away', R.on({}, '2026-11-15') === false &&
  R.on({ away: '' }, '2026-11-15') === false);

check('two separate holidays are both honoured',
  R.on({ away: '2026-10-05..2026-10-07|2026-11-10..2026-11-20' }, '2026-10-06') === true &&
  R.on({ away: '2026-10-05..2026-10-07|2026-11-10..2026-11-20' }, '2026-11-15') === true &&
  R.on({ away: '2026-10-05..2026-10-07|2026-11-10..2026-11-20' }, '2026-10-20') === false);

suite('Stepping past a window');
check('a day inside a window steps to the day after it',
  R.clear(AWAY, '2026-11-15') === '2026-11-21');
/* ⚠ TOUCHING WINDOWS HAVE TO BE STEPPED THROUGH TOGETHER or the answer lands inside the
   second one — which is a day a crew is then sent on. */
check('two touching windows are stepped through together',
  R.clear({ away: '2026-11-10..2026-11-20|2026-11-21..2026-11-25' }, '2026-11-15') === '2026-11-26');
check('a day outside every window is handed straight back',
  R.clear(AWAY, '2026-10-01') === '2026-10-01');
/* ⛔ IT CAN ONLY EVER MOVE SOMEBODY LATER. Answering earlier would drag the season
   backwards onto days already built and printed — and it is what keeps this feature
   inside the headline rule's "may move them later, may never leave them off". */
check('it never answers earlier than it was asked',
  ['2026-10-01', '2026-11-09', '2026-11-15', '2026-11-21', '2026-12-30']
    .every(d => R.clear(AWAY, d) >= d));
check('a house with no list is handed its own day back', R.clear({}, '2026-11-15') === '2026-11-15');

/* ===================================================================== */
suite('The floor and the ceiling — the real functions, run');
const W = (function () {
  const consts = [(admin.match(/const STAFF_DATE_WINDOW_DAYS = \d+;/) || [''])[0],
                  (admin.match(/const PRE_THANKSGIVING_DAYS = \d+;/) || [''])[0]].join(LF);
  const deps = ['awayDayAfter', 'awayListToKey', 'awayKeyToList', 'houseAwayOn', 'awayClearFrom',
                'thanksgivingDate', 'isThanksgivingDay', 'isWorkingDay', 'isoOf',
                'isoToLocalDate', 'addWorkingDays', 'staffDateWindowEnd',
                'prefSpecificDate', 'houseAllowedFrom', 'houseDeadline']
                .map(n => lift(admin, n));
  const bad = deps.map((s, i) => s ? null : i).filter(x => x !== null);
  check('every dependency of the floor and the ceiling was lifted', bad.length === 0,
    'a missing one is a bare ReferenceError that kills the suite with no clue which name');
  return eval('(function(){' +
    'const AWAY_MAX_RANGES = ' + R.MAX + ';' + LF +
    (admin.match(/const AWAY_ISO_DAY = [^;]+;/) || [''])[0] + LF +
    consts + LF + 'const BASE_START = new Date(2026, 9, 1);' + LF +
    deps.join(LF) + LF +
    'return {from: houseAllowedFrom, until: houseDeadline};})()');
})();
const START = '2026-10-01';

/* ⛔⛔ HER SECOND SENTENCE, ASSERTED: "still keep be done in october, november before
   thanksgiving after thanksgiving". Every preference is run with NO calendar set and has
   to give exactly the answer it gave before any of this existed. If this block goes red,
   the new fields have eaten the old ones and the change is wrong. */
check('October still opens at the season start and still ends on the 31st',
  W.from({ pref: 'October' }, START) === '2026-10-01' &&
  W.until({ pref: 'October' }) === '2026-10-31');
check('November still opens on the 1st and still has no last day',
  W.from({ pref: 'November' }, START) === '2026-11-01' &&
  W.until({ pref: 'November' }) === '');
check('Before Thanksgiving still opens in the run-up and still ends on the holiday',
  W.from({ pref: 'November - Before Thanksgiving' }, START) === '2026-11-19' &&
  W.until({ pref: 'November - Before Thanksgiving' }) === '2026-11-26');
check('After Thanksgiving still opens the day after it, with no last day',
  W.from({ pref: 'After Thanksgiving' }, START) === '2026-11-27' &&
  W.until({ pref: 'After Thanksgiving' }) === '');
check('Any still opens on the first day of the season',
  W.from({ pref: 'Normal Schedule' }, START) === '2026-10-01' &&
  W.from({}, START) === '2026-10-01');
check('a named day is still a floor and still not a ceiling',
  W.from({ pref: '11/9+' }, START) === '2026-11-09' && W.until({ pref: '11/9+' }) === '');

suite('The wanted window');
check('the first date they named is a floor',
  W.from({ wantFrom: '2026-11-05' }, START) === '2026-11-05');
check('and the second is a last day',
  W.until({ wantTo: '2026-11-15' }) === '2026-11-15');
/* ⛔ THE LIMIT EVERY DATE RULE HERE CARRIES. A window can delay somebody; it can never
   drag them into a month they did not ask for. Same rule the office's own date and
   rushInstall are held to, and the one thing in houseAllowedFrom that has never changed. */
check('a window opening in October does NOT pull a November customer into October',
  W.from({ pref: 'November', wantFrom: '2026-10-20' }, START) === '2026-11-01',
  'the LATEST of the floors wins — anything else hangs somebody in a month they ruled out');
check('but a window opening later than their month still delays them',
  W.from({ pref: 'October', wantFrom: '2026-10-20' }, START) === '2026-10-20');
/* A typed window is more specific than the word "October", so it wins the ceiling —
   the same way round as the office's own date. */
check('a typed window beats the month it sits in for the last day',
  W.until({ pref: 'October', wantTo: '2026-11-15' }) === '2026-11-15');
check("the office's own date still outranks the customer's window",
  W.until({ notBefore: '2026-10-12', wantTo: '2026-12-20' }) === '2026-10-19',
  'the staff window is a person overruling the form and stays the window');

/* ⛔ A CEILING BEFORE THE FLOOR IS A CONTRADICTION, NOT A WINDOW. packTailCrewDays reads
   an impossible window as "this house may never move" rather than as two settings that
   disagree, so the customer would be pinned wherever the builder first dropped them,
   silently. Dropping the ceiling leaves the floor — the half that protects them. */
check('a window that closes before their own month opens gives no last day at all',
  W.until({ pref: 'November', wantTo: '2026-10-20' }) === '',
  'an impossible window reads to the packer as "never move this house", which is worse ' +
  'than no ceiling');
check('and the floor still holds in that case',
  W.from({ pref: 'November', wantTo: '2026-10-20' }, START) === '2026-11-01');

suite('Away moves the day they open on');
check('a floor landing inside a window steps past it',
  W.from({ pref: 'November', away: '2026-11-01..2026-11-08' }, START) === '2026-11-09');
check('a floor outside every window is untouched',
  W.from({ pref: 'November', away: '2026-11-10..2026-11-20' }, START) === '2026-11-01',
  'a holiday in the MIDDLE of their season is a hole, which a floor cannot describe — ' +
  'houseAwayOn is what handles it, and this check is what stops the two being confused');

/* ===================================================================== */
suite('Stuck on one day — a window one day wide');
/* ⭐ THE PIN IS EXPRESSED AS from === until AND NOTHING ELSE, which is the whole reason it
   works everywhere at once: every mover in this app already refuses a day outside that
   window, so the timing sweep, both gatherers, the tail packer and nextInstallDayFor hold
   the house without a line being added to any of them. These two checks are what that
   claim rests on — if either goes red, "nothing moves them" has quietly become "nothing in
   the places somebody remembered to change moves them". */
check('the floor is exactly the pinned day',
  W.from({ stuck: '2026-11-12' }, START) === '2026-11-12');
check('and so is the last day, so the window is one day wide',
  W.until({ stuck: '2026-11-12' }) === '2026-11-12');
/* ⛔ IT WINS OUTRIGHT, unlike every other date rule here, which takes the LATER of two
   floors. A pin is not a preference to be weighed against a month — it is somebody in the
   office saying this house is on this day. Taking the later would slide them off it. */
check('it beats their month preference in both directions',
  W.from({ pref: 'November', stuck: '2026-10-08' }, START) === '2026-10-08' &&
  W.until({ pref: 'October', stuck: '2026-11-12' }) === '2026-11-12',
  'the pin is an instruction, not an opinion — anything else moves them off the pinned day');
check("it beats the office's own earliest date, their wanted window and their away dates",
  W.from({ notBefore: '2026-10-20', wantFrom: '2026-11-05',
           away: '2026-11-10..2026-11-20', stuck: '2026-11-12' }, START) === '2026-11-12' &&
  W.until({ notBefore: '2026-10-20', wantTo: '2026-11-30', stuck: '2026-11-12' }) === '2026-11-12');
/* ⚠ AND AN UNPINNED HOUSE IS UNTOUCHED BY ANY OF IT. */
check('no pin means nothing changes',
  W.from({ pref: 'November' }, START) === '2026-11-01' && W.until({ pref: 'October' }) === '2026-10-31');

suite('And the step that puts them on that day');
{
  const body = bare(lift(admin, 'placeStuckHouses'));
  check('a house already on its pinned day is left alone',
    /if\(here === p\.want\) return;/.test(body),
    'moving a house to the day it is already on is churn, and this runs on every press');
  /* ⛔ THE PRINTED-SHEET RULE. Moving a stop onto a day inside the 48-hour lock is the one
     thing every writer in this planner refuses — the sheet is out and the truck is loaded —
     and a pin is not a reason to start. Reported, never silent. */
  check('it will not move a house onto, or off, a day that is already printed',
    /if\(locked\(here\) \|\| locked\(p\.want\)\)\{/.test(body) &&
    /res\.blocked\.push/.test(body));
  check('a house ticked done is history and is never moved',
    /if\(h\.isFix \|\| h\.isTakedown \|\| h\.done\) return;/.test(body));
  /* ⚠ THE EXACT DATE, NOT the next working day: quietly sliding a Saturday pin to the
     Monday is the schedule overruling the person who set it, on the one control whose whole
     promise is that nothing moves. */
  check('a pinned date with no day yet gets that exact day made for it',
    /SEASON\.push\(target\);/.test(body) && !/nextWorkingDay/.test(body),
    'nextWorkingDay here would move them off the day they were pinned to');
  /* ⛔ IT CAN NEVER LEAVE ANYBODY OFF A DAY — it removes from one day only where it has a
     target to add to. That is what keeps the pin inside the headline rule. */
  check('it always has a day to put them on before it takes them off the old one',
    body.indexOf('target.houses.push(p.h)') > body.indexOf('p.day.houses = (p.day.houses || []).filter'),
    'and the filter and the push are in the same pass, so nobody is ever momentarily nowhere');
}

suite('The pin reaches the plan and survives nothing else');
{
  const src = bare(admin);
  /* ⛔ RUN LAST ON THE PRESS, AFTER the Confirmed safety net. The other way round, a house
     the net had just placed on an open day would keep it and the pin would read as ignored
     on the one button that is supposed to honour it. */
  const rebuild = src.slice(src.indexOf('let net = {placed: [], still: confirmedOff.map'));
  /* ⚠ THE CONDITION, NOT THE CALL. The first draft asserted the call was PRESENT and in the
     right order, so wrapping it in `if(false)` left both true and the sabotage passed — the
     trap CLAUDE.md names by hand and that rsvp-text-link.test.js was caught by. A text check
     cannot tell a live guard from a dead one unless it reads the guard. */
  check('Recalculate everything puts the pinned houses back, after the Confirmed safety net',
    /placeConfirmedLeftOff\(floorStr, startStr\)/.test(rebuild.slice(0, 900)) &&
    /if\(typeof placeStuckHouses === 'function'\) stuckMoves = placeStuckHouses\(floorStr\);/.test(rebuild) &&
    rebuild.indexOf('placeStuckHouses(floorStr)') > rebuild.indexOf('placeConfirmedLeftOff(floorStr, startStr)'));
  /* ⚠ BOTH EXITS. rebuildSeasonDays returns in two places — one when nothing new could be
     built at all — and the old plan still stands on that one, so a house pinned to a day it is
     not on is still pinned to a day it is not on. A promise that depends on how the season
     happened to go is not a promise. */
  check('the pin is honoured on both of the rebuild\u2019s exits',
    (bare(admin).match(/placeStuckHouses\(floorStr\)/g) || []).length === 3,
    'two calls plus the declaration — the "nothing could be scheduled" exit is the one that ' +
    'gets forgotten');
  check('and the press says who it moved, and who it could not',
    /stuckMoved:stuckMoves\.placed\.length/.test(src) &&
    /stuckBlocked:stuckMoves\.blocked\.length/.test(src) &&
    /could NOT be moved to their day/.test(src),
    'a pin that could not be honoured is the one case the office has to act on');
  /* ⛔ AND IT IS THIS SEASON'S ONLY. Left standing, placeStuckHouses would MAKE last
     season's day in the new plan and put them on it — a stale pin does not merely go quiet,
     it damages the season. Same rule as the takedown choice beside it ([[SCH-93]]). */
  const reset = src.slice(src.indexOf('takedownTiming: null'));
  check('Start New Season clears the pin', /stuckOnDate: null,/.test(reset.slice(0, 1400)),
    'a day agreed for last Christmas is not a day agreed for next');
  /* ⚠ AND A PIN ONTO A DAY THEY ARE AWAY IS A REAL CONTRADICTION. The pin wins — the office
     overruling the form — but sending a crew to an empty house is worth a sentence. */
  check('a pin inside their own away dates is named on the save',
    /stuckOn >= r\.from && stuckOn <= r\.to/.test(src) && /the pin wins/.test(admin));
}

/* ===================================================================== */
suite('The builder — run against a real season');
{
  const start = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
  const end = admin.indexOf('/* Top every day up to the cap.', start);
  if (start === -1 || end < start) {
    check('the day builder is findable', false, 'renamed — repoint this, do not delete it');
  } else {
    const consts = admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'),
                               admin.indexOf('function installPriority'));
    const prelude = 'const NEARBY_TOWN_LIST = {};' + LF +
      (admin.match(/const CITY_STREET_SUFFIXES = \[[\s\S]*?\];/) || [''])[0] + LF +
      /* ⚠ THE EXTRACTION LIST, AND IT COST THIS FILE A RUN. The builder reaches
         toDateStr and seasonFirstDate on its first line; without them it dies with a bare
         ReferenceError naming neither the suite nor the cause. CLAUDE.md records this trap
         ten times over. LIFTED, never stubbed — a stubbed isWorkingDay would let the
         builder place a crew on a Sunday with every check here green. */
      ['cityLooksLikeStreet', 'townIsPhantom', 'haversine', 'sameTownName',
       'awayDayAfter', 'awayKeyToList', 'houseAwayOn', 'awayClearFrom',
       'toDateStr', 'thanksgivingDate', 'isThanksgivingDay', 'isWorkingDay',
       'nextWorkingDay', 'seasonFirstDate', 'townCentres', 'nearbyTowns']
       .map(n => lift(admin, n)).join(LF) + LF +
      'const AWAY_MAX_RANGES = ' + R.MAX + ';' + LF +
      (admin.match(/const AWAY_ISO_DAY = [^;]+;/) || [''])[0] + LF;
    const api = eval('(function(){' + prelude + consts + LF +
      lift(admin, 'installPriority') + LF + admin.slice(start, end) + LF +
      'return {plan: planNewCrewDays};})()');

    const who = (n, city, from, away) => Array.from({ length: n }, (_, i) => ({
      id: city + '-' + (away ? 'away' : 'ok') + '-' + i, city: city,
      priority: 20, from: from || '2026-10-01', away: away || ''
    }));
    const dayOf = (days, id) => {
      for (const d of days) if (d.ids.indexOf(id) !== -1) return d.date;
      return null;
    };

    /* ⭐ THE PLAIN CASE: one house is away on the days their town is being worked. */
    {
      const waiting = who(19, 'Lehi').concat(
        [{ id: 'gone', city: 'Lehi', priority: 20, from: '2026-10-01',
           away: '2026-10-01..2026-10-09' }]);
      const days = api.plan(waiting, {}, { start: new Date(2026, 9, 1), pack: false });
      const when = dayOf(days, 'gone');
      check('a house away on the days its town is worked is not put on one of them',
        when === null || when > '2026-10-09',
        'got ' + when + ' — the crew would arrive at an empty house');
      /* ⛔ AND THEY ARE NOT SIMPLY LOST. Moving somebody later is the whole permitted
         effect of this feature; dropping them is what the headline rule forbids. */
      check('and everybody else on that town still went out',
        waiting.slice(0, 19).every(w => dayOf(days, w.id) !== null),
        'one away house must not cost the other nineteen their day');
    }

    /* ⛔⛔ THE HEADLINE-RULE CHECK. A town where EVERYBODY is away on the opening days is
       the case that could have broken the builder silently: crews free, nobody placeable,
       the jump-to-the-next-date step finds no later `from` because every floor has already
       passed, `break`, and the whole remaining season falls out with no error anywhere.
       Every one of these houses must still come out on a day. */
    {
      const waiting = who(12, 'Lehi', '2026-10-01', '2026-10-01..2026-10-16');
      const days = api.plan(waiting, {}, { start: new Date(2026, 9, 1), pack: false });
      const placed = waiting.filter(w => dayOf(days, w.id) !== null);
      check('a town that is ENTIRELY away still has every one of its houses placed',
        placed.length === waiting.length,
        'placed ' + placed.length + ' of ' + waiting.length + ' — this is the headline ' +
        'rule breaking silently: the builder ran out of anyone to place and gave up');
      check('and every one of them landed after they were home',
        waiting.every(w => { const d = dayOf(days, w.id); return d && d > '2026-10-16'; }),
        'placed, but on a day nobody is home');
    }

    /* ⚠ AND A SEASON WITH NO AWAY DATES AT ALL IS LAID OUT EXACTLY AS BEFORE. The cheapest
       way for this feature to do damage is to change the plan for the ~960 customers it
       is not about. */
    {
      const plain = who(25, 'Lehi').concat(who(25, 'Draper'));
      const withField = plain.map(w => Object.assign({}, w, { away: '' }));
      const a = api.plan(plain, {}, { start: new Date(2026, 9, 1), pack: false });
      const b = api.plan(withField, {}, { start: new Date(2026, 9, 1), pack: false });
      check('a book with no away dates builds the identical season',
        JSON.stringify(a) === JSON.stringify(b));
    }
  }
}

/* ===================================================================== */
suite('Every placement site asks, not just the builder');
{
  const src = bare(admin);
  /* ⚠ COUNTED AND NAMED, NOT MERELY "mentioned somewhere". Eight places decide which day
     a house lands on, and this app has twice been caught by one of a pair being guarded:
     the bins column on one build sheet and not the other, and the fix column on one crew
     printer and not the other. A site missed here is a customer whose holiday is honoured
     by the rebuild and undone by a sweep five minutes later. */
  const SITES = [
    ['the builder counts a town without its away houses', /if\(awayOn\(q\[i\], ds\)\) continue;/],
    ['the builder will not load one onto a van', /queue\[i\]\.from <= ds && !awayOn\(queue\[i\], ds\)/],
    ['a neighbour is not scored on somebody who cannot be visited', /if\(awayOn\(oq\[i\], ds\)\) continue;/],
    ['a borrowed house is checked too', /borrow\.queue\[i\]\.from <= ds && !awayOn\(borrow\.queue\[i\], ds\)/],
    ['the tail packer will not move a whole crew-day onto one', /if\(anyAwayOn\(src\.ids, d\)\) continue;/],
    ['nor one house onto one', /if\(awayOn\(id, tgt\.date\)\) continue;/],
    ['the timing sweep picks a clear day', /houseAwayOn\(h, ts\)\) return false;/],
    /* ⚠ THE GUARD, NOT THE VARIABLE. The first draft asserted the `const awayHere = ...`
       line existed, and deleting `&& !awayHere` from the `if` below it left that line
       exactly where it was — a house standing on its own holiday stayed there and the
       sabotage passed. Assert what must be TRUE, never where a string happens to sit. */
    ['and moves a house that is standing on one',
     /if\(!tooEarly && !tooLate && !awayHere\) return;/],
    ['and the sweep still works out whether they are away at all',
     /const awayHere = \(typeof houseAwayOn === 'function'\) && houseAwayOn\(h, here\);/]
  ];
  SITES.forEach(([title, re]) => check(title, re.test(src), 'no longer present in admin.html'));
  /* Both gatherers, and the count is the point — they are two copies of one rule about
     moving a house between days, so one guarded and one not is a house the second quietly
     posts into a holiday. */
  const gathers = (src.match(/houseAwayOn\(w, to\.date\)\) return false;/g) || []).length;
  check('both stray gatherers ask as well', gathers === 2, 'found ' + gathers + ' of 2');
}

suite('The headline rule is enforced where it is enforced');
{
  const body = lift(admin, 'placeConfirmedLeftOff');
  check('placeConfirmedLeftOff was found', !!body);
  /* ⚠ SCOPED TO THE FILTER, because houseAwayOn is spelled the same in the
     make-a-day loop a few lines below — so gutting the `clear` test was answered by the
     other mention and the sabotage passed. The claim is that the candidate days are
     FILTERED, so that is what is asserted. */
  check('it will not put a Confirmed customer on a day they are away',
    /return !\(typeof houseAwayOn === 'function' && houseAwayOn\(h, ds\)\);/.test(bare(body)) &&
    /openDays\(\)\.filter\(function\(day\)\{ return isoOf\(dayDate\(day\)\) >= from && clear\(day\); \}\)/.test(bare(body)),
    'the rule has to be WIRED into the day list, not merely present in the function');
  /* ⛔ AND IT MAKES A DAY PAST THE WINDOW RATHER THAN GIVING UP INSIDE IT. This is the
     line between "moved later" (allowed) and "left off" (forbidden). */
  check('and where nothing open is clear of it, the day it makes is past the window',
    /awayClearFrom\(h, ds\)/.test(bare(body)) && /nextWorkingDay/.test(bare(body)),
    'without this a customer away for the rest of the plan gets a day inside their own ' +
    'holiday, or none at all');
}

suite('The fields reach the plan, and a cleared box clears');
{
  const list = admin.slice(admin.indexOf('const SCHEDULE_SYNC_FIELDS'),
                           admin.indexOf('function houseFromCustomer'));
  ['away', 'wantFrom', 'wantTo', 'stuck'].forEach(k => {
    const at = list.indexOf("{key:'" + k + "'");
    check('the plan is told about ' + k, at > -1);
    /* ⛔ blankClears IS THE HALF THAT LETS A HOLIDAY BE TAKEN BACK. Without it a date
       typed once holds the house for the rest of the season and nothing on any screen can
       remove it — the same reason notBefore carries it.
       ⚠ SCOPED TO THIS ENTRY, NOT A WINDOW OF CHARACTERS. The first draft read 400 chars
       from the key, which runs into the NEXT entry — so deleting blankClears from `away`
       was answered by the one on `wantFrom` and the sabotage passed. §7 bans fixed-length
       windows by name and this is why. */
    const entry = at < 0 ? '' : (function () {
      const rest = list.slice(at + 1);
      const nextKey = rest.indexOf("{key:'");
      return nextKey < 0 ? rest : rest.slice(0, nextKey);
    })();
    check(k + ' is cleared when the box is emptied', /blankClears:\s*true/.test(entry));
  });
  /* ⛔ AND THE AWAY LIST HAS TO REACH THE WAITING ROW THE BUILDER READS. This check
     exists because its sabotage was MISSED: every builder fixture here hands `away` in
     ready-made, so deleting the line that copies it out of the house left all five builder
     checks green while the real season went blind. Same vacuous-fixture shape this repo
     records for the crew sheet's `houseSides` and the schedule's `named` flag. */
  const waiting = admin.slice(admin.indexOf('until:houseDeadline(h),'));
  check('the away list travels onto the waiting row the builder reads',
    /away:\(h && h\.away\) \|\| '',/.test(waiting.slice(0, 900)),
    'without it every house looks free and the builder never knows');
}

suite('Both forms, one reader');
{
  const src = bare(admin);
  ['addCust', 'editCust'].forEach(p => {
    check(p + ' has both calendars and the pin on screen',
      admin.indexOf('id="' + p + 'WantFrom"') > -1 &&
      admin.indexOf('id="' + p + 'WantTo"') > -1 &&
      admin.indexOf('id="' + p + 'AwayList"') > -1 &&
      admin.indexOf('id="' + p + 'AwayAdd"') > -1 &&
      admin.indexOf('id="' + p + 'StuckOn"') > -1);
    /* ⚠ A CONTROL NOBODY WIRED RENDERS PERFECTLY AND DOES NOTHING. This repo shipped
       exactly that once — the recycle "bin says" box, identical on screen to a working
       one, npm test green. */
    check(p + "'s away list is filled and wired",
      new RegExp("awayFillHost\\('" + p + "AwayList'").test(src) &&
      new RegExp("awayWireHost\\('" + p + "AwayList', '" + p + "AwayAdd'\\)").test(src));
    check(p + ' saves through the one shared reader',
      new RegExp("calendarFieldsFrom\\('" + p + "AwayList', '" + p + "WantFrom', '" + p +
                 "WantTo', '" + p + "StuckOn'\\)").test(src),
      'a second reader is a second answer about what a half-typed row means');
  });
  ['awayDates', 'wantedFrom', 'wantedTo', 'stuckOnDate'].forEach(f => {
    const n = (src.match(new RegExp(f + ':\\s*newCalendar\\.fields\\.' + f, 'g')) || []).length;
    check(f + ' is written by both forms', n === 2, 'found ' + n + ' of 2');
  });
  /* ⚠ AND THE ADD FORM CLEARS THEM. Left standing, the next customer typed in silently
     inherits the last one's holidays and nothing on the record says where they came from. */
  /* ⚠ SCOPED TO THE RESET, because the module-level wiring calls awayFillHost with the
     same empty list — so deleting the reset's own call was answered by the init one and
     the sabotage passed. Anchored on the reset block's neighbour instead. */
  {
    const reset = src.slice(src.indexOf("addCustInstallPref').value = 'Normal Schedule'"));
    check('Add a Customer clears both calendars between customers',
      /addCustWantFrom'\)\.value = '';/.test(reset.slice(0, 1200)) &&
      /addCustWantTo'\)\.value = '';/.test(reset.slice(0, 1200)) &&
      /awayFillHost\('addCustAwayList', \[\]\);/.test(reset.slice(0, 1200)) &&
      /addCustStuckOn'\)\.value = '';/.test(reset.slice(0, 1200)),
      'left standing, the next customer typed in inherits the last one\u2019s holidays');
  }
  /* ⛔ "NOTHING SHOULD FAIL QUIETLY" ON THE ONE FIELD WHOSE JOB IS KEEPING A VAN AWAY. */
  /* ⚠ ONE CHECK PER FORM, NOT A COUNT. `if(newCalendar.note) toast('Saved. ' +
     newCalendar.note)` mentions it TWICE on its own, so a ">= 2" census stayed green with
     the whole Edit Customer report deleted. A census that cannot tell two forms from one
     line is not a census. */
  check('Edit Customer says so when a half-typed away row was dropped',
    /if\(newCalendar\.note\) toast\('Saved\. ' \+ newCalendar\.note\);/.test(src),
    'a holiday silently not saved reads exactly like one that was');
  check('and Add a Customer says so too',
    /\(newCalendar\.note \? ' ' \+ newCalendar\.note : ''\)/.test(src));
}

suite('The two customer forms fill from the record');
{
  const open = lift(admin, 'openEditCustomerModal');
  const src = bare(open);
  check('Edit Customer fills both calendars from the record',
    /editCustWantFrom'\)\.value = /.test(src) && /editCustWantTo'\)\.value = /.test(src) &&
    /awayFillHost\('editCustAwayList', d\.awayDates\)/.test(src) &&
    /editCustStuckOn'\)\.value = /.test(src),
    'this function is what repoints the form at a SIBLING house on the bill — rows left ' +
    'standing would be saved onto the wrong customer');
  /* ⚠ AND BEFORE THE DIRTY BASELINE, which is taken last. Filled after it, the form opens
     already claiming unsaved changes and warning about losing them. */
  check('and it fills them before the dirty baseline is taken',
    src.indexOf('awayFillHost') > -1 &&
    src.indexOf('awayFillHost') < src.indexOf('editCustDirtySnapshot = editCustSnapshot()'));
}

/* ===================================================================== */
suite('Stuck here — the one-click toggle on the day panel');
/* ⭐ Addie asked for this after the typed field shipped: "yes add the toggle on the schedule
   day panel." It is a SECOND DOOR onto `stuckOnDate`, never a second mechanism — so the
   checks that matter are that it writes the same field, that it toggles, and that it mirrors
   both caches before the repaint. */
{
  const NEED2 = ['setStuckHere', 'stuckDayOf', 'dayIsoById', 'fmtDayLabel'];
  const gone = NEED2.filter(n => !lift(admin, n));
  check('the toggle and its helpers are findable', gone.length === 0, 'missing: ' + gone.join(', '));

  const src = bare(admin);
  /* ⚠ THE BUTTON IS ON INSTALL STOPS ONLY. A takedown has its own Soonest/Latest choice and
     a fixer route is its own day; neither is placed by the rules this pin works through, so
     a button there would look like it did something and do nothing. */
  check('the button is drawn on install stops only',
    /else if\(!h\.isTakedown\)\{[\s\S]{0,1400}data-stuck="/.test(src),
    'it sits inside the not-a-takedown, not-a-fix branch');
  /* ⚠ THREE STATES, NOT TWO. A pin pointing at some OTHER day drawn as "not pinned" is the
     office's own instruction disappearing off the screen. */
  check('a pin on another day is drawn as itself, and pressing it moves the pin here',
    /pinnedElse\s*=\s*!!sd\s*&&\s*!pinnedHere/.test(src) && /Stuck on '\+esc\(sd\)\+' — pin here/.test(src));
  check('and the pressed state is drawn as pressed', /data-stuck="'\+h\.id\+'"/.test(src) &&
    /class="qbtn stuck'\+\(pinnedHere\?' on':''\)\+'"/.test(src));
  check('the press is wired to the handler',
    /if\(t\.dataset\.stuck\)\{setStuckHere\(t\.dataset\.stuck\);return;\}/.test(src),
    'a control nobody wired renders perfectly and does nothing — this repo has shipped one');
  /* ⚠ AND THE BADGE HAS A CLASS THAT EXISTS. A badge whose class is undeclared renders as
     unstyled text, which is the same failure shape as the undeclared --evergreen colour that
     Suite 277 caught in this very change. */
  check('the STUCK badge is drawn and its class is declared',
    /class="stuckbadge"/.test(src) && /\.stuckbadge\{/.test(admin) && /\.qbtn\.stuck\{/.test(admin));
  /* ⛔ THE PER-STOP COST. findHouse walks every day's houses looking for one id and this runs
     once per stop — on the real book ~40 × ~1,000 comparisons a repaint, the shape that has
     locked this page up on a keystroke before. */
  check('the day is resolved by id over the days, never by scanning every house',
    /dayIsoById\(dayId\)/.test(src) &&
    !/const hereIso=\(function\(\)\{const dd=dayDate\(findHouse/.test(src),
    'findHouse per stop is a full scan of the plan per stop');
}

suite('And the toggle itself, run against fakes');
{
  const body = [lift(admin, 'fmtDayLabel'), lift(admin, 'setStuckHere')].join(LF);
  const mk = function (opts) {
    const o = opts || {};
    const custData = o.custData === undefined ? {} : o.custData;
    const cust = o.noCust ? null : {id: 'c1', data: custData};
    const house = {id: 'cust-c1', name: 'Test House', stuck: o.houseStuck || ''};
    if (o.isTakedown) house.isTakedown = true;
    if (o.isFix) house.isFix = true;
    const state = {writes: [], toasts: [], rendered: 0, saved: 0};
    const api = new Function('findHouse', 'dayDate', 'isoOf', 'hlxResolvePlanHouse',
      'updateDoc', 'doc', 'db', 'serverTimestamp', 'toast', 'renderAll', 'scheduleSave',
      'personName', 'console',
      body + LF + 'return {go: setStuckHere, label: fmtDayLabel};')(
      function (id) { return String(id) === house.id ? {house: house, day: {id: 'd1'}} : null; },
      function () { return o.noDate ? null : new Date(2026, 10, 12); },
      function (d) { return '2026-11-12'; },
      function () { return cust; },
      function (ref, data) {
        if (o.writeThrows) return Promise.reject(new Error('nope'));
        state.writes.push(data); return Promise.resolve();
      },
      function (_db, col, id) { return {col: col, id: id}; }, {},
      function () { return 'NOW'; },
      function (m) { state.toasts.push(m); },
      function () { state.rendered++; }, function () { state.saved++; },
      function (n) { return n; }, {error: function () {}, warn: function () {}});
    return {api: api, state: state, house: house, cust: cust};
  };

  /* Not pinned -> pinned to the day you are looking at. The DATE COMES FROM THE DAY, which is
     the whole point of the button: nothing to type and nothing to get wrong. */
  {
    const t = mk({});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('pressing it on an unpinned stop pins them to that day',
        t.state.writes.length === 1 && t.state.writes[0].stuckOnDate === '2026-11-12');
      /* ⚠ MIRRORED INTO BOTH CACHES BEFORE THE REPAINT. The panel redraws from the plan and
         the customer list, not from Firestore, so without this the button visibly springs
         back and somebody presses it again — two writes in flight over one pin. */
      check('and both caches are mirrored, so the button does not spring back',
        t.cust.data.stuckOnDate === '2026-11-12' && t.house.stuck === '2026-11-12');
      check('and the panel is redrawn and the plan saved',
        t.state.rendered === 1 && t.state.saved === 1);
      check('and it says what it did, naming the day',
        t.state.toasts.some(function (m) { return /stuck on/i.test(m) && /12 Nov/.test(m); }));
    }));
  }
  /* Pinned to THIS day -> pressing it unpins. A toggle that could only ever pin would leave
     no way back off a day except opening the customer's record. */
  {
    const t = mk({custData: {stuckOnDate: '2026-11-12'}});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('pressing it again unpins them',
        t.state.writes.length === 1 && t.state.writes[0].stuckOnDate === null,
        'null, not the empty string — the field is cleared, the same as the form clearing it');
      check('and the caches are cleared with it',
        !t.cust.data.stuckOnDate && t.house.stuck === '');
      check('and it says they will be scheduled normally again',
        t.state.toasts.some(function (m) { return /no longer stuck/i.test(m); }));
    }));
  }
  /* Pinned to ANOTHER day -> pressing it here MOVES the pin. That is what pressing it on
     this stop means; refusing would leave the office with no way to correct a pin from the
     day they are actually looking at. */
  {
    const t = mk({custData: {stuckOnDate: '2026-10-08'}});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('a pin on another day is moved to this one, not toggled off',
        t.state.writes.length === 1 && t.state.writes[0].stuckOnDate === '2026-11-12');
    }));
  }
  /* ⛔ THE STORED ANSWER DECIDES, NEVER THE PLAN ROW. A stale `stuck` on the plan would
     otherwise make the button toggle the opposite way to what the record says. */
  {
    const t = mk({custData: {stuckOnDate: '2026-11-12'}, houseStuck: ''});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('the record decides, not the plan row',
        t.state.writes.length === 1 && t.state.writes[0].stuckOnDate === null,
        'the customer says pinned here, so the press must UNPIN even though the plan row is blank');
    }));
  }
  /* ⛔ AN IMPORTED CSV ROW CANNOT BE PINNED — there is no customer record to write to, and
     those rows carry no id and never will. Said out loud: a button that silently does nothing
     is exactly what this repo shipped once with the recycle "bin says" box. */
  {
    const t = mk({noCust: true});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('a stop with no customer record is refused out loud, never silently',
        t.state.writes.length === 0 && t.state.toasts.length === 1 &&
        /All Customers/.test(t.state.toasts[0]));
    }));
  }
  /* ⚠ A DAY WITH NO DATE YET cannot be pinned to, and says so rather than writing a blank. */
  {
    const t = mk({noDate: true});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('a day with no date is refused out loud',
        t.state.writes.length === 0 && /no date/i.test(t.state.toasts[0] || ''));
    }));
  }
  /* ⚠ AND A FAILED WRITE MIRRORS NOTHING. Mirroring first would leave the screen showing a
     pin that is not saved anywhere — worse than the press appearing not to work. */
  {
    const t = mk({writeThrows: true});
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('a failed write changes neither cache, and says so',
        t.house.stuck === '' && t.state.rendered === 0 &&
        t.state.toasts.some(function (m) { return /Could not save/.test(m); }));
    }));
  }
  /* Takedowns and fixes are left alone — see the button's own note. */
  ['isTakedown', 'isFix'].forEach(function (k) {
    const t = mk((function () { const o = {}; o[k] = true; return o; })());
    pendingAsync.push(t.api.go('cust-c1').then(function () {
      check('a ' + (k === 'isFix' ? 'fix' : 'takedown') + ' stop is never pinned by this',
        t.state.writes.length === 0 && t.state.toasts.length === 0);
    }));
  });
}

Promise.all(pendingAsync).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\nFailed:\n  - ' + fails.join('\n  - ')); process.exit(1); }
}, function (err) {
  console.log('  FAIL  an async check crashed\n          ' + (err && err.stack || err));
  process.exit(1);
});
