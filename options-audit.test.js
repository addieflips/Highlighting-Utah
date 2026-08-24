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
  const gaps = missingAnswers({});
  check('a blank customer is missing every required answer',
    gaps.length === OPTIONS.filter(o => o.required).length,
    'required options with no answer must be reported, not assumed');
  check('a fully answered customer is missing nothing',
    missingAnswers(customer).length === 0,
    JSON.stringify(missingAnswers(customer)));

  // -------------------------------------------------------------------------
  /* ⭐ THE REGISTRY IS ENFORCED AGAINST THE REAL ARTIFACTS (added 2026-08-24).
     Owner: "I need everything to be wired correctly so lets get that wired
     correctly."

     ⚠ WHAT "WIRED" HAD TO MEAN HERE. The plan's §3.3 was for the eight artifacts to
     be GENERATED from this registry. That is a rewrite of every customer- and
     crew-facing surface at once, and it would have quietly reverted at least one
     decision the owner made by hand (the build sheet prints BUNDLES, not feet —
     "I don't think we need feet and bundles"). Generation replaces working screens;
     what the registry is actually FOR is making it impossible to forget one.

     So the registry earns its keep the other way round: every option declaring a
     destination must be shown to reach the REAL artifact, and adding an option
     without wiring it FAILS THE BUILD. That is the same guarantee, from detection
     rather than generation, and it leaves the screens the owner corrected alone.
     CLAUDE.md §6 asks for exactly this — a `read` rule promoted to `code`.

     ⚠ THE CORRESPONDENCE LIVES HERE, NOT IN THE REGISTRY. The registry says WHERE an
     answer must end up; this says HOW that surface carries it today. They are two
     independent statements and the whole value is in them being written apart — a
     mapping stored in the registry would be updated in the same edit that broke the
     artifact, and prove nothing. */
  {
    const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
    const fnOf = (name) => {
      const at = admin.indexOf('function ' + name + '(');
      if (at === -1) return '';
      let d = 0;
      for (let i = admin.indexOf('{', at); i < admin.length; i++) {
        if (admin[i] === '{') d++;
        else if (admin[i] === '}') { d--; if (!d) return admin.slice(at, i + 1); }
      }
      return '';
    };
    /* ⭐ EACH SURFACE IS CHECKED ON ITS OWN, and that is not tidiness. The first
       version concatenated the two build sheets into one string — so a sabotage that
       deleted the wire colour from the WAREHOUSE sheet passed, because the printed
       sheet still mentioned it. One sheet covering for the other is precisely the
       "half wired" failure this is here to catch, and CLAUDE.md already records a
       red-check that went green for exactly that reason.

       An option that declares a destination must reach EVERY surface of it. Where two
       surfaces carry the same answer differently — the light colour is a group heading
       on the warehouse list and a column on the printed one — each gets its own rule. */
    const SURFACES = {
      crewSheet: [{
        name: 'the crew sheet',
        src: fnOf('printCrewRow') + fnOf('printCrewNotes'),
        by: {
          outletTimer:    /timer: printYesNo\(d\.outletTimer\)/,
          useEaves:       /eaves: printYesNo\(d\.useEaves\)/,
          gateCode:       /gate: printGateCode\(d\)/,
          houseSides:     /sides: printSideCount\(d\)/,
          /* ⚠ FOLDED INTO THE NOTES COLUMN, AND MATCHED WITH THEIR GUARD. Matching the
             prefix alone let `if(false) bits.push('TODAY: ' + once)` pass — every word
             in place, nothing on the sheet. The condition is part of what is asserted. */
          specificOutlet: /if\(outlet\) bits\.push\('OUTLET: '/,
          oneTimeNote:    /if\(once\) bits\.push\('TODAY: '/,
          notes:          /if\(standing\) bits\.push\(standing\)/,
        },
      }],
      pullList: [
        {
          name: 'the warehouse build list',
          src: fnOf('whSheetRowsForBuild'),
          by: {
            /* grouped by colour and wire rather than columned — whGroupKey */
            lightsDescription: /group: groupName/,
            /* ⚠ TWICE, BECAUSE THIS SHEET HAS TWO ROW SHAPES. A house waiting on its
               colours prints a blocked row, a buildable house prints a real one, and
               BOTH need the wire and the timer — the warehouse reads one list. A
               single-occurrence regex passed a sabotage that deleted the field from
               the real build row, because the blocked row still mentioned it: one
               branch covering for the other, the same failure as one sheet covering
               for the other a few lines up. */
            wireColor:         /wire: whWireLabel\(d\.wireColor\)[\s\S]*wire: whWireLabel\(d\.wireColor\)/,
            outletTimer:       /timer: String\(d\.outletTimer[\s\S]*timer: String\(d\.outletTimer/,
            /* ⚠ FEET REACHES THE WAREHOUSE AS BUNDLES, deliberately. Owner,
               2026-08-21: "I don't think we need feet and bundles. I think how many
               bundles is fine for warehouse", and 2026-08-24: "on warehouse it should
               say bundles but on quotes we should be measuring the feet." Bundles are
               computed from the footage (houseBundleNeed), so the answer does arrive —
               as the number somebody counts off a shelf. Asserting a feet column here
               would fail a sheet that is right, which is how a good gate gets deleted. */
            measuredFeet:      /bundles: \(need\.topUp/,
            /* ⚠ BINS IS ITS OWN COLUMN HERE, not bundles. The first version of this
               mapped it to the bundle count as well, which was lazy and wrong — bins
               are what the warehouse LABELS, bundles are what they make, and one is
               not evidence of the other. Mapping two options to one column also means
               losing that column fails two checks and gaining it passes two. */
            numberOfBins:      /bins: whBinsForHouse\(d\)[\s\S]*bins: whBinsForHouse\(d\)/,
          },
        },
        {
          name: 'the printed build sheet',
          src: fnOf('printNeedsBuildList'),
          by: {
            lightsDescription: /lights: printLightColor\(d\)/,
            wireColor:         /wire: d\.wireColor/,
            outletTimer:       /timer: printYesNo\(d\.outletTimer\)/,
            measuredFeet:      /bundles: need/,
            /* ⚠ AND IT IS GENUINELY NOT ON THE PRINTED SHEET — recorded, not papered
               over. The Warehouse tab's list shows a bins column; the printed one never
               has, through every revision of it (git log -S). So the person reading the
               screen is told how many bins to label and the person carrying the paper is
               not. That is a real difference between two sheets doing one job, and it is
               the owner's call rather than mine: adding a column to a sheet she trimmed
               herself is exactly the kind of guess this registry exists to stop.
               ⚠ IT IS NOT SILENT. `except` makes the check say so on every run, so the
               difference is visible until somebody decides — a missing entry would just
               look like nobody had got to it. */
            numberOfBins:      { except: 'the printed build sheet has no bins column; ' +
                                 'the Warehouse tab list does. Owner to decide whether ' +
                                 'the paper should match the screen.' },
          },
        },
      ],
    };

    Object.keys(SURFACES).forEach((consumer) => {
      const declared = OPTIONS.filter(o => (o.consumers || []).indexOf(consumer) !== -1);
      check(consumer + ': the registry declares options for it', declared.length > 0,
        'an empty list here means the filter stopped matching and every check below ' +
        'is passing over nothing');
      SURFACES[consumer].forEach((surface) => {
        check(surface.name + ': its source was found', !!surface.src,
          'a gate that cannot find its target must FAIL, never skip — a whole block ' +
          'failing at once is the shape to distrust first');
        declared.forEach((o) => {
          const rule = surface.by[o.id];
          /* ⚠ A RECORDED EXCEPTION IS REPORTED, NEVER SILENT. An option a surface
             deliberately does not carry is a decision somebody made; leaving it out of
             this map entirely would be indistinguishable from nobody having wired it. */
          if (rule && rule.except) {
            console.log('  note  ' + surface.name + ': ' + o.id + ' is deliberately not ' +
                        'carried \u2014 ' + rule.except);
            return;
          }
          /* ⚠ THIS IS THE ONE THAT MAKES THE REGISTRY LOAD-BEARING. Add an option
             declaring this destination and the build fails right here, on every
             surface of it, until somebody says how it gets there. */
          check(surface.name + ': ' + o.id + ' is wired to it', !!rule,
            'the registry says ' + o.id + ' must reach ' + surface.name + ' and ' +
            'nothing says how — wire it, or take the destination off the registry');
          if (rule) {
            check(surface.name + ': ' + o.id + ' still reaches it', rule.test(surface.src),
              'the registry says ' + o.id + ' must reach ' + surface.name + ' and the ' +
              'real one no longer carries it — this is a truck arriving without it');
          }
        });
        /* ⚠ AND NOTHING IS WIRED THAT THE REGISTRY DOES NOT ASK FOR. A leftover rule
           is one nobody is checking, against a destination nobody declared. */
        Object.keys(surface.by).forEach((id) => {
          if (surface.by[id] && surface.by[id].except) return;
          check(surface.name + ': the wiring for ' + id + ' matches a declared destination',
            declared.some(o => o.id === id),
            id + ' is wired here but the registry does not send it to the ' + consumer);
        });
      });
    });
  }

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
