/*
 * ⭐⭐ THE HEADLINE RULES, AND THE GUARD ON THE GUARDS  (2026-09-21, [[SCH-85]], [[SCH-86]])
 *
 * Dax, 2026-09-21, after both were live:
 *   "perfect make sure that that is permanent and no code can change this system"
 *
 * The two rules:
 *   1. SCH-85 — every Confirmed customer is on a day after ⚙ Recalculate everything.
 *   2. SCH-86 — All Customers shows the Schedule's day, fresh on every press, and a
 *      Schedule day is never called "not on the schedule".
 *
 * run-all.js Suites 346 and 347 PROVE both rules by running the real code. What they
 * cannot do is protect THEMSELVES: delete a suite, or quietly drop its checks, and
 * run-all.js goes on printing "Safe to push" — a gate removed is a gate that passes.
 * This file is the lock on those two suites. It fails the build when:
 *   - either suite, or enough of its checks, disappears from run-all.js;
 *   - the code that makes each rule true is removed or unwired in admin.html;
 *   - either headline leaves the top of CLAUDE.md, or either ruling leaves the map;
 *   - this file, or run-all.js, is taken out of `npm test` or out of CI.
 *
 * ⛔ IF THIS GOES RED, THE CHANGE IS WRONG, NOT THIS FILE. The only legitimate way to
 * change either rule is Dax or Addie changing their mind, recorded as a NEW ruling that
 * supersedes SCH-85 / SCH-86 in claude/questions-map.md — and then this file is edited
 * in that same commit, saying so.
 *
 * ⚠ COMMENTS ARE STRIPPED before the code checks, so a comment NAMING a function can
 * never stand in for the function (the trap Suites 58, 274, 275 and 300 each learned).
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(title, ok, why) {
  if (ok) { pass++; console.log('  PASS  ' + title); }
  else { fail++; fails.push(title); console.log('  FAIL  ' + title + (why ? '\n          ' + why : '')); }
}
/* Strip // and /* *\/ comments, leaving strings alone well enough for these checks. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}
/* The body of a top-level `function NAME(`, cut at the next top-level function. */
function fnBody(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) return '';
  const next = src.indexOf('\nfunction ', at + 10);
  return src.slice(at, next === -1 ? src.length : next);
}

const admin = stripComments(read('admin.html'));
const runAll = read('run-all.js');
const claude = read('CLAUDE.md');
const qmap = read('claude/questions-map.md');
const pkg = JSON.parse(read('package.json'));
const ci = read('.github/workflows/tests.yml');

console.log('\n=== The headline rules are still enforced ===');

/* ---- 1. the proofs are still there, and still whole ---- */
const count = id => (runAll.match(new RegExp("check\\('" + id + "'", 'g')) || []).length;
check('run-all.js still holds Suite 346 (every Confirmed = scheduled)',
  /suite\('Suite 346\. HEADLINE: every Confirmed customer is on a day/.test(runAll));
check('and its checks have not been thinned out (at least 13)',
  count('S346') >= 13, 'found ' + count('S346') + ' — a suite with its teeth pulled still prints PASS');
check('run-all.js still holds Suite 347 (All Customers shows the Schedule\'s day)',
  /suite\('Suite 347\. HEADLINE: All Customers shows the Schedule/.test(runAll));
check('and its checks have not been thinned out (at least 10)',
  count('S347') >= 10, 'found ' + count('S347'));
check('Suite 346 still breaks the rules on purpose (the gated customersMissingFromSeason)',
  /customersMissingFromSeason=function\(\)\{return __realMissing\(\)\.filter/.test(runAll),
  'without the sabotage the suite only proves today\'s rules, not that NO rule can drop somebody');

/* ---- 2. SCH-85: the enforcer exists and is wired at both exits ---- */
const rebuild = fnBody(admin, 'rebuildSeasonDays');
const net = fnBody(admin, 'placeConfirmedLeftOff');
check('placeConfirmedLeftOff exists', !!net);
check('rebuildSeasonDays calls it at BOTH building exits',
  (rebuild.match(/placeConfirmedLeftOff\(floorStr,\s*startStr\)/g) || []).length === 2,
  'the empty-build exit and the normal exit each need one');
check('it decides who by the Confirmed badge (confirmedNotOnAnyDay) and nothing else',
  /confirmedNotOnAnyDay\(\)/.test(net) && !/isOutForSeason|rsvpStatus|needsLightBuild/.test(net));
check('and it actually puts the house on a day',
  /day\.houses\.push\(h\)/.test(net));
check('confirmedNotOnAnyDay still asks the badge the office reads',
  /seasonBadgeKey\(d\)\s*!==\s*'confirmed'/.test(fnBody(admin, 'confirmedNotOnAnyDay')));
check('customersMissingFromSeason has not grown a new gate beyond the season rule',
  (fnBody(admin, 'customersMissingFromSeason').match(/\breturn;/g) || []).length <= 2,
  'a bare `return;` in there is how SCH-48\'s silent drops happened — move them LATER, never OFF');

/* ---- 3. SCH-86: All Customers reads the Schedule, every press ---- */
const nextVisit = fnBody(admin, 'nextVisitFor');
const chip = fnBody(admin, 'nextVisitChip');
check('nextVisitFor reads the Schedule first (planHangDateFor)',
  /planHangDateFor\(custId\)/.test(nextVisit));
check('and records where the date came from',
  /fromPlan:\s*planned\s*!==\s*null/.test(nextVisit));
check('a Schedule day is never asked whether it is "real" by the crew routes',
  /const orphan = !v\.fromPlan && scheduledDayIsReal\(/.test(chip));
check('the status word reads the Schedule too',
  /planHangDateFor\(custId\)/.test(fnBody(admin, 'allCustRouteStatus')));
check('every press of the All Customers tab redraws the table',
  /if\(tabName === 'all'\) renderAllCustomersTable\(\);/.test(admin));
check('every draw follows the saved Schedule',
  /function renderAllCustomersTable\(\)\{[\s\S]{0,400}window\.scheduleFollowPlanForReaders\(\)/.test(admin));
check('and every change to the Schedule (Recalculate included) tells All Customers',
  /function renderAll\(\)\{[\s\S]*?window\.schedulePlanChanged\(\);\}/.test(admin));

/* ---- 4. the words that tell the next person ---- */
const top = claude.slice(0, claude.indexOf('## ⭐ R-023'));
check('CLAUDE.md still opens with the Confirmed = scheduled headline',
  /HEADLINE RULE — EVERY CONFIRMED CUSTOMER IS SCHEDULED/.test(top),
  'it must stay ABOVE R-023, where every session reads it first');
check('and with the All Customers headline',
  /HEADLINE RULE — ALL CUSTOMERS SHOWS THE SCHEDULE'S DAY/.test(top));
check('SCH-85 and SCH-86 are still in the rulings map and still Standing',
  /^\| SCH-85 \|.*\| Standing \|\s*$/m.test(qmap) && /^\| SCH-86 \|.*\| Standing \|\s*$/m.test(qmap),
  'superseding either is allowed ONLY by a new ruling row naming it');

/* ---- 5. nothing can quietly stop running the above ---- */
const chain = (pkg.scripts && pkg.scripts.test) || '';
check('npm test still runs run-all.js (the suite)',
  /npm run test:suite/.test(chain) && pkg.scripts['test:suite'] === 'node run-all.js');
check('npm test still runs this file',
  /npm run test:headline/.test(chain) && pkg.scripts['test:headline'] === 'node headline-rules.test.js');
check('CI still runs this file as its own named step',
  /run: npm run test:headline/.test(ci));
check('CI still runs the whole chain',
  /run: npm test\b/.test(ci));

console.log('\n' + '='.repeat(55));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('='.repeat(55) + '\n');
process.exit(fail ? 1 : 0);
