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
      houseHighlights: [],
      /* Added when scheduledDate / completed / removalDone joined
         PORTAL_READ_FIELDS so the portal could answer "when are you coming?".
         FROZEN_NOW is mid-season, so this one is already installed — the
         schedule strip should read Installed, not Scheduled. */
      scheduledDate: '2026-11-12',
      completed: true,
      removalDone: false
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
      seasonStatus: 'active',
      // Scheduled but NOT yet installed — the other half of the schedule strip.
      scheduledDate: '2026-11-18',
      completed: false
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
/* name/phone/email mirror the corresponding CUSTOMERS record — the real
 * portalInvoice reads these off the invoice document itself (INVOICE_READ_FIELDS
 * in functions/index.js), not off jobAddresses, but the two are kept in sync in
 * production and every fixture below matches its customer. Without them here,
 * the portal's #infoName/#infoPhone/#infoEmail fields render blank even though
 * the invoice was found — that blank #infoName was checklist test 9's failure,
 * and it cascaded into test 14 too (the Save button refuses to submit without
 * a name). */
const INVOICES = {
  '8015550142': {                    // standard — part paid
    found: true,
    name: 'Dana Petersen', phone: '8015550142', email: 'dana@example.com',
    install: 450, removal: 0, deposit: 200, credits: 0, changeFees: 0,
    status: 'Partial Payment',
    newMemberFeeApplied: false,
    /* Added when lastPaymentAt / lastPaymentMethod joined INVOICE_READ_FIELDS,
       so the portal can answer "did you get my payment?" instead of showing a
       balance that looks like the payment never arrived. */
    lastPaymentAt: '2026-11-10T18:30:00-07:00',
    lastPaymentMethod: 'paypal',
    /* ⭐ THIS CUSTOMER HAS BEEN BILLED (added 2026-09-02). `invoicedAt` is stamped by
       the nightly run in the same pass that emails the invoice, and cleared by Start
       New Season — so it is what the portal reads to decide whether a balance is
       actually due yet. It belongs on THIS fixture because a part-paid customer who
       had never been sent a bill is not a state that exists: they paid against
       something. The not-yet-billed case is its own fixture in the spec. */
    invoicedAt: '2026-11-05T02:00:00-07:00'
  },
  'jordan.reyes@example.com': {      // email-only — nothing paid yet
    found: true,
    /* Lowercase here, matching the doc id this invoice is filed under. Note
       the CUSTOMERS record above deliberately keeps the mixed-case
       'Jordan.Reyes@Example.com' — that is the one that proves invoiceKeyFor
       lowercases the KEY while the customer's own email stays as they typed
       it. Both spellings are therefore still exercised, just from the two
       different records rather than from this one. */
    name: 'Jordan Reyes', phone: '', email: 'jordan.reyes@example.com',
    install: 380, removal: 0, deposit: 0, credits: 0, changeFees: 0,
    status: 'Unpaid',
    newMemberFeeApplied: false
  },
  '8015550199': {                    // multi-house — three houses on one bill
    found: true,
    name: 'Sam Whitfield', phone: '8015550199', email: 'sam@example.com',
    install: 1275, removal: 0, deposit: 0, credits: 0, changeFees: 0,
    status: 'Unpaid',
    newMemberFeeApplied: false
  },
  '8015550188': {                    // a $30 light-change fee and a referral credit
    found: true,
    name: 'Alex Nakamura', phone: '8015550188', email: 'alex@example.com',
    install: 520, removal: 0, deposit: 0, credits: 25, changeFees: 30,
    status: 'Unpaid',
    newMemberFeeApplied: false
  },
  '8015550177': {                    // deactivated, settled
    found: true,
    name: 'Riley Cortez', phone: '8015550177', email: 'riley@example.com',
    install: 400, removal: 0, deposit: 400, credits: 0, changeFees: 0,
    status: 'Paid in Full',
    newMemberFeeApplied: false
  }
};

/* --- Quotes ----------------------------------------------------------------
 * publicQuoteLookup (functions/index.js) reads the 'quotes' collection
 * directly, filtered by phone or email — completely separate from
 * CUSTOMERS/jobAddresses and keyed by nothing a portal token can reach. This
 * one is priced but not yet converted to a customer: checklist test 17
 * ("Quote review" — "Instead of showing an invoice like it would for a
 * regular customer, the portal should show that person's quote details and
 * the price they were quoted, along with an 'Approve' button and a
 * 'Decline' button").
 *
 * lastNameInput below is the customer's actual last name — tryShowQuoteReview()
 * used to check only the FIRST word of the stored name (nameParts[0]), so
 * typing your real last name was refused unless your name happened to be
 * stored surname-first. Fixed to a whole-word, word-order-independent match
 * (same rule as nameMatches() in functions/index.js). This fixture typing the
 * real last name is what proves that fix, not a workaround for it.
 */
const QUOTES = {
  pendingReview: {
    id: 'quote-pending-review-1',
    lastNameInput: 'ashby',
    data: {
      name: 'Morgan Ashby',
      phone: '(801) 555-0166',
      email: 'morgan.ashby@example.com',
      address: '77 Aspen Ct, Lehi, UT 84043',
      houseAreas: ['Roofline', 'Bushes'],
      lightColors: ['Warm White'],
      installPreference: 'Any',
      quotedPrice: 495,
      quoteToken: 'quotetoken0000000001'
      // No approvalStatus — this is what makes it "pending" in
      // tryShowQuoteReview's eyes (only approved/declined/maybe_next_year
      // are treated as resolved).
    }
  },

  /* An EXISTING customer who also has a quote waiting. Different case from
     pendingReview above, and the one that was actually broken: the quote card
     only ever rendered when portalInvoice found nothing, so anybody who had
     ever been billed could not see a new quote at all. Alex Nakamura is
     CUSTOMERS.pendingRsvp — a real customer, with a real invoice (8015550188).
     Covered by offerPendingQuote() in index.html. */
  pendingForExistingCustomer: {
    id: 'quote-pending-existing-1',
    data: {
      name: 'Alex Nakamura',
      phone: '(801) 555-0188',
      email: 'alex@example.com',
      address: '311 Mill Race Rd, Pleasant Grove, UT 84062',
      lightColors: ['Warm White', 'Blue'],
      installPreference: 'November',
      estimatedFeet: 160,
      quotedPrice: 640,
      quoteToken: 'quotetoken0000000002',
      approvalStatus: 'pending',
      /* ⚠ WHAT MAKES THIS A MEMBER'S RE-QUOTE. quoteRespond decides alreadyMember
         from an EXPLICIT link — existingCustomerId on a record that still exists, or
         convertedToCustomerAt — never from a phone match, because 17 numbers in the
         real book are shared and 14 of those are two different households. Without
         this the fixture is just another new lead and the member branch is untested. */
      existingCustomerId: 'cust-standard-1',
      isRequote: true
    }
  },

  /* Already answered, so it must NOT be offered again. Belongs to
     CUSTOMERS.standard, who most specs sign in as — which also proves the
     ordinary customer is not shown a stray Approve button for a decision they
     already made. */
  alreadyApproved: {
    id: 'quote-approved-1',
    data: {
      name: 'Dana Petersen',
      phone: '(801) 555-0142',
      email: 'dana@example.com',
      address: '742 Evergreen Ln, Pleasant Grove, UT 84062',
      quotedPrice: 450,
      quoteToken: 'quotetoken0000000003',
      approvalStatus: 'approved'
    }
  }
};

/* --- Site settings -------------------------------------------------------
 * index.html reads paymentProvider and falls back to 'venmo'. Checklist test
 * 11 ("Pay with PayPal — only a Venmo link, no PayPal button") is about this
 * exact value, so it is a fixture knob, not a constant.
 */
const SETTINGS = {
  /* NOTE the key: index.html reads the payment provider from
   *     onSnapshot(doc(db,'siteContent','main'), ...)
   * NOT from settings/payments. Getting this wrong is why the t11 PayPal test
   * first failed — the fixture was filed under a document the page never
   * looks at, so PAYMENT_SETTINGS kept its 'venmo' default.
   *
   * paypalClientId must be non-empty too: setupPaypalButtonsIfNeeded() bails
   * out without one, so provider alone is not enough to render the button. */
  main: {
    paymentProvider: 'both',            // 'venmo' | 'paypal' | 'both'
    paypalClientId: 'test-client-id-not-a-real-one',
    phoneDisplay: '(801) 901-0011'
  },

  /* Kept for anything that reads settings/emailjs. publicConfig is faked as
   * not-configured in the stub, so notification emails never send in a test. */
  emailjs: { serviceId: '', notifyTemplateId: '', publicKey: '' }
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
  QUOTES,
  SETTINGS,
  customerByToken,
  customerByContact
};
