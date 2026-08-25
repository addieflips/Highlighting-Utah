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
/* Declared destinations nothing delivers. Printed and counted at the end; they do NOT
   fail the build, because every one is a question for Addie rather than a bug — see the
   gap note in the surface loop. Same contract as gap() in run-all.js. */
const gaps = [];

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

  /* ⚠ WHAT THE REGISTRY IS, after 2026-08-25. It declares the options and where each
     must end up, and audit() proves that declaration is internally coherent. It does
     NOT render anything: forConsumer, confirmationText, crewSheet, pullList,
     missingAnswers and offerableChoices were removed because no shipped file ever
     called them — see the header of js/options.js. The checks that exercised them went
     with them; they tested each other and nothing that reaches a customer. */
  const { OPTIONS, CONSUMERS, audit, display, valueOf } = mod;
  /* ⚠ THE REAL BIN RULE, re-exported by the registry from js/money.js. Taken from
     there rather than re-typed, so the threshold this test asserts is the same one
     the customer-number series is derived from — R-014, business constants live in
     exactly one file. */
  const { cnBinsForFeet, CN_DOUBLE_BIN_FEET } = mod;

  const required = { OPTIONS, CONSUMERS, audit, display, valueOf };
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


  /* ⭐ R-002 ON THE REAL SHEET (rewritten 2026-08-25). Owner: "so we'll have code that
     will just sit there doing nothing forever" — asked twice, and she was right.

     ⚠ WHAT THESE TWO CHECKS USED TO BE. They asserted that a crew sheet built by
     js/options.js printed "none" for an unanswered option. No shipped file has ever
     called that renderer, so what they proved was that a function nobody runs agreed
     with a test nobody could act on — while the sheet the crew actually holds prints
     "?". Green, and about nothing. The renderer is deleted; this is the same rule
     pointed at the code that ships.

     R-002 is that silence and "they did not want it" must never look alike. A blank
     cell reads as "no gate code" exactly like a customer who was never asked. */
  {
    const admin2 = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
    const lift = (n) => {
      const at = admin2.indexOf('function ' + n + '(');
      if (at < 0) return null;
      let d = 0;
      for (let i = admin2.indexOf('{', at); i < admin2.length; i++) {
        if (admin2[i] === '{') d++;
        else if (admin2[i] === '}') { d--; if (!d) return admin2.slice(at, i + 1); }
      }
      return null;
    };
    const yesSrc = lift('printYesNo'), gateSrc = lift('printGateCode');
    check('the crew sheet print helpers were found', !!yesSrc && !!gateSrc,
      'a gate that cannot find its target must FAIL, never skip');
    if (yesSrc && gateSrc) {
      const yes = new Function('return ' + yesSrc + ';printYesNo')();
      const gate = new Function('return ' + gateSrc + ';printGateCode')();
      /* ⚠ EVERY SHAPE AN UNANSWERED OPTION ARRIVES IN. undefined is a field never
         written; '' is one written and cleared; null is what a reset leaves. */
      check('an unanswered yes/no prints a visible marker, never a blank (R-002)',
        [undefined, null, ''].every(v => String(yes(v)).trim() !== ''),
        'a blank cell reads as "no" — silence and a decision must not look alike');
      check('and a real No still reads as No, not as unanswered',
        yes(false) === 'No' && yes('No') === 'No',
        'if unanswered and No render the same, the marker is worthless');
      check('an unanswered gate code prints a dash, never a blank (R-002)',
        [undefined, null, ''].every(v => String(gate({ gateCode: v })).trim() !== ''),
        'a blank gate column is a crew standing at a gate wondering if they missed it');
    }
  }

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
  /* ⭐ CHECKED ON THE REAL FORM (rewritten 2026-08-25). These asserted
     offerableChoices(), a registry helper no shipped file called — so the rule was
     being proved about a function nobody runs. The rule itself is the owner's, from
     2026-08-21, and it is real: a form that offers a Thanksgiving window invites every
     customer into one built for a few. index.html is where that can actually go wrong,
     so that is where it is asserted. */
  {
    const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const offered = [...idx.matchAll(/<option value="([^"]*)"[^>]*>[^<]*<\/option>/g)]
      .map(m => m[1]);
    check('the public form offers no Thanksgiving window',
      !offered.some(v => /thanksgiving/i.test(v)),
      'the office types these when a customer asks for them, and the master sheet ' +
      'imports THX — but offering them invites everybody into a window built for a few');
    /* ⚠ AND THE RECORD STILL ACCEPTS THEM. The rule is "never offered", not "never
       held" — the season scheduler reads both timings and holds those customers to
       the right week. A registry that dropped them would break the import. */
    check('but the record still accepts both Thanksgiving timings',
      timing.choices.includes('November - Before Thanksgiving') &&
      timing.choices.includes('After Thanksgiving'),
      'the master sheet imports THX and the scheduler honours it');
    /* ⚠ AND EVERY VALUE THE FORM DOES OFFER MUST BE ONE THE RECORD CAN HOLD, or the
       form writes junk into a field the scheduler then cannot read. */
    const timingOffered = offered.filter(v => /^(October|November|Normal Schedule|Any)$/.test(v));
    check('and everything the form offers is a value the record accepts',
      timingOffered.every(v => timing.choices.includes(v) ||
                               v === 'Normal Schedule' || v === 'Any'),
      'a form offering a value the record cannot hold writes junk: ' + timingOffered.join(', '));
  }

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
    /* Slice a handler from its anchor to the end of its top-level construct. fnOf only
       finds `function name(`, and the two customer write paths are addEventListener
       handlers, which have no name to find.
       ⚠ TO THE REAL END, never a character count — CLAUDE.md §7, and it has already
       cost this file once: the Edit Customer save is ~36,000 characters and growing.
       ⚠ AND \r?\n, because admin.html is CRLF and is read here unnormalised. */
    const indexSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const idxBlock = (a) => {
      const at = indexSrc.indexOf(a);
      if (at === -1) return '';
      const m = /\r?\n\}\);/.exec(indexSrc.slice(at));
      return indexSrc.slice(at, m ? at + m.index + m[0].length : indexSrc.length);
    };
    /* ⚠ THE RSVP TEMPLATE ITSELF, not every template in the file (corrected 2026-08-25,
       hours after it shipped). The first version sliced from the Nightly Auto-Invoice
       entry to the end of the array — but the RSVP template sits ABOVE that one, so the
       surface never looked at the email it is about, and measuredFeet passed because
       {{feet_line}} exists in a BILLING template. One email covering for another: the
       exact failure the note on the two build sheets warns about, committed in the same
       file that warns about it.
       ⚠ SO IT IS SCOPED TO THE RSVP FOLDER. Widening it back to every template makes
       every check here meaningless again, silently. */
    const ET_START = admin.indexOf('const ET_PREBUILT_TEMPLATES = [');
    const allTemplates = admin.slice(ET_START, admin.indexOf('\n];', ET_START));
    const rsvpAt = allTemplates.indexOf("folderName:'RSVP'");
    const emailTokens = rsvpAt === -1 ? ''
      : allTemplates.slice(allTemplates.lastIndexOf('{name:', rsvpAt),
                           allTemplates.indexOf('},', rsvpAt) + 2);
    const blockFrom = (anchor) => {
      const at = admin.indexOf(anchor);
      if (at === -1) return '';
      const m = /\r?\n\}\);/.exec(admin.slice(at));
      return admin.slice(at, m ? at + m.index + m[0].length : admin.length);
    };
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
    /* Which destinations are stages rather than parallel copies. See the note on the
       loop below; anything not named here is 'all'. */
    const MODES = { quote: 'any', invoice: 'any' };
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
            /* ⭐ ASKED AND ANSWERED, 2026-08-24. The Warehouse tab's list shows a bins
               column and the printed sheet never has, through every revision of it — so
               the person reading the screen was told how many bins to label and the
               person carrying the paper was not. Put to the owner rather than guessed
               at, because adding a column to a sheet she trimmed herself is exactly what
               this registry exists to stop. Her answer: "We want to show costumer # on
               paper and bundles."

               So the paper deliberately does NOT carry bins. The customer number is what
               identifies the bin once it is made, and the bundle count is what somebody
               counts off a shelf — bins is the office's sizing number and stays on the
               screen. Recorded as a decision rather than left as a gap, so nobody
               re-opens it; the note still prints on every run so it is never invisible. */
            /* ⭐ A COLUMN OF ITS OWN SINCE 2026-08-25. Owner: "Everyone needs to know
               how many bins there are for each house so bin # and costumer # does
               matter." It used to ride in the bundles cell and only past two bins —
               her own trimming of 2026-08-24, on the reasoning that a 5000-series
               number already says two. That made the count conditional, so a house on
               a regular number said nothing and the reader had to know the rule. */
            numberOfBins:      /bins: \(typeof whBinsForHouse/,
          },
        },
      ],
      /* ⭐ THE CUSTOMER RECORD (added 2026-08-25). Every one of the fourteen options
         declares this destination — it is the only one all of them share, and it sits
         UPSTREAM of every other surface: the crew sheet and the build list are both
         enforced already, but both read the record, so a field that stops being saved
         here breaks them without either of their checks firing.

         ⚠ TWO WRITE PATHS, CHECKED SEPARATELY, for exactly the reason the two build
         sheets are: a customer can be created or corrected, and a field wired into one
         path and not the other is a gap that only shows up months later on whichever
         half nobody used. Add Customer carries all fourteen; the Edit Customer save
         carries thirteen. */
      customer: [
        {
          name: 'Add Customer',
          src: blockFrom("document.getElementById('routeAddressForm').addEventListener("),
          by: {
            measuredFeet:       /measuredFeet: measuredFeet/,
            lightsDescription:  /lightsDescription: lightsDescription/,
            wireColor:          /wireColor: wireColor/,
            outletTimer:        /outletTimer: outletTimer/,
            useEaves:           /useEaves: useEaves/,
            specificOutlet:     /specificOutlet: specificOutlet/,
            gateCode:           /gateCode: gateCode/,
            /* ⚠ NOT `houseSides: houseSides` — the form collects a count under its own
               name, and a lazy regex on the field name alone would pass against the
               registry's own comment about it a few hundred lines up. */
            houseSides:         /houseSides: selectedSides/,
            installPreference:  /installPreference: installPreference/,
            notes:              /notes: custNotes/,
            oneTimeNote:        /oneTimeNote: oneTimeNote/,
            wantsMailedInvoice: /wantsMailedInvoice: wantsMailedInvoice/,
            numberOfBins:       /numberOfBins: numberOfBins/,
            difficulty:         /difficulty: difficulty/,
          },
        },
        {
          name: 'the Edit Customer save',
          src: blockFrom("document.getElementById('editCustSaveBtn').addEventListener("),
          by: {
            measuredFeet:       /measuredFeet: newMeasuredFeet/,
            /* ⚠ THESE FOUR ARE ASSIGNED ONTO addrUpdates AFTER the literal, not inside
               it, and the assignment is what has to survive — matching the bare field
               name would pass against any of the two dozen places the word appears in
               this handler's comments. */
            lightsDescription:  /addrUpdates\.lightsDescription = newLightsDescription/,
            installPreference:  /addrUpdates\.installPreference = newInstallPref/,
            notes:              /addrUpdates\.notes = newHouseNotes/,
            oneTimeNote:        /addrUpdates\.oneTimeNote = newOneTimeNote/,
            wireColor:          /wireColor: newWireColor/,
            outletTimer:        /outletTimer: newOutletTimer/,
            useEaves:           /useEaves: newUseEaves/,
            specificOutlet:     /specificOutlet: newSpecificOutlet/,
            gateCode:           /gateCode: newGateCode/,
            houseSides:         /houseSides: newHouseSides/,
            wantsMailedInvoice: /wantsMailedInvoice: newWantsMailed/,
            numberOfBins:       /numberOfBins: newBins/,
            /* ⚠ A RECORDED EXCEPTION, NOT A GAP. Difficulty is the one option this form
               does not carry, and that is deliberate rather than forgotten: it is how
               hard a house is to hang, which is learned by hanging it, so it is set from
               the Routes screen by whoever just did the job. Add Customer sets it at
               creation and the dropdown corrects it afterwards, so it is still wired on
               both ends — the standalone check below holds that dropdown in place, or
               this exception would quietly become the gap it claims not to be. */
            difficulty: { except: 'set from the Routes screen by whoever hung the house, not from this form' },
          },
        },
      ],
      /* ⭐ THE PUBLIC QUOTE (added 2026-08-25). TWO STAGES, not two copies: the request
         form is what a stranger fills in, the detail form is what they fill in after
         approving. An option belongs to one of them. */
      quote: [
        {
          name: 'the public quote form',
          src: idxBlock("quoteFormEl.addEventListener('submit'"),
          by: {
            houseSides: /houseSides: portalSideCount\(fd\.get\('house_sides'\)\)/,
            /* ⚠ THE OFFICE MEASURES THE HOUSE, and a customer's guess would set the
               price, the bins, the bundles and the number series off a number nobody
               checked. Recorded as a gap rather than an exception because the registry
               still asks for it and only Addie can settle which is wrong. */
            measuredFeet: { gap: 'the public form does not ask for footage — the office measures it, and that number sets the price', wired: /measuredFeet:/ },
            useEaves: { gap: 'not asked anywhere on the public site; the office fills it in from the master sheet', wired: /useEaves:/ },
          },
        },
        {
          name: 'the quote detail form',
          src: idxBlock("quoteDetailFormEl.addEventListener('submit'"),
          by: {
            lightsDescription:  /var lightsDescription = qdFinalSequence\.join/,
            wireColor:          /wireColor: fd\.get\('wire_color'\)/,
            outletTimer:        /outletTimer: fd\.get\('outlet_timer'\)/,
            specificOutlet:     /specificOutlet: fd\.get\('specific_outlet'\)/,
            gateCode:           /gateCode: fd\.get\('gate_code'\)/,
            installPreference:  /installPreference: fd\.get\('install_month'\)/,
            notes:              /notes: fd\.get\('notes'\)/,
            wantsMailedInvoice: /wantsMailedInvoice: fd\.get\('wants_mailed'\)/,
          },
        },
      ],

      /* ⭐ THE INVOICE (added 2026-08-25). Also two stages: what is PRINTED on the bill,
         and how the bill is POSTED. A delivery preference is not a line item. */
      invoice: [
        {
          name: 'the invoice document',
          src: fnOf('buildInvoiceDocHtml'),
          by: { measuredFeet: /const feet = Number\(d\.measuredFeet\)/ },
        },
        {
          name: 'the invoice send list',
          /* ⚠ renderPibRow, not renderPibLists — the list builds the rows, the ROW is
             what shows the office that this customer also wants paper. */
          src: fnOf('renderPibRow'),
          by: { wantsMailedInvoice: /row\.wantsMailed \? '<div/ },
        },
      ],

      /* ⭐ THE CREW'S ROUTE (added 2026-08-25). One surface, so 'all' applies. Three of
         the five declared options reach it; the other two are recorded as gaps. */
      routes: [
        {
          name: "the crew's route list",
          src: fnOf('renderRouteOrderedList'),
          by: {
            notes:       /hd\.notes \? '<div style="font-size:12\.5px/,
            oneTimeNote: /hd\.oneTimeNote \? '<div style="font-size:12\.5px/,
            difficulty:  /live\.data\.difficulty \|\| 'Unrated'/,
            houseSides:      { gap: 'the route card does not say how many sides the house is — the crew finds out on arrival', wired: /houseSides|houseSideWords/ },
            numberOfBins:    { gap: 'the route card does not say how many bins, so a crew cannot tell what to load', wired: /numberOfBins|whBinsForHouse/ },
          },
        },
      ],

      /* ⭐ THE SEASON PLAN (added 2026-08-25). What reaches a plan house is decided by
         SCHEDULE_SYNC_FIELDS, which carries six fields and only two of them are registry
         options. The other four declared destinations are gaps. */
      schedule: [
        {
          name: 'the season plan',
          src: admin.slice(admin.indexOf('SCHEDULE_SYNC_FIELDS = ['),
                           admin.indexOf('\n];', admin.indexOf('SCHEDULE_SYNC_FIELDS = ['))),
          by: {
            installPreference: /key:'pref'/,
            /* ⚠ NOTES REACH IT UNDER ANOTHER NAME. The plan's field is `details` and its
               reader is `d.notes` — matching the plan's own key would pass against a
               reader pointed at something else entirely. */
            notes: /key:'details',[\s\S]{0,60}return d\.notes;/,
            oneTimeNote:  { gap: 'the plan carries standing notes but not the this-visit-only one', wired: /key:'oneTimeNote'/ },
            houseSides:   { gap: 'not synced onto a plan house', wired: /key:'houseSides'/ },
            numberOfBins: { gap: 'not synced onto a plan house, so a day cannot be planned around what has to be loaded', wired: /key:'numberOfBins'/ },
            difficulty:   { gap: 'not synced onto a plan house, so a hard house cannot be spread across a day', wired: /key:'difficulty'/ },
          },
        },
      ],

      /* ⭐ THE RSVP EMAIL (added 2026-08-25) — "what we tell them we have on file".
         ⚠ THIS IS THE BIGGEST MISMATCH IN THE REGISTRY and the reason it was worth
         wiring the last five at all: eight options declare this destination and the
         RSVP email has a token for NOT ONE of them. It is a greeting, one question and
         three buttons — a customer confirming their season is shown nothing at all about
         what we hold for them: not their footage, colours, wire, timer, sides, gate code
         or the month they asked for.
         ⚠ THIS SAID 'exactly ONE' FOR A FEW HOURS, because the surface was sliced across
         every template and matched {{feet_line}} in a billing email. Corrected. */
      confirmation: [
        {
          name: 'the RSVP email',
          src: emailTokens,
          by: {
            measuredFeet: { gap: 'no token — the RSVP email carries NONE of the eight; it is a greeting and three buttons', wired: /\{\{[a-z_]*(feet)[a-z_]*\}\}/ },
            lightsDescription: { gap: 'no token — they are never told which colours we hold for them', wired: /\{\{[a-z_]*(lights)[a-z_]*\}\}/ },
            wireColor:         { gap: 'no token', wired: /\{\{[a-z_]*wire[a-z_]*\}\}/ },
            outletTimer:       { gap: 'no token', wired: /\{\{[a-z_]*timer[a-z_]*\}\}/ },
            specificOutlet:    { gap: 'no token', wired: /\{\{[a-z_]*outlet[a-z_]*\}\}/ },
            gateCode:          { gap: 'no token — and this is the one they most often need to correct', wired: /\{\{[a-z_]*gate[a-z_]*\}\}/ },
            houseSides:        { gap: 'no token', wired: /\{\{[a-z_]*sides[a-z_]*\}\}/ },
            installPreference: { gap: 'no token — they are not shown the month they asked for', wired: /\{\{[a-z_]*(install|month)[a-z_]*\}\}/ },
          },
        },
      ],
    };

    /* ⭐ WHAT THE PAPER MUST CARRY, in the owner's own words (2026-08-24): "we want
       to show costumer # on paper and bundles." Neither is a registry option — the
       customer number is an identifier rather than something a customer asks for — so
       nothing above would notice either going missing. Asserted here because they are
       the two things she named, and the bundle count is what somebody actually counts
       off a shelf. */
    /* ⚠ THE OTHER HALF OF THE difficulty EXCEPTION ABOVE. The Edit Customer save is
       allowed not to carry it only because the Routes screen does; without this the
       exception would be a gap wearing a reason. Two dropdowns write it — the route
       ordered list and the stop row — and each is asserted, because one covering for
       the other is the same failure as one build sheet covering for the other. */
    const setdiffWrites = admin.match(/updateDoc\(doc\(db,'jobAddresses',sel\.dataset\.setdiff\), \{difficulty: sel\.value\}\)/g) || [];
    check('difficulty is still settable from the Routes screen',
      setdiffWrites.length >= 2,
      'found ' + setdiffWrites.length + ' — the Edit Customer form deliberately does ' +
      'not carry difficulty, so if these go there is nowhere left to correct it and ' +
      'the recorded exception above becomes a hole');

    const buildCols = (admin.match(/build:\s*\[([\s\S]*?)\],\s*\n/) || [])[1] || '';
    check('the printed build sheet carries the customer number',
      /k: 'number', label: 'Cust #'/.test(buildCols),
      'it is what identifies the bin once the bundle is made');
    check('and the bundle count', /k: 'bundles'/.test(buildCols),
      'the number somebody counts off a shelf');
    /* ⭐ AND THE BIN COUNT, ON EVERY SHEET (2026-08-25). This check used to assert the
       OPPOSITE — that bins was deliberately NOT a column here — and said in its own
       failure message that if it ever started failing she had changed her mind. She
       did: "Everyone needs to know how many bins there are for each house so bin # and
       costumer # does matter."
       ⚠ HER 2026-08-24 REASONING IS KEPT because it was sound at the time: "all
       warehouse people should know 5000 means 2 bins so not necessary to put how many
       bins on there", then "just put how many bins will be needed if it is more than 2
       bins." The cost of that was a CONDITIONAL count — nothing at all on a regular
       number — so the person carrying the paper had to know the 5000 rule to read it. */
    check('and the bin count, in a column of its own', /k: 'bins'/.test(buildCols),
      'everyone needs to know how many bins there are for each house');

    /* ⭐ AND THE COUNT SPEAKS FOR EVERY HOUSE NOW (2026-08-25). Owner: "Everyone needs
       to know how many bins there are for each house."

       ⚠ WHAT THIS REPLACED, kept because the reasoning was sound at the time: a
       CONDITIONAL note in the bundles cell, printExtraBinsNote, which said "3 BINS"
       only past two bins. Owner, 2026-08-24: "all warehouse people should know 5000
       means 2 bins so not necessary to put how many bins on there", then "just put how
       many bins will be needed if it is more than 2 bins." The cost was that a house on
       a REGULAR number said nothing at all, so reading the sheet meant knowing the 5000
       rule. A column says it outright for every house, so the note and its helper are
       gone rather than left as a second way of saying the same thing.

       ⚠ RUN, NOT MATCHED — the point is that the cell carries a real count. */
    {
      const at3 = admin.indexOf('function whBinsForHouse(');
      check('whBinsForHouse is still there to answer it', at3 !== -1,
        'it is the one bin count the crew sheet, both build sheets and the '+
        'recycle sheet all read');
      if (at3 !== -1) {
        const e3 = admin.indexOf('\n}', at3) + 2;
        const bins = new Function('cnBinsForFeet',
          'return ' + admin.slice(at3, e3) + ';whBinsForHouse')(cnBinsForFeet);
        check('a one-bin house says 1, where the old note said nothing',
          String(bins({ measuredFeet: 200 })) === '1',
          'this is the house the conditional note could never speak for');
        check('and a two-bin house says 2',
          String(bins({ measuredFeet: CN_DOUBLE_BIN_FEET * 2 })) === '2',
          '520 ft is the last two-bin house');
        check('and a three-bin house says 3',
          String(bins({ measuredFeet: CN_DOUBLE_BIN_FEET * 2 + 1 })) === '3',
          '521 ft is the first three-bin house, straight off CN_DOUBLE_BIN_FEET');
        /* ⚠ AN UNMEASURED HOUSE MUST NOT READ AS NEEDING ZERO BINS. */
        check('and an unmeasured house says nothing, not 0',
          !String(bins({})).match(/^0$/),
          'a 0 in a count column reads as a decision');
      }
      /* ⚠ AND THE OTHER SHEETS CARRY IT TOO, which is the whole of what she asked for.
         The crew sheet and the warehouse tab already did; these two did not. */
      /* ⚠ SLICED TO THE REAL END, not a character count — a comment added between the
         columns pushed the new one past a 700-char window and failed this on correct
         code. The trap CLAUDE.md §7 names, and it has bitten twice in two days. */
      const recyStart = admin.indexOf('const WH_RECYCLE_COLUMNS = [');
      const recyCols = admin.slice(recyStart, admin.indexOf('];', recyStart) + 2);
      check('the recycle sheet says how many bins to bring back',
        /key:'bins', label:'Bins'/.test(recyCols),
        'somebody fetching a two-bin house came back with one');
      /* ⚠ AND IT IS NOT THE SAME NUMBER AS THE ONE PAINTED ON THE BOX. Two different
         numbers on one row, which is why the headings spell both out. */
      /* ⚠ AND THE ROW FILLS IT. A red-check deleting the cell from whSheetRowsForRecycle
         went straight through — the column check above only proves the HEADING exists,
         and a column no row fills leaves every row short a cell and shifts the table
         under it. The same guard the build sheets already carry. */
      const recyRow = admin.slice(admin.indexOf('function whSheetRowsForRecycle('),
                                  admin.indexOf('function whSheetRowsForRecycle(') + 1600);
      check('and the recycle row fills its Bins cell',
        /bins: \(typeof whBinsForHouse/.test(recyRow),
        'a heading with nothing under it is worse than no heading');
      check('and still says which bin to look for, separately',
        /key:'bin', label:'Bin # to find'/.test(recyCols),
        'that collision has already put a wrong column on a sheet once');
      check('and the printed build sheet fills its Bins cell',
        /bins: \(typeof whBinsForHouse/.test(admin),
        'a column no row fills leaves every row short a cell');
      /* ⚠ AND THE RETIRED NOTE IS REALLY GONE, not left as a helper nothing calls —
         which this block previously warned is the most expensive kind of green. */
      check('the conditional bins note is retired, not orphaned',
        admin.indexOf('printExtraBinsNote') === -1,
        'a column and a note saying the same thing on one row is noise');
    }

    /* ⚠ EVERY GAP CARRIES ITS OWN CLOSING REGEX, and this is what keeps that true. A gap
       without one can only be closed by a person noticing and deleting it — which is not
       self-healing, it is a comment. Wiring the thing would leave the GAP line printing
       for as long as nobody looked. */
    Object.keys(SURFACES).forEach((c) => SURFACES[c].forEach((sf) => {
      Object.keys(sf.by).forEach((id) => {
        const r = sf.by[id];
        if (!r || !r.gap) return;
        check('gap ' + c + ' \u00b7 ' + id + ' can close itself', !!r.wired,
          'give it a wired regex - the one that would prove somebody had delivered it');
      });
    }));
    Object.keys(SURFACES).forEach((consumer) => {
      const declared = OPTIONS.filter(o => (o.consumers || []).indexOf(consumer) !== -1);
      check(consumer + ': the registry declares options for it', declared.length > 0,
        'an empty list here means the filter stopped matching and every check below ' +
        'is passing over nothing');
      /* ⭐ TWO KINDS OF MULTI-SURFACE DESTINATION (added 2026-08-25), and telling them
         apart is the whole reason the remaining five could be wired at all.

         'all' (the default) is a destination whose surfaces are PARALLEL COPIES of one
         another — the two warehouse build sheets, the two customer write paths. Every
         option has to be on every one of them, because a field on one and not the other
         is a gap that only shows up on whichever half nobody used.

         'any' is a destination whose surfaces are STAGES — the public quote form and
         the detail form that follows approval; the invoice document and the list that
         posts it. An option belongs to one stage, and demanding it on both would fail a
         system that is right. */
      const mode = MODES[consumer] || 'all';
      const reached = {};
      /* ⚠ A GAP RECORDED ON ONE STAGE IS A GAP FOR THE WHOLE DESTINATION. Collected
         BEFORE the surfaces are walked, or the other stage — which simply has no entry
         for an option that belongs to neither — votes it missing and the build fails on
         a question nobody has answered yet. */
      const gapped = new Set();
      SURFACES[consumer].forEach((sf) => Object.keys(sf.by).forEach((id) => {
        const r = sf.by[id];
        if (!r || !r.gap) return;
        /* ⚠ A GAP HAS TO BE ABLE TO CLOSE BY ITSELF, or the note calling it self-healing
           is a lie — which it was for about an hour. `wired` is the regex that WOULD
           prove somebody had delivered it; the moment it matches, this stops being a
           gap and becomes an ordinary check that can then FAIL if it is taken away
           again. A gap with no `wired` can only ever be closed by hand, so every one
           of them carries it. */
        if (r.wired && r.wired.test(sf.src)) return;
        gapped.add(id);
      }));
      SURFACES[consumer].forEach((surface) => {
        check(surface.name + ': its source was found', !!surface.src,
          'a gate that cannot find its target must FAIL, never skip — a whole block ' +
          'failing at once is the shape to distrust first');
        declared.forEach((o) => {
          const rule = surface.by[o.id];
          /* ⚠ A DECLARED DESTINATION NOTHING CARRIES IS A GAP, NOT AN EXCEPTION, and the
             two must never be spelled the same way. An exception is a decision somebody
             MADE — difficulty is set from Routes, so this form deliberately skips it. A
             gap is a destination the registry asks for that nothing delivers, and which
             NOBODY HAS DECIDED ABOUT. Writing one as an exception would be inventing the
             owner's answer; failing the build on it would stop every other check over a
             question only she can settle.
             Same contract as gap() in run-all.js: it reports, it does not block, and it
             self-heals to a real check the moment somebody wires it. */
          if (gapped.has(o.id)) {
            if (rule && rule.gap) gaps.push(consumer + ' · ' + o.id + ' — ' + rule.gap);
            return;
          }
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
          if (mode === 'any') {
            /* On a staged destination a surface that does not carry this option is not a
               failure — it is the wrong stage. What must be true is that ONE of them
               carries it, which is asserted once per option after the loop. */
            if (rule) reached[o.id] = reached[o.id] || (rule.gap ? rule.wired : rule).test(surface.src);
            else if (reached[o.id] === undefined) reached[o.id] = false;
            return;
          }
          check(surface.name + ': ' + o.id + ' is wired to it', !!rule,
            'the registry says ' + o.id + ' must reach ' + surface.name + ' and ' +
            'nothing says how — wire it, or take the destination off the registry');
          if (rule) {
            const probe = rule.gap ? rule.wired : rule;
            check(surface.name + ': ' + o.id + ' still reaches it', probe.test(surface.src),
              'the registry says ' + o.id + ' must reach ' + surface.name + ' and the ' +
              'real one no longer carries it — this is a truck arriving without it');
          }
        });
        /* ⚠ AND NOTHING IS WIRED THAT THE REGISTRY DOES NOT ASK FOR. A leftover rule
           is one nobody is checking, against a destination nobody declared. */
        Object.keys(surface.by).forEach((id) => {
          if (surface.by[id] && (surface.by[id].except || surface.by[id].gap)) return;   // gaps are declared for a real option by construction
          check(surface.name + ': the wiring for ' + id + ' matches a declared destination',
            declared.some(o => o.id === id),
            id + ' is wired here but the registry does not send it to the ' + consumer);
        });
      });
      /* ⚠ AND ON A STAGED DESTINATION, ONE STAGE HAS TO CARRY IT. Checked here rather
         than inside the surface loop, because "not on this one" only means something
         once every stage has been looked at. */
      if (mode === 'any') {
        declared.forEach((o) => {
          if (reached[o.id] === undefined) return;   // recorded as a gap above
          check(consumer + ': ' + o.id + ' reaches at least one stage of it',
            reached[o.id] === true,
            'the registry sends ' + o.id + ' to the ' + consumer + ' and not one of its ' +
            SURFACES[consumer].length + ' stages carries it');
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  if (gaps.length) {
    console.log('');
    console.log('  ' + gaps.length + ' declared destination(s) nothing delivers — for Addie, not bugs:');
    gaps.forEach(g => console.log('    GAP  ' + g));
    console.log('');
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
