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

/* Block and line comments out, so a check about what the CODE does cannot be satisfied
   by the paragraph explaining it. Five suites in this repo have been caught that way. */
const stripComments = s => (s || '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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
   * 2. THE CARRIED DEBT. Waivable since 2026-09-07 (MON-67) — and the reason it was
   *    NOT is now carried by a confirmation instead of a refusal.
   *
   * ⚠ REVERSED, NOT RELAXED, AND THE OLD REASONING STILL HOLDS. MON-55 refused this
   *   line an × because `arrearsOutstanding` is the only thing holding an unpaid
   *   customer off the schedule, so crossing it off IS the "hang them anyway" button
   *   Addie turned down in MON-38. Dax reversed it: "make the arrear line have an x".
   *   There is no version of this that does not release the hold — the hold is derived
   *   from the debt and nothing else — so what changed is that it can no longer happen
   *   SILENTLY, which is the harm MON-55 actually recorded (a real debt written off from
   *   a control labelled "remove light-change fee").
   * ----------------------------------------------------------------------- */
  {
    check('an arrears line is waivable now',
      feeNoteIsWaivable(arrears) === true,
      'MON-67 gave the carried debt an × like every other line; a refusal here is the ' +
      'old MON-55 rule coming back');
    const inv = invoice([arrears, lightA]);
    const out = feeWaiveUpdates(inv, feeNoteKey(arrears));
    check('and waiving one takes the debt off and re-totals the bill',
      !!out && out.removed === arrears &&
      out.updates.changeFeeNotes.length === 1 &&
      out.updates.changeFeeNotes[0] === lightA &&
      out.updates.changeFees === 30,
      'got ' + JSON.stringify(out && out.updates) + '. Leaving the stored total behind ' +
      'is a bill carrying a number nothing on it adds up to.');
    /* ⚠ AND THE PROMPT IS WHAT MAKES IT SAFE, so it is asserted in the shipped source
       rather than left to a reader: the amount, the season, and the fact that the
       schedule hold goes with it. Both doors reach it because it lives inside
       waiveLedgerLine, not in either click handler. */
    /* ⚠ FROM `admin`, NOT FEE_SRC — that window deliberately stops at "The write", so
       waiveLedgerLine is outside it and a slice of it comes back empty, which passes a
       negative check and fails a positive one against code that is right.
       ⚠ AND BRACE-MATCHED, NOT A FIXED WINDOW: §7 bans those by name, and run-all.js has
       a meta-check that fails the build for one. */
    const waiveSrc = (function () {
      const at = admin.indexOf('async function waiveLedgerLine');
      if (at === -1) return '';
      let i = admin.indexOf('{', at), depth = 0;
      for (; i < admin.length; i++) {
        if (admin[i] === '{') depth++;
        else if (admin[i] === '}') { depth--; if (depth === 0) return admin.slice(at, i + 1); }
      }
      return '';
    })();
    check('waiveLedgerLine is findable',
      !!waiveSrc && waiveSrc.length > 200,
      'renamed or moved — repoint this, or the two checks below pass vacuously');
    /* ⚠ THE CONDITION ITSELF, NOT THE WORDS NEAR IT. The first version of this check
       tested that `ARREARS_KIND`, `plan.removed` and `confirm(` all APPEARED in the
       function — and the red-check proved it passed with the guard disabled as
       `if(false && ...)`, every word still in place and the prompt unreachable. Same
       shape as the message-in-the-source failures this repo has already shipped three
       times. It pins the whole condition now. */
    /* ⭐ ONE PRESS, THE SAME AS EVERY OTHER LINE (MON-69). Dax: "Make it one press like
       the others — I'd keep the Inbox note either way, so a wrong one is still findable
       and reversible." This supersedes MON-68's typed unlock, and the risk MON-68 named
       has not gone away — crossing this line off releases the schedule hold as well as
       the money. What changed is which side of the trade is paid for: the × is a tool for
       getting rid of a fee or a discount on somebody's profile, and a row that argues
       back is one the office learns to work around.
       ⚠ COMMENTS STRIPPED, because the block above this check explains the history and
       contains the words `prompt` and `confirm()` — a plain search finds the explanation
       and calls it the violation, the trap this repo has been caught by five times. */
    const waiveCode = stripComments(waiveSrc);
    check('no line is gated behind a dialog, the carried debt included',
      !/\bprompt\(/.test(waiveCode) && !/\bconfirm\(/.test(waiveCode),
      'MON-69 made this one press like every other ×; a dialog here is MON-68 coming ' +
      'back, and on a list of ×s it is one more click rather than protection');
    /* ⭐ SO THE PROTECTION IS THE RECORD, NOT THE CEREMONY — and that makes these checks
       load-bearing rather than nice-to-have. Waiving DELETES the line, so without the
       note there is no trace anywhere that the money was ever owed. */
    check('a written-off debt leaves a note naming what to type back',
      /topic: 'Carried Debt Written Off'/.test(waiveSrc) &&
      /Owed from a previous season/.test(waiveSrc) &&
      /plan\.removed\.reason/.test(waiveSrc),
      'a note saying only that something was waived tells the office it has a problem ' +
      'and not how to undo it');
    check('and the note is filed where money notices are read',
      /'Carried Debt Written Off': 'money',/.test(admin),
      'an unlisted topic falls through to Other silently, which for this one hides the ' +
      'only trace it leaves');
    check('a failed note never undoes the write-off',
      /catch\(e\)\{[\s\S]{0,400}could not record the carried-debt write-off/.test(waiveSrc),
      'the money is already off the bill by then; throwing here would report a failure ' +
      'for something that succeeded');
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
    check('a × is drawn for every line, the carried debt included',
      xs === 3,
      'got ' + xs + ' of an expected 3 — MON-67 gave the arrears row an × at the only ' +
      'place the office actually presses one');
    /* ⭐ THE RENDERER AND THE WRITE MUST AGREE, and this is the check that survives a
       protection being reintroduced: whatever `ledgerLineIsWaivable` says, a row drawn
       with an × must be one the write will accept, and a row without one must not be.
       Drawing a × the write refuses is a button that does nothing; withholding one the
       write would accept hides a line the office is allowed to take off. */
    [lightA, arrears, manual].forEach(function (n) {
      const drawn = feeLinesHtml([n]).indexOf('class="fee-waive"') !== -1;
      const accepted = feeWaiveUpdates(invoice([n]), feeNoteKey(n)) !== null;
      check('the × drawn for "' + (n.kind || 'light change') + '" matches what the write accepts',
        drawn === accepted,
        'drawn=' + drawn + ' accepted=' + accepted + ' — a × the write refuses is a ' +
        'button that does nothing, and a missing one hides a line that could go');
    });
    check('each × carries the token for its own line',
      html.indexOf(feeNoteToken(lightA)) !== -1 && html.indexOf(feeNoteToken(manual)) !== -1 &&
      html.indexOf(feeNoteToken(arrears)) !== -1,
      'the token is what the write matches on, so every drawn × needs its own');
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


  /* -------------------------------------------------------------------------
   * 8. ONE LINE PER REFERRAL, AND ONE × PER LINE (2026-09-08, REF-24).
   *
   * Addie: *"in discount I cannot currently see who got what discount. That should
   * show with an x at the right side. the x is something I can waive the discount
   * or fee."*
   *
   * ⚠ THE × WAS ALREADY THERE AND THE NAMES WERE NOT. Every referral collapsed into
   * a single "Referral — 3 people" line, so the office could see that $75 had come
   * off and never which three friends earned it — and the one × beside it took all
   * three off at once.
   *
   * ⚠ THIS RUNS THE RENDERER AND THE WAIVER, rather than matching their source.
   * Every claim here is about a ROW ON A SCREEN and about WHICH MONEY comes off,
   * and this repo has been caught more than once by a check that matched the source
   * of something that could never reach the page.
   * ----------------------------------------------------------------------- */
  {
    const refJane = { amount: 25, reason: 'Referral — Jane Smith', kind: 'referral',
                      ref: 'CUST-JANE', date: '2026-09-02T10:00:00.000Z' };
    const refBob  = { amount: 25, reason: 'Referral — Bob Ng', kind: 'referral',
                      ref: 'CUST-BOB', date: '2026-09-05T10:00:00.000Z' };
    const goodwill = { amount: 40, reason: 'Goodwill', kind: 'manual',
                       date: '2026-08-01T10:00:00.000Z' };
    const creditInv = notes => ({
      install: 500, removal: 0, deposit: 0, changeFees: 0,
      credits: notes.reduce((s, n) => s + n.amount, 0),
      creditNotes: notes
    });

    const html = ledgerLinesHtml('credit', [refJane, refBob, goodwill]);
    check('each referral is drawn as its own line, naming the friend',
      html.indexOf('Jane Smith') !== -1 && html.indexOf('Bob Ng') !== -1,
      'got: ' + html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() +
      ' — a total the office cannot attribute is the complaint this answers');
    /* ⚠ THE × IS COUNTED, NOT MERELY LOOKED FOR. One × over three lines is exactly
       the old behaviour, and it renders a perfectly good-looking row. */
    check('and every one of them carries its own ×',
      (html.match(/class="fee-waive"/g) || []).length === 3,
      'got ' + (html.match(/class="fee-waive"/g) || []).length + ' of 3 — one × over ' +
      'several referrals is the collapsed line wearing a new shape');
    /* ⚠ AND EACH × CARRIES A DIFFERENT TOKEN. Three buttons that all fingerprint to
       the same line is one × in three places: pressing any of them takes off whichever
       the waiver happens to find first. */
    const tokens = (html.match(/data-feetoken="([^"]*)"/g) || []);
    check('and no two × buttons point at the same line',
      tokens.length === 3 && new Set(tokens).size === 3,
      'got ' + tokens.length + ' tokens, ' + new Set(tokens).size + ' distinct — a shared ' +
      'fingerprint is a × that removes the wrong money');

    const inv = creditInv([refJane, refBob, goodwill]);
    const out = ledgerWaiveUpdates(inv, 'credit', feeNoteKey(refBob));
    check('crossing off one referral leaves the other standing',
      !!out && out.updates.creditNotes.length === 2 &&
      out.updates.creditNotes.indexOf(refJane) !== -1 &&
      out.updates.creditNotes.indexOf(refBob) === -1,
      'got ' + JSON.stringify(out && out.updates.creditNotes.map(n => n.reason)) +
      ' — taking every referral off because one was wrong is what this replaced');
    check('and the bill is re-totalled from what is left',
      !!out && out.updates.credits === 65,
      'got ' + (out && out.updates.credits) + ', expected 65 (one $25 referral and the ' +
      '$40 goodwill discount)');
    /* ⚠ THE REMOVED LINE IS HANDED BACK CARRYING ITS `ref`, and that is what the
       waiver in admin.html marks on the customer record. Without it the × takes the
       money off the invoice and leaves the entry live, so the next referral through a
       link recomputes the count and puts the whole discount straight back. */
    check('and it hands back the line with the referred customer on it',
      !!out && out.removed && out.removed.ref === 'CUST-BOB',
      'got ' + JSON.stringify(out && out.removed && out.removed.ref) + ' — without it ' +
      'the entry stays live on the record and the next referral restores the discount');
    /* ⚠ AND THE GOODWILL DISCOUNT IS NOT A REFERRAL. A waiver that matched on kind
       rather than on the line would take an unrelated credit off the same bill. */
    const outManual = ledgerWaiveUpdates(creditInv([refJane, goodwill]), 'credit', feeNoteKey(goodwill));
    check('a discount that is not a referral still waives on its own',
      !!outManual && outManual.updates.credits === 25 &&
      outManual.removed.kind === 'manual',
      'got ' + (outManual && outManual.updates.credits) + ' — one rule over the whole ' +
      'credit ledger, not a referral special case');

    /* ⚠ AND THE OLD COLLAPSED LINE STILL WAIVES. Every invoice written before today
       holds one "Referral — 3 people" line with no `ref` on it; if that stopped
       working the office would be unable to cross off any referral on a bill raised
       before the change. */
    const oldStyle = { amount: 75, reason: 'Referral — 3 people', kind: 'referral',
                       date: '2026-08-10T10:00:00.000Z' };
    const outOld = ledgerWaiveUpdates(creditInv([oldStyle, goodwill]), 'credit', feeNoteKey(oldStyle));
    check('an old collapsed referral line still comes off',
      !!outOld && outOld.updates.credits === 40 && !outOld.removed.ref,
      'got ' + (outOld && outOld.updates.credits) + ' — a bill raised before the change ' +
      'must not become un-editable, and a line with no ref still means all of them');
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
