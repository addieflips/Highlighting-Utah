/*
 * Money parity test — Highlighting Utah
 *
 * WHY THIS EXISTS
 * The invoice maths is written TWICE, deliberately:
 *
 *   js/money.js            computeInvoiceStatus()        what the office sees
 *   functions/index.js     computeInvoiceStatusServer()  what the customer is billed
 *
 * and the invoice key is written twice as well:
 *
 *   js/money.js            custInvoiceKey()
 *   functions/index.js     invoiceKeyFor()
 *
 * They cannot be shared: one is a browser ES module, the other runs on Node in
 * Cloud Functions. So the only protection against them drifting apart is a
 * test that runs BOTH on the same inputs and compares the answers.
 *
 * Nothing else in the suite does this. run-all.js unit-tests the js/money.js
 * copy and greps the server file for text, but never executes the two side by
 * side. If someone edits one formula and forgets the other, every other check
 * still passes — and the office shows one total while the nightly run bills
 * another. That is the most expensive failure this codebase can have.
 *
 * The test does not care WHAT the formula is. It only cares that both copies
 * agree, so it keeps working when the pricing rules change.
 *
 * Run:  node money-parity.test.js      (or: npm run test:money)
 * Exits 0 if the two copies agree everywhere, 1 on the first disagreement.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lift a named function out of a source file by matching braces.
 * Handles `function f(`, `export function f(` and `async function f(`. */
function extractFn(src, name) {
  const re = new RegExp('(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) return null;

  const start = m.index;
  const open = src.indexOf('{', start);
  if (open === -1) return null;

  let depth = 0, inLine = false, inBlock = false, quote = null, escaped = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];

    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }

    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // strip a leading `export ` so the text is plain Node-runnable source
        return src.slice(start, i + 1).replace(/^export\s+/, '');
      }
    }
  }
  return null;
}

/* Compile extracted source into a real callable, in its own sandbox so
 * nothing from these files can touch this process. */
function compile(sources, exportName) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(sources.join('\n\n') + '\n;this.__fn = ' + exportName + ';', sandbox);
  return sandbox.__fn;
}

const moneySrc = fs.readFileSync(path.join(ROOT, 'js', 'money.js'), 'utf8');
const fnsSrc = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

console.log('\n=== Money parity: browser copy vs server copy ===\n');

// ---------------------------------------------------------------------------
// 1. Both copies must still be findable. If a rename silently breaks the
//    extraction, that must FAIL loudly rather than skip and report green.
// ---------------------------------------------------------------------------
const clientStatusSrc = extractFn(moneySrc, 'computeInvoiceStatus');
const serverStatusSrc = extractFn(fnsSrc, 'computeInvoiceStatusServer');
const clientKeySrc = extractFn(moneySrc, 'custInvoiceKey');
const serverKeySrc = extractFn(fnsSrc, 'invoiceKeyFor');
const digitsOnlySrc = extractFn(fnsSrc, 'digitsOnly');

const found = {
  'js/money.js computeInvoiceStatus': clientStatusSrc,
  'functions/index.js computeInvoiceStatusServer': serverStatusSrc,
  'js/money.js custInvoiceKey': clientKeySrc,
  'functions/index.js invoiceKeyFor': serverKeySrc,
  'functions/index.js digitsOnly': digitsOnlySrc
};

let missing = false;
Object.keys(found).forEach(label => {
  const ok = !!found[label];
  check('found ' + label, ok, ok ? '' : 'renamed or removed — parity can no longer be proved');
  if (!ok) missing = true;
});

if (missing) {
  console.log('\nCannot run the comparison — a function above could not be located.');
  console.log('Fix the name in this test, or restore the function. Do NOT ignore this.\n');
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(1);
}

const clientStatus = compile([clientStatusSrc], 'computeInvoiceStatus');
const serverStatus = compile([serverStatusSrc], 'computeInvoiceStatusServer');
const clientKey = compile([clientKeySrc], 'custInvoiceKey');
const serverKey = compile([digitsOnlySrc, serverKeySrc], 'invoiceKeyFor');

// ---------------------------------------------------------------------------
// 2. Invoice status — sweep the whole realistic money space.
// ---------------------------------------------------------------------------
const AMOUNTS = [0, 0.01, 1, 25, 30, 250, 499.99, 500, 750, 1200, 5000];
const SMALL = [0, 25, 30, 50, 60, 500];

let combos = 0, firstMismatch = null;

for (const install of AMOUNTS) {
  for (const removal of SMALL) {
    for (const deposit of AMOUNTS) {
      for (const credits of SMALL) {
        for (const changeFees of [0, 30, 60]) {
          combos++;
          const a = clientStatus(install, removal, deposit, credits, changeFees);
          const b = serverStatus(install, removal, deposit, credits, changeFees);
          if (a !== b && !firstMismatch) {
            firstMismatch = { install, removal, deposit, credits, changeFees, office: a, server: b };
          }
        }
      }
    }
  }
}

check('the two status formulas agree across ' + combos.toLocaleString() + ' money combinations',
  !firstMismatch,
  firstMismatch
    ? 'install=' + firstMismatch.install + ' removal=' + firstMismatch.removal +
      ' deposit=' + firstMismatch.deposit + ' credits=' + firstMismatch.credits +
      ' changeFees=' + firstMismatch.changeFees +
      '  →  office says "' + firstMismatch.office + '", nightly run says "' + firstMismatch.server + '"'
    : '');

// Messy real-world values: strings out of input boxes, null, undefined, NaN.
const JUNK = [null, undefined, '', '0', '500', '  250  ', NaN, '$500', -50, '12.50'];
let junkMismatch = null;
JUNK.forEach(install => {
  JUNK.forEach(deposit => {
    JUNK.forEach(credits => {
      const a = clientStatus(install, 0, deposit, credits, 0);
      const b = serverStatus(install, 0, deposit, credits, 0);
      if (a !== b && !junkMismatch) {
        junkMismatch = { install, deposit, credits, office: a, server: b };
      }
    });
  });
});

check('the two status formulas agree on blank / text / broken values',
  !junkMismatch,
  junkMismatch
    ? 'install=' + JSON.stringify(junkMismatch.install) +
      ' deposit=' + JSON.stringify(junkMismatch.deposit) +
      ' credits=' + JSON.stringify(junkMismatch.credits) +
      '  →  office "' + junkMismatch.office + '" vs nightly "' + junkMismatch.server + '"'
    : '');

// ---------------------------------------------------------------------------
// 3. Invoice key — the two copies must file a customer under the same invoice.
//    A drift here does not show a wrong number; it silently splits or merges
//    people's bills, which is worse because nothing looks broken.
// ---------------------------------------------------------------------------
const CUSTOMERS = [
  { phone: '801-555-0142', email: 'a@example.com' },
  { phone: '(801) 555 0142', email: 'A@Example.com' },
  { phone: '8015550142', email: '' },
  { phone: '', email: 'Someone@Example.COM' },
  { phone: '', email: '  spaced@example.com  ' },
  { phone: null, email: null },
  { phone: undefined, email: undefined },
  { phone: '', email: '' },
  { phone: '+1 801 555 0142', email: 'x@y.com' },
  { phone: 'no digits here', email: 'fallback@example.com' },
  { phone: 8015550142, email: 'numeric@example.com' },
  { email: 'nophonefield@example.com' },
  { phone: '801.555.0142 ext 3' },
  {}
];

let keyMismatch = null;
CUSTOMERS.forEach(c => {
  const a = clientKey(c);
  const b = serverKey(c);
  if (a !== b && !keyMismatch) keyMismatch = { c, office: a, server: b };
});

check('both copies file a customer under the same invoice key',
  !keyMismatch,
  keyMismatch
    ? JSON.stringify(keyMismatch.c) +
      '  →  admin keys it "' + keyMismatch.office + '", server keys it "' + keyMismatch.server + '"'
    : '');

// Also assert the documented fallback still holds, in both copies at once.
check('an email-only customer still keys on lowercased email (both copies)',
  clientKey({ phone: '', email: 'MiXeD@Example.com' }) === 'mixed@example.com' &&
  serverKey({ phone: '', email: 'MiXeD@Example.com' }) === 'mixed@example.com',
  'the email fallback changed — email-only customers would lose their invoice history');

check('phone always wins over email when both exist (both copies)',
  clientKey({ phone: '801-555-0142', email: 'a@b.com' }) === '8015550142' &&
  serverKey({ phone: '801-555-0142', email: 'a@b.com' }) === '8015550142',
  'if one copy started preferring email, that customer would get a second, empty invoice');

// ---------------------------------------------------------------------------
console.log(failures.length ? '' : '  PASS  every check below\n');
failures.forEach(f => console.log('  FAIL  ' + f + '\n'));

console.log(pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('The office screen and the nightly billing run DISAGREE.');
  console.log('Do not push. Whichever formula changed, the other one has to match it.');
  console.log('  browser copy:  js/money.js');
  console.log('  server copy:   functions/index.js\n');
}

process.exit(fail ? 1 : 0);
