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
  'bpmOpenRequoteFor', 'bpmStageOf', 'bpmItems',
  'bpmCopiesFor', 'bpmIsTicked', 'bpmMatches', 'bpmShown', 'bpmShownMapped', 'bpmCountFor',
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
  lifted(/const BPM_STAGE_TEXT = \{[^}]*\};/, 'the stage wording')
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
  const mk = () => ({innerHTML: '', textContent: ''});
  const nodes = {bpmSheets: mk(), bpmSheetNote: mk(), bpmGrid: mk()};
  return {getElementById: id => nodes[id] || null, _nodes: nodes};
}

function sandbox(extra) {
  const body =
    'let jobAddresses = [], quotesCache = [];\n' +
    'let bpmQuery = "", bpmPerPage = 8, bpmPickIdx = -1, bpmOpenKey = null;\n' +
    'let bpmPendingNew = null, bpmLoadFailed = "";\n' +
    'const bpmFilter = new Set(["mapped"]);\n' +
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
  // an OPEN re-quote against Marcus Reyes, named by customer id
  {id: 'q1', data: {status: 'new', existingCustomerId: 'h-reyes', quotedPrice: 640,
    approvalStatus: 'pending', quoteSentAt: {seconds: 1}, phone: '8015550003', address: '1590 Canyon Rd'}},
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
