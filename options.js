/**
 * js/options.js — THE OPTION REGISTRY
 * ---------------------------------------------------------------------------
 * Single source of truth for everything a customer can ask for.
 *
 * Five things render from this file and nothing else:
 *   1. the quote form          (what we ask them)
 *   2. the confirmation text   (what we tell them we're doing)
 *   3. the crew sheet          (what the installer sees)
 *   4. the warehouse pull list (what gets loaded on the truck)
 *   5. the invoice lines       (what they pay for)
 *
 * WHY: if the crew sheet renders fields by hand, adding a new option means
 * remembering to add a render line in five places. Forgetting produces NO
 * ERROR — the truck just shows up without the timer. Generating all five from
 * this list makes forgetting impossible instead of something you test for.
 *
 * RULE: an option added to the app but not to this file is a bug, not a detail.
 *
 * TODO(addie): the entries below use my best guess at your vocabulary.
 * Replace them with your real option set — that's the only part I can't write.
 */

// ---------------------------------------------------------------------------
// 1. THE REGISTRY
// ---------------------------------------------------------------------------

export const OPTIONS = [
  {
    id: 'rooflineFt',
    label: 'Roofline',
    type: 'measure',
    unit: 'ft',
    required: true,
    // Which artifacts MUST show this. Empty array = dead end, caught by audit().
    consumers: ['quote', 'confirmation', 'crewSheet', 'pullList', 'invoice'],
    // What physically has to be on the truck. Used to build the pull list.
    warehouse: (v) => [{ item: 'C9 bundle', qty: Math.ceil(v / 25) }],
    affectsPrice: true,
  },
  {
    id: 'bulbColor',
    label: 'Color',
    type: 'choice',
    choices: ['warm white', 'cool white', 'multicolor', 'red/warm white'],
    required: true,
    consumers: ['quote', 'confirmation', 'crewSheet', 'pullList'],
    warehouse: (v) => [{ item: `bulbs — ${v}`, qty: 'per footage' }],
    affectsPrice: false,
  },
  {
    id: 'timer',
    label: 'Timer',
    type: 'choice',
    choices: ['none', 'dusk to 11pm', 'dusk to midnight', 'custom'],
    default: 'none',
    required: true,
    // The one that keeps you up at night. Note it renders on the confirmation
    // text, so the customer catches it before the truck rolls.
    consumers: ['quote', 'confirmation', 'crewSheet', 'pullList', 'invoice'],
    warehouse: (v) => (v === 'none' ? [] : [{ item: 'timer unit', qty: 1 }]),
    affectsPrice: true,
    crewNote: 'Set at install. Confirm outlet is switched-live, not switch-controlled.',
  },
  {
    id: 'walkway',
    label: 'Walkway',
    type: 'measure',
    unit: 'ft',
    default: 0,
    required: true,
    consumers: ['quote', 'confirmation', 'crewSheet', 'pullList', 'invoice'],
    warehouse: (v) => (v ? [{ item: 'walkway stakes', qty: Math.ceil(v / 3) }] : []),
    affectsPrice: true,
  },
  {
    id: 'wreaths',
    label: 'Wreaths',
    type: 'count',
    default: 0,
    required: true,
    consumers: ['quote', 'confirmation', 'crewSheet', 'pullList', 'invoice'],
    warehouse: (v) => (v ? [{ item: 'wreath', qty: v }] : []),
    affectsPrice: true,
  },
  {
    id: 'bins',
    label: 'Bins',
    type: 'count',
    required: true,
    consumers: ['crewSheet', 'pullList'],   // internal only — not shown to customer
    warehouse: (v) => [{ item: 'storage bin', qty: v }],
    affectsPrice: false,
  },
  {
    id: 'accessNotes',
    label: 'Access notes',
    type: 'text',
    default: '',
    required: false,
    consumers: ['crewSheet'],
    affectsPrice: false,
  },
];

// ---------------------------------------------------------------------------
// 2. THE AUDIT — run this in CI. It is the whole point of the file.
// ---------------------------------------------------------------------------

export const CONSUMERS = ['quote', 'confirmation', 'crewSheet', 'pullList', 'invoice'];

/**
 * Catches the three ways an option silently falls through:
 *   - declared but consumed by nothing (a dead end)
 *   - priced but never shown to the customer (they pay for an invisible line)
 *   - needs warehouse stock but never reaches the pull list (truck arrives empty)
 */
export function audit() {
  const holes = [];

  for (const o of OPTIONS) {
    if (!o.consumers || o.consumers.length === 0)
      holes.push(`${o.id}: DEAD END — nothing renders it`);

    const unknown = (o.consumers || []).filter((c) => !CONSUMERS.includes(c));
    if (unknown.length)
      holes.push(`${o.id}: unknown consumer(s) ${unknown.join(', ')}`);

    if (o.affectsPrice && !o.consumers.includes('invoice'))
      holes.push(`${o.id}: affects price but never appears on an invoice`);

    if (o.affectsPrice && !o.consumers.includes('confirmation'))
      holes.push(`${o.id}: customer pays for it but is never shown it`);

    if (o.warehouse && !o.consumers.includes('pullList'))
      holes.push(`${o.id}: needs stock but never reaches the pull list`);

    if (o.warehouse && !o.consumers.includes('crewSheet'))
      holes.push(`${o.id}: on the truck but not on the crew sheet`);

    if (o.type === 'choice' && o.default && !o.choices.includes(o.default))
      holes.push(`${o.id}: default "${o.default}" is not one of its choices`);
  }

  return holes;
}

/**
 * Per-customer version: every required option must have an answer.
 * A missing answer is indistinguishable from "they didn't want it" —
 * so we force it to be explicit rather than absent.
 */
export function missingAnswers(customer) {
  return OPTIONS
    .filter((o) => o.required)
    .filter((o) => customer[o.id] === undefined || customer[o.id] === null)
    .map((o) => o.id);
}

// ---------------------------------------------------------------------------
// 3. RENDERERS — all five read the same list, in the same order
// ---------------------------------------------------------------------------

function display(o, value) {
  if (value === undefined || value === null || value === '' || value === 0)
    return 'none';                                  // NEVER blank. See below.
  if (o.type === 'measure') return `${value} ${o.unit}`;
  if (o.type === 'count') return String(value);
  return String(value);
}

function forConsumer(consumer, customer) {
  return OPTIONS
    .filter((o) => o.consumers.includes(consumer))
    .map((o) => ({ ...o, value: customer[o.id], text: display(o, customer[o.id]) }));
}

/**
 * Blank vs. "none" is the difference between a sheet a crew member can verify
 * and one they can't. If every option always prints, twelve answers can be
 * checked at a glance. Silence and "they didn't want it" must never look alike.
 */
export function crewSheet(customer) {
  const rows = forConsumer('crewSheet', customer).map((o) => {
    const line = `${o.label.padEnd(14)} ${o.text}`;
    return o.crewNote && o.value && o.value !== 'none'
      ? `${line}\n${' '.repeat(15)}↳ ${o.crewNote}`
      : line;
  });
  return rows.join('\n');
}

export function pullList(customer) {
  return forConsumer('pullList', customer)
    .filter((o) => typeof o.warehouse === 'function')
    .flatMap((o) => o.warehouse(o.value) || []);
}

export function confirmationText(customer) {
  const lines = forConsumer('confirmation', customer)
    .map((o) => `${o.label}: ${o.text}`);
  return [
    `Hi ${customer.firstName} — here's what we have scheduled for you:`,
    '',
    ...lines,
    '',
    'Reply YES to confirm, or call us if anything looks wrong.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. STALENESS — the artifact remembers what it was built from
// ---------------------------------------------------------------------------

export function stamp(customer) {
  // Store this on every generated sheet / pull list / invoice.
  return { customerId: customer.id, sourceVersion: customer.updatedAt };
}

export function isStale(artifact, customer) {
  return artifact.sourceVersion !== customer.updatedAt;
}
