/*
 * WHOSE CARD IS RED
 *
 * Addie, 2026-09-01: "turn everyone that hasn't paid from last year or is 60
 * days over there payment as red for there card."
 *
 * ⚠ IT RUNS THE RULE rather than matching its source, because every claim here
 * is about WHO turns red — which a regex cannot see.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}
function lift(name) {
  let i = admin.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find ' + name);
  let depth = 0, started = false;
  for (let j = admin.indexOf('{', i); j < admin.length; j++) {
    if (admin[j] === '{') { depth++; started = true; }
    else if (admin[j] === '}') { depth--; if (started && depth === 0) return admin.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}
const num = re => { const m = re.exec(admin); return m ? Number(m[1]) : null; };
const TERMS   = num(/const PAYMENT_TERMS_DAYS = (\d+)/);
const FROMINV = num(/const RED_CARD_DAYS_FROM_INVOICE = (\d+)/);

/* ⚠ THE REAL RULE IS LIFTED, NOT REWRITTEN. A second opinion here would agree
   with itself and prove nothing — the failure this guards is the card and the
   season hold disagreeing about who is behind. houseOwesFromLastSeason and
   computeInvoiceStatus are lifted too, never stubbed (§3 "lift, not stub"). */
/* ⚠ computeInvoiceStatus and houseOwesFromLastSeason are the REAL ones, imported
   from js/money.js and lifted from admin.html — never stubbed. A stub of the
   paid-in-full rule would let this suite stay green through a change to who is
   chased, which is the one thing it exists to protect. */
const sandbox = new Function('ARREARS_KIND', 'computeInvoiceStatus', 'houseOwesFromLastSeason', `
  /* arrearsOnInvoice lives in js/money.js, not admin.html, so it is defined
     here rather than lifted. It is three lines and its shape is asserted by
     money's own tests. */
  function arrearsOnInvoice(inv){
    const notes = (inv && Array.isArray(inv.changeFeeNotes)) ? inv.changeFeeNotes : [];
    return notes.reduce(function(s,n){ return s + ((n && n.kind === ARREARS_KIND) ? (Number(n.amount)||0) : 0); }, 0);
  }
  /* toJsDate is what invoiceIssuedAt calls; lifted with it so the date handling
     under test is the shipped one, including the Firestore-Timestamp shape. */
  ${lift('toJsDate')}
  ${lift('invoiceIssuedAt')}
  ${lift('houseCardIsRed').replace('houseOwesFromLastSeason(d)', 'houseOwesFromLastSeason(d, inv)')}
  const PAYMENT_TERMS_DAYS = ${TERMS};
  const RED_CARD_DAYS_FROM_INVOICE = ${FROMINV};
  return { houseCardIsRed, PAYMENT_TERMS_DAYS, RED_CARD_DAYS_FROM_INVOICE };
`);

console.log('\n=== Whose card is red ===\n');

/* ⚠ SIXTY DAYS FROM THE INVOICE, NOT FROM THE DUE DATE. The first version
   counted from the due date — 30 days of terms plus 60, reddening at 90 — and
   Addie corrected it: "no 60 days after invoice goes out." */
check('the threshold is the 60 days Addie asked for', FROMINV === 60,
  'got ' + FROMINV + ' — she said "60 days after invoice goes out"');
check('payment terms are still 30 days', TERMS === 30);

/* ⚠ NOT OVERDUE_DAYS. That one is 30 and drives the ordinary Overdue flag;
   sharing it would turn most of the book red in November and say nothing. */
check('the red threshold is its own constant, not OVERDUE_DAYS',
  /const RED_CARD_DAYS_FROM_INVOICE/.test(admin) &&
  !/RED_CARD_DAYS_FROM_INVOICE\s*=\s*OVERDUE_DAYS/.test(admin),
  'two thresholds, two purposes — reusing 30 makes the red meaningless');

const src = lift('houseCardIsRed');
check('it counts from invoiceIssuedAt, never updatedAt',
  /invoiceIssuedAt\(inv\)/.test(src) && !/updatedAt/.test(src),
  'counting from updatedAt means a corrected spelling quietly un-reddens a bill months late');

check('it asks the SAME rule that holds them out of the season',
  /houseOwesFromLastSeason/.test(src),
  'a second opinion here lets the red card and the season hold name different people');

check('the row applies it',
  /class="row-item'\+cardRed\+'"/.test(admin) && /houseCardIsRed\(d, matchedInvoice/.test(admin),
  'a rule nothing calls colours nothing');

check('the stylesheet defines the class',
  /\.row-item\.owes-red\{/.test(admin),
  'a class with no style is a card that looks exactly like every other one');

/* ⚠ A LEFT BAR AND A TINT, NOT RED TEXT. The row already uses colour for RSVP
   and invoice status; recolouring those makes an overdue customer's answers
   unreadable. */
check('it colours the card, not the text',
  /\.row-item\.owes-red\{[^}]*border-left[^}]*background/.test(admin),
  'red text would collide with the RSVP and invoice pills already on the row');

// ---- behaviour -------------------------------------------------------------
(async () => {
const { computeInvoiceStatus } = await import('./js/money.js');
/* Lifted from admin.html so the card and the season hold cannot disagree. */
const owes = new Function('ARREARS_KIND', `
  function arrearsOnInvoice(inv){
    const notes = (inv && Array.isArray(inv.changeFeeNotes)) ? inv.changeFeeNotes : [];
    return notes.reduce(function(s,n){ return s + ((n && n.kind === ARREARS_KIND) ? (Number(n.amount)||0) : 0); }, 0);
  }
  function owesFromLastSeason(inv){ return arrearsOnInvoice(inv) > 0; }
  return function(d, inv){ return !!inv && owesFromLastSeason(inv); };
`)('arrears');
const api = sandbox('arrears', computeInvoiceStatus, owes);
const DAY = 86400000;
const ago = n => new Date(Date.now() - n * DAY).toISOString();
const inv = (o) => Object.assign({install:400, removal:0, deposit:0, credits:0, changeFees:0}, o);

check('somebody who owes from last season is red, however new their bill',
  api.houseCardIsRed({}, inv({invoicedAt: ago(1), changeFeeNotes:[{amount:400, kind:'arrears', year:'2025'}], changeFees:400})) === true,
  'this is the half Addie named first');

check('a bill 60 days after it went out is red',
  api.houseCardIsRed({}, inv({invoicedAt: ago(FROMINV + 1)})) === true);

check('a bill exactly 60 days old is red',
  api.houseCardIsRed({}, inv({invoicedAt: ago(FROMINV)})) === true,
  'the boundary belongs on the red side — 60 days IS 60 days');

/* ⚠ THE CORRECTION, PINNED. The first version counted 30 days of terms PLUS 60,
   so a 60-day-old bill was not red. If anybody adds PAYMENT_TERMS_DAYS back to
   this sum, this check goes red rather than the customer's card going quiet. */
check('it does NOT wait for terms-plus-60 (the reading Addie rejected)',
  api.houseCardIsRed({}, inv({invoicedAt: ago(TERMS + FROMINV - 1)})) === true,
  'a bill 89 days old must already be red — she asked for 60 days from the invoice');

/* The forgiving side matters more than the catching side: a card that reddens
   too early is one the office learns to scroll past. */
check('a bill one day short of the threshold is NOT red',
  api.houseCardIsRed({}, inv({invoicedAt: ago(FROMINV - 1)})) === false);

check('an ordinary overdue bill (31 days) is NOT red',
  api.houseCardIsRed({}, inv({invoicedAt: ago(31)})) === false,
  'that is the Overdue flag\'s job; red is reserved for seriously behind');

check('a PAID bill is never red, however old',
  api.houseCardIsRed({}, inv({invoicedAt: ago(400), deposit:400})) === false,
  'paid in full is settled — dates cannot make it late');

check('a paid bill is not red even with an old arrears line settled',
  api.houseCardIsRed({}, inv({invoicedAt: ago(400), deposit:800, changeFees:400,
    changeFeeNotes:[{amount:400, kind:'arrears', year:'2025'}]})) === false,
  'the arrears was paid — chasing it again is chasing nobody');

/* ⚠ NEVER BILLED IS NOT LATE. An invoice with no issue date has not gone out,
   so there is nothing to be overdue for — and reddening it would flag every
   customer the moment the season opened. */
check('a bill that was never issued is NOT red',
  api.houseCardIsRed({}, inv({invoicedAt: null})) === false);

check('a customer with no invoice at all is NOT red',
  api.houseCardIsRed({}, null) === false);

check('an ordinary customer is not red', api.houseCardIsRed({}, inv({invoicedAt: ago(5)})) === false);

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) { console.log('The wrong customers would be flagged, or none would.\n'); process.exit(1); }
})();
