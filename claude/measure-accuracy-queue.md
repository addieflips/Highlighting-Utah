# Measure Roof — accuracy work, what is done and what is queued

Working notes for the `claude/dot-accuracy` branch. Not loaded by anything.
Owner's instructions, 2026-08-25, in the order they were given.

## Done on this branch

**Each view drags the one axis it can actually see.** Shift-drag in Street View
changes the height only, holding the plan position exactly (height = horizontal
distance x tan(elevation), which touches neither east nor north). Shift-drag on
the Sky View moves the dot across the roof and leaves the height alone.

Why that split, beyond it being what was asked for: from the street the unknown
is DEPTH along the ray, so plan position is the one thing that view cannot
judge; from above there is no height in the picture at all. Letting either view
drag the number it cannot see is how a confident wrong answer gets made.

## Measured, 2026-08-25 — what the drift actually is

Taken off the live tool on the test house, 209 S 850 W:

- `driftPerFtFt` is 0.55 to 0.59 on that camera. Every foot of DEPTH error shows
  as about six inches of apparent movement when the camera moves. Drift is
  always a depth error; a point at the right place cannot move when the camera
  does.
- A gutter dot's depth currently comes from Google's roof planes or the
  footprint wall. The roof planes are the shallow-angle surface, so a foot of
  height error slides the crossing several feet along the ray, and all of that
  lands in the plan position — which is exactly "street view looks right, sky
  view is way off".

### Street View depth maps were tried and DO NOT answer this

`js/svdepth.js` decodes them and the maths is sound. Two things were confirmed
against the real panorama `rijaVLmbQ32UluJPvFy35A`:

1. The pixel convention, which the file did not have written down:
   `phi = (trueBearing + panoYaw - 90) mod 360`, `x = phi/360*W`,
   `theta = 90 - elevation`, `y = theta/180*(H-1)`.
   Verified: straight down reads 2.4645 m against a camera height of 2.4638 m
   computed independently from the ground plane — agreement to under a
   millimetre. The horizon scan puts the house at 20-22 m across bearings 45-90,
   matching the known 27.5 m to the house centre.
2. And it is still no use for a ROOFLINE. Sampled around a real gutter dot, a
   7x12 pixel neighbourhood came back almost entirely SKY, with a scattered
   handful of readings at 97-114 ft when the dot is at 75 ft — a distant surface
   behind the house, not this roof. The map is 512x256, which is 0.7 degrees per
   pixel, and a gutter is the sky boundary. Depth maps give the camera height
   (big near ground plane) and nothing at the eave.

Do not spend another afternoon on this without new information. The convention
above is worth keeping — it is correct and it was expensive to establish.

## Queued, in the owner's words

1. **"when i drag a dot on sky view it should stay in the same spot in street
   view — its just to correct the offset."** Geometrically this means a sky drag
   should slide the dot ALONG THE CAMERA RAY: that changes the plan position and
   leaves the Street View pixel exactly where it was, which is precisely a depth
   correction. Deferred by the owner ("do that later though").

2. **"use the actual height from street view, and sky view for the other two
   dimensions, then Pythagoras for how long lines really are, then adjust for
   how long we are saying a foot is."** Height from the street, plan from above,
   true length from the two. Deferred with the same message.

3. **"we dont want anything like using garage door to measure height, because
   then we go pixel for pixel but there is depth and more stuff like that — find
   the height through proper geometry not through a rough estimate of how many
   pixels tall is the garage."** Audit every height path for anything that
   scales pixels against a known object, and replace it with camera-pose
   geometry. Note the existing scale check reports and never corrects, so it is
   not in the measurement path; the photo-markup tool genuinely is pixel-scaled,
   because a phone photo has no camera pose.

## Blocked

Testing the branch needs a working Google Maps key. The key is referrer-locked
to the live domain: from `http://localhost:4180/` the Street View metadata
endpoint answers REQUEST_DENIED, "This IP, site or mobile application is not
authorized to use this API key." Either allow the test origin on the key, or
test on a deploy preview whose domain the key already allows.
