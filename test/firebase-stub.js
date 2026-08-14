/*
 * Firebase stub — Highlighting Utah browser tests
 *
 * THE RULE THIS FILE ENFORCES (CLAUDE.md §9.4):
 *   Tests never touch real Firebase. Not ever, not "just to read".
 *   There are ~967 real customers and real money in that project.
 *
 * How it works, and why it needs no change to index.html:
 * index.html imports Firebase as ES modules straight from the CDN —
 *     https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js       (etc.)
 * Playwright intercepts those three URLs and serves fake modules instead. The
 * page's own code is untouched and runs exactly as it does in production; only
 * the thing underneath it is fake.
 *
 * The whole member portal talks to the backend through ONE helper,
 * callPortalFn() → httpsCallable(), across four callables:
 *     portalLookup · portalInvoice · portalRsvp · portalSave
 * So faking those four plus a couple of settings reads covers the portal
 * completely. That is why this file is short.
 *
 * SECOND JOB — the guard. Any request that escapes to a real Firebase,
 * Google API or PayPal endpoint is ABORTED and recorded. assertNoRealCalls()
 * then fails the test loudly. A test that silently reaches production is worse
 * than no test, so this must never be softened into a warning.
 */

const { CUSTOMERS, INVOICES, SETTINGS, FROZEN_NOW,
        customerByToken, customerByContact } = require('./fixtures');

/* Hosts a test must never reach. Matched as substrings against the URL. */
const FORBIDDEN_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'cloudfunctions.net',
  'run.app',                    // Firebase Functions v2 runs on Cloud Run
  'firebaseio.com',
  'paypal.com',
  'api.emailjs.com'
];

/* ---- the fake ES modules served in place of the CDN files ---------------- */

const FAKE_APP_MODULE = `
  export function initializeApp(config) { return { name: 'stub', options: config }; }
  export function getApp() { return { name: 'stub' }; }
`;

/* Only the named exports index.html actually imports. If the page starts
 * importing something else the import fails LOUDLY with a clear browser error
 * rather than silently yielding undefined — which is what we want. */
const FAKE_FIRESTORE_MODULE = `
  const settings = window.__HU_FIXTURES__.settings;

  export function getFirestore() { return { __stub: true }; }
  export function collection(db, name) { return { __col: name }; }
  export function doc(dbOrCol, a, b) {
    const col = dbOrCol && dbOrCol.__col ? dbOrCol.__col : a;
    const id  = dbOrCol && dbOrCol.__col ? a : b;
    return { __col: col, __id: id };
  }
  export function getDoc(ref) {
    const bucket = settings[ref.__id] || null;
    return Promise.resolve({
      exists: () => bucket !== null,
      data: () => bucket || {},
      id: ref.__id
    });
  }
  export function getDocs() {
    return Promise.resolve({ empty: true, docs: [], forEach: () => {} });
  }
  export function onSnapshot(ref, cb) {
    const bucket = (ref && settings[ref.__id]) || null;
    try {
      cb({ exists: () => bucket !== null, data: () => bucket || {},
           empty: true, docs: [], forEach: () => {} });
    } catch (e) {
      /* The page's own snapshot handler threw. Swallowing this silently hid a
       * real cause once already — record it so a test can report it. */
      (window.__HU_SNAPSHOT_ERRORS__ = window.__HU_SNAPSHOT_ERRORS__ || []).push(String(e));
      console.error('snapshot handler threw:', e);
    }
    return () => {};
  }

  // Writes are accepted and recorded, never sent anywhere.
  window.__HU_WRITES__ = [];
  export function addDoc(ref, data)   { window.__HU_WRITES__.push({ op:'add',    ref, data }); return Promise.resolve({ id:'stub-new' }); }
  export function setDoc(ref, data)   { window.__HU_WRITES__.push({ op:'set',    ref, data }); return Promise.resolve(); }
  export function updateDoc(ref,data) { window.__HU_WRITES__.push({ op:'update', ref, data }); return Promise.resolve(); }
  export function deleteDoc(ref)      { window.__HU_WRITES__.push({ op:'delete', ref });       return Promise.resolve(); }

  export function query(...a) { return a[0]; }
  export function orderBy()   { return {}; }
  export function where()     { return {}; }
  export function limit()     { return {}; }
  export function serverTimestamp() { return new Date(window.__HU_FIXTURES__.frozenNow); }
`;

/* The four portal callables. This mirrors the real return shapes read out of
 * functions/index.js — portalLookup returns {found, id, token, deactivated,
 * invoiceKey, record}, where record is sanitizeRecord() output. */
const FAKE_FUNCTIONS_MODULE = `
  const F = window.__HU_FIXTURES__;

  window.__HU_CALLS__ = [];

  function lookup(payload) {
    let cust = null;
    if (payload.token)      cust = F.byToken(payload.token);
    else if (payload.phone) cust = F.byContact(payload.phone, payload.lastName);
    else if (payload.email) cust = F.byContact(payload.email, payload.lastName);
    if (!cust) return { found: false };
    return {
      found: true,
      id: cust.id,
      token: cust.token,
      deactivated: cust.deactivated,
      invoiceKey: cust.invoiceKey,
      record: cust.record
    };
  }

  /* Must mirror portalInvoice in functions/index.js, which answers
   *     { found: true, record: sanitizeInvoice(data) }
   * — a NESTED record, and it takes the invoice key as "key".
   *
   * This used to return the invoice fields flat and read payload.invoiceKey,
   * neither of which production does. index.html reads res.record, so every
   * field came back undefined and the page rendered with an empty name and no
   * amounts — a spec failure that looked like a bug in the page. Fixed
   * 2026-08-14 (CLAUDE.md §9.13: the fixtures assert the shape production
   * actually returns, or they assert nothing). */
  function invoice(payload) {
    const cust = payload.token ? F.byToken(payload.token) : null;
    const key  = (cust && cust.invoiceKey) || payload.key || payload.invoiceKey;
    const inv  = key ? F.invoices[key] : null;
    if (!inv) return { found: false };
    const record = Object.assign({}, inv);
    delete record.found;          // "found" is the envelope, not a field
    return { found: true, record: record };
  }

  const HANDLERS = {
    portalLookup:  lookup,
    portalInvoice: invoice,
    portalRsvp:    p => ({ ok: true, rsvpStatus: p && p.answer }),
    portalSave:    () => ({ ok: true, saved: true }),

    /* index.html calls this on load to fetch the three public-safe EmailJS
     * identifiers. It is fire-and-forget with a .catch() that swallows
     * failure, so a missing fake does not break the page — but it DOES send a
     * request to the real backend, which the guard then reports. Faked as
     * not-configured: notification emails simply do not send in a test. */
    publicConfig: () => ({ configured: false })
  };

  export function getFunctions() { return { __stub: true }; }

  export function httpsCallable(fns, name) {
    return function (payload) {
      window.__HU_CALLS__.push({ name, payload: payload || {} });
      const handler = HANDLERS[name];
      if (!handler) {
        // An unfaked callable must fail loudly, not resolve to undefined.
        return Promise.reject(new Error(
          'TEST STUB: no fake for callable "' + name + '". Add it to tests/firebase-stub.js.'
        ));
      }
      return Promise.resolve({ data: handler(payload || {}) });
    };
  }
`;

/* The PayPal SDK, faked.
 *
 * setupPaypalButtonsIfNeeded() injects a <script> from www.paypal.com/sdk/js.
 * paypal.com is on FORBIDDEN_HOSTS (correctly — no test may touch real
 * payments), which meant the t11 button could never render: the test was
 * blocking the very thing it asserted. Serving a fake SDK lets the page's own
 * PayPal setup code run for real, while nothing leaves the machine.
 *
 * Only the surface index.html actually uses: Buttons(), isEligible(), render().
 * onApprove is never invoked — capturing a payment is out of scope for a
 * browser test and always will be (CLAUDE.md §9.11). */
const FAKE_PAYPAL_SDK = `
  window.__HU_PAYPAL_LOADED__ = true;
  window.paypal = {
    Buttons: function (opts) {
      window.__HU_PAYPAL_OPTS__ = opts || {};
      return {
        isEligible: function () { return true; },
        render: function (target) {
          const el = typeof target === 'string'
            ? document.querySelector(target) : target;
          if (el) {
            el.innerHTML =
              '<button type="button" data-testid="paypal-fake-button">' +
              'PayPal (test double)</button>';
          }
          return Promise.resolve();
        }
      };
    }
  };
`;

const MODULE_BY_URL = [
  ['firebase-app.js', FAKE_APP_MODULE],
  ['firebase-firestore.js', FAKE_FIRESTORE_MODULE],
  ['firebase-functions.js', FAKE_FUNCTIONS_MODULE],
  /* Checked BEFORE the forbidden-host list, so the fake is served rather than
   * the request being blocked. Order inside the handler matters here. */
  ['paypal.com/sdk/js', FAKE_PAYPAL_SDK]
];

/* ---- installation -------------------------------------------------------- */

/**
 * Wire the stub onto a Playwright page. Call this BEFORE page.goto().
 * Returns a handle with assertNoRealCalls() and helpers to read what the page
 * tried to do.
 */
async function installFirebaseStub(page, overrides = {}) {
  const escapes = [];

  const fixtures = {
    settings: Object.assign({}, SETTINGS, overrides.settings || {}),
    invoices: Object.assign({}, INVOICES, overrides.invoices || {}),
    frozenNow: FROZEN_NOW.toISOString()
  };

  // Fixture data + the two lookup helpers, injected before any page script runs.
  await page.addInitScript(
    ({ fx, customers }) => {
      window.__HU_FIXTURES__ = Object.assign({}, fx, {
        customers,
        byToken(token) {
          return Object.values(customers).find(c => c.token === token) || null;
        },
        byContact(contact, lastName) {
          const digits = String(contact || '').replace(/\D/g, '');
          const email = String(contact || '').toLowerCase().trim();
          const typed = String(lastName || '').toLowerCase().trim();
          return Object.values(customers).find(c => {
            const cPhone = String(c.record.phone || '').replace(/\D/g, '');
            const cEmail = String(c.record.email || '').toLowerCase().trim();
            const hit = (digits && cPhone && cPhone === digits) ||
                        (!digits && cEmail && cEmail === email);
            if (!hit || !typed) return false;
            const stored = String(c.record.name || '').toLowerCase().trim();
            return stored.split(/\s+/).includes(typed) || stored.includes(typed);
          }) || null;
        }
      });
    },
    { fx: fixtures, customers: Object.assign({}, CUSTOMERS, overrides.customers || {}) }
  );

  /* ONE handler for everything, deliberately.
   *
   * This was originally four separate page.route() calls: three serving the
   * fake Firebase modules, then a catch-all guard. That was BROKEN, and
   * silently so. Playwright matches routes LAST-REGISTERED-FIRST, so the
   * catch-all won for every URL including the gstatic ones, called
   * continue() on them, and the page loaded the REAL Firebase SDK. Every
   * portal call then went to the live project. The guard caught it — which is
   * the only reason it was noticed — but the fakes never ran at all.
   *
   * A single handler has no ordering to get wrong. Order INSIDE it is
   * explicit and readable: fake the modules first, then block anything real,
   * then let ordinary page assets (HTML, CSS, fonts) through. */
  await page.route('**/*', route => {
    const url = route.request().url();

    for (const [needle, body] of MODULE_BY_URL) {
      if (url.includes(needle)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript; charset=utf-8',
          body
        });
      }
    }

    if (FORBIDDEN_HOSTS.some(h => url.includes(h))) {
      escapes.push(url);
      return route.abort();
    }

    return route.continue();
  });

  return {
    /** Fails the test if the page reached, or tried to reach, anything real. */
    assertNoRealCalls() {
      if (escapes.length) {
        throw new Error(
          'A test tried to reach a REAL backend — this must never happen.\n' +
          escapes.map(u => '  → ' + u).join('\n') +
          '\nSee CLAUDE.md §9.4. Fix the stub; do not relax the guard.'
        );
      }
    },
    /** Which callables the page invoked, in order, with their payloads. */
    calls: () => page.evaluate(() => window.__HU_CALLS__ || []),
    /** Firestore writes the page attempted (none are sent anywhere). */
    writes: () => page.evaluate(() => window.__HU_WRITES__ || [])
  };
}

module.exports = { installFirebaseStub, FORBIDDEN_HOSTS };
