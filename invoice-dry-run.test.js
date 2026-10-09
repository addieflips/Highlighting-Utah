/* THE DRY RUN CANNOT SEND, CANNOT WRITE, AND NAMES NOBODY
 * =======================================================
 * `npm run test:dryrun`. Its own file per R-018.
 *
 * `invoice-dry-run.js` runs the REAL runInvoiceBatch over the REAL book, as the service
 * account that deploys the functions. That account can bill people. A tool you run to
 * find out whether the invoices are right must not be able to send them, and the only
 * thing standing between it and that is this gate.
 *
 * ⛔ THE GUARANTEE IS THE HANDLE, NOT A PROMISE. The run writes — that is what it is for
 * — so the question is never "does it write", it is "what does it write TO". The real
 * Firestore handle is used for four `.get()` reads and is never passed to the batch; the
 * batch is handed a fake built in memory. One line, and these checks hold it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SCRIPT = path.join(ROOT, 'invoice-dry-run.js');
const WORKFLOW = path.join(ROOT, '.github/workflows/invoice-dry-run.yml');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

if (!fs.existsSync(SCRIPT)) {
  console.log('  NOTE  invoice-dry-run.js is not in this checkout — nothing to gate, exit 0.');
  process.exit(0);
}
const code = fs.readFileSync(SCRIPT, 'utf8');
/* Comments stripped before anything is judged — this file's own prose and the script's
   header quote the very names being forbidden. Suite 58's trap, learned six times here. */
const live = code.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

console.log('');
console.log('--- it reads the real book, and only reads ---');
console.log('');

const READS = [
  ['the customers', /\bdb\s*\.collection\(\s*'jobAddresses'\s*\)\s*\.limit\([^)]*\)\s*\.get\(\s*\)/],
  ['the invoices',  /\bdb\s*\.collection\(\s*'invoices'\s*\)\s*\.limit\([^)]*\)\s*\.get\(\s*\)/],
  ['the templates', /\bdb\s*\.collection\(\s*'emailTemplates'\s*\)\s*\.get\(\s*\)/],
  ['the settings',  /\bdb\s*\.collection\(\s*'settings'\s*\)\s*\.get\(\s*\)/]
];
for (const [what, re] of READS) {
  check('reads ' + what + ' as a .get() and nothing else', re.test(live));
}
const dbUses = live.match(/\bdb\s*\./g) || [];
check('and uses the real database handle exactly ' + READS.length + ' times, no more',
  dbUses.length === READS.length,
  'found ' + dbUses.length + '. A fifth use is a deliberate edit to this list, which is ' +
  'what stops a write arriving as "one more read".');
check('the real database is opened once', (live.match(/admin\s*\.\s*firestore\s*\(/g) || []).length === 1);

console.log('');
console.log('--- the batch never gets the real handle ---');
console.log('');

/* ⛔ THE CHECK THAT EARNS THE FILE. runInvoiceBatch writes invoices and stamps customers;
   handed the real db it would bill the whole book from a tool whose name says dry run. */
check('the run is invoked with the FAKE database, not the real one',
  /fn\(\s*fake\s*,/.test(live) && !/fn\(\s*db\s*,/.test(live),
  'the first argument to the sandbox is the db the run writes to');
check('a fake database is built in memory for it',
  /function makeFakeDb\(/.test(live) && /const fake = makeFakeDb\(/.test(live));
check('and the real handle is never handed to anything that writes',
  !/new Function\([^)]*\)\s*\(\s*db\b/.test(live) && !/runInvoiceBatch\(\s*db/.test(live));

console.log('');
console.log('--- it cannot send email ---');
console.log('');

check('fetch is faked and records instead of sending',
  /const fakeFetch = async/.test(live) && /fn\([^)]*fakeFetch/.test(live),
  'the real fetch would reach EmailJS and mail several hundred customers');
check('and the script never calls the real email service itself',
  live.indexOf('api.emailjs.com') === -1,
  'the only EmailJS address in play belongs to the lifted server code, behind the fake fetch');
/* ⛔ MINTING A TOKEN IS A WRITE. A dry run that edits the book by being looked at is not
   a dry run — RS-65's rule, where drawing a list had to mint nothing. */
check('ensureToken is stubbed, because minting a portal token is a write',
  /async function ensureToken\([^)]*\)\s*\{\s*return 'DRYRUN-TOKEN'/.test(live));

console.log('');
console.log('--- it names nobody ---');
console.log('');

check('the sample email is scrubbed of the customer name before printing',
  /to_name/.test(live) && /\(customer name\)/.test(live),
  'PROC-36: the output is an Actions log anybody with repo access can read');
check('and of anything email-shaped',
  /@\[A-Za-z0-9\.-\]\+/.test(live) && /email removed/.test(live));
check('and of the portal token it stood in for',
  /their token/.test(live),
  'a token is a credential; it is never written down in full');
check('held and no-email customers are counted, never listed',
  /heldNames \|\| \[\]\)\.length/.test(live) && !/heldNames[^\n]*\.join/.test(live),
  'the run hands back real names so the OFFICE can chase them; this log may only count them');

console.log('');
console.log('--- it runs the real rule, not a description of one ---');
console.log('');

check('runInvoiceBatch is lifted from the shipped server file',
  /const fns = fs\.readFileSync\(path\.join\(__dirname, 'functions\/index\.js'\)/.test(live) &&
  /'runInvoiceBatch'/.test(live),
  'a second copy of the billing rule would answer about itself');
/* ⚠ THE CONDITION, NOT THE TEXT. A red-check wrapped this guard in `if (false)` and the
   first draft stayed green — it found `const missing = …` and `process.exit(1)` sitting
   there separately, both perfectly present and neither reachable. A text check cannot
   tell a live guard from a dead one; read the branch it actually turns on. */
check('the lift census is asserted before anything runs, and really stops the run',
  /const missing = LIFTED\.filter/.test(live) &&
  /if\s*\(\s*missing\.length\s*\)\s*\{[\s\S]{0,200}?process\.exit\(1\)/.test(live),
  'a missing lift arrives as a bare ReferenceError from the middle of a run, which this ' +
  'repo records being caught by twelve times');
check('the constants are read out of the source, never typed here',
  /NEW_MEMBER_FEE = \$\{num\(/.test(live) && /BILL_HELD_DAYS = \$\{num\(/.test(live),
  'a typed copy goes on passing against a number the app has moved off');
check('it uses her REAL templates rather than the built-in fallback',
  /__tpl\[__flat\(n\)\]/.test(live),
  'the office edits templates, and every token hole found so far lived in the edited half');
/* ⚠ THE RULE, NOT THE SPELLING. The first draft pinned the \u2010 escape form and
   failed on correct code the moment the file carried the characters themselves — §7's
   slow fuse, pinned to where a string happens to sit rather than to what must be true. */
const flatSrc = (live.match(/const flat = s =>[^;]*;/) || [''])[0];
check('template names are matched with dashes and case flattened',
  /toLowerCase\(\)/.test(flatSrc) && /replace\(\/\[[^\]]+\]\/g, ''\)/.test(flatSrc) && /\\s\+/.test(flatSrc),
  'an em dash and a hyphen are indistinguishable in a text box, and that difference once ' +
  'sent the built-in wording instead of hers. found: ' + flatSrc);

/* ⛔ THE REASON THE WHOLE THING EXISTS. 41 customers saw {{credit_lines}} because nothing
   looked at the rendered bytes for leftover codes. */
check('every rendered body is swept for unfilled {{codes}}',
  /\{\\\{\[a-zA-Z_\]\+\\\}\\\}/.test(live) && /RAW TEXT/.test(live),
  'this is the check that would have caught {{credit_lines}} before anybody received it');
check('and the sweep counts them across ALL bills, not just the first',
  /sent\.forEach\(/.test(live),
  'one sample read as the whole group is the mistake error-digest already made once');

console.log('');
console.log('--- it only runs when somebody asks ---');
console.log('');

if (!fs.existsSync(WORKFLOW)) {
  check('the workflow exists', false, 'invoice-dry-run.yml is missing');
} else {
  /* ⚠ COMMENTS STRIPPED FIRST, and a red-check of my own caught why: the header says
     "no push trigger and no schedule:" — which matched the very pattern forbidding
     the literal "schedule:" it forbids, so the gate failed a workflow that was correct.
     Suite 58's trap, in a gate written by somebody who had just written that trap up
     twice — and the fix is the one every other reader here already made: judge the
     code, never the prose explaining it. */
  const yml = fs.readFileSync(WORKFLOW, 'utf8')
    .split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  check('dispatch-only — no schedule, no push trigger',
    /workflow_dispatch/.test(yml) && !/\bschedule:/.test(yml) && !/^\s*push:/m.test(yml),
    'it reads the whole customer book, so it runs when asked and never on its own');
  check('firebase-admin pinned below 14',
    /firebase-admin@\^13\./.test(yml),
    '14 removes the namespaced admin.firestore() this depends on');
  check('and it installs where the script lives',
    !/working-directory:\s*functions/.test(yml),
    'Node resolves require() from the script directory — error-digest.yml lost a run to this');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
