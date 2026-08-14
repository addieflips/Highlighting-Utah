/*
 * Highlighting Utah — full automated test suite
 *
 * Catches the things that have actually broken this project before:
 * missing element IDs, duplicate IDs, unbalanced divs, collections missing
 * from firestore.rules, queries missing a composite index, and quote cards
 * that render wrong.
 *
 * Setup (once):   npm install jsdom
 * Run:            node run-all.js   (from the repo root)
 *
 * Exits 0 if everything passes, 1 if anything fails.
 * Runs entirely offline — never touches Firebase or real customer data.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Works whether this file sits at the repo root (normal case) or has been
// copied into a tests/ subfolder alongside the repo (the old CLAUDE.md shim) —
// resolve ROOT by finding which one actually has admin.html next to it,
// instead of assuming a fixed layout.
const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0, warn = 0;
const results = [];

function check(suite, name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '\n          ' + extra : ''));
    results.push(suite + ': ' + name);
  }
}
function note(msg) { warn++; console.log('  NOTE  ' + msg); }
/*
 * gap() marks a known disconnect: data collected in one place that never
 * reaches the place built to consume it. Reported every run but does NOT
 * fail the build, so the suite stays usable. When one is fixed the line
 * flips to PASS on its own — no edit needed here.
 */
const gaps = [];
function gap(name, fixed, detail) {
  if (fixed) { pass++; console.log('  PASS  ' + name + '  (gap closed)'); }
  else { console.log('  GAP   ' + name + '\n          ' + detail); gaps.push(name + ' — ' + detail); }
}
function suite(title) { console.log('\n=== ' + title + ' ==='); }
/*
 * Most of this suite is synchronous. A few checks have to RUN real app code
 * that is written as `async` (syncPayerInvoice), and an async function's body
 * finishes after this file's last line unless something waits for it. Anything
 * pushed here is awaited before the summary is printed — otherwise those checks
 * score after the totals and a failure would exit 0.
 */
const pendingAsync = [];

const HTML_FILES = ['index.html', 'admin.html', 'employee.html'];

/*
 * Element IDs referenced by JS that have no markup — already tracked, not
 * new breakage. Anything NOT on this list is a real regression and fails.
 *
 *  - the admin ones are the dead Automation email panel (handoff Decision #4)
 *  - the index.html ones are guarded fallbacks and the unbuilt RSVP reason box
 * Delete entries from this list as those features get built or removed.
 */
const KNOWN_MISSING_IDS = [
  'rsvpReasonWrap', 'quoteConfirm', 'quoteConfirmMsg',
  /^quickEmail/, /^bulkAuto/, /^bulkUpdateEmail/, /^bulkText/,
  /^rsvpEmail/, /^rsvpInclude/, /^rsvpPreview/, /^rsvpRecipient/, /^rsvpSelect/,
  /^pib[A-Z]/, /^loadBulk/, 'sendRsvpEmailBtn', 'sendBulkUpdateEmailBtn'
];

// =====================================================================
// 1. STRUCTURE — the file itself is well formed
// =====================================================================
suite('1. Structure');

const inlineScripts = html =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);

HTML_FILES.forEach(file => {
  const html = read(file);

  // --- JavaScript parses ---
  const js = inlineScripts(html).join('\n;\n');
  const tmp = path.join(require('os').tmpdir(), file + '.check.js');
  fs.writeFileSync(tmp, js);
  let jsOk = true, jsErr = '';
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { jsOk = false; jsErr = String(e.stderr || e).split('\n').slice(0, 3).join(' '); }
  check('structure', file + ' — JavaScript parses', jsOk, jsErr);
  fs.unlinkSync(tmp);

  // --- div balance ---
  const open = (html.match(/<div\b/gi) || []).length;
  const close = (html.match(/<\/div>/gi) || []).length;
  check('structure', file + ' — divs balanced', open === close,
    open + ' open vs ' + close + ' close');

  // --- duplicate static IDs ---
  const ids = [...html.matchAll(/(?<!\\)id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
  const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  check('structure', file + ' — no duplicate element IDs', dupes.length === 0,
    'duplicated: ' + dupes.join(', '));

  // --- IDs referenced by JS that exist nowhere ---
  const refs = new Set([
    ...[...html.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]/g)].map(m => m[1]),
    ...[...html.matchAll(/querySelector\(\s*['"]#([A-Za-z0-9_-]+)['"]/g)].map(m => m[1])
  ]);
  const defined = new Set([
    ...[...html.matchAll(/id\s*=\s*\\?["']([A-Za-z0-9_-]+)\\?["']/g)].map(m => m[1])
  ]);
  // prefixes like getElementById('panel-' + x) are built at runtime, not literal
  const allMissing = [...refs].filter(r => !defined.has(r) && !r.endsWith('-'));
  const known = allMissing.filter(id => KNOWN_MISSING_IDS.some(k =>
    typeof k === 'string' ? k === id : k.test(id)));
  const missing = allMissing.filter(id => !known.includes(id));
  check('structure', file + ' — no NEW missing element IDs',
    missing.length === 0,
    'referenced but never defined: ' + missing.join(', '));
  if (known.length) note(file + ' — ' + known.length + ' known missing IDs (see handoff Decision #4)');
});

// =====================================================================
// 2. FIREBASE CONFIG — rules and indexes cover what the code actually does
// =====================================================================
suite('2. Firebase config');

const allHtml = HTML_FILES.map(read).join('\n');
const rules = read('firestore.rules');
const indexes = JSON.parse(read('firestore.indexes.json'));

// --- every collection touched has a rules entry ---
const collections = [...new Set(
  [...allHtml.matchAll(/collection\(\s*(?:db\s*,\s*)?['"]([A-Za-z0-9_]+)['"]/g)].map(m => m[1])
)];
const unruled = collections.filter(c => !rules.includes('/' + c + '/{'));
check('config', 'every Firestore collection has a rules entry', unruled.length === 0,
  'missing from firestore.rules (denied by default): ' + unruled.join(', '));
note(collections.length + ' collections in use');

// --- every where+orderBy query has a composite index ---
function findQueries(src) {
  const out = [];
  for (const m of src.matchAll(/query\s*\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const body = src.slice(m.index, i);
    if (body.includes('where') && body.includes('orderBy')) out.push(body);
  }
  return out;
}

const haveIndex = (coll, fields) => indexes.indexes.some(ix =>
  ix.collectionGroup === coll &&
  fields.every(f => ix.fields.some(xf => xf.fieldPath === f)));

let queryProblems = [];
HTML_FILES.forEach(file => {
  findQueries(read(file)).forEach(q => {
    const coll = (q.match(/collection\(\s*db\s*,\s*['"]([A-Za-z0-9_]+)['"]/) || [])[1];
    if (!coll) return;
    const fields = [
      ...[...q.matchAll(/where\(\s*['"]([A-Za-z0-9_.]+)['"]/g)].map(m => m[1]),
      ...[...q.matchAll(/orderBy\(\s*['"]([A-Za-z0-9_.]+)['"]/g)].map(m => m[1])
    ];
    const unique = [...new Set(fields)];
    if (unique.length < 2) return;
    if (!haveIndex(coll, unique))
      queryProblems.push(file + ': ' + coll + ' (' + unique.join(' + ') + ')');
  });
});
check('config', 'every where+orderBy query has a composite index',
  queryProblems.length === 0,
  'no matching index — will throw failed-precondition:\n          ' + queryProblems.join('\n          '));

// --- indexes file is valid and non-empty ---
check('config', 'firestore.indexes.json is valid and populated',
  Array.isArray(indexes.indexes) && indexes.indexes.length > 0);

// --- manifest is a single valid JSON document ---
try {
  const m = JSON.parse(read('manifest.json'));
  check('config', 'manifest.json is a single valid manifest', !!m.name && !!m.start_url);
} catch (e) {
  check('config', 'manifest.json is a single valid manifest', false, String(e.message));
}

// =====================================================================
// 3. KNOWN BUG PATTERNS — lessons from the handoff, turned into guards
// =====================================================================
suite('3. Known bug patterns');

check('patterns', 'no phone.indexOf(\'\') match bug',
  !/\.indexOf\(\s*['"]{2}\s*\)/.test(allHtml),
  'indexOf("") always returns 0, which defeats name-only searches');

check('patterns', 'ensureJobAddressId helper still present',
  allHtml.includes('ensureJobAddressId'),
  'this fixes a silent save race — do not remove it');

check('patterns', 'render calls still wrapped for isolation',
  allHtml.includes('Render failed'),
  'one failing render used to silently kill ~20 others');
check('patterns', 'error catcher is present in admin',
  allHtml.includes('errCatchBadge') && allHtml.includes("addEventListener('error'"),
  'without it a broken render is invisible on a phone');
check('patterns', 'error catcher still calls the real console.error',
  /origError\.apply\(console, arguments\)/.test(allHtml),
  'wrapping console.error must never swallow the original message');
check('patterns', 'error catcher dedupes on the raw message',
  allHtml.includes('seen[text]'),
  'comparing timestamped lines never matches and a loop fills the list');

// =====================================================================
// 4. PURE LOGIC — money and counting math
// =====================================================================
suite('4. Business logic');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const admin = read('admin.html');

/* The money and sizing rules moved out of admin.html into js/money.js so they
   can be tested on their own. extractFn matches "function name(" which is still
   there inside "export function name(", so the same helper reads either file.
   If a rule ever moves back into admin.html, these two reads are what to fix. */
const money = read('js/money.js');
const computeInvoiceStatusSrc = extractFn(money, 'computeInvoiceStatus');
const cnBinsForFeetSrc = extractFn(money, 'cnBinsForFeet');
const custInvoiceKeySrc = extractFn(money, 'custInvoiceKey');
const statusClassSrc = extractFn(money, 'statusClass');
// computeInvoiceStatus compares whole cents, so its rounding helper has to be
// eval'd alongside it. Lifted from the real file, never stubbed here — a stub
// would keep the tests green through a change to the actual rounding rule.
const centsOfSrc = extractFn(money, 'centsOf');
const whGroupKeySrc      = extractFn(admin, 'whGroupKey');
const whNormalizeLightsSrc = extractFn(admin, 'whNormalizeLights');
const whWireLabelSrc     = extractFn(admin, 'whWireLabel');
const CN_DOUBLE_BIN_FEET = Number((money.match(/CN_DOUBLE_BIN_FEET\s*=\s*(\d+)/) || [])[1]);
eval([centsOfSrc, computeInvoiceStatusSrc, cnBinsForFeetSrc, custInvoiceKeySrc, statusClassSrc,
      whWireLabelSrc, whNormalizeLightsSrc, whGroupKeySrc].filter(Boolean).join('\n'));

/* The split only works if admin.html actually pulls the rules back in. Without
   these two checks, deleting the import would leave every balance on screen
   undefined and no test would notice. */
check('logic', 'admin.html imports the rules from js/money.js',
  /from\s+['"]\.\/js\/money\.js['"]/.test(admin),
  'admin.html no longer imports js/money.js — balances and bin counts will be undefined on screen');
check('logic', 'admin.html imports every name it lost',
  ['computeInvoiceStatus', 'statusClass', 'enrollmentYearOf', 'custInvoiceKey',
   'cnBinsForFeet', 'fmtMoney', 'CN_DOUBLE_BIN_FEET'].every(n => new RegExp('\\b' + n + '\\b').test(
     (admin.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/js\/money\.js['"]/) || [''])[0])),
  'one of the moved names is used in admin.html but missing from the money.js import list');
check('logic', 'the rules are not also still defined in admin.html',
  !/\bfunction\s+computeInvoiceStatus\s*\(/.test(admin),
  'computeInvoiceStatus is defined in admin.html AND exported from money.js — two copies will drift apart');

check('logic', 'computeInvoiceStatus exists', typeof computeInvoiceStatus === 'function');
check('logic', 'nothing paid is Unpaid', computeInvoiceStatus(500, 0, 0) === 'Unpaid');
check('logic', 'part paid is Partial Payment', computeInvoiceStatus(500, 0, 200) === 'Partial Payment');
check('logic', 'fully paid is Paid in Full', computeInvoiceStatus(500, 0, 500) === 'Paid in Full');
check('logic', 'overpaid still Paid in Full', computeInvoiceStatus(500, 0, 600) === 'Paid in Full');
check('logic', 'removal counts toward the total',
  computeInvoiceStatus(500, 100, 500) === 'Partial Payment',
  'expected Partial — 500 paid against a 600 total');
check('logic', 'zero-value invoice is Unpaid', computeInvoiceStatus(0, 0, 0) === 'Unpaid');

/*
 * New Hang badge. This used to be guessed from createdAt ("enrolled 14+ days ago
 * and still not scheduled"), which flagged all ~945 houses at once, because the
 * bulk import stamped every record with the same createdAt and out of season
 * nobody is scheduled. It now reads the office's own chargeNewMemberFee decision.
 * These checks exist so it can never quietly drift back to a date guess.
 */
// Comments are stripped before any "does this code still mention X" test below.
// Both of these functions carry a comment explaining the createdAt trap they
// exist to avoid, and a naive source search matches that explanation and fails.
const stripComments = s => (s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const isNewHangUrgentSrc = extractFn(admin, 'isNewHangUrgent');
eval(isNewHangUrgentSrc);
const oldCreatedAt = { toDate: () => new Date(Date.now() - 400 * 86400000) };
check('logic', 'isNewHangUrgent exists', typeof isNewHangUrgent === 'function');
check('logic', 'New Hang flags a new member awaiting install',
  isNewHangUrgent({ chargeNewMemberFee: true, createdAt: oldCreatedAt }) === true);
check('logic', 'New Hang ignores a returning customer, however long enrolled',
  isNewHangUrgent({ createdAt: oldCreatedAt }) === false,
  'a record with chargeNewMemberFee unset must never be flagged — that is the ~945-house bug');
check('logic', 'New Hang ignores an explicit non-new member',
  isNewHangUrgent({ chargeNewMemberFee: false, createdAt: oldCreatedAt }) === false);
check('logic', 'New Hang clears once scheduled',
  isNewHangUrgent({ chargeNewMemberFee: true, scheduled: true }) === false);
check('logic', 'New Hang clears once completed',
  isNewHangUrgent({ chargeNewMemberFee: true, completed: true }) === false);
check('logic', 'New Hang no longer reads createdAt at all',
  !/createdAt|daysSince/.test(stripComments(isNewHangUrgentSrc)),
  'the enrollment-date guess is back — every imported house shares one createdAt, so it flags everybody');

/*
 * The $30 new member fee, decided by looksLikeNewMember in the nightly invoice
 * function. Same trap as the badge above, but this one spends money: an unset
 * checkbox used to fall back to "did they enrol this calendar year?", and the
 * bulk import stamped all ~945 records with a current-year createdAt, so the
 * whole book would have been charged $30 the night each install completed.
 * The checkbox is now the only authority. These checks keep it that way.
 */
const fnsSrc = read('functions/index.js');
const looksLikeNewMemberSrc = extractFn(fnsSrc, 'looksLikeNewMember');
eval(looksLikeNewMemberSrc);
const importedRecord = { createdAt: { toDate: () => new Date() } };   // this year, as the import left it
check('logic', 'looksLikeNewMember exists', typeof looksLikeNewMember === 'function');
check('logic', 'the fee follows a ticked new-member box',
  looksLikeNewMember({ chargeNewMemberFee: true }) === true);
check('logic', 'an unset box never charges the fee',
  looksLikeNewMember(importedRecord) === false,
  'this is the ~945-customer overcharge — an untouched checkbox must mean no fee');
check('logic', 'an unticked box never charges the fee',
  looksLikeNewMember(Object.assign({ chargeNewMemberFee: false }, importedRecord)) === false);
check('logic', 'the fee decision no longer reads createdAt',
  !/createdAt/.test(stripComments(looksLikeNewMemberSrc)),
  'the enrollment-year guess is back — it would charge $30 to every imported customer');
check('logic', 'admin preview and the nightly function agree on who is new',
  /chargeNewMemberFee === true/.test(admin) && /chargeNewMemberFee === true/.test(fnsSrc),
  'if these two drift apart, the office sees one invoice total and the customer is billed another');
/* ---- rules that could not be tested until they moved into js/money.js ----
   These cover the two things that have actually gone wrong before: the light-
   change fee being dropped from a balance (which once made PayPal undercharge)
   and credits pushing a balance below zero. */

check('logic', 'light-change fee counts toward the total',
  computeInvoiceStatus(500, 0, 500, 0, 30) === 'Partial Payment',
  'expected Partial — 500 paid against 500 install + 30 change fee. This is the PayPal undercharge bug.');
check('logic', 'a fee on its own leaves the invoice Unpaid',
  computeInvoiceStatus(0, 0, 0, 0, 30) === 'Unpaid');
check('logic', 'credits reduce what is owed',
  computeInvoiceStatus(500, 0, 450, 50) === 'Paid in Full',
  'expected Paid in Full — 450 paid plus a 50 credit covers 500');
check('logic', 'a credit larger than the bill still reads Paid in Full',
  computeInvoiceStatus(400, 0, 0, 500) === 'Paid in Full',
  'a credit bigger than the charge must never leave the invoice Unpaid');

/* ---- cents ---------------------------------------------------------------
   Floating point leaves crumbs: 0.1 + 0.2 is 0.30000000000000004. A customer
   who has paid every cent could come out a fraction short, get filed as
   "Partial Payment" against a balance that PRINTS as $0.00, and sit on the
   unpaid list forever with nothing on screen to explain why. Both copies of
   the formula compare whole cents now (centsOf) — money-parity.test.js proves
   they still agree with each other. */
check('logic', 'a payment made of awkward thirds still reads Paid in Full',
  computeInvoiceStatus(0.1, 0.2, 0.3) === 'Paid in Full',
  'a third of a cent left over would leave a fully paid invoice looking Partial');
check('logic', 'paying an exact cent total is Paid in Full',
  computeInvoiceStatus(499.99, 0, 499.99) === 'Paid in Full');
check('logic', 'install plus fee paid to the cent is Paid in Full',
  computeInvoiceStatus(1234.5, 0, 1264.5, 0, 30) === 'Paid in Full',
  'the real shape of the bug: install + a $30 change fee, paid in full');
check('logic', 'a genuine cent still short is still Partial Payment',
  computeInvoiceStatus(500, 0, 499.99) === 'Partial Payment',
  'rounding must not round a real shortfall away');
check('logic', 'fmtMoney always shows cents',
  /minimumFractionDigits:\s*2/.test(money) && /maximumFractionDigits:\s*2/.test(money),
  '$1,234.50 printed as "$1,234.5", and disagreed with the customer\'s emailed invoice');
check('logic', 'a credit exactly equal to the bill reads Paid in Full',
  computeInvoiceStatus(400, 0, 0, 400) === 'Paid in Full');
check('logic', 'money paid against nothing charged is not left Unpaid',
  computeInvoiceStatus(0, 0, 50) === 'Paid in Full',
  'gross is 0 but 50 was paid, so the blank-invoice rule must not apply');
check('logic', 'missing credits/fees arguments are treated as zero',
  computeInvoiceStatus(500, 0, 500) === computeInvoiceStatus(500, 0, 500, 0, 0),
  'old three-argument call sites must behave identically to the full five-argument form');

check('logic', 'statusClass maps each status to a pill colour',
  statusClass('Paid in Full') === 'status-paid' &&
  statusClass('Partial Payment') === 'status-partial' &&
  statusClass('Unpaid') === 'status-due');

check('logic', 'the bin cutoff is 260 feet, not 200',
  CN_DOUBLE_BIN_FEET === 260,
  'some UI text and older notes say 200 — the code has always used 260');
check('logic', '260 feet is still one bin',
  cnBinsForFeet(260) === 1, 'the cutoff is "over 260", so 260 itself stays single-bin');
check('logic', '261 feet needs two bins', cnBinsForFeet(261) === 2);
check('logic', 'blank or junk feet does not become a two-bin house',
  cnBinsForFeet(0) === 1 && cnBinsForFeet('') === 1 &&
  cnBinsForFeet(null) === 1 && cnBinsForFeet('abc') === 1);

check('logic', 'invoice key uses phone digits when a phone exists',
  custInvoiceKey({ phone: '(801) 555-1234', email: 'A@B.com' }) === '8015551234');
check('logic', 'invoice key ignores how the phone was typed',
  custInvoiceKey({ phone: '(801) 555-1234' }) === custInvoiceKey({ phone: '801-555-1234' }) &&
  custInvoiceKey({ phone: '801-555-1234' }) === custInvoiceKey({ phone: '8015551234' }),
  'the same person typed three ways must resolve to one invoice, not three');
check('logic', 'invoice key falls back to a lowercased email',
  custInvoiceKey({ email: '  Jane@Example.COM ' }) === 'jane@example.com');
check('logic', 'a customer with no phone and no email has no invoice key',
  custInvoiceKey({}) === '' && custInvoiceKey(null) === '',
  'callers must treat an empty key as "cannot bill this customer" rather than writing to a blank document id');

/* Not a bug in this file — a property of the design, recorded so nobody is
   surprised by it later. Two customers sharing a household phone resolve to the
   same invoice. See the duplicate-phone test in the QA workbook. */
gap('two customers sharing a phone share one invoice key',
  false,
  'custInvoiceKey({phone:X}) is identical for two different people with the same number, so they map to one invoice document. Verify what this does in practice before the season.');

const projTestSyncDecisionSrc = extractFn(admin, 'projTestSyncDecision');
eval(projTestSyncDecisionSrc);

check('logic', 'projTestSyncDecision exists', typeof projTestSyncDecision === 'function');
{
  // row shape: [num, area, name, steps, expected, version, result, notes, retestReason]
  const freshRow    = [1, 'Public Site', 'Quote request form', 'steps v1', 'expected v1', 1, 'Pass', '', ''];
  const blankRow     = [30, 'Admin', 'Quote declined', 'steps', 'expected', 1, '', '', ''];
  const bumpedRow    = [23, 'Admin', 'Add Customer - feet drives number preview', 'steps v2', 'expected v2', 2, '', '', ''];
  const bumpedRowMsg = [20, 'Admin', 'Quotes - detail form', 'steps v2', 'expected v2', 2, '', '', 'Feature changed since this last passed.'];
  const rewordedRow  = [1, 'Public Site', 'Quote request form', 'steps v2 (clarified)', 'expected v1', 1, 'Pass', '', ''];
  const unchangedRow = freshRow;

  const addDecision = projTestSyncDecision(undefined, freshRow);
  check('logic', 'sync: brand-new test gets added', addDecision.action === 'add');
  check('logic', 'sync: a new test keeps its seeded starting result',
    addDecision.action === 'add' && addDecision.data.result === 'Pass');

  const addBlankDecision = projTestSyncDecision(undefined, blankRow);
  check('logic', 'sync: a new never-scored test adds as blank (Needs Test), not undefined',
    addBlankDecision.action === 'add' && addBlankDecision.data.result === '');

  const retestDecision = projTestSyncDecision({ version: 1, result: 'Pass' }, bumpedRow);
  check('logic', 'sync: version bump on an already-scored test flags Retest',
    retestDecision.action === 'retest' && retestDecision.data.result === 'Retest');
  check('logic', 'sync: Retest gets a default reason when the seed row gives none',
    retestDecision.action === 'retest' && !!retestDecision.data.retestReason);
  const retestMsgDecision = projTestSyncDecision({ version: 1, result: 'N/A' }, bumpedRowMsg);
  check('logic', 'sync: Retest uses the seed row\'s own explanation when it has one',
    retestMsgDecision.data.retestReason === 'Feature changed since this last passed.');

  const rewordDecision = projTestSyncDecision(
    { version: 1, area: 'Public Site', name: 'Quote request form', steps: 'steps v1 (old wording)', expected: 'expected v1', result: 'Pass' },
    rewordedRow
  );
  check('logic', 'sync: same version but different wording rewords in place',
    rewordDecision.action === 'reword');
  check('logic', 'sync: a reword never carries a result - it must not overwrite an existing Pass/Fail',
    rewordDecision.action === 'reword' && !('result' in rewordDecision.data));

  const noneDecision = projTestSyncDecision(
    { version: 1, area: 'Public Site', name: 'Quote request form', steps: 'steps v1', expected: 'expected v1', result: 'Pass' },
    unchangedRow
  );
  check('logic', 'sync: nothing changed means nothing to do (no write)', noneDecision.action === 'none');

  const missingVersionDecision = projTestSyncDecision(
    { area: 'Public Site', name: 'Quote request form', steps: 'steps v1', expected: 'expected v1', result: 'Pass' },
    unchangedRow
  );
  check('logic', 'sync: a doc saved before versioning existed defaults to version 1, not a false Retest',
    missingVersionDecision.action === 'none');
}

const projShouldPruneTestSrc = extractFn(admin, 'projShouldPruneTest');
eval('const CUSTOM_TEST_START = 1000;\n' + projShouldPruneTestSrc);

check('logic', 'projShouldPruneTest exists', typeof projShouldPruneTest === 'function');
{
  const seededIds = new Set(['t1', 't2', 't3']);
  check('logic', 'prune: a test still in TEST_SEED is never pruned, even if scored',
    !projShouldPruneTest('t1', { num: 1, result: 'Pass' }, seededIds));
  check('logic', 'prune: a retired test scored Pass is pruned',
    projShouldPruneTest('t9', { num: 9, result: 'Pass' }, seededIds));
  check('logic', 'prune: a retired test scored Fail is pruned',
    projShouldPruneTest('t9', { num: 9, result: 'Fail' }, seededIds));
  check('logic', 'prune: a retired test still Needs Test is left alone - not an automatic delete',
    !projShouldPruneTest('t9', { num: 9, result: '' }, seededIds));
  check('logic', 'prune: a retired test on Retest is left alone',
    !projShouldPruneTest('t9', { num: 9, result: 'Retest' }, seededIds));
  check('logic', 'prune: a retired test marked N/A is left alone',
    !projShouldPruneTest('t9', { num: 9, result: 'N/A' }, seededIds));
  check('logic', 'prune: a one-off test is never pruned, even if its own made-up id is missing from seededIds',
    !projShouldPruneTest('abc123', { num: 1000, result: 'Pass' }, seededIds));
}

/*
 * Checklist wording drift. TEST_SEED can only stay accurate if it gets
 * updated in the same change that renames a button or moves a feature — the
 * sync mechanism has no way to detect that on its own (see CLAUDE.md §0/§2).
 * This is the mechanical backstop: retired UI terms that must never show up
 * in a test's steps/expected again. It caught nothing retroactively (the
 * "approval link" tests were already fixed by hand before this existed) —
 * its job is to catch the NEXT time it happens.
 *
 * Add an entry here every time a checklist-referenced button/label gets
 * renamed. Format: [retired phrase, why/what replaced it].
 */
const RETIRED_CHECKLIST_TERMS = [
  ['approval link', 'the Get Approval Link button was renamed to Send Email on 2026-08-08 (it now also shows the filled-in email, not just the link)'],
  ['get approval link', 'renamed to Send Email on 2026-08-08'],
  ['copy quote email', 'renamed to Show Quote Email Again on 2026-08-08 (Send Email now shows the email on the first click)'],
  ['replace photo', 'quote cards hold several photos now, so the button reads Add More Photos (2026-08-13)'],
];
{
  const seedStart = admin.indexOf('const TEST_SEED = [');
  const seedEnd = admin.indexOf('\n];', seedStart) + 3;
  const TEST_SEED = new Function(admin.slice(seedStart, seedEnd) + '; return TEST_SEED;')();
  for (const [term, why] of RETIRED_CHECKLIST_TERMS) {
    const hits = TEST_SEED.filter(row => (row[3] + ' ' + row[4]).toLowerCase().includes(term));
    check('logic', 'checklist wording: no test still says "' + term + '"',
      hits.length === 0,
      hits.length ? ('#' + hits.map(r => r[0]).join(', #') + ' — ' + why) : undefined);
  }
}

/* --- warehouse colour grouping ------------------------------------------
 * REPLACED 2026-08-14. This block used to test colorComboKey, a helper that
 * no longer exists in admin.html — it had been replaced by whGroupKey, so the
 * suite reported a permanent GAP for a function nobody was going to restore.
 *
 * whGroupKey originally did NOT sort, which meant "Red, Green" and
 * "Green, Red" built as two separate warehouse groups and the same bundle got
 * made twice. Confirmed with the owner that order does not matter for
 * grouping, and whGroupKey now sorts (via whNormalizeLights).
 *
 * ⚠ employee.html carries its OWN copy of these three functions. The last
 * check below is the one that stops the office and the crew drifting apart.
 */
check('logic', 'whGroupKey exists', typeof whGroupKey === 'function');
if (typeof whGroupKey === 'function') {
  check('logic', 'the same pattern typed in a different order is ONE group',
    whGroupKey('Red, Green', 'White') === whGroupKey('Green, Red', 'White'),
    'this is the duplicate-bundle bug — the warehouse would build the same combo twice');
  check('logic', 'repeated colours still make a different pattern',
    whGroupKey('Red, Red, Green', 'White') !== whGroupKey('Red, Green, Green', 'White'),
    'two Reds and one Green is not the same strand as one Red and two Greens');
  check('logic', 'wire colour still separates two otherwise identical groups',
    whGroupKey('Red, Green', 'White') !== whGroupKey('Red, Green', 'Green'));
  check('logic', 'messy spacing does not create a second group',
    whGroupKey('  Red ,  Green  ', 'White') === whGroupKey('Green,Red', 'White'));
  check('logic', 'a trailing note is not sorted in among the colours',
    /\(extra on garage\)$/.test(whGroupKey('Red, Green (extra on garage)', 'White')
      .split(' \u2014 ')[0]),
    'the note must stay at the end, not get shuffled into the colour list');
  check('logic', 'grouping does not mutate the caller\'s text',
    (() => { const t = 'Red, Blue'; whGroupKey(t, 'White'); return t === 'Red, Blue'; })());
  check('logic', 'a house with no lights recorded still groups',
    whGroupKey('No lights recorded', 'White').indexOf('No lights recorded') === 0);

  /* The copies must agree, or the office and the crew see different groups. */
  const empNorm = extractFn(read('employee.html'), 'whNormalizeLights');
  check('logic', 'employee.html sorts colours the same way admin does',
    !!empNorm && empNorm.replace(/\s+/g, ' ') ===
      (whNormalizeLightsSrc || '').replace(/\s+/g, ' '),
    'admin.html and employee.html have drifted — the crew would group houses differently');
}

// --- bundle math: ceil(feet / 40) ---
const bundles = feet => Math.ceil(feet / 40);
check('logic', 'bundles: 40 ft is 1 bundle', bundles(40) === 1);
check('logic', 'bundles: 41 ft rounds up to 2', bundles(41) === 2);
check('logic', 'bundles: 200 ft is 5', bundles(200) === 5);

// --- footage estimate: price / rate * 1.05, padded upward ---
const estFeet = (price, rate) => (price / rate) * 1.05;
check('logic', 'footage estimate pads upward, never down',
  estFeet(400, 2) > 400 / 2);
check('logic', 'footage estimate then bundles up',
  bundles(estFeet(400, 2)) === Math.ceil(210 / 40));

/* --- bin rule ------------------------------------------------------------
 * FIXED 2026-08-14. This block used to define its own
 *     const bins = feet => (feet > 200 ? 2 : 1);
 * and then assert against THAT — a lambda living in this test file, not the
 * app. It passed no matter what admin.html or js/money.js did, and it encoded
 * the OLD 200ft rule, which the real cutoff (CN_DOUBLE_BIN_FEET = 260) has not
 * matched for some time. A test that cannot fail is worse than no test: it
 * reports confidence it has not earned.
 * Now it calls the real cnBinsForFeet, lifted out of js/money.js above.
 * The 260/261 boundary is already covered around line 362 — these add the
 * everyday values and the one that used to be wrong. */
check('logic', 'bins: 200 ft is 1 bin (real cnBinsForFeet, not a local copy)',
  cnBinsForFeet(200) === 1);
check('logic', 'bins: 201 ft is STILL 1 bin — the cutoff is 260, not 200',
  cnBinsForFeet(201) === 1,
  'if this fails the bin cutoff moved back to 200 — check CN_DOUBLE_BIN_FEET in js/money.js');
check('logic', 'bins: 400 ft is 2 bins', cnBinsForFeet(400) === 2);

// --- comma-separated colour parsing (quote Detail Form save handler) ---
const csv = v => v.split(',').map(s => s.trim()).filter(Boolean);
check('logic', 'csv parses a colour sequence',
  JSON.stringify(csv('Warm White, Red, Red')) === '["Warm White","Red","Red"]');
check('logic', 'csv tolerates messy spacing and empties',
  JSON.stringify(csv('  Red ,, Green  ,')) === '["Red","Green"]');
check('logic', 'csv of blank input is an empty list',
  csv('').length === 0 && csv('   ').length === 0);
check('logic', 'csv round trip is stable',
  JSON.stringify(csv(csv('Red,,Green').join(', '))) === '["Red","Green"]',
  'repeated saves must not accumulate junk');

// =====================================================================
// 5. QUOTE CARD RENDERING
// =====================================================================
suite('5. Quote card rendering');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  note('jsdom not installed — skipping render tests. Run: npm install jsdom');
}

if (JSDOM) {
  const dom = new JSDOM('<div id="quotesList"></div>');
  global.document = dom.window.document;

  global.esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  global.fmtDate = () => 'Aug 3';
  global.fmtMoney = n => '$' + Number(n).toFixed(2);
  global.daysSince = () => 3;
  global.isStaleUnresponsive = () => false;
  global.trashIcon = () => '<svg></svg>';
  global.perFootRate = 2.5;
  global.attachDeleteHandlers = () => {};
  // renderQuoteRows calls quoteStage(d) for the New house / Old house badge.
  // Mirrors the real one in admin.html — without it the whole suite crashed
  // out here rather than reporting a failure.
  global.quoteStage = d => {
    if ((d.status || 'new') === 'closed' || d.quoteArchived ||
        d.approvalStatus === 'declined' || d.approvalStatus === 'maybe_next_year') return 'closed';
    if (typeof d.quotedPrice !== 'number') return 'new';
    if (d.approvalStatus === 'approved' && d.formCompleted) return 'form';
    return 'send';
  };

  // Sliced through the end of renderQuoteRows (not just up to innerHTML) so
  // the data-pricingtoggle click handler is actually live for the toggle test.
  const s = admin.indexOf('const quotePricingOpenIds = new Set();');
  const mark = 'attachDeleteHandlers(list);';
  const e = admin.indexOf(mark, s) + mark.length;

  if (s === -1 || e < s) {
    check('render', 'found renderQuoteRows in admin.html', false,
      'function was renamed or removed — update this test');
  } else {
    // eval'd `const` is scoped to the eval call itself and never reaches this
    // scope afterward (unlike the function declaration, which does) — rewrite
    // the one declaration to a global so the toggle tests below can reach it.
    const src = admin.slice(s, e)
      .replace('const quotePricingOpenIds = new Set();', 'global.quotePricingOpenIds = new Set();');
    eval(src + '\n}\n');
    const ts = d => ({ toDate: () => d });
    // renderQuoteRows reads the module-level quoteStageFilter (which tab is
    // active) to decide whether to show the Send Out Quotes extras below —
    // default it to 'new' so the baseline checks render exactly as before.
    global.quoteStageFilter = 'new';

    const fixtures = [
      { id: 'q1', data: { name: 'Dana Whitmore', phone: '(801) 555-0148',
          email: 'dana@x.com', address: '842 N Canyon Rd',
          contactMethod: 'Text', status: 'new' } },
      { id: 'q2', data: { name: 'Marcus Bell', phone: '(801) 555-0192',
          email: 'm@x.com', address: '1207 W Elk Ridge Dr',
          contactMethod: 'Phone', status: 'contacted',
          formCompletedAt: ts(new Date('2026-07-29')),
          lightColors: ['Warm White', 'Red'], outletTimer: 'Yes', wireColor: 'Green',
          estimatedFeet: 140, quotedPrice: 490,
          quoteToken: 'qt_abc', approvalStatus: 'pending',
          frontPhotoUrl: 'https://example.com/house.jpg' } },
      { id: 'q3', data: { name: 'Quinn "Q" O\'Hara & Sons <script>',
          phone: 'x', email: 'e@x.com', address: '9 Test <b>St</b>',
          contactMethod: 'Email', status: 'new', lightColors: ['Multi'],
          lightsDescription: 'a"b', notes: 'line1\nline2' } }
    ];
    renderQuoteRows(fixtures);

    const list = document.getElementById('quotesList');
    const cards = list.querySelectorAll('.row-item');
    const pricing = c => c.querySelector('.quote-section');
    const pricingHeader = c => c.querySelector('.quote-section-header');
    const pricingBody = c => c.querySelector('.quote-section-body');
    const [c1, c2, c3] = cards;

    check('render', 'one card per quote', cards.length === 3);

    check('render', 'new lead — pricing collapsed by default',
      !pricing(c1).classList.contains('open') && pricingBody(c1).style.display === 'none');
    check('render', 'new lead — reads not priced yet',
      pricingHeader(c1).textContent.includes('not priced yet'));
    check('render', 'new lead — no approval buttons', c1.querySelector('[data-markapproval]') === null);
    check('render', 'new lead — shows Add Photo', c1.textContent.includes('Add Photo'));
    /* Quote cards used to hold one photo, so the button read "Replace Photo".
       They now hold several, and it reads "Add More Photos" once there is at
       least one. Renamed here to match — not a regression. */
    check('render', 'with photo — offers to add more', c2.textContent.includes('Add More Photos'));
    check('render', 'formDone — shows Timer/Wire summary line',
      c2.textContent.includes('Timer:') && c2.textContent.includes('Wire:'));

    check('render', 'priced quote — pricing still collapsed by default',
      !pricing(c2).classList.contains('open'));
    check('render', 'priced quote — header shows price',
      pricingHeader(c2).textContent.includes('$490.00'));
    check('render', 'priced quote — approval link shown',
      c2.querySelector('.quotelink-box').textContent.includes('qt_abc'));
    check('render', 'no Detail Form left on the card',
      list.textContent.indexOf('Detail Form') === -1 &&
      c2.querySelector('[data-savequotedetail]') === null);

    // module-level quotePricingOpenIds must survive a re-render — this is the
    // whole point of the P1 change (native <details> used to lose its open
    // state whenever a save re-ran renderQuoteRows and rebuilt the innerHTML).
    quotePricingOpenIds.add('q2');
    renderQuoteRows(fixtures);
    const list2 = document.getElementById('quotesList');
    const c2b = list2.querySelectorAll('.row-item')[1];
    check('render', 'pricing panel stays open across a re-render once toggled',
      pricing(c2b).classList.contains('open') && pricingBody(c2b).style.display === 'block');
    quotePricingOpenIds.delete('q2');

    // clicking the header itself must toggle the Set, not just the DOM
    renderQuoteRows(fixtures);
    const list3 = document.getElementById('quotesList');
    const c1c = list3.querySelectorAll('.row-item')[0];
    pricingHeader(c1c).click();
    check('render', 'clicking the header adds the quote id to quotePricingOpenIds',
      quotePricingOpenIds.has('q1') && pricing(c1c).classList.contains('open'));
    quotePricingOpenIds.delete('q1');

    // every handler the card depends on must survive future edits
    [['data-converttocust', 'Convert to Customer'],
     ['data-previewquoteaddr', 'address map preview'],
     ['data-markupphoto', 'Mark Up Photo'],
     ['data-getquotelink', 'Get Approval Link'],
     ['data-copyquoteemail', 'Copy Quote Email'],
     ['data-del', 'delete']
    ].forEach(([attr, label]) => {
      check('render', 'handler preserved: ' + label,
        list.querySelector('[' + attr + ']') !== null,
        'this feature would silently stop working');
    });

    check('render', 'hostile input — no script injected', c3.querySelector('script') === null);
    check('render', 'hostile input — name still readable',
      c3.textContent.includes('Quinn "Q" O\'Hara & Sons'));
    check('render', 'hostile input — address not parsed as markup',
      c3.querySelector('.address-link-btn b') === null);
    // The "What Lights Are They Getting?" field (.quoteLightsInput) was removed
    // from Pricing & Approval, so these two now test the same escaping and
    // fallback behaviour against fields that still exist.
    check('render', 'hostile input — markup survives into a data attribute intact',
      c3.querySelector('[data-previewquoteaddr]').dataset.previewquoteaddr === '9 Test <b>St</b>');
    check('render', 'missing fields fall back to blank',
      c1.querySelector('.quoteFeetInput').value === '' &&
      c1.querySelector('.quotePriceInput').value === '');

    const renderedIds = [...list.querySelectorAll('[id]')].map(el => el.id);
    check('render', 'no duplicate IDs in rendered cards',
      new Set(renderedIds).size === renderedIds.length);
    const wired = [...list.querySelectorAll('.quoteFeetInput')].map(el => el.dataset.id);
    check('render', 'each card wired to its own quote', new Set(wired).size === 3);

    // ---- corrected approval link format + "maybe next year" status --------
    check('render', 'approval link uses the quote-details page, not the payment page',
      c2.querySelector('.quotelink-box').textContent.includes('/#/quote-details?token=qt_abc&action=approve') &&
      !c2.querySelector('.quotelink-box').textContent.includes('/#/payment'));

    const q4 = { id: 'q4', data: { name: 'Priya Shah', phone: '(801) 555-0233',
        email: 'priya@x.com', address: '55 Winter Ln', contactMethod: 'Text', status: 'new',
        quotedPrice: 375, quoteToken: 'qt_maybe', approvalStatus: 'maybe_next_year' } };
    const fixturesWithMaybe = fixtures.concat([q4]);
    renderQuoteRows(fixturesWithMaybe);
    const listMaybe = document.getElementById('quotesList');
    const c4 = listMaybe.querySelectorAll('.row-item')[3];
    check('render', 'maybe_next_year — status pill shown',
      c4.textContent.includes('Maybe Next Year'));
    check('render', 'maybe_next_year — pricing panel explains the status',
      pricingBody(c4).textContent.includes('Maybe Next Year'));

    // ---- "Send Out Quotes" tab extras — only show on that tab -------------
    global.quoteStageFilter = 'send';
    renderQuoteRows(fixturesWithMaybe);
    const listSend = document.getElementById('quotesList');
    const c2send = listSend.querySelectorAll('.row-item')[1];
    check('render', 'send tab — customer email shown for easy copying',
      c2send.querySelector('[data-copyquoteemailaddr]') !== null && c2send.textContent.includes('m@x.com'));
    // The button went missing in a markup rewrite while its click handler stayed
    // wired, so the feature was live but unreachable. Restored — this check is
    // what catches it going missing again.
    check('render', 'Download Photo shown when there is a photo',
      c2send.querySelector('[data-downloadquotephoto]') !== null,
      'the handler is still wired in admin.html, so the feature would be live ' +
      'but unreachable');
    check('render', 'send tab — Mark as Sent shown before it has been sent',
      c2send.querySelector('[data-marksent]') !== null);

    global.quoteStageFilter = 'new';
    renderQuoteRows(fixturesWithMaybe);
    const listBack = document.getElementById('quotesList');
    const c2back = listBack.querySelectorAll('.row-item')[1];
    check('render', 'Send Out Quotes extras hidden outside the send tab',
      c2back.querySelector('[data-marksent]') === null && c2back.querySelector('[data-copyquoteemailaddr]') === null);

    const q5 = { id: 'q5', data: Object.assign({}, fixtures[1].data, { quoteManuallySent: true }) };
    global.quoteStageFilter = 'send';
    renderQuoteRows([q5]);
    const sentCard = document.getElementById('quotesList').querySelector('.row-item');
    check('render', 'send tab — already-sent quote shows Undo instead of Mark as Sent',
      sentCard.querySelector('[data-marksent]') === null && sentCard.querySelector('[data-unmarksent]') !== null);
    global.quoteStageFilter = 'new';
  }
}

// =====================================================================
// 6. DATA FLOW — does information collected actually reach where it's used
// =====================================================================
suite('6. Data flow between parts');

const employee = read('employee.html');

// the block of admin.html that runs on Convert to Customer
const convStart = admin.indexOf("[data-converttocust]");
const convEnd = admin.indexOf('Quote details filled in', convStart);
const conversion = convStart > -1 && convEnd > convStart ? admin.slice(convStart, convEnd) : '';
check('flow', 'found the quote to customer conversion block', conversion.length > 0);

// fields the conversion is known to carry
[['name', 'routeNameInput'], ['phone', 'routePhoneInput'], ['street', 'routeStreetInput'],
 ['city', 'routeCityInput'], ['zip', 'routeZipInput'], ['email', 'addCustEmail'],
 ['wire colour', 'addCustWireColor'], ['gate code', 'addCustGateCode'],
 ['install timing', 'addCustInstallPref'], ['mailed invoice', 'addCustWantsMailed'],
 ['light colours', 'addcust-color-check'],
 ['photo', 'addCustPhotoUrl']
].forEach(([label, marker]) => {
  check('flow', 'conversion carries ' + label, conversion.includes(marker),
    'quote data would be lost when converting to a customer');
});

// --- known disconnects ---
gap('outlet timer reaches the customer record',
  conversion.includes('addCustOutletTimer') && /outletTimer:\s*outletTimer/.test(admin),
  'The quote form asks about an outlet timer and saves it on the QUOTE, but nothing\n          ' +
  'ever writes outletTimer onto a customer. The crew Timers tab queries\n          ' +
  'jobAddresses where outletTimer == "Yes" and route cards print Timer: Yes/No —\n          ' +
  'both are permanently empty. Fix: carry it through conversion.');

gap('specific outlet reaches the customer record',
  conversion.includes('addCustSpecificOutlet') && /specificOutlet:\s*specificOutlet/.test(admin),
  'Collected on the quote ("use the back patio outlet"), displayed on route cards\n          ' +
  'and customer rows, but never written to the customer. Crews never see it.');

gap('estimated feet prefills the customer feet field',
  conversion.includes('addCustFeet'),
  'Feet drives bin count, the 200 ft double-bin rule, the customer number series\n          ' +
  'and warehouse bundle counts. estimatedFeet sits on the quote but has to be\n          ' +
  'retyped by hand, so a typo silently changes the bin count.');

gap('approved price is what carries to the customer',
  /quotedPrice[\s\S]{0,120}addCustPrice/.test(conversion),
  'Conversion recomputes price as estimatedFeet x perFootRate instead of using\n          ' +
  'quotedPrice — the number the customer actually approved. If either was ever\n          ' +
  'adjusted or rounded, the customer is billed a different amount than they agreed to.');

gap('quote notes reach the customer record',
  conversion.includes('addCustNotes') && /notes:\s*custNotes/.test(admin),
  'Additional Notes from the quote ("steep pitch over the entry") are dropped.\n          ' +
  'There is no notes field on Add a Customer for them to land in.');

// --- flows that DO work, guarded so they stay working ---
check('flow', 'crew Timers tab still reads outletTimer',
  employee.includes("where('outletTimer','==','Yes')"),
  'if this query changes, update the gap check above');
check('flow', 'route generation carries specific outlet to route cards',
  admin.includes('specificOutletNotes:item.data.specificOutletNotes'));
check('flow', 'route generation carries gate code',
  admin.includes('gateCode:item.data.gateCode'));
check('flow', 'route generation carries customer number for bins',
  admin.includes('customerNumber:item.data.customerNumber'));
check('flow', 'outlet timer is editable on an existing customer',
  admin.includes('editCustOutletTimer') && /outletTimer:\s*newOutletTimer/.test(admin),
  'without this a wrong answer could never be corrected');
check('flow', 'specific outlet is editable on an existing customer',
  admin.includes('editCustSpecificOutlet') && /specificOutlet:\s*newSpecificOutlet/.test(admin));
check('flow', 'warehouse counts bundles from feet',
  admin.includes('FEET_PER_BUNDLE') && admin.includes('Math.ceil(feet / FEET_PER_BUNDLE)'),
  'bundle math changed — the warehouse counts bundles, not houses');
check('flow', 'bundle size is still 40 ft',
  /FEET_PER_BUNDLE\s*=\s*40/.test(admin));
check('flow', 'recycling returns numbers to the available pool',
  admin.includes('availableCustomerNumbers'));
check('flow', 'member portal changes reach the warehouse queue',
  admin.includes('needsLightBuild') || admin.includes('portalSave'));

// --- propagation when an existing record changes ---
// Sliced to the next top-level listener rather than a fixed character count —
// a fixed window went stale once before (9000 chars was too short the moment
// this handler grew past it) and silently turned real passes into FAILs.
const editSave = admin.slice(admin.indexOf("editCustSaveBtn').addEventListener"),
                             admin.indexOf("allCustFilterToggle').addEventListener"));

check('flow', 'quote is closed when converted to a customer',
  admin.includes("status: 'closed', convertedToCustomerAt"),
  'the quote would stay open forever after the customer exists');
check('flow', 'converted customer is set to RSVP yes',
  admin.includes("rsvpStatus: addCustFromQuoteId ? 'yes' : ''"));
check('flow', 'changing a phone or email moves the invoice with it',
  editSave.includes('newKey !== oldKey'),
  'invoice doc ID is the phone/email — payments would be orphaned');
check('flow', 'changing an address re-geocodes for the map',
  editSave.includes('geocodeAddress'));
check('flow', 'changing feet warns before renumbering a labelled bin',
  editSave.includes('cnBinsForFeet'));
check('flow', 'changing light colours re-queues the warehouse build',
  /newLightsDescription !== oldLightsForBuild/.test(admin));
check('flow', 'deleting a customer archives money already collected',
  admin.includes('archivedRevenue'));
check('flow', 'changing bill-to resyncs both payer invoices',
  editSave.includes('syncPayerInvoice'));

/* ---- the invoice edit panel -----------------------------------------------
   Saving an invoice used to write `removal: 0` unconditionally and clamp the
   payment box against the install amount alone. A customer who paid $130
   against a $100 install plus a $30 light-change fee had their recorded
   payment quietly cut to $100 the next time anyone opened and saved that
   invoice — and then got chased for money they had already sent. The Invoice
   Bulk Update tool carries a comment explaining exactly this; the lesson had
   not reached this handler. */
const ieSaveStart = admin.indexOf("panel.querySelector('.ie-save').addEventListener");
const ieSave = ieSaveStart > -1
  ? admin.slice(ieSaveStart, admin.indexOf('syncedNote', ieSaveStart) + 2000)
  : '';
check('flow', 'saving an invoice keeps the removal charge',
  ieSave.length > 0 && !/removal: 0,/.test(ieSave),
  'a real takedown charge was wiped every time anyone opened and saved the invoice');
check('flow', 'saving an invoice clamps the payment against the real total',
  /grossCharge/.test(ieSave) && /derivedGross/.test(ieSave),
  'clamping to the install amount deletes a payment that also covered fees or removal');
check('flow', 'the invoice status is recomputed with the removal it kept',
  /computeInvoiceStatus\(newAmount, keptRemoval, newDeposit/.test(ieSave),
  'status computed against a removal the write did not use');

check('flow', 'the dashboard outstanding figure uses the one balance formula',
  /return s \+ balanceDueAmount\(i\.data\)/.test(admin),
  'the last hand-rolled balance — it left light-change fees out of the total owed');

check('flow', 'the nightly re-sum keeps the $30 join fee',
  /inv\.install = groupSum \+ \(inv\.newMemberFeeApplied \? 30 : 0\)/.test(read('functions/index.js')),
  'a multi-house payer silently lost the join fee on any re-run; the browser copy gets this right');

// syncPayerInvoice used to look houses up by phone ONLY. An invoice is keyed by
// custInvoiceKey — the phone when there is one, the lowercased email when there
// isn't — so an email-keyed payer matched no houses at all, the group came back
// empty, and the rebuild wrote install: 0 straight over a real total. Found
// 2026-08-08 on a live 3-house group invoice sitting at $0 against $1500 of
// houses; the same path runs on an ordinary House Price edit, not just the
// Health Check fix button, so it could zero an invoice during normal office work.
const syncPayerStart = admin.indexOf('async function syncPayerInvoice(');
const syncPayer = syncPayerStart > -1
  ? admin.slice(syncPayerStart, admin.indexOf('\n}', syncPayerStart))
  : '';
check('flow', 'payer invoice resync resolves an email-keyed payer, not just a phone',
  /where\(\s*'email'\s*,\s*'=='\s*,\s*key\s*\)/.test(syncPayer),
  'an email-keyed payer matches no houses by phone, so the invoice rebuilds as $0');
check('flow', 'payer invoice resync refuses to zero an email-keyed invoice it cannot resolve',
  /!isPhoneKey\s*&&\s*!linked\.length/.test(syncPayer) && /throw new Error/.test(syncPayer),
  'silently writing install: 0 over a live total is worse than leaving it stale');
check('flow', 'payer invoice resync never writes an email into the phone field',
  /phone:\s*isPhoneKey\s*\?\s*key\s*:/.test(syncPayer),
  'the phone field is read back by lookups that expect digits');

// A multi-house payer with one house RSVP'd 'no' would have that house's price
// summed back into the invoice on the next resync (e.g. an Edit Customer save)
// — undoing runInvoiceBatch's own exclusion of it. Fixed 2026-08-13 to filter
// active houses the same way the server does, and to skip the write entirely
// (not zero the invoice) when every linked house has opted out — a payer with
// zero active houses is not the same as a payer with zero houses at all.
check('flow', 'payer invoice resync excludes RSVP-no houses from the total',
  /rsvpStatus\|\|''\)\s*!==\s*'no'/.test(syncPayer),
  "a cancelled house's price would get resummed back onto the invoice on the next edit");
check('flow', 'payer invoice resync does not zero an invoice when every house opted out',
  /linked\.length\s*&&\s*!active\.length/.test(syncPayer),
  'a payer whose houses are all RSVP-no would have their real balance wiped to $0');

// Same root confusion, different blast radius: the bulk/single "let these
// customers know" senders matched an invoice by comparing phone fields. A
// customer with no phone has phone '' on both sides, so '' === '' pulled back
// whichever invoice happened to be first — and that amount is what gets emailed.
check('flow', 'customer email amounts look the invoice up by key, not by phone',
  !/allInvoicesCache\.find\(i => i\.data\.phone === d\.phone\)/.test(admin),
  "a phone-less customer is keyed by email, so '' === '' could email them a stranger's balance");

// Checklist row #15: portalRsvp sets needsLightRecycle on a flat "no", but the
// recycle list also demanded a lightsDescription, so a customer with no lights
// recorded was flagged and then never shown — and their customer number never
// returned to the available pool.
const recycleStart = admin.indexOf('function renderWarehouseRecycleQueue()');
const recycleQueue = recycleStart > -1 ? admin.slice(recycleStart, recycleStart + 1200) : '';
check('flow', 'recycle list shows everyone flagged, even with no lights recorded',
  recycleQueue.length > 0 && !/!d\.needsLightRecycle \|\| !d\.lightsDescription/.test(recycleQueue),
  'a flagged customer who never appears here never gets their number recycled');

// Payment methods are not mutually exclusive any more — 'both' shows Venmo and
// PayPal together. Venmo must stay visible unless PayPal is the sole method AND
// actually usable, so a missing Client ID can never leave a customer unable to pay.
const publicSite = read('index.html');
check('flow', 'portal can offer Venmo and PayPal at the same time',
  /provider === 'both'/.test(publicSite) && /function paypalAvailable/.test(publicSite) && /function venmoAvailable/.test(publicSite),
  'the provider setting used to be either/or with no way to offer both');
check('flow', 'PayPal is never offered without a Client ID',
  /function paypalAvailable[\s\S]{0,260}paypalClientId/.test(publicSite),
  'the buttons cannot render without one, so the customer would see nothing');
check('flow', 'Site Settings offers the Both payment option',
  /<option value="both"/.test(admin),
  'the portal supports it but there would be no way to turn it on');

// the two fixes above have subtleties that must not regress
check('flow', 'price sync preserves the $30 new member fee',
  /newMemberFeeApplied \? 30 : 0/.test(editSave),
  'a plain install overwrite would silently wipe the fee off anyone who has it');
check('flow', 'price only syncs when it actually changed',
  /newHousePrice !== oldHousePrice/.test(editSave),
  'syncing on every save would undo a hand-adjusted invoice total');
check('flow', 'price sync recomputes invoice status',
  /invoiceUpdates\.status\s*=\s*computeInvoiceStatus/.test(editSave),
  'otherwise a raised price leaves them still showing Paid in Full');

// Fixed 2026-08 after confirming with the owner it wasn't relied on in
// practice, but guarded anyway since a future re-run against an existing
// invoice would otherwise erase real money already on file.
const ibStart = admin.indexOf("ibImportBtn').addEventListener");
const ibSection = ibStart > -1 ? admin.slice(ibStart, ibStart + 3000) : '';
check('flow', 'Invoice Bulk Update preserves an existing removal charge and payments already on file',
  /removal:\s*keepRemoval/.test(ibSection) && /deposit:\s*keepDeposit/.test(ibSection),
  'a blind removal:0, deposit:0 on every row would erase both if this tool is ever re-run\n          ' +
  'against a customer who already has an invoice');
check('flow', 'route resync only touches upcoming routes',
  /dates\[i\] < todayStr/.test(admin),
  'past routes are history and should stay as they were on the day');
check('flow', 'route resync never blanks an unchanged field',
  /!== undefined && fields\[k\] !== null/.test(admin));
check('flow', 'route resync failure cannot lose the customer edit',
  /Route stop resync failed/.test(admin),
  'the jobAddresses write happens first and must not be rolled back');

gap('editing House Price updates the existing invoice',
  /invoiceUpdates\.install\s*=\s*newHousePrice/.test(editSave),
  'Edit Customer writes housePrice onto the customer, but when an invoice already\n          ' +
  'exists it only updates name, phone and email — install keeps the OLD price.\n          ' +
  'Change someone from $450 to $500 and they are still billed $450. The invoice\n          ' +
  'only picks up the price when no invoice exists yet.\n          ' +
  'Careful when fixing: install also carries the $30 new member fee, so it must be\n          ' +
  'newHousePrice + (newMemberFeeApplied ? 30 : 0), not a plain overwrite.');

gap('saved routes pick up later customer corrections',
  admin.includes('resyncSavedRouteStops(') && /function resyncSavedRouteStops/.test(admin),
  'scheduledRoutes.stops is a frozen snapshot of name, address, phone, gate code,\n          ' +
  'outlet note and customer number taken when the route was saved. employee.html\n          ' +
  'reads r.data.stops directly and never re-looks-up the customer, so fixing an\n          ' +
  'address or gate code after scheduling never reaches the crew driving to it.');

// --- gap found during the 2026-08-08 system-map audit, fixed 2026-08 after
// the owner confirmed the fee should move automatically ---
(function () {
  const switchStart = admin.indexOf('They now bill to someone else');
  const switchSection = switchStart > -1 ? admin.slice(switchStart, switchStart + 1200) : '';
  check('flow', 'an outstanding light-change fee carries over when a customer switches bill-to',
    /migratingFeeNotes/.test(switchSection) && admin.includes('Fold the moved fee onto the payer'),
    'zeroing/deleting the old standalone invoice without moving changeFees onto the new\n          ' +
    'payer\'s invoice would bill an unpaid fee to nobody');
})();

// =====================================================================
// 7. HEALTH CHECK ENGINE
// Runs the real hcRunChecks() from admin.html against fabricated data.
// The point of most of these is the FALSE ALARM case: a health check that
// cries wolf gets ignored, which is worse than not having one.
// =====================================================================
console.log('\n=== 7. Health check engine ===');
(function () {
  // admin.html is CRLF throughout, so a literal \n in the search string never
  // matches — use a regex with \r?\n so this survives either line ending.
  const hcStartMatch = admin.match(/\/\* =+\r?\n\s*HEALTH CHECK/);
  const hcStart = hcStartMatch ? hcStartMatch.index : -1;
  const hcEnd = admin.indexOf('function attachDeleteHandlers');
  if (hcStart === -1 || hcEnd === -1) {
    check('health', 'health check engine found in admin.html', false,
      'the panel is missing or its comment banner changed');
    return;
  }
  let code = admin.slice(hcStart, hcEnd)
    .replace(/\(function\(\)\{\s*const btn = document\.getElementById\('runHealthCheckBtn'\);[\s\S]*$/, '');

  const prelude = `
    function custInvoiceKey(d){const p=String((d&&d.phone)||'').replace(/\\D/g,'');return p?p:String((d&&d.email)||'').toLowerCase().trim();}
    function computeInvoiceStatus(i,r,dep){const t=(+i||0)+(+r||0);const p=+dep||0;if(t<=0||p<=0)return 'Unpaid';if(p>=t)return 'Paid in Full';return 'Partial Payment';}
    function toDateStr(dt){return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');}
    function esc(s){return (s||'').toString();}
    var jobAddresses=[],allInvoicesCache=[],quotesCache=[],availableCustomerNumbers=[],scheduledRoutesCache={};
  `;
  let hc;
  try {
    hc = new Function(prelude + code + `
      return {set:function(o){jobAddresses=o.j||[];allInvoicesCache=o.i||[];quotesCache=o.q||[];availableCustomerNumbers=o.a||[];scheduledRoutesCache=o.r||{};},run:hcRunChecks};
    `)();
  } catch (e) {
    check('health', 'health check engine evaluates', false, e.message);
    return;
  }
  const get = (cs, id) => cs.find(c => c.id === id) || { rows: [] };
  const dstr = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const future = dstr(new Date(Date.now() + 86400000));
  const past = dstr(new Date(Date.now() - 86400000));

  hc.set({
    j: [{ id: 'a', data: { name: 'Smith', phone: '8011112222', housePrice: 400, customerNumber: '101', measuredFeet: 100 } },
        { id: 'b', data: { name: 'Rental', phone: '8013334444', billToPhone: '8011112222', housePrice: 300, customerNumber: '102', measuredFeet: 80 } }],
    i: [{ id: '8011112222', data: { name: 'Smith', install: 700, removal: 0, deposit: 0, status: 'Unpaid' } }]
  });
  check('health', 'multi-house invoice is not flagged as drift',
    get(hc.run(), 'totalDrift').rows.length === 0,
    'one invoice can cover several houses via billToPhone — comparing to a single housePrice would flag every one of them');

  hc.set({
    j: [{ id: 'a', data: { name: 'Smith', phone: '8011112222', housePrice: 400, customerNumber: '101', measuredFeet: 100 } }],
    i: [{ id: '8011112222', data: { install: 430, removal: 0, deposit: 0, status: 'Unpaid', newMemberFeeApplied: true } }]
  });
  check('health', '$30 new member fee is not mistaken for drift',
    get(hc.run(), 'totalDrift').rows.length === 0,
    'install carries the fee on top of house prices');

  hc.set({
    j: [{ id: 'a', data: { name: 'Smith', phone: '8011112222', housePrice: 500, customerNumber: '101', measuredFeet: 100 } }],
    i: [{ id: '8011112222', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } }]
  });
  check('health', 'genuine price drift is caught',
    get(hc.run(), 'totalDrift').rows.length === 1,
    'this is the check that stops you billing the wrong amount');

  hc.set({ j: [
    { id: 'a', data: { name: 'Smith', phone: '801', customerNumber: '5012', housePrice: 1 } },
    { id: 'b', data: { name: 'Jones', phone: '802', customerNumber: '5012', housePrice: 1 } },
    { id: 'c', data: { name: 'Lee', phone: '803', customerNumber: '5013', housePrice: 1 } }] });
  const dup = hc.run();
  check('health', 'duplicate customer number caught, unique left alone',
    get(dup, 'dupNumbers').rows.length === 1,
    'two houses on one number means bins that cannot be told apart');
  check('health', 'duplicate number offers no auto-fix',
    get(dup, 'dupNumbers').fix === null,
    'the code cannot know which house keeps the number — that has to stay a human call');

  hc.set({ j: [{ id: 'a', data: { name: 'S', phone: '801', customerNumber: '77', housePrice: 1 } }],
           a: [{ id: '77', data: {} }, { id: '78', data: {} }] });
  const pool = get(hc.run(), 'poolConflict');
  check('health', 'pooled-but-assigned number caught, free number not',
    pool.rows.length === 1 && pool.rows[0].numId === '77',
    'handing out an assigned number creates a duplicate later');

  hc.set({ i: [{ id: '1', data: { install: 100, removal: 0, deposit: 100, status: 'Unpaid' } },
               { id: '2', data: { install: 100, removal: 0, deposit: 0, status: 'Unpaid' } }] });
  const st = get(hc.run(), 'staleStatus');
  check('health', 'stale invoice status caught, correct one left alone',
    st.rows.length === 1 && st.rows[0].invId === '1',
    'someone showing unpaid when they have paid');

  hc.set({
    j: [{ id: 'a', data: { name: 'Smith', phone: '8011112222', address: '12 New St', housePrice: 1, customerNumber: '1' } }],
    r: { [future]: [{ id: 'r1', date: future, stops: [{ id: 'a', name: 'Smith', address: '99 Old St', phone: '8011112222' }, { id: 'gone', name: 'Deleted' }] }],
         [past]: [{ id: 'r0', date: past, stops: [{ id: 'alsogone', name: 'Old' }] }] }
  });
  const rt = hc.run();
  check('health', 'deleted customer on an upcoming route caught',
    get(rt, 'ghostStops').rows.length === 1 && get(rt, 'ghostStops').rows[0].stopId === 'gone',
    'the crew would drive to a house that is no longer a customer');
  check('health', 'past routes are left alone as history',
    !get(rt, 'ghostStops').rows.some(r => r.stopId === 'alsogone'),
    'rewriting completed routes would corrupt the record of what was actually done');
  check('health', 'stale route stop carries the CURRENT address in its fix',
    get(rt, 'staleStops').rows.length === 1 && get(rt, 'staleStops').rows[0].fields.address === '12 New St',
    'a fix that wrote the stale value back would be worse than no fix');

  hc.set({
    j: [{ id: 'a', data: { name: 'Converted', phone: '8011112222', housePrice: 1, customerNumber: '1' } }],
    q: [{ id: 'q1', data: { name: 'Converted', phone: '8011112222', status: 'approved' } },
        { id: 'q2', data: { name: 'Fell Through', phone: '8019998888', status: 'approved' } },
        { id: 'q3', data: { name: 'Pending', phone: '8017776666', status: 'pending' } }]
  });
  const lq = get(hc.run(), 'lostQuotes');
  check('health', 'approved quote that never converted is caught',
    lq.rows.length === 1 && lq.rows[0].label === 'Fell Through',
    'work they agreed to and you never did');

  /* Invoices only go out by email, so a customer with no email address cannot
     be billed at all. The nightly run used to pass over them with a bare
     `continue` — not sent, not skipped, not an error — so the summary text read
     "0 sent, 0 errors" while an installed house went unbilled all season.
     Health Check only ever caught customers with NEITHER phone nor email, so a
     phone-only signup (the ordinary case for a phone enquiry) was invisible
     everywhere. Added 2026-08-14 alongside the skippedNoEmail counter. */
  hc.set({
    j: [{ id: 'a', data: { name: 'No Email', phone: '8011112222', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100 } },
        { id: 'b', data: { name: 'Has Email', phone: '8015556666', email: 'has@x.com', address: '2 St', housePrice: 400, customerNumber: '102', measuredFeet: 100 } }],
    i: [{ id: '8011112222', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } },
        { id: '8015556666', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } }]
  });
  const ne = get(hc.run(), 'noEmail');
  check('health', 'a customer with a phone but no email is caught',
    ne.rows.length === 1 && ne.rows[0].label.indexOf('No Email') !== -1,
    'they can never be invoiced, and the nightly run reports it as a healthy night');

  /* Grouped the way the nightly run groups: it looks for an email across the
     whole payer group, so a bill-to house with no email of its own is fine as
     long as somebody on that bill has one. Flagging per-house would put every
     multi-house group on the list and train you to ignore the panel. */
  hc.set({
    j: [{ id: 'a', data: { name: 'Payer', phone: '8011112222', email: 'payer@x.com', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100 } },
        { id: 'b', data: { name: 'Rental', phone: '8013334444', billToPhone: '8011112222', address: '2 St', housePrice: 300, customerNumber: '102', measuredFeet: 80 } }],
    i: [{ id: '8011112222', data: { install: 700, removal: 0, deposit: 0, status: 'Unpaid' } }]
  });
  check('health', 'a bill-to house is not flagged when the payer has the email',
    get(hc.run(), 'noEmail').rows.length === 0,
    'every multi-house group would land on the list and the panel becomes noise');

  /* A customer with no coordinates cannot be put on a route and does not show
     on the map — they are silently never visited rather than visited late. The
     bulk importer has flagged these as needsGeocode since it was written and
     told staff to "search Needs Pin in the customer list", a search that did
     not exist anywhere in the app. Judged on the coordinates rather than the
     flag, so a customer typed in by hand is covered too. */
  hc.set({
    j: [{ id: 'a', data: { name: 'No Pin', phone: '8011112222', email: 'a@x.com', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100 } },
        { id: 'b', data: { name: 'Has Pin', phone: '8015556666', email: 'b@x.com', address: '2 St', housePrice: 400, customerNumber: '102', measuredFeet: 100, lat: 40.3, lng: -111.7 } }],
    i: [{ id: '8011112222', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } },
        { id: '8015556666', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } }]
  });
  const np = get(hc.run(), 'noPin');
  check('health', 'a customer with no map pin is caught',
    np.rows.length === 1 && np.rows[0].label.indexOf('No Pin') !== -1,
    'they cannot be routed and nothing anywhere says so');

  // 0,0 is the Atlantic — what a failed lookup leaves behind, never a house.
  hc.set({
    j: [{ id: 'a', data: { name: 'Null Island', phone: '8011112222', email: 'a@x.com', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100, lat: 0, lng: 0 } }],
    i: [{ id: '8011112222', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } }]
  });
  check('health', 'coordinates of 0,0 do not count as a real pin',
    get(hc.run(), 'noPin').rows.length === 1,
    'a failed geocode leaves 0,0 behind and it would look routable');

  // A customer who said no this season is not being routed anyway.
  hc.set({
    j: [{ id: 'a', data: { name: 'Cancelled', phone: '8011112222', email: 'a@x.com', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100, rsvpStatus: 'no' } }],
    i: []
  });
  check('health', 'a cancelled customer is not chased for a map pin',
    get(hc.run(), 'noPin').rows.length === 0,
    'noise on the panel is how a real problem gets scrolled past');

  hc.set({
    j: [{ id: 'a', data: { name: 'Smith', phone: '8011112222', email: 'smith@x.com', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100, lat: 40.3, lng: -111.7 } }],
    i: [{ id: '8011112222', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } }],
    a: [{ id: '999', data: {} }]
  });
  const clean = hc.run().filter(c => c.rows.length);
  check('health', 'clean data reports nothing at all',
    clean.length === 0,
    'false alarms train you to ignore the panel: ' + clean.map(c => c.id).join(', '));

  const all = hc.run();
  check('health', 'all 16 checks present',
    all.length === 16, 'got ' + all.length);
  check('health', 'fix buttons limited to the unambiguous checks',
    all.filter(c => c.fix).length === 6,
    'auto-fixing a judgement call writes bad data at scale');
})();

// =====================================================================
suite('8. Quote decline / maybe next year');
(() => {
  const fns = read('functions/index.js');
  const idx = read('index.html');

  // --- decline files the quote away -------------------------------------
  check('quoteresp', 'declining archives the quote',
    /quoteUpdates\.quoteArchived\s*=\s*true/.test(fns),
    'a declined quote would sit in Closed waiting to be archived by hand');
  check('quoteresp', 'archiving is a flag, not a delete',
    !/collection\('quotes'\)\.doc\(quoteId\)\.delete\(\)/.test(fns),
    'declining must never destroy the quote — Closed → Archived has a Restore button');

  // --- maybe next year reaches the customer record ----------------------
  check('quoteresp', 'maybe next year pulls the customer from the season',
    /action === 'maybe_next_year'/.test(fns) && /pullCustomerFromSeason/.test(fns),
    'they would keep their routes and schedule for a season they said no to');
  check('quoteresp', 'the customer is matched by phone',
    /findByPhone\(digitsOnly\(quoteData\.phone\)\)/.test(fns),
    'quotes carry no link to jobAddresses, so phone is the only join available');
  ['maybeNextYear', 'rsvpStatus', 'scheduled', 'needsLightBuild'].forEach(f => {
    check('quoteresp', 'pulling from the season clears ' + f,
      new RegExp(f + ':').test(fns.slice(fns.indexOf('async function pullCustomerFromSeason'),
        fns.indexOf('async function pullCustomerFromSeason') + 1800)),
      'they would still show up somewhere outside All Customers');
  });
  check('quoteresp', 'past routes are left alone as history',
    /\(rd\.date \|\| ''\) < todayStr/.test(fns.slice(fns.indexOf('async function pullCustomerFromSeason'))),
    'rewriting a finished route changes what the crew actually did');

  // --- money is not touched ---------------------------------------------
  const pull = fns.slice(fns.indexOf('async function pullCustomerFromSeason'),
    fns.indexOf('async function pullCustomerFromSeason') + 1800);
  check('quoteresp', 'sitting out the season does not touch money',
    !/(install|removal|deposit|credits|changeFees|status)\s*:/.test(pull),
    'not coming back next year is not the same as not owing for last year — ' +
    'this must never zero a balance or flip an invoice to paid');

  // --- admin surfaces ----------------------------------------------------
  check('quoteresp', 'All Customers shows the Maybe Next Year badge',
    /maybeNextYear\s*\?[\s\S]{0,200}Maybe Next Year/.test(admin),
    'the office would have no way to see who is sitting out');
  check('quoteresp', 'the badge column has a matching empty header',
    (admin.match(/<th style="padding:8px 10px;"><\/th>/g) || []).length >= 2 &&
    /colspan="8"/.test(admin),
    'header and body would disagree and the table would render misaligned');
  // Sliced to the next real statement rather than a fixed window — a character
  // count here goes stale the moment the cell grows (see CLAUDE.md §7).
  const maybeCellStart = admin.indexOf('const maybeCell = r.d.maybeNextYear');
  const maybeCell = admin.slice(maybeCellStart,
    admin.indexOf('return \'<tr style="border-bottom', maybeCellStart));
  check('quoteresp', 'every customer reads Confirmed or Maybe Next Year',
    maybeCell.includes('Maybe Next Year<') && maybeCell.includes('Confirmed<'),
    'a blank cell is ambiguous between "confirmed" and "nobody has looked yet"');
  check('quoteresp', 'the badge can be flipped both ways from All Customers',
    /data-seasontoggle/.test(admin) && /data-to="maybe"/.test(admin) && /data-to="confirmed"/.test(admin),
    'the office could only ever set it one way');
  check('quoteresp', 'confirming does not silently re-route them',
    /NOT put them back on a route|NOT added back to any route/.test(admin),
    'quietly rebuilding a route behind the office is worse than re-adding a stop');
  // Caught live: the write landed but the row kept showing the badge until the
  // search was retyped, so the button read as dead — the same failure the quote
  // email had. Nothing re-renders this table on a jobAddresses change.
  check('quoteresp', 'the toggle repaints the row it just changed',
    /renderAllCustomersTable\(\);[\s\S]{0,200}toast\(toMaybe/.test(admin),
    'the badge would stay on screen after the click and the button would look dead');
  // All Customers was the only list left out of the jobAddresses snapshot sweep,
  // so a saved edit sat stale until the search was retyped. Caught live.
  check('quoteresp', 'All Customers refreshes on any customer change',
    /safeRender\('allCustomersTable'/.test(admin),
    'an Edit Customer save would not show up in the table until you retyped the search');

  // --- the manual toggle in Edit Customer -------------------------------
  check('quoteresp', 'Edit Customer offers both states',
    /id="editCustSeasonConfirmed"/.test(admin) && /id="editCustSeasonMaybe"/.test(admin),
    'there would be no way to set this by hand');
  check('quoteresp', 'only one state can be active at a time',
    (admin.match(/name="editCustSeason"/g) || []).length === 2 &&
    /type="radio" name="editCustSeason"/.test(admin),
    'two checkboxes would eventually end up both on or both off — a radio group cannot');
  check('quoteresp', 'the toggle is loaded when the modal opens',
    /editCustSeasonMaybe' : 'editCustSeasonConfirmed'\)\.checked = true/.test(admin),
    'it would always show Confirmed regardless of the real value');
  check('quoteresp', 'saving applies the season fields after the rest',
    admin.indexOf('addrUpdates.maybeNextYear = newSeasonMaybe') >
      admin.indexOf('addrUpdates.needsLightBuild = newLightsDescription') &&
    admin.indexOf('addrUpdates.maybeNextYear = newSeasonMaybe') <
      admin.indexOf("await updateDoc(doc(db,'jobAddresses', editCustomerId), addrUpdates)"),
    'the RSVP dropdown or the build flag would overwrite it and leave a half state');
  check('quoteresp', 'coming back to Confirmed clears a stale Back Next Year RSVP',
    /newRsvp === 'backnextyear'\)\{ addrUpdates\.rsvpStatus = ''/.test(admin),
    'they would be unroutable behind a Confirmed badge');
  check('quoteresp', 'saving Maybe Next Year pulls them off upcoming routes',
    /newSeasonMaybe && !item\.data\.maybeNextYear[\s\S]{0,120}removeCustomerFromUpcomingRoutes/.test(admin),
    'the badge would say they are out while the crew still turns up');
  const seasonFn = admin.slice(admin.indexOf('async function setCustomerSeason'),
    admin.indexOf('async function setCustomerSeason') + 1400);
  check('quoteresp', 'the manual toggle touches no money either',
    !/(install|removal|deposit|credits|changeFees)\s*:/.test(seasonFn),
    'sitting out next season says nothing about what is owed for work already done');
  check('quoteresp', 'manual route removal leaves past routes alone',
    /dates\[i\] < todayStr\) continue/.test(
      admin.slice(admin.indexOf('async function removeCustomerFromUpcomingRoutes'),
        admin.indexOf('async function removeCustomerFromUpcomingRoutes') + 900)),
    'rewriting a finished route changes what the crew actually did');

  // every route-building list honours the tag
  const routeLists = (admin.match(/let available = jobAddresses\.filter\([^;]*;/g) || []);
  check('quoteresp', 'every route list excludes Maybe Next Year',
    routeLists.length >= 4 && routeLists.every(l => l.includes('!a.data.maybeNextYear')),
    'found ' + routeLists.length + ' route lists, ' +
    routeLists.filter(l => !l.includes('!a.data.maybeNextYear')).length + ' not honouring the tag');

  /* --- what the customer is told ----------------------------------------
     These used to test a design where "maybe next year" and "declined" each got
     their own page and their own route (/quote-maybe, /quote-declined), gated
     behind a sessionStorage pass so nobody could wander onto a farewell screen
     by typing the address.

     That design was replaced the next day (2026-08-11) by an inline confirmation
     on the quote page itself, which is what ships today. The replacement is
     NEWER, not a revert — so these now test the design that actually exists.
     If the separate pages ever come back, the old checks are in git at b16adce. */
  const quoteAnswer = idx.slice(idx.indexOf("callPortalFn('quoteRespond'"),
    idx.indexOf('/* ---- Portal token helpers ---- */'));

  check('quoteresp', 'the answer is acknowledged before the server replies',
    /saving your answer/.test(quoteAnswer),
    'the customer taps a button and sees nothing change until the round trip finishes');
  check('quoteresp', 'maybe next year promises contact next season',
    /check back next year/.test(quoteAnswer) && /measurements are saved/.test(quoteAnswer),
    'they would not know we are keeping them on file, and would expect to start over next year');
  check('quoteresp', 'decline thanks them rather than just recording it',
    /Thanks for letting us know/.test(quoteAnswer) && /no hard feelings/.test(quoteAnswer),
    'a bare acknowledgement reads as annoyance at a customer who owes us nothing');
  check('quoteresp', 'both answers give a follow-up line, not just a headline',
    (quoteAnswer.match(/setQuoteConfirmSub\(/g) || []).length >= 2,
    'one of the two answers would show a bare one-liner with no explanation');
  check('quoteresp', 'a quote that cannot be found tells them who to call',
    /couldn't find your quote[\s\S]{0,120}901-0011/.test(quoteAnswer),
    'a dead end with no phone number turns a lost quote into a lost customer');
  check('quoteresp', 'a failed call still gives them a way through',
    /catch\(function\(\)\{[\s\S]{0,220}901-0011/.test(quoteAnswer),
    'a network blip would leave "saving your answer..." on screen forever');
  check('quoteresp', 'the confirmation actually gets shown',
    /confirmWrap\.style\.display = 'block'/.test(quoteAnswer) ||
    /confirmWrap\) confirmWrap\.style\.display/.test(idx.slice(idx.indexOf('quote-minimal'))),
    'the message would be written into a hidden element and nobody would see it');
})();

// =====================================================================
suite('11. Reliability pass');
/*
 * The 2026-08-14 audit's §2 items. None of these are money bugs on their own;
 * each is a way the app quietly did the wrong thing and told nobody.
 */
(function () {
  const idx = read('index.html');
  const fns = read('functions/index.js');

  // ---- 2.1 Health Check runs on its own ----------------------------------
  /* Sixteen checks that cost nothing to run sat behind a button, and the
     sidebar badge counting the problems was only written by hcRender, which
     only ran when that button was pressed. You had to already suspect a problem
     to be told there was one. */
  check('reliability', 'health check runs automatically after login',
    /startHealthCheckAuto\(\)/.test(admin) && /function startHealthCheckAuto/.test(admin),
    'the checks only ever ran when someone pressed the button');
  check('reliability', 'the automatic run waits for the customer list to load',
    /function hcCachesReady/.test(admin) && /if\(!hcCachesReady\(\)\) return;/.test(admin),
    'running against an empty cache reports a serene "everything lines up" a second after login');
  check('reliability', 'the automatic run repeats, not just once',
    /setInterval\(runHealthCheckAuto/.test(admin),
    'a check that runs once at login misses everything that happens during the day');
  check('reliability', 'a failing background check cannot break the page',
    /function runHealthCheckAuto\(\)\{[\s\S]{0,400}try\{[\s\S]{0,300}catch/.test(admin.replace(/\r/g,'')),
    'an unhandled throw in a timer would take out whatever render came next');

  // ---- 2.2 Duplicate customer on the Add form ----------------------------
  /* findExistingAddressMatch was written for the bulk importer and only the
     bulk importer called it. Adding a repeat customer by hand made a second
     record for the same house — and invoices are keyed by phone, so the two
     immediately shared one invoice. */
  const addForm = admin.slice(admin.indexOf("getElementById('routeAddressForm').addEventListener"),
                              admin.indexOf('BULK UPDATES (Add Customer)'));
  check('reliability', 'the Add form checks for an existing customer at that address',
    /findExistingAddressMatch\(street, phone, city, zip\)/.test(addForm),
    'a repeat quote silently created a second record that shares one invoice with the first');
  check('reliability', 'the duplicate warning happens before anything is written',
    addForm.indexOf('findExistingAddressMatch') < addForm.indexOf('addDoc('),
    'warning after the write is not a warning');
  check('reliability', 'the duplicate warning can be overridden for a real second property',
    /Add a second record anyway\?/.test(addForm),
    'two houses for one family is legitimate and must not be blocked outright');

  // ---- 2.5 invoicedAt ----------------------------------------------------
  check('reliability', 'invoicedAt is written when the invoice is issued',
    /if \(!inv\.invoicedAt\) inv\.invoicedAt = admin\.firestore\.Timestamp\.now\(\);/.test(fns),
    'read in four places, written in none — every due date ran off updatedAt instead');
  check('reliability', 'invoicedAt is stamped once and never moved',
    /if \(!inv\.invoicedAt\)/.test(fns),
    're-stamping on every run would push the due date out and un-flag an overdue bill');
  check('reliability', 'Start New Season clears last season issue date',
    /invoicedAt: null/.test(admin),
    "last year's date would make every new invoice read as ~10 months overdue");

  // ---- 2.6 Bin numbers on Delete All -------------------------------------
  const delAll = admin.slice(admin.indexOf("getElementById('deleteAllAddressesBtn').addEventListener"),
                             admin.indexOf("getElementById('deleteAllAddressesBtn').addEventListener") + 2600);
  check('reliability', 'Delete All Customers returns the numbers to the pool',
    /availableCustomerNumbers/.test(delAll),
    'numbering restarts above the old maximum and every labelled bin means nothing');
  check('reliability', 'Delete All reports how many numbers came back',
    /returned to the pool/.test(delAll),
    'a silent recycle is indistinguishable from no recycle');

  // ---- 2.7 Warehouse Mark Completed --------------------------------------
  check('reliability', 'the warehouse completed box says it counts houses, not bundles',
    /Houses finished/.test(admin) && /<strong>not<\/strong> the/.test(admin),
    'the heading counts bundles and the box counted houses, with nothing saying so');
  check('reliability', 'marking a batch completed lists who it clears first',
    /Mark ' \+ remaining \+ ' finished for/.test(admin),
    'it cleared houses in arbitrary order with no confirm and no record of which');
  check('reliability', 'the completed count cannot exceed what is in the group',
    /if\(remaining > capacity\) remaining = capacity;/.test(admin),
    'typing 14 into a 6-house group emptied the group');

  // ---- 2.8 Map pins ------------------------------------------------------
  check('reliability', 'All Customers can filter to customers with no map pin',
    /allCustFilterPin/.test(admin) && /Needs Pin/.test(admin),
    'the import told staff to search "Needs Pin", a search that did not exist');
  check('reliability', 'the pin test judges coordinates, not the import flag',
    /function hcHasMapPin/.test(admin) && !/needsGeocode/.test(
      admin.slice(admin.indexOf('function hcHasMapPin'), admin.indexOf('function hcHasMapPin') + 500)),
    'needsGeocode is only ever written by the bulk importer, so hand-typed customers were missed');
  check('reliability', 'the import message points somewhere that exists',
    /All Customers → Filters → Map Pin/.test(admin) || /Filters/.test(admin.slice(admin.indexOf('added without a map pin'), admin.indexOf('added without a map pin') + 200)),
    'it named a search that was never built');

  // ---- 2.9 Time Logs -----------------------------------------------------
  check('reliability', 'the timecard listener is bounded by date, not a flat count',
    /where\('createdAt','>=', cutoff\)/.test(admin) && !/orderBy\('createdAt','desc'\), limit\(300\)/.test(admin),
    'limit(300) made an old week look identical to an empty one');
  check('reliability', 'payroll knows which weeks it actually loaded',
    /function payrollWeekIsLoaded/.test(admin),
    'an empty week must never be mistaken for nobody having worked');
  check('reliability', 'the payroll export REFUSES a week it did not load',
    /if\(!payrollWeekIsLoaded\(\)\)\{[\s\S]{0,400}Export stopped/.test(admin.replace(/\r/g,'')),
    'a short export is a short paycheque, and it showed nothing on the way out');

  // ---- 2.10 Double-click guards ------------------------------------------
  check('reliability', 'the slow write tools cannot be started twice',
    (admin.match(/onceAtATime\(async function/g) || []).length >= 4,
    'Add Customer, both bulk imports and the payment import all ran twice on a double click');
  check('reliability', 'the guard re-enables the button even when the handler throws',
    /function onceAtATime[\s\S]{0,900}finally \{[\s\S]{0,200}btn\.disabled = false;/.test(admin.replace(/\r/g,'')),
    'a dead button that needs a page refresh is worse than the double click');

  // ---- 2.11 Search -------------------------------------------------------
  check('reliability', 'the customer numbers list has a search box',
    /cnFullSearch/.test(admin),
    '~962 rows with no way to find one');
  check('reliability', 'All Customers shows the customer number',
    /function custNumChip/.test(admin),
    'the number painted on their bins was not visible anywhere in the list');
  check('reliability', 'All Customers can be searched by customer number',
    /String\(r\.d\.customerNumber\|\|''\) === numTerm/.test(admin),
    'the one identifier staff say out loud could not find anybody');
  check('reliability', 'Customer Messages has a search box',
    /msgSearchInput/.test(admin),
    'every message ever loads with no limit and nothing to filter them');

  // ---- 2.12 Debounce and indexes -----------------------------------------
  check('reliability', 'the long list searches wait for a pause in typing',
    /function debounced/.test(admin) &&
    (admin.match(/addEventListener\('input', debounced\(/g) || []).length >= 4,
    'every keystroke rebuilt ~967 rows and the box stopped accepting input mid-word');
  check('reliability', 'invoices are looked up by key, not by scanning them all',
    /invoiceById\.get\(key\)/.test(admin) && !/allInvoicesCache\.find\(i => i\.id === key\)/.test(admin),
    'called once per row: ~967 x ~967 comparisons per repaint');
  check('reliability', 'customers are looked up by phone through an index',
    /custByPhoneDigits\.get\(digits\)/.test(admin) && /function rebuildCustomerIndexes/.test(admin),
    'this ran per invoice from two renders, with a replace() on every comparison');
  check('reliability', 'the index is rebuilt whenever the customer list changes',
    /rebuildCustomerIndexes\(\);/.test(admin.slice(admin.indexOf('function loadJobAddresses'), admin.indexOf('function loadJobAddresses') + 900)),
    'a stale index answers with a customer who has since been deleted');
  check('reliability', 'the bill-to lookup only runs when there is a bill-to',
    /billToDigits \? custByPhoneDigits\.get\(billToDigits\) : null/.test(admin),
    "it scanned every customer per row to match whoever happened to have no phone");

  // ---- 2.13 $NaN ---------------------------------------------------------
  check('reliability', 'the portal balance coerces every amount',
    /var invInstall\s+= Number\(record\.install\)\s+\|\| 0;/.test(admin ? idx : idx),
    'an invoice with no amounts printed the customer the literal text "$NaN"');
  check('reliability', 'the portal money formatter coerces and shows cents',
    /function fmt\(n\)\{[\s\S]{0,200}Number\(n\) \|\| 0[\s\S]{0,200}minimumFractionDigits: 2/.test(idx.replace(/\r/g,'')),
    'undefined.toLocaleString() throws, and the emailed invoice already showed cents');
  check('reliability', 'the function never creates an invoice with no amounts on it',
    /BLANK_AMOUNTS/.test(fns) && /destExists/.test(fns),
    'portalSave created amount-less invoices when a customer changed their phone');
  check('reliability', 'the blank amounts are never merged over a real invoice',
    /destExists\s*\?\s*Object\.assign\(\{\}, carried, invoiceUpdates\)/.test(fns),
    'zeroing an existing balance would be far worse than the bug being fixed');

  // ---- 2.14 Demo number and debug strings --------------------------------
  check('reliability', 'the demo phone number is gone from the sign-in page',
    !/Try demo number/.test(idx),
    'the portal told every customer to sign in as somebody else');
  check('reliability', 'customers are not shown internal debug strings',
    !/\[debug: id=" \+/.test(idx) && !/", invPhone=" \+/.test(idx),
    'it leaked our record ids and the phone numbers we hold for them onto their screen');
  check('reliability', 'the diagnostics still go to the console for phone support',
    /function logPortalSaveFailure/.test(idx),
    'removing the detail entirely would leave nothing to help them with');
})();

// =====================================================================
suite('12. Season prep — customer portal (§3)');
(function () {
  const idx = read('index.html');
  const fns = read('functions/index.js');

  /* ---- 3.4 The Light Colors picker was charging $30 for nothing ----------
   * THE WORST OF THIS BATCH, because it took money.
   * parseSequenceFromLightsDescription is lossy by design — it cuts everything
   * after "(", so the office's own "Red, Green (every third bulb)" came back as
   * "Red, Green". saveLightsPattern then compared that against the STORED text,
   * decided the customer had changed their lights, destroyed the crew's
   * instruction and added a $30 fee — for opening the tab and pressing Save.
   */
  check('season', 'the light picker remembers what it loaded with',
    /function rcRememberLoadedState/.test(idx) && /rcLoadedSerialised/.test(idx),
    'without a baseline there is nothing to compare a "change" against');
  check('season', 'saving an untouched picker changes nothing and charges nothing',
    /picked === rcLoadedSerialised/.test(idx) && /Nothing changed — no charge/.test(idx),
    'opening the tab and pressing Save added a $30 fee and wiped the pattern');
  /* The "did anything change?" test must run BEFORE the fee confirm, and must
     read the picker baseline rather than the stored text. Asserted by ORDER,
     which is the thing that actually has to hold: an early return that happens
     after the charge prompt is not an early return. */
  check('season', 'the no-change check runs before the $30 prompt',
    (function () {
      const s = idx.replace(/\r/g, '');
      const guard = s.indexOf('picked === rcLoadedSerialised');
      const prompt = s.indexOf('Changing your lights adds a one-time $30 change fee');
      return guard !== -1 && prompt !== -1 && guard < prompt;
    })(),
    'a customer who changed nothing must never reach the fee prompt at all');
  check('season', 'a crew instruction in brackets survives a real colour change',
    /rcDroppedDetail/.test(idx) && /newLightsDescription \+ ' ' \+ rcDroppedDetail/.test(idx),
    '"(every third bulb)" was silently deleted whenever a customer changed colours');
  check('season', 'an empty selection cannot silently wipe a real pattern',
    /You have not selected any colours/.test(idx),
    'free text parsed to nothing, so a save wiped it with no prompt at all');
  check('season', 'a second save does not charge a second time',
    /rcLoadedSerialised = picked;/.test(idx),
    'the baseline has to move to what was just saved');
  check('season', 'the colour swatches are a safe tap target',
    !/class="rc-swatch"[^>]*width:32px/.test(idx),
    'a mis-tap on this picker costs the customer $30');

  /* ---- 3.1 / 3.2 / 3.3 the three call-deflectors ------------------------- */
  check('season', 'the portal itemises the balance',
    /function renderInvoiceBreakdown/.test(idx),
    'the emailed invoice itemised all along; the portal showed one number');
  check('season', 'fee and credit reasons are shown, not just amounts',
    /changeFeeNotes/.test(idx) && /creditNotes/.test(idx),
    'a bare "-$25" prompts exactly the call this is meant to prevent');
  check('season', 'staff-entered reasons are escaped before reaching innerHTML',
    /function escapeHtmlPortal/.test(idx) && /escapeHtmlPortal\(r\[0\]\)/.test(idx),
    'reasons are free text typed by staff');
  check('season', 'payment date and method are whitelisted for the portal',
    /'lastPaymentAt', 'lastPaymentMethod'/.test(fns),
    'both were written from the start and never sent, so "did you get my payment?" could not be answered');
  check('season', 'the portal shows when a payment was received',
    /function renderLastPaymentNote/.test(idx));
  check('season', 'the schedule date is whitelisted for the portal',
    /'scheduledDate', 'completed', 'removalDone'/.test(fns),
    'the most-asked question of the season, answerable from the record all along');
  check('season', 'the portal shows a schedule status strip',
    /function renderScheduleStrip/.test(idx));
  check('season', 'the crew and stop order are NEVER sent to the customer',
    !/'assignedCrew'/.test(fns) && !/'stopOrder'/.test(fns),
    'publishing those turns "when are you coming?" into "why am I last?"');
  check('season', 'the schedule date is not shifted a day by UTC parsing',
    /function portalNiceDate/.test(idx) && /new Date\(Number\(m\[1\]\), Number\(m\[2\]\) - 1, Number\(m\[3\]\)\)/.test(idx),
    "new Date('2026-11-18') is UTC midnight — the evening before, in Mountain Time");

  /* ---- 3.5 / 3.6 / 3.7 --------------------------------------------------- */
  check('season', 'no invoice yet is not reported as no account',
    /noInvoiceYet/.test(idx) && /knownRecord/.test(idx),
    'a customer added before being priced was told "we couldn\'t find an account"');
  check('season', 'a customer with no bill is not offered a $0.00 payment',
    /\(isPaid \|\| noInvoiceYet\) \? 'none' : 'block'/.test(idx),
    'offering a card payment to somebody with no bill is worse than showing nothing');
  check('season', 'the sign-in error shows what the server actually said',
    /function showLookupError/.test(idx) && /resource-exhausted/.test(idx),
    '"too many attempts, wait 15 minutes" was thrown away and reported as a wrong name');
  check('season', 'no sign-in failure is swallowed by a bare catch any more',
    !/\}\)\.catch\(function\(\)\{\s*document\.getElementById\('lookupEmpty'\)/.test(idx.replace(/\r/g,'')),
    'that is what threw the useful message away');
  check('season', 'a signed-in customer can RSVP without the email',
    /data-portalrsvp/.test(idx) && /callPortalFn\('portalRsvp', \{token: token, response: answer\}\)/.test(idx),
    'portalRsvp was only ever reachable from the emailed link');
  check('season', 'saying no this season asks first',
    /answer === 'no' && !window\.confirm/.test(idx),
    'that answer starts recycling their lights');

  /* ---- 3.8 basics for an older customer base ----------------------------- */
  check('season', 'the portal forms have real labels',
    (idx.match(/<label for="/g) || []).length >= 8,
    'zero label-for pairs in the whole file');
  check('season', 'the portal forms autofill',
    (idx.match(/autocomplete="/g) || []).length >= 8);
  check('season', 'the phone fields open a number keypad',
    /inputmode="tel"/.test(idx),
    'type="text" with no inputmode opens the letter keyboard');
  check('season', 'save results are announced to screen readers',
    (idx.match(/aria-live="polite"/g) || []).length >= 5,
    '"Saved!" was written into a div nothing announced');
  check('season', 'the explanatory text is not the smallest thing on the page',
    /\.form-note\{ font-size:14px/.test(idx),
    'it carries the $30 fee warning, at 12.5px, to an older customer base');
})();

// =====================================================================
suite('13. Season prep — crew portal (§4)');
(function () {
  const emp = read('employee.html');
  const sw = read('sw-crew.js');

  /* ---- 4.1 January had no crew screen at all, and a money landmine ------- */
  check('season', 'the crew portal asks for removal routes',
    /const types = \['install','fix','removal'\]/.test(emp),
    'every day of January a crew saw "No route scheduled for this day"');
  check('season', 'a removal Done writes removalDone, NOT completed',
    /routeType === 'removal'\s*\?\s*\{removalDone: true/.test(emp),
    'completed is what the nightly biller keys off — removals would re-bill the install');
  check('season', 'the Done button knows which kind of route it is on',
    /data-markdone="'\+stop\.id\+'" data-routetype="'\+type\+'"/.test(emp),
    'without the type it cannot choose the right field, which is a money decision');
  check('season', 'a taken-down house shows its own badge',
    /Taken Down/.test(emp));

  /* ---- 4.2 offline ------------------------------------------------------- */
  check('season', 'the badge is painted before the server is awaited',
    /renderStopStatus\(id, Object\.assign\(\{\}, stopDataCache\[id\] \|\| \{\}, updates, \{__optimistic: true\}\)\)/.test(emp),
    'offline the acknowledgement never comes, so the tap looked like it did nothing');
  check('season', 'there is an offline indicator',
    /offlineBadge/.test(emp) && /window\.addEventListener\('offline'/.test(emp));

  /* ---- 4.3 the offline story has to survive a reload --------------------- */
  check('season', 'the service worker caches the Firebase modules',
    /VENDOR_URLS/.test(sw) && /firebasejs\/10\.12\.2\/firebase-app\.js/.test(sw),
    'a cached page whose app is three cross-origin modules is a shell that cannot boot');
  check('season', 'those are the only cross-origin requests it touches',
    /if \(VENDOR_URLS\.indexOf\(url\.href\) !== -1\)/.test(sw) && /url\.origin !== self\.location\.origin/.test(sw),
    "Firestore's own traffic must still pass straight through");
  check('season', 'the cache version was bumped with the change',
    /hu-crew-shell-v4/.test(sw),
    'without a bump the old cache stays on every phone');
  check('season', 'the pinned module version matches the page',
    (function () {
      const m = /firebasejs\/(\d+\.\d+\.\d+)\/firebase-app\.js/.exec(sw);
      return !!m && emp.indexOf('firebasejs/' + m[1] + '/firebase-app.js') !== -1;
    })(),
    'caching a version the page does not load is caching nothing');

  /* ---- 4.4 to 4.8 -------------------------------------------------------- */
  check('season', 'a failed detail lookup is visible, not silent',
    /Couldn\\'t load this house\\'s details/.test(emp),
    "the card rendered looking normal with the gate code and warnings missing");
  check('season', 'the crew can call the customer from a stop',
    /href="tel:/.test(emp),
    'the number was frozen into every stop and never shown');
  check('season', 'flagging an issue records what is wrong',
    /fixNote: note/.test(emp),
    'a flag holds up the payer\'s whole invoice, so one with no reason stops money moving');
  check('season', 'an empty flag reason is refused',
    /a flag with no reason cannot be acted on/.test(emp));
  check('season', 'an unassigned person is not shown crew 1 route',
    /return null;/.test(emp.slice(emp.indexOf('function crewFromConfig'), emp.indexOf('function crewFromConfig') + 600)) &&
    /You are not on a crew for/.test(emp),
    'they would work a real route belonging to somebody else');
  check('season', 'the crew picks their name from a list, not a text box',
    /data-whoname/.test(emp) && !/whoNameInput/.test(emp),
    'first-name matching made the second Jose become the first, pay rate included');
  check('season', 'finished stops can be hidden',
    /routeHideDone/.test(emp) && /route-hide-done/.test(emp),
    'the route never got shorter as the day went on');
  check('season', 'Mark Done and Flag Issue are not a thumb-width apart',
    /\.stop-actions\{ display:flex; gap:14px/.test(emp),
    'they do opposite things and sat 8px apart on a phone used in gloves');
})();

// =====================================================================
/* Header printed inside the async block below, so it appears above its own
   results rather than above an empty gap. */
/*
 * ⚠ THE LESSON IN THIS SUITE.
 *
 * On 2026-08-13 commit 9e2bb9b left `billedHouseIds: forTotal.map(h => h.id)`
 * in syncPayerInvoice. There is no variable called forTotal — the real one is
 * `active`. JavaScript builds that whole object literal before setDoc ever
 * sees it, so the function threw ReferenceError and wrote NOTHING, every single
 * time it ran, for a day. It is on five money paths: changing who a customer is
 * billed to, saving a multi-house invoice (where it throws AFTER the payment is
 * written, so the panel just hangs), Health Check's "Resync totals", and bulk
 * price updates.
 *
 * The suite stayed green the whole time, because the checks above only ever
 * read this function as TEXT. So this suite RUNS it, against fake Firestore
 * calls. A regex cannot catch an undefined variable; executing the code can.
 */
(function () {
  const start = admin.indexOf('async function syncPayerInvoice(');
  if (start === -1) {
    check('sync', 'syncPayerInvoice found in admin.html', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  // Slice to the closing brace at column 0, the same way the text checks do.
  const src = admin.slice(start, admin.indexOf('\n}', start) + 2);

  // A tiny fake Firestore. Every call records what it was asked for; setDoc
  // captures the document that would have been written.
  function makeHarness(houses, existingInvoice) {
    const written = [];
    const ctx = {
      db: {},
      doc: (...a) => ({ __path: a.slice(1).join('/') }),
      collection: (...a) => ({ __col: a[1] }),
      query: (col, ...rest) => ({ __col: col.__col, __where: rest }),
      where: (f, op, v) => ({ f, op, v }),
      serverTimestamp: () => '__ts__',
      getDoc: async () => ({
        exists: () => !!existingInvoice,
        data: () => existingInvoice || {}
      }),
      getDocs: async (q) => {
        // Only the billToPhone query returns rows here; the email/phone
        // fallbacks resolve out of the jobAddresses list below.
        const w = (q.__where || [])[0] || {};
        const rows = houses.filter(h => w.f && String(h.data[w.f] || '') === String(w.v));
        return { forEach: (fn) => rows.forEach(r => fn({ id: r.id, data: () => r.data })) };
      },
      setDoc: async (ref, payload) => { written.push(payload); },
      jobAddresses: houses,
      custInvoiceKey,
      computeInvoiceStatus,
      console
    };
    const names = Object.keys(ctx);
    const fn = new Function(...names, src + '\nreturn syncPayerInvoice;')(...names.map(n => ctx[n]));
    return { fn, written };
  }

  const houses = [
    { id: 'h1', data: { name: 'Payer', phone: '8011112222', housePrice: 400 } },
    { id: 'h2', data: { name: 'Rental', phone: '8013334444', billToPhone: '8011112222', housePrice: 300 } }
  ];

  // THE REGRESSION TEST. Before the fix this threw ReferenceError: forTotal.
  let threw = null, harness = makeHarness(houses, { install: 700, removal: 50, deposit: 100 });
  pendingAsync.push((async () => {
    suite('10. syncPayerInvoice actually runs');
    try { await harness.fn('8011112222'); } catch (e) { threw = e; }

    check('sync', 'syncPayerInvoice runs without throwing',
      threw === null,
      'it threw ' + (threw && threw.message) + ' — every caller writes nothing, silently');
    check('sync', 'syncPayerInvoice actually writes the invoice',
      harness.written.length === 1,
      'the write never happened, so the invoice keeps its stale total');

    const w = harness.written[0] || {};
    check('sync', 'billedHouseIds names the houses the total was summed from',
      Array.isArray(w.billedHouseIds) && w.billedHouseIds.length === 2 &&
      w.billedHouseIds.indexOf('h1') !== -1 && w.billedHouseIds.indexOf('h2') !== -1,
      'the printed invoice rows must add up to the amount printed beside them');
    check('sync', 'the total is the sum of the houses',
      w.install === 700, 'got ' + w.install);
    check('sync', 'an existing removal charge survives the rebuild',
      w.removal === 50, 'a real takedown charge would be wiped');
    check('sync', 'a recorded payment survives the rebuild',
      w.deposit === 100, 'wiping a payment means chasing money already sent');

    // A cancelled house must be excluded from BOTH the total and the row list,
    // not one of them — that is the pairing billedHouseIds exists to guarantee.
    const cancelled = [
      houses[0],
      { id: 'h2', data: { name: 'Rental', phone: '8013334444', billToPhone: '8011112222', housePrice: 300, rsvpStatus: 'no' } }
    ];
    const h2 = makeHarness(cancelled, { install: 700 });
    await h2.fn('8011112222');
    const w2 = h2.written[0] || {};
    check('sync', 'a cancelled house leaves both the total and the row list',
      w2.install === 400 && Array.isArray(w2.billedHouseIds) &&
      w2.billedHouseIds.length === 1 && w2.billedHouseIds[0] === 'h1',
      'the invoice rows and the invoice total would disagree');

    // The $30 join fee is not part of any house price, so a rebuild that
    // forgets it silently un-charges the fee.
    const h3 = makeHarness(houses, { install: 730, newMemberFeeApplied: true });
    await h3.fn('8011112222');
    check('sync', 'the $30 join fee survives a rebuild',
      (h3.written[0] || {}).install === 730,
      'the fee would be quietly refunded on the next price edit');
  })());
})();

// =====================================================================
suite('9. Portal sign-in security');
/*
 * These run the REAL functions out of functions/index.js, not a regex over
 * their text. Both bugs in this suite shipped past a suite that only read
 * source code as strings.
 */
(function () {
  const fns = read('functions/index.js');
  const idx = read('index.html');

  // ---- nameMatches: the last-name half of the portal sign-in --------------
  /* Until 2026-08-14 this ended with `stored.indexOf(typed) !== -1`, a plain
     substring test. Typing the single letter "a" matched "Sarah Adams",
     "Frome" and "Cosby" — nearly every name in the book. Five attempts are
     allowed per phone per 15 minutes and one was enough, so anyone who knew a
     customer's phone number could open their account, read their address and
     gate code, and edit them through portalSave. */
  const nameMatchesSrc = extractFn(fns, 'nameMatches');
  check('security', 'nameMatches found in functions/index.js',
    !!nameMatchesSrc,
    'renamed or removed — the sign-in check can no longer be proved');

  if (nameMatchesSrc) {
    const nameMatches = new Function(nameMatchesSrc + '\nreturn nameMatches;')();

    // The attack. A single letter, and a partial word, must both be refused.
    check('security', 'a single letter is not a last name',
      nameMatches('Sarah Adams', 'a') === false,
      'one letter matched almost every customer — account takeover with just a phone number');
    check('security', 'a partial word is not a last name',
      nameMatches('Sarah Adams', 'ada') === false &&
      nameMatches('Staci Cosby', 'os') === false,
      'substring matching lets a guesser in without knowing the name');
    check('security', 'an empty last name never matches',
      nameMatches('Sarah Adams', '') === false &&
      nameMatches('Sarah Adams', '   ') === false);

    // Real customers must still get in. These are the cases that make a
    // stricter rule safe to ship.
    check('security', 'the real last name still signs in',
      nameMatches('Sarah Adams', 'Adams') === true &&
      nameMatches('Sarah Adams', 'adams') === true &&
      nameMatches('Sarah Adams', '  Adams  ') === true);
    check('security', 'the first name still signs in',
      nameMatches('Sarah Adams', 'Sarah') === true,
      'word-order independence is deliberate — customers type either part');
    check('security', 'typing the full name still signs in',
      nameMatches('Sarah Adams', 'Sarah Adams') === true,
      'people put their whole name in the last-name box');
    check('security', 'a hyphenated surname signs in on either half',
      nameMatches('Sarah Adams-Brown', 'Adams') === true &&
      nameMatches('Sarah Adams-Brown', 'Brown') === true,
      'married and double-barrelled names are common and must not be locked out');
    check('security', 'an apostrophe surname signs in',
      nameMatches("Sarah O'Brien", 'Brien') === true ||
      nameMatches("Sarah O'Brien", "O'Brien") === true);
    /* Deliberately no minimum length. The audit suggested rejecting anything
       under 3 characters; the whole-word rule closes the hole on its own, and
       Le, Ho, Ng and Vu are real surnames that a length floor would lock out
       of their own accounts permanently. */
    check('security', 'a genuine two-letter surname is not locked out',
      nameMatches('Minh Le', 'Le') === true && nameMatches('Wei Ng', 'Ng') === true,
      'a 3-character minimum would permanently exclude these customers');
  }

  // ---- portalLookup must never upgrade a quote token into a portal token --
  /* The public quote form generates quoteToken in the VISITOR'S OWN BROWSER
     (index.html) and saves it on the quote, so whoever submitted the form
     already knows it. portalLookup used to take that token, look the quote's
     phone up in jobAddresses, and on a hit return that customer's real
     portalToken, invoiceKey and sanitized record — address and gate code
     included. Token lookups are deliberately not rate limited. */
  const lookupStart = fns.indexOf("exports.portalLookup");
  const lookupSrc = lookupStart > -1
    ? fns.slice(lookupStart, fns.indexOf('exports.portalSave'))
    : '';
  check('security', 'portalLookup found',
    lookupSrc.length > 0, 'renamed or moved — update this test');
  check('security', 'a quote token is never traded for a customer record',
    lookupSrc.length > 0 && !/const byPhone = await findByPhone\(qPhone\)/.test(lookupSrc),
    'anyone who knows a customer phone number could submit a quote and take over the account');
  check('security', 'the quote-token path still answers with the quote itself',
    /isQuote: true/.test(lookupSrc),
    'a genuine quote email link must still open the quote review');
  check('security', 'the quote form still generates its token in the browser',
    /quoteToken: generatePortalToken\(\)/.test(idx),
    'if this ever moves server-side the threat model above changes — revisit this suite');
  check('security', 'the site sends a quote token to the quote review, not the portal',
    /if\(res\.isQuote\)\{[\s\S]{0,600}tryShowQuoteReview/.test(idx),
    'the quote-only answer used to fall through to the invoice page and fail to load');
  check('security', 'a quote token is never stored as a portal login',
    /if\(res\.isQuote\)\{[\s\S]{0,600}return;/.test(idx) &&
    idx.indexOf('savePortalLogin(res.token || token)') > idx.indexOf('if(res.isQuote){'),
    'a stored quote token would be replayed on the next visit');

  // ---- portalInvoice: balances keyed by phone digits ----------------------
  /* Invoice doc IDs are phone digits, so with no limiter at all this was a
     freely enumerable balance lookup. The original comment was right that
     limiting every call locks customers out (it re-runs on every portal
     render) — so only misses are counted. */
  // ---- a captured payment must never be dropped on the floor -------------
  /* recordPaypalPayment used to `return` silently when the invoice document
     was missing: no log, no alert, no record, and the customer's screen still
     said "Paid in Full". Reachable in ordinary use — portalSave MOVES the
     invoice doc when a customer changes their phone or email, so anyone who
     updates their number between opening the pay screen and approving the
     payment lands here. The card has already been charged by then. */
  const rppStart = fns.indexOf('async function recordPaypalPayment');
  const rppSrc = rppStart > -1 ? fns.slice(rppStart, rppStart + 4000) : '';
  check('money', 'a captured payment with no invoice is filed, not discarded',
    /orphaned = true/.test(rppSrc) && /recordUnmatchedPayment/.test(rppSrc),
    'the money was charged and then silently forgotten');
  check('money', 'an unmatched payment raises an alert',
    /twilioSendRaw/.test(fns.slice(fns.indexOf('async function recordUnmatchedPayment'), fns.indexOf('async function recordUnmatchedPayment') + 2000)),
    'a record nobody is told about is a record nobody reads');
  check('money', 'unmatchedPayments is readable by staff and writable only by the function',
    /match \/unmatchedPayments\/\{id\}\s*\{\s*allow read: if request\.auth != null; allow write: if false;/.test(read('firestore.rules')),
    'a collection missing from the rules is denied by default and the panel renders empty');
  check('money', 'an unmatched payment is keyed so the webhook and the browser cannot double-file it',
    /collection\('unmatchedPayments'\)\.doc\(String\(captureId\)\)/.test(rppSrc + fns.slice(fns.indexOf('async function recordUnmatchedPayment'), fns.indexOf('async function recordUnmatchedPayment') + 2000)),
    'both paths run for the same capture — an add() would file it twice');

  // ---- the nightly run must never skip a customer in silence -------------
  /* A customer with no email address was passed over with a bare `continue`:
     not counted as sent, skipped or errored. The summary text read "0 sent, 0
     errors" and looked healthy while an installed house went unbilled all
     season. A phone-only signup is the ordinary case for a phone enquiry. */
  check('money', 'a customer with no email is counted, not silently skipped',
    /skippedNoEmail\+\+/.test(fns),
    'the nightly text says "0 sent, 0 errors" while a house goes unbilled all season');
  check('money', 'the no-email count reaches the run log',
    (fns.match(/skippedNoEmail,/g) || []).length >= 2 && /skippedNoEmail: 0/.test(fns),
    'a counter that never reaches the result object is a counter nobody sees');
  check('money', 'the alert text names the customers who could not be billed',
    /noEmailNames/.test(fns) && /NO EMAIL \(cannot be billed\)/.test(fns),
    'a number with no names gives you nothing to act on');
  check('money', 'admin shows the no-email count in the nightly log',
    (admin.match(/skippedNoEmail/g) || []).length >= 2,
    'both the run-now message and the last-10-runs list must show it');

  const piStart = fns.indexOf('exports.portalInvoice');
  const piSrc = piStart > -1 ? fns.slice(piStart, piStart + 3000) : '';
  check('security', 'portalInvoice rate-limits a failed last-name guess',
    /checkRateLimit\('invoice_'/.test(piSrc),
    'invoice IDs are phone digits — balances were enumerable with no limit at all');
  check('security', 'portalInvoice does not rate-limit a successful sign-in',
    /if \(nameMatches\(data\.name, lastName\)\) \{\s*authorized = true;\s*\} else \{/.test(piSrc),
    'this function re-runs on every portal render — charging successes locks customers out');
  check('security', 'portalInvoice never rate-limits the token path',
    !/token[\s\S]{0,200}checkRateLimit/.test(piSrc.slice(0, piSrc.indexOf('lastName)'))),
    'a customer following their own emailed link must never be throttled');
})();

// =====================================================================
// Wait for the async suites before totalling up — see pendingAsync at the top.
// A check that scores after this summary is a check that cannot fail the build.
Promise.all(pendingAsync).then(function () {
  console.log('\n' + '='.repeat(55));
  console.log(pass + ' passed, ' + fail + ' failed' + (warn ? ', ' + warn + ' notes' : ''));
  if (fail) {
    console.log('\nFailures:');
    results.forEach(r => console.log('  - ' + r));
    console.log('\nFix these before pushing.');
  } else {
    console.log('\nAll good. Safe to push.');
  }
  if (gaps.length) {
    console.log('\n' + gaps.length + ' known data-flow gaps (not blockers, but worth fixing):');
    gaps.forEach(g => console.log('  - ' + g.split(' — ')[0]));
    console.log('  See the GAP lines above for detail.');
  }
  console.log('='.repeat(55) + '\n');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  // An async suite that blew up must never be mistaken for a clean run.
  console.log('\n  FAIL  an async suite crashed: ' + (e && e.stack || e));
  console.log('\n' + '='.repeat(55));
  console.log(pass + ' passed, ' + (fail + 1) + ' failed\n');
  process.exit(1);
});
