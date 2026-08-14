/*
 * Shared test fixtures — Highlighting Utah
 *
 * ONE source of fake data for every browser test. Do not let a spec invent its
 * own customer (CLAUDE.md §9.5) — they drift, and then no failure is trusted.
 *
 * The field names here are not invented. They are exactly PORTAL_READ_FIELDS
 * from functions/index.js, which is the only set of fields portalLookup ever
 * sends to the browser. If that list changes in the Cloud Function, change it
 * here too or the tests will be asserting against a shape production no longer
 * returns.
 *
 * The customers below are deliberately the awkward ones — the cases that have
 * actually caused problems in this system before, not four tidy examples.
 */

/* Frozen so screenshots and any date-derived text are stable. Visual
 * regression (Phase 4) depends on this never moving. Mid-season on purpose:
 * installs are done, invoices are out, RSVPs are live. */
const FROZEN_NOW = new Date('2026-11-15T12:00:00-07:00');

/* --- The customers -------------------------------------------------------
 * Each carries a one-line note saying WHY it exists. If a fixture has no
 * reason to exist, delete it rather than leaving a puzzle for the next person.
 */
const CUSTOMERS = {

  /* The ordinary case. Everything present, nothing unusual. Most specs use
   * this one so a failure elsewhere means something specific went wrong. */
  standard: {
    id: 'cust-standard',
    token: 'testtoken0000000001',
    deactivated: false,
    invoiceKey: '8015550142',
    record: {
      name: 'Dana Petersen',
      phone: '(801) 555-0142',
      email: 'dana@example.com',
      address: '742 Evergreen Ln, Pleasant Grove, UT 84062',
      gateCode: '4417',
      lightsDescription: 'Warm White',
      installPreference: 'Any',
      wireColor: 'White',
      outletTimer: 'Yes',
      specificOutlet: 'Front porch, left of door',
      specificOutletNotes: 'Behind the planter',
      notes: 'Dog in the back garden — please shut the side gate.',
      rsvpStatus: 'yes',
      seasonStatus: 'active',
      housePhotoUrl: 'https://example.invalid/house-standard.jpg',
      houseHighlights: []
    }
  },

  /* NO PHONE. The invoice key falls back to the lowercased email — see
   * custInvoiceKey / invoiceKeyFor. This customer exists because that fallback
   * is easy to break and nobody notices until a bill goes missing. */
  emailOnly: {
    id: 'cust-email-only',
    token: 'testtoken0000000002',
    deactivated: false,
    invoiceKey: 'jordan.reyes@example.com',
    record: {
      name: 'Jordan Reyes',
      phone: '',
      email: 'Jordan.Reyes@Example.com',
      address: '18 Canyon Rd, Lindon, UT 84042',
      lightsDescription: 'Warm White, Red',
      installPreference: 'October',
      wireColor: 'Green',
      outletTimer: 'No',
      rsvpStatus: 'yes',
      seasonStatus: 'active'
    }
  },

  /* One payer, several houses, joined by billToPhone. Their invoice total is
   * the SUM of the group — comparing it against one house's price produces a
   * false alarm on every multi-house payer. */
  multiHousePayer: {
    id: 'cust-multi-house',
    token: 'testtoken0000000003',
    deactivated: false,
    invoiceKey: '8015550199',
    record: {
      name: 'Sam Whitfield',
      phone: '(801) 555-0199',
      email: 'sam@example.com',
      address: '900 Orchard Dr, American Fork, UT 84003',
      lightsDescription: 'Warm White',
      installPreference: 'Any',
      rsvpStatus: 'yes',
      seasonStatus: 'active'
    }
  },

  /* RSVP'd no. portalLookup returns deactivated:true and the portal must show
   * the turned-off message instead of the account. */
  deactivated: {
    id: 'cust-deactivated',
    token: 'testtoken0000000004',
    deactivated: true,
    invoiceKey: '8015550177',
    record: {
      name: 'Riley Cortez',
      phone: '(801) 555-0177',
      email: 'riley@example.com',
      address: '55 Hillcrest Ave, Orem, UT 84057',
      rsvpStatus: 'no',
      seasonStatus: 'cancelled',
      cancellationReason: 'Moving house'
    }
  },

  /* Not yet answered for next season. This is the one the RSVP rebuild is
   * about — yes / no / back next year must each behave differently, and only
   * "no" may ever trigger recycling. */
  pendingRsvp: {
    id: 'cust-pending-rsvp',
    token: 'testtoken0000000005',
    deactivated: false,
    invoiceKey: '8015550188',
    record: {
      name: 'Alex Nakamura',
      phone: '(801) 555-0188',
      email: 'alex@example.com',
      address: '311 Mill Race Rd, Pleasant Grove, UT 84062',
      lightsDescription: 'Warm White, Blue',
      installPreference: 'November',
      rsvpStatus: '',
      seasonStatus: 'active'
    }
  }
};

/* --- Invoices, keyed the way portalInvoice returns them -------------------
 * Money formula, everywhere: (install + removal + changeFees) - credits
 * - deposit, floored at 0. These fixtures are hand-checked against it.
 */
const INVOICES = {
  '8015550142': {                    // standard — part paid
    found: true,
    install: 450, removal: 0, deposit: 200, credits: 0, changeFees: 0,
    status: 'Partial Payment',
    newMemberFeeApplied: false
  },
  'jordan.reyes@example.com': {      // email-only — nothing paid yet
    found: true,
    install: 380, removal: 0, deposit: 0, credits: 0, changeFees: 0,
    status: 'Unpaid',
    newMemberFeeApplied: false
  },
  '8015550199': {                    // multi-house — three houses on one bill
    found: true,
    install: 1275, removal: 0, deposit: 0, credits: 0, changeFees: 0,
    status: 'Unpaid',
    newMemberFeeApplied: false
  },
  '8015550188': {                    // a $30 light-change fee and a referral credit
    found: true,
    install: 520, removal: 0, deposit: 0, credits: 25, changeFees: 30,
    status: 'Unpaid',
    newMemberFeeApplied: false
  },
  '8015550177': {                    // deactivated, settled
    found: true,
    install: 400, removal: 0, deposit: 400, credits: 0, changeFees: 0,
    status: 'Paid in Full',
    newMemberFeeApplied: false
  }
};

/* --- Site settings -------------------------------------------------------
 * index.html reads paymentProvider and falls back to 'venmo'. Checklist test
 * 11 ("Pay with PayPal — only a Venmo link, no PayPal button") is about this
 * exact value, so it is a fixture knob, not a constant.
 */
const SETTINGS = {
  payments: { paymentProvider: 'both' },      // 'venmo' | 'paypal' | 'both'
  business: { phone: '(801) 901-0011' }
};

/* Helper: look a customer up the way portalLookup does, by token. */
function customerByToken(token) {
  return Object.values(CUSTOMERS).find(c => c.token === token) || null;
}

/* Helper: phone/email + last name sign-in, mirroring nameMatches() on the
 * server — the typed name must be a word in the stored name, or appear inside
 * it. Word-order independent, deliberately, same as production. */
function customerByContact(contact, lastName) {
  const digits = String(contact || '').replace(/\D/g, '');
  const email = String(contact || '').toLowerCase().trim();
  const typed = String(lastName || '').toLowerCase().trim();

  return Object.values(CUSTOMERS).find(c => {
    const cPhone = String(c.record.phone || '').replace(/\D/g, '');
    const cEmail = String(c.record.email || '').toLowerCase().trim();
    const matchesContact = (digits && cPhone && cPhone === digits) ||
                           (!digits && cEmail && cEmail === email);
    if (!matchesContact) return false;
    if (!typed) return false;
    const stored = String(c.record.name || '').toLowerCase().trim();
    return stored.split(/\s+/).includes(typed) || stored.includes(typed);
  }) || null;
}

module.exports = {
  FROZEN_NOW,
  CUSTOMERS,
  INVOICES,
  SETTINGS,
  customerByToken,
  customerByContact
};
