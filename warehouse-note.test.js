/* ============================================================================
 * WAREHOUSE NOTE — a note written for the people making the bundles, on both
 * of the sheets they work from.
 *
 * ⭐ Addie, 2026-09-17: "on costumers we need to be able to add notes to warehouse
 * that updates when we print off warehouse pages."
 *
 * ⛔ WHAT WAS ACTUALLY BROKEN was not the typing, it was the paper. Permanent Notes
 * has always printed on the WAREHOUSE TAB's build sheet — and the PRINTING TAB's
 * build sheet, which is the one "print off warehouse pages" means, had no Notes
 * column at all. Anything typed for the warehouse was visible on one and invisible
 * on the other, which is indistinguishable from the field not working.
 *
 * ⚠ SO THE CLAIM THIS FILE HOLDS IS THAT THE TWO SHEETS AGREE. Both are RUN against
 * the same customer and the cells compared, because this repo has twice been caught
 * by two sheets deciding the same thing separately — the bins count and the
 * put-into wording — and a source check for "calls whNotesCell" passes on a sheet
 * that never renders the column.
 *
 * Its own file per R-018. `npm run test:whnote`.
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const scan = require('./connections/scan.js');

const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const ix = scan.index(admin, true);

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
}
function head(t) { console.log('\n=== ' + t + ' ===\n'); }

function lift(name) {
  const hits = ix.fns.filter(f => f.name === name);
  if (!hits.length) return '';
  const f = hits.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);
  return ix.src.slice(f.start, f.end + 1) + '\n';
}
/* Comments stripped before any ordering or presence check. The rule this repo has
   had to learn five times: a comment naming the very call it explains is found by a
   plain search and read as the code. */
const code = scan.index(admin, true).blanked;

head('The rule exists and is one rule');

const NEEDED = ['whNoteText', 'whNotesCell', 'whSheetRowsForBuild', 'whBuildQueueGroups',
                'printNeedsBuildList', 'whBinsForHouse', 'whPutIntoLabel', 'houseLightsText',
                'printLightColor', 'printYesNo', 'whBuildReasonKey', 'whBuildReasonLabel',
                'whWhoLabel', 'isOutForSeason'];
const src = {};
const missing = [];
NEEDED.forEach(n => { src[n] = lift(n); if (!src[n]) missing.push(n); });
check('every rule this gate runs is still in admin.html', missing.length === 0,
  missing.length ? 'renamed or removed: ' + missing.join(', ') : '');
if (missing.length) { console.log(''); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }

/* ---------------------------------------------------------------------------
 * THE CELL ITSELF.
 * ------------------------------------------------------------------------- */
head('What the Notes cell says');

const cell = new Function('d', 'isTopUp', src.whNoteText + src.whNotesCell + 'return whNotesCell(d, isTopUp);');
const DASH = String.fromCharCode(8212);

check('a warehouse note reaches the cell',
  cell({warehouseNote: 'Short strands only'}, false) === 'Short strands only',
  'got ' + JSON.stringify(cell({warehouseNote: 'Short strands only'}, false)));

/* ⚠ THE OLD BEHAVIOUR MUST SURVIVE. Permanent Notes is what this cell has always
   carried and somebody is relying on it; answering her request by taking that away
   would be a worse bug than the one being fixed. */
check('and Permanent Notes still reaches it on its own',
  cell({notes: 'Dog in the yard'}, false) === 'Dog in the yard');

check('both together lead with the warehouse note',
  cell({warehouseNote: 'Top shelf', notes: 'Dog in the yard'}, false) ===
    'Top shelf ' + DASH + ' Dog in the yard',
  'the warehouse note is the one written FOR the person holding this sheet, so it ' +
  'reads first: got ' + JSON.stringify(cell({warehouseNote: 'Top shelf', notes: 'Dog in the yard'}, false)));

check('nothing on file is an empty cell, never the word undefined',
  cell({}, false) === '' && cell(null, false) === '',
  'got ' + JSON.stringify(cell({}, false)) + ' and ' + JSON.stringify(cell(null, false)));

check('whitespace alone is nothing',
  cell({warehouseNote: '   ', notes: '  '}, false) === '');

/* ⚠ THE TOP-UP LINE IS AN INSTRUCTION, NOT A NOTE. It is what stops somebody making a
   whole new bin for a house that already has one, so it leads whatever anybody typed. */
check('a top-up still leads with the existing-bin instruction',
  cell({warehouseNote: 'Top shelf'}, true) ===
    'GOES INTO THE BIN THEY ALREADY HAVE ' + DASH + ' Top shelf',
  'got ' + JSON.stringify(cell({warehouseNote: 'Top shelf'}, true)));
check('and says it even when nobody has typed anything',
  cell({}, true) === 'GOES INTO THE BIN THEY ALREADY HAVE');

/* ---------------------------------------------------------------------------
 * THE ONE-TIME NOTE.
 * ⭐ Addie, 2026-09-17: "it needs to have permanent notes or one time notes." The same
 * pair the customer notes already are — one that stands, and one that is true for this
 * build and then gone.
 * ------------------------------------------------------------------------- */
head('A note for this build only');

check('a one-time note reaches the cell',
  cell({warehouseOneTimeNote: 'Old bin back'}, false) === 'THIS BUILD ONLY: Old bin back',
  'got ' + JSON.stringify(cell({warehouseOneTimeNote: 'Old bin back'}, false)));

/* ⚠ LABELLED, NOT JUST PRESENT. Unlabelled it is indistinguishable from a standing
   instruction, and would go on being obeyed after the build it belonged to was made. */
check('and it says so, so nobody reads it as standing',
  cell({warehouseOneTimeNote: 'Old bin back'}, false).indexOf('THIS BUILD ONLY') === 0);

check('it leads the permanent one',
  cell({warehouseOneTimeNote: 'Old bin back', warehouseNote: 'Top shelf'}, false) ===
    'THIS BUILD ONLY: Old bin back ' + DASH + ' Top shelf',
  'it is the only line in the cell that is true this morning and false next week: got ' +
  JSON.stringify(cell({warehouseOneTimeNote: 'Old bin back', warehouseNote: 'Top shelf'}, false)));

check('and all three read in order, once only, nothing dropped',
  cell({warehouseOneTimeNote: 'A', warehouseNote: 'B', notes: 'C'}, false) ===
    'THIS BUILD ONLY: A ' + DASH + ' B ' + DASH + ' C',
  'got ' + JSON.stringify(cell({warehouseOneTimeNote: 'A', warehouseNote: 'B', notes: 'C'}, false)));

check('a top-up still leads the lot',
  cell({warehouseOneTimeNote: 'A', notes: 'C'}, true) ===
    'GOES INTO THE BIN THEY ALREADY HAVE ' + DASH + ' THIS BUILD ONLY: A ' + DASH + ' C');

/* ⛔ AND IT HAS TO BE CLEARED WHEN THE BUNDLE IS MADE, or it is a standing instruction
   wearing a one-time label. */
const builtSrc = lift('whBuiltUpdates');
check('whBuiltUpdates is still in admin.html', !!builtSrc,
  'the one place that says what "the bundle is made" writes');
const built = new Function('serverTimestamp', builtSrc + 'return whBuiltUpdates();')(() => 'TS');
check('making the bundle clears the one-time note', built.warehouseOneTimeNote === '',
  'got ' + JSON.stringify(built));
/* ⚠ AND IT MUST NOT TOUCH THE PERMANENT ONE. That is the whole difference between them. */
check('and leaves the permanent one alone',
  !Object.prototype.hasOwnProperty.call(built, 'warehouseNote'),
  'a standing instruction wiped by a build is not a standing instruction');
check('while still clearing the build flag and stamping the date',
  built.needsLightBuild === false && built.lightsMarkedBuiltAt === 'TS',
  'got ' + JSON.stringify(built));

/* ⚠ THE WIRING, APART FROM THE RULE. Two Mark Done paths wrote this object out
   separately until 2026-09-17; a note cleared on one and left behind on the other is an
   instruction that outlives its build, which is the failure the shared rule exists for. */
const markDone = admin.slice(admin.indexOf('btn.dataset.whdonehouse'),
                             admin.indexOf('function whBuiltUpdates('));
check('both Mark Done paths go through that one rule',
  (markDone.match(/whBuiltUpdates\(\)/g) || []).length >= 2,
  'found ' + (markDone.match(/whBuiltUpdates\(\)/g) || []).length +
  ' — one house and a whole colour group must clear the same fields');
/* ⚠ SCOPED TO THE BUILD STAMP, NOT TO THE FLAG. The first draft of this check forbade
   any inline `needsLightBuild: false` in the region and so failed on TWO writes that are
   perfectly correct — "Not needed" and "Only needed a timer" both clear the flag and
   must NOT stamp, which is exactly why they do not go through whBuiltUpdates. A check
   that forbids the right answer is worse than no check. What must be true is narrower:
   nothing in here records a bundle being MADE except the one shared rule. */
/* ⚠ THE REGION STOPS AT THE SHARED RULE'S OWN DECLARATION, which sits just below the
   handlers — otherwise this check reports whBuiltUpdates itself as the inline copy it is
   looking for, and fails on the very code it exists to require. The trap Suites 58, 274,
   275 and 300 each hit, in a new shape: a check that finds its own answer. */
const stampSrc = scan.index(admin, true).blanked
  .slice(admin.indexOf('btn.dataset.whdonehouse'), admin.indexOf('function whBuiltUpdates('));
check('and nothing in there stamps a build except that one rule',
  (stampSrc.match(/lightsMarkedBuiltAt/g) || []).length === 0,
  'found ' + (stampSrc.match(/lightsMarkedBuiltAt/g) || []).length + ' inline — a second ' +
  'copy of the made-a-bundle write is how a field cleared in one place is forgotten in the other');

/* ---------------------------------------------------------------------------
 * BOTH SHEETS, RUN, AND COMPARED.
 * ------------------------------------------------------------------------- */
head('The two build sheets agree about it');

const CUST = {
  name: 'Ashley Wray', customerNumber: '894', address: '9991 Red Cedar Ln',
  needsLightBuild: true, lightsDescription: 'Warm White', wireColor: 'White',
  measuredFeet: 300, outletTimer: 'Yes',
  warehouseNote: 'Use the short strands', notes: 'Dog in the yard',
  warehouseOneTimeNote: 'They want the old bin back'
};

/* ⚠ READ OUT OF js/money.js, WHICH IS WHERE IT LIVES — admin.html imports it, so there
   is no number in that file to find. Seven fixtures in this repo have already gone on
   passing against a cutoff the app no longer had (200, then 260, then 320). */
const CN = (fs.readFileSync(path.join(ROOT, 'js', 'money.js'), 'utf8')
  .match(/CN_DOUBLE_BIN_FEET\s*=\s*(\d+)/) || [])[1];
check('the bin cutoff was read out of js/money.js rather than typed here', !!CN,
  'a second copy of that number is how a sandbox keeps passing against a rule the app no longer has');
const binsSrc = 'function cnBinsForFeet(f){ f = Number(f) || 0; return f <= ' + CN +
  ' ? 1 : Math.ceil(f / ' + CN + '); }\n';
const needSrc = 'function houseBundleNeed(d){ return {bundles: 1, estimated: false, topUp: false}; }\n';

/* The warehouse tab's own sheet. */
const whRows = new Function('jobAddresses', 'warehouseExtras', 'whGroupKey', 'whWireLabel',
  'WH_BUILD_COLUMNS', 'isOutForSeason',
  binsSrc + needSrc + src.houseLightsText + src.whBinsForHouse + src.whWhoLabel +
  src.whPutIntoLabel + src.whNoteText + src.whNotesCell +
  (admin.match(/const WH_BUILD_REASONS = \{[\s\S]*?\r?\n\};/) || [''])[0] +
  src.whBuildReasonKey + src.whBuildReasonLabel + src.whBuildQueueGroups + src.whSheetRowsForBuild +
  'return whSheetRowsForBuild();');
const whOut = whRows([{id: 'a1', data: CUST}], [], (p, w) => p + '|' + (w || ''),
  (w) => String(w || 'white'), [{key: 'notes', label: 'Notes'}], () => false);
const whRow = whOut.rows.filter(r => r.type !== 'Blocked')[0];
check('the warehouse tab builds a row for that house', !!whRow,
  'nothing below is proved without one');

/* The printing tab's sheet. */
const prRows = new Function('jobAddresses', 'isOutForSeason', 'whBinsForHouse', 'whPutIntoLabel',
  'houseBundleNeed', 'printLightColor', 'printYesNo', 'whBuildReasonKey', 'whBuildReasonLabel',
  src.whNoteText + src.whNotesCell + src.printNeedsBuildList + 'return printNeedsBuildList();');
const prOut = prRows([{id: 'a1', data: CUST}], () => false,
  new Function('d', binsSrc + src.whBinsForHouse + 'return whBinsForHouse(d);'),
  new Function('d', src.whPutIntoLabel + 'return whPutIntoLabel(d);'),
  new Function('d', needSrc + 'return houseBundleNeed(d);'),
  (d) => String(d.lightsDescription || ''), (v) => String(v || ''),
  () => 'new', () => 'NEW');
const prRow = prOut[0];
check('the printing tab builds a row for that house', !!prRow);

if (whRow && prRow) {
  check('the printed sheet carries the note at all', !!prRow.notes,
    'this is the whole bug: the column did not exist, so nothing typed ever reached ' +
    'the pages printed from the Printing tab');
  /* ⚠ ASSERTED AS EQUAL RATHER THAN AS "both contain the note". Two sheets that both
     mention it and word it differently is the failure this file exists to stop. */
  check('and both sheets say exactly the same thing', whRow.notes === prRow.notes,
    'tab: ' + JSON.stringify(whRow.notes) + '\n          print: ' + JSON.stringify(prRow.notes));
  check('which is what the shared rule returns', whRow.notes === cell(CUST, false),
    'got ' + JSON.stringify(whRow.notes));
  check('and it is not vacuous — the cell really carries her words',
    String(whRow.notes).indexOf('Use the short strands') !== -1,
    'got ' + JSON.stringify(whRow.notes));
}

/* ---------------------------------------------------------------------------
 * THE COLUMN, AND WHERE IT SITS.
 * ------------------------------------------------------------------------- */
head('The column is on the sheet, and last');

const printCols = (admin.match(/build:\s*\[([\s\S]*?)\],\r?\n\s*warehouse:/) || [])[1] || '';
const printKeys = (printCols.match(/k:\s*'([a-zA-Z]+)'/g) || []).map(m => m.split("'")[1]);
check('the printing tab has a build column list to read', printKeys.length > 0);
check('it ends with notes', printKeys[printKeys.length - 1] === 'notes',
  'Notes is the wide free-text column and anything after it is lost against a wall of ' +
  'writing — the same argument that fixes Timer on every crew sheet. Got: ' + printKeys.join(','));

const whCols = (admin.match(/const WH_BUILD_COLUMNS = \[([\s\S]*?)\r?\n\];/) || [])[1] || '';
const whKeys = (whCols.match(/key:\s*'([a-zA-Z]+)'/g) || []).map(m => m.split("'")[1]);
check('and the warehouse tab still ends with notes too',
  whKeys[whKeys.length - 1] === 'notes', 'got: ' + whKeys.join(','));

/* ---------------------------------------------------------------------------
 * THE FIELD IS WRITTEN, READ, AND DECLARED (CLAUDE.md §1).
 * ------------------------------------------------------------------------- */
head('The box is wired to the record');

check('Add Customer has the box', admin.indexOf('id="addCustWarehouseNote"') !== -1);
check('Edit Customer has the box', admin.indexOf('id="editCustWarehouseNote"') !== -1);
check('Add Customer reads it', /addCustWarehouseNote'\)\.value/.test(code));
check('and writes it to the record', /warehouseNote:\s*warehouseNote/.test(code));
check('Edit Customer fills it from the record',
  /editCustWarehouseNote'\)\.value = d\.warehouseNote/.test(code));
check('reads it back on save', /newWarehouseNote = document\.getElementById\('editCustWarehouseNote'\)/.test(code));
check('and writes it', /addrUpdates\.warehouseNote = newWarehouseNote/.test(code));
check('Add Customer has the one-time box', admin.indexOf('id="addCustWarehouseOneTime"') !== -1);
check('Edit Customer has the one-time box', admin.indexOf('id="editCustWarehouseOneTime"') !== -1);
check('Add Customer writes the one-time note',
  /warehouseOneTimeNote:\s*warehouseOneTimeNote/.test(code));
check('Edit Customer fills the one-time box from the record',
  /editCustWarehouseOneTime'\)\.value = d\.warehouseOneTimeNote/.test(code));
check('and writes it back', /addrUpdates\.warehouseOneTimeNote = newWarehouseOneTime/.test(code));

/* ⛔ THE ONE THING THAT WOULD COST REAL WORK. WAREHOUSE_BUILD_FIELDS is what queues a
   bundle REBUILD when it changes; a note in that list means correcting a typo sends
   somebody to make a second set of lights for a house that already has one. */
const buildFields = (admin.match(/const WAREHOUSE_BUILD_FIELDS = \[([^\]]*)\]/) || [])[1] || '';
check('the note is NOT one of the fields that queue a rebuild',
  buildFields.indexOf('warehouseNote') === -1 && buildFields.indexOf('warehouseOneTimeNote') === -1,
  'a note is not glass — got [' + buildFields + ']');
check('and that list was really found, so the check is not vacuous',
  buildFields.indexOf('lightsDescription') !== -1, 'got [' + buildFields + ']');

/* The change log names every field it reports, or a change to this one reads as a
   bare key nobody can place. */
/* ⚠ AGAINST THE RAW FILE, NOT THE BLANKED ONE. scan's blanked view does not reach the
   plain inline script this table lives in, so the check read as absent on a file that
   plainly has it — it failed on correct code, which is the honest direction, but a check
   pointed at the wrong text proves nothing either way. Comments are stripped by hand here
   instead. */
const adminStripped = admin.replace(/\/\*[\s\S]*?\*\//g, ' ');
check('the change log has a label for it',
  /warehouseNote:\s*\{\s*label:/.test(adminStripped), 'an unlabelled field reads as a raw key');
check('and one for the this-build-only note',
  /warehouseOneTimeNote:\s*\{\s*label:/.test(adminStripped));

/* ⚠ IT IS NOT A CUSTOMER-FACING OPTION, so it belongs in the data map rather than the
   option registry — a row in js/options.js would put it in front of customers and into
   the eight-destination audit. Asserted so nobody "completes" it by adding one. */
const options = fs.readFileSync(path.join(ROOT, 'js', 'options.js'), 'utf8');
check('and it is deliberately NOT in the customer option registry',
  options.indexOf('warehouseNote') === -1 && options.indexOf('warehouseOneTimeNote') === -1,
  'this is an internal note between the office and the warehouse, not something a ' +
  'customer is asked');

console.log('\n=======================================================');
console.log('Warehouse note — ' + pass + ' passed, ' + fail + ' failed');
console.log('=======================================================\n');
if (fail) { failures.forEach(f => console.log('  - ' + f)); console.log(''); process.exit(1); }
