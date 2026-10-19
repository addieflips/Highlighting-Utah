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
    /async function saveNow\(\)\{[\s\S]*?const data=planDropUndefined\(serialize\(\)\)[\s\S]*?try\{await setDoc\(PLAN_REF\(\),data\);[^}]*mirrorStampsSoon\(\)/.test(noComments));
  /* The plan is shared: every open Schedule follows it live, so a Recalculate on one computer
     reaches the others instead of being saved over by their stale copy. */
  check('a loaded plan follows Firestore live', /hydrate\(s\.data\(\)\);planSyncedKey=planKey\(s\.data\(\)\);[^\n]*followPlanLive\(\)/.test(noComments) &&
    /function followPlanLive\(\)\{[\s\S]*?onSnapshot\(PLAN_REF\(\)/.test(noComments));
  /* 2026-10-12: "unsaved" has to mean a save is queued. The five-minute sync freezes days in memory and used to
     return without saving, so an idle computer differed for ever and refused every plan the other one sent. */
  check('another computer\'s plan is only held off by a save that is really queued',
    /if\(\(mine!==planSyncedKey && savePending\) \|\| recalcRunning\)/.test(noComments) &&
    /function scheduleSave\(\)\{(?:if\(PLAN_PAGE_OUTDATED\)return;)?clearTimeout\(saveTimer\);savePending=true;/.test(noComments) &&
    /async function saveNow\(\)\{\s*savePending=false;/.test(noComments));
  check('a sync tick that only froze the printed days still saves them', (function(){
    const i = noComments.indexOf('window.scheduleSyncFromCustomers=function');
    const j = noComments.indexOf('syncHousesFromCustomers()', i);
    return i > 0 && j > i && noComments.slice(i, j).indexOf('if(freezePrintedDays()) scheduleSave();') !== -1;
  })());
  check('a failed save says so, with the reason, and is logged',
    /catch\(e\)\{planSyncedKey=prev;[\s\S]{0,400}planSaveProblem\(data\)[\s\S]{0,400}console\.error\([\s\S]{0,300}NOT SAVED/.test(noComments));
  check('a save with nothing new is not written',/if\(k===planSyncedKey\)\{[^\n]*return; \}/.test(noComments));
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
  /* ⚠ THE CLOCK IS PINNED TO AN HOUR AFTER THE BUILD WAS QUEUED (fixed 2026-10-07).
     `scheduleHoldEndsMillis` answers `ms > Date.now() ? ms : 0` — an expired hold holds
     nobody, which is right. So this fixture read the REAL clock, and on the afternoon of
     Wednesday 7 October 2026 (UTC) its own hold ran out: the app correctly said "no hold",
     and the check failed on main with no code change at all, blocking every merge. A check
     about the rule must not depend on what day the suite happens to run. Restored in a
     finally so nothing after it inherits the frozen clock. */
  const realNow = Date.now;
  let e, eNov;
  try {
    Date.now = () => q + 3600000;
    e = D.earliest({pref: ''}, held, S);
    eNov = D.earliest({pref: 'November'}, held, S);
  } finally { Date.now = realNow; }
  check('warehouse hold: a Friday-afternoon build is not scheduled before the following Thursday', e >= '2026-10-08', 'earliest = ' + e);
  check('warehouse hold: the later of hold and month wins (November stays November)', eNov === '2026-11-01');
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
      /* [[SCH-128]], 2026-10-12: REPOINTED, NOT WEAKENED FOR THE REAL BOOK. The full season keeps its 0.3 bar (measured
         4.0 -> 5.0 mi, against 34 at random). A season of 100 moved 8.4 -> 12.6 mi and its bar goes 0.7 -> 0.85: no crew
         may go out under ten now, so a short run is joined to the nearest one instead of standing alone, and a day
         under twenty is one crew holding all of it. A season of 20 is one or two such days — there is no grouping left
         to judge, so it is printed and not scored. */
      rnd.length === 0 || book.length < 50 || med <= rmed * (book.length >= 500 ? 0.3 : 0.85), med.toFixed(1) + ' vs ' + rmed.toFixed(1));
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
    /* [[SCH-131]] (2026-10-13): the working days after Thanksgiving are where a house with no crew within five miles
       waits — so the season may run past it, but only for those houses (or somebody who asked for After Thanksgiving). */
    const lateOk = s.days.filter(function(d){ return d.ds >= '2026-11-26'; }).every(function(d){
      return (d.day.houses || []).every(function(h){ return h.fiveMileTail || /After Thanksgiving/.test(h.pref || ''); }); });
    check('9.3: the season finishes before Thanksgiving, but for houses with no crew near them (last day ' + last + ')', last < '2026-11-26' || lateOk ||
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
/* ⛔ SUPERSEDED 2026-10-07 → [[SCH-117]]: "a printed customer goes onto the colour-change list" used to be a scenario
   HERE, asserting the printed day did not change. Dax: "no one in warehouse list can be on schedule" — they come off
   even a printed day now, so it moved to LIVE-6, which asserts that and that everybody else's crew and order hold. */
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
  /* ⛔ SUPERSEDED 2026-10-07 → [[SCH-117]]. This asserted some of them were STILL on the printed days ("as the live
     plan did"), which was the old lock winning over the colour-change list. Now nobody on a Warehouse list stays on
     any day, printed or not — and the live plan doing otherwise (Brooks Bostick on Oct 5) is what was reported. */
  const onAnyDay = eight.filter(function(b){ return !!dayOfCust(b.id); });
  check('none of them is on any day, printed ones included (SCH-117)', onAnyDay.length === 0, where.join(', '));
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

suite('LIVE-6 Anybody on ANY Warehouse list comes off a printed day — timer jobs and colour changes too (SCH-117)');
/* The live cases, 6 October 2026: Kate Johnson #455 and Ogden Mills #566 were TIMER ONLY rows on the Build tab and on
   the Oct 5 / Oct 6 sheets; Brooks Bostick #319 was on the Color Change list and the Oct 5 sheet. */
function liveWarehouse(label, set, useTick){
  const book = makeBook(160, 4406);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  const before = lockedPrint();
  const lockedDs = Object.keys(before).sort();
  const onDay = daysOf().filter(function(d){ return d.ds === lockedDs[0]; })[0];
  const ids = onDay ? onDay.ids.map(function(x){ return x.replace(/^cust-/, ''); }) : [];
  const byId = {}; book.forEach(function(b){ byId[b.id] = b; });
  const who = byId[ids[1]];
  set(who.data);
  H.load(book, {season: season});
  if(useTick) H.tick(); else H.press();
  const after = lockedPrint();
  const strip = function(str){ return str.split('|').map(function(c){ return c.split(',').filter(function(x){ return x && x !== 'cust-' + who.id; }).join(','); }).join('|'); };
  const how = (useTick ? 'the five-minute sync' : 'Recalculate everything') + ', ' + label;
  check(how + ': they are taken off the printed day', !dayOfCust(who.id), lockedDs[0] + ' → ' + dayOfCust(who.id));
  check(how + ': and are on no other day either', !dayOfCust(who.id));
  check(how + ': everybody else on that day keeps exactly their crew and order', after[lockedDs[0]] === strip(before[lockedDs[0]]),
    'before ' + strip(before[lockedDs[0]]).slice(0, 120) + ' | after ' + (after[lockedDs[0]] || '').slice(0, 120));
  check(how + ': the other printed day is untouched', after[lockedDs[1]] === before[lockedDs[1]]);
  check(how + ': and no Confirmed customer is left off a day (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0);
  /* ⭐ "as soon as they are outside warehouse they are auto added" — the warehouse marks the job done, and the next
     five-minute sync puts them back on a day with no Recalculate. */
  delete who.data.needsTimerOnly; delete who.data.needsTimerRemoved; delete who.data.needsColorChange; delete who.data.needsLightBuild;
  H.load(book, {season: H.season()});
  H.tick();
  check(how + ': once the warehouse marks it done, the next sync puts them back on a day by itself', !!dayOfCust(who.id), 'still on no day');
  check(how + ': and not onto either printed day', lockedDs.indexOf(dayOfCust(who.id)) === -1, 'landed on ' + dayOfCust(who.id));
}
[false, true].forEach(function(useTick){
  liveWarehouse('a TIMER ONLY row (Kate Johnson)', function(d){ d.needsTimerOnly = true; }, useTick);
  liveWarehouse('a Remove Timer row (WH-34)', function(d){ d.needsTimerRemoved = true; }, useTick);
  liveWarehouse('the Color Change list (Brooks Bostick)', function(d){ d.needsColorChange = true; }, useTick);
});
{
  const yes = function(extra){ return Object.assign({}, YES, extra || {}); };
  check('a timer-only house does not read Confirmed (it reads Being built)', H.api.seasonBadgeKey(yes({needsTimerOnly: true})) === 'building');
  check('nor does a house having a timer taken out', H.api.seasonBadgeKey(yes({needsTimerRemoved: true})) === 'building');
  check('every Warehouse list holds a house off the schedule',
    ['needsLightBuild', 'needsTimerOnly', 'needsTimerRemoved', 'needsColorChange'].every(function(f){ const o = {}; o[f] = true; return H.api.isOffTheSchedule(yes(o)); }));
  check('and an ordinary yes is still Confirmed and still scheduled', H.api.seasonBadgeKey(yes()) === 'confirmed' && !H.api.isOffTheSchedule(yes()));
}

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
    /* [[SCH-128]], 2026-10-12: the latest-placed customer used to sit on a thin day at the end and always had an
       emptier day to move to. Those thin days are gone, so the latest one may be on a day with nothing earlier that has
       room. The claim is unchanged — a priority customer who CAN be moved earlier is, near other work, and alone — so
       it is asked of the latest-placed customer for whom there is somewhere to go. */
    let c = null, r = null;
    for(let k = 0; k < lateAny.length && k < 60 && !c; k++){
      const cand = lateAny[k];
      cand.data.rushInstall = true;
      const rr = H.api.advancePriorityHouses();
      if(rr.moved.some(function(m){ return m.name === cand.data.name; })){ c = cand; r = rr; }
      else cand.data.rushInstall = false;
    }
    check('13.4: there is a late-placed customer with somewhere earlier to go', !!c);
    if(!c){ c = lateAny[0]; r = {moved: []}; }
    const was = dayIndex['cust-' + c.id];
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

suite('SCH-116 The day the crew is hanging stands in for today when they are behind');
{
  /* The live case: Wednesday 7 October 2026, crews hanging the Oct 5 sheet. Season days by base (days after 1 Oct):
     4 = Mon Oct 5, 5 = Tue Oct 6, 6 = Wed Oct 7, 7 = Thu Oct 8, 11 = Mon Oct 12. */
  const mkC = function(id){ const c = TOWNS.Lehi;
    return {id: id, data: Object.assign({name: id, customerNumber: '8' + id, city: 'Lehi', address: '1 Hang Ln', phone: '80155588' + id,
      lat: c[0], lng: c[1], installPreference: 'Normal Schedule'}, YES)}; };
  const mkH = function(id, done){ return {id: 'cust-' + id, name: id, address: '1 Hang Ln', city: 'Lehi', zip: '', phone: '',
    email: '', pref: 'Normal Schedule', cu: '', price: '', details: '', done: !!done}; };
  const ids = ['a1', 'a2', 'b1', 'c1', 'e1', 'f1', 'z1'];
  const book = function(){ return ids.map(mkC); };
  const season = function(){ return [
    {id: 'd5', base: 4, cascade: 0, pin: null, houses: [mkH('a1', false), mkH('a2', true)]},
    {id: 'd6', base: 5, cascade: 0, pin: null, houses: [mkH('b1', false)]},
    {id: 'd7', base: 6, cascade: 0, pin: null, houses: [mkH('c1', false)]},
    {id: 'd8', base: 7, cascade: 0, pin: null, houses: [mkH('e1', false)]},
    {id: 'd12', base: 11, cascade: 0, pin: null, houses: [mkH('f1', false)]},
    /* an open day well clear of any lock, so the control below has somewhere to sweep a gone day's houses to */
    {id: 'd21', base: 20, cascade: 0, pin: null, houses: [mkH('z1', false)]}]; };
  const WED7 = new Date(2026, 9, 7, 7, 0);
  const setup = function(hang){
    H.setNow(WED7); H.load(book(), {season: season()}); H.api.computeDates();
    if(hang) H.api.setHangDay(hang);
    H.api.refreshLockedDates();
  };

  /* Control first: with NO hang day this is the bug she reported — Oct 5 and Oct 6 count as gone. */
  setup(null);
  H.tick();
  check('16.0 control: without the hang day the Oct 5 sheet the crew is holding is emptied forward (the reported fault)',
    dayOfCust('a1') !== '2026-10-05', 'a1 on ' + dayOfCust('a1'));

  const HANG = {date: '2026-10-05', setOn: '2026-10-07'};
  setup(HANG);
  check('16.1 the schedule\'s today is the day the crew is hanging', H.api.scheduleTodayStr() === '2026-10-05', H.api.scheduleTodayStr());
  check('16.2 the hang day and the next two days with work are locked — Oct 5, 6 and 7',
    ['2026-10-05', '2026-10-06', '2026-10-07'].every(function(ds){ return H.api.routeDayIsLocked(ds); }));
  check('16.3 and the day after them is not', !H.api.routeDayIsLocked('2026-10-08') && !H.api.routeDayIsLocked('2026-10-12'));
  H.tick();
  check('16.4 the five-minute sync leaves the Oct 5 sheet alone — it is not a day that has gone',
    dayOfCust('a1') === '2026-10-05' && dayOfCust('a2') === '2026-10-05', 'a1 on ' + dayOfCust('a1'));
  check('16.5 nor the Oct 6 sheet', dayOfCust('b1') === '2026-10-06', 'b1 on ' + dayOfCust('b1'));

  setup(HANG);
  /* [[SCH-130]] a locked day keeps every house still to HANG exactly as it was; a house already done (a2) goes to the
     front of the season with the other finished houses. */
  const lockedIds = function(){ return daysOf().filter(function(d){ return ['2026-10-05', '2026-10-06', '2026-10-07'].indexOf(d.ds) !== -1; })
    .map(function(d){ return d.ds + ':' + d.day.houses.filter(function(h){ return !h.done; }).map(function(h){ return h.id.replace(/^cust-/, ''); }).sort().join(','); }).join(' | '); };
  const lb = lockedIds();
  H.press();
  check('16.6 Recalculate everything leaves every unfinished house on the three locked days exactly where it was', lockedIds() === lb, lb + '  →  ' + lockedIds());
  check('16.7 and nothing still to hang is ever put on a day that is really already here or gone',
    daysOf().every(function(d){ return d.ds >= '2026-10-08' || ['d5', 'd6', 'd7'].indexOf(d.day.id) !== -1 ||
      d.day.houses.every(function(h){ return h.done; }); }),
    JSON.stringify(daysOf().map(function(d){ return d.day.id + '@' + d.ds; })));
  check('16.7a [[SCH-130]] the house already done on the locked Oct 5 sheet goes to the front of the season',
    dayOfCust('a2') < '2026-10-05', 'a2 on ' + dayOfCust('a2'));

  /* It walks forward one working day per working day, so two days behind stays two days behind. */
  H.setNow(new Date(2026, 9, 8, 7, 0)); H.api.setHangDay(HANG);
  check('16.8 a day later the crew is on the Oct 6 sheet', H.api.scheduleTodayStr() === '2026-10-06', H.api.scheduleTodayStr());
  H.setNow(new Date(2026, 9, 12, 7, 0)); H.api.setHangDay({date: '2026-10-07', setOn: '2026-10-09'});
  check('16.9 and over a weekend it moves by working days, not calendar days (picked Fri on the Wed sheet → Mon is Thu)',
    H.api.scheduleTodayStr() === '2026-10-08', H.api.scheduleTodayStr());
  H.setNow(WED7); H.api.setHangDay({date: '2026-10-09', setOn: '2026-10-07'});
  check('16.10 a hang day on or after today is ignored — the crew cannot be ahead of the calendar',
    H.api.scheduleTodayStr() === '2026-10-07', H.api.scheduleTodayStr());
  H.api.setHangDay(null);
  check('16.11 and with none set, today is today', H.api.scheduleTodayStr() === '2026-10-07');
  check('16.12 a caller that pins the clock gets the clock, hang day or not',
    (function(){ H.api.setHangDay(HANG); const r = H.api.scheduleTodayStr({date: '2026-10-07', hour: 7, minute: 0}); H.api.setHangDay(null); return r === '2026-10-07'; })());
}

suite('SCH-120 A day that has been printed can no longer be rescheduled');
{
  /* Dax: "after a day is printed that day is no longer rescheduleable". A sheet printed a week ahead used to be
     reshuffled by the next Recalculate, because "printed" only ever meant "one of the next two days". */
  const book = makeBook(160, 4420);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  H.api.refreshLockedDates();
  const all = daysOf().filter(function(d){ return d.ds; }).sort(function(a, b){ return a.ds < b.ds ? -1 : 1; });
  /* the last open day: [[SCH-129]] packs a 160-house book into fewer, fuller days, so it is no longer the fourth */
  const open20 = all.filter(function(d){ return !H.api.routeDayIsLocked(d.ds); });
  const far = open20.length >= 2 ? open20[open20.length - 1] : null;
  check('20.0 the scenario has a day well past the next two, not yet locked', !!far, JSON.stringify(all.map(function(d){ return d.ds; })));
  const ids = function(){ const d = daysOf().filter(function(x){ return x.day.id === far.day.id; })[0]; return d ? d.ds + ':' + d.ids.slice().sort().join(',') : 'GONE'; };
  H.api.markDayPrinted(far.day);
  const before = ids();
  check('20.1 printing it stamps the day', !!far.day.printedAt, String(far.day.printedAt));
  check('20.2 and locks it at once, though it is not one of the next two', H.api.routeDayIsLocked(far.ds));
  check('20.3 it counts as printed and still ahead of the crew', H.api.dayIsPrintedAhead(far.day));
  H.press();
  check('20.4 Recalculate everything leaves it exactly as it was', ids() === before, before + '  →  ' + ids());
  H.tick();
  check('20.5 and so does the five-minute sync', ids() === before, before + '  →  ' + ids());
  H.press(true);
  check('20.6 and so does Recalculate INCLUDING the next two days — a printed day is never reset', ids() === before, before + '  →  ' + ids());
  check('20.7 and it is still locked afterwards', H.api.routeDayIsLocked(far.ds));
  check('20.8 no Confirmed customer was left off a day getting there (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0);
  H.setNow(new Date(far.day._date.getFullYear(), far.day._date.getMonth(), far.day._date.getDate(), 8, 0));
  check('20.9 once the crew is on that day it is no longer "ahead" — missed houses can be moved on', !H.api.dayIsPrintedAhead(far.day));
  check('20.10 a day never printed is never "printed ahead"', !H.api.dayIsPrintedAhead(all[all.length - 1].day) || !!all[all.length - 1].day.printedAt);
}

suite('SCH-135 A crew checked for tomorrow cannot be rescheduled until 5 PM that day');
{
  /* Dax: "check a list and say schedule this one for tomorrow ... if theyre checked they cant be rescheduled until 5 PM
     the next day where they auto get unchecked". Lock only — the press moves nothing. RUN through the real press. */
  const book = makeBook(160, 4420);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  H.api.refreshLockedDates();
  const tom = H.api.tomorrowsInstallDay();
  const tds = tom ? H.api.isoOf(H.api.dayDate(tom)) : '';
  const T = function(){ return H.season().filter(function(d){ return d.id === tom.id; })[0]; };
  const crewIds = function(i){ return (H.api.crewHousesFor(i, T()) || []).map(function(h){ return String(h.id); }).sort().join(','); };
  check('35.0 the scenario has a tomorrow with two crews working it', !!tom && tds === '2026-10-01' && !!crewIds(0) && !!crewIds(1), tds + ' ' + (tom ? crewIds(0) + ' / ' + crewIds(1) : ''));
  const later = daysOf().filter(function(d){ return d.ds > tds; }).sort(function(a, b){ return a.ds < b.ds ? -1 : 1; });
  const other = later[later.length - 1].day;
  const O = function(){ return H.season().filter(function(d){ return d.id === other.id; })[0]; };
  check('35.1 a day that is not tomorrow cannot be checked', H.api.setCrewHeld(other.id, 0, true) === false && !H.api.dayHasHeldCrew(other));
  check('35.2 tomorrow’s crew can be, and it reads as held', H.api.setCrewHeld(tom.id, 0, true) === true && H.api.crewIsHeld(tom, 0) && !H.api.crewIsHeld(tom, 1));
  const held0 = crewIds(0);
  H.press(true);
  check('35.3 Recalculate INCLUDING the next two days leaves the checked list exactly as it was', crewIds(0) === held0, held0 + '  →  ' + crewIds(0));
  check('35.4 and the day is still locked', H.api.routeDayIsLocked(tds));
  const h0 = H.api.crewHousesFor(0, T())[0];
  H.api.moveHouse(h0.id, O().id);
  check('35.5 a house on the checked list cannot be moved off by hand', crewIds(0) === held0 && O().houses.indexOf(h0) === -1);
  const stranger = O().houses[0];
  H.api.moveHouse(stranger.id, tom.id);
  check('35.6 and nothing can be moved onto that day (it would re-split the checked crew)', T().houses.indexOf(stranger) === -1 && crewIds(0) === held0);
  const h1 = H.api.crewHousesFor(1, T())[0];
  H.api.moveHouse(h1.id, O().id);
  const movedOff = O().houses.indexOf(h1) !== -1, stillOn = T().houses.indexOf(h1) !== -1;
  /* it comes off only when the checked list stays exactly as it was — dropping the day below a full one re-deals every sheet */
  check('35.7 moving the OTHER crew’s house never changes the checked list (it moves, or it stays and is refused)', crewIds(0) === held0 && movedOff !== stillOn, held0 + '  →  ' + crewIds(0) + ' moved=' + movedOff);
  check('35.8 the leftover flow gives a checked house nowhere to go', H.api.planLeftoverMoves(T()).filter(function(p){ return H.api.houseOnHeldCrew(T(), p.house); }).every(function(p){ return p.target === null && p.held; }));
  const saved = JSON.parse(JSON.stringify(H.api.serialize()));
  H.api.hydrate(saved);
  const tom2 = H.season().filter(function(d){ return d.id === tom.id; })[0];
  check('35.9 the check survives a save and a reload', !!tom2 && H.api.crewIsHeld(tom2, 0) && !H.api.crewIsHeld(tom2, 1), JSON.stringify(tom2 && tom2.crewHeld));
  H.setNow(new Date(2026, 9, 1, 16, 59));
  check('35.10 at 4:59 PM on the day it is still held', H.api.crewIsHeld(tom2, 0));
  H.setNow(new Date(2026, 9, 1, 17, 0));
  check('35.11 at 5 PM it unchecks itself', !H.api.crewIsHeld(tom2, 0));
  H.api.refreshLockedDates();
  check('35.12 and the next sync deletes the hold from the plan', !tom2.crewHeld, JSON.stringify(tom2.crewHeld));
  H.setNow(EVENING);
  H.api.setCrewHeld(tom2.id, 1, true);
  check('35.13 Uncheck takes it off at once', H.api.crewIsHeld(tom2, 1) && H.api.setCrewHeld(tom2.id, 1, false) && !H.api.crewIsHeld(tom2, 1) && !tom2.crewHeld);
}

suite('SCH-136 Customers marked for tomorrow: Recalculate puts every one of them on it, and nobody else');
{
  /* Dax: "make it so i can mark individual customers for it as well then it just puts everyone marked for tommorrow on
     the same day when i recalculate and no one more". RUN through the real press. */
  const book = makeBook(160, 4420);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  H.api.refreshLockedDates();
  const tom = H.api.tomorrowsInstallDay();
  const tds = H.api.isoOf(H.api.dayDate(tom));
  const open = daysOf().filter(function(d){ return d.ds > tds && !H.api.routeDayIsLocked(d.ds); });
  const picks = [tom.houses[0]].concat(open.slice(0, 3).map(function(d){ return d.day.houses[0]; }));
  const want = picks.map(function(h){ return String(h.id); }).sort().join(',');
  const before = tom.houses.length;
  check('36.0 the scenario has a full tomorrow and three open days to mark from', before > 4 && open.length >= 3, before + ' / ' + open.length);
  check('36.1 each customer can be marked for tomorrow', picks.every(function(h){ return H.api.toggleTomorrowMark(h.id) === true && H.api.tomorrowMarkActive(h); }));
  H.press();
  const onTom = function(){ const d = H.season().filter(function(x){ return x.id === tom.id; })[0];
    return d.houses.filter(function(h){ return !h.done; }).map(function(h){ return String(h.id); }).sort().join(','); };
  check('36.2 after Recalculate tomorrow holds exactly the marked customers', onTom() === want, want + '  vs  ' + onTom());
  check('36.3 and everybody moved off it is still on a day — nobody lost (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0, String(H.api.confirmedNotOnAnyDay().length));
  H.press();
  check('36.4 a second press keeps tomorrow exactly the same', onTom() === want, onTom());
  const dropped = picks[1];
  check('36.5 a mark can be taken off', H.api.toggleTomorrowMark(dropped.id) === false && !H.api.tomorrowMarkActive(dropped));
  H.setNow(new Date(2026, 9, 1, 17, 0));
  check('36.6 the marks end at 5 PM on the day', picks.every(function(h){ return !H.api.tomorrowMarkActive(h); }));
}

suite('SCH-136b Customers marked for tomorrow from TODAY’s list — the crew did not get to them');
{
  /* The live case, 2026-10-16: three customers on the list being hung TODAY were marked for tomorrow during the day (the
     crew would not reach them), Recalculate was pressed, and Monday did not change. RUN through the real press, at 1 PM. */
  const book = makeBook(160, 4420);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(new Date(2026, 9, 1, 13, 0));
  H.load(book, {season: season});
  H.api.refreshLockedDates();
  const todayDay = H.api.installDays().filter(function(d){ return H.api.isoOf(H.api.dayDate(d)) === '2026-10-01'; })[0];
  const tom = H.api.tomorrowsInstallDay();
  const tds = tom ? H.api.isoOf(H.api.dayDate(tom)) : '';
  check('36b.0 the scenario: today is Oct 1 with houses not done, tomorrow is Oct 2', !!todayDay && todayDay.houses.length > 5 && tds === '2026-10-02',
    (todayDay ? todayDay.houses.length : 0) + ' ' + tds);
  const picks = todayDay.houses.filter(function(h){ return !h.done; }).slice(0, 3);
  const want = picks.map(function(h){ return String(h.id); }).sort().join(',');
  check('36b.1 each of today’s customers can be marked for tomorrow', picks.length === 3 && picks.every(function(h){ return H.api.toggleTomorrowMark(h.id) === true; }));
  const r = H.press();
  const onTom = function(){ const d = H.season().filter(function(x){ return x.id === tom.id; })[0];
    return d.houses.filter(function(h){ return !h.done; }).map(function(h){ return String(h.id); }).sort().join(','); };
  check('36b.2 after Recalculate tomorrow holds exactly the three marked from today', onTom() === want, want + '  vs  ' + onTom() + '  ' + JSON.stringify(r && r.tomorrow || ''));
  const td2 = H.season().filter(function(x){ return x.id === todayDay.id; })[0];
  check('36b.3 and they are no longer on today’s list', picks.every(function(h){ return td2.houses.indexOf(h) === -1; }));
  check('36b.4 nobody lost (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0, String(H.api.confirmedNotOnAnyDay().length));
}

suite('SCH-137 On a Warehouse list means on no day — every door');
{
  /* Dax, 2026-10-16, on Lori Pugh scheduled while on the build list: "make it so that never happens again, yes build list
     means no on schedule". Every way a customer can be sitting on a day when a Warehouse job is opened for them, each with a
     different list, then the five-minute sync and every kind of press. RUN through the real code. */
  const book = makeBook(160, 4420);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const season = H.season();
  H.setNow(EVENING);
  H.load(book, {season: season});
  H.api.refreshLockedDates();
  const byId = {}; book.forEach(function(b){ byId[b.id] = b; });
  const all = daysOf().filter(function(d){ return d.ds; }).sort(function(a, b){ return a.ds < b.ds ? -1 : 1; });
  const tom = all[0], second = all[1];
  const open = all.filter(function(d){ return !H.api.routeDayIsLocked(d.ds); });
  const custOf = function(h){ return byId[String(h.id).replace(/^cust-/, '')]; };
  const crewHouse = function(d, i, k){ return custOf(H.api.crewHousesFor(i, d.day)[k || 0]); };
  check('37.0 the scenario has tomorrow, the day after and at least four open days', tom.ds === '2026-10-01' && second.ds === '2026-10-02' && open.length >= 4,
    tom.ds + ' ' + second.ds + ' open ' + open.length);
  /* who goes on which list, from where */
  const cases = [
    ['an open day, a new build', crewHouse(open[0], 0), {needsLightBuild: true}],
    ['tomorrow, on a crew CHECKED for tomorrow, a timer job', crewHouse(tom, 0), {needsTimerOnly: true}],
    ['tomorrow, the other crew, a build', crewHouse(tom, 1), {needsLightBuild: true}],
    ['the day after (locked), a recycle', crewHouse(second, 0), {needsLightRecycle: true}],
    ['a PRINTED open day, a colour change', crewHouse(open[1], 0), {needsColorChange: true}],
    ['MARKED for tomorrow, a build', crewHouse(open[2], 0), {needsLightBuild: true}],
    ['STUCK on their day and a priority, a timer removal', crewHouse(open[3], 0), {needsTimerRemoved: true, rushInstall: true}]
  ];
  H.api.setCrewHeld(tom.day.id, 0, true);
  H.api.markDayPrinted(open[1].day);
  H.api.toggleTomorrowMark('cust-' + cases[5][1].id);
  cases[6][1].data.stuckOnDate = open[3].ds;
  check('37.1 every one of them starts on a day', cases.every(function(c){ return !!c[1] && !!dayOfCust(c[1].id); }),
    cases.map(function(c){ return c[0] + '=' + (c[1] ? dayOfCust(c[1].id) : 'none'); }).join(' | '));
  cases.forEach(function(c){ Object.assign(c[1].data, c[2]); });
  const onDays = function(){ return cases.filter(function(c){ return !!dayOfCust(c[1].id); }).map(function(c){ return c[0] + ' @ ' + dayOfCust(c[1].id); }); };
  H.tick();
  check('37.2 the five-minute sync takes every one of them off every day', onDays().length === 0, onDays().join(' | '));
  H.press();
  check('37.3 Recalculate everything does not put any back', onDays().length === 0, onDays().join(' | '));
  H.press(true);
  check('37.4 nor does Recalculate INCLUDING the next two days', onDays().length === 0, onDays().join(' | '));
  check('37.5 and nobody Confirmed was left off a day getting there (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0, String(H.api.confirmedNotOnAnyDay().length));
  /* a hand move cannot put one back either */
  const target = daysOf().filter(function(d){ return d.ds && !H.api.routeDayIsLocked(d.ds); })[0];
  const strayH = {id: 'cust-' + cases[0][1].id, name: cases[0][1].data.name, city: cases[0][1].data.city, address: cases[0][1].data.address};
  const other = daysOf().filter(function(d){ return d.ds && d.day !== target.day && !H.api.routeDayIsLocked(d.ds); })[0];
  other.day.houses.push(strayH);
  H.api.moveHouse(strayH.id, target.day.id);
  check('37.6 a hand move will not put somebody on a Warehouse list onto a day', target.day.houses.indexOf(strayH) === -1);
  other.day.houses = other.day.houses.filter(function(h){ return h !== strayH; });
  /* the other half: off the list, back on a day */
  cases.forEach(function(c){ Object.keys(c[2]).forEach(function(k){ if(k !== 'rushInstall') c[1].data[k] = false; }); });
  H.press();
  const back = cases.filter(function(c){ return !dayOfCust(c[1].id); }).map(function(c){ return c[0]; });
  check('37.7 the moment the warehouse lets go of them, the next press puts every one back on a day', back.length === 0, back.join(' | '));
  /* a house on a day that has already gone (missed), then put on the build list */
  H.setNow(new Date(2026, 9, 2, 8, 0));
  H.api.refreshLockedDates();
  const gone = daysOf().filter(function(d){ return d.ds && d.ds < '2026-10-02'; }).map(function(d){ return d.day; })
    .reduce(function(a, d){ return a.concat(d.houses.filter(function(h){ return !h.done; })); }, []);
  const missed = gone.length ? custOf(gone[0]) : null;
  if(missed){ missed.data.needsLightBuild = true; H.tick(); }
  check('37.8 a missed house from a day already gone is not carried forward onto a new day while on the build list', !!missed && !dayOfCust(missed.id), missed ? dayOfCust(missed.id) : 'no missed house in the scenario');
}

suite('SCH-138 A page older than the plan never saves it — so a new field can never be wiped');
{
  /* Dax, 2026-10-16: "the hang tomorrow button broke so im assuming a lot of stuff broke so figure out what happened make sure
     its built in to be impossible to break". The check saved, then an admin page opened before the update — which did not know
     `crewHeld` — saved the whole plan back without it. The plan now carries PLAN_SCHEMA and an older page stops saving. */
  const book = makeBook(80, 5150);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const out = H.api.serialize();
  check('38.0 every saved plan says which version of the page wrote it', out.schema === H.api.PLAN_SCHEMA && H.api.PLAN_SCHEMA >= 2, String(out.schema));
  check('38.1 a plan from a NEWER page is spotted', H.api.planIsNewerThanPage({schema: H.api.PLAN_SCHEMA + 1}) === true);
  check('38.2 the same version, and every plan saved before versions existed, are not', !H.api.planIsNewerThanPage({schema: H.api.PLAN_SCHEMA}) &&
    !H.api.planIsNewerThanPage({}) && !H.api.planIsNewerThanPage({schema: 'x'}) && H.api.planSchemaOf({}) === 1);
  const a = JSON.parse(JSON.stringify(out)), b = JSON.parse(JSON.stringify(out));
  delete b.schema;
  check('38.3 the version alone is never "a change" — two computers on different versions do not bounce the plan', H.api.planKey(a) === H.api.planKey(b));
  /* ⭐ THE FINGERPRINT. The plan and its days are written from an explicit list of fields, so a field added there is a field an
     older page silently drops. Change the list and this fails until PLAN_SCHEMA goes up — then update RECORDED below. */
  const RECORDED = {schema: 4,
    top: 'baseStart,crews,dayLimits,days,fixList,fixOrder,fixRouteSeq,globalDelta,hangDay,importedAt,lastRecalc,lastRecalcOn,schema,takeDelta,v',
    day: 'base,cascade,crewHeld,fixedOn,frozenCrews,frozenIds,houses,id,isFixRoute,isTakedown,pin,printedAt,soloCrew'};
  const top = Object.keys(out).sort().join(',');
  const dayKeys = new Set(); out.days.forEach(function(d){ Object.keys(d).forEach(function(k){ dayKeys.add(k); }); });
  const day = Array.from(dayKeys).sort().join(',');
  check('38.4 the fields a plan is saved with are the ones recorded for this version (changed them? raise PLAN_SCHEMA in admin.html, then update RECORDED here)',
    top === RECORDED.top && day === RECORDED.day, 'top: ' + top + '  |  day: ' + day);
  check('38.5 and PLAN_SCHEMA is the version they were recorded at', H.api.PLAN_SCHEMA === RECORDED.schema, H.api.PLAN_SCHEMA + ' vs ' + RECORDED.schema);
  /* The four doors to Firestore, read as written: each one asks before it touches the plan. Comments are stripped first. */
  const code = function(n){ return (extractFn(admin, n) || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); };
  const save = code('saveNow');
  check('38.6 saveNow returns before writing anything when the page is out of date', /if\(PLAN_PAGE_OUTDATED\)\s*return;/.test(save) &&
    save.indexOf('PLAN_PAGE_OUTDATED') < save.indexOf('setDoc('));
  check('38.7 scheduleSave queues nothing when the page is out of date', /^function scheduleSave\(\)\{if\(PLAN_PAGE_OUTDATED\)return;/.test(code('scheduleSave')));
  const live = code('followPlanLive'), load = code('loadPlan');
  check('38.8 a plan arriving from another computer is version-checked before it is taken', live.indexOf('planIsNewerThanPage(data)') !== -1 &&
    live.indexOf('planIsNewerThanPage(data)') < live.indexOf('hydrate(data)'));
  check('38.9 and so is the plan loaded when the page opens', load.indexOf('planIsNewerThanPage(') !== -1 && load.indexOf('planIsNewerThanPage(') < load.indexOf('hydrate('));
  const rl = code('planReloadWhenIdle');
  check('38.11 it reloads at most once per ten minutes, so a rolled-back site can never reload in a loop', /Date\.now\(\) - last < PLAN_RELOAD_GAP_MS/.test(rl) &&
    rl.indexOf('PLAN_RELOAD_GAP_MS') < rl.indexOf('location.reload()') && rl.indexOf('sessionStorage.setItem(PLAN_RELOAD_KEY') < rl.indexOf('location.reload()'));
  check('38.10 setDoc on the plan happens in exactly one place (saveNow), so there is no unguarded door', (admin.match(/setDoc\(PLAN_REF\(\)/g) || []).length === 1 &&
    save.indexOf('setDoc(PLAN_REF()') !== -1 && !/updateDoc\(PLAN_REF\(\)/.test(admin));
}

suite('SCH-139 The last Recalculate — who, when and what it said — is on every computer');
{
  /* Addie, 2026-10-07 (PR #544): make Recalculate "persist and show for every account and computer, not just the one that
     ran it". The summary rides with the plan, so another computer loading or receiving the plan shows it. */
  const book = makeBook(60, 6110);
  run(book, {now: new Date(2026, 8, 28, 7, 0)});
  const saved = JSON.parse(JSON.stringify(H.api.serialize()));
  saved.lastRecalc = {at: '2026-10-16T21:30:00.000Z', by: 'addie@example.com', summary: 'Rebuilt 12 days, 240 houses'};
  H.api.hydrate(saved);
  const back = H.api.serialize().lastRecalc;
  check('39.0 the last Recalculate survives a save and a load on another computer', !!back && back.by === 'addie@example.com' &&
    back.summary === 'Rebuilt 12 days, 240 houses' && back.at === '2026-10-16T21:30:00.000Z', JSON.stringify(back));
  const noneBack = (function(){ const s2 = JSON.parse(JSON.stringify(saved)); delete s2.lastRecalc; H.api.hydrate(s2); return H.api.serialize().lastRecalc; })();
  check('39.1 a plan saved before this existed carries none, and says nothing', noneBack === null);
  const txtSrc = extractFn(admin, 'lastRecalcText');
  const txt = txtSrc ? new Function(txtSrc + 'return lastRecalcText;')() : function(){ return ''; };
  const line = txt({at: '2026-10-16T21:30:00.000Z', by: 'addie@example.com', summary: 'Rebuilt 12 days'});
  check('39.2 the line says when (Mountain time), who and what', /Last \u2699 Recalculate Oct 16, 3:30\sPM by addie@example\.com: Rebuilt 12 days/.test(line), line);
  check('39.3 nothing recorded draws nothing', txt(null) === '' && txt({}) === '');
  const code = function(n){ return (extractFn(admin, n) || '').replace(/\/\*[\s\S]*?\*\//g, ''); };
  const pressAt = admin.indexOf('recordRecalc(parts);scheduleSave();'), toastAt = admin.indexOf("toast(parts.join(' \u00b7 '));", pressAt);
  check('39.4 every Recalculate records its summary and saves it, before the toast', pressAt > 0 && toastAt > pressAt && (toastAt - pressAt) < 200);
  check('39.5 every redraw paints the line', /paintLastRecalc\(\);if\(loaded\)scheduleSave\(\)/.test(code('renderAll')));
  check('39.6 the line has somewhere to go on the season bar', admin.indexOf('id=\\"lastRecalcNote\\"') !== -1);
}

suite('SCH-119 A house ticked done leaves the day lists on the next Recalculate, and not before');
{
  const mkC = function(id){ const c = TOWNS.Lehi;
    return {id: id, data: Object.assign({name: id, customerNumber: '7' + id, city: 'Lehi', address: '2 Done Ln', phone: '80155577' + id,
      lat: c[0], lng: c[1], installPreference: 'Normal Schedule'}, YES)}; };
  const mkH = function(id, done){ return {id: 'cust-' + id, name: id, address: '2 Done Ln', city: 'Lehi', zip: '', phone: '',
    email: '', pref: 'Normal Schedule', cu: '', price: '', details: '', done: !!done}; };
  H.setNow(new Date(2026, 9, 7, 7, 0));
  H.load(['h1', 'h2', 'h3', 'h4'].map(mkC), {season: [
    {id: 'x8', base: 7, cascade: 0, pin: null, houses: [mkH('h1', true), mkH('h2', false)]},
    {id: 'x9', base: 8, cascade: 0, pin: null, houses: [mkH('h3', false), mkH('h4', false)]}]});
  H.api.computeDates();
  const shown = function(dayId){ const d = H.season().filter(function(x){ return x.id === dayId; })[0];
    return d ? H.api.crewIndexes().reduce(function(a, i){ return a.concat(H.api.crewHousesFor(i, d) || []); }, []).map(function(h){ return h.name; }).sort().join(',') : ''; };
  check('19.1 before any press, a house ticked done is still on its day', shown('x8') === 'h1,h2', shown('x8'));
  H.press();
  check('19.2 Recalculate everything takes it off the day list and the crew sheets', shown('x8') === 'h2', shown('x8'));
  const x8 = H.season().filter(function(x){ return x.id === 'x8'; })[0];
  /* [[SCH-130]] (2026-10-13) a house done ahead of its locked day now goes to the record at the front of the season,
     so the record of what was hung lives THERE — still in the plan, still what the Completed count reads. */
  const recDay = function(){ return H.season().filter(function(x){ return (x.houses || []).some(function(h){ return h.name === 'h1'; }); })[0]; };
  check('19.3a the full crew split (freeze, unassigned check) of the day holding it still holds it', (function(){ const d = recDay(); return !!d && H.api.dayCrewHouses(d).some(function(c){ return c.some(function(h){ return h.name === 'h1'; }); }); })());
  check('19.3 and a day still holds it — the record of what was hung, at the front of the season (SCH-130)',
    !!recDay() && recDay().houses.some(function(h){ return h.name === 'h1' && h.done; }) && H.api.isoOf(H.api.dayDate(recDay())) < '2026-10-07' &&
    !(x8 && x8.houses.some(function(h){ return h.name === 'h1'; })));
  check('19.4 so a hung customer never looks unscheduled to the safety net (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0,
    JSON.stringify(H.api.confirmedNotOnAnyDay()));
  const x9 = H.season().filter(function(x){ return x.id === 'x9'; })[0];
  x9.houses.forEach(function(h){ if(h.name === 'h3') h.done = true; });
  check('19.5 a house ticked AFTER the press stays visible until the next one', shown('x9') === 'h3,h4', shown('x9'));
  const rd = recDay();
  rd.houses.forEach(function(h){ if(h.name === 'h1') h.done = false; });
  check('19.6 and a house unticked again comes straight back on the day that holds it', shown(rd.id).split(',').indexOf('h1') !== -1, shown(rd.id));
}
}

suite('SCH-121 Recalculate packs done houses onto the first days and closes the season up behind them');
{
  const book = makeBook(1000, 121, {towns: ['Lehi', 'American Fork', 'Orem']});
  book.forEach(function(c){ c.data.installPreference = 'Normal Schedule'; });
  const ds = function(d){ return H.api.isoOf(H.api.dayDate(d)); };
  const doneOn = function(){ const out = []; H.api.installDays().forEach(function(d){ (d.houses || []).forEach(function(h){ if(h.done) out.push({ds: ds(d), id: h.id}); }); }); return out; };
  const scenario = function(hang){
    H.setNow(new Date(2026, 9, 1, 7, 0)); H.load(book, {}); H.press();
    let early = null;
    H.api.installDays().forEach(function(d){ const x = ds(d);
      if(x < '2026-10-09') d.houses.slice(0, 30).forEach(function(h){ h.done = true; });
      if(x === '2026-10-28' && d.houses.length){ d.houses[0].done = true; early = d.houses[0].id; } });
    const n = doneOn().length;
    H.setNow(new Date(2026, 9, 9, 7, 0));
    if(hang) H.api.setHangDay(hang);
    H.press();
    return {early: early, n: n};
  };
  const a = scenario(null);
  const done = doneOn();
  check('21.0 the scenario ticked a house on a day three weeks out', !!a.early);
  check('21.1 every done house is still on the plan', done.length === a.n, done.length + ' of ' + a.n);
  check('21.2 and every one of them sits before today', done.every(function(x){ return x.ds < '2026-10-09'; }),
    JSON.stringify(done.filter(function(x){ return x.ds >= '2026-10-09'; }).slice(0, 3)));
  check('21.3 the house ticked early on 28 October went to the front with the rest',
    done.some(function(x){ return x.id === a.early && x.ds < '2026-10-09'; }));
  const firstDays = H.api.installDays().map(ds).filter(function(x){ return x < '2026-10-09'; });
  check('21.4 packed from 1 October, a full day apiece', firstDays[0] === '2026-10-01' &&
    H.api.installDays().filter(function(d){ return ds(d) === '2026-10-01'; })[0].houses.length === 40, firstDays.join(','));
  const open = H.api.installDays().filter(function(d){ const x = ds(d); return x > '2026-10-09' && x < '2026-11-01'; }).map(ds);
  const want = []; for(let d = 12; d <= 30; d++){ const dt = new Date(2026, 9, d); if(dt.getDay() !== 0 && dt.getDay() !== 6) want.push(H.api.isoOf(dt)); }
  check('21.5 and October closes up behind them: every working day from the 12th holds work, no gap',
    want.every(function(x){ return open.indexOf(x) !== -1; }), 'missing ' + want.filter(function(x){ return open.indexOf(x) === -1; }).join(','));
  check('21.6 nobody Confirmed is left off a day (SCH-85)', H.api.confirmedNotOnAnyDay().length === 0);
  scenario('2026-10-05');
  const done2 = doneOn();
  check('21.7 with the crew hanging 5 October, a done house sits before the hang day or on a locked day (5-7 Oct), never later',
    done2.length > 0 && done2.every(function(x){ return x.ds < '2026-10-08'; }), JSON.stringify(done2.filter(function(x){ return x.ds >= '2026-10-08'; }).slice(0, 3)));
  H.api.setHangDay(null);
}

suite('SCH-122 October customers get October: three weeks of real presses with crews finishing 70% a day');
{
  const book = makeBook(600, 14);
  const prefOf = {}; book.forEach(function(c){ prefOf['cust-' + c.id] = c.data.installPreference; });
  const ds = function(d){ return H.api.isoOf(H.api.dayDate(d)); };
  const r = rng(5);
  let worst = 0, sameTownAvoidable = 0;
  H.setNow(new Date(2026, 9, 12, 7, 0)); H.load(book, {}); H.press();
  for(let day = new Date(2026, 9, 12); day <= new Date(2026, 9, 30); day.setDate(day.getDate() + 1)){
    if(day.getDay() === 0 || day.getDay() === 6) continue;
    H.setNow(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 7, 0));
    H.press();
    const today = H.api.isoOf(day);
    const inNov = [];
    H.api.installDays().forEach(function(d){ if(ds(d) > '2026-10-31') d.houses.forEach(function(h){
      if(!h.done && prefOf[h.id] === 'October') inNov.push(h); }); });
    if(inNov.length > worst) worst = inNov.length;
    const open = H.api.installDays().filter(function(d){ const x = ds(d); return x > today && x <= '2026-10-31' && !H.api.routeDayIsLocked(x); });
    inNov.forEach(function(h){ if(open.some(function(d){ return d.houses.some(function(o){
      return !o.done && o !== h && o.city === h.city && prefOf[o.id] === 'Normal Schedule'; }); })) sameTownAvoidable++; });
    const td = H.api.installDays().filter(function(d){ return ds(d) === today; })[0];
    if(td) td.houses.forEach(function(h){ if(!h.done && r() < 0.7) h.done = true; });
  }
  check('22.1 the worst morning holds at most 12 October customers in November — the ones missed on a locked last day (it was 50)',
    worst <= 12, 'worst ' + worst);
  check('22.2 no October customer is in November while an open October day holds an any-time house in their own town',
    sameTownAvoidable === 0, sameTownAvoidable + ' times');
}

suite('SCH-123 Two weeks of real presses and syncs: the next two days never move, nobody on any warehouse list is on a day');
{
  const book = makeBook(500, 123);
  const byId = {}; book.forEach(function(c){ byId['cust-' + c.id] = c; });
  const KINDS = [['build', 'needsLightBuild'], ['timer', 'needsTimerOnly'], ['colour', 'needsColorChange'], ['recycle', 'needsLightRecycle']];
  const r = rng(77);
  const ds = function(d){ return H.api.isoOf(H.api.dayDate(d)); };
  const holders = function(){ const m = {}; H.api.installDays().forEach(function(d){ (d.houses || []).forEach(function(h){ m[h.id] = ds(d); }); }); return m; };
  const flagged = {}, released = {};
  const failA = [], failB = [], failC = [], kindsSeen = {};
  const lockedSnap = function(today){
    const dates = H.api.installDays().map(ds).filter(function(x, i, a){ return x >= today && a.indexOf(x) === i; }).sort();
    const take = dates[0] === today ? dates.slice(0, 3) : dates.slice(0, 2);
    const snap = {};
    take.forEach(function(x){ snap[x] = {}; H.api.installDays().filter(function(d){ return ds(d) === x; })
      .forEach(function(d){ d.houses.forEach(function(h){ snap[x][h.id] = 1; }); }); });
    return snap;
  };
  const checkA = function(label, today, snap){
    Object.keys(snap).forEach(function(x){
      const now = {};
      H.api.installDays().filter(function(d){ return ds(d) === x; }).forEach(function(d){ d.houses.forEach(function(h){ now[h.id] = 1; }); });
      Object.keys(now).forEach(function(id){ if(!snap[x][id]) failA.push(label + ' ' + today + ' added ' + id + ' to ' + x); });
      Object.keys(snap[x]).forEach(function(id){ if(!now[id] && !flagged[id]) failA.push(label + ' ' + today + ' moved ' + id + ' off ' + x); });
    });
  };
  const checkB = function(label, today){
    const m = holders();
    Object.keys(flagged).forEach(function(id){ if(m[id] && m[id] >= today) failB.push(label + ' ' + today + ' ' + id + ' (' + flagged[id] + ') on ' + m[id]); });
  };
  H.setNow(new Date(2026, 8, 30, 7, 0)); H.load(book, {}); H.press();
  for(let day = new Date(2026, 9, 1); day <= new Date(2026, 9, 16); day.setDate(day.getDate() + 1)){
    if(day.getDay() === 0 || day.getDay() === 6) continue;
    const today = H.api.isoOf(day);
    H.setNow(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 7, 0));
    const pool = Object.keys(holders()).filter(function(id){ return byId[id] && !flagged[id]; });
    const s0 = lockedSnap(today);
    const lockedIds = []; Object.keys(s0).slice(1).forEach(function(x){ Object.keys(s0[x]).forEach(function(id){ if(byId[id] && !flagged[id]) lockedIds.push(id); }); });
    [pool, pool, pool, pool, lockedIds, lockedIds].forEach(function(list, i){
      if(!list.length) return;
      const id = list[Math.floor(r() * list.length)];
      if(flagged[id]) return;
      const k = KINDS[(i + day.getDate()) % 4];
      byId[id].data[k[1]] = true; flagged[id] = k[0]; kindsSeen[k[0]] = 1;
    });
    Object.keys(flagged).forEach(function(id){
      if(r() < 0.3){ const k = KINDS.filter(function(k){ return k[0] === flagged[id]; })[0]; byId[id].data[k[1]] = false; delete flagged[id]; released[id] = today; }
    });
    let snap = lockedSnap(today); H.tick(); checkA('sync', today, snap); checkB('sync', today);
    snap = lockedSnap(today); H.press(); checkA('press', today, snap); checkB('press', today);
    const after = holders();
    Object.keys(released).forEach(function(id){ if(!flagged[id] && !after[id]) failC.push(today + ' ' + id + ' released ' + released[id]); delete released[id]; });
    H.api.installDays().filter(function(d){ return ds(d) === today; }).forEach(function(d){ d.houses.forEach(function(h){ if(!h.done && r() < 0.75) h.done = true; }); });
  }
  check('23.0 the run put somebody on every one of the four lists', Object.keys(kindsSeen).length === 4, Object.keys(kindsSeen).join(','));
  check('23.1 the next two days on the schedule never gain a house or lose one, except to the warehouse', failA.length === 0, failA.slice(0, 4).join(' | '));
  check('23.2 nobody on Build, Timer, Color Change or Recycle is on any day, after a sync or a Recalculate', failB.length === 0, failB.slice(0, 4).join(' | '));
  check('23.3 and the next Recalculate puts everybody taken off a list back on a day', failC.length === 0, failC.slice(0, 4).join(' | '));
}
suite('SCH-124 / SCH-127 Recalculate everything never runs itself — a press each morning still rescues every missed house');
{
  /* ⛔ [[SCH-127]], 2026-10-12, SUPERSEDES SCH-124's automatic run. Addie: "never recalculate unless we push button
     recalculate." The mechanism below is still checked (the stamp, the saved date) because every press still uses it;
     what changed is that nothing presses the button for anybody. */
  {
    const c0 = admin.split('\r\n').join('\n');
    const at = c0.indexOf('function maybeMorningRecalc(){');
    const first = at === -1 ? '' : c0.slice(at + 'function maybeMorningRecalc(){'.length).trim();
    check('24.0 the automatic morning run is switched off, and the switch is the first thing it asks',
      c0.indexOf('const AUTO_MORNING_RECALC = false;') !== -1 &&
      first.indexOf('if(!AUTO_MORNING_RECALC) return false;') === 0);
  }
  const M = lift(['morningRecalcDue'], 'const MORNING_RECALC_HOUR = 5;', 'return {due: morningRecalcDue};');
  check('24.1 not before five in the morning', M.due({date: '2026-10-12', hour: 4, minute: 59}, '2026-10-09') === false);
  check('24.2 from five on, once the date has moved on since the last press', M.due({date: '2026-10-12', hour: 5, minute: 0}, '2026-10-09') === true);
  check('24.3 and never twice in one morning — a press earlier today counts', M.due({date: '2026-10-12', hour: 9, minute: 0}, '2026-10-12') === false);
  check('24.4 the first morning ever (nothing stamped yet) runs', M.due({date: '2026-10-12', hour: 6, minute: 0}, null) === true);
  const code = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const timer = code.slice(code.indexOf('function __startSyncTimer('), code.indexOf('function __startSyncTimer(') + 900);
  check('24.5 the five-minute timer asks for it after every sync', /scheduleSyncFromCustomers\(\{quiet:false\}\);\s*maybeMorningRecalc\(\)/.test(timer));
  const run = code.slice(code.indexOf('function runRecalculateEverything('), code.indexOf('function runRecalculateEverything(') + 400);
  check('24.6 every press of the button stamps the morning, so an office press is not repeated', /LAST_RECALC_ON\s*=/.test(run));
  check('24.7 the stamp is saved with the plan, so every computer agrees', /lastRecalcOn:LAST_RECALC_ON/.test(code));
  check('24.8 and a stale copy from another computer can never move it backwards', /String\(o\.lastRecalcOn\)>String\(LAST_RECALC_ON/.test(code));
  const mm = code.slice(code.indexOf('function maybeMorningRecalc('), code.indexOf('function __startSyncTimer('));
  check('24.9 it presses the real button — forecast, loading guard and report included — and claims the morning first',
    /getElementById\('recalcBtn'\)/.test(mm) && mm.indexOf('LAST_RECALC_ON=now.date') !== -1 && mm.indexOf('LAST_RECALC_ON=now.date') < mm.indexOf('.click()')
    && /jobAddresses/.test(mm) && /recalcRunning/.test(mm));
  /* and what it buys, on the real Recalculate: three weeks, crews finishing 70%, one press each morning */
  const book = makeBook(600, 124);
  const ds = function(d){ return H.api.isoOf(H.api.dayDate(d)); };
  const r = rng(124);
  const missed = {}, lost = [];
  H.setNow(new Date(2026, 8, 30, 7, 0)); H.load(book, {}); H.press();
  for(let day = new Date(2026, 9, 1); day <= new Date(2026, 9, 21); day.setDate(day.getDate() + 1)){
    if(day.getDay() === 0 || day.getDay() === 6) continue;
    const today = H.api.isoOf(day);
    H.setNow(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 7, 0));
    H.press();
    const where = {}; H.api.installDays().forEach(function(d){ d.houses.forEach(function(h){ where[h.id] = {ds: ds(d), done: !!h.done}; }); });
    Object.keys(missed).forEach(function(id){ const w = where[id]; if(!w || (!w.done && w.ds < today)) lost.push(id + ' missed ' + missed[id] + ' -> ' + (w ? w.ds : 'nowhere')); });
    Object.keys(missed).forEach(function(k){ delete missed[k]; });
    H.api.installDays().filter(function(d){ return ds(d) === today; }).forEach(function(d){ d.houses.forEach(function(h){
      if(h.done) return; if(r() < 0.7) h.done = true; else missed[h.id] = today; }); });
  }
  check('24.10 with one press a morning, every house the crew missed is on a day from that morning on', lost.length === 0, lost.slice(0, 4).join(' | '));
}
suite('SCH-126 / SCH-132 Every crew drives the shortest route that finishes each area before leaving it, and who is on which crew does not depend on the order');
{
  const book = makeBook(320, 125);
  H.setNow(new Date(2026, 9, 9, 7, 0)); H.load(book, {}); H.press();
  const yard = H.api.routeHomePoint();
  const mi = function(a, b){ return H.api.haversine(a.lat, a.lng, b.lat, b.lng); };
  const ptOfH = function(h){ const c = H.api.planCustomerFor(h); return H.api.houseGeoPoint(h, (c && c.data) || {}); };
  const tour = function(P){ if(!P.length) return 0; let m = mi(yard, P[0]); for(let i = 1; i < P.length; i++) m += mi(P[i - 1], P[i]); return m + mi(P[P.length - 1], yard); };
  /* the exact shortest yard -> stops -> yard (Held-Karp), feasible to about a dozen stops. [[SCH-132]]: among the orders that
     finish each area before leaving it — a drive between two areas carries a search price far above any day's miles,
     which is the rule as admin.html prices it, and the price is taken back off so the answer is in real miles */
  const exact = function(P){
    const A = H.api.routeAreaIds(P), PEN = 1000, HOP = 100, legs = new Set(A).size - 1;
    const mi = function(a, b){ const r = H.api.haversine(a.lat, a.lng, b.lat, b.lng), both = a.__i !== undefined && b.__i !== undefined; return r + (both && A[a.__i] !== A[b.__i] ? PEN : 0) + (both && r > 5 ? HOP : 0); };
    P = P.map(function(p, i){ return {lat: p.lat, lng: p.lng, __i: i}; });
    const n = P.length, FULL = 1 << n, dp = new Float64Array(FULL * n).fill(Infinity);
    for(let i = 0; i < n; i++) dp[(1 << i) * n + i] = mi(yard, P[i]);
    for(let S = 1; S < FULL; S++) for(let i = 0; i < n; i++){
      const v = dp[S * n + i]; if(v === Infinity || !(S & (1 << i))) continue;
      for(let j = 0; j < n; j++){ if(S & (1 << j)) continue; const T2 = S | (1 << j), w = v + mi(P[i], P[j]); if(w < dp[T2 * n + j]) dp[T2 * n + j] = w; }
    }
    let best = Infinity; for(let i = 0; i < n; i++) best = Math.min(best, dp[(FULL - 1) * n + i] + mi(P[i], yard));
    /* [[SCH-133]] a drive over five miles between two houses is priced 100 as well; the fewest such drives is subtracted */
    return best - legs * PEN - Math.floor((best - legs * PEN) / HOP) * HOP;
  };
  check('25.0 the yard resolves, so every tour below is a real round trip', !!(yard && typeof yard.lat === 'number'));
  let checked = 0, routes = 0; const over = [], back = [];
  const scan = function(){ H.api.installDays().forEach(function(d){
    H.api.crewIndexes().forEach(function(i){
      const hs = H.api.crewHousesFor(i, d) || [];
      /* [[SCH-132]] every route, whatever its size: never back into an area it already left */
      const all = hs.map(ptOfH).filter(function(p){ return p && typeof p.lat === 'number'; });
      if(all.length > 1){ routes++; if(H.api.routeAreaReturns(all)) back.push(H.api.isoOf(H.api.dayDate(d)) + ' crew ' + (i + 1) + ' goes back ' + H.api.routeAreaReturns(all) + 'x'); }
      /* 15, not 12, since [[SCH-128]]: no crew goes out under ten, so the runs small enough to solve exactly are 10-15. */
      if(hs.length < 4 || hs.length > 15) return;
      const P = hs.map(ptOfH); if(P.some(function(p){ return !p || typeof p.lat !== 'number'; })) return;
      checked++;
      const a = tour(P), e = exact(P);
      if(a > e + 0.05) over.push(H.api.isoOf(H.api.dayDate(d)) + ' crew ' + (i + 1) + ' ' + a.toFixed(2) + ' vs ' + e.toFixed(2));
    });
  }); };
  scan();
  /* [[SCH-128]]: a full season no longer has short runs to solve exactly, so three small seasons supply them —
     each is a day or two of ten to fifteen houses a crew, ordered by the same code. */
  [[26, 201], [30, 202], [34, 203]].forEach(function(spec){
    H.setNow(new Date(2026, 9, 9, 7, 0)); H.load(makeBook(spec[0], spec[1]), {}); H.press();
    scan();
  });
  check('25.1 the run had routes small enough to check exactly', checked >= 3, String(checked));
  check('25.2 every one of them is driven in the shortest order that finishes each area before leaving it, yard to yard', over.length === 0, over.slice(0, 4).join(' | '));
  check('25.3 no crew route anywhere goes back into an area it already left (SCH-132)', routes >= 20 && back.length === 0, routes + ' routes; ' + back.slice(0, 4).join(' | '));
  /* (the order-independent crew split is proved by 25.2: undone, routes come back longer than the shortest — measured) */
}
/* ======================================================================================= */
suite('The plan Firestore is handed can actually be saved (2026-10-12)');
{
  /* ⛔ WHY THIS EXISTS. From SCH-106 (2026-09-30) a locked day's crew split was written as a list of
     lists, which Firestore refuses — and it refuses the whole document. Every save made once the
     customers had loaded failed in five grey words, so a Recalculate existed on the computer that
     pressed it and nowhere else, for twelve days, with every gate green: nothing here ever looked at
     the plan as it is WRITTEN. This runs the real press and reads the real serialize(). */
  const book = makeBook(120, 110);
  H.setNow(TODAY); H.load(book, {}); H.press();
  H.load(book, {season: H.season()}); H.press();
  const out = H.api.serialize();
  const frozen = out.days.filter(function(d){ return Array.isArray(d.frozenCrews); });
  check('26.0 the press froze at least one day, so the checks below have something to read', frozen.length >= 1, String(frozen.length));
  check('26.1 nothing in the written plan is a list inside a list, or undefined', H.api.planSaveProblem(out) === '', H.api.planSaveProblem(out));
  check('26.2 each crew of a frozen split is written as its own map of ids',
    frozen.every(function(d){ return d.frozenCrews.every(function(c){ return c && !Array.isArray(c) && Array.isArray(c.ids); }); }));
  check('26.3 the checker itself bites: a list inside a list and an undefined are both named',
    /list inside a list/.test(H.api.planSaveProblem({days: [{frozenCrews: [['a']]}]})) &&
    H.api.planSaveProblem({days: [{x: undefined}]}) === 'days[0].x is undefined' &&
    H.api.planSaveProblem({days: [{ids: ['a'], m: {k: [1]}}], n: null}) === '');
  /* ⛔ 2026-10-14: a fix whose description was never typed (fixList[0].issue undefined) stopped the
     Schedule saving at all — Firestore refuses the WHOLE document over one undefined. What is written
     goes through planDropUndefined; this plants the real shape and asserts the write is now clean. */
  const holed = JSON.parse(JSON.stringify(out));
  holed.fixList = [{id: 'f1', name: 'No Note', issue: undefined}];
  if (holed.days[0] && holed.days[0].houses && holed.days[0].houses[0]) holed.days[0].houses[0].issue = undefined;
  check('26.5 an undefined left anywhere in the plan is dropped before it is written',
    H.api.planSaveProblem(holed) !== '' && H.api.planSaveProblem(H.api.planDropUndefined(holed)) === '',
    H.api.planSaveProblem(H.api.planDropUndefined(holed)));
  check('26.6 and nothing else in the plan changes', JSON.stringify(H.api.planDropUndefined(out)) === JSON.stringify(out));
  check('26.7 the save writes the cleaned plan', /const data=planDropUndefined\(serialize\(\)\)/.test(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8')));
  /* The round trip, through JSON as Firestore would hand it back: same split, same houses on the same crew. */
  const before = H.season().map(function(d){ const s = H.api.frozenCrewSplit(d); return s ? s.map(function(c){ return c.map(function(h){ return String(h.id); }); }) : null; });
  H.api.hydrate(JSON.parse(JSON.stringify(out)));
  const after = H.season().map(function(d){ const s = H.api.frozenCrewSplit(d); return s ? s.map(function(c){ return c.map(function(h){ return String(h.id); }); }) : null; });
  check('26.4 a frozen split comes back exactly as it was saved', before.some(Boolean) && JSON.stringify(before) === JSON.stringify(after));
  check('26.5 and saving it again writes the same plan (no bounce between two computers)', JSON.stringify(H.api.serialize().days) === JSON.stringify(out.days));
  /* A plan in the old shape can only exist in memory on a page left open, but hydrate must not choke on one. */
  const old = JSON.parse(JSON.stringify(out));
  old.days.forEach(function(d){ if(d.frozenCrews) d.frozenCrews = d.frozenCrews.map(function(c){ return c.ids; }); });
  H.api.hydrate(old);
  check('26.6 the old list-of-lists shape is still read', JSON.stringify(H.api.serialize().days) === JSON.stringify(out.days));
}
/* ======================================================================================= */
suite('A kept day in the future holds its own date, not the whole calendar (2026-10-12)');
{
  /* ⛔ THE REAL BOOK, 2026-10-12. One house was stuck on 1 November, so the "next two scheduled days" after
     13 October were 1 and 2 November. The floor for new days was the day after the LAST kept day, so every
     new day began on 3 November: 14-30 October stood empty and 67 October customers were laid out in
     November — and the lock re-froze the same two days on every press, so the gap kept itself alive. */
  const book = makeBook(160, 127);
  const stuck = book.filter(function(b){ return b.data.installPreference === 'November'; })[0];
  stuck.data.stuckOnDate = '2026-11-02';
  H.setNow(TODAY); H.load(book, {}); H.press();
  /* The state the office was in: no day with work between tomorrow and November, so the two days the lock
     freezes as "the next two scheduled days" are November ones. Everybody dropped here is a customer with no
     day, and the press has to put them back. */
  const novOnly = H.season().filter(function(d){ if(d.isTakedown || d.isFixRoute) return true; const dt = H.api.dayDate(d); return dt && H.api.isoOf(dt) >= '2026-11-02'; });
  H.load(book, {season: novOnly}); H.press();
  const days = daysOf();
  const oct = days.filter(function(d){ return d.ds >= '2026-10-01' && d.ds <= '2026-10-31'; });
  check('27.0 the stuck house is on its November day, so there IS a kept day in the future', dayOfCust(stuck.id) === '2026-11-02', dayOfCust(stuck.id));
  check('27.1 October still fills: new days are built before the kept November day', oct.length >= 3, oct.map(function(d){ return d.ds; }).join(','));
  const late = book.filter(function(b){ return b.data.installPreference === 'October' && dayOfCust(b.id) > '2026-10-31'; });
  check('27.2 nobody who asked for October is laid out in November', late.length === 0, late.length + ' of them, e.g. ' + late.slice(0, 3).map(function(b){ return dayOfCust(b.id); }).join(','));
  const onKept = days.filter(function(d){ return d.ds === '2026-11-02'; });
  check('27.3 and the kept day is one day, not two — nothing new was built on top of it', onKept.length === 1, String(onKept.length));
  /* third press: the plan is stable, the gap does not come back */
  H.load(book, {season: H.season()}); H.press();
  const late2 = book.filter(function(b){ return b.data.installPreference === 'October' && dayOfCust(b.id) > '2026-10-31'; });
  check('27.4 a further press keeps it that way', late2.length === 0 && daysOf().filter(function(d){ return d.ds === '2026-11-02'; }).length === 1);
}
/* ======================================================================================= */
suite('SCH-128 No crew goes out for fewer than ten houses');
{
  /* Addie, 2026-10-12: "there should be at least 10 houses for each day for each crew" — a crew may run a few over
     twenty, a day holds forty at most, a stuck date wins, and the late leftovers share one day. Run on the REAL press,
     over three different books, because every claim is about where a house ends up. */
  const crewCounts = function(){
    return H.api.installDays().map(function(d){
      const ds = H.api.isoOf(H.api.dayDate(d));
      const runs = H.api.crewIndexes().map(function(i){ return (H.api.crewHousesFor(i, d) || []).length; }).filter(function(n){ return n > 0; });
      return {ds: ds, total: (d.houses || []).length, runs: runs, day: d};
    }).filter(function(x){ return x.total > 0; });
  };
  [[400, 128], [600, 129], [240, 130]].forEach(function(spec, k){
    const book = makeBook(spec[0], spec[1]);
    H.setNow(TODAY); H.load(book, {}); H.press();
    H.load(book, {season: H.season()}); H.press();
    const days = crewCounts();
    const shortCrew = days.filter(function(x){ return x.total >= 10 && x.runs.some(function(n){ return n < 10; }); });
    check('28.' + k + 'a book ' + spec[1] + ': on a day of ten or more, every crew out has at least ten', shortCrew.length === 0,
      shortCrew.slice(0, 5).map(function(x){ return x.ds + ' ' + x.runs.join('/'); }).join(' | '));
    /* REPOINTED BY [[SCH-131]] (2026-10-13): "at most two days under ten" assumed a short day could always ride with
       a run up to 30 miles away. Dax: every consecutive house within "5 at most" — so a day under ten is a fault only
       when every one of its houses could have joined another day that has room within five miles of it. */
    const ptH = function(h){ const c = H.api.planCustomerFor(h); return H.api.houseGeoPoint(h, (c && c.data) || {}); };
    const near5 = function(h, o){ const p = ptH(h); if(!p) return true; return (o.day.houses || []).some(function(x){ const q = ptH(x); return q && H.api.haversine(p.lat, p.lng, q.lat, q.lng) <= 5; }); };
    const tiny = days.filter(function(x){ return x.total < 10 && !H.api.routeDayIsLocked(x.ds); }).filter(function(x){
      /* [[SCH-134]] an October day is never a fault for not joining a November one — October room goes to them first */
      return days.some(function(o){ return o !== x && !(x.ds <= '2026-10-31' && o.ds > '2026-10-31') && !H.api.routeDayIsLocked(o.ds) && o.total + x.total <= 40 &&
        x.day.houses.every(function(h){ const c = H.api.planCustomerFor(h); return near5(h, o) && H.api.houseMayGoOn(h, (c && c.data) || {}, o.ds, '2026-10-01').ok; }) &&
        /* [[SCH-133]] and every crew on that day keeps its five miles with them — the planner's own test, as in the season sim */
        H.api.dayHoldsWithHouses(o.day, x.day.houses); });
    });
    check('28.' + k + 'b book ' + spec[1] + ': no day is left under ten when all of it could join another day within five miles (SCH-131)', tiny.length === 0,
      tiny.map(function(x){ return x.ds + ' ' + x.total; }).join(' | '));
    const over = days.filter(function(x){ return x.total > 40 || x.runs.some(function(n){ return n > 24; }); });
    check('28.' + k + 'c book ' + spec[1] + ': no day over forty and no crew over twenty-four', over.length === 0,
      over.slice(0, 5).map(function(x){ return x.ds + ' ' + x.total + ' ' + x.runs.join('/'); }).join(' | '));
    const v = H.api.validateSeasonPlan({});
    check('28.' + k + 'd book ' + spec[1] + ': and every placement rule still holds (month, deadline, away, nobody lost)', v.length === 0, JSON.stringify(v.slice(0, 2)));
    const late = book.filter(function(b){ return b.data.installPreference === 'October' && dayOfCust(b.id) > '2026-10-31'; });
    check('28.' + k + 'e book ' + spec[1] + ': nobody who asked for October was pushed into November to fill a day', late.length === 0, String(late.length));
  });
  /* a stuck date wins, even alone */
  {
    const book = makeBook(200, 131);
    const stuck = book.filter(function(b){ return b.data.installPreference === 'Normal Schedule'; })[0];
    stuck.data.stuckOnDate = '2026-12-04';
    H.setNow(TODAY); H.load(book, {}); H.press();
    H.load(book, {season: H.season()}); H.press();
    check('28.9 a customer stuck on a date keeps it, even when that makes a day of one', dayOfCust(stuck.id) === '2026-12-04', dayOfCust(stuck.id));
  }
  /* the split inside a day */
  {
    const mk = function(n, town, tag){ const a = []; for(let i = 0; i < n; i++) a.push({id: tag + i, name: tag + i, address: i + ' St', city: town}); return a; };
    H.setNow(TODAY); H.load([], {});
    const d14 = {id: 't1', base: 40, cascade: 0, pin: null, houses: mk(9, 'Lehi', 'a').concat(mk(5, 'Orem', 'b'))};
    H.setSeason([d14]);
    const s14 = H.api.dayCrewHouses(d14).map(function(c){ return c.length; }).filter(Boolean);
    check('28.10 fourteen houses in two towns is ONE crew holding all fourteen, not seven-ish and seven-ish', s14.length === 1 && s14[0] === 14, s14.join('/'));
    const d23 = {id: 't2', base: 41, cascade: 0, pin: null, houses: mk(17, 'Lehi', 'c').concat(mk(6, 'Provo', 'd'))};
    H.setSeason([d23]);
    const s23 = H.api.dayCrewHouses(d23).map(function(c){ return c.length; }).filter(Boolean).sort(function(x, y){ return x - y; });
    check('28.11 twenty-three houses split seventeen and six is re-divided so both crews have ten or more', s23.length === 2 && s23[0] >= 10 && s23[0] + s23[1] === 23, s23.join('/'));
  }
}
/* ======================================================================================= */
suite('SCH-134 October is filled with the people who don\'t care when, before November is');
{
  /* Dax, 2026-10-15: "we currently have people for normal schedule in november but we are like out of houses for October
     so we need to fill those up with people who dont care when first". Mid-October, the real press: no Normal Schedule
     house may wait in November while an October day could take it, or an October date stands empty that it may use. */
  const OCT15 = new Date(2026, 9, 15, 7, 0);
  [[420, 341, false], [300, 342, true], [520, 343, false]].forEach(function(spec, k){
    const book = makeBook(spec[0], spec[1], {far: spec[2]});
    H.setNow(OCT15); H.load(book, {}); H.press();
    H.load(book, {season: H.season()}); H.press();
    const startStr = '2026-10-01';
    const today = H.api.scheduleTodayStr();
    const custOf = function(h){ const c = H.api.planCustomerFor(h); return (c && c.data) || {}; };
    const days = daysOf();
    const open = function(x){ return x.ds > today && !H.api.routeDayIsLocked(x.ds) && !x.day.printedAt && !x.day.isFixRoute && !x.day.isTakedown; };
    const octOpen = days.filter(function(x){ return open(x) && x.ds <= '2026-10-31'; });
    const waiting = [];
    days.filter(function(x){ return open(x) && x.ds > '2026-10-31'; }).forEach(function(x){
      (x.day.houses || []).forEach(function(h){
        if(h.done || h.isFix || h.isTakedown || String(h.stuck || '').trim() || H.api.houseDeadline(h)) return;
        const legal = octOpen.length ? octOpen.some(function(o){ return H.api.houseMayGoOn(h, custOf(h), o.ds, startStr).ok; }) : true;
        if(!legal) return;
        /* ⛔ unless taking them off strands somebody left behind on that day — the five-mile rule outranks this */
        const keep = x.day.houses.slice(), before = H.api.dayHoldsWithHouses(x.day, []);
        x.day.houses = keep.filter(function(o){ return o !== h; });
        const after = H.api.dayHoldsWithHouses(x.day, []);
        x.day.houses = keep;
        if(x.day.houses.filter(function(o){ return !o.done; }).length > 1 && before && !after) return;
        waiting.push({h: h, ds: x.ds});
      });
    });
    const couldJoin = waiting.filter(function(w){
      return octOpen.some(function(o){
        const n = (o.day.houses || []).filter(function(h){ return !h.done; }).length;
        return n < 40 && H.api.houseMayGoOn(w.h, custOf(w.h), o.ds, startStr).ok && H.api.dayHoldsWithHouse(o.day, w.h);
      });
    });
    check('29.' + k + 'a book ' + spec[1] + ': no Normal Schedule house waits in November when an October day could take it',
      couldJoin.length === 0, couldJoin.slice(0, 5).map(function(w){ return (w.h.name || w.h.id) + ' ' + w.ds; }).join(' | '));
    const taken = new Set(days.map(function(x){ return x.ds; }));
    const emptyOct = [];
    for(let d = 16; d <= 31; d++){
      const dt = new Date(2026, 9, d), ds = H.api.isoOf(dt);
      if(!H.api.isWorkingDay(dt) || taken.has(ds) || ds <= today || H.api.routeDayIsLocked(ds)) continue;
      /* [[SCH-140]] where SCH-134 meets SCH-128: a date is only owed to them when a crew's worth (ten) of the waiting
         houses that may go on it hold together within five miles — a date opened for one or two scattered houses is
         exactly the one-house October day SCH-128 forbids */
      const legalHere = waiting.filter(function(w){ return H.api.houseMayGoOn(w.h, custOf(w.h), ds, startStr).ok; });
      const crewsWorth = legalHere.some(function(seed){
        const group = {houses: [seed.h]};
        legalHere.forEach(function(w){ if(w !== seed && group.houses.length < 20 && H.api.dayHoldsWithHouse(group, w.h)) group.houses.push(w.h); });
        return group.houses.length >= 10;
      });
      if(crewsWorth) emptyOct.push(ds);
    }
    check('29.' + k + 'b book ' + spec[1] + ': and no October working date stands empty while one of them could go on it',
      emptyOct.length === 0 || waiting.length === 0, emptyOct.join(',') + ' with ' + waiting.length + ' waiting');
    const v = H.api.validateSeasonPlan({});
    check('29.' + k + 'c book ' + spec[1] + ': every placement rule still holds (month, deadline, away, nobody lost)', v.length === 0, JSON.stringify(v.slice(0, 2)));
    const lateOct = book.filter(function(b){ return b.data.installPreference === 'October' && dayOfCust(b.id) > '2026-10-31'; });
    check('29.' + k + 'd book ' + spec[1] + ': nobody who asked for October was pushed into November to make room', lateOct.length === 0, String(lateOct.length));
    const novInOct = book.filter(function(b){ return /^(November|11\/9)/.test(b.data.installPreference) && dayOfCust(b.id) && dayOfCust(b.id) <= '2026-10-31'; });
    check('29.' + k + 'e book ' + spec[1] + ': and nobody who asked for November or a later day was pulled into October', novInOct.length === 0, String(novInOct.length));
  });
}
/* ======================================================================================= */
module.exports = {extractFn, lift, admin, check, suite, sandbox, liftDeep};
if(require.main === module){
  process.on('exit', function(){
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if(failed){ console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
  });
}
