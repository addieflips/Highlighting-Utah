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
// name, or appear inside it. Stored names are "Last First" format.
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

  await db.collection('jobAddresses').doc(match.id).update(updates);

  // The Lights tab also mirrors the description onto the invoice record.
  if (section === 'lights' && oldKey && updates.lightsDescription !== undefined) {
    try {
      await db.collection('invoices').doc(oldKey)
        .set({ lightsDescription: updates.lightsDescription }, { merge: true });
    } catch (err) {
      console.error('[HU] invoice lights sync failed:', err);
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

  return {
    ok: true,
    addressChanged: addressChanged,
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
 * Input: { quoteToken, action }  where action = 'approve' | 'decline'
 *
 * Quote approval links have been failing silently from the public site because
 * the quotes collection is read/update restricted to staff. This runs the whole
 * flow server-side instead.
 */
exports.quoteRespond = onCall({ cors: true }, async (request) => {
  const body = request.data || {};
  const quoteToken = body.quoteToken ? String(body.quoteToken).trim() : '';
  const action = String(body.action || '').toLowerCase();

  if (!quoteToken) throw new HttpsError('invalid-argument', 'Missing quote token.');
  if (action !== 'approve' && action !== 'decline') {
    throw new HttpsError('invalid-argument', 'Unknown quote action.');
  }

  const snap = await db.collection('quotes')
    .where('quoteToken', '==', quoteToken).limit(1).get();
  if (snap.empty) throw new HttpsError('not-found', 'Quote not found.');

  const quoteId = snap.docs[0].id;
  const quoteData = snap.docs[0].data();

  await db.collection('quotes').doc(quoteId).update({
    approvalStatus: action === 'approve' ? 'approved' : 'declined',
    approvalRespondedAt: admin.firestore.FieldValue.serverTimestamp()
  });

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
    quotedPrice: quoteData.quotedPrice || 0
  };
});

/* ---------------------------------------------------------------------------
 * sendNightlyInvoices — runs every night at 7:00 PM Mountain Time.
 *
 * Looks at today's Install routes, and for every house the crew marked
 * "Done" (and did NOT flag for a fix), sends an automatic invoice email:
 *   - already paid in full  -> "Nightly Auto-Invoice — Paid Receipt" template
 *   - still owes money      -> "Nightly Auto-Invoice — Unpaid" template
 * Houses flagged "needs fix" or marked "Didn't Get To" by the crew are
 * skipped entirely and never billed. Each house is only ever billed once
 * (guarded by invoiceEmailSent on the jobAddresses doc).
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

async function logNightlyInvoiceRun(data) {
  await db.collection('nightlyInvoiceLog').add(Object.assign(
    { runAt: admin.firestore.FieldValue.serverTimestamp() },
    data
  ));
}

function computeInvoiceStatusServer(install, removal, deposit) {
  const total = (Number(install) || 0) + (Number(removal) || 0);
  const paid = Number(deposit) || 0;
  if (total <= 0 || paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid in Full';
  return 'Partial Payment';
}

exports.sendNightlyInvoices = onSchedule(
  { schedule: '0 19 * * *', timeZone: 'America/Denver', memory: '512MiB' },
  async () => {
    const todayStr = todayStrInDenver();
    let sentCount = 0, skippedNeedsFix = 0, skippedNotDone = 0, errorCount = 0;
    const errors = [];

    try {
      const autoSnap = await db.collection('settings').doc('nightlyInvoiceAutomation').get();
      if (!autoSnap.exists || !autoSnap.data().enabled) {
        return; // automation turned off — do nothing, don't even log
      }

      const emailSettingsSnap = await db.collection('settings').doc('emailjs').get();
      const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};
      const { serviceId, templateId, privateKey, publicKey } = emailSettings;
      if (!serviceId || !templateId || !privateKey) {
        await logNightlyInvoiceRun({
          dateStr: todayStr, sentCount: 0, skippedNeedsFix: 0, skippedNotDone: 0,
          errorCount: 1, errors: ['EmailJS not fully set up yet — need Service ID, Template ID, and Private Key under Automation > EmailJS Setup.']
        });
        return;
      }

      const pricingSnap = await db.collection('pricing').doc('config').get();
      const perFootRate = pricingSnap.exists ? (pricingSnap.data().perFootRate || 0) : 0;

      const routesSnap = await db.collection('scheduledRoutes')
        .where('date', '==', todayStr)
        .where('type', '==', 'install')
        .get();

      const stopIds = new Set();
      routesSnap.forEach((docSnap) => {
        (docSnap.data().stops || []).forEach((s) => { if (s.id) stopIds.add(s.id); });
      });

      for (const id of stopIds) {
        try {
          const custRef = db.collection('jobAddresses').doc(id);
          const custSnap = await custRef.get();
          if (!custSnap.exists) continue;
          const cust = custSnap.data();

          if (cust.needsFix) { skippedNeedsFix++; continue; }
          if (!cust.completed) { skippedNotDone++; continue; }
          if (cust.invoiceEmailSent) { continue; } // already billed for this install

          const email = cust.email;
          if (!email) { continue; } // nothing to send to

          const phone = digitsOnly(cust.phone);
          const invoiceKey = phone || String(cust.email || '').toLowerCase().trim();
          const invRef = db.collection('invoices').doc(invoiceKey);
          const invSnap = await invRef.get();
          const inv = invSnap.exists
            ? invSnap.data()
            : { install: Number(cust.housePrice) || 0, removal: 0, deposit: 0, name: cust.name, phone, email };

          const enrollYear = cust.createdAt && cust.createdAt.toDate ? cust.createdAt.toDate().getFullYear() : null;
          const isNewMember = enrollYear === new Date().getFullYear();
          if (isNewMember && !inv.newMemberFeeApplied) {
            inv.install = (Number(inv.install) || 0) + 30;
            inv.newMemberFeeApplied = true;
          }
          if (inv.install == null) inv.install = Number(cust.housePrice) || 0;

          const status = computeInvoiceStatusServer(inv.install, inv.removal || 0, inv.deposit || 0);
          inv.status = status;
          inv.name = inv.name || cust.name || '';
          inv.email = inv.email || cust.email || '';
          inv.phone = inv.phone || phone;
          inv.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          await invRef.set(inv, { merge: true });

          const feet = Number(cust.measuredFeet) || 0;
          const basePrice = Number(cust.housePrice) || 0;
          const feetLine = (feet && perFootRate)
            ? ('Installation service \u2014 ' + feet + ' ft @ $' + perFootRate.toFixed(2) + '/ft = $' + basePrice.toFixed(2))
            : ('Installation service = $' + basePrice.toFixed(2));
          const newMemberLine = isNewMember ? 'New member installation fee = $30.00' : '';

          const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0);
          const paid = Number(inv.deposit) || 0;
          const amountDue = Math.max(0, total - paid);

          const templateName = status === 'Paid in Full'
            ? 'Nightly Auto-Invoice \u2014 Paid Receipt'
            : 'Nightly Auto-Invoice \u2014 Unpaid';
          const tplSnap = await db.collection('emailTemplates').where('name', '==', templateName).limit(1).get();
          if (tplSnap.empty) {
            errors.push('Missing template: ' + templateName);
            errorCount++;
            continue;
          }
          let body = tplSnap.docs[0].data().body || '';

          const token = await ensureToken(id, cust);
          const portalUrl = 'https://highlightingutah.com/#/payment' + (token ? ('?token=' + token) : '');
          const messagesUrl = 'https://highlightingutah.com/#/contact';
          const venmoUrl = 'https://venmo.com/HighLightingUtah?txn=pay&amount=' + amountDue.toFixed(2) + '&note=' + encodeURIComponent('Christmas Lights');
          const btnStyleGold = 'display:inline-block; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:bold; font-family:Arial,sans-serif; font-size:15px; margin:6px 8px 6px 0; background:#D89F3D; color:#1E3B2C;';

          body = body.split('{{name}}').join(cust.name || 'there');
          body = body.split('{{feet_line}}').join(feetLine);
          body = body.split('{{new_member_fee_line}}').join(newMemberLine);
          body = body.split('{{amount_due}}').join('$' + amountDue.toFixed(2));
          body = body.split('{{amount_paid}}').join('$' + total.toFixed(2));
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

      await logNightlyInvoiceRun({
        dateStr: todayStr, sentCount, skippedNeedsFix, skippedNotDone,
        errorCount, errors: errors.slice(0, 10)
      });
    } catch (err) {
      await logNightlyInvoiceRun({
        dateStr: todayStr, sentCount, skippedNeedsFix, skippedNotDone,
        errorCount: errorCount + 1, errors: errors.concat([String((err && err.message) || err)]).slice(0, 10)
      });
    }
  }
);
