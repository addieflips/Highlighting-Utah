#!/usr/bin/env node
/* ============================================================================
 * NO LATE FEE ON A BILL NOBODY SENT, AND A LIST OF WHOSE DID NOT GO ([[EM-33]])
 * `npm run test:notsent` — its own file per R-018.
 *
 * Addie, 2026-10-13: "if invoice was never sent than they should not get a fee however we
 * need something to tell us whos invoice did not get sent."
 *
 * ⛔ RUN, NOT MATCHED. The April batch is lifted out of functions/index.js and run in its
 * dry-run mode over a fake book; the office rule is run over the same houses and must agree.
 * ⛔ `invoicedAt` IS NOT "SENT" — the run stamps it before the send — so the fixture that
 * matters most is a bill carrying invoicedAt whose email never went.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); return; }
  fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function lift(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  const open = src.indexOf('{', src.indexOf(')', m.index));
  let depth = 0, inLine = false, inBlock = false, quote = null, esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (esc) { esc = false; continue; }
    if (quote) { if (ch === '\\') esc = true; else if (ch === quote) quote = null; continue; }
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i++; } continue; }
    if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(m.index, i + 1);
  }
  return null;
}
const fns = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const constLine = (src, name) => (new RegExp('const ' + name + '\\s*=[^;]+;').exec(src) || [''])[0];

console.log('\n=== Never sent, never fined — and named ===\n');

/* ---- the two rules agree ---------------------------------------------------- */
const serverSent = new Function(lift(fns, 'invoiceWasSentServer') + '\nreturn invoiceWasSentServer;')();
let officeHouses = [];
const officeSent = new Function('billedHousesFor', lift(admin, 'invoiceWasSent') + '\nreturn invoiceWasSent;')(() => officeHouses);
const sets = [[], [{}], [{ invoiceEmailSent: true }], [{ invoiceSentByHand: true }], [{}, { invoiceEmailSent: true }],
  [{ invoiceEmailSent: 'yes' }], [{ invoiceEmailSent: false, invoiceSentByHand: false }], [{ completed: true }]];
const disagree = sets.filter(hs => { officeHouses = hs.map(d => ({ data: d })); return serverSent(hs) !== officeSent('k'); });
check('the office list and the April run agree on what "sent" means, over ' + sets.length + ' bills',
  disagree.length === 0, disagree.map(x => JSON.stringify(x)).join('; '));
check('a bill emailed by the 7 PM run counts as sent', serverSent([{ invoiceEmailSent: true }]) === true);
check('a bill given by hand counts as sent', serverSent([{ invoiceSentByHand: true }]) === true);
check('any house on the bill is enough — one email goes to the payer for all of them',
  serverSent([{}, { invoiceEmailSent: true }]) === true);
check('a bill with no send on any house is not sent', serverSent([{ completed: true }]) === false);

/* ---- the April run, dry, over a fake book ---------------------------------- */
const names = ['digitsOnly', 'invoiceKeyFor', 'centsOf', 'computeInvoiceStatusServer', 'invoiceWasSentServer',
  'invoiceHousesServer', 'invoiceBookServer', 'lateFeeAmountServer', 'arrearsOnInvoiceServer',
  'arrearsOutstandingServer', 'templateSubjectOr', 'runLateFeeBatch'];
const lifted = names.map(n => [n, lift(fns, n)]);
const missing = lifted.filter(p => !p[1]).map(p => p[0]);
check('the April run and what it calls can be lifted', missing.length === 0, 'missing: ' + missing.join(', '));
const consts = ['LATE_FEE_PAID_SOMETHING', 'LATE_FEE_PAID_NOTHING', 'LATE_FEE_KIND'].map(n => constLine(fns, n)).join('\n');

const DAY = 864e5, NOW = Date.UTC(2027, 3, 1, 17);
const ts = ms => ({ toDate: () => new Date(ms) });
const billed = ts(Date.UTC(2026, 10, 20));
const invoices = [
  { id: '8015550001', name: 'Emailed Emma',   install: 400, deposit: 0, invoicedAt: billed, billedHouseIds: ['h1'] },
  { id: '8015550002', name: 'Failed Fran',    install: 400, deposit: 0, invoicedAt: billed, billedHouseIds: ['h2'] },
  { id: '8015550003', name: 'ByHand Hal',     install: 400, deposit: 0, invoicedAt: billed, billedHouseIds: ['h3'] },
  { id: '8015550004', name: 'NoIds Nora',     install: 400, deposit: 0, invoicedAt: billed },
  { id: '8015550005', name: 'Paid Pat',       install: 400, deposit: 400, invoicedAt: billed, billedHouseIds: ['h5'] }
];
const houses = [
  { id: 'h1', phone: '8015550001', invoiceEmailSent: true },
  { id: 'h2', phone: '8015550002', invoiceEmailSent: false, completed: true },
  { id: 'h3', phone: '8015550003', invoiceSentByHand: true },
  { id: 'h4', phone: '8015550004' },
  { id: 'h5', phone: '8015550005' }
];
const docsOf = list => ({ docs: list.map(r => ({ id: r.id, data: () => r, ref: { update: async () => { throw new Error('dry run wrote'); } } })) });
const db = { collection(nm) {
  if (nm === 'settings') return { doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }) };
  if (nm === 'invoices') return { get: async () => docsOf(invoices) };
  if (nm === 'jobAddresses') return { get: async () => docsOf(houses) };
  throw new Error('unexpected collection ' + nm);
} };
const sandbox = {
  db, admin: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
  findTemplateSnapByName: async () => ({ empty: true, docs: [] }),
  invoiceFeeChaseDateServer: d => new Date(d.getTime() + 30 * DAY),
  invoiceDueDateServer: d => new Date(d.getTime() + 30 * DAY),
  properNameServer: n => String(n || ''), fetch: async () => { throw new Error('dry run sent'); }
};
let runP = Promise.resolve(null);
if (!missing.length) {
  try {
    const keys = Object.keys(sandbox);
    const run = new Function(...keys, consts + '\n' + lifted.map(p => p[1]).join('\n') + '\nreturn runLateFeeBatch;')(...keys.map(k => sandbox[k]));
    runP = run('test', { dryRun: true, nowMs: NOW });
  } catch (e) { check('the April run builds', false, e.message); }
}
runP.then(out => {
  if (!out) { check('the April run ran', false); return; }
  const charged = out.names.join(' | ');
  check('a bill emailed in November is fined in April', /Emailed Emma/.test(charged), charged);
  check('a bill given by hand is fined too — they had it', /ByHand Hal/.test(charged), charged);
  check('a bill whose email FAILED is not fined, though it carries invoicedAt', !/Failed Fran/.test(charged),
    'invoicedAt is stamped before the send; reading it as "sent" fines somebody who never saw the bill');
  check('a bill with no billedHouseIds is looked up by its key, and not fined when unsent', !/NoIds Nora/.test(charged));
  check('and the unsent ones are NAMED in the run\'s own report',
    out.notSent.indexOf('Failed Fran') !== -1 && out.notSent.indexOf('NoIds Nora') !== -1, JSON.stringify(out.notSent));
  check('a paid bill is not on the not-sent list — only people who WOULD have been fined',
    out.notSent.indexOf('Paid Pat') === -1);
  check('exactly two would be charged', out.wouldCharge === 2, 'got ' + out.wouldCharge);

  /* ---- the office shows it ---------------------------------------------------- */
  check('the Invoice List has a "not sent" filter box', /id="invFilterNotSent"/.test(admin));
  check('and the list honours it through the one reason rule',
    /activeInvFilters\.notsent\) filtered = filtered\.filter\(item => !!invoiceNotSentReason\(item\)\)/.test(admin));
  check('the status strip counts them', /invoiceNotSentReason\(item\)\)\{\r?\n\s*tally\['Not sent'\]\.n\+\+/.test(admin));
  check('the late-fee report names who was not charged and why', /res\.notSent\.map/.test(admin));
  const reasonSrc = lift(admin, 'invoiceNotSentReason') || '';
  let hs = [];
  const reason = new Function('billedHousesFor', lift(admin, 'invoiceWasSent') + '\n' + reasonSrc + '\nreturn invoiceNotSentReason;')(() => hs);
  const billedInv = { id: 'k', data: { invoicedAt: billed, email: 'a@b.co' } };
  hs = [{ data: { email: 'a@b.co' } }];
  check('a billed bill nobody sent is listed, with the email reason', /did not go out/.test(reason(billedInv)));
  hs = [{ data: {} }];
  check('and with no email anywhere it says so', /no email address/.test(reason({ id: 'k', data: { invoicedAt: billed } })));
  hs = [{ data: { invoiceEmailSent: true } }];
  check('a sent bill is not listed', reason(billedInv) === '');
  hs = [{ data: {} }];
  check('a bill the run has not reached is not listed', reason({ id: 'k', data: {} }) === '');
  check('a bill the run has not reached yet is NOT reported as unsent', /if\(!d\.invoicedAt\) return '';/.test(reasonSrc));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.log('  FAIL  the April run threw: ' + e.message); process.exit(1); });
