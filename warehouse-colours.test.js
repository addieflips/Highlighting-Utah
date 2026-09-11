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
/* The server and the public page, for [[WH-28]]: the $30 fee is decided in three files and
   all three had to be brought to the same rule about where a house's colours live. */
const fns = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

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
/* ⭐ AND THE SIXTH READER IS THE $30 FEE ([[WH-28]], 2026-09-10). Addie: "there are member
   that did light changes but are not showing 30 dollar fee on there account."
   ⚠ SAME FAULT AS THE FIVE BELOW, IN THE ONE PLACE THAT COSTS MONEY. `oldLightsForBuild` read
   `lightsDescription` alone, so every ordinary house — colours in `lightColors`, description
   empty, which is what the master-sheet sync writes — looked as though it had NO colours. And
   `applyLightChange`'s own rule is that filling colours in for the first time is not a change
   and is not charged. So the whole imported book could change its lights for free.
   ⚠ THE RULE ITSELF IS UNTOUCHED and money-parity still sweeps it: what was wrong is what the
   caller handed it. */
check('the $30 light-change fee reads both colour fields',
  /const oldLightsForBuild = houseLightsText\(item\.data\)/.test(admin),
  'reading lightsDescription alone let every ordinary house change colours for free');
check('and the server side of the same fee does too',
  /oldLights: houseLightsTextServer\(oldData\)/.test(fns),
  'the portal is where a member actually changes them, so this is the half that was live');
/* ⚠ AND THE TWO COPIES HAVE TO AGREE, or the office and the portal charge different people.
   Compared as CODE with the comments stripped — the twin of the parity rule for the maths. */
{
  /* ⚠ SPACING AROUND PUNCTUATION IS NORMALISED, WORDS ARE NOT. The two files keep different
     brace styles on purpose (`if(desc)` here, `if (desc)` there), and the claim being made is
     that they DECIDE the same thing, not that they are typed the same. Space between two word
     characters is left alone, so `return desc` can never collapse into something else. */
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
                        .replace(/\s+/g, ' ')
                        .replace(/\s*([^\w$\s])\s*/g, '$1').trim();
  const A = strip(fn('houseLightsText'));
  const B = strip((function(){
    const i = fns.indexOf('function houseLightsTextServer(');
    let j = fns.indexOf('{', i), d = 0;
    for(; j < fns.length; j++){
      if(fns[j] === '{') d++;
      else if(fns[j] === '}'){ d--; if(!d) return fns.slice(i, j + 1); }
    }
    return '';
  })()).replace('houseLightsTextServer', 'houseLightsText');
  check('the browser and server copies of "what colours has this house" agree',
    !!A && !!B && A === B,
    'they decide the same $30:\n    admin : ' + A + '\n    server: ' + B);
}
/* ⚠ AND THE PORTAL'S OWN PICKER READS BOTH, which is what makes charging for it FAIR. It
   filled from the description alone, so a customer with colours opened it showing nothing
   selected — charging them for "filling in a blank" would have been the same bug wearing a
   bill. */
check('the portal colour picker falls back to the colour list',
  /if\(!parsedColors\.length\)\{[\s\S]{0,400}lightColors/.test(idx),
  'they must be able to see what they already have before they are charged for changing it');

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
/* ---------------------------------------------------------------------------
 * ⛔ A TIMER IS NOT WAITING ON THE COLOURS ([[WH-26]], 2026-09-09)
 *
 * Addie, reading five houses stuck in Waiting on light colours: "check to see if these
 * guys just wanted there timer updated. Cause if so we don't need to worry about lights
 * just about getting a timer in there bin."
 *
 * She was right, and the cost was worse than not knowing. `outletTimer` is one of the
 * three WAREHOUSE_BUILD_FIELDS, so changing a timer ALONE queues a build — and a house
 * with no colours then lands in the blocked block. That much is only untidy. The damage
 * was the early `return` in whBuildQueueGroups, which sat AHEAD of the timer push: a
 * blocked house never reached `timerHouses`, so the one thing that house actually needed
 * was the one thing no sheet ever asked for.
 * ------------------------------------------------------------------------- */
{
  const runQueue = (houses) => {
    const sb = {};
    new Function('jobAddresses', 'warehouseExtras', 'isOutForSeason', 'houseLightsText',
      'whGroupKey', 'houseBundleNeed', 'whBinsForHouse', 'whBuildReasonKey', 'cnBinsForFeet',
      fn('whBuildQueueGroups') + 'this.run = whBuildQueueGroups;')
      .call(sb, houses, [], () => false,
        (d) => d.lightsDescription || '', (l, w) => l + '|' + w,
        () => 0, () => 1, () => '', () => 1);
    return sb.run();
  };

  /* The row from her screenshot: a Timer chip, no colours on file. */
  const out = runQueue([
    {id:'kate', data:{name:'Kate Johnson', needsLightBuild:true, outletTimer:'Yes', wireColor:'White'}},
    {id:'ok',   data:{name:'Has Colours',  needsLightBuild:true, outletTimer:'Yes', wireColor:'White',
                      lightsDescription:'Red, Warm White'}}
  ]);
  const timerNames = (out.timerHouses || []).map(i => i.data.name);
  const blockedNames = (out.blocked || []).map(i => i.data.name);

  check('a house waiting on colours still reaches the timer list',
    timerNames.indexOf('Kate Johnson') !== -1,
    'she asked for a timer, the record says Yes, and before this nobody was told to put ' +
    'one in — the early return sat ahead of the timer push. Got: ' + timerNames.join(', '));

  /* ⚠ AND IT IS STILL BLOCKED FOR THE BUILD. The timer is the half that can proceed; the
     glass genuinely cannot be made until somebody fills the colours in. Moving the house
     out of the blocked block to "fix" this would order bulbs nobody chose. */
  check('and is still blocked for the build itself',
    blockedNames.indexOf('Kate Johnson') !== -1,
    'the colours are still missing; only the timer stopped waiting');

  check('a house with no timer is not put on the timer list',
    runQueue([{id:'n', data:{name:'No Timer', needsLightBuild:true, wireColor:'White'}}])
      .timerHouses.length === 0,
    'blank means no timer — a third state would put one in every bin');

  check('the blocked row says the timer can go in now',
    /Timer can go in their bin now/.test(admin),
    'a fix nobody can see on the sheet they are holding is not finished');

  /* ⚠ THE CAUSE IS NAMED so nobody "fixes" the symptom by dropping outletTimer from
     WAREHOUSE_BUILD_FIELDS — the timer list is DERIVED from the build queue, so a house
     that stopped being queued would stop getting a timer at all. */
  check('a timer change still queues the house, which is what puts it on the list',
    /WAREHOUSE_BUILD_FIELDS = \['lightsDescription', 'wireColor', 'outletTimer'\]/.test(admin),
    'drop outletTimer there and a timer added after the bundle is built reaches nobody');

  /* -----------------------------------------------------------------------
   * ⭐ AND A TIMER ON ITS OWN IS NOT A BUILD AT ALL ([[WH-27]], 2026-09-09)
   * Addie, shown that those five houses were queued by a timer change: "can you fix
   * those." The half above stopped the timer being LOST. This half stops the house
   * being parked: nothing is being made up for them, so there are no colours to wait
   * for, and "Nothing can be made up until somebody fills them in" was simply false
   * about them — it sent the office to chase an answer that does not exist.
   * --------------------------------------------------------------------- */
  {
    const only = runQueue([
      {id:'t', data:{name:'Timer Only', needsTimerOnly:true, outletTimer:'Yes', wireColor:'White'}}
    ]);
    check('a house queued for a timer alone still reaches the timer list',
      (only.timerHouses || []).map(i => i.data.name).indexOf('Timer Only') !== -1,
      'the timer is the whole of what that house needs');
    check('and is NOT waiting on light colours',
      (only.blocked || []).length === 0,
      'nobody is waiting on any colours, because nobody asked for lights: ' +
      (only.blocked || []).map(i => i.data.name).join(', '));
    check('and nothing is built for them',
      only.keys.length === 0, 'a timer is not a bundle');

    /* ⚠ THE EXPENSIVE DIRECTION, asserted on its own. A real build must never be
       suppressed by the timer flag — the flags are an OR and the build wins. A stale
       needsTimerOnly costs one extra row on a list; a build silently dropped costs a
       crew standing at a house with nothing for it. */
    const both = runQueue([
      {id:'b', data:{name:'Both', needsLightBuild:true, needsTimerOnly:true,
                     outletTimer:'Yes', wireColor:'White'}}
    ]);
    check('a house carrying BOTH flags is a build, not a timer job',
      (both.blocked || []).map(i => i.data.name).indexOf('Both') !== -1,
      'the build flag wins on its own: ' + JSON.stringify(both.keys));

    /* ⚠ AND THE FLAG CANNOT DRAG SOMEBODY BACK INTO THE SEASON. isOutForSeason is asked
       before either queue, so a house sitting the season out is on no list whatever it
       carries — the same rule the build flag has followed since 2026-08-22. */
    const outQ = (() => {
      const sb = {};
      new Function('jobAddresses', 'warehouseExtras', 'isOutForSeason', 'houseLightsText',
        'whGroupKey', 'houseBundleNeed', 'whBinsForHouse', 'whBuildReasonKey', 'cnBinsForFeet',
        fn('whBuildQueueGroups') + 'this.run = whBuildQueueGroups;')
        .call(sb, [{id:'o', data:{name:'Gone', needsTimerOnly:true, outletTimer:'Yes'}}], [],
          () => true, (d) => d.lightsDescription || '', (l, w) => l + '|' + w,
          () => 0, () => 1, () => '', () => 1);
      return sb.run();
    })();
    check('a timer-only house sitting the season out is on no list',
      (outQ.timerHouses || []).length === 0 && (outQ.blocked || []).length === 0,
      'nothing gets built OR fitted for somebody who is not having lights this year');

    /* ⚠ AND THE WAY OUT OF THE LIST EXISTS. A timer-only house is in no colour group, so
       the group's Mark Done can never reach it — without a control of its own it would
       sit there for ever, which is the shape of bug this whole entry is about. */
    check('a timer-only row can be finished from the timer list',
      /data-whtimerdone=/.test(admin) && /needsTimerOnly: false/.test(admin),
      'no colour group means no Mark Done — it needs one of its own');
    /* ⚠ AND THE HOUSES ALREADY PARKED CAN BE MOVED. The write-site fix only reaches the
       NEXT one; a fix that cannot reach the case that prompted it is not finished. */
    check('an already-parked house can be marked timer-only from the blocked row',
      /data-whtimeronly=/.test(admin),
      'the five she was looking at carry no flag and would stay blocked for ever');

    /* ⚠ AND THE WRITE-SIDE RULE IS RUN, NOT READ. It is its own function precisely so it
       can be: written inline in the ~36,000-character save handler the only thing a suite
       could do was match its text, which this repo has been burned by three times. */
    const timerOnly = new Function('return ' + fn('whTimerOnlyQueue') + ';whTimerOnlyQueue')();
    const OLD = {outletTimer:'No'};
    check('a timer switched on, alone, on a colourless house is a timer job',
      timerOnly(OLD, {outletTimer:'Yes'}, ['outletTimer'], '') === true);
    check('a WIRE change is still a build',
      timerOnly(OLD, {wireColor:'Green'}, ['wireColor'], '') === false,
      'holes C and D are not reversed — a wire change genuinely needs the bundle remade');
    /* ⚠ AND THE FIXTURE THAT ACTUALLY BITES. The one above passes whether the field is
       tested or not, because its record has no timer — so the timer-value test answers
       first and the check proves nothing about the field name. It takes a house whose
       timer is ALREADY Yes, having its wire changed: exactly the shape where dropping the
       field test would route a real rebuild into the timer queue and no bundle would ever
       be made. Found by the red-check reporting this sabotage as MISSED. */
    check('a wire change on a house that already has a timer is still a build',
      timerOnly({outletTimer:'Yes', wireColor:'White'}, {wireColor:'Green'}, ['wireColor'], '') === false,
      'the field that changed decides, not the value the timer happens to hold');
    check('a timer change alongside anything else is still a build',
      timerOnly(OLD, {outletTimer:'Yes', wireColor:'Green'}, ['outletTimer','wireColor'], '') === false);
    check('a timer change on a house that HAS colours is still a build',
      timerOnly(OLD, {outletTimer:'Yes'}, ['outletTimer'], 'Red, Warm White') === false,
      'that house is in a real build group and always was; only the case she reported moves');
    /* ⚠ REPOINTED 2026-09-11, NOT WEAKENED. This check is unchanged and still right: the
       ADD rule must never claim a removal. What changed is the reason — it used to read
       "routing a removal here would drop it off every screen silently", which was true
       while there was nowhere for a removal to go. [[WH-34]] built that somewhere, so a
       removal now has `whTimerRemovalQueue` and the Remove Timer list of its own, and the
       two directions must stay in their own lanes. */
    check('turning a timer OFF is not the ADD rule\u2019s business',
      timerOnly({outletTimer:'Yes'}, {outletTimer:'No'}, ['outletTimer'], '') === false,
      'it has its own rule now ([[WH-34]]); this one answering yes would put a house on ' +
      'the Timers list asking for the timer it just said it did not want');
    check('and it never fires when a build is already being queued by the same save',
      timerOnly(OLD, {outletTimer:'Yes', needsLightBuild:true}, ['outletTimer'], '') === false,
      'a build owed for another reason wins — the flags are an OR and the build is the safe side');

    /* -----------------------------------------------------------------------
     * ⭐ AND THE OTHER DIRECTION — A TIMER COMING OUT ([[WH-34]], 2026-09-11)
     *
     * Addie: "For people who don't want a timer anymore we need to put that in warehouse
     * as Remove Timer." This is the half [[WH-27]] left open on purpose — its own note
     * said a removal could not be routed anywhere because "timerHouses only ever collects
     * Yes and it would drop off every screen silently". There is somewhere now.
     *
     * ⛔ THE ASYMMETRY IS THE WHOLE REASON THIS NEEDS A FIELD. "Wants a timer" is readable
     * off the record for ever, so the Timers list is DERIVED and a missed flag self-heals
     * on the next render. "USED TO WANT ONE" is readable off nothing at all once the save
     * lands — that house is then identical to the ~900 that never had one. So every check
     * below RUNS the rule rather than matching it: a rule that quietly stops writing this
     * flag cannot be noticed from any screen afterwards.
     * --------------------------------------------------------------------- */
    const cameOff = new Function('return ' + fn('whTimerCameOff') + ';whTimerCameOff')();
    const removalQ = new Function(fn('whTimerCameOff') +
      ';return ' + fn('whTimerRemovalQueue') + ';')();

    check('a timer switched off is a removal',
      cameOff({outletTimer:'Yes'}, {outletTimer:'No'}, ['outletTimer']) === true,
      'this is the only moment it can be written down; afterwards the record says nothing');
    check('and cleared to blank is the same thing',
      cameOff({outletTimer:'Yes'}, {outletTimer:''}, ['outletTimer']) === true,
      'a blank timer is No everywhere else, so it has to be No here too');
    check('a timer switched ON is not a removal',
      cameOff({outletTimer:'No'}, {outletTimer:'Yes'}, ['outletTimer']) === false,
      'that would send the warehouse to undo the job it was just told to do');
    check('a wire change on a house with a timer is not a removal',
      cameOff({outletTimer:'Yes', wireColor:'White'}, {wireColor:'Green'}, ['wireColor']) === false,
      'the field that changed decides, not the value the timer happens to hold');
    /* ⚠ THE GUARD THAT LOOKS REDUNDANT AND IS NOT. warehouseRebuildFields can only name
       outletTimer when it really flipped, so the old value is implied — but implied is not
       checked, and a caller building its own list would turn every save of a timerless
       house into a work order somebody has to walk to a shelf for. */
    check('a house that never had a timer cannot have one removed',
      cameOff({outletTimer:'No'}, {outletTimer:'No'}, ['outletTimer']) === false &&
      cameOff({}, {outletTimer:''}, ['outletTimer']) === false,
      'the old value is tested as well as the changed-field list, on purpose');

    check('a removal alone on a colourless house is the whole job',
      removalQ({outletTimer:'Yes'}, {outletTimer:'No'}, ['outletTimer'], '') === true,
      'nothing is being made up for them, so parking them in Waiting on light colours ' +
      'sends the office to chase an answer that does not exist — [[WH-27]] in reverse');
    check('but on a house that HAS colours it is still a build',
      removalQ({outletTimer:'Yes'}, {outletTimer:'No'}, ['outletTimer'], 'Red, Warm White') === false,
      'holes C and D stay unreversed; that house is in a real build group and always was');
    check('and alongside anything else it is still a build',
      removalQ({outletTimer:'Yes'}, {outletTimer:'No', wireColor:'Green'},
        ['outletTimer','wireColor'], '') === false,
      'a wire change genuinely needs the bundle remade');
    check('and never when a build is already being queued by the same save',
      removalQ({outletTimer:'Yes'}, {outletTimer:'No', needsLightBuild:true}, ['outletTimer'], '') === false,
      'the build is the safe side, exactly as it is for the add rule');

    /* ---- and the queue puts it somewhere somebody will read -------------- */
    const rem = runQueue([
      {id:'r', data:{name:'No More Timer', needsTimerRemoved:true, outletTimer:'No', wireColor:'White'}}
    ]);
    check('a house queued for a removal reaches the Remove Timer list',
      (rem.timerRemovals || []).map(i => i.data.name).indexOf('No More Timer') !== -1,
      'got: ' + JSON.stringify((rem.timerRemovals || []).map(i => i.data.name)));
    /* ⛔ THE ONE THAT WOULD PUT A TIMER BACK IN. The two lists are opposite instructions
       about the same shelf, so a removal appearing on Timers is worse than it appearing
       nowhere — somebody reads it at speed and fits the timer the customer just refused. */
    check('and is NOT on the Timers list',
      (rem.timerHouses || []).length === 0,
      'that list means "put one in"; this house asked for the opposite');
    check('and is not waiting on light colours',
      (rem.blocked || []).length === 0,
      'nobody asked for lights, so there are no colours to wait for');
    check('and nothing is built for them',
      rem.keys.length === 0, 'taking a timer out is not a bundle');

    /* ⚠ BOTH JOBS, BOTH LISTS. A house having a set made AND an old timer pulled is two
       different jobs done by two different pairs of hands — dropping either is a bundle
       never made or a timer left in a bin all season. */
    const remBuild = runQueue([
      {id:'rb', data:{name:'Both Jobs', needsLightBuild:true, needsTimerRemoved:true,
                      outletTimer:'No', wireColor:'White', lightsDescription:'Red, Warm White'}}
    ]);
    check('a house building AND losing its timer is on both lists',
      (remBuild.timerRemovals || []).map(i => i.data.name).indexOf('Both Jobs') !== -1 &&
      remBuild.keys.length === 1,
      'the bundle and the bin are two jobs: ' + JSON.stringify(remBuild.keys));

    /* ⚠ AND IT CANNOT DRAG SOMEBODY BACK INTO THE SEASON, the same rule the build flag
       and needsTimerOnly both follow — isOutForSeason is asked before any queue. */
    const remOut = (() => {
      const sb = {};
      new Function('jobAddresses', 'warehouseExtras', 'isOutForSeason', 'houseLightsText',
        'whGroupKey', 'houseBundleNeed', 'whBinsForHouse', 'whBuildReasonKey', 'cnBinsForFeet',
        fn('whBuildQueueGroups') + 'this.run = whBuildQueueGroups;')
        .call(sb, [{id:'g', data:{name:'Gone', needsTimerRemoved:true, outletTimer:'No'}}], [],
          () => true, (d) => d.lightsDescription || '', (l, w) => l + '|' + w,
          () => 0, () => 1, () => '', () => 1);
      return sb.run();
    })();
    check('a removal for somebody sitting the season out is on no list',
      (remOut.timerRemovals || []).length === 0,
      'their bin is not being touched at all this year');

    /* ⚠ THE WAY OFF THE LIST, and it must clear the removal WITHOUT clearing the build —
       one button finishing somebody else's job is how a bundle goes missing. */
    check('a Remove Timer row can be finished from that list',
      /data-whtimerout=/.test(admin) && /needsTimerRemoved: false/.test(admin),
      'a removal is in no colour group, so no Mark Done can ever reach it');
    check('and finishing it leaves the build alone',
      !/needsTimerRemoved: false, needsLightBuild/.test(admin),
      'a house having a set made as well still needs the set made');
    /* ⚠ AND IT REACHES PAPER. The crew and the warehouse work off printed sheets this
       season — "were not using the employee portal this year" — so a job that exists only
       on screen is a job nobody does. */
    check('and it is on the printed build sheet',
      /group: 'Remove timer'/.test(admin) && /timer: 'TAKE OUT'/.test(admin),
      'a screen-only work order is one nobody standing in the warehouse ever sees');
    /* ⛔ AND THE SAVE ACTUALLY CALLS IT. [[WH-27]]'s own red-check pass recorded this as
       one of two sabotages it MISSED — "no check asserted the SAVE calls the rule" — so
       every behavioural check above can pass while nothing in the real page ever sets the
       flag. The wiring is asserted separately from the mechanism, deliberately. */
    check('the Edit Customer save asks the removal rule',
      /whTimerCameOff\(item\.data, addrUpdates, whChanged\)/.test(admin) &&
      /addrUpdates\.needsTimerRemoved = true;/.test(admin),
      'a rule nothing calls is a rule that never runs');
    check('and takes the removal back if they change their mind',
      /needsTimerRemoved\) addrUpdates\.needsTimerRemoved = false;/.test(admin),
      'nothing has been pulled while the flag is up, so switching the timer back on ' +
      'cancels the job rather than leaving somebody to walk to a shelf for nothing');
    check('and the removal branch is asked before the plain build escalation',
      admin.indexOf('whTimerRemovalQueue(item.data, addrUpdates, whChanged') <
      admin.indexOf('else if(whChanged.length) addrUpdates.needsLightBuild = true;'),
      'after it, the build wins every time and the carve-out can never fire');
    check('and the paper never says YES on a removal row',
      !/group: 'Remove timer',[\s\S]{0,400}timer: 'YES'/.test(admin),
      'that column means a timer goes IN — this row is the opposite instruction');
  }
}

console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('A colour decides what bundle gets made for a real house. Wrong is worse');
  console.log('than unknown: an unrecognised word shows as its own heading somebody can');
  console.log('correct, and a wrong one is a bundle nobody can use.\n');
}
process.exit(fail ? 1 : 0);
