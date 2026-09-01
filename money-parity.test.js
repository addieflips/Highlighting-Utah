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

/* A KNOWN disconnect: reported on every run, but it does NOT fail the build.
 * Same helper, same reasoning, as gap() in run-all.js — this suite gates the
 * Cloud Functions deploy (deploy-functions.yml `needs:` it), so failing here
 * over a bug that is already live in production would block every money fix
 * behind the very thing being fixed. When the gap closes, the line flips to
 * PASS on its own with no edit here. */
const gaps = [];
function gap(label, fixed, detail) {
  if (fixed) { pass++; }
  else { gaps.push(label + ' — ' + detail); }
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

// 5. THE AMOUNT OWED — the half this test did not cover until 2026-08-21.
//
// Everything above compares the invoice STATUS ("Paid in Full") and the invoice
// KEY. Neither is the number anyone argues about. The number that gets charged,
// displayed and disputed is the BALANCE:
//
//     owed = (install + removal + changeFees) - credits - deposit, floored at 0
//
// and that is written out by hand in eleven places across three files. R-015
// used to claim money lived in exactly two parity-tested places; it did not,
// and this section is what makes the claim testable.
//
// HOW: each site is lifted out of the REAL file by a unique anchor and run
// against the same records as balanceDueAmount(). Nothing is re-typed here —
// re-typing a formula into a test proves the test agrees with itself.
//
// ⚠ THREE QUANTITIES, NOT ONE. A naive sweep flags two correct sites as broken:
//   balance          gross - credits - deposit, floored   <- the amount owed
//   gross            install + removal + changeFees       <- the charge, pre-payment
//   netCharge        gross - credits                      <- what a "mark paid
//                                                            in full" writes INTO
//                                                            deposit, so it must
//                                                            NOT subtract deposit
// A check that cries wolf is one the office learns to scroll past, so each site
// declares which quantity it is and is compared only against its own kind.
// ---------------------------------------------------------------------------

/* Lift a slice of real source: from a unique anchor, up to and including the
 * statement that assigns `resultVar`. Returns null if the anchor is not unique
 * or not found — which FAILS below rather than skipping, same rule as §1. */
function sliceTo(src, site) {
  const at = src.indexOf(site.locator);
  if (at === -1) return null;
  if (src.indexOf(site.locator, at + 1) !== -1) return null;   // ambiguous locator
  /* startAt is normally the first statement the formula needs, found after the
     locator. `back` looks BEHIND it instead, for the one site whose first
     needed statement sits above its only unique landmark. */
  const s0 = site.back ? src.lastIndexOf(site.startAt, at) : src.indexOf(site.startAt, at);
  if (s0 === -1) return null;
  const assignAt = src.indexOf(site.result + ' =', s0);
  if (assignAt === -1) return null;
  const end = src.indexOf(';', assignAt);
  if (end === -1) return null;
  return src.slice(s0, end + 1);
}

/* Wrap a lifted slice into a callable of the record. */
function amountFn(slice, inputVar, returnExpr) {
  const sandbox = {};
  vm.createContext(sandbox);
  /* ⚠ centsOf comes along with every slice, LIFTED from js/money.js rather than
     re-typed. The member portal now rounds to whole cents like the office copy —
     it is a module, so it imports the real helper — and a slice that calls it
     needs it in scope here. Harmless for the sites that do not. */
  vm.runInContext(
    clientCentsSrc + '\n' +
    'this.__fn = function (' + inputVar + ') {\n' + slice + '\nreturn ' + returnExpr + ';\n};',
    sandbox
  );
  return sandbox.__fn;
}

const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const portalSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* The reference. Every `balance` site below must match it exactly. */
const balanceDueSrc = extractFn(adminSrc, 'balanceDueAmount');

const SITES = [
  // ---- admin.html -------------------------------------------------------
  /* ⚠ `balance` here is an INTERMEDIATE. The exported cell is
     `Balance: Math.max(balance,0)` — the floor lives at the point of use, not
     on the variable. Comparing the bare variable reported a bug that does not
     exist (a negative balance for a credit-heavy invoice). So the comparison
     returns what is actually exported, and a separate check below pins the
     floor in place so removing it cannot go unnoticed. */
  { label: 'admin.html  invoice CSV export "Balance"',
    src: 'admin', kind: 'balance', input: 'd', result: 'balance',
    returnExpr: 'Math.max(balance, 0)',
    locator: 'currentInvoicesForExport.map(function(d){', startAt: 'const balance =' },

  { label: 'admin.html  Dashboard money tally',
    src: 'admin', kind: 'balance', input: 'd', result: 'owed',
    locator: '    tally[st].n++;', startAt: 'const owed =' },

  /* ⚠ Unfloored, and that is fine: it is printed ONLY inside the
     `liveStatus === 'Partial Payment'` branch, and in that state the balance is
     positive by definition. Comparing it over every record flagged a negative
     that can never reach a screen. Compared where it is shown, which is the
     claim worth making. */
  { label: 'admin.html  invoice row balance (shown on Partial Payment)',
    src: 'admin', kind: 'balance', input: 'd', result: 'balance',
    when: m => clientStatus(m.install, m.removal, m.deposit, m.credits, m.changeFees) === 'Partial Payment',
    locator: "if(activeInvFilters.overdue) filtered = filtered.filter(item => isInvoiceOverdue(item.data));",
    startAt: 'const balance =' },

  { label: 'admin.html  payment-history CSV',
    src: 'admin', kind: 'balance', input: 'r', result: 'balance',
    locator: 'const charged = (Number(r.install)||0)', startAt: 'const charged =' },

  { label: 'admin.html  pay-status dropdown data-total',
    src: 'admin', kind: 'netCharge', input: 'item', result: 'DATA_TOTAL',
    expr: 'DATA_TOTAL = ((item.data.install||0)+(item.data.removal||0)+(item.data.changeFees||0)-(item.data.credits||0))' },

  { label: 'admin.html  mark-prepaid-from-sheet',
    src: 'admin', kind: 'netCharge', input: 'd', result: 'owed',
    locator: '      const owed = (Number(d.install) || 0) + (Number(d.removal) || 0) +',
    startAt: 'const owed =' },

  // ---- functions/index.js ----------------------------------------------
  { label: 'functions/index.js  payment receipt email',
    src: 'fns', kind: 'balance', input: 'inv', result: 'amountDue',
    locator: '    if (inv.receiptSentForDeposit === deposit) return;',
    startAt: 'const deposit = Number(inv.deposit) || 0;', back: true },

  { label: 'functions/index.js  paypalCreateOrder - THE CARD CHARGE',
    src: 'fns', kind: 'balance', input: 'inv', result: 'balanceDue',
    locator: "throw new HttpsError('not-found', 'No invoice found for this phone.');",
    startAt: 'const total = (Number(inv.install)' },

  { label: 'functions/index.js  paypalCaptureOrder - service vs tip split',
    src: 'fns', kind: 'balance', input: 'inv', result: 'balanceDue',
    locator: '      const owed = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);',
    startAt: 'const owed =' },

  { label: 'functions/index.js  carryover credit draw-down',
    src: 'fns', kind: 'balance', input: 'inv', result: 'preBalance',
    locator: 'const grossNow = (Number(inv.install) || 0)', startAt: 'const grossNow =' },

  { label: 'functions/index.js  nightly invoice email "amount due"',
    src: 'fns', kind: 'balance', input: 'inv', result: 'amountDue',
    locator: '        const changeFeesTotal = Number(inv.changeFees) || 0;',
    startAt: 'const changeFeesTotal =' },

  // ---- index.html (the member portal) ----------------------------------
  { label: 'index.html  member portal balance - WHAT THE CUSTOMER SEES',
    src: 'portal', kind: 'balance', input: 'record', result: 'totalDue',
    locator: 'var invInstall   = Number(record.install)', startAt: 'var invInstall' },
];

const SRC_BY_NAME = { admin: adminSrc, fns: fnsSrc, portal: portalSrc };

check('found admin.html balanceDueAmount', !!balanceDueSrc,
  'the reference formula is gone — the amount can no longer be compared to anything');

let amountMissing = !balanceDueSrc;
const lifted = [];
for (const s of SITES) {
  let fn = null, why = '';
  try {
    if (s.expr) {
      fn = amountFn('let ' + s.expr + ';', s.input, s.result);
    } else {
      const slice = sliceTo(SRC_BY_NAME[s.src], s);
      if (!slice) why = 'anchor not found, or no longer unique';
      else fn = amountFn(slice, s.input, s.returnExpr || s.result);
    }
  } catch (e) { why = e.message; }
  check('lifted ' + s.label, !!fn,
    why || 'could not be extracted — this site is now UNGUARDED, which is how the amount drifted in the first place');
  if (!fn) amountMissing = true;
  lifted.push(Object.assign({}, s, { fn }));
}

if (amountMissing) {
  console.log('\nCannot compare the amount — a site above could not be lifted.');
  console.log('Fix the anchor in this test, or restore the code. Do NOT ignore this.\n');
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(1);
}

const reference = compile([balanceDueSrc], 'balanceDueAmount');

/* The records each site expects. Same numbers, three shapes, because the sites
   were written against different variable names. */
function recordsFor(input, m) {
  const flat = { install: m.install, removal: m.removal, changeFees: m.changeFees,
                 credits: m.credits, deposit: m.deposit };
  return input === 'item' ? { data: flat } : flat;
}

const AMT = [0, 0.01, 1, 25, 30, 250, 499.99, 500, 750, 1200, 5000];
const SML = [0, 25, 30, 50, 60, 500];
const FEE = [0, 30, 60];

const siteMismatch = {};
let amountCombos = 0;

for (const install of AMT) {
  for (const removal of SML) {
    for (const deposit of AMT) {
      for (const credits of SML) {
        for (const changeFees of FEE) {
          amountCombos++;
          const m = { install, removal, changeFees, credits, deposit };
          const gross = install + removal + changeFees;
          const expected = {
            balance: Math.max(gross - credits - deposit, 0),
            gross: gross,
            netCharge: gross - credits
          };
          for (const s of lifted) {
            if (siteMismatch[s.label]) continue;          // first example is enough
            if (s.when && !s.when(m)) continue;           // only where the value is actually used
            const got = s.fn(recordsFor(s.input, m));
            const want = s.kind === 'balance' ? reference(m) : expected[s.kind];
            if (Math.abs(got - want) > 1e-9) {
              siteMismatch[s.label] = { m, got, want };
            }
          }
        }
      }
    }
  }
}

for (const s of lifted) {
  const bad = siteMismatch[s.label];
  check(s.label + ' agrees with balanceDueAmount across ' +
        amountCombos.toLocaleString() + ' combinations',
    !bad,
    bad ? JSON.stringify(bad.m) + '  →  this site says ' + bad.got +
          ', balanceDueAmount says ' + bad.want : '');
}

/* The CSV export's floor lives at the point of use, not on the variable the
   comparison above lifts. If someone deletes it, `balance` goes straight into
   the spreadsheet and a credit-heavy invoice exports as a negative amount owed.
   Pinned here because the behavioural check cannot see it. */
check('the invoice CSV export still floors its Balance column at zero',
  adminSrc.indexOf('Balance: Math.max(balance,0)') !== -1,
  'the `Math.max(balance,0)` on the exported Balance cell is gone — a customer ' +
  'whose credits exceed their charge would export as owing a negative amount');

/* ---------------------------------------------------------------------------
 * The cent-rounding gap, pinned to an exact reproducer.
 *
 * js/money.js rounds to whole cents (centsOf) precisely so a floating-point
 * crumb cannot be the difference between "Paid in Full" and "Partial Payment".
 * The portal's totalDue does no such rounding, so it can land on a residue:
 * fmt() prints "$0.00" while the code reads it as a positive balance and shows
 * "Balance Due", and the Venmo link is pre-filled with $0.00.
 *
 * REACHABILITY, measured rather than asserted: with whole-dollar prices this
 * never fires (0 of 12,609 combinations swept). It needs cents somewhere in
 * install / removal / changeFees / credits, and then fires on about 2% of
 * exactly-settled invoices. So it is real but narrow, and whether any live
 * customer sits on it depends on whether prices carry cents — which cannot be
 * answered from this repo. See docs/open-questions.md Q-001.
 *
 * Reported as a GAP, not a failure: it is a known disconnect, and failing the
 * build here would block the Cloud Functions deploy (deploy-functions.yml
 * needs this suite) over a bug that is already in production. It flips to PASS
 * on its own when the portal is routed through the shared balance helper.
 * ------------------------------------------------------------------------ */
const portal = lifted.find(s => s.label.indexOf('member portal') !== -1);
const crumb = { install: 100.04, removal: 0, changeFees: 30, credits: 0, deposit: 130.04 };
const crumbDue = portal.fn(recordsFor(portal.input, crumb));
const crumbStatus = clientStatus(crumb.install, crumb.removal, crumb.deposit, crumb.credits, crumb.changeFees);

/* ⭐ PROMOTED FROM gap() TO check(), 2026-08-21, the day it was fixed.
   While the bug was live a gap was right: this suite gates the Cloud Functions
   deploy, and failing over a bug already in production would have blocked the fix
   behind itself. That reasoning expires the moment it is fixed — a gap only
   REPORTS, so leaving it as one meant someone could revert the rounding and the
   build would stay green. A regression has to fail now. */
check('the portal balance is cent-rounded the way the office copy is',
  crumbDue === 0,
  'install $100.04 + $30.00 fee - $130.04 paid leaves ' + crumbDue + ' in index.html, ' +
  'which renders as "$0.00" while the code reads it as money owed and shows "Balance Due". ' +
  'The office screen says "' + crumbStatus + '" for the same invoice. ' +
  'Fix: route the portal through the shared balance helper, or apply centsOf.');

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WHO IS ON THE BILL — the two copies must agree (added 2026-08-26, Q-012).
//
// Addie, 2026-08-26: "After the last persons house is done if there are multiple
// people on one bill is when they will be charged." The nightly run holds a
// multi-house bill until every house on it is complete, so WHO is counted decides
// whether that bill ever goes out at all. Before this, a house that had answered
// Back Next Year was still counted as one to wait for — and answering that pulls
// them off every upcoming route, so it can never be completed and the whole
// household's bill was held open for the season.
//
// This is money in exactly the way computeInvoiceStatus is: the browser decides
// what the office sees on the Who Pays for Whom screen, the server decides who is
// actually billed. Two copies that disagree bill somebody the office cannot see.
// ---------------------------------------------------------------------------
{
  const clientBillSrc = extractFn(adminSrc, 'houseIsOnTheBill');
  const serverBillSrc = extractFn(fnsSrc, 'houseIsOnTheBillServer');
  check('houseIsOnTheBill found in admin.html', !!clientBillSrc,
    'renamed or removed — a missing copy must FAIL, never skip');
  check('houseIsOnTheBillServer found in functions/index.js', !!serverBillSrc,
    'renamed or removed — a missing copy must FAIL, never skip');

  if (clientBillSrc && serverBillSrc) {
    const onBill = compile([clientBillSrc], 'houseIsOnTheBill');
    const onBillServer = compile([serverBillSrc], 'houseIsOnTheBillServer');

    // Every combination that can reach either copy, not a hand-picked few.
    /* The extra spellings are folded in from the billing-groups branch's own sweep,
       when the two copies of this rule were collapsed into one (2026-08-26).
       ⚠ AND NONE OF THEM CATCHES ANYTHING THE LIST ALREADY CAUGHT — measured, not
       assumed: dropping ' backnextyear ' and then removing .trim() from a copy still
       FAILS, because '  no  ' was already here and the trim is shared by every
       branch. 'maybe' and 'cancelled' are covered the same way by 'unanswered'.
       They are kept as symmetry insurance for the day a branch grows its own
       normalisation, which is worth four array entries and is NOT the same claim as
       "these find a bug today". Said plainly so nobody reads this list as proof of
       coverage it does not give. */
    const STATES = ['', 'yes', 'no', 'NO', 'backnextyear', 'unanswered', 'YES',
                    'BackNextYear', '  no  ', ' backnextyear ', 'maybe', 'cancelled'];
    const DONE = [true, false, undefined, null, 'true', 1, 0];
    const MAYBE = [true, false, undefined, null];
    let compared = 0, disagreed = 0, firstBad = null;
    STATES.forEach(function (rsvpStatus) {
      DONE.forEach(function (completed) {
        MAYBE.forEach(function (maybeNextYear) {
          const d = { rsvpStatus: rsvpStatus, completed: completed, maybeNextYear: maybeNextYear };
          const a = onBill(d), b = onBillServer(d);
          compared++;
          if (a !== b && !firstBad) { firstBad = JSON.stringify(d) + ' → browser ' + a + ', server ' + b; }
          if (a !== b) disagreed++;
        });
      });
    });
    // Null and undefined reach these too — portalInvoice hands over whatever it read.
    [null, undefined, {}].forEach(function (d) {
      compared++;
      if (onBill(d) !== onBillServer(d) && !firstBad) firstBad = String(d) + ' disagrees';
      if (onBill(d) !== onBillServer(d)) disagreed++;
    });
    check('the browser and the server agree about who is on a bill (' + compared + ' cases)',
      disagreed === 0, firstBad || '');

    // And the answers are RIGHT, not merely equal — two copies wrong the same way
    // agree perfectly. These are the four cases the ruling actually turns on.
    check('a house sitting the season out, never worked on, is NOT waited for',
      onBill({ rsvpStatus: 'backnextyear', completed: false }) === false &&
      onBillServer({ rsvpStatus: 'backnextyear', completed: false }) === false,
      'this is Q-012: counting it held the whole household\'s bill open all season');
    check('and the office Maybe Next Year toggle counts the same',
      onBill({ maybeNextYear: true, completed: false }) === false &&
      onBillServer({ maybeNextYear: true, completed: false }) === false,
      'it sets the same two fields as the customer answering through the link');
    check('but a house that WAS worked on still owes, whatever it said afterwards',
      onBill({ rsvpStatus: 'backnextyear', completed: true }) === true &&
      onBillServer({ rsvpStatus: 'backnextyear', completed: true }) === true,
      'pullCustomerFromSeason: "not coming back next year is not the same as not ' +
      'owing for last year" — filtering on the RSVP alone would drop a house that owes');
    check('an ordinary house waiting on the crew is still waited for',
      onBill({ rsvpStatus: 'yes', completed: false }) === true &&
      onBillServer({ rsvpStatus: 'yes', completed: false }) === true,
      'her rule is that the bill goes after the LAST house is done — this is what ' +
      'makes it wait at all');
    check('a flat "no" that was never hung comes off the bill',
      onBill({ rsvpStatus: 'no', completed: false }) === false &&
      onBillServer({ rsvpStatus: 'no', completed: false }) === false,
      'nothing was done, so there is nothing to charge for');
    /* ⭐ Q-013, 2026-08-26. Addie: "Any house hung no matter what should be charged.
       This will only be overuled if it is our fault." Q-012 deliberately left the
       flat "no" alone because it had not been asked about; this is the answer, and
       it is the case that had to be tested explicitly — the old check used
       completed:false and so stayed green through the whole change. */
    check('but a house that was HUNG is charged, whatever it said afterwards',
      onBill({ rsvpStatus: 'no', completed: true }) === true &&
      onBillServer({ rsvpStatus: 'no', completed: true }) === true,
      'hung is hung — writing it off when it is our fault is the office\'s decision ' +
      'on the invoice, never an automatic test in here');
    check('and completed is tested BEFORE any status, which is what makes that true',
      onBill({ rsvpStatus: 'no', maybeNextYear: true, completed: true }) === true &&
      onBillServer({ rsvpStatus: 'no', maybeNextYear: true, completed: true }) === true,
      'every way of being out of the season at once still loses to having been hung');
    /* ⚠ THE BILLING-GROUPS BRANCH ASSERTED THE OPPOSITE OF THE TWO CHECKS ABOVE, and
       it was RIGHT when it was written — it locked in the Q-012 status quo, where a
       flat "no" was deliberately left alone because Addie had not been asked about it.
       She was asked on 2026-08-26 and answered: "Any house hung no matter what should
       be charged." So that check is superseded by a dated ruling, not overruled by a
       preference, and it is recorded here so nobody restores it from the other branch
       without meeting the ruling first. See Q-013 and MON-21. */
  }
}

// ---------------------------------------------------------------------------
// Last season's carried balance — the browser copy vs the server copy.
//
// ⭐ THIS ONE DECIDES WHAT A CARD IS ACTUALLY CHARGED (added 2026-09-01).
// paypalCreateOrder charges the outstanding carried amount first, so a drift
// between these two copies means the office screen and the payment button ask
// a customer for two different amounts — and the one the customer sees wins.
//
// ⚠ AND IT DECIDES WHO GETS A CREW. The same figure, at zero, is what releases
// somebody from the season hold. Wrong here is either a crew sent to a house
// that never paid, or a paid-up customer left off every route.
// ---------------------------------------------------------------------------
{
  const cArrSrc = extractFn(moneySrc, 'arrearsOnInvoice');
  const sArrSrc = extractFn(fnsSrc, 'arrearsOnInvoiceServer');
  const cOutSrc = extractFn(moneySrc, 'arrearsOutstanding');
  const sOutSrc = extractFn(fnsSrc, 'arrearsOutstandingServer');
  const cKindSrc = extractConst(moneySrc, 'ARREARS_KIND');
  const sKindSrc = extractConst(fnsSrc, 'ARREARS_KIND_SERVER');

  /* Missing is a FAIL, never a skip — a rename that silently stopped this
     comparing anything would report green while the two copies drifted. */
  const missing = [
    ['arrearsOnInvoice (js/money.js)', cArrSrc],
    ['arrearsOnInvoiceServer (functions)', sArrSrc],
    ['arrearsOutstanding (js/money.js)', cOutSrc],
    ['arrearsOutstandingServer (functions)', sOutSrc],
    ['ARREARS_KIND (js/money.js)', cKindSrc],
    ['ARREARS_KIND_SERVER (functions)', sKindSrc]
  ].filter(([, src]) => !src).map(([name]) => name);
  check('both copies of the carried-balance rule are findable',
    missing.length === 0, 'could not extract: ' + missing.join(', '));

  if (!missing.length) {
    const clientOut = compile([cKindSrc, clientCentsSrc, cArrSrc, cOutSrc], 'arrearsOutstanding');
    const serverOut = compile([sKindSrc, serverCentsSrc, sArrSrc, sOutSrc], 'arrearsOutstandingServer');
    const clientArr = compile([cKindSrc, cArrSrc], 'arrearsOnInvoice');
    const serverArr = compile([sKindSrc, sArrSrc], 'arrearsOnInvoiceServer');

    /* ⚠ THE FIXTURES MUST INCLUDE A LEDGER THAT IS NOT ALL ARREARS. A light-change
       fee sitting beside the carried line is the case where reading the whole of
       changeFees instead of the tagged notes gives a different answer — and it is
       the difference between charging somebody $400 and charging them $430. */
    const amounts = [0, 0.1, 30, 400, 400.55, 800, 1234.56];
    const paids = [0, 0.1, 30, 399.99, 400, 400.55, 5000];
    const creds = [0, 25, 400];
    const ledgers = [
      a => [],
      a => [{ amount: a, kind: 'arrears' }],
      a => [{ amount: 30, reason: 'Light change' }, { amount: a, kind: 'arrears' }],
      a => [{ amount: a / 2, kind: 'arrears' }, { amount: a / 2, kind: 'arrears', source: 'office' }],
      a => [{ amount: 30, kind: 'manual' }]
    ];
    let mismatch = null, runs = 0;
    for (const a of amounts) {
      for (const p of paids) {
        for (const c of creds) {
          for (const mk of ledgers) {
            const inv = { changeFeeNotes: mk(a), deposit: p, credits: c };
            runs++;
            const co = clientOut(inv), so = serverOut(inv);
            const ca = clientArr(inv), sa = serverArr(inv);
            if (co !== so || ca !== sa) {
              mismatch = JSON.stringify({ inv, clientOut: co, serverOut: so, clientArr: ca, serverArr: sa });
              break;
            }
          }
          if (mismatch) break;
        }
        if (mismatch) break;
      }
      if (mismatch) break;
    }
    check('the two carried-balance copies agree, over ' + runs + ' invoices',
      !mismatch, mismatch ? 'first disagreement: ' + mismatch : '');

    /* ⚠ EQUAL IS NOT ENOUGH — two copies wrong the same way agree perfectly. These
       pin the ANSWERS, in Addie's own terms. */
    const led = (a) => ({ changeFeeNotes: [{ amount: a, kind: 'arrears' }], deposit: 0, credits: 0 });
    check('billed 400 and paid nothing leaves 400 to pay first',
      clientOut(led(400)) === 400 && serverOut(led(400)) === 400);
    check('paying it in full leaves nothing outstanding',
      clientOut(Object.assign(led(400), { deposit: 400 })) === 0 &&
      serverOut(Object.assign(led(400), { deposit: 400 })) === 0);
    check('a part payment leaves the remainder, not the whole amount',
      clientOut(Object.assign(led(800), { deposit: 400 })) === 400 &&
      serverOut(Object.assign(led(800), { deposit: 400 })) === 400);
    check('a light-change fee is never read as last season\'s debt',
      clientOut({ changeFeeNotes: [{ amount: 30, reason: 'Light change' }], deposit: 0, credits: 0 }) === 0 &&
      serverOut({ changeFeeNotes: [{ amount: 30, reason: 'Light change' }], deposit: 0, credits: 0 }) === 0,
      'that would charge a colour change as though it were an unpaid season');
  }
}

// ---------------------------------------------------------------------------
failures.forEach(f => console.log('  FAIL  ' + f + '\n'));

console.log(pass + ' passed, ' + fail + ' failed' +
  (gaps.length ? ', ' + gaps.length + ' known gap' + (gaps.length === 1 ? '' : 's') : '') + '\n');

gaps.forEach(g => console.log('  GAP   ' + g + '\n'));

if (fail) {
  console.log('Two copies of the money maths DISAGREE.');
  console.log('Do not push. Whichever one changed, the others have to match it.');
  console.log('  status + invoice key:  js/money.js  vs  functions/index.js');
  console.log('  the amount owed:       balanceDueAmount() in admin.html is the reference,');
  console.log('                         and every site listed above must agree with it.\n');
}

process.exit(fail ? 1 : 0);
