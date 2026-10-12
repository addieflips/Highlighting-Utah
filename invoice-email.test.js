/* THE INVOICE INSIDE THE INVOICE EMAIL (EM-27, 2026-10-12). `npm run test:invoice-email`.
   Its own file per R-018.

   Addie: "On invoice it didn't send the real invoice", then "attached invoice isnt
   showing when it sends." The email had only ever been the template's wording. The
   itemised invoice is now drawn under that wording by ONE block written twice —
   admin.html (the test copy) and functions/index.js (the 7 PM run) — and this file is
   what holds the two copies together: it compares their source and RUNS both over the
   same bills. It also asserts the answers are RIGHT, because two copies wrong in the
   same way agree perfectly. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const adminSrc = read('admin.html');
const fnsSrc = read('functions/index.js');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('  FAIL - ' + name + (detail ? '\n         ' + detail : ''));
}

const START = '/* invoice-email-block:start';
const END = '/* invoice-email-block:end */';
function blockOf(src) {
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  return (a === -1 || b === -1 || b < a) ? '' : src.slice(a, b);
}
const adminBlock = blockOf(adminSrc);
const fnsBlock = blockOf(fnsSrc);
check('admin.html carries the block', adminBlock.length > 500);
check('functions/index.js carries the block', fnsBlock.length > 500);
check('each file carries it exactly once',
  adminSrc.split(START).length === 2 && fnsSrc.split(START).length === 2);
const unServer = s => s.replace(/function (invoiceEmail(?:Rows|Block|Place|Number))Server\(/g, 'function $1(');
check('the two copies are the same text', adminBlock && adminBlock === unServer(fnsBlock),
  'change one, change the other — the test copy and the 7 PM run must draw the same bill');

function load(block, suffix) {
  return new Function(block + '\nreturn { rows: invoiceEmailRows' + suffix +
    ', block: invoiceEmailBlock' + suffix + ', place: invoiceEmailPlace' + suffix + ', number: invoiceEmailNumber' + suffix + ' };')();
}
let A = null, S = null;
try { A = load(adminBlock, ''); S = load(fnsBlock, 'Server'); }
catch (err) { check('both copies load and run', false, String(err)); }

if (A && S) {
  const bills = [
    { name: 'one house, unpaid', rows: { rate: 2, houses: [{ address: '1 Elm St', feet: 125, price: 250 }] },
      total: 250, paid: 0, amountDue: 250, status: 'Unpaid', issued: 'Oct 12, 2026', due: 'Feb 28, 2027',
      season: 2026, invoiceNo: 'HU-2026-2235', properties: 1, venmo: 'HighLightingUtah',
      billTo: { name: 'Test <Person>', address: '209 S 850 W, Lehi, UT', phone: '3853912235' },
      biz: { phone: '(801) 901-0011', email: 'office@example.com', site: 'highlightingutah.com' } },
    { name: 'two houses, fee, change fee, credit, part paid',
      rows: { rate: 2.5, houses: [{ address: '1 Elm St', feet: 160, price: 400 }, { address: '2 Oak <Ave> & Co', feet: 0, price: 350 }],
              removal: 0, newMemberFee: 25, feeNotes: [{ reason: 'Light change', amount: 30 }], creditNotes: [{ reason: 'Referral', amount: 25 }] },
      total: 780, paid: 100, amountDue: 680, status: 'Partial Payment', issued: 'Oct 12, 2026', due: 'Feb 28, 2027', properties: 2 },
    { name: 'paid in full', rows: { rate: 0, houses: [{ address: '', feet: 90, price: 300 }], removal: 40 },
      total: 340, paid: 340, amountDue: 0, status: 'Paid in Full', issued: 'Oct 12, 2026', due: 'Feb 28, 2027',
      paidOn: 'Oct 20, 2026', venmo: 'HighLightingUtah', biz: { site: 'highlightingutah.com' } },
    { name: 'nothing to itemise', rows: { houses: [] }, total: 0, paid: 0, amountDue: 0, status: 'Unpaid' }
  ];
  const out = {};
  bills.forEach(function (b) {
    const ra = A.rows(b.rows), rs = S.rows(b.rows);
    check(b.name + ': both copies build the same rows', JSON.stringify(ra) === JSON.stringify(rs));
    const ha = A.block(Object.assign({}, b, { rows: ra }));
    const hs = S.block(Object.assign({}, b, { rows: rs }));
    check(b.name + ': both copies draw the same invoice', ha === hs);
    check(b.name + ': no newline in it (both senders turn newlines into <br>)', !/[\r\n]/.test(ha));
    check(b.name + ': nothing Outlook drops (no flex, no CSS variables)', !/display:\s*flex|var\(--/.test(ha));
    out[b.name] = { html: ha, rows: ra };
  });

  const one = out['one house, unpaid'];
  check('one house: the footage line and its price are on it',
    one.html.indexOf('Installation service \u2014 125 ft @ $2.00/ft') !== -1 && one.html.indexOf('$250.00') !== -1);
  check('one house: says Amount due and the due date',
    one.html.indexOf('Amount due') !== -1 && one.html.indexOf('Due Feb 28, 2027') !== -1 && one.html.indexOf('Unpaid') !== -1);
  check('one house: no Payment received line when nothing was paid', one.html.indexOf('Payment received') === -1);
  /* ⛔ THE DOCUMENT, NOT A SUMMARY. The first version was a small box of line items and
     Addie put it beside the Invoices tab's invoice: "This is not the invoice we agreed on."
     Every section of that document is asserted here by name. */
  check('one house: the business header is on it',
    ['Highlighting Utah', 'Christmas Lights Installation', '(801) 901-0011', 'office@example.com', 'highlightingutah.com'].every(function (t) { return one.html.indexOf(t) !== -1; }));
  check('one house: the season, the invoice number and the issue date are on it',
    one.html.indexOf('Invoice for 2026 season') !== -1 && one.html.indexOf('HU-2026-2235') !== -1 && one.html.indexOf('Issued Oct 12, 2026') !== -1);
  check('one house: Bill to names them, escaped, with address and phone',
    one.html.indexOf('Bill to') !== -1 && one.html.indexOf('Test &lt;Person&gt;') !== -1 && one.html.indexOf('209 S 850 W, Lehi, UT') !== -1 && one.html.indexOf('3853912235') !== -1);
  check('one house: Description / Amount, Payment status and How to pay are all there',
    ['>Description<', '>Amount<', 'Payment status', 'How to pay', 'Venmo — @HighLightingUtah', 'Cheque — payable to Highlighting Utah'].every(function (t) { return one.html.indexOf(t) !== -1; }));
  check('one house: a single house does not say Covers', one.html.indexOf('Covers') === -1);

  const two = out['two houses, fee, change fee, credit, part paid'];
  check('two houses: each address is its own row', two.rows.length === 5 &&
    two.rows[0].label === '1 Elm St' && two.rows[0].sub.indexOf('160 ft') !== -1 && two.rows[1].sub === 'Installation service');
  check('two houses: an address is escaped, never raw markup',
    two.html.indexOf('2 Oak &lt;Ave&gt; &amp; Co') !== -1 && two.html.indexOf('<Ave>') === -1);
  check('two houses: the credit is a minus, the fees are not',
    two.html.indexOf('\u2212$25.00') !== -1 && two.html.indexOf('\u2212$30.00') === -1);
  const sum = two.rows.reduce(function (t, r) { return t + (r.credit ? -r.amount : r.amount); }, 0);
  check('two houses: the rows add up to the Total printed under them', sum === 780, 'rows sum to ' + sum);
  check('two houses: payment received and what is left',
    two.html.indexOf('Payment received') !== -1 && two.html.indexOf('\u2212$100.00') !== -1 && two.html.indexOf('$680.00') !== -1);

  const paidBill = out['paid in full'];
  check('paid: says Amount paid, never Amount due, and gives no due date',
    paidBill.html.indexOf('Amount paid') !== -1 && paidBill.html.indexOf('Amount due') === -1 && paidBill.html.indexOf('Due ') === -1);
  check('paid: removal is its own row', paidBill.rows.some(function (r) { return r.label === 'Removal service' && r.amount === 40; }));
  check('two houses: says how many properties it covers', two.html.indexOf('Covers 2 properties') !== -1);
  check('paid: says when, and never tells a settled customer how to pay',
    paidBill.html.indexOf('Paid Oct 20, 2026') !== -1 && paidBill.html.indexOf('How to pay') === -1);
  /* The number the 7 PM run prints must be the one the office's printed invoice shows. */
  const nf = adminSrc.indexOf('function invoiceNumberFor(');
  const officeNumber = nf === -1 ? null : new Function(adminSrc.slice(nf, adminSrc.indexOf('\nfunction addDays(', nf)) + '\nreturn invoiceNumberFor;')();
  check('the office invoice-number rule was found', typeof officeNumber === 'function');
  ['3853912235', '8015550444', 'dana@x.com', 'a@b.co', '12', '', 'ZZ-99x'].forEach(function (k) {
    check('invoice number for ' + JSON.stringify(k) + ' matches the printed invoice, in both copies',
      officeNumber && A.number(k, 2026) === officeNumber(k, 2026) && S.number(k, 2026) === officeNumber(k, 2026),
      A.number(k, 2026) + ' / ' + S.number(k, 2026) + ' / ' + (officeNumber && officeNumber(k, 2026)));
  });
  check('nothing to itemise draws nothing at all', out['nothing to itemise'].html === '');

  /* Where it goes. */
  const B = '<BLOCK>';
  const places = [
    ['Hi {{name}},\n\nYour invoice is ready.\n\n{{pay_button}}{{venmo_button}}\n\nThanks', 'Hi {{name}},\n\nYour invoice is ready.\n\n<BLOCK>{{pay_button}}{{venmo_button}}\n\nThanks'],
    ['Venmo first {{venmo_button}} then {{pay_button}}', 'Venmo first <BLOCK>{{venmo_button}} then {{pay_button}}'],
    ['Paid, thank you. {{view_portal_button}}', 'Paid, thank you. <BLOCK>{{view_portal_button}}'],
    ['No buttons at all.', 'No buttons at all.<BLOCK>'],
    ['Already itemised\n{{feet_line}}\n{{pay_button}}', 'Already itemised\n{{feet_line}}\n{{pay_button}}']
  ];
  places.forEach(function (p, i) {
    check('placing #' + (i + 1) + ': both copies agree', A.place(p[0], B) === S.place(p[0], B));
    check('placing #' + (i + 1) + ': lands where it should', A.place(p[0], B) === p[1], JSON.stringify(A.place(p[0], B)));
  });
  check('an empty block changes nothing', A.place('x {{pay_button}}', '') === 'x {{pay_button}}');
}

/* The wiring, asserted apart from the mechanism: the block above can be perfect and
   reach no email. Comments are stripped first — both call sites are introduced by a
   paragraph that names these functions. Present AND ordered: indexOf(a) < indexOf(b)
   passes when a is absent. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
function between(src, from, to) {
  const a = src.indexOf(from);
  if (a === -1) return '';
  const b = src.indexOf(to, a + from.length);
  return b === -1 ? '' : src.slice(a, b);
}
function orderedCalls(body, place, block, rows, feet) {
  const p = body.indexOf('body = ' + place + '('), f = body.indexOf(feet);
  return p !== -1 && f !== -1 && p < f && body.indexOf(block + '(') !== -1 && body.indexOf(rows + '(') !== -1;
}
const testSend = stripComments(between(adminSrc, 'async function invTestSend(){', "getElementById('invTestSendBtn')"));
check('the test copy places the invoice, before any code is filled in',
  orderedCalls(testSend, 'invoiceEmailPlace', 'invoiceEmailBlock', 'invoiceEmailRows', "body.split('{{feet_line}}')"));
check('the test copy reads the houses the bill was summed from', testSend.indexOf('billedHouseIds') !== -1);
const nightly = stripComments(between(fnsSrc, 'const feetLine = active.length === 1', "template_params: { to_email: email"));
check('the 7 PM run places the invoice, before any code is filled in',
  orderedCalls(nightly, 'invoiceEmailPlaceServer', 'invoiceEmailBlockServer', 'invoiceEmailRowsServer', "body.split('{{feet_line}}')"));
check('the 7 PM run builds its rows from `active`, the list the total was summed from',
  /invoiceEmailRowsServer\(\{[\s\S]*?houses:\s*active\.map\(/.test(nightly));
check('the 7 PM run still turns newlines into <br> AFTER the invoice is placed',
  nightly.indexOf('invoiceEmailPlaceServer(') < nightly.indexOf("body.replace(/\\n/g, '<br>')"));
check('the Invoices tab no longer claims the printable invoice is what the email sends',
  adminSrc.indexOf('exactly what the Nightly Invoice Automation sends') === -1);

console.log('\ninvoice-email: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
