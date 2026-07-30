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
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const PAYPAL_CLIENT_ID = defineSecret('PAYPAL_CLIENT_ID');
const PAYPAL_CLIENT_SECRET = defineSecret('PAYPAL_CLIENT_SECRET');
const PAYPAL_WEBHOOK_ID = defineSecret('PAYPAL_WEBHOOK_ID');
const PAYPAL_ENV = defineSecret('PAYPAL_ENV'); // "sandbox" or "live"

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
 * Records a captured PayPal payment on the matching invoice.
 * Safe to call more than once for the same captureId — it only
 * applies each real-world payment to the invoice a single time.
 */
async function recordPaypalPayment(phone, { captureId, tip, serviceAmount }) {
  const invRef = db.collection('invoices').doc(phone);
  await db.runTransaction(async (t) => {
    const snap = await t.get(invRef);
    if (!snap.exists) return;
    const inv = snap.data();
    const existingPayments = inv.paypalPayments || [];
    if (existingPayments.some((p) => p.captureId === captureId)) return; // already recorded
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
    const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0);
    const paid = Number(inv.deposit) || 0;
    const balanceDue = Math.max(0, total - paid);
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
    const tip = Math.min(Math.max(0, Number(tipAmount) || 0), capturedAmount);
    const serviceAmount = Math.max(0, capturedAmount - tip);

    await recordPaypalPayment(phone, { captureId, tip, serviceAmount });

    return { success: true, capturedAmount, tip };
  }
);

// Safety net: PayPal calls this on its own if the browser never confirms the
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
