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
    if (tplSnap.empty) {
      // A renamed or deleted template must not silently swallow the receipt: the
      // email still goes out from a built-in body, and the gap is recorded on the
      // invoice so the missing template gets noticed and restored.
      await fail('There is no email template named "' + templateName + '", so a plain built-in version was sent instead. Create it under Automation Emails > Templates > Billing, spelled exactly that way.');
      body = paidInFull
        ? 'Hi {{name}},<br><br>Thank you \u2014 your Christmas lights invoice is paid in full.<br><br>Amount paid: {{amount_paid}}<br><br>{{view_portal_button}}<br><br>\u2014 Highlighting Utah'
        : 'Hi {{name}},<br><br>Thanks \u2014 we have received your payment of {{payment_amount}}.<br><br>Invoice total: {{amount_total}}<br>Paid so far: {{amount_paid}}<br>Amount still due: {{amount_due}}<br><br>You can finish paying any time using the button below.<br><br>{{pay_button}} {{venmo_button}}<br><br>\u2014 Highlighting Utah';
    } else {
      body = tplSnap.docs[0].data().body || '';
    }

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
        template_params: { to_email: email, body: body }
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

// Called from the Member Portal right before showing the PayPal button.
// Figures out what's actually owed and creates a matching PayPal order.
exports.paypalCreateOrder = onCall(
  { secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV] },
  async (request) => {
    const { phone, tipAmount } = request.data || {};
    if (!phone) throw new HttpsError('invalid-argument', 'Missing phone.');

    const invSnap = await db.collection('invoices').doc(phone).get();
    if (!invSnap.exists) throw new HttpsError('not-found', 'No invoice found for this phone.');
    const inv = invSnap.data();
    const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
    const credits = Number(inv.credits) || 0;
    const paid = Number(inv.deposit) || 0;
    const balanceDue = Math.max(0, total - credits - paid);
    const tip = Math.max(0, Number(tipAmount) || 0);
    const chargeAmount = balanceDue + tip;

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
    return { orderID: order.id, balanceDue, tip, total: chargeAmount };
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
      serviceAmount = Math.min(capturedAmount, balanceDue);
      tip = Math.max(0, capturedAmount - serviceAmount);
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
  cancel:      ['cancellationReason']
};

// Fields the portal is allowed to READ. Everything else on the record —
// pricing, customer number, bin assignments, difficulty rating, test-account
// flag, don't-install-before date, crew notes — never leaves the server.
const PORTAL_READ_FIELDS = [
  'name', 'phone', 'email', 'address', 'phone2', 'email2', 'gateCode',
  'lightsDescription', 'installPreference', 'wireColor', 'outletTimer',
  'specificOutlet', 'specificOutletNotes', 'notes', 'rsvpStatus',
  'seasonStatus', 'cancellationReason', 'housePhotoUrl', 'houseHighlights',
  'quoteDetailQuoteId',
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

async function findByPhone(phoneDigits) {
  if (!phoneDigits) return null;
  const snap = await db.collection('jobAddresses')
    .where('phone', '==', phoneDigits).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };
  // Fallback for records whose stored phone has formatting characters in it.
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

// Make sure a record has a portalToken, minting one if it predates the system.
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
    if (match && !nameMatches(match.data.name, lastName)) match = null;
  } else if (email) {
    await checkRateLimit('email_' + email);
    match = await findByEmail(email);
    if (match && !nameMatches(match.data.name, lastName)) match = null;
  } else {
    throw new HttpsError('invalid-argument', 'No lookup information provided.');
  }

  if (!match) return { found: false };

  const activeToken = await ensureToken(match.id, match.data);

  return {
    found: true,
    id: match.id,
    token: activeToken,
    deactivated: match.data.rsvpStatus === 'no',
    invoiceKey: invoiceKeyFor(match.data),
    record: sanitizeRecord(match.data)
  };
});

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
  if (section === 'lights' && updates.lightsDescription !== undefined) {
    const changed = updates.lightsDescription !== (oldData.lightsDescription || '');
    if (!updates.lightsDescription) {
      updates.needsLightBuild = false;      // colours cleared — nothing to build
    } else if (changed) {
      updates.needsLightBuild = true;       // genuinely different pattern
    }
    // Unchanged? Leave the flag alone. Opening the Lights tab and pressing Save
    // must not re-queue a house Dad has already built.
  }

  await db.collection('jobAddresses').doc(match.id).update(updates);

  /* A cancellation request means this customer is sitting out, same as an
     RSVP "no" or "back next year" — so it has to pull them off any route a
     crew has already been handed, or the crew still turns up. */
  if (section === 'cancel') {
    await removeCustomerFromUpcomingRoutes(match.id);
  }

  // The Lights tab mirrors the description onto the invoice record AND enforces
  // the $30 light-change fee. The customer gets a 48-hour free window after a
  // charged change to keep tweaking; the first change once that window has
  // closed charges another $30 and restarts the window. Decided here, on the
  // server, using the server clock — the browser can't skip or fake it.
  let lightFeeInfo = null;
  if (section === 'lights' && oldKey && updates.lightsDescription !== undefined) {
    const changed = updates.lightsDescription !== (oldData.lightsDescription || '');
    try {
      const invRef = db.collection('invoices').doc(oldKey);
      const invSnap = await invRef.get();
      const inv = invSnap.exists ? invSnap.data() : {};
      const FEE = 30;
      const WINDOW_MS = 48 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const lastAt = inv.lastLightChangeFeeAt && inv.lastLightChangeFeeAt.toMillis
        ? inv.lastLightChangeFeeAt.toMillis() : 0;
      const withinFreeWindow = lastAt > 0 && (nowMs - lastAt) <= WINDOW_MS;

      const invWrite = { lightsDescription: updates.lightsDescription };
      // A real change to a non-empty pattern is the only thing that can charge.
      if (changed && updates.lightsDescription) {
        if (!withinFreeWindow) {
          const newFees = (Number(inv.changeFees) || 0) + FEE;
          invWrite.changeFees = newFees;
          invWrite.changeFeeNotes = (Array.isArray(inv.changeFeeNotes) ? inv.changeFeeNotes : [])
            .concat([{ amount: FEE, reason: 'Light color change', date: new Date().toISOString() }]);
          invWrite.lastLightChangeFeeAt = admin.firestore.Timestamp.fromMillis(nowMs);
          invWrite.status = computeInvoiceStatusServer(inv.install, inv.removal, inv.deposit, inv.credits, newFees);
          invWrite.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          lightFeeInfo = { feeCharged: true, amount: FEE, freeWindowEndsAt: nowMs + WINDOW_MS };
        } else {
          // Still inside the paid 48-hour window — change is free.
          lightFeeInfo = { feeCharged: false, amount: 0, freeWindowEndsAt: lastAt + WINDOW_MS };
        }
      }
      await invRef.set(invWrite, { merge: true });

      // Assignment lock + reassign flag. A genuine change starts (or sits inside)
      // the 48-hour window during which the pattern may still move, so the office
      // must not assign them to an install route yet. If they were ALREADY on one,
      // the crew would hang the wrong lights — flag it and drop a note in the Inbox.
      const jobAddrLightUpdate = {};
      if (changed && updates.lightsDescription && !withinFreeWindow) {
        jobAddrLightUpdate.lightsLockedUntil = admin.firestore.Timestamp.fromMillis(nowMs + WINDOW_MS);
      }
      if (changed && updates.lightsDescription && oldData.scheduled) {
        jobAddrLightUpdate.lightsChangedAfterAssign = true;
        jobAddrLightUpdate.lightsChangedAfterAssignAt = admin.firestore.FieldValue.serverTimestamp();
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
      if (Object.keys(jobAddrLightUpdate).length) {
        await db.collection('jobAddresses').doc(match.id).update(jobAddrLightUpdate);
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
  const wasNo = String(oldData.rsvpStatus || '').toLowerCase() === 'no';
  /* Flag still true = the recycle is queued but not done, nothing was pulled,
     so clearing it is all that is needed and nothing has to be rebuilt. */
  const rejoinedAfterRecycle = response === 'yes' && wasNo && !oldData.needsLightRecycle;

  const updates = {
    rsvpStatus: response,
    rsvpRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
    needsLightRecycle: response === 'no'
  };
  if (rejoinedAfterRecycle) updates.needsLightBuild = true;

  await db.collection('jobAddresses').doc(match.id).update(updates);

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

  return { ok: true, rsvpStatus: response,
           rejoinedAfterRecycle: rejoinedAfterRecycle,
           removedFromRoutes: removedFrom };
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
    needsLightRecycle: false,
    needsLightBuild: false,
    scheduled: false,
    scheduledDate: null,
    assignedCrew: null
  });

  return await removeCustomerFromUpcomingRoutes(customerId);
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
  }
  await db.collection('quotes').doc(quoteId).update(quoteUpdates);

  /* A "maybe next year" from someone who is already a customer has to reach
     their customer record, not just the quote - otherwise they stay on the
     routes and the schedule for a season they already said no to. Quotes carry
     no link to jobAddresses, so the phone number is the only join available,
     and it is the same one the rest of the app matches on. */
  let pulledFromSeason = false;
  if (action === 'maybe_next_year' || action === 'maybe') {
    try {
      const cust = await findByPhone(digitsOnly(quoteData.phone));
      if (cust) {
        await pullCustomerFromSeason(cust.id);
        pulledFromSeason = true;
      }
    } catch (err) {
      /* Never let this sink the customer's answer - the quote is already
         recorded, and the office can pull them off by hand. */
      console.error('[HU] maybe-next-year customer update failed:', err);
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

  return {
    ok: true,
    action: action,
    quotedPrice: quoteData.quotedPrice || 0,
    /* The page needs to know WHICH quote it just approved so it can open the
       detail form against it. Without this the approval was recorded and the
       customer was left looking at an empty page. Nothing sensitive: the id
       is useless without the token they already hold. */
    quoteId: quoteId,
    name: quoteData.name || '',
    formCompleted: !!quoteData.formCompleted
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
    if (nameMatches(data.name, lastName)) {
      authorized = true;
    } else {
      await checkRateLimit('invoice_' + key);
    }
  }

  if (!authorized) return { found: false };

  return { found: true, record: sanitizeInvoice(data) };
});

/* ---------------------------------------------------------------------------
 * sendNightlyInvoices — runs every night at 7:00 PM Mountain Time.
 *
 * Checks every house marked "Done" by the crew that hasn't been billed yet
 * (regardless of which day it was actually completed \u2014 so a house marked
 * Done late, after 7pm or the next morning, still gets caught on the very
 * next run instead of being missed) and sends an automatic invoice email:
 *   - already paid in full  -> "Nightly Auto-Invoice — Paid Receipt" template
 *   - still owes money      -> "Nightly Auto-Invoice — Unpaid" template
 * Houses flagged "needs fix" or marked "Didn't Get To" by the crew are
 * skipped entirely and never billed. Each house is only ever billed once
 * (guarded by invoiceEmailSent on the jobAddresses doc) \u2014 there's no
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
      if (data.skippedNoEmail) parts.push(data.skippedNoEmail + ' NO EMAIL (cannot be billed)');
      parts.push((data.errorCount || 0) + ' error' + (data.errorCount === 1 ? '' : 's'));
      let body = 'Highlighting Utah billing (' + (data.triggeredBy || 'run') + '): ' + parts.join(', ') + '.';
      if (data.skippedNoEmail && data.noEmailNames && data.noEmailNames.length) {
        body += ' No email: ' + data.noEmailNames.slice(0, 3).join(', ') +
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

    // Bills any house marked Done that hasn't been invoiced yet \u2014 no matter
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
        // Houses that said no are not part of this season at all.
        const active = houses.filter(function (h) { return String(h.data.rsvpStatus || '') !== 'no'; });
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

        // The payer is the house the invoice key actually belongs to; a group
        // made only of bill-to houses falls back to the first one.
        const payer = active.find(function (h) {
          return !digitsOnly(h.data.billToPhone) && invoiceKeyFor(h.data) === invoiceKey;
        }) || active[0];

        const withEmail = active.find(function (h) { return !!h.data.email; });
        const email = payer.data.email || (withEmail ? withEmail.data.email : '');
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
          continue;
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
          inv.install = groupSum + (inv.newMemberFeeApplied ? 30 : 0);
        }

        const isNewMember = active.some(function (h) { return looksLikeNewMember(h.data); });
        if (isNewMember && !inv.newMemberFeeApplied) {
          inv.install = (Number(inv.install) || 0) + 30;
          inv.newMemberFeeApplied = true;
        }
        if (inv.install == null) inv.install = groupSum;

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
        const newMemberLine = isNewMember ? 'New member installation fee = $30.00' : '';

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
        if (tplSnap.empty) {
          // A missing or renamed template must NOT silently stop billing. Fall
          // back to a built-in body (with all the tokens) so the invoice still
          // goes out; note it in the run log so staff can restore the template.
          body = status === 'Paid in Full'
            ? 'Hi {{name}},<br><br>Thank you — your Christmas lights invoice is paid in full.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{fee_lines}}<br>{{credit_lines}}<br><br>Amount paid: {{amount_paid}}<br><br>{{view_portal_button}}<br><br>— Highlighting Utah'
            : 'Hi {{name}},<br><br>Here is your Christmas lights invoice.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{fee_lines}}<br>{{credit_lines}}<br><br>Amount due: {{amount_due}}<br>Please pay by {{due_date}}.<br><br>Pay your invoice here:<br><br>{{pay_button}} {{venmo_button}}<br><br>Questions? {{message_link}}<br><br>— Highlighting Utah';
          if (errors.length < 10) errors.push('Template missing, used built-in fallback: ' + templateName);
        } else {
          body = tplSnap.docs[0].data().body || '';
        }

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
            template_params: { to_email: email, body: body }
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

// Runs automatically every night at 7:00 PM Mountain Time \u2014 but only if the
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
/* Copies the approve/maybe/decline buttons onto the far side of the photo
   block, so there is a set above them and a set below. The template still
   only contains them once. */
function repeatQuoteButtonsServer(body, photoHtml) {
  const at = body.indexOf(photoHtml);
  if (at === -1) return body;
  const btnRe = /<a\b[^>]*(?:background:\s*#2E6B3E|background:\s*#D89F3D|background:\s*#8A8F9C)[^>]*>[\s\S]*?<\/a>/gi;
  let first = null, last = null, m;
  while ((m = btnRe.exec(body)) !== null) {
    if (m.index > at && m.index < at + photoHtml.length) continue;   // ignore anything inside the photos
    if (first === null) first = m.index;
    last = m.index + m[0].length;
  }
  if (first === null || last === null) return body;
  const buttons = body.slice(first, last);
  return at > first
    ? body.slice(0, at + photoHtml.length) + '<div style="margin-top:14px;">' + buttons + '</div>' + body.slice(at + photoHtml.length)
    : body.slice(0, at) + '<div style="margin-bottom:14px;">' + buttons + '</div>' + body.slice(at);
}

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
      const quoteToken = q.quoteToken || '';
      const btn = 'display:inline-block; padding:11px 18px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:14px; margin:6px 4px;';
      const base = 'https://highlightingutah.com/#/quote-details?token=' + quoteToken;
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
      body = body.split('{{quote_yes_button}}').join('<a href="' + base + '&action=approve" style="' + btn + ' background:#2E6B3E; color:#ffffff;">Approve Quote</a>');
      body = body.split('{{quote_maybe_button}}').join('<a href="' + base + '&action=maybe_next_year" style="' + btn + ' background:#D89F3D; color:#1E3B2C;">Maybe Next Year</a>');
      body = body.split('{{quote_decline_button}}').join('<a href="' + base + '&action=decline" style="' + btn + ' background:#8A8F9C; color:#ffffff;">Decline Quote</a>');
      body = body.split('{{link}}').join(base);
      body = body.replace(/\n/g, '<br>');
      /* Buttons on both sides of a stack of photos, so "Approve" is never
         three screens down a phone. Only when there is more than one photo -
         with a single one the template's own placement is fine. */
      if (photoHtml && quotePhotos.length > 1) body = repeatQuoteButtonsServer(body, photoHtml);

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
      return; // automation turned off \u2014 do nothing, don't even log
    }
    await runInvoiceBatch('schedule');
  }
);

/* --- sendInvoicesNow -------------------------------------------------------
 * Manual "Send Invoices Now" button in Admin > Automation > EmailJS Setup.
 * Runs the exact same billing logic as the 7:00 PM automation, on demand \u2014
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
