/* WHEN A BUNDLE WAS MARKED BUILT — AND WHO IS ALLOWED TO SAY SO
 * =============================================================
 * `npm run test:build-stamp` — its own file per R-018.
 *
 * Owner, 2026-08-27, on telling an already-built house apart from one that was never
 * queued: "if someone is old and they add new lights to there house they should be sent
 * to warehouse to be built if they didn't change anything than they shouldn't be sent to
 * the warehouse."
 *
 * That rule is already implemented — changing colours sets `needsLightBuild` by itself.
 * What was missing is the other half: `needsLightBuild` was a bare boolean, so a false on
 * a house built in October and a false on a house nobody ever queued read identically.
 * Check The Build Queue said so in its own words — "usually already built, or cleared by
 * mistake" — because the record genuinely did not know. `lightsMarkedBuiltAt` is that
 * missing half.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. The report's two lists read BOTH colour fields, through houseLightsText. This is
 *      the bug that was live: an ordinary house keeps its colours in `lightColors` with
 *      `lightsDescription` empty, so testing the description alone put every ordinary
 *      house in the "no colours" half — the half with no button — and the tool built to
 *      find people who fell through the gap had the documented version of that gap in it.
 *      Run for real, not read.
 *   2. Exactly two places stamp the date, and they are the two that mean "a bundle was
 *      made". Every other place that clears the flag is named here with the reason it
 *      must not stamp. A ninth clear site appearing anywhere fails this file.
 *
 * ⚠ CLAIM 2 IS A STRUCTURAL CHECK, AND THAT IS A KNOWING EXCEPTION TO R-017. Driving the
 * two warehouse writers for real needs the whole Build tab — the grouped queue, a
 * Firestore stub, the extras ledger. The claim being made is about which SOURCE
 * LOCATIONS write a literal field, which is the one shape a text check reads honestly,
 * and the census is anchored by scan.js's function indexer rather than by line numbers,
 * so it survives the file moving underneath it.
 *
 * ⚠ COMMENTS CANNOT SATISFY ANYTHING HERE. Every window goes through blankNonCode or the
 * lifted stripComments first. The explanatory comment beside each stamp CONTAINS the
 * field name, so a check reading raw source would stay green with the real write deleted.
 * scan.js learned this the same way; import-build-flag.test.js learned it again.
 *
 * ⚠ AND THE CENSUS SABOTAGES ITSELF EVERY RUN. A census that has quietly stopped matching
 * reports no violations, which is a green build for the worst possible reason.
 */

const fs = require('fs');
const path = require('path');
const scan = require('./connections/scan.js');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];

function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

/* ---------------------------------------------------------------------------
 * stripComments — LIFTED, NOT COPIED, for the same reason import-build-flag.test.js
 * lifts it: it carries fixes a fresh copy would not have, and two copies drift.
 * ------------------------------------------------------------------------- */
const stripComments = (function () {
  const suite = read('run-all.js');
  const start = suite.indexOf('const stripComments = s =>');
  if (start === -1) {
    throw new Error(
      'stripComments could not be found in run-all.js. It was lifted rather than copied ' +
      'so the two cannot drift; if it moved or was renamed, repoint this lift — do NOT ' +
      'paste a fresh copy in here.');
  }
  const end = suite.indexOf("'$1');", start);
  if (end === -1) throw new Error('stripComments was found but its end could not be located in run-all.js');
  const src = suite.slice(start, end + "'$1');".length);
  const fn = eval('(function(){ ' + src + ' return stripComments; })()');
  if (typeof fn !== 'function') throw new Error('the lifted stripComments did not evaluate to a function');
  return fn;
})();

{
  const fixture = 'a: 1, /* lightsMarkedBuiltAt: x */ b: 2, // lightsMarkedBuiltAt: x\nc: 3';
  const out = stripComments(fixture);
  check('the lifted stripComments really strips comments',
    !/lightsMarkedBuiltAt/.test(out),
    'every check below leans on this, so a strip that has stopped working makes the ' +
    'whole file pass for free');
  check('and it leaves real code alone',
    /a: 1/.test(out) && /b: 2/.test(out) && /c: 3/.test(out));
}

const adminRaw = read('admin.html');
const adminIx = scan.index(path.join(ROOT, 'admin.html'));

/* ---------------------------------------------------------------------------
 * 1. THE REPORT'S TWO LISTS, RUN FOR REAL.
 *
 * houseLightsText is lifted whole out of admin.html by the function indexer — the real
 * function, not a restatement of it — and the two filter predicates are lifted as the
 * source text that actually ships. Nothing here paraphrases the code it is testing.
 * ------------------------------------------------------------------------- */
const houseLightsText = (function () {
  const f = adminIx.fns.find(x => x.name === 'houseLightsText');
  if (!f) throw new Error('houseLightsText is no longer a named function in admin.html — repoint this lift');
  const fn = eval('(function(){ ' + adminIx.src.slice(f.start, f.end + 1) + ' return houseLightsText; })()');
  if (typeof fn !== 'function') throw new Error('the lifted houseLightsText did not evaluate to a function');
  return fn;
})();

check('the lifted houseLightsText reads BOTH colour fields',
  houseLightsText({ lightsDescription: 'Red, Green' }) === 'Red, Green' &&
  houseLightsText({ lightColors: ['Warm White', 'Red'] }) === 'Warm White, Red' &&
  houseLightsText({}) === '',
  'if this stops reading lightColors, the ordinary-house check below passes for the ' +
  'wrong reason');

const FILTERS = (function () {
  const clean = stripComments(adminRaw);
  const m = /const noLights = inSeason\.filter\([\s\S]*?\n\s*const notFlagged = inSeason\.filter\([^\n]*\n/.exec(clean);
  if (!m) {
    throw new Error(
      'the two list filters could not be found in the Check The Build Queue handler. ' +
      'They are lifted rather than restated so this file cannot pass while the page ' +
      'does something else — repoint this extraction, do not write the predicates here.');
  }
  return m[0];
})();

check('the filters were lifted from the page, not written here',
  /houseLightsText/.test(FILTERS) && /isOutForSeason/.test(FILTERS) === false,
  'the extraction should be the two filter lines only — inSeason is built above them');

const runFilters = new Function('inSeason', 'houseLightsText',
  FILTERS + '; return { noLights: noLights, notFlagged: notFlagged };');

{
  /* The house that was landing in the wrong half: colours picked, description empty,
     which system-map.md §2 calls the ORDINARY case. */
  const ordinary = { id: 'a', data: { name: 'Ordinary', lightColors: ['Warm White'], lightsDescription: '' } };
  /* A repeated pattern, where order matters, lives in the description instead. */
  const patterned = { id: 'b', data: { name: 'Patterned', lightsDescription: 'Red, Green, Red' } };
  /* Nothing anywhere — genuinely has no colours. */
  const bare = { id: 'c', data: { name: 'Bare' } };
  /* Has colours and is already queued, so belongs in neither list. */
  const queued = { id: 'd', data: { name: 'Queued', lightColors: ['Red'], needsLightBuild: true } };

  const out = runFilters([ordinary, patterned, bare, queued], houseLightsText);
  const ids = list => list.map(i => i.id).sort().join(',');

  check('an ordinary house — colours in lightColors, no description — is treated as HAVING colours',
    ids(out.notFlagged) === 'a,b',
    'it landed in: notFlagged=' + ids(out.notFlagged) + ' noLights=' + ids(out.noLights) +
    '. This is the live bug: reading lightsDescription alone put every ordinary house ' +
    'in the no-colours half, which has no repair button');
  check('and only a house with nothing in either field counts as having no colours',
    ids(out.noLights) === 'c');
  check('a house already in the queue is in neither list',
    !ids(out.notFlagged).includes('d') && !ids(out.noLights).includes('d'));
}

/* ---------------------------------------------------------------------------
 * 2. THE CENSUS — every place that clears the flag, and whether it may stamp.
 *
 * The concern this answers, in the owner's words: three sites is what was found, not a
 * proof. A ninth appearing through a path nobody read fails this check by name.
 * ------------------------------------------------------------------------- */
const CLEAR_SITES = [
  { file: 'admin.html', fn: 'renderWarehouseQueue', stamps: true,
    why: 'one house marked done — a bundle was made' },
  { file: 'admin.html', fn: 'renderWarehouseQueue', stamps: true,
    why: 'a whole colour group marked finished — bundles were made' },
  { file: 'admin.html', fn: 'editCustSaveBtn handler', stamps: false,
    why: 'Back Next Year from the Edit Customer save. Sitting the season out is not a build.' },
  { file: 'admin.html', fn: 'setCustomerSeason', stamps: false,
    why: 'the same flip, server-side of the table. Not a build.' },
  { file: 'admin.html', fn: 'setCustomerSeason', stamps: false,
    why: 'and the local copy kept in step with it. Not a build.' },
  { file: 'employee.html', fn: 'whToggleLightsNew', stamps: false,
    why: 'the crew portal tick. It IS a build, and it deliberately does not stamp — owner, ' +
         '2026-08-27, is not using the crew portal this year, so that file was left alone. ' +
         'A house ticked there reads "no build recorded". If the crew portal comes back, ' +
         'this is the first thing to fix.' },
  { file: 'functions/index.js', fn: 'portalSave', stamps: false,
    why: 'the customer cleared their own colours. Nothing to build, so nothing was built.' },
  { file: 'functions/index.js', fn: 'pullCustomerFromSeason', stamps: false,
    why: 'Maybe Next Year through the portal. Not a build.' }
];

function census(sources) {
  const found = [];
  for (const [file, raw] of Object.entries(sources)) {
    const clean = scan.blankNonCode(raw);
    const ix = scan.index(raw, true);
    const re = /needsLightBuild\s*[:=]\s*([^,;\r\n}]*)/g;
    let m;
    while ((m = re.exec(clean))) {
      const value = m[1].trim();
      if (!/false|!checked/.test(value)) continue;   // a set-ON is not a clear
      /* The object or statement this clear belongs to, ended at a real structural
         marker — the enclosing function's close — never a character count. */
      const fn = scan.enclosing(ix, m.index) || '(a handler)';
      const f = ix.fns.find(x => x.name === fn);
      const body = f ? clean.slice(f.start, f.end + 1) : clean;
      /* Same statement, not merely the same function: two clears can share a function
         and only one of them stamp. Clipped at the close of the object literal or the
         end of the statement, whichever comes first. */
      const tailEnd = clean.indexOf('}', m.index + m[0].length);
      const stmtEnd = clean.indexOf(';', m.index + m[0].length);
      const end = Math.min(tailEnd < 0 ? clean.length : tailEnd + 1,
                           stmtEnd < 0 ? clean.length : stmtEnd + 1);
      const stmt = clean.slice(Math.max(0, m.index - 300), end);
      found.push({ file, fn, stamps: /lightsMarkedBuiltAt/.test(stmt), value, bodyLen: body.length });
    }
  }
  return found;
}

const SOURCES = {
  'admin.html': adminRaw,
  'employee.html': read('employee.html'),
  'functions/index.js': read('functions/index.js')
};

const found = census(SOURCES);

check('the census still finds every place that clears the build flag',
  found.length === CLEAR_SITES.length,
  'expected ' + CLEAR_SITES.length + ', found ' + found.length + ': ' +
  found.map(f => f.file + ' · ' + f.fn).join(', ') +
  '. A census that has stopped matching reports no violations, which is the worst kind ' +
  'of green — and a NEW site here means somebody added a way to clear the flag that ' +
  'nobody has decided about.');

found.forEach(function (site, i) {
  const want = CLEAR_SITES[i];
  if (!want) return;
  check('clear site ' + (i + 1) + ' is still ' + want.file + ' · ' + want.fn,
    site.file === want.file && site.fn === want.fn,
    'found ' + site.file + ' · ' + site.fn + ' instead');
  check('  and it ' + (want.stamps ? 'stamps the build date' : 'does NOT stamp — ' + want.why),
    site.stamps === want.stamps,
    want.stamps
      ? 'a bundle was made here and nothing recorded when, which is the whole hole this closed'
      : 'this is not a build. Stamping here would put a build date on somebody who was ' +
        'never built, and the report repeats it back as fact.');
});

/* The census is worth nothing if it cannot go red. Both directions, every run: remove a
   real stamp and it must notice; leave a commented one behind and it must NOT be
   satisfied by it. */
{
  const sabotaged = adminRaw.replace(/,\s*\n\s*lightsMarkedBuiltAt: serverTimestamp\(\)\}\)/,
    '})  /* lightsMarkedBuiltAt: serverTimestamp() */');
  check('the census can actually go red',
    sabotaged !== adminRaw,
    'the sabotage pattern no longer matches the real write — repoint it, or this file ' +
    'is proving nothing');
  if (sabotaged !== adminRaw) {
    const after = census(Object.assign({}, SOURCES, { 'admin.html': sabotaged }));
    const stampsNow = after.filter(f => f.stamps).length;
    check('and a comment left where the stamp was does not satisfy it',
      stampsNow < found.filter(f => f.stamps).length,
      'with the real write removed and only a comment in its place the census still ' +
      'counted ' + stampsNow + ' stamps — a test a comment can satisfy is not testing code');
  }
}

/* ------------------------------------------------------------------------- */
console.log('');
console.log('=== When a bundle was marked built ===');
console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
