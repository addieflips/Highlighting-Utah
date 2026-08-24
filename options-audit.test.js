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
 * ⭐ WIRED 2026-08-24 (plan §3.3). Five artifacts now generate from the registry,
 * so this gate covers two things that used to be one: that the SPEC is coherent
 * (sections 1–6), and that the artifacts actually obey it (section 7). The second
 * half is the one that would have caught the real bugs — a coherent registry that
 * no screen reads is exactly what this file used to be measuring.
 *
 * Run:  node options-audit.test.js      (or: npm run test:options)
 */

const fs = require('fs');
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
          confirmationText, crewSheet, pullList, valueOf, offerableChoices } = mod;

  const required = { OPTIONS, CONSUMERS, audit, missingAnswers, display, forConsumer,
                     confirmationText, crewSheet, pullList, valueOf, offerableChoices };
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
  catches('offering a value the record may not hold',
    { type: 'choice', choices: ['A', 'B'], customerChoices: ['A', 'Z'] });
  catches('narrowing what a customer may pick without being on the quote form',
    { type: 'choice', choices: ['A', 'B'], customerChoices: ['A'],
      internal: true, consumers: ['customer'] });

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
    /* ⭐ CHANGED 2026-08-24 — 'crewSheet' added. This is the one row that has
       moved since the map was frozen, and it is a decision, not a red run being
       tidied away. Addie, 2026-08-22 — AFTER the map was settled on the 21st:
       "crew print sheet should also show bin #", meaning a quantity (her own
       vocabulary, 2026-08-21: "Bin # is how many bins were making for them").
       The printed sheet has carried a Bins column since that day, so the
       registry was the half that was out of date, not the paper. Wiring the
       sheet to the registry without this would have DELETED a column the crew
       uses to load the van. */
    numberOfBins:      ['customer', 'crewSheet', 'pullList', 'routes', 'schedule'],
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
  const blankSheet = crewSheet({});
  const crewOptions = OPTIONS.filter(o => o.consumers.includes('crewSheet'));

  check('a crew sheet for a customer with no answers still prints every line',
    crewOptions.every(o => blankSheet.includes(o.label + ':')),
    'an omitted line is an answer nobody can verify');

  /* R-002 is about an option with NO VALUE. One that declares a default always
     has one, so it prints the default rather than `none` — and should. Splitting
     the check this way says which rule applies to which option, instead of
     asserting `none` everywhere and then loosening it when a default appears. */
  check('every crew-sheet option with no default prints "none" when unanswered (R-002)',
    crewOptions.filter(o => o.default == null)
               .every(o => blankSheet.includes(o.label + ': none')),
    'silence and "they did not want it" must never look alike');

  check('an option with a default prints the default, not "none"',
    crewOptions.filter(o => o.default != null)
               .every(o => blankSheet.includes(o.label + ': ' + o.default)),
    'a declared default that does not render is a default in name only');

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
  // 4b. ACCEPTED IS NOT THE SAME AS OFFERED.
  //
  // Addie, 2026-08-21: "I don't want members to have the option for before or
  // after thanksgiving we only accept these if they ask for them." The record
  // may hold five install timings; a form may offer three. A quote form reading
  // `choices` instead of offerableChoices() would advertise a window the season
  // can only honour for a few customers.
  // -------------------------------------------------------------------------
  const timing = OPTIONS.find(o => o.id === 'installPreference');
  check('the record still accepts both Thanksgiving timings',
    timing.choices.includes('November - Before Thanksgiving') &&
    timing.choices.includes('After Thanksgiving'),
    'the office types these when a customer asks, and the master sheet imports THX');
  check('but a customer is never OFFERED them',
    offerableChoices(timing).length === 3 &&
    !offerableChoices(timing).some(c => /thanksgiving/i.test(c)),
    'offering them invites every customer into a window built for a few');
  check('everything offerable is also acceptable',
    OPTIONS.every(o => offerableChoices(o).every(c => (o.choices || []).includes(c))),
    'a form offering a value the record cannot hold writes junk');
  check('an option that narrows nothing offers all of its choices',
    offerableChoices(OPTIONS.find(o => o.id === 'wireColor')).length === 3,
    'absent customerChoices must mean "offer them all", not "offer none"');

  // -------------------------------------------------------------------------
  // 5. THE READERS — the two options the record does not hold plainly
  // -------------------------------------------------------------------------
  const sides = OPTIONS.find(o => o.id === 'houseSides');
  check('sides reads the old array shape and the new count alike',
    valueOf(sides, { houseSides: ['front', 'left'] }) === 2 &&
    valueOf(sides, { houseSides: 3 }) === 3 &&
    valueOf(sides, { houseSides: '2 sides' }) === 2,
    'records saved before 2026-08-19 hold an array — reading only the count loses them');

  /* ⭐ AN UNRECORDED COUNT IS 1, AND MUST BE. This looked like R-002's failure
     and is not: the value is one half of the comparison that raises a re-quote
     (functions/index.js:1079), so a blank on one side and a default on the other
     re-quotes every customer whose sides were never written down. These four
     readers have to agree — houseSideCount, portalSideCount, asCount, and this. */
  check('an unrecorded side count defaults to 1, matching the other three readers',
    valueOf(sides, {}) === 1 &&
    valueOf(sides, { houseSides: '' }) === 1 &&
    valueOf(sides, { houseSides: 'nonsense' }) === 1 &&
    valueOf(sides, { houseSides: 9 }) === 1,
    'a fourth reading of this field that disagrees with the other three sends spurious re-quotes')

  const lights = OPTIONS.find(o => o.id === 'lightsDescription');
  check('light colours read from either field',
    valueOf(lights, { lightsDescription: 'Warm White, Red' }) === 'Warm White, Red' &&
    valueOf(lights, { lightColors: ['Warm White', 'Red'] }) === 'Warm White, Red',
    'an alternating pattern empties lightColors — reading only the list calls them undecorated');

  // -------------------------------------------------------------------------
  // 6. missingAnswers — what the office still has to chase
  // -------------------------------------------------------------------------
  /* ⚠ REQUIRED AND NO DEFAULT, not merely required. valueOf() applies a declared
     default (2026-08-24), so an option carrying one always has an answer and can
     never be "missing" — chasing the office for a wire colour that defaults to
     Any is a row nobody can action, which is the same reasoning numberOfBins and
     houseSides already carry for not being required at all.
     This check used to read `o.required` alone and passed only because no
     required option had a default yet. Two do. */
  const gaps = missingAnswers({});
  check('a blank customer is missing every required answer that has no default',
    gaps.length === OPTIONS.filter(o => o.required && o.default == null).length,
    'required options with no answer must be reported, not assumed — got ' + gaps.join(', '));
  check('a fully answered customer is missing nothing',
    missingAnswers(customer).length === 0,
    JSON.stringify(missingAnswers(customer)));

  // -------------------------------------------------------------------------
  // 7. THE ARTIFACTS ACTUALLY OBEY IT
  //
  // Sections 1–6 prove the registry is coherent with itself. A registry nothing
  // reads is coherent and useless, which is what this file measured until the
  // wiring landed on 2026-08-24. These checks are about the five artifacts.
  // -------------------------------------------------------------------------
  const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');

  check('admin.html imports the registry',
    /from\s+'\.\/js\/options\.js'/.test(admin),
    'the crew sheet, both build sheets, the invoice and the confirmation read it');
  check('index.html imports the registry',
    /from\s+'\.\/js\/options\.js'/.test(index),
    'both quote forms build their questions from it');

  /* ⚠ NO HAND-WRITTEN OPTION COLUMN SURVIVES. The failure this catches is the one
     the whole phase exists for: somebody adds a column back to a sheet by hand, it
     renders perfectly, and the registry quietly stops being the whole truth. Each
     of these is a LABEL that used to be typed into a column list and is now
     generated, so finding one written out again means a sheet has grown a second
     source. Scoped to the column definitions, not the file — the same words appear
     in comments and in the option registry's own labels. */
  /* ⚠ SLICED TO WHICHEVER TERMINATOR COMES FIRST, not to one shape. PRINT_COLUMNS
     is an object literal ending `};`, WH_BUILD_COLUMNS is now an array with
     `.concat(...)` on the end and closes `]);`. Assuming either one made the slice
     run to the end of the file — where every generated call it was looking for
     does appear, so the check passed while measuring nothing. */
  const colBlock = (name) => {
    const at = admin.indexOf('const ' + name);
    if (at === -1) return '';
    const ends = ['\n};', '\n]);', '\n];']
      .map(t => admin.indexOf(t, at)).filter(i => i !== -1);
    return ends.length ? admin.slice(at, Math.min(...ends) + 4) : '';
  };
  const printCols = colBlock('PRINT_COLUMNS = {');
  for (const gone of ["{k: 'gate'", "{k: 'sides'", "{k: 'eaves'", "{k: 'timer'",
                      "{k: 'bins'", "{k: 'lights'", "{k: 'wire'", "{k: 'bundles'"]) {
    check('the crew and build sheets no longer hand-write ' + gone,
      printCols.indexOf(gone) === -1,
      'a hand-written option column is one the registry does not know about');
  }
  const whCols = colBlock('WH_BUILD_COLUMNS');
  for (const gone of ["{key:'wire'", "{key:'bins'", "{key:'bundles'", "{key:'timer'"]) {
    check('the warehouse build sheet no longer hand-writes ' + gone,
      whCols.indexOf(gone) === -1,
      'there are TWO build sheets and both have to read one list');
  }
  check('both build sheets ask the registry for their columns',
    (printCols.match(/optSheetColumns\('pullList'\)/g) || []).length >= 1 &&
    (whCols.match(/optSheetColumns\('pullList'\)/g) || []).length >= 1,
    'if only one of them generates, the two sheets can still disagree');
  check('the crew sheet asks the registry for its columns',
    printCols.indexOf("optSheetColumns('crewSheet')") !== -1,
    'this is the artifact P-003 was proposed about');

  /* The confirmation is the only artifact that checks our data against what the
     customer actually wanted (plan §12), so its block is not optional decoration. */
  check('the confirmation lists the registry options',
    /optForConsumer\('confirmation'/.test(admin),
    'an RSVP that shows nothing cannot catch a request nobody typed in');
  check('the confirmation appears on the real send, the preview AND the test send',
    (admin.match(/rsvpOptionsBlockFor\(/g) || []).length >= 4,
    'a block that only appears in the real email is one nobody proof-read');

  /* ⭐ THE WAREHOUSE'S WORD FOR AN UNSPECIFIED WIRE IS THE REGISTRY'S DEFAULT
     (added 2026-08-24). Addie: "we want build a sheet if they didn't put a wire to
     read any." whWireLabel answered "White" for a blank and NOTHING asserted it,
     which is why it could be changed in either direction without a single test
     moving. It is the one place both build sheets, the on-screen chip and the
     group key all read, so it is the one worth pinning.
     ⚠ Compared against the REGISTRY DEFAULT rather than the literal "Any", so
     changing her mind is one edit in js/options.js and this follows. */
  {
    const at = admin.indexOf('function whWireLabel(');
    const src = at === -1 ? '' : admin.slice(at, admin.indexOf('\n}', at) + 2);
    check('whWireLabel is still findable', !!src,
      'the build sheets, the chip and the group key all read it');
    if (src) {
      const whWireLabel = new Function(src + 'return whWireLabel;')();
      const wire = OPTIONS.find(o => o.id === 'wireColor');
      check('an unspecified wire reads as the registry default on the build sheet',
        whWireLabel('') === wire.default && whWireLabel('   ') === wire.default,
        'got ' + JSON.stringify(whWireLabel('')) + ', registry says ' +
        JSON.stringify(wire.default) + ' — a builder reading "White" cannot tell ' +
        'it from a customer who ASKED for white, which is the one fact worth having');
      check('and a wire they did ask for is left exactly alone',
        whWireLabel('White') === 'White' && whWireLabel('Green') === 'Green',
        'defaulting over a real answer is the opposite failure');
    }
  }

  check('the invoice lists its non-priced options',
    /optInvoiceOptions\(\)/.test(admin),
    'a customer who asked for a posted invoice was recorded and never printed');

  check('the quote form generates its questions',
    /optQuoteFields\('details'\)/.test(index),
    'a hand-written form field is an option the registry cannot reach');
  check('the quote form offers only what a customer may pick',
    /optOfferableChoices\(/.test(index) && !/\.choices\b/.test(
      index.slice(index.indexOf('function qdControlFor'), index.indexOf('function qdRenderOptionFields'))),
    'reading `choices` advertises the two Thanksgiving timings we only accept on request');
  /* ⚠ blockingAnswers, NOT missingAnswers, SINCE 2026-08-24. Addie settled what a
     blank means field by field — the timer is No, the wire colour is Any ("we
     choose"), and light colours are something they "can't move on without" — so
     the save path REFUSES rather than reporting. The distinction is the whole
     answer: a required option with a default is never missing; one without a
     default stops the form. */
  check('an answer we cannot proceed without stops the save (plan §3.5)',
    /optBlockingAnswers\(/.test(index),
    'the quote-save path has to refuse what it cannot proceed without');
  check('and light colours are what that currently blocks',
    (function(){
      const b = mod.blockingAnswers({});
      return b.length === 1 && b[0] === 'lightsDescription';
    })(),
    'Addie, 2026-08-24: "If it is light colors that needs to be required and they ' +
    'cannot move on without that" — got ' + JSON.stringify(mod.blockingAnswers({})));
  /* ⚠ AND THE TWO SHE GAVE AN ANSWER FOR DO NOT BLOCK. A default IS the answer,
     so a form that stopped for them would be unsubmittable for no reason. */
  check('a blank timer and a blank wire colour never block',
    mod.blockingAnswers({}).indexOf('outletTimer') === -1 &&
    mod.blockingAnswers({}).indexOf('wireColor') === -1,
    'the timer defaults to No and the wire colour to Any — both are answers');

  /* -----------------------------------------------------------------------
     7b. THE SERVER WHITELIST — the one place generation cannot reach.
     Cloud Functions deploy only the functions/ directory, so quoteSaveDetails
     cannot import js/options.js and keeps its own list of what a quote form may
     write. That is the same one-rule-two-runtimes problem as the invoice maths,
     and it gets the same answer money-parity.test.js gives: a check that FAILS
     when the two disagree, so a new option is loud instead of silently dropped
     on the token route while rendering perfectly on the form.
     ⚠ IF THIS FAILS, THE FIX IS IN functions/index.js, not here. Widening the
     ignore list below to make it green re-opens exactly the hole it exists for.
     ----------------------------------------------------------------------- */
  const saveAt = server.indexOf('exports.quoteSaveDetails');
  const saveFn = saveAt === -1 ? '' : server.slice(saveAt, server.indexOf('\n});', saveAt));
  check('quoteSaveDetails is still findable', saveFn.length > 0,
    'renamed or removed — this check is the only thing tying the server to the registry');

  if (saveFn) {
    const writeAt = saveFn.indexOf('.update({');
    const writeBlock = saveFn.slice(writeAt, saveFn.indexOf('  });', writeAt));
    const formOptions = OPTIONS.filter(o =>
      o.consumers.includes('quote') && !o.officeEntered &&
      (o.quoteStage || 'details') === 'details');
    for (const o of formOptions) {
      check('the server accepts "' + o.id + '" from the quote form',
        new RegExp('\\b' + o.id + '\\s*:').test(writeBlock),
        'the form collects it and the server drops it — the customer answers a ' +
        'question that reaches nothing. Add it to the update in quoteSaveDetails.');
    }
  }

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
