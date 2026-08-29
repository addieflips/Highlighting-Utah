#!/usr/bin/env node
/* ============================================================================
 * WHEN A BUNDLE WAS SENT TO THE WAREHOUSE — every queueing place stamps it.
 *
 * Addie, 2026-08-28, asked what the customer journey would show and went straight to
 * the gap: "Okay what about when bundle got sent to warehouse". `lightsMarkedBuiltAt`
 * records when a bundle was MADE. Nothing recorded when one was ASKED FOR — so "built
 * on 14 Oct" could not tell you whether it waited two days or five weeks, and a house
 * queued and forgotten looked exactly like one queued this morning.
 *
 * ⚠ THE FLAG IS SET IN TWENTY PLACES. Add a Customer, three importers, the sheet sync,
 * the house-details panel, the Edit Customer save, both re-quote answers, the warehouse's
 * own button, the office RSVP change, and on the server portalSave, portalRsvp and
 * seasonYesUpdates. Miss one and those houses carry no queue date, silently — which is
 * the "one rule, several writers, one of them out of step" shape every bug found in this
 * repo this month has had.
 *
 * SO THIS IS A CENSUS, not a spot check. It finds every place that sets the flag ON and
 * requires the enclosing function to stamp. A NEW queueing place that nobody has decided
 * about fails the build.
 *
 * ⚠ GROUPED BY THE ENCLOSING FUNCTION, and that is a deliberate limit stated rather than
 * hidden. The stamp is a helper call placed AFTER every branch that can set the flag —
 * the Edit Customer save has five such branches and one call, because a call beside any
 * one of them would miss the other four. So the unit has to be the function, not the
 * statement, and the cost is that a function with two queueing paths where only one is
 * covered would pass here. What catches that is the frozen list below: the paths are
 * named, so a new one cannot appear quietly.
 *
 * ⚠ AND IT RUNS BOTH COPIES OF THE RULE. A census proves the call is present; only
 * running it proves the call is RIGHT — specifically that an ordinary save of a house
 * already queued does not reset its date, which is the entire value of the field.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const scan = require('./connections/scan.js');
const ROOT = __dirname;

let passed = 0, failed = 0, notes = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(m) { notes++; console.log('  NOTE  ' + m); }

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* ⚠ employee.html JOINED THIS LIST ON 2026-08-29, and its absence was the structural
   reason several holes could exist at all. The crew portal writes SIX customer states —
   the build flag, the recycle flag, the fix flag, completed, removalDone and the customer
   number — and two of the three census gates in this repo could not see any of them.
   ⚠ THE PORTAL IS OUT OF USE THIS SEASON (owner, 2026-08-21: "were not using the employee
   portal this year"), so every write in it is listed below as a known exception with that
   reason rather than fixed today. What this buys is that nothing NEW can appear there
   undated — and if the portal comes back, that list is the to-do.
   ⚠ DORMANT IS NOT HARMLESS, which this repo already learned once: silent-failures.test.js
   sweeps this same file for exactly that reason, after whToggleRecycle was found clearing
   a customer number and then swallowing the pool write. */
const SOURCES = { 'admin.html': read('admin.html'),
                  'employee.html': read('employee.html'),
                  'functions/index.js': read('functions/index.js') };

console.log('');
console.log('=== When was it sent to the warehouse? ===');
console.log('');

/* ---------------------------------------------------------------------------
 * 1. The census.
 * ------------------------------------------------------------------------- */
/* ⚠ NAMED, NOT COUNTED. A bare number cannot tell a queueing path that was legitimately
   removed from one that was lost in a merge — the same argument CLAUDE.md makes about
   MANUAL_ONLY_IDS against the checklist count, which was wrong three times while the
   list was right every time. */
const QUEUE_SITES = [
  /* ⭐ THE CREW PORTAL'S OWN Add a Customer (added 2026-08-29). It created a record with
     no build flag at all, so a customer entered there got a record and never a bundle —
     nothing was made for them and a crew would arrive at a house with no lights for it.
     Fixed and declared in the same change; it is a real queueing place, not an exception. */
  { file: 'employee.html', fn: 'ecSaveBtn handler' },
  { file: 'admin.html', fn: 'qBuildTestBtn handler' },
  { file: 'admin.html', fn: 'buildTestPerson' },
  { file: 'admin.html', fn: 'routeAddressForm handler' },
  { file: 'admin.html', fn: 'rbApplyTickedAdds' },
  { file: 'admin.html', fn: 'rbImportBtn handler' },
  { file: 'admin.html', fn: 'ibImportBtn handler' },
  { file: 'admin.html', fn: 'attachAddressRowHandlers' },
  { file: 'admin.html', fn: 'seasonYesUpdates' },
  { file: 'admin.html', fn: 'whFindNotQueuedBtn handler' },
  { file: 'admin.html', fn: 'editCustBuildStayBtn handler' },
  { file: 'admin.html', fn: 'editCustSaveBtn handler' },
  { file: 'functions/index.js', fn: 'portalSave' },
  { file: 'functions/index.js', fn: 'seasonYesUpdates' },
  { file: 'functions/index.js', fn: 'portalRsvp' }
];
/* ⚠ SETS THE FLAG BUT NEVER QUEUES ANYTHING, so it must NOT stamp. `setCustomerSeason`
   writes `toMaybe ? false : local.data.needsLightBuild` — it either cancels a build or
   carries forward whatever the record already held. Stamping there would put a fresh
   queue date on a house nobody has asked to have built. */
const NOT_A_QUEUE = [
  { file: 'admin.html', fn: 'setCustomerSeason' },
  /* ⚠ UN-TICKING "BUILT" IS A CORRECTION, NOT A REQUEST. Dating the build in the crew
     portal on 2026-08-29 turned its write into an explicit `needsLightBuild: true` on the
     untick, which this census correctly noticed as a new queueing place. It is not one:
     the house was queued weeks ago and somebody is undoing a mis-tick, so stamping here
     would date a request nobody made and lose the real one. The office path has the same
     shape and the same reason. */
  { file: 'employee.html', fn: 'whToggleLightsNew' }
];

/* ⚠ THE CENSUS DOES NOT TRUST THE COMMENT MASK, and that is not caution — it was proved
   unreliable while this gate was being written. `connections/scan.js`'s blankNonCode
   cascades: one unbalanced quote and it stops recognising `/*` for the rest of the file,
   so comments after it are never masked. The first version of this census matched a
   sentence inside a comment that was DESCRIBING the field being counted, and reported a
   queueing place that does not exist. Half of that was fixed there (quotes in HTML prose
   no longer open a string); at least one cascade inside the script remains, most likely a
   regex literal such as /'/ whose apostrophe reads as a quote. That is its own change,
   recorded rather than half-fixed here.
   ⚠ SO THIS ASKS THE QUESTION LOCALLY: an unclosed block-comment opener before the
   position means we are inside one, and a line-comment marker earlier on the same line
   means the same thing. Cheap, and it cannot cascade — it starts fresh at every match.
   ⚠ AND WRITING THIS COMMENT BROKE THE FILE, which is worth leaving in as evidence: the
   first draft spelled the closing marker out to explain the rule, and that ENDED the
   comment early, dumping the rest of the prose into the parser as code. That is exactly
   the premature-close failure being described one paragraph up. Do not spell it out. */
function insideComment(src, pos) {
  const open = src.lastIndexOf('/*', pos), close = src.lastIndexOf('*/', pos);
  if (open > close) return true;
  const bol = src.lastIndexOf('\n', pos) + 1;
  const slashes = src.slice(bol, pos).indexOf('//');
  return slashes !== -1;
}

function census() {
  const on = new Map(), stamps = new Set(), skipped = [];
  for (const [file, raw] of Object.entries(SOURCES)) {
    const clean = scan.blankNonCode(raw);
    const ix = scan.index(raw, true);
    const re = /needsLightBuild\s*[:=]\s*([^,;\r\n}]*)/g;
    let m;
    while ((m = re.exec(clean))) {
      const v = m[1].trim();
      if (/^false\b|!checked/.test(v)) continue;          // a clear, not a queue
      /* ⚠ A FLAG WRITTEN AS AN OBJECT IS NOT A FLAG. The change log's label map has a
         row per editable field, so `needsLightBuild: {label: ...}` reads to this census
         as a fourteenth queueing place at top level. It is a DESCRIPTION of the field,
         not a write of it — and the flag is a boolean, so an object here can never be
         one. Narrow on purpose: excluding the map by name instead would mean every
         future map of these fields has to be remembered. */
      if (v.charAt(0) === '{') continue;
      if (/^==|wasQueued/.test(v)) continue;              // the helper's own guard
      if (insideComment(raw, m.index)) continue;          // prose about the field, not a write
      const fn = scan.enclosing(ix, m.index) || '(top level)';
      if (NOT_A_QUEUE.some(x => x.file === file && x.fn === fn)) { skipped.push(file + ' · ' + fn); continue; }
      const key = file + ' · ' + fn;
      on.set(key, (on.get(key) || 0) + 1);
    }
    const sre = /(lightsQueuedAt|stampBuildQueued\w*\s*\()/g;
    let s;
    while ((s = sre.exec(clean))) {
      if (insideComment(raw, s.index)) continue;
      const fn = scan.enclosing(ix, s.index) || '(top level)';
      if (/^function stampBuildQueued/.test(clean.slice(Math.max(0, s.index - 9), s.index + 30))) continue;
      stamps.add(file + ' · ' + fn);
    }
  }
  return { on, stamps, skipped };
}

const { on, stamps, skipped } = census();
const wanted = QUEUE_SITES.map(s => s.file + ' · ' + s.fn);

check('the census still finds every known place that queues a build',
  wanted.every(k => on.has(k)),
  'not found: ' + wanted.filter(k => !on.has(k)).join(', ') +
  '. A census that has stopped matching reports no violations at all, which is the ' +
  'worst kind of green.');

const strangers = [...on.keys()].filter(k => wanted.indexOf(k) === -1);
check('no place queues a build that nobody has decided about',
  strangers.length === 0,
  'new queueing place(s): ' + strangers.join(', ') +
  '.\n        Either it stamps lightsQueuedAt — call stampBuildQueued(updates, ' +
  'wasQueued) after every branch that can set the flag — or it belongs in NOT_A_QUEUE ' +
  'with a reason. Left alone, those houses get a queue date of nothing and the ' +
  'warehouse cannot tell an old job from a new one.');

QUEUE_SITES.forEach(site => {
  const key = site.file + ' · ' + site.fn;
  if (!on.has(key)) return;
  check(key + ' stamps the queue date', stamps.has(key),
    'it sets needsLightBuild true and nothing in it records when. Every house queued ' +
    'through here would show "sent to the warehouse: —" on the journey view.');
});

check('the one place that sets the flag without queuing is still excluded',
  skipped.length === NOT_A_QUEUE.length,
  'expected to skip ' + NOT_A_QUEUE.length + ', skipped ' + skipped.length +
  ' (' + skipped.join(', ') + ')');

/* ---------------------------------------------------------------------------
 * 1a. EVERY DOOR TO A FIX GOES THROUGH THE SHARED RULE.
 *
 * ⚠ TWO OF THE FOUR DID NOT, and one of them sat five lines under a comment claiming all
 * three fields on that handler came from the shared rule — `completed` and `removalDone`
 * did, `needsFix` was written bare. So raising a fault from the customer row or from the
 * Routes tab recorded no `fixRaisedAt`, and mending one recorded no `fixDoneAt`.
 *
 * ⚠ IT IS MONEY, NOT TIDINESS. A fix raised on a completed house stops that payer's WHOLE
 * group being invoiced — `skippedNeedsFix` in the nightly run — and the hold is recomputed
 * from the flag every night. Undated, a bill held six weeks looks exactly like one held
 * since this morning, and nothing anywhere can sort the queue by how long.
 *
 * ⚠ THE EXISTING CHECK COULD NOT SEE IT: it asserted the shared rule is CALLED somewhere,
 * which was true, while two of the four callers went round it. Presence is not coverage.
 * ------------------------------------------------------------------------- */
{
  const src = SOURCES['admin.html'];
  const clean = scan.blankNonCode(src);
  const ix = scan.index(src, true);
  /* Every place the flag is written at all, by the enclosing function. */
  const doors = new Map();
  const re = /needsFix\s*[:=]\s*([^,;\r\n}]*)/g;
  let m;
  while ((m = re.exec(clean))) {
    const v = m[1].trim();
    if (/^==|wasNeedsFix/.test(v)) continue;          // a comparison, not a write
    if (v.charAt(0) === '{') continue;                // a label table, not a write
    if (insideComment(src, m.index)) continue;
    const fn = scan.enclosing(ix, m.index) || '(top level)';
    doors.set(fn, (doors.get(fn) || 0) + 1);
  }
  check('the fix census is finding the places that raise and clear a fault',
    doors.size >= 3,
    'found ' + doors.size + '. A matcher that has stopped matching reports no violations ' +
    'at all, which is the worst kind of green.');

  /* ⚠ NAMED, NOT COUNTED — the same argument as the queue census above. A bare number
     cannot tell a door legitimately removed from one lost in a merge. */
  const FIX_DOORS = {
    '(top level)': 'the shared rule itself — HLX_DONE_KINDS.fix is where both dates live',
    hlxMarkJobDone: 'the one door that always went through the rule',
    attachAddressRowHandlers: 'the customer-row dropdown',
    renderRouteOrderedList: 'the Routes tab toggle',
    /* ⚠ THESE TWO ARE NOT DOORS, and saying why is the point — a list of names cannot
       tell a place that FLIPS the flag from one that merely mentions it, and treating a
       render as a door would send somebody to add a date to some markup. */
    buildAddressRowHtml: 'draws the tick box — it READS the flag into markup, never writes it',
    planTickCustomer: 'mirrors the flag into the local cache before the write is awaited, ' +
      'because the tick is derived and would otherwise spring back; the real dated write ' +
      'is the hlxMarkJobDone call on the next line'
  };
  const strangers = [...doors.keys()].filter(f => !(f in FIX_DOORS));
  check('no new place writes the fix flag without a decision about it',
    strangers.length === 0,
    'new place(s): ' + strangers.join(', ') +
    '.\n        If it raises or clears a fault it must go through HLX_DONE_KINDS.fix so ' +
    'the date is recorded; if it only reads or mirrors the flag, add it to FIX_DOORS with ' +
    'the reason. Left undecided, a fault raised there is invisible on the history AND ' +
    'holds that payer\'s whole group off the bill with nothing saying since when.');

  /* ⚠ THE REAL CHECK IS THAT NOBODY WRITES IT BARE. A door may legitimately pass the flag
     through (a form re-saving what it already held); what it may not do is flip it
     without a date. Both halves of the shared rule carry one, so going through it is the
     whole requirement. */
  const bare = [];
  ['attachAddressRowHandlers', 'renderRouteOrderedList'].forEach(fn => {
    const f = ix.fns.filter(x => x.name === fn)[0];
    if (!f) { bare.push(fn + ' (function not found)'); return; }
    const body = clean.slice(f.start, f.end);
    if (!/HLX_DONE_KINDS\.fix/.test(body)) bare.push(fn);
  });
  check('every door that flips a fault goes through the shared rule', bare.length === 0,
    'writes it bare: ' + bare.join(', ') +
    '.\n        Use HLX_DONE_KINDS.fix[raising ? \'off\' : \'on\'](serverTimestamp()). ' +
    'Written bare, raising a fault records no fixRaisedAt and mending one records no ' +
    'fixDoneAt — and the nightly run holds that payer\'s whole group while the flag is up.');
}

/* ---------------------------------------------------------------------------
 * 1c. THE SEASON STATUS CARRIES A DATE.
 *
 * ⚠ FOUR VALUES, AND NOT ONE OF THEM WAS DATED. `seasonStatus` records a cancellation
 * asked for, an address changed, changes needed, and changes settled — and a search for a
 * date on it across every source returned nothing at all.
 *
 * ⚠ THE ONE THAT COSTS IS THE CANCELLATION. A customer asking through their own portal to
 * be let out of the season sits there with a crew still notionally coming, and the office
 * had no way to sort the queue by how long anybody had been waiting: a request made in
 * October read exactly like one made this morning.
 *
 * ⚠ AND THE PREVIOUS VALUE TRAVELS WITH THE DATE, because "changed on the 4th" cannot say
 * whether they were cancelling or correcting an address, and those need opposite actions.
 * ------------------------------------------------------------------------- */
{
  const src = SOURCES['functions/index.js'];
  const clean = scan.blankNonCode(src);
  const ix = scan.index(src, true);
  const writers = new Map();
  /* ⚠ `=[^=]`, NOT `=`. The stamp's own guard reads `typeof updates.seasonStatus ===
     'string'`, and a bare `=` matched the first character of that `===` — so the rule
     counted itself as a place that changes the status. */
  const re = /\bupdates\.seasonStatus\s*=[^=]/g;
  let m;
  while ((m = re.exec(clean))) {
    if (insideComment(src, m.index)) continue;
    const fn = scan.enclosing(ix, m.index) || '(top level)';
    writers.set(fn, (writers.get(fn) || 0) + 1);
  }
  check('the season-status census is finding the places that set it', writers.size >= 1,
    'found none. A matcher that has stopped matching reports no violations at all.');

  /* ⚠ GROUPED BY FUNCTION, and the stamp sits AFTER every branch inside it — portalSave
     alone writes the status three ways (the info save, the sides change, the cancel tab),
     so a stamp beside any one of them misses the other two. That is the placement lesson
     the build stamp already cost, which shipped inside one branch. */
  const stamped = new Set();
  const sre = /stampSeasonStatusServer\s*\(/g;
  let s2;
  while ((s2 = sre.exec(clean))) {
    if (insideComment(src, s2.index)) continue;
    const fn = scan.enclosing(ix, s2.index) || '(top level)';
    if (/^function stampSeasonStatusServer/.test(clean.slice(Math.max(0, s2.index - 9), s2.index + 40))) continue;
    stamped.add(fn);
  }
  const unstamped = [...writers.keys()].filter(f => !stamped.has(f));
  check('every place that changes the season status records when', unstamped.length === 0,
    'does not stamp: ' + unstamped.join(', ') +
    '.\n        Call stampSeasonStatusServer(updates, oldData.seasonStatus) after every ' +
    'branch in that function that can set it. Undated, a cancellation asked for in ' +
    'October is indistinguishable from one asked for this morning, and a crew is still ' +
    'notionally coming to the house.');

  /* ⚠ RUN, NOT READ — the rule is "only when it actually changed", and only running it
     proves an ordinary save does not reset the clock. */
  const rule = new Function('admin',
    (function () {
      const at = src.indexOf('function stampSeasonStatusServer(');
      let b = src.indexOf('{', at), dep = 0, k = b;
      for (; k < src.length; k++) {
        if (src[k] === '{') dep++;
        else if (src[k] === '}') { dep--; if (!dep) break; }
      }
      return src.slice(at, k + 1);
    })() + '\nreturn stampSeasonStatusServer;')(
      { firestore: { FieldValue: { serverTimestamp: () => 'NOW' } } });

  let u = rule({ seasonStatus: 'cancellation_requested' }, '');
  check('server: asking to cancel is dated', u.seasonStatusAt === 'NOW');
  check('and it records what it changed from',
    Object.prototype.hasOwnProperty.call(u, 'seasonStatusWas'),
    'cancelling and correcting an address are the same field and opposite jobs');
  u = rule({ seasonStatus: 'needs_changes' }, 'needs_changes');
  check('server: a save that did not change the status leaves the date alone',
    u.seasonStatusAt === undefined,
    'the portal writes this on saves that change nothing, so re-stamping resets the ' +
    'clock every time a customer opens their portal and presses save');
  u = rule({ seasonStatus: 'confirmed' }, 'needs_changes');
  check('server: settling a change is dated too, and remembers what it settled',
    u.seasonStatusAt === 'NOW' && u.seasonStatusWas === 'needs_changes');
  u = rule({ needsLightBuild: true }, 'confirmed');
  check('server: a write that does not touch the status is untouched',
    u.seasonStatusAt === undefined);
}

/* ---------------------------------------------------------------------------
 * 1d. START NEW SEASON MARKS WHERE THE SEASON ENDED.
 *
 * ⚠ THE RULE AND THE WIRING ARE DIFFERENT CLAIMS, and red-checking proved it: the history
 * gate happily proves a `seasonResetAt` renders as a divider, and deleting the field from
 * the reset write left that gate green while no customer would ever carry one.
 *
 * ⚠ WHY IT MATTERS. The reset clears the FLAGS and keeps every DATE — rightly, since
 * wiping them throws away the only record any of it happened. So without a marker a record
 * carries last season's dates beside this season's flags, and the history runs the two
 * years together: last October's install reads exactly like this October's.
 * ------------------------------------------------------------------------- */
{
  const src = SOURCES['admin.html'];
  const clean = scan.blankNonCode(src);
  const at = clean.indexOf('completed: false, invoiceEmailSent: false');
  check('the Start New Season customer reset was found', at > -1,
    'the checks below prove nothing against a string that is not there');
  if (at > -1) {
    /* The single updateDoc that reopens each customer — from the flags to its closing brace. */
    let dep = 0, k = clean.lastIndexOf('{', at), end = k;
    for (; end < clean.length; end++) {
      if (clean[end] === '{') dep++;
      else if (clean[end] === '}') { dep--; if (!dep) break; }
    }
    const write = clean.slice(k, end + 1);
    check('and it stamps where the season ended',
      /seasonResetAt\s*:\s*serverTimestamp\(\)/.test(write),
      'without it every record carries last season\'s dates beside this season\'s flags, ' +
      'and the customer history runs the two years together with nothing between them');

    /* ⚠ AND IT MUST NOT START WIPING THE DATES. That is the tempting "tidy" fix and it
       destroys the only record the work happened — the history needs them, and "queued on
       the 2nd, built on the 9th" is the whole point of keeping them. */
    const wiped = ['completedAt', 'lightsQueuedAt', 'lightsMarkedBuiltAt', 'assignedCrewAt',
      'removalDoneAt', 'fixRaisedAt', 'fixDoneAt']
      .filter(f => new RegExp(f + '\\s*:\\s*null').test(write));
    check('and it does not wipe the dates themselves', wiped.length === 0,
      'cleared by the reset: ' + wiped.join(', ') +
      '.\n        The marker is the fix, not a clear — those dates are the only record ' +
      'that any of it happened, and the history is built on them.');
  }
}

/* ---------------------------------------------------------------------------
 * 1e. A MERGE SAYS WHAT IT TOOK, AND FROM WHERE.
 *
 * ⚠ THIS IS THE ONE EVENT ON A RECORD THAT WAS PREVIOUSLY UNRECOVERABLE. Merging writes
 * another record's values onto the keeper and then DELETES that record. Everything else on
 * the keeper can still be read; the spare is gone the moment the delete runs, so if its id
 * is not written down at the merge it cannot be recovered by anybody. "Why does this
 * customer have an address they never gave us" had no answer anywhere — the activity log
 * records a count with an empty id, so even that cannot name them.
 *
 * ⚠ THE WIRING IS ASSERTED SEPARATELY FROM THE RULE, because that split has caught this
 * work twice already today: the history gate proves a `mergedAt` renders, and would stay
 * green while nothing ever wrote one.
 * ------------------------------------------------------------------------- */
/* ⚠ AND EVERY PLACE THAT ABSORBS A RECORD LEAVES THE TRACE, not just the one that was
   found first. `mergeFieldsFrom` is the shared rule for taking another record's values, and
   it is called from THREE places — the Danger Zone merge, the Danger Zone duplicate scan,
   and the sheet sync's fold-in. The last of those is the one that runs OFTEN: the Danger
   Zone tools are used rarely and deliberately, folding in a spare copy happens on an
   ordinary sync. A census here is what stops the rare path being fixed and the common one
   being missed, which is precisely what happened on the first pass. */
{
  const src = SOURCES['admin.html'];
  const clean = scan.blankNonCode(src);
  const ix = scan.index(src, true);
  const absorbers = new Map();
  const mre = /mergeFieldsFrom\s*\(/g;
  let mm;
  while ((mm = mre.exec(clean))) {
    if (insideComment(src, mm.index)) continue;
    const fn = scan.enclosing(ix, mm.index) || '(top level)';
    if (/^function mergeFieldsFrom/.test(clean.slice(Math.max(0, mm.index - 9), mm.index + 30))) continue;
    absorbers.set(fn, (absorbers.get(fn) || 0) + 1);
  }
  check('the record-absorbing census finds the places that take another record\'s values',
    absorbers.size >= 2,
    'found ' + absorbers.size + '. A matcher that has stopped matching demands nothing.');

  /* ⚠ NAMED, WITH WHAT EACH ONE IS. A caller that only SCANS (building a preview of what a
     merge would gain) is not absorbing anything and must not be asked for a trace. */
  const ABSORBERS = {
    dupExactBtn: 'the Danger Zone merge — writes the gains onto the keeper and deletes the spare',
    rbWireDiffButtons: 'the sheet sync folding in a spare copy — the same thing, on the path ' +
      'that actually runs often',
    /* ⚠ ITS CALL of the shared rule only SCANS — it builds the preview of what a merge
       would gain and nothing is written from it. That is not the same as the handler
       writing nothing: since 2026-08-29 it also deletes the losers and records that on
       the keeper. The delete census below is what holds that half; this entry is only
       about what it does with `mergeFieldsFrom`, and saying "writes nothing" flat would
       now contradict the census twenty lines down. */
    dupFindBtn: 'the duplicate scan — its mergeFieldsFrom call builds the preview of ' +
      'what would be gained and writes none of it',
    findMergeableCustomers: 'works out what a merge WOULD take, for the report; writes nothing',
    /* ⚠ A LOCAL HELPER INSIDE findMergeableCustomers, which the scanner names on its own
       because it is a named `const consider = function(...)`. Verified rather than assumed:
       its body contains no updateDoc, setDoc, addDoc or deleteDoc at all. It builds the
       preview of what a merge would gain, which is why it calls the shared rule. */
    consider: 'builds the preview of what a merge would gain; writes nothing at all'
  };
  const unknownAbsorber = [...absorbers.keys()]
    .filter(f => !Object.keys(ABSORBERS).some(k => f.indexOf(k) !== -1));
  check('no new place absorbs a record without a decision about it',
    unknownAbsorber.length === 0,
    'new place(s): ' + unknownAbsorber.join(', ') +
    '.\n        If it writes the gains onto a keeper it must also write mergedAt, ' +
    'mergedFromIds and mergedFields in the same write — the record it takes from is ' +
    'deleted, so an id not recorded there is gone for good. If it only scans, say so here.');

  /* ⚠ EVERY WRITER OF THE GAINS CARRIES THE TRACE. Checked per write, not per function:
     one function could legitimately hold both a traced and an untraced write, and the
     untraced one is the bug. */
  const gainWrites = [];
  const gre = /updateDoc\(doc\(db,'jobAddresses',\s*(?:g\.keeper\.id|sp\.keeper)\)/g;
  let gm;
  while ((gm = gre.exec(clean))) {
    if (insideComment(src, gm.index)) continue;
    const after = clean.slice(gm.index, gm.index + 420);
    if (!/mergedAt\s*:/.test(after) || !/mergedFromIds\s*:/.test(after) ||
        !/mergedFields\s*:/.test(after)) {
      gainWrites.push(scan.enclosing(ix, gm.index) || '(top level)');
    }
  }
  check('every write that absorbs another record records what it took',
    gainWrites.length === 0,
    'no trace: ' + gainWrites.join(', ') +
    '.\n        The spare is deleted moments later, so its id is unrecoverable unless it ' +
    'is written here — and the activity log records only a count with an empty id.');

  const at = clean.indexOf("updateDoc(doc(db,'jobAddresses', g.keeper.id)");
  check('the duplicate-merge write was found', at > -1,
    'the checks below prove nothing against a string that is not there');
  if (at > -1) {
    const around = clean.slice(at, at + 400);
    check('a merge records when it happened',
      /mergedAt\s*:\s*serverTimestamp\(\)/.test(around),
      'without it the keeper carries another record\'s values with nothing saying so');
    check('and which record it absorbed', /mergedFromIds\s*:/.test(around),
      'the spare is deleted on the next line — unrecorded here, its id is gone for good');
    check('and what it took', /mergedFields\s*:/.test(around),
      '"merged with a duplicate" cannot answer which of these fields is not theirs');

    /* ⚠ IN THE SAME WRITE AS THE GAINS. A second write can fail on its own and leave a
       record carrying another's values with nothing saying so — worse than the state this
       fixes, because it looks clean. */
    check('and it rides in the same write as the fields it gained',
      /Object\.assign\(\{\},\s*g\.gains,/.test(around),
      'a separate write can fail on its own and leave the record carrying another\'s ' +
      'values with nothing saying where they came from');
  }
}

/* ---------------------------------------------------------------------------
 * 1e2. A CUSTOMER RECORD THAT IS DELETED LEAVES SOMETHING BEHIND, OR IS SAID NOT TO.
 *
 * ⭐ THE CENSUS ABOVE COULD NOT SEE THE HOLE THIS ONE FOUND, and that is the whole reason
 * it exists. It scans callers of `mergeFieldsFrom` — the shared rule for TAKING another
 * record's values — so a tool that deletes a duplicate WITHOUT taking anything is invisible
 * to it by construction. Danger Zone → Duplicate customers is exactly that tool: the
 * superset rule guarantees the keeper already holds everything, so it moves nothing and
 * simply deletes. It left no trace anywhere, and nothing could have said so.
 *
 * ⚠ SO THE CENSUS IS OVER THE DELETE, NOT OVER THE MERGE. Deleting a `jobAddresses`
 * document is the irreversible act; whether values moved first is a detail of how. Every
 * site is named here with what happens to the memory of that record, and a new one fails
 * the build until somebody decides.
 *
 * ⚠ AND "NOTHING TO TRACE" IS A LEGITIMATE ANSWER, said out loud rather than by omission.
 * Delete All Customers empties the book — there is no keeper left to write a note onto, and
 * inventing one would be a lie about where the data went.
 * ------------------------------------------------------------------------- */
{
  const src = SOURCES['admin.html'];
  const clean = scan.blankNonCode(src);
  const ix = scan.index(src, true);

  /* ⚠ NAMED, WITH WHAT EACH DOES ABOUT THE MEMORY OF THE RECORD IT REMOVES. */
  const DELETERS = {
    /* ⚠ THE DELETE LIVES IN dupFindBtn, NOT IN A dupDeleteBtn OF ITS OWN. The Delete
       button is MINTED by the find handler's render, so its listener is nested inside it
       and that is the function the scanner names. Naming the button here instead would be
       a key that matches nothing, and a census whose entries match nothing demands
       nothing — the exact vacuous shape this file has been caught by before. */
    dupFindBtn: {
      trace: true,
      why: 'Danger Zone → Duplicate customers. Takes nothing (the superset rule is what ' +
        'makes deleting safe at all), so it writes mergedFields: [] — the fact, with an ' +
        'honest empty list rather than a missing key'
    },
    dupExactBtn: {
      trace: true,
      why: 'Danger Zone → Merge duplicates. Writes the gains and the trace in one write'
    },
    rbWireDiffButtons: {
      trace: true,
      why: 'the sheet sync folding in a spare copy — the path that actually runs often'
    },
    hlxRemoveCustomerToRecycle: {
      trace: false,
      why: 'the whole record is copied into archivedCustomers with archivedAt first, so ' +
        'it is not lost at all — a trace on a keeper would be describing a merge that ' +
        'did not happen'
    },
    deleteAllAddressesBtn: {
      trace: false,
      why: 'Delete All Customers. The book is emptied, so there is no keeper left to ' +
        'write a note onto and nowhere for one to be read'
    }
  };

  const dre = /deleteDoc\(doc\(db,'jobAddresses'/g;
  const seen = new Map();
  let dm;
  while ((dm = dre.exec(clean))) {
    if (insideComment(src, dm.index)) continue;
    const fn = scan.enclosing(ix, dm.index) || '(top level)';
    if (!seen.has(fn)) seen.set(fn, []);
    seen.get(fn).push(dm.index);
  }
  check('the customer-delete census finds the places that remove a record',
    seen.size >= 4,
    'found ' + seen.size + ' — a matcher that has stopped matching demands nothing');

  const unknownDeleter = [...seen.keys()]
    .filter(f => !Object.keys(DELETERS).some(k => f.indexOf(k) !== -1));
  check('no new place deletes a customer without a decision about the trace',
    unknownDeleter.length === 0,
    'new place(s): ' + unknownDeleter.join(', ') +
    '.\n        Deleting a jobAddresses document is irreversible. Either the record ' +
    'survives somewhere (archived, or its id written onto a keeper) or say here why ' +
    'there is nothing to write it onto.');

  /* ⚠ AND THE ONES THAT PROMISED A TRACE ACTUALLY WRITE ONE. Named per site rather than
     asserted once, because the whole finding here was one of several delete sites having
     been fixed while another was not. */
  const missing = [];
  Object.keys(DELETERS).forEach(name => {
    if (!DELETERS[name].trace) return;
    const fn = [...seen.keys()].find(f => f.indexOf(name) !== -1);
    if (!fn) { missing.push(name + ' (no delete found in it at all)'); return; }
    /* ⚠ THE BODY IS FOUND TWO WAYS BECAUSE THESE ARE TWO KINDS OF THING, and the first
       version of this check only knew one — so it reported both button handlers as
       untraced while the trace was sitting in them. A declared function is in `ix.fns`
       with a real range. A button handler has no function name at all: `enclosing` names
       it after the element it is wired to, and the range has to be recovered the same way
       `enclosing` recovers the name, with sectionFrom from the wiring line.
       ⚠ NO CHARACTER WINDOW EITHER WAY — §7 bans them by name, and one here would go
       stale the moment a handler grows. */
    const rec = ix.fns.find(x => x.name === fn);
    let body = '';
    if (rec) {
      body = clean.slice(rec.start, rec.end);
    } else {
      const wire = clean.search(new RegExp("getElementById\\('" + name + "'\\)"));
      if (wire > -1) body = clean.slice(wire, scan.sectionFrom(clean, wire));
    }
    if (!body) { missing.push(name + ' (could not find its body to look in)'); return; }
    if (!/mergedAt\s*:\s*serverTimestamp\(\)/.test(body)) missing.push(name);
  });
  check('every deleter that should record what it removed does',
    missing.length === 0,
    'no mergedAt written in: ' + missing.join(', ') +
    '.\n        The deleted record is gone the moment the delete runs; unless its id is ' +
    'on the keeper, nothing anywhere can say it existed.');

  /* ⚠ THE EMPTY LIST IS DELIBERATE AND MUST STAY WRITTEN OUT. `historyMergeWords` prints
     the bare sentence for an empty list and appends "— took …" for a full one, so the two
     tools read differently on the history without either lying. Dropping the key would
     produce the same sentence by accident, and the next person would "tidy" it in. */
  const dAt = clean.indexOf("updateDoc(doc(db,'jobAddresses', g.keeper.cust.id)");
  check('the duplicate-delete trace write was found', dAt > -1,
    'the checks below prove nothing against a string that is not there');
  if (dAt > -1) {
    const around = clean.slice(dAt, dAt + 320);
    check('the duplicate-delete trace says when', /mergedAt\s*:\s*serverTimestamp\(\)/.test(around),
      'a keeper that absorbed a copy with no date cannot be placed in the history at all');
    check('and which records went', /mergedFromIds\s*:\s*absorbed/.test(around),
      'the ids are the only thing left of them, and only the ones that ACTUALLY went ' +
      'belong here — a refused delete leaves a live duplicate that must not read as absorbed');
    check('and says out loud that it took nothing', /mergedFields\s*:\s*\[\]/.test(around),
      'historyMergeWords prints a different sentence for an empty list than for a full one');
  }

  /* ⚠ AND THE WRITE IS REACHABLE. This one was MISSED by the first red-check pass and is
     the reason the paragraph exists: wrapping the whole block in `if(false)` leaves every
     string above exactly where it is, so all three checks stayed green over a trace that
     could never run. That is this repo's oldest recurring fault — "a message that is in
     the source is not a message on the screen" — and a text check cannot see it.
     ⚠ SO THE GUARD IS ASSERTED AS THE COLLECTED LIST, not merely as some condition. It has
     to be the ids that were actually absorbed, which makes it both the reachability proof
     and the "only write when something really went" rule, in one line. */
  const guardAt = clean.indexOf('if(absorbed.length){');
  check('the trace write is reached by the ids that were really absorbed',
    guardAt > -1 && dAt > -1 && guardAt < dAt,
    'guard at ' + guardAt + ', write at ' + dAt +
    '.\n        Wrapped in anything that is never true, every check above stays green ' +
    'over a trace that can never run.');

  /* ⚠ AND ONLY IDS THAT REALLY WENT ARE RECORDED. Asserted on the push rather than on the
     write, because the ordering is the rule: pushed before the delete, a refused delete
     would be reported as absorbed while the duplicate is still sitting in the book. */
  const pushAt = clean.indexOf('absorbed.push(l.cust.id)');
  const delAt = clean.indexOf("deleteDoc(doc(db,'jobAddresses', l.cust.id))");
  check('an id is recorded as absorbed only after its record actually went',
    pushAt > -1 && delAt > -1 && delAt < pushAt,
    'push at ' + pushAt + ', delete at ' + delAt +
    '. Recorded first, a refused delete reads as absorbed while the duplicate is still there.');
}

/* ---------------------------------------------------------------------------
 * 1f. ARCHIVING A QUOTE IS ONE FACT IN THREE FIELDS.
 *
 * ⚠ TWO OF THE THREE WERE CLEARED, WHICH IS WHY IT WAS EASY TO MISS. Un-archiving set
 * `quoteArchived` false and blanked the reason, and left `quoteArchivedAt` standing — so a
 * restored quote read as archived on a date AND not archived, two fields describing one
 * state and disagreeing. Anything reading the date to decide how long a quote has been
 * closed got an answer about an archiving that was undone.
 *
 * ⚠ NOTHING WOULD HAVE CAUGHT IT: no gate looked at these three together, and each on its
 * own is written correctly. The bug is only visible in the relationship.
 * ------------------------------------------------------------------------- */
{
  const src = SOURCES['functions/index.js'];
  const clean = scan.blankNonCode(src);
  const trio = ['quoteArchived', 'quoteArchivedReason', 'quoteArchivedAt'];
  const wherePut = f => {
    const out = new Set();
    const re = new RegExp('\\bquoteUpdates\\.' + f + '\\s*=', 'g');
    let m;
    while ((m = re.exec(clean))) {
      if (insideComment(src, m.index)) continue;
      out.add(scan.enclosing(scan.index(src, true), m.index) || '(top level)');
    }
    return out;
  };
  const sets = trio.map(wherePut);
  check('the three quote-archive fields were found', sets.every(s => s.size > 0),
    'not written anywhere: ' + trio.filter((f, i) => !sets[i].size).join(', ') +
    '. A matcher that has stopped matching demands nothing.');

  /* ⚠ BY BRANCH, NOT BY FUNCTION — and the first version of this check grouped by function
     and PROVED NOTHING. Both branches live in one function, so deleting the date from the
     un-archive still left it written in the archive branch, the function still "touched all
     three", and two red-check sabotages went straight through. A check that looks right and
     cannot fail is worse than no check; this is that trap caught in the act. */
  const setAt = clean.indexOf('quoteUpdates.quoteArchived = true');
  check('the archive branch was found', setAt > -1,
    'the branch checks below prove nothing against a string that is not there');
  if (setAt > -1) {
    const elseAt = clean.indexOf('} else {', setAt);
    let dep = 0, k = clean.indexOf('{', elseAt), end = k;
    for (; end < clean.length; end++) {
      if (clean[end] === '{') dep++;
      else if (clean[end] === '}') { dep--; if (!dep) break; }
    }
    const onBranch = clean.slice(setAt, elseAt);
    const offBranch = clean.slice(k, end + 1);
    const missingOn = trio.filter(f => onBranch.indexOf(f) === -1);
    const missingOff = trio.filter(f => offBranch.indexOf(f) === -1);
    check('archiving a quote writes all three', missingOn.length === 0,
      'missing from the archive branch: ' + missingOn.join(', '));
    check('and restoring one clears all three', missingOff.length === 0,
      'missing from the restore branch: ' + missingOff.join(', ') +
      '.\n        Archived, the reason and the date are one fact. Clearing two and ' +
      'leaving the third makes a restored quote read as archived on a date AND not ' +
      'archived at the same time — and two of three looks complete, which is exactly ' +
      'why this went unnoticed.');
  }
}

/* ---------------------------------------------------------------------------
 * 1b. The same census for the RECYCLE queue, and the $30 join fee.
 *
 * Addie, 2026-08-28: "Everything that can be changed for members or added to members
 * account including 30 dollars fees or 25 dollar referall discount, anything member
 * portal should be dated."
 *
 * ⚠ MOST OF WHAT SHE NAMED WAS ALREADY DATED, and that was worth checking before
 * building anything: the $25 referral, manual discounts, carried credits, manual fees,
 * the automatic $30 change fee and the carryover charge each carry a `date` on their own
 * note. Two things did not — the recycle queue, which stamped at two of its six places,
 * and the $30 JOIN fee, which is the one fee with no note of its own because it is folded
 * straight into `install`.
 * ------------------------------------------------------------------------- */
const RECYCLE_SITES = [
  { file: 'admin.html', fn: 'editCustRecycleStayBtn handler' },
  { file: 'admin.html', fn: 'editCustSaveBtn handler' },
  { file: 'functions/index.js', fn: 'portalSave' },
  { file: 'functions/index.js', fn: 'portalRsvp' }
];

/* ⭐ THE CREW PORTAL, KNOWN AND DORMANT (added 2026-08-29 with employee.html itself).
 * Owner, 2026-08-21: "were not using the employee portal this year." So these write the
 * same flags the office does and record no date, and that is left alone rather than
 * repaired today — repairing a screen nobody opens is work with no reader.
 *
 * ⚠ NAMED, NOT SKIPPED WHOLESALE. Excluding the file would mean a NEW undated write could
 * appear there and nothing would say so, which is exactly the state that let these sit
 * unseen. Listed, they are a to-do rather than a blind spot: if the portal comes back,
 * this list is what has to be worked through first.
 *
 * ⚠ AND DORMANT IS NOT HARMLESS — this repo learned that once already. silent-failures
 * sweeps this same file because `whToggleRecycle` cleared a customer number and then
 * swallowed the pool write, leaving the number on nobody's record and in no pool.
 */
const DORMANT_CREW_PORTAL = [
  /* ⚠ THESE TWO WERE REPAIRED ON 2026-08-29 rather than left dormant — each was one line,
     and a screen that comes back carrying a known hole is worse than one that comes back
     clean. They stay listed because they still WRITE the flags this census watches; what
     changed is that they now stamp the same dates the office does. */
  /* ⚠ `stamps` MEANS REPAIRED AND HELD REPAIRED. Red-checking proved the difference
     mattered: with these merely listed, removing the recycle date again went completely
     unnoticed — the exception excused the very thing it had just stopped excusing. */
  { fn: 'whToggleRecycle', stamps: 'lightsRecycledAt',
    why: 'ticks a bundle as recycled and blanks the customer number — now stamps ' +
         'lightsRecycledAt on the tick, matching the office path' },
  { fn: 'whToggleLightsNew', stamps: 'lightsMarkedBuiltAt',
    why: 'clears the build flag when a bundle is made — now stamps lightsMarkedBuiltAt ' +
         'on the tick, matching the office path' },
  /* ⚠ LEFT ALONE DELIBERATELY, and it is the one that is not a one-liner. HLX_DONE_KINDS
     lives in admin.html and this is a different file, so dating these three means porting
     the shared rule across — a real job with no reader while the portal is out of use, and
     one that would put a SECOND copy of "what done means" in the codebase unless it is
     done properly. That is the trade, stated rather than hidden. */
  { fn: 'loadRoutesForDate',
    why: 'the crew ticking a stop done — writes completed, removalDone and needsFix ' +
         'straight, never through HLX_DONE_KINDS, so none of the three is dated. Fixing ' +
         'it means porting the shared rule into this file, not adding a stamp' }
];
const dormantKey = fn => 'employee.html · ' + fn;

function censusOf(field, stampRe) {
  const on = new Map(), stamps = new Set();
  for (const [file, raw] of Object.entries(SOURCES)) {
    const clean = scan.blankNonCode(raw);
    const ix = scan.index(raw, true);
    const re = new RegExp(field + '\\s*[:=]\\s*([^,;\\r\\n}]*)', 'g');
    let m;
    while ((m = re.exec(clean))) {
      const v = m[1].trim();
      if (/^false\b/.test(v) || /^==|wasQueued/.test(v)) continue;
      /* ⚠ A FLAG WRITTEN AS AN OBJECT IS NOT A FLAG. The change log's label map has a
         row per editable field, so `needsLightBuild: {label: ...}` reads to this census
         as a fourteenth queueing place at top level. It is a DESCRIPTION of the field,
         not a write of it — and the flag is a boolean, so an object here can never be
         one. Narrow on purpose: excluding the map by name instead would mean every
         future map of these fields has to be remembered. */
      if (v.charAt(0) === '{') continue;
      if (insideComment(raw, m.index)) continue;
      const fn = scan.enclosing(ix, m.index) || '(top level)';
      on.set(file + ' · ' + fn, true);
    }
    let t;
    const sre = new RegExp(stampRe, 'g');
    while ((t = sre.exec(clean))) {
      if (insideComment(raw, t.index)) continue;
      const fn = scan.enclosing(ix, t.index) || '(top level)';
      if (/^function stampRecycle/.test(clean.slice(Math.max(0, t.index - 9), t.index + 30))) continue;
      stamps.add(file + ' · ' + fn);
    }
  }
  return { on, stamps };
}

{
  const { on, stamps } = censusOf('needsLightRecycle', '(lightsRecycleRequestedAt|stampRecycleRequested\\w*\\s*\\()');
  const wantedR = RECYCLE_SITES.map(x => x.file + ' · ' + x.fn);
  const dormant = DORMANT_CREW_PORTAL.map(x => dormantKey(x.fn));
  const strangersR = [...on.keys()].filter(k => wantedR.indexOf(k) === -1 && dormant.indexOf(k) === -1);
  check('no place queues a recycle that nobody has decided about',
    strangersR.length === 0,
    'new place(s): ' + strangersR.join(', ') + '. Either stamp lightsRecycleRequestedAt ' +
    'or add it here with a reason — otherwise that house joins the recycle list with no ' +
    'record of when it was asked for.');
  /* ⚠ THE DORMANT LIST HAS TO STILL DESCRIBE SOMETHING. A name that no longer matches
     anything is an exception protecting nothing, and it would go on quietly excusing a
     function that had been renamed around it. */
  const goneDormant = DORMANT_CREW_PORTAL
    .filter(x => !SOURCES['employee.html'] || SOURCES['employee.html'].indexOf(x.fn) === -1)
    .map(x => x.fn);
  check('every crew-portal exception still names something in that file',
    goneDormant.length === 0,
    'no longer there: ' + goneDormant.join(', ') +
    '. An exception that matches nothing excuses nothing, and hides the rename.');
  check('and every one says why it is left alone',
    DORMANT_CREW_PORTAL.every(x => x.why && x.why.length > 30),
    'without the reason, "known" and "forgotten" look identical in a list of names');

  /* ⚠ THE ONES THAT WERE REPAIRED STAY REPAIRED. An exception list is the natural place
     for a fix to be quietly undone: the name is still listed, so the census says nothing,
     and the date goes away again. Each repaired entry names the field it must write. */
  /* ⚠ COMMENT-BLANKED, because both of these repairs are EXPLAINED in a comment that names
     the very field being counted — so the untick check below saw two mentions and called a
     correct file wrong. That is the comment-mask lesson this repo records in four places,
     hit again inside a check written to enforce it. */
  const crew = scan.blankNonCode(SOURCES['employee.html'] || '');
  const lostStamp = DORMANT_CREW_PORTAL.filter(x => x.stamps).filter(x => {
    const at = crew.indexOf('function ' + x.fn + '(');
    if (at < 0) return true;
    let b = crew.indexOf('{', at), dep = 0, k = b;
    for (; k < crew.length; k++) {
      if (crew[k] === '{') dep++;
      else if (crew[k] === '}') { dep--; if (!dep) break; }
    }
    return crew.slice(b, k + 1).indexOf(x.stamps) === -1;
  }).map(x => x.fn + ' → ' + x.stamps);
  check('the crew-portal writes that were repaired still record when', lostStamp.length === 0,
    'no longer stamps: ' + lostStamp.join(', ') +
    '.\n        These were one-line repairs so the portal cannot come back carrying a ' +
    'known hole. Listed but unstamped, the exception excuses the very thing it stopped ' +
    'excusing.');

  /* ⚠ AND NEITHER STAMPS ON THE UNTICK. Un-ticking is somebody undoing a mis-tick, not a
     bundle being unmade or a set being rebuilt — dated, it records work that did not
     happen, which is worse than recording nothing. */
  const untickStamps = DORMANT_CREW_PORTAL.filter(x => x.stamps).filter(x => {
    const at = crew.indexOf('function ' + x.fn + '(');
    if (at < 0) return false;
    let b = crew.indexOf('{', at), dep = 0, k = b;
    for (; k < crew.length; k++) {
      if (crew[k] === '{') dep++;
      else if (crew[k] === '}') { dep--; if (!dep) break; }
    }
    const body = crew.slice(b, k + 1);
    /* The untick is the branch after the ternary's colon; one stamp in the whole body is
       the tick's, two means the untick got one as well. */
    return (body.split(x.stamps).length - 1) > 1;
  }).map(x => x.fn);
  check('and neither of them dates the untick', untickStamps.length === 0,
    'stamps on both branches: ' + untickStamps.join(', ') +
    '. Un-ticking is a correction, not the work being undone — dated, it records a build ' +
    'or a recycle that never happened and overwrites the one that did.');
  RECYCLE_SITES.forEach(site => {
    const key = site.file + ' · ' + site.fn;
    if (!on.has(key)) { note('recycle site no longer found: ' + key); return; }
    check(key + ' stamps the recycle date', stamps.has(key),
      'it queues a recycle and records no date');
  });
}

check('the $30 join fee records when it was charged',
  /newMemberFeeAppliedAt/.test(SOURCES['functions/index.js']),
  'newMemberFeeApplied says IF the join fee was charged and never WHEN. It is the one ' +
  'fee with no note of its own — it goes straight into `install` — so without this there ' +
  'is nothing to answer a customer querying their bill.');

/* ---------------------------------------------------------------------------
 * 1c. EVERY STEP OF THE PATH CARRIES A DATE.
 *
 * Addie, twice: "Are you sure you have everything that can be changed or moved within the
 * system can be dated?" and then "Okay so all paths are dated?" Both times the honest
 * answer was no, and both times the gap was found by enumerating rather than by asking
 * myself whether I thought it was complete.
 *
 * ⚠ THIS IS A LIST, NOT A COUNT, for the reason MANUAL_ONLY_IDS exists: a number cannot
 * tell a step that was deliberately retired from one that quietly lost its stamp.
 *
 * ⚠ AND IT ASSERTS THE FIELD IS *WRITTEN WITH A TIME*, not merely mentioned. A step whose
 * date is only ever read — because the write was deleted — is exactly the failure the rest
 * of this file exists to catch, and a name-only check would report it green.
 * ------------------------------------------------------------------------- */
const PATH_STEPS = [
  ['a quote is raised',            'createdAt',                'admin.html'],
  ['a quote is sent',              'quoteSentAt',              'admin.html'],
  ['the office marks it approved', 'approvedByOfficeAt',       'admin.html'],
  ['they become a customer',       'convertedToCustomerAt',    'admin.html'],
  ['sent to the warehouse',        'lightsQueuedAt',           'admin.html'],
  ['the bundle is marked built',   'lightsMarkedBuiltAt',      'admin.html'],
  ['they need a day',              'needsDayAssignedAt',       'admin.html'],
  ['put on a crew sheet',          'assignedCrewAt',           'admin.html'],
  ['put on a fix route',           'fixAssignedAt',            'admin.html'],
  ['put on a takedown route',      'removalAssignedAt',        'admin.html'],
  ['a fix is raised',              'fixRaisedAt',              'admin.html'],
  ['the fix is mended',            'fixDoneAt',                'admin.html'],
  ['the lights go up',             'completedAt',              'admin.html'],
  ['the takedown is done',         'removalDoneAt',            'admin.html'],
  ['their old set is asked back',  'lightsRecycleRequestedAt', 'admin.html'],
  /* ⚠ ADDED 2026-08-29, AND IT WAS THE FIRST THING SHE ASKED FOR. "Asked for different
     lights on this date" opened Addie's list. The field has existed for a while and is
     written in three places, so nothing here was ever red — it was simply never listed as
     a step, which is why neither this census nor the history one could see that the
     customer's own history did not show it. A field written everywhere and named on no
     path is the exact shape of hole these two lists exist to catch. */
  ['they ask for different lights', 'lightsChangedAt',         'admin.html'],
  ['they answer the RSVP',         'rsvpRespondedAt',          'admin.html'],
  /* ⚠ ADDED 2026-08-29. Four values ride on `seasonStatus` — a cancellation asked for, an
     address changed, changes needed, changes settled — and not one of them was dated. The
     cancellation is the one that costs: a customer waiting to be let out of the season,
     with a crew still notionally coming, and nothing to sort the queue by. */
  ['their season status changes',  'seasonStatusAt',           'functions/index.js'],
  ['the invoice goes out',         'invoicedAt',               'functions/index.js'],
  ['they pay',                     'paidAt',                   'functions/index.js'],
  ['the $30 join fee is charged',  'newMemberFeeAppliedAt',    'functions/index.js']
];
/* A write with a real time in it: a server sentinel, a Timestamp, a new Date, or the
   `ts` a shared done-rule is handed. Not simply the name appearing somewhere.
   ⚠ BOTH FORMS — `field: value` inside a literal AND `x.field = value`. The first draft
   matched only the literal, and reported three real writes as missing: the office
   approval, the invoice date and the join fee are all assignments. A check that fails on
   correct code is not the safe direction; it is the one that gets switched off. */
const WRITES_A_TIME = new RegExp(
  '\\b%F%\\s*[:=]\\s*(serverTimestamp\\(\\)|ts\\b|new Date|Timestamp\\.|admin\\.firestore)');
/* ⚠ A FLOOR ON THE LIST ITSELF. Red-checking emptied PATH_STEPS and the suite passed —
   every check above simply stopped existing, which is the same shape as a suite that
   cannot find its target and skips. A step legitimately retired should lower this by
   hand, deliberately. */
check('the path still has every step in it',
  PATH_STEPS.length >= 21,
  'PATH_STEPS holds ' + PATH_STEPS.length + ', down from 21. Removing a step deletes its ' +
  'check silently — lower this number in the same change, and say which step went.');

PATH_STEPS.forEach(([label, field, file]) => {
  const src = SOURCES[file];
  const re = new RegExp(WRITES_A_TIME.source.replace('%F%', field));
  check('the path records when ' + label + ' (' + field + ')', re.test(src),
    field + ' is not written with a time anywhere in ' + file + '. A step with no date ' +
    'is a hole in the customer history — you can see it happened and never when, which ' +
    'is the difference between "waiting three weeks" and "raised this morning".');
});

/* ⚠ AND THE RAISE MUST BE HANDED A TIME. `fixRaisedAt: ts` reads perfectly whatever the
   caller passes — red-checking took the argument away and the field then wrote `undefined`
   with every source check still green. The one caller that raises a fix is asserted here,
   because the shape of the rule and the way it is called are two different facts. */
check('the shared done-rule is handed a time for a raise as well as a completion',
  /spec\.off\(serverTimestamp\(\)\)/.test(SOURCES['admin.html']),
  'hlxMarkJobDone calls spec.off() bare, so raising a fix records undefined rather than ' +
  'a date — and nothing about the rule itself would look wrong.');

/* ---------------------------------------------------------------------------
 * 2. RUN the rule — both copies.
 *
 * ⚠ THE CENSUS ABOVE PROVES THE CALL IS THERE. It cannot prove it is right, and the one
 * thing that matters here is a behaviour: an ordinary save of a house that is ALREADY
 * queued must not move its date. Two callers write this flag on every save, preserving
 * whatever it held — so a stamp on the write rather than on the transition would reset
 * the clock every time somebody opened a record to fix a phone number, and "how long
 * has this waited" would always answer "since you last looked at it".
 * ------------------------------------------------------------------------- */
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  let d = 0, k = src.indexOf('{', i);
  for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
  return src.slice(i, k + 1);
}
const browser = lift(SOURCES['admin.html'], 'stampBuildQueued');
const server = lift(SOURCES['functions/index.js'], 'stampBuildQueuedServer');
const browserR = lift(SOURCES['admin.html'], 'stampRecycleRequested');
const serverR = lift(SOURCES['functions/index.js'], 'stampRecycleRequestedServer');
check('both copies of the rule can still be found',
  !!browser && !!server,
  'a rename would make every check below skip rather than fail');

if (browser && server) {
  const mkB = new Function('serverTimestamp', browser + '; return stampBuildQueued;');
  const mkS = new Function('admin', server + '; return stampBuildQueuedServer;');
  const fB = mkB(() => 'TS');
  const fS = mkS({ firestore: { FieldValue: { serverTimestamp: () => 'TS' } } });

  const CASES = [
    ['queued for the first time', { needsLightBuild: true }, false, true],
    ['already queued, saved again', { needsLightBuild: true }, true, false],
    ['re-queued after being built', { needsLightBuild: true }, false, true],
    ['the flag is being cleared', { needsLightBuild: false }, true, false],
    ['the flag is not in this write', { housePrice: 400 }, false, false]
  ];
  CASES.forEach(([label, updates, wasQueued, wantStamp]) => {
    const b = Object.assign({}, updates), s = Object.assign({}, updates);
    fB(b, wasQueued); fS(s, wasQueued);
    check('browser: ' + label + (wantStamp ? ' → stamped' : ' → left alone'),
      (b.lightsQueuedAt !== undefined) === wantStamp,
      wantStamp ? 'no date was recorded'
                : 'it stamped a date it should not have — ' +
                  (label.indexOf('already') === 0
                    ? 'this is the one that matters: an ordinary save would reset the wait'
                    : 'that write is not a queueing'));
    check('server agrees about ' + label,
      (s.lightsQueuedAt !== undefined) === (b.lightsQueuedAt !== undefined),
      'the office and the portal would disagree about when a house was queued');
  });
}

/* ⚠ AND THE RECYCLE RULE IS RUN TOO. Red-checking caught this missing: the cases above
   exercised only the build helper, so making the recycle one stamp on every write instead
   of on the transition passed cleanly — the same bug, in the copy nobody was running. */
check('both copies of the recycle rule can still be found', !!browserR && !!serverR,
  'a rename would make the checks below skip rather than fail');
if (browserR && serverR) {
  const fR = new Function('serverTimestamp', browserR + '; return stampRecycleRequested;')(() => 'TS');
  const sR = new Function('admin', serverR + '; return stampRecycleRequestedServer;')(
    { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } });
  [['queued for the first time', { needsLightRecycle: true }, false, true],
   ['already waiting, saved again', { needsLightRecycle: true }, true, false],
   ['the flag is not in this write', { housePrice: 400 }, false, false]
  ].forEach(([label, u, was, want]) => {
    const b = Object.assign({}, u), sv = Object.assign({}, u);
    fR(b, was); sR(sv, was);
    check('recycle, browser: ' + label + (want ? ' → stamped' : ' → left alone'),
      (b.lightsRecycleRequestedAt !== undefined) === want,
      want ? 'no date recorded' : 'an ordinary save would reset when the set was asked for');
    check('recycle, server agrees about ' + label,
      (sv.lightsRecycleRequestedAt !== undefined) === (b.lightsRecycleRequestedAt !== undefined),
      'the office and the portal would disagree');
  });
}

console.log('');
if (failed) { console.log('  ' + failed + ' failure(s):'); failures.forEach(f => console.log('   - ' + f)); console.log(''); }
console.log(passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
process.exit(failed ? 1 : 0);
