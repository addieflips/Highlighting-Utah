/* schedule-v2.harness.js — the REAL Recalculate everything, run offline.
 *
 * Used by schedule-v2.test.js (and nothing else). It lifts rebuildSeasonDays out of
 * admin.html together with every scheduling function and constant it reaches — ~300 of them,
 * found by following names through the real file, never listed by hand — and cuts the walk
 * only at the SCREEN and the DATABASE: drawing, toasts, saving the plan, Firebase. Those are
 * replaced by no-ops, because what is under test is where each house ENDS UP, and none of the
 * cut functions decides that.
 *
 * ⚠ The only other things supplied are the ones a real page gets from outside the scheduler:
 * the customer book (jobAddresses and its id / number / phone indexes), "today", the forecast
 * table, the crews, and js/grid.js's planBlocks (imported as an ES module in the page).
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function makeHarness(liftDeep){
  /* The boundary: anything that draws, saves, fetches or talks to Firebase. */
  const CUT = new Set(('renderAll scheduleSave saveNow mirrorStampsSoon syncInstallStampsFromSchedule toast ' +
    'renderStats renderSeasonBar renderDayList renderActive renderDayMaps renderPanelInto renderSearchIn renderSearch ' +
    'renderOneMan renderWaitingRsvp renderOwesLastYear renderPrinting renderTakedownBar renderCrewBar renderLeftovers ' +
    'renderImportedAt paintForecastNote renderFixTray dayMapDraw dayMapPanes routePictureHTML dayMapPaneAt ' +
    'loadSeasonForecast loadSeasonNormals ensureForecastForPanel firebaseConfig app db PLAN_REF ' +
    'stopHTML weekGuideHTML dayCrewLimitControlHTML dayForecastChips refreshTownGrids').split(/\s+/));
  const L = liftDeep(['rebuildSeasonDays', 'sweepGoneDaysForward', 'pullBackPastDeadline', 'generateAllRoutes', 'crewHousesFor',
    'installDays', 'dayCrewHouses', 'crewIndexes', 'houseMayGoOn', 'houseDateWindow', 'houseInstallPriority',
    'nextInstallDayFor', 'placeConfirmedLeftOff', 'confirmedNotOnAnyDay', 'enforceInstallTiming',
    'houseFromCustomer', 'planCustomerFor', 'dayDate', 'isoOf', 'computeDates', 'seasonAimPoints',
    'isOneManDay', 'dayCrewCount', 'houseGeoPoint', 'tourMiles', 'haversine',
    'advancePriorityHouses', 'placeJoinedHouses', 'validateSeasonPlan', 'lockedDaySnapshot', 'placementReasons',
    'houseSchedulingProfile', 'bestEarlierDayFor', 'milesFromDay', 'generateDayRoutes', 'INVARIANT_NAMES', 'PRIORITY_CLASS_LABELS',
    'dropHousesWhoLeftSeason', 'isOffTheSchedule', 'isWaitingOnColorChange', 'installStampDiffs',
    'syncHousesFromCustomers', 'rehomeMovedHouses', 'placeUnscheduledOnNextDay', 'takedownsNoLongerOwed', 'rebuildTakedownDays', 'routeDayIsLocked',
    'refreshLockedDates', 'freezePrintedDays', 'frozenCrewSplit', 'PRINTED_OVERRIDE', 'LOCKED_DATES',
    'takeOffPrintedDay', 'unbuiltNewHangOnPrintedDay', 'PRINTED_UNBUILT_OFF',
    'hangDayOn', 'HANG_DAY', 'scheduleTodayStr', 'markDoneHousesHidden', 'houseIsHiddenDone', 'isInWarehouse', 'isWaitingOnTimer'],
    {provided: Array.from(CUT)});

  const gridSrc = fs.readFileSync(path.join(__dirname, 'js', 'grid.js'), 'utf8')
    .replace(/^export\s+/gm, '');
  /* js/money.js is imported by the page as a module; the season rule (arrears) reads it. */
  const moneySrc = fs.readFileSync(path.join(__dirname, 'js', 'money.js'), 'utf8')
    .replace(/^export\s+/gm, '').replace(/^import[^;]+;/gm, '');

  const stubs = Array.from(CUT).map(n => 'function ' + n + '(){ return undefined; }').join('\n')
    .replace('function firebaseConfig(){ return undefined; }', 'var firebaseConfig = {};')
    .replace('function app(){ return undefined; }', 'var app = null;')
    .replace('function db(){ return undefined; }', 'var db = null;');

  const pre = [
    '"use strict";',
    'var window = {}; var document = {getElementById: function(){ return null; }};',
    /* "today" is read by `new Date()` in several places; the harness pins it. */
    'var __RealDate = globalThis.Date; var __NOW = null;',
    'function __D(){ if(!(this instanceof __D)) return new __RealDate(__NOW || __RealDate.now()).toString();',
    '  var a = Array.prototype.slice.call(arguments);',
    '  if(a.length === 0) return new __RealDate(__NOW || __RealDate.now());',
    '  return new (Function.prototype.bind.apply(__RealDate, [null].concat(a)))(); }',
    '__D.prototype = __RealDate.prototype; __D.now = function(){ return __NOW || __RealDate.now(); };',
    '__D.UTC = __RealDate.UTC; __D.parse = __RealDate.parse;',
    'var Date = __D;',
    'function serverTimestamp(){ return null; }',
    gridSrc.replace(/^import[^;]+;/gm, ''),
    moneySrc,
    'var gridPlanBlocks = planBlocks;',
    stubs
  ].join('\n');

  const post = [
    /* the Mountain clock is pinned to the same "today" */
    'window.scheduleHangDay = function(r){ return hangDayOn(r); };',
    'mtnNowParts = function(){ var d = new __RealDate(__NOW); return {date: toDateStr(d), hour: 7, minute: 0}; };',
    'return {',
    '  setNow: function(d){ __NOW = d.getTime(); },',
    '  load: function(book, opts){',
    '    opts = opts || {};',
    '    jobAddresses = book;',
    '    custById = new Map(); custByNumber = new Map(); custByPhoneDigits = new Map();',
    '    book.forEach(function(c){ custById.set(c.id, c);',
    '      var n = String((c.data || {}).customerNumber || "").trim(); if(n && !custByNumber.has(n)) custByNumber.set(n, c);',
    '      var p = String((c.data || {}).phone || "").replace(/\\D/g, ""); if(p && !custByPhoneDigits.has(p)) custByPhoneDigits.set(p, c); });',
    /* The address index the page builds in rebuildCustomerIndexes. The yard (ROUTE_HOME_ADDRESS)
       is found through it exactly as on the live page, which pins it from a record at that address. */
    '    custByAddrKey = new Map(); book.forEach(function(c){ var d = c.data || {}; if(d.address) custByAddrKey.set(custAddrKey(d.address, d.city), c); });',
    '    var yard = opts.home || {lat: 40.3866, lng: -111.8616};',
    '    custByAddrKey.set(custAddrKey(ROUTE_HOME_ADDRESS, ROUTE_HOME_CITY), {id: "__yard", data: {lat: yard.lat, lng: yard.lng}});',
    '    window.scheduleLockedDates = undefined; LOCKED_DATES = null; PRINTED_OVERRIDE = false; HANG_DAY = null;',
    '    SEASON = opts.season || []; BASE_START = new __RealDate(2026, 9, 1); globalDelta = 0;',
    '    CREWS_PER_DAY = opts.crews || 2;',
    '    CREWS = []; for(var i = 0; i < CREWS_PER_DAY; i++) CREWS.push({name: "Crew " + (i + 1), city: ""});',
    '    SEASON_FORECAST = {at: 1, byTown: opts.forecast || {}, towns: 0, days: 0, error: "", pending: null};',
    '    if(opts.nearby) NEARBY_TOWN_LIST = opts.nearby;',
    '    if(typeof quotesCache !== "undefined") quotesCache = [];',
    '    if(typeof invoiceById !== "undefined") invoiceById = new Map();',
    '  },',
    '  recalc: function(){ var lb = lockedDaySnapshot(); var r = rebuildSeasonDays(); computeDates(); var g = generateAllRoutes({lockedBefore: lb}); computeDates(); return {r: r, g: g}; },',
    '  sync: function(){ return enforceInstallTiming(); },',
    /* The REAL press, step for step as runRecalculateEverything runs it (customer sync first, takedowns before routes). */
    '  press: function(all){ PRINTED_OVERRIDE = !!all; refreshLockedDates(); freezePrintedDays(); markDoneHousesHidden(mtnNowParts().date); var lb = lockedDaySnapshot(); var pulled = syncHousesFromCustomers(); var r = rebuildSeasonDays(); try{ rebuildTakedownDays(); }catch(e){} computeDates(); var g = generateAllRoutes({lockedBefore: lb}); computeDates(); PRINTED_OVERRIDE = false; refreshLockedDates(); freezePrintedDays(); return {r: r, g: g, lb: lb}; },',
    /* The five-minute sync, step for step as window.scheduleSyncFromCustomers runs it. */
    '  tick: function(){ refreshLockedDates(); freezePrintedDays(); var moved = syncHousesFromCustomers(); var out = {}; out.left = dropHousesWhoLeftSeason(); out.goneDays = sweepGoneDaysForward(); out.rehome = rehomeMovedHouses(moved.filter(function(c){ return c.field==="town"; }).map(function(c){ return c.id; })); out.rejoin = placeUnscheduledOnNextDay(); out.joined = placeJoinedHouses(); out.prio = advancePriorityHouses(); out.timing = enforceInstallTiming(); computeDates(); out.routes = generateAllRoutes(); computeDates(); return out; },',
    '  season: function(){ return SEASON; },',
    '  unbuiltOff: function(){ return PRINTED_UNBUILT_OFF; },',
    '  setSeason: function(s){ SEASON = s; computeDates(); },',
    '  api: {installDays: installDays, dayDate: dayDate, isoOf: isoOf, crewHousesFor: crewHousesFor,',
    '        crewIndexes: crewIndexes, planCustomerFor: planCustomerFor, houseMayGoOn: houseMayGoOn,',
    '        houseDateWindow: houseDateWindow, houseInstallPriority: houseInstallPriority,',
    '        routeDayIsLocked: routeDayIsLocked, isOneManDay: isOneManDay, dayCrewCount: dayCrewCount,',
    '        houseGeoPoint: houseGeoPoint, haversine: haversine, seasonStartDate: seasonStartDate,',
    '        isOutForSeason: isOutForSeason, seasonBadgeKey: seasonBadgeKey, nextInstallDayFor: nextInstallDayFor,',
    '        placeConfirmedLeftOff: placeConfirmedLeftOff, confirmedNotOnAnyDay: confirmedNotOnAnyDay,',
    '        computeDates: computeDates, routeHomePoint: routeHomePoint,',
    '        advancePriorityHouses: advancePriorityHouses, placeJoinedHouses: placeJoinedHouses,',
    '        validateSeasonPlan: validateSeasonPlan, lockedDaySnapshot: lockedDaySnapshot, placementReasons: placementReasons,',
    '        houseSchedulingProfile: houseSchedulingProfile, bestEarlierDayFor: bestEarlierDayFor, milesFromDay: milesFromDay,',
    '        pullBackPastDeadline: pullBackPastDeadline, generateDayRoutes: generateDayRoutes, INVARIANT_NAMES: INVARIANT_NAMES,',
    '        dropHousesWhoLeftSeason: dropHousesWhoLeftSeason, isOffTheSchedule: isOffTheSchedule, installStampDiffs: installStampDiffs,',
    '        sweepGoneDaysForward: sweepGoneDaysForward, scheduleTodayStr: scheduleTodayStr, hangDayOn: hangDayOn,',
    '        setHangDay: function(h){ HANG_DAY = h; }, dayCrewHouses: dayCrewHouses, isInWarehouse: isInWarehouse,',
    '        refreshLockedDates: refreshLockedDates, markDoneHousesHidden: markDoneHousesHidden}',
    '};'
  ].join('\n');

  return new Function(pre + '\n' + L.code + '\n' + post)();
};
