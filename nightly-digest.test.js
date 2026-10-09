/* THE NIGHTLY-RUN READER CANNOT WRITE, AND CANNOT NAME ANYBODY
 * ============================================================
 * `npm run test:nightly-read`. Its own file per R-018.
 *
 * `nightly-digest.js` runs in GitHub Actions as the service account that deploys
 * the Cloud Functions, so it can write ANYTHING in this project — including
 * billing people. A tool you run to find out whether customers were billed must
 * not be able to bill them. The only thing standing between that account and
 * that script is this gate.
 *
 * ⛔ THE GUARANTEE IS STATED AS A SHAPE, NOT AS A BAN ON VERBS, and
 * error-digest.test.js already paid for that lesson: its first draft banned
 * `.set(`, `.add(` and `.delete(` outright and FAILED ON CORRECT CODE, because
 * `groups.set(key, g)` is a Map — Map and Set carry all three names, so a
 * blanket ban can never be both sound and complete. It forbids ordinary
 * JavaScript while a real write still arrives under a name nobody listed.
 * ⭐ Every Firestore write needs a reference, and every reference here comes
 * from `db`. So each use of `db` is pinned to a read shape and COUNTED. That
 * reader needed one use and could assert "exactly once"; this one reads four
 * collections, so the census is four exact expressions — adding a fifth is a
 * deliberate edit here, which is the point.
 *
 * ⛔ AND IT NAMES NOBODY, which is [[PROC-36]]'s ruling and not a nicety: a run
 * log carries `noEmailNames` and `heldNames`, which are real customers, and the
 * output lands in an Actions log anybody with repo access can read. The script
 * may count them; it may never print them.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SCRIPT = path.join(ROOT, 'nightly-digest.js');
const WORKFLOW = path.join(ROOT, '.github/workflows/nightly-digest.yml');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

if (!fs.existsSync(SCRIPT)) {
  console.log('  NOTE  nightly-digest.js is not in this checkout — nothing to gate, exit 0.');
  process.exit(0);
}
const code = fs.readFileSync(SCRIPT, 'utf8');
/* Comments are stripped before anything is judged. This file's own prose quotes the
   very API names it forbids, and so does the script's header — the Suite 58 trap, which
   five separate gates in this repo have each had to learn the hard way. */
const live = code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

console.log('');
console.log('--- It cannot write ---');
console.log('');

/* THE CENSUS. Four reads, each pinned to its exact shape. A write needs a reference and
   every reference comes from `db`, so if all four uses are `.get()` reads, a write is
   unreachable whatever it is called. */
const READS = [
  ["the nightly switch", /\bdb\s*\.collection\(\s*'settings'\s*\)\s*\.doc\(\s*'nightlyInvoiceAutomation'\s*\)\s*\.get\(\s*\)/],
  ["the run log",        /\bdb\s*\.collection\(\s*'nightlyInvoiceLog'\s*\)\s*\.get\(\s*\)/],
  ["the customers",      /\bdb\s*\.collection\(\s*'jobAddresses'\s*\)\s*\.limit\([^)]*\)\s*\.get\(\s*\)/],
  ["the templates",      /\bdb\s*\.collection\(\s*'emailTemplates'\s*\)\s*\.get\(\s*\)/],
  /* The fifth read, added 2026-10-08 for the failed payment receipts. It is a
     deliberate line in this list exactly as the note above demands — that is what
     stops a WRITE ever arriving as "one more use of db". */
  ["the invoices",       /\bdb\s*\.collection\(\s*'invoices'\s*\)\s*\.limit\([^)]*\)\s*\.get\(\s*\)/]
];
for (const [what, re] of READS) {
  check('reads ' + what + ', as a .get() and nothing else', re.test(live),
    'if this stops being a plain read the read-only guarantee is gone');
}
const dbUses = live.match(/\bdb\s*\./g) || [];
check('and uses the database handle exactly ' + READS.length + ' times, no more',
  dbUses.length === READS.length,
  'found ' + dbUses.length + '. A census, not a ceiling: a fifth read is fine, but it ' +
  'is a deliberate edit to this list — which is what stops a write arriving as "one more use".');

check('the database is opened once and never reopened',
  (live.match(/admin\s*\.\s*firestore\s*\(/g) || []).length === 1,
  'a second handle would sidestep the census above');

/* These have no innocent meaning in JavaScript, unlike set/add/delete, so a blanket ban
   on them IS sound. Belt to the braces above, never the guard itself. */
const WRITE_ONLY = ['FieldValue', 'writeBatch(', 'runTransaction', 'bulkWriter', '.commit(', 'recursiveDelete'];
for (const w of WRITE_ONLY) {
  check('no "' + w + '" anywhere in it', live.indexOf(w) === -1,
    'these have no read meaning; one appearing means a write path was added');
}
check('nothing is imported that could write on its own',
  (live.match(/\brequire\(/g) || []).length === 1 && /require\('firebase-admin'\)/.test(live),
  'one import, and it is the client this reads through');

console.log('');
console.log('--- It names nobody ---');
console.log('');

/* ⛔ THE RUN LOG CARRIES CUSTOMERS. `noEmailNames` and `heldNames` are arrays of real
   people, put there so the OFFICE can chase them. Counting them is the useful half and
   printing them is the harm, so the script may touch `.length` and nothing else. */
for (const field of ['heldNames', 'noEmailNames']) {
  const uses = (live.match(new RegExp('\\b' + field + '\\b', 'g')) || []).length;
  const lengthOnly = (live.match(new RegExp('\\b' + field + '(\\s*\\)\\s*)?\\s*(\\.length|\\))', 'g')) || []).length;
  const joined = new RegExp('\\b' + field + '\\b[^\\n]*(\\.join|\\.slice|\\.map|\\.forEach|say\\()').test(live);
  check(field + ' is only ever counted, never printed',
    uses === 0 || (!joined && uses <= lengthOnly + 1),
    'uses=' + uses + ' lengthOnly=' + lengthOnly + ' printed=' + joined +
    '. PROC-36: who hit a fault belongs in the admin portal, not in an Actions log ' +
    'that anybody with repo access can read.');
}
/* ⛔ AN INVOICE CARRIES A NAME AND AN EMAIL ADDRESS, which is why the receipt section
   groups by REASON and counts. The banner in admin already names the affected customers,
   to the one person entitled to read it; this output is an Actions log. */
for (const field of ['inv.name', 'invoice.name', 'd.name']) {
  check('the receipt section never reads "' + field + '" off an invoice', live.indexOf(field) === -1,
    'group by the reason and count the people — PROC-36');
}
check('an invoice email address is only ever TESTED, never printed',
  !/say\([^\n]*inv\.email/.test(live),
  'the count of customers with no address on file is the useful half; the address is the harm');
/* ⛔ THIS ONE IS RUN, NOT MATCHED, and a red-check is why. The text version asserted
   that the word "byReason" appeared; deleting the Map LOOKUP — so every failure forms
   a group of its own and one fault prints as forty-one rows of one — sailed straight
   through it. The whole value of the section is that it can tell ONE cause from FORTY-ONE,
   so that is the claim, and only running it can hold it. */
(function runTheGrouping() {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const cut = (name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0, started = false;
    for (let j = src.indexOf('{', i); j < src.length; j++) {
      if (src[j] === '{') { d++; started = true; }
      else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
    }
    return null;
  };
  const body = cut('groupReceiptFailures');
  check('groupReceiptFailures is its own function, so this gate can run it', !!body,
    'inline, the only testable claim is that a word appears — which a red-check proved worthless');
  if (!body) return;
  let group;
  try {
    /* when/scrub are lifted from the script too, never re-written here: a second copy of
       the scrubber would prove the copy works and say nothing about the code that runs. */
    const whenSrc = src.slice(src.indexOf('const when = ts =>'), src.indexOf('*/', src.indexOf('const when = ts =>')) === -1 ? undefined : undefined);
    const deps = src.slice(src.indexOf('const when = ts =>'), src.indexOf('(async function main'));
    group = new Function(deps + '\n' + body + '\nreturn groupReceiptFailures;')();
  } catch (e) {
    check('the grouping rule can be lifted and run', false, e.message);
    return;
  }
  /* ONE fault, three customers, three different dollar amounts in the text — the real
     shape of a bulk import failing. It must come back as ONE row of 3. */
  const oneFault = [
    { receiptError: 'The email service rejected the payment receipt: quota of 200 exceeded. Paid $250.00', email: 'a@x.com' },
    { receiptError: 'The email service rejected the payment receipt: quota of 200 exceeded. Paid $475.50', email: 'b@x.com' },
    { receiptError: 'The email service rejected the payment receipt: quota of 200 exceeded. Paid $90.00',  email: 'c@x.com' },
    { receiptError: '', email: 'd@x.com' }
  ];
  const r1 = group(oneFault);
  check('three customers hit by ONE fault come back as one row of three',
    r1.broken === 3 && r1.groups.length === 1 && r1.groups[0].n === 3,
    'got broken=' + r1.broken + ' groups=' + r1.groups.length +
    ' n=' + (r1.groups[0] && r1.groups[0].n) + '. Amounts differ per customer, so without ' +
    'the digits collapsed this prints as three separate problems and reads as the book ' +
    'being wrong rather than one setting.');
  /* And the opposite must NOT collapse: genuinely different causes stay apart, or the
     grouping would report one tidy cause for a book full of different ones. */
  const manyFaults = [
    { receiptError: 'This customer has no email address on their record.', email: '' },
    { receiptError: 'The EmailJS keys are missing or incomplete.', email: 'b@x.com' },
    { receiptError: 'The email service rejected the payment receipt: 429', email: 'c@x.com' }
  ];
  const r2 = group(manyFaults);
  check('three DIFFERENT causes stay three rows', r2.groups.length === 3 && r2.broken === 3,
    'got ' + r2.groups.length + ' groups. Collapsing unlike causes would report one tidy ' +
    'answer for a book full of different ones — the opposite failure, and the worse one.');
  check('and the ones with no address on file are counted separately',
    r2.noEmailOnFile === 1 && r1.noEmailOnFile === 0,
    'that count is what separates "nothing is broken, they have no email" from a real fault');
  check('the commonest cause is reported first',
    group(oneFault.concat(manyFaults)).groups[0].n === 3,
    'the biggest group is the one to act on');
  check('an empty book reports nothing rather than throwing',
    group([]).broken === 0 && group([]).groups.length === 0, 'and undefined is survivable too');
})();

check('and an error line is scrubbed of anything email-shaped',
  /@\[A-Za-z0-9\.-\]\+|replace\([^)]*@/.test(live) && /email removed/.test(live),
  'the run log quotes template names AND customer-shaped text; the useful half is the ' +
  'template, so the address is removed rather than the whole line dropped');

console.log('');
console.log('--- It only runs when somebody asks ---');
console.log('');

if (!fs.existsSync(WORKFLOW)) {
  check('the workflow exists', false, 'nightly-digest.yml is missing, so nothing can run this');
} else {
  const yml = fs.readFileSync(WORKFLOW, 'utf8');
  check('it is dispatch-only — no schedule, no push trigger',
    /workflow_dispatch/.test(yml) && !/\bschedule:/.test(yml) && !/^\s*push:/m.test(yml),
    'it reads customer data, so it runs when asked and never on its own — and a mistake ' +
    'in it can then never fire unattended');
  check('and firebase-admin is pinned below 14',
    /firebase-admin@\^13\./.test(yml),
    '14 removes the namespaced admin.firestore() this script uses. Unpinned, the job ' +
    'keeps working until npm resolves 14 and then fails months later, nowhere near a change.');
  check('and it installs where the script actually lives',
    !/working-directory:\s*functions/.test(yml),
    'Node resolves require() from the script directory, not the working directory — ' +
    'error-digest.yml lost a run to exactly this');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
