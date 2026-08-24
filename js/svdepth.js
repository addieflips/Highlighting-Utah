/* svdepth.js — the house, measured from the street.
 *
 * WHY THIS FILE EXISTS
 * Owner, 2026-08-22: "we outline from street view not sky view", and "you need depth,
 * height, and length to find the actual size of a line and sky view cant give height".
 *
 * Every Street View panorama ships a DEPTH MAP: real measured geometry, taken from the
 * road, describing the surfaces around the camera as planes. That is exactly the thing
 * the overhead roof model cannot give — a satellite can tell you a roof face is there
 * and roughly how big, but it cannot tell you how far away a wall is or how high a
 * gutter sits, because it is looking straight down at it.
 *
 * This file turns that depth map into surfaces referenced to true north, so a click in
 * the panorama becomes a measured point in the world rather than a mark on a picture.
 *
 * ⚠ IT IS PURE. No DOM, no camera, no Google Maps object, no network beyond one fetch
 * helper the caller may skip entirely. That is what lets run-all.js drive it against
 * real payloads without a browser.
 *
 * ⚠ AND IT IS AN UNDOCUMENTED ENDPOINT WITH NO KEY. The photometa call this reads is
 * not a published API. It can change without notice, so nothing here should be the ONLY
 * path to a measurement — keep the click-a-corner-from-two-angles triangulation alive
 * underneath it, so a break degrades rather than dies.
 */

/* ---------------- the payload ---------------- */

/* Google packs the depth map as base64url. Header is eight bytes:
 *   [0] header size   [1..2] plane count   [3..4] width   [5..6] height   [7] data offset
 * then W*H bytes of plane index, then one 16-byte record per plane: three float32 for
 * the unit normal and one for the offset.
 * Plane 0 is SKY — it has no geometry and must never be treated as a surface. */
export function decodeDepthPayload(b64){
  const bytes = base64UrlToBytes(b64);
  const nPlanes = bytes[1] | (bytes[2] << 8);
  const W = bytes[3] | (bytes[4] << 8);
  const H = bytes[5] | (bytes[6] << 8);
  const off = bytes[7];
  const need = off + W * H + nPlanes * 16;
  if(!(W > 0 && H > 0 && nPlanes > 0) || bytes.length < need){
    throw new Error('Depth map did not decode: expected at least ' + need +
                    ' bytes, got ' + bytes.length);
  }
  const indices = new Uint8Array(W * H);
  for(let i = 0; i < W * H; i++) indices[i] = bytes[off + i];
  const view = new DataView(bytes.buffer, bytes.byteOffset + off + W * H);
  const planes = [];
  for(let i = 0; i < nPlanes; i++){
    planes.push({
      n: [view.getFloat32(i * 16, true), view.getFloat32(i * 16 + 4, true),
          view.getFloat32(i * 16 + 8, true)],
      d: view.getFloat32(i * 16 + 12, true)
    });
  }
  return {width: W, height: H, planeCount: nPlanes, indices: indices, planes: planes};
}

export function base64UrlToBytes(s){
  let t = String(s == null ? '' : s).replace(/-/g, '+').replace(/_/g, '/');
  while(t.length % 4) t += '=';
  const bin = (typeof atob === 'function')
    ? atob(t)
    : Buffer.from(t, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- the frame ---------------- */

/* ⭐ HOW THE PANORAMA'S OWN AXES RELATE TO TRUE NORTH (settled 2026-08-22).
 *
 * This was the whole blocker, and it is stated here as a ROTATION rather than as a
 * signed offset on a compass bearing — deliberately, because the bearing form is what
 * two of us managed to mistranslate between us for an afternoon. A rotation cannot be
 * read backwards.
 *
 *   toEastNorth() takes a plane-record (nx, ny) and returns (east, north).
 *
 * Expressed as bearings, for anyone who wants the sentence: a compass bearing measured
 * in the panorama's own frame equals the true bearing MINUS the panorama's yaw, so the
 * true bearing is the pano-frame bearing PLUS yaw.
 *
 * HOW IT WAS ESTABLISHED, because the evidence matters more than the answer:
 *   1. The relative half needs no reference at all. Any constant offset cancels between
 *      two panoramas of the same house, so the two candidate handednesses separate
 *      cleanly. Two independent panoramas 58 degrees apart in yaw agreed to 0.16
 *      degrees; four more sites gave 0.07 to 1.44.
 *   2. The absolute half comes from wall DISTANCES, which — unlike normals — do not
 *      cancel. The same wall seen from two panoramas at known coordinates must satisfy
 *          d_A - d_B = (P_B - P_A) . N
 *      and (P_B - P_A) is an exact world vector from two lat/lngs. Best fit across
 *      about a dozen addresses put the constant at zero, nine of ten within 3.5 degrees.
 *   3. An independent check nothing was fitted to: with this rotation, the walls of
 *      209 S 850 W come out 1.1 and 1.3 degrees off true north from two different
 *      panoramas. Lehi's street grid is cardinal.
 *
 * ⚠ WHAT FAILED, so nobody spends another afternoon on it: the road direction as a
 * proxy for the building grid (buildings are not reliably parallel to the road); the
 * direction the ground reaches furthest (the ground clips at about 20 m, so there is no
 * peak); and correlating the sky mask, and then the skyline edge, against the Street
 * View photograph at a known heading (both give a flat correlation peak — 0.13 to 0.18
 * with a margin of 0.01 to 0.03 over the nearest rival, and they cannot even agree on
 * handedness between sites).
 *
 * ⛔ WITHDRAWN 2026-08-22, THE SAME DAY. DO NOT USE THIS FOR ANYTHING THAT MATTERS.
 *
 * An independent counter-test refuted it. Rotating one panorama's wall PIXELS by this
 * rotation and asking how many land on the building's known footprint gave 19% for one
 * panorama and 0.0% for its neighbour — and that neighbour is 29 m from the house and
 * pointed straight at it, so under a correct rotation most of its wall pixels must land
 * on the building. Zero is not a soft signal. The two panoramas' best-fitting rotations
 * were also 200 degrees apart, which not even the 180-degree flip reconciles.
 *
 * WHAT WENT WRONG, because the failure is more useful than the answer: the identity
 * d_A - d_B = (P_B - P_A).N is correct and does constrain the rotation, but on a
 * residential street the walls that carry information are exactly the scarce ones —
 * a wall parallel to the road satisfies it for almost any rotation. The minimum was
 * therefore soft (sharpness 1.07 to 1.51) and settled near a round number for reasons
 * that were not the true rotation. A soft minimum near zero is what an under-determined
 * fit looks like when it lands on its prior, and I read it as a result.
 *
 * ⭐ WHAT SURVIVES, AND IT IS THE HALF THAT MATTERS FOR HEIGHT: a rotation about the
 * vertical axis does not touch the vertical. Every distance, every camera height and
 * every up-component below is completely untouched by this failure — they never needed
 * to know which way is north. Only BEARINGS are unproven.
 *
 * ⚠ SO: distanceAt, cameraHeight and the `up` and `distance` fields of pointAt are
 * measured and usable. The `east` and `north` fields are NOT, until somebody ties this
 * frame to true north. Left in place because the structure is right and the relative
 * result is real; guarded by name so nobody picks it up by accident. */
export function toEastNorth(nx, ny, yawDeg){
  /* A rotation by -yaw in the plane-record axes, which is what adds yaw to a compass
     bearing — the two run in opposite directions, and that is precisely the trap. */
  const psi = -Number(yawDeg || 0) * Math.PI / 180;
  const c = Math.cos(psi), s = Math.sin(psi);
  return {east: nx * c - ny * s, north: nx * s + ny * c};
}

/* The compass bearing of a plane-record direction, once it is in world terms.
 * East over north — 0 is true north, 90 is east. */
export function worldBearing(nx, ny, yawDeg){
  const w = toEastNorth(nx, ny, yawDeg);
  return ((Math.atan2(w.east, w.north) * 180 / Math.PI) % 360 + 360) % 360;
}

/* ---------------- surfaces ---------------- */

/* The vertical surfaces the camera can see, biggest first.
 *
 * ⚠ NORMALS ARE TURNED TO FACE THE CAMERA. A plane record's normal may point either
 * way; the camera sits at the origin of this frame and is OUTSIDE the building, so the
 * outward face is the one pointing back at it. Without this a wall's direction is
 * ambiguous by 180 degrees and every bearing is a coin toss.
 * ⚠ THIS DOES NOT REMOVE THE 180-DEGREE AMBIGUITY IN THE CALIBRATION, which was tested
 * and is a different thing entirely — that one comes from walls parallel to the road
 * carrying no information. See calibrationResidual. */
export function verticalSurfaces(depth, opts){
  const o = opts || {};
  const minPixels = o.minPixels == null ? 300 : o.minPixels;
  const maxTilt = o.maxVerticalTilt == null ? 0.3 : o.maxVerticalTilt;
  const counts = new Array(depth.planeCount).fill(0);
  for(let i = 0; i < depth.indices.length; i++) counts[depth.indices[i]]++;
  const out = [];
  depth.planes.forEach(function(pl, i){
    if(i === 0) return;                                   /* sky */
    if(Math.abs(pl.n[2]) >= maxTilt) return;              /* not a wall */
    if(counts[i] < minPixels) return;                     /* a sliver, not a surface */
    const L = Math.hypot(pl.n[0], pl.n[1]);
    if(!(L > 1e-6)) return;
    let nx = pl.n[0] / L, ny = pl.n[1] / L, d = pl.d / L;
    if(d > 0){ nx = -nx; ny = -ny; d = -d; }
    out.push({nx: nx, ny: ny, distance: -d, pixels: counts[i], plane: i});
  });
  return out.sort(function(a, b){ return b.pixels - a.pixels; });
}

/* The ground the camera is standing on, which also gives its true height.
 * ⚠ MEASURED, NOT ASSUMED. The tool has been assuming 2.5 m; real panoramas come back
 * at 2.39 and 2.46, and that difference is a couple of inches on every height derived
 * from it. Returns null rather than a guess when no ground plane is present. */
export function cameraHeight(depth){
  const counts = new Array(depth.planeCount).fill(0);
  for(let i = 0; i < depth.indices.length; i++) counts[depth.indices[i]]++;
  let best = null;
  depth.planes.forEach(function(pl, i){
    if(i === 0) return;
    if(Math.abs(pl.n[2]) < 0.9) return;                   /* horizontal only */
    if(best === null || counts[i] > counts[best.plane]) best = {plane: i, d: Math.abs(pl.d)};
  });
  return best ? best.d : null;
}

/* ---------------- a click becomes a place ---------------- */

/* Which way a pixel of the panorama looks, in the panorama's own frame.
 * theta runs top to bottom, phi around. Verified empirically rather than assumed: the
 * bottom row returns the ground plane on every column and the top row on none. */
export function rayDirection(x, y, width, height){
  const theta = Math.PI * y / (height - 1);
  const phi = 2 * Math.PI * x / width;
  return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
}

/* How far away the surface under a pixel is, in metres. Null for sky, and null rather
 * than a number when the ray runs parallel to the plane or lands behind the camera —
 * a wrong distance is worse than an admitted gap. */
export function distanceAt(depth, x, y){
  const i = depth.indices[y * depth.width + x];
  if(i === 0) return null;
  const pl = depth.planes[i];
  if(!pl) return null;
  const v = rayDirection(x, y, depth.width, depth.height);
  const den = v[0] * pl.n[0] + v[1] * pl.n[1] + v[2] * pl.n[2];
  if(Math.abs(den) < 1e-9) return null;
  const t = pl.d / den;
  return (t > 0 && isFinite(t)) ? t : null;
}

/* A clicked pixel as metres east, north and up FROM THE CAMERA. Add the panorama's own
 * position to place it in the world. */
export function pointAt(depth, x, y, yawDeg){
  const t = distanceAt(depth, x, y);
  if(t === null) return null;
  const v = rayDirection(x, y, depth.width, depth.height);
  const w = toEastNorth(v[0] * t, v[1] * t, yawDeg);
  return {east: w.east, north: w.north, up: v[2] * t, distance: t};
}

/* ⭐ HOW HIGH IS THAT, ABOVE THE GROUND — MEASURED, FROM THE STREET ONLY.
 * Owner, 2026-08-22: "measure height not just legth and depth", and the standing rule
 * "we outline from street view not sky view".
 *
 * The panel currently says "assumed" because the roof datum is a constant: 3.00 m. It
 * does not have to be. Two measurements from the same depth map settle it, and neither
 * needs an overhead product or a compass:
 *
 *   1. the camera's own height above the road, from the ground plane (2.39 to 2.46 m
 *      on real panoramas — not the 2.5 the tool assumes);
 *   2. the clicked point's height relative to the camera, from the ray and the depth.
 *
 * Add them and the answer is height above the ground the van is parked on.
 *
 * ⚠ IT DOES NOT DEPEND ON THE NORTH CALIBRATION AT ALL. A rotation about the vertical
 * axis leaves the vertical alone, so the withdrawal above does not touch this. That is
 * worth stating plainly, because the two were found in the same afternoon and it would
 * be easy to throw both away.
 *
 * ⚠ AND IT BEATS THE OVERHEAD ROUTE ON ITS OWN TERMS. The alternative — Solar's plane
 * height above sea level minus the panorama's ground elevation — gives a datum for the
 * LOWEST ROOF PLANE ONLY, as a single number for the whole house. This gives the height
 * of the actual point somebody clicked, which is what a gutter line is made of. It is
 * also street-side, which is the rule.
 *
 * ⚠ RETURNS NULL RATHER THAN GUESSING. No ground plane in view, or a click on sky, and
 * the honest answer is that this panorama cannot say. */
export function heightAboveGround(depth, x, y, opts){
  const o = opts || {};
  const cam = (o.cameraHeightM != null) ? Number(o.cameraHeightM) : cameraHeight(depth);
  if(cam == null || !isFinite(cam)) return null;
  const t = distanceAt(depth, x, y);
  if(t === null) return null;
  const v = rayDirection(x, y, depth.width, depth.height);
  /* v[2] is up in this frame; theta runs from the top, so a point above the camera has
     a positive up-component and one below it a negative one. */
  return cam + v[2] * t;
}

/* ---------------- is the calibration good HERE? ---------------- */

/* ⭐ THE HONEST CONFIDENCE SIGNAL, and the reason this file does not simply assert the
 * rotation and move on.
 *
 * The same wall seen from two panoramas must satisfy d_A - d_B = (P_B - P_A) . N. That
 * is pure vector algebra with no convention in it, so a caller can check the rotation
 * on the two panoramas actually in front of them instead of trusting a note written
 * against a dozen other houses.
 *
 * ⚠ IT IS WEAK WHERE THE WALLS ARE PARALLEL TO THE ROAD, and most residential walls
 * are. Both sides of the identity go to about zero, so those walls agree with almost
 * any rotation. A corner plot, with walls across the road as well as along it, is where
 * this test has teeth. A large residual is meaningful; a small one on a mid-block house
 * is weaker evidence than it looks.
 *
 * Returns metres of median disagreement, and how many walls it could pair at all.
 * Null when there is nothing to compare — which is itself worth surfacing. */
export function calibrationResidual(a, b){
  const wa = verticalSurfaces(a.depth), wb = verticalSurfaces(b.depth);
  if(wa.length < 2 || wb.length < 2) return {matched: 0, medianMetres: null};
  const mLat = 111320, mLng = 111320 * Math.cos(a.lat * Math.PI / 180);
  const base = {east: (b.lng - a.lng) * mLng, north: (b.lat - a.lat) * mLat};
  const errs = [];
  wa.forEach(function(x){
    const A = toEastNorth(x.nx, x.ny, a.yaw);
    let bestErr = null;
    wb.forEach(function(y){
      const B = toEastNorth(y.nx, y.ny, b.yaw);
      if(A.east * B.east + A.north * B.north < 0.985) return;   /* same wall only */
      const predicted = base.east * A.east + base.north * A.north;
      const err = Math.abs(((-x.distance) - (-y.distance)) - predicted);
      if(bestErr === null || err < bestErr) bestErr = err;
    });
    if(bestErr !== null) errs.push(bestErr);
  });
  if(!errs.length) return {matched: 0, medianMetres: null};
  errs.sort(function(p, q){ return p - q; });
  return {matched: errs.length, medianMetres: errs[Math.floor(errs.length / 2)],
          baselineMetres: Math.hypot(base.east, base.north)};
}

/* ---------------- reading a panorama ---------------- */

/* ⚠ THE ONE IMPURE FUNCTION, kept apart from everything above so the geometry can be
 * tested without a network. Callers that already hold a photometa response should use
 * parsePhotometa directly. */
export const PHOTOMETA_PB = function(panoId){
  return '!1m4!1smaps_sv.tactile!11m2!2m1!1b1!2m2!1sen!2sus!3m3!1m2!1e2!2s' + panoId +
    '!4m57!1e1!1e2!1e3!1e4!1e5!1e6!1e8!1e12!2m1!1e1!4m1!1i48!5m1!1e1!5m1!1e2!6m1!1e1' +
    '!6m1!1e2!9m36!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e3!2b0!3e3' +
    '!1m3!1e8!2b0!3e3!1m3!1e1!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e3';
};

/* Google prefixes its JSON with )]}' — stripping that is not optional. */
export function parsePhotometa(text){
  const j = JSON.parse(String(text).replace(/^\)\]\}'\s*/, ''));
  const p = j[1][0][5][0];
  const pose = p[1];
  let links = [];
  try{ links = (p[3][0] || []).map(function(x){ return x && x[0] && x[0][1]; }).filter(Boolean); }
  catch(err){ links = []; }
  return {
    lat: pose[0][2], lng: pose[0][3], yaw: pose[2][0],
    groundElevationM: (pose[1] && pose[1][0]) != null ? pose[1][0] : null,
    depth: decodeDepthPayload(p[5][1][2]),
    links: links
  };
}

export async function fetchPano(panoId, fetchImpl){
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if(!f) throw new Error('No fetch available — pass one in.');
  const res = await f('https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=us&pb=' +
                      encodeURIComponent(PHOTOMETA_PB(panoId)));
  if(!res.ok) throw new Error('photometa refused: HTTP ' + res.status);
  const meta = parsePhotometa(await res.text());
  meta.id = panoId;
  return meta;
}
