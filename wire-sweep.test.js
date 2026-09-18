/*
 * Clearing a wire colour nobody wrote down — Highlighting Utah
 *
 * Addie, 2026-09-16, asked why 637 of 955 people have no wire colour on the master sheet:
 * "Blank means we just didn't put it in becuase there bin is already made and couldn't go
 * through each bin and sort out colors. But we will update it little at a time thats why we
 * don't want to automatically assume someone should be white."
 *
 * The portal's Changes tab used to prefill White whenever a record held nothing and write it
 * back on any save ([[OPT-11]]), so some records now claim a colour nobody picked — and on
 * screen that is indistinguishable from one the office chose. [[WH-35]] made the UNRECORDED
 * ones read "Check lights"; this sweep is the other half.
 *
 * WHY THIS IS ITS OWN GATE. Every way it can go wrong is a mass write to customer records:
 *
 *   - Clear a colour the office really did pick, because the sheet is merely incomplete.
 *   - Clear a GREEN, which the bug could never have written, destroying a real answer while
 *     tidying up after a different mistake.
 *   - Match the wrong customer on a shared name and clear a stranger's wire.
 *   - Or quietly match nobody at all and report "nothing to clear", which reads exactly like
 *     a clean book and is how this would look if the sheet reader broke.
 *
 * R-018 says not to add checks to run-all.js, so this is one file, one job.
 *
 * Run:  node wire-sweep.test.js      (or: npm run test:wiresweep)
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}
function eq(label, got, want) {
  check(label, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
/* Walks to the matching brace — CLAUDE.md §7 bans a fixed window and run-all enforces it. */
function lift(name) {
  let start = admin.indexOf('async function ' + name + '(');
  if (start < 0) start = admin.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let k = admin.indexOf('{', start), d = 0;
  for (; k < admin.length; k++) {
    if (admin[k] === '{') d++;
    else if (admin[k] === '}') { d--; if (!d) break; }
  }
  return admin.slice(start, k + 1);
}

console.log('\n=== Which list each customer lands in ===');

const parts = [lift('dupNormName'), lift('wireSweepSources'), lift('wireSweepClassify')];
check('both pieces were found in admin.html', parts.every(Boolean),
  'a gate that cannot find its target must never report green. Missing: ' +
  ['dupNormName', 'wireSweepSources', 'wireSweepClassify'].filter((n, i) => !parts[i]).join(', '));

let classify = null;
let sources = null;
if (parts.every(Boolean)) {
  classify = new Function(parts.join('\n') + '\nreturn wireSweepClassify;')();
  sources  = new Function(parts.join('\n') + '\nreturn wireSweepSources;')();
}

if (classify) {
  const sheet = {
    rowByNum: { '14': true, '20': true, '27': true, '99': true },
    wireByNum: { '14': 'White', '20': 'Green' },
    /* ⚠ THE KEYS ARE WHAT dupNormName REALLY RETURNS, not what the names look like: it
       SORTS the words and joins them with nothing, so "Jo Smith" is "josmith" and "Two
       People" is "peopletwo". The first draft of this fixture used spaced keys, matched
       nobody, and reported a clean book — which is the exact failure this gate exists to
       catch, caught here on the gate itself. */
    nameCount: { 'josmith': 1, 'annlee': 1, 'peopletwo': 2 },
    wireByName: { 'annlee': 'White' }
  };
  const cust = (id, data) => ({ id, data });
  /* ⭐ THE WAREHOUSE MAP, and by default EVERY fixture house is on the tab — otherwise every
     check above would be testing the scope rather than the rule it was written for. The
     scope gets its own checks below, where it can actually be broken. */
  const allOn = (list) => list.reduce((m, c) => (m[c.id] = true, m), {});
  const run = (list, src) => classify(list, sheet, src, allOn(list));

  /* ⭐ EVERY STORED White IS CLEARED (2026-09-17). Addie: "can we sweep all whites but in
     the future if they do save that they want white wire we will save it for [them]."
     ⚠ WIDER THAN THE FIRST VERSION, and the reason is [[OPT-12]]: that one cleared a White
     only where the sheet held a row with an empty Wire cell, which was a corroboration rule
     written while the belief was that ONE door had invented the colour. Five had. A stored
     White is not evidence of anything, so there is nothing left worth corroborating — and
     these checks are REVERSED rather than deleted so the reversal is deliberate and visible. */
  eq('a White the sheet has no wire for is cleared',
    run([cust('a', { name: 'Someone', customerNumber: '27', wireColor: 'White' })]).clear.map(r => r.id),
    ['a']);
  eq('a White the sheet ALSO calls White is cleared too — this is the reversal',
    run([cust('b', { name: 'X', customerNumber: '14', wireColor: 'White' })]).clear.map(r => r.id),
    ['b']);
  check('and the sheet agreeing is still counted, because it is what the sweep costs',
    run([cust('b', { name: 'X', customerNumber: '14', wireColor: 'White' })]).sheetSaysWhite === 1,
    'a breakdown is the only thing left saying how many real answers go with the invented ones');

  const conf = run([cust('c', { name: 'Y', customerNumber: '20', wireColor: 'White' })]);
  eq('a White where the sheet says Green is cleared as well', conf.clear.map(r => r.id), ['c']);
  eq('and it is named, so Compare can put the real colour back',
    conf.sheetSaysOther.map(r => r.sheetWire), ['Green']);

  const off = run([cust('d', { name: 'Not On It', customerNumber: '4242', wireColor: 'White' })]);
  eq('a customer the sheet has never heard of is cleared too', off.clear.map(r => r.id), ['d']);
  check('and counted', off.notOnSheet === 1);

  /* ⭐ A WHITE THEY PICKED ON THEIR QUOTE IS KEPT — AND ONLY THAT (2026-09-17, [[OPT-18]]).
     Addie, after the member-portal half had been built and its one weakness was put to her:
     "just get rid of all whites then unless its a quote or requote."
     ⛔ THE PORTAL EXEMPTION EXISTED FOR ONE COMMIT AND IS GONE ON PURPOSE. Its trail — the
     `Wire Color Change` Inbox message — cannot tell a customer's answer from the bug,
     because the portal ALSO invented White ([[OPT-11]]) and saving that wrote the very same
     message. Keeping on it would spare records nobody chose while CALLING them chosen.
     ⭐ A QUOTE CAN TELL, which is the whole reason this one survives: that form's default
     was `Any`, on the browser and on the server alike, so a White on a quote is a customer
     ticking White. */
  {
    const q = (custId, wire) => ({ id: 'q' + custId, data: { existingCustomerId: custId, wireColor: wire } });
    const book = [
      cust('office',   { name: 'Office One', customerNumber: '27', wireColor: 'White', phone: '8015550001' }),
      cust('quoted',   { name: 'Quote Two',  customerNumber: '27', wireColor: 'White', phone: '8015550002' }),
      cust('requoted', { name: 'Req Three',  customerNumber: '27', wireColor: 'White', phone: '8015550003' }),
      cust('portal',   { name: 'Portal Four',customerNumber: '27', wireColor: 'White', phone: '8015550004' }),
      cust('anyquote', { name: 'Any Five',   customerNumber: '27', wireColor: 'White', phone: '8015550005' }),
      cust('oldlink',  { name: 'Old Six',    customerNumber: '27', wireColor: 'White', phone: '8015550006' })
    ];
    const src = sources([
      q('quoted', 'White'),
      /* a RE-quote is an ordinary second quote against the same record */
      q('requoted', 'Green'), { id: 'q9', data: { existingCustomerId: 'requoted', wireColor: 'White' } },
      /* ⛔ `Any` IS NOT A CHOICE. It was the form's own default, so it is exactly the
         customer not answering — the case the whole sweep exists for. */
      q('anyquote', 'Any'),
      /* ⚠ THE OLDER LINK FIELD. Quotes raised before `existingCustomerId` replaced it carry
         `convertedToCustomerId`; reading one spelling sweeps everybody converted earlier. */
      { id: 'q10', data: { convertedToCustomerId: 'oldlink', wireColor: 'White' } }
    ]);
    const out = classify(book, sheet, src, allOn(book));
    eq('a White nobody picked on a quote is cleared',
      out.clear.map(r => r.id), ['office', 'portal', 'anyquote']);
    eq('a White on their quote or a re-quote is kept',
      out.keptQuote.map(r => r.id), ['quoted', 'requoted', 'oldlink']);
    /* ⛔ THE REVERSAL, ASSERTED RATHER THAN LEFT AS AN ABSENCE. A portal-sourced White is
       swept now; a check that merely stopped mentioning the portal would pass whether the
       exemption had been removed or quietly left in. */
    check('a White changed in the Member Portal is NOT kept any more',
      out.clear.some(r => r.id === 'portal') && !('keptPortal' in out),
      'the portal invented White too, so its trail cannot tell an answer from the bug');

    /* ⚠ AND NO SOURCES AT ALL FALLS BACK TO SWEEPING, not to keeping. A caller that forgets
       to pass them must not silently spare the whole book — the sweep would look like it
       ran and changed nothing. */
    const bare = classify(book, sheet, null, allOn(book));
    eq('with no provenance supplied, nothing is kept',
      [bare.clear.length, bare.keptQuote.length], [6, 0]);
  }

  /* ⭐ AND ONLY THE HOUSES IN THE WAREHOUSE RIGHT NOW (2026-09-17, [[OPT-19]]). Addie,
     reading a dry run that listed most of the book: "it looks like its everyone that has
     whites that we would loose there whites. I only want people that are currently in
     warehouse with white lights to be refreshed."
     ⭐ A wrong wire colour only costs anything to somebody about to MAKE a bundle — those are
     the houses where Check lights gets answered, because a person is already at the shelf.
     Clearing the rest asks a question nobody is in a position to answer. */
  {
    const book = [
      cust('inwh',  { name: 'In Warehouse', customerNumber: '27', wireColor: 'White' }),
      cust('notwh', { name: 'Not In It',    customerNumber: '27', wireColor: 'White' })
    ];
    const scoped = classify(book, sheet, { quoteWhite: {} }, { inwh: true });
    eq('only a house in the warehouse is cleared', scoped.clear.map(r => r.id), ['inwh']);
    check('and the rest are counted, not silently dropped', scoped.notInWarehouse === 1,
      'a sweep that names only the handful it touches reads as though the rest of the book ' +
      'had no White on it — the point of the scope is that those are LEFT, not missed');

    /* ⛔ A MISSING MAP SWEEPS NOBODY, NOT EVERYBODY. A caller that forgets the argument must
       not clear the whole book: that is the one mistake here with no undo, and failing the
       other way would look exactly like the sweep working. */
    const noMap = classify(book, sheet, { quoteWhite: {} });
    eq('with no warehouse map at all, nothing is cleared', noMap.clear, []);
    check('and every one of them is reported as out of scope', noMap.notInWarehouse === 2);

    /* ⚠ THE SCOPE IS ASKED FIRST, so a kept-on-quote count can never include somebody who is
       not even on the tab — the report would otherwise say it spared houses nobody was
       going to touch. */
    const q = { quoteWhite: { notwh: true } };
    const order = classify(book, sheet, q, { inwh: true });
    eq('a quote does not drag somebody back into scope', order.keptQuote, []);
    eq('and they are still counted as out of the warehouse', order.notInWarehouse, 1);
  }

  /* ⚠ AND THE MAP COMES FROM THE TAB'S OWN ANSWER, not a second opinion. A sweep that
     decided for itself who is in the warehouse is how it and the screen it is named after
     start disagreeing — the fault this whole thread has been about. */
  {
    const onSrc = stripComments(lift('wireSweepOnWarehouse'));
    check('the warehouse map was found', !!onSrc);
    check('and it asks whBuildQueueGroups rather than reading flags itself',
      /whBuildQueueGroups\(\)/.test(onSrc) && !/needsLightBuild/.test(onSrc),
      'testing needsLightBuild here would be a second definition of "in the warehouse"');
    check('and it builds the queue ONCE, not per customer',
      (onSrc.match(/whBuildQueueGroups\(\)/g) || []).length === 1,
      'whHouseBuildStatus answers this for one house by building the whole queue — asking ' +
      'it per customer is the ~950,000-comparison shape this repo already locked a screen on');
    /* ⚠ REPOINTED 2026-09-18, NOT WEAKENED ([[WH-41]]). It asked for `blocked` as well,
       which was the siding a house with no colours used to sit on. There is no siding: such
       a house heads a Check lights group and comes through the group walk above, so the
       coverage is unchanged and one of the three names simply no longer exists. */
    check('and it includes both timer lists as well as the groups',
      /timerHouses/.test(onSrc) && /timerRemovals/.test(onSrc) &&
      /\(g\.houses \|\| \[\]\)/.test(onSrc),
      'those houses are on the tab in front of somebody, which is exactly where a wrong ' +
      'wire is worth correcting');
  }

  /* ⛔ GREEN IS NEVER TOUCHED ([[OPT-13]]). Addie: "If they are in the green categorie than
     we will not worry about those." Nothing in the app has ever written Green by itself, so
     a Green was typed by a person — that asymmetry is the whole argument for why sweeping
     every White is safe and sweeping every wire colour would not be. */
  eq('a Green is never cleared, whatever the sheet says',
    run([cust('e', { name: 'Green Person', customerNumber: '27', wireColor: 'Green' })]).clear, []);
  eq('and a record with no wire at all is not touched either',
    run([cust('f', { name: 'Blank', customerNumber: '27', wireColor: '' })]).clear, []);
  /* ⚠ AND NOT A LOOK-ALIKE. Only the exact stored word, trimmed — 'Whitish' or 'off white'
     is somebody's own note and clearing it would be the invented-colour mistake in reverse. */
  eq('a wire colour that merely contains the word white is left alone',
    run([cust('g2', { name: 'Odd', customerNumber: '27', wireColor: 'Off White' })]).clear, []);
  eq('while a White with stray spaces is still cleared',
    run([cust('h2', { name: 'Spaced', customerNumber: '27', wireColor: '  White  ' })]).clear.map(r => r.id),
    ['h2']);

  /* ⭐ AND IT NEEDS NO SHEET AT ALL, which is what finally makes it usable on her machine:
     the sheet decides nothing now, so a null one costs the breakdown and nothing else. */
  const noSheetBook = [
    cust('n1', { name: 'A', customerNumber: '27', wireColor: 'White' }),
    cust('n2', { name: 'B', wireColor: 'Green' })
  ];
  const noSheet = classify(noSheetBook, null, { quoteWhite: {} }, allOn(noSheetBook));
  eq('with no sheet at all, every White is still cleared', noSheet.clear.map(r => r.id), ['n1']);
  check('and Green is still safe, and the breakdown is simply empty',
    noSheet.sheetSaysWhite === 0 && noSheet.sheetSaysNothing === 0 &&
    noSheet.sheetSaysOther.length === 0 && noSheet.notOnSheet === 0,
    'a breakdown invented without a sheet would read as corroboration nobody has');

  /* ⚠ THE AMBIGUOUS-NAME RULE SURVIVES, and it now protects the BREAKDOWN rather than the
     decision — counting a stranger's row as agreement would overstate what the sweep costs. */
  const amb = run([cust('g', { name: 'Two People', wireColor: 'White' })]);
  eq('an ambiguous name is still cleared, because every White is', amb.clear.map(r => r.id), ['g']);
  check('but it counts as not-on-the-sheet rather than as agreement',
    amb.notOnSheet === 1 && amb.sheetSaysWhite === 0,
    'two candidates is no match — this repo\'s own rule, applied to the count');

  /* ⚠ THE NUMBER WINS OVER THE NAME. A customer number is the one key meant to be unique;
     reading the name first would let a renamed row answer for somebody else. */
  const both = run([cust('i', { name: 'Ann Lee', customerNumber: '27', wireColor: 'White' })]);
  check('the customer number decides the breakdown when both could match',
    both.sheetSaysNothing === 1 && both.sheetSaysWhite === 0,
    'by number #27 records nothing; by name Ann Lee says White');

  /* ⚠ A MIXED BOOK: every White cleared, Green untouched, and the breakdown adding up. */
  const mixed = run([
    cust('1', { name: 'A', customerNumber: '27', wireColor: 'White' }),
    cust('2', { name: 'B', customerNumber: '14', wireColor: 'White' }),
    cust('3', { name: 'C', customerNumber: '20', wireColor: 'White' }),
    cust('4', { name: 'D', customerNumber: '777', wireColor: 'White' }),
    cust('5', { name: 'E', customerNumber: '27', wireColor: 'Green' })
  ]);
  eq('a mixed book clears all four Whites and leaves the Green',
    [mixed.clear.length, mixed.sheetSaysNothing, mixed.sheetSaysWhite,
     mixed.sheetSaysOther.length, mixed.notOnSheet],
    [4, 1, 1, 1, 1]);
  check('and the breakdown accounts for every cleared record, none twice',
    mixed.sheetSaysNothing + mixed.sheetSaysWhite + mixed.sheetSaysOther.length +
    mixed.notOnSheet === mixed.clear.length,
    'a breakdown that does not add up to the list is one nobody can check');
}

console.log('\n=== It only ever clears, and says so in code ===');

const findSrc = stripComments(lift('wireSweepFind'));
const clearSrc = stripComments(lift('wireSweepClear'));
check('the sweep and its writer were both found', !!findSrc && !!clearSrc);
/* ⛔ NOTHING HERE MAY WRITE A WIRE COLOUR ONTO ANYBODY. The whole point is to stop a colour
   being claimed; a sweep that could SET one would be the original bug with a button. */
check('the writer only ever clears the field, never sets a colour',
  /wireColor:\s*''/.test(clearSrc) && !/wireColor:\s*'(White|Green)'/.test(clearSrc),
  clearSrc.slice(0, 300));
check('and it writes nothing but wireColor',
  (clearSrc.match(/updateDoc\(/g) || []).length === 1 &&
  !/needsLightBuild|lightsDescription|customerNumber/.test(clearSrc),
  'it touches more than the one field');
/* ⚠ ONLY WHAT THE DRY RUN SHOWED. Re-finding at write time would clear records she never
   saw, which is the whole reason they are listed first — the test sweep's own rule. */
check('the writer walks the list it was handed rather than looking again',
  /found\.clear/.test(clearSrc) && !/wireSweepFind\(/.test(clearSrc),
  'it re-finds at write time');

const markup = admin.replace(/<!--[\s\S]*?-->/g, ' ');
['cWireSweepDryBtn', 'cWireSweepBtn', 'cWireSweepReport'].forEach(function (id) {
  check('the card has its ' + id + ' control', markup.indexOf('id="' + id + '"') !== -1);
});
/* ⚠ A MASS WRITE IS TYPE-TO-CONFIRM, like every other one in this app. */
const wiring = stripComments(admin.slice(admin.indexOf('(function wireWireSweep(')));
/* ⚠ THE COMPARISON, NOT THE WORD. The first version matched /CLEAR/, which the prompt's
   own sentence ("Type CLEAR to go ahead") satisfies — so deleting the guard and leaving the
   instruction behind passed. Suite 58's lesson: a check must read the code, not the prose
   beside it. Caught by the red-check as the one sabotage that got through. */
/* ⚠ SLICED TO A REAL ANCHOR, NOT 4000 CHARACTERS. §7 bans a fixed-length extraction window
   by name and run-all enforces it, and this pair had one — which went stale the moment the
   report grew, failing on code that was right. Cut at the end of the IIFE instead. */
const wiringAll = (function () {
  const at = admin.indexOf('(function wireWireSweep(');
  if (at < 0) return '';
  let d = 0, k = admin.indexOf('{', at);
  for (;; k++) { if (admin[k] === '{') d++; else if (admin[k] === '}') { d--; if (!d) break; } }
  return stripComments(admin.slice(at, k + 1));
})();
check('the sweep wiring was found whole', !!wiringAll && wiringAll.length > 1000);
check('clearing needs CLEAR actually typed, not merely mentioned',
  /!==\s*'CLEAR'/.test(wiringAll),
  'the confirmation no longer compares against CLEAR');
check('and the clear button is hidden until the dry run has run',
  /goBtn\.style\.display = 'none'/.test(wiringAll));
/* ⭐ AND WHAT IS KEPT IS NAMED ON SCREEN, not merely counted. The whole of her rule is that
   some of these Whites are somebody's own answer, so she has to be able to SEE which — a
   sweep that only says how many it spared is one nobody can check. */
check('the report names the ones it kept, not just how many',
  /names\(pending\.keptQuote\)/.test(wiringAll),
  'a count alone cannot be checked against anything');
/* ⛔ AND THE PORTAL IS NOT OFFERED AS A REASON ANY MORE — asserted, because a leftover
   "Changed in the Member Portal" block would tell her records were spared for a reason the
   rule no longer applies. */
check('and it no longer claims anything was kept for the Member Portal',
  !/keptPortal/.test(wiringAll),
  'that exemption was removed: the portal invented White too');
/* ⛔ AND THE TRAIL IT RESTED ON IS NOT READ AT ALL. Asserted on `wireSweepSources` rather
   than on the classifier, because the red-check showed why: putting the `portalWhite` branch
   back into the classifier alone is a NO-OP — nothing supplies that key, so the branch can
   never fire and the sabotage passed. What would really bring the exemption back is this
   function scanning the Inbox again, so that is what must stay gone. */
const srcFn = stripComments(lift('wireSweepSources'));
check('and the sweep no longer reads the Inbox for a wire change at all',
  !/Wire Color Change/.test(srcFn) && !/messages/i.test(srcFn),
  'the portal message cannot tell a customer\'s answer from the invented White, so ' +
  'reading it is what would spare records nobody chose while calling them chosen');
check('it looks only at quotes', /quotes/.test(srcFn) && /wireColor/.test(srcFn), srcFn.slice(0, 200));

/* =========================================================================
   EITHER ROUTE IN — the connected file, or the pasted sheet
   ⭐ Addie, 2026-09-17: "The master sheet won't add", and the screen was telling her why:
   connecting a FILE needs window.showOpenFilePicker, which exists in Chrome and Edge on a
   computer and nowhere else. The first version of this sweep asked for a file handle alone,
   so on her machine it was unreachable — and said so in words that read like a missing step
   rather than a browser she cannot change. Compare has always taken a paste.
   ⚠ RUN, NOT READ. Every claim here is about which source a function REACHES FOR and what
   it does when that source is not there; a regex cannot see a fallback that never fires.
   ========================================================================= */
console.log('\n=== It reads whichever sheet she has to hand ===');
const pendingAsync = [];
{
  const rowsSrc = lift('wireSweepSheetRows');
  check('the sheet reader was found to run', !!rowsSrc);

  /* A grid the way rbParseSheetGrid really returns one: a title line ABOVE the headings,
     because a sheet that opens with one is exactly what rbFindHeadingRow exists for. */
  const PASTED = [
    ['2026 Client List', '', '', ''],
    ['CU #', 'Name', 'Wire', 'Phone'],
    ['14', 'Jo Smith', 'White', '8015550001'],
    ['20', 'Pat Jones', '', '8015550002']
  ];
  function build(opts) {
    const o = opts || {};
    const asked = { handleLoads: 0, files: 0 };
    const fn = new Function(
      'hlxSheetSupported', 'hlxSheetHandleLoad', 'hlxSheetPermission',
      'hlxWorkbookRowsAllSheets', 'document', 'rbParseSheetGrid', 'rbFindHeadingRow',
      'return ' + rowsSrc + ';wireSweepSheetRows')(
      () => o.supported !== false,
      async () => { asked.handleLoads++; return o.handle === undefined ? { getFile: async () => ({}) } : o.handle; },
      async () => o.permission || 'granted',
      async () => { asked.files++; return { rows: o.fileRows || [['CU #', 'Name', 'Wire']] }; },
      { getElementById: () => (o.pasted === undefined ? null : { value: o.pasted }) },
      () => (o.pasted ? PASTED : []),
      g => (g.length ? { index: 1, match: { mapped: ['a', 'b'] } } : null)
    );
    return { fn, asked };
  }

  /* ⚠ ONE AWAITED BLOCK, NOT nested setTimeouts. The first draft scored these AFTER the
     summary had printed and process.exit had run — eight checks that could never fail the
     build, which is the trap CLAUDE.md names by name about Suite 10. */
  pendingAsync.push((async () => {
    /* 1. A connected file still wins, and the paste is not even looked at. */
    const b1 = build({ fileRows: [['CU #', 'Name', 'Wire'], ['14', 'Jo Smith', 'White']], pasted: 'x' });
    const r1 = await b1.fn();
    check('a connected file is still what it reads when there is one',
      r1.rows.length === 2 && b1.asked.files === 1, JSON.stringify(r1));
    check('and it says so, so a stale paste can never be mistaken for the live file',
      /connected on this computer/.test(r1.from), r1.from);

    /* 2. ⛔ THE CASE SHE HIT. No showOpenFilePicker at all — a tablet, or Safari. */
    const b2 = build({ supported: false, pasted: 'x' });
    const r2 = await b2.fn();
    check('a browser that cannot hold onto a file falls back to the pasted sheet',
      r2.rows.length === 3, JSON.stringify(r2));
    check('and it never even asks for a handle it cannot have',
      b2.asked.handleLoads === 0 && b2.asked.files === 0,
      'asking IndexedDB for a handle on a browser with no picker is a wasted round trip, ' +
      'and in a stack trace it reads like the feature half working');
    /* ⚠ THE HEADINGS ARE FOUND WHEREVER THEY SIT. Slicing from row 0 would make the title
       line the header and every column name would come back blank. */
    check('and the headings are found wherever they sit, not assumed to be row one',
      r2.rows[0][1] === 'Name', JSON.stringify(r2.rows[0]));
    check('and it says it read the pasted one', /pasted/.test(r2.from), r2.from);

    /* 3. Neither one. It must REFUSE, and name both ways in — not send her to a button
       that does not exist in her browser, which is what the first version did. */
    let r3 = null, t3 = null;
    try { r3 = await build({ supported: false, pasted: undefined }).fn(); }
    catch (e) { t3 = e; }
    check('with neither a file nor a paste it refuses rather than sweeping nothing',
      !r3 && !!t3, JSON.stringify(r3));
    check('and the refusal names BOTH ways in, including the one that works on a tablet',
      !!t3 && /paste/i.test(t3.message) && /Use my master sheet/.test(t3.message),
      'the first version named only the button: ' + (t3 && t3.message));
  })());
}

/* ⚠ A WIRE COLUMN THAT ARRIVED EMPTY NO LONGER REFUSES THE SWEEP — it decides nothing now
   — but it must not be reported as CORROBORATION either. Hidden, filtered out, or a copy
   that stopped short all give a Wire heading with nothing under it, and a breakdown built on
   that reads as though the office had recorded nothing for anybody.
   ⚠ THE PREVIOUS VERSION OF THIS CHECK WENT VACUOUS THE MOMENT THE GUARD STOPPED THROWING,
   and it is worth knowing how: it asserted `indexOf('not one wire colour') < indexOf(...)`,
   and indexOf returns -1 for a phrase that is GONE — so -1 < anything passed, for ever, on a
   guard that no longer existed in that form. Compare against -1 explicitly, or assert what
   must be true rather than where a string sits. */
{
  const findSrcRaw = stripComments(lift('wireSweepFind'));
  const emptyAt = findSrcRaw.indexOf('!Object.keys(wireByName).length && !Object.keys(wireByNum).length');
  check('the empty-Wire-column case is still recognised', emptyAt !== -1,
    'an empty column must still be told apart from a sheet that genuinely records none');
  const noteAt = findSrcRaw.indexOf('sheetNote =', emptyAt);
  check('and it is reported as no comparison, not as agreement',
    emptyAt !== -1 && noteAt !== -1 && noteAt - emptyAt < 400,
    'it has to set sheetNote inside that branch, or the breakdown claims corroboration ' +
    'from a column that never arrived');
  check('and it no longer refuses the sweep over it',
    !/throw new Error\([^)]*not one wire colour/.test(findSrcRaw),
    'the sheet decides nothing now, so refusing over it would block a sweep that does not need it');
  /* ⭐ AND THE SHEET IS OPTIONAL END TO END. A sheet it cannot read costs the breakdown and
     nothing else — the half that makes this usable where a file handle is impossible. */
  check('a sheet that cannot be read is caught and the sweep still runs',
    /catch\s*\(err\)\s*\{[\s\S]{0,400}sheetNote =/.test(findSrcRaw) &&
    findSrcRaw.indexOf('wireSweepClassify(') > findSrcRaw.indexOf('catch'),
    'a throw here would put the whole tool back behind a sheet she cannot always connect');
  check('and what went wrong is said, never swallowed',
    /err && err\.message/.test(findSrcRaw),
    '"nothing should fail quietly" — a missing breakdown must not read as a sheet that agreed');
check('and the report says which sheet it actually read',
    /sheetFrom/.test(stripComments(admin.slice(admin.indexOf('(function wireWireSweep(')))),
    'reading a stale paste and a live file must never look identical on screen');
}

Promise.all(pendingAsync).then(function () {
console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');
if (fail) {
  console.log('This sweep writes to customer records in bulk. Clearing a colour the office');
  console.log('really picked, or matching the wrong customer on a shared name, is not');
  console.log('something anybody would notice from a screen.\n');
}
process.exit(fail ? 1 : 0);
});
