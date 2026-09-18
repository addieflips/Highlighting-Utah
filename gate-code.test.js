/*
 * THE GATE CODE, ON THE SERVER SIDE
 *
 * Addie, 2026-08-31: "Lets do gate code before changes."
 *
 * ⚠ WHY THIS FILE EXISTS AT ALL, AND IT IS NOT A TIDINESS ARGUMENT. The browser
 * specs (test/rsvp-gate-code.spec.js) drive the real page against a FAKE
 * Firebase, so they prove everything the customer sees and nothing at all about
 * functions/index.js. A red-check proved that exactly: breaking the real
 * server's return so it hands back an empty gate code left all ten browser
 * specs green. That is the gap this closes.
 *
 * ⚠ AND IT ASSERTS STRUCTURE, WHICH IS WEAKER THAN RUNNING, SO IT SAYS SO.
 * A Cloud Function needs a Firebase environment to execute; the emulator is a
 * separate decision (§9.4). What can be held here is that the field is
 * returned, that the write path exists and is scoped to one field, and — the
 * one that actually bites — that it never becomes portalSave.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');
const fns = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}

/* Slices to the matching closing brace rather than a fixed character window —
   §7 bans magic-number windows by name, and this repo has been bitten by one
   thirteen times over. */
function lift(src, name) {
  let i = src.indexOf('exports.' + name + ' =');
  if (i === -1) i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find ' + name);
  /* ⚠ START AT THE FUNCTION BODY, NOT THE FIRST BRACE. These are declared
     `onCall({ cors: true }, async (request) => {` — so the first brace pair is
     the OPTIONS OBJECT, which closes immediately and hands back four words
     instead of the callable. That produced six confident failures against
     perfectly good code on the first run of this file. */
  let bodyStart = src.indexOf('=> {', i);
  if (bodyStart === -1) bodyStart = src.indexOf('{', i);
  else bodyStart += 3;
  let depth = 0, started = false;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}

console.log('\n=== Gate code: the half the browser specs cannot see ===\n');

// ---- portalRsvp hands the gate code back ----------------------------------
/* Without this the step that follows cannot CONFIRM a code we already hold —
   it can only ask, which invites a customer who gave us 4417 last year to tap
   "no" and look like they removed it. */
const rsvpSrc = lift(fns, 'portalRsvp');
check('portalRsvp returns the gate code it holds',
  /gateCode:\s*String\(oldData\.gateCode/.test(rsvpSrc),
  'the confirm-what-we-hold step has nothing to confirm without it — and a red-check ' +
  'proved the browser specs stay green when this breaks, because they use the stub');

check('it reads the record, not the request',
  !/gateCode:\s*String\(body\.|gateCode:\s*String\(request/.test(rsvpSrc),
  'echoing the caller back would let anybody with a token see a value they supplied');

// ---- portalSetGateCode -----------------------------------------------------
check('portalSetGateCode exists', fns.indexOf('exports.portalSetGateCode') !== -1);

const setSrc = lift(fns, 'portalSetGateCode');

check('it refuses a missing token',
  /if \(!token\) throw new HttpsError/.test(setSrc));

/* ⚠ THROWS, like every other portal callable, so index.html's shared
   portalCallFailedText says "this link may be out of date" rather than
   "something went wrong". A callable that RESOLVED with ok:false would land in
   the wrong branch — that is the bug fixed on the RSVP link the same day. */
check('an unknown token throws not-found rather than resolving',
  /throw new HttpsError\('not-found'/.test(setSrc),
  'the client tells the difference between a stale link and an outage by the code');

check('it looks the customer up by token, like portalRsvp',
  /findByToken\(token\)/.test(setSrc));

/* ⚠ ONE FIELD. This runs with the Admin SDK and bypasses firestore.rules, so
   the whitelist IS this line. A write assembled from the request body would be
   an unauthenticated write of anything on the customer record. */
const updateCall = setSrc.slice(setSrc.indexOf('.update({'));
check('it writes exactly gateCode and its timestamp',
  /gateCode:\s*gateCode/.test(updateCall) &&
  /gateCodeUpdatedAt/.test(updateCall) &&
  !/\.\.\./.test(updateCall) &&
  (updateCall.match(/^\s*\w+:/gm) || []).length === 2,
  'this callable bypasses firestore.rules — the fields named here are the whole whitelist');

check('the value is bounded',
  /\.slice\(0,\s*60\)/.test(setSrc),
  'an unbounded string from an unauthenticated caller goes straight onto the record');

/* ⭐ THE ONE THAT MATTERS MOST, AND THE LEAST OBVIOUS. gateCode is already in
   PORTAL_WRITE_FIELDS under the `info` section, so reusing portalSave looks
   like the clean move — and that section used to end with
       updates.seasonStatus = addressChanged ? 'address_changed' : 'needs_changes';
   which is the RE-QUOTE state, resolved by answering a quote. No quote exists
   here, so every customer who typed a gate code during their RSVP would sit in
   Needs Changes for ever waiting on a question nobody asked. */
check('it does not set seasonStatus',
  !/seasonStatus/.test(setSrc),
  "a gate code is not a change to the job — setting it parks the customer in the re-quote state");

/* ⭐ REVISITED 2026-09-10, WHICH IS WHAT THE CHECK BELOW USED TO ASK FOR.
   It matched the literal `updates.seasonStatus = addressChanged ? ...` line in
   portalSave and its own failure message said: "if portalSave stops doing this,
   the reason for a separate function is gone and this check should be revisited
   rather than deleted." portalSave stopped doing it — an info save now writes no
   seasonStatus at all, for exactly the reason this function was carved out,
   applied to the whole tab.

   ⚠ SO THE CLAIM IS REPOINTED, NOT WEAKENED, AND NOT DROPPED. Pinned to that
   spelling it would now fail on code that is right — the §7 slow-fuse shape this
   repo has been bitten by in S82, S129 and the folder-names suite. What must
   still be TRUE is the guarantee, not the location: nowhere in the portal's
   contact-details path may a customer be parked in the re-quote state without a
   quote to answer. So both writers are asserted directly — the info save writes
   no status, and the one path that legitimately does is the move door, which
   raises a real re-quote for the office to answer. */
/* ⚠ COMMENTS STRIPPED FIRST, and the very first draft of this check proved why
   by failing on correct code: the explanation now sitting inside that branch says
   "AN INFO SAVE NO LONGER WRITES seasonStatus AT ALL", so a plain search read the
   prose as the code it describes. Suites 58, 274, 275 and 300 each learned this
   separately; §7 has the general form. Sliced to its own structural end rather
   than by a character count — §7 bans fixed-length windows by name. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const infoSection = stripComments(fns.slice(fns.indexOf("if (section === 'info') {")));
check('an info save parks nobody in the re-quote state',
  !/seasonStatus/.test(infoSection.slice(0, infoSection.indexOf('\n  }'))),
  'a corrected phone number or gate code would sit in Needs Changes for ever, ' +
  'waiting on a question nobody asked — the trap this whole function exists to avoid');

check('and the move door is the one path that still sets it',
  /exports\.portalChangeAddress\s*=/.test(fns) &&
  /seasonStatus: 'address_changed'/.test(fns),
  'a move genuinely does owe a re-quote, so if NOTHING writes address_changed any ' +
  'more the office has lost the badge it works from');

/* The office and the portal must agree about what fits in the box. */
check('the length cap matches the office writer',
  /gateCode:\s*str\(details\.gateCode,\s*60\)/.test(fns),
  'two different ceilings means a code that saves in one place and truncates in the other');

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) {
  console.log('The gate code would not reach the record, or would take something else with it.\n');
  process.exit(1);
}
