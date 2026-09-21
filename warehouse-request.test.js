/* warehouse-request.test.js — A BUILD ADDED IN THE WAREHOUSE CHANGES THE CUSTOMER.
 *
 * ⭐ WHY THIS FILE EXISTS ([[WH-44]], 2026-09-21). Addie, shown a `Doug Smith — extra
 * request` card beside an ordinary colour group: "I dont want it to look like the first
 * picture but I want all of them to look like the second picture even if I add them in
 * warehouse. If I add them in warehouse it should also update there lights in member
 * portal, and costumers."
 *
 * ⛔ IT IS A MONEY PATH, WHICH IS THE WHOLE REASON IT GETS ITS OWN FILE (R-018). Asked
 * directly whether this door should charge, Addie: "Yes should charge the fee." So a third
 * door now writes $30 onto somebody's bill, and the two census gates that fired when it was
 * built (queue-date, colour-change) prove only that the door is DECLARED and that it stamps
 * the right fields — neither of them runs it. Nothing anywhere asserted that it charges the
 * right person the right amount, that Cancel writes nothing, or that a first-time colour is
 * still free. A regex cannot see arithmetic.
 *
 * ⚠ THE RULES ARE LIFTED, THE I/O IS STUBBED. `applyLightChange`, `houseLightsText`,
 * `houseBundleNeed`, `whTimerOnlyQueue` and `stampBuildQueued` are the real ones — stubbing
 * any of them would decide the very thing under test, which is this repo's oldest lesson
 * about these sandboxes. Firestore, the popup and the toast are fakes, because what they do
 * is not the claim.
 *
 * ⚠ AND `askLightChangeFee` IS A FAKE THAT ANSWERS, not one that always says yes. Three of
 * the checks below are about what the OTHER two answers do, and a stub that could only say
 * "charge" would make them vacuous while reporting green.
 */
const fs = require('fs');
const path = require('path');
const scan = require('./connections/scan.js');

const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const ix = scan.index(admin, true);

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : '')); }
}
function head(t) { console.log('\n=== ' + t + ' ===\n'); }

function lift(name) {
  const hits = ix.fns.filter(f => f.name === name);
  if (!hits.length) return '';
  const f = hits.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);
  return ix.src.slice(f.start, f.end + 1) + '\n';
}

head('The rules this gate runs are still there');

const NEEDED = ['whAddRequestToCustomer', 'houseLightsText', 'lightsLockMillis',
                'houseBundleNeed', 'whTimerOnlyQueue', 'stampBuildQueued',
                'lightChangeCarryoverUpdates', 'estimateFeetFromPrice'];
const src = {};
const missing = [];
NEEDED.forEach(n => { src[n] = lift(n); if (!src[n]) missing.push(n); });
check('every rule this gate runs is still in admin.html', missing.length === 0,
  missing.length ? 'renamed or removed: ' + missing.join(', ') : '');
if (missing.length) { console.log(''); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }

/* js/money.js is an ES module; the sandbox is not. Stripping `export ` is what
   money-parity already does, and it keeps the REAL fee rule rather than a copy. */
const money = fs.readFileSync(path.join(ROOT, 'js', 'money.js'), 'utf8')
  .replace(/^export\s+/gm, '');

const PREAMBLE = [
  money,
  'let perFootRate = 4;',
  'const FEET_PER_BUNDLE = 40;',
  src.estimateFeetFromPrice, src.houseLightsText, src.lightsLockMillis,
  src.houseBundleNeed, src.whTimerOnlyQueue, src.stampBuildQueued,
  src.lightChangeCarryoverUpdates, src.whAddRequestToCustomer
].join('\n');

/* One run of the real function against fakes. `answer` is what the office presses at the
   fee popup; `null` means the popup must never be reached at all. */
async function run(record, o) {
  const opts = o || {};
  const outcome = { writes: [], invoiceFees: [], asked: 0, logged: 0 };
  const make = new Function(
    'serverTimestamp', 'updateDoc', 'doc', 'db', 'askLightChangeFee',
    'addLightChangeFeeToInvoice', 'logActivity', 'toast', 'console', 'out',
    PREAMBLE + '\nreturn whAddRequestToCustomer;');
  const fn = make(
    () => '<<serverTimestamp>>',
    async (ref, updates) => { outcome.writes.push({ ref, updates }); },
    (_db, col, id) => ({ col, id }),
    {},
    async () => { outcome.asked++; return opts.answer; },
    async (key, change) => { outcome.invoiceFees.push({ key, amount: change.feeAmount }); },
    () => { outcome.logged++; },
    () => {},
    { error() {}, warn() {}, log() {} },
    outcome);
  const linked = { id: 'h1', data: Object.assign({}, record) };
  outcome.result = await fn(linked, opts.kind || 'lights', opts.pattern || 'Red, Green',
    opts.wire === undefined ? 'Green' : opts.wire, opts.qty === undefined ? 1 : opts.qty);
  outcome.linked = linked;
  outcome.updates = outcome.writes.length ? outcome.writes[0].updates : null;
  return outcome;
}

const BASE = {
  name: 'Doug Smith', phone: '8015550123', measuredFeet: 160,
  lightsDescription: 'Warm White', wireColor: 'White'
};

(async function () {
  head('It charges, and it charges the right person');

  const charged = await run(BASE, { answer: 'charge' });
  check('a colour change outside the free window asks about the $30',
    charged.asked === 1,
    'the office must get the same three answers this change gets everywhere else');
  check('and the fee lands on their own invoice',
    charged.invoiceFees.length === 1 && charged.invoiceFees[0].amount === 30 &&
    charged.invoiceFees[0].key === '8015550123',
    'keyed by custInvoiceKey, which is the phone digits — got ' +
    JSON.stringify(charged.invoiceFees));
  check('the colours really reach the record',
    charged.updates && charged.updates.lightsDescription === 'Red, Green',
    'this is the whole of "it should also update there lights in member portal, and costumers"');
  check('and the wire with them',
    charged.updates && charged.updates.wireColor === 'Green');
  check('the build is queued and dated',
    charged.updates && charged.updates.needsLightBuild === true &&
    charged.updates.lightsQueuedAt === '<<serverTimestamp>>',
    'the queue date is what the 72-hour hold reads — unstamped, the hold never starts');
  check('it is stamped as an office change, which is the REQUEST badge',
    charged.updates && charged.updates.lightsChangedVia === 'office',
    'whBuildReasonKey reads this exact value to draw her REQUEST badge');
  check('and it reaches the colour-change list too',
    charged.updates && charged.updates.needsColorChange === true &&
    charged.updates.colorChangeColors === 'Red, Green',
    'a colour change that reaches no list is silence, and their existing bin still ' +
    'has to be dealt with');

  head('The two answers that are not "charge"');

  /* ⛔ THE ONE THAT MATTERS MOST. Cancel is offered at the point of saving because nobody
     goes back to undo a fee later — so it has to write NOTHING AT ALL, not merely skip the
     charge. A version that wrote the record and skipped the fee would look identical on
     screen and would have re-coloured a house nobody agreed to re-colour. */
  const cancelled = await run(BASE, { answer: 'cancel' });
  check('Cancel writes nothing whatsoever',
    cancelled.writes.length === 0 && cancelled.invoiceFees.length === 0 &&
    cancelled.result.ok === false,
    'it asks BEFORE the first write precisely so there is nothing to take back');

  const waived = await run(BASE, { answer: 'waive' });
  check('waiving still changes the lights, and charges nobody',
    waived.writes.length === 1 && waived.invoiceFees.length === 0 &&
    waived.updates.lightsDescription === 'Red, Green');
  check('and waiving still sets the 48-hour route lock',
    waived.updates && waived.updates.lightsLockedUntil instanceof Date,
    'the lock is about the crew, not the money: their pattern may still move, so they ' +
    'must not be routed either way');

  head('When it must NOT charge');

  /* A first-time colour is not a change. Getting this wrong is what let the whole imported
     book re-colour for free once, from the other direction — and here it would charge
     somebody $30 for filling in a blank. */
  const firstTime = await run({ name: 'New House', phone: '8015550999', measuredFeet: 160 },
    { answer: 'charge' });
  check('filling in colours for the first time is free and never asks',
    firstTime.asked === 0 && firstTime.invoiceFees.length === 0,
    'applyLightChange refuses a first-time colour; the popup must not be reached at all');
  check('but it still queues the build',
    firstTime.updates && firstTime.updates.needsLightBuild === true,
    'free is not the same as nothing to make');

  const inWindow = await run(Object.assign({}, BASE, {
    lightsLockedUntil: { toMillis: () => Date.now() + 36 * 3600 * 1000 }
  }), { answer: 'charge' });
  check('a change inside their own free window is free',
    inWindow.asked === 0 && inWindow.invoiceFees.length === 0,
    'lightsLockMillis is read off the record — hard-coding 0 here would charge somebody ' +
    'inside the window they were promised');

  const sent = await run(Object.assign({}, BASE, { invoiceEmailSent: true }), { answer: 'charge' });
  check('a bill already sent carries the fee to next season instead',
    sent.invoiceFees.length === 0 && Number(sent.updates.carryoverCharge) === 30,
    'invoiceEmailSent is only ever cleared by Start New Season, so a fee posted to a ' +
    'sent bill would sit there and reach nobody');

  head('The number she types');

  /* Addie: "The number I type wins but the automatic number should still come up."
     160 ft at 40 ft a bundle is 4, so 4 must store nothing and 6 must store 6. */
  const derived = await run(BASE, { answer: 'charge', qty: 4 });
  check('a typed count equal to the derived one is not stored',
    derived.updates && derived.updates.buildBundleOverride === undefined,
    'a value that agrees today lies the moment their footage is corrected');
  const overridden = await run(BASE, { answer: 'charge', qty: 6 });
  check('a typed count that disagrees wins',
    overridden.updates && overridden.updates.buildBundleOverride === 6,
    'this is the half of her sentence that changes what gets built');

  head('A timer is not a colour change');

  const timer = await run({ name: 'Timer Only', phone: '8015550777' },
    { kind: 'timer', pattern: 'Timer', wire: '', qty: 1, answer: 'charge' });
  check('a timer request sets the timer on their record',
    timer.updates && timer.updates.outletTimer === 'Yes',
    'the crew portal and every printed sheet read this field, which the old form never wrote');
  check('and charges nothing',
    timer.asked === 0 && timer.invoiceFees.length === 0,
    'no glass moved; applyLightChange is not consulted at all');
  check('and never touches their colours',
    timer.updates && timer.updates.lightsDescription === undefined &&
    timer.updates.wireColor === undefined,
    'a timer request must not rewrite a pattern nobody asked about');
  check('a house with no colours goes to the timer queue, not the build queue',
    timer.updates && timer.updates.needsTimerOnly === true &&
    timer.updates.needsLightBuild === undefined,
    'whTimerOnlyQueue exists so a timer-only house is not parked under a heading ' +
    'nobody can act on');

  head('The panel repaints from the cache, so the cache has to be right');

  check('the write is mirrored onto the local record',
    charged.linked.data.lightsDescription === 'Red, Green' &&
    charged.linked.data.needsLightBuild === true,
    'the warehouse tab repaints from jobAddresses rather than re-reading Firestore, so ' +
    'without this the row visibly springs back and somebody presses it twice');
  check('and the mirror carries real dates, never the sentinel',
    charged.linked.data.lightsQueuedAt instanceof Date,
    'a serverTimestamp() sentinel is not a date until it comes back from Firestore');

  check('one write, not two', charged.writes.length === 1,
    'two awaited writes can half-succeed, and the half that survives would be a house ' +
    'with new colours and no build queued');

  console.log('\n=======================================================');
  console.log('Warehouse request — ' + pass + ' passed, ' + fail + ' failed');
  console.log('=======================================================\n');
  if (fail) { failures.forEach(f => console.log('  - ' + f)); console.log(''); process.exit(1); }
})();
