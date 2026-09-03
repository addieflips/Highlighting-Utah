#!/usr/bin/env node
/* ============================================================================
 * DOES A RETURNING CUSTOMER NEED A BUNDLE BUILT?
 * `npm run test:rejoin` — its own file per R-018.
 *
 * Addie, 2026-09-03, having confirmed one customer for the season and found him on the
 * warehouse list: "it should only be sent to warehouse if there is any sort of change
 * from last year. If nothing changes than nothing is affected."
 *
 * ⚠ THE RULE INFERRED A RECYCLE FROM THE ABSENCE OF A FLAG. Four places asked
 * `was 'no' && !needsLightRecycle` and read the clear flag as proof the warehouse had
 * pulled the bundle apart. The old comment in functions/index.js said so outright — that
 * a record still reading no with the flag already false "is the ONE signal that the
 * recycle actually happened". It is not. The flag is equally clear when NOBODY EVER
 * QUEUED ONE, which is the ordinary state of somebody marked no by hand or by an import.
 *
 * The customer who found it: marked no, never recycled, confirmed for the season, and
 * sent to the warehouse for a second set while his first was still on the shelf — with
 * no badge on the row, because nothing about his lights had changed. The badge was
 * right; the rule was wrong.
 *
 * ⭐ `lightsRecycledAt` IS THE POSITIVE SIGNAL, and it did not exist when the rule was
 * written. Both paths that COMPLETE a recycle stamp it — Mark Recycled on a customer we
 * are keeping, and the warehouse tick in employee.html — and a plain Mark Recycled
 * removes the record entirely, so nobody rejoins down that road.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. A no whose recycle really completed DOES get a rebuild. This is the direction
 *      that costs most if it breaks: a crew at an empty bin.
 *   2. A no that was never recycled gets NOTHING. Addie's case.
 *   3. A recycle still queued gets nothing — the warehouse owns the bin.
 *   4. Nobody else is ever rebuilt by this rule, whatever else is on their record.
 *   5. The browser and server copies agree, over every combination.
 *   6. All four callers ask the shared rule rather than keeping their own inference.
 *
 * ⭐ IT RUNS BOTH COPIES, IT DOES NOT READ THEM. And it asserts they are RIGHT, not
 * merely equal — two copies wrong in the same way agree perfectly, which is the one
 * thing a parity sweep cannot see on its own. Same discipline as money-parity.test.js.
 *
 * ⚠ THE STRICT DIRECTION HAS A COST AND IT IS STATED RATHER THAN HIDDEN. A recycle that
 * completed before the stamp existed leaves no evidence, so that customer comes back
 * with no build queued. That is accepted because the population is empty in practice —
 * a plain no DELETES the record, the keep-them path has always stamped, and the crew
 * portal is not in use this season. If a house is ever hung with nothing built, this is
 * the line to look at. Do not "fix" it by going back to reading the flag's absence.
 * ========================================================================== */
'use strict';
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

const admin = read('admin.html');
const server = read('functions/index.js');

/* Lift a whole function by name, to its closing brace at column 0 — a structural
   anchor, never a character count (CLAUDE.md §7 bans those by name). */
function liftFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  const end = src.indexOf('\n}', start);
  return end === -1 ? null : src.slice(start, end + 2);
}

const officeSrc = liftFn(admin, 'rejoinNeedsBuild');
const serverSrc = liftFn(server, 'rejoinNeedsBuildServer');

/* ⚠ A GATE THAT CANNOT FIND ITS TARGET MUST FAIL, NEVER SKIP. A rename that hides one
   copy would otherwise leave this file reporting green over a rule nothing runs. Same
   reasoning money-parity.test.js gives for failing on a missing function. */
check('both copies of the rule were found',
  !!officeSrc && !!serverSrc,
  'missing: ' + [!officeSrc && 'rejoinNeedsBuild (admin.html)',
                 !serverSrc && 'rejoinNeedsBuildServer (functions/index.js)']
                 .filter(Boolean).join(', '));

if (officeSrc && serverSrc) {
  const office = new Function(officeSrc + '\nreturn rejoinNeedsBuild;')();
  const srv = new Function(serverSrc + '\nreturn rejoinNeedsBuildServer;')();

  /* -------------------------------------------------------------------------
   * The three states a "no" can actually be in.
   * ----------------------------------------------------------------------- */
  const recycled = { rsvpStatus: 'no', needsLightRecycle: false, lightsRecycledAt: 'THEN' };
  const neverRecycled = { rsvpStatus: 'no', needsLightRecycle: false };
  const stillQueued = { rsvpStatus: 'no', needsLightRecycle: true };

  check('a no whose recycle actually completed needs a rebuild',
    office(recycled) === true,
    'their bundle is gone and their number went back to the pool — routing them ' +
    'without rebuilding sends a crew to an empty bin. This is the expensive direction.');

  /* ⭐ THE ONE ADDIE REPORTED. */
  check('a no that was never recycled needs nothing',
    office(neverRecycled) === false,
    'a flag nobody ever set is not a bundle that came back. This built a second set ' +
    'for a house whose first one was still on the shelf.');

  check('and a recycle still queued needs nothing either',
    office(stillQueued) === false,
    'the warehouse owns that bin — it has not been near it, so the set is where they ' +
    'left it and cancelling the recycle is the whole of what is needed');

  /* ⚠ THE STAMP IS ONLY EVIDENCE ALONGSIDE A CLEARED FLAG. Both set at once means the
     warehouse has been asked again since it last finished — the bin is theirs. */
  check('a stamp does not override a recycle that is queued again',
    office({ rsvpStatus: 'no', needsLightRecycle: true, lightsRecycledAt: 'THEN' }) === false,
    'queued again means the bundle is coming apart again, whatever happened last time');

  /* -------------------------------------------------------------------------
   * Nobody else, ever.
   * ----------------------------------------------------------------------- */
  check('nobody who was not a no is ever rebuilt by this rule',
    ['', 'yes', 'backnextyear', 'unanswered', 'maybe'].every(st =>
      office({ rsvpStatus: st, needsLightRecycle: false, lightsRecycledAt: 'THEN' }) === false),
    'Back Next Year keeps their set in their bin, and somebody who never said no has ' +
    'nothing to rejoin from — rebuilding either makes a set nobody asked for');

  check('and an empty record is not a rejoiner',
    office({}) === false && office(null) === false && office(undefined) === false,
    'a rule that throws or answers true on a half-loaded record would queue the book');

  /* ⚠ SPELLING. The office dropdown lowercases before it compares and the portal does
     not, so the rule has to do it itself or one door answers differently from the other
     on a stored "No". That exact asymmetry is a bug this repo has already had. */
  check('the status is read case- and space-insensitively',
    office({ rsvpStatus: '  No  ', needsLightRecycle: false, lightsRecycledAt: 'THEN' }) === true &&
    office({ rsvpStatus: 'NO', needsLightRecycle: false, lightsRecycledAt: 'THEN' }) === true,
    'a stored "No" that reads as not-a-no leaves a genuinely recycled customer with no ' +
    'bundle, which is the direction that strands a crew');

  /* -------------------------------------------------------------------------
   * Parity, over every combination.
   * ----------------------------------------------------------------------- */
  const STATUSES = ['', 'no', 'No', ' no ', 'yes', 'backnextyear', 'unanswered'];
  const FLAGS = [true, false, undefined];
  const STAMPS = ['THEN', null, undefined, 0, ''];
  let disagreed = null, combos = 0;
  STATUSES.forEach(st => FLAGS.forEach(fl => STAMPS.forEach(stamp => {
    const rec = { rsvpStatus: st, needsLightRecycle: fl, lightsRecycledAt: stamp };
    combos++;
    const a = office(rec), b = srv(rec);
    if (a !== b && !disagreed) {
      disagreed = JSON.stringify(rec) + ' — office ' + a + ', server ' + b;
    }
  })));
  check('the browser and server copies agree on all ' + combos + ' combinations',
    !disagreed,
    disagreed || 'change one copy, change the other, in the same push');

  /* -------------------------------------------------------------------------
   * ⭐ THE SAFETY PROPERTY, AND THE HONEST RESIDUE.
   *
   * The rule this replaced was `was 'no' && !needsLightRecycle`. The new one is that
   * AND a stamp, so it can only ever queue FEWER builds — never one the old rule would
   * not have queued. That is what makes this change safe to ship without knowing every
   * record in the book: it cannot invent a build for anybody who was not already
   * getting one. Checked over every state rather than argued.
   *
   * ⚠ AND THE RESIDUE IT DOES NOT CLOSE, said out loud rather than left to be found.
   * `lightsRecycledAt` is NEVER CLEARED — Start New Season keeps every date on purpose,
   * so the history can say when last season's work happened. So a customer recycled in
   * an earlier season, kept as a customer, and later marked no WITHOUT a recycle being
   * queued would still read as "their set came back" on the strength of an old stamp.
   * That case queued a build before this change too, so nothing got worse; it is simply
   * not fixed. The proper discriminator is whether a bundle was BUILT since the recycle
   * (`lightsMarkedBuiltAt` later than `lightsRecycledAt`), which is the next refinement
   * if this ever bites. Not built tonight because it cannot be validated against the
   * real book, and a guess about who has glass is what caused this bug in the first
   * place.
   * ----------------------------------------------------------------------- */
  {
    const oldRule = d => String(d.rsvpStatus || '').trim().toLowerCase() === 'no' && !d.needsLightRecycle;
    let wider = 0, narrower = 0;
    ['', 'no', 'No', ' no ', 'yes', 'backnextyear', 'unanswered'].forEach(st =>
      [true, false, undefined].forEach(fl =>
        ['THEN', null, undefined, 0, ''].forEach(stamp => {
          const d = { rsvpStatus: st, needsLightRecycle: fl, lightsRecycledAt: stamp };
          if (office(d) && !oldRule(d)) wider++;
          if (!office(d) && oldRule(d)) narrower++;
        })));
    check('the new rule never queues a build the old one would not have',
      wider === 0,
      wider + ' state(s) would now build where the previous rule did not. This change is ' +
      'meant to NARROW who reaches the warehouse; anything wider is a new way to build a ' +
      'bundle for a full bin, which is the bug it exists to close.');
    check('and it does narrow it, so the change is not a no-op',
      narrower > 0,
      'if nothing narrowed, the rule is not doing anything and Jeff Rasmussen is still ' +
      'being queued for a house whose lights never moved');
  }

  /* ⚠ A FALSY STAMP IS NOT A RECYCLE. An empty string or a 0 reaching this field means
     something wrote a placeholder, not that a bundle came back. */
  check('and a blank or zero stamp is not evidence',
    ['', 0, null, undefined].every(stamp =>
      office({ rsvpStatus: 'no', needsLightRecycle: false, lightsRecycledAt: stamp }) === false),
    'a placeholder in the field would rebuild everybody who was ever marked no');
}

/* ---------------------------------------------------------------------------
 * ALL FOUR CALLERS ASK THE RULE.
 *
 * ⚠ THIS IS THE HALF THAT IS EASY TO SKIP AND IT IS WHERE THE BUG LIVED. The rule being
 * right is worth nothing while a caller keeps its own copy of the inference — which is
 * exactly what all four were doing. A red-check proved it: with the rule correct and one
 * caller reverted, every behavioural check above still passed.
 *
 * ⚠ COMMENTS ARE STRIPPED FIRST. Each of these sites carries a comment EXPLAINING the
 * old `!needsLightRecycle` inference, so a raw search finds the explanation and calls it
 * a violation. Suites 58, 274 and 275 each learned this separately.
 * ------------------------------------------------------------------------- */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const adminNoComments = stripComments(admin);
const serverNoComments = stripComments(server);

check('the office dropdown asks the rule',
  /rejoinedAfterRecycle\s*=\s*newRsvp === 'yes' && rejoinNeedsBuild\(/.test(adminNoComments),
  'this is the door Addie actually uses — confirming somebody marked no');
check('the shared season rule asks it',
  /if\(rejoinNeedsBuild\(d\)\) updates\.needsLightBuild = true;/.test(adminNoComments),
  'seasonYesUpdates serves the RSVP link, the office dropdown and quote approval');
check('the server season rule asks it',
  /if \(rejoinNeedsBuildServer\(d\)\) updates\.needsLightBuild = true;/.test(serverNoComments),
  'the same three doors, on the far side of the wire');
check('and portalRsvp asks it',
  /rejoinedAfterRecycle\s*=\s*response === 'yes' && rejoinNeedsBuildServer\(/.test(serverNoComments),
  'the customer answering their own RSVP link');

/* ⚠ AND NOBODY DECIDES A BUILD FROM THE RECYCLE FLAG ANY MORE. The banned shape is the
   INFERENCE, not a read of the field: `needsLightRecycle` is legitimately read all over
   both files — coerced for the stamp helpers, guarded in Mark Recycled, listed by name
   in the re-quote handler — and none of that is this bug. What must not exist is a
   statement that decides `needsLightBuild` FROM it.

   ⚠ THE FIRST VERSION OF THIS CHECK BANNED ANY `!x.needsLightRecycle` AND WAS WRONG,
   flagging five innocent lines including three `!!` coercions. A check that cries wolf
   on correct code is one somebody deletes, and it would have taken the real guard with
   it — so it is scoped to the two fields appearing in ONE statement.

   Scoped past the two rule bodies, which are the one place allowed to make this call. */
const BOTH_FIELDS = /[^;\n]*needsLightBuild[^;\n]*needsLightRecycle[^;\n]*|[^;\n]*needsLightRecycle[^;\n]*needsLightBuild[^;\n]*/g;
[['admin.html', adminNoComments, 'function rejoinNeedsBuild('],
 ['functions/index.js', serverNoComments, 'function rejoinNeedsBuildServer(']].forEach(([label, src, marker]) => {
  const at = src.indexOf(marker);
  const withoutRule = at === -1 ? src : src.slice(0, at) + src.slice(src.indexOf('\n}', at) + 2);
  /* The re-quote handler names both fields in one array literal to DELETE them from the
     season updates — it decides nothing about either, and is the one known pair. */
  const hits = (withoutRule.match(BOTH_FIELDS) || [])
    .map(h => h.trim())
    .filter(h => !/\['needsLightRecycle', 'needsLightBuild'\]\.forEach/.test(h));
  check('no statement decides a build from the recycle flag in ' + label,
    hits.length === 0,
    hits.length + ' place(s) still infer a rebuild from needsLightRecycle:\n        ' +
    hits.join('\n        ') + '\n        A clear flag is not proof a bundle came back.');
});

/* ------------------------------------------------------------------------- */
console.log('');
console.log('=== Does a returning customer need a bundle built? ===');
console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
