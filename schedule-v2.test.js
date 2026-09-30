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
    const i = noComments.indexOf('const routes=generateAllRoutes();');
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
module.exports = {extractFn, lift, admin, check, suite, sandbox, liftDeep};
if(require.main === module){
  process.on('exit', function(){
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if(failed){ console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
  });
}
