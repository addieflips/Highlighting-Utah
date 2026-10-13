/* RULES WRITTEN TWICE — once in the office page, once on the server
 * =================================================================
 * The fifth way to grow the connections map (2026-10-13, after [[PROC-40]]): Addie took
 * the recommendation to go on in order, and this is the next one.
 *
 * ⭐ WHY THIS LIST EXISTS. functions/index.js cannot import from admin.html, so a rule the
 * nightly run and the office screen both need is written TWICE. Two copies of one rule is
 * how the office and the 7 PM run come to disagree about somebody's bill, and nothing goes
 * red when they drift unless a test RUNS both side by side. money-parity.test.js is the
 * best-known of those tests; it is not the only one, and some pairs have none.
 *
 * ⛔ THE GATE (connections.test.js) FINDS EVERY PAIR IN THE CODE ITSELF — a function `X` in
 * admin.html or js/money.js with an `XServer` in functions/index.js, or the same name in
 * both — and fails on any pair that is on neither list below. A new twin cannot appear
 * without somebody deciding, here, which test holds it or that none does.
 *
 * `test` names the file that compares the two copies, or null when nothing does — and null
 * is shown on the page as exactly that, not hidden. The gate checks a named test exists, is
 * in the npm test chain, and mentions both names (or, with `byBlock`, compares a marked
 * block of text rather than calling the functions by name).
 */
'use strict';

const T = (office, server, test, what, extra) => Object.assign({ office, server, test, what }, extra || {});

const TWINS = [
  /* --- money: the bill itself. money-parity sweeps every one of these. --- */
  T('computeInvoiceStatus', 'computeInvoiceStatusServer', 'money-parity.test.js', 'Paid, Partial or Unpaid — and what is owed'),
  T('centsOf', 'centsOf', 'money-parity.test.js', 'turning a dollar amount into whole cents before any money is compared', { byBlock: true }),
  T('houseIsOnTheBill', 'houseIsOnTheBillServer', 'money-parity.test.js', 'which houses are on a bill at all'),
  T('applyLightChange', 'applyLightChangeServer', 'money-parity.test.js', 'the $30 colour-change fee, the 48-hour window and where the $30 lands'),
  T('arrearsOnInvoice', 'arrearsOnInvoiceServer', 'money-parity.test.js', 'last season’s unpaid balance carried onto this bill'),
  T('arrearsOutstanding', 'arrearsOutstandingServer', 'arrears-hold.test.js', 'whether somebody still owes for last season'),
  T('invoiceSeasonYear', 'invoiceSeasonYearServer', 'money-parity.test.js', 'which season a bill belongs to'),
  T('invoiceDueDate', 'invoiceDueDateServer', 'money-parity.test.js', 'the due date printed on a bill'),
  T('endOfFebruary', 'endOfFebruaryServer', 'money-parity.test.js', 'the end-of-February line late fees are measured from'),
  T('invoiceTextChaseDate', 'invoiceTextChaseDateServer', 'money-parity.test.js', 'when an unpaid bill is chased by text'),
  T('invoiceFeeChaseDate', 'invoiceFeeChaseDateServer', 'money-parity.test.js', 'when a late fee is added'),
  T('lateFeeAmount', 'lateFeeAmountServer', 'money-parity.test.js', 'how much the late fee is'),
  T('payerHouseOf', 'payerHouseOfServer', 'run-all.js', 'whose name goes on a shared bill (lowest customer number)'),
  T('nightlyInvoiceTemplateName', 'nightlyInvoiceTemplateNameServer', 'run-all.js', 'which template the nightly bill uses'),
  /* --- the invoice email: one block, written twice between markers. --- */
  T('invoiceEmailRows', 'invoiceEmailRowsServer', 'invoice-email.test.js', 'the line items inside the invoice email'),
  T('invoiceEmailBlock', 'invoiceEmailBlockServer', 'invoice-email.test.js', 'the invoice document inside the email'),
  T('invoiceEmailPlace', 'invoiceEmailPlaceServer', 'invoice-email.test.js', 'where in the email the invoice goes'),
  T('invoiceEmailNumber', 'invoiceEmailNumberServer', 'invoice-email.test.js', 'the invoice number printed in the email',
    { byBlock: true }),
  /* --- the warehouse --- */
  T('houseLightsText', 'houseLightsTextServer', 'warehouse-colours.test.js', 'what colours a house has, from both fields'),
  T('whTimerCameOff', 'whTimerCameOffServer', 'run-all.js', 'a timer being switched off, so Remove Timer is raised'),
  T('stampBuildQueued', 'stampBuildQueuedServer', 'queue-date.test.js', 'when a house was sent to the warehouse'),
  T('stampRecycleRequested', 'stampRecycleRequestedServer', 'queue-date.test.js', 'when a recycle was asked for'),
  T('rejoinNeedsBuild', 'rejoinNeedsBuildServer', 'rejoin-build.test.js', 'whether somebody coming back needs a new bundle'),
  T('houseSideCount', 'houseSideCountServer', 'run-all.js', 'how many sides of a house are lit'),
  T('archiveCustomerSnapshot', 'archiveCustomerSnapshotServer', 'run-all.js', 'the copy kept when somebody leaves'),
  /* --- quotes and the emails that carry them --- */
  T('quoteMatchAddress', 'quoteMatchAddressServer', 'run-all.js', 'whether a quote is for a house we already have'),
  T('quoteButtonLabels', 'quoteButtonLabelsServer', 'run-all.js', 'the words on the approve / maybe / decline buttons'),
  T('quoteAnswerMayClearStatus', 'quoteAnswerMayClearStatusServer', 'address-move.test.js', 'whether answering a quote clears Needs Changes'),
  T('applyQuoteLinkLabel', 'applyQuoteLinkLabelServer', 'run-all.js', 'a sentence with the quote link behind her own words'),
  T('applyQuoteLinkButton', 'applyQuoteLinkButtonServer', 'run-all.js', 'the gold quote-link button'),
  T('quotePhotoEmailHtml', 'quotePhotoEmailHtmlServer', 'run-all.js', 'the house photo inside a quote email'),
  T('cloudEmailPhoto', 'cloudEmailPhotoServer', 'run-all.js', 'the photo size an email asks Cloudinary for'),
  T('referralShareBoxHtml', 'referralShareBoxHtmlServer', 'run-all.js', 'the refer-a-friend box in an email'),
  T('properName', 'properNameServer', 'run-all.js', 'the first name an email greets somebody by'),

  /* --- the same NAME in both files. twin-parity.test.js (2026-10-13) runs the pure ones
     side by side; its first run found contactIndexFields disagreeing — a lost backslash in
     the office copy. The two still marked null do work against Firestore or EmailJS and
     cannot be run as plain functions; each side is tested on its own. --- */
  T('seasonYesUpdates', 'seasonYesUpdates', 'twin-parity.test.js', 'what saying yes to the season writes — the office dropdown and the RSVP link'),
  T('warehouseRebuildFields', 'warehouseRebuildFields', 'twin-parity.test.js', 'which changes send a house back to the warehouse'),
  T('sendPaymentReceipt', 'sendPaymentReceipt', null, 'the payment receipt — sent from the office by hand, and by PayPal on the server'),
  T('removeCustomerFromUpcomingRoutes', 'removeCustomerFromUpcomingRoutes', null, 'taking somebody off every upcoming route'),
  T('quoteIsAddOn', 'quoteIsAddOn', 'twin-parity.test.js', 'whether a quote is an add-on to a house we already light'),
  T('referralSeasonNow', 'referralSeasonNow', 'twin-parity.test.js', 'which season a referral link belongs to'),
  T('contactIndexFields', 'contactIndexFields', 'twin-parity.test.js', 'the phone and email keys a customer is looked up by'),

  /* --- different names, one rule. The census cannot find these by name, so they are
     listed by hand and the gate only checks both still exist. --- */
  T('quoteFirstSentDays', 'quoteFirstSentMs', null, 'when a quote first went out — the clock for the Send text list and the 30-day archive ([[QT-52]])',
    { byHand: true })
];

/* Same name on both sides, and NOT one rule written twice — each with the reason. */
const NOT_TWINS = {
  esc: 'HTML escaping. The two copies deliberately DISAGREE about the apostrophe (CLAUDE.md), which is why the paired email renderers spell their own escaping out rather than calling either.',
  generatePortalToken: 'makes a random token. Nothing has to match between the two — a token from either side is just a token.',
  generateReferralToken: 'makes a random token, as above.',
  tplNameKey: 'normalises a template name for lookup on each side; the two are never compared against each other.'
};

module.exports = { TWINS, NOT_TWINS };
