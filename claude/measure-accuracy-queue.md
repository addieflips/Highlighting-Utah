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

## Done since — the queue is empty

1. **A sky drag slides the dot along its own line of sight.** "when i drag a dot
   on sky view it should stay in the same spot in street view — its just to
   correct the offset." Every point along a ray draws at the same pixel, so this
   changes where the dot sits on the map and leaves the photograph untouched.
   Proved by arithmetic in the suite rather than by a source match: a slid dot
   reprojects to within 0.01 px of where it was while its depth moves by more
   than a metre.

2. **A second click from a different angle now reaches the dot.** The correction
   already existed — two rays crossing is geometry rather than a model — but it
   only fired within 8 px of the DRIFTED dot, and the reason to re-sight is that
   the dot is no longer on the corner. Aiming at the corner missed and made a
   second dot. Each dot is now judged at its own size, widening only once the
   camera has moved far enough for a second sighting to mean anything, and
   bounded by that dot's own uncertainty.

3. **No height is typed or guessed anywhere.** The height box, the storey presets
   and the known-size scale check are gone from the page and unwired. A saved
   'typed' datum from before today is read and dropped rather than restored. What
   is left is a last-resort eave for scaffolding — and a dot may not be placed
   against it: a sky click on an unmeasured house is refused and names the one
   click that fixes it.

4. **The two pictures line themselves up from the dots.** rmAutoAlign worked out
   the satellite tile's displacement by matching what had been traced against the
   roof model — it just only ran after a hand-traced RUN was finished, and the
   workflow stopped producing those the day dots replaced tracing. It runs on
   every change to the dots now, and still never overrides a measured answer.

5. **Pythagoras over plan and height** was already what rmFeetBetween does — the
   horizontal run and the change in height, in the house's own local frame. What
   was missing was heights worth putting into it, which is item 3.

## Not done, and why

**"then adjust it for how long we are saying a foot is."** The thing that measured
that error was the known-size scale check, and it has been removed as a
pixel-ratio method. There is nothing left that produces a scale factor, so there
is nothing to apply. If a scale correction is still wanted it needs a source that
is geometry rather than a traced object — say so and it can be built.

## Still to do by hand

Nothing here is provable by any suite: whether a dot lands on the actual gutter of
an actual house is a human answer. Checklist test 207 is at version 7 and carries
steps 15-17 for exactly this — the two drags doing different jobs, the second
sighting from another angle, and the refusal on an unmeasured house.

Testing it needs a working Google Maps key. The key is referrer-locked to the live
domain: from `http://localhost:4180/` the Street View metadata endpoint answers
REQUEST_DENIED, "This IP, site or mobile application is not authorized to use this
API key." Either allow the test origin on the key, or test on a deploy preview
whose domain the key already allows.
