/*
 * BLUEPRINT MAPS — the batch is what is showing, and the sheet is what prints
 * ==========================================================================
 * `npm run test:blueprint` — its own file per R-018.
 *
 * Crews draw a blueprint map of each house by hand. The Blueprint Maps panel keeps the
 * photograph of that drawing on the house's own record and prints any set of them eight
 * to a page, so a route fits in a pocket.
 *
 * ⭐ THE ONE IDEA THIS FILE EXISTS TO HOLD. There is no "add to print run" step. The
 * batch IS whatever is currently filtered, minus what has been unchecked, at each map's
 * saved copy count. Every check below is ultimately about that sentence staying true —
 * a change that reintroduces a build-a-list step would leave most of them green and the
 * screen pointless, which is why the queue, the counts and the sheet are all RUN against
 * the same filtered list rather than asserted separately.
 *
 * ⚠ IT RUNS THE REAL RULES, LIFTED OUT OF admin.html, NEVER A LOCAL COPY. Half of what
 * is proved here is a NUMBER ON A SHEET or a ROW ON A SCREEN, and this repo has been
 * caught four times by a check that matched the source of something that could never
 * reach the page. The stage classification in particular lifts `isRequote`, `quoteStage`
 * and `audienceNeverAsked` rather than stubbing them: the whole risk is a THIRD
 * definition of "new customer" appearing in a page that has already had two, and a stub
 * would decide the very thing under test.
 *
 * ⚠ AND THE WIRING IS ASSERTED SEPARATELY FROM THE MECHANISM. The harness calls the
 * renderer itself, so deleting the call from `renderJobAddressPanels` would leave every
 * behavioural check green while nothing reached the screen. That is the exact shape the
 * Edit Customer house-tabs work was caught by; the calls are named below.
 *
 * Run:  node blueprint-maps.test.js      (or: npm run test:blueprint)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const money = fs.readFileSync(path.join(ROOT, 'js', 'money.js'), 'utf8');

let pass = 0, fail = 0, notes = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); return; }
  fail++; failures.push(label + (detail ? ' — ' + detail : ''));
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
}
function note(msg) { notes++; console.log('  NOTE  ' + msg); }
function head(t) { console.log('\n=== ' + t + ' ===\n'); }

/* ---------------------------------------------------------------------------
 * LIFTING.
 * ⚠ THROUGH `connections/scan.js`, NOT A HAND-ROLLED BRACE COUNTER. The first version of
 * this file counted braces itself and died on `esc` within a minute: its body holds the
 * regex /[&<>"']/g, whose character class contains BOTH quote marks, so the counter
 * opened a string on the `"` and closed it on an apostrophe forty characters later —
 * swallowing every brace in between and cutting the lift off mid-try. That is CLAUDE.md's
 * own warning about hand-rolled tokenisers desynchronising, earned again. scan.js walks
 * regex literals and strings properly and is already the thing three other gates index
 * this file with.
 * A name that cannot be found is a FAIL, never a skip: a gate that cannot find its
 * target must not report green.
 * ------------------------------------------------------------------------- */
const scan = require('./connections/scan.js');
const adminIx = scan.index(admin, true);
const moneyIx = scan.index(money, true);

function liftFrom(ix, name) {
  /* Smallest range wins at the same start, and the outermost match is the top-level
     declaration — the one that actually ships. */
  const hits = ix.fns.filter(f => f.name === name);
  if (!hits.length) return '';
  const f = hits.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);
  return ix.src.slice(f.start, f.end + 1) + '\n';
}
const lift = n => liftFrom(adminIx, n);

/* The rules this panel is built out of, plus the four it borrows rather than
   re-deciding. `audienceNeverAsked` and its helper are the union rule the RSVP audience
   and the New Hang badge already settled on; lifting them is what stops the panel
   growing a third answer to "is this customer new". */
const NEEDED = [
  'bpmMapsOf', 'bpmNewMapId', 'bpmSavedCopies', 'bpmHasMap',
  'bpmOpenRequoteFor', 'bpmRequoteAppliedThisYear', 'bpmRequoteApproved', 'bpmStageOf', 'bpmItems',
  'bpmCopiesFor', 'bpmIsTicked', 'bpmMatchesQuery', 'bpmMatches', 'bpmShown', 'bpmShownMapped', 'bpmCountFor',
  'bpmIsPending', 'bpmPendingItems', 'bpmEmptyHtml', 'bpmApplyDefaultFilter', 'bpmPaintViewChrome',
  'bpmMatchesStage', 'bpmMatchesMapStatus', 'bpmGroupsForView', 'bpmActiveFilterKeys', 'bpmCountBase',
  'bpmAllSelected', 'bpmAllAtOne', 'bpmSavedDiffers', 'bpmCopyModeIsRestore',
  'bpmBuildQueue', 'bpmChunkPages', 'bpmOrientationOf', 'bpmPageGrid',
  'bpmStreetOf', 'bpmTileRight', 'bpmResetBatch', 'bpmPublicIdFromUrl',
  'bpmEl', 'bpmMapImg', 'bpmStepperHtml', 'bpmMenuHtml', 'bpmCardHtml', 'bpmBuildSheets',
  'bpmItemByKey', 'bpmStepBy', 'bpmResetOne',
  // borrowed, lifted rather than stubbed
  'esc', 'cloudThumb', 'quoteMatchAddress', 'quoteWasSentOut', 'quoteStage', 'isRequote',
  'audienceQuoteJoinYear', 'audienceNeverAsked'
];

head('The panel is still assembled the way the script expects');

const srcs = {};
let missing = [];
NEEDED.forEach(n => {
  srcs[n] = lift(n);
  if (!srcs[n]) missing.push(n);
});
check('every rule this gate runs is still in admin.html', missing.length === 0,
  missing.length ? 'renamed or removed: ' + missing.join(', ') : '');

const enrollSrc = liftFrom(moneyIx, 'enrollmentYearOf');
check('enrollmentYearOf is still in js/money.js', !!enrollSrc,
  'audienceQuoteJoinYear cannot decide what "this year" means without it');

/* Constants and module state, lifted as written. A sandbox that declared its own copy of
   BPM_STAGE_KEYS would go on passing after somebody renamed a filter option. */
function lifted(re, what) {
  const m = admin.match(re);
  check(what + ' is still there', !!m, 'the sandbox cannot run without it');
  return m ? m[0] : '';
}
const constSrc = [
  lifted(/const BPM_FILTER_GROUPS = \[[\s\S]*?\n\];/, 'the filter groups table'),
  lifted(/const BPM_STAGE_KEYS = \[[^\]]*\];/, 'the quote-stage keys'),
  lifted(/const BPM_MAP_KEYS = \[[^\]]*\];/, 'the map-status keys'),
  lifted(/const BPM_STAGE_TEXT = \{[^}]*\};/, 'the stage wording'),
  /* ⚠ THE OPENING FILTER IS LIFTED, NEVER RETYPED HERE. It IS the bug this section
     exists for — the panel shipped opening on "Has a map", which hid every house on a
     book with no drawings yet and left no route to the upload dialog at all. A sandbox
     holding its own copy would go on proving the fix against a default the page no
     longer has. */
  lifted(/const bpmFilter = new Set\(\[[^\]]*\]\);/, 'the opening filter'),
  lifted(/const BPM_PENDING_STAGE_KEYS = \[[^\]]*\];/, 'the stages a pending row can be')
].join('\n');

if (fail) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}

/* ---------------------------------------------------------------------------
 * THE SANDBOX.
 * jobAddresses and quotesCache are the two books the panel reads; everything else the
 * lifted code touches is supplied real.
 * ------------------------------------------------------------------------- */
/* ⚠ A FAKE DOCUMENT, BECAUSE THE SHEET IS THE DELIVERABLE. The red-check caught this
   file testing bpmMapImg directly and never asking what bpmBuildSheets HANDS it — so a
   sabotage that made the sheet request the wrong image size passed. Same
   mechanism-without-wiring shape this repo has been caught by before, here in the gate
   rather than in the page. Two elements is all the builder touches. */
function fakeDoc() {
  const mk = () => ({
    innerHTML: '', textContent: '', disabled: false, style: {},
    _attr: {}, setAttribute(k, v) { this._attr[k] = v; }
  });
  const nodes = {bpmSheets: mk(), bpmSheetNote: mk(), bpmGrid: mk()};
  /* The chrome bpmPaintViewChrome puts out of reach while the Pending list is up. Real
     nodes rather than a source check, because the claim is that the print controls
     STOP BEING REACHABLE — a regex cannot see a style that was never applied. */
  ['bpmSheetWrap', 'bpmPrintBar', 'bpmSelectAll', 'bpmCopyMode', 'bpmPrintTop',
   'bpmPerPage', 'bpmFilterBtn', 'bpmPendingBtn'].forEach(id => { nodes[id] = mk(); });
  return {getElementById: id => nodes[id] || null, _nodes: nodes};
}

function sandbox(extra) {
  const body =
    'let jobAddresses = [], quotesCache = [];\n' +
    'let bpmQuery = "", bpmPerPage = 8, bpmPickIdx = -1, bpmOpenKey = null;\n' +
    'let bpmPendingNew = null, bpmLoadFailed = "";\n' +
    'let bpmItemsCache = null, bpmView = "print", bpmAddMode = false, bpmFilterDefaulted = false;\n' +
    'const bpmCopies = Object.create(null);\n' +
    'const bpmUnticked = new Set();\n' +
    'const CLOUDINARY_CLOUD = "highlighting-utah";\n' +
    constSrc + '\n' + enrollSrc + '\n' +
    NEEDED.map(n => srcs[n]).join('\n') + '\n' +
    'function bpmRender(){ /* the real one touches the DOM; the harness drives the parts it needs */ }\n' +
    (extra || '') + '\n' +
    'return {jobAddresses, quotesCache, bpmFilter, bpmCopies, bpmUnticked,' +
    ' setBook(b){ jobAddresses = b; }, setQuotes(q){ quotesCache = q; },' +
    ' setQuery(q){ bpmQuery = q; }, setPerPage(n){ bpmPerPage = n; }, perPage(){ return bpmPerPage; },' +
    ' setView(v){ bpmView = v; }, view(){ return bpmView; },' +
    ' clearSnapshot(){ bpmItemsCache = null; }, snapshotHeld(){ return bpmItemsCache !== null; },' +
    ' forgetDefault(){ bpmFilterDefaulted = false; }, defaultSettled(){ return bpmFilterDefaulted; },' +
    ' ' + NEEDED.filter(n => n !== 'esc').join(', ') + '};\n';
  return new Function('document', 'window', body);
}

/* ⚠ A DEPENDENCY THE SANDBOX WAS NEVER GIVEN IS THE TRAP THIS REPO HAS HIT EIGHT TIMES,
   and it presents as a bare ReferenceError attributed to something else entirely. Built
   once, here, so a missing name fails as itself. */
let S, DOC = fakeDoc();
try {
  S = sandbox()(DOC, undefined);
} catch (err) {
  check('the lifted rules assemble and run', false, String(err && err.message || err));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
check('the lifted rules assemble and run', true);

/* ---------------------------------------------------------------------------
 * FIXTURES.
 * ⚠ SHAPED THE WAY THE REAL WRITERS WRITE THEM. The Hoyt pair share a phone and sit at
 * two different addresses, which is 14 of the 17 shared numbers in the real book — a
 * fixture without that pair passes whether the address half of the match is read or not.
 * ------------------------------------------------------------------------- */
const YEAR = new Date().getFullYear();
const map = (id, label, copies, extra) => Object.assign({
  id, label, url: 'https://res.cloudinary.com/highlighting-utah/image/upload/v1/bp/' + id + '.jpg',
  publicId: 'bp/' + id, copies, orientation: 'landscape', note: ''
}, extra || {});

const BOOK = [
  {id: 'h-sorensen', data: {name: 'The Sorensens', address: '367 W 400 S', city: 'American Fork',
    phone: '8015550001', blueprintMaps: [map('a', 'Front elevation', 3)]}},
  {id: 'h-whitlock', data: {name: 'Dana Whitlock', address: '842 N 1200 E', city: 'Pleasant Grove',
    phone: '8015550002', chargeNewMemberFee: true,
    blueprintMaps: [map('a', 'Front elevation', 2), map('b', 'Detached garage', 1)]}},
  {id: 'h-reyes', data: {name: 'Marcus Reyes', address: '1590 Canyon Rd', city: 'Lindon',
    phone: '8015550003', blueprintMaps: [map('a', 'Front elevation', 1)]}},
  {id: 'h-halliday', data: {name: 'Trent Halliday', address: '3300 N Ridge Loop', city: 'Alpine',
    phone: '8015550004'}},                                   // no map at all
  {id: 'h-hoyt-parent', data: {name: 'Ruth Hoyt', address: '12 Elm St', city: 'Lehi',
    phone: '8015550777', blueprintMaps: [map('a', 'Front elevation', 1)]}},
  {id: 'h-hoyt-child', data: {name: 'Gary Hoyt', address: '480 Oak Ave', city: 'Lehi',
    phone: '8015550777', blueprintMaps: [map('a', 'Front elevation', 1)]}}
];
const QUOTES = [
  /* An OPEN re-quote against Marcus Reyes, named by customer id, and one the customer
     has APPROVED. ⚠ THE ANSWER IS WHAT MAKES IT PENDING — see [[BPM-04]]: an open
     re-quote nobody has said yes to is not work yet, so a fixture whose only re-quote
     is unanswered cannot prove anything about the pending list at all. */
  {id: 'q1', data: {status: 'new', existingCustomerId: 'h-reyes', quotedPrice: 640,
    approvalStatus: 'approved', quoteSentAt: {seconds: 1}, phone: '8015550003', address: '1590 Canyon Rd'}},
  // a CLOSED re-quote against the Sorensens — history, so they are Returning
  {id: 'q2', data: {status: 'closed', existingCustomerId: 'h-sorensen', quotedPrice: 400,
    approvalStatus: 'approved', phone: '8015550001', address: '367 W 400 S'}},
  // an OPEN re-quote for the Hoyt CHILD, matched by phone+address only
  {id: 'q3', data: {status: 'new', requoteCount: 1, quotedPrice: 300, approvalStatus: 'pending',
    quoteSentAt: {seconds: 1}, phone: '8015550777', address: '480 Oak Ave'}}
];
const clone = x => JSON.parse(JSON.stringify(x));

function load(book, quotes) {
  S.setBook(clone(book === undefined ? BOOK : book));
  S.setQuotes(clone(quotes === undefined ? QUOTES : quotes));
  S.setQuery('');
  S.setPerPage(8);
  S.bpmFilter.clear(); S.bpmFilter.add('mapped');
  S.bpmResetBatch();
  S.setView('print');
  S.forgetDefault();
  /* ⚠ THE SNAPSHOT IS PER RENDER, AND THIS WHOLE FILE RUNS IN ONE TICK. In the page
     bpmRender clears it before every paint; here the fixtures change underneath it, so
     without this every check after the first would be answered from the first book. */
  S.clearSnapshot();
}
const keyOf = (house, mapId) => house + '::' + mapId;

/* ---------------------------------------------------------------------------
 * 1. WHICH STAGE A HOUSE IS IN.
 * ------------------------------------------------------------------------- */
head('Which stage a house is in — read off what the record already carries');

load();
const stageOf = id => {
  const row = BOOK.filter(h => h.id === id)[0];
  return S.bpmStageOf(id, row.data);
};

check('an open re-quote naming the customer reads Requote', stageOf('h-reyes') === 'requote',
  'got ' + stageOf('h-reyes'));
check('a CLOSED re-quote is history, so the house is Returning', stageOf('h-sorensen') === 'returning',
  'a finished re-quote leaves the house exactly as it was; got ' + stageOf('h-sorensen'));
check('the $30 fee box still reads New quote', stageOf('h-whitlock') === 'new',
  'got ' + stageOf('h-whitlock'));
check('an ordinary house reads Returning', stageOf('h-halliday') === 'returning',
  'got ' + stageOf('h-halliday'));

/* ⚠ THE ONE THAT COSTS SOMETHING TO GET WRONG. Phone alone would badge the parent
   Requote because the child is being re-quoted, and the office filtering on Requotes
   would be handed a house nobody is re-quoting. */
check('a re-quote for the child does not badge the parent on a shared phone',
  stageOf('h-hoyt-child') === 'requote' && stageOf('h-hoyt-parent') === 'returning',
  'child=' + stageOf('h-hoyt-child') + ' parent=' + stageOf('h-hoyt-parent'));

/* A quote that names a DIFFERENT customer id has already answered the question, and must
   not then fall through to the phone match. */
load(BOOK, [{id: 'q9', data: {status: 'new', existingCustomerId: 'h-somebody-else',
  quotedPrice: 1, approvalStatus: 'pending', quoteSentAt: {seconds: 1},
  phone: '8015550001', address: '367 W 400 S'}}]);
check('a re-quote naming another house does not reach this one by phone',
  S.bpmStageOf('h-sorensen', BOOK[0].data) === 'returning',
  'the explicit link is the answer, in both directions');

/* joined this year through a closed, converted, non-re-quote quote — the union rule */
load(BOOK, [{id: 'q10', data: {status: 'closed', convertedToCustomerAt: new Date(YEAR, 5, 1),
  phone: '8015550001', address: '367 W 400 S'}}]);
check('somebody who joined this year by quote reads New quote, fee box or not',
  S.bpmStageOf('h-sorensen', BOOK[0].data) === 'new',
  'this is the union rule printIsNewHang and the RSVP audience already settled on');

load(BOOK, [{id: 'q11', data: {status: 'closed', convertedToCustomerAt: new Date(YEAR - 2, 5, 1),
  phone: '8015550001', address: '367 W 400 S'}}]);
check('and it expires — a quote from two years ago is not new now',
  S.bpmStageOf('h-sorensen', BOOK[0].data) === 'returning',
  'without the year this grows until it covers the whole book');

/* ⚠ WITH NO QUOTES IT MUST FAIL TOWARDS Returning, never towards a tag nobody chose.
   ⚠ AND THE FIRST VERSION OF THIS CHECK WAS WRONG, not the code: it asserted that EVERY
   house reads Returning, which would have demanded the $30 fee box stop working the
   moment quotesCache was late. The fee box is a stored fact on the record and needs no
   quotes at all; what must go quiet is the quote-DERIVED half. */
load(BOOK, []);
check('with no quotes loaded nothing reads Requote',
  BOOK.every(h => S.bpmStageOf(h.id, h.data) !== 'requote'),
  'a requote can only ever be claimed from a quote');
check('and a house whose only claim was a quote falls back to Returning',
  S.bpmStageOf('h-reyes', BOOK[2].data) === 'returning' &&
  S.bpmStageOf('h-hoyt-child', BOOK[5].data) === 'returning');
check('while the fee box, which is on the record, still reads New quote',
  S.bpmStageOf('h-whitlock', BOOK[1].data) === 'new',
  'a late quotesCache must not un-tick something somebody set by hand');

/* ---------------------------------------------------------------------------
 * 2. THE BATCH IS WHAT IS SHOWING.
 * ------------------------------------------------------------------------- */
head('The batch is whatever is showing, at its saved count');

load();
let items = S.bpmItems();
check('a house with two drawings is two cards', items.filter(i => i.houseId === 'h-whitlock').length === 2);
check('and they are numbered map 1 of 2 and map 2 of 2',
  items.filter(i => i.houseId === 'h-whitlock').every(i => i.of === 2) &&
  items.filter(i => i.houseId === 'h-whitlock').map(i => i.index).join(',') === '1,2');
check('a house with no drawing is still one row, so it can be chased',
  items.filter(i => i.houseId === 'h-halliday').length === 1 &&
  items.filter(i => i.houseId === 'h-halliday')[0].map === null);

check('everything with a map loads already selected',
  S.bpmShownMapped().every(S.bpmIsTicked),
  'nothing has to be added to anything — that is the whole screen');
check('and at its saved count, not at one',
  S.bpmCopiesFor(S.bpmShown().filter(i => i.houseId === 'h-sorensen')[0]) === 3,
  'a three-crew house is saved at 3 and prints 3 without anyone setting it again');
check('a house with no map can never be in the batch',
  !S.bpmIsTicked(items.filter(i => i.houseId === 'h-halliday')[0]),
  'nothing to print, nothing to select');

/* ⚠ RUN, NOT REASONED ABOUT: the queue is what actually reaches the sheet. */
load();
let queue = S.bpmBuildQueue(S.bpmShown());
check('copies expand into the queue consecutively',
  queue.filter(i => i.houseId === 'h-sorensen').length === 3 &&
  queue.map(i => i.houseId).join(',').indexOf('h-sorensen,h-sorensen,h-sorensen') !== -1,
  'three copies of one house are three tiles in a row, not three scattered ones');
check('and a house with no map contributes nothing',
  queue.every(i => i.houseId !== 'h-halliday'));

load();
S.bpmUnticked.add(keyOf('h-whitlock', 'b'));
queue = S.bpmBuildQueue(S.bpmShown());
check('unchecking one map removes exactly that tile',
  queue.filter(i => i.key === keyOf('h-whitlock', 'b')).length === 0 &&
  queue.filter(i => i.key === keyOf('h-whitlock', 'a')).length === 2,
  'selection is per map, so a front elevation can print while the garage does not');

/* ---------------------------------------------------------------------------
 * 3. THE COUNTS.
 * ------------------------------------------------------------------------- */
head('The copy counts');

load();
const sorensenKey = keyOf('h-sorensen', 'a');
S.bpmStepBy(sorensenKey, -1);
check('the stepper changes this session only', S.bpmCopies[sorensenKey] === 2);
check('and the saved count is untouched',
  S.bpmSavedCopies(S.bpmItems().filter(i => i.key === sorensenKey)[0]) === 3,
  'the override is the session; the map is the record');
S.bpmResetOne(sorensenKey);
check('clicking the number puts that one map back to its saved count',
  S.bpmCopiesFor(S.bpmItems().filter(i => i.key === sorensenKey)[0]) === 3);

load();
S.bpmStepBy(sorensenKey, -1); S.bpmStepBy(sorensenKey, -1);
S.bpmStepBy(sorensenKey, -1); S.bpmStepBy(sorensenKey, -1);
check('counts cannot go below zero', S.bpmCopiesFor(S.bpmItems().filter(i => i.key === sorensenKey)[0]) === 0);

load();
S.bpmUnticked.add(sorensenKey);
S.bpmStepBy(sorensenKey, 1);
check('raising a count on an unselected map selects it again',
  S.bpmIsTicked(S.bpmItems().filter(i => i.key === sorensenKey)[0]),
  'changing the number implies wanting it — the second step this screen exists without');

load();
const noMapKey = S.bpmItems().filter(i => i.houseId === 'h-halliday')[0].key;
S.bpmStepBy(noMapKey, 1);
check('and a house with no map cannot be stepped into the batch',
  !Object.prototype.hasOwnProperty.call(S.bpmCopies, noMapKey),
  'there is nothing to print, so the number would be a claim about nothing');

/* A saved count of zero would load already printing nothing, which is indistinguishable
   from one somebody had unchecked and nothing on screen would say which. */
check('a damaged saved count reads as one copy, never as zero',
  S.bpmSavedCopies({map: {copies: 0}}) === 1 &&
  S.bpmSavedCopies({map: {copies: 'three'}}) === 1 &&
  S.bpmSavedCopies({map: {}}) === 1);

/* ---------------------------------------------------------------------------
 * 4. THE FILTER.
 * ------------------------------------------------------------------------- */
head('The filter — OR inside a group, AND across groups');

load();
S.bpmFilter.clear();
check('nothing ticked means everyone', S.bpmShown().length === S.bpmItems().length);

S.bpmFilter.clear(); S.bpmFilter.add('new');
const justNew = S.bpmShown();
S.bpmFilter.add('requote');
const newOrRequote = S.bpmShown();
check('two options in one group widen the results', newOrRequote.length > justNew.length,
  justNew.length + ' -> ' + newOrRequote.length);

S.bpmFilter.clear(); S.bpmFilter.add('new'); S.bpmFilter.add('nomap');
check('options in different groups narrow them', S.bpmShown().length === 0,
  'the only new-quote house has two maps, so new + no-map-yet is nobody');

S.bpmFilter.clear(); S.bpmFilter.add('nomap');
check('"No map yet" finds the house nobody has photographed',
  S.bpmShown().length === 1 && S.bpmShown()[0].houseId === 'h-halliday');

S.bpmFilter.clear(); S.bpmFilter.add('mapped');
S.setQuery('garage');
check('the search reads the map label as well as the name and address',
  S.bpmShown().length === 1 && S.bpmShown()[0].label === 'Detached garage');
S.setQuery('lindon');
check('and the town', S.bpmShown().length === 1 && S.bpmShown()[0].houseId === 'h-reyes');
S.setQuery('');

/* ⚠ COUNTED AGAINST EVERY MAP, NOT THE FILTERED SET — a count that shrank as you ticked
   would answer the wrong question. */
load();
S.bpmFilter.clear(); S.bpmFilter.add('nomap');
check('the option counts are computed against all maps, not what is showing',
  S.bpmCountFor('mapped') === 6 && S.bpmCountFor('nomap') === 1,
  'mapped=' + S.bpmCountFor('mapped') + ' nomap=' + S.bpmCountFor('nomap'));

/* ---------------------------------------------------------------------------
 * 5. THE TWO TOGGLE BUTTONS.
 * ------------------------------------------------------------------------- */
head('The two toggle buttons say what pressing them will do');

load();
check('everything selected, so the button offers Unselect all', S.bpmAllSelected() === true);
S.bpmUnticked.add(sorensenKey);
check('and it flips as soon as ONE is unchecked', S.bpmAllSelected() === false);

load();
check('counts are not all at one, so it offers "1 copy each"', S.bpmCopyModeIsRestore() === false);
S.bpmShownMapped().forEach(it => { S.bpmCopies[it.key] = 1; });
check('flattened to one, it offers "Back to saved counts"', S.bpmCopyModeIsRestore() === true);
S.bpmShownMapped().forEach(it => { delete S.bpmCopies[it.key]; });
check('and pressing that restores 3 for the house saved at 3',
  S.bpmCopiesFor(S.bpmItems().filter(i => i.key === sorensenKey)[0]) === 3);

/* ⚠ IF EVERY MAP SHOWING IS SAVED AT 1 THERE IS NO RESTORE TO OFFER, and a button that
   would change nothing is worse than one that is simply not there. */
load();
S.setQuery('Marcus');
S.bpmShownMapped().forEach(it => { S.bpmCopies[it.key] = 1; });
check('a set of maps all saved at 1 stays on "1 copy each"', S.bpmCopyModeIsRestore() === false,
  'savedDiffers=' + S.bpmSavedDiffers());
S.setQuery('');

load();
S.bpmFilter.clear(); S.bpmFilter.add('nomap');
check('and both are meaningless when nothing showing has a map',
  S.bpmShownMapped().length === 0 && S.bpmAllSelected() === false && S.bpmCopyModeIsRestore() === false,
  'the copy-count button is disabled in this state');

/* ---------------------------------------------------------------------------
 * 6. THE SHEET.
 * ------------------------------------------------------------------------- */
head('The sheet is what comes out of the printer');

const nine = new Array(9).fill(0).map((_, i) => ({key: 'k' + i}));
check('nine maps at 8 per page is two pages', S.bpmChunkPages(nine, 8).length === 2);
check('and the second holds exactly one tile', S.bpmChunkPages(nine, 8)[1].length === 1);
check('eight at 8 per page is one page', S.bpmChunkPages(new Array(8).fill(0).map((_, i) => ({key: i})), 8).length === 1);
check('nothing selected is no pages at all', S.bpmChunkPages([], 8).length === 0);
check('a junk per-page value falls back to eight rather than looping',
  S.bpmChunkPages(nine, 0).length === 2 && S.bpmChunkPages(nine, 'x').length === 2);
/* ⚠ COUNTING THE PAGES IS NOT ENOUGH, and the red-check proved it: chunking one short
   still gives two pages with one tile on the second, and loses a tile off the first
   silently. What must be true is that the pages together ARE the queue. */
check('the pages together hold every tile, in order and none twice',
  [4, 8, 12].every(per => {
    const flat = [].concat.apply([], S.bpmChunkPages(nine, per));
    return flat.length === nine.length && flat.every((t, i) => t === nine[i]);
  }),
  'a tile dropped between pages is a house the crew is never sent to');
check('and no page is fuller than the per-page setting',
  [4, 8, 12].every(per => S.bpmChunkPages(nine, per).every(pg => pg.length <= per)));

/* ⭐ A PAGE OF PORTRAIT PHOTOGRAPHS TURNS THE GRID ON ITS SIDE, decided per page from
   the orientation stored at upload — a route can hold both. */
const port = n => new Array(n).fill(0).map(() => ({map: {orientation: 'portrait'}}));
const land = n => new Array(n).fill(0).map(() => ({map: {orientation: 'landscape'}}));
check('a mostly-landscape page of eight is two across by four down',
  JSON.stringify(S.bpmPageGrid(land(8), 8)) === JSON.stringify({cols: 2, rows: 4}));
check('a mostly-portrait page of eight is four across by two down',
  JSON.stringify(S.bpmPageGrid(port(8), 8)) === JSON.stringify({cols: 4, rows: 2}),
  'portrait photos must not be cropped');
check('an even split is not "most", so it stays landscape',
  JSON.stringify(S.bpmPageGrid(port(4).concat(land(4)), 8)) === JSON.stringify({cols: 2, rows: 4}));
check('and it is decided per page, so one page does not dictate another',
  JSON.stringify(S.bpmPageGrid(port(8), 8)) !== JSON.stringify(S.bpmPageGrid(land(8), 8)));
check('4-up and 12-up keep their own shape', 
  JSON.stringify(S.bpmPageGrid(port(4), 4)) === JSON.stringify({cols: 2, rows: 2}) &&
  JSON.stringify(S.bpmPageGrid(port(12), 12)) === JSON.stringify({cols: 3, rows: 4}),
  'the rule is given for the eight only; inventing the other two would be guessing');
check('a map with no stored orientation reads as landscape',
  S.bpmOrientationOf({map: {}}) === 'landscape' && S.bpmOrientationOf(null) === 'landscape');

/* The caption answers "which of this house's drawings" when there is more than one, and
   "which house" when there is not. */
load();
items = S.bpmItems();
check('the tile caption names the drawing when a house has several',
  S.bpmTileRight(items.filter(i => i.key === keyOf('h-whitlock', 'b'))[0]) === 'Detached garage');
check('and the street when it has one',
  S.bpmTileRight(items.filter(i => i.key === sorensenKey)[0]) === '367 W 400 S');
check('the street is the part before the first comma',
  S.bpmStreetOf('842 N 1200 E, Pleasant Grove, UT') === '842 N 1200 E' && S.bpmStreetOf('') === '');

/* ---------------------------------------------------------------------------
 * 7. A FINISHED BATCH RESETS ITSELF.
 * ------------------------------------------------------------------------- */
head('After printing, the batch resets and the filter does not');

load();
S.setQuery('Sorensen');
S.bpmFilter.clear(); S.bpmFilter.add('returning');
S.bpmCopies[sorensenKey] = 9;
S.bpmUnticked.add(keyOf('h-whitlock', 'a'));
S.bpmResetBatch();
check('every copy override goes back to the saved count',
  Object.keys(S.bpmCopies).length === 0 &&
  S.bpmCopiesFor(S.bpmItems().filter(i => i.key === sorensenKey)[0]) === 3);
check('and every unselected map is selected again', S.bpmUnticked.size === 0);
check('the filter is deliberately left alone',
  S.bpmFilter.has('returning') && S.bpmFilter.size === 1,
  'the same route is printed twice more often than it is re-filtered');
check('and so is the search box', S.bpmShown().every(i => i.name === 'The Sorensens'),
  'the query survives the reset');
S.setQuery('');

/* ---------------------------------------------------------------------------
 * 8. WHAT REACHES THE SCREEN.
 * A card is a row somebody looks at, so it is RENDERED and read back rather than
 * matched in the source.
 * ------------------------------------------------------------------------- */
head('What actually reaches the screen');

load();
items = S.bpmItems();
const cardOf = key => S.bpmCardHtml(items.filter(i => i.key === key)[0]);

let card = cardOf(sorensenKey);
check('a mapped card carries the corner checkmark, ticked', /data-bpmtick=/.test(card) && /aria-checked="true"/.test(card));
check('and the stage tag', /class="bpm-tag[^"]*">Returning</.test(card));
check('and the saved count in the stepper', /class="bpm-val"[^>]*>3</.test(card));
check('and the title names the number the reset will return to', /Back to the saved count \(3\)/.test(card));

const noMapCard = cardOf(items.filter(i => i.houseId === 'h-halliday')[0].key);
check('a house with no map gets NO checkmark at all', !/data-bpmtick=/.test(noMapCard),
  'a control that can never do anything reads as broken');
check('and no stepper either', !/bpm-stepper/.test(noMapCard));
check('and says so where the count would be', /No map on file yet/.test(noMapCard));

load();
S.bpmUnticked.add(sorensenKey);
card = cardOf(sorensenKey);
check('an unselected card dims and says "Not printing"',
  /class="bpm-card[^"]* off"/.test(card) && /Not printing/.test(card) && /aria-checked="false"/.test(card));

load();
card = cardOf(keyOf('h-whitlock', 'b'));
check('a second drawing is labelled "map 2 of 2"', /Detached garage &middot; map 2 of 2/.test(card));
check('and a New quote house is tagged as one', /class="bpm-tag new">New quote</.test(card));

/* ⚠ HOSTILE INPUT. A customer really is called O'Brien, and a name is written straight
   into the card and into the printed caption. */
load([{id: 'h-x', data: {name: "Mary O'Brien & <Sons>", address: '1 "A" St', city: 'Lehi',
  phone: '8015559999', blueprintMaps: [map('a', '<script>x</script>', 1)]}}], []);
card = S.bpmCardHtml(S.bpmItems()[0]);
check('a name with a quote or a tag in it is escaped, not executed',
  card.indexOf('<script>') === -1 && card.indexOf("O'Brien") === -1 && /&#39;/.test(card),
  'this text is written straight into innerHTML');

/* The delivery URL. Tiles print at roughly 3.7 x 2.4 inches. */
/* ⚠ RUN THROUGH THE REAL SHEET BUILDER, not by calling bpmMapImg with the size this
   file would like it to use — that is the check the red-check caught being vacuous. */
load();
S.bpmBuildSheets(S.bpmShown());
const sheetHtml = DOC._nodes.bpmSheets.innerHTML;
const sheetNote = DOC._nodes.bpmSheetNote.textContent;
check('the sheet builder puts something on the page at all', sheetHtml.length > 0);
check('the printed tile asks Cloudinary for a sheet-sized image, not the original',
  /w_1200,c_limit/.test(sheetHtml) && sheetHtml.indexOf('w_400') === -1,
  'tiles print at roughly 3.7 by 2.4 inches');
check('the card asks for a card-sized one instead',
  /w_400,c_limit/.test(S.bpmMapImg(S.bpmItems().filter(i => i.key === sorensenKey)[0], 400)));
check('the original is left in Cloudinary untouched',
  BOOK[0].data.blueprintMaps[0].url.indexOf('w_') === -1);
check('every tile carries a caption with the customer on it',
  (sheetHtml.match(/class="bpm-strip"/g) || []).length === S.bpmBuildQueue(S.bpmShown()).length,
  'one caption per tile, however many copies');
check('and the page is labelled so a stack can be checked',
  /Page 1 of /.test(sheetHtml));
check('the note above it says what will come out of the printer',
  /comes out of the printer/.test(sheetNote) && /^\d+ maps across \d+ page/.test(sheetNote),
  sheetNote);
/* Nothing selected has to SAY so — an empty area reads as the screen being broken. */
load();
S.bpmShown().forEach(it => S.bpmUnticked.add(it.key));
S.bpmBuildSheets(S.bpmShown());
check('with nothing selected the sheet says so and names the way out',
  /Nothing selected to print/.test(DOC._nodes.bpmSheets.innerHTML) &&
  /raise a count above zero/.test(DOC._nodes.bpmSheets.innerHTML),
  'an empty panel with no words in it reads as a fault');

/* The filter menu is rebuilt on every tick, so its own markup is what carries state. */
load();
const menu = S.bpmMenuHtml();
check('the menu marks a ticked option with aria-checked', /data-bpmf="mapped" aria-checked="true"/.test(menu));
check('and an unticked one', /data-bpmf="nomap" aria-checked="false"/.test(menu));
check('every option carries its live count', (menu.match(/class="bpm-n"/g) || []).length === 5);
check('and there is a way back to everyone', /id="bpmClearFilters"/.test(menu));

/* ---------------------------------------------------------------------------
 * 9. THE PUBLIC ID.
 * ------------------------------------------------------------------------- */
head('The Cloudinary public id, read back out of the URL');

check('a versioned upload URL gives its public id',
  S.bpmPublicIdFromUrl('https://res.cloudinary.com/highlighting-utah/image/upload/v1726000000/abc123.jpg') === 'abc123');
check('a foldered one keeps its folder',
  S.bpmPublicIdFromUrl('https://res.cloudinary.com/highlighting-utah/image/upload/v1/bp/abc.png') === 'bp/abc');
check('anything that is not one of our upload URLs gives nothing, never a guess',
  S.bpmPublicIdFromUrl('https://example.com/a.jpg') === '' && S.bpmPublicIdFromUrl('') === '' &&
  S.bpmPublicIdFromUrl(null) === '');

check('a fresh map id is unique', (function () {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(S.bpmNewMapId());
  return seen.size === 500;
})(), 'the id is the print key and the update target');

/* ---------------------------------------------------------------------------
 * 10. THE WIRING — asserted separately, because the harness above calls the
 * renderer itself and would stay green with nothing reaching the page.
 * ------------------------------------------------------------------------- */
head('The wiring — the half the harness above cannot see');

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const adminCode = strip(admin);

check('the panel exists in the markup', admin.indexOf('id="panel-blueprintmaps"') !== -1);
check('and has a nav item to open it', admin.indexOf('data-panel="blueprintmaps"') !== -1,
  'a panel with no nav item can never be reached');
/* ⚠ MEASURED, NOT ASSUMED. The first version of this check compared the dialog against
   the last `</div>` before the toast — which lands INSIDE the dialog's own footer, so it
   failed on markup that is right. It walks the div nesting from `<div id="app">` to the
   `</div>` that closes it, and asks whether the dialog is past that point. Every panel is
   inside #app, so outside #app is outside every panel. */
const appAt = admin.indexOf('<div id="app">');
let appDepth = 0, appEnd = -1, divRe = /<div\b|<\/div>/g;
divRe.lastIndex = appAt;
for (let d; (d = divRe.exec(admin));) {
  appDepth += d[0] === '</div>' ? -1 : 1;
  if (appDepth === 0) { appEnd = d.index; break; }
}
const dlgAt = admin.indexOf('<dialog id="bpmDialog"');
check('the app shell closes where it says it does', appAt !== -1 && appEnd > appAt,
  'the check below means nothing without it');
check('the dialog sits OUTSIDE every panel', dlgAt !== -1 && dlgAt > appEnd,
  'showModal() on a dialog with a display:none ancestor opens nothing at all, silently — ' +
  'and .panel is display:none until its nav item is clicked');

check('a customer change redraws the grid',
  /safeRender\('blueprintMaps',\s*typeof bpmRender === 'function'/.test(adminCode),
  'without this call every behavioural check above stays green and nothing reaches the screen');
check('and the render is deferred until its panel is open',
  /blueprintMaps:\s*'blueprintmaps'/.test(adminCode),
  'one card per map with a photograph in each, drawn for a tab nobody opened');

check('printing is scoped to a body class, so the other two print paths are untouched',
  adminCode.indexOf("classList.add('bpm-printing')") !== -1 &&
  admin.indexOf('body.bpm-printing') !== -1,
  'Routes and Customer Numbers both print from this page and have @media print rules of their own');
check('and the class comes off again when the dialog closes',
  adminCode.indexOf("classList.remove('bpm-printing')") !== -1);
check('afterprint resets the batch', /addEventListener\('afterprint'[\s\S]{0,400}bpmResetBatch\(\)/.test(adminCode));
/* ⚠ SCOPED TO bpmDoPrint'S OWN BODY. The first version searched the whole file for
   `if(!queue.length){` — which bpmBuildSheets also contains, a few hundred lines up — so
   the red-check's sabotage of the real guard was answered by the other one and passed.
   The anchor-matched-twice trap, in this gate's own checks. */
const printSrc = strip(lift('bpmDoPrint'));
check('the print path is findable', printSrc.length > 0);
check('and pressing Print with nothing selected does not open the print dialog',
  /if\(!queue\.length\)\{[\s\S]*?return;/.test(printSrc) &&
  printSrc.indexOf('window.print()') > printSrc.indexOf('return;'),
  'a print dialog over an empty sheet reads as the screen having agreed to something');

/* ⚠ Firestore refuses a sentinel inside an array outright, so serverTimestamp() here
   would not lose the date — it would reject the whole write and lose the upload. */
const uploadSrc = lift('bpmUploadInto');
check('the upload stamps a client Timestamp, never serverTimestamp()',
  uploadSrc.indexOf('Timestamp.now()') !== -1 && uploadSrc.indexOf('serverTimestamp(') === -1,
  'a sentinel inside an array is refused, and the drawing is lost with it');
check('and it goes through the one shared uploader',
  uploadSrc.indexOf('uploadOneToCloudinary(') !== -1,
  'a second upload path is a second thing to keep in step');
check('and reports a failure with the shared advice',
  uploadSrc.indexOf('uploadFailText(') !== -1,
  'a switched-off picture account must read the same here as it does on a quote');
check('a failed upload never reverts silently',
  /bpmSaid\('The drawing was NOT saved\./.test(uploadSrc),
  'the dialog stays open and says what to do');

const saveSrc = lift('bpmSaveMaps');
check('a save mirrors into the local cache before it is awaited',
  saveSrc.indexOf('bpmRender()') !== -1 &&
  saveSrc.indexOf('bpmRender()') < saveSrc.indexOf('await updateDoc'),
  'this panel repaints from jobAddresses, so without the mirror an upload visibly springs back');
check('and writes the whole array, because Firestore cannot update one element',
  /updateDoc\(doc\(db, 'jobAddresses', houseId\), \{blueprintMaps: maps\}\)/.test(saveSrc));

/* ⭐ NOTHING NEW IS STORED FOR THE STAGE TAG. A fourth definition of "new customer" in
   this page is the thing this check exists to prevent — there have already been two. */
const stageSrc = lift('bpmStageOf') + lift('bpmOpenRequoteFor');
check('the stage tag borrows the rules rather than re-deciding them',
  stageSrc.indexOf('audienceNeverAsked(') !== -1 && stageSrc.indexOf('isRequote(') !== -1 &&
  stageSrc.indexOf('quoteStage(') !== -1,
  'and it must never grow a chargeNewMemberFee test of its own');
check('and it never joins a quote to a house on the phone alone',
  strip(stageSrc).indexOf('quoteMatchAddress') !== -1,
  '17 numbers in the real book are shared, 14 of them a parent and a child at two houses');

/* ---------------------------------------------------------------------------
 * FOUR THINGS A BROWSER FOUND AND NO NODE GATE COULD.
 * Every one of these passed every source check while being wrong on screen. They are
 * pinned here because a fix with no check is a fix that comes back.
 * ------------------------------------------------------------------------- */
check('"Clear filters" closes the menu, and ticking an option does not',
  /bpmClearFilters'\)\)\{[\s\S]{0,260}fMenu\.hidden = true/.test(strip(admin)),
  'a menu left open over the grid it has just changed covers the one thing you pressed it to see');

/* ⚠ PICKING A NAME LEAVES THE BOX FOCUSED, so clicking it again fires no focus event and
   the list never comes back — the control silently stops working after its first use. */
check('the customer list opens on a click as well as on focus',
  /search\.addEventListener\('focus', openList\)/.test(adminCode) &&
  /search\.addEventListener\('click', openList\)/.test(adminCode),
  'focus alone means the name picker works once and then appears broken');

/* ⚠ A LAST PAGE OF TWO TILES ON AN AUTO GRID STRETCHES THEM TO FILL THE SHEET, so the same
   drawing prints postcard sized on page one and half a page on page two. */
check('every page is laid out as the FULL grid, so a short one keeps full-size tiles',
  /grid-template-rows:repeat\(' \+ grid\.rows/.test(adminCode) &&
  adminCode.indexOf('grid-auto-rows') === -1,
  'a crew comparing two sheets has no way to know they are the same scale');

/* The preview's own line says "this is exactly what comes out of the printer". */
check('the on-screen sheet is the shape of a letter page',
  /\.bpm-sheet\{[\s\S]{0,300}aspect-ratio:8\.5 \/ 11/.test(admin) &&
  /body\.bpm-printing \.bpm-sheet\{[\s\S]{0,200}aspect-ratio:auto/.test(admin),
  'a preview with page-tall tiles and postcard-sized print is the screen making a claim it does not keep');

/* ⚠ THE BAR BLEEDS TO THE EDGE BY PULLING AGAINST .main's PADDING, so the two numbers have
   to match — -20px against 18px is two pixels of horizontal scroll on a phone. */
const mainPad = (admin.match(/@media \(max-width:900px\)\{[\s\S]{0,400}?\.main\{ padding:70px (\d+)px/) || [])[1];
const barPull = (admin.match(/\.bpm-printbar\{ margin-left:-(\d+)px/) || [])[1];
check('the sticky bar pulls against exactly the padding the page has at that width',
  !!mainPad && mainPad === barPull,
  'main padding ' + mainPad + 'px vs bar pull ' + barPull + 'px');

/* ---------------------------------------------------------------------------
 * THE SCREEN CAN ADD THE FIRST MAP.
 * ⛔ THE PANEL SHIPPED AS A DEAD END ON DAY ONE. Every route to the upload dialog runs
 * through a card in the grid, and the grid opened filtered to "Has a map" — so with
 * nothing photographed yet it drew "No maps match" and there was no way in at all. The
 * filter is right once there are maps and a wall before that, so it is DERIVED.
 * ------------------------------------------------------------------------- */
head('The screen can add the first map');

const NO_MAPS = BOOK.map(h => {
  const c = clone(h);
  delete c.data.blueprintMaps;
  return c;
});

load(NO_MAPS);
check('the panel still OPENS on "Has a map"', S.bpmFilter.has('mapped'),
  'that is the right default once the book holds drawings — the fix is that it is ' +
  'reconsidered, not that it is gone');
check('and with nothing on file that would show nothing at all',
  S.bpmItems().filter(S.bpmMatches).length === 0,
  'this is the dead end, asserted so the fix below is measured against it');

S.bpmApplyDefaultFilter();
check('so on a book with no drawings the filter stands itself down', !S.bpmFilter.has('mapped'));
check('and there is now a card to tap for every house', S.bpmShown().length === NO_MAPS.length,
  'saw ' + S.bpmShown().length + ' of ' + NO_MAPS.length);

load();
S.bpmApplyDefaultFilter();
check('on a book that HAS drawings the filter is left ticked', S.bpmFilter.has('mapped'),
  'standing it down there would bury the print list under every unmapped house');

/* ⚠ ONCE, AND ONLY AFTER THE BOOK HAS LANDED. Run on every paint it would fight anybody
   who ticked the box by hand; run before the customers arrive it would read an empty
   list as "no maps anywhere" and clear the filter for a season that has hundreds. */
load(NO_MAPS);
S.bpmApplyDefaultFilter();
S.bpmFilter.add('mapped');
S.bpmApplyDefaultFilter();
check('it decides once and then leaves the box alone', S.bpmFilter.has('mapped'),
  'a rule that re-ran would untick it again under somebody who had just ticked it');

load([]);
S.bpmApplyDefaultFilter();
check('and it does not decide at all while the book is still empty', !S.defaultSettled(),
  'an unloaded list is not an answer about how many maps exist');
check('so the opening filter survives a book that has not arrived yet', S.bpmFilter.has('mapped'));

/* The empty grid has to carry the way out, not merely describe itself. */
load(NO_MAPS);
const emptyNoMaps = S.bpmEmptyHtml();
check('an empty grid offers a way to add a map', emptyNoMaps.indexOf('data-bpmaddmap') !== -1);
check('and a way to clear the filter', emptyNoMaps.indexOf('data-bpmshowall') !== -1);
check('and with nothing on file anywhere it says so in those words',
  /No blueprint maps on file yet/.test(emptyNoMaps), emptyNoMaps.slice(0, 120));

load();
S.setQuery('nobody by this name');
const emptyFiltered = S.bpmEmptyHtml();
check('with drawings on file it names the filter that is hiding houses',
  /Has a map<\/b> is ticked/.test(emptyFiltered), emptyFiltered.slice(0, 160));
S.bpmFilter.clear();
const emptyNoFilter = S.bpmEmptyHtml();
check('and drops that sentence once the filter is off',
  emptyNoFilter.indexOf('is ticked') === -1, emptyNoFilter.slice(0, 160));

/* ---------------------------------------------------------------------------
 * PENDING MAPS — WHAT IS STILL OWED.
 * ⭐ Addie: "make a place were it sends pending maps which will only show for new
 * costumers that were quoted this year or requoted."
 * ------------------------------------------------------------------------- */
head('Pending maps — what is still owed');

load(NO_MAPS);
const pend = S.bpmPendingItems();
const pendStages = new Set(pend.map(p => p.stage));
check('a pending row is a NEW QUOTE or a REQUOTE and nothing else',
  pend.length > 0 && [...pendStages].every(s => s === 'new' || s === 'requote'),
  pend.length + ' pending, stages: ' + [...pendStages].join(', '));
check('and the list is not vacuous — the fixture really holds both kinds',
  pendStages.has('new') && pendStages.has('requote'), [...pendStages].join(', '));

/* ⚠ THE EXCLUSION IS THE FEATURE. Nearly the whole book has no drawing; listing every
   one would bury the dozen houses somebody has to go and draw. */
const returningNoMap = S.bpmItems().filter(i => i.stage === 'returning' && !S.bpmHasMap(i));
check('the fixture holds returning customers with no drawing', returningNoMap.length > 0,
  'without one, the exclusion below is proved by nothing');
check('and NONE of them is pending', returningNoMap.every(i => !S.bpmIsPending(i)));

load();
const mappedNew = S.bpmItems().filter(i => S.bpmHasMap(i) && (i.stage === 'new' || i.stage === 'requote'));
check('the fixture holds a new or re-quoted house that DOES have a drawing',
  mappedNew.length > 0, 'the has-a-map half of the rule needs one to bite');
check('and having one takes it off the pending list',
  mappedNew.every(i => !S.bpmIsPending(i)));

/* ---------------------------------------------------------------------------
 * ⭐ A RE-QUOTE COUNTS ONCE THEY HAVE SAID YES ([[BPM-04]], 2026-09-17).
 * Addie, shown two houses on this list: "I see Rachel Oslund is on there and Ashley
 * Wray but they are quotes and requotes", then the rule: "Once they approve requote
 * then we should have that come up to put in there map."
 * ------------------------------------------------------------------------- */
const RQ_BOOK = [
  {id: 'h-oslund', data: {name: 'Rachel Oslund', address: '77 S Maple Dr', city: 'Lehi',
    phone: '8015550111'}},
  {id: 'h-wray', data: {name: 'Ashley Wray', address: '210 E Center St', city: 'Lehi',
    phone: '8015550222'}}
];
const openRq = (id, phone, addr, answer) => ({id: 'rq-' + id, data: {
  status: 'new', existingCustomerId: id, quotedPrice: 500, approvalStatus: answer,
  quoteSentAt: {seconds: 1}, phone: phone, address: addr}});

load(RQ_BOOK, [openRq('h-oslund', '8015550111', '77 S Maple Dr', 'pending'),
               openRq('h-wray', '8015550222', '210 E Center St', 'approved')]);
const rqPend = S.bpmPendingItems().map(i => i.houseId);
/* ⚠ BOTH HOUSES MUST READ Requote, or this pair proves nothing: if the badge differed
   the exclusion below could be the STAGE doing the work rather than the answer. */
check('both houses read Requote, so it is not the badge deciding',
  S.bpmStageOf('h-oslund', RQ_BOOK[0].data) === 'requote' &&
  S.bpmStageOf('h-wray', RQ_BOOK[1].data) === 'requote',
  S.bpmStageOf('h-oslund', RQ_BOOK[0].data) + ' / ' + S.bpmStageOf('h-wray', RQ_BOOK[1].data));
check('an open re-quote nobody has answered is NOT pending',
  rqPend.indexOf('h-oslund') === -1, 'pending: ' + rqPend.join(', '));
check('and one they have approved is', rqPend.indexOf('h-wray') !== -1,
  'pending: ' + rqPend.join(', '));

/* ⛔ AND THE APPROVAL HAS TO OUTLIVE THE QUOTE. Applying a re-quote CLOSES it, so
   bpmOpenRequoteFor stops finding it within the day — the house would read Returning
   and drop off this list at exactly the moment the drawing is owed. [[BPM-01]]'s own
   failure, which is why requoteAppliedAt on the CUSTOMER is the half that is read. */
const APPLIED_BOOK = [{id: 'h-wray', data: {name: 'Ashley Wray', address: '210 E Center St',
  city: 'Lehi', phone: '8015550222', requoteAppliedAt: new Date(YEAR, 5, 1)}}];
const CLOSED_RQ = [{id: 'rq-done', data: {status: 'closed', existingCustomerId: 'h-wray',
  quotedPrice: 500, approvalStatus: 'approved', phone: '8015550222', address: '210 E Center St'}}];
load(APPLIED_BOOK, CLOSED_RQ);
check('the quote really has closed, so there is nothing open left to find',
  S.bpmOpenRequoteFor('h-wray', APPLIED_BOOK[0].data) === null,
  'without this the two checks below could be passing on the still-open half');
check('an APPLIED re-quote still reads Requote',
  S.bpmStageOf('h-wray', APPLIED_BOOK[0].data) === 'requote',
  'got ' + S.bpmStageOf('h-wray', APPLIED_BOOK[0].data));
check('and is still pending — which is the whole point of reading the stamp',
  S.bpmPendingItems().map(i => i.houseId).indexOf('h-wray') !== -1);

/* ⚠ AND IT EXPIRES. requoteAppliedAt is a STAMP and nothing anywhere clears it, Start
   New Season included, so without the year the list grows for ever. */
const OLD_APPLIED = [{id: 'h-wray', data: Object.assign({}, APPLIED_BOOK[0].data,
  {requoteAppliedAt: new Date(YEAR - 2, 5, 1)})}];
load(OLD_APPLIED, CLOSED_RQ);
check('a re-quote applied two years ago is not outstanding work now',
  S.bpmStageOf('h-wray', OLD_APPLIED[0].data) === 'returning' &&
  S.bpmPendingItems().length === 0,
  'stage ' + S.bpmStageOf('h-wray', OLD_APPLIED[0].data) + ', ' + S.bpmPendingItems().length + ' pending');

/* ⚠ IT FAILS TOWARDS NOT PENDING. A closed re-quote with no stamp — declined, or
   applied before the stamp existed — leaves the house exactly as it was. */
const NO_STAMP = [{id: 'h-wray', data: {name: 'Ashley Wray', address: '210 E Center St',
  city: 'Lehi', phone: '8015550222'}}];
load(NO_STAMP, CLOSED_RQ);
check('a closed re-quote carrying no applied stamp leaves the house alone',
  S.bpmPendingItems().length === 0,
  'an extra house here is what empties this list of its meaning');

/* ⚠ A NEW QUOTE NEEDS NO SUCH TEST, and asserting that is what stops the approval
   rule being quietly widened onto it. audienceNeverAsked is ALREADY a closed,
   converted quote — that house has joined, and the drawing is plainly owed. */
const NEW_ONLY = [{id: 'h-nandi', data: {name: 'Priya Nandi', address: '9 Larch Way',
  city: 'Lehi', phone: '8015550333', chargeNewMemberFee: true}}];
load(NEW_ONLY, []);
check('a new quote is pending with no approval anywhere in sight',
  S.bpmPendingItems().length === 1 && S.bpmPendingItems()[0].stage === 'new',
  S.bpmPendingItems().length + ' pending');

/* The view is what she asked for by name: a place the pending ones are sent. */
load(NO_MAPS);
S.setView('pending');
check('the Pending view shows exactly the pending list',
  S.bpmShown().length === S.bpmPendingItems().length &&
  S.bpmShown().every(S.bpmIsPending),
  S.bpmShown().length + ' vs ' + S.bpmPendingItems().length);

/* ⭐ Addie: "filter pending maps for new quote or requotes." The quote-stage half of the
   dropdown DOES narrow this list. */
S.bpmFilter.clear(); S.bpmFilter.add('new');
const pendNew = S.bpmShown();
check('ticking New quotes narrows the pending list to new quotes',
  pendNew.length > 0 && pendNew.every(i => i.stage === 'new'),
  pendNew.length + ' rows, stages: ' + [...new Set(pendNew.map(i => i.stage))].join(', '));
check('and it really narrowed — it is not simply the whole list',
  pendNew.length < S.bpmPendingItems().length,
  pendNew.length + ' of ' + S.bpmPendingItems().length);

S.bpmFilter.clear(); S.bpmFilter.add('requote');
const pendReq = S.bpmShown();
check('ticking Requotes narrows it to re-quotes',
  pendReq.length > 0 && pendReq.every(i => i.stage === 'requote'), pendReq.length + ' rows');

S.bpmFilter.clear(); S.bpmFilter.add('new'); S.bpmFilter.add('requote');
check('and both together are the whole pending list',
  S.bpmShown().length === S.bpmPendingItems().length,
  'two ticks inside one group widen, they do not cancel');

/* ⚠ THE MAP-STATUS HALF IS THE ONE THAT CANNOT CROSS OVER. Every pending row has no
   drawing by definition, so "Has a map" would empty the list outright — and an empty
   pending list reads as no work outstanding. It is not shown at all rather than shown
   and ignored. */
S.bpmFilter.clear(); S.bpmFilter.add('mapped');
check('a stale Has-a-map tick cannot empty the pending list',
  S.bpmShown().length === S.bpmPendingItems().length, 'saw ' + S.bpmShown().length);
check('and that group is not offered while the pending list is up',
  S.bpmGroupsForView().every(g => g.group !== 'Map status') &&
  S.bpmMenuHtml().indexOf('Has a map') === -1,
  'a tick that silently does nothing is the quiet failure this repo argues against');
check('nor does the button claim it as a live filter', S.bpmActiveFilterKeys().length === 0,
  'summarising a filter that is not being applied is the button lying');
/* ⚠ AND "Returning customers" IS NOT OFFERED EITHER — by construction it could only
   ever read 0 and could only ever empty the list. */
check('Returning customers is not offered on a list it could only empty',
  S.bpmMenuHtml().indexOf('Returning customers') === -1, S.bpmMenuHtml().replace(/\s+/g, ' ').slice(0, 160));
S.bpmFilter.clear(); S.bpmFilter.add('returning');
check('and a stale Returning tick cannot empty the pending list',
  S.bpmShown().length === S.bpmPendingItems().length, 'saw ' + S.bpmShown().length);
/* Back to the Has-a-map tick, which is what the next check is about. */
S.bpmFilter.clear(); S.bpmFilter.add('mapped');
S.setView('print');
check('but the tick itself survives for when the print list comes back',
  S.bpmFilter.has('mapped') && S.bpmActiveFilterKeys().indexOf('mapped') !== -1);
check('and the group is offered again there',
  S.bpmGroupsForView().some(g => g.group === 'Map status'));
S.setView('pending');
S.bpmFilter.clear();

/* The tallies beside each option answer the list you are looking at.
   ⚠ AND THE FIXTURE HAS TO BE THE BOOK THAT HOLDS DRAWINGS. On a book with none, every
   New quote is pending and the two counts are equal whatever the code does — the first
   draft of this check was vacuous for exactly that reason. */
load();
S.setView('pending');
check('the counts beside the options are counted over the pending list',
  S.bpmCountFor('new') === S.bpmPendingItems().filter(i => i.stage === 'new').length &&
  S.bpmCountFor('new') < S.bpmItems().filter(i => i.stage === 'new').length,
  'a count of every New quote in the book beside a list of six answers a question ' +
  'nobody asked');
S.setView('print');
check('and over the whole book while printing',
  S.bpmCountFor('new') === S.bpmItems().filter(i => i.stage === 'new').length);
S.setView('pending');

/* The search box DOES narrow it — that is the one control that still means something.
   ⚠ BACK ON THE BOOK WITH NO DRAWINGS, which is the one that has several pending rows;
   narrowing a list of one proves nothing about narrowing. */
load(NO_MAPS);
S.setView('pending');
S.bpmFilter.clear();
const firstPending = S.bpmPendingItems()[0];
check('the fixture has more than one pending row to narrow', S.bpmPendingItems().length > 1,
  'saw ' + S.bpmPendingItems().length);
S.setQuery(firstPending.name);
check('but the search box still narrows it',
  S.bpmShown().length > 0 && S.bpmShown().length < S.bpmPendingItems().length &&
  S.bpmShown().every(i => i.name === firstPending.name),
  'searched "' + firstPending.name + '", saw ' + S.bpmShown().length);

/* ⚠ RUN, NOT MATCHED: the claim is that the print controls stop being reachable. */
load(NO_MAPS);
S.setView('pending');
S.bpmPaintViewChrome();
check('the Pending view puts the printing controls out of reach',
  DOC._nodes.bpmPrintBar.style.display === 'none' &&
  DOC._nodes.bpmSheetWrap.style.display === 'none' &&
  DOC._nodes.bpmPrintTop.disabled === true &&
  DOC._nodes.bpmSelectAll.disabled === true,
  'a print bar reading "0 maps" over a list of houses with no drawings reads as a ' +
  'broken screen rather than an empty batch');
check('and the button says how to get back', DOC._nodes.bpmPendingBtn.textContent === 'Back to printing',
  DOC._nodes.bpmPendingBtn.textContent);
/* ⚠ THE DROPDOWN IS THE ONE CONTROL THAT STAYS, because filtering the pending list by
   quote stage is what it was asked for. */
check('and the quote-stage dropdown stays usable', DOC._nodes.bpmFilterBtn.disabled === false,
  'disabling it would take away the filter this list exists to be narrowed by');

S.setView('print');
S.bpmPaintViewChrome();
check('and going back gives every one of them back',
  DOC._nodes.bpmPrintBar.style.display === '' &&
  DOC._nodes.bpmSheetWrap.style.display === '' &&
  DOC._nodes.bpmPrintTop.disabled === false);
check('and the button carries the count while printing',
  DOC._nodes.bpmPendingBtn.textContent === 'Pending maps · ' + S.bpmPendingItems().length,
  DOC._nodes.bpmPendingBtn.textContent);

/* ---------------------------------------------------------------------------
 * ONE SNAPSHOT PER RENDER.
 * bpmItems() is asked for ~10 times in a single paint and each pass walks quotesCache
 * for every house. On the real book that is millions of comparisons per keystroke.
 * ------------------------------------------------------------------------- */
head('One snapshot per render');

load();
check('bpmItems hands back one snapshot within a tick', S.bpmItems() === S.bpmItems(),
  'ten rebuilds a paint is the shape that has locked this page up before');
check('and it says it is holding one', S.snapshotHeld());

const itemsSrc = srcs['bpmItems'];
check('the snapshot is dropped again on the next microtask',
  /Promise\.resolve\(\)\.then\(function\(\)\{ bpmItemsCache = null; \}\)/.test(itemsSrc),
  'nothing outside a render may ever read a stale list');

/* ⚠ AND THE RENDER MUST DROP IT BEFORE IT READS ANYTHING. bpmSaveMaps mirrors the new
   array into the cache and calls bpmRender in the SAME synchronous task, so a render
   that reused the snapshot would paint the drawing that was just saved as still absent. */
const renderSrc = lift('bpmRender');
check('bpmRender is still in admin.html', !!renderSrc);
const clearAt = renderSrc.indexOf('bpmItemsCache = null');
const firstRead = Math.min(
  ...['bpmApplyDefaultFilter(', 'bpmShown(', 'bpmMenuHtml(', 'bpmPaintViewChrome(']
    .map(s => { const i = renderSrc.indexOf(s); return i === -1 ? Infinity : i; })
);
check('and it drops the snapshot BEFORE it reads anything',
  clearAt !== -1 && firstRead !== Infinity && clearAt < firstRead,
  'clear at ' + clearAt + ', first read at ' + firstRead);

/* ---------------------------------------------------------------------------
 * THE WIRING, ASSERTED APART FROM THE MECHANISM.
 * Every rule above can be perfect and reach no screen at all — this repo has shipped
 * exactly that, twice.
 * ------------------------------------------------------------------------- */
head('The new controls are wired to the page');

check('the header carries an Add a map button', admin.indexOf('id="bpmAddBtn"') !== -1);
check('and it is the same data hook the empty grid uses',
  /id="bpmAddBtn"[^>]*data-bpmaddmap/.test(admin),
  'two ways to start an upload is two sets of rules about what a blank map is called');
check('the header carries a Pending maps button', admin.indexOf('id="bpmPendingBtn"') !== -1);

const sliceBetween = (from, to) => {
  const a = adminCode.indexOf(from);
  const b = adminCode.indexOf(to, a + 1);
  return (a === -1 || b === -1) ? '' : adminCode.slice(a, b);
};
const panelWire = sliceBetween("bpmEl('panel-blueprintmaps')", 'const pendingBtn');
check('the panel click handler was found', panelWire.length > 0);
/* ⚠ THE GUARD MUST BE THE closest() CALL AND NOTHING ELSE. A plain search for the hook
   name survives `if(false && e.target.closest(...))` — the text stays exactly where it
   was while the branch can never run, and the red-check caught this file passing over
   precisely that. Pinning the shape of the test is what makes it a check. */
check('the panel handles a press of Add a map',
  /if\(e\.target\.closest\('\[data-bpmaddmap\]'\)\)\{/.test(panelWire), panelWire.slice(0, 80));
check('and a press of Show everyone',
  /if\(e\.target\.closest\('\[data-bpmshowall\]'\)\)\{/.test(panelWire));
check('and Show everyone really clears the filter rather than only the search box',
  /data-bpmshowall[\s\S]{0,260}bpmFilter\.clear\(\)/.test(panelWire));
/* ⚠ AND PUTS THE NAME LIST AWAY. That button lives in the empty grid, so the render
   destroys the node that was clicked and the close-on-click-outside rule bails on a
   detached target — the list stayed open over the houses that had just come back. */
check('and puts the name list away',
  /data-bpmshowall[\s\S]{0,320}bpmOpenPick\(false\)/.test(panelWire));

/* ⚠ THE CLOSE-ON-CLICK-OUTSIDE RULE MUST EXEMPT THE BUTTON THAT OPENS THE PICKER.
   "+ Add a map" sits outside .bpm-searchwrap, so without the exemption the document
   handler closed the list the same click had just opened — the control did nothing at
   all, and every source check here was green over it because the list really was built.
   Found by driving a real browser, which is the only thing that could have. */
/* ⚠ ANCHORED ON SOMETHING ONLY THIS HANDLER SAYS. The first draft sliced from the first
   `document.addEventListener('click'` in a 74,000-line file — there are eight, and the
   panel's is the last. It failed on correct code, which is the honest direction, but it
   was only noticed because the whole run was read rather than its last three lines. */
const docWire = sliceBetween("!e.target.closest('.bpm-filterwrap')", "addEventListener('keydown'");
check('the document click handler was found', docWire.length > 0);
check('the picker is not closed by the button that just opened it',
  /!e\.target\.closest\('\.bpm-searchwrap'\) && !e\.target\.closest\('\[data-bpmaddmap\]'\)/.test(docWire),
  docWire.slice(-220));

const pendWire = sliceBetween('const pendingBtn', "const search = bpmEl('bpmSearch')");
check('the Pending button handler was found', pendWire.length > 0);
check('the Pending button flips the view', /bpmView = \(bpmView === 'pending'\) \? 'print' : 'pending'/.test(pendWire),
  pendWire.slice(0, 200));
check('and repaints', pendWire.indexOf('bpmRender()') !== -1);

const chooseSrc = lift('bpmChoosePerson');
check('bpmChoosePerson is still in admin.html', !!chooseSrc);
/* ⚠ CLOSING THE PICKER CLEARS THE FLAG, so reading it afterwards reads false every time
   and "+ Add a map" would silently only ever filter.
   ⚠ AND THIS CHECK IS RUN OVER STRIPPED SOURCE. Its first draft failed on correct code:
   the comment ABOVE the rule names the very call it is ordering against, so the plain
   search found the explanation and called it the code. Suites 58, 274, 275 and 300 each
   had to learn this, and so did the leak check in comm-centre. */
const chooseCode = strip(chooseSrc);
const readAt = chooseCode.indexOf('const adding = bpmAddMode');
const closeAt = chooseCode.indexOf('bpmOpenPick(false)');
check('picking a name reads the add flag BEFORE the picker is closed',
  readAt !== -1 && closeAt !== -1 && readAt < closeAt,
  'read at ' + readAt + ', picker closed at ' + closeAt);
check('and opens the drawing when it was set', /if\(adding\) bpmStartAddFor\(id\)/.test(chooseSrc));

const beginSrc = lift('bpmBeginAdd');
check('bpmBeginAdd is still in admin.html', !!beginSrc);
check('and it sets the flag the picker reads', /bpmAddMode = true/.test(beginSrc));

const startSrc = lift('bpmStartAddFor');
check('bpmStartAddFor is still in admin.html', !!startSrc);
check('a house with no drawing opens its own empty row',
  /bpmOpenDialog\(houseId \+ '::'\)/.test(startSrc));
/* ⚠ A SECOND DRAWING GOES THROUGH "Add another map", never round it — that button is
   the one path that decides what a blank one is called and when it is written. */
check('and a house that already has one goes through Add another map',
  /bpmEl\('bpmDlgAdd'\)/.test(startSrc) && startSrc.indexOf('bpmPendingNew') === -1,
  'minting a pending map here would be a second set of those rules');

/* ---------------------------------------------------------------------------
 * THE NUMBER BESIDE AN OPTION SAYS WHAT PRESSING IT SHOWS.
 * ⛔ Addie, 2026-09-17: "brought up new quotes and requotes and shows a number next to
 * them but when I push them no one pulls up." The tallies were counted over the whole
 * book while the list ALSO applied the other group, so on her own opening default —
 * "Has a map" ticked, her new quotes not yet photographed — the menu offered
 * "New quotes 1" and the grid drew nothing.
 * ------------------------------------------------------------------------- */
head('The number beside an option says what pressing it shows');

/* Her book, in the shape that produced it: a couple of houses photographed, the new
 * quotes and re-quotes not. ⚠ A FIXTURE WHERE THE NEW QUOTE HAPPENS TO HAVE A MAP
 * CANNOT SEE THIS AT ALL — the first attempt to reproduce it used exactly that and came
 * back green. */
const HER_BOOK = BOOK.map(h => {
  const c = clone(h);
  if (c.id !== 'h-sorensen') delete c.data.blueprintMaps;
  return c;
});

load(HER_BOOK);
S.bpmApplyDefaultFilter();
check('the fixture reproduces her opening state — Has a map ticked', S.bpmFilter.has('mapped'),
  'without a photographed house the filter stands down and the bug cannot appear');

const stageKeys = ['new', 'requote', 'returning'];
stageKeys.forEach(k => {
  const promised = S.bpmCountFor(k);
  S.bpmFilter.clear(); S.bpmFilter.add('mapped'); S.bpmFilter.add(k);
  const delivered = S.bpmShown().length;
  check('"' + k + '" shows what its number promised', promised === delivered,
    'the menu said ' + promised + ' and the grid drew ' + delivered +
    ' — a number sitting on a button is read as a promise, every time');
  S.bpmFilter.clear(); S.bpmFilter.add('mapped');
});

/* ⚠ AND IT IS NOT VACUOUS: on this book at least one stage really does count zero once
   the other group is applied, which is the case that was reported. */
S.bpmFilter.clear(); S.bpmFilter.add('mapped');
check('at least one option honestly reads nought here',
  stageKeys.some(k => S.bpmCountFor(k) === 0),
  'if every count is positive this section proves nothing about the reported case');
check('and the same options are NOT all zero over the book itself',
  stageKeys.some(k => S.bpmItems().filter(i => i.stage === k).length > 0),
  'the census figures are still non-zero — which is exactly why the old count misled');

/* ⚠ ITS OWN GROUP IS SET ASIDE, or every unticked option in a group that has a tick
   reads 0 and the whole group looks empty the moment you narrow it. */
load();
S.bpmFilter.clear(); S.bpmFilter.add('new');
check('an option is not counted against its own group',
  S.bpmCountFor('requote') > 0,
  'ticking New quotes must not make Requotes read nought — the group would look empty');

/* ⚠ AND A TICK THE PENDING VIEW DOES NOT OFFER MUST NOT REACH THE TALLIES EITHER. The
   list there never consults the map-status group, so a rule that read the raw tick set
   rather than the offered one would count every pending row out and print a column of
   noughts beside a list that plainly has rows in it. The red-check found this uncovered:
   the sabotage is invisible in the print view, where offered and ticked are the same. */
load(HER_BOOK);
S.setView('pending');
S.bpmFilter.clear(); S.bpmFilter.add('mapped');
check('a stale Has-a-map tick does not zero the pending tallies',
  ['new', 'requote'].every(k =>
    S.bpmCountFor(k) === S.bpmPendingItems().filter(i => i.stage === k).length),
  'new ' + S.bpmCountFor('new') + ', requote ' + S.bpmCountFor('requote') +
  ' against a list of ' + S.bpmShown().length);
check('and the fixture really has pending rows for that to be wrong about',
  S.bpmShown().length > 0, 'saw ' + S.bpmShown().length);
S.bpmFilter.clear();
S.setView('print');

/* The search box narrows the tallies too: it narrows the list. */
load();
S.bpmFilter.clear();
const someName = S.bpmItems()[0].name;
S.setQuery(someName);
check('the tallies answer to the search box as well',
  S.bpmCountFor('new') + S.bpmCountFor('requote') + S.bpmCountFor('returning') === S.bpmShown().length,
  'the three stages together are the whole list, so they must add up to it');
S.setQuery('');

/* Every id the script asks for must exist in the markup — a missing node under
   optional chaining is a silent no-op, and this file has shipped one before. */
const askedFor = new Set();
let m, idRe = /bpmEl\('([A-Za-z0-9_-]+)'\)/g;
while ((m = idRe.exec(adminCode))) askedFor.add(m[1]);
const absent = [...askedFor].filter(id => admin.indexOf('id="' + id + '"') === -1);
check('every element the script looks up exists in the markup', absent.length === 0,
  absent.length ? 'missing: ' + absent.join(', ') : askedFor.size + ' ids checked');
check('and it looks up a real number of them', askedFor.size >= 15,
  'a matcher that has quietly stopped matching reports no missing ids at all — ' +
  'a green build for the worst possible reason');

/* ---------------------------------------------------------------------------
 * DONE.
 * ------------------------------------------------------------------------- */
console.log('\n=======================================================');
console.log('Blueprint Maps — ' + pass + ' passed, ' + fail + ' failed' + (notes ? ', ' + notes + ' notes' : ''));
console.log('=======================================================\n');
if (fail) {
  failures.forEach(f => console.log('  - ' + f));
  console.log('');
  process.exit(1);
}
