/*
 * A new member actually gets a bill
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * ⛔ BECAUSE NOTHING RAN runInvoiceBatch, AND A ONE-WORD CRASH IN IT BILLED NOBODY.
 * Live from 2026-09-18 to 2026-10-02. The new-member branch read `nowMs`, which is not
 * declared anywhere in that function — the only two declarations of that name in
 * functions/index.js are a `const` inside portalSave's lights branch and a parameter of
 * runLateFeeBatch, neither of them in scope. Reading an undeclared identifier throws.
 *
 * What that cost, and the ORDER is the whole of it:
 *   - the throw landed in the per-payer `catch`, so the payer was counted as an error
 *     and skipped;
 *   - it happened BEFORE `invRef.set`, so no invoice document was written at all —
 *     nothing in their member portal, no record anywhere of what was owed;
 *   - `invoiceEmailSent` was never set, so it retried every night and failed the same
 *     way, for a fortnight.
 *
 * ⚠ SO IT WAS EXACTLY THE NEW MEMBERS, AND ONLY THEM. `chargeNewMemberFee === true` is
 * the one thing that reaches that branch, so a returning customer billed perfectly
 * throughout and nothing looked wrong from any screen. THE PAIR OF CHECKS BELOW IS THE
 * WHOLE POINT: one fixture, that single field flipped. Either row alone proves nothing,
 * because the failure was that one branch threw while the other worked — a suite that
 * only ever billed a returning customer stayed green through it.
 *
 * ⚠ AND EVERY EXISTING CHECK ON THAT FUNCTION PASSED THE WHOLE TIME. run-all.js reads
 * runInvoiceBatch with `sectionFrom` and regexes in nine places, and the source LOOKS
 * right, because it is right apart from one identifier that does not exist. A text check
 * cannot see scope. That is the lesson Suite 10 wrote down for syncPayerInvoice ("a regex
 * cannot catch an undefined variable and a text-only check is exactly what let the
 * forTotal crash ship for a day") arriving a second time in the same family of code.
 *
 * ⚠ SO EVERY CHECK HERE RUNS THE SHIPPED FUNCTION against a fake Firestore. Not one of
 * them matches its source, on purpose: the claim is whether a document gets written, and
 * a regex can see neither the write nor the throw that prevents it.
 *
 * ⚠ AND IT LIFTS, IT NEVER STUBS, the rules the answer depends on — houseIsOnTheBillServer,
 * computeInvoiceStatusServer, invoiceKeyFor, the invoice calendar. A stub of any of them
 * would decide the very thing under test. Only the genuinely external edges are faked:
 * EmailJS, the template lookup, the token mint, and Firestore itself.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node new-member-billed.test.js      (or: npm run test:newmember)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const fns = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

/* Lifts a function by name, slicing to its closing brace at column 0 — the terminator
   every other harness in this repo relies on.
   ⚠ `async` FIRST, because extractFn's habit of matching only `function NAME(` is written
   up in CLAUDE.md as having cost three suites a run: the body arrives full of bare
   `await`, a parse error that kills the whole file as one unattributable crash. */
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

/* ⚠ A CENSUS, NOT A FLOOR. A name that stops being lifted arrives as a bare
   ReferenceError out of the middle of a run — the extraction-list trap CLAUDE.md records
   having been caught by ten times — so the list is asserted and a change to it is a
   deliberate edit here. */
const LIFTED = ['runInvoiceBatch', 'houseIsOnTheBillServer', 'computeInvoiceStatusServer',
  'invoiceKeyFor', 'digitsOnly', 'todayStrInDenver', 'tryFirestore', 'invoiceDueDateServer',
  'invoiceSeasonYearServer', 'endOfFebruaryServer', 'centsOf', 'properNameServer',
  'toMillis', 'logNightlyInvoiceRun'];
const missing = LIFTED.filter(n => !lift(n));
check('every rule the billing run depends on could be lifted out of the server',
  missing.length === 0,
  'could not find: ' + missing.join(', ') +
  '. A missing lift arrives as a bare ReferenceError from the middle of a run, which is ' +
  'the trap this file was written after being caught by.');
const lifted = LIFTED.map(lift).join('\n\n');

/* The fee, read from the source rather than typed here — a copy would go on passing
   against a price the app has moved off, which is what seven fixtures did to
   CN_DOUBLE_BIN_FEET. */
const NEW_MEMBER_FEE = Number((fns.match(/const NEW_MEMBER_FEE = (\d+)/) || [])[1]);
check('the installation fee was found in the source', NEW_MEMBER_FEE > 0,
  'got ' + NEW_MEMBER_FEE + '. Typing it here would let this pass against a price the ' +
  'app no longer charges.');

/* ---------------------------------------------------------------------------
 * A fake Firestore that records every write, so a check can ask what actually
 * landed rather than what the function says it did.
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

function daysAgo(n) {
  const ms = Date.now() - (n * 86400000);
  return { __ts: ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) };
}

/* Runs the REAL batch over one book of customers. */
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
  const sandbox = lifted + `
async function findTemplateSnapByName(n){ return { empty: true, docs: [] }; }
function templateSubjectOr(t, f){ return f; }
async function ensureToken(id, d){ return 'tok'; }
const NEW_MEMBER_FEE = ${NEW_MEMBER_FEE};
return runInvoiceBatch('test');
`;
  const fn = new Function('db', 'admin', 'fetch', 'console', sandbox);
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  return fn(db, adminStub, async () => ({ ok: true, text: async () => '' }), quiet)
    .then(res => ({ res: res, db: db }));
}

(async function main() {

  const oneHouse = (extra) => ({
    solo: Object.assign({
      name: 'New Guy', phone: '8015550111', email: 'new@x.com', address: '1 Elm St',
      housePrice: 400, measuredFeet: 100, completed: true, completedAt: daysAgo(1),
      customerNumber: '101'
    }, extra || {})
  });

  /* =====================================================================
     THE PAIR. Same fixture, one field flipped. This is the file.
     ===================================================================== */
  {
    const { res, db } = await runBatch(oneHouse({ chargeNewMemberFee: true }));
    const inv = db.store.invoices['8015550111'];
    check('a NEW MEMBER is billed at all',
      res.sentCount === 1 && res.errorCount === 0,
      'sent=' + res.sentCount + ' errors=' + res.errorCount + ' ' + JSON.stringify(res.errors) +
      '. This is the crash: `nowMs` is not declared in runInvoiceBatch, the throw was ' +
      'swallowed by the per-payer catch, and the payer was skipped before the invoice was ' +
      'ever written.');
    check('and an invoice document actually exists for them',
      !!inv,
      'nothing was written to invoices/8015550111. The throw landed before invRef.set, so ' +
      'there was no bill to send and nothing in their member portal either — which is why ' +
      'pressing Send Invoices Now is what collects this money, not a re-send.');
    check('and the installation fee is folded into the total',
      !!inv && Number(inv.install) === 400 + NEW_MEMBER_FEE,
      'install=' + (inv && inv.install) + ', expected ' + (400 + NEW_MEMBER_FEE));
    check('and the fee records WHEN it was charged',
      !!inv && inv.newMemberFeeApplied === true && !!inv.newMemberFeeAppliedAt,
      'Addie asked for every fee on a member account to be dated. Timestamp.now() rather ' +
      'than a server sentinel, because the {{due_date}} maths reads this invoice back ' +
      'inside the same run.');
    check('and the bill is marked sent on the customer',
      db.store.jobAddresses.solo.invoiceEmailSent === true,
      'without this the same payer is billed again on the next run');
  }
  {
    /* THE CONTROL. If this fails, the harness is wrong, not the app. */
    const { res } = await runBatch(oneHouse({ chargeNewMemberFee: false }));
    check('a RETURNING customer bills the same way, with no fee',
      res.sentCount === 1 && res.errorCount === 0,
      'sent=' + res.sentCount + ' errors=' + res.errorCount +
      '. This row is why the crash went unnoticed for a fortnight: it passed throughout.');
  }

  /* =====================================================================
     AND THE GUARD THAT MAKES A RE-RUN SAFE — which matters more than usual
     here, because the fix is followed by somebody pressing Send Invoices Now.
     ===================================================================== */
  {
    const { db } = await runBatch(oneHouse({ chargeNewMemberFee: true }), {
      invoices: { '8015550111': { install: 400 + NEW_MEMBER_FEE, removal: 0, deposit: 0,
                                  newMemberFeeApplied: true } }
    });
    check('the installation fee is never charged twice',
      Number(db.store.invoices['8015550111'].install) === 400 + NEW_MEMBER_FEE,
      'install=' + db.store.invoices['8015550111'].install +
      '. `newMemberFeeApplied` on an existing invoice is the only guard, and it is what ' +
      'makes Send Invoices Now safe to press after this ships.');
  }
  {
    /* ⚠ AND A PAYER ALREADY BILLED IS NOT BILLED AGAIN. `invoiceEmailSent` is what makes
       the whole run idempotent — the thing that lets the office press the button without
       counting how many times. */
    const { res } = await runBatch(oneHouse({ chargeNewMemberFee: true, invoiceEmailSent: true }));
    check('a payer whose bill already went out is left alone',
      res.sentCount === 0 && res.errorCount === 0,
      'sent=' + res.sentCount);
  }

  /* =====================================================================
     THE SCOPE CHECK. The one thing a text check CAN usefully say here, and it
     is the shape of the bug rather than its symptom.
     ===================================================================== */
  {
    /* ⚠ COMMENTS STRIPPED WITH THE REPO'S OWN SCANNER. The fix is introduced by a
       paragraph that QUOTES the old broken line to explain it, so a plain search finds the
       prose defending the fix and reports the bug as still present — the Suite 58 trap,
       which five separate gates in this repo have each had to learn. */
    const scan = require('./connections/scan.js');
    const clean = scan.blankNonCode(fns).split('\n');
    const at = clean.findIndex(l => /^async function runInvoiceBatch/.test(l));
    let end = at;
    for (let i = at + 1; i < clean.length; i++) { if (/^}/.test(clean[i])) { end = i; break; } }
    const body = clean.slice(at, end + 1).join('\n');
    check('runInvoiceBatch references no identifier it does not have',
      at > -1 && !/\bnowMs\b/.test(body),
      'live code in runInvoiceBatch still mentions nowMs. There is no such variable in ' +
      'that scope — the only declarations are inside portalSave and runLateFeeBatch — so ' +
      'reading it throws, and the throw costs the whole payer their bill.');
    /* ⚠ AND THE DECLARATIONS ARE COUNTED, so this cannot be "fixed" one day by declaring a
       module-level nowMs, which would make the name resolve and quietly freeze the stamp at
       whatever moment the file was loaded. */
    const moduleLevel = (fns.match(/^(const|let|var)\s+nowMs\b/gm) || []).length;
    check('and nobody has papered over it with a module-level nowMs',
      moduleLevel === 0,
      'found ' + moduleLevel + '. Declaring it at module level would make the name resolve ' +
      'and freeze every fee date at load time — a wrong answer instead of a loud one.');
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
