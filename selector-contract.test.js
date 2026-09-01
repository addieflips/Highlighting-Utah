/*
 * Selector contract test — Highlighting Utah
 *
 * WHY THIS EXISTS
 * A browser spec that targets #someId which no longer exists does not fail
 * with "that id is gone" — it fails with a twenty-second timeout and a
 * screenshot of a page that looks fine. The cause is buried and the run is
 * slow. This catches it in milliseconds, with the id named, before any browser
 * starts.
 *
 * It also means a rename in admin.html or index.html breaks the build at the
 * point of the rename, rather than the next time someone runs the browser
 * suite — which is the whole idea behind treating a selector as a contract
 * (CLAUDE.md §9.3).
 *
 * It reads the #id and [data-testid] selectors out of every tests/*.spec.js
 * and checks each one exists in the HTML file that spec drives.
 *
 * Run:  node selector-contract.test.js      (or: npm run test:selectors)
 * Needs no browser, so it runs anywhere — including in this repo's CI.
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');

/* The specs folder. Accepts either name — the repo currently uses test/, but
 * tests/ is equally valid and both have been used. Resolving it rather than
 * hard-coding one means a folder rename never silently empties this check
 * (an empty run reporting "0 failed" is the exact false green to avoid). */
const TESTS_DIR = ['tests', 'test']
  .map(d => path.join(ROOT, d))
  .find(d => fs.existsSync(d)) || path.join(ROOT, 'tests');

/* Which HTML file a spec drives, by filename. Add a row when a new spec file
 * appears; an unmapped spec is reported rather than silently skipped. */
const SPEC_TARGETS = {
  'portal.spec.js': 'index.html',
  'quote-link.spec.js': 'index.html',
  'rsvp-link.spec.js': 'index.html',
  'signed-in-links.spec.js': 'index.html',
  'rsvp-gate-code.spec.js': 'index.html',
  'arrears-portal.spec.js': 'index.html',
  'rsvp-arrears.spec.js': 'index.html',
  'button-contrast.spec.js': 'index.html',
  'public.spec.js': 'index.html',
  'admin.spec.js': 'admin.html',
  'crew.spec.js': 'employee.html'
};

/* Ids that legitimately do not appear as a literal id="..." in the HTML —
 * because the page creates them at runtime. Each needs a reason. */
const RUNTIME_IDS = {
  // (none yet — add as "id": "why it is created at runtime")
};

/* ⭐ IDS A SPEC NAMES IN ORDER TO PROVE THEY ARE GONE (added 2026-09-01).
 *
 * A spec that asserts an element was REMOVED has to name its id, and this gate
 * would otherwise read that as a broken selector — the one case where "the id
 * is not in the page" is exactly what the spec is checking.
 *
 * ⚠ NOT RUNTIME_IDS. That means "created at runtime, so it will never appear in
 * the HTML"; these are the opposite — deleted on purpose and required to stay
 * deleted. Filing them there would be a true-looking entry that says something
 * false, and the next person to read it would go looking for code that builds
 * them.
 *
 * ⚠ EACH ONE CARRIES WHY IT WENT, so a future session that wants the element
 * back has the argument in front of it rather than only its absence. */
const REMOVED_IDS = {
  qrPanel: 'the Venmo QR code, deleted 2026-09-01 — a ~30KB base64 image shipped ' +
           'to every customer on every load, which asked them to type the amount ' +
           'in themselves. Addie: "I don\'t want a venmo QR code anymore."',
  paypalOrNote: 'the "— or pay with Venmo —" divider, deleted 2026-09-01. It ' +
                'announced Venmo as an equal alternative, which is the opposite ' +
                'of the last resort Addie asked for.'
};

/* Same idea for data-testid. These are created by a test double rather than
 * living in the page, so they will never appear in the HTML — but they are
 * still real contracts, just owned by tests/firebase-stub.js instead. Each
 * needs a reason, so an unexplained entry stands out as a mistake. */
const RUNTIME_TESTIDS = {
  'paypal-fake-button':
    'rendered by the fake PayPal SDK in tests/firebase-stub.js. The real SDK ' +
    'is never fetched (paypal.com is blocked), so this button cannot exist in ' +
    'index.html — the page renders it THROUGH the double at runtime.'
};

let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) pass++;
  else { fail++; failures.push(label + (detail ? '\n        ' + detail : '')); }
}

/* Pull id="x" out of an HTML file. Handles single and double quotes. */
function idsIn(html) {
  const out = new Set();
  const re = /\bid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return out;
}

function testIdsIn(html) {
  const out = new Set();
  const re = /\bdata-testid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) out.add(m[1]);
  return out;
}

/* Pull the selectors a spec uses. Deliberately narrow: only the forms this
 * project is allowed to use (#id and data-testid, per §9.3). If a spec starts
 * using a CSS descendant chain, that is a review problem, not this file's. */
function selectorsIn(spec) {
  const ids = new Set(), testIds = new Set();

  // page.locator('#thing'), page.locator("#thing"), '#thing .child'
  const locRe = /locator\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = locRe.exec(spec)) !== null) {
    const sel = m[1];
    const idMatch = /^#([A-Za-z][\w-]*)/.exec(sel.trim());
    if (idMatch) ids.add(idMatch[1]);
  }

  // page.fill('#thing', ...), page.click('#thing')
  const actionRe = /\.(?:fill|click|check|selectOption|type|press|focus|hover)\(\s*['"`]#([A-Za-z][\w-]*)/g;
  while ((m = actionRe.exec(spec)) !== null) ids.add(m[1]);

  // getByTestId('thing')
  const testIdRe = /getByTestId\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = testIdRe.exec(spec)) !== null) testIds.add(m[1]);

  return { ids, testIds };
}

console.log('\n=== Selector contract: do the ids the browser tests use exist? ===\n');

if (!fs.existsSync(TESTS_DIR)) {
  console.log('  no tests/ folder yet — nothing to check\n');
  console.log('0 passed, 0 failed\n');
  process.exit(0);
}

const specFiles = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.spec.js'));

if (!specFiles.length) {
  console.log('  no *.spec.js files yet — nothing to check\n');
  console.log('0 passed, 0 failed\n');
  process.exit(0);
}

const htmlCache = {};
function htmlFor(file) {
  if (!htmlCache[file]) {
    const p = path.join(ROOT, file);
    htmlCache[file] = {
      ids: idsIn(fs.readFileSync(p, 'utf8')),
      testIds: testIdsIn(fs.readFileSync(p, 'utf8'))
    };
  }
  return htmlCache[file];
}

/* ⭐ A SPEC FILE THAT HOLDS NO SPECS (added 2026-08-24, after it happened).
 *
 * ⚠ THE ACCIDENT THIS CATCHES. test/portal.spec.js was overwritten with a jsdom
 * script — its own header still named the file it came from — and the ten Member
 * Portal specs inside it were gone. NOTHING WENT RED. Playwright found no test()
 * calls, silently collected 3 specs instead of 13 and reported success; this file
 * found no selectors to check and dropped from 18 checks to 1, also reporting
 * success. Two required gates passing because there was nothing left to check is
 * worse than either failing, because a red gate gets looked at.
 *
 * ⚠ COUNTED, NOT JUST PRESENT. "The file exists" was always true. What was not
 * true is that it still contained tests, so that is what is asserted.
 *
 * ⚠ AND A SPEC WITH NO SELECTORS IS ONLY A NOTE, deliberately — a spec can
 * legitimately drive a page by visible text alone. An empty spec FILE cannot. */
specFiles.forEach(specFile => {
  const body = fs.readFileSync(path.join(TESTS_DIR, specFile), 'utf8');
  const testCount = (body.match(/(^|\s)test\s*\(/g) || []).length;
  check(specFile + ' still contains browser tests', testCount > 0,
    'the file is there but has no test() calls — Playwright will collect it, ' +
    'find nothing, and report success. That is how ten portal specs went ' +
    'missing on 2026-08-24 with every gate still green');

  const target = SPEC_TARGETS[specFile];

  if (!target) {
    check(specFile + ' is mapped to an HTML file', false,
      'add "' + specFile + '" to SPEC_TARGETS in this file, or its selectors go unchecked');
    return;
  }

  const spec = fs.readFileSync(path.join(TESTS_DIR, specFile), 'utf8');
  const { ids, testIds } = selectorsIn(spec);
  const target_ = htmlFor(target);

  ids.forEach(id => {
    const removed = Object.prototype.hasOwnProperty.call(REMOVED_IDS, id);
    /* An id listed as REMOVED must be ABSENT — if it comes back, the spec
       asserting its absence is now lying and this says so. */
    if (removed) {
      check(specFile + ' → #' + id + ' is still gone from ' + target,
        !target_.ids.has(id),
        'this id is in REMOVED_IDS, so a spec asserts it no longer exists — but it is ' +
        'back in the page. Either the removal was undone (drop the REMOVED_IDS entry ' +
        'and the spec) or something re-added it by accident.');
      return;
    }
    const known = target_.ids.has(id) || Object.prototype.hasOwnProperty.call(RUNTIME_IDS, id);
    check(specFile + ' → #' + id + ' exists in ' + target,
      known,
      known ? '' :
        'no id="' + id + '" in ' + target + '. Either the element was renamed ' +
        '(fix the spec) or it is built at runtime (add it to RUNTIME_IDS with a reason).');
  });

  testIds.forEach(t => {
    check(specFile + ' → [data-testid="' + t + '"] exists in ' + target,
      target_.testIds.has(t) || Object.prototype.hasOwnProperty.call(RUNTIME_TESTIDS, t),
      'no data-testid="' + t + '" in ' + target + ' — add it to the element, ' +
      'or fix the spec. A testid is a contract (CLAUDE.md §9.3).');
  });

  if (!ids.size && !testIds.size) {
    console.log('  note  ' + specFile + ' uses no id or testid selectors — nothing to verify here');
  }
});

failures.forEach(f => console.log('  FAIL  ' + f + '\n'));
if (!failures.length) console.log('  PASS  every id used by a browser spec exists in its page\n');

console.log(pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('A browser test is pointing at something that is not there.');
  console.log('Fix it here — chasing it as a 20-second Playwright timeout is far slower.\n');
}

process.exit(fail ? 1 : 0);
