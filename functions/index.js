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
    out.push({ id: d.id, data: sanitizeQuote(data) });
  });

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
const INVOICE_READ_FIELDS = ['name', 'phone', 'email', 'install', 'removal', 'deposit', 'credits', 'creditNotes'];

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

async function logNightlyInvoiceRun(data) {
  await db.collection('nightlyInvoiceLog').add(Object.assign(
    { runAt: admin.firestore.FieldValue.serverTimestamp() },
    data
  ));
}

function computeInvoiceStatusServer(install, removal, deposit, credits) {
  const gross = (Number(install) || 0) + (Number(removal) || 0);   // the real charge
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
          const grossNow = (Number(inv.install) || 0) + (Number(inv.removal) || 0);
          const preBalance = Math.max(0, grossNow - (Number(inv.credits) || 0) - (Number(inv.deposit) || 0));
          carryoverApplied = Math.min(carryAvail, preBalance);
          if (carryoverApplied > 0) {
            inv.credits = (Number(inv.credits) || 0) + carryoverApplied;
            inv.creditNotes = (Array.isArray(inv.creditNotes) ? inv.creditNotes : [])
              .concat([{ amount: carryoverApplied, reason: 'Carryover credit', date: new Date().toISOString() }]);
          }
        }

        const status = computeInvoiceStatusServer(inv.install, inv.removal || 0, inv.deposit || 0, inv.credits || 0);
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

        const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0);
        const credits = Number(inv.credits) || 0;
        const paid = Number(inv.deposit) || 0;
        const amountDue = Math.max(0, total - credits - paid);
        const creditLines = (Array.isArray(inv.creditNotes) ? inv.creditNotes : [])
          .map(function (c) { return (c.reason || 'Credit') + ' = -$' + (Number(c.amount) || 0).toFixed(2); })
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
            ? 'Hi {{name}},<br><br>Thank you — your Christmas lights invoice is paid in full.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{credit_lines}}<br><br>Amount paid: {{amount_paid}}<br><br>{{portal_button}}<br><br>— Highlighting Utah'
            : 'Hi {{name}},<br><br>Here is your Christmas lights invoice.<br><br>{{feet_line}}<br>{{new_member_fee_line}}<br>{{credit_lines}}<br><br>Amount due: {{amount_due}}<br><br>{{portal_button}} {{venmo_button}}<br><br>Questions? {{message_link}}<br><br>— Highlighting Utah';
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
exports.sendNightlyInvoices = onSchedule(
  { schedule: '0 19 * * *', timeZone: 'America/Denver', memory: '512MiB' },
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
exports.sendInvoicesNow = onCall({ memory: '512MiB', timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  return await runInvoiceBatch('manual');
});
