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

const { CUSTOMERS, INVOICES, SETTINGS, QUOTES, FROZEN_NOW,
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
    /* Real onSnapshot NEVER fires its callback synchronously, even for a
     * cached/local read — it always resolves after the current script has
     * finished running. Firing synchronously here made this fake report
     * hoisted-but-not-yet-assigned page variables (e.g. "var currentTipAmount
     * = 0;" declared further down the file) as undefined at snapshot time,
     * when the real SDK would already see the page's top-level script done
     * and the variable initialized. That crashed updateTipBreakdown() before
     * it reached setupPaypalButtonsIfNeeded() — a fake-only bug, not a real
     * one, and it was masking the actual t11 PayPal behaviour. */
    Promise.resolve().then(() => {
      try {
        cb({ exists: () => bucket !== null, data: () => bucket || {},
             empty: true, docs: [], forEach: () => {} });
      } catch (e) {
        /* The page's own snapshot handler threw. Swallowing this silently hid a
         * real cause once already — record it so a test can report it. */
        (window.__HU_SNAPSHOT_ERRORS__ = window.__HU_SNAPSHOT_ERRORS__ || []).push(String(e));
        console.error('snapshot handler threw:', e);
      }
    });
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

  /* Mirrors the real portalInvoice (functions/index.js): fetch the invoice
   * doc by payload.key, then authorize via a matching token OR a whole-word
   * last-name match against the invoice's own name field — and hand back
   * only { found, record } with record trimmed to INVOICE_READ_FIELDS. This
   * used to return the raw fixture object with no "record" wrapper at all,
   * so #infoName/#infoPhone/#infoEmail always rendered blank (checklist
   * test 9), which in turn made test 14's Save button refuse to submit
   * ("Name, phone, and address are required"). */
  function invoice(payload) {
    const key = payload.key || '';
    const inv = key ? F.invoices[key] : null;
    if (!inv) return { found: false };

    let authorized = false;
    if (payload.token) {
      const cust = F.byToken(payload.token);
      if (cust && cust.invoiceKey === key) authorized = true;
    }
    if (!authorized && payload.lastName) {
      const typed = String(payload.lastName).toLowerCase().trim();
      const stored = String(inv.name || '').toLowerCase().trim();
      if (stored && (stored === typed || stored.split(/[\\s\\-']+/).filter(Boolean).indexOf(typed) !== -1)) {
        authorized = true;
      }
    }
    if (!authorized) return { found: false };

    /* ⚠ Must stay identical to INVOICE_READ_FIELDS in functions/index.js. A
       field missing here is silently stripped, and the page then renders as if
       production never sent it — which is exactly how checklist test 9 looked
       like a page bug for so long. lastPaymentAt / lastPaymentMethod were
       added to the real list on 2026-08-14 so the portal can answer "did you
       get my payment?"; without them here that answer disappears in tests. */
    const READ_FIELDS = ['name', 'phone', 'email', 'install', 'removal',
      'deposit', 'credits', 'creditNotes', 'changeFees', 'changeFeeNotes',
      'lastPaymentAt', 'lastPaymentMethod'];
    const record = {};
    READ_FIELDS.forEach(f => { if (inv[f] !== undefined) record[f] = inv[f]; });
    /* ⚠ DERIVED ON THE SERVER, exactly as the real portalInvoice derives it —
       index.html deliberately does NOT work the carried balance out for itself
       (that would be a third copy of a money rule money-parity holds to two,
       and it would be the copy the customer reads). Without these two fields
       the portal's arrears notice can never appear in a test, and the split
       payment looks unbuilt when it is merely unsent. */
    const total = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
    const balanceDue = Math.max(0, total - (Number(inv.credits) || 0) - (Number(inv.deposit) || 0));
    const a = stubArrears(inv);
    /* Capped here and NOT inside stubArrears: portalInvoice returns the raw figure
       and index.html caps it against the balance, so a stub that capped for every
       caller would hide a page that had stopped doing so. */
    record.arrearsOutstanding = Math.min(a.outstanding, balanceDue);
    record.arrearsSeason = a.season;
    return { found: true, record };
  }

  /* Mirrors the real publicQuoteLookup (functions/index.js): the 'quotes'
   * collection, filtered by phone or email, with NO last-name check — that
   * matching happens client-side in tryShowQuoteReview(). This callable had
   * no fake at all until checklist test 17 needed one; before this, calling
   * it rejected with "no fake for callable" and tryShowQuoteReview()'s own
   * .catch() silently swallowed that into the empty/not-found state, which
   * is why the quote review card could never appear in a test. */
  function publicQuoteLookup(payload) {
    const phone = String(payload.phone || '').replace(/\\D/g, '');
    const email = String(payload.email || '').toLowerCase().trim();
    const quotes = [];
    Object.keys(F.quotes || {}).forEach(function (k) {
      const q = F.quotes[k];
      const d = q.data;
      if (phone) {
        if (String(d.phone || '').replace(/\\D/g, '') !== phone) return;
      } else if (email) {
        if (String(d.email || '').toLowerCase().trim() !== email) return;
      } else {
        return;
      }
      quotes.push({ id: q.id, data: Object.assign({}, d) });
    });
    return { quotes: quotes };
  }

  /* ⭐ ONE ARREARS DERIVATION FOR THE WHOLE STUB, mirroring arrearsOutstandingServer
     in functions/index.js: what the carried line adds up to, less what has been paid
     and credited against it, floored at nought. Two copies in here would drift from
     each other and, worse, could agree with a broken page. */
  function stubArrears(inv) {
    const notes = Array.isArray(inv && inv.changeFeeNotes) ? inv.changeFeeNotes : [];
    const owed = notes.reduce(function (sum, n) {
      return sum + ((n && n.kind === 'arrears') ? (Number(n.amount) || 0) : 0);
    }, 0);
    const paid = (Number((inv && inv.deposit) || 0)) + (Number((inv && inv.credits) || 0));
    const withYear = notes.find(function (n) { return n && n.kind === 'arrears'; });
    return {
      outstanding: owed <= 0 ? 0 : Math.max(0, owed - paid),
      season: (withYear && (withYear.year || (/(\d{4})/.exec(withYear.reason || '') || [])[1])) || ''
    };
  }

  const HANDLERS = {
    portalLookup:      lookup,
    portalInvoice:     invoice,
    /* ⚠ THROWS FOR AN UNKNOWN TOKEN, BECAUSE THE REAL ONE THROWS. portalRsvp
       does throw new HttpsError of not-found, which REJECTS the callable on the
       client -- it does NOT resolve with ok:false. This used to return ok:true
       for ANY token at all, so every spec exercised a path no real customer
       with a stale link ever reaches, and the failure wording went unchecked.
       Same fix, and the same reasoning, as quoteRespond below.
       ⚠ AND IT READS response, NOT answer. index.html sends {token, response};
       the old stub echoed p.answer, which is always undefined, so nothing here
       could ever have caught a wrong answer being sent.
       ⚠ NO BACKTICKS ANYWHERE IN THIS FILE. Its source is injected into the
       page as a template literal, so one backtick in a comment ends the literal
       and the whole stub fails to parse -- which reads as "no tests found",
       not as a syntax error in a comment. */
    portalRsvp: function (payload) {
      const token = String((payload && payload.token) || '').trim();
      const response = String((payload && payload.response) || '').trim();
      if (['yes', 'no', 'backnextyear'].indexOf(response) === -1) {
        throw new Error('Unknown RSVP response: ' + response);
      }
      /* The same documented sentinel quoteRespond carries, so a spec can prove
         a genuine outage still reads as one rather than as a stale link. */
      if (token === 'forceinternal') {
        const e = new Error('boom'); e.code = 'functions/internal'; throw e;
      }
      let hit = null;
      Object.keys(F.customers || {}).forEach(function (k) {
        if (F.customers[k].token === token) hit = F.customers[k];
      });
      if (!hit) { const e = new Error('Account not found.'); e.code = 'functions/not-found'; throw e; }
      /* ⚠ AND SO DOES WHAT THEY STILL OWE FROM LAST SEASON, on a yes. The real
         portalRsvp reads the invoice and returns these two so the confirmation can
         stop promising an install to somebody RS-24 holds out of the season. Without
         them here the notice can never appear in a browser test, and a spec asserting
         it would be green over a server that never sent it -- which is the exact way
         this stub has already been caught lying three times.
         ⚠ DERIVED FROM THE FIXTURE INVOICE, never hardcoded, and by the SAME key rule
         the server uses: the bill the house is ON (billToPhone) before the house's own
         key. A stub that returns a constant proves only that the page can render a
         number somebody typed into the stub. */
      let arrearsOutstanding = 0;
      let arrearsSeason = '';
      if (response === 'yes') {
        const billKey = String((hit.record && hit.record.billToPhone) || '').replace(/\D/g, '') ||
                        hit.invoiceKey;
        const inv = billKey ? (F.invoices || {})[billKey] : null;
        if (inv) {
          const a = stubArrears(inv);
          arrearsOutstanding = a.outstanding;
          arrearsSeason = a.season;
        }
      }
      /* The gate code rides back on the answer, exactly as the real one does,
         so the step that follows can CONFIRM a code we hold rather than ask a
         customer who already told us. */
      return { ok: true, rsvpStatus: response,
               arrearsOutstanding: arrearsOutstanding,
               arrearsSeason: arrearsSeason,
               gateCode: String((hit.record && hit.record.gateCode) || '') };
    },

    /* Mirrors portalSetGateCode: token is the credential, one field is written,
       an unknown token THROWS not-found like every other portal callable. The
       write is recorded on the fixture so a spec can assert what was saved
       rather than only that the call happened. */
    portalSetGateCode: function (payload) {
      const token = String((payload && payload.token) || '').trim();
      const gateCode = String((payload && payload.gateCode) || '').trim().slice(0, 60);
      if (token === 'forcegatefail') {
        const e = new Error('boom'); e.code = 'functions/internal'; throw e;
      }
      let hit = null;
      Object.keys(F.customers || {}).forEach(function (k) {
        if (F.customers[k].token === token) hit = F.customers[k];
      });
      if (!hit) { const e = new Error('Account not found.'); e.code = 'functions/not-found'; throw e; }
      if (hit.record) hit.record.gateCode = gateCode;
      return { ok: true, gateCode: gateCode };
    },
    portalSave:        () => ({ ok: true, saved: true }),
    publicQuoteLookup: publicQuoteLookup,

    /* The emailed quote buttons and the quote link both answer through this
       one. Mirrors the real quoteRespond (functions/index.js): it looks the
       quote up BY TOKEN — nothing else — and refuses an unknown action, so a
       spec that sends a bad token or a bad action gets the real failure rather
       than a cheerful ok. */
    quoteRespond: function (payload) {
      const token = String((payload && payload.quoteToken) || '').trim();
      const action = String((payload && payload.action) || '').toLowerCase();
      if (['approve', 'decline', 'maybe_next_year'].indexOf(action) === -1) {
        throw new Error('Unknown quote action.');
      }
      let hit = null;
      Object.keys(F.quotes || {}).forEach(function (k) {
        if (F.quotes[k].data.quoteToken === token) hit = F.quotes[k];
      });
      /* ⚠ THROWS, BECAUSE THE REAL ONE THROWS. quoteRespond does
         throw new HttpsError of not-found, which REJECTS the callable on the
         client — it does NOT resolve with ok:false. This stub returned
         ok:false, so index.html's if(!res||!res.ok) branch looked covered while being unreachable in production, and every
         dead quote link showed the customer "Something went wrong" instead.
         A stub that fails more gently than production hides exactly the
         handling that only ever runs in production. */
      /* A documented sentinel so a spec can exercise the OTHER failure — a
         function that actually crashed. Without it there is no way to prove
         the not-found wording is not simply shown for everything, which is the
         opposite error and hides a real outage. */
      if (token === 'qt_forceinternal') {
        const e = new Error('boom'); e.code = 'functions/internal'; throw e;
      }
      if (!hit) { const e = new Error('Quote not found.'); e.code = 'functions/not-found'; throw e; }
      /* ⚠ AND WHAT THAT MEMBER STILL OWES FROM LAST SEASON, on an approve. Approving
         IS a yes for an existing member -- the real quoteRespond writes seasonYesUpdates
         -- so RS-24 holds them out of the season on the money, and all three of this
         page's approval endings used to promise an install anyway. Without this here
         no browser test could see the fix, whether or not the server sends it.
         ⚠ RESOLVED ONLY THROUGH THE EXPLICIT LINK, exactly as the real one is. It must
         NOT fall back to matching a phone: 17 numbers in the real book are shared and 14
         are two genuinely different households, so a phone join would hand one house's
         debt to another family. That join is red-checked against in Suite 69. */
      let qArrears = { outstanding: 0, season: '' };
      if (action === 'approve' && hit.data.existingCustomerId) {
        let cust = null;
        Object.keys(F.customers || {}).forEach(function (k) {
          if (F.customers[k].id === hit.data.existingCustomerId) cust = F.customers[k];
        });
        if (cust) {
          const billKey = String((cust.record && cust.record.billToPhone) || '').replace(/\D/g, '') ||
                          cust.invoiceKey;
          const inv = billKey ? (F.invoices || {})[billKey] : null;
          if (inv) qArrears = stubArrears(inv);
        }
      }
      return { ok: true, quoteId: hit.id, name: hit.data.name,
               arrearsOutstanding: qArrears.outstanding,
               arrearsSeason: qArrears.season,
               formCompleted: !!hit.data.formCompleted };
    },

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
      /* ⚠ A THROWN HttpsError REJECTS ON THE WIRE, it does not surface as a
         synchronous throw at the call site. Without this try/catch the stub
         threw out of callPortalFn itself, which no .catch would ever see —
         a third failure shape that production does not have. */
      try {
        return Promise.resolve({ data: handler(payload || {}) });
      } catch (e) {
        return Promise.reject(e);
      }
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
    /* The real SDK always exports these funding-source constants; index.html
     * reads window.paypal.FUNDING.CARD and .PAYPAL unconditionally when
     * wiring up the buttons. Omitting this crashed renderPaypalButtons() with
     * "Cannot read properties of undefined (reading 'PAYPAL')" — a fake-only
     * gap, not a real app bug. */
    FUNDING: { CARD: 'card', PAYPAL: 'paypal', VENMO: 'venmo' },
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
    quotes:   Object.assign({}, QUOTES,   overrides.quotes   || {}),
    frozenNow: FROZEN_NOW.toISOString()
  };

  // Fixture data + the two lookup helpers, injected before any page script runs.
  await page.addInitScript(
    ({ fx, customers, quotes }) => {
      window.__HU_FIXTURES__ = Object.assign({}, fx, {
        customers,
        quotes,
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
    {
      fx: fixtures,
      customers: Object.assign({}, CUSTOMERS, overrides.customers || {}),
      quotes: Object.assign({}, QUOTES, overrides.quotes || {})
    }
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
