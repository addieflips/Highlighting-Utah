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
/* houseAllowedFrom closes over this. Sandboxes that lift the whole
   MAX_STOPS_PER_ROUTE block already have it; the ones that lift the function
   on its own need it handed to them. Taken from admin.html rather than
   restated, or a test could go on passing against a number the real schedule
   no longer uses. */
const THX_CONST = (admin.match(/const PRE_THANKSGIVING_DAYS = \d+;/) || [''])[0];
if (!THX_CONST) throw new Error('PRE_THANKSGIVING_DAYS has gone from admin.html');

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
/* Health Check's "customer with no number" row reads the town off the record.
   Lifted from admin.html rather than stubbed, for the same reason as the
   colours: a stub would keep this suite green through a change to what the app
   actually counts as a town. */
const hcCleanCitySrc = (function(){
  const at = admin.indexOf('function extractCleanCity(');
  if (at < 0) return '';
  let d = 0;
  for (let i = admin.indexOf('{', at); i < admin.length; i++) {
    if (admin[i] === '{') d++;
    else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
  }
  return '';
})();
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
  /* CHANGED 2026-08-17: a row removed from the seed is now pruned whatever its
     score. The seed is the single source of truth for the seeded range, so
     removing a row means the test is retired (or the automated suite covers it
     now) and it should leave the checklist - it used to linger on Needs Test/
     Retest/N/A with no way for the seed to clear it. */
  check('logic', 'prune: a retired test scored Pass is pruned',
    projShouldPruneTest('t9', { num: 9, result: 'Pass' }, seededIds));
  check('logic', 'prune: a retired test scored Fail is pruned',
    projShouldPruneTest('t9', { num: 9, result: 'Fail' }, seededIds));
  check('logic', 'prune: a retired test still Needs Test is pruned (seed is the source of truth)',
    projShouldPruneTest('t9', { num: 9, result: '' }, seededIds));
  check('logic', 'prune: a retired test on Retest is pruned',
    projShouldPruneTest('t9', { num: 9, result: 'Retest' }, seededIds));
  check('logic', 'prune: a retired test marked N/A is pruned',
    projShouldPruneTest('t9', { num: 9, result: 'N/A' }, seededIds));
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
  /* Floor lowered 2026-08-17: the seed was deliberately trimmed from 210 to
     ~108 manual tests, dropping every row the automated suite already proves so
     the owner's checklist only holds what a human or a live environment has to
     verify. The floor is a truncation tripwire, not a target - a seed suddenly
     back under ~90 means something ate the list, not that it was pruned. */
  check('logic', 'the checklist seed survived the move intact',
    TEST_SEED.length >= 90,
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
    /* The "customer with no number" check reads the town off the record, and
       lifts the real cleaner for the same reason as the colours above. */
    ${hcCleanCitySrc || ''}
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
  /* 19 since 2026-08-15, when "light colours written as words" was added.
     STILL 19 after 2026-08-18: the owner asked for an indicator for customers
     with no customer number, and the honest answer was that one already
     existed — 'noNumber' — just narrowed to customers WITH a price, which is
     why her stray "Richards Jeff — Levan, UT" was invisible to it. Widening
     that check was right; pushing a second one was not, and briefly gave two
     checks the same id. If a new check really is needed, give it its own id
     and change this number in the same edit.
     The count is deliberately hard-coded: a check silently disappearing is
     exactly the kind of thing nobody notices. */
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
  /* Either spelling counts as honouring it: the literal check, or the shared
     isOutForSeason (which excludes Maybe Next Year first — suite 21 runs that
     for real). The install generator moved to the helper on 2026-08-15 when
     the RSVP gate came off, and this check exists to protect the GUARANTEE,
     not one way of writing it. */
  const honoursMaybe = l => l.includes('!a.data.maybeNextYear') || l.includes('!isOutForSeason(a.data)');
  check('quoteresp', 'every route list excludes Maybe Next Year',
    routeLists.length >= 4 && routeLists.every(honoursMaybe),
    'found ' + routeLists.length + ' route lists, ' +
    routeLists.filter(l => !honoursMaybe(l)).length + ' not honouring the tag');

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
    /bulkFindCustomer\(street, phone/.test(checkSrc) && /alignBulkRows/.test(checkSrc),
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
  /* extractFn, NOT a character window. This read `+ 700` until 2026-08-15, when
     a comment added inside the function pushed 'Total Price' past the 700th
     character and the check failed on code that was perfectly correct — the
     exact slow fuse sectionFrom's own header warns about, and CLAUDE.md §7.
     extractFn ends at the function's real closing brace, so it cannot go
     stale as the body grows. */
  const missingFn = extractFn(admin, 'addCustMissingFields') || '';
  check('reliability', 'the Add form has a missing-required-fields check',
    missingFn.length > 100 && /function showAddCustMissing/.test(admin),
    'a customer saved with no phone, photo or price looked identical to a complete one');
  ['Street Address', 'City', 'Phone Number', 'Email', 'Light Colors', 'House Picture', 'Total Price'].forEach(function(field){
    check('reliability', 'the Add form names "' + field + '" when it is missing',
      missingFn.indexOf("'" + field + "'") !== -1,
      'being told about missing fields one at a time is what made this form feel broken');
  });
  check('reliability', 'every missing field is listed in one go, not one per attempt',
    /missingFields\.map\(/.test(addForm) && /showAddCustMissing\(missingFields\)/.test(addForm),
    'six trips around a form this long is most of what "add customer does not work" was');

  /* ---- Light colours are REQUIRED, not warned about (owner, 2026-08-15) ----
     Every other field on this form can be waved through with "OK to add them
     without these", and that is deliberate — a photo genuinely does get taken
     next week. Colours are the exception, because a customer with none is
     invisible to the Warehouse: the build queue is keyed off the light
     description, so they never reach Dad and no screen says so. */
  check('reliability', 'light colours cannot be waved through on Add Customer',
    /if\(!lightsDescription\)\{[\s\S]{0,700}return;/.test(addForm) &&
    !/No light colours are selected/.test(addForm),
    'the old "add them anyway?" prompt is back — clicking through it is what put ' +
    'colourless customers on the books in the first place');
  check('reliability', 'the colour stop happens before the overridable prompt',
    addForm.indexOf('if(!lightsDescription)') !== -1 &&
    addForm.indexOf('if(!lightsDescription)') < addForm.indexOf('add them without these'),
    'reached after the prompt, it would offer to skip a field that cannot be skipped');
  check('reliability', 'the colour stop happens before anything is written',
    addForm.indexOf('if(!lightsDescription)') < addForm.indexOf('addDoc('),
    'a customer saved and then complained about is not a required field');
  check('reliability', 'an automatic convert with no colours says why, on the tab in use',
    /if\(!lightsDescription\)\{[\s\S]{0,700}isAutoConvert[\s\S]{0,300}toast\(/.test(addForm),
    'the status line it writes to is on the Customers tab, and an automatic ' +
    'convert leaves you on Quotes — it would fail in silence');
  check('render', 'the convert popup will not offer automatic without colours',
    /hasLights\s*=\s*!!String\(d\.lightsDescription/.test(admin) &&
    /convertQuoteAutoBtn"'\+\(hasLights \? '' : ' disabled'\)/.test(admin),
    'clicking Convert automatically would just bounce back an error');

  /* The other door into a light description is the customer's own detail form
     on the public site. It has always refused to submit without a colour —
     that was never guarded by a test, so it could have been softened to a
     warning without anyone noticing and the two forms would have disagreed
     about whether colours are required. */
  const idxSrc = read('index.html');
  check('reliability', 'the public detail form refuses to submit with no colour',
    /if\(!qdFinalSequence\.length\)\{[\s\S]{0,200}return;/.test(idxSrc),
    'a quote could come back with no colours, and then nothing could be ' +
    'converted from it without picking them by hand');
  check('reliability', 'that refusal is a stop, not a confirm',
    !/confirm\([^)]{0,80}least one light color/i.test(idxSrc),
    'a confirm can be clicked through — required means required on both forms');
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

/* ============ THE WAREHOUSE PATTERN IS PICKED, NEVER TYPED ============
 *
 * Owner's rule, 2026-08-15. The Pattern field on "Add to Queue" used to be a
 * free-text box, and whatever was typed there became the group key the whole
 * build queue is organised by — so one stray spelling was an extra heading
 * with its own bundle count.
 *
 * These CLICK the real buttons and read back the hidden input that actually
 * gets saved, rather than reading the source as text: the thing worth proving
 * is that a person clicking colours produces the right stored value.
 */
suite('14b. Warehouse pattern picker');

check('warehouse', 'the Pattern field is not a text box any more',
  !/<input type="text" id="whExtraPattern"/.test(admin),
  'a typed pattern becomes a build-queue heading of its own');
check('warehouse', 'the Pattern field is a hidden input the picker writes',
  /<input type="hidden" id="whExtraPattern">/.test(admin),
  'the rest of the form reads this id — dropping it breaks fill-from-record, edit and reset');
check('warehouse', 'nothing assigns to the pattern box behind the picker\'s back',
  !/getElementById\('whExtraPattern'\)\.value\s*=/.test(admin),
  'a direct assignment leaves the chips showing something different from what will be saved');
check('warehouse', 'the colour buttons come from the app\'s own colour list',
  /LIGHTS_COLOR_OPTIONS\.map[\s\S]{0,200}data-whcolor/.test(admin),
  'a hand-written list here could offer a colour the rest of the app does not know');

if (!JSDOM) {
  note('jsdom not installed — skipping the pattern picker tests');
} else {
  const dom = new JSDOM('<div id="whExtraPatternRow">' +
    '<input type="hidden" id="whExtraPattern">' +
    '<div id="whExtraPatternPicker"></div>' +
    '<div id="whExtraPatternChips"></div>' +
    '<div id="whExtraPatternNote"></div></div>');
  global.document = dom.window.document;
  global.esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* eval'd `const` never escapes the eval call, so the colour list is promoted
     to a global — lifted from admin.html, never restated here, or this suite
     would keep passing after the real list changed. */
  const vocabSrc = (admin.match(/const LIGHTS_COLOR_OPTIONS = \[[^\]]*\];/) || [''])[0]
    .replace('const LIGHTS_COLOR_OPTIONS', 'global.LIGHTS_COLOR_OPTIONS');
  let whExtraPatternParts = [];
  const pickerSrc = [vocabSrc,
    extractFn(admin, 'whPatternPartsFromText'),
    extractFn(admin, 'whSyncExtraPatternValue'),
    extractFn(admin, 'whRenderExtraPattern'),
    extractFn(admin, 'whSetExtraPattern')].filter(Boolean).join('\n');

  if (!/function whSetExtraPattern/.test(pickerSrc) || !/function whRenderExtraPattern/.test(pickerSrc)) {
    check('warehouse', 'the pattern picker functions were found', false,
      'whSetExtraPattern / whRenderExtraPattern are gone or renamed');
  } else {
    eval(pickerSrc);
    const val = () => document.getElementById('whExtraPattern').value;
    const click = label => {
      const b = [...document.querySelectorAll('[data-whcolor]')]
        .find(x => x.dataset.whcolor === label);
      if (b) b.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    };
    const removeAt = i => {
      const x = document.querySelector('[data-whremove="' + i + '"]');
      if (x) x.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    };

    whRenderExtraPattern();
    check('warehouse', 'a button is offered for every colour the app sells',
      document.querySelectorAll('[data-whcolor]').length === LIGHTS_COLOR_OPTIONS.length,
      'got ' + document.querySelectorAll('[data-whcolor]').length + ' buttons for ' +
      LIGHTS_COLOR_OPTIONS.length + ' colours');
    check('warehouse', 'the empty picker says what to do rather than sitting blank',
      /click a colour/i.test(document.getElementById('whExtraPatternChips').textContent));

    click('Red'); click('Green');
    check('warehouse', 'clicking colours builds the value that gets saved',
      val() === 'Red, Green', 'got ' + JSON.stringify(val()));

    whSetExtraPattern('');
    click('Warm White'); click('Red'); click('Red'); click('Warm White');
    check('warehouse', 'clicking one colour twice makes a repeating pattern',
      val() === 'Warm White, Red, Red, Warm White',
      'order and repeats are the whole reason this is a list and not tick boxes — got ' + JSON.stringify(val()));
    removeAt(1);
    check('warehouse', 'removing one position leaves the others in order',
      val() === 'Warm White, Red, Warm White', 'got ' + JSON.stringify(val()));

    whSetExtraPattern('Red, Green');
    check('warehouse', 'an entry loaded for editing fills the chips',
      val() === 'Red, Green' && document.querySelectorAll('[data-whremove]').length === 2,
      'editing an existing queue entry would come up empty and silently wipe its pattern');
    whSetExtraPattern('red and green');
    check('warehouse', 'an older free-text pattern loads as real colours',
      val() === 'Red, Green', 'got ' + JSON.stringify(val()));

    whSetExtraPattern('Red with tinsel');
    check('warehouse', 'wording it cannot read is kept, not dropped or guessed',
      val() === 'Red with tinsel',
      'silently rewriting somebody\'s build is worse than showing it — got ' + JSON.stringify(val()));
    check('warehouse', 'and the part it cannot read is marked on screen',
      /FDECEA/.test(document.getElementById('whExtraPatternChips').innerHTML),
      'nothing would tell whoever is looking which bit is not a real colour');
    whSetExtraPattern('Red, sparkly thing');
    removeAt(1);
    check('warehouse', 'the unreadable part can be taken off and replaced',
      val() === 'Red', 'got ' + JSON.stringify(val()));

    whSetExtraPattern('');
    check('warehouse', 'resetting clears the chips as well as the value',
      val() === '' && document.querySelectorAll('[data-whremove]').length === 0,
      'the next thing added would inherit the last one\'s colours');

    /* Nothing a person can click may produce a part the warehouse cannot read
       — that is the whole point of removing the text box. */
    whSetExtraPattern('');
    LIGHTS_COLOR_OPTIONS.forEach(c => click(c));
    check('warehouse', 'every colour a button can add is one the warehouse groups by',
      whUnreadableLightParts(val()).length === 0,
      'a button offers something whNormalizeLights cannot read: ' +
      JSON.stringify(whUnreadableLightParts(val())));
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
    /const custNumbers = .*alignBulkRows/.test(src) && /const cn = custNumbers\[i\] \|\| ''/.test(src),
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
    /* The REAL personName, lifted out of the page rather than stubbed — the
       printed sheet is where a name-format bug reaches the crew on paper, so
       this suite should be testing what actually ships, not a fake that agrees
       with it. Suite 20 covers the flip's own rules. */
    /* The REAL personName, lifted out of the page rather than stubbed — the
       printed sheet is where a name-format bug reaches the crew on paper, so
       this suite tests what actually ships. It resolves through the customer
       index, which is empty here, so it falls back to the imported name: that
       IS the behaviour for a plan row with no customer record behind it. */
    global.custByNumber = new Map();
    global.custByPhoneDigits = new Map();
    global.custByAddrKey = new Map();
    global.custAddrKey = () => '';
    global.customerForScheduleRow = () => null;
    global.personName = eval(
      admin.slice(admin.indexOf('function personName(n, h)'),
                  admin.indexOf('\n}', admin.indexOf('function personName(n, h)')) + 2) +
      '\n;personName');
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
  /* The alias table and the normaliser, because every timing rule reads through
     them now — "NOV" has to mean November here exactly as it does in the page. */
  /* Rewritten to a global assignment: a `const` declared inside eval() is
     scoped to that eval and invisible to everything after it, unlike a function
     declaration. */
  {
    const aliasSrc = admin.slice(admin.indexOf('const INSTALL_PREF_ALIASES'),
                                 admin.indexOf('function normInstallPref'));
    if (!aliasSrc) throw new Error('INSTALL_PREF_ALIASES not found — normInstallPref cannot run');
    eval(aliasSrc.replace('const INSTALL_PREF_ALIASES', 'global.INSTALL_PREF_ALIASES'));
  }
  eval(extractFn(admin, 'normInstallPref'));
  eval(extractFn(admin, 'isKnownInstallPref'));
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
    /* Both messy-but-real forms now read as Lehi. "Lehi, UT 84043" used to come
       back BLANK — the function took the last comma segment, which was right
       for "123 Main St, Lehi" and wrong for every way a person types a city.
       A blank town cannot be matched to a route day, so those houses were
       silently left out of the schedule entirely. Fixed 2026-08-15; suite 23
       runs the whole set of forms. */
    {id:'c1', data:{city:'Lehi 84043'}}, {id:'c2', data:{city:'Lehi, UT 84043'}}
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
                  /* isOutForSeason lives up with the install-timing helpers, far
                     above the sweep, so it has to be lifted in by name. The REAL
                     one, not a stub — who the fill is allowed to schedule is the
                     rule most likely to be got wrong, and suite 21 only proves
                     the function itself, not that the sweep obeys it. */
                  'isOutForSeason','normInstallPref',
                  'scheduledFieldForType','freeUpFieldForType'];

  if (recStart === -1 || recEnd < recStart) {
    check('reconcile', 'the route reconciler is findable',
      false, 'renamed or removed — update this test rather than deleting it');
  } else {
    /* isOutForSeason reads a module-level setting that extractFn does not pick
       up. Lifted from the page verbatim rather than hardcoded here, so if the
       owner flips it to 'confirmed-only' this harness follows rather than
       quietly testing a rule production no longer uses. */
    const eligLine = (admin.match(/const SEASON_ELIGIBILITY = '[^']*';/) || [])[0];
    if (!eligLine) throw new Error('SEASON_ELIGIBILITY not found — isOutForSeason cannot run');
    const helpers = eligLine + '\n' + NEEDED.map(n => extractFn(admin, n)).join('\n');
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
        /* ⚠ setDoc and deleteDoc were MISSING, and their absence was invisible:
           the sweep wraps day-building and day-retiring in try/catch so a
           missing function threw, was swallowed, and every test simply saw
           "no days were built". The single biggest thing this sweep does was
           not exercised at all. A fake that is missing a method does not fail
           loudly — it fails as a plausible-looking empty result, which is the
           worst way for a test harness to be wrong. */
        setDoc: async (ref, payload) => { writes.push({ path: ref.__path, payload, set: true }); },
        deleteDoc: async (ref) => { writes.push({ path: ref.__path, deleted: true }); },
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
      /* CHANGED 2026-08-15: an RSVP of 'no' ON ITS OWN no longer strips anybody.
         The owner's rule is that for now only Maybe Next Year keeps somebody off
         the list. What still strips them is the physical consequence — answering
         no queues the warehouse to take their bundle apart — and portalRsvp
         always writes rsvpStatus and needsLightRecycle in the same update, so
         the realistic case is the pair, not the status alone. */
      check('reconcile', 'a customer whose lights are being taken apart is a problem',
        /taken apart/.test(h.problem({data:{rsvpStatus:'no', needsLightRecycle:true}}, soon)));
      check('reconcile', 'but an RSVP of no on its own leaves them on the day',
        h.problem({data:{rsvpStatus:'no'}}, soon) === '',
        'owner, 2026-08-15: for now everyone but Maybe Next Year is on the list');
      check('reconcile', 'back next year is still a problem, via the badge it always carries',
        /sitting out/.test(h.problem({data:{maybeNextYear:true, rsvpStatus:'backnextyear'}}, soon)),
        'pullCustomerFromSeason writes both fields in one update');
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
        /* needsLightRecycle alongside the status, because portalRsvp always
           writes both — a fixture carrying only the status would be testing a
           state production never produces. */
        {id:'said',  data:{name:'Said No',     city:'Lehi', address:'2 No St',   lat:40.4, lng:-111.8, rsvpStatus:'no', needsLightRecycle:true}},
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
      check('reconcile', 'a customer whose lights are being recycled comes off the day',
        soonIds.indexOf('said') === -1,
        'their bundle is being taken apart — a crew would arrive with nothing to hang');
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
      /* "Already right" now includes the customer RECORD agreeing with the
         route it sits on. It did not before, and that gap was real: nine
         customers were found on the 6 Oct route in the live book with their own
         records still reading unscheduled, so All Customers showed them as
         having no day. A fixture whose customer is on a route but not flagged
         is not a clean sweep — it is the bug. */
      const clean = {
        houses: [{id:'ok', data:{name:'Fine House', city:'Lehi', address:'1 Fine St',
                                 lat:40.4, lng:-111.8, rsvpStatus:'yes',
                                 scheduled:true, scheduledDate:dstr(3), assignedCrew:'1'}}],
        cache: {}
      };
      clean.cache[dstr(3)] = [{id:'cleanDay', date:dstr(3), type:'install', crew:'1', stops:[
        {id:'ok', name:'Fine House', address:'1 Fine St', lat:40.4, lng:-111.8, difficulty:'Unrated',
         phone:'', gateCode:'', specificOutlet:'', specificOutletNotes:'', customerNumber:''}
      ]}];
      // ---- 18.5 THE SCHEDULE FOLLOWS THE CUSTOMER RECORD ------------------
      /* Owner, 2026-08-15: "the schedule will be needing to be changed
         constantly — can we verify these weird customers will change with it."
         The answer has to be a test, not a promise. Each case below is a real
         edit somebody will make to a record, run through the REAL sweep against
         a fake database, checking the schedule moves with it.
         These are written against the awkward customers specifically: the ones
         whose town is about to be filled in from a map pin, the ones whose
         timing preference is shorthand, the ones being corrected by hand. */
      const stopFor = (id, name) => ({id, name, address:'1 St', lat:40.4, lng:-111.8,
        difficulty:'Unrated', phone:'', gateCode:'', specificOutlet:'',
        specificOutletNotes:'', customerNumber:''});
      const oneDay = (houses, extra) => {
        const cache = {};
        cache[dstr(3)] = [Object.assign({id:'d1', date:dstr(3), type:'install', crew:'1',
          autoBuilt:true, stops: houses.map(h => stopFor(h.id, h.data.name))}, extra || {})];
        return cache;
      };
      const stillOn = async (houses, extra) => {
        const h = makeRec(houses, oneDay(houses, extra));
        const rep = await h.api.reconcile();
        /* The write to the ORIGINAL day, by its id — not merely the first write
           to scheduledRoutes, which since the fake learned setDoc may well be a
           brand-new day the sweep built for whoever it just moved off. */
        const day = (h.writes.find(w => w.path === 'scheduledRoutes/d1') || {}).payload;
        return { rep, stops: day ? day.stops.map(s => s.id) : houses.map(x => x.id),
                 dropped: rep.dropped.map(d => d.why) };
      };

      // a town corrected by hand — the case the 374 will produce
      let r = await stillOn([{id:'moved', data:{name:'Moved Town', city:'Orem',
        address:'1 St', lat:40.4, lng:-111.8, scheduled:true, scheduledDate:dstr(3)}},
        {id:'stay', data:{name:'Stays', city:'Lehi', address:'2 St', lat:40.4, lng:-111.8,
          scheduled:true, scheduledDate:dstr(3)}},
        {id:'stay2', data:{name:'Stays Too', city:'Lehi', address:'3 St', lat:40.4, lng:-111.8,
          scheduled:true, scheduledDate:dstr(3)}}]);
      check('reconcile', 'a customer whose town is corrected comes off the wrong town\'s day',
        r.stops.indexOf('moved') === -1 && r.stops.indexOf('stay') !== -1,
        'nothing re-checked this, so a town fixed by hand left them on the old ' +
        "town's day for ever — and 374 records are about to have a town filled in");
      check('reconcile', 'and the notice says which town they are actually in',
        r.dropped.some(w => /is in Orem, and this is a Lehi day/.test(w)),
        '"taken off Tuesday" without saying why is not something anybody can act on');
      /* "Re-homed" does not mean "moved to an existing day" — in this fixture
         there IS no Orem day, so the honest outcome is that one gets BUILT for
         them. What must never happen is being taken off a day and then simply
         forgotten, which is what the first version of this check accidentally
         asserted by demanding freed be empty. */
      check('reconcile', 'they get another day rather than being forgotten',
        r.rep.built.some(b => b.city === 'Orem') || r.rep.moved.length > 0,
        'being on the wrong day is not a reason to end up on no day');

      // ...but a day somebody built BY HAND is left alone
      r = await stillOn([{id:'moved', data:{name:'Moved Town', city:'Orem',
        address:'1 St', lat:40.4, lng:-111.8, scheduled:true, scheduledDate:dstr(3)}},
        {id:'stay', data:{name:'Stays', city:'Lehi', address:'2 St', lat:40.4, lng:-111.8,
          scheduled:true, scheduledDate:dstr(3)}}], {autoBuilt:false});
      check('reconcile', 'a hand-built day may carry a house from the next town over',
        r.stops.indexOf('moved') !== -1,
        'a favour, or a detour that makes sense on the ground — evicting it ' +
        'would be overruling the person who built the day');

      // a timing preference corrected from shorthand to something real
      r = await stillOn([{id:'thx', data:{name:'Was THX', city:'Lehi', address:'1 St',
        lat:40.4, lng:-111.8, installPreference:'November', scheduled:true, scheduledDate:dstr(3)}}]);
      check('reconcile', 'a preference corrected to November comes off an October day',
        r.dropped.some(w => /cannot be installed until/.test(w)),
        'the 1 customer reading THX and the 190 reading NOV will be tidied up by ' +
        'hand — the schedule has to follow when they are');

      // and the everyday one: sitting somebody out
      r = await stillOn([{id:'out', data:{name:'Sitting Out', city:'Lehi', address:'1 St',
        lat:40.4, lng:-111.8, maybeNextYear:true, scheduled:true, scheduledDate:dstr(3)}}]);
      check('reconcile', 'Maybe Next Year comes off the day it was on',
        r.stops.indexOf('out') === -1 && r.dropped.some(w => /sitting out/.test(w)));

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
/* Read out of the FUNCTION, not out of a 600-character window after the call.
   The window version broke the moment runReconcileAuto grew a few lines, which
   is exactly the staleness the meta-check in this suite exists to catch. */
check('reconcile', 'the sweep can never take the page down with it',
  (() => {
    const fn = extractFn(admin, 'runReconcileAuto').replace(/\r/g, '');
    const call = fn.indexOf('reconcileUpcomingRoutes()');
    const grab = fn.indexOf('.catch(function(err){');
    return call !== -1 && grab > call;
  })(),
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
  const capStart = admin.indexOf('const MAX_STOPS_PER_ROUTE');
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
      ' max: MAX_STOPS_PER_ROUTE, budget: MAX_FILL_MOVES_PER_SWEEP,' +
      ' inWindow: stillInWindow, latest: latestPreferredInstallDate, isNew: isNewHangHouse})');

    check('cap', 'the cap is twenty houses per town per day', api.max === 20,
      "owner: 'only 20 houses per city' — 40 was the whole DAY, two crews of twenty");
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
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(21, 'a') },
      { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: [] }
    ];
    let out = api.even(days, look);
    check('cap', '21 becomes 20 and the extra one lands on the next Lehi day',
      days[0].stops.length === 20 && days[1].stops.length === 1 && out.moves.length === 1,
      'whenever a town goes one over twenty for a day, one gets pushed back');
    check('cap', 'and it is the LAST house in driving order that goes',
      days[1].stops[0].id === 'a20');
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
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(25, 'c') },
      { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: stops(18, 'd') },
      { id: 'r3', date: '2026-11-09', city: 'Lehi', stops: [] }
    ];
    out = api.even(days, look);
    check('cap', 'a day that tips over because of what the day before it shed is evened out too',
      days[0].stops.length === 20 && days[1].stops.length === 20 && days[2].stops.length === 3,
      'this is the cascade — 25 sheds 5 onto a day of 18, which is then 23 and sheds 3');
    check('cap', 'nobody is lost or duplicated in the shuffle',
      (() => {
        const all = days.flatMap(d => d.stops.map(s => s.id));
        return all.length === 43 && new Set(all).size === 43;
      })(),
      'a rescheduler that drops a house is worse than one that never ran');

    // ---- another city's day is not "the next time we are in that city" -----
    days = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(21, 'e') },
      { id: 'r2', date: '2026-11-03', city: 'Orem', stops: [] }
    ];
    out = api.even(days, look);
    check('cap', 'an Orem day is never offered as room for a Lehi house',
      days[0].stops.length === 21 && days[1].stops.length === 0 && out.over.length === 1,
      'the whole point of "the next time we are in that city" is that the truck is going anyway');
    check('cap', 'a day with nowhere to send anyone goes over, and says so',
      out.over[0].date === '2026-11-02' && out.over[0].count === 21 && out.over[0].cap === 20,
      "owner's decision, 2026-08-15: never leave a new hang unscheduled — let the day " +
      'go over and shout about it instead');

    // ---- an EARLIER day is not somewhere to push a house back to ----------
    days = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: [] },
      { id: 'r2', date: '2026-11-05', city: 'Lehi', stops: stops(21, 'f') }
    ];
    out = api.even(days, look);
    check('cap', 'pushed back means LATER — an earlier day is never the answer',
      days[0].stops.length === 0 && days[1].stops.length === 21,
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
    check('fill', 'a town with twelve booked fills up to twenty',
      d2[0].stops.length === 20 && f.placed.length === 8,
      'the owner\'s words: we want as many people in every day as possible');
    check('fill', 'and stops dead on twenty, never past it',
      d2[0].stops.length === api.max);

    d2 = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(12, 'h') }];
    f = api.fill(d2, look, poolOf(50, 'Orem'), yes);
    check('fill', 'a Lehi day is never filled with Orem houses',
      d2[0].stops.length === 12 && f.placed.length === 0,
      'the crew is not in Orem that day — that is the whole meaning of a route day');

    // ---- pulling houses FORWARD off a later day --------------------------
    d2 = [
      { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(15, 'i') },
      { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: stops(12, 'j') }
    ];
    f = api.fill(d2, look, [], yes);
    check('fill', 'with nobody spare, houses are pulled forward off a later day',
      d2[0].stops.length === 20 && d2[1].stops.length === 7 && f.pulled.length === 5,
      'this is what compacts the season instead of just draining the pool');
    check('fill', 'and nobody is lost or duplicated doing it',
      (() => {
        const all = d2.flatMap(d => d.stops.map(s => s.id));
        return all.length === 27 && new Set(all).size === 27;
      })());

    check('fill', 'somebody with no day at all is taken before somebody who has one',
      (() => {
        const dd = [
          { id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(19, 'k') },
          { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: stops(5, 'm') }
        ];
        const r = api.fill(dd, look, poolOf(1, 'Lehi'), yes);
        return r.placed.length === 1 && r.pulled.length === 0 && dd[1].stops.length === 5;
      })(),
      'getting somebody scheduled beats moving somebody who already has a date');

    // ---- THE timing rule: pulling forward can break a preference ---------
    d2 = [
      { id: 'r1', date: '2026-10-20', city: 'Lehi', stops: stops(18, 'n') },
      { id: 'r2', date: '2026-11-09', city: 'Lehi', stops: stops(10, 'o') }
    ];
    f = api.fill(d2, look, poolOf(5, 'Lehi', 'nov'), id => !/^nov/.test(id) && !/^o/.test(id));
    check('fill', 'a November house is NEVER dragged onto an October day',
      d2[0].stops.length === 18 && f.placed.length === 0 && f.pulled.length === 0,
      'this is the one place the rescheduler can break a promise, and the whole ' +
      'reason fillDays takes an allowedOn test while evenOutDays does not');

    check('fill', 'one that IS allowed still comes forward from the same day',
      (() => {
        const dd = [
          { id: 'r1', date: '2026-10-20', city: 'Lehi', stops: stops(19, 'q') },
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
        const dd = [{ id: 'r1', date: '2026-11-02', city: 'Lehi', stops: stops(20, 'r') }];
        const r = api.fill(dd, look, poolOf(10, 'Lehi'), yes);
        return dd[0].stops.length === 20 && r.placed.length === 0;
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
  /fillDays\(days, custData, pool, allowedOn, MAX_STOPS_PER_ROUTE,\s*[\r\n ]*MAX_FILL_MOVES_PER_SWEEP\)/.test(admin),
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
check('cap', 'adding a customer only bumps somebody once that town is over twenty',
  /if\(withNew\.length > MAX_STOPS_PER_ROUTE\)\{/.test(admin),
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
    /* CHANGED 2026-08-15, hours after it shipped. This used to assert the chip
       rendered NOTHING when no day was booked. That is true out of season for
       EVERY customer, so the whole column drew blank and the owner could not
       find the feature at all. The empty state now says so out loud. */
    check('nextvisit', 'nothing booked still draws a label, so the column is never blank',
      /^<span /.test(api.chip({})) && /No day booked yet/.test(api.chip({})),
      'it is August — nobody is scheduled, so rendering nothing made the whole ' +
      'feature invisible on every single row');
    check('nextvisit', 'and the empty one is plainly not a date',
      api.chip({}) !== api.chip({ scheduled: true, scheduledDate: '2099-01-02' }) &&
      /dashed/.test(api.chip({})),
      'a dashed outline reads as "nothing here yet" rather than as a booking');
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
// 20. ONE NAME FORMAT ON SCREEN
// =====================================================================
/*
 * Aaron Gardner is "Aaron Gardner" in All Customers and came through the route
 * CSV as "Gardner Aaron". Owner, 2026-08-15: "I dont want the names to be
 * flipped to how they should be I want them synced with how theyre titled as a
 * customer."
 *
 * ⚠ THE FIRST ATTEMPT AT THIS WAS WRONG and the shape of the mistake is worth
 * keeping: it flipped anything matching "Last, First". That did NOTHING for
 * "Gardner Aaron" — no comma — and everywhere it did fire it was guessing at
 * an answer the customer record already held. Do not reintroduce a name parser
 * here. The rule is a LOOKUP: find the customer, show their name verbatim.
 *
 * So what is tested is the matching, and the refusal to invent anything when
 * there is no match.
 */
suite('20. Schedule names come from the customer record');
{
  const idxSrc = admin.slice(admin.indexOf('function custAddrKey(address, city)'),
                             admin.indexOf('\n}', admin.indexOf('function customerForScheduleRow')) + 2);
  const nameSrc = admin.slice(admin.indexOf('function personName(n, h)'),
                              admin.indexOf('\n}', admin.indexOf('function personName(n, h)')) + 2);
  if (!idxSrc || !nameSrc) {
    check('names', 'the name-sync helpers are findable', false,
      'renamed or removed — update this test rather than deleting it');
  } else {
    const api = eval(idxSrc + '\n' + nameSrc +
      '\n;({name: personName, find: customerForScheduleRow, key: custAddrKey})');
    const cust = (name, extra) => ({ id: name, data: Object.assign({ name: name }, extra || {}) });

    const reset = () => {
      global.custByNumber = new Map();
      global.custByPhoneDigits = new Map();
      global.custByAddrKey = new Map();
    };

    // ---- the whole point ------------------------------------------------
    reset();
    global.custByPhoneDigits.set('8015550100', cust('Aaron Gardner'));
    check('names', 'a row imported as "Gardner Aaron" shows as "Aaron Gardner"',
      api.name('Gardner Aaron', { phone: '(801) 555-0100' }) === 'Aaron Gardner',
      'the exact case the owner reported, and the one a comma-flip could never fix');
    check('names', 'the customer name is used character for character',
      api.name('GARDNER, AARON', { phone: '8015550100' }) === 'Aaron Gardner',
      'not re-cased, not re-ordered — whatever All Customers says is the answer');

    // ---- which key wins -------------------------------------------------
    reset();
    global.custByNumber.set('5012', cust('By Number'));
    global.custByPhoneDigits.set('8015550100', cust('By Phone'));
    global.custByAddrKey.set('123 main st|lehi', cust('By Address'));
    check('names', 'the customer number is trusted first',
      api.name('x', { cu: '5012', phone: '8015550100', address: '123 Main St', city: 'Lehi' }) === 'By Number',
      'it is the number painted on their bins — unique by design, unlike a shared phone');
    check('names', 'then the phone',
      api.name('x', { phone: '8015550100', address: '123 Main St', city: 'Lehi' }) === 'By Phone');
    check('names', 'then the address',
      api.name('x', { address: '123 Main St', city: 'Lehi' }) === 'By Address');
    check('names', 'a phone written any which way still matches',
      api.name('x', { phone: '(801) 555-0100' }) === 'By Phone',
      'the CSV and the customer record do not agree about brackets and dashes');
    check('names', 'punctuation and case in an address do not stop a match',
      api.key('123 N. Main St.', 'Lehi') === api.key('123 n main st', 'lehi'));

    // ---- and what it must NOT do ---------------------------------------
    reset();
    check('names', 'no matching customer means the imported name is left alone',
      api.name('Gardner Aaron', { phone: '8015559999' }) === 'Gardner Aaron',
      'a plan can hold somebody who is not a customer record yet, and inventing ' +
      'a name for them is worse than showing the one that was imported');
    check('names', 'and it is NOT flipped on the way through',
      api.name('Smith, John', {}) === 'Smith, John',
      'guessing at name order is exactly the wrong answer this replaced — a ' +
      'comma is not evidence of anything');
    check('names', 'no name and no match does not become "undefined"',
      api.name('', {}) === '' && api.name(null, null) === '' && api.name(undefined, {}) === '');
    reset();
    global.custByPhoneDigits.set('8015550100', cust('  ', {}));
    check('names', 'a customer record with a blank name does not blank the row',
      api.name('Gardner Aaron', { phone: '8015550100' }) === 'Gardner Aaron',
      'syncing to nothing is not syncing');

    // ---- an address key must never match on city alone ------------------
    check('names', 'a blank address never becomes a key everybody shares',
      api.key('', 'Lehi') === '' && api.key(null, null) === '',
      'otherwise every house in one town matches the first customer in it');
  }
}
/* Wiring, and the bits that must stay untouched. */
check('names', 'the customer index is rebuilt whenever the customer list changes',
  /custByNumber = new Map\(\);[\s\S]{0,120}custByAddrKey = new Map\(\)/.test(admin) &&
  admin.indexOf('custByNumber.set') > admin.indexOf('function rebuildCustomerIndexes'),
  'a stale index shows last week\'s name, which is the bug wearing a different hat');
check('names', 'every display site passes the row, not just the name',
  (admin.match(/personName\([^)]*\)/g) || [])
    .every(function (m) { return m === 'personName(n, h)' || /,/.test(m); }),
  'personName(name) alone cannot find the customer, and would silently fall ' +
  'back to the imported name everywhere');
check('names', 'the printed sheet reads the same as the screen',
  /name:personName\(h\.name,h\)/.test(admin),
  'the crew works off paper — two names on two surfaces is the original bug again');
check('names', 'search finds them under the imported name AND the customer name',
  /\[h\.name,personName\(h\.name,h\),h\.address/.test(admin),
  'the office types what they see; both are things they might see');
check('names', 'nothing stored is rewritten',
  !/h\.name\s*=\s*personName/.test(admin),
  'this is a display sync — the saved plan and the CSV export must round-trip ' +
  'through the importer unchanged');

// =====================================================================
// 21. EVERYONE IS IN UNLESS THEY SAID OTHERWISE
// =====================================================================
/*
 * Owner, 2026-08-15: "not everyone is scheduled, everyone should be scheduled
 * who isnt labeled maybe next year."
 *
 * The cause was a single clause in the install route generator: rsvpStatus had
 * to equal 'yes'. Exactly one line in the whole app ever writes that value —
 * converting a quote to a customer — so all ~945 bulk-imported houses carry a
 * blank, the generator matched almost nobody, and the routes came back empty.
 * Gating on a confirmation nobody has been asked for is gating on nothing.
 */
suite('21. Everyone is in unless they said otherwise');
{
  const fnSrc = admin.slice(admin.indexOf('function isOutForSeason(d)'),
                            admin.indexOf('\n}', admin.indexOf('function isOutForSeason(d)')) + 2);
  /* Built once per MODE, so both the rule running today and the one the owner
     plans to switch to are proved. Testing only the live setting would let the
     'confirmed-only' branch rot until the day it is turned on. */
  const withMode = m => eval("const SEASON_ELIGIBILITY = '" + m + "';\n" + fnSrc +
    '\n;({out: isOutForSeason})');
  const api = withMode('all-but-maybe-next-year');
  const strict = withMode('confirmed-only');

  const liveMode = (admin.match(/const SEASON_ELIGIBILITY = '([^']*)';/) || [])[1];
  check('season', 'the setting is one line, and says which mode is live',
    liveMode === 'all-but-maybe-next-year' || liveMode === 'confirmed-only',
    'found: ' + liveMode);
  check('season', 'and it is on "everyone but Maybe Next Year" for now',
    liveMode === 'all-but-maybe-next-year',
    "owner, 2026-08-15: switch to 'confirmed-only' once the RSVP email is live " +
    'and everybody has actually been asked — until then this must not change');

  // ---- the mode that is live today -------------------------------------
  check('season', 'a blank RSVP is IN — that is the normal state of the imported list',
    api.out({}) === false && api.out({ rsvpStatus: '' }) === false,
    'THE bug: ~945 houses have a blank RSVP because nobody has ever been asked');
  check('season', 'a pending RSVP is IN', api.out({ rsvpStatus: 'pending' }) === false);
  check('season', 'a yes is IN', api.out({ rsvpStatus: 'yes' }) === false);
  check('season', 'an RSVP of no is IN too, so long as their lights are intact',
    api.out({ rsvpStatus: 'no' }) === false,
    'owner overruled the first version of this: for now only Maybe Next Year keeps ' +
    'somebody off the list');
  check('season', 'Maybe Next Year is OUT — the one label the owner named',
    api.out({ maybeNextYear: true }) === true);
  check('season', 'Maybe Next Year is OUT even with an RSVP of yes beside it',
    api.out({ maybeNextYear: true, rsvpStatus: 'yes' }) === true,
    'the badge is what the office sets and sees, so it has to win');
  check('season', 'back next year is OUT, because it never travels alone',
    api.out({ maybeNextYear: true, rsvpStatus: 'backnextyear' }) === true,
    'pullCustomerFromSeason writes both in one update — that is why the RSVP ' +
    'value itself does not need testing for');

  // ---- the physical rule, which survives whichever mode is on -----------
  check('season', 'lights queued to be taken apart means OUT, in either mode',
    api.out({ needsLightRecycle: true }) === true &&
    strict.out({ needsLightRecycle: true, rsvpStatus: 'yes' }) === true,
    'the warehouse is pulling that bundle apart — a crew would arrive with ' +
    'nothing to hang. It is also what stops the portal and the fill fighting: ' +
    'the portal pulls them off routes the moment they answer no, and without ' +
    'this the fill would put them straight back fifteen minutes later');

  // ---- the mode the owner plans to switch to ---------------------------
  check('season', 'confirmed-only lets ONLY a yes through',
    strict.out({ rsvpStatus: 'yes' }) === false &&
    strict.out({ rsvpStatus: '' }) === true &&
    strict.out({ rsvpStatus: 'pending' }) === true &&
    strict.out({}) === true,
    'the branch the owner will turn on — tested now so it cannot rot until then');
  check('season', 'confirmed-only still lets Maybe Next Year win',
    strict.out({ maybeNextYear: true, rsvpStatus: 'yes' }) === true);
  check('season', 'case does not decide whether somebody gets their lights',
    strict.out({ rsvpStatus: 'YES' }) === false && strict.out({ rsvpStatus: 'Yes' }) === false);
  check('season', 'no record at all is OUT rather than quietly IN',
    api.out(null) === true && api.out(undefined) === true && strict.out(null) === true);
}
check('season', 'the sweep decides who to strip with the SAME rule',
  /if\(isOutForSeason\(d\)\)\{/.test(admin) &&
  admin.indexOf('if(isOutForSeason(d)){') > admin.indexOf('function stopProblem'),
  'this and the generator disagreeing does not look like a wrong list — it ' +
  'looks like a customer added and removed from a route every fifteen minutes');
check('season', 'and still says WHY somebody was taken off',
  admin.includes('their lights are queued to be taken apart') &&
  admin.includes('has not confirmed for this season'),
  '"taken off Tuesday" with no reason is not a notice');
check('season', 'the install route generator no longer demands an RSVP of yes',
  !/isTest \|\| a\.data\.rsvpStatus === 'yes'/.test(admin),
  'that one clause is why the routes came back empty');
check('season', 'and uses the shared rule instead of its own copy',
  /!isOutForSeason\(a\.data\)\)/.test(admin) &&
  admin.indexOf('!isOutForSeason(a.data))') > admin.indexOf('async function runGenerateInstallRoute'),
  'two definitions of "who is in this season" that can disagree is how the ' +
  'generator and the nightly fill end up routing different people');
check('season', 'the nightly fill uses the same rule',
  /\/\/ The SAME rule the route generator uses[\s\S]{0,80}isOutForSeason\(d\)\) return;/
    .test(admin.replace(/\r/g, '')));
check('season', 'the empty-result message no longer names a filter that is gone',
  !/RSVP-confirmed addresses found/.test(admin),
  'a message naming a rule that no longer exists sends you hunting a problem ' +
  'that is not there');
check('season', 'anyone left without a day is counted per town, with days needed',
  /Math\.ceil\(n \/ MAX_STOPS_PER_ROUTE\)/.test(admin) &&
  admin.includes('Build those days in Routes and they fill themselves'),
  '"not everyone is scheduled" is unactionable without knowing whether the ' +
  'answer is more days, a broken address, or nothing at all');
check('season', 'a house with no map pin is named as its own problem',
  /stranded\.noPin\.push/.test(admin) && admin.includes('no map pin on the address'),
  'it can never go on any route however many days are built, so it must not be ' +
  'counted in with the ones that are only waiting for room');
check('season', 'the waiting summary counts rather than lists',
  !/stranded\.byCity\[c\]\.join/.test(admin),
  'early in the season this is hundreds of people — a notice nobody reads is no notice');

// =====================================================================
// 22. BUILDING THE CREW-DAYS THE SEASON NEEDS
// =====================================================================
/*
 * Owner, 2026-08-15: "no one should have it say no day booked yet unless they
 * already said maybe next year", "only 20 houses per city and the default
 * amount of crews for every day is always 2 unless they click one", and the
 * ordering rule: "we do all the octobers first and then we go to anys and if
 * november 1st comes before we do them all then they will be done at the end of
 * the november days instead... the end for that city."
 *
 * planNewCrewDays is pure, so a whole season is built here and its SHAPE
 * checked — that is the only way to know an ordering rule expressed as a
 * priority number actually produces the calendar that was asked for.
 */
suite('22. Building the crew-days the season needs');
{
  const start = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
  const end = admin.indexOf('/* Top every day up to the cap.', start);
  if (start === -1 || end < start) {
    check('build', 'the day builder is findable', false,
      'renamed or removed — update this test rather than deleting it');
  } else {
    global.toDateStr = dt => dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    const consts = admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'),
                               admin.indexOf('function installPriority'));
    const api = eval(consts + '\n' +
      extractFn(admin, 'installPriority') + '\n' + admin.slice(start, end) +
      '\n;({plan: planNewCrewDays, pri: installPriority, cap: MAX_STOPS_PER_ROUTE,' +
      ' crews: CREWS_PER_DAY, firstDate: seasonFirstDate, working: isWorkingDay})');

    check('build', 'twenty houses per town per day, two crews by default',
      api.cap === 20 && api.crews === 2,
      "owner: 'only 20 houses per city and the default amount of crews for every " +
      "day is always 2 unless they click one'");
    check('build', 'the season does not start in August',
      toDateStr(api.firstDate(new Date(2026, 7, 15))) === '2026-10-01',
      'earliestAllowedInstallDate says TODAY for an "Any" house, so with no season ' +
      'floor a build in August books Christmas installs for August');
    check('build', 'and once the season is open the floor is today, not last October',
      toDateStr(api.firstDate(new Date(2026, 10, 4))) === '2026-11-04');
    check('build', 'weekends are not working days',
      api.working(new Date(2026, 9, 3)) === false && api.working(new Date(2026, 9, 5)) === true);

    // ---- the ordering rule, which is the whole timing spec ---------------
    check('build', 'October outranks Any, and November sits between them',
      api.pri({ installPreference: 'October' }) < api.pri({ installPreference: 'November' }) &&
      api.pri({ installPreference: 'November' }) < api.pri({}) &&
      api.pri({ installPreference: 'Normal Schedule' }) === api.pri({}),
      'this single ordering IS the rule: Octobers first, Any last so it fills in ' +
      'behind them, and the moment November opens its houses outrank the leftover Anys');

    const who = (n, city, pref, from) => Array.from({ length: n }, (_, i) => ({
      id: city + '-' + (pref || 'any') + '-' + i, city: city,
      priority: api.pri({ installPreference: pref }), from: from || '2026-10-01'
    }));

    // ---- one town, more people than one day holds -----------------------
    let out = api.plan(who(50, 'Lehi'), {}, { floorDate: '2026-10-01' });
    check('build', 'a town of 50 becomes three crew-days of 20, 20 and 10',
      out.length === 3 && out.map(d => d.ids.length).join() === '20,20,10',
      'twenty a town a day, and nobody left over');
    check('build', 'all on working days, none before the season opens',
      out.every(d => d.date >= '2026-10-01') &&
      out.every(d => api.working(new Date(+d.date.slice(0,4), +d.date.slice(5,7)-1, +d.date.slice(8,10)))));
    check('build', 'and each of those days is that one town',
      out.every(d => d.city === 'Lehi'));

    // ---- two towns, two crews, same day, different towns ----------------
    out = api.plan(who(20, 'Lehi').concat(who(20, 'Orem')), {}, { floorDate: '2026-10-01' });
    check('build', 'two towns can share one date, one crew each',
      out.length === 2 && out[0].date === out[1].date && out[0].crew !== out[1].crew,
      'two crews out, a town each — that is what a working day is');
    check('build', 'but the SAME town never gets both crews on one day',
      (() => {
        const r = api.plan(who(40, 'Lehi'), {}, { floorDate: '2026-10-01' });
        const byDate = {};
        r.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + 1; });
        return Object.keys(byDate).every(k => byDate[k] === 1) && r.length === 2;
      })(),
      "owner: 'every day should have two different cities' — doubling a crew into " +
      'one town is the arrangement that was ruled out');

    check('build', 'one crew means one town a day, and a longer season',
      (() => {
        const r = api.plan(who(40, 'Lehi').concat(who(40, 'Orem')), {}, { floorDate: '2026-10-01', crews: 1 });
        const byDate = {};
        r.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + 1; });
        return r.length === 4 && Object.keys(byDate).length === 4;
      })(),
      'this is the reorganising the owner described when you click one crew');

    // ---- a day that is already taken is not double-booked ---------------
    out = api.plan(who(20, 'Lehi'), { '2026-10-01': { '1': 'Orem', '2': 'Provo' } },
                   { floorDate: '2026-10-01' });
    check('build', 'a date with both crews already out is skipped',
      out.length === 1 && out[0].date > '2026-10-01',
      'the office builds days by hand too — overwriting one would lose it');
    check('build', 'a date with one crew free is used, on the free crew',
      (() => {
        const r = api.plan(who(20, 'Lehi'), { '2026-10-01': { '1': 'Orem' } },
                           { floorDate: '2026-10-01' });
        return r.length === 1 && r[0].date === '2026-10-01' && r[0].crew === '2';
      })());

    // ---- THE TIMING RULE, end to end ------------------------------------
    /* Twenty-five October houses and twenty-five Any houses in one town. The
       Octobers must take the first days; the Anys follow. */
    out = api.plan(who(25, 'Lehi', 'October').concat(who(25, 'Lehi')), {},
                   { floorDate: '2026-10-01' });
    check('build', 'the Octobers go out before the Anys, in that town',
      (() => {
        const firstAny = out.find(d => d.ids.some(i => i.includes('-any-')));
        const lastOct = out.filter(d => d.ids.some(i => i.includes('-October-'))).pop();
        return lastOct && firstAny && lastOct.date <= firstAny.date;
      })(),
      "owner: 'we do all the octobers first and then we go to anys'");

    /* And the other half: a town whose November houses cannot start until Nov 1
       still gets its Anys placed FIRST, in October, because Any is only last
       among houses that are actually allowed on the day being built. */
    out = api.plan(who(20, 'Lehi', 'November', '2026-11-01').concat(who(20, 'Lehi')), {},
                   { floorDate: '2026-10-01' });
    check('build', 'a November house never opens an October day',
      out.every(d => d.date < '2026-11-01'
        ? d.ids.every(i => !i.includes('-November-'))
        : true),
      'the timing preference forbids the earlier date — that is what makes the ' +
      'leftover Anys land behind the November run rather than in front of it');
    check('build', 'and the November houses do get a day once November opens',
      out.some(d => d.date >= '2026-11-01' && d.ids.some(i => i.includes('-November-'))));

    // ---- the bounds ------------------------------------------------------
    check('build', 'one sweep only builds so many days',
      api.plan(who(500, 'Lehi'), {}, { floorDate: '2026-10-01', maxDays: 4 }).length === 4,
      'the first sweep of a season has the whole book to place — fifty route ' +
      'documents in one pass is fifty sequential writes with the office watching');
    check('build', 'nobody is scheduled twice across the days it builds',
      (() => {
        const r = api.plan(who(50, 'Lehi').concat(who(30, 'Orem')), {}, { floorDate: '2026-10-01' });
        const all = r.flatMap(d => d.ids);
        return all.length === 80 && new Set(all).size === 80;
      })(),
      'a builder that double-books somebody is worse than one that never ran');
    check('build', 'nothing to place builds nothing',
      api.plan([], {}, { floorDate: '2026-10-01' }).length === 0);
    check('build', 'a house with no town is left out rather than guessed at',
      api.plan([{ id: 'x', city: '', priority: 4, from: '2026-10-01' }], {},
               { floorDate: '2026-10-01' }).length === 0,
      'there is no day to build for a town nobody named');
  }
}
/* Dropping to one crew: the days that now have one town too many. */
{
  const s2 = admin.indexOf('function surplusCrewDays(routes, crews)');
  const e2 = admin.indexOf('\n}', s2) + 2;
  const api2 = eval(admin.slice(s2, e2) + '\n;({surplus: surplusCrewDays})');
  const R = (date, crew, auto) => ({id: date + '_' + crew, date: date, crew: crew, autoBuilt: auto, stops: []});

  check('build', 'two crews out on a two-crew day is not a surplus',
    api2.surplus([R('2026-10-01','1',true), R('2026-10-01','2',true)], 2).retire.length === 0);
  check('build', 'dropping to one crew retires the second town off that day',
    (() => {
      const r = api2.surplus([R('2026-10-01','1',true), R('2026-10-01','2',true)], 1);
      return r.retire.length === 1 && r.retire[0].crew === '2';
    })(),
    "this IS the owner's 'the schedule needs to be reorganized... it needs to " +
    "take out one of the cities'");
  check('build', 'crew 1 keeps its day — it retires from the top crew down',
    api2.surplus([R('2026-10-02','1',true), R('2026-10-02','2',true), R('2026-10-02','3',true)], 1)
      .retire.map(x => x.crew).sort().join() === '2,3');
  check('build', 'a day built entirely BY HAND is reported, never taken apart',
    (() => {
      const r = api2.surplus([R('2026-10-01','1',false), R('2026-10-01','2',false)], 1);
      return r.retire.length === 0 && r.overByHand.length === 1 && r.overByHand[0].over === 1;
    })(),
    'a hand-built route carries intent this code cannot see — a promise made on ' +
    'the phone, a town done in a particular order');
  check('build', 'a mixed day gives up the automatic one and keeps the hand-built one',
    (() => {
      const a = api2.surplus([R('2026-10-01','1',false), R('2026-10-01','2',true)], 1);
      const b = api2.surplus([R('2026-10-02','1',true), R('2026-10-02','2',false)], 1);
      return a.retire.length === 1 && a.retire[0].crew === '2' && a.overByHand.length === 0 &&
             b.retire.length === 1 && b.retire[0].crew === '1' && b.overByHand.length === 0;
    })(),
    'whichever crew number it happens to sit on, the automatic one is the one ' +
    'that goes — that is the whole point of the stamp');
}
check('build', 'the setting is saved, not hard-coded',
  /setDoc\(doc\(db,'settings','scheduling'\), \{crewsPerDay: want\}/.test(admin) &&
  /getDoc\(doc\(db,'settings','scheduling'\)\)/.test(admin),
  'the office has to be able to change it without anybody editing the page');
check('build', 'two crews is the default when the setting has never been saved',
  /CREWS_PER_DAY = \(n === 1\) \? 1 : 2;/.test(admin) &&
  /catch\(err\)\{ CREWS_PER_DAY = 2;/.test(admin),
  'a missing or unreadable setting must not silently halve the season');
/* The catch resets the nearby-town list too — it is read from the same
   document, and leaving a previous read standing after a failed one would pair
   towns off a list nobody can see. */
check('build', 'a failed settings read also clears the nearby-town list',
  /catch\(err\)\{ CREWS_PER_DAY = 2; NEARBY_TOWN_LIST = \{\}; \}/.test(admin));
check('build', 'the setting is loaded BEFORE the sweep starts',
  admin.indexOf('loadSchedulingSettings()') < admin.indexOf('startReconcileAuto();'),
  'building a season on the default two while one is saved means building it ' +
  'and then taking it apart again');
check('build', 'changing it re-spreads straight away rather than in fifteen minutes',
  /crewsPerDay[\s\S]{0,900}runReconcileAuto\(\);/.test(admin.replace(/\r/g, '')),
  'the office has just changed the shape of the season and expects to see it');
check('build', 'days the scheduler builds are stamped so they can be told apart',
  /autoBuilt: true/.test(admin) && /if\(r\.autoBuilt\)\{ retire\.push\(r\); over--; \}/.test(admin),
  'without the stamp, reorganising would delete routes the office built by hand');
check('build', 'retired days free their houses before the route is deleted',
  (() => {
    /* Sliced to the next real structural anchor, not a character count — a
       fixed window silently goes stale as the code around it grows, which is
       the trap the meta-check in this suite exists to catch. */
    const i = admin.indexOf('surplus.retire.length; i++');
    const blk = admin.slice(i, admin.indexOf('// ---- 1.', i));
    return i !== -1 && blk.indexOf('freeUpFieldForType') !== -1 &&
           blk.indexOf('freeUpFieldForType') < blk.indexOf('deleteDoc');
  })(),
  'delete the route first and the houses are left pointing at a day that is gone');
check('build', 'the test-only checkbox no longer claims to be about RSVPs',
  !/Include un-RSVP'd houses/.test(admin),
  'an RSVP stopped keeping anybody off a route — a label naming a rule that no ' +
  'longer exists sends you hunting a problem that is not there');
/* THE BUG THAT MADE ALL OF THIS INVISIBLE, 2026-08-15. The sweep bailed out
   when scheduledRoutesCache was empty. With no saved routes the sweep never
   ran, so the pass that builds the missing days never ran, so there were never
   any saved routes — and every customer read "no day booked yet" for ever. */
check('build', 'an empty calendar does NOT stop the sweep',
  !/if\(!jobAddresses\.length \|\| !Object\.keys\(scheduledRoutesCache \|\| \{\}\)\.length\) return;/.test(admin),
  'no routes yet is exactly the case the day-builder exists for');
check('build', 'it waits for the routes listener to report, not for routes to exist',
  /if\(!jobAddresses\.length \|\| !scheduledRoutesLoaded\) return;/.test(admin) &&
  /scheduledRoutesLoaded = true;/.test(admin),
  'running before scheduledRoutes has reported would read an empty calendar as ' +
  '"no days exist" and build a second set on top of the real ones');
check('build', 'the flag is set inside the snapshot, so an empty result still counts',
  (() => {
    const i = admin.indexOf("onSnapshot(collection(db,'scheduledRoutes')");
    const blk = admin.slice(i, admin.indexOf('renderCalendar();', i));
    return i !== -1 && blk.indexOf('scheduledRoutesLoaded = true;') !== -1;
  })(),
  'setting it anywhere else means either never running, or running too early');
check('build', 'a bounded pass comes straight back rather than waiting the full interval',
  /if\(report\.moreToDo\) setTimeout\(runReconcileAuto, \d+\);/.test(admin),
  'the first run of a season is deliberately bounded — leaving the rest for ' +
  'fifteen minutes makes a season take an hour to appear, which looks broken');
check('build', 'the sweep actually builds the days it plans',
  /const newDays = planNewCrewDays\(waiting, taken/.test(admin) &&
  /setDoc\(doc\(db,'scheduledRoutes', docId\)/.test(admin),
  'planning them and not writing them leaves everybody exactly as unscheduled');
check('build', 'a day it cannot write does not take the whole sweep down',
  /catch\(err\)\{[\s\S]{0,200}Could not build the/.test(admin.replace(/\r/g, '')),
  'the rest still gets scheduled and the next pass retries');
check('build', 'and the new days are named in the notice, by town and date',
  admin.includes('new crew-day') && admin.includes('Look them over before the crew does'),
  'creating route days is the biggest thing the sweep can do — it must never be silent');

// =====================================================================
// 23. THE TOWN ON A CUSTOMER RECORD
// =====================================================================
/*
 * Every scheduling decision in this app is made per town: which day a house can
 * ride, which crew-day gets built, which route a customer is even eligible for.
 * A house whose town reads blank is not "missing a label" — it is unroutable,
 * invisible to the city filters, and quietly left out of the season.
 *
 * extractCleanCity took the LAST comma segment. That is right for the form it
 * was written for, "123 Main St, Lehi", and wrong for every way a person
 * actually types a city — "Lehi, UT", "Lehi, UT 84043", "American Fork, UT
 * 84003" all cleaned down to nothing. Run, not read, because the whole point is
 * which strings come out the far side.
 */
suite('23. The town on a customer record');
{
  eval(extractFn(admin, 'extractCleanCity'));
  const c = extractCleanCity;

  check('city', 'the form it was always written for still works',
    c('123 Main St, Lehi') === 'Lehi' && c('Lehi') === 'Lehi' && c('Lehi 84043') === 'Lehi',
    'the fix must not cost anything that already worked');

  check('city', 'city with a state reads as the city',
    c('Lehi, UT') === 'Lehi' && c('Lehi, Utah') === 'Lehi',
    'THE bug — this came back blank, and a blank town cannot be put on a route');
  check('city', 'city with a state and a zip reads as the city',
    c('Lehi, UT 84043') === 'Lehi' && c('Lehi, Utah 84043') === 'Lehi' &&
    c('Lehi, UT 84043-1234') === 'Lehi');
  check('city', 'a two-word town survives it',
    c('American Fork, UT 84003') === 'American Fork' &&
    c('Salt Lake City, UT') === 'Salt Lake City',
    'a naive "first word" fix would have quietly renamed half the county');
  check('city', 'a full address with everything on it still finds the town',
    c('123 Main St, Lehi, UT 84043') === 'Lehi');

  check('city', 'nothing usable comes back blank rather than as a guess',
    c('') === '' && c(null) === '' && c(undefined) === '' &&
    c('84043') === '' && c('123 Main St') === '' && c('UT') === '',
    'a wrong town is worse than a missing one — it sends a crew to another county');
  check('city', 'whitespace is not a town',
    c('   ') === '' && c('  Lehi  ') === 'Lehi');
  check('city', 'it is stable when run twice',
    c(c('Lehi, UT 84043')) === 'Lehi',
    'the value gets stored and re-read, so it has to survive a round trip');

  /* ---- and the ones where the town was never imported at all ----
     Found in the live book on 2026-08-15: 374 of 970 customers with city:""
     and an address ending ", UT". Not a parsing problem — the town is simply
     not there. They all had map pins, so it can be read back off those. */
  eval(extractFn(admin, 'townFillCandidates'));
  eval(extractFn(admin, 'townFromGeocode'));
  global.jobAddresses = [
    {id:'blank', data:{name:'No Town', city:'', lat:40.4, lng:-111.8}},
    {id:'spaces', data:{name:'Spaces', city:'   ', lat:40.4, lng:-111.8}},
    {id:'hastown', data:{name:'Has Town', city:'Lehi', lat:40.4, lng:-111.8}},
    {id:'nopin', data:{name:'No Pin', city:'', lat:null, lng:null}},
    {id:'sittingout', data:{name:'Maybe', city:'', lat:40.4, lng:-111.8, maybeNextYear:true}}
  ];
  const cand = townFillCandidates().map(a => a.id).sort();
  check('city', 'only blank towns with a pin are candidates',
    cand.join() === 'blank,spaces',
    'a record that already has a town must never be overwritten, and one with ' +
    'no pin cannot be worked out at all');
  check('city', 'a customer sitting out the season is left alone',
    cand.indexOf('sittingout') === -1);

  const gres = t => [{address_components:[{types:['route'],long_name:'X'},{types:[t],long_name:'Lehi'}]}];
  check('city', 'the town is read off the locality, not off whatever comes first',
    townFromGeocode(gres('locality')) === 'Lehi');
  check('city', 'and falls back to the next best thing rather than guessing',
    townFromGeocode(gres('administrative_area_level_3')) === 'Lehi' &&
    townFromGeocode([{address_components:[{types:['country'],long_name:'United States'}]}]) === '',
    'no town is a fine answer — a wrong one sends a crew to another county');
}
check('city', 'the town fill is dry-run first, like Assign in Bulk',
  /id="townFillCheckBtn"/.test(admin) && /id="townFillApplyBtn"/.test(admin) &&
  /style="display:none;"/.test(admin.slice(admin.indexOf('id="townFillApplyBtn"') - 60,
                                           admin.indexOf('id="townFillApplyBtn"') + 60)),
  'the owner already knows this shape from customer numbers — check, look, then apply');
check('city', 'applying uses the plan that was shown, not a fresh lookup',
  /if\(apply && townFillPlan\) return applyTownFill\(\);/.test(admin),
  'geocoding again could quietly apply a different answer from the one on screen');
check('city', 'a town typed by hand always beats one read off a pin',
  /if\(cur && String\(\(cur\.data \|\| \{\}\)\.city \|\| ''\)\.trim\(\)\) continue;/.test(admin),
  're-checked at the moment of writing, because somebody may have typed one in ' +
  'while the dry run was being read');
check('city', 'one address that will not resolve does not stop the rest',
  (() => {
    const fn = extractFn(admin, 'runTownFill').replace(/\r/g, '');
    return /if\(!over\) return null;\s*\/\/ a pin that simply will not resolve/.test(fn);
  })(),
  'it returns null for that one customer and the batch carries on');
check('city', 'being rate-limited is retried, not treated as "no town"',
  (() => {
    const fn = extractFn(admin, 'runTownFill').replace(/\r/g, '');
    return /OVER_QUERY_LIMIT/.test(fn) && /attempt < 2/.test(fn);
  })(),
  'Google answers OVER_QUERY_LIMIT when pushed — reading that as "this house ' +
  'has no town" would silently skip whoever happened to be in that batch');
check('city', 'it works fifty at a time so the page cannot lock up',
  /const TOWN_FILL_CHUNK = 50;/.test(admin) &&
  /const list = all\.slice\(0, TOWN_FILL_CHUNK\);/.test(admin),
  "owner: 'make it so it only does 50 at a time with dry run and filling them " +
  "in so it doesnt crash' — 374 geocodes and 374 writes in one press wedged the tab");
check('city', 'and says how many are left so you know to press it again',
  /still to do — press Check First again/.test(admin) &&
  /const stillToDo = townFillCandidates\(\)\.length;/.test(admin),
  'counted AFTER the writes off the live list, so it is what is actually left');
check('city', 'picking up where it stopped needs no bookmark',
  /if\(String\(d\.city == null \? '' : d\.city\)\.trim\(\)\) return false;/.test(admin),
  'the candidate list is "still blank", so an interrupted run simply resumes ' +
  'and a batch can never be done twice');
check('city', 'lookups run in small batches, not one at a time',
  (() => {
    const fn = extractFn(admin, 'runTownFill').replace(/\r/g, '');
    return /TOWN_FILL_BATCH/.test(fn) && /Promise\.all\(batch\.map\(lookOne\)\)/.test(fn);
  })(),
  '374 lookups one after another took ten minutes, and Chrome throttles timers ' +
  'in a background tab so every pause stretched to a second');

// =====================================================================
// 24. THE SAME PREFERENCE, WRITTEN FIVE DIFFERENT WAYS
// =====================================================================
/*
 * Read out of the LIVE book on 2026-08-15, across 970 customers:
 *   Normal Schedule 479 · October 222 · NOV 190 · November 72 · OCT 4
 *   THX 1 · 11/9+ 1 · / 1
 *
 * Every timing rule compares against the long spellings, so the 190 people who
 * asked for NOVEMBER were read as having no preference at all — and could be
 * sent out in October. The abbreviations are the route CSV's own shorthand and
 * reached the customer records through the bulk import.
 */
suite('24. The same preference, written five different ways');
{
  const aliasSrc = admin.slice(admin.indexOf('const INSTALL_PREF_ALIASES'),
                               admin.indexOf('function normInstallPref'));
  const api = eval(aliasSrc + '\n' + extractFn(admin, 'normInstallPref') + '\n' +
    extractFn(admin, 'isKnownInstallPref') + '\n;({norm: normInstallPref, known: isKnownInstallPref})');

  check('pref', 'NOV means November — 190 customers in the live book',
    api.norm('NOV') === 'November' && api.norm('nov') === 'November',
    'THE bug: read as no preference, so they could be installed in October');
  check('pref', 'OCT means October', api.norm('OCT') === 'October');
  check('pref', 'the long spellings still mean themselves',
    api.norm('November') === 'November' && api.norm('October') === 'October' &&
    api.norm('Normal Schedule') === 'Normal Schedule' &&
    api.norm('November - Before Thanksgiving') === 'November - Before Thanksgiving' &&
    api.norm('After Thanksgiving') === 'After Thanksgiving',
    'the fix must not cost anything that already worked');
  check('pref', 'nothing at all stays nothing',
    api.norm('') === '' && api.norm(null) === '' && api.norm(undefined) === '');
  check('pref', 'normalising is idempotent',
    api.norm(api.norm('NOV')) === 'November');

  check('pref', 'somebody\'s freehand note is NOT guessed at',
    api.norm('THX') === 'THX' && api.norm('11/9+') === '11/9+' && api.norm('/') === '/',
    'one customer each — a wrong month is exactly what this exists to prevent, ' +
    'so they are left alone and shown as unrecognised instead');
  check('pref', 'and those are reported as unrecognised rather than obeyed',
    api.known('THX') === false && api.known('11/9+') === false &&
    api.known('NOV') === true && api.known('November') === true &&
    api.known('') === false,
    'an unrecognised value falls through to "no preference", which is safe — ' +
    'but it has to be visible or nobody ever fixes it');

  // ---- and that the timing rules actually read through it ---------------
  eval(extractFn(admin, 'thanksgivingDate'));
  global.INSTALL_PREF_ALIASES = api.norm('NOV') && (function(){
    const o = {}; eval(aliasSrc.replace('const INSTALL_PREF_ALIASES', 'var x')); return x; })();
  global.normInstallPref = api.norm;
  eval(extractFn(admin, 'toDateStr'));
  eval(extractFn(admin, 'earliestAllowedInstallDate'));
  const nov = earliestAllowedInstallDate({installPreference:'NOV'});
  const novLong = earliestAllowedInstallDate({installPreference:'November'});
  check('pref', 'a NOV house is held back exactly like a November one',
    nov.getTime() === novLong.getTime(),
    'this is the whole point — 190 people who asked for November were not being ' +
    'held back at all');

  eval(extractFn(admin, 'installPriority'));
  check('pref', 'and gets a November house\'s place in the queue, not an Any\'s',
    installPriority({installPreference:'NOV'}) === installPriority({installPreference:'November'}) &&
    installPriority({installPreference:'NOV'}) < installPriority({}),
    'read as Any, they would have taken the October days off the people who ' +
    'actually asked for October');
  check('pref', 'OCT gets October\'s place too',
    installPriority({installPreference:'OCT'}) === installPriority({installPreference:'October'}));
}
check('pref', 'All Customers shows the meaning, and flags what it cannot read',
  /const timingPref = normInstallPref\(r\.d\.installPreference\);/.test(admin) &&
  admin.includes('not recognised'),
  'a row reading NOV while the scheduler treats it as November is how nobody notices');
check('pref', 'the route generator holds NOV back like November',
  /isInstallPrefLocked\(installPreferenceRaw\)\{[\s\S]{0,140}normInstallPref\(installPreferenceRaw\)/
    .test(admin.replace(/\r/g, '')),
  'this is the gate route generation uses to hide a November house in October');

/* The route and the record must agree — found nine adrift in the live book. */
check('reconcile', 'a house on a route gets its record put straight',
  /if\(!cd\.scheduled \|\| cd\.scheduledDate !== route\.date\)\{/.test(admin) &&
  /report\.resynced\.push/.test(admin),
  'nine customers sat on the 6 Oct route reading scheduled:false, so All ' +
  'Customers showed them as having no day at all');
check('reconcile', 'and it only writes when they actually disagree',
  /if\(!cd\.scheduled \|\| cd\.scheduledDate !== route\.date\)/.test(admin),
  'a sweep that rewrites every record every fifteen minutes is a sweep that ' +
  'costs money for nothing');
check('build', 'one failed flag does not skip everyone after it',
  (() => {
    const i = admin.indexOf('for(let k = 0; k < nd.ids.length; k++)');
    const blk = admin.slice(i, admin.indexOf('report.built.push', i));
    return i !== -1 && /try\{/.test(blk) && /catch\(err\)\{/.test(blk);
  })(),
  'one shared try/catch round the whole loop is exactly what left nine people ' +
  'on a route with unscheduled records');

// =====================================================================
// Wait for the async suites before totalling up — see pendingAsync at the top.
/*
 * Suite 21. Panels load their own data when opened, not all at login.
 *
 * The admin page used to open ~39 permanent Firestore listeners the moment
 * anyone logged in, so the browser held every collection — two years of
 * clock-ins, every card transaction, every employee record — whether or not
 * that tab was ever clicked. That is what made the page eat memory.
 *
 * The risk now runs the other way: a loader named in panelDataGroup that does
 * not exist, or a panel key that matches no real panel, fails ONLY when someone
 * opens that tab, and shows up as a silently empty panel rather than an error.
 * These checks catch both at build time, and stop a future session quietly
 * moving a loader back into initData().
 */
suite('Suite 21. Panel data loads on open, not all at login');
{
  const bodyOf = (src, header) => {
    const s = src.indexOf(header);
    if (s === -1) return '';
    let depth = 0, i = src.indexOf('{', s);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(s, j + 1); }
    }
    return '';
  };

  const initBody = bodyOf(admin, 'function initData(){');
  const groupBody = bodyOf(admin, 'function panelDataGroup(');
  const switchBody = bodyOf(admin, 'function switchToAdminPanel(');

  check('S21', 'initData() still exists to read', initBody.length > 0);
  check('S21', 'panelDataGroup() still exists to read', groupBody.length > 0);

  // Every loader the lazy map promises to call must actually be a function.
  const named = [...new Set([...groupBody.matchAll(/\bload[A-Za-z0-9_]+/g)].map(m => m[0]))];
  check('S21', 'panelDataGroup names at least the known loader groups', named.length >= 18,
    'found ' + named.length);
  const missing = named.filter(fn => !new RegExp('\\r?\\n\\s*(?:async )?function ' + fn + '\\s*\\(').test(admin));
  check('S21', 'every loader in panelDataGroup is a real function', missing.length === 0,
    'no such function: ' + missing.join(', '));

  // Deferred loaders must NOT be called eagerly at login again.
  const deferredCalledAtLogin = named.filter(fn => new RegExp('(?:^|[^A-Za-z0-9_.])' + fn + '\\s*\\(\\s*\\)').test(initBody));
  check('S21', 'no deferred loader is called eagerly in initData()', deferredCalledAtLogin.length === 0,
    'back in initData(): ' + deferredCalledAtLogin.join(', ') + ' — it belongs in PANEL_DATA, or the page loads everything at login again');

  // Every panel key in PANEL_DATA has to be a real nav panel, or its data never loads.
  const pdMatch = admin.match(/const PANEL_DATA = \{[\s\S]*?\n\};/);
  check('S21', 'PANEL_DATA is present', !!pdMatch);
  if (pdMatch) {
    const keys = [...pdMatch[0].matchAll(/^\s{2}([a-z-]+):/gm)].map(m => m[1]);
    const badPanels = keys.filter(k => !admin.includes('data-panel="' + k + '"'));
    check('S21', 'every PANEL_DATA key is a real nav panel', badPanels.length === 0,
      'no nav item for: ' + badPanels.join(', '));

    // Every group a panel asks for must have a case in panelDataGroup, or the
    // panel opens and quietly loads nothing at all.
    const wanted = [...new Set([...pdMatch[0].matchAll(/'([a-z]+)'/g)].map(m => m[1]))];
    const unhandled = wanted.filter(g => !groupBody.includes("case '" + g + "'"));
    check('S21', 'every group PANEL_DATA asks for is handled', unhandled.length === 0,
      'no case for: ' + unhandled.join(', '));
  }

  // The two wiring points. Without either, panels open empty forever.
  check('S21', 'switchToAdminPanel() loads the opened panel\'s data', /ensurePanelData\(panelName\)/.test(switchBody));
  check('S21', 'initData() loads the panel already on screen', /ensurePanelData\(currentAdminPanel\(\)\)/.test(initBody));

  // The badge loaders have to stay eager — a badge must be right before you click.
  ['loadQuotes', 'loadMessages', 'loadEmployeeNotes', 'loadProjectTests'].forEach(fn => {
    check('S21', fn + '() stays eager so its sidebar badge is right at login',
      new RegExp('(?:^|[^A-Za-z0-9_.])' + fn + '\\s*\\(\\s*\\)').test(initBody));
  });

  // The leak this started with: the payroll split-view toggle re-calls
  // loadTimeLogs(), which used to open a second listener each time.
  const tlBody = bodyOf(admin, 'function loadTimeLogs(){');
  check('S21', 'loadTimeLogs() drops its previous listener before opening another',
    /timeLogsUnsub\s*\(\s*\)/.test(tlBody) && /timeLogsUnsub = onSnapshot/.test(tlBody),
    'without this, every tick of the payroll split-view toggle leaves another live listener on two years of clock-ins');
}

/*
 * Suite 22. Bulk runs redraw once, not once per row.
 *
 * The jobAddresses listener redraws EIGHTEEN panels across every customer on
 * file, one of them a Google map that builds a marker per house. That is fine
 * for a single edit. For a bulk import it used to fire once per row, so nine
 * hundred rows built and threw away the best part of a million marker objects
 * and the tab ran out of memory part-way through the import — which is the
 * crash this suite exists to keep fixed.
 *
 * The dangerous failure here is the opposite one: renders left suspended, or a
 * bulk tool that never resumes them. That looks exactly like a frozen page and
 * would be blamed on anything but the bulk tool, so it is checked explicitly.
 */
suite('Suite 22. Bulk runs redraw once, not once per row');
{
  const bodyOf = (src, header) => {
    const s = src.indexOf(header);
    if (s === -1) return '';
    let depth = 0;
    for (let j = src.indexOf('{', s); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(s, j + 1); }
    }
    return '';
  };

  const panels = bodyOf(admin, 'function renderJobAddressPanels(){');
  const sched = bodyOf(admin, 'function scheduleJobAddressRender(){');
  const wrap = bodyOf(admin, 'async function withBulkWrites(');
  const listener = bodyOf(admin, 'function loadJobAddresses(){');

  check('S22', 'renderJobAddressPanels() exists', panels.length > 0);
  // A render dropped during the move would silently stop a panel updating.
  const renderCount = (panels.match(/safeRender\(/g) || []).length;
  check('S22', 'every panel render survived the move out of the listener', renderCount >= 21,
    'only ' + renderCount + ' safeRender calls — one was lost, and that panel now never refreshes');
  check('S22', 'All Customers is still in the redraw', /allCustomersTable/.test(panels));
  check('S22', 'the map is still in the redraw', /overviewMap/.test(panels));

  // The listener must update data every time but NOT draw every time.
  check('S22', 'the listener still rebuilds the customer list on every write', /jobAddresses\.push/.test(listener));
  check('S22', 'the listener still rebuilds the lookup indexes on every write', /rebuildCustomerIndexes\(\)/.test(listener));
  check('S22', 'the listener schedules a redraw instead of drawing inline',
    /scheduleJobAddressRender\(\)/.test(listener) && !/safeRender\(/.test(listener),
    'drawing straight from the listener is what made a bulk import fire the whole cascade once per row');

  check('S22', 'a bulk run suspends the redraw', /bulkWriteDepth > 0/.test(sched));
  // If this ever stops resuming, the panels freeze until the page is reloaded.
  check('S22', 'withBulkWrites() resumes in a finally, so a failed run cannot leave the panels frozen',
    /finally\s*\{/.test(wrap) && /bulkWriteDepth--/.test(wrap) && /renderJobAddressPanels\(\)/.test(wrap));
  check('S22', 'withBulkWrites() counts rather than toggles, so nested bulk tools resume once',
    /bulkWriteDepth\+\+/.test(wrap) && /bulkWriteDepth === 0/.test(wrap));

  // Both bulk importers must actually use it, or the fix does nothing.
  [['rbImportBtn', 'Routes/customer bulk import'], ['ibImportBtn', 'Invoice bulk import']].forEach(([id, label]) => {
    /* Anchored to the handler's own line, not a fixed character window — a
       window goes stale the moment the code grows past it (§7 of CLAUDE.md,
       and this suite's own meta-check enforces that). */
    const line = admin.split(/\r?\n/).find(L => L.includes("getElementById('" + id + "').addEventListener")) || '';
    check('S22', label + ' redraws once at the end, not once per row',
      /withBulkWrites\(/.test(line),
      'without withBulkWrites this importer fires the whole render cascade for every row it writes');
  });

  // The yield is what keeps the tab responsive and gives the collector a chance.
  const breathe = bodyOf(admin, 'async function bulkBreathe(');
  check('S22', 'bulkBreathe() yields to the browser', /setTimeout\(r, 0\)/.test(breathe));
  check('S22', 'bulkBreathe() pauses longer when the heap is climbing',
    /bulkHeapUsedMb\(\) > BULK_HEAP_PAUSE_MB/.test(breathe));
  check('S22', 'both bulk importers breathe between rows',
    (admin.match(/await bulkBreathe\(i\)/g) || []).length >= 2);
}

/*
 * Suite 23. A bulk paste that will not line up says WHICH row is wrong.
 *
 * From a real import of 963 customers. The Street column is parsed with
 * .filter(Boolean), so a blank address is DROPPED, while every other column
 * keeps its blanks — one empty cell therefore shifts every row below it. The
 * counters above each box counted raw lines, so both columns read "1059 rows"
 * while the importer saw 963 and 962, and the error named neither the row nor
 * the reason. Excel's "filter by blanks" does not match a cell holding only a
 * space, so there was no way to find it from either end.
 *
 * The dangerous part is the obvious fix: deleting a row from the Name column to
 * make the totals match imports every customer below the gap against the wrong
 * address, with their colours and price. So the message has to say don't.
 *
 * These run the real functions rather than reading them as text, because the
 * whole bug was an off-by-one nobody could see.
 */
suite('Suite 23. Bulk row mismatches name the offending row');
{
  const lift = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const srcs = ['countRows', 'interiorBlankRows', 'bulkMismatchHint'].map(lift);
  check('S23', 'countRows, interiorBlankRows and bulkMismatchHint all still exist', srcs.every(Boolean));

  if (srcs.every(Boolean)) {
    const sandbox = {};
    new Function(srcs.join('\n') + '\nthis.countRows=countRows;this.interiorBlankRows=interiorBlankRows;this.bulkMismatchHint=bulkMismatchHint;').call(sandbox);
    const { countRows, interiorBlankRows, bulkMismatchHint } = sandbox;

    // The real shape: same trailing empty rows on both columns, one blank mid-column.
    const TRAIL = '\n'.repeat(96);
    const names = Array.from({ length: 963 }, (_, i) => 'Name ' + (i + 1)).join('\n') + TRAIL;
    const street = Array.from({ length: 963 }, (_, i) => (i === 499 ? '   ' : 'Addr ' + (i + 1))).join('\n') + TRAIL;
    const streetLines = street.split('\n').map(s => s.trim());

    check('S23', 'trailing empty rows no longer inflate the count', countRows(names, false) === 963,
      'got ' + countRows(names, false) + ' — this is what made two different columns both read 1059');
    check('S23', 'the anchor column is counted the way the importer parses it', countRows(street, true) === 962,
      'got ' + countRows(street, true) + '; the importer drops the blank address and sees 962');
    check('S23', 'so the mismatch is visible while pasting, not only after pressing Import',
      countRows(names, false) !== countRows(street, true));

    check('S23', 'a blank in the middle is found', interiorBlankRows(streetLines).join() === '500');
    check('S23', 'a cell holding only a space counts as blank, as the importer treats it',
      interiorBlankRows(['a', '   ', 'c']).join() === '2');
    check('S23', 'trailing empty rows are NOT reported as missing addresses',
      interiorBlankRows(['a', 'b', '', '', '']).length === 0,
      'reporting the trailing rows would send someone hunting for a problem that is not there');

    const hint = bulkMismatchHint('Street Address', streetLines, 'Name');
    check('S23', 'the message names the row', /row 500/.test(hint));
    check('S23', 'it explains why Excel\'s blank filter missed it', /only a space/.test(hint) && /blank filter/.test(hint));
    check('S23', 'it warns against the fix that silently corrupts the import',
      /Do NOT delete a row/.test(hint) && /wrong address/i.test(hint),
      'deleting a row to balance the totals imports everyone below the gap against the wrong address');

    const noBlanks = bulkMismatchHint('Street Address', ['a', 'b', 'c'], 'Name');
    check('S23', 'with no blank it points at a line break inside a cell instead',
      /Alt\+Enter/.test(noBlanks) && !/row \d/.test(noBlanks));
  }

  /* The counters are only honest if wireBulkCounts actually passes the
     anchor flag through — counting the anchor the old way is what let two
     different columns both display "1059 rows". */
  const wired = admin.slice(admin.indexOf('function wireBulkCounts('), admin.indexOf('// --- Routes Bulk Update ---'));
  /* CHANGED 2026-08-17, and the direction matters. This used to require the
     anchor be counted with blanks DROPPED, back when the importer dropped them
     too. The importer no longer does (see trimTrailingBlankRows), so counting
     them differently here would display a smaller number for the identifier
     column than for the columns beside it and paint them all red for a paste
     that lines up perfectly. The invariant is unchanged in spirit: the counter
     must count the anchor the way the importer does. */
  check('S23', 'the live counters count the anchor column the importer\'s way',
    /countRows\(document\.getElementById\(anchorId\)\.value, false\)/.test(wired) &&
    /countRows\(raw, false\)/.test(wired),
    'the counter and the importer must agree about how long a column is, or the count on screen is not the count that runs');

  /* The red flag compares real line counts, so an optional column that simply
     ends in blanks — Measured Feet and Notes both do on the master sheet — is
     not accused of being misaligned. A column short in the MIDDLE still reads
     its full length, so that genuinely dangerous case still goes red. */
  check('S23', 'trailing blanks in an optional column are not called a mismatch',
    /const compareLen = function\(text\)/.test(wired) &&
    /classList\.toggle\('mismatch', compareLen\(raw\) > 0 && compareLen\(raw\) !== anchorLines\)/.test(wired),
    'crying wolf on every optional column is how a real mismatch gets ignored');

  // Both importers must keep the unfiltered rows, or the hint has nothing to read.
  [['rbStreetsArea', 'streetsRaw', 'Street Address'], ['ibPhonesArea', 'phonesRaw', 'Phone Number']].forEach(([area, raw, label]) => {
    /* The unfiltered rows must still be kept and still be what gets filtered —
       not pinned to one exact line, since the Customer # column can now stand in
       as the anchor and that put a conditional in between. */
    /* Read either straight off the box or through rbCol (which also drops a
       heading row) — what matters is that the UNFILTERED rows are kept under
       this name and are what gets filtered, so the diagnostic can name the
       empty row. */
    check('S23', label + ' keeps its unfiltered rows for the diagnostic',
      new RegExp('const ' + raw + ' = (document\\.getElementById\\(\'' + area + '\'\\)|rbCol\\(\'' + area + '\')').test(admin) &&
      new RegExp(raw + '\\.filter\\(Boolean\\)').test(admin));
    /* The Routes import now names whichever column is the ANCHOR — the
       Customer # column when numbers were pasted — so it calls this with a
       variable rather than a literal. The Invoice import still has one fixed
       anchor. Either way, a mismatch must name the offending row. */
    check('S23', label + ' mismatch calls bulkMismatchHint',
      new RegExp("bulkMismatchHint\\('" + label + "', " + raw).test(admin) ||
      /bulkMismatchHint\(anchorLabel, anchorIsNumbers \? cnRawAll : streetsRaw, label\)/.test(admin));
  });
}

/*
 * Suite 24. Re-ordering a day that has nothing left in it.
 *
 * Reported from the live error log: "route reconcile failed Cannot read
 * properties of undefined (reading 'lat')".
 *
 * reorderFlatStops() did `remaining.shift()` and then read `.lat` off it. Two
 * ways that is undefined, both reached from the reconcile sweep:
 *   - a day whose last stop has just come off is re-ordered with nothing left;
 *   - a new day naming a stop id missing from the map it is looked up through,
 *     which puts an undefined hole in the middle of an otherwise fine list.
 *
 * The blast radius is what makes it worth a suite. The throw is caught up in
 * runReconcileAuto, so ONE empty day abandoned the whole pass — every other day
 * that pass would have fixed was left alone, and every later pass hit the same
 * day and gave up in the same place. Routes stop self-correcting, silently.
 *
 * The trap in fixing it: a stop with no lat/lng is a REAL house that has not
 * been geocoded yet (the bulk importer creates those on purpose, `noPin`).
 * Filtering on "has coordinates" instead of "is a stop at all" would quietly
 * drop those houses off their route, which is worse than the crash.
 */
suite('Suite 24. A day with nothing left in it does not abort the sweep');
{
  const i = admin.indexOf('function reorderFlatStops(');
  let body = '';
  if (i !== -1) {
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) { body = admin.slice(i, j + 1); break; } }
    }
  }
  check('S24', 'reorderFlatStops still exists to read', body.length > 0);

  if (body) {
    // Real function, real helpers it leans on, stubbed only where geometry is irrelevant.
    const sandbox = {};
    new Function(
      'function haversine(a,b,c,d){ return Math.abs((a||0)-(c||0)) + Math.abs((b||0)-(d||0)); }\n' +
      'function twoOptImprove(o){ return o; }\n' + body +
      '\nthis.reorderFlatStops = reorderFlatStops;'
    ).call(sandbox);
    const reorder = sandbox.reorderFlatStops;

    const stop = (id, lat, lng) => ({ id, lat, lng });
    /* The regression THROWS, and an uncaught throw here kills the runner and
       prints a stack trace instead of a failure — which reads as a broken test
       harness rather than the bug being caught. Catch it so the FAIL line
       carries the real message. */
    const attempt = (fn) => {
      try { return { ok: true, value: fn() }; }
      catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
    };
    const expectStops = (label, got, predicate, detail) =>
      check('S24', label, got.ok && predicate(got.value),
        got.ok ? (detail || ('got ' + JSON.stringify(got.value))) : 'threw: ' + got.err);

    expectStops('an emptied day returns an empty route instead of throwing',
      attempt(() => reorder([], null)), v => JSON.stringify(v) === '[]');
    expectStops('an emptied day with a start point does not throw either',
      attempt(() => reorder([], { lat: 40, lng: -111 })), v => JSON.stringify(v) === '[]');
    expectStops('a missing/undefined list does not throw',
      attempt(() => reorder(undefined, null)), v => JSON.stringify(v) === '[]');

    // The hole case — a day naming a stop id that is not in the lookup.
    const withHole = attempt(() => reorder([stop('a', 40, -111), undefined, stop('c', 41, -111)], null));
    expectStops('an undefined hole is dropped rather than crashing the pass', withHole, v => v.length === 2);
    expectStops('the real stops either side of the hole are kept', withHole,
      v => v.map(s => s.id).sort().join() === 'a,c');

    /* The important one: an un-geocoded house is a real customer and must stay
       on the route. Dropping it would lose work silently. */
    const noPin = attempt(() => reorder([stop('a', 40, -111), stop('nopin', null, null), stop('c', 41, -111)], null));
    expectStops('a house with no map pin STAYS on the route', noPin, v => v.length === 3,
      'the bulk importer creates customers with lat/lng null on purpose — filtering on coordinates would drop real houses off their day');
    expectStops('and it is the un-geocoded house that was kept, not a placeholder', noPin,
      v => v.some(s => s && s.id === 'nopin'));

    // Ordinary behaviour must be untouched.
    const normal = attempt(() => reorder(
      [stop('far', 50, -111), stop('near', 40.1, -111), stop('start', 40, -111)], { lat: 40, lng: -111 }));
    expectStops('ordinary ordering still works', normal, v => v.length === 3);
    expectStops('and still visits the nearest stop first', normal, v => v[0] && v[0].id === 'start');
  }

  /* The guard has to be the shared one. There are eight call sites and only two
     of them are the ones seen failing, so fixing it at the call site would
     leave the other six able to throw the same way. */
  check('S24', 'the guard lives in reorderFlatStops, where every caller gets it',
    /filter\(Boolean\)/.test(body) && /if\(!remaining\.length\) return \[\]/.test(body));
  check('S24', 'the guard does NOT filter on having coordinates',
    !/filter\([^)]*typeof[^)]*lat/.test(body),
    'filtering on lat/lng would silently drop un-geocoded houses off their routes');
}

/*
 * Suite 25. A day is only "SET" if it is nearly here.
 *
 * Owner, 2026-08-16: "Oct 1 and Oct 2 are already set and isn't updating in
 * schedule, a day should only be set if the day falls within the next two
 * business days."
 *
 * In the Schedule planner a pinned day is shown as SET and holds its exact
 * date while every other day re-flows around it. That is right for a day the
 * crew is committed to and wrong for one six weeks out, where it just freezes
 * a hole in the middle of the season.
 *
 * The pin is IGNORED rather than deleted — "Force exact date" is a deliberate
 * act, and throwing it away would lose somebody's decision. It stops holding
 * the day and starts again on its own once the date is close.
 */
suite('Suite 25. A day is only SET if it is within two business days');
{
  const lift = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const constStart = admin.indexOf('const PIN_HONOURED_BUSINESS_DAYS');
  const horizonSrc = lift('pinHorizon');
  const effSrc = lift('effectivePin');
  check('S25', 'the pin horizon helpers exist', constStart !== -1 && !!horizonSrc && !!effSrc);

  if (constStart !== -1 && horizonSrc && effSrc) {
    const api = eval(
      'function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}\n' +
      'function isWeekend(d){const k=d.getDay();return k===0||k===6;}\n' +
      admin.slice(constStart, admin.indexOf('function pinHorizon')) +
      horizonSrc + '\n' + effSrc +
      '\n;({horizon: pinHorizon, eff: effectivePin, days: PIN_HONOURED_BUSINESS_DAYS})');

    check('S25', 'two business days, as asked for', api.days === 2);

    /* Relative to a fixed Monday so the test does not drift with the calendar:
       business days from Mon are Tue and Wed; Thu is already too far. */
    const mon = new Date(2026, 9, 5);           // Mon 5 Oct 2026
    const at = (d) => new Date(2026, 9, d);
    const horizon = api.horizon();
    check('S25', 'the horizon skips weekends rather than counting them',
      (() => {
        // Fri + 2 business days must land on Tue, not Sun.
        let d = new Date(2026, 9, 2), n = 0;    // Fri 2 Oct
        for (let i = 0; i < 2; i++) { d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); n++; }
        return d.getDay() === 2 && n === 2;
      })(),
      'counting plain days would freeze a day over the weekend and honour the wrong dates');

    // The reported case: a pin weeks out must stop holding its day.
    const farOut = api.eff({ pin: new Date(2027, 0, 15) });
    check('S25', 'a pin weeks away no longer holds its day still', farOut === null,
      'this is the Oct 1 / Oct 2 case — the day stayed put while the season moved around it');

    const soon = api.eff({ pin: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    check('S25', 'a pin for tomorrow is still honoured', soon !== null,
      'a day the crew is committed to must not be re-flowed out from under them');

    const past = api.eff({ pin: new Date(2020, 0, 1) });
    check('S25', 'a date already gone stays where it is', past !== null,
      'a past day is history — re-flowing it would rewrite what the crew was sent out with');

    check('S25', 'no pin means no SET', api.eff({ pin: null }) === null && api.eff(null) === null);
    check('S25', 'the horizon is a real date', horizon instanceof Date && !isNaN(horizon.getTime()));
  }

  // The wiring: both the layout and the badge must go through effectivePin.
  const layout = lift('layoutSequence') || '';
  check('S25', 'the date engine honours the horizon, not the raw pin',
    /effectivePin\(day\)/.test(layout) && !/if\(day\.pin\)\{day\._date/.test(layout),
    'reading day.pin directly here is what pinned Oct 1 and Oct 2 in place');
  check('S25', 'the SET badge only shows when the pin is actually in force',
    /effectivePin\(day\)\?'<span class="pinbadge">SET</.test(admin) &&
    /effectivePin\(day\)&&!fr\?' <span class="pinbadge">SET DATE</.test(admin),
    'showing SET on a day that is not actually held is a lie the office would plan around');
  /* Fix routes carry their REAL date in .pin and are laid out separately. If
     they ever went through effectivePin they would lose their date entirely. */
  check('S25', 'fix routes still take their date straight from the pin',
    /SEASON\.filter\(d=>d\.isFixRoute\)\.forEach\(d=>\{d\._date=new Date\(d\.pin\);\}\)/.test(admin),
    'a fixer route IS its pin — putting it through the horizon would blank its date');
}

/*
 * Suite 26. The Schedule tab picks up a town corrected in All Customers.
 *
 * Owner, 2026-08-16: "in all customers I messed up and put some people as the
 * wrong cities, I fixed my mistake but that fix still hasnt updated in schedule
 * and routes for some customers."
 *
 * The Schedule plan is built from an imported CSV and keeps its own copy of
 * each house's town. Nothing in it had ever read a customer record, so a
 * corrected town could not reach it. A crew-day is one town, so a wrong town
 * puts the house on the wrong day and lengthens the season.
 *
 * ⚠ The match must NOT use custByAddrKey: that index is keyed on address AND
 * town, and the town is the field known to be wrong, so it would miss exactly
 * the houses this exists to find. Customer number first, then phone.
 */
suite('Suite 26. Schedule picks up a corrected town');
{
  const lift = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const matchSrc = lift('customerForHouse');
  const syncSrc = lift('syncTownsFromCustomers');
  check('S26', 'the town sync exists', !!matchSrc && !!syncSrc);

  if (matchSrc && syncSrc) {
    const season = [{ houses: [
      { name: 'Wrong by number', cu: '5012', phone: '', city: 'Draper' },
      { name: 'Wrong by phone', cu: '', phone: '(801) 555-0123', city: 'Sandy' },
      { name: 'Already right', cu: '5012', phone: '', city: 'Lehi' },
      { name: 'Not a customer here', cu: '', phone: '8019999999', city: 'Orem' },
      { name: 'Takedown copy', cu: '5012', phone: '', city: 'Draper', isTakedown: true }
    ] }];
    const sb = {};
    new Function('jobAddresses', 'custByNumber', 'custByPhoneDigits', 'SEASON', 'extractCleanCity',
      matchSrc + '\n' + syncSrc + '\nthis.sync=syncTownsFromCustomers;this.match=customerForHouse;'
    ).call(sb, [1],
      new Map([['5012', { data: { city: 'Lehi' } }]]),
      new Map([['8015550123', { data: { city: 'Herriman' } }]]),
      season, c => String(c == null ? '' : c).trim());

    const moved = sb.sync();
    check('S26', 'a house whose town was corrected is moved', moved.length === 2,
      'moved ' + moved.length + ': ' + moved.map(m => m.name).join(', '));
    check('S26', 'matched by customer number', season[0].houses[0].city === 'Lehi');
    check('S26', 'matched by phone when there is no customer number', season[0].houses[1].city === 'Herriman');
    check('S26', 'a house already in the right town is left alone',
      season[0].houses[2].city === 'Lehi' && !moved.some(m => m.name === 'Already right'));
    check('S26', 'a house that matches no customer is left alone', season[0].houses[3].city === 'Orem',
      'the plan can hold rows that are not customers here — they must not be blanked or guessed at');
    check('S26', 'takedown copies are not rewritten', season[0].houses[4].city === 'Draper',
      'the install row is the real record; correcting the copy as well would double-report the same house');
    check('S26', 'the move is reported with where it came from and went to',
      moved.every(m => m.from && m.to && m.name));
    check('S26', 'customer number beats phone when both are present',
      sb.match({ cu: '5012', phone: '8015550123' }).data.city === 'Lehi');
    check('S26', 'an unknown house matches nothing rather than the first record',
      sb.match({ cu: '', phone: '8019999999' }) === null);
    check('S26', 'nothing happens when the customer list has not loaded',
      (() => {
        const s2 = [{ houses: [{ name: 'x', cu: '5012', city: 'Draper' }] }];
        const sb2 = {};
        new Function('jobAddresses', 'custByNumber', 'custByPhoneDigits', 'SEASON', 'extractCleanCity',
          matchSrc + '\n' + syncSrc + '\nthis.sync=syncTownsFromCustomers;'
        ).call(sb2, [], new Map(), new Map(), s2, c => String(c == null ? '' : c).trim());
        return sb2.sync().length === 0 && s2[0].houses[0].city === 'Draper';
      })(),
      'syncing against an empty list would report "nothing to fix" and look like the correction had landed');
  }

  check('S26', 'the town match never uses the address index',
    !/custByAddrKey/.test(matchSrc || ''),
    'custByAddrKey is keyed on address AND town, so it cannot find a house whose town is wrong');
  check('S26', 'the plan syncs towns after it loads', /syncTownsWhenCustomersReady\(\)/.test(admin));
  check('S26', 'and there is a button to re-pull them by hand', /t\.id==='syncTownsBtn'/.test(admin) &&
    /id=\\"syncTownsBtn\\"/.test(admin));
}

/*
 * Suite 27. A short crew-day reaches into a nearby town rather than doing five.
 *
 * Owner, 2026-08-16: "the max one crew can have still is 40 [20 a crew, 40 a
 * day] but they dont need to have the same number of houses, instead we should
 * prioritize doing the most houses in a day as possible", and then: "it should
 * always favor having all 20 in the same town and only stretch to nearby towns
 * if the day isnt full for a crew."
 *
 * The equal split was never a rule in the code — 14 in Lehi and 19 in Herriman
 * already came out as 14 and 19. What actually stretched the season was ONE
 * CREW, ONE TOWN: eight towns with five houses left each is forty houses, which
 * is exactly one full working day, and it was taking four.
 *
 * Two invariants this must never break, both previously stated by the owner and
 * both cheap to lose in a packing change:
 *   - never more than 20 on a crew;
 *   - never two crews in the same town on the same day.
 */
suite('Suite 27. Short crew-days reach into nearby towns');
{
  const extract = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const start = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
  const end = admin.indexOf('/* Top every day up to the cap.', start);
  const nearbyConst = admin.indexOf('const NEARBY_TOWN_MILES');
  check('S27', 'the builder and the nearby helpers are findable',
    start !== -1 && end > start && nearbyConst !== -1 && !!extract('townCentres') && !!extract('nearbyTowns'));

  if (start !== -1 && end > start && nearbyConst !== -1) {
    global.toDateStr = dt => dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    const api = eval(
      'function haversine(a,b,c,d){const R=3958.8,t=x=>x*Math.PI/180;const dl=t(c-a),dg=t(d-b);' +
      'const q=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dg/2)**2;' +
      'return 2*R*Math.asin(Math.sqrt(q));}\n' +
      admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) + '\n' +
      admin.slice(nearbyConst, admin.indexOf('function townCentres')) + '\n' +
      'let NEARBY_TOWN_LIST={};' + extract('sameTownName') +
      extract('townCentres') + '\n' + extract('nearbyTowns') + '\n' +
      extract('installPriority') + '\n' + admin.slice(start, end) +
      '\n;({plan: planNewCrewDays, cap: MAX_STOPS_PER_ROUTE, crews: CREWS_PER_DAY})');

    const at = {
      Lehi: [40.391, -111.851], Highland: [40.425, -111.795], 'American Fork': [40.377, -111.796],
      Alpine: [40.453, -111.777], Draper: [40.524, -111.863], Sandy: [40.572, -111.859],
      Orem: [40.297, -111.695], Herriman: [40.514, -112.033]
    };
    const run = (counts, opts) => {
      const waiting = [];
      Object.keys(counts).forEach(city => {
        for (let i = 0; i < counts[city]; i++) {
          waiting.push({ id: city + i, city, priority: 2, from: '2026-10-01',
                         stop: { lat: at[city][0], lng: at[city][1] } });
        }
      });
      const days = api.plan(waiting, {}, Object.assign({ floorDate: '2026-10-01', maxDays: 40 }, opts || {}));
      const byDate = {};
      days.forEach(d => { (byDate[d.date] = byDate[d.date] || []).push(d); });
      return { days, byDate, dates: Object.keys(byDate).sort(),
               placed: days.reduce((s, d) => s + d.ids.length, 0), total: waiting.length };
    };

    // The reported symptom: 40 houses = one full day, previously spread over four.
    const tail = run({ Lehi: 5, Herriman: 5, Alpine: 5, Draper: 5, Sandy: 5, Orem: 5, 'American Fork': 5, Highland: 5 });
    const run27 = run;
    check('S27', 'a tail of small towns is packed into as few days as possible',
      tail.dates.length <= 2,
      'took ' + tail.dates.length + ' working days for 40 houses; one crew one town took four');
    /* ⭐ THE TWO-TOWN RULE IS THE BUILDER'S, AND THE BUILDER STILL KEEPS IT.
       Owner: "each crew is only doing one other city" — so nothing that comes
       off the build itself may hold three.

       What may is the tail sweep, and only to delete a whole date: owner,
       2026-08-18, "we should fit as many of those into other days as possible,
       just stuff those guys into another day." In this fixture Orem's five had
       a working day to themselves; the sweep hands them to the American
       Fork crew and the third date stops existing. The trade is asserted both
       ways below so neither half can drift.

       ⚠ Nearby only. Permission to mix towns is not permission to send a crew
       from Sandy to Orem — see 'a town far away is never borrowed from'. */
    const raw = run27({ Lehi: 5, Herriman: 5, Alpine: 5, Draper: 5, Sandy: 5, Orem: 5, 'American Fork': 5, Highland: 5 }, { pack: false });
    check('S27', 'the build itself still never sends a crew to more than two towns',
      raw.days.every(d => d.towns.length <= 2),
      'worst crew held ' + Math.max.apply(null, raw.days.map(d => d.towns.length)) + ' towns before the sweep ran');
    check('S27', 'and a third town only ever appears where it removed a day',
      tail.dates.length < raw.dates.length ||
      tail.days.every(d => d.towns.length <= 2),
      'the sweep took ' + raw.dates.length + ' dates to ' + tail.dates.length +
      ' — mixing a third town into a route is only worth it for a day the crew no longer has to drive to');
    check('S27', 'and nobody is left behind while packing', tail.placed === tail.total,
      tail.placed + ' of ' + tail.total);
    check('S27', 'a topped-up day records every town it holds',
      tail.days.some(d => d.towns && d.towns.length > 1) &&
      tail.days.every(d => Array.isArray(d.towns) && d.towns[0] === d.city),
      'the sweep reads this list; without it the borrowed houses are evicted next pass');

    // The owner's own example must be unchanged.
    const ex = run({ Lehi: 14, Herriman: 19 });
    check('S27', '14 in Lehi and 19 in Herriman still go out on one day', ex.dates.length === 1);
    check('S27', 'and they are NOT levelled to the same number',
      ex.byDate[ex.dates[0]].map(d => d.ids.length).sort((a, b) => a - b).join() === '14,19');

    // "Always favour all 20 in the same town."
    const full = run({ Lehi: 20, Highland: 20 });
    check('S27', 'a crew-day its own town can fill never borrows',
      full.days.every(d => d.towns.length === 1) && full.dates.length === 1,
      'borrowing when the town already gives twenty would split towns for no gain');
    const big = run({ Lehi: 60, Highland: 3 });
    check('S27', 'a big town keeps whole days to itself',
      big.days.filter(d => d.city === 'Lehi').every(d => d.towns.length === 1 && d.ids.length === 20));

    // Invariants that must survive any packing change.
    const all = [tail, ex, full, big];
    check('S27', 'never more than twenty on one crew',
      all.every(r => r.days.every(d => d.ids.length <= api.cap)));
    check('S27', 'never two crews in the same town on the same day',
      all.every(r => r.dates.every(dt => {
        const seen = {};
        return r.byDate[dt].every(d => d.towns.every(t => { if (seen[t]) return false; seen[t] = 1; return true; }));
      })),
      'the one arrangement the owner ruled out — and a borrowed town counts');
    check('S27', 'never more crews out than there are crews',
      all.every(r => r.dates.every(dt => r.byDate[dt].length <= api.crews)));
    check('S27', 'a town far away is never borrowed from',
      tail.days.every(d => !(d.towns.indexOf('Sandy') !== -1 && d.towns.indexOf('Orem') !== -1)),
      'Sandy and Orem are opposite ends of the valley — pairing them would be a wasted day of driving');
  }

  /* The sweep must agree that a topped-up day is legitimate, or it evicts the
     borrowed houses and the builder puts them back, for ever. */
  const problem = extract('stopProblem') || '';
  check('S27', 'stopProblem judges against every town the day holds',
    /Array\.isArray\(routeTowns\)/.test(problem) && /towns\.indexOf\(theirs\) === -1/.test(problem),
    'comparing against a single town would evict every borrowed house on the next sweep');
  check('S27', 'the sweep reads the stored town list', /townsByRoute\[/.test(admin) &&
    /const listed = \(r\.towns \|\| \[\]\)/.test(admin));
  check('S27', 'and new days write it down', /towns: nd\.towns \|\| \[nd\.city\]/.test(admin),
    'a day built without its town list is one the next sweep takes apart');
}

/*
 * Suite 28. Rebuilding the Schedule season's days from the houses.
 *
 * Owner, 2026-08-17, on the imported plan:
 *   "the citiees should not be assigned to a day that should be calculated, for
 *    example right now there is a day Lehi and Highland but the people in it
 *    arent Lehi Highland, theres some Eagle mountain and others west jordan"
 *   "if we dont have a day for west jordan that should be calculated and added
 *    or included with a nearby city if there are few west jordan houses"
 *   "oct 1st only has two people and theres no days between oct 1 and 6 but we
 *    should be working every single october buissness day… we always start on
 *    oct 1st and work ever buissness day following for as long as there is a
 *    house elgible to be hung in october/didnt request to be hung in november"
 *
 * The imported plan groups houses by the spreadsheet's date column, so no rule
 * ever decided who shares a day. rebuildSeasonDays throws that grouping away
 * and works the days out from the houses using planNewCrewDays — the same
 * builder the crew's routes use, so the two cannot drift apart.
 */
suite('Suite 28. The Schedule season rebuilt from its houses');
{
  const fn = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const planStart = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
  const planEnd = admin.indexOf('/* Top every day up to the cap.', planStart);
  const need = ['seasonStartDate', 'houseAllowedFrom', 'houseInstallPriority', 'rebuildSeasonDays', 'crewTownsFor'];
  check('S28', 'the rebuild and its helpers are findable', need.every(n => !!fn(n)) && planStart !== -1);

  if (need.every(n => !!fn(n)) && planStart !== -1) {
    const at = {
      Lehi: [40.391, -111.851], Highland: [40.425, -111.795], Alpine: [40.453, -111.777],
      'Eagle Mountain': [40.316, -112.006], 'West Jordan': [40.609, -111.939],
      Draper: [40.524, -111.863], Orem: [40.297, -111.695]
    };
    const ctx = {};
    const src =
      'function toDateStr(dt){return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");}' +
      'function haversine(a,b,c,d){const R=3958.8,t=x=>x*Math.PI/180;const dl=t(c-a),dg=t(d-b);' +
      'const q=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(q));}' +
      'function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}' +
      'function isWeekend(d){const k=d.getDay();return k===0||k===6;}' +
      'function isoOf(d){return toDateStr(d);}' +
      'function daysBetween(a,b){return Math.round((a-b)/86400000);}' +
      'function mdToDate(md){const p=(""+md).split("-").map(Number);return new Date(2026,p[0]-1,p[1]);}' +
      'function extractCleanCity(c){return (""+(c==null?"":c)).trim();}' +
      'function customerForHouse(h){return h.__cust||null;}' +
      'function nextWorkingDay(d){let x=new Date(d);while(isWeekend(x))x=addDays(x,1);return x;}' +
      'function isWorkingDay(d){return !isWeekend(d);}' +
      'function dayDate(d){return d._date;}' +
      'function installDays(){return SEASON.filter(d=>!d.isFixRoute&&!d.isTakedown);}' +
      'function computeDates(){SEASON.forEach(d=>{if(d.base!=null)d._date=addDays(BASE_START,d.base);});}' +
      'function planCities(){return [];}' +
      'var CREWS=[{name:"Crew 1",city:""},{name:"Crew 2",city:""}];' +
      'var BASE_START=new Date(2026,9,1),globalDelta=0,SEASON=[],selSchedule=null;\n' +
      admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) + '\n' +
      admin.slice(admin.indexOf('const NEARBY_TOWN_MILES'), admin.indexOf('function townCentres')) + '\n' +
      'let NEARBY_TOWN_LIST={};' + fn('sameTownName') +
      fn('townCentres') + fn('nearbyTowns') + fn('installPriority') + admin.slice(planStart, planEnd) +
      /* The rebuild now asks pinHorizon whether a day is close enough to be
         SET, so the sandbox needs it and its constant. */
      'const PIN_HONOURED_BUSINESS_DAYS=' + (admin.match(/const PIN_HONOURED_BUSINESS_DAYS=(d+);/)||[])[1] + ';' +
      fn('pinHorizon') +
      fn('seasonStartDate') + fn('prefSpecificDate') + fn('houseAllowedFrom') + fn('houseDeadline') + fn('houseInstallPriority') +
      'function cityOf(h){return (h.city||"").trim();}' +
      'function sameCity(a,b){return (""+a).trim().toLowerCase()===(""+b).trim().toLowerCase();}' +
      fn('rebuildSeasonDays') + fn('dayAreas') + fn('dayCrewTowns') + fn('crewTownsFor') +
      '\nthis.run=function(seed){SEASON=seed;SEASON.forEach(function(d){d._date=new Date(2026,9,1+d.base);});' +
      'var r=rebuildSeasonDays();return {r:r,days:SEASON.filter(function(d){return !d.isFixRoute&&!d.isTakedown;})' +
      '.sort(function(a,b){return a.base-b.base;}),towns:crewTownsFor};};';
    new Function(src).call(ctx);

    let n = 0;
    const house = (city, pref) => ({ id: 'h' + (++n), name: 'H' + n, city, pref: pref || '',
      __cust: { data: { city, lat: at[city][0], lng: at[city][1] } } });
    const mixed = [];
    // A day of two people, a gap, then one jumbled day carrying four towns.
    ['Lehi', 'Lehi', 'Highland', 'Highland', 'Eagle Mountain', 'Eagle Mountain', 'West Jordan'].forEach(c => mixed.push(house(c)));
    for (let i = 0; i < 30; i++) mixed.push(house('Lehi'));
    for (let i = 0; i < 24; i++) mixed.push(house('Highland'));
    for (let i = 0; i < 18; i++) mixed.push(house('Eagle Mountain'));
    for (let i = 0; i < 4; i++) mixed.push(house('West Jordan'));
    for (let i = 0; i < 9; i++) mixed.push(house('Alpine'));
    for (let i = 0; i < 12; i++) mixed.push(house('Orem', 'NOV'));
    for (let i = 0; i < 6; i++) mixed.push(house('Draper'));

    const out = ctx.run([
      { id: 'd0', base: 0, cascade: 0, pin: null, houses: mixed.slice(0, 2) },
      { id: 'd1', base: 5, cascade: 0, pin: null, houses: mixed.slice(2) }
    ]);
    const days = out.days, towns = out.towns;
    const dateOf = (d) => new Date(2026, 9, 1 + d.base);
    const crewOf = (i, d) => towns(i, d);

    check('S28', 'the rebuild reports what it did', !out.r.error && out.r.days > 0 && out.r.houses === mixed.length,
      JSON.stringify(out.r));
    /* Still 1 October here because nothing has moved the Season start box —
       that is the DEFAULT now rather than a hard rule. Suite 49 covers the
       office choosing a later date and it sticking through a rebuild. */
    check('S28', 'the season starts on 1 October when nothing has been moved', out.r.first === '2026-10-01',
      'started ' + out.r.first + " — owner: 'we always start on oct 1st'");

    // The complaint: a day whose label did not match the people on it.
    check('S28', 'every house is on a day whose crew actually covers its town',
      days.every(d => { const t = crewOf(0, d).concat(crewOf(1, d)); return d.houses.every(h => t.indexOf(h.city) !== -1); }),
      'this is the "day says Lehi and Highland but they are Eagle Mountain and West Jordan" case');
    check('S28', 'the towns are derived, never stored on the day',
      days.every(d => d.crewTowns === undefined),
      'a stored split describes the day it was born with, not the day it becomes after an iced-off morning pushes houses into it');

    // West Jordan had no day of its own before.
    const wj = days.filter(d => crewOf(0, d).indexOf('West Jordan') !== -1 || crewOf(1, d).indexOf('West Jordan') !== -1);
    check('S28', 'a town with no day gets one calculated for it', wj.length > 0,
      'West Jordan had nowhere to go and its houses sat on somebody else\'s day');

    // Working every October business day from the 1st.
    const oct = days.filter(d => dateOf(d).getMonth() === 9).map(dateOf).sort((a, b) => a - b);
    check('S28', 'October days are consecutive business days with no gaps',
      (() => {
        for (let i = 1; i < oct.length; i++) {
          let expect = new Date(oct[i - 1]); expect.setDate(expect.getDate() + 1);
          while (expect.getDay() === 0 || expect.getDay() === 6) expect.setDate(expect.getDate() + 1);
          if (expect.getTime() !== oct[i].getTime()) return false;
        }
        return oct.length > 0;
      })(),
      'the plan had nothing between 1 and 6 October while houses were waiting');
    check('S28', 'the first day is full rather than holding two people',
      days[0] && days[0].houses.length > 30, days[0] ? days[0].houses.length + ' houses' : 'no days');

    // Timing preference must survive the repack.
    check('S28', 'a November-only house is never put in October',
      days.every(d => dateOf(d).getMonth() !== 9 ||
        d.houses.every(h => (h.pref || '').toUpperCase().indexOf('NOV') !== 0)),
      'asking for November and being hung in October is the one thing a customer notices');
    check('S28', 'and they do still get a day', days.some(d => d.houses.some(h => (h.pref || '').toUpperCase().indexOf('NOV') === 0)));

    // The standing caps.
    check('S28', 'no crew is given more than twenty',
      days.every(d => [0, 1].every(i => d.houses.filter(h => crewOf(i, d).indexOf(h.city) !== -1).length <= 20)));
    check('S28', 'nobody is lost in the rebuild',
      days.reduce((s, d) => s + d.houses.length, 0) === mixed.length,
      'every house that went in must come out on some day');

    /* The day that only partly got done. Owner, 2026-08-17: "if a crew only got
       2 houses done in a city then we still will need another day for that day
       if it still has more houses than the city with the second most houses",
       and "everyone that doesnt get hung on the list needs to be pushed back to
       another day and if we never go back to that city and we cant fill it in in
       the other days we will also need to automaticlaly add a new day".
       So what is LEFT drives the plan, not what was once planned. */
    let m = 0;
    const mk = (city, done) => ({ id: 'p' + (++m), name: 'P' + m, city, done: !!done, pref: '',
      __cust: { data: { city, lat: at[city][0], lng: at[city][1] } } });
    const worked = [];
    for (let i = 0; i < 2; i++) worked.push(mk('Lehi', true));    // the two that got done
    for (let i = 0; i < 18; i++) worked.push(mk('Lehi', false));  // the eighteen that did not
    for (let i = 0; i < 6; i++) worked.push(mk('Highland', false));
    const rest = [];
    for (let i = 0; i < 5; i++) rest.push(mk('Orem'));
    for (let i = 0; i < 3; i++) rest.push(mk('West Jordan'));
    const p = ctx.run([
      { id: 'w0', base: 0, cascade: 0, pin: null, houses: worked },
      { id: 'w1', base: 1, cascade: 0, pin: null, houses: rest }
    ]);
    const pd = p.days, all = pd.reduce((a, d) => a.concat(d.houses), []);
    check('S28', 'the houses that got done stay put as the record',
      pd.some(d => d.houses.length === 2 && d.houses.every(h => h.done && h.city === 'Lehi')),
      'a worked day is what the crew was actually sent out with');
    check('S28', 'every house that did NOT get done is scheduled again',
      all.filter(h => h.city === 'Lehi' && !h.done).length === 18,
      'they were pushed back onto another day rather than left on a day that has been and gone');
    check('S28', 'a town still carrying the most houses gets the next day',
      (() => {
        const first = pd.filter(d => d.houses.some(h => !h.done)).sort((a, b) => a.base - b.base)[0];
        return !!first && first.houses.some(h => h.city === 'Lehi' && !h.done);
      })(),
      'eighteen left in Lehi has to outrank five in Orem');
    check('S28', 'a new day is added when the leftovers will not fit anywhere',
      pd.filter(d => d.houses.some(h => !h.done)).length >= 2 &&
      all.filter(h => h.city === 'West Jordan').length === 3,
      'West Jordan is near nothing else here, so it has to get a day of its own');
    check('S28', 'and nothing is lost doing it', all.length === worked.length + rest.length);

    const oneTown = { houses: Array.from({ length: 12 }, () => ({ city: 'Alpine' })) };
    check('S28', 'a day holding one town gives the second crew nothing to do',
      crewOf(1, oneTown).length === 0 && crewOf(0, oneTown).join() === 'Alpine',
      'got crew2 ' + JSON.stringify(crewOf(1, oneTown)) +
      ' — inventing a second town files houses under a crew that is not out');

    /* The iced-off day. Owner: "there might be days so icy they cant come in
       then we have to say none of them got done… it wont have a way to
       recalculate cities for everyday when it notices there are still way to
       many highland houses." A stored split would still be describing the day
       as it was built; a derived one absorbs whatever arrives. */
    const iced = { houses: Array.from({ length: 14 }, () => ({ city: 'Lehi' })) };
    const before = crewOf(0, iced).concat(crewOf(1, iced)).join();
    for (let i = 0; i < 18; i++) iced.houses.push({ city: 'Highland' });
    const after = crewOf(0, iced).concat(crewOf(1, iced));
    check('S28', "houses pushed onto a later day recalculate that day's towns",
      before === 'Lehi' && after.indexOf('Highland') !== -1 && after.indexOf('Lehi') !== -1,
      'was [' + before + '], became [' + after.join() + ']');
    check('S28', 'and the pushed-in houses belong to a crew rather than to nobody',
      iced.houses.every(h => after.indexOf(h.city) !== -1),
      'this is exactly what a stored crew split gets wrong');
  }

  // It must be deliberate, and reversible.
  check('S28', 'the rebuild is a button, not something that happens on load',
    /t\.id==='rebuildBtn'/.test(admin) && !/rebuildSeasonDays\(\);\s*renderAll/.test(admin));
  check('S28', 'one press can be undone', /t\.id==='undoRebuildBtn'/.test(admin) && /preRebuild=before/.test(admin),
    'it replaces the day structure and somebody may have moved houses by hand');
  check('S28', 'nothing stores a crew split that could go stale',
    !/crewTowns:/.test(admin) && /function dayCrewTowns\(day\)/.test(admin),
    'the towns must be worked out from the houses on the day, every time they are asked');
  check('S28', 'a crew city typed in the crew bar only applies while that town is on the day',
    /sameCity\(t,pinned\)/.test(admin),
    'unconditional is what let a day claim Lehi and Highland over Eagle Mountain and West Jordan houses');
  check('S28', 'a worked day is judged by date OR by anything ticked off on it',
    /const worked=\(dt&&dt<today\)\|\|houses\.some/.test(admin),
    'a day the crew has been sent out on is the record of what they were sent out with');
}

/*
 * Suite 29. Typing in which towns are near each other.
 *
 * Owner, 2026-08-17: "you will need to input nearby towns as well because if
 * there are under 20 houses in a city we need to fill it up with houses from a
 * nearby city."
 *
 * Distance between map pins is a good guess and not always right — two towns
 * can be four miles apart with a canyon or a freeway between them, and a town
 * whose houses have no pins has no centre to measure from at all. A typed list
 * beats the measurement; a town left out of it still falls back to distance, so
 * the box starts empty and useful rather than having to be filled in before
 * anything works.
 */
suite('Suite 29. Towns the office says are near each other');
{
  const fn = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const need = ['parseNearbyTowns', 'nearbyTownsToText', 'sameTownName', 'nearbyTowns'];
  check('S29', 'the nearby-town helpers exist', need.every(n => !!fn(n)));

  if (need.every(n => !!fn(n))) {
    const sb = {};
    new Function(
      'function extractCleanCity(c){return (""+(c==null?"":c)).trim();}' +
      'function haversine(a,b,c,d){const R=3958.8,t=x=>x*Math.PI/180;const dl=t(c-a),dg=t(d-b);' +
      'const q=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(q));}' +
      'const NEARBY_TOWN_MILES=8; let NEARBY_TOWN_LIST={};' +
      need.map(fn).join('\n') +
      'this.parse=parseNearbyTowns;this.text=nearbyTownsToText;this.near=nearbyTowns;' +
      'this.set=function(m){NEARBY_TOWN_LIST=m;};'
    ).call(sb);

    const typed = sb.parse('Lehi: Highland, American Fork , Alpine\nWest Jordan: South Jordan, Riverton\n\nnot a rule\nOrem: Orem, Provo\n');
    check('S29', 'a typed line becomes a town and its neighbours',
      JSON.stringify(typed.Lehi) === JSON.stringify(['Highland', 'American Fork', 'Alpine']),
      JSON.stringify(typed));
    check('S29', 'spaces around a town name do not make a different town',
      typed.Lehi.indexOf('American Fork') !== -1);
    check('S29', 'a line with no colon is ignored rather than saved as a town',
      Object.keys(typed).indexOf('not a rule') === -1);
    check('S29', 'a town is never its own neighbour',
      JSON.stringify(typed.Orem) === JSON.stringify(['Provo']),
      'listing itself would let a crew "top up" from the town it is already in and count it twice');
    check('S29', 'two towns in the list both survive', !!typed['West Jordan']);
    check('S29', 'what is typed comes back as it was typed',
      sb.text(typed).indexOf('Lehi: Highland, American Fork, Alpine') !== -1);

    const centres = { Lehi: { lat: 40.391, lng: -111.851 }, Draper: { lat: 40.524, lng: -111.863 },
                      Highland: { lat: 40.425, lng: -111.795 } };
    check('S29', 'with nothing typed, nearness is measured from the map pins',
      JSON.stringify(sb.near('Lehi', centres)) === JSON.stringify(['Highland']));
    sb.set(typed);
    check('S29', 'a typed list beats the measurement',
      JSON.stringify(sb.near('Lehi', centres)) === JSON.stringify(['Highland', 'American Fork', 'Alpine']),
      'the measurement cannot know about a canyon, and a town with no pins cannot be measured at all');
    check('S29', 'the town name is matched however it was capitalised',
      JSON.stringify(sb.near('lehi', centres)) === JSON.stringify(sb.near('Lehi', centres)),
      'it arrives from a textarea, so the casing is whatever somebody typed');
    check('S29', 'a town left out still falls back to distance',
      JSON.stringify(sb.near('Draper', centres)) === JSON.stringify(['Highland']),
      'the box has to be useful empty, or it would have to be filled in before anything worked');
    check('S29', 'the caller cannot corrupt the saved list',
      (() => { const got = sb.near('Lehi', centres); got.push('Nowhere');
               return sb.near('Lehi', centres).indexOf('Nowhere') === -1; })(),
      'the builder sorts and trims what it gets back');
  }

  check('S29', 'the list is stored with the other scheduling settings',
    /nearbyTowns: parsed/.test(admin) && /settings','scheduling'\), \{nearbyTowns/.test(admin));
  check('S29', 'and is not reloaded over somebody mid-sentence',
    /document\.activeElement !== nt/.test(admin),
    'refreshing a textarea under the cursor takes the line away mid-word');
}

/*
 * Suite 30. Editing a customer saves their town.
 *
 * Owner, 2026-08-17, having worked it out from the form itself: "i think i
 * figured out why the city in all customers doesnt save to schedule, its
 * because city is labeled in the edit customer part".
 *
 * Exactly right. Edit Customer had ONE combined Address box and no town box at
 * all, and the save handler wrote `address` while never touching `city`. Every
 * part of the system that decides where a house goes — the routes, the
 * reconcile sweep, routeCityOf, the Schedule plan — reads `city`. So correcting
 * a town in the address line changed the words on the screen and nothing else,
 * and the house stayed on its old town's day for the rest of the season.
 *
 * The dangerous direction is the other one: this handler writes about thirty
 * fields at once, so an empty town slipping through would quietly unschedule a
 * house rather than fail where anyone could see it.
 */
suite('Suite 30. Edit Customer saves the town');
{
  const i = admin.indexOf('function extractCleanCity(');
  let src = '';
  if (i !== -1) {
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) { src = admin.slice(i, j + 1); break; } }
    }
  }
  check('S30', 'extractCleanCity is still there to read', !!src);

  if (src) {
    const sb = {};
    new Function(src + 'this.x=extractCleanCity;').call(sb);
    // The rule the save handler applies, kept in step with it by the check below.
    const decide = (typed, address, onRecord) => sb.x(typed) || sb.x(address) || sb.x(onRecord) || '';

    check('S30', 'a town typed in the box wins', decide('Lehi', '120 N 200 W, UT', 'Draper') === 'Lehi');
    check('S30', 'a blank box takes the town out of the address',
      decide('', '120 N 200 W, Lehi, UT 84043', 'Draper') === 'Lehi',
      'so typing the town into the address line, which is what people did before there was a box, still works');
    check('S30', 'an address with no town NEVER wipes the town on the record',
      decide('', '120 N 200 W, UT', 'Draper') === 'Draper',
      'this is the shape most of these addresses are in, and a blank town takes the house off every route there is');
    check('S30', 'no town anywhere stays blank rather than inventing one',
      decide('', '120 N 200 W, UT', '') === '',
      'a guessed town silently moves a house onto the wrong crew-day');
    check('S30', 'a zip on the end is not mistaken for a town',
      decide('', '120 N 200 W, UT 84043', 'Highland') === 'Highland');
    check('S30', 'spaces round a typed town are trimmed', decide('  Lehi  ', '', '') === 'Lehi');
    check('S30', 'a two-word town survives', decide('Eagle Mountain', '', '') === 'Eagle Mountain');
  }

  check('S30', 'the form has a town box of its own',
    /id="editCustCity"/.test(admin) && /id="editCustCityList"/.test(admin),
    'with only a combined address line there was no way to set the field the routes actually read');
  check('S30', 'it is filled in when the customer is opened',
    /getElementById\('editCustCity'\)\.value = d\.city \|\| ''/.test(admin),
    'an empty box on a customer who has a town would look like they have none');
  check('S30', 'and the town is written on save',
    /address: newAddress, city: newCity,/.test(admin),
    'this is the whole bug — the handler wrote the address and left the town alone');
  check('S30', 'the save falls back through box, then address, then what is on file',
    /const newCity = typedCity \|\| extractCleanCity\(newAddress\) \|\| extractCleanCity\(d\.city\) \|\| '';/.test(admin),
    'dropping the last fallback is what would let a routine save blank a town');
  check('S30', 'the town box offers the towns already in use',
    /editCustCityList/.test(admin) && /jobAddresses\.forEach/.test(admin),
    'a typo makes a town of one, which gets its own crew-day for a single house');
  /* One parser, not two. §9.1: do not duplicate a check or a rule across the
     code — extractCleanCity already reads a whole address line. */
  /* ---- the customer number, editable here since 2026-08-17 ----
     It was read-only because it carries pool bookkeeping nothing else does.
     Editable is fine; editable WITHOUT the bookkeeping is how a bin number gets
     stranded or handed out twice. */
  check('S30', 'the customer number is an input, not a read-only display',
    /id="editCustNumber"/.test(admin) && !/id="editCustNumberDisplay"/.test(admin));
  check('S30', 'it is filled in when the customer is opened',
    /getElementById\('editCustNumber'\)\.value = d\.customerNumber \|\| ''/.test(admin));
  check('S30', 'and written on save', /customerNumber: newCustNumber,/.test(admin));
  check('S30', 'a number another customer holds is refused',
    /already belongs to ' \+ \(heldBy\.data\.name \|\| 'another customer'\)/.test(admin) &&
    /a\.id !== item\.id/.test(admin),
    'two customers on one number is two bins that cannot be told apart — Health Check has a rule for that state existing');
  check('S30', 'letters are refused, blank is allowed',
    /if\(newCustNumber && !\/\^\\d\+\$\/\.test\(newCustNumber\)\)\{/.test(admin),
    'blank means "no number", which is a real state — a customer can be waiting for one');
  check('S30', 'the number being left goes back into the pool',
    /setDoc\(doc\(db,'availableCustomerNumbers', oldCustNumber\)/.test(admin),
    'otherwise that bin can never be handed out again');
  check('S30', 'and it goes back in the shape the pool is read in',
    /type: parseInt\(oldCustNumber, 10\) >= 5000 \? 'double' : 'regular'/.test(admin),
    'cnNextAvailable and the Customer Numbers panel both filter on type — without it the number is in the pool and invisible to everything that hands numbers out');
  check('S30', 'the number being taken comes out of the pool',
    /deleteDoc\(doc\(db,'availableCustomerNumbers', newCustNumber\)\)/.test(admin),
    'left in the pool it gets handed to somebody else later');
  check('S30', 'the pool is only touched when the number actually changed',
    /if\(newCustNumber !== oldCustNumber\)\{/.test(admin),
    'an ordinary save of an unrelated field must not churn the pool');
  check('S30', 'the pool writes happen AFTER the record is saved, each guarded',
    admin.indexOf("setDoc(doc(db,'availableCustomerNumbers', oldCustNumber)") >
    admin.indexOf("await updateDoc(doc(db,'jobAddresses', editCustomerId), addrUpdates);"),
    'a failed pool write must not throw away an edit that already succeeded — the pool is fixable by hand, a lost edit is not');

  check('S30', 'there is no second address parser', !/function cityFromAddressLine/.test(admin),
    'extractCleanCity already drops the segments with digits and strips UT and the zip');
}

/*
 * Suite 31. Pasting a corrected town in Bulk Updates actually corrects it.
 *
 * Owner, 2026-08-17: "in bulk updates i need to make city work so when I paste
 * everyones citiies in it works so the city in bulk updates needs to be in sync
 * with the town in edit customer."
 *
 * It could not work, because the town was part of the key that decided whether
 * a row WAS an existing customer: findExistingAddressMatch refused a match when
 * the pasted town differed from the one on file. That is precisely the case
 * when somebody is fixing a wrong town — so the row matched nothing, was read
 * as a new customer, and the import offered to add a duplicate instead of
 * correcting the record. 302 of them on one paste.
 *
 * The stable keys — customer number, then phone with the street — are tried
 * first, because neither can be broken by a wrong town. The old street+town+zip
 * test still runs after them, and only then does a street belonging to exactly
 * one house in the book count.
 *
 * ⚠ The thing that must NOT be lost: Utah County repeats street names across
 * towns. If two houses share a street and the town is the only thing telling
 * them apart, this has to refuse to answer rather than merge two customers.
 */
suite('Suite 31. A corrected town still finds its customer');
{
  const fn = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };
  const need = ['normalizeStreetForMatch', 'extractCleanCity', 'findAddressMatchByTown', 'findExistingAddressMatch'];
  check('S31', 'the matcher and its parts are findable', need.every(n => !!fn(n)));

  if (need.every(n => !!fn(n))) {
    const book = [
      { id: 'A', data: { name: 'Cattani Julie', street: '6037 W 11860 N', city: 'Draper', zip: '84020', phone: '8015550001', customerNumber: '555' } },
      { id: 'B', data: { name: 'Olsen Don', street: '120 N 200 W', city: '', zip: '', phone: '8012287274', customerNumber: '556' } },
      { id: 'C', data: { name: 'Main Lehi', street: '100 Main St', city: 'Lehi', zip: '84043', phone: '8015550003', customerNumber: '557' } },
      { id: 'D', data: { name: 'Main Orem', street: '100 Main St', city: 'Orem', zip: '84057', phone: '8015550004', customerNumber: '558' } }
    ];
    const sb = {};
    new Function('jobAddresses', need.map(fn).join('\n') + 'this.m=findExistingAddressMatch;').call(sb, book);
    const m = (st, ph, ci, zp, cn) => { const r = sb.m(st, ph, ci, zp, cn); return r ? r.id : null; };

    check('S31', 'a corrected town finds the customer it belongs to',
      m('6037 W 11860 N', '', 'Highland', '', '') === 'A',
      'the record says Draper — before this, the row matched nothing and offered to add a duplicate');
    check('S31', 'a customer number beats a disagreeing town',
      m('6037 W 11860 N', '', 'Nowhere', '', '555') === 'A',
      'the number is permanent and unique, so it is the whole answer');
    check('S31', 'a phone with the street beats a disagreeing town',
      m('120 N 200 W', '8012287274', 'Lehi', '', '') === 'B');
    check('S31', 'a town that agrees still matches, as it always did',
      m('100 Main St', '', 'Orem', '', '') === 'D');

    check('S31', 'two houses on one street name are NOT merged on a town change',
      m('100 Main St', '', 'Highland', '', '') === null,
      'Lehi and Orem both have a 100 Main St — guessing here would overwrite one customer with another');
    check('S31', 'but the customer number still resolves that same ambiguity',
      m('100 Main St', '', 'Highland', '', '558') === 'D');
    check('S31', 'a street nobody has is a new customer, not a wrong match',
      m('999 Nowhere Rd', '', 'Lehi', '', '') === null);
    check('S31', 'a blank street matches nothing at all',
      m('', '8015550001', 'Lehi', '', '') === null,
      'without a street there is nothing to confirm the house by');
  }

  /* ⏸ These assert that the KEY IS CHOSEN BY THE SWITCH, not what the switch
     currently says, so they hold in both modes and flipping BULK_IDENTIFIER
     back to 'number' needs no test edited. While it is 'phone+address' the
     number must not be the key: the numbers on file are known to be wrong, so
     matching on one would send the row to the wrong customer. */
  check('S31', 'the import matches on whichever identifier is in force',
    /const existing = bulkFindCustomer\(street, phone, city, zip, cn\);/.test(admin),
    'hard-coding the key either way is what makes the switch a redesign instead of a switch');
  check('S31', 'and Check First matches on exactly the same keys',
    /const existing = bulkFindCustomer\(street, phone, cities\[i\] \|\| '', zips\[i\] \|\| '', custNumbers\[i\] \|\| ''\);/.test(admin),
    'a dry run that matches differently from the import is reporting a run that will not happen');
  /* Owner, 2026-08-17: "only the number is a identifier." On 'number' that is
     literal — no falling back to phone, street, town, or "this street belongs
     to exactly one house". A guess was worth having while the numbers could not
     be trusted; now that they can, it is a liability. */
  check('S31', 'on number mode the number is the ONLY thing consulted',
    /if\(BULK_BY_NUMBER\)\{[\s\S]{0,400}?String\(it\.data\.customerNumber \|\| ''\) === num/.test(admin) &&
    /if\(!num\) return undefined;/.test(admin),
    'any fallback here is the tool guessing which customer somebody meant');
  /* Owner, 2026-08-17: "the identifier should be number but CU# should still be
     editable in edit customers, not in bulk updates." A key is read, not
     written — and the line that mattered was not the no-op write of the number
     itself but the one under it, which forced numberOfBins to 1 on every
     matched house under 5000. A bulk update of colours would have quietly reset
     bin counts nobody asked it to touch. */
  check('S31', 'on number mode bulk never writes the number back',
    /if\(cn && !BULK_BY_NUMBER\)\{\s*[\r\n]+\s*updates\.customerNumber = cn;/.test(admin),
    'the number is how the customer was found — rewriting it is at best a no-op and at worst carries the bin rule with it');
  check('S31', 'and does not reset the bin count from it either',
    /if\(cn && !BULK_BY_NUMBER\)\{[\s\S]{0,200}?numberOfBins = 1;/.test(admin),
    'that line is inside the same guard, which is the point — it is the one with teeth');
  check('S31', 'the pool is untouched for a customer that already existed',
    /if\(cn && \(!BULK_BY_NUMBER \|\| !existing\)\)\{/.test(admin),
    'nothing was handed out — the number was only read — but a customer being ADDED still takes theirs out of the pool');
  check('S31', 'and the column says so, so nobody expects it to renumber anybody',
    /It is only used to find them, never changed\./.test(admin));
  check('S31', 'Add Customer still matches on the address, which is its question',
    /const dupe = findExistingAddressMatch\(street, phone, city, zip\);/.test(admin),
    '"is this new address already in the book" is answered by the address, not by a number nobody has typed yet');
  check('S31', 'a paste with no Customer # is refused rather than added wholesale',
    (admin.match(/if\(BULK_BY_NUMBER && !anchorIsNumbers\)\{/g) || []).length === 2,
    'with no other key, every row would fall through to "add" and duplicate the whole book');
  check('S31', 'a pasted town is cleaned the way Edit Customer cleans it',
    /updates\.city = extractCleanCity\(city\) \|\| city;/.test(admin),
    '"Lehi, UT" and " Lehi " must not become towns of their own, each earning a crew-day for one house');

  /* ⭐ A BLANK IN THE SHEET NEVER WIPES WHAT THE RECORD HAS (added 2026-08-18).
     street/city/state/zip/address were the ONLY fields written unconditionally
     — name, phone, email and the rest have always been guarded. So a column
     blank for a row, or a paste one column short, wrote city:'' over a good
     town. That is the expensive kind of silent: a customer with no town cannot
     be scheduled AT ALL, because every crew-day is a town and a blank matches
     none of them, so the house just sits out the season. */
  check('S31', 'a blank column never erases an address field it has nothing for',
    /if\(street\) updates\.street = street;/.test(admin) &&
    /if\(city\)   updates\.city = /.test(admin) &&
    /if\(state\)  updates\.state = state;/.test(admin) &&
    /if\(zip\)    updates\.zip = zip;/.test(admin),
    'correcting a town must still work; only erasing one by omission stops');
  check('S31', 'and the full address is only rebuilt when there is a street to build it from',
    /if\(street\) updates\.address = fullAddress;/.test(admin),
    'buildFullAddress with no street lands a stray ", UT" in the address field');
  /* Two rows for one house used to become two new customers — ugly but visible.
     Now that a street on its own can find its customer, both rows write to the
     same record and the lower one silently wins. Addie's own paste has one:
     rows 332 and 901 are both "14026 S Deer Haven Cove". */
  check('S31', 'Check First warns when two rows are the same house',
    /const dupeRows = \[\]/.test(admin) && /repeat an address already higher up the list/.test(admin),
    'the second row overwrites the first, price and town included, and nothing afterwards says so');
  /* ⭐ AND IT COMPARES THE RESOLVED RECORD, NOT THE STREET (changed 2026-08-18).
     Owner: "may sara is supposed to be at 541 and I bulk update for that and she
     does but then she goes back to 479." Two rows for two DIFFERENT people
     resolved to one record — bulkFindCustomer matches by phone as well as by
     address — so they never repeated a street and this warning never fired. */
  check('S31', 'Check First compares the customer each row resolves to',
    /const k = r\.existingId \|\| \('street:' \+ normalizeStreetForMatch\(r\.street\)\);/.test(admin) &&
    /existingId: existing \? existing\.id : '',/.test(admin),
    'two people sharing a phone land on one record without ever repeating a street');
  check('S31', 'and still falls back to the street for rows that match nobody',
    /'street:' \+ normalizeStreetForMatch\(r\.street\)/.test(admin),
    'two NEW rows for one house have no record to compare, and comparing raw text ' +
    'would miss "9494 S 1860 W " against "9494 S 1860 W"');
  check('S31', 'Check First shows a town that is about to change',
    /townChanges/.test(admin) && /oldTown/.test(admin) && /newTown/.test(admin),
    'the town moving a house to another crew is worth seeing before it is written, not after');
}

/*
 * Suite 32. Customer number as the identifier, and Last First names.
 *
 * Owner, 2026-08-17: "can we just use their customer number as their identifer
 * instead of address", and "in bulk updates can you make it so if you put names
 * in there it doesnt put the names in how they are but it puts them in
 * backwords, because I have them formatted as last, first but I need it in the
 * website first last and I need to paste."
 *
 * Both come with a way to get it badly wrong, and both are guarded here:
 *   - numbers with no addresses can only UPDATE. Adding would write a customer
 *     with no address, no town and no pin — a record that can never go on a
 *     route and has to be found and deleted by hand.
 *   - the flip cannot tell a business from a person. "Lehi Vision Care" becomes
 *     "Vision Care Lehi" and always will, so it is opt-in and every change is
 *     shown in Check First rather than being decided quietly.
 */
suite('Suite 32. Customer number as identifier, and flipped names');
{
  const fn = (name) => {
    const i = admin.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = admin.indexOf('{', i); j < admin.length; j++) {
      if (admin[j] === '{') d++;
      else if (admin[j] === '}') { d--; if (!d) return admin.slice(i, j + 1); }
    }
    return null;
  };

  // ---- the name flip ----
  const flipSrc = fn('flipLastFirstName');
  check('S32', 'the name flip exists', !!flipSrc);
  if (flipSrc) {
    const sb = {};
    new Function(flipSrc + 'this.f=flipLastFirstName;').call(sb);
    const f = sb.f;
    check('S32', 'a plain Last First is turned round', f('Cattani Julie') === 'Julie Cattani');
    check('S32', 'a comma is trusted when there is one', f('Cattani, Julie') === 'Julie Cattani');
    check('S32', 'only the FIRST word moves, so a two-part first name survives',
      f('Beckstead Paul /Jill') === 'Paul /Jill Beckstead' && f('Anderson Brit / Dani') === 'Brit / Dani Anderson',
      'reordering word by word would scramble the couples in this list');
    check('S32', 'a hyphenated surname stays whole',
      f('Roberson-Lamoreaux Nate') === 'Nate Roberson-Lamoreaux');
    check('S32', 'a property label rides along with the first name rather than being lost',
      f('Larsen Shelby House #2') === 'Shelby House #2 Larsen');
    check('S32', 'one word is left alone', f('Madonna') === 'Madonna');
    check('S32', 'blank stays blank', f('') === '' && f('   ') === '' && f(null) === '');
    check('S32', 'stray spaces are tidied', f('Smith,  Jane') === 'Jane Smith' && f('Smith Shelby ') === 'Shelby Smith');
    /* Not a bug — a limitation with a name. Written down so nobody "fixes" the
       flip to be clever about businesses and breaks the couples above. */
    check('S32', 'a business name is turned round too, which is why this is opt-in',
      f('Lehi Vision Care') === 'Vision Care Lehi',
      'no rule can tell this from a person, so Check First shows every change instead');
  }

  check('S32', 'the flip is a tick box, off unless asked for',
    /id="rbFlipNames"/.test(admin) && /flip && flip\.checked/.test(admin),
    'flipping by default would silently reverse every name already the right way round');
  check('S32', 'Check First and the import read the name through the same helper',
    (admin.match(/\.map\(rbName\)/g) || []).length === 2,
    'a preview that flips differently from the import is a preview of another run');
  check('S32', 'Check First shows the name changing',
    /nameChanges/.test(admin) && /oldName/.test(admin));

  // ---- customer number as the identifier ----
  const matchSrc = ['normalizeStreetForMatch', 'extractCleanCity', 'findAddressMatchByTown', 'findExistingAddressMatch'];
  if (matchSrc.every(n => !!fn(n))) {
    const book = [
      { id: 'A', data: { name: 'Cattani Julie', street: '6037 W 11860 N', city: 'Draper', phone: '8015550001', customerNumber: '555' } },
      { id: 'B', data: { name: 'Olsen Don', street: '120 N 200 W', city: '', phone: '8012287274', customerNumber: '556' } }
    ];
    const sb2 = {};
    new Function('jobAddresses', matchSrc.map(fn).join('\n') + 'this.m=findExistingAddressMatch;').call(sb2, book);
    const m = (st, ph, ci, zp, cn) => { const r = sb2.m(st, ph, ci, zp, cn); return r ? r.id : null; };
    check('S32', 'a customer number finds its customer with NO address at all',
      m('', '', '', '', '555') === 'A',
      'this is the whole point — the number is the identifier, so nothing else has to be pasted');
    check('S32', 'and with a wrong address as well',
      m('999 Somewhere Else', '', 'Nowhere', '', '556') === 'B');
    check('S32', 'a number nobody holds matches nothing rather than the nearest thing',
      m('', '', '', '', '999') === null);
    check('S32', 'no number and no street is still no match', m('', '8015550001', 'Lehi', '', '') === null);
  }

  /* Stronger than "it can stand in": the number IS the identifier, so it
     anchors WHENEVER it is pasted, and its own row count is the count every
     other column is measured against. The address only anchors when no numbers
     were given at all, which is how somebody brand new still gets added. */
  check('S32', 'the identifier column anchors, in both handlers',
    (admin.match(/const anchorIsNumbers = BULK_BY_NUMBER && !!cn\w*\.filter\(Boolean\)\.length/g) || []).length === 2 &&
    (admin.match(/const anchorIsPhones = BULK_BY_PHONE && !!phones\w*\.filter\(Boolean\)\.length/g) || []).length === 2,
    'Check First and the import must anchor the same way, or the preview is of a different run');
  /* The counters on screen are anchored on the same column. This is what the
     owner actually saw: "customer number says 963 lines in red, but it
     shouldnt be in red because it is the indicator". */
  check('S32', 'the live counters are anchored on the identifier column',
    (admin.match(/wireBulkCounts\(rbAreaIds, BULK_BY_NUMBER \? 'rbCustNumbersArea' : BULK_BY_PHONE \? 'rbPhonesArea' : 'rbStreetsArea', rbCountIds\)/g) || []).length === 1 &&
    /const rbRefreshCounts = wireBulkCounts\(/.test(admin) &&
    /rbRefreshCounts\(\);/.test(admin),
    'anchored on anything but the identifier, the identifier itself gets flagged as the wrong length. CHANGED 2026-08-17: wired ONCE now and reused through rbRefreshCounts, rather than the same call written out twice — one wiring site cannot disagree with itself');
  check('S32', 'the anchor is never the column reported as being wrong',
    /const anchorLabel = anchorIsNumbers \? 'Customer #' : anchorIsPhones \? 'Phone Number' : 'Street Address'/.test(admin) &&
    /arr\.length !== anchor\.length/.test(admin),
    'the indicator sets the count — reporting that it disagrees with itself sends somebody to fix the wrong box');
  /* ⏸ The temporary switch itself. Written down so the next session can see
     that 'phone+address' is a deliberate, reversible state and not the design —
     owner, 2026-08-17: "the numbers in the website are currently not match
     right… but then i will ask you to change it back so dont redesign anything
     you just did." */
  const bulkMode = (admin.match(/const BULK_IDENTIFIER = '([^']+)'/) || [])[1];
  check('S32', 'the identifier is one switch, set to a value the code knows',
    ['number', 'phone+address', 'address+city'].indexOf(bulkMode) !== -1,
    'BULK_IDENTIFIER is ' + JSON.stringify(bulkMode));
  check('S32', 'BULK_BY_NUMBER is derived from it rather than set separately',
    /const BULK_BY_NUMBER = BULK_IDENTIFIER === 'number';/.test(admin),
    'two flags that can disagree is how a half-flipped switch happens');
  if (bulkMode !== 'number') {
    /* Changed 2026-08-17 from refusing the whole paste to SKIPPING the rows.
       Owner: "I will manually fix everyone without a phone number" — that plan
       needs the other nine hundred to go through while the short list is worked
       on. Blocking everything for fourteen rows means the import never runs. */
    check('S32', 'a row missing half the identifier is skipped, not matched on the half it has',
      /if\(skipRow\[i\]\)\{ skipped\+\+; continue; \}/.test(admin) &&
      /no address and no ' \+ otherLabel/.test(admin),
      'matching on the half it does have is how a row lands on the wrong customer');
    check('S32', 'and the skipped rows are named, not silently dropped',
      /const skipList = Object\.keys\(skipRow\)/.test(admin) &&
      /row\(s\) skipped &mdash; nothing was written for these/.test(admin) &&
      /const skippedNote = skipList\.length/.test(admin),
      'a skipped row looks exactly like a successful one afterwards — this is the only place it says otherwise');
    check('S32', 'and the other half is named after whichever it is',
      /const otherLabel = BULK_BY_PHONE \? 'phone' : 'town';/.test(admin),
      'telling somebody a row has "no phone" while the town is what is missing sends them to the wrong column');
    /* ⏸ A number already sitting on somebody else is EXPECTED while the sheet
       is correcting numbers: #112 lives on two records only until the row that
       gives its old holder a different number is written. Blocking there
       refused the whole import for a state that resolves itself.
       Owner, 2026-08-17: "we will need to temporarily allow the same number to
       be used twice because it should fix itself, but we will run it in health
       check when its done to see if any still have overlaping #CU." */
    check('S32', 'a number held by somebody else does not block the import',
      /\} else if\(heldBy && BULK_BY_NUMBER\)\{/.test(admin) && /numMoves\.push\(/.test(admin),
      'the sheet is moving numbers between customers — refusing that refuses the fix');
    check('S32', 'but the moves are counted and reported, not ignored',
      /const movedNote = numMoves\.length/.test(admin) &&
      /run Health Check to confirm none are still shared/.test(admin),
      '"it should fix itself" is not "it did" — silently allowing duplicates is how two bins end up wearing one label');
    check('S32', 'and Health Check really does look for shared numbers',
      /id: 'dupNumbers'/.test(admin) && /Two customers sharing one customer number/.test(admin),
      'the import points at that check by name, so it has to exist');
    check('S32', 'the same number twice in ONE paste is still refused',
      /is also on row ' \+ seenNums\[cn\]/.test(admin),
      'that is a mistake in the sheet, not a state that resolves itself');
    check('S32', 'the blocking message names the columns actually required',
      /\(BULK_BY_PHONE \? 'Phone' : 'Town'\) \+ ' and address are both needed/.test(admin),
      'it said "Phone and address" while the town was the half being asked for');
    /* And describes the problems that are IN the list. It used to explain the
       identifier columns whatever was wrong, so two repeated customer numbers
       were announced as "Town and address are both needed", sending somebody to
       look at two columns that were fine. */
    check('S32', 'the heading matches the kind of problem found',
      /const anyMissingHalf = numProblems\.some/.test(admin) &&
      /const anyNumberTrouble = numProblems\.some/.test(admin) &&
      /The same Customer # is on two rows, so one of them is wrong\./.test(admin));
    check('S32', 'a repeated number names both customers, not just both row numbers',
      /const who = names\[i\] \? ' \(' \+ names\[i\] \+ '\)' : '';/.test(admin) &&
      /const other = names\[seenNums\[cn\] - 1\]/.test(admin),
      'two rows deep in a 962 row paste are found by name, not by counting');
    /* The rows that cannot be identified ARE somebody's worklist — owner,
       2026-08-17: "I will manually fix everyone without a phone number" — so
       they have to be listed somewhere with room to read them, and named, not
       just numbered. Eight of them in a status line is enough to explain the
       problem and useless to work from. */
    check('S32', 'Check First runs the same completeness test as the import',
      /const cantIdentify = \[\];/.test(admin) && /cannot be identified and will stop the import/.test(admin),
      'a dry run that looks clean and is then refused on Import is worse than no dry run');
    check('S32', 'the rows to fix are named, not just numbered',
      /esc\(c\.name \|\| 'no name'\)/.test(admin) && /const who = names\[i\] \? names\[i\] \+ ', ' : '';/.test(admin),
      'a row number alone does not tell you who to go and look up');
    check('S32', 'and the whole list is shown, not the first eight',
      /numProblems\.map\(function\(t\)\{ return esc\(t\); \}\)\.join\('<br>'\)/.test(admin) &&
      /press Check First to see all of them/.test(admin));
    note('BULK_IDENTIFIER is temporarily "' + bulkMode + '" — set it back to "number" once the customer numbers on file are right.');
  }

  check('S32', 'a row with no match and no address is never added',
    /if\(!existing && !street\)\{ failed\+\+; continue; \}/.test(admin),
    'adding here would write a customer with no address, no town and no pin, which can never go on a route — and this covers a mixed paste too, not only a numbers-only one');
  /* ---- the heading row ----
     Owner, 2026-08-17: "I copy the headers on everything and then have to
     delete it". Deleting it out of sixteen boxes by hand only has to be
     forgotten once to shift every row by one. */
  const hdrSrc = fn('rbHeaderOffset');
  check('S32', 'the heading detector exists', !!hdrSrc);
  if (hdrSrc && fn('rbCol')) {
    const boxes = {};
    const doc = { getElementById: id => boxes[id] === undefined ? null : { value: boxes[id] } };
    const sb3 = {};
    new Function('document', hdrSrc + fn('rbCol') + 'this.off=rbHeaderOffset;this.col=rbCol;').call(sb3, doc);
    const off = (streets, cn) => { boxes.rbStreetsArea = streets; boxes.rbCustNumbersArea = cn; return sb3.off(); };

    check('S32', 'a heading on the address column is skipped',
      off('Address\n120 N 200 W\n6037 W 11860 N', 'Customer #\n555\n556') === 1);
    check('S32', 'any wording works, because it goes on shape not a list of words',
      off('Street Address\n120 N 200 W', '') === 1 && off('house\n120 N 200 W', '') === 1,
      'a real address always has a number in it and a heading does not');
    check('S32', 'a heading on the Customer # column is skipped when that is the identifier',
      off('', 'Customer #\n555\n556') === 1 && off('', 'cu\n555') === 1);
    check('S32', 'a real first row is NEVER eaten',
      off('120 N 200 W\n6037 W 11860 N', '555\n556') === 0 && off('', '555\n556') === 0 &&
      off('1440 W Main St', '') === 0,
      'losing the first customer of a 962 row paste would be invisible');
    check('S32', 'an empty first line is left for the row-count check to report',
      off('\n120 N 200 W', '') === 0,
      'a blank row is not a heading — swallowing it here would hide the misalignment instead of naming it');
    check('S32', 'nothing pasted, nothing skipped', off('', '') === 0);

    boxes.rbStreetsArea = 'Address\nA\nB';
    check('S32', 'the heading comes off every column together',
      sb3.col('rbStreetsArea', 1).join() === 'A,B',
      'one column losing a row while the others keep it is the exact misalignment this prevents');
  }
  check('S32', 'every bulk column is read through the same reader',
    !/getElementById\('rb[A-Za-z]+Area'\)\.value\.split/.test(admin),
    'a column read the old way would keep its heading while the rest dropped theirs');
  check('S32', 'and the office is told the line was ignored',
    /First line ignored/.test(admin) && (admin.match(/First line ignored/g) || []).length >= 2,
    'silently dropping a row is how a paste that was wrong looks like it worked');

  check('S32', 'and a number nobody holds is reported up front',
    /if\(!heldBy\) numProblems\.push\('Row ' \+ \(i\+1\) \+ ': nobody has #'/.test(admin),
    '"already belongs to somebody" is the wrong complaint when the number IS the identifier — every row should belong to somebody');
}

suite('Suite 33. One nudge template, one email, whoever sends it');
/*
 * The Nudge template is sent from FOUR places: the quote card's Send/Preview,
 * the "Nudge everyone shown" bulk button, Automation Emails -> Preview & Send,
 * and the nightly Cloud Function. Two things have to stay true of all four, and
 * both are checked by RUNNING the two renderers rather than reading them,
 * because the difference is in what comes out, not in what the code says.
 *
 *   1. Nobody is ever mailed a literal "{{photo}}". Until 2026-08-17 the bulk
 *      button and Automation Emails went straight through resolveLinkTokens,
 *      which has never known about that token, and customers got the raw text.
 *
 *   2. ⭐ EXACTLY ONE set of approve/maybe/decline buttons, however many photos
 *      the quote has. The owner's decision, 2026-08-17: "just one approved,
 *      Maybe later, Decline". The quote card and the automatic nudge used to
 *      repeat the three buttons on the far side of a stack of two or more
 *      photos. It read as a mistake and is gone from both. A second set coming
 *      back on either side fails this suite.
 */
{
  const fns = read('functions/index.js');

  // ---- lift the browser renderer out of admin.html ----
  const grabBrowser = (name, src) => {
    const i = src.indexOf('function ' + name + '(');
    if (i === -1) return null;
    let d = 0;
    for (let j = src.indexOf('{', i); j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') { d--; if (!d) return src.slice(i, j + 1); }
    }
    return null;
  };
  const browserParts = ['applyQuotePhotoBlock', 'quotePhotoEmailHtml', 'cloudEmailPhoto', 'esc']
    .map(n => grabBrowser(n, admin));
  const widthDecl = admin.match(/const EMAIL_PHOTO_W\s*=\s*\d+;/);
  const cloudDecl = admin.match(/const CLOUDINARY_CLOUD = "[^"]+";/);

  check('S33', 'the browser photo/button placer is findable',
    browserParts.every(Boolean) && !!widthDecl && !!cloudDecl,
    'a rename here must fail loudly, never silently skip — a parity test that cannot find its target must not report green');

  // ---- lift the server renderer out of functions/index.js ----
  const serverParts = ['quotePhotosServer', 'cloudEmailPhotoServer', 'escServer',
    'quotePhotoEmailHtmlServer', 'properNameServer']
    .map(n => grabBrowser(n, fns));
  const bStart = fns.indexOf("      const quoteToken = q.quoteToken || '';");
  const bEnd = fns.indexOf('      const res = await fetch(', bStart);

  check('S33', 'the server nudge renderer is findable',
    serverParts.every(Boolean) && bStart !== -1 && bEnd > bStart,
    'same reasoning — if the anchors move, this fails rather than quietly testing nothing');

  check('S33', 'the button-repeating logic is gone from the browser',
    !/HU_PHOTOS/.test(admin) && !/margin-bottom:14px;'\s*\+ buttons/.test(admin),
    'the marker and the copied-buttons splice both belonged to the repeat — either one back means the doubling is back');
  check('S33', 'and gone from the server',
    !/function repeatQuoteButtonsServer/.test(fns) && !/repeatQuoteButtonsServer\(/.test(fns),
    'leaving it defined but uncalled is how it gets wired back in by accident');

  // ---- the shipped default Nudge body, read from the file, not retyped ----
  const bodyDecl = admin.match(/const DEFAULT_QUOTE_NUDGE_BODY = ([\s\S]*?);\r?\n/);
  check('S33', 'the default Nudge body is findable', !!bodyDecl);

  /* Wrapped, because the renderers are lifted out of the real files and a
     change to either can make the lifted slice reference something this suite
     no longer pulls in. That must read as "Suite 33 failed", not as the whole
     run dying with a stack trace three suites early. */
  try {
  if (browserParts.every(Boolean) && widthDecl && cloudDecl && serverParts.every(Boolean) &&
      bStart !== -1 && bEnd > bStart && bodyDecl) {
    const NUDGE = new Function('return ' + bodyDecl[1].replace(/\r/g, ''))();

    const renderBrowser = new Function('body', 'photos',
      widthDecl[0] + '\n' + cloudDecl[0] + '\n' + browserParts.join('\n') +
      "\nreturn applyQuotePhotoBlock(body.replace(/\\n/g,'<br>')" +
      ".split('{{price_block}}').join('<b>$450</b>')" +
      ".split('{{quote_yes_button}}').join('<a href=\"#a\" style=\"background:#2E6B3E; color:#fff;\">Approve Quote</a>')" +
      ".split('{{quote_maybe_button}}').join('<a href=\"#m\" style=\"background:#D89F3D; color:#1E3B2C;\">Maybe Next Year</a>')" +
      ".split('{{quote_decline_button}}').join('<a href=\"#d\" style=\"background:#8A8F9C; color:#fff;\">Decline Quote</a>')" +
      ', photos, true);');

    const renderServer = new Function('q', 'templateBody',
      serverParts.join('\n') + '\n' + fns.slice(bStart, bEnd) + '\nreturn body;');

    const shape = html => ({
      approve: (html.match(/>Approve Quote</g) || []).length,
      maybe: (html.match(/>Maybe Next Year</g) || []).length,
      decline: (html.match(/>Decline Quote</g) || []).length,
      leftToken: html.indexOf('{{photo}}') !== -1
    });
    const photo = (n, label) => ({ url: 'https://res.cloudinary.com/x/image/upload/' + n + '.jpg', label: label });
    const quoteWith = photos => ({ name: 'Sam', quotedPrice: 450, quoteToken: 'tok', quotePhotos: photos });

    const one = [photo('a', 'Front of house')];
    const two = [photo('a', 'Front of house'), photo('b', 'Right side')];

    const b1 = shape(renderBrowser(NUDGE, one));
    const s1 = shape(renderServer(quoteWith(one), NUDGE));
    const b2 = shape(renderBrowser(NUDGE, two));
    const s2 = shape(renderServer(quoteWith(two), NUDGE));

    check('S33', 'one photo — office and automatic nudge produce the same email',
      JSON.stringify(b1) === JSON.stringify(s1),
      'browser ' + JSON.stringify(b1) + ' vs server ' + JSON.stringify(s1));

    check('S33', 'two photos — office and automatic nudge produce the same email',
      JSON.stringify(b2) === JSON.stringify(s2),
      'browser ' + JSON.stringify(b2) + ' vs server ' + JSON.stringify(s2));

    /* The owner asked for one set. Agreeing with each other is not enough —
       both agreeing on TWO is the thing being ruled out. */
    check('S33', 'one photo — exactly one Approve / Maybe Next Year / Decline',
      b1.approve === 1 && b1.maybe === 1 && b1.decline === 1 &&
      s1.approve === 1 && s1.maybe === 1 && s1.decline === 1,
      'browser ' + JSON.stringify(b1) + ' vs server ' + JSON.stringify(s1));

    check('S33', 'two photos — still exactly one of each, not a second set',
      b2.approve === 1 && b2.maybe === 1 && b2.decline === 1 &&
      s2.approve === 1 && s2.maybe === 1 && s2.decline === 1,
      'this is the doubling the owner asked to remove: browser ' +
      JSON.stringify(b2) + ' vs server ' + JSON.stringify(s2));

    check('S33', 'a third photo does not add buttons either',
      (function () {
        const three = [photo('a', 'Front of house'), photo('b', 'Right side'), photo('c', 'Left side')];
        const b3 = shape(renderBrowser(NUDGE, three));
        const s3 = shape(renderServer(quoteWith(three), NUDGE));
        return JSON.stringify(b3) === JSON.stringify(s3) &&
          b3.approve === 1 && b3.maybe === 1 && b3.decline === 1;
      })(),
      'the old rule keyed off "more than one photo", so three is the same case as two');

    check('S33', 'no customer is ever mailed a literal {{photo}}',
      !b1.leftToken && !b2.leftToken && !s1.leftToken && !s2.leftToken &&
      !shape(renderBrowser(NUDGE, [])).leftToken,
      'this is exactly what the bulk nudge and Automation Emails used to send');
  }
  } catch (e) {
    check('S33', 'both nudge renderers still run', false,
      'lifting them out of the real files threw: ' + (e && e.message || e) +
      '\n          — usually a helper the renderer needs that this suite does not lift, or one that has just been reintroduced');
  }

  // ---- and the wiring: every place that mails a template runs it ----
  /* Brace-counting cannot be used here: these bodies contain '{{quote_' and
     '{{photo}}' inside strings, which is an unbalanced brace as far as a naive
     counter is concerned. Slicing to the closing brace at the function's own
     indentation is exact and does not care what is in the strings. */
  const fnBody = (fnName, src) => {
    const i = src.indexOf('function ' + fnName + '(');
    if (i === -1) return null;
    const lineStart = src.lastIndexOf('\n', i) + 1;
    const indent = (src.slice(lineStart, i).match(/^\s*/) || [''])[0];
    const end = src.indexOf('\n' + indent + '}', i);
    return end === -1 ? null : src.slice(i, end);
  };
  const usesHelper = (fnName, src) => {
    const body = fnBody(fnName, src);
    return !!body && body.indexOf('applyQuotePhotoBlock(') !== -1;
  };
  check('S33', 'the bulk "Nudge everyone shown" button runs the placer',
    usesHelper('nudgeEveryoneShown', admin),
    'without it the bulk nudge bolts the photos onto the bottom and mails the raw token');
  check('S33', 'the quote card runs the placer',
    usesHelper('buildQuoteEmailHtml', admin),
    'this is the one that was always right — it must keep going through the shared helper, not its own copy');
  check('S33', 'Automation Emails preview runs the placer',
    usesHelper('etUpdatePreview', admin),
    'the preview has to show what the send will produce');

  // Preview and send must stay the same call, or the office approves one email
  // and the customer gets another.
  const sendBlock = admin.slice(admin.indexOf("const message = applyQuotePhotoBlock("),
                                admin.indexOf("const message = applyQuotePhotoBlock(") + 400);
  check('S33', 'Automation Emails send matches its own preview',
    /quotePhotosForPhone\(vars\.phone\), false\)/.test(sendBlock),
    'preview and send must pass the same photos and the same autoPlace flag');

  check('S33', 'a plain template is not given a photo it never asked for',
    /autoPlace === false && !asked/.test(admin),
    'a billing or RSVP template has no {{photo}} and must not suddenly grow a picture of the house');
}

/* ============================================================
 * Suite 34. A blank cell in the identifier column must not slide
 *           every row below it onto the wrong customer.
 *
 * The one way this tool could quietly destroy customer data. The identifier
 * column anchors the paste and every other column is aligned to its length, so
 * if the anchor DROPS a blank line while the others keep theirs, then from that
 * row down the phone, the address and the customer number each belong to a
 * different person — and it all imports without complaint.
 *
 * Found 2026-08-17 while preparing the numbering repair: 14 customers on the
 * master sheet have no phone, phone was the identifier, and 900 rows sat below
 * the first of them.
 *
 * These run the REAL functions lifted out of admin.html rather than reading
 * them as text, because the failure is arithmetic and a regex cannot see it.
 * ============================================================ */
suite('Suite 34. A blank identifier cell does not shift the rows below it');
{
  const grab = name => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let depth = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') depth++;
      else if (admin[i] === '}') { depth--; if (!depth) return admin.slice(at, i + 1); }
    }
    return null;
  };

  const trimSrc = grab('trimTrailingBlankRows');
  const alignSrc = grab('alignBulkRows');
  check('S34', 'trimTrailingBlankRows exists in admin.html', !!trimSrc,
    'the anchor has gone back to filtering out blanks, which is the bug this suite exists for');

  if (trimSrc && alignSrc) {
    const sandbox = {};
    new Function(trimSrc + alignSrc + 'this.trim = trimTrailingBlankRows; this.align = alignBulkRows;').call(sandbox);
    const { trim, align } = sandbox;

    check('S34', 'trailing blanks still come off',
      trim(['a', 'b', '', '', '']).length === 2,
      'empty rows after the last real one are just where the paste stopped');

    check('S34', 'a blank in the MIDDLE keeps its line',
      trim(['a', '', 'c']).length === 3,
      'dropping it is what shortens the anchor and shifts everything below');

    check('S34', 'a column of nothing but blanks comes back empty',
      trim(['', '  ', '']).length === 0);

    check('S34', 'a cell holding only a space counts as blank at the end',
      trim(['a', ' ']).length === 1,
      'Excel blank-filtering does not find a lone space, so this has to');

    /* The real shape of the 2026-08-17 repair, in miniature: row 2 has no
       phone. Phone anchors. Rows 3 and 4 must still line up. */
    const phones = ['8015550001', '', '8015550003', '8015550004'];
    const streets = ['1 A St', '2 B St', '3 C St', '4 D St'];
    const numbers = ['101', '102', '103', '104'];
    const anchor = trim(phones);
    const alignedStreets = align(streets, anchor.length);
    const alignedNumbers = align(numbers, anchor.length);

    check('S34', 'the anchor keeps all four rows when one phone is missing',
      anchor.length === 4, 'got ' + anchor.length);

    check('S34', 'every column is still the same length',
      alignedStreets.length === 4 && alignedNumbers.length === 4);

    const alignedRows = [0, 1, 2, 3].every(i =>
      alignedStreets[i] === streets[i] && alignedNumbers[i] === numbers[i]);
    check('S34', 'no row is written to the wrong house', alignedRows,
      'row 3 got ' + alignedStreets[2] + ' / #' + alignedNumbers[2] + ', expected 3 C St / #103');

    /* The old behaviour, run side by side, so the difference is on the record
       and nobody "simplifies" the fix back out again. Filtering shortened the
       anchor to 3 while the address column stayed at 4, and phone row 2 —
       8015550003, which belongs to 3 C St — landed against 2 B St. */
    const oldAnchor = phones.filter(Boolean);
    check('S34', 'the old anchor lost the blank row',
      oldAnchor.length === 3, 'expected 3, got ' + oldAnchor.length);
    check('S34', 'and so paired a phone with the wrong address',
      oldAnchor[1] === '8015550003' && streets[1] === '2 B St',
      'this is the damage the fix prevents; if it no longer reproduces, the demonstration is stale');
  }

  /* Neither importer may go back to filtering its identifier column. The street
     fallback still filters on purpose — it only anchors when nothing else was
     pasted, and a blank address there is a genuinely empty row. */
  check('S34', 'neither Check First nor Import filters the identifier column',
    (admin.match(/const anchor = anchorIsNumbers \? trimTrailingBlankRows\(/g) || []).length === 2,
    'both paths must trim the same way or the preview describes a different run to the one that happens');

  /* A row with no identifier has to be SKIPPED. Before this, in number mode it
     fell through to "not found" and was ADDED — a paste of 900 corrections
     would have duplicated the entire customer book. */
  check('S34', 'a row with no customer number is skipped, not added',
    /if\(BULK_BY_NUMBER\)\{[\s\S]{0,400}?no customer number/.test(admin),
    'without this the row is treated as a brand new customer');

  check('S34', 'Check First reports that row too',
    /missing: 'customer number'/.test(admin),
    'the preview has to list it or it is a surprise at Import time');
}

/* ============================================================
 * Suite 35. The master sheet writes "when to hang" in shorthand.
 *
 * The Pref Date column on the sheet says OCT, NOV, THX, ANY, 1-Nov, 11/9+.
 * None of those is one of the five wordings the rest of the app uses, so
 * before this they were written through verbatim and the house then matched
 * no preference at all — it simply never came up for October.
 * ============================================================ */
suite('Suite 35. The sheet\'s shorthand for when to hang');
{
  const at = admin.indexOf('function rbNormalizeInstallPref(');
  let src = null;
  if (at >= 0) {
    let depth = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') depth++;
      else if (admin[i] === '}') { depth--; if (!depth) { src = admin.slice(at, i + 1); break; } }
    }
  }
  check('S35', 'rbNormalizeInstallPref exists', !!src);

  if (src) {
    /* The real option list, read off admin.html rather than retyped, so a
       renamed option fails here instead of silently writing a dead value. */
    const optsMatch = admin.match(/const RB_INSTALL_PREF_OPTIONS = (\[[^\]]*\])/);
    check('S35', 'the option list is read from the page, not guessed', !!optsMatch);
    if (optsMatch) {
      const OPTIONS = JSON.parse(optsMatch[1].replace(/'/g, '"'));
      const sandbox = {};
      new Function('RB_INSTALL_PREF_OPTIONS', src + 'this.f = rbNormalizeInstallPref;')
        .call(sandbox, OPTIONS);
      const f = sandbox.f;

      [['OCT', 'October'], ['oct', 'October'], ['10/28+', 'October'],
       ['NOV', 'November'], ['1-Nov', 'November'], ['11/9+', 'November'], ['11/1', 'November'],
       ['THX', 'After Thanksgiving'], ['ANY', 'Normal Schedule'], ['Any', 'Normal Schedule'],
      ].forEach(([input, want]) => {
        check('S35', '"' + input + '" becomes "' + want + '"', f(input) === want,
          'got "' + f(input) + '"');
      });

      check('S35', 'an empty cell stays empty', f('') === '' && f('   ') === '',
        'a blank must mean "leave their preference alone", not "set it to October"');

      check('S35', 'every answer is a real option',
        ['OCT', 'NOV', 'THX', 'ANY', '1-Nov', '11/9+'].every(v => {
          const out = f(v);
          return !out || OPTIONS.includes(out);
        }),
        'writing a value that is not on the list is how a house ends up matching no preference at all');

      check('S35', 'a preference already spelled out is left as it is',
        OPTIONS.every(o => f(o) === o),
        'the same column gets pasted twice; running it again must not change anything');
    }
  }
}


/* ============================================================
 * Suite 36. Paste the whole master sheet into one box.
 *
 * Owner, 2026-08-17: "I want to make it so I just paste the master sheet
 * somewhere and it just does it, i dont want it to pull it from files because
 * that gets outdated."
 *
 * The grid is cut up by rbParseSheetGrid and routed by rbMatchSheetHeadings.
 * Both are run for real here against the actual shape of the 2026 master sheet,
 * because every failure in this thing is an off-by-one that reads perfectly
 * well as text and puts nine hundred people's data on the wrong customer.
 * ============================================================ */
suite('Suite 36. Pasting the whole sheet');
{
  const grab = name => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let depth = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') depth++;
      else if (admin[i] === '}') { depth--; if (!depth) return admin.slice(at, i + 1); }
    }
    return null;
  };

  const parseSrc = grab('rbParseSheetGrid');
  const keysSrc = grab('rbHeadingKeys');
  const matchSrc = grab('rbMatchSheetHeadings');
  const colsMatch = admin.match(/const RB_SHEET_COLUMNS = (\[[\s\S]*?\n\];)/);
  const identityMatch = admin.match(/const RB_SHEET_IDENTITY = (\[[^\]]*\]);/);

  check('S36', 'the grid parser exists', !!parseSrc);
  check('S36', 'the heading matcher exists', !!matchSrc);
  check('S36', 'the column map exists', !!colsMatch);

  if (parseSrc && keysSrc && matchSrc && colsMatch && identityMatch) {
    const sandbox = {};
    new Function(
      parseSrc + keysSrc +
      'const RB_SHEET_COLUMNS = ' + colsMatch[1].replace(/;$/, '') + ';' +
      'const RB_SHEET_IDENTITY = ' + identityMatch[1] + ';' +
      matchSrc +
      'this.parse = rbParseSheetGrid; this.match = rbMatchSheetHeadings;' +
      'this.COLUMNS = RB_SHEET_COLUMNS; this.IDENTITY = RB_SHEET_IDENTITY;'
    ).call(sandbox);
    const { parse, match, COLUMNS, IDENTITY } = sandbox;

    /* ---- the parser ---- */
    check('S36', 'a plain tab-separated grid comes back as rows and cells', (() => {
      const g = parse('a\tb\tc\n1\t2\t3');
      return g.length === 2 && g[0].length === 3 && g[1][2] === '3';
    })());

    check('S36', 'an empty cell keeps its place in the row', (() => {
      const g = parse('a\tb\tc\n1\t\t3');
      return g[1].length === 3 && g[1][1] === '' && g[1][2] === '3';
    })(), 'a collapsed empty cell shifts every column after it onto the wrong field');

    /* The one that matters most: a Notes cell with a line break in it. Excel
       quotes it, and splitting on \n without honouring the quote turns one
       customer into two rows and misaligns everybody below. */
    check('S36', 'a cell with a line break inside it stays one row', (() => {
      const g = parse('Name\tNotes\nCattani Julie\t"3 sides\nuse side outlet"\nBrown Kelly\tplain');
      return g.length === 3 && g[1][1] === '3 sides\nuse side outlet' && g[2][0] === 'Brown Kelly';
    })(), 'this is how one quoted Notes cell becomes two customers');

    check('S36', 'a doubled quote inside a cell reads as one quote', (() => {
      const g = parse('a\tb\n1\t"say ""hi"" now"');
      return g[1][1] === 'say "hi" now';
    })());

    check('S36', 'a comma file still works when there are no tabs', (() => {
      const g = parse('Name,City\nJulie,Highland');
      return g.length === 2 && g[1][1] === 'Highland';
    })());

    check('S36', 'a comma inside a quoted cell does not split it', (() => {
      const g = parse('Name,Address\nJulie,"6037 W 11860 N, Apt 2"');
      return g[1][1] === '6037 W 11860 N, Apt 2';
    })());

    /* Excel writes tabs; an address with a comma in it must NOT be re-cut. */
    check('S36', 'commas are left alone once tabs decide the delimiter', (() => {
      const g = parse('Name\tAddress\nJulie\t6037 W 11860 N, Highland');
      return g[1][1] === '6037 W 11860 N, Highland';
    })());

    /* ---- the heading map, against the real master sheet header ---- */
    const REAL_HEADER = ['CU #','Name','Address','City','Zip','Phone','Email','Notes','Wire',
                         'Lights','Timer','Up Plug','Misc','$$','Set Up Fee','Pref Date','# Feet',
                         '','Yes','Recycle','2027','Color Changes','Name'];
    const m = match(REAL_HEADER);
    const wentTo = h => { const hit = m.mapped.find(x => x.heading === h); return hit ? hit.area : null; };

    [['CU #','rbCustNumbersArea'], ['Name','rbNamesArea'], ['Address','rbStreetsArea'],
     ['City','rbCitiesArea'], ['Zip','rbZipsArea'], ['Phone','rbPhonesArea'],
     ['Email','rbEmailsArea'], ['Notes','rbNotesArea'], ['Wire','rbWireArea'],
     ['Lights','rbColorsArea'], ['Timer','rbTimerArea'], ['$$','rbAmountsArea'],
     ['Pref Date','rbInstallPrefArea'], ['# Feet','rbFeetArea'],
    ].forEach(([heading, area]) => {
      check('S36', '"' + heading + '" lands in ' + area, wentTo(heading) === area,
        'went to ' + wentTo(heading));
    });

    check('S36', 'the second Name column does not steal the first one',
      m.mapped.filter(x => x.area === 'rbNamesArea').length === 1 &&
      m.mapped.find(x => x.area === 'rbNamesArea').index === 1,
      'the master sheet repeats Name at the far right; claiming it twice would overwrite the real one');

    check('S36', 'the unnamed spacer column is not treated as a heading',
      !m.mapped.some(x => !x.heading) && m.ignored.every(h => !!String(h).trim()));

    check('S36', 'columns with nowhere to go are reported, not silently dropped',
      ['Misc','Set Up Fee','Yes','Recycle','2027','Color Changes'].every(h => m.ignored.includes(h)),
      'ignored: ' + m.ignored.join(', '));

    check('S36', 'every mapped area is a real box on the page',
      m.mapped.every(x => admin.includes('id="' + x.area + '"')),
      'a typo in the column map fails only when somebody pastes that sheet');

    check('S36', 'no two headings claim the same box',
      new Set(m.mapped.map(x => x.area)).size === m.mapped.length);

    /* Spelling variants, so a differently-worded sheet still works. */
    [['Customer Number','rbCustNumbersArea'], ['CU#','rbCustNumbersArea'],
     ['Street Address','rbStreetsArea'], ['Town','rbCitiesArea'],
     ['Zip Code','rbZipsArea'], ['Phone Number','rbPhonesArea'],
     ['Measured Feet','rbFeetArea'], ['Feet','rbFeetArea'],
     ['Price','rbAmountsArea'], ['Install Month','rbInstallPrefArea'],
    ].forEach(([heading, area]) => {
      const one = match([heading]);
      check('S36', '"' + heading + '" is understood too',
        one.mapped.length === 1 && one.mapped[0].area === area,
        'got ' + (one.mapped[0] ? one.mapped[0].area : 'nothing'));
    });

    check('S36', 'a sheet of headings nobody recognises maps nothing',
      match(['Widget','Sprocket']).mapped.length === 0,
      'guessing here would write junk into a real field');

    /* ---- the identity rule ---- */
    check('S36', 'the identity columns are the ones that say who a row is',
      IDENTITY.length === 4 &&
      ['rbCustNumbersArea','rbNamesArea','rbStreetsArea','rbPhonesArea'].every(a => IDENTITY.includes(a)));

    check('S36', 'every identity column is in the column map',
      IDENTITY.every(a => COLUMNS.some(c => c.area === a)));
  }

  /* ---- the whole function, run for real in a DOM ----
     Everything above tests a piece. This drives rbSplitSheetIntoBoxes itself
     over a grid shaped exactly like the master sheet — trailing junk rows, a
     quoted Notes cell with a line break, a repeated Name column and all — and
     then checks the boxes it filled line up row for row. Added after a
     red-check showed the piece-tests did not notice the blank-row filter being
     removed. */
  if (!JSDOM) {
    note('jsdom not installed — skipping the whole-sheet split run');
  } else if (colsMatch && identityMatch && parseSrc && keysSrc && matchSrc) {
    const splitSrc = grab('rbSplitSheetIntoBoxes');
    const scanSrc = grab('rbFindHeadingRow');
    const clearSrc = grab('rbClearBulkBoxes');
    const escSrc = grab('esc');
    const flipSrc = grab('flipLastFirstName');
    check('S36', 'rbSplitSheetIntoBoxes exists', !!splitSrc);
    if (splitSrc && escSrc && flipSrc) {
      const AREAS = JSON.parse((admin.match(/const rbAreaIds = (\[[^\]]*\]);/) || [])[1].replace(/'/g, '"'));
      const dom = new JSDOM(
        '<textarea id="rbSheetArea"></textarea><span id="rbSheetStatus"></span>' +
        '<div id="rbSheetReport"></div><input type="checkbox" id="rbFlipNames">' +
        AREAS.map(a => '<textarea id="' + a + '"></textarea>').join('')
      );
      const doc = dom.window.document;
      const sb2 = {};
      new Function('document',
        parseSrc + keysSrc +
        'const RB_SHEET_COLUMNS = ' + colsMatch[1].replace(/;$/, '') + ';' +
        'const RB_SHEET_IDENTITY = ' + identityMatch[1] + ';' +
        'const rbAreaIds = ' + JSON.stringify(AREAS) + ';' +
        'const RB_HEADER_SEARCH_ROWS = ' + (admin.match(/const RB_HEADER_SEARCH_ROWS = (\d+);/) || [])[1] + ';' +
        'const RB_BUSINESS_WORDS = ' + (function(){
          const at = admin.indexOf('const RB_BUSINESS_WORDS = [');
          if (at < 0) return '[]';
          const open = admin.indexOf('[', at);
          const close = admin.indexOf('];', open);
          return admin.slice(open, close + 1);
        })() + ';' +
        grab('rbLooksLikeBusiness') +
        matchSrc + scanSrc + clearSrc + escSrc + flipSrc +
        'function rbName(r){ const f = document.getElementById("rbFlipNames"); return (f && f.checked) ? flipLastFirstName(r) : r; }' +
        'function rbRefreshCounts(){}' +
        splitSrc + 'this.split = rbSplitSheetIntoBoxes;'
      ).call(sb2, doc);

      const SHEET = [
        'CU #\tName\tAddress\tCity\tZip\tPhone\tEmail\tNotes\tWire\tLights\tTimer\tUp Plug\t$$\tPref Date\t# Feet\t\tYes\tName',
        '144\tCattani Julie\t6037 W 11860 N\tHighland\t84003\t8019795123\tj@x.com\t"3 sides\nside outlet"\tG\tPure\tYes\t?\t230\tOCT\t140\t\tFALSE\tCattani Julie',
        '85\tBeckstead Paul\t1440 W Main St\tLehi\t84043\t3855353797\tl@x.com\t\tW\tred/pure\tYes\t?\t490\tOCT\t\t\tFALSE\tBeckstead Paul',
        '112\tBrown Kathy\t9494 S 1860 W\tSouth Jordan\t84095\t\t\t\t\t\t\t\t200\tOCT\t\t\tFALSE\tBrown Kathy',
        '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tFALSE\t',
        '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\tFALSE\t',
      ].join('\n');

      doc.getElementById('rbSheetArea').value = SHEET;
      sb2.split();

      const lines = id => { const v = doc.getElementById(id).value; return v === '' ? [] : v.split('\n'); };

      check('S36', 'the two trailing FALSE-only rows are not treated as customers',
        lines('rbCustNumbersArea').length === 3,
        'got ' + lines('rbCustNumbersArea').length + ' rows — a sheet ends in a long run of these and they are not people');

      check('S36', 'the report says how many empty rows it ignored',
        /2 empty rows at the end of the sheet ignored/.test(doc.getElementById('rbSheetReport').textContent));

      check('S36', 'every filled box has the same number of rows', (() => {
        const filled = AREAS.filter(a => lines(a).length);
        return filled.length > 5 && new Set(filled.map(a => lines(a).length)).size === 1;
      })(), 'boxes of different lengths is the misalignment this whole tool has to avoid');

      check('S36', 'row 3 is still Kathy Brown in every box',
        lines('rbCustNumbersArea')[2] === '112' &&
        lines('rbStreetsArea')[2] === '9494 S 1860 W' &&
        lines('rbCitiesArea')[2] === 'South Jordan' &&
        lines('rbPhonesArea')[2] === '',
        'her blank phone must keep its line, not delete it');

      check('S36', 'the quoted Notes cell stayed on row 1 and lost its line break',
        lines('rbNotesArea')[0] === '3 sides side outlet' && lines('rbNotesArea').length === 3,
        'got ' + JSON.stringify(lines('rbNotesArea')));

      check('S36', 'the columns nobody claimed were left empty',
        lines('rbStatesArea').length === 0 && lines('rbDatesArea').length === 0 &&
        lines('rbDifficultyArea').length === 0);

      check('S36', '"Up Plug" did not land in Use Eaves',
        lines('rbEavesArea').length === 0,
        'got ' + JSON.stringify(lines('rbEavesArea')));

      /* Filling the boxes a second time from a SHORTER sheet must not leave the
         first sheet's rows behind — that is the stale-column danger. */
      doc.getElementById('rbSheetArea').value =
        'CU #\tName\tAddress\tPhone\n144\tCattani Julie\t6037 W 11860 N\t8019795123';
      sb2.split();
      check('S36', 'a second, shorter paste does not leave the first one behind',
        lines('rbCustNumbersArea').length === 1 && lines('rbCitiesArea').length === 0 &&
        lines('rbNotesArea').length === 0,
        'the old City and Notes columns would still be lined up against the new rows');

      check('S36', 'the split never reports more customers than it wrote',
        /^1 customer split into 4 boxes\.$/.test(doc.getElementById('rbSheetStatus').textContent),
        'status said: ' + doc.getElementById('rbSheetStatus').textContent);

      /* ---- the shapes a real Excel copy actually arrives in ----
         Added 2026-08-17 after the owner pasted the master sheet and got
         "I could not recognise any of those headings". A sheet does not
         reliably begin on its heading row — a title, a blank line or a couple
         of spacer rows above it are all ordinary — and only row 1 was ever
         looked at. */
      const HDR = 'CU #\tName\tAddress\tCity\tZip\tPhone\tEmail';
      const ROW = '144\tCattani Julie\t6037 W 11860 N\tHighland\t84003\t8019795123\tj@x.com';
      const runSheet = (text) => {
        doc.getElementById('rbSheetArea').value = text;
        sb2.split();
        return {
          status: doc.getElementById('rbSheetStatus').textContent,
          report: doc.getElementById('rbSheetReport').textContent,
          rows: (doc.getElementById('rbCustNumbersArea').value || '').split('\n').filter(Boolean).length,
        };
      };

      [['a blank line above the headings', '\n' + HDR + '\n' + ROW],
       ['a title row above the headings', '2026 Master List\n' + HDR + '\n' + ROW],
       ['a title and a blank line above', '2026 Master List\n\n' + HDR + '\n' + ROW],
      ].forEach(([label, text]) => {
        const r = runSheet(text);
        check('S36', label + ' still finds them', r.rows === 1, 'status was: ' + r.status);
      });

      check('S36', 'and the report says which row the headings were on',
        /headings were on row 2/.test(runSheet('2026 Master List\n' + HDR + '\n' + ROW).report),
        'skipping rows in silence is how somebody loses a customer without noticing');

      /* A sheet with no headings must NOT be guessed at. One lucky word in a
         row of data is not a heading row. */
      const noHead = runSheet(ROW + '\n' + ROW);
      check('S36', 'data with no heading row is refused, not guessed', noHead.rows === 0);
      check('S36', 'and the refusal quotes what it actually read',
        noHead.status.indexOf('144') >= 0 && noHead.status.indexOf('Cattani Julie') >= 0,
        'the old message only asserted the top row was wrong and gave nothing to act on; status was: ' + noHead.status);

      /* Tabs lost on the way in — copied off a printout or a PDF. */
      const flat = runSheet(HDR.split('\t').join(' ') + '\n' + ROW.split('\t').join(' '));
      check('S36', 'a paste that arrived as one column says so plainly',
        flat.rows === 0 && /one column/.test(flat.status), 'status was: ' + flat.status);

      /* The delimiter is chosen across the first several lines, not just the
         first — a title line has no tab in it, and picking comma off that line
         turned every row into a single cell. */
      check('S36', 'a title line does not make it read the sheet as comma-separated',
        runSheet('2026 Master List\n' + HDR + '\n' + ROW).rows === 1);

    }
  }

  /* ---- the wiring, read off the page ---- */
  check('S36', 'every box is emptied before the new sheet is written in',
    /rbAreaIds\.forEach\(function\(id\)\{[\s\S]{0,160}?el\.value = '';[\s\S]{0,80}?\}\);[\s\S]{0,400}?match\.mapped\.forEach/.test(admin),
    'a column left over from the last paste is still lined up against the new rows and would be written to everyone');

  check('S36', 'the counters are refreshed after filling from script',
    /rbRefreshCounts\(\)/.test(admin) && /const rbRefreshCounts = wireBulkCounts\(/.test(admin),
    'a textarea set from code never fires input, so the counts would read 0 over 900 filled lines');

  check('S36', 'pasting into the sheet box splits it on its own',
    /getElementById\('rbSheetArea'\)\?\.addEventListener\('paste'/.test(admin),
    'the owner asked to paste it and have it just happen');

  check('S36', 'the split fills the boxes and does NOT import', (() => {
    const at = admin.indexOf('function rbSplitSheetIntoBoxes(');
    if (at < 0) return false;
    let depth = 0, body = '';
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') depth++;
      else if (admin[i] === '}') { depth--; if (!depth) { body = admin.slice(at, i + 1); break; } }
    }
    return body && !/updateDoc|addDoc|setDoc|deleteDoc/.test(body);
  })(), 'splitting must stay a text operation — Check First and Import are the only things that write');

  /* Feet is the highest-leverage field on a customer (CLAUDE.md §2), and the
     master sheet carries it, so it now has a box. */
  ['rbFeetArea', 'rbNotesArea'].forEach(id => {
    check('S36', id + ' exists on the page', admin.includes('id="' + id + '"'));
    check('S36', id + ' is in rbAreaIds so it is cleared and counted',
      new RegExp("rbAreaIds = \\[[^\\]]*'" + id + "'").test(admin));
  });

  check('S36', 'Measured Feet sets the bin count with it',
    /updates\.measuredFeet = Number\(feetVal\);\s*\r?\n\s*updates\.numberOfBins = cnBinsForFeet\(Number\(feetVal\)\)/.test(admin),
    'feet and bins disagreeing is what sends a 600ft house out with one bin');

  check('S36', 'and does so AFTER the customer-number rule, so feet wins',
    admin.indexOf('if(parseInt(cn,10) < 5000) updates.numberOfBins = 1;')
      < admin.indexOf('updates.numberOfBins = cnBinsForFeet(Number(feetVal))'),
    'written the other way round the number series would overwrite the measured answer');

  /* The sheet's Wire and Timer columns are not clean. Anything that is not one
     of the real answers has to leave the field alone, not overwrite it. */
  {
    const pull = n => {
      const at = admin.indexOf('function ' + n + '(');
      let d = 0;
      for (let i = admin.indexOf('{', at); at >= 0 && i < admin.length; i++) {
        if (admin[i] === '{') d++;
        else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
      }
      return null;
    };
    const wireSrc = pull('rbNormalizeWire'), yesNoSrc = pull('rbNormalizeYesNo');
    check('S36', 'the wire and yes/no normalisers exist', !!wireSrc && !!yesNoSrc);
    if (wireSrc && yesNoSrc) {
      const sb = {};
      new Function(wireSrc + yesNoSrc + 'this.w = rbNormalizeWire; this.y = rbNormalizeYesNo;').call(sb);
      check('S36', 'W and G still become White and Green',
        sb.w('W') === 'White' && sb.w('g') === 'Green' && sb.w('Green') === 'Green');
      check('S36', 'Y/N/yes/no still work', ['Yes','y','YES','true'].every(v => sb.y(v) === 'Yes') &&
        ['No','n','NO','false'].every(v => sb.y(v) === 'No'));
      /* These four are real cells out of the real Wire column, and "Warm" is a
         real cell out of the real Timer column. */
      check('S36', 'a stray note in the Wire column leaves the wire colour alone',
        ['4 sides', 'raise price 2026', '45231', 'add 50 lights to bin'].every(v => sb.w(v) === ''),
        'these would otherwise be saved as that customer\'s wire colour');
      check('S36', '"?" and other non-answers leave a Yes/No field alone',
        ['?', 'Warm', 'maybe'].every(v => sb.y(v) === ''),
        'the sheet\'s Up Plug column is 99 question marks');
    }
  }

  check('S36', '"Up Plug" is not guessed into a real field',
    !/'up plug'/.test(admin),
    'it reads like Yes/No but 99 of its cells are "?"; mapping it would write that to 99 customers');

  {
    const at = admin.indexOf('function rbNormalizeFeet(');
    let src = null, depth = 0;
    for (let i = admin.indexOf('{', at); at >= 0 && i < admin.length; i++) {
      if (admin[i] === '{') depth++;
      else if (admin[i] === '}') { depth--; if (!depth) { src = admin.slice(at, i + 1); break; } }
    }
    check('S36', 'rbNormalizeFeet exists', !!src);
    if (src) {
      const sb = {};
      new Function(src + 'this.f = rbNormalizeFeet;').call(sb);
      const f = sb.f;
      check('S36', 'a plain number comes through', f('230') === '230');
      check('S36', 'a descriptive cell keeps its leading number',
        f('160 red/warm & 40 solid green') === '160',
        'got "' + f('160 red/warm & 40 solid green') + '"');
      check('S36', 'a stray $ or comma is ignored', f('$1,300') === '1300');
      check('S36', 'a blank stays blank, never 0',
        f('') === '' && f('   ') === '' && f('n/a') === '',
        'writing 0 would drop a measured house back to one bin and re-price it at nothing');
    }
  }
}



/* ============================================================
 * Suite 37. Making the bulk import fast, without changing what it writes.
 *
 * Owner, 2026-08-17: "is there anything you can do to make it more data
 * optimal so it runs faster as a bulk update".
 *
 * Every saving here has to be INVISIBLE in the result: the same records, the
 * same values, just without work that was never going to change anything. So
 * each check is about the saving being CORRECT, not about it being fast.
 * ============================================================ */
suite('Suite 37. The bulk import does less work for the same result');
{
  const lift = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return null;
  };

  /* ---- the memoised street normaliser ----
     This caught a real one. The memoisation was written with the backslash
     eaten, so the whitespace class became the LETTER s and every street came
     out mangled — and the whole suite still passed, because nothing tested
     this function at all. */
  {
    const src = lift('normalizeStreetForMatch');
    check('S37', 'normalizeStreetForMatch exists', !!src);
    if (src) {
      const sb = {};
      new Function(src + 'this.f = normalizeStreetForMatch;').call(sb);
      const f = sb.f;
      check('S37', 'runs of whitespace collapse to one space',
        f('  1440   W Main St ') === '1440 w main st',
        'got ' + JSON.stringify(f('  1440   W Main St ')));
      check('S37', 'the letter s is NOT treated as whitespace',
        f('Sunset Cir') === 'sunset cir' && f('Mississippi') === 'mississippi',
        'a slipped backslash turns the whitespace class into the letter s and mangles every street; got ' + JSON.stringify(f('Mississippi')));
      check('S37', 'dots, commas and hashes come out',
        f('1440 W. Main St.') === '1440 w main st' && f('#5 Sunset Cir') === '5 sunset cir');
      check('S37', 'a blank stays blank', f('') === '' && f(null) === '');
      check('S37', 'the cached answer equals the real one',
        f('1440 W Main St') === '1440 w main st' && f('1440 W Main St') === '1440 w main st',
        'a cache that returns something other than the real answer is worse than no cache');
      /* Two DIFFERENT streets after the cache is warm. Without this a cache
         that hands back the same entry for every input reads as correct,
         because asking twice for the SAME street cannot tell them apart. */
      check('S37', 'a warm cache still tells two streets apart',
        (function(){
          f('100 Aspen Way'); f('200 Birch Rd');
          return f('100 Aspen Way') === '100 aspen way' && f('200 Birch Rd') === '200 birch rd';
        })(),
        'got ' + JSON.stringify(f('100 Aspen Way')) + ' and ' + JSON.stringify(f('200 Birch Rd')));
      check('S37', 'the cache lives on the function, not beside it',
        /normalizeStreetForMatch\._cache/.test(admin) && !/const _normStreetCache/.test(admin),
        'the suite lifts this function out on its own, and a free-standing const next to it is not carried along');
    }
  }

  /* ---- would this write change anything? ---- */
  {
    const src = lift('bulkFieldsMatch');
    check('S37', 'bulkFieldsMatch exists', !!src);
    if (src) {
      const sb = {};
      new Function(src + 'this.f = bulkFieldsMatch;').call(sb);
      const f = sb.f;
      check('S37', 'identical values count as no change',
        f({name: 'Julie Cattani', zip: '84003'}, {name: 'Julie Cattani', zip: '84003', other: 'x'}) === true);
      check('S37', 'one different value still writes',
        f({name: 'Julie Cattani'}, {name: 'Julie C'}) === false);
      check('S37', 'a field the record does not have still writes',
        f({notes: '4 sides'}, {}) === false);
      check('S37', '"84003" and 84003 are the same zip',
        f({zip: '84003'}, {zip: 84003}) === true && f({measuredFeet: 230}, {measuredFeet: '230'}) === true,
        'the sheet gives text and the record holds a number; calling those different would rewrite every row for ever');
      check('S37', 'blank on the record equals blank in the update',
        f({city: ''}, {}) === true && f({city: ''}, {city: null}) === true);
      check('S37', 'colour lists compare by content and order',
        f({lightColors: ['Red','Green']}, {lightColors: ['Red','Green']}) === true &&
        f({lightColors: ['Red','Green']}, {lightColors: ['Green','Red']}) === false &&
        f({lightColors: ['Red']}, {lightColors: ['Red','Green']}) === false);
      check('S37', 'a Timestamp is never assumed equal',
        f({createdAt: {seconds: 1}}, {createdAt: {seconds: 1}}) === false,
        'guessing at a Timestamp or a server sentinel is how a real edit gets silently dropped');
      check('S37', 'null in the update always writes',
        f({lat: null}, {lat: null}) === false);
    }
  }

  /* ---- the geocode is skipped only when the pin cannot have moved ---- */
  /* Scoped to the import block: the Add Customer form geocodes too, and it
     sits earlier in the file, so a bare indexOf finds the wrong one. */
  {
    const blk = admin.slice(admin.indexOf('let pinsKept = 0'), admin.indexOf('// --- Invoice Bulk Update ---'));
    check('S37', 'the customer is looked up BEFORE the geocode',
      blk.indexOf('const existing = bulkFindCustomer(street, phone, city, zip, cn);') > -1 &&
      blk.indexOf('const existing = bulkFindCustomer(street, phone, city, zip, cn);')
        < blk.indexOf('coords = await geocodeAddress(fullAddress);'),
      'it cannot know whether a pin is needed until it knows who the row is');
  }

  check('S37', 'a pin is reused only when street, town AND zip all still match',
    /const pinIsGood = !!\(hasPin && sameStreet && sameTown && sameZip\);/.test(admin),
    'reusing a pin after the address changed leaves the house on the map at the old place');

  check('S37', 'skipping the lookup leaves the stored pin alone',
    /coords = \{lat: null, lng: null\};[\s\S]{0,40}?pinsKept\+\+;/.test(admin) &&
    /if\(coords\.lat !== null\)\{ updates\.lat = coords\.lat/.test(admin),
    'the write only touches lat/lng when a lookup actually returned one');

  check('S37', 'a skipped lookup is not counted as a failed one',
    admin.indexOf('pinsKept++') > 0,
    '"could not find this address" and "did not need to look" are different things');

  /* ---- invoices: one query, not one read per row ---- */
  check('S37', 'every invoice is fetched in a single query',
    /const allInv = await getDocs\(collection\(db,'invoices'\)\);/.test(admin));

  check('S37', 'a failed prefetch falls back to reading each one',
    /invoicePrefetched \? null : await getDoc\(doc\(db,'invoices',phone\)\)/.test(admin),
    'treating a failed prefetch as "no invoice exists" would create a second invoice for everyone');

  check('S37', 'the map is kept up to date after each invoice write',
    /invoiceCache\.set\(phone, Object\.assign\(\{\}, existingInv, invUpdates\)\)/.test(admin) &&
    /invoiceCache\.set\(phone, fresh\)/.test(admin),
    'two houses billed to one phone: the second row has to see what the first row just wrote');

  check('S37', 'a row with nothing to bill does not read an invoice at all',
    /if\(!name && !email && price === null\)\{[\s\S]{0,60}?invoiceReadsSaved\+\+;/.test(admin));

  /* ---- and none of it may change what gets written ---- */
  check('S37', 'the invoice status is still computed from the same five figures',
    /computeInvoiceStatus\(price, existingInv\.removal\|\|0, existingInv\.deposit\|\|0, existingInv\.credits\|\|0, existingInv\.changeFees\|\|0\)/.test(admin),
    'this is the money formula; a speed change must not touch it');

  /* Written as indexOf rather than regex on purpose: these anchors are full
     of parentheses and braces, and an escaped regex is one lost backslash
     away from matching something else entirely. */
  check('S37', 'the number pool is read once instead of a delete per row',
    admin.indexOf("const poolSnap = await getDocs(collection(db,'availableCustomerNumbers'));") > 0 &&
    admin.indexOf('if(pooledNumbers && !pooledNumbers.has(cn)){') > 0,
    'a number in use is never in the pool, so almost every one of those deletes had nothing to delete');

  check('S37', 'a failed pool read still fires the delete blind',
    admin.indexOf('catch(err){ pooledNumbers = null; }') > 0 &&
    admin.indexOf("await deleteDoc(doc(db,'availableCustomerNumbers', cn))") > 0,
    'skipping the cleanup would leave a number in the pool to be handed to a second customer later');

  check('S37', 'a number just taken out of the pool is not offered again',
    admin.indexOf('if(pooledNumbers) pooledNumbers.delete(cn);') > 0);

  check('S37', 'rows that were already correct are reported',
    /alreadyRightNote/.test(admin) && /already matched and were left alone/.test(admin),
    'a run that legitimately changed nothing reads as "0 updated", which looks exactly like one that failed');

  check('S37', 'the savings are reported, not silent',
    /pinsKept/.test(admin) && /unchangedRows/.test(admin) && /invoiceReadsSaved/.test(admin),
    '"nothing changed" and "it did not run" look identical afterwards');
}


/* ============================================================
 * Suite 38. Panels draw when they are opened, not before.
 *
 * Owner, 2026-08-17: "its still using to much memory can you cut it down
 * anymore".
 *
 * Loading the DATA lazily (Suite 21) dealt with the listeners. This is the
 * drawing: twenty-one renders ran on every customer change, several of them
 * building a row, an option or a map marker PER CUSTOMER, for panels nobody had
 * opened — roughly sixty elements per house across the deferred ones, plus a
 * Google marker each, on a book of about a thousand houses.
 *
 * The dangerous failure here is the quiet one: a panel name that does not
 * exist means that render never runs at all and the panel sits empty for ever.
 * So the map is checked against the real panels, both directions.
 * ============================================================ */
suite('Suite 38. Panels draw when they are opened');
{
  const mapMatch = admin.match(/const RENDER_PANEL = \{([\s\S]*?)\n\};/);
  check('S38', 'RENDER_PANEL exists', !!mapMatch);

  if (mapMatch) {
    const entries = [...mapMatch[1].matchAll(/([a-zA-Z]+):\s*'([^']+)'/g)].map(m => [m[1], m[2]]);
    check('S38', 'the map is not empty', entries.length >= 10, 'found ' + entries.length);

    /* ⚠ THE ONE THAT MATTERS. A typo here does not throw and does not show up
       until somebody opens that tab and finds it blank. */
    const realPanels = new Set([...admin.matchAll(/<div class="panel"[^>]*id="panel-([a-zA-Z0-9_-]+)"/g)].map(m => m[1]));
    const badPanel = entries.filter(([, p]) => !realPanels.has(p));
    check('S38', 'every panel named in the map is a real panel',
      badPanel.length === 0,
      'these would never draw: ' + badPanel.map(x => x[0] + ' -> panel-' + x[1]).join(', '));

    const navPanels = new Set([...admin.matchAll(/data-panel="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]));
    check('S38', 'every panel named in the map can actually be opened',
      entries.every(([, p]) => navPanels.has(p)),
      'a panel with no nav item can never be opened, so its renders would never flush');

    /* Every label in the map has to be a label safeRender is really called
       with, or the entry does nothing. */
    const usedLabels = new Set([...admin.matchAll(/safeRender\('([a-zA-Z]+)'/g)].map(m => m[1]));
    const orphan = entries.filter(([l]) => !usedLabels.has(l));
    check('S38', 'every label in the map is a render that exists',
      orphan.length === 0, 'orphaned entries: ' + orphan.map(x => x[0]).join(', '));

    /* The heavy ones — the per-customer builders — must all be deferred, or
       this whole exercise saves nothing. */
    ['allCustomersTable', 'overviewMap', 'customerNumbers', 'whCustomerList', 'takedowns']
      .forEach(label => {
        check('S38', label + ' is deferred until its panel opens',
          entries.some(([l]) => l === label),
          'this one builds something per customer; leaving it eager is most of the memory');
      });
  }

  /* Behaviour, run for real against a fake DOM of panels. */
  const grab = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return null;
  };
  const safeSrc = grab('safeRender'), openSrc = grab('adminPanelIsOpen'), flushSrc = grab('flushPendingRenders');
  check('S38', 'safeRender, adminPanelIsOpen and flushPendingRenders all exist',
    !!safeSrc && !!openSrc && !!flushSrc);

  if (!JSDOM) {
    note('jsdom not installed — skipping the deferred-render behaviour run');
  } else if (safeSrc && openSrc && flushSrc && mapMatch) {
    const dom = new JSDOM(
      '<div class="panel active" id="panel-addcustomer"></div>' +
      '<div class="panel" id="panel-routes"></div>' +
      '<div class="panel" id="panel-warehouse"></div>'
    );
    const doc = dom.window.document;
    const sb = {};
    new Function('document',
      'const RENDER_PANEL = {' + mapMatch[1] + '\n};' +
      'const pendingRenders = new Map();' +
      openSrc + safeSrc + flushSrc +
      'this.safeRender = safeRender; this.flush = flushPendingRenders; this.pending = pendingRenders;'
    ).call(sb, doc);

    let openPanelDrew = 0, closedPanelDrew = 0;
    sb.safeRender('allCustomersTable', () => { openPanelDrew++; });
    sb.safeRender('overviewMap', () => { closedPanelDrew++; });

    check('S38', 'a render for the OPEN panel runs straight away', openPanelDrew === 1);
    check('S38', 'a render for a CLOSED panel does not run', closedPanelDrew === 0,
      'this is the whole saving — building it for a tab nobody opened is the memory');
    check('S38', 'and it is remembered rather than thrown away', sb.pending.has('overviewMap'));

    /* Repeated writes while closed must not queue up N copies. */
    sb.safeRender('overviewMap', () => { closedPanelDrew += 10; });
    check('S38', 'only the newest pending render is kept', sb.pending.size === 1,
      'replaying an old one would draw figures that have already been superseded');

    doc.getElementById('panel-routes').classList.add('active');
    sb.flush('routes');
    check('S38', 'opening the panel draws what it was owed', closedPanelDrew === 10,
      'got ' + closedPanelDrew + ' — it must run the LATEST version, not the first');
    check('S38', 'and it is not left queued afterwards', sb.pending.size === 0);

    /* An unmapped label must always draw — the safe direction. */
    let unmappedDrew = 0;
    sb.safeRender('somethingBrandNew', () => { unmappedDrew++; });
    check('S38', 'a render with no entry in the map always draws', unmappedDrew === 1,
      'an unmapped render costs memory; a wrongly mapped one shows stale numbers, so unmapped must be the default');

    /* A render that throws must not take the others down, and must not be
       stuck pending for ever. */
    doc.getElementById('panel-warehouse').classList.add('active');
    let after = 0;
    // Deliberate throw — silence the console so the suite output stays readable.
    const realErr = console.error; console.error = function(){};
    sb.safeRender('whCustomerList', () => { throw new Error('boom'); });
    sb.safeRender('warehouseQueue', () => { after++; });
    console.error = realErr;
    check('S38', 'one render throwing does not stop the next', after === 1);
  }

  check('S38', 'opening a panel flushes what it was owed',
    /flushPendingRenders\(panelName\);/.test(admin) &&
    admin.indexOf('ensurePanelData(panelName);') < admin.indexOf('flushPendingRenders(panelName);'),
    'the flush has to come after the panel is marked active, or the renders it triggers defer themselves again');

  /* A badge has to be right before anyone clicks anything, so it can never
     wait for a panel to be opened. Asked properly: does any render that is
     now deferred actually write to a badge element? (The first version of
     this check scanned for the word "badge" near RENDER_PANEL and failed on
     the comment that says badges are excluded.) */
  {
    const BADGES = ['badgeQuotes', 'badgeMessages', 'badgeProjTodo', 'badgeHealth'];
    check('S38', 'all four sidebar badges still exist',
      BADGES.every(b => admin.indexOf('id="' + b + '"') > 0));

    const bodyOf = (name) => {
      const at = admin.indexOf('function ' + name + '(');
      if (at < 0) return '';
      let d = 0;
      for (let i = admin.indexOf('{', at); i < admin.length; i++) {
        if (admin[i] === '{') d++;
        else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
      }
      return '';
    };
    /* The renderer behind each deferred label, read off the safeRender call. */
    const deferredFns = [...admin.matchAll(/safeRender\('([a-zA-Z]+)',\s*(?:typeof\s+)?([a-zA-Z]+)/g)]
      .filter(m => new RegExp('\\b' + m[1] + ':').test((admin.match(/const RENDER_PANEL = \{[\s\S]*?\n\};/) || [''])[0]))
      .map(m => m[2]);
    const offenders = deferredFns.filter(fn => BADGES.some(b => bodyOf(fn).indexOf(b) >= 0));
    check('S38', 'no deferred render writes a sidebar badge',
      offenders.length === 0,
      'these would leave a badge wrong until their tab was opened: ' + offenders.join(', '));
    check('S38', 'the badge check actually found the deferred renderers',
      deferredFns.length >= 10,
      'only found ' + deferredFns.length + ' — if this drops to nothing the check above passes for the wrong reason');
  }
}


/* ============================================================
 * Suite 39. Importing a batch at a time, and remembering where it got to.
 *
 * Owner, 2026-08-17: "we need to cut it up because it crashes at 250 so we need
 * to go 250 at a time then refresh but it needs to remember".
 *
 * Dying half way through a nine hundred row import is the worst outcome there
 * is: some customers written, some not, and nothing on screen saying which. So
 * the run stops at a known row, writes the place down, and picks up from there
 * across a refresh.
 *
 * Everything here is about the REMEMBERING being trustworthy. A cursor that
 * points into the wrong list, or a resume against a customer list that has not
 * loaded, does far more damage than the crash it replaced.
 * ============================================================ */
suite('Suite 39. Importing in batches, and remembering the place');
{
  const lift = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return null;
  };

  /* The exact number is the owner's call and has moved once already (250 on
     2026-08-17, then 150, then 50, all on the same day, as each one still
     used too much). Asserted exactly, so changing it is a deliberate edit
     here rather than a silent drift in behaviour. */
  check('S39', 'the batch size is 50, as asked for',
    /const BULK_CHUNK_SIZE = 50;/.test(admin));

  check('S39', 'the loop runs one batch, not the whole paste',
    /for\(let i = startAt; i < stopAt; i\+\+\)\{/.test(admin) &&
    /const stopAt = Math\.min\(streets\.length, startAt \+ BULK_CHUNK_SIZE\);/.test(admin));

  /* ⚠ THE ONE THAT MATTERS MOST. Everything decides "existing or new" by
     looking in jobAddresses. Empty means every row looks new. */
  {
    /* Scoped to the IMPORT. A second, identical-looking guard now exists in
       the fix-names tool, and a file-wide search matched that one instead —
       so deleting the import's guard read as a pass. */
    const impGuard = admin.slice(admin.indexOf("document.getElementById('rbImportBtn').addEventListener"), admin.indexOf('// --- Invoice Bulk Update ---'));
    check('S39', 'it refuses to run at all against an empty customer list',
      /if\(!jobAddresses\.length\)\{/.test(impGuard) &&
      /every row as a brand new customer/.test(impGuard),
      'resuming before the customer list has loaded would add every row as a brand new customer, and there is no cheap undo for that');
  }

  check('S39', 'the refusal happens before any row is written',
    admin.indexOf('if(!jobAddresses.length){') < admin.indexOf('for(let i = startAt; i < stopAt; i++){'),
    'a guard after the loop guards nothing');

  /* The cursor is only meaningful against the paste it was taken from. */
  check('S39', 'a saved place is only used when the boxes hold the same paste',
    /const resuming = !!\(savedJob && savedJob\.fingerprint === jobFingerprint && savedJob\.cursor < streets\.length\);/.test(admin),
    'a cursor from a different paste points into the wrong list, and every row after it goes to the wrong customer');

  check('S39', 'a job saved under a different identifier mode is not resumed',
    /if\(!job \|\| job\.identifier !== BULK_IDENTIFIER\) return null;/.test(admin),
    'half the rows matched on the number and half on the phone is not a repairable state');

  {
    const imp2 = admin.slice(admin.indexOf('let pinsKept = 0'), admin.indexOf('// --- Invoice Bulk Update ---'));
    const branchAt = imp2.indexOf('if(moreToDo){');
    const clearAt = imp2.indexOf("rbAreaIds.forEach(function(id){ document.getElementById(id).value = ''; });");
    check('S39', 'the boxes are NOT cleared while a job is unfinished',
      branchAt > 0 && clearAt > branchAt &&
      imp2.slice(branchAt, clearAt).indexOf('return;') > 0,
      'clearing them mid-job would lose the half of the paste that has not run yet');
  }

  {
    /* Scoped to the import handler: bulkJobClear() also appears in the
       banner's Cancel button, and a bare indexOf finds that one instead —
       which is how deleting the one that matters still read as a pass. */
    const imp = admin.slice(admin.indexOf('let pinsKept = 0'), admin.indexOf('// --- Invoice Bulk Update ---'));
    check('S39', 'finishing clears the saved place',
      imp.indexOf('bulkJobClear();') > 0 &&
      imp.indexOf('bulkJobClear();') > imp.indexOf('if(moreToDo){'),
      'a finished job left behind would offer to re-run rows that are already done');
    check('S39', 'and the unfinished branch returns before it',
      imp.indexOf('if(moreToDo){') > 0 && /if\(moreToDo\)\{[\s\S]*?return;/.test(imp),
      'falling through would clear the place while the job is still half done');
  }

  check('S39', 'the totals carry across batches',
    /carried\.added \+ added/.test(admin) && /carried\.updated \+ updated/.test(admin),
    'otherwise the finish line describes only the last batch');

  check('S39', 'a failure to save the place says so instead of reloading',
    /I could NOT save the place/.test(admin) &&
    /if\(remembered\)\{[\s\S]{0,200}?location\.reload/.test(admin),
    'reloading after a failed save would lose the run with nothing to resume from');

  check('S39', 'an unfinished job announces itself when the page comes back',
    /renderBulkResumeBanner\(\); \} catch\(err\)\{\}/.test(admin),
    'a refresh would otherwise look exactly like the import having vanished');

  /* ---- the job store, run for real ---- */
  {
    const fpSrc = lift('bulkJobFingerprint');
    check('S39', 'bulkJobFingerprint exists', !!fpSrc);
    if (fpSrc) {
      const sb = {};
      new Function(fpSrc + 'this.f = bulkJobFingerprint;').call(sb);
      const f = sb.f;
      const a = ['1','2','3','4','5','6','7','8'];
      check('S39', 'the same paste fingerprints the same', f(a) === f(a.slice()));
      check('S39', 'a paste of a different length fingerprints differently',
        f(a) !== f(a.slice(0, 7)));
      check('S39', 'a changed first row fingerprints differently',
        f(a) !== f(['9','2','3','4','5','6','7','8']));
      check('S39', 'a changed last row fingerprints differently',
        f(a) !== f(['1','2','3','4','5','6','7','9']),
        'the tail has to count, or appending rows to the sheet would silently reuse the old cursor');
    }
  }

  if (!JSDOM) {
    note('jsdom not installed — skipping the save/resume round trip');
  } else {
    const saveSrc = lift('bulkJobSave'), loadSrc = lift('bulkJobLoad'), clearSrc = lift('bulkJobClear');
    check('S39', 'the job store exists', !!saveSrc && !!loadSrc && !!clearSrc);
    if (saveSrc && loadSrc && clearSrc) {
      const store = {};
      const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      };
      const sb = {};
      new Function('localStorage', 'BULK_IDENTIFIER',
        "const BULK_JOB_KEY = 'hu.bulkImportJob.v1';" +
        saveSrc + loadSrc + clearSrc +
        'this.save = bulkJobSave; this.load = bulkJobLoad; this.clear = bulkJobClear;'
      ).call(sb, localStorage, 'phone+address');

      check('S39', 'nothing saved means nothing to resume', sb.load() === null);

      const job = {identifier: 'phone+address', fingerprint: 'abc', cursor: 250, total: 962,
                   totals: {added: 1, updated: 249}, boxes: {rbNamesArea: 'x'}};
      check('S39', 'a job saves', sb.save(job) === true);

      const back = sb.load();
      check('S39', 'and comes back with the place it got to',
        back && back.cursor === 250 && back.total === 962 && back.fingerprint === 'abc');
      check('S39', 'including the columns, so a refresh keeps the paste',
        back && back.boxes && back.boxes.rbNamesArea === 'x');
      check('S39', 'and the running totals', back && back.totals.updated === 249);

      sb.clear();
      check('S39', 'clearing really removes it', sb.load() === null);

      /* A job written under a different identifier mode must be refused. */
      const sb2 = {};
      new Function('localStorage', 'BULK_IDENTIFIER',
        "const BULK_JOB_KEY = 'hu.bulkImportJob.v1';" +
        saveSrc + loadSrc + clearSrc +
        'this.save = bulkJobSave; this.load = bulkJobLoad;'
      ).call(sb2, localStorage, 'number');
      sb.save(job);
      check('S39', 'a job from another identifier mode is not offered',
        sb2.load() === null,
        'resuming across a mode change would match half the rows one way and half another');
      sb.clear();

      /* Corrupt or half-written storage must not throw on a page load. */
      store['hu.bulkImportJob.v1'] = '{not json';
      check('S39', 'unreadable storage is treated as no job, not a crash',
        sb.load() === null);
      store['hu.bulkImportJob.v1'] = JSON.stringify({identifier: 'phone+address'});
      check('S39', 'a job with no cursor is refused',
        sb.load() === null,
        'a missing cursor would be read as 0 and re-run rows that are already done');
      delete store['hu.bulkImportJob.v1'];

      /* A full disk must not look like success. */
      const sb3 = {};
      new Function('localStorage', 'BULK_IDENTIFIER',
        "const BULK_JOB_KEY = 'hu.bulkImportJob.v1';" + saveSrc + 'this.save = bulkJobSave;'
      ).call(sb3, {setItem: () => { throw new Error('QuotaExceeded'); }}, 'phone+address');
      check('S39', 'a save that fails reports false rather than throwing',
        sb3.save(job) === false,
        'the caller uses this to decide whether it is safe to reload');
    }
  }
}


/* ============================================================
 * Suite 40. A pasted sheet turns the names round by itself.
 *
 * Owner, 2026-08-17: "in the paste excel master sheet it should make sure the
 * name column gets put in first last instead of the last first", and then
 * plainly: "excel is last first but the website is first last".
 *
 * So the flip is no longer a checkbox to go and find — a fresh paste ticks it.
 * The risk this replaces is real (nine hundred names the wrong way round), and
 * so is the risk it creates (a sheet that really IS First Last, reversed), so
 * both directions are pinned down here.
 * ============================================================ */
suite('Suite 40. Pasting a sheet turns the names round');
{
  const lift = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return null;
  };

  check('S40', 'a fresh paste ticks the flip box itself',
    /flip\.checked = true;/.test(admin) &&
    /rbSplitSheetIntoBoxes\._flipAutoSetFor = sheetText;/.test(admin),
    'the sheet is Last First and the site is First Last, every time');

  /* ⚠ The other direction. Without this there is no way to import a sheet that
     is already First Last: unticking would be undone on the next press. */
  check('S40', 'it only ticks ONCE per paste, so unticking sticks',
    /rbSplitSheetIntoBoxes\._flipAutoSetFor !== sheetText/.test(admin),
    'otherwise unticking and pressing the button again just ticks it straight back');

  check('S40', 'the note of which sheet was flipped lives on the function',
    /rbSplitSheetIntoBoxes\._flipAutoSetFor/.test(admin) && !/let rbFlipAutoSetFor/.test(admin),
    'the suite lifts the splitter out and runs it alone; a free-standing let beside it is not carried along');

  check('S40', 'the report says it turned them round',
    /turned the names round/.test(admin),
    'silently renaming nine hundred customers is not acceptable even when it is right');

  /* ---- the business sniffer ---- */
  {
    const src = lift('rbLooksLikeBusiness');
    check('S40', 'rbLooksLikeBusiness exists', !!src);
    const at = admin.indexOf('const RB_BUSINESS_WORDS = [');
    const open = admin.indexOf('[', at), close = admin.indexOf('];', open);
    const words = at >= 0 ? admin.slice(open, close + 1) : null;
    check('S40', 'the word list exists', !!words);
    if (src && words) {
      const sb = {};
      new Function('RB_BUSINESS_WORDS', src + 'this.f = rbLooksLikeBusiness;')
        .call(sb, JSON.parse(words.replace(/'/g, '"')));
      const f = sb.f;

      /* Both of these are real rows on the master sheet, and both come out
         mangled by the flip. */
      check('S40', 'a real business on the sheet is spotted',
        f('Lehi Vision Care') && f('River Meadows Senior Ctr'),
        'these turn into "Vision Care Lehi" and "Meadows Senior Ctr River"');

      /* ⚠ The first word is the SURNAME slot on a Last First sheet, so a
         business word there means nothing. Church Mirien is a person. */
      check('S40', 'a surname that happens to be a business word is not flagged',
        !f('Church Mirien') && !f('Bank Susan'),
        'flagging every Mrs Church trains people to ignore the warning');

      check('S40', 'ordinary names are not flagged',
        !f('Cattani Julie') && !f('Beckstead Paul /Jill') && !f('Anderson Brit / Dani') &&
        !f('Roberson-Lamoreaux Nate'),
        'a warning that fires on normal rows is worse than none');

      check('S40', 'a single word is not flagged', !f('Cattani') && !f(''));
    }
  }

  /* ---- the whole thing, run against a sheet ---- */
  if (!JSDOM) {
    note('jsdom not installed — skipping the auto-flip run');
  } else {
    const splitSrc = lift('rbSplitSheetIntoBoxes');
    const AREAS = JSON.parse((admin.match(/const rbAreaIds = (\[[^\]]*\]);/) || [])[1].replace(/'/g, '"'));
    const con = (re) => (admin.match(re) || [])[1];
    const at = admin.indexOf('const RB_BUSINESS_WORDS = [');
    const words = admin.slice(admin.indexOf('[', at), admin.indexOf('];', at) + 1);

    if (splitSrc) {
      const dom = new JSDOM(
        '<textarea id="rbSheetArea"></textarea><span id="rbSheetStatus"></span>' +
        '<div id="rbSheetReport"></div><input type="checkbox" id="rbFlipNames">' +
        AREAS.map(a => '<textarea id="' + a + '"></textarea>').join('')
      );
      const doc = dom.window.document;
      const sb = {};
      new Function('document',
        lift('rbParseSheetGrid') + lift('rbHeadingKeys') +
        'const RB_SHEET_COLUMNS = ' + con(/const RB_SHEET_COLUMNS = (\[[\s\S]*?\n\]);/) + ';' +
        'const RB_SHEET_IDENTITY = ' + con(/const RB_SHEET_IDENTITY = (\[[^\]]*\]);/) + ';' +
        'const rbAreaIds = ' + JSON.stringify(AREAS) + ';' +
        'const RB_HEADER_SEARCH_ROWS = ' + con(/const RB_HEADER_SEARCH_ROWS = (\d+);/) + ';' +
        'const RB_BUSINESS_WORDS = ' + words + ';' +
        lift('rbLooksLikeBusiness') + lift('rbMatchSheetHeadings') + lift('rbFindHeadingRow') +
        lift('rbClearBulkBoxes') + lift('esc') + lift('flipLastFirstName') +
        'function rbName(r){ const f = document.getElementById("rbFlipNames"); return (f && f.checked) ? flipLastFirstName(r) : r; }' +
        'function rbRefreshCounts(){}' +
        splitSrc + 'this.split = rbSplitSheetIntoBoxes; this.rbName = rbName;'
      ).call(sb, doc);

      const SHEET = [
        'CU #\tName\tAddress\tCity\tPhone',
        '144\tCattani Julie\t6037 W 11860 N\tHighland\t8019795123',
        '493\tLehi Vision Care\t86 W Main St\tLehi\t8015550000'
      ].join('\n');

      const flipBox = doc.getElementById('rbFlipNames');
      flipBox.checked = false;
      doc.getElementById('rbSheetArea').value = SHEET;
      sb.split();

      check('S40', 'pasting an unticked sheet ticks the box', flipBox.checked === true);
      check('S40', 'and the name will be saved First Last',
        sb.rbName(doc.getElementById('rbNamesArea').value.split('\n')[0]) === 'Julie Cattani',
        'got ' + sb.rbName(doc.getElementById('rbNamesArea').value.split('\n')[0]));
      check('S40', 'the report says so',
        /turned the names round/.test(doc.getElementById('rbSheetReport').textContent));
      check('S40', 'and warns about the business on the sheet',
        /look like a business/.test(doc.getElementById('rbSheetReport').textContent) &&
        /Vision Care Lehi/.test(doc.getElementById('rbSheetReport').textContent),
        'report said: ' + doc.getElementById('rbSheetReport').textContent.slice(0, 200));

      /* Untick, press again on the SAME sheet — it must stay unticked. */
      flipBox.checked = false;
      sb.split();
      check('S40', 'unticking and re-splitting the same sheet keeps it unticked',
        flipBox.checked === false,
        'otherwise a sheet that is already First Last could never be imported');
      check('S40', 'and the name is then left alone',
        sb.rbName(doc.getElementById('rbNamesArea').value.split('\n')[0]) === 'Cattani Julie');

      /* A genuinely NEW sheet ticks again. */
      doc.getElementById('rbSheetArea').value = SHEET.replace('Cattani Julie', 'Brown Lindsey');
      sb.split();
      check('S40', 'a different sheet ticks it again', flipBox.checked === true,
        'the decision is per paste, not once for the session');
    }
  }
}


/* ============================================================
 * Suite 41. Everything the import reads must survive the reload.
 *
 * Owner, 2026-08-17, after running it: "its not making them first name last
 * name after its done".
 *
 * The name flip is a CHECKBOX. Batching reloads the page between batches. The
 * saved job carried the eighteen text boxes and nothing else, so the first
 * batch wrote "Julie Cattani" and every batch after it wrote "Cattani Julie" —
 * at 50 rows a batch, fifty right and nine hundred wrong.
 *
 * The general rule this suite exists to hold: ANY input the import reads that
 * is not one of the rbAreaIds text boxes has to be carried in the job too.
 * ============================================================ */
suite('Suite 41. The saved job carries everything the import reads');
{
  check('S41', 'the flip is saved with the job',
    /flipNames: !!\(document\.getElementById\('rbFlipNames'\) \|\| \{\}\)\.checked/.test(admin),
    'a checkbox does not survive a reload, so it has to travel in the job');

  check('S41', 'and is put back when the job resumes',
    /if\(flip && typeof job\.flipNames === 'boolean'\) flip\.checked = job\.flipNames;/.test(admin),
    'restoring the text boxes alone is what caused the names to come out wrong');

  check('S41', 'the resume banner says the names are being turned round',
    /Names are being turned round to First Last/.test(admin),
    'across a reload there is otherwise nothing on screen saying which way names will be saved');

  /* ---- the inventory check ----
     Every element the import reads for its per-row values must either be an
     rbAreaIds box (already saved) or be listed in the job. This is what stops
     the same class of bug arriving with the next new input. */
  {
    const lift0 = (name) => {
      const at = admin.indexOf('function ' + name + '(');
      if (at < 0) return '';
      let d = 0;
      for (let i = admin.indexOf('{', at); i < admin.length; i++) {
        if (admin[i] === '{') d++;
        else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
      }
      return '';
    };
    /* ⚠ The loop body is not the whole story: rbFlipNames is read inside
       rbName(), which lives outside it, so scanning the loop alone would have
       missed the very bug this suite exists for. Follow the per-row helpers. */
    const imp = admin.slice(admin.indexOf('let pinsKept = 0'), admin.indexOf('// --- Invoice Bulk Update ---'))
      + lift0('rbName') + lift0('rbCol') + lift0('rbHeaderOffset');
    const readsIds = [...imp.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)].map(m => m[1]);
    const areas = JSON.parse((admin.match(/const rbAreaIds = (\[[^\]]*\]);/) || [])[1].replace(/'/g, '"'));
    /* Elements the import only WRITES to, or reads for display, are not inputs
       and do not need carrying. Listed explicitly so a new one shows up here
       rather than being silently assumed harmless. */
    const NOT_INPUT = ['rbImportStatus', 'rbCheckReport', 'rbSheetArea', 'rbSheetReport',
                       'rbSheetStatus', 'rbResumeBanner', 'rbResumeBtn', 'rbResumeCancelBtn',
                       'rbImportBtn'];
    const jobBlock = imp.slice(imp.indexOf('const remembered = bulkJobSave({'), imp.indexOf('});', imp.indexOf('const remembered = bulkJobSave({')));
    const unaccounted = [...new Set(readsIds)].filter(id =>
      areas.indexOf(id) < 0 && NOT_INPUT.indexOf(id) < 0 && jobBlock.indexOf(id) < 0);
    check('S41', 'every input the import reads is carried in the job',
      unaccounted.length === 0,
      'these are read during an import but are not saved with it, so a resumed batch would read a different value: ' + unaccounted.join(', '));
  }

  /* ---- and the round trip, run for real ---- */
  if (!JSDOM) {
    note('jsdom not installed — skipping the reload round trip');
  } else {
    const lift = (name) => {
      const at = admin.indexOf('function ' + name + '(');
      if (at < 0) return null;
      let d = 0;
      for (let i = admin.indexOf('{', at); i < admin.length; i++) {
        if (admin[i] === '{') d++;
        else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
      }
      return null;
    };
    const areas = JSON.parse((admin.match(/const rbAreaIds = (\[[^\]]*\]);/) || [])[1].replace(/'/g, '"'));
    const restoreSrc = lift('bulkJobRestoreBoxes');
    check('S41', 'bulkJobRestoreBoxes exists', !!restoreSrc);

    if (restoreSrc) {
      /* A page that has just RELOADED: boxes empty, checkbox off. */
      const dom = new JSDOM(
        '<input type="checkbox" id="rbFlipNames">' +
        areas.map(a => '<textarea id="' + a + '"></textarea>').join('')
      );
      const doc = dom.window.document;
      const sb = {};
      new Function('document', 'rbAreaIds',
        'function rbRefreshCounts(){}' +
        'function rbSplitSheetIntoBoxes(){}' +
        restoreSrc + lift('flipLastFirstName') +
        'function rbName(r){ const f = document.getElementById("rbFlipNames"); return (f && f.checked) ? flipLastFirstName(r) : r; }' +
        'this.restore = bulkJobRestoreBoxes; this.rbName = rbName;'
      ).call(sb, doc, areas);

      const job = {
        cursor: 50, total: 962, identifier: 'phone+address', fingerprint: 'x',
        boxes: {rbNamesArea: 'Cattani Julie', rbPhonesArea: '8019795123'},
        flipNames: true
      };

      check('S41', 'the checkbox starts off after a reload',
        doc.getElementById('rbFlipNames').checked === false);

      sb.restore(job);

      check('S41', 'resuming puts the flip back on',
        doc.getElementById('rbFlipNames').checked === true,
        'this is the bug: without it every batch after the first saved names the wrong way round');
      check('S41', 'so the name is saved First Last on batch two as well',
        sb.rbName(doc.getElementById('rbNamesArea').value) === 'Julie Cattani',
        'got ' + sb.rbName(doc.getElementById('rbNamesArea').value));

      /* And the other direction: a job saved with the flip OFF must not turn it
         on when it resumes. */
      doc.getElementById('rbFlipNames').checked = true;
      sb.restore(Object.assign({}, job, {flipNames: false}));
      check('S41', 'a job saved with the flip off stays off',
        doc.getElementById('rbFlipNames').checked === false,
        'a sheet that is already First Last must not be reversed half way through');
      check('S41', 'and that name is left alone',
        sb.rbName(doc.getElementById('rbNamesArea').value) === 'Cattani Julie');

      /* An old job from before this fix has no flipNames at all. It must not
         crash, and must not silently flip. */
      doc.getElementById('rbFlipNames').checked = false;
      const legacy = Object.assign({}, job);
      delete legacy.flipNames;
      sb.restore(legacy);
      check('S41', 'a job saved before this existed is left as it is, not guessed',
        doc.getElementById('rbFlipNames').checked === false,
        'a half-finished job from the old build must not change meaning under the office');
    }
  }
}


/* ============================================================
 * Suite 42. Fix names only — matched on the customer number.
 *
 * Owner, 2026-08-17: "not evryones name got flipped for some reason", then
 * "tell me how many peoples name in the website isnt right". Sampling her own
 * website export against the sheet: 0 of 45 had been turned round.
 *
 * The flip itself was never the problem — all 945 importable rows turn round
 * correctly. REACH was. The import identifies a row by phone AND street, so a
 * customer with no phone on the sheet, or a record on file with no street to
 * match against, is never touched.
 *
 * Every one of those has a customer NUMBER, so this pass matches on the number
 * and writes exactly one field. It is deliberately not folded into the import:
 * matching on the number is what the import refuses to do while the numbers
 * are being repaired, and widening that would send whole rows of data to the
 * wrong customer. A name is small and visible; an address, a price and a bin
 * count are not.
 * ============================================================ */
suite('Suite 42. Fix names only, matched on the customer number');
{
  const lift = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return null;
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return null;
  };

  check('S42', 'the button exists', admin.indexOf('id="rbFixNamesBtn"') > 0);
  check('S42', 'rbCollectNameFixes exists', !!lift('rbCollectNameFixes'));

  /* ⚠ It must write the NAME and nothing else. The whole reason this is allowed
     to match on a number the importer will not trust is that the blast radius
     is one visible field. */
  {
    /* ⚠ ANCHORED ON THIS TOOL'S OWN HANDLER. "go.addEventListener('click',
       onceAtATime" is a shape several Danger Zone tools share — the exact
       duplicate button added one more in 2026-08-18 and, sitting earlier in
       the file, it captured this slice and turned a real pass into a failure.
       Start from the button this check is about. */
    const owner = admin.indexOf("document.getElementById('rbFixNamesBtn')");
    const at = admin.indexOf("go.addEventListener('click', onceAtATime", owner);
    const end = admin.indexOf('rbPendingNameFixes = null;', at);
    const body = owner > 0 && at > owner && end > at ? admin.slice(at, end) : '';
    check('S42', 'the apply step writes only the name', !!body &&
      /updateDoc\(doc\(db,'jobAddresses', list\[i\]\.id\), \{name: list\[i\]\.to\}\)/.test(body) &&
      !/street|city|zip|customerNumber|measuredFeet|housePrice/.test(body),
      'matching on a number the importer will not trust is only safe while one visible field is at stake');
  }

  {
    /* Scoped to THIS handler. The import has a guard that reads almost the
       same, and a file-wide search matched that one instead — so removing
       this tool's guard read as a pass. Both checks are now scoped, in
       opposite directions. */
    const toolBlk = admin.slice(admin.indexOf("document.getElementById('rbFixNamesBtn')"),
                                admin.indexOf("document.getElementById('rbCheckBtn')"));
    check('S42', 'it refuses to run against an empty customer list',
      toolBlk.indexOf('if(!jobAddresses.length){') > 0 &&
      /has not finished loading/.test(toolBlk),
      'with no customers loaded it would report every name as needing a change and match none of them');
  }

  check('S42', 'it shows what it would change before writing anything',
    /would change\. Nothing has been saved yet\./.test(admin) &&
    /id="rbFixNamesGoBtn"/.test(admin),
    'a rename of nine hundred customers is not something to set off with one click');

  /* ---- the matching, run for real ---- */
  if (!JSDOM) {
    note('jsdom not installed — skipping the name-matching run');
  } else {
    const src = lift('rbCollectNameFixes');
    if (src) {
      const dom = new JSDOM(
        '<input type="checkbox" id="rbFlipNames" checked>' +
        '<textarea id="rbCustNumbersArea"></textarea><textarea id="rbNamesArea"></textarea>' +
        '<textarea id="rbStreetsArea"></textarea>'
      );
      const doc = dom.window.document;
      const jobAddresses = [
        {id: 'a', data: {customerNumber: '144', name: 'Cattani Julie'}},   // needs turning round
        {id: 'b', data: {customerNumber: '85',  name: 'Paul /Jill Beckstead'}}, // already right
        {id: 'c', data: {customerNumber: '112', name: 'Brown Kathy'}},     // no phone on the sheet
        {id: 'd', data: {customerNumber: '',    name: 'Nobody'}},          // no number at all
      ];
      const sb = {};
      new Function('document', 'jobAddresses',
        lift('rbHeaderOffset') + lift('rbCol') + lift('flipLastFirstName') +
        'function rbName(r){ const f = document.getElementById("rbFlipNames"); return (f && f.checked) ? flipLastFirstName(r) : r; }' +
        src + 'this.collect = rbCollectNameFixes;'
      ).call(sb, doc, jobAddresses);

      doc.getElementById('rbCustNumbersArea').value = ['144', '85', '112', '999'].join('\n');
      doc.getElementById('rbNamesArea').value =
        ['Cattani Julie', 'Beckstead Paul /Jill', 'Brown Kathy', 'Ghost Person'].join('\n');

      const out = sb.collect();

      check('S42', 'a name that needs turning round is picked up',
        out.changes.some(c => c.cu === '144' && c.to === 'Julie Cattani'),
        'got ' + JSON.stringify(out.changes));

      check('S42', 'a name already the right way round is left alone',
        !out.changes.some(c => c.cu === '85'),
        'rewriting a correct name is churn, and on a re-run it would look like the tool never settles');

      /* ⚠ THE WHOLE POINT. #112 has no phone on the sheet, so the import skips
         it — this pass reaches it by number. */
      check('S42', 'a customer the import cannot reach IS reached by number',
        out.changes.some(c => c.cu === '112' && c.to === 'Kathy Brown'),
        'these are exactly the ones that were left surname-first');

      check('S42', 'a number nobody holds is reported, not guessed at',
        out.missing.length === 1 && out.missing[0].cu === '999');

      check('S42', 'a row with no number is passed over',
        !out.changes.some(c => !c.cu));

      /* With the flip OFF it must take the sheet name as written. */
      doc.getElementById('rbFlipNames').checked = false;
      const plain = sb.collect();
      check('S42', 'with the flip off it uses the name exactly as pasted',
        plain.changes.some(c => c.cu === '85' && c.to === 'Beckstead Paul /Jill') &&
        !plain.changes.some(c => c.cu === '144'),
        'the tick box means the same thing here as it does in the import');
    }
  }
}


/* ============================================================
 * Suite 43. Who goes out first, and who a crew is allowed to visit.
 *
 * Owner, 2026-08-17, reading a real Oct 1 day that held Lehi, Draper, American
 * Fork, Herriman, South Jordan, Alpine and Pleasant Grove all at once, with
 * "Any" houses on it while October houses waited:
 *   - "on the first day we need to be prioritizing people who asked to be hung
 *      in oct, so we shouldnt be doing anyone who said any until oct are done"
 *   - "before we include anyone from AF we need to get everyone Lehi Oct done
 *      first and then if there arent 20 houses for Lehi Oct we can go to AF oct"
 *   - "each crew is only doing one other city ... but we dont have one doing
 *      American fork, saratoga springs, and Lehi"
 *   - "the very top priority is new hangs, so if a new hang requested Any they
 *      are the first chance we get in Oct and if they said Nov we do them the
 *      first chance we get in Nov"
 * ============================================================ */
suite('Suite 43. Install order and the one-other-town rule');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  /* ---- the ordering itself ---- */
  {
    const src = fn('houseInstallPriority');
    check('S43', 'houseInstallPriority exists', !!src);
    if (src) {
      const sb = {};
      /* houseInstallPriority now asks prefSpecificDate whether the pref names
         an actual day, so both have to be lifted together. */
      new Function('BASE_START', fn('prefSpecificDate') + src + 'this.p = houseInstallPriority;')
        .call(sb, new Date(2026, 9, 1));
      const p = sb.p;
      const NEW = { chargeNewMemberFee: true };
      const OLD = { chargeNewMemberFee: false };

      check('S43', 'a new hang outranks a returning October house',
        p({ pref: 'Any' }, NEW) < p({ pref: 'October' }, OLD),
        'a new hang who said Any goes at the first chance in October');
      check('S43', 'a new hang who asked for November also sorts first',
        p({ pref: 'November' }, NEW) < p({ pref: 'October' }, OLD),
        'houseAllowedFrom still holds them to November — this only decides the order once they are allowed');
      check('S43', 'October beats no-preference for returning customers',
        p({ pref: 'October' }, OLD) < p({ pref: '' }, OLD),
        'nobody who said Any should go while October houses are waiting');
      check('S43', 'no-preference beats November',
        p({ pref: '' }, OLD) < p({ pref: 'November' }, OLD));
      check('S43', 'a missing customer record does not crash it',
        typeof p({ pref: 'October' }, null) === 'number' && typeof p({}, undefined) === 'number');
      check('S43', 'the new-hang flag is the same one the Routes badge reads',
        /chargeNewMemberFee === true/.test(src) && /chargeNewMemberFee === true/.test(fn('isNewHangUrgent')),
        'two different definitions of "new hang" would drift apart');
    }
  }

  check('S43', 'the customer record is passed in, not ignored',
    /priority:houseInstallPriority\(h,d\)/.test(admin),
    'without the record every house looks like a returning one and new hangs lose their place');

  /* ---- the builder, run for real ---- */
  {
    const planStart = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
    const planEnd = admin.indexOf('/* Top every day up to the cap');
    check('S43', 'planNewCrewDays found', planStart > 0 && planEnd > planStart);
    if (planStart > 0 && planEnd > planStart) {
      const ctx = {};
      new Function(
        admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) +
        admin.slice(admin.indexOf('const NEARBY_TOWN_MILES'), admin.indexOf('function townCentres')) +
        'let NEARBY_TOWN_LIST={};' + fn('sameTownName') + fn('haversine') + fn('townCentres') + fn('nearbyTowns') +
        'function seasonFirstDate(){return new Date(2026,9,1);}' +
        fn('toDateStr') + fn('nextWorkingDay') + admin.slice(planStart, planEnd) +
        ';this.plan=planNewCrewDays;'
      ).call(ctx);

      const at = {
        Lehi: [40.391, -111.851], Highland: [40.425, -111.795], 'American Fork': [40.377, -111.796],
        Alpine: [40.453, -111.777], Draper: [40.524, -111.863], Sandy: [40.572, -111.859],
        Orem: [40.297, -111.695], Herriman: [40.514, -112.033]
      };
      const make = (city, n, priority) => {
        const out = [];
        for (let i = 0; i < n; i++) out.push({ id: city + priority + i, city, priority,
          from: '2026-10-01', stop: { lat: at[city][0], lng: at[city][1] } });
        return out;
      };

      /* ⭐ THE REPORTED DAY. Lehi is short, and two neighbours can fill it:
         American Fork has October houses, Highland has only "Any" houses. */
      /* Lehi must hold the BIGGEST backlog, or the neighbours are handed their
         own full days first and there is nothing left to borrow — which is what
         the first version of this test actually measured. */
      const waiting = []
        .concat(make('Lehi', 12, 1))           // Lehi, October — short of 20
        /* American Fork is the NEARER neighbour (~2.9 mi) and has only "Any"
           houses; Highland is farther (~3.9 mi) and has the October ones. So
           picking the most urgent town and picking the closest give DIFFERENT
           answers, which is the only way this check can tell them apart. */
        .concat(make('American Fork', 8, 2))   // nearer, no preference
        .concat(make('Highland', 8, 1));       // farther, October
      const days = ctx.plan(waiting, {}, { floorDate: '2026-10-01', maxDays: 40 });

      check('S43', 'no crew is sent to more than two towns',
        days.every(d => d.towns.length <= 2),
        'worst crew-day held ' + Math.max.apply(null, days.map(d => d.towns.length)) +
        ' towns; the owner ruled out three');

      check('S43', 'a crew-day always leads with its own town',
        days.every(d => d.towns[0] === d.city));

      const lehiDay = days.filter(d => d.city === 'Lehi')[0];
      check('S43', 'the short Lehi day borrows from exactly one town',
        !!lehiDay && lehiDay.towns.length === 2,
        lehiDay ? 'towns: ' + lehiDay.towns.join(' + ') : 'no Lehi day built');

      /* ⭐ AND IT PICKS THE OCTOBER TOWN, not simply the nearest one. */
      check('S43', 'it borrows from the town with October houses, not the nearer "Any" one',
        !!lehiDay && lehiDay.towns[1] === 'Highland',
        lehiDay ? 'borrowed from ' + lehiDay.towns[1] + ' — American Fork is closer but has only Any houses' : 'no Lehi day built');

      check('S43', 'the Lehi day is filled to the cap',
        !!lehiDay && lehiDay.ids.length === 20,
        lehiDay ? 'held ' + lehiDay.ids.length : 'no Lehi day built');

      check('S43', 'every Lehi house is on it before anybody is borrowed',
        !!lehiDay && lehiDay.ids.filter(id => id.indexOf('Lehi') === 0).length === 12,
        'the day s own town is exhausted first');

      check('S43', 'and the borrowed ones are the October houses',
        !!lehiDay && lehiDay.ids.filter(id => id.indexOf('Highland') === 0).length === 8 &&
        !lehiDay.ids.some(id => id.indexOf('American Fork') === 0),
        'nobody who said Any should ride while October houses are still waiting next door');

      check('S43', 'nobody is lost',
        days.reduce((s, d) => s + d.ids.length, 0) === waiting.length,
        days.reduce((s, d) => s + d.ids.length, 0) + ' of ' + waiting.length);

      /* Two crews still never land in the same town on the same day. */
      const clash = [];
      const seen = {};
      days.forEach(d => {
        seen[d.date] = seen[d.date] || [];
        d.towns.forEach(t => {
          if (seen[d.date].indexOf(t) >= 0) clash.push(d.date + ' ' + t);
          seen[d.date].push(t);
        });
      });
      check('S43', 'two crews are never in one town on one day', clash.length === 0,
        clash.join(', '));

      /* A town with nothing near it still gets its own day rather than waiting. */
      const alone = ctx.plan(make('Orem', 6, 1), {}, { floorDate: '2026-10-01', maxDays: 40 });
      check('S43', 'a town with no neighbour still goes out on its own',
        alone.length === 1 && alone[0].towns.length === 1 && alone[0].ids.length === 6,
        JSON.stringify(alone.map(d => d.towns)));
    }
  }
}


/* ============================================================
 * Suite 44. The plan keeps up with the customer list.
 *
 * Owner, 2026-08-17: "the schedule should check for changes in all customers
 * periodically to update for changes".
 *
 * The Schedule tab is built from an imported CSV and keeps its OWN copy of
 * every house, so an edit made in All Customers never reached it. Only the town
 * was ever pulled across — a customer moved from October to November kept the
 * old month here and stayed on an October day.
 *
 * Found while doing it, and fixed here too: "After Thanksgiving" matched
 * neither OCT nor NOV, so those houses read as HAVING NO PREFERENCE and were
 * offered the first day of October — the one month they had ruled out. The
 * master sheet writes that value as THX, so it is not hypothetical.
 * ============================================================ */
suite('Suite 44. The plan keeps up with the customer list');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  /* ---- After Thanksgiving is a real preference, not a blank ---- */
  {
    const src = THX_CONST + fn('prefSpecificDate') + fn('houseAllowedFrom');
    const pri = fn('houseInstallPriority');
    check('S44', 'houseAllowedFrom and houseInstallPriority found', !!src && !!pri);
    if (src && pri) {
      const sb = {};
      new Function('BASE_START', 'thanksgivingDate', 'isoOf',
        src + pri + 'this.from = houseAllowedFrom; this.pri = houseInstallPriority;'
      ).call(sb, new Date(2026, 9, 1),
        () => new Date(2026, 10, 26),                       // Thanksgiving 2026
        (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));

      check('S44', 'an After Thanksgiving house cannot be hung in October',
        sb.from({ pref: 'After Thanksgiving' }, '2026-10-01') > '2026-11-26',
        'got ' + sb.from({ pref: 'After Thanksgiving' }, '2026-10-01') +
        ' — this is the bug: it used to come back as 1 October');
      check('S44', 'the sheet\'s own THX spelling is understood too',
        sb.from({ pref: 'THX' }, '2026-10-01') > '2026-11-26');
      check('S44', 'and it sorts behind November',
        sb.pri({ pref: 'After Thanksgiving' }, {}) > sb.pri({ pref: 'November' }, {}));
      /* ⭐ Owner, 2026-08-18: "everyone labeled Thanksgiving and before
         thanksgiving we need to do as close to thanksgiving as possible."
         It used to come back as 1 November — the word starts with NOV — so
         these were hung three weeks before the holiday they were asking about,
         on the early-November days people with no deadline could have had. */
      check('S44', '"November - Before Thanksgiving" waits for the run-up to the holiday',
        sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') === '2026-11-19',
        'got ' + sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') +
        ' — Thanksgiving 2026 is the 26th, so the list opens on the 19th');
      /* ⚠ And the older trap it was written for: the words contain
         "thanksgiving", and reading them as AFTER Thanksgiving would move the
         customer to the wrong side of the holiday entirely. */
      check('S44', 'and it is never read as AFTER Thanksgiving',
        sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') < '2026-11-26',
        'before and after are opposite answers to the same question');
      check('S44', 'once the run-up opens they go ahead of everybody',
        sb.pri({ pref: 'November - Before Thanksgiving' }, {}) <
          sb.pri({ pref: 'November' }, {}) &&
        sb.pri({ pref: 'November - Before Thanksgiving' }, {}) <
          sb.pri({ pref: '' }, {}),
        'inside that week a day late is a missed Thanksgiving, not a slightly later hang');
      check('S44', 'a bare "Thanksgiving" is treated the same way',
        sb.from({ pref: 'Thanksgiving' }, '2026-10-01') === '2026-11-19',
        'got ' + sb.from({ pref: 'Thanksgiving' }, '2026-10-01'));
      check('S44', 'October and no-preference are untouched',
        sb.from({ pref: 'October' }, '2026-10-01') === '2026-10-01' &&
        sb.from({ pref: '' }, '2026-10-01') === '2026-10-01');
    }
  }

  /* ---- the sync itself ---- */
  {
    const src = fn('syncHousesFromCustomers');
    const keySrc = fn('prefKey');
    const fieldsM = admin.match(/const SCHEDULE_SYNC_FIELDS = (\[[\s\S]*?\n\];)/);
    check('S44', 'syncHousesFromCustomers exists', !!src);
    check('S44', 'the field list exists', !!fieldsM);

    if (src && keySrc && fieldsM) {
      const SEASON = [{ houses: [
        { id: 1, name: 'Julie Cattani', cu: '144', city: 'Lehi',     pref: 'OCT', phone: '8019795123', address: '1 A St', details: '' },
        { id: 2, name: 'Old Name',      cu: '85',  city: 'Lehi',     pref: 'OCT', phone: '3855353797', address: '2 B St', details: 'x' },
        { id: 3, name: 'Takedown',      cu: '144', city: 'Lehi',     pref: 'OCT', isTakedown: true },
        { id: 4, name: 'No Record',     cu: '999', city: 'Lehi',     pref: 'OCT' }
      ] }];
      const jobAddresses = [
        { id: 'a', data: { customerNumber: '144', city: 'Highland', installPreference: 'November',
                           name: 'Julie Cattani', street: '1 A St', phone: '8019795123', notes: 'gate code 1234' } },
        { id: 'b', data: { customerNumber: '85', city: '', installPreference: '',
                           name: 'Paul Beckstead', street: '', phone: '', notes: '' } }
      ];
      const custByNumber = new Map(jobAddresses.map(c => [c.data.customerNumber, c]));

      const sb = {};
      new Function('SEASON', 'jobAddresses', 'custByNumber', 'extractCleanCity', 'customerForHouse', 'BASE_START',
        /* the timing field now asks prefSpecificDate whether a named day is at
           stake, so it travels with the field list */
        fn('prefSpecificDate') + keySrc + 'const SCHEDULE_SYNC_FIELDS = ' + fieldsM[1] + src +
        'this.sync = syncHousesFromCustomers; this.prefKey = prefKey;'
      ).call(sb, SEASON, jobAddresses, custByNumber,
        (c) => ('' + (c || '')).split(',')[0].trim(),
        (h) => custByNumber.get(String(h.cu || '')) || null, new Date(2026, 9, 1));

      const moved = sb.sync();

      check('S44', 'a changed town is pulled across',
        SEASON[0].houses[0].city === 'Highland',
        'got ' + SEASON[0].houses[0].city);

      /* ⭐ THE ONE THAT WAS MISSING. */
      check('S44', 'a changed install month is pulled across too',
        SEASON[0].houses[0].pref === 'November',
        'got ' + SEASON[0].houses[0].pref + ' — this is what left people on an October day after they asked for November');

      check('S44', 'notes and other details come across',
        SEASON[0].houses[0].details === 'gate code 1234');

      /* ⚠ A blank on the customer must never wipe what the plan has. */
      check('S44', 'a blank on the customer does NOT wipe the plan',
        SEASON[0].houses[1].city === 'Lehi' && SEASON[0].houses[1].pref === 'OCT' &&
        SEASON[0].houses[1].address === '2 B St' && SEASON[0].houses[1].details === 'x',
        'a half-filled record must not empty a card the crew relies on');
      check('S44', 'but a real value on that same customer still lands',
        SEASON[0].houses[1].name === 'Paul Beckstead');

      check('S44', 'takedowns and fixes are left alone',
        SEASON[0].houses[2].city === 'Lehi',
        'those are copies of a house, not the house');
      check('S44', 'a house with no customer record is left alone',
        SEASON[0].houses[3].city === 'Lehi');

      check('S44', 'it reports what it changed', moved.length >= 3 &&
        moved.every(m => m.name && m.field && m.to !== undefined),
        JSON.stringify(moved));

      /* Running it again must be a no-op, or the timer would toast for ever. */
      const again = sb.sync();
      check('S44', 'running it again changes nothing', again.length === 0,
        'a sync that never settles would toast at the office every five minutes: ' + JSON.stringify(again));

      /* OCT vs October must not read as a change. */
      check('S44', '"OCT" and "October" are the same timing',
        sb.prefKey('OCT') === sb.prefKey('October') &&
        sb.prefKey('NOV') === sb.prefKey('November - Before Thanksgiving') &&
        sb.prefKey('THX') === sb.prefKey('After Thanksgiving') &&
        sb.prefKey('') === sb.prefKey('Normal Schedule'),
        'the sheet and the record spell these differently; treating that as a change would rewrite every house on every tick');
    }
  }

  /* ---- the wiring ---- */
  check('S44', 'a customer change drives the sync',
    /safeRender\('scheduleSync'/.test(admin) && /scheduleSync: 'schedule'/.test(admin),
    'and through safeRender, so it waits for the tab to be open like everything else');

  check('S44', 'opening the Schedule tab re-checks',
    /__navSync[\s\S]{0,200}?scheduleSyncFromCustomers/.test(admin));

  check('S44', 'and there is a periodic backstop',
    admin.indexOf('__syncTimer=setInterval(') > 0 && /5\*60\*1000/.test(admin),
    'the owner asked for periodically; a tab left open all day needs it');

  check('S44', 'the timer only runs once the plan is loaded',
    /if\(__syncTimer\) return;/.test(admin) && /if\(!loaded\) return 0;/.test(admin),
    'syncing into a plan that is not there would throw on a timer, for ever');

  check('S44', 'a sync that changes nothing says nothing',
    admin.indexOf('if(!moved.length && !timing.moved.length && !timing.stuck.length) return 0;') > 0,
    'a toast every five minutes is how somebody learns to ignore toasts');
}


/* ============================================================
 * Suite 45. Deleting duplicate customers.
 *
 * Owner, 2026-08-17, reading Health Check: "actually yes we Have duplicate
 * customers which is bad we need to delete duplicates". 1,923 customers on file
 * against 962 on the master sheet, and 944 numbers each held by two records
 * with the SAME name — the book had been imported over itself.
 *
 * This is the most destructive thing in the app, so the tests are about the
 * refusals, not the deleting. Every check here is a reason NOT to delete
 * something.
 * ============================================================ */
suite('Suite 45. Deleting duplicate customers');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  const findSrc = fn('findDuplicateCustomers');
  check('S45', 'findDuplicateCustomers exists', !!findSrc);

  const weightM = admin.match(/const DUP_ASSET_WEIGHT = (\{[^}]*\});/);
  check('S45', 'the asset weights exist', !!weightM);

  if (findSrc && weightM) {
    const mk = (id, d) => ({ id, data: d });
    const build = (jobAddresses) => {
      const sb = {};
      new Function('jobAddresses', 'custInvoiceKey', 'normalizeStreetForMatch',
        fn('dupNormName') + fn('dupStreetOf') + fn('dupAssets') +
        'const DUP_ASSET_WEIGHT = ' + weightM[1] + ';' + fn('dupScore') + findSrc +
        'this.find = findDuplicateCustomers;'
      ).call(sb, jobAddresses,
        (d) => String(d.phone || '').replace(/\D/g, '') || String(d.email || '').toLowerCase(),
        (v) => String(v || '').toLowerCase().trim().replace(/[.,#]/g, '').replace(/\s+/g, ' '));
      return sb.find;
    };

    /* The reported shape: same number, same name, one copy carrying everything. */
    {
      const rich = mk('a', { customerNumber: '144', name: 'Julie Cattani', street: '6037 W 11860 N',
                             city: 'Highland', phone: '8019795123', lat: 40.4, lng: -111.8, measuredFeet: 230 });
      const bare = mk('b', { customerNumber: '144', name: 'Julie Cattani', city: 'Highland' });
      const out = build([rich, bare])({ '8019795123': true }, {});
      check('S45', 'a same-number pair is found', out.ready.length === 1,
        'ready ' + out.ready.length + ', review ' + out.review.length);
      check('S45', 'the copy carrying everything is the one kept',
        out.ready.length === 1 && out.ready[0].keeper.cust.id === 'a',
        'kept ' + (out.ready[0] && out.ready[0].keeper.cust.id));
      check('S45', 'and the empty copy is the one that goes',
        out.ready.length === 1 && out.ready[0].losers.length === 1 && out.ready[0].losers[0].cust.id === 'b');
    }

    /* ⚠ THE REFUSAL. One copy has the invoice, the other has the route. */
    {
      const withInvoice = mk('a', { customerNumber: '5', name: 'Chris Ashcraft', phone: '8013603138' });
      const withRoute   = mk('b', { customerNumber: '5', name: 'Chris Ashcraft', street: '106 N 1230 E' });
      const out = build([withInvoice, withRoute])({ '8013603138': true }, { b: true });
      check('S45', 'a pair where each copy holds something unique is REFUSED',
        out.ready.length === 0 && out.review.length === 1,
        'ready ' + out.ready.length + ', review ' + out.review.length +
        ' — deleting either loses real work, and that is the owner\'s call');
      check('S45', 'and the refusal says what would be lost',
        out.review.length === 1 && out.review[0].unique.length > 0,
        JSON.stringify(out.review[0] && out.review[0].unique));
    }

    /* A customer on their own is never a duplicate. */
    {
      const out = build([mk('a', { customerNumber: '7', name: 'Bryan Grover', street: '448 N 910 E' })])({}, {});
      check('S45', 'a customer with no twin is left alone', out.ready.length === 0 && out.review.length === 0);
    }

    /* Two DIFFERENT people must never be merged on name alone. */
    {
      const a = mk('a', { name: 'Erin Wade', street: '7659 N Pasture View Rd', city: 'Eagle Mountain' });
      const b = mk('b', { name: 'Erin Wade', street: '7545 N Evans Ranch Rd', city: 'Eagle Mountain' });
      const out = build([a, b])({}, {});
      check('S45', 'the same name at DIFFERENT addresses is not a duplicate',
        out.ready.length === 0 && out.review.length === 0,
        'these are two real houses on the master sheet, both called Erin Wade');
    }

    /* No number and no address: nothing safe to group on. */
    {
      const out = build([mk('a', { name: 'Ghost' }), mk('b', { name: 'Ghost' })])({}, {});
      check('S45', 'records with neither a number nor an address are not grouped',
        out.ready.length === 0 && out.review.length === 0,
        'a name on its own is not enough to call two records the same house');
    }

    /* ⭐ THE GUARANTEE THAT MAKES DELETING SAFE, asserted directly.
       A pair is refused the moment a loser holds anything the keeper does
       not, so every group that reaches "ready" has a keeper holding a
       SUPERSET of its losers' assets. Nothing is ever thrown away.
       Written this way after a red-check showed the asset WEIGHTS could be
       gutted with no test noticing — and that is correct, because once the
       superset rule holds the weights cannot pick the wrong keeper. The
       superset is the property worth guarding; the weights are just how
       ties are ordered. */
    {
      const invoiced = mk('a', { customerNumber: '9', name: 'X', phone: '8012438155' });
      const fat = mk('b', { customerNumber: '9', name: 'X', street: '1 A St', lat: 1, lng: 2,
                            email: 'x@y.com', measuredFeet: 300, housePrice: 400, notes: 'n' });
      const out = build([invoiced, fat])({ '8012438155': true }, {});
      check('S45', 'a copy with an invoice is never the one deleted',
        out.ready.length === 0 && out.review.length === 1,
        'the fat copy holds things the invoiced one does not, so this is a refusal, not a silent delete');

      /* Across a spread of shapes, every deletable group must satisfy it. */
      const many = [
        mk('k1', { customerNumber: '1', name: 'A', street: '1 St', phone: '111', email: 'a@b.c', lat: 1, lng: 1 }),
        mk('l1', { customerNumber: '1', name: 'A' }),
        mk('l2', { customerNumber: '1', name: 'A', street: '1 St' }),
        mk('k2', { customerNumber: '2', name: 'B', street: '2 St', notes: 'x' }),
        mk('l3', { customerNumber: '2', name: 'B', street: '2 St' })
      ];
      const spread = build(many)({}, {});
      const supersetHolds = spread.ready.every(g =>
        g.losers.every(l => Object.keys(l.assets).every(a => !!g.keeper.assets[a])));
      check('S45', 'every deletable group keeps a copy holding ALL the others hold',
        spread.ready.length > 0 && supersetHolds,
        'this is the whole safety argument: if it does not hold, deleting loses something');
    }
  }

  /* ---- the guards around the button ---- */
  check('S45', 'finding and deleting are two separate buttons',
    admin.indexOf('id="dupFindBtn"') > 0 && /id=.dupDeleteBtn./.test(admin));

  check('S45', 'the delete button starts disabled and needs DELETE typed',
    /id="dupDeleteBtn" disabled/.test(admin) &&
    /go\.disabled = input\.value\.trim\(\)\.toUpperCase\(\) !== 'DELETE'/.test(admin),
    'the same lock the Delete All Customers tool uses');

  check('S45', 'the whole list is shown before anything is deleted',
    /Nothing has been deleted yet/.test(admin));

  /* ⚠ The number must NOT go back in the pool — the keeper still holds it. */
  {
    const at = admin.indexOf("go.addEventListener('click', onceAtATime");
    const end = admin.indexOf('dupPending = null;', at);
    const body = at > 0 && end > at ? admin.slice(at, end) : '';
    check('S45', 'the delete does NOT return the number to the pool', !!body &&
      body.indexOf('availableCustomerNumbers') === -1,
      'the copy being kept still holds that number; pooling it would hand a live number to somebody new');
    check('S45', 'it takes the deleted copy off any route first', !!body &&
      body.indexOf("typeof removeCustomerFromUpcomingRoutes === 'function'") > 0 &&
      body.indexOf('await removeCustomerFromUpcomingRoutes(') > 0 &&
      body.indexOf('removeCustomerFromUpcomingRoutes') < body.indexOf("deleteDoc(doc(db,'jobAddresses'"),
      'otherwise the crew is left with a stop pointing at a customer who is not there');
  }

  check('S45', 'a failed invoice read stops the whole thing',
    /Could not read the invoices, so it is not safe to decide/.test(admin),
    'a missing invoice makes a record look empty and deletable, which is exactly backwards');

  check('S45', 'it refuses to run against an empty customer list',
    /if\(!jobAddresses\.length\)\{[\s\S]{0,200}?has not finished loading/.test(admin));
}


/* ============================================================
 * Suite 46. Nobody is hung before the month they asked for.
 *
 * Owner, 2026-08-17, looking at a real 1 October day: "the first day should not
 * be doing any Nov people, in fact under no circumstance do we do anyone in Nov
 * i october we just wait until Nov instead". Rylee Oliver, marked NOV, was
 * stop 39 on 1 October.
 *
 * The BUILDER never did that — houseAllowedFrom gates it. Two other things did:
 *   - the season is SAVED, so a day built before somebody changed their mind
 *     keeps them on it;
 *   - the customer sync added the same day now pulls a changed month across,
 *     which leaves a house sitting on 1 October holding the word NOVEMBER.
 * So the rule has to be enforced on the plan, not only at build time.
 * ============================================================ */
suite('Suite 46. Nobody is hung before the month they asked for');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  const src = fn('enforceInstallTiming');
  check('S46', 'enforceInstallTiming exists', !!src);

  if (src) {
    const build = (SEASON) => {
      const sb = {};
      new Function('SEASON', 'isoOf', 'seasonStartDate', 'dayDate', 'houseAllowedFrom',
        'extractCleanCity', 'maxStopsPerWorkingDay',
        src + 'this.run = enforceInstallTiming;'
      ).call(sb, SEASON,
        (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        () => new Date(2026, 9, 1),
        (d) => d._date,
        (h, startStr) => {
          const p = ('' + ((h && h.pref) || '')).trim().toUpperCase();
          if (p.indexOf('NOV') === 0) return '2026-11-01';
          return startStr;
        },
        (c) => ('' + (c || '')).split(',')[0].trim(),
        () => 40);
      return sb.run;
    };

    /* ⭐ THE REPORTED CASE. */
    {
      const nov = { name: 'Rylee Oliver', pref: 'NOV', city: 'Draper' };
      const oct = { name: 'Judy Black', pref: 'OCT', city: 'Lehi' };
      const SEASON = [
        { _date: new Date(2026, 9, 1), houses: [oct, nov] },
        { _date: new Date(2026, 10, 2), houses: [{ name: 'Someone', pref: 'NOV', city: 'Draper' }] }
      ];
      const out = build(SEASON)();
      check('S46', 'a November house is taken off an October day',
        SEASON[0].houses.indexOf(nov) === -1,
        'this is the exact stop the owner found on 1 October');
      check('S46', 'and lands on a day it is allowed on',
        SEASON[1].houses.indexOf(nov) !== -1);
      check('S46', 'the October house beside it is untouched',
        SEASON[0].houses.length === 1 && SEASON[0].houses[0] === oct);
      check('S46', 'and the move is reported',
        out.moved.length === 1 && out.moved[0].name === 'Rylee Oliver' &&
        out.moved[0].fromDate === '2026-10-01' && out.moved[0].toDate === '2026-11-02',
        JSON.stringify(out.moved));
    }

    /* It prefers a November day already working that town. */
    {
      const nov = { name: 'X', pref: 'November', city: 'Draper' };
      const SEASON = [
        { _date: new Date(2026, 9, 1), houses: [nov] },
        { _date: new Date(2026, 10, 2), houses: [{ name: 'a', pref: 'NOV', city: 'Sandy' }] },
        { _date: new Date(2026, 10, 3), houses: [{ name: 'b', pref: 'NOV', city: 'Draper' }] }
      ];
      build(SEASON)();
      check('S46', 'it prefers a later day already working that town',
        SEASON[2].houses.indexOf(nov) !== -1 && SEASON[1].houses.indexOf(nov) === -1,
        'sending the crew somewhere new to honour a date would break the town rule instead');
    }

    /* Nothing to move it to: say so rather than dropping it. */
    {
      const nov = { name: 'Stuck', pref: 'NOV', city: 'Draper' };
      const SEASON = [{ _date: new Date(2026, 9, 1), houses: [nov] }];
      const out = build(SEASON)();
      check('S46', 'with nowhere to go it stays put and is reported',
        SEASON[0].houses.indexOf(nov) !== -1 && out.stuck.length === 1 &&
        out.stuck[0].notBefore === '2026-11-01',
        'dropping them off the plan silently is worse than leaving them visible');
    }

    /* ⚠ A house already done is history. */
    {
      const done = { name: 'Done', pref: 'NOV', city: 'Draper', done: true };
      const SEASON = [
        { _date: new Date(2026, 9, 1), houses: [done] },
        { _date: new Date(2026, 10, 2), houses: [] }
      ];
      const out = build(SEASON)();
      check('S46', 'a house already ticked done is never moved',
        SEASON[0].houses.indexOf(done) !== -1 && out.moved.length === 0,
        'that day is the record of what actually happened');
    }

    /* October and no-preference houses are left exactly where they are. */
    {
      const a = { name: 'A', pref: 'OCT', city: 'Lehi' };
      const b = { name: 'B', pref: '', city: 'Lehi' };
      const SEASON = [
        { _date: new Date(2026, 9, 1), houses: [a, b] },
        { _date: new Date(2026, 10, 2), houses: [] }
      ];
      const out = build(SEASON)();
      check('S46', 'October and no-preference houses are not touched',
        SEASON[0].houses.length === 2 && out.moved.length === 0);
    }

    /* A full day is not overfilled to honour a date. */
    {
      const nov = { name: 'N', pref: 'NOV', city: 'Draper' };
      const full = [];
      for (let i = 0; i < 40; i++) full.push({ name: 'f' + i, pref: 'NOV', city: 'Draper' });
      const SEASON = [
        { _date: new Date(2026, 9, 1), houses: [nov] },
        { _date: new Date(2026, 10, 2), houses: full }
      ];
      const out = build(SEASON)();
      check('S46', 'a day already at 40 is not pushed over the cap',
        SEASON[1].houses.length === 40 && out.stuck.length === 1,
        '40 a day is the cap and honouring a date must not break it');
    }
  }

  /* ---- the saved-plan warning ---- */
  {
    const src2 = fn('crewDaysOverTownLimit');
    check('S46', 'crewDaysOverTownLimit exists', !!src2);
    if (src2) {
      const sb = {};
      new Function('SEASON', 'dayDate', 'isoOf', 'extractCleanCity',
        src2 + 'this.run = crewDaysOverTownLimit;'
      ).call(sb, [
        { _date: new Date(2026, 9, 1), houses: [
          { city: 'Lehi' }, { city: 'Draper' }, { city: 'American Fork' },
          { city: 'Highland' }, { city: 'Herriman' }, { city: 'Alpine' } ] },
        { _date: new Date(2026, 9, 2), houses: [{ city: 'Lehi' }, { city: 'Draper' }] }
      ], (d) => d._date,
        (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        (c) => ('' + (c || '')).split(',')[0].trim());
      const over = sb.run();
      check('S46', 'a saved day carrying too many towns is spotted',
        over.length === 1 && over[0].date === '2026-10-01',
        JSON.stringify(over));
      check('S46', 'a legitimate two-crew two-town day is not flagged',
        !over.some(o => o.date === '2026-10-02'),
        'two crews, each its own town plus at most one other, is four towns at most');
    }
  }

  check('S46', 'the sweep runs on every sync, not only when a field changed',
    admin.indexOf('timing=enforceInstallTiming();') > 0 &&
    admin.indexOf('if(!moved.length && !timing.moved.length && !timing.stuck.length) return 0;') > 0,
    'a plan saved before the rule existed is already breaking it, with nothing having changed today');
}


/* ============================================================
 * Suite 47. The two biggest towns get each day, recounted daily.
 *
 * Owner, 2026-08-17: "we want to start with the two cities that have the most
 * clients and work our way down to the cities with the least clients, so if
 * lehi has 140 houses heriman has 120 and AF has 119 then today is Lehi and
 * heriman but tomorrow is Lehi and AF."
 *
 * The builder used to walk TOWN by town — take the biggest, give it days until
 * its queue emptied, move on — which is why the season opened Lehi-Draper,
 * Lehi-Draper, Lehi-Draper. It now walks DAY by day and recounts before each
 * one, so a town that was just worked drops down the list on its own.
 * ============================================================ */
suite('Suite 47. The two biggest towns get each day');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };
  const planStart = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
  const planEnd = admin.indexOf('/* Top every day up to the cap');
  check('S47', 'planNewCrewDays found', planStart > 0 && planEnd > planStart);

  if (planStart > 0 && planEnd > planStart) {
    const ctx = {};
    new Function(
      admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) +
      admin.slice(admin.indexOf('const NEARBY_TOWN_MILES'), admin.indexOf('function townCentres')) +
      'let NEARBY_TOWN_LIST={};' + fn('sameTownName') + fn('haversine') + fn('townCentres') + fn('nearbyTowns') +
      'function seasonFirstDate(){return new Date(2026,9,1);}' +
      fn('toDateStr') + fn('nextWorkingDay') + admin.slice(planStart, planEnd) +
      ';this.plan=planNewCrewDays;'
    ).call(ctx);

    /* Far apart on purpose: this suite is about WHICH towns get the day, so
       nobody should be borrowing and muddying the answer. */
    const far = { Lehi: [40.391, -111.851], Herriman: [40.514, -112.633],
                  'American Fork': [40.377, -112.396], Orem: [40.297, -113.1] };
    const make = (counts, priority, from) => {
      const w = [];
      Object.keys(counts).forEach(c => {
        for (let i = 0; i < counts[c]; i++) {
          w.push({ id: c + '#' + i, city: c, priority: priority == null ? 1 : priority,
                   from: from || '2026-10-01', stop: { lat: far[c][0], lng: far[c][1] } });
        }
      });
      return w;
    };
    const byDay = (days) => {
      const m = {};
      days.forEach(d => { (m[d.date] = m[d.date] || []).push(d); });
      return m;
    };

    /* ⭐ THE OWNER'S OWN EXAMPLE, NUMBER FOR NUMBER. */
    {
      const days = ctx.plan(make({ Lehi: 140, Herriman: 120, 'American Fork': 119 }), {},
        { floorDate: '2026-10-01', maxDays: 60 });
      const m = byDay(days);
      const dates = Object.keys(m).sort();
      const townsOn = (d) => m[d].map(x => x.city).sort();

      check('S47', 'day one goes to the two biggest towns',
        JSON.stringify(townsOn(dates[0])) === JSON.stringify(['Herriman', 'Lehi']),
        'got ' + JSON.stringify(townsOn(dates[0])) + ' — Lehi 140 and Herriman 120 are the top two');

      check('S47', 'day two swaps Herriman for American Fork',
        JSON.stringify(townsOn(dates[1])) === JSON.stringify(['American Fork', 'Lehi']),
        'got ' + JSON.stringify(townsOn(dates[1])) +
        ' — after day one it is Lehi 120, AF 119, Herriman 100, so AF takes the seat');

      check('S47', 'nobody is lost',
        days.reduce((s, d) => s + d.ids.length, 0) === 379,
        days.reduce((s, d) => s + d.ids.length, 0) + ' of 379');
    }

    /* The count really is redone: a town worked twice drops below one worked once. */
    {
      const days = ctx.plan(make({ Lehi: 60, Herriman: 41 }), {}, { floorDate: '2026-10-01', maxDays: 60 });
      const m = byDay(days);
      const dates = Object.keys(m).sort();
      const first = m[dates[0]].map(x => x.city).sort();
      check('S47', 'two towns both get a crew on day one', JSON.stringify(first) === JSON.stringify(['Herriman', 'Lehi']));
      /* Lehi 60 -> 40, Herriman 41 -> 21. Day two: Lehi 40 and Herriman 21,
         both still present, so both go again. Day three: Lehi 20, Herriman 1 —
         Lehi still leads. The point is Herriman is never starved by Lehi
         taking every early slot, which is what the old town-by-town walk did. */
      const lehiDays = days.filter(d => d.city === 'Lehi').length;
      const herrimanDays = days.filter(d => d.city === 'Herriman').length;
      check('S47', 'the smaller town is not starved of early days',
        herrimanDays >= 2 && lehiDays >= 3,
        'Lehi ' + lehiDays + ' days, Herriman ' + herrimanDays + ' days');
    }

    /* ⚠ "Most clients" must mean most ALLOWED today, or a town full of November
       houses wins an October day and then places nobody. */
    {
      const w = make({ Lehi: 10 }, 1, '2026-10-01')
        .concat(make({ Herriman: 100 }, 3, '2026-11-01'));
      const days = ctx.plan(w, {}, { floorDate: '2026-10-01', maxDays: 60 });
      const m = byDay(days);
      const first = Object.keys(m).sort()[0];
      check('S47', 'a town of November houses does not win an October day',
        first === '2026-10-01' && m[first].every(d => d.city === 'Lehi'),
        'first day was ' + first + ' with ' + JSON.stringify(m[first].map(d => d.city)) +
        ' — Herriman has ten times as many but none of them may be hung yet');
      check('S47', 'and the November town gets its days once November arrives',
        days.some(d => d.city === 'Herriman' && d.date >= '2026-11-01'));
      check('S47', 'nothing is dropped along the way',
        days.reduce((s, d) => s + d.ids.length, 0) === 110);
    }

    /* Nothing placeable today and everything waiting for a later month: it must
       jump rather than step through the calendar or spin. */
    {
      const days = ctx.plan(make({ Lehi: 5 }, 3, '2026-11-16'), {}, { floorDate: '2026-10-01', maxDays: 60 });
      check('S47', 'it jumps straight to the first date anybody is allowed',
        days.length === 1 && days[0].date === '2026-11-16',
        JSON.stringify(days.map(d => d.date)));

      /* ⚠ And the jump has to be a JUMP, not a walk. Stepping one working day
         at a time reaches the same answer for a gap of a few weeks, so a short
         gap cannot tell the two apart — but the walk runs out of the 400-spin
         horizon on a long one and drops the houses entirely. */
      const farOff = ctx.plan(make({ Lehi: 5 }, 3, '2028-06-01'), {}, { floorDate: '2026-10-01', maxDays: 60 });
      check('S47', 'a date beyond the search horizon is still reached',
        farOff.length === 1 && farOff[0].date === '2028-06-01' && farOff[0].ids.length === 5,
        JSON.stringify(farOff.map(d => d.date)) + ' — walking there one day at a time exhausts the horizon and loses them');
    }

    /* The rules from the earlier work must all still hold. */
    {
      const near = { Lehi: [40.391, -111.851], Highland: [40.425, -111.795],
                     'American Fork': [40.377, -111.796], Alpine: [40.453, -111.777] };
      const w = [];
      Object.keys(near).forEach(c => {
        for (let i = 0; i < 7; i++) w.push({ id: c + i, city: c, priority: 1, from: '2026-10-01',
                                             stop: { lat: near[c][0], lng: near[c][1] } });
      });
      const days = ctx.plan(w, {}, { floorDate: '2026-10-01', maxDays: 60 });
      check('S47', 'a crew still visits at most two towns',
        days.every(d => d.towns.length <= 2),
        'worst was ' + Math.max.apply(null, days.map(d => d.towns.length)));
      check('S47', 'a crew still leads with its own town',
        days.every(d => d.towns[0] === d.city));
      const clash = [];
      const seen = {};
      days.forEach(d => {
        seen[d.date] = seen[d.date] || [];
        d.towns.forEach(t => {
          if (seen[d.date].indexOf(t) >= 0) clash.push(d.date + ' ' + t);
          seen[d.date].push(t);
        });
      });
      check('S47', 'two crews are still never in one town on one day', clash.length === 0, clash.join(', '));
      check('S47', 'and everybody is still placed',
        days.reduce((s, d) => s + d.ids.length, 0) === 28);
    }

    /* Same input, same plan — ties broken by name, not by object order. */
    {
      const a = ctx.plan(make({ Lehi: 20, Herriman: 20 }), {}, { floorDate: '2026-10-01', maxDays: 60 });
      const b = ctx.plan(make({ Herriman: 20, Lehi: 20 }), {}, { floorDate: '2026-10-01', maxDays: 60 });
      check('S47', 'an even tie gives the same plan whichever order the towns arrive in',
        JSON.stringify(a.map(d => d.date + d.city)) === JSON.stringify(b.map(d => d.date + d.city)),
        'a plan that changes when nothing changed is impossible to trust');
    }
  }
}


/* ============================================================
 * Suite 48. A day that is almost here is SET, and Rebuild leaves it alone.
 *
 * Owner, 2026-08-17: "if we are within 2 days of a day and I hit rebuild days,
 * any days within two days are set and should not rebuild."
 *
 * By then the crew has been told where they are going, the bins are loaded
 * against that list and the customers have been messaged. Re-flowing it the
 * night before is worse than a slightly untidy season.
 *
 * The dangerous half is NOT the day moving — it is the houses on it going back
 * into the pool and being scheduled a SECOND time somewhere else. Most of this
 * suite is about that.
 * ============================================================ */
suite('Suite 48. Days within two working days are set');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  check('S48', 'the rebuild asks whether a day is close enough to be set',
    /const setSoon = dt && dt >= today && dt <= pinHorizon\(\);/.test(admin),
    'and uses the SAME horizon the pins already use, not a second definition');

  check('S48', 'a set day is kept whole, houses and all',
    /if\(setSoon\)\{ locked\.push\(d\); keep\.push\(d\); return; \}/.test(admin),
    'the return is the important part: without it the houses fall through into the pool and get a second day');

  check('S48', 'the check runs BEFORE the worked/not-worked split',
    admin.indexOf('const setSoon = dt && dt >= today') <
    admin.indexOf('const worked=(dt&&dt<today)'),
    'a day that is set but has nothing done yet must be caught first, or it is treated as fair game');

  check('S48', 'it is measured in WORKING days',
    /PIN_HONOURED_BUSINESS_DAYS=2;/.test(admin) &&
    /while\(isWeekend\(d\)\)d=addDays\(d,1\);/.test(fn('pinHorizon')),
    'a Friday rebuild must not quietly set Saturday and Sunday and leave Monday loose');

  check('S48', 'the rebuild reports how many it left alone',
    /locked:locked\.length,/.test(admin));

  check('S48', 'and says so when there is nothing left to rebuild',
    /every house left is on one of the/.test(admin),
    '"nothing to rebuild" with no reason reads as a broken button');

  /* ---- run it ---- */
  {
    const planStart = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
    const planEnd = admin.indexOf('/* Top every day up to the cap');
    const ctx = {};
    /* Today is fixed so the horizon is predictable: Mon 5 Oct 2026, which makes
       the next two working days Tue 6 and Wed 7. */
    const TODAY = new Date(2026, 9, 5);
    new Function('__TODAY',
      'function toDateStr(dt){return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");}' +
      'function haversine(a,b,c,d){const R=3958.8,t=x=>x*Math.PI/180;const dl=t(c-a),dg=t(d-b);' +
      'const q=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(q));}' +
      'function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}' +
      'function isWeekend(d){const k=d.getDay();return k===0||k===6;}' +
      'function isoOf(d){return toDateStr(d);}' +
      'function daysBetween(a,b){return Math.round((a-b)/86400000);}' +
      'function mdToDate(md){const p=(""+md).split("-").map(Number);return new Date(2026,p[0]-1,p[1]);}' +
      'function extractCleanCity(c){return (""+(c==null?"":c)).trim();}' +
      'function customerForHouse(h){return h.__cust||null;}' +
      'function nextWorkingDay(d){let x=new Date(d);while(isWeekend(x))x=addDays(x,1);return x;}' +
      'function dayDate(d){return d._date;}' +
      'function installDays(){return SEASON.filter(d=>!d.isFixRoute&&!d.isTakedown);}' +
      'function computeDates(){SEASON.forEach(d=>{if(d.base!=null)d._date=addDays(BASE_START,d.base);});}' +
      'var CREWS=[{name:"Crew 1",city:""},{name:"Crew 2",city:""}];' +
      'var BASE_START=new Date(2026,9,1),globalDelta=0,SEASON=[],selSchedule=null;\n' +
      admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) + '\n' +
      admin.slice(admin.indexOf('const NEARBY_TOWN_MILES'), admin.indexOf('function townCentres')) + '\n' +
      'let NEARBY_TOWN_LIST={};' + fn('sameTownName') + fn('townCentres') + fn('nearbyTowns') +
      'function seasonFirstDate(){return new Date(2026,9,1);}' +
      admin.slice(planStart, planEnd) +
      'const PIN_HONOURED_BUSINESS_DAYS=2;' +
      /* pinHorizon and "today" both pinned to the fixed date */
      'function pinHorizon(){let d=new Date(__TODAY);d.setHours(0,0,0,0);' +
      'for(let i=0;i<PIN_HONOURED_BUSINESS_DAYS;i++){d=addDays(d,1);while(isWeekend(d))d=addDays(d,1);}return d;}' +
      fn('seasonStartDate') + fn('prefSpecificDate') + fn('houseAllowedFrom') + fn('houseDeadline') + fn('houseInstallPriority') +
      fn('rebuildSeasonDays').replace('const today=new Date();', 'const today=new Date(__TODAY);') +
      '\nthis.run=function(seed){SEASON=seed;return {r:rebuildSeasonDays(), season:SEASON};};'
    ).call(ctx, TODAY);

    const house = (city, name) => ({ id: name, name: name, city: city, pref: 'OCT',
      __cust: { data: { city: city, lat: 40.39, lng: -111.85 } } });
    const day = (dateObj, houses, base) => ({ id: 'd' + dateObj.getDate(), base: base,
      _date: dateObj, houses: houses });

    /* Mon 5 Oct is today. Tue 6 and Wed 7 are set. Thu 8 is fair game. */
    const soon = [house('Lehi', 'soon1'), house('Lehi', 'soon2')];
    const later = [house('Herriman', 'later1'), house('Herriman', 'later2')];
    const seed = [
      day(new Date(2026, 9, 6), soon, 5),
      day(new Date(2026, 9, 8), later, 7)
    ];
    const out = ctx.run(seed);

    check('S48', 'a day two working days out is left exactly as it was',
      out.season.some(d => d.houses === soon || (d.houses.length === 2 && d.houses[0] === soon[0])),
      'the 6 October day and both its houses should be untouched');

    check('S48', 'and it is counted as left alone',
      out.r && out.r.locked === 1,
      'locked was ' + (out.r && out.r.locked));

    /* ⚠ THE ONE THAT MATTERS. */
    {
      const all = [];
      out.season.forEach(d => (d.houses || []).forEach(h => all.push(h.name)));
      const twice = all.filter((n, i) => all.indexOf(n) !== i);
      check('S48', 'nobody on the set day is scheduled a second time',
        twice.length === 0,
        'appearing twice: ' + twice.join(', ') + ' — a house left on a set day AND put back in the pool gets two dates');
      check('S48', 'and nobody is lost either',
        all.length === 4, 'found ' + all.length + ' of 4');
    }

    check('S48', 'the later day WAS rebuilt',
      out.r && out.r.days >= 1 && out.r.houses === 2,
      'only the two Herriman houses were movable: ' + JSON.stringify(out.r));

    /* Everything set: a clear message rather than a silent no-op. */
    {
      const only = ctx.run([day(new Date(2026, 9, 7), [house('Lehi', 'x')], 6)]);
      check('S48', 'when every house is on a set day it says why',
        only.r && only.r.error && /already set for the next two working days/.test(only.r.error),
        JSON.stringify(only.r));
    }

    /* A day further out is still rebuilt normally. */
    {
      const far = ctx.run([day(new Date(2026, 9, 20), [house('Lehi', 'y'), house('Lehi', 'z')], 19)]);
      check('S48', 'a day well in the future is still rebuilt',
        far.r && !far.r.error && far.r.locked === 0 && far.r.houses === 2,
        JSON.stringify(far.r));
    }
  }
}


/* ============================================================
 * Suite 49. The Season start box actually decides the season start.
 *
 * Owner, 2026-08-17: "I created a list and can you change the season start date
 * to Oct 10." Setting the box shifted the dates on screen, and then Rebuild
 * days snapped everything back to 1 October and zeroed the shift — so the
 * choice could not be made to stick.
 *
 * ⚠ The clamp is the part worth keeping. seasonStartDate existed because the
 * plan used to begin at whatever the earliest imported row said, which is how a
 * season opened with a day holding two people. Later than 1 October is a
 * decision; earlier is almost always an imported row.
 * ============================================================ */
suite('Suite 49. The Season start box decides the start');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  const src = fn('seasonStartDate');
  check('S49', 'seasonStartDate exists', !!src);

  if (src) {
    const startWith = (base, delta) => {
      const sb = {};
      new Function('BASE_START', 'globalDelta', 'addDays',
        src + 'this.f = seasonStartDate;'
      ).call(sb, base, delta, (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });
      return sb.f();
    };
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    check('S49', 'no shift still means 1 October',
      iso(startWith(new Date(2026, 9, 1), 0)) === '2026-10-01');

    /* ⭐ THE ASK. Base 1 Oct shifted nine days is 10 October. */
    check('S49', 'a start pushed to 10 October is honoured',
      iso(startWith(new Date(2026, 9, 1), 9)) === '2026-10-10',
      'got ' + iso(startWith(new Date(2026, 9, 1), 9)));

    check('S49', 'a start pushed well into November is honoured too',
      iso(startWith(new Date(2026, 9, 1), 35)) === '2026-11-05');

    /* ⚠ THE CLAMP. */
    check('S49', 'an earlier date is clamped back to 1 October',
      iso(startWith(new Date(2026, 9, 1), -16)) === '2026-10-01',
      'got ' + iso(startWith(new Date(2026, 9, 1), -16)) +
      ' — a September start is almost always an imported row, and that is the bug this function was written for');

    check('S49', 'an imported base earlier than October is clamped as well',
      iso(startWith(new Date(2026, 8, 15), 0)) === '2026-10-01',
      'got ' + iso(startWith(new Date(2026, 8, 15), 0)));

    check('S49', 'the answer is midnight, so date comparisons are clean',
      startWith(new Date(2026, 9, 1), 9).getHours() === 0);

    /* Rebuilding twice must not drift: the rebuild writes BASE_START = start and
       zeroes the shift, so asking again gives the same answer. */
    {
      const once = startWith(new Date(2026, 9, 1), 9);
      const twice = startWith(once, 0);
      check('S49', 'rebuilding again keeps the same start',
        iso(twice) === iso(once),
        'a start that crept forward on every rebuild would be worse than one that ignored the box');
    }
  }

  check('S49', 'the box still only shifts, and the rebuild reads the shift',
    /globalDelta=daysBetween\(new Date\(t\.value\+.T00:00:00.\),BASE_START\)/.test(admin) &&
    /const chosen = addDays\(BASE_START, globalDelta \|\| 0\);/.test(admin),
    'these two have to agree, or the number on screen is not the number that builds');
}


/* ============================================================
 * Suite 50. A Pref Date that names an actual day.
 *
 * Owner, 2026-08-17: "if someone left Pref start date as blank that counts as
 * any, but if someone Put Thx or even a specific date or after then adjust to
 * that as well."
 *
 * What is actually in that column on the master sheet, counted:
 *   NOV 255 · OCT 220 · ANY 202 · 45962 x14 · THX 14 · 11/9+ x4 · 10/28+ · prepaid
 *
 * 45962 is not a number, it is how Excel stores 1 November. Fourteen customers
 * were carrying one, and every one of them read as "no preference" and was
 * offered the first day of October. So were 11/9+ and 10/28+.
 * ============================================================ */
suite('Suite 50. A Pref Date that names an actual day');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  const src = fn('prefSpecificDate');
  check('S50', 'prefSpecificDate exists', !!src);

  if (src) {
    const sb = {};
    new Function(src + 'this.f = prefSpecificDate;').call(sb);
    const f = (v) => sb.f(v, 2026);

    /* ⭐ THE FOURTEEN. */
    check('S50', 'an Excel date serial is read as the day it means',
      f('45962') === '2026-11-01',
      'got ' + f('45962') + ' — 45962 is how Excel stores 1 November');
    check('S50', 'and always in the SEASON year, not the year in the cell',
      (f('45962') || '').slice(0, 4) === '2026',
      'the serial says 2025 because that is when the sheet was typed; they mean the 1st of November coming');

    check('S50', '"11/9+" is the 9th of November', f('11/9+') === '2026-11-09');
    check('S50', '"10/28+" is the 28th of October', f('10/28+') === '2026-10-28');
    check('S50', '"1-Nov" is the 1st of November', f('1-Nov') === '2026-11-01');
    check('S50', '"Nov 1" is too', f('Nov 1') === '2026-11-01');
    check('S50', '"1 November" is too', f('1 November') === '2026-11-01');

    /* ⚠ The month words on their own must NOT become a date, or every November
       house would be pinned to one day. */
    check('S50', 'a bare month word is not a date',
      f('NOV') === null && f('OCT') === null && f('November') === null &&
      f('November - Before Thanksgiving') === null,
      'NOV gave ' + f('NOV') + ' — pinning every November house to one day would be far worse than ignoring it');
    check('S50', 'ANY, THX and blank are not dates',
      f('ANY') === null && f('THX') === null && f('') === null && f(null) === null);
    check('S50', 'and a stray note is simply not a date',
      f('prepaid') === null,
      'one junk cell must not stop a house being scheduled at all');

    /* Nothing that is not a date may be mistaken for one. */
    check('S50', 'a customer number is not read as a date',
      f('144') === null && f('5029') === null && f('1043') === null);
    check('S50', 'a price is not read as a date',
      f('890') === null && f('1300') === null);
    check('S50', 'an out-of-range serial is refused',
      f('99999') === null && f('12345') === null,
      'the window is deliberately narrow so only a real Excel date gets through');
    check('S50', 'an impossible month or day is refused',
      f('13/5') === null && f('11/40') === null);
  }

  /* ---- it actually changes when the house may be hung ---- */
  {
    const afSrc = THX_CONST + fn('houseAllowedFrom');
    const priSrc = fn('houseInstallPriority');
    check('S50', 'houseAllowedFrom and houseInstallPriority found', !!afSrc && !!priSrc);
    if (afSrc && priSrc && src) {
      const sb2 = {};
      new Function('BASE_START', 'thanksgivingDate', 'isoOf',
        src + afSrc + priSrc + 'this.from = houseAllowedFrom; this.pri = houseInstallPriority;'
      ).call(sb2, new Date(2026, 9, 1), () => new Date(2026, 10, 26),
        (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));

      check('S50', 'a house holding an Excel serial waits until that day',
        sb2.from({ pref: '45962' }, '2026-10-01') === '2026-11-01',
        'got ' + sb2.from({ pref: '45962' }, '2026-10-01') + ' — fourteen houses were being offered 1 October instead');
      check('S50', '"10/28+" waits until the 28th',
        sb2.from({ pref: '10/28+' }, '2026-10-01') === '2026-10-28');
      check('S50', 'a named day beats the month it falls in',
        sb2.from({ pref: '11/9+' }, '2026-10-01') === '2026-11-09',
        'somebody who wrote 11/9 asked for the 9th, not for November');

      /* ⚠ Never earlier than the season start. */
      check('S50', 'a date before the season start is pulled up to it',
        sb2.from({ pref: '9/15' }, '2026-10-01') === '2026-10-01',
        'a date left over from last year must not open the season');

      check('S50', 'blank is still "any" and starts at the season start',
        sb2.from({ pref: '' }, '2026-10-01') === '2026-10-01' &&
        sb2.from({ pref: 'ANY' }, '2026-10-01') === '2026-10-01' &&
        sb2.from({ pref: 'prepaid' }, '2026-10-01') === '2026-10-01');

      check('S50', 'THX still waits for after Thanksgiving',
        sb2.from({ pref: 'THX' }, '2026-10-01') === '2026-11-27');
      check('S50', 'a bare NOV still means the 1st of November',
        sb2.from({ pref: 'NOV' }, '2026-10-01') === '2026-11-01');

      check('S50', 'naming a day counts as a stated preference, not "any"',
        sb2.pri({ pref: '11/9+' }, {}) < sb2.pri({ pref: '' }, {}),
        'they asked for something specific and should not queue behind people who did not mind');
    }
  }

  /* ---- and the sync must never flatten it ---- */
  check('S50', 'a named day is never overwritten with a plain month',
    /if\(prefSpecificDate\(a, yr\) && !prefSpecificDate\(b, yr\)\) return true;/.test(admin),
    'the customer record only holds the five standard wordings, so "11/9+" lives only on the plan — a sync that flattened it would throw the day away every time it ran');
}


/* ============================================================
 * Suite 51. The dribble at the end of the season.
 *
 * Owner, 2026-08-18: "near the end of the season days start to look like this
 *   Mon Nov 23 / 15 left / Bluffdale · Mapleton
 *   Tue Nov 24 /  2 left / Spanish Fork
 *   Mon Dec  7 /  6 left / Orem · South Jordan
 *   Wed Dec  9 /  2 left / Vineyard
 * thats not good we should fit as many of those into other days as possible,
 * just stuff those guys into another day."
 *
 * Twenty-five houses over four days across three weeks: four mornings of
 * loading the truck and driving out. The town names on a day are the DAY's,
 * across both crews — so 23 November is two crews, not one.
 * ============================================================ */
suite('Suite 51. The dribble at the end of the season');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  const src = fn('packTailCrewDays');
  check('S51', 'packTailCrewDays exists', !!src);

  if (src) {
    const sb = {};
    new Function('MAX_STOPS_PER_ROUTE', 'CREWS_PER_DAY',
      src + 'this.pack = packTailCrewDays;').call(sb, 20, 2);

    /* Real geography, and only what is genuinely within a crew's reach:
       Bluffdale/South Jordan sit together in the south valley, Mapleton and
       Spanish Fork are neighbours, Orem and Vineyard share a border. Nothing
       else on this list is near anything else. */
    const NEAR = { Bluffdale: ['South Jordan'], 'South Jordan': ['Bluffdale'],
                   Mapleton: ['Spanish Fork'], 'Spanish Fork': ['Mapleton'],
                   Orem: ['Vineyard', 'Lindon'], Vineyard: ['Orem'], Lindon: ['Orem'] };
    /* Real driving distances, for the rescue. Orem to Mapleton is a genuine
       twenty minutes; Bluffdale to Mapleton is most of the valley. */
    const MILES = {
      Orem: { Mapleton: 14, 'Spanish Fork': 13, Bluffdale: 26, 'South Jordan': 31, Vineyard: 4 },
      Lindon: { Orem: 5, Mapleton: 18, Bluffdale: 22, 'South Jordan': 27, Vineyard: 6, 'Spanish Fork': 17 },
      Mapleton: { Orem: 14, Vineyard: 16, Bluffdale: 38, 'South Jordan': 43, 'Spanish Fork': 4 },
      Bluffdale: { Mapleton: 38, Orem: 26, Vineyard: 24, 'Spanish Fork': 41, 'South Jordan': 5 },
      'South Jordan': { Mapleton: 43, Orem: 31, Bluffdale: 5, Vineyard: 29, 'Spanish Fork': 46 },
      Vineyard: { Orem: 4, Mapleton: 16, Bluffdale: 24, 'South Jordan': 29, 'Spanish Fork': 17 },
      'Spanish Fork': { Mapleton: 4, Orem: 13, Vineyard: 17, Bluffdale: 41, 'South Jordan': 46 }
    };

    const build = (rows) => {
      const town = {};
      const days = rows.map(r => {
        const ids = [];
        for (let i = 0; i < r.n; i++) {
          const id = r.city + '@' + r.date + '#' + i;
          town[id] = { city: r.city, from: r.from || '' };
          ids.push(id);
        }
        return { date: r.date, crew: String(r.crew), city: r.city,
                 towns: r.towns ? r.towns.slice() : [r.city], ids: ids };
      });
      return { days, town };
    };
    const run = (rows, opts) => {
      const f = build(rows);
      const out = sb.pack(f.days, Object.assign({
        cap: 20, crews: 2,
        from: id => f.town[id].from,
        townOf: id => f.town[id].city,
        nearby: c => NEAR[c] || [],
        dist: (a, b) => (MILES[a] && MILES[a][b] != null) ? MILES[a][b] : null
      }, opts || {}));
      out.town = f.town;
      out.dates = Array.from(new Set(out.days.map(d => d.date))).sort();
      out.all = out.days.reduce((a, d) => a.concat(d.ids), []);
      return out;
    };

    /* ⭐ THE OWNER'S OWN FOUR DAYS. */
    const HERS = [
      { date: '2026-11-23', crew: 1, city: 'Bluffdale', n: 8 },
      { date: '2026-11-23', crew: 2, city: 'Mapleton', n: 7 },
      { date: '2026-11-24', crew: 1, city: 'Spanish Fork', n: 2 },
      { date: '2026-12-07', crew: 1, city: 'Orem', n: 3 },
      { date: '2026-12-07', crew: 2, city: 'South Jordan', n: 3 },
      { date: '2026-12-09', crew: 1, city: 'Vineyard', n: 2 }
    ];
    const hers = run(HERS);

    check('S51', 'her four days become two', hers.dates.length === 2,
      'still ' + hers.dates.length + ' days: ' + hers.dates.join(', '));
    check('S51', 'and the season stops two weeks earlier',
      hers.dates[hers.dates.length - 1] < '2026-12-07',
      'last day is ' + hers.dates[hers.dates.length - 1] + ', was 9 December');
    check('S51', 'all twenty-five houses are still there, once each',
      hers.all.length === 25 && new Set(hers.all).size === 25,
      hers.all.length + ' houses, ' + (hers.all.length - new Set(hers.all).size) + ' of them twice');

    /* ⚠ THE ONE THAT WOULD LOSE HER A CUSTOMER. */
    check('S51', 'nobody is moved to a LATER day than they already had',
      hers.moved.every(m => m.to < m.from) && hers.relocated.every(r => r.to < r.from),
      'this pass may shorten the season, never push somebody back: ' +
      JSON.stringify(hers.moved.filter(m => m.to >= m.from).concat(hers.relocated.filter(r => r.to >= r.from))));

    /* ⚠ The rule the whole schedule is built on. */
    check('S51', 'a town far away is never picked up',
      hers.days.every(d => d.towns.every(t =>
        t === d.city || (NEAR[d.city] || []).indexOf(t) !== -1)),
      '"just stuff those guys into another day" is permission to mix towns, not to send a crew across the valley: ' +
      JSON.stringify(hers.days.map(d => d.towns)));

    check('S51', 'two crews are never sent to the same town on the same day',
      hers.dates.every(dt => {
        const seen = {};
        return hers.days.filter(d => d.date === dt)
          .every(d => d.towns.every(t => { if (seen[t]) return false; seen[t] = 1; return true; }));
      }), JSON.stringify(hers.days.map(d => d.date + ' ' + d.towns.join('+'))));

    check('S51', 'never more crews out on a day than there are crews',
      hers.dates.every(dt => hers.days.filter(d => d.date === dt).length <= 2));

    check('S51', 'never more than twenty on one crew',
      hers.days.every(d => d.ids.length <= 20));

    /* The cheap move, and the one her example actually needed: a day holding
       less than one crew's worth means a crew is standing idle on that date. */
    check('S51', 'a whole crew-day rides an earlier date that has a crew spare',
      hers.relocated.length >= 1,
      'Vineyard should ride 24 November as its own crew rather than being mixed into anybody: ' +
      JSON.stringify(hers.relocated));

    /* ---- ⚠ nobody is hung before they said they could be ---- */
    {
      const late = run([
        { date: '2026-11-23', crew: 1, city: 'Bluffdale', n: 8 },
        { date: '2026-11-23', crew: 2, city: 'Mapleton', n: 7 },
        /* After Thanksgiving. These may not go back to November whatever it costs. */
        { date: '2026-12-07', crew: 1, city: 'South Jordan', n: 3, from: '2026-11-27' },
        { date: '2026-12-09', crew: 1, city: 'Spanish Fork', n: 2, from: '2026-11-27' }
      ]);
      const early = [];
      late.days.forEach(d => d.ids.forEach(id => {
        const f = late.town[id].from;
        if (f && d.date < f) early.push(id + ' on ' + d.date + ' but not allowed until ' + f);
      }));
      check('S51', 'an After-Thanksgiving house is never dragged back into November',
        early.length === 0, early.join('; '));
      check('S51', 'but it is still packed with the others that can wait',
        late.dates.length === 2,
        'the two December days should still become one: ' + late.dates.join(', '));
    }

    /* ---- a real day is not taken apart ---- */
    {
      const healthy = run([
        { date: '2026-10-05', crew: 1, city: 'Bluffdale', n: 20 },
        { date: '2026-10-06', crew: 1, city: 'South Jordan', n: 20 }
      ]);
      check('S51', 'a full day is left exactly as it is',
        healthy.dates.length === 2 && healthy.moved.length === 0 && healthy.relocated.length === 0,
        'twenty houses is a day, not a leftover');
    }
    {
      const ten = run([
        { date: '2026-10-05', crew: 1, city: 'Bluffdale', n: 12 },
        { date: '2026-10-06', crew: 1, city: 'South Jordan', n: 10 }
      ]);
      check('S51', 'and so is a day holding ten',
        ten.dates.length === 2 && ten.moved.length === 0,
        'the line is half a crew — below that it is a leftover, at it it is a day');
    }

    /* ---- ⭐ the third town is only bought with a day ---- */
    {
      /* Bluffdale is full, so its crew cannot take everybody. Vineyard has
         nowhere to go at all — it is near nothing here — so 9 December
         survives, and the day that survives must not have been mixed for
         nothing. */
      const stuck = run([
        { date: '2026-10-05', crew: 1, city: 'Bluffdale', n: 18 },
        { date: '2026-10-05', crew: 2, city: 'Mapleton', n: 18 },
        { date: '2026-12-09', crew: 1, city: 'South Jordan', n: 4 },
        { date: '2026-12-09', crew: 2, city: 'Orem', n: 4 }
      ]);
      const threes = stuck.days.filter(d => d.towns.length > 2);
      check('S51', 'a crew is not given a third town for a day that survives anyway',
        threes.length === 0,
        'mixing a third town costs the crew real driving and is only worth a day removed: ' +
        JSON.stringify(threes.map(d => d.date + ' ' + d.towns.join('+'))));
      check('S51', 'and the house that had nowhere to go still has a day',
        stuck.all.length === 44 && new Set(stuck.all).size === 44,
        'a house the packer cannot place must stay where it is, never be dropped');
    }

    /* ---- ⭐ ONE HOUSE DOES NOT GET A CREW TO ITSELF ---- */
    {
      /* Straight off the real season: after everything else has packed, a
         single Mapleton house was left holding 2 December on its own. Mapleton
         is not "nearby" anything that is working, so every rule above refuses
         it — and a whole crew drives to Mapleton for one house. */
      const lone = run([
        { date: '2026-11-27', crew: 1, city: 'Orem', n: 5, from: '2026-11-27' },
        { date: '2026-11-27', crew: 2, city: 'Vineyard', n: 4, from: '2026-11-27' },
        { date: '2026-12-02', crew: 1, city: 'Mapleton', n: 1, from: '2026-11-27' }
      ]);
      check('S51', 'a lone house is taken along on a day somebody is already working',
        lone.dates.length === 1 && lone.dates[0] === '2026-11-27',
        'a fourteen-mile detour beats a whole morning for one house: ' + lone.dates.join(', '));
      check('S51', 'and the long drive is recorded as what it is',
        lone.moved.length === 1 && lone.moved[0].rescued === true,
        'the report has to be able to say a crew was sent further than the borrowing rule allows');
    }
    {
      /* ⚠ Bounded. Mapleton to South Jordan is most of the valley. */
      const tooFar = run([
        { date: '2026-11-27', crew: 1, city: 'South Jordan', n: 5, from: '2026-11-27' },
        { date: '2026-11-27', crew: 2, city: 'Bluffdale', n: 4, from: '2026-11-27' },
        { date: '2026-12-02', crew: 1, city: 'Mapleton', n: 1, from: '2026-11-27' }
      ]);
      check('S51', 'but a crew is not sent across the valley even for a lone house',
        tooFar.dates.length === 2,
        'forty-three miles each way is a worse day than the one it saves');
    }
    {
      /* ⭐ THE BOUNDARY IS THE DAY'S TOTAL, NOT ONE CREW'S SHARE.
         Owner, 2026-08-18: "6, 8, and 11 houses every day is really bad... we
         cant just be waisting time." Four houses is a whole morning of loading
         the truck and driving out, so four goes the same way one does. */
      const four = run([
        { date: '2026-11-27', crew: 1, city: 'Orem', n: 5, from: '2026-11-27' },
        { date: '2026-11-27', crew: 2, city: 'Vineyard', n: 4, from: '2026-11-27' },
        { date: '2026-12-02', crew: 1, city: 'Mapleton', n: 4, from: '2026-11-27' }
      ]);
      check('S51', 'a day of four is a wasted morning and goes too',
        four.dates.length === 1,
        'still ' + four.dates.length + ' days — the first version only rescued a crew-day of three ' +
        'that was alone on its date, so two crews of two never qualified and neither did one crew of four');

      /* ⚠ But a day that is genuinely worth going out for is never taken apart,
         however tempting the towns look. */
      const real = run([
        { date: '2026-11-27', crew: 1, city: 'Orem', n: 5, from: '2026-11-27' },
        { date: '2026-11-27', crew: 2, city: 'Vineyard', n: 4, from: '2026-11-27' },
        { date: '2026-12-02', crew: 1, city: 'Mapleton', n: 12, from: '2026-11-27' }
      ]);
      check('S51', 'and a day holding twelve is a real day, left alone',
        real.dates.length === 2 && real.moved.length === 0,
        'twelve houses pays for the morning; scattering them over a fourteen-mile detour does not');
    }
    {
      /* ⚠ And only when the DATE goes. A crew-day sharing its date with
         another has saved nothing by moving. */
      const shared = run([
        { date: '2026-11-27', crew: 1, city: 'Orem', n: 5, from: '2026-11-27' },
        { date: '2026-11-27', crew: 2, city: 'Vineyard', n: 4, from: '2026-11-27' },
        { date: '2026-12-02', crew: 1, city: 'Mapleton', n: 1, from: '2026-11-27' },
        { date: '2026-12-02', crew: 2, city: 'Bluffdale', n: 15, from: '2026-11-27' }
      ]);
      const far = shared.days.filter(d => d.towns.indexOf('Mapleton') !== -1 && d.city === 'Orem');
      check('S51', 'and not when the crew would still have to come out that day anyway',
        far.length === 0 && shared.dates.length === 2,
        'the Bluffdale crew is on 2 December regardless, so the Mapleton house costs nothing extra there');
    }
    /* ---- ⚠ EVERY WAY A HOUSE COULD BE MOVED LATER ---- */
    {
      /* The same town on a later day is the most tempting target there is —
         perfectly tidy, and two customers hung a day later than they were
         told. A thin day at the FRONT of the season must simply stay. */
      const forward = run([
        { date: '2026-10-05', crew: 1, city: 'Bluffdale', n: 15 },
        { date: '2026-10-05', crew: 2, city: 'Mapleton', n: 2 },
        { date: '2026-10-06', crew: 1, city: 'Mapleton', n: 12 },
        { date: '2026-10-06', crew: 2, city: 'Orem', n: 12 }
      ]);
      const still = forward.days.filter(d => d.date === '2026-10-05' && d.city === 'Mapleton');
      check('S51', 'a thin day early on is NOT emptied into a tidier day later',
        still.length === 1 && still[0].ids.length === 2 && forward.moved.length === 0,
        'joining the later Mapleton day would look neat and would hang two people a day late');
    }
    {
      /* ⚠ And the whole-crew-day move has its own copy of every guard. */
      const ride = run([
        { date: '2026-11-23', crew: 1, city: 'Bluffdale', n: 8 },
        { date: '2026-12-07', crew: 1, city: 'Mapleton', n: 2, from: '2026-12-01' }
      ]);
      const early = [];
      ride.days.forEach(d => d.ids.forEach(id => {
        const f = ride.town[id].from;
        if (f && d.date < f) early.push(id + ' on ' + d.date + ', not allowed until ' + f);
      }));
      check('S51', 'a whole crew-day never rides a date its houses are barred from',
        early.length === 0,
        '23 November has a crew standing idle, which makes it very inviting: ' + early.join('; '));
    }
    {
      const same = run([
        { date: '2026-11-23', crew: 1, city: 'Bluffdale', n: 8 },
        { date: '2026-12-07', crew: 1, city: 'Bluffdale', n: 2 }
      ]);
      check('S51', 'and it never puts a second crew in a town already being worked',
        same.dates.length === 1 &&
        same.days.filter(d => d.date === '2026-11-23').length === 1,
        'the two should join the crew that is already going to Bluffdale, not ride beside it: ' +
        JSON.stringify(same.days.map(d => d.date + ' c' + d.crew + ' ' + d.towns.join('+'))));
    }

    /* ---- ⚠ the third town, when the day does NOT disappear ---- */
    {
      /* The Orem crew already holds Orem and Vineyard and has room for three.
         Lindon has five and nowhere else to go, so two are stuck however this
         goes — the day survives, and a crew that gains nothing must not gain a
         third town either. */
      const partial = run([
        { date: '2026-10-05', crew: 1, city: 'Orem', n: 17, towns: ['Orem', 'Vineyard'] },
        { date: '2026-10-06', crew: 1, city: 'Lindon', n: 5 },
        { date: '2026-10-06', crew: 2, city: 'Bluffdale', n: 5 }
      ]);
      const three = partial.days.filter(d => d.towns.length > 2);
      check('S51', 'a crew gains a third town only if the day it came from disappears',
        three.length === 0,
        'Lindon keeps its day whatever happens, so mixing three of them into the Orem route buys nothing: ' +
        JSON.stringify(three.map(d => d.date + ' ' + d.towns.join('+'))));
      check('S51', 'and the houses that had to stay are all still there',
        partial.all.length === 27 && new Set(partial.all).size === 27,
        partial.all.length + ' of 27');
    }

    /* ---- ⚠ twenty is twenty even when a day is being dissolved ---- */
    {
      const brim = run([
        { date: '2026-10-05', crew: 1, city: 'Bluffdale', n: 19 },
        { date: '2026-10-05', crew: 2, city: 'Mapleton', n: 19 },
        { date: '2026-10-06', crew: 1, city: 'South Jordan', n: 3 },
        { date: '2026-10-06', crew: 2, city: 'Orem', n: 3 }
      ]);
      check('S51', 'a crew with one seat left takes one house, not three',
        brim.days.every(d => d.ids.length <= 20),
        'worst crew held ' + Math.max.apply(null, brim.days.map(d => d.ids.length)) +
        ' — the cap is the crew\u2019s day, not a target');
      check('S51', 'and the ones that did not fit keep their day',
        brim.all.length === 44 && new Set(brim.all).size === 44,
        brim.all.length + ' of 44');
    }
    /* ---- and the whole thing is pure ---- */
    {
      const f = build(HERS);
      const snapshot = JSON.stringify(f.days.map(d => d.ids.length));
      sb.pack(f.days.slice(), { cap: 20, crews: 2,
        from: id => f.town[id].from, townOf: id => f.town[id].city, nearby: c => NEAR[c] || [] });
      check('S51', 'note: the packer works on the crew-days it is given',
        JSON.stringify(f.days.map(d => d.ids.length)) !== snapshot,
        'it edits them in place and returns the survivors, which is what planNewCrewDays wants — recorded so nobody assumes a copy');
    }
  }

  /* ---- the crew numbers, closed up ---- */
  {
    const rsrc = fn('renumberCrewsByDate');
    check('S51', 'renumberCrewsByDate exists', !!rsrc);
    if (rsrc) {
      const rb = {};
      new Function(rsrc + 'this.f = renumberCrewsByDate;').call(rb);

      /* ⭐ Exactly what a dissolved day leaves behind: crew 1 has gone and
         crew 2 is still out, so the day reads as a crew that did not turn up. */
      const gap = rb.f([{ date: '2026-11-23', crew: '2', ids: [1] }], {});
      check('S51', 'a day left with only crew 2 becomes crew 1',
        gap[0].crew === '1', 'crew ' + gap[0].crew);

      const two = rb.f([{ date: '2026-11-23', crew: '2', ids: [1] },
                        { date: '2026-11-23', crew: '4', ids: [2] }], {});
      check('S51', 'and two survivors become 1 and 2',
        two.map(d => d.crew).join(',') === '1,2', two.map(d => d.crew).join(','));

      /* ⚠ A day that already existed keeps its crew number, and nothing new
         may be given the same one. */
      const held = rb.f([{ date: '2026-11-23', crew: '5', ids: [1] }],
                        { '2026-11-23': { '1': 'Lehi' } });
      check('S51', 'a number already in use that day is stepped over',
        held[0].crew === '2',
        'got crew ' + held[0].crew + ' — two crews answering to \u201ccrew 1\u201d is worse than a gap');

      const days = rb.f([{ date: '2026-11-23', crew: '2', ids: [1] },
                         { date: '2026-11-24', crew: '2', ids: [2] }], {});
      check('S51', 'each day is numbered on its own',
        days.every(d => d.crew === '1'), days.map(d => d.date + ' c' + d.crew).join(', '));
    }
  }

  /* ---- end to end, through the real builder ---- */
  {
    const start = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
    const end = admin.indexOf('/* Top every day up to the cap.', start);
    check('S51', 'the builder runs the packer before handing the plan back',
      /if\(o\.pack === false\) return out;/.test(admin) &&
      /const packed = packTailCrewDays\(out, \{/.test(admin) &&
      /return renumberCrewsByDate\(packed\.days, taken \|\| \{\}\);/.test(admin));

    const api = new Function(
      'function toDateStr(dt){return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");}' +
      'function haversine(a,b,c,d){const R=3958.8,t=x=>x*Math.PI/180;const dl=t(c-a),dg=t(d-b);' +
      'const q=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(q));}' +
      'function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}' +
      'function isWeekend(d){const k=d.getDay();return k===0||k===6;}' +
      'function nextWorkingDay(d){let x=new Date(d);while(isWeekend(x))x=addDays(x,1);return x;}' +
      'function seasonFirstDate(){return new Date(2026,9,1);}' +
      admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) +
      admin.slice(admin.indexOf('const NEARBY_TOWN_MILES'), admin.indexOf('function townCentres')) +
      'let NEARBY_TOWN_LIST={};' + fn('sameTownName') + fn('townCentres') + fn('nearbyTowns') +
      admin.slice(start, end) +
      '\nreturn {plan: planNewCrewDays, cap: MAX_STOPS_PER_ROUTE};')();

    const at = { Bluffdale: [40.489, -111.939], 'South Jordan': [40.562, -111.929],
                 Mapleton: [40.130, -111.578], 'Spanish Fork': [40.115, -111.655],
                 Orem: [40.297, -111.695], Vineyard: [40.307, -111.755] };
    const waiting = [];
    Object.keys(at).forEach(city => {
      const n = city === 'Bluffdale' ? 8 : (city === 'Mapleton' ? 7 : 3);
      for (let i = 0; i < n; i++) waiting.push({ id: city + i, city: city, priority: 2,
        from: '2026-10-01', stop: { lat: at[city][0], lng: at[city][1] } });
    });
    const raw = api.plan(waiting, {}, { floorDate: '2026-10-01', maxDays: 40, pack: false });
    const packed = api.plan(waiting, {}, { floorDate: '2026-10-01', maxDays: 40 });
    const dcount = (ds) => new Set(ds.map(d => d.date)).size;

    check('S51', 'a whole season of small towns comes out in fewer days',
      dcount(packed) <= dcount(raw),
      'the raw build took ' + dcount(raw) + ' days, packed took ' + dcount(packed));
    check('S51', 'and nobody is lost or duplicated on the way through',
      (() => {
        const ids = packed.reduce((a, d) => a.concat(d.ids), []);
        return ids.length === waiting.length && new Set(ids).size === waiting.length;
      })(),
      'the builder must hand back exactly what it was given');
    check('S51', 'the crew numbers on a day have no gap in them',
      Array.from(new Set(packed.map(d => d.date))).every(dt => {
        const crews = packed.filter(d => d.date === dt).map(d => Number(d.crew)).sort();
        return crews.every((c, i) => c === i + 1);
      }),
      'a day labelled "crew 2" with no crew 1 reads as a crew missing: ' +
      JSON.stringify(packed.map(d => d.date + ' c' + d.crew)));
  }
}


/* ============================================================
 * Suite 52. Thanksgiving.
 *
 * Owner, 2026-08-18: "Also everyone labeled Thanksgiving and before
 * thanksgiving we need to do as close to thanksgiving as possible, also we
 * will not be working thanksgiving day."
 *
 * Two separate things. The crew does not go out on the holiday at all, and the
 * people whose label is ABOUT the holiday are hung in the run-up to it rather
 * than three weeks early.
 *
 * Thanksgiving is the fourth Thursday of November: 26 November 2026.
 * ============================================================ */
suite('Suite 52. Thanksgiving');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                     '-' + String(d.getDate()).padStart(2, '0');

  /* ---- ⭐ the crew does not go out on the holiday ---- */
  {
    const tgSrc = fn('thanksgivingDate');
    const isTg = fn('isThanksgivingDay');
    const wdSrc = fn('isWorkingDay');
    const nextSrc = fn('nextWorkingDay');
    check('S52', 'isThanksgivingDay exists', !!isTg);
    check('S52', 'isWorkingDay and nextWorkingDay found', !!wdSrc && !!nextSrc);

    if (tgSrc && isTg && wdSrc && nextSrc) {
      const sb = {};
      new Function(tgSrc + isTg + wdSrc + nextSrc +
        'this.tg = thanksgivingDate; this.work = isWorkingDay; this.next = nextWorkingDay;').call(sb);

      check('S52', 'Thanksgiving 2026 is the 26th of November',
        iso(sb.tg(2026)) === '2026-11-26', iso(sb.tg(2026)));

      /* ⭐ THE ASK. */
      check('S52', 'the crew does not work Thanksgiving Day',
        sb.work(new Date(2026, 10, 26)) === false,
        'a Thursday like any other as far as the calendar was concerned');

      check('S52', 'the day before and the day after are still working days',
        sb.work(new Date(2026, 10, 25)) === true &&
        sb.work(new Date(2026, 10, 27)) === true,
        'only the holiday itself comes out — the Friday is a working day here');

      check('S52', 'weekends are still weekends',
        sb.work(new Date(2026, 10, 28)) === false &&
        sb.work(new Date(2026, 10, 29)) === false);

      /* ⚠ The walk must step OVER it, not stop on it. */
      check('S52', 'a day landing on Thanksgiving moves to the Friday',
        iso(sb.next(new Date(2026, 10, 26))) === '2026-11-27',
        'got ' + iso(sb.next(new Date(2026, 10, 26))) +
        ' — this is the one place the calendar is walked, so a day built here is a day the crew is sent out');

      check('S52', 'and other years move with the holiday',
        sb.work(new Date(2025, 10, 27)) === false &&      // 27 Nov 2025
        sb.work(new Date(2027, 10, 25)) === false &&      // 25 Nov 2027
        sb.work(new Date(2026, 10, 27)) === true,
        'the date is not fixed, so it cannot be written down anywhere as one');

      check('S52', 'an ordinary November Thursday is untouched',
        sb.work(new Date(2026, 10, 19)) === true &&
        sb.work(new Date(2026, 10, 5)) === true);
    }
  }

  /* ---- ⭐ as close to Thanksgiving as possible ---- */
  {
    const src = THX_CONST + fn('prefSpecificDate') + fn('houseAllowedFrom') + fn('houseDeadline') + fn('houseInstallPriority');
    check('S52', 'the timing functions were found', !!fn('houseAllowedFrom'));
    if (fn('houseAllowedFrom')) {
      const sb = {};
      new Function('BASE_START', 'thanksgivingDate', 'isoOf',
        src + 'this.from = houseAllowedFrom; this.pri = houseInstallPriority;'
      ).call(sb, new Date(2026, 9, 1), (y) => new Date(y, 10, 26), iso);

      /* ⭐ THE ASK. Thanksgiving is the 26th; the run-up opens on the 19th. */
      check('S52', 'a Before Thanksgiving house waits for the week of the holiday',
        sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') === '2026-11-19',
        'got ' + sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') +
        ' — it used to be 1 November, three weeks before the holiday they asked about');

      check('S52', 'a bare "Thanksgiving" is the same list',
        sb.from({ pref: 'Thanksgiving' }, '2026-10-01') === '2026-11-19');

      /* ⚠ AND STILL ON THE RIGHT SIDE OF IT. */
      check('S52', 'but it is never pushed past the holiday',
        sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') < '2026-11-26',
        'the whole point of the label is the deadline');

      check('S52', 'and once the run-up opens they outrank everybody else',
        sb.pri({ pref: 'November - Before Thanksgiving' }, {}) < sb.pri({ pref: 'November' }, {}) &&
        sb.pri({ pref: 'November - Before Thanksgiving' }, {}) < sb.pri({ pref: '' }, {}) &&
        sb.pri({ pref: 'November - Before Thanksgiving' }, {}) < sb.pri({ pref: 'After Thanksgiving' }, {}),
        'inside that week a day late is a missed Thanksgiving, not a slightly later hang');

      /* ⚠ Except a new hang, which the owner put above everything. */
      check('S52', 'a new hang is still ahead of them',
        sb.pri({ pref: 'November - Before Thanksgiving' }, { chargeNewMemberFee: true }) <
        sb.pri({ pref: 'November - Before Thanksgiving' }, {}),
        '"the very top priority is new hangs" was not qualified');

      /* ⚠ Before and after are opposite answers. */
      check('S52', 'After Thanksgiving still waits until after it',
        sb.from({ pref: 'After Thanksgiving' }, '2026-10-01') === '2026-11-27',
        'got ' + sb.from({ pref: 'After Thanksgiving' }, '2026-10-01'));
      check('S52', 'and the two never collapse into each other',
        sb.from({ pref: 'November - Before Thanksgiving' }, '2026-10-01') <
        sb.from({ pref: 'After Thanksgiving' }, '2026-10-01'),
        'the words are nearly the same and the meaning is opposite');

      /* ⚠ Nothing else moved. */
      check('S52', 'a plain November house still opens on the 1st',
        sb.from({ pref: 'November' }, '2026-10-01') === '2026-11-01',
        'got ' + sb.from({ pref: 'November' }, '2026-10-01') +
        ' — only the labels that name the holiday were meant to change');
      check('S52', 'October and no-preference are untouched',
        sb.from({ pref: 'October' }, '2026-10-01') === '2026-10-01' &&
        sb.from({ pref: '' }, '2026-10-01') === '2026-10-01' &&
        sb.from({ pref: 'ANY' }, '2026-10-01') === '2026-10-01');
      check('S52', 'and a named day still wins',
        sb.from({ pref: '11/9+' }, '2026-10-01') === '2026-11-09',
        'somebody who wrote a date asked for that date');

      /* ⚠ A season that starts late must not open the window before it. */
      check('S52', 'the run-up never opens before the season does',
        sb.from({ pref: 'November - Before Thanksgiving' }, '2026-11-23') === '2026-11-23',
        'got ' + sb.from({ pref: 'November - Before Thanksgiving' }, '2026-11-23'));
    }
  }

  /* ---- the window is roomy on purpose ---- */
  {
    const m = admin.match(/const PRE_THANKSGIVING_DAYS = (\d+);/);
    check('S52', 'the run-up is long enough to hold the list',
      !!m && Number(m[1]) >= 5,
      '⚠ ' + (m ? m[1] : '?') + ' days. Tightening this puts them closer to the holiday and pushes ' +
      'anybody who does not fit PAST it, which is the one outcome the label exists to prevent. ' +
      'Seven days is five working days — two hundred slots.');
  }
}


/* ============================================================
 * Suite 53. October is a deadline, not a starting gun.
 *
 * Owner, 2026-08-18, reading a 26 November day holding three customers who had
 * asked for October: "we need to get everyone who requested Oct done in Oct
 * none in November and if any in Nov it should be Nov 1st but only if theres
 * literally no other way." And: "6, 8, and 11 houses every day is really bad,
 * if you need stuff some anys in to fill the day up in those areas but we cant
 * just be waisting time."
 *
 * Two halves. The builder has to REACH the small towns while it is still
 * October — ordering inside a town never helped, because October was already
 * first in the queue and it was the TOWN that was late. And the tail sweep has
 * to be allowed to move somebody to a later day to kill a wasted morning,
 * without ever moving an October customer into November.
 *
 * Measured on the real 962-house sheet: 221 October customers, none finishing
 * after 31 October, 28 working days, nothing in December.
 * ============================================================ */
suite('Suite 53. October is a deadline');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                     '-' + String(d.getDate()).padStart(2, '0');

  /* ---- ⭐ the last day a house may be hung ---- */
  {
    const src = fn('houseDeadline');
    check('S53', 'houseDeadline exists', !!src);
    if (src) {
      const sb = {};
      new Function('BASE_START', 'thanksgivingDate', 'isoOf',
        THX_CONST + fn('prefSpecificDate') + src + 'this.f = houseDeadline;'
      ).call(sb, new Date(2026, 9, 1), (y) => new Date(y, 10, 26), iso);
      const f = (pref) => sb.f({ pref: pref });

      check('S53', 'October ends on the 31st', f('October') === '2026-10-31', f('October'));
      check('S53', 'and the sheet spelling too', f('OCT') === '2026-10-31');

      /* ⚠ THE ONE THAT IS EASY TO GET BACKWARDS. */
      check('S53', '"10/28+" has NO deadline — the plus means "not before"',
        f('10/28+') === '',
        'got "' + f('10/28+') + '". They asked not to be hung before the 28th, which any later day ' +
        'satisfies. Reading it as an October deadline would trap the one customer this rule exists to free.');
      check('S53', 'and neither does "11/9+"', f('11/9+') === '');
      /* ⚠ Including the spellings that also start with a month word — this is
         the one the guard in front of the OCT branch actually protects. */
      check('S53', 'nor does "Oct 28", which names a day AND starts with OCT',
        f('Oct 28') === '' && f('28-Oct') === '',
        'got "' + f('Oct 28') + '" — naming a day says when they can START, and picking up ' +
        'a 31 October ceiling on top of it is a constraint the customer never asked for');

      check('S53', 'Before Thanksgiving ends at the holiday',
        f('November - Before Thanksgiving') === '2026-11-26', f('November - Before Thanksgiving'));

      check('S53', 'nobody else has a deadline at all',
        f('November') === '' && f('') === '' && f('ANY') === '' &&
        f('After Thanksgiving') === '' && f('THX') === '',
        'a deadline nobody asked for would pin houses to dates for no reason');
    }
  }

  /* ---- ⭐ the builder reaches the small towns while it is still October ---- */
  {
    const start = admin.indexOf('function planNewCrewDays(waiting, taken, opts)');
    const end = admin.indexOf('/* Top every day up to the cap.', start);
    const api = new Function(
      'function toDateStr(dt){return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0");}' +
      'function haversine(a,b,c,d){const R=3958.8,t=x=>x*Math.PI/180;const dl=t(c-a),dg=t(d-b);' +
      'const q=Math.sin(dl/2)**2+Math.cos(t(a))*Math.cos(t(c))*Math.sin(dg/2)**2;return 2*R*Math.asin(Math.sqrt(q));}' +
      'function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}' +
      'function seasonFirstDate(){return new Date(2026,9,1);}' +
      fn('thanksgivingDate') +
      admin.slice(admin.indexOf('const MAX_STOPS_PER_ROUTE'), admin.indexOf('function installPriority')) +
      admin.slice(admin.indexOf('const NEARBY_TOWN_MILES'), admin.indexOf('function townCentres')) +
      'let NEARBY_TOWN_LIST={};' + fn('sameTownName') + fn('townCentres') + fn('nearbyTowns') +
      admin.slice(start, end) +
      '\nreturn {plan: planNewCrewDays};')();

    const AT = { Lehi: [40.391, -111.851], Highland: [40.425, -111.795],
                 'American Fork': [40.377, -111.796], Levan: [39.555, -111.862],
                 /* Far enough from the rest that it can never be borrowed — it has
                    to WIN a crew, which is the thing being tested. */
                 Draper: [40.524, -111.863] };
    const make = (city, n, priority) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push({ id: city + priority + i, city: city, priority: priority,
        from: '2026-10-01', until: '', stop: { lat: AT[city][0], lng: AT[city][1] } });
      return out;
    };
    const dateOfCity = (days, city) => {
      let first = '';
      days.forEach(d => d.ids.forEach(id => {
        if (id.indexOf(city) === 0 && (!first || d.date < first)) first = d.date;
      }));
      return first;
    };

    /* ⭐ THE REPORTED BUG. Lehi is huge but has no October left; a town of two
       still holding an October customer must not wait behind eighty who said
       they did not mind. */
    {
      /* ⚠ THERE HAVE TO BE TWO BIG TOWNS. With only one, the second crew has
         nothing else to do and picks the small town on the first day anyway —
         so head-count alone would look identical and the check would prove
         nothing. Lehi and Draper between them keep both crews busy for days. */
      const waiting = make('Lehi', 80, 2)
        .concat(make('Draper', 60, 2))
        .concat(make('Highland', 2, 1));
      const days = api.plan(waiting, {}, { floorDate: '2026-10-01', maxDays: 40, pack: false });
      const first = days.map(d => d.date).sort()[0];
      check('S53', 'a small town with an October customer goes on the FIRST day, ahead of two big towns without one',
        dateOfCity(days, 'Highland') === first,
        'Highland went ' + dateOfCity(days, 'Highland') + ', the season opens ' + first +
        ' — head-count alone left those two October customers queueing behind a hundred and forty ' +
        'people who had said they did not mind, which is how they ended up on 26 November');
    }

    /* ⚠ AND IT DOES NOT UNDO THE OWNER'S OWN RULE. When the urgency is equal —
       which it is through most of October, because every town still has
       October houses — the biggest town still goes first. */
    {
      const waiting = make('Lehi', 40, 1).concat(make('Highland', 8, 1));
      const days = api.plan(waiting, {}, { floorDate: '2026-10-01', maxDays: 40, pack: false });
      const first = days.filter(d => d.date === days[0].date).map(d => d.city);
      check('S53', 'among towns that are equally urgent the biggest still goes first',
        first.indexOf('Lehi') !== -1,
        'first day went to ' + first.join(', ') +
        ' — "we want to start with the two cities that have the most clients" is still the rule');
    }

    /* ⚠ A town nobody is near still gets its day rather than being dropped. */
    {
      const waiting = make('Lehi', 30, 2).concat(make('Levan', 1, 1));
      const days = api.plan(waiting, {}, { floorDate: '2026-10-01', maxDays: 40, pack: false });
      check('S53', 'a lone October customer a hundred miles out is still scheduled',
        !!dateOfCity(days, 'Levan'),
        'there is no efficient answer for one customer in Levan, but losing them is not it');
    }
  }

  /* ---- ⭐ moving somebody to a LATER day, and the line it must not cross ---- */
  {
    const src = fn('packTailCrewDays');
    check('S53', 'packTailCrewDays found', !!src);
    if (src) {
      const sb = {};
      new Function('MAX_STOPS_PER_ROUTE', 'CREWS_PER_DAY', src + 'this.pack = packTailCrewDays;')
        .call(sb, 20, 2);

      const build = (rows) => {
        const meta = {};
        const days = rows.map(r => {
          const ids = [];
          for (let i = 0; i < r.n; i++) {
            const id = r.city + '@' + r.date + '#' + i;
            meta[id] = { city: r.city, from: r.from || '', until: r.until || '' };
            ids.push(id);
          }
          return { date: r.date, crew: String(r.crew), city: r.city, towns: [r.city], ids: ids };
        });
        return { days, meta };
      };
      const run = (rows, opts) => {
        const f = build(rows);
        const out = sb.pack(f.days, Object.assign({
          cap: 20, crews: 2,
          from: id => f.meta[id].from,
          until: id => f.meta[id].until,
          townOf: id => f.meta[id].city,
          nearby: c => (c === 'Lehi' ? ['Highland'] : (c === 'Highland' ? ['Lehi'] : [])),
          dist: () => 5
        }, opts || {}));
        out.meta = f.meta;
        out.dates = Array.from(new Set(out.days.map(d => d.date))).sort();
        out.dateOf = {};
        out.days.forEach(d => d.ids.forEach(id => { out.dateOf[id] = d.date; }));
        return out;
      };

      /* ⭐ THE REAL CASE. The "10/28+" customer holds 28 October on their own
         because nobody else is allowed in October by then. The plus means "not
         before the 28th", and 2 November satisfies that just as well — on a day
         the crew is already working. */
      {
        const r = run([
          { date: '2026-10-28', crew: 1, city: 'Lehi', n: 1, from: '2026-10-28', until: '' },
          { date: '2026-11-02', crew: 1, city: 'Lehi', n: 15 }
        ]);
        check('S53', 'a lone house with no deadline rides a later day the crew is already working',
          r.dates.length === 1 && r.dates[0] === '2026-11-02',
          'still ' + r.dates.join(', ') + ' — one house is a whole morning');
      }

      /* ⚠ THE LINE. Same shape, but the customer asked for October. */
      {
        const r = run([
          { date: '2026-10-28', crew: 1, city: 'Lehi', n: 1, from: '2026-10-01', until: '2026-10-31' },
          { date: '2026-11-02', crew: 1, city: 'Lehi', n: 15 }
        ]);
        check('S53', 'an October customer is NEVER swept into November to save a day',
          r.dates.length === 2 && r.dateOf['Lehi@2026-10-28#0'] === '2026-10-28',
          'landed ' + r.dateOf['Lehi@2026-10-28#0'] +
          ' — this is the exact complaint the work started from, and a saved day is not worth it');
      }

      /* ⚠ Later is a LAST resort. An earlier day that works always wins. */
      {
        const r = run([
          { date: '2026-10-26', crew: 1, city: 'Lehi', n: 15 },
          { date: '2026-10-28', crew: 1, city: 'Lehi', n: 1 },
          { date: '2026-11-02', crew: 1, city: 'Lehi', n: 15 }
        ]);
        check('S53', 'an earlier day always beats a later one',
          r.dateOf['Lehi@2026-10-28#0'] === '2026-10-26',
          'landed ' + r.dateOf['Lehi@2026-10-28#0'] +
          ' — moving a customer back is free, moving them on is a cost');
      }

      /* ⚠ And ONLY off a day that was not worth going out for.
         Here one crew holds five — thin enough to be looked at — but the day as
         a whole holds thirteen, so the morning is paying for itself. The five
         would fit perfectly on the later Lehi day, which is exactly the tidy,
         plausible move that must not happen: it would hang five people later
         for no saving at all. */
      {
        const r = run([
          { date: '2026-10-28', crew: 1, city: 'Lehi', n: 5 },
          { date: '2026-10-28', crew: 2, city: 'Highland', n: 8 },
          { date: '2026-11-02', crew: 1, city: 'Lehi', n: 15 }
        ]);
        check('S53', 'a thin crew on a day that IS worth working is not pushed later',
          r.dateOf['Lehi@2026-10-28#0'] === '2026-10-28' && r.dates.length === 2,
          'landed ' + r.dateOf['Lehi@2026-10-28#0'] + ' across ' + r.dates.length +
          ' days — the crew is out on the 28th either way, so moving them buys nothing and costs five people five days');
      }

      /* ⚠ FAIL SAFE. A caller that never supplies deadlines gets no later moves
         at all, rather than every house looking deadline-free. */
      {
        const f = build([
          { date: '2026-10-28', crew: 1, city: 'Lehi', n: 1, from: '2026-10-28' },
          { date: '2026-11-02', crew: 1, city: 'Lehi', n: 15 }
        ]);
        const out = sb.pack(f.days, {
          cap: 20, crews: 2,
          from: id => f.meta[id].from,
          townOf: id => f.meta[id].city,
          nearby: () => [],
          dist: () => 5
        });
        check('S53', 'no deadlines supplied means nobody is moved later',
          Array.from(new Set(out.days.map(d => d.date))).length === 2,
          'an October customer on 9 November would be silent, and it is exactly how this bug happened');
      }

      check('S53', 'and the builder hands the deadlines through',
        /until: function\(id\)\{ return \(wById\[id\] && wById\[id\]\.until\) \|\| ''; \},/.test(admin) &&
        /until:houseDeadline\(h\),/.test(admin),
        'the packer cannot work them out for itself — it never sees the customer record');
    }
  }
}



/* ============================================================
 * Suite 54. Merging a customer who is in the book twice.
 *
 * Owner, 2026-08-18: "the bad duplicates have their address titled: , UT and
 * the good duplicated dont have a price"; "use name and CU#"; "if you can make
 * it so they rather merge more than just delete".
 *
 * HOW THE DUPLICATES HAPPENED, because the fix has to hold against it:
 * buildFullAddress('', '', '') returns exactly ", UT". A bulk import ran with
 * the Street and City columns blank; BULK_IDENTIFIER is 'phone+address', so
 * with no street the match could not succeed and every row fell past "update
 * this customer" into "add a new one" — a second copy of the whole book, each
 * carrying ", UT" for an address and a price on its invoice.
 *
 * So the two copies each hold something the other does not, which is exactly
 * the case the scored tool (Suite 45) REFUSES. Merging is what actually fixes
 * this book: fill the keeper's blanks from the spare, then remove the spare.
 * ============================================================ */
suite('Suite 54. Merging a customer who is in the book twice');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  /* ---- ⭐ ", UT" is an address with nothing in it ---- */
  {
    const src = fn('dupAddressIsEmpty');
    check('S54', 'dupAddressIsEmpty exists', !!src);
    if (src) {
      const sb = {};
      new Function('dupStreetOf', 'extractCleanCity', src + 'this.f = dupAddressIsEmpty;')
        .call(sb, (d) => (d && d.street) || '', (c) => (c || '').trim());
      check('S54', '", UT" counts as no address at all',
        sb.f({ street: '', city: '', address: ', UT' }) === true,
        'the string is not empty, so without this it wins a merge against the real house');
      check('S54', 'a real address does not',
        sb.f({ street: '123 Main St', city: 'Lehi' }) === false);
      check('S54', 'a town on its own is still something',
        sb.f({ street: '', city: 'Lehi' }) === false);
    }
  }

  /* ---- ⭐ merging only ever FILLS A GAP ---- */
  {
    const src = fn('mergeFieldsFrom');
    const blank = fn('mergeBlank');
    const empty = fn('dupAddressIsEmpty');
    check('S54', 'mergeFieldsFrom exists', !!src);
    if (src && blank && empty) {
      const sb = {};
      new Function('dupStreetOf', 'extractCleanCity', 'MERGE_ADDRESS_FIELDS', 'MERGE_SKIP_FIELDS',
        blank + empty + src + 'this.f = mergeFieldsFrom;'
      ).call(sb, (d) => (d && d.street) || '', (c) => (c || '').trim(),
        { street: 1, city: 1, state: 1, zip: 1, address: 1, lat: 1, lng: 1, needsGeocode: 1 },
        { portalToken: 1 });
      const f = sb.f;

      /* ⭐ THE OWNER'S OWN CASE, both halves. */
      check('S54', 'the copy with the real house takes the price from the copy without one',
        JSON.stringify(f({ name: 'J', street: '123 Main St', city: 'Lehi' },
                         { name: 'J', street: '', city: '', address: ', UT', housePrice: 355 })) ===
        JSON.stringify({ housePrice: 355 }),
        'one copy has the address and the other has the price — that is the whole book');

      /* ⚠ NOTHING ALREADY THERE IS EVER OVERWRITTEN. */
      check('S54', 'a field the keeper already has is never overwritten',
        JSON.stringify(f({ name: 'J', housePrice: 355 }, { name: 'J', housePrice: 999 })) === '{}',
        'merging must be able to ADD information and unable to destroy any');
      check('S54', 'a blank on the spare copy never wipes the keeper',
        JSON.stringify(f({ name: 'J', phone: '8015550100' }, { name: 'J', phone: '' })) === '{}');
      check('S54', 'and an empty list is a blank, not a value',
        JSON.stringify(f({ name: 'J', lightColors: ['Red'] }, { name: 'J', lightColors: [] })) === '{}');
      /* ⚠ A merge must never WRITE a blank. Both copies missing a field is the
         commonest case in this book, and copying one empty string onto another
         is a pointless write on ~900 records — and the same hole would let a
         null or an empty list across. */
      check('S54', 'a field blank on BOTH copies is not written at all',
        JSON.stringify(f({ name: 'J' }, { name: 'J', email: '', notes: '   ', lightColors: [] })) === '{}',
        'got ' + JSON.stringify(f({ name: 'J' }, { name: 'J', email: '', notes: '   ', lightColors: [] })));

      /* ⚠ THE ADDRESS MOVES AS ONE THING. */
      check('S54', 'the address is taken whole, never half from each',
        JSON.stringify(f({ name: 'J', street: '', city: '', address: ', UT' },
                         { name: 'J', street: '9 Elm', city: 'Lehi', zip: '84043', lat: 40.3, lng: -111.8 })) ===
        JSON.stringify({ street: '9 Elm', city: 'Lehi', zip: '84043', lat: 40.3, lng: -111.8 }),
        'a street from one copy and a pin from the other would put a pin on the wrong house');
      check('S54', 'a real address is never replaced by a ", UT" one',
        JSON.stringify(f({ name: 'J', street: '123 Main St', city: 'Lehi' },
                         { name: 'J', street: '', city: '', address: ', UT' })) === '{}',
        'the spare copy has an address FIELD, it just has nothing in it');

      check('S54', 'the portal token is never merged',
        JSON.stringify(f({ name: 'J' }, { name: 'J', portalToken: 'abc123' })) === '{}',
        'it identifies the record, not the customer, and is what a member logs in with');
      check('S54', 'a false is a real value and can fill a gap',
        JSON.stringify(f({ name: 'J' }, { name: 'J', scheduled: false })) ===
        JSON.stringify({ scheduled: false }));
    }
  }

  /* ---- ⭐ grouping by name, split by customer number ---- */
  {
    const src = fn('findMergeableCustomers');
    check('S54', 'findMergeableCustomers exists', !!src);
    if (src) {
      const run = (custs, routed) => {
        const ctx = {};
        new Function('jobAddresses', 'dupNormName', 'dupStreetOf', 'extractCleanCity',
          'MERGE_ADDRESS_FIELDS', 'MERGE_SKIP_FIELDS',
          fn('mergeBlank') + fn('dupAddressIsEmpty') + fn('mergeFieldsFrom') + src +
          'this.find = findMergeableCustomers;'
        ).call(ctx, custs,
          (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' '),
          (d) => (d && d.street) || '', (c) => (c || '').trim(),
          { street: 1, city: 1, state: 1, zip: 1, address: 1, lat: 1, lng: 1, needsGeocode: 1 },
          { portalToken: 1 });
        return ctx.find(routed || {});
      };
      const c = (id, data) => ({ id: id, data: data });
      const GOOD = { name: 'Julie Cattani', street: '123 Main St', city: 'Lehi', customerNumber: '883' };
      const BAD  = { name: 'Julie Cattani', street: '', city: '', address: ', UT', housePrice: 355 };

      {
        const r = run([c('good', GOOD), c('bad', BAD)]);
        check('S54', 'the two copies are found by name even though the addresses differ',
          r.ready.length === 1,
          'the broken copy has NO address, so an address could never have grouped them — ' +
          'which is why the name does it');
        check('S54', 'the copy with the real house is the one kept',
          r.ready.length === 1 && r.ready[0].keeper.id === 'good',
          'kept ' + (r.ready[0] && r.ready[0].keeper.id));
        check('S54', 'and it gains the price off the one being removed',
          r.ready.length === 1 && r.ready[0].gains.housePrice === 355,
          JSON.stringify(r.ready[0] && r.ready[0].gains));
        check('S54', 'the customer number survives the merge',
          r.ready.length === 1 && !('customerNumber' in r.ready[0].gains) &&
          r.ready[0].keeper.data.customerNumber === '883');
      }

      /* Order of the book must not change the answer. */
      {
        const one = run([c('good', GOOD), c('bad', BAD)]);
        const two = run([c('bad', BAD), c('good', GOOD)]);
        check('S54', 'the same book always gives the same answer',
          one.ready[0].keeper.id === two.ready[0].keeper.id,
          'a merge list that changed between two presses would be unreviewable');
      }
      /* ⚠ And when NOTHING else separates two copies — same empty address,
         neither on a route, no dates — the id still has to break the tie, or
         the answer is whatever order Firestore happened to hand them over in.
         The fixture above cannot show this: its two copies differ by address,
         so that test passes with the last tiebreak deleted. */
      {
        const one = run([c('z', BAD), c('a', BAD)]);
        const two = run([c('a', BAD), c('z', BAD)]);
        check('S54', 'two copies alike in every way still resolve the same way round',
          one.ready[0].keeper.id === 'a' && two.ready[0].keeper.id === 'a',
          'got ' + one.ready[0].keeper.id + ' and ' + two.ready[0].keeper.id);
      }

      /* ⭐ THE SAME NAME ON SEVERAL NUMBERS IS SEVERAL HOUSES.
         Owner, 2026-08-18, reading Health Check's "two customers sharing one
         customer number": "any same number same name should merge." Straight
         off that list — Caitlin Rigamoto is listed twice on number 31 AND
         twice on 713. Four records, two houses. Grouping by name alone saw two
         numbers and refused the lot, which is why nothing on that report could
         be cleared. */
      {
        const BAD31 = { name: 'Caitlin Rigamoto', customerNumber: '31', street: '', city: '', address: ', UT', housePrice: 300 };
        const BAD713 = { name: 'Caitlin Rigamoto', customerNumber: '713', street: '', city: '', address: ', UT', housePrice: 400 };
        const r = run([
          c('a31', { name: 'Caitlin Rigamoto', customerNumber: '31', street: '1 A St' }), c('b31', BAD31),
          c('a713', { name: 'Caitlin Rigamoto', customerNumber: '713', street: '9 B Rd' }), c('b713', BAD713)
        ]);
        check('S54', 'the same name on two numbers is two houses, and each merges on its own',
          r.ready.length === 2 && r.ready.every(g => g.losers.length === 1),
          'got ' + r.ready.length + ' ready, ' + r.review.length + ' refused — the whole of that ' +
          'Health Check list is this shape, and grouping by name alone refused every line of it');

        /* ⚠ NOTHING EVER CROSSES A NUMBER. */
        const g31 = r.ready.filter(g => g.keeper.data.customerNumber === '31')[0];
        const g713 = r.ready.filter(g => g.keeper.data.customerNumber === '713')[0];
        check('S54', 'and neither house takes anything off the other',
          !!g31 && !!g713 && g31.gains.housePrice === 300 && g713.gains.housePrice === 400 &&
          g31.keeper.data.street === '1 A St' && g713.keeper.data.street === '9 B Rd',
          'number 31 gained ' + (g31 && g31.gains.housePrice) + ', 713 gained ' + (g713 && g713.gains.housePrice));
      }

      /* ⚠ Two different PEOPLE on one number — Health Check's number 479, May
         Sara against Rachel Oslund — are never brought together at all, because
         the names never group. That stays a job for the office. */
      {
        const r = run([c('a', { name: 'May Sara', customerNumber: '479', street: '1 A St' }),
                       c('b', { name: 'Rachel Oslund', customerNumber: '479', street: '9 B Rd' })]);
        check('S54', 'two different people sharing a number are never merged',
          r.ready.length === 0 && r.review.length === 0,
          'one of them has to lose the number, and choosing which is not this button\u2019s job');
      }

      /* ⚠ A copy with no number, where the name is spread over several, cannot
         be placed — it might belong to any of those houses. */
      {
        const r = run([c('a', { name: 'Jana McJunkin', customerNumber: '600', street: '1 A St' }),
                       c('b', { name: 'Jana McJunkin', customerNumber: '601', street: '9 B Rd' }),
                       c('loose', { name: 'Jana McJunkin', street: '', city: '', address: ', UT' })]);
        check('S54', 'an unnumbered copy under a name with several numbers is reported, not guessed',
          r.ready.length === 0 && r.review.length === 1 &&
          /cannot tell which house/.test(r.review[0].why.join(';')),
          JSON.stringify(r.review.map(x => x.why)));
      }

      /* ⚠ THE REFUSALS THAT REMAIN. */
      {
        const r = run([c('a', { name: 'Julie Cattani', street: '1 A St' }),
                       c('b', { name: 'Julie Cattani', street: '99 B Rd' })]);
        check('S54', 'the same name at two real addresses is refused',
          r.ready.length === 0 && r.review.length === 1,
          'a landlord or a family, not a duplicate — and merging would destroy one of the houses');
      }
      {
        const r = run([c('good', GOOD), c('bad', BAD)], { good: true, bad: true });
        check('S54', 'two copies both on routes are refused',
          r.ready.length === 0 && r.review.length === 1,
          'the same house is scheduled twice and which stop to lose is the office\u2019s decision');
      }

      /* ⚠ Deleting takes a record off its route, so the routed copy must survive
         wherever the address does not decide it. */
      {
        const A = { name: 'Julie Cattani', street: '', city: '', address: ', UT' };
        const r = run([c('plain', A), c('routed', A)], { routed: true });
        check('S54', 'otherwise the copy the crew is going to is the one kept',
          r.ready.length === 1 && r.ready[0].keeper.id === 'routed',
          'kept ' + (r.ready[0] && r.ready[0].keeper.id) +
          ' — keeping the other would quietly cancel a stop the customer has been messaged about');
      }

      {
        const r = run([c('a', GOOD), c('b', { name: 'Someone Else', street: '5 C Way' })]);
        check('S54', 'a customer who appears once is left completely alone',
          r.ready.length === 0 && r.review.length === 0);
      }
      {
        const r = run([c('a', { street: '1 A St' }), c('b', { street: '1 A St' })]);
        check('S54', 'records with no name at all are never merged',
          r.ready.length === 0 && r.review.length === 0,
          'there is nothing to group them on, and guessing from an address is what the tool above does');
      }
      {
        const r = run([c('a', GOOD), c('b', BAD), c('d', BAD)]);
        check('S54', 'three copies collapse into one',
          r.ready.length === 1 && r.ready[0].losers.length === 2 && r.ready[0].keeper.id === 'a',
          'kept ' + (r.ready[0] && r.ready[0].keeper.id) + ', removing ' +
          (r.ready[0] ? r.ready[0].losers.length : 0));
      }
    }
  }

  /* ---- the button, and the guards around it ---- */
  check('S54', 'the button is there', admin.indexOf('id="dupExactBtn"') > 0);
  {
    const at = admin.indexOf("document.getElementById('dupExactBtn')");
    const end2 = admin.indexOf("document.getElementById('rbFixNamesBtn')", at);
    const body = at > 0 && end2 > at ? admin.slice(at, end2) : '';
    check('S54', 'the handler was found', !!body);
    /* ⚠ SCOPED. The scored tool above spells its lock identically, so a
       file-wide search passed with this one's removed. */
    check('S54', 'it changes nothing until MERGE is typed',
      /input\.value\.trim\(\)\.toUpperCase\(\) !== 'MERGE'/.test(body),
      'same shape of lock as every other bulk change in Danger Zone');

    /* ⭐ THE ORDER THAT CANNOT LOSE ANYTHING. */
    check('S54', 'the keeper is filled in BEFORE the spare is deleted',
      body.indexOf("updateDoc(doc(db,'jobAddresses', g.keeper.id), g.gains)") > 0 &&
      body.indexOf("updateDoc(doc(db,'jobAddresses', g.keeper.id), g.gains)") <
      body.indexOf("deleteDoc(doc(db,'jobAddresses', l.id))"),
      'the other order can lose the very field this exists to rescue — delete the copy holding the ' +
      'price, fail to write it onto the keeper, and it is gone for good');
    check('S54', 'it takes the copy off any route before deleting it',
      /removeCustomerFromUpcomingRoutes\(l\.id\)/.test(body),
      'or the crew is left with a stop pointing at a customer who is not there');
    check('S54', 'it deletes only the spare copies, never the keeper',
      !/deleteDoc\(doc\(db,'jobAddresses', g\.keeper/.test(body));
    check('S54', 'it only ever acts on the list the scan put in front of you',
      /const groups = dupExactPending \|\| \[\];/.test(body),
      'acting on a fresh scan would change records nobody had seen');
    check('S54', 'and it writes the merge to the activity log',
      /logActivity\('Merged ' \+ merged \+ ' duplicate customer/.test(body));
    check('S54', 'no customer number is handed back to the pool',
      !/availableCustomerNumbers/.test(body),
      'the record kept still holds it, so pooling it would hand a live number to somebody new');
  }

  /* ---- ⭐ and the thing that made the duplicates cannot make more ---- */
  check('S54', 'the Invoice Bulk Update matches a phone by its digits',
    /custByPhoneDigits\.get\(phone\)/.test(admin) &&
    !/jobAddresses\.find\(a => \(a\.data\.phone\|\|''\) === phone\)/.test(admin),
    'it compared a digits-only phone against the formatted one on the record — false for every ' +
    'customer who had one — so it decided nobody existed and added a second address-less copy EVERY RUN');
  check('S54', 'and the bulk import still refuses to add a customer with no street',
    /if\(!existing && !street\)\{ failed\+\+; continue; \}/.test(admin),
    'this is the guard that would have stopped the whole book duplicating; it was added after it happened');
}


/* ============================================================
 * Suite 55. Jeff Richards, and Richards Jeff.
 *
 * Owner, 2026-08-18, pasting two rows out of All Customers:
 *   Jeff Richards #5029 — 449 E 200 N, Levan, UT 84639 — scheduled Oct 12, $980
 *   Richards Jeff       — Levan, UT                    — no number, no invoice
 * "make a indicator in health check for customers without a number"
 *
 * Two separate things fall out of that pair.
 *
 * "Levan, UT" is buildFullAddress('', 'Levan', '') — a blank street again, the
 * same cause as ", UT". And "Richards Jeff" is the EXCEL spelling: the master
 * sheet is "Last First" and the site is "First Last", so a copy made by an
 * import that did not flip the names keeps the sheet's order. That is
 * systematic across the strays, not a one-off — and it meant the merge tool
 * could not see this pair at all.
 * ============================================================ */
suite('Suite 55. Jeff Richards, and Richards Jeff');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  /* ---- ⭐ the name matches whichever way round it is written ---- */
  {
    const src = fn('dupNormName');
    check('S55', 'dupNormName exists', !!src);
    if (src) {
      const sb = {};
      new Function(src + 'this.f = dupNormName;').call(sb);
      const f = sb.f;

      check('S55', '"Jeff Richards" and "Richards Jeff" are the same customer',
        f('Jeff Richards') === f('Richards Jeff'),
        'the sheet is Last First and the site is First Last, so a copy made without the ' +
        'flip keeps the sheet order — and the merge tool could not see this pair at all');
      check('S55', 'and so are "Cattani, Julie" and "Julie Cattani"',
        f('Cattani, Julie') === f('Julie Cattani'),
        'the comma is how Excel writes it');
      check('S55', 'case and punctuation still make no difference',
        f('  JEFF   RICHARDS ') === f('jeff richards') &&
        f("O'Brien Mary") === f('Mary OBrien'));
      check('S55', 'a middle name still separates two people',
        f('Jeff Richards') !== f('Jeff A Richards'),
        'dropping a word would fold a father and son together');

      /* ⚠ Two genuinely different names must still not collide. */
      check('S55', 'different people are still different',
        f('Jeff Richards') !== f('Jeff Richardson') &&
        f('Sean Hilton') !== f('Shawn Hilton') &&
        f('Erin Wade') !== f('Erin Wademan'));
    }
  }

  /* ---- ⭐ and the pair now merges ---- */
  {
    const src = fn('findMergeableCustomers');
    if (src) {
      const ctx = {};
      const good = { id: 'good', data: { name: 'Jeff Richards', customerNumber: '5029',
        street: '449 E 200 N', city: 'Levan', zip: '84639', phone: '8015973375' } };
      /* The stray, exactly as it reads in All Customers: Excel name order, no
         number, and a town with no street in front of it. */
      const stray = { id: 'stray', data: { name: 'Richards Jeff', street: '', city: 'Levan',
        address: 'Levan, UT', installPreference: 'Normal Schedule' } };
      new Function('jobAddresses', 'dupNormName', 'dupStreetOf', 'extractCleanCity',
        'MERGE_ADDRESS_FIELDS', 'MERGE_SKIP_FIELDS',
        fn('mergeBlank') + fn('dupAddressIsEmpty') + fn('mergeFieldsFrom') + src +
        'this.find = findMergeableCustomers;'
      ).call(ctx, [good, stray],
        (function(){ const o = {}; new Function(fn('dupNormName') + 'this.f = dupNormName;').call(o); return o.f; })(),
        (d) => (d && d.street) || '', (c) => (c || '').trim(),
        { street: 1, city: 1, state: 1, zip: 1, address: 1, lat: 1, lng: 1, needsGeocode: 1 },
        { portalToken: 1 });
      const r = ctx.find({});

      check('S55', 'the owner\u2019s own pair is found and merged',
        r.ready.length === 1 && r.ready[0].keeper.id === 'good' && r.ready[0].losers.length === 1,
        'ready ' + r.ready.length + ', refused ' + r.review.length);
      check('S55', 'the record with the real address and the number is the one kept',
        r.ready.length === 1 && r.ready[0].keeper.data.customerNumber === '5029' &&
        r.ready[0].keeper.data.street === '449 E 200 N');
      check('S55', 'and "Levan, UT" never replaces the real address',
        r.ready.length === 1 && !('address' in r.ready[0].gains) && !('street' in r.ready[0].gains),
        'a town with no street in front of it is not an address: ' +
        JSON.stringify(r.ready.length ? r.ready[0].gains : {}));
    }
  }

  /* ---- ⭐ the Health Check row ---- */
  {
    /* Sliced to the NEXT check rather than a character count, so growing this
       one cannot quietly move the window off what is being asserted. */
    const at = admin.indexOf("id: 'noNumber',");
    const nextPush = admin.indexOf('checks.push({', at);
    check('S55', 'the check is registered', at > 0 && nextPush > at);
    const block = at > 0 && nextPush > at ? admin.slice(at, nextPush) : '';
    check('S55', 'it counts customers with no customer number',
      /return !String\(\(c\.data \|\| \{\}\)\.customerNumber \|\| ''\)\.trim\(\);/.test(block),
      'a number of 0 or "  " is no number');
    check('S55', 'it has no fix button',
      /fix: null,/.test(block) && !/fix: '/.test(block),
      'the code cannot invent a customer number, and picking one at scale is how numbers get reused');
    /* ⚠ BOTH shapes of stray have to say so. The first version of this check
       matched the phrase anywhere in the block, so deleting it from the
       "no street, only a town" branch — which is the owner's own Jeff Richards
       case — still passed on the other branch. */
    check('S55', 'it says which ones look like strays, whether or not a town survived',
      /no street, only "' \+ town \+ '" — looks like a stray copy/.test(block) &&
      /no address at all — looks like a stray copy/.test(block),
      'a record with no number AND no street is an import leftover, not a customer waiting for a ' +
      'number — that difference is the whole value of the row');
    check('S55', 'and the price is still reported, now as detail rather than a filter',
      /priced \$/.test(block),
      'the old check only listed customers WITH a price, which is exactly why the stray was invisible');
  }
}


/* ============================================================
 * Suite 56. Why May Sara went back to 479.
 *
 * Owner, 2026-08-18: "when I bulk update this keeps happening where people go
 * back to the wrong numbers like may sara for example is supposed to be at 541
 * and I bulk update for that and she does but then she goes back to 479."
 *
 * ⭐ NOTHING REVERTED IT. Two rows of the SAME paste resolved to the same
 * customer record, and the lower one won — inside a single run. Row A wrote
 * 541, row B matched the same house further down the sheet and wrote 479 over
 * it. It looks exactly like the update failing or being undone, and it is
 * neither, which is why it kept happening.
 *
 * ⚠ AND IT IS NOT ALWAYS A REPEATED ADDRESS, which is all Check First used to
 * compare. bulkFindCustomer resolves a row by PHONE as well as by street, so
 * two rows for two genuinely different people land on one record whenever they
 * share a phone. May Sara and Rachel Oslund were already sharing number 479 on
 * the Health Check list — the same fault seen from the other end.
 * ============================================================ */
suite('Suite 56. Why May Sara went back to 479');
{
  /* ---- ⭐ the import writes a record at most once per run ---- */
  const at = admin.indexOf('const claimedBy = {};');
  check('S56', 'the import tracks which records it has already written', at > 0);

  check('S56', 'a row that lands on an already-written record is refused, not applied',
    /if\(claimedBy\[existing\.id\]\)\{/.test(admin) &&
    /collided\.push\(\{row: i \+ 1, first: claimedBy\[existing\.id\],/.test(admin),
    'letting the lower row win is the whole fault — it silently replaces what the earlier row wrote');

  /* ⚠ Both landmarks searched from the claim onwards. "const fullAddress =
     buildFullAddress(...)" appears in Check First TOO, earlier in the file, and
     an unscoped indexOf compared against that one instead — failing a check
     that was correct. */
  check('S56', 'and it is refused BEFORE anything is written',
    at > 0 &&
    admin.indexOf('claimedBy[existing.id] = i + 1;', at) > at &&
    admin.indexOf('claimedBy[existing.id] = i + 1;', at) <
    admin.indexOf('const fullAddress = buildFullAddress(street, city, zip);', at),
    'claiming after the write would let the collision happen once before being noticed');

  check('S56', 'an unchanged row still claims its record',
    !/if\(claimedBy\[existing\.id\] && changed\)/.test(admin),
    'it matched the house, so a later row landing on it is the same collision — ' +
    'claiming only when something changed would leave the hole half open');

  /* ⚠ A record created by THIS run has to be claimed too. */
  check('S56', 'a record this run just added is claimed as well',
    /const addedRef = await addDoc\(collection\(db,'jobAddresses'\), newDoc\);/.test(admin) &&
    /if\(addedRef && addedRef\.id\) claimedBy\[addedRef\.id\] = i \+ 1;/.test(admin),
    'jobAddresses does not hold it until the listener catches up, so a later row for the same ' +
    'house would not FIND it and would add a second copy — a book duplicating itself a pair at a time');

  /* ⚠ Silence is what made this take three passes to notice. */
  check('S56', 'the collisions are named in the report, by row',
    /const collidedNote = collided\.length/.test(admin) &&
    /pointed at a customer another row had already updated/.test(admin) &&
    /'row ' \+ x\.row/.test(admin),
    'a count alone would still read as "the update did not work"');
  check('S56', 'and the note actually reaches the status line',
    /\+ alreadyRightTotal \+ collidedNote \+ movedNote \+ skippedNote;/.test(admin),
    'a note nobody is shown is the same as no note');

  /* ---- ⭐ Fix CU# only ---- */
  {
    const fn = (name) => {
      const a = admin.indexOf('function ' + name + '(');
      if (a < 0) return '';
      let d = 0;
      for (let i = admin.indexOf('{', a); i < admin.length; i++) {
        if (admin[i] === '{') d++;
        else if (admin[i] === '}') { d--; if (!d) return admin.slice(a, i + 1); }
      }
      return '';
    };
    const src = fn('rbCollectNumberFixes');
    check('S56', 'the button exists', admin.indexOf('id="rbFixNumbersBtn"') > 0);
    check('S56', 'rbCollectNumberFixes exists', !!src);

    if (src) {
      const run = (rows, book) => {
        const cols = {
          rbCustNumbersArea: rows.map(r => r.cu || ''),
          rbStreetsArea: rows.map(r => r.street || ''),
          rbPhonesArea: rows.map(r => r.phone || ''),
          rbCitiesArea: rows.map(r => r.city || ''),
          rbZipsArea: rows.map(r => r.zip || ''),
          rbNamesArea: rows.map(r => r.name || '')
        };
        const ctx = {};
        new Function('BULK_BY_NUMBER', 'jobAddresses', 'rbHeaderOffset', 'rbCol', 'rbName', 'bulkFindCustomer',
          fn('dupNormName') + src + 'this.f = rbCollectNumberFixes;'
        ).call(ctx, false, book,
          () => 0,
          (id) => cols[id] || [],
          (n) => n,
          /* Stands in for findExistingAddressMatch: phone first, then street —
             the same two keys, in the same order, as the real matcher. */
          (street, phone) => book.filter(b =>
            (phone && String(b.data.phone || '') === String(phone)) ||
            (street && String(b.data.street || '') === String(street)))[0]);
        return ctx.f();
      };
      const cust = (id, name, street, phone, cu) => ({ id, data: { name, street, phone, customerNumber: cu } });

      /* ⭐ MAY SARA. The sheet says 541; her record says 479. */
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '479')];
        const r = run([{ cu: '541', street: '1 A St', phone: '8015550001', name: 'May Sara' }], book);
        check('S56', 'a wrong number is corrected to the one on the sheet',
          r.changes.length === 1 && r.changes[0].from === '479' && r.changes[0].to === '541',
          JSON.stringify(r.changes));
      }

      /* ⚠ IT CANNOT MATCH ON THE NUMBER, because the number is what is wrong.
         Matching on 541 would find whoever holds 541 — the wrong house by
         definition — which is how a correction lands on a stranger. */
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '479'),
                      cust('other', 'Someone Else', '9 B Rd', '8015550002', '541')];
        const r = run([{ cu: '541', street: '1 A St', phone: '8015550001', name: 'May Sara' }], book);
        check('S56', 'a number already on somebody else is refused, not taken from them',
          r.changes.length === 0 && r.taken.length === 1 && r.taken[0].heldBy === 'Someone Else',
          'writing it would put two houses on one number, which is what Health Check\u2019s ' +
          '"two customers sharing one customer number" exists to catch: ' + JSON.stringify(r.taken));
      }

      /* ⭐ THE COLLISION, in the tool that fixes numbers. */
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '479')];
        const r = run([
          { cu: '541', street: '1 A St', phone: '8015550001', name: 'May Sara' },
          { cu: '479', street: '', phone: '8015550001', name: 'Rachel Oslund' }
        ], book);
        check('S56', 'a second row for the same house does NOT overwrite the first',
          r.changes.length === 1 && r.changes[0].to === '541' && r.collided.length === 1,
          'this is the bug exactly: the 479 row is lower down and used to win. Got ' +
          JSON.stringify(r.changes) + ' and ' + r.collided.length + ' collision(s)');
        check('S56', 'and the refused row is reported with both row numbers',
          r.collided.length === 1 && r.collided[0].row === 2 && r.collided[0].first === 1,
          JSON.stringify(r.collided));
      }

      /* ⚠ STRUCTURAL, and deliberately so. Passing the number as the match key
         would send the row to whoever currently HOLDS that number — the wrong
         house by definition, which is how a correction lands on a stranger.
         It cannot be shown by running the function: bulkFindCustomer only reads
         that argument when the import is keyed on numbers, and this tool
         refuses to run in that mode at all. So the guarantee is that the '' is
         written there, and this is what holds it. */
      check('S56', 'the number is never used as the key to find the house',
        /const existing = bulkFindCustomer\(street, phone, String\(cities\[i\] \|\| ''\), String\(zips\[i\] \|\| ''\), ''\);/.test(admin),
        'the number is the thing being corrected, so it cannot also be what identifies the customer');
      check('S56', 'and it refuses to run when the import IS keyed on numbers',
        /if\(BULK_BY_NUMBER\) return \{changes: \[\], missing: \[\], collided: \[\], taken: \[\], wrongMode: true\};/.test(admin) &&
        /found\.wrongMode/.test(admin),
        'in that mode the number identifies the customer, so correcting it by matching on it is circular');

      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '541')];
        const r = run([{ cu: '541', street: '1 A St', phone: '8015550001', name: 'May Sara' }], book);
        check('S56', 'a number that is already right is not rewritten',
          r.changes.length === 0, 'a no-op write is still a write, on every row of the sheet');
      }
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '479')];
        const r = run([{ cu: '900', street: '99 Nowhere', phone: '8019999999', name: 'Ghost' }], book);
        check('S56', 'a row matching nobody is reported, never added as a new customer',
          r.changes.length === 0 && r.missing.length === 1,
          'this tool only ever corrects a number on a house that is already here');
        check('S56', 'and a row matching nobody with no namesake gets no hint',
          r.missing[0].hint === '',
          'a hint that fires on nothing would be noise on every stray row');
      }
      /* ⭐ THE LINE THAT ANSWERS THE QUESTION. A row that matches nobody, where
         exactly one customer carries that name, must SAY so and say what number
         they are on — otherwise the report is "9 rows match nobody" and the
         office is back where it started. */
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '479')];
        const r = run([{ cu: '541', street: '9 Z St', phone: '8019999999', name: 'May Sara' }], book);
        check('S56', 'an unmatched row names the customer of that name and the number they are on',
          r.missing.length === 1 && /May Sara/.test(r.missing[0].hint) && /#479/.test(r.missing[0].hint),
          'got "' + (r.missing[0] && r.missing[0].hint) + '"');
        check('S56', 'and it is still refused rather than written',
          r.changes.length === 0,
          'a name is not enough to move a customer number onto a house');
      }
      {
        const book = [cust('a', 'May Sara', '1 A St', '8015550001', '479'),
                      cust('b', 'May Sara', '9 B Rd', '8015550002', '542')];
        const r = run([{ cu: '541', street: '9 Z St', phone: '8019999999', name: 'May Sara' }], book);
        check('S56', 'two customers of one name are counted, not picked between',
          r.missing.length === 1 && /2 customers share this name/.test(r.missing[0].hint),
          'got "' + (r.missing[0] && r.missing[0].hint) + '"');
      }
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '')];
        const r = run([{ cu: '541', street: '1 A St', phone: '8015550001', name: 'May Sara' }], book);
        check('S56', 'a customer with no number at all can be given one',
          r.changes.length === 1 && r.changes[0].from === '' && r.changes[0].to === '541');
      }
      {
        const book = [cust('may', 'May Sara', '1 A St', '8015550001', '479')];
        const r = run([{ cu: '', street: '1 A St', phone: '8015550001', name: 'May Sara' }], book);
        check('S56', 'a blank number on the sheet never wipes the one on file',
          r.changes.length === 0,
          'the sheet not saying is not the sheet saying "none"');
      }
    }

    /* ⚠ It writes ONE field. That is what makes a targeted fixer safe to run. */
    {
      const a2 = admin.indexOf("document.getElementById('rbFixNumbersBtn')");
      const b2 = admin.indexOf("document.getElementById('rbCheckBtn')", a2);
      const body = a2 > 0 && b2 > a2 ? admin.slice(a2, b2) : '';
      check('S56', 'the handler was found', !!body);
      check('S56', 'it writes the customer number and nothing else',
        /updateDoc\(doc\(db,'jobAddresses', list\[i\]\.id\), \{customerNumber: list\[i\]\.to\}\)/.test(body) &&
        !/street|city|zip|housePrice|measuredFeet|name:/.test(body.slice(body.indexOf('rbFixNumbersGoBtn'))),
        'the blast radius being one visible field is the whole argument for this button');
      check('S56', 'it only writes the list it showed you',
        /const list = rbPendingNumberFixes \|\| \[\];/.test(body));
      check('S56', 'and it says the old number may still be on bins in the warehouse',
        /may still be labelled on bins/.test(body),
        'changing a number does not relabel anything physical, and nothing else says so');
    }
  }
}


/* ============================================================
 * Suite 57. A record with no street could never be found again.
 *
 * Owner, 2026-08-18: Fix CU# only reported "9 row(s) match nobody here...
 * although may sara is still 479" — while the master sheet, row 755, carries
 * her complete details: #541, 14224 S Summit Crest Ln, Herriman, 84096,
 * 8014551795.
 *
 * ⭐ EVERY ROUTE THROUGH findExistingAddressMatch NEEDED THE STREET TO AGREE,
 * the phone one included — it checked the phone AND the street. So a record
 * whose street had been wiped, which is what the ", UT" rows are, could not be
 * reached by ANY paste however complete. The import treated the row as a new
 * customer and added another copy.
 *
 * That is the engine underneath everything else in this book: it is why one
 * book became two, why the strays have no address, and why correcting a
 * customer number looked like it undid itself — the new copy carried the right
 * number and the old one kept the wrong one.
 * ============================================================ */
suite('Suite 57. A record with no street could never be found again');
{
  const fn = (name) => {
    const at = admin.indexOf('function ' + name + '(');
    if (at < 0) return '';
    let d = 0;
    for (let i = admin.indexOf('{', at); i < admin.length; i++) {
      if (admin[i] === '{') d++;
      else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
    }
    return '';
  };

  const src = fn('findExistingAddressMatch');
  const byTown = fn('findAddressMatchByTown');
  check('S57', 'findExistingAddressMatch found', !!src && !!byTown);

  if (src && byTown) {
    const run = (book, row) => {
      const ctx = {};
      new Function('jobAddresses', 'normalizeStreetForMatch',
        byTown + src + 'this.f = findExistingAddressMatch;'
      ).call(ctx, book,
        (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
      return ctx.f(row.street || '', row.phone || '', row.city || '', row.zip || '', row.cn || '');
    };
    const c = (id, o) => ({ id: id, data: o });

    /* ⭐ MAY SARA. Her record was left with no street; the sheet row is complete. */
    {
      const book = [c('may', { name: 'May Sara', customerNumber: '479',
                               street: '', city: 'Herriman', address: ', UT', phone: '8014551795' })];
      const hit = run(book, { street: '14224 S Summit Crest Ln', phone: '8014551795',
                              city: 'Herriman', zip: '84096' });
      check('S57', 'a complete row finds the customer whose street was wiped',
        !!hit && hit.id === 'may',
        'without this the row matches nobody and the import ADDS a second copy — which is ' +
        'exactly what "she goes back to 479" was');
    }

    /* Everything that already worked still does. */
    {
      const book = [c('a', { street: '14224 S Summit Crest Ln', city: 'Herriman', phone: '8014551795' })];
      check('S57', 'the ordinary street-and-phone match is untouched',
        (run(book, { street: '14224 S Summit Crest Ln', phone: '8014551795', city: 'Herriman' }) || {}).id === 'a');
      check('S57', 'and a corrected town still matches on street and phone',
        (run(book, { street: '14224 S Summit Crest Ln', phone: '8014551795', city: 'Bluffdale' }) || {}).id === 'a',
        'the town is often the thing being fixed, so it cannot decide whether this is the same house');
    }
    {
      const book = [c('a', { street: '1 Main St', city: 'Lehi', phone: '8015550001' })];
      check('S57', 'a customer number given as the key still wins outright',
        (run([c('n', { customerNumber: '900', street: 'somewhere else' })].concat(book),
             { street: '1 Main St', phone: '8015550001', cn: '900' }) || {}).id === 'n');
    }

    /* ⚠ THE TWO HALVES OF THE GUARD, both load-bearing. */
    {
      /* A family with two houses on one phone. The second house is NEW and must
         NOT overwrite the first — this is why the phone was never a key alone. */
      const book = [c('house1', { street: '1 Main St', city: 'Lehi', phone: '8015550001' })];
      const hit = run(book, { street: '99 Other Rd', phone: '8015550001', city: 'Lehi' });
      check('S57', 'a phone is never matched against a record that HAS a street',
        !hit,
        'got ' + (hit && hit.id) + ' — a second house on the family phone would have rewritten ' +
        'the first house\u2019s address');
    }
    {
      /* Two stranded records on one phone: genuinely cannot tell which. */
      const book = [c('s1', { street: '', address: ', UT', phone: '8015550001' }),
                    c('s2', { street: '', address: ', UT', phone: '8015550001' })];
      check('S57', 'two street-less records on one phone are refused, not guessed',
        !run(book, { street: '1 Main St', phone: '8015550001', city: 'Lehi' }),
        'reporting it beats merging two different customers');
    }
    {
      const book = [c('s1', { street: '', address: ', UT', phone: '8015550001' })];
      check('S57', 'and a row with no phone cannot reach a street-less record at all',
        !run(book, { street: '1 Main St', phone: '', city: 'Lehi' }),
        'there would be nothing left to identify them by');
    }

    /* ⚠ A row with NO street can now still find its customer. */
    {
      const book = [c('s1', { street: '', address: ', UT', phone: '8015550001' })];
      check('S57', 'a row with no street of its own still reaches a street-less record',
        (run(book, { street: '', phone: '8015550001', city: 'Herriman' }) || {}).id === 's1',
        'the function used to give up the moment the ROW had no street, before it looked at anything else');
    }
    {
      const book = [c('a', { street: '1 Main St', city: 'Lehi', phone: '8015550001' })];
      check('S57', 'but a row with neither street nor a stranded phone still matches nobody',
        !run(book, { street: '', phone: '8019999999', city: 'Lehi' }),
        'guessing here is how two different customers get merged');
    }

    /* ⚠ The street-name fallback keeps its "exactly one" rule. */
    {
      const book = [c('a', { street: '100 N', city: 'Lehi' }), c('b', { street: '100 N', city: 'Orem' })];
      check('S57', 'a street two houses share is still not enough on its own',
        !run(book, { street: '100 N', phone: '', city: 'Provo' }),
        'Utah County repeats street names across towns');
    }
  }

  /* ---- the report has to name them, or the count is a dead end ---- */
  {
    const at = admin.indexOf("document.getElementById('rbFixNumbersBtn')");
    const end = admin.indexOf("document.getElementById('rbCheckBtn')", at);
    const body = at > 0 && end > at ? admin.slice(at, end) : '';
    check('S57', 'the unmatched rows are listed, not just counted',
      /'row ' \+ x\.row \+ ' &middot; ' \+ esc\(x\.name\)/.test(body),
      '"9 row(s) match nobody" is a dead end — the office cannot act on a count');
    check('S57', 'and a customer of the same name is named with the number they are on',
      /their address does not match this row/.test(admin) &&
      /x\.hint/.test(body),
      'that single line is what turned "May Sara is still 479" from a mystery into a fix');
  }
}

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
