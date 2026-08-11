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
  'quoteDetailQuoteId'
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

// Mirrors the last-name check the browser used to do, so behaviour is
// unchanged for customers: the typed name must match a word in the stored
// name, or appear inside it. Word-order independent on purpose — names are
// stored "First Last", but this must keep working during the changeover.
function nameMatches(storedName, typedName) {
  const stored = String(storedName || '').toLowerCase().trim();
  const typed = String(typedName || '').toLowerCase().trim();
  if (!typed || !stored) return false;
  const words = stored.split(/\s+/).filter(Boolean);
  return words.indexOf(typed) !== -1 || stored.indexOf(typed) !== -1;
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
          // Prefer the real customer record if one exists for that phone.
          const byPhone = await findByPhone(qPhone);
          if (byPhone) {
            match = byPhone;
          } else {
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
    try {
      const newKey = invoiceKeyFor(Object.assign({}, oldData, updates));
      if (newKey && newKey !== oldKey) {
        const oldInvSnap = await db.collection('invoices').doc(oldKey).get();
        const carried = oldInvSnap.exists ? oldInvSnap.data() : {};
        await db.collection('invoices').doc(newKey)
          .set(Object.assign({}, carried, invoiceUpdates), { merge: true });
        await db.collection('invoices').doc(oldKey).delete();
      } else if (oldKey) {
        await db.collection('invoices').doc(oldKey).set(invoiceUpdates, { merge: true });
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

  await db.collection('jobAddresses').doc(match.id).update({
    rsvpStatus: response,
    rsvpRespondedAt: admin.firestore.FieldValue.serverTimestamp(),
    needsLightRecycle: response === 'no'
  });

  return { ok: true, rsvpStatus: response };
});

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
const INVOICE_READ_FIELDS = ['name', 'phone', 'email', 'install', 'removal', 'deposit', 'credits', 'creditNotes', 'changeFees', 'changeFeeNotes'];

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
    // Deliberately NOT rate limited. Every route into this function has
    // already passed through portalLookup's limiter on the guessable
    // phone/email + last name path, and this runs again on every portal
    // render — a second limiter here locks customers out of their own
    // invoice after a handful of ordinary page loads.
    if (nameMatches(data.name, lastName)) authorized = true;
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
      parts.push((data.errorCount || 0) + ' error' + (data.errorCount === 1 ? '' : 's'));
      let body = 'Highlighting Utah billing (' + (data.triggeredBy || 'run') + '): ' + parts.join(', ') + '.';
      if (data.errorCount && data.errors && data.errors.length) body += ' First issue: ' + String(data.errors[0]).slice(0, 90);
      await twilioSendRaw(alertPhone, body);
    }
  } catch (e) {
    console.error('[HU] nightly alert SMS failed:', e);
  }
}

function computeInvoiceStatusServer(install, removal, deposit, credits, changeFees) {
  const gross = (Number(install) || 0) + (Number(removal) || 0) + (Number(changeFees) || 0);   // the real charge (incl. light-change fees)
  const total = gross - (Number(credits) || 0);                    // owed after credits
  const paid = Number(deposit) || 0;
  if (gross <= 0 && paid <= 0) return 'Unpaid';                    // a truly blank invoice
  if (total <= 0) return 'Paid in Full';                         // credits (and/or payments) cover it all
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid in Full';
  return 'Partial Payment';
}

async function runInvoiceBatch(triggeredBy) {
  const todayStr = todayStrInDenver();
  let sentCount = 0, skippedNeedsFix = 0, skippedNotDone = 0, errorCount = 0;
  const errors = [];

  try {
    const emailSettingsSnap = await db.collection('settings').doc('emailjs').get();
    const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};
    const { serviceId, templateId, privateKey, publicKey } = emailSettings;
    if (!serviceId || !templateId || !privateKey) {
      const result = {
        dateStr: todayStr, sentCount: 0, skippedNeedsFix: 0, skippedNotDone: 0,
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
    const custsSnap = await db.collection('jobAddresses')
      .where('completed', '==', true)
      .get();

    for (const custDoc of custsSnap.docs) {
      const id = custDoc.id;
      try {
        const custRef = custDoc.ref;
        const cust = custDoc.data();

        if (cust.needsFix) { skippedNeedsFix++; continue; }
        if (cust.invoiceEmailSent) { skippedNotDone++; continue; } // already billed previously

        const email = cust.email;
        if (!email) { continue; } // nothing to send to

        const phone = digitsOnly(cust.phone);
        const invoiceKey = phone || String(cust.email || '').toLowerCase().trim();
        const invRef = db.collection('invoices').doc(invoiceKey);
        const invSnap = await invRef.get();
        const inv = invSnap.exists
          ? invSnap.data()
          : { install: Number(cust.housePrice) || 0, removal: 0, deposit: 0, name: cust.name, phone, email };

        // New-member detection drives the $30 fee, so read the enrollment year
        // robustly however createdAt was stored (Firestore Timestamp, a raw
        // {seconds} object, a JS Date, an epoch number, or an ISO string). A
        // Timestamp-only check silently missed the fee whenever the field had
        // been written in any other shape.
        let enrollYear = null;
        const _ca = cust.createdAt;
        try {
          if (_ca && typeof _ca.toDate === 'function') enrollYear = _ca.toDate().getFullYear();
          else if (_ca instanceof Date) enrollYear = _ca.getFullYear();
          else if (_ca && typeof _ca.seconds === 'number') enrollYear = new Date(_ca.seconds * 1000).getFullYear();
          else if (typeof _ca === 'number') enrollYear = new Date(_ca).getFullYear();
          else if (typeof _ca === 'string') { const _d = new Date(_ca); if (!isNaN(_d.getTime())) enrollYear = _d.getFullYear(); }
        } catch (e) { enrollYear = null; }
        const isNewMember = enrollYear !== null && enrollYear === new Date().getFullYear();
        if (isNewMember && !inv.newMemberFeeApplied) {
          inv.install = (Number(inv.install) || 0) + 30;
          inv.newMemberFeeApplied = true;
        }
        if (inv.install == null) inv.install = Number(cust.housePrice) || 0;

        // Draw down any credit the customer carried over (e.g. a referral earned
        // while already paid up). Credit only reduces the balance to $0; whatever
        // is left keeps waiting on the customer for the next invoice.
        let carryoverApplied = 0;
        const carryAvail = Number(cust.carryoverCredit) || 0;
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

        const status = computeInvoiceStatusServer(inv.install, inv.removal || 0, inv.deposit || 0, inv.credits || 0, inv.changeFees || 0);
        inv.status = status;
        inv.name = inv.name || cust.name || '';
        inv.email = inv.email || cust.email || '';
        inv.phone = inv.phone || phone;
        inv.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await invRef.set(inv, { merge: true });

        // Draw the used carryover off the customer NOW, right after the invoice
        // write — NOT after the email. If it waited for a successful send and the
        // email failed, the invoice would keep the applied credit while
        // carryoverCredit stayed full, and the next run would apply it a second
        // time (double credit = under-charge). Writing it here makes the two
        // docs consistent even if the email later fails.
        if (carryoverApplied > 0) {
          const carryLeft = Math.max(0, carryAvail - carryoverApplied);
          await custRef.update({
            carryoverCredit: carryLeft,
            carryoverNotes: carryLeft > 0
              ? [{ amount: carryLeft, reason: 'Carryover credit remaining', date: new Date().toISOString() }]
              : []
          });
        }

        const feet = Number(cust.measuredFeet) || 0;
        const basePrice = Number(cust.housePrice) || 0;
        const feetLine = (feet && perFootRate)
          ? ('Installation service \u2014 ' + feet + ' ft @ $' + perFootRate.toFixed(2) + '/ft = $' + basePrice.toFixed(2))
          : ('Installation service = $' + basePrice.toFixed(2));
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
        const tplSnap = await db.collection('emailTemplates').where('name', '==', templateName).limit(1).get();
        let body;
        if (tplSnap.empty) {
          // A missing or renamed template must NOT silently stop billing. Fall
          // back to a built-in body (with all the tokens) so the invoice still
          // goes out; note it in the run log so staff can restore the template.
          body = status === 'Paid in Full'
            ? 'Hi {{name}},<br><br>Thank you — your Christmas lights invoice is paid in full.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{fee_lines}}<br>{{credit_lines}}<br><br>Amount paid: {{amount_paid}}<br><br>{{portal_button}}<br><br>— Highlighting Utah'
            : 'Hi {{name}},<br><br>Here is your Christmas lights invoice.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{fee_lines}}<br>{{credit_lines}}<br><br>Amount due: {{amount_due}}<br><br>{{portal_button}} {{venmo_button}}<br><br>Questions? {{message_link}}<br><br>— Highlighting Utah';
          if (errors.length < 10) errors.push('Template missing, used built-in fallback: ' + templateName);
        } else {
          body = tplSnap.docs[0].data().body || '';
        }

        const token = await ensureToken(id, cust);
        const portalUrl = 'https://highlightingutah.com/#/payment' + (token ? ('?token=' + token) : '');
        const messagesUrl = 'https://highlightingutah.com/#/contact';
        const venmoUrl = 'https://venmo.com/HighLightingUtah?txn=pay&amount=' + amountDue.toFixed(2) + '&note=' + encodeURIComponent('Christmas Lights');
        const btnStyleGold = 'display:inline-block; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:15px; margin:6px 8px 6px 0; background:#D89F3D; color:#1E3B2C;';

        body = body.split('{{name}}').join(cust.name || 'there');
        body = body.split('{{feet_line}}').join(feetLine);
        body = body.split('{{new_member_fee_line}}').join(newMemberLine);
        body = body.split('{{credit_lines}}').join(creditLines);
        body = body.split('{{fee_lines}}').join(feeLines);
        body = body.split('{{amount_due}}').join('$' + amountDue.toFixed(2));
        body = body.split('{{amount_paid}}').join('$' + paid.toFixed(2));
        body = body.split('{{portal_link}}').join(portalUrl);
        body = body.split('{{portal_button}}').join('<a href="' + portalUrl + '" style="' + btnStyleGold + '">Log Into Your Portal</a>');
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
        // we only mark the email sent.
        await custRef.update({
          invoiceEmailSent: true,
          invoiceEmailSentAt: admin.firestore.FieldValue.serverTimestamp()
        });
        sentCount++;
      } catch (err) {
        errorCount++;
        errors.push(String((err && err.message) || err));
      }
    }

    const result = {
      dateStr: todayStr, sentCount, skippedNeedsFix, skippedNotDone,
      errorCount, errors: errors.slice(0, 10), triggeredBy
    };
    await logNightlyInvoiceRun(result);
    return result;
  } catch (err) {
    const result = {
      dateStr: todayStr, sentCount, skippedNeedsFix, skippedNotDone,
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
      const photoHtml = q.frontPhotoUrl
        ? ('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 14px;"><tr><td>' +
            '<img src="' + q.frontPhotoUrl + '" alt="Your home" width="560" style="width:100%; max-width:560px; height:auto; border-radius:8px; display:block; border:0;">' +
            '<p style="margin:8px 0 0; font-size:12px; color:#6E6858; font-family:Arial,sans-serif;">Not showing? <a href="' + q.frontPhotoUrl + '" style="color:#3E7A5B;">View the photo here</a>.</p>' +
          '</td></tr></table>')
        : '';
      body = body.replace(/(?:\s|<br\s*\/?>)*\{\{photo\}\}(?:\s|<br\s*\/?>)*/gi, photoHtml || '<br>');
      body = body.split('{{quote_yes_button}}').join('<a href="' + base + '&action=approve" style="' + btn + ' background:#2E6B3E; color:#ffffff;">Approve Quote</a>');
      body = body.split('{{quote_maybe_button}}').join('<a href="' + base + '&action=maybe_next_year" style="' + btn + ' background:#D89F3D; color:#1E3B2C;">Maybe Next Year</a>');
      body = body.split('{{quote_decline_button}}').join('<a href="' + base + '&action=decline" style="' + btn + ' background:#8A8F9C; color:#ffffff;">Decline Quote</a>');
      body = body.split('{{link}}').join(base);
      body = body.replace(/\n/g, '<br>');
      if (!photoHtml && body.indexOf('<img') === -1 && q.frontPhotoUrl) body += photoHtml;

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
