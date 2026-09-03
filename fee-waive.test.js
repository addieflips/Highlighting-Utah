/* WAIVING ONE FEE OFF A BILL
 * =========================
 * `npm run test:waive` — its own file per R-018.
 *
 * Addie, 2026-09-02: "right now we don't have a way to waive a late invoice fee",
 * and on the shape of it: "we can just have a spot we push x on the late fee and can
 * be place both in invoice and costumers under fee."
 *
 * ⚠ NO LATE FEE IS CHARGED TODAY. That rule is decided and unbuilt — $25 if they have
 * paid something, $40 if they have paid nothing (questions map PROC-32). So this gate
 * is about the WAIVER, and about the one property that makes it survive Phase 5: it is
 * built against the ledger, not against a named fee, so a late fee written later gets
 * its × with nothing here changed. There is a check whose only job is to hold that.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. Waiving takes off exactly one line and re-totals the bill from what is left.
 *   2. An ARREARS line can never be waived. It is last season's carried debt, and
 *      `arrearsOutstanding` is what holds that customer off the schedule — so an × on
 *      it is the "hang them anyway" button Addie was offered and turned down. This is
 *      the check to fight for; every other one here is about money being right, this
 *      one is about a crew being sent to a house that has not paid.
 *   3. A fingerprint that matches nothing REFUSES rather than removing something else.
 *   4. The 48-hour free-change window is cleared only when the LAST light-change fee
 *      goes — clearing it early hands out a free colour change nobody granted.
 *   5. The status is recomputed with the real `computeInvoiceStatus`, so a waiver that
 *      clears the balance says Paid in Full.
 *   6. The renderer draws a × for waivable lines and none for the carried debt.
 *
 * ⭐ IT RUNS THE SHIPPED FUNCTIONS, IT DOES NOT READ THEM. Every claim above is about
 * what an object comes out AS — a total, a status, a list one shorter — and this repo
 * has been caught repeatedly by a check that matched the source of behaviour that could
 * never happen. `computeInvoiceStatus` and `ARREARS_KIND` are the REAL ones, imported
 * from js/money.js rather than stubbed: a stub keeps this green through a change to
 * what somebody owes, which is the one thing it exists to stop.
 *
 * ⚠ EVERY LIFT ASSERTS ITS OWN LANDMARK FIRST. An extractor that has quietly stopped
 * matching reports no violations at all — a green build for the worst possible reason.
 */

const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];

function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

/* ---------------------------------------------------------------------------
 * The lift. From `const FEE_KIND_LABELS` to the end of `feeLinesHtml`, clipped at
 * the next real construct rather than a character count — CLAUDE.md §7 bans
 * fixed-length windows by name. `waiveInvoiceFee` is deliberately NOT lifted: it is
 * the thin Firestore write, and everything decidable about it lives in
 * `feeWaiveUpdates`, which is why that was made a function of its own.
 * ------------------------------------------------------------------------- */
const admin = read('admin.html');

function between(src, from, to, label) {
  const a = src.indexOf(from);
  if (a === -1) throw new Error(label + ': opening marker not found — ' + from);
  const b = src.indexOf(to, a);
  if (b === -1) throw new Error(label + ': closing marker not found — ' + to);
  return src.slice(a, b);
}

const FEE_SRC = between(admin,
  'const LEDGERS = {',
  '/* The write. Re-reads fresh', 'the ledger-waive helpers');

check('the lift found the ledger helpers',
  /function ledgerWaiveUpdates/.test(FEE_SRC) && /function ledgerLinesHtml/.test(FEE_SRC) &&
  /function ledgerLineIsWaivable/.test(FEE_SRC),
  'the window came back without one of the three functions this file runs — every ' +
  'check below would then be testing something else, or nothing');

/* esc, lifted rather than copied: the renderer escapes free text somebody typed, and
   a second copy of an escaper is the copy that stops escaping. */
const ESC_SRC = between(admin, 'function esc(s){', '/* (801) 555-0123 out of', 'esc');

async function main() {
  const money = await import(url.pathToFileURL(path.join(ROOT, 'js/money.js')).href);

  check('the real money rules loaded',
    typeof money.computeInvoiceStatus === 'function' && money.ARREARS_KIND === 'arrears',
    'js/money.js did not give up computeInvoiceStatus and ARREARS_KIND — these are ' +
    'deliberately NOT stubbed, so without them this file proves nothing about money');

  const sandbox = eval(
    '(function(computeInvoiceStatus, ARREARS_KIND, fmtMoney){\n' +
    ESC_SRC + '\n' + FEE_SRC + '\n' +
    'return { feeNoteLabel, feeNoteIsLightChange, feeNoteIsWaivable, feeNoteKey,\n' +
    '         feeNoteToken, feeTokenToKey, feeWaiveUpdates, feeLinesHtml,\n' +
    '         ledgerLineLabel, ledgerLineIsWaivable, ledgerWaiveUpdates, ledgerLinesHtml };\n' +
    '})')(money.computeInvoiceStatus, money.ARREARS_KIND, money.fmtMoney);

  const { feeNoteLabel, feeNoteIsLightChange, feeNoteIsWaivable, feeNoteKey,
          feeNoteToken, feeTokenToKey, feeWaiveUpdates, feeLinesHtml,
          ledgerLineLabel, ledgerLineIsWaivable, ledgerWaiveUpdates, ledgerLinesHtml } = sandbox;

  /* -------------------------------------------------------------------------
   * Fixtures. Shaped the way the real writers write them, which matters twice
   * over here: a light-change fee carries NO `kind` at all (portalSave and the
   * nightly carry-forward both push {amount, reason, date}), and the carried debt
   * carries `kind: 'arrears'` plus a `year`. A fixture that gave every note a kind
   * would pass whether or not the kindless default works.
   * ----------------------------------------------------------------------- */
  const lightA = { amount: 30, reason: 'Light change — Warm White to Red', date: '2026-08-20T10:00:00.000Z' };
  const lightB = { amount: 30, reason: 'Light change — Red to Multi', date: '2026-09-01T10:00:00.000Z' };
  const manual = { amount: 45, reason: 'Second trip', kind: 'manual', date: '2026-08-25T10:00:00.000Z' };
  const arrears = { amount: 400, reason: 'Unpaid balance from the 2025 season — not a charge for this year',
                    kind: 'arrears', source: 'office', year: '2025', date: '2026-09-01T10:00:00.000Z' };
  /* The fee that does not exist yet. Nothing writes this today; it is here to prove
     the mechanism is about the LEDGER rather than about the fees we happen to have. */
  const late = { amount: 40, reason: 'Late fee — 60 days', kind: 'late', date: '2026-11-01T10:00:00.000Z' };

  const invoice = notes => ({
    install: 500, removal: 0, deposit: 0, credits: 0,
    changeFees: notes.reduce((s, n) => s + n.amount, 0),
    changeFeeNotes: notes,
    lastLightChangeFeeAt: 'a-timestamp'
  });

  /* -------------------------------------------------------------------------
   * 1. One line off, and the bill re-totalled from what is left.
   * ----------------------------------------------------------------------- */
  {
    const inv = invoice([lightA, manual, lightB]);
    const out = feeWaiveUpdates(inv, feeNoteKey(manual));
    check('waiving takes off exactly one line',
      !!out && out.updates.changeFeeNotes.length === 2 &&
      out.updates.changeFeeNotes.indexOf(manual) === -1,
      'got ' + JSON.stringify(out && out.updates.changeFeeNotes.map(n => n.reason)));
    check('and the two it kept are untouched',
      !!out && out.updates.changeFeeNotes[0] === lightA && out.updates.changeFeeNotes[1] === lightB,
      'the surviving lines must be the same objects in the same order — a rebuild that ' +
      'reorders or rewrites them is a bill whose history no longer matches its rows');
    check('the total is summed from what is left, not subtracted from the old one',
      !!out && out.updates.changeFees === 60,
      'got ' + (out && out.updates.changeFees) + ', expected 60. Subtracting from the ' +
      'stored total keeps a wrong total wrong; summing the ledger corrects it.');
    /* ⚠ AND THE FIXTURE HAS TO DISAGREE WITH ITSELF, or this proves nothing. Every
       other invoice here stores a `changeFees` equal to the sum of its notes, so
       "sum what is left" and "subtract from the stored total" give the identical
       answer and a red-check swapping one for the other sails straight through —
       which it did, on the first pass. A stored total CAN drift: the Invoices panel
       edits amounts by hand. Summing corrects the drift; subtracting preserves it. */
    const drifted = { install: 500, removal: 0, deposit: 0, credits: 0,
                      changeFees: 999, changeFeeNotes: [lightA, manual] };
    const dOut = feeWaiveUpdates(drifted, feeNoteKey(manual));
    check('the total is re-summed from the ledger, not subtracted from a stale one',
      !!dOut && dOut.updates.changeFees === 30,
      'got ' + (dOut && dOut.updates.changeFees) + ', expected 30. Subtracting from the ' +
      'stored 999 leaves 954 — a bill carrying a number nothing on it adds up to.');

    check('it names what it took off',
      !!out && out.removed === manual,
      'the caller logs the amount and reason, so a waiver with nothing to name leaves ' +
      'the same no-trace hole the light-change waiver log was written to close');
  }

  /* -------------------------------------------------------------------------
   * 2. THE ONE THAT MATTERS. An arrears line is not waivable, from either door.
   * ----------------------------------------------------------------------- */
  {
    check('an arrears line is not waivable',
      feeNoteIsWaivable(arrears) === false,
      'waiving last season`s carried debt lifts the schedule hold with it — that is ' +
      'the "hang them anyway" button Addie was offered and turned down');
    const inv = invoice([arrears, lightA]);
    const out = feeWaiveUpdates(inv, feeNoteKey(arrears));
    check('and asking to waive one is refused outright',
      out === null,
      'it returned ' + JSON.stringify(out) + '. A refusal is the whole guard: with the ' +
      'debt gone arrearsSettled answers true and a crew is sent to a house that has ' +
      'not paid for last season.');
    /* ⚠ AND THE NEIGHBOURING LINE MUST STILL GO. A guard that refused the whole
       invoice because one line is arrears would make every carried-debt customer's
       other fees unwaivable, which reads as the × being broken. */
    const other = feeWaiveUpdates(inv, feeNoteKey(lightA));
    check('but a fee sitting beside a carried debt still waives',
      !!other && other.updates.changeFeeNotes.length === 1 &&
      other.updates.changeFeeNotes[0] === arrears &&
      other.updates.changeFees === 400,
      'got ' + JSON.stringify(other && other.updates.changeFees));
  }

  /* -------------------------------------------------------------------------
   * 3. A fingerprint that matches nothing refuses.
   * ----------------------------------------------------------------------- */
  {
    const inv = invoice([lightA]);
    check('a line that is no longer there is refused, not guessed at',
      feeWaiveUpdates(inv, feeNoteKey(lightB)) === null,
      'the row is drawn from a snapshot and the write re-reads fresh, so the line CAN ' +
      'have gone. Removing the nearest thing instead takes somebody else`s money off.');
    check('and two lines of the same amount are told apart',
      feeNoteKey(lightA) !== feeNoteKey(lightB),
      'lightA and lightB are both $30 light-change fees. If their fingerprints collide ' +
      'the × removes whichever comes first, which is not the one that was pressed.');
    /* A reason is free text, so the fingerprint must survive whatever is typed in it. */
    const odd = { amount: 30, reason: 'a"b|c\\d,e', date: '2026-08-20T10:00:00.000Z' };
    const oddInv = invoice([odd, lightA]);
    const oddOut = feeWaiveUpdates(oddInv, feeTokenToKey(feeNoteToken(odd)));
    check('a reason full of punctuation still round-trips through the × token',
      !!oddOut && oddOut.removed === odd,
      'the token goes into an HTML attribute and comes back out; a reason that breaks ' +
      'that makes exactly one customer`s fee unwaivable, with nothing to say why');
  }

  /* -------------------------------------------------------------------------
   * 4. The 48-hour window.
   * ----------------------------------------------------------------------- */
  {
    const two = invoice([lightA, lightB]);
    const first = feeWaiveUpdates(two, feeNoteKey(lightA));
    check('the free-change window survives while another light-change fee remains',
      !!first && !('lastLightChangeFeeAt' in first.updates),
      'clearing it here hands the customer a free colour change nobody granted, while ' +
      'they are still being charged for the last one');
    const one = invoice([lightB]);
    const last = feeWaiveUpdates(one, feeNoteKey(lightB));
    check('and it is cleared when the last one goes',
      !!last && last.updates.lastLightChangeFeeAt === null,
      'their next change should start fresh once nothing is being charged for');
    const manualOnly = invoice([manual, lightA]);
    const mOut = feeWaiveUpdates(manualOnly, feeNoteKey(manual));
    check('waiving a non-light fee never touches the window',
      !!mOut && !('lastLightChangeFeeAt' in mOut.updates),
      'the window belongs to colour changes; a second-trip fee has nothing to do with it');
  }

  /* -------------------------------------------------------------------------
   * 5. The status is the real one.
   * ----------------------------------------------------------------------- */
  {
    const inv = { install: 100, removal: 0, deposit: 100, credits: 0,
                  changeFees: 30, changeFeeNotes: [lightA] };
    const out = feeWaiveUpdates(inv, feeNoteKey(lightA));
    check('a waiver that clears the balance says Paid in Full',
      !!out && out.updates.status === money.computeInvoiceStatus(100, 0, 100, 0, 0),
      'got ' + (out && out.updates.status) + '. Leaving the stored status behind is how ' +
      'a settled customer keeps being chased for a fee that is no longer charged.');
    check('and the status is worked out from the new total, not the old',
      !!out && out.updates.status !== money.computeInvoiceStatus(100, 0, 100, 0, 30),
      'recomputing with the pre-waiver fee would report the same status it had before');
  }

  /* -------------------------------------------------------------------------
   * 6. The renderer.
   * ----------------------------------------------------------------------- */
  {
    const html = feeLinesHtml([lightA, arrears, manual]);
    const xs = (html.match(/class="fee-waive"/g) || []).length;
    check('a × is drawn for every waivable line and none for the carried debt',
      xs === 2,
      'got ' + xs + ' of an expected 2 — a × on the arrears row is the guard in check 2 ' +
      'defeated at the only place the office actually presses it');
    check('the carried-debt row says where it IS edited',
      /edit below/.test(html),
      'a row with no × beside rows that have one reads as a bug rather than a rule');
    check('each × carries the token for its own line',
      html.indexOf(feeNoteToken(lightA)) !== -1 && html.indexOf(feeNoteToken(manual)) !== -1 &&
      html.indexOf(feeNoteToken(arrears)) === -1,
      'the token is what the write matches on; the arrears one must not be on the page ' +
      'at all, so no hand-made click can reach it');
    const nasty = feeLinesHtml([{ amount: 5, reason: '<img src=x onerror=alert(1)>' }]);
    check('a reason is escaped before it reaches the page',
      nasty.indexOf('<img') === -1 && nasty.indexOf('&lt;img') !== -1,
      'reasons are typed by the office and by portalSave; this list is drawn with ' +
      'innerHTML');
  }

  /* -------------------------------------------------------------------------
   * 7. Naming. A kindless note IS a light-change fee — that is the shape both
   *    server writers actually produce, and getting it backwards mislabels every
   *    real fee in the book while looking tidy.
   * ----------------------------------------------------------------------- */
  {
    check('a kindless note is a light-change fee',
      feeNoteLabel(lightA) === 'Light-change fee' && feeNoteIsLightChange(lightA) === true,
      'portalSave and the nightly carry-forward both write {amount, reason, date} and ' +
      'no kind, so kindless is the common case, not the odd one');
    check('a manual fee, a carried debt and a late fee each say what they are',
      feeNoteLabel(manual) === 'Fee' &&
      feeNoteLabel(arrears) === 'Unpaid balance carried forward' &&
      feeNoteLabel(late) === 'Late fee',
      'the history and the waiver log both read this, and the history used to call ' +
      'every line in the ledger a light-change fee');
    check('and a manual fee is not treated as a light-change one',
      feeNoteIsLightChange(manual) === false && feeNoteIsLightChange(arrears) === false,
      'if it were, waiving a manual fee would clear the 48-hour window');
  }

  /* -------------------------------------------------------------------------
   * 8. THE PHASE 5 CLAIM, held as a check rather than a promise in a comment.
   *
   * The whole argument for building the waiver before the fee is that the ledger is
   * kind-agnostic, so the late fee arrives already waivable. If somebody ever narrows
   * `feeNoteIsWaivable` to a list of known kinds, this is what says so — and it would
   * be found on the day the late fee shipped and did not work, otherwise.
   * ----------------------------------------------------------------------- */
  {
    const inv = invoice([late, lightA]);
    const out = feeWaiveUpdates(inv, feeNoteKey(late));
    check('a late fee is waivable the day something writes one',
      feeNoteIsWaivable(late) === true && !!out && out.removed === late &&
      out.updates.changeFees === 30,
      'nothing writes a late fee today — this holds the reason it was safe to build ' +
      'the × first: waivability is decided by NOT being the carried debt, never by a ' +
      'list of kinds somebody has to remember to add to');
    const unknown = { amount: 12, reason: 'Something invented later', kind: 'whatever-comes-next' };
    check('and so is any fee kind invented after today',
      feeNoteIsWaivable(unknown) === true,
      'a whitelist here fails silently: the new fee simply has no ×, and the screen ' +
      'looks the same as one where nobody has been charged');
  }

  /* -------------------------------------------------------------------------
   * 9. THE OTHER LEDGER. Addie, the same afternoon: "we should have an x next to
   *    all discounts and fees to get rid of those if necessary."
   *
   * A credit is a fee pointing the other way — same note shape, same summing, and
   * both totals land in the same `computeInvoiceStatus`. So the checks here are not
   * a duplicate set: they hold the two things that are genuinely DIFFERENT about
   * discounts, which is that nothing on this ledger is protected and that the
   * untouched ledger must come through unchanged.
   * ----------------------------------------------------------------------- */
  {
    const refCredit = { amount: 50, reason: 'Referral \u2014 2 people', kind: 'referral', date: '2026-08-10T10:00:00.000Z' };
    const discount = { amount: 25, reason: 'Loyalty', kind: 'manual', date: '2026-08-12T10:00:00.000Z' };
    const inv = {
      install: 500, removal: 0, deposit: 0,
      credits: 75, creditNotes: [refCredit, discount],
      changeFees: 30, changeFeeNotes: [lightA]
    };
    const out = ledgerWaiveUpdates(inv, 'credit', feeNoteKey(discount));
    check('a discount comes off, and the credits re-total',
      !!out && out.updates.creditNotes.length === 1 &&
      out.updates.creditNotes[0] === refCredit && out.updates.credits === 50,
      'got ' + JSON.stringify(out && out.updates.credits));
    check('and taking a discount off never touches the fees',
      !!out && !('changeFees' in out.updates) && !('changeFeeNotes' in out.updates) &&
      !('lastLightChangeFeeAt' in out.updates),
      'one press changes one thing. Re-deriving the other ledger would quietly undo ' +
      'an amount the Invoices panel had set by hand.');
    check('the status is recomputed with the new credits and the OLD fees',
      !!out && out.updates.status === money.computeInvoiceStatus(500, 0, 0, 50, 30),
      'got ' + (out && out.updates.status) + '. Reading the fee total from the notes ' +
      'instead of from the invoice is how a hand-set amount disappears.');
    /* ⚠ NOTHING ON THE CREDIT LEDGER IS PROTECTED, and that is deliberate rather than
       an oversight: the guard exists for the carried DEBT, which holds a customer off
       the schedule. A credit can only ever be money coming off, so refusing one would
       be protecting the business from its own office. */
    check('every kind of credit can be taken off, referral included',
      ledgerLineIsWaivable('credit', refCredit) === true &&
      ledgerLineIsWaivable('credit', discount) === true &&
      ledgerLineIsWaivable('credit', { amount: 400, kind: 'arrears' }) === true,
      'a note that merely happens to carry kind "arrears" on the CREDIT ledger is not ' +
      'the carried debt — that lives on the fee ledger, and only there');
    const html = ledgerLinesHtml('credit', [refCredit, discount]);
    check('both discount rows draw a \u00d7',
      (html.match(/class="fee-waive"/g) || []).length === 2 && /data-ledger="credit"/.test(html),
      'the \u00d7 has to say which ledger it belongs to, or the click removes a fee of ' +
      'the same amount instead of the discount that was pressed');
    check('a discount is drawn as money coming OFF',
      html.indexOf('\u2212') !== -1 && html.indexOf('+') === -1,
      'a credit shown with a + reads as a charge, on the one screen where somebody is ' +
      'answering "why is this number what it is"');
    check('and each ledger names its own kinds',
      ledgerLineLabel('credit', refCredit) === 'Referral credit' &&
      ledgerLineLabel('credit', discount) === 'Discount' &&
      ledgerLineLabel('credit', { amount: 5 }) === 'Credit',
      'a kindless CREDIT is a plain credit, not a light-change fee — the two ledgers ' +
      'share a note shape and must not share a vocabulary');
  }

  /* ------------------------------------------------------------------------- */
  console.log('');
  console.log('=== Waiving one fee off a bill ===');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  /* ⚠ LOUD. A gate that cannot reach its target must never report green — the same
     reason money-parity.test.js fails rather than skipping when a rename hides one of
     its four functions. */
  console.error('  FAIL  the fee-waive gate could not run:', e && e.stack ? e.stack : e);
  process.exit(1);
});
