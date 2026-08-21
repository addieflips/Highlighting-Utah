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
/* Both status formulas compare whole cents, so each one's own centsOf helper
   has to come along into the sandbox with it. They are listed as required
   below rather than stubbed here on purpose: if one file's rounding helper is
   renamed or deleted, that must fail loudly instead of the test quietly
   substituting a helper of its own and proving nothing. */
const clientCentsSrc = extractFn(moneySrc, 'centsOf');
const serverCentsSrc = extractFn(fnsSrc, 'centsOf');

/* The light-change rule, written twice for the same reason the status formula
   is: one runs as a browser ES module in admin, the other on Node in the
   portal's Cloud Function. Both decide whether somebody is charged $30, so a
   drift between them charges the office screen and the customer's own portal
   two different amounts for one change. */
function extractConst(src, name) {
  const re = new RegExp('(?:export\\s+)?const\\s+' + name + '\\s*=\\s*([^;]+);');
  const m = re.exec(src);
  return m ? ('const ' + name + ' = ' + m[1] + ';') : null;
}
const clientLightSrc = extractFn(moneySrc, 'applyLightChange');
const serverLightSrc = extractFn(fnsSrc, 'applyLightChangeServer');
/* Extracted rather than stubbed, on the same principle as centsOf above: if
   either file's fee amount or window length is renamed or deleted, that has to
   fail loudly here instead of this test quietly supplying a number of its own
   and proving nothing. A stubbed $30 would agree with itself forever. */
const clientFeeSrc = extractConst(moneySrc, 'LIGHT_CHANGE_FEE');
const serverFeeSrc = extractConst(fnsSrc, 'LIGHT_CHANGE_FEE');
const clientWinSrc = extractConst(moneySrc, 'LIGHT_WINDOW_MS');
const serverWinSrc = extractConst(fnsSrc, 'LIGHT_WINDOW_MS');

const found = {
  'js/money.js computeInvoiceStatus': clientStatusSrc,
  'functions/index.js computeInvoiceStatusServer': serverStatusSrc,
  'js/money.js custInvoiceKey': clientKeySrc,
  'functions/index.js invoiceKeyFor': serverKeySrc,
  'functions/index.js digitsOnly': digitsOnlySrc,
  'js/money.js centsOf': clientCentsSrc,
  'functions/index.js centsOf': serverCentsSrc,
  'js/money.js applyLightChange': clientLightSrc,
  'functions/index.js applyLightChangeServer': serverLightSrc,
  'js/money.js LIGHT_CHANGE_FEE': clientFeeSrc,
  'functions/index.js LIGHT_CHANGE_FEE': serverFeeSrc,
  'js/money.js LIGHT_WINDOW_MS': clientWinSrc,
  'functions/index.js LIGHT_WINDOW_MS': serverWinSrc
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

const clientStatus = compile([clientCentsSrc, clientStatusSrc], 'computeInvoiceStatus');
const serverStatus = compile([serverCentsSrc, serverStatusSrc], 'computeInvoiceStatusServer');
const clientKey = compile([clientKeySrc], 'custInvoiceKey');
const serverKey = compile([digitsOnlySrc, serverKeySrc], 'invoiceKeyFor');
const clientLight = compile([clientFeeSrc, clientWinSrc, clientLightSrc], 'applyLightChange');
const serverLight = compile([serverFeeSrc, serverWinSrc, serverLightSrc], 'applyLightChangeServer');

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
// 4. The light-change rule — both copies must reach the same answer about
//    whether somebody is charged $30, where that $30 lands, and whether they
//    may be put on a route.
//
//    ⚠ PARITY ALONE IS NOT ENOUGH HERE. Two copies that are wrong in the same
//    way agree perfectly. So the sweep below is followed by checks on what the
//    answer actually IS, in the owner's own terms.
// ---------------------------------------------------------------------------
const NOW = 1755000000000;                       // a fixed clock; the rule takes it as input
const HOUR = 60 * 60 * 1000;
const LIGHTS = ['', 'Warm White', 'Red, Green', 'Pure White'];
const WINDOWS = [
  0,                       // never had one — an old customer
  NOW - HOUR,              // expired an hour ago
  NOW - 1,                 // expired a millisecond ago
  NOW,                     // expires exactly now (must NOT count as inside)
  NOW + 1,                 // one millisecond left
  NOW + HOUR,              // inside
  NOW + 47 * HOUR          // just opened
];

let lightCombos = 0, lightMismatch = null;
for (const oldLights of LIGHTS) {
  for (const newLights of LIGHTS) {
    for (const lockedUntil of WINDOWS) {
      for (const invoiceSent of [true, false]) {
        for (const scheduled of [true, false]) {
          lightCombos++;
          const args = { oldLights, newLights, lockedUntil, invoiceSent, scheduled, nowMs: NOW };
          const a = JSON.stringify(clientLight(args));
          const b = JSON.stringify(serverLight(args));
          if (a !== b && !lightMismatch) lightMismatch = { args, office: a, server: b };
        }
      }
    }
  }
}

check('the two light-change rules agree across ' + lightCombos.toLocaleString() + ' combinations',
  !lightMismatch,
  lightMismatch
    ? JSON.stringify(lightMismatch.args) +
      '  →  office ' + lightMismatch.office + ', portal ' + lightMismatch.server
    : '');

// Messy values, the same way the status formulas are swept.
const LIGHT_JUNK = [null, undefined, '', 0, 'Warm White', '   ', NaN];
let lightJunkMismatch = null;
LIGHT_JUNK.forEach(oldLights => {
  LIGHT_JUNK.forEach(newLights => {
    [null, undefined, NaN, '', 0, NOW + HOUR].forEach(lockedUntil => {
      const args = { oldLights, newLights, lockedUntil, invoiceSent: false,
                     scheduled: false, nowMs: NOW };
      const a = JSON.stringify(clientLight(args));
      const b = JSON.stringify(serverLight(args));
      if (a !== b && !lightJunkMismatch) lightJunkMismatch = { args, office: a, server: b };
    });
  });
});
check('the two light-change rules agree on blank / missing / broken values',
  !lightJunkMismatch,
  lightJunkMismatch
    ? JSON.stringify(lightJunkMismatch.args) +
      '  →  office ' + lightJunkMismatch.office + ', portal ' + lightJunkMismatch.server
    : '');

/* ---- and that the answer is the RIGHT one, in the owner's terms ---- */
const ask = (o) => clientLight(Object.assign({ oldLights: 'Warm White', newLights: 'Red, Green',
  lockedUntil: 0, invoiceSent: false, scheduled: false, nowMs: NOW }, o));

check('a colour change outside the window charges $30',
  ask({}).feeAmount === 30,
  'owner: the light change fee is its own charge again, separate from the new-member fee');

check('and it opens a fresh 48-hour window, so they cannot be routed yet',
  ask({}).lightsLockedUntil === NOW + 48 * HOUR && ask({}).opensNewWindow === true,
  'owner: "if an old costumer or a new costumer outside the 48 hour window changes ' +
  'lights than they should not be scheduled for another 48 hours"');

check('a change INSIDE the window is free',
  ask({ lockedUntil: NOW + HOUR }).feeAmount === 0,
  'owner: "we won\'t schedule them within that 48 hours so they can change there ' +
  'lights again if they choose"');

/* ⚠ A free change must not push the window out. Extending it on every save
   would let somebody hold their own window open forever and never be routed. */
check('and it does NOT extend the window',
  ask({ lockedUntil: NOW + HOUR }).lightsLockedUntil === 0 &&
  ask({ lockedUntil: NOW + HOUR }).opensNewWindow === false,
  'a window that renews on every free save never closes, and they are never scheduled');

check('a window that expires exactly now is closed, not open',
  ask({ lockedUntil: NOW }).feeAmount === 30,
  'an off-by-one here is a free change for somebody who should have been charged');

/* Filling colours in for the first time. This is the one that has already gone
   wrong once, sweeping twelve ordinary new customers onto the Color Changes
   sheet — and today's server code charges them, because it tests only that the
   value differs. */
check('filling in colours for the FIRST time is not a change and is not charged',
  ask({ oldLights: '', newLights: 'Warm White' }).feeAmount === 0 &&
  ask({ oldLights: '', newLights: 'Warm White' }).isChange === false &&
  ask({ oldLights: '', newLights: 'Warm White' }).setLightsChangedAt === false,
  'charging somebody for filling in their own colours, and printing them as a colour ' +
  'change, is what the non-empty test on BOTH sides exists to prevent');

check('and clearing colours is not a change either',
  ask({ oldLights: 'Warm White', newLights: '' }).feeAmount === 0 &&
  ask({ oldLights: 'Warm White', newLights: '' }).isChange === false);

check('saving the same colours changes nothing at all',
  ask({ oldLights: 'Warm White', newLights: 'Warm White' }).feeAmount === 0 &&
  ask({ oldLights: 'Warm White', newLights: 'Warm White' }).setLightsChangedAt === false &&
  ask({ oldLights: 'Warm White', newLights: 'Warm White' }).lightsLockedUntil === 0,
  'opening the Lights tab and pressing Save must not charge or re-queue anybody');

/* Where the money goes — the answer to hole F. */
check('a fee before the invoice is sent lands on the current invoice',
  ask({ invoiceSent: false }).feeDestination === 'invoice',
  'owner: "if invoice hasn\'t been sent out than it will be charged on there current invoice"');

check('a fee after the invoice is sent goes to NEXT season',
  ask({ invoiceSent: true }).feeDestination === 'nextSeason',
  'owner: "if invoice has already been sent out ... than the 30 dollars will be ' +
  'charged for next season". invoiceEmailSent is only cleared by Start New Season, ' +
  'so a fee added to a sent invoice would never be posted to anybody');

check('and no fee has no destination',
  ask({ lockedUntil: NOW + HOUR }).feeDestination === 'none',
  'a destination without a fee is a $0 line on somebody\'s bill');

check('changing the lights of a customer already on a route raises the reassign note',
  ask({ scheduled: true }).raiseReassignNote === true &&
  ask({ scheduled: false }).raiseReassignNote === false,
  'the crew would otherwise hang the pattern that was on their card this morning');

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
