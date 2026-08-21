/*
 * Option registry audit — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * R-001 says every customer-facing option lives in js/options.js and nowhere
 * else, and R-003 says each one must reach every destination it declares. Both
 * are worth nothing unless something refuses to build when they are broken.
 *
 * It is a separate file rather than a section of run-all.js on purpose: R-018
 * says not to add checks there, and this follows the pattern the other gates
 * already use (verify-syntax, selector-contract, money-parity) — one file, one
 * job, wired into `npm test` so both CI jobs pick it up for free.
 *
 * ⚠ THE REGISTRY IS NOT WIRED YET. Nothing imports js/options.js as of
 * 2026-08-21; §3.3 of the plan has not been done. So this gate proves the SPEC
 * is coherent, not that any screen obeys it. When the artifacts are generated
 * from the registry, the checks that prove THAT belong here too.
 *
 * Run:  node options-audit.test.js      (or: npm run test:options)
 */

const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

(async () => {
  console.log('\n=== Option registry audit ===\n');

  /* js/options.js is a browser ES module — the same file admin.html will import,
     not a copy. If it stops parsing or an export is renamed, that must FAIL
     loudly here rather than skip and report green. */
  let mod;
  try {
    mod = await import(pathToFileURL(path.join(__dirname, 'js', 'options.js')).href);
  } catch (e) {
    console.log('  FAIL  js/options.js could not be imported — ' + e.message + '\n');
    console.log('1 passed, 1 failed\n');
    process.exit(1);
  }

  const { OPTIONS, CONSUMERS, audit, missingAnswers, display, forConsumer,
          confirmationText, crewSheet, pullList, valueOf } = mod;

  const required = { OPTIONS, CONSUMERS, audit, missingAnswers, display, forConsumer,
                     confirmationText, crewSheet, pullList, valueOf };
  let missingExport = false;
  for (const name of Object.keys(required)) {
    const ok = required[name] !== undefined;
    check('exports ' + name, ok, ok ? '' : 'renamed or removed');
    if (!ok) missingExport = true;
  }
  if (missingExport) {
    failures.forEach(f => console.log('  FAIL  ' + f));
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 1. THE AUDIT ITSELF — the gate R-001 and R-003 rest on.
  // -------------------------------------------------------------------------
  const holes = audit();
  check('audit() returns no holes against the current registry', holes.length === 0,
    holes.join(' | '));

  // -------------------------------------------------------------------------
  // 2. THE AUDIT ACTUALLY CATCHES THINGS — a gate that has never failed has not
  //    been shown to test anything. Each sabotage is run through the real
  //    audit() by swapping OPTIONS' contents and putting them straight back.
  // -------------------------------------------------------------------------
  const original = OPTIONS.slice();
  function withRegistry(rows, fn) {
    OPTIONS.length = 0;
    rows.forEach(r => OPTIONS.push(r));
    try { return fn(); } finally {
      OPTIONS.length = 0;
      original.forEach(r => OPTIONS.push(r));
    }
  }
  const base = () => ({
    id: 'probe', label: 'Probe', type: 'text', required: false,
    affectsPrice: false, consumers: ['quote', 'customer'],
  });
  const catches = (label, mutate) => {
    const row = Object.assign(base(), mutate);
    const found = withRegistry([row], () => audit());
    check('audit catches: ' + label, found.length > 0,
      'a broken option passed the audit — the gate is not doing its job');
  };

  catches('an option nothing renders', { consumers: [] });
  catches('a consumer name that does not exist', { consumers: ['quote', 'customer', 'nowhere'] });
  catches('priced but never on the confirmation (R-004)',
    { affectsPrice: true, consumers: ['quote', 'customer', 'invoice'] });
  catches('priced but never on an invoice',
    { affectsPrice: true, consumers: ['quote', 'customer', 'confirmation'] });
  catches('customer-facing but never asked on the quote form', { consumers: ['customer'] });
  catches('never reaches the customer record', { consumers: ['quote'] });
  catches('internal but shown to the customer',
    { internal: true, consumers: ['quote', 'customer'] });
  catches('a default that is not one of its own choices',
    { type: 'choice', choices: ['A', 'B'], default: 'C' });
  catches('a choice with no choices at all', { type: 'choice' });
  catches('a value reader that is not a function', { value: 'measuredFeet' });

  const dup = withRegistry([base(), base()], () => audit());
  check('audit catches: the same option declared twice', dup.length > 0,
    'two rows with one id would render twice and disagree');

  check('the registry is intact after the sabotages',
    OPTIONS.length === original.length && OPTIONS[0] === original[0],
    'a sabotage was left in place — every check after it was measuring the wrong thing');

  // -------------------------------------------------------------------------
  // 2b. THE AGREED DESTINATIONS, FROZEN.
  //
  // ⚠ WHY THIS EXISTS: a red-check found that audit() CANNOT catch a destination
  // being quietly dropped. `consumers` is the declaration, so deleting
  // 'crewSheet' from the gate code just means it no longer claims to go there —
  // coherent, and wrong. audit() has no way to know it should.
  //
  // So the map Addie settled on 2026-08-21 is frozen here. Changing a row is
  // then a DECISION that fails this test until someone updates it deliberately,
  // instead of a one-word edit nobody reviews. Update it when she changes her
  // mind, never to make a red run go away.
  // -------------------------------------------------------------------------
  const AGREED = {
    measuredFeet:      ['quote', 'confirmation', 'customer', 'pullList', 'invoice'],
    lightsDescription: ['quote', 'confirmation', 'customer', 'pullList'],
    wireColor:         ['quote', 'confirmation', 'customer', 'pullList'],
    outletTimer:       ['quote', 'confirmation', 'customer', 'crewSheet', 'pullList'],
    useEaves:          ['quote', 'customer', 'crewSheet'],
    specificOutlet:    ['quote', 'confirmation', 'customer', 'crewSheet'],
    gateCode:          ['quote', 'confirmation', 'customer', 'crewSheet'],
    houseSides:        ['quote', 'confirmation', 'customer', 'crewSheet', 'routes', 'schedule'],
    installPreference: ['quote', 'confirmation', 'customer', 'schedule'],
    notes:             ['quote', 'customer', 'crewSheet', 'routes', 'schedule'],
    oneTimeNote:       ['customer', 'crewSheet', 'routes', 'schedule'],
    wantsMailedInvoice:['quote', 'customer', 'invoice'],
    numberOfBins:      ['customer', 'pullList', 'routes', 'schedule'],
    difficulty:        ['customer', 'routes', 'schedule'],
  };

  check('the registry holds exactly the agreed options',
    OPTIONS.length === Object.keys(AGREED).length &&
    OPTIONS.every(o => AGREED[o.id]),
    'an option was added or removed — ' +
    OPTIONS.map(o => o.id).filter(id => !AGREED[id]).join(', '));

  for (const o of OPTIONS) {
    const want = AGREED[o.id];
    if (!want) continue;
    check(`${o.id} reaches exactly the destinations agreed for it`,
      want.length === o.consumers.length && want.every(c => o.consumers.includes(c)),
      'agreed: ' + want.join(', ') + '  |  declared: ' + o.consumers.join(', '));
  }

  // -------------------------------------------------------------------------
  // 3. R-002 — never a blank. This is the rule with the biggest payoff per line.
  // -------------------------------------------------------------------------
  const textOpt = OPTIONS.find(o => o.type === 'text');
  const measureOpt = OPTIONS.find(o => o.type === 'measure');
  check('an unanswered option renders "none", not a blank (R-002)',
    display(textOpt, undefined) === 'none' &&
    display(textOpt, null) === 'none' &&
    display(textOpt, '') === 'none' &&
    display(measureOpt, 0) === 'none',
    'silence and "they did not want it" must never look alike on a printed sheet');

  check('a measure renders with its unit',
    display(measureOpt, 240) === '240 ft',
    'a bare number on a sheet is ambiguous');

  /* Rendered against a customer who answered NOTHING: every line must still be
     present. This is the check that would catch someone "tidying up" the empty
     rows out of a sheet. */
  const blankCustomer = {};
  const blankSheet = crewSheet(blankCustomer);
  const crewOptions = OPTIONS.filter(o => o.consumers.includes('crewSheet'));
  check('a crew sheet for a customer with no answers still prints every line',
    crewOptions.every(o => blankSheet.includes(o.label + ': none')),
    'an omitted line is an answer nobody can verify');

  // -------------------------------------------------------------------------
  // 4. THE ARTIFACTS RENDER WHAT THEY DECLARE, AND ONLY THAT
  // -------------------------------------------------------------------------
  const customer = {
    name: 'Sarah Miller',
    measuredFeet: 240,
    lightsDescription: 'Warm White, Red',
    wireColor: 'White',
    outletTimer: 'Yes',
    useEaves: 'No',
    specificOutlet: 'Yes',
    specificOutletNotes: 'lower outlet by the door',
    gateCode: '4412',
    houseSides: 3,
    installPreference: 'November - Before Thanksgiving',
    notes: 'dog in the back garden',
  };

  for (const consumer of CONSUMERS) {
    const rows = forConsumer(consumer, customer);
    const expected = OPTIONS.filter(o => o.consumers.includes(consumer)).map(o => o.id);
    check(`${consumer} renders exactly the options that declare it`,
      rows.length === expected.length && rows.every((r, i) => r.id === expected[i]),
      'an artifact rendering a different set than it declares is the drift this file exists to stop');
  }

  const conf = confirmationText(customer, { priceLine: 'Install: 240 ft @ $2.10/ft = $504.00' });
  check('the confirmation carries the price line (R-004)',
    conf.includes('$504.00'),
    'measuredFeet affects the price, so the customer has to be shown it');
  check('the confirmation does NOT carry eaves',
    !conf.includes('Plugs / eaves'),
    'Addie removed it 2026-08-21 — putting it back is a decision, not a tidy-up');
  check('the confirmation tells them how to fix a wrong answer',
    /member portal/i.test(conf),
    'a list they cannot correct is a list nobody acts on');

  // -------------------------------------------------------------------------
  // 5. THE READERS — the two options the record does not hold plainly
  // -------------------------------------------------------------------------
  const sides = OPTIONS.find(o => o.id === 'houseSides');
  check('sides reads the old array shape and the new count alike',
    valueOf(sides, { houseSides: ['front', 'left'] }) === 2 &&
    valueOf(sides, { houseSides: 3 }) === 3 &&
    valueOf(sides, { houseSides: '2 sides' }) === 2,
    'records saved before 2026-08-19 hold an array — reading only the count loses them');

  /* ⚠ AND NOTHING RECORDED READS AS NOTHING. admin.html's houseSideCount returns
     1 for a blank, which makes "nobody asked" look like "one side" on a crew
     sheet — R-002's failure in a different hat. The registry is honest; the two
     are reconciled when this is wired up (plan §3.3), not before, because
     changing houseSideCount moves real customers' sheets today. */
  check('an unrecorded side count is undefined, not silently 1',
    valueOf(sides, {}) === undefined &&
    valueOf(sides, { houseSides: '' }) === undefined &&
    display(sides, valueOf(sides, {})) === 'none',
    'defaulting a missing answer to 1 lights one side of a house that may need three');

  const lights = OPTIONS.find(o => o.id === 'lightsDescription');
  check('light colours read from either field',
    valueOf(lights, { lightsDescription: 'Warm White, Red' }) === 'Warm White, Red' &&
    valueOf(lights, { lightColors: ['Warm White', 'Red'] }) === 'Warm White, Red',
    'an alternating pattern empties lightColors — reading only the list calls them undecorated');

  // -------------------------------------------------------------------------
  // 6. missingAnswers — what the office still has to chase
  // -------------------------------------------------------------------------
  const gaps = missingAnswers({});
  check('a blank customer is missing every required answer',
    gaps.length === OPTIONS.filter(o => o.required).length,
    'required options with no answer must be reported, not assumed');
  check('a fully answered customer is missing nothing',
    missingAnswers(customer).length === 0,
    JSON.stringify(missingAnswers(customer)));

  // -------------------------------------------------------------------------
  console.log(failures.length ? '' : '  PASS  every check below\n');
  failures.forEach(f => console.log('  FAIL  ' + f + '\n'));
  console.log(pass + ' passed, ' + fail + ' failed\n');

  if (fail) {
    console.log('The option registry is inconsistent.');
    console.log('An option that reaches fewer artifacts than it declares is a truck');
    console.log('arriving without the timer — fix the registry, not this test.\n');
  }
  process.exit(fail ? 1 : 0);
})();
