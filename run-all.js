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

/* ---- this suite polices ITSELF -------------------------------------------
 * A check that slices "the next N characters after this anchor" is a slow
 * fuse. The moment the real code grows past N, a correct, present, working
 * line falls outside the window and the check reports FAILURE — on code that
 * is right. That happened three times in one afternoon (once at 15,304
 * characters against a 15,000 window), and when the audit finally measured
 * them, THIRTEEN OF SEVENTEEN windows were already cutting their block short
 * and simply had not been noticed yet.
 *
 * They are all gone, replaced by sectionFrom(), which slices to the end of the
 * enclosing top-level construct — a real structural anchor that does not move
 * when a body grows. This check stops them coming back. CLAUDE.md §7.
 */
(function () {
  const self = read('run-all.js');
  /* Matches a slice whose two arguments are the SAME variable plus a fixed
     number — the fixed-window shape. Deliberately no literal example written
     out here: this check reads its own file, so an example in a comment would
     match itself and fail forever. */
  const windows = self.match(/([A-Za-z_$][\w$]*)\.slice\((\w+), *\2 *\+ *\d+\)/g) || [];
  check('structure', 'no fixed-length extraction windows in the test suite',
    windows.length === 0,
    'use sectionFrom(src, start) instead — these fail on correct code as soon as it grows: ' +
    windows.join(', '));
  check('structure', 'sectionFrom is CRLF-safe',
    /\\r\?\\n/.test(String(sectionFrom)),
    'these files are CRLF, so a literal \\n terminator never matches and the slice silently runs to EOF');
})();

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

/* Slice from an anchor to the END OF ITS TOP-LEVEL CONSTRUCT, instead of to a
 * fixed number of characters.
 *
 * ⚠ WHY THIS EXISTS. Checks used to slice "the next 1200 / 3000 / 12000
 * characters after this anchor" and search inside that. Every one of those is
 * a slow fuse: the moment the real code grows past the window, a correct,
 * present, working line falls outside it and the check reports FAILURE. That
 * happened three separate times in one afternoon — once at 15,304 characters
 * against a 15,000 window — and each one cost real time to diagnose, because a
 * test failing on code that is right teaches you to distrust the suite.
 * CLAUDE.md §7 warns about exactly this.
 *
 * In all three source files every top-level construct — a function, an
 * exports.x = onCall(...), an addEventListener handler, an onSnapshot — ends
 * with `}` or `});` at COLUMN ZERO. That is a real structural anchor and it
 * does not move when the body grows.
 *
 * ⚠ CRLF: these files are CRLF, so a literal '\n});' never matches (CLAUDE.md
 * §7 again). Matched with \r?\n.
 *
 * Falls back to the end of the file rather than to a magic number, so a missing
 * terminator makes a check fail loudly instead of silently reading nothing.
 */
function sectionFrom(src, start) {
  if (start == null || start < 0) return '';
  const after = src.indexOf('\n', start);
  if (after === -1) return src.slice(start);
  const re = /\r?\n\}\)*;?\r?\n/g;          // `}`, `});`, `})` at column 0
  re.lastIndex = after;
  const m = re.exec(src);
  return src.slice(start, m ? m.index + m[0].length : src.length);
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
/* whNormalizeLights reads the colour vocabulary through whColorsFromWords, so
   both have to come across or it throws the moment it is called. Lifted from
   the real file rather than restated here — a hand-written copy of the colour
   list would happily stay green while the app's own list moved on. */
const whColorsFromWordsSrc = extractFn(admin, 'whColorsFromWords');
const whLightColorsSrc = (admin.match(/const WH_LIGHT_COLORS\s*=\s*\[[^\]]*\];/) || [])[0];
/* Health Check's "light colours written as words" row reads this. Admin-only —
   employee.html has no copy and is not expected to. */
const whUnreadableSrc = extractFn(admin, 'whUnreadableLightParts');
const CN_DOUBLE_BIN_FEET = Number((money.match(/CN_DOUBLE_BIN_FEET\s*=\s*(\d+)/) || [])[1]);
eval([centsOfSrc, computeInvoiceStatusSrc, cnBinsForFeetSrc, custInvoiceKeySrc, statusClassSrc,
      whWireLabelSrc, whLightColorsSrc, whColorsFromWordsSrc, whNormalizeLightsSrc,
      whGroupKeySrc, whUnreadableSrc].filter(Boolean).join('\n'));

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

/*
 * A separate tool reads a related but NOT identical signal: the Schedule tab's
 * own 🆕 New Members panel (a CSV-imported route-planning tool, isolated in a
 * shadow DOM). It used to carry a disconnected idea of new — an h.isNew flag
 * that nothing ever set, on any house, ever (its own empty state said as much:
 * "...once the customer feed is wired in the next phase.", 2026-08-08 through
 * 2026-08-14). A first fix pointed it at chargeNewMemberFee, same as the two
 * checks above — but that box is wrong for THIS panel specifically: it stays
 * ticked on a record forever (Start New Season never clears it, only the
 * invoice-side newMemberFeeApplied does), so it flagged every past customer who
 * still happened to have it checked, not just this season's actual signups —
 * confirmed against real data on 2026-08-14 (owner: "the only person that
 * should show is [the one real signup]"). The office's own correction: a house
 * belongs here when its quote has gone Closed — the status Convert-to-Customer
 * itself sets — matched by phone, since quotes and jobAddresses share no id.
 */
const isNewMemberHouseSrc = extractFn(admin, 'isNewMemberHouse');
// The actual "who counts as new" logic lives in closedQuoteFor, which
// isNewMemberHouse just calls — check that one, not the thin wrapper.
const closedQuoteForSrc = extractFn(admin, 'closedQuoteFor');
check('logic', 'the Schedule tab has a live isNewMemberHouse lookup',
  typeof isNewMemberHouseSrc === 'string' && typeof closedQuoteForSrc === 'string');
check('logic', 'the Schedule tab\'s "new member" reads a Closed quote, not the new-member-fee checkbox',
  closedQuoteForSrc && /status === 'closed'/.test(closedQuoteForSrc) && !/chargeNewMemberFee/.test(isNewMemberHouseSrc + closedQuoteForSrc),
  'that fee checkbox never clears once ticked, so using it here re-flags every past customer who happens to still have it checked, not just this season\'s signups');
check('logic', 'the dead h.isNew flag is gone from the Schedule tab',
  !/\.isNew\b/.test(stripComments(admin)),
  'a bare .isNew read is back — that flag is never set by the CSV import, so it silently shows nobody as new again');

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
/* Bins go up in 260s now instead of stopping at two — a house needs another bin
   for every 260 feet. The boundary has NOT moved (260 is still one bin, 261 is
   still two), so nobody already on the books changes bin count or customer
   number; the only houses that come out differently are the ones over 520 feet,
   which used to be capped at 2 bins no matter how big they were. Those get the
   bins they actually need. */
check('logic', '520 feet is still two bins',
  cnBinsForFeet(520) === 2, 'the second bin covers up to 520 — two lots of 260');
check('logic', '521 feet needs three bins',
  cnBinsForFeet(521) === 3,
  'a house past 520 ft used to be capped at 2 bins, so the warehouse built short');
check('logic', '780 feet is three bins and 781 is four',
  cnBinsForFeet(780) === 3 && cnBinsForFeet(781) === 4);
check('logic', 'bins never exceed one per 260 feet',
  [1, 259, 260, 261, 400, 520, 521, 900, 1500].every(f => cnBinsForFeet(f) === Math.max(1, Math.ceil(f / 260))),
  'the bin count and the warehouse bundle count would disagree about the same house');
check('logic', 'a huge measurement does not produce a silly bin count',
  cnBinsForFeet(-50) === 1, 'negative feet is a typo, not a zero-bin house');

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

/* VERIFIED 2026-08-14, which is what this gap asked for ("verify what this does
   in practice before the season"). Traced through runInvoiceBatch: the nightly
   run groups by `billToPhone || invoiceKeyFor(data)`, so two records that both
   claim the same number as their OWN phone collapse into one payer group, and
   three things follow, none of them announced:
     - the combined total goes to ONE of them — `payer` is whichever record the
       collection scan reaches first — so one is billed for both houses;
     - the other is never billed at all, because the houses are on the first
       one's invoice;
     - the whole bill is HELD until every house in the group is complete
       (`skippedNotDone`), so one house that never gets installed silently stops
       the other from ever being billed this season.
   It cannot be auto-resolved: two people at one number might be a couple who
   want one bill, or two households that got typed the same by mistake, and only
   the office knows which. So it is surfaced in Health Check rather than guessed
   at — the gap closes on that being present. */
gap('two customers sharing a phone share one invoice key',
  /id:\s*'sharedPhone'/.test(admin),
  'custInvoiceKey({phone:X}) is identical for two different people with the same number, so they map to one invoice document. Health Check now flags these instead of merging them silently.');

/* The detection itself, EXECUTED rather than grepped — the lesson from the
   forTotal crash (suite 10) is that a regex cannot tell whether a predicate is
   actually right. The hard part is not finding shared numbers, it is not crying
   wolf over the two cases that are supposed to share one bill. */
{
  const sharedSrc = extractFn(admin, 'hcSharedPhoneGroups');
  check('logic', 'hcSharedPhoneGroups is defined in admin.html', !!sharedSrc,
    'Health Check cannot flag shared phone numbers without it');
  if (sharedSrc) {
    eval(sharedSrc);
    const run = list => hcSharedPhoneGroups(list).map(g => g.key);

    check('logic', 'two different people on one number are flagged',
      run([
        { data: { name: 'Liz Frome',  phone: '801-555-0100', address: '1 Oak' } },
        { data: { name: 'Staci Cosby', phone: '(801) 555-0100', address: '2 Elm' } },
      ]).length === 1,
      'two households sharing a number would be merged into one bill with nothing said');

    check('logic', 'one person with two houses on one number is NOT flagged',
      run([
        { data: { name: 'Liz Frome', phone: '8015550100', address: '1 Oak' } },
        { data: { name: 'liz  frome', phone: '8015550100', address: '2 Elm' } },
      ]).length === 0,
      'the same person billed once for both houses is correct — flagging it would train the office to ignore this row');

    check('logic', 'a house deliberately billed to someone else is NOT flagged',
      run([
        { data: { name: 'Liz Frome',   phone: '8015550100', address: '1 Oak' } },
        { data: { name: 'Adult Child', phone: '8015550100', billToPhone: '8015550100', address: '2 Elm' } },
      ]).length === 0,
      'billToPhone is the office saying "one bill" on purpose — that is the multi-house feature, not a collision');

    check('logic', 'a customer who said no is NOT flagged',
      run([
        { data: { name: 'Liz Frome',   phone: '8015550100', address: '1 Oak' } },
        { data: { name: 'Staci Cosby', phone: '8015550100', address: '2 Elm', rsvpStatus: 'no' } },
      ]).length === 0,
      'a cancelled house is not billed this season, so it cannot collide with anybody');

    check('logic', 'customers with no phone and no email are NOT flagged',
      run([
        { data: { name: 'A Person' } },
        { data: { name: 'B Person' } },
      ]).length === 0,
      'an empty invoice key is the noContact row\'s job — flagging it here would double-report every one of them');

    check('logic', 'two different people sharing an EMAIL are flagged too',
      run([
        { data: { name: 'Liz Frome',   email: 'House@Example.com' } },
        { data: { name: 'Staci Cosby', email: 'house@example.com  ' } },
      ]).length === 1,
      'custInvoiceKey falls back to email when there is no phone, so email collides in exactly the same way');
  }
}

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
  /* MOVED 2026-08-14: the seed lives in js/test-seed.js now, not inline in
     admin.html. It was ~217KB — 12.8% of the page — downloaded on every admin
     load and pushed down the wire again on every deploy, even though the test
     list changes far less often than the dashboard wrapped around it.
     Strip the `export ` so it still evaluates as a plain script, exactly the
     way it did when it was inline. */
  const seedSrc = read('js/test-seed.js');
  const seedStart = seedSrc.indexOf('const TEST_SEED = [');
  const seedEnd = seedSrc.indexOf('\n];', seedStart) + 3;
  const TEST_SEED = new Function(seedSrc.slice(seedStart, seedEnd) + '; return TEST_SEED;')();

  /* The move itself, guarded from both ends. Inlining it again silently undoes
     the saving; failing to import it silently stops the checklist syncing, and
     the caller swallows that error (see runProjectTestSync in admin.html). */
  check('logic', 'admin.html no longer inlines the checklist seed',
    !/const TEST_SEED = \[/.test(admin),
    'the 217KB seed is back inside admin.html — every admin page load pays for it again');
  check('logic', 'admin.html still loads the seed from js/test-seed.js',
    /import\(\s*['"]\.\/js\/test-seed\.js['"]\s*\)/.test(admin),
    'nothing in admin.html imports js/test-seed.js — the checklist would silently stop syncing');
  check('logic', 'js/test-seed.js exports TEST_SEED',
    /export const TEST_SEED = \[/.test(seedSrc),
    'the seed file does not export TEST_SEED — the dynamic import comes back undefined');
  check('logic', 'the checklist seed survived the move intact',
    TEST_SEED.length >= 160,
    'only ' + TEST_SEED.length + ' tests in the seed — the move truncated the list');
  /* Moving the list off the page created a failure it could not have had while
     it was inline: the fetch can now fail. The only caller is
     runProjectTestSync().catch(function(){}), so an unhandled throw reads as a
     clean sync with nothing to do, and the owner's checklist silently stops
     updating — the exact drift CLAUDE.md §0/§2 is written to prevent. */
  check('logic', 'a failed seed fetch is reported, not swallowed',
    /catch\s*\(\s*err\s*\)\s*\{[^}]*could not load js\/test-seed\.js/.test(admin),
    'the dynamic import has no catch — if js/test-seed.js 404s the checklist stops syncing and says nothing');
  for (const [term, why] of RETIRED_CHECKLIST_TERMS) {
    const hits = TEST_SEED.filter(row => (row[3] + ' ' + row[4]).toLowerCase().includes(term));
    check('logic', 'checklist wording: no test still says "' + term + '"',
      hits.length === 0,
      hits.length ? ('#' + hits.map(r => r[0]).join(', #') + ' — ' + why) : undefined);
  }
  /* The checklist syncs into Firestore keyed by this id, so two rows sharing
     one number means the second silently overwrites the first and a test the
     owner has already scored disappears. It happened once, when two sessions
     each added a test numbered 193 and both were kept in a merge. */
  {
    const ids = TEST_SEED.map(row => row[0]);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    check('logic', 'every checklist test has its own id',
      dupes.length === 0,
      dupes.length ? ('#' + dupes.join(', #') + ' used twice — one of each pair would be lost on the next sync') : undefined);
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

  /* --- the same build, however somebody typed it ------------------------
   * Added 2026-08-15. The colour boxes produce "Red, Green", but a
   * description can also arrive as free text — typed by staff, or carried off
   * a quote whose colours were written in words rather than ticked. Every one
   * of these was its own heading in the build queue, so Dad saw the same build
   * listed several times over and the bundle counts were split across them.
   *
   * These are all ONE group now. If one of these fails, the warehouse has
   * started double-listing a build again. */
  const redGreen = whGroupKey('Red, Green', 'White');
  [['lower case', 'red, green'],
   ['the word and', 'Red and Green'],
   ['an ampersand', 'Red & Green'],
   ['a slash', 'Red/Green'],
   ['no punctuation at all', 'red green'],
   ['shouting', 'RED GREEN'],
   ['and in lower case with odd spacing', '  red   and   green ']
  ].forEach(([label, typed]) => {
    check('logic', 'same build written with ' + label + ' is not a second group',
      whGroupKey(typed, 'White') === redGreen,
      '"' + typed + '" groups as "' + whGroupKey(typed, 'White') + '" instead of "' + redGreen + '"');
  });
  check('logic', 'a two-word colour is read as one colour, not two',
    whGroupKey('warm white, red', 'White') === whGroupKey('Red, Warm White', 'White'),
    'Warm White must not be split into a "Warm" and a "White"');

  /* The other half, and the more important one: it must NOT merge things that
     are genuinely different builds just because they share a colour word. */
  check('logic', 'text it cannot read is left alone, not guessed at',
    whGroupKey('Red with tinsel', 'White') !== whGroupKey('Red', 'White') &&
    whGroupKey('Red with tinsel', 'White').indexOf('Red with tinsel') === 0,
    'a half-understood description must never be folded into a plain colour group');
  check('logic', 'an alternating pattern is still its own build',
    whGroupKey('Red, Green, Red', 'White') !== redGreen,
    'red-green-red is a different strand from plain red and green');
  check('logic', 'a colour on its own does not swallow a longer description',
    whGroupKey('Green', 'White') !== whGroupKey('Green garland', 'White'));

  /* The copies must agree, or the office and the crew see different groups. */
  const empSrc = read('employee.html');
  const empNorm = extractFn(empSrc, 'whNormalizeLights');
  check('logic', 'employee.html sorts colours the same way admin does',
    !!empNorm && empNorm.replace(/\s+/g, ' ') ===
      (whNormalizeLightsSrc || '').replace(/\s+/g, ' '),
    'admin.html and employee.html have drifted — the crew would group houses differently');
  /* whNormalizeLights matching is not enough on its own any more: it now leans
     on a helper and a colour list, and employee.html could match line for line
     while calling a helper it does not have — which is a crash on the crew's
     screen, not a difference in grouping. */
  const empWords = extractFn(empSrc, 'whColorsFromWords');
  check('logic', 'employee.html has the colour reader admin relies on',
    !!empWords && empWords.replace(/\s+/g, ' ') ===
      (whColorsFromWordsSrc || '').replace(/\s+/g, ' '),
    'the crew portal would throw the moment it grouped a build');
  const empColors = (empSrc.match(/const WH_LIGHT_COLORS\s*=\s*\[[^\]]*\];/) || [])[0];
  check('logic', 'employee.html knows the same colours admin does',
    !!empColors && empColors.replace(/\s+/g, ' ') === (whLightColorsSrc || '').replace(/\s+/g, ' '),
    'a colour added to one list and not the other groups differently on the two screens');
}

/* --- no typed light descriptions, and the leftovers are findable -----------
 * Owner, 2026-08-15: "it should never have to guess because it should never be
 * in typed format." Two halves to that, and both are checked here: nothing in
 * the app may WRITE free text into a light description, and the records that
 * already contain some have to be findable so they can be corrected rather
 * than interpreted forever.
 */
/* Matched on the WIRING, not on the class name: the comment that records why
   this handler was removed names the class, and a bare /quoteLightsInput/
   test failed against its own explanation. */
check('flow', 'nothing writes a typed light description onto a quote',
  !/querySelectorAll\('\.quoteLightsInput'\)/.test(admin) &&
  !/lightsDescription:\s*input\.value/.test(admin),
  'the free-text lights box on the quote card is back — anything typed there ' +
  'lands in lightsDescription as words and the warehouse cannot group it');
check('flow', 'every light description comes from a picker',
  /readLightsPicker\(panel, 'hd-lights'\)/.test(admin) &&
  /addcust-color-check/.test(admin),
  'Edit Customer and Add Customer must both read their colours from the ' +
  'colour boxes, not from a text field');
check('flow', 'Health Check lists customers whose colours are still words',
  /id: 'lightsNotPicked'/.test(admin) && /whUnreadableLightParts/.test(admin),
  'old typed records would stay unreadable forever with nothing pointing at them');
check('flow', 'that Health Check row offers no Fix button',
  (() => {
    const i = admin.indexOf("id: 'lightsNotPicked'");
    if (i === -1) return false;
    /* sectionFrom, not a character window — the suite fails its own
       fixed-length-window check otherwise, and rightly so. */
    return /fix:\s*null/.test(sectionFrom(admin, i));
  })(),
  'a bulk rewrite of light colours would be the app guessing at what the ' +
  'words meant, which is the thing it must never do');

if (typeof whUnreadableLightParts === 'function') {
  check('logic', 'a properly picked colour list has nothing to correct',
    whUnreadableLightParts('Red, Green').length === 0 &&
    whUnreadableLightParts('Warm White').length === 0 &&
    whUnreadableLightParts('red and green').length === 0,
    'Health Check would nag about records that are perfectly readable');
  check('logic', 'a blank description is not reported as a problem',
    whUnreadableLightParts('').length === 0 && whUnreadableLightParts(null).length === 0,
    'a house with no colours yet is a different check — do not double-report it');
  check('logic', 'a trailing note is not mistaken for a bad colour',
    whUnreadableLightParts('Red, Green (every third bulb)').length === 0,
    'the note is a real instruction, not a typo — it must not be flagged');
  check('logic', 'words the app does not know are reported, and named',
    (() => {
      const bad = whUnreadableLightParts('Red with tinsel');
      return bad.length === 1 && bad[0] === 'Red with tinsel';
    })(),
    'the row has to say WHICH part it could not read, or nobody knows what to fix');
  check('logic', 'only the unreadable part is reported, not the whole list',
    (() => {
      const bad = whUnreadableLightParts('Red, sparkly thing, Green');
      return bad.length === 1 && bad[0] === 'sparkly thing';
    })(),
    'reporting the readable colours too would bury the one that needs fixing');
}

/* --- warehouse queue entries can be corrected after they are added -------
 * Added 2026-08-14. A build typed into the Warehouse tab by hand used to be
 * add-only: the one button on the row deleted it. Getting the wire colour
 * wrong (there was no box for it at all) meant deleting the entry and typing
 * it again from scratch.
 */
{
  const emp = read('employee.html');
  check('flow', 'the warehouse add form asks for a wire colour',
    admin.includes('id="whExtraWire"'),
    'without it a hand-added build can never say which wire it is on');
  /* Scoped to the warehouseExtras writes on purpose — a bare wireColor search
     passes on the Add Customer save handler, which is a different feature
     entirely and would have made this check green before the box existed. */
  check('flow', 'a hand-added build saves its wire colour',
    /addDoc\(collection\(db,'warehouseExtras'\)[\s\S]{0,300}wireColor:\s*wireColor/.test(admin),
    'the box would be on screen but the answer thrown away');
  check('flow', 'editing a build saves the wire colour too',
    /updateDoc\(doc\(db,'warehouseExtras'[\s\S]{0,400}wireColor:\s*wireColor/.test(admin),
    'the fix for a forgotten wire colour is exactly this write');
  check('flow', 'queue entries have an Edit button',
    admin.includes('data-wheditextra') && admin.includes('whStartEditExtra'),
    'this is the whole point — a mistake could only be fixed by deleting it');
  check('flow', 'editing updates that entry instead of adding a second one',
    /whEditingExtraId\)\s*\{[\s\S]{0,400}updateDoc\(doc\(db,'warehouseExtras'/.test(admin),
    'an edit that addDoc-ed would leave the wrong entry sitting in the queue AND build a duplicate');
  check('flow', 'the edit form can be left without saving',
    admin.includes('whCancelEditExtraBtn') && admin.includes('function whCancelEditExtra'),
    'opening Edit by mistake would trap the form in edit mode');
  /* ⚠ Both files decide this for themselves — see the grouping block above. */
  check('flow', 'a hand-added build with a wire joins that wire\'s group (admin)',
    /wireColor\s*\r?\n?\s*\?\s*whGroupKey\(item\.data\.pattern/.test(admin),
    'it would sit in a wire-not-set bucket even after the wire was filled in');
  check('flow', 'a hand-added build with a wire joins that wire\'s group (crew portal)',
    /wireColor\s*\r?\n?\s*\?\s*whGroupKey\(d\.data\.pattern/.test(emp),
    'the office and the crew would group the same build differently');
  check('flow', 'a build with no wire still gets its own bucket',
    admin.includes('buffer stock (wire not set)') && emp.includes('buffer stock (wire not set)'),
    'plain buffer stock must not be folded into a real house group');
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
  // renderQuoteRows also calls isRequote(d) — for the "Send updated quote"
  // button label and the re-quote wording. Mirrors the real one in admin.html.
  global.isRequote = d => !!(d && (d.existingCustomerId || Number(d.requoteCount) > 0));

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
    /* Ported from quote-card.test.js when that file was retired (see the note
       at the top of this suite). It was the ONE check in there with no
       equivalent here, and the line is still live in the card: measured feet
       times the per-foot rate, shown to the office before a price is set. */
    check('render', 'estimated price line shown when feet are known',
      c2.textContent.includes('Estimated Price'),
      'estimatedFeet x perFootRate is what the office prices from');
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

    // ---- Re-quote --------------------------------------------------------
    /* The customer writes back wanting another side of the house doing. The
       button clears the price and the answer and sends the same card back for
       a new price — one card, not two, and nothing gets billed at a number
       they never agreed to. */
    global.quoteStageFilter = 'send';
    renderQuoteRows([fixtures[1]]);
    const pricedCard = document.getElementById('quotesList').querySelector('.row-item');
    check('render', 're-quote — button offered on a quote that has a price',
      pricedCard.querySelector('[data-requote]') !== null,
      'without it there is no way to reopen a quote she has already sent');
    check('render', 're-quote — not offered on a quote nobody has priced yet',
      (function () {
        global.quoteStageFilter = 'new';
        renderQuoteRows([fixtures[0]]);
        return document.getElementById('quotesList')
          .querySelector('[data-requote]') === null;
      })(),
      'there is nothing to re-quote until there is a price to revise');

    /* What the card looks like straight after the button is pressed: price
       gone, answer gone, back in the Quotes tab needing a new number. */
    const reQ = { id: 'q6', data: Object.assign({}, fixtures[1].data, {
      quotedPrice: null, approvalStatus: 'pending', requoteCount: 1,
      requoteFrom: { price: 490, status: 'approved' },
      requoteReason: 'They asked for another side of the house quoted'
    }) };
    global.quoteStageFilter = 'new';
    renderQuoteRows([reQ]);
    const reCard = document.getElementById('quotesList').querySelector('.row-item');
    check('render', 're-quote — card says re-quote, not New house',
      reCard.textContent.includes('Re-quote') && !reCard.textContent.includes('New house'),
      'calling it a New house sends her looking for a first quote she already sent');
    check('render', 're-quote — the old price is still on screen',
      reCard.textContent.includes('$490.00'),
      'with the price cleared there is nothing to check the new number against');
    check('render', 're-quote — says they had approved it',
      reCard.textContent.includes('which they approved'));
    check('render', 're-quote — her reason is shown',
      reCard.textContent.includes('another side of the house'));
    check('render', 're-quote — price box starts on the old price',
      reCard.querySelector('.quotePriceInput').value === '490',
      'she is adding to a price she can see, not working one out from nothing');
    check('render', 're-quote — no approval buttons until it is priced again',
      reCard.querySelector('[data-markapproval]') === null);

    /* Priced and sent again, waiting on them. The wording has to say "again"
       or a second approval reads exactly like the first. */
    const reSent = { id: 'q7', data: Object.assign({}, reQ.data, { quotedPrice: 615 }) };
    global.quoteStageFilter = 'send';
    renderQuoteRows([reSent]);
    const reSentCard = document.getElementById('quotesList').querySelector('.row-item');
    check('render', 're-quote — send button reads Send updated quote',
      reSentCard.querySelector('[data-getquotelink]').textContent.includes('Send updated quote'));
    check('render', 're-quote — approve button says Again',
      /Mark Approved Again/.test(reSentCard.textContent),
      'without "again" there is no telling which price they said yes to');

    const reOk = { id: 'q8', data: Object.assign({}, reSent.data, { approvalStatus: 'approved' }) };
    renderQuoteRows([reOk]);
    const reOkCard = document.getElementById('quotesList').querySelector('.row-item');
    check('render', 're-quote — approved reads "Approved again" at the new price',
      reOkCard.textContent.includes('Approved again') && reOkCard.textContent.includes('$615.00'));
    global.quoteStageFilter = 'new';

    /* ---- Convert to Customer: the automatic-or-manual popup ----
       showConvertQuoteChoice sits inside the slice eval'd above, so it is a
       real function here and this renders the actual popup rather than
       matching its source text. What matters is that the popup tells the truth
       about what automatic would save BEFORE it runs — once it runs, the
       customer, the invoice, the number and the warehouse entry all exist. */
    if (typeof showConvertQuoteChoice === 'function') {
      const popup = () => document.querySelector('.needsfix-popup');
      const closePopup = () => {
        const o = document.querySelector('.needsfix-popup-overlay');
        if (o) o.remove();
      };

      const full = {
        name: 'Dana Whitmore', street: '412 Oak Ridge Dr', city: 'Provo', zip: '84604',
        phone: '(801) 555-0148', email: 'dana@example.com', quotedPrice: 615,
        /* quotePhotos, not photoUrl — this is the shape quotePhotoList actually
           reads, and a fixture that does not match production is exactly what
           §9.14 of CLAUDE.md says to check before believing a red test. */
        quotePhotos: [{ url: 'https://example.com/house.jpg' }],
        chargeSetupFee: true
      };
      closePopup();
      showConvertQuoteChoice('q-full', full);
      check('render', 'convert popup — offers both ways through',
        !!popup() && !!document.getElementById('convertQuoteAutoBtn') &&
        !!document.getElementById('convertQuoteManualBtn'),
        'the automatic option is unreachable');
      check('render', 'convert popup — names the quote it is about',
        popup().textContent.includes('Dana Whitmore'),
        'two quotes open at once and no telling which one this converts');
      check('render', 'convert popup — a complete quote raises no warning',
        !popup().textContent.includes('The quote has no'),
        'crying wolf on a quote that has everything trains the warning to be ignored');
      check('render', 'convert popup — says the $30 fee carries',
        popup().textContent.includes('$30 set-up fee'),
        'the fee is money the customer sees on their bill — say it before converting');

      const thin = { name: 'Sam Reyes', street: '', city: '', phone: '', email: '' };
      closePopup();
      showConvertQuoteChoice('q-thin', thin);
      const thinTxt = popup().textContent;
      check('render', 'convert popup — lists what a thin quote is missing',
        thinTxt.includes('The quote has no') && thinTxt.includes('Street Address') &&
        thinTxt.includes('City') && thinTxt.includes('Phone Number') &&
        thinTxt.includes('Email') && thinTxt.includes('House Picture') &&
        thinTxt.includes('Total Price'),
        'automatic would save a customer with none of this and nothing would have said so');
      /* A brand new quote with the box never touched still charges the fee —
         that is the default for anyone who is not an existing customer, and it
         is what the quote card itself shows ticked. */
      check('render', 'convert popup — a new quote with no fee box set still charges it',
        thinTxt.includes('$30 set-up fee'),
        'the quote card shows the fee ticked by default, so the popup must agree with it');

      /* A re-quote is an existing customer, so the set-up fee defaults OFF —
         they already paid it the year they joined. Charging it again is the
         kind of money bug that only shows up on somebody's bill. */
      closePopup();
      showConvertQuoteChoice('q-re', Object.assign({}, full, {
        existingCustomerId: 'cust1', chargeSetupFee: undefined
      }));
      check('render', 'convert popup — a re-quote does not promise a $30 fee',
        !popup().textContent.includes('$30 set-up fee'),
        'an existing customer would be charged the join fee a second time');

      /* Priced from footage rather than an approved price still counts as
         having a price — the form fills one in, so it must not be listed as
         missing. */
      closePopup();
      showConvertQuoteChoice('q-feet', Object.assign({}, full, {
        quotedPrice: undefined, estimatedFeet: 240
      }));
      check('render', 'convert popup — footage counts as a price',
        !popup().textContent.includes('Total Price'),
        'it would warn about a price the form is about to fill in anyway');

      check('render', 'convert popup — can be closed without converting',
        !!document.getElementById('convertQuoteCancelBtn'));
      document.getElementById('convertQuoteCancelBtn').dispatchEvent(
        new dom.window.Event('click', { bubbles: true })
      );
      check('render', 'convert popup — Cancel actually removes it',
        !document.querySelector('.needsfix-popup-overlay'),
        'a popup that will not close sits over the whole tab');
      closePopup();
    } else {
      check('render', 'convert popup is reachable from the quotes code', false,
        'showConvertQuoteChoice was not defined by the slice this suite evals — ' +
        'it may have moved outside it, in which case widen the slice');
    }
  }
}

// =====================================================================
// 6. DATA FLOW — does information collected actually reach where it's used
// =====================================================================
suite('6. Data flow between parts');

const employee = read('employee.html');

/* The code that carries a quote's details onto the Add a Customer form.
   It used to be written inline inside the [data-converttocust] click handler,
   and this was sliced out between that marker and the "Quote details filled
   in" toast at the end of it. Convert to Customer now asks automatic-or-manual
   first, so the fill is its own function that BOTH answers call — and the two
   old anchors ended up in the opposite order in the file, which made the slice
   come back empty and every check below it fail on code that was fine.
   Anchored on the function itself now, which is a real structural anchor and
   cannot get out of order (CLAUDE.md §7, and sectionFrom's own note above). */
const conversion = extractFn(admin, 'fillAddCustFromQuote') || '';
check('flow', 'found the quote to customer conversion block', conversion.length > 0,
  'fillAddCustFromQuote is gone or renamed — every "conversion carries…" check below reads nothing');

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
check('flow', 'conversion carries the $30 set-up fee decision',
  conversion.includes('addCustNewMemberFee') && /chargeSetupFee/.test(conversion),
  'the fee ticked on the quote must be the fee charged on the customer, or the ' +
  'bill disagrees with the quote email they are holding');
check('flow', 'conversion falls back to the quote wording when no colours are ticked',
  /rbDetectColorsAndPattern\([\s\S]{0,80}\)\.pattern\s*\|\|/.test(conversion),
  'a quote whose colours were typed as words rather than ticked would convert with ' +
  'no lightsDescription at all, and needsLightBuild is set from that — the customer ' +
  'would never appear in the Warehouse build queue');

/* --- Convert to Customer: automatic or manual --- */
const convChoice = extractFn(admin, 'showConvertQuoteChoice') || '';
check('flow', 'Convert to Customer asks automatic or manual',
  convChoice.length > 0 && /convertQuoteAutoBtn/.test(convChoice) && /convertQuoteManualBtn/.test(convChoice),
  'the popup that offers the two ways through is gone');
check('flow', 'the convert popup can be dismissed without converting',
  /convertQuoteCancelBtn/.test(convChoice),
  'a popup with no way out traps whoever opened it by mistake');
check('flow', 'the convert button opens the popup rather than filling the form itself',
  /\[data-converttocust\][\s\S]{0,900}showConvertQuoteChoice/.test(admin),
  'the button went back to filling the form directly, so the automatic option is unreachable');
check('flow', 'the convert button will not convert the same quote twice',
  /\[data-converttocust\][\s\S]{0,900}convertedToCustomerAt/.test(admin),
  'a stale card could start a second conversion — a duplicate customer, number, ' +
  'invoice and warehouse entry for one quote');

const autoConv = extractFn(admin, 'autoConvertQuoteToCustomer') || '';
check('flow', 'automatic convert reuses the Add Customer form instead of writing its own record',
  autoConv.includes('fillAddCustFromQuote') && autoConv.includes('routeAddressForm') &&
  /dispatchEvent/.test(autoConv),
  'a second way of creating a customer is a second set of money and numbering ' +
  'rules to keep in step — see CLAUDE.md §9.2');
check('flow', 'automatic convert clears its own flag',
  /finally\s*\{[\s\S]{0,400}addCustAutoConvert\s*=\s*false/.test(autoConv),
  'the flag would stay up and silence the missing-field warnings on the NEXT ' +
  'customer somebody adds by hand');

const addCustHandler = sectionFrom(admin, admin.indexOf("getElementById('routeAddressForm').addEventListener"));
check('flow', 'the automatic path is read once, before anything awaits',
  /const\s+isAutoConvert\s*=\s*addCustAutoConvert/.test(addCustHandler),
  'reading the global further down would see it already cleared and start ' +
  'prompting a person who is not sitting there');
check('flow', 'automatic convert skips the missing-fields prompt',
  /!isAutoConvert\s*&&\s*!confirm\(/.test(addCustHandler),
  'a blocking dialog on a panel nobody is looking at');
check('flow', 'automatic convert still reports what was missing',
  /isAutoConvert[\s\S]{0,600}missingFields\.join/.test(addCustHandler),
  'skipping the prompt must not mean hiding the gap — it moves to the toast');
check('flow', 'automatic convert says whether the customer reached the Warehouse',
  /isAutoConvert[\s\S]{0,600}Warehouse/.test(addCustHandler),
  'the whole point of converting is that the build gets queued — say when it did not');
check('flow', 'a failed automatic convert is not silent',
  /catch[\s\S]{0,900}isAutoConvert[\s\S]{0,200}toast\(/.test(addCustHandler),
  'the error lands on the Add Customer status line, which is on another tab');
check('flow', 'the duplicate-address warning still asks, even automatically',
  /findExistingAddressMatch[\s\S]{0,900}confirm\(/.test(addCustHandler) &&
  !/isAutoConvert[\s\S]{0,120}findExistingAddressMatch/.test(addCustHandler),
  'billing two records onto one invoice is a real decision — it must not be ' +
  'skipped just because the conversion was automatic');

/* Bins and the customer number series are one decision, and there are only two
   series for what is now an unbounded bin count. */
check('flow', 'a three-bin house still gets a 5000-series number',
  /numberOfBins\s*>=\s*2\s*\?\s*'double'/.test(admin),
  '`=== 2` here hands a 3-bin house a regular number, and the bin it is labelled ' +
  'for does not exist');
check('flow', 'the number preview agrees with the saved bin count',
  /const type = bins >= 2 \? 'double' : 'regular'/.test(admin),
  'the preview on the form would offer a different series than the save actually uses');
check('flow', 'the Number of Bins box follows the feet',
  /binsBox\s*&&\s*feet\)\s*binsBox\.value = cnBinsForFeet\(feet\)/.test(admin),
  'the box sat on 1 while the preview under it said 3 — same form, two answers');
check('flow', 'changing the feet keeps the real bin count, not just 1 or 2',
  /addrUpdates\.numberOfBins = binsForFeet/.test(admin),
  'a re-measured house would be saved as 2 bins when it needs 4');

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
const recycleQueue = recycleStart > -1 ? sectionFrom(admin, recycleStart) : '';
check('flow', 'recycle list shows everyone flagged, even with no lights recorded',
  recycleQueue.length > 0 && !/!d\.needsLightRecycle \|\| !d\.lightsDescription/.test(recycleQueue),
  'a flagged customer who never appears here never gets their number recycled');

/* --- rejoining after a recycle, and re-saving a declined customer ----------
 *
 * needsLightRecycle used to be re-derived from rsvpStatus === 'no' on every
 * write, which conflated a lasting fact ("they said no") with a job that gets
 * finished ("their lights need pulling back into stock"). Two bugs came out of
 * that: a customer who rejoined AFTER being recycled had no lights built and no
 * customer number yet looked completely normal, and any later Edit Customer save
 * put an already-recycled customer back in the recycle queue.
 *
 * These checks RUN the code rather than reading it. A regex would happily pass
 * on a branch that reads correctly and evaluates the wrong way round, and the
 * branch that matters most here is the one that must NOT change — a flat "no"
 * still has to recycle, every time.
 */
(function () {
  const fnSrc = read('functions/index.js');
  const start = fnSrc.indexOf('exports.portalRsvp = onCall(');
  const end = start > -1 ? fnSrc.indexOf('\n});', start) : -1;
  if (end === -1) {
    check('flow', 'portalRsvp found in functions/index.js', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const src = fnSrc.slice(start, end + 4);

  // portalRsvp's own 'no'/'back next year' path (added after this suite was
  // first written) calls removeCustomerFromUpcomingRoutes directly, which in
  // turn calls todayStrInDenver — both live outside the sliced portalRsvp
  // body above, so they have to be pulled in too or the sandboxed call throws
  // a bare ReferenceError the moment either RSVP answer runs for real.
  // extractFn matches from the "function" keyword, dropping any "async" that
  // preceded it — has to go back on, or an extracted async body's own await
  // is a syntax error the moment it actually runs.
  const removeFromRoutesSrc = extractFn(fnSrc, 'removeCustomerFromUpcomingRoutes');
  const todayStrSrc = extractFn(fnSrc, 'todayStrInDenver');
  check('flow', 'removeCustomerFromUpcomingRoutes and todayStrInDenver found in functions/index.js',
    !!removeFromRoutesSrc && !!todayStrSrc,
    'renamed or removed — update this test rather than deleting it, or portalRsvp\'s no/back-next-year path cannot run here');
  const fullSrc = [todayStrSrc, removeFromRoutesSrc && ('async ' + removeFromRoutesSrc), src]
    .filter(Boolean).join('\n');

  // Fake Firestore + callable wrapper. update() merges what would have been
  // written; add() records Inbox notes with the collection they landed in;
  // get() backs removeCustomerFromUpcomingRoutes's own route scan — empty on
  // purpose, since no test here needs a real route to already exist.
  function runRsvp(record, response, routes) {
    const written = {};
    const added = [];
    const routeWrites = [];
    const ctx = {
      exports: {},
      onCall: (opts, handler) => handler,
      HttpsError: function (code, msg) { const e = new Error(msg); e.code = code; return e; },
      admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } },
      findByToken: async () => ({ id: 'h1', data: record }),
      /* portalRsvp writes through the same update path as portalSave, which
         now keeps the normalised sign-in fields (phoneDigits / emailLower) in
         step. Stubbed to the real shape rather than to {} so the write this
         suite inspects looks like the real one. */
      contactIndexFields: (d) => {
        const out = {};
        if (d.phone !== undefined) out.phoneDigits = String(d.phone || '').replace(/\D/g, '');
        if (d.email !== undefined) out.emailLower = String(d.email || '').toLowerCase().trim();
        if (d.email2 !== undefined) out.email2Lower = String(d.email2 || '').toLowerCase().trim();
        return out;
      },
      /* portalRsvp does TWO things now, from two different sessions' work
         merged together: it raises the rejoined-after-recycle note, AND it
         sweeps a declining customer off any route a crew has already been
         handed. This suite is about the first; the second has its own suite.
         Stubbed rather than left out, because leaving it out made the whole
         async suite die on a ReferenceError, which reads as "everything here
         is broken" instead of "one helper is missing". */
      removeCustomerFromUpcomingRoutes: async (id) => { sweptFromRoutes.push(id); return 0; },
      db: {
        collection: (name) => ({
          doc: () => ({ update: async (u) => { Object.assign(written, u); } }),
          add: async (m) => { added.push(Object.assign({ __col: name }, m)); },
          get: async () => ({ docs: (routes || []).map(r => ({
            data: () => r,
            ref: { update: async (u) => { routeWrites.push({ id: r.id, stops: u.stops }); } }
          })) })
        })
      },
      console
    };
    const names = Object.keys(ctx);
    new Function(...names, fullSrc)(...names.map(n => ctx[n]));
    return ctx.exports.portalRsvp({ data: { token: 't', response } })
      .then(res => ({ res, written, added, routeWrites }));
  }

  const notes = a => a.filter(m => m.__col === 'messages' && m.topic === 'Rejoined After Recycling');

  pendingAsync.push((async () => {
    suite('6b. Rejoining after a recycle (portalRsvp actually runs)');

    // 1. Recycle completed (flag already cleared by the warehouse) → rebuild.
    const done = await runRsvp({ name: 'Rejoiner', phone: '8011112222', rsvpStatus: 'no', needsLightRecycle: false }, 'yes');
    check('flow', 'rejoining after a completed recycle queues the lights to be rebuilt',
      done.written.needsLightBuild === true,
      'their lights were physically pulled back into stock — nothing would build a new bundle, ' +
      'and the crew arrives on install day to no lights');
    check('flow', 'rejoining after a completed recycle raises an Inbox note',
      notes(done.added).length === 1,
      'their customer number went back to the pool at recycle time, so a house with no number ' +
      'would go on a route with nothing to tell the office');
    check('flow', 'the rejoin note does not assign a customer number itself',
      !('customerNumber' in done.written),
      'taking one from the pool programmatically could collide with a number written on a bin by hand');

    // 2. Recycle not done yet → nothing was pulled, so nothing to rebuild.
    const early = await runRsvp({ name: 'Quick Change', rsvpStatus: 'no', needsLightRecycle: true }, 'yes');
    check('flow', 'rejoining BEFORE the recycle happened does not queue a rebuild',
      early.written.needsLightBuild === undefined && early.written.needsLightRecycle === false,
      'their bundle was never taken apart — re-queuing it would have the warehouse build a second one');
    check('flow', 'rejoining before the recycle happened raises no Inbox note',
      notes(early.added).length === 0,
      'every ordinary change of mind would drop noise in the office Inbox');

    // 3. THE ONE THAT MATTERS MOST: a flat no must still recycle, every time.
    const declining = await runRsvp({ name: 'Decliner', rsvpStatus: '', needsLightRecycle: false }, 'no');
    check('flow', 'a flat "no" still flags the lights for recycling',
      declining.written.needsLightRecycle === true && declining.written.needsLightBuild === undefined,
      'declines would stop reaching the recycle queue and customer numbers would never come back');

    /* ⚠ portalRsvp carries TWO behaviours built by two different sessions and
       merged together: flagging the lights for recycling (above), and sweeping
       the customer off any route a crew already holds. A merge is exactly
       where one of a pair like that gets dropped in silence — it has already
       been lost once — so assert BOTH really happen on the same "no".
       Runs the REAL removeCustomerFromUpcomingRoutes against a real upcoming
       route, not a stub, so it proves the stop is actually taken off. */
    const upcoming = [{ id: 'r-future', date: '2999-01-01',
                        stops: [{ id: 'h1', name: 'Decliner' }, { id: 'other', name: 'Neighbour' }] }];
    const sweptNo = await runRsvp({ name: 'Decliner', rsvpStatus: '', needsLightRecycle: false }, 'no', upcoming);
    check('flow', 'a "no" both recycles the lights AND clears them off a built route',
      sweptNo.written.needsLightRecycle === true &&
      sweptNo.routeWrites.length === 1 &&
      !sweptNo.routeWrites[0].stops.some(st => st.id === 'h1'),
      'one half was lost — either their lights stay reserved, or a crew turns up to install ' +
      'lights they said no to');
    check('flow', 'the sweep leaves everyone else on that route alone',
      sweptNo.routeWrites[0] && sweptNo.routeWrites[0].stops.some(st => st.id === 'other'),
      'clearing one customer must not empty the whole day for the crew');
    check('flow', 'back next year also clears them off a built route',
      (await runRsvp({ name: 'Sitting Out 2', rsvpStatus: '', needsLightRecycle: false }, 'backnextyear',
        [{ id: 'r2', date: '2999-01-01', stops: [{ id: 'h1' }] }])).routeWrites.length === 1,
      'sitting the season out must not leave them on a route a crew is already holding');

    // 4. Back next year is a distinct third answer, never a soft no.
    const back = await runRsvp({ name: 'Sitting Out', rsvpStatus: 'no', needsLightRecycle: false }, 'backnextyear');
    check('flow', 'back next year never recycles and never rebuilds',
      back.written.needsLightRecycle === false && back.written.needsLightBuild === undefined &&
      notes(back.added).length === 0);

    // 5. An ordinary yes from someone who never declined is untouched.
    const plain = await runRsvp({ name: 'Normal', rsvpStatus: '', needsLightRecycle: false }, 'yes');
    check('flow', 'a first-time yes does not look like a rejoin',
      plain.written.needsLightBuild === undefined && notes(plain.added).length === 0);
  })());
})();

/* The same two decisions on the admin side, lifted out of the Edit Customer
   save and executed. The save function itself is DOM-bound and 300 lines long,
   so only the block that decides the two flags is run — which is exactly the
   part that was wrong. Both paths must agree: the portal and the office cannot
   behave differently for the same customer. */
(function () {
  const startMarker = 'const oldRsvpForRecycle';
  const endMarker = 'if(rejoinedAfterRecycle) addrUpdates.needsLightBuild = true;';
  const start = admin.indexOf(startMarker);
  const end = start > -1 ? admin.indexOf(endMarker, start) : -1;
  if (end === -1) {
    check('flow', 'the Edit Customer recycle decision block is findable',
      false, 'renamed or removed — update this test rather than deleting it');
    return;
  }
  const src = admin.slice(start, end + endMarker.length);

  function runSave(record, newRsvp) {
    const addrUpdates = {};
    new Function('item', 'newRsvp', 'addrUpdates', src)({ data: record }, newRsvp, addrUpdates);
    return addrUpdates;
  }

  // An edit that touches nothing to do with the RSVP must leave the flag alone.
  const resaved = runSave({ rsvpStatus: 'no', needsLightRecycle: false }, 'no');
  check('flow', 'saving an already-declined customer does not re-raise the recycle flag',
    !('needsLightRecycle' in resaved),
    'fixing a phone number months later put them back in the recycle queue with no number ' +
    'and no lights left to pull');

  // The normal path must not regress.
  const declined = runSave({ rsvpStatus: '', needsLightRecycle: false }, 'no');
  check('flow', 'changing an RSVP to "no" in admin still raises the recycle flag',
    declined.needsLightRecycle === true,
    'this is the behaviour that is correct — the fix must not stop declines from recycling');

  // Bug 1, admin side.
  const rejoined = runSave({ rsvpStatus: 'no', needsLightRecycle: false }, 'yes');
  check('flow', 'admin rejoin after a completed recycle queues the lights to be rebuilt',
    rejoined.needsLightBuild === true,
    'the portal handles this — the office path has to agree or the same customer gets two outcomes');

  // Changing their mind before the warehouse got to them clears the queued job.
  const cancelled = runSave({ rsvpStatus: 'no', needsLightRecycle: true }, 'yes');
  check('flow', 'admin rejoin before the recycle happened clears the queued recycle only',
    cancelled.needsLightRecycle === false && cancelled.needsLightBuild === undefined,
    'nothing was pulled, so there is nothing to rebuild and they must leave the recycle queue');

  check('flow', 'the Edit Customer save no longer re-derives the recycle flag every time',
    !/needsLightRecycle: newRsvp === 'no'/.test(admin),
    'that one expression is Bug 2 — it ran on every save, not just on the change');
  check('flow', 'admin raises the same rejoin note as the portal',
    /topic: 'Rejoined After Recycling'/.test(admin),
    'without it the office never learns the customer needs a number assigned');
})();

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
const ibSection = ibStart > -1 ? sectionFrom(admin, ibStart) : '';
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
  const switchSection = switchStart > -1 ? sectionFrom(admin, switchStart) : '';
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
    /* The nightly-billing health check reads this. Default to loaded:false so
       the checks stay SILENT here — a fixture-driven suite has no nightly run
       to report on, and a check that cried wolf in every unrelated test would
       be the first one everyone learned to ignore. Its own behaviour is
       covered separately, by setting this from the tests below. */
    var nightlyHealthCache = { loaded:false, enabled:false, alertPhone:'', newestRunAt:null, hasRuns:false };
    /* The "light colours written as words" check calls these. Lifted from the
       real admin.html rather than stubbed, for the same reason centsOf is:
       a stub would keep this suite green through a change to what the app
       actually counts as a readable colour. */
    ${whLightColorsSrc || ''}
    ${whColorsFromWordsSrc || ''}
    ${whUnreadableSrc || ''}
  `;
  let hc;
  try {
    hc = new Function(prelude + code + `
      return {set:function(o){jobAddresses=o.j||[];allInvoicesCache=o.i||[];quotesCache=o.q||[];availableCustomerNumbers=o.a||[];scheduledRoutesCache=o.r||{};},setNightly:function(n){nightlyHealthCache=n;},run:hcRunChecks};
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

  /* ---- the nightly billing run --------------------------------------------
     The most expensive silent failure in the app: billing stops firing and
     installed houses are simply never invoiced. There was a warning for it,
     but it lived inside the Automation tab and only appeared once that tab had
     been opened — so from everywhere else a three-week-dead run looked exactly
     like a healthy app. Driven here by setting the cache the check reads. */
  hc.setNightly({ loaded:true, enabled:true, alertPhone:'8015550100',
                  hasRuns:true, newestRunAt:new Date(Date.now() - 3 * 86400000) });
  check('health', 'billing that has not run for days is caught',
    get(hc.run(), 'nightlyBilling').rows.length === 1,
    'every house finished since it stopped is waiting to be invoiced, and nothing on screen says so');

  hc.setNightly({ loaded:true, enabled:true, alertPhone:'8015550100',
                  hasRuns:true, newestRunAt:new Date(Date.now() - 3600000) });
  check('health', 'billing that ran an hour ago is left alone',
    get(hc.run(), 'nightlyBilling').rows.length === 0,
    'a nightly job legitimately runs once a day — warning every morning is noise');

  hc.setNightly({ loaded:true, enabled:true, alertPhone:'',
                  hasRuns:true, newestRunAt:new Date(Date.now() - 3600000) });
  check('health', 'a missing alert phone is caught on its own',
    get(hc.run(), 'nightlyBilling').rows.length === 1,
    'that text is the only thing that reports the run happened — blank, a stopped run is invisible');

  hc.setNightly({ loaded:true, enabled:false, alertPhone:'', hasRuns:false, newestRunAt:null });
  check('health', 'billing that is switched OFF is not reported as broken',
    get(hc.run(), 'nightlyBilling').rows.length === 0,
    'deliberately off is not the same as broken');

  hc.setNightly({ loaded:false, enabled:false, alertPhone:'', hasRuns:false, newestRunAt:null });
  check('health', 'nothing is claimed when the run could not be read',
    get(hc.run(), 'nightlyBilling').rows.length === 0,
    'crying wolf on a failed read is how a panel gets ignored');

  /* --- light colours written as words, not picked ------------------------
     Run against the REAL check, not just its source text: the point is which
     customers come out of it. */
  hc.set({
    j: [{ id: 'picked',  data: { name: 'Picked',  phone: '8011110001', lightsDescription: 'Red, Green' } },
        { id: 'words',   data: { name: 'Words',   phone: '8011110002', address: '9 Elm', lightsDescription: 'Red with tinsel' } },
        { id: 'spelled', data: { name: 'Spelled', phone: '8011110003', lightsDescription: 'red and green' } },
        { id: 'noted',   data: { name: 'Noted',   phone: '8011110004', lightsDescription: 'Red, Green (every third bulb)' } },
        { id: 'blank',   data: { name: 'Blank',   phone: '8011110005', lightsDescription: '' } }]
  });
  const notPicked = get(hc.run(), 'lightsNotPicked').rows;
  check('health', 'a customer whose colours are words is listed for correcting',
    notPicked.length === 1 && /Words/.test(notPicked[0].label),
    'got ' + notPicked.length + ' rows: ' + notPicked.map(r => r.label).join(', '));
  check('health', 'properly picked colours are not listed',
    !notPicked.some(r => /Picked|Spelled|Noted|Blank/.test(r.label)),
    'this would nag about records that are perfectly readable, and the panel would be ignored');
  check('health', 'the row says which words it could not read',
    notPicked.length === 1 && notPicked[0].detail.indexOf('Red with tinsel') !== -1,
    'without naming the text there is nothing for anyone to go and fix');

  const all = hc.run();
  /* 19 since 2026-08-15 — "light colours written as words" was added. The count
     is deliberately hard-coded: a check silently disappearing is exactly the
     kind of thing nobody notices, so adding or removing one has to be a
     conscious edit here too. */
  check('health', 'all 19 checks present',
    all.length === 19, 'got ' + all.length);
  check('health', 'fix buttons limited to the unambiguous checks',
    all.filter(c => c.fix).length === 6,
    'auto-fixing a judgement call writes bad data at scale');
  /* The new one must stay in the no-button group: rewriting somebody's light
     colours in bulk would be the app guessing at what the words meant. */
  check('health', 'the words-not-colours check never offers to fix itself',
    !get(all, 'lightsNotPicked').fix,
    'a Fix button here would guess at what the words meant and change what the crew builds');
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
  // pullCustomerFromSeason used to inline the past-route filter itself; it now
  // delegates to the shared removeCustomerFromUpcomingRoutes helper (also used
  // by portalRsvp's own no/back-next-year path), so that is where to look.
  check('quoteresp', 'past routes are left alone as history',
    /\(rd\.date \|\| ''\) < todayStr/.test(extractFn(fns, 'removeCustomerFromUpcomingRoutes') || ''),
    'rewriting a finished route changes what the crew actually did');
  check('quoteresp', 'pulling from the season sweeps upcoming routes',
    /removeCustomerFromUpcomingRoutes\(customerId\)/.test(fns.slice(fns.indexOf('async function pullCustomerFromSeason'))),
    'they would still show up on a route the crew has already been handed — the actual sweep logic ' +
    '(and that past routes are left alone) is proved by executing removeCustomerFromUpcomingRoutes ' +
    'directly, see suite 11');

  // Kept from the other resolution of this same conflict: their check proves the
  // guard still exists inside the helper, but not that anything still CALLS the
  // helper. Deleting the delegation would leave that check green with the sweep
  // never running.
  check('quoteresp', 'sitting out the season still delegates the route sweep',
    /return await removeCustomerFromUpcomingRoutes\(customerId\)/.test(
      extractFn(fns, 'pullCustomerFromSeason') || ''),
    'the season pull must still clear their upcoming routes, wherever that logic lives');

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
suite('10a. Start New Season keeps the books');
/*
 * ⚠ WHAT THIS PROTECTS.
 * Start New Season zeroes every invoice — deposit, credits, credit notes,
 * change fees, fee notes — and banks last year's payments as ONE number in
 * settings/financeArchive. Before the snapshot existed, "who paid, how much,
 * and when" was gone permanently for all ~967 customers the moment it ran: no
 * undo, no export, nothing to answer a customer who says "I paid you in
 * November" the following spring. It is one button in the Danger Zone.
 */
(function () {
  const start = admin.indexOf("ssnRunBtn')?.addEventListener('click'");
  if (start === -1) {
    check('season-reset', 'the Start New Season handler was found', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const src = sectionFrom(admin, start);

  /* The property that matters is an ORDER: the snapshot has to be written and
     verified BEFORE the first destructive write. A snapshot taken afterwards
     captures the zeroes, not the record. */
  const snapAt = src.indexOf("'yearlySnapshots'");
  const archiveAt = src.indexOf("'financeArchive'");
  const resetAt = src.indexOf('deposit: 0');
  check('season-reset', 'the books are snapshotted before anything is banked or zeroed',
    snapAt > -1 && archiveAt > -1 && resetAt > -1 && snapAt < archiveAt && snapAt < resetAt,
    'a snapshot written after the reset would capture the zeroes, not the record');
  check('season-reset', 'the snapshot is read back before the reset proceeds',
    /getDoc\(doc\(db,'yearlySnapshots'/.test(src) && /savedRows\.length !== snapRows\.length/.test(src),
    '"the write resolved" is not the same as "the data is there" — a silent failure would leave no books and no warning');
  check('season-reset', 'a snapshot too big to store stops the whole reset',
    /ssnSnapshotTooBig/.test(src) && /NOTHING has been changed/.test(src),
    'a truncated snapshot is worse than none: it would look like a complete record');

  /* Two guards that are ABOUT last season and must not survive it. */
  check('season-reset', 'last season receipt guard is cleared',
    /receiptSentForDeposit: null/.test(src),
    'a customer paying the same amount as last year would get no receipt at all');
  check('season-reset', 'last season payment-import history is cleared',
    /importedPayments: \[\]/.test(src),
    "next season's first import would silently skip rows it thinks it has already seen");

  const rowsFn = extractFn(admin, 'ssnBuildSnapshotRows') || '';
  check('season-reset', 'the snapshot captures how much was paid, and when and how',
    /deposit:/.test(rowsFn) && /lastPaymentAt:/.test(rowsFn) &&
    /lastPaymentMethod:/.test(rowsFn) && /paypalPayments:/.test(rowsFn),
    'this is the half that cannot be reconstructed from anything else');
  check('season-reset', 'the snapshot captures the credits and fees behind the balance',
    /creditNotes:/.test(rowsFn) && /changeFeeNotes:/.test(rowsFn),
    'a bare number cannot answer why a balance was what it was');

  check('season-reset', 'a saved payment record can be downloaded as a spreadsheet',
    /data-snapcsv/.test(admin) && /payment-records-/.test(admin),
    'kept where nobody can look at it, the snapshot answers nothing');
  check('season-reset', 'the snapshot list shows how many payment records it holds',
    /Payment records/.test(admin),
    'it is the only sign the books survived — and that the delete button beside it is the last copy');
  check('season-reset', 'a payment date survives whatever shape it comes back in',
    /function snapDateText/.test(admin) && /v\.seconds \? new Date\(v\.seconds \* 1000\)/.test(admin),
    'a Timestamp read back from a stored array arrives as {seconds}, and "when did they pay?" would come out blank');
})();

suite('10b. The payment ledger');
/*
 * ⚠ WHAT THIS IS FOR.
 * The entire record of a payment used to be three fields on the invoice:
 * deposit (a running total), tipTotal, and lastPaymentAt. That answers "how
 * much altogether" and nothing else — not when, not how, not who took it, and
 * a correction was indistinguishable from a payment. FOUR separate places move
 * that number and three left no trace beyond the new total.
 *
 * The ledger is APPEND-ONLY and never read back into a balance: `deposit` on
 * the invoice stays the single source of truth. That is the property worth
 * protecting — a wrong row here can embarrass, but can never mis-bill anyone.
 */
(function () {
  const fns = read('functions/index.js');

  const logCalls = (admin.match(/await logPayment\(\{/g) || []).length;
  check('ledger', 'every admin path that records money writes to the ledger',
    logCalls >= 4,
    'found ' + logCalls + ' — the status dropdown, both invoice-panel branches and the CSV import each move the paid figure');
  check('ledger', 'a card payment writes to the ledger too',
    /collection\('payments'\)\.add\(/.test(fns),
    'PayPal is the one path the office never touches by hand, so it is the easiest to forget');

  /* Both the browser AND the webhook call recordPaypalPayment for the SAME
     payment. `recorded` is only true for the call that actually applied it —
     logging outside that guard doubles every card payment in the ledger. */
  const rpp = sectionFrom(fns, fns.indexOf('async function recordPaypalPayment'));
  check('ledger', 'a card payment is logged once, not once per code path',
    /if \(recorded\) \{[\s\S]{0,900}collection\('payments'\)\.add\(/.test(rpp.replace(/\r/g, '')),
    'the browser and the webhook both reach this function for one payment');

  /* The invoice panel holds a RUNNING TOTAL, so the payment is the DIFFERENCE.
     Logging the typed figure would record a fresh payment every time anyone
     re-saved an unchanged invoice. */
  check('ledger', 'the panel logs the difference, not the figure in the box',
    (admin.match(/amount: newDeposit - \(Number\(d\.deposit\) \|\| 0\)/g) || []).length >= 2,
    're-saving an unchanged invoice would otherwise log a brand-new payment every time');
  check('ledger', 'a zero movement writes nothing at all',
    /if\(!amount\) return null;/.test(admin),
    'opening and saving an invoice is not a payment');
  check('ledger', 'a correction is recorded, not hidden',
    /'correction'/.test(admin),
    'a balance going DOWN is exactly the change a customer rings up to ask about');

  const ledgerFn = extractFn(admin, 'logPayment') || '';
  check('ledger', 'a failed ledger write cannot take down the payment',
    /catch\(err\)/.test(ledgerFn.replace(/\s/g, '').replace(/catch\(err\)/, 'catch(err)')) || /catch\s*\(\s*err\s*\)/.test(ledgerFn),
    'the money has already moved by the time this runs — losing the audit row is bad, losing the payment is worse');
  check('ledger', 'nothing reads the ledger back into a balance',
    !/collection\(db,'payments'\)[\s\S]{0,400}(balanceDueAmount|computeInvoiceStatus)/.test(admin),
    'the invoice deposit stays the single source of truth — a bad row here must never change what someone owes');

  check('ledger', 'the invoice panel shows the payment history',
    /function renderPaymentHistory/.test(admin) && /Payment history/.test(admin),
    'a write-only ledger cannot answer "I paid you in November"');
  check('ledger', 'the history names the method and who entered it',
    /PAYMENT_METHOD_LABEL/.test(admin) && /enteredBy/.test(admin),
    'the amount alone was already on the invoice — method and who are the new answers');
  check('ledger', 'an empty history is not read as "never paid"',
    /still counted in the total above/.test(admin),
    'payments made before the ledger existed are real money and are still in the deposit');
  check('ledger', 'the payments collection has a rules entry',
    /match \/payments\/\{id\}/.test(read('firestore.rules')),
    'a collection missing from the rules is denied by default and the panel would silently render empty');
})();

suite('10c. Tips, the payment importer, and the ledger backfill');
(function () {
  // ---- §5.4 tips are revenue --------------------------------------------
  /* tipTotal is real money charged to a real card — the PayPal capture
     increments it alongside deposit — and it appeared exactly ONCE in the
     whole file, as a line of text on an invoice card. No revenue figure
     counted it, so the Dashboard understated income, the bank never
     reconciled, and tips were missing from anything a tax preparer saw. */
  check('tips', 'tips are counted in total revenue',
    /const tipsCollected = allInvoicesCache\.reduce/.test(admin) &&
    /\+ financeArchiveRevenue \+ tipsCollected/.test(admin),
    'tips were charged to a card and then counted nowhere');
  check('tips', 'tips are counted in this month’s income',
    /\(Number\(i\.data\.deposit\)\|\|0\) \+ \(Number\(i\.data\.tipTotal\)\|\|0\)/.test(admin.replace(/\s/g, ' ').replace(/\s+/g, '')) ||
    /Number\(i\.data\.tipTotal\)\|\|0/.test(admin.replace(/\s/g, '')),
    'money that came in this month is money that came in this month');
  check('tips', 'the invoice export has its own Tips column',
    /Tips:\s*d\.tipTotal\s*\|\|\s*0/.test(admin),
    'anything handed to a tax preparer understated income without it');
  check('tips', 'tips are kept separate, not folded into the amount paid',
    !/deposit:\s*\(?Number\(d\.deposit\)[^\n]*tipTotal/.test(admin),
    'tips are taxed and reported differently from service income — the two must stay separable');

  // ---- §5.6 the payment importer ----------------------------------------
  const importSec = sectionFrom(admin, admin.indexOf("paymentImportLoadBtn').addEventListener"));
  check('importer', 'a CSV is parsed properly, not split on commas',
    /XLSX\.read\(text, \{type: 'string'\}\)/.test(importSec),
    '"1,234.56" is ONE quoted field — splitting on commas imported a $1,234.56 payment as $1');
  check('importer', 'an amount survives currency punctuation',
    /replace\(\/\[\^0-9\.\\-\]\/g, ''\)/.test(admin),
    '"$1,234.56" must read as 1234.56, not as 1');
  check('importer', 'the duplicate guard is per ROW, not per file',
    /const rowTag = function\(idx, phoneDigits, amount\)/.test(admin) && /thisRowTag/.test(admin),
    'one tag per file meant a customer with two payments in one file silently lost the second');
  check('importer', 're-importing the same file is still skipped',
    /seen\.indexOf\(thisRowTag\) !== -1/.test(admin),
    'the row tag has to be stable for the same file, or a re-import double-counts');

  // ---- the ledger backfill ----------------------------------------------
  check('backfill', 'the opening-balance tool reports before it writes',
    /ledgerBackfillCheckBtn/.test(admin) && /Nothing has been written\./.test(admin),
    'a bulk write across ~967 records gets a dry run first, like the Customer Numbers tool');
  check('backfill', 'running it twice is harmless',
    /function ledgerBackfillAlreadyDone/.test(admin) && /filter\(function\(r\)\{ return !done\[r\.invoiceKey\]; \}\)/.test(admin.replace(/\s+/g, ' ').replace(/\{ /g, '{').replace(/ \}/g, '}')) ||
    /!done\[r\.invoiceKey\]/.test(admin),
    'a second run would otherwise double every opening balance');
  check('backfill', 'it refuses to write when it cannot tell what is already there',
    /if\(done === null\)/.test(admin),
    'writing blind is how you get two opening balances for one customer');
  check('backfill', 'an opening balance is labelled as a summary, not a payment',
    /Opening balance — the total paid before the payment log was added/.test(admin) &&
    /LEDGER_BACKFILL_REF/.test(admin),
    'someone who paid in three instalments becomes ONE line — it must never read as a real payment record');
  check('backfill', 'the backfill touches no invoice amounts',
    !/ledgerBackfillRunBtn[\s\S]{0,2500}updateDoc\(doc\(db,'invoices'/.test(admin),
    'it adds history only — it must never be able to change what somebody owes');
  check('backfill', 'the dead "go ask a chatbot" card is gone',
    !/share the file directly in a chat with Claude/.test(admin),
    'a card that only told you to go elsewhere was not a tool');
})();

suite('10d. Activity log, and losing somebody else’s edit');
(function () {
  // ---- §5.3 the activity log --------------------------------------------
  /* Nothing recorded who changed what. Four people share this dashboard and
     the app has always known who is signed in, so when a price is wrong or two
     people disagree about what happened there was nothing to consult. */
  check('activity', 'there is an activity log',
    /async function logActivity/.test(admin) && /collection\(db,'activity'\)/.test(admin),
    'who changed what was recorded nowhere at all');
  check('activity', 'it records who, as well as what',
    /who: paymentLedgerUser\(\)/.test(admin),
    'the point of the log is the name beside the change');
  const actFn = extractFn(admin, 'logActivity') || '';
  check('activity', 'a failed log write cannot break the change it describes',
    /catch/.test(actFn) && /return null/.test(actFn),
    'a note about a change must never be able to undo the change');
  check('activity', 'it is written from the handlers that actually change things',
    (admin.match(/logActivity\(/g) || []).length >= 6,
    'a log wired to one handler tells you almost nothing');
  check('activity', 'nothing decides anything from the log',
    !/collection\(db,'activity'\)[\s\S]{0,600}(computeInvoiceStatus|balanceDueAmount|updateDoc)/.test(admin),
    'it is a record for people to read — that is what makes it safe to write from a dozen places');
  check('activity', 'today’s changes are shown at the top of Health Check',
    /function renderActivityToday/.test(admin) && /What changed today/.test(admin),
    'a log nobody can read answers nothing');
  check('activity', 'the activity collection has a rules entry',
    /match \/activity\/\{id\}/.test(read('firestore.rules')),
    'a collection missing from the rules is denied by default and the panel renders empty');

  // ---- §6 two people editing one customer --------------------------------
  /* The Edit Customer modal writes ~30 fields from the snapshot taken when it
     opened — including Measured Feet, which drives bins, the number series and
     the price. A save made over somebody else's change does not merge with it,
     it erases it, and nothing said so. The customer can be editing their own
     details through the portal at the same moment. */
  const saveSrc = sectionFrom(admin, admin.indexOf("editCustSaveBtn').addEventListener('click'"));
  check('conflict', 'the customer save checks whether anyone else changed the record',
    /editCustOpenedWithUpdatedAt/.test(saveSrc) && /freshMs > openedMs/.test(saveSrc),
    'a save silently replaced the other person’s work with a stale snapshot');
  check('conflict', 'it re-reads from the server, not from the cache',
    /getDoc\(doc\(db,'jobAddresses', editCustomerId\)\)/.test(saveSrc),
    'the listener may not have delivered the other change yet — the cache is the thing that might not know');
  check('conflict', 'overwriting is possible but has to be chosen',
    /Save anyway and overwrite\?/.test(saveSrc),
    'sometimes overwriting IS right — it just should not be the silent default');
  check('conflict', 'the customer record now records when it was changed, and by whom',
    /addrUpdates\.updatedAt = serverTimestamp\(\)/.test(admin) && /addrUpdates\.lastEditedBy/.test(admin),
    'without these the conflict check has nothing to compare and never fires');
})();

suite('10e. Import safety, and the abandoned quote link');
(function () {
  // ---- §5.5 the customer bulk importer gets a dry run --------------------
  /* This tool matches each pasted row against an existing customer and UPDATES
     it — name, phone, address, price, measured feet. A column pasted one row
     out of line therefore rewrites hundreds of live records, prices included,
     with no confirm and no undo. */
  check('import-safety', 'the customer bulk importer has a Check First',
    /id="rbCheckBtn"/.test(admin) && /rbCheckReport/.test(admin),
    'the Customer Numbers tool has had one for ages; this is the tool that can do the most damage');
  const checkSrc = sectionFrom(admin, admin.indexOf("rbCheckBtn')?.addEventListener"));
  check('import-safety', 'the dry run writes nothing',
    !/updateDoc|addDoc|setDoc|deleteDoc/.test(checkSrc),
    'a preview that writes is not a preview');
  check('import-safety', 'it resolves matches the same way the real import does',
    /findExistingAddressMatch\(street, phone/.test(checkSrc) && /alignBulkRows/.test(checkSrc),
    'a preview that matches differently from the real run is worse than none — it would lie');
  check('import-safety', 'it reads the same price box the importer reads',
    /rbAmountsArea/.test(checkSrc),
    'previewing a different column than the one that gets written is exactly the mistake this is meant to catch');
  check('import-safety', 'it calls out price changes on existing customers',
    /would have their price CHANGED/.test(checkSrc),
    'a one-row misalignment shows up as a wall of price changes — that is the signal worth shouting');

  // ---- §6 an abandoned Convert to Customer -------------------------------
  /* addCustFromQuoteId was set by the Convert button and cleared ONLY on a
     successful add. Back out, and the next customer typed in by hand silently
     inherited that quote's RSVP and quietly marked the quote closed. */
  check('convert-link', 'the form says when it is converting a quote',
    /addCustQuoteBanner/.test(admin) && /function renderAddCustQuoteBanner/.test(admin),
    'the dangerous state was an INVISIBLE link to a quote nobody meant to convert');
  check('convert-link', 'the link to a quote can be cleared without losing what is typed',
    /function clearAddCustQuoteLink/.test(admin) && /addCustQuoteBannerClear/.test(admin),
    'there was no way out of the state at all');
  check('convert-link', 'the banner is hidden again once the form resets',
    (admin.match(/renderAddCustQuoteBanner\(''\)/g) || []).length >= 2,
    'a banner left up after a save would be its own kind of lie');

  // ---- §6 the Schedule tab is a snapshot, and should say so --------------
  check('schedule-age', 'the schedule plan remembers when it was imported',
    /importedAt:IMPORTED_AT/.test(admin) && /IMPORTED_AT=isoOf\(new Date\(\)\)/.test(admin),
    'nothing recorded how old the underlying CSV was');
  check('schedule-age', 'the tab says how old the snapshot is',
    /function renderImportedAt/.test(admin) && /Snapshot imported /.test(admin),
    'a plan built from a months-old export looked exactly like one built this morning');
  check('schedule-age', 'a stale snapshot is flagged, not just dated',
    /days > 14 \? 'var\(--ember\)'/.test(admin),
    'this plan does not follow customer changes, so age is the whole risk');
})();

suite('10f. Portal sign-in reads, and multi-property customers');
(function () {
  const fns = read('functions/index.js');
  const idx = read('index.html');

  // ---- §5.8 stop downloading every customer on every sign-in ------------
  /* findByEmail read the ENTIRE jobAddresses collection unconditionally, and
     findByPhone did whenever the stored phone had a bracket or a dash in it.
     ~967 document reads to answer "is this one person a customer?", on every
     visit — most of what the portal's "this can take a few seconds" spinner
     was apologising for. */
  check('signin-reads', 'a sign-in looks the customer up by an indexed field',
    /async function findByIndexedField/.test(fns) &&
    /findByIndexedField\('phoneDigits'/.test(fns) && /findByIndexedField\('emailLower'/.test(fns),
    'a phone stored as "(801) 555-0142" cannot be matched by an equality query — hence the normalised copy');
  check('signin-reads', 'the second email is indexed too',
    /findByIndexedField\('email2Lower'/.test(fns),
    'a spouse signing in with their own address would otherwise still trigger the full scan');
  check('signin-reads', 'the full scan survives as a LAST resort',
    /full-collection scan for phone/.test(fns) && /full-collection scan for email/.test(fns),
    'a record written before these fields existed must still be findable — locking a customer out would be far worse than a slow read');
  check('signin-reads', 'the slow path says so, rather than staying a mystery',
    /console\.warn\('\[HU\] full-collection scan/.test(fns),
    'a persistently slow sign-in should point at the backfill');
  check('signin-reads', 'the normalised fields are kept in step on a portal save',
    (fns.match(/Object\.assign\(updates, contactIndexFields\(updates\)\)/g) || []).length >= 2,
    'a customer editing their own phone would otherwise drop back to the full scan');
  check('signin-reads', 'admin keeps them in step too',
    /Object\.assign\(addrUpdates, contactIndexFields\(addrUpdates\)\)/.test(admin) &&
    /function contactIndexFields/.test(admin),
    'the office edits the same records');
  check('signin-reads', 'there is a backfill for customers added before this',
    /contactIdxCheckBtn/.test(admin) && /contactIdxRunBtn/.test(admin),
    'without it the ~967 existing customers all still take the slow path');
  check('signin-reads', 'the backfill reports before it writes',
    /Nothing has been written\. ' \+ todo\.length/.test(admin),
    'a bulk write across every customer gets a dry run, like every other bulk tool here');
  check('signin-reads', 'the backfill compares against what the value SHOULD be',
    /function contactIdxPlan/.test(admin) && /!== want\.phoneDigits/.test(admin),
    'checking only whether the field EXISTS would miss a record whose phone changed by some path that forgot to update it');

  // ---- §5.9 a customer with more than one property ----------------------
  /* Multi-property billing has always worked on the back end: houses grouped
     by billToPhone, billed as ONE invoice with a line per address. The portal
     showed the FIRST address and a combined balance, so the number simply
     looked too big for the house on screen. */
  check('multi-house', 'portalLookup returns every house on the bill',
    /const sibSnap = await db\.collection\('jobAddresses'\)\.where\('billToPhone', '==', billKey\)/.test(fns),
    'the portal stopped at the first match and the rest were invisible');
  check('multi-house', 'a single-house customer is sent nothing extra',
    /houses: houses\.length > 1 \? houses : \[\]/.test(fns),
    'the ordinary customer should see no change at all');
  check('multi-house', 'a failed sibling lookup cannot block sign-in',
    /multi-house lookup failed/.test(fns) && /houses = \[\];/.test(fns),
    'nothing about a second property should stand between somebody and their account');
  check('multi-house', 'the portal names the properties the bill covers',
    /function renderPortalHouses/.test(idx) && /This bill covers /.test(idx),
    'a balance covering three houses shown against one address is just a wrong-looking number');
  check('multi-house', 'it says the balance is the total for all of them',
    /the total for all of them together/.test(idx),
    'that sentence is the entire point of the panel');
  check('multi-house', 'no crew or stop order reaches the customer',
    !/assignedCrew/.test(fns.slice(fns.indexOf('const sibSnap'), fns.indexOf('const sibSnap') + 900)),
    'the same rule as the schedule strip — the date is theirs, the routing is not');
})();

suite('10g. All Customers on a phone');
(function () {
  /* An 8-column table that scrolled sideways, with the Edit button in the LAST
     column — so on a phone you swiped past seven columns to reach the one
     control on the row, for all ~967 rows. */
  const mobile = admin.slice(admin.indexOf('@media (max-width:760px)'),
    admin.indexOf('@media (max-width:760px)') + 2600);
  check('mobile', 'All Customers stacks into cards on a phone',
    /#allCustTable thead\{ display:none; \}/.test(mobile) && /#allCustTable tr\{/.test(mobile),
    'an 8-column table on a phone is a sideways scroll, once per row');
  check('mobile', 'the Edit button is reachable without scrolling sideways',
    /#allCustTable td:last-child \.icon-btn\{[\s\S]{0,160}width:100%/.test(mobile.replace(/\r/g, '')),
    'it was the last column of eight — the one thing you needed, furthest from your thumb');
  check('mobile', 'cells that lose their column header get a label',
    /td:nth-child\(2\)::before\{ content:'Enrolled: '/.test(mobile),
    'a bare date in a stacked card means nothing without the header that explained it');
})();

suite('10h. Public write rules');
(function () {
  const rules = read('firestore.rules');
  const idx = read('index.html');

  /* `allow create: if true` let a stranger write ANY fields onto a quote —
     including quotedPrice and approvalStatus — so a quote could arrive in the
     office queue already claiming a price, or already claiming to be approved. */
  check('public-rules', 'a public quote cannot assert its own price',
    /!\('quotedPrice' in request\.resource\.data\)/.test(rules),
    'anyone could have posted a quote that already carried a price');
  check('public-rules', 'a public quote cannot assert its own approval',
    /!\('approvalStatus' in request\.resource\.data\)/.test(rules) &&
    /!\('convertedToCustomerAt' in request\.resource\.data\)/.test(rules),
    'a quote claiming to be approved would look real in the queue');
  check('public-rules', 'a public quote must start as new',
    /request\.resource\.data\.status == 'new'/.test(rules),
    'the status field is what the whole quote pipeline keys off');
  check('public-rules', 'a public message cannot arrive pre-read or pre-answered',
    /'read' in request\.resource\.data && request\.resource\.data\.read == true/.test(rules),
    'a message that arrives already ticked off is a message nobody reads');
  check('public-rules', 'a public message cannot be enormous',
    /request\.resource\.data\.message\.size\(\) < 5000/.test(rules),
    'an unbounded public write is a bill as much as a risk');

  /* The rule has to keep matching what the form actually sends. Both public
     creates set status:'new' — if that ever stops being true, real customers
     silently stop being able to request a quote, and rules are covered by
     neither CI nor Netlify. */
  check('public-rules', 'the public quote form still sends status:new',
    (idx.match(/status: 'new'/g) || []).length >= 2,
    'the create rule requires it — if the form stops sending it, quote requests fail for real customers');
  check('public-rules', 'the public form sends no field the rule refuses',
    !/addDoc\(collection\(db,'quotes'\)[\s\S]{0,700}(quotedPrice|approvalStatus|convertedToCustomerAt|quoteArchived)/.test(idx),
    'that combination would be refused at the database and the customer would just see an error');
  check('public-rules', 'update and delete stay staff-only',
    /allow read, update, delete: if request\.auth != null;/.test(rules),
    'the public needs to CREATE a quote, never to change one');
})();

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

  // ---- 2.2b Missing required fields on the Add form ----------------------
  /* Only Street Address and City ever carried the browser's own `required`, so
     a customer could be saved with no phone, no email, no photo and no price
     and nothing said a word. Every other guard in this handler also reports one
     problem at a time, which is what made a long form feel broken. */
  const missingFn = admin.slice(admin.indexOf('function addCustMissingFields'),
                                admin.indexOf('function addCustMissingFields') + 700);
  check('reliability', 'the Add form has a missing-required-fields check',
    missingFn.length > 100 && /function showAddCustMissing/.test(admin),
    'a customer saved with no phone, photo or price looked identical to a complete one');
  ['Street Address', 'City', 'Phone Number', 'Email', 'House Picture', 'Total Price'].forEach(function(field){
    check('reliability', 'the Add form names "' + field + '" when it is missing',
      missingFn.indexOf("'" + field + "'") !== -1,
      'being told about missing fields one at a time is what made this form feel broken');
  });
  check('reliability', 'every missing field is listed in one go, not one per attempt',
    /missingFields\.map\(/.test(addForm) && /showAddCustMissing\(missingFields\)/.test(addForm),
    'six trips around a form this long is most of what "add customer does not work" was');
  check('reliability', 'the missing-field check runs before anything is written',
    addForm.indexOf('addCustMissingFields(') > -1 &&
    addForm.indexOf('addCustMissingFields(') < addForm.indexOf('addDoc('),
    'telling someone what is missing after the record is saved is not telling them');
  check('reliability', 'the missing-field warning can be overridden on purpose',
    /add them without these/.test(addForm),
    'a house genuinely can be added before the photo is taken or the price agreed');
  check('reliability', 'the red missing box is cleared once the customer saves',
    /showAddCustMissing\(\[\]\)/.test(addForm),
    'a stale red box on a successful save reads as a failure');

  // ---- 2.2c A house Google cannot place is still added --------------------
  /* The bulk importer has always saved these and flagged the pin. The
     hand-typed form threw the whole record away instead — and blamed the
     address for every other failure in the save, too. */
  check('reliability', 'a failed geocode no longer loses the customer',
    /catch\(geoErr\)/.test(addForm) && /needsGeocode: pinFailed/.test(addForm),
    'a house Google could not place simply could not be added at all');
  check('reliability', 'the geocode happens outside the save try block',
    addForm.indexOf('catch(geoErr)') < addForm.indexOf('addDoc('),
    'a Firestore or photo failure came back as "could not locate that address"');
  check('reliability', 'a missing map pin is reported on the successful save',
    /no map pin yet/.test(addForm),
    'a house with no pin never appears on a route and nothing said so');
  check('reliability', 'a failed save reports the real error, not the address',
    !/Could not locate that address — check spelling/.test(addForm) &&
    /Could not finish adding/.test(addForm),
    'every failure blamed the spelling of a street that was never the problem');

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
    /function onceAtATime[\s\S]{0,1400}finally \{[\s\S]{0,200}btn\.disabled = false;/.test(admin.replace(/\r/g,'')),
    'a dead button that needs a page refresh is worse than the double click');
  check('reliability', 'an unexpected throw in a guarded tool is shown to whoever clicked',
    /function onceAtATime[\s\S]{0,1200}catch\(err\)\{?[\s\S]{0,900}toast\('Something went wrong: '[\s\S]{0,200}throw err;/
      .test(admin.replace(/\r/g,'')),
    'a programming error left the button alive, nothing saved and NOTHING on screen — ' +
    'which is exactly what "Add Customer does not work" looked like');

  // ---- 2.10b Widget-only helpers called from the main app -----------------
  /* The Route Dashboard at the bottom of admin.html is a self-contained widget
     inside an IIFE, rendering into a shadow root. It declares its own esc(),
     toast(), fmtPhone() and friends. Those are NOT in scope for the rest of the
     file, but they LOOK like it — and the duplicate-address warning on Add
     Customer called fmtPhone anyway, so adding a customer to a house already on
     file threw "fmtPhone is not defined", died before writing anything, and
     showed up only as "Unhandled promise" in the error catcher.
     Rather than pin this to fmtPhone, read the widget's own declarations and
     insist that anything the main app calls is also declared in the main app. */
  const widgetStart = admin.indexOf('const RT=host.attachShadow');
  check('reliability', 'the route dashboard widget is still a self-contained IIFE',
    widgetStart > -1,
    'the scope check below silently passes on everything if this anchor moves');
  if(widgetStart > -1){
    const mainApp = admin.slice(0, widgetStart);
    const widget  = admin.slice(widgetStart);
    const widgetFns = new Set();
    let m;
    const declRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    while((m = declRe.exec(widget))) widgetFns.add(m[1]);
    const leaked = [];
    widgetFns.forEach(function(fn){
      const calledInMain = new RegExp('[^.\\w$]' + fn + '\\s*\\(').test(mainApp);
      const declaredInMain = new RegExp('\\bfunction\\s+' + fn + '\\s*\\(').test(mainApp);
      if(calledInMain && !declaredInMain) leaked.push(fn);
    });
    check('reliability', 'the main app never calls a helper that only exists inside the route widget',
      leaked.length === 0,
      'those are scoped to the widget, so the call throws "is not defined" and kills the handler' +
      (leaked.length ? ' — leaked: ' + leaked.join(', ') : ''));
  }

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

  /* ---- t17: a pending quote must reach a customer who already has a bill --
   * The approve/decline card existed, but the only path that rendered it ran
   * when portalInvoice found NOTHING — so anyone who had ever been billed
   * could not see a new quote, and the only way to approve one was the emailed
   * link. Delete the email and you had to telephone. */
  check('season', 'a signed-in customer is offered a pending quote',
    /function offerPendingQuote/.test(idx) && /offerPendingQuote\(raw\);/.test(idx),
    'the quote card only rendered for someone who was not yet a customer');
  check('season', 'an already-answered quote is not offered again',
    /d\.approvalStatus === 'approved' \|\| d\.approvalStatus === 'declined'/.test(
      idx.slice(idx.indexOf('function offerPendingQuote'), idx.indexOf('function offerPendingQuote') + 1800)),
    'showing Approve for a settled quote is a second bite at a decision already made');

  /* ---- the PayPal buttons must survive an SDK without FUNDING ------------
   * index.html guarded FUNDING.CARD but not FUNDING.PAYPAL, so an SDK that did
   * not expose FUNDING threw AFTER the card button rendered and killed the
   * rest — leaving the customer an empty PayPal area and a console error. */
  check('season', 'the PayPal button does not assume FUNDING exists',
    /if\(window\.paypal\.FUNDING && window\.paypal\.FUNDING\.PAYPAL\)\{/.test(idx),
    'an unguarded FUNDING.PAYPAL read leaves the customer with no way to pay');

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
  const rppSrc = rppStart > -1 ? sectionFrom(fns, rppStart) : '';
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
  const piSrc = piStart > -1 ? sectionFrom(fns, piStart) : '';
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
// 14. WAREHOUSE GROUP ROWS — the names have to be REACHABLE
// =====================================================================
/*
 * The Build tab grouped houses behind a row that opened on click, with a bare
 * chevron as the only hint. Nobody read that as a control, so in practice the
 * customer names were unreachable and the tab looked like it had none — the
 * report was literally "it doesn't show customer name on it".
 *
 * A regex proving the markup contains a button proves nothing about whether the
 * button opens anything. So this renders the real function into a DOM, CLICKS
 * the button, and looks for the customer's name afterwards.
 */
suite('14. Warehouse group rows open and carry the house facts');

if (!JSDOM) {
  note('jsdom not installed — skipping the Warehouse render tests');
} else {
  const whStart = admin.indexOf('function whWireLabel(');
  const buildStart = admin.indexOf('function renderWarehouseQueue()');
  /* Starts at the GROUPING helper, not the renderer. The screen and the
     printed sheet both read whRecycleGroups so they cannot drift apart, which
     means the renderer no longer works on its own — slicing from the renderer
     alone left it calling a function this sandbox had never been given. */
  const recycleStart = admin.indexOf('function whRecycleGroups()');
  const recycleFnStart = admin.indexOf('function renderWarehouseRecycleQueue()');
  const buildEnd = buildStart > -1 ? admin.indexOf('\n}', buildStart) + 2 : -1;
  /* End measured from the RENDERER, not from recycleStart — the helper above
     it closes first, and ending there sliced the renderer off entirely. */
  const recycleEnd = recycleFnStart > -1 ? admin.indexOf('\n}', recycleFnStart) + 2 : -1;

  if (whStart === -1 || buildStart === -1 || recycleStart === -1 || buildEnd < 1 || recycleEnd < 1) {
    check('warehouse', 'the Warehouse render functions are findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    const dom = new JSDOM('<div id="warehouseQueueList"></div><div id="warehouseRecycleQueueList"></div>');
    global.document = dom.window.document;
    global.FEET_PER_BUNDLE = 40;
    global.perFootRate = 2.5;
    global.warehouseExtras = [];
    global.estimateFeetFromPrice = (price, rate) => Math.round((price / rate) * 1.05);
    global.custNumChip = d => (d && d.customerNumber ? ' <span>#' + d.customerNumber + '</span>' : '');
    global.propLabelChip = () => '';
    global.houseBundleNeed = d => {
      const feet = Number(d.measuredFeet) || 0;
      return feet ? { feet, bundles: Math.ceil(feet / 40), estimated: false, unknown: false }
                  : { feet: 0, bundles: 1, estimated: false, unknown: true };
    };
    // Firestore stubs — a render test must never reach a real write path (§9.4).
    global.db = {};
    global.doc = (...a) => ({ __path: a.slice(1).join('/') });
    global.updateDoc = async () => { throw new Error('render test must not write'); };
    global.deleteDoc = async () => { throw new Error('render test must not write'); };
    global.setDoc = async () => { throw new Error('render test must not write'); };
    global.serverTimestamp = () => '__ts__';

    // The Add From Inbox helpers live further down the file than the renderers.
    const formStart = admin.indexOf('let whExtraPatternFromRecord');
    /* Anchored on the LISTENER, not just the button id. whCancelEditExtra
       relabels that same button ("Add to Queue" / "Save Changes"), so a plain
       id search now lands inside a function and the slice ends mid-body. */
    const formEnd = admin.indexOf("document.getElementById('whAddExtraBtn').addEventListener", formStart);
    if (formStart === -1 || formEnd < formStart) {
      check('warehouse', 'the Add From Inbox helpers are findable',
        false, 'renamed or removed — update this test rather than deleting it');
    }
    eval(admin.slice(whStart, buildStart) + '\n' + admin.slice(buildStart, buildEnd) + '\n' +
         admin.slice(recycleStart, recycleEnd) + '\n' +
         (formEnd > formStart ? admin.slice(formStart, formEnd) : '') + '\n');

    // One brand-new customer (no number, wants a timer) and one returning house.
    global.jobAddresses = [
      { id: 'h1', data: { name: 'Nadia Brooks', address: '18 Frost Ln', needsLightBuild: true,
          lightsDescription: 'Warm White', wireColor: 'White', measuredFeet: 240,
          outletTimer: 'Yes', customerNumber: '', notes: 'Steep pitch over the entry' } },
      { id: 'h2', data: { name: 'Owen Hale', address: '92 Birch Way', needsLightBuild: true,
          lightsDescription: 'Warm White', wireColor: 'White', measuredFeet: 200,
          outletTimer: 'No', customerNumber: '1421' } }
    ];

    renderWarehouseQueue();
    const list = document.getElementById('warehouseQueueList');
    const group = list.querySelector('.row-item:last-of-type');
    const toggle = group.querySelector('button[data-whtoggle]');
    const body = group.querySelector('[id^="whlist-"]');

    check('warehouse', 'a group row has a real labelled button, not just a chevron',
      !!toggle && /Show 2 houses/.test(toggle.textContent),
      'the chevron alone read as decoration, so nobody opened the row and the names were unreachable');
    check('warehouse', 'the houses start hidden', body.style.display === 'none');

    // THE REGRESSION TEST: press the button the way she would.
    toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    check('warehouse', 'pressing the button opens the group',
      body.style.display === 'block',
      'the button exists but does nothing — which is the bug all over again');
    check('warehouse', 'the customer names are on screen once it is open',
      /Nadia Brooks/.test(body.innerHTML) && /Owen Hale/.test(body.innerHTML),
      'this is the whole point of the change');
    check('warehouse', 'the button now says Hide',
      /Hide/.test(toggle.textContent),
      'a control that does not change state leaves you guessing whether the tap registered');

    // Bubbling: the row carries the same handler, so a tap that reached both
    // would toggle twice and look like nothing happened at all.
    toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    check('warehouse', 'pressing it again closes the group exactly once',
      body.style.display === 'none',
      'a click reaching both the button and the row toggles twice and appears dead');

    check('warehouse', 'a house that wants a timer says so',
      /Timer/.test(body.innerHTML),
      'the timer was only ever visible as anonymous buffer stock');
    check('warehouse', 'the wire colour is on the house row',
      /White wire/.test(body.innerHTML));
    check('warehouse', 'a new customer with no number is flagged in the build list',
      /needs assigning/.test(body.innerHTML),
      'a bundle with no number on it cannot be binned or handed to a crew');
    check('warehouse', 'an existing customer shows their number instead',
      /#1421/.test(body.innerHTML));
    check('warehouse', 'the house notes come through',
      /Steep pitch over the entry/.test(body.innerHTML),
      'notes sit at the bottom of the row, under the facts');
    check('warehouse', 'timers are rolled up against the houses that asked for one',
      /Timers/.test(list.innerHTML) && /1 house in this build needs a timer/.test(list.innerHTML),
      'without this the count of timers to pull off the shelf is guesswork');

    // Recycle tab — same control, same reason.
    global.jobAddresses = [
      { id: 'r1', data: { name: 'Priya Raman', address: '5 Kestrel Ct',
          needsLightRecycle: true, lightsDescription: 'Red', wireColor: 'Green',
          customerNumber: '2210' } }
    ];
    renderWarehouseRecycleQueue();
    const rList = document.getElementById('warehouseRecycleQueueList');
    const rToggle = rList.querySelector('button[data-whrecycletoggle]');
    const rBody = rList.querySelector('[id^="whrecycle-"]');
    check('warehouse', 'the Recycle tab has the same labelled button',
      !!rToggle && /Show 1 house/.test(rToggle.textContent));
    rToggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    check('warehouse', 'pressing it opens the recycle group and shows the name',
      rBody.style.display === 'block' && /Priya Raman/.test(rBody.innerHTML));
    check('warehouse', 'the recycle row shows the number that is about to be returned',
      /#2210/.test(rBody.innerHTML),
      'that number is what goes back in the pool — it is worth seeing before pressing the button');

    /* --- Add From Inbox: the amount fills itself in, and a member gets ONE
       request rather than two competing ones. The bundle figure has to come from
       the same maths the queue uses, or the form and the queue disagree about
       the same house. */
    check('warehouse', 'bundles for a build request come from the feet on file',
      whExtraBundlesFor({ measuredFeet: 240 }).qty === 6 &&
      /240 ft on file/.test(whExtraBundlesFor({ measuredFeet: 240 }).note),
      'this is the number Dad builds to — typing it by hand is how it drifts from the queue');
    check('warehouse', 'a house with no feet on file says so instead of showing nothing',
      whExtraBundlesFor({}).qty === 1 && /No feet on file/.test(whExtraBundlesFor({}).note),
      'a silent 1 looks like a real answer; a stated assumption can be corrected');

    global.warehouseExtras = [
      { id: 'x1', data: { customerId: 'h1', kind: 'lights', pattern: 'Warm White', quantity: 6, label: 'Nadia Brooks' } },
      { id: 'x2', data: { customerId: 'h1', kind: 'timer', pattern: 'Timer', quantity: 1, label: 'Nadia Brooks' } },
      { id: 'x3', data: { pattern: 'Multi', quantity: 3, label: '' } }
    ];
    check('warehouse', 'a second lights request for a member finds the one they already have',
      (whExtraFindExisting('h1', 'lights') || {}).id === 'x1',
      'without this they end up with two competing requests for the same job');
    check('warehouse', 'a timer request is kept apart from their lights request',
      (whExtraFindExisting('h1', 'timer') || {}).id === 'x2',
      'topping up the lights request with a timer would build the wrong thing');
    check('warehouse', 'a member with no request yet matches nothing',
      whExtraFindExisting('h2', 'lights') === null);
    check('warehouse', 'buffer stock is never treated as a member request',
      whExtraFindExisting(undefined, 'lights') === null,
      'generic stock has no customer to top up');

    // The Build tab must show a member's two items under ONE heading.
    global.jobAddresses = [
      { id: 'h1', data: { name: 'Nadia Brooks', address: '18 Frost Ln', customerNumber: '',
          lightsDescription: 'Warm White', wireColor: 'White', measuredFeet: 240 } }
    ];
    renderWarehouseQueue();
    const l2 = document.getElementById('warehouseQueueList');
    check('warehouse', 'a member\'s lights and timer sit under one request heading',
      /Nadia Brooks — extra request/.test(l2.innerHTML) &&
      (l2.innerHTML.match(/extra request/g) || []).length === 1,
      'two headings for one person is exactly the "two different requests" problem');
    check('warehouse', 'the request heading says what to pick up',
      /6 bundles Warm White · 1 timer/.test(l2.innerHTML),
      '"0 houses, 7 extra" is true and tells Dad nothing');
    check('warehouse', 'generic buffer stock still gets its own group',
      /buffer stock/.test(l2.innerHTML),
      'stock with no house attached must not be filed under a member');
    check('warehouse', 'a member request has no bulk count box',
      !/whdone-0/.test(l2.innerHTML.slice(0, l2.innerHTML.indexOf('buffer stock'))),
      'a "houses finished" box on a single person invites the same over-count mistake');

    /* --- The printed sheet ------------------------------------------------
       Same list, same order, flattened to one row per line. Built off
       whBuildQueueGroups, which is also what the screen renders from — these
       checks are what stops the paper and the tab drifting apart. */
    global.jobAddresses = [
      { id: 'h1', data: { name: 'Nadia Brooks', address: '18 Frost Ln', needsLightBuild: true,
          lightsDescription: 'Warm White', wireColor: 'White', measuredFeet: 240,
          outletTimer: 'Yes', customerNumber: '', notes: 'Steep pitch over the entry' } },
      { id: 'h2', data: { name: 'Owen Hale', address: '92 Birch Way', needsLightBuild: true,
          lightsDescription: 'Warm White', wireColor: 'White', customerNumber: '1421' } }
    ];
    global.warehouseExtras = [
      { id: 'x3', data: { pattern: 'Multi', quantity: 3, label: 'Spare sets' } }
    ];
    const sheet = whSheetRowsForBuild();
    check('warehouse', 'the print sheet has one row per line, not per group',
      sheet.rows.length === 3,
      'got ' + sheet.rows.length + ' — two houses and one buffer entry is three rows');
    check('warehouse', 'every row carries its group, so the sheet sorts like a spreadsheet',
      sheet.rows.every(r => !!r.group),
      'a group name only in a heading row is lost the moment the sheet is sorted');
    check('warehouse', 'the sheet is in the same order as the tab',
      sheet.rows[0].group === sheet.rows[1].group && sheet.rows[2].group !== sheet.rows[0].group,
      'the two houses share a colour group and must stay together, buffer stock after');
    check('warehouse', 'a house with no feet on file leaves the Feet cell empty',
      sheet.rows.find(r => r.what === 'Owen Hale').feet === '',
      'a 0 in a Feet column reads as a measurement — this is the absence of one');
    check('warehouse', 'the bundle count on paper is the same one on screen',
      sheet.rows.find(r => r.what === 'Nadia Brooks').bundles === 6,
      'a printout that disagrees with the tab is worse than no printout');
    check('warehouse', 'a house that wants a timer says YES in the timer column',
      sheet.rows.find(r => r.what === 'Nadia Brooks').timer === 'YES');
    check('warehouse', 'buffer stock prints its label and quantity',
      sheet.rows[2].what === 'Spare sets' && sheet.rows[2].bundles === 3);

    const table = whSheetTable(sheet.rows, sheet.columns);
    /* Numeric columns carry class="num" so they right-align on paper, which is
       why this matches the label rather than a bare <th>. */
    check('warehouse', 'the sheet is a real table with a header row',
      /<thead>/.test(table) && />Bundles<\/th>/.test(table) && />Address<\/th>/.test(table),
      'without headers it is not a spreadsheet, it is a wall of text');
    check('warehouse', 'every printed row starts with a tick box',
      (table.match(/<td class="tick">/g) || []).length === sheet.rows.length,
      'the sheet is worked down on a clipboard — there has to be something to tick');
    check('warehouse', 'hostile text is escaped on the printed sheet too',
      !/<script>/.test(whSheetTable([{group:'g', what:'<script>alert(1)</script>', wire:'', type:'House',
        address:'', bin:'', feet:'', bundles:1, timer:'', notes:''}], sheet.columns)),
      'the sheet is written into a new window with document.write');

    const rSheet = whSheetRowsForRecycle();
    check('warehouse', 'the recycle sheet lists the numbers coming back to the pool',
      rSheet.rows.length === 0,
      'nothing is flagged for recycle in this fixture, so it must come back empty rather than inventing rows');
  }
}
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * A customer who answers "no" or "back next year" on the RSVP link was
 * updated in jobAddresses, but never pulled off a route the crew had already
 * been handed — the same "sitting the season out" concept the admin-side
 * Maybe Next Year toggle (setCustomerSeason/removeCustomerFromUpcomingRoutes
 * in admin.html) has always handled correctly. A text check on portalRsvp's
 * source could pass even with the route-removal call missing entirely, so
 * this suite actually EXECUTES removeCustomerFromUpcomingRoutes against a
 * fake Firestore and proves it strips the right stop from the right route —
 * then a text check confirms portalRsvp is actually wired to call it.
 */
(function () {
  const rStart = fnsSrc.indexOf('async function removeCustomerFromUpcomingRoutes(');
  if (rStart === -1) {
    check('rsvp-routes', 'removeCustomerFromUpcomingRoutes found in functions/index.js', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const rSrc = fnsSrc.slice(rStart, fnsSrc.indexOf('\n}', rStart) + 2);

  function makeRouteHarness(routes) {
    const updated = [];
    const ctx = {
      db: {
        collection: () => ({
          get: async () => ({
            docs: routes.map(r => ({
              data: () => r,
              ref: { update: async (payload) => { updated.push({ id: r.id, payload }); r.stops = payload.stops; } }
            }))
          })
        })
      },
      todayStrInDenver: () => '2026-11-20',
      console
    };
    const names = Object.keys(ctx);
    const fn = new Function(...names, rSrc + '\nreturn removeCustomerFromUpcomingRoutes;')(...names.map(n => ctx[n]));
    return { fn, updated };
  }

  const upcomingRoute = { id: 'r-upcoming', date: '2026-11-25', stops: [{ id: 'cust-1' }, { id: 'cust-2' }] };
  const pastRoute = { id: 'r-past', date: '2026-11-01', stops: [{ id: 'cust-1' }] };
  const harness = makeRouteHarness([upcomingRoute, pastRoute]);

  pendingAsync.push((async () => {
    suite('11. RSVP no / back-next-year removes the customer from upcoming routes');
    let removedCount = null, threw = null;
    try { removedCount = await harness.fn('cust-1'); } catch (e) { threw = e; }

    check('rsvp-routes', 'removeCustomerFromUpcomingRoutes runs without throwing',
      threw === null,
      'it threw ' + (threw && threw.message) + ' — every caller silently fails to sweep routes');
    check('rsvp-routes', 'the customer is stripped from the upcoming route\'s stops',
      !upcomingRoute.stops.some(s => s.id === 'cust-1'),
      'a customer who declined would still be a stop on a route the crew is about to run');
    check('rsvp-routes', 'other stops on the same upcoming route are left alone',
      upcomingRoute.stops.some(s => s.id === 'cust-2'),
      'removing one customer should not remove their neighbors on the same route');
    check('rsvp-routes', 'a PAST route is left alone as history',
      pastRoute.stops.some(s => s.id === 'cust-1'),
      'rewriting a past route would change what the crew actually did that day');
    check('rsvp-routes', 'the function reports how many routes it actually changed',
      removedCount === 1,
      'the return value is what a caller would log — it should count only the route actually changed');

    // Wiring check: portalRsvp must actually call this for 'no' and 'backnextyear'.
    const prStart = fnsSrc.indexOf('exports.portalRsvp');
    const prSrc = prStart > -1 ? fnsSrc.slice(prStart, fnsSrc.indexOf('\n});', prStart) + 4) : '';
    check('rsvp-routes', 'portalRsvp found in functions/index.js', prStart > -1,
      'renamed or removed — update this test rather than deleting it');
    check('rsvp-routes', 'portalRsvp removes the customer from upcoming routes on "no" or "back next year"',
      /response === 'no' \|\| response === 'backnextyear'/.test(prSrc) &&
      /removeCustomerFromUpcomingRoutes\(match\.id\)/.test(prSrc),
      'a customer who declines or asks for next year by email link would still show up on the crew\'s route');

    // Same gap, admin side: setting RSVP to No from the Edit Customer dropdown
    // (not just the Maybe Next Year toggle) must sweep routes too.
    const ecStart = admin.indexOf("editCustSaveBtn').addEventListener('click'");
    /* Sliced to the handler's real END — the first `\n});` at column 0 — not to
       a fixed character count.
       ⚠ This WAS `ecStart + 15000`, and it broke exactly the way CLAUDE.md §7
       warns a magic window always eventually breaks: the Edit Customer save
       handler grew (the §2 reliability work added to it), the
       removeCustomerFromUpcomingRoutes call ended up 15,304 characters in, and
       a correct, present, working line started reporting as a FAILURE. A test
       that fails because the file got longer teaches you to distrust the
       suite. */
    const ecEnd = ecStart > -1 ? admin.indexOf('\n});', ecStart) : -1;
    const ecSrc = ecStart > -1 ? admin.slice(ecStart, ecEnd > -1 ? ecEnd : admin.length) : admin;
    check('rsvp-routes', 'Edit Customer removes the customer from upcoming routes when RSVP is set to No',
      /newRsvp === 'no' && item\.data\.rsvpStatus !== 'no'/.test(ecSrc) &&
      (ecSrc.match(/removeCustomerFromUpcomingRoutes\(editCustomerId\)/g) || []).length >= 1,
      'setting RSVP straight to No from the dropdown had the same gap as the portal link — the crew still turns up');
  })());
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * buildInvoiceDocHtml (the printable/on-screen Invoice Preview panel in
 * admin's Invoices tab — NOT the automation email, which is a separate,
 * template-driven path and out of scope here) computes
 * total = install + removal + changeFees and shows that total, but the
 * itemized rows above it never included a removal line — the same class of
 * bug the P0 fix eliminated for changeFees (CLAUDE.md §4), just missed for
 * removal. A customer with a removal charge saw a total that didn't match
 * what the line items added up to. This suite EXECUTES the real function
 * against a fake invoice and checks the rendered HTML directly, rather than
 * trusting a text/regex check that could pass on dead code.
 */
(function () {
  const biStart = admin.indexOf('function buildInvoiceDocHtml(member){');
  if (biStart === -1) {
    check('invoice-doc', 'buildInvoiceDocHtml found in admin.html', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const biEnd = admin.indexOf('\nlet invRecipientSearchTerm', biStart);
  const biSrc = admin.slice(biStart, biEnd);

  // fmtMoney is real (lifted from js/money.js, not stubbed) so this suite
  // fails if the actual formatting rule ever changes underneath it.
  const fmtMoneySrc = extractFn(money, 'fmtMoney');

  function makeInvoiceHarness(invoiceOverrides) {
    const ctx = {
      allInvoicesCache: [{
        id: '8015551234',
        data: Object.assign({
          install: 400, removal: 0, deposit: 0, credits: 0, changeFees: 0,
          newMemberFeeApplied: false, creditNotes: [], changeFeeNotes: []
        }, invoiceOverrides)
      }],
      jobAddresses: [],
      perFootRate: 4,
      siteContentCache: {},
      computeInvoiceStatus: computeInvoiceStatus,
      esc: s => String(s == null ? '' : s),
      toJsDate: v => (v instanceof Date ? v : null),
      addDays: (d, n) => new Date((d instanceof Date ? d.getTime() : Date.now()) + n * 86400000),
      niceDate: () => 'Nov 20, 2026',
      invoiceNumberFor: () => 'INV-0001',
      PORTAL_ADDRESS: 'highlightingutah.com/#/payment',
      VENMO_HANDLE: 'HighLightingUtah',
      PAYMENT_TERMS_DAYS: 14
    };
    const names = Object.keys(ctx);
    const fn = new Function(...names,
      fmtMoneySrc + '\n' + biSrc + '\nreturn buildInvoiceDocHtml;'
    )(...names.map(n => ctx[n]));
    return fn;
  }

  const member = { data: {
    phone: '8015551234', email: 'test@example.com', measuredFeet: 100,
    housePrice: 400, chargeNewMemberFee: false, address: '1 Test St', name: 'Test Customer'
  } };

  suite('12. Printable invoice line items match the total shown');

  let withRemovalHtml = null, threwWithRemoval = null;
  try { withRemovalHtml = makeInvoiceHarness({ install: 400, removal: 150 })(member); }
  catch (e) { threwWithRemoval = e; }
  check('invoice-doc', 'buildInvoiceDocHtml runs without throwing',
    threwWithRemoval === null,
    'it threw ' + (threwWithRemoval && threwWithRemoval.message));
  check('invoice-doc', 'a removal charge shows as its own line item',
    !!withRemovalHtml && /Removal service/.test(withRemovalHtml) && withRemovalHtml.includes('$150.00'),
    'the Total includes removal but the line items above it never showed it — a customer with a removal ' +
    'charge sees numbers that silently don\'t add up');

  const noRemovalHtml = makeInvoiceHarness({ install: 400, removal: 0 })(member);
  check('invoice-doc', 'no removal line when there is no removal charge',
    !/Removal service/.test(noRemovalHtml),
    'an empty "Removal service — $0.00" row on every ordinary invoice would be clutter, not a fix');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * The Bulk Updates "Address Fields" importer (rbImportBtn) parses a
 * Customer # column, validates every number up front — bad format, an
 * in-batch duplicate, or a number already belonging to someone else all
 * block the whole import with a specific row-numbered error — and then
 * never actually wrote it to any record. The office would watch real
 * validation errors fire for typos, reasonably conclude the numbers were
 * being taken seriously, and every customer would come out with no
 * customerNumber at all. This is a text-based check, not an execution one:
 * rbImportBtn is a huge click handler wired to a page full of textareas and
 * a real geocoder, and mocking all of that for one field is not worth it
 * here — but the check is specific enough (exact assignment expressions,
 * not just "cn appears somewhere") that it can't pass on dead code.
 */
(function () {
  const start = admin.indexOf("rbImportBtn').addEventListener('click'");
  if (start === -1) {
    check('bulk-address', 'rbImportBtn found in admin.html', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const src = sectionFrom(admin, start);

  check('bulk-address', 'the Customer # column is parsed into cn',
    /const custNumbers = alignBulkRows/.test(src) && /const cn = custNumbers\[i\] \|\| ''/.test(src),
    'without this the column is read for validation only and the value itself is thrown away');
  check('bulk-address', 'an existing customer actually gets the number written',
    /updates\.customerNumber = cn;/.test(src),
    'validation ran, no error shown, but the update object never carried the number through');
  check('bulk-address', 'a newly-created customer actually gets the number written',
    /newDoc\.customerNumber = cn;/.test(src),
    'validation ran, no error shown, but the new customer document never carried the number through');
  check('bulk-address', 'under-5000 numbers set Number of Bins to 1, matching the help text under the box',
    (src.match(/if\(parseInt\(cn,10\) < 5000\) updates\.numberOfBins = 1;/) || []).length +
    (src.match(/if\(parseInt\(cn,10\) < 5000\) newDoc\.numberOfBins = 1;/) || []).length >= 2,
    'the box\'s own help text promises this and a human would trust it without checking');
  check('bulk-address', 'a number already sitting in the recycled pool is cleared once assigned',
    /deleteDoc\(doc\(db,'availableCustomerNumbers', cn\)\)/.test(src),
    'without this a manually-typed number could still be handed out again later by Assign in Bulk');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * A customer who fully cancels through the Member Portal's own Cancel tab
 * (not just an RSVP "no") never set needsLightRecycle, so they never
 * appeared in the Warehouse Recycle queue (which keys strictly off that one
 * flag) — their bin/customer number stayed locked to an inactive account
 * until someone separately noticed the "Cancellation Requested" pill and
 * manually flipped RSVP to No in Edit Customer. And they never got pulled
 * off an already-scheduled route either, same gap as RSVP no/back-next-year
 * (suite 11). Both are fixed in portalSave's 'cancel' section. Separately,
 * index.html's cancel handler used to swallow a failed portalSave with
 * nothing but a console.error nobody reads — that failure is now flagged
 * directly on the message the office is about to read.
 */
(function () {
  const psStart = fnsSrc.indexOf('exports.portalSave');
  const psSrc = psStart > -1 ? sectionFrom(fnsSrc, psStart) : '';
  check('cancel-flow', 'portalSave found in functions/index.js', psStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('cancel-flow', 'a full cancellation flags needsLightRecycle, same as RSVP no',
    /section === 'cancel'\) \{[\s\S]{0,700}needsLightRecycle = true;/.test(psSrc),
    'without this a cancelled customer never appears in the Warehouse Recycle queue — their number stays locked forever');
  check('cancel-flow', 'a full cancellation is pulled off any already-scheduled route',
    /section === 'cancel'\) \{\s*await removeCustomerFromUpcomingRoutes\(match\.id\);/.test(psSrc),
    'a customer who cancels through the portal would still show up on the crew\'s route, same gap as RSVP no/back-next-year');

  const idx = read('index.html');
  const cancelStart = idx.indexOf("cancelFinalBtn').addEventListener('click'");
  const cancelSrc = cancelStart > -1 ? sectionFrom(idx, cancelStart) : '';
  check('cancel-flow', 'cancelFinalBtn handler found in index.html', cancelStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('cancel-flow', 'a failed account-status save is surfaced, not just console.error\'d',
    /catch\(cancelErr\)\{[\s\S]{0,700}updateDoc\(cancelMsgRef/.test(cancelSrc),
    'the office\'s Inbox message would read like nothing went wrong even when the account never actually got flagged');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * "Convert to Customer" on a quote card never checked whether that quote had
 * already been converted — only whether it was archived. Converting sets
 * status:'closed' and convertedToCustomerAt, but the button stayed live and
 * clickable on an already-closed quote, and the Add Customer submit handler
 * did an unconditional addDoc with no dedup check. A second click created a
 * genuine duplicate: a second jobAddresses record, invoice, warehouse entry
 * and customer number for the same person. Fixed on both ends — the button
 * itself no longer renders once convertedToCustomerAt is set, and the submit
 * handler independently re-checks the quote against the server right before
 * writing, so a second staff member converting the same quote in a different
 * tab is caught too, not just a double-click in one tab.
 */
(function () {
  const cardStart = admin.indexOf("Restore this quote");
  const cardSrc = cardStart > -1 ? sectionFrom(admin, cardStart) : '';
  check('convert-dup', 'quote card render found in admin.html', cardStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('convert-dup', 'the Convert to Customer button no longer shows once a quote is converted',
    /d\.convertedToCustomerAt[\s\S]{0,300}data-converttocust/.test(cardSrc),
    'a converted quote still offered a live "Convert to Customer" button, inviting a second, duplicate conversion');

  const guardStart = admin.indexOf('dupCheckSnap');
  const guardSrc = guardStart > -1 ? admin.slice(Math.max(0, guardStart - 400), guardStart + 500) : '';
  check('convert-dup', 'Add Customer guard found in admin.html', guardStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('convert-dup', 'submitting Add Customer re-checks the quote for a prior conversion before writing',
    /if\(addCustFromQuoteId\)\{[\s\S]{0,150}dupCheckSnap[\s\S]{0,150}convertedToCustomerAt[\s\S]{0,150}return;/.test(guardSrc),
    'clicking Add Customer twice on the same pre-filled form (or two staff converting the same quote at once) ' +
    'created a second jobAddresses record, invoice, warehouse entry and customer number for one person');
})();

// =====================================================================
/* ⚠ THE BUGS THIS SUITE CATCHES.
 *
 * Deleting a customer (either one at a time from Edit Customer, or all of
 * them from Danger Zone) never cleaned up fully:
 *   - Neither path removed the customer from an already-built route, so a
 *     deleted customer left a phantom stop behind — the crew's Mark Done had
 *     nothing to update against and failed with no feedback. Single delete
 *     is fixed with the same removeCustomerFromUpcomingRoutes() sweep every
 *     other "customer is gone for the season" path already uses.
 *   - Delete All Customers never released customerNumber back to the
 *     available pool, unlike the single-delete path — whose own confirm()
 *     dialog explicitly promises "Number #X goes back into the available
 *     pool." A full wipe left every number permanently unlisted as
 *     recycled, even though nobody held it anymore.
 */
(function () {
  const singleStart = admin.indexOf("editCustDeleteBtn').addEventListener('click'");
  const singleSrc = singleStart > -1 ? sectionFrom(admin, singleStart) : '';
  check('delete-cleanup', 'Delete This Customer handler found in admin.html', singleStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('delete-cleanup', 'deleting a single customer sweeps them off upcoming routes',
    /removeCustomerFromUpcomingRoutes\(item\.id\)/.test(singleSrc) &&
    singleSrc.indexOf('removeCustomerFromUpcomingRoutes(item.id)') < singleSrc.indexOf("deleteDoc(doc(db,'jobAddresses', item.id))"),
    'a deleted customer left a phantom stop on any route already built — the crew\'s Mark Done had nothing to update and failed silently');

  const allStart = admin.indexOf("deleteAllAddressesBtn').addEventListener('click'");
  const allSrc = allStart > -1 ? sectionFrom(admin, allStart) : '';
  check('delete-cleanup', 'Delete All Customers handler found in admin.html', allStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('delete-cleanup', 'Delete All Customers releases every customer\'s number back to the pool',
    /availableCustomerNumbers['"]?,\s*num\)/.test(allSrc) || /'availableCustomerNumbers', num\)/.test(allSrc),
    'the single-delete confirm dialog promises this exact behavior — a full wipe silently didn\'t do it');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * attachAddressRowHandlers (the route/address-row .paystatus-select
 * dropdown, used on Routes and other address-row views) called
 * computeInvoiceStatus with only 4 arguments — install, removal, deposit,
 * credits — silently dropping changeFees (defaults to undefined, treated as
 * 0). Every other one of the ~40 call sites in admin.html correctly passes
 * all 5. For a customer carrying a light-change fee, this one dropdown
 * could disagree with every other status display in the app (Invoice List,
 * Dashboard, exports, emails) — e.g. reading "Paid in Full" while the real
 * invoice, fee included, is still Partial Payment.
 */
(function () {
  const rowStart = admin.indexOf('function attachAddressRowHandlers(container){');
  if (rowStart === -1) {
    check('invoice-status-args', 'attachAddressRowHandlers found in admin.html', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const rowSrc = sectionFrom(admin, rowStart);
  check('invoice-status-args', 'the paystatus dropdown includes changeFees, like every other invoice status call',
    /computeInvoiceStatus\(inv\.data\.install, inv\.data\.removal, inv\.data\.deposit, inv\.data\.credits, inv\.data\.changeFees\)/.test(rowSrc),
    'a customer with a light-change fee could show a status here that disagrees with every other status display in the app');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * 'system' is a reserved folder name — the RENAME handler already blocked
 * it (folders can't be renamed to it), but the CREATE handler only blocked
 * 'inbox'. A staff member could create a folder literally named "System"
 * (or "system"/"SYSTEM"). Once created it's a trap: any message moved into
 * it vanishes from Customer Messages (folder === 'System' is filtered out
 * there unconditionally, so it only shows in System Messages mixed with
 * real automated notices), and the folder becomes unclickable in the
 * sidebar (renderFolderSidebar resets selectedFolder straight back to
 * Inbox whenever it equals 'System').
 */
(function () {
  const addStart = admin.indexOf("addFolderBtn').addEventListener('click'");
  const addSrc = addStart > -1 ? sectionFrom(admin, addStart) : '';
  check('folder-names', 'addFolderBtn handler found in admin.html', addStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('folder-names', 'creating a folder named "system" is blocked, same as "inbox"',
    /name\.toLowerCase\(\) === 'inbox'[\s\S]{0,60}name\.toLowerCase\(\) === 'system'/.test(addSrc),
    'a folder named "System" is indistinguishable from real automated notices — messages moved into it ' +
    'vanish from Customer Messages and the folder itself becomes unclickable in the sidebar');
})();

// =====================================================================
/* ⚠ THE BUGS THIS SUITE CATCHES.
 *
 * Public-site content rendering (index.html) had two gaps against what
 * admin actually offers:
 *   - Gallery photo captions (typed in admin, single upload/bulk
 *     upload/inline edit) were never rendered by the real-data gallery
 *     listener — only the static placeholder gallery showed captions,
 *     which is presumably why nobody noticed: captions only visibly
 *     worked before any real photo existed.
 *   - Reviews and FAQ had no client-side sort at all, unlike Gallery and
 *     Hero Images (both sort by createdAt/order just above them in the
 *     same file). Admin's own lists ARE ordered (reviews newest-first,
 *     FAQ oldest-first) — a plain onSnapshot with no orderBy returns
 *     Firestore's implementation-defined order, not creation order, so
 *     what staff see in admin and what the public site shows could
 *     legitimately disagree.
 */
(function () {
  const idx = read('index.html');
  const galStart = idx.indexOf("onSnapshot(collection(db,'gallery')");
  const galSrc = galStart > -1 ? sectionFrom(idx, galStart) : '';
  check('public-content', 'gallery listener found in index.html', galStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('public-content', 'a gallery caption entered in admin actually renders on the public site',
    /g\.caption/.test(galSrc),
    'captions only ever worked on the static placeholder gallery, before any real photo was uploaded');

  const revStart = idx.indexOf("onSnapshot(collection(db,'reviews')");
  const revSrc = revStart > -1 ? sectionFrom(idx, revStart) : '';
  check('public-content', 'reviews are sorted to match admin\'s newest-first order',
    /docs\.sort/.test(revSrc),
    'admin shows reviews newest-first; the public site showed Firestore\'s undefined default order instead');

  const faqStart = idx.indexOf("onSnapshot(collection(db,'faq')");
  const faqSrc = faqStart > -1 ? sectionFrom(idx, faqStart) : '';
  check('public-content', 'FAQ is sorted to match admin\'s oldest-first order',
    /docs\.sort/.test(faqSrc),
    'admin shows FAQ oldest-first (so the "top 3" preview is deterministic); the public site had no sort at all');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * whBundlesFor (the crew portal's build-sheet bundle count, employee.html)
 * fell back to 0 bundles for a house with NEITHER measured feet NOR a
 * price to estimate from — contradicting its own neighboring comment
 * ("bundles are estimated from the price... so the crew doesn't see
 * '0 bundles' and under-build"), which only actually held when a price
 * existed. Admin's own houseBundleNeed uses the same fallback chain and
 * assumes 1 bundle in that exact case. The mismatch meant the printed
 * warehouse sheet the crew builds from could under-total by 1 bundle per
 * such house, disagreeing with what the office dashboard shows for the
 * same customer. Executed directly against the real function, not just a
 * text check — this is exactly the kind of "which number does the
 * fallback branch return" bug a regex can't see.
 */
(function () {
  const wbSrc = extractFn(employee, 'whBundlesFor');
  if (!wbSrc) {
    check('bundle-fallback', 'whBundlesFor found in employee.html', false,
      'renamed or removed — update this test rather than deleting it');
    return;
  }
  const fn = new Function('empPfRateVal', wbSrc + '\nreturn whBundlesFor;')(0);

  const noFeetNoPrice = fn({ measuredFeet: 0, housePrice: 0 });
  check('bundle-fallback', 'a house with no feet and no price still counts as at least 1 bundle',
    noFeetNoPrice.bundles === 1,
    'it returned ' + noFeetNoPrice.bundles + ' — a 0-bundle house is silently missing from the group/printable-sheet totals, ' +
    'disagreeing with admin\'s own houseBundleNeed, which assumes 1 in this exact case');
  check('bundle-fallback', 'that fallback is still flagged unknown, so the crew knows it\'s a guess',
    noFeetNoPrice.unknown === true,
    'losing the "unknown" flag would hide that this number was never actually measured');

  const withFeet = fn({ measuredFeet: 80, housePrice: 0 });
  check('bundle-fallback', 'a house WITH feet on file is unaffected by the fallback',
    withFeet.bundles === 2 && withFeet.unknown === false,
    'the fallback for missing data must never override a real measurement');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * A customer's exact light-colour PATTERN (order + repeats, e.g. "Red, Red,
 * Warm White, Warm White, repeating" from the quote detail form's sequence
 * builder) was silently flattened on Convert to Customer. The colour
 * checkboxes on the Add a Customer form only ever carry a SET of colours —
 * submitting always rebuilt lightsDescription from checkbox DOM order via
 * compileLightsDescription, discarding order and repeat counts entirely,
 * with no on-screen cue to staff that a pattern existed. lightsDescription
 * drives the warehouse build queue and the crew's build instructions, so a
 * real pattern request could get built wrong. This is a text-based check —
 * the state (addCustQuoteLightsPattern) is captured in one click handler and
 * consumed in a different, much larger submit handler full of DOM/geocoding
 * calls not worth mocking here — but it targets the exact expressions, not
 * just "the words appear somewhere".
 */
(function () {
  const captureStart = admin.indexOf('addCustQuoteLightsPattern = rbDetectColorsAndPattern');
  check('light-pattern', 'the quote\'s pattern is captured when converting to a customer',
    captureStart > -1,
    'renamed or removed — update this test rather than deleting it');

  const submitStart = admin.indexOf('const keptQuotePattern');
  const submitSrc = submitStart > -1 ? sectionFrom(admin, submitStart) : '';
  check('light-pattern', 'submitting Add Customer keeps the captured pattern when the colours are unchanged',
    /selectedColors\.length === addCustQuoteColorsSnapshot\.length/.test(submitSrc) &&
    /keptQuotePattern\s*\?\s*addCustQuoteLightsPattern/.test(submitSrc),
    'without this, converting a quote with a real pattern always rebuilt a plain comma-joined colour list, ' +
    'losing the order and repeat counts the customer actually specified');
  check('light-pattern', 'changing the colours during conversion does NOT keep the stale original pattern',
    /compileLightsDescription\(selectedColors\.join/.test(submitSrc),
    'if staff pick different colours than the quote had, the description must be rebuilt fresh, not keep an now-wrong pattern');

  const resetCount = (admin.match(/addCustQuoteLightsPattern = '';/g) || []).length;
  check('light-pattern', 'the captured pattern is cleared everywhere addCustFromQuoteId is',
    resetCount >= 2,
    'a stale pattern from a previous conversion could leak onto an unrelated manual Add Customer submission');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * Convert to Customer treated a deliberately comped $0 quote the same as
 * "no price set" (typeof d.quotedPrice === 'number' && d.quotedPrice > 0),
 * silently substituting a feet-based estimate over the $0 the customer
 * actually saw and approved. Fixed to just check it's a real number —
 * checked both the price-filling logic and the confirmation toast, which
 * had the identical condition duplicated and would otherwise now disagree
 * with what actually happened.
 */
(function () {
  const zeroQuoteBad = (admin.match(/d\.quotedPrice === 'number' && d\.quotedPrice > 0/g) || []).length;
  check('zero-price-quote', 'a $0 quote is no longer treated as "no price set"',
    zeroQuoteBad === 0,
    'found ' + zeroQuoteBad + ' remaining "> 0" check(s) — a comped $0 quote would still get overwritten with a feet-based estimate');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * The $30 light-change fee was a plain read-then-write (invRef.get(), decide,
 * invRef.set()) with no transaction — unlike recordPaypalPayment, which
 * already uses one for exactly this class of race. Two near-simultaneous
 * portalSave('lights', ...) calls (a client-side retry, or a double
 * form-submit before the Save button's disabled state takes effect) could
 * both read the same pre-charge changeFees value and each add $30, double-
 * charging one intended change. Now the read, the free-window decision, and
 * the write all happen inside one db.runTransaction, so a concurrent second
 * call is forced to see the first call's write before deciding anything.
 */
(function () {
  const psStart = fnsSrc.indexOf('exports.portalSave');
  const psSrc = psStart > -1 ? sectionFrom(fnsSrc, psStart) : '';
  check('light-fee-race', 'portalSave found in functions/index.js', psStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('light-fee-race', 'the $30 light-change fee read-decide-write happens inside a transaction',
    /db\.runTransaction\(async \(t\) => \{[\s\S]{0,50}const invSnap = await t\.get\(invRef\)/.test(psSrc),
    'a plain get()-then-set() lets two near-simultaneous saves both read the same pre-charge changeFees and each add $30');
  check('light-fee-race', 'the write inside the transaction uses t.set, not the outer invRef.set',
    /t\.set\(invRef, invWrite, \{ merge: true \}\);/.test(psSrc),
    'writing via invRef.set() instead of t.set() outside the transaction would defeat the whole point of wrapping it');
})();

// =====================================================================
/* ⚠ THE BUG THIS SUITE CATCHES.
 *
 * The lights-change confirm() dialog always warned about a $30 fee, even
 * for a customer genuinely inside their free 48-hour re-edit window — the
 * browser had no way to know that window was still open until AFTER
 * saving (portalSave's response), by which point the warning had already
 * potentially talked them out of clicking Save. Not a money bug — the
 * server-side charge logic was already correct either way — but exactly
 * the kind of customer-facing surprise CLAUDE.md's owner-facing rules want
 * avoided. Fixed by having portalInvoice compute and return
 * lightChangeFreeUntil so the confirm can be skipped when it's genuinely free.
 */
(function () {
  const piStart = fnsSrc.indexOf('exports.portalInvoice');
  const piSrc = piStart > -1 ? sectionFrom(fnsSrc, piStart) : '';
  check('light-fee-warning', 'portalInvoice found in functions/index.js', piStart > -1,
    'renamed or removed — update this test rather than deleting it');
  check('light-fee-warning', 'portalInvoice computes and returns lightChangeFreeUntil',
    /record\.lightChangeFreeUntil = lastFeeAt > 0 \? lastFeeAt \+ \(48 \* 60 \* 60 \* 1000\) : null;/.test(piSrc),
    'without this the browser has no way to know, before saving, whether the 48h free window is still open');

  const idx = read('index.html');
  const saveStart = idx.indexOf('async function saveLightsPattern(){');
  /* Sliced to the function's real end, not a fixed 2,500 characters. The
     window version broke once already elsewhere in this file the moment the
     code it pointed at grew (CLAUDE.md §7). */
  /* ⚠ index.html is CRLF, so a literal '\n}\n' never matches (CLAUDE.md §7) —
     it silently fell back to a fixed window, which is the very thing this was
     replacing. Matched with \r?\n instead. */
  const saveEndM = saveStart > -1 ? /\r?\n\}\r?\n/.exec(idx.slice(saveStart)) : null;
  const saveSrc = saveStart > -1
    ? idx.slice(saveStart, saveEndM ? saveStart + saveEndM.index : idx.length)
    : '';
  check('light-fee-warning', 'saveLightsPattern found in index.html', saveStart > -1,
    'renamed or removed — update this test rather than deleting it');
  /* Asserts the GUARANTEE, not one particular way of writing it. Was
     `/&& !stillInFreeWindow\)/`, which pinned it to a single `if` expression;
     the dialog now warns about two separate things — that a save would WIPE a
     pattern (worth asking regardless of any fee) and that it would COST $30
     (only true outside the free window) — so the free-window test moved inside
     and gates the fee sentence alone. The customer-visible promise is
     unchanged: inside the free window, nobody is warned about a charge. */
  check('light-fee-warning', 'the free window is worked out before saving',
    /stillInFreeWindow/.test(saveSrc) && /lightChangeFreeUntil/.test(saveSrc),
    'the browser has no way to know whether a change is about to cost anything');
  check('light-fee-warning', 'the $30 warning is never shown inside the free window',
    /if\(stillInFreeWindow\)\{[\s\S]{0,400}\} else \{[\s\S]{0,200}\$30 change fee/.test(saveSrc.replace(/\r/g, '')),
    'a customer inside their free re-edit window would be warned about a charge that was never going to happen');
})();

// =====================================================================
// 15. THE PRINTED SCHEDULE — the crew's daily sheet
// =====================================================================
/*
 * The Schedule dashboard lives in a shadow DOM with its own model. On screen
 * it is a day list plus a panel of cards; on paper that is unusable, so each
 * day panel prints a flat table instead — one row per stop, real headings, a
 * tick box, in the order the panel shows them.
 *
 * These checks RUN the real row builder rather than reading it, because the
 * failure that matters is a row silently coming out with a blank name or the
 * stops in the wrong order, and no regex catches that.
 */
suite('15. The printed schedule sheet');
{
  const sheetStart = admin.indexOf('function schedSheetRows(');
  const sheetEnd = admin.indexOf('function schedOpenPrint(', sheetStart);
  if (sheetStart === -1 || sheetEnd < sheetStart) {
    check('schedule', 'the printed-schedule builders are findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    // The builders are pure; everything they lean on is stubbed to something
    // predictable so a wrong ORDER or a missing FIELD shows up as a failure.
    global.dlabel = dt => ({ wd: 'Mon', full: 'Nov 3' });
    global.dayDate = d => d._date;
    global.isoOf = () => '2026-11-03';
    global.fmtPhone = p => '(801) 555-0100';
    global.isNewMemberHouse = h => !!h.isNew;
    global.esc = s => (s || '').toString().replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const api = eval(admin.slice(sheetStart, sheetEnd) +
      '\n;({rows: schedSheetRows, table: schedSheetTable, dayCols: SCHED_DAY_COLUMNS, planCols: SCHED_PLAN_COLUMNS})');

    const day = {
      id: 'd1', _date: new Date(2026, 10, 3), houses: [
        { id: 1, cu: '144', name: 'Alma Reyes', address: '18 Frost Ln', city: 'Lehi',
          phone: '8015550100', price: 450, details: 'Gate code 1234', done: true },
        { id: 2, cu: '', name: 'Jo Park', address: '92 Birch Way', city: 'Lehi',
          phone: '', price: 0, details: '', done: false, isNew: true },
        { id: 3, cu: '5012', name: 'Sam Ito', address: '3 Elm Ct', city: 'Alpine',
          phone: '8015550100', price: 300, details: 'FIX: two strands out', done: false, isFix: true }
      ]
    };
    const rows = api.rows([day]);
    check('schedule', 'one printed row per stop',
      rows.length === 3, 'got ' + rows.length);
    check('schedule', 'the stops keep the order the panel shows them in',
      rows.map(r => r.name).join('|') === 'Alma Reyes|Jo Park|Sam Ito',
      'a crew works down the sheet in order — reordering it sends them back and forth');
    check('schedule', 'stops are numbered from 1, not 0',
      rows[0].stop === 1 && rows[2].stop === 3);
    check('schedule', 'a house with no price prints blank, not $0',
      rows[1].price === '' && rows[0].price === '$450',
      'a house that has not been priced is not a house that is free');
    check('schedule', 'a fix is marked as one on the sheet',
      rows[2].type === 'FIX' && rows[1].type === 'NEW' && rows[0].type === 'INSTALL',
      'the crew treats a fix, a new member and an ordinary install differently');
    check('schedule', 'a stop already ticked off in the app says so',
      rows[0].done === 'done' && rows[1].done === '',
      'without it the crew redoes a house that was finished yesterday');
    check('schedule', 'a house with no phone leaves the cell empty',
      rows[1].phone === '', 'a blank is honest; a formatted empty number is not');

    const table = api.table(rows, api.dayCols, null);
    check('schedule', 'the day sheet is a real table with headings',
      /<thead>/.test(table) && />Address<\/th>/.test(table) && />Stop<\/th>/.test(table),
      'without headings it is not a spreadsheet, it is a wall of text');
    check('schedule', 'every stop gets a tick box',
      (table.match(/<td class="tick">/g) || []).length === 3,
      'the sheet is worked down on a clipboard — there has to be something to tick');
    check('schedule', 'hostile text is escaped on the printed sheet',
      !/<script>/.test(api.table(
        [{ stop: 1, cu: '', name: '<script>alert(1)</script>', address: '', city: '',
           phone: '', type: 'INSTALL', price: '', details: '', done: '' }], api.dayCols, null)),
      'the sheet is written into a new window with document.write');

    /* The whole-plan sheet repeats the date on every row, which is what lets
       it be sorted in a spreadsheet instead of relying on a heading. */
    const planKeys = api.planCols.map(c => c.key);
    check('schedule', 'the whole-plan sheet carries the date and route on every row',
      planKeys[0] === 'date' && planKeys.indexOf('route') > -1 &&
      rows.every(r => r.date && r.route),
      'a date only in a heading row is lost the moment the sheet is sorted');
    check('schedule', 'the day sheet leaves the date columns off',
      api.dayCols.every(c => c.key !== 'date'),
      'the date is already in the heading of a single-day sheet');
  }
}
/* --- two crews, one city each, a sheet each -----------------------------
 * Added 2026-08-14. The city on a house comes off the imported CSV and the
 * plan does not cover the same two towns every day, so the crew↔city pairing
 * defaults to "biggest area that day / second biggest" and can be pinned to a
 * fixed city instead. Whatever falls outside both is counted, never dropped.
 */
{
  /* Starts at cityOf, not at the crew block — crewCityFor leans on cityOf and
     dayAreas, and slicing from the crews alone left them undefined. */
  const crewStart = admin.indexOf('function cityOf(h)');
  const crewEnd = admin.indexOf('/* ---------- build from imported rows', crewStart);
  const sheetStart2 = admin.indexOf('function schedSheetRows(');
  const sheetEnd2 = admin.indexOf('function schedOpenPrint(', sheetStart2);
  const crewRowsStart = admin.indexOf('function crewSheetRows(');
  const crewRowsEnd = admin.indexOf('function printCrewSheet(', crewRowsStart);
  if (crewStart === -1 || crewEnd < crewStart || crewRowsStart === -1 || crewRowsEnd < crewRowsStart) {
    check('schedule', 'the crew helpers are findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    global.dlabel = () => ({ wd: 'Mon', full: 'Nov 3' });
    global.dayDate = d => d._date;
    global.isoOf = () => '2026-11-03';
    global.fmtPhone = p => '(801) 555-0100';
    global.isNewMemberHouse = () => false;
    global.esc = s => (s || '').toString();
    // A season that is NOT the same two towns every day — which is the case
    // the automatic pairing exists for.
    const dayA = { id: 'a', _date: new Date(2026, 10, 3), houses: [
      { name: 'One', city: 'Lehi', price: 1 }, { name: 'Two', city: 'Lehi', price: 1 },
      { name: 'Three', city: 'Alpine', price: 1 }, { name: 'Four', city: 'Draper', price: 1 } ] };
    const dayB = { id: 'b', _date: new Date(2026, 10, 4), houses: [
      { name: 'Five', city: 'Alpine', price: 1 }, { name: 'Six', city: 'Alpine', price: 1 },
      { name: 'Seven', city: 'Lehi', price: 1 } ] };
    global.allHouses = () => dayA.houses.concat(dayB.houses);
    const crew = eval(admin.slice(crewStart, crewEnd) + '\n' +
      admin.slice(sheetStart2, sheetEnd2) + '\n' +
      admin.slice(crewRowsStart, crewRowsEnd) + '\n' +
      ';({norm: normalizeCrews, name: crewName, city: crewCityFor, houses: crewHousesFor,' +
      ' left: unassignedHousesFor, rows: crewSheetRows, cities: planCities,' +
      ' set(l){ CREWS = normalizeCrews(l); }})');

    crew.set(null);
    check('schedule', 'there are exactly two crews, named by default',
      crew.name(0) === 'Crew 1' && crew.name(1) === 'Crew 2',
      'a plan saved before crews existed has to come back with working defaults');
    check('schedule', 'a crew can be renamed',
      crew.norm([{ name: 'Dad + Ty' }, {}])[0].name === 'Dad + Ty');
    check('schedule', 'a name blanked out falls back rather than printing an empty heading',
      crew.norm([{ name: '   ' }, {}])[0].name === 'Crew 1',
      'the crew name is the heading on their sheet — it can never be empty');

    // Auto: crew 1 takes the day's biggest area, crew 2 the second.
    check('schedule', 'left on Auto, each crew takes a different city',
      crew.city(0, dayA) === 'Lehi' && crew.city(1, dayA) !== 'Lehi' && !!crew.city(1, dayA),
      'two crews sent to the same town is two crews doing one crew\'s work');
    check('schedule', 'Auto follows the day, so a different day can be different towns',
      crew.city(0, dayB) === 'Alpine',
      'the plan does not cover the same two towns every day');
    crew.set([{ name: 'A', city: 'Alpine' }, { name: 'B', city: 'Lehi' }]);
    check('schedule', 'a city pinned to a crew wins over Auto',
      crew.city(0, dayA) === 'Alpine' && crew.city(1, dayA) === 'Lehi',
      'a business that always works the same two towns should be able to say so once');
    check('schedule', 'each crew only gets their own city\'s stops',
      crew.houses(0, dayA).length === 1 && crew.houses(1, dayA).length === 2,
      'a crew sheet with somebody else\'s houses on it sends two trucks to one street');
    check('schedule', 'stops in neither crew\'s city are counted, not dropped',
      crew.left(dayA).map(h => h.name).join() === 'Four',
      'a stop nobody holds a sheet for is a stop nobody drives to');

    const rows = crew.rows(dayA, 1);
    check('schedule', 'a crew sheet renumbers the stops from 1 for that crew',
      rows.length === 2 && rows[0].stop === 1 && rows[1].stop === 2,
      'their sheet is their day, not a filtered copy of somebody else\'s numbering');
    check('schedule', 'a crew sheet holds only that crew\'s houses',
      rows.every(r => r.city === 'Lehi'));
    crew.set([{ name: 'A', city: 'Nowhere' }, { name: 'B', city: 'Lehi' }]);
    check('schedule', 'a crew pinned to a city with nothing in it prints nothing, not everything',
      crew.rows(dayA, 0).length === 0,
      'falling back to the whole day would hand them a sheet that is not theirs');
    crew.set(null);
  }
}
check('schedule', 'the crew name is the heading on their sheet',
  /schedOpenPrint\(\s*\r?\n?\s*crewName\(i\)/.test(admin),
  'the first thing anyone does with a printed sheet is work out whose it is');
check('schedule', 'crew names and cities are saved with the plan',
  /crews:CREWS\.map/.test(admin) && /CREWS=normalizeCrews\(o\.crews\)/.test(admin),
  'a rename that does not survive a refresh is not a rename');
check('schedule', 'a day panel offers a sheet per crew',
  admin.includes('data-printcrew="') && /printCrewEl\)\{printCrewSheet/.test(admin));
check('schedule', 'renaming happens on blur, not on every keystroke',
  /crewname!=null/.test(admin) && !/addEventListener\('input'[\s\S]{0,80}crewname/.test(admin),
  're-rendering under the cursor takes the focus away mid-word');

/* The buttons that reach those builders — one on every day panel, and one for
   the whole plan next to Export CSV. */
check('schedule', 'every day panel has a Print This Day button',
  admin.includes('data-printday="') && /printDayEl\)\{printDaySheet/.test(admin),
  'install days, fixer routes and takedowns all render through the same panel');
check('schedule', 'the toolbar can print the whole plan',
  admin.includes('printPlanBtn') && /printPlanBtn'\)\{printWholePlan/.test(admin));
check('schedule', 'the printed sheet uses the same columns as Export CSV',
  ['CU #', 'Name', 'Address', 'City', 'Phone', 'Price', 'Type', 'Details']
    .every(h => admin.includes("label:'" + h + "'")),
  'the paper, the CSV and the screen have to agree about what a stop is');

// =====================================================================
// 16. WHAT DID NOT GET DONE — the misses get another day
// =====================================================================
/*
 * On a normal day nearly every house gets finished, so ticking off the ones
 * that WERE done is the slow way round: Mark all done, untick the few that
 * were missed, then deal with just those. They either go to the next day the
 * truck is already in that town, or get a day picked for each.
 *
 * These RUN the real helpers. The one that matters most is that every target
 * is worked out BEFORE anything moves — deciding them one at a time lets a
 * house land on a day only because the house before it was just put there,
 * which is not "the next day we are already in that city".
 */
suite('16. Not-done stops get another day');
{
  const areaStart = admin.indexOf('function cityOf(h)');
  const areaEnd = admin.indexOf('/* ---------- build from imported rows', areaStart);
  const moveStart = admin.indexOf('function moveLeftover(');
  const moveEnd = admin.indexOf('function moveAllLeftoversAuto(', moveStart);
  if (areaStart === -1 || areaEnd < areaStart || moveStart === -1 || moveEnd < moveStart) {
    check('leftovers', 'the not-done helpers are findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    const D = (id, day, houses, extra) => Object.assign(
      { id, _date: new Date(2026, 10, day), houses }, extra || {});
    let SEASON = [];
    global.dayDate = d => d._date;
    global.dlabel = () => ({ wd: 'Mon', full: 'Nov 3' });
    global.getDay = id => SEASON.find(d => d.id === id);
    global.findHouse = id => {
      for (const d of SEASON) { const h = d.houses.find(x => String(x.id) === String(id));
        if (h) return { house: h, day: d }; }
      return null;
    };
    global.isNewMemberHouse = () => false;
    global.installDays = () => SEASON.filter(d => !d.isFixRoute && !d.isTakedown);
    global.takedownDays = () => SEASON.filter(d => d.isTakedown);
    global.fixerRoutes = () => SEASON.filter(d => d.isFixRoute);
    global.allHouses = () => SEASON.flatMap(d => d.houses);
    const api = eval(admin.slice(areaStart, areaEnd) + '\n' + admin.slice(moveStart, moveEnd) +
      '\n;({left: unfinishedOn, later: laterDaysLike, next: nextDayInCity,' +
      ' plan: planLeftoverMoves, move: moveLeftover})');

    const reset = () => {
      SEASON = [
        D('d1', 3, [ { id: 1, name: 'A', city: 'Lehi', done: true },
                     { id: 2, name: 'B', city: 'Lehi', done: false },
                     { id: 3, name: 'C', city: 'Lehi', done: false },
                     { id: 4, name: 'D', city: 'Draper', done: false } ]),
        D('d2', 4, [ { id: 5, name: 'E', city: 'Alpine', done: false } ]),
        D('d3', 5, [ { id: 6, name: 'F', city: 'Lehi', done: false } ]),
        D('td1', 6, [ { id: 7, name: 'G', city: 'Lehi', done: false } ], { isTakedown: true })
      ];
    };
    reset();
    const d1 = () => SEASON.find(d => d.id === 'd1');

    check('leftovers', 'only the un-ticked stops count as not done',
      api.left(d1()).map(h => h.name).join() === 'B,C,D',
      'the whole point is that the ticked ones are finished and stay put');
    check('leftovers', 'a takedown day is not offered as a home for a missed install',
      api.later(d1()).every(d => !d.isTakedown),
      'a missed install belongs on another install day, not on whatever falls soonest');
    check('leftovers', 'only LATER days are offered',
      api.later(d1()).map(d => d.id).join() === 'd2,d3',
      'rescheduling a miss into the past is not rescheduling');
    check('leftovers', 'the next day in that city is the first later day that already goes there',
      (api.next(d1(), 'Lehi') || {}).id === 'd3',
      'd2 is sooner but nobody is in Lehi that day — the truck would be making a special trip');
    check('leftovers', 'a town no later day covers comes back as nothing, not as a guess',
      api.next(d1(), 'Draper') === null,
      'dumping it on some other day silently is how a house gets driven to twice or never');

    const plan = api.plan(d1());
    check('leftovers', 'every miss is planned, including the one with nowhere to go',
      plan.length === 3 && plan.filter(p => p.target).length === 2,
      'the one that cannot be placed has to stay visible, not be quietly dropped');
    check('leftovers', 'two houses in one town are planned onto the SAME day',
      plan[0].target === plan[1].target && plan[0].target.id === 'd3',
      'targets are worked out before anything moves — chained decisions send the second ' +
      'house to a day that only exists because the first one was just put there');

    plan.filter(p => p.target).forEach(p => api.move(p.house.id, p.target.id));
    check('leftovers', 'the misses really come off the day they were missed on',
      d1().houses.map(h => h.name).join() === 'A,D',
      'the finished house stays, and so does the one with nowhere to go');
    check('leftovers', 'and land on the day they were planned for',
      SEASON.find(d => d.id === 'd3').houses.map(h => h.name).join() === 'F,B,C');
    check('leftovers', 'a moved stop is not silently marked done on the way',
      SEASON.find(d => d.id === 'd3').houses.every(h => !h.done),
      'it was not done — that is the entire reason it moved');
    reset();
    check('leftovers', 'moving a house onto the day it is already on does nothing',
      api.move(2, 'd1') === null && d1().houses.length === 4);
  }
}
/* The button, the panel, and the two ways out of it. */
check('leftovers', 'Mark all done is still there',
  admin.includes('data-allbtn='),
  'the fast path is: mark the whole day done, then untick the few that were missed');
/* CHANGED 2026-08-15. This used to assert the opposite — that the button was
   HIDDEN until at least one house had been ticked off, on the reasoning that
   every stop on an untouched day is "not done" so the button meant nothing.
   That reasoning was wrong in practice: it made the entire feature invisible
   unless the office happened to press Mark all done first, which is a thing
   nobody does on a day where most houses got finished. The button now sits
   next to Mark all done on any day with something outstanding, and the panel
   asks which ones were missed when nobody has said. */
check('leftovers', 'the reschedule button is there on any day with something left',
  /\(n&&left>0\)\?'<button class="mini warn" data-leftover=/.test(admin),
  'hidden until a box was ticked, the whole feature was invisible on an untouched day');
check('leftovers', 'and says so in plain words before anything is ticked',
  admin.includes("'Not all of them got '+(td?'removed':'done')"),
  '"3 not done" means nothing on a day where nobody has recorded anything yet');
check('leftovers', 'a finished day offers no reschedule button at all',
  /\(n&&left>0\)\?/.test(admin),
  'left>0 is the guard — nothing outstanding, nothing to reschedule');
check('leftovers', 'ticking on the pick step is read BEFORE the ordinary done tick',
  admin.indexOf('t.dataset.lpick!=null') > -1 &&
  admin.indexOf('t.dataset.lpick!=null') < admin.indexOf("t.type==='checkbox'&&t.dataset.id"),
  'both are checkboxes; the other handler would mark the house DONE, the exact ' +
  'opposite of what a tick means on the "which ones were missed" step');
check('leftovers', 'there is a way back to the tick list without starting over',
  admin.includes('data-lrepick="'),
  'the list of misses is only as right as the ticks behind it');
check('leftovers', 'the panel offers both ways out',
  admin.includes('data-lauto="') && admin.includes('data-leach="'),
  'automatically to the next day in that city, or pick a day for each');
check('leftovers', 'picking a day inside the panel does not jump the screen away',
  /t\.dataset\.lmove&&t\.value/.test(admin) && /moveLeftover\(t\.dataset\.lmove/.test(admin),
  'the ordinary move dropdown switches to the target day, which loses your place in the list');
check('leftovers', 'the panel closes itself once nothing is left',
  /if\(!day\|\|!list\.length\)\{[\s\S]{0,120}leftoverFor=null/.test(admin),
  'an empty list sitting on screen reads as "something went wrong"');

/* The "which ones were missed?" step, RUN rather than read. What matters is
   which step the panel opens on and what Continue writes back — both are
   decisions, and a regex cannot tell a right one from a wrong one. */
{
  const areaStart = admin.indexOf('function cityOf(h)');
  const areaEnd = admin.indexOf('/* ---------- build from imported rows', areaStart);
  const stateStart = admin.indexOf('let leftoverFor=null;');
  const stateEnd = admin.indexOf('function renderLeftovers(', stateStart);
  if (areaStart === -1 || stateStart === -1 || stateEnd < stateStart) {
    check('leftovers', 'the pick-step helpers are findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    let SEASON = [];
    global.dayDate = d => d._date;
    global.dlabel = () => ({ wd: 'Mon', full: 'Nov 3' });
    global.getDay = id => SEASON.find(d => d.id === id);
    global.installDays = () => SEASON.filter(d => !d.isFixRoute && !d.isTakedown);
    global.takedownDays = () => SEASON.filter(d => d.isTakedown);
    global.fixerRoutes = () => SEASON.filter(d => d.isFixRoute);
    global.allHouses = () => SEASON.flatMap(d => d.houses);
    global.renderLeftovers = () => {};
    global.renderAll = () => {};
    global.toast = m => { global._toast = m; };
    const api = eval(admin.slice(areaStart, areaEnd) + '\n' +
      admin.slice(stateStart, stateEnd) +
      '\n;({open: openLeftovers, apply: applyLeftoverPicks,' +
      ' mode: () => leftoverMode, picked: () => leftoverPicked,' +
      ' pick: id => leftoverPicked.add(String(id))})');

    const day = (houses, extra) => Object.assign(
      { id: 'd1', _date: new Date(2026, 10, 3), houses }, extra || {});
    const fresh = () => [ { id: 1, name: 'A', city: 'Lehi', done: false },
                          { id: 2, name: 'B', city: 'Lehi', done: false },
                          { id: 3, name: 'C', city: 'Draper', done: false } ];

    SEASON = [ day(fresh()) ];
    api.open('d1');
    check('leftovers', 'a day nobody has ticked opens on "which ones were missed?"',
      api.mode() === 'pick',
      'nobody has said which houses got done, so there is nothing to reschedule yet');
    check('leftovers', 'and starts with NOTHING ticked as a miss',
      api.picked().size === 0,
      'on a normal day far more houses get finished than missed — pre-ticking them ' +
      'all as misses is the wrong way round and means unticking almost every one');

    const part = fresh(); part[0].done = true;
    SEASON = [ day(part) ];
    api.open('d1');
    check('leftovers', 'a part-ticked day skips the question and goes to the two choices',
      api.mode() === 'ask',
      'the office already answered it by ticking — asking again slows down the path that worked');
    check('leftovers', 'carrying over exactly the houses still un-ticked',
      [...api.picked()].sort().join() === '2,3');

    SEASON = [ day(fresh()) ];
    api.open('d1');
    api.pick(2);
    api.apply('d1');
    check('leftovers', 'Continue marks the ticked house not done and every other one done',
      SEASON[0].houses.map(h => h.name + (h.done ? ':done' : ':miss')).join() === 'A:done,B:miss,C:done',
      'a tick on this step means NOT finished — the opposite of the tick boxes on the day itself');
    check('leftovers', 'and hands over to the two ways out',
      api.mode() === 'ask');

    global._toast = '';
    SEASON = [ day(fresh()) ];
    api.open('d1');
    api.apply('d1');
    check('leftovers', 'ticking nothing means the whole day was finished',
      SEASON[0].houses.every(h => h.done) && /marked done/.test(global._toast || ''),
      'Continue has to write BOTH sides — an unticked house becomes done even if it ' +
      'was never touched, or the panel says "nobody was missed" and changes nothing');

    /* The reverse write: a house wrongly marked done earlier, ticked here as a
       miss, has to come back OFF done. Only writing the misses would leave it
       counted as finished and it would never be rescheduled. */
    const wrong = fresh(); wrong.forEach(h => h.done = true);
    SEASON = [ day(wrong) ];
    api.open('d1');
    api.pick(3);
    api.apply('d1');
    check('leftovers', 'a house wrongly marked done comes back off done when ticked as a miss',
      SEASON[0].houses.map(h => h.done).join() === 'true,true,false');
  }
}

// =====================================================================
suite('17. A new customer lands on the next day in their city');
/*
 * The rule, in the owner's words: a new customer goes on the next day we are in
 * their city — unless they asked for November and it is still October, in which
 * case they go on the FIRST day we are in that city in November.
 *
 * The dates are real logic and are tested as such, not by regex. Everything here
 * is written to be date-independent: the assertions compute what the answer
 * should be from today's date rather than hard-coding a month, so they still
 * mean something in December and next season.
 */
{
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nov1  = new Date(now.getFullYear(), 10, 1);

  eval(extractFn(admin, 'thanksgivingDate'));
  eval(extractFn(admin, 'earliestAllowedInstallDate'));
  eval(extractFn(admin, 'extractCleanCity'));
  eval(extractFn(admin, 'toDateStr'));
  eval(extractFn(admin, 'nextDayStr'));
  eval(extractFn(admin, 'routeCityOf'));
  eval(extractFn(admin, 'findNextRouteDayInCity'));

  check('autosched', 'earliestAllowedInstallDate exists',
    typeof earliestAllowedInstallDate === 'function',
    'renamed or removed — the November rule lives in it');

  // ---- 17.1 The timing preference decides the earliest date ---------------
  check('autosched', 'a normal-schedule house can go out today',
    earliestAllowedInstallDate({installPreference:'Normal Schedule'}).getTime() === today.getTime());
  check('autosched', 'an October house can go out today',
    earliestAllowedInstallDate({installPreference:'October'}).getTime() === today.getTime(),
    'October houses are the ones that must NOT be held back');
  check('autosched', 'a house with no preference at all can go out today',
    earliestAllowedInstallDate({}).getTime() === today.getTime());

  const novWant = today > nov1 ? today : nov1;
  check('autosched', 'a November house waits for November 1',
    earliestAllowedInstallDate({installPreference:'November'}).getTime() === novWant.getTime());
  check('autosched', 'a November-before-Thanksgiving house also waits for November 1',
    earliestAllowedInstallDate({installPreference:'November - Before Thanksgiving'}).getTime() === novWant.getTime());
  /* THE RULE, stated as the invariant it actually is. True in every month:
     before Nov 1 the answer is Nov 1, after it the answer is today, and neither
     of those can ever be a day in October. */
  check('autosched', 'a November house is NEVER given a date in October',
    earliestAllowedInstallDate({installPreference:'November'}).getMonth() !== 9 &&
    earliestAllowedInstallDate({installPreference:'November - Before Thanksgiving'}).getMonth() !== 9,
    'this is the whole point of the rule — added in October, hung in November');

  const tg = thanksgivingDate(now.getFullYear());
  const dayAfter = new Date(tg.getFullYear(), tg.getMonth(), tg.getDate() + 1);
  check('autosched', 'an after-Thanksgiving house waits for the day after Thanksgiving',
    earliestAllowedInstallDate({installPreference:'After Thanksgiving'}).getTime() ===
      (today > dayAfter ? today : dayAfter).getTime());

  // A staff-only earliestInstallDate outranks the customer's own preference.
  const farOff = new Date(now.getFullYear() + 1, 5, 9);
  check('autosched', 'a staff-set earliest date beats the timing preference',
    earliestAllowedInstallDate({installPreference:'October', earliestInstallDate: farOff}).getTime() === farOff.getTime(),
    'the staff date is the one restriction the customer cannot see or override');
  check('autosched', 'a staff date already in the past never pulls the answer backwards',
    earliestAllowedInstallDate({installPreference:'Normal Schedule',
      earliestInstallDate: new Date(now.getFullYear() - 1, 0, 1)}).getTime() === today.getTime());

  // ---- 17.2 Finding the next day the crew is in that city ----------------
  /* Two towns, several days, plus a fix day and a removal day that must not
     count — the crew being in Lehi to fix something is not an install day. */
  global.jobAddresses = [
    {id:'a1', data:{city:'Lehi'}},   {id:'a2', data:{city:'Lehi'}},
    {id:'b1', data:{city:'Orem'}},   {id:'b2', data:{city:'Orem'}},
    /* "Lehi 84043" is the messy-but-real form extractCleanCity cleans up. Note
       "Lehi, UT 84043" is NOT — that one comes back blank, because the function
       takes the LAST comma segment (it was written for "123 Main St, Lehi").
       A customer stored that way has no clean city and is reported as such
       rather than being dropped onto some other town's day. */
    {id:'c1', data:{city:'Lehi 84043'}}
  ];
  global.scheduledRoutesCache = {
    '2026-10-05': [{id:'r-oct-lehi',  date:'2026-10-05', type:'install', crew:'1', stops:[{id:'a1'},{id:'a2'}]}],
    '2026-10-08': [{id:'r-oct-orem',  date:'2026-10-08', type:'install', crew:'1', stops:[{id:'b1'},{id:'b2'}]}],
    '2026-10-12': [{id:'r-fix-lehi',  date:'2026-10-12', type:'fix',     crew:'1', stops:[{id:'a1'}]},
                   {id:'r-rem-lehi',  date:'2026-10-12', type:'removal', crew:'1', stops:[{id:'a2'}]}],
    '2026-11-03': [{id:'r-nov-lehi',  date:'2026-11-03', type:'install', crew:'1', stops:[{id:'c1'}]}],
    '2026-11-19': [{id:'r-nov2-lehi', date:'2026-11-19', type:'install', crew:'1', stops:[{id:'a1'}]}]
  };

  check('autosched', 'a route knows which city it is in, from the houses on it',
    routeCityOf(global.scheduledRoutesCache['2026-10-05'][0]) === 'Lehi' &&
    routeCityOf(global.scheduledRoutesCache['2026-10-08'][0]) === 'Orem',
    'a stop snapshot has never carried a city, so it is read back off the customer');
  check('autosched', 'a messy city field still matches the clean city name',
    routeCityOf(global.scheduledRoutesCache['2026-11-03'][0]) === 'Lehi',
    '"Lehi, UT 84043" and "Lehi" are the same town');

  const oct1 = '2026-10-01';
  check('autosched', 'the earliest matching day in that city wins',
    (findNextRouteDayInCity('Lehi', oct1, []) || {}).id === 'r-oct-lehi');
  check('autosched', 'a day in a different city is not offered',
    (findNextRouteDayInCity('Orem', oct1, []) || {}).id === 'r-oct-orem');
  check('autosched', 'a fix or removal day does not count as being in that city',
    (findNextRouteDayInCity('Lehi', '2026-10-10', []) || {}).id === 'r-nov-lehi',
    'the crew going back to fix one house is not an install day');
  check('autosched', 'a day already passed is never offered',
    (findNextRouteDayInCity('Lehi', '2026-11-10', []) || {}).id === 'r-nov2-lehi');
  check('autosched', 'a city we are never in again returns nothing, rather than guessing',
    findNextRouteDayInCity('Provo', oct1, []) === null &&
    findNextRouteDayInCity('Lehi', '2027-01-01', []) === null,
    'putting them on a day in the wrong town is worse than leaving them for the next generate');
  check('autosched', 'the day somebody is being bumped OFF is skippable',
    (findNextRouteDayInCity('Lehi', oct1, ['r-oct-lehi']) || {}).id === 'r-nov-lehi');
  check('autosched', 'no city means no guess',
    findNextRouteDayInCity('', oct1, []) === null);

  // ---- 17.3 The November rule, end to end --------------------------------
  /* The two halves joined up: a November customer looking for a Lehi day from
     Nov 1 onwards gets the November day, NOT the October one that is sooner. */
  const novEarliest = toDateStr(new Date(2026, 10, 1));
  check('autosched', 'a November house skips the sooner October day in the same city',
    (findNextRouteDayInCity('Lehi', novEarliest, []) || {}).id === 'r-nov-lehi',
    'THE RULE: added in October, asked for November, hung in November');
  check('autosched', 'an October house in the same city takes the October day',
    (findNextRouteDayInCity('Lehi', toDateStr(new Date(2026, 9, 1)), []) || {}).id === 'r-oct-lehi');

  check('autosched', 'the next day after a route is the day after, not the same day',
    nextDayStr('2026-10-05') === '2026-10-06' && nextDayStr('2026-10-31') === '2026-11-01',
    'a bumped customer landing back on the day they were bumped off is an infinite shuffle');

  delete global.jobAddresses;
  delete global.scheduledRoutesCache;
}

// ---- 17.4 How it is wired in, and what it must never do -----------------
{
  const autoSrc = admin.slice(admin.indexOf('async function autoScheduleNewCustomer'),
                              admin.indexOf('function nextDayStr'));
  check('autosched', 'adding a customer puts them on a route',
    /autoScheduleNewCustomer\(newAddrRef\.id/.test(admin),
    'the whole feature is unreachable if nothing calls it');
  check('autosched', 'a house with no map pin is never put on a route',
    /typeof d\.lat !== 'number'/.test(autoSrc),
    'a stop with no coordinates breaks the driving order for everyone else on that day');
  check('autosched', 'failing to schedule can never lose the customer record',
    /catch\(err\)\{[\s\S]{0,400}Could not put them on a route automatically/.test(autoSrc.replace(/\r/g,'')) &&
    admin.indexOf('const autoSched = await autoScheduleNewCustomer') > admin.indexOf('const newAddrRef = await addDoc'),
    'the customer and their invoice must survive a scheduling problem');
  check('autosched', 'every outcome comes back as something to say, not silence',
    (autoSrc.match(/return \{done:/g) || []).length >= 4,
    'a customer who quietly did not get scheduled is the bug this feature exists to fix');
  check('autosched', 'the new house is marked as new on the route',
    /addedNew/.test(admin),
    'the crew needs to see who turned up after the day was planned');
  check('autosched', 'an existing customer is only moved if there is a later day for them',
    /bumpTo = findNextRouteDayInCity/.test(autoSrc) && /if\(bumped && bumpTo\)/.test(autoSrc),
    'leaving somebody unscheduled to make room for a newcomer is worse than a day one house bigger');
  check('autosched', 'a house that was moved raises a System notice',
    /noticeCustomerPushedBack/.test(autoSrc) && /folder: 'System'/.test(admin),
    'their day changed and nobody told them — that has to reach the office');
  /* Same guarantee, new shape. The bump moved from a hand-rolled backwards scan
     to bumpCandidateIndex over a pre-filtered list on 2026-08-15, when the rule
     became "only over forty" — so this now asserts the filter that keeps the
     newcomer and anyone else added late out of the running. */
  check('autosched', 'a house added new is never itself the one bumped',
    /s\.id !== custId && !s\.addedNew/.test(autoSrc),
    'two customers added in a row would just push each other around');
  check('autosched', 'and the one that goes is chosen by the same rule the sweep uses',
    /bumpCandidateIndex\(pickable/.test(autoSrc),
    'two copies of "who gets bumped" that can disagree is how the office sees the ' +
    'cap move one house at Add Customer time and a different one fifteen minutes later');
  check('autosched', 'the November rule is driven by the same dates that hide them from route generation',
    /Mirrors isInstallPrefLocked/.test(admin),
    'two copies of the November cutoff that can disagree is how a house goes out in the wrong month');
}

// =====================================================================
/*
 * Suite 18. The upcoming routes reconcile themselves.
 *
 * A saved route is a snapshot that goes stale: somebody says no, an address is
 * corrected, a house is installed early, a customer is deleted. This sweep is
 * what keeps the crew's days true, so it is EXECUTED here rather than pattern
 * matched — the whole function is run against a fake Firestore that records
 * every write, exactly the way suite 10 runs syncPayerInvoice.
 *
 * Every date is relative to today, so these still mean something next season.
 */
{
  const recStart = admin.indexOf('const RECONCILE_INTERVAL_MS');
  const recEnd = admin.indexOf('function scheduledFieldForType');
  const NEEDED = ['thanksgivingDate','earliestAllowedInstallDate','extractCleanCity','toDateStr',
                  'formatDateNice','routeCityOf','findNextRouteDayInCity','customerToStop',
                  'haversine','twoOptImprove','reorderFlatStops','nextDayStr',
                  'scheduledFieldForType','freeUpFieldForType'];

  if (recStart === -1 || recEnd < recStart) {
    check('reconcile', 'the route reconciler is findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    const helpers = NEEDED.map(n => extractFn(admin, n)).join('\n');
    const src = helpers + '\n' + admin.slice(recStart, recEnd);

    const dstr = n => { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); };

    // A fake Firestore that records writes instead of making them.
    function makeRec(houses, cache) {
      const writes = [];   // {path, payload}
      const added = [];    // documents added to a collection
      const ctx = {
        db: {},
        doc: (...a) => ({ __path: a.slice(1).join('/') }),
        collection: (...a) => ({ __col: a[1] }),
        serverTimestamp: () => '__ts__',
        updateDoc: async (ref, payload) => { writes.push({ path: ref.__path, payload }); },
        addDoc: async (col, payload) => { added.push({ col: col.__col, payload }); },
        jobAddresses: houses,
        scheduledRoutesCache: cache,
        console: { error(){}, warn(){}, log(){} }
      };
      const names = Object.keys(ctx);
      const api = new Function(...names, src +
        '\nreturn {reconcile: reconcileUpcomingRoutes, problem: stopProblem, drifted: stopDrifted,' +
        ' upcoming: upcomingInstallRoutes};')(...names.map(n => ctx[n]));
      return { api, writes, added };
    }

    // ---- 18.1 stopProblem — why a house should not be on a day -------------
    {
      const h = makeRec([], {}).api;
      const soon = dstr(5);
      check('reconcile', 'a house that is simply due is left alone',
        h.problem({data:{}}, soon) === '');
      check('reconcile', 'a stop whose customer no longer exists is a problem',
        /no longer a customer/.test(h.problem(null, soon)));
      check('reconcile', 'a customer sitting out the season is a problem',
        /sitting out/.test(h.problem({data:{maybeNextYear:true}}, soon)));
      check('reconcile', 'a customer who said no is a problem',
        /said no/.test(h.problem({data:{rsvpStatus:'no'}}, soon)) &&
        /said no/.test(h.problem({data:{rsvpStatus:'backnextyear'}}, soon)));
      check('reconcile', 'a house already installed is a problem on an install day',
        /already installed/.test(h.problem({data:{completed:true}}, soon)));
      check('reconcile', 'a house cannot sit on a day earlier than its timing allows',
        /cannot be installed until/.test(
          h.problem({data:{earliestInstallDate: new Date(Date.now() + 30*86400000)}}, soon)),
        'this is the November rule holding AFTER the customer is already on a route');
      check('reconcile', 'drift is judged on the fields the crew actually drives with',
        h.drifted({address:'1 A St', name:'Kim'}, {address:'1 A St', name:'Kim'}) === false &&
        h.drifted({address:'1 A St'}, {address:'2 B St'}) === true);
    }

    // ---- 18.2 The sweep itself ---------------------------------------------
    /* Two upcoming Lehi days and one Orem day, plus a past day, a fix day and a
       removal day that must all be left alone. */
    const buildCase = () => {
      const houses = [
        {id:'ok',    data:{name:'Fine House',  city:'Lehi', address:'1 Fine St', lat:40.4, lng:-111.8, rsvpStatus:'yes'}},
        {id:'said',  data:{name:'Said No',     city:'Lehi', address:'2 No St',   lat:40.4, lng:-111.8, rsvpStatus:'no'}},
        {id:'drift', data:{name:'Moved House', city:'Lehi', address:'9 NEW Rd',  lat:40.4, lng:-111.8, rsvpStatus:'yes'}},
        {id:'dupe',  data:{name:'Twice Booked',city:'Lehi', address:'4 Two Way', lat:40.4, lng:-111.8, rsvpStatus:'yes'}},
        {id:'late',  data:{name:'Later Please',city:'Lehi', address:'5 Wait Ln', lat:40.4, lng:-111.8, rsvpStatus:'yes',
                           earliestInstallDate: new Date(Date.now() + 9*86400000)}},
        {id:'strand',data:{name:'Left Over',   city:'Lehi', address:'6 Miss Ct', lat:40.4, lng:-111.8, rsvpStatus:'yes',
                           scheduled:true, scheduledDate: dstr(-9)}},
        {id:'nocity',data:{name:'No Town',     city:'',     address:'7 Lost Way',lat:40.4, lng:-111.8, rsvpStatus:'yes',
                           scheduled:true, scheduledDate: dstr(-9)}},
        {id:'done',  data:{name:'All Done',    city:'Lehi', address:'8 Done Dr', lat:40.4, lng:-111.8, rsvpStatus:'yes',
                           scheduled:true, scheduledDate: dstr(-9), completed:true}}
      ];
      const cache = {};
      cache[dstr(-20)] = [{id:'past', date:dstr(-20), type:'install', crew:'1',
        stops:[{id:'said', name:'Said No', address:'2 No St', lat:40.4, lng:-111.8}]}];
      cache[dstr(3)] = [
        {id:'soonLehi', date:dstr(3), type:'install', crew:'1', stops:[
          {id:'ok',    name:'Fine House',  address:'1 Fine St', lat:40.4, lng:-111.8, difficulty:'Unrated',
           phone:'', gateCode:'', specificOutlet:'', specificOutletNotes:'', customerNumber:''},
          {id:'said',  name:'Said No',     address:'2 No St',   lat:40.4, lng:-111.8},
          {id:'gone',  name:'Deleted Guy', address:'3 Gone Av', lat:40.4, lng:-111.8},
          {id:'drift', name:'Moved House', address:'9 OLD Rd',  lat:40.4, lng:-111.8},
          {id:'dupe',  name:'Twice Booked',address:'4 Two Way', lat:40.4, lng:-111.8},
          {id:'late',  name:'Later Please',address:'5 Wait Ln', lat:40.4, lng:-111.8}
        ]},
        {id:'fixday', date:dstr(3), type:'fix', crew:'1',
          stops:[{id:'said', name:'Said No', address:'2 No St', lat:40.4, lng:-111.8}]},
        {id:'remday', date:dstr(3), type:'removal', crew:'1',
          stops:[{id:'done', name:'All Done', address:'8 Done Dr', lat:40.4, lng:-111.8}]}
      ];
      cache[dstr(14)] = [{id:'lateLehi', date:dstr(14), type:'install', crew:'1',
        stops:[{id:'dupe', name:'Twice Booked', address:'4 Two Way', lat:40.4, lng:-111.8}]}];
      return {houses, cache};
    };

    pendingAsync.push((async () => {
      suite('18. The upcoming routes reconcile themselves');
      const c = buildCase();
      const h = makeRec(c.houses, c.cache);
      let threw = null, report = null;
      try { report = await h.api.reconcile(); } catch (e) { threw = e; }

      check('reconcile', 'the sweep runs without throwing',
        threw === null,
        threw ? ('it threw ' + threw.message + ' — the routes then silently never reconcile') : undefined);
      if (threw) return;

      const routeWrite = id => h.writes.filter(w => w.path === 'scheduledRoutes/' + id).pop();
      const custWrite  = id => h.writes.filter(w => w.path === 'jobAddresses/' + id).pop();
      const soon = routeWrite('soonLehi');
      const soonIds = soon ? soon.payload.stops.map(s => s.id) : [];

      check('reconcile', 'a past day is never edited — it is the record of what the crew was sent out with',
        !routeWrite('past'),
        'rewriting history makes it impossible to answer "what did we actually send them to do?"');
      check('reconcile', 'a fix day is left alone',
        !routeWrite('fixday'), 'a fix visit has its own lifecycle and its own eligibility');
      check('reconcile', 'a removal day keeps its completed house',
        !routeWrite('remday'), 'a house that IS installed is exactly who belongs on a takedown');

      check('reconcile', 'the upcoming day was rewritten', !!soon);
      check('reconcile', 'a customer who said no comes off the day',
        soonIds.indexOf('said') === -1);
      check('reconcile', 'a stop whose customer was deleted comes off the day',
        soonIds.indexOf('gone') === -1,
        'the crew was being sent to a house that is not in the book any more');
      check('reconcile', 'the house that is fine stays exactly where it is',
        soonIds.indexOf('ok') !== -1);
      check('reconcile', 'a house booked on two days keeps only the earlier one',
        soonIds.indexOf('dupe') !== -1 &&
        (routeWrite('lateLehi') || {payload:{stops:[]}}).payload.stops.every(s => s.id !== 'dupe'),
        'two stops for one house means one crew drives to an empty job');

      const driftStop = (soon ? soon.payload.stops : []).find(s => s.id === 'drift');
      check('reconcile', 'a stop is refreshed when the customer record moved on',
        !!driftStop && driftStop.address === '9 NEW Rd',
        'the crew drives to the address that was true a fortnight ago');
      check('reconcile', 'refreshing a stop is counted and reported',
        report.refreshed >= 1);

      check('reconcile', 'a house that cannot be installed that soon is taken off',
        soonIds.indexOf('late') === -1,
        'THE NOVEMBER RULE, holding after the fact — a preference changed since the day was built');
      check('reconcile', 'and is put on a later day it IS allowed on',
        (custWrite('late') || {payload:{}}).payload.scheduledDate === dstr(14) &&
        ((routeWrite('lateLehi') || {payload:{stops:[]}}).payload.stops || []).some(s => s.id === 'late'),
        'taking it off without rebooking it is just losing the customer more slowly');

      check('reconcile', 'a house stranded on a day that has been and gone is rescued',
        (custWrite('strand') || {payload:{}}).payload.scheduledDate === dstr(3),
        'route generation only looks at UNSCHEDULED houses, so these are invisible to every tool');
      check('reconcile', 'a completed house is never dragged back onto a route',
        !custWrite('done') || custWrite('done').payload.scheduled !== true);
      check('reconcile', 'a stranded house with nowhere to go is handed back to the pool',
        (custWrite('nocity') || {payload:{}}).payload.scheduled === false &&
        report.freed.some(f => f.name === 'No Town'),
        'leaving it pointing at a day it is not on is how it stays invisible forever');

      check('reconcile', 'everything that changed is reported, not just done',
        report.changed === true && report.dropped.length >= 3 && report.moved.length >= 1);
      check('reconcile', 'one System notice for the whole sweep, not one per house',
        h.added.filter(a => a.col === 'messages').length === 1,
        'a sweep that tidies twelve things must not put twelve notices in front of somebody');
      const note = (h.added.find(a => a.col === 'messages') || {payload:{}}).payload;
      check('reconcile', 'the notice goes to the System folder and names names',
        note.folder === 'System' && /Left Over|Said No|No Town/.test(note.message || ''),
        'a notice nobody can act on is noise');

      // ---- 18.3 Nothing to do must cost nothing ---------------------------
      const clean = {
        houses: [{id:'ok', data:{name:'Fine House', city:'Lehi', address:'1 Fine St',
                                 lat:40.4, lng:-111.8, rsvpStatus:'yes'}}],
        cache: {}
      };
      clean.cache[dstr(3)] = [{id:'cleanDay', date:dstr(3), type:'install', crew:'1', stops:[
        {id:'ok', name:'Fine House', address:'1 Fine St', lat:40.4, lng:-111.8, difficulty:'Unrated',
         phone:'', gateCode:'', specificOutlet:'', specificOutletNotes:'', customerNumber:''}
      ]}];
      const h2 = makeRec(clean.houses, clean.cache);
      const clean2 = await h2.api.reconcile();
      check('reconcile', 'a set of routes that is already right writes NOTHING',
        h2.writes.length === 0 && h2.added.length === 0 && clean2.changed === false,
        'this runs every fifteen minutes in four browsers — the normal case has to be free');
    })());
  }
}

// ---- 18.4 How it is wired in -------------------------------------------
check('reconcile', 'the sweep starts itself, like the health check does',
  /startReconcileAuto\(\);/.test(admin) && /setInterval\(runReconcileAuto, RECONCILE_INTERVAL_MS\)/.test(admin),
  'a reconciler nobody runs is a reconciler that does nothing');
check('reconcile', 'the sweep can never take the page down with it',
  /reconcileUpcomingRoutes\(\)[\s\S]{0,600}\.catch\(function\(err\)\{/.test(admin.replace(/\r/g,'')),
  'a background job that throws must not break the dashboard it runs behind');
check('reconcile', 'two sweeps can never overlap',
  /if\(reconcileRunning\) return;/.test(admin),
  'a second pass reading the first one\'s half-finished writes would double-move houses');
check('reconcile', 'houses left over are given a grace period before being moved',
  /LEFTOVER_GRACE_DAYS/.test(admin),
  'the office marks a day done the next morning — same-night moves would move finished houses');

// =====================================================================
// 18. FORTY HOUSES A DAY, AND THE CASCADE WHEN ONE RUNS OVER
// =====================================================================
/*
 * Owner's rules, 2026-08-15:
 *   - never more than 40 houses on one day; the 41st is pushed back to the next
 *     time the crew is in that city;
 *   - the house that moves is one of last year's, not the new hang, because the
 *     newcomer is the reason the day is full and has never been hung;
 *   - a new hang that is on no day at all gets put on one automatically;
 *   - a day with no later day in its city is allowed to go over, loudly.
 *
 * evenOutDays is deliberately PURE so all of that can be RUN here rather than
 * regexed. A rescheduler that is only read as text is a rescheduler nobody has
 * proved moves the right house.
 */
suite('18. Forty houses a day');
{
  const capStart = admin.indexOf('const MAX_STOPS_PER_DAY');
  const capEnd = admin.indexOf('/* The sweep. Returns a plain-English report', capStart);
  if (capStart === -1 || capEnd < capStart) {
    check('cap', 'the day-cap helpers are findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    /* latestPreferredInstallDate reaches for thanksgivingDate, which lives
       elsewhere in the page. Stubbed rather than lifted: this suite is about
       who moves and where, not about what date Thanksgiving falls on — that is
       suite 17's job, and testing it twice means fixing it twice. */
    global.thanksgivingDate = y => new Date(y, 10, 26);
    global.toDateStr = dt => dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    const api = eval(admin.slice(capStart, capEnd) +
      '\n;({even: evenOutDays, fill: fillDays, pick: bumpCandidateIndex,' +
      ' max: MAX_STOPS_PER_DAY, budget: MAX_FILL_MOVES_PER_SWEEP,' +
      ' inWindow: stillInWindow, latest: latestPreferredInstallDate, isNew: isNewHangHouse})');

    check('cap', 'the cap is forty', api.max === 40);
    const yes = () => true;   // "everybody is allowed on every day", for the cap tests

    /* Everybody returning except #3, which is a new hang. */
    const people = {};
    const stops = (n, city, newIdx) => Array.from({ length: n }, (_, i) => {
      const id = city + i;
      people[id] = { chargeNewMemberFee: (newIdx || []).indexOf(i) !== -1 };
      return { id: id, name: city + ' ' + i };
    });
    const look = id => people[id];

    check('cap', 'the house that moves is one of last year\'s, not the new hang',
      (() => { const s = stops(3, 'L', [2]); return api.pick(s, look) === 1; })(),
      'last in driving order among returning customers — the newcomer keeps the day ' +
      'they were promised, which is the whole reason the day is full');
    check('cap', 'a day of nothing but new hangs still gives somebody up',
      (() => { const s = stops(3, 'L', [0, 1, 2]); return api.pick(s, look) === 2; })(),
      'the cap still has to be met; refusing to pick would leave the day over');
    check('cap', 'an empty day offers nobody', api.pick([], look) === -1);

    // ---- a day of 41 sheds exactly one, onto the next day in that city ----
    let days = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(41, 'a') },
      { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: [] }
    ];
    let out = api.even(days, look);
    check('cap', '41 becomes 40 and the extra one lands on the next Lehi day',
      days[0].stops.length === 40 && days[1].stops.length === 1 && out.moves.length === 1,
      'this is the rule in one line: whenever there is 41, one gets pushed back');
    check('cap', 'and it is the LAST house in driving order that goes',
      days[1].stops[0].id === 'a40');
    check('cap', 'a day under the cap is left completely alone',
      (() => {
        const d = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(12, 'b') },
                   { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: [] }];
        const r = api.even(d, look);
        return d[0].stops.length === 12 && d[1].stops.length === 0 && r.moves.length === 0;
      })(),
      'the cap is a ceiling, not a quota — nothing drags houses forward to fill a light day');

    // ---- the cascade: an overfull day tips the day after it over too -------
    days = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(45, 'c') },
      { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: stops(38, 'd') },
      { id: 'r3', date: '2026-11-09', city: 'Lehi', stops: [] }
    ];
    out = api.even(days, look);
    check('cap', 'a day that tips over because of what the day before it shed is evened out too',
      days[0].stops.length === 40 && days[1].stops.length === 40 && days[2].stops.length === 3,
      'this is the cascade — 45 sheds 5 onto a day of 38, which is then 43 and sheds 3');
    check('cap', 'nobody is lost or duplicated in the shuffle',
      (() => {
        const all = days.flatMap(d => d.stops.map(s => s.id));
        return all.length === 83 && new Set(all).size === 83;
      })(),
      'a rescheduler that drops a house is worse than one that never ran');

    // ---- another city's day is not "the next time we are in that city" -----
    days = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(41, 'e') },
      { id: 'r2', date: '2026-11-03', city: 'Orem', stops: [] }
    ];
    out = api.even(days, look);
    check('cap', 'an Orem day is never offered as room for a Lehi house',
      days[0].stops.length === 41 && days[1].stops.length === 0 && out.over.length === 1,
      'the whole point of "the next time we are in that city" is that the truck is going anyway');
    check('cap', 'a day with nowhere to send anyone goes over, and says so',
      out.over[0].date === '2026-11-02' && out.over[0].count === 41 && out.over[0].cap === 40,
      "owner's decision, 2026-08-15: never leave a new hang unscheduled — let the day " +
      'go over and shout about it instead');

    // ---- an EARLIER day is not somewhere to push a house back to ----------
    days = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: [] },
      { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: stops(41, 'f') }
    ];
    out = api.even(days, look);
    check('cap', 'pushed back means LATER — an earlier day is never the answer',
      days[0].stops.length === 0 && days[1].stops.length === 41,
      'moving a house backwards is not pushing it back, and could break a November preference');

    // ---- who gets bumped once windows are in play ------------------------
    /* A returning customer who would still get what they asked for beats one
       who would not — the cap is met either way, so meet it at the lower cost. */
    check('cap', 'the returning customer who keeps their window is bumped first',
      (() => {
        const s = [{ id: 'keeps' }, { id: 'loses' }];
        const p = { keeps: {}, loses: {} };
        return api.pick(s, id => p[id], id => id === 'keeps') === 0;
      })(),
      'both are last year\'s, so pick the one the move costs nothing');
    check('cap', 'but the cap is still met when nobody can be moved for free',
      (() => {
        const s = [{ id: 'a' }, { id: 'b' }];
        const p = { a: {}, b: {} };
        return api.pick(s, id => p[id], () => false) === 1;
      })(),
      'refusing to pick would leave the day over forty, the one thing the rule prevents');
    check('cap', 'a returning customer going out late still beats moving a new hang',
      (() => {
        const s = [{ id: 'ret' }, { id: 'new' }];
        const p = { ret: {}, new: { chargeNewMemberFee: true } };
        return api.pick(s, id => p[id], id => id === 'new') === 0;
      })(),
      'a new hang has never been hung at all — that outranks a returning customer\'s month');
    check('cap', 'an October house is past its window once November comes round',
      api.inWindow({ installPreference: 'October' }, '2026-11-04') === false &&
      api.inWindow({ installPreference: 'October' }, '2026-10-30') === true,
      'they asked for lights up in October — a November date is not that');
    check('cap', 'somebody who asked for nothing in particular is never "late"',
      api.latest({ installPreference: 'Normal Schedule' }) === null &&
      api.inWindow({}, '2026-12-31') === true);

    // ================= filling a light day up to forty ====================
    /* The other half of the owner's rule, 2026-08-15: "a day of 12 should fill
       up to 40, we want as many people in every day as possible." */
    const poolOf = (n, city, tag) => Array.from({ length: n }, (_, i) => ({
      id: (tag || 'p') + city + i, city: city,
      stop: { id: (tag || 'p') + city + i, name: city + ' pool ' + i }
    }));

    let d2 = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(12, 'g') }];
    let f = api.fill(d2, look, poolOf(50, 'Lehi'), yes);
    check('fill', 'a day of twelve fills up to forty',
      d2[0].stops.length === 40 && f.placed.length === 28,
      'the owner\'s words: we want as many people in every day as possible');
    check('fill', 'and stops dead on forty, never past it',
      d2[0].stops.length === api.max);

    d2 = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(12, 'h') }];
    f = api.fill(d2, look, poolOf(50, 'Orem'), yes);
    check('fill', 'a Lehi day is never filled with Orem houses',
      d2[0].stops.length === 12 && f.placed.length === 0,
      'the crew is not in Orem that day — that is the whole meaning of a route day');

    // ---- pulling houses FORWARD off a later day --------------------------
    d2 = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(30, 'i') },
      { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: stops(25, 'j') }
    ];
    f = api.fill(d2, look, [], yes);
    check('fill', 'with nobody spare, houses are pulled forward off a later day',
      d2[0].stops.length === 40 && d2[1].stops.length === 15 && f.pulled.length === 10,
      'this is what compacts the season instead of just draining the pool');
    check('fill', 'and nobody is lost or duplicated doing it',
      (() => {
        const all = d2.flatMap(d => d.stops.map(s => s.id));
        return all.length === 55 && new Set(all).size === 55;
      })());

    check('fill', 'somebody with no day at all is taken before somebody who has one',
      (() => {
        const dd = [
          { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(39, 'k') },
          { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: stops(5, 'm') }
        ];
        const r = api.fill(dd, look, poolOf(1, 'Lehi'), yes);
        return r.placed.length === 1 && r.pulled.length === 0 && dd[1].stops.length === 5;
      })(),
      'getting somebody scheduled beats moving somebody who already has a date');

    // ---- THE timing rule: pulling forward can break a preference ---------
    d2 = [
      { id: 'r1', date: '2026-10-20', city: 'Lehi', stops: stops(38, 'n') },
      { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: stops(10, 'o') }
    ];
    f = api.fill(d2, look, poolOf(5, 'Lehi', 'nov'), id => !/^nov/.test(id) && !/^o/.test(id));
    check('fill', 'a November house is NEVER dragged onto an October day',
      d2[0].stops.length === 38 && f.placed.length === 0 && f.pulled.length === 0,
      'this is the one place the rescheduler can break a promise, and the whole ' +
      'reason fillDays takes an allowedOn test while evenOutDays does not');

    check('fill', 'one that IS allowed still comes forward from the same day',
      (() => {
        const dd = [
          { id: 'r1', date: '2026-10-20', city: 'Lehi', stops: stops(39, 'q') },
          { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: [{ id: 'okr' }, { id: 'novr' }] }
        ];
        const r = api.fill(dd, look, [], id => id !== 'novr');
        return r.pulled.length === 1 && r.pulled[0].id === 'okr' && dd[1].stops.length === 1;
      })(),
      'a blanket "no pulling forward" would be safe and useless — it has to be per house');

    // ---- the budget, so one sweep cannot make 900 writes ----------------
    d2 = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: [] }];
    f = api.fill(d2, look, poolOf(50, 'Lehi'), yes, 40, 7);
    check('fill', 'a sweep stops at its budget and says there is more to do',
      f.placed.length === 7 && f.budgetHit === true,
      'the first sweep after this shipped could otherwise be several hundred ' +
      'sequential writes with the office watching a frozen tab');
    check('fill', 'and the budget is big enough to be worth having', api.budget >= 50);

    check('fill', 'a day that is already full is left completely alone',
      (() => {
        const dd = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(40, 'r') }];
        const r = api.fill(dd, look, poolOf(10, 'Lehi'), yes);
        return dd[0].stops.length === 40 && r.placed.length === 0;
      })());
    check('fill', 'a day with no city is skipped rather than filled with anybody',
      (() => {
        const dd = [{ id: 'r1', date: '2026-11-02', city: '', stops: [] }];
        const r = api.fill(dd, look, poolOf(10, 'Lehi'), yes);
        return dd[0].stops.length === 0 && r.placed.length === 0;
      })(),
      'a route whose city could not be judged would otherwise hoover up the pool');
  }
}
/* The wiring: the sweep has to actually call it, and has to go and find the new
   hangs that are on no day at all. */
/* The CALL site, not the declaration — `evenOutDays(days,` matches the function
   signature too, and that sits above step 3, so the naive version of this check
   passed by reading the wrong line. */
check('cap', 'the sweep evens the days out after everything else has landed',
  admin.indexOf('evenOutDays(days, custData)') > admin.indexOf('// ---- 3. Somewhere to go'),
  'evening out a half-built picture would move houses that were about to be dropped anyway');
/* Anchored on the ASSIGNMENT, not the arguments. Argument names do not
   distinguish a call from its declaration — the declaration uses exactly the
   same ones, which is what made the first two attempts at this check pass and
   fail for the wrong reasons. */
check('cap', 'and tops the days up only once the overfull ones have been shed',
  admin.indexOf('const topped = fillDays(') > admin.indexOf('const evened = evenOutDays('),
  'filling first would pack a day to forty that is about to shed houses anyway, ' +
  'and the two passes would fight each other every fifteen minutes');
check('fill', 'the fill is bounded so one sweep cannot make hundreds of writes',
  /fillDays\(days, custData, pool, allowedOn, MAX_STOPS_PER_DAY,\s*[\r\n ]*MAX_FILL_MOVES_PER_SWEEP\)/.test(admin),
  'the first sweep after this shipped has the whole unscheduled pool to place');
check('fill', 'every unscheduled customer is a candidate now, not just new hangs',
  /pool\.push\(\{id: a\.id/.test(admin) && /pool\.sort\(/.test(admin),
  "owner's correction, 2026-08-15: a day of 12 should fill up to 40");
check('fill', 'and new hangs get the seats first when there are not enough',
  /\(b\.newHang \? 1 : 0\) - \(a\.newHang \? 1 : 0\)/.test(admin),
  'a returning customer waiting one more week is not the same as a new hang never going out');
check('fill', 'pulling a house forward is gated on their timing preference',
  /const allowedOn = function\(id, dateStr\)\{[\s\S]{0,220}earliestAllowedInstallDate\(d\)\) <= dateStr/
    .test(admin.replace(/\r/g, '')),
  'this is the one place the rescheduler can put a November house on an October day');
check('fill', 'a customer the lookup cannot find is never assumed to be allowed',
  /return !!d && toDateStr\(earliestAllowedInstallDate/.test(admin),
  'silence read as a yes is how a promise gets broken by a missing record');
check('cap', 'a new hang on no day at all is gone and got',
  /if\(!isNewHangHouse\(d\)\) return;[\s\S]{0,400}needHoming\.push\(a\);/.test(admin),
  "the owner's rule: as soon as a customer is listed as a new hang they go on the schedule");
check('cap', 'a new hang who said no, or is sitting out, is left alone',
  /isNewHangHouse[\s\S]{0,300}rsvpStatus === 'no'[\s\S]{0,200}needHoming/.test(admin),
  'auto-scheduling somebody who cancelled would put them back in front of the crew');
check('cap', 'adding a customer only bumps somebody once the day is over forty',
  /if\(withNew\.length > MAX_STOPS_PER_DAY\)\{/.test(admin),
  'it used to bump on EVERY add to hold the planned size — that moved a confirmed ' +
  'date on a day of twelve for no reason');
check('cap', 'a house moved by the cap is re-ordered into driving order on its new day',
  /reorderFlatStops\(working\[rid\]/.test(admin),
  'appended to the end, it sits wherever the array put it rather than where the crew drives');
check('cap', 'a day left over the cap is named in the notice, not just counted',
  /report\.over \|\| \[\]\)\.forEach/.test(admin) && admin.includes('to move anyone to. Build another day for '),
  'the office can only fix it by building another day — the notice has to say which city');
check('cap', 'the sweep still reports as changed when all it did was even days out',
  /report\.capped\.length > 0 \|\| report\.over\.length > 0/.test(admin),
  'a silent reshuffle is how a confirmed date changes without anybody knowing');

// =====================================================================
// 19. ALL CUSTOMERS SAYS WHAT DAY THEY ARE DOWN FOR
// =====================================================================
/*
 * The Route column said "Scheduled" and never said when. Owner, 2026-08-15:
 * a small read-only button saying "what day the customer is currently scheduled
 * to be hung, or takendown, whichever is coming up next".
 *
 * nextVisitFor is where all the deciding happens, so it is RUN here. Which of
 * two dates wins, and whether a done visit still counts, cannot be read off a
 * regex — and getting it wrong shows the office the wrong date for a house,
 * which is worse than showing none.
 */
suite('19. All Customers: the next visit');
{
  const src = admin.slice(admin.indexOf('function nextVisitFor(d, todayStr)'),
                          admin.indexOf('function allCustRouteStatus'));
  if (!src) {
    check('nextvisit', 'the next-visit helpers are findable', false,
      'renamed or removed — update this test rather than deleting it');
  } else {
    global.toDateStr = dt => dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    global.esc = s => String(s);
    const api = eval(src + '\n;({next: nextVisitFor, chip: nextVisitChip})');
    const T = '2026-11-10';

    check('nextvisit', 'a house with nothing booked reports nothing at all',
      api.next({}, T) === null,
      'the caller renders no pill — a "Not scheduled" badge on nine hundred rows ' +
      'only repeats the line above it');
    check('nextvisit', 'a booked hang comes back with its day',
      (() => { const v = api.next({ scheduled: true, scheduledDate: '2026-11-12' }, T);
               return v && v.kind === 'Hang' && v.date === '2026-11-12' && !v.overdue; })());
    check('nextvisit', 'the SOONER of a hang and a takedown wins',
      (() => { const v = api.next({ scheduled: true, scheduledDate: '2026-11-12',
                 removalScheduled: true, removalScheduledDate: '2027-01-06' }, T);
               return v.kind === 'Hang' && v.date === '2026-11-12'; })(),
      "the owner's words: whichever is coming up next");
    check('nextvisit', 'once the lights are up, the takedown answers instead',
      (() => { const v = api.next({ completed: true, scheduled: true, scheduledDate: '2026-11-12',
                 removalScheduled: true, removalScheduledDate: '2027-01-06' }, T);
               return v.kind === 'Takedown' && v.date === '2027-01-06'; })(),
      'a finished install is not "coming up" — it must stop answering, or every ' +
      'installed house shows a date that has already happened');
    check('nextvisit', 'a done takedown stops answering too',
      api.next({ removalScheduled: true, removalScheduledDate: '2027-01-06',
                 removalDone: true }, T) === null);
    check('nextvisit', 'a day that has been and gone is still reported, flagged',
      (() => { const v = api.next({ scheduled: true, scheduledDate: '2026-11-02' }, T);
               return v && v.overdue === true && v.date === '2026-11-02'; })(),
      'that is a house the crew missed — hiding it until somebody tidies it up is ' +
      'exactly how it stays missed');
    check('nextvisit', 'today itself counts as coming up, not as missed',
      api.next({ scheduled: true, scheduledDate: T }, T).overdue === false,
      'off-by-one here tells the office they missed a house they are driving to this morning');
    check('nextvisit', 'an upcoming visit always beats a missed one',
      (() => { const v = api.next({ scheduled: true, scheduledDate: '2026-11-02',
                 removalScheduled: true, removalScheduledDate: '2026-11-20' }, T);
               return v.kind === 'Takedown' && !v.overdue; })(),
      'the question is what happens NEXT, and something in the past is not next');
    check('nextvisit', 'a scheduled flag with no date on it is ignored',
      api.next({ scheduled: true }, T) === null,
      'rendering "Hang undefined" is worse than rendering nothing');

    // ---- the chip itself ------------------------------------------------
    check('nextvisit', 'the chip is a span, not a button',
      /^<span /.test(api.chip({ scheduled: true, scheduledDate: '2026-12-12' })),
      'a disabled button is still announced as an unavailable action and can still ' +
      'be a tab stop — a date is neither');
    check('nextvisit', 'it cannot be clicked and says which visit it is',
      (() => { const h = api.chip({ scheduled: true, scheduledDate: '2026-12-12' });
               return /cursor:default/.test(h) && /Hang/.test(h) && /Dec 12/.test(h); })());
    check('nextvisit', 'a missed day is coloured differently from an upcoming one',
      api.chip({ scheduled: true, scheduledDate: '2020-01-02' }) !==
      api.chip({ scheduled: true, scheduledDate: '2099-01-02' }),
      'if both look the same the amber is decoration rather than a warning');
    check('nextvisit', 'nothing booked renders nothing', api.chip({}) === '');
  }
}
check('nextvisit', 'the Route column actually shows it',
  /const visitChip = nextVisitChip\(r\.d\);/.test(admin) &&
  /\(visitChip \? '<br>'\+visitChip : ''\)/.test(admin),
  'the helper existing is not the same as the office seeing it');
check('nextvisit', 'and it went in the existing Route cell, not a new column',
  (admin.match(/<th style="padding:8px 10px;"[^>]*>[^<]*<\/th>/g) || []).length +
    (admin.match(/data-sortcol="(name|enrolled)"/g) || []).length > 0 &&
  !/>Next Visit<\/th>/.test(admin),
  'the responsive rules address this table by td:nth-child(2) and (4), so an extra ' +
  'column would silently relabel two others on a phone');

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
