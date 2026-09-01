/* money.js — the money and sizing rules, in one place.
 *
 * WHY THIS FILE EXISTS
 * These are the calculations that decide what a customer owes and how many
 * bins their house needs. They used to live in the middle of admin.html's
 * one-million-character script, where nothing could test them and every edit
 * risked touching something unrelated.
 *
 * Everything in here is "pure": each function takes numbers in and gives an
 * answer back. Nothing reads the screen, nothing talks to Firebase, nothing
 * remembers anything between calls. That is what makes it safe to move, and
 * what makes it testable on its own.
 *
 * This file is loaded by admin.html as a normal browser module — no build
 * step, no tooling. Netlify serves it as-is.
 *
 * ⚠ IMPORTANT: functions/index.js has its own copy of the invoice maths for
 * the nightly billing run. If you change a rule here, change it there too and
 * ship both in the same push, or the office and the nightly run will disagree
 * about what someone owes.
 */

/* How many feet fit in one bin. A house needs another bin for every 260 feet:
 * up to 260 is 1 bin, 261-520 is 2, 521-780 is 3, and so on. More than one bin
 * also means a 5000-series customer number instead of a regular one.
 * Note: some older training notes and UI text say "the 200 ft rule" — 260 is
 * the number the app actually uses.
 * The name is historic — it used to be a single over/under cutoff between one
 * bin and two, because two was as high as it went. The cutoff itself has not
 * moved, so a house on the books keeps the bin count and the number it already
 * has; only houses over 520 feet, which used to be capped at 2 bins, come out
 * differently now. */
export const CN_DOUBLE_BIN_FEET = 260;

/* How many bins a house needs, from its measured feet. Never fewer than 1 —
 * a house with no feet measured yet still gets somewhere to put its lights. */
export function cnBinsForFeet(feet) {
  const f = Number(feet) || 0;
  if (f <= CN_DOUBLE_BIN_FEET) return 1;
  return Math.ceil(f / CN_DOUBLE_BIN_FEET);
}

/* Format a number as money for display, e.g. 1234.5 -> "$1,234.50".
 *
 * Always two decimal places. Without them a real balance of $1,234.50 printed
 * as "$1,234.5", and the customer's emailed invoice — which has always used
 * toFixed(2) on the server — disagreed with the office screen on the same
 * invoice. */
export function fmtMoney(n) {
  return '$' + (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* Round to whole cents. Money arithmetic in floating point leaves crumbs:
 * 0.1 + 0.2 is 0.30000000000000004, so a customer who has paid every cent can
 * come out a fraction short and get filed as "Partial Payment" against a
 * balance that displays as $0.00 — stuck on the unpaid list forever with
 * nothing on screen to explain why. Comparing rounded cents fixes that.
 *
 * ⚠ functions/index.js has its own copy of this (centsOf). Change both. */
export function centsOf(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100);
}

/* THE ONE INVOICE RULE.
 *
 *   owed = (install + removal + changeFees) - credits - deposit, floored at $0
 *
 * changeFees is the $30 late light-change fee. It is NOT the $30 new-member
 * join fee — that one is folded into `install` by the nightly function and is
 * never a separate line. Leaving changeFees out of a balance calculation is
 * the bug that once caused PayPal to undercharge, so it is included here and
 * must stay included everywhere. */
export function computeInvoiceStatus(install, removal, deposit, credits, changeFees) {
  // Compared in whole cents — see centsOf. A fraction of a cent left over by
  // floating-point arithmetic must never be the difference between "Paid in
  // Full" and "Partial Payment".
  const gross = centsOf(install) + centsOf(removal) + centsOf(changeFees);   // the real charge (incl. light-change fees)
  const total = gross - centsOf(credits);                           // what's owed after credits
  const paid = centsOf(deposit);
  if (gross <= 0 && paid <= 0) return 'Unpaid';                    // a truly blank invoice
  if (total <= 0) return 'Paid in Full';                          // credits (and/or payments) cover it all
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid in Full';
  return 'Partial Payment';
}

/* ⭐ THE ONE LIGHT-CHANGE RULE (added 2026-08-21).
 *
 * Owner, asked whether a colour change is a new-member fee or its own line:
 * "new member fee and change light fees are seperate but should get charged
 * seperetly for this so if new member changes lights again after 48 hours of
 * being a new member than they should get charged for light change and new
 * member fee which would put them at 6[0] dollars. So new member should not be
 * assigned on routes within 48 hours."
 *
 * ⚠ THIS REVERSES THE 2026-08-19 DECISION, deliberately and on her instruction.
 * That day the separate colour-change fee was removed and portalSave was changed
 * to set chargeNewMemberFee instead. The two fees are separate again, and they
 * STACK: a new member who changes colours outside their window pays both, $60.
 *
 * ⭐ AND THE FREE WINDOW AND THE ROUTE LOCK ARE THE SAME 48 HOURS. Owner: "48
 * hours will be from when they become a costumer and we won't schedule them
 * within that 48 hours so they can change there lights again if they choose",
 * and "if an old costumer or a new costumer outside the 48 hour window changes
 * lights than they should not be scheduled for another 48 hours."
 *
 * So there is ONE field — lightsLockedUntil on the customer — and it answers
 * both questions: are they still free to change, and may they be routed. They
 * are the same fact said twice, and keeping two fields for it is how they end
 * up disagreeing. Two events open a window: becoming a customer, and a charged
 * colour change.
 *
 * ⚠ THE WINDOW LIVES ON THE CUSTOMER, NOT THE INVOICE. It used to be
 * lastLightChangeFeeAt on the invoice document, which cannot work now: a brand
 * new customer's window has to exist before any invoice does. It is also the
 * more correct home — lights belong to a house, and a payer with two houses
 * should not have one house's colour change close the other's window.
 *
 * ⚠ A FIRST-TIME COLOUR IS NOT A CHANGE. Both `oldLights` and `newLights` must
 * be non-empty. Getting this wrong charges $30 to somebody filling their
 * colours in for the first time, and sweeps every new customer onto the Color
 * Changes sheet — which has happened once already, with twelve people.
 *
 * Pure on purpose: no clock, no Firestore, no document. Everything it needs is
 * passed in, so both copies can be fed identical inputs and compared.
 *
 * ⚠ functions/index.js has its own copy (applyLightChangeServer). Change both,
 * in the same push — money-parity.test.js runs them side by side and fails if
 * they ever disagree. */
export const LIGHT_CHANGE_FEE = 30;
export const LIGHT_WINDOW_MS = 48 * 60 * 60 * 1000;

export function applyLightChange(o) {
  const opts = o || {};
  const now = Number(opts.nowMs) || 0;
  const oldLights = String(opts.oldLights == null ? '' : opts.oldLights);
  const newLights = String(opts.newLights == null ? '' : opts.newLights);
  const lockedUntil = Number(opts.lockedUntil) || 0;

  const differs = newLights !== oldLights;
  /* Both halves non-empty: filling colours in for the first time is not a
     change, and clearing them is not one either. */
  const isChange = differs && !!oldLights && !!newLights;
  /* One window, both meanings — see above. No window at all (0) reads as
     "not inside one", which is right for an old customer who has never had one. */
  const withinFreeWindow = lockedUntil > now;
  const charge = isChange && !withinFreeWindow;

  return {
    isChange: isChange,
    withinFreeWindow: withinFreeWindow,
    feeAmount: charge ? LIGHT_CHANGE_FEE : 0,
    /* Owner: "if invoice has already been sent out but they change there lights
       after invoice is sent out than the 30 dollars will be charged for next
       season but if invoice hasn't been sent out than it will be charged on
       there current invoice."

       ⚠ THIS IS WHY NOTHING HAS TO RE-OPEN A SENT BILL. invoiceEmailSent is
       only ever cleared by Start New Season, so a fee added to an already-sent
       invoice would sit there and never be posted to anybody. Sending it to
       next season is the answer that reaches the customer. */
    feeDestination: !charge ? 'none' : (opts.invoiceSent ? 'nextSeason' : 'invoice'),
    feeReason: charge ? 'Light change' : '',
    /* A change INSIDE the window is free and does NOT extend the window — the
       customer is still inside the one they already had. Only a charged change
       opens a new one. 0 means "leave lightsLockedUntil exactly as it is";
       writing the old value back would be the same thing said less clearly. */
    opensNewWindow: charge,
    lightsLockedUntil: charge ? (now + LIGHT_WINDOW_MS) : 0,
    /* What to TELL them — the end of whichever window they are now in. Never
       written to a document; the UI says "you can keep changing until X". */
    windowEndsAt: charge ? (now + LIGHT_WINDOW_MS) : lockedUntil,
    /* ⚠ DELIBERATELY WIDER THAN isChange, to preserve what the server already
       does. Colours recorded for the FIRST time on a customer a crew has
       already been given is still a card that changed under them, and narrowing
       this to isChange would lose that notification. It is a note, not a
       charge, so the cost of being wide is an extra line in the Inbox. */
    raiseReassignNote: differs && !!newLights && !!opts.scheduled,
    setLightsChangedAt: isChange
  };
}

/* The CSS class that colours a status pill on screen. */
export function statusClass(status) {
  if (status === 'Paid in Full') return 'status-paid';
  if (status === 'Partial Payment') return 'status-partial';
  return 'status-due';
}

/* Read the enrollment year however createdAt was stored (Firestore Timestamp,
 * {seconds}, Date, epoch number, or ISO string) so the $30 new-member fee is
 * detected the same way here as in the nightly Cloud Function. */
export function enrollmentYearOf(createdAt) {
  if (!createdAt) return null;
  try {
    if (typeof createdAt.toDate === 'function') return createdAt.toDate().getFullYear();
    if (createdAt instanceof Date) return createdAt.getFullYear();
    if (typeof createdAt.seconds === 'number') return new Date(createdAt.seconds * 1000).getFullYear();
    if (typeof createdAt === 'number') return new Date(createdAt).getFullYear();
    if (typeof createdAt === 'string') { const _d = new Date(createdAt); return isNaN(_d.getTime()) ? null : _d.getFullYear(); }
  } catch (e) { }
  return null;
}

/* Which invoice document a customer belongs to. Phone digits if they have a
 * phone, otherwise their lowercased email.
 *
 * ⚠ KNOWN SHARP EDGE: two customers who share a phone number resolve to the
 * SAME invoice. A household with one phone can therefore end up sharing a
 * bill. This is existing behaviour, unchanged by this refactor — see the
 * duplicate-phone test in the QA workbook. */
export function custInvoiceKey(d) {
  const phone = String((d && d.phone) || '').replace(/\D/g, '');
  if (phone) return phone;
  return String((d && d.email) || '').toLowerCase().trim();
}


/* ⭐ LAST SEASON'S UNPAID BILL, CARRIED ONTO THIS ONE (added 2026-08-31).
 *
 * Addie, asked whether the debt should keep being written off at the reset:
 * "Carry it onto this year's bill." And on how a payment is read afterwards:
 * "If they were billed 400 last year and paid 400 last year than it is cleared
 * but if they needed to pay 800 and paid only 400 than bill is not cleared and
 * we cannot schedule them."
 *
 * ⚠ START NEW SEASON USED TO ERASE IT. The reset writes `install: newInstall,
 * deposit: 0` over every invoice, so a customer who never paid started the new
 * season owing this year's charge and nothing else — their debt written off in
 * silence, for all ~967 customers, with the only surviving record buried in
 * yearlySnapshots. That is the behaviour this replaces.
 *
 * ⭐ IT IS A LINE IN THE FEE LEDGER, NOT A NEW TERM IN THE FORMULA, and that is
 * the whole reason this change is small. `changeFeeNotes` is already a
 * kind-tagged ledger of additive charges: syncPayerInvoice leaves it alone and
 * still counts it (`existing.changeFees`), the Edit Customer save rebuilds only
 * the `manual` kind and keeps every other, the printed and emailed invoice
 * renders one row per note using that note's own `reason`, and the portal
 * already receives it — `changeFees` and `changeFeeNotes` are both in
 * INVOICE_READ_FIELDS. So the carried debt reaches the customer, the PayPal
 * total, the {{amount_due}} token and every balance in the app for free.
 * Adding a sixth term to computeInvoiceStatus would have meant 47 call sites in
 * admin.html, a second copy on the server and a rewritten parity sweep, to buy
 * exactly what the ledger already does.
 *
 * ⚠ SO THE LEDGER IS THE ONE SOURCE OF TRUTH FOR THE AMOUNT. Nothing stores the
 * carried figure a second time as a marker field. Two copies of one number is
 * how a bill and the rule that reads it start disagreeing, and here the two
 * would disagree about whether somebody may be sent a crew.
 *
 * ⚠ AND `kind` IS WHAT MAKES IT SURVIVE. A note with no kind reads as a
 * light-change fee to every existing reader; `arrears` is what lets the Edit
 * Customer rebuild keep it, the history name it correctly, and this rule find
 * it again. Do not write one without the kind.
 */
export const ARREARS_KIND = 'arrears';

/* How much of this invoice is last season's unpaid bill. Summed from the
 * ledger rather than read from a stored total, so an office hand-edit to the
 * line moves the rule with it instead of leaving the two out of step. */
export function arrearsOnInvoice(inv) {
  const notes = (inv && Array.isArray(inv.changeFeeNotes)) ? inv.changeFeeNotes : [];
  return notes.reduce(function (sum, n) {
    return sum + ((n && n.kind === ARREARS_KIND) ? (Number(n.amount) || 0) : 0);
  }, 0);
}

/* ⭐ OLDEST DEBT FIRST, WHICH IS WHAT MAKES THE QUESTION ANSWERABLE. Once last
 * year's amount sits on this year's bill there is one balance and two debts in
 * it, and a payment is just `deposit` going up — PayPal, Venmo, cash and the
 * payment importer all look identical by the time they reach here. So money is
 * read as paying off the carried amount before it touches this year's charge,
 * and "have they paid for last year?" becomes one subtraction that never has to
 * know where the money came from.
 *
 * ⚠ PART-PAYMENT IS NOT PAYMENT — Addie's own example: billed 800, paid 400,
 * "bill is not cleared and we cannot schedule them". The comparison is against
 * the WHOLE carried amount, never a proportion of it.
 *
 * ⚠ CREDITS COUNT, AND THAT IS THE ONE WAY A HOLD LIFTS WITHOUT CASH. A credit
 * is the office deciding the money is not owed — the same mechanism Q-013 names
 * for an "our fault" write-off — so once one covers the carried amount the debt
 * genuinely is not outstanding. It is deliberately NOT a hidden override flag:
 * it is money, on the invoice, visible to the customer and countable in the
 * books. Addie asked for no "hang them anyway" button and there is none.
 *
 * ⚠ WHOLE CENTS, via centsOf, for the same reason computeInvoiceStatus uses it:
 * a customer who has paid every cent must never come out a fraction short and
 * be held out of the season against a balance that displays as $0.00. */
export function arrearsSettled(inv) {
  const owed = centsOf(arrearsOnInvoice(inv));
  if (owed <= 0) return true;
  const paid = centsOf((inv && inv.deposit) || 0) + centsOf((inv && inv.credits) || 0);
  return paid >= owed;
}

/* The question the season rule asks: is last season's bill still outstanding?
 *
 * ⚠ NO INVOICE IS NOT A DEBT. A missing or unloaded invoice answers false —
 * "they do not owe" — and that direction is deliberate and matches every other
 * fail-safe in the season rule: holding somebody who paid costs a customer
 * their lights, while carrying somebody who did not costs one bundle. Anything
 * this cannot answer must keep them IN. */
export function owesFromLastSeason(inv) {
  if (!inv) return false;
  return arrearsOnInvoice(inv) > 0 && !arrearsSettled(inv);
}

/* How much of last season's carried balance is STILL outstanding.
 *
 * Payments are read oldest-debt-first (see arrearsSettled), so this is what a
 * customer has to pay before they can be scheduled — and, since 2026-09-01, it
 * is also exactly what PayPal charges them first.
 *
 * ⚠ Addie, 2026-09-01, on why they pay it as its own step rather than typing an
 * amount: "I don't want them to type there amount because then we can't trust
 * if someone paid in full. Can we do a one year payment than next years payment
 * will show up after they paid that year?" So the customer is only ever shown
 * ONE figure to pay, and it is one we chose.
 *
 * ⚠ functions/index.js carries its own copy (arrearsOutstandingServer) because
 * paypalCreateOrder needs it to decide what to charge. money-parity.test.js
 * runs the two side by side — this decides what a card is actually charged, so
 * the office screen and the payment button must never disagree. */
export function arrearsOutstanding(inv) {
  const owed = centsOf(arrearsOnInvoice(inv));
  if (owed <= 0) return 0;
  const paid = centsOf((inv && inv.deposit) || 0) + centsOf((inv && inv.credits) || 0);
  return Math.max(0, owed - paid) / 100;
}
