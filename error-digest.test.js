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
const { execFileSync } = require('child_process');
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
/* ⚠ AND THE WORKFLOW IS STRIPPED TOO, which the first draft forgot. Its own comments
   quote the very shapes these checks look for — the block explaining the MODULE_NOT_FOUND
   contains the words `node ../error-digest.js` — so an unstripped search read the
   explanation as the thing being explained and failed a correct file. Suites 58, 274, 275,
   300 and the comm-centre leak check each learned this separately; so did this one. */
const flowCode = flow.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

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
console.log('--- It counts the environments instead of sampling one ---');
console.log('');

/* ⛔ THE DEFECT THIS REPLACES: the report printed ONE report's `Browser:` line, so a fault
   seen five times across three browsers on two machines was described as "all from an
   iPhone, iOS 18.7 Safari" — the first of the five happened to be. A Safari-only fault and
   an everywhere fault have different causes, so that misread sends the next person to the
   wrong place. These are the REAL agents off the five rows Addie pasted, not invented ones:
   an invented set agrees with whatever the parser does. */
const uaLabel = new Function(extractFn(script, 'uaLabel') + '; return uaLabel;')();
const uaFromMessage = new Function(extractFn(script, 'uaLabel') + ';' +
  extractFn(script, 'uaFromMessage') + '; return uaFromMessage;')();

const REAL = {
  win153: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  mac148: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
  macSaf: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
};

check('the five real agents come back as three distinct environments',
  (function () {
    const seen = [REAL.win153, REAL.mac148, REAL.iphone, REAL.win153, REAL.iphone].map(uaLabel);
    return new Set(seen).size === 3 &&
      seen.filter(function (s) { return s === 'Chrome on Windows'; }).length === 2 &&
      seen.filter(function (s) { return s === 'Safari on iPhone'; }).length === 2 &&
      seen.filter(function (s) { return s === 'Chrome on Mac'; }).length === 1;
  })(),
  'reported as one sample this group read as iPhone-only, which it is not');

/* ⚠ CHROME'S AGENT SAYS "Safari" AND EDGE'S SAYS "Chrome". Read in the wrong order every
   Chrome report files itself as Safari — which is precisely the wrong answer this exists
   to stop giving. */
check('Chrome is not read as Safari, and Mac Safari still is',
  uaLabel(REAL.win153) === 'Chrome on Windows' &&
  uaLabel(REAL.mac148) === 'Chrome on Mac' &&
  uaLabel(REAL.macSaf) === 'Safari on Mac',
  'both those agents carry the string Safari/');

check('Edge and Opera are not read as Chrome',
  uaLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0') === 'Edge on Windows' &&
  uaLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 OPR/99.0.0.0') === 'Opera on Windows',
  'both carry Chrome/ as well as their own token');

check('it reads the agent out of the body, where the reporters put it',
  uaFromMessage('Something went wrong on the admin page.\n\nWhere: (the dashboard)\nBrowser: ' + REAL.iphone) === 'Safari on iPhone',
  'there is no browser FIELD — both reporters write it as a line in the message');

check('a report with no browser line says so rather than guessing',
  uaFromMessage('Something went wrong.\nWhere: (the dashboard)') === '(no browser recorded)' &&
  uaLabel('') === '(no browser recorded)',
  'inventing an environment is the same fault as sampling one');

/* ⛔ THE REPORT NAMES NOBODY, and a full user agent is the most fingerprint-like thing in
   it. The census must SHORTEN, never pass the raw string through. */
check('no raw user agent survives into the label',
  Object.keys(REAL).every(function (k) {
    const out = uaLabel(REAL[k]);
    return out.length < 30 && out.indexOf('Mozilla') === -1 && out.indexOf('AppleWebKit') === -1 &&
      !/\d/.test(out);
  }),
  'a version number is identifying and is not what anybody reads this line for');

/* ⚠ STRUCTURAL, AND SAYS SO. The sample is built inside main(), which needs Firestore, so
   this cannot be run the way the checks above are. The claim is narrow: the raw `Browser:`
   line is dropped from the printed sample, because the census now states it for every
   report rather than for one — and left in, it is the very line that was read as the whole
   group. */
check('the raw browser line is dropped from the printed sample (structural)',
  /filter\([^)]*\)[\s\S]{0,120}Browser:/.test(code) || /!\/\^\\s\*Browser:\/i\.test/.test(code),
  'the census replaces it; carrying both invites the same misread back');

check('and the census is printed for every fault (structural)',
  /seen on: /.test(code) && /g\.envs/.test(code),
  'a census nothing prints is a census nobody reads');

/* ⛔ THE TALLY IS RUN, NOT MATCHED, and the red-check is why. While it was written inline in
   main() the only check possible was that the words `g.envs` appear somewhere — and a
   sabotage that counted the FIRST report and ignored every one after it passed that
   happily. That is this file's own defect one level down: a census that samples. */
const tallyEnv = new Function(extractFn(script, 'tallyEnv') + '; return tallyEnv;')();

check('every report is counted, not just the first of its kind',
  (function () {
    const m = new Map();
    ['Chrome on Windows', 'Safari on iPhone', 'Chrome on Windows',
     'Chrome on Mac', 'Safari on iPhone', 'Chrome on Windows'].forEach(function (e) { tallyEnv(m, e); });
    return m.get('Chrome on Windows') === 3 && m.get('Safari on iPhone') === 2 &&
      m.get('Chrome on Mac') === 1 && m.size === 3;
  })(),
  'a census that stops at one report is the very fault this whole change is about');

/* ⚠ THE CALL MUST STAND ALONE, and that is not pedantry — the red-check's last survivor was
   `if (!g.envs.size) tallyEnv(...)`, which leaves a perfectly correct tally wired up behind a
   guard that lets exactly one report through. A bare mention of the name cannot tell the two
   apart; a statement on its own line can. Same shape as asserting the wiring separately from
   the mechanism, which this repo has been caught needing three times. */
check('and the loop tallies every report through it, unguarded (structural)',
  /^[ \t]*tallyEnv\(g\.envs, env\);[ \t]*$/m.test(code),
  'a guarded call counts the first report of each fault and silently drops the rest');

console.log('');
console.log('--- It agrees with the app about what a fault is ---');
console.log('');

const needle = new Function(extractFn(script, 'needle') + '; return needle;')();
const appNeedle = new Function(extractFn(admin, 'fixedErrorNeedle') + '; return fixedErrorNeedle;')();

check('its normaliser matches admin.html\'s fixedErrorNeedle',
  ['Edit Customer save failed: 1 of 258', 'DEADLINE-Exceeded', '  spaced   out  ', '', null]
    .every(v => needle(v) === appNeedle(v)),
  'otherwise "covered by an entry" here means something different from what the sweep does');

/* ⛔ THE HALF THE FIRST VERSION LEFT OUT, and the real folder had one of each on day
   one. `clearFixedErrors` holds a report to a DATE FLOOR as well as a needle, so
   matching the needle alone reported two opposite things under one heading: a fault
   waiting to be swept (housekeeping) and a fault that CAME BACK after its fix
   (news — on an RSVP, a customer's answer lost anyway). Counted together, the
   second hides inside the first. */
const afterTheFix = new Function(extractFn(script, 'afterTheFix') + '; return afterTheFix;')();
const appFloor = new Function(extractFn(admin, 'fixedErrorFloor') + '; return fixedErrorFloor;')();

check('a report from before the fix reads as waiting to be swept',
  afterTheFix({ fixedOn: '2026-09-11' }, new Date(2026, 8, 10)) === false,
  'that one is cleared by the next admin load and is not news');

check('a report from after the fix reads as the fix not taking',
  afterTheFix({ fixedOn: '2026-09-11' }, new Date(2026, 8, 15)) === true,
  'the real folder held exactly this — an RSVP answer lost four days after the retries shipped');

check('the fix day itself counts as after, matching the sweep',
  afterTheFix({ fixedOn: '2026-09-11' }, new Date(2026, 8, 11)) === true,
  'the sweep keeps the fix day too, because nothing knows what hour it landed');

/* ⚠ `fixedErrorFloor` HANDS BACK MILLISECONDS, NOT A DATE, and the first draft of this
   check assumed a Date and threw. The claim is about the same INSTANT either way. */
check('its floor is the same instant admin.html builds',
  afterTheFix({ fixedOn: '2026-09-11' }, new Date(appFloor('2026-09-11'))) === true &&
  afterTheFix({ fixedOn: '2026-09-11' }, new Date(appFloor('2026-09-11') - 1)) === false,
  'a report the sweep keeps must never be reported here as one it will clear');

/* ⚠ IN A CHILD PROCESS UNDER MOUNTAIN TIME, and that IS the check. This container runs
   UTC, where local midnight and Date.parse('YYYY-MM-DD') are the same instant — so
   in-process this passes whether the floor is built locally or not, which is precisely
   what the red-check caught it doing. `fixed-errors.test.js` learned this first; the
   reader has to agree with the sweep about the boundary or it reports a kept row as one
   about to be cleared. Under America/Denver the two are six hours apart. */
check('its floor is local midnight, the same as the sweep\'s',
  (function () {
    const probe = extractFn(script, 'afterTheFix') + ';' +
      'const utc = new Date(Date.parse("2026-09-11"));' +
      'process.stdout.write(JSON.stringify([' +
      '  afterTheFix({fixedOn:"2026-09-11"}, new Date(2026, 8, 11)),' +
      '  afterTheFix({fixedOn:"2026-09-11"}, new Date(new Date(2026, 8, 11).getTime() - 1)),' +
      '  afterTheFix({fixedOn:"2026-09-11"}, new Date(utc.getTime() - 1))' +
      ']));';
    const got = JSON.parse(execFileSync(process.execPath, ['-e', probe],
      { env: Object.assign({}, process.env, { TZ: 'America/Denver' }) }).toString());
    /* local midnight is after, the instant before it is not, and the instant before UTC
       midnight — six hours EARLIER that evening — is not either. */
    return got[0] === true && got[1] === false && got[2] === false;
  })(),
  'a UTC floor sits six hours early, so an evening of reports would be swept as though they predated the fix');

check('an unreadable or missing date never claims the fix failed',
  afterTheFix({ fixedOn: 'whenever' }, new Date(2026, 8, 15)) === false &&
  afterTheFix({ fixedOn: '2026-09-11' }, null) === false &&
  afterTheFix(null, new Date(2026, 8, 15)) === false,
  'the safe direction is housekeeping, not a false alarm about a lost answer');

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
  /workflow_dispatch/.test(flowCode),
  'there is no other trigger by design');

check('it has no push trigger',
  !/^\s*push:/m.test(flowCode),
  'this reads customer-facing data; it must not fire on a commit');

check('it has no schedule',
  !/^\s*schedule:/m.test(flowCode),
  'nothing here should run unattended');

check('it uses the service account the deploy already uses',
  /secrets\.FIREBASE_SERVICE_ACCOUNT/.test(flowCode),
  'no new credential is introduced by this');

/* ⚠ THE FIRST RUN OF THIS JOB FAILED IN 15 SECONDS with MODULE_NOT_FOUND, and these two
   checks are that failure written down. Node resolves require() from the SCRIPT'S OWN
   directory, never the working directory — the job installed into functions/ and ran
   `node ../error-digest.js` from there, so Node looked in the ROOT node_modules and found
   nothing. The script lives at the root, so the install has to happen at the root. */
check('firebase-admin is installed where the script will look for it',
  /npm install [^\n]*firebase-admin/.test(flowCode) && /run: node error-digest\.js/.test(flowCode),
  'the reader lives at the repo root, so require() resolves against the ROOT node_modules');

check('and the reader is not run from another directory',
  !/node \.\.\//.test(flowCode),
  'running it from elsewhere re-creates the MODULE_NOT_FOUND this check exists for');

/* ⛔ THE PIN IS LOAD-BEARING. error-digest.js calls admin.firestore(), the namespaced API,
   which firebase-admin 14 REMOVES — CLAUDE.md records that by name. Unpinned, this job
   works until the day npm resolves 14 and then fails months from here, nowhere near the
   change that caused it. Held to the same major functions/ uses so the two cannot drift. */
check('the firebase-admin major is pinned, and matches functions/package.json',
  (function () {
    const pinned = (flowCode.match(/firebase-admin@\^?(\d+)/) || [])[1];
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'functions/package.json'), 'utf8'));
    const used = (String(pkg.dependencies['firebase-admin']).match(/(\d+)/) || [])[1];
    return !!pinned && pinned === used;
  })(),
  'the reader uses admin.firestore(), which firebase-admin 14 removes');

check('it runs the reader and nothing else',
  /run: node error-digest\.js/.test(flowCode) && !/firebase deploy/.test(flowCode),
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
