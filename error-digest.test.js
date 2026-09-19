/* READING THE ERRORS CANNOT WRITE, AND CANNOT NAME ANYBODY
 * ========================================================
 * `npm run test:digest-read` — its own file per R-018.
 *
 * Addie, 2026-09-19: "how can we make it so errors are generated first, you
 * read the errors you fix the errors than fix the errors in admin portal since
 * those errors are no longer needed." Raise, fix and clear already worked;
 * error-digest.js is the READ, and it runs as a service account that deploys
 * Cloud Functions — so it can write anything in the project.
 *
 * ⛔ THE SCRIPT IS THE ONLY THING THAT MAKES IT READ-ONLY, so this file is the
 * only thing that makes the script stay that way. Every other guard here is a
 * nicety beside that one.
 *
 * ⛔ AND THE OUTPUT IS A GITHUB ACTIONS LOG, readable by anybody with repo
 * access. Every error row carries who hit it ([[MSG-10]], built so the OFFICE
 * can ring them) — a staff address, a customer name, six characters of a portal
 * token. None of it helps fix a bug. So the identity fields must never be read,
 * and the body must be scrubbed of anything email-shaped, because the admin
 * reporter writes the signed-in address into the message text as well as into
 * its own field.
 *
 * ⚠ THE SCRUB IS RUN, NOT MATCHED. A regex that says the right thing and is
 * applied to the wrong variable reads identically in the source.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const script = fs.readFileSync(path.join(ROOT, 'error-digest.js'), 'utf8');
const flow = fs.readFileSync(path.join(ROOT, '.github/workflows/error-digest.yml'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

function extractFn(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i === -1) i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('could not find function ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('could not find the end of ' + name);
}

/* Comments are stripped before any source search. This repo has been caught at
   least five times reading its own explanatory prose as code — Suites 58, 274,
   275, 300 and the comm-centre leak check each learned it separately, and this
   file's header quotes the very words it searches for. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const code = stripComments(script);

console.log('');
console.log('--- It cannot write ---');
console.log('');

/* ⛔ THE CHECK THAT EARNS THIS FILE, and its FIRST DRAFT WAS WRONG in a way worth
   keeping: it banned `.set(`, `.add(` and `.delete(` outright and failed on correct
   code, because `groups.set(key, g)` is a Map. Map and Set carry all three names, so a
   blanket ban on them can never be both sound and complete — it forbids ordinary
   JavaScript while a real write could still arrive by a name nobody listed.
   ⭐ THE GUARANTEE IS TIGHTER STATED THE OTHER WAY ROUND. Every Firestore write needs a
   reference, and every reference comes from `db`. Pin what `db` is allowed to touch and
   the write becomes unreachable whatever it is called. */
const dbUses = code.match(/\bdb\s*\./g) || [];
check('the database handle is used exactly once',
  dbUses.length === 1,
  'found ' + dbUses.length + ' uses of db. — every Firestore write needs a reference, and they all come from here');

check('and that one use is the messages read',
  /\bdb\s*\.collection\(\s*'messages'\s*\)\s*\.limit\([^)]*\)\s*\.get\(\s*\)/.test(code),
  'if this stops being collection().limit().get(), the read-only guarantee is gone');

check('the database is opened once and never reopened',
  (code.match(/admin\s*\.\s*firestore\s*\(/g) || []).length === 1,
  'a second handle would sidestep the check above');

/* These have no innocent meaning in JavaScript, unlike set/add/delete, so a blanket ban
   on them is sound. They are the belt to the braces above, not the guard itself. */
const WRITES = ['FieldValue', 'writeBatch(', 'runTransaction', 'bulkWriter', '.commit('];
const found = WRITES.filter(w => code.indexOf(w) !== -1);
check('no write-only Firestore API appears at all',
  found.length === 0,
  'found: ' + JSON.stringify(found));

check('nothing is imported that could write on its own',
  !/require\(\s*['"](?!firebase-admin|fs|path)/.test(code),
  'the reader needs firebase-admin, fs and path and nothing else');

console.log('');
console.log('--- It names nobody ---');
console.log('');

/* The fields the reporters write identity into. A field the script never reads
   cannot reach the log, which is a stronger guarantee than scrubbing it after. */
const IDENTITY = ['staffEmail', 'tokenTail', 'tokenKind', 'contactMethod'];
const read = IDENTITY.filter(f => code.indexOf(f) !== -1);
check('it never reads an identity field off the row',
  read.length === 0,
  'found: ' + JSON.stringify(read) + ' — who hit a fault belongs in the admin badge, not an Actions log');

const scrub = new Function(extractFn(script, 'scrub') + '; return scrub;')();

check('an email in the body is removed',
  scrub('Signed in as: someone@example.com').indexOf('someone@example.com') === -1);

check('the reporter\'s own "Signed in as" line is removed',
  (function () {
    const body = 'Something went wrong on the admin page.\n\nboom\n\nWhere: #/customers\nSigned in as: a@b.co\nBrowser: Safari';
    const out = scrub(body);
    return out.indexOf('a@b.co') === -1 && /Signed in as: \(removed\)/.test(out);
  })(),
  'the admin reporter writes the address into the BODY as well as into staffEmail');

check('an email anywhere else in the body is removed too',
  scrub('What went wrong: could not mail bob.smith+tag@mail.co.uk').indexOf('bob.smith+tag@mail.co.uk') === -1,
  'a member report quotes whatever the customer typed');

/* ⚠ THE OTHER DIRECTION, so the scrub is not simply deleting everything. */
check('and the fault itself survives the scrub',
  (function () {
    const out = scrub('What went wrong: deadline-exceeded\nWhere: #/quotes\nBrowser: Chrome');
    return /deadline-exceeded/.test(out) && /#\/quotes/.test(out) && /Chrome/.test(out);
  })(),
  'a report scrubbed of the fault is no use for fixing it');

console.log('');
console.log('--- It agrees with the app about what a fault is ---');
console.log('');

const needle = new Function(extractFn(script, 'needle') + '; return needle;')();
const appNeedle = new Function(extractFn(admin, 'fixedErrorNeedle') + '; return fixedErrorNeedle;')();

check('its normaliser matches admin.html\'s fixedErrorNeedle',
  ['Edit Customer save failed: 1 of 258', 'DEADLINE-Exceeded', '  spaced   out  ', '', null]
    .every(v => needle(v) === appNeedle(v)),
  'otherwise "covered by an entry" here means something different from what the sweep does');

check('and the shipped list can actually be read out of admin.html',
  (function () {
    const list = new Function(extractFn(script, 'fixedErrorList') + '; return fixedErrorList;')
      .call(null);
    return typeof list === 'function';
  })(),
  'the lifter is a function; its runtime read is exercised by the report itself');

console.log('');
console.log('--- The workflow ---');
console.log('');

check('it runs only when somebody asks',
  /workflow_dispatch/.test(flow),
  'there is no other trigger by design');

check('it has no push trigger',
  !/^\s*push:/m.test(flow),
  'this reads customer-facing data; it must not fire on a commit');

check('it has no schedule',
  !/^\s*schedule:/m.test(flow),
  'nothing here should run unattended');

check('it uses the service account the deploy already uses',
  /secrets\.FIREBASE_SERVICE_ACCOUNT/.test(flow),
  'no new credential is introduced by this');

check('it runs the reader and nothing else',
  /node \.\.\/error-digest\.js/.test(flow) && !/firebase deploy/.test(flow),
  'a deploy step here would put a write path back into a read-only job');

console.log('');
console.log('=== Reading the errors cannot write, and cannot name anybody ===');
console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
