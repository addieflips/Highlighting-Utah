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
 * ⭐ WIRED 2026-08-24 (implementation plan §3.3). Five artifacts now render their
 * option fields from this list and nothing else:
 *   quote        index.html   quoteDetailForm      — built by qdRenderOptionFields
 *   confirmation admin.html   the RSVP email       — options_block / optionsEmailBlock
 *   crewSheet    admin.html   PRINT_COLUMNS.crew   — optionSheetColumns('crewSheet')
 *   pullList     admin.html   PRINT_COLUMNS.build  — optionSheetColumns('pullList')
 *                             WH_BUILD_COLUMNS       (the warehouse tab's own copy)
 *   invoice      admin.html   buildInvoiceDocHtml  — optionInvoiceLines
 * Adding an option below makes it appear in all five with no other code change.
 *
 * ⚠ THE THREE REMAINING CONSUMERS ARE STILL HAND-WRITTEN: `customer`, `routes`
 * and `schedule`. They are outside plan §3.3, which names five. A change here
 * does not yet reach those three.
 *
 * ⚠ AND THE SERVER DOES NOT READ THIS FILE. `quoteSaveDetails` in
 * functions/index.js keeps its own whitelist of what a quote form may write,
 * because Cloud Functions deploy only the functions/ directory and cannot
 * import from js/. A new option therefore renders on the form and is DROPPED on
 * save until that whitelist learns about it. That is the same one-rule-two-
 * runtimes problem as the invoice maths, and it is solved the same way: a
 * parity check in options-audit.test.js FAILS the build when the two disagree,
 * so forgetting is loud instead of silent.
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

/* The artifacts that are printed TABLES rather than lists of lines. Only these
 * read `foldInto` / `sheetOrder`: on paper a column costs width, so an option
 * can be told to share a cell. Everywhere else every option gets its own line
 * and the placement declarations are simply not consulted. */
export const TABLE_CONSUMERS = ['crewSheet', 'pullList'];

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
 *
 * ---- PLACEMENT, for the artifacts that are printed TABLES ------------------
 * A crew sheet and a build sheet are fixed-width paper, not a list of lines, so
 * "which column, and where" is a real decision that has to be written down
 * somewhere. P-003 predicted exactly this cost and called it the point. It is
 * declared here rather than in the renderers, or the renderers go back to being
 * hand-written lists of fields — which is what this file exists to stop.
 *
 *   sheetLabel    short column header. Paper is narrow; `label` is the long
 *                 form used on the confirmation and the quote form. Defaults to
 *                 `label`, so a new option needs nothing.
 *   sheetOrder    lower prints further left. Defaults to 60, which puts a NEW
 *                 option after the narrow answer columns and before Notes —
 *                 visible, and not buried at the end of a wall of prose.
 *   foldInto      this option has no column of its own: its text is appended to
 *                 the named option's cell, prefixed with `foldPrefix`. Addie,
 *                 2026-08-21: the outlet instruction and the one-time note ARE
 *                 prose, so they fold into Notes rather than widening the sheet
 *                 to eleven columns nobody can read.
 *   foldValue     what to fold, where the option's own `value` is not it. The
 *                 which-outlet fold wants the INSTRUCTION, not the word "Yes".
 *   foldPrefix    an unlabelled sentence in the Notes column reads as part of
 *                 the standing note, so every fold is named.
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
    /* ⚠ IT REACHES THE PULL LIST AS BUNDLES, NOT AS FEET, and that is not a
       fudge — it is what Addie asked for. 2026-08-21: "I don't think we need
       feet and bundles. I think how many bundles is fine for warehouse." Feet is
       the office's number, it prices the job and sizes the bins; bundles is the
       one somebody counts off a shelf, and it is derived from the feet anyway,
       so printing both put a sum on the sheet nobody was being asked to check.
       The build sheets therefore render this option through a PRESENTER
       (whBundleText) rather than through display(). The declaration stands —
       measuredFeet does reach the pull list — so the frozen AGREED map does not
       move. Dropping `pullList` here instead would have said the warehouse is
       told nothing about the size of the job, which is untrue. */
    sheetLabel: 'Bundles',
    sheetOrder: 40,
    /* ⚠ IT IS ON THE QUOTE, AND IT IS NEVER ASKED. A customer cannot measure
       their own roofline — the office measures it and types it in when pricing
       the quote — so this option reaches the quote RECORD without ever being a
       question on a form. `officeEntered` is how that gets declared instead of
       the form renderer carrying a hard-coded exception for one id.
       ⚠ It does NOT mean "hidden". It is on the confirmation, which is where the
       customer sees the footage we measured and can dispute it, and on the
       invoice, where it is the priced line. */
    officeEntered: true,
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
    /* The quote form's colour picker is a bespoke control — swatches, and a
       pattern builder for an alternating run — not a text box. It is still
       GENERATED: the swatches are built from `palette` above, so a colour added
       here appears on the form. `quoteControl` is how an option says which
       control renders it; anything without one gets the default for its type. */
    quoteControl: 'colors',
    sheetLabel: 'Light color',
    sheetOrder: 20,
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
    sheetLabel: 'Wire',
    sheetOrder: 30,
    affectsPrice: false,
    consumers: ['quote', 'confirmation', 'customer', 'pullList'],
  },
  {
    id: 'outletTimer',
    label: 'Timer',
    type: 'yesno',
    choices: ['Yes', 'No'],
    required: true,
    /* ⭐ A BLANK TIMER MEANS NO (Addie, 2026-08-24, answering Q-012: "If it's
       timer than no"). So it carries a declared default, and every artifact reads
       "No" for a customer nobody asked.

       ⚠ THIS REVERSES THE 2026-08-21 DECISION, and the argument against is worth
       keeping because it was a good one: a blank was held to mean "nobody has
       asked them", on the grounds that a defaulted No answers a question on the
       customer's behalf and a customer who wanted a timer would not get one. She
       was shown that trade-off in full and chose No anyway. Newer instruction
       wins; do not quietly restore the old behaviour.

       ⚠ THE RECORD IS NOT WRITTEN. A default is applied by valueOf() at RENDER
       time — nothing stores "No" against anybody — so the "Never answered"
       audience in Automation Emails (`!m.data.outletTimer`) still finds exactly
       the people nobody has asked, and she can still go and ask them. Defaulting
       in the DATA would delete that list, which is a different and worse thing
       than defaulting on the paper.

       ⚠ AND IT AGREES WITH WHAT THE CODE ALREADY DID OPERATIONALLY. The portal's
       change detection reads `(outletTimer || 'No')` and the warehouse comment at
       admin.html:31487 says the same. Before this the PAPER said one thing and the
       BEHAVIOUR another; now they match, which is the half of R-002 that matters. */
    default: 'No',
    affectsPrice: false,
    /* ⚠ TIMER SITS BEFORE NOTES ON EVERY CREW SHEET. Addie, 2026-08-20: "it need
       to include timer(yes/no), that should come before notes." Notes is the wide
       free-text column and anything after it is lost against a wall of writing,
       which is why the position is part of the instruction and not a detail. */
    sheetLabel: 'Timer',
    sheetOrder: 50,
    /* ⭐ OFF THE CREW SHEET, 2026-08-24. Addie: "timer doesn't need to reach the
       crew sheet this is warehouses job." The timer goes IN THE BIN — the
       warehouse puts it in with the bundle — so the crew hangs what they are
       given and there is nothing for them to do with this answer.
       ⚠ THIS REVERSES HER 2026-08-20 INSTRUCTION, which put it there: "it need to
       include timer(yes/no), that should come before notes." Newer wins, and the
       reason is a fact about who does the work rather than a change of taste.
       ⚠ THE crewNote GOES WITH IT. "Set at install" described a job the crew does
       not do; leaving it would be an instruction to nobody. */
    consumers: ['quote', 'confirmation', 'customer', 'pullList'],
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
    /* ⭐ FOLDS INTO NOTES, AND ONLY WHEN THEY SAID YES (2026-08-24). Addie: "If
       they use eaves which will only show if they say yes." It is an INSTRUCTION
       — use the plugs in the eaves — and there is no instruction unless the
       answer is yes, which is exactly how the which-outlet note already behaves.
       ⚠ THAT IS WHY IT FOLDS RATHER THAN KEEPING A COLUMN THAT GOES BLANK. A
       blank cell would mean "they said no" and "nobody asked" at once, which is
       the R-002 failure; a fold that is simply absent when there is nothing to do
       says nothing false. The answer itself is still on the customer record and
       still on the quote form, where the distinction is kept properly. */
    foldInto: 'notes',
    foldPrefix: 'EAVES',
    foldValue: (c) => {
      const v = c.useEaves;
      const t = v === true ? 'yes' : String(v == null ? '' : v).trim().toLowerCase();
      return (t === 'yes' || t === 'y' || t === 'true') ? 'Yes' : '';
    },
    sheetLabel: 'Plugs / eaves',
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
    /* Prose, so it folds into Notes rather than taking a column — and it folds
       the INSTRUCTION, never the bare word "Yes", which tells the crew nothing.
       A customer who said No has nothing to fold: the default behaviour is to
       use the nearest outlet, which is what happens with no instruction at all. */
    foldInto: 'notes',
    foldPrefix: 'OUTLET',
    /* ⚠ THE INSTRUCTION ITSELF DECIDES, NOT THE YES/NO. This first read "only when
       specificOutlet === 'Yes'", which is true of every record the form writes — and
       silently dropped the instruction on a record where the notes are filled in and
       the flag is not, which an import or a hand-edit can easily produce. Losing a
       real instruction is a crew at the wrong outlet; printing one from a record
       whose flag was never set costs nothing. Empty notes fold nothing either way,
       so a plain "No" still adds no noise to the sheet. */
    foldValue: (c) => String(c.specificOutletNotes || '').trim(),
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
    /* ⚠ TEXT, BUT NOT PROSE — so it gets a narrow column of its own and does NOT
       fold into Notes. Addie, 2026-08-21: "A gate code is four characters and
       decides whether the van gets in, so it has to be scannable, not buried in
       prose." Second from the left for the same reason. */
    sheetLabel: 'Gate',
    sheetOrder: 20,
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
    sheetLabel: 'Sides',
    sheetOrder: 30,
    /* ⚠ ASKED ON THE FIRST FORM, NOT THE SECOND. "The quote form" is really two:
       the public request (name, address, and which sides they want lit) and the
       detail form they fill in after approving (colours, wire, timer, gate).
       Without saying which, a generated form would ask for the sides twice. */
    quoteStage: 'request',
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
    /* LAST, ALWAYS. This is the wide free-text column and anything printed after
       it is lost against a wall of writing — the reason Timer was moved in front
       of it, and the reason a new option defaults to 60 rather than to the end. */
    sheetOrder: 90,
    consumers: ['quote', 'customer', 'crewSheet', 'routes', 'schedule'],
  },
  {
    id: 'oneTimeNote',
    label: 'One-time note',
    type: 'text',
    required: false,
    internal: true,
    affectsPrice: false,
    /* ⚠ THE ACTIONABLE LINES COME FIRST INSIDE THE FOLD. This and the outlet
       instruction are the two things that change what the crew DOES at the
       house, so they lead and the standing note follows. Buried under a
       paragraph about the dog they may as well not be printed. */
    foldInto: 'notes',
    foldPrefix: 'TODAY',
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
    /* ⚠ NO FEET MEANS NO ANSWER, NOT ONE BIN. cnBinsForFeet(0) returns 1 —
       correct as bin arithmetic, wrong as a statement about a house nobody has
       measured, and the warehouse's own whBinsForHouse has always gone blank in
       that case for exactly this reason. Left as 1 it prints a confident count
       on a crew sheet for a house whose footage is the thing actually missing,
       and R-002 exists to stop precisely that. Undefined here renders `none`. */
    value: (c) => (Number(c.measuredFeet) > 0 ? cnBinsForFeet(c.measuredFeet) : undefined),
    /* ⚠ NOT ON THE CREW SHEET, and this took two goes to get right. Addie,
       2026-08-22: "crew print sheet should also show bin #" — read as a QUANTITY
       and added here on 2026-08-24. She corrected it the same day: "The cosumer #
       and bin # are the same thing." On the CREW sheet "bin #" means the number
       PAINTED ON THE BIN, which is the customer number, and the sheet already had
       that column. Two number columns would have been two answers to one
       question, which is the mistake the warehouse sheet made in the other
       direction in 2026-08-21.
       ⚠ SO THE CREW'S NUMBER COLUMN IS whBinNumberFor, not customerNumber: a
       customer whose footage moved them into the 5000 series still has a bin on
       the shelf wearing the old number, and that is the number they must look for.
       Here, the count is still the WAREHOUSE's — how many they are making. */
    sheetLabel: 'Bins',
    sheetOrder: 10,
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

    /* ---- the placement declarations the printed tables read ---------------
     * These exist because a fold that lands nowhere renders as SILENCE, which
     * is the one failure this whole file is built to make impossible. */
    if (o.foldInto != null) {
      const target = OPTIONS.find((t) => t.id === o.foldInto);
      if (!target) {
        holes.push(`${o.id}: folds into "${o.foldInto}", which is not an option`);
      } else {
        /* On an artifact that renders the fold but not its target, the text is
           dropped and nothing says so — the gate-code failure with extra steps.
           ⚠ ONLY THE PRINTED TABLES FOLD. A line-oriented artifact gives every
           option its own line and ignores foldInto entirely, so the confirmation
           listing "Which outlet" without listing "Notes" loses nothing. Checking
           every consumer instead of the table ones reports that as a hole, which
           is a false alarm on the one artifact the customer actually reads. */
        const orphaned = o.consumers
          .filter((c) => TABLE_CONSUMERS.includes(c))
          .filter((c) => !target.consumers.includes(c));
        if (orphaned.length)
          holes.push(`${o.id}: folds into ${o.foldInto}, which does not reach ${orphaned.join(', ')} — the text would vanish there`);
      }
      if (!o.foldPrefix)
        holes.push(`${o.id}: folds into another cell with no prefix — it would read as part of that note`);
      if (o.foldValue != null && typeof o.foldValue !== 'function')
        holes.push(`${o.id}: foldValue must be a function`);
    }

    if (o.sheetOrder != null && typeof o.sheetOrder !== 'number')
      holes.push(`${o.id}: sheetOrder must be a number`);

    if (o.quoteStage != null && o.quoteStage !== 'request' && o.quoteStage !== 'details')
      holes.push(`${o.id}: quoteStage "${o.quoteStage}" is neither request nor details`);

    /* A stage on an option no form renders is a declaration nobody reads. */
    if (o.quoteStage != null && !o.consumers.includes('quote'))
      holes.push(`${o.id}: declares a quote stage but is never on the quote form`);

    /* officeEntered takes an option off both quote forms. On an option that is
       not on the quote at all it says nothing, and reads as though it did. */
    if (o.officeEntered && !o.consumers.includes('quote'))
      holes.push(`${o.id}: marked officeEntered but is not on the quote anyway`);
  }

  return holes;
}

/** Per customer: every required option must have an answer. A missing answer
 *  and "they didn't want it" are indistinguishable, so this forces the office
 *  to make it explicit rather than leaving it absent. */
/**
 * The answers a customer-facing form must REFUSE to submit without.
 *
 * ⭐ Addie, 2026-08-24, answering Q-012 about what a blank means, field by field:
 * "If it's timer than no if its color wire than we choose. If it's light colors
 * that needs to be required and they can't move on without that."
 *
 * Those three answers ARE this rule, and it needs no list of its own: an option
 * that is required and declares a DEFAULT has an answer whatever they do (the
 * timer defaults to No, the wire colour to Any — "we choose"), so nothing is
 * missing and nothing should block. An option that is required and declares NO
 * default has no answer until they give one. Today that is exactly
 * `lightsDescription`, which is what she asked for.
 *
 * ⚠ WHICH MEANS THE RULE IS NOT WRITTEN DOWN TWICE. Adding a hard-coded list of
 * blocking ids beside the registry is how the two start disagreeing, and the one
 * nobody looks at is the one that decides whether a customer can submit.
 * ⚠ `officeEntered` options are excluded: the footage is required and has no
 * default, and a form that refuses to submit until the CUSTOMER measures their
 * own roofline can never be submitted at all.
 */
export function blockingAnswers(customer) {
  return missingAnswers(customer).filter((id) => {
    const o = OPTIONS.find((x) => x.id === id);
    return o && !o.officeEntered && o.consumers.includes('quote') && o.default == null;
  });
}

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

/**
 * ⚠ A DECLARED DEFAULT IS APPLIED HERE, and nowhere else. "A declared default
 * that does not render is a default in name only" — so an option carrying one
 * always has a value, and `none` is reserved for the options that genuinely
 * have no answer. That is the line R-002 actually draws: silence must never look
 * like a choice, but a stated default IS the choice, made once and written down.
 *
 * ⚠ WHICH IS WHY `outletTimer` HAS NO DEFAULT. A blank there means nobody has
 * asked them, and defaulting it to No would answer a question on the customer's
 * behalf — the exact failure the crew sheet was fixed for on 2026-08-21.
 */
export function valueOf(option, customer) {
  const raw = typeof option.value === 'function'
    ? option.value(customer || {})
    : (customer || {})[option.id];
  if (raw === undefined || raw === null || raw === '') {
    return option.default != null ? option.default : raw;
  }
  return raw;
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
  /* ⚠ WHITESPACE IS SILENCE TOO. A gate code typed as two spaces is not an answer,
     and it used to slip past the `=== ''` test and print a cell that LOOKS blank —
     which is the exact thing R-002 exists to stop, arriving through the one route
     the rule's own wording did not cover. Found by a check that fed it "  ". */
  if (typeof value === 'string' && value.trim() === '') return 'none';
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

// ---------------------------------------------------------------------------
// 4b. WHAT WE TOLD THEM, AND WHETHER IT IS STILL TRUE
// ---------------------------------------------------------------------------

/* ⭐ THE RECORD OF A CONFIRMATION (plan §4.2, 2026-08-24).
 *
 * The confirmation is the RSVP email (Q-005), and it now carries every
 * `confirmation` option — so a customer is shown, in writing, what we are about
 * to install. Plan §4.1 calls that the only mechanism in the whole system that
 * checks our data against WHAT THEY ACTUALLY WANTED, because a request taken on
 * the phone and never typed in leaves no record for any detector to find.
 *
 * ⚠ BUT SHOWING THEM IS ONLY HALF OF IT. Until this existed the send recorded
 * NOTHING: nobody could say who had been told, what they had been told, or
 * whether it was still true. So an answer edited in the office after the RSVP
 * went out left the customer having confirmed one thing and the crew installing
 * another, with nothing anywhere to notice.
 *
 * ⚠ THE TWO FIELDS THIS DECLARES (CLAUDE.md §1 — a writer, a reader, and a
 * declaration; there is no docs/data-map.md until plan §7.2 derives one, and
 * hand-writing it early is exactly what that section forbids):
 *   confirmationSentAt  — written by the Automation Emails RSVP send;
 *                         read by the customer row chip and the All Customers
 *                         "Confirmation" filter.
 *   confirmationShown   — the answers as they were RENDERED to that customer,
 *                         id -> text. Same writer, same readers, plus
 *                         confirmationDrift() below.
 *
 * ⚠ IT STORES THE RENDERED TEXT, NOT THE RAW VALUES, and that is the point: the
 * claim being kept is "this is the sentence we put in front of them", so it has
 * to survive a change in how a value is rendered as well as a change in the
 * value. `none` is a real answer here and is stored like any other. */
export function confirmationFingerprint(customer) {
  const out = {};
  forConsumer('confirmation', customer).forEach((o) => { out[o.id] = o.text; });
  return out;
}

/**
 * What has changed since they confirmed. Empty means the email they answered
 * still describes the house we are about to light.
 *
 * ⚠ AN OPTION ADDED SINCE COUNTS AS DRIFT, with `was` null — we are holding an
 * answer they were never shown, which is the same failure pointing the other
 * way and is exactly what happens the week after a new option is added.
 * ⚠ AN OPTION REMOVED FROM THE CONFIRMATION SINCE DOES NOT. That is us choosing
 * to stop telling them something; nothing about their house changed, and
 * reporting it would put a permanent finding on every record the day an option
 * is retired — R-013's "47 issues forever" failure.
 */
export function confirmationDrift(shown, customer) {
  if (!shown || typeof shown !== 'object') return [];
  const now = confirmationFingerprint(customer);
  const rows = [];
  Object.keys(now).forEach((id) => {
    const o = OPTIONS.find((x) => x.id === id);
    const had = Object.prototype.hasOwnProperty.call(shown, id);
    if (!had) { rows.push({ id: id, label: o ? o.label : id, was: null, now: now[id] }); return; }
    if (String(shown[id]) !== String(now[id])) {
      rows.push({ id: id, label: o ? o.label : id, was: String(shown[id]), now: now[id] });
    }
  });
  return rows;
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

// ---------------------------------------------------------------------------
// 5. PRINTED TABLES — the crew sheet and the two build sheets
// ---------------------------------------------------------------------------

/* Where a NEW option lands with nothing declared: after the narrow answer
 * columns, before Notes. Visible rather than buried at the far right, which is
 * where an appended column would go and where nobody reads it. */
export const SHEET_ORDER_DEFAULT = 60;

function sheetOrderOf(o) {
  return typeof o.sheetOrder === 'number' ? o.sheetOrder : SHEET_ORDER_DEFAULT;
}

/** The options that get a COLUMN on this artifact: everything that declares the
 *  consumer, minus anything folded into another option's cell. Ordered by
 *  `sheetOrder`, ties broken by registry order so the same registry always
 *  produces the same sheet. */
export function sheetOptions(consumer) {
  return OPTIONS
    .map((o, i) => ({ o, i }))
    .filter((x) => x.o.consumers.includes(consumer) && !x.o.foldInto)
    .sort((a, b) => (sheetOrderOf(a.o) - sheetOrderOf(b.o)) || (a.i - b.i))
    .map((x) => x.o);
}

/** Column definitions in the shape the printers already use: `k` is the row key
 *  (the real field name), `label` is the header. */
export function sheetColumns(consumer) {
  return sheetOptions(consumer).map((o) => ({ k: o.id, label: o.sheetLabel || o.label }));
}

function foldTextOf(option, customer) {
  const raw = typeof option.foldValue === 'function'
    ? option.foldValue(customer || {})
    : valueOf(option, customer);
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return '';
  return option.foldPrefix ? (option.foldPrefix + ': ' + t) : t;
}

/**
 * One printed row's option cells, keyed by option id so they line up with
 * `sheetColumns(consumer)`.
 *
 * `presenters` lets an artifact say how ONE option prints where `display()` is
 * not the right answer — the build sheets render `measuredFeet` as a bundle
 * count, because that is the number somebody counts off a shelf. It is a
 * presentation override, never a field list: an option with no presenter still
 * gets its column, so a NEW option appears on the sheet with nothing declared.
 *
 * ⚠ FOLDS COME FIRST INSIDE THE CELL, then the target's own value. The two
 * folded onto the crew sheet are the things that change what the crew DOES at
 * the house, and under a paragraph about the dog they may as well not be there.
 */
export function sheetRow(consumer, customer, presenters) {
  const p = presenters || {};
  const cols = sheetOptions(consumer);
  const folds = {};

  for (const o of OPTIONS) {
    if (!o.foldInto || !o.consumers.includes(consumer)) continue;
    /* Nothing to fold into on THIS artifact — the target option is not one of
       its consumers. Dropped rather than promoted to a column of its own: a
       column nobody declared is how a sheet silently grows a twelfth heading. */
    if (!cols.some((c) => c.id === o.foldInto)) continue;
    const t = foldTextOf(o, customer);
    if (t) (folds[o.foldInto] = folds[o.foldInto] || []).push(t);
  }

  const row = {};
  for (const o of cols) {
    if (typeof p[o.id] === 'function') { row[o.id] = p[o.id](customer, o); continue; }
    const own = valueOf(o, customer);
    const mine = folds[o.id] || [];
    const ownText = String(own == null ? '' : own).trim();
    /* R-002 still holds: a cell with nothing at all in it says `none`. It is
       only skipped when the cell is demonstrably not empty, where the blank-vs-
       "they didn't want it" ambiguity the rule guards against cannot arise. */
    if (mine.length) row[o.id] = (ownText ? mine.concat([display(o, own)]) : mine).join('  ·  ');
    else row[o.id] = display(o, own);
  }
  return row;
}

// ---------------------------------------------------------------------------
// 6. THE QUOTE FORM
// ---------------------------------------------------------------------------

/**
 * "The quote form" is two forms: the public request, which asks for the house
 * before we have priced anything, and the detail form the customer fills in
 * after approving. An option says which with `quoteStage`; the detail form is
 * the default, so a new option lands where the questions about the install are.
 *
 * ⚠ `officeEntered` options are excluded from BOTH. The footage is measured by
 * the office, and a form asking a customer for it collects a guess.
 */
export function quoteFields(stage) {
  const want = stage || 'details';
  return OPTIONS.filter((o) =>
    o.consumers.includes('quote') &&
    !o.officeEntered &&
    (o.quoteStage || 'details') === want);
}

// ---------------------------------------------------------------------------
// 7. THE INVOICE
// ---------------------------------------------------------------------------

/**
 * Split, because the two halves are answered by different code. Anything that
 * `affectsPrice` becomes a priced line and is costed by js/money.js — plan
 * §3.3: "Do not add new pricing arithmetic here." Everything else on the
 * invoice is a standing instruction about the bill itself, which prints as a
 * note beside the address rather than as a line with an amount against it.
 */
export function invoiceOptions() {
  const rows = OPTIONS.filter((o) => o.consumers.includes('invoice'));
  return { priced: rows.filter((o) => o.affectsPrice), notes: rows.filter((o) => !o.affectsPrice) };
}
