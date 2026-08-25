/*
 * What the crew is told is wrong — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-08-21: "were not using the employee portal this year... we are only
 * printing on schedules and warehouse."
 *
 * That ruling rescued the gate code, the side count and the outlet instruction onto
 * paper, because all three had only ever lived in the crew portal. THE FIX NOTE AND THE
 * FIX PHOTO WERE IN THE SAME POSITION AND WERE MISSED — for four days a Fixer Route
 * sheet printed
 *
 *     Cust # · Name · Bins · Address · City · Gate · Sides · Plugs/eaves · Timer · Notes
 *
 * and not one word about what was broken at any house on it. The office types "two
 * strands out on the front peak" into fixNote and photographs the fault; both render on
 * the Routes SCREEN, which nobody in a van is looking at. The crew drove out holding a
 * list of addresses.
 *
 * R-018 says not to add checks to run-all.js, so this follows the other gates: one
 * file, one job, wired into `npm test`.
 *
 * ⚠ IT RUNS THE REAL FUNCTIONS, lifted out of admin.html. This repo has been caught
 * three times in one day by checks that matched source text over code that could not
 * run — a sort behind an if(0), a price assignment behind an if(false), and a message
 * built and then overwritten by the line below it. A column is exactly that shape: the
 * heading can be present and correct while nothing ever fills the cell.
 *
 * ⚠ AND A COLUMN CHECK PROVES ONLY THE HEADING. That was red-checked on the bins work
 * the day before this one: deleting the recycle row's Bins CELL went straight through a
 * check that asserted the column. Every column here is checked twice — that it appears,
 * and that a real record fills it.
 *
 * Run:  node fix-sheet.test.js      (or: npm run test:fix)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* ⚠ \r?\n, NOT \n. admin.html is CRLF (measured: 48,167 of 48,167 lines) and a raw
   newline in an anchor matches nothing — the trap CLAUDE.md §7 names by hand. */
function fn(name) {
  const at = admin.indexOf('function ' + name + '(');
  if (at === -1) return '';
  const m = /\r?\n\}/.exec(admin.slice(at));
  return m ? admin.slice(at, at + m.index + m[0].length) : '';
}

const columnsSrc = (admin.match(/const PRINT_COLUMNS = \{[\s\S]*?\r?\n\};/) || [''])[0];
const fixColSrc  = (admin.match(/const PRINT_FIX_COLUMN = \{[^\n]*\};/) || [''])[0];

const sidesDefSrc = (admin.match(/const HOUSE_SIDES_DEFAULT = \d+;/) || [''])[0];

const NEEDED = ['printFixReason', 'printCrewColumns', 'printFixPhotos', 'printCrewRow',
                'printPhotosHtml', 'printCustData', 'printCrewNotes', 'printGateCode',
                'printSideCount', 'printYesNo', 'printBinCount', 'houseSideCount', 'esc'];
const missing = NEEDED.filter(n => !fn(n))
  .concat(columnsSrc ? [] : ['PRINT_COLUMNS'])
  .concat(fixColSrc ? [] : ['PRINT_FIX_COLUMN'])
  .concat(sidesDefSrc ? [] : ['HOUSE_SIDES_DEFAULT']);
if (missing.length) {
  console.log('\n  FAIL  cannot find in admin.html: ' + missing.join(', '));
  console.log('\n  A rename is a real change and this gate refuses to pass over one.');
  console.log('  Fix the name here in the same commit that renamed it.\n');
  process.exit(1);
}

/* ⚠ THREE THINGS ARE STUBBED AND ONLY THREE — crewHousesFor, whBinNumberFor and
   whBinNumberMoved. crewHousesFor reaches the whole season-planning module, and the two
   bin-label helpers reach whRecycleGroups and the entire archived-customer cache;
   lifting either would drag in the crew split, the town rules and the 48-hour lock to
   answer a question this gate is not asking. Both have their own coverage elsewhere
   (options-audit, and the recycle checks in run-all).

   ⚠ EVERYTHING THE GATE IS ACTUALLY ABOUT IS THE REAL CODE — and note that
   houseSideCount and HOUSE_SIDES_DEFAULT are LIFTED rather than stubbed even though
   this gate never asserts a side count. A stub makes the branch untestable while
   reporting green, and the first run of this file died on exactly that missing name.
   CLAUDE.md §3 has the long version: a green run does not prove a suite supplied its
   own dependencies. */
const sb = new Function(
  columnsSrc + fixColSrc + sidesDefSrc +
  fn('esc') + fn('printYesNo') + fn('houseSideCount') +
  fn('printGateCode') + fn('printSideCount') +
  fn('printBinCount') + fn('printCrewNotes') + fn('printFixReason') +
  fn('printCrewColumns') + fn('printCrewRow') + fn('printFixPhotos') +
  fn('printPhotosHtml') +
  'let HOUSES = [], CUST = {};' +
  'function crewHousesFor(){ return HOUSES; }' +
  'function whBinsForHouse(d){ return (d && d.numberOfBins) || 1; }' +
  'function whBinNumberFor(d){ return (d && d.customerNumber) || ""; }' +
  'function whBinNumberMoved(){ return false; }' +
  'function customerForHouse(h){ return {data: CUST[h.id] || {}}; }' +
  'function printCustData(h){ return (customerForHouse(h) || {}).data || {}; }' +
  'return {' +
  '  PRINT_COLUMNS, PRINT_FIX_COLUMN,' +
  '  reason: printFixReason, columns: printCrewColumns, row: printCrewRow,' +
  '  photos: printFixPhotos, photosHtml: printPhotosHtml,' +
  '  load: function(houses, cust){ HOUSES = houses; CUST = cust; }' +
  '};')();

const KEYS = c => c.map(x => x.k);

// ---------------------------------------------------------------------------
// 1. WHAT THE CELL SAYS
// ---------------------------------------------------------------------------
const STAMP = { seconds: 1756000000 };

const CASES = [
  ['a flagged house with a note prints the note',
   { needsFix: true, fixNote: 'two strands out on the front peak' },
   'two strands out on the front peak'],
  /* ⚠ Blank would read as "nothing wrong here" on a row that is on the sheet BECAUSE
     something is — the crew would skip it. "?" is this sheet's own word for
     nobody-said (printYesNo, and the master sheet's Up Plug column). */
  ['a flagged house with no note prints "?", never blank',
   { needsFix: true }, '?'],
  ['a note of nothing but spaces is no note',
   { needsFix: true, fixNote: '   ' }, '?'],
  /* ⚠ hlxMarkJobDone clears the flag and the note together. A note left behind on a
     mended house would send somebody back to it. */
  ['a house whose fix is done says nothing',
   { needsFix: false, fixNote: 'two strands out on the front peak' }, ''],
  ['an ordinary house says nothing', { name: 'Ordinary' }, ''],
  ['an empty record does not throw', {}, ''],
];

const rows = [];
CASES.forEach(([name, rec, want]) => {
  let got;
  try { got = sb.reason(rec); } catch (e) { got = 'THREW: ' + e.message; }
  rows.push([name, got, want]);
  check('cell — ' + name, got === want,
    'expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
});

// ---------------------------------------------------------------------------
// 2. WHEN THE COLUMN APPEARS — and that something fills it
// ---------------------------------------------------------------------------
const plain = [{ number: '12', name: 'Ordinary', fix: '' }];
const flagged = [{ number: '12', name: 'Ordinary', fix: '' },
                 { number: '14', name: 'Broken', fix: 'two strands out' }];

check('no fix on the sheet, no column',
  !KEYS(sb.columns(plain)).includes('fix'),
  'an empty column on ~950 install rows is width and ink for nothing');
check('one fix on the sheet, the column appears',
  KEYS(sb.columns(flagged)).includes('fix'));
check('and it sits before Notes, not after it',
  KEYS(sb.columns(flagged)).indexOf('fix') <
  KEYS(sb.columns(flagged)).indexOf('notes'),
  'the owner moved Timer in front of Notes for this reason: "anything put after it ' +
  'gets lost against a wall of writing"');
check('no other column is lost or reordered by adding it',
  KEYS(sb.columns(flagged)).filter(k => k !== 'fix').join(',') ===
  KEYS(sb.PRINT_COLUMNS.crew).join(','));
check('the base crew columns are not mutated by asking',
  !KEYS(sb.PRINT_COLUMNS.crew).includes('fix'),
  'splice on the real array would put the column on every sheet printed afterwards');
check('asking twice gives the same answer',
  KEYS(sb.columns(flagged)).join(',') === KEYS(sb.columns(flagged)).join(','));
check('an empty sheet does not throw', KEYS(sb.columns([])).length > 0);

/* ⚠ THE COLUMN IS DRIVEN BY THE ROWS, NOT BY day.isFixRoute, and this is the check
   that says so. A house flagged for a fix can sit on an ordinary install day — the crew
   is standing in front of it and the one sheet they hold should say what is wrong. */
check('a flagged house on an ordinary install day still gets the column',
  KEYS(sb.columns([{ fix: 'bulb out over the garage' }])).includes('fix'));
check('and printCrewColumns never reads a day at all',
  !/\bday\b/.test(fn('printCrewColumns')),
  'testing day.isFixRoute would miss a flagged house on an install day');

// ---------------------------------------------------------------------------
// 3. THE ROW ACTUALLY FILLS IT  (a column check proves only the heading)
// ---------------------------------------------------------------------------
sb.load([{ id: 'h1', cu: '', address: '', city: '' }],
        { h1: { customerNumber: '14', name: 'Broken', street: '9 Elm',
                needsFix: true, fixNote: 'two strands out on the front peak' } });
const built = sb.row({ id: 'h1', cu: '', address: '', city: '' });
check('the row carries the fix text',
  built.fix === 'two strands out on the front peak',
  'got ' + JSON.stringify(built.fix));
check('and it is not smuggled into Notes instead',
  !/two strands/.test(built.notes || ''),
  'Notes is the wide prose column; the reason for the visit needs its own');
check('the row still carries everything it carried before',
  ['number', 'name', 'bins', 'address', 'city', 'gate', 'sides', 'eaves', 'timer', 'notes']
    .every(k => k in built));

// ---------------------------------------------------------------------------
// 4. THE PHOTO
// ---------------------------------------------------------------------------
sb.load([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], {
  a: { customerNumber: '14', name: 'Broken', needsFix: true,
       fixPhotoUrl: 'https://res.cloudinary.com/x/fix-a.jpg' },
  b: { customerNumber: '15', name: 'No photo', needsFix: true },
  c: { customerNumber: '16', name: 'Mended', needsFix: false,
       fixPhotoUrl: 'https://res.cloudinary.com/x/fix-c.jpg' },
  d: { customerNumber: '17', name: 'Ordinary' },
});
const pics = sb.photos({}, 0);
check('the flagged house with a photo is printed',
  pics.length === 1 && /fix-a/.test(pics[0].url),
  'got ' + JSON.stringify(pics.map(p => p.url)));
check('a flagged house with no photo is skipped, not framed empty',
  !pics.some(p => !p.url),
  'a broken image frame is worse than no frame — the new-hang rule, same reasoning');
/* ⚠ Same gate as the column. A photo left on a mended house sends somebody back. */
check('a mended house does not print its old photo',
  !pics.some(p => /fix-c/.test(p.url)));
check('an ordinary house prints nothing', pics.length === 1);
check('the caption carries the number AND the name',
  pics[0].number === '14' && pics[0].name === 'Broken',
  'a photo nobody can match to a line on the sheet is decoration');

const html = sb.photosHtml(pics, 'What’s wrong — photos');
check('the block renders under its own heading',
  /What’s wrong/.test(html) && !/New hangs/.test(html),
  'one block headed "New hangs on this sheet" carrying a close-up of a dead strand ' +
  'is the heading lying about half its contents');
check('and the photo is really in it', /fix-a\.jpg/.test(html));
check('no photos renders nothing at all', sb.photosHtml([], 'What’s wrong') === '');

// ---------------------------------------------------------------------------
// 5. EVERY PRINTER THAT BUILDS A CREW SHEET USES BOTH
// ---------------------------------------------------------------------------
/* ⚠ THERE ARE THREE, AND THE BINS WORK PROVED WHAT HAPPENS WHEN ONLY ONE IS GUARDED:
   a red-check deleting the column from the OTHER build sheet passed, because the only
   check written was about PRINT_COLUMNS. Each site is named here. */
const SITES = [
  ['printDaySheet', 'the whole-day sheet — the one that gets cut in half and handed out'],
  ['printCrewSheetPage', 'a crew’s own sheet, and Print Today'],
];
SITES.forEach(([name, what]) => {
  const src = fn(name);
  check(name + ' asks for the conditional columns — ' + what,
    /printCrewColumns\(/.test(src) && !/PRINT_COLUMNS\.crew\b/.test(src),
    'a hard-coded PRINT_COLUMNS.crew here can never grow the column');
  check(name + ' prints the fix photos', /printFixPhotos\(/.test(src));
  check(name + ' still prints the new hangs’ photos', /printCrewPhotos\(/.test(src));
});
/* The unassigned block on the whole-day sheet is a third table in the same function —
   houses in neither crew's city, which still print. It must not be the one left behind. */
check('the in-neither-crew’s-city block gets the columns too',
  (fn('printDaySheet').match(/printCrewColumns\(/g) || []).length >= 2,
  'that block prints real houses and a fix flagged on one of them would vanish');
check('no crew sheet anywhere still hard-codes the plain columns',
  !/printTableHtml\([^)]*PRINT_COLUMNS\.crew\b/.test(admin));

// ---------------------------------------------------------------------------
// 6. THE FIELDS IT READS HAVE WRITERS
// ---------------------------------------------------------------------------
/* ⚠ A COLUMN READING A FIELD NOBODY WRITES prints the same blank for everybody and
   looks fine doing it — the Contact 2027 tab shipped exactly that way, reading
   `maybeNextYear` while portalRsvp wrote the status alone. Comments are stripped first:
   this file explains its own fields in prose, and a plain search finds the explanation
   and calls it a writer. */
const code = admin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
[['fixNote', 'the words'], ['fixPhotoUrl', 'the picture'], ['needsFix', 'the flag']]
  .forEach(([field, what]) => {
    check(field + ' is written somewhere (' + what + ')',
      new RegExp(field + '\\s*[:=]\\s*[^=]').test(code),
      'nothing writes it, so the column can only ever be empty');
  });

// ---------------------------------------------------------------------------
const w = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };
console.log('\n=== What the crew is told is wrong ===\n');
console.log('  ' + w('', 52) + w('prints', 36) + 'wanted');
rows.forEach(([name, got, want]) => {
  console.log('  ' + w(name, 52) + w(got === '' ? '—' : got, 36) +
    (got === want ? '' : '<-- WRONG'));
});
console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('A crew on a Fixer Route is given one piece of paper. If what is wrong');
  console.log('is not on it, they ring the office or they guess — and guessing at');
  console.log('somebody’s roofline is how the second visit happens.\n');
}
process.exit(fail ? 1 : 0);
