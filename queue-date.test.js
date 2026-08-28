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
const SOURCES = { 'admin.html': read('admin.html'), 'functions/index.js': read('functions/index.js') };

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
const NOT_A_QUEUE = [{ file: 'admin.html', fn: 'setCustomerSeason' }];

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
  const strangersR = [...on.keys()].filter(k => wantedR.indexOf(k) === -1);
  check('no place queues a recycle that nobody has decided about',
    strangersR.length === 0,
    'new place(s): ' + strangersR.join(', ') + '. Either stamp lightsRecycleRequestedAt ' +
    'or add it here with a reason — otherwise that house joins the recycle list with no ' +
    'record of when it was asked for.');
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
