/*
 * Why a bundle is being built — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-08-24: "There should be a badge by each person on warehouse that
 * say's new, Old-Rebuild or Member Poral or Request", with her own definitions:
 *
 *     New           a new quote
 *     Old-Rebuild   already a member — changed address, extended the house,
 *                   or added on a building
 *     Member Portal anything that got changed in member portal
 *     Request       we added it on ourselves, from a request that came in by
 *                   email, call or text
 *
 * Four words, and every one of them is a CLAIM ABOUT WHERE SOMETHING CAME FROM.
 * That is a different kind of thing from the chips beside it: Timer and wire are
 * read straight off the record, and if one is wrong the record is wrong. This one
 * is inferred from four fields written at four different moments, so it can be
 * confidently wrong while every field it read is perfectly right.
 *
 * R-018 says not to add checks to run-all.js, so this follows the pattern the
 * other gates use — one file, one job, wired into `npm test`.
 *
 * ⚠ IT RUNS THE REAL RULE, lifted out of admin.html, never a local copy. A second
 * opinion written here would agree with itself and prove nothing — the same
 * argument season-state.test.js makes, and for the same reason.
 *
 * ⚠ AND IT CHECKS THE WRITERS. Two of the four badges cannot be told apart
 * without `lightsChangedVia`, and NOTHING WROTE THAT FIELD until this change: the
 * portal and the office both stamped `lightsChangedAt` and neither said which one
 * it was. A badge reading a field nobody writes renders the same answer for
 * everybody, looks authoritative, and is the exact shape of the Contact 2027 tab
 * that shipped reading `maybeNextYear` while portalRsvp wrote the status alone.
 * So every field this rule reads is checked to have a writer.
 *
 * Run:  node build-reason.test.js      (or: npm run test:reason)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lifts a function or a const by name. Missing means FAIL loudly, never skip —
   a gate that cannot find its target must not report green (§9.2). */
function fn(name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = admin.indexOf(opener);
    if (at === -1) continue;
    return admin.slice(at, admin.indexOf('\n}', at) + 2);
  }
  return '';
}
function constObj(name) {
  const at = admin.indexOf('const ' + name + ' = {');
  if (at === -1) return '';
  return admin.slice(at, admin.indexOf('\n};', at) + 3);
}
/* Slices the block a given `if (...) {` opens, by counting braces.
   ⚠ A FIXED CHARACTER WINDOW GOES STALE THE MOMENT SOMEBODY ADDS A COMMENT —
   which is exactly what happened to the first version of the writer checks below,
   and is the trap CLAUDE.md §7 names by hand. Two writes being in the same BLOCK
   is the thing actually being claimed, so assert that instead of a distance. */
function block(src, opener) {
  const at = src.indexOf(opener);
  if (at === -1) return '';
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  return '';
}

const NEEDED_FNS = ['whBuildReasonKey', 'whBuildReasonChip', 'whHouseFactsHtml', 'esc'];
const src = {};
let missing = [];
NEEDED_FNS.forEach(n => { src[n] = fn(n); if (!src[n]) missing.push(n); });
const reasonsSrc = constObj('WH_BUILD_REASONS');
if (!reasonsSrc) missing.push('WH_BUILD_REASONS');

if (missing.length) {
  console.log('\n  FAIL  cannot find in admin.html: ' + missing.join(', '));
  console.log('\n  A rename is a real change and this gate refuses to pass over one.');
  console.log('  Fix the name here in the same commit that renamed it.\n');
  process.exit(1);
}

/* One sandbox holding the real rule and nothing invented. */
const sandbox = new Function(
  reasonsSrc + '\n' + src.esc + '\n' + src.whBuildReasonKey + '\n' + src.whBuildReasonChip + '\n' +
  'return {WH_BUILD_REASONS, whBuildReasonKey, whBuildReasonChip};'
)();
const { WH_BUILD_REASONS, whBuildReasonKey, whBuildReasonChip } = sandbox;

/* ⚠ DECLARED HERE, ABOVE EVERY BLOCK THAT USES THEM. Both are rules rather than table
   rows — "anything multi something is Multi" and "rrgg is two reds and two greens" —
   so no sandbox can rebuild them from the alias table alone. */
const multiSrc = (admin.match(/const RB_MULTI_RE = [^\n]*\n/) || [''])[0] + fn('rbLooksMulti');
/* The run reader travels with it: "rrgg" is a shape too, and both normalisers ask. */
const runSrc = (admin.match(/const RB_RUN_LETTERS = \{[^}]*\};/) || [''])[0] + fn('rbLetterRun');
/* whNormalizeLights splits the whole description before treating brackets as a note,
   so the separator and that reader travel with it. */
const splitSrc = (admin.match(/const WH_LIGHT_SEP = [^\n]*\n/) || [''])[0] + fn('whSplitAllKnown');

// ---------------------------------------------------------------------------
// THE TABLE. One row per thing that can bring a house to the warehouse.
// ---------------------------------------------------------------------------
const STAMP = { seconds: 1756000000 };   // any Firestore timestamp will do

const CASES = [
  ['a brand new quote, converted',
   {chargeNewMemberFee: true, needsLightBuild: true}, 'new'],

  ['a member who moved — address re-quote',
   {requoteAppliedAt: STAMP, requoteKind: 'address', needsLightBuild: true}, 'rebuild'],

  ['a member who added on a building',
   {requoteAppliedAt: STAMP, requoteKind: 'addition', needsLightBuild: true}, 'rebuild'],

  ['a re-quote that only corrected the price',
   {requoteAppliedAt: STAMP, requoteKind: 'price', needsLightBuild: true}, ''],

  ['colours changed by the customer in their portal',
   {lightsChangedAt: STAMP, lightsChangedVia: 'portal', needsLightBuild: true}, 'portal'],

  ['colours we typed in after a call, an email or a text',
   {lightsChangedAt: STAMP, lightsChangedVia: 'office', needsLightBuild: true}, 'request'],

  ['a colour change from before anything recorded the source',
   {lightsChangedAt: STAMP, needsLightBuild: true}, 'changed'],

  ['a returning member re-quoted — NOT a new customer',
   {chargeNewMemberFee: true, requoteAppliedAt: STAMP, requoteKind: 'address'}, 'rebuild'],

  ['somebody who moved AND picked new colours',
   {requoteAppliedAt: STAMP, requoteKind: 'address', lightsChangedAt: STAMP,
    lightsChangedVia: 'portal'}, 'rebuild'],

  ['an ordinary house being rebuilt for no stated reason',
   {needsLightBuild: true}, ''],

  ['an empty record does not throw and claims nothing',
   {}, ''],
];

const rows = [];
CASES.forEach(([name, rec, want]) => {
  let got;
  try { got = whBuildReasonKey(rec); }
  catch (e) { got = 'THREW: ' + e.message; }
  rows.push([name, got, want]);
  check('badge — ' + name, got === want,
    'expected ' + (want ? '"' + want + '"' : 'no badge') +
    ', got ' + (got ? '"' + got + '"' : 'no badge'));
});

// ---------------------------------------------------------------------------
// THE RULE'S OWN SHAPE
// ---------------------------------------------------------------------------

/* ⭐ HER FOUR WORDS, SPELLED THE WAY SHE ASKED FOR THEM. A badge is read at a
   glance off a shelf; "Rebuild" and "Old-Rebuild" are not the same word to
   somebody scanning for one of four. */
[['new', 'NEW'], ['rebuild', 'OLD-REBUILD'], ['portal', 'MEMBER PORTAL'],
 ['request', 'REQUEST']].forEach(([key, label]) => {
  check('the ' + key + ' badge still reads "' + label + '"',
    WH_BUILD_REASONS[key] && WH_BUILD_REASONS[key].label === label,
    'she named these four by hand — renaming one is her call, not a tidy-up');
});

/* Every key the rule can return has a label, and every label is reachable.
   ⚠ A key with no entry renders NOTHING — the row silently loses its badge and
   looks like an ordinary rebuild, which is the one failure nobody can see. */
const returned = new Set(rows.map(r => r[1]).filter(Boolean));
returned.forEach(k => {
  check('the rule can return "' + k + '" and there is a badge for it',
    !!WH_BUILD_REASONS[k], 'a key with no entry renders an empty chip');
});
Object.keys(WH_BUILD_REASONS).forEach(k => {
  check('the "' + k + '" badge is reachable from the rule',
    returned.has(k), 'a badge nothing can produce is a badge nobody will ever see');
});

/* The chip really renders, and really escapes. A label is built into HTML by
   string concatenation, so this is not theoretical. */
check('a badge renders as a chip carrying its label',
  /MEMBER PORTAL/.test(whBuildReasonChip({lightsChangedAt: STAMP, lightsChangedVia: 'portal'})),
  'the rule can be right and the chip still print nothing');
check('no badge renders nothing at all, not an empty chip',
  whBuildReasonChip({}) === '',
  'an empty pill on every ordinary row is visual noise on the sheet people scan');

/* ⭐ NEW IS THE ONLY ONE THAT SURVIVES A SECOND SEASON'S FLAG. chargeNewMemberFee
   stays true on somebody who joined LAST year (Start New Season clears it, but a
   record imported or edited in between can still carry it), so the flag alone
   would badge a large part of the book NEW. */
check('a re-quote beats a stale join flag',
  whBuildReasonKey({chargeNewMemberFee: true, requoteAppliedAt: STAMP, requoteKind: 'addition'}) === 'rebuild',
  'somebody carrying last season’s join flag who is being rebuilt is a rebuild');

/* ⚠ A STRING "true" IS NOT true. chargeNewMemberFee is read with === true
   everywhere else in the app for exactly this reason. */
check('the join flag is read strictly',
  whBuildReasonKey({chargeNewMemberFee: 'yes'}) !== 'new',
  'a loose read turns any truthy value into a first-time hang');

/* Case and whitespace: requoteKind and lightsChangedVia are both stored from
   values typed or chosen elsewhere. */
check('the source is read case-insensitively',
  whBuildReasonKey({lightsChangedAt: STAMP, lightsChangedVia: ' Portal '}) === 'portal',
  'a stored value with a capital or a space must not fall through to CHANGED');
check('a price re-quote is recognised whatever its case',
  whBuildReasonKey({requoteAppliedAt: STAMP, requoteKind: 'PRICE'}) === '',
  'nothing is being built differently because a number was corrected');

/* ⚠ AND AN UNKNOWN SOURCE SAYS "CHANGED", NEVER A GUESS. This is the whole
   argument for the fifth badge existing: every colour change made before
   2026-08-24 carries no source at all, and picking one of her four for them
   would put a wrong provenance on a printed sheet. */
check('an unrecognised source is admitted, not guessed at',
  whBuildReasonKey({lightsChangedAt: STAMP, lightsChangedVia: 'sms-import'}) === 'changed',
  'a source we do not recognise is not evidence for either of the two we do');

// ---------------------------------------------------------------------------
// IT REACHES THE SCREEN
// ---------------------------------------------------------------------------

/* ⚠ ONE PLACE, so every warehouse row gets it. whHouseFactsHtml is what the
   build groups, the blocked block and the add-on rows all call. Putting the
   badge on one of those three would leave it missing exactly where the next
   person looked. */
check('the badge is built by whHouseFactsHtml',
  /whBuildReasonChip\(/.test(src.whHouseFactsHtml),
  'the one function every warehouse row type calls');

check('and it leads the chips',
  src.whHouseFactsHtml.indexOf('whBuildReasonChip(') <
  src.whHouseFactsHtml.indexOf('Timer'),
  'what kind of job this is comes before what goes in the bin');

/* ⚠ RUN, NOT READ. A call can be present and the row type still not use the
   function — which is how the crew sheet came to print empty. Count the real
   call sites. */
const factCalls = (admin.match(/whHouseFactsHtml\(/g) || []).length;
check('whHouseFactsHtml is still called by more than one row type',
  factCalls >= 3, 'definition plus at least two call sites; found ' + factCalls);

// ---------------------------------------------------------------------------
// THE WRITERS — the half that is worth more than the readers
// ---------------------------------------------------------------------------

/* ⭐ THE PORTAL SAYS IT WAS THE PORTAL. Two write sites in portalSave: the
   quote/customer update and the customer mirror. Both, or a change made through
   one path is badged and the other is not. */
const portalViaWrites = (server.match(/lightsChangedVia\s*=\s*'portal'/g) || []).length;
check('portalSave stamps the source on both of its writes',
  portalViaWrites >= 2,
  'found ' + portalViaWrites + ' — a change through the unstamped path reads as CHANGED');

/* ⚠ AND BESIDE THE TIMESTAMP, not somewhere else in the function. The two have
   to move together or a change is dated with no source, which is the state this
   whole gate exists to end. */
const portalBlocks = [
  block(server, 'if (oldData.lightsDescription) {'),
  block(server, 'if (d.setLightsChangedAt) {'),
];
portalBlocks.forEach((b, i) => {
  check('portal write ' + (i + 1) + ' sets the date and the source in one block',
    !!b && /lightsChangedAt/.test(b) && /lightsChangedVia\s*=\s*'portal'/.test(b),
    'a date with no source is exactly the record that cannot be badged');
});

/* ⭐ AND THE OFFICE SAYS IT WAS THE OFFICE. This is her "Request" — we typed it
   in after an email, a call or a text. */
check('the Edit Customer save stamps the office as the source',
  /addrUpdates\.lightsChangedVia\s*=\s*'office'/.test(admin),
  'without it a change we typed in is indistinguishable from one they made');

const officeBlock = block(admin, 'if(lightChange.setLightsChangedAt){');
check('and in the same block as its own lightsChangedAt',
  !!officeBlock && /addrUpdates\.lightsChangedAt/.test(officeBlock) &&
  /addrUpdates\.lightsChangedVia\s*=\s*'office'/.test(officeBlock),
  'the two must be written together or the source goes missing on some saves');

/* ⭐ THE RE-QUOTE KIND HAS TO REACH THE CUSTOMER. It is asked when the re-quote
   is RAISED and stored on the quote document, which a customer record cannot
   reach — so the badge read undefined on every customer and could not tell a
   house that moved from a price that was corrected. */
check('applying a re-quote copies its kind onto the customer',
  /addrUpdates\.requoteKind\s*=/.test(admin),
  'the badge reads it off the customer; nothing else can put it there');

/* ⚠ NO RAW \n IN AN ANCHOR. admin.html is CRLF on main and was LF here, so this
   literal matched nothing the moment the line endings were brought into line and the
   check failed on correct code — the trap CLAUDE.md §7 names by hand. The opener is
   located on its own and the brace counter finds the rest. */
const requoteBlock = block(admin, 'if(requoteBeingConverted){');
check('and stamps requoteAppliedAt in the same block',
  !!requoteBlock && /addrUpdates\.requoteAppliedAt/.test(requoteBlock) &&
  /addrUpdates\.requoteKind\s*=/.test(requoteBlock),
  'two writes can half-succeed — an applied re-quote with no kind is a wrong badge');

/* ⚠ AND IT IS TAKEN FROM THE QUOTE, not re-derived by comparing addresses. That
   comparison is the guess showApplyRequoteChoice was explicitly moved OFF on
   2026-08-21: "Red Cedar Ln" against "Red Cedar Lane" reads as a move that never
   happened. */
check('the kind comes from the quote that was answered',
  /requoteKind[\s\S]{0,200}quotesCache/.test(admin) ||
  /quotesCache[\s\S]{0,600}requoteKind/.test(admin),
  'she was asked when the re-quote was raised; that answer is the one to keep');

/* ⚠ AND A BLANK IS NOT WRITTEN. An empty requoteKind stored on the customer is
   worse than none: it looks answered. */
check('a re-quote with no stated kind writes nothing',
  /if\(answeredKind\)\s*addrUpdates\.requoteKind\s*=/.test(admin),
  'a blank stored where an answer goes reads as an answer');

// ---------------------------------------------------------------------------
// COLOURS LIVE IN TWO FIELDS, AND THE WAREHOUSE HAS TO READ BOTH
// ---------------------------------------------------------------------------
/* ⭐ Addie, 2026-08-24, looking at the Waiting on light colours block: "All I want are
   the lights saved on peoples houses that don't have a category of lights its under
   like red, warm."

   ⚠ THAT BLOCK WAS MOSTLY NOT MISSING ANSWERS — it was answers nobody read.
   `rbDetectColorsAndPattern`, which the master-sheet sync writes through, only fills
   `lightsDescription` when a colour REPEATS, because a repeat means an alternating
   pattern where the order matters. An ordinary house comes back as
   {colors:['Red','Warm White'], pattern:''}. Four warehouse readers tested the
   description alone, so every ordinary house the sync added was called blocked, had no
   bulbs ordered for it, and was left out of the pending count.

   ⚠ THE FIXTURE HAS TO BE SHAPED THE WAY THE SPLITTER REALLY WRITES ONE — colours in
   the list, description EMPTY. A fixture carrying both fields passes whether the fix
   is there or not, which is how this went unnoticed in the first place. So the
   splitter is RUN here and its own output is fed in. */
const aliases = (admin.match(/const RB_COLOR_ALIASES = \{[\s\S]*?\n\};/) || [''])[0];
const whColors = (admin.match(/const WH_LIGHT_COLORS = \[[\s\S]*?\];/) || [''])[0];
const splitter = (aliases && whColors && fn('rbNormalizeColors') && fn('rbDetectColorsAndPattern'))
  ? new Function(aliases + whColors + (admin.match(/const RB_MULTI_RE = [^\n]*\n/)||[''])[0] + fn('rbLooksMulti') + runSrc + (admin.match(/const RB_LIGHT_COLOR_OPTIONS = \[[\s\S]*?\];/)||[''])[0] + fn('rbNormalizeColors') + fn('rbDetectColorsAndPattern') +
      'return rbDetectColorsAndPattern;')()
  : null;
check('the sheet splitter can still be found and run', !!splitter,
  'this check is about what it produces, so it must not quietly skip');

if (splitter) {
  const plain = splitter('Red, Warm White');
  check('an ordinary colour list really does leave the description empty',
    plain.pattern === '' && plain.colors.length === 2,
    'if this ever stops being true the bug below cannot happen and this block is moot ' +
    '— got ' + JSON.stringify(plain));
  const alternating = splitter('Red, Warm White, Red');
  check('and a repeated colour still produces one, because the order matters',
    alternating.pattern !== '',
    'got ' + JSON.stringify(alternating));

  const lightsText = fn('houseLightsText');
  check('houseLightsText exists', !!lightsText,
    'one helper is what stops half of the pair being forgotten again');
  if (lightsText) {
    const H = new Function(lightsText + 'return houseLightsText;')();
    check('a house whose colours are only in the list still has colours',
      H({lightColors: plain.colors, lightsDescription: ''}) === 'Red, Warm White',
      'this is the shape the master-sheet sync writes; got ' +
      JSON.stringify(H({lightColors: plain.colors, lightsDescription: ''})));
    /* ⚠ THE DESCRIPTION WINS WHERE THERE IS ONE, because it carries the ORDER an
       alternating house is built in and the list deliberately does not. */
    check('and an alternating house keeps its order, not its sorted list',
      H({lightColors: alternating.colors, lightsDescription: alternating.pattern}) ===
        alternating.pattern,
      'the list drops the repeat, which IS the pattern; got ' +
      JSON.stringify(H({lightColors: alternating.colors, lightsDescription: alternating.pattern})));
    check('and a house with genuinely nothing still has nothing',
      H({}) === '' && H({lightColors: []}) === '' && H({lightsDescription: '   '}) === '',
      'the blocked block has to keep catching the real ones');
  }

  /* ⚠ AND THE READERS MUST ASK IT. A helper nothing calls is a helper that fixed
     nothing — these four are the ones that were wrong. */
  [['whBuildQueueGroups', 'the build queue'],
   ['computeColorDemand', 'the colour totals — this is what gets ORDERED'],
   ['computePendingHouseCount', 'the pending count'],
   ['whRecycleGroups', 'the recycle queue']].forEach(([name, what]) => {
    const body = fn(name);
    check(what + ' reads both colour fields', !!body && /houseLightsText\(/.test(body),
      name + ' still tests lightsDescription on its own');
  });
  /* ⚠ AND THE PRINTED CELL GIVES THE SAME ANSWER THE GROUP HEADING DOES. It used to
     work the two fields out for itself and join with "/", so the cell said
     "Red/Warm White" under a heading saying "Red, Warm White", about one house. */
  check('the printed Light color cell asks the same helper',
    /houseLightsText\(/.test(fn('printLightColor')),
    'two answers to one question, one of them on paper');
}

// ---------------------------------------------------------------------------
// ONE COLOUR VOCABULARY — THE IMPORT AND THE WAREHOUSE MUST KNOW THE SAME WORDS
// ---------------------------------------------------------------------------
/* ⭐ Addie, 2026-08-24: "Soft is Warm White and Warm is Warm white. Is there any other
   colors having problems besides that" — and the audit found a bigger one than either.

   ⚠ THERE WERE TWO COLOUR SYSTEMS AND THEY KNEW DIFFERENT WORDS. `rbNormalizeColors`
   reads the master sheet through RB_COLOR_ALIASES (ww, w, warm, pure, p, pw, r, rr).
   `whColorsFromWords`, which decides the warehouse GROUP, knew only the nine full
   names. So a lightsDescription holding an abbreviation became its own heading,
   verbatim: "ww" and "Warm White" were two piles for one build.

   ⚠ RUN, BOTH OF THEM, AGAINST THE SAME INPUT. A check that the alias table contains a
   key proves nothing about the side that never read the table. */
const aliasSrc = (admin.match(/const RB_COLOR_ALIASES = \{[\s\S]*?\n\};/) || [''])[0];
const vocabSrc = (admin.match(/const WH_COLOR_WORDS = \(function\(\)\{[\s\S]*?\n\}\)\(\);/) || [''])[0];
/* ⚠ The multi rule is a REGEX, not a table row — "anything multi something is Multi"
   cannot be spelled out as nine keys — so it travels with the vocabulary. */
const whListSrc = (admin.match(/const WH_LIGHT_COLORS = \[[\s\S]*?\];/) || [''])[0];
const rbListSrc = (admin.match(/const RB_LIGHT_COLOR_OPTIONS = \[[\s\S]*?\];/) || [''])[0];
const haveVocab = !!(aliasSrc && vocabSrc && whListSrc && rbListSrc &&
  fn('whColorsFromWords') && fn('whNormalizeLights') && fn('rbNormalizeColors'));
check('the colour tables and both normalisers can be found', haveVocab,
  'this block is the whole answer to "are any other colours having problems"');

if (haveVocab) {
  const groupOf = new Function(whListSrc + aliasSrc + multiSrc + runSrc + vocabSrc + fn('whColorsFromWords') + splitSrc +
    fn('whOrderColors') + fn('whWireLabel') + fn('whNormalizeLights') + 'return whNormalizeLights;')();
  const importOf = new Function(aliasSrc + rbListSrc + whListSrc + multiSrc + runSrc + fn('rbNormalizeColors') +
    'return rbNormalizeColors;')();

  /* Every key the import understands must reach the same colour in the warehouse. */
  const aliasKeys = Object.keys(new Function(aliasSrc + 'return RB_COLOR_ALIASES;')());
  const disagree = aliasKeys.filter(function(k){
    const imported = importOf(k).slice().sort().join(', ');
    const grouped = groupOf(k).split(', ').slice().sort().join(', ');
    return imported !== grouped;
  });
  /* ⚠ AND THE MULTI RULE IS ASSERTED ON BOTH SIDES SEPARATELY. It is a regex rather
     than table rows, so the alias-key sweep above cannot reach it — and a red-check
     proved that: deleting the rule from the import changed nothing, because table
     rows were quietly doing the same job. The rows are gone and these are the guard. */
  ['multi', 'multicolor', 'multicolour', 'multi color', 'multi colour',
   'multi-color', 'multi-colour', 'multicolored', 'multicoloured'].forEach(function(t){
    check('the import reads "' + t + '" as Multi',
      importOf(t).join('|') === 'Multi', 'got ' + JSON.stringify(importOf(t)));
    check('and the warehouse groups "' + t + '" as Multi',
      groupOf(t) === 'Multi', 'got ' + JSON.stringify(groupOf(t)));
  });
  check('every word the import knows, the warehouse groups the same way',
    disagree.length === 0,
    'two headings for one build: ' + JSON.stringify(disagree));

  /* The specific ones Addie named, and the abbreviations the office actually types. */
  /* ⭐ EVERY ONE OF THESE IS ADDIE'S OWN RULING, 2026-08-24, given when she was asked
     which spellings really appear in the sheet. Do not change one without her.
     ⚠ A REPEATED SINGLE LETTER IS A COUNT: "R is Red, RR is Red, Red", "bbb is Blue,
     Blue, Blue". They used to collapse to one colour, which merged rr and rrr into one
     build. WW and PW are initials, NOT repeats, and she gave both in the same breath. */
  [['warm', 'Warm White'], ['Warm', 'Warm White'], ['ww', 'Warm White'], ['w', 'Warm White'],
   ['warm white', 'Warm White'], ['pure', 'Pure White'], ['p', 'Pure White'],
   ['pw', 'Pure White'],
   ['r', 'Red'], ['rr', 'Red, Red'], ['rrr', 'Red, Red, Red'],
   ['b', 'Blue'], ['bb', 'Blue, Blue'], ['bbb', 'Blue, Blue, Blue'],
   ['g', 'Green'], ['gg', 'Green, Green'], ['ggg', 'Green, Green, Green'],
   ['pur', 'Pure White'], ['clear', 'Pure White'],
   ['cool white', 'Pure White'], ['bright white', 'Pure White'],
   ['orng', 'Orange'], ['pnk', 'Pink'], ['blu', 'Blue'], ['grn', 'Green'],
   ['rainbow', 'Multi'], ['multi', 'Multi'], ['multicolour', 'Multi'],
   ['multi-colour', 'Multi'], ['multi colour', 'Multi'], ['multi coloured', 'Multi'],
   ['reds', 'Red'], ['greens', 'Green'], ['warm whites', 'Warm White']
  ].forEach(function(pair){
    check('the warehouse groups "' + pair[0] + '" as ' + pair[1],
      groupOf(pair[0]) === pair[1],
      'got ' + JSON.stringify(groupOf(pair[0])));
  });

  /* ⭐ SOFT IS WARM WHITE (2026-08-24). Addie, asked directly and told what it cost:
     "soft should be Warm White".
     ⚠ THIS REVERSES HER OWN RULING OF 2026-08-19, under which soft kept its own label
     so those houses stayed findable. The label had made the warehouse a group headed
     soft(recycled), which is not a colour anybody stocks, so nobody could build it.
     ⚠ soft(recycled) IS CHECKED AS WELL AS soft: it is the value already stored on
     real records, and without it the note reader turns it into "Warm White
     (recycled)" — its own heading, which does not merge and so does not do what she
     asked. */
  ['soft', 'soft white', 'soft(recycled)'].forEach(function(t){
    check('"' + t + '" is Warm White on both sides',
      groupOf(t) === 'Warm White' && importOf(t).join('|') === 'Warm White',
      'got ' + JSON.stringify([groupOf(t), importOf(t)]));
  });
  check('and a soft house builds with the plain warm white ones',
    groupOf('soft(recycled)') === groupOf('Warm White') &&
    groupOf('Red, soft(recycled)') === groupOf('Red, Warm White'),
    'one group is the whole point of the ruling; got ' +
    JSON.stringify([groupOf('Red, soft(recycled)'), groupOf('Red, Warm White')]));

  /* ⭐ AND THE SWITCHING LIST SURVIVES, which is what made the ruling cheap. The All
     Customers filter matches /soft/i against the RAW record, never through the colour
     table, so every house already carrying soft(recycled) is still findable and the
     two checkboxes that write it are untouched.
     ⚠ If somebody "tidies" that filter into using the normaliser it will silently
     match nobody, and the only list of who is on old stock is gone. */
  const softFilter = admin.slice(admin.indexOf("if(lightsFilter === 'soft')"),
                                 admin.indexOf("} else if(lightsFilter === 'none')"));
  check('the switching filter still reads the raw record',
    /\/soft\/i\.test/.test(softFilter) && !/whNormalizeLights|houseLightsText/.test(softFilter),
    'it is the only way left to find who is on old stock');
  check('and both colour pickers still offer soft as a label',
    (admin.match(/value="soft\(recycled\)"/g) || []).length >= 2,
    'Add Customer and Edit Customer each have one; they are what mark a house');

  /* ⚠ A REAL NOTE IS STILL A NOTE. The whole-description reader must not swallow
     "Warm White (every third bulb)" — that bracket is somebody\'s instruction. */
  check('a genuine bracketed note is left alone',
    groupOf('Warm White (every third bulb)') === 'Warm White (every third bulb)',
    'got ' + JSON.stringify(groupOf('Warm White (every third bulb)')));

  /* ⚠ THE UNKNOWN-WORD GUARD IS THE HALF THAT MUST NOT BE LOST. Only a description
     made ENTIRELY of words we know is rewritten; anything else is kept exactly as
     typed and shows as its own heading, which somebody can see and correct. Guessing
     would put a bundle of the wrong colour on a real house. */
  /* ⚠ `mc` IS IN THIS LIST DELIBERATELY. Addie, asked: "mc lets come back to this
     one" — so it is not yet ruled on and must NOT be guessed at. Moving it out of
     here needs her answer, not a plausible expansion. */
  [['Red with tinsel'], ['Green garland'], ['mc'], ['multi red something']].forEach(function(t){
    check('"' + t[0] + '" is left exactly as typed, not guessed at',
      groupOf(t[0]) === t[0],
      'got ' + JSON.stringify(groupOf(t[0])));
  });

  /* ⚠ AND NORMALISING IS IDEMPOTENT. `soft(recycled)` is what the import WRITES and it
     is not one of the nine, so the notes reader tore its brackets off and put them
     back: "soft(recycled) (recycled)". Anything whose group heading changes when it is
     normalised twice will drift a group at a time. */
  ['Warm White', 'ww', 'soft', 'soft(recycled)', 'Red, Green', 'white',
   'Warm White (every third bulb)', 'Red with tinsel'].forEach(function(t){
    const once = groupOf(t);
    check('re-normalising "' + t + '" gives the same answer',
      groupOf(once) === once,
      JSON.stringify(once) + ' became ' + JSON.stringify(groupOf(once)));
  });

  /* ⭐ LETTERS RUN TOGETHER ARE A STRAND (2026-08-24). Addie, asked whether a cell
     reading `rrgg` meant the same as `rr/gg`: "That is still Red, Red, Green, Green
     all of those ways." The separator is optional. */
  ['rrgg', 'rr/gg', 'rr, gg', 'RRGG'].forEach(function(t){
    check('the import reads "' + t + '" as two reds and two greens',
      importOf(t).join('|') === 'Red|Red|Green|Green', 'got ' + JSON.stringify(importOf(t)));
    check('and the warehouse groups "' + t + '" the same',
      groupOf(t) === 'Red, Red, Green, Green', 'got ' + JSON.stringify(groupOf(t)));
  });
  check('and a run keeps the order it was written in',
    groupOf('rgrg') === 'Red, Green, Red, Green' && groupOf('rrgg') !== groupOf('rgrg'),
    'got ' + JSON.stringify([groupOf('rrgg'), groupOf('rgrg')]));
  check('a longer run still reads one letter at a time',
    importOf('rrggbb').join('|') === 'Red|Red|Green|Green|Blue|Blue',
    'got ' + JSON.stringify(importOf('rrggbb')));

  /* ⚠ w AND p ARE EXCLUDED, AND THAT LIMIT IS THE WHOLE SAFETY OF THE RULE. WW and PW
     are INITIALS — Warm White and Pure White — both ruled on by Addie in the same
     message as the counts. A reader that expanded every letter would turn ww into two
     warm whites, which is the opposite of what she said, and `wwrr` is genuinely
     ambiguous with no way to tell. Left as typed, visible, correctable. */
  check('ww and pw are still initials, not runs',
    groupOf('ww') === 'Warm White' && groupOf('pw') === 'Pure White',
    'got ' + JSON.stringify([groupOf('ww'), groupOf('pw')]));
  ['wwrr', 'pwrr', 'mc'].forEach(function(t){
    check('"' + t + '" is left exactly as typed rather than guessed at',
      groupOf(t) === t && importOf(t).join('|') === t,
      'got ' + JSON.stringify([groupOf(t), importOf(t)]));
  });
  check('one letter on its own is not a run — the table answers it',
    groupOf('r') === 'Red' && groupOf('o') === 'Orange',
    'got ' + JSON.stringify([groupOf('r'), groupOf('o')]));

  /* ⚠ AND THE TWO READERS AGREE WHERE BOTH CAN READ A TOKEN. rr, rrr, gg, ggg, bb and
     bbb are alias keys AND valid runs; if they ever disagreed the answer would be
     decided by call order, which is not a rule anybody could look up. */
  const aliasTable = new Function(aliasSrc + 'return RB_COLOR_ALIASES;')();
  const runner = new Function(runSrc + 'return rbLetterRun;')();
  const clash = Object.keys(aliasTable).filter(function(k){
    const run = runner(k);
    if (!run) return false;
    const table = [].concat(aliasTable[k]);
    return table.join('|') !== run.join('|');
  });
  check('the alias table and the run reader never disagree about a token',
    clash.length === 0, 'both can read these and they differ: ' + JSON.stringify(clash));

  /* ⭐ A SET SORTS, A PATTERN KEEPS ITS ORDER (2026-08-24). Sorting exists so two
     people typing the same two colours land in one group. Since RR means two reds,
     order now carries information: rrgg and rgrg are the same four bulbs and two
     different strands, and sorting flattens both to one heading. */
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
  /* ⚠ AND THE REPEAT REACHES THE PATTERN FIELD. rbDetectColorsAndPattern is what the
     master-sheet sync writes through: a repeat has to land in lightsDescription, where
     the order is kept, and NOT be flattened into the colour list. */
  if (splitter) {
    check('a repeated letter is written as a pattern, not a plain colour',
      splitter('rr').pattern === 'Red, Red' && splitter('rrr').pattern === 'Red, Red, Red',
      'got ' + JSON.stringify([splitter('rr'), splitter('rrr')]));
  }
  /* ⚠ LONGEST MATCH FIRST, or "warm" eats the front of "warm white" and the leftover
     "white" comes back as a second colour — which would put every warm-white house
     into a three-colour group. */
  check('a longer colour name wins over a shorter one inside it',
    groupOf('warm white') === 'Warm White' && groupOf('pure white') === 'Pure White',
    'got ' + JSON.stringify([groupOf('warm white'), groupOf('pure white')]));

  /* ⚠ AND AN ALIAS MAY BE A LIST. "white" is both, because the office ruled
     2026-08-19 that "we really dont know" — it must spread, not land as one name
     with a comma inside it. */
  check('"white" still means both whites',
    groupOf('white') === 'Pure White, Warm White',
    'got ' + JSON.stringify(groupOf('white')));

  /* ⚠ AND THE CREW PORTAL KNOWS THE SAME WORDS. Two copies of this exist by design;
     run-all.js compares them line for line, and this runs the crew's copy to be sure
     the comparison is about something that works. */
  const emp = fs.readFileSync(path.join(__dirname, 'employee.html'), 'utf8');
  const empFn = (n) => { const i = emp.indexOf('function ' + n + '('); return i === -1 ? '' : emp.slice(i, emp.indexOf('\n}', i) + 2); };
  const empAlias = (emp.match(/const RB_COLOR_ALIASES = \{[\s\S]*?\n\};/) || [''])[0];
  const empVocab = (emp.match(/const WH_COLOR_WORDS = \(function\(\)\{[\s\S]*?\n\}\)\(\);/) || [''])[0];
  const empList  = (emp.match(/const WH_LIGHT_COLORS = \[[\s\S]*?\];/) || [''])[0];
  check('the crew portal has the colour vocabulary too',
    !!(empAlias && empVocab && empList && empFn('whColorsFromWords') && empFn('whNormalizeLights')),
    'it grouped by the nine full names alone and knew none of the abbreviations');
  if (empAlias && empVocab && empList && empFn('whNormalizeLights')) {
    const empMulti = (emp.match(/const RB_MULTI_RE = [^\n]*\n/) || [''])[0] + empFn('rbLooksMulti') +
      (emp.match(/const RB_RUN_LETTERS = \{[^}]*\};/) || [''])[0] + empFn('rbLetterRun');
    const empGroup = new Function(empList + empAlias + empMulti + empVocab + empFn('whColorsFromWords') + (emp.match(/const WH_LIGHT_SEP = [^\n]*\n/) || [''])[0] + empFn('whSplitAllKnown') +
      empFn('whOrderColors') + empFn('whWireLabel') + empFn('whNormalizeLights') + 'return whNormalizeLights;')();
    const differ = ['ww', 'w', 'warm', 'p', 'pure', 'r', 'bbb', 'white', 'soft',
                    'Red with tinsel', 'Red, Green']
      .filter(function(t){ return empGroup(t) !== groupOf(t); });
    check('and groups every one of them exactly as the office does',
      differ.length === 0,
      'the crew screen and the office would show different piles for: ' + JSON.stringify(differ));
  }
}

// ---------------------------------------------------------------------------
const w = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };
console.log('\n=== Why a bundle is being built ===\n');
console.log('  ' + w('', 54) + w('badge', 16) + 'wanted');
rows.forEach(([name, got, want]) => {
  const label = got ? (WH_BUILD_REASONS[got] ? WH_BUILD_REASONS[got].label : got) : '—';
  console.log('  ' + w(name, 54) + w(label, 16) + (got === want ? '' : '<-- WRONG'));
});
console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('A badge is a claim about where a job came from, printed beside somebody’s');
  console.log('name. Wrong is worse than absent: it sends the warehouse to make one');
  console.log('bundle for a house that needs the lot, and nothing on the sheet disagrees.\n');
}
process.exit(fail ? 1 : 0);
