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

const requoteBlock = block(admin, 'if(requoteBeingConverted){\n      addrUpdates.requoteAppliedAt');
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
