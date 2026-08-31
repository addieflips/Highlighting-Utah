/* ONE ROUTE NOTE A DAY, AND NOTHING LOST GETTING THERE
 * ====================================================
 * `npm run test:digest` — its own file per R-018.
 *
 * Addie, 2026-08-30: "system inbox always has a bunch of schedule messages and it's to
 * many to keep up with. How can we fix this". Shown the options she chose ONE DIGEST A
 * DAY.
 *
 * ⚠ THE VOLUME WAS NOT A BUG, WHICH IS WHY NOTHING WAS RED. `reconcileUpcomingRoutes`
 * runs every fifteen minutes and every notice it wrote was true; `reconcileNoteIsRepeat`
 * already suppressed the word-for-word identical ones. A day on which the routes really
 * do keep changing is up to ninety-six DIFFERENT true notices, and true-and-unreadable
 * is still unreadable — an inbox nobody can keep up with is one where the note that
 * matters is missed.
 *
 * SO THE SWEEP BANKS AND THE DAY POSTS. `noticeRoutesReconciled` hands its lines to
 * `routeDigestBank`, which merges them into `settings/routeDigest` against today's date.
 * `routeDigestFlush` writes the note — once, on the first sweep of the NEXT day, covering
 * the whole of the one before. That is the cost Addie accepted: a date that moves this
 * afternoon is in tomorrow's digest, not this afternoon's inbox.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. Several sweeps in one day post NOTHING and bank everything, deduped.
 *   2. The first sweep of a new day posts EXACTLY ONE note, about the day before.
 *   3. The closing "nobody has been told about any date that moved" line survives
 *      whatever else is trimmed. It is the reason the note exists at all.
 *   4. A line saying part of the sweep DID NOT TAKE is first in the note, whatever hour
 *      of the day it was found.
 *   5. A flush that is refused CARRIES THE LINES FORWARD. This is the one that would be
 *      silent: the bank is rewritten wholesale, so without it a failed note deletes the
 *      very day it was trying to report.
 *   6. A refused flush still leaves a short record in the System folder. A toast is gone
 *      the moment the office looks away and the routes have already been rewritten.
 *   7. The bank is a DOCUMENT. The dashboard is closed and reopened all day and runs on
 *      more than one machine; a day's changes held in a variable are lost at the first
 *      refresh.
 *
 * ⚠ EVERY CHECK HERE RUNS THE SHIPPED FUNCTIONS. Each claim is about a NOTE THAT REACHES
 * THE INBOX or a LINE THAT SURVIVES — and this repo has been caught more than once by a
 * regex proving the words exist in the file while the code could never reach the screen
 * (the ledger render, 2026-08-19). The two structural checks that remain say so in place.
 *
 * ⚠ WINDOWS ARE CLIPPED AT A REAL STRUCTURAL MARKER. CLAUDE.md §7 bans fixed-length
 * extraction windows by name, and the meta-check enforcing that reads only run-all.js —
 * so nothing but this paragraph stops one appearing here. `sectionFrom` is LIFTED out of
 * run-all.js rather than copied, per the repo's "lift, don't stub" rule: a second copy of
 * a subtle helper is the copy that stops matching.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];

/* Each numbered block below is async. They are QUEUED and awaited before the summary
   prints, because a check that scores after the summary has printed can never fail the
   build — the lesson Suite 10 earned in run-all.js. Declared up here so the blocks can
   reach it; `const` in TDZ is a ReferenceError at load, not a lazy one. */
const queued = [];
function block(fn) { queued.push(fn); }

function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

/* sectionFrom — lifted, not copied. See the header. */
const sectionFrom = (function () {
  const suite = read('run-all.js');
  const start = suite.indexOf('function sectionFrom(src, start) {');
  if (start === -1) {
    throw new Error(
      'sectionFrom could not be found in run-all.js. It was lifted rather than copied so ' +
      'the two cannot drift; if it moved or was renamed, repoint this lift — do NOT paste ' +
      'a fresh copy in here.');
  }
  const end = suite.indexOf('\n}\n', start);
  if (end === -1) throw new Error('sectionFrom found but its end was not — repoint this lift.');
  // eslint-disable-next-line no-eval
  return eval('(' + suite.slice(start, end + 2).replace('function sectionFrom', 'function') + ')');
})();

const admin = read('admin.html');

/* ---------------------------------------------------------------------------
 * The landmarks, asserted BEFORE anything is lifted.
 *
 * An extractor that has quietly stopped matching reports no violations — a green build
 * for the worst possible reason, and the same shape as a suite that cannot find its
 * target and skips.
 * ------------------------------------------------------------------------- */
const iBank  = admin.indexOf('async function routeDigestBank(lines){');
const iFlush = admin.indexOf('async function routeDigestFlush(bank){');
const iCap   = admin.indexOf('const ROUTE_DIGEST_MAX_LINES');

check('routeDigestBank is findable', iBank !== -1,
  'renamed or removed — repoint this file rather than deleting it');
check('routeDigestFlush is findable', iFlush !== -1,
  'renamed or removed — repoint this file rather than deleting it');
check('the line cap is a named constant', iCap !== -1,
  'a number written into the merge cannot be read by the note that reports the overflow');

if (iBank === -1 || iFlush === -1 || iCap === -1) {
  report();
}

const capLine = (admin.match(/const ROUTE_DIGEST_MAX_LINES = \d+;/) || [])[0] || '';
const src = capLine + '\n' + sectionFrom(admin, iBank) + '\n' + sectionFrom(admin, iFlush);

/* ---------------------------------------------------------------------------
 * 1. THE BANK IS A DOCUMENT, NOT A VARIABLE.
 *
 * Structural, and it is the one claim here that a behavioural check cannot make: a
 * harness supplies its own storage either way, so a module-level array would pass every
 * run below and lose a day's changes at the first page refresh. Addie's office reloads
 * the dashboard all day and runs it on more than one machine.
 * ------------------------------------------------------------------------- */
check('the bank is written to Firestore, not held in memory',
  /setDoc\(ref, \{/.test(src) && /doc\(db,'settings','routeDigest'\)/.test(src),
  'a day of route changes in a `let` is a day of route changes lost at the first refresh');
check('and it is read back before it is written',
  src.indexOf('await getDoc(ref)') !== -1 &&
  src.indexOf('await getDoc(ref)') < src.indexOf('await setDoc(ref'),
  'writing without reading first would replace the day rather than adding to it — every ' +
  'sweep would erase the ones before it');

/* ---------------------------------------------------------------------------
 * THE HARNESS. A fake Firestore over a plain object, so a second call really does see
 * what the first one wrote — which is what the whole mechanism is about.
 * ------------------------------------------------------------------------- */
function makeDigest(opts) {
  const o = opts || {};
  const store = {};
  const posted = [];
  const toasts = [];
  let refused = 0;
  let today = o.today || '2026-08-30';
  const ctx = {
    db: {},
    doc: (...a) => ({ __path: a.slice(1).join('/') }),
    collection: (...a) => ({ __col: a[1] }),
    serverTimestamp: () => '__ts__',
    getDoc: async (ref) => ({
      exists: () => Object.prototype.hasOwnProperty.call(store, ref.__path),
      data: () => store[ref.__path]
    }),
    setDoc: async (ref, payload) => {
      if (o.refuseBank) throw new Error('Missing or insufficient permissions.');
      store[ref.__path] = JSON.parse(JSON.stringify(payload));
    },
    addDoc: async (col, payload) => {
      /* `refuseNote` refuses the LONG note only, which is the real-world case the short
         fallback exists for: the 5,000-character rule on `messages` refuses by CONTENT,
         so a shorter body genuinely can succeed where a longer one did not.
         ⚠ IT REFUSES BY CONTENT, NOT BY A CHARACTER COUNT, and the first draft of this
         file got that wrong: a threshold sitting between the two bodies stopped
         discriminating the moment a fixture had only one line in it, so every
         carry-forward check below passed over a note that was never refused. The closing
         tail is the thing that makes the long note the long one, and block 4 asserts that
         tail independently — so if it is ever reworded, that check fails loudly rather
         than this one going quiet. `refused` counts them and the blocks that rely on it
         ASSERT it fired. */
      if (o.refuseShort) { refused++; throw new Error('Missing or insufficient permissions.'); }
      if (o.refuseNote && /Nobody has been told/.test(String(payload.message))) {
        refused++;
        throw new Error('Missing or insufficient permissions.');
      }
      posted.push({ col: col.__col, payload });
      return { id: 'm' + posted.length };
    },
    toDateStr: () => today,
    toast: (t) => { toasts.push(t); },
    console: { error() {}, warn() {}, log() {} }
  };
  const names = Object.keys(ctx);
  const api = new Function(...names,
    src + '\nreturn {bank: routeDigestBank, flush: routeDigestFlush, cap: ROUTE_DIGEST_MAX_LINES};'
  )(...names.map(n => ctx[n]));
  return {
    bank: api.bank, flush: api.flush, cap: api.cap,
    store, posted, toasts,
    refusedCount: () => refused,
    setDay: (d) => { today = d; },
    digest: () => store['settings/routeDigest'] || {}
  };
}

/* ---------------------------------------------------------------------------
 * 2. SEVERAL SWEEPS IN ONE DAY POST NOTHING.
 *
 * This is the complaint itself, so it is checked with more than one sweep and with
 * different lines each time — a fixture that repeats one sweep's lines would pass on
 * `reconcileNoteIsRepeat` alone, which existed before this and did not fix the problem.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    await h.bank(['3 houses moved to a different day — Ashley Wray.']);
    await h.bank(['1 stop updated to match the customer record.']);
    await h.bank(['3 houses moved to a different day — Ashley Wray.']);
    check('several sweeps in one day put nothing in the inbox',
      h.posted.length === 0,
      'this is the complaint — got ' + h.posted.length + ' note(s)');
    check('and every distinct line is banked',
      (h.digest().lines || []).length === 2,
      'banked: ' + JSON.stringify(h.digest().lines));
    check('and a line found twice is banked once',
      (h.digest().lines || []).filter(l => /Ashley Wray/.test(l)).length === 1,
      'a sweep that finds the same thing every fifteen minutes would otherwise fill the ' +
      'day with one sentence repeated ninety times');
    check('the bank is dated',
      h.digest().day === '2026-08-30',
      'without a day the flush can never tell yesterday from today, and either posts ' +
      'every sweep or never posts at all');
  });
}

/* ---------------------------------------------------------------------------
 * 3. THE FIRST SWEEP OF A NEW DAY POSTS EXACTLY ONE NOTE.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    await h.bank(['3 houses moved to a different day — Ashley Wray.']);
    await h.bank(['2 houses taken off a day — Said No.']);
    h.setDay('2026-08-31');
    await h.bank(['1 stop updated to match the customer record.']);

    check('the first sweep of the next day posts one note',
      h.posted.length === 1,
      'got ' + h.posted.length + ' — one a day is what was asked for');
    const note = (h.posted[0] || { payload: {} }).payload;
    check('it goes to the System folder, where the office looks',
      note.folder === 'System' && note.topic === 'Routes Kept Up To Date');
    check('it says which day it is about',
      /2026-08-30/.test(note.message || ''),
      'a digest with no date on it cannot be acted on — got: ' +
      String(note.message).slice(0, 90));
    check('it carries the whole of the previous day, not just the last sweep',
      /Ashley Wray/.test(note.message || '') && /Said No/.test(note.message || ''),
      'banking and then reporting only the final sweep would lose most of the day');
    check('it does NOT carry the new day’s lines',
      !/updated to match/.test(note.message || ''),
      'two days run together in one note and neither is answerable');
    check('and the new day starts its own bank',
      h.digest().day === '2026-08-31' &&
      (h.digest().lines || []).length === 1,
      'got: ' + JSON.stringify(h.digest()));

    /* And a second sweep on that new day must not post again. */
    await h.bank(['something else happened.']);
    check('and a second sweep the same day does not post again',
      h.posted.length === 1,
      'the roll-over must fire once, not on every sweep after it — got ' + h.posted.length);
  });
}

/* ---------------------------------------------------------------------------
 * 4. THE CLOSING LINE SURVIVES THE TRIM.
 *
 * "Nobody has been told about any date that moved" is the reason the note exists at all
 * — the routes have been rewritten and the customers have not been rung. A digest is a
 * whole day of lines rather than one sweep's, so the trim is far likelier to fire than
 * it ever was, which is exactly why this is checked by RUNNING it over a day big enough
 * to trigger it rather than by matching the source.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    const many = [];
    for (let i = 0; i < 150; i++) many.push('House number ' + i + ' moved to a different day, ' +
      'and here is a good deal more text so that this one line is not far off a hundred characters.');
    await h.bank(many);
    h.setDay('2026-08-31');
    await h.bank(['one more thing.']);

    const note = (h.posted[0] || { payload: {} }).payload;
    const msg = String(note.message || '');
    check('a day too big for one note is still posted',
      h.posted.length === 1, 'got ' + h.posted.length);
    check('and it fits inside the 5,000-character rule on messages',
      msg.length < 5000,
      'the create is all-or-nothing: over the ceiling the WHOLE note is refused — got ' +
      msg.length);
    check('and the closing line is still on the end of it',
      /Nobody has been told about any date that moved/.test(msg) &&
      msg.trim().endsWith('they need telling.'),
      'the part that says nobody has been told is the part that must never be cut');
    check('and it says it was trimmed rather than pretending to be complete',
      /trimmed to fit in one note/.test(msg),
      'a digest that quietly loses half a day is worse than one that says it did');
  });
}

/* ---------------------------------------------------------------------------
 * 5. THE LINE CAP TRIMS WITH A COUNT.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    const many = [];
    for (let i = 0; i < h.cap + 25; i++) many.push('line ' + i);
    await h.bank(many);
    check('the bank never grows past its cap',
      (h.digest().lines || []).length === h.cap,
      'got ' + (h.digest().lines || []).length + ' of ' + h.cap);
    check('and what would not fit is counted, not silently dropped',
      h.digest().dropped === 25,
      'got ' + h.digest().dropped);
    h.setDay('2026-08-31');
    await h.bank(['a new day']);
    check('and the note says how many it could not hold',
      /25 more change\(s\)/.test(String((h.posted[0] || { payload: {} }).payload.message)),
      'a count nobody is shown is the same as no count');
    check('and the overflow count resets once the day has been reported',
      h.digest().dropped === 0,
      'carrying it forward would over-report every day after a busy one — got ' +
      h.digest().dropped);
  });
}

/* ⚠ AND IT DOES NOT RESET WHEN THE NOTE WAS REFUSED. Added after the red-check found it
   uncovered: the reset is right for a day that went out and wrong for a day carried
   forward, and the two are one line apart. Left resetting on refusal, the note that
   finally posts says "and 0 more that would not fit" over a day that lost twenty-five —
   under-reporting a loss, which is the direction that gets nobody looking. */
{
  const h = makeDigest({ refuseNote: true });
  block(async () => {
    const many = [];
    for (let i = 0; i < h.cap + 25; i++) many.push('line ' + i);
    await h.bank(many);
    h.setDay('2026-08-31');
    await h.bank(['a new day']);
    check('the fixture really did refuse the overflowing day’s note',
      h.refusedCount() === 1, 'got ' + h.refusedCount() + ' refusal(s)');
    check('a day carried forward keeps its own overflow count',
      h.digest().dropped >= 25,
      'the note that finally posts would under-report what the day lost — got ' +
      h.digest().dropped);
  });
}

/* ---------------------------------------------------------------------------
 * 6. A LINE SAYING PART OF THE SWEEP DID NOT TAKE IS FIRST.
 *
 * `report.writeFailed` means a route and a customer record now disagree about which day
 * a house is on — tier 3, and the sweep runs on a timer with nobody standing there. Per
 * sweep it was first for free, because the note was written on the spot and that line was
 * built first. Over a whole day it is one line among a hundred, trimmed from the end.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    await h.bank(['3 houses moved to a different day.']);
    await h.bank(['1 stop updated to match the customer record.']);
    await h.bank(['⚠ 2 customer records would not update — Ashley Wray. Their day on ' +
      'the route and the day on their own record now disagree.']);
    await h.bank(['4 more houses moved.']);
    h.setDay('2026-08-31');
    await h.bank(['a new day']);

    const msg = String((h.posted[0] || { payload: {} }).payload.message);
    check('a refused write found late in the day is reported first',
      msg.indexOf('would not update') !== -1 &&
      msg.indexOf('would not update') < msg.indexOf('stop updated to match'),
      'the note is trimmed from the END, so the one line saying part of the sweep did ' +
      'not take has to be at the top');
    check('and everything else keeps the order it happened in',
      msg.indexOf('3 houses moved to a different day') < msg.indexOf('stop updated to match') &&
      msg.indexOf('stop updated to match') < msg.indexOf('4 more houses moved'),
      'a full sort would shuffle a day of changes into an order nobody can follow');
  });
}

/* ---------------------------------------------------------------------------
 * A LINE THAT TURNED UP IN EVERY SWEEP IS A LOOP, AND SAYS SO.
 *
 * Addie, 2026-08-31: "I don't even know why there are so many changes being made in
 * schedule and it is concerning."
 *
 * ⚠ THE DIGEST ANSWERED THE VOLUME AND NOT THE QUESTION. One note a day is what she
 * asked for, but deduplicating hides the thing she is actually worried about: a line
 * that appears in ONE sweep is a real change, and the same line appearing in FORTY is
 * the sweep undoing and redoing its own work all day. In one note those look identical,
 * so the fix for the noise was quietly making the cause harder to see.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    /* The same sentence found by eight sweeps, plus one that really did happen once. */
    for (let i = 0; i < 8; i++) await h.bank(['12 houses taken off a day — a S Summit Crest Ln day.']);
    await h.bank(['1 stop updated to match the customer record.']);
    h.setDay('2026-08-31');
    await h.bank(['a new day']);

    const msg = String((h.posted[0] || { payload: {} }).payload.message);
    check('a line found by eight sweeps says how many times',
      /happened 8 times today/.test(msg),
      'got: ' + msg.slice(0, 200));
    check('and the one that happened once is left alone',
      /1 stop updated to match the customer record\.(?!\s*\[)/.test(msg),
      'a count on a single real change is noise on the thing that is not the problem');
    check('and the note says what a repeat usually means',
      /repeated all day/.test(msg) && /STREET/.test(msg) && /Health Check/.test(msg),
      '"this repeated 40 times" is a symptom nobody can act on — the note has to name ' +
      'the two things that actually cause it, both fixable from a customer record');
    check('and that warning is at the top, where the trim cannot reach it',
      msg.indexOf('repeated all day') < msg.indexOf('taken off a day'),
      'the body is trimmed from the END');
  });
}

/* ⚠ AND TWICE IS NOT A LOOP. Two sweeps can honestly find the same thing — a house moved
   at ten past and another moved onto the same day at twenty past produce one identical
   sentence twice. Three is where it stops being a coincidence, and a threshold that fires
   at two would put a warning on ordinary days, which is how a warning gets ignored. */
{
  const h = makeDigest();
  block(async () => {
    await h.bank(['2 houses moved to a different day.']);
    await h.bank(['2 houses moved to a different day.']);
    h.setDay('2026-08-31');
    await h.bank(['a new day']);
    const msg = String((h.posted[0] || { payload: {} }).payload.message);
    check('a line found twice is not called a loop',
      !/happened 2 times/.test(msg) && !/repeated all day/.test(msg),
      'got: ' + msg.slice(0, 160));
  });
}

/* ⚠ AND THE COUNTS DO NOT GROW WITHOUT BOUND. Only lines that survived the trim keep a
   count — carrying one for a line no longer in the bank grows the document across a long
   day, and Firestore has a size limit. That ceiling is what the reconcile note hit in
   2026-08-19, reported as "Missing or insufficient permissions". */
{
  const h = makeDigest();
  block(async () => {
    const many = [];
    for (let i = 0; i < h.cap + 40; i++) many.push('line ' + i);
    await h.bank(many);
    const d = h.digest();
    const counted = Object.keys(d.seen || {});
    check('a trimmed line does not keep a count nobody can see',
      counted.length <= h.cap,
      'got ' + counted.length + ' counts for ' + (d.lines || []).length + ' lines');
    check('and every count belongs to a line that is still banked',
      counted.every(k => (d.lines || []).indexOf(k) !== -1),
      'a count for a line that is gone is a document that grows for ever');
  });
}

/* ---------------------------------------------------------------------------
 * 7. A REFUSED NOTE CARRIES THE DAY FORWARD.
 *
 * ⭐ THE ONE THAT WOULD BE SILENT. The bank is rewritten wholesale on every sweep, so
 * without this a flush that failed would delete the very day it was reporting — the
 * sweep rewrote real routes and the only record of it goes in the bin with nothing on
 * screen. `routeDigestFlush` returns whether it wrote; the bank reads that.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest({ refuseNote: true });
  block(async () => {
    await h.bank(['3 houses moved to a different day — Ashley Wray.']);
    h.setDay('2026-08-31');
    await h.bank(['1 stop updated to match the customer record.']);

    check('the fixture really did refuse the day’s note',
      h.refusedCount() === 1,
      'a carry-forward check over a note that was never refused passes for free — got ' +
      h.refusedCount() + ' refusal(s)');
    const lines = h.digest().lines || [];
    check('a day whose note was refused is not thrown away',
      lines.some(l => /Ashley Wray/.test(l)),
      'the bank is rewritten wholesale — got: ' + JSON.stringify(lines));
    check('and the carried lines say which day they belong to',
      lines.some(l => /carried over from 2026-08-30/.test(l)),
      '"3 houses moved" is not answerable if you cannot tell which day it is about');
    check('and today’s own lines are still banked beside them',
      lines.some(l => /stop updated to match/.test(l)),
      'rescuing yesterday must not cost today');

    /* And once the note can be written again, both days go out together. */
    h.toasts.length = 0;
    const h2 = makeDigest();
    await h2.bank(lines.slice());
    h2.setDay('2026-09-01');
    await h2.bank(['later still']);
    const msg = String((h2.posted[0] || { payload: {} }).payload.message);
    check('and they go out on the next day the note can be written',
      /Ashley Wray/.test(msg) && /stop updated to match/.test(msg),
      'carrying forward is only worth anything if it eventually posts — got: ' +
      msg.slice(0, 120));
  });
}

/* ---------------------------------------------------------------------------
 * 8. A REFUSED NOTE STILL LEAVES A RECORD, AND SAYS SO ON SCREEN.
 *
 * The argument is unchanged from the per-sweep note it replaces (Suite 71, restored
 * 2026-08-19 after a paste-over dropped it): a toast is gone the moment the office looks
 * away, and this is the last step of a sweep that has ALREADY rewritten real routes.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest({ refuseNote: true });
  block(async () => {
    await h.bank(['3 houses moved to a different day.']);
    h.setDay('2026-08-31');
    await h.bank(['a new day']);

    check('the fixture really did refuse the long note',
      h.refusedCount() === 1,
      'got ' + h.refusedCount() + ' refusal(s) — with none, every check below passes for free');
    check('a refused digest is said on screen straight away',
      h.toasts.some(t => /could not be saved/.test(t)),
      'the immediate half — the office is looking at the page right now');
    check('and a short note still reaches the System folder',
      h.posted.length === 1 && h.posted[0].payload.folder === 'System',
      'a toast is not a record; routes have already been rewritten by this point');
    check('the short note says how many things changed and which day',
      /1 thing\(s\) changed/.test(String((h.posted[0] || { payload: {} }).payload.message)) &&
      /2026-08-30/.test(String((h.posted[0] || { payload: {} }).payload.message)),
      'a note that does not say the sweep did anything is no better than silence');
  });
}

/* ---------------------------------------------------------------------------
 * 9. NOTHING TAKES THE SWEEP DOWN WITH IT.
 *
 * The digest is the LAST step of `reconcileUpcomingRoutes`, which has already rewritten
 * routes and customer records by the time it runs. Throwing here would strand the caller
 * mid-sweep, which is strictly worse than a missing note.
 * ------------------------------------------------------------------------- */
{
  block(async () => {
    let threw = null;
    const h = makeDigest({ refuseNote: true, refuseShort: true });
    try {
      await h.bank(['3 houses moved.']);
      h.setDay('2026-08-31');
      await h.bank(['a new day']);
    } catch (e) { threw = e; }
    check('both notes being refused does not throw',
      threw === null,
      threw ? ('it threw ' + threw.message) : undefined);
    check('and the day is still carried rather than lost',
      (h.digest().lines || []).some(l => /3 houses moved/.test(l)),
      'the short note names no houses and no days, so it is a flag that something ' +
      'happened, not the record — the lines still have to be carried');

    let threw2 = null;
    const h2 = makeDigest({ refuseBank: true });
    try { await h2.bank(['3 houses moved.']); } catch (e) { threw2 = e; }
    check('a bank that cannot be written does not throw either',
      threw2 === null,
      threw2 ? ('it threw ' + threw2.message) : undefined);
    check('and it is not silent about it',
      h2.toasts.some(t => /could not be saved/.test(t)),
      'the sweep has already rewritten routes; losing the record of it silently is the ' +
      'failure this whole block exists for');
  });
}

/* ---------------------------------------------------------------------------
 * 10. AN EMPTY DAY POSTS NOTHING.
 * ------------------------------------------------------------------------- */
{
  const h = makeDigest();
  block(async () => {
    h.setDay('2026-08-31');
    await h.bank([]);
    check('a day with nothing in it raises no note',
      h.posted.length === 0,
      'a daily "nothing changed" is the next thing the office learns to skim past');
  });
}

/* ---------------------------------------------------------------------------
 * Run the queued blocks, then report. See the note beside `queued` at the top.
 * ------------------------------------------------------------------------- */
(async () => {
  for (const fn of queued) {
    try { await fn(); }
    catch (e) {
      check('a block of this file ran to the end', false,
        'it threw ' + e.message + '\n        ' + String(e.stack || '').split('\n')[1]);
    }
  }
  report();
})();

function report() {
  console.log('');
  console.log('=== One route note a day ===');
  console.log('');
  if (failed) {
    console.log('  ' + failed + ' failure(s):');
    failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
    console.log('');
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
