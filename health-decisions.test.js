/* APPROVE AND DENY ON A HEALTH-CHECK FINDING
 * =========================================
 * Addie, 2026-08-21, decided and never built until now: "I want to be able to approve or
 * deny it. But after approve it can auto write" — and the deny is PER MEMBER: "I should
 * be able to choose what member I'm denying for and approve for all other members if we
 * run into that situation." Questions map HC-01 and HC-02.
 *
 * ⭐ WHY IT MATTERS MORE THAN IT LOOKS. 2026-08-26: "I don't check health check very
 * often cause the design is weird and I can't mark anything as completed or outside of
 * policy." Completed is Fix this one; outside of policy is Not a problem. Without them a
 * standing finding — sharedPhone alone is 14 genuine households — nagged for ever, the
 * badge could never reach nought, and a panel whose number never moves is one nobody
 * opens. So this is not a convenience: it is the whole difference between a panel she
 * reads and a panel she does not.
 *
 * ⚠ RUN, NOT READ. Every claim here is about a number on a badge or a row on a screen,
 * and this repo has been caught five times by a source check that was green over a dead
 * screen.
 *
 * ⚠ ITS OWN FILE, per R-018.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name); }
}

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
function fnOf(n) {
  for (const p of ['function ' + n + '(', 'async function ' + n + '(']) {
    const i = admin.indexOf(p);
    if (i < 0) continue;
    let d = 0, k = admin.indexOf('{', i);
    for (; k < admin.length; k++) {
      if (admin[k] === '{') d++;
      else if (admin[k] === '}') { d--; if (!d) return admin.slice(i, k + 1); }
    }
  }
  return '';
}

console.log('\n=== Approve and deny on a health-check finding ===\n');

/* ---------------------------------------------------------------------------
 * 1. The fingerprint. This is the whole of "not until the data changes".
 * ------------------------------------------------------------------------- */
const keySrc = fnOf('hcFindingKey');
check('the fingerprint is there to run', !!keySrc, 'a gate that cannot find its target must FAIL, never skip');

if (keySrc) {
  const key = new Function(keySrc + 'return hcFindingKey;')();
  const jane   = { label: 'Jane Doe', detail: '1 Elm St · $150 on a zeroed invoice' };
  const janeV2 = { label: 'Jane Doe', detail: '1 Elm St · $300 on a zeroed invoice' };
  const sam    = { label: 'Sam Roe',  detail: '1 Elm St · $150 on a zeroed invoice' };

  check('the same finding always gives the same key',
    key('strandedPayment', jane) === key('strandedPayment', jane),
    'an unstable key means a decision that never matches again — every denial lasts one render');
  /* ⭐ HER RULING, IN ONE CHECK. "Not until the data changes." */
  check('when that customer\'s values move, the finding comes back',
    key('strandedPayment', jane) !== key('strandedPayment', janeV2),
    'a denial that survives the data changing is a real problem hidden for ever, which is ' +
    'worse than the nagging it replaced');
  /* ⭐ AND THE OTHER HALF: "I should be able to choose what member I'm denying for." */
  check('and denying one member does not deny another',
    key('strandedPayment', jane) !== key('strandedPayment', sam),
    'one answer covering everybody is the blanket exception she specifically ruled against');
  check('the same person on a different check is a different decision',
    key('strandedPayment', jane) !== key('townIsStreet', jane),
    'approving a phantom town must not also approve a stranded payment');
  check('and the key is legal as a Firestore document id',
    /^[A-Za-z0-9_]+$/.test(key('strandedPayment', jane)) && key('strandedPayment', jane).length < 120,
    'got ' + JSON.stringify(key('strandedPayment', jane)));
}

/* ---------------------------------------------------------------------------
 * 2. The panel. A denied finding leaves the count, the badge and the list.
 * ------------------------------------------------------------------------- */
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
if (!JSDOM) {
  console.log('  NOTE  jsdom is not installed, so the panel was never drawn — run `npm install`.');
} else {
  const dom = new JSDOM('<body><input type="checkbox" id="hcHideClean">' +
    '<span id="badgeHealth"></span><div id="hcResults"></div></body>');
  const doc = dom.window.document;
  const decisions = {};
  const checks = [{
    id: 'strandedPayment', title: 'A payment on an invoice that bills nothing',
    why: 'why', fix: null, fixNote: 'note',
    rows: [
      { label: 'Jane Doe', detail: '1 Elm St · $150' },
      { label: 'Sam Roe',  detail: '2 Oak Ave · $80' }
    ]
  }];
  const api = new Function('document', 'hcLastChecks', 'HC_DECISIONS',
    fnOf('esc') + fnOf('hcFindingKey') + fnOf('hcDecisionFor') + fnOf('hcRender') +
    'return {render: hcRender, key: hcFindingKey};')(doc, checks, decisions);

  api.render();
  check('both findings are counted before anything is decided',
    doc.getElementById('badgeHealth').textContent === '2',
    'badge read ' + JSON.stringify(doc.getElementById('badgeHealth').textContent));
  check('and each row offers a way to say it is not a problem',
    doc.querySelectorAll('[data-hcno]').length === 2,
    'found ' + doc.querySelectorAll('[data-hcno]').length + ' — a finding with no way to ' +
    'rule on it is the panel she stopped opening');
  /* ⚠ NO Fix this one WHERE THERE IS NO FIX. Nineteen of the twenty-five checks are
     judgement calls with nothing to run; offering a button that writes nothing would be
     a lie about what pressing it does. */
  check('and no fix button where the check has no fix',
    doc.querySelectorAll('[data-hcok]').length === 0,
    'strandedPayment is fix: null on purpose — only a person can decide it');

  /* Deny Jane, exactly as the handler does. */
  decisions[api.key('strandedPayment', checks[0].rows[0])] = { verdict: 'denied' };
  api.render();
  check('denying one finding takes it off the badge',
    doc.getElementById('badgeHealth').textContent === '1',
    'badge read ' + JSON.stringify(doc.getElementById('badgeHealth').textContent) +
    ' — a number that cannot go down is why the panel stopped being read');
  const shown = doc.getElementById('hcResults').textContent;
  check('and off the list',
    shown.indexOf('Jane Doe') === -1 && shown.indexOf('Sam Roe') !== -1,
    'the denied row is still drawn, or the wrong one went');
  /* ⚠ SAID OUT LOUD, NEVER JUST SUBTRACTED. A panel that quietly holds things back is
     the same failure as one that nags: she cannot tell a clean book from a hidden one. */
  check('and the panel says how many it is holding back',
    /1 finding is marked/.test(shown.replace(/\s+/g, ' ')),
    'a silent subtraction makes a hidden problem look like a clean book');

  /* ⭐ AND THE BADGE CAN REACH NOUGHT, which it never could before. */
  decisions[api.key('strandedPayment', checks[0].rows[1])] = { verdict: 'denied' };
  api.render();
  check('ruling on everything gets the badge to nought',
    doc.getElementById('badgeHealth').textContent === '0' ||
    doc.getElementById('badgeHealth').style.display === 'none',
    'sharedPhone alone is 14 genuine households — a badge that can never reach nought is ' +
    'one nobody reads');
}

/* ---------------------------------------------------------------------------
 * 3. The wiring, and the two things that would make it lie.
 * ------------------------------------------------------------------------- */
check('the decisions are loaded eagerly, with the other badge loaders',
  /loadHcDecisions\(\);/.test(admin.replace(/\/\*[\s\S]*?\*\//g, '')),
  'a badge that is only right once you open the panel is not a badge');
/* ⚠ BOTH PRESENT, THEN IN ORDER — and the first version of this checked only the order,
   which passes when the fix call is ABSENT because indexOf returns -1 and -1 is less than
   everything. A red-check that deleted the fix entirely sailed through it. */
{
  const decide = fnOf('hcDecide');
  const fixAt = decide.indexOf('hcFixRow'), setAt = decide.indexOf('setDoc');
  check('the decision is written only after the fix succeeded',
    fixAt > -1 && setAt > -1 && fixAt < setAt,
    'approve runs the fix at ' + fixAt + ' and records at ' + setAt + '. Recorded first, ' +
    'a failed write leaves a finding marked dealt with that nothing has dealt with — and ' +
    'a missing fix call means approve quietly writes nothing at all');
}
/* ⚠ THE ROW IS INDEXED INTO THE LIST BEING DRAWN. Indexing into c.rows would point at a
   different finding the moment anything above it was denied — a button acting on
   somebody else, which on a check WITH a fix is a write to the wrong record. */
check('the row buttons index into the list actually drawn',
  /c\.open\.slice\(0, 100\)\.forEach\(function \(?r, ri\)?/.test(admin) ||
  /c\.open\.slice\(0, 100\)\.forEach\(function\(r, ri\)/.test(admin),
  'indexing into the unfiltered list points at the wrong customer once anything is denied');
check('and the collection is staff-only in the rules',
  /match \/healthCheckDecisions\/\{id\}\s*\{ allow read, write: if request\.auth != null; \}/
    .test(fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')),
  'a collection missing from firestore.rules is denied by default and fails SILENTLY in ' +
  'a listener — every decision would look saved and none would be');

console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
