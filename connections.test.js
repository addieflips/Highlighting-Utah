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
    reds.push({ field: r.spine.field, side: x.side, where: x.where, why: x.why, wrong: !!x.wrongValue });
  });
});

check('every declared connection is still made by the code',
  reds.length === 0,
  reds.map(r =>
    '\n          ' + r.field + ' · ' + r.where + '\n            ' + r.why +
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
  lostAnchors.map(r => '\n          ' + r.field + ' · ' + r.where).join('') +
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
  const structure = html => {
    const m = /const N=(\{[\s\S]*?\});\nconst ROOTS=(\{[\s\S]*?\});/.exec(html);
    if (!m) return null;
    const strip = o => JSON.parse(JSON.stringify(o, (k, v) =>
      (k === 'undeclared' || k === 'also') ? undefined : v));
    return JSON.stringify([strip(JSON.parse(m[1])), JSON.parse(m[2])]);
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
 * Amber — reported, never fatal.
 * ------------------------------------------------------------------------- */
const amberTotal = m.report.reduce((a, r) => a + r.undeclaredTotal, 0);
if (amberTotal) {
  note(amberTotal + ' touches in code nobody declared, across ' +
    m.report.reduce((a, r) => a + r.undeclared.length, 0) + ' places. Not a failure — but an ' +
    'undeclared writer is how needsLightRecycle came to be re-derived on every save. ' +
    'Open connections.html and read them on the box they belong to.');
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
