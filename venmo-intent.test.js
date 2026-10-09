/*
 * Opening Venmo is an intention, never a payment
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Venmo is a deep link — `venmo.com/HighLightingUtah?txn=pay&amount=…` — with no
 * webhook, no callback and no receipt coming back to us. PayPal records itself;
 * Venmo records nothing. So a customer who paid that way stayed **Unpaid** on every
 * screen, joined the 1 February text list, and would have collected an April late fee
 * for money they had already sent.
 *
 * Addie, asked how a Venmo payment should reach the app: *"We can't even login to venmo
 * we just see it if it comes to email so I think it will be easiest if this was manual"*,
 * and on recording the press itself: *"We can do this one so people are marked as venmo
 * and we can just check on venmo."*
 *
 * ⛔ AND HER WORRY IS THE THING THIS FILE MOSTLY EXISTS TO HOLD: *"you can change the
 * amount so if someone changes the amount it can be problamatic."* She is right — the
 * `amount` in that link is a PRE-FILL the payer confirms and can edit in the Venmo app.
 * So the rule every check below defends is that **nothing about the press may touch
 * money**: no `deposit`, no `status`, no `credits`, no balance, and no stored amount that
 * a later reader could mistake for one. What the office types in off the Venmo email is
 * the only figure that ever becomes a payment.
 *
 * ⚠ THE CALLABLE IS RUN, NOT READ. "It writes one field and nothing else" is a claim
 * about what a function DOES, and a regex over its source cannot see a second write
 * hidden behind a helper. It is executed against a fake Firestore and every write it
 * makes is counted.
 *
 * ⚠ AND THE OFFICE-SIDE RULE IS RUN TOO, because it is derived rather than stored: the
 * mark has to disappear the moment the payment is entered, and that is arithmetic on a
 * balance, which a text check cannot see either.
 *
 * ⚠ RED-CHECKED 17 of 17 on the three source files, and 2 of 3 in a real browser. The
 * browser miss is a labelled no-op: dropping the client's `if(!tok) return;` changes
 * nothing in a spec where the customer IS signed in, and the server refuses a blank token
 * anyway (checked below). That guard saves a pointless round trip, not a payment.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node venmo-intent.test.js      (or: npm run test:venmo)
 */

const fs = require('fs');
const path = require('path');
const scan = require('./connections/scan.js');

const ROOT = __dirname;
const fns = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const site = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

/* Comments out, using the repo's own scanner rather than a pair of regexes — every
   surface below is introduced by a paragraph naming the thing being checked, so a plain
   search finds the prose defending the rule and passes on a file where the wiring has
   gone. A hand-rolled stripper was tried in nightly-invoice.test.js and reported real
   code as missing, because a comment-opening sequence inside a string ran it away. */
const cleanAdmin = scan.blankNonCode(admin);
const cleanSite = scan.blankNonCode(site);
const cleanFns = scan.blankNonCode(fns);

function liftFrom(src, name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = src.indexOf(opener);
    if (at === -1) continue;
    const end = src.indexOf('\n}', at);
    if (end === -1) return '';
    return src.slice(at, end + 2);
  }
  return '';
}

(async function main() {

  /* =====================================================================
     1. THE CALLABLE WRITES ONE FIELD AND NOTHING ELSE.
     ===================================================================== */
  const body = (function () {
    const at = fns.indexOf('exports.portalVenmoOpened = onCall(');
    if (at === -1) return '';
    const end = fns.indexOf('\n});', at);
    return end === -1 ? '' : fns.slice(at, end + 4);
  })();
  check('portalVenmoOpened exists and could be lifted', !!body,
    'without it every check in this section proves nothing');

  if (body) {
    /* A fake Firestore that records every write, and a fake that fails loudly if the
       function reaches for a collection it has no business in. */
    function makeDb(record) {
      const writes = [];
      const touched = [];
      return {
        writes: writes, touched: touched,
        collection: (col) => {
          touched.push(col);
          return {
            doc: (id) => ({
              id: id,
              get: async () => ({ exists: true, data: () => record }),
              update: async (v) => { writes.push({ col: col, id: id, v: v }); },
              set: async (v) => { writes.push({ col: col, id: id, v: v, op: 'set' }); }
            }),
            add: async (v) => { writes.push({ col: col, v: v, op: 'add' }); return { id: 'n' }; },
            where: () => ({ limit: () => ({ get: async () => ({
              empty: !record,
              docs: record ? [{ id: 'cust1', data: () => record }] : []
            }) }) })
          };
        }
      };
    }
    const FV = { serverTimestamp: () => ({ __sv: true }) };
    const adminStub = { firestore: Object.assign(() => ({}), { FieldValue: FV }) };

    function run(token, record) {
      const db = makeDb(record);
      let thrown = null;
      const sandbox = `
${liftFrom(fns, 'findByToken')}
const exports = {};
function onCall(opts, fn){ return fn; }
class HttpsError extends Error { constructor(code, msg){ super(msg); this.code = code; } }
${body}
return {fn: exports.portalVenmoOpened, db: __db};
`;
      const built = new Function('db', 'admin', '__db', sandbox)(db, adminStub, db);
      return built.fn({ data: { token: token } })
        .then(res => ({ res: res, db: db, thrown: null }))
        .catch(e => ({ res: null, db: db, thrown: e }));
    }

    const rec = { name: 'Venmo Val', phone: '8015550111', portalToken: 'tok-abc' };

    {
      const { res, db } = await run('tok-abc', rec);
      check('a valid token records that they opened Venmo',
        res && res.ok === true && db.writes.length === 1,
        'wrote ' + (db.writes.length) + ' time(s)');
      const w = db.writes[0] || {};
      check('and it writes exactly one field, venmoOpenedAt',
        w.col === 'jobAddresses' && Object.keys(w.v || {}).length === 1 &&
        'venmoOpenedAt' in (w.v || {}),
        'wrote ' + JSON.stringify(w.v) + ' to ' + w.col);
      /* ⛔ THE CHECK THAT EARNS THE FILE. Addie's worry is the amount, so the one thing
         this must never do is put a number anywhere near money. Named fields rather than
         a blanket count, because the count above would pass a rename. */
      const MONEY = ['deposit', 'install', 'removal', 'credits', 'creditNotes',
        'changeFees', 'changeFeeNotes', 'status', 'lastPaymentAt', 'lastPaymentMethod',
        'carryoverCredit', 'venmoOpenedFor', 'amount'];
      const wrote = Object.keys(w.v || {});
      const bad = MONEY.filter(f => wrote.indexOf(f) !== -1);
      check('and it touches nothing about money, and stores no amount',
        bad.length === 0,
        'wrote: ' + bad.join(', ') +
        '. Opening Venmo is an intention. The amount in that link is a pre-fill the ' +
        'customer can edit, so a number recorded here could only be what we ASKED for — ' +
        'already on the bill, and a snapshot of it would be a second opinion about a ' +
        'balance sitting next to real money.');
      check('and it never writes to the invoices collection at all',
        db.touched.indexOf('invoices') === -1 &&
        !db.writes.some(x => x.col === 'invoices'),
        'touched: ' + JSON.stringify(db.touched));
    }
    {
      /* ⚠ THE AMOUNT IS NOT MERELY UNUSED, IT IS UNREACHABLE. A caller posting one must
         not get it stored by some later edit that reads `body.amount` "because it is
         there". This is a PUBLIC callable — anybody with a token reaches it — so a number
         from the client is a number of unknown provenance. */
      const { db } = await run('tok-abc', rec);
      const { db: db2 } = await (function () {
        const d = makeDb(rec);
        const sandbox = `
${liftFrom(fns, 'findByToken')}
const exports = {};
function onCall(opts, fn){ return fn; }
class HttpsError extends Error { constructor(code, msg){ super(msg); this.code = code; } }
${body}
return exports.portalVenmoOpened;
`;
        const fn = new Function('db', 'admin', sandbox)(d, adminStub);
        return fn({ data: { token: 'tok-abc', amount: 9999, deposit: 9999 } })
          .then(() => ({ db: d })).catch(() => ({ db: d }));
      })();
      check('a client that posts an amount has it ignored entirely',
        JSON.stringify(db.writes) === JSON.stringify(db2.writes),
        'posting amount/deposit changed what was written: ' + JSON.stringify(db2.writes));
    }
    {
      const { thrown, db } = await run('', rec);
      check('no token is refused, and writes nothing',
        thrown && thrown.code === 'invalid-argument' && db.writes.length === 0,
        String(thrown && thrown.code));
    }
    {
      const { thrown, db } = await run('tok-nope', null);
      check('a token nobody owns is refused, and writes nothing',
        thrown && thrown.code === 'not-found' && db.writes.length === 0,
        String(thrown && thrown.code) +
        '. It throws like every other portal callable so index.html\'s shared ' +
        'portalCallFailedText tells them the link may be out of date.');
    }
  }

  /* =====================================================================
     2. THE OFFICE-SIDE MARK IS DERIVED, SO NOTHING HAS TO CLEAR IT.
     ===================================================================== */
  {
    const src = liftFrom(admin, 'custWaitingOnVenmo');
    check('custWaitingOnVenmo could be lifted', !!src);
    if (src) {
      /* ⚠ THE REAL getLiveInvoiceStatus IS NOT LIFTED HERE, deliberately — it walks the
         invoice cache and the billing group, and what is under test is this rule's own
         composition: does it ask the bill, and does it stop reporting once settled. The
         stub is named so nobody mistakes it for the real thing. */
      const mk = (status) => new Function('getLiveInvoiceStatus',
        src + 'return custWaitingOnVenmo;')(() => status);

      check('somebody who opened Venmo and still owes is waiting',
        mk('Unpaid')({ venmoOpenedAt: { __ts: 1 } }) === true);
      /* ⛔ AND THIS IS HER WORRY, AS A CHECK. They opened Venmo owing $430 and sent $50:
         the bill is Partial Payment, there is still money outstanding, and they must stay
         on the list. A rule that cleared on "any payment at all" would lose exactly the
         short payment she is worried about. */
      check('a PART payment leaves them waiting, which is the short-payment case',
        mk('Partial Payment')({ venmoOpenedAt: { __ts: 1 } }) === true,
        'the amount in the Venmo link is a pre-fill they can change, so paying less than ' +
        'the bill is the ordinary way this goes wrong — and it must stay visible');
      check('and being settled takes the mark away with no clearing write anywhere',
        mk('Paid in Full')({ venmoOpenedAt: { __ts: 1 } }) === false,
        'stored fact, derived display — the derivedDoneFor shape. A clearing path would ' +
        'be a second writer and one more thing to get wrong.');
      check('somebody who never opened Venmo is never marked, however unpaid',
        mk('Unpaid')({}) === false && mk('Unpaid')({ venmoOpenedAt: null }) === false,
        'otherwise the tag lands on the whole unpaid book and says nothing');
    }
  }

  /* =====================================================================
     3. WHERE THE OFFICE SEES IT, AND HOW A VENMO PAYMENT IS RECORDED.
     ===================================================================== */
  check('All Customers can filter to them',
    /activeVenmoFilter = document\.getElementById\('filterVenmo'\)\.checked/.test(cleanAdmin) &&
    /filtered\.filter\(a => custWaitingOnVenmo\(a\.data\)\)/.test(cleanAdmin),
    'the mark is only useful as a LIST — "check Venmo for these people" is the whole ask');
  check('and the filter has a box to tick',
    /id="filterVenmo"/.test(admin));
  check('the row carries a Check Venmo chip',
    /custWaitingOnVenmo\(d\) \?/.test(cleanAdmin) && /Check Venmo/.test(admin),
    'she is looking at All Customers, not at a field on a record');

  /* ⭐ THE LEDGER LABEL FINALLY HAS A WRITER. `PAYMENT_METHOD_LABEL.venmo` has existed
     since the ledger was built and nothing ever wrote it — a reader with no writer, which
     §1 calls an error rather than a detail. */
  check('the payment ledger records a Venmo payment as Venmo',
    /wasVenmo \? 'venmo' : 'manual'/.test(cleanAdmin),
    'PAYMENT_METHOD_LABEL has carried a venmo label with no writer since the ledger was ' +
    'built; the office types these in off the Venmo email, so the method is known');
  check('and it is derived from the mark, not asked as a second prompt',
    /custWaitingOnVenmo\(venmoCust\.data\)/.test(cleanAdmin),
    'a second prompt on a prompt()-based entry costs a click on every payment');
  check('a correction is still a correction, never a Venmo payment',
    /paidNow < 0 \? 'correction'/.test(cleanAdmin),
    'the figure going down is somebody fixing a typo, and must not be filed as money ' +
    'arriving by any method');

  /* =====================================================================
     4. THE PORTAL FIRES IT ONCE, AND NEVER WAITS ON IT.
     ===================================================================== */
  {
    check('the portal records the press',
      /callPortalFn\('portalVenmoOpened'/.test(cleanSite),
      'without this nothing is ever marked and the whole list is empty');
    /* ⛔ BOUND ONCE. updateTipBreakdown runs again on every amount change — a tip, an
       instalment — so a listener added per render would fire a write per render. That is
       the shape of the sidebar drag that once fired 2,815 Firestore writes off one
       gesture, measured. */
    check('the click listener is bound once, not on every render',
      /_venmoOpenBound/.test(cleanSite),
      'updateTipBreakdown re-runs whenever the amount changes; an unguarded ' +
      'addEventListener there accumulates listeners and writes');
    /* ⚠ NOT AWAITED. The link opens Venmo in another tab and must not wait on us:
       standing between a customer and paying, to file a note for ourselves, is the wrong
       way round. */
    const at = cleanSite.indexOf("callPortalFn('portalVenmoOpened'");
    const line = at === -1 ? '' : cleanSite.slice(Math.max(0, at - 120), at + 40);
    check('and it is not awaited, so the link is never held up',
      at !== -1 && !/await\s*$/.test(line.slice(0, line.indexOf("callPortalFn"))),
      'the customer is on their way to Venmo; a note for the office must not delay that');
    check('and a failure cannot stop them paying',
      /portalVenmoOpened[\s\S]{0,400}?\.catch\(/.test(cleanSite),
      'the only thing lost on a failure is a row on an office list they reach anyway ' +
      'through the ordinary unpaid filters');

    /* ⛔ AND IT IS DELIBERATELY NOT IN PORTAL_READ_FIELDS. This is an office to-do, not
       something to tell the customer: "we have not seen your payment" is a thing we cannot
       honestly say when nobody has checked yet, and saying it to somebody who HAS paid is
       worse than saying nothing. Asserted so a later sweep does not add it for tidiness. */
    const listMatch = fns.match(/const PORTAL_READ_FIELDS = \[([\s\S]*?)\n\];/);
    check('the portal read list was findable', !!listMatch,
      'without it the check below would pass vacuously');
    check('and venmoOpenedAt is NOT sent to the customer',
      !!listMatch && listMatch[1].indexOf('venmoOpenedAt') === -1,
      'a customer told "we have not seen your Venmo payment" when nobody has looked yet ' +
      'is worse than being told nothing');
  }

  /* =====================================================================
     5. THE LINK ITSELF IS UNCHANGED, AND STAYS A LAST RESORT.
     ===================================================================== */
  check('the Venmo link still pre-fills the amount',
    /txn=pay&amount=/.test(cleanSite),
    'nothing here changes how a customer pays. Dropping the pre-fill would make a WRONG ' +
    'amount more likely, not less — they would type it themselves.');
  /* ⚠ HER 2026-09-01 RULING IS UNTOUCHED: "I want venmo under other payments not showing
     at all cause I want venmo to be a last resort". Recording the press must not promote
     it back to an equal option. */
  check('and it is still shut inside Other payment options by default',
    /otherPanel\.open = false/.test(cleanSite),
    'Addie put Venmo behind a closed <details> on purpose; this change records a press ' +
    'and must not make the button any more prominent');

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
