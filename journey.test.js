#!/usr/bin/env node
/* ============================================================================
 * THE PATH A CUSTOMER TAKES — the graph still describes the system.
 *
 * Addie, 2026-08-29: "I was thinking we push on quotes than approve and it will show the
 * different routes in can go from there. So we can figure out the different navigations by
 * clicking on how things can go." Her two worked examples are checked here BY NAME, because
 * they are the ones she used to describe what she wanted and a graph that cannot walk them
 * is not the thing she asked for.
 *
 * ⚠ THE FAILURE THIS EXISTS FOR IS A MAP THAT STOPS MATCHING THE TERRITORY. The graph is
 * hand-written — only a person knows what order things happen in — so nothing stops a step
 * being renamed, an edge pointing at a step that no longer exists, or a dated step of the
 * real path never appearing on the page at all. Each of those leaves a page that still
 * draws confidently and is wrong, which is worse than no page.
 *
 * ⚠ AND EVERY DATED STEP MUST APPEAR. queue-date.test.js declares the path in fields; this
 * declares it in stages. A field dated but not drawn is a stage of the journey the picture
 * silently omits.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const { STEPS } = require('./connections/journey.js');

let passed = 0, failed = 0, notes = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(m) { notes++; console.log('  NOTE  ' + m); }

console.log('');
console.log('=== The path a customer takes ===');
console.log('');

const byId = {};
STEPS.forEach(s => { byId[s.id] = s; });

/* ---------------------------------------------------------------------------
 * 1. The graph holds together.
 * ------------------------------------------------------------------------- */
check('the graph still has steps in it', STEPS.length >= 20,
  'holds ' + STEPS.length + '. A graph emptied by a bad merge draws an empty page and ' +
  'fails nothing — the same shape as a suite that cannot find its target and skips.');

const dupes = STEPS.map(s => s.id).filter((id, i, a) => a.indexOf(id) !== i);
check('every step has its own id', dupes.length === 0,
  'repeated: ' + dupes.join(', ') + ' — a second step with the same id is unreachable, ' +
  'because every lookup finds the first');

const broken = [];
STEPS.forEach(s => (s.next || []).forEach(e => { if (!byId[e.to]) broken.push(s.id + ' → ' + e.to); }));
check('every route points at a step that exists', broken.length === 0,
  'dangling: ' + broken.join(', ') +
  '.\n        Clicking that route lands on nothing, and the page has no way to say so.');

const unlabelled = [];
STEPS.forEach(s => (s.next || []).forEach(e => { if (!e.label || e.label.length < 4) unlabelled.push(s.id + ' → ' + e.to); }));
check('every route says what makes it happen', unlabelled.length === 0,
  'no label: ' + unlabelled.join(', ') + '. Two routes out of one step with no words on ' +
  'them is a fork nobody can choose between, which is the whole thing this page is for.');

/* ⚠ REACHABLE FROM THE START, WALKED RATHER THAN ASSERTED. A step nobody can click to is
   invisible on a page whose only navigation is clicking. */
/* ⚠ THIS SAID "EXACTLY ONE" AND THAT WAS AN ASSUMPTION NOBODY MADE. Addie asked whether
   every route was drawn, and the honest answer was no: a quote was the only door on the
   page, while somebody typed into Add a Customer or arriving through the master sheet has
   no quote, no email and no approval at all. A check demanding one start would have kept
   it that way — the gate enforcing the gap it should have found. */
const starts = STEPS.filter(s => s.start);
check('the page has somewhere to open', starts.length >= 1,
  'nothing is marked as a start, so the page opens on nothing');
check('and every way in is a real step',
  starts.every(s => (s.next || []).length > 0),
  'a way in that leads nowhere is a page you cannot walk off');
{
  /* ⚠ FROM EVERY START, NOT THE FIRST ONE. With three ways in, walking from one of them
     reports the other two's steps as unreachable — a red on code that is right. */
  const seen = new Set(), queue = starts.map(s => s.id);
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    (byId[id].next || []).forEach(e => queue.push(e.to));
  }
  const orphans = STEPS.filter(s => !seen.has(s.id)).map(s => s.id);
  check('every step can be reached by clicking from the start', orphans.length === 0,
    'unreachable: ' + orphans.join(', ') +
    '.\n        The only way through this page is clicking, so a step nothing leads to ' +
    'is a step nobody can ever see.');
}

/* ⚠ AND EVERY ROUTE ENDS SOMEWHERE. A step with no routes out and no end marker is a dead
   end that reads as an unfinished graph — which is exactly what it is. */
const dead = STEPS.filter(s => !s.end && !(s.next || []).length).map(s => s.id);
check('every step either leads somewhere or is marked as an ending', dead.length === 0,
  'stops dead: ' + dead.join(', ') + '. Mark it `end: true` if the journey really ends ' +
  'there, or give it the route it is missing.');

check('every step says in plain words what it is',
  STEPS.every(s => s.plain && s.plain.length > 20),
  'a title alone is a label, and this page is read by somebody working out how the ' +
  'business fits together');

/* ---------------------------------------------------------------------------
 * 2. Addie's own two routes, walked.
 * ------------------------------------------------------------------------- */
/* ⚠ HER EXAMPLES, NOT INVENTED ONES. These are the two she used to describe what she
   wanted, so a graph that cannot walk them has not been built to the brief — however
   internally consistent it is. */
function walk(ids) {
  for (let i = 0; i < ids.length - 1; i++) {
    const from = byId[ids[i]];
    if (!from) return 'no step called ' + ids[i];
    if (!(from.next || []).some(e => e.to === ids[i + 1])) {
      return ids[i] + ' does not lead to ' + ids[i + 1];
    }
  }
  return '';
}
const routeA = ['quote', 'emailed', 'pending', 'nudged', 'approved', 'memberchange', 'requote'];
const routeB = ['quote', 'emailed', 'pending', 'approved', 'form', 'converted'];
/* ⚠ THE ROUTES THAT ARE NOT ABOUT A QUOTE AT ALL, added when Addie asked whether every
   route was drawn. Each is a real way through the business that the first version of this
   graph could not express: arriving with no quote, moving house, paying part, and the
   season coming round again. */
const routeC = ['addedbyhand', 'converted', 'queued', 'built', 'scheduled'];
const routeD = ['invoiced', 'partpaid', 'chase1', 'chase2', 'paid'];
const routeE = ['done', 'rsvpasked', 'rsvpno'];
const routeF = ['memberchange', 'moved', 'recycled'];
check('her first route walks: quote, sent email, pending, nudge, approve, wants more lit, re-quote',
  walk(routeA) === '', walk(routeA));
check('her second route walks: quote, send email, approve, convert to customer',
  walk(routeB) === '', walk(routeB));

/* ⚠ AND THE TWO ROUTES REALLY DO FORK. If approve led to only one place the page would
   answer her question with a straight line, which is the thing she said it should stop
   doing. */
/* ⚠ THE ROUTES ADDED 2026-08-29 AFTER A SURVEY OF WHAT THE CODE REALLY DOES, each one a
   state the app can genuinely be in that the graph did not draw. Named here so a merge
   cannot quietly drop one — the same argument as the census lists. */
const routeG = ['declined', 'asklastyear', 'scheduled'];
const routeH = ['assigned', 'changedafter', 'queued'];
const routeI = ['hung', 'noemail', 'invoiced'];
const routeJ = ['invoiced', 'unmatched'];
const routeK = ['scheduled', 'cancelrequest', 'recycled'];
/* ⚠ TWO ROUTES IN, DELIBERATELY, AND BOTH ARE WALKED. A customer can ask for different
   colours when they are asked what is changing, and again while they are sitting on the
   schedule waiting for a day — the second is far commoner and was the one missing. A
   reachability check alone would stay green with either of them deleted, because the
   other still reaches the step; only naming both catches one being lost. */
const routeL = ['memberchange', 'colourchange', 'queued'];
const routeM = ['scheduled', 'colourchange', 'queued'];
check('declining a re-quote asks about last year and keeps them in the season',
  walk(routeG) === '', walk(routeG));
check('changing colours after the booking reaches a new bundle',
  walk(routeH) === '', walk(routeH));
check('a house nobody can email is finished and unbilled until an address is added',
  walk(routeI) === '', walk(routeI));
check('a payment that finds no bill is reachable from the invoice',
  walk(routeJ) === '', walk(routeJ));
check('asking to cancel reaches the recycle queue',
  walk(routeK) === '', walk(routeK));
check('asking what is changing reaches a colour change and a new bundle',
  walk(routeL) === '', walk(routeL));
check('and so does changing your mind while waiting for a day',
  walk(routeM) === '', walk(routeM));

/* ⚠ THE ORDINARY CHANGE AND THE LATE ONE ARE TWO BOXES, NOT ONE. Both are somebody
   picking different colours; the only difference is whether a crew is already holding a
   printed card for the old pattern, which is exactly what makes one routine and the other
   an emergency. Merged, the page would either call every change an emergency or lose the
   reassignment entirely — and the page only ever had the late one. */
check('an ordinary colour change is not drawn as the late one',
  byId.colourchange && byId.changedafter && byId.colourchange.id !== byId.changedafter.id &&
  (byId.colourchange.records || []).indexOf('lightsChangedAt') !== -1 &&
  (byId.changedafter.records || []).indexOf('lightsChangedAfterAssignAt') !== -1,
  'the two states are recorded in different fields and must not share a box');

/* ⚠ AND THE FEE IS ON THE PICTURE. Outside the 48-hour window a colour change is $30 —
   its own field, its own note, its own parity test, and the one thing a customer asks
   about afterwards. A route drawn straight from "they want changes" to "sent to the
   warehouse" says nothing about it at all. */
check('a colour change reaches the bill as well as the warehouse',
  (byId.colourchange.next || []).some(n => n.to === 'queued') &&
  (byId.colourchange.next || []).some(n => n.to === 'invoiced'),
  'goes to: ' + (byId.colourchange.next || []).map(n => n.to).join(', '));

/* ⚠ A NO TO A PRICE IS NOT A NO TO THE SEASON, and the graph said otherwise until now —
   `declined` was drawn as an ending. An existing customer who declines keeps their route,
   their build and their place, which is the opposite of an end. */
check('declining is not drawn as the end of them',
  (byId.declined.next || []).length >= 2 && !byId.declined.end,
  'drawn as an ending, the page says a no to a price is a no to the season');

check('somebody typed in by hand reaches the warehouse without a quote',
  walk(routeC) === '', walk(routeC));
check('a part payment is its own route to the chases and to paid',
  walk(routeD) === '', walk(routeD));
check('the season coming round again reaches a no of its own',
  walk(routeE) === '', walk(routeE));
check('moving house reaches the recycle queue',
  walk(routeF) === '', walk(routeF));

check('approving forks, rather than going one way',
  (byId.approved.next || []).length >= 2,
  'the whole point is "the different routes it can go from there"');

/* ---------------------------------------------------------------------------
 * 3. Every dated step of the real path is drawn.
 * ------------------------------------------------------------------------- */
/* ⚠ READ OUT OF queue-date.test.js. That file is where a new dated step gets added; a
   copy of its list here is a second place to keep true. */
const qd = fs.readFileSync(path.join(ROOT, 'queue-date.test.js'), 'utf8');
const pathFields = [];
{
  const at = qd.indexOf('const PATH_STEPS = [');
  const block = at > -1 ? qd.slice(at, qd.indexOf('];', at)) : '';
  const re = /\[\s*'[^']*',\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(block))) pathFields.push(m[1]);
}
check('the dated path was read out of queue-date.test.js', pathFields.length >= 19,
  'found ' + pathFields.length + ' — a census matching nothing demands nothing');

/* ⚠ EACH ABSENCE CARRIES ITS REASON. A field can legitimately not be a stage of the
   journey; a field silently missing is a stage of it the picture omits. */
const NOT_A_STAGE = {
  paidAt: 'payments are their own ledger with several rows per bill — the stage is "paid", ' +
    'and one date could not carry a part payment followed by the rest',
  fixAssignedAt: 'being put on a fix route is the booking, not a stage — the stages are the ' +
    'fault being reported and it being mended',
  removalAssignedAt: 'same: the booking for a takedown, not a stage of the journey',
  /* ⚠ A MERGE IS SOMETHING DONE TO THE RECORD, NOT SOMEWHERE THE CUSTOMER GOES. This page
     answers "where can things go from here", and folding a duplicate in is office
     housekeeping that leaves them exactly where they were — drawn as a box it would sit on
     the path with no route out that is not the route they were already on. It IS on their
     history, which is the right place for it: the history says what happened to this
     record, the picture says where a customer can travel. */
  mergedAt: 'a duplicate record being folded in is housekeeping on the record, not a place ' +
    'the customer goes — it is on their history, which is where what-happened-to-this-record ' +
    'belongs'
};
const drawn = new Set();
STEPS.forEach(s => (s.records || []).forEach(f => drawn.add(f)));
const undrawn = pathFields.filter(f => !drawn.has(f) && !(f in NOT_A_STAGE));
check('every dated step of the path appears on the page', undrawn.length === 0,
  'not drawn: ' + undrawn.join(', ') +
  '.\n        Give it a step in connections/journey.js, or a NOT_A_STAGE entry with the ' +
  'reason. Left out, that stage is missing from the picture and the page still looks whole.');

const noReason = Object.keys(NOT_A_STAGE).filter(f => String(NOT_A_STAGE[f]).length < 20);
check('every deliberately-undrawn field says why', noReason.length === 0,
  'no reason: ' + noReason.join(', '));

/* ⚠ ONLY DATES ARE STRANGERS. A step may legitimately name a field that is not a date at
   all — `moved` records `requoteKind`, which is what KIND of re-quote it was — and a note
   that fires on it every single run for ever is a note somebody learns to scroll past,
   which costs the real ones their audience. The dated path is a list of dates; comparing a
   non-date against it asks a question that has no right answer. */
const strangers = [...drawn]
  .filter(f => /(?:At|Until)$/.test(f))
  .filter(f => pathFields.indexOf(f) === -1);
if (strangers.length) note('the page names ' + strangers.length + ' field(s) the dated path ' +
  'does not: ' + strangers.join(', ') + '. Not a failure — but if one has been retired, ' +
  'take it off the step too.');

/* ---------------------------------------------------------------------------
 * 4. A step that is not built says so.
 * ------------------------------------------------------------------------- */
/* ⚠ THE ONE THING THAT WOULD MAKE THIS PAGE WORSE THAN NOTHING is drawing a step that
   does not exist as though it ran. The two payment chases are Addie's spec and neither is
   built; the page's whole value is that it is true. */
const unbuilt = STEPS.filter(s => s.built === false);
check('the steps that are not built are marked as not built', unbuilt.length >= 2,
  'the two payment chases are a spec, not code — nothing chases an unpaid bill on a ' +
  'timer today, and a page that draws them as running is a wish rather than a map');
/* ⚠ THIS MATCHED A LIST OF PHRASES, which is the trap this repo records again and again:
   a check pinned to where a string happens to sit rather than to what must be true. It
   failed on a correct new step whose words were fine and simply different. What must be
   true is that an unbuilt step SAYS WHAT IS MISSING, so it is a field of its own. */
check('and each one says what is missing, in a field of its own',
  unbuilt.every(s => s.notBuilt && s.notBuilt.length > 40),
  'without: ' + unbuilt.filter(s => !s.notBuilt).map(s => s.id).join(', ') +
  '. The marker colours the box; this is what somebody actually reads, and "not built" ' +
  'without saying what is absent sends them looking for a switch that does not exist.');

/* ---------------------------------------------------------------------------
 * 5. The page, driven the way she drives it.
 *
 * ⚠ EVERYTHING ABOVE IS ABOUT THE GRAPH, and a correct graph behind a page that does not
 * render is the failure this repo has shipped before — the recycle "bin says" box whose
 * listener silently never applied, identical on screen to a working one, npm test green.
 * The whole point of this view is that it is CLICKED, so it is clicked.
 * ------------------------------------------------------------------------- */
{
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) {
    note('jsdom is not installed, so nothing was actually clicked — run `npm install`. ' +
      'Every check above stayed green through a page that may not render at all.');
  } else {
    const dom = new JSDOM(require('./connections/build').render(), { runScripts: 'dangerously' });
    const doc = dom.window.document;
    const host = doc.getElementById('path');
    check('the path draws itself on load', !!host && /Follow a customer through/.test(host.innerHTML),
      'it is the tab that opens, so reached only through a click it shows an empty panel ' +
      'until somebody clicks away and back — which reads as the page being broken');
    /* ⚠ IT OPENS ON THE WAYS IN, NOT ON ONE OF THEM. This check said it should open at
       "A quote comes in", which was true when a quote was the only door — and enforcing it
       would have kept the page claiming everybody arrived that way, which is the gap Addie
       found by asking whether every route was drawn. */
    check('it opens by asking how the customer arrived',
      /How did this customer arrive\?/.test(host.innerHTML) &&
      host.querySelectorAll('.jnext').length === STEPS.filter(s => s.start).length,
      'opening on one way in quietly claims everybody came through it');
    const wayIn = (title) => {
      const b = Array.prototype.find.call(host.querySelectorAll('.jnext'),
        x => x.textContent.indexOf(title) !== -1);
      if (b) b.click();
      return !!b;
    };
    check('and picking one starts the trail there',
      wayIn('A quote comes in') &&
      (host.querySelector('.jcard h2') || {}).textContent === 'A quote comes in');

    /* ⚠ HER OWN ROUTE, CLICKED. walk() above proves the edges exist; this proves a person
       pressing the buttons actually gets there. */
    const step = (title) => {
      const b = Array.prototype.find.call(host.querySelectorAll('.jnext'),
        x => x.textContent.indexOf(title) !== -1);
      if (b) b.click();
      return !!b;
    };
    const routeTitles = ['Quote emailed', 'Waiting on them', 'Nudge sent', 'They approve',
      'Asked what is changing', 'Re-quote raised'];
    const walked = routeTitles.every(step);
    check('her first route can be clicked through, button by button', walked &&
      (host.querySelector('.jcard h2') || {}).textContent === 'Re-quote raised',
      'stopped at "' + ((host.querySelector('.jcard h2') || {}).textContent || '?') + '"');
    check('and the route walked stays on screen behind you',
      host.querySelectorAll('.jcrumb').length === routeTitles.length + 1,
      'the trail is what makes two routes out of one step comparable — without it you ' +
      'cannot see how you got here to back up and take the other');

    /* ⚠ BACKING UP TRUNCATES. Clicking a step already behind you means "take me back
       there", and leaving the tail on would show a trail that is not the route you are on. */
    host.querySelectorAll('.jcrumb')[2].click();
    check('clicking back along the trail truncates it rather than adding to it',
      host.querySelectorAll('.jcrumb').length === 3 &&
      (host.querySelector('.jcard h2') || {}).textContent === 'Waiting on them',
      'a trail that keeps the steps you have backed out of is not the route you are on');

    check('a step with a choice offers every one of them',
      host.querySelectorAll('.jnext').length === (STEPS.find(s => s.id === 'pending').next || []).length,
      'the fork is the whole reason this view exists');

    const errs = [];
    dom.window.addEventListener('error', e => errs.push(e.message));
    Array.prototype.forEach.call(host.querySelectorAll('.jnext,.jcrumb,.jfield'), b => b.click());
    check('and no click anywhere on the path threw', errs.length === 0, errs.join(' | '));
  }
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
if (failed) {
  console.log('');
  console.log('Failing: ' + failures.join(' | '));
  process.exit(1);
}
