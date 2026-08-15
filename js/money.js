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
