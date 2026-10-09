/* A RECEIPT THAT NEVER WENT OUT CAN BE SENT AGAIN
 * ================================================
 * `npm run test:receiptresend`. Its own file per R-018.
 *
 * Addie, 2026-10-08, reading "41 payment receipts failed to send" on the Invoices
 * tab: "I thought there was already a resend button for any invoice that didnt get
 * sent". There is one — RSVP tab → Did-not-send → "Send again to the N who did not
 * get it" — and it genuinely works, and it cannot reach a payment receipt for three
 * separate reasons. That is the first thing this file pins down, because it looks as
 * though it should and the next person will assume so too.
 *
 * ⛔ THE CLAIM THAT EARNS THE FILE is that the resend re-runs the REAL sender. The
 * money on a receipt — {{amount_paid}}, {{amount_due}}, {{payment_amount}} — is
 * exactly the part that must never be re-derived by a second renderer; this repo has
 * been bitten twice by two screens deciding one thing separately (the bins count, the
 * put-into wording). A copy here would be a third, on a page that tells somebody what
 * they paid.
 *
 * ⚠ AND THE TWO RULES ARE RUN, NOT MATCHED. Both answer a QUESTION — who can be sent,
 * and what figure the receipt reports — so a text check could only ever prove a name
 * appears. The handler itself is checked structurally, because it needs a browser.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ADMIN = path.join(__dirname, 'admin.html');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

const raw = fs.readFileSync(ADMIN, 'utf8');
/* Comments stripped before anything is JUDGED — the header above and the code's own
   notes quote the very names being checked, which is the Suite 58 trap that five
   gates in this repo have each had to learn. The LIFTS below read `raw`, because a
   function's body is what gets run. */
const live = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

/* Lift a named function whole, by brace matching — never a fixed-length window, which
   §7 bans by name and which goes stale silently as the real code grows. */
function lift(name) {
  const i = raw.indexOf('function ' + name + '(');
  if (i === -1) return null;
  let d = 0, started = false;
  for (let j = raw.indexOf('{', i); j < raw.length; j++) {
    if (raw[j] === '{') { d++; started = true; }
    else if (raw[j] === '}') { d--; if (started && d === 0) return raw.slice(i, j + 1); }
  }
  return null;
}

console.log('');
console.log('--- who can be sent again ---');
console.log('');

const targetsSrc = lift('receiptResendTargets');
check('receiptResendTargets is its own function, so this gate can run it', !!targetsSrc,
  'inline, the only testable claim is that a word appears somewhere');

let targets = null;
if (targetsSrc) {
  try { targets = new Function(targetsSrc + '\nreturn receiptResendTargets;')(); }
  catch (e) { check('it can be lifted and run', false, e.message); }
}

if (targets) {
  const book = [
    { id: 'a', data: { receiptError: 'the mail service refused us', email: 'a@x.com', name: 'A' } },
    { id: 'b', data: { receiptError: 'the mail service refused us', email: '  ',       name: 'B' } },
    { id: 'c', data: { receiptError: '',   email: 'c@x.com', name: 'C' } },
    { id: 'd', data: { email: 'd@x.com', name: 'D' } },
    { id: 'e', data: { receiptError: '   ', email: 'e@x.com', name: 'E' } }
  ];
  const r = targets(book);
  check('only an invoice actually carrying a failure is picked up',
    r.all.length === 2 && r.all.map(x => x.id).join(',') === 'a,b',
    'got ' + r.all.map(x => x.id).join(',') + '. A blank or absent receiptError is a ' +
    'receipt that went, or one that was never tried — emailing those is a second copy ' +
    'to somebody who already has one.');
  check('a blank-but-present receiptError does not count as a failure',
    !r.all.some(x => x.id === 'e'),
    'the real sender WRITES receiptError: \'\' on success, so a trimmed-empty string ' +
    'is the commonest shape in the book — reading it as a failure would re-email ' +
    'everybody who was successfully receipted');
  check('somebody with no email on file is counted, not attempted',
    r.sendable.length === 1 && r.sendable[0].id === 'a' && r.noEmail === 1,
    'sendable=' + r.sendable.length + ' noEmail=' + r.noEmail + '. Trying them reports ' +
    'failures the press was always going to have, and the real ones hide among them.');
  check('an empty book answers nothing rather than throwing',
    targets([]).all.length === 0 && targets().all.length === 0 && targets([]).noEmail === 0,
    'it is called on every render of the Invoices tab, including before anything loads');
}

console.log('');
console.log('--- what the receipt says was paid ---');
console.log('');

const amountSrc = lift('receiptResendAmount');
check('receiptResendAmount is its own function too', !!amountSrc);

let amount = null;
if (amountSrc) {
  try {
    /* toJsDate is LIFTED, never re-written here: a second copy of the date reader
       would prove the copy works and say nothing about the code that runs. */
    const dep = lift('toJsDate');
    check('and toJsDate is lifted with it rather than stubbed', !!dep,
      'a stub would decide the very ordering under test');
    amount = new Function((dep || '') + '\n' + amountSrc + '\nreturn receiptResendAmount;')();
  } catch (e) { check('it can be lifted and run', false, e.message); }
}

if (amount) {
  const inv = { deposit: 400 };
  /* The real shape: several payments on one invoice, out of order, because they are
     read with no orderBy (no composite index) exactly as renderPaymentHistory does. */
  const rows = [
    { amount: 150, paidAt: new Date('2026-09-01T00:00:00Z') },
    { amount: 250, paidAt: new Date('2026-10-05T00:00:00Z') },
    { amount: 100, paidAt: new Date('2026-08-01T00:00:00Z') }
  ];
  check('the NEWEST payment is what the receipt reports, whatever order they arrive in',
    amount(inv, rows) === 250,
    'got ' + amount(inv, rows) + '. They are read with no orderBy — sorting is this ' +
    "rule's job, and the first row is whatever Firestore happened to hand back.");
  check('and it is not the total, nor the deposit, when a payment is known',
    amount(inv, rows) !== 500 && amount(inv, rows) !== 400,
    '{{payment_amount}} is THIS payment — "we have received your payment of X"');
  check('with no ledger row at all it falls back to the deposit',
    amount({ deposit: 400 }, []) === 400 && amount({ deposit: 400 }) === 400,
    'anything paid before the payment log existed has no row, and for a settled bill ' +
    'the deposit IS what they paid. A receipt reporting $0 is worse than none.');
  check('a zero-amount ledger row is skipped rather than reported',
    amount({ deposit: 400 }, [{ amount: 0, paidAt: new Date() }]) === 400,
    'logPayment refuses a zero, but an imported or hand-made row need not have');
  check('and it never reports a negative',
    amount({ deposit: -50 }, []) === 0,
    'a corrected deposit can go below zero; "paid -$50" is not a sentence');
}

console.log('');
console.log('--- it re-runs the real sender, and is paced ---');
console.log('');

const handler = lift('resendMissingReceipts');
check('resendMissingReceipts exists', !!handler);
if (handler) {
  const body = handler.replace(/\/\*[\s\S]*?\*\//g, '');
  check('it calls the REAL sendPaymentReceipt rather than building a receipt itself',
    /\bsendPaymentReceipt\s*\(/.test(body),
    'the money figures must come from the one renderer — a second copy here is how ' +
    'two screens start disagreeing about what somebody paid');
  check('and it builds no receipt body of its own',
    !/\{\{amount_paid\}\}|\{\{payment_amount\}\}|\{\{amount_due\}\}/.test(body),
    'a token resolved here is a second renderer wearing a different name');
  check('every send goes through emailSendPaced',
    /emailSendPaced\s*\(/.test(body),
    'EM-02: Gmail refused 392 of ~410 sends fired back to back, and that helper is ' +
    'the one place that knows how fast we may mail customers');
  check('a real failure is re-thrown so the pacer can see a rate limit',
    /throw\s+e\b/.test(body) && /outcome\.quiet/.test(body),
    'sendPaymentReceipt never throws — it answers {sent,quiet,why} — so without this ' +
    'emailSendRetryAfter never runs and the whole list is spent on the same refusal');
  check('a deliberate silence is not counted as a failure',
    /quiet\+\+/.test(body),
    'under the minimum, a correction, and already-receipted are agreed silences ' +
    '(2026-08-11); counting them as errors makes a clean run look broken');
  check('an account-wide stop leaves the rest untried rather than spending a request each',
    /paced\.until/.test(body) && /break\s*;/.test(body),
    "Gmail's limit is on the account, so carrying on only discovers it again");
  /* ⚠ THE RUN THAT WORKS BEST IS THE ONE THAT REPORTS NOTHING, without this. Clearing
     the last failure removes the banner, and the status line lives INSIDE it — so a
     wholly successful press ends with the red box vanishing and nothing saying that 41
     receipts went out. The toast outlives the node. */
  check('a successful run still says so after the banner it was reported in disappears',
    /toast\(/.test(body),
    'the status line is a child of the banner, which a clean run removes');
  check('and who is still failing is NAMED, not counted',
    /problems\.push\(/.test(body) && /alert\(/.test(body),
    'EM-01: a count said 392 had not been emailed and named nobody, so the only way ' +
    'to reach them was to send the whole book again');
}

console.log('');
console.log('--- the wiring, which is separate from the mechanism ---');
console.log('');

/* ⚠ ASSERTED APART FROM THE BEHAVIOUR, because this gate calls the rules from its own
   harness: delete the button from the banner and every check above still passes while
   nothing reaches the screen. That is the shape this repo has shipped before — the
   recycle "bin says" box rendered an input whose listener had silently not applied. */
const banner = lift('renderReceiptErrorBanner');
/* ⚠ THE MARKUP, NOT THE NAME. The first draft matched /receiptRetryBtn/ anywhere in
   the function and a red-check caught it: deleting the BUTTON leaves the id behind in
   the line that wires it up, so the check passed over a banner with nothing to press. */
check('the banner is what offers the button', !!banner && /<button id="receiptRetryBtn"/.test(banner),
  'there is one list of who missed out and it is this one');
check('and the button is actually wired to the handler',
  !!banner && /resendMissingReceipts/.test(banner.replace(/\/\*[\s\S]*?\*\//g, '')),
  'a button with no listener looks identical on screen to a working one');
check('the banner asks the shared rule rather than filtering for itself',
  !!banner && /receiptResendTargets\s*\(/.test(banner),
  'two opinions about who is owed a receipt is how the count and the press disagree');
check('people with no email are named on the banner rather than silently dropped',
  !!banner && /noEmail/.test(banner),
  '"nothing should fail quietly" — they cannot be emailed by anything, and that is ' +
  'an answer rather than a failure to retry');

/* ⛔ THE EXISTING RESEND BUTTON STILL CANNOT DO THIS, and if that ever changes it
   should change deliberately. Payment receipts must not start writing into
   settings/emailSendFailures while that card re-renders through etResolveVars, which
   fills name/price/phone/link and none of the three money tokens a receipt is made of. */
const resolveVars = lift('etResolveVars');
check('etResolveVars still fills none of the receipt money tokens',
  !!resolveVars && !/amount_paid|payment_amount|amount_due/.test(resolveVars),
  'if it learns them, the RSVP tab\'s Send-again button could cover receipts too and ' +
  'this whole file should be revisited — deliberately, not by accident');
check('and sendPaymentReceipt still does not feed that card',
  (() => { const s = lift('sendPaymentReceipt'); return !!s && !/saveEmailSendFailures/.test(s); })(),
  'it would be listed there as resend:false and look re-sendable when it is not');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
