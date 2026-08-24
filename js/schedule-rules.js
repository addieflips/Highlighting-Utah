/* ===========================================================================
   THE DAY BUILDER — the engine that decides which houses share a crew-day.

   ⭐ WHY THIS IS ITS OWN FILE (2026-08-24). It was SPLIT IN HALF, and the code knew
   it. rebuildSeasonDays lives inside the Schedule tab's shadow-DOM widget — a
   4,000-line IIFE that nothing outside can see into — while planNewCrewDays, the
   thing that actually builds the days, sat about 8,000 lines away at the top level
   of the same page. The only join between them was this, inside the widget:

       if(typeof planNewCrewDays!=='function')
         return {error:'The day builder is not available on this page.'};

   That is not a defensive nicety. Somebody wrote it because the connection really
   did go missing, and a runtime typeof check against a global is the weakest join
   available: it fails at 7pm when the office presses Recalculate, with a sentence
   nobody can act on. The two halves are now in one file and the widget imports
   them, so a missing engine is a page that fails to load — visible on deploy,
   not on a Friday evening.

   ⚠ THE BODIES ARE BYTE-FOR-BYTE THE ONES THAT SHIPPED. This was a move, generated
   rather than retyped, precisely so that "did the behaviour change" is answerable
   by reading the diff. Every scheduling decision the owner has made — the two-town
   ceiling, new hangs first, October as a deadline, Thanksgiving, the tail sweep,
   one-man days — is unchanged and its reasoning travelled with it.

   ⚠ SETTINGS ARE INJECTED, NOT HARD-CODED. The engine used to read seven
   module-level constants straight out of the page. They are declared here with the
   same defaults and set through setScheduleSettings(), so the office's saved
   crew count and nearby-town list reach the builder without the builder having to
   live in the same file as the settings screen.

   ⚠ THREE SHARED HELPERS ARE INJECTED RATHER THAN COPIED. haversine, toDateStr and
   thanksgivingDate are used all over admin.html, so this file does NOT carry its
   own copy — a second copy of the distance maths is exactly what money-parity.test.js
   exists to prevent for the money maths. They are supplied once by
   setScheduleDeps(). Unset, they THROW rather than returning something plausible:
   a distance function that quietly returns 0 would pair every town with every
   other and look like a scheduling bug for a week.
   =========================================================================== */

/* ---- the settings the engine reads ---------------------------------------
   Same names and same defaults as the constants these replaced, so the moved
   bodies did not have to be touched. Kept in step by loadSchedulingSettings()
   in admin.html, which is the one place any of them is assigned. */
let MAX_STOPS_PER_ROUTE = 20;
let CREWS_PER_DAY = 2;
let SEASON_FIRST_MONTH = 9;
let SEASON_FIRST_DOM = 1;
let NEARBY_TOWN_LIST = {};
let NEARBY_TOWN_MILES = 8;
let ONE_MAN_MAX_HOUSES = 8;

export function setScheduleSettings(s) {
  const p = s || {};
  if (p.maxStopsPerRoute != null) MAX_STOPS_PER_ROUTE = p.maxStopsPerRoute;
  if (p.crewsPerDay != null) CREWS_PER_DAY = p.crewsPerDay;
  if (p.seasonFirstMonth != null) SEASON_FIRST_MONTH = p.seasonFirstMonth;
  if (p.seasonFirstDom != null) SEASON_FIRST_DOM = p.seasonFirstDom;
  /* ⚠ AN EMPTY LIST IS NOT A DECISION, IT IS A BLANK — and a blank means every
     pairing falls through to the eight-mile tape measure, which on the Wasatch
     Front is most of the valley. admin.html already substitutes its built-in list
     before calling here; this guard stops a blank arriving by another route. */
  if (p.nearbyTownList && Object.keys(p.nearbyTownList).length) NEARBY_TOWN_LIST = p.nearbyTownList;
  if (p.nearbyTownMiles != null) NEARBY_TOWN_MILES = p.nearbyTownMiles;
  if (p.oneManMaxHouses != null) ONE_MAN_MAX_HOUSES = p.oneManMaxHouses;
}

export function getScheduleSettings() {
  return { maxStopsPerRoute: MAX_STOPS_PER_ROUTE, crewsPerDay: CREWS_PER_DAY,
    seasonFirstMonth: SEASON_FIRST_MONTH, seasonFirstDom: SEASON_FIRST_DOM,
    nearbyTownList: NEARBY_TOWN_LIST, nearbyTownMiles: NEARBY_TOWN_MILES,
    oneManMaxHouses: ONE_MAN_MAX_HOUSES };
}

/* ---- the three shared helpers, supplied by whoever owns them --------------- */
const unset = (name) => function () {
  throw new Error('js/schedule-rules.js: ' + name + ' was never supplied — call '
    + 'setScheduleDeps({haversine, toDateStr, thanksgivingDate}) before building days.');
};
let haversine = unset('haversine');
let toDateStr = unset('toDateStr');
let thanksgivingDate = unset('thanksgivingDate');

export function setScheduleDeps(d) {
  const p = d || {};
  if (typeof p.haversine === 'function') haversine = p.haversine;
  if (typeof p.toDateStr === 'function') toDateStr = p.toDateStr;
  if (typeof p.thanksgivingDate === 'function') thanksgivingDate = p.thanksgivingDate;
}

export function seasonFirstDate(today){
  const now = today || new Date();
  const first = new Date(now.getFullYear(), SEASON_FIRST_MONTH, SEASON_FIRST_DOM);
  /* Past the start already — the floor is today, not last October. */
  return first > now ? first : new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/* ⭐ NOBODY WORKS THANKSGIVING DAY.
   Owner, 2026-08-18: "we will not be working thanksgiving day."
   This is the one place the calendar is walked, so excluding the day here
   keeps it out of the plan, out of the rebuild and out of every date the
   builder steps to — rather than the day being built and then removed. */
export function isThanksgivingDay(dt){
  const tg = thanksgivingDate(dt.getFullYear());
  return dt.getMonth() === tg.getMonth() && dt.getDate() === tg.getDate();
}

export function isWorkingDay(dt){
  const w = dt.getDay();
  if(w === 0 || w === 6) return false;
  return !isThanksgivingDay(dt);
}

export function nextWorkingDay(dt){
  const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  let guard = 0;
  while(!isWorkingDay(d) && guard++ < 14) d.setDate(d.getDate() + 1);
  return d;
}

/* The middle of a town, from the houses actually waiting in it. Good enough to
   tell a neighbouring town from one across the valley, which is all it is for.
   A town whose houses have no map pin yet gets no centre and is simply never
   borrowed from — it still gets its own days as before. */
export function townCentres(byCity){
  const out = {};
  Object.keys(byCity).forEach(function(city){
    let n = 0, la = 0, ln = 0;
    byCity[city].forEach(function(w){
      const s = w && w.stop;
      if(s && typeof s.lat === 'number' && typeof s.lng === 'number'){ la += s.lat; ln += s.lng; n++; }
    });
    if(n) out[city] = {lat: la / n, lng: ln / n};
  });
  return out;
}

export function sameTownName(a, b){
  return String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
}

/* Towns near `city`, nearest first. */
export function nearbyTowns(city, centres){
  /* Typed in beats measured. Matched case-insensitively so "west jordan" and
     "West Jordan" are the same town, which is how they arrive from a textarea. */
  const key = Object.keys(NEARBY_TOWN_LIST).filter(function(t){ return sameTownName(t, city); })[0];
  if(key) return NEARBY_TOWN_LIST[key].slice();
  const here = centres[city];
  if(!here) return [];
  return Object.keys(centres)
    .filter(function(c){ return c !== city; })
    .map(function(c){ return {city: c, miles: haversine(here.lat, here.lng, centres[c].lat, centres[c].lng)}; })
    .filter(function(x){ return x.miles <= NEARBY_TOWN_MILES; })
    .sort(function(a, b){ return a.miles - b.miles; })
    .map(function(x){ return x.city; });
}

/* Crew numbers, closed up. A crew-day that moved off a date can leave the one
   behind it labelled "crew 2" with no crew 1 — the number is only a label, but
   a gap in it reads as a crew that did not turn up.
   ⚠ Numbers already held by days that existed before this build are stepped
   over rather than reused, or two crews would answer to the same name. */
export function renumberCrewsByDate(days, taken){
  const onDate = {};
  days.forEach(function(cd){ (onDate[cd.date] = onDate[cd.date] || []).push(cd); });
  Object.keys(onDate).forEach(function(dt){
    const used = {};
    Object.keys((taken || {})[dt] || {}).forEach(function(cr){ used[cr] = true; });
    let n = 1;
    onDate[dt].forEach(function(cd){
      while(used[String(n)]) n++;
      cd.crew = String(n);
      used[String(n)] = true;
    });
  });
  return days;
}

export function packTailCrewDays(built, opts){
  const o = opts || {};
  const cap = o.cap || MAX_STOPS_PER_ROUTE;
  const crews = o.crews || CREWS_PER_DAY;
  /* Under half a crew’s worth is a leftover worth dissolving. A day already
     holding ten is a day. */
  const thin = o.thin == null ? Math.ceil(cap / 2) : o.thin;
  const allowedFrom = o.from || function(){ return ''; };
  /* The last day a house may be hung, '' where the customer never named one.
     Without it there is no way to tell "October" (a deadline) from "10/28+" (a
     starting gun).
     ⚠ FAIL SAFE: a caller that does not supply this gets NO later moves at all,
     rather than every house looking deadline-free. Getting this wrong is how an
     October customer ends up on 9 November, which is the exact complaint this
     work started from — and it would be silent. */
  const allowedUntil = o.until || null;
  const mayMoveLater = !!allowedUntil;
  const townOf = o.townOf || function(){ return ''; };
  const nearby = o.nearby || function(){ return []; };
  /* Miles between two towns, for the rescue below only. Without it a far town
     is simply never picked up. */
  const milesBetween = o.dist || function(){ return null; };
  /* ⭐ THE RESCUE, AND WHAT COUNTS AS A WASTED MORNING.
     Owner, 2026-08-18: "6, 8, and 11 houses every day is really bad... we cant
     just be waisting time."
     A day is a whole morning of loading the truck and driving out whether it
     holds four houses or forty, so the thing worth measuring is the DAY's
     total, not one crew's share of it. Below this the day is not paying for
     itself, and its houses may be handed to crews further away than the
     borrowing rule allows. On the real season that is a day of four in West
     Jordan, Murray and Cottonwood Heights, all of them within a few miles of a
     day already going out.
     ⚠ FIRST WRITTEN AS "a crew-day of three or fewer that is the only thing on
     its date", which was too narrow twice over: a date holding two crews of two
     never qualified, and neither did one crew holding four. Both are wasted
     mornings.
     ⚠ Still bounded by distance — "stuff those guys into another day" is
     permission to mix TOWNS, not to send a crew from Salt Lake to Payson — and
     still only where the crew-day empties completely. A full day is never taken
     apart: a crew already coming out that day costs nothing extra. */
  /* ⭐ A WASTED MORNING IS A ONE-MAN DAY, NOT A QUIET ONE (changed 2026-08-20).
     Owner: "one crews are fine what we want to minimize the most is one man days we
     would rather one crew." This was 12, so days of nine, ten and eleven — perfectly
     good one-crew days — were being taken apart and their houses posted to crews
     further away than the borrowing rule allows. Now it fires only where the day would
     otherwise need one person on their own. */
  const wastedDay = o.wastedDay == null
    ? ((typeof ONE_MAN_MAX_HOUSES === 'number' ? ONE_MAN_MAX_HOUSES : 8) + 1)
    : o.wastedDay;
  const rescueMiles = o.rescueMiles == null ? 30 : o.rescueMiles;
  /* Days that already existed before this build: their towns and their crews
     still count against a date, but they are not moved and not moved into. */
  const taken = o.taken || {};

  const list = built.slice().sort(function(a, b){
    if(a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.crew) < String(b.crew) ? -1 : 1;
  });

  const townsOn = function(date, except){
    const t = {};
    const pre = taken[date] || {};
    Object.keys(pre).forEach(function(cr){ if(pre[cr]) t[pre[cr]] = true; });
    for(let i = 0; i < list.length; i++){
      const cd = list[i];
      if(cd === except || cd.date !== date || !cd.ids.length) continue;
      (cd.towns || []).forEach(function(x){ t[x] = true; });
    }
    return t;
  };
  const crewsOn = function(date, except){
    let n = Object.keys(taken[date] || {}).length;
    for(let i = 0; i < list.length; i++){
      const cd = list[i];
      if(cd !== except && cd.date === date && cd.ids.length) n++;
    }
    return n;
  };
  /* Everything the crews are out for on that date, across both of them. */
  const housesOn = function(date){
    let n = 0;
    for(let i = 0; i < list.length; i++) if(list[i].date === date) n += list[i].ids.length;
    return n;
  };
  /* The whole crew-day can only ride a date every one of its houses is allowed
     on, so the latest of them decides. */
  const latestAllowed = function(ids){
    let f = '';
    for(let i = 0; i < ids.length; i++){
      const a = allowedFrom(ids[i]);
      if(a && a > f) f = a;
    }
    return f;
  };

  const moved = [], relocated = [];
  /* Every crew-day is examined, the earliest included. It can never find a
     target — there is nothing before it — but stopping short of it made the
     walk depend on the sort order, and a test fixture that put a leftover
     first went straight past it. */
  for(let i = list.length - 1; i >= 0; i--){
    const src = list[i];
    if(!src.ids.length || src.ids.length >= thin) continue;

    /* ① THE WHOLE CREW-DAY RIDES AN EARLIER DATE THAT HAS A CREW SPARE.
       Nothing is mixed, nothing is re-routed, one date disappears. */
    {
      const need = latestAllowed(src.ids);
      const mine = (src.towns && src.towns.length) ? src.towns : [src.city];
      let best = '';
      for(let j = 0; j < list.length; j++){
        const d = list[j].date;
        if(d >= src.date || d <= best) continue;   // never later; keep the closest
        if(need && d < need) continue;
        if(crewsOn(d, src) >= crews) continue;
        const busyTowns = townsOn(d, src);
        let clash = false;
        for(let t = 0; t < mine.length; t++) if(busyTowns[mine[t]]) clash = true;
        if(clash) continue;
        best = d;
      }
      if(best){
        relocated.push({from: src.date, to: best, towns: mine.slice(), houses: src.ids.length});
        src.date = best;
        continue;
      }
    }

    /* ② Otherwise the houses are re-homed one at a time. Planned in full
       before anything is committed, because whether the day disappears decides
       how much mixing is allowed. */
    const extra = [];
    /* ⭐ TOWNS THIS PLAN WILL ADD, alongside the houses it will add. Nothing is
       committed until the whole crew-day is known to empty, so `tgt.towns` still reads
       as it did before the plan started — and a town check against it alone lets TWO
       houses from two different towns each see the same single spare slot and both
       take it. That is 27 October: Payson and Santaquin both swept onto one crew, each
       believing it was the only one. `extra` already had to exist for exactly the same
       reason on the house count. */
    const addTowns = [];
    for(let n = 0; n < list.length; n++){ extra[n] = 0; addTowns[n] = []; }
    /* A rescue is on the table when the whole DAY is not paying for itself.
       Measured across both crews, because the morning is spent either way. */
    const rescuing = housesOn(src.date) < wastedDay;
    const plan = [];
    for(let k = 0; k < src.ids.length; k++){
      const id = src.ids[k];
      const town = townOf(id);
      const okDate = allowedFrom(id);
      const deadline = mayMoveLater ? allowedUntil(id) : null;
      let bestAt = -1, bestScore = 99, bestDate = '', bestMiles = Infinity, bestLater = true;
      for(let j = 0; j < list.length; j++){
        const tgt = list[j];
        if(tgt === src || !tgt.ids.length) continue;
        if(tgt.date === src.date) continue;
        /* ⭐ LATER IS ALLOWED ONLY TO KILL A WASTED MORNING, AND ONLY WHERE THE
           CUSTOMER NEVER NAMED A LAST DAY.
           Owner, 2026-08-18: "if you need stuff some anys in to fill the day up
           in those areas but we cant just be waisting time."
           On the real season this is the "10/28+" customer — nobody else is
           allowed in October by then, so they hold 28 October on their own. The
           plus means "not before the 28th", which 2 November satisfies just as
           well, and 2 November is a day the crew is already working.
           ⚠ An October house has a deadline of the 31st and can never be swept
           into November this way. Earlier is always preferred — see the score. */
        const later = tgt.date > src.date;
        if(later){
          if(!rescuing || !mayMoveLater) continue;
          if(deadline && tgt.date > deadline) continue;
        }
        if(okDate && tgt.date < okDate) continue;        // never before they may be hung
        if(cap - (tgt.ids.length + extra[j]) <= 0) continue;
        const towns = tgt.towns || [];
        const planned = addTowns[j];
        const has = !!town && (towns.indexOf(town) !== -1 || planned.indexOf(town) !== -1);
        if(!has && townsOn(tgt.date, tgt)[town]) continue;   // the other crew is already there
        let score, miles = 0;
        if(has) score = 0;                                   // already going to that town
        /* ⭐ A CREW IS ITS OWN TOWN PLUS AT MOST ONE OTHER. NO EXCEPTIONS.
           Owner, 2026-08-20: "we should never have a day with 5 towns no exceptions."

           This line is what built 27 October with six: Cottonwood Hts and Murray as
           the crew’s legitimate pair, then Holladay and Midvale handed over as a THIRD
           and FOURTH town (the old score of 2 said so in its own comment), and Payson
           and Santaquin swept in by the rescue below, which checked the MILES but
           never the town count.

           ⚠ AND THIS IS WHY PRESSING RECALCULATE NEVER CLEARED THE WARNING. It was
           not a stale plan and it was not the timing sweep alone — the builder itself
           put those towns there, so every rebuild laid them out and put them straight
           back. Anything that tests the SWEEP and not the BUILDER passes while the day
           on screen still has six towns on it.

           The cost is real and she has chosen it: a near-empty day that can no longer
           be emptied stays a near-empty day. A morning with eight houses on it is a
           bad day; a crew driving six towns is a bad day AND a wrong sheet. */
        else if(towns.length + planned.length >= 2) continue;   // its own town plus one, counting this plan
        else if(nearby(tgt.city).indexOf(town) !== -1) score = 1;   // the spare town slot
        else if(rescuing){
          const km = milesBetween(tgt.city, town);
          if(km == null || km > rescueMiles) continue;
          score = 3; miles = km;
        } else continue;                                     // too far to be worth a day
        /* ⚠ EARLIER ALWAYS BEATS LATER, whatever the towns look like: moving a
           customer back is free, moving them on is a cost. Within a direction,
           the closest day to the one they already had — and on a rescue, the
           shortest drive. */
        const better = (later !== bestLater) ? !later
          : (score < bestScore ? true
            : (score !== bestScore ? false
              : (score === 3 ? miles < bestMiles
                : (later ? tgt.date < bestDate : tgt.date > bestDate))));
        if(better){
          bestAt = j; bestScore = score; bestDate = tgt.date; bestMiles = miles; bestLater = later;
        }
      }
      if(bestAt === -1) continue;
      extra[bestAt]++;
      if(town && (list[bestAt].towns || []).indexOf(town) === -1 &&
         addTowns[bestAt].indexOf(town) === -1) addTowns[bestAt].push(town);
      plan.push({id: id, town: town, at: bestAt, score: bestScore});
    }
    /* ⚠ ALL OF IT OR NONE OF IT. A crew-day that only half empties still costs
       the same morning, and now costs it for a handful instead of a dayful —
       on the real season a partial sweep left ONE house holding 28 October
       while the four beside it went elsewhere. Nothing was saved and four
       routes got longer. So the moves are committed only where the crew-day
       goes completely; otherwise the day is left exactly as it was. */
    const emptied = plan.length === src.ids.length;
    if(!emptied) continue;
    const take = plan;
    if(!take.length) continue;
    const gone = {};
    take.forEach(function(p){
      const tgt = list[p.at];
      tgt.ids.push(p.id);
      if(p.town && (tgt.towns || []).indexOf(p.town) === -1){
        tgt.towns = (tgt.towns || []).concat([p.town]);
      }
      gone[p.id] = true;
      moved.push({id: p.id, from: src.date, to: tgt.date, town: p.town,
                  /* mixed was score 2, a crew's THIRD town. That cannot happen any
                     more, so it is always false — kept so anything reading the
                     report still finds the field where it expects it. */
                  mixed: false, rescued: p.score === 3});
    });
    src.ids = src.ids.filter(function(id){ return !gone[id]; });
  }
  return {days: list.filter(function(cd){ return cd.ids.length; }),
          moved: moved, relocated: relocated};
}

/* ⭐ ONE DAY AT A TIME, BIGGEST TOWNS FIRST — RECOUNTED EVERY DAY.
   Owner, 2026-08-17: "we want to start with the two cities that have the most
   clients and work our way down to the cities with the least clients, so if
   lehi has 140 houses heriman has 120 and AF has 119 then today is Lehi and
   heriman but tomorrow is Lehi and AF."

   It used to walk TOWN by town: take the biggest town, give it days until its
   queue was empty, then move to the next. That is why the season opened with
   Lehi-Draper, Lehi-Draper, Lehi-Draper — the first town claimed every early
   slot. Now it walks DAY by day: on each working day the crews are sent to the
   towns with the most houses still waiting, and the count is redone before the
   next day, so a town that has just been worked drops down the list on its own.

   "Most clients" means most houses ALLOWED on that date. A town holding only
   November houses does not win an October day and then place nobody.

   Still true, and still asserted: a crew does its own town plus AT MOST ONE
   other; the other is chosen by urgency, not distance; and two crews are never
   in the same town on the same day. */
export function planNewCrewDays(waiting, taken, opts){
  const o = opts || {};
  /* ⭐ A DAY IS A CLUSTER, NOT THE TOP OF A LIST (added 2026-08-21).
     Owner: "in the schedule we want to try to organize it so in a city and
     neighboring cities it picks houses for a day that are closer to each other
     rather than miles apart although theyre technically in the same city."

     A town is not a point. Provo is nine miles across, and the queue a day was
     filled from is ordered by who has waited longest — so the twenty houses a
     crew got could be twenty houses scattered over the whole town, and no amount
     of re-ordering them afterwards can fix that. Driving order is only ever as
     good as the SET of houses it is given: pick twenty that sit near each other
     and the route is short, pick twenty at random across the town and the best
     possible route is still a bad day. This picks the set.

     ⚠ IT DOES NOT OVERRULE ANYTHING SHE HAS ALREADY DECIDED. Distance is the
     LAST word, never the first:
       - priority tier is absolute. October is emptied before November is touched,
         exactly as before — this only ever chooses between houses the old code
         considered equally urgent.
       - a named day still goes first inside its tier ("try to do their house the
         next possible chance after that", 2026-08-20).
       - a house with no map pin is not punished for it. It cannot be clustered,
         so it is taken last within its tier, in the queue's own order — the same
         treatment reorderFlatStops gives it. It never blocks or scatters the rest.
     With no anchor to start from, the first house is simply the front of the
     queue, which is what the builder took before. So the CHOICE of who leads a
     day is unchanged; what changed is who rides along with them. */
  function pickClusteredFromQueue(queue, eligible, want, anchor){
    const chosen = [];
    const pool = (eligible || []).slice();
    const pinOf = function(i){
      const st = queue[i] && queue[i].stop;
      return (st && typeof st.lat === 'number' && typeof st.lng === 'number' &&
              isFinite(st.lat) && isFinite(st.lng)) ? st : null;
    };
    let cur = (anchor && typeof anchor.lat === 'number' && typeof anchor.lng === 'number')
      ? {lat: anchor.lat, lng: anchor.lng} : null;
    while(chosen.length < want && pool.length){
      /* Only the most urgent tier still in the pool is ever in play, so the
         geography below can never promote a November house over an October one. */
      let urg = Infinity;
      pool.forEach(function(i){ const p = queue[i].priority; if(p < urg) urg = p; });
      let bestPos = -1, bestNamed = 0, bestDist = 0;
      pool.forEach(function(i, pos){
        const q = queue[i];
        if(q.priority !== urg) return;
        const named = q.named ? 0 : 1;
        const pin = pinOf(i);
        /* No anchor yet, or nothing to measure against: fall back to the queue's
           own order, which is priority, then named, then longest waiting. */
        const dist = cur ? (pin ? haversine(cur.lat, cur.lng, pin.lat, pin.lng) : Infinity) : pos;
        if(bestPos === -1 || named < bestNamed || (named === bestNamed && dist < bestDist)){
          bestPos = pos; bestNamed = named; bestDist = dist;
        }
      });
      if(bestPos === -1) break;
      const idx = pool.splice(bestPos, 1)[0];
      chosen.push(idx);
      const pin = pinOf(idx);
      if(pin) cur = {lat: pin.lat, lng: pin.lng};
    }
    return chosen;
  }
  /* Where the day has got to on the map, so the neighbour town it borrows from
     lends the houses on ITS side of the line rather than its longest-waiting
     ones. Read before anything is spliced out of the queue. */
  function lastPinOf(queue, idxs){
    for(let k = (idxs || []).length - 1; k >= 0; k--){
      const st = queue[idxs[k]] && queue[idxs[k]].stop;
      if(st && typeof st.lat === 'number' && typeof st.lng === 'number' &&
         isFinite(st.lat) && isFinite(st.lng)) return {lat: st.lat, lng: st.lng};
    }
    return null;
  }
  const cap = o.cap || MAX_STOPS_PER_ROUTE;
  const crews = o.crews || CREWS_PER_DAY;
  const maxDays = o.maxDays == null ? 40 : o.maxDays;
  const floor = o.floorDate || toDateStr(nextWorkingDay(seasonFirstDate()));
  const horizon = o.horizonDays == null ? 400 : o.horizonDays;
  const busy = {};
  Object.keys(taken || {}).forEach(function(dt){ busy[dt] = Object.assign({}, taken[dt]); });
  /* Every town worked on a date, not just each crew's MAIN town. Once a
     crew-day can be topped up from a neighbour, the crew->town map alone stops
     answering "is anybody in this town today" — a day whose main town is
     Highland but which borrowed from Alpine would still look Alpine-free, and a
     second crew could be sent there. Seeded from the days that already exist. */
  const usedTowns = {};
  function townsUsedOn(dateStr){ return usedTowns[dateStr] || []; }
  function markTownUsed(dateStr, town){
    if(!town) return;
    const list = usedTowns[dateStr] = usedTowns[dateStr] || [];
    if(list.indexOf(town) === -1) list.push(town);
  }
  Object.keys(busy).forEach(function(dt){
    Object.keys(busy[dt]).forEach(function(cr){ markTownUsed(dt, busy[dt][cr]); });
  });
  /* Grouped by town, and within a town by who has waited longest for a slot
     they are allowed on — new hangs, then October, then no preference. */
  const byCity = {};
  waiting.forEach(function(w){
    if(!w || !w.city) return;
    (byCity[w.city] = byCity[w.city] || []).push(w);
  });
  Object.keys(byCity).forEach(function(c){
    byCity[c].sort(function(a,b){
      /* ⭐ ONCE A NAMED DAY HAS OPENED, IT GOES AHEAD OF THE PEOPLE WHO DO NOT MIND
         (added 2026-08-20). Owner: "for people who have exact dates try to do it close
         to then, having it as a floor is good but try to do their house the next
         possible chance after that but thats not high on priority."

         A floor alone only says NOT BEFORE. Somebody who asked for 9 November was then
         ordered behind every Any house, because those opened on day one of the season
         and sort earlier by `from` — so the person who named a day waited longest of
         anybody. This is a TIEBREAK inside the priority tier, which is what "not high
         on priority" means: it never jumps a tier, it just decides who goes first among
         people who are otherwise equal.

         Among named days it is still earliest-first, so somebody already past their day
         is not overtaken by somebody whose day has only just arrived. */
      return (a.priority - b.priority) ||
             ((b.named ? 1 : 0) - (a.named ? 1 : 0)) ||
             (a.from < b.from ? -1 : (a.from > b.from ? 1 : 0));
    });
  });
  /* ⭐ NOTHING IS HELD BACK, AND NOTHING IS LEVELLED (settled 2026-08-20). Owner,
     after both were built and shown to her: "actually no we dont want to fill up 1 man
     days to 15 because we want to prioritize everyday having 40 houses more than the
     ending days having 15 because the one man days will fill up so it just needs to
     recalculate it so it turns to 1 or two crew rather than staying one man."

     Two things were tried here and BOTH ARE GONE ON PURPOSE. Do not re-add either
     without asking her again:
       - reserving flexible people in a town so its late openers had company;
       - trimming a crew-day so the leftover reached fifteen.

     Both bought a tidier tail at the price of a slower start, and the start is what she
     cares about: forty houses a day early is how the season does not fall behind. A
     short day at the end is not a problem to solve in the builder, because it FILLS
     ITSELF — crews do not finish every house every day, the leftovers roll forward,
     and the next recalculation lays them out again. The near-empty-day rescue below is
     what turns such a day into one or two proper crews when that happens.

     What survives from all of it: One Man Installs still LISTS the short days, and the
     rescue still only fires on genuinely one-man ones. Reporting them was always the
     useful half. */
  const centres = townCentres(byCity);
  const dateOf = function(ds){ return new Date(ds.slice(0,4), Number(ds.slice(5,7)) - 1, ds.slice(8,10)); };
  /* How many are allowed today, and how urgent the most urgent of them is.
     byCity is sorted by priority first, so the first allowed house IS the most
     urgent allowed house — no second scan needed. */
  const allowedStats = function(city, ds){
    const q = byCity[city] || [];
    let n = 0, urg = 99;
    for(let i = 0; i < q.length; i++){
      if(q[i].from > ds) continue;
      n++;
      if(q[i].priority < urg) urg = q[i].priority;
    }
    return {n: n, urg: urg};
  };
  const allowedCount = function(city, ds){ return allowedStats(city, ds).n; };
  /* ⭐ HOW BIG A CREW-DAY THIS TOWN CAN ACTUALLY MAKE TODAY (added 2026-08-20).
     Owner: "we want to fill up everyday to 40 so then the days with less than 40 fall
     at the end, it should only not be like that if enough people requested a later
     date."

     ⚠ HOUSES WAITING IS NOT THE SAME AS A DAY'S WORTH. The crews were sent to the
     two BIGGEST towns, which is right until a town runs low: twelve left in one town
     with both its neighbours already worked makes a crew-day of twelve, while a town of
     ten sitting next to a neighbour with thirty would have made twenty. The office then
     sees a short day in the middle of October and a full one in November, which is
     exactly backwards.

     So the question asked of each town is what it can PRODUCE: its own allowed houses
     plus what one available neighbour could lend, capped at a crew-day. One neighbour,
     because that is all the borrowing rule allows a crew to visit.

     ⚠ EARLY IN THE SEASON THIS CHANGES NOTHING. Every big town already answers
     "twenty", they all tie, and the tie is broken on houses waiting exactly as before.
     It only decides anything once towns start running out, which is where the short
     days were appearing. */
  const fillableCount = function(city, ds){
    const own = allowedStats(city, ds).n;
    if(own >= cap) return cap;
    const used = townsUsedOn(ds);
    let best = 0;
    nearbyTowns(city, centres).forEach(function(other){
      if(other === city || used.indexOf(other) !== -1) return;
      const n = allowedCount(other, ds);
      if(n > best) best = n;
    });
    return Math.min(cap, own + best);
  };
  const out = [];
  let made = 0;
  let dt = nextWorkingDay(dateOf(floor));
  let spins = 0;
  while(made < maxDays && spins++ < horizon){
    const ds = toDateStr(dt);
    const anyLeft = Object.keys(byCity).some(function(c){ return byCity[c].length; });
    if(!anyLeft) break;
    const onDay = busy[ds] || {};
    let freeSlot = false;
    for(let cr = 1; cr <= crews; cr++) if(!onDay[String(cr)]) freeSlot = true;
    let placedToday = 0;
    if(freeSlot){
      for(let cr = 1; cr <= crews && made < maxDays; cr++){
        if((busy[ds] || {})[String(cr)]) continue;
        /* ⭐ THE MOST URGENT TOWN, AND AMONG EQUALS THE ONE WITH THE MOST
           STILL WAITING. Counted fresh, ties alphabetical so the same input
           always gives the same plan.

           Owner, 2026-08-18, reading October customers sitting on a 26 November
           day: "we need to get everyone who requested Oct done in Oct none in
           November and if any in Nov it should be Nov 1st but only if theres
           literally no other way."

           Head-count alone could not do that. A town is worked when its count
           wins, and everything on it goes out that day — so a town of five was
           not reached until November, and its October customers went to
           November with it. Ordering inside a town never helped: October is
           already first in the queue, it was the TOWN that was late.

           ⚠ THIS DOES NOT UNDO "THE TWO BIGGEST TOWNS GET EACH DAY". Through
           most of October every town still has October houses waiting, so the
           urgency is equal everywhere and the head-count decides exactly as
           before — the owner's own Lehi/Herriman/American Fork example is
           unchanged. It only bites once the big towns have no October left:
           their best waiting house becomes a no-preference one, and a small
           town still holding an October customer now goes first. Which is the
           same rule the borrowing already followed, and the same rule the owner
           gave earlier: "we shouldnt be doing anyone who said any until oct are
           done."

           The small town then tops up from a neighbour in the usual way, which
           is the owner's "if you need stuff some anys in to fill the day up in
           those areas" — the day goes out full rather than holding five. */
        let pick = null;
        Object.keys(byCity).forEach(function(c){
          if(!byCity[c].length) return;
          if(townsUsedOn(ds).indexOf(c) !== -1) return;   // the other crew is already there
          const st = allowedStats(c, ds);
          if(!st.n) return;
          const fits = fillableCount(c, ds);
          /* Urgency first, always. Then the town that fills the day best, and only
             then the one with most houses waiting. */
          if(!pick || st.urg < pick.urg ||
             (st.urg === pick.urg && (fits > pick.fits ||
               (fits === pick.fits && (st.n > pick.n ||
                 (st.n === pick.n && c < pick.city)))))){
            pick = {city: c, n: st.n, urg: st.urg, fits: fits};
          }
        });
        if(!pick) break;
        const city = pick.city;
        const queue = byCity[city];
        /* The queue is priority-ordered, so taking from the front takes the most
           urgent and leaves whoever minded least for another day. */
        /* Only the houses allowed out today. A named day that has not arrived cannot
           be taken, however much room the crew has. */
        const eligible = [];
        for(let i = 0; i < queue.length; i++) if(queue[i].from <= ds) eligible.push(i);
        /* ⭐ A FULL CREW-DAY, EVERY TIME. See the note above byCity: trimming this to
           leave a healthier last day was built, shown to her, and overruled — forty
           houses a day early matters more than fifteen at the end, and the short days
           fill themselves from what the crews do not finish. */
        const take = pickClusteredFromQueue(queue, eligible, cap, null);
        if(!take.length) break;
        const ids = take.map(function(i){ return queue[i].id; });
        /* Where this crew ends up on the map, kept before the splice — the
           neighbour it borrows from below lends from that end of the town. */
        const anchor = lastPinOf(queue, take);
        /* take comes back in PICK order, not index order, so the splice has to
           work from the highest index down or it removes the wrong houses. */
        take.slice().sort(function(a, b){ return b - a; })
            .forEach(function(i){ queue.splice(i, 1); });
        /* Its own town first, always, and then AT MOST ONE other — see the note
           on the owner's "each crew is only doing one other city". The one
           chosen is the neighbour whose most urgent waiting house is the most
           urgent, with distance breaking a tie only. */
        const towns = [city];
        if(ids.length < cap){
          const near = nearbyTowns(city, centres);
          let borrow = null;
          for(let n = 0; n < near.length; n++){
            const other = near[n];
            if(townsUsedOn(ds).indexOf(other) !== -1) continue;
            const oq = byCity[other];
            if(!oq || !oq.length) continue;
            let best = null;
            for(let i = 0; i < oq.length; i++){
              if(oq[i].from > ds) continue;
              if(best === null || oq[i].priority < best) best = oq[i].priority;
            }
            if(best === null) continue;
            if(!borrow || best < borrow.best) borrow = {town: other, best: best, queue: oq};
          }
          if(borrow){
            /* ⭐ AND THE NEIGHBOUR LENDS FROM THE NEAR SIDE. The borrowed houses
               used to come off the front of that town's queue, which is the
               longest-waiting ones wherever they happen to sit — so a crew that
               had just finished the east end of Lehi could be sent to the far
               side of American Fork. Anchored on where the day has actually got
               to, the loan continues the run instead of restarting it. */
            const oel = [];
            for(let i = 0; i < borrow.queue.length; i++){
              if(borrow.queue[i].from <= ds) oel.push(i);
            }
            const lent = pickClusteredFromQueue(borrow.queue, oel, cap - ids.length, anchor);
            if(lent.length){
              lent.forEach(function(i){ ids.push(borrow.queue[i].id); });
              lent.slice().sort(function(a, b){ return b - a; })
                  .forEach(function(i){ borrow.queue.splice(i, 1); });
              towns.push(borrow.town);
            }
          }
        }
        busy[ds] = busy[ds] || {};
        busy[ds][String(cr)] = city;
        towns.forEach(function(t){ markTownUsed(ds, t); });
        out.push({date: ds, crew: String(cr), city: city, towns: towns, ids: ids});
        made++;
        placedToday++;
      }
    }
    if(!placedToday && freeSlot){
      /* Crews were free and nobody could ride today — everyone left is waiting
         for a later month. Jump to the first date somebody IS allowed rather
         than stepping through the calendar a day at a time. */
      let soonest = null;
      Object.keys(byCity).forEach(function(c){
        byCity[c].forEach(function(w){
          if(w.from > ds && (soonest === null || w.from < soonest)) soonest = w.from;
        });
      });
      if(soonest === null) break;
      dt = nextWorkingDay(dateOf(soonest));
      continue;
    }
    dt = nextWorkingDay(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1));
  }
  /* Sweep up the dribble at the end before handing the plan back. Off only for
     the tests that want to see the raw build. */
  if(o.pack === false) return out;
  const wById = {};
  waiting.forEach(function(w){ if(w && w.id != null) wById[w.id] = w; });
  const packed = packTailCrewDays(out, {
    cap: cap, crews: crews, thin: o.thin, taken: taken || {},
    from: function(id){ return (wById[id] && wById[id].from) || ''; },
    until: function(id){ return (wById[id] && wById[id].until) || ''; },
    townOf: function(id){ return (wById[id] && wById[id].city) || ''; },
    nearby: function(c){ return nearbyTowns(c, centres); },
    dist: function(a, b){
      const ca = centres[a], cb = centres[b];
      if(!ca || !cb) return null;
      return haversine(ca.lat, ca.lng, cb.lat, cb.lng);
    }
  });
  return renumberCrewsByDate(packed.days, taken || {});
}

