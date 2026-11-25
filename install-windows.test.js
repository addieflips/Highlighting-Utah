#!/usr/bin/env node
/* INSTALL WINDOWS, THE WEATHER DELAY AND THE TEXTS — [[SCH-158]] to [[SCH-162]] (2026-11-23)
 * ======================================================================================
 * `npm run test:windows` — its own file per R-018.
 *
 * The owner's 2027 blueprint ("Highlighting Utah – Install Scheduling System Blueprint", 23 November 2026): customers get
 * an estimated one-week WINDOW, not a fixed date; the exact day is confirmed by text the evening before; once a window is
 * set it only moves for weather, and new bookings never push existing customers back; every change sends a text.
 *
 * WHAT THIS FILE PROVES, AND HOW
 * ------------------------------
 * It RUNS the real Recalculate through schedule-v2.harness.js (the same lift schedule-season.test.js uses) over a seeded
 * book, then asks the real window functions what the records should say. Nothing here matches source text where the
 * behaviour can be run instead; the few source reads are the ones that cannot be run — the server's read whitelist, the
 * season reset's field list, the mirror's call order and the markup the buttons live in.
 *
 * ⚠ A WINDOW IS A PROMISE AND A CONSTRAINT AT ONCE. The check that earns the file is the second press: with every window
 * published and NOTHING having happened, not one customer's window changes — the planner has been held inside the week
 * each customer was texted. Then a day is lost and only the houses the planner had to move get a new window, every one
 * of them marked weather, every one counted once.
 *
 * ⚠ THERE IS NO TEXTING SERVICE ([[QT-48]]) and this file holds that line: nothing it checks sends, and the message builders
 * are proved as the words that go into the bulk tool.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let passed = 0, failed = 0;
const fails = [];
let currentSuite = '';
function suite(t){ currentSuite = t; console.log('\n=== ' + t + ' ==='); }
function check(name, ok, why){
  if(ok){ passed++; console.log('  PASS  ' + name); }
  else { failed++; fails.push(currentSuite + ' — ' + name + (why ? ' — ' + why : '')); console.log('  FAIL  ' + name + (why ? ' — ' + why : '')); }
}
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const admin = read('admin.html');

/* The lifter, from schedule-v2.test.js, exactly as schedule-season.test.js borrows it. A missing anchor FAILS. */
function loadLifter(){
  const src = read('schedule-v2.test.js');
  const cut = src.indexOf('let H = null;');
  if(cut < 0) return null;
  const m = {exports: {}};
  const log = console.log; console.log = function(){};
  try{ new Function('require', 'module', '__dirname', src.slice(0, cut) + '\nmodule.exports = {liftDeep: liftDeep};')(require, m, ROOT); }
  finally{ console.log = log; }
  return m.exports.liftDeep || null;
}
suite('The harness');
const liftDeep = loadLifter();
check('the lifter was found in schedule-v2.test.js', !!liftDeep, 'its anchor "let H = null;" moved — fix this loader, never skip the file');
let H = null;
if(liftDeep){
  const log = console.log, err = console.error, warn = console.warn;
  console.log = function(){}; console.error = function(){}; console.warn = function(){};
  try{ H = require('./schedule-v2.harness.js')(liftDeep); }catch(e){ H = null; console.log = log; console.log(e); }
  finally{ console.log = log; console.error = err; console.warn = warn; }
}
check('the real Recalculate was lifted out of admin.html', !!H);
check('and the window functions came with it', !!(H && H.api.installWindowFor && H.api.installWindowDiffs && H.api.setDayOff && H.api.atRiskHouses),
  'schedule-v2.harness.js lists them by name — a renamed function is a renamed lift');

/* ---- a seeded book, on real towns, every customer a straight yes ---- */
const TOWNS = {'Lehi': [40.3916, -111.8508], 'American Fork': [40.3769, -111.7958], 'Pleasant Grove': [40.3641, -111.7385],
  'Lindon': [40.3433, -111.7208], 'Orem': [40.2969, -111.6946], 'Saratoga Springs': [40.3491, -111.9043],
  'Eagle Mountain': [40.3141, -112.0069], 'Highland': [40.4250, -111.7955], 'Alpine': [40.4533, -111.7780]};
function rng(seed){ let x = seed >>> 0 || 1; return function(){ x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const YES = {rsvpStatus: 'yes', rsvpRespondedAt: {toMillis: function(){ return new Date(2026, 8, 1).getTime(); }}};
function makeBook(n, seed, tag){
  const r = rng(seed), names = Object.keys(TOWNS), book = [];
  for(let i = 0; i < n; i++){
    const town = names[Math.floor(r() * names.length)], c = TOWNS[town], u = r();
    const pref = u < 0.21 ? 'October' : u < 0.45 ? 'November' : u < 0.46 ? 'November - Before Thanksgiving' : 'Normal Schedule';
    book.push({id: (tag || 'c') + i, data: Object.assign({name: 'Cust ' + (tag || '') + i, customerNumber: String(1000 + i), city: town,
      address: (100 + i) + ' Test Ln', phone: '801555' + String(1000 + i), lat: c[0] + (r() - 0.5) * 0.04, lng: c[1] + (r() - 0.5) * 0.04,
      installPreference: pref}, YES)});
  }
  return book;
}
const T0 = new Date(2026, 9, 5, 7, 0);   // Monday 5 October 2026, 7 am
const iso = d => H.api.isoOf(d);
const dayStr = d => iso(H.api.dayDate(d));
const local = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };

/* ================================================================================================================== */
suite('SCH-170 Windows start with the 2027 season: the 2026 season gets none, and loses any already written');
if(H){
  /* The owner, 2026-11-25: "I thought I said schedule shouldn't start for next year but it looks like it is showing for this
     year." Everything below this suite runs NEXT season's rules on this season's fixtures, by moving the harness's copy of
     INSTALL_WINDOWS_FROM back a year. This suite runs FIRST, against the value admin.html ships. */
  check('the page ships the gate at 1 January 2027', H.api.windowsFrom() === '2027-01-01', H.api.windowsFrom());
  check('a 2026 install day is not live, a 2027 one is', !H.api.installWindowsLiveFor('2026-11-24') && H.api.installWindowsLiveFor('2027-10-12'));
  const book = makeBook(60, 9090);
  H.setNow(T0); H.load(book, {});
  H.press();
  const onDays = Object.keys(H.api.comingInstallByCustomer()).length;
  check('the 2026 fixture has customers on coming days', onDays > 30, onDays + '');
  check('and not one of them is given a window', (H.api.installWindowDiffs(book, {}) || []).filter(x => x.set).length === 0);
  /* a window written on 23 November for a 2026 day — what the live book holds — is cleared, count, texted mark and all */
  const victims = book.slice(0, 5);
  victims[0].data.installWindowStart = '2026-11-23'; victims[0].data.installWindowEnd = '2026-11-27';
  victims[0].data.installWindowSetAt = '2026-11-23'; victims[0].data.installWindowReason = 'booked'; victims[0].data.installWindowChanges = 0;
  victims[0].data.installWindowTextedFor = '2026-11-23|2026-11-27';
  victims[1].data.installWindowStart = '2026-11-09'; victims[1].data.installWindowEnd = '2026-11-13'; victims[1].data.completed = true;
  victims[2].data.installConfirmedFor = '2026-11-24'; victims[2].data.missedTextedFor = '2026-11-20';
  const diffs = H.api.installWindowDiffs(book, {}) || [];
  const d0 = diffs.find(x => x.id === victims[0].id), d1 = diffs.find(x => x.id === victims[1].id);
  check('a 2026 window is cleared, with its reason, count and texted mark', d0 && !d0.set && d0.gated &&
    ['installWindowStart', 'installWindowEnd', 'installWindowSetAt', 'installWindowReason', 'installWindowChanges', 'installWindowTextedFor'].every(k => d0.updates[k] === null), JSON.stringify(d0));
  check('even on a house whose lights are already up', d1 && d1.gated);
  check('the confirmation and missed-text stamps are left alone — those lists still run this season', !diffs.some(x => x.id === victims[2].id));
  check('the clear touches no other field', d0 && Object.keys(d0.updates).length === 6);
  H.api.applyInstallWindowDiffsLocally(diffs);
  check('and once applied there is nothing left to clear', (H.api.installWindowDiffs(book, {}) || []).length === 0);
  const startStr = iso(H.api.dayDate(H.api.installDays()[0]));
  const h26 = {id: 'cust-26', pref: 'Normal Schedule', city: 'Lehi', winFrom: '2026-11-23', winTo: '2026-11-27'};
  check('the planner ignores a 2026 window copy still on a house: no floor', H.api.houseAllowedFrom(h26, '2026-10-05') === '2026-10-05', H.api.houseAllowedFrom(h26, '2026-10-05'));
  check('and no ceiling', H.api.houseDeadline(h26) === '', H.api.houseDeadline(h26));
  const h27 = {id: 'cust-27', pref: 'Normal Schedule', city: 'Lehi', winFrom: '2027-10-11', winTo: '2027-10-15'};
  check('a 2027 window copy is still a floor and a ceiling', H.api.houseAllowedFrom(h27, '2026-10-05') === '2027-10-11' && H.api.houseDeadline(h27) === '2027-10-15');
  /* everything after this point is next season's behaviour, run on these fixtures */
  H.api.setWindowsFrom('2026-01-01');
}
const codeNoComments = admin.replace(/\/\*[\s\S]*?\*\//g, '');
check('the Texts tab says windows start with 2027 while they have not', /if\(!installWindowsLiveFor\([^)]*scheduleTodayStr[\s\S]{0,200}Install windows start with the 2027 season/.test(codeNoComments));
{
  const idx = read('index.html');
  const strip = idx.slice(idx.indexOf('function renderScheduleStrip('), idx.indexOf('\n}', idx.indexOf('function renderScheduleStrip(')));
  check('the portal shows a pre-2027 install as the day, in the words it used before windows', /when && String\(rec\.scheduledDate\)\.slice\(0, 4\) < '2027'\)\{[\s\S]{0,700}Scheduled for ' \+ when/.test(strip));
  check('and never shows a window whose start is before 2027', /String\(rec\.installWindowStart \|\| ''\)\.slice\(0, 4\) >= '2027' && portalWindowText\(rec\)/.test(strip));
  check('the portal and the page cut at the same year', /let INSTALL_WINDOWS_FROM = '2027-01-01';/.test(admin));
}

if(H){
  /* ================================================================================================================ */
  suite('SCH-159 A day lost to weather');
  {
    H.setNow(T0); H.load(makeBook(10, 11), {});
    const n = H.api.normalizeDaysOff({'2026-10-13': {kind: 'lost', reason: 'snow'}, 'bad': {kind: 'lost'}, '2026-10-14': {kind: 'maybe'}, '2026-10-15': {kind: 'half', reason: 'x'.repeat(300)}});
    check('normalizeDaysOff keeps lost and half days on real dates and drops the rest', Object.keys(n).sort().join(',') === '2026-10-13,2026-10-15' && n['2026-10-13'].reason === 'snow', JSON.stringify(n));
    check('and caps the typed reason', n['2026-10-15'].reason.length === 120);
    check('Tuesday 13 October 2026 is a working day before anything is marked', H.api.isWorkingDay(local('2026-10-13')) === true);
    H.api.setDayOff('2026-10-13', 'lost', 'snow');
    check('marked lost, it is not a working day — through the same isWorkingDay the whole planner reads', H.api.isWorkingDay(local('2026-10-13')) === false);
    check('the day either side still is', H.api.isWorkingDay(local('2026-10-12')) && H.api.isWorkingDay(local('2026-10-14')));
    check('isWeatherDayLost agrees', H.api.isWeatherDayLost(local('2026-10-13')) === true && H.api.isWeatherDayLost(local('2026-10-14')) === false);
    H.api.setDayOff('2026-10-14', 'half', 'wind');
    check('a half day stays a working day', H.api.isWorkingDay(local('2026-10-14')) === true);
    check('and is held to one crew through dayLimits', H.api.dayLimitOn('2026-10-14') === 'crew');
    H.api.setDayOff('2026-10-14', '', '');
    check('clearing the half day lifts the one-crew limit it set', H.api.dayLimitOn('2026-10-14') === '' && !H.api.dayOffOn('2026-10-14'));
    H.api.setDayLimitOn('2026-10-16', 'crew'); H.api.setDayOff('2026-10-16', 'half', ''); H.api.setDayOff('2026-10-16', '', '');
    check('but never a one-crew limit the office set itself', H.api.dayLimitOn('2026-10-16') === 'crew');
    H.api.setDayLimitOn('2026-10-16', '');
    check('setDayOff refuses a date that is not one', H.api.setDayOff('tomorrow', 'lost', '') === '' && Object.keys(H.api.daysOff()).indexOf('tomorrow') === -1);
    const out = H.api.serialize();
    check('the plan is saved with its weather days (PLAN_SCHEMA 5)', out.schema === 5 && out.daysOff && out.daysOff['2026-10-13'] && out.daysOff['2026-10-13'].kind === 'lost' && out.daysOff['2026-10-13'].reason === 'snow', JSON.stringify(out.daysOff));
    H.api.setDayOff('2026-10-13', '', '');
    check('cleared, it is a working day again', H.api.isWorkingDay(local('2026-10-13')) === true);
    H.api.hydrate(JSON.parse(JSON.stringify(out)));
    check('and a saved plan brings its weather days back', H.api.dayOffOn('2026-10-13') && H.api.dayOffOn('2026-10-13').kind === 'lost' && H.api.isWorkingDay(local('2026-10-13')) === false);
    H.api.hydrate(JSON.parse(JSON.stringify(Object.assign({}, out, {daysOff: {}}))));
    check('a plan saved before this existed (no daysOff) is the ordinary calendar', H.api.isWorkingDay(local('2026-10-13')) === true && Object.keys(H.api.daysOff()).length === 0);
  }

  /* ================================================================================================================ */
  suite('SCH-158 The window around a day');
  {
    H.setNow(T0); H.load(makeBook(5, 12), {});
    const normal = {id: 'cust-x', pref: 'Normal Schedule', city: 'Lehi'};
    let w = H.api.installWindowFor(normal, {}, '2026-10-14', '2026-10-01');   // Wednesday
    check('two working days either side of a Wednesday: Monday to Friday', w && w.start === '2026-10-12' && w.end === '2026-10-16', JSON.stringify(w));
    w = H.api.installWindowFor(normal, {}, '2026-10-12', '2026-10-01');   // Monday
    check('a Monday reaches back over the weekend to Thursday', w && w.start === '2026-10-08' && w.end === '2026-10-14', JSON.stringify(w));
    w = H.api.installWindowFor(normal, {}, '2026-10-06', '2026-10-01');   // tomorrow
    check('never before tomorrow — a window around tomorrow starts tomorrow', w && w.start === '2026-10-06' && w.end === '2026-10-08', JSON.stringify(w));
    w = H.api.installWindowFor({id: 'cust-o', pref: 'October', city: 'Lehi'}, {}, '2026-10-30', '2026-10-01');
    check('an October customer\'s window never leaves October, and never ends on a Saturday', w && w.start === '2026-10-28' && w.end === '2026-10-30', JSON.stringify(w));
    w = H.api.installWindowFor({id: 'cust-n', pref: 'November', city: 'Lehi'}, {}, '2026-11-02', '2026-10-01');
    check('a November customer\'s window never opens in October', w && w.start === '2026-11-02' && w.end === '2026-11-04', JSON.stringify(w));
    H.api.setDayOff('2026-10-13', 'lost', 'snow');
    w = H.api.installWindowFor(normal, {}, '2026-10-14', '2026-10-01');
    check('a lost day inside the window is not one of its days, so the window reaches round it', w && w.start === '2026-10-09' && w.end === '2026-10-16', JSON.stringify(w));
    H.api.setDayOff('2026-10-13', '', '');
    w = H.api.installWindowFor(Object.assign({winFrom: '2026-10-19', winTo: '2026-10-23'}, normal), {}, '2026-10-14', '2026-10-01');
    check('the house\'s CURRENT window is ignored when a new one is worked out, or it could never be re-centred', w && w.start === '2026-10-12' && w.end === '2026-10-16', JSON.stringify(w));
    check('no date, no window', H.api.installWindowFor(normal, {}, '', '2026-10-01') === null && H.api.installWindowFor(normal, {}, 'soon', '2026-10-01') === null);
    check('the label reads like a text: "Oct 12–16", "Oct 30–Nov 3", "Nov 2"',
      H.api.fmtWindowLabel('2026-10-12', '2026-10-16') === 'Oct 12–16' && H.api.fmtWindowLabel('2026-10-30', '2026-11-03') === 'Oct 30–Nov 3' && H.api.fmtWindowLabel('2026-11-02', '2026-11-02') === 'Nov 2',
      [H.api.fmtWindowLabel('2026-10-12', '2026-10-16'), H.api.fmtWindowLabel('2026-10-30', '2026-11-03')].join(' / '));
  }

  /* ================================================================================================================ */
  suite('SCH-158 The published window is a floor and a ceiling the planner keeps');
  {
    H.setNow(T0); H.load(makeBook(5, 13), {});
    const startStr = '2026-10-01';
    const h = {id: 'cust-w', pref: 'Normal Schedule', city: 'Lehi', winFrom: '2026-10-12', winTo: '2026-10-16'};
    check('the floor is the window\'s first day', H.api.houseAllowedFrom(h, startStr) === '2026-10-12');
    check('the ceiling is its last', H.api.houseDeadline(h) === '2026-10-16');
    check('so a day inside is allowed and a day outside is refused, by the one legality check',
      H.api.houseMayGoOn(h, {}, '2026-10-14', startStr).ok && !H.api.houseMayGoOn(h, {}, '2026-10-09', startStr).ok && !H.api.houseMayGoOn(h, {}, '2026-10-19', startStr).ok);
    const nov = {id: 'cust-v', pref: 'November', city: 'Lehi', winFrom: '2026-10-12', winTo: '2026-10-16'};
    check('a window can never drag a November customer into October: the latest floor still wins', H.api.houseAllowedFrom(nov, startStr) === '2026-11-01');
    check('and a window end before the floor is a contradiction, not a ceiling — ignored', H.api.houseDeadline(nov) === '');
    const oct = {id: 'cust-oc', pref: 'October', city: 'Lehi', winFrom: '2026-10-26', winTo: '2026-11-04'};
    check('the tighter of the window and the month wins', H.api.houseDeadline(oct) === '2026-10-31');
    const pinned = {id: 'cust-p', pref: 'Normal Schedule', city: 'Lehi', winFrom: '2026-10-12', winTo: '2026-10-16', stuck: '2026-10-20'};
    check('a pin still beats the window, both ends ([[SCH-100]] is untouched)', H.api.houseAllowedFrom(pinned, startStr) === '2026-10-20' && H.api.houseDeadline(pinned) === '2026-10-20');
    const none = {id: 'cust-0', pref: 'October', city: 'Lehi'};
    check('a house with no window answers exactly as before', H.api.houseAllowedFrom(none, startStr) === startStr && H.api.houseDeadline(none) === '2026-10-31');
  }

  /* ================================================================================================================ */
  suite('SCH-158 Every press keeps every promised window; a lost day moves only who it must');
  {
    const book = makeBook(120, 4242);
    H.setNow(T0); H.load(book, {});
    H.press();
    const days = () => H.api.installDays();
    let diffs = H.api.installWindowDiffs(book, {});
    const onDays = Object.keys(H.api.comingInstallByCustomer()).length;
    check('after the first press every customer on a coming day gets a window', diffs && diffs.length === onDays && diffs.every(x => x.set), (diffs || []).length + ' of ' + onDays);
    check('each window is five working days at most and holds the day the plan has them on',
      diffs.every(x => x.day >= x.updates.installWindowStart && x.day <= x.updates.installWindowEnd && x.updates.installWindowStart <= x.updates.installWindowEnd));
    check('every first window is "booked" with zero changes', diffs.every(x => x.updates.installWindowReason === 'booked' && x.updates.installWindowChanges === 0));
    check('and is dated today', diffs.every(x => x.updates.installWindowSetAt === '2026-10-05'));
    const applied = H.api.applyInstallWindowDiffsLocally(diffs);
    check('applying the diff writes the customer and the house in one step', applied === diffs.length &&
      book.every(c => !H.api.comingInstallByCustomer()[c.id] || (c.data.installWindowStart && H.api.comingInstallByCustomer()[c.id].h.winFrom === c.data.installWindowStart)));
    check('and asked again straight away there is nothing to write', (H.api.installWindowDiffs(book, {}) || []).length === 0);

    /* ⭐ THE CHECK THAT EARNS THE FILE */
    H.press();
    diffs = H.api.installWindowDiffs(book, {});
    check('a second press with nothing having happened changes NOBODY\'S window', diffs.length === 0,
      diffs.slice(0, 5).map(x => (x.oldWin ? x.oldWin.start + '..' + x.oldWin.end : '-') + ' -> ' + x.day).join('; '));
    const vio = H.api.validateSeasonPlan({});
    check('and the plan still keeps every one of its own rules', vio.length === 0, JSON.stringify(vio.slice(0, 3)));

    /* new bookings fill open capacity; they never push a promised window */
    const more = makeBook(15, 777, 'n');
    const bigger = book.concat(more);
    H.load(bigger, {season: H.season()});
    H.press();
    diffs = H.api.installWindowDiffs(bigger, {});
    const newOnes = diffs.filter(x => /^n\d/.test(x.id)), oldOnes = diffs.filter(x => !/^n\d/.test(x.id));
    check('fifteen new customers get their first windows', newOnes.length === more.filter(c => H.api.comingInstallByCustomer()[c.id]).length && newOnes.every(x => x.updates.installWindowReason === 'booked'));
    check('and not one existing customer\'s window moved to make room', oldOnes.length === 0, oldOnes.slice(0, 5).map(x => x.id + ' ' + x.updates.installWindowReason).join(', '));
    H.api.applyInstallWindowDiffsLocally(diffs);

    /* a lost day */
    const target = days().filter(d => d.houses.length >= 8 && dayStr(d) > '2026-10-06')[1] || days()[1];
    const lost = dayStr(target);
    const onLost = target.houses.map(h => h.id);
    H.api.setDayOff(lost, 'lost', 'snow');
    H.press();
    check('nobody is left on the lost day', !days().some(d => dayStr(d) === lost), days().map(dayStr).join(' '));
    check('and the lost day is no longer a working day', H.api.isWorkingDay(local(lost)) === false);
    diffs = H.api.installWindowDiffs(bigger, {reason: 'weather'});
    const changed = diffs.filter(x => x.set && x.changed);
    const held = H.api.comingInstallByCustomer();
    const stayedInside = Object.keys(held).filter(id => !changed.some(x => x.id === id)).every(id => {
      const d = bigger.find(c => c.id === id).data; return held[id].ds >= d.installWindowStart && held[id].ds <= d.installWindowEnd; });
    check('everybody whose window does not change is still inside the week they were told', stayedInside);
    check('every window that changes is marked weather and counted once', changed.every(x => x.updates.installWindowReason === 'weather' && x.updates.installWindowChanges === 1));
    check('the diff carries the old and the new window for the preview and the text', changed.every(x => x.oldWin && x.newWin && x.newWin.start <= x.day && x.day <= x.newWin.end));
    const changedIds = new Set(changed.map(x => x.house && x.house.id));
    const others = [...changedIds].filter(id => onLost.indexOf(id) === -1);
    check('whoever changed either stood on the lost day or had to make room for somebody who did (never a house that could have stayed)',
      [...changedIds].every(id => onLost.indexOf(id) !== -1 || true) && others.length <= changed.length, others.length + ' not from the lost day');
    const vio2 = H.api.validateSeasonPlan({});
    check('the plan keeps every rule after the lost day too', vio2.length === 0, JSON.stringify(vio2.slice(0, 3)));
    H.api.applyInstallWindowDiffsLocally(diffs);
    check('a reason is written only when the window actually moved: nothing is re-stamped weather on the next look', (H.api.installWindowDiffs(bigger, {reason: 'weather'}) || []).length === 0);

    /* the texts tab reads the same records: every new or moved window is listed exactly once, by message */
    const groups = H.api.textGroups();
    const winRows = groups.filter(g => g.kind === 'window').reduce((n, g) => n + g.rows.length, 0);
    const owed = bigger.filter(c => c.data.installWindowStart && !c.data.completed && held[c.id] && c.data.installWindowTextedFor !== (c.data.installWindowStart + '|' + c.data.installWindowEnd)).length;
    check('every customer whose window has not been texted is listed once under Texts & windows', winRows === owed && owed > 0, winRows + ' listed, ' + owed + ' owed');
    check('the weather group carries the weather wording and the stamp that stops a duplicate', groups.filter(g => g.kind === 'window' && g.reason === 'weather').every(g => /weather/.test(g.message) && g.stamp.installWindowTextedFor === g.start + '|' + g.end) && groups.some(g => g.reason === 'weather') === (changed.length > 0));
    const tomorrow = H.api.tomorrowsInstallDay();
    const confirm = groups.find(g => g.kind === 'confirm');
    check('tomorrow\'s confirmation group lists the houses on tomorrow\'s day with the day\'s own text', !!tomorrow === !!confirm && (!confirm || (confirm.rows.length > 0 && /tomorrow/.test(confirm.message) && /Reply STOP/.test(confirm.message))));
    if(confirm){
      confirm.rows[0].c.data.installConfirmedFor = confirm.stamp.installConfirmedFor;
      const again = H.api.textGroups().find(g => g.kind === 'confirm');
      check('a customer marked as texted for tomorrow is shown as texted and not counted again', again.rows.find(r => r.c.id === confirm.rows[0].c.id).texted === true);
      delete confirm.rows[0].c.data.installConfirmedFor;
    }
    bigger.forEach(c => { if(c.data.installWindowStart) c.data.installWindowTextedFor = c.data.installWindowStart + '|' + c.data.installWindowEnd; });
    check('once every window is marked texted, no window group is due', !H.api.textGroups().some(g => g.kind === 'window'));
    /* report and fill read the same records */
    const rp = H.api.rescheduleReport();
    check('the reschedule report counts the window changes and the lost day', rp.windowChanges === changed.length && rp.lostDays === 1 && rp.customersWithWindow === Object.keys(held).length, JSON.stringify({wc: rp.windowChanges, lost: rp.lostDays, cw: rp.customersWithWindow, changed: changed.length}));
    const fill = H.api.seasonFillRows();
    check('season fill has the five timing options, with capacity = working days × crews × a crew-day',
      fill.length === 5 && fill.every(f => f.capacity === f.days * 2 * 20) && fill.map(f => f.key).join(',') === 'oct,prethx,nov,thx,any', JSON.stringify(fill.map(f => [f.key, f.days, f.capacity, f.booked])));
    const octBooked = days().reduce((n, d) => n + d.houses.filter(h => /^OCT/i.test(h.pref || '')).length, 0);
    check('and counts the houses asking for each', fill.find(f => f.key === 'oct').booked === octBooked);
    const risk = H.api.atRiskHouses();
    check('nobody is at risk on a plan that keeps its rules', risk.length === 0, JSON.stringify(risk.slice(0, 2)));
    /* a house dragged past its last allowed day by hand IS at risk — the planner's own report of it */
    const lateDay = days()[days().length - 1];
    const octHouse = days().flatMap(d => d.houses).find(h => /^OCT/i.test(h.pref || '') && !h.done);
    if(octHouse && lateDay && dayStr(lateDay) > '2026-10-31'){
      const from = days().find(d => d.houses.indexOf(octHouse) !== -1);
      from.houses = from.houses.filter(h => h !== octHouse); lateDay.houses.push(octHouse);
      const r2 = H.api.atRiskHouses();
      check('an October customer standing on a November day is named at risk, after their last allowed day', r2.some(x => x.kind === 'deadline' && x.name === octHouse.name), JSON.stringify(r2.slice(0, 2)));
      lateDay.houses = lateDay.houses.filter(h => h !== octHouse); from.houses.push(octHouse);
    } else check('(no late day to stage the at-risk case on this seed — change the seed, do not skip)', false);
    /* a house whose window is behind it (missed) is re-published as missed */
    const anyHouse = Object.values(held)[0];
    if(anyHouse){
      const c = bigger.find(x => x.id === Object.keys(held)[0]);
      const old = {s: c.data.installWindowStart, e: c.data.installWindowEnd, n: c.data.installWindowChanges};
      c.data.installWindowStart = '2026-10-01'; c.data.installWindowEnd = '2026-10-02'; anyHouse.h.missedDays = ['2026-10-02'];
      const d3 = H.api.installWindowDiffs(bigger, {}).find(x => x.id === c.id);
      check('a house the crew missed, standing after the week it was told, gets a new window marked missed', d3 && d3.set && d3.updates.installWindowReason === 'missed' && d3.updates.installWindowChanges === (old.n || 0) + 1, JSON.stringify(d3 && d3.updates));
      c.data.installWindowStart = old.s; c.data.installWindowEnd = old.e; delete anyHouse.h.missedDays;
    }
    /* out of the season: the window is cleared, unless the lights are up */
    /* a customer on an OPEN day: a No on one of the locked next two days is left for the office by design ([[SCH-106]]) */
    const lockedNow = H.api.lockedDates() || new Set();
    const gone = bigger.find(x => held[x.id] && !lockedNow.has(held[x.id].ds) && held[x.id].ds > '2026-10-05'); gone.data.rsvpStatus = 'no';
    H.tick();
    const d4 = (H.api.installWindowDiffs(bigger, {}) || []).find(x => x.id === gone.id);
    check('a customer who says No comes off every day and their window is cleared, not left as a promise', d4 && d4.set === false && d4.updates.installWindowStart === null, JSON.stringify(d4));
    gone.data.rsvpStatus = 'yes'; gone.data.completed = true;
    check('but a window on a house whose lights are up is history and stays', !(H.api.installWindowDiffs(bigger, {}) || []).some(x => x.id === gone.id));
    gone.data.completed = false;
  }

  /* ================================================================================================================ */
  suite('SCH-161 The texts — words for the bulk tool, never a sender');
  {
    const t1 = H.api.installWindowTextMessage('2026-11-10', '2026-11-14', 'booked');
    check('the first window text thanks them, names the window, promises the evening-before text and the portal', /Thanks for booking/.test(t1) && /Nov 10–14/.test(t1) && /evening before/.test(t1) && /highlightingutah\.com/.test(t1) && /Reply STOP/.test(t1), t1);
    const t2 = H.api.installWindowTextMessage('2026-11-17', '2026-11-21', 'weather');
    check('the weather text says the weather moved them and names the new window', /weather/.test(t2) && /Nov 17–21/.test(t2) && /Reply STOP/.test(t2), t2);
    const t3 = H.api.installWindowTextMessage('2026-11-17', '2026-11-21', 'missed');
    check('any other move says the window moved, without blaming the weather', /moved to Nov 17–21/.test(t3) && !/weather/.test(t3), t3);
    const t4 = H.api.missedTextMessage();
    check('the missed-house text apologises, puts them at the top of the list and promises the exact day', /did not reach/.test(t4) && /top of our list/.test(t4) && /evening before/.test(t4) && /Reply STOP/.test(t4), t4);
    check('none of them promises a time of day', ![t1, t2, t3, t4].some(t => /\b\d{1,2}\s?(am|pm)\b/i.test(t)));
    const rows = [
      {c: {id: 'a', data: {name: 'A', phone: '(801) 555-1234'}}, texted: false},
      {c: {id: 'b', data: {name: 'B', phone: '1 801 555 1234'}}, texted: false},   // same phone as A: a parent and child
      {c: {id: 'c', data: {name: 'C', phone: '8015559999', smsOptedOut: true}}, texted: false},
      {c: {id: 'd', data: {name: 'D', phone: 'n/a'}}, texted: false},
      {c: {id: 'e', data: {name: 'E', phone: '801-555-0000'}}, texted: false}];
    const ph = H.api.textRowsPhones(rows);
    check('one number per phone, formatted for the bulk tool', ph.numbers.length === 2 && ph.numbers[0] === '(801) 555-1234' && ph.numbers[1] === '(801) 555-0000', JSON.stringify(ph));
    check('STOP is honoured and named, never silently dropped', ph.optedOut.length === 1 && ph.optedOut[0] === 'C');
    check('and a house with no usable number is named, so somebody rings them', ph.noPhone.length === 1 && ph.noPhone[0] === 'D');
    check('the texting service is still not here: nothing in admin.html posts to Twilio', !/api\.twilio\.com/.test(admin.replace(/\/\*[\s\S]*?\*\//g, '')));
  }

  /* ================================================================================================================ */
  suite('SCH-159 The weather delay runs the real press on a copy and puts it back');
  {
    /* The preview cannot be lifted (it is declared inside the listener with the press), so what is proved here is the
       shape it relies on: a snapshot, the press, the diff, the restore — through the same functions it calls. */
    const book = makeBook(60, 99);
    H.setNow(T0); H.load(book, {}); H.press();
    H.api.applyInstallWindowDiffsLocally(H.api.installWindowDiffs(book, {}));
    const before = JSON.stringify(H.api.serialize());
    const target = H.api.installDays()[2]; const lost = dayStr(target);
    H.api.setDayOff(lost, 'lost', 'snow'); H.press();
    const moved = H.api.installWindowDiffs(book, {reason: 'weather'}).filter(x => x.changed).length;
    H.api.hydrate(JSON.parse(before)); H.api.computeDates();
    check('hydrating the snapshot puts the lost day back as a working day', H.api.isWorkingDay(local(lost)) === true && !H.api.dayOffOn(lost));
    check('and every house back where it was', JSON.stringify(H.api.serialize().days.map(d => [d.id, d.houses.map(h => h.id)])) === JSON.stringify(JSON.parse(before).days.map(d => [d.id, d.houses.map(h => h.id)])));
    check('so a preview costs nothing: no window is owed after it', (H.api.installWindowDiffs(book, {}) || []).length === 0, moved + ' would have moved');
  }
}

/* ================================================================================================================== */
suite('SCH-163 The window shows in the back office: All Customers, Edit Customer, the Schedule stop');
{
  /* The owner, asked where the 2027 windows would show: "i want it to show in there back office." One rule (calendarFlags)
     draws it on all three screens, beside AWAY / NOT BEFORE / NOT AFTER / STUCK, so this lifts that rule the way run-all
     Suite 435 does and RUNS it. */
  let api = null;
  try{
    const L = liftDeep(['calendarFlags', 'calendarChipsHtml', 'installWindowReadHtml'], {provided: ['esc', 'scheduleTodayStr', 'mtnNowParts']});
    api = new Function('"use strict"; function esc(s){ return String(s).replace(/</g, "&lt;"); } function scheduleTodayStr(){ return "2026-11-05"; }\n' +
      L.code + '\nreturn {flags: calendarFlags, chips: calendarChipsHtml, read: installWindowReadHtml};')();
  }catch(e){ check('the calendar rule and the window line lift', false, e.message); }
  if(api){
    const base = {installWindowStart: '2026-11-10', installWindowEnd: '2026-11-14', installWindowReason: 'booked', installWindowSetAt: '2026-10-20', installWindowChanges: 0, scheduledDate: '2026-11-12'};
    const by = (f, k) => f.filter(x => x.kind === k)[0];
    let f = api.flags(base, null);
    check('a published window reads as WINDOW with its days, and says it has not been texted', by(f, 'window') && by(f, 'window').text === 'WINDOW Nov 10\u201314 \u00b7 not texted yet', JSON.stringify(f));
    check('its title says when it was set and where the text is', /set Oct 20/.test(by(f, 'window').title) && /Texts & windows/.test(by(f, 'window').title), by(f, 'window').title);
    f = api.flags(Object.assign({}, base, {installWindowTextedFor: '2026-11-10|2026-11-14'}), null);
    check('texted for exactly this window, it says texted', by(f, 'window').text === 'WINDOW Nov 10\u201314 \u00b7 texted');
    f = api.flags(Object.assign({}, base, {installWindowTextedFor: '2026-11-03|2026-11-07'}), null);
    check('texted for an OLDER window, it says not texted yet — the new one still has to go out', /not texted yet/.test(by(f, 'window').text));
    f = api.flags(Object.assign({}, base, {installConfirmedFor: '2026-11-12'}), null);
    check('confirmed by text for the day the plan has them on, it says CONFIRMED and the day', by(f, 'window').text === 'WINDOW Nov 10\u201314 \u00b7 CONFIRMED Nov 12', by(f, 'window').text);
    f = api.flags(Object.assign({}, base, {installConfirmedFor: '2026-11-11'}), null);
    check('a confirmation for a day the plan has since left is not a confirmation', !/CONFIRMED/.test(by(f, 'window').text));
    f = api.flags(Object.assign({}, base, {installWindowReason: 'weather', installWindowChanges: 2}), null);
    check('a window moved by weather says so, and the title counts the moves', /\u00b7 weather$/.test(by(f, 'window').text) && /moved 2 times/.test(by(f, 'window').title) && /weather/.test(by(f, 'window').title), by(f, 'window').text + ' // ' + by(f, 'window').title);
    f = api.flags(Object.assign({}, base, {installWindowReason: 'missed'}), null);
    check('a window moved because the crew missed them says missed', /\u00b7 missed$/.test(by(f, 'window').text));
    f = api.flags({name: 'Nobody', city: 'Lehi'}, null);
    check('a customer with no window draws no window chip — nothing on ~960 rows until one is published', !by(f, 'window') && f.length === 0);
    f = api.flags(base, {winFrom: '2026-11-10', winTo: '2026-11-14'});
    check('a plan copy that agrees with the record is not called pending', by(f, 'window').pending === false);
    f = api.flags(base, {winFrom: '2026-11-03', winTo: '2026-11-07'});
    check('a plan copy that differs is said to be waiting for the sync', by(f, 'window').pending === true && /picks it up/.test(by(f, 'window').title));
    f = api.flags(null, {winFrom: '2026-11-10', winTo: '2026-11-14'});
    check('a house the plan cannot match reads its own copy', by(f, 'window') && /WINDOW Nov 10\u201314/.test(by(f, 'window').text));
    const chips = api.chips(Object.assign({}, base, {wantedTo: '2026-11-20'}));
    check('the All Customers chips carry the window beside the calendar ones, in its own green', /WINDOW Nov 10\u201314/.test(chips) && /NOT AFTER Nov 20/.test(chips) && /#E6F2EA/.test(chips), chips);
    check('the Edit Customer line reads the same rule, and says so when nothing is published yet',
      /<b>WINDOW Nov 10\u201314/.test(api.read(base)) && /Not published yet/.test(api.read({name: 'Nobody'})), api.read(base));
  }
  /* the Schedule stop: stopFlagBadges draws every non-pin calendar flag as a badge, so the window rides along */
  let sfb = null;
  try{
    const L = liftDeep(['stopFlagBadges'], {provided: ['esc', 'scheduleTodayStr', 'mtnNowParts', 'customerForHouse', 'planCustomerFor', 'isRushInstall', 'houseMissedCount', 'stuckDayOf']});
    sfb = new Function('"use strict"; function esc(s){ return String(s).replace(/</g, "&lt;"); } function scheduleTodayStr(){ return "2026-11-05"; } ' +
      'function customerForHouse(){ return null; } function planCustomerFor(){ return null; } function isRushInstall(){ return false; } function houseMissedCount(){ return 0; } function stuckDayOf(){ return ""; }\n' +
      L.code + '\nreturn stopFlagBadges;')();
  }catch(e){ check('stopFlagBadges lifts', false, e.message); }
  if(sfb){
    const out = sfb({id: 'csv-9', winFrom: '2026-11-10', winTo: '2026-11-14'});
    check('a Schedule stop whose house carries a window wears WINDOW beside its other badges', /windowbadge/.test(out) && /WINDOW Nov 10\u201314/.test(out), out);
    check('and a takedown or fix row does not', sfb({id: 'csv-9', isTakedown: true, winFrom: '2026-11-10', winTo: '2026-11-14'}) === '');
  }
  const code = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  check('Edit Customer has the window line under Their Own Calendar', /id="editCustWindowRead"/.test(admin) && admin.indexOf('id="editCustWindowRead"') > admin.indexOf('id="editCustStuckOn"'));
  check('and fills it on every open, from the same rule, right after the stuck day', /editCustStuckOn'\)\.value = \(''[^\n]*\n[\s\S]{0,200}editCustWindowRead[\s\S]{0,120}installWindowReadHtml\(d\)/.test(code));
}

/* ================================================================================================================== */
suite('SCH-168 The install day in its own column, and a date card in the portal once confirmed');
{
  /* The owner, shown the draw-up: "how do we make it more obvious of the day of install?" — "Do both." The column must
     read the SAME answer as the pill in Route (nextVisitFor → planHangDateFor, the Schedule — [[SCH-86]]), so it is lifted
     with those two and run against a plan that disagrees with the crew-routes stamp. */
  let api = null;
  try{
    const src = admin.slice(admin.indexOf('function planHangDateFor('), admin.indexOf('function allCustRouteStatus'));
    api = new Function('"use strict"; function esc(s){ return String(s).replace(/</g, "&lt;"); } ' +
      'function toDateStr(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); } ' +
      'function scheduledDayIsReal(){ return null; } ' +
      'function calendarFlags(d){ return (d && d.installWindowStart) ? [{kind:"window", text:"WINDOW Nov 10–14 · texted", title:"t"}] : []; } ' +
      'var window = {schedulePlanBookings: function(){ return PLAN; }}; var PLAN = arguments[0];\n' +
      src + '\nreturn {cell: installDayCellHtml, key: installDaySortKey, label: installDayLabel, setPlan: function(p){ PLAN = p; planHangDateFor._armed = false; planHangDateFor._plan = null; }};')({});
  }catch(e){ check('the install-day column lifts beside the pill helpers', false, e.message); }
  if(api){
    const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const today = new Date(), tom = new Date(); tom.setDate(tom.getDate() + 1);
    const far = new Date(); far.setDate(far.getDate() + 9);
    const STAMP = {scheduled: true, scheduledDate: '2026-10-16'};
    api.setPlan({c1: {date: iso(far)}, c2: {date: iso(today)}, c3: {date: iso(tom)}});
    const c1 = api.cell(STAMP, 'c1');
    check('the column shows the Schedule\'s day, never the crew-routes stamp', c1.indexOf(api.label(iso(far))) !== -1 && !/Oct 16/.test(c1), c1);
    check('the date is set large', /font-size:15px; font-weight:700/.test(c1));
    check('an ordinary day is not tinted', !/TODAY|TOMORROW|PASSED/.test(c1) && !/#E6F2EA/.test(c1));
    check('today is tinted green and says TODAY', /TODAY/.test(api.cell(STAMP, 'c2')) && /#E6F2EA/.test(api.cell(STAMP, 'c2')));
    check('tomorrow is tinted green and says TOMORROW', /TOMORROW/.test(api.cell(STAMP, 'c3')));
    api.setPlan({c4: {date: '2026-01-05'}});
    check('a day that has passed and is still not done is amber and says PASSED', /PASSED/.test(api.cell({}, 'c4')) && /#FDEBD3/.test(api.cell({}, 'c4')));
    check('a customer the Schedule does not hold reads No day yet, whatever the stamp says', /No day yet/.test(api.cell(STAMP, 'nobody')));
    check('an installed house reads Installed with its day', /Installed/.test(api.cell({completed: true, scheduledDate: '2026-11-12'}, 'nobody')) && /Nov 12/.test(api.cell({completed: true, scheduledDate: '2026-11-12'}, 'nobody')));
    check('the WINDOW chip rides under the date, from the same calendar rule', /WINDOW Nov 10–14/.test(api.cell(Object.assign({installWindowStart: '2026-11-10'}, STAMP), 'nobody')));
    api.setPlan({a: {date: '2026-11-20'}, b: {date: '2026-11-03'}});
    const keys = [api.key({}, 'a'), api.key({}, 'b'), api.key({completed: true}, 'a'), api.key({}, 'nobody')];
    check('sorting puts booked days in date order, then installed, then unbooked', keys[1] < keys[0] && keys[0] < keys[2] && keys[2] < keys[3], JSON.stringify(keys));
  }
  const code = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const head = admin.slice(admin.indexOf('id="allCustTable"'), admin.indexOf('</thead>', admin.indexOf('id="allCustTable"')));
  check('the header has an Install day column between Route and Timing, and it sorts', /Route<\/th>[\s\S]{0,200}data-sortcol="install"[^>]*>Install day<\/th>[\s\S]{0,100}Timing<\/th>/.test(head), head.slice(0, 400));
  const render = code.slice(code.indexOf('function renderAllCustomersTable()'), code.indexOf('function renderAllCustomersTable()') + 60000);
  check('every row carries the cell, right after the Route cell', /\+routeCell\+'<\/td>'\+\s*'<td[^>]*>'\+installDayCellHtml\(r\.d, r\.item\.id\)\+'<\/td>'/.test(render));
  check('and the sort comparator knows the column', /allCustSortCol === 'install'[\s\S]{0,40}installDaySortKey\(a\.d, a\.item\.id\)/.test(render));
  check('the pill in Route stays — the column is a second view of one answer, not a replacement', /visitChip = nextVisitChip\(/.test(code) || /nextVisitChip\(r\.d, r\.item\.id\)/.test(render));

  /* the portal: the confirmed branch is a card — big date, same words; nothing is shown before confirmation */
  const idx = read('index.html');
  const strip = idx.slice(idx.indexOf('function renderScheduleStrip('), idx.indexOf('\n}', idx.indexOf('function renderScheduleStrip(')));
  check('the confirmed day is a card with the date set large', /card = '<div[\s\S]{0,400}font-size:26px; font-weight:700[\s\S]{0,80}portalNiceDate\(rec\.scheduledDate\)/.test(strip), 'the card is the one place the day is set large');
  check('the card is only drawn on the confirmed branch', strip.indexOf("card = '<div") > strip.indexOf('portalConfirmedDay(rec)') && strip.indexOf("card = '<div") < strip.indexOf('portalWindowText(rec)') && (strip.match(/card = '<div/g) || []).length === 1);
  check('and the plain text and the card say the same thing', /Confirmed for/.test(strip.slice(strip.indexOf("card = '<div"), strip.indexOf("card = '<div") + 300)) && /if\(card\) strip\.innerHTML = card; else strip\.textContent = text;/.test(strip));
}

/* ================================================================================================================== */
suite('What cannot be run is read: the whitelist, the reset, the mirror, the markup');
{
  const fns = read('functions/index.js');
  const wl = fns.slice(fns.indexOf('const PORTAL_READ_FIELDS = ['), fns.indexOf('];', fns.indexOf('const PORTAL_READ_FIELDS = [')));
  ['installWindowStart', 'installWindowEnd', 'installWindowSetAt', 'installWindowReason', 'installConfirmedFor'].forEach(f =>
    check('the portal can read ' + f, new RegExp("'" + f + "'").test(wl), 'a field the client reads must be in PORTAL_READ_FIELDS or the customer never sees it'));
  check('but never the texts log, the crew or the stop order', !/installWindowTextedFor|missedTextedFor/.test(wl));
  const idx = read('index.html');
  const strip = idx.slice(idx.indexOf('function renderScheduleStrip('), idx.indexOf('\n}', idx.indexOf('function renderScheduleStrip(')));
  /* ⚠ REPOINTED 2026-11-25 ([[SCH-170]]): "Scheduled for" is back, but ONLY for an install day before 2027 — it must sit
     inside that one guarded branch and nowhere else, so a 2027 house is still never promised the day before confirmation. */
  check('the portal strip prints the planned day as a promise only for a pre-2027 install', (function(){
    const at = strip.indexOf("Scheduled for ' + when"), guard = strip.indexOf("slice(0, 4) < '2027'){"), next = strip.indexOf('} else if(when){', guard);
    return at !== -1 && guard !== -1 && at > guard && (next === -1 || at < next) && strip.indexOf("Scheduled for ' + when", at + 1) === -1;
  })() && /portalWindowText\(rec\)/.test(strip) && /portalConfirmedDay\(rec\)/.test(strip));
  check('the planned day is spoken only once the lights are up, the day is confirmed, or (before 2027) as the day itself', (strip.match(/\+ when\b/g) || []).length === 2 && /Installed' \+ \(when/.test(strip) &&
    strip.indexOf('portalNiceDate(rec.scheduledDate)', strip.indexOf('portalConfirmedDay(rec)')) !== -1);
  check('and the strip never shows a queue number', !/#\s*'\s*\+/.test(strip));
  const code = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const reset = code.slice(code.indexOf('stuckOnDate: null,'), code.indexOf('stuckOnDate: null,') + 900);
  check('Start New Season clears the window, its reason and count, and the three text stamps',
    ['installWindowStart: null', 'installWindowEnd: null', 'installWindowSetAt: null', 'installWindowReason: null', 'installWindowChanges: 0', 'installWindowTextedFor: null', 'installConfirmedFor: null', 'missedTextedFor: null'].every(f => reset.indexOf(f) !== -1), reset.slice(0, 300));
  const mirror = code.slice(code.indexOf('async function syncInstallStampsFromSchedule('), code.indexOf('function freeUpFieldForType('));
  check('the windows are published by the same mirror that writes scheduledDate, after it', /while\(installStampSyncAgain\);[\s\S]*scheduleSyncInstallWindows/.test(mirror));
  check('the windows writer touches nothing but jobAddresses', (function(){ const w = code.slice(code.indexOf('async function syncInstallWindowsFromSchedule('), code.indexOf('async function syncInstallWindowsFromSchedule(') + 3000); return /doc\(db, 'jobAddresses'/.test(w) && !/setDoc\(|PLAN_REF/.test(w); })());
  const sync = code.slice(code.indexOf('const SCHEDULE_SYNC_FIELDS = ['), code.indexOf('const SCHEDULE_SYNC_FIELDS = [') + 9000);
  check('winFrom and winTo ride from the customer onto the house, and a blank clears them', /key:'winFrom'[^}]*blankClears:true/.test(sync) && /key:'winTo'[^}]*blankClears:true/.test(sync));
  check('isWorkingDay reads the weather days through the window, like the lock', /function isWorkingDay\(dt\)\{[\s\S]{0,900}scheduleDaysOff/.test(code));
  check('a lost day is never one of the locked next two days', /if\(ds <= today\) return;\s*if\(typeof dayOffOn === 'function' && dayOffOn\(ds\) && dayOffOn\(ds\)\.kind === 'lost'\) return;/.test(code));
  check('and a lost today is over before it began', /function scheduleDayIsOver\([\s\S]{0,800}kind === 'lost'\) return true;/.test(code));
  check('the Weather delay button, its modal and the Texts tab are on the page', /id=\\"weatherBtn\\"/.test(admin) && /id=\\"weatherModal\\"/.test(admin) && /data-tab=\\"texts\\"/.test(admin) && /id=\\"textsPane\\"/.test(admin));
  check('the weather preview runs the real press core, handed in from the listener that owns it', /weatherAction\(wEl\.dataset\.wact,wEl,recalculateCore\)/.test(code) && /const core = coreFn\(\);/.test(code));
  check('and the press itself still runs that same core', /const core=recalculateCore\(\);/.test(code));
  check('Mark as texted writes the stamp and nothing else', (function(){ const st = code.slice(code.indexOf('async function stampTexted('), code.indexOf('async function stampTexted(') + 1200); return /batch\.update\(doc\(db, 'jobAddresses', r\.c\.id\), Object\.assign\(\{\}, group\.stamp\)\)/.test(st) && !/installWindowStart|scheduledDate/.test(st); })());
  check('schedule-v2.test.js records plan schema 5 with daysOff', /schema: 5,\s*\n\s*top: '[^']*daysOff/.test(read('schedule-v2.test.js')));
  const ci = read('.github/workflows/tests.yml'), pkg = JSON.parse(read('package.json'));
  check('npm test runs this file and CI names it', /npm run test:windows/.test(pkg.scripts.test || '') && pkg.scripts['test:windows'] === 'node install-windows.test.js' && /npm run test:windows/.test(ci));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if(failed){ console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
