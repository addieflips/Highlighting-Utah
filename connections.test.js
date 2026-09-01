/* IS EVERYTHING STILL CONNECTED?
 * =============================
 * `npm run test:connections` — its own file per R-018.
 *
 * Addie, asked how she should find out when the map goes red: "It fails the build."
 * So this is that. A connection somebody DECLARED, which the code no longer makes,
 * stops the merge and names itself.
 *
 * ⚠ RED FAILS. AMBER NEVER DOES. An undeclared writer is worth SEEING — it is how
 * needsLightRecycle came to be re-derived on every save — but it is not a defect, and a
 * gate that goes red every time somebody adds a legitimate reader is a gate that gets
 * disabled inside a week. Amber is printed as a note and returns exit 0.
 *
 * ⚠ IT PROVES A CONNECTION EXISTS, NOT THAT IT IS RIGHT — except where a spine declares
 * a `never`, which is narrow on purpose. The live hole in attachAddressRowHandlers was
 * exactly the difference: the writer was present and wrote the wrong value, so an
 * existence check called it green for ever. Anything needing real reasoning belongs in
 * a test, not here.
 *
 * ⚠ THE COMMITTED PAGE MUST MATCH WHAT THE MANIFEST DECLARES — its STRUCTURE, not its
 * bytes. connections.html is committed so
 * the last good dashboard stays published if generation ever breaks, which means it can
 * go stale, and a stale map reads as current. But amber counts move whenever anybody
 * touches the source at all, so comparing bytes would fail unrelated work — see §3.
 */
'use strict';
const fs = require('fs');
const path = require('path');
/* The comment mask, from the scanner rather than a second copy of it: a check that
   a comment can satisfy is the exact failure this directory exists to catch. */
const { blankNonCode } = require('./connections/scan');

const ROOT = __dirname;

/* ⚠ TAB BUTTONS ARE FOUND BY LABEL, NOT BY INDEX (2026-08-29). Adding "The path" as the
   first tab moved every index by one and this harness silently began driving the wrong
   view — on a page whose entire job is telling you when something has stopped connecting.
   Module scope because three separate blocks drive the page. */
const btnNamed = (root, name) => Array.prototype.find.call(
  root.querySelectorAll('.subtabs button'),
  b => b.textContent.trim().toLowerCase().indexOf(name) === 0);
let passed = 0, failed = 0, notes = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push({ name, detail });
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(msg) { notes++; console.log('  NOTE  ' + msg); }
/* ⚠ ANYTHING ASYNC GOES ON THIS LIST AND THE SUMMARY AWAITS IT. Saving a decision is a
   real await now, so a check written straight after the click scores BEFORE the write
   resolves — and a check that scores after the summary has printed can never fail the
   build, which is a green run for the worst possible reason. Same rule as Suite 10 of
   run-all.js, and it arrived here the same way: three checks failed on correct code the
   moment the button stopped being synchronous. */
const pendingAsync = [];
/* One turn of the microtask queue, which is all a resolved bridge promise needs. The
   frame's handler awaits exactly once before it repaints. */
const settle = () => new Promise(r => setTimeout(r, 0));

/* A branch that predates the map must not go red — that is how a gate gets deleted. */
if (!fs.existsSync(path.join(ROOT, 'connections', 'manifest.js'))) {
  console.log('\n=== Is everything still connected? ===\n');
  note('no connections/ directory in this checkout — nothing to check');
  process.exit(0);
}

const { build } = require('./connections/build');
const { render } = require('./connections/build');

/* ⚠ `write: false`, AND IT WAS MISSING — which is the very failure build()'s own comment
   warns about, in the file that comment is about: "letting it call build() would have it
   overwrite the very file it is checking, and the comparison would pass for ever."

   Two things followed from the missing argument. Every `npm test` REWROTE
   connections.html and connections.json, stamping them with whatever commit was at HEAD —
   so the tree went dirty after every merge and the stop hook fired, for ever. And worse,
   the checks below that read the committed connections.html were reading a file this line
   had just written a moment earlier, so they could not fail.

   The return value does not depend on `write` (it is built either way), so the gate loses
   nothing by not writing. Regenerating the committed page is `node connections/build.js`,
   run deliberately, which is what it was always meant to be. */
const m = build({ write: false });

/* ---------------------------------------------------------------------------
 * 1. The declared connections still exist.
 * ------------------------------------------------------------------------- */
const reds = [];
m.report.forEach(r => {
  r.rows.filter(x => !x.found).forEach(x => {
    reds.push({ field: r.spine.field, side: x.side, where: x.where, anchor: x.anchor, why: x.why, wrong: !!x.wrongValue });
  });
});

check('every declared connection is still made by the code',
  reds.length === 0,
  reds.map(r =>
    '\n          ' + r.field + ' · ' + r.where + ' · ' + r.anchor + '\n            ' + r.why +
    '\n            (' + (r.wrong
      ? 'the connection is there and does the WRONG THING — a rule this spine declares is being broken'
      : 'declared as a ' + (r.side === 'sets' ? 'writer' : 'reader') + ', and the code no longer does it') + ')'
  ).join('') +
  '\n\n        Either the code lost a connection somebody relies on, or the declaration ' +
  '\n        in connections/manifest.js is out of date. Fix whichever is actually wrong —' +
  '\n        a false red is as damaging as a missed break, because somebody goes hunting' +
  '\n        a bug that is not there.');

/* ---------------------------------------------------------------------------
 * 2. Every anchor still resolves.
 *
 * Separate from the check above on purpose. "The function was renamed" and "the function
 * is still there but stopped doing this" are different problems with different fixes,
 * and a single message covering both sends people to the wrong one.
 * ------------------------------------------------------------------------- */
const lostAnchors = reds.filter(r => /anchor itself is gone/.test(r.why));
check('every anchor still exists in the file it names',
  lostAnchors.length === 0,
  lostAnchors.map(r => '\n          ' + r.field + ' · ' + r.where + ' · ' + r.anchor).join('') +
  '\n        A renamed or moved function. Repoint the anchor in connections/manifest.js.');

/* ---------------------------------------------------------------------------
 * 3. The committed page still shows the right STRUCTURE.
 *
 * connections.html is committed so the last good dashboard stays published if generation
 * ever breaks. That means it can go stale, and a stale map reads as current, which is
 * worse than none.
 *
 * ⚠ BUT IT COMPARES THE DECLARED STRUCTURE, NOT THE WHOLE FILE — and the first version
 * compared the whole file, which broke the one rule this gate has. Amber counts move
 * whenever ANYBODY touches admin.html for any reason, so a byte comparison went red on
 * unrelated pull requests: adding one undeclared line took the gate down. A gate that
 * fails on other people's correct work is a gate somebody disables inside a week, which
 * is exactly what happened to the health-check badge.
 *
 * So: the tabs, the boxes, their names, their states and their red/green are what must
 * match. The undeclared counts are informational and are allowed to drift — they are
 * refreshed whenever anyone regenerates, and nothing depends on them being current.
 * ------------------------------------------------------------------------- */
{
  const out = path.join(ROOT, 'connections.html');
  /* Everything the manifest decides, and nothing the surrounding code happens to do. */
  /* ⚠ REPOINTED 2026-08-27 WITH THE PAGE, and the rule it follows is unchanged: compare
     what the MANIFEST decides, never the whole file. The page is now Addie's grid
     (connections/mockup.html), so the manifest-decided parts are TABS — every field, the
     record it is stored on and its square in each column — and FAULTS, the red squares.
     RULES is deliberately NOT compared: it comes from the questions map, which she edits
     directly, and a gate that went red every time she recorded a ruling is a gate that
     gets disabled inside a week. */
  const structure = html => {
    const t = /const TABS=(\{[\s\S]*?\});\nconst FAULTS=(\{[\s\S]*?\});/.exec(html);
    if (!t) return null;
    return JSON.stringify([JSON.parse(t[1]), JSON.parse(t[2])]);
  };
  if (!fs.existsSync(out)) {
    check('connections.html has been generated', false,
      'run `node connections/build.js` and commit the result');
  } else {
    const onDisk = structure(fs.readFileSync(out, 'utf8'));
    const fresh = structure(render(m));
    check('the committed page still shows what the manifest declares',
      onDisk !== null && onDisk === fresh,
      onDisk === null
        ? 'connections.html could not be parsed — regenerate it'
        : 'a spine, a box or a red/green state changed and the committed page still shows ' +
          'the old one. Run `node connections/build.js` and commit it in the same change ' +
          '— a stale map reads as current, which is worse than no map.');
  }
}

/* ---------------------------------------------------------------------------
 * 4. The manifest is worth trusting.
 *
 * A spine with no readers cannot go red for the thing that matters most: a field written
 * everywhere and read nowhere is a dead end, which is R-010's whole point.
 * ------------------------------------------------------------------------- */
m.report.forEach(r => {
  const s = r.spine;
  const sets = r.rows.filter(x => x.side === 'sets').length;
  const reads = r.rows.filter(x => x.side === 'reads').length;
  check('the ' + s.field + ' spine declares both a writer and a reader',
    sets > 0 && reads > 0,
    'declared ' + sets + ' writer(s) and ' + reads + ' reader(s). R-010: written-and-never-read ' +
    'is a dead end, read-and-never-written is a blank field. A spine missing either side ' +
    'cannot report the failure it exists for.');
});

/* ---------------------------------------------------------------------------
 * 5. The admin panel that shows it is still wired.
 *
 * Addie: "will I need to open this everytime cause if so maybe it's better if we add it
 * to admin under checklist." It began as a sub-tab of the Checklist panel and became its
 * OWN sidebar item on 2026-08-27, because she went looking for it on main and could not
 * find it — the sidebar entry reads "Checklist", so the word Connections appeared
 * nowhere until you were already inside. These hold the things that can quietly unwire
 * it, and the first of them is the one that would put it back out of reach.
 *
 * ⚠ STRUCTURAL, DELIBERATELY. Driving the real tab needs a browser, and the repo has
 * already decided against a full admin Playwright harness — "Browser tests" is a
 * REQUIRED check on main, so a slow or flaky admin spec blocks every merge. The three
 * behaviours WERE driven in Chromium while this was built, and all three sabotages below
 * were watched to fail there; these checks keep them from creeping back without adding
 * a browser to the fast suite.
 * ------------------------------------------------------------------------- */
{
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

  check('Connections is a sidebar item of its own, not a tab inside another panel',
    /data-panel="connections"/.test(admin) && /id="panel-connections"/.test(admin) &&
    />Connections</.test(admin) && !/data-projtab="connections"/.test(admin),
    'this is the whole of what she asked for. Put back as a sub-tab, nothing in the ' +
    'sidebar says the word Connections and she cannot find it — which is what happened');

  /* ⚠ ONE ELEMENT EACH. The move copied a pane into a panel; leaving the old one behind
     would be two nodes carrying one id, and getElementById returns the FIRST — so the
     summary would render into a hidden div and the panel would sit permanently empty
     with nothing anywhere reporting a fault. This repo has lost a whole modal that way. */
  ['connSummary', 'connFrame'].forEach(function (id) {
    const n = (admin.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    check('there is exactly one #' + id,
      n === 1,
      'found ' + n + '. Two nodes with one id means getElementById reaches the wrong one ' +
      'and the visible panel never fills in');
  });

  check('opening the panel is what loads the map',
    /connections:\s*\['connectionsmap'\]/.test(admin) &&
    /case 'connectionsmap': return \[projConnectionsOpen\];/.test(admin),
    'the frame gets its src from the connectionsmap group in PANEL_DATA. Without both ' +
    'halves it never gets one and the panel is permanently blank. Routed through ' +
    'PANEL_DATA rather than hardcoded in switchToAdminPanel so Suite 21 guards it too');

  check('the map is fetched once, not on every click',
    /!f\.getAttribute\('src'\)\) f\.setAttribute\('src', 'connections\.html'\)/.test(admin),
    're-assigning src on every click reloads the frame and throws away whichever box ' +
    'she had open');

  /* ⚠ AGAINST THE COMMENT-BLANKED SOURCE, AND INSIDE initData — and BOTH halves of that
     were found by red-checking, not by reading. This matched the raw file, so commenting
     the call out left the words in place and the check passed: a comment satisfying the
     check, which is the exact failure this entire directory exists to catch, reproduced
     inside its own gate. And a bare match anywhere in the file would pass on a call sitting
     in some function nobody invokes, so it is pinned to the one that runs at login. */
  const initData = (function () {
    const s = blankNonCode(admin);
    const i = s.indexOf('function initData(');
    if (i < 0) return '';
    let d = 0, k = s.indexOf('{', i);
    for (; k < s.length; k++) {
      if (s[k] === '{') d++;
      else if (s[k] === '}') { d--; if (!d) break; }
    }
    return s.slice(i, k + 1);
  })();
  check('the badge is loaded eagerly, the map is not',
    /loadConnectionsSummary\(\);/.test(initData) && !/connFrame[^]{0,200}src="connections\.html"/.test(admin),
    'a badge that only becomes right once you open the panel it is warning you about is ' +
    'not a badge; a ~25KB map fetched on every admin load is the thing ' +
    'panel-data-loads-on-open exists to stop');

  check('connections.json is generated beside the page',
    fs.existsSync(path.join(ROOT, 'connections.json')),
    'the admin badge reads it — without it the summary box reports that it could not tell, ' +
    'which is correct but useless. Run `node connections/build.js`');
}

/* ---------------------------------------------------------------------------
 * 6. The coverage list is honest.
 *
 * The page says what it does NOT watch, beside the green. Without that, "watches 8
 * things" invites somebody to read a green page as "the app is fine", which is a
 * different and much larger claim.
 *
 * ⭐ AND THE LIST CANNOT GO STALE IN THE ONE DIRECTION THAT MATTERS: if something on it
 * has since been given a spine, this fails. A list still claiming something is unwatched
 * when it is watched understates the coverage, which is the safe direction — but it also
 * means nobody trusts the list, and a list nobody trusts is the same as no list.
 * ------------------------------------------------------------------------- */
{
  const manifest = require('./connections/manifest');
  const notWatched = manifest.NOT_WATCHED || [];
  const watchedFields = m.report.map(r => r.spine.field);

  check('the page says what it does NOT watch',
    notWatched.length > 0 || watchedFields.length >= 18,
    'with nothing declared unwatched and fewer than the eighteen things worth watching, ' +
    'the page is claiming a coverage it does not have');

  const nowWatched = notWatched.filter(n =>
    n[0].split('/').map(x => x.trim()).some(f => watchedFields.indexOf(f) !== -1));
  check('nothing is listed as unwatched that now has a spine',
    nowWatched.length === 0,
    nowWatched.map(n => '\n          ' + n[0]).join('') +
    '\n        These are watched now — take them out of NOT_WATCHED in connections/manifest.js.');

  /* ⭐ AND THE FIVE DATES STAY ACCOUNTED FOR, ONE WAY OR THE OTHER (added 2026-08-29).
   * They are written by real code and read by nothing, because the customer history that
   * will read them is not built. R-010 rightly refuses a spine in that state, so they sit
   * on NOT_WATCHED instead — and a hand-written list has nothing stopping a row being
   * dropped from it. Dropped, the field is not watched AND not declared unwatched, which
   * is exactly the invisible state both halves of this page exist to prevent.
   * ⚠ NAMED, NOT COUNTED. A count cannot tell a row legitimately promoted to a spine from
   * one lost in a merge; each name must be on ONE of the two lists, and the check says
   * which is missing. When the history view reads one, it moves from the list to a spine
   * and the check above is what keeps it from being on both. */
  const DATED_STEPS = ['lightsQueuedAt', 'lightsRecycleRequestedAt', 'assignedCrewAt',
    'fixRaisedAt', 'newMemberFeeAppliedAt'];
  const accounted = f =>
    watchedFields.indexOf(f) !== -1 || notWatched.some(n => n[0].split('/').map(x => x.trim()).indexOf(f) !== -1);
  const lost = DATED_STEPS.filter(f => !accounted(f));
  check('every date the customer history will need is watched or declared unwatched',
    lost.length === 0,
    'not on either list: ' + lost.join(', ') +
    '.\n        A field nobody watches and nobody has declared unwatched is invisible — ' +
    'give it a spine once something reads it, or a NOT_WATCHED row with the reason.');

  /* ⭐ A LOOKUP TABLE IS NOT A WRITER (added 2026-08-29). The change log names every
   * editable field in a label map — `housePrice: {label: ...}` — and a scanner that reads
   * `name:` as a write counted ten of those as ten new writers of ten WATCHED fields.
   * Nothing went red, because an undeclared touch lands in amber and nothing gates amber:
   * the page simply grew ten rows that were never writes, and amber carrying rows that are
   * fine is amber nobody reads. scan.js blanks those tables; this is what stops the
   * blanking being removed silently, since the symptom is invisible to every other check.
   * ⚠ IT ASSERTS THE OUTCOME, not that the blanking code exists — a check for the constant
   * passes with the loop underneath it broken. */
  {
    const fs2 = require('fs');
    const scan2 = require('./connections/scan');
    const blanked = scan2.blankNonCode(fs2.readFileSync(path.join(ROOT, 'admin.html'), 'utf8'));
    const leaked = ['housePrice', 'customerNumber', 'rsvpStatus', 'measuredFeet']
      .filter(f => new RegExp("\\b" + f + "\\s*:\\s*(?:\\{\\s*label|'[A-Z])").test(blanked));
    check('the change log’s label table is not read as writing the fields it names',
      leaked.length === 0,
      'still visible to the scanner: ' + leaked.join(', ') +
      '.\n        Those are labels for a person, not writes — every one of them would ' +
      'appear on the page as a new place that sets a watched field.');
  }
}

/* ---------------------------------------------------------------------------
 * 7. Each nav badge has ONE writer, and a break shows without opening anything.
 *
 * These were one badge until 2026-08-27 — Connections had no sidebar item to hang one
 * on, so a break had to displace the Checklist test count, and that needed a painter
 * both sides called or whichever landed second would wipe the other. Its own item means
 * its own badge and no race at all.
 *
 * ⭐ THE GUARANTEE THAT SURVIVED THE SPLIT IS THE ONE ASSERTED LAST: the summary is
 * fetched EAGERLY and paints the badge, so a break is on the sidebar before anybody
 * clicks anything. A badge that only becomes true once you open the panel it is warning
 * you about is not a warning.
 * ------------------------------------------------------------------------- */
{
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  [['badgeProjTodo', 'paintChecklistBadge'], ['badgeConnections', 'paintConnectionsBadge']]
    .forEach(function (pair) {
      const direct = (admin.match(new RegExp("getElementById\\('" + pair[0] + "'\\)", 'g')) || []).length;
      check('only ' + pair[1] + ' writes the ' + pair[0] + ' badge',
        direct === 1 && admin.indexOf('function ' + pair[1]) > -1,
        'found ' + direct + ' places reading that badge. Two writers landing in either ' +
        'order means the loser is invisible');
    });
  /* ⚠ SLICED TO THE FUNCTION, NEVER A CHARACTER WINDOW. An earlier version of this
     check matched a bounded `[\s\S]{0,240}` — the fixed-length extraction window
     CLAUDE.md §7 bans by name — and it failed on correct code the moment the block grew
     past it. */
  const loader = (function () {
    const i = admin.indexOf('async function loadConnectionsSummary');
    if (i < 0) return '';
    let d = 0, k = admin.indexOf('{', i);
    for (; k < admin.length; k++) {
      if (admin[k] === '{') d++;
      else if (admin[k] === '}') { d--; if (!d) break; }
    }
    return admin.slice(i, k + 1);
  })();
  check('the break reaches the sidebar badge, both when it is found and when it is not',
    (loader.match(/paintConnectionsBadge\(\)/g) || []).length >= 2,
    'the summary has to paint the badge on BOTH paths. Painting only on success leaves ' +
    'a stale count standing after a failed read, which is a number claiming to know ' +
    'something it does not');
  check('the map says when its counts were last rebuilt',
    /counts last rebuilt at|rebuild date unknown/i.test(fs.readFileSync(path.join(ROOT, 'connections.html'), 'utf8')),
    'the undeclared-writer counts drift between rebuilds and nothing forces a regenerate ' +
    'for them, so the page has to say how old they are');
}

/* ---------------------------------------------------------------------------
 * 9. THE GRID AND THE RULES — Addie's mockup, drawn with real data.
 *
 * She replaced the tree with `connections/mockup.html`: one tab, two views. "Build to it,
 * do not redesign it." What can go wrong is not the look — it is the page quietly saying
 * less than it knows:
 *   a destination with no column      → a connection falls off the right-hand side
 *   a field in no area                → a whole row missing, and nothing goes red
 *   rules authored instead of derived → a second copy of her rulings, stale in weeks
 * ------------------------------------------------------------------------- */
{
  const gridMod = require('./connections/grid');
  const rulesMod = require('./connections/rules');
  const manifest = require('./connections/manifest');

  /* ⭐ EVERY DESTINATION MUST HAVE A COLUMN. A `where` that maps to nothing is a square
     that is never drawn — and an absent square and an empty one look identical, which is
     the exact invisibility this page exists to remove. */
  const orphans = gridMod.unmapped(manifest);
  check('every declared destination has a column on the grid',
    orphans.length === 0,
    'no column for: ' + orphans.join(', ') + '. Add it to WHERE_TO_DEST in connections/grid.js, ' +
    'or to DEST if it deserves a column of its own');

  /* ⚠ AND EVERY FIELD MUST BE IN AN AREA AND ON A RECORD. A spine with neither is watched
     by the engine and drawn nowhere — green in the JSON and invisible on the page. */
  const homeless = manifest.filter(s => !(s.areas && s.areas.length) || !s.record);
  check('every watched field has an area and a record',
    homeless.length === 0,
    homeless.map(s => s.field).join(', ') + ' would be checked and never drawn');

  const G = gridMod.build(m.report, manifest);
  const drawn = Object.keys(G.areas).reduce((n, a) => n + G.areas[a].rows.length, 0);
  check('and every field is drawn at least once',
    drawn >= m.report.length,
    'drew ' + drawn + ' rows for ' + m.report.length + ' watched things');

  /* ⭐ A BROKEN CONNECTION OUTRANKS A WORKING ONE IN THE SAME SQUARE. One place can both
     write and read a field; if the write is gone the square must be RED, not quietly show
     the read that still works. Run, not read — this is arithmetic about a colour. */
  {
    const rank = { bad: 4, wrn: 3, set: 2, read: 1 };
    const fake = [{ spine: { field: 'x', title: 'X', plain: '', states: [] },
      rows: [{ side: 'reads', where: 'Warehouse › Build', found: true, anchor: 'a()' },
             { side: 'sets',  where: 'Warehouse › Build', found: false, anchor: 'b()', why: 'gone' }] }];
    const out = gridMod.build(fake, [{ field: 'x', title: 'X', areas: ['Warehouse'], record: 'cust',
      sets: [], reads: [] }]);
    check('a broken connection wins the square over a working one',
      out.areas.Warehouse.rows[0].cells.Warehouse.state === 'bad',
      'got ' + out.areas.Warehouse.rows[0].cells.Warehouse.state + ' — a red hidden behind a ' +
      'green in the same square is a break nobody sees');
    check('and the ranking is the reason, not the order they happen to arrive in',
      rank.bad > rank.set && rank.set > rank.read);
  }

  /* ⭐ THE RULES ARE HERS, PARSED — NEVER AUTHORED HERE. The brief is explicit: "Humans
     write rulings; behaviour is derived." A hand-written rule on this page would be a
     second copy of the questions map, and the two would disagree within a fortnight. */
  const R = rulesMod.parse();
  check('the Rules view reads the questions map rather than holding its own copy',
    R.total > 100 && !R.missing,
    'parsed ' + R.total + ' rulings — if this is small or zero the page is either empty ' +
    'or, worse, showing rules somebody typed here');
  check('and no family of rulings is silently dropped',
    R.unknown.length === 0,
    'prefixes with no area: ' + R.unknown.join(', ') + '. Add them to AREAS in ' +
    'connections/rules.js — a whole family missing from the page is the page lying by omission');
  /* ⚠ A MISSING MAP IS A NOTE, NEVER A CRASH. A branch older than the map must still build. */
  check('a missing questions map degrades rather than throwing',
    (function () { try { const x = rulesMod.parse('/nope/nothing.md'); return x.missing === true && x.total === 0; }
                   catch (e) { return false; } })(),
    'the generator must not die on a checkout that predates the map');

  /* The page draws from that data — asserted against the built file, not the intent. */
  const page = fs.readFileSync(path.join(ROOT, 'connections.html'), 'utf8');
  check('the built page carries both views',
    /id="grid"/.test(page) && /id="rules"/.test(page) &&
    /Where things go/.test(page) && />Rules</.test(page),
    'one tab, two views — that is the whole shape of her mockup');
  check('and the legend names all four square kinds',
    /writes it/.test(page) && /reads it/.test(page) &&
    /should, doesn/.test(page) && /never agreed/.test(page),
    'a colour with no key is a colour nobody can read');
  /* ⚠ THE COVERAGE SENTENCE IS NOT DECORATION. Without it a green grid reads as "the app
     is fine", which is a far larger claim than "the fifteen things written down are
     still wired up". */
  check('and the page still says what it cannot tell you',
    /only whether it is/.test(page) && /nothing appears here until a person adds it/.test(page),
    'a green page that does not state its own limits is the most confident kind of wrong');
}

/* ---------------------------------------------------------------------------
 * Amber — reported, never fatal.
 * ------------------------------------------------------------------------- */
const amberTotal = m.report.reduce((a, r) => a + r.undeclaredTotal, 0);
if (amberTotal) {
  note(amberTotal + ' touches in code nobody declared, across ' +
    m.report.reduce((a, r) => a + r.undeclared.length, 0) + ' places. Not a failure — but an ' +
    'undeclared writer is how needsLightRecycle came to be re-derived on every save. ' +
    'Open connections.html and read them on the box they belong to.');
}
/* ---------------------------------------------------------------------------
 * 8. THE PANEL ACTUALLY OPENS — run, not read.
 *
 * Everything above is structural, and structural checks have been green over a dead
 * screen in this repo more than once: a message present in the source that could never
 * reach the page, a "bin says" input whose listener patch silently did not apply, a
 * whole strip whose four wiring calls could be deleted with the suite still green. The
 * failure here has that exact shape — an iframe with no src is a PANEL THAT OPENS
 * BLANK, identical to a working one in the markup and reported by nothing.
 *
 * So this LIFTS the four real functions out of admin.html, puts the REAL nav button and
 * REAL panel markup into jsdom, and clicks. Lifted, never stubbed: a stub of
 * ensurePanelData would keep this green through the one change that matters.
 *
 * ⚠ WHAT IT CANNOT SEE IS CSS. jsdom does no layout, so nothing here proves the panel
 * is not clipped or the iframe is not zero-high. That half is deliberately not automated
 * — the same decision recorded for the Edit Customer house tabs, for the same reason:
 * "Browser tests (Playwright)" is a REQUIRED check on main, so a slow or flaky admin
 * spec blocks every merge, and she opens admin daily so a blank panel is something she
 * sees within a minute. This holds the half that can produce a wrong answer silently.
 * ------------------------------------------------------------------------- */
{
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) {
    /* Not silent: a skipped behavioural check reads exactly like a passing one. */
    note('jsdom is not installed, so the panel was never actually opened — run `npm install`. ' +
      'The structural checks above still ran, and they have been green over a dead screen before.');
  } else {
    const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

    /* Slice to the enclosing construct, never a character count (CLAUDE.md §7). */
    function braceBlock(src, from) {
      let d = 0, k = src.indexOf('{', from);
      for (; k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}') { d--; if (!d) break; }
      }
      return src.slice(from, k + 1);
    }
    function fnFrom(name) {
      const i = admin.indexOf('function ' + name + '(');
      return i < 0 ? '' : braceBlock(admin, i);
    }

    const panelData = (function () {
      const i = admin.indexOf('const PANEL_DATA = {');
      return i < 0 ? '' : braceBlock(admin, i) + ';';
    })();
    const parts = {
      PANEL_DATA: panelData,
      switchToAdminPanel: fnFrom('switchToAdminPanel'),
      ensurePanelData: fnFrom('ensurePanelData'),
      panelDataGroup: fnFrom('panelDataGroup'),
      projConnectionsOpen: fnFrom('projConnectionsOpen')
    };
    const missing = Object.keys(parts).filter(k => !parts[k]);
    check('the four pieces of the wiring can still be found in admin.html',
      missing.length === 0,
      'could not lift: ' + missing.join(', ') + '. A harness that cannot find its target ' +
      'skips instead of failing, which is a green build for the worst possible reason');

    if (!missing.length) {
      /* The REAL markup, cut out of the real file — a hand-written fixture would pass
         whether the shipped markup is right or not. */
      const navBtn = (admin.match(/<button class="nav-item" data-panel="connections"[\s\S]*?<\/button>/) || [''])[0];
      const panelDiv = (admin.match(/<div class="panel" id="panel-connections">[\s\S]*?<iframe id="connFrame"[\s\S]*?<\/iframe>\s*<\/div>/) || [''])[0];
      check('the real nav button and the real panel were both found',
        navBtn.length > 0 && panelDiv.length > 0,
        'the harness fell back to nothing, so the click below proves nothing');

      const dom = new JSDOM('<body><div id="sidebar"></div><nav>' + navBtn + '</nav>' +
        '<div class="panel active" id="panel-quotes"></div>' + panelDiv + '</body>');
      const sandbox = {
        document: dom.window.document,
        sessionStorage: { setItem: function () {}, getItem: function () { return null; } },
        console: console
      };
      const code =
        'let initialized = true;\n' +
        'const loadedPanelGroups = new Set();\n' +
        /* Not what is under test, and not what decides this. */
        'function renderFavoritesSection(){}\n' +
        'function flushPendingRenders(){}\n' +
        parts.PANEL_DATA + '\n' + parts.panelDataGroup + '\n' + parts.ensurePanelData + '\n' +
        parts.projConnectionsOpen + '\n' + parts.switchToAdminPanel + '\n' +
        'return { go: switchToAdminPanel, groups: loadedPanelGroups };';
      const api = new Function('document', 'sessionStorage', 'console', code)(
        sandbox.document, sandbox.sessionStorage, sandbox.console);

      const frame = () => dom.window.document.getElementById('connFrame');

      check('the map is not fetched before the panel is opened',
        !frame().getAttribute('src'),
        'a ~25KB page nobody asked for, downloaded on every admin load');

      api.go('quotes');
      check('opening some OTHER panel does not fetch it either',
        !frame().getAttribute('src'),
        'the whole point of the group is that it fires for this panel and no other');

      api.go('connections');
      check('opening Connections gives the frame its src',
        frame().getAttribute('src') === 'connections.html',
        'got ' + JSON.stringify(frame().getAttribute('src')) + '. This is the failure a ' +
        'structural check cannot see: the panel opens BLANK and nothing anywhere says so');
      check('opening Connections makes the panel the active one',
        dom.window.document.getElementById('panel-connections').classList.contains('active') &&
        !dom.window.document.getElementById('panel-quotes').classList.contains('active'),
        'the panel never shows, whatever the frame is pointing at');

      /* ⚠ AND IT MUST NOT RE-SET IT. Re-assigning src reloads the frame and throws away
         whichever box she had open — so leaving and coming back would lose her place. */
      frame().setAttribute('src', 'connections.html#kept');
      api.go('quotes');
      api.go('connections');
      check('coming back to it does not reload the frame',
        frame().getAttribute('src') === 'connections.html#kept',
        'src was re-assigned on the second visit, which reloads the map and loses ' +
        'whichever box she had open');
    }
  }
}

/* ---------------------------------------------------------------------------
 * 9. THE RULES VIEW ACTUALLY OPENS A BLOCK — run, not read.
 *
 * Reported by Addie as "dropdown on rules is not working", and it was not working at
 * all: NOT ONE of the 181 blocks would open. The cause is the one this repo keeps
 * meeting from a new direction — a rule NAME is prose she wrote, so one in ten carries
 * a double quote ("soft", "available", a recorded "no"), and interpolating it raw into
 * data-k ENDED the attribute early. dataset.k came back truncated, stopped matching the
 * key drawRules() had built, and the toggle set a flag nothing read. Nothing threw.
 *
 * ⚠ SO THE CHECK ABOVE ("the built page carries both views") WAS GREEN THROUGHOUT, and
 * would be green again tomorrow: both views existed, the buttons existed, the handler
 * was bound. Every claim here is about a ROW THAT APPEARS ON SCREEN AFTER A CLICK, and
 * this repo has now been caught five times by a source check standing in for one.
 *
 * ⚠ IT CLICKS EVERY BLOCK IN EVERY AREA, not a sample. The bug bit only the names
 * carrying a quote, and a sample that happened to miss those ten would have passed on
 * the broken build — which is the vacuous-fixture trap, in the check written to close it.
 * ------------------------------------------------------------------------- */
{
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) {
    note('jsdom is not installed, so no rule block was actually opened — run `npm install`. ' +
      'The structural checks above stayed green through every block being unopenable.');
  } else {
    const dom = new JSDOM(require('./connections/build').render(), { runScripts: 'dangerously' });
    const doc = dom.window.document;
    const errs = [];
    dom.window.addEventListener('error', e => errs.push(e.message));

    /* ⚠ NAMED, NOT NUMBERED. This read `subtab(1)` and meant Rules; adding a tab in front
       made 1 mean the grid, and the checks below went looking for rule blocks in a view
       that has none. Naming it means the next tab added changes nothing here. */
    const subtab = name => btnNamed(doc, name);
    subtab('rules').click();
    const v = doc.getElementById('rules');
    const areas = v.querySelectorAll('.areacard').length;

    check('the Rules view draws an area card per family of rulings',
      areas > 0, 'no area cards at all, so nothing below proves anything');

    let tried = 0, opened = 0, emptyBody = 0, quoted = 0, quotedOpened = 0;
    for (let i = 0; i < areas; i++) {
      subtab('rules').click();
      const back = v.querySelector('.back'); if (back) back.click();
      v.querySelectorAll('.areacard')[i].click();
      const n = v.querySelectorAll('.blockbtn').length;
      for (let j = 0; j < n; j++) {
        const btn = v.querySelectorAll('.blockbtn')[j];
        const isQuoted = /["<>&]/.test(btn.dataset.k || '');
        const before = v.querySelectorAll('.block.open').length;
        btn.click();
        tried++;
        const now = v.querySelectorAll('.block.open');
        const grew = now.length === before + 1;
        if (grew) opened++;
        if (isQuoted) { quoted++; if (grew) quotedOpened++; }
        const last = now[now.length - 1];
        const body = last && last.querySelector('.body .rl li');
        if (!body) emptyBody++;
      }
    }

    check('every rule block opens when it is clicked',
      tried > 0 && opened === tried,
      tried ? (tried - opened) + ' of ' + tried + ' blocks did nothing at all when clicked. ' +
        'Check what is being interpolated into data-k — an unescaped quote in a rule name ' +
        'truncates the attribute and the key silently stops matching' : 'no blocks were found to click');

    /* ⚠ THE REGRESSION ITSELF, ASSERTED ON ITS OWN. Folded into the count above, ten bad
       names out of 181 read as a 94% pass, which is the shape of a flaky test rather than
       a broken feature — and the ten are the whole bug. */
    check('and the ones whose names carry a quote open too',
      quoted > 0 && quotedOpened === quoted,
      quoted ? (quoted - quotedOpened) + ' of the ' + quoted + ' rule names containing a ' +
        'quote or bracket failed to open' : 'no rule name in the map carries a quote any ' +
        'more, so this check can no longer see the bug it was written for — point it at ' +
        'whatever the map actually contains rather than deleting it');

    check('and every opened block shows the ruling underneath it',
      emptyBody === 0,
      emptyBody + ' blocks opened onto nothing. An empty body reads as "no ruling here", ' +
      'which is the opposite of what the row is telling her');

    /* Confirming is proved in section 10, against a page that can actually save. Here it
       is only asserted that the open row OFFERS the decision — this frame has no admin
       page behind it, so pressing it can do nothing but say so. */
    check('an opened rule offers the decision buttons',
      !!v.querySelector('.block.open .rev button.y') &&
      !!v.querySelector('.block.open .rev button.n'),
      'the ruling is readable and there is no way to say anything about it');

    /* ⚠ THE JUMP BUTTON CANNOT BE AN INLINE onclick. It was built as
       onclick="jump('<field>','<dest>')" with the field pasted between single quotes, so
       the first field name carrying an apostrophe — "Addie's own note" — is a syntax error
       in an attribute, and the button dies with no console line anybody would see. There
       are no faults in the report today, so this path has NO DATA to exercise it: the
       structural assertion is the honest half, and it says so. */
    const beh = fs.readFileSync(path.join(ROOT, 'connections', 'behaviour.js'), 'utf8');
    check('the fault link carries its target in data attributes, not an inline onclick',
      !/onclick=/.test(beh) && /data-jf=/.test(beh) && /data-jd=/.test(beh),
      'an inline onclick with a field name pasted into it breaks on the first apostrophe');

    /* Reading unread[0] blind threw and blanked the whole view, and "everything has been
       read" is the state she is working towards.
       ⚠ THIS USED TO GET THERE BY CLICKING CONFIRM 181 TIMES, and the moment those buttons
       started saving through the admin page that stopped working: this frame has no parent,
       so every click is refused and nothing is ever marked read. The check went on passing
       — against a page still showing 181 unread, which is not the state it is named after.
       It is reached the way it really happens now: an admin page that already holds a
       decision for every rule. */
    const everything = {};
    /* The suffix is not optional decoration: connections/rules.js parses ids as
       [A-Z]+-\d+[a-z]? on purpose, because a ruling superseded the same day gets
       a letter (MR-06a). This matcher did not allow one, so such a rule could
       never be pre-confirmed, "everything has been read" was unreachable, and the
       two checks below failed on a view that was working. Kept in step with the
       parser rather than guessed at. */
    const idsOf = html => (html.match(/"[A-Z]+-\d+[a-z]?"/g) || []).map(x => x.slice(1, -1));
    idsOf(require('./connections/build').render()).forEach(id => {
      everything[id] = { rule: id, verdict: 'ok', fp: '', at: '2026-08-27', by: 'addie' };
    });
    check('the harness found rule ids to pre-confirm',
      Object.keys(everything).length > 0,
      'no ids, so the all-read state below was never actually reached');
    const readAll = new JSDOM(require('./connections/build').render(),
      { runScripts: 'dangerously', beforeParse(w) {
        Object.defineProperty(w, 'parent', { configurable: true, get: () => ({
          hlxRuleDecisions: () => everything, hlxRuleDecide: () => Promise.resolve(null) }) });
      } });
    const rd = readAll.window.document;
    btnNamed(rd, 'rules').click();
    const rv = rd.getElementById('rules');
    check('every rule really does read as confirmed once the decisions are in hand',
      /0 never read/.test(rv.querySelector('.headline').textContent),
      'got ' + JSON.stringify(rv.querySelector('.headline').textContent.slice(0, 90)) +
      '. Without this the check below cannot be reaching the branch it is named after');
    check('the overview survives every rule having been read',
      /Where to start/.test(rv.innerHTML) &&
      rv.querySelectorAll('.areacard').length === areas &&
      /every rule has been read/.test(rv.querySelector('.headline').textContent),
      'the headline names the longest-unread rule; with none left unread it read past the ' +
      'end of an empty list, threw, and left the view blank');

    check('and no click anywhere in the Rules view threw',
      errs.length === 0, 'errors: ' + errs.join(' | '));

    /* -----------------------------------------------------------------------
     * The same page, driven with a hostile name.
     *
     * ⚠ EVERY OTHER CHECK ABOVE RUNS ON TODAY'S DATA, and today only the rule NAMES
     * carry a quote. So red-checking found five escaping sites — the area card, the
     * grid's field cell, the block name, the confirm buttons, the rule lines — that
     * could each be reverted with the whole suite still green, purely because no
     * value reaching them happens to contain a quote yet. The map is prose Addie
     * edits; the day one of those gains a quote is the day a screen breaks silently,
     * which is exactly how this bug arrived in the first place.
     *
     * So this renders the REAL page with one name in each position replaced by a
     * string carrying " < > & and an apostrophe, and asserts it comes back out
     * BYTE-FOR-BYTE — both through the attribute (dataset round-trip) and on screen
     * (textContent). Not a hand-written fixture: the only thing invented is the text.
     * --------------------------------------------------------------------- */
    {
      const HOSTILE = 'A "quoted" <b>name</b> & Addie' + String.fromCharCode(39) + 's own';
      const raw = require('./connections/build').render();
      const lines = raw.split('\n');
      const jsonLine = name => lines.findIndex(l => l.indexOf('const ' + name + '=') === 0);
      const dataOf = name => {
        const i = jsonLine(name);
        return i < 0 ? null : JSON.parse(lines[i].slice(('const ' + name + '=').length, -1));
      };
      const TABS = dataOf('TABS'), RULES = dataOf('RULES');
      const firstTab = TABS && Object.keys(TABS)[0];
      const firstArea = RULES && Object.keys(RULES)[0];
      const origField = firstTab && TABS[firstTab].rows.length ? TABS[firstTab].rows[0][0] : null;
      const origArea = firstArea;
      const origName = firstArea && RULES[firstArea].sections.length &&
        RULES[firstArea].sections[0][1].length ? RULES[firstArea].sections[0][1][0][0] : null;
      const origLine = origName && RULES[firstArea].sections[0][1][0][1].length
        ? RULES[firstArea].sections[0][1][0][1][0] : null;

      check('the harness could find a field, an area, a rule and a ruling to make hostile',
        !!(origField && origArea && origName && origLine),
        'the built page did not carry the shape this check drives, so nothing below ran');

      if (origField && origArea && origName && origLine) {
        /* Scoped to the emitted JSON lines only — a global replace would rewrite the
           page's own prose and prove something about the shell instead. */
        const swap = (line, from, to) =>
          line.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1));
        const hostileHtml = lines.map(l => {
          if (!/^const (TABS|RULES|CELLRULES|FAULTS)=/.test(l)) return l;
          let out = l;
          [[origField, HOSTILE + ' F'], [origArea, HOSTILE + ' A'],
           [origName, HOSTILE + ' N'], [origLine, HOSTILE + ' L']]
            .forEach(pair => { out = swap(out, pair[0], pair[1]); });
          return out;
        }).join('\n');

        const h = new JSDOM(hostileHtml, { runScripts: 'dangerously' });
        const hd = h.window.document, herrs = [];
        h.window.addEventListener('error', e => herrs.push(e.message));

        /* The grid: field name in a cell, and the same name inside data-f. */
        const fcell = hd.querySelector('#gbody td.f');
        check('a field name carrying a quote survives into the grid',
          !!fcell && fcell.textContent === HOSTILE + ' F',
          'got ' + JSON.stringify(fcell && fcell.textContent));
        const gcell = hd.querySelector('#gbody .cell[data-f]');
        check('and out of the square that has to look it back up',
          !!gcell && gcell.dataset.f === HOSTILE + ' F',
          'got ' + JSON.stringify(gcell && gcell.dataset.f) + '. A truncated data-f means ' +
          'clicking the square finds no rule and says "no rule written down for this one"');

        /* The rules view: area, block name, ruling text, and the confirm buttons. */
        btnNamed(hd, 'rules').click();
        const hv = hd.getElementById('rules');
        const card = Array.prototype.slice.call(hv.querySelectorAll('.areacard'))
          .filter(c => c.dataset.a === HOSTILE + ' A')[0];
        check('an area name carrying a quote round-trips through its card',
          !!card && card.querySelector('h3').textContent === HOSTILE + ' A',
          'the card is unopenable, or its heading is cut off at the quote');

        if (card) {
          card.click();
          const btn = Array.prototype.slice.call(hv.querySelectorAll('.blockbtn'))
            .filter(b => b.dataset.k === (HOSTILE + ' A') + '|' + (HOSTILE + ' N'))[0];
          check('a rule name carrying a quote round-trips through its key',
            !!btn && btn.querySelector('.nm').textContent === HOSTILE + ' N',
            'this is the shape of the original bug, asserted on a name that is hostile ' +
            'on purpose rather than on the ten that happen to be today');
          if (btn) {
            btn.click();
            const li = hv.querySelector('.block.open .body .rl li');
            check('and a ruling carrying a quote is shown exactly as written',
              !!li && li.textContent === HOSTILE + ' L',
              'got ' + JSON.stringify(li && li.textContent) + '. An unescaped < in a ' +
              'ruling swallows the rest of the sentence, and the row still looks fine');
            const yes = hv.querySelector('.block.open .rev button.y');
            pendingAsync.push(async () => {
              if (yes) { yes.click(); await settle(); }
              const lk = hv.querySelectorAll('.block.open .rev .locked');
              check('and confirming it acts on that rule, not a truncated one',
                !!yes && lk.length > 0 && /admin page/.test(lk[lk.length - 1].textContent),
                'the confirm button carries the key too — truncated, the handler looks up ' +
                'a rule that does not exist and falls over instead of answering');
            });
          }
        }
        check('and the hostile page threw nothing either',
          herrs.length === 0, 'errors: ' + herrs.join(' | '));
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * 10. A DECISION SHE MAKES IS KEPT — run, not read.
 *
 * Addie could press Looks right / Something's wrong and the row moved, and that was all
 * it did: gone on reload. A review tool that forgets is one she has to redo from
 * scratch, so the buttons were doing something worse than nothing — they looked like
 * progress.
 *
 * The page is a generated file in an iframe with no database of its own, so it asks the
 * admin page (same origin, an ordinary call). That gives three states that all have to
 * be right, and only one of them is the happy one:
 *   - inside admin      → saved, and it survives a reload
 *   - its own tab       → no parent, so it SAYS decisions will not stick
 *   - write refused     → the pill does NOT move, and the real error is on the row
 *
 * ⚠ THE LAST TWO ARE THE POINT. A tick that silently evaporates is exactly the class of
 * failure this whole page was built to find, and it would have been sitting inside it.
 * ------------------------------------------------------------------------- */
{
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) {
    note('jsdom is not installed, so no decision was actually saved or reloaded.');
  } else pendingAsync.push(async () => {
    const page = require('./connections/build').render();
    /* A stand-in for admin.html's two bridge functions. The REAL ones are asserted
       separately below — this half is about what the frame does with them. */
    const makeAdmin = store => ({
      hlxRuleDecisions: () => store,
      hlxRuleDecide: (id, verdict, fp, name, area) => {
        if (!id) return Promise.reject(new Error('no id'));
        const rec = { rule: id, verdict: verdict === 'flag' ? 'flag' : 'ok', fp: fp || '',
                      name: name, area: area, at: '2026-08-27', by: 'addie' };
        store[id] = rec;
        return Promise.resolve(rec);
      }
    });
    const openFrame = parent => {
      const dom = new JSDOM(page, { runScripts: 'dangerously', beforeParse(w) {
        if (parent) Object.defineProperty(w, 'parent', { get: () => parent, configurable: true });
      } });
      const d = dom.window.document;
      btnNamed(d, 'rules').click();
      const v = d.getElementById('rules');
      return { d: d, v: v, openFirst: function () {
        v.querySelector('.areacard').click();
        v.querySelector('.blockbtn').click();
        return v.querySelector('.block.open');
      } };
    };
    const pill = f => {
      const el = f.v.querySelector('.block.open .rev .lab');
      return el ? el.textContent : '';
    };
    const rowNote = f => {
      const els = f.v.querySelectorAll('.block.open .rev .locked');
      return els.length ? els[els.length - 1].textContent : '';
    };

    /* ⭐ THE COUNTS WERE ABOUT THE WRONG THING, and this is why saving was worth building
       rather than bolting on. One field carried both the ruling's standing in the
       questions map AND her review of it, so "N of M confirmed" was counting rulings
       marked Closed — which she has never looked at. Nothing was going to make that
       number move, whatever she pressed. */
    const fresh = openFrame(makeAdmin({}));
    /* ⚠ ACROSS EVERY CARD, NOT THE FIRST ONE. The first area alphabetically happens to
       hold no rulings marked Closed, so it reads "0 of 4" whether the bug is there or
       not — the red-check caught this check passing on the broken code. Eight rulings in
       the map ARE Closed, so the total is what bites. */
    const cards = Array.prototype.slice.call(fresh.v.querySelectorAll('.areacard .of'));
    const totals = cards.map(c => (c.textContent.match(/^(\d+) of (\d+)/) || []).slice(1).map(Number));
    const confirmed = totals.reduce((a, t) => a + (t[0] || 0), 0);
    const ruleCount = totals.reduce((a, t) => a + (t[1] || 0), 0);
    check('no rule counts as confirmed until she has actually confirmed it',
      cards.length > 0 && ruleCount > 0 && confirmed === 0,
      confirmed + ' of ' + ruleCount + ' already read as confirmed with no decision saved ' +
      'anywhere. This counts HER review now, not the ruling’s standing in the map — two ' +
      'different facts that were one field until 2026-08-27, which made the page claim ' +
      'work was done that nobody had done');
    const head = fresh.v.querySelector('.headline').textContent;
    const unread = Number((head.match(/(\d+) never read/) || [])[1]);
    check('and the overview counts every one of them as never read',
      unread === ruleCount,
      'headline says ' + unread + ' never read out of ' + ruleCount + ' rules. Her ' +
      'starting point is that number; anything less is the page telling her somebody ' +
      'has already been through part of the map');

    /* Saved, and still there next time. */
    const store = {};
    const f1 = openFrame(makeAdmin(store));
    f1.openFirst();
    f1.v.querySelector('.rev button.y').click();
    await settle();
    const saved = Object.keys(store)[0];
    check('confirming a rule writes a decision',
      !!saved && store[saved].verdict === 'ok',
      'nothing reached the admin page, so the tick is lost on reload — which is the ' +
      'state this whole section exists to end');
    check('and the decision names the rule by its id, not by its wording',
      !!saved && /^[A-Z]+-\d+$/.test(saved),
      'got ' + JSON.stringify(saved) + '. Keyed on the wording, editing a ruling orphans ' +
      'the decision instead of lapsing it');
    check('and carries a fingerprint of the wording she confirmed',
      !!saved && !!store[saved].fp,
      'without it a rewritten ruling keeps her old tick, which is the tick vouching for ' +
      'text she has never read');

    const f2 = openFrame(makeAdmin(store));
    f2.openFirst();
    check('and it is still confirmed when she comes back',
      /Confirmed/.test(pill(f2)),
      'got ' + JSON.stringify(pill(f2)) + '. Saved and not read back is the same as not saved');

    /* ⭐ AND IT EXPIRES WHEN THE RULING IS REWRITTEN. */
    const moved = {};
    Object.keys(store).forEach(k => { moved[k] = Object.assign({}, store[k], { fp: 'SOMETHINGELSE' }); });
    const f3 = openFrame(makeAdmin(moved));
    f3.openFirst();
    check('a ruling rewritten since she confirmed it reads as changed, not confirmed',
      /Changed since confirmed/.test(pill(f3)),
      'got ' + JSON.stringify(pill(f3)) + '. Still-confirmed is her vouching for words ' +
      'she has never seen; back-to-never-read loses that she ever looked');

    /* ⚠ REFUSED. This is what a missing firestore.rules entry looks like from the page. */
    const f4 = openFrame({ hlxRuleDecisions: () => ({}),
      hlxRuleDecide: () => Promise.reject(new Error('Missing or insufficient permissions')) });
    f4.openFirst();
    f4.v.querySelector('.rev button.y').click();
    await settle();
    check('a refused write leaves the rule exactly as it was',
      /Not reviewed/.test(pill(f4)),
      'got ' + JSON.stringify(pill(f4)) + '. A pill that moves on a write the database ' +
      'refused is the row lying, and she finds it unread again tomorrow');
    check('and says so on the row, with the real reason',
      /Could not save/.test(rowNote(f4)) && /permissions/.test(rowNote(f4)),
      'got ' + JSON.stringify(rowNote(f4)) + '. "Nothing should fail quietly" — and a ' +
      'refused rule write is exactly the case that reads as the button not working');

    /* ⚠ ITS OWN TAB. There is no parent to ask, and it must not pretend otherwise. */
    const f5 = openFrame(null);
    f5.openFirst();
    f5.v.querySelector('.rev button.y').click();
    await settle();
    check('opened in its own tab it says decisions will not stick there',
      /Not reviewed/.test(pill(f5)) && /admin page/.test(rowNote(f5)),
      'pill ' + JSON.stringify(pill(f5)) + ', note ' + JSON.stringify(rowNote(f5)) +
      '. The page is reachable full screen on purpose; taking a decision it cannot keep ' +
      'is worse than a button that is honest about being off');
  });
}

/* ---------------------------------------------------------------------------
 * 11. THE ADMIN HALF OF THAT BRIDGE, AND ITS RULE.
 *
 * ⚠ THE FRAME CHECKS ABOVE USE A STAND-IN, so every one of them stays green with the
 * real functions deleted from admin.html — the same shape as the Edit Customer house
 * tabs, where the four wiring calls could be removed with the whole suite passing.
 * ------------------------------------------------------------------------- */
{
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('admin.html defines both halves of the bridge the frame calls',
    /window\.hlxRuleDecide\s*=/.test(admin) && /window\.hlxRuleDecisions\s*=/.test(admin),
    'the frame asks window.parent for these by name; without them every decision falls ' +
    'into the "opened in its own tab" branch and nothing is ever saved');
  check('and reads the saved decisions eagerly, beside the health-check ones',
    /loadRuleDecisions\(\);/.test(admin.slice(admin.indexOf('loadHcDecisions();'),
      admin.indexOf('loadHcDecisions();') + 600)),
    'the frame asks for these while it loads and can be opened before any panel group ' +
    'has run — loaded later, every rule she confirmed reads as never-read');
  check('and the write is awaited before the record is handed back',
    /await setDoc\(doc\(db,'ruleDecisions'/.test(admin),
    'returning before the write lands is what lets the frame paint a decision that was ' +
    'refused');

  /* ⚠ NOT DEPLOYED BY CI. A collection missing from firestore.rules is denied by default,
     so this file being right is necessary and not sufficient — it still needs a hand
     deploy. The row now says so on screen when it happens, which is the half that is
     under our control. */
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  check('firestore.rules knows about the collection those decisions go in',
    /match \/ruleDecisions\/\{id\}/.test(rules),
    'a collection with no rule is denied by default and fails SILENTLY in a listener, ' +
    'so every decision would look saved and none would be');
}

const unguarded = m.report.filter(r => !r.spine.guard).map(r => r.spine.field);
if (unguarded.length) {
  note(unguarded.length + ' of ' + m.report.length + ' watched things have nothing else guarding them: ' +
    unguarded.join(', ') + '. This map is the only thing holding those.');
}
/* ---------------------------------------------------------------------------
 * NO SPINE DECLARES THE SAME KEY TWICE.
 *
 * ⚠ FOUND BY MAKING THE MISTAKE, 2026-08-31. Declaring the Invoices area added a second
 * `ignore:` to the `deposit` spine, and in a JavaScript object literal the later key
 * silently wins — so the first exclusion list read as active and did nothing at all.
 * An exclusion that looks present and is discarded is the exact shape of fault this whole
 * page exists to catch, occurring in the page's own data.
 *
 * ⚠ AND NOTHING WOULD HAVE SAID SO. The map went on building, the counts moved in the
 * direction they were expected to move, and every other check passed. It is only visible
 * by reading the source of the object, which is what this does.
 * ------------------------------------------------------------------------- */
{
  const mSrc = require('fs').readFileSync(require('path').join(__dirname, 'connections/manifest.js'), 'utf8');
  const dupes = [];
  const fieldRe = /field: '([A-Za-z0-9_]+)'/g;
  let fm;
  while ((fm = fieldRe.exec(mSrc)) !== null) {
    /* The spine object this field belongs to, by brace matching back from the name. */
    const start = mSrc.lastIndexOf('{', fm.index);
    let depth = 0, end = start;
    for (let i = start; i < mSrc.length; i++) {
      if (mSrc[i] === '{') depth++;
      else if (mSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const blk = mSrc.slice(start, end + 1);
    /* Only keys at the spine's own indentation — a nested object's `rules:` is not this. */
    ['ignore', 'sets', 'reads', 'field', 'areas', 'record', 'title', 'plain', 'guard', 'states']
      .forEach(k => {
        const n = (blk.match(new RegExp('^\\s{4}' + k + ':', 'gm')) || []).length;
        if (n > 1) dupes.push(fm[1] + ' declares ' + k + ' ' + n + ' times');
      });
  }
  check('no spine declares the same key twice',
    dupes.length === 0,
    ': ' + dupes.join('; ') + ' — in a JavaScript object literal the LATER key wins and ' +
    'the earlier one is discarded silently, so an exclusion list or a whole sets/reads ' +
    'block can read as active and do nothing.');
}

/* ---------------------------------------------------------------------------
 * A TOUCH ON SOMEBODY ELSE'S RECORD IS NOT A TOUCH ON THIS ONE.
 *
 * Addie, 2026-08-31, picking five areas to work through after being told there were 760
 * undeclared touches. Measuring them first showed the number was badly inflated:
 * `status` alone reported 184, and its list was `ccRenderCardList`, `ccStatusColor`,
 * `approveTimeOffRequest`, `renderExpensesList` — the status of a credit-card
 * transaction, a time-off request, an expense. Half a dozen collections in this app have
 * a field called `status`, and `hits()` knows nothing about records.
 *
 * `otherRecord()` drops a touch only when the function around it names OTHER collections
 * and never names this field's own. These checks hold the two properties that make that
 * safe: it really does drop the known-false ones, and "cannot tell" really does mean keep.
 * ------------------------------------------------------------------------- */
{
  const eng = require('./connections/engine.js');
  const sc = require('./connections/scan.js');

  check('the engine can tell one record from another',
    typeof eng.otherRecord === 'function',
    ': the filter is not exported, so nothing below is testing the shipped rule');

  if (typeof eng.otherRecord === 'function') {
    const mk = src => sc.index(src, true);

    /* A function that names another collection and never this field's own. */
    const away = mk('function renderExpensesList(){ const s = getDocs(collection(db,"expenses")); ' +
      'rows.forEach(function(r){ r.status = "paid"; }); }');
    check('a quote field touched inside an expenses function is not a quote touch',
      eng.otherRecord({ x: away }, away, away.src.indexOf('r.status'), { record: 'quote' }),
      ': this is the 184 — a page whose amber carries known-false rows is a page nobody ' +
      'works through');

    /* The same function, but it does name quotes. */
    const home = mk('function fixQuote(){ const q = collection(db,"quotes"); ' +
      'const s = getDocs(collection(db,"expenses")); q.status = "new"; }');
    check('and one that names quotes as well is kept',
      !eng.otherRecord({ x: home }, home, home.src.indexOf('q.status'), { record: 'quote' }),
      ': a function touching both records really might be doing both');

    /* ⚠ THE SAFE DIRECTION, TWICE. A false drop makes a real connection invisible, which
       is the failure this whole page exists to prevent; a false keep is one more amber
       row. So both "cannot tell" cases are asserted rather than assumed. */
    const bare = mk('function ccStatusColor(v){ return v.status === "ok" ? "green" : "red"; }');
    check('a function that names no collection at all is kept',
      !eng.otherRecord({ x: bare }, bare, bare.src.indexOf('v.status'), { record: 'quote' }),
      ': naming no collection means we cannot tell, and cannot-tell must mean keep');

    const loose = mk('const s = getDocs(collection(db,"expenses"));\nthing.status = 1;\n');
    check('and a touch outside any named function is kept',
      !eng.otherRecord({ x: loose }, loose, loose.src.indexOf('thing.status'), { record: 'quote' }),
      ': a great deal of this codebase lives in anonymous handlers, and dropping those ' +
      'would hide real connections wholesale');

    const unknown = mk('function f(){ const s = getDocs(collection(db,"expenses")); r.status = 1; }');
    check('and a spine on a record the filter has never heard of is kept',
      !eng.otherRecord({ x: unknown }, unknown, unknown.src.indexOf('r.status'), { record: 'somethingNew' }),
      ': a new record type must not silently start hiding its own connections');
  }

  /* ⭐ AND THE ENGINE ACTUALLY CALLS IT. Asserted separately from the rule, because the
     red-check proved it was not: every check above passed with the call deleted, so the
     filter would have been perfectly correct and completely unused. That is the shape
     this repo has shipped more than once — a working helper nothing calls — and here it
     would have left the 184 phantom rows on the page while the tests said the fix was in.

     ⚠ RUN AGAINST THE REAL REPORT, and named by the function it must have dropped:
     `renderExpensesList` reads an EXPENSE's status and named quotes nowhere, so it must
     not appear on the quote spine's amber list. */
  {
    const quoteSpine = m.report.filter(r => r.spine.field === 'status')[0];
    check('and the report really is filtered by it',
      !!quoteSpine && !(quoteSpine.undeclared || []).some(u => /renderExpensesList|ccRenderCardList|approveTimeOffRequest/.test(u)),
      ': an expense, a credit-card transaction and a time-off request are still being ' +
      'counted as touches on a QUOTE\'s status — the filter exists but nothing is using it');
    check('and it has not swallowed the whole list',
      !!quoteSpine && quoteSpine.undeclaredTotal > 20,
      ': got ' + ((quoteSpine || {}).undeclaredTotal) + ' — a filter that drops nearly ' +
      'everything is hiding real connections, which is worse than the noise it removes');
  }

  /* ⭐ AND A LOCAL DECLARATION IS NOT A WRITE TO THE RECORD.
     `const completed = !!d.completed` reads the field and names a local after it;
     `let deposit = 0` names one after a field it never touches. Both matched `= ` and were
     counted as WRITERS — 45 across the map, and they are the worst kind of amber because
     they sit inside functions that genuinely do handle the right record, so no amount of
     record-sniffing can see them.
     ⚠ RUN, not read: the claim is about what `hits()` returns. */
  {
    const sc2 = require('./connections/scan.js');
    const mk = src => sc2.index(src, true);
    const dec = mk('function f(d){ const completed = !!d.completed; return completed; }');
    const kinds = eng.hits(dec, 'completed').map(h => h.kind);
    check('a local named after a field is not counted as writing it',
      kinds.indexOf('set') === -1,
      ': got ' + JSON.stringify(kinds) + ' — a const can never write to a record');
    check('but the read beside it is still counted',
      kinds.indexOf('read') !== -1,
      ': got ' + JSON.stringify(kinds) + ' — dropping the read would hide a real connection, ' +
      'which is the failure this page exists to prevent');

    const real = mk('function g(d){ d.completed = true; }');
    check('and a real write is still a write',
      eng.hits(real, 'completed').some(h => h.kind === 'set'),
      ': the rule must not swallow the thing it is filtering around');

    /* ⭐ A COLON AFTER A PROPERTY ACCESS IS A TERNARY, NOT AN OBJECT KEY.
       `d.completed ? 'a' : 'b'` leaves the field followed by ` : ` and used to be counted
       as a WRITE — ten across the map, in the more misleading direction, because a
       phantom writer on a money field is exactly what somebody would investigate.
       ⚠ AND THE OBVIOUS FIX WAS WRONG. Deciding "property access ⇒ read" FIRST broke
       twenty real declarations in one go: every `updates.field = value` in the app became
       a read. Both directions are asserted here because the ordering looks right either
       way round and is only correct one of them. */
    /* ⚠ THE FIXTURE HAS TO PUT THE FIELD IMMEDIATELY BEFORE THE COLON, which is the
       shape the real code takes: `cond ? 'text ' + d.field : 'other'`. The first version
       put it before the QUESTION MARK, where it is followed by ` ?` and never reaches the
       colon branch at all — so the red-check reported a MISS against a check that was
       never in danger. */
    const tern = mk("function t(d){ return d.on ? 'yes ' + d.completed : 'no'; }");
    check('a ternary colon after a property is a read, not a write',
      eng.hits(tern, 'completed').every(h => h.kind !== 'set'),
      ': got ' + JSON.stringify(eng.hits(tern, 'completed').map(h => h.kind)));
    const propWrite = mk('function w(u){ u.completed = true; }');
    check('but assigning to a property is still a write',
      eng.hits(propWrite, 'completed').some(h => h.kind === 'set'),
      ': this is the half the first attempt broke — twenty declarations at once');
    const objKey = mk('function o(){ return { completed: true }; }');
    check('and a real object key is still a write',
      eng.hits(objKey, 'completed').some(h => h.kind === 'set'),
      ': most writes in this app are object literals handed to updateDoc');

    /* ⭐ A KNOWN LIMIT, TURNED INTO A GATE RATHER THAN LEFT AS A COMMENT.
       `const {completed} = d` produces NO hit at all — not a write, and not a read either:
       `hits()` decides a read from the character before the name, and `{` is not one of
       them. So a field pulled out by destructuring is INVISIBLE to this whole map.

       ⚠ THAT IS PRE-EXISTING, NOT SOMETHING THE local-declaration RULE INTRODUCED, and it
       was found by writing a check that assumed the opposite. Measured against the real
       files it happens ZERO times today — this codebase does not read record fields that
       way — so building for it would be building for nothing.

       ⚠ WHAT IS GATED IS THE ASSUMPTION. If somebody ever does start destructuring a
       watched field, this goes red and a person decides whether to teach the matcher or
       to declare it by hand. Left as a comment it would be a silent hole the day the
       style changed, which is exactly the shape of thing this page exists to catch. */
    const destr = mk('function h(d){ const {completed} = d; return completed; }');
    check('destructuring is still invisible to the matcher, as recorded',
      eng.hits(destr, 'completed').length === 0,
      ': it now returns ' + JSON.stringify(eng.hits(destr, 'completed').map(h => h.kind)) +
      ' — if the matcher has learned this, delete this check and the note beside it');

    const sc3 = require('./connections/scan.js');
    const files = { admin: 'admin.html', server: 'functions/index.js',
                    index: 'index.html', employee: 'employee.html' };
    const destructured = [];
    m.report.forEach(sp => {
      Object.keys(files).forEach(fk => {
        const I = sc3.index(require('path').join(__dirname, files[fk]));
        const re = new RegExp('\\{[^{}\\n]{0,120}\\b' + sp.spine.field + '\\b[^{}\\n]{0,120}\\}\\s*=', 'g');
        let mm;
        while ((mm = re.exec(I.blanked))) {
          destructured.push(sp.spine.field + ' · ' + fk + ' · ' + (sc3.enclosing(I, mm.index) || '(a handler)'));
        }
      });
    });
    check('and no watched field is actually read that way in the real files',
      destructured.length === 0,
      ': ' + [...new Set(destructured)].join(', ') + ' — these reads are invisible to the ' +
      'map, so that box is green on a connection nothing can see. Teach hits() or declare ' +
      'them by hand, but do not leave them.');
  }

  /* ⚠ AND THE COLLECTION LIST IS READ OUT OF THE SOURCE, never written down. A hard-coded
     list goes stale the day somebody adds a collection — and stale in the SILENT
     direction: the new collection stops counting as "another record", so its fields start
     appearing as false amber on somebody else's spine. */
  const engSrc = require('fs').readFileSync(require('path').join(__dirname, 'connections/engine.js'), 'utf8');
  check('the collections it compares against are read out of the code',
    /function collectionsIn\(ix\)/.test(engSrc) && /ix\[fk\]\.src/.test(engSrc),
    ': a hard-coded collection list would go stale silently');
}

/* ---------------------------------------------------------------------------
 * WHAT RUNS WITHOUT ANYBODY PRESSING ANYTHING — the code back to the list.
 *
 * Addie, 2026-08-30: "I think where things go does not have a complete representation of
 * the automation. There is still things missing there." She was right: the only automatic
 * run with a place on the page was the 7pm billing, and Automation Emails was folded into
 * the Portal column.
 *
 * ⚠ NOTHING COULD HAVE CAUGHT THAT. Every check on this page asks "is the declared thing
 * still connected", so a run nobody declared is absent from the question rather than
 * answered wrongly — the same blind spot found three times in three days. This sweeps the
 * SOURCE for scheduled and interval-driven work and requires each one to be on the list.
 *
 * ⚠ IT CANNOT CHECK THE PROSE, and that is said out loud rather than implied. What a run
 * is FOR and what it would cost if it stopped are a person's job; what rots is the list
 * falling behind the code, and that is the half held here.
 * ------------------------------------------------------------------------- */
{
  const { AUTOMATION } = require('./connections/automation.js');
  const readSrc = f => require('fs').readFileSync(require('path').join(__dirname, f), 'utf8');
  const listed = new Set(AUTOMATION.map(a => a.id));

  check('the automation list is not empty', AUTOMATION.length > 0,
    ': a list that failed to load reports no violations, which is a green build for the ' +
    'worst possible reason');

  /* Cloud Functions scheduled by cron. `exports.NAME = onSchedule(` is the only shape
     this repo uses, and a new one written differently would not be found — so the count
     is asserted too rather than trusting the pattern alone. */
  const fns = readSrc('functions/index.js');
  const crons = (fns.match(/exports\.(\w+)\s*=\s*onSchedule\(/g) || [])
    .map(x => x.replace(/exports\.(\w+).*/s, '$1'));
  check('every scheduled Cloud Function is on the automation list',
    crons.length > 0 && crons.every(c => listed.has(c)),
    ': found ' + crons.length + ' — missing from connections/automation.js: ' +
    crons.filter(c => !listed.has(c)).join(', '));

  /* Browser timers. `setInterval` assigned to a named variable is what a long-lived
     automatic run looks like here; an anonymous one-off is not that. */
  const timerIds = [];
  ['admin.html', 'index.html', 'employee.html'].forEach(f => {
    const src = readSrc(f);
    const re = /(\w+)\s*=\s*setInterval\(/g;
    let mm;
    while ((mm = re.exec(src)) !== null) timerIds.push(mm[1]);
  });
  /* ⚠ NOT EVERY setInterval IS AN AUTOMATIC PROCESS, and the difference is whether it
     cancels itself. A retry that gives up after eight tries is a loading detail, not
     something that runs by itself all season, and putting it on a list headed "what runs
     without anybody pressing anything" would be padding a page whose whole value is that
     it is true. Each exclusion names WHY, and a stale one fails below. */
  const NOT_AUTOMATION = {
    frameTimer:
      'Self-cancelling. It re-frames the house in Street View while the measure tool is ' +
      'opening and clears itself after eight tries or on the first success — a loading ' +
      'retry, not a process.'
  };
  const unlistedTimers = [...new Set(timerIds)]
    .filter(t => !listed.has(t) && !NOT_AUTOMATION[t]);
  check('every named browser timer is on the automation list',
    timerIds.length > 0 && unlistedTimers.length === 0,
    ': found ' + timerIds.length + ' — missing from connections/automation.js: ' +
    unlistedTimers.join(', ') + '. A timer that runs and is not drawn is exactly the ' +
    '"still things missing" this list was written for.');
  const staleExcl = Object.keys(NOT_AUTOMATION).filter(t => timerIds.indexOf(t) === -1);
  check('and no timer exclusion names something that is gone',
    staleExcl.length === 0,
    ': ' + staleExcl.join(', ') + ' — an exception that describes nothing excuses nothing');

  /* ⭐ AND AN ANONYMOUS LONG-LIVED TIMER IS REFUSED OUTRIGHT. The sweep above finds a
     timer by the variable it is assigned to, so `setInterval(function(){…}, 600000)` with
     no name is invisible to it — which is exactly what the ten-minute re-read of the
     nightly billing log was: the one alarm on the most expensive automatic run in the
     app, unfindable by the list that exists to say what runs by itself. Naming it is a
     one-word change; being unable to see it is not.
     ⚠ THE THRESHOLD IS THE POINT. A short anonymous interval is an animation or a poll
     that finishes; a minute or more is something that runs all day. */
  const anon = [];
  ['admin.html', 'index.html', 'employee.html'].forEach(f => {
    const src = readSrc(f);
    const re = /(^|[^\w.])setInterval\(/g;
    let mm;
    while ((mm = re.exec(src)) !== null) {
      const before = src.slice(Math.max(0, mm.index - 40), mm.index + mm[0].length);
      if (/[\w$]\s*=\s*setInterval\($/.test(before)) continue;   // named, handled above
      /* How long between ticks, read off the call's own last argument. */
      const tail = src.slice(mm.index, mm.index + 900);
      const ms = /,\s*([0-9][0-9_ *]*)\s*\)/.exec(tail);
      let every = 0;
      if (ms) { try { every = Function('return (' + ms[1] + ')')(); } catch (e) { every = 0; } }
      if (every >= 60000) anon.push(f + ' @' + every + 'ms');
    }
  });
  check('no long-lived timer is anonymous',
    anon.length === 0,
    ': ' + anon.join(', ') + ' — an unnamed interval cannot be matched to a row on the ' +
    'automation list, so it runs and the page that says what runs cannot see it. Assign ' +
    'it to a variable and add the row.');

  /* And the other direction: a row describing something that no longer exists. */
  const allSrc = ['functions/index.js', 'admin.html', 'index.html', 'employee.html']
    .map(readSrc).join('\n');
  const ghosts = AUTOMATION.filter(a => allSrc.indexOf(a.id) === -1).map(a => a.id);
  check('and no row on the list describes a run that is gone',
    ghosts.length === 0,
    ': ' + ghosts.join(', ') + ' — a row nothing matches excuses nothing and hides the ' +
    'rename, which is how a list that looks complete stops being it');

  /* Every row says the four things that make it worth reading. A row with a blank
     "if it stopped" is the one nobody can act on, and it is the reason for the list. */
  AUTOMATION.forEach(a => {
    check('the ' + a.title + ' row says when it runs and what it would cost',
      !!a.when && !!a.does && !!a.ifItStopped && typeof a.watched === 'boolean',
      ': what a timer does is guessable from its name; what it costs when it silently ' +
      'stops is not, and every one of these fails quietly');
  });

  note('names ' + AUTOMATION.length + ' automatic runs, ' +
    AUTOMATION.filter(a => !a.watched).length + ' of them not watched by the grid.');
}

/* ---------------------------------------------------------------------------
 * ONE PEDIGREE PER TAB — six views of one graph, never six graphs.
 *
 * Addie, 2026-08-30: "make a pedigree branch for each of the following tabs". The whole
 * safety of doing that is that each tab names steps that ALREADY EXIST, so a step cannot
 * say one thing on the full path and another on its own tab. Six diagrams that drift
 * apart would be worse than the one.
 * ------------------------------------------------------------------------- */
{
  const { STEPS, TAB_ROOTS } = require('./connections/journey.js');
  const byId = {};
  STEPS.forEach(st => { byId[st.id] = st; });

  check('all six tabs Addie named have a pedigree',
    ['Quote', 'Customers', 'Routes', 'Schedule', 'Warehouse', 'Invoices']
      .every(t => TAB_ROOTS.some(r => r.tab === t)),
    ': got ' + TAB_ROOTS.map(r => r.tab).join(', '));

  TAB_ROOTS.forEach(t => {
    check('the ' + t.tab + ' tab starts at a step that exists', !!byId[t.root],
      ': "' + t.root + '" is not in STEPS — a tab rooted at a step nobody wrote is a ' +
      'button that opens an empty page');
    check('and it hands off to a step that exists', !!byId[t.handOff],
      ': "' + t.handOff + '" is not in STEPS');
    check('and it says what it is for', !!t.blurb && t.blurb.length > 20,
      ': a tab door with no blurb is six identical buttons');
  });

  /* ⚠ THE FIRST VERSION OF THIS CHECKED REACHABILITY AND IT WAS VACUOUS — the red-check
     caught it. This graph is densely cyclic (a re-quote goes back to the quote email,
     back-next-year returns to the RSVP), so almost every step reaches almost every other
     and pointing the Warehouse's hand-off at `quote` sailed straight through. Kept as a
     note rather than quietly deleted, because "walk the graph" reads like the rigorous
     answer and here it proves nothing.

     ⭐ THE REAL CLAIM IS A CHAIN. "This tab's work ends at X" means X is where the NEXT
     tab picks up, so each hand-off must be the following tab's root — and the last one
     must simply be a step that exists. That is checkable, and it is what makes the six
     views one journey rather than six disconnected diagrams.

     ⚠ AND THE ORDER IS THE ORDER WORK REALLY HAPPENS IN, not the order Addie listed the
     tabs. She wrote Quote, Costumers, Routes, Schedule, Warehouse, Invoices; a bundle is
     built before a day is planned and a day is planned before a crew is given a sheet, so
     Warehouse and Schedule sit ahead of Routes here. If that ever stops being true the
     chain breaks loudly rather than the page quietly describing a season nobody works. */
  TAB_ROOTS.forEach((t, i) => {
    const nextTab = TAB_ROOTS[i + 1];
    if (!nextTab) {
      check('the last tab hands off to a step that exists', !!byId[t.handOff],
        ': "' + t.handOff + '" is not in STEPS');
      return;
    }
    check('the ' + t.tab + ' tab hands off to where ' + nextTab.tab + ' begins',
      t.handOff === nextTab.root,
      ': it says its work ends at "' + t.handOff + '" but ' + nextTab.tab +
      ' starts at "' + nextTab.root + '" — the six views are meant to be one journey, ' +
      'and a hand-off pointing anywhere else leaves a gap nobody owns');
  });

  /* And the whole graph, checked once here rather than trusted: every edge points at a
     real step, every step is reachable from a door, and nothing dead-ends without saying
     it is an ending. */
  const bad = [];
  STEPS.forEach(st => (st.next || []).forEach(e => { if (!byId[e.to]) bad.push(st.id + ' → ' + e.to); }));
  check('every step on the path points at a step that exists', bad.length === 0, ': ' + bad.join(', '));

  const reached = new Set();
  const queue = STEPS.filter(st => st.start).map(st => st.id);
  while (queue.length) {
    const id = queue.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    ((byId[id] || {}).next || []).forEach(e => queue.push(e.to));
  }
  const orphans = STEPS.filter(st => !reached.has(st.id)).map(st => st.id);
  check('and every step can be reached from one of the doors', orphans.length === 0,
    ': ' + orphans.join(', ') + ' — a step nobody can walk to is on the page and in ' +
    'nobody\'s path');

  const silentEnds = STEPS.filter(st => !(st.next || []).length && !st.end).map(st => st.id);
  check('and nothing stops without saying it is an ending', silentEnds.length === 0,
    ': ' + silentEnds.join(', ') + ' — a step that just runs out reads as a page that ' +
    'failed to draw the rest');

  /* ⭐ AND THE RETURNING CUSTOMER HAS A DOOR OF THEIR OWN. Addie: "for old costumers are
     starting point is just at RSVP". Asserted by name, because the whole point is that
     the ~960 people already on the books can start their season somewhere rather than
     only as a footnote to somebody else's first one. */
  check('a returning customer can start at the RSVP',
    STEPS.some(st => st.id === 'rsvpasked' && st.start),
    ': rsvpasked is not a start — the returning path is only reachable by walking the ' +
    'whole first-season path from a quote');
  check('and the RSVP step is dated',
    (byId.rsvpasked || {}).records && byId.rsvpasked.records.indexOf('rsvpSentAt') !== -1,
    ': the send stamps rsvpSentAt, and that stamp is what decides whether anybody may be ' +
    'dropped for not answering — a step that important showing no trace is its own finding');

  note('draws ' + STEPS.length + ' steps, ' + STEPS.filter(st => st.start).length +
    ' ways in and ' + TAB_ROOTS.length + ' tab views of the same graph.');
}

note('watches ' + m.report.length + ' things. It cannot tell whether a connection is RIGHT, ' +
  'only whether it is there — and nothing appears here until a person declares it.');

(async function summary() {
  for (const job of pendingAsync) {
    try { await job(); }
    catch (err) { check('an async section of this suite crashed', false, ': ' + (err && err.stack || err)); }
  }
  console.log('');
  console.log('=== Is everything still connected? ===');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.detail ? f.detail : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
  process.exit(failed ? 1 : 0);
})();
