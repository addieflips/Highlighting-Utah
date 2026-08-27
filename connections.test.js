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
let passed = 0, failed = 0, notes = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push({ name, detail });
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(msg) { notes++; console.log('  NOTE  ' + msg); }

/* A branch that predates the map must not go red — that is how a gate gets deleted. */
if (!fs.existsSync(path.join(ROOT, 'connections', 'manifest.js'))) {
  console.log('\n=== Is everything still connected? ===\n');
  note('no connections/ directory in this checkout — nothing to check');
  process.exit(0);
}

const { build } = require('./connections/build');
const { render } = require('./connections/build');

const m = build();

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

    const subtab = n => doc.querySelectorAll('.subtabs button')[n];
    subtab(1).click();
    const v = doc.getElementById('rules');
    const areas = v.querySelectorAll('.areacard').length;

    check('the Rules view draws an area card per family of rulings',
      areas > 0, 'no area cards at all, so nothing below proves anything');

    let tried = 0, opened = 0, emptyBody = 0, quoted = 0, quotedOpened = 0;
    for (let i = 0; i < areas; i++) {
      subtab(1).click();
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

    /* Confirming is the one write this view makes, and it re-renders from a key — the same
       key that was breaking. */
    const y = v.querySelector('.rev button.y');
    check('confirming a rule records who confirmed it',
      !!y && (y.click(), /Confirmed/.test(v.querySelector('.rev .lab').textContent)),
      'the confirm button re-draws from the same key the toggle uses; if the key is wrong ' +
      'this silently records nothing');

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
       read" is the state she is working towards. Reached by confirming the lot. */
    for (let i = 0; i < areas; i++) {
      subtab(1).click();
      const back = v.querySelector('.back'); if (back) back.click();
      v.querySelectorAll('.areacard')[i].click();
      const n = v.querySelectorAll('.blockbtn').length;
      for (let j = 0; j < n; j++) {
        v.querySelectorAll('.blockbtn')[j].click();
        const ok = v.querySelectorAll('.rev button.y');
        if (ok.length) ok[ok.length - 1].click();
      }
    }
    subtab(1).click();
    const back2 = v.querySelector('.back'); if (back2) back2.click();
    check('the overview survives every rule having been read',
      /Where to start/.test(v.innerHTML) && v.querySelectorAll('.areacard').length === areas,
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
        hd.querySelectorAll('.subtabs button')[1].click();
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
            check('and confirming it records against that rule, not a truncated one',
              !!yes && (yes.click(), /Confirmed/.test(
                hv.querySelector('.block.open .rev .lab').textContent)),
              'the confirm button carries the key too — truncated, it writes her decision ' +
              'under a name no row will ever ask for again');
          }
        }
        check('and the hostile page threw nothing either',
          herrs.length === 0, 'errors: ' + herrs.join(' | '));
      }
    }
  }
}

const unguarded = m.report.filter(r => !r.spine.guard).map(r => r.spine.field);
if (unguarded.length) {
  note(unguarded.length + ' of ' + m.report.length + ' watched things have nothing else guarding them: ' +
    unguarded.join(', ') + '. This map is the only thing holding those.');
}
note('watches ' + m.report.length + ' things. It cannot tell whether a connection is RIGHT, ' +
  'only whether it is there — and nothing appears here until a person declares it.');

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
