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
  ["the templates",      /\bdb\s*\.collection\(\s*'emailTemplates'\s*\)\s*\.get\(\s*\)/]
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
