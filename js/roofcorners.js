/* roofcorners.js — the corners, offered rather than hunted.
 *
 * Owner, 2026-08-22: "also start getting the generated corners and you can click the
 * ones you want to keep".
 *
 * So the tool proposes corners and she picks the ones she wants, instead of finding and
 * clicking every one by hand on every house.
 *
 * ⭐ WHERE THE CORNERS COME FROM. The roofline is already in the Street View depth map,
 * exactly and for free: plane 0 is sky, so for every column the first row that is NOT
 * sky is the silhouette of the house against the sky. That is the real roof edge, 512
 * columns across, with a measured distance at every point. Nothing has to be recognised.
 * The corners are the places where that line CHANGES DIRECTION.
 *
 * ⚠ THIS FILE DOES NOT RETURN A LAT/LNG, AND THAT IS DELIBERATE.
 * I first proposed that candidates need no north reference because they project straight
 * back to pixels. lanil-9d corrected me and was right: in this tool a dot IS a world
 * point — the sky view and the street view share one point set, and a dot survives a
 * camera move by being stored in the world. Turning (column, row, distance) into a world
 * point needs the bearing of that column, which is exactly the thing we tried six ways
 * to establish today and refuted.
 *
 * So the work is split where the evidence actually falls:
 *   THIS FILE knows which pixels are roof edge, how far away they are, how high, and how
 *   wide a feature is. All of that is azimuth-free and all of it is measured.
 *   THE CALLER knows where north is, because the rendered panorama does, and turns a
 *   candidate into a world point through the same path every hand-placed dot uses.
 *
 * A function here that returned a lat/lng would be lying, so none does.
 */

import { rayDirection, distanceAt, cameraHeight } from './svdepth.js';

/* ---------------- the silhouette ---------------- */

/* The house against the sky, one entry per column, null where there is nothing usable.
 *
 * ⚠ THE PLANE INDEX IS CARRIED THROUGH, and it is not decoration — see the tree test
 * below. It is the single most useful thing on this record and it costs nothing.
 * ⚠ A NULL IS AN HONEST GAP, never a filled-in guess: sky all the way down, or a surface
 * whose distance cannot be worked out. Joining across a gap would invent a corner where
 * there is only missing data. */
/* ⚠ 2.0 IS A PHYSICAL FLOOR, NOT A TUNED ONE — please do not nudge it by eye.
   Measured over five real panoramas, the height of the first non-sky, non-ground surface
   in each column is plainly bimodal: 76 columns between 0.5 and 2.0 m (fences, cars,
   bushes, hedges, and the secondary ground planes Google splits a street into), then a
   trough, then a broad structure population from 3 to 8.5 m. The trough bottoms out at
   2.5-3.0 m, so 2.5 would separate the two populations more cleanly — and it would be
   WRONG, because a single-storey eave is about 2.4 m (8 ft) and sits in exactly the bin
   that a cleaner-looking threshold would delete. Below 2 m nothing on a house is a roof
   edge; that is a door header. So the floor is set where physics puts it, and the
   clutter that gets through is knocked down afterwards by the churn and roughness tests,
   which is what they are for. */
export const SKYLINE_MIN_HEIGHT_M = 2.0;
/* Past 60 m one column spans 0.74 m, so a corner is no longer resolvable — and it is a
   neighbour's house or a hillside anyway. On the two panoramas that returned nothing at
   all, everything in view was beyond 71 m: open land, and no house is the honest answer. */
export const SKYLINE_MAX_DISTANCE_M = 60;

/* Which plane record is the ground the camera stands on: the biggest horizontal one.
 * Same rule cameraHeight() uses, and deliberately so — one ground, one answer. */
export function groundPlaneIndex(depth){
  const counts = new Array(depth.planeCount).fill(0);
  for(let i = 0; i < depth.indices.length; i++) counts[depth.indices[i]]++;
  let best = -1;
  for(let i = 1; i < depth.planes.length; i++){
    if(Math.abs(depth.planes[i].n[2]) < 0.9) continue;
    if(best < 0 || counts[i] > counts[best]) best = i;
  }
  return best;
}

/* ⚠ THE GROUND IS OFTEN MORE THAN ONE RECORD, and rejecting only the biggest leaves the
   others to be caught by the height floor alone. Found on a Columbus panorama: the plane
   directly under the camera and the plane groundPlaneIndex chose were DIFFERENT indices
   at the same 2.50 m — Google had split one road into two records. Every horizontal plane
   sitting at the camera's own height is ground, however many records it is spread over.
   A roof is never at the camera's feet, so nothing real is lost. */
export const GROUND_HEIGHT_TOLERANCE_M = 0.25;

export function groundPlaneIndices(depth, camH){
  const out = new Set();
  const h = (camH == null) ? cameraHeight(depth) : camH;
  const g = groundPlaneIndex(depth);
  if(g >= 0) out.add(g);
  if(h == null) return out;
  for(let i = 1; i < depth.planes.length; i++){
    const pl = depth.planes[i];
    if(Math.abs(pl.n[2]) < 0.9) continue;
    if(Math.abs(Math.abs(pl.d) - h) <= GROUND_HEIGHT_TOLERANCE_M) out.add(i);
  }
  return out;
}

/* Is column x inside the caller's window? A window may wrap past column 0, because
 * a house can straddle the seam of the panorama and nothing about that is exceptional. */
export function inColumnWindow(x, width, win){
  if(!win || win.from == null || win.to == null) return true;
  const w = width, a = ((win.from % w) + w) % w, b = ((win.to % w) + w) % w;
  return (a <= b) ? (x >= a && x <= b) : (x >= a || x <= b);
}

export function skylineOf(depth, opts){
  const o = opts || {};
  const win = o.columns || null;
  const minH = o.minHeightM == null ? SKYLINE_MIN_HEIGHT_M : o.minHeightM;
  const maxD = o.maxDistanceM == null ? SKYLINE_MAX_DISTANCE_M : o.maxDistanceM;
  const camH = (o.cameraHeightM != null) ? Number(o.cameraHeightM) : cameraHeight(depth);
  const ground = groundPlaneIndices(depth, camH);
  const out = new Array(depth.width).fill(null);
  for(let x = 0; x < depth.width; x++){
    if(!inColumnWindow(x, depth.width, win)) continue;
    let y = 0;
    while(y < depth.height && depth.indices[y * depth.width + x] === 0) y++;
    if(y >= depth.height) continue;
    const idx = depth.indices[y * depth.width + x];
    if(!depth.planes[idx]) continue;
    /* ⚠ WHERE SKY MEETS GROUND IS THE HORIZON, NOT A ROOFLINE — the bug real data found
       and every synthetic fixture missed. On the yard panorama the first non-sky row in
       200-odd columns was the distant ground at the horizon: 81 m out, 0.1 m BELOW the
       camera’s feet, dead smooth, all one plane. It scored 1.00 and swamped the list.

       ⛔ AND DO NOT REJECT IT BY TILT. My first fix threw out any near-horizontal plane.
       That is wrong and it is worth saying loudly, because it looks right: a 4/12 pitch
       roof has |nz| = 0.95, FLATTER than the 0.9 bar. It threw away 304 of 512 columns
       on the very panorama it was meant to fix — every low-pitch roof face in the frame.
       There is no tilt that separates a roof from the ground, because there isn’t one.

       What separates them is identity and position, both of which we can measure:
         - the ground is ONE plane record. Reject that index, not a shape.
         - the horizon sits at roughly zero height. A roof does not.
         - past ~60 m a column is 0.74 m wide, so a corner is no longer resolvable
           anyway; those are neighbours’ houses and hillsides, not the subject. */
    if(ground.has(idx)) continue;
    const t = distanceAt(depth, x, y);
    if(t === null || t > maxD) continue;
    const v = rayDirection(x, y, depth.width, depth.height);
    const up = v[2] * t;
    if(camH != null && (camH + up) < minH) continue;
    out[x] = {
      x: x, y: y, distance: t,
      plane: idx,
      p: [v[0] * t, v[1] * t, up]            /* metres, camera at the origin */
    };
  }
  return out;
}

/* ---------------- geometry ---------------- */

/* Distance from p to the segment ab, in METRES and in three dimensions.
 * ⚠ NOT IN PIXELS, and that is the whole reason a tolerance means anything here. The
 * same corner forty metres away subtends a fraction of the pixels it does at ten, so a
 * pixel tolerance quietly holds a far wing to a far looser standard than the near
 * garage. Metres hold both to the same real-world standard. */
export function segmentDistance(p, a, b){
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  let t = len2 > 1e-12 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
}

/* Douglas-Peucker: keep only the points a straight line cannot account for.
 * Iterative rather than recursive — a silhouette is not deep, but a recursion that CAN
 * blow the stack on strange input is a worse trade than a loop that cannot. */
export function simplifyIndices(points, toleranceM){
  const n = points.length;
  if(n < 3) return points.map(function(_, i){ return i; });
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack = [[0, n - 1]];
  let guard = 0;
  while(stack.length && guard++ < 100000){
    const span = stack.pop(), lo = span[0], hi = span[1];
    let worst = -1, worstD = toleranceM;
    for(let i = lo + 1; i < hi; i++){
      const d = segmentDistance(points[i].p, points[lo].p, points[hi].p);
      if(d > worstD){ worstD = d; worst = i; }
    }
    if(worst !== -1){ keep[worst] = true; stack.push([lo, worst], [worst, hi]); }
  }
  const out = [];
  for(let i = 0; i < n; i++) if(keep[i]) out.push(i);
  return out;
}

/* ---------------- what is not a roof ---------------- */

/* ⭐ THE TREE TEST, and the good version of it is lanil-9d's, not mine.
 *
 * My first idea was jaggedness — a roof edge is piecewise straight, foliage is not. That
 * works but it is weak, because it cannot tell a tree from a genuinely fussy roofline.
 *
 * His is better and it is free from data already on the record: A ROOF EDGE HOLDS ONE
 * PLANE ALONG ITS WHOLE LENGTH. Consecutive silhouette points on a real roof share a
 * plane index, because they are the top of one flat face. A tree's outline does not —
 * it wanders between many small planes at slightly different depths, because that is
 * what a canopy is.
 *
 * So this counts how many DISTINCT planes the silhouette uses across a window. One or
 * two is a roof and its neighbour. Many is a canopy.
 *
 * ⚠ IT LOWERS CONFIDENCE, IT DOES NOT DELETE. It cannot prove a tree, and the whole
 * design is "click the ones you want to keep" — so a candidate the office can see is a
 * real corner must still be there to click. Deleting on a guess is the one thing this
 * must not do.
 * ⚠ AND IT IS UNTESTED ON A REAL TREE. lanil-9d reports the big conifer on the test
 * house is opaque in the depth map — it returns real vertical planes at 15-25 m, not sky
 * — so it WILL generate candidates. Whether this rejects them is the first thing to
 * check against that house. */
/* ⛔ NULL MEANS "I CANNOT TELL YOU", AND IT HAS TO, because the caller now decides what
   to do instead. An image-derived silhouette has no plane indices at all; counting
   `undefined` as one distinct plane would return {planes: 1} — a confident "not a tree"
   built out of no evidence — and the reversal fallback below would never fire, because
   it fires on the absence of an answer. That is the silent dud in its purest form: every
   test still green, every tree waved through. So a point with no plane index is not a
   sample, and no samples is null. */
export function planeChurn(line, i, window){
  const lo = Math.max(0, i - window), hi = Math.min(line.length - 1, i + window);
  const seen = {};
  let n = 0;
  for(let k = lo; k <= hi; k++){
    if(!line[k] || line[k].plane == null) continue;
    seen[line[k].plane] = 1; n++;
  }
  return n ? {planes: Object.keys(seen).length, samples: n} : null;
}

/* How far the silhouette wanders from its own local straight line, in metres.
 * Kept as a second opinion: it catches foliage that happens to sit on few planes, and
 * plane churn catches foliage that happens to look locally straight. They fail
 * differently, which is the only reason to have both. */
/* ⚠ MEASURED ON EACH SIDE SEPARATELY, NOT ACROSS THE POINT. The first version of this
   spanned the corner itself, so it reported a clean gable peak as "broken up" — of
   course it did: a corner IS a departure from the straight line through it, and that is
   the thing we are looking for, not a fault. A real corner has two STRAIGHT sides; a
   tree has two rough ones. So each side is measured against its own line and the worse
   of the two is returned. Caught by a synthetic gable scoring 0.11 when it should have
   scored 1. */
export function roughnessAt(line, i, window){
  function sideRoughness(from, to){
    const a = line[from], b = line[to];
    if(!a || !b) return null;
    const lo = Math.min(from, to), hi = Math.max(from, to);
    if(hi - lo < 2) return null;
    let sum = 0, n = 0;
    for(let k = lo; k <= hi; k++){
      if(!line[k]) continue;
      sum += segmentDistance(line[k].p, a.p, b.p); n++;
    }
    return n ? sum / n : null;
  }
  const left = sideRoughness(Math.max(0, i - window), i);
  const right = sideRoughness(i, Math.min(line.length - 1, i + window));
  const vals = [left, right].filter(function(v){ return v != null; });
  if(!vals.length) return null;
  return Math.max.apply(null, vals);
}

/* ⭐ THE TREE TEST FOR SILHOUETTES THAT HAVE NO PLANE INDICES.
 * planeChurn is the better discriminator and stays the default, but it needs the depth
 * map's plane records. lanil-9d is building a silhouette from the RENDERED IMAGE, where
 * every column's true heading is known exactly and no plane index exists at all. Passing
 * plane:null there would not crash — it would just silently stop demoting trees and make
 * everything look confident, which is the worst thing a click-to-keep tool can do.
 *
 * So: count direction reversals. A roof edge is piecewise straight and hardly reverses;
 * a canopy reverses constantly. Purely geometric, nothing but the silhouette.
 *
 * ⚠ MEASURED, NOT ASSUMED — 365 silhouette points across eight real panoramas, scored
 * against the plane test's own verdict. Mean reversals by the plane count seen:
 *      planes 1 -> 0.72     planes 4 -> 3.70
 *      planes 2 -> 1.45     planes 5 -> 4.41
 *      planes 3 -> 3.09     planes 6 -> 5.47
 * Monotone across the whole range, which is what makes it a substitute rather than a
 * threshold that happens to agree: the two measures are tracking the same thing. At a
 * straight cut it agrees with the plane test 86% of the time, catching 95% of trees for
 * 29% of roofs demoted — so it is used GRADED, exactly as the plane test is, and it only
 * ever lowers confidence. Nothing is deleted on it.
 *
 * ⛔ IT IS A FALLBACK, NOT AN EQUAL. Where plane indices exist, use them. */
export const REVERSAL_WINDOW = 6;
export const REVERSAL_LIMIT = 3;
export const REVERSAL_FLAT_M = 0.02;      /* smaller than this is flat, not a direction */

export function directionReversals(line, i, window){
  const w = window == null ? REVERSAL_WINDOW : window;
  const lo = Math.max(1, i - w), hi = Math.min(line.length - 2, i + w);
  if(hi - lo < 2) return null;
  let n = 0, prev = 0;
  for(let k = lo; k <= hi; k++){
    if(!line[k] || !line[k + 1]) continue;
    const d = line[k + 1].p[2] - line[k].p[2];
    if(Math.abs(d) < REVERSAL_FLAT_M) continue;
    const sign = d > 0 ? 1 : -1;
    if(prev && sign !== prev) n++;
    prev = sign;
  }
  return n;
}

/* ---------------- the candidates ---------------- */

export const CORNER_TOLERANCE_M = 0.35;   /* how far off a straight line earns a corner */
export const SPIKE_WINDOW_COLS = 6;       /* narrow against a roofline that runs for dozens */
export const CHURN_WINDOW = 6;
export const CHURN_LIMIT = 3;             /* distinct planes across the window before it reads as canopy */
export const ROUGHNESS_LIMIT_M = 0.30;
export const DEPTH_EDGE_RATIO = 1.3;      /* neighbours this far apart is an overlap, not a slope */

/* ⭐ THE CORNERS THIS PANORAMA CAN OFFER, best first.
 *
 * Each candidate carries:
 *   column, row     where it is in the DEPTH MAP — the caller maps this to a screen
 *                   pixel and from there to a world point. No lat/lng here; see the
 *                   top. `col` is kept as an alias so either spelling works.
 *                   ⭐ THIS IS THE AGREED SEAM with lanil-9d's rmCornerCandidates:
 *                   { column, row, distanceM, heightM, spikeWidthCols } plus the
 *                   skyline array, and he supplies north from the rendered panorama.
 *                   ⭐ TWO OPTIONS THE CALLER WILL WANT, both learned from real
 *                   panoramas: `columns: {from, to}` restricts the search to the house
 *                   being measured — a panorama is 360 degrees and without a window it
 *                   offers twenty-odd rings including the neighbours' — and `limit: n`
 *                   caps how many come back. The window may wrap past column 0.
 *   distanceM       measured, from the depth map
 *   heightM         measured, above the ground the camera stands on
 *   spikeWidthCols  how narrow the feature is — small means chimney, vent or aerial
 *   planes          how many distinct planes the silhouette uses nearby — many means tree
 *   confidence      0..1
 *   why             plain words, so a low score can be explained instead of just shown
 *
 * ⚠ NOTHING IS AUTO-ACCEPTED, ever. Every one is a suggestion for somebody to click.
 * That is the instruction and it is also the only safe design — the office can see the
 * house and this cannot. */
export function roofCornerCandidates(depth, opts){
  const o = opts || {};
  const tol = o.toleranceM == null ? CORNER_TOLERANCE_M : o.toleranceM;
  const spikeCols = o.spikeWindowCols == null ? SPIKE_WINDOW_COLS : o.spikeWindowCols;
  const churnLimit = o.churnLimit == null ? CHURN_LIMIT : o.churnLimit;
  const roughLimit = o.roughnessLimitM == null ? ROUGHNESS_LIMIT_M : o.roughnessLimitM;
  const camH = (o.cameraHeightM != null) ? Number(o.cameraHeightM) : cameraHeight(depth);

  const line = (o.skyline) ? o.skyline : skylineOf(depth, o);

  /* Unbroken stretches only. A gap is a real discontinuity. */
  const runs = [];
  let cur = [];
  for(let x = 0; x < line.length; x++){
    if(line[x]) cur.push(line[x]);
    else { if(cur.length > 2) runs.push(cur); cur = []; }
  }
  if(cur.length > 2) runs.push(cur);

  const out = [];
  runs.forEach(function(run){
    simplifyIndices(run, tol).forEach(function(i){
      /* The ends of a stretch are the edge of what is VISIBLE, not corners of the roof.
         Offering them puts a dot on the boundary of the picture. */
      if(i === 0 || i === run.length - 1) return;

      /* ⭐ WHEN TWO THINGS OVERLAP, THE CORNER BELONGS TO THE ONE IN FRONT.
         40% of candidates on real panoramas sit where the silhouette steps in depth —
         a roof ending against a further roof, a wall against a distant tree. The column
         is a real corner either way, but its 3D point can be taken from either side, and
         the two are metres apart. On the yard the best candidate of the whole set (0.95)
         had 13.3 m on one side and 26.0 m on the other, and took 26.6 — putting the dot
         on the neighbour's building, thirteen metres behind the roof it came from.
         The near surface is the thing whose outline this is, so the near surface owns
         the corner. Say so on the record too: an overlap is worth knowing about when
         you are deciding whether to keep a suggestion. */
      let pt = run[i];
      let onDepthEdge = false;
      const dl = run[i - 1] ? run[i - 1].distance : null;
      const dr = run[i + 1] ? run[i + 1].distance : null;
      if(dl != null && dr != null){
        const near = Math.min(dl, dr), far = Math.max(dl, dr);
        if(near > 0 && far / near > DEPTH_EDGE_RATIO){
          onDepthEdge = true;
          if(pt.distance > near * DEPTH_EDGE_RATIO) pt = (dl < dr) ? run[i - 1] : run[i + 1];
        }
      }
      const churn = planeChurn(run, i, CHURN_WINDOW);
      const rough = roughnessAt(run, i, CHURN_WINDOW);

      /* ⭐ HOW WIDE THE FEATURE IS, measured against a chord that spans WELL BEYOND it.
         ⚠ THE OBVIOUS VERSION IS BACKWARDS, and I wrote it that way first: "grow the
         window until the point sits close to its own chord" returns 2 for EVERYTHING,
         because any point is nearly collinear with its immediate neighbours. A synthetic
         gable came back as five 2-column spikes, which is what caught it.
         What actually separates a chimney from a gable is how many CONSECUTIVE columns
         depart from the surrounding roofline. A chimney lifts two or three columns and
         the rest of the roof carries straight on; a gable lifts dozens. So: take a chord
         across a wide span, then count the unbroken block of columns around this point
         that stand off it. */
      const far = spikeCols * 3;
      const a = run[Math.max(0, i - far)], b = run[Math.min(run.length - 1, i + far)];
      let width = run.length;
      if(a && b && a !== b){
        let l = i, r = i;
        while(l - 1 >= 0 && run[l - 1] && segmentDistance(run[l - 1].p, a.p, b.p) > tol) l--;
        while(r + 1 < run.length && run[r + 1] && segmentDistance(run[r + 1].p, a.p, b.p) > tol) r++;
        width = r - l + 1;
      }

      let confidence = 1;
      const why = [];
      if(churn && churn.planes >= churnLimit){
        confidence *= Math.max(0.15, (churnLimit - 1) / churn.planes);
        why.push('the outline changes surface ' + churn.planes + ' times just here — ' +
                 'a roof edge holds one face, so this is likely a tree');
      } else if(!churn){
        /* No plane indices — an image-derived silhouette. Fall back to the shape itself. */
        const rev = directionReversals(run, i, CHURN_WINDOW);
        if(rev != null && rev >= REVERSAL_LIMIT){
          confidence *= Math.max(0.15, (REVERSAL_LIMIT - 1) / rev);
          why.push('the outline doubles back ' + rev + ' times just here — a roof edge ' +
                   'runs straight, so this is likely a tree');
        }
      }
      if(rough != null && rough > roughLimit){
        confidence *= Math.max(0.25, roughLimit / rough);
        why.push('the outline is broken up rather than straight');
      }
      if(width <= spikeCols){
        confidence *= 0.25;
        why.push('only ' + width + ' columns wide — likely a chimney, vent or aerial ' +
                 'rather than a corner of the roof');
      }
      if(onDepthEdge) why.push('the outline steps in depth here — two things overlap, ' +
                               'so this point is taken from the nearer one');
      out.push({
        column: pt.x, col: pt.x, row: pt.y,
        onDepthEdge: onDepthEdge,
        distanceM: pt.distance,
        heightM: (camH != null) ? camH + pt.p[2] : null,
        local: {x: pt.p[0], y: pt.p[1], up: pt.p[2]},
        spikeWidthCols: width,
        planes: churn ? churn.planes : null,
        roughnessM: rough,
        confidence: Math.max(0, Math.min(1, confidence)),
        why: why.length ? why.join('; ') : 'a clean change of direction in the roofline'
      });
    });
  });
  out.sort(function(a, b){ return b.confidence - a.confidence; });

  /* ⚠ ONE RING PER PIXEL. Found on the Kaysville panorama: column 201 came back THREE
     times, identical in every field. Two things put more than one candidate on a column —
     Douglas-Peucker keeping neighbouring indices that the depth-edge shift then slides
     onto the SAME near-side point, and separate runs that overlap after that shift. On
     screen that is three rings stacked on one pixel, and the office clicks what it thinks
     is one corner and keeps three. Best confidence wins, since the list is already
     sorted. */
  const seenCol = new Set();
  const unique = out.filter(function(c){
    const key = c.column + ':' + c.row;
    if(seenCol.has(key)) return false;
    seenCol.add(key);
    return true;
  });
  return (o.limit > 0) ? unique.slice(0, o.limit) : unique;
}

/* ---------------- what to tell the office ---------------- */

export const CONFIDENT_AT = 0.6;

/* ⭐ HOW HIGH THIS DEPTH MAP MODELS ANYTHING AT ALL, in degrees above the horizon.
 *
 * ⛔ THIS IS THE LIMIT OF THE WHOLE DEPTH-MAP APPROACH AND IT IS WORTH SAYING PLAINLY.
 * Measured on eight residential panoramas — Lehi, American Fork, Salt Lake City,
 * Kaysville — the topmost modelled row sits at 106 to 113 of 256 every single time:
 * 10 to 15 degrees above the horizon, and nothing above it.
 *
 * That is NOT the file format running out. Downtown panoramas reach far higher on the
 * same decoder: Manhattan 83.6 deg, Wall Street 78.0, Chicago 73.8. The format is fine.
 * Residential depth maps simply do not contain the houses' upper parts, which matches
 * lanil-9d's finding that they omit vegetation too — coarse plane fits keep roads and
 * large distant surfaces and drop small near ones.
 *
 * ⚠ THE CONSEQUENCE IS ARITHMETIC. A roof edge is only in the data if it subtends less
 * than the coverage angle, so a house must be at least
 *        (roofHeight - cameraHeight) / tan(coverage)
 * away — about 16 m for an ordinary 6 m roofline at 12 degrees. Closer than that and the
 * roofline is above the ceiling and is not there to be found. On the Salt Lake panorama
 * with the house 5.7 m away, the subject was absent entirely and every candidate came
 * from neighbours across the street, one of them at full confidence. That is the failure
 * this function exists to let the caller catch. */
export function maxElevationDeg(depth){
  for(let y = 0; y < depth.height; y++){
    for(let x = 0; x < depth.width; x++)
      if(depth.indices[y * depth.width + x] !== 0)
        return 90 - 180 * y / (depth.height - 1);
  }
  return null;
}

/* The nearest a house can be and still have its roofline inside the depth map. */
export function nearestUsableDistanceM(depth, roofHeightM, cameraHeightM){
  const elev = maxElevationDeg(depth);
  if(elev == null || elev <= 0) return null;
  const camH = (cameraHeightM == null) ? cameraHeight(depth) : cameraHeightM;
  const rise = (roofHeightM == null ? 6 : roofHeightM) - (camH == null ? 2.5 : camH);
  if(!(rise > 0)) return 0;
  return rise / Math.tan(elev * Math.PI / 180);
}

/* ⭐ SO THE SCREEN CAN SAY SOMETHING TRUE INSTEAD OF SHOWING RINGS AND HOPING.
 * Real panoramas produce three outcomes and only one of them is "here are your corners":
 *   - a house in view, corners found                      → offer them
 *   - a house in view but the outline is a tree or a mess → offer them, but say so
 *   - nothing within 60 m                                 → say THAT, and say why
 * The third is not a failure. Two of the ten places tested had no building in range at
 * all, and every candidate was correctly refused; a screen that just showed an empty
 * canvas would read as broken. The office is owed the reason either way. */
export function describeCandidates(list, skyline, opts){
  const o = opts || {};
  const c = list || [];
  const confident = c.filter(function(x){ return x.confidence >= CONFIDENT_AT; });
  const seen = skyline ? skyline.filter(Boolean).length : null;
  let message;
  /* ⛔ THE SUBJECT IS TOO CLOSE TO BE IN THE DATA — checked FIRST, because this outcome
     is the dangerous one. It does not look like a failure: candidates come back, some at
     full confidence, and they are the neighbours' houses. */
  if(o.subjectDistanceM != null && o.nearestUsableM != null &&
     o.subjectDistanceM < o.nearestUsableM){
    return {
      total: c.length, confident: confident.length,
      best: c.length ? c[0].confidence : null, columnsSeen: seen,
      subjectOutOfRange: true,
      message: 'This panorama is ' + o.subjectDistanceM.toFixed(0) + ' m from the house, ' +
               'and its depth map only reaches ' + o.nearestUsableM.toFixed(0) + ' m — the ' +
               'roofline is above everything it recorded. Anything offered here belongs to ' +
               'another building. Use a panorama further back, or place the corners by hand.'
    };
  }
  if(seen === 0)
    message = 'Nothing within 60 m of the camera to draw — no roofline is in view from here. ' +
              'Try a panorama nearer the house.';
  else if(!c.length)
    message = 'A surface is in view but its outline never changes direction, so there is ' +
              'no corner to offer. A flat gutter run looks exactly like this.';
  else if(!confident.length)
    message = 'Nothing here is worth trusting — ' + c[0].why + '. Every suggestion is ' +
              'shown faintly; place the corners by hand if the picture disagrees.';
  else
    message = confident.length + (confident.length === 1 ? ' corner looks' : ' corners look') +
              ' right, out of ' + c.length + ' suggested. Click the ones you want to keep.';
  return {
    total: c.length,
    confident: confident.length,
    best: c.length ? c[0].confidence : null,
    columnsSeen: seen,
    subjectOutOfRange: false,
    message: message
  };
}
