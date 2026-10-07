/* schedule-v2.test.js — SCHEDULE V2 (2026-09-30, [[SCH-102]], [[SCH-103]]).
 *
 * Its own file per R-018. `npm run test:schedule-v2`.
 *
 * Every check here RUNS the real functions lifted out of admin.html — never a copy of them —
 * because every claim is about where a house ENDS UP, which no source match can see. A lifted
 * function that cannot be found FAILS the file; it never skips.
 *
 * Phases (the order of the V2 checklist):
 *   1  one install-date authority, one lock, one legality check
 *   2  the scheduling profile: hard windows vs soft preferences, named priority classes
 *   3  candidate days, geographic grouping, deterministic day filling, crew balance
 *   4  weather as a soft preference
 *   5  routing never changes a date
 *   6  incremental placement (a new Confirmed customer, a priority customer)
 *   7  explanations
 *   8  the invariant validator, and that it CATCHES planted faults
 *   9  simulated seasons: small, medium, full, adversarial
 *   13 individual customer priority
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
let currentSuite = '';
function suite(t){ currentSuite = t; console.log('\n=== ' + t + ' ==='); }
function check(name, ok, why){
  if(ok){ passed++; console.log('  PASS  ' + name); }
  else { failed++; fails.push(currentSuite + ' — ' + name + (why ? ' — ' + why : '')); console.log('  FAIL  ' + name + (why ? ' — ' + why : '')); }
}

/* Brace-walking extractor, comment- and string-aware enough for this file. Starts at the
   `async`, if any, so a lifted async function is not a bare-await parse error. */
function extractFn(src, name){
  let i = src.indexOf('async function ' + name + '(');
  if(i === -1) i = src.indexOf('function ' + name + '(');
  if(i === -1) return null;
  let j = src.indexOf('{', src.indexOf(')', i));
  let depth = 0, k = j, inStr = null, esc = false;
  for(; k < src.length; k++){
    const c = src[k], n = src[k + 1];
    if(inStr){
      if(esc){ esc = false; continue; }
      if(c === '\\'){ esc = true; continue; }
      if(c === inStr) inStr = null;
      continue;
    }
    if(c === '/' && n === '*'){ const e = src.indexOf('*/', k + 2); k = e + 1; continue; }
    if(c === '/' && n === '/'){ const e = src.indexOf('\n', k); k = e; continue; }
    if(c === '"' || c === "'" || c === '`'){ inStr = c; continue; }
    if(c === '{') depth++;
    else if(c === '}'){ depth--; if(depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}
function constOf(name){
  const m = admin.match(new RegExp('const ' + name + '\\s*=\\s*[^;]+;'));
  return m ? m[0] : null;
}
/* ---- the dependency-following lifter ---------------------------------------------------
   Lifts a function AND every top-level function / const it reaches, recursively, from the
   real file. The point is the house rule "lift, never stub": a sandbox that hand-picks its
   dependencies is how a suite ends up passing on a helper it never supplied. Names declared
   twice in admin.html (the widget and the main app each have one) take the LAST declaration
   unless `pick` names an occurrence — the Schedule widget sits near the end of the file, and
   the scheduler functions under test are the widget's. */
const FN_DECLS = {};
(function(){
  const re = /(^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while((m = re.exec(admin))){ (FN_DECLS[m[2]] = FN_DECLS[m[2]] || []).push(m.index + m[1].length); }
})();
const CONST_DECLS = {};
(function(){
  const re = /(^|\n)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while((m = re.exec(admin))){ (CONST_DECLS[m[2]] = CONST_DECLS[m[2]] || []).push(m.index + m[1].length); }
})();
function sliceFnAt(pos){
  const i = admin.indexOf('function', pos);
  const start = /async\s+$/.test(admin.slice(Math.max(0, i - 8), i)) ? admin.lastIndexOf('async', i) : pos;
  const sub = extractFn(admin.slice(start), admin.slice(i).match(/function\s+([\w$]+)/)[1]);
  return sub;
}
function sliceConstAt(pos){
  let k = admin.indexOf('=', pos) + 1, depth = 0, inStr = null, esc = false;
  for(; k < admin.length; k++){
    const c = admin[k], n = admin[k + 1];
    if(inStr){ if(esc){ esc = false; continue; } if(c === '\\'){ esc = true; continue; } if(c === inStr) inStr = null; continue; }
    if(c === '/' && n === '*'){ k = admin.indexOf('*/', k + 2) + 1; continue; }
    if(c === '/' && n === '/'){ k = admin.indexOf('\n', k); continue; }
    if(c === '"' || c === "'" || c === '`'){ inStr = c; continue; }
    if(c === '(' || c === '[' || c === '{') depth++;
    else if(c === ')' || c === ']' || c === '}') depth--;
    else if((c === ';' || c === '\n') && depth === 0){
      if(c === ';') return admin.slice(pos, k + 1);
      const rest = admin.slice(k + 1).match(/^\s*([.?:+\-*&|])/);
      if(!rest) return admin.slice(pos, k) + ';';
    }
  }
  return null;
}
const JS_WORDS = new Set(('break case catch class const continue debugger default delete do else export extends ' +
  'finally for function if import in instanceof let new return super switch this throw try typeof var void while ' +
  'with yield await async true false null undefined NaN Infinity Math Date Object Array String Number Boolean ' +
  'JSON Set Map Promise console window document parseInt parseFloat isNaN Error RegExp').split(' '));
function liftDeep(roots, opts){
  opts = opts || {};
  const provided = new Set(opts.provided || []);
  const pick = opts.pick || {};
  const seen = new Set();
  const order = [];
  function want(name){
    if(seen.has(name) || provided.has(name) || JS_WORDS.has(name)) return;
    const fns = FN_DECLS[name], cs = CONST_DECLS[name];
    if(!fns && !cs) return;
    seen.add(name);
    let src;
    if(fns){
      const at = fns[pick[name] !== undefined ? pick[name] : fns.length - 1];
      src = sliceFnAt(at);
    } else {
      const at = cs[pick[name] !== undefined ? pick[name] : cs.length - 1];
      src = sliceConstAt(at);
    }
    if(!src){ seen.delete(name); return; }
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
    const ids = body.match(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g) || [];
    ids.forEach(t => { const n = t.replace(/^[^A-Za-z_$]/, ''); if(n !== name) want(n); });
    order.push({name: name, src: src, isFn: !!fns});
  }
  roots.forEach(want);
  /* consts first (in file order), then functions — function declarations hoist, consts do not. */
  const consts = order.filter(o => !o.isFn), fns = order.filter(o => o.isFn);
  return {names: order.map(o => o.name), code: consts.map(o => o.src.replace(/^(\s*)const\b/, '$1var').replace(/^(\s*)let\b/, '$1var')).join('\n') + '\n' + fns.map(o => o.src).join('\n')};
}
function sandbox(roots, preamble, ret, opts){
  const L = liftDeep(roots, opts);
  return new Function((preamble || '') + '\n' + L.code + '\n' + ret)();
}
function lift(names, preamble, ret){
  const parts = [];
  for(const n of names){
    const s = extractFn(admin, n);
    if(!s) throw new Error('could not find function ' + n + ' in admin.html');
    parts.push(s);
  }
  return new Function((preamble || '') + '\n' + parts.join('\n') + '\n' + ret)();
}

/* ======================================================================================= */
suite('1.1 The Schedule is the only install-date authority');
{
  let api = null;
  try { api = lift(['installStampDiffs'], '', 'return {diffs: installStampDiffs};'); }
  catch(e){ check('installStampDiffs is findable', false, e.message); }
  if(api){
    const cust = (id, d) => ({id: id, data: Object.assign({}, d)});
    const isOut = d => d.rsvpStatus === 'no' || d.rsvpStatus === 'backnextyear';

    check('a plan that cannot answer (null) writes NOTHING — never read as "nobody is booked"',
      api.diffs(null, [cust('a', {scheduled: true, scheduledDate: '2026-10-05'})], isOut) === null);

    const plan = {a: {date: '2026-10-15', crew: '1'}, b: {date: '2026-10-06', crew: '2'}};
    const book = [
      cust('a', {scheduled: true, scheduledDate: '2026-10-16', assignedCrew: '1'}),   // the Darlene case: routes said 16th
      cust('b', {scheduled: true, scheduledDate: '2026-10-06', assignedCrew: '2'}),   // already right
      cust('c', {scheduled: true, scheduledDate: '2026-10-09', assignedCrew: '1'}),   // stamped, not on the plan
      cust('d', {}),                                                                 // never stamped, not on plan
      cust('e', {scheduled: true, scheduledDate: '2026-10-01', completed: true}),     // hung, history
      cust('f', {rsvpStatus: 'no', scheduled: true, scheduledDate: '2026-10-20'})     // said no, stale plan holds them
    ];
    plan.f = {date: '2026-10-20', crew: '1'};
    const out = api.diffs(plan, book, isOut);
    const by = {}; out.forEach(x => { by[x.id] = x; });
    check('if the Schedule says Oct 15, the record says Oct 15 — the crew-routes 16th is overwritten',
      by.a && by.a.updates.scheduledDate === '2026-10-15' && by.a.updates.scheduled === true);
    check('a record already matching the Schedule is not written at all', !by.b);
    check('a stamp the Schedule does not hold is cleared', by.c && by.c.updates.scheduledDate === null && by.c.updates.scheduled === false);
    check('a customer never stamped and not on the plan is left alone', !by.d);
    check('a hung house that has left the plan keeps the day it was hung', !by.e);
    check('somebody out for the season is cleared even while a stale plan still holds them',
      by.f && by.f.updates.scheduled === false);
    check('the crew rides with the date', by.a.updates.assignedCrew === '1');
    check('running it again on its own output changes nothing (it settles)', (function(){
      const after = book.map(c => { const x = by[c.id]; return x ? cust(c.id, Object.assign({}, c.data, x.updates)) : c; });
      return api.diffs(plan, after, isOut).length === 0;
    })());
  }

  /* The wiring — each of these is a door the old second planner came in by. */
  const noComments = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  check('the fifteen-minute crew-routes sweep does not start',
    /const RECONCILE_SWEEP_ENABLED = false;/.test(admin) &&
    /function startReconcileAuto\(\)\{\s*if\(!RECONCILE_SWEEP_ENABLED\) return;/.test(noComments));
  check('changing the crew count no longer kicks the sweep', (function(){
    const i = noComments.indexOf("logActivity('Crews per day set to '");
    const j = noComments.indexOf('} catch(err){', i);
    return i > 0 && j > i && noComments.slice(i, j).indexOf('runReconcileAuto') === -1;
  })());
  check('Save on the Routes tab refuses an INSTALL route before any write', (function(){
    const i = noComments.indexOf("document.getElementById('markScheduledBtn').addEventListener");
    const g = noComments.indexOf("if(currentRouteType === 'install'){", i);
    const w = noComments.indexOf('await setDoc(doc(db,\'scheduledRoutes\'', i);
    const r = noComments.indexOf('return;', g);
    return i > 0 && g > i && r > g && w > r;
  })());
  check('adding a customer no longer stamps a crew-routes day', /const AUTO_ROUTE_NEW_CUSTOMERS = false;/.test(admin) &&
    /if\(!AUTO_ROUTE_NEW_CUSTOMERS\)\{\s*return \{done:false/.test(noComments));
  check('Recalculate everything mirrors the Schedule onto the records, and no longer clears against crew routes', (function(){
    const i = noComments.indexOf('const routes=generateAllRoutes(');
    const j = noComments.indexOf('preRebuild=before;', i);
    const body = noComments.slice(i, j);
    return i > 0 && j > i && body.indexOf('syncInstallStampsFromSchedule()') !== -1 && body.indexOf('clearStaleInstallBookings(') === -1;
  })());
  check('every saved plan is mirrored onto the records', /mirrorStampsSoon\(\);\}catch\(e\)/.test(noComments) &&
    /async function saveNow\(\)\{try\{await setDoc\(PLAN_REF\(\),serialize\(\)\);[^}]*mirrorStampsSoon\(\)/.test(noComments));
  check('"is this day real" asks the Schedule, not the crew-routes calendar', (function(){
    const s = extractFn(admin, 'scheduledDayIsReal') || '';
    return s.indexOf('window.schedulePlanBookings()') !== -1 && s.indexOf('window.schedulePlanBookings()') < s.indexOf('scheduledRoutesCache');
  })());
  {
    let real = null;
    try {
      real = lift(['scheduledDayIsReal'], 'var window = {schedulePlanBookings: function(){ return window.__p; }};',
        'return {real: scheduledDayIsReal, win: window};');
    } catch(e){ check('scheduledDayIsReal is findable', false, e.message); }
    if(real){
      real.win.__p = {a: {date: '2026-10-15'}};
      check('a stamp matching the Schedule is real', real.real('a', '2026-10-15') === true);
      check('a stamp the Schedule does not hold is not', real.real('a', '2026-10-16') === false);
      real.win.__p = null;
      check('before the plan loads it cannot say (null), so no row shouts', real.real('a', '2026-10-15') === null);
    }
  }
}

/* ======================================================================================= */
suite('1.2 One lock: 48 hours OR the next two working days, for every mover');
{
  let api = null;
  try {
    const a = admin.indexOf('const ROUTE_LOCK_HOURS = 48;');
    const b = admin.indexOf('async function reconcileUpcomingRoutes');
    api = new Function(admin.slice(a, b) + '\nreturn {locked: routeDayIsLocked};')();
  } catch(e){ check('the lock is findable', false, e.message); }
  if(api){
    const now = (d, h) => ({date: d, hour: h, minute: 0});
    check('Friday morning: Monday is locked (the gap the sync used to fall through)', api.locked('2026-10-05', now('2026-10-02', 8)) === true);
    check('Friday morning: Tuesday is locked', api.locked('2026-10-06', now('2026-10-02', 8)) === true);
    check('Friday morning: Wednesday is open', api.locked('2026-10-07', now('2026-10-02', 8)) === false);
    check('Monday: Wednesday locked, Thursday open', api.locked('2026-10-07', now('2026-10-05', 8)) === true && api.locked('2026-10-08', now('2026-10-05', 8)) === false);
    check('Thanksgiving is not a working day in the count', api.locked('2026-11-30', now('2026-11-25', 8)) === true && api.locked('2026-12-01', now('2026-11-25', 8)) === false);
    check('today and the past stay locked', api.locked('2026-10-05', now('2026-10-05', 8)) && api.locked('2026-10-01', now('2026-10-05', 8)));
    check('late evening: the 48 hours alone already reach two days out', api.locked('2026-10-07', now('2026-10-05', 23)) === true);
  }
  /* Every mover inside the Schedule asks the same function. */
  const movers = ['nextInstallDayFor', 'placeStuckHouses', 'placeConfirmedLeftOff', 'generateAllRoutes'];
  movers.forEach(n => {
    const s = extractFn(admin, n) || '';
    check(n + ' asks routeDayIsLocked', s.indexOf('routeDayIsLocked(') !== -1, 'a mover that does not ask the one lock can rewrite printed paper');
  });
}

/* ======================================================================================= */
suite('1.3 One legality check for every date rule (houseMayGoOn)');
const DATE_PRE = 'var BASE_START = new Date(2026, 9, 1);';
let D = null;
try {
  D = sandbox(['houseMayGoOn', 'houseDateWindow', 'houseEarliestDay', 'isWorkingDay'], DATE_PRE,
    'return {may: houseMayGoOn, win: houseDateWindow, earliest: houseEarliestDay, working: isWorkingDay, iso: isoOf};');
} catch(e){ check('the date rules are liftable', false, e.message); }
if(D){
  const S = '2026-10-01';
  const ok = (h, c, ds) => D.may(h, c || {}, ds, S).ok;
  check('Oct 1 (a Thursday) is open to a no-preference house', ok({pref: ''}, {}, '2026-10-01'));
  check('a weekend never is', !ok({pref: ''}, {}, '2026-10-03') && !ok({pref: ''}, {}, '2026-10-04'));
  check('Thanksgiving Day never is', !ok({pref: ''}, {}, '2026-11-26'));
  check('the day after Thanksgiving is a working day', ok({pref: ''}, {}, '2026-11-27'));
  check('October: Oct 31 is too late? (a Saturday — not working)', !ok({pref: 'October'}, {}, '2026-10-31'));
  check('October: Oct 30 is the last good day', ok({pref: 'October'}, {}, '2026-10-30'));
  check('October: Nov 2 is refused as after their last day', D.may({pref: 'October'}, {}, '2026-11-02', S).why.indexOf('after their last day') === 0);
  check('November: Oct 30 refused, Nov 2 allowed', !ok({pref: 'November'}, {}, '2026-10-30') && ok({pref: 'November'}, {}, '2026-11-02'));
  check('Before Thanksgiving: opens 7 days before (Nov 19), not Nov 2', !ok({pref: 'November - Before Thanksgiving'}, {}, '2026-11-18') &&
    ok({pref: 'November - Before Thanksgiving'}, {}, '2026-11-19'));
  check('Before Thanksgiving: never after the holiday', !ok({pref: 'November - Before Thanksgiving'}, {}, '2026-11-27'));
  check('After Thanksgiving: Nov 25 refused, Nov 27 allowed', !ok({pref: 'After Thanksgiving'}, {}, '2026-11-25') && ok({pref: 'After Thanksgiving'}, {}, '2026-11-27'));
  check('a named day (11/9+) is a floor: Nov 6 refused, Nov 9 allowed, Nov 20 allowed',
    !ok({pref: '11/9+'}, {}, '2026-11-06') && ok({pref: '11/9+'}, {}, '2026-11-09') && ok({pref: '11/9+'}, {}, '2026-11-20'));
  check('office date: never before it, and not more than 5 working days after',
    !ok({pref: '', notBefore: '2026-10-12'}, {}, '2026-10-09') && ok({pref: '', notBefore: '2026-10-12'}, {}, '2026-10-19') &&
    !ok({pref: '', notBefore: '2026-10-12'}, {}, '2026-10-20'));
  check('wanted window: boundaries inclusive', !ok({pref: '', wantFrom: '2026-10-12', wantTo: '2026-10-16'}, {}, '2026-10-09') &&
    ok({pref: '', wantFrom: '2026-10-12', wantTo: '2026-10-16'}, {}, '2026-10-12') &&
    ok({pref: '', wantFrom: '2026-10-12', wantTo: '2026-10-16'}, {}, '2026-10-16') &&
    !ok({pref: '', wantFrom: '2026-10-12', wantTo: '2026-10-16'}, {}, '2026-10-19'));
  const awayH = {pref: '', away: '2026-10-12..2026-10-14'};
  check('away dates: both named days are away, the days around them are not', (function(){
    return ok(awayH, {}, '2026-10-09') && !ok(awayH, {}, '2026-10-12') && !ok(awayH, {}, '2026-10-14') && ok(awayH, {}, '2026-10-15');
  })(), 'check the stored away format: ' + JSON.stringify(D.win(awayH, {}, S)));
  check('a pin allows its own day only — and overrules an away date on it',
    ok({pref: 'November', stuck: '2026-10-13', away: '2026-10-12..2026-10-14'}, {}, '2026-10-13') &&
    !ok({pref: '', stuck: '2026-10-13'}, {}, '2026-10-14'));
  /* The warehouse hold: 72 working hours from when the build was queued. */
  const q = new Date(2026, 9, 2, 15, 0).getTime();   // Friday 3pm
  const held = {lightsQueuedAt: {toMillis: () => q}, needsLightBuild: true};
  const e = D.earliest({pref: ''}, held, S);
  check('warehouse hold: a Friday-afternoon build is not scheduled before the following Thursday', e >= '2026-10-08', 'earliest = ' + e);
  check('warehouse hold: the later of hold and month wins (November stays November)', D.earliest({pref: 'November'}, held, S) === '2026-11-01');
}

/* ======================================================================================= */
/* THE REAL RECALCULATE, OFFLINE — see schedule-v2.harness.js. Built once, reloaded per scenario. */
let H = null;
try { H = require('./schedule-v2.harness.js')(liftDeep); }
catch(e){ suite('harness'); check('the real Recalculate lifts and builds offline', false, e.stack.split('\n').slice(0, 3).join(' | ')); }

/* A seeded book over real Utah towns (centres to ~0.01°), shaped like the real 2026 list:
   ~21% October, ~24% November, ~2% a named day or Thanksgiving, the rest "any". */
const TOWNS = {
  'Lehi': [40.3916, -111.8508], 'American Fork': [40.3769, -111.7958], 'Pleasant Grove': [40.3641, -111.7385],
  'Lindon': [40.3433, -111.7208], 'Orem': [40.2969, -111.6946], 'Provo': [40.2338, -111.6585],
  'Saratoga Springs': [40.3491, -111.9043], 'Eagle Mountain': [40.3141, -112.0069], 'Highland': [40.4250, -111.7955],
  'Alpine': [40.4533, -111.7780], 'Draper': [40.5247, -111.8638], 'Herriman': [40.5141, -112.0330],
  'South Jordan': [40.5622, -111.9297], 'Riverton': [40.5219, -111.9391], 'Sandy': [40.5649, -111.8389],
  'Springville': [40.1652, -111.6108], 'Spanish Fork': [40.1149, -111.6549], 'Vineyard': [40.2974, -111.7466]
};
const FAR = {'Levan': [39.5541, -111.8633], 'Payson': [40.0444, -111.7321]};
function rng(seed){ let x = seed >>> 0 || 1; return function(){ x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const YES = {rsvpStatus: 'yes', rsvpRespondedAt: {toMillis: () => new Date(2026, 8, 1).getTime()}};
function makeBook(n, seed, opts){
  const o = opts || {};
  const r = rng(seed);
  const names = o.towns || Object.keys(TOWNS);
  const book = [];
  for(let i = 0; i < n; i++){
    const town = names[Math.floor(r() * names.length)];
    const c = TOWNS[town];
    const u = r();
    const pref = u < 0.21 ? 'October' : u < 0.45 ? 'November' : u < 0.46 ? 'November - Before Thanksgiving' :
                 u < 0.47 ? '11/9+' : 'Normal Schedule';
    book.push({id: 'c' + seed + '_' + i, data: Object.assign({
      name: 'Cust ' + i, customerNumber: String(1000 + i), city: town, address: (100 + i) + ' Test Ln',
      phone: '801555' + String(1000 + i), lat: c[0] + (r() - 0.5) * 0.04, lng: c[1] + (r() - 0.5) * 0.04,
      installPreference: pref}, YES)});
  }
  if(o.far) Object.keys(FAR).forEach(function(t, k){
    book.push({id: 'far' + k, data: Object.assign({name: 'Far ' + t, customerNumber: String(9000 + k), city: t,
      address: '1 Far Rd', lat: FAR[t][0], lng: FAR[t][1], installPreference: 'Normal Schedule'}, YES)});
  });
  return book;
}
const TODAY = new Date(2026, 8, 30, 7, 0);   // Wednesday 30 September 2026, 7am
function run(book, opts){
  const o = opts || {};
  H.setNow(o.now || TODAY);
  H.load(book, o);
  const before = o.lockedBefore ? H.api.lockedDaySnapshot() : null;
  const out = H.recalc();
  return {r: out.r, violations: H.api.validateSeasonPlan({lockedBefore: before})};
}
function daysOf(){
  return H.api.installDays().map(function(d){
    const ds = H.api.isoOf(H.api.dayDate(d));
    const crews = H.api.crewIndexes().map(function(i){ return (H.api.crewHousesFor(i, d) || []).map(function(h){ return h.id; }); });
    return {ds: ds, day: d, ids: (d.houses || []).map(function(h){ return h.id; }), crews: crews};
  });
}
function dayOfCust(id){ const x = daysOf().filter(function(d){ return d.ids.indexOf('cust-' + id) !== -1; })[0]; return x ? x.ds : ''; }
function fingerprint(){ return daysOf().map(function(d){ return d.ds + ':' + d.crews.map(function(c){ return c.join(','); }).join('|'); }).join('\n'); }
function ptOf(book, hid){ const c = book.filter(function(b){ return 'cust-' + b.id === hid; })[0]; return c ? [c.data.lat, c.data.lng] : null; }
function miles(a, b){ return H.api.haversine(a[0], a[1], b[0], b[1]); }
function crewSpread(book, ids){
  let worst = 0;
  ids.forEach(function(a){ ids.forEach(function(b){ const p = ptOf(book, a), q = ptOf(book, b); if(p && q) worst = Math.max(worst, miles(p, q)); }); });
  return worst;
}

if(H){
/* ======================================================================================= */
suite('2.1 / 2.2 The scheduling profile, and hard rules beating soft ones');
{
  const book = makeBook(30, 7);
  book[0].data.installPreference = 'November';
  book[0].data.rushInstall = true;                     // soft: priority
  book[1].data.chargeNewMemberFee = true;
  book[2].data.wantedFrom = '2026-10-12'; book[2].data.wantedTo = '2026-10-16';
  book[3].data.awayDates = [{from: '2026-10-01', to: '2026-10-09'}];
  run(book);
  const h0 = H.api.installDays().reduce(function(a, d){ return a.concat(d.houses || []); }, []).filter(function(h){ return h.id === 'cust-' + book[0].id; })[0];
  const p = H.api.houseSchedulingProfile(h0, book[0].data);
  check('the profile names the customer, place, window and class', p.customerId === book[0].id && p.location && p.earliest === '2026-11-01' &&
    p.priorityClass === 'rush' && p.priority === true && p.confirmed === true, JSON.stringify(p));
  check('a November priority customer is still hung in November — priority never beats the month', dayOfCust(book[0].id) >= '2026-11-01', dayOfCust(book[0].id));
  check('the new hang is ranked New hang', H.api.houseInstallPriority({pref: ''}, book[1].data, {explain: true}).cls === 'new');
  check('a wanted window 12–16 Oct is kept', dayOfCust(book[2].id) >= '2026-10-12' && dayOfCust(book[2].id) <= '2026-10-16', dayOfCust(book[2].id));
  check('an away range 1–9 Oct is kept', dayOfCust(book[3].id) > '2026-10-09', dayOfCust(book[3].id));
}

/* ======================================================================================= */
suite('3.2 Priority classes: one of each, in the documented order');
{
  const P = (pref, cust, extra) => H.api.houseInstallPriority(Object.assign({pref: pref}, extra || {}), cust || {}, {explain: true, today: '2026-10-20'});
  const created = n => ({toMillis: () => new Date(2026, 9, 20 - n).getTime()});
  const rows = [
    ['new-overdue', P('', {chargeNewMemberFee: true, createdAt: created(20)})],
    ['new-waiting', P('', {chargeNewMemberFee: true, createdAt: created(8)})],
    ['new', P('', {chargeNewMemberFee: true})],
    ['rush', P('', {rushInstall: true})],
    ['missed', P('', {}, {missedDays: ['2026-10-05']})],
    ['office-date', P('', {}, {notBefore: '2026-11-10'})],
    ['october', P('October')],
    ['normal', P('')],
    ['november', P('November')],
    ['after-thanksgiving', P('After Thanksgiving')]
  ];
  rows.forEach(function(r){ check('class ' + r[0] + ' is recognised', r[1].cls === r[0], JSON.stringify(r[1])); });
  const order = rows.map(r => r[1].value);
  check('and they sort in exactly that order (new-overdue first, after-Thanksgiving last)',
    order.every(function(v, i){ return i === 0 || order[i - 1] <= v; }), order.join(' '));
  check('a new hang and a priority customer are level (SCH-49)', rows[2][1].value === rows[3][1].value);
}

/* ======================================================================================= */
suite('3.1 Candidate days never include an illegal day');
{
  const book = makeBook(40, 11);
  run(book);
  const kinds = [{pref: 'October'}, {pref: 'November'}, {pref: 'After Thanksgiving'}, {pref: '', wantFrom: '2026-10-20', wantTo: '2026-10-23'},
                 {pref: '', away: '2026-10-05..2026-10-16'}, {pref: '', stuck: '2026-10-14'}, {pref: '', notBefore: '2026-11-02'}];
  kinds.forEach(function(h){
    let bad = 0, legal = 0;
    for(let t = new Date(2026, 9, 1); t < new Date(2026, 11, 20); t.setDate(t.getDate() + 1)){
      const ds = H.api.isoOf(t);
      const m = H.api.houseMayGoOn(h, {}, ds, '2026-10-01');
      if(m.ok){ legal++;
        const w = H.api.houseDateWindow(h, {}, '2026-10-01');
        const dow = t.getDay();
        if(dow === 0 || dow === 6 || ds === '2026-11-26' || (w.from && ds < w.from) || (w.until && ds > w.until)) bad++;
      }
    }
    check('no illegal candidate for ' + JSON.stringify(h), bad === 0 && legal > 0, legal + ' legal, ' + bad + ' bad');
  });
}

/* ======================================================================================= */
suite('3.3 / 3.4 Geographic grouping, and the same book always gives the same season');
{
  /* Cluster A: 20 in Lehi. Cluster B: 20 in Provo. Cluster C: 3 isolated in Levan. */
  const book = [];
  const add = (id, town, c, k) => book.push({id: id, data: Object.assign({name: id, customerNumber: String(2000 + book.length), city: town,
    address: '1 St', lat: c[0] + (k % 5) * 0.004, lng: c[1] + Math.floor(k / 5) * 0.004, installPreference: 'Normal Schedule'}, YES)});
  for(let k = 0; k < 20; k++) add('A' + k, 'Lehi', TOWNS['Lehi'], k);
  for(let k = 0; k < 20; k++) add('B' + k, 'Provo', TOWNS['Provo'], k);
  for(let k = 0; k < 3; k++) add('C' + k, 'Levan', FAR['Levan'], k);
  const res = run(book);
  const byDs = {};
  book.forEach(function(b){ const ds = dayOfCust(b.id); (byDs[ds] = byDs[ds] || []).push(b.id[0]); });
  const sheets = daysOf().reduce(function(a, d){ return a.concat(d.crews.filter(function(c){ return c.length; })); }, []);
  const mixedSheets = sheets.filter(function(ids){ const k = {}; ids.forEach(function(i){ k[i.slice(5, 6)] = 1; }); return Object.keys(k).length > 1; });
  check('every house got a day', book.every(function(b){ return !!dayOfCust(b.id); }));
  check('no crew sheet mixes Lehi and Provo (or Levan)', mixedSheets.length === 0, JSON.stringify(mixedSheets));
  const sheetOf = id => sheets.filter(function(s){ return s.indexOf('cust-' + id) !== -1; })[0] || [];
  check('the 20 Lehi houses ride one sheet', sheetOf('A0').length === 20 && sheetOf('A0').every(function(i){ return i.indexOf('cust-A') === 0; }), sheetOf('A0').length);
  check('the 3 Levan houses are one small run, not spread over the Lehi and Provo days',
    sheetOf('C0').length === 3, JSON.stringify(sheetOf('C0')));
  const fp1 = fingerprint();
  run(book);
  const fp2 = fingerprint();
  run(book.slice().reverse());
  const fp3 = fingerprint();
  check('same input, same season (run twice)', fp1 === fp2);
  check('same book in a different order, same season', fp1 === fp3);
  check('the validator finds nothing wrong', res.violations.length === 0, JSON.stringify(res.violations.slice(0, 3)));
}

/* ======================================================================================= */
suite('3.5 Crew balance');
{
  [40, 39, 38, 25, 17, 1].forEach(function(n){
    const book = [];
    for(let k = 0; k < n; k++){
      const c = TOWNS[k % 2 ? 'American Fork' : 'Lehi'];
      book.push({id: 'b' + n + '_' + k, data: Object.assign({name: 'B' + k, customerNumber: String(3000 + k), city: k % 2 ? 'American Fork' : 'Lehi',
        address: '2 St', lat: c[0] + (k % 7) * 0.003, lng: c[1] + Math.floor(k / 7) * 0.003, installPreference: 'Normal Schedule'}, YES)});
    }
    const res = run(book);
    const first = daysOf()[0];
    const sizes = first ? first.crews.map(function(c){ return c.length; }).filter(Boolean).sort(function(a, b){ return b - a; }) : [];
    const gap = sizes.length > 1 ? sizes[0] - sizes[sizes.length - 1] : 0;
    check(n + ' houses: nobody lost or doubled, no crew over 20, crews within 3 (' + sizes.join('/') + ')',
      res.violations.length === 0 && sizes.every(function(s){ return s <= 20; }) && gap <= 3 &&
      daysOf().reduce(function(a, d){ return a + d.ids.length; }, 0) === n,
      JSON.stringify({sizes: sizes, v: res.violations.slice(0, 2)}));
  });
}

/* ======================================================================================= */
suite('4.1 Weather is a preference, never a hard rule');
{
  const book = makeBook(80, 21);
  const base = run(book);
  const f0 = fingerprint();
  /* No forecast and an unreachable forecast are the same "no opinion". */
  run(book, {forecast: {}});
  check('no forecast lays the season out exactly as with none at all', fingerprint() === f0);
  /* A cold Oct 1–2 in half the towns: nobody is placed illegally, and the season still has everybody. */
  const cold = {};
  Object.keys(TOWNS).slice(0, 9).forEach(function(t){ cold[t] = {'2026-10-01': 20, '2026-10-02': 25}; });
  const rc = run(book, {forecast: cold});
  const coldTownsOnColdDays = daysOf().filter(function(d){ return d.ds <= '2026-10-02'; })
    .reduce(function(a, d){ return a.concat(d.ids); }, []).filter(function(hid){
      const c = book.filter(function(b){ return 'cust-' + b.id === hid; })[0];
      return c && cold[c.data.city];
    }).length;
  check('with warmer towns waiting, no crew is sent to a town at or below 31°F', coldTownsOnColdDays === 0, coldTownsOnColdDays + ' houses');
  check('and weather never costs anybody their day or breaks a hard rule', rc.violations.length === 0 && base.violations.length === 0,
    JSON.stringify(rc.violations.slice(0, 2)));
  /* Everywhere freezing: the "unless" — crews still go out. */
  const all = {}; Object.keys(TOWNS).forEach(function(t){ all[t] = {'2026-10-01': 10}; });
  run(book, {forecast: all});
  check('if everywhere is freezing the veto lifts and the day is still worked', daysOf().some(function(d){ return d.ds === '2026-10-01'; }));
}

/* ======================================================================================= */
suite('5.1 / 5.2 Routing orders a day and never changes a date');
{
  const book = makeBook(60, 31);
  run(book);
  const before = {};
  book.forEach(function(b){ before[b.id] = dayOfCust(b.id); });
  H.api.installDays().forEach(function(d){ H.api.generateDayRoutes(d, {}); });
  check('re-ordering every day moves nobody to another date', book.every(function(b){ return dayOfCust(b.id) === before[b.id]; }));
  /* An obvious line: 6 houses along a street, shuffled; the route should walk the line. */
  const line = [];
  for(let k = 0; k < 6; k++) line.push({id: 'L' + k, data: Object.assign({name: 'L' + k, customerNumber: String(4000 + k), city: 'Lehi', address: k + ' Line St',
    lat: 40.40, lng: -111.90 + k * 0.01, installPreference: 'Normal Schedule'}, YES)});
  run([line[3], line[0], line[5], line[1], line[4], line[2]]);
  const d0 = daysOf()[0];
  const order = d0 ? d0.day.houses.map(function(h){ return +h.id.slice(-1); }) : [];
  const monotone = order.every(function(v, i){ return i === 0 || v > order[i - 1]; }) || order.every(function(v, i){ return i === 0 || v < order[i - 1]; });
  check('six houses on a straight street are driven end to end', monotone, order.join(','));
}

/* ======================================================================================= */
suite('6.1 / 6.2 Incremental changes, and Recalculate as the full recovery');
{
  const book = makeBook(120, 41);
  run(book);
  const fp = fingerprint();
  /* A newly Confirmed customer joins: placed at once, nobody else moves. */
  const newbie = {id: 'newbie', data: Object.assign({name: 'Newbie', customerNumber: '5001', city: 'Orem', address: '9 New St',
    lat: TOWNS['Orem'][0] + 0.002, lng: TOWNS['Orem'][1], installPreference: 'Normal Schedule'}, YES)};
  const before = {}; book.forEach(function(b){ before[b.id] = dayOfCust(b.id); });
  H.load(book.concat([newbie]), {season: H.season()});
  const pj = H.api.placeJoinedHouses();
  check('a newly Confirmed customer is placed without a rebuild', pj.placed.length === 1 && !!dayOfCust('newbie'), JSON.stringify(pj.placed.map(p => p.toDate)));
  check('and nobody else changes day', book.every(function(b){ return dayOfCust(b.id) === before[b.id]; }));
  check('the newcomer lands on a legal day', H.api.validateSeasonPlan({}).length === 0, JSON.stringify(H.api.validateSeasonPlan({}).slice(0, 2)));
  /* A customer switching October -> November is moved by the timing sweep, only them. */
  /* REPOINTED, NOT WEAKENED ([[SCH-106]], 2026-09-30): this used to take the FIRST October customer,
     who sits on 1 October — a printed day — and asserted the sweep moved them. That was the leak: the
     timing sweep was the one mover that emptied a printed day. The claim now picks a customer on an
     unprinted day, and a second check holds the printed one where they are. */
  const octs = book.filter(function(b){ return b.data.installPreference === 'October'; });
  const oct = octs.filter(function(b){ const ds = dayOfCust(b.id); return ds && !H.api.routeDayIsLocked(ds); })[0];
  const octPrinted = octs.filter(function(b){ const ds = dayOfCust(b.id); return ds && H.api.routeDayIsLocked(ds); })[0];
  [oct, octPrinted].forEach(function(c){
    if(!c) return;
    c.data.installPreference = 'November';
    H.api.installDays().forEach(function(d){ (d.houses || []).forEach(function(h){ if(h.id === 'cust-' + c.id) h.pref = 'November'; }); });
  });
  H.sync();
  check('October → November moves them into November', !!oct && dayOfCust(oct.id) >= '2026-11-01', oct && dayOfCust(oct.id));
  check('but somebody on a printed day stays on it until the override is pressed', !!octPrinted && dayOfCust(octPrinted.id) === before[octPrinted.id],
    octPrinted && (before[octPrinted.id] + ' → ' + dayOfCust(octPrinted.id)));
  check('and no other house changes day', book.filter(function(b){ return b !== oct; }).every(function(b){ return dayOfCust(b.id) === before[b.id]; }));
  /* Full recalculation: repeatable, and nobody lost. */
  oct.data.installPreference = 'October'; if(octPrinted) octPrinted.data.installPreference = 'October';
  run(book);
  const f1 = fingerprint(); run(book); const f2 = fingerprint();
  check('Recalculate twice gives the same season', f1 === f2 && f1 === fp);
}

/* ======================================================================================= */
suite('1.2 again, on a real season: a Recalculate a week in never touches the printed days');
{
  const book = makeBook(200, 51);
  run(book);
  /* Monday 5 October 7am: Oct 5, 6, 7 are locked (today + two working days). */
  const locked = {};
  daysOf().forEach(function(d){ if(d.ds >= '2026-10-05' && d.ds <= '2026-10-07') locked[d.ds] = d.crews.map(function(c){ return c.join(','); }).join('|'); });
  const season = H.season();
  H.setNow(new Date(2026, 9, 5, 7, 0));
  H.load(book, {season: season});
  const snap = H.api.lockedDaySnapshot();
  /* change things that would normally move people: a town edit, a priority, a new customer */
  book[5].data.rushInstall = true;
  book[9].data.installPreference = 'November';
  H.recalc();
  const v = H.api.validateSeasonPlan({lockedBefore: snap});
  const after = {};
  daysOf().forEach(function(d){ if(locked[d.ds] !== undefined) after[d.ds] = d.crews.map(function(c){ return c.join(','); }).join('|'); });
  check('the printed days keep exactly their houses, crews and order', Object.keys(locked).length > 0 &&
    Object.keys(locked).every(function(k){ return after[k] === locked[k]; }), Object.keys(locked).join(','));
  check('and the validator agrees nothing printed changed', v.filter(function(x){ return x.rule === 7; }).length === 0);
}

/* ======================================================================================= */
suite('7.1 Every house can say why it is on its day');
{
  const book = makeBook(50, 61);
  book[0].data.rushInstall = true;
  book[1].data.wantedFrom = '2026-10-19';
  run(book);
  let all = 0, ok = 0;
  H.api.installDays().forEach(function(d){ (d.houses || []).forEach(function(h){ all++; if(H.api.placementReasons(h, d).length >= 2) ok++; }); });
  check('every scheduled house has at least two reasons', all > 0 && ok === all, ok + '/' + all);
  const d1 = H.api.installDays().filter(function(d){ return (d.houses || []).some(function(h){ return h.id === 'cust-' + book[1].id; }); })[0];
  const why1 = H.api.placementReasons(d1.houses.filter(function(h){ return h.id === 'cust-' + book[1].id; })[0], d1);
  check('a wanted-from customer\'s reason names their window', why1.some(function(w){ return /from 2026-10-19/.test(w); }), JSON.stringify(why1));
}

/* ======================================================================================= */
suite('8 The validator catches every invariant when it is broken on purpose');
{
  const book = makeBook(60, 71);
  run(book);
  check('a clean season has no violations', H.api.validateSeasonPlan({}).length === 0, JSON.stringify(H.api.validateSeasonPlan({}).slice(0, 3)));
  const days = H.api.installDays();
  const find = rule => H.api.validateSeasonPlan({}).some(function(x){ return x.rule === rule; });
  const pick = function(pref){ for(const d of days) for(const h of (d.houses || [])) if(!pref || h.pref === pref) return {d: d, h: h}; return null; };
  /* 1: the same customer on two days */
  { const a = pick(); const other = days.filter(function(d){ return d !== a.d; })[0]; other.houses.push(Object.assign({}, a.h));
    check('INVARIANT 1 — a customer on two days is caught', find(1)); other.houses.pop(); }
  /* 2: an unconfirmed customer on a day */
  { const a = pick(); const c = H.api.planCustomerFor(a.h); const was = c.data.rsvpStatus; c.data.rsvpStatus = 'no';
    check('INVARIANT 2 — somebody who said no, still on a day, is caught', find(2)); c.data.rsvpStatus = was; }
  /* 4 / 5: before earliest, after latest */
  { const nov = pick('November'); const oct = pick('October');
    const early = days.filter(function(d){ return H.api.isoOf(H.api.dayDate(d)) < '2026-11-01'; })[0];
    early.houses.push(nov.h); check('INVARIANT 4 — a November house in October is caught', find(4)); early.houses.pop();
    const late = days.filter(function(d){ return H.api.isoOf(H.api.dayDate(d)) > '2026-10-31'; })[0];
    if(late && oct){ const i = oct.d.houses.indexOf(oct.h); oct.d.houses.splice(i, 1); late.houses.push(oct.h);
      check('INVARIANT 5 — an October house in November is caught', find(5)); late.houses.pop(); oct.d.houses.splice(i, 0, oct.h); } }
  /* 6: away */
  /* Mid-season: an away range on the season's FIRST day moves their earliest day instead, which the
     validator rightly reports as rule 4. */
  { let d6 = null, h6 = null;
    days.forEach(function(d){ (d.houses || []).forEach(function(h){ if(h6) return; const ds = H.api.isoOf(H.api.dayDate(d));
      const w = H.api.houseDateWindow(h, (H.api.planCustomerFor(h) || {}).data || {}, '2026-10-01'); if(w.from && w.from < ds && !w.pinned){ d6 = d; h6 = h; } }); });
    const ds = H.api.isoOf(H.api.dayDate(d6));
    h6.away = ds + '..' + ds; check('INVARIANT 6 — a house on a day they are away is caught', find(6)); delete h6.away; }
  /* 7: a locked day changed */
  { H.setNow(new Date(2026, 9, 1, 7, 0)); const snap = H.api.lockedDaySnapshot(); const d = days[0];
    const h = d.houses.pop(); const v7 = H.api.validateSeasonPlan({lockedBefore: snap}).some(function(x){ return x.rule === 7; });
    d.houses.push(h); H.setNow(TODAY); check('INVARIANT 7 — a printed day that changed is caught', v7 && Object.keys(snap).length > 0); }
  /* 10: a house with no customer */
  { days[0].houses.push({id: 'ghost', name: 'Ghost', city: 'Lehi'}); check('INVARIANT 10 — a house with no customer record is caught', find(10)); days[0].houses.pop(); }
  /* 11: a weekend date */
  /* The real layout never puts a day on a weekend, so the fault is planted on the computed date itself. */
  { const d = days[0]; const saved = d._date; const sat = new Date(saved); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7));
    d._date = sat; check('INVARIANT 11 — houses on a Saturday are caught', find(11)); d._date = saved; }
  /* 12: a Confirmed customer on no day */
  { const a = pick(); const i = a.d.houses.indexOf(a.h); a.d.houses.splice(i, 1);
    check('INVARIANT 12 — a Confirmed customer on no day is caught', find(12)); a.d.houses.splice(i, 0, a.h); }
  check('and after every planted fault is taken back out, the season is clean again', H.api.validateSeasonPlan({}).length === 0,
    JSON.stringify(H.api.validateSeasonPlan({}).slice(0, 3)));
}
/* 3 and 8 are properties of the crew split, which is TOTAL (SCH-67) — they are asserted over every
   day of every simulated season below, where a violation would show up in validateSeasonPlan. 9 is
   the mirror's own diff, run in suite 1.1. */

/* ======================================================================================= */
suite('9 Simulated seasons: small, medium, full, adversarial');
{
  const seasonChecks = function(label, book, opts){
    const res = run(book, opts);
    const days = daysOf();
    const perCrewOver = days.some(function(d){ return d.crews.some(function(c){ return c.length > 20; }); });
    const twoCrew = days.filter(function(d){ return d.crews.filter(function(c){ return c.length; }).length === 2; });
    const uneven = twoCrew.filter(function(d){ const s = d.crews.map(c => c.length).filter(Boolean); return Math.abs(s[0] - s[1]) > 3; }).length;
    const spreads = [];
    days.forEach(function(d){ d.crews.forEach(function(c){ if(c.length > 1) spreads.push(crewSpread(book, c)); }); });
    spreads.sort(function(a, b){ return a - b; });
    const med = spreads.length ? spreads[Math.floor(spreads.length / 2)] : 0;
    const octLate = book.filter(function(b){ return b.data.installPreference === 'October' && dayOfCust(b.id) > '2026-10-31'; }).length;
    check(label + ': every Confirmed customer has a day and no invariant is broken', res.violations.length === 0 && res.r.confirmedOff === 0,
      JSON.stringify(res.violations.slice(0, 3)));
    check(label + ': no crew over 20 houses', !perCrewOver);
    check(label + ': two-crew days within 3 houses of each other (' + (twoCrew.length - uneven) + '/' + twoCrew.length + ')',
      uneven <= Math.max(1, Math.floor(twoCrew.length * 0.15)), uneven + ' uneven — SCH-97 leaves a few where the spare houses are held off by their dates');
    /* Coherence is judged against the same sheets filled at RANDOM from the season's houses: a scheduler
       that groups by geography must beat that by a wide margin. The absolute figure is printed too. */
    const all = book.map(function(b){ return 'cust-' + b.id; }).filter(function(id){ return !!ptOf(book, id); });
    const rr = rng(4242); const shuffled = all.slice().sort(function(){ return rr() - 0.5; });
    const rnd = []; let at = 0;
    days.forEach(function(d){ d.crews.forEach(function(c){ if(c.length > 1){ rnd.push(crewSpread(book, shuffled.slice(at, at + c.length))); } at += c.length; }); });
    rnd.sort(function(a, b){ return a - b; });
    const rmed = rnd.length ? rnd[Math.floor(rnd.length / 2)] : 0;
    check(label + ': crew sheets are geographically grouped (median widest pair ' + med.toFixed(1) + ' mi vs ' + rmed.toFixed(1) + ' mi at random)',
      rnd.length === 0 || med <= rmed * (book.length >= 500 ? 0.3 : 0.7), med.toFixed(1) + ' vs ' + rmed.toFixed(1));
    /* ⚠ WHY THE BAR MOVES WITH SIZE: a season of 20 or 100 is one to three days, and the owner's rule is a FULL
       day before a tidy one ("we want to prioritize everyday having 40 houses") — so a small season's sheets
       must span towns. A real-sized book has the density to be tight, and there the bar is 30% of random. */
    check(label + ': October customers are done in October (' + octLate + ' late)', octLate === 0);
    const fp1 = fingerprint(); run(book, opts);
    check(label + ': deterministic', fingerprint() === fp1);
    return {res: res, days: days, med: med};
  };
  /* 9.1 small: 20 houses, 2 crews, several towns, one new hang, one missed, one date rule, one away */
  {
    const book = makeBook(20, 91, {towns: ['Lehi', 'American Fork', 'Highland', 'Saratoga Springs', 'Pleasant Grove']});
    book[0].data.chargeNewMemberFee = true; book[0].data.installPreference = 'Normal Schedule';
    book[1].data.wantedFrom = '2026-10-14';
    book[2].data.awayDates = [{from: '2026-10-01', to: '2026-10-13'}];
    const s = seasonChecks('9.1 small (20)', book);
    check('9.1: the away customer is after the 13th and the dated one on/after the 14th',
      dayOfCust(book[2].id) > '2026-10-13' && dayOfCust(book[1].id) >= '2026-10-14');
    check('9.1: the new hang is on the first working day their town is worked', dayOfCust(book[0].id) <= '2026-10-02', dayOfCust(book[0].id));
    void s;
  }
  /* 9.2 medium: 100 houses, clusters, new hangs, isolated houses, weather */
  {
    const book = makeBook(100, 92, {far: true, towns: ['Lehi', 'American Fork', 'Pleasant Grove', 'Lindon', 'Orem', 'Provo', 'Vineyard', 'Saratoga Springs']});
    for(let k = 0; k < 6; k++) book[k].data.chargeNewMemberFee = true;
    const fc = {}; Object.keys(TOWNS).forEach(function(t, k){ fc[t] = {'2026-10-01': 40 + k, '2026-10-02': k % 3 ? 45 : 28}; });
    seasonChecks('9.2 medium (100)', book, {forecast: fc});
    check('9.2: Levan (far) is on a run of its own, not on anybody else\'s sheet', (function(){
      const d = daysOf().filter(function(x){ return x.ids.indexOf('cust-far0') !== -1; })[0];
      const sheet = d && d.crews.filter(function(c){ return c.indexOf('cust-far0') !== -1; })[0];
      return !!sheet && sheet.every(function(i){ return i === 'cust-far0' || i === 'cust-far1'; });
    })());
  }
  /* 9.3 full: ~950 houses, the size of the real book */
  {
    const book = makeBook(950, 93, {far: true});
    for(let k = 0; k < 40; k++) book[k * 7].data.chargeNewMemberFee = true;
    const t0 = Date.now();
    const s = seasonChecks('9.3 full (952)', book);
    /* Reported, not asserted: wall-clock time depends on what else the machine is doing, and a check that
       passes or fails with the load is a flaky check (CLAUDE.md section 9.7). */
    console.log('  NOTE  9.3: two full Recalculates of 952 houses took ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    const last = s.days.length ? s.days[s.days.length - 1].ds : '';
    check('9.3: the season finishes before Thanksgiving (last day ' + last + ')', last < '2026-11-26' ||
      book.some(function(b){ return /After Thanksgiving/.test(b.data.installPreference); }), last);
  }
  /* 9.4 adversarial */
  {
    const book = makeBook(80, 94, {far: true});
    const soon = {toMillis: () => new Date(2026, 9, 7, 16, 0).getTime()};
    const X = function(k, extra){ Object.assign(book[k].data, extra); return book[k]; };
    const held = X(0, {scheduleHoldUntil: soon});
    const pinned = X(1, {stuckOnDate: '2026-10-21'});
    const away = X(2, {awayDates: [{from: '2026-10-01', to: '2026-10-30'}], installPreference: 'October'});
    const nurg = X(3, {installPreference: 'November', rushInstall: true});
    const tiny = {id: 'tiny', data: Object.assign({name: 'Tiny', customerNumber: '7001', city: 'Eagle Mountain', address: '1 Edge',
      lat: 40.30, lng: -112.09, installPreference: 'Normal Schedule'}, YES)};
    const said = X(4, {rsvpStatus: 'no'});
    const res = run(book.concat([tiny]));
    check('9.4: Confirmed + warehouse hold → after the hold', dayOfCust(held.id) > '2026-10-07', dayOfCust(held.id));
    check('9.4: Confirmed + pin → exactly the pinned day', dayOfCust(pinned.id) === '2026-10-21', dayOfCust(pinned.id));
    check('9.4: October + away all month → still on a day, reported rather than dropped', !!dayOfCust(away.id), dayOfCust(away.id));
    check('9.4: November + priority → still November', dayOfCust(nurg.id) >= '2026-11-01', dayOfCust(nurg.id));
    check('9.4: a customer who said no is on no day', !dayOfCust(said.id));
    check('9.4: the isolated tiny customer still has a day', !!dayOfCust('tiny'));
    const hard = res.violations.filter(function(v){ return v.rule !== 5; });
    check('9.4: no hard rule broken (only an impossible "October but away all October" may be reported late)',
      hard.length === 0, JSON.stringify(hard.slice(0, 3)));
    check('9.4: …and that impossible one IS reported, by name', res.violations.some(function(v){ return v.rule === 5; }) || dayOfCust(away.id) <= '2026-10-31');
  }
}

/* ======================================================================================= */
suite('SCH-105 The colour-change list holds a customer off the schedule, and only the schedule');
{
  const book = makeBook(80, 105);
  const cc = book[3];
  cc.data.needsColorChange = true;
  const res = run(book);
  check('on the list: badge reads Colour change, not Confirmed', H.api.seasonBadgeKey(cc.data) === 'colorchange');
  check('on the list: they are on no day after Recalculate', !dayOfCust(cc.id));
  check('on the list: the plan is still clean — not counted as a Confirmed customer left off', res.violations.length === 0 && res.r.confirmedOff === 0,
    JSON.stringify(res.violations.slice(0, 2)));
  check('on the list: still IN for the season, so the warehouse still builds their new set', H.api.isOutForSeason(cc.data) === false);
  const diff = H.api.installStampDiffs({}, [{id: cc.id, data: Object.assign({}, cc.data, {scheduled: true, scheduledDate: '2026-10-05'})}], H.api.isOffTheSchedule);
  check('on the list: an old hang date on their record is cleared by the mirror', diff.length === 1 && diff[0].updates.scheduledDate === null);
  /* Somebody already on a day who goes onto the list comes off it at the next sync. */
  const other = book[7];
  const was = dayOfCust(other.id);
  other.data.needsColorChange = true;
  H.setNow(TODAY);
  const drop = H.api.dropHousesWhoLeftSeason();
  check('a customer already on an unprinted day comes off it when they go onto the list',
    !!was && (!dayOfCust(other.id) || drop.locked.some(function(x){ return x.name === other.data.name; })), was + ' → ' + dayOfCust(other.id));
  /* Off the list for any reason → the next Recalculate places them. */
  cc.data.needsColorChange = false; other.data.needsColorChange = false;
  run(book);
  check('off the list: Recalculate puts them back on a day', !!dayOfCust(cc.id) && !!dayOfCust(other.id));
  check('off the list: badge reads Confirmed again', H.api.seasonBadgeKey(cc.data) === 'confirmed');
  const said = Object.assign({}, cc.data, {rsvpStatus: 'no', needsColorChange: true});
  check('somebody who said No keeps the No badge — the list never promotes anybody', H.api.seasonBadgeKey(said) === 'no');
}

/* ======================================================================================= */
/* ⚠ REPRODUCTIONS OF TWO LIVE FAULTS (2026-09-30, the evening the season was about to start).
   Both suites above built every season from an EMPTY plan, which is why neither fault showed:
   the live plan was saved days earlier, so the colour-change customers were ALREADY on days and
   1 and 2 October were already printed. These start from a saved season, press the button exactly
   as runRecalculateEverything does (H.press), run the five-minute sync exactly as
   scheduleSyncFromCustomers does (H.tick), and press again. */
const EVENING = new Date(2026, 8, 30, 19, 0);   // Wednesday 30 September, 7pm — 1 and 2 October are printed
function lockedPrint(){
  const out = {};
  daysOf().forEach(function(d){ if(d.ds && H.api.routeDayIsLocked(d.ds) && d.ds >= '2026-09-30') out[d.ds] = d.crews.map(function(c){ return c.join(','); }).join('|'); });
  return out;
}
function lockedDiff(b, a){
  const out = [];
  Object.keys(b).forEach(function(ds){
    const cb = b[ds].split("|"), ca = (a[ds] || "").split("|");
    const hb = cb.join(",").split(",").filter(Boolean), ha = ca.join(",").split(",").filter(Boolean);
    const gone = hb.filter(function(x){ return ha.indexOf(x) === -1; }), came = ha.filter(function(x){ return hb.indexOf(x) === -1; });
    const crewMoved = cb.some(function(c, i){ return c.split(",").sort().join() !== (ca[i] || "").split(",").sort().join(); });
    const orderMoved = cb.some(function(c, i){ return c !== (ca[i] || ""); });
    out.push(ds + ": gone " + gone.length + " [" + gone.slice(0,3) + "] came " + came.length + " [" + came.slice(0,3) + "] crew-split changed " + crewMoved + " order changed " + orderMoved);
  });
  return out.join(" ;; ");
}
suite('LIVE-1 The next two days are never touched by Recalculate or by the sync');
function liveLockScenario(label, mutate){
  const book = makeBook(160, 4401);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});        // laid out on Monday, nothing locked yet
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  const before = lockedPrint();
  const onLocked = [];
  H.api.installDays().forEach(function(d){
    const ds = H.api.isoOf(H.api.dayDate(d));
    if(before[ds] !== undefined) (d.houses || []).forEach(function(h){ onLocked.push(h.id.replace(/^cust-/, '')); });
  });
  const byId = {}; book.forEach(function(b){ byId[b.id] = b; });
  mutate(book, onLocked, byId);
  H.load(book, {season: season});
  H.press(); const a1 = lockedPrint();
  check(label + ': Recalculate everything leaves both printed days exactly as they were', Object.keys(before).length >= 2 && JSON.stringify(a1) === JSON.stringify(before), lockedDiff(before, a1));
  H.tick(); const a2 = lockedPrint();
  check(label + ': and so does the five-minute sync', JSON.stringify(a2) === JSON.stringify(before), lockedDiff(before, a2));
  H.press(); const a3 = lockedPrint();
  check(label + ': and so does a second press', JSON.stringify(a3) === JSON.stringify(before), lockedDiff(before, a3));
}
liveLockScenario('nothing changed', function(){});
liveLockScenario('new customers in the printed days\' towns',function(book, onLocked, byId){
  const towns = {}; onLocked.forEach(function(id){ if(byId[id]) towns[byId[id].data.city] = 1; });
  Object.keys(towns).slice(0, 4).forEach(function(t, k){
    book.push({id: 'late' + k, data: Object.assign({name: 'Late ' + k, customerNumber: String(7000 + k), city: t,
      address: (900 + k) + ' New Rd', phone: '80155590' + k, lat: TOWNS[t][0], lng: TOWNS[t][1], installPreference: 'October'}, YES)});
  });
});
liveLockScenario('priority customers', function(book, onLocked){
  book.filter(function(b){ return onLocked.indexOf(b.id) === -1; }).slice(0, 6).forEach(function(b){ b.data.rushInstall = true; });
});
liveLockScenario('a printed customer switches to November', function(book, onLocked, byId){ byId[onLocked[0]].data.installPreference = 'November'; });
liveLockScenario('a printed customer goes onto the colour-change list', function(book, onLocked, byId){ byId[onLocked[2]].data.needsColorChange = true; });
liveLockScenario('a printed customer says no', function(book, onLocked, byId){ byId[onLocked[3]].data.rsvpStatus = 'no'; });
/* The crew split is worked out from towns every time it is drawn, so a corrected town used to re-split a printed sheet. */
liveLockScenario('a printed customer\'s town is corrected', function(book, onLocked, byId){ const b = byId[onLocked[1]]; b.data.city = Object.keys(TOWNS).filter(function(t){ return t !== b.data.city; })[0]; });
liveLockScenario('a new customer arrives in another town (the town map is re-learnt)', function(book){ book.push({id: 'other0', data: Object.assign({name: 'Other 0', customerNumber: '7100', city: 'Provo', address: '1 Other Rd', phone: '8015559100', lat: TOWNS.Provo[0], lng: TOWNS.Provo[1], installPreference: 'Normal Schedule'}, YES)}); });


suite('LIVE-2 Customers already on days who go onto the colour-change list come off every day');
{
  const book = makeBook(160, 4402);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  /* Eight customers spread across the season, the way the live list was. */
  const placed = book.filter(function(b){ return !!dayOfCust(b.id); });
  const step = Math.max(1, Math.floor(placed.length / 8));
  const eight = []; for(let k = 0; k < 8 && k * step < placed.length; k++) eight.push(placed[k * step]);
  eight.forEach(function(b){ b.data.needsColorChange = true; });
  H.setNow(EVENING);
  H.load(book, {season: season});
  H.press(); H.tick(); H.press();
  const where = eight.map(function(b){ return b.data.name + '@' + (dayOfCust(b.id) || '-'); });
  const onUnprinted = eight.filter(function(b){ const ds = dayOfCust(b.id); return ds && !H.api.routeDayIsLocked(ds); });
  check('none of them is on an unprinted day', onUnprinted.length === 0, where.join(', '));
  const onPrinted = eight.filter(function(b){ return !!dayOfCust(b.id); });
  check('the scenario has some of them on the printed days, as the live plan did', onPrinted.length > 0, where.join(', '));
  H.press(true);
  check('Recalculate including the next two days takes every one of them off', eight.every(function(b){ return !dayOfCust(b.id); }),
    eight.map(function(b){ return b.data.name + '@' + (dayOfCust(b.id) || '-'); }).join(', '));
  check('and leaves no Confirmed customer off a day (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0);
}
suite('LIVE-5 Nobody with an unbuilt bundle stays on a printed day, new hang or returning (SCH-113 / SCH-115)');
function liveUnbuilt(useTick){
  const book = makeBook(160, 4405);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  const before = lockedPrint();
  const lockedDs = Object.keys(before).sort();
  const onDay = daysOf().filter(function(d){ return d.ds === lockedDs[1]; })[0];
  const ids = onDay ? onDay.ids.map(function(x){ return x.replace(/^cust-/, ''); }) : [];
  const byId = {}; book.forEach(function(b){ byId[b.id] = b; });
  const rachel = byId[ids[2]], mover = byId[ids[3]];
  /* The hold arrives after they were placed: a new hang whose bundle is still queued,
     and a RETURNING customer whose set is being rebuilt — SCH-115 holds both, because
     either way the crew would arrive to a house with nothing built for it. */
  rachel.data.chargeNewMemberFee = true; rachel.data.needsLightBuild = true;
  mover.data.needsLightBuild = true;
  H.load(book, {season: season});
  if(useTick) H.tick(); else H.press();
  const after = lockedPrint();
  const strip = function(str){ return str.split('|').map(function(c){ return c.split(',').filter(function(x){ return x && x !== 'cust-' + rachel.id && x !== 'cust-' + mover.id; }).join(','); }).join('|'); };
  const label = useTick ? 'the five-minute sync' : 'Recalculate everything';
  check(label + ': the unbuilt new hang is taken off the printed day', !dayOfCust(rachel.id), lockedDs[1] + ' → ' + dayOfCust(rachel.id));
  check(label + ': and so is a returning customer whose rebuild is still queued (SCH-115)', !dayOfCust(mover.id), lockedDs[1] + ' → ' + dayOfCust(mover.id));
  check(label + ': everybody else on that day keeps exactly their crew and order', after[lockedDs[1]] === strip(before[lockedDs[1]]),
    'before ' + strip(before[lockedDs[1]]).slice(0, 120) + ' | after ' + (after[lockedDs[1]] || '').slice(0, 120));
  check(label + ': the other printed day is untouched', after[lockedDs[0]] === before[lockedDs[0]]);
  if(!useTick) check(label + ': and the office is told who came off which day', H.unbuiltOff().some(function(x){ return x.date === lockedDs[1]; }), JSON.stringify(H.unbuiltOff()));
}
liveUnbuilt(false);
liveUnbuilt(true);

suite('LIVE-4 Kept days and new days never share an id (SCH-112)');
{
  const book = makeBook(160, 4404);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  H.press(); H.press();
  const ids = H.season().map(function(d){ return String(d.id); });
  check('after Recalculate keeps the printed days, every day still has its own id', new Set(ids).size === ids.length,
    ids.filter(function(x, i){ return ids.indexOf(x) !== i; }).join(','));
}
suite('LIVE-3 The lock is the next two SCHEDULED days, not a clock (SCH-106)');
{
  const book = makeBook(160, 4403);
  run(book, {now: new Date(2026, 8, 21, 7, 0)});
  const season = H.season();
  H.setNow(new Date(2026, 8, 24, 7, 0));   // a week before the season: nothing is within 48 hours
  H.load(book, {season: season});
  const first = daysOf().map(function(d){ return d.ds; }).filter(Boolean).sort();
  const fp = function(){ const o = {}; daysOf().forEach(function(d){ if(d.ds === first[0] || d.ds === first[1]) o[d.ds] = d.crews.map(function(c){ return c.join(','); }).join('|'); }); return JSON.stringify(o); };
  const before = fp();
  book.slice(0, 10).forEach(function(b){ b.data.rushInstall = true; });
  book[20].data.installPreference = 'November';
  H.load(book, {season: season});
  H.press();
  check('the first two scheduled days are locked even a week out', H.api.routeDayIsLocked(first[0]) && H.api.routeDayIsLocked(first[1]), first.slice(0, 3).join(','));
  check('the third scheduled day is not', !H.api.routeDayIsLocked(first[2]));
  check('and a press leaves the first two exactly as they were', fp() === before);
  H.tick();
  check('and so does the sync', fp() === before);
  H.press(true);
  check('the override press is allowed to re-lay them, and the lock is back on afterwards', H.api.routeDayIsLocked(daysOf().map(function(d){ return d.ds; }).filter(Boolean).sort()[0]));
}

/* ======================================================================================= */
suite('SCH-110 / SCH-115 Nobody with a pending build is scheduled, new hang or returning');
{
  const book = makeBook(120, 110);
  const nh = book[4];
  nh.data.chargeNewMemberFee = true; nh.data.needsLightBuild = true;
  const res = run(book);
  check('an unbuilt new hang is on no day after Recalculate', !dayOfCust(nh.id));
  check('and the plan is clean — they are Being built, not a Confirmed customer left off', res.violations.length === 0 && res.r.confirmedOff === 0 && H.api.seasonBadgeKey(nh.data) === 'building',
    JSON.stringify(res.violations.slice(0, 2)));
  nh.data.needsLightBuild = false;
  run(book);
  check('the bundle built, the next Recalculate places them', !!dayOfCust(nh.id));
  /* already on an unprinted day when the build is queued: they come off it */
  const season = H.season();
  const later = book.filter(function(b){ const ds = dayOfCust(b.id); return ds && ds > '2026-10-09'; })[0];
  later.data.chargeNewMemberFee = true; later.data.needsLightBuild = true;
  H.setNow(TODAY); H.load(book, {season: season}); H.press();
  check('a new hang already on an unprinted day comes off it when their build is queued', !dayOfCust(later.id));
  /* ⭐ [[SCH-115]] 2026-10-07 — SUPERSEDES the old claim here, which said a returning
     customer being rebuilt keeps their day because the crew has hung them before. Addie,
     asked whether a pending build should hold a returning customer too: "anyone that is
     in warehouse should not be scheduled" — yes, same as a new hang, because a mover's
     old set is already recycled and a day with nothing built is the same failure either way. */
  check('and so does a RETURNING customer whose set is being rebuilt (SCH-115)', (function(){
    const r = book[9]; const was = dayOfCust(r.id); r.data.needsLightBuild = true;
    H.load(book, {season: H.season()}); H.press();
    return !!was && !dayOfCust(r.id);
  })());
  check('and they are placed again once the warehouse marks their bundle done', (function(){
    const r = book[9]; r.data.needsLightBuild = false;
    H.load(book, {season: H.season()}); H.press();
    return !!dayOfCust(r.id);
  })());
}

/* ======================================================================================= */
suite('13 Individual customer priority');
{
  /* A realistic season, then priority added to one customer at a time. */
  const book = makeBook(300, 131);
  run(book);
  const season0 = fingerprint();
  const dayIndex = {}; daysOf().forEach(function(d){ d.ids.forEach(function(i){ dayIndex[i] = d.ds; }); });
  const lateAny = book.filter(function(b){ return b.data.installPreference === 'Normal Schedule'; })
    .sort(function(a, b){ return dayIndex['cust-' + b.id] < dayIndex['cust-' + a.id] ? -1 : 1; });   // latest-placed first
  /* 13.2 / 13.4 / 13.7: priority on → earlier, near other work, one house moves */
  {
    const c = lateAny[0];
    const was = dayIndex['cust-' + c.id];
    c.data.rushInstall = true;
    const r = H.api.advancePriorityHouses();
    const now = dayOfCust(c.id);
    const moved = r.moved.filter(function(m){ return m.name === c.data.name; })[0];
    check('13.4: a priority customer is moved EARLIER', now < was, was + ' → ' + now);
    check('13.5: onto a day with work within ' + 3 + ' miles of them', moved && moved.miles <= 3, JSON.stringify(moved && moved.miles));
    check('13.7: nobody else changed day', book.filter(function(b){ return b !== c; }).every(function(b){ return dayOfCust(b.id) === dayIndex['cust-' + b.id]; }));
    check('13.4: and no hard rule broke', H.api.validateSeasonPlan({}).length === 0, JSON.stringify(H.api.validateSeasonPlan({}).slice(0, 2)));
    const p = H.api.houseSchedulingProfile({id: 'cust-' + c.id, pref: 'Normal Schedule'}, c.data);
    check('13.2: the customer record is otherwise untouched (profile reads the same place and window)', p.location && p.earliest && p.priority === true);
    /* 13.2 priority off → nothing moves, ordering returns to normal on the next recalc */
    c.data.rushInstall = false;
    const r2 = H.api.advancePriorityHouses();
    check('13.2: removing priority moves nobody', r2.moved.length === 0 && dayOfCust(c.id) === now);
    run(book);
    check('13.2: …and the next Recalculate lays the season out exactly as before priority', fingerprint() === season0);
  }
  /* 13.5 / 13.6: an isolated priority customer 35 miles from everything is NOT given a trip */
  {
    const iso = {id: 'iso', data: Object.assign({name: 'Isolated', customerNumber: '8001', city: 'Levan', address: '1 Far',
      lat: FAR['Levan'][0], lng: FAR['Levan'][1], installPreference: 'Normal Schedule', rushInstall: true}, YES)};
    run(book.concat([iso]));
    const d = daysOf().filter(function(x){ return x.ids.indexOf('cust-iso') !== -1; })[0];
    const sheet = d && d.crews.filter(function(c){ return c.indexOf('cust-iso') !== -1; })[0];
    const onBusySheet = sheet && sheet.length > 1;
    check('13.5: an isolated priority customer is not pulled onto a crew working 35+ miles away', !onBusySheet, JSON.stringify(sheet));
    check('13.5: …and still has a day (their own run)', !!d);
    const e = H.api.bestEarlierDayFor({id: 'cust-iso', pref: '', city: 'Levan'}, iso.data, d ? d.ds : '');
    check('13.6: no "earlier" day is offered when every earlier day is far away', e === null);
  }
  /* 13.9: priority with each hard restriction */
  {
    const make = function(id, town, extra){ const c = TOWNS[town]; return {id: id, data: Object.assign({name: id, customerNumber: String(8100 + id.length), city: town,
      address: '5 P St', lat: c[0] + 0.001, lng: c[1] + 0.001, installPreference: 'Normal Schedule', rushInstall: true}, YES, extra || {})}; };
    const soon = {toMillis: () => new Date(2026, 9, 12, 16, 0).getTime()};
    const cases = [
      ['pOct', 'Lehi', {installPreference: 'October'}, function(d){ return d <= '2026-10-30'; }],
      ['pNov', 'Lehi', {installPreference: 'November'}, function(d){ return d >= '2026-11-01'; }],
      ['pNamed', 'Orem', {installPreference: '11/9+'}, function(d){ return d >= '2026-11-09'; }],
      ['pWindow', 'Orem', {wantedFrom: '2026-10-19', wantedTo: '2026-10-23'}, function(d){ return d >= '2026-10-19' && d <= '2026-10-23'; }],
      ['pAway', 'Provo', {awayDates: [{from: '2026-10-01', to: '2026-10-16'}]}, function(d){ return d > '2026-10-16'; }],
      ['pHold', 'Provo', {scheduleHoldUntil: soon}, function(d){ return d > '2026-10-12'; }],
      ['pPin', 'Sandy', {stuckOnDate: '2026-10-27'}, function(d){ return d === '2026-10-27'; }],
      ['pAfterThx', 'Sandy', {installPreference: 'After Thanksgiving'}, function(d){ return d >= '2026-11-27'; }]
    ];
    const extra = cases.map(function(c){ return make(c[0], c[1], c[2]); });
    /* one already missed, near a deadline */
    const res = run(book.concat(extra));
    cases.forEach(function(c){ check('13.9: priority + ' + c[0].slice(1) + ' — the hard rule holds (' + dayOfCust(c[0]) + ')', c[3](dayOfCust(c[0]))); });
    check('13.9: multiple priority customers, no invariant broken', res.violations.length === 0, JSON.stringify(res.violations.slice(0, 3)));
    const r = H.api.advancePriorityHouses();
    check('13.9: running priority placement again changes nothing (it settles)', r.moved.length === 0);
  }
  /* 13.9: two priority customers in the same area both advance, onto sensible days */
  {
    run(book);
    const idx = {}; daysOf().forEach(function(d){ d.ids.forEach(function(i){ idx[i] = d.ds; }); });
    const late = book.filter(function(b){ return b.data.installPreference === 'Normal Schedule'; })
      .sort(function(a, b){ return idx['cust-' + b.id] < idx['cust-' + a.id] ? -1 : 1; });
    const sameTown = late.filter(function(b){ return b.data.city === late[0].data.city; }).slice(0, 2);
    sameTown.forEach(function(b){ b.data.rushInstall = true; });
    const r = H.api.advancePriorityHouses();
    check('13.9: two priority customers in one area are each moved at most once, and legally',
      r.moved.length <= 2 && H.api.validateSeasonPlan({}).length === 0, JSON.stringify(r.moved.map(m => m.name + ':' + m.from + '→' + m.to)));
    sameTown.forEach(function(b){ b.data.rushInstall = false; });
  }
  /* 13.10: the final mixed season with priority, and a full Recalculate */
  {
    const mix = makeBook(400, 1310, {far: true});
    for(let k = 0; k < 20; k++) mix[k * 13].data.rushInstall = true;
    for(let k = 0; k < 15; k++) mix[k * 17 + 3].data.chargeNewMemberFee = true;
    const res = run(mix);
    const fp = fingerprint(); run(mix);
    const miles = function(){ let m = 0; daysOf().forEach(function(d){ d.crews.forEach(function(c){ if(c.length > 1) m += crewSpread(mix, c); }); }); return m; };
    check('13.10: mixed season — no hard rule broken, every Confirmed on a day', res.violations.length === 0 && res.r.confirmedOff === 0, JSON.stringify(res.violations.slice(0, 3)));
    check('13.10: deterministic with priority customers', fingerprint() === fp);
    const withP = miles();
    mix.forEach(function(b){ b.data.rushInstall = false; }); run(mix);
    const withoutP = miles();
    check('13.6: priority costs little geography (crew-sheet spread ' + withoutP.toFixed(0) + ' → ' + withP.toFixed(0) + ' mi summed)', withP <= withoutP * 1.10);
  }
}

/* ======================================================================================= */
suite('SCH-114 Nobody is scheduled for today or a day that has already gone');
{
  /* 14.1 / 14.2: a brand-new day from Recalculate is never built ON today, even though
     today is a legal working day the calendar would otherwise let the builder use. */
  const today1 = new Date(2026, 9, 7, 7, 0);               // Wednesday 7 October 2026
  const resA = run(makeBook(60, 1140), {now: today1});
  const firstDay = daysOf().map(function(d){ return d.ds; }).filter(Boolean).sort()[0];
  check('14.1: a brand-new day is never built on today itself', firstDay !== '2026-10-07', 'got ' + firstDay);
  check('14.2: the first day built is the next working day after today', firstDay === '2026-10-08', 'got ' + firstDay);
  check('14.3: and the plan is otherwise clean', resA.violations.length === 0, JSON.stringify(resA.violations.slice(0, 2)));

  /* 14.4 - 14.7: a day that has since gone gives up its UNFINISHED houses on the
     five-minute sync, without waiting for a press of Recalculate everything — and it
     never lands them on one of the next two SCHEDULED days, which the lock still
     protects (SCH-106). Built by hand rather than through a full rebuild, so which day
     is "gone" and which is the one legal target is exact rather than probable. */
  const mkCust = function(id, city){
    const c = TOWNS[city];
    return {id: id, data: Object.assign({name: id, customerNumber: '9' + id, city: city,
      address: '1 Test Ln', phone: '8015559' + id, lat: c[0], lng: c[1],
      installPreference: 'Normal Schedule'}, YES)};
  };
  const mkHouse = function(id, city, done){
    return {id: 'cust-' + id, name: id, address: '1 Test Ln', city: city, zip: '', phone: '',
      email: '', pref: 'Normal Schedule', cu: '', price: '', details: '', done: !!done};
  };
  /* Two decoys dated just after "now" soak up the next-two-scheduled-days lock, so the
     target day — the one legal place for the unfinished house to land — is the third
     nearest day and genuinely open, not one the lock is protecting from every mover. */
  const freshFutureDays = function(){
    return [
      {id: 'decoy1', base: 20, cascade: 0, pin: null, houses: [mkHouse('d1', 'Lehi', false)]},
      {id: 'decoy2', base: 21, cascade: 0, pin: null, houses: [mkHouse('d2', 'Lehi', false)]},
      {id: 'target', base: 40, cascade: 0, pin: null, houses: [mkHouse('tg', 'Lehi', false)]}
    ];
  };
  const d1c = mkCust('d1', 'Lehi'), d2c = mkCust('d2', 'Lehi'), tgc = mkCust('tg', 'Lehi');
  const g1c = mkCust('g1', 'Lehi'), g2c = mkCust('g2', 'Lehi');
  const goneDay = {id: 'gone', base: 0, cascade: 0, pin: null,
    houses: [mkHouse('g1', 'Lehi', true), mkHouse('g2', 'Lehi', false)]};
  H.setNow(new Date(2026, 9, 20, 7, 0));                   // well after 1 October
  H.load([g1c, g2c, d1c, d2c, tgc], {season: [goneDay].concat(freshFutureDays())});
  H.api.computeDates();
  const out = H.tick();
  check('14.4: the unfinished house is taken off the day that has already gone',
    dayOfCust('g2') !== '2026-10-01', 'now on ' + dayOfCust('g2'));
  check('14.5: and placed on a real open day, never one of the locked next two',
    dayOfCust('g2') === '2026-11-10', 'got ' + dayOfCust('g2'));
  check('14.6: the sync reports it by name, the same way a timing move is',
    out.goneDays.moved.some(function(m){ return m.name === 'g2'; }), JSON.stringify(out.goneDays.moved));
  check('14.7: a house already done stays on the day — it is the record of what happened, not paper the crew is still holding',
    dayOfCust('g1') === '2026-10-01');

  /* 14.8: a day that went by with NOTHING finished on it is dropped entirely, the same
     rule Recalculate already follows — it is not left behind as an empty box. */
  const g3c = mkCust('g3', 'Lehi');
  const goneDay2 = {id: 'gone2', base: 0, cascade: 0, pin: null, houses: [mkHouse('g3', 'Lehi', false)]};
  H.setNow(new Date(2026, 9, 20, 7, 0));
  H.load([g3c, d1c, d2c, tgc], {season: [goneDay2].concat(freshFutureDays())});
  H.api.computeDates();
  H.tick();
  check('14.8: a gone day left with nothing finished on it is dropped, not kept empty',
    daysOf().every(function(d){ return d.ds !== '2026-10-01'; }), JSON.stringify(daysOf().map(function(d){ return d.ds; })));
}
}

/* ======================================================================================= */
module.exports = {extractFn, lift, admin, check, suite, sandbox, liftDeep};
if(require.main === module){
  process.on('exit', function(){
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if(failed){ console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
  });
}
