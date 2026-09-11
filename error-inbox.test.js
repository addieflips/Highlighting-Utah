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
const RETRY_AFTER_FN = extractFn(admin, 'emailSendRetryAfter');
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

/* ⭐ AND IT NAMES THEM (2026-09-11, from the Errors folder). "Emails did not send: 1 of 258
   failed — The recipients address is corrupted" reached the folder on 2026-09-10, and there
   was no way to tell from the row which one of the 258 never heard from us. Under
   confirmed-only a customer who was never asked is a customer nobody is sent to, so the one
   that got away is the whole cost of the row. */
{
  const h = adminHarness();
  h.flushAdminErrors();
  h.setLastEmailError({ text: 'The recipients address is corrupted' });
  h.reportEmailSendFailures(1, 257, [{ id: 'a1', name: 'Barbara Jones', email: 'barb.jones4@gmail.com' }]);
  const msg = h.writes[0].data.message;
  check('a send that missed one person names that person',
    msg.indexOf('Barbara Jones') !== -1 && msg.indexOf('barb.jones4@gmail.com') !== -1,
    'a count with no name cannot be acted on — it was 1 of 258 and nothing said which');
  check('and it points at the card that can send to them again, not at Email Setup',
    /Some emails did not go out/.test(msg) && /Send again to the ones it missed/.test(msg),
    'Email Setup is where the keys live, which is the right screen for a broken account ' +
    'and the wrong one for a bad address on a single record');
}

{
  /* ⚠ FIVE NAMES, THEN A COUNT. firestore.rules caps a message at 5,000 characters on
     CREATE, and a refused write is how this reporter goes silent — §5 records that failure
     reading like an auth fault for weeks. A send that fails wholesale must not be the thing
     that silences the folder. */
  const h = adminHarness();
  h.flushAdminErrors();
  h.setLastEmailError({ text: 'Gmail stopped the send' });
  const many = [];
  for (let i = 0; i < 40; i++) many.push({ id: 'c' + i, name: 'Customer ' + i, email: 'c' + i + '@example.com' });
  h.reportEmailSendFailures(40, 0, many);
  const msg = h.writes[0].data.message;
  check('a send that failed wholesale names a few and counts the rest',
    msg.indexOf('Customer 4') !== -1 && msg.indexOf('Customer 39') === -1 &&
    /…and 35 more/.test(msg),
    'forty addresses in one row is how a message hits the 5,000-character cap and is ' +
    'refused outright, which is worse than a short one');
  check('and the row is comfortably inside the 5,000-character cap',
    msg.length < 2000,
    'a refused write is a silent reporter — found ' + msg.length + ' characters');
}

{
  const h = adminHarness();
  h.flushAdminErrors();
  h.setLastEmailError({ text: 'no list was passed' });
  h.reportEmailSendFailures(2, 3);
  check('a sender that passes no list still reports the count and the reason',
    h.writes.length === 1 && h.writes[0].data.message.indexOf('no list was passed') !== -1,
    'the names are the improvement; losing the report itself would be a regression');
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
  /* ⚠ REPOINTED 2026-09-11, NOT WEAKENED. The shape gained a third argument — the list of
     people, which every one of these five already had in hand (EM-09) and none of them was
     passing on. The guarantee is unchanged and is now slightly stronger: a sender that
     reports its count without saying WHO is as much of a gap as one that reports nothing,
     because "1 of 258 failed" with no name is a customer nobody can go and find. */
  const calls = admin.split('reportEmailSendFailures(failed, sent, failedRecipients);').length - 1;
  check('every bulk email sender reports what failed, and who (structural)',
    calls === 5,
    'expected the four status-line senders plus the referral one; found ' + calls +
    '. A sender added later without this line fails silently exactly as they all used to');
  /* ⚠ REPOINTED 2026-09-09, NOT WEAKENED. This matched the whole catch INCLUDING its
     closing brace, so it was pinned to the catch doing nothing else — and it failed on
     correct code the moment one of them also recorded WHO the send failed for (EM-01).
     The guarantee has not moved: every one of the five still keeps the reason. Same
     slow-fuse shape as S82, S129 and the folder-names suite — a check anchored on where
     a string happened to sit rather than on what must be true. */
  /* The RSVP runner's own body, for the claims that are about IT rather than about
     the shared pacer. Sliced to the next real structural marker, never a fixed
     window (CLAUDE.md §7). */
  const runner = admin.slice(admin.indexOf('async function etSendTemplateRun('));
  const runnerBody = runner.slice(0, runner.indexOf('\ndocument.getElementById(\'etSendToSelectedBtn\')'));

  /* ⚠ REPOINTED AGAIN 2026-09-09 (EM-08), NOT WEAKENED. The pacing and the throttle stop
     moved out of the RSVP runner into `emailSendPaced`, because four of the five bulk
     senders never had them — so checks pinned to the runner's own inline copy began
     failing on code that is right. The guarantees are unchanged; they are asserted where
     the rule now lives. */
  const kept = (admin.split('lastEmailSendError = err;').length - 1)
             + (admin.split('lastEmailSendError = paced.err;').length - 1);
  check('and each of them keeps the reason instead of dropping it (structural)',
    kept === 5,
    'the catch used to be `catch(err){ failed++; }` — the count survived and the reason ' +
    'did not; found ' + kept);

  /* ⭐ THE ONE THAT MATTERS MOST NOW. Addie, on what this change is for: "I just want it
     to make it so we never have this happen again." It was true of ONE sender out of
     five — the invoice and receipt runs would have walked into the identical Gmail
     refusal on an identical back-to-back loop. */
  const pacedCalls = admin.split('emailSendPaced(').length - 1;
  check('every bulk email sender is paced, not just the RSVP one',
    pacedCalls === 5,
    'expected the helper plus one call in each of the four status-line senders; found ' +
    pacedCalls + '. A sender that skips it can still trip the limit that lost 392 emails');

  /* ⭐ AND EVERY ONE OF THEM NAMES WHO FAILED (EM-09). Addie: "it should also note whos
     email failed to send this is the biggest peice." Four of the five reported a bare
     COUNT — including the INVOICE and RECEIPT runs, so a customer whose bill never
     arrived was invisible and simply never chased. A count cannot be acted on; that is
     the whole lesson of the 392. */
  const named = admin.split('failedRecipients.push(').length - 1;
  const saved = (admin.split('await saveEmailSendFailures(').length - 1);
  check('every bulk sender records WHO it failed for, not just how many',
    named === 11 && saved === 7,
    'expected 11 pushes — three in the RSVP runner (no email, refused, untried after a ' +
    'stop) and two in each of the four others — and 7 saves: one per sender, the ' +
    'whole-RSVP button, and the retry rewriting the list. Found ' + named + ' push(es), ' +
    saved + ' save(s). A sender that only counts leaves those customers invisible, which ' +
    'is the whole lesson of the 392');

  /* ⚠ THE RULE IS IN TWO PLACES AND THAT IS A DELIBERATE, NAMED COST. The RSVP runner
     keeps its own inline copy because it was already shipped and working, and Addie's
     instruction was "make sure no code is changed unless we need the code changed" —
     rewriting a live send path for tidiness is not a need, and this very refactor broke
     the file once mid-edit. So the two copies are held together by the CONSTANTS instead,
     the money-parity shape applied to a rule: both must read the same three names, so a
     change to how fast we may send cannot move one and leave the other. If the runner is
     ever folded into the helper for its own reasons, delete this check with it. */
  /* ⚠ COMMENTS STRIPPED FIRST. The first version asked whether the names appeared in the
     runner AT ALL, and every one of them is also written out in the paragraph explaining
     the pacing — so a red-check that swapped the real `EMAIL_SEND_GAP_MS` for a hardcoded
     200 sailed straight through, reading the explanation as the code. Suites 58, 274, 275
     and 300 each learned this from the other direction. */
  const runnerCode = runnerBody
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const runnerPace = ['EMAIL_SEND_GAP_MS', 'EMAIL_MAX_AUTO_WAIT_MS', 'EMAIL_MAX_AUTO_WAITS']
    .every(function(n){ return runnerCode.indexOf(n) !== -1; });
  check('and the RSVP runner\'s own copy reads the same three limits as the helper',
    runnerPace,
    'the runner keeps an inline copy of the pacing; both must read the SAME constants, ' +
    'or changing how fast we send moves one sender and not the other');

  const helper = (function(){
    const i = admin.indexOf('async function emailSendPaced(');
    return i === -1 ? '' : admin.slice(i, admin.indexOf('async function etSendTemplateRun(', i));
  })();
  check('the shared pacer is findable', !!helper,
    'renamed or removed — repoint these checks rather than deleting them');
  check('and it waits between sends rather than firing them back to back',
    /await new Promise\(r => setTimeout\(r, EMAIL_SEND_GAP_MS\)\)/.test(helper),
    'sends went out ~1.7 a second and Gmail refused 392 of them');
  check('and a short rate-limit wait is sat through and the send carries on',
    /await new Promise\(r => setTimeout\(r, waitMs \+ 5000\)\)/.test(helper),
    'a rate limit that clears in minutes must be waited out, not handed to the office');
  check('and the automatic waiting is bounded by both a length and a count',
    /waitMs <= EMAIL_MAX_AUTO_WAIT_MS/.test(helper) && /EMAIL_MAX_AUTO_WAITS/.test(helper),
    'an unbounded auto-retry is a tab that looks busy for ever, and a long wait is the ' +
    'daily cap wearing a rate limit\u2019s clothes');
  /* ⚠ THE BUDGET IS SPENT ACROSS THE RUN, NOT RENEWED PER MESSAGE — per message it would
     allow six waits each and one run could sit for hours looking healthy. */
  /* ⚠ IT MUST READ THE CALLER'S COUNTER, not a fresh one. `/c\.autoWaits/` alone passed
     with `const c = {}` — the counter still existed, it was just reborn on every message,
     which is the per-message budget this forbids. Assert where `c` comes FROM. */
  check('and the wait budget is shared across the whole run',
    /const c = ctx \|\| \{\};/.test(helper) && /c\.autoWaits/.test(helper) &&
    admin.indexOf('paceCtx = { autoWaits: 0 }') !== -1,
    'a per-message budget lets one run wait dozens of times and look healthy doing it');

  /* ⚠ AND THE PACER MUST NOT WRAP THE MESSAGE BUILD (REF-20). Counted, not positioned:
     a check that only asked whether the FIRST call sat outside passed with a second one
     added inside. */
  const pacedAt = runnerBody.indexOf('for(;;){');
  const offers = runnerBody.split('referralOfferFor(member)').length - 1;
  check('and the retry wraps the send only, never the message build',
    pacedAt !== -1 && offers === 1 &&
    runnerBody.indexOf('referralOfferFor(member)') < pacedAt,
    'the referral offer must be resolved exactly ONCE per customer and outside the ' +
    'retry. Found ' + offers + ' call(s)');
  /* ⚠ THE RUNNER MUST NOT SAVE THEM ITSELF. Send the whole RSVP calls it twice, so a
     save inside would let the Not Paid pass overwrite the ordinary RSVP's failures and
     only half the book could be sent again. Each button saves once, for all its passes. */
  check('and it leaves the saving to the button, so two passes cannot overwrite each other',
    runnerBody.indexOf('saveEmailSendFailures(') === -1,
    'etSendTemplateRun calls saveEmailSendFailures itself — the second pass of the ' +
    'whole-RSVP send would erase the first pass’s list');
}

/* ---------------------------------------------------------------------------
 * Reading Gmail's refusal (EM-02).
 *
 * ⚠ RUN, NOT MATCHED. Every claim here is about what a string PARSES TO, which a
 * regex over the source cannot see — and the whole point of the function is to tell a
 * rate limit (wait, then carry on) from an ordinary bounce (skip that one person and
 * keep going). Getting that backwards either halts a whole send over one bad address
 * or spends four hundred requests being refused.
 * ------------------------------------------------------------------------- */
{
  const retryAfter = new Function(RETRY_AFTER_FN + '; return emailSendRetryAfter;')();

  /* ⭐ THE ACTUAL STRING FROM THE FAILED SEND, not an invented one. A fixture of
     made-up messages can pass while missing the one that happened — the lesson Suite
     274 records by name. This is what EmailJS handed back on 2026-09-09. */
  const real = { text: 'Gmail_API: User-rate limit exceeded. Retry after 2026-09-09T21:44:42.819Z (Mail sending)' };
  const got = retryAfter(real);
  check('the real Gmail refusal is read as a stop, with its time',
    got instanceof Date && got.toISOString() === '2026-09-09T21:44:42.819Z',
    'the send that failed said exactly this; if it does not parse, the run does not stop ' +
    'and the office is told nothing about when to try again. Got: ' + got);

  check('a rate limit with no time still stops the run',
    retryAfter({text: 'Gmail_API: rateLimitExceeded'}) instanceof Date,
    'rate-limited but undated is still rate-limited — carrying on spends the rest of ' +
    'the list finding that out');

  /* ⚠ THE SILENT SIDE MATTERS MORE THAN THE CATCH, same as EMAIL_LOOKALIKE_BUT_REAL.
     A parser that answers "stop" to an ordinary failure halts the season's RSVP over
     one bad address, and every customer behind it goes unasked. */
  check('an ordinary bounce does NOT stop the send',
    retryAfter({text: 'The recipient address is invalid'}) === null &&
    retryAfter({text: 'Bad Request'}) === null &&
    retryAfter({}) === null && retryAfter(null) === null,
    'only a refusal about RATE may halt the run; anything else is one customer skipped');

  /* A malformed date must not come back as an Invalid Date wearing a Date's clothes —
     `sendStoppedNote` would then print "Invalid Date" at the office. */
  const junk = retryAfter({text: 'User-rate limit exceeded. Retry after not-a-date'});
  check('and a time it cannot read still stops, without claiming a bogus one',
    junk instanceof Date && !isNaN(junk.getTime()),
    'an unreadable timestamp must fall back to a real one, not to Invalid Date');
}

/* ---------------------------------------------------------------------------
 * ⭐ WHO HIT THE ERROR ([[MSG-10]], 2026-09-09)
 *
 * Addie, reading a Member Errors folder in which one row was named and the rest were
 * blank: "we need to know who hit an error so you need to show me who hit that error."
 *
 * ⚠ THE BLANK ROWS WERE NOT A RENDERING FAULT. The heading already prints `name`; the
 * write had none, because an RSVP link that fails BEFORE sign-in has no record on the
 * page. Those are the rows that matter most — to that customer it looks like they
 * already answered — so this RUNS the resolver rather than matching its source.
 * ------------------------------------------------------------------------- */
{
  const liftFn = (src, n) => {
    const a = src.indexOf('function ' + n + '(');
    if (a === -1) throw new Error('could not find ' + n + '()');
    let i = src.indexOf('{', a), d = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') d++;
      else if (c === '}') { d--; if (!d) return src.slice(a, i + 1) + '\n'; }
    }
    throw new Error('could not lift ' + n + '() whole');
  };

  /* The office's own list, shaped the way admin holds it. Ashley carries the tail that
     appears in the real blank row; Adrienne carries the one from the row that WAS named. */
  const BOOK = [
    { id: 'c1', data: { name: 'Ashley Wray', customerNumber: 894, portalToken: 'abcdefghijklmnw5o9tx' } },
    { id: 'c2', data: { name: 'Adrienne Torkildson', portalToken: 'zzzzzzzzzzzzzzix2cng' } }
  ];
  const sb = {};
  new Function('jobAddresses',
    liftFn(admin, 'msgErrorTokenTail') + liftFn(admin, 'msgErrorWhoIs') + liftFn(admin, 'msgErrorWhoLabel') +
    'this.label = msgErrorWhoLabel; this.tail = msgErrorTokenTail;').call(sb, BOOK);

  /* ⚠ THE ACTUAL ROW FROM THE FOLDER, not an invented one. A fixture of made-up shapes
     can pass while missing the one that happened — the rule Suite 274 was corrected under. */
  const REAL_BLANK_ROW = {
    name: '',
    message: 'A customer hit an error on the website.\n\nWhat they were doing: Answering Back ' +
      'Next Year from the RSVP email\nWhat went wrong: internal\n\nThey were shown an apology ' +
      'and our phone number, so they may ring.\n\nPage they were on: ' +
      'https://highlightingutah.com/#/?token=\u2026w5o9tx&rsvp=back\n(their link is cut short ' +
      'on purpose — the last six characters still match their record)\nBrowser: Mozilla/5.0'
  };

  check('the row that named nobody is resolved from the link it carries',
    sb.label(REAL_BLANK_ROW).indexOf('Ashley Wray') === 0,
    'this is the real row out of the folder she was reading; got: ' + JSON.stringify(sb.label(REAL_BLANK_ROW)));

  check('and it says the name was worked out, not reported',
    /matched by their link/.test(sb.label(REAL_BLANK_ROW)),
    'the office should be able to tell which rows the page identified and which were ' +
    'matched from a token — printed plain, they read as equally certain');

  check('the customer number rides along, since that is what the office searches by',
    /#894/.test(sb.label(REAL_BLANK_ROW)));

  /* ⚠ THE HALF THAT MUST NOT MOVE. Every ordinary message already carries a name, and a
     resolver that spoke up there would put a second answer beside a real one. */
  check('a row that already has a name is left completely alone',
    sb.label({ name: 'Adrienne Torkildson', message: 'token=\u2026ix2cng' }) === '',
    'the heading prints the real name; this must add nothing to it');

  check('a new report carries the tail in its own field and needs no prose',
    sb.label({ name: '', tokenTail: 'w5o9tx', tokenKind: 'portal', message: 'no address in here' })
      .indexOf('Ashley Wray') === 0,
    'the field is what new rows will use; the prose match exists for the ones already filed');

  /* ⛔ A quoteToken BELONGS TO A QUOTE. Same shape, different collection — resolved against
     the customer list it would name a real person who had nothing to do with it. */
  check('a quote link is never resolved against the customer list',
    sb.tail({ message: 'they were on https://highlightingutah.com/#/q?quoteToken=\u2026w5o9tx' }) === '' &&
    sb.label({ name: '', message: '?quoteToken=\u2026w5o9tx' }) === '',
    'the key is anchored so the tail of the word quoteToken cannot pass for token=');

  check('and a portal tail that matches nobody says so rather than going quiet',
    /no customer matches/.test(sb.label({ name: '', message: '?token=\u2026zzzzzz' })),
    'a blank heading is what she reported; "nobody matches" is at least an answer');

  /* ⚠ TWO CANDIDATES IS NO MATCH. Naming the wrong customer on a report about a failure
     is worse than naming none — "a number never outranks a name that disagrees". */
  {
    const twin = {};
    new Function('jobAddresses',
      liftFn(admin, 'msgErrorTokenTail') + liftFn(admin, 'msgErrorWhoIs') + liftFn(admin, 'msgErrorWhoLabel') +
      'this.label = msgErrorWhoLabel;').call(twin, [
        { id: 'a', data: { name: 'One', portalToken: 'aaaaaaaaaaaaaaw5o9tx' } },
        { id: 'b', data: { name: 'Two', portalToken: 'bbbbbbbbbbbbbbw5o9tx' } }
      ]);
    check('two customers on one tail names neither',
      /more than one/.test(twin.label(REAL_BLANK_ROW)),
      'it must not take the first; that is a coin toss printed as a fact');
  }

  /* ⚠ AND THE RESOLVER HAS TO REACH THE SCREEN. Suite 276's lesson: a renderer proved
     against a harness while the page never calls it is green and useless. */
  check('the message heading actually calls it',
    /'<h4>'\+\(esc\(d\.name\) \|\| esc\(msgErrorWhoLabel\(d\)\)\)/.test(admin),
    'without this the resolver is correct and invisible, which is the state she reported');

  /* The client half: both records, and the tail written down. */
  check('the portal names a customer who signed in the ordinary way, not just by token',
    /if\(!who && typeof currentLookupRecord !== 'undefined' && currentLookupRecord\) who = currentLookupRecord;/.test(index),
    'currentJobAddressData is the token route only; the phone-and-surname sign-in fills ' +
    'currentLookupRecord, and reading one of the two named nobody for most customers');

  check('and the report writes the tail down as a field',
    /tokenTail:\s*\(memberErrorTokenTail\(\) \|\| \{\}\)\.tail \|\| null/.test(index) &&
    /tokenKind:\s*\(memberErrorTokenTail\(\) \|\| \{\}\)\.kind \|\| null/.test(index),
    'the kind travels with it, or a quote tail gets resolved against customers');

  /* ⚠ THE WHOLE TOKEN IS STILL NEVER WRITTEN. This widens what the office can SEE, not
     what is stored — `messages` is publicly creatable and that rule is unchanged. */
  {
    const fn = liftFn(index, 'memberErrorTokenTail');
    check('the tail is six characters and never the token',
      /slice\(-6\)/.test(fn) && !/val\s*\)/.test(fn.replace(/slice\(-6\)/g, '')),
      'six of thirty-six characters is a match; the whole token is a key to an account');
  }
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
