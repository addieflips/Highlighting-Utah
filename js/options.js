/**
 * js/options.js — THE OPTION REGISTRY
 * ---------------------------------------------------------------------------
 * One list of everything a customer can ask for, and where each answer has to
 * end up. Eight artifacts generate from this file and nothing else.
 *
 * WHY: if each artifact renders its fields by hand, adding an option means
 * remembering eight places. Forgetting produces NO ERROR — the truck just shows
 * up without the timer. Generating them all from one list makes forgetting
 * impossible instead of something you test for. (R-001, R-003.)
 *
 * ⚠ NOT WIRED YET. As of 2026-08-21 nothing imports this file. The registry and
 * `audit()` are correct and gated in CI; §3.3 of the implementation plan — making
 * the eight artifacts actually render from it — has not been done. Until it is,
 * this file is the SPEC, and the artifacts are still hand-written. Do not assume
 * a change here reaches a screen.
 *
 * Derived from the code, then corrected by Addie 2026-08-21. The working is in
 * docs/option-registry-draft.md; the sources of truth it was read out of are:
 *   index.html   quoteDetailForm submit  — what a new customer is actually asked
 *   functions/index.js PORTAL_WRITE_FIELDS — what a member may change later
 *   admin.html   PRINT_COLUMNS            — what actually reaches paper
 */

/* R-014: business constants live in exactly one file. Anything numeric and
 * money- or sizing-shaped is imported, never re-typed here.
 * ⚠ FEET_PER_BUNDLE is deliberately NOT imported: it still lives in admin.html,
 * and this registry does not need it. See the note on `pullList` below. */
import { CN_DOUBLE_BIN_FEET, cnBinsForFeet } from './money.js';

export { CN_DOUBLE_BIN_FEET, cnBinsForFeet };

// ---------------------------------------------------------------------------
// 1. THE EIGHT DESTINATIONS
// ---------------------------------------------------------------------------

/* ⚠ EIGHT, not the five this file shipped with and not the six R-003 names.
 * Addie, 2026-08-21, named Routes and Schedule as destinations in their own
 * right, and they are genuinely separate surfaces:
 *   schedule — the season laid out day by day   (routeSchedule/plan)
 *   routes   — one day's driving order per crew (scheduledRoutes)
 * Adding a name here without teaching an artifact to render it is how an option
 * silently reaches nowhere, so `audit()` rejects any consumer not on this list. */
export const CONSUMERS = [
  'quote',         // the public quote / detail form — what we ask them
  'confirmation',  // the RSVP email — what we tell them we have on file
  'customer',      // the customer record in admin
  'crewSheet',     // the printed crew sheet
  'pullList',      // the warehouse build sheet
  'routes',        // the crew's route for a day
  'schedule',      // the season plan
  'invoice',       // an invoice line
];

// ---------------------------------------------------------------------------
// 2. THE REGISTRY
// ---------------------------------------------------------------------------

/* Each entry:
 *   id            the REAL field name on the customer record, so an option can
 *                 read a record directly. Never invent one.
 *   label         what a human sees, on every artifact, spelled once.
 *   type          measure | choice | count | text | yesno
 *   choices       every value the record may legitimately hold
 *   customerChoices  the subset a customer-facing form may OFFER, when it is
 *                 narrower than `choices`. Absent means "offer them all". This
 *                 is how "we accept it if they ask, we just don't advertise it"
 *                 gets written down instead of living in somebody's head.
 *   default       must be one of `choices` — audit() enforces it
 *   required      an answer is expected; missingAnswers() reports the gaps
 *   internal      true = the office's, not the customer's. R-003's stated
 *                 exception: may skip quote/confirmation/invoice deliberately.
 *   consumers     which artifacts MUST render it
 *   affectsPrice  whether js/money.js consumes it
 *   value         optional reader, where the record does not hold it plainly
 *   crewNote      an extra instruction printed with it on the crew sheet
 */
export const OPTIONS = [
  {
    id: 'measuredFeet',
    label: 'Measured feet',
    type: 'measure',
    unit: 'ft',
    required: true,
    /* THE ONLY THING THAT SETS THE PRICE. Addie, 2026-08-21: "Nothing but feet
       should affect price." It also drives the bin count, the bundle count and
       which customer-number series they get — four things off one number, which
       is why it is worth double-checking on entry. */
    affectsPrice: true,
    consumers: ['quote', 'confirmation', 'customer', 'pullList', 'invoice'],
  },
  {
    id: 'lightsDescription',
    label: 'Light colours',
    type: 'text',
    required: true,
    /* ⚠ COLOURS LIVE IN TWO FIELDS AND BOTH MUST BE READ. A REPEATED colour
       means an alternating pattern, and the importer moves those out of
       `lightColors` into `lightsDescription` — so an alternating house has an
       EMPTY colour list. Reading only the list calls them undecorated. */
    value: (c) => c.lightsDescription || (Array.isArray(c.lightColors) ? c.lightColors.join(', ') : ''),
    palette: ['Warm White', 'Pure White', 'Red', 'Green', 'Blue', 'Purple', 'Orange', 'Pink', 'Multi'],
    affectsPrice: false,
    consumers: ['quote', 'confirmation', 'customer', 'pullList'],
  },
  {
    id: 'wireColor',
    label: 'Wire colour',
    type: 'choice',
    choices: ['Any', 'White', 'Green'],
    default: 'Any',
    required: true,
    affectsPrice: false,
    consumers: ['quote', 'confirmation', 'customer', 'pullList'],
  },
  {
    id: 'outletTimer',
    label: 'Timer',
    type: 'yesno',
    choices: ['Yes', 'No'],
    required: true,
    /* ⚠ NO DEFAULT, DELIBERATELY. A blank is "nobody has asked them", which is
       a different thing from "No" and must stay different — the same reason the
       importer refuses to read "?" as a no. */
    affectsPrice: false,
    consumers: ['quote', 'confirmation', 'customer', 'crewSheet', 'pullList'],
    crewNote: 'Set at install. Confirm the outlet is switched-live, not switch-controlled.',
  },
  {
    id: 'useEaves',
    label: 'Plugs / eaves',
    type: 'yesno',
    choices: ['Yes', 'No'],
    required: false,
    affectsPrice: false,
    /* ⚠ NOT on the confirmation. Addie, 2026-08-21: "lets get rid of eaves if it
       will cause more confusion." Note this needs no R-002 exception — that rule
       governs how an option renders when it IS on an artifact, not which options
       appear at all. */
    consumers: ['quote', 'customer', 'crewSheet'],
  },
  {
    id: 'specificOutlet',
    label: 'Which outlet',
    type: 'yesno',
    choices: ['Yes', 'No'],
    required: false,
    affectsPrice: false,
    value: (c) => (String(c.specificOutlet || '') === 'Yes' ? (c.specificOutletNotes || 'Yes') : c.specificOutlet),
    consumers: ['quote', 'confirmation', 'customer', 'crewSheet'],
    crewNote: 'Use the outlet named here, not the nearest one.',
  },
  {
    id: 'gateCode',
    label: 'Gate code',
    type: 'text',
    required: false,
    affectsPrice: false,
    /* ⚠ `crewSheet` here is NEW and is the point of P-003. Today the gate code
       shows in the crew portal and never prints, so a crew working off paper
       reaches a gated house with no way in. */
    consumers: ['quote', 'confirmation', 'customer', 'crewSheet'],
  },
  {
    id: 'houseSides',
    label: 'Sides of the house',
    type: 'count',
    min: 1,
    max: 4,
    default: 1,
    /* ⚠ NOT `required`. It always has a value — see the default below — so
       listing it would put a row on the office's chase list that can never be
       actioned. Same reasoning as numberOfBins. */
    required: false,
    /* ⚠ NOT a price input. Changing it raises a re-quote because the FOOTAGE
       changes, and the footage is what is charged. The comment at
       functions/index.js:1066 says changing sides "changes the PRICE" — true
       only through feet. Do not read it as a second price input. */
    affectsPrice: false,
    /* ⚠ THE OLD SHAPE STILL COUNTS. Records saved before 2026-08-19 hold an
       array of side names; newer ones hold a count. Both have to read.

       ⭐ ONE SIDE IS THE DEFAULT, AND THE DEFAULT IS LOAD-BEARING. Addie,
       2026-08-21: "if not answered the system can automatically choose 1."

       ⚠ I FIRST WROTE THIS TO RETURN undefined FOR A BLANK, calling the default
       an R-002 violation — "nobody asked" printing as "one side". That was
       wrong, and the reason is written at functions/index.js:1079: this value is
       one half of `updates.houseSides !== before`, which RAISES A RE-QUOTE. A
       default on one side of that comparison and a blank on the other sends a
       re-quote to every customer whose sides were never written down, for a
       change nobody made. An honest-looking undefined here would have been a
       fourth reading of one field, disagreeing with the three that exist.

       ⚠ SO THIS MUST MATCH, EXACTLY: houseSideCount (admin.html:17643),
       portalSideCount (index.html:4695) and asCount (functions/index.js:1083).
       That is now FOUR copies of one normaliser — the same duplication problem
       as the invoice maths. When this registry is wired (plan §3.3), the other
       three should call it rather than keeping their own. */
    value: (c) => {
      const v = c.houseSides;
      if (Array.isArray(v)) return Math.min(4, v.filter(Boolean).length) || 1;
      const n = Number(String(v == null ? '' : v).replace(/[^0-9]/g, ''));
      return n >= 1 && n <= 4 ? n : 1;
    },
    consumers: ['quote', 'confirmation', 'customer', 'crewSheet', 'routes', 'schedule'],
  },
  {
    id: 'installPreference',
    label: 'Install timing',
    type: 'choice',
    /* ⚠ FIVE VALID VALUES, THREE OFFERABLE — AND THAT IS DELIBERATE.
       Addie, 2026-08-21: "I don't want members to have the option for before or
       after thanksgiving we only accept these if they ask for them."

       So the two Thanksgiving timings are ACCEPTED, not ADVERTISED. They reach a
       record when a customer asks for one in conversation and the office types
       it, or from the master sheet (which spells it THX) — never from a form.
       Putting them on the quote form would invite every customer to pick a
       window the season can only honour for a few, which is the opposite of what
       PRE_THANKSGIVING_DAYS exists to protect.

       ⚠ I FIRST RECORDED THIS AS A HOLE — "a customer cannot ask for the two
       timings the scheduler tries hardest to respect." That was wrong, and it is
       the shape of mistake worth naming: two vocabularies for one field looked
       like drift, and was a policy nobody had written down. `customerChoices` is
       now where that policy lives, so the next reader does not re-report it. */
    choices: ['Normal Schedule', 'October', 'November', 'November - Before Thanksgiving', 'After Thanksgiving'],
    customerChoices: ['Normal Schedule', 'October', 'November'],
    default: 'Normal Schedule',
    required: true,
    affectsPrice: false,
    consumers: ['quote', 'confirmation', 'customer', 'schedule'],
  },
  {
    id: 'notes',
    label: 'Notes',
    type: 'text',
    required: false,
    affectsPrice: false,
    consumers: ['quote', 'customer', 'crewSheet', 'routes', 'schedule'],
  },
  {
    id: 'oneTimeNote',
    label: 'One-time note',
    type: 'text',
    required: false,
    internal: true,
    affectsPrice: false,
    consumers: ['customer', 'crewSheet', 'routes', 'schedule'],
  },
  {
    id: 'wantsMailedInvoice',
    label: 'Mailed invoice',
    type: 'yesno',
    choices: ['Yes', 'No'],
    required: false,
    affectsPrice: false,
    consumers: ['quote', 'customer', 'invoice'],
  },
  {
    id: 'numberOfBins',
    label: 'Bins',
    type: 'count',
    /* ⚠ NOT `required`. It is DERIVED from the footage, so it always has a
       value and can never be "missing" — listing it in missingAnswers() would
       put a row on the office's chase list that nobody can ever action. What is
       actually missing in that case is the footage, and that is already
       required in its own right. */
    required: false,
    internal: true,
    affectsPrice: false,
    /* Derived from the footage, never asked and never typed: one bin per
       CN_DOUBLE_BIN_FEET. Imported rather than re-typed — R-014. */
    value: (c) => cnBinsForFeet(c.measuredFeet),
    consumers: ['customer', 'pullList', 'routes', 'schedule'],
  },
  {
    id: 'difficulty',
    label: 'Difficulty',
    type: 'choice',
    choices: ['Unrated', 'Easy', 'Medium', 'Hard'],
    default: 'Unrated',
    required: false,
    internal: true,
    affectsPrice: false,
    consumers: ['customer', 'routes', 'schedule'],
  },
];

// ---------------------------------------------------------------------------
// 3. THE AUDIT — this is the whole point of the file. Blocking, in CI.
// ---------------------------------------------------------------------------

/**
 * Every way an option can silently fall through. Returns a list of strings;
 * empty means clean. Anything here fails the build.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT CHECK: cross-artifact assumptions Addie has
 * not made. An earlier draft failed anything on the pull list that was missing
 * from the crew sheet — which would flag light colours and wire colour, and
 * those are correctly absent: the bundle arrives pre-built and labelled, so the
 * installer does not need the recipe. `consumers` is the answer, per option,
 * and the audit checks it for coherence rather than inventing rules over it.
 */
export function audit() {
  const holes = [];
  const seen = new Set();

  for (const o of OPTIONS) {
    if (seen.has(o.id)) holes.push(`${o.id}: declared twice`);
    seen.add(o.id);

    if (!o.consumers || o.consumers.length === 0)
      holes.push(`${o.id}: DEAD END — nothing renders it`);

    const unknown = (o.consumers || []).filter((c) => !CONSUMERS.includes(c));
    if (unknown.length)
      holes.push(`${o.id}: unknown consumer(s) ${unknown.join(', ')}`);

    /* R-004, tier 1: they cannot dispute a charge they were never shown. */
    if (o.affectsPrice && !o.consumers.includes('confirmation'))
      holes.push(`${o.id}: affects the price but the customer is never shown it (R-004)`);

    if (o.affectsPrice && !o.consumers.includes('invoice'))
      holes.push(`${o.id}: affects the price but never appears on an invoice`);

    /* A customer-facing option they are never asked for is one nobody can
       answer. Internal options are exempt — that is R-003's stated exception,
       and `internal` is how it gets declared rather than assumed. */
    if (!o.internal && !o.consumers.includes('quote'))
      holes.push(`${o.id}: customer-facing but never asked on the quote form`);

    /* Nothing reaches a customer that the office cannot see and correct. */
    if (!o.consumers.includes('customer'))
      holes.push(`${o.id}: never reaches the customer record`);

    /* An internal option on a customer-facing artifact is a leak. */
    if (o.internal && (o.consumers.includes('quote') || o.consumers.includes('confirmation')))
      holes.push(`${o.id}: marked internal but shown to the customer`);

    if (o.default != null && Array.isArray(o.choices) && !o.choices.includes(o.default))
      holes.push(`${o.id}: default "${o.default}" is not one of its own choices`);

    if ((o.type === 'choice' || o.type === 'yesno') && !Array.isArray(o.choices))
      holes.push(`${o.id}: a ${o.type} with no choices`);

    /* An offerable value the record may not hold is a form that writes junk. */
    if (Array.isArray(o.customerChoices)) {
      const strays = o.customerChoices.filter((c) => !(o.choices || []).includes(c));
      if (strays.length)
        holes.push(`${o.id}: offers ${strays.join(', ')}, which is not among its own choices`);
      if (!o.consumers.includes('quote'))
        holes.push(`${o.id}: narrows what the customer may pick but is never on the quote form`);
    }

    if (o.value != null && typeof o.value !== 'function')
      holes.push(`${o.id}: value must be a function`);
  }

  return holes;
}

/** Per customer: every required option must have an answer. A missing answer
 *  and "they didn't want it" are indistinguishable, so this forces the office
 *  to make it explicit rather than leaving it absent. */
export function missingAnswers(customer) {
  return OPTIONS
    .filter((o) => o.required)
    .filter((o) => {
      const v = valueOf(o, customer || {});
      return v === undefined || v === null || v === '';
    })
    .map((o) => o.id);
}

// ---------------------------------------------------------------------------
// 4. RENDERING — every artifact reads the same list, in the same order
// ---------------------------------------------------------------------------

export function valueOf(option, customer) {
  return typeof option.value === 'function' ? option.value(customer || {}) : (customer || {})[option.id];
}

/**
 * R-002, tier 1: NEVER a blank. An option with no answer prints `none`.
 *
 * Silence and "they didn't want it" look identical, and only one of them is a
 * problem. A crew member can check twelve printed answers at a glance; they
 * cannot check an absence. This is a small change with a disproportionate
 * payoff — do not drop it as cosmetic.
 */
export function display(option, value) {
  if (value === undefined || value === null || value === '' || value === 0) return 'none';
  if (option.type === 'measure') return `${value} ${option.unit}`;
  return String(value);
}

/** What a customer-facing form may OFFER for this option — never the full set
 *  unless the option says so. The quote form must call this rather than reading
 *  `choices`, or it will advertise timings we only accept on request. */
export function offerableChoices(option) {
  return Array.isArray(option.customerChoices) ? option.customerChoices : (option.choices || []);
}

export function forConsumer(consumer, customer) {
  return OPTIONS
    .filter((o) => o.consumers.includes(consumer))
    .map((o) => {
      const value = valueOf(o, customer);
      return { ...o, value, text: display(o, value) };
    });
}

export function confirmationText(customer, opts) {
  const priceLine = opts && opts.priceLine ? opts.priceLine : null;
  const lines = forConsumer('confirmation', customer).map((o) => `${o.label}: ${o.text}`);
  return [
    `Hi ${(customer && customer.name ? String(customer.name).split(' ')[0] : 'there')} — here's what we have on file for you:`,
    '',
    ...(priceLine ? [priceLine, ''] : []),
    ...lines,
    '',
    'If anything here is wrong or missing, update it in your member portal.',
  ].join('\n');
}

export function crewSheet(customer) {
  return forConsumer('crewSheet', customer)
    .map((o) => {
      const line = `${o.label}: ${o.text}`;
      const noteworthy = o.crewNote && o.value && o.text !== 'none' && String(o.value) !== 'No';
      return noteworthy ? `${line}\n    ↳ ${o.crewNote}` : line;
    })
    .join('\n');
}

/**
 * ⚠ THIS IS THE BUILD SHEET, NOT A STOCK LIST. The plan imagined
 * `warehouse(value)` returning quantities ("3 × C9 bundle, 1 × timer unit").
 * That is not how this warehouse works: the sheet is a ROW PER CUSTOMER holding
 * their spec — number, name, light colour, wire colour, timer, feet — which the
 * warehouse builds from. So options render their values here like everywhere
 * else, and `warehouse()` was dropped rather than kept as a concept nothing uses.
 */
export function pullList(customer) {
  return forConsumer('pullList', customer).map((o) => ({ label: o.label, text: o.text }));
}
