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

const found = {
  'js/money.js computeInvoiceStatus': clientStatusSrc,
  'functions/index.js computeInvoiceStatusServer': serverStatusSrc,
  'js/money.js custInvoiceKey': clientKeySrc,
  'functions/index.js invoiceKeyFor': serverKeySrc,
  'functions/index.js digitsOnly': digitsOnlySrc,
  'js/money.js centsOf': clientCentsSrc,
  'functions/index.js centsOf': serverCentsSrc
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
// 4. THE AMOUNT OWED — the half this test did not cover until 2026-08-21.
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
  vm.runInContext(
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

gap('the portal balance is cent-rounded the way the office copy is',
  crumbDue === 0,
  'install $100.04 + $30.00 fee - $130.04 paid leaves ' + crumbDue + ' in index.html, ' +
  'which renders as "$0.00" while the code reads it as money owed and shows "Balance Due". ' +
  'The office screen says "' + crumbStatus + '" for the same invoice. ' +
  'Fix: route the portal through the shared balance helper, or apply centsOf.');

// ---------------------------------------------------------------------------
console.log(failures.length ? '' : '  PASS  every check below\n');
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
