/* fix-route.test.js — THE FIX LIST IS A ROUTE ([[FIX-10]], 2026-10-15).
 *
 * Its own file per R-018. `npm run test:fixroute`.
 *
 * Dax: "make it so the fix it list also has a route finder where when you add someone to the fix it list it
 * automatically updates the route and puts them in wherever they fit best". Every claim is RUN against
 * fixRouteItems lifted out of admin.html, with the real reorderFlatStops / tourMiles / haversine:
 *
 *   1. a new fix is slotted into the saved order where it adds the fewest miles — the stops already there keep their order
 *   2. a fix that is done leaves the route; the rest keep their order
 *   3. a fix with no map pin rides on the end
 *   4. "Re-plan the whole route" orders it from scratch, yard to yard, and is never longer than the slotted order
 *   5. the order is saved with the plan (serialize / hydrate) and a change asks for a save
 *   6. the tray draws in route order with stop numbers and has the re-plan button wired
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

/* a little valley: the yard, and houses east of it at known spots */
const HOME = {lat: 40.39, lng: -111.86};
function mk(id, lat, lng, raised) { return {id: id, data: {name: id, needsFix: true, lat: lat, lng: lng, fixRaisedAt: new Date(2026, 9, raised)}}; }

function build(book) {
  const src = [fn('houseGeoPoint'), fn('haversine'), fn('tourMiles'), fn('reorderFlatStops'), fn('twoOptImprove'), fn('orOptImprove'), fn('openFixItems'),
    fn('fixPointOf'), fn('fixRouteItems'), fn('fixRouteMiles'), fn('fixMapRoutes')].join('\n');
  const saves = {n: 0};
  const api = new Function('jobAddresses', 'routeHomePoint', 'scheduleSave', 'loaded', 'toJsDate', 'saidNoOrBackNextYear',
    'var FIX_ORDER = [];\n' + src + '\nreturn {fixRouteItems: fixRouteItems, fixRouteMiles: fixRouteMiles, fixMapRoutes: fixMapRoutes, ' +
    'get order(){ return FIX_ORDER; }, set order(v){ FIX_ORDER = v; }};')(
    book, function () { return HOME; }, function () { saves.n++; }, true, function (t) { return t instanceof Date ? t : null; },
    function (d) { return d.rsvpStatus === 'no'; });
  return {api: api, saves: saves};
}
const ids = list => list.map(a => a.id).join(',');

suite('1. A new fix goes where it fits best');
{
  /* a loop out of the yard: north-west, north-east, south-east, south-west — and a new one between the first two */
  const book = [mk('A', 40.45, -111.80, 1), mk('B', 40.45, -111.70, 2), mk('C', 40.33, -111.70, 3), mk('D', 40.33, -111.80, 4)];
  const t = build(book);
  t.api.order = ['A', 'B', 'C', 'D'];
  book.push(mk('N', 40.452, -111.75, 10));
  const r = t.api.fixRouteItems();
  check('the new fix is slotted between the two it sits between', ids(r) === 'A,N,B,C,D', ids(r));
  check('and the order is kept for next time', t.api.order.join(',') === 'A,N,B,C,D', t.api.order.join(','));
  check('a change asks for the plan to be saved', t.saves.n === 1, String(t.saves.n));
  t.api.fixRouteItems();
  check('drawing it again with nothing new changes nothing and saves nothing', t.saves.n === 1 && t.api.order.join(',') === 'A,N,B,C,D', t.saves.n + ' ' + t.api.order.join(','));
  /* the stops already there keep their order, even when that order is not the shortest */
  const t2 = build([mk('A', 40.39, -111.80, 1), mk('B', 40.39, -111.70, 2), mk('C', 40.39, -111.60, 3)]);
  t2.api.order = ['C', 'A', 'B'];
  const r2 = t2.api.fixRouteItems();
  check('a saved order is honoured as it is — nothing already on the route is reshuffled', ids(r2) === 'C,A,B', ids(r2));
}

suite('2. A done fix leaves the route');
{
  const book = [mk('A', 40.39, -111.80, 1), mk('B', 40.39, -111.70, 2), mk('C', 40.39, -111.60, 3)];
  const t = build(book);
  t.api.order = ['A', 'B', 'C'];
  book[1].data.needsFix = false;
  check('done fix B is gone and A, C keep their order', ids(t.api.fixRouteItems()) === 'A,C');
  const t2 = build([mk('A', 40.39, -111.80, 1), Object.assign(mk('X', 40.39, -111.75, 2), {}), mk('C', 40.39, -111.60, 3)]);
  t2.api.order = ['A', 'X', 'C'];
  t2.api.fixRouteItems.length;
  const out = build([mk('A', 40.39, -111.80, 1), mk('C', 40.39, -111.60, 3)].concat([{id: 'S', data: {name: 'S', needsFix: true, rsvpStatus: 'no', lat: 40.39, lng: -111.7, fixRaisedAt: new Date(2026, 9, 2)}}]));
  check('somebody sitting the season out is not on the route (openFixItems rule)', ids(out.api.fixRouteItems()).indexOf('S') === -1);
}

suite('3. No pin, on the end');
{
  const book = [mk('A', 40.39, -111.80, 1), {id: 'P', data: {name: 'P', needsFix: true, fixRaisedAt: new Date(2026, 9, 0)}}, mk('B', 40.39, -111.70, 2)];
  const t = build(book);
  const r = t.api.fixRouteItems();
  check('the fix with no map pin is last, whatever its age', ids(r).split(',').pop() === 'P', ids(r));
  check('and it is not counted in the miles', Math.abs(t.api.fixRouteMiles(r) - t.api.fixRouteMiles(r.filter(a => a.id !== 'P'))) < 1e-9);
}

suite('4. Re-plan the whole route');
{
  const book = [mk('A', 40.39, -111.80, 1), mk('B', 40.39, -111.70, 2), mk('C', 40.39, -111.60, 3), mk('D', 40.45, -111.75, 4)];
  const t = build(book);
  t.api.order = ['C', 'A', 'D', 'B'];
  const slotted = t.api.fixRouteMiles(t.api.fixRouteItems());
  const errs = []; const ce = console.error; console.error = function(){ errs.push([].slice.call(arguments).join(' ')); };
  const re = t.api.fixRouteItems({replan: true});
  console.error = ce;
  check('the re-plan runs the real orderer without throwing', errs.length === 0, errs.join(' | '));
  const replanned = t.api.fixRouteMiles(re);
  check('every open fix is still on it', ids(re).split(',').sort().join(',') === 'A,B,C,D', ids(re));
  check('and it is shorter than the hand-kept order', replanned < slotted - 0.01, replanned.toFixed(2) + ' vs ' + slotted.toFixed(2));
  check('and the new order is the one kept', t.api.order.join(',') === ids(re));
}

suite('5. Saved with the plan');
{
  const ser = fn('serialize'), hyd = fn('hydrate');
  check('serialize writes fixOrder', /fixOrder\s*:\s*FIX_ORDER\.slice\(\)/.test(ser));
  check('hydrate reads it back, ids only', /FIX_ORDER\s*=\s*Array\.isArray\(o\.fixOrder\)/.test(hyd));
}

suite('6. The tray');
{
  const tray = fn('renderFixTray');
  check('the tray draws the route, not the raised-date list', /const all = fixRouteItems\(\)/.test(tray));
  check('each row carries its stop number', /fixstop[\s\S]*stopNo\.get\(a\.id\)/.test(tray));
  check('the tray offers Re-plan the whole route', /data-fixreplan/.test(tray));
  check('and the button is wired to a re-plan', /t\.dataset\.fixreplan\)\{fixRouteItems\(\{replan:true\}\)/.test(admin));
  check('printing prints what the tray shows, in that order', /printFixList\(fixTrayShown\)/.test(admin) && /fixTrayShown = items/.test(tray));
}

suite('7. The map under the Fixes tab is the fix route ([[FIX-10]])');
{
  /* Dax, 2026-10-26: "the fix list router shows the map at the bottom like always but it says there are 40 houses when
     theres only 6". The tab never drew a map, so the one under it was the last Scheduling day's. */
  const book = [mk('A', 40.45, -111.80, 1), mk('B', 40.45, -111.70, 2), mk('C', 40.33, -111.70, 3),
    {id: 'N', data: {name: 'N', needsFix: true, fixRaisedAt: new Date(2026, 9, 4)}}];
  const t = build(book);
  const items = t.api.fixRouteItems();
  const routes = t.api.fixMapRoutes(items);
  check('one route, with a pin per pinned fix', routes.length === 1 && routes[0].stops.length === 3, JSON.stringify(routes.map(r => r.stops.length)));
  check('the fix with no pin is counted, not drawn', routes[0].missing === 1);
  check('the pins carry the stop numbers the list shows, in route order',
    routes[0].stops.map(s => s.n + s.title.split('. ')[1]).join(',') === items.slice(0, 3).map((a, i) => (i + 1) + a.id).join(','),
    routes[0].stops.map(s => s.title).join(' | '));
  check('no open fixes, no route', t.api.fixMapRoutes([]).length === 0);

  /* renderDayMaps RUN with handed-in routes: it draws exactly them and never asks for a day's */
  const head = {innerHTML: ''}, grid = {style: {}};
  const wrap = {style: {}, querySelector: s => (s === '.daymapgrid' ? grid : head)};
  const drawn = [];
  let dayAsked = 0, forecastAsked = 0;
  const panes = [];
  const render = new Function('dayMapWrap', 'dayMapRoutes', 'esc', 'dayMapPaneAt', 'dayMapDraw', 'routeHomePoint', 'google',
    'dayForecastChips', 'ensureForecastForPanel', 'routePictureHTML', 'dayMapPanes',
    'var lastMappedDay = null, lastMappedOpts = null;\n' + fn('renderDayMaps') + '\nreturn renderDayMaps;')(
    () => wrap, () => { dayAsked++; return []; }, x => String(x),
    (w, i) => (panes[i] = panes[i] || {box: {style: {}}, hd: {innerHTML: ''}}), (pane, r) => drawn.push(r), () => HOME,
    {maps: {Map: function () {}}}, () => '', () => { forecastAsked++; }, () => '', []);
  render(null, {routes: routes, title: 'The fix route — 4 open fixes'});
  check('the map draws the fix route it was handed', drawn.length === 1 && drawn[0] === routes[0]);
  check('and never a day’s route or forecast', dayAsked === 0 && forecastAsked === 0);
  check('the heading says it is the fix route', /fix route/.test(head.innerHTML) && wrap.style.display === '', head.innerHTML);
  const hd = panes[0] ? panes[0].hd.innerHTML : '(no pane drawn)';
  check('the pane says how many stops — not a day’s 40', /3 stops/.test(hd) && /1 not on the map/.test(hd), hd);
  render(null, null);
  check('with no fixes the map is taken down, not left showing a day', wrap.style.display === 'none');

  const tray = fn('renderFixTray');
  /* anchored on the start of its own line, so a guard put in front of it (if(0)…) fails rather than reading as present */
  check('the tray draws the fix route on the map every time it draws',
    /\n[ \t]*try\{ renderDayMaps\(null, all\.length \? \{routes: fixMapRoutes\(all\)/.test(tray));
  check('and before the no-fixes return, so an empty list also takes the old map down',
    tray.indexOf('renderDayMaps(') !== -1 && tray.indexOf('renderDayMaps(') < tray.indexOf('if(!all.length)'));
  check('a map-key swap redraws the fix route too', /renderDayMaps\(lastMappedDay, lastMappedOpts\)/.test(admin));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
