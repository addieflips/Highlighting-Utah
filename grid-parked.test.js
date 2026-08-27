/* THE GRID IS PARKED, NOT DEAD — and this is what stops it rotting.
 * ================================================================
 * `js/grid.js` is the one file that only ever existed on the grid-blocks-schedule
 * branch (PR #14). It answers Addie's 2026-08-22 ruling, "city lines arent a concern", by
 * making a crew-day a patch of MAP rather than a town — and it is NOT wired into anything.
 * Main still builds the season out of towns, on a pile of her own later rulings, and which
 * of the two wins is an open question (docs/open-questions.md Q-023).
 *
 * ⭐ WHY IT IS HERE AT ALL. It was hostage to a branch with no common history with main
 * and 159 admin.html commits of drift, so every day it sat there made porting it more
 * expensive — and none of that decay had anything to do with the file itself, which is
 * pure arithmetic with no DOM and no Firebase. Copying it across costs nothing, conflicts
 * with nothing, and stops the clock. Addie, 2026-08-27, shown that: "go ahead with the
 * first one."
 *
 * ⚠ AN UNWIRED FILE WITH NO TEST IS A FILE THAT ROTS SILENTLY, which would make the whole
 * exercise pointless — in six weeks it would be 718 lines nobody dares touch, exactly the
 * position it was rescued from. So this runs it. Not exhaustively: the branch has its own
 * suite for that, and porting THAT is part of the wiring job nobody has agreed to yet.
 * What is asserted here is the handful of claims that are the entire reason the file was
 * written, so if any of them stops being true the build says so.
 *
 * ⚠ THIS PROVES NOTHING ABOUT THE SEASON MAIN ACTUALLY BUILDS. Nothing imports this. A
 * green run here means the arithmetic still works, never that the app uses it.
 *
 * ⚠ ITS OWN FILE, per R-018, and deliberately NOT added to `npm test`'s chain gate list in
 * the same breath as the real gates — see the tail of this file for why it is in the chain
 * anyway.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name); }
}

console.log('\n=== The parked grid still works ===\n');

import(path.join(__dirname, 'js', 'grid.js')).then(function (G) {
  /* ⚠ THE IMPORT ITSELF IS THE FIRST CHECK, and it is not a formality: this file is an ES
     module sitting in a repo whose test suites are CommonJS, and a stray edit that breaks
     its syntax would otherwise be invisible until somebody tried to wire it. */
  check('js/grid.js still parses and loads', typeof G.planBlocks === 'function',
    'the module loaded but planBlocks is gone');

  /* A tidy clump of houses about a hundred yards apart, plus one house twenty-five miles
     away on its own. Lehi-ish coordinates, so the miles-per-degree constants are being
     exercised at the latitude they were written for. */
  const book = [];
  for (let i = 0; i < 40; i++) {
    book.push({ id: 'h' + i, lat: 40.39 + (i % 8) * 0.003, lng: -111.85 + Math.floor(i / 8) * 0.004 });
  }
  const FAR = { id: 'far', lat: 40.05, lng: -111.65 };
  book.push(FAR);

  const plan = G.planBlocks(book, { cap: 20 });
  /* ⚠ A BLOCK IS AN OBJECT, NOT AN ARRAY — {id, ids, count, cells, centre, spreadMiles}.
     The first draft of these checks assumed an array of houses and failed on code that is
     perfectly correct, which is the reason to RUN a parked module rather than describe it
     from its own comments. */
  const inBlocks = plan.blocks.reduce(function (n, b) { return n + b.ids.length; }, 0);

  /* ⭐ NOBODY IS LEFT OVER. This is the claim the whole file exists for — Addie: "we dont
     end up with a bunch of dots in the middle of no where so we dont have any one man
     days". Greedy nearest-twenty packing strands rim houses by construction; cutting the
     whole book in one pass means "left over" stops being a state a house can be in. */
  check('every house is either in a block or named an outlier',
    inBlocks + plan.outliers.length === book.length,
    'placed ' + inBlocks + ' + ' + plan.outliers.length + ' outlier(s) out of ' + book.length);

  /* ⭐ AND A REAL OUTLIER IS LIFTED OUT RATHER THAN FORCED IN. Addie: "if a house is really
     that far out then its for my dad to do... if they are a real outlier they arent in the
     grid at all." That is what keeps distance from ever having to outrank timing. */
  check('the house twenty-five miles from anybody is an outlier',
    plan.outliers.some(function (o) { return o.house && o.house.id === 'far'; }),
    'it was packed into a block instead, which is the trade-off this design refuses');
  /* ⚠ ONE SABOTAGE OF THIS WAS REPORTED "NOT CAUGHT", AND THAT WAS THE RIGHT ANSWER.
     Forcing `minCompany = 0` stops the proximity test classifying the far house — and it
     still comes back an outlier, because the cut then cannot place it and reports it
     `stranded`, which planBlocks folds into the same list. Two mechanisms, one
     guarantee, and the guarantee is what is asserted here: a genuinely remote house is
     NAMED rather than packed into somebody's day. A check that pinned the mechanism
     would go red on code that still keeps the promise. */
  check('and the clumped houses are not',
    !plan.outliers.some(function (o) { return o.house && o.house.id !== 'far'; }),
    'calling an ordinary house an outlier sends it to the one-man pile for nothing');

  /* ⚠ NEVER OVER THE CAP. A crew-day is twenty houses; a block that hands out
     twenty-three is a sheet somebody cannot finish. */
  check('no block is over the cap',
    plan.blocks.every(function (b) { return b.ids.length <= 20 && b.count === b.ids.length; }),
    'sizes: ' + plan.blocks.map(function (b) { return b.ids.length; }).join(', '));

  /* ⚠ THE SAME BOOK MUST GIVE THE SAME PLAN. A season that reshuffles between two presses
     of Recalculate is one nobody can print — and this file sorts along a curve, which is
     exactly the kind of code where an unstable comparator hides for months. */
  const again = G.planBlocks(book.slice().reverse(), { cap: 20 });
  const shape = p => JSON.stringify(p.blocks.map(b => b.ids.slice().sort()).sort());
  check('the same houses give the same blocks whatever order they arrive in',
    shape(plan) === shape(again),
    'an unstable sort means two presses of Recalculate lay the season out differently');

  console.log('');
  console.log('  NOTE  nothing imports js/grid.js. Green here means the arithmetic still');
  console.log('        works, NOT that the app uses it — main still builds the season from');
  console.log('        towns. Which of the two wins is Q-023, and it is unanswered.');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch(function (err) {
  /* ⚠ A LOAD FAILURE MUST BE LOUD. A suite that cannot find its target and exits 0 is the
     worst shape a gate can take: green for the reason that should have been red. */
  console.log('  FAIL  js/grid.js could not be loaded at all — ' + (err && err.message || err));
  console.log('\n0 passed, 1 failed');
  process.exit(1);
});
