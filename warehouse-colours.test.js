/*
 * What colour a house is, and what the warehouse builds for it — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Three separate faults were found in one afternoon, all in the same place, and all of
 * the same shape: something was reading ONE of the two fields a colour can live in, or
 * ONE of the two vocabularies a colour can be spelled in. Every one of them was invisible
 * from the source and obvious the moment both sides were RUN against the same input.
 *
 * R-018 says not to add checks to run-all.js, so this follows the pattern the other
 * gates use — one file, one job, wired into `npm test`.
 *
 * ⚠ IT RUNS THE REAL FUNCTIONS, lifted out of admin.html and employee.html, never a
 * local copy. A second opinion written here would agree with itself and prove nothing —
 * the same argument season-state.test.js makes, and for the same reason.
 *
 * Run:  node warehouse-colours.test.js      (or: npm run test:colours)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const emp = fs.readFileSync(path.join(__dirname, 'employee.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lifts a function by name, to its closing brace at column 0.
   ⚠ \r?\n, NOT \n. admin.html is CRLF and this file has been broken once already by a
   raw newline in an anchor — the trap CLAUDE.md §7 names by hand. */
function lift(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) return '';
  const m = /\r?\n\}/.exec(src.slice(at));
  return m ? src.slice(at, at + m.index + m[0].length) : '';
}
const fn = (n) => lift(admin, n);
const empFn = (n) => lift(emp, n);
const grab = (src, re) => (src.match(re) || [''])[0];

const RE = {
  colours: /const WH_LIGHT_COLORS\s*=\s*\[[^\]]*\];/,
  options: /const RB_LIGHT_COLOR_OPTIONS\s*=\s*\[[^\]]*\];/,
  aliases: /const RB_COLOR_ALIASES = \{[\s\S]*?\r?\n\};/,
  multi:   /const RB_MULTI_RE = [^\r\n]*\r?\n/,
  runs:    /const RB_RUN_LETTERS = \{[^}]*\};/,
  vocab:   /const WH_COLOR_WORDS = \(function\(\)\{[\s\S]*?\r?\n\}\)\(\);/,
  sep:     /const WH_LIGHT_SEP = [^\r\n]*\r?\n/,
};

const NEEDED = ['rbNormalizeColors', 'rbDetectColorsAndPattern', 'rbLooksMulti',
                'rbLetterRun', 'whColorsFromWords', 'whSplitAllKnown', 'whOrderColors',
                'whNormalizeLights', 'whWireLabel', 'houseLightsText'];
const missing = NEEDED.filter(n => !fn(n))
  .concat(Object.keys(RE).filter(k => !grab(admin, RE[k])).map(k => 'const ' + k));
if (missing.length) {
  console.log('\n  FAIL  cannot find in admin.html: ' + missing.join(', '));
  console.log('\n  A rename is a real change and this gate refuses to pass over one.');
  console.log('  Fix the name here in the same commit that renamed it.\n');
  process.exit(1);
}

/* Two sandboxes, each holding the real thing and nothing invented. */
const base = grab(admin, RE.colours) + grab(admin, RE.options) + grab(admin, RE.aliases) +
             grab(admin, RE.multi) + fn('rbLooksMulti') +
             grab(admin, RE.runs) + fn('rbLetterRun');
const groupOf = new Function(base + grab(admin, RE.vocab) + fn('whColorsFromWords') +
  grab(admin, RE.sep) + fn('whSplitAllKnown') + fn('whOrderColors') + fn('whWireLabel') +
  fn('whNormalizeLights') + 'return whNormalizeLights;')();
const importOf = new Function(base + fn('rbNormalizeColors') + 'return rbNormalizeColors;')();
const splitter = new Function(base + fn('rbNormalizeColors') + fn('rbDetectColorsAndPattern') +
  'return rbDetectColorsAndPattern;')();
const lightsOf = new Function(fn('houseLightsText') + 'return houseLightsText;')();

// ---------------------------------------------------------------------------
// 1. COLOURS LIVE IN TWO FIELDS, AND EVERY READER MUST READ BOTH
// ---------------------------------------------------------------------------
/* ⭐ Addie, looking at the Waiting on light colours block: "All I want are the lights
   saved on peoples houses that don't have a category of lights its under like red, warm."

   ⚠ THAT BLOCK WAS MOSTLY NOT MISSING ANSWERS — it was answers nobody read.
   rbDetectColorsAndPattern, which the master-sheet sync writes through, only fills
   lightsDescription when a colour REPEATS, because a repeat means an alternating pattern
   where the order matters. An ordinary house comes back with the colours in the LIST and
   the description EMPTY.

   ⚠ A FIXTURE FOR THIS MUST BE SHAPED THE WAY THE SPLITTER REALLY WRITES ONE. One
   carrying both fields passes whether the fix is there or not, which is how this survived
   so long — so the splitter is RUN here and its own output fed in. */
const plain = splitter('Red, Warm White');
check('an ordinary colour list really does leave the description empty',
  plain.pattern === '' && plain.colors.length === 2,
  'if this stops being true the bug below cannot happen and this block is moot — got ' +
  JSON.stringify(plain));
const alternating = splitter('Red, Warm White, Red');
check('and a repeated colour still produces one, because the order matters',
  alternating.pattern !== '', 'got ' + JSON.stringify(alternating));

check('a house whose colours are only in the list still has colours',
  lightsOf({ lightColors: plain.colors, lightsDescription: '' }) === 'Red, Warm White',
  'this is the shape the master-sheet sync writes; got ' +
  JSON.stringify(lightsOf({ lightColors: plain.colors, lightsDescription: '' })));
/* ⚠ THE DESCRIPTION WINS WHERE THERE IS ONE, because it carries the ORDER an alternating
   house is built in and the list deliberately does not. */
check('and an alternating house keeps its order, not its sorted list',
  lightsOf({ lightColors: alternating.colors, lightsDescription: alternating.pattern }) ===
    alternating.pattern,
  'the list drops the repeat, which IS the pattern');
check('and a house with genuinely nothing still has nothing',
  lightsOf({}) === '' && lightsOf({ lightColors: [] }) === '' &&
  lightsOf({ lightsDescription: '   ' }) === '',
  'the blocked block has to keep catching the real ones');

/* ⚠ AND THE READERS MUST ASK IT. A helper nothing calls fixed nothing — these four are
   the ones that were wrong, and the colour totals are the expensive one because those
   totals are what gets ORDERED. */
[['whBuildQueueGroups', 'the build queue'],
 ['computeColorDemand', 'the colour totals — this is what gets ORDERED'],
 ['computePendingHouseCount', 'the pending count'],
 ['whRecycleGroups', 'the recycle queue'],
 ['printLightColor', 'the printed Light color cell']].forEach(([name, what]) => {
  const body = fn(name);
  check(what + ' reads both colour fields', !!body && /houseLightsText\(/.test(body),
    name + ' still tests lightsDescription on its own');
});

// ---------------------------------------------------------------------------
// 2. ONE VOCABULARY — THE IMPORT AND THE WAREHOUSE MUST KNOW THE SAME WORDS
// ---------------------------------------------------------------------------
/* ⚠ THEY KNEW DIFFERENT WORDS. rbNormalizeColors reads the master sheet through
   RB_COLOR_ALIASES and understands ww, w, warm, pure, p, pw, r, rr. whColorsFromWords,
   which decides the warehouse GROUP, knew only the nine full names — so a description
   holding an abbreviation became its own heading, verbatim: "ww" and "Warm White" were
   two piles for one build.
   ⚠ RUN, BOTH OF THEM, AGAINST THE SAME INPUT. A check that the table contains a key
   proves nothing about the side that never read the table. */
const aliasTable = new Function(grab(admin, RE.aliases) + 'return RB_COLOR_ALIASES;')();
const disagree = Object.keys(aliasTable).filter((k) => {
  const a = importOf(k).slice().sort().join(', ');
  const b = groupOf(k).split(', ').slice().sort().join(', ');
  return a !== b;
});
check('every word the import knows, the warehouse groups the same way',
  disagree.length === 0, 'two headings for one build: ' + JSON.stringify(disagree));

/* ⭐ HER RULINGS, 2026-08-24, given when asked which spellings really appear in the
   sheet. Do not change one without her.
   ⚠ A REPEATED SINGLE LETTER IS A COUNT: "R is Red, RR is Red, Red", "bbb is Blue, Blue,
   Blue". They used to collapse to one colour, which merged rr and rrr into one build.
   WW and PW are initials, NOT repeats, and she gave both in the same breath. */
[['warm', 'Warm White'], ['Warm', 'Warm White'], ['ww', 'Warm White'], ['w', 'Warm White'],
 ['warm white', 'Warm White'], ['pure', 'Pure White'], ['p', 'Pure White'],
 ['pw', 'Pure White'],
 ['r', 'Red'], ['rr', 'Red, Red'], ['rrr', 'Red, Red, Red'],
 ['b', 'Blue'], ['bb', 'Blue, Blue'], ['bbb', 'Blue, Blue, Blue'],
 ['g', 'Green'], ['gg', 'Green, Green'], ['ggg', 'Green, Green, Green'],
 ['pur', 'Pure White'], ['clear', 'Pure White'],
 ['cool white', 'Pure White'], ['bright white', 'Pure White'],
 ['orng', 'Orange'], ['pnk', 'Pink'], ['blu', 'Blue'], ['grn', 'Green'],
 ['rainbow', 'Multi'],
 ['reds', 'Red'], ['greens', 'Green'], ['warm whites', 'Warm White']
].forEach(([t, want]) => {
  check('the warehouse groups "' + t + '" as ' + want, groupOf(t) === want,
    'got ' + JSON.stringify(groupOf(t)));
});

/* ⭐ SOFT IS WARM WHITE (2026-08-24), reversing her own ruling of 2026-08-19 — she was
   asked directly and told what it cost. Under the old rule the warehouse got a group
   headed soft(recycled), which is not a colour anybody stocks, so nobody could build it.
   ⚠ soft(recycled) IS CHECKED AS WELL AS soft: it is the value already stored on real
   records, and without it the note reader turns it into "Warm White (recycled)" — its own
   heading, which does not merge and so does not do what she asked. */
['soft', 'soft white', 'soft(recycled)'].forEach((t) => {
  check('"' + t + '" is Warm White on both sides',
    groupOf(t) === 'Warm White' && importOf(t).join('|') === 'Warm White',
    'got ' + JSON.stringify([groupOf(t), importOf(t)]));
});
check('and a soft house builds with the plain warm white ones',
  groupOf('soft(recycled)') === groupOf('Warm White') &&
  groupOf('Red, soft(recycled)') === groupOf('Red, Warm White'),
  'one group is the whole point of the ruling; got ' +
  JSON.stringify([groupOf('Red, soft(recycled)'), groupOf('Red, Warm White')]));

/* ⭐ AND THE SWITCHING LIST SURVIVES, which is what made that ruling cheap. The All
   Customers filter matches /soft/i against the RAW record, never through the colour
   table, so every house already carrying soft(recycled) is still findable.
   ⚠ If somebody "tidies" that filter into using the normaliser it will silently match
   nobody, and the only list of who is on old stock is gone. */
const softFilter = admin.slice(admin.indexOf("if(lightsFilter === 'soft')"),
                               admin.indexOf("} else if(lightsFilter === 'none')"));
check('the switching filter still reads the raw record',
  /\/soft\/i\.test/.test(softFilter) && !/whNormalizeLights|houseLightsText/.test(softFilter),
  'it is the only way left to find who is on old stock');
check('and both colour pickers still offer soft as a label',
  (admin.match(/value="soft\(recycled\)"/g) || []).length >= 2,
  'Add Customer and Edit Customer each have one; they are what mark a house');

/* ⭐ ANYTHING MULTI-SOMETHING IS MULTI — a shape, not table rows.
   ⚠ ASSERTED ON BOTH SIDES SEPARATELY. It is a regex, so the alias-key sweep above
   cannot reach it, and a red-check proved that: deleting the rule from the import changed
   nothing while table rows quietly did the same job. The rows are gone. */
['multi', 'multicolor', 'multicolour', 'multi color', 'multi colour',
 'multi-color', 'multi-colour', 'multicolored', 'multicoloured'].forEach((t) => {
  check('the import reads "' + t + '" as Multi', importOf(t).join('|') === 'Multi',
    'got ' + JSON.stringify(importOf(t)));
  check('and the warehouse groups "' + t + '" as Multi', groupOf(t) === 'Multi',
    'got ' + JSON.stringify(groupOf(t)));
});

/* ⭐ LETTERS RUN TOGETHER ARE A STRAND. Addie: "That is still Red, Red, Green, Green all
   of those ways." */
['rrgg', 'rr/gg', 'rr, gg', 'RRGG'].forEach((t) => {
  check('the import reads "' + t + '" as two reds and two greens',
    importOf(t).join('|') === 'Red|Red|Green|Green', 'got ' + JSON.stringify(importOf(t)));
  check('and the warehouse groups "' + t + '" the same',
    groupOf(t) === 'Red, Red, Green, Green', 'got ' + JSON.stringify(groupOf(t)));
});
check('a longer run still reads one letter at a time',
  importOf('rrggbb').join('|') === 'Red|Red|Green|Green|Blue|Blue',
  'got ' + JSON.stringify(importOf('rrggbb')));
check('and the repeat reaches the pattern field, where the order is kept',
  splitter('rr').pattern === 'Red, Red' && splitter('rrr').pattern === 'Red, Red, Red',
  'got ' + JSON.stringify([splitter('rr'), splitter('rrr')]));

/* ⚠ w AND p ARE EXCLUDED FROM RUNS, AND THAT LIMIT IS THE WHOLE SAFETY OF THE RULE. WW
   and PW are INITIALS, ruled on in the same message as the counts. A reader that expanded
   every letter would turn ww into two warm whites — the opposite of what she said — and
   wwrr is genuinely ambiguous with no way to tell. */
check('ww and pw are still initials, not runs',
  groupOf('ww') === 'Warm White' && groupOf('pw') === 'Pure White',
  'got ' + JSON.stringify([groupOf('ww'), groupOf('pw')]));
check('one letter on its own is not a run — the table answers it',
  groupOf('r') === 'Red' && groupOf('o') === 'Orange',
  'got ' + JSON.stringify([groupOf('r'), groupOf('o')]));

/* ⚠ THE UNKNOWN-WORD GUARD IS THE HALF THAT MUST NOT BE LOST. Only a description made
   ENTIRELY of words we know is rewritten; anything else is kept exactly as typed and
   shows as its own heading somebody can correct. Guessing puts the wrong bundle on a real
   house. `mc` is in this list deliberately — Addie: "just skip mc". */
[['Red with tinsel'], ['Green garland'], ['mc'], ['wwrr'], ['pwrr']].forEach(([t]) => {
  check('"' + t + '" is left exactly as typed, not guessed at',
    groupOf(t) === t && importOf(t).join('|') === t,
    'got ' + JSON.stringify([groupOf(t), importOf(t)]));
});

/* ⚠ AND THE TWO READERS AGREE WHERE BOTH CAN READ A TOKEN. rr, rrr, gg, ggg, bb and bbb
   are alias keys AND valid runs; if they disagreed the answer would be decided by call
   order, which is not a rule anybody could look up. */
const runner = new Function(grab(admin, RE.runs) + fn('rbLetterRun') + 'return rbLetterRun;')();
const clash = Object.keys(aliasTable).filter((k) => {
  const run = runner(k);
  return run && [].concat(aliasTable[k]).join('|') !== run.join('|');
});
check('the alias table and the run reader never disagree about a token',
  clash.length === 0, 'both can read these and they differ: ' + JSON.stringify(clash));

// ---------------------------------------------------------------------------
// 3. A SET SORTS, A STRAND KEEPS ITS ORDER
// ---------------------------------------------------------------------------
/* Sorting exists so two people typing the same two colours land in one group. Since RR
   means two reds, order now carries information: rrgg and rgrg are the same four bulbs
   and two different strands, and sorting flattens both to one heading. */
check('two colours in either order are one group',
  groupOf('red, green') === groupOf('green, red'),
  'got ' + JSON.stringify([groupOf('red, green'), groupOf('green, red')]));
check('but a repeating strand keeps the order it was written in',
  groupOf('rr,gg') === 'Red, Red, Green, Green' &&
  groupOf('r,g,r,g') === 'Red, Green, Red, Green',
  'got ' + JSON.stringify([groupOf('rr,gg'), groupOf('r,g,r,g')]));
check('so two different strands are two different builds',
  groupOf('rr,gg') !== groupOf('r,g,r,g'),
  'one heading for two builds sends the warehouse to make the wrong thing');

/* ⚠ LONGEST MATCH FIRST, or "warm" eats the front of "warm white" and the leftover
   "white" comes back as a second colour — putting every warm-white house into a
   three-colour group. */
check('a longer colour name wins over a shorter one inside it',
  groupOf('warm white') === 'Warm White' && groupOf('pure white') === 'Pure White',
  'got ' + JSON.stringify([groupOf('warm white'), groupOf('pure white')]));
/* ⚠ AND AN ALIAS MAY BE A LIST. "white" is both, because the office ruled 2026-08-19
   that "we really dont know" — it must spread, not land as one name with a comma in it. */
check('"white" still means both whites', groupOf('white') === 'Pure White, Warm White',
  'got ' + JSON.stringify(groupOf('white')));

/* ⚠ AND NORMALISING IS IDEMPOTENT. soft(recycled) is what the import WRITES and is not
   one of the nine, so the note reader tore its brackets off and put them back:
   "soft(recycled) (recycled)". A heading that changes when normalised twice drifts a
   group at a time. A genuine note must still survive. */
['Warm White', 'ww', 'soft', 'soft(recycled)', 'Red, Green', 'white', 'rrgg',
 'Warm White (every third bulb)', 'Red with tinsel'].forEach((t) => {
  const once = groupOf(t);
  check('re-normalising "' + t + '" gives the same answer', groupOf(once) === once,
    JSON.stringify(once) + ' became ' + JSON.stringify(groupOf(once)));
});
check('a genuine bracketed note is left alone',
  groupOf('Warm White (every third bulb)') === 'Warm White (every third bulb)',
  'that bracket is somebody\'s instruction, not a colour');

// ---------------------------------------------------------------------------
// 4. THE CREW PORTAL KNOWS THE SAME WORDS
// ---------------------------------------------------------------------------
/* Two copies of all of this exist by design. run-all.js compares them line for line;
   this RUNS the crew's copy, so the comparison is about something that works. */
const empBase = grab(emp, RE.colours) + grab(emp, RE.aliases) +
                grab(emp, RE.multi) + empFn('rbLooksMulti') +
                grab(emp, RE.runs) + empFn('rbLetterRun');
const haveEmp = !!(grab(emp, RE.aliases) && grab(emp, RE.vocab) && empFn('whColorsFromWords') &&
                   empFn('whNormalizeLights') && empFn('whOrderColors') && empFn('whSplitAllKnown'));
check('the crew portal has the colour vocabulary too', haveEmp,
  'it grouped by the nine full names alone and knew none of the abbreviations');
if (haveEmp) {
  const empGroup = new Function(empBase + grab(emp, RE.vocab) + empFn('whColorsFromWords') +
    grab(emp, RE.sep) + empFn('whSplitAllKnown') + empFn('whOrderColors') +
    empFn('whWireLabel') + empFn('whNormalizeLights') + 'return whNormalizeLights;')();
  const differ = ['ww', 'w', 'warm', 'p', 'pure', 'r', 'rr', 'bbb', 'rrgg', 'white', 'soft',
                  'soft(recycled)', 'mc', 'Red with tinsel', 'Red, Green', 'multi-colour']
    .filter((t) => empGroup(t) !== groupOf(t));
  check('and groups every one of them exactly as the office does', differ.length === 0,
    'the crew screen and the office would show different piles for: ' + JSON.stringify(differ));
}

// ---------------------------------------------------------------------------
console.log('\n=== What colour a house is ===\n');
const w = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };
console.log('  ' + w('value', 26) + w('import reads', 28) + 'warehouse groups as');
['ww', 'soft', 'soft(recycled)', 'rr', 'bbb', 'rrgg', 'rgrg', 'pur', 'rainbow', 'mc', 'wwrr']
  .forEach((t) => console.log('  ' + w(JSON.stringify(t), 26) +
    w(importOf(t).join(', '), 28) + JSON.stringify(groupOf(t))));
console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('A colour decides what bundle gets made for a real house. Wrong is worse');
  console.log('than unknown: an unrecognised word shows as its own heading somebody can');
  console.log('correct, and a wrong one is a bundle nobody can use.\n');
}
process.exit(fail ? 1 : 0);
