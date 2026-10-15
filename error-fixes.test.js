/* error-fixes.test.js — THE 14 OCTOBER READ OF THE ERRORS FOLDER (2026-10-14).
 *
 * Its own file per R-018. `npm run test:errorfixes`.
 *
 * Addie pasted the Admin Errors badge and asked for each to be checked. Five code changes came out of it, and every
 * claim below is RUN against the code lifted out of admin.html rather than matched in its text — except the two that
 * are wiring and say so.
 *
 *   1. dayDate never answers undefined for a day that has a base or a pin. Both "Fix placement failed … 'getDay'"
 *      (9 Oct) and "[HU] recalculate failed … 'getFullYear'" (13 Oct) were a day read before computeDates dated it.
 *   2. planSaveRunaway names a plan that saves itself over and over, once, and never stops a save — the instrument
 *      for the 1 AM "maximum bandwidth for writes" refusal, whose cause is not proven.
 *   3. A map-key swap forgets EVERY map built on the refused library ("setMap: not an instance of Map").
 *   4. One year of past weather failing is a warning, not an Admin Error; all of them failing still is one.
 *   5. A console.error carrying an Error now names the function and line it came from.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; fails.push(name + (why ? ' — ' + why : '')); console.log('  FAIL  ' + name + (why ? ' — ' + why : '')); }
}
function suite(t) { console.log('\n=== ' + t + ' ==='); }

function extractFrom(src, opener) {
  const i = src.indexOf(opener);
  if (i === -1) throw new Error('could not find ' + opener);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('could not find the end of ' + opener);
}
const fn = name => extractFrom(admin, 'function ' + name + '(');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

/* ---------------------------------------------------------------------------- */
suite('1. A day always has a date');
{
  /* The schedule widget's own addDays, not the one 50,000 lines above it with a different signature. */
  const src = [
    extractFrom(admin, 'function addDays(dt,n){'),
    fn('startFor'), fn('deltaFor'), fn('desired'), fn('dayDate')
  ].join('\n');
  const api = new Function('BASE_START', 'TAKE_BASE_START', 'globalDelta', 'takeDelta',
    src + '\nreturn {dayDate: dayDate};')(new Date(2026, 9, 1), new Date(2027, 0, 4), 0, 0);
  const iso = d => d && (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));

  const dated = new Date(2026, 9, 7);
  check('a day computeDates has dated keeps that date', api.dayDate({base: 0, cascade: 0, _date: dated}) === dated);
  check('a NEW day with no _date yet is dated from its base, not undefined',
    iso(api.dayDate({id: 'rb0', base: 12, cascade: 0, pin: null, houses: []})) === '2026-10-13',
    'got ' + iso(api.dayDate({id: 'rb0', base: 12, cascade: 0, pin: null, houses: []})));
  check('its cascade counts, exactly as computeDates would start from',
    iso(api.dayDate({base: 12, cascade: 2, pin: null})) === '2026-10-15');
  check('a pinned day with no _date answers its pin',
    iso(api.dayDate({base: 0, cascade: 0, pin: new Date(2026, 10, 3)})) === '2026-11-03');
  check('a takedown is dated off the takedown season, not the install one',
    iso(api.dayDate({base: 1, cascade: 0, pin: null, isTakedown: true})) === '2027-01-05');
  check('the date it works out is not written back — computeDates still settles collisions and days off',
    (function () { const d = {base: 3, cascade: 0, pin: null}; api.dayDate(d); return !('_date' in d); })());
  check('nothing to go on is still undefined, never an invented date',
    api.dayDate({id: 'x'}) === undefined && api.dayDate(null) === undefined);
}

/* ---------------------------------------------------------------------------- */
suite('2. A plan that saves itself over and over is said once');
{
  const decl = admin.match(/const PLAN_RUNAWAY_SAVES=(\d+), PLAN_RUNAWAY_MS=(\d+);/);
  check('the two limits are declared where the widget reads them', !!decl);
  const N = decl ? Number(decl[1]) : 30, MS = decl ? Number(decl[2]) : 60000;
  check('the limit is well above anybody ticking a list (at least 20 a minute)', N >= 20 && MS === 60000,
    'got ' + N + ' in ' + MS + ' ms');
  const logged = [];
  const make = () => new Function('console',
    'const PLAN_RUNAWAY_SAVES=' + N + ', PLAN_RUNAWAY_MS=' + MS + ';\nlet planSaveTimes=[], planRunawayTold=false;\n' +
    fn('planSaveRunaway') + '\nreturn planSaveRunaway;')({error: function () { logged.push([].join.call(arguments, ' ')); }});

  let run = make(), t = 0, fired = 0;
  for (let i = 0; i < N - 1; i++) { if (run(t, {a: 1})) fired++; t += 1000; }
  check('one short of the limit inside a minute says nothing', fired === 0 && logged.length === 0);
  if (run(t, {a: 1})) fired++;
  check('reaching it inside a minute files one error', fired === 1 && logged.length === 1);
  check('and the line names the count and the size', /saved itself \d+ times in one minute \(\d+ KB each\)/.test(logged[0] || ''),
    logged[0]);
  for (let i = 0; i < 50; i++) { if (run(t += 500, {a: 1})) fired++; }
  check('it is said ONCE a session, however long the bouncing goes on', fired === 1 && logged.length === 1);

  logged.length = 0; run = make(); t = 0; fired = 0;
  for (let i = 0; i < N * 3; i++) { if (run(t, {a: 1})) fired++; t += Math.ceil(MS / (N - 1)) + 100; }
  check('the same number of saves spread over longer than a minute is not a runaway', fired === 0 && logged.length === 0);

  const saveNow = stripComments(extractFrom(admin, 'async function saveNow('));
  const ok = saveNow.indexOf('await setDoc(PLAN_REF(),data)'), call = saveNow.indexOf('planSaveRunaway(');
  const caught = saveNow.indexOf('catch(e)');
  check('WIRING: it is counted after a save succeeds and before the catch, so a refused save is not a "save"',
    ok !== -1 && call > ok && caught !== -1 && call < caught);
  check('WIRING: it never stands between the plan and the save — no return or throw is built on it',
    !/if\s*\(\s*planSaveRunaway/.test(saveNow) && !/planSaveRunaway\([^)]*\)\s*\)\s*return/.test(saveNow));
}

/* ---------------------------------------------------------------------------- */
suite('3. A map-key swap forgets every map on the refused library');
{
  /* WIRING, and said so: the swap reloads Google's library, which nothing here can do. What can be held is that
     every map the page builds on demand is let go in the onload that follows it. */
  const swap = stripComments(fn('rmTryOtherMapsKey'));
  const onload = swap.slice(swap.indexOf('next.onload'), swap.indexOf('next.onerror'));
  /* Bare variables only: `pane.map = new …` is the Schedule's own panes, rebuilt by scheduleMapsRebuild (checked below). */
  const builders = [];
  admin.replace(/(^|[^.\w])(\w+)\s*=\s*new google\.maps\.(?:Map|StreetViewPanorama)\(/g, function (m, pre, name) { builders.push(name); return m; });
  check('the page still builds its maps into named variables (vacuity guard)', builders.length >= 5, builders.join(', '));
  builders.forEach(function (name) {
    check('the swap lets go of ' + name, new RegExp('\\b' + name + '\\s*=\\s*null').test(onload));
  });
  check('and the Schedule\'s route-map panes are redrawn on the new library', /window\.scheduleMapsRebuild\(\)/.test(onload));
  check('and the address previews, which are kept in a table rather than one variable',
    /mapPreviewInstances\s*=\s*\{\s*\}/.test(onload));
  ['overviewMapMarkers', 'routeMapMarkers', 'rmCornerMarkers', 'rmModelLines'].forEach(function (name) {
    check('and the markers or lines in ' + name, new RegExp('\\b' + name + '\\s*=\\s*\\[\\s*\\]').test(onload));
  });
  ['let overviewMapInstance', 'let routeMapInstance', 'let mapPreviewInstances', 'let rmHomeMarker',
   'let rmCornerMarkers', 'let rmModelLines', 'let overviewMapMarkers', 'let routeMapMarkers'].forEach(function (d) {
    check('each is a let the swap may reassign: ' + d.slice(4),
      admin.indexOf(d) !== -1 || admin.indexOf(d.replace('let ', 'let rmMap = null, rmPano = null, ')) !== -1 ||
      (d === 'let rmHomeMarker' && /let rmMap = null, rmPano = null, rmHomeMarker = null;/.test(admin)));
  });
}

/* ---------------------------------------------------------------------------- */
suite('4. One year of past weather failing is a warning');
{
  const load = stripComments(fn('loadSeasonNormals'));
  check('a single year failing goes to console.warn', /console\.warn\(\s*"\[HU\] no normals for "/.test(load));
  check('and not to console.error, which files an Admin Error', !/console\.error\(\s*"\[HU\] no normals for "/.test(load));
  check('every year failing IS still an error', /if\s*\(\s*!got\s*\)\s*console\.error\(/.test(load));
}

/* ---------------------------------------------------------------------------- */
suite('5. A reported Error names where it came from');
{
  const head = admin.slice(0, admin.indexOf('<!-- LOGIN -->'));
  const wrap = head.slice(head.indexOf('console.error = function(){'), head.indexOf('window.errCatchToggle'));
  const where = extractFrom(head, 'function rejectionWhere(');
  const filed = [];
  const origError = function () {};
  const install = new Function('add', 'origError', 'console',
    where + '\n' + wrap.replace('console.error = function(){', 'return function(){'));
  const fake = install(function (t) { filed.push(t); }, origError, {});
  const err = new Error("Cannot read properties of undefined (reading 'getFullYear')");
  err.stack = "TypeError: Cannot read properties of undefined (reading 'getFullYear')\n" +
    '    at isoOf (https://www.gstatic.com/firebasejs/x.js:1:2)\n' +
    '    at rebuildSeasonDays (https://highlighting-utah.netlify.app/admin.html:79101:9)\n' +
    '    at runRecalculateEverything (https://highlighting-utah.netlify.app/admin.html:83010:3)';
  fake('[HU] recalculate failed', err);
  check('the filed line still carries the message', /recalculate failed Cannot read properties/.test(filed[0] || ''), filed[0]);
  check('and names our first frame, skipping Firebase\'s own', /at rebuildSeasonDays admin\.html:79101/.test(filed[0] || ''), filed[0]);
  fake('[HU] plain words only');
  check('a line with no Error in it is filed exactly as before', filed[1] === '[HU] plain words only', filed[1]);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n- ' + fails.join('\n- ')); process.exit(1); }
