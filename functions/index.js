/**
 * Highlighting Utah — Cloud Functions
 *
 * PayPal integration: creates an order for a customer's balance + tip,
 * captures it when they approve, and records the payment on their invoice
 * in Firestore automatically. No card numbers or secrets ever touch the
 * website itself — this file is the only place that talks to PayPal.
 *
 * Setup (run once from the project root, after `firebase login`):
 *   firebase functions:secrets:set PAYPAL_CLIENT_ID
 *   firebase functions:secrets:set PAYPAL_CLIENT_SECRET
 *   firebase functions:secrets:set PAYPAL_WEBHOOK_ID
 *   firebase functions:secrets:set PAYPAL_ENV        (type: sandbox  or  live)
 *
 * Then deploy with:
 *   firebase deploy --only functions
 *
 * After the first deploy, copy the URL it prints for `paypalWebhook` and
 * paste it into your PayPal Developer app's Webhooks section, subscribed
 * to the "Payment capture completed" event.
 */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const PAYPAL_CLIENT_ID = defineSecret('PAYPAL_CLIENT_ID');
const PAYPAL_CLIENT_SECRET = defineSecret('PAYPAL_CLIENT_SECRET');
const PAYPAL_WEBHOOK_ID = defineSecret('PAYPAL_WEBHOOK_ID');
const PAYPAL_ENV = defineSecret('PAYPAL_ENV'); // "sandbox" or "live"

// Same Cloudinary account admin.html already uploads to (CLOUDINARY_CLOUD
// there), signed here so the public quote form never sees an upload preset
// name it could reuse to post arbitrary files into the account.
//   firebase functions:secrets:set CLOUDINARY_API_KEY
//   firebase functions:secrets:set CLOUDINARY_API_SECRET
const CLOUDINARY_CLOUD_NAME = 'highlighting-utah';
const CLOUDINARY_API_KEY = defineSecret('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = defineSecret('CLOUDINARY_API_SECRET');

function paypalApiBase(env) {
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function getPaypalAccessToken(clientId, secret, env) {
  const base = paypalApiBase(env);
  const auth = Buffer.from(clientId + ':' + secret).toString('base64');
  const res = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('PayPal auth failed: ' + text);
  }
  const data = await res.json();
  return data.access_token;
}


/**
 * Emails a payment receipt. Called after a payment has been recorded.
 *
 * Which template depends on whether the payment cleared the balance:
 *   balance now zero -> "Nightly Auto-Invoice - Paid Receipt" (existing wording)
 *   balance remaining -> "Payment Received - Balance Remaining" (new)
 *
 * Deliberately quiet in three cases, all agreed with Addie 2026-08-11:
 *   - payments under RECEIPT_MIN_AMOUNT, so a token payment doesn't send mail
 *   - corrections, where the deposit went DOWN or didn't move
 *   - a receipt already sent for this same deposit figure, which is what stops
 *     a PayPal capture and its webhook both emailing the same payment
 *
 * Never throws. A failed receipt must not roll back a recorded payment - the
 * money landing is what matters, the email is a courtesy.
 */
const RECEIPT_MIN_AMOUNT = 10;

async function sendPaymentReceipt(invoiceId, { paidNow }) {
  const invRef = db.collection('invoices').doc(invoiceId);
  // Records why a receipt did not go out, on the invoice itself, so a failure
  // that happened at 2am with nobody watching still shows up in admin later.
  // Nothing here is ever allowed to fail silently.
  const fail = async (why) => {
    console.error('Payment receipt not sent for ' + invoiceId + ': ' + why);
    try {
      await invRef.update({
        receiptError: why,
        receiptErrorAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { /* invoice vanished; the console line above is the record */ }
  };
  try {
    if (!(paidNow >= RECEIPT_MIN_AMOUNT)) return;   // by design, not a failure

    const snap = await invRef.get();
    if (!snap.exists) { console.error('Payment receipt: no invoice ' + invoiceId); return; }
    const inv = snap.data();

    const deposit = Number(inv.deposit) || 0;
    if (inv.receiptSentForDeposit === deposit) return;   // by design: already sent for this figure

    const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
    const credits = Number(inv.credits) || 0;
    const amountDue = Math.max(0, total - credits - deposit);
    const email = (inv.email || '').trim();
    if (!email) return fail('This customer has no email address on their record, so no payment receipt could be sent. The payment itself was recorded correctly.');

    const emailSettingsSnap = await db.collection('settings').doc('emailjs').get();
    const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};
    const { serviceId, templateId, privateKey, publicKey } = emailSettings;
    if (!serviceId || !templateId || !privateKey) return fail('The EmailJS keys are missing or incomplete under Automation Emails > EmailJS Setup, so no payment receipt could be sent. The payment itself was recorded correctly.');

    const paidInFull = amountDue <= 0;
    const templateName = paidInFull
      ? 'Nightly Auto-Invoice \u2014 Paid Receipt'
      : 'Payment Received \u2014 Balance Remaining';
    const tplSnap = await findTemplateSnapByName(templateName);

    let body;
    let tplData = null;
    if (tplSnap.empty) {
      // A renamed or deleted template must not silently swallow the receipt: the
      // email still goes out from a built-in body, and the gap is recorded on the
      // invoice so the missing template gets noticed and restored.
      await fail('There is no email template named "' + templateName + '", so a plain built-in version was sent instead. Create it under Automation Emails > Templates > Billing, spelled exactly that way.');
      body = paidInFull
        ? 'Hi {{name}},<br><br>Thank you \u2014 your Christmas lights invoice is paid in full.<br><br>Amount paid: {{amount_paid}}<br><br>{{view_portal_button}}<br><br>\u2014 Highlighting Utah'
        : 'Hi {{name}},<br><br>Thanks \u2014 we have received your payment of {{payment_amount}}.<br><br>Invoice total: {{amount_total}}<br>Paid so far: {{amount_paid}}<br>Amount still due: {{amount_due}}<br><br>You can finish paying any time using the button below.<br><br>{{pay_button}} {{venmo_button}}<br><br>\u2014 Highlighting Utah';
    } else {
      tplData = tplSnap.docs[0].data();
      body = tplData.body || '';
    }
    /* Named after what the customer is being told, not after the template that
       happened to supply it — a paid receipt and a part-payment are different
       sentences in an inbox. */
    const receiptSubject = templateSubjectOr(tplData, paidInFull
      ? 'Your Highlighting Utah invoice \u2014 paid in full'
      : 'We received your payment \u2014 Highlighting Utah');

    const portalUrl = 'https://highlightingutah.com/#/payment'
      + (inv.portalToken ? ('?token=' + inv.portalToken) : '');
    const venmoUrl = 'https://venmo.com/HighLightingUtah?txn=pay&amount='
      + amountDue.toFixed(2) + '&note=' + encodeURIComponent('Christmas Lights');
    const messagesUrl = 'https://highlightingutah.com/#/contact';
    const btnStyleGold = 'display:inline-block; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:15px; margin:6px 8px 6px 0; background:#D89F3D; color:#1E3B2C;';

    body = body.split('{{name}}').join(inv.name || 'there');
    body = body.split('{{payment_amount}}').join('$' + paidNow.toFixed(2));
    body = body.split('{{amount_total}}').join('$' + Math.max(0, total - credits).toFixed(2));
    body = body.split('{{amount_paid}}').join('$' + deposit.toFixed(2));
    body = body.split('{{amount_due}}').join('$' + amountDue.toFixed(2));
    body = body.split('{{feet_line}}').join('');
    body = body.split('{{new_member_fee_line}}').join('');
    body = body.split('{{credit_lines}}').join('');
    body = body.split('{{fee_lines}}').join('');
    body = body.split('{{portal_link}}').join(portalUrl);
    body = body.split('{{portal_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">Log Into Your Portal</a>');
    body = body.split('{{pay_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">Pay Your Invoice</a>');
    body = body.split('{{view_portal_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">View Your Portal</a>');
    body = body.split('{{venmo_link}}').join(venmoUrl);
    body = body.split('{{venmo_button}}').join('<a href="' + venmoUrl + '" style="' + btnStyleGold + '">Pay with Venmo</a>');
    body = body.split('{{message_link}}').join(messagesUrl);
    body = body.replace(/\n/g, '<br>');

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey || '',
        accessToken: privateKey,
        template_params: { to_email: email, to_name: inv.name || '', subject: receiptSubject, body: body, message: body }
      })
    });
    if (!res.ok) {
      const text = await res.text();
      return fail('The email service rejected the payment receipt: ' + text + ' The payment itself was recorded correctly.');
    }

    await invRef.update({
      receiptSentForDeposit: deposit,
      receiptSentAt: admin.firestore.FieldValue.serverTimestamp(),
      receiptError: '',
      receiptErrorAt: null
    });
  } catch (err) {
    await fail('Payment receipt failed to send: ' + ((err && err.message) || err) + ' The payment itself was recorded correctly.');
  }
}


/**
 * Finds an email template by name, ignoring dash style, spacing and case.
 * Exact-character matching quietly failed whenever a template was typed with
 * a hyphen instead of an em dash, which sent the built-in fallback wording
 * instead of the real template - with nothing to say it had happened.
 */
function tplNameKey(n) {
  return String(n || '')
    .replace(/[\u2010-\u2015\u2212-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
/* ⭐ THE SERVER'S HALF OF "EVERY EMAIL SAYS WHAT IT IS" (added 2026-08-31).
 * The browser copy is `emailSubjectFor` / `defaultEmailSubject` in admin.html.
 * These two are deliberately SIMPLER than that pair and must stay so: the
 * server only ever sends the two billing emails, so it needs the billing
 * fallback and nothing else — no RSVP, no quote, no token resolution.
 *
 * ⚠ THE TEMPLATE'S OWN SUBJECT WINS, exactly as it does in the browser, so the
 * office sets it once under Automation Emails > Templates and both surfaces
 * obey it. A blank one falls back rather than sending an empty subject line.
 *
 * ⚠ AND THE FALLBACK MATTERS MORE HERE THAN ANYWHERE. This is the nightly run:
 * nobody is watching it, and no template saved before today has the field.
 */
function templateSubjectOr(tplData, fallback) {
  const s = String((tplData && tplData.subject) || '').trim();
  return s || fallback;
}

async function findTemplateSnapByName(name) {
  const exact = await db.collection('emailTemplates').where('name', '==', name).limit(1).get();
  if (!exact.empty) return exact;
  const all = await db.collection('emailTemplates').get();
  const want = tplNameKey(name);
  const hit = all.docs.find((d) => tplNameKey((d.data() || {}).name) === want);
  return hit ? { empty: false, docs: [hit] } : { empty: true, docs: [] };
}

/**
 * Records a captured PayPal payment on the matching invoice.
 * Safe to call more than once for the same captureId — it only
 * applies each real-world payment to the invoice a single time.
 */
async function recordPaypalPayment(phone, { captureId, tip, serviceAmount }) {
  const invRef = db.collection('invoices').doc(phone);
  let recorded = false;
  let orphaned = false;
  await db.runTransaction(async (t) => {
    // Reset per attempt: Firestore retries a contended transaction, and a flag
    // left set by an abandoned attempt would file a payment that did land.
    recorded = false;
    orphaned = false;
    const snap = await t.get(invRef);
    /* The card has already been charged by the time we get here. If there is no
       invoice under this key the money is real and the record is missing — this
       used to `return` silently, leaving no log, no alert, and a customer whose
       screen still said "Paid in Full". It is reachable in normal use: portalSave
       moves the invoice doc when a customer changes their phone or email, so
       anyone who updates their number between opening the pay screen and
       approving the payment lands here. File it and raise the alarm instead. */
    if (!snap.exists) { orphaned = true; return; }
    const inv = snap.data();
    const existingPayments = inv.paypalPayments || [];
    if (existingPayments.some((p) => p.captureId === captureId)) return; // already recorded
    recorded = true;
    t.update(invRef, {
      deposit: admin.firestore.FieldValue.increment(serviceAmount),
      tipTotal: admin.firestore.FieldValue.increment(tip),
      lastPaymentMethod: 'paypal',
      lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
      paypalPayments: admin.firestore.FieldValue.arrayUnion({
        captureId,
        tip,
        serviceAmount,
        capturedAt: new Date().toISOString()
      })
    });
  });
  // Outside the transaction on purpose: the payment is already safely written,
  // and a slow or failed email must never roll it back. Both paypalCaptureOrder
  // and the webhook come through here, and the receiptSentForDeposit guard
  // inside sendPaymentReceipt stops them emailing the same payment twice.
  /* The payment ledger (payments collection). Only when this call is the one
     that actually recorded the money — `recorded` is false for a duplicate
     capture, and BOTH the browser and the webhook come through here for the
     same payment, so writing unconditionally would double every card payment
     in the ledger. Appended after the money is safely on the invoice, and
     wrapped, because losing the audit row must never cost the payment. */
  if (recorded) {
    try {
      await db.collection('payments').add({
        invoiceKey: phone,
        name: '',
        amount: Number(serviceAmount) || 0,
        method: 'paypal',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        enteredBy: 'paypal',
        ref: String(captureId || ''),
        note: (Number(tip) || 0) > 0
          ? 'Card payment, plus a $' + (Number(tip) || 0).toFixed(2) + ' tip'
          : 'Card payment',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.error('[HU] payment ledger write failed for capture', captureId, e);
    }
  }

  if (recorded) await sendPaymentReceipt(phone, { paidNow: Number(serviceAmount) || 0 });

  if (orphaned) await recordUnmatchedPayment(phone, { captureId, tip, serviceAmount });
}

/* A captured payment with no invoice to put it on. Filed so the money is never
 * just lost, and texted to the office so somebody actually goes and looks.
 * The doc ID is the captureId, so the webhook and the browser both landing here
 * for the same payment write one record, not two. */
async function recordUnmatchedPayment(phone, { captureId, tip, serviceAmount }) {
  try {
    await db.collection('unmatchedPayments').doc(String(captureId)).set({
      phone: phone,
      captureId: captureId,
      tip: Number(tip) || 0,
      serviceAmount: Number(serviceAmount) || 0,
      reason: 'No invoice document exists for this key — it may have moved when the customer changed their phone or email.',
      resolved: false,
      capturedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    // Nothing else can be done here, but it must be loud in the logs.
    console.error('[HU] FAILED to file an unmatched PayPal payment', captureId, phone, e);
  }
  /* ⭐ AND IT GOES IN THE SYSTEM INBOX (added 2026-08-30). Addie: "we need unmatched
     invoice to come up in system inbox before we send it out."

     ⚠ THE TEXT WAS THE ONLY THING THAT EVER SAID SO, and a text is gone the moment you
     look away. The money is real, it is ours, and the customer it came from still reads as
     owing — so somebody chases a bill that has already been paid. A note keeps until
     somebody deals with it, which is the whole difference.

     ⚠ BEST-EFFORT, LIKE THE TEXT BESIDE IT. This runs inside the payment path: the card
     has already been charged, and nothing here may throw back into it. A note that fails
     is logged and the money is still filed.

     ⚠ ONE NOTE PER CAPTURE, not per attempt. The document id above is the captureId
     precisely so the webhook and the browser both landing here write one record; this
     guard is the same idea for the Inbox, so a retried webhook cannot post twice. */
  try {
    const already = await db.collection('messages')
      .where('topic', '==', 'Payment With No Bill')
      .where('ref', '==', String(captureId)).limit(1).get();
    if (already.empty) {
      await db.collection('messages').add({
        topic: 'Payment With No Bill', folder: 'System',
        name: '', phone: phone || '', email: '', contactMethod: '',
        ref: String(captureId),
        message: 'A card payment of $' + (Number(serviceAmount) || 0).toFixed(2) +
                 ' from ' + (phone || 'an unknown number') + ' went through, but no invoice ' +
                 'could be found to put it against — usually because the phone or email the ' +
                 'bill is filed under changed after the invoice was written. The money is ' +
                 'ours and is safe, but that customer still reads as owing, so they may be ' +
                 'chased for a bill they have already paid. It is on the Invoices tab beside ' +
                 'them, and in Health Check under "A card payment that found no bill".',
        autoQueuedToWarehouse: false, needsReassign: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (e) {
    console.error('[HU] unmatched-payment inbox note failed:', e);
  }
  // The alert is best-effort and must never throw back into the payment path.
  try {
    const cfgSnap = await db.collection('settings').doc('nightlyInvoiceAutomation').get();
    const alertPhone = cfgSnap.exists ? (cfgSnap.data().alertPhone || '') : '';
    if (alertPhone) {
      await twilioSendRaw(alertPhone,
        'Highlighting Utah: a PayPal payment of $' + (Number(serviceAmount) || 0).toFixed(2) +
        ' from ' + phone + ' was charged but has no invoice to apply it to. ' +
        'It is saved under Unmatched Payments — please check.');
    }
  } catch (e) {
    console.error('[HU] unmatched-payment alert SMS failed:', e);
  }
}

/* ⭐ LAST SEASON'S CARRIED BALANCE — SERVER COPY (added 2026-09-01).
 *
 * ⚠ js/money.js has its own copy (ARREARS_KIND, arrearsOnInvoice,
 * arrearsOutstanding). Change both, in the same push — money-parity.test.js
 * feeds the two identical invoices and fails the build if they disagree. This
 * one decides what a CARD IS ACTUALLY CHARGED, so a drift here is the office
 * screen and the payment button asking a customer for two different amounts.
 *
 * The full reasoning is written out once, over the browser copy. In short: the
 * debt rides in the fee ledger as a note tagged `arrears`, payments are read
 * oldest-debt-first, and a customer is not scheduled until the whole carried
 * amount is covered by payment or credit.
 */
const ARREARS_KIND_SERVER = 'arrears';
function arrearsOnInvoiceServer(inv) {
  const notes = (inv && Array.isArray(inv.changeFeeNotes)) ? inv.changeFeeNotes : [];
  return notes.reduce(function (sum, n) {
    return sum + ((n && n.kind === ARREARS_KIND_SERVER) ? (Number(n.amount) || 0) : 0);
  }, 0);
}
/* Which season a carried debt is FROM — the year they fell behind, not today's.
 * ⚠ admin.html has arrearsYearOnInvoice, which is the same two steps: the note's own
 * `year`, else the four-digit year out of its reason text so a line written before the
 * field existed still names itself. Kept in step by arrears-hold.test.js, which runs
 * both over the same notes — the portal and the office screen naming different years
 * for one debt is exactly what "charged twice" looks like to a customer. */
function arrearsYearServer(inv) {
  const notes = (inv && Array.isArray(inv.changeFeeNotes)) ? inv.changeFeeNotes : [];
  const note = notes.filter(function (n) { return n && n.kind === ARREARS_KIND_SERVER; })[0];
  if (!note) return null;
  if (note.year) return String(note.year);
  const m = /(\d{4})/.exec(note.reason || '');
  return m ? m[1] : null;
}
function arrearsOutstandingServer(inv) {
  const owed = centsOf(arrearsOnInvoiceServer(inv));
  if (owed <= 0) return 0;
  const paid = centsOf((inv && inv.deposit) || 0) + centsOf((inv && inv.credits) || 0);
  return Math.max(0, owed - paid) / 100;
}

// Called from the Member Portal right before showing the PayPal button.
// Figures out what's actually owed and creates a matching PayPal order.
exports.paypalCreateOrder = onCall(
  { secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV] },
  async (request) => {
    const { phone, tipAmount, payAll } = request.data || {};
    if (!phone) throw new HttpsError('invalid-argument', 'Missing phone.');

    const invSnap = await db.collection('invoices').doc(phone).get();
    if (!invSnap.exists) throw new HttpsError('not-found', 'No invoice found for this phone.');
    const inv = invSnap.data();
    const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
    const credits = Number(inv.credits) || 0;
    const paid = Number(inv.deposit) || 0;
    const balanceDue = Math.max(0, total - credits - paid);
    const tip = Math.max(0, Number(tipAmount) || 0);
    /* ⭐ ONE SEASON AT A TIME (2026-09-01). Addie: "I don't want them to type there
       amount because then we can't trust if someone paid in full. Can we do a one year
       payment than next years payment will show up after they paid that year?"

       So the customer is never asked to choose a figure. While last season's carried
       balance is outstanding, THAT is what the button charges — nothing else. Once it is
       paid the same button comes back offering this year's, because this recalculates
       from the invoice every time the panel is opened.

       ⚠ IT MAKES A PART PAYMENT POSSIBLE AT ALL. Before this the button charged the
       whole balance, so somebody who owed $400 from last season on an $850 bill could
       not pay the $400 that would get their lights hung — they had to pay all of it or
       use Venmo.

       ⚠ CAPPED AT THE BALANCE. A carried figure larger than what is left on the bill
       (a credit applied since, say) must never charge more than they owe. */
    const arrearsLeft = Math.min(arrearsOutstandingServer(inv), balanceDue);
    /* ⭐ AND SINCE 2026-08-31 THEY CAN CHOOSE THE OTHER ONE. Addie: "2 button options
       for last year and full payment." The default is unchanged — last season, chosen
       for them — but somebody who would rather clear the whole account in one go no
       longer has to ring the office or fall back to Venmo to do it.

       ⚠ A FLAG, NOT AN AMOUNT. `payAll` only picks between two figures this function
       has just worked out from the invoice itself. A caller cannot name a number, so
       the worst a forged request can do is pay MORE of their own bill than the page
       offered — which is why this needs no further guard. */
    const payingLastSeason = arrearsLeft > 0 && !payAll;
    const chargeAmount = (payingLastSeason ? arrearsLeft : balanceDue) + tip;

    if (chargeAmount <= 0) throw new HttpsError('failed-precondition', 'Nothing due to charge.');

    const env = PAYPAL_ENV.value() || 'sandbox';
    const token = await getPaypalAccessToken(PAYPAL_CLIENT_ID.value(), PAYPAL_CLIENT_SECRET.value(), env);
    const base = paypalApiBase(env);

    const orderRes = await fetch(base + '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          custom_id: phone,
          description: 'Christmas Lights' + (tip > 0 ? ' + Tip' : ''),
          amount: { currency_code: 'USD', value: chargeAmount.toFixed(2) }
        }]
      })
    });
    if (!orderRes.ok) {
      const text = await orderRes.text();
      throw new HttpsError('internal', 'PayPal order creation failed: ' + text);
    }
    const order = await orderRes.json();
    /* ⚠ THE PORTAL HAS TO BE ABLE TO SAY WHICH YEAR THIS IS FOR. Addie: "we need to
       emphasize that is last years payment so someone doesn't get mad and think they are
       charged twice." A button showing a number smaller than the balance, with nothing
       saying why, reads as a mistake or a double charge. */
    return { orderID: order.id, balanceDue, tip, total: chargeAmount,
             payingLastSeason, arrearsLeft,
             arrearsSeason: arrearsYearServer(inv) || '' };
  }
);

// Called right after the customer approves payment in the PayPal popup.
// Actually captures the money, then records it on their invoice.
exports.paypalCaptureOrder = onCall(
  { secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV] },
  async (request) => {
    const { orderID, phone, tipAmount } = request.data || {};
    if (!orderID || !phone) throw new HttpsError('invalid-argument', 'Missing orderID or phone.');

    const env = PAYPAL_ENV.value() || 'sandbox';
    const token = await getPaypalAccessToken(PAYPAL_CLIENT_ID.value(), PAYPAL_CLIENT_SECRET.value(), env);
    const base = paypalApiBase(env);

    const captureRes = await fetch(base + '/v2/checkout/orders/' + orderID + '/capture', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    const captureData = await captureRes.json();
    if (!captureRes.ok || captureData.status !== 'COMPLETED') {
      throw new HttpsError('internal', 'PayPal capture failed: ' + JSON.stringify(captureData));
    }

    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
    const capturedAmount = Number(capture?.amount?.value) || 0;
    const captureId = capture?.id || orderID;

    /* Everything below is derived from PayPal's own response and the invoice on
       file. Nothing the browser sent is trusted, for two reasons:

       1. custom_id was stamped onto the order server-side when it was created,
          so it is the authoritative invoice key. Taking `phone` from the request
          would let a caller post a payment against somebody else's invoice.
       2. The tip/service split is recomputed from the live balance. A caller
          supplying tipAmount could otherwise book a genuine payment as 100% tip,
          leaving a customer who really paid still showing as owing money.

       Money owed is always settled first; only the surplus counts as a tip. */
    const invoiceKey = captureData.purchase_units?.[0]?.custom_id || phone;
    const invSnap = await db.collection('invoices').doc(invoiceKey).get();
    let serviceAmount = capturedAmount;
    let tip = 0;
    if (invSnap.exists) {
      const inv = invSnap.data();
      const owed = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
      const balanceDue = Math.max(0, owed - (Number(inv.credits) || 0) - (Number(inv.deposit) || 0));
      /* ⭐ A PART PAYMENT'S TIP IS A TIP (fixed 2026-08-31). This read
         `serviceAmount = min(captured, balanceDue)` and called only the surplus a
         tip — right while the button always charged the whole bill, and wrong from
         the moment it started charging last season alone. A customer paying $200 of
         a $1,146 bill and adding $30 for the crew sent $230, which is under the
         balance, so the whole $230 was booked against the bill and the tip was
         recorded as $0. The crew's tip quietly became bill payment, on every arrears
         payment since 2026-09-01.

         ⚠ STILL DERIVED, NEVER TAKEN FROM THE BROWSER. The reason the old line
         existed is unchanged: a caller supplying tipAmount could book a real payment
         as 100% tip and leave a customer who paid still showing as owing. So the
         split is inferred from the invoice instead — createOrder only ever charges
         one of two figures plus a tip, so a capture landing on or above either of
         them settles that figure and the remainder is the tip.

         ⚠ WHOLE CENTS, because $230 against a $230 debt must not miss by 2.8e-14
         and book a customer's whole payment as a tip. */
      const arrearsLeft = Math.min(arrearsOutstandingServer(inv), balanceDue);
      const cap = centsOf(capturedAmount);
      if (cap >= centsOf(balanceDue)) {
        serviceAmount = balanceDue;
      } else if (arrearsLeft > 0 && cap >= centsOf(arrearsLeft)) {
        serviceAmount = arrearsLeft;
      } else {
        serviceAmount = capturedAmount;
      }
      tip = Math.max(0, (cap - centsOf(serviceAmount)) / 100);
    }

    await recordPaypalPayment(invoiceKey, { captureId, tip, serviceAmount });

    return { success: true, capturedAmount, tip };
  }
);

/**
 * Twilio integration: sends a single SMS through a Cloud Function so the
 * Account SID and Auth Token never touch the browser. Called from
 * admin.html's Automation > Text Automation tab.
 *
 * Setup (run once from the project root, after `firebase login`):
 *   firebase functions:secrets:set TWILIO_ACCOUNT_SID
 *   firebase functions:secrets:set TWILIO_AUTH_TOKEN
 *   firebase functions:secrets:set TWILIO_PHONE_NUMBER   (your Twilio number, e.g. +18015551234)
 *
 * Then deploy with:
 *   firebase deploy --only functions
 */

const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');

function toE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

// Called from admin.html only — sends one text to one recipient.
// The admin panel loops over selected recipients and calls this once each.
exports.sendSms = onCall(
  { secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const { to, body } = request.data || {};
    if (!to || !body) throw new HttpsError('invalid-argument', 'Missing to or body.');
    const toNumber = toE164(to);
    if (!toNumber) throw new HttpsError('invalid-argument', 'That phone number doesn\'t look valid.');

    const sid = TWILIO_ACCOUNT_SID.value();
    const authToken = TWILIO_AUTH_TOKEN.value();
    const from = TWILIO_PHONE_NUMBER.value();
    const basicAuth = Buffer.from(sid + ':' + authToken).toString('base64');

    const params = new URLSearchParams();
    params.append('To', toNumber);
    params.append('From', from);
    params.append('Body', body);

    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + basicAuth,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const data = await res.json();
    if (!res.ok) {
      throw new HttpsError('internal', 'Twilio send failed: ' + (data.message || JSON.stringify(data)));
    }
    return { success: true, sid: data.sid, status: data.status };
  }
);
// capture (e.g. the customer closed the tab right after paying). Verifies the
// signature before trusting anything, and never double-counts a payment that
// the browser-side call already recorded.
exports.paypalWebhook = onRequest(
  { secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENV] },
  async (req, res) => {
    try {
      const env = PAYPAL_ENV.value() || 'sandbox';
      const token = await getPaypalAccessToken(PAYPAL_CLIENT_ID.value(), PAYPAL_CLIENT_SECRET.value(), env);
      const base = paypalApiBase(env);

      const verifyRes = await fetch(base + '/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_algo: req.headers['paypal-auth-algo'],
          cert_url: req.headers['paypal-cert-url'],
          transmission_id: req.headers['paypal-transmission-id'],
          transmission_sig: req.headers['paypal-transmission-sig'],
          transmission_time: req.headers['paypal-transmission-time'],
          webhook_id: PAYPAL_WEBHOOK_ID.value(),
          webhook_event: req.body
        })
      });
      const verifyData = await verifyRes.json();
      if (verifyData.verification_status !== 'SUCCESS') {
        res.status(400).send('Signature verification failed');
        return;
      }

      const event = req.body;
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
        const resource = event.resource;
        const phone = resource.custom_id;
        const capturedAmount = Number(resource.amount?.value) || 0;
        const captureId = resource.id;
        if (phone) {
          // The webhook has no idea what portion (if any) was a tip, so if this
          // capture wasn't already recorded by the browser-side call, it's
          // recorded here as 100% service — better an accurate total with a
          // slightly-off tip split than a payment that never gets marked paid.
          await recordPaypalPayment(phone, { captureId, tip: 0, serviceAmount: capturedAmount });
        }
      }
      res.status(200).send('OK');
    } catch (err) {
      console.error('paypalWebhook error', err);
      res.status(500).send('Error');
    }
  }
);

/* ============================================================================
 * MEMBER PORTAL — server-side lookup and save
 * ----------------------------------------------------------------------------
 * The public site (index.html) has no Firebase Auth, so it cannot read or write
 * jobAddresses directly without opening that collection to the whole internet.
 * These functions do that work here instead. They run with Admin privileges,
 * which bypass Firestore rules, so jobAddresses can stay locked to staff.
 *
 * Every function takes the customer's portalToken as its credential — the same
 * 20-character token already embedded in {{portal_link}} and the RSVP buttons.
 *
 * Deploy:  firebase deploy --only functions
 * ==========================================================================*/

// Fields the portal is allowed to change, grouped by which Save button sends
// them. Anything not listed here can never be written from the public site.
const PORTAL_WRITE_FIELDS = {
  info:        ['name', 'phone', 'email', 'address', 'phone2', 'email2', 'gateCode'],
  preferences: ['installPreference', 'wireColor', 'outletTimer', 'specificOutlet',
                'specificOutletNotes', 'notes'],
  lights:      ['lightsDescription'],
  /* ⭐ Which sides they want lit. Its own section, not folded into
     'preferences', because changing it changes the PRICE — see the requote
     flag below — and a section is what decides whether that runs. */
  sides:       ['houseSides'],
  cancel:      ['cancellationReason']
};

// Fields the portal is allowed to READ. Everything else on the record —
// pricing, customer number, bin assignments, difficulty rating, test-account
// flag, don't-install-before date, crew notes — never leaves the server.
const PORTAL_READ_FIELDS = [
  'name', 'phone', 'email', 'address', 'phone2', 'email2', 'gateCode',
  'lightsDescription', 'installPreference', 'wireColor', 'outletTimer',
  'specificOutlet', 'specificOutletNotes', 'notes', 'rsvpStatus', 'houseSides',
  /* ⚠ THE WORD ON ITS OWN IS NOT AN ANSWER, so the portal needs the stamp too
     (added 2026-09-02). A stored yes with nothing behind it is an import or the
     assumed yes written at conversion (RS-19) — the office already refuses that
     through effectiveRsvpStatus, and until now the portal COULD NOT make the same
     distinction: this field was written by three server paths and sent to nobody,
     so it read as undefined for everybody. The RSVP question raised after a payment
     would therefore have been put to customers who had already answered it.
     Caught by portal-fields.test.js, which exists for exactly this shape. */
  'rsvpRespondedAt',
  /* ⭐ REFER A FRIEND (2026-09-03). Two fields, and the portal cannot draw that tab
     without either of them — a whitelist is the whole of what reaches the browser, so a
     field left out here is simply undefined on the customer's screen with nothing
     anywhere saying why. portal-fields.test.js exists for exactly this shape.
     ⚠ referralCount IS THE LIVE FIGURE, rebuilt from referralCredits[] by the office
     whenever one is given or taken back. The entries themselves are NOT sent: they name
     the friends who joined, and one customer does not get to read another's name off
     their own portal. The number is all the customer needs and all they are told. */
  'referralToken', 'referralCount',
  'seasonStatus', 'seasonStatusAt', 'cancellationReason', 'housePhotoUrl', 'houseHighlights',
  /* Set when they decline a re-quote: somebody has to ask whether last year's
     job will do. In the read list so the portal cannot contradict the office
     about a question that is still open. */
  'askSameAsLastYear',
  /* Set by the nightly run when there is no email anywhere on their bill. In
     the read list so the portal cannot show a customer as settled while the
     office is chasing them for an address. */
  'cannotBillNoEmail',
  'quoteDetailQuoteId',
  /* The end of their current free-change window, which is also the window in
     which they are deliberately not put on a route. The portal needs it BEFORE
     a save so its confirm dialog can tell them whether this change costs $30 —
     it used to warn about a fee even on a change that was still free, then
     contradict itself in the note straight afterwards.

     ⚠ THIS IS WHY IT COMES FROM THE CUSTOMER AND NOT THE INVOICE. portalInvoice
     derives lightChangeFreeUntil from the invoice's lastLightChangeFeeAt, which
     only exists once a fee has actually been charged — so a NEW customer, whose
     window is opened by joining rather than by paying, looked to the portal like
     somebody with no window at all and was warned about a fee they did not owe. */
  'lightsLockedUntil',
  /* "When are you coming?" is the most-asked question of the season and the
     answer was already on the record, just never sent. The DATE only — never
     assignedCrew and never the stop order, which are internal and would turn
     into "why am I last?" calls. */
  'scheduledDate', 'completed', 'removalDone'
];

function generatePortalToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function digitsOnly(raw) {
  return String(raw || '').replace(/\D/g, '');
}

// Strip a Firestore record down to only what the portal needs to render.
function sanitizeRecord(data) {
  const out = {};
  PORTAL_READ_FIELDS.forEach(function (f) {
    if (data[f] !== undefined) out[f] = data[f];
  });
  return out;
}

/* The last-name half of the portal sign-in.
 *
 * ⚠ This used to end with `stored.indexOf(typed) !== -1` — a plain substring
 * test. Typing the single letter "a" therefore matched "Sarah Adams", "Frome"
 * and "Cosby": nearly every name in the book. Five attempts are allowed per
 * phone per 15 minutes and one was enough, so anyone who knew a customer's
 * phone number could open their account. Fixed 2026-08-14.
 *
 * Now the typed name must be a WHOLE WORD of the stored name, or the stored
 * name in full. Word-order independent on purpose — names are stored
 * "First Last" but customers type either part.
 *
 * Deliberately NO minimum length: the whole-word rule closes the hole by
 * itself, and Le, Ho, Ng and Vu are real surnames that a 3-character floor
 * would lock out of their own accounts permanently.
 *
 * Split on hyphens and apostrophes as well as spaces, so "Adams" still signs
 * in "Sarah Adams-Brown" and "Brien" still signs in "Sarah O'Brien". */
/* ⭐ ANY SURNAME IN THE HOUSEHOLD, NOT ONLY THE PAYER'S.
 * Owner, 2026-08-18: "the child can log in they just need to put their parents
 * phone number or email in, but their name should still work for it, so they
 * can sign in with their last name or their parents".
 *
 * A student whose parents pay signs in with the PARENT'S phone or email,
 * because that is the account. findByPhone then returns the parent's record and
 * nameMatches tested the parent's surname alone — so a child with a different
 * surname could not reach the account that is paying for their house.
 *
 * The set this widens to is not arbitrary: it is exactly the houses billed to
 * this payer, which is the same group portalLookup already returns as `houses`
 * and the same group the invoice already bills as one. If a house is on the
 * parent's bill, the person living in it can sign in.
 *
 * ⚠ IT DOES WIDEN THE DOOR. The sign-in is phone-or-email plus a surname, and
 * this makes several surnames valid for one account instead of one. For a
 * family they are usually the same surname anyway, so the real widening is
 * small — but it is real, and the rate limiter on this path is what keeps it
 * from being guessable. Do not remove that limiter thinking this is harmless.
 *
 * Falls back to the payer alone if the query fails: nobody is locked out of
 * their own account by a lookup that did not answer. */
async function nameMatchesHousehold(payerData, payerId, typedName) {
  if (nameMatches(payerData && payerData.name, typedName)) return true;
  if (!typedName) return false;
  try {
    const billKey = digitsOnly(payerData.billToPhone) || invoiceKeyFor(payerData);
    if (!billKey) return false;
    const snap = await db.collection('jobAddresses')
      .where('billToPhone', '==', billKey).get();
    let ok = false;
    snap.forEach(function (d) {
      if (d.id === payerId) return;
      if (nameMatches(d.data().name, typedName)) ok = true;
    });
    return ok;
  } catch (err) {
    console.error('[HU] household name check failed', err);
    return false;
  }
}
function nameMatches(storedName, typedName) {
  const stored = String(storedName || '').toLowerCase().trim();
  const typed = String(typedName || '').toLowerCase().trim();
  if (!typed || !stored) return false;
  if (stored === typed) return true;                       // they typed their full name
  const words = stored.split(/[\s\-'’]+/).filter(Boolean);
  return words.indexOf(typed) !== -1;
}

/* --- Rate limiting --------------------------------------------------------
 * Only applies to the phone/email + last name sign-in, which is guessable.
 * Token links are not rate limited — a 20-character random token can't be
 * brute forced, and rate limiting those would break legitimate email clicks.
 * 5 attempts per identifier per 15 minutes.
 */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

async function checkRateLimit(identifier) {
  const key = String(identifier || '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 120);
  if (!key) return;
  const ref = db.collection('portalRateLimits').doc(key);
  const now = Date.now();
  await db.runTransaction(async function (tx) {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (!data || (now - (data.windowStart || 0)) > RATE_LIMIT_WINDOW_MS) {
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if ((data.count || 0) >= RATE_LIMIT_MAX) {
      throw new HttpsError(
        'resource-exhausted',
        "Too many sign-in attempts. Please wait 15 minutes, or call or text us at (801) 901-0011 and we'll help you out."
      );
    }
    tx.update(ref, { count: (data.count || 0) + 1 });
  });
}

/* --- Record finders ------------------------------------------------------- */

async function findByToken(token) {
  if (!token) return null;
  const snap = await db.collection('jobAddresses')
    .where('portalToken', '==', token).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() };
}

/* ---- finding a customer, without downloading all of them -----------------
 *
 * ⚠ These used to read the ENTIRE jobAddresses collection on an ordinary
 * sign-in — findByEmail did it unconditionally, findByPhone whenever the
 * stored phone had a bracket or a dash in it. That is ~967 document reads to
 * answer "is this one person a customer?", on every visit, and it is most of
 * what the portal's "this can take a few seconds" spinner was apologising for.
 *
 * A phone or email is stored as the customer typed it — "(801) 555-0142",
 * "Dana@Example.com" — so it cannot be matched with an equality query. The fix
 * is to keep NORMALISED copies alongside (phoneDigits, emailLower,
 * email2Lower) and query those.
 *
 * The full scan stays as a LAST resort, because a record written before those
 * fields existed has none of them and must still be findable — a customer
 * locked out of their own account would be a far worse bug than a slow read.
 * It logs when it happens, so a persistently slow sign-in points at the
 * backfill rather than staying a mystery. Admin's "Fill in the sign-in
 * shortcuts" tool writes the fields for existing records.
 */
async function findByIndexedField(field, value) {
  if (!value) return null;
  try {
    const snap = await db.collection('jobAddresses').where(field, '==', value).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };
  } catch (err) {
    // A missing index must not break sign-in — fall through to the scan.
    console.error('[HU] indexed lookup failed on ' + field, err);
  }
  return null;
}

async function findByPhone(phoneDigits) {
  if (!phoneDigits) return null;
  // 1. The normalised field — one read.
  const indexed = await findByIndexedField('phoneDigits', phoneDigits);
  if (indexed) return indexed;
  // 2. The raw field, for a customer who typed a bare number — one read.
  const snap = await db.collection('jobAddresses')
    .where('phone', '==', phoneDigits).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };
  // 3. Last resort: everyone. Only reachable for records that predate
  //    phoneDigits, and loud about it so the backfill gets run.
  console.warn('[HU] full-collection scan for phone ' + phoneDigits + ' — run the sign-in shortcut backfill');
  const all = await db.collection('jobAddresses').get();
  let found = null;
  all.forEach(function (d) {
    if (found) return;
    if (digitsOnly(d.data().phone) === phoneDigits) found = { id: d.id, data: d.data() };
  });
  return found;
}

async function findByEmail(emailLower) {
  if (!emailLower) return null;
  // Primary first, then the second address a spouse might sign in with.
  const byPrimary = await findByIndexedField('emailLower', emailLower);
  if (byPrimary) return byPrimary;
  const bySecondary = await findByIndexedField('email2Lower', emailLower);
  if (bySecondary) return bySecondary;

  console.warn('[HU] full-collection scan for email ' + emailLower + ' — run the sign-in shortcut backfill');
  const all = await db.collection('jobAddresses').get();
  let found = null;
  // Primary email matches win over secondary matches if both exist somewhere.
  all.forEach(function (d) {
    if (found) return;
    const e = d.data().email;
    if (e && String(e).toLowerCase().trim() === emailLower) found = { id: d.id, data: d.data() };
  });
  if (found) return found;
  all.forEach(function (d) {
    if (found) return;
    const e2 = d.data().email2;
    if (e2 && String(e2).toLowerCase().trim() === emailLower) found = { id: d.id, data: d.data() };
  });
  return found;
}

/* Keep the normalised copies in step whenever contact details change. Returns
   the fields to merge into a jobAddresses write — used by portalSave, and
   mirrored by admin's own customer saves. */
function contactIndexFields(data) {
  const out = {};
  if (data.phone !== undefined) out.phoneDigits = digitsOnly(data.phone);
  if (data.email !== undefined) out.emailLower = String(data.email || '').toLowerCase().trim();
  if (data.email2 !== undefined) out.email2Lower = String(data.email2 || '').toLowerCase().trim();
  return out;
}

/* --- Invoice key ----------------------------------------------------------
 * Invoices are stored with the customer's phone digits as the doc ID. For
 * customers with no phone, the lowercase primary email is the ID instead.
 * A customer's key can change (e.g. a phone gets added later) — portalSave
 * below moves the invoice doc when that happens.
 */
function invoiceKeyFor(data) {
  const phone = digitsOnly(data && data.phone);
  if (phone) return phone;
  const email = String((data && data.email) || '').toLowerCase().trim();
  return email || '';
}

/* ⭐ WHAT A CUSTOMER STILL OWES FROM LAST SEASON, for the screens that have to
 * say so (2026-09-01). RS-24 holds a debtor out of the season EVEN WHEN THEY
 * ANSWER YES, and there are two doors into a yes — the RSVP link (portalRsvp)
 * and approving a quote as an existing member (quoteRespond). Both used to end
 * on a promise to get them scheduled, which is the one thing that was never
 * going to happen for them.
 *
 * ⚠ ONE HELPER, BECAUSE THE SECOND DOOR WOULD HAVE BEEN A SECOND COPY. Fixing
 * the RSVP and leaving the quote path is half a fix by this repo's own name for
 * it, and two copies of "does this customer owe" is how two screens start making
 * different claims about one rule.
 *
 * ⚠ THE BILL THE HOUSE IS ON, NEVER THE HOUSE'S OWN KEY — RS-24 verbatim: if
 * Dana pays for Kyle and Dana did not pay, Kyle's lights were not paid for
 * either, and reading Kyle's own key finds no invoice and tells him he is clear.
 *
 * ⚠ AND IT FAILS TOWARDS SILENCE, deliberately the opposite direction to the
 * season hold. An unreadable invoice answers nought, which leaves the original
 * wording in place. Holding somebody who paid costs them their lights; telling
 * somebody they owe money we cannot prove they owe is worse than not warning
 * them about a real debt, and the office still has Schedule > Owes from last
 * year either way. */
async function arrearsForCustomer(custData) {
  const none = { outstanding: 0, season: '' };
  try {
    const d = custData || {};
    const billKey = digitsOnly(d.billToPhone) || invoiceKeyFor(d);
    if (!billKey) return none;
    const invSnap = await db.collection('invoices').doc(billKey).get();
    if (!invSnap.exists) return none;
    const inv = invSnap.data();
    return { outstanding: arrearsOutstandingServer(inv), season: arrearsYearServer(inv) || '' };
  } catch (e) {
    /* Logged rather than swallowed (Addie, 2026-08-25: "nothing should fail
       quietly"). The caller's own write is already done by this point and must
       never be lost to an invoice read. */
    console.error('[HU] arrearsForCustomer failed:', e);
    return none;
  }
}

/* --- Nothing changes hands until last season is settled ---------------------
 *
 * Dax, 2026-09-02: "make sure it forces them to pay for their last year lights
 * before they can do anything and before anything goes into the system."
 *
 * ⭐ THE SECOND HALF IS WHY THIS IS HERE AND NOT ONLY IN THE PORTAL. A screen
 * that hides its own tabs is a suggestion — the callable is public, and anyone
 * who can open a browser console can call it with a token. "Before anything goes
 * into the system" is a claim about the DATABASE, so it has to be refused at the
 * write.
 *
 * ⚠ AN ANSWER IS NOT A CHANGE, and the two are deliberately not treated alike.
 * portalRsvp is never held: RS-33 turns on the answer being recorded whatever
 * else happens, and a customer who owes money is exactly the one whose yes or no
 * the office most needs. Cancelling is not held either — somebody trying to LEAVE
 * must never be told to pay first, or they simply stop replying and Addie never
 * learns why. Both were Dax's own call when the scope was put to him.
 *
 * ⚠ AND IT FAILS OPEN, which is the opposite of the season hold and is chosen for
 * the same reason arrearsForCustomer answers nought on an unreadable invoice:
 * refusing a save because we could not READ a bill would block a customer who may
 * owe nothing at all, and the office still holds them out of the season either
 * way. A change slipping through costs a form field; a customer locked out of
 * their own account by a failed read costs a phone call and their trust. */
async function arrearsHoldBlocks(custData) {
  const owed = await arrearsForCustomer(custData);
  return (owed.outstanding || 0) > 0 ? owed : null;
}
function arrearsHoldError(owed) {
  const season = owed && owed.season ? String(owed.season) : '';
  return new HttpsError('failed-precondition',
    'There is still a balance owing from ' + (season ? 'the ' + season + ' season' : 'last season') +
    '. Once that is paid you can make changes here again.');
}

// Make sure a record has a portalToken, minting one if it predates the system.
/* ⭐ THE REFERRAL TOKEN, MINTED THE FIRST TIME THEY OPEN THE PORTAL (2026-09-03).
 *
 * ⚠ IT IS NOT THE PORTAL TOKEN AND MUST NEVER BE. A portal token signs somebody in;
 * this one is pasted into a group chat, printed on a card, forwarded to a neighbour.
 * Reusing the login token as the referral link would hand the customer's own account —
 * their address, their balance, their ability to cancel — to everyone they shared it
 * with. Two tokens, two jobs, and they are generated by the same function only because
 * twenty random characters is the right shape for both.
 *
 * ⚠ LAZILY, NOT ON EVERY RECORD, for the same reason ensureToken below is lazy: writing
 * one onto ~960 customers is a mass write for a feature most of them will never open,
 * and the office creates customers through six different paths that would each have to
 * remember to do it. The first look creates it; every look after that returns it.
 *
 * ⚠ AND A FAILED WRITE STILL RETURNS THE TOKEN, matching ensureToken exactly. The cost
 * is a link that stops working when they next sign in and gets replaced by a fresh one
 * — annoying. The alternative is a Refer a Friend tab that is empty because a write
 * failed, which reads as the feature being broken. */
/* ⭐ TAKING A REFERRAL CREDIT BACK, SERVER SIDE (2026-09-03).
 *
 * ⚠ THE OFFICE'S COPY IS clawBackReferralIfAny IN admin.html AND THIS IS THE SECOND
 * DOOR, not a duplicate of it: a customer declining in their own portal never touches
 * the office screen, so without this the referrer keeps $25 for somebody who cancelled
 * — silently, and only ever discoverable by comparing two records by hand. Same shape as
 * the recycle flag, which portalRsvp writes for exactly the same reason.
 *
 * ⚠ THE TWO RULES IT OBEYS ARE THE SAME TWO, and they are Addie's:
 *   • a referral that reached an INSTALL is earned, so completed === true stops it;
 *   • a bill already PAID IN FULL is never charged back, because taking $25 of credit
 *     off a settled invoice turns it into money owed and sends a bill to somebody who
 *     has paid.
 * They are spelled out here rather than imported because js/money.js is a browser ES
 * module and this file is Node — the same split that gives computeInvoiceStatus two
 * copies. If a third rule is ever added, it goes in BOTH and in the same push.
 *
 * ⚠ IT NEVER THROWS INTO portalRsvp. The customer's answer is the thing that must be
 * recorded; a credit that could not be taken back is a discrepancy the office can fix,
 * whereas a failed RSVP is a crew sent to a house that said no. */
async function clawBackReferralServer(customerId, customerData) {
  try {
    const d = customerData || {};
    if (d.completed === true) return false;   // the referral did its job
    const referrerId = String(d.referredByCustomerId || '');
    if (!referrerId) return false;
    const snap = await db.collection('jobAddresses').doc(referrerId).get();
    if (!snap.exists) return false;
    const rd = snap.data() || {};
    const entries = Array.isArray(rd.referralCredits) ? rd.referralCredits.slice() : [];
    const idx = entries.findIndex(function (e) {
      return e && !e.revoked && e.referredCustomerId === customerId;
    });
    if (idx === -1) return false;
    /* ⚠ THE REFERRER'S OWN BILL DECIDES, NOT THE PERSON CANCELLING. invoiceKeyFor is
       the one rule for which invoice somebody is filed under; comparing phone fields
       here is the mistake this file already records by name. */
    const key = invoiceKeyFor(rd);
    if (key) {
      const invSnap = await db.collection('invoices').doc(key).get();
      if (invSnap.exists) {
        const inv = invSnap.data() || {};
        const status = computeInvoiceStatusServer(
          inv.install, inv.removal, inv.deposit, inv.credits, inv.changeFees);
        if (status === 'Paid in Full') return false;
      }
    }
    entries[idx] = Object.assign({}, entries[idx],
      { revoked: true, revokedAt: new Date().toISOString() });
    /* ⚠ `waived` COUNTS AS NOT COUNTED HERE TOO, and it must match referralLiveCount in
       admin.html exactly: that is the office crossing the discount off with the × (MON-56),
       and a server copy that ignores it would put every waived referral back on the bill
       the first time a customer declines. Change one, change the other. */
    const live = entries.filter(function (e) { return e && !e.revoked && !e.waived; }).length;
    await db.collection('jobAddresses').doc(referrerId).update({
      referralCredits: entries, referralCount: live,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    /* ⚠ THE INVOICE LINE IS LEFT TO THE OFFICE, DELIBERATELY. syncPayerInvoice is the
       authoritative money writer and it lives in the browser; a second writer here
       would be the copy that falls behind. The note below is what makes that safe —
       it names the customer, so the credit is corrected by somebody who can see the
       whole bill rather than by a callable that can see one field. */
    await db.collection('messages').add({
      topic: 'Referral Taken Back', folder: 'System',
      name: rd.name || '', phone: rd.phone || '', email: rd.email || '',
      contactMethod: '',
      message: (d.name || 'A customer') + ' said no in their own portal before their lights ' +
               'went up, so the $25 referral credit ' + (rd.name || 'the person who referred them') +
               ' was given for them no longer counts \u2014 they are down to ' + live + ' referral' +
               (live === 1 ? '' : 's') + '. Open their record and press Save to put the ' +
               'credit line on their bill right.',
      autoQueuedToWarehouse: false, needsReassign: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error('Could not take a referral credit back:', err);
    return false;
  }
}
async function ensureReferralToken(id, data) {
  if (data.referralToken) return data.referralToken;
  const token = generatePortalToken();
  try {
    await db.collection('jobAddresses').doc(id).update({ referralToken: token });
  } catch (err) {
    // Use it anyway — worst case their link is replaced on the next visit.
  }
  return token;
}
async function ensureToken(id, data) {
  if (data.portalToken) return data.portalToken;
  const token = generatePortalToken();
  try {
    await db.collection('jobAddresses').doc(id).update({ portalToken: token });
  } catch (err) {
    // Use the token anyway — worst case they get a fresh one next visit.
  }
  return token;
}

/* --- Who a bill is actually for -------------------------------------------
 *
 * One invoice can cover several houses — a parent paying for a child's house, a
 * landlord paying for tenants, somebody with a cabin as well as a house. The
 * office set that up deliberately and the nightly run bills it as ONE amount.
 * The portal showed that one amount beside ONE address, so the number simply
 * looked too big for the house on the screen, and it never said WHOSE houses
 * were on it. Naming them is the whole point of these two helpers.
 *
 * ⚠ THE GROUP HAS TWO HALVES and naming only one half is worse than naming
 * none — the list would then disagree with the total printed under it:
 *   - a house with billToPhone === key, joined to this bill by the office
 *   - a house with NO billToPhone whose own invoice key IS key, which is two
 *     records under one phone sharing an invoice without any field being set
 * runInvoiceBatch below and syncPayerInvoice in admin.html both sum exactly
 * that group. Keep all three in step or the names and the money disagree.
 *
 * ⚠ WHICH HELPER TO USE MATTERS. billedHousesByIds reads the invoice's own
 * billedHouseIds — the list the total was summed from — so the rows and the
 * amount beside them can never drift apart, and it needs no query at all.
 * billedHousesByKey is the fallback for a record with no invoice yet (that is
 * portalLookup's case) and covers only the billToPhone half, because the other
 * half would need a `where('phone','==',digits)` query and stored phones are
 * NOT all digits-only — the office types "(801) 555-0123" and the import keeps
 * it. That query is the same mistake that quietly duplicated the whole book
 * once; do not add it here.
 *
 * A house that RSVP'd 'no' is not billed this season and is in neither list,
 * exactly as it is left out of the total.
 */
function houseBillingRow(id, d) {
  return {
    id: id,
    name: d.name || '',
    address: d.address || '',
    propertyLabel: d.propertyLabel || '',
    lightsDescription: d.lightsDescription || '',
    housePrice: Number(d.housePrice) || 0,
    scheduledDate: d.scheduledDate || null,
    completed: !!d.completed,
    removalDone: !!d.removalDone
  };
}
/* ⭐ IS THIS HOUSE ON THE BILL — ONE RULE (added 2026-08-26, Q-012).
 * Addie, 2026-08-26: "After the last persons house is done if there are multiple
 * people on one bill is when they will be charged."
 *
 * ⚠ THE TIMING RULE WAS ALREADY RIGHT; WHO COUNTS WAS NOT. runInvoiceBatch holds a
 * multi-house bill until every house on it is `completed`, which is exactly what she
 * describes. But the group it waited on dropped only a flat "no" — so a house that
 * had said BACK NEXT YEAR was still counted as one of the houses to wait for, and it
 * is pulled off every upcoming route the moment they answer, so no crew ever visits
 * and `completed` can never become true. The whole household's bill was therefore
 * held open for the season and nobody was charged for the work that WAS done.
 * "The last person's house is done" has to mean the last house actually getting
 * lights, or her rule can never fire for that household at all.
 *
 * ⚠ A FLAT "NO" WAS LEFT ALONE HERE, AND Q-013 THEN CLOSED IT (2026-08-26). This
 * paragraph used to say the asymmetry stood — a house completed and THEN answering
 * "no" was still dropped — and that was true when Q-012 shipped, because widening a
 * money ruling nobody had asked about is not on. Addie was asked and answered: "Any
 * house hung no matter what should be charged." The body below tests `completed`
 * ahead of every status, so there is no asymmetry left. Corrected on the merge with
 * the billing-groups branch, which reached the same ruling in parallel — the comment
 * had been left describing behaviour its own function no longer had.
 *
 * ⚠ AND WORK THAT WAS DONE IS OWED FOR, whatever they have said since:
 * pullCustomerFromSeason's own comment is the settled rule — "not coming back next
 * year is not the same as not owing for last year." So `completed` is tested BEFORE
 * the sitting-out branch, never after. Filtering on the RSVP alone would drop a house
 * that genuinely owes, which is that rule pointing the other way.
 *
 * Mirrored by houseIsOnTheBill in admin.html. Change one, change the other, in the
 * same push — money-parity runs the two side by side. */
function houseIsOnTheBillServer(d) {
  if (!d) return false;
  /* ⭐ HUNG IS HUNG (2026-08-26, Q-013). Addie: "Any house hung no matter what should
     be charged. This will only be overuled if it is our fault... if we hung the lights
     and there is no reason to not charge them than we will charge them still."
     So `completed` is tested FIRST, ahead of every status — a flat "no" included.
     ⚠ THIS IS WHY IT IS FIRST AND NOT LAST. Until this ruling a house that had been
     hung and afterwards answered "no" was dropped from the bill outright, so the work
     was never charged for and nothing said so. Q-012 had already settled the same
     thing for back-next-year; this finishes it for the one case left over.
     ⚠ "OVERRULED IF IT IS OUR FAULT" IS A HUMAN DECISION, NOT A FIELD. The office
     writes it off on the invoice — credits already exist for exactly that. Inventing
     an automatic our-fault test would be the app guessing at fault, which is the one
     thing it must not do with money.
     ⚠ AND IT IS SAFE ONLY BECAUSE Start New Season CLEARS `completed` on every
     customer — verified in the season reset write before this shipped. If that ever
     stops, this line bills people for LAST season's work every season, for ever.
     Folded in from the billing-groups branch, which reached this ruling in parallel. */
  if (d.completed === true) return true;
  const said = String(d.rsvpStatus || '').trim().toLowerCase();
  if (said === 'no') return false;
  if (said === 'backnextyear' || d.maybeNextYear === true) return false;
  return true;
}
async function billedHousesByIds(ids) {
  const wanted = (Array.isArray(ids) ? ids : []).filter(Boolean);
  if (!wanted.length) return [];
  const refs = wanted.map(function (id) { return db.collection('jobAddresses').doc(id); });
  const snaps = await db.getAll.apply(db, refs);
  const out = [];
  snaps.forEach(function (s) {
    if (!s.exists) return;                       // deleted since the bill was built
    const d = s.data() || {};
    if (!houseIsOnTheBillServer(d)) return;
    out.push(houseBillingRow(s.id, d));
  });
  return out;
}
async function billedHousesByKey(key, selfId, selfData) {
  const out = [];
  const seen = {};
  const add = function (id, d) {
    if (seen[id] || !houseIsOnTheBillServer(d)) return;
    seen[id] = true;
    out.push(houseBillingRow(id, d));
  };
  if (selfId) add(selfId, selfData || {});
  if (!key) return out;
  const snap = await db.collection('jobAddresses').where('billToPhone', '==', key).get();
  snap.forEach(function (d) { add(d.id, d.data() || {}); });
  return out;
}

/* --- portalLookup ---------------------------------------------------------
 * Replaces every direct jobAddresses read the public site used to do,
 * including the three full-collection downloads that made every portal
 * visitor pull down the entire customer list.
 *
 * Input:  { token }  or  { phone, lastName }  or  { email, lastName }
 * Output: { found, id, token, record, deactivated }
 */
exports.portalLookup = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const token = body.token ? String(body.token).trim() : '';
  const phone = digitsOnly(body.phone);
  const email = body.email ? String(body.email).toLowerCase().trim() : '';
  const lastName = body.lastName ? String(body.lastName) : '';
  const quoteToken = body.quoteToken ? String(body.quoteToken).trim() : '';

  let match = null;

  if (token) {
    match = await findByToken(token);
    // Quote emails carry a quoteToken instead of a portalToken. If the token
    // didn't match a customer, try it as a quote token before giving up.
    if (!match && quoteToken) {
      const qSnap = await db.collection('quotes')
        .where('quoteToken', '==', quoteToken).limit(1).get();
      if (!qSnap.empty) {
        const qData = qSnap.docs[0].data();
        const qPhone = digitsOnly(qData.phone);
        if (qPhone) {
          /* ⚠ A quote token is NOT a customer credential and must never be
             upgraded into one. The public quote form generates quoteToken in
             the visitor's own browser (index.html) and saves it on the quote,
             so whoever submitted the form already knows it. This branch used
             to look the quote's phone up in jobAddresses and, on a hit, return
             that customer's real portalToken, invoiceKey and record — which
             includes their home address and gate code. Anyone who knew a
             customer's phone number could submit a quote against it and take
             over the account, then edit it through portalSave. Token lookups
             are deliberately not rate limited, so there was nothing slowing it
             down either. Fixed 2026-08-14.

             A quote token now only ever returns the quote. A returning
             customer who wants their account signs in with phone/email + last
             name, which is rate limited and name checked. */
          return {
            found: true,
            id: qSnap.docs[0].id,
            token: quoteToken,
            deactivated: false,
            isQuote: true,
            record: { name: qData.name || '', phone: qPhone, email: qData.email || '' }
          };
        }
      }
    }
  } else if (phone) {
    await checkRateLimit('phone_' + phone);
    match = await findByPhone(phone);
    /* The payer's surname, or any surname in the household they are billing —
       see nameMatchesHousehold. */
    if (match && !(await nameMatchesHousehold(match.data, match.id, lastName))) match = null;
  } else if (email) {
    await checkRateLimit('email_' + email);
    match = await findByEmail(email);
    if (match && !(await nameMatchesHousehold(match.data, match.id, lastName))) match = null;
  } else {
    throw new HttpsError('invalid-argument', 'No lookup information provided.');
  }

  if (!match) return { found: false };

  const activeToken = await ensureToken(match.id, match.data);
  /* ⚠ MUTATED ONTO match.data BEFORE THE RECORD IS BUILT BELOW. PORTAL_READ_FIELDS is
     copied off that object, so a token minted after the copy reaches the browser as
     undefined and the tab the customer just opened is blank — on their FIRST visit,
     which is the one visit where it is guaranteed to be new. */
  match.data.referralToken = await ensureReferralToken(match.id, match.data);

  /* ---- every house this person has, not just the first one --------------
   *
   * The back end has supported multi-property billing all along: houses are
   * grouped by billToPhone and billed as ONE invoice with a line per address.
   * The portal stopped at the first match, so a customer with a cabin as well
   * as a house saw ONE address and a combined balance covering both, with
   * nothing on screen to explain why the number was bigger than the house
   * they were looking at.
   *
   * Returns the sibling addresses so the portal can name them. Deliberately
   * cheap: one query on the billing key, and only the fields needed to tell
   * the houses apart — nothing here is a second full customer record.
   *
   * ⚠ NAMES, not just addresses. "Who exactly am I paying for this year" is
   * the question, and an address alone does not answer it for a parent paying
   * for two children — see houseBillingRow.
   */
  let houses = [];
  try {
    const billKey = digitsOnly(match.data.billToPhone) || invoiceKeyFor(match.data);
    // The payer's own house first, then anything billed to them.
    houses = await billedHousesByKey(billKey, match.id, match.data);
  } catch (err) {
    // A failed sibling lookup must never stop somebody reaching their account.
    console.error('[HU] multi-house lookup failed', err);
    houses = [];
  }

  return {
    found: true,
    id: match.id,
    token: activeToken,
    deactivated: match.data.rsvpStatus === 'no',
    invoiceKey: invoiceKeyFor(match.data),
    record: sanitizeRecord(match.data),
    // Only sent when there is genuinely more than one — the ordinary
    // single-house customer sees no change at all.
    houses: houses.length > 1 ? houses : []
  };
});

/* ⭐ WHAT THE WAREHOUSE ACTUALLY BUILDS FROM — ONE ANSWER (added 2026-08-21,
   known holes C and D). Owner: "Can you make sure it hits the warehouse that is
   very important."

 * ⚠ THE HOLE: only a COLOUR change ever reached the build queue. A member could
 * change their WIRE COLOUR or their TIMER in their own portal, the record
 * updated, an inbox message went up — and needsLightBuild was never set, so they
 * never appeared in Needs Building. The office side was no better: Edit
 * Customer computed needsLightBuild from lightsDescription alone.
 *
 * ⚠ AND BOTH GENUINELY CHANGE WHAT GETS MADE, which is why this is not cosmetic:
 *   - WIRE IS PART OF THE GROUP KEY. whGroupKey(lightsDescription, wireColor) —
 *     the same pattern on white wire and on green wire are two different
 *     bundles on two different shelves. A bundle already made on the old wire
 *     is simply the wrong bundle.
 *   - THE TIMERS LIST IS DERIVED FROM THE BUILD. whBuildQueueGroups collects
 *     timerHouses while walking the queue, so somebody not IN the queue is not
 *     on the timer list — add a timer after their bundle is finished and no
 *     timer is ever put in it.
 *
 * ⚠ hasOwnProperty ON THE INCOMING OBJECT IS LOAD-BEARING. Every caller here
 * sends a PARTIAL update — the portal's preferences section carries no
 * lightsDescription at all — and reading an absent field as "" would report a
 * cleared pattern on every single save, re-queueing the whole book.
 *
 * ⚠ A BLANK TIMER IS "NO", not a third state. index.html has always compared it
 * as (outletTimer || 'No'), so treating blank and No as different would make an
 * untouched record look changed for ever.
 *
 * ⚠ ONE RULE, TWO COPIES, ASSERTED IDENTICAL — the browser cannot run the
 * server's. run-all.js runs both over the same table of cases and fails if they
 * ever disagree, the money-parity pattern. */
const WAREHOUSE_BUILD_FIELDS = ['lightsDescription', 'wireColor', 'outletTimer'];
/* ⭐ THE SERVER HALF OF "WHEN WAS THIS SENT TO THE WAREHOUSE" (added 2026-08-28).
   Change this and change `stampBuildQueued` in admin.html, in the same push — the
   portal is where a CUSTOMER re-queues their own house by changing colours or coming
   back after a recycle, so a stamp that existed only in the office would leave exactly
   those houses with a queue date of nothing while the office's had one.
   ⚠ ON THE TRANSITION ONLY, for the same reason as the browser copy: portalSave writes
   this flag on saves that change nothing about the build, and re-stamping there would
   reset the wait on a house nobody has touched. */
/* The server half of "when was their old set asked for back". Change this and change
   `stampRecycleRequested` in admin.html in the same push — the portal is where a
   customer cancels or clears their own colours, which is two of the six ways a recycle
   is queued. */
function stampRecycleRequestedServer(updates, wasQueued) {
  if (updates && updates.needsLightRecycle === true && !wasQueued) {
    updates.lightsRecycleRequestedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  return updates;
}

/* ⭐ WHEN THEIR SEASON STATUS CHANGED (added 2026-08-29). Four values are written to
 * `seasonStatus` — a cancellation asked for, an address changed, changes needed, and
 * confirmed — and NOTHING recorded when any of them happened. A search for a date on it
 * across admin.html, functions/index.js and index.html returned nothing at all.
 *
 * ⚠ THE ONE THAT COSTS IS THE CANCELLATION. A customer asking through their own portal to
 * be let out of the season sits in `cancellation_requested` with a crew still notionally
 * coming, and the office queue had no way to sort by how long anybody had waited — a
 * request made in October looked exactly like one made this morning.
 *
 * ⚠ ON THE TRANSITION ONLY, like every other stamp here. portalSave writes this status on
 * saves that did not change it, so re-stamping would reset the clock every time a customer
 * opened their portal and pressed save.
 *
 * ⚠ AND IT KEEPS WHAT IT CHANGED FROM. "Changed on the 4th" cannot say whether they were
 * cancelling or correcting their address, and those two need opposite actions from the
 * office — so the previous value travels with the date.
 */
function stampSeasonStatusServer(updates, wasStatus) {
  if (updates && typeof updates.seasonStatus === 'string' &&
      updates.seasonStatus !== String(wasStatus || '')) {
    updates.seasonStatusAt = admin.firestore.FieldValue.serverTimestamp();
    updates.seasonStatusWas = String(wasStatus || '');
  }
  return updates;
}

function stampBuildQueuedServer(updates, wasQueued) {
  if (updates && updates.needsLightBuild === true && !wasQueued) {
    updates.lightsQueuedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  return updates;
}

function warehouseRebuildFields(oldData, newData) {
  const o = oldData || {}, n = newData || {};
  const norm = function (field, d) {
    const raw = String(d[field] == null ? '' : d[field]).trim().toLowerCase();
    /* Blank means no timer; see above. */
    if (field === 'outletTimer') return raw === 'yes' ? 'yes' : 'no';
    return raw;
  };
  return WAREHOUSE_BUILD_FIELDS.filter(function (f) {
    if (!Object.prototype.hasOwnProperty.call(n, f)) return false;
    return norm(f, n) !== norm(f, o);
  });
}

/* ---- WHAT A CUSTOMER CHANGED IN THEIR OWN PORTAL -------------------------
 *
 * ⭐ THE LAST OF ADDIE'S SIX, AND THE OFFICE HALF WAS ALREADY DONE (added 2026-08-29).
 * Her list ended "or changed timer settings this date. Changed address this date." Both
 * are EDITS rather than stages, and the answer to an edit is a log line rather than a
 * stamp — "Address changed on 3 Oct" is a worse answer than none, because the question is
 * always what it changed FROM. `describeCustomerChanges` in admin.html does exactly that
 * for the office.
 *
 * ⚠ AND IT DID NOTHING AT ALL FOR THE CUSTOMER. The activity log is written only from
 * admin.html, so a timer switched on in Edit Customer produced "Timer: no → yes" and the
 * same switch flicked by the customer in their own portal produced NOTHING — not a stamp,
 * not a line, nothing. The office half looked complete, which is why nobody noticed the
 * other half was missing. Exactly the asymmetry `lightsChangedVia` exists to close one
 * level up, in a new place.
 *
 * ⚠ TWO COPIES, AND THE SCOPE IS WHAT MAKES THEM SAFE. This is the same two-copies
 * problem as the invoice maths, and it gets the same answer: a parity test. What keeps it
 * small is that the portal can only ever write PORTAL_WRITE_FIELDS — sixteen fields — so
 * this table is deliberately that set and no more, and `change-log.test.js` runs both
 * copies over every one of them and fails the moment they disagree about a sentence.
 *
 * ⚠ IT DECIDES NOTHING, like the log it writes into. Nothing anywhere reads these rows
 * back into business logic; they are a record for a person, which is what makes it safe
 * to write from a path that also moves money.
 */
const PORTAL_CHANGE_LABELS = {
  name: 'Name', phone: 'Phone', phone2: 'Second phone',
  email: 'Email', email2: 'Second email', address: 'Address',
  gateCode: 'Gate code', installPreference: 'When they want it hung',
  wireColor: 'Wire colour', outletTimer: 'Timer',
  specificOutlet: { label: 'Specific outlet', kind: 'yesno' },
  specificOutletNotes: 'Which outlet', notes: { label: 'Notes', kind: 'text' },
  lightsDescription: 'Light colours',
  houseSides: { label: 'Sides of the house', kind: 'number' },
  cancellationReason: { label: 'Why they are cancelling', kind: 'text' }
};
/* ⚠ THE ORDER OF THESE FIRST TWO LINES IS THE RULE, and it is written out in the browser
   copy too because it was found by running the diff rather than reading it: an unticked
   box reaches a save as '' while the record stores false — the same answer spelt two ways
   — so with the blank test first, every save of every customer reported a row of tick
   boxes changing. */
function portalChangeValueText(v, kind) {
  if (kind === 'present') return v ? 'saved' : 'none';
  if (kind === 'yesno' || typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v === null || v === undefined || v === '') return '(blank)';
  if (kind === 'money') return '$' + (Number(v) || 0).toFixed(2);
  if (kind === 'list') return Array.isArray(v) ? (v.join(', ') || '(blank)') : String(v);
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '(blank)';
  return s.length > 60 ? s.slice(0, 60) + '\u2026' : s;
}
const PORTAL_CHANGE_EMPTY_TEXTS = ['(blank)', 'no', 'none', '0', '$0.00'];
function describePortalChanges(before, updates) {
  const out = [];
  if (!updates) return out;
  const was = before || {};
  Object.keys(PORTAL_CHANGE_LABELS).forEach(function (f) {
    if (!Object.prototype.hasOwnProperty.call(updates, f)) return;
    const spec = PORTAL_CHANGE_LABELS[f];
    const label = typeof spec === 'string' ? spec : spec.label;
    const kind = typeof spec === 'string' ? '' : spec.kind;
    const a = portalChangeValueText(was[f], kind);
    const b = portalChangeValueText(updates[f], kind);
    if (a === b) return;
    /* ⚠ A FIELD THE RECORD NEVER HELD, arriving at its own default, is not an edit. Every
       record written before a field existed reports "(blank) → no" on the first save that
       touches it, which would put a row of noise on the history of the whole book. */
    if (!Object.prototype.hasOwnProperty.call(was, f) &&
        PORTAL_CHANGE_EMPTY_TEXTS.indexOf(b) !== -1) return;
    out.push(label + ': ' + a + ' \u2192 ' + b);
  });
  return out;
}
/* ⚠ ONE ROW PER SAVE, capped, and SAYING it is capped — the same rule and the same number
   as the office copy, for the same reason: a save is one event, and a row per field turns
   one visit to the portal into a wall nobody scrolls. */
const PORTAL_CHANGE_MAX_FIELDS = 12;
function portalChangeSentence(changes) {
  if (!changes || !changes.length) return '';
  const shown = changes.slice(0, PORTAL_CHANGE_MAX_FIELDS);
  const rest = changes.length - shown.length;
  return 'They changed it themselves in their portal \u2014 ' + shown.join('; ') +
    (rest > 0 ? ' (and ' + rest + ' more)' : '');
}
/* ⚠ IT MUST NEVER BREAK THE SAVE. A note about a change is worth less than the change,
   and this runs on a path that also queues builds and charges a $30 fee. The office copy
   carries the identical guarantee in the identical words. */
async function logPortalChange(custId, changes) {
  const what = portalChangeSentence(changes);
  if (!custId || !what) return null;
  try {
    return await db.collection('activity').add({
      what: what,
      area: 'customers',
      refId: String(custId),
      /* ⚠ NAMED AS THEM, NOT AS A USER. Four people share the dashboard and every other
         row in this log is one of them; a portal edit signed with a staff name would be
         the log actively answering "who changed this" wrongly. */
      who: 'member portal',
      at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('[HU] portal activity log write failed', what, err);
    return null;
  }
}

/* --- portalSave -----------------------------------------------------------
 * Input: { token, section, data }
 *   section = 'info' | 'preferences' | 'lights' | 'cancel'
 * Only the fields listed in PORTAL_WRITE_FIELDS for that section are written.
 */
exports.portalSave = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const token = body.token ? String(body.token).trim() : '';
  const section = String(body.section || '');
  const incoming = body.data || {};

  if (!token) throw new HttpsError('invalid-argument', 'Missing portal token.');
  const allowed = PORTAL_WRITE_FIELDS[section];
  if (!allowed) throw new HttpsError('invalid-argument', 'Unknown save section.');

  const match = await findByToken(token);
  if (!match) throw new HttpsError('not-found', 'Account not found.');

  /* ⚠ BEFORE A SINGLE FIELD IS READ OFF THE REQUEST. Checked here rather than
     after the updates are assembled so there is no version of this function in
     which a held customer's data has been touched at all.
     ⚠ 'cancel' IS EXEMPT BY NAME, not by accident — see arrearsHoldBlocks. */
  if (section !== 'cancel') {
    const held = await arrearsHoldBlocks(match.data);
    if (held) throw arrearsHoldError(held);
  }

  const updates = {};
  allowed.forEach(function (f) {
    if (incoming[f] !== undefined) updates[f] = incoming[f];
  });
  if (Object.keys(updates).length === 0) {
    throw new HttpsError('invalid-argument', 'Nothing to save.');
  }

  // Normalise phone fields so lookups keep working.
  if (updates.phone !== undefined) updates.phone = digitsOnly(updates.phone);
  if (updates.phone2 !== undefined) updates.phone2 = digitsOnly(updates.phone2);

  const oldData = match.data;
  const oldPhone = digitsOnly(oldData.phone);
  const oldKey = invoiceKeyFor(oldData);
  let addressChanged = false;

  if (section === 'info') {
    addressChanged = !!(oldData.address && updates.address &&
                        updates.address !== oldData.address);
    updates.seasonStatus = addressChanged ? 'address_changed' : 'needs_changes';
  }

  /* ⭐ CHANGING WHICH SIDES CHANGES THE PRICE.
     Owner, 2026-08-18: "if it says how many sides it should say you will be
     requoted and have them okay or cancel".

     The customer is warned in the portal before they save, but a warning
     nobody acts on is theatre — so the record is FLAGGED here, which is what
     puts them in front of the office. Same shape as the other portal signals:
     a field on the record that a list in admin reads.

     ⚠ VALIDATED, not trusted. This arrives from a browser, so it is reduced to
     the four keys the app knows; anything else is dropped rather than stored.
     A free-text array here would end up on a crew card. */
  if (section === 'sides') {
    /* ⭐ A COUNT, NOT FOUR NAMES. Owner, 2026-08-19: "we need it to say 1, 2, 3, or 4
       sides of the house so then it can just be connected and we dont have to guess if
       its the left or right side." Her sheet has said "2 sides" for years; asking the
       member WHICH two invented a fact nobody ever recorded.

       ⚠ STILL VALIDATED SERVER-SIDE, and for the same reason as before: this arrives
       from a browser. A count is narrower than a list of keys, not looser — anything
       that is not 1 to 4 becomes 0, which reads as "not recorded".

       ⚠ THE OLD SHAPE STILL COUNTS. Members saved before today hold an array of side
       names, and three names is three sides. Rejecting it would tell a member with a
       full record that nothing is on file. */
    /* ⭐ ONE SIDE IS THE DEFAULT. The same floor as houseSideCount in admin.html
       and portalSideCount in index.html, and it MUST match them: this value is one
       half of `updates.houseSides !== before`, which raises a re-quote. A default on
       one side of that and a zero on the other sends a re-quote to every customer
       whose sides were never written down, for a change nobody made. */
    const asCount = function (v) {
      if (Array.isArray(v)) {
        const listed = Math.min(4, v.filter(Boolean).length);
        return listed || 1;
      }
      const n = Number(String(v == null ? '' : v).replace(/[^0-9]/g, ''));
      return (n >= 1 && n <= 4) ? n : 1;
    };
    updates.houseSides = asCount(updates.houseSides);
    /* ⚠ NO "needs re-quote" FLAG. Owner, 2026-08-18: "we shouldnt need a flag
       that says needs requote the customer should just appear in the requote
       section." The quote the portal opens IS the record of it — a second flag
       saying the same thing is a second thing to keep in step, and the one that
       goes stale is the one nobody is looking at. */
    const before = asCount(oldData.houseSides);
    if (updates.houseSides !== before) {
      updates.seasonStatus = 'needs_changes';
    }
  }

  if (section === 'cancel') {
    updates.seasonStatus = 'cancellation_requested';
    /* Without this, a customer who cancels through this dedicated Cancel tab
       never appears in the Warehouse Recycle queue (which keys strictly off
       needsLightRecycle) — their bin/customer number stays locked to an
       inactive account until someone separately notices the
       "Cancellation Requested" pill and flips RSVP to No by hand in Edit
       Customer. RSVP "no" already sets this; a full cancellation request is
       at least as strong a signal and had fallen through the same gap. */
    updates.needsLightRecycle = true;
  }

  /* A colour change means a new pattern to build. Flagging it here sends the
     customer straight to the Warehouse queue, the same way an admin-side change
     does. The queue is a live view of this flag, so changing colours twice just
     moves them between patterns — it can never queue the same house twice. */
  /* ⭐ WIRE AND TIMER REACH THE WAREHOUSE TOO (holes C and D). Deliberately
     ABOVE the lights block and written with |=, never =: it may only ever turn
     the queue flag ON. The lights block below has its own careful rule about
     when a build is owed — including that blank colours mean the build cannot
     be DONE yet, not that it is not owed — and this must not overwrite it. */
  {
    const rebuild = warehouseRebuildFields(oldData, updates);
    if (rebuild.length) updates.needsLightBuild = true;
  }
  if (section === 'lights' && updates.lightsDescription !== undefined) {
    const changed = updates.lightsDescription !== (oldData.lightsDescription || '');
    if (!updates.lightsDescription) {
      updates.needsLightBuild = false;      // colours cleared — nothing to build
    } else if (changed) {
      updates.needsLightBuild = true;       // genuinely different pattern
      /* ⭐ AND IT IS A COLOUR CHANGE, which is not the same fact. needsLightBuild is
         the WAREHOUSE queue and a brand-new customer sets it too, so the Color Changes
         sheet cannot read it - it swept up twelve ordinary new customers. This marks
         the people who HAD colours and picked different ones. Colours recorded for the
         first time are not a change. */
      if (oldData.lightsDescription) {
        updates.lightsChangedAt = admin.firestore.FieldValue.serverTimestamp();
        /* ⭐ WHO CHANGED IT (added 2026-08-24). Addie wants the warehouse queue to say
           WHY a bundle is being built, and two of her four answers — "Member Portal"
           and "Request" — are the same event with a different origin: the customer
           doing it themselves, or the office typing it in after a call, email or text.
           Nothing recorded which, so the two could not be told apart. This is the
           portal; admin.html stamps 'office' on its own save. */
        updates.lightsChangedVia = 'portal';
      }
    }
    // Unchanged? Leave the flag alone. Opening the Lights tab and pressing Save
    // must not re-queue a house Dad has already built.
  }
  /* ⚠ ONE CALL, AFTER BOTH BRANCHES ABOVE — the wire/timer re-queue and the colour
     change. The lights block can also set the flag FALSE (colours cleared), and this
     only ever stamps a true, so it is safe below both. */
  stampBuildQueuedServer(updates, !!oldData.needsLightBuild);
  /* Clearing your own colours in the portal queues a recycle — one of the six ways. */
  stampRecycleRequestedServer(updates, !!oldData.needsLightRecycle);
  /* ⚠ AFTER every branch that can set the status — the info save, the sides change and
     the cancel section all write it, so a stamp beside any one of them would miss the
     other two. That is the placement lesson the build stamp already cost: it shipped
     inside one branch and recorded nothing for every other way in. */
  stampSeasonStatusServer(updates, oldData.seasonStatus);

  // Keep the normalised sign-in fields in step with whatever just changed —
  // see contactIndexFields. Without this a customer who edits their own phone
  // or email through the portal drops back to the full-collection scan.
  /* ⚠ TAKEN BEFORE THE WRITE, LOGGED AFTER IT. The diff needs the record as it was, and
     `oldData` is exactly that — but a line saying what changed, written before a save
     that then fails, is the log claiming something happened that did not. So the
     sentence is built here and posted below, once the write has actually landed. */
  const portalChanges = describePortalChanges(oldData, updates);
  Object.assign(updates, contactIndexFields(updates));
  await db.collection('jobAddresses').doc(match.id).update(updates);
  /* ⚠ IT CANNOT BREAK THE SAVE — logPortalChange swallows its own failure, because a
     note about a change is worth less than the change, and this path also queues
     builds and charges a $30 fee. */
  await logPortalChange(match.id, portalChanges);

  /* A cancellation request means this customer is sitting out, same as an
     RSVP "no" or "back next year" — so it has to pull them off any route a
     crew has already been handed, or the crew still turns up. */
  if (section === 'cancel') {
    await removeCustomerFromUpcomingRoutes(match.id);
  }

  /* ⭐ THE LIGHTS TAB — one rule, and the $30 that now actually lands.
     Rewritten 2026-08-21. Read applyLightChange in js/money.js for the rule
     itself and the owner's words; this is only the plumbing around it.

     ⚠ THE FEE WAS NEVER BEING CHARGED AT ALL, and that is what this rewrite
     fixes first. Since 2026-08-19 this block ended with
     `updates.chargeNewMemberFee = true` — but `updates` is written to Firestore
     SIXTY-THREE LINES EARLIER, so the flag was set on an object nobody saved
     again. It is not in PORTAL_READ_FIELDS either, so it never even reached the
     browser. The only customer write left in this block set the lock and the
     reassign flags and no fee. So every colour change a member made in their
     own portal charged NOTHING, while the portal told them in red that "$30 was
     added to your balance". Everything is written inside the transaction now,
     which is the only place a decision and its write cannot drift apart.

     ⚠ THE WINDOW IS READ FROM THE CUSTOMER, not from the invoice's
     lastLightChangeFeeAt. A brand new customer's window has to exist before any
     invoice does. Existing records carry lightsLockedUntil already — the old
     code set it at the same moment it stamped lastLightChangeFeeAt — so nobody
     mid-window loses it in the changeover. lastLightChangeFeeAt is still
     stamped, because portalInvoice hands it to the portal as
     lightChangeFreeUntil, but it no longer decides anything. */
  let lightFeeInfo = null;
  if (section === 'lights' && updates.lightsDescription !== undefined) {
    const nowMs = Date.now();
    let decision = null;
    try {
      const custRef = db.collection('jobAddresses').doc(match.id);
      const invRef = oldKey ? db.collection('invoices').doc(oldKey) : null;
      /* Read-decide-write, all inside one transaction. Two near-simultaneous
         portalSave('lights', ...) calls (a client-side retry, or a double
         form-submit before the Save button's disabled state takes effect) could
         otherwise both read the same pre-charge changeFees and each add $30,
         double-charging one intended change. recordPaypalPayment guards the
         same class of race for payments.

         ⚠ A customer with no phone AND no email has no invoice document, so
         there is nothing to charge — but they must still be LOCKED off the
         routes while their pattern may move. That is why the invoice is
         optional here and the customer write is not. */
      await db.runTransaction(async (t) => {
        /* Reset per attempt. Firestore retries a contended transaction, and a
           decision carried over from an abandoned attempt would be charged
           against a balance that has since moved. */
        decision = null;
        const custSnap = await t.get(custRef);
        const invSnap = invRef ? await t.get(invRef) : null;
        const cust = (custSnap.exists ? custSnap.data() : null) || oldData;
        const inv = (invSnap && invSnap.exists) ? invSnap.data() : {};

        const d = applyLightChangeServer({
          oldLights: oldData.lightsDescription,
          newLights: updates.lightsDescription,
          lockedUntil: toMillis(cust.lightsLockedUntil),
          invoiceSent: !!cust.invoiceEmailSent,
          scheduled: !!oldData.scheduled,
          nowMs: nowMs
        });
        decision = d;

        const custWrite = {};
        if (d.lightsLockedUntil) {
          custWrite.lightsLockedUntil = admin.firestore.Timestamp.fromMillis(d.lightsLockedUntil);
        }
        if (d.setLightsChangedAt) {
          custWrite.lightsChangedAt = admin.firestore.FieldValue.serverTimestamp();
          /* Same stamp, the other portal write path — see the note above. Both have to
             set it or a change made through one door is unattributable. */
          custWrite.lightsChangedVia = 'portal';
        }
        if (d.feeAmount > 0 && d.feeDestination === 'nextSeason') {
          /* ⭐ THE BILL HAS ALREADY GONE, SO THIS RIDES TO NEXT SEASON. Owner:
             "if invoice has already been sent out but they change there lights
             after invoice is sent out than the 30 dollars will be charged for
             next season."

             ⚠ IT HAS TO LIVE ON THE CUSTOMER, NOT THE INVOICE. Start New Season
             wipes changeFees, changeFeeNotes and lastLightChangeFeeAt on every
             invoice, so a charge parked there is deleted rather than carried.
             It touches only completed / invoiceEmailSent / scheduled /
             scheduledDate / assignedCrew on the customer, which is exactly why
             carryoverCredit already lives there and survives. This is that same
             mechanism pointing the other way, and runInvoiceBatch folds it into
             next season's invoice the night their lights go back up. */
          custWrite.carryoverCharge = (Number(cust.carryoverCharge) || 0) + d.feeAmount;
          custWrite.carryoverChargeNotes =
            (Array.isArray(cust.carryoverChargeNotes) ? cust.carryoverChargeNotes : [])
              .concat([{ amount: d.feeAmount, reason: d.feeReason,
                         date: new Date(nowMs).toISOString() }]);
        }
        if (Object.keys(custWrite).length) t.set(custRef, custWrite, { merge: true });

        if (invRef) {
          const invWrite = { lightsDescription: updates.lightsDescription };
          if (d.feeAmount > 0 && d.feeDestination === 'invoice') {
            /* Its own line on the invoice, which is what changeFees has always
               been for — and it is SEPARATE from the $30 new-member fee, which
               the nightly run folds into `install`. A new member who changes
               colours outside their window pays both. Owner: "new member fee and
               change light fees are seperate ... which would put them at 6[0]
               dollars." */
            invWrite.changeFees = (Number(inv.changeFees) || 0) + d.feeAmount;
            invWrite.changeFeeNotes =
              (Array.isArray(inv.changeFeeNotes) ? inv.changeFeeNotes : [])
                .concat([{ amount: d.feeAmount, reason: d.feeReason,
                           date: new Date(nowMs).toISOString() }]);
          }
          if (d.feeAmount > 0) {
            invWrite.lastLightChangeFeeAt = admin.firestore.Timestamp.fromMillis(nowMs);
            invWrite.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          }
          t.set(invRef, invWrite, { merge: true });
        }
      });

      if (decision && decision.isChange) {
        lightFeeInfo = {
          feeCharged: decision.feeAmount > 0,
          amount: decision.feeAmount,
          /* The portal must not say "added to your balance" for a charge that
             is going onto next year's bill — see showLightsFeeNote. */
          chargedToNextSeason: decision.feeDestination === 'nextSeason',
          freeWindowEndsAt: decision.windowEndsAt
        };
      }

      /* They are already on a route, so the crew is holding a card that no
         longer matches the house. Outside the transaction on purpose: the money
         is already safely written, and a failed note must never roll it back. */
      if (decision && decision.raiseReassignNote) {
        try {
          await db.collection('jobAddresses').doc(match.id).update({
            lightsChangedAfterAssign: true,
            lightsChangedAfterAssignAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { console.error('[HU] reassign flag failed:', e); }
        try {
          await db.collection('messages').add({
            topic: 'Lights Changed After Assignment', folder: 'System',
            name: oldData.name || '', phone: oldData.phone || '', email: oldData.email || '',
            contactMethod: '',
            message: (oldData.name || 'A customer') + ' changed their lights to "' + updates.lightsDescription +
                     '" after being assigned to an install route. Remove them from that route and add them back once their 48-hour change window closes.',
            autoQueuedToWarehouse: false,
            needsReassign: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { console.error('[HU] reassign flag message failed:', e); }
      }
    } catch (err) {
      console.error('[HU] invoice lights/fee sync failed:', err);
    }
  }

  // The Info tab also keeps the customer's invoice record in sync. This write
  // used to fail silently from the browser because invoices are staff-only.
  // Invoices are keyed by phone digits, or by lowercase email when the
  // customer has no phone. If this save changes the key (phone added/changed,
  // or an email-only customer changes their email) the invoice doc moves.
  if (section === 'info' && oldKey) {
    const invoiceUpdates = {
      name: updates.name !== undefined ? updates.name : oldData.name,
      phone: updates.phone !== undefined ? updates.phone : oldPhone,
      email: updates.email !== undefined ? updates.email : oldData.email
    };
    /* Both writes below can CREATE an invoice document, and they only carry
       name/phone/email. A document with no amounts on it is not harmless: the
       portal read the fields straight back and printed the customer's balance
       as the literal text "$NaN", because `undefined + undefined` is NaN. Any
       document this function brings into existence gets numeric zeros.
       Applied ONLY when the destination does not already exist — merging these
       over a real invoice would zero somebody's balance, which is far worse
       than the bug being fixed. */
    const BLANK_AMOUNTS = { install: 0, removal: 0, deposit: 0, credits: 0, changeFees: 0 };
    try {
      const newKey = invoiceKeyFor(Object.assign({}, oldData, updates));
      if (newKey && newKey !== oldKey) {
        const oldInvSnap = await db.collection('invoices').doc(oldKey).get();
        const carried = oldInvSnap.exists ? oldInvSnap.data() : {};
        const destRef = db.collection('invoices').doc(newKey);
        const destExists = (await destRef.get()).exists;
        await destRef.set(
          destExists
            ? Object.assign({}, carried, invoiceUpdates)
            : Object.assign({}, BLANK_AMOUNTS, carried, invoiceUpdates),
          { merge: true }
        );
        await db.collection('invoices').doc(oldKey).delete();
      } else if (oldKey) {
        const ref = db.collection('invoices').doc(oldKey);
        const exists = (await ref.get()).exists;
        await ref.set(
          exists ? invoiceUpdates : Object.assign({}, BLANK_AMOUNTS, invoiceUpdates),
          { merge: true }
        );
      }
    } catch (err) {
      console.error('[HU] invoice sync failed:', err);
    }
  }

  // Push the corrected details into any UPCOMING saved route this customer is on.
  // The browser-only resyncSavedRouteStops can't run here, so without this a
  // customer's portal gate-code or address fix never reaches a crew that's
  // already been scheduled. Past routes are left alone as history.
  if (section === 'info') {
    try {
      const fields = {};
      ['name', 'phone', 'address', 'gateCode'].forEach(function (f) {
        if (updates[f] !== undefined) fields[f] = updates[f];
      });
      if (Object.keys(fields).length) {
        const todayStr = todayStrInDenver();
        const routesSnap = await db.collection('scheduledRoutes').get();
        for (const rDoc of routesSnap.docs) {
          const rd = rDoc.data();
          if ((rd.date || '') < todayStr) continue;          // leave past routes as-is
          const stops = Array.isArray(rd.stops) ? rd.stops : [];
          let touched = false;
          const newStops = stops.map(function (s) {
            if (s && s.id === match.id) { touched = true; return Object.assign({}, s, fields); }
            return s;
          });
          if (touched) await rDoc.ref.update({ stops: newStops });
        }
      }
    } catch (err) {
      console.error('[HU] portal route resync failed:', err);
    }
  }

  return {
    ok: true,
    addressChanged: addressChanged,
    lightFee: lightFeeInfo,
    record: sanitizeRecord(Object.assign({}, oldData, updates))
  };
});

/* --- portalRsvp -----------------------------------------------------------
 * Input: { token, response }  where response = 'yes' | 'no' | 'backnextyear'
 *
 * The recycle flag is decided here, on the server, so it can't drift:
 * ONLY a flat "no" marks lights for recycling. "backnextyear" never does.
 *
 * Saying no and needing lights pulled back into stock are two different
 * things: the first is a lasting fact, the second is a job that gets finished.
 * The warehouse clears needsLightRecycle as it takes a bundle apart and hands
 * the customer number back to the available pool, so a record still reading
 * "no" with the flag already false is the ONE signal that the recycle actually
 * happened. Someone rejoining at that point has no lights and no number, and
 * without the branch below they would look like an ordinary yes, get routed,
 * and the crew would arrive to nothing.
 */
/* ⭐ WHAT CHANGES WHEN SOMEBODY SAYS YES TO THIS SEASON, wherever the yes came from
   (2026-08-22). Three routes now produce one: the RSVP link, the office dropdown, and
   approving a quote. A yes that only sets the status is not a yes — it leaves the
   warehouse still queued to take their bundle apart and the planner with no reason to
   give them a day.

   ⚠ CANCELLING THE RECYCLE IS THE HALF THAT IS EASY TO FORGET, and this file's own
   history says so: the note against the old quote-approval guard warned that flipping
   somebody to yes "leaves needsLightRecycle set behind them — the record then says two
   opposite things at once." That is why it is here rather than at each call site.

   ⚠ AND A REBUILD ONLY WHEN THE RECYCLE ACTUALLY HAPPENED. `needsLightRecycle` still
   standing means the warehouse has not been near their bin — the set is where they
   left it, and queueing a build makes a SECOND one for a house that already has one.
   Cleared means it is gone, and putting them on a route without rebuilding sends a
   crew to an empty bin. Owner, 2026-08-22: "we won't recycle till end of year so
   shouldn't be taken apart."

   ⭐ AND IT CLEARS maybeNextYear (changed 2026-08-22). Owner: "we shouldn't have to
   clear a badge to get someone updated. That badge should update once they approve it."

   ⚠ THIS REVERSES THE LINE THAT WAS HERE, which said the badge was the office's alone
   and clearing it from a customer's click overruled an office decision silently. The
   argument was not wrong — it was answering the wrong question. The badge does not
   record an opinion the office holds ABOUT them; it records what they said, and the
   office set it because that is what they had been told at the time. A newer answer
   from the customer themselves supersedes an older one taken on their behalf, and
   leaving it standing meant a customer who had actively re-committed sat out of the
   season until somebody noticed and clicked something.

   ⚠ maybeNextYearAt GOES WITH IT. It is the date the badge was raised; left behind, a
   customer reads as not-sitting-out with a date stamped for when they were. Same rule
   as the office's own un-toggle, which clears it in the same write. */
/* ⭐ DID THEIR OLD SET ACTUALLY COME BACK (added 2026-09-03).
 * Addie: "it should only be sent to warehouse if there is any sort of change from last
 * year. If nothing changes than nothing is affected."
 *
 * ⚠ THE RULE INFERRED A RECYCLE FROM THE ABSENCE OF A FLAG. The comment above this
 * function said a record still reading no with needsLightRecycle already false "is the
 * ONE signal that the recycle actually happened" — and it is not. The flag is equally
 * clear when nobody ever queued one, which is the ordinary case for somebody marked no
 * by hand or by an import; confirming them then built a second bundle for a house whose
 * first is still on the shelf.
 *
 * ⭐ `lightsRecycledAt` IS THE POSITIVE SIGNAL and did not exist when this was written.
 * Every path that COMPLETES a recycle stamps it; a plain no removes the record entirely,
 * so nobody rejoins down that road.
 *
 * ⚠ ONE RULE, TWO FILES. `rejoinNeedsBuild` in admin.html is the twin, and
 * rejoin-build.test.js runs both over the same states and fails the build the moment
 * they disagree. Whether somebody said yes is the CALLER's question — this answers only
 * whether their glass is gone. The strict direction and its cost are argued in full
 * beside the browser copy; do not soften one without the other. */
function rejoinNeedsBuildServer(oldData) {
  const d = oldData || {};
  if (String(d.rsvpStatus || '').trim().toLowerCase() !== 'no') return false;
  /* Still queued: the warehouse has not been near their bin. */
  if (d.needsLightRecycle) return false;
  return !!d.lightsRecycledAt;
}
function seasonYesUpdates(oldData, ts) {
  const d = oldData || {};
  const was = String(d.rsvpStatus || '').trim().toLowerCase();
  const wasOut = was === 'no' || was === 'backnextyear' || d.maybeNextYear === true;
  const updates = {
    rsvpStatus: 'yes',
    rsvpRespondedAt: ts(),
    /* A yes CANCELS the collection their no created — see hole G in portalRsvp for why
       back next year must not, and why this is spelled out per answer. */
    needsLightRecycle: false,
    /* An RSVP answer is them telling us what they want, so the "ask them" flag closes. */
    askSameAsLastYear: false,
    /* ⚠ UNCONDITIONALLY, and that reverses a narrower version of this written an hour
       earlier which only wrote it when a badge was already set. A parallel session
       proved the narrow one wrong from the other end: the RSVP reset sweep leaves
       maybeNextYear standing while moving everyone to 'unanswered', so the flag and
       the status drift apart and "is there a badge to clear" stops being answerable
       from this record alone. Two fields describing one fact are written together,
       everywhere, on every answer. */
    maybeNextYear: false,
    maybeNextYearAt: null
  };
  if (rejoinNeedsBuildServer(d)) updates.needsLightBuild = true;
  stampBuildQueuedServer(updates, !!d.needsLightBuild);
  if (wasOut) {
    /* Two fields, two jobs. The first is an instruction the planner consumes — put
       this person on the next day going — and the second is the record the office
       reads, which has to outlive it or the badge disappears the moment it does any
       good. See cameBackThisSeason in admin.html. */
    updates.needsDayAssignedAt = ts();
    updates.cameBackThisSeasonAt = ts();
  }
  return updates;
}
exports.portalRsvp = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const token = body.token ? String(body.token).trim() : '';
  const response = String(body.response || '').toLowerCase();

  if (!token) throw new HttpsError('invalid-argument', 'Missing portal token.');
  if (['yes', 'no', 'backnextyear'].indexOf(response) === -1) {
    throw new HttpsError('invalid-argument', 'Unknown RSVP response.');
  }

  const match = await findByToken(token);
  if (!match) throw new HttpsError('not-found', 'Account not found.');

  const oldData = match.data || {};
  /* ⚠ THROUGH THE SHARED RULE (2026-09-03). A clear flag is not proof the bundle was
     pulled apart — it is equally clear when no recycle was ever queued. See
     rejoinNeedsBuildServer, which asks the status itself, so the `wasNo` that used to
     sit here went with the inference it existed for. */
  const rejoinedAfterRecycle = response === 'yes' && rejoinNeedsBuildServer(oldData);

  /* ⭐ ONE ANSWER FOR A YES, THREE DOORS (2026-08-22). See seasonYesUpdates: the RSVP
     link, the office dropdown and approving a quote all mean the same thing. A no or a
     back next year is still answered here, because those two are only ever said
     through this door — and they are NOT symmetrical with a yes, which is why the
     branch below is spelled out answer by answer rather than shared. */
  const updates = (response === 'yes')
    ? seasonYesUpdates(oldData, () => admin.firestore.FieldValue.serverTimestamp())
    : {
        rsvpStatus: response,
        /* ⚠ THE QUESTION HAS A WAY OUT. askSameAsLastYear is set when somebody
           declines a re-quote and means "ask them what they want"; an RSVP answer IS
           them telling us, so it closes. Without this they stay on the list for ever
           and the office mails them again after they have already replied. */
        askSameAsLastYear: false,
        rsvpRespondedAt: admin.firestore.FieldValue.serverTimestamp()
      };
  if (response !== 'yes') {
    /* ⭐ maybeNextYear MUST NOT OUTLIVE THE ANSWER THAT SET IT. Owner, tracing it
       herself: "so if they click back next year then no than that person will be put
       in recycle and in 2027?" Yes, and worse — the flag was sticky. Exactly one thing
       in the codebase ever cleared it (the office badge toggle) while rsvpStatus moved
       freely. Two fields describing one fact, so they are written together. */
    if (response === 'backnextyear') {
      updates.maybeNextYear = true;
      updates.maybeNextYearAt = admin.firestore.FieldValue.serverTimestamp();
    } else {
      updates.maybeNextYear = false;
      updates.maybeNextYearAt = null;
    }
    /* ⚠ AND THE RECYCLE IS HOLE G'S FIFTH PATH. This used to be
       `needsLightRecycle: response === 'no'`, which reads as harmless and quietly
       writes FALSE for backnextyear — wiping a collection that was already owed, so
       the bin stays on the shelf and nobody is ever told to fetch it. Written only for
       the answer that genuinely creates one. A yes CANCELS one, and that lives in
       seasonYesUpdates with the rest of what a yes means. */
    if (response === 'no') updates.needsLightRecycle = true;
  }
  if (rejoinedAfterRecycle) updates.needsLightBuild = true;
  /* ⚠ `oldData` HERE, NOT `d` — this is portalRsvp, not seasonYesUpdates, and the two
     name the same record differently. Written as `d` it parses perfectly and throws a
     ReferenceError on the first customer who answers their RSVP. */
  stampBuildQueuedServer(updates, !!oldData.needsLightBuild);
  stampRecycleRequestedServer(updates, !!oldData.needsLightRecycle);

  // Keep the normalised sign-in fields in step with whatever just changed —
  // see contactIndexFields. Without this a customer who edits their own phone
  // or email through the portal drops back to the full-collection scan.
  Object.assign(updates, contactIndexFields(updates));
  await db.collection('jobAddresses').doc(match.id).update(updates);

  /* ⭐ AND A NO TAKES BACK THE REFERRAL THAT BROUGHT THEM IN (2026-09-03). See
     clawBackReferralServer, which holds both of Addie's rules about when it may not.
     ⚠ 'no' ONLY, NEVER 'backnextyear': coming back next season is not a cancellation,
     and the referral stands. ⚠ AND ON THE TRANSITION, the same shape the recycle flag
     above uses — re-answering no would otherwise raise the Inbox note again every time,
     even though the entry is already revoked and cannot be taken twice.
     ⚠ IT IS PASSED THE RECORD AS IT NOW IS: `completed` decides whether the credit was
     earned, and oldData on its own is one write out of date by this line. */
  if (response === 'no' && String(oldData.rsvpStatus || '') !== 'no') {
    await clawBackReferralServer(match.id, Object.assign({}, oldData, updates));
  }

  /* No customer number is assigned here on purpose. Taking one from the pool
     programmatically could collide with one the office has just written on a
     bin by hand, so the office decides — this note is how they find out. */
  if (rejoinedAfterRecycle) {
    try {
      await db.collection('messages').add({
        topic: 'Rejoined After Recycling', folder: 'System',
        name: oldData.name || '', phone: oldData.phone || '', email: oldData.email || '',
        contactMethod: '',
        message: (oldData.name || 'A customer') + ' said no earlier this season, so their lights were ' +
                 'recycled and their customer number went back to the available pool. They have now ' +
                 'said yes again. Their lights need building again — they are in the Warehouse ' +
                 'build queue — and they need a customer number assigned before they go on a route.',
        autoQueuedToWarehouse: false,
        needsReassign: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { console.error('[HU] rejoin-after-recycle message failed:', e); }
  }

  /* A "no" or "back next year" answered through the portal means this
     customer is sitting the season out, exactly like the office's own Maybe
     Next Year toggle (setCustomerSeason in admin.html) - so it has to pull
     them off any route a crew has already been handed the same way that
     toggle does. Without this, someone who declines by email after their
     route is built still gets a crew show up to install lights they said no
     to. This used to only happen for the admin-triggered "maybe next year"
     path (pullCustomerFromSeason); a self-service "no"/"back next year"
     through the RSVP link fell through the gap entirely. */
  let removedFrom = 0;
  if (response === 'no' || response === 'backnextyear') {
    removedFrom = await removeCustomerFromUpcomingRoutes(match.id);
  }

  /* ⚠ THE GATE CODE RIDES BACK ON THE RSVP ANSWER, and only here. It is in
     PORTAL_READ_FIELDS already, but this screen is reached with no sign-in —
     so it is returned as the value for THIS token, which the write above has
     just proved belongs to this one record. Nothing else about the customer
     comes back. It is what lets the next step say "we have 4417 on file, is
     that still right?" instead of asking a customer who already told us. */
  /* ⭐ A YES IS NOT A PAYMENT, AND THE PAGE HAS TO BE ABLE TO SAY SO (2026-09-01).
     RS-24 holds a customer who owes for last season out of the season even when they
     answer Yes — but the RSVP confirmation told them "We'll get you scheduled!", which
     is a promise this app will not keep for exactly the people it is not keeping it
     for. They would have found out in December, looking at a dark house.

     ⚠ THIS IS NOT MON-34's AUTOMATIC CHASE, and the line matters. Nothing is SENT:
     no email, no text, no note. It is one honest sentence on a screen the customer is
     already looking at, in answer to a button they just pressed — and MON-34's own
     reasoning already rests on them being able to "see and pay it in their portal".

     ⚠ THE BILL THE HOUSE IS ON, NEVER THE HOUSE'S OWN KEY, which is RS-24's rule
     verbatim: if Dana pays for Kyle and Dana did not pay, Kyle's lights were not paid
     for either. Reading Kyle's own key finds no invoice and tells him he is clear.

     ⚠ AND IT FAILS TOWARDS SILENCE, which is the opposite direction to the season
     hold and is deliberate. An unreadable invoice there keeps somebody IN the season;
     here it must not tell a customer they owe money we cannot prove they owe. Being
     wrongly accused of a debt is worse than not being warned about a real one, and the
     office still has Schedule › Owes from last year either way. */
  const owed = response === 'yes' ? await arrearsForCustomer(oldData) : { outstanding: 0, season: '' };

  return { ok: true, rsvpStatus: response,
           rejoinedAfterRecycle: rejoinedAfterRecycle,
           removedFromRoutes: removedFrom,
           arrearsOutstanding: owed.outstanding,
           arrearsSeason: owed.season,
           gateCode: String(oldData.gateCode || '') };
});

/* ⭐ ONE FIELD, WRITTEN FROM THE RSVP CONFIRMATION (added 2026-08-31).
 * Addie: "Lets do gate code before changes." The RSVP is the one email every
 * customer opens and acts on, so it is the cheapest chance each season to
 * catch a wrong gate code before a crew is standing at a locked gate.
 *
 * ⚠ WHY THIS IS NOT portalSave. `gateCode` is already in PORTAL_WRITE_FIELDS
 * under the `info` section, so reusing it looks like the obvious move and is
 * WRONG: that section ends with
 *     updates.seasonStatus = addressChanged ? 'address_changed' : 'needs_changes';
 * which is the RE-QUOTE state. It is resolved by answering a quote, and no
 * quote exists here — so every customer who typed a gate code during their
 * RSVP would be parked in Needs Changes for ever, waiting on a question
 * nobody asked. A gate code is not a change to the job.
 *
 * ⚠ SAME TRUST MODEL AS portalRsvp: a valid portalToken IS the credential,
 * there is no separate login, and the token is looked up the same way. It
 * writes exactly one field and returns nothing about the customer.
 *
 * ⚠ AND IT IS DELIBERATELY NOT FOLDED INTO portalRsvp. They are two questions
 * asked at two different moments — the answer is saved the instant it is
 * given, and somebody who says "no gate code" never calls this at all, so a
 * combined write would have to invent a value for them.
 */
exports.portalSetGateCode = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const token = body.token ? String(body.token).trim() : '';
  /* 60 characters, the same ceiling the office form uses (see the details
     writer above), so the two cannot disagree about what fits. */
  const gateCode = String(body.gateCode || '').trim().slice(0, 60);

  if (!token) throw new HttpsError('invalid-argument', 'Missing portal token.');

  const match = await findByToken(token);
  /* Throws, like every other portal callable, so index.html's shared
     portalCallFailedText tells them the link may be out of date rather than
     that something went wrong. */
  if (!match) throw new HttpsError('not-found', 'Account not found.');

  await db.collection('jobAddresses').doc(match.id).update({
    gateCode: gateCode,
    gateCodeUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true, gateCode: gateCode };
});

/* The one place that strips a customer out of any route a crew has already
   been handed for today or later. Past routes stay exactly as they are -
   they are history, and rewriting them would change what the crew actually
   did. Shared by every path that can put a customer on "not this season":
   the admin Maybe Next Year toggle, the portal's own RSVP no/back-next-year
   answer, and quoteRespond's maybe-next-year handling for an existing
   customer. */
async function removeCustomerFromUpcomingRoutes(customerId) {
  let removedFrom = 0;
  try {
    const todayStr = todayStrInDenver();
    const routesSnap = await db.collection('scheduledRoutes').get();
    for (const rDoc of routesSnap.docs) {
      const rd = rDoc.data();
      if ((rd.date || '') < todayStr) continue;
      const stops = Array.isArray(rd.stops) ? rd.stops : [];
      const kept = stops.filter(function (s) { return !s || s.id !== customerId; });
      if (kept.length !== stops.length) {
        await rDoc.ref.update({ stops: kept });
        removedFrom++;
      }
    }
  } catch (err) {
    console.error('[HU] upcoming-route removal failed:', err);
  }
  return removedFrom;
}

/* Sitting a customer out for a season via the admin-triggered Maybe Next Year
   path (quoteRespond's maybe_next_year handling for an existing customer).
   Deliberately touches no money: not coming back next year is not the same as
   not owing for last year. */
async function pullCustomerFromSeason(customerId) {
  await db.collection('jobAddresses').doc(customerId).update({
    maybeNextYear: true,
    maybeNextYearAt: admin.firestore.FieldValue.serverTimestamp(),
    rsvpStatus: 'backnextyear',
    rsvpRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
    /* ⭐ BACK NEXT YEAR NEITHER CREATES A RECYCLE NOR DESTROYS ONE (hole G,
     fixed 2026-08-21). Owner, asked what happens to their bin: keep it made up.

     ⚠ SO THIS MUST NOT WRITE needsLightRecycle AT ALL. It used to write FALSE
     unconditionally, which is not the same thing as "do not create one" — it
     silently CANCELLED a recycle that was already owed. The way in: somebody
     answers no (the recycle is set, the warehouse is queued to collect their
     bin), then changes to Back Next Year. The flag is wiped, the bin stays on
     the shelf, and nobody is ever told to collect it — a set of lights lost for
     a year with nothing on any screen to say why.

     Leaving the field alone gets both cases right: an owed collection still
     happens, and a customer whose bin is intact keeps it made up for next
     season, which is what was asked for. needsLightBuild IS still cleared —
     you do not build a set for somebody sitting the season out. */
    needsLightBuild: false,
    scheduled: false,
    scheduledDate: null,
    assignedCrew: null
  });

  return await removeCustomerFromUpcomingRoutes(customerId);
}

/* Same normalisation as quoteMatchAddress in admin.html. Kept deliberately
   trivial and asserted identical by run-all.js, because this is a second copy
   of a rule that lives in two places and those drift (see money-parity). */
function quoteMatchAddressServer(a) {
  return String(a == null ? '' : a).toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Does this quote's address AND contact already belong to a customer?
   Mirrors quoteAlreadyACustomer in admin.html so the office's card and the
   customer's page cannot disagree about who is already a member.

   Candidates come from the INDEXED contact fields, then the address is
   compared - rather than scanning jobAddresses, which would be a full read of
   the whole book on every approval. */
async function quoteMatchesExistingCustomer(quoteData) {
  const wanted = quoteMatchAddressServer(quoteData.address);
  /* Record-or-null throughout: a stray `false` reads as "definitely not a
     member", and callers now test the RECORD. */
  if (!wanted) return null;
  const phone = digitsOnly(quoteData.phone);
  const email = String(quoteData.email || '').trim().toLowerCase();

  const queries = [];
  /* NOT limit(1): a shared phone has several records behind it and the one we
     want may not be first. Taking only the first is how the parent gets
     returned for the child's quote and the address check then wrongly fails. */
  if (phone) queries.push(db.collection('jobAddresses').where('phoneDigits', '==', phone).limit(20).get());
  if (email) {
    queries.push(db.collection('jobAddresses').where('emailLower', '==', email).limit(20).get());
    queries.push(db.collection('jobAddresses').where('email2Lower', '==', email).limit(20).get());
  }
  if (!queries.length) return null;

  const snaps = await Promise.all(queries.map(q => q.catch(err => {
    /* A missing index must never decide that somebody is not a member - that
       silently sends a real member back to the details form. Skip the query,
       keep the others. */
    console.error('[HU] existing-customer lookup failed:', err);
    return { docs: [] };
  })));
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      /* Returns the RECORD, not a bare true: the caller also needs to know
         WHICH customer, so it can mark them as in for the season. */
      if (quoteMatchAddressServer(doc.data().address) === wanted) {
        return { id: doc.id, data: doc.data() };
      }
    }
  }
  return null;
}

/* ⭐ NOTHING A CUSTOMER'S ANSWER SETS OFF MAY FAIL SILENTLY (added 2026-08-21).
 *
 * Owner: "for server call is there a way we can't have that fail silently?"
 *
 * Every write after a customer answers their quote is deliberately best-effort
 * — the ANSWER is already recorded and must not be lost because a follow-on
 * write failed. That is right, and it was also the whole problem: best-effort
 * meant console.error, which goes to Cloud Logging, which nobody in the office
 * reads. A recycle that never got flagged, or a house left on a route after a
 * "no", was invisible until somebody physically noticed.
 *
 * Three layers, cheapest first:
 *   1. tryFirestore   — retry once. A transient blip is the common failure and
 *                       this clears most of them before anyone hears about it.
 *   2. a lookup that FAILS instead of shrugging — see quoteCustomerRef.
 *   3. flagQuoteFollowUp — write what did not happen onto the QUOTE, which is
 *                       the one document known to be writable (it was written
 *                       at the top of quoteRespond, and a failure THERE throws
 *                       back to the customer, who sees an error and rings).
 *                       The office sees it on the card and in the sidebar count.
 *
 * ⚠ WHAT THIS STILL CANNOT COVER, said plainly rather than pretended away: if
 * Firestore is entirely unavailable the flag write fails too. Nothing
 * server-side reaches the office in that case — but the customer's own page
 * errors and tells them to call. */
const HU_RETRY_PAUSE_MS = 400;
async function tryFirestore(label, fn) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value: value };
    } catch (err) {
      /* ⚠ A PERMISSION REFUSAL IS NOT WORTH RETRYING and never becomes
         allowed on a second go — that includes the messages 5000-character cap,
         which Firestore reports as permission-denied (CLAUDE.md). Retrying it
         doubles the wait for an answer that will not change. */
      const code = String((err && err.code) || '');
      const fatal = code.indexOf('permission-denied') !== -1 ||
                    code.indexOf('invalid-argument') !== -1 ||
                    code.indexOf('not-found') !== -1;
      if (attempt === 2 || fatal) {
        console.error('[HU] ' + label + ' failed' + (fatal ? ' (not retried)' : ' twice') + ':', err);
        return { ok: false, error: err, label: label };
      }
      await new Promise(r => setTimeout(r, HU_RETRY_PAUSE_MS));
    }
  }
  return { ok: false, label: label };
}

/* ⭐ WHAT DID NOT HAPPEN IS WRITTEN WHERE THE OFFICE LOOKS.
 *
 * ⚠ ON THE QUOTE, not in a log and not in a new collection. The quote document
 * was written successfully seconds earlier, so it is the write most likely to
 * work when something else has not; and the Quotes tab is somewhere the office
 * already opens every day, so this needs no new habit.
 *
 * ⚠ IT NEVER THROWS. This is the thing that reports failures — it cannot
 * become a new way for the whole call to fail. */
async function flagQuoteFollowUp(quoteId, problems) {
  const list = (problems || []).filter(Boolean);
  if (!quoteId || !list.length) return false;
  try {
    await db.collection('quotes').doc(String(quoteId)).update({
      followUpNeeded: true,
      followUpReason: list.join('; ').slice(0, 900),
      followUpAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (err) {
    console.error('[HU] could not flag quote follow-up:', err);
    return false;
  }
}

/* ⭐ WHICH CUSTOMER A QUOTE IS ABOUT — one answer, for every action (added
   2026-08-21, hole A).
 *
 * ⚠ NEVER BY PHONE ALONE. This is the trap this codebase has written down more
 * than once: 17 numbers in the real book are shared, and 14 of those are two
 * GENUINELY DIFFERENT houses — a parent paying for a child's place. Resolving a
 * quote to a customer by phone can therefore land on the wrong household, and
 * for a decline that means recycling somebody else's lights and pulling THEM off
 * the crew's route.
 *
 * The approve path already resolved this carefully; declining and "maybe next
 * year" did not — maybe_next_year used findByPhone, which is exactly the unsafe
 * shortcut above. This is that careful version, lifted out so all three actions
 * ask the same question and get the same answer.
 *
 * In order:
 *   1. an explicit link — convertedToCustomerId or existingCustomerId, on a
 *      record that still exists. Exact; nothing to guess.
 *   2. ADDRESS plus phone-or-email, via quoteMatchesExistingCustomer. The
 *      address half is the whole safety argument — it is what keeps a parent and
 *      a child on one phone apart.
 *
 * ⚠ AND ONLY ON A QUOTE THE OFFICE HAS PRICED. firestore.rules stops a public
 * create from setting quotedPrice, so a price is proof staff touched it. Without
 * that gate this is a free "is this address one of your customers?" oracle for
 * anyone who can submit the public quote form.
 *
 * Returns the record, or null. Never throws: the customer's answer to their own
 * quote must never fail because a lookup did. */
async function quoteCustomerRef(quoteData) {
  const q = quoteData || {};
  const linkedId = q.convertedToCustomerId || q.existingCustomerId || '';
  if (linkedId) {
    const snap = await db.collection('jobAddresses').doc(String(linkedId)).get();
    if (snap.exists) return { id: snap.id, data: snap.data() };
    /* The link points at somebody who has since been removed. That is an
       ANSWER — there is no such customer — not a failure. */
    return null;
  }
  if (typeof q.quotedPrice === 'number') {
    return await quoteMatchesExistingCustomer(q);
  }
  return null;
}

/* ⭐ A DECLINE ASKS A QUESTION, IT DOES NOT CANCEL THEIR SEASON (hole A, fixed
   2026-08-21; rewritten the same day when the owner read the first version).
 *
 * ⚠ WHAT THE HOLE WAS: declining set quoteArchived and NOTHING else, so an
 * existing member who declined kept rsvpStatus 'yes' and stayed on any route
 * already built — a crew drove to a house that had said no.
 *
 * ⚠ AND WHAT THE FIRST FIX GOT WRONG: it treated a decline as an RSVP "no" —
 * out for the season, lights flagged to come back, off the routes. Owner:
 * "if an existing costumer denies a requote, than can we mark them as email or
 * something like that were we can ask them if they just want us to do what we
 * did last year of there house." She is right, and it is obvious once said:
 * somebody turning down a NEW price or a NEW scope has not said they want no
 * lights. Most of them want exactly what they had last year. Recycling their
 * set and cancelling their season is the one answer nobody asked for, and it is
 * expensive to undo — the bin is broken back into stock and their route is gone.
 *
 * ⚠ SO NO DECLINE ANYWHERE RECYCLES ANY MORE, and that is deliberate rather
 * than an omission. Leaving the season is said through the RSVP — portalRsvp
 * ('no') still flags the recycle, still pulls them off the routes, and is the
 * one place that decides somebody is out. A quote answer and a season answer
 * are different questions and only one of them was ever asked here.
 *
 * ⚠ AND IT NEVER TOUCHES A NEW LEAD. Somebody who is not a customer has no last
 * year to be asked about; quoteCustomerRef returns null and this does nothing
 * but leave the quote archived — which is all the owner wanted for them
 * ("we won't have an info for them yet"). */
async function declineAsksAboutLastYear(quoteData, quoteId) {
  const problems = [];
  /* ⚠ "COULD NOT TELL" IS NOT "NOT A CUSTOMER". The resolver used to catch its
     own read errors and return null — the same answer it gives for a first-time
     lead — so a Firestore blip made a real member look like a stranger and this
     did nothing at all, silently. */
  const look = await tryFirestore('decline customer lookup', () => quoteCustomerRef(quoteData));
  if (!look.ok) {
    await flagQuoteFollowUp(quoteId, ['could not look up the customer, so nobody ' +
      'has been marked to ask whether they want the same as last year — check ' +
      'this quote by hand']);
    return { reached: false, followUpFlagged: true };
  }
  const cust = look.value;
  if (!cust) return { reached: false };

  const updates = {
    /* The one new fact: somebody has to ask them whether last year's job will
       do. Read by the Automation Emails audience picker, so the office can mail
       the whole group at once, and shown on their row in All Customers. */
    askSameAsLastYear: true,
    askSameAsLastYearAt: admin.firestore.FieldValue.serverTimestamp()
  };
  /* The portal sets seasonStatus to needs_changes (or address_changed) when it
     raises a re-quote, and only an ANSWER clears it — "no thanks" is an answer.
     Left set they sit in Needs Changes for ever with nothing anywhere to clear
     it, which is the same hole deleting a re-quote had.
     ⚠ ONLY THOSE TWO VALUES: a cancellation request was put there by something
     that is not this quote, and clearing it would un-cancel somebody. */
  const was = String((cust.data || {}).seasonStatus || '');
  if (QUOTE_RAISED_STATUSES_SERVER.indexOf(was) !== -1) updates.seasonStatus = 'confirmed';
  /* ⚠ THE THIRD WRITER, and it was missed until a census went looking. Settling a
     customer's changes is as much a status change as asking for them, and undated the
     history can say a re-quote was owed and never that it was answered. `was` is the
     value read from the record above, which is exactly what the stamp needs. */
  stampSeasonStatusServer(updates, was);

  const wrote = await tryFirestore('decline customer update', () =>
    db.collection('jobAddresses').doc(cust.id).update(updates));
  if (!wrote.ok) {
    /* ⚠ NOTHING IS CLAIMED THAT DID NOT HAPPEN — no note here, only the flag. */
    await flagQuoteFollowUp(quoteId, [(cust.data && cust.data.name ? cust.data.name : 'A customer') +
      ' declined their re-quote but their record could NOT be updated — nobody ' +
      'is marked to ask them whether last year\'s job will do']);
    return { reached: false, followUpFlagged: true };
  }

  /* ⚠ AND SOMEBODY IS TOLD. Nothing else about this customer moved — they are
     still in for the season, still on their route — so without a note there is
     no trace at all that a question is outstanding. Best-effort: the answer is
     recorded and must not be lost because a note could not be written. */
  const who = (cust.data && cust.data.name) || quoteData.name || 'A customer';
  const noted = await tryFirestore('decline note', () =>
    db.collection('messages').add({
      topic: 'Re-quote Declined', folder: 'System',
      name: (cust.data && cust.data.name) || quoteData.name || '',
      phone: (cust.data && cust.data.phone) || quoteData.phone || '',
      email: (cust.data && cust.data.email) || quoteData.email || '',
      contactMethod: '',
      /* ⚠ IN HER OWN WORDS. Owner: "we can email them asking them if they want
         to do there normal lights with there normal bill instead." A note that
         says "declined" and stops is one somebody acts on as a cancellation. */
      message: who + ' turned down their re-quote. This is NOT a cancellation — ' +
               'they are still in for the season, their lights are unchanged and ' +
               'they stay on their route. Email them and ask whether they just ' +
               'want their normal lights at their normal bill instead: pick ' +
               '"Declined a re-quote" in the Automation Emails audience list to ' +
               'reach everyone waiting on that question.',
      autoQueuedToWarehouse: false,
      needsReassign: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }));
  if (!noted.ok) problems.push(who + ' declined their re-quote and the office ' +
    'could not be sent a note, so nobody has been told to ask them about last year');
  await flagQuoteFollowUp(quoteId, problems);

  return { reached: true, askedAboutLastYear: true, followUpFlagged: !!problems.length };
}

/* ⭐ WHAT KIND OF RE-QUOTE IS THIS — ONE ANSWER (added 2026-08-21).
 *
 * Owner: "in requote I should have the option to have requote for addition to
 * house, or for change address", and later "you can also get a requote because
 * you just changed the price". askRequoteKind in admin.html stores which, as
 * requoteKind, when the re-quote is raised.
 *
 * An ADDITION is the one that changes what "no" means. Owner, 2026-08-21:
 * "I don't want a decline on a garage to decline full quote just garage."
 * Somebody being quoted for a back garage on a house that is already lit is
 * answering a question about the GARAGE. The other two kinds are about the
 * whole job — a move, or the price of the lot — so a no there is a no to the
 * season, exactly as it has always been.
 *
 * ⚠ EXACTLY 'addition', NOT "anything with a linked customer". Every re-quote
 * has a linked customer, so a looser test would quietly turn every decline into
 * an add-on decline and nobody would ever leave the season again. */
function quoteIsAddOn(quoteData) {
  return String((quoteData || {}).requoteKind || '').trim().toLowerCase() === 'addition';
}

/* ⭐ THE THREE BUTTONS SAY WHAT THEY DO (added 2026-08-21).
 *
 * "Decline Quote" on an add-on reads as declining the whole thing, which is the
 * very confusion this job exists to remove — the words have to match the
 * behaviour or the behaviour may as well not have changed.
 *
 * ⚠ TWO COPIES, ASSERTED IDENTICAL. This one renders the nightly nudge; the
 * browser copy (quoteButtonLabels in admin.html) renders the quote card, the
 * bulk nudge and Automation Emails — the same four-senders/two-renderers split
 * CLAUDE.md warns about for the photo block. Change one, change the other, in
 * the same push; run-all.js runs both over every kind and fails if they ever
 * disagree. */
function quoteButtonLabelsServer(quoteData) {
  return quoteIsAddOn(quoteData)
    ? { approve: 'Yes, add it', maybe: 'Maybe Next Year', decline: 'No thanks — just my usual lights' }
    : { approve: 'Approve Quote', maybe: 'Maybe Next Year', decline: 'Decline Quote' };
}

/* ⭐ DECLINING AN ADD-ON REFUSES THE ADD-ON, AND NOTHING ELSE (added
   2026-08-21). Owner: "they can choose to say no to peice of there house or
   keep all of it... I don't want a decline on a garage to decline full quote
   just garage."
 *
 * ⚠ SO IT MUST NOT CALL declineAsksAboutLastYear. That one marks them to be
 * asked whether last year's job will do — a sensible question after a move or a
 * price change, and a baffling one to somebody who has just told us plainly
 * that they do not want the garage. They have answered; do not ask again.
 *
 * What it DOES do is close the question. The portal sets seasonStatus to
 * needs_changes (or address_changed) when it raises a re-quote, and that is
 * resolved by ANSWERING the quote — "no thanks" is an answer. Without this they
 * sit in Needs Changes for ever with nothing left anywhere to clear it, which
 * is the same hole deleting a re-quote had.
 *
 * ⚠ ONLY THOSE TWO VALUES, exactly as QUOTE_RAISED_STATUSES says in
 * admin.html. Anything else in seasonStatus was put there by something that is
 * not this quote — a cancellation request in particular — and clearing it
 * would be this reaching well past what it was pressed to do.
 *
 * ⚠ AND IT WRITES NOTHING TO THE WAREHOUSE. needsLightBuild and
 * buildTopUpFromFeet are set when the office APPLIES a re-quote, which by
 * definition has not happened to one that is being declined. Clearing them
 * "to be safe" would cancel a build the customer never asked to cancel. */
const QUOTE_RAISED_STATUSES_SERVER = ['needs_changes', 'address_changed'];
async function declineAddOnOnly(quoteData, quoteId) {
  const problems = [];
  /* ⚠ SAME RULE AS THE SEASON DECLINE: a lookup that could not run is not the
     same answer as "they are not a customer". See declineAsksAboutLastYear. */
  const look = await tryFirestore('add-on decline customer lookup', () => quoteCustomerRef(quoteData));
  if (!look.ok) {
    await flagQuoteFollowUp(quoteId, ['could not look up the customer, so their ' +
      'add-on refusal has NOT been recorded — they may still be sitting in ' +
      'Needs Changes, and nobody has been told the extra is off']);
    return { addOnOnly: true, reached: false, followUpFlagged: true };
  }
  const cust = look.value;
  if (!cust) return { addOnOnly: true, reached: false };

  let cleared = false;
  const was = String((cust.data || {}).seasonStatus || '');
  if (QUOTE_RAISED_STATUSES_SERVER.indexOf(was) !== -1) {
    const wrote = await tryFirestore('add-on decline seasonStatus clear', () =>
      db.collection('jobAddresses').doc(cust.id).update({ seasonStatus: 'confirmed' }));
    cleared = wrote.ok;
    if (!wrote.ok) problems.push((cust.data && cust.data.name ? cust.data.name : 'A customer') +
      ' turned down their add-on but their record still says Needs Changes — ' +
      'set them back to Confirmed by hand');
  }

  /* ⚠ AND SOMEBODY IS TOLD, because nothing else about this customer moved.
     A season decline is loud — they drop off routes, they appear on the recycle
     list. This one leaves no trace anywhere, so without a note the office would
     go on expecting a garage that is not coming. Best-effort: the answer is
     already recorded and must not fail because a note could not be written. */
  const who = (cust.data && cust.data.name) || quoteData.name || 'A customer';
  const noted = await tryFirestore('add-on decline note', () =>
    db.collection('messages').add({
      topic: 'Add-On Declined', folder: 'System',
      name: (cust.data && cust.data.name) || quoteData.name || '',
      phone: (cust.data && cust.data.phone) || quoteData.phone || '',
      email: (cust.data && cust.data.email) || quoteData.email || '',
      contactMethod: '',
      message: who + ' said no to the extra lights they were re-quoted for' +
               (quoteData.requoteKindNote ? ' (' + quoteData.requoteKindNote + ')' : '') +
               '. This is NOT a cancellation — they are still in for the season, ' +
               'their existing lights are unchanged, and they stay on their route. ' +
               'Nothing needs doing unless you had already started building the extra.',
      autoQueuedToWarehouse: false,
      needsReassign: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }));
  /* ⚠ THIS ONE MATTERS MORE THAN THE SEASON DECLINE'S NOTE. An add-on refusal
     leaves NO other trace anywhere — nothing drops off a route, nobody appears
     on the recycle list — so if the note does not land there is genuinely
     nothing for the office to notice. */
  if (!noted.ok) problems.push(who + ' turned down their add-on and the office ' +
    'could not be sent a note, so nobody has been told the extra is off');
  await flagQuoteFollowUp(quoteId, problems);

  return { addOnOnly: true, reached: true, seasonStatusCleared: cleared,
           followUpFlagged: !!problems.length };
}

/* ⭐ "MAYBE NEXT YEAR" FROM A QUOTE EMAIL NOW MAKES THE RECORD IT NEEDS
 * (added 2026-09-04). Owner: "when they click maybe next year nothing happens
 * because we dont have their customer data … we want them to be in the exact
 * same situation as a maybe next year off of the rsvp."
 *
 * ⚠ WHAT WAS ACTUALLY BROKEN. Maybe Next Year is recorded on the CUSTOMER
 * (maybeNextYear + rsvpStatus 'backnextyear'), and every screen that shows the
 * group reads jobAddresses — the All Customers badge and its filter, the
 * Contact 2027 sheet, the RSVP audience picker. A lead answering from a quote
 * email has no jobAddresses record at all, so quoteRespond set approvalStatus on
 * the QUOTE and stopped. The quote slid into Closed, and the person who took the
 * trouble to answer appeared on none of those lists. Next August nobody knows
 * they asked to be asked again, which is the one thing they told us.
 *
 * So the answer builds the record, in exactly the state an RSVP "back next year"
 * leaves a customer in. From then on they ARE any other maybe next year: same
 * badge, same filter, same sheet, same audience, and the office's Confirmed
 * toggle brings them back in one click when the season comes round.
 *
 * ⚠ IT IS A LEAD SITTING OUT, NOT A CONVERSION, and every field below turns on
 * that distinction. Convert to Customer takes a number out of the pool, opens an
 * invoice, queues the warehouse, starts the 48-hour lights window and puts them
 * on a day. NONE of that may happen for somebody whose answer was "not this
 * year": it would bill a person who bought nothing and build a set nobody is
 * hanging. What is created is a record with their details on it and the season
 * flag set — no customerNumber, no invoice, no needsLightBuild, no
 * lightsLockedUntil, no needsDayAssignedAt, no chargeNewMemberFee.
 *
 * ⚠ AND ONLY ON A QUOTE THE OFFICE HAS PRICED. firestore.rules stops a public
 * create from setting quotedPrice, so a price is proof staff touched this quote
 * and sent it. Without that gate anyone who can submit the public quote form
 * could type a stranger's address, press Maybe Next Year and put a record into
 * the customer book. A real quote EMAIL only ever goes out after pricing, so the
 * gate costs the owner's case nothing — it is the same proof-of-staff test
 * quoteCustomerRef already uses.
 */

/* ⭐ MAY THIS QUOTE HAVE A RECORD MADE FOR IT? Four ways the answer is no, and
   each of them is a way the naive version creates a duplicate or a stranger.

   ⚠ 1. NOT WITHOUT A PRICE. firestore.rules stops a public create from setting
   quotedPrice, so a price is proof staff touched this quote and sent it. Without
   this gate anyone who can submit the public quote form could type a stranger's
   address, press Maybe Next Year and put a row into the customer book — and
   quoteCustomerRef would not even have looked for an existing customer first,
   because it carries the same gate, so a real member could be duplicated too.
   A quote EMAIL is only ever sent after pricing, so this costs nothing real.

   ⚠ 2. NOT ON A QUOTE THAT ALREADY POINTS AT A CUSTOMER. existingCustomerId is a
   re-quote raised against a live customer and convertedToCustomerId/At is a quote
   already made into one. When quoteCustomerRef returns null on one of those the
   answer is "that customer has since been deleted", which it says in as many
   words — an ANSWER, not a gap to fill. Filling it would resurrect somebody the
   office removed on purpose.

   ⚠ 3. NOT WITHOUT AN ADDRESS. It is the only thing that distinguishes one house
   from another here — quoteMatchesExistingCustomer refuses to match without one —
   so a record made without one can never afterwards be recognised as the same
   house, and the next quote from them makes a second.

   ⚠ 4. NOT WITHOUT A PHONE OR AN EMAIL. Same reason from the other side: with no
   contact of any kind there is nothing to find them by, nothing to reach them on
   next August, and the record is a row nobody can ever act on. */
function quoteLeadNeedsRecord(quoteData) {
  const q = quoteData || {};
  if (typeof q.quotedPrice !== 'number') return false;
  if (q.existingCustomerId || q.convertedToCustomerId || q.convertedToCustomerAt) return false;
  if (!quoteMatchAddressServer(q.address) && !String(q.street || '').trim()) return false;
  if (!digitsOnly(q.phone) && !String(q.email || '').trim()) return false;
  return true;
}

/* The count of lit sides, from either shape a quote can hold it in. ⚠ THE FLOOR
   OF 1 MUST MATCH houseSideCount in admin.html, portalSideCount in index.html and
   portalSave's own asCount above: this value is compared against the customer's
   stored sides to decide whether a re-quote is owed, and a default on one side of
   that comparison with a zero on the other raises a re-quote for every house
   whose sides were never written down, for a change nobody made. */
function houseSideCountServer(v) {
  if (Array.isArray(v)) {
    const listed = Math.min(4, v.filter(Boolean).length);
    return listed || 1;
  }
  const n = Number(String(v == null ? '' : v).replace(/[^0-9]/g, ''));
  return (n >= 1 && n <= 4) ? n : 1;
}

/* The quote's photos as a customer's photo list. Mirrors quotePhotoList +
   customerPhotoUpdates in admin.html — including the older single-photo shape,
   because a quote raised before quotePhotos existed still has a picture and the
   route card next season has nothing else to show. */
function quotePhotosAsCustomerServer(q) {
  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 500);
  let list = [];
  if (Array.isArray(q.quotePhotos) && q.quotePhotos.length) {
    list = q.quotePhotos;
  } else if (q.frontPhotoUrl) {
    list = [{ url: q.frontPhotoUrl, original: q.frontPhotoOriginal || q.frontPhotoUrl,
              markup: Array.isArray(q.frontPhotoMarkup) ? q.frontPhotoMarkup : [], label: '' }];
  }
  const clean = list.filter(p => p && p.url).slice(0, 20).map(p => ({
    url: str(p.url, 700),
    original: str(p.original || p.url, 700),
    markup: Array.isArray(p.markup) ? p.markup : [],
    label: str(p.label, 60)
  }));
  const main = clean[0];
  return {
    housePhotos: clean,
    housePhotoUrl: main ? main.url : '',
    housePhotoOriginal: main ? main.original : '',
    housePhotoMarkup: main ? main.markup : []
  };
}

/* Everything a quote knows, in the shape jobAddresses stores it. Deliberately
   PURE — no db, no admin.firestore, the timestamp is passed in — so run-all can
   lift it and EXECUTE it rather than grep it. That matters more here than
   anywhere else in this file: the field list is the whole behaviour, and a text
   check on a field list is exactly the check that stays green while the value
   beside the name is wrong. */
function quoteLeadCustomerFields(quoteData, ts) {
  const q = quoteData || {};
  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 500);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  /* A quote raised from the portal or by hand carries only the one-line address;
     the public form carries the parts as well. Take the parts when they are
     there and fall back to the line, rather than trying to split it — a wrong
     split writes a wrong city onto a customer for ever. */
  const street = str(q.street, 200);
  const city = str(q.city, 100);
  const zip = str(q.zip, 20);
  const address = str(q.address, 300) ||
    [street, [city, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const fields = {
    name: str(q.name, 200),
    phone: str(q.phone, 40),
    email: str(q.email, 200),
    street: street, city: city, state: 'UT', zip: zip,
    address: address,
    /* ⚠ NO PIN, AND IT SAYS SO. There is no geocoder on the server — the Maps
       key lives in admin.html and index.html only — so writing a lat/lng here is
       not possible and guessing one is worse than none. needsGeocode is the flag
       Add a Customer and the bulk import already set for exactly this, and All
       Customers has a "Needs Pin" filter that finds them. It costs nothing this
       season: somebody sitting out is not routed, so the pin is only wanted the
       day the office brings them back, and saving them then re-runs the lookup. */
    lat: null, lng: null, needsGeocode: true,
    houseSides: houseSideCountServer(q.houseSides),
    lightColors: Array.isArray(q.lightColors) ? q.lightColors.slice(0, 20).map(c => str(c, 40)) : [],
    lightsDescription: str(q.lightsDescription, 400),
    wireColor: str(q.wireColor, 40),
    outletTimer: str(q.outletTimer, 10),
    specificOutlet: str(q.specificOutlet, 10),
    specificOutletNotes: str(q.specificOutletNotes, 500),
    installPreference: str(q.installPreference, 60),
    wantsMailedInvoice: q.wantsMailedInvoice === true,
    notes: str(q.notes, 1500),
    gateCode: str(q.gateCode, 60),
    contactMethod: str(q.contactMethod, 40),
    /* The price and the footage they were quoted travel with them so next
       season starts from a number rather than a re-measure. ⚠ A PRICE ON THE
       RECORD IS NOT A BILL: the nightly run invoices houses marked completed,
       and syncPayerInvoice runs when the office saves a customer. Neither
       happens to somebody sitting out, and no invoice is created here. */
    housePrice: num(q.quotedPrice),
    measuredFeet: num(q.estimatedFeet) || num(q.measuredFeet),
    /* ⭐ THE SEASON ANSWER ITSELF — the same pair portalRsvp writes for
       'backnextyear' and setCustomerSeason writes for the office toggle. The two
       fields are one fact and are always written together; isOutForSeason reads
       the flag, the Contact 2027 sheet reads either, and the All Customers badge
       reads the flag. */
    maybeNextYear: true,
    maybeNextYearAt: ts,
    rsvpStatus: 'backnextyear',
    rsvpRespondedAt: ts,
    /* ⚠ THEY HAVE ANSWERED, so the "ask them what they want" list must not also
       claim them. portalRsvp closes it on every answer for the same reason. */
    askSameAsLastYear: false,
    /* ⚠ NOT A BUILD AND NOT A NUMBER. Both are what Convert to Customer does,
       and doing either here would put a set of lights in the warehouse queue and
       a number out of the pool for a house nobody is hanging this year. */
    needsLightBuild: false,
    customerNumber: '',
    scheduled: false,
    scheduledDate: null,
    assignedCrew: null,
    /* Their own way back in. Every customer has one; without it they cannot
       sign into the portal next season to change their mind. */
    portalToken: generatePortalToken(),
    createdAt: ts
  };
  /* The normalised sign-in copies, so this record is findable by phone or email
     without the full-collection scan — and so quoteCustomerRef matches THEM,
     not a second new record, if they answer twice or are re-quoted later. */
  Object.assign(fields, contactIndexFields(fields));
  Object.assign(fields, quotePhotosAsCustomerServer(q));
  return fields;
}

/* Writes the record above and links the quote to it. Returns the new id, or
   null when nothing was created — never throws: the customer's answer is
   already recorded by the time this runs and must not fail because a write did.

   ⚠ THE LINK IS ITS OWN FIELD, NOT existingCustomerId. Putting the new id in
   existingCustomerId or convertedToCustomerId would make quoteCustomerRef and
   the approve path call this a MEMBER — so if they changed their mind and
   approved, they would be shown "anything changing this year?" prefilled from a
   record that holds no colours, and would never be asked for their install
   details at all. nextYearCustomerId says the one thing that is true (this quote
   produced a sitting-out record) and is read by nothing that decides membership.
   It is also the idempotency key: a second press of the same emailed button
   finds it and updates that record instead of creating a second one. */
async function createNextYearCustomerFromQuote(quoteId, quoteData) {
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const fields = quoteLeadCustomerFields(quoteData, ts);
  const made = await tryFirestore('maybe-next-year lead create', () =>
    db.collection('jobAddresses').add(fields));
  if (!made.ok) return null;
  const newId = made.value.id;

  /* Best-effort from here down: the record exists and holds the answer, which is
     the whole point. A failed link is a quote the office has to close by hand. */
  await tryFirestore('maybe-next-year quote link', () =>
    db.collection('quotes').doc(quoteId).update({
      nextYearCustomerId: newId,
      nextYearCustomerAt: ts
    }));

  /* ⚠ AND SOMEBODY IS TOLD A RECORD APPEARED. This is the only path in the app
     that creates a customer without a person pressing a button, so without a note
     a row with no customer number simply materialises in All Customers and looks
     like a bug. It also carries the one thing the office has to decide — the
     number — in the same words the rejoin-after-recycle note uses, because it is
     the same decision and taking one from the pool programmatically could collide
     with one already written on a bin by hand. */
  await tryFirestore('maybe-next-year lead note', () =>
    db.collection('messages').add({
      topic: 'Maybe Next Year — New Record', folder: 'System',
      name: fields.name, phone: fields.phone, email: fields.email,
      contactMethod: fields.contactMethod || '',
      message: (fields.name || 'Someone') + ' answered Maybe Next Year on their quote' +
               (fields.housePrice ? ' of $' + fields.housePrice : '') +
               ', so they have been added to All Customers as sitting this season out — ' +
               'that is what puts them on the Contact 2027 list to be asked again next year. ' +
               'They are NOT booked for anything: no customer number, no invoice, nothing in ' +
               'the warehouse, and they are on no route. Their address has no map pin yet ' +
               '(there is no lookup on this path) — opening them and pressing Save finds it. ' +
               'If they change their mind, switch their badge to Confirmed.',
      autoQueuedToWarehouse: false,
      needsReassign: false,
      createdAt: ts
    }));

  return newId;
}

/* --- quoteRespond ---------------------------------------------------------
 * Input: { quoteToken, action }  where action = 'approve' | 'decline' | 'maybe_next_year'
 *
 * Quote approval links have been failing silently from the public site because
 * the quotes collection is read/update restricted to staff. This runs the whole
 * flow server-side instead.
 */
const QUOTE_ACTION_TO_STATUS = { approve: 'approved', decline: 'declined', maybe_next_year: 'maybe_next_year', maybe: 'maybe_next_year' };
exports.quoteRespond = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const quoteToken = body.quoteToken ? String(body.quoteToken).trim() : '';
  const action = String(body.action || '').toLowerCase();

  if (!quoteToken) throw new HttpsError('invalid-argument', 'Missing quote token.');
  if (!QUOTE_ACTION_TO_STATUS[action]) {
    throw new HttpsError('invalid-argument', 'Unknown quote action.');
  }

  const snap = await db.collection('quotes')
    .where('quoteToken', '==', quoteToken).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Quote not found.');

  const quoteId = snap.docs[0].id;
  const quoteData = snap.docs[0].data();

  const quoteUpdates = {
    approvalStatus: QUOTE_ACTION_TO_STATUS[action],
    approvalRespondedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  /* A decline archives the card rather than leaving it sitting in the office's
     working list. Archived, not deleted - the address keeps its history, and
     there is a Restore button in admin if someone changes their mind. */
  if (action === 'decline') {
    quoteUpdates.quoteArchived = true;
    quoteUpdates.quoteArchivedAt = admin.firestore.FieldValue.serverTimestamp();
    quoteUpdates.quoteArchivedReason = 'Customer declined from their quote email';
  } else {
    /* Approving or choosing "maybe next year" un-archives. Without this, a
       customer who declined and then changed their mind stayed archived
       forever - the status said approved but the card still sat in
       Closed -> Archived instead of Ready to Convert. */
    quoteUpdates.quoteArchived = false;
    quoteUpdates.quoteArchivedReason = '';
    /* ⚠ AND THE DATE GOES WITH THEM (added 2026-08-29). Clearing the flag and the reason
       while leaving `quoteArchivedAt` standing left a restored quote reading as archived
       on a date AND not archived at the same time — two fields describing one state and
       disagreeing. Anything reading the date to decide how long a quote has been closed
       gets an answer about an archiving that was undone.
       ⚠ THE THREE ARE ONE FACT, so they are written together. That is the whole reason
       this was easy to miss: two of the three were cleared, which looks complete. */
    quoteUpdates.quoteArchivedAt = null;
  }
  await db.collection('quotes').doc(quoteId).update(quoteUpdates);

  /* A "maybe next year" from someone who is already a customer has to reach
     their customer record, not just the quote - otherwise they stay on the
     routes and the schedule for a season they already said no to. Quotes carry
     no link to jobAddresses, so the phone number is the only join available,
     and it is the same one the rest of the app matches on. */
  let pulledFromSeason = false;
  /* ⭐ A DECLINE REACHES THE CUSTOMER TOO (hole A, fixed 2026-08-21). It used to
     archive the quote and stop, so an existing member who declined kept
     rsvpStatus 'yes', was never recycled, stayed on the Yes sheet and stayed on
     any route already built — a crew drove to a house that had said no. */
  let declinedCustomer = false;
  /* ⭐ UNLESS IT IS AN ADD-ON, IN WHICH CASE THE SEASON IS NOT THE QUESTION
     (added 2026-08-21). Owner: "I don't want a decline on a garage to decline
     full quote just garage." See declineAddOnOnly. */
  let declinedAddOnOnly = false;
  if (action === 'decline') {
    if (quoteIsAddOn(quoteData)) {
      await declineAddOnOnly(quoteData, quoteId);
      declinedAddOnOnly = true;
    } else {
      const res = await declineAsksAboutLastYear(quoteData, quoteId);
      declinedCustomer = !!res.reached;
    }
  }

  /* ⭐ AND WHEN THERE IS NO RECORD TO PULL, ONE IS MADE — see
     createNextYearCustomerFromQuote. This is the half the owner was looking at:
     a lead answering from a quote email left no trace anywhere a maybe next year
     is looked for. */
  let createdCustomerId = null;
  if (action === 'maybe_next_year' || action === 'maybe') {
    try {
      /* ⚠ NOT findByPhone. This used to resolve the customer by phone alone —
         the shared-number trap: 17 numbers in the real book are shared and 14 of
         those are two different households, so it could pull the WRONG customer
         out of the season. quoteCustomerRef uses the explicit link first and
         ADDRESS plus contact as the fallback, which is what keeps a parent and a
         child apart. Same answer the approve and decline paths get. */
      const cust = await quoteCustomerRef(quoteData);
      if (cust) {
        await pullCustomerFromSeason(cust.id);
        pulledFromSeason = true;
      } else if (quoteLeadNeedsRecord(quoteData)) {
        /* ⚠ THE SAME PRESS TWICE MUST NOT MAKE TWO PEOPLE. The emailed button is
           one tap on a phone and it is tapped twice; the link also stays live in
           the inbox for months. nextYearCustomerId is the mark this path leaves,
           so a repeat finds the record it made last time and answers into it. */
        const already = String(quoteData.nextYearCustomerId || '');
        const existing = already
          ? await db.collection('jobAddresses').doc(already).get()
          : null;
        if (existing && existing.exists) {
          /* Still theirs, still sitting out — but re-answer it rather than doing
             nothing, so a record the office had toggled back to Confirmed
             honours the answer the customer has just given again. */
          await pullCustomerFromSeason(existing.id);
          pulledFromSeason = true;
          createdCustomerId = existing.id;
        } else {
          createdCustomerId = await createNextYearCustomerFromQuote(quoteId, quoteData);
          /* ⚠ CREATED IS NOT PULLED. It is written into the sitting-out state at
             birth and is on no route to be swept off, so claiming the pull would be
             claiming something that did not happen. But a create that FAILED must
             not pass silently either — tryFirestore has already logged it, and this
             is what puts it in front of the office. */
          if (!createdCustomerId) {
            await flagQuoteFollowUp(quoteId, ['they chose Maybe Next Year and are ' +
              'not one of our customers yet, so a record was going to be made for ' +
              'them \u2014 it could NOT be written. Nobody will be asked again next ' +
              'year unless you add them by hand']);
          }
        }
      }
    } catch (err) {
      /* Never let this sink the customer's answer - the quote is already
         recorded, and the office can pull them off by hand. ⚠ BUT SAY SO: until
         2026-08-21 this was the console line and nothing else, so a member who
         chose "maybe next year" could stay on the routes for a season they had
         declined with nobody any the wiser. */
      console.error('[HU] maybe-next-year customer update failed:', err);
      await flagQuoteFollowUp(quoteId, ['they chose Maybe Next Year but their ' +
        'record could NOT be updated — they may still be scheduled and on a ' +
        'route for a season they have said no to']);
    }
  }

  if (action === 'approve' && quoteData.jobAddressId) {
    try {
      await db.collection('jobAddresses').doc(quoteData.jobAddressId)
        .update({ quoteDetailQuoteId: quoteId });
    } catch (err) {
      console.error('[HU] quoteDetailQuoteId write failed:', err);
    }
  }

  /* --- Is this quote for somebody who is ALREADY one of our members? -------
   * A member who approves does NOT want the new-customer install-details form:
   * we already hold their colours, their wire, their timer and their notes,
   * and re-collecting it invites a second build of a house that already has
   * lights. They get "anything changing this year?" instead (index.html).
   *
   * ⚠ THE LINK MUST BE AN EXPLICIT ONE, NEVER A PHONE MATCH. The obvious
   * implementation looks up quoteData.phone in jobAddresses -- and it is
   * wrong, because a phone number is not one household here. 17 numbers in
   * the real book are shared and 14 of those are genuinely two houses (a
   * parent paying for a child's place). A brand-new house quoted against a
   * parent's phone would be told it is already a member and would never be
   * asked for its install details at all. So only two things count:
   *   convertedToCustomerAt -- this very quote has already been made into a
   *     customer. Staff-only: firestore.rules forbids a public create from
   *     setting it. This is the owner's "once they are created" case.
   *   existingCustomerId    -- a re-quote raised against a live customer, by
   *     the portal or the office, and the record still has to exist.
   *
   * ⚠ AND IT NEVER RETURNS A portalToken. A quoteToken is generated in the
   * visitor's own browser, so anyone able to submit the public quote form
   * knows one; upgrading it into a customer credential is the exact account
   * takeover that was closed in portalLookup on 2026-08-14. All that goes
   * back is a yes/no and the contact the quote itself already carries, so the
   * page can fill in the sign-in box. Signing in is still last-name checked
   * and still rate limited.
   * ---------------------------------------------------------------------- */
  /* --- What the "fill it out fresh" form is allowed to start from ----------
   * Owner, 2026-08-21: a re-quoted member should be able to choose between
   * keeping what we hold and going through the form again. Going through it
   * again is only worth anything if it starts from their current answers -
   * otherwise it is a re-typing exercise and half of it comes back blank.
   *
   * ⚠ THE GATE CODE AND THE HOUSE NOTES ARE DELIBERATELY NOT IN HERE.
   * A quoteToken is generated in the visitor's own browser when the public quote
   * form is submitted, so possessing one proves nothing about who you are - the
   * same reason this function has never returned a portalToken. A gate code is
   * the one field on the record that opens a physical gate, and the house notes
   * routinely carry one in free text ("gate code 1234, dog in back"). Neither
   * travels. index.html leaves both boxes empty and says an empty box keeps what
   * we already have; admin.html will not overwrite a field the customer left
   * blank. Nothing here is worth more to a stranger than the colour of somebody's
   * Christmas lights.
   * ---------------------------------------------------------------------- */
  const memberPrefill = (data) => {
    const m = data || {};
    const str = (v, max) => String(v == null ? '' : v).slice(0, max || 200);
    return {
      lightColors: Array.isArray(m.lightColors) ? m.lightColors.slice(0, 20).map(c => str(c, 40)) : [],
      lightsDescription: str(m.lightsDescription, 400),
      wireColor: str(m.wireColor, 40),
      outletTimer: str(m.outletTimer, 10),
      specificOutlet: str(m.specificOutlet, 10),
      specificOutletNotes: str(m.specificOutletNotes, 500),
      installPreference: str(m.installPreference, 60),
      wantsMailedInvoice: m.wantsMailedInvoice === true
    };
  };
  let alreadyMember = false;
  /* The record itself when we know WHICH customer — needed to mark them in for
     the season below. Null is normal: a converted quote can say "this became a
     customer" without saying who. */
  let memberRef = null;
  if (action === 'approve') {
    try {
      /* ⭐ THE SAME "which customer is this quote about" ANSWER the decline and
         maybe-next-year paths use — see quoteCustomerRef. It is the explicit link
         first, then ADDRESS plus contact on a priced quote, and never phone alone.
         This used to be written out here in full; three copies of one rule about
         which household a decision lands on is how one of them starts recycling
         the wrong person's lights.

         ⚠ alreadyMember IS STILL WIDER THAN memberRef, deliberately.
         convertedToCustomerAt says "this quote HAS been made into a customer"
         without saying which one, and that is enough to stop showing somebody the
         new-customer form even when the record cannot be named. So the flag reads
         from both; only the RECORD comes from the shared rule. */
      memberRef = await quoteCustomerRef(quoteData);
      alreadyMember = !!memberRef || !!quoteData.convertedToCustomerAt;
    } catch (err) {
      /* Never let this sink the approval - it is already recorded above. A
         member who wrongly gets the details form can still fill it in; a
         customer whose approval failed has to ring the office. */
      console.error('[HU] existing-member check failed:', err);
      alreadyMember = false;
    }
  }

  /* ⭐ APPROVING IS SAYING YES TO THE SEASON. A returning member who approved
     their re-quote had agreed to the price, but rsvpStatus stayed blank — so
     they still read as "pending" and got chased by an RSVP email asking them to
     confirm a season they had just confirmed. Owner asked for that to stop.

     ⚠ ONLY WHEN NOBODY HAS ANSWERED. A recorded “no” or “back next year” is a
     deliberate answer, and quietly flipping it to yes would put somebody back
     on a route they had cancelled — and leave needsLightRecycle set behind
     them, so the record would say two opposite things at once. An explicit
     answer always outranks one inferred from a price.

     ⭐ “UNANSWERED” COUNTS AS NOBODY HAVING ANSWERED (added 2026-08-20, when that
     status arrived). It is not a reply — it means we asked and they have not got
     back to us, and right before an RSVP round every single customer is moved to
     it. A blank-only test would therefore have stopped marking ANYONE from the
     first reset onwards, and the symptom would be the exact complaint this code
     was written to fix: members chased for a season they had just paid to join.

     ⚠ AND ONLY FOR SOMEBODY WHO IS ALREADY A CUSTOMER. A new lead has no
     season to be in yet; they become one when the office converts them.

     ⚠ Best-effort, like every other write in this function: the approval is
     already recorded, and failing it here would make the customer ring up
     about a price they successfully accepted. */
  /* ⭐ APPROVING A QUOTE IS A YES, EVEN OVER A RECORDED NO (changed 2026-08-22).
     Owner, asked which way she wanted it and told the trade: "go with option 2."

     ⚠ THIS REVERSES THE 2026-08-19 RULE and the old reasoning is kept so nobody
     restores it by accident: a recorded "no" was treated as a DELIBERATE answer that
     outranked one inferred from a price, because a re-quote can be sent to somebody
     who has already said no — to correct a figure, or to price them for next year —
     and reading that approval as "I am back in" puts them on a crew day when all they
     agreed to was the number. That is still the cost. It was put to her in those terms
     and she chose it, because in practice a re-quote goes to somebody she is trying to
     bring back, and the alternative is her flipping every one of them by hand.

     ⚠ THE LATEST ANSWER STILL WINS. This is one more way to say yes, not a lock: a no
     that arrives afterwards, through the link or the office, is a later answer and
     overrides it. She asked that specifically.

     ⚠ AND IT DOES THE WHOLE JOB. seasonYesUpdates cancels a queued recycle and
     re-queues a build if the recycle already happened — the old blank-only branch set
     the status alone, which was safe only BECAUSE it never ran for somebody who had
     said no. Now that it does, writing the status by itself would leave them in the
     season and queued to have their lights pulled apart at the same time, which is
     exactly what the 2026-08-19 note warned about. */
  if (action === 'approve' && memberRef) {
    /* ⚠ AND THE RSVP RESET SWEEP IS WHY THE BADGE HAS TO BE CLEARED HERE TOO, not
       only for a blank status: that sweep deliberately leaves maybeNextYear standing
       while setting everyone to 'unanswered', so somebody who sat last season out can
       reach this line still carrying it — and would be kept off the Yes sheet by the
       very approval that put them back in. seasonYesUpdates clears it. */
    try {
      await db.collection('jobAddresses').doc(memberRef.id)
        .update(seasonYesUpdates(memberRef.data || {}, () => admin.firestore.FieldValue.serverTimestamp()));
    } catch (err) {
      console.error('[HU] marking approver as in for the season failed:', err);
    }
  }

  /* ⭐ THE SECOND DOOR INTO A YES, AND IT MADE THE SAME PROMISE (2026-09-01).
     Approving IS a yes for an existing member — the block just above writes
     seasonYesUpdates — so RS-24 holds them out of the season on the money exactly
     as it does an RSVP yes, while all three of this page's confirmations ended on
     some form of "we'll be in touch to get you scheduled".
     ⚠ ONLY WHEN WE KNOW WHICH MEMBER. `alreadyMember` is deliberately wider than
     `memberRef` — a quote can say "this became a customer" without saying who — and
     a debt cannot be looked up for somebody we cannot identify. That case reports
     nought and keeps the original wording, which is this helper's fail-safe anyway.
     ⚠ AND ONLY ON AN APPROVE. A decline is not being scheduled either way, and
     telling somebody who just said no that they owe money is a chase. */
  const approverOwes = (action === 'approve' && memberRef)
    ? await arrearsForCustomer(memberRef.data || {})
    : { outstanding: 0, season: '' };

  return {
    ok: true,
    action: action,
    quotedPrice: quoteData.quotedPrice || 0,
    /* See arrearsForCustomer. Nought for anybody clear, and for anybody we cannot
       identify — so the page's existing wording is what a reader sees unless there
       is a debt we can actually prove. */
    arrearsOutstanding: approverOwes.outstanding,
    arrearsSeason: approverOwes.season,
    /* The page needs to know WHICH quote it just approved so it can open the
       detail form against it. Without this the approval was recorded and the
       customer was left looking at an empty page. Nothing sensitive: the id
       is useless without the token they already hold. */
    quoteId: quoteId,
    name: quoteData.name || '',
    formCompleted: !!quoteData.formCompleted,
    /* See the block above. A boolean, plus the contact already written on this
       quote so the portal sign-in box can be filled in - never a token. */
    alreadyMember: alreadyMember,
    memberContact: alreadyMember
      ? (quoteData.email || quoteData.phone || '')
      : '',
    /* Null when we know they are a member but not WHICH member - the
       convertedToCustomerAt path can say one without the other. The form still
       opens in that case, just empty, which is no worse than before it existed. */
    memberDetails: (alreadyMember && memberRef) ? memberPrefill(memberRef.data) : null,
    /* ⭐ SO THE PAGE CAN SAY THE RIGHT THING. The stock decline message is a
       warm goodbye — "no hard feelings, merry Christmas" — which is exactly
       wrong for somebody who has just turned down a garage and is still having
       their house lit next week. The page reads this to pick its wording; the
       DECISION was made above, from the quote's own requoteKind. */
    addOnOnly: declinedAddOnOnly
  };
});

/* --- quoteSaveDetails -----------------------------------------------------
 * The detail form used to write straight to Firestore from the customer's
 * browser. The rules only allow an UPDATE to a quote when request.auth is set,
 * and a customer holding a quote token is not signed in - so every submission
 * was denied. This does the write server-side after checking the token, the
 * same way quoteRespond does.
 *
 * Input:  { quoteToken, details:{...} }
 * Output: { ok: true }
 * ------------------------------------------------------------------------- */
/* ⭐ A MEMBER WHO SAYS NOTHING IS CHANGING (added 2026-08-31, QT-21). Addie:
 * "as long as they kept details the same that should just be put in schedule after
 * we price them".
 *
 * ⚠ THE CARD USED TO STICK IN AWAITING RESPONSE FOR EVER. An existing member is
 * deliberately never shown the install-details form — they get "anything changing
 * this year?" and then "Perfect, you're all set" — so formCompleted was never set,
 * and quoteStage only leaves Awaiting Response on approved AND (formCompleted OR
 * approvedByOffice). Nothing marked them done, so the office had to press Mark
 * Approved by hand on every re-quote a member approved.
 *
 * ⚠ IT IS ITS OWN FIELD, NOT A FAKED formCompleted. That field means the customer
 * filled the form in, and writing it when they did not would make Ready to Convert
 * lie about where the details came from — the office reads that folder expecting
 * answers a customer typed. This says exactly what happened: they were asked, and
 * they said nothing is changing.
 *
 * ⚠ AND IT NEVER TOUCHES THE HOUSE. Nothing is changing is the whole claim, so it
 * writes no colours, no wire, no timer, and queues no build. A member who DOES want
 * a change takes the other button and goes to their portal, which raises its own
 * re-quote and its own warehouse work. */
exports.quoteMemberKeptDetails = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const quoteToken = body.quoteToken ? String(body.quoteToken).trim() : '';
  if (!quoteToken) throw new HttpsError('invalid-argument', 'Missing quote token.');

  const snap = await db.collection('quotes')
    .where('quoteToken', '==', quoteToken).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Quote not found.');

  const quoteId = snap.docs[0].id;
  const quoteData = snap.docs[0].data();
  /* ⚠ ONLY ON AN APPROVED QUOTE. This is reached from the screen that follows an
     approval, but the token is generated in the visitor's own browser, so it proves
     nothing on its own — the same reasoning that keeps a portalToken out of
     quoteRespond. Without an approval there is nothing to settle. */
  if ((quoteData.approvalStatus || 'pending') !== 'approved') {
    throw new HttpsError('failed-precondition', 'That quote has not been approved.');
  }

  await db.collection('quotes').doc(quoteId).update({
    memberKeptDetails: true,
    memberKeptDetailsAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
});

exports.quoteSaveDetails = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const quoteToken = body.quoteToken ? String(body.quoteToken).trim() : '';
  const details = body.details || {};
  if (!quoteToken) throw new HttpsError('invalid-argument', 'Missing quote token.');

  const snap = await db.collection('quotes')
    .where('quoteToken', '==', quoteToken).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Quote not found.');

  const quoteId = snap.docs[0].id;
  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 500);
  const yesNo = v => (String(v) === 'Yes' ? 'Yes' : 'No');

  /* Only the fields the form is allowed to set, each trimmed to a sane length.
     Nothing here can touch price, status or approval. */
  const colors = Array.isArray(details.lightColors)
    ? details.lightColors.slice(0, 20).map(c => str(c, 40))
    : [];
  if (!colors.length) throw new HttpsError('invalid-argument', 'Please choose at least one light color.');

  const specific = yesNo(details.specificOutlet);
  await db.collection('quotes').doc(quoteId).update({
    lightColors: colors,
    lightsDescription: str(details.lightsDescription, 400),
    wireColor: str(details.wireColor, 40) || 'Any',
    outletTimer: yesNo(details.outletTimer),
    specificOutlet: specific,
    specificOutletNotes: specific === 'Yes' ? str(details.specificOutletNotes, 500) : '',
    notes: str(details.notes, 1500),
    gateCode: str(details.gateCode, 60),
    installPreference: str(details.installPreference, 60) || 'Normal Schedule',
    wantsMailedInvoice: details.wantsMailedInvoice === true,
    formCompleted: true,
    formCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    /* Somebody who has just filled in their colours is plainly not archived,
       whatever happened earlier. */
    quoteArchived: false,
    quoteArchivedReason: ''
  });

  return { ok: true };
});

/* --- publicQuoteLookup ----------------------------------------------------
 * The quotes collection is create-only for the public site: anyone may submit
 * a quote request, but reads require auth. index.html was still reading it
 * directly in two places, and both reads were failing with permission-denied.
 * Because those reads sat behind .catch() blocks that showed the generic
 * "we couldn't find your account" message, the failure was invisible — the
 * email sign-in path and the quote review card had simply stopped working.
 *
 * This returns ONLY the quotes matching the phone or email supplied. The old
 * client code downloaded the entire collection and filtered in the browser.
 *
 * Deliberately NOT rate limited. Every caller has already passed through
 * portalLookup's limiter on the guessable phone/email + last name path, and
 * tryShowQuoteReview re-runs on every portal load for customers who have a
 * quote but no invoice yet — limiting here would lock those customers out of
 * their own portal after a few refreshes.
 *
 * Input:  { phone } or { email }
 * Output: { quotes: [ { id, data } ] }
 * ------------------------------------------------------------------------- */

// Fields the public quote card needs. Anything else on a quote — internal
// pricing notes, staff comments, measurements — stays on the server.
const QUOTE_READ_FIELDS = [
  'name', 'phone', 'email', 'address', 'houseAreas', 'lightColors',
  'installPreference', 'quotedPrice', 'approvalStatus', 'formCompleted',
  'quoteToken'
];

function sanitizeQuote(data) {
  const out = {};
  QUOTE_READ_FIELDS.forEach(function (f) {
    if (data[f] !== undefined) out[f] = data[f];
  });
  return out;
}

exports.publicQuoteLookup = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const phone = digitsOnly(body.phone);
  const email = body.email ? String(body.email).toLowerCase().trim() : '';

  if (!phone && !email) {
    throw new HttpsError('invalid-argument', 'No lookup information provided.');
  }

  const all = await db.collection('quotes').get();
  const out = [];
  all.forEach(function (d) {
    const data = d.data();
    if (phone) {
      if (digitsOnly(data.phone) !== phone) return;
    } else {
      const e = data.email;
      if (!e || String(e).toLowerCase().trim() !== email) return;
    }
    out.push({ id: d.id, data: sanitizeQuote(data), _raw: data, _ref: d.ref });
  });

  /* A quote made before tokens existed has none to hand back, and the detail
     form needs one to save through - without it the customer's write goes
     straight to Firestore and is refused. Mint one here so every route into
     the form has something to prove who they are. */
  for (const entry of out) {
    if (!entry.data.quoteToken) {
      const fresh = generatePortalToken();
      try {
        await entry._ref.update({ quoteToken: fresh });
        entry.data.quoteToken = fresh;
      } catch (err) {
        // Leave it; the form will report a clear error rather than failing oddly.
      }
    }
    delete entry._raw;
    delete entry._ref;
  }
  return { quotes: out };
});

/* --- publicConfig ---------------------------------------------------------
 * settings/emailjs is staff-only, so the public site's read of it was being
 * denied. emailjsSettings stayed null, notifyBusinessOfMessage returned early
 * every time, and no notification email was ever sent when a customer used
 * the contact form or requested a quote. The messages themselves always saved
 * correctly — only the heads-up email was lost.
 *
 * Returns only the three public-safe EmailJS identifiers. The privateKey
 * (EmailJS "Access Token") is what sendNightlyInvoices uses to send mail
 * unattended, and it is never included here.
 *
 * Output: { serviceId, notifyTemplateId, publicKey }
 * ------------------------------------------------------------------------- */
exports.publicConfig = onCall({ cors: true }, async (request) => {
  const snap = await db.collection('settings').doc('emailjs').get();
  if (!snap.exists) return { configured: false };
  const data = snap.data() || {};
  return {
    configured: !!(data.serviceId && data.notifyTemplateId && data.publicKey),
    serviceId: data.serviceId || '',
    notifyTemplateId: data.notifyTemplateId || '',
    publicKey: data.publicKey || ''
  };
});

/* --- cloudinarySignature ---------------------------------------------------
 * The public quote form has no Cloudinary code at all today — photos are
 * added by hand on the admin quote card. admin.html's own upload uses an
 * UNSIGNED preset (CLOUDINARY_PRESET), which is fine there because the preset
 * name only ever ships inside the staff-only admin bundle. Putting that same
 * preset in index.html's public source would let anyone POST arbitrary files
 * into the account forever, from outside this app entirely.
 *
 * So the public form uses a SIGNED upload instead: the browser asks this
 * function for a one-time timestamp + signature, then uploads straight to
 * Cloudinary with them. The API secret never leaves the server; only a
 * signature (a SHA-1 hash) does, and it's only valid for this one upload.
 *
 * Deliberately un-gated by any quote token: a customer picks photos WHILE
 * filling out the form, before any `quotes` document (and so any token)
 * exists. Nothing sensitive is returned here — the signature is worthless
 * without also knowing which timestamp it was issued for, which travels
 * with it, and Cloudinary itself is what actually enforces it.
 *
 * Output: { timestamp, signature, apiKey, cloudName }
 * ------------------------------------------------------------------------- */
exports.cloudinarySignature = onCall(
  { cors: true, secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET] },
  async (request) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = CLOUDINARY_API_SECRET.value();
    // Cloudinary's signing rule: sort every param except file/api_key/
    // cloud_name/resource_type, join as key=value&key=value, append the API
    // secret, SHA-1 the result. We only send `timestamp`, so there's exactly
    // one param to sign.
    const signature = crypto
      .createHash('sha1')
      .update('timestamp=' + timestamp + secret)
      .digest('hex');
    return {
      timestamp,
      signature,
      apiKey: CLOUDINARY_API_KEY.value(),
      cloudName: CLOUDINARY_CLOUD_NAME
    };
  }
);

/* ⭐ THE FIX PHOTO IS DESTROYED WHEN THE FIX IS DONE (Job 4, 2026-08-21).
 * Owner: "we want the picture destroyed on the spot. There is no need for it
 * after we fix the house."
 *
 * ⚠ CLEARING fixPhotoUrl WAS NEVER DELETING ANYTHING. Two paths already blanked
 * the field, which only forgets the address — the image stays on Cloudinary for
 * ever, and Cloudinary URLs are public and unguessable-but-permanent. A photo
 * of somebody's house, with nothing left in the app pointing at it, is the
 * worst of both: still out there, and no longer visible to the office.
 *
 * ⚠ IT HAS TO BE SERVER-SIDE. Destroying needs the API secret in the signature,
 * and a secret in admin.html is a secret published to anybody who opens the
 * page. That is why this is a callable and not four lines in the browser.
 *
 * ⚠ AND IT ONLY EVER DESTROYS OUR OWN. cloudinaryPublicId refuses any URL that
 * is not res.cloudinary.com/<our cloud>/image/upload/, so a caller cannot hand
 * it somebody else's asset — and the caller never names a public_id directly,
 * only a URL we then parse. */
function cloudinaryPublicId(rawUrl) {
  const url = String(rawUrl == null ? '' : rawUrl).trim();
  const marker = 'res.cloudinary.com/' + CLOUDINARY_CLOUD_NAME + '/image/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return '';
  let rest = url.slice(at + marker.length);
  /* Strip the transformation segment cloudThumb inserts (w_440,c_limit,...) and
     the version segment (v1712345678). Both are optional and neither is part of
     the public_id. */
  const parts = rest.split('/').filter(Boolean);
  while (parts.length > 1 && (/^[a-z]+_[^/]*$/.test(parts[0]) || /^v\d+$/.test(parts[0]))) {
    parts.shift();
  }
  rest = parts.join('/');
  if (!rest) return '';
  /* The public_id keeps its folder but loses the file extension. A query string
     or fragment is not part of it either. */
  rest = rest.split('?')[0].split('#')[0];
  const dot = rest.lastIndexOf('.');
  if (dot > 0) rest = rest.slice(0, dot);
  /* ⚠ A public_id with a .. in it could reach outside the folder it names.
     Nothing we upload produces one; refuse it rather than reason about it. */
  if (!rest || rest.indexOf('..') !== -1) return '';
  /* ⚠ AND A LEFTOVER VERSION OR TRANSFORMATION SEGMENT IS NOT A FILENAME. The
     loop above only strips while something follows, so a URL ending at
     .../upload/v1/ comes out as the public_id "v1" — which would destroy a real
     asset if one were ever named that. There is no filename here; refuse.
     Caught by Suite 140, not by reasoning. */
  if (/^v\d+$/.test(rest) || /^[a-z]+_[^/]*$/.test(rest)) return '';
  return rest;
}

exports.destroyFixPhoto = onCall(
  { cors: true, secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET] },
  async (request) => {
    /* ⚠ STAFF ONLY. Every other Cloudinary-touching callable here is a signing
       helper that hands out an upload token; this one DESTROYS, so it is the
       one that must never be reachable without a login. */
    if (!request.auth) {
      throw new HttpsError('permission-denied', 'Sign in first.');
    }
    const publicId = cloudinaryPublicId((request.data || {}).url);
    /* Not one of ours, or not a Cloudinary URL at all. Not an error — the
       caller passes whatever was on the record, and a blank or an external
       link simply means there is nothing of ours to delete. */
    if (!publicId) return { ok: true, destroyed: false, reason: 'not-ours' };

    const timestamp = Math.floor(Date.now() / 1000);
    const secret = CLOUDINARY_API_SECRET.value();
    /* Cloudinary's signing rule, same as cloudinarySignature above: every
       param except file/api_key/cloud_name/resource_type, sorted, joined as
       key=value&key=value, then the secret, then SHA-1. Here that is
       public_id then timestamp — alphabetical. */
    const signature = crypto.createHash('sha1')
      .update('public_id=' + publicId + '&timestamp=' + timestamp + secret)
      .digest('hex');

    const form = new URLSearchParams();
    form.set('public_id', publicId);
    form.set('timestamp', String(timestamp));
    form.set('api_key', CLOUDINARY_API_KEY.value());
    form.set('signature', signature);

    try {
      const res = await fetch(
        'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/destroy',
        { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      /* ⚠ "not found" IS SUCCESS. The asset is gone, which is all the caller
         wanted; treating it as a failure would leave the URL on the record for
         ever, pointing at nothing. */
      const result = String(body && body.result || '');
      const gone = result === 'ok' || result === 'not found';
      if (!gone) console.error('[HU] cloudinary destroy refused:', result, body);
      return { ok: gone, destroyed: result === 'ok', result: result || 'no-answer' };
    } catch (err) {
      console.error('[HU] cloudinary destroy failed:', err);
      return { ok: false, destroyed: false, result: 'error' };
    }
  }
);

/* --- portalInvoice --------------------------------------------------------
 * The last direct Firestore read the public site did. invoices carried
 * `allow read: if true` purely to support it, which meant every invoice in
 * the business — names, addresses, amounts owed, payment status — was
 * readable by anyone. Invoice doc IDs are phone numbers, so they were
 * guessable too, and the collection-level read allowed listing them all.
 *
 * Authorization mirrors portalLookup exactly, so customer-facing behaviour
 * is unchanged:
 *   - a portalToken proves identity outright (came from their own email)
 *   - otherwise the typed last name must match the invoice's stored name,
 *     rate limited the same way the sign-in form is
 *
 * Returns { found: false } for a missing invoice AND for a failed
 * authorization. The caller already falls through to the quote card when no
 * invoice exists, so this keeps that path working — and it avoids confirming
 * to a guesser that a given phone number has an invoice at all.
 *
 * Input:  { key, token }  or  { key, lastName }
 * Output: { found, record }
 * ------------------------------------------------------------------------- */

// Only the fields the invoice card renders. Internal costing, crew notes and
// anything else on the invoice document stay on the server.
/* ⚠ Anything added here is sent to the customer's browser. Keep it to what the
   invoice card actually renders — internal costing, crew notes and everything
   else on the invoice document stay on the server.

   lastPaymentAt / lastPaymentMethod were written by the payment paths from the
   start and never whitelisted, so "did you get my payment?" could not be
   answered on screen even though the answer was sitting on the record. They
   are only ever a date and one of a few words ('paypal', 'venmo', 'manual') —
   nothing about how the payment was taken. */
const INVOICE_READ_FIELDS = ['name', 'phone', 'email', 'install', 'removal', 'deposit', 'credits', 'creditNotes', 'changeFees', 'changeFeeNotes',
  'lastPaymentAt', 'lastPaymentMethod'];

function sanitizeInvoice(data) {
  const out = {};
  INVOICE_READ_FIELDS.forEach(function (f) {
    if (data[f] !== undefined) out[f] = data[f];
  });
  return out;
}

exports.portalInvoice = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const key = String(body.key || '').trim();
  const token = body.token ? String(body.token).trim() : '';
  const lastName = body.lastName ? String(body.lastName) : '';

  if (!key) throw new HttpsError('invalid-argument', 'No invoice key provided.');

  const snap = await db.collection('invoices').doc(key).get();
  if (!snap.exists) return { found: false };
  const data = snap.data() || {};

  let authorized = false;

  if (token) {
    const match = await findByToken(token);
    // The token must belong to the customer this invoice is for — holding
    // any valid token must not grant access to somebody else's invoice.
    if (match && invoiceKeyFor(match.data) === key) authorized = true;
  }

  if (!authorized && lastName) {
    /* Rate limited on FAILURE ONLY, and only on this branch.
     *
     * The original comment here said this path must not be limited at all,
     * because portalInvoice re-runs on every portal render and a naive counter
     * would lock a customer out of their own invoice after a few page loads.
     * That reasoning is right, and it is preserved: a successful match spends
     * nothing. But invoice doc IDs are phone digits, so with no limit at all
     * this was a freely enumerable balance lookup — and it is the second door
     * the weak nameMatches opened. Counting only misses closes it without
     * touching anyone signing in correctly. */
    /* Mirrors portalLookup exactly, household and all — if the two disagree a
       customer signs in and then cannot see the invoice they just reached.
       ⚠ `data` here is the INVOICE, not a customer record, so it carries no
       billToPhone of its own. The invoice's id IS the billing key, which is
       precisely what the household query needs. */
    if (await nameMatchesHousehold({ name: data.name, billToPhone: key }, '', lastName)) {
      authorized = true;
    } else {
      await checkRateLimit('invoice_' + key);
    }
  }

  if (!authorized) return { found: false };

  const record = sanitizeInvoice(data);
  /* Computed, not copied via INVOICE_READ_FIELDS — lastLightChangeFeeAt
     itself stays server-only; only the free-window END TIME needs to reach
     the browser, and only so the portal can decide BEFORE a save whether to
     warn about a $30 charge that, this same 48h window, portalSave's
     'lights' section would refuse to actually apply. Without this the
     browser has no way to know it's still in the free window until AFTER
     saving, so the confirm dialog warned about a fee even on a genuinely
     free change. */
  const lastFeeAt = data.lastLightChangeFeeAt && data.lastLightChangeFeeAt.toMillis
    ? data.lastLightChangeFeeAt.toMillis() : 0;
  record.lightChangeFreeUntil = lastFeeAt > 0 ? lastFeeAt + (48 * 60 * 60 * 1000) : null;

  /* ⭐ WHAT IS STILL OWED FROM LAST SEASON, computed here rather than worked out
   * again in the browser. Addie, 2026-09-01: "we need to emphasize that is last
   * years payment so someone doesn't get mad and think they are charged twice."
   *
   * The portal has to be able to say, in words, that the amount on the button is
   * last season's and not a second charge for this year — and to do that it needs
   * the figure and the year.
   *
   * ⚠ COMPUTED, NOT A THIRD COPY OF THE RULE. js/money.js and this file already
   * carry the carried-balance maths and money-parity.test.js holds them together;
   * a third implementation inside index.html would be outside that guard entirely,
   * and it would be the one telling the customer what they are paying. The same
   * argument as lightChangeFreeUntil above: derive it on the server, send the
   * answer. */
  record.arrearsOutstanding = arrearsOutstandingServer(data);
  record.arrearsSeason = arrearsYearServer(data) || '';

  /* ⭐ HAS THEIR BILL ACTUALLY GONE OUT YET (added 2026-09-02). Addie: "I want to make
   * it clear to the member that this is their payment however they do not need to pay
   * until after they get an invoice from us."
   *
   * ⚠ THE PORTAL HAD NO WAY TO KNOW. It shows "Current Balance" and a pay button the
   * moment a house is priced, which is months before the nightly run bills anybody —
   * so a customer signing in to check their colours in September was being shown a
   * number that reads as due now, with nothing on the page saying otherwise.
   *
   * ⭐ `invoicedAt` IS THE ANSWER AND IT IS ALREADY THE ONE SOURCE OF TRUTH for when a
   * bill starts counting: runInvoiceBatch stamps it in the same pass that sends the
   * email, the due date and the Overdue flag are both measured from it, and Start New
   * Season clears it, so it means THIS season's bill. Deriving a second "have we
   * billed them" answer from invoiceEmailSent on the houses would be a third opinion
   * about one fact, and the two would eventually disagree on a multi-house bill.
   *
   * ⚠ COMPUTED, NOT WHITELISTED. Only the yes/no crosses the wire; the timestamp
   * itself stays server-side, exactly as lightChangeFreeUntil does two blocks above.
   * ⚠ AND IT IS A BOOLEAN OF A STAMP, so an invoice written by the office before any
   * nightly run correctly answers false — that customer has genuinely not been billed. */
  record.billIssued = !!data.invoicedAt;

  /* ⭐ WHO THIS BILL IS FOR, sent from HERE and not only from portalLookup.
   *
   * portalLookup already returned `houses`, but only the token link and the
   * email sign-in go through it — the ordinary phone-and-surname sign-in calls
   * renderCustomerInvoicePage straight away, so for most customers the list was
   * never fetched at all and the "this bill covers N properties" box could not
   * appear. The BILL is the right place for it anyway: it is authorised by the
   * same check that just authorised the balance, and reading the invoice's own
   * billedHouseIds means the rows and the total can never disagree.
   *
   * Falls back to the billing-key query for an invoice written before
   * billedHouseIds existed. A failure here never denies anybody their invoice:
   * an empty list just hides one box. */
  let houses = [];
  try {
    houses = Array.isArray(data.billedHouseIds) && data.billedHouseIds.length
      ? await billedHousesByIds(data.billedHouseIds)
      : await billedHousesByKey(key, '', null);
  } catch (err) {
    console.error('[HU] billed-house lookup failed', err);
    houses = [];
  }

  // Only sent when there is genuinely more than one — a single-house customer
  // sees no change at all.
  return { found: true, record, houses: houses.length > 1 ? houses : [] };
});

/* ---------------------------------------------------------------------------
 * sendNightlyInvoices — runs every night at 7:00 PM Mountain Time.
 *
 * Checks every house marked "Done" by the crew that hasn't been billed yet
 * (regardless of which day it was actually completed — so a house marked
 * Done late, after 7pm or the next morning, still gets caught on the very
 * next run instead of being missed) and sends an automatic invoice email:
 *   - already paid in full  -> "Nightly Auto-Invoice — Paid Receipt" template
 *   - still owes money      -> "Nightly Auto-Invoice — Unpaid" template
 * Houses flagged "needs fix" or marked "Didn't Get To" by the crew are
 * skipped entirely and never billed. Each house is only ever billed once
 * (guarded by invoiceEmailSent on the jobAddresses doc) — there's no
 * "today vs yesterday" distinction at all, which is what keeps this from
 * ever double-billing or silently skipping a late completion.
 *
 * Turn this on/off anytime from Admin > Automation > EmailJS Setup >
 * "Send nightly invoice emails automatically" — no redeploy needed.
 *
 * Requires, saved in Firestore under settings/emailjs (same place the
 * other EmailJS fields already live, set from the Admin UI):
 *   serviceId, templateId, publicKey, privateKey
 * The privateKey (EmailJS "Access Token") is what lets this function send
 * mail on its own overnight, without a browser open.
 * ------------------------------------------------------------------------- */
function todayStrInDenver() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

// Sends one text through Twilio. Used by the nightly alert. Only works inside a
// function that declares the TWILIO secrets. Never throws — returns {ok}.
async function twilioSendRaw(to, body) {
  const toNumber = toE164(to);
  if (!toNumber) return { ok: false };
  try {
    const sid = TWILIO_ACCOUNT_SID.value();
    const authToken = TWILIO_AUTH_TOKEN.value();
    const from = TWILIO_PHONE_NUMBER.value();
    const basicAuth = Buffer.from(sid + ':' + authToken).toString('base64');
    const params = new URLSearchParams();
    params.append('To', toNumber);
    params.append('From', from);
    params.append('Body', body);
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
async function logNightlyInvoiceRun(data) {
  await db.collection('nightlyInvoiceLog').add(Object.assign(
    { runAt: admin.firestore.FieldValue.serverTimestamp() },
    data
  ));
  // Text the owner a one-line summary so a missed or failed run can't slip by.
  // Twilio is separate from EmailJS, so this still reaches you on the night
  // email is the thing that's broken. An alert failure must never break the run.
  try {
    const cfgSnap = await db.collection('settings').doc('nightlyInvoiceAutomation').get();
    const alertPhone = cfgSnap.exists ? (cfgSnap.data().alertPhone || '') : '';
    if (alertPhone) {
      const parts = [(data.sentCount || 0) + ' sent'];
      if (data.skippedNeedsFix) parts.push(data.skippedNeedsFix + ' need fix');
      if (data.skippedNotDone) parts.push(data.skippedNotDone + ' skipped');
      // Called out by name, not folded into the generic skip count — an
      // uninvoiceable customer is a bill that will never be sent, not a bill
      // that is waiting.
      /* ⚠ THE WORDING CHANGED WITH THE BEHAVIOUR (2026-08-30). It read "cannot be
         billed", which was true while a payer with no email got no invoice document at
         all. They are billed now — the invoice is raised and waiting in their member
         portal, which they reach with their phone — and the only thing missing is
         somebody sending it. Addie: "I'll send invoices that only have phone number on
         file myself." A summary that still said "cannot be billed" would read as work
         that is impossible rather than work that is hers. */
      if (data.skippedNoEmail) parts.push(data.skippedNoEmail + ' BILLED, SEND BY HAND (no email)');
      parts.push((data.errorCount || 0) + ' error' + (data.errorCount === 1 ? '' : 's'));
      let body = 'Highlighting Utah billing (' + (data.triggeredBy || 'run') + '): ' + parts.join(', ') + '.';
      if (data.skippedNoEmail && data.noEmailNames && data.noEmailNames.length) {
        body += ' Send by hand: ' + data.noEmailNames.slice(0, 3).join(', ') +
          (data.noEmailNames.length > 3 ? ' +' + (data.noEmailNames.length - 3) + ' more' : '') + '.';
      }
      if (data.errorCount && data.errors && data.errors.length) body += ' First issue: ' + String(data.errors[0]).slice(0, 90);
      await twilioSendRaw(alertPhone, body);
    }
  } catch (e) {
    console.error('[HU] nightly alert SMS failed:', e);
  }
}

/* Round to whole cents. Money arithmetic in floating point leaves crumbs:
 * 0.1 + 0.2 is 0.30000000000000004, so a customer who has paid every cent can
 * come out a fraction short and be billed as "Partial Payment" against a
 * balance that prints as $0.00.
 *
 * ⚠ js/money.js has its own copy of this (centsOf). Change both, same push. */
function centsOf(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100);
}

function computeInvoiceStatusServer(install, removal, deposit, credits, changeFees) {
  // Compared in whole cents — see centsOf.
  const gross = centsOf(install) + centsOf(removal) + centsOf(changeFees);   // the real charge (incl. light-change fees)
  const total = gross - centsOf(credits);                          // owed after credits
  const paid = centsOf(deposit);
  if (gross <= 0 && paid <= 0) return 'Unpaid';                    // a truly blank invoice
  if (total <= 0) return 'Paid in Full';                         // credits (and/or payments) cover it all
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid in Full';
  return 'Partial Payment';
}

/* ⭐ THE ONE LIGHT-CHANGE RULE — server copy (added 2026-08-21).
 *
 * ⚠ js/money.js has its own copy of this (applyLightChange). Change both, in
 * the same push. money-parity.test.js feeds both the same inputs and fails the
 * build if they disagree — the same protection computeInvoiceStatus gets, and
 * for the same reason: the office screen and the customer's own portal must
 * never charge two different amounts for one change.
 *
 * The full reasoning, the owner's words and the traps are written out once,
 * over the browser copy in js/money.js. Read that before touching this. In
 * short: the two $30 fees are separate and stack; the free window and the
 * route lock are the same 48 hours; the window lives on the CUSTOMER, opened
 * by becoming a customer and by a charged change; a first-time colour is not a
 * change; and a fee lands on the current invoice unless it has already been
 * sent, in which case it goes to next season. */
/* ⚠ THE SERVER'S COPY OF THE SET-UP FEE. js/money.js is the other one and
   money-parity.test.js runs them side by side — this file cannot import a browser
   module, which is the whole reason there are two. Change one, change the other, in
   the same push. */
const NEW_MEMBER_FEE = 25;
const LIGHT_CHANGE_FEE = 30;
const LIGHT_WINDOW_MS = 48 * 60 * 60 * 1000;

function applyLightChangeServer(o) {
  const opts = o || {};
  const now = Number(opts.nowMs) || 0;
  const oldLights = String(opts.oldLights == null ? '' : opts.oldLights);
  const newLights = String(opts.newLights == null ? '' : opts.newLights);
  const lockedUntil = Number(opts.lockedUntil) || 0;

  const differs = newLights !== oldLights;
  const isChange = differs && !!oldLights && !!newLights;
  const withinFreeWindow = lockedUntil > now;
  const charge = isChange && !withinFreeWindow;

  return {
    isChange: isChange,
    withinFreeWindow: withinFreeWindow,
    feeAmount: charge ? LIGHT_CHANGE_FEE : 0,
    feeDestination: !charge ? 'none' : (opts.invoiceSent ? 'nextSeason' : 'invoice'),
    feeReason: charge ? 'Light change' : '',
    opensNewWindow: charge,
    lightsLockedUntil: charge ? (now + LIGHT_WINDOW_MS) : 0,
    windowEndsAt: charge ? (now + LIGHT_WINDOW_MS) : lockedUntil,
    raiseReassignNote: differs && !!newLights && !!opts.scheduled,
    setLightsChangedAt: isChange
  };
}

async function runInvoiceBatch(triggeredBy) {
  const todayStr = todayStrInDenver();
  let sentCount = 0, skippedNeedsFix = 0, skippedNotDone = 0, errorCount = 0;
  // Payers with an installed house and no email address anywhere in their
  // group. They cannot be invoiced at all, so they are named in the run log
  // rather than silently passed over.
  let skippedNoEmail = 0;
  const noEmailNames = [];
  const errors = [];

  try {
    const emailSettingsSnap = await db.collection('settings').doc('emailjs').get();
    const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};
    const { serviceId, templateId, privateKey, publicKey } = emailSettings;
    if (!serviceId || !templateId || !privateKey) {
      const result = {
        dateStr: todayStr, sentCount: 0, skippedNeedsFix: 0, skippedNotDone: 0,
        skippedNoEmail: 0, noEmailNames: [],
        errorCount: 1, errors: ['EmailJS not fully set up yet \u2014 need Service ID, Template ID, and Private Key under Automation > EmailJS Setup.'],
        triggeredBy
      };
      await logNightlyInvoiceRun(result);
      return result;
    }

    const pricingSnap = await db.collection('pricing').doc('config').get();
    const perFootRate = pricingSnap.exists ? (pricingSnap.data().perFootRate || 0) : 0;

    // Bills any house marked Done that hasn't been invoiced yet — no matter
    // which calendar day it was actually completed on. This avoids ever missing
    // a house that gets marked Done late (after 7pm, or the next morning): it
    // simply gets caught on the very next nightly run instead of being skipped.
    // invoiceEmailSent is the only guard that matters, so each house is only
    // ever billed once, exactly once, whenever it first becomes eligible.
    /* --- Billing runs per PAYER, not per house ---------------------------
       A customer can own more than one address (a second home, a cabin). Each
       address stays its own jobAddresses record with its own price, customer
       number, bins and route stop - but they share ONE invoice, keyed by the
       payer's phone (see invoiceKeyFor here and syncPayerInvoice in admin).

       Running house-by-house broke that in two ways: when an invoice already
       existed the second house's price was never added to it, and the customer
       got a separate email for every house. So the run now groups every house
       by its payer key first, and bills a payer only once EVERY one of their
       houses is installed - one invoice covering them all, sent the night the
       last one goes up.

       A house that has RSVP'd 'no' is not coming this season, so it is left
       out of the "are they all finished" test - otherwise one cancelled
       address would hold up that payer's bill forever.

       Single-house customers are completely unaffected: same total, same
       wording, same one email, same timing as before. -------------------- */
    const allCustsSnap = await db.collection('jobAddresses').get();

    const payerGroups = new Map();
    allCustsSnap.forEach(function (d) {
      const data = d.data() || {};
      // A house billed to somebody else joins THAT payer's group instead.
      const billTo = digitsOnly(data.billToPhone);
      const key = billTo || invoiceKeyFor(data);
      if (!key) return;                    // no phone and no email: nothing to bill to
      if (!payerGroups.has(key)) payerGroups.set(key, []);
      payerGroups.get(key).push({ id: d.id, ref: d.ref, data: data });
    });

    /* The $30 join fee is a decision about the CUSTOMER, so it is asked of each
       of their houses and charged once if any of them qualifies. Unchanged
       logic, just lifted out of the loop so a group can ask it per house. */
    function looksLikeNewMember(cust) {
      // chargeNewMemberFee (set on the Add Customer form, and carried over
      // automatically from the quote's set-up fee checkbox) is the real
      // decision the office made about this specific customer, and it is now
      // the ONLY thing that charges the $30 join fee. Anything else - unset,
      // false, or a record predating the field - is treated as "not new" and
      // is never charged.
      //
      // There used to be a fallback for undefined: guess from the enrollment
      // year, charging anyone whose createdAt fell in the current year. That
      // turned into a real money risk once the customer list was bulk
      // imported, because the import stamped all ~945 records with the same
      // createdAt in the current year and none of them has the checkbox set -
      // so the guess said "new member" for essentially the whole book, and
      // every one of them would have picked up a $30 fee the night their
      // install was marked complete. Charging nobody by mistake is a bad day;
      // charging 945 people by mistake is a much worse one, so an unset box
      // now means no fee and the office ticks it for anyone who owes it.
      return cust.chargeNewMemberFee === true;
    }

    for (const [invoiceKey, houses] of payerGroups) {
      try {
        /* Who is on this bill at all — see houseIsOnTheBillServer. A house sitting
           the season out is not one of the houses the hold below waits for, because
           no crew is ever sent to it. */
        const active = houses.filter(function (h) { return houseIsOnTheBillServer(h.data); });
        if (!active.length) continue;

        // Nothing to do unless at least one of them is waiting on its first bill.
        const unbilled = active.filter(function (h) { return !h.data.invoiceEmailSent; });
        if (!unbilled.length) continue;      // this payer was billed on an earlier run

        // HOLD until every active house is finished. A house still needing a
        // fix counts as unfinished - the whole bill waits for the fix.
        if (active.some(function (h) { return h.data.completed === true && h.data.needsFix; })) {
          skippedNeedsFix++; continue;
        }
        if (active.some(function (h) { return h.data.completed !== true; })) {
          skippedNotDone++; continue;
        }

        /* The payer is the house the invoice key actually belongs to, and when
           several of them are (four Anderson houses share one phone) THE LOWEST
           CUSTOMER NUMBER WINS -- the longest-standing account, and so the likeliest
           bill payer. Matches payerHouseOf in admin.html; the two must agree, because
           this writes the name the customer reads on their invoice email and that one
           writes the name the office reads on the screen.

           This was a bare .find(), so the bill was addressed to whichever house came
           back first and the greeting on a customer's invoice could change from one
           night to the next. A group made only of bill-to houses still falls back to
           the group, sorted the same way rather than taken in arrival order. */
        const payerSort = function (a, b) {
          const na = Number(a.data.customerNumber) || Infinity;
          const nb = Number(b.data.customerNumber) || Infinity;
          if (na !== nb) return na - nb;
          return String(a.id).localeCompare(String(b.id));
        };
        const payerOwn = active.filter(function (h) {
          return !digitsOnly(h.data.billToPhone) && invoiceKeyFor(h.data) === invoiceKey;
        });
        const payer = (payerOwn.length ? payerOwn : active).slice().sort(payerSort)[0];

        const withEmail = active.find(function (h) { return !!h.data.email; });
        const email = payer.data.email || (withEmail ? withEmail.data.email : '');
        /* ⚠ THE SAME RUN CLEARS IT. A flag with only one way in is the sticky
           bug this file has already been bitten by; the writer that sets it is
           the only thing that should decide it is over. Written only when it is
           actually set, so an ordinary night writes nothing extra to ~960
           records. */
        if (payer.data.cannotBillNoEmail) {
          await tryFirestore('no-email flag clear', () =>
            db.collection('jobAddresses').doc(payer.id).update({
              cannotBillNoEmail: false, cannotBillNoEmailAt: null
            }));
        }

        const phone = digitsOnly(payer.data.phone);
        const groupSum = active.reduce(function (s, h) { return s + (Number(h.data.housePrice) || 0); }, 0);

        const invRef = db.collection('invoices').doc(invoiceKey);
        const invSnap = await invRef.get();
        const inv = invSnap.exists
          ? invSnap.data()
          : { install: groupSum, removal: 0, deposit: 0, name: payer.data.name, phone: phone, email: email };

        /* An existing single-house invoice keeps whatever total the office put
           on it - exactly how this has always behaved. A payer with more than
           one house is re-summed from their house prices, because that is the
           bug being fixed here: house two's price was never being added. */
        /* Re-add the $30 join fee when re-summing. groupSum is house prices
           only, so overwriting install with it dropped a fee an earlier run had
           already folded in — and the isNewMember block below won't put it back,
           because newMemberFeeApplied is already true. syncPayerInvoice in
           admin.html does exactly this; the two must agree. */
        if (invSnap.exists && active.length > 1) {
          inv.install = groupSum + (inv.newMemberFeeApplied ? NEW_MEMBER_FEE : 0);
        }

        const isNewMember = active.some(function (h) { return looksLikeNewMember(h.data); });
        if (isNewMember && !inv.newMemberFeeApplied) {
          inv.install = (Number(inv.install) || 0) + NEW_MEMBER_FEE;
          inv.newMemberFeeApplied = true;
          /* ⭐ WHEN THE $30 JOIN FEE WAS CHARGED (added 2026-08-28). Addie: "Everything
             that can be changed for members or added to members account including 30
             dollars fees ... should be dated." The flag said IF, never WHEN — and this
             is the one fee with no note of its own to carry a date, because it is folded
             straight into `install` rather than listed like the change fee.
             ⚠ Start New Season sets the flag back to false, so this is stamped afresh
             each season and answers "when were they charged it THIS year", which is the
             question asked when a customer queries their bill. */
          inv.newMemberFeeAppliedAt = admin.firestore.Timestamp.fromMillis(nowMs);
        }
        if (inv.install == null) inv.install = groupSum;

        /* ⭐ A LIGHT CHANGE MADE AFTER LAST SEASON'S BILL HAD ALREADY GONE OUT,
           now falling due. Owner: "if invoice has already been sent out but they
           change there lights after invoice is sent out than the 30 dollars will
           be charged for next season."

           Nothing re-opens a sent invoice — invoiceEmailSent is only cleared by
           Start New Season — so portalSave parks the charge on the CUSTOMER as
           carryoverCharge, which Start New Season does not touch, and it lands
           here on the night their lights go back up. The exact mirror of
           carryoverCredit below, and it is applied FIRST so a credit can be
           drawn against the higher balance rather than against a total that is
           about to grow.

           ⚠ SUMMED ACROSS THE WHOLE GROUP, not read off the payer alone. The
           person who changed their colours is not always the person who pays —
           a child on a parent's bill is the ordinary case here — so a charge
           read only from payer.data would silently never be collected. */
        let chargesApplied = 0;
        const chargeHouses = active.filter(function (h) {
          return (Number(h.data.carryoverCharge) || 0) > 0;
        });
        if (chargeHouses.length) {
          const carriedNotes = [];
          chargeHouses.forEach(function (h) {
            const amt = Number(h.data.carryoverCharge) || 0;
            chargesApplied += amt;
            /* Name the house on a multi-property bill, or the customer sees a
               $30 line and no way to tell which of their houses it is for. */
            const where = active.length > 1 ? (' — ' + (h.data.address || h.data.name || '')) : '';
            const own = Array.isArray(h.data.carryoverChargeNotes) ? h.data.carryoverChargeNotes : [];
            if (own.length) {
              own.forEach(function (n) {
                carriedNotes.push({
                  amount: Number(n.amount) || 0,
                  reason: (n.reason || 'Light change') + ' (carried from last season)' + where,
                  date: n.date || new Date().toISOString()
                });
              });
            } else {
              carriedNotes.push({ amount: amt,
                reason: 'Light change (carried from last season)' + where,
                date: new Date().toISOString() });
            }
          });
          if (chargesApplied > 0) {
            inv.changeFees = (Number(inv.changeFees) || 0) + chargesApplied;
            inv.changeFeeNotes = (Array.isArray(inv.changeFeeNotes) ? inv.changeFeeNotes : [])
              .concat(carriedNotes);
          }
        }

        // Draw down any credit the customer carried over (e.g. a referral earned
        // while already paid up). Credit only reduces the balance to $0; whatever
        // is left keeps waiting on the customer for the next invoice. Carryover
        // lives on the payer's own record, since the invoice is theirs.
        let carryoverApplied = 0;
        const carryAvail = Number(payer.data.carryoverCredit) || 0;
        if (carryAvail > 0) {
          const grossNow = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
          const preBalance = Math.max(0, grossNow - (Number(inv.credits) || 0) - (Number(inv.deposit) || 0));
          carryoverApplied = Math.min(carryAvail, preBalance);
          if (carryoverApplied > 0) {
            inv.credits = (Number(inv.credits) || 0) + carryoverApplied;
            inv.creditNotes = (Array.isArray(inv.creditNotes) ? inv.creditNotes : [])
              .concat([{ amount: carryoverApplied, reason: 'Carryover credit', date: new Date().toISOString() }]);
          }
        }

        /* Record which houses this bill covers, exactly as syncPayerInvoice does
           in admin. Three things downstream read it and behave wrongly without
           it: the printed invoice drops back to one summary line instead of a
           row per property, the invoice list shows no addresses, and - worst -
           the "multi-house invoice, prices left unchanged" guard stops firing,
           so editing the Amount would write the whole combined total back as a
           single house's price. */
        inv.billedHouseIds = active.map(function (h) { return h.id; });

        const status = computeInvoiceStatusServer(inv.install, inv.removal || 0, inv.deposit || 0, inv.credits || 0, inv.changeFees || 0);
        inv.status = status;
        inv.name = inv.name || payer.data.name || '';
        inv.email = inv.email || email;
        inv.phone = inv.phone || phone;
        /* The date this invoice was ISSUED, stamped once and never moved after.
           It was read in four places — the {{due_date}} on the email below, the
           printed invoice's date, the Overdue flag, and the office copy of the
           due-date maths — and written in none of them, so all four silently
           ran off updatedAt instead. updatedAt moves every time anybody touches
           the record, so correcting a spelling in someone's name pushed their
           due date another 30 days out and un-flagged a genuinely overdue bill.
           A real Timestamp (not a server sentinel) so the {{due_date}} maths a
           few lines below reads it back on this very first run. */
        if (!inv.invoicedAt) inv.invoicedAt = admin.firestore.Timestamp.now();
        inv.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await invRef.set(inv, { merge: true });

        /* Clear the carried light-change charges off the houses that owed them,
           immediately after the invoice write and for exactly the reason given
           for the credit below: if this waited for a successful send and the
           email failed, the invoice would keep the $30 while carryoverCharge
           stayed set, and the next run would charge it a second time.

           ⚠ Each house is cleared on its OWN record, because that is where the
           charge was raised — clearing only the payer would leave a sibling
           house owing it forever and billing it again every season. */
        if (chargesApplied > 0) {
          for (const h of chargeHouses) {
            try {
              await h.ref.update({ carryoverCharge: 0, carryoverChargeNotes: [] });
            } catch (e) {
              console.error('[HU] clearing a carried light-change charge failed for ' + h.id, e);
            }
          }
        }

        // Draw the used carryover off the customer NOW, right after the invoice
        // write - NOT after the email. If it waited for a successful send and the
        // email failed, the invoice would keep the applied credit while
        // carryoverCredit stayed full, and the next run would apply it a second
        // time (double credit = under-charge). Writing it here makes the two
        // docs consistent even if the email later fails.
        if (carryoverApplied > 0) {
          const carryLeft = Math.max(0, carryAvail - carryoverApplied);
          await payer.ref.update({
            carryoverCredit: carryLeft,
            carryoverNotes: carryLeft > 0
              ? [{ amount: carryLeft, reason: 'Carryover credit remaining', date: new Date().toISOString() }]
              : []
          });
        }

        /* ⭐ THE BILL IS RAISED EVEN WHEN THERE IS NOWHERE TO SEND IT (moved 2026-08-30).
           Addie: "How invoice bills. So if no email on file than invoice by phone for
           member portal. I'll send invoices that only have phone number on file myself."

           ⚠ THIS BLOCK USED TO SIT ABOVE THE INVOICE WRITE, so a payer with no email got
           no invoice DOCUMENT at all — not merely no email. Their member portal, which
           they sign into with their phone, had nothing to show them, and the work stayed
           unbilled with no record anywhere of what was owed. Moving it here is the whole
           change: everything above has already run, so the invoice exists, the join fee is
           on it, a carried charge has landed and a carryover credit has been drawn.

           ⚠ IT MUST STAY BELOW THE CARRYOVER DRAWDOWN, and that ordering is the reason the
           block moved HERE rather than a few lines earlier. Both the charge-clearing and
           the credit drawdown are written immediately after the invoice so the two
           documents agree even if what follows fails; skipping out above them would leave
           the invoice holding a credit the customer still has in full, and the next run
           would apply it a second time.

           ⚠ AND `invoiceEmailSent` IS DELIBERATELY NOT SET. It means the bill has gone
           out, and it has not — so they stay on tomorrow night's list and in the nightly
           summary until somebody deals with them, which is what "I'll send those myself"
           needs. Re-running is safe: the fee is guarded by `newMemberFeeApplied`, the
           carried charge was cleared off each house, the credit was drawn off the payer,
           and the note below only posts once.

           ⚠ AND IT IS STILL COUNTED AND NAMED in the nightly text. The count now means
           "billed, but you must send it" rather than "skipped entirely"; the summary
           wording says so. */
        /* No email address anywhere in this payer's group, so there is nothing
           to send an invoice to. This used to be a bare `continue`: not counted
           as sent, skipped or errored, so the nightly text read "0 sent, 0
           errors" and looked healthy while an installed house went unbilled all
           season. A phone-only signup is the ordinary case for a phone enquiry,
           so this is not rare. Counted and named now, and Health Check has a
           matching "Customer with no email address" row. */
        if (!email) {
          skippedNoEmail++;
          noEmailNames.push(payer.data.name || payer.data.address || payer.id);
          /* ⭐ AND IT LANDS ON THE CUSTOMER, NOT ONLY IN LAST NIGHT'S TEXT
             (hole H, 2026-08-21). Counting them fixed the "0 sent, 0 errors"
             lie; it did not make the work findable. A number in a nightly
             summary is the same number every night, so it reads as background
             noise while an installed house — materials, a crew's day, a bundle
             made — goes unbilled all season.

             With the flag on the record the office can filter All Customers,
             see who they are and go and get an email address.

             ⚠ SET AND CLEARED BY THE SAME RUN, so it cannot go stale the way
             maybeNextYear did — one writer, one rule. A customer who gains an
             email is cleared on the next nightly pass, and the office screen
             does not even wait for that: the tag also checks live that they
             still have no email, so it disappears the moment one is typed.
             Stored flag, derived display — the same shape as derivedDoneFor.

             ⚠ AND THE NOTE GOES UP ONCE, not nightly. Guarded on the flag not
             already being set: a note every night for the same house is how
             somebody learns to ignore the folder. */
          if (!payer.data.cannotBillNoEmail) {
            await tryFirestore('no-email flag', () =>
              db.collection('jobAddresses').doc(payer.id).update({
                cannotBillNoEmail: true,
                cannotBillNoEmailAt: admin.firestore.FieldValue.serverTimestamp()
              }));
            await tryFirestore('no-email note', () =>
              db.collection('messages').add({
                topic: 'Cannot Be Billed', folder: 'System',
                name: payer.data.name || '', phone: payer.data.phone || '', email: '',
                contactMethod: '',
                /* ⚠ THE NOTE SAID THEY HAD NOT BEEN CHARGED, and since 2026-08-30 that is
                   no longer true — the invoice is raised and waiting in their portal, and
                   only the sending is manual. Left as it was, this note described the one
                   customer whose bill DOES exist as one who had been missed entirely. */
                message: (payer.data.name || 'A customer') + ' has no email address ' +
                         'anywhere on their bill. Their invoice has been raised and is ' +
                         'waiting in their member portal, which they sign into with their ' +
                         'phone \u2014 but nothing could be emailed, so it needs sending by ' +
                         'hand. They are in All Customers under the "Cannot Be Billed" ' +
                         'filter. Adding an email address clears this by itself.',
                autoQueuedToWarehouse: false, needsReassign: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              }));
          }
          continue;
        }


        /* One house reads exactly as it always has. Two or more get a line per
           address so the customer can see what each one cost - the whole point
           of a combined bill is that it still itemises. */
        function feetLineFor(c) {
          const feet = Number(c.measuredFeet) || 0;
          const basePrice = Number(c.housePrice) || 0;
          return (feet && perFootRate)
            ? ('Installation service \u2014 ' + feet + ' ft @ $' + perFootRate.toFixed(2) + '/ft = $' + basePrice.toFixed(2))
            : ('Installation service = $' + basePrice.toFixed(2));
        }
        const feetLine = active.length === 1
          ? feetLineFor(active[0].data)
          : active.map(function (h) {
              const where = h.data.address || h.data.street || 'This address';
              return '<b>' + where + '</b><br>' + feetLineFor(h.data);
            }).join('<br><br>');
        const newMemberLine = isNewMember ? 'Installation fee = $30.00' : '';

        const changeFeesTotal = Number(inv.changeFees) || 0;
        const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + changeFeesTotal;
        const credits = Number(inv.credits) || 0;
        const paid = Number(inv.deposit) || 0;
        const amountDue = Math.max(0, total - credits - paid);
        const creditLines = (Array.isArray(inv.creditNotes) ? inv.creditNotes : [])
          .map(function (c) { return (c.reason || 'Credit') + ' = -$' + (Number(c.amount) || 0).toFixed(2); })
          .join('<br>');
        // Light-change fees show as their own positive line(s) on the invoice.
        const feeLines = (Array.isArray(inv.changeFeeNotes) ? inv.changeFeeNotes : [])
          .map(function (f) { return (f.reason || 'Light change fee') + ' = $' + (Number(f.amount) || 0).toFixed(2); })
          .join('<br>');

        const templateName = status === 'Paid in Full'
          ? 'Nightly Auto-Invoice \u2014 Paid Receipt'
          : 'Nightly Auto-Invoice \u2014 Unpaid';
        // Match on a flattened name (dashes, spacing and case ignored) rather
        // than the exact characters: an em dash, en dash and hyphen are
        // indistinguishable in a text box, and an invoice must not fall back to
        // the built-in wording just because someone typed a hyphen.
        const tplSnap = await findTemplateSnapByName(templateName);
        let body;
        let tplData = null;
        if (tplSnap.empty) {
          // A missing or renamed template must NOT silently stop billing. Fall
          // back to a built-in body (with all the tokens) so the invoice still
          // goes out; note it in the run log so staff can restore the template.
          body = status === 'Paid in Full'
            ? 'Hi {{name}},<br><br>Thank you — your Christmas lights invoice is paid in full.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{fee_lines}}<br>{{credit_lines}}<br><br>Amount paid: {{amount_paid}}<br><br>{{view_portal_button}}<br><br>— Highlighting Utah'
            : 'Hi {{name}},<br><br>Here is your Christmas lights invoice.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{fee_lines}}<br>{{credit_lines}}<br><br>Amount due: {{amount_due}}<br>Please pay by {{due_date}}.<br><br>Pay your invoice here:<br><br>{{pay_button}} {{venmo_button}}<br><br>Questions? {{message_link}}<br><br>— Highlighting Utah';
          if (errors.length < 10) errors.push('Template missing, used built-in fallback: ' + templateName);
        } else {
          tplData = tplSnap.docs[0].data();
          body = tplData.body || '';
        }
        /* ⚠ THE ONE EMAIL EVERY CUSTOMER GETS, sent by a run nobody is watching.
           A blank subject line on a bill is what makes it look like spam. */
        const invoiceSubject = templateSubjectOr(tplData, status === 'Paid in Full'
          ? 'Your Highlighting Utah invoice \u2014 paid in full'
          : 'Your Highlighting Utah invoice');

        const token = await ensureToken(payer.id, payer.data);
        const portalUrl = 'https://highlightingutah.com/#/payment' + (token ? ('?token=' + token) : '');
        const messagesUrl = 'https://highlightingutah.com/#/contact';
        const venmoUrl = 'https://venmo.com/HighLightingUtah?txn=pay&amount=' + amountDue.toFixed(2) + '&note=' + encodeURIComponent('Christmas Lights');
        const btnStyleGold = 'display:inline-block; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:15px; margin:6px 8px 6px 0; background:#D89F3D; color:#1E3B2C;';

        body = body.split('{{name}}').join(payer.data.name || 'there');
        body = body.split('{{feet_line}}').join(feetLine);
        body = body.split('{{new_member_fee_line}}').join(newMemberLine);
        body = body.split('{{credit_lines}}').join(creditLines);
        body = body.split('{{fee_lines}}').join(feeLines);
        // Same 30-day rule the printed invoice and the Overdue flag use, worked
        // out from the invoice's own timestamp so all three always agree.
        const PAYMENT_TERMS_DAYS = 30;
        const issuedOn = (inv.invoicedAt && inv.invoicedAt.toDate) ? inv.invoicedAt.toDate()
                       : ((inv.updatedAt && inv.updatedAt.toDate) ? inv.updatedAt.toDate() : new Date());
        const dueOn = new Date(issuedOn.getTime());
        dueOn.setDate(dueOn.getDate() + PAYMENT_TERMS_DAYS);
        body = body.split('{{due_date}}').join(dueOn.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
        body = body.split('{{amount_due}}').join('$' + amountDue.toFixed(2));
        body = body.split('{{amount_paid}}').join('$' + paid.toFixed(2));
        body = body.split('{{portal_link}}').join(portalUrl);
        body = body.split('{{portal_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">Log Into Your Portal</a>');
        // Same destination as portal_button; separate wording so a bill can say
        // "Pay Your Invoice" and a receipt can say "View Your Portal".
        body = body.split('{{pay_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">Pay Your Invoice</a>');
        body = body.split('{{view_portal_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">View Your Portal</a>');
        body = body.split('{{venmo_link}}').join(venmoUrl);
        body = body.split('{{venmo_button}}').join('<a href="' + venmoUrl + '" style="' + btnStyleGold + '">Pay with Venmo</a>');
        body = body.split('{{message_link}}').join(messagesUrl);
        body = body.replace(/\n/g, '<br>');

        const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: serviceId,
            template_id: templateId,
            user_id: publicKey || '',
            accessToken: privateKey,
            template_params: { to_email: email, to_name: payer.data.name || '', subject: invoiceSubject, body: body, message: body }
          })
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error('EmailJS send failed: ' + text);
        }

        // Carryover was already drawn down with the invoice write above, so here
        // we only mark the email sent - on EVERY house the bill covered, so no
        // house in the group can trigger a second invoice on a later run.
        for (const h of active) {
          await h.ref.update({
            invoiceEmailSent: true,
            invoiceEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        sentCount++;
      } catch (err) {
        errorCount++;
        errors.push(String((err && err.message) || err));
      }
    }

    const result = {
      dateStr: todayStr, sentCount, skippedNeedsFix, skippedNotDone,
      skippedNoEmail, noEmailNames: noEmailNames.slice(0, 20),
      errorCount, errors: errors.slice(0, 10), triggeredBy
    };
    await logNightlyInvoiceRun(result);
    return result;
  } catch (err) {
    const result = {
      dateStr: todayStr, sentCount, skippedNeedsFix, skippedNotDone,
      skippedNoEmail, noEmailNames: noEmailNames.slice(0, 20),
      errorCount: errorCount + 1, errors: errors.concat([String((err && err.message) || err)]).slice(0, 10),
      triggeredBy
    };
    await logNightlyInvoiceRun(result);
    return result;
  }
}

// Runs automatically every night at 7:00 PM Mountain Time — but only if the
// "Send nightly invoice emails automatically" toggle is on in Admin > Automation.
/* ---------------------------------------------------------------------------
   listAdminUsers - who can sign in to the admin dashboard.

   A browser cannot read the Firebase Auth user list; only the Admin SDK can.
   Without this, the "Assigned to" pickers on the Project page have nobody to
   offer. Returns just uid/email/name - no tokens, no claims - and only to
   someone already signed in.
--------------------------------------------------------------------------- */
exports.listAdminUsers = onCall({ cors: true }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    page.users.forEach((u) => {
      if (!u.email) return;
      users.push({
        uid: u.uid,
        email: u.email.toLowerCase(),
        name: u.displayName || '',
        disabled: !!u.disabled,
      });
    });
    pageToken = page.pageToken;
  } while (pageToken);
  users.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return { users };
});

/* --- runQuoteNudgeBatch / sendQuoteNudges ---------------------------------
 * Chases quotes nobody has answered.
 *
 * The rules, all deliberate:
 *   - 10 clear days since the quote (or since the last nudge) before we chase.
 *   - Two nudges maximum, ever. If someone has ignored two, they have answered.
 *   - Nothing goes out on or after 1 November. Chasing people once the season
 *     has started is not a sale, it is a nuisance.
 *   - Anyone who asked to be contacted by phone or text is skipped entirely.
 *     We have no automated texting, so those people need a human - they are
 *     counted and reported rather than silently ignored.
 *   - Approved, declined, maybe-next-year and archived quotes are all left be.
 * ------------------------------------------------------------------------- */
const QUOTE_NUDGE_WAIT_DAYS = 10;
const QUOTE_NUDGE_MAX = 2;

function prefersNotEmail(contactMethod) {
  return /phone|call|text|sms/i.test(String(contactMethod || ''));
}
function toMillis(v) {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v.seconds) return v.seconds * 1000;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ---------------- QUOTE PHOTOS (server side) ----------------
   A quote holds a list of photos in `quotePhotos`, and photo #1 is mirrored
   onto the old `frontPhotoUrl` field by the admin screen. Reading the list
   first and falling back to that field means both new and old quotes work,
   and nothing here has to know which is which.

   The layout matches admin.html deliberately: one photo per row, each the
   full width of the email, its label (which side of the house it is)
   underneath. Stacked is the only arrangement where every picture is whole
   AND every picture is the same size - side by side forces you to either crop
   the edges off or pad them out. Do not "improve" this into a grid. */
function quotePhotosServer(q) {
  if (q && Array.isArray(q.quotePhotos) && q.quotePhotos.length) {
    return q.quotePhotos
      .filter(function (p) { return p && p.url; })
      .map(function (p) { return { url: p.url, label: p.label || '' }; });
  }
  if (q && q.frontPhotoUrl) return [{ url: q.frontPhotoUrl, label: '' }];
  return [];
}
/* c_limit only ever shrinks, and never crops or stretches. Asked for at 2x
   the display width so it stays sharp on a phone. */
function cloudEmailPhotoServer(url) {
  if (!url || typeof url !== 'string') return url || '';
  if (url.indexOf('res.cloudinary.com/') === -1 || url.indexOf('/image/upload/') === -1) return url;
  if (/\/image\/upload\/[a-z]_[^/]*\//.test(url)) return url;   // already has transforms
  return url.replace('/image/upload/', '/image/upload/w_1120,c_limit,q_auto,f_auto/');
}
/* ⭐ THE SERVER HALF OF {{link:her own words}} (added 2026-08-26).
 *
 * Paired with applyQuoteLinkLabel in admin.html and asserted identical by
 * Suite 279 of run-all.js, the same way the photo block and the button labels
 * are: the Nudge template is rendered in the browser when the office sends it
 * and HERE when the nightly batch does, so a token one of them understands and
 * the other does not mails a customer the raw "{{link:See your home and approve
 * here}}" the moment nobody is watching.
 *
 * ⚠ THE ESCAPING IS WRITTEN OUT RATHER THAN CALLING escServer, and the browser
 * copy does the same rather than calling esc(). esc() escapes the apostrophe
 * and escServer does not, so borrowing each file's general helper would make
 * the two copies disagree about "Here's" — the one word most likely to be in a
 * label. Four characters, spelled out, in both.
 */
const QUOTE_LINK_LABEL_STYLE_SERVER = 'color:#1E3B2C; font-weight:bold; text-decoration:underline;';
function applyQuoteLinkLabelServer(text, url) {
  return String(text == null ? '' : text).replace(/\{\{link:([^{}]*)\}\}/g, function (_m, words) {
    const label = String(words).trim() || 'here';
    const safe = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<a href="' + url + '" style="' + QUOTE_LINK_LABEL_STYLE_SERVER + '">' + safe + '</a>';
  });
}
/* ⭐ AND THE BUTTON, WHICH THIS RENDERER HAD NEVER HEARD OF (added 2026-08-26).
 *
 * Until today the nightly nudge understood {{name}}, {{price}}, {{price_block}},
 * {{photo}}, the three quote buttons and {{link}}. NOT {{link_button}}. So a
 * Nudge template carrying a button rendered a gold block when the office pressed
 * Send and mailed the customer the literal text "{{link_button}}" when the 7 PM
 * batch sent the very same template — the one send nobody is watching. That is
 * the {{photo}} bug of 2026-08-17 exactly, in the token nobody thought to check.
 *
 * ⚠ THE STYLE STRING IS THE BROWSER'S, CHARACTER FOR CHARACTER. It is hoisted
 * out of resolveLinkTokens there (QUOTE_LINK_BUTTON_STYLE) for no other reason
 * than that this copy can be held to it, and Suite 279 compares the bytes.
 */
const QUOTE_LINK_BUTTON_STYLE_SERVER = 'display:inline-block; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:15px; margin:6px 8px 6px 0; background:#D89F3D; color:#1E3B2C;';
const QUOTE_LINK_BUTTON_DEFAULT_SERVER = 'View & Respond';
function applyQuoteLinkButtonServer(text, url, defaultLabel) {
  const fallback = String(defaultLabel || QUOTE_LINK_BUTTON_DEFAULT_SERVER);
  return String(text == null ? '' : text).replace(/\{\{link_button(?::([^{}]*))?\}\}/g, function (_m, words) {
    const label = (words == null ? '' : String(words)).trim() || fallback;
    const safe = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return '<a href="' + url + '" style="' + QUOTE_LINK_BUTTON_STYLE_SERVER + '">' + safe + '</a>';
  });
}
function escServer(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function quotePhotoEmailHtmlServer(photos) {
  if (!photos || !photos.length) return '';
  const rows = photos.map(function (p, i) {
    const last = i === photos.length - 1;
    const label = (p.label || '').trim();
    return '<tr><td style="font-family:Arial,sans-serif; padding:0 0 ' + (label ? '4' : (last ? '0' : '10')) + 'px;">' +
        '<img src="' + escServer(cloudEmailPhotoServer(p.url)) + '" alt="' + escServer(label || 'Your home') + '" width="560" style="width:100%; max-width:560px; height:auto; border-radius:8px; display:block; border:0;">' +
      '</td></tr>' +
      (label
        ? '<tr><td style="font-family:Arial,sans-serif; padding:0 0 ' + (last ? '0' : '12') + 'px;">' +
            '<p style="margin:0; font-size:12.5px; color:#6E6858; font-weight:bold;">' + escServer(label) + '</p></td></tr>'
        : '');
  }).join('');
  /* Most mail apps hide remote images until they are tapped, so there is a
     plain link to each one - otherwise it reads as photos we forgot. */
  const links = photos.length === 1
    ? '<a href="' + escServer(photos[0].url) + '" style="color:#3E7A5B;">View the photo here</a>'
    : 'View the photos here: ' + photos.map(function (p, i) {
        return '<a href="' + escServer(p.url) + '" style="color:#3E7A5B;">' + (i + 1) + '</a>';
      }).join(', ');
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 14px; max-width:560px;">' +
    rows +
    '<tr><td style="font-family:Arial,sans-serif;"><p style="margin:8px 0 0; font-size:12px; color:#6E6858;">Not showing? ' + links + '.</p></td></tr>' +
    '</table>';
}
/* ⭐ ONE SET OF BUTTONS - the owner's decision, 2026-08-17: "just one approved,
   Maybe later, Decline". There used to be a repeatQuoteButtonsServer here that
   copied the approve/maybe/decline buttons onto the far side of a stack of two
   or more photos, so "Approve" was never far down a phone, and admin.html did
   the same in the browser. It read as a mistake, so it is gone from both. Do
   not reintroduce it as a "fix" for a long email - it was deliberate once and
   was deliberately removed. Suite 33 of run-all.js runs this renderer and the
   browser one side by side and fails if either grows a second set. */

async function runQuoteNudgeBatch(source) {
  const now = new Date();
  const denverMonth = Number(now.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'numeric' }));
  /* November onward the season is underway - stop chasing. */
  if (denverMonth >= 11 || denverMonth <= 1) {
    return { sent: 0, skipped: 0, needsHuman: 0, stopped: 'outside the quoting season (November to January)' };
  }

  const setSnap = await db.collection('settings').doc('quoteNudgeAutomation').get();
  if (source === 'schedule' && (!setSnap.exists || !setSnap.data().enabled)) {
    return { sent: 0, skipped: 0, needsHuman: 0, stopped: 'automation is switched off' };
  }
  const waitDays = Number((setSnap.exists && setSnap.data().waitDays) || QUOTE_NUDGE_WAIT_DAYS) || QUOTE_NUDGE_WAIT_DAYS;
  const maxNudges = Number((setSnap.exists && setSnap.data().maxNudges) || QUOTE_NUDGE_MAX) || QUOTE_NUDGE_MAX;

  const cfgSnap = await db.collection('settings').doc('emailjs').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (!cfg.serviceId || !cfg.templateId || !cfg.privateKey) {
    return { sent: 0, skipped: 0, needsHuman: 0, stopped: 'EmailJS is not set up on the server' };
  }

  const tplNameSnap = await db.collection('settings').doc('quoteTemplates').get();
  const nudgeName = (tplNameSnap.exists && tplNameSnap.data().nudge) || 'Nudge';
  const tplSnap = await db.collection('emailTemplates').where('name', '==', nudgeName).limit(1).get();
  if (tplSnap.empty) {
    return { sent: 0, skipped: 0, needsHuman: 0, stopped: 'no template called "' + nudgeName + '"' };
  }
  const templateBody = tplSnap.docs[0].data().body || '';

  const cutoff = Date.now() - waitDays * 24 * 60 * 60 * 1000;
  const snap = await db.collection('quotes').get();

  let sent = 0, skipped = 0, needsHuman = 0;
  const errors = [];
  const humanFollowUp = [];

  for (const docSnap of snap.docs) {
    const q = docSnap.data();
    if (q.quoteArchived) { skipped++; continue; }
    if ((q.status || 'new') === 'closed') { skipped++; continue; }
    if (['approved', 'declined', 'maybe_next_year'].indexOf(q.approvalStatus) !== -1) { skipped++; continue; }
    if (typeof q.quotedPrice !== 'number') { skipped++; continue; }
    if (Number(q.quoteNudgeCount || 0) >= maxNudges) { skipped++; continue; }

    const lastContact = toMillis(q.quoteSentAt);
    if (!lastContact || lastContact > cutoff) { skipped++; continue; }

    /* They asked for a phone call or a text. We cannot do either automatically,
       so flag them for a person rather than emailing them anyway. */
    if (prefersNotEmail(q.contactMethod) || !q.email) {
      needsHuman++;
      humanFollowUp.push({
        id: docSnap.id, name: q.name || '', phone: q.phone || '',
        prefers: q.contactMethod || (q.email ? '' : 'no email address')
      });
      continue;
    }

    try {
      /* ⭐ AN EXISTING MEMBER'S LINK CARRIES THEIR OWN PORTAL TOKEN, the same
         &p= admin.html puts on the quote emails it sends (quotePortalParam).
         Without it a member who follows this link and asks to change something
         lands on a page that cannot let them in: the token in the URL is a
         QUOTE token, and portalLookup refuses to upgrade one into a session
         (the account takeover closed 2026-08-14). This is their real portal
         token, mailed to the address already on their record — a login they
         hold, not one minted from the link.

         ⚠ IT IS COMPUTED HERE, ABOVE the body-building block below, because
         run-all.js S33 lifts that block out of this file and runs it
         SYNCHRONOUSLY to prove the office nudge and this one send the same
         email. An await inside it stops that test from running at all. */
      let portalParam = '';
      try {
        const memberRef = await quoteCustomerRef(q);
        const memberToken = memberRef && memberRef.data ? memberRef.data.portalToken : '';
        if (memberToken) portalParam = '&p=' + encodeURIComponent(memberToken);
      } catch (err) {
        /* A nudge with no &p= still works for everyone; it just costs a member
           a sign-in. Never worth losing the email over. */
        console.error('[HU] nudge portal-token lookup failed:', err);
      }
      const quoteToken = q.quoteToken || '';
      const btn = 'display:inline-block; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:14px; margin:6px 4px;';
      /* typeof, not a bare read: S33 evaluates the lines below on their own,
         where portalParam does not exist. A member still gets their &p=. */
      const base = 'https://highlightingutah.com/#/quote-details?token=' + quoteToken +
        (typeof portalParam === 'string' ? portalParam : '');
      const price = '$' + Number(q.quotedPrice).toFixed(2).replace(/\.00$/, '');

      let body = templateBody;
      body = body.split('{{name}}').join(properNameServer(q.name) || 'there');
      body = body.split('{{price}}').join(price);
      body = body.split('{{price_block}}').join(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 14px;">' +
          '<tr><td align="center" style="background:#F1F5EB; border-radius:10px; padding:18px 20px; font-family:Arial,sans-serif;">' +
            '<div style="font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:#6E6858; font-weight:bold;">Your quote</div>' +
            '<div style="font-size:32px; font-weight:bold; color:#1E3B2C; padding:4px 0 2px;">' + price + '</div>' +
            '<div style="font-size:12.5px; color:#6E6858;">installed, maintained all season, and taken down in January</div>' +
          '</td></tr></table>');
      /* Every photo on the quote, not just the first - the same stacked
         layout the admin screen sends, so a chasing email looks exactly like
         the quote it is chasing. */
      const quotePhotos = quotePhotosServer(q);
      const photoHtml = quotePhotoEmailHtmlServer(quotePhotos);
      body = body.replace(/(?:\s|<br\s*\/?>)*\{\{photo\}\}(?:\s|<br\s*\/?>)*/gi, photoHtml || '<br>');
      /* ⚠ THE WORDS DEPEND ON THE QUOTE, and the add-on decline carries
         &addon=1 so the page can word its confirmation to match. That parameter
         is COSMETIC ONLY — quoteRespond decides what a decline means from the
         quote's own requoteKind, never from the link — so a forged one changes
         nothing but the sentence a forger reads on their own screen. */
      const qLabels = quoteButtonLabelsServer(q);
      const qAddOn = quoteIsAddOn(q) ? '&addon=1' : '';
      body = body.split('{{quote_yes_button}}').join('<a href="' + base + '&action=approve" style="' + btn + ' background:#2E6B3E; color:#ffffff;">' + qLabels.approve + '</a>');
      body = body.split('{{quote_maybe_button}}').join('<a href="' + base + '&action=maybe_next_year" style="' + btn + ' background:#D89F3D; color:#1E3B2C;">' + qLabels.maybe + '</a>');
      body = body.split('{{quote_decline_button}}').join('<a href="' + base + '&action=decline' + qAddOn + '" style="' + btn + ' background:#8A8F9C; color:#ffffff;">' + qLabels.decline + '</a>');
      body = applyQuoteLinkLabelServer(body, base);
      body = body.split('{{link}}').join(base);
      body = applyQuoteLinkButtonServer(body, base);
      body = body.replace(/\n/g, '<br>');

      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: cfg.serviceId,
          template_id: cfg.templateId,
          user_id: cfg.publicKey || '',
          accessToken: cfg.privateKey,
          /* Both names, because the browser sends "message" and the nightly
             invoice job sends "body" - whichever the EmailJS template uses,
             one of these fills it. */
          template_params: { to_email: q.email, to_name: q.name || '', subject: 'Just checking in on your quote', message: body, body: body }
        })
      });
      if (!res.ok) throw new Error(await res.text());

      await docSnap.ref.update({
        quoteNudgeCount: Number(q.quoteNudgeCount || 0) + 1,
        quoteLastNudgedAt: admin.firestore.FieldValue.serverTimestamp(),
        /* Resets the clock, so the second nudge is another 10 days out. */
        quoteSentAt: admin.firestore.FieldValue.serverTimestamp(),
        quoteNudgedAutomatically: true
      });
      sent++;
    } catch (err) {
      errors.push((q.name || q.email || docSnap.id) + ': ' + String((err && err.message) || err));
    }
  }

  await db.collection('settings').doc('quoteNudgeAutomation').set({
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    lastRunSource: source,
    lastRunSent: sent,
    lastRunNeedsHuman: needsHuman,
    lastRunErrors: errors.slice(0, 10),
    /* The list of people who wanted a call or a text - shown in admin so they
       do not quietly fall through the cracks. */
    needsHumanList: humanFollowUp.slice(0, 50)
  }, { merge: true });

  return { sent: sent, skipped: skipped, needsHuman: needsHuman, errors: errors };
}

function properNameServer(raw) {
  const str = String(raw == null ? '' : raw).trim();
  if (!str) return '';
  if (str !== str.toUpperCase() && str !== str.toLowerCase()) return str.split(/\s+/)[0];
  const tidied = str.toLowerCase().replace(/[a-z]+(?:['\u2019-][a-z]+)*/g, function (word) {
    return word.replace(/(^|['\u2019-])([a-z])/g, function (m, sep, ch) { return sep + ch.toUpperCase(); })
      .replace(/^Mc([a-z])/, function (m, ch) { return 'Mc' + ch.toUpperCase(); });
  });
  const first = tidied.split(/\s+/)[0].replace(/[,;]+$/, '');
  if (/^(the|mr|mrs|ms|miss|dr|rev|pastor)\.?$/i.test(first)) return tidied;
  return first;
}

/* --- The unpaid-last-season chase ------------------------------------------
 *
 * Dax, 2026-09-02: "i dont have the automated email set up i told you to do
 * that for the unpaid."
 *
 * ⛔ IT SHIPS OFF, AND THAT IS NOT TIMIDITY — IT IS HER STANDING RULING.
 * MON-34, Addie, 2026-09-01: "I'll send those emails/text myself", recorded with
 * "SO DO NOT BUILD AN AUTOMATIC CHASE without asking again". This is the asking:
 * the machinery is built and wired, and it does nothing at all until somebody
 * ticks the box in Admin > Invoices > Unpaid Last Season. Flipping that switch is
 * a person deciding to override her, in front of her own words, which is exactly
 * the shape the nightly invoice automation already has. Do NOT default it on.
 *
 * ⚠ WHO IT WRITES TO, AND THE TWO NEIGHBOURS IT DELIBERATELY LEAVES ALONE.
 * Somebody who owes for a previous season AND has not answered the RSVP at all.
 *   - Not somebody who said NO or BACK NEXT YEAR. RS-30 settles this shape: "if
 *     they said back next year or no we don't need a system email." They have
 *     answered; an email asking whether they want lights argues with a decision
 *     already given. They may still owe money, but that is a DEBT chase, which is
 *     a different email and a different decision.
 *   - Not somebody who has already said YES. The template's own first line asks
 *     "will you be getting lights hung again this year?", which reads as though we
 *     lost their answer. They are held out of the season by the money either way,
 *     and the portal tells them so the moment they open it (RS-36).
 *
 * ⚠ ONCE PER CUSTOMER PER SEASON, EVER. `arrearsRsvpEmailAt` is stamped on the
 * record and Start New Season clears it, the same shape as arrearsPaidNoticeAt.
 * A daily schedule with no stamp is a daily email to somebody who owes money,
 * which is how a chase becomes harassment.
 *
 * ⚠ AND IT NEVER GUESSES AT THE FIGURE. The email names no amount — there is no
 * token for the carried balance and {{amount_due}} means this year's install
 * price (RS-37) — so the buttons carry their portal token and the portal shows
 * the one figure we computed. Nothing here recomputes any money.
 * ------------------------------------------------------------------------- */
async function runArrearsRsvpBatch(source) {
  const out = { sent: 0, skipped: 0, errors: [], source: source, stopped: '' };

  const cfgSnap = await db.collection('settings').doc('emailjs').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (!cfg.serviceId || !cfg.templateId || !cfg.privateKey) {
    out.stopped = 'EmailJS is not set up on the server (Automation Emails > EmailJS Setup).';
    return out;
  }

  const tplSnap = await findTemplateSnapByName('Not Paid RSVP');
  if (tplSnap.empty) {
    out.stopped = 'There is no email template called "Not Paid RSVP". It lives under Automation Emails > Templates > RSVP.';
    return out;
  }
  const tpl = tplSnap.docs[0].data();
  const templateBody = tpl.body || '';
  const subject = templateSubjectOr(tpl, 'Your Christmas lights this year — and last season’s balance');

  const snap = await db.collection('jobAddresses').get();
  for (const docSnap of snap.docs) {
    const d = docSnap.data() || {};
    /* Every skip is silent and counted, never logged per customer: this runs over
       the whole book and a line each would bury the errors that matter. */
    /* ⚠ THE TEST RECORD CARRIES ADDIE'S OWN PHONE, so "skip the test account" is
       not housekeeping here — it is the difference between a dry run and mailing
       the owner a chase for a debt she does not have. Same two conditions
       admin.html's isTestRecordData uses. */
    if (d.isTestRecord === true) { out.skipped++; continue; }
    if (digitsOnly(d.phone) === '3853912235' && String(d.name || '').trim().toLowerCase() === 'test') { out.skipped++; continue; }
    if (d.arrearsRsvpEmailAt) { out.skipped++; continue; }
    const answered = String(d.rsvpStatus || '').trim();
    if (answered) { out.skipped++; continue; }
    const email = String(d.email || '').trim();
    if (!email) { out.skipped++; continue; }

    const owed = await arrearsForCustomer(d);
    if (!(owed.outstanding > 0)) { out.skipped++; continue; }

    try {
      const token = await ensureToken(docSnap.id, d);
      const base = 'https://highlightingutah.com/#/payment' + (token ? ('?token=' + token) : '');
      const yesUrl = base + (token ? '&rsvp=yes' : '');
      const noUrl = base + (token ? '&rsvp=no' : '');
      const backUrl = 'https://highlightingutah.com/#/' + (token ? ('?token=' + token + '&rsvp=back') : '');
      /* ⚠ THE SAME THREE BUTTONS admin.html builds, in the same colours and the
         same order. A chase that looked different from the RSVP email it follows
         would read as a different question. */
      const btn = 'display:inline-block; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:14px; margin:6px 4px;';
      let body = templateBody;
      body = body.split('{{name}}').join(properNameServer(d.name) || 'there');
      body = body.split('{{rsvp_yes_link}}').join(yesUrl);
      body = body.split('{{rsvp_no_link}}').join(noUrl);
      body = body.split('{{rsvp_back_link}}').join(backUrl);
      body = body.split('{{rsvp_yes_button}}').join('<a href="' + yesUrl + '" style="' + btn + ' background:#2E6B3E; color:#ffffff;">Yes</a>');
      body = body.split('{{rsvp_no_button}}').join('<a href="' + noUrl + '" style="' + btn + ' background:#8A8F9C; color:#ffffff;">No</a>');
      body = body.split('{{rsvp_back_button}}').join('<a href="' + backUrl + '" style="' + btn + ' background:#D89F3D; color:#1E3B2C;">Back Next Year</a>');
      body = body.replace(/\n/g, '<br>');

      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: cfg.serviceId,
          template_id: cfg.templateId,
          user_id: cfg.publicKey || '',
          accessToken: cfg.privateKey,
          template_params: {
            to_email: email, to_name: d.name || '',
            subject: String(subject).split('{{name}}').join(properNameServer(d.name) || 'there'),
            body: body, message: body
          }
        })
      });
      if (!res.ok) {
        out.errors.push((d.name || docSnap.id) + ': ' + (await res.text()).slice(0, 120));
        continue;
      }
      /* ⚠ STAMPED ONLY AFTER THE SEND SUCCEEDS. Stamping first would lose the
         customer for the whole season on one bad response from the mail service. */
      await docSnap.ref.update({ arrearsRsvpEmailAt: admin.firestore.FieldValue.serverTimestamp() });
      out.sent++;
    } catch (err) {
      out.errors.push((d.name || docSnap.id) + ': ' + ((err && err.message) || err));
    }
  }
  return out;
}

exports.sendArrearsRsvpEmails = onSchedule(
  { schedule: '0 10 * * *', timeZone: 'America/Denver', memory: '512MiB' },
  async () => {
    const autoSnap = await db.collection('settings').doc('arrearsRsvpAutomation').get();
    if (!autoSnap.exists || !autoSnap.data().enabled) {
      return; // off — and off is the shipped state. See the block above.
    }
    await runArrearsRsvpBatch('schedule');
  }
);

/* The same run, on demand, whether the switch is on or off — so the office can
   send one batch by hand without ever turning the automation on. That is the
   closest thing to what Addie said she wanted to do herself. */
exports.runArrearsRsvpNow = onCall({ memory: '512MiB', timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return await runArrearsRsvpBatch('manual');
});

exports.sendQuoteNudges = onSchedule(
  { schedule: '0 10 * * *', timeZone: 'America/Denver', memory: '512MiB' },
  async () => { await runQuoteNudgeBatch('schedule'); }
);

/* Manual "run it now" for testing, from admin. */
exports.runQuoteNudgesNow = onCall({ memory: '512MiB', timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return await runQuoteNudgeBatch('manual');
});

exports.sendNightlyInvoices = onSchedule(
  { schedule: '0 19 * * *', timeZone: 'America/Denver', memory: '512MiB', secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER] },
  async () => {
    const autoSnap = await db.collection('settings').doc('nightlyInvoiceAutomation').get();
    if (!autoSnap.exists || !autoSnap.data().enabled) {
      return; // automation turned off — do nothing, don't even log
    }
    await runInvoiceBatch('schedule');
  }
);

/* --- sendInvoicesNow -------------------------------------------------------
 * Manual "Send Invoices Now" button in Admin > Automation > EmailJS Setup.
 * Runs the exact same billing logic as the 7:00 PM automation, on demand —
 * works whether the automatic toggle is on or off, so this is the way to send
 * invoices out on a night the automation is turned off. Requires the caller
 * to be signed in (same Firebase Auth already used across admin.html).
 * ------------------------------------------------------------------------- */
exports.sendInvoicesNow = onCall({ memory: '512MiB', timeoutSeconds: 300, secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  return await runInvoiceBatch('manual');
});
