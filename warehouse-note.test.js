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
                /* ⚠ LIFTED, NOT STUBBED, AND IT ARRIVED BY MERGE. [[WH-35]] made the printed
                   build sheet read its wire colour through whWireLabel too, so a stub here
                   would let this gate keep passing while the two sheets said different
                   things about the same house — which is the very claim this file holds.
                   The sandbox died with a bare "whWireLabel is not defined" the moment main
                   landed: the extraction-list trap, arriving from somebody else's branch. */
                'whWireLabel',
                /* Lifted for the same reason: Added ft / Total bundles on both sheets (2026-10-05). */
                'whBuildSizeCells', 'whBuildTodo',
                'whWhoLabel', 'isOutForSeason',
                /* [[WH-49]] the third sheet — the day's pull list — and the renderer that draws it. */
                'printWarehouseDayList', 'printWarehousePage', 'printTableHtml',
                /* [[SCH-143]] a done house is never printed — the pull list asks it */
                'printNotDone'];
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

/* ⛔ [[WH-48]] REVERSES WH-37's "Permanent Notes still follows". Addie, 2026-09-23: "I put
   a note for crew and warehouse but the one for crew was showing for warehouse."
   Permanent Notes is the CREW's box. The old check here asserted the opposite and was
   right under the ruling it guarded; it is repointed, not deleted, so a change that puts
   the crew's note back on the warehouse sheet goes red. */
check('the crew\'s Permanent Notes do NOT reach the warehouse cell',
  cell({notes: 'Dog in the yard'}, false) === '',
  'got ' + JSON.stringify(cell({notes: 'Dog in the yard'}, false)));

check('with both on file, only the warehouse note is there',
  cell({warehouseNote: 'Top shelf', notes: 'Dog in the yard'}, false) === 'Top shelf',
  'got ' + JSON.stringify(cell({warehouseNote: 'Top shelf', notes: 'Dog in the yard'}, false)));

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

check('both warehouse notes read in order, and the crew note is left out ([[WH-48]])',
  cell({warehouseOneTimeNote: 'A', warehouseNote: 'B', notes: 'C'}, false) ===
    'THIS BUILD ONLY: A ' + DASH + ' B',
  'got ' + JSON.stringify(cell({warehouseOneTimeNote: 'A', warehouseNote: 'B', notes: 'C'}, false)));

check('a top-up still leads the lot',
  cell({warehouseOneTimeNote: 'A', notes: 'C'}, true) ===
    'GOES INTO THE BIN THEY ALREADY HAVE ' + DASH + ' THIS BUILD ONLY: A');

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
/* ⚠ REPOINTED 2026-10-29, NOT WEAKENED: the calls now hand over the house's record (so the
   rule can keep a pending recycle's bin label), so they are counted as calls, with or
   without an argument. */
check('both Mark Done paths go through that one rule',
  (markDone.match(/whBuiltUpdates\(/g) || []).length >= 2,
  'found ' + (markDone.match(/whBuiltUpdates\(/g) || []).length +
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
const whRows = new Function('jobAddresses', 'warehouseExtras', 'whGroupKey',
  'WH_BUILD_COLUMNS', 'isOutForSeason',
  binsSrc + needSrc + src.whWireLabel + src.houseLightsText + src.whBinsForHouse + src.whWhoLabel +
  src.whPutIntoLabel + src.whNoteText + src.whNotesCell + src.whBuildSizeCells + src.whBuildTodo +
  (admin.match(/const WH_BUILD_REASONS = \{[\s\S]*?\r?\n\};/) || [''])[0] +
  src.whBuildReasonKey + src.whBuildReasonLabel + src.whBuildQueueGroups + src.whSheetRowsForBuild +
  'return whSheetRowsForBuild();');
const whOut = whRows([{id: 'a1', data: CUST}], [], (p, w) => p + '|' + (w || ''),
  [{key: 'notes', label: 'Notes'}], () => false);
const whRow = whOut.rows.filter(r => r.type !== 'Blocked')[0];
check('the warehouse tab builds a row for that house', !!whRow,
  'nothing below is proved without one');

/* The printing tab's sheet. */
const prRows = new Function('jobAddresses', 'isOutForSeason', 'whBinsForHouse', 'whPutIntoLabel',
  'houseBundleNeed', 'printLightColor', 'printYesNo', 'whBuildReasonKey', 'whBuildReasonLabel',
  src.whWireLabel + src.whNoteText + src.whNotesCell + src.whBuildSizeCells + src.whBuildTodo + src.printNeedsBuildList +
  'return printNeedsBuildList();');
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
 * THE THIRD SHEET — THE DAY'S PULL LIST ([[WH-49]], 2026-10-15).
 * Addie: "for warehouse notes I need the crews to see the notes before they load the
 * bins. Can we put any warehouse notes on the warehouse list somehow?" The Printing
 * tab's Warehouse sheet (page one of Print today) is the list somebody holds while
 * loading the van, and it carried Cust # and Name alone — so a note that reached both
 * BUILD sheets never reached the morning the bins went out.
 * ⚠ RUN, NOT MATCHED. The claim is that a row carries her words through the SAME rule
 * the other two sheets read; a stubbed whNoteText would decide the very thing under
 * test, and a source match for the word "notes" is satisfied by the crew's box too.
 * ------------------------------------------------------------------------- */
head('The day\'s pull list carries the note too');

const pullList = new Function('printCustData',
  src.whNoteText + src.whNotesCell + src.printNotDone + src.printWarehouseDayList + 'return printWarehouseDayList;')(
  (h) => h._cust || {});
const pullFor = (cust) => pullList({houses: [{id: 'cust-a1', cu: 894, name: 'Ashley Wray', _cust: cust}]})[0];
const pullRow = src.printWarehouseDayList ? pullFor(CUST) : null;
check('the pull list builds a row for that house', !!pullRow && pullRow.name === 'Ashley Wray',
  'nothing below is proved without one');
if (pullRow) {
  check('the pull list carries the warehouse note at all', !!pullRow.notes,
    'this is the whole request: the sheet had no notes on it, so the crew loaded the ' +
    'bins without ever seeing what was written for them');
  check('and it is not vacuous — the row really carries her words',
    String(pullRow.notes).indexOf('Use the short strands') !== -1, 'got ' + JSON.stringify(pullRow.notes));
  check('the one-time note is on it too, labelled as such',
    String(pullRow.notes).indexOf('THIS BUILD ONLY: They want the old bin back') !== -1,
    'got ' + JSON.stringify(pullRow.notes));
  /* ⚠ EQUAL, NOT "both mention it" — three sheets wording one house three ways is the
     failure this file exists to stop. */
  check('and it says exactly what the shared rule says', pullRow.notes === cell(CUST, false),
    'pull: ' + JSON.stringify(pullRow.notes) + '\n          rule: ' + JSON.stringify(cell(CUST, false)));
  if (whRow) check('which is exactly what the warehouse tab\'s build sheet says',
    pullRow.notes === whRow.notes,
    'pull: ' + JSON.stringify(pullRow.notes) + '\n          tab: ' + JSON.stringify(whRow.notes));
}
check('the crew\'s Permanent Notes do NOT reach the pull list ([[WH-48]])',
  pullFor({name: 'Ashley Wray', notes: 'Dog in the yard'}).notes === '',
  'got ' + JSON.stringify(pullFor({name: 'Ashley Wray', notes: 'Dog in the yard'}).notes));
check('nothing on file is an empty cell, never the word undefined',
  pullFor({name: 'Ashley Wray'}).notes === '', 'got ' + JSON.stringify(pullFor({name: 'Ashley Wray'}).notes));
/* ⚠ whNotesCell leads an add-on with GOES INTO THE BIN THEY ALREADY HAVE. That is a
   BUILDING instruction and nobody builds off the pull list; they load what is on the
   shelf. The pull list reads whNoteText, and this check bites if it is ever "tidied"
   onto whNotesCell. */
check('an add-on carries no building instruction on the pull list',
  String(pullFor(Object.assign({buildTopUpFromFeet: 100}, CUST)).notes).indexOf('GOES INTO THE BIN') === -1,
  'got ' + JSON.stringify(pullFor(Object.assign({buildTopUpFromFeet: 100}, CUST)).notes));

/* The column, and the page that draws it. A column check proves only the heading and a
   row check proves only the data; rendering the two together is what proves the note
   lands under the heading. */
const whPullCols = (admin.match(/warehouse:\s*\[([\s\S]*?)\],/) || [])[1] || '';
const whPullKeys = (whPullCols.match(/k:\s*'([a-zA-Z]+)'/g) || []).map(m => m.split("'")[1]);
check('the pull list has a column list to read', whPullKeys.length > 0);
check('it still leads with the customer number and the name', whPullKeys[0] === 'number' && whPullKeys[1] === 'name',
  'the number is what the bin is found by — got: ' + whPullKeys.join(','));
check('and ends with notes', whPullKeys[whPullKeys.length - 1] === 'notes', 'got: ' + whPullKeys.join(','));
const pageSrc = scan.index(src.printWarehousePage || '', true).blanked;
check('the warehouse page builds its rows from the pull list and draws them with that column list',
  /printWarehouseDayList\(day\)/.test(pageSrc) && /printTableHtml\(rows,\s*PRINT_COLUMNS\.warehouse\)/.test(pageSrc),
  'a column on a list the page never reads is a heading nobody sees');
const columnsSrc = (admin.match(/const PRINT_COLUMNS = \{[\s\S]*?\r?\n\};/) || [''])[0];
check('PRINT_COLUMNS was really found', !!columnsSrc);
if (columnsSrc && pullRow && src.printTableHtml) {
  const html = new Function('esc', 'printDensityClass',
    columnsSrc + src.printTableHtml + 'return printTableHtml;')(
    (s) => String(s == null ? '' : s), () => '')([pullRow],
    new Function(columnsSrc + 'return PRINT_COLUMNS.warehouse;')());
  check('rendered, the sheet is headed Warehouse notes', /<th>Warehouse notes<\/th>/.test(html),
    'got ' + html.slice(0, 200));
  check('and the note is in a cell under it', /<td>[^<]*Use the short strands[^<]*<\/td>/.test(html),
    'a heading with nothing under it is the exact failure checklist row 199 names');
}

/* ---------------------------------------------------------------------------
 * THE COLUMN, AND WHERE IT SITS.
 * ------------------------------------------------------------------------- */
head('The column is on the sheet, and last');

/* [[WH-49]] a comment block now sits between the build list and the warehouse list. */
const printCols = (admin.match(/build:\s*\[([\s\S]*?)\],\r?\n(?:\s*\/\*[\s\S]*?\*\/\r?\n)?\s*warehouse:/) || [])[1] || '';
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

/* ⭐ ADDED FT AND TOTAL BUNDLES (2026-10-05). Dax: "it should print total bundles and added
   feet". Run against the real helper, and both sheets must carry the same two cells. */
const size = new Function(src.whBuildSizeCells + 'return whBuildSizeCells;')();
const plain = size({feet: 205, bundles: 6, estimated: true, unknown: false, topUp: false});
check('a whole house prints its feet as Added ft', plain.addedFeet === '205 est', JSON.stringify(plain));
check('a whole house prints its bundle count as Total bundles', plain.totalBundles === '6 est', JSON.stringify(plain));
check('a whole house prints its feet as Total ft too', plain.totalFeet === '205 est', JSON.stringify(plain));
const addOn = size({feet: 80, bundles: 3, estimated: false, unknown: false, topUp: true, total: 280, totalBundles: 8});
check('an add-on prints only the extra feet, marked +', addOn.addedFeet === '+80', JSON.stringify(addOn));
check('an add-on prints the whole bin\'s bundles as Total bundles', addOn.totalBundles === '8', JSON.stringify(addOn));
check('an add-on prints the whole bin\'s feet as Total ft', addOn.totalFeet === '280', JSON.stringify(addOn));
const none = size({feet: 0, bundles: 1, estimated: false, unknown: true, topUp: false});
check('no footage is a blank Added ft, never 0', none.addedFeet === '', JSON.stringify(none));
check('and houseBundleNeed hands an add-on its whole-house count',
  /topUp: true[\s\S]{0,200}totalBundles: Math\.ceil\(feet \/ FEET_PER_BUNDLE\)/.test(lift('houseBundleNeed')),
  'whBuildSizeCells reads need.totalBundles on an add-on');
if (whRow && prRow) {
  check('both build sheets print the same Added ft', whRow.addedFeet === prRow.addedFeet,
    JSON.stringify([whRow.addedFeet, prRow.addedFeet]));
  check('both build sheets print the same Total ft', whRow.totalFeet === prRow.totalFeet,
    JSON.stringify([whRow.totalFeet, prRow.totalFeet]));
  check('both build sheets print the same Total bundles', whRow.totalBundles === prRow.totalBundles,
    JSON.stringify([whRow.totalBundles, prRow.totalBundles]));
}
/* ⭐ ON PAPER IT IS ONE SENTENCE NOW (2026-10-05) — the feet and bundles above still ride on
   every row; what the worker reads is whBuildTodo. */
/* ⭐ FILLING IN A BLANK DOES NOT QUEUE A REBUILD (2026-10-05). Dax: "if there is nothing that
   makes it seem like its supposed to be a rebuild then just delete it from the build list."
   81 houses were on the list only because a blank colour or wire was filled in. Run against
   the real rule, and the server's copy must carry the same line. */
{
  const fieldsSrc = (admin.match(/const WAREHOUSE_BUILD_FIELDS = \[[^\]]*\];/) || [''])[0];
  const wrf = new Function(fieldsSrc + lift('warehouseRebuildFields') + 'return warehouseRebuildFields;')();
  check('filling in blank colours is not a change',
    wrf({}, {lightsDescription: 'Red, Warm White'}).length === 0);
  check('filling in a blank wire is not a change',
    wrf({wireColor: ''}, {wireColor: 'White'}).length === 0);
  check('a real colour change still is',
    wrf({lightsDescription: 'Red'}, {lightsDescription: 'Blue'}).join() === 'lightsDescription');
  check('and once this season\'s set is built, a newly known wire still rebuilds it',
    wrf({lightsMarkedBuiltAt: 1}, {wireColor: 'Green'}).join() === 'wireColor');
  check('a timer switched on still counts (it has its own routing)',
    wrf({}, {outletTimer: 'Yes'}).join() === 'outletTimer');
  const server = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  check('the server applies the same rule',
    server.indexOf("(f !== 'wireColor' || norm(f, n) === 'white')) return false;") !== -1);
  check('but a blank wire becoming Green still rebuilds (made on the default white)',
    wrf({}, {wireColor: 'Green'}).join() === 'wireColor');
}
/* ⭐ WHAT THE WORKER READS (2026-10-05). Run against the real sentence builder. */
const todo = new Function('whBuildReasonKey', 'whPutIntoLabel', src.whBuildTodo + 'return whBuildTodo;');
const T = (key, bin) => todo(() => key, () => bin || '');
check('a new hang says NEW HANG with its feet and bundles',
  T('new')({}, {feet: 232, bundles: 6, estimated: false, unknown: false, topUp: false}) ===
    'NEW HANG — build the whole house: 232 ft, 6 bundles.');
check('an extension says we already have the house, and only the extra',
  T('rebuild', 'Ashley Wray #909')({}, {feet: 80, bundles: 2, estimated: false, unknown: false, topUp: true}) ===
    'EXTENSION — we already have their house. Build only the extra 80 ft (2 bundles) and put it in their bin: Ashley Wray #909.');
check('a timer is told in words, on the end',
  /Add a timer\.$/.test(T('')({outletTimer: 'Yes'}, {feet: 100, bundles: 3, estimated: true, unknown: false, topUp: false})));
check('a bundle count the office typed is printed as the job, without the house footage',
  T('')({}, {feet: 100, bundles: 1, typedBundles: 1, estimated: true, unknown: false, topUp: false}) ===
    'BUILD 1 bundle (set by the office — see notes).');
check('a returning customer\'s whole new set is a REBUILD, not a new hang',
  /^REBUILD/.test(T('portal')({}, {feet: 100, bundles: 3, estimated: false, unknown: false, topUp: false})));
check('the warehouse sheet prints a What to do column, not the number columns',
  /label:'What to do'/.test(whCols) && !/label:'Added ft'/.test(whCols));

/* =========================================================================
   ⛔ BREAK-TEST 2026-10-29 — FOUR WAREHOUSE FAULTS, RUN RATHER THAN MATCHED WHERE THEY CAN BE
   ========================================================================= */
head('break-test 2026-10-29: Mark Done, Mark Completed, Mark Recycled, bin says');
{
  /* #5 — Mark Done on a mover's new set wiped the old bin's label the recycle crew needs. */
  const mk = new Function('serverTimestamp', lift('whBuiltUpdates') + 'return whBuiltUpdates;')(() => 'TS');
  const mover = mk({needsLightBuild: true, needsLightRecycle: true, binLabelNumber: '894'});
  check('Mark Done keeps the old bin label while their old set is still to come back',
    !('binLabelNumber' in mover) && mover.needsLightBuild === false,
    'got ' + JSON.stringify(mover) + ' — the recycle row would fall back to their new number');
  check('and still clears it for a house with nothing coming back',
    mk({needsLightBuild: true, binLabelNumber: '894'}).binLabelNumber === null &&
    mk().binLabelNumber === null);
  const callers = (admin.match(/whBuiltUpdates\(([^)]*\)?[^)]*)\)/g) || [])
    .filter(c => !/whBuiltUpdates\(d\)/.test(c));
  check('every caller hands over the house record',
    callers.length >= 3 && callers.every(c => !/whBuiltUpdates\(\)/.test(c)),
    'found ' + JSON.stringify(callers) + ' — a call with no record clears the label for everybody');

  /* #4 — "1.5" named one house in the confirm and cleared two. */
  const cnt = new Function(lift('whCompleteCount') + 'return whCompleteCount;')();
  check('Mark Completed refuses a fraction of a house, out loud',
    cnt('1.5').n === 0 && /whole number/.test(cnt('1.5').error), JSON.stringify(cnt('1.5')));
  check('and refuses 1e1, -2 and 0, and stays silent on a blank box',
    cnt('1e1').n === 0 && cnt('-2').n === 0 && cnt('0').n === 0 && cnt('').error === 'blank');
  check('and takes a whole number as it is', cnt(' 3 ').n === 3 && !cnt('3').error);
  const markCompleted = admin.slice(admin.indexOf("querySelectorAll('[data-whcompletebtn]')"));
  check('the Mark Completed handler counts through that rule before it confirms anything',
    /whCompleteCount\(input\.value\)/.test(markCompleted.slice(0, markCompleted.indexOf('confirm('))) &&
    !/Number\(input\.value\)/.test(markCompleted.slice(0, markCompleted.indexOf('confirm('))));

  /* #6 — Mark Recycled pressed twice ran the whole removal twice: archivedRevenue counted twice. */
  const rmSrc = lift('hlxRemoveCustomerToRecycle');
  check('a second removal of the same customer while one is in flight stops at once',
    (function(){
      const body = rmSrc.slice(0, rmSrc.indexOf('const o = opts'));
      return /hlxRemovingIds\.has\(removingId\)\)\s*return/.test(body) && /hlxRemovingIds\.add\(removingId\)/.test(body) &&
        /finally\s*\{\s*if\(removingId\) hlxRemovingIds\.delete\(removingId\)/.test(rmSrc);
    })(),
    'without it the deposit is added to archivedRevenue once per press');
  /* RUN it: the guard and the already-gone check, with every write recorded. */
  (async function(){
    const writes = [];
    let exists = true;
    const fake = {
      getDoc: async () => ({exists: () => exists}),
      doc: (_db, col, id) => col + '/' + id,
      setDoc: async (ref, v) => writes.push(['set', ref]), deleteDoc: async (ref) => { writes.push(['del', ref]); exists = false; },
      increment: n => ({inc: n}), serverTimestamp: () => 'TS'
    };
    let release;
    const gate = new Promise(r => { release = r; });
    const run = new Function('getDoc','doc','setDoc','deleteDoc','increment','serverTimestamp','db',
      'hlxNamesAlreadyOnTab','dupNormName','hlxAppendRowsToSheet','rbCustomerToSheetRow','archiveCustomerSnapshot',
      'custInvoiceKey','removeCustomerFromUpcomingRoutes','logActivity','confirm',
      'const hlxRemovingIds = new Set();' + rmSrc + 'return hlxRemoveCustomerToRecycle;')(
      fake.getDoc, fake.doc, fake.setDoc, fake.deleteDoc, fake.increment, fake.serverTimestamp, {},
      async () => ({}), n => n, async () => ({written: true}), d => d,
      async () => { await gate; }, () => '', async () => {}, () => {}, () => true);
    const item = {id: 'c1', data: {name: 'Sheri', customerNumber: '5016'}};
    const first = run(item, {});
    const second = await run(item, {});
    release();
    const one = await first;
    const third = await run(item, {});
    check('a second press while the first is writing does nothing', second.removed === false && /being removed/.test(second.reason),
      JSON.stringify(second));
    check('the first one still finishes', one.removed === true, JSON.stringify(one));
    check('and a record already gone is not removed again', third.removed === false && /already removed/.test(third.reason),
      JSON.stringify(third));
    check('so the customer document was deleted exactly once',
      writes.filter(w => w[0] === 'del' && w[1] === 'jobAddresses/c1').length === 1, JSON.stringify(writes));
    finish();
  })().catch(e => { check('the removal ran in its sandbox', false, e && e.stack); finish(); });

  /* #14 — Add to Queue for somebody out for the season said "queued to build" and the house
     never showed. The note asks the same status rule the "is a house on this list" box asks. */
  const note = new Function(lift('whBuildStatusText') + lift('whQueuedButHiddenNote') +
    'return whQueuedButHiddenNote;')();
  check('a house that will not show on the build list is said to, after "queued to build"',
    /not said yes/.test(note('Kelvin', {state: 'nextyear', why: 'unconfirmed'}, false)) &&
    /Back Next Year/.test(note('Kelvin', {state: 'nextyear', why: 'Back Next Year'}, false)),
    note('Kelvin', {state: 'nextyear', why: 'unconfirmed'}, false));
  check('and an unanswered RSVP is not called a recycle',
    !/recycled/.test(note('Kelvin', {state: 'nextyear', why: 'unconfirmed'}, false)));
  check('and a house that IS on the list gets no warning',
    note('A', {state: 'building', where: 'Red'}, false) === '' &&
    note('A', {state: 'timeronly'}, true) === '');
  const statusSrc = lift('whHouseBuildStatus');
  check('the status rule tells an unanswered customer from one being recycled',
    /needsLightRecycle \? '' : 'unconfirmed'/.test(statusSrc));
  const addQ = admin.slice(admin.indexOf("getElementById('whAddExtraBtn').addEventListener('click'"));
  const addQBody = addQ.slice(0, addQ.indexOf("}, function(){ return document.getElementById('whAddExtraBtn'); }));"));
  check('Add to Queue warns through that note after a linked add',
    /whQueuedButHiddenNote\(linked\.data\.name, whHouseBuildStatus\(linked\)/.test(addQBody),
    'a note nothing calls leaves "queued to build" standing alone');
  /* #7 — two quick presses on buffer stock wrote two rows. */
  check('Add to Queue is one press at a time',
    /^getElementById\('whAddExtraBtn'\)\.addEventListener\('click', onceAtATime\(async function\(\)\{/.test(addQ) &&
    addQBody.length < addQ.length,
    'the top-up check reads a cache the first write has not reached yet');

  /* LOW — the "bin says" box refused "abc" and went on showing it. */
  const binBox = admin.slice(admin.indexOf("querySelectorAll('[data-whbinlabel]')"));
  const refusal = binBox.slice(0, binBox.indexOf('return;'));
  check('a refused bin number is put back to what is saved',
    /input\.value = input\.defaultValue;/.test(refusal),
    'a box still reading "abc" looks as if it was kept');
}

/* ⚠ A SANDBOX THAT NEVER SETTLES MUST NOT EXIT GREEN. If the removal hangs (a second press
   waiting on the first, with no guard) node runs out of work and exits 0 without ever
   reaching the summary — a pass for the worst possible reason. */
let finished = false;
process.on('exit', function(){
  if(!finished){ console.log('\n  FAIL  the async removal checks never finished — a hung second removal'); process.exitCode = 1; }
});
function finish(){
finished = true;
console.log('\n=======================================================');
console.log('Warehouse note — ' + pass + ' passed, ' + fail + ' failed');
console.log('=======================================================\n');
if (fail) { failures.forEach(f => console.log('  - ' + f)); console.log(''); process.exit(1); }
}
