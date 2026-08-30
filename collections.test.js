/* EVERY FIRESTORE COLLECTION IS WRITTEN DOWN, AND EVERY RULE COVERS SOMETHING
 * ===========================================================================
 * `npm run test:collections` — its own file per R-018.
 *
 * `system-map.md` §4 is headed **"Every Firestore collection, one line each"**. It is the
 * document Addie is told to trust over her own memory, so a heading claiming completeness
 * is a promise. On 2026-08-30 it was missing NINE — including `routeSchedule`, which holds
 * the entire Schedule tab's saved season, and `payments` and `unmatchedPayments`, which
 * hold money.
 *
 * ⚠ NOTHING CHECKED IT, WHICH IS WHY IT DRIFTED. Every other map gate asks *"is this
 * listed thing still true?"* — so a collection never added to the table is absent from the
 * question rather than answered wrongly. This runs the other way: from the CODE back to
 * the LIST. Same direction, same day, as `portal-fields.test.js`.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. Every collection the four source files touch is named in that table.
 *   2. Every collection in `firestore.rules` is either touched in code or declared below
 *      as reserved — a rule for a collection nothing uses is either dead or a hole, and
 *      only a person can say which.
 *   3. Every collection the browser touches has a rule. A collection missing from
 *      `firestore.rules` is DENIED BY DEFAULT and fails **silently** in a listener, which
 *      renders as an empty panel rather than an error (CLAUDE.md §7). Server-only
 *      collections are exempt and must say so — the Admin SDK bypasses rules entirely.
 *
 * ⚠ AND `firestore.rules` IS NOT DEPLOYED BY CI. It needs `firebase deploy --only
 * firestore:rules` by hand, so a rule added in a commit is not a rule in production. This
 * file checks the FILE; it cannot check what is live.
 */

const fs = require('fs');
const path = require('path');

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

const SOURCES = ['admin.html', 'index.html', 'employee.html', 'functions/index.js'];
const BROWSER = new Set(['admin.html', 'index.html', 'employee.html']);

/* ---------------------------------------------------------------------------
 * WHERE THE COLLECTIONS ARE FOUND.
 *
 * Three shapes, because the repo genuinely uses all three: the modular browser SDK's
 * `collection(db,'x')` and `doc(db,'x',id)`, and the Admin SDK's `db.collection('x')`.
 * ⚠ `doc(db,'x',...)` counts: a singleton like `routeSchedule/plan` or
 * `settings/routeDigest` is still a collection, and treating it as "not a collection" is
 * how `routeSchedule` stayed off the list.
 * ------------------------------------------------------------------------- */
const PATTERNS = [
  /\bcollection\(\s*db\s*,\s*['"]([A-Za-z0-9_]+)['"]/g,
  /\bdoc\(\s*db\s*,\s*['"]([A-Za-z0-9_]+)['"]/g,
  /\bdb\s*\.collection\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g
];

const touched = new Map();          // collection -> Set(files)
SOURCES.forEach(f => {
  const src = read(f);
  PATTERNS.forEach(re => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!touched.has(m[1])) touched.set(m[1], new Set());
      touched.get(m[1]).add(f);
    }
  });
});

check('the sweep found collections in the source',
  touched.size >= 40,
  'found ' + touched.size + ' — a matcher that has quietly stopped matching reports NO ' +
  'violations, which is a green build for the worst possible reason');

/* ---------------------------------------------------------------------------
 * 1. THE MAP'S TABLE.
 * ------------------------------------------------------------------------- */
const smap = read('system-map.md');
const tStart = smap.indexOf('## 4. Every Firestore collection');
const tEnd = smap.indexOf('## 5. Routes in detail');
check('the collections table is findable in system-map.md',
  tStart !== -1 && tEnd > tStart,
  'the heading moved or was renamed — repoint this rather than deleting it');

const table = (tStart !== -1 && tEnd > tStart) ? smap.slice(tStart, tEnd) : '';
/* ⚠ THE FIRST COLUMN ONLY, NEVER THE WHOLE TABLE. The Purpose column is prose and is full
   of backticked identifiers — field names, function names, and other collections named to
   tell them apart (`scheduledRoutes` is mentioned in `routeSchedule`'s line for exactly
   that reason). Scanning the whole block would let a genuinely missing collection pass
   because some other row's description happened to mention it, which is the failure this
   whole file exists to close — and it would report field names as phantom collections,
   which is how the first draft failed. */
const namedInTable = new Set();
table.split(/\r?\n/).forEach(line => {
  if (line.charAt(0) !== '|') return;
  const first = line.split('|')[1] || '';
  if (/^\s*-+\s*$/.test(first) || /^\s*Collection\s*$/.test(first)) return;
  (first.match(/`([A-Za-z0-9_]+)`/g) || []).forEach(x => namedInTable.add(x.slice(1, -1)));
});

check('and it names a plausible number of collections',
  namedInTable.size >= 40,
  'got ' + namedInTable.size + ' — if the slice is wrong every check below is vacuous');

const unmapped = [...touched.keys()].filter(c => !namedInTable.has(c)).sort();
check('every collection the code touches is in the table',
  unmapped.length === 0,
  unmapped.map(c => c + ' (' + [...touched.get(c)].join(', ') + ')').join('; ') +
  '\n        The table is headed "Every Firestore collection". Add a line saying what it ' +
  'holds — that heading is a promise to somebody who does not read code.');

/* ---------------------------------------------------------------------------
 * 2. THE RULES FILE, BOTH WAYS.
 * ------------------------------------------------------------------------- */
const rules = read('firestore.rules');
const ruled = new Set((rules.match(/match \/([A-Za-z0-9_]+)\/\{/g) || [])
  .map(x => x.slice('match /'.length, -2)));
/* `databases` is Firestore's own wrapper path (`/databases/{database}/documents`), not a
   collection of ours. Excluded by name rather than by a pattern, so the day somebody
   really does create a collection called `databases` this says something. */
ruled.delete('databases');

check('firestore.rules parsed into rule names', ruled.size >= 30,
  'got ' + ruled.size);

/* Collections with a rule that nothing in the code touches. The table already declares
   six of these as legacy/reserved; this list is the machine-checkable half. */
const RESERVED = {
  houseMaps: 'In the rules, no usage found in any source file. Declared legacy/reserved in the table.',
  inventoryItems: 'Same — legacy/reserved.',
  smsTemplates: 'Same — legacy/reserved. SMS templates are held in settings today.',
  smsTemplateFolders: 'Same — legacy/reserved.',
  employeeMessages: 'Same — legacy/reserved. The crew portal is out of use this season.',
  teamMessages: 'Same — legacy/reserved.',
  weatherWatch: 'In the rules for the weather automation; nothing reads or writes it from the four source files today.'
};
const unusedRules = [...ruled].filter(c => !touched.has(c)).sort();
const undeclaredUnused = unusedRules.filter(c => !RESERVED[c]);
check('every rule covers a collection something uses, or is declared reserved',
  undeclaredUnused.length === 0,
  undeclaredUnused.join(', ') + '\n        A rule for a collection nothing touches is ' +
  'either dead or a hole where the code was removed and the door left open. Only a person ' +
  'can say which, so name it in RESERVED here with which.');

const staleReserved = Object.keys(RESERVED).filter(c => touched.has(c) || !ruled.has(c));
check('and no reserved entry describes something that changed',
  staleReserved.length === 0,
  'now used, or no longer in the rules: ' + staleReserved.join(', ') +
  ' — a declaration that describes nothing excuses nothing and hides the change');

/* ---------------------------------------------------------------------------
 * 3. A COLLECTION THE BROWSER TOUCHES MUST HAVE A RULE.
 *
 * ⚠ THIS IS THE ONE THAT FAILS SILENTLY. Firestore denies by default, and a denied read
 * inside `onSnapshot` does not throw where anybody sees it — the panel simply renders
 * empty. CLAUDE.md names it as the first thing to check when a list comes up blank.
 * ------------------------------------------------------------------------- */
const SERVER_ONLY = {
  portalRateLimits:
    'Written only by Cloud Functions through the Admin SDK, which bypasses rules ' +
    'entirely. Having NO rule is the correct state here: no browser should ever reach ' +
    'the sign-in attempt counters. Named in the map\'s Cloud-Functions table.'
};
const browserTouched = [...touched.keys()]
  .filter(c => [...touched.get(c)].some(f => BROWSER.has(f)));
const noRule = browserTouched.filter(c => !ruled.has(c)).sort();
check('every collection the browser touches has a rule',
  noRule.length === 0,
  noRule.join(', ') + '\n        Missing from firestore.rules means DENIED BY DEFAULT, ' +
  'and a denied listener renders an empty panel rather than an error. If it is genuinely ' +
  'server-only it should not be touched from a browser file at all.');

const serverOnlyNoRule = [...touched.keys()]
  .filter(c => !ruled.has(c) && !browserTouched.includes(c));
const undeclaredServerOnly = serverOnlyNoRule.filter(c => !SERVER_ONLY[c]);
check('and a server-only collection with no rule says why that is right',
  undeclaredServerOnly.length === 0,
  undeclaredServerOnly.join(', ') + ' — touched only by functions/index.js and absent ' +
  'from the rules. Usually correct (the Admin SDK bypasses them), but say so.');

const staleServerOnly = Object.keys(SERVER_ONLY).filter(c => !touched.has(c) || ruled.has(c));
check('and no server-only declaration has gone stale',
  staleServerOnly.length === 0,
  'no longer touched, or now has a rule: ' + staleServerOnly.join(', '));

/* ---------------------------------------------------------------------------
 * 4. THE TABLE DOES NOT INVENT COLLECTIONS EITHER.
 *
 * Weaker than the sweep above and worth having: a name in the table that is in neither
 * the code nor the rules is a line describing something that does not exist, in the
 * document somebody is told to trust.
 * ------------------------------------------------------------------------- */
const realPhantom = [...namedInTable]
  .filter(c => !touched.has(c) && !ruled.has(c) && !RESERVED[c] && !SERVER_ONLY[c])
  .sort();
check('the table does not name a collection that exists nowhere',
  realPhantom.length === 0,
  realPhantom.join(', ') + ' — in neither the code nor the rules. Either it was renamed ' +
  'and the map was not, or the line describes something that never shipped.');

/* ------------------------------------------------------------------------- */
console.log('');
console.log('=== Every Firestore collection is written down ===');
console.log('');
console.log('  ' + touched.size + ' touched in code, ' + ruled.size + ' in the rules, ' +
  namedInTable.size + ' named in system-map.md §4.');
console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
