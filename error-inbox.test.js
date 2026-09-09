/* WHEN SOMETHING GOES WRONG, SOMEBODY IS TOLD
 * ===========================================
 * `npm run test:errors` — its own file per R-018.
 *
 * Addie, 2026-09-08: "give an error message to them if it fails. Is there a way to send
 * inbox message that there was an error with sending an email/ or an error in
 * approving/back next year/no there RSVP? And can we make another spot in inbox that is
 * error so anytime a member runs into an error or our website runs into errors it will
 * let us know. With two seperate sections in error for member error and admin error?"
 *
 * The apology to the customer already existed and was the whole of it: portalCallFailedText
 * has always told them to ring us, and nothing anywhere told US. So an RSVP link that
 * failed produced a customer who reads, for ever after, as somebody who never answered —
 * indistinguishable from somebody who ignored the email.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. The three folders are created as a TREE: Errors, with Member Errors and Admin
 *      Errors under it. A child needs an id that may not have existed a line earlier.
 *   2. A section somebody has already moved is left where it is.
 *   3. Both topics file into their own section, and the office's own filing still wins.
 *   4. Every portal failure the customer can see raises a member report, because the
 *      report is raised in the ONE function all eight of those paths already call.
 *   5. A portal token never reaches a message in full.
 *   6. Neither reporter can throw, whatever the write does. Every caller is already
 *      handling a failure.
 *   7. Both reporters stop: deduped, capped, and — on the admin side — quiet about a
 *      fault already written down within ERROR_REPEAT_HOURS, which is what stops a
 *      fault that fires on every page load posting a fresh row every time the tab opens.
 *   8. An admin error caught before the page has finished loading is HELD, not dropped.
 *   9. Every bulk email sender reports what failed and why.
 *
 * ⚠ EVERY CLAIM HERE IS RUN, NOT MATCHED. All of them are about a row that does or does
 * not get written, and this repo has been caught at least four times by a check that
 * found the right words in a file where they could never execute — a sort behind an
 * `if(0)`, a price behind an `if(false)`, a message built and then overwritten by the
 * line below it. The two structural checks at the end say in as many words that they are
 * structural and why running them was not worth the harness.
 *
 * ⚠ AND THE FUNCTIONS ARE LIFTED, NEVER STUBBED (CLAUDE.md §3). A stub of
 * `errorAlreadyReported` would let the repeat guard rot while this file reported green,
 * and the repeat guard is the only thing standing between one persistent fault and a
 * folder nobody opens.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const admin = read('admin.html');
const index = read('index.html');

let passed = 0, failed = 0;
const failures = [];

function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

/* Slices between two real structural markers. CLAUDE.md §7 bans fixed-length extraction
   windows by name — they go stale silently as the code between them grows. */
function between(src, startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error('could not find the start of ' + label + ' (' + startMarker + ')');
  const b = src.indexOf(endMarker, a);
  if (b === -1) throw new Error('could not find the end of ' + label + ' (' + endMarker + ')');
  return src.slice(a, b);
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

/* ---------------------------------------------------------------------------
 * The pieces, lifted.
 * ------------------------------------------------------------------------- */
/* ⚠ ENDS AT THE TABLE, NOT AT THE FUNCTION. MESSAGE_HOME_FOLDER sits between the two, so
   a window reaching as far as messageFolderOf carries the table with it — and every
   sandbox below that supplies both then dies on "already declared", which reads like a
   test-harness fault rather than a window that is one marker too wide. */
const ERROR_CONSTS = between(admin, "const ERROR_FOLDER = 'Errors';",
  'const MESSAGE_HOME_FOLDER = {', 'the Errors folder constants');
const ADMIN_BLOCK = between(admin, 'const ERROR_REPEAT_HOURS = 12;',
  'function loadMessageFolders(', 'the admin reporter');
const SEED_FN = extractFn(admin, 'seedErrorFolders');
const HOME_MAP = (admin.match(/const MESSAGE_HOME_FOLDER = \{[\s\S]*?\};/) || [])[0];
const FOLDER_OF = extractFn(admin, 'messageFolderOf');
const MEMBER_BLOCK = between(index, "var MEMBER_ERROR_TOPIC = 'Member Error';",
  'function setQuoteConfirmSub(', 'the member reporter');

check('every piece this file runs was found',
  !!ERROR_CONSTS && !!ADMIN_BLOCK && !!SEED_FN && !!HOME_MAP && !!FOLDER_OF && !!MEMBER_BLOCK,
  'renamed or moved? repoint the lift — do NOT paste a copy in here, or this file starts ' +
  'agreeing with itself instead of with the shipped code');

/* A lift that has quietly stopped matching reports no problems at all — a green build
   for the worst possible reason. Each block asserts a landmark from its own middle. */
check('the lifted blocks really are the code they claim to be',
  ADMIN_BLOCK.indexOf('function reportAdminError(') !== -1 &&
  ADMIN_BLOCK.indexOf('function reportEmailSendFailures(') !== -1 &&
  ADMIN_BLOCK.indexOf('window.__huAdminErrorSink') !== -1 &&
  MEMBER_BLOCK.indexOf('function reportMemberError(') !== -1 &&
  MEMBER_BLOCK.indexOf('function portalCallFailedText(') !== -1 &&
  MEMBER_BLOCK.indexOf('function redactTokens(') !== -1,
  'the window found something, but not the whole of what these checks then drive');

/* ---------------------------------------------------------------------------
 * Harnesses.
 * ------------------------------------------------------------------------- */
function fakeDb(opts) {
  opts = opts || {};
  const writes = [];
  return {
    writes,
    db: {},
    collection: (d, name) => ({ name }),
    serverTimestamp: () => null,
    addDoc: (col, data) => {
      writes.push({ collection: col.name, data });
      if (opts.throwsSync) throw new Error('addDoc exploded');
      if (opts.rejects) return Promise.reject(new Error('Missing or insufficient permissions'));
      return Promise.resolve({ id: 'new-doc-' + writes.length });
    }
  };
}

function adminHarness(opts) {
  opts = opts || {};
  const io = fakeDb(opts);
  const win = opts.window || {};
  const scope = {
    db: io.db, collection: io.collection, addDoc: io.addDoc, serverTimestamp: io.serverTimestamp,
    allMessages: opts.allMessages || [],
    toJsDate: ts => (ts instanceof Date ? ts : null),
    auth: { currentUser: { email: 'office@highlightingutah.com' } },
    location: { hash: '#/dashboard' },
    navigator: { userAgent: 'TestBrowser/1.0' },
    window: win,
    console: { error() {}, warn() {}, log() {} }
  };
  const names = Object.keys(scope);
  const body = ERROR_CONSTS + '\n' + ADMIN_BLOCK + '\n' +
    'return {reportAdminError, flushAdminErrors, reportEmailSendFailures, errorKeyFor,' +
    ' errorAlreadyReported, adminErrorIsNoise,' +
    ' setLastEmailError(e){ lastEmailSendError = e; },' +
    ' written(){ return adminErrorsWritten; }, queued(){ return adminErrorQueue.length; }};';
  const api = new Function(...names, body)(...names.map(n => scope[n]));
  api.writes = io.writes;
  api.window = win;
  return api;
}

function memberHarness(opts) {
  opts = opts || {};
  const io = fakeDb(opts);
  const handlers = {};
  const win = {
    addEventListener: (name, fn) => { handlers[name] = fn; }
  };
  const scope = {
    db: io.db, collection: io.collection, addDoc: io.addDoc, serverTimestamp: io.serverTimestamp,
    /* The portal's own record of who is signed in. Named here rather than left undefined
       because the reporter reads it to name the customer, and `typeof` guards mean an
       undefined one passes every check while proving nothing about the branch. */
    currentJobAddressData: opts.customer || null,
    location: { href: opts.href || 'https://highlightingutah.com/#/payment?token=pt_abc123456789xyz&rsvp=yes',
                hash: opts.hash || '#/payment?token=pt_abc123456789xyz&rsvp=yes' },
    navigator: { userAgent: 'TestBrowser/1.0' },
    window: win,
    console: { error() {}, warn() {}, log() {} }
  };
  const names = Object.keys(scope);
  const body = MEMBER_BLOCK + '\n' +
    'return {reportMemberError, redactTokens, portalCallFailedText, quoteAnswerWords,' +
    ' memberErrorScreenMatters, sent(){ return memberErrorCount; }};';
  const api = new Function(...names, body)(...names.map(n => scope[n]));
  api.writes = io.writes;
  api.handlers = handlers;
  return api;
}

const NL = String.fromCharCode(10);

/* ===========================================================================
 * 1. The folders are created as a tree.
 * ========================================================================= */
console.log('');
console.log('--- the Errors folder and its two sections ---');

function runSeed(existing) {
  const io = fakeDb();
  const scope = {
    db: io.db, collection: io.collection, addDoc: io.addDoc, serverTimestamp: io.serverTimestamp
  };
  const names = Object.keys(scope);
  const body = ERROR_CONSTS + '\n' + SEED_FN + '\nreturn seedErrorFolders;';
  const fn = new Function(...names, body)(...names.map(n => scope[n]));
  return fn(existing).then(() => io.writes);
}

const seedChecks = (async () => {
  /* ⚠ AN EMPTY BOOK IS THE CASE THAT MATTERS, and it is the one a naive implementation
     gets wrong: the parent does not exist yet, so the children's parentId can only come
     from the write that has just created it. Waiting for the next snapshot cannot work —
     it arrives with foldersSeeded already true and the children are never created. */
  const fresh = await runSeed([]);
  const names = fresh.map(w => w.data.name);
  check('from nothing, all three folders are created',
    names.indexOf('Errors') !== -1 && names.indexOf('Member Errors') !== -1 &&
    names.indexOf('Admin Errors') !== -1,
    'she asked for one spot with two sections in it; got ' + JSON.stringify(names));

  const parent = fresh.find(w => w.data.name === 'Errors');
  const kids = fresh.filter(w => w.data.name !== 'Errors');
  check('Errors is the top-level one',
    !!parent && parent.data.parentId === null,
    'a parent nested under something else is not a spot in the inbox');
  check('and the two sections are created UNDERNEATH it, not beside it',
    kids.length === 2 && kids.every(k => k.data.parentId === 'new-doc-1'),
    'the children must take the id the parent write just returned — reading it back from ' +
    'the next snapshot cannot work, that snapshot has foldersSeeded set and never seeds. ' +
    'Got ' + JSON.stringify(kids.map(k => k.data.parentId)));

  /* Everything already there: seeding is a no-op, so opening the page does not write. */
  const settled = await runSeed([
    { id: 'f1', name: 'Errors', parentId: null },
    { id: 'f2', name: 'Member Errors', parentId: 'f1' },
    { id: 'f3', name: 'Admin Errors', parentId: 'f1' }
  ]);
  check('a second login creates nothing',
    settled.length === 0,
    'this runs on every page load; writing each time would be a fresh folder every login');

  /* ⚠ THE FIXTURE PUTS A SECTION SOMEWHERE ELSE ON PURPOSE. These are ordinary folders —
     she can drag them anywhere — and re-parenting on every login would silently undo her
     filing every single time she opened the page. */
  const moved = await runSeed([
    { id: 'f1', name: 'Errors', parentId: null },
    { id: 'f9', name: 'Member Errors', parentId: null },
    { id: 'f3', name: 'Admin Errors', parentId: 'f1' }
  ]);
  check('a section the office has already moved is left where she put it',
    moved.length === 0,
    'seeding must never re-parent an existing folder, or her filing is undone on every login');
})();

/* ===========================================================================
 * 2. Both topics file into their own section.
 * ========================================================================= */
console.log('');
console.log('--- where an error report lands ---');

const folderApi = new Function(ERROR_CONSTS + '\n' + HOME_MAP + '\n' + FOLDER_OF +
  '\nreturn {messageFolderOf: messageFolderOf, MESSAGE_HOME_FOLDER: MESSAGE_HOME_FOLDER};')();
const folderOf = folderApi.messageFolderOf;
const HOME_MAP_OBJ = folderApi.MESSAGE_HOME_FOLDER;

check('a member error lands in Member Errors',
  folderOf({ topic: 'Member Error', folder: 'Inbox' }) === 'Member Errors',
  'index.html has no login and cannot read the folder table, so the topic has to be ' +
  'enough on its own — got ' + folderOf({ topic: 'Member Error', folder: 'Inbox' }));
check('an admin error lands in Admin Errors',
  folderOf({ topic: 'Admin Error', folder: 'Inbox' }) === 'Admin Errors',
  'got ' + folderOf({ topic: 'Admin Error', folder: 'Inbox' }));
check('neither one lands in the Inbox with the customer post',
  folderOf({ topic: 'Member Error' }) !== 'Inbox' && folderOf({ topic: 'Admin Error' }) !== 'Inbox',
  'the whole reason this is its own folder is the objection notifyBusinessOfMessage ' +
  'raised: a public page must not spam the Inbox on a customer\'s behalf');
/* ⭐ AND THE TWO SECTIONS INHERIT MSG-08's PROTECTION FOR FREE, which is worth locking in
   rather than leaving as a happy accident. The folder-delete handler refuses any folder a
   topic is homed to, computing exactly the expression below — so mapping the two error
   topics is what makes these undeletable. Deleting one would otherwise leave the next
   report resolving to a folder with no row in the sidebar: in no list, counted nowhere. */
{
  const homedTo = name => Object.keys(HOME_MAP_OBJ).filter(t => HOME_MAP_OBJ[t] === name);
  check('neither section can be deleted out from under the next report',
    homedTo('Member Errors').length > 0 && homedTo('Admin Errors').length > 0,
    'the delete handler refuses a folder only when a topic is homed to it — without ' +
    'that mapping the next error report lands in a folder that does not exist');
}

check('but the office moving one by hand still wins',
  folderOf({ topic: 'Member Error', folder: 'Cancellations', filedByHand: true }) === 'Cancellations',
  'filedByHand is tested first for every other topic and must be here too, or a report ' +
  'she has filed springs back on the next render');

/* ===========================================================================
 * 3. Every portal failure the customer sees raises a report.
 * ========================================================================= */
console.log('');
console.log('--- the member half ---');

{
  /* ⭐ THE FUNNEL IS THE POINT. All eight failure paths in index.html — the RSVP yes, the
     RSVP no, Back Next Year, approving a quote, declining one, Maybe Next Year, and the
     two `!res.ok` branches — already call portalCallFailedText to build the apology. So a
     report raised THERE is raised by a failure path added later without anybody
     remembering to, which is the failure this whole file is about. */
  const h = memberHarness();
  const text = h.portalCallFailedText({ code: 'internal' }, 'account', 'Answering Yes to the RSVP email');
  check('a portal failure writes a report',
    h.writes.length === 1 && h.writes[0].collection === 'messages',
    'got ' + h.writes.length + ' write(s)');
  check('and it is filed under the member section',
    h.writes.length === 1 && h.writes[0].data.topic === 'Member Error' &&
    h.writes[0].data.folder === 'Member Errors',
    'got ' + JSON.stringify(h.writes[0] && { t: h.writes[0].data.topic, f: h.writes[0].data.folder }));
  check('the report says what they were doing',
    h.writes.length === 1 && h.writes[0].data.message.indexOf('Answering Yes to the RSVP email') !== -1,
    '"something failed" with no idea what is a row she can do nothing with');
  check('and the customer still gets the apology they always got',
    /call or text us/.test(text),
    'the report is in addition to the apology, never instead of it');
}

{
  /* The yes and the no are different answers and the office may need to ring about one
     and not the other, so they must not report as the same thing. */
  const h = memberHarness();
  h.portalCallFailedText(new Error('boom'), 'account', 'Answering Yes to the RSVP email');
  h.portalCallFailedText(new Error('boom'), 'account', 'Answering No to the RSVP email');
  check('a failed Yes and a failed No are two different reports',
    h.writes.length === 2 &&
    h.writes[0].data.message.indexOf('Yes') !== -1 &&
    h.writes[1].data.message.indexOf('No to the RSVP') !== -1,
    'got ' + h.writes.length + ' — the dedupe key has to include what they were doing, ' +
    'or one of the two answers is silently never reported');
}

{
  const h = memberHarness();
  check('Maybe and Decline are named apart',
    h.quoteAnswerWords('maybe_next_year') !== h.quoteAnswerWords('decline') &&
    /maybe/i.test(h.quoteAnswerWords('maybe_next_year')) &&
    /declin/i.test(h.quoteAnswerWords('decline')),
    'they share one code path, so without this both read as the same failure');
}

{
  /* ⚠ THE SAME FAULT TWICE IS ONE ROW. A customer who taps a dead link four times must
     not fill the folder — the fault is the same fault, and a folder of forty copies is
     one nobody opens. */
  const h = memberHarness();
  for (let i = 0; i < 6; i++) h.portalCallFailedText({ code: 'not-found' }, 'account', 'Answering Yes to the RSVP email');
  check('the same failure over and over is written down once',
    h.writes.length === 1,
    'got ' + h.writes.length + ' rows for one fault');
}

{
  /* And distinct faults are capped, so one broken visit cannot bury the folder either. */
  const h = memberHarness();
  for (let i = 0; i < 10; i++) h.portalCallFailedText(new Error('fault number ' + i), 'account', 'doing thing ' + i);
  check('and a visit that keeps failing stops after a few',
    h.writes.length > 0 && h.writes.length <= 3,
    'got ' + h.writes.length + ' — MEMBER_ERROR_MAX_PER_VISIT is what stops one unhappy ' +
    'customer becoming forty rows to read past');
}

/* ===========================================================================
 * 4. A portal token never reaches a message in full.
 * ========================================================================= */
console.log('');
console.log('--- what is safe to write down ---');

{
  const TOKEN = 'pt_abc123456789xyz';
  const h = memberHarness({ href: 'https://highlightingutah.com/#/payment?token=' + TOKEN + '&rsvp=yes' });
  h.portalCallFailedText(new Error('boom'), 'account', 'Answering Yes to the RSVP email');
  const body = h.writes[0].data.message;
  check('the page they were on is in the report',
    body.indexOf('highlightingutah.com') !== -1,
    'without it the office cannot tell an RSVP failure from a quote one');
  /* ⚠ `messages` is staff-read-only but PUBLICLY CREATABLE — that is how the contact
     form works with no login — so a live portal token written into one is a credential
     sitting in a collection anybody can append to. */
  check('but their portal token is not, in full',
    body.indexOf(TOKEN) === -1,
    'a portal token is a key to that customer\'s account and must never be written down whole');
  check('and enough of it survives to match them to a record',
    body.indexOf('789xyz') !== -1,
    'redacted to nothing, the report cannot be traced to a customer at all and the ' +
    'office has nobody to ring');
  check('and the report explains why the link is short',
    /cut short on purpose/.test(body),
    'a truncated link with no explanation reads as a bug in the report');
}

{
  /* ⚠ A PAGE CARRYING NO TOKEN REDACTS NOTHING, so the note explaining the redaction
     would be a claim about something that did not happen — which is the sort of thing
     that makes somebody distrust the rest of the report. */
  const h = memberHarness({ href: 'https://highlightingutah.com/#/payment', hash: '#/payment' });
  h.portalCallFailedText(new Error('boom'), 'account', 'Signing in');
  check('nothing was cut, so nothing claims to have been',
    !/cut short on purpose/.test(h.writes[0].data.message),
    'the line must follow the redaction, not be printed unconditionally');
}

{
  /* ⭐ THE ONE CASE WHERE WE ALREADY KNOW EXACTLY WHO IT IS. A failure inside the portal
     happens to somebody signed in, and a report the office can act on without detective
     work is worth far more than one they cannot. */
  const h = memberHarness({ customer: { name: 'Dana Anderson', phone: '8015550111', email: 'dana@x.com' } });
  h.portalCallFailedText(new Error('boom'), 'account', 'Saving their light colours');
  check('a failure inside the portal names the customer it happened to',
    h.writes[0].data.name === 'Dana Anderson' && h.writes[0].data.phone === '8015550111',
    'the inbox row draws name and phone; left blank the office has a fault and nobody ' +
    'to ring about it. Got ' + JSON.stringify({ n: h.writes[0].data.name, p: h.writes[0].data.phone }));
}

{
  const h = memberHarness();
  h.portalCallFailedText(new Error('boom'), 'account', 'Answering Yes to the RSVP email');
  check('but an RSVP link that failed before sign-in claims to know nobody',
    h.writes[0].data.name === '' && h.writes[0].data.phone === '',
    'guessing a name onto a report is worse than leaving it blank — the redacted link ' +
    'at the bottom is what identifies these');
}

/* ===========================================================================
 * 5. Neither reporter can throw.
 * ========================================================================= */
console.log('');
console.log('--- a reporter that breaks the thing it reports on ---');

{
  let threw = null;
  try {
    const h = memberHarness({ throwsSync: true });
    h.portalCallFailedText(new Error('boom'), 'account', 'Answering Yes to the RSVP email');
  } catch (err) { threw = err; }
  check('a write that throws never reaches the customer',
    threw === null,
    'every caller is already handling a failure — throwing here replaces the apology ' +
    'they are about to read with a blank screen. Threw: ' + (threw && threw.message));
}

{
  let threw = null;
  try {
    const h = memberHarness({ rejects: true });
    h.portalCallFailedText(new Error('boom'), 'account', 'Answering Yes to the RSVP email');
  } catch (err) { threw = err; }
  check('and a write that is refused is swallowed on purpose',
    threw === null,
    'the write IS the report, so there is nowhere left to report to');
}

{
  let threw = null;
  try {
    const h = adminHarness({ throwsSync: true });
    h.flushAdminErrors();
    h.reportAdminError('something broke');
  } catch (err) { threw = err; }
  check('the admin reporter cannot throw either',
    threw === null,
    'it is called from the global error handler; throwing there loops. Threw: ' + (threw && threw.message));
}

/* ===========================================================================
 * 6. The admin half.
 * ========================================================================= */
console.log('');
console.log('--- the admin half ---');

{
  const h = adminHarness();
  h.reportAdminError('Could not save the invoice');
  check('an error caught before messages have loaded is HELD, not written',
    h.writes.length === 0 && h.queued() === 1,
    'the repeat check reads allMessages, so writing before they load duplicates the row ' +
    'on every single page load');
  h.flushAdminErrors();
  check('and it is written the moment they land',
    h.writes.length === 1 && h.writes[0].data.folder === 'Admin Errors',
    'held is only acceptable because it is flushed — dropped, the first error after ' +
    'login is the one that never gets reported. Got ' + h.writes.length);
  check('the report names who was signed in',
    h.writes[0].data.message.indexOf('office@highlightingutah.com') !== -1,
    'two people use this dashboard; which of them saw it is half the diagnosis');
}

{
  /* ⚠ CLAUDE.md §7 records the Firestore long-poll line as normal reconnection noise
     rather than a fault, and it arrives in bursts — a flaky connection alone would fill
     this folder and teach the office to scroll past the row that matters. */
  const h = adminHarness();
  h.flushAdminErrors();
  h.reportAdminError('Fetch failed loading Listen/channel');
  check('normal Firestore reconnection noise is not an error report',
    h.writes.length === 0,
    'got a row for the one console line this repo already documents as harmless');
  h.reportAdminError('Could not save the invoice');
  check('but a real fault still gets through',
    h.writes.length === 1,
    'an ignore list that swallows real faults is worse than no ignore list at all');
}

{
  /* ⚠ THIS IS THE GUARD THAT SURVIVES A RELOAD, and the in-memory one does not. A fault
     that fires on every page load would otherwise post a fresh row every time the office
     opened the tab — which is the exact "cries wolf" failure this repo names elsewhere. */
  const h = adminHarness();
  h.flushAdminErrors();
  h.reportAdminError('Could not save the invoice');
  const key = h.writes[0].data.errorKey;

  const fresh = adminHarness({
    allMessages: [{ data: { topic: 'Admin Error', errorKey: key, createdAt: new Date() } }]
  });
  fresh.flushAdminErrors();
  fresh.reportAdminError('Could not save the invoice');
  check('a fault already written down today is not written down again',
    fresh.writes.length === 0,
    'this is what stops a fault that fires on every load posting a row on every load');

  const old = adminHarness({
    allMessages: [{ data: { topic: 'Admin Error', errorKey: key,
      createdAt: new Date(Date.now() - 48 * 3600 * 1000) } }]
  });
  old.flushAdminErrors();
  old.reportAdminError('Could not save the invoice');
  check('but the same fault two days later is worth saying again',
    old.writes.length === 1,
    'silence for ever is not the answer either — a fault that is still happening ' +
    'tomorrow is still happening');
}

{
  /* ⚠ serverTimestamp() reads back as null on the writing tab's own first snapshot.
     Treating that as old writes a second copy of the row we have this instant written. */
  const h = adminHarness({
    allMessages: [{ data: { topic: 'Admin Error', errorKey: 'Admin Error|could not save the invoice', createdAt: null } }]
  });
  h.flushAdminErrors();
  h.reportAdminError('Could not save the invoice');
  check('a report whose timestamp has not come back yet counts as recent',
    h.writes.length === 0,
    'otherwise the tab that just wrote the row immediately writes it a second time');
}

{
  const h = adminHarness();
  h.flushAdminErrors();
  for (let i = 0; i < 12; i++) h.reportAdminError('a different fault, number ' + i);
  check('the admin side stops after a handful too',
    h.writes.length > 0 && h.writes.length <= 5,
    'got ' + h.writes.length + ' — the red badge in the corner still counts every one');
}

{
  /* Collapsing the numbers is what makes "row 41 failed" and "row 87 failed" one fault
     rather than two hundred rows. */
  const h = adminHarness();
  check('numbers are collapsed out of the fingerprint',
    h.errorKeyFor('Admin Error', 'row 41 failed') === h.errorKeyFor('Admin Error', 'row 87 failed'),
    'without it a loop over 900 rows is 900 separate faults as far as the dedupe is concerned');
  check('but two genuinely different faults stay different',
    h.errorKeyFor('Admin Error', 'could not save the invoice') !==
    h.errorKeyFor('Admin Error', 'could not send the email'),
    'a fingerprint that collapses everything reports the first fault of the day and ' +
    'then goes silent about all the others');
}

{
  /* The catcher at the top of admin.html runs before Firebase exists, so it cannot write
     anything itself — it hands over what it caught the moment the module installs a sink. */
  const early = ['Something broke while the page was still loading'];
  const h = adminHarness({ window: { __huAdminErrorEarly: early } });
  check('the boot-time buffer is drained when the reporter arrives',
    early.length === 0,
    'errors caught before the module ran are exactly the worst ones, and they are the ' +
    'ones this hands over');
  check('and the sink is left on window for the catcher to call',
    typeof h.window.__huAdminErrorSink === 'function',
    'the catcher is plain JS in another script block; window is the only thing they share');
  h.flushAdminErrors();
  check('what it caught first is written down',
    h.writes.length === 1 &&
    h.writes[0].data.message.indexOf('still loading') !== -1,
    'drained into a queue and then never flushed would be worse than not draining it');
}

/* ===========================================================================
 * 7. Emails that did not send.
 * ========================================================================= */
console.log('');
console.log('--- emails that did not go out ---');

{
  const h = adminHarness();
  h.flushAdminErrors();
  h.setLastEmailError({ text: 'The service is not configured' });
  h.reportEmailSendFailures(3, 40);
  check('a bulk send with failures reports them',
    h.writes.length === 1 && h.writes[0].data.folder === 'Admin Errors',
    'the status line saying "3 failed" is gone the moment she clicks anything else');
  check('and it carries the reason, which the status line never did',
    h.writes[0].data.message.indexOf('The service is not configured') !== -1,
    'a count with no reason cannot be acted on');
  check('and says those customers have not heard from us',
    /NOT been emailed/.test(h.writes[0].data.message),
    'the whole risk is that she reads "3 failed" as something the system handled');
}

{
  const h = adminHarness();
  h.flushAdminErrors();
  h.setLastEmailError({ text: 'stale error from an earlier run' });
  h.reportEmailSendFailures(0, 40);
  check('a send where nothing failed reports nothing',
    h.writes.length === 0,
    'a row on every successful send is the fastest way to teach the office to ignore ' +
    'this folder');
  h.reportEmailSendFailures(1, 5);
  check('and the previous run\'s error is not carried onto the next one',
    h.writes.length === 1 &&
    h.writes[0].data.message.indexOf('stale error from an earlier run') === -1,
    'lastEmailSendError has to be cleared even when nothing failed, or the next failure ' +
    'is reported with the wrong reason attached');
}

/* ===========================================================================
 * 8. Two structural checks, named as such.
 * ========================================================================= */
console.log('');
console.log('--- wiring ---');

/* ⚠ STRUCTURAL, AND HERE IS THE TRADE. Driving the five bulk senders for real needs the
   whole Automation Emails DOM, an EmailJS stub and a Firestore stub — a harness that
   elaborate fails for its own reasons and gets deleted within a month. What makes this
   survivable is that the claim is about a call being present in a loop tail, which is the
   one shape a text check reads honestly. If the admin browser harness in CLAUDE.md is
   ever built, replace this with a run. */
{
  /* ⚠ THE SEMICOLON IS LOAD-BEARING. Without it this counts the function's own
     DECLARATION as a sixth caller — the same trap Suites 58, 274, 275 and 300 each hit
     from the other direction, a check finding the code that explains it rather than the
     code that runs. The declaration ends in `){`, so a call is the only thing that ends
     in `);`. */
  const calls = admin.split('reportEmailSendFailures(failed, sent);').length - 1;
  check('every bulk email sender reports what failed (structural)',
    calls === 5,
    'expected the four status-line senders plus the referral one; found ' + calls +
    '. A sender added later without this line fails silently exactly as they all used to');
  /* ⚠ REPOINTED 2026-09-09, NOT WEAKENED. This matched the whole catch INCLUDING its
     closing brace, so it was pinned to the catch doing nothing else — and it failed on
     correct code the moment one of them also recorded WHO the send failed for (EM-01).
     The guarantee has not moved: every one of the five still keeps the reason. Same
     slow-fuse shape as S82, S129 and the folder-names suite — a check anchored on where
     a string happened to sit rather than on what must be true. */
  const captured = admin.split('failed++; lastEmailSendError = err;').length - 1;
  check('and each of them keeps the reason instead of dropping it (structural)',
    captured === 5,
    'the catch used to be `catch(err){ failed++; }` — the count survived and the reason ' +
    'did not; found ' + captured);
  /* ⭐ AND ONE OF THEM NAMES THE PEOPLE (EM-01). A count cannot be acted on: the send
     that prompted this reported 392 not emailed and named nobody, so the only way to
     reach them was to mail the whole book again. The bulk senders that write straight
     to a status line are unchanged — this is asserted of the template runner, which is
     what both RSVP buttons go through. */
  const runner = admin.slice(admin.indexOf('async function etSendTemplateRun('));
  const runnerBody = runner.slice(0, runner.indexOf('\ndocument.getElementById(\'etSendToSelectedBtn\')'));
  /* ⚠ BOTH SITES, COUNTED — not "a push exists somewhere". There are exactly two ways
     this loop increments `failed`: a recipient with no email (nothing was ever sent) and
     a refused send. A red-check that renamed only the first sailed straight through a
     check that asked whether ANY push was present, which would have let the list and the
     `failed` count disagree — the card then reads "392 did not get it" over 4 names. */
  const pushes = runnerBody.split('failedRecipients.push(').length - 1;
  const bumps = runnerBody.split('failed++').length - 1;
  check('and the template runner records WHO it failed for, not just how many',
    pushes === bumps && pushes === 2 &&
    runnerBody.indexOf('failedRecipients: failedRecipients') !== -1,
    'every way of counting a failure must also name the person: found ' + pushes +
    ' record(s) against ' + bumps + ' failure(s) counted. Otherwise "send it again to ' +
    'the ones it missed" silently leaves some of them out');
  /* ⚠ THE RUNNER MUST NOT SAVE THEM ITSELF. Send the whole RSVP calls it twice, so a
     save inside would let the Not Paid pass overwrite the ordinary RSVP's failures and
     only half the book could be sent again. Each button saves once, for all its passes. */
  check('and it leaves the saving to the button, so two passes cannot overwrite each other',
    runnerBody.indexOf('saveEmailSendFailures(') === -1,
    'etSendTemplateRun calls saveEmailSendFailures itself — the second pass of the ' +
    'whole-RSVP send would erase the first pass’s list');
}

/* ---------------------------------------------------------------------------
 * The async folder checks have to finish before the summary, or a failure scores
 * after the total is printed and can never fail the build.
 * ------------------------------------------------------------------------- */
seedChecks.then(() => {
  console.log('');
  console.log('=== When something goes wrong, somebody is told ===');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch(err => {
  console.log('');
  console.log('  FAIL  the folder-seeding checks crashed: ' + (err && err.message));
  console.log('');
  console.log(passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
