/* grid.js — where a crew-day comes from, now that it is not a town.
 *
 * WHY THIS FILE EXISTS
 * The schedule used to be built out of TOWNS. `byCity` in admin.html bucketed
 * every waiting house by the town on its record, and one crew-day was one town
 * plus at most one hand-listed neighbour. Town was not a tiebreak in that
 * design, it was the container: every other rule was written in town terms.
 *
 * Owner, 2026-08-22: "city lines arent a concern". A town boundary is a line on
 * a county plat, not a fact about driving. Two houses either side of one are
 * across the street from each other; two houses at opposite ends of Lehi are
 * eleven minutes apart. Grouping by the name meant the schedule was optimising
 * something nobody in a van experiences.
 *
 * WHAT REPLACES IT, AND WHY IT IS NOT JUST "NEAREST TWENTY"
 * The obvious answer — seed a day somewhere and take the twenty closest houses —
 * has a bias that shows up only at the end of the season, which is exactly when
 * it is too late. Greedy nearest-neighbour packing always fills from wherever
 * the book is dense, because dense areas always win "who is closest". A house
 * on the outer rim of the service area is never in anybody's nearest twenty, so
 * it is passed over every single pass, and the pool it is left in gets thinner
 * each time. By December the only houses left are the ones that were never near
 * anything — and now they are not near each other either.
 *
 * Owner, 2026-08-22, on that: "we dont end up with a bunch of dots in the middle
 * of no where so we dont have any one man days... if we base it soley on distance
 * were gonna have a lot of houses along the outside of the space we cover because
 * they were never in closest distance."
 *
 * So this does not pack greedily at all. It lays the whole book out along a
 * space-filling curve and cuts it into blocks in ONE pass. Every house is placed
 * at the same moment as the houses around it, which means there is no residue
 * phase for a rim house to be passed over during. "Left over" stops being a state
 * a house can be in.
 *
 * ⭐ AND A REAL OUTLIER IS NOT SCHEDULED AT ALL. Owner, 2026-08-22: "if a house is
 * really that far out then its for my dad to do... if they are a real outlier they
 * arent in the grid at all". That is what keeps distance from ever having to
 * outrank timing: the houses that would have forced that trade-off are lifted out
 * of the pool before the pool is cut up. Levan — one customer twenty-odd miles
 * south of Santaquin — is the case this is for.
 *
 * Everything here is pure: houses in, blocks out. Nothing reads the screen,
 * nothing talks to Firebase, nothing remembers anything between calls. Same rule
 * js/money.js follows, and for the same reason — it is what lets run-all.js build
 * a whole season and check the shape of it.
 *
 * Loaded by admin.html as a normal browser module. No build step, no tooling.
 */

/* ---------------- the knobs ----------------
 * Defaults, not laws. planBlocks takes an options object so Scheduling settings
 * can move any of these without a code change, and so run-all.js can sweep them
 * to see which numbers actually produce the season the owner wants. */

/* How big a cell of the identity grid is. This is NOT what decides a day's size —
 * the chunking below does that. A cell exists so a house has a stable address
 * that means the same thing on every rebuild ("this house is in cell 421:307"),
 * which is what the eviction rule and the outlier report are written against.
 * A mile is about two minutes of driving on the Wasatch Front. */
export const GRID_CELL_MILES = 1;

/* ⭐ WHAT MAKES SOMEBODY YOUR DAD'S PROBLEM RATHER THAN A CREW'S.
 * A house with fewer than OUTLIER_MIN_COMPANY other houses inside
 * OUTLIER_RADIUS_MILES cannot ever be part of a sensible crew-day: there is not
 * a crew's worth of work within reach of it, this season or any season. Ten
 * miles because that is roughly the distance at which a detour stops being a
 * detour and becomes the trip; eight because that is ONE_MAN_MAX_HOUSES in
 * admin.html — below it you are sending one person out on their own, which is
 * the exact thing this whole change exists to prevent.
 * ⚠ MEASURED AGAINST THE WHOLE BOOK, not against who is still waiting. Otherwise
 * a house stops being an outlier in October and becomes one in December purely
 * because its neighbours got done, and it would move between the crew schedule
 * and your dad's list mid-season. Outlier is a property of the address. */
export const OUTLIER_RADIUS_MILES = 10;
export const OUTLIER_MIN_COMPANY = 8;

/* Where the curve is allowed to be cut. Two consecutive houses along the curve
 * further apart than this are not really neighbours, whatever the ordering says —
 * a space-filling curve has to jump sometimes, and a block straddling a jump is
 * a crew sent across the valley mid-morning. Cutting there first is what stops
 * that, and it is cheaper than detecting it afterwards. */
export const MAX_CURVE_JUMP_MILES = 3;

/* The smallest block worth sending anybody out for. ONE_MAN_MAX_HOUSES in
 * admin.html is 8 — at or below it you are sending one person out alone — so a
 * block has to reach nine to be a day. Anything thinner gets merged into its
 * nearest neighbour by mergeThinRuns below, or, if there is no neighbour within
 * reach, goes to your dad with the rest of the outliers. */
export const MIN_BLOCK_HOUSES = 9;

/* How far a thin run may reach to find company. Same radius the outlier test
 * uses, and for the same reason: past ten miles it is not a detour any more. */
export const MERGE_RADIUS_MILES = OUTLIER_RADIUS_MILES;

/* The projection. Utah sits north and east of this corner, so every cell index
 * comes out non-negative without special cases.
 * ⚠ FIXED ON PURPOSE, AND NOT DERIVED FROM THE DATA. An origin computed from
 * whoever is in the book would move every time a customer joins, and every house
 * in the state would change cells. The whole value of a cell is that it does not
 * move. */
const GRID_ORIGIN_LAT = 36.5;    /* south of Utah's border (37.0) */
const GRID_ORIGIN_LNG = -114.5;  /* west of Utah's border (-114.05) */
const MILES_PER_DEG_LAT = 69.0;
/* Longitude degrees get narrower as you go north. Taken at the latitude the
 * business actually works rather than per-house, so cells stay rectangles of a
 * constant size instead of subtly changing shape up the valley. */
const GRID_REF_LAT = 40.4;
const MILES_PER_DEG_LNG = MILES_PER_DEG_LAT * Math.cos(GRID_REF_LAT * Math.PI / 180);

/* Side of the Hilbert square, in cells. A power of two, and large enough that
 * the finest grid used below still fits inside Utah with room to spare. */
const HILBERT_SIDE = 65536;

/* ---------------- distance ---------------- */

/* Miles between two points. Haversine, the same formula admin.html already uses
 * for town centres — named differently here so importing this module cannot
 * collide with the one already in that file. */
export function distanceMiles(lat1, lng1, lat2, lng2){
  const R = 3958.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* Does this house have coordinates we can actually use? Judged on the numbers,
 * not on a flag — same rule hcHasMapPin follows in admin.html, and for the same
 * reason: nothing has ever backfilled the flag. 0,0 is the Atlantic, which is
 * what a failed lookup leaves behind and never a house in Utah. */
export function hasPin(h){
  if(!h) return false;
  const lat = Number(h.lat), lng = Number(h.lng);
  if(!isFinite(lat) || !isFinite(lng)) return false;
  if(lat === 0 && lng === 0) return false;
  return true;
}

/* ⭐ THE SEAM FOR A FALLBACK LADDER, LEFT OPEN ON PURPOSE.
 * Owner, 2026-08-22: "we may need fall back ladders in the future as we get more
 * customers."
 *
 * On 2026-08-22 Health Check read "Customer with no map pin — all clear", so every
 * house in the book has real coordinates and nothing here has to guess. That is a
 * fact about today, not a property of the system: the bigger the book gets the more
 * certain it is that somebody's address will not geocode, and the moment one does
 * not, a distance-only schedule has nothing at all to group them by — where the old
 * town-based builder would at least have given them a day.
 *
 * So the ladder is a HOOK rather than an implementation. Pass `pinFallback` and it
 * is asked for coordinates for any house without its own, in whatever order of
 * preference the caller wants — the natural rungs, best first, are:
 *     1. the centre of the houses that DO have pins in the same town;
 *     2. the centre of the same ZIP;
 *     3. the ZIP-distance ladder areaScore already implements in admin.html.
 * It returns {lat, lng} or null, and a house it cannot place stays in `unpinned`
 * rather than being guessed at.
 *
 * ⚠ A GUESSED PIN IS MARKED AS ONE. Blocks carry `estimated` so the office can see
 * that a house was placed by inference, and so a bad guess shows up as a visibly
 * odd day rather than silently making a crew drive somewhere wrong. Nothing here
 * writes a guessed pin back to the customer record — that would turn a stopgap into
 * the address of record, and Health Check would then read "all clear" over the top
 * of a problem it exists to surface. */
export function applyPinFallback(houses, pinFallback){
  if(typeof pinFallback !== 'function') return (houses || []).slice();
  return (houses || []).map(function(h){
    if(hasPin(h)) return h;
    let guess = null;
    try{ guess = pinFallback(h); }
    catch(err){ guess = null; }
    if(!guess || !hasPin(guess)) return h;
    return Object.assign({}, h, {lat: guess.lat, lng: guess.lng, estimated: true});
  });
}

/* ---------------- the grid ---------------- */

/* Which cell a point falls in, at a given cell size. Integer coordinates from a
 * fixed corner, so the answer for one house never depends on any other house. */
export function cellOf(lat, lng, cellMiles){
  const size = cellMiles || GRID_CELL_MILES;
  return {
    cx: Math.floor(((lng - GRID_ORIGIN_LNG) * MILES_PER_DEG_LNG) / size),
    cy: Math.floor(((lat - GRID_ORIGIN_LAT) * MILES_PER_DEG_LAT) / size)
  };
}

/* The printable name of a cell — what the office would say out loud. */
export function cellKey(cx, cy){ return cx + ':' + cy; }

/* ⭐ THE SPACE-FILLING CURVE, AND WHY IT IS THIS ONE.
 * A Hilbert curve threads every cell of a square exactly once, and — this is the
 * property that matters — cells that are close together on the curve are close
 * together on the ground. Reading houses off in curve order therefore gives a
 * list where any run of twenty is a compact patch of map, without anybody having
 * to choose a patch.
 * Row-by-row order (the obvious alternative) does not have that property: the end
 * of one row and the start of the next are the full width of the state apart.
 * Standard xy->d conversion; `side` must be a power of two. */
export function hilbertIndex(x, y, side){
  const n = side || HILBERT_SIDE;
  let rx, ry, d = 0, px = x, py = y;
  for(let s = n / 2; s >= 1; s = s / 2){
    rx = (px & s) > 0 ? 1 : 0;
    ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    /* rotate the quadrant so the curve joins up with its neighbours */
    if(ry === 0){
      if(rx === 1){ px = s - 1 - px; py = s - 1 - py; }
      const t = px; px = py; py = t;
    }
  }
  return d;
}

/* ---------------- outliers ---------------- */

/* Who is too far from everybody to be part of a crew-day, ever.
 * ⚠ O(n²) and deliberately so. The book is about a thousand houses, which is a
 * million distance calculations and finishes instantly; a spatial index here
 * would be faster and would also be a second thing that could be wrong.
 * Returns all three groups, because the outliers are a list somebody actually
 * works from, not a discard pile. */
export function findOutliers(houses, opts){
  const o = opts || {};
  const radius = o.outlierRadiusMiles == null ? OUTLIER_RADIUS_MILES : o.outlierRadiusMiles;
  const minCompany = o.outlierMinCompany == null ? OUTLIER_MIN_COMPANY : o.outlierMinCompany;
  const all = applyPinFallback(houses, o.pinFallback);
  const pinned = all.filter(hasPin);
  const unpinned = all.filter(function(h){ return !hasPin(h); });
  const outliers = [], kept = [];
  pinned.forEach(function(h){
    let company = 0;
    for(let i = 0; i < pinned.length; i++){
      const other = pinned[i];
      if(other === h) continue;
      if(distanceMiles(h.lat, h.lng, other.lat, other.lng) <= radius){
        company++;
        if(company >= minCompany) break;
      }
    }
    if(company >= minCompany) kept.push(h);
    else outliers.push({house: h, company: company, radius: radius});
  });
  /* ⚠ A HOUSE WITH NO PIN IS NOT AN OUTLIER, IT IS A DATA PROBLEM. Reported
     separately so it gets fixed rather than quietly posted to your dad. Health
     Check's "Customer with no map pin" is the row that catches these; on
     2026-08-22 it read all clear, so this list should normally be empty — and if
     it stops being empty, that is the signal to fill in the ladder hook above. */
  return {kept: kept, outliers: outliers, unpinned: unpinned};
}

/* ---------------- blocks ---------------- */

/* Split a run of houses into near-equal blocks of at most `cap`.
 * ⭐ NEAR-EQUAL, NOT GREEDY, AND THIS IS THE WHOLE POINT.
 * Taking twenty at a time off a run of twenty-one leaves a block of one — a one
 * man day, manufactured by the arithmetic rather than by the map. Splitting the
 * same run into eleven and ten gives two days a crew can actually work. The owner
 * has said repeatedly that a short day is tolerable and a lone day is not:
 * "one crews are fine what we want to minimize the most is one man days".
 * So the number of blocks is decided first — as few as will hold the run — and
 * then the run is dealt out evenly between them. */
export function splitRun(ids, cap){
  const size = cap || 20;
  const n = ids.length;
  if(!n) return [];
  const blocks = Math.ceil(n / size);
  const base = Math.floor(n / blocks);
  let extra = n % blocks;   /* the first `extra` blocks carry one more */
  const out = [];
  let at = 0;
  for(let b = 0; b < blocks; b++){
    const take = base + (extra > 0 ? 1 : 0);
    if(extra > 0) extra--;
    out.push(ids.slice(at, at + take));
    at += take;
  }
  return out;
}

/* The middle of a run, for deciding which runs are near each other. */
function runCentre(run){
  let la = 0, ln = 0;
  run.forEach(function(p){ la += p.house.lat; ln += p.house.lng; });
  return {lat: la / run.length, lng: ln / run.length};
}

/* ⭐ A THIN RUN IS THE STRANDING PROBLEM ONE LEVEL UP, AND IT HAS TO BE FIXED HERE.
 *
 * splitRun guarantees the blocks cut out of a run are near-equal, so a run of 21
 * can never become 20 + 1. It says nothing about a RUN of four. The curve gets cut
 * wherever it jumps more than MAX_CURVE_JUMP_MILES, and a small pocket of houses
 * with a gap either side of it comes off that cut as a run of four — which then
 * becomes a block of four, which is a morning of loading the truck for four houses.
 * Found by the synthetic book on 2026-08-22, which produced exactly one such block.
 *
 * These are NOT outliers. Each of those four has plenty of company inside the
 * outlier radius; what they lack is company on the CURVE. So they are merged into
 * the nearest run that will have them, smallest first, and the merged run is then
 * re-split near-equally — four joining a run of twenty comes back as twelve and
 * twelve rather than twenty and four.
 *
 * ⚠ THE MERGE IS BOUNDED, AND WHAT CANNOT MERGE GOES TO YOUR DAD. A run with
 * nothing inside MERGE_RADIUS_MILES is genuinely on its own, and quietly gluing it
 * onto the least-distant day would be sending a crew across the valley — the exact
 * thing MAX_CURVE_JUMP_MILES exists to prevent. It joins the outlier list instead,
 * with `stranded` set so the report can say why: this one is not far from
 * everybody, it is just far from anybody we are already going to be near.
 *
 * ⚠ APPENDED AT THE NEAR END, not concatenated blindly. Which end of the host run
 * a thin run joins decides whether the merged block is compact or is a barbell, and
 * splitRun cuts in list order, so the order here is what the crew ends up driving. */
export function mergeThinRuns(runs, opts){
  const o = opts || {};
  const minBlock = o.minBlockHouses == null ? MIN_BLOCK_HOUSES : o.minBlockHouses;
  const radius = o.mergeRadiusMiles == null ? MERGE_RADIUS_MILES : o.mergeRadiusMiles;
  const live = runs.slice();
  const stranded = [];
  let guard = 0;
  for(;;){
    if(guard++ > 10000) break;   /* cannot happen: every pass removes one run */
    /* Smallest thin run first — it is the one with the least to lose by moving,
       and doing them in a fixed order keeps the plan reproducible. */
    let worst = -1;
    live.forEach(function(r, i){
      if(r.length >= minBlock) return;
      if(worst === -1 || r.length < live[worst].length) worst = i;
    });
    if(worst === -1) break;
    const thin = live[worst];
    const centre = runCentre(thin);
    let best = -1, bestMiles = Infinity;
    live.forEach(function(r, i){
      if(i === worst) return;
      const c = runCentre(r);
      const m = distanceMiles(centre.lat, centre.lng, c.lat, c.lng);
      if(m < bestMiles){ bestMiles = m; best = i; }
    });
    live.splice(worst, 1);
    if(best === -1 || bestMiles > radius){
      /* Nothing within reach. Not a crew's job. */
      thin.forEach(function(p){ stranded.push(p.house); });
      continue;
    }
    if(best > worst) best--;   /* the splice above shifted everything after it */
    const host = live[best];
    /* Join at whichever end of the host is actually closer, so the merged run
       reads as one path rather than two lobes with a jump in the middle. */
    const headMiles = distanceMiles(centre.lat, centre.lng, host[0].house.lat, host[0].house.lng);
    const tailMiles = distanceMiles(centre.lat, centre.lng,
                                    host[host.length - 1].house.lat, host[host.length - 1].house.lng);
    live[best] = headMiles <= tailMiles ? thin.concat(host) : host.concat(thin);
  }
  return {runs: live, stranded: stranded};
}

/* ⭐ THE WHOLE BOOK, CUT INTO CREW-DAYS, IN ONE PASS.
 *
 * houses: [{id, lat, lng}] — anything else on the object is ignored and carried
 * nowhere, so this cannot accidentally depend on a customer field.
 *
 * Returns {blocks, outliers, unpinned}. A block is
 *   {id, ids, cells, centre:{lat,lng}, spreadMiles, count, estimated}
 * and carries no date, no crew and no town. Dates are the caller's job — that is
 * where the timing rules live, and they have not changed.
 *
 * ⚠ IT ASSIGNS EVERYBODY. Every pinned non-outlier house comes back in exactly
 * one block. A caller may then take fewer blocks than exist (because the season
 * is only so long), but nothing is dropped here, and nothing is held back for a
 * later pass — that is what makes the rim houses safe. */
export function planBlocks(houses, opts){
  const o = opts || {};
  const cap = o.cap || 20;
  const cellMiles = o.cellMiles == null ? GRID_CELL_MILES : o.cellMiles;
  const maxJump = o.maxCurveJumpMiles == null ? MAX_CURVE_JUMP_MILES : o.maxCurveJumpMiles;
  /* The curve is walked at a FINER resolution than the identity grid, so houses
     inside one cell still come off it in a sensible order rather than in
     whatever order they arrived. A sixteenth of a mile is about a house. */
  const fine = cellMiles / 16;

  const split = findOutliers(houses, o);
  const kept = split.kept;

  /* Position on the curve, and the stable cell name, worked out once each. */
  const placed = kept.map(function(h){
    const id = cellOf(h.lat, h.lng, cellMiles);
    const f = cellOf(h.lat, h.lng, fine);
    return {
      house: h,
      cell: cellKey(id.cx, id.cy),
      d: hilbertIndex(f.cx, f.cy, HILBERT_SIDE)
    };
  });
  /* Ties broken on id so the same book always gives the same plan — the office
     comparing two rebuilds should see real differences only. */
  placed.sort(function(a, b){
    return (a.d - b.d) || (String(a.house.id) < String(b.house.id) ? -1 : 1);
  });

  /* Cut the curve wherever it jumps. See MAX_CURVE_JUMP_MILES: a block that
     spans a jump is a crew crossing the valley in the middle of the morning. */
  const runs = [];
  let run = [];
  placed.forEach(function(p, i){
    if(i > 0){
      const prev = placed[i - 1];
      if(distanceMiles(prev.house.lat, prev.house.lng, p.house.lat, p.house.lng) > maxJump){
        runs.push(run); run = [];
      }
    }
    run.push(p);
  });
  if(run.length) runs.push(run);

  /* Pockets too thin to be a day join their nearest neighbour; the ones with no
     neighbour within reach are not a crew's job at all — see mergeThinRuns. */
  const merged = mergeThinRuns(runs, o);
  const outliers = split.outliers.concat(merged.stranded.map(function(h){
    return {house: h, company: null, radius: null, stranded: true};
  }));

  const blocks = [];
  merged.runs.forEach(function(r){
    splitRun(r, cap).forEach(function(part){
      let la = 0, ln = 0;
      part.forEach(function(p){ la += p.house.lat; ln += p.house.lng; });
      const centre = {lat: la / part.length, lng: ln / part.length};
      let spread = 0;
      for(let i = 0; i < part.length; i++){
        for(let j = i + 1; j < part.length; j++){
          const m = distanceMiles(part[i].house.lat, part[i].house.lng,
                                  part[j].house.lat, part[j].house.lng);
          if(m > spread) spread = m;
        }
      }
      const cells = [];
      part.forEach(function(p){ if(cells.indexOf(p.cell) === -1) cells.push(p.cell); });
      blocks.push({
        id: 'blk' + blocks.length,
        ids: part.map(function(p){ return p.house.id; }),
        count: part.length,
        cells: cells,
        centre: centre,
        spreadMiles: spread,
        /* True if any house here was placed by the fallback ladder rather than by
           its own geocode — see applyPinFallback. */
        estimated: part.some(function(p){ return !!p.house.estimated; })
      });
    });
  });

  return {blocks: blocks, outliers: outliers, unpinned: split.unpinned};
}

/* How re-placeable one house is — the eviction rule, in one number.
 * Owner, 2026-08-22, on which house comes off a full day: "it should evict the
 * one that will be best fit in a route for another day."
 * The house with the most company in its own cell is the one guaranteed a seat
 * somewhere else, so it is the one that can be bumped without stranding anybody.
 * The current rule in admin.html bumps whoever is last in driving order, which is
 * unrelated to whether they will ever get another chance.
 * ⚠ HIGHER MEANS SAFER TO BUMP. */
export function replaceability(house, pool, opts){
  const o = opts || {};
  const cellMiles = o.cellMiles == null ? GRID_CELL_MILES : o.cellMiles;
  if(!hasPin(house)) return 0;
  const mine = cellOf(house.lat, house.lng, cellMiles);
  const key = cellKey(mine.cx, mine.cy);
  let n = 0;
  (pool || []).forEach(function(other){
    if(other === house || !hasPin(other)) return;
    const c = cellOf(other.lat, other.lng, cellMiles);
    if(cellKey(c.cx, c.cy) === key) n++;
  });
  return n;
}
