/* schedule-chaos.test.js — EVERY BUTTON THE OFFICE HAS, PRESSED AT RANDOM, FOR A WHOLE SEASON ([[SCH-140]], 2026-10-18).
 *
 * Its own file per R-018. `npm run test:chaos`, and its own named step in CI.
 *
 * Dax: "look at the schedule and run through every single rule, you will find multiple of them are broken figure out
 * why … run simulations where you can even change any and everything and figure out exactly why things keep breaking
 * and where its happening and ensure it never happens again".
 *
 * schedule-season.test.js plays a season the way the CREWS live it: customers join and leave, the warehouse holds
 * people, the crews miss houses, somebody presses Recalculate. Every rule held there — and the live plan was still
 * broken, because the office does far more than press Recalculate. It prints sheets days ahead, checks a crew for
 * tomorrow, marks single customers for tomorrow, moves houses by hand, pulls and pushes days, takes a day off, forces
 * a date, sets a day to one crew or one man, tells the schedule the crews are behind, moves the season start, unticks
 * a house it ticked by mistake, and edits customers' away dates, earliest dates, wanted windows and pins. None of that
 * was ever simulated. This file does all of it, at random, through the REAL code (schedule-v2.harness.js lifts it out
 * of admin.html — nothing here is a copy), and after every single action checks the rules that action could break.
 *
 * Every failure names the rule, the day, the house and THE ACTION THAT CAUSED IT, so a red run says where to look.
 *
 * ⛔ IF THIS GOES RED, FIX THE CHANGE, NEVER THE SIMULATION. Seeds are fixed so a red run is reproducible.
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
function loadLifter(){
  const src = fs.readFileSync(path.join(ROOT, 'schedule-v2.test.js'), 'utf8');
  const cut = src.indexOf('let H = null;');
  if(cut < 0) return null;
  const m = {exports: {}};
  const log = console.log; console.log = function(){};
  try{ new Function('require', 'module', '__dirname', src.slice(0, cut) + '\nmodule.exports = {liftDeep: liftDeep};')(require, m, ROOT); }
  finally{ console.log = log; }
  return m.exports.liftDeep || null;
}
const liftDeep = loadLifter();
/* the five-mile hop and the one-man limit are read from admin.html, never typed here, so the check follows the code */
const ADMIN_SRC = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const HOP = Number((ADMIN_SRC.match(/const MAX_CREW_HOP_MILES = (\d+(?:\.\d+)?);/) || [])[1]);
const ONE_MAN = Number((ADMIN_SRC.match(/const ONE_MAN_MAX_HOUSES = (\d+);/) || [])[1]);
if(!(HOP > 0) || !(ONE_MAN > 0)) throw new Error('could not read MAX_CREW_HOP_MILES / ONE_MAN_MAX_HOUSES from admin.html');
suite('The harness');
check('the lifter was found in schedule-v2.test.js', !!liftDeep);
let H = null;
if(liftDeep){
  const log = console.log, err = console.error, warn = console.warn;
  console.log = function(){}; console.error = function(){}; console.warn = function(){};
  try{ H = require('./schedule-v2.harness.js')(liftDeep); }catch(e){ H = null; console.log = log; console.log(e); }
  finally{ console.log = log; console.error = err; console.warn = warn; }
}
check('the real schedule was lifted out of admin.html', !!H);

const TOWNS = {'Lehi': [40.3916, -111.8508], 'American Fork': [40.3769, -111.7958], 'Pleasant Grove': [40.3641, -111.7385],
  'Lindon': [40.3433, -111.7208], 'Orem': [40.2969, -111.6946], 'Provo': [40.2338, -111.6585], 'Saratoga Springs': [40.3491, -111.9043],
  'Eagle Mountain': [40.3141, -112.0069], 'Highland': [40.4250, -111.7955], 'Alpine': [40.4533, -111.7780], 'Draper': [40.5247, -111.8638],
  'Herriman': [40.5141, -112.0330], 'South Jordan': [40.5622, -111.9297], 'Riverton': [40.5219, -111.9391], 'Sandy': [40.5649, -111.8389],
  'Springville': [40.1652, -111.6108], 'Spanish Fork': [40.1149, -111.6549], 'Vineyard': [40.2974, -111.7466], 'Salem': [40.0530, -111.6735],
  'Cedar Hills': [40.4141, -111.7586]};
function rng(seed){ let x = seed >>> 0 || 1; return function(){ x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const YES = {rsvpStatus: 'yes', rsvpRespondedAt: {toMillis: function(){ return new Date(2026, 8, 1).getTime(); }}};
function makeBook(seed, n, tag){
  const r = rng(seed), names = Object.keys(TOWNS), wts = names.map(function(x, i){ return i < 6 ? 3 : 1; });
  const tot = wts.reduce(function(a, b){ return a + b; }, 0);
  const pick = function(){ let u = r() * tot; for(let i = 0; i < names.length; i++){ u -= wts[i]; if(u < 0) return names[i]; } return names[0]; };
  const out = [];
  for(let i = 0; i < n; i++){
    const town = pick(), c = TOWNS[town], u = r();
    const pref = u < 0.235 ? 'October' : u < 0.435 ? 'November' : u < 0.44 ? 'November - Before Thanksgiving' : u < 0.445 ? 'After Thanksgiving' : 'Normal Schedule';
    const id = (tag || 'c') + i;
    out.push({id: id, data: Object.assign({name: 'Cust ' + id, customerNumber: String(1000 + i), city: town, address: (100 + i) + ' Test Ln',
      phone: '801555' + String(1000 + i), lat: c[0] + (r() - 0.5) * 0.05, lng: c[1] + (r() - 0.5) * 0.05, installPreference: pref}, YES)});
  }
  return out;
}
const iso = function(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const addD = function(s, n){ const p = s.split('-').map(Number); return iso(new Date(p[0], p[1] - 1, p[2] + n)); };

/* Every action the office has. Each returns a short label for the log, or '' when there was nothing to do it to. */
function makeActions(ctx){
  const r = ctx.r;
  const api = H.api;
  const live = function(h){ return !h.done && !h.hiddenDone; };
  const futureDays = function(){ const t = ctx.today(); return api.installDays().filter(function(d){ const dt = api.dayDate(d); return dt && api.isoOf(dt) > t; }); };
  const any = function(a){ return a.length ? a[Math.floor(r() * a.length)] : null; };
  const liveHouses = function(){ const out = []; futureDays().forEach(function(d){ d.houses.forEach(function(h){ if(live(h) && !h.isFix && !h.isTakedown) out.push({h: h, d: d}); }); }); return out; };
  const cust = function(h){ const c = api.planCustomerFor(h); return c && c.data; };
  return {
    printTomorrow: function(){ const d = api.tomorrowsInstallDay(); if(!d) return ''; api.markDayPrinted(d); return 'printed tomorrow ' + api.isoOf(api.dayDate(d)); },
    printAhead: function(){ const fd = futureDays().slice(2, 10); const d = any(fd); if(!d) return ''; api.markDayPrinted(d); return 'printed ahead ' + api.isoOf(api.dayDate(d)); },
    holdCrew: function(){ const d = api.tomorrowsInstallDay(); if(!d) return ''; const i = Math.floor(r() * 2); return api.setCrewHeld(d.id, i, true) ? 'checked crew ' + (i + 1) + ' for tomorrow' : ''; },
    markTomorrow: function(){ const lh = liveHouses(); let n = 0; for(let k = 0; k < 1 + Math.floor(r() * 3); k++){ const x = any(lh); if(x && api.toggleTomorrowMark(x.h.id)) n++; } return n ? 'marked ' + n + ' for tomorrow' : ''; },
    moveByHand: function(){ const x = any(liveHouses()), d = any(futureDays()); if(!x || !d || x.d === d) return ''; api.moveHouse(x.h.id, d.id); return 'moved ' + x.h.id + ' by hand to ' + api.isoOf(api.dayDate(d)); },
    pushDay: function(){ const d = any(futureDays()); if(!d) return ''; api.cascade(d.id, 1); return 'pushed ' + d.id + ' later'; },
    pullDay: function(){ const d = any(futureDays()); if(!d) return ''; api.cascade(d.id, -1); return 'pulled ' + d.id + ' earlier'; },
    dayOff: function(){ const d = any(futureDays()); if(!d) return ''; api.cascade(d.id, 1, 'Day off'); return 'day off ' + d.id; },
    forceDate: function(){
      const d = any(futureDays()); if(!d) return '';
      const to = addD(api.isoOf(api.dayDate(d)), Math.floor(r() * 7) - 3);
      return api.forceDayDateByHand(d, to).ok ? 'forced ' + d.id + ' to ' + to : '';
    },
    dayLimit: function(){ const d = any(futureDays()); if(!d) return ''; const k = any(['crew', 'man', '']); api.setDayLimitOn(api.isoOf(api.dayDate(d)), k); return 'set ' + api.isoOf(api.dayDate(d)) + ' to ' + (k || 'normal'); },
    crewsBehind: function(){ const t = ctx.real(); const back = addD(t, -(1 + Math.floor(r() * 3))); api.setHangDayByHand(back); return 'crews behind, hanging ' + back; },
    crewsCaughtUp: function(){ api.setHangDayByHand(''); return 'crews caught up'; },
    untick: function(){ const done = []; api.installDays().forEach(function(d){ d.houses.forEach(function(h){ if(h.done && !h.hiddenDone) done.push(h); }); }); const h = any(done); if(!h) return ''; h.done = false; const c = cust(h); if(c) c.completed = false; return 'unticked ' + h.id; },
    awayDates: function(){ const x = any(liveHouses()); if(!x) return ''; const c = cust(x.h); if(!c) return ''; const ds = api.isoOf(api.dayDate(x.d)); c.awayDates = [{from: addD(ds, -1), to: addD(ds, 2)}]; return 'away ' + x.h.id + ' around ' + ds; },
    notBefore: function(){ const x = any(liveHouses()); if(!x) return ''; const c = cust(x.h); if(!c) return ''; const ds = addD(api.isoOf(api.dayDate(x.d)), 3 + Math.floor(r() * 10)); c.earliestInstallDate = {toMillis: function(){ const p = ds.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); }}; return 'not before ' + ds + ' for ' + x.h.id; },
    wantWindow: function(){ const x = any(liveHouses()); if(!x) return ''; const c = cust(x.h); if(!c) return ''; const f = addD(ctx.real(), 2 + Math.floor(r() * 15)); c.wantedFrom = f; c.wantedTo = addD(f, 6); return 'wants ' + f + ' to ' + c.wantedTo + ' for ' + x.h.id; },
    stuckOnDay: function(){ const x = any(liveHouses()), d = any(futureDays()); if(!x || !d) return ''; const c = cust(x.h); if(!c) return ''; c.stuckOnDate = api.isoOf(api.dayDate(d)); return 'stuck ' + x.h.id + ' on ' + c.stuckOnDate; },
    rush: function(){ const x = any(liveHouses()); if(!x) return ''; const c = cust(x.h); if(!c) return ''; c.rushInstall = true; return 'priority ' + x.h.id; },
    seasonStart: function(){ const n = any([-2, -1, 1, 2]); api.setSeasonStartByHand(addD(api.isoOf(api.getBaseStart()), api.getGlobalDelta() + n)); return 'season start moved ' + n; }
  };
}

const TAIL0 = '2026-11-27';
function chaosSeason(cfg){
  const found = {};
  const add = function(rule, s){ (found[rule] = found[rule] || []).push(s); };
  const r = rng(cfg.seed * 131 + 9);
  const book = makeBook(cfg.seed, cfg.n);
  const byId = {}; book.forEach(function(b){ byId['cust-' + b.id] = b; });
  const api = H.api;
  let realToday = '2026-09-30';
  const ctx = {r: r, today: function(){ return api.scheduleTodayStr(); }, real: function(){ return realToday; }, staleLocks: new WeakMap()};
  const A = makeActions(ctx);
  const ds = function(d){ return api.isoOf(api.dayDate(d)); };
  const live = function(h){ return !h.done && !h.hiddenDone; };
  const T0 = function(){ return api.isoOf(api.seasonStartDate()); };
  /* the date each printed day was printed for, keyed on the day ITSELF — a rebuild reuses a freed id for a new day */
  const printedDates = new WeakMap();
  const audit = function(label, last, full){
    const today = api.scheduleTodayStr();
    const days = api.installDays();
    const seen = {};
    days.forEach(function(d){
      const x = ds(d);
      if(d.printedAt && printedDates.has(d) && printedDates.get(d) !== x && d.houses.some(live)) add('a printed day never changes its date (SCH-120)', label + ' after "' + last + '": ' + d.id + ' printed for ' + printedDates.get(d) + ' now ' + x);
      if(d.printedAt && !printedDates.has(d)) printedDates.set(d, x);
      const mine = d.houses.filter(live);
      const stuckHere = mine.some(function(h){ return String(h.stuck || '') === x; });
      if(x >= today && mine.length && !api.isWorkingDay(api.dayDate(d)) && !d.pin && !stuckHere) add('no house on a weekend or holiday unless the office forced that date', label + ' after "' + last + '": ' + x);
      mine.forEach(function(h){
        if(seen[h.id] && x >= today) add('no house is on two days', label + ' after "' + last + '": ' + h.id + ' on ' + seen[h.id] + ' and ' + x);
        seen[h.id] = x;
        if(x < today) add('a missed house never stays on a day that has passed (SCH-114/129)', label + ' after "' + last + '": ' + h.id + ' on ' + x + ' (today ' + today + ')');
        if(x >= today && !api.routeDayIsLocked(x)){
          const c = api.planCustomerFor(h);
          const m = api.houseMayGoOn(h, (c && c.data) || {}, x, T0());
          /* a deadline already missed (the crew could not reach them in time) is judged by SCH-07: the soonest day after it */
          if(!m.ok && /last day/.test(m.why)){
            const sooner = days.filter(function(o){ const y = ds(o); if(y >= x || y <= today || api.routeDayIsLocked(y) || o.printedAt || api.dayHasHeldCrew(o)) return false;
              if(o.houses.filter(live).length >= 40 || !o.houses.some(live)) return false;
              const mm = api.houseMayGoOn(h, (c && c.data) || {}, y, T0()); if(!(mm.ok || /last day/.test(mm.why))) return false;
              return api.dayHoldsWithHouses(o, [h]); })[0];
            const inside = days.filter(function(o){ const y = ds(o); return y > today && !api.routeDayIsLocked(y) && !o.printedAt && api.houseMayGoOn(h, (c && c.data) || {}, y, T0()).ok && o.houses.filter(live).length < 40; })[0];
            if(inside) add('nobody is on an open day outside their window', label + ' after "' + last + '": ' + h.id + ' ' + x + ' ' + m.why + ' while ' + ds(inside) + ' was open inside it');
            else if(sooner && full) add('a missed deadline goes to the soonest day after it, not the overflow (SCH-07)', label + ' after "' + last + '": ' + h.id + ' on ' + x + ', could have had ' + ds(sooner));
          }
          /* a pin to a day whose sheet is printed or checked cannot be honoured — the plan reports it (validateSeasonPlan) */
          else if(!m.ok && /^pinned to/.test(m.why) && String(h.stuck) <= today) add('a pin to a day that has come is spent', h.id);
          else if(!m.ok && /^pinned to/.test(m.why) && days.some(function(o){ return ds(o) === String(h.stuck) && (o.printedAt || api.dayHasHeldCrew(o)); })) add('a pin to a printed day is reported, not honoured', h.id);
          /* "Force exact date" may put a day on a weekend ("use Force exact date to place a route on a weekend") */
          else if(!m.ok && m.why === 'not a working day' && d.pin) add('a forced weekend day is the office deciding', h.id);
          else if(!m.ok) add('nobody is on an open day outside their window', label + ' after "' + last + '": ' + h.id + ' ' + x + ' ' + m.why);
          if(c && c.data && api.isOffTheSchedule(c.data) && full) add('nobody off the schedule (warehouse, cancelled) is on a day', label + ' after "' + last + '": ' + h.id + ' ' + x);
        }
      });
      if(x > today){
        if(mine.length > 40) add('no day holds more than forty', label + ' ' + x + ': ' + mine.length);
        const crews = api.crewIndexes().map(function(i){ return (api.crewHousesFor(i, d) || []).filter(live); });
        const assigned = crews.reduce(function(a, c){ return a + c.length; }, 0);
        if(assigned !== mine.length) add('every house on a day is on exactly one crew (SCH-67)', label + ' after "' + last + '": ' + x + ' ' + assigned + ' of ' + mine.length);
      }
    });
    /* the lock is the hang day, the next two days with work, printed days and checked crews — nothing else */
    const L = api.lockedDates();
    if(L){
      /* takedown days count as days with work too, once the installs run out */
      const all = H.season().filter(function(d){ return !d.isFixRoute && api.dayDate(d); });
      const work = all.filter(function(d){ return ds(d) > today && (d.houses.some(live) || d.printedAt); }).map(ds).sort()
        .filter(function(x, i, a){ return a.indexOf(x) === i; });
      const ok = {};
      work.slice(0, 2).forEach(function(x){ ok[x] = 1; });
      all.forEach(function(d){ if(d.printedAt || api.dayHasHeldCrew(d)) ok[ds(d)] = 1; });
      /* a day frozen as one of the next two keeps its lock until the start of the next press (SCH-140) — so it may be locked
         now, but it must not still be locked, without being one of the next two, after a SECOND press */
      all.forEach(function(d){
        if(!d.frozenCrews || ok[ds(d)]) return;
        ok[ds(d)] = 1;
        /* after a press it may only be one the press started out holding as one of the next two */
        if(label.indexOf('press') === 0 && !d.isTakedown && L.has(ds(d)) && !(ctx.nextAtStart && ctx.nextAtStart[ds(d)]))
          add('no day stays locked through two presses without being one of the next two (SCH-140)', label + ': ' + ds(d) + ' (' + d.id + ')');
      });
      L.forEach(function(x){ if(x > today && !ok[x]) add('only the next two days with work, printed days and checked crews are locked (SCH-106/118)', label + ' after "' + last + '": ' + x + ' locked'); });
    }
    if(!full) return;
    const conf = api.confirmedNotOnAnyDay() || [];
    conf.forEach(function(c){ add('every Confirmed customer is on a day after Recalculate (SCH-85)', label + ': ' + c.id); });
    /* SCH-128: no crew under ten when its houses could have joined another day */
    const fut = days.filter(function(d){ return ds(d) > today && d.houses.some(live); });
    fut.forEach(function(d){
      const x = ds(d);
      if(api.routeDayIsLocked(x) || x >= TAIL0) return;
      const n = d.houses.filter(live).length;
      /* [[SCH-140]] "could join" is the rule SCH-128 is coded to — foldShortCrewDays — and nothing looser: a house only joins
         a day where it is within MAX_CREW_HOP_MILES of a house already there (SCH-131), the target is not printed or checked,
         stays at or under ITS OWN limit (one man, one crew), and a day holding a pinned house is never folded. Measured
         2026-10-19: every flagged case here was an 8-9 house day "joinable" only onto a day of one or two houses more than
         five miles from all of them — the planner's crew test passes a lone house, the five-mile rule does not. */
      const hs = d.houses.filter(live);
      const ptOf = function(h){ const c = api.planCustomerFor(h); const p = api.houseGeoPoint(h, (c && c.data) || {}); return (p && typeof p.lat === 'number') ? p : null; };
      const capOf = function(y){ const lim = api.dayLimitOn(y); return lim === 'man' ? ONE_MAN : (lim === 'crew' ? 20 : 40); };
      if(n < 10 && !hs.some(function(h){ return ('' + (h.stuck || '')).trim(); })){
        const could = fut.some(function(o){ if(o === d || api.routeDayIsLocked(ds(o)) || o.printedAt || api.dayHasHeldCrew(o)) return false; if(x.slice(5) <= '10-31' && ds(o).slice(5) > '10-31') return false;
          const ol = o.houses.filter(live); if(ol.length + n > capOf(ds(o))) return false;
          if(!hs.every(function(h){ const p = ptOf(h); if(!p) return true; return ol.some(function(z){ const q = ptOf(z); return q && api.haversine(p.lat, p.lng, q.lat, q.lng) <= HOP; }); })) return false;
          return hs.every(function(h){ const c = api.planCustomerFor(h); return api.houseMayGoOn(h, (c && c.data) || {}, ds(o), T0()).ok; }) && api.dayHoldsWithHouses(o, hs); });
        if(could) add('no crew goes out under ten when its houses could join another day (SCH-128)', label + ' after "' + last + '": ' + x + ' holds ' + n + ' (' + d.id + ')');
      }
    });
    /* SCH-121/122/134: October is filled first — an October working day nobody is on, while ten or more houses that
       could legally go on it wait in November, is the empty-October-day the office saw on the live plan. */
    const novWaiting = [];
    fut.forEach(function(d){ const x = ds(d); if(x.slice(5) > '10-31' && x < TAIL0 && !api.routeDayIsLocked(x)) d.houses.filter(live).forEach(function(h){ novWaiting.push(h); }); });
    const usedDates = {}; days.forEach(function(d){ usedDates[ds(d)] = d.houses.filter(live).length; });
    for(let x = addD(today, 1); x <= '2026-10-31'; x = addD(x, 1)){
      const p = x.split('-').map(Number);
      if(!api.isWorkingDay(new Date(p[0], p[1] - 1, p[2])) || api.routeDayIsLocked(x) || usedDates[x]) continue;
      const could = novWaiting.filter(function(h){ const c = api.planCustomerFor(h); return api.houseMayGoOn(h, (c && c.data) || {}, x, T0()).ok; });
      /* a crew's worth that could work TOGETHER — within five miles of one of them (SCH-131), not ten spread over the valley */
      const pt = function(h){ const c = api.planCustomerFor(h); return api.houseGeoPoint(h, (c && c.data) || {}); };
      let bestGroup = 0;
      could.forEach(function(s){ const p = pt(s); if(!p) return; const n = could.filter(function(o){ const q = pt(o); return q && api.haversine(p.lat, p.lng, q.lat, q.lng) <= 5; }).length; if(n > bestGroup) bestGroup = n; });
      if(bestGroup >= 10) add('no October working day stands empty while ten or more houses that could go on it wait in November (SCH-134)', label + ' after "' + last + '": ' + x + ' empty, ' + could.length + ' could go');
    }
  };
  H.setNow(new Date(2026, 8, 30, 18, 0)); H.load(book, {}); H.press();
  audit('press', 'first Recalculate', true);
  const KEYS = Object.keys(A);
  let nextId = cfg.n;
  for(let day = new Date(2026, 9, 1); day < new Date(2026, 11, 24); day.setDate(day.getDate() + 1)){
    realToday = iso(day);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    H.setNow(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 7, 30));
    /* new customers and cancellations, as the season test does */
    if(!weekend && realToday < '2026-11-06' && r() < 0.5){
      const nb = makeBook(cfg.seed * 1000 + nextId, 1, 'n' + nextId)[0]; nextId++;
      nb.data.customerNumber = String(5000 + nextId); nb.data.phone = '801666' + String(1000 + nextId);
      book.push(nb); byId['cust-' + nb.id] = nb;
    }
    H.load(book, {season: H.season(), globalDelta: api.getGlobalDelta(), baseStart: api.getBaseStart()});
    let last = 'the morning sync';
    try{ H.tick(); }catch(e){ add('the sync never throws', realToday + ': ' + String(e && e.message)); }
    audit('sync ' + realToday, last, false);
    /* the office, during the day */
    const nAct = !cfg.busy ? 0 : weekend ? (r() < 0.3 ? 1 : 0) : 1 + Math.floor(r() * cfg.busy);
    for(let k = 0; k < nAct; k++){
      const key = KEYS[Math.floor(r() * KEYS.length)];
      let label = '';
      try{ label = A[key](); }catch(e){ add('no office action throws', realToday + ' ' + key + ': ' + String(e && e.message)); continue; }
      if(!label) continue;
      last = label;
      try{ api.refreshLockedDates(); }catch(e){}
      audit(realToday, label, false);
      H.load(book, {season: H.season(), globalDelta: api.getGlobalDelta(), baseStart: api.getBaseStart()});
      try{ H.tick(); }catch(e){ add('the sync never throws', realToday + ' after ' + label + ': ' + String(e && e.message)); }
      audit('sync ' + realToday, label + ' then the sync', false);
    }
    if(weekend) continue;
    /* the crews work today's sheet */
    const today = api.scheduleTodayStr();
    api.installDays().filter(function(d){ return ds(d) === today; }).forEach(function(d){
      d.houses.forEach(function(h){ if(!live(h)) return; if(r() < cfg.rate){ h.done = true; if(byId[h.id]) byId[h.id].data.completed = true; } });
    });
    H.setNow(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0));
    H.load(book, {season: H.season(), globalDelta: api.getGlobalDelta(), baseStart: api.getBaseStart()});
    const all = r() < 0.1;
    /* which days the press starts out holding as one of the next two (worked out here, touching nothing) */
    ctx.nextAtStart = {};
    (function(){ const t = api.scheduleTodayStr(); H.season().filter(function(d){ return !d.isFixRoute && api.dayDate(d) && ds(d) > t && (d.houses.some(live) || d.printedAt); })
      .map(ds).sort().filter(function(x, i, a){ return a.indexOf(x) === i; }).slice(0, 2).forEach(function(x){ ctx.nextAtStart[x] = 1; }); })();
    try{ H.press(all); }catch(e){ add('Recalculate never throws', realToday + ': ' + String(e && e.message)); }
    audit('press ' + realToday, (all ? 'Recalculate including the next two days' : 'Recalculate everything') + ' after "' + last + '"', true);
  }
  return found;
}

const RULES = [
  'no house is on two days',
  'a missed house never stays on a day that has passed (SCH-114/129)',
  'nobody is on an open day outside their window',
  'a missed deadline goes to the soonest day after it, not the overflow (SCH-07)',
  'nobody off the schedule (warehouse, cancelled) is on a day',
  'no house on a weekend or holiday unless the office forced that date',
  'no day holds more than forty',
  'every house on a day is on exactly one crew (SCH-67)',
  'only the next two days with work, printed days and checked crews are locked (SCH-106/118)',
  'no day stays locked through two presses without being one of the next two (SCH-140)',
  'a printed day never changes its date (SCH-120)',
  'every Confirmed customer is on a day after Recalculate (SCH-85)',
  'no crew goes out under ten when its houses could join another day (SCH-128)',
  'no October working day stands empty while ten or more houses that could go on it wait in November (SCH-134)',
  'the sync never throws', 'no office action throws', 'Recalculate never throws'];
const SEASONS = [
  {name: 'a quiet office — Recalculate only, the control (360 houses, crews finish 80%)', seed: 41, n: 360, rate: 0.8, busy: 0},
  {name: 'a busy office (260 houses, crews finish 85%)', seed: 7, n: 260, rate: 0.85, busy: 4},
  {name: 'a frantic office (220 houses, crews finish 65%)', seed: 19, n: 220, rate: 0.65, busy: 7}];
/* CHAOS_SEEDS=a,b,c plays extra seasons instead (for hunting locally; CI plays the three above) */
if(process.env.CHAOS_SEEDS){
  SEASONS.length = 0;
  process.env.CHAOS_SEEDS.split(',').forEach(function(s, i){ const n = Number(s); SEASONS.push({name: 'seed ' + n, seed: n, n: 200 + (n % 5) * 30, rate: 0.6 + (n % 4) * 0.1, busy: 2 + (n % 6)}); });
}
if(H){
  SEASONS.forEach(function(cfg){
    suite('SCH-140 ' + cfg.name);
    const log = console.log, err = console.error, warn = console.warn;
    console.log = function(){}; console.error = function(){}; console.warn = function(){};
    let res = null, crash = null;
    try{ res = chaosSeason(cfg); }catch(e){ crash = e; }
    finally{ console.log = log; console.error = err; console.warn = warn; }
    check('the season ran to the end without throwing', !crash, crash ? String(crash && crash.stack || crash).slice(0, 600) : '');
    if(!res) return;
    /* CHAOS_DUMP=<folder> writes every failure, not only the first six, for a session chasing one down */
    if(process.env.CHAOS_DUMP) fs.writeFileSync(path.join(process.env.CHAOS_DUMP, 'chaos-' + cfg.seed + '.json'), JSON.stringify(res, null, 1));
    RULES.forEach(function(rule){ const hit = res[rule] || []; check(rule, hit.length === 0, hit.length + ' time(s): ' + hit.slice(0, 6).join(' | ')); });
    const other = Object.keys(res).filter(function(k){ return RULES.indexOf(k) === -1 && k !== 'a pin to a printed day is reported, not honoured' && k !== 'a pin to a day that has come is spent' && k !== 'a forced weekend day is the office deciding'; });
    check('no other rule broke', other.length === 0, other.join(' | '));
  });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if(failed){ console.log('\nFailures:'); fails.forEach(function(f){ console.log('  - ' + f); }); process.exitCode = 1; }
