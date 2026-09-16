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

const parts = [lift('dupNormName'), lift('wireSweepClassify')];
check('both pieces were found in admin.html', parts.every(Boolean),
  'a gate that cannot find its target must never report green. Missing: ' +
  ['dupNormName', 'wireSweepClassify'].filter((n, i) => !parts[i]).join(', '));

let classify = null;
if (parts.every(Boolean)) {
  classify = new Function(parts.join('\n') + '\nreturn wireSweepClassify;')();
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
  const run = (list) => classify(list, sheet);

  /* ⛔ THE ONE IT EXISTS FOR: the sheet knows them and records no wire, so the White on
     their record is the assumption she refused. */
  eq('a White the sheet has no wire for is cleared',
    run([cust('a', { name: 'Someone', customerNumber: '27', wireColor: 'White' })]).clear.map(r => r.id),
    ['a']);

  /* ⚠ AND THE THREE THAT MUST NOT BE. */
  eq('a White the sheet also calls White is left alone',
    run([cust('b', { name: 'X', customerNumber: '14', wireColor: 'White' })]).clear, []);
  check('and it is counted as agreeing rather than silently dropped',
    run([cust('b', { name: 'X', customerNumber: '14', wireColor: 'White' })]).agrees === 1);

  const conf = run([cust('c', { name: 'Y', customerNumber: '20', wireColor: 'White' })]);
  eq('a White where the sheet says Green is a conflict, not a clear', conf.clear, []);
  eq('and the conflict names what the sheet says', conf.conflict.map(r => r.sheetWire), ['Green']);

  /* ⛔ THE SHEET BEING INCOMPLETE IS NOT EVIDENCE. Somebody added from a quote and never
     typed onto the sheet would otherwise be cleared on a gap in the wrong document. */
  const off = run([cust('d', { name: 'Not On It', customerNumber: '4242', wireColor: 'White' })]);
  eq('a customer with no sheet row at all is left alone', off.clear, []);
  eq('and is reported rather than silently skipped', off.notOnSheet.map(r => r.id), ['d']);

  /* ⛔ GREEN IS NEVER TOUCHED. The bug could only ever write White. */
  eq('a Green is never cleared, even with nothing on the sheet',
    run([cust('e', { name: 'Green Person', customerNumber: '27', wireColor: 'Green' })]).clear, []);
  eq('and a record with no wire at all is not touched either',
    run([cust('f', { name: 'Blank', customerNumber: '27', wireColor: '' })]).clear, []);

  /* ⚠ TWO CANDIDATES IS NO MATCH — this repo's own rule, and here it protects a stranger's
     record from being cleared on a shared name. */
  eq('an ambiguous name with no customer number is left alone',
    run([cust('g', { name: 'Two People', wireColor: 'White' })]).clear, []);
  eq('while a unique name with no number still matches',
    run([cust('h', { name: 'Jo Smith', wireColor: 'White' })]).clear.map(r => r.id), ['h']);

  /* ⚠ THE NUMBER WINS OVER THE NAME. A customer number is the one key meant to be unique;
     reading the name first would let a renamed row answer for somebody else. */
  eq('the customer number decides when both could match',
    run([cust('i', { name: 'Ann Lee', customerNumber: '27', wireColor: 'White' })]).clear.map(r => r.id),
    ['i']);

  /* ⚠ A MIXED BOOK SORTS INTO ALL FOUR LISTS IN ONE PASS, because a sweep that only ever
     sees one shape of record proves nothing about the one that matters. */
  const mixed = run([
    cust('1', { name: 'A', customerNumber: '27', wireColor: 'White' }),
    cust('2', { name: 'B', customerNumber: '14', wireColor: 'White' }),
    cust('3', { name: 'C', customerNumber: '20', wireColor: 'White' }),
    cust('4', { name: 'D', customerNumber: '777', wireColor: 'White' }),
    cust('5', { name: 'E', customerNumber: '27', wireColor: 'Green' })
  ]);
  eq('a mixed book sorts into clear / agrees / conflict / not-on-sheet',
    [mixed.clear.length, mixed.agrees, mixed.conflict.length, mixed.notOnSheet.length],
    [1, 1, 1, 1]);
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
check('clearing needs CLEAR actually typed, not merely mentioned',
  /!==\s*'CLEAR'/.test(wiring.slice(0, 4000)),
  'the confirmation no longer compares against CLEAR');
check('and the clear button is hidden until the dry run has run',
  /goBtn\.style\.display = 'none'/.test(wiring.slice(0, 4000)));

console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');
if (fail) {
  console.log('This sweep writes to customer records in bulk. Clearing a colour the office');
  console.log('really picked, or matching the wrong customer on a shared name, is not');
  console.log('something anybody would notice from a screen.\n');
}
process.exit(fail ? 1 : 0);
