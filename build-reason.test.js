/*
 * Why a bundle is being built — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-08-24: "There should be a badge by each person on warehouse that say's
 * new, Old-Rebuild or Member Poral or Request", with her own definitions:
 *
 *     New           a new quote
 *     Old-Rebuild   already a member — changed address, extended the house, or added
 *                   on a building
 *     Member Portal anything that got changed in member portal
 *     Request       we added it on ourselves, from a request that came in by email,
 *                   call or text
 *
 * Four words, and every one of them is a CLAIM ABOUT WHERE SOMETHING CAME FROM. That is
 * a different kind of thing from the chips beside it: Timer and wire are read straight
 * off the record, and if one is wrong the record is wrong. This one is inferred from
 * four fields written at four different moments, so it can be confidently wrong while
 * every field it read is perfectly right.
 *
 * R-018 says not to add checks to run-all.js, so this follows the pattern the other
 * gates use — one file, one job, wired into `npm test`.
 *
 * ⚠ IT RUNS THE REAL RULE, lifted out of admin.html, never a local copy. A second
 * opinion written here would agree with itself and prove nothing.
 *
 * ⚠ AND IT CHECKS THE WRITERS. Two of the four badges cannot be told apart without
 * `lightsChangedVia`, and NOTHING WROTE THAT FIELD until this change: the portal and the
 * office both stamped `lightsChangedAt` and neither said which one it was. A badge
 * reading a field nobody writes renders the same answer for everybody, looks
 * authoritative, and is the exact shape of the Contact 2027 tab that shipped reading
 * `maybeNextYear` while portalRsvp wrote the status alone. So every field this rule
 * reads is checked to have a writer.
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

/* ⚠ \r?\n, NOT \n. admin.html is CRLF and a raw newline in an anchor matches nothing —
   the trap CLAUDE.md §7 names by hand, which has already broken this file once. */
function fn(name) {
  const at = admin.indexOf('function ' + name + '(');
  if (at === -1) return '';
  const m = /\r?\n\}/.exec(admin.slice(at));
  return m ? admin.slice(at, at + m.index + m[0].length) : '';
}
/* Slices the block a given `if (...) {` opens, by counting braces.
   ⚠ A FIXED CHARACTER WINDOW GOES STALE THE MOMENT SOMEBODY ADDS A COMMENT. Two writes
   being in the same BLOCK is what is actually claimed, so assert that, not a distance. */
function block(src, opener) {
  const at = src.indexOf(opener);
  if (at === -1) return '';
  let depth = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  return '';
}

const reasonsSrc = (admin.match(/const WH_BUILD_REASONS = \{[\s\S]*?\r?\n\};/) || [''])[0];
const NEEDED = ['whBuildReasonKey', 'whBuildReasonChip', 'whBuildReasonLabel',
                'whHouseFactsHtml', 'esc'];
const missing = NEEDED.filter(n => !fn(n)).concat(reasonsSrc ? [] : ['WH_BUILD_REASONS']);
if (missing.length) {
  console.log('\n  FAIL  cannot find in admin.html: ' + missing.join(', '));
  console.log('\n  A rename is a real change and this gate refuses to pass over one.');
  console.log('  Fix the name here in the same commit that renamed it.\n');
  process.exit(1);
}

const sb = new Function(reasonsSrc + fn('esc') + fn('whBuildReasonKey') +
  fn('whBuildReasonChip') + fn('whBuildReasonLabel') +
  'return {WH_BUILD_REASONS, key: whBuildReasonKey, chip: whBuildReasonChip, label: whBuildReasonLabel};')();
const { WH_BUILD_REASONS } = sb;

// ---------------------------------------------------------------------------
// THE TABLE. One row per thing that can bring a house to the warehouse.
// ---------------------------------------------------------------------------
const STAMP = { seconds: 1756000000 };   // any Firestore timestamp will do

const CASES = [
  ['a brand new quote, converted',
   { chargeNewMemberFee: true, needsLightBuild: true }, 'new'],
  ['a member who moved — address re-quote',
   { requoteAppliedAt: STAMP, requoteKind: 'address', needsLightBuild: true }, 'rebuild'],
  ['a member who added on a building',
   { requoteAppliedAt: STAMP, requoteKind: 'addition', needsLightBuild: true }, 'rebuild'],
  ['a re-quote that only corrected the price',
   { requoteAppliedAt: STAMP, requoteKind: 'price', needsLightBuild: true }, ''],
  ['colours changed by the customer in their portal',
   { lightsChangedAt: STAMP, lightsChangedVia: 'portal', needsLightBuild: true }, 'portal'],
  ['colours we typed in after a call, an email or a text',
   { lightsChangedAt: STAMP, lightsChangedVia: 'office', needsLightBuild: true }, 'request'],
  ['a colour change from before anything recorded the source',
   { lightsChangedAt: STAMP, needsLightBuild: true }, 'changed'],
  ['a returning member re-quoted — NOT a new customer',
   { chargeNewMemberFee: true, requoteAppliedAt: STAMP, requoteKind: 'address' }, 'rebuild'],
  ['somebody who moved AND picked new colours',
   { requoteAppliedAt: STAMP, requoteKind: 'address', lightsChangedAt: STAMP,
     lightsChangedVia: 'portal' }, 'rebuild'],
  ['an ordinary house being rebuilt for no stated reason',
   { needsLightBuild: true }, ''],
  ['an empty record does not throw and claims nothing', {}, ''],
];

const rows = [];
CASES.forEach(([name, rec, want]) => {
  let got;
  try { got = sb.key(rec); } catch (e) { got = 'THREW: ' + e.message; }
  rows.push([name, got, want]);
  check('badge — ' + name, got === want,
    'expected ' + (want ? '"' + want + '"' : 'no badge') +
    ', got ' + (got ? '"' + got + '"' : 'no badge'));
});

// ---------------------------------------------------------------------------
// THE RULE'S OWN SHAPE
// ---------------------------------------------------------------------------
/* ⭐ HER FOUR WORDS, SPELLED THE WAY SHE ASKED FOR THEM. A badge is read at a glance off
   a shelf; "Rebuild" and "Old-Rebuild" are not the same word to somebody scanning for
   one of four. Renaming one is her call, not a tidy-up. */
[['new', 'NEW'], ['rebuild', 'OLD-REBUILD'], ['portal', 'MEMBER PORTAL'],
 ['request', 'REQUEST']].forEach(([key, label]) => {
  check('the ' + key + ' badge still reads "' + label + '"',
    WH_BUILD_REASONS[key] && WH_BUILD_REASONS[key].label === label,
    'she named these four by hand');
});

/* Every key the rule can return has a label, and every label is reachable.
   ⚠ A key with no entry renders NOTHING — the row silently loses its badge and looks
   like an ordinary rebuild, which is the one failure nobody can see. */
const returned = new Set(rows.map(r => r[1]).filter(Boolean));
returned.forEach(k => check('the rule can return "' + k + '" and there is a badge for it',
  !!WH_BUILD_REASONS[k], 'a key with no entry renders an empty chip'));
Object.keys(WH_BUILD_REASONS).forEach(k =>
  check('the "' + k + '" badge is reachable from the rule', returned.has(k),
    'a badge nothing can produce is one nobody will ever see'));

check('a badge renders as a chip carrying its label',
  /MEMBER PORTAL/.test(sb.chip({ lightsChangedAt: STAMP, lightsChangedVia: 'portal' })),
  'the rule can be right and the chip still print nothing');
check('no badge renders nothing at all, not an empty chip', sb.chip({}) === '',
  'an empty pill on every ordinary row is noise on the sheet people scan');
/* ⚠ ONE RULE, TWO RENDERERS. A coloured pill and a black-on-white sheet cannot share a
   renderer but must never make different claims. */
check('the chip and the printed label agree about every case',
  rows.every(([, got]) => {
    const rec = CASES[rows.findIndex(r => r[1] === got)][1];
    const lab = sb.label(rec);
    return lab === '' ? sb.chip(rec) === '' : sb.chip(rec).indexOf(lab) !== -1;
  }), 'the screen and the paper would say different things about one job');

/* ⭐ NEW IS THE ONLY ONE THAT SURVIVES A STALE FLAG. chargeNewMemberFee stays true on
   somebody who joined in a previous season, so the flag alone would badge much of the
   book NEW. ⚠ And a string "yes" is not true — read strictly, as everywhere else. */
check('a re-quote beats a stale join flag',
  sb.key({ chargeNewMemberFee: true, requoteAppliedAt: STAMP, requoteKind: 'addition' }) === 'rebuild',
  'somebody carrying last season’s join flag who is being rebuilt is a rebuild');
check('the join flag is read strictly', sb.key({ chargeNewMemberFee: 'yes' }) !== 'new',
  'a loose read turns any truthy value into a first-time hang');

check('the source is read case-insensitively',
  sb.key({ lightsChangedAt: STAMP, lightsChangedVia: ' Portal ' }) === 'portal',
  'a stored value with a capital or a space must not fall through to CHANGED');
check('a price re-quote is recognised whatever its case',
  sb.key({ requoteAppliedAt: STAMP, requoteKind: 'PRICE' }) === '',
  'nothing is built differently because a number was corrected');
/* ⚠ AND AN UNKNOWN SOURCE SAYS "CHANGED", NEVER A GUESS. This is the whole argument for
   the fifth badge: every colour change made before 2026-08-24 carries no source, and
   picking one of her four for them would put a wrong provenance on a printed sheet. */
check('an unrecognised source is admitted, not guessed at',
  sb.key({ lightsChangedAt: STAMP, lightsChangedVia: 'sms-import' }) === 'changed',
  'a source we do not recognise is not evidence for either of the two we do');

// ---------------------------------------------------------------------------
// IT REACHES THE SCREEN, AND THE PAPER
// ---------------------------------------------------------------------------
/* ⚠ ONE PLACE, so every warehouse row gets it. whHouseFactsHtml is what the build
   groups, the blocked block and the add-on rows all call. */
check('the badge is built by whHouseFactsHtml', /whBuildReasonChip\(/.test(fn('whHouseFactsHtml')),
  'the one function every warehouse row type calls');
check('and it leads the chips',
  fn('whHouseFactsHtml').indexOf('whBuildReasonChip(') < fn('whHouseFactsHtml').indexOf('Timer'),
  'what kind of job this is comes before what goes in the bin');
const factCalls = (admin.match(/whHouseFactsHtml\(/g) || []).length;
check('whHouseFactsHtml is still called by more than one row type', factCalls >= 3,
  'definition plus at least two call sites; found ' + factCalls);

/* ⭐ AND ON PAPER (Addie: "I need paper to carry badge too"). Both build sheets carry a
   Why column, and every row builder fills it — buffer stock with a blank, deliberately,
   because there is no customer behind it to make a claim about. */
const whCols = admin.slice(admin.indexOf('const WH_BUILD_COLUMNS = ['),
                           admin.indexOf('const WH_RECYCLE_COLUMNS = ['));
check('the warehouse tab’s build sheet has a Why column',
  /key:'reason'/.test(whCols) && /label:'Why'/.test(whCols),
  'this is the sheet the warehouse prints and builds off');
check('and it sits beside Type, not after Notes',
  whCols.indexOf("key:'reason'") > whCols.indexOf("key:'type'") &&
  whCols.indexOf("key:'reason'") < whCols.indexOf("key:'notes'"),
  'Notes is the wide free-text column and anything after it is lost against writing');
const printCols = admin.slice(admin.indexOf("  build:     [{k: 'number'"),
                              admin.indexOf("  warehouse: [{k: 'number'"));
check('and the Printing tab’s build sheet has one too',
  /k: 'reason'/.test(printCols) && /label: 'Why'/.test(printCols),
  'there are two build sheets and the other one is the one with thinner cover');
check('every row builder fills the Why cell',
  (fn('whSheetRowsForBuild').match(/reason:/g) || []).length === 3,
  'houses, extras and the blocked ones all push rows onto that sheet');
/* ⚠ A BLOCKED ROW KEEPS ITS BADGE — those are the ones somebody has to chase, so losing
   it there is the wrong place to lose it. Buffer stock carries none. */
const sheet = fn('whSheetRowsForBuild');
check('a blocked row keeps its badge', /type: 'Blocked',[\s\S]{0,80}reason: whBuildReasonLabel/.test(sheet),
  'the rows most likely to need chasing are the ones that lost it');
check('and buffer stock claims none', /type: isTimer \? 'Timer' : 'Extra',[\s\S]{0,400}reason: ''/.test(sheet),
  'a badge on a row nobody asked for is a claim about somebody who does not exist');

// ---------------------------------------------------------------------------
// THE WRITERS — the half that is worth more than the readers
// ---------------------------------------------------------------------------
/* ⭐ THE PORTAL SAYS IT WAS THE PORTAL. Two write sites in portalSave: the update and
   the customer mirror. Both, or a change made through one path is badged and the other
   is not. ⚠ AND IN THE SAME BLOCK as the timestamp — a date with no source is exactly
   the record that cannot be badged. */
const portalViaWrites = (server.match(/lightsChangedVia\s*=\s*'portal'/g) || []).length;
check('portalSave stamps the source on both of its writes', portalViaWrites >= 2,
  'found ' + portalViaWrites + ' — a change through the unstamped path reads as CHANGED');
[['if (oldData.lightsDescription) {', 'the quote/customer update'],
 ['if (d.setLightsChangedAt) {', 'the customer mirror']].forEach(([opener, what]) => {
  const b = block(server, opener);
  check('portal write — ' + what + ' — sets the date and the source together',
    !!b && /lightsChangedAt/.test(b) && /lightsChangedVia\s*=\s*'portal'/.test(b),
    'a date with no source cannot be badged');
});

/* ⭐ AND THE OFFICE SAYS IT WAS THE OFFICE. This is her "Request". */
const officeBlock = block(admin, 'if(lightChange.setLightsChangedAt){');
check('the Edit Customer save stamps the office as the source',
  !!officeBlock && /addrUpdates\.lightsChangedVia\s*=\s*'office'/.test(officeBlock),
  'without it a change we typed in is indistinguishable from one they made');
check('and in the same block as its own lightsChangedAt',
  !!officeBlock && /addrUpdates\.lightsChangedAt/.test(officeBlock),
  'the two must be written together or the source goes missing on some saves');

/* ⭐ THE RE-QUOTE KIND HAS TO REACH THE CUSTOMER. It is asked when the re-quote is
   RAISED and stored on the quote document, which a customer record cannot reach — so
   the badge read undefined on every customer and could not tell a house that moved from
   a price that was corrected. */
const requoteBlock = block(admin, 'if(requoteBeingConverted){');
check('applying a re-quote copies its kind onto the customer',
  !!requoteBlock && /addrUpdates\.requoteKind\s*=/.test(requoteBlock),
  'the badge reads it off the customer; nothing else can put it there');
check('and stamps requoteAppliedAt in the same block',
  !!requoteBlock && /addrUpdates\.requoteAppliedAt/.test(requoteBlock),
  'two writes can half-succeed — an applied re-quote with no kind is a wrong badge');
/* ⚠ TAKEN FROM THE QUOTE, not re-derived by comparing addresses. That comparison is the
   guess showApplyRequoteChoice was explicitly moved OFF on 2026-08-21: "Red Cedar Ln"
   against "Red Cedar Lane" reads as a move that never happened. */
check('the kind comes from the quote that was answered',
  !!requoteBlock && /quotesCache/.test(requoteBlock),
  'she was asked when the re-quote was raised; that answer is the one to keep');
check('a re-quote with no stated kind writes nothing',
  !!requoteBlock && /if\(answeredKind\)\s*addrUpdates\.requoteKind\s*=/.test(requoteBlock),
  'a blank stored where an answer goes reads as an answer');

// ---------------------------------------------------------------------------
// THE TWO BUILD SHEETS LIST THE SAME PEOPLE
// ---------------------------------------------------------------------------
/* ⭐ Addie, 2026-08-24: "everyone on the warehouse tab should be printed."

   ⚠ THE PRINTED LIST WAS A SECOND OPINION AND IT KEPT PEOPLE FOR EVER. It matched
   `chargeNewMemberFee` and `requoteAppliedAt` as well, and those are STAMPS, not flags:
   the warehouse clears needsLightBuild when the bundle is actually made, and nothing
   ever clears the other two. So every new member and every applied re-quote stayed on
   the printed sheet months after their bundle was built, and somebody working off that
   paper makes a second set for a house that already has one.

   ⚠ THE COLUMNS STAY DIFFERENT ON PURPOSE, and that is NOT drift. She trimmed the
   printed sheet herself, so bins ride inside the bundles cell there (printExtraBinsNote)
   and have a column of their own on the tab. Only WHO is on the two lists has to agree.
   Do not "tidy" this by merging the two sheets — that reverses her own decision. */
const printFilter = fn('printNeedsBuildList');
check('the printed build list asks the same one flag the tab does',
  /return d\.needsLightBuild;/.test(printFilter),
  'stamps never clear, so a stamped house never leaves the printed sheet');
/* ⚠ COMMENTS STRIPPED. The reason those two fields are NOT used is written down right
   there in the code, so a plain search finds the explanation and calls it a violation —
   which is what happened on the first run of this check. Suite 58 already carries the
   same note about the same mistake. */
const printCode = printFilter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
check('and does not read a stamp as a reason to build',
  !/chargeNewMemberFee|requoteAppliedAt/.test(printCode),
  'those are stamps, not flags — nothing ever clears them');
check('and still applies the season rule',
  /isOutForSeason\(d\)/.test(printFilter),
  'the printed sheet once listed people the screen beside it had already dropped');
/* ⚠ AND THE TAB ASKS THE SAME FLAG. If either side changes, they disagree about who is
   being built for, and the one on paper is the one nobody can check. */
check('and the warehouse tab asks it too',
  /!d\.needsLightBuild \|\|/.test(fn('whBuildQueueGroups')),
  'one flag, both lists');
/* ⚠ THE PRINTED SHEET KEEPS ITS OWN BINS NOTE. Asserted because merging the two sheets
   is the obvious-looking tidy-up and it would drop this. */
check('the printed sheet still carries the extra-bins note in its bundles cell',
  /printExtraBinsNote\(d\)/.test(printFilter),
  'she trimmed this sheet herself; the note is how bins reach paper');
// ---------------------------------------------------------------------------
// ONE PAGE PER COLOUR GROUP
// ---------------------------------------------------------------------------
/* ⭐ Addie picked this over splitting by badge: a colour-and-wire group is the pile
   somebody physically pulls from, so two people can build at once without sharing paper.
   Splitting by badge cuts across the piles and sends each person to every shelf.
   ⚠ RUN, NOT READ. A source check for a `.map` over groups passes while every row still
   lands on one page — the split is a behaviour, so the behaviour is what is asserted. */
const pager = new Function('jobAddresses', 'warehouseExtras', 'whGroupKey', 'houseBundleNeed',
  'whWireLabel', 'whPutIntoLabel', 'WH_BUILD_COLUMNS', 'whBinsForHouse', 'whWhoLabel',
  'houseLightsText', 'printExtraBinsNote', 'isOutForSeason',
  reasonsSrc + fn('whBuildReasonKey') + fn('whBuildReasonLabel') +
  fn('whBuildQueueGroups') + fn('whSheetRowsForBuild') + fn('whBuildSheetPages') +
  'return whBuildSheetPages();');
const P = function(custs, extras){
  return pager(custs, extras || [], (p, w) => p + ' | ' + (w || ''),
    (d) => ({bundles: 1, estimated: false, topUp: false}), (w) => String(w || 'white'),
    () => '', [], () => '1', (d) => d.name || '', (d) => d.lightsDescription || '',
    () => '', () => false);
};
const H = function(id, name, pattern, wire){
  return {id: id, data: {name: name, needsLightBuild: true, lightsDescription: pattern,
                         wireColor: wire, measuredFeet: 200}};
};
let pages = null;
try { pages = P([H('h1','Ashley','Warm White','white'), H('h2','Rachel','Warm White','white'),
                 H('h3','Cattani','Multi','green')]); }
catch (e) { pages = 'THREW: ' + e.message; }
check('the pager runs against a fixture', Array.isArray(pages),
  'this block is about behaviour, so it must not quietly skip — ' + pages);
if (Array.isArray(pages)) {
  check('two colour groups print as two pages', pages.length === 2,
    'got ' + JSON.stringify(pages.map(p => p.title)));
  check('and nobody is on more than one of them',
    pages.reduce((n, p) => n + p.rows.length, 0) === 3,
    'a house on two pages gets built twice; got ' + JSON.stringify(pages.map(p => p.rows.length)));
  /* ⚠ SHEET X OF Y IS THE POINT OF SPLITTING. Once the stack is handed out, the one
     thing nobody can tell from a single page is whether they hold all of them. */
  check('and every page says which of how many it is',
    pages.every((p, i) => p.summary.indexOf('sheet ' + (i + 1) + ' of 2') !== -1),
    'got ' + JSON.stringify(pages.map(p => p.summary)));
  /* ⚠ AND EACH PAGE COUNTS ITSELF, not the morning. A page handed to somebody building
     one pile needs THEIR numbers. */
  check('and each page counts only its own houses',
    /^2 houses/.test(pages[0].summary) && /^1 house /.test(pages[1].summary),
    'got ' + JSON.stringify(pages.map(p => p.summary)));
  check('and its own bundles, not the whole morning\'s',
    /\b2 bundles\b/.test(pages[0].summary) && /\b1 bundle\b/.test(pages[1].summary),
    'got ' + JSON.stringify(pages.map(p => p.summary)));
  /* ⭐ WAITING ON COLOURS LEADS THE STACK — nobody in the warehouse can act on those.
     ⚠ THE FIXTURE PUTS THE BLOCKED HOUSE LAST in the input, or the tab's own order
     already produces the right answer and the check proves nothing. */
  const withBlocked = P([H('h1','Ashley','Warm White','white'),
                         {id:'h9', data:{name:'Zoe No Colours', needsLightBuild: true}}]);
  check('waiting-on-colours is the first page in the stack',
    withBlocked.length === 2 && withBlocked[0].rows.every(r => r.type === 'Blocked'),
    'got ' + JSON.stringify(withBlocked.map(p => p.title)));
  check('and it does not swallow the colour groups behind it',
    withBlocked[1] && withBlocked[1].rows.length === 1,
    'got ' + JSON.stringify(withBlocked.map(p => p.rows.length)));
  check('and nothing to build prints no pages at all', P([]).length === 0,
    'an empty stack is what the Nothing needs building note is for');
}
/* ⚠ AND BOTH THE BUILD BUTTON AND THE RECYCLE ONE GO THROUGH THE SECTIONS API, or one
   of them throws the moment somebody presses it. */
check('the build button prints the pages',
  /whBuildSheetPages\(\)/.test(fn('whPrintBuildSheet')),
  'the pager exists and nothing calls it is the most expensive kind of green');
check('and the recycle sheet passes an array of one',
  /whOpenPrintWindow\([\s\S]{0,80}\[\{/.test(fn('whPrintRecycleSheet')),
  'the print window takes sections now; a bare table renders nothing');
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
