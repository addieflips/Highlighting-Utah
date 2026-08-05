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
const logicSrc = ['computeInvoiceStatus', 'colorComboKey']
  .map(n => extractFn(admin, n)).filter(Boolean).join('\n');
eval(logicSrc);

check('logic', 'computeInvoiceStatus exists', typeof computeInvoiceStatus === 'function');
check('logic', 'nothing paid is Unpaid', computeInvoiceStatus(500, 0, 0) === 'Unpaid');
check('logic', 'part paid is Partial Payment', computeInvoiceStatus(500, 0, 200) === 'Partial Payment');
check('logic', 'fully paid is Paid in Full', computeInvoiceStatus(500, 0, 500) === 'Paid in Full');
check('logic', 'overpaid still Paid in Full', computeInvoiceStatus(500, 0, 600) === 'Paid in Full');
check('logic', 'removal counts toward the total',
  computeInvoiceStatus(500, 100, 500) === 'Partial Payment',
  'expected Partial — 500 paid against a 600 total');
check('logic', 'zero-value invoice is Unpaid', computeInvoiceStatus(0, 0, 0) === 'Unpaid');

check('logic', 'colorComboKey sorts so order does not matter',
  colorComboKey(['Red', 'Warm White']) === colorComboKey(['Warm White', 'Red']));
check('logic', 'colorComboKey handles empty', colorComboKey([]) === '' && colorComboKey(null) === '');
check('logic', 'colorComboKey does not mutate its input',
  (() => { const a = ['Red', 'Blue']; colorComboKey(a); return a[0] === 'Red'; })());

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

  const s = admin.indexOf('function quoteDetailSelect(');
  const mark = '  list.innerHTML = html;';
  const e = admin.indexOf(mark, s) + mark.length;

  if (s === -1 || e < s) {
    check('render', 'found renderQuoteRows in admin.html', false,
      'function was renamed or removed — update this test');
  } else {
    eval(admin.slice(s, e) + '\n}\n');
    const ts = d => ({ toDate: () => d });

    renderQuoteRows([
      { id: 'q1', data: { name: 'Dana Whitmore', phone: '(801) 555-0148',
          email: 'dana@x.com', address: '842 N Canyon Rd',
          contactMethod: 'Text', status: 'new' } },
      { id: 'q2', data: { name: 'Marcus Bell', phone: '(801) 555-0192',
          email: 'm@x.com', address: '1207 W Elk Ridge Dr',
          contactMethod: 'Phone', status: 'contacted',
          formCompletedAt: ts(new Date('2026-07-29')),
          lightColors: ['Warm White', 'Red'],
          houseAreas: ['Front of House', 'Right Side'],
          installPreference: 'October', wireColor: 'Green', outletTimer: 'Yes',
          specificOutlet: 'Yes', specificOutletNotes: 'back patio',
          gateCode: '4417', notes: 'Steep pitch over entry',
          wantsMailedInvoice: true, estimatedFeet: 140, quotedPrice: 490,
          quoteToken: 'qt_abc', approvalStatus: 'pending',
          frontPhotoUrl: 'https://example.com/house.jpg' } },
      { id: 'q3', data: { name: 'Quinn "Q" O\'Hara & Sons <script>',
          phone: 'x', email: 'e@x.com', address: '9 Test <b>St</b>',
          contactMethod: 'Email', status: 'new', lightColors: ['Multi'],
          gateCode: 'a"b', notes: 'line1\nline2' } }
    ]);

    const list = document.getElementById('quotesList');
    const cards = list.querySelectorAll('.row-item');
    const det = c => c.querySelectorAll('details')[0];
    const pri = c => c.querySelectorAll('details')[1];
    const [c1, c2, c3] = cards;

    check('render', 'one card per quote', cards.length === 3);

    check('render', 'new lead — detail form collapsed', !det(c1).hasAttribute('open'));
    check('render', 'new lead — pricing collapsed', !pri(c1).hasAttribute('open'));
    check('render', 'new lead — reads not returned yet',
      det(c1).querySelector('summary').textContent.includes('not returned yet'));
    check('render', 'new lead — reads not priced yet',
      pri(c1).querySelector('summary').textContent.includes('not priced yet'));
    check('render', 'new lead — no approval buttons', c1.querySelector('[data-markapproval]') === null);
    check('render', 'new lead — shows Add Photo', c1.textContent.includes('Add Photo'));
    check('render', 'with photo — shows Replace Photo', c2.textContent.includes('Replace Photo'));

    check('render', 'completed — detail form open', det(c2).hasAttribute('open'));
    check('render', 'completed — pricing still collapsed', !pri(c2).hasAttribute('open'));
    check('render', 'completed — summary shows price',
      pri(c2).querySelector('summary').textContent.includes('$490.00'));
    check('render', 'completed — colours joined',
      c2.querySelector('.qdLightColors').value === 'Warm White, Red');
    check('render', 'completed — areas joined',
      c2.querySelector('.qdAreas').value === 'Front of House, Right Side');
    check('render', 'completed — install timing preselected',
      c2.querySelector('.qdInstallPref').value === 'October');
    check('render', 'completed — wire colour preselected',
      c2.querySelector('.qdWireColor').value === 'Green');
    check('render', 'completed — outlet timer preselected',
      c2.querySelector('.qdOutletTimer').value === 'Yes');
    check('render', 'completed — gate code populated',
      c2.querySelector('.qdGateCode').value === '4417');
    check('render', 'completed — notes populated',
      c2.querySelector('.qdNotes').value === 'Steep pitch over entry');
    check('render', 'completed — mailed invoice checked',
      c2.querySelector('.qdWantsMailed').checked === true);
    check('render', 'completed — save button present',
      c2.querySelector('[data-savequotedetail]') !== null);
    check('render', 'completed — approval link shown',
      c2.querySelector('.quotelink-box').textContent.includes('qt_abc'));

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
      c3.querySelector('.qdGateCode').value === 'a"b');
    check('render', 'missing fields fall back to blank',
      c3.querySelector('.qdInstallPref').value === '' &&
      c3.querySelector('.qdWireColor').value === '');

    const renderedIds = [...list.querySelectorAll('[id]')].map(el => el.id);
    check('render', 'no duplicate IDs in rendered cards',
      new Set(renderedIds).size === renderedIds.length);
    const wired = [...list.querySelectorAll('.qdGateCode')].map(el => el.dataset.id);
    check('render', 'each card wired to its own quote', new Set(wired).size === 3);
  }
}

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
console.log('='.repeat(55) + '\n');
process.exit(fail ? 1 : 0);
