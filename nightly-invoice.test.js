/*
 * The 7pm billing run, actually executed
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * ⛔ BECAUSE NOTHING RAN runInvoiceBatch, AND A ONE-WORD CRASH IN IT BILLED NOBODY.
 * On 2026-09-28 the new-member branch read `nowMs`, which is not declared anywhere in
 * that function — the only two declarations of that name are a `const` inside
 * portalSave's lights branch and a parameter of runLateFeeBatch. Reading an undeclared
 * identifier throws; the throw landed in the per-payer catch; the payer was counted as
 * an error and skipped BEFORE `invRef.set`, so no invoice document was written at all,
 * `invoiceEmailSent` was never set, and the same failure repeated every night.
 *
 * ⚠ SO IT WAS EXACTLY THE NEW MEMBERS WHO WENT UNBILLED, and only them. One fixture
 * with `chargeNewMemberFee` flipped proves it both ways, and that pair of checks is the
 * reason this file exists. A returning customer billed perfectly throughout, which is
 * why nothing looked wrong.
 *
 * ⚠ AND EVERY EXISTING CHECK ON THAT FUNCTION PASSED THE WHOLE TIME. run-all.js reads
 * runInvoiceBatch with `sectionFrom` and regexes — nine separate places — and the source
 * looks right, because it IS right apart from one identifier that does not exist. This is
 * the lesson Suite 10 wrote down for syncPayerInvoice ("a regex cannot catch an undefined
 * variable and a text-only check is exactly what let the forTotal crash ship for a day")
 * arriving a second time in the same family of code. A text check cannot see scope.
 *
 * ⚠ SO EVERY CHECK HERE RUNS THE SHIPPED FUNCTION against a fake Firestore. Not one of
 * them matches its source, on purpose: the claims are about whether a document gets
 * written and whether an email goes, and a regex can see neither.
 *
 * ⚠ AND IT LIFTS, IT NEVER STUBS, the rules the answers depend on — houseIsOnTheBillServer,
 * computeInvoiceStatusServer, invoiceKeyFor, payerHouseOfServer, the invoice calendar, the
 * held-bill rules. A stub of any of them would decide the very thing under test. Only the
 * genuinely external edges are faked: EmailJS, the template lookup, the token mint, and
 * Firestore itself.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node nightly-invoice.test.js      (or: npm run test:nightly)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const scan = require('./connections/scan.js');
const fns = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

/* Lifts a function by name, slicing to its closing brace at column 0 — the same
   terminator every other harness in this repo relies on.
   ⚠ `async` FIRST, because extractFn's habit of matching only `function NAME(` is
   written up in CLAUDE.md as having cost three suites a run: the body arrives full of
   bare `await`, a parse error that kills the whole file as one unattributable crash. */
function lift(name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = fns.indexOf(opener);
    if (at === -1) continue;
    const end = fns.indexOf('\n}', at);
    if (end === -1) return '';
    return fns.slice(at, end + 2);
  }
  return '';
}

/* ⚠ THE LIST IS A CENSUS, NOT A FLOOR. A name that stops being lifted shows up as a
   bare ReferenceError out of the middle of a run — the extraction-list trap this repo
   records having been caught by ten times — so the count is asserted below and a
   deliberate change to it is a deliberate edit here. */
const LIFTED = ['runInvoiceBatch', 'houseIsOnTheBillServer', 'computeInvoiceStatusServer',
  'invoiceKeyFor', 'digitsOnly', 'todayStrInDenver', 'tryFirestore', 'invoiceDueDateServer',
  'invoiceSeasonYearServer', 'endOfFebruaryServer', 'centsOf', 'properNameServer',
  'payerHouseOfServer', 'heldBillReason', 'heldBillWorkDoneAt', 'reportHeldBill',
  'clearHeldBill', 'toMillis', 'logNightlyInvoiceRun',
  /* ⚠ MAIN'S OWN ADDITION OF 2026-10-07 — the office can pick which template the
     nightly invoice sends, and runInvoiceBatch calls this to decide. Added on the
     merge of 2026-10-08: the extraction-list trap for the TWELFTH time, and this one
     came in from the OTHER direction — main extracted a helper this branch's harness
     had never heard of, so the gate died on a bare `NIGHTLY_UNPAID_TEMPLATE is not
     defined` and reported it as the September crash. Run the whole suite after a
     merge, not just the checks you wrote. */
  'nightlyInvoiceTemplateNameServer'];
const missing = LIFTED.filter(n => !lift(n));
check('every rule the run depends on could be lifted out of the server',
  missing.length === 0,
  'could not find: ' + missing.join(', ') +
  '. A missing lift arrives as a bare ReferenceError from the middle of a run, which is ' +
  'the trap this file was written after being caught by.');
const lifted = LIFTED.map(lift).join('\n\n');

/* The two constants the run reads, taken from the source rather than typed here — a
   copy would go on passing against a number the app no longer has, which is what seven
   fixtures did to CN_DOUBLE_BIN_FEET. */
const NEW_MEMBER_FEE = Number((fns.match(/const NEW_MEMBER_FEE = (\d+)/) || [])[1]);
const BILL_HELD_DAYS = Number((fns.match(/const BILL_HELD_DAYS = (\d+)/) || [])[1]);
/* ⛔ AND THE TWO STANDARD TEMPLATE NAMES, READ OUT OF THE SOURCE. Typed here they would
   go on passing against names the app had moved off — the CN_DOUBLE_BIN_FEET lesson. They
   carry an em dash, which is exactly why `findTemplateSnapByName` flattens the name
   before matching: an em dash, en dash and hyphen are indistinguishable in a text box. */
const NIGHTLY_UNPAID_TEMPLATE = (fns.match(/const NIGHTLY_UNPAID_TEMPLATE = '([^']+)'/) || [])[1];
const NIGHTLY_PAID_TEMPLATE = (fns.match(/const NIGHTLY_PAID_TEMPLATE = '([^']+)'/) || [])[1];
check('the two constants the run reads were found in the source',
  NEW_MEMBER_FEE > 0 && BILL_HELD_DAYS > 0,
  'fee=' + NEW_MEMBER_FEE + ' heldDays=' + BILL_HELD_DAYS +
  '. Typing either into this file would let it pass against a price the app has moved off.');

/* ---------------------------------------------------------------------------
 * A fake Firestore. Records every write so a check can ask what actually landed
 * rather than what the function says it did.
 * ------------------------------------------------------------------------- */
function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed));
  const writes = [];
  function docApi(col, id) {
    return {
      id: id,
      get: async () => ({ exists: !!(store[col] && store[col][id]),
                          data: () => store[col] && store[col][id] }),
      set: async (v, o) => {
        writes.push({ op: 'set', col: col, id: id, v: v });
        store[col] = store[col] || {};
        store[col][id] = Object.assign({}, (o && o.merge) ? store[col][id] : {}, v);
      },
      update: async (v) => {
        writes.push({ op: 'update', col: col, id: id, v: v });
        store[col] = store[col] || {};
        store[col][id] = Object.assign({}, store[col][id], v);
      }
    };
  }
  const empty = { docs: [], forEach: () => {}, empty: true, size: 0 };
  return {
    writes: writes, store: store,
    collection: (col) => ({
      doc: (id) => docApi(col, id),
      add: async (v) => { writes.push({ op: 'add', col: col, v: v }); return { id: 'new' }; },
      get: async () => {
        const rows = Object.keys(store[col] || {}).map(id => ({
          id: id, ref: docApi(col, id), data: () => store[col][id], exists: true }));
        return { docs: rows, forEach: f => rows.forEach(f), empty: !rows.length, size: rows.length };
      },
      where: () => ({ get: async () => empty, limit: () => ({ get: async () => empty }) })
    })
  };
}
const Timestamp = {
  now: () => { const ms = Date.now(); return { __ts: ms, toDate: () => new Date(ms) }; },
  fromMillis: (m) => ({ __ts: m, toDate: () => new Date(m) })
};
const adminStub = { firestore: Object.assign(() => ({}), {
  Timestamp: Timestamp,
  FieldValue: { serverTimestamp: () => ({ __sv: true }), increment: n => ({ __inc: n }) }
}) };

const DAY = 86400000;
function daysAgo(n) {
  const ms = Date.now() - (n * DAY);
  return { __ts: ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) };
}

/* Runs the REAL batch over one book of customers. `mailFails` makes EmailJS refuse, so a
   check can tell an invoice that was raised from an email that actually went. */
function runBatch(jobAddresses, opts) {
  const o = opts || {};
  const db = makeDb({
    settings: { emailjs: { serviceId: 's', templateId: 't', privateKey: 'k', publicKey: 'p' } },
    pricing: { config: { perFootRate: 4 } },
    jobAddresses: jobAddresses,
    invoices: o.invoices || {},
    messages: {}
  });
  /* ⚠ ONLY THE EDGES ARE FAKED. The template lookup answers empty on purpose — the run's
     own built-in fallback body is then used, which is the branch a missing template takes
     in production and one fewer thing for this harness to invent. */
  /* ⚠ AND THE TEMPLATE LOOKUP CAN BE GIVEN A REAL BODY (added 2026-10-06). Stubbing it
     empty for ever meant this harness only ever exercised the BUILT-IN wording — and the
     office edits templates, which is the whole point of templates. Every token hole found
     on 2026-10-06 lived in that unexercised half. */
  const sandbox = lifted + `
${o.template
  ? 'async function findTemplateSnapByName(n){ __asked.push(n); return { empty:false, docs:[{ data: () => (' + JSON.stringify({ body: o.template, subject: 'Your invoice' }) + ') }] }; }'
  : 'async function findTemplateSnapByName(n){ __asked.push(n); return { empty: true, docs: [] }; }'}
function templateSubjectOr(t, f){ return (t && t.subject) || f; }
async function ensureToken(id, d){ return 'tok'; }
const NEW_MEMBER_FEE = ${NEW_MEMBER_FEE};
const BILL_HELD_DAYS = ${BILL_HELD_DAYS};
const NIGHTLY_UNPAID_TEMPLATE = ${JSON.stringify(NIGHTLY_UNPAID_TEMPLATE)};
const NIGHTLY_PAID_TEMPLATE = ${JSON.stringify(NIGHTLY_PAID_TEMPLATE)};
return runInvoiceBatch('test');
`;
  const fn = new Function('db', 'admin', 'fetch', 'console', '__asked', sandbox);
  const asked = [];
  const quietConsole = { log: () => {}, error: () => {}, warn: () => {} };
  /* ⛔ THE EMAIL BODY IS KEPT, not thrown away. Every check below about what the CUSTOMER
     receives is a claim about these bytes; the old fake answered ok and dropped them, so
     nothing in this repo had ever read an invoice email it had actually produced. */
  const sent = [];
  return fn(db, adminStub,
    async (url, init) => {
      try { sent.push(JSON.parse(init.body).template_params); } catch (e) { sent.push({}); }
      return { ok: !o.mailFails, text: async () => 'refused' };
    },
    quietConsole, asked
  ).then(res => ({ res: res, db: db, sent: sent, asked: asked }));
}
/* The email as a person reads it, so a check can look for a sentence rather than markup. */
const asText = h => String(h || '').replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
const notesRaised = db => db.writes.filter(w => w.col === 'messages').map(w => w.v.topic);

(async function main() {

  /* =====================================================================
     1. THE CRASH. A new member is billed, and the fee is on the bill.

     ⚠ THE PAIR IS THE CHECK. Either row alone proves nothing: the whole failure was
     that one branch threw while the other worked, so a suite that only ever billed a
     returning customer stayed green through it for ten days.
     ===================================================================== */
  const oneHouse = (extra) => ({
    solo: Object.assign({
      name: 'New Guy', phone: '8015550111', email: 'new@x.com', address: '1 Elm St',
      housePrice: 400, measuredFeet: 100, completed: true, completedAt: daysAgo(1),
      customerNumber: '101'
    }, extra || {})
  });

  {
    const { res, db } = await runBatch(oneHouse({ chargeNewMemberFee: true }));
    const inv = db.store.invoices['8015550111'];
    check('a new member is billed at all',
      res.sentCount === 1 && res.errorCount === 0,
      'sent=' + res.sentCount + ' errors=' + res.errorCount + ' ' + JSON.stringify(res.errors) +
      '. This is the 2026-09-28 crash: `nowMs` is not declared in runInvoiceBatch, the ' +
      'throw was swallowed by the per-payer catch, and the payer was skipped before the ' +
      'invoice was ever written.');
    check('and an invoice document actually exists for them',
      !!inv,
      'nothing was written to invoices/8015550111. The throw landed before invRef.set, so ' +
      'there was no bill to send and nothing in their member portal either.');
    check('and the installation fee is folded into the total',
      !!inv && Number(inv.install) === 400 + NEW_MEMBER_FEE,
      'install=' + (inv && inv.install) + ', expected ' + (400 + NEW_MEMBER_FEE));
    check('and the fee records when it was charged',
      !!inv && inv.newMemberFeeApplied === true && !!inv.newMemberFeeAppliedAt,
      'Addie asked for every fee on a member account to be dated. It is stamped with ' +
      'Timestamp.now() rather than a server sentinel, because the {{due_date}} maths reads ' +
      'this invoice back inside the same run.');
    check('and the bill is marked sent on the customer',
      db.store.jobAddresses.solo.invoiceEmailSent === true,
      'without this the same payer is billed again on the next run');
  }
  {
    /* THE CONTROL. Same fixture, one field different. */
    const { res } = await runBatch(oneHouse({ chargeNewMemberFee: false }));
    check('a returning customer bills the same way, with no fee',
      res.sentCount === 1 && res.errorCount === 0,
      'sent=' + res.sentCount + ' errors=' + res.errorCount +
      '. If this fails the harness is wrong, not the app.');
  }
  {
    /* ⚠ AND THE FEE IS NOT CHARGED TWICE. `newMemberFeeApplied` on an existing invoice is
       the only guard, and it is what makes a re-run safe. */
    const { db } = await runBatch(oneHouse({ chargeNewMemberFee: true }), {
      invoices: { '8015550111': { install: 400 + NEW_MEMBER_FEE, removal: 0, deposit: 0,
                                  newMemberFeeApplied: true } }
    });
    check('the installation fee is never charged twice',
      Number(db.store.invoices['8015550111'].install) === 400 + NEW_MEMBER_FEE,
      'install=' + db.store.invoices['8015550111'].install +
      '. An invoice that already carries the fee must not gain a second one on a re-run.');
  }

  /* =====================================================================
     2. A HELD BILL IS NAMED, AND THE STUCK ONES LAND ON THE RECORD.

     Addie's rule is that a bill covering several houses waits for all of them — "After
     the last persons house is done ... is when they will be charged" — and that is not
     what changed. What changed is that a held bill used to be a bare count in the
     nightly summary, naming nobody and flagging nothing, so one house that never got
     marked done stopped that payer being billed for the season in silence.
     ===================================================================== */
  /* ⚠ THE UNFINISHED HOUSE IS LISTED FIRST, AND THAT IS THE FIXTURE DOING WORK. The
     payer is the LOWEST customer number (a1, #14), so with a1 first in the book a bare
     `houses[0]` gives the right answer by luck and a sabotage reverting the payer rule to
     a `.find()` passes — which is exactly what the first red-check pass reported as a
     miss. Listed the other way round, arrival order and the real rule disagree. */
  const twoHouses = (firstDoneDaysAgo, extra) => ({
    a2: { name: 'Anderson Jr', phone: '8015550222', email: 'a@x.com', address: '2 Oak Ave',
          housePrice: 350, completed: false, customerNumber: '20' },
    a1: Object.assign({
      name: 'Anderson', phone: '8015550222', email: 'a@x.com', address: '1 Elm St',
      housePrice: 400, completed: true, completedAt: daysAgo(firstDoneDaysAgo),
      customerNumber: '14'
    }, extra || {})
  });

  {
    const { res, db } = await runBatch(twoHouses(BILL_HELD_DAYS + 10));
    check('a bill held long after the work was done is named, not just counted',
      res.heldNames.length === 1 && /Anderson/.test(res.heldNames[0]),
      JSON.stringify(res.heldNames) +
      '. `skippedNotDone` was a number in the nightly text and nothing else — the same ' +
      'number every night, which reads as background noise.');
    check('and the name says WHICH house is holding the bill',
      /2 Oak Ave/.test(res.heldNames[0]),
      res.heldNames[0] + '. A count sends somebody back to the screen to work out which ' +
      'house it is; the address is the whole of what they need.');
    /* ⚠ THE FLAG IS ON THE PAYER, and the payer is the LOWEST customer number — the same
       answer payerHouseOfServer gives the invoice email. A tag on a different house than
       the bill's own name is the disagreement this repo already shipped once. */
    check('and the flag lands on the payer, not on whichever house came first',
      db.store.jobAddresses.a1.billHeld === true &&
      db.store.jobAddresses.a2.billHeld === undefined,
      'a1=' + db.store.jobAddresses.a1.billHeld + ' a2=' + db.store.jobAddresses.a2.billHeld);
    check('and the reason is stored so the office screen can show it',
      /2 Oak Ave/.test(db.store.jobAddresses.a1.billHeldWhy || ''),
      'billHeldWhy=' + db.store.jobAddresses.a1.billHeldWhy);
    check('and a note goes up in the Inbox',
      notesRaised(db).indexOf('Bill Held') !== -1,
      JSON.stringify(notesRaised(db)));
    check('and nothing was billed, because the rule still holds',
      res.sentCount === 0 && !db.store.invoices['8015550222'],
      'the hold is right — a customer with four houses gets one bill. Only the silence ' +
      'was wrong.');
  }
  {
    /* ⚠ THE TWO SPEEDS ARE THE DESIGN. Between the crew doing the first Anderson house
       and the fourth, that bill is held every night and nothing is wrong. Naming it in
       the run log is free; putting a tag on the record and a note in the Inbox has to
       wait, or the office learns to click past both. */
    const { res, db } = await runBatch(twoHouses(2));
    check('a bill held only a couple of days is named but NOT flagged',
      res.heldNames.length === 1 && db.store.jobAddresses.a1.billHeld === undefined,
      'held=' + JSON.stringify(res.heldNames) + ' flag=' + db.store.jobAddresses.a1.billHeld +
      '. Flagging this is the cries-wolf failure: most held bills in October are correct.');
    check('and no note is raised for one that is merely waiting',
      notesRaised(db).indexOf('Bill Held') === -1,
      JSON.stringify(notesRaised(db)));
  }
  {
    /* ⚠ NOTHING FINISHED MEANS NOTHING EARNED. A payer whose houses simply have not been
       built yet is the ordinary state of most of the season. Naming all of them would
       bury the handful where money is genuinely sitting still. */
    const { res, db } = await runBatch({
      c1: { name: 'Early', phone: '8015550333', email: 'c@x.com', address: '1 Fir Way',
            housePrice: 400, completed: false, customerNumber: '14' },
      c2: { name: 'Early Jr', phone: '8015550333', email: 'c@x.com', address: '2 Fir Way',
            housePrice: 350, completed: false, customerNumber: '20' }
    });
    check('a bill with no finished house on it is not named at all',
      res.heldNames.length === 0,
      JSON.stringify(res.heldNames) + '. The crew has not been yet; nothing is owed.');
    check('and it raises no note either',
      notesRaised(db).length === 0, JSON.stringify(notesRaised(db)));
    check('but it is still counted, so the run log adds up',
      res.skippedNotDone === 1, 'skippedNotDone=' + res.skippedNotDone);
  }
  {
    /* The other hold branch: finished, and flagged for a fix nobody has cleared. */
    const { res, db } = await runBatch({
      d1: { name: 'Fixy', phone: '8015550444', email: 'f@x.com', address: '9 Pine Rd',
            housePrice: 400, completed: true, needsFix: true,
            completedAt: daysAgo(BILL_HELD_DAYS + 20), customerNumber: '31' }
    });
    check('a bill held by an uncleared fix is flagged too',
      db.store.jobAddresses.d1.billHeld === true && res.skippedNeedsFix === 1,
      'flag=' + db.store.jobAddresses.d1.billHeld + ' needsFix=' + res.skippedNeedsFix);
    check('and the reason says it is the fix, not a missing tick',
      /needs a fix/.test(db.store.jobAddresses.d1.billHeldWhy || ''),
      'billHeldWhy=' + db.store.jobAddresses.d1.billHeldWhy +
      '. "not marked done" and "still needs a fix" want different actions.');
  }
  {
    /* ⚠ THE SAME RUN CLEARS IT. A flag with only one way in is the sticky bug
       functions/index.js has already been bitten by — maybeNextYear — and the writer that
       sets it is the only thing that should decide it is over. */
    const { res, db } = await runBatch({
      e1: { name: 'Freed', phone: '8015550555', email: 'e@x.com', address: '4 Ash Ln',
            housePrice: 400, completed: true, completedAt: daysAgo(BILL_HELD_DAYS + 20),
            customerNumber: '41', billHeld: true, billHeldWhy: 'left over from last night' }
    });
    check('a standing flag is cleared by the run that finally bills them',
      db.store.jobAddresses.e1.billHeld === false &&
      !db.store.jobAddresses.e1.billHeldWhy,
      'flag=' + db.store.jobAddresses.e1.billHeld + ' why=' + db.store.jobAddresses.e1.billHeldWhy);
    check('and they really were billed on that same run',
      res.sentCount === 1 && !!db.store.invoices['8015550555'],
      'sent=' + res.sentCount);
  }
  {
    /* ⚠ THE NOTE GOES UP ONCE, NOT NIGHTLY. A note every night about the same house is
       how somebody learns to ignore the folder — the no-email note is guarded the same
       way and for the same reason. The FLAG is still re-written, because the blocking
       house can change while the hold stands. */
    const { db } = await runBatch(twoHouses(BILL_HELD_DAYS + 10, {
      billHeld: true, billHeldWhy: 'said yesterday' }));
    check('a held bill already flagged does not raise the note a second time',
      notesRaised(db).indexOf('Bill Held') === -1,
      JSON.stringify(notesRaised(db)) +
      '. Raised nightly, this is the folder nobody opens.');
    check('but the reason is refreshed, because the blocker can change',
      /2 Oak Ave/.test(db.store.jobAddresses.a1.billHeldWhy || ''),
      'billHeldWhy=' + db.store.jobAddresses.a1.billHeldWhy +
      '. Left at yesterday\'s wording it would name a house that is now finished.');
  }
  {
    /* ⚠ AND A FLAG IS CLEARED WHEN THE HOLD STOPS BEING STALE, not only when the bill
       goes out — a hold can come back inside the window after a house is un-ticked, and a
       tag from an earlier season left standing would excuse the next real one. */
    const { db } = await runBatch(twoHouses(2, { billHeld: true, billHeldWhy: 'stale' }));
    check('a stale flag is cleared once the hold is back inside the window',
      db.store.jobAddresses.a1.billHeld === false,
      'flag=' + db.store.jobAddresses.a1.billHeld);
  }
  {
    /* ⚠ ONE HOUSE IS NOT A HELD BILL. The whole feature is about a bill covering several
       houses; a single unfinished house is simply not done, and flagging it would put a
       tag on most of the book in October. */
    const { res, db } = await runBatch({
      f1: { name: 'Solo', phone: '8015550666', email: 's@x.com', address: '7 Vine St',
            housePrice: 400, completed: false, customerNumber: '51' }
    });
    check('a single unfinished house is never reported as a held bill',
      res.heldNames.length === 0 && db.store.jobAddresses.f1.billHeld === undefined,
      'held=' + JSON.stringify(res.heldNames) + ' flag=' + db.store.jobAddresses.f1.billHeld);
  }

  /* =====================================================================
     3. THE HOLD ITSELF IS UNCHANGED — the checks that would catch this fix
        having quietly widened who gets billed.
     ===================================================================== */
  {
    /* A sibling who said no is not one of the houses the hold waits for, because no crew
       is ever sent to them. That is houseIsOnTheBillServer and it predates all of this. */
    const { res, db } = await runBatch({
      g1: { name: 'Pair', phone: '8015550777', email: 'g@x.com', address: '1 Bay Rd',
            housePrice: 400, completed: true, completedAt: daysAgo(1), customerNumber: '61' },
      g2: { name: 'Pair Jr', phone: '8015550777', email: 'g@x.com', address: '2 Bay Rd',
            housePrice: 350, completed: false, rsvpStatus: 'no', customerNumber: '62' }
    });
    check('a sibling who said no does not hold the bill',
      res.sentCount === 1 && Number(db.store.invoices['8015550777'].install) === 400,
      'sent=' + res.sentCount + ' install=' +
      (db.store.invoices['8015550777'] || {}).install +
      '. One cancelled address must not hold a payer\'s bill for ever, and its price must ' +
      'not be on the bill either.');
    check('and no held-bill flag is left on anybody',
      db.store.jobAddresses.g1.billHeld !== true,
      'the bill went out, so nothing is held');
  }
  {
    /* ⚠ AND A PAYER ALREADY BILLED IS NEVER RE-REPORTED. `invoiceEmailSent` is the guard
       that makes the run idempotent, and a held-bill report that ran past it would name
       the same people every night for the rest of the season. */
    const { res, db } = await runBatch({
      h1: { name: 'Done', phone: '8015550888', email: 'h@x.com', address: '1 Oak Rd',
            housePrice: 400, completed: true, completedAt: daysAgo(BILL_HELD_DAYS + 20),
            invoiceEmailSent: true, customerNumber: '71' },
      h2: { name: 'Done Jr', phone: '8015550888', email: 'h@x.com', address: '2 Oak Rd',
            housePrice: 350, completed: false, invoiceEmailSent: true, customerNumber: '72' }
    });
    check('a payer whose bill already went out is not reported as held',
      res.heldNames.length === 0 && db.store.jobAddresses.h1.billHeld === undefined,
      'held=' + JSON.stringify(res.heldNames) +
      '. Otherwise the same names come back every night for the rest of the season.');
  }

  {
    /* ⛔ AND AN ORDINARY NIGHT WRITES NOTHING EXTRA. In October most of the book is held
       and correctly so, and this runs over every payer — so a report that wrote a flag (or
       cleared one) on each pass would be ~900 Firestore writes a night for no information.
       This app has already had one write storm of exactly that shape: a single drag on the
       Inbox sidebar fired 2,815 writes, measured. Both helpers return early unless
       something actually changes, and this is the check that holds it. */
    const book = {};
    for (let i = 0; i < 40; i++) {
      const key = '80155' + String(10000 + i);
      book['p' + i] = { name: 'Payer ' + i, phone: key, email: 'p' + i + '@x.com',
        address: i + ' Held Way', housePrice: 400, completed: true,
        completedAt: daysAgo(1), customerNumber: String(100 + i) };
      book['q' + i] = { name: 'Sibling ' + i, phone: key, email: 'p' + i + '@x.com',
        address: i + ' Waiting Way', housePrice: 350, completed: false,
        customerNumber: String(500 + i) };
    }
    const { res, db } = await runBatch(book);
    /* ⚠ SCOPED TO `jobAddresses`, AND THE FIRST DRAFT WAS NOT — it demanded zero writes of
       any kind and failed on correct code, catching the run log and its one summary note.
       Those are per-RUN and are the whole point of the run; what must not scale with the
       number of held payers is the per-CUSTOMER write. A check that forbids the right
       answer is worse than no check. */
    const custWrites = db.writes.filter(w => w.col === 'jobAddresses');
    check('forty held bills on an ordinary night touch no customer record',
      custWrites.length === 0,
      custWrites.length + ' write(s): ' +
      JSON.stringify(custWrites.slice(0, 3).map(w => w.id + ' ' + JSON.stringify(w.v))) +
      '. Every one of these is held for a good reason and none is stale, so there is ' +
      'nothing to record. A flag written per payer per night is a write storm.');
    check('and all forty are still named in the run log',
      res.heldNames.length === 20 && res.skippedNotDone === 40,
      'named=' + res.heldNames.length + ' counted=' + res.skippedNotDone +
      '. The names are capped at 20 so one bad night cannot write a novel into the run ' +
      'document; the COUNT is uncapped, so the log still adds up.');
  }

  /* =====================================================================
     4. THE WIRING. A rule nothing calls is a rule that does not run.
     ===================================================================== */
  {
    const batch = lift('runInvoiceBatch');
    /* ⚠ ASSERTED SEPARATELY FROM THE BEHAVIOUR, because the behavioural checks above
       would all still pass if the report were called from somewhere harmless. These are
       the only source checks in the file and they say so. */
    check('the run reports a held bill from inside the hold branch',
      /reportHeldBill\(/.test(batch),
      'the behaviour checks above run the whole batch, so they cannot tell a call in the ' +
      'hold branch from one anywhere else');
    check('and clears the flag on the path that bills them',
      /clearHeldBill\(/.test(batch));
    check('and the run log carries the names',
      /heldNames: heldNames/.test(batch),
      'without this the names are worked out and thrown away, which is where they were ' +
      'before this change');
    /* ⚠ THE PAYER IS RESOLVED ONCE, BY THE SHARED RULE. A second copy of "whose bill is
       this" is how the flag lands on a different house than the name on the invoice —
       which this repo has already shipped once, on these very four Anderson houses. */
    check('the payer is picked by the one shared rule',
      /payerHouseOfServer\(/.test(batch) && !/const payerSort = function/.test(batch),
      'payerSort back inside runInvoiceBatch means two copies of the rule again');
  }

  /* =====================================================================
     5. WHAT THE OFFICE SEES. The run writing a flag nothing reads is the same
        silence in a new place.
     ===================================================================== */
  {
    const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    /* ⚠ COMMENTS OUT FIRST. Every one of the surfaces below is introduced by a paragraph
       NAMING custBillHeld, so a plain search finds the prose defending the rule and passes
       on a file where the wiring has gone — the Suite 58 trap, which this repo has been
       caught by in five separate gates.
       ⚠ AND IT USES THE REPO'S OWN SCANNER, NOT A PAIR OF REGEXES. A hand-rolled
       comment stripper was written here first and reported the filter wiring as MISSING
       on a correct file: somewhere in 79,000 lines a comment-opening sequence inside a
       string starts a comment the stripper then runs to the next real closer, swallowing
       thousands of lines of real code with it. blankNonCode is the tool that already
       knows the difference, and three other gates in this repo use it for exactly this.
       ⚠ AND THE FIRST DRAFT OF THIS VERY PARAGRAPH BROKE THE FILE, which is the joke
       worth keeping: it quoted a literal comment-closing sequence to explain the trap,
       and that closed this comment early. Describe those two characters; never type
       them inside a block comment. */
    const clean = scan.blankNonCode(admin);

    /* ⚠ THE PREDICATE IS RUN, NOT MATCHED. It decides whether a tag appears on ~960 rows,
       and the one thing it must get right is the case where the bill HAS since gone out. */
    const src = (function () {
      const at = admin.indexOf('function custBillHeld(');
      if (at === -1) return '';
      const end = admin.indexOf('\n}', at);
      return end === -1 ? '' : admin.slice(at, end + 2);
    })();
    check('the office-side rule could be lifted', !!src,
      'without it the four checks below prove nothing');
    if (src) {
      const held = new Function(src + 'return custBillHeld;')();
      check('a flagged payer whose bill has not gone out is shown as held',
        held({ billHeld: true }) === true);
      check('and one whose bill HAS gone out is not',
        held({ billHeld: true, invoiceEmailSent: true }) === false,
        'the nightly run clears the flag on its own next pass, so this only covers the ' +
        'hours between the bill going out and 7pm — but that is the one state where the ' +
        'stored flag is definitely wrong.');
      check('an unflagged customer is never shown as held',
        held({}) === false && held({ billHeld: false }) === false);
      /* ⚠ `=== true`, NEVER TRUTHY. Every other flag in this app is read strictly, and a
         truthy read here would tag a record carrying a stray string. */
      check('and the flag is read strictly, not for truthiness',
        held({ billHeld: 'yes' }) === false,
        'a record carrying anything other than true is not a decision the run made');
    }

    check('All Customers can filter to them',
      /activeBillHeldFilter = document\.getElementById\('filterBillHeld'\)\.checked/.test(clean) &&
      /filtered\.filter\(a => custBillHeld\(a\.data\)\)/.test(clean),
      'the flag is what makes the work findable; without the filter it is a field nobody ' +
      'can reach, which is the state the whole thing was in');
    check('and the filter has a box to tick',
      /id="filterBillHeld"/.test(admin));
    check('the row carries a chip, with the blocking house behind it',
      /custBillHeld\(d\) \?/.test(clean) && /billHeldWhy/.test(clean),
      'the blocker is a DIFFERENT house, so a chip with no reason on it sends somebody ' +
      'back to the screen to work out which');
    check('and Health Check has a row for it',
      /id: 'billHeld'/.test(clean) && /custBillHeld\(c\.data\)/.test(clean),
      'HC-03 is Addie\'s own note that she did not read that panel while the badge could ' +
      'never reach nought; it counts only open findings now, so a row there is seen');
  }

  /* =====================================================================
     WHAT THE CUSTOMER ACTUALLY RECEIVES — Addie's four cases (2026-10-06).
     Addie: "for invoices we need to make sure they will send right for regular
     invoice, unpaid, paid, multiple houses."

     ⛔ NOTHING IN THIS REPO HAD EVER READ AN INVOICE EMAIL IT PRODUCED. Every existing
     check here proves the invoice DOCUMENT — the install total, the fee, the flags. The
     BODY went to a fake that answered ok and dropped it, so the wording, the amounts in
     the sentence, which template was chosen and whether a receipt still said "Pay Your
     Invoice" were all unexamined. That is the same shape as the crash these four sit
     beside: the document was right and the thing the customer got did not exist.
     ⚠ SO THESE RUN THE REAL SEND AND READ THE BYTES. Not one matches source.
     ===================================================================== */
  {
    const priced = (extra) => Object.assign({
      housePrice: 400, measuredFeet: 100, completed: true, completedAt: daysAgo(1)
    }, extra || {});

    /* ---- 1 & 2. A REGULAR, UNPAID BILL ---------------------------------- */
    {
      const { res, sent } = await runBatch({ a1: priced({
        name: 'Jane Smith', phone: '8015550111', email: 'jane@x.com',
        address: '1 Elm St', customerNumber: '101' }) });
      const body = asText(sent[0] && sent[0].body);
      check('a regular unpaid bill goes out, and says what is owed',
        res.sentCount === 1 && /Amount due: \$400\.00/.test(body),
        'sent=' + res.sentCount + ' body=' + JSON.stringify(body.slice(0, 200)));
      check('and it names the footage the price was worked out from',
        /100 ft/.test(body) && /\$400\.00/.test(body),
        'a bill whose total cannot be checked against anything is the one a customer ' +
        'rings up about; feetLine is what makes it add up on the page');
      check('and it offers a way to pay',
        /Pay Your Invoice/.test(body) && /Pay with Venmo/.test(body),
        'body=' + JSON.stringify(body));
      check('and it carries a due date',
        /Please pay by \w+ \d+, \d{4}/.test(body),
        'the date the CUSTOMER is told, from the invoice own timestamp — the one ' +
        '`invoiceIssuedAt` exists to keep the paper and the screen agreeing about');
    }

    /* ---- 3. PAID IN FULL ------------------------------------------------
       ⚠ THE CHECK THAT EARNS ITS PLACE IS THE ABSENCE. A receipt that still says "Pay
       Your Invoice" asks a settled customer for money again, which is the complaint
       nobody forgets — and it is one wrong token in a template away at all times. */
    {
      const { res, sent, asked } = await runBatch({ a1: priced({
        name: 'Paid Pete', phone: '8015550222', email: 'pete@x.com',
        address: '2 Oak Ave', customerNumber: '102' }) },
        { invoices: { '8015550222': { install: 400, removal: 0, changeFees: 0, credits: 0, deposit: 400 } } });
      const body = asText(sent[0] && sent[0].body);
      check('a paid-up customer gets a receipt, not a bill',
        res.sentCount === 1 && /paid in full/i.test(body) && /Amount paid: \$400\.00/.test(body),
        'sent=' + res.sentCount + ' body=' + JSON.stringify(body.slice(0, 200)));
      check('and the receipt never asks them to pay again',
        !/Pay Your Invoice/.test(body) && !/Pay with Venmo/.test(body) && !/Amount due/.test(body),
        'body=' + JSON.stringify(body) + '. Asking a settled customer for money is the ' +
        'one invoice mistake they will certainly notice and certainly ring about.');
      /* ⚠ AND IT ASKS FOR THE RIGHT TEMPLATE BY NAME, which nothing could see while the
         lookup was stubbed: the body is chosen by its own `status` test, so a paid
         customer kept getting correct BUILT-IN wording while the run fetched the office's
         UNPAID template — which says "Amount due" and carries pay buttons. In production
         that is a settled customer asked to pay again; in the harness it was invisible.
         Caught by the red-check of 2026-10-06 as a miss. */
      check('and it fetches the PAID template, not the unpaid one',
        (asked || []).some(n => /Paid Receipt/.test(String(n))) &&
        !(asked || []).some(n => /Unpaid/.test(String(n))),
        'asked for: ' + JSON.stringify(asked));
      check('and the subject line says so too',
        /paid in full/i.test(String(sent[0] && sent[0].subject)),
        'subject=' + JSON.stringify(sent[0] && sent[0].subject) +
        '. A receipt whose subject reads like a bill is opened as a bill.');
    }

    /* ---- 4. PART PAID --------------------------------------------------- */
    {
      const { res, sent } = await runBatch({ a1: priced({
        name: 'Half Hannah', phone: '8015550333', email: 'h@x.com',
        address: '3 Pine Rd', customerNumber: '103' }) },
        { invoices: { '8015550333': { install: 400, removal: 0, changeFees: 0, credits: 0, deposit: 150 } } });
      const body = asText(sent[0] && sent[0].body);
      check('a part-paid customer is asked for the REMAINDER, not the total',
        res.sentCount === 1 && /Amount due: \$250\.00/.test(body) && !/Amount due: \$400\.00/.test(body),
        'body=' + JSON.stringify(body.slice(0, 200)) + '. 400 billed, 150 paid, 250 due. ' +
        'Billing the total again is double-charging somebody who already paid.');
    }

    /* ---- 5. MULTIPLE HOUSES ON ONE BILL --------------------------------
       The two halves of a group, deliberately: `kid` joins by billToPhone, `cabin` joins
       because its own invoice key matches with no field set anywhere. A fixture of
       billToPhone houses alone passes whether the second half is read or not. */
    const groupBook = {
      payer: priced({ name: 'Dana Payer', phone: '8015550444', email: 'dana@x.com',
        address: '10 Main St', customerNumber: '14', completedAt: daysAgo(3) }),
      kid: priced({ name: 'Kyle Kid', phone: '8015550999', billToPhone: '8015550444',
        address: '22 Second St', housePrice: 350, measuredFeet: 90, customerNumber: '20',
        completedAt: daysAgo(2) }),
      cabin: priced({ name: 'Dana Cabin', phone: '8015550444', address: '99 Hill Dr',
        housePrice: 250, measuredFeet: 60, customerNumber: '27', completedAt: daysAgo(1) })
    };
    {
      const { res, sent, db } = await runBatch(groupBook);
      const body = asText(sent[0] && sent[0].body);
      const inv = db.store.invoices['8015550444'];
      check('a shared bill goes out ONCE, not once per house',
        res.sentCount === 1,
        'sent=' + res.sentCount + '. Three emails for one bill reads as being charged ' +
        'three times, and two of them name a total the recipient does not owe.');
      check('and it names every house on it',
        ['10 Main St', '22 Second St', '99 Hill Dr'].every(a => body.includes(a)),
        'body=' + JSON.stringify(body) + '. A total bigger than the house they are ' +
        'looking at, with nothing saying why, is the question this block exists to answer.');
      check('and the total is the houses added up',
        /Amount due: \$1000\.00/.test(body) && Number(inv.install) === 1000,
        'body total vs install=' + (inv && inv.install) + '. 400+350+250. If the rows and ' +
        'the figure disagree the customer is right to query the whole bill.');
      check('and the invoice records which houses it covered',
        Array.isArray(inv.billedHouseIds) && inv.billedHouseIds.length === 3,
        'billedHouseIds=' + JSON.stringify(inv && inv.billedHouseIds) + '. This is the ' +
        'list the total was summed from, so the rows and the amount cannot drift.');
      check('and only the payer is emailed',
        res.sentCount === 1 && String(sent[0] && sent[0].to_email) === 'dana@x.com',
        'to=' + JSON.stringify(sent[0] && sent[0].to_email) + '. Kyle pays nothing; a ' +
        'bill naming a landlord other tenants and their prices goes to the wrong person.');
    }

    /* ⚠ AND IT RESOLVES TO NOTHING FOR A ONE-HOUSE CUSTOMER, which the red-check found
       nothing asserting. The office renderer returns '' there on purpose: a heading
       reading "who you are paying for this year" over a single address is a question
       nobody asked, and repeating that house's own feet line twice on its own bill reads
       as a duplicate charge. */
    {
      const { sent } = await runBatch({ a1: priced({
        name: 'Solo Sam', phone: '8015550777', email: 'sam@x.com',
        address: '7 Only Way', customerNumber: '107' }) },
        { template: 'Hi {{name}},<br>[{{houses_block}}]<br>Due: {{amount_due}}' });
      const body = asText(sent[0] && sent[0].body);
      check('{{houses_block}} says nothing at all for a single-house customer',
        /\[\]/.test(body.replace(/\s+/g, '')) || /\[\s*\]/.test(body),
        'body=' + JSON.stringify(body) + '. Matching the office renderer, which returns ' +
        'empty for one house; the feet line already names it once.');
      check('and that bill still carries its amount',
        /Due: \$400\.00/.test(body),
        'body=' + JSON.stringify(body));
    }

    /* ---- 6. THE TOKEN HOLE --------------------------------------------
       ⛔ FOUND 2026-10-06 BY RUNNING THIS, and it is the {{photo}} failure of 2026-08-17
       arriving in the email that asks for money. admin.html offers ~52 codes in Insert
       Code; this send resolved 15 of them and left the other 37 ALONE — a split().join()
       chain simply passes over what it does not know. So an office that put
       {{houses_block}} in the invoice template (which admin's own comment invites: "Any
       template can use it") mailed every shared-bill customer those literal characters.
       ⚠ AND THE BUILT-IN BODY HID IT COMPLETELY: it uses only resolved tokens, and this
       harness stubbed the template lookup empty, so the whole editable half was
       unexercised. A fixture that cannot reach the fault proves nothing about it. */
    {
      const tpl = 'Hi {{name}},<br><br>{{houses_block}}<br><br>Total: {{amount_total}}<br>'
                + 'Due: {{amount_due}} by {{due_date}}<br>{{setup_fee_line}}<br>'
                + '{{pay_button}} {{messages_link}}';
      /* ⚠ THE DEPOSIT IS WHAT MAKES THIS CHECK BITE, and its absence is what the
         red-check caught: with nothing paid, total and amountDue are both $1000 and
         {{amount_total}} reading the BALANCE is indistinguishable from it reading the
         BILL. 250 paid separates them — the vacuous-fixture trap this repo names in
         five other places. */
      const { res, sent } = await runBatch(groupBook, { template: tpl,
        invoices: { '8015550444': { install: 1000, removal: 0, changeFees: 0, credits: 0, deposit: 250 } } });
      const raw = String(sent[0] && sent[0].body || '');
      const body = asText(raw);
      check('an office template using {{houses_block}} names the houses',
        ['10 Main St', '22 Second St', '99 Hill Dr'].every(a => body.includes(a)),
        'body=' + JSON.stringify(body) + '. Aliased to the per-house block the run ' +
        'already built — never a second renderer, because two renderers of one claim is ' +
        'what this repo has been bitten by four times.');
      check('and NO code is ever mailed to a customer as its own characters',
        !/\{\{[a-zA-Z_]+\}\}/.test(raw),
        'left literal: ' + JSON.stringify((raw.match(/\{\{[a-zA-Z_]+\}\}/g) || [])) +
        '. This is the whole fault: a bill with a code printed in it looks broken to the ' +
        'customer and is invisible to us.');
      check('and {{amount_total}} is the bill before payments, {{amount_due}} after',
        /Total: \$1000\.00/.test(body) && /Due: \$750\.00/.test(body),
        'body=' + JSON.stringify(body) + '. BOTH figures, because that is the only way ' +
        'the two tokens can be told apart: 1000 billed, 250 paid, 750 due. Same ' +
        'expression the payment-received email uses, so the two cannot disagree.');
      check('and the plural {{messages_link}} resolves, not just the singular',
        /contact/.test(raw),
        'the editor offers the PLURAL and this send only ever resolved the singular — a ' +
        'one-character trap that prints a code on a bill');
    }
    {
      /* ⚠ STRIPPED **AND COUNTED**. rsvp-text-wording's own lesson from the literal
         {{photo}}: the token being wrong was never the fault — nothing counting what it
         could not render was. A missing line is a template the run NAMES; a printed code
         is the customer ringing up. */
      const { res, sent } = await runBatch(groupBook,
        { template: 'Hi {{name}},<br>{{photo}} {{rsvp_yes_button}} {{nonsense_code}}<br>{{amount_due}}' });
      const raw = String(sent[0] && sent[0].body || '');
      check('a code this send cannot fill is left out of the bill',
        res.sentCount === 1 && !/\{\{/.test(raw) && /\$1000\.00/.test(raw),
        'raw=' + JSON.stringify(raw) + '. The rest of the bill must still go out — ' +
        'refusing the send over a bad template bills nobody at all.');
      check('and the run log NAMES the codes and the template to fix',
        res.errors.some(e => /cannot fill/.test(e) && /\{\{photo\}\}/.test(e)
                          && /Nightly Auto-Invoice/.test(e)),
        'errors=' + JSON.stringify(res.errors) + '. Silent stripping would make a ' +
        'half-written template indistinguishable from a working one, for ever.');
      check('and a made-up code is caught as well as a real one',
        res.errors.some(e => /\{\{nonsense_code\}\}/.test(e)),
        'a typo in the template editor is the commonest way this happens, and it is the ' +
        'case a list of known tokens would miss');
    }
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
})().catch(e => {
  console.log('  FAIL  the gate itself crashed: ' + (e && e.message));
  console.log(e && e.stack);
  process.exit(1);
});
