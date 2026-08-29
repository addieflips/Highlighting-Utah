#!/usr/bin/env node
/* ============================================================================
 * THE CUSTOMER'S OWN HISTORY — every dated step reaches the page that shows it.
 *
 * Addie, asked what a journey view should be: "dating when everything is done for each
 * costumer through the system we have set", and then the list — "a cancelled button or a
 * be back next year date. or maybe next year date or requoted on. Or asked for different
 * lights on this date or changed timer settings this date. Changed address this date."
 *
 * The dates were built first. This is the thing that READS them, and until it existed
 * five of them were written by real code and read by nothing — which the Connections map
 * refused to declare, correctly, because a field written everywhere and read nowhere is a
 * dead end (R-010).
 *
 * ⚠ THE FAILURE THIS GATE EXISTS FOR IS A STEP THAT NEVER REACHES THE PAGE. Adding a
 * date to the record is half a job; if nothing lists it, the history is quietly missing a
 * line and looks complete while doing it. So the check is a CENSUS AGAINST queue-date's
 * own PATH_STEPS: every step of the path either appears in HISTORY_STEPS or is named here
 * as deliberately absent, with the reason. One list is read out of the other so the two
 * cannot drift.
 *
 * ⚠ AND IT RUNS THE RULE. A census proves a step is listed; only running it proves the
 * row is RIGHT — that an undated step is shown as undated rather than dropped or sorted
 * to one end, which is the difference between "we do not know when" and a fabricated
 * order somebody will act on.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let passed = 0, failed = 0, notes = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(m) { notes++; console.log('  NOTE  ' + m); }

const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

console.log('');
console.log('=== The customer\'s own history ===');
console.log('');

/* ---------------------------------------------------------------------------
 * 0. Lift the real rule and run it.
 *
 * ⚠ LIFTED, NEVER RE-IMPLEMENTED. A second copy of the step list written in this file
 * would agree with itself about exactly the thing under test. fmtMoney and toJsDate are
 * stubbed because they are shared helpers with their own coverage; everything that
 * decides what a history row SAYS is the shipped code.
 * ------------------------------------------------------------------------- */
function liftBlock(name, open, close) {
  const re = new RegExp('(?:^|\\n)(?:const|function|async function)\\s+' + name + '\\b');
  const m = re.exec(admin);
  if (!m) return '';
  const start = m.index + (admin[m.index] === '\n' ? 1 : 0);
  let i = admin.indexOf(open, start), d = 0, k = i;
  if (i < 0) return '';
  for (; k < admin.length; k++) {
    if (admin[k] === open) d++;
    else if (admin[k] === close) { d--; if (!d) break; }
  }
  return admin.slice(start, k + 1) + (open === '[' ? ';' : '');
}
const PARTS = {
  HISTORY_STEPS: liftBlock('HISTORY_STEPS', '[', ']'),
  historyRsvpWords: liftBlock('historyRsvpWords', '{', '}'),
  /* ⚠ LIFTED THE MOMENT THE RULE GAINED IT. customerHistory calls this for the season
     status line, so without it every check here dies on one name — which is what
     happened, loudly, rather than the line silently reading wrong. */
  historySeasonWords: liftBlock('historySeasonWords', '{', '}'),
  historyMergeWords: liftBlock('historyMergeWords', '{', '}'),
  /* ⚠ LIFTED, NEVER STUBBED. A stub keeps this file green through a change to what
     the colour-change line SAYS — and what it says is the whole point of the row:
     "they changed it themselves" and "the office put it in for them" are the two
     answers the warehouse badge already tells apart, and the history must not be
     the one screen that flattens them. */
  historyLightsWords: liftBlock('historyLightsWords', '{', '}'),
  historyNoteRows: liftBlock('historyNoteRows', '{', '}'),
  customerHistory: liftBlock('customerHistory', '{', '}')
};
check('every piece of the history rule was found in admin.html',
  Object.values(PARTS).every(Boolean),
  'a gate that cannot find its target must never report green. Missing: ' +
  Object.keys(PARTS).filter(k => !PARTS[k]).join(', '));

let STEPS = [], history = null, rsvpWords = null;
if (Object.values(PARTS).every(Boolean)) {
  const r = new Function('fmtMoney', 'toJsDate', 'PAYMENT_METHOD_LABEL',
    Object.values(PARTS).join('\n') +
    '\nreturn {STEPS: HISTORY_STEPS, history: customerHistory, rsvpWords: historyRsvpWords};')(
      n => '$' + (Number(n) || 0).toFixed(2),
      v => {
        if (!v) return null;
        if (v instanceof Date) return v;
        if (typeof v.toDate === 'function') return v.toDate();
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      },
      { manual: 'Entered by hand', paypal: 'Card (PayPal)' });
  STEPS = r.STEPS; history = r.history; rsvpWords = r.rsvpWords;
}

/* ---------------------------------------------------------------------------
 * 1. The census — every step of the path reaches the history.
 * ------------------------------------------------------------------------- */
/* ⚠ READ OUT OF queue-date.test.js, NOT TYPED HERE. That file is where the path is
   declared and where a new step gets added; a copy of its list in this file is a second
   place to keep true, and the copy that falls behind is the one nobody looks at. */
const qd = fs.readFileSync(path.join(ROOT, 'queue-date.test.js'), 'utf8');
const pathFields = [];
{
  const at = qd.indexOf('const PATH_STEPS = [');
  const end = qd.indexOf('];', at);
  const block = at > -1 ? qd.slice(at, end) : '';
  const re = /\[\s*'[^']*',\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(block))) pathFields.push(m[1]);
}
check('the path steps were read out of queue-date.test.js',
  pathFields.length >= 19,
  'found ' + pathFields.length + '. A census that has stopped matching demands nothing ' +
  'at all, which is the worst kind of green.');

/* ⚠ EACH ABSENCE CARRIES ITS REASON, and the reason is checked. A bare list of field
   names cannot tell a step deliberately left off from one somebody forgot. */
const NOT_IN_HISTORY = {
  paidAt: 'payments are their own ledger with several rows per invoice, so they come ' +
    'from the payments collection rather than a single date on the record'
};
const stepFields = STEPS.map(s => s.field);
const missing = pathFields.filter(f => stepFields.indexOf(f) === -1 && !(f in NOT_IN_HISTORY));
check('every step of the path reaches the history',
  missing.length === 0,
  'not listed: ' + missing.join(', ') +
  '.\n        Add it to HISTORY_STEPS so it shows on the customer\'s history, or to ' +
  'NOT_IN_HISTORY with the reason. Left out, that step is silently missing from every ' +
  'customer\'s history and the page looks complete while doing it.');

/* ---------------------------------------------------------------------------
 * 1b. THE ONE SHE ASKED FOR BY NAME.
 *
 * Addie's list of what she wanted dated opened with "asked for different lights on this
 * date". `lightsChangedAt` has existed for a while — written by the portal, by Edit
 * Customer and by the sheet sync, read by the Color Changes tab and the warehouse badge —
 * and was simply never listed here. So the one event she named first was the one missing
 * from the page built to answer her, and nothing anywhere said so.
 *
 * ⚠ THESE RUN THE RULE, they do not read it. Every claim is about a SENTENCE a person
 * reads, and this repo has been caught four times by a check that matched the source of a
 * message which could never reach the screen.
 * ------------------------------------------------------------------------- */
{
  const D = v => new Date(v + 'T12:00:00Z');
  check('a colour change appears on the history at all',
    stepFields.indexOf('lightsChangedAt') !== -1,
    'the first thing Addie asked to be dated, absent from the page built to answer her');

  const portal = history({ cust: { lightsChangedAt: D('2026-08-10'), lightsChangedVia: 'portal' } });
  const office = history({ cust: { lightsChangedAt: D('2026-08-10'), lightsChangedVia: 'office' } });
  const older  = history({ cust: { lightsChangedAt: D('2026-08-10') } });

  check('a change the customer made themselves says so',
    /portal/i.test(portal.rows[0].what),
    'got: ' + portal.rows[0].what);
  check('a change the office put in says so instead',
    /office/i.test(office.rows[0].what) && !/portal/i.test(office.rows[0].what),
    'got: ' + office.rows[0].what);

  /* ⚠ THE TWO MUST NOT COLLAPSE INTO ONE SENTENCE. They are the same event from opposite
     ends and the warehouse badge already tells them apart; a history that prints one word
     for both is the screen that flattens them. Asserted as a DIFFERENCE rather than as two
     separate matches, because a rule returning one fixed string containing both words
     would pass both checks above. */
  check('and the two are not the same sentence',
    portal.rows[0].what !== office.rows[0].what,
    'both read: ' + portal.rows[0].what);

  /* ⚠ AN UNRECORDED ORIGIN GUESSES NOTHING. Every colour change made before 2026-08-24
     carries no `lightsChangedVia`, and picking one of the two on a coin toss prints a
     confidently wrong claim beside a real date — worse than an honest silence, and the
     rule the badge already keeps. */
  check('a change from before we recorded who made it claims neither',
    !/portal/i.test(older.rows[0].what) && !/office/i.test(older.rows[0].what),
    'got: ' + older.rows[0].what);

  /* ⚠ AND IT IS ITS OWN LINE, NOT THE BUILD-QUEUE LINE. A colour change queues a build, so
     the two sit together on a real record and it is tempting to read one as the other —
     but a build is also queued by joining, by a re-quote, by a wire change and by coming
     back after a recycle, and only one of those is somebody picking different colours. */
  const both = history({ cust: { lightsChangedAt: D('2026-08-10'),
    lightsQueuedAt: D('2026-08-10'), lightsChangedVia: 'portal' } });
  check('a colour change and the build it queued are two lines, not one',
    both.rows.length === 2 &&
    both.rows.filter(r => /different lights/i.test(r.what)).length === 1 &&
    both.rows.filter(r => /warehouse/i.test(r.what)).length === 1,
    'got: ' + both.rows.map(r => r.what).join(' | '));
}

const strangers = stepFields.filter(f => pathFields.indexOf(f) === -1);
if (strangers.length) note('history lists ' + strangers.length + ' field(s) the path does ' +
  'not: ' + strangers.join(', ') + '. Not a failure — but if the path has dropped one, ' +
  'drop it here too.');

const noReason = Object.keys(NOT_IN_HISTORY).filter(f => String(NOT_IN_HISTORY[f]).length < 20);
check('every deliberately-absent step says why', noReason.length === 0,
  'no reason: ' + noReason.join(', '));

check('every history step says which record it is read from',
  STEPS.every(s => ['cust', 'inv', 'quote'].indexOf(s.from) !== -1),
  'a step with no record is read off nothing and silently never appears');
check('and every one has words to show',
  STEPS.every(s => s.what && s.what.length > 3));

/* ---------------------------------------------------------------------------
 * 2. The rule, RUN.
 * ------------------------------------------------------------------------- */
if (history) {
  const D = (s) => new Date(s + 'T12:00:00Z');

  /* ⚠ NEWEST FIRST. A history is read from the top for the last thing that happened. */
  const ordered = history({
    cust: { completedAt: D('2026-10-14'), lightsQueuedAt: D('2026-09-02'),
            lightsMarkedBuiltAt: D('2026-09-09') }
  });
  check('the history comes back newest first',
    ordered.rows.map(r => r.what)[0] === 'Lights went up' &&
    ordered.rows[ordered.rows.length - 1].what === 'Sent to the warehouse to be built',
    'read for the last thing that happened, a history sorted the other way answers ' +
    'the wrong question first');

  check('a step the record has no date for is simply absent',
    ordered.rows.length === 3 && ordered.undated.length === 0,
    'a field the record never carried is not an event that happened');

  /* ⚠ THE CASE THE WHOLE SHAPE EXISTS FOR. Every customer on file before the stamps
     shipped has flags set and no dates. Dropped, the history claims it never happened;
     sorted to one end, it invents an order. */
  const noDate = history({ cust: { completedAt: '', lightsQueuedAt: 'not a date',
                                   lightsMarkedBuiltAt: D('2026-09-09') } });
  check('something that happened with no date recorded is shown, not dropped',
    noDate.undated.length === 1 && noDate.undated[0].what === 'Sent to the warehouse to be built',
    'dropped, the history quietly claims it never happened');
  check('and it is kept OUT of the dated order, not sorted to one end',
    noDate.rows.length === 1 && noDate.rows.every(r => r.at instanceof Date),
    'a row with no date has no place in a sequence, and putting it at one end invents ' +
    'an order somebody will read as real');
  check('a blank is not read as an event at all',
    noDate.undated.length === 1,
    'an empty string is a field nobody filled in, not a thing that happened');

  /* ⚠ THE FIVE DATES THIS WAS BUILT FOR. Each was written and read by nothing until
     now; a history that silently omits one leaves that field a dead end again. */
  const five = history({
    cust: { lightsQueuedAt: D('2026-09-02'), lightsRecycleRequestedAt: D('2026-12-02'),
            assignedCrewAt: D('2026-09-20'), fixRaisedAt: D('2026-11-01') },
    invoice: { newMemberFeeAppliedAt: D('2026-10-15') }
  });
  check('all five of the new dates reach the history',
    five.rows.length === 5,
    'these are exactly the fields Connections refused to declare because nothing read ' +
    'them; a history missing one leaves it a dead end');

  /* ⚠ THE RECORD EACH IS READ FROM IS LOAD-BEARING. convertedToCustomerAt is written
     onto the QUOTE, so reading it off the customer returns nothing for everybody and
     the day they joined silently disappears. */
  check('the day they became a customer is read off the quote',
    history({ quote: { convertedToCustomerAt: D('2026-08-01') } }).rows.length === 1 &&
    history({ cust: { convertedToCustomerAt: D('2026-08-01') } }).rows.length === 0,
    'it is written onto the quote, not the customer — read off the wrong record it is ' +
    'missing from every history and nothing says so');

  /* ⚠ THE MERGE LINE IS THE ONLY RECORD OF SOMETHING OTHERWISE UNRECOVERABLE. A merge
     writes another record's values onto this one and then deletes that record — so if this
     does not say what was taken, nothing anywhere can, and "where did this address come
     from" has no answer at all. */
  const merged = history({ cust: { mergedAt: D('2026-07-01'),
    mergedFields: ['address', 'housePrice', 'gateCode'] } });
  check('a merge appears on the history', merged.rows.length === 1);
  check('and it names the fields it took',
    /took address, housePrice, gateCode/.test(merged.rows[0].what),
    '"merged with a duplicate" beside a date leaves the actual question — which of these ' +
    'fields is not theirs — exactly where it was');
  check('and a merge that recorded no fields still reads sensibly',
    /Merged with a duplicate/.test(history({ cust: { mergedAt: D('2026-07-01') } }).rows[0].what),
    'every record merged before this shipped carries the date and no field list');

  /* ⚠ THE LINE BETWEEN SEASONS, and it is the reason the history is readable at all after
     a reset. Start New Season clears the flags and KEEPS every date, so without a divider
     last season's install sits in the list looking exactly like this season's. */
  const twoSeasons = history({ cust: {
    completedAt: D('2025-10-14'), seasonResetAt: D('2026-08-01'),
    lightsQueuedAt: D('2026-09-02') } });
  check('a season reset appears as a line in the history',
    twoSeasons.rows.some(r => /new season started/i.test(r.what)),
    'without it the two years run together and last October reads as this October');
  check('and it sits between the two seasons, not at either end',
    twoSeasons.rows.map(r => /new season/i.test(r.what)).indexOf(true) === 1,
    'newest-first, the divider belongs above everything that happened before it');

  /* ⚠ THE CANCELLATION LINE SAYS WHICH STATUS IT WAS, and keeps what it changed from.
     "Season status changed on the 4th" cannot say whether they were cancelling or
     correcting their address, and those two need opposite actions from the office. Both
     of these were MISSED by the first red-check of this feature — the census demanded the
     field reach the page, and nothing demanded the words be useful. */
  const season = (s, was) => history({ cust: { seasonStatusAt: D('2026-10-04'),
    seasonStatus: s, seasonStatusWas: was } }).rows[0].what;
  check('asking to cancel says so in words',
    /asked to cancel/i.test(season('cancellation_requested', 'confirmed')),
    'a bare "season status changed" beside a date is the question restated');
  check('and an address change is not confused with a cancellation',
    /address changed/i.test(season('address_changed', '')),
    'they are the same field and opposite jobs — one lets somebody out of the season');
  check('and it keeps what the status changed from',
    /was confirmed/.test(season('cancellation_requested', 'confirmed')),
    'without it the line cannot say whether this undid something');
  check('a status nobody recognises is reported, not invented',
    /something else/.test(season('something else', '')),
    'guessing at an unknown status puts a decision in the customer\'s mouth');

  /* ⚠ THE RSVP LINE SAYS WHAT THEY ANSWERED. "Answered the RSVP" beside a date leaves
     the one question anybody is asking of it unanswered. */
  const said = (s) => history({ cust: { rsvpRespondedAt: D('2026-08-20'), rsvpStatus: s } }).rows[0].what;
  check('the RSVP row says what they actually answered',
    /yes/.test(said('yes')) && /\bno\b/.test(said('no')) && /back next year/.test(said('backnextyear')),
    'a date beside "answered the RSVP" leaves the only question anybody asks unanswered');
  check('and an answer nobody recognises does not invent one',
    rsvpWords({ rsvpStatus: 'something else' }) === 'Answered the RSVP',
    'guessing at an unknown status puts words in the customer\'s mouth');

  /* ⚠ MONEY NOTES CARRY THEIR OWN DATES, several to an invoice, which is why they are
     read rather than being given stamps of their own. */
  const money = history({
    invoice: { changeFeeNotes: [{amount: 30, reason: 'New colours', date: D('2026-11-02')}],
               creditNotes: [{amount: 25, reason: 'Referral', date: D('2026-10-03')}] },
    cust: { carryoverChargeNotes: [{amount: 30, reason: 'Late change', date: D('2026-12-20')}] }
  });
  check('the money notes each become a dated line',
    money.rows.length === 3 && /\$30\.00/.test(money.rows[0].what),
    'these are the only record of when a fee or a credit was applied');
  /* ⚠ THE CARRYOVER NOTES ARE ON THE CUSTOMER, because Start New Season zeroes the
     invoice — parked there the charge would be deleted rather than carried. */
  check('and the carryover charge is read off the customer, not the invoice',
    history({ cust: { carryoverChargeNotes: [{amount: 30, date: D('2026-12-20')}] } }).rows.length === 1 &&
    history({ invoice: { carryoverChargeNotes: [{amount: 30, date: D('2026-12-20')}] } }).rows.length === 0,
    'Start New Season zeroes the invoice, so a charge parked there is deleted rather ' +
    'than carried — read off the invoice this line is always empty');

  const paid = history({ payments: [
    {amount: 200, method: 'manual', paidAt: D('2026-11-05')},
    {amount: 150, method: 'paypal', paidAt: D('2026-12-01')}] });
  check('every payment is its own line, newest first',
    paid.rows.length === 2 && /\$150\.00/.test(paid.rows[0].what) &&
    /Card \(PayPal\)/.test(paid.rows[0].what),
    'one date could not show a part payment followed by the rest');

  /* ⚠ THE EDITS ARE THE HALF SHE ASKED FOR BY NAME — "changed timer settings this
     date. Changed address this date." The dated steps say a stage was reached; only
     the activity log says what somebody altered. */
  const edits = history({ activity: [
    {what: 'Edited Jane Smith — Timer: off → on', who: 'addie@x.com', at: D('2026-09-30')},
    {what: '', who: 'addie@x.com', at: D('2026-09-30')}] });
  check('an edit from the activity log becomes a line, naming who made it',
    edits.rows.length === 1 && /Timer: off → on/.test(edits.rows[0].what) &&
    /addie@x\.com/.test(edits.rows[0].what),
    'this is the half that answers "changed address this date"');
  check('and an empty entry is not drawn as a blank row',
    edits.rows.length === 1 && edits.undated.length === 0);

  /* ⚠ THE SOURCES INTERLEAVE. A history that grouped by source would put the payment
     under the invoice rather than on the day it happened, which is the one thing the
     whole page is for. */
  const mixed = history({
    cust: { completedAt: D('2026-10-14') },
    invoice: { invoicedAt: D('2026-10-15') },
    payments: [{amount: 400, method: 'manual', paidAt: D('2026-10-20')}],
    activity: [{what: 'Edited them — Phone: 801 → 385', at: D('2026-10-16')}]
  });
  check('all four sources sort into one sequence by date',
    mixed.rows.map(r => r.kind).join(',') === 'money,edit,step,step',
    'grouped by source instead, the day something happened stops being the thing you ' +
    'read down the page');

  check('a customer with nothing on file comes back empty rather than throwing',
    history({}).rows.length === 0 && history().rows.length === 0,
    'a record that failed to load must not take the form down with it');
}

/* ---------------------------------------------------------------------------
 * 3. The wiring — asserted separately from the rule.
 *
 * ⚠ THIS SUITE RUNS THE RULE FROM ITS OWN HARNESS, so deleting the panel or its loader
 * would leave every check above green while nothing appeared on screen. That is the shape
 * this repo has shipped before — the recycle "bin says" box that rendered an input whose
 * listener had silently not applied, identical on screen to a working one, npm test green.
 * ------------------------------------------------------------------------- */
check('the form carries a history panel', /id="editCustHistory"/.test(admin),
  'without the box the loader writes into nothing');
check('and the panel is collapsed until it is asked for',
  /<details id="editCustHistoryWrap"/.test(admin),
  'open by default it pushes the buttons off a form opened dozens of times a day, and ' +
  'runs two queries nobody asked for');
{
  const at = admin.indexOf('function openEditCustomerModal(');
  const end = admin.indexOf('\nfunction parseCustLights(', at);
  const open = at > -1 ? admin.slice(at, end) : '';
  check('opening a record resets the history panel', /histWrap.open = false/.test(open),
    'this same function repoints the form at a SIBLING house, so a panel left open ' +
    'shows the previous customer\'s history under the new customer\'s name');
  check('and empties it, not just closes it', /histBox.innerHTML = ''/.test(open),
    'closed but still full, the old rows are one click from being read as this ' +
    'customer\'s');
  check('the loader is bound once, not on every open', /_histBound/.test(open),
    'openEditCustomerModal runs on every house-tab click, so re-binding fires the two ' +
    'queries once per click ever made — the accumulating-listener bug that put 2815 ' +
    'writes behind one drag in the Inbox');
  check('and it loads only when the panel is actually opened',
    /if\(histWrap\.open\) renderCustomerHistory/.test(open),
    'loading on open of the FORM runs two queries for every record anybody glances at');
}
check('a failed lookup is reported rather than read as an empty history',
  /\[HU\] history: payments/.test(admin) && /\[HU\] history: activity/.test(admin),
  'an empty history and one that would not load look identical, and only one of them ' +
  'means nothing has happened to this customer');

console.log('');
console.log(passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
if (failed) {
  console.log('');
  console.log('Failing: ' + failures.join(' | '));
  process.exit(1);
}
