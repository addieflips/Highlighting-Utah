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
/* ⭐ THE THRESHOLDS ARE GONE AND THAT IS THE CHANGE (2026-09-11). This read two
   constants out of admin.html — PAYMENT_TERMS_DAYS and RED_CARD_DAYS_FROM_INVOICE
   — because the rule counted days. Addie moved payment terms onto a calendar
   ("they have until february to get them paid"), so a card now reddens on 1 April,
   the morning the late fee lands, and there is no number to read. The rule is
   lifted whole from js/money.js instead. */
const money = fs.readFileSync(path.join(__dirname, 'js', 'money.js'), 'utf8');
const liftMoney = (name) => {
  const i = money.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('could not lift ' + name + ' from js/money.js');
  let depth = 0, started = false;
  for (let j = money.indexOf('{', i); j < money.length; j++) {
    if (money[j] === '{') { depth++; started = true; }
    else if (money[j] === '}') { depth--; if (started && depth === 0) return money.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
};
const CALENDAR_SRC = [liftMoney('invoiceSeasonYear'), liftMoney('endOfFebruary'),
                      liftMoney('invoiceDueDate'), liftMoney('invoiceFeeChaseDate')].join('\n');

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
  /* ⚠ THE CALENDAR IS LIFTED, NEVER STUBBED (§3). It decides WHICH DAY a card
     turns red, which is the whole claim here — a stub would keep this suite green
     through a change to when the office starts chasing somebody. */
  ${CALENDAR_SRC}
  ${lift('houseCardIsRed').replace('houseOwesFromLastSeason(d)', 'houseOwesFromLastSeason(d, inv)')}
  return { houseCardIsRed, invoiceDueDate, invoiceFeeChaseDate };
`);

console.log('\n=== Whose card is red ===\n');

/* ⚠ NO DAY COUNT ANYWHERE IN IT ANY MORE, and that is asserted rather than
   assumed: under the new terms every count-from-the-invoice threshold is wrong by
   construction, because the invoice goes out in October and payment is not due
   until February. A retuned number would look like a fix and reintroduce the bug. */
check('the red rule counts no days at all',
  !/RED_CARD_DAYS_FROM_INVOICE/.test(admin) && !/PAYMENT_TERMS_DAYS/.test(admin.replace(/\/\*[\s\S]*?\*\//g, '')),
  'sixty days after an October invoice is December — the whole book would go red ' +
  'over Christmas while nobody is late at all');

/* ⚠ NOT THE OVERDUE FLAG. That one turns on the day after the invoice\'s own due
   date at the end of February; this one waits the further month Addie gives them
   before a fee. Reddening everybody on 1 March would say nothing the Overdue
   column does not already say. */
check('red is the fee day, not the due date',
  /invoiceFeeChaseDate\(issued\)/.test(lift('houseCardIsRed')),
  'two moments, two purposes');

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
/* ⚠ FIXED DATES, NOT "N DAYS AGO". houseCardIsRed reads Date.now() itself, so a
   fixture pinned to an offset would make the answer depend on the month this suite
   is run in — under a February calendar "90 days ago" is past the fee day in June
   and nowhere near it in December. A bill from 2000 is past its April whenever this
   runs; one from 2090 is not. Both hold every day of the year. */
const on = (y, m, d) => new Date(y, m, d).toISOString();
const LONG_PAST = on(2000, 9, 15);   // Oct 2000 — due Feb 2001, fee day Apr 2001
const FAR_OFF   = on(2090, 9, 15);   // Oct 2090 — due Feb 2091, fee day Apr 2091
const ago = n => new Date(Date.now() - n * 86400000).toISOString();
const inv = (o) => Object.assign({install:400, removal:0, deposit:0, credits:0, changeFees:0}, o);

check('somebody who owes from last season is red, however new their bill',
  api.houseCardIsRed({}, inv({invoicedAt: ago(1), changeFeeNotes:[{amount:400, kind:'arrears', year:'2025'}], changeFees:400})) === true,
  'this is the half Addie named first');

check('a bill past its 1 April is red',
  api.houseCardIsRed({}, inv({invoicedAt: LONG_PAST})) === true);

/* ⚠ THE BOUNDARY, RUN RATHER THAN DESCRIBED. The fee day itself belongs on the red
   side: the morning the late fee is charged is the morning the card should say so. */
check('the fee day itself is red, not the day after',
  api.houseCardIsRed({}, inv({invoicedAt: new Date(new Date().getFullYear() - 2, 9, 15).toISOString()})) === true);

/* The forgiving side matters more than the catching side: a card that reddens too
   early is one the office learns to scroll past — and under the old 30/60-day rule
   that is precisely what would now happen, in December, to the whole book. */
check('a bill whose April has not come yet is NOT red',
  api.houseCardIsRed({}, inv({invoicedAt: FAR_OFF})) === false);

/* ⚠ THE OLD RULE'S OWN CASE, ASSERTED ON THE CALENDAR RATHER THAN THE FLAG.
   houseCardIsRed can only ever answer "before now" or "after now", and that cannot
   tell a 60-day rule from an April one — so the claim that sixty days is no longer
   enough is made where it can actually be seen: an October bill's fee day is the
   following April, five months past the sixty-day mark. */
{
  const oct = new Date(2026, 9, 15);
  const sixtyDaysOn = new Date(oct.getTime() + 60 * 86400000);
  check('sixty days after an October bill is nowhere near its fee day',
    api.invoiceFeeChaseDate(oct).getTime() > sixtyDaysOn.getTime(),
    'that mark falls in December — the whole book would have gone red over ' +
    'Christmas while nobody was late at all');
  check('and the fee day sits a clear month after the due date',
    api.invoiceFeeChaseDate(oct).getTime() > api.invoiceDueDate(oct).getTime(),
    'Addie gives them March before a fee; red on 1 March would say nothing the ' +
    'Overdue column does not already say');
}

/* A January bill belongs to the season just gone, so it is due weeks later rather
   than fourteen months on — the case that would be silently wrong if the season
   split read the issue year alone. */
check('a January bill is chased on the same calendar as the autumn ones',
  api.invoiceDueDate(new Date(2027, 0, 10)).getFullYear() === 2027 &&
  api.invoiceFeeChaseDate(new Date(2027, 0, 10)).getMonth() === 3,
  'reading the issue YEAR alone would give this house until 2028');

check('a PAID bill is never red, however old',
  api.houseCardIsRed({}, inv({invoicedAt: LONG_PAST, deposit:400})) === false,
  'paid in full is settled — dates cannot make it late');

check('a paid bill is not red even with an old arrears line settled',
  api.houseCardIsRed({}, inv({invoicedAt: LONG_PAST, deposit:800, changeFees:400,
    changeFeeNotes:[{amount:400, kind:'arrears', year:'2025'}]})) === false,
  'the arrears was paid — chasing it again is chasing nobody');

/* ⚠ NEVER BILLED IS NOT LATE. An invoice with no issue date has not gone out,
   so there is nothing to be overdue for — and reddening it would flag every
   customer the moment the season opened. */
check('a bill that was never issued is NOT red',
  api.houseCardIsRed({}, inv({invoicedAt: null})) === false);

check('a customer with no invoice at all is NOT red',
  api.houseCardIsRed({}, null) === false);

check('an ordinary customer is not red', api.houseCardIsRed({}, inv({invoicedAt: FAR_OFF})) === false);

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) { console.log('The wrong customers would be flagged, or none would.\n'); process.exit(1); }
})();
