/*
 * Highlighting Utah — full automated test suite
 *
 * Catches the things that have actually broken this project before:
 * missing element IDs, duplicate IDs, unbalanced divs, collections missing
 * from firestore.rules, queries missing a composite index, and quote cards
 * that render wrong.
 *
 * Setup (once):   npm install jsdom
 * Run:            node tests/run-all.js
 *
 * Exits 0 if everything passes, 1 if anything fails.
 * Runs entirely offline — never touches Firebase or real customer data.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
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
const computeInvoiceStatusSrc = extractFn(admin, 'computeInvoiceStatus');
const colorComboKeySrc = extractFn(admin, 'colorComboKey');
eval([computeInvoiceStatusSrc, colorComboKeySrc].filter(Boolean).join('\n'));

check('logic', 'computeInvoiceStatus exists', typeof computeInvoiceStatus === 'function');
check('logic', 'nothing paid is Unpaid', computeInvoiceStatus(500, 0, 0) === 'Unpaid');
check('logic', 'part paid is Partial Payment', computeInvoiceStatus(500, 0, 200) === 'Partial Payment');
check('logic', 'fully paid is Paid in Full', computeInvoiceStatus(500, 0, 500) === 'Paid in Full');
check('logic', 'overpaid still Paid in Full', computeInvoiceStatus(500, 0, 600) === 'Paid in Full');
check('logic', 'removal counts toward the total',
  computeInvoiceStatus(500, 100, 500) === 'Partial Payment',
  'expected Partial — 500 paid against a 600 total');
check('logic', 'zero-value invoice is Unpaid', computeInvoiceStatus(0, 0, 0) === 'Unpaid');

gap('colorComboKey exists in admin.html', typeof colorComboKey === 'function',
  'colorComboKey was removed from admin.html at some point; run-all.js still expects it. ' +
  'Either restore the helper or delete these colorComboKey checks if the feature is gone for good.');
if (typeof colorComboKey === 'function') {
  check('logic', 'colorComboKey sorts so order does not matter',
    colorComboKey(['Red', 'Warm White']) === colorComboKey(['Warm White', 'Red']));
  check('logic', 'colorComboKey handles empty', colorComboKey([]) === '' && colorComboKey(null) === '');
  check('logic', 'colorComboKey does not mutate its input',
    (() => { const a = ['Red', 'Blue']; colorComboKey(a); return a[0] === 'Red'; })());
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

// --- bin rule: over 200 ft = 2 bins, 200 or under = 1 ---
const bins = feet => (feet > 200 ? 2 : 1);
check('logic', 'bins: 200 ft is 1 bin', bins(200) === 1);
check('logic', 'bins: 201 ft is 2 bins', bins(201) === 2);

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
    check('render', 'with photo — shows Replace Photo', c2.textContent.includes('Replace Photo'));
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
    check('render', 'hostile input — quote mark survives into input',
      c3.querySelector('.quoteLightsInput').value === 'a"b');
    check('render', 'missing fields fall back to blank',
      c1.querySelector('.quoteLightsInput').value === '' &&
      c1.querySelector('.quoteFeetInput').value === '');

    const renderedIds = [...list.querySelectorAll('[id]')].map(el => el.id);
    check('render', 'no duplicate IDs in rendered cards',
      new Set(renderedIds).size === renderedIds.length);
    const wired = [...list.querySelectorAll('.quoteFeetInput')].map(el => el.dataset.id);
    check('render', 'each card wired to its own quote', new Set(wired).size === 3);
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

// --- gaps found during the 2026-08-08 system-map audit (not part of the
// original P0-P3 work list — flagged for an owner decision, not blind-fixed) ---
(function () {
  const ibStart = admin.indexOf("ibImportBtn').addEventListener");
  const ibSection = ibStart > -1 ? admin.slice(ibStart, ibStart + 2000) : '';
  gap('Invoice Bulk Update preserves an existing removal charge and payments already on file',
    /removal:\s*existingInv/.test(ibSection) || /deposit:\s*existingInv/.test(ibSection),
    'admin.html ibImportBtn (Invoice Bulk Update) always writes removal:0, deposit:0 for every\n          ' +
    'row, even when existingInv.exists() is true. Re-running this tool against a customer who\n          ' +
    'already has a removal charge or a partial payment recorded silently erases both, with no\n          ' +
    'confirmation and no way to tell afterward except the invoice looking wrong. Needs an owner\n          ' +
    'decision (is this tool ever run against a customer who already has an invoice?), not a\n          ' +
    'blind fix — if removal/deposit should carry over, they need to come from existingInv.data().');

  // No "fixed" signature exists to detect yet — this needs an owner decision on
  // desired behavior before any fix pattern is written, so it's always reported
  // until a human updates this check alongside the real fix. (An earlier version
  // of this check just grepped for the word "changeFees" nearby and false-passed
  // against an unrelated status-display fix that happened to sit in the same
  // block — don't repeat that mistake by loosening this back to a substring test.)
  gap('an outstanding light-change fee carries over when a customer switches bill-to',
    false,
    'When a customer starts billing to someone else, admin.html either deletes their own\n          ' +
    'standalone invoice (if nothing has been paid on it) or zeroes install/removal but keeps\n          ' +
    'the deposit (if something has been paid). Neither path moves an outstanding changeFees\n          ' +
    'balance onto the new payer\'s invoice, and syncPayerInvoice never folds changeFees into the\n          ' +
    'group total either — so a customer with an unpaid $30 light-change fee who switches to\n          ' +
    'bill-to someone else can end up with that fee billed to nobody. Needs an owner decision\n          ' +
    '(should the fee move to the new payer, or be settled before the switch is allowed?), not a\n          ' +
    'blind fix.');
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

  hc.set({
    j: [{ id: 'a', data: { name: 'Smith', phone: '8011112222', address: '1 St', housePrice: 400, customerNumber: '101', measuredFeet: 100 } }],
    i: [{ id: '8011112222', data: { install: 400, removal: 0, deposit: 0, status: 'Unpaid' } }],
    a: [{ id: '999', data: {} }]
  });
  const clean = hc.run().filter(c => c.rows.length);
  check('health', 'clean data reports nothing at all',
    clean.length === 0,
    'false alarms train you to ignore the panel: ' + clean.map(c => c.id).join(', '));

  const all = hc.run();
  check('health', 'all 14 checks present',
    all.length === 14, 'got ' + all.length);
  check('health', 'fix buttons limited to the unambiguous checks',
    all.filter(c => c.fix).length === 6,
    'auto-fixing a judgement call writes bad data at scale');
})();

// =====================================================================
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
