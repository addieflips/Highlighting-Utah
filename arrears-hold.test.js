/*
 * Last season's unpaid bill — carried, and holding them out of this season
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-08-31, in two answers that only work together:
 *   "Carry it onto this year's bill."
 *   "If they didn't pay last year they should not be scheduled to be hung."
 * and, asked how a payment against a bill holding two debts is read:
 *   "If they were billed 400 last year and paid 400 last year than it is cleared
 *    but if they needed to pay 800 and paid only 400 than bill is not cleared and
 *    we cannot schedule them."
 *
 * ⚠ WHAT THIS REPLACES. Start New Season wrote `install: newInstall, deposit: 0`
 * over every invoice, so an unpaid customer opened the new season owing this
 * year's charge and nothing else — the debt written off in silence for all ~967
 * customers, surviving only inside a yearlySnapshot nothing bills from.
 *
 * ⚠ THE RULE DECIDES WHO GETS A CREW, so nearly every check here RUNS the shipped
 * code rather than matching its source. A regex over admin.html cannot see that a
 * customer who has paid comes out held anyway, and this repo has been caught three
 * times by a check that read the source of behaviour that could never happen.
 *
 * ⚠ AND IT LIFTS, IT NEVER STUBS. The money rule is imported from js/money.js —
 * the real module the browser loads — and the predicates are lifted out of
 * admin.html. A stub here would agree with itself and prove nothing about what
 * ships, which is the whole failure this file exists to catch.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node arrears-hold.test.js      (or: npm run test:arrears)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lifts a function by name, slicing to its closing brace at column 0 — the same
   terminator every other harness in this repo relies on.
 *
 * ⚠ BRACE-COUNTING WAS TRIED FIRST AND SILENTLY TRUNCATED isOutForSeason. The
 * scanner skipped quoted text so a brace inside a string could not close the
 * function early, which is right — but it treated an apostrophe inside a COMMENT
 * as opening a string ("somebody who's", and this file is mostly prose), so the
 * quote state desynced and the count closed 9,000 characters early. It came back
 * as a function that parsed as far as the RSVP branch and simply ended.
 *
 * ⚠ SO EVERY LIFT IS PARSED BEFORE IT IS USED (liftOk below). A truncated lift is
 * the worst failure available here: it produces a plausible function that answers
 * confidently and wrongly, and the suite reports green while testing a rule that
 * ends halfway.
 *
 * ⚠ AND `async` IS HANDLED, because extractFn's habit of matching only
 * `function NAME(` is written up in CLAUDE.md as having cost three suites a run:
 * the body arrives full of bare `await`, which is a parse error that kills the
 * whole file as one unattributable crash. */
function lift(name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = admin.indexOf(opener);
    if (at === -1) continue;
    const end = admin.indexOf('\n}', at);
    if (end === -1) return '';
    return admin.slice(at, end + 2);
  }
  return '';
}
function liftOk(src) {
  if (!src) return false;
  try { new Function(src + '\nreturn 1;'); return true; } catch (e) { return false; }
}

/* ⚠ COMMENTS OUT FIRST, AND THIS FILE EARNED THE RULE ON ITS FIRST RUN. The check
 * below asserts the reset no longer contains `changeFees: 0, changeFeeNotes: []`
 * — and the comment that was added to admin.html to EXPLAIN the change quotes that
 * very line to say what it replaced. So a correct file failed a check about it.
 * Suites 58, 274 and 275 each learned the same thing separately; §7 has the general
 * form of it. Match the code, never the prose describing the code. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* The season reset's invoice write, sliced to its own structural end rather than
   by a character count — §7 bans fixed-length extraction windows by name, and a
   window here would go stale the moment the write grows. */
function seasonResetWrite() {
  const at = admin.indexOf("return updateDoc(doc(db,'invoices', x.id), {");
  if (at === -1) return '';
  const end = admin.indexOf('priceReviewed: true', at);
  return end === -1 ? '' : stripComments(admin.slice(at, end));
}

(async function main() {
  const money = await import('./js/money.js');

  /* ---------------------------------------------------------------------
     1. The rule itself, run against Addie's own two examples.
     --------------------------------------------------------------------- */
  const billed = (amount, paid, credits) => ({
    changeFeeNotes: amount ? [{ amount: amount, kind: 'arrears', year: 2026, reason: 'Unpaid balance carried from the 2026 season' }] : [],
    changeFees: amount || 0,
    deposit: paid || 0,
    credits: credits || 0
  });

  check('billed 400 last year and paid 400 — cleared',
    money.owesFromLastSeason(billed(400, 400)) === false,
    'her own example, and the one that decides whether somebody gets a crew');
  check('needed to pay 800 and paid only 400 — not cleared',
    money.owesFromLastSeason(billed(800, 400)) === true,
    'a part-payment must not release anybody; her words are "bill is not cleared ' +
    'and we cannot schedule them"');
  /* ⚠ THE BOUNDARY IS WHERE A PROPORTIONAL READING WOULD DIFFER. Anything that
     released somebody at "most of it" passes the two rows above and fails here. */
  check('one dollar short is still not cleared',
    money.owesFromLastSeason(billed(400, 399)) === true,
    'nearly paid is not paid');
  check('overpaying is cleared',
    money.owesFromLastSeason(billed(400, 450)) === false);

  /* ⚠ A FIXTURE THAT ONLY EVER CARRIES ARREARS CANNOT TELL THE LEDGER APART FROM
     A TOTAL. The fee ledger holds light-change fees too, and reading the whole of
     changeFees as last season's debt would hold every customer who ever changed
     their colours. */
  check('a light-change fee is not last season\'s debt',
    money.owesFromLastSeason({ changeFees: 30, deposit: 0, credits: 0,
      changeFeeNotes: [{ amount: 30, reason: 'Light change' }] }) === false,
    'a $30 colour change would otherwise hold them out of the season for ever');
  check('and a mixed ledger counts only the arrears line',
    money.arrearsOnInvoice({ changeFeeNotes: [
      { amount: 30, reason: 'Light change' },
      { amount: 400, kind: 'arrears', reason: 'Unpaid balance carried from the 2026 season' }
    ] }) === 400,
    'got ' + money.arrearsOnInvoice({ changeFeeNotes: [
      { amount: 30, reason: 'Light change' },
      { amount: 400, kind: 'arrears' }] }));
  check('a customer who owed 400 and changed colours is cleared by paying the 400',
    money.owesFromLastSeason({ changeFees: 430, deposit: 400, credits: 0, changeFeeNotes: [
      { amount: 30, reason: 'Light change' },
      { amount: 400, kind: 'arrears' }] }) === false,
    'oldest first — this year\'s fee is not what is being tested');

  /* ⚠ CREDITS ARE THE ONE WAY A HOLD LIFTS WITHOUT CASH, and it is deliberate:
     a credit is the office deciding the money is not owed, recorded as money on
     the invoice rather than as a hidden override flag. Addie asked for no "hang
     them anyway" button and there is none. */
  check('a credit covering the debt releases them',
    money.owesFromLastSeason(billed(400, 0, 400)) === false,
    'writing it off is the recorded way, and Q-013 already names a credit as how ' +
    'an "our fault" case is settled');

  /* ⚠ FAIL-SAFE DIRECTION. Every unknown in the season rule keeps people IN:
     holding somebody who paid costs them their lights, carrying somebody who did
     not costs one bundle. */
  check('no invoice is not a debt',
    money.owesFromLastSeason(null) === false && money.owesFromLastSeason(undefined) === false,
    'an unloaded cache must never read as everybody owing money');
  check('an invoice with no arrears line is not a debt',
    money.owesFromLastSeason({ deposit: 0, credits: 0 }) === false);

  /* Whole cents, for the same reason computeInvoiceStatus uses them: a customer
     who has paid every cent must not be held against a balance showing $0.00. */
  check('floating-point crumbs do not hold a paid-up customer',
    money.owesFromLastSeason(billed(0.1 + 0.2, 0.3)) === false,
    '0.1 + 0.2 is 0.30000000000000004');

  /* ---------------------------------------------------------------------
     2. Start New Season carries the debt instead of erasing it.
     --------------------------------------------------------------------- */
  const write = seasonResetWrite();
  check('the season reset write was found',
    write.length > 0,
    'a check that cannot find its target reports green for the worst possible reason');
  check('the reset no longer zeroes the fee ledger',
    !/changeFees:\s*0,\s*changeFeeNotes:\s*\[\]/.test(write),
    'that single line IS the write-off this change removes');
  check('it carries the outstanding balance instead',
    /changeFees:\s*x\.arrears/.test(write),
    'the debt has to be on the new invoice or nothing is carried');
  check('the carried line is tagged as arrears',
    /kind:\s*ARREARS_KIND/.test(write),
    'without the kind it reads as a light-change fee to every existing reader, the ' +
    'Edit Customer rebuild cannot tell it apart, and owesFromLastSeason never finds ' +
    'it — so the hold silently never applies');
  check('and the saved status counts it',
    /computeInvoiceStatus\(x\.newInstall,\s*x\.removal,\s*0,\s*0,\s*x\.arrears\)/.test(write),
    'a status computed without the debt reads Paid in Full on a bill that is not');
  /* ⭐ THE YEAR IS PINNED, NOT RECOMPUTED (added 2026-08-31). Writing today's calendar
     year into the note on every reset is the exact bug this replaces — the label would
     creep forward each season and the true origin year would be lost. */
  check('the note stores the pinned year as its own field',
    /year:\s*x\.arrearsYear/.test(write),
    'a badge reading the year needs a real field, not a re-parse of the sentence every time');
  check('the reason names the pinned year, not a freshly computed one',
    /'Unpaid balance carried from the '\s*\+\s*x\.arrearsYear\s*\+\s*' season'/.test(write),
    'the reset\'s own new Date().getFullYear() here is the exact bug this replaces');

  /* ⚠ THE AMOUNT IS THE WHOLE OUTSTANDING BALANCE, run rather than read: last
     season's own light-change fees and credits are already settled inside
     balanceDueAmount, and re-deriving it would be a second opinion about a debt
     we are about to charge somebody. */
  const balanceDue = new Function('return ' + lift('balanceDueAmount'))();
  check('balanceDueAmount was lifted',
    typeof balanceDue === 'function');
  check('the carried amount is what was actually left on the bill',
    balanceDue({ install: 400, removal: 0, changeFees: 30, credits: 50, deposit: 100 }) === 280,
    'install + fees - credits - paid; got ' +
    balanceDue({ install: 400, removal: 0, changeFees: 30, credits: 50, deposit: 100 }));
  check('and a fully paid customer carries nothing',
    balanceDue({ install: 400, removal: 0, changeFees: 0, credits: 0, deposit: 400 }) === 0,
    'her rule: billed 400, paid 400, cleared — they must not be held');

  const plan = lift('ssnBuildPlan');
  check('the plan reads the balance through that one rule',
    /const arrears = balanceDueAmount\(inv\.data\)/.test(plan),
    'a second opinion about the debt here is how the bill and the hold start ' +
    'disagreeing about the same customer');
  check('and the dry run\'s total includes it',
    /totalOwed \+= newInstall \+ removal \+ arrears/.test(plan),
    'otherwise the dry run reports a smaller number than the invoices it writes');
  check('the plan keeps an existing pinned year rather than recomputing it',
    /arrearsYearOnInvoice\(inv\.data\)/.test(plan),
    'without this, a debt still unpaid on its second or third reset gets relabeled with ' +
    'that reset\'s own year and the true origin year is lost');
  check('a first-time carry, with no note yet to read a year from, uses today\'s year',
    /String\(new Date\(\)\.getFullYear\(\)\)/.test(plan),
    'the first time a debt is carried there is nothing pinned yet to preserve');
  check('the pinned year travels with the rest of the plan row',
    /arrearsYear:\s*arrearsYear/.test(plan),
    'without this the write loop above has no pinned year to write');

  /* ⚠ NAMED BEFORE IT HAPPENS. This changes what real people are charged AND takes
     them off the routes, and the button has no undo. */
  check('the dry run names who is carrying a debt',
    /did not pay last season/.test(admin) && /not scheduled/.test(admin),
    'a change to what people are charged has to be on screen before it is written');
  check('and the confirmation says it too',
    /carryLine/.test(admin) && /will NOT be scheduled until they pay it in full/.test(admin),
    'the dry run can have been read ten minutes ago against a different book');

  /* ---------------------------------------------------------------------
     3. The hold — RUN through the real season rule.
     --------------------------------------------------------------------- */
  const sandbox = [
    'const ARREARS_KIND = ' + JSON.stringify(money.ARREARS_KIND) + ';',
    'const centsOf = ' + money.centsOf.toString() + ';',
    'const arrearsOnInvoice = ' + money.arrearsOnInvoice.toString() + ';',
    'const arrearsSettled = ' + money.arrearsSettled.toString() + ';',
    'const owesFromLastSeason = ' + money.owesFromLastSeason.toString() + ';',
    'const custInvoiceKey = ' + money.custInvoiceKey.toString() + ';',
    /* ⚠ THE REAL RULE, NOT A STUB (§3). houseArrearsOutstanding used to hand-roll
       `owed - (deposit + credits)` in plain floats; it now asks money.js, which
       works in whole cents. Supplying the genuine export is what keeps this suite
       testing the shipped rule rather than agreeing with itself. centsOf is already
       in this sandbox above, so it is not repeated. */
    'const arrearsOutstanding = ' + money.arrearsOutstanding.toString() + ';',
    'let invoiceById = new Map();',
    'let jobAddresses = [];',
    'let seasonRuleOffForMeasurement = false;',
    /* ⚠ THE STUB HONOURS THE REAL CONSTANT NOW (2026-08-31). It used to answer a flat
       true, so every check here ran with the confirmed-only rule ON whatever the page
       said — and the moment Addie turned that rule off for the testing weeks this
       harness went on holding people out that the real app schedules. The measurement
       toggle above is kept: some checks below need the rule forced on to prove what it
       does when it IS live. */
    'let seasonRuleForcedOn = false;',
    /* ⚠ THE STUB HONOURS THE REAL CONSTANT NOW (2026-08-31), plus a lever to force it
       on. It used to answer a flat true, so every check here ran with the
       confirmed-only rule ON whatever the page said — and the moment Addie turned that
       rule off for the testing weeks this harness would have gone on holding people
       out that the real app schedules. What the rule does WHEN LIVE is still worth
       proving, hence the lever. */
    (admin.match(/const SEASON_ELIGIBILITY = '[^']*';/) || [''])[0],
    'function seasonRuleIsLive(){ return (SEASON_ELIGIBILITY === "confirmed-only" || seasonRuleForcedOn) && !seasonRuleOffForMeasurement; }',
    'function audienceNeverAsked(d){ return d && d.chargeNewMemberFee === true; }',
    'function effectiveRsvpStatus(d){ let s = String((d||{}).rsvpStatus||"").toLowerCase();' +
      ' if(s === "yes" && !(d||{}).rsvpRespondedAt) s = ""; return s; }',
    'function extractCleanCity(c){ return String(c||"").trim(); }',
    lift('seasonHold'),
    lift('seasonHoldReason'),
    'function esc(s){ return String(s == null ? "" : s); }',
    'function fmtMoney(n){ return "$" + (Number(n)||0).toFixed(2); }',
    lift('houseOwesFromLastSeason'),
    lift('houseArrearsOutstanding'),
    lift('arrearsYearOnInvoice'),
    lift('houseArrearsYear'),
    /* ⚠ LIFTED, NEVER TYPED. If this suite carried its own copy of the assumed
       season it would agree with itself and say nothing at all about the page. */
    (admin.match(/const ARREARS_ASSUMED_SEASON = '[^']*';/) || [''])[0],
    lift('houseArrearsTag'),
    lift('seasonBadgeKey'),
    lift('isOutForSeason'),
    lift('owesFromLastYearHouses'),
    'return { houseOwesFromLastSeason, houseArrearsOutstanding, arrearsYearOnInvoice, houseArrearsYear,' +
    ' tag: houseArrearsTag, badge: seasonBadgeKey, out: isOutForSeason,' +
    ' forceRule(on){ seasonRuleForcedOn = !!on; },' +
    ' forceOff(on){ seasonRuleOffForMeasurement = !!on; },' +
    ' isOutForSeason, owesFromLastYearHouses, seasonHold, seasonHoldReason,' +
    ' setInvoices(m){ invoiceById = m; }, setBook(b){ jobAddresses = b; },' +
    ' dropInvoices(){ invoiceById = null; } };'
  ].join('\n');

  /* ⚠ EACH LIFT IS PARSED, NOT JUST FOUND. A lift that silently truncates gives a
     function that answers confidently and wrongly — see the note over lift(). */
  ['houseOwesFromLastSeason', 'houseArrearsOutstanding', 'arrearsYearOnInvoice', 'houseArrearsYear', 'houseArrearsTag', 'seasonBadgeKey',
   'isOutForSeason', 'owesFromLastYearHouses', 'seasonHold', 'seasonHoldReason']
    .forEach(function (n) {
      check('lifted ' + n + ' out of the page, whole', liftOk(lift(n)),
        'a missing or truncated lift is a suite testing nothing while reporting green');
    });

  const api = new Function(sandbox)();

  // A customer who replied Yes — in the season on every other count.
  const replied = { name: 'Owes Money', phone: '8015550001', address: '1 Elm St', city: 'Lehi',
                    rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };
  const invUnpaid = new Map([['8015550001', { id: '8015550001', data: billed(400, 0) }]]);
  const invPaid = new Map([['8015550001', { id: '8015550001', data: billed(400, 400) }]]);
  const invPart = new Map([['8015550001', { id: '8015550001', data: billed(800, 400) }]]);

  api.setInvoices(invUnpaid);
  check('a customer who said Yes but owes for last year is OUT of the season',
    api.isOutForSeason(replied) === true,
    'a Yes is not a payment — this is the whole of what she asked for');
  check('and the amount still outstanding is reported',
    api.houseArrearsOutstanding(replied) === 400,
    'got ' + api.houseArrearsOutstanding(replied));

  /* ⭐ THE YEAR IS PINNED TO THE DEBT (added 2026-08-31). Addie: "if it is 2028 but
     they haven't paid in 2025 than that does not change every year." */
  check('the year is read off the pinned field on the note',
    api.arrearsYearOnInvoice(billed(400, 0)) === '2026',
    'got ' + JSON.stringify(api.arrearsYearOnInvoice(billed(400, 0))));
  check('an older note with no year field falls back to the sentence it already has',
    api.arrearsYearOnInvoice({ changeFeeNotes: [{ amount: 400, kind: 'arrears',
      reason: 'Unpaid balance carried from the 2025 season' }] }) === '2025',
    'a note written before this field existed must still show a year, not go blank');
  check('an invoice with no arrears note has no year',
    api.arrearsYearOnInvoice({ changeFeeNotes: [] }) === null &&
    api.arrearsYearOnInvoice({}) === null);
  check('houseArrearsYear resolves the same payer key houseArrearsOutstanding does',
    api.houseArrearsYear(replied) === '2026',
    'got ' + JSON.stringify(api.houseArrearsYear(replied)));

  api.setInvoices(invPaid);
  check('and once they are clear there is no year to show',
    api.houseArrearsYear(replied) === null);
  check('the same customer, once last year is paid, is IN',
    api.isOutForSeason(replied) === false,
    'if paying does not release them the hold is a trap with no way out');
  check('and then owes nothing',
    api.houseArrearsOutstanding(replied) === 0);

  api.setInvoices(invPart);
  check('paying part of it does not put them back in',
    api.isOutForSeason(replied) === true,
    'her example: needed 800, paid 400, "we cannot schedule them"');

  /* ⚠ THE HOLD IS NOT AN RSVP RULE and must not be reachable only through one. */
  api.setInvoices(invUnpaid);
  check('a new customer this year is still held by an unpaid last year',
    api.isOutForSeason({ ...replied, chargeNewMemberFee: true }) === true,
    'the never-asked exemption is about an unanswered question, not about money');

  /* ⚠ FAIL-SAFE, RUN. A page whose invoices have not loaded must not empty the
     season — the same direction every other unknown in this rule takes. */
  api.dropInvoices();
  check('with no invoices loaded nobody is held',
    api.isOutForSeason(replied) === false,
    'an unloaded cache reading as "everybody owes" would take the whole book off ' +
    'the routes at once, silently');
  api.setInvoices(invUnpaid);

  /* ⚠ THE PAYER'S BILL, NOT THE HOUSE'S OWN KEY. If Dana pays for Kyle and Dana
     did not pay, Kyle's lights were not paid for either. Reading Kyle's own key
     finds a zeroed leftover invoice and reports no debt. */
  const kyle = { name: 'Kyle', phone: '8015559999', billToPhone: '(801) 555-0001',
                 address: '2 Oak Ave', city: 'Lehi',
                 rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };
  check('a house billed to somebody who did not pay is held too',
    api.isOutForSeason(kyle) === true,
    'the work on that house was not paid for, whoever the bill is addressed to');

  /* ---------------------------------------------------------------------
     4. The list — nobody may be held invisibly.
     --------------------------------------------------------------------- */
  const clear = { name: 'Paid Up', phone: '8015550002', address: '3 Fir', city: 'Lehi',
                  rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };
  const saidNo = { name: 'Said No', phone: '8015550003', address: '4 Ash', city: 'Lehi',
                   rsvpStatus: 'no' };
  const neverReplied = { name: 'Never Replied', phone: '8015550004', address: '5 Birch', city: 'Alpine' };
  const bigger = { name: 'Owes More', phone: '8015550005', address: '6 Cedar', city: 'Alpine',
                   rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };

  api.setBook([
    { id: 'a', data: replied }, { id: 'b', data: clear }, { id: 'c', data: saidNo },
    { id: 'd', data: neverReplied }, { id: 'e', data: bigger }
  ]);
  api.setInvoices(new Map([
    ['8015550001', { data: billed(400, 0) }],
    ['8015550002', { data: billed(400, 400) }],
    ['8015550003', { data: billed(250, 0) }],
    ['8015550004', { data: billed(150, 0) }],
    ['8015550005', { data: billed(900, 0) }]
  ]));
  const listed = api.owesFromLastYearHouses().map(r => r.d.name);

  check('a customer who owes is on the list',
    listed.indexOf('Owes Money') !== -1);
  check('a customer who is square is not',
    listed.indexOf('Paid Up') === -1,
    'a list that names people who owe nothing is one nobody reads');
  /* ⭐ THE CHECK THIS FILE MOST EXISTS FOR. A debtor who has ALSO not replied is
     out twice over, so seasonEligibilityWouldDrop cancels them out and they are
     absent from Waiting on RSVP. If this list dropped them too they would appear
     on NEITHER — held, invisible, with nothing on any screen saying why. */
  check('a debtor who has ALSO not answered the RSVP is still listed here',
    listed.indexOf('Never Replied') !== -1,
    'held by two rules and shown by neither list is the vanishing this list exists ' +
    'to prevent');
  check('somebody who said No is not listed',
    listed.indexOf('Said No') === -1,
    'paying would not put them in the season either, so they are not waiting on ' +
    'anything and chasing them for money about lights they refused is wrong');
  check('and the biggest debt is at the top',
    listed[0] === 'Owes More',
    'this list is worked down in order of what is worth chasing; got ' + JSON.stringify(listed));

  /* ---------------------------------------------------------------------
     4b. Why a customer is not being scheduled — the note on the row and in
         Edit Customer. It must never disagree with whether a crew is
         actually being sent.
     --------------------------------------------------------------------- */
  /* ⚠ ONE DEBT ONLY, AND A DEBT-FREE NON-REPLIER. The list fixtures above deliberately
     gave EVERYBODY a debt — that is the vanishing case they exist to prove — and reused
     here it made "no RSVP yet" unreachable: the money reason outranks it, correctly, so
     the check failed against code that was right. A fixture where every record hits the
     same branch cannot tell the branches apart. */
  api.setInvoices(new Map([
    ['8015550001', { data: billed(400, 0) }],   // replied yes, owes
    ['8015550002', { data: billed(400, 400) }], // square
    ['8015550003', { data: billed(250, 0) }]    // said no, and owes — precedence case
  ]));

  /* ⚠ THE CONFIRMED-ONLY RULE IS FORCED ON FOR THIS BLOCK (2026-08-31). It is off in
     the page while Addie tests, so "never replied" is IN the season there — but these
     checks are about what the reason list says when the rule IS live, which is what
     happens the day the RSVP really goes out. Turned off again below. */
  api.forceRule(true);

  /* ⭐ THE STRUCTURAL GUARANTEE, and the only one that really matters: the note is
     silent for everybody in the season and speaks for everybody out of it. Run over a
     matrix rather than asserted case by case, because the failure worth catching is a
     reason list that has drifted out of step with the rule it explains — a row saying
     "Not scheduled" about somebody a crew is on its way to. */
  const matrix = [
    { name: 'owes', d: replied },
    { name: 'square', d: clear },
    { name: 'said no', d: saidNo },
    { name: 'never replied', d: neverReplied },
    { name: 'back next year', d: { ...clear, rsvpStatus: 'backnextyear' } },
    { name: 'badged next year', d: { ...clear, maybeNextYear: true } },
    { name: 'being recycled', d: { ...clear, needsLightRecycle: true } },
    { name: 'moved, staying', d: { ...clear, needsLightRecycle: true, recycleKeepingCustomer: true } },
    { name: 'new this year', d: { ...clear, chargeNewMemberFee: true } }
  ];
  const disagreed = matrix.filter(function (m) {
    return api.isOutForSeason(m.d) !== !!api.seasonHold(m.d);
  }).map(m => m.name);
  check('the note speaks for exactly the customers the season rule holds',
    disagreed.length === 0,
    'it must never name somebody a crew is on its way to, nor go silent about somebody ' +
    'who is being left out: disagreed on ' + JSON.stringify(disagreed));

  /* ⭐ AN UNDATED YES IS NOT "NO RSVP YET" (2026-09-03). Addie approved a Test customer
     through the emailed link, the badge stayed On hold, and the line under it said
     nobody had replied — so she went hunting for a broken approval. The HOLD was right:
     the confirmed-only rule needs a DATED reply, and a stored 'yes' with no
     rsvpRespondedAt is the assumed yes written when a quote is converted, or carried in
     by an import.
     ⚠ THE TWO HAVE DIFFERENT REMEDIES, which is why one sentence for both is wrong.
     Nothing on file means chase them; a yes nobody dated means confirm it on the record,
     which stamps the date. Told they had never replied, the office chases somebody who
     may well have answered.
     ⚠ AND IT MUST READ THE RAW FIELD: effectiveRsvpStatus normalises a bare yes away to
     '', which is exactly why the line could not tell them apart. */
  /* ⚠ rsvpRespondedAt MUST BE NULLED EXPLICITLY: `clear` carries one, so a spread
     alone leaves a DATED yes and the record is not held at all — the check then passes
     on an empty reason and proves nothing. Caught on the first run. */
  check('a yes nobody dated is not reported as "no RSVP yet"',
    /nothing dated it/.test(api.seasonHoldReason({ ...clear, rsvpStatus: 'yes', rsvpRespondedAt: null })),
    'got ' + JSON.stringify(api.seasonHoldReason({ ...clear, rsvpStatus: 'yes', rsvpRespondedAt: null })) +
    ' — the office would chase a customer who may already have approved');
  check('and a customer with nothing on file still reads "no RSVP yet"',
    api.seasonHoldReason({ ...clear, rsvpStatus: '', rsvpRespondedAt: null }) === 'no RSVP yet',
    'the two states have different remedies and must keep different words; got ' +
    JSON.stringify(api.seasonHoldReason({ ...clear, rsvpStatus: '', rsvpRespondedAt: null })));
  /* ⚠ AND A DATED YES IS NOT HELD AT ALL — the case she was actually trying to reach. */
  check('a dated yes is in the season, so there is no note',
    api.seasonHold({ ...clear, rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-03T10:00:00Z' }) === null,
    'approving through the emailed link must clear the hold');

  check('somebody in the season gets no note at all',
    api.seasonHold(clear) === null && api.seasonHoldReason(clear) === '',
    'a leftover note on a customer who is going out is worse than none');

  /* ⚠ EACH REASON PINNED, because the order mirrors isOutForSeason's own and a drift
     there puts the wrong words on a genuinely held customer. */
  check('the money reason names the amount and the pinned year, not "last season"',
    api.seasonHoldReason(replied) === 'owes $400.00 from 2026',
    'got ' + JSON.stringify(api.seasonHoldReason(replied)));
  check('and it is the only one drawn as money',
    api.seasonHold(replied).money === true &&
    [saidNo, neverReplied].every(function (d) { return api.seasonHold(d).money === false; }),
    'the RSVP pill already says no/pending on the line above — putting those in the ' +
    'warning colour on ~960 rows buries the one line somebody has to act on');
  check('no reply reads as no reply',
    api.seasonHoldReason(neverReplied) === 'no RSVP yet');
  api.forceRule(false);
  check('a no reads as a no',
    api.seasonHoldReason(saidNo) === 'they said no');
  check('back next year reads as back next year, however it was recorded',
    api.seasonHoldReason({ ...clear, rsvpStatus: 'backnextyear' }) === 'back next year' &&
    api.seasonHoldReason({ ...clear, maybeNextYear: true }) === 'back next year');
  check('a queued recycle says so',
    api.seasonHoldReason({ ...clear, needsLightRecycle: true }) === 'their lights are queued to come back');

  /* ⚠ SAYING NO OUTRANKS OWING, matching isOutForSeason's own order. Chasing somebody
     for money about lights they refused is the wrong call, and it is the reason that is
     actually keeping them out. */
  api.setInvoices(new Map([['8015550003', { data: billed(250, 0) }]]));
  check('somebody who said no AND owes reads as a no, not as a debt',
    api.seasonHoldReason(saidNo) === 'they said no',
    'got ' + JSON.stringify(api.seasonHoldReason(saidNo)));

  /* ⚠ THE FILTER ON THAT TABLE MATCHES r.routeStatus EXACTLY
     (`r.routeStatus === map[routeFilter]`), so folding the reason into that string
     would silently break filtering on All Customers. It has to be appended. */
  check('the row appends the reason rather than merging it into the route status',
    /\+approvedOnJoinBadge\(r\.d\)\+holdLine;/.test(admin) &&
    !/routeStatus:\s*allCustRouteStatus\(d\)\s*\+/.test(admin),
    'the Route filter compares routeStatus exactly — changing it breaks the filter');
  check('and the row only draws a line when there is one to draw',
    /const holdLine = hold\s*\r?\n?\s*\?/.test(admin),
    'an empty line on every in-season row is noise on ~960 rows');

  /* ⚠ THE HOUSE TABS REPOINT THIS FORM WITHOUT CLOSING IT, so a note left standing from
     the previous customer is a confident lie about this one — the exact leak the
     re-quote fields were fixed for. */
  const opener = lift('openEditCustomerModal');
  check('Edit Customer fills the note from the same rule',
    /seasonHold\(d\)/.test(opener),
    'a second opinion in the form would disagree with the routes');
  check('and clears it for a customer who is NOT held',
    /ecHoldEl\.innerHTML = '';/.test(opener) && /ecHoldEl\.style\.display = 'none';/.test(opener),
    'the house tabs repoint this form at a sibling without closing it, so a stale note ' +
    'would be a lie about the customer now on screen');
  check('the note element exists in the page',
    /id="editCustHoldNote"/.test(admin),
    'a filler with no element is a silent no-op under optional chaining');

  /* ---------------------------------------------------------------------
     4c. The one-off backfill, for a season that was already reset under the
         old write-off behaviour. Addie: "The new season started but RSVP
         hasn't been sent out" — so the debts are gone from the invoices and
         live only in the snapshot.
     --------------------------------------------------------------------- */
  const planSb = [
    'const ARREARS_KIND = ' + JSON.stringify(money.ARREARS_KIND) + ';',
    'const arrearsOnInvoice = ' + money.arrearsOnInvoice.toString() + ';',
    lift('balanceDueAmount'),
    lift('arrearsBackfillPlan'),
    lift('lastSeasonSnapshotFrom'),
    'return { arrearsBackfillPlan, lastSeasonSnapshotFrom };'
  ].join('\n');
  ['arrearsBackfillPlan', 'lastSeasonSnapshotFrom'].forEach(function (n) {
    check('lifted ' + n + ' out of the page, whole', liftOk(lift(n)));
  });
  const pApi = new Function(planSb)();

  /* Snapshot rows are exactly what ssnBuildSnapshotRows writes: the invoice as it
     stood the moment before the reset wiped it. */
  const snapRows = [
    { id: '8015550001', name: 'Owes Money',  install: 400, removal: 0, changeFees: 0,  credits: 0,  deposit: 0 },
    { id: '8015550002', name: 'Paid Up',     install: 400, removal: 0, changeFees: 0,  credits: 0,  deposit: 400 },
    { id: '8015550003', name: 'Part Paid',   install: 800, removal: 0, changeFees: 0,  credits: 0,  deposit: 400 },
    { id: '8015550006', name: 'Already Done',install: 300, removal: 0, changeFees: 0,  credits: 0,  deposit: 0 },
    { id: '8015550007', name: 'No Invoice',  install: 250, removal: 0, changeFees: 0,  credits: 0,  deposit: 0 },
    /* ⚠ A fee and a credit on last year's bill, so the carried figure is the real
       outstanding balance rather than the install alone. */
    { id: '8015550008', name: 'Fee And Credit', install: 400, removal: 0, changeFees: 30, credits: 50, deposit: 100 }
  ];
  const liveInv = new Map([
    ['8015550001', { data: { install: 450, deposit: 0, credits: 0, changeFees: 0 } }],
    ['8015550002', { data: { install: 450, deposit: 0, credits: 0, changeFees: 0 } }],
    ['8015550003', { data: { install: 450, deposit: 0, credits: 0, changeFees: 0 } }],
    ['8015550006', { data: { install: 450, deposit: 0, credits: 300,
        changeFees: 300, changeFeeNotes: [{ amount: 300, kind: 'arrears', reason: 'already carried' }] } }],
    ['8015550008', { data: { install: 450, deposit: 0, credits: 0, changeFees: 0 } }]
  ]);
  const bf = pApi.arrearsBackfillPlan(snapRows, liveInv);
  const carried = bf.carry.map(r => r.name + ' ' + r.owed);

  check('somebody who never paid is carried, for what they actually owed',
    carried.indexOf('Owes Money 400') !== -1,
    'got ' + JSON.stringify(carried));
  check('somebody who paid in full is left alone',
    bf.settled.some(r => r.name === 'Paid Up') && !bf.carry.some(r => r.name === 'Paid Up'),
    'carrying a debt onto a customer who paid is the worst outcome available here');
  check('a part payment carries only the remainder',
    carried.indexOf('Part Paid 400') !== -1,
    'billed 800, paid 400 — 400 is carried, not 800; got ' + JSON.stringify(carried));
  check('last season\'s own fees and credits are already inside the figure',
    carried.indexOf('Fee And Credit 280') !== -1,
    '400 + 30 fee - 50 credit - 100 paid = 280; got ' + JSON.stringify(carried));
  /* ⚠ IDEMPOTENT BY THE LEDGER, not by a flag. Running it twice must not double
     anybody's debt, and this is what makes that true. */
  check('a bill already carrying a line is skipped',
    bf.already.some(r => r.name === 'Already Done') && !bf.carry.some(r => r.name === 'Already Done'),
    'running this twice must never double a debt');
  /* ⚠ NEVER GUESS AT A MISSING INVOICE. A customer re-keyed since the reset would
     otherwise have their debt put on whichever bill a name match happened to find. */
  check('a snapshot row with no invoice today is reported, never guessed at',
    bf.missing.some(r => r.name === 'No Invoice') && !bf.carry.some(r => r.name === 'No Invoice'),
    'picking an invoice by name would put one person\'s debt on a stranger\'s bill');
  check('and the biggest debt is listed first',
    bf.carry[0].owed >= bf.carry[bf.carry.length - 1].owed,
    'the report is read top-down');

  /* The picker is shared with the Automation Emails filter rather than copied. */
  check('the newest snapshot that actually has rows is the one used',
    pApi.lastSeasonSnapshotFrom([
      { id: '2027', data: { year: 2027, invoices: [] } },
      { id: '2026', data: { year: 2026, invoices: [{ id: 'x' }] } },
      { id: '2025', data: { year: 2025, invoices: [{ id: 'y' }] } }
    ]).id === '2026',
    'an empty newer snapshot must not hide the real books');
  check('and no snapshot at all answers null, never an empty guess',
    pApi.lastSeasonSnapshotFrom([]) === null && pApi.lastSeasonSnapshotFrom(null) === null,
    'this decides whether the office is told there is nothing to repair');
  check('the audience filter asks the same picker rather than a copy',
    /function audienceLastSeasonSnapshot\(\)\{ return lastSeasonSnapshotFrom\(yearlySnapshotsCache\); \}/.test(admin),
    'two copies of "which snapshot is last season" is the second way for them to disagree');

  /* ⚠ IT MUST READ THE COLLECTION FRESH. yearlySnapshotsCache is filled by the `money`
     panel group, which the Invoices panel does not load — so reading the cache on this
     screen reports "nothing to carry" while real debts sit in the snapshot. */
  const checkHandler = admin.slice(admin.indexOf("document.getElementById('arrearsCheckBtn')"),
                                   admin.indexOf("document.getElementById('arrearsRunBtn')"));
  check('the dry run reads the snapshot fresh, not from the panel cache',
    /getDocs\(query\(collection\(db,'yearlySnapshots'\)/.test(checkHandler) &&
    !/yearlySnapshotsCache/.test(checkHandler),
    'the Invoices panel never loads that cache, so it would report nothing to carry ' +
    'while real debts sat in the snapshot — a confident wrong answer about money');
  check('and a failed read says so rather than reading as nobody-owes-anything',
    /Could not read the snapshot/.test(checkHandler),
    'silence here is indistinguishable from an all-clear');

  const runHandler = admin.slice(admin.indexOf("document.getElementById('arrearsRunBtn')"),
                                 admin.indexOf('async function loadNightlyInvoiceLog'));
  check('the apply writes only what the dry run showed',
    /const job = arrearsBackfillPending;/.test(runHandler) &&
    /for\(const row of job\.rows\)/.test(runHandler),
    're-finding rows at write time would charge people she never saw — the same rule ' +
    'the delete tools follow');
  check('and it refuses without the typed confirmation',
    /!== 'CARRY'/.test(runHandler),
    'a mass money write needs the same lock every other one here has');
  check('it re-reads each invoice immediately before writing',
    /await getDoc\(doc\(db,'invoices', row\.key\)\)/.test(runHandler) &&
    /if\(arrearsOnInvoice\(d\) > 0\)\{ skipped\+\+; continue; \}/.test(runHandler),
    'two people are in admin every day and this loop is not a transaction — a bill that ' +
    'gained a line since the dry run must not gain a second one');
  /* ⚠ THIS CHECK WAS WEAK AND THE RED-CHECK CAUGHT IT. It asserted only that `.concat`
     appeared, so a sabotage replacing the base with `[].concat([{ … }])` — which throws
     away every existing fee — sailed straight through. The base of the concat is the
     whole claim, so that is what is asserted. */
  check('it appends to the EXISTING fee ledger and re-sums it, never assigns over it',
    /\(Array\.isArray\(d\.changeFeeNotes\) \? d\.changeFeeNotes : \[\]\)\.concat\(/.test(runHandler) &&
    /notes\.reduce/.test(runHandler),
    'a light-change fee added since the reset is a real charge and must survive; ' +
    'starting the concat from an empty array deletes it');
  check('and the note it writes carries the pinned year too, same shape as Start New Season',
    /year:\s*job\.year/.test(runHandler),
    'without this, a debt this tool carries in cannot survive a LATER ordinary reset — ' +
    'ssnBuildPlan has nothing pinned to read back');
  check('and a failure is counted and named, never swallowed',
    /failed\+\+/.test(runHandler) && /failed and were NOT carried/.test(runHandler),
    'a half-finished money run reporting success is the worst outcome here');

  /* ---------------------------------------------------------------------
     4d. END TO END: approving by email must not schedule somebody who owes.
         Addie: "unpaid members don't move forward on the schedule even if
         they approve over email."
     --------------------------------------------------------------------- */
  /* ⚠ THE REAL SERVER WRITE, lifted out of functions/index.js, not a fixture shaped
     like one. The whole question is whether what an RSVP yes ACTUALLY writes is enough
     to get a debtor onto a day, so inventing the write would prove nothing. */
  const serverSrc = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
  const yesAt = serverSrc.indexOf('function seasonYesUpdates(');
  const yesSrc = yesAt === -1 ? '' : serverSrc.slice(yesAt, serverSrc.indexOf('\n}', yesAt) + 2);
  check('lifted the real RSVP-yes write off the server, whole',
    yesSrc.length > 0 && (function () { try { new Function(yesSrc + '\nreturn 1;'); return true; } catch (e) { return false; } })(),
    'a fixture shaped like the write would prove nothing about the write');
  /* ⚠ AND THE REJOIN RULE (2026-09-03). seasonYesUpdates asks rejoinNeedsBuildServer
     whether a returning customer's bundle has to be rebuilt, so the lift needs it or it
     dies with a bare ReferenceError naming neither this file nor the function. Lifted
     from the same source as the rule above rather than stubbed — these checks are about
     what the REAL write does to a debtor coming back in. */
  const rejoinAt = serverSrc.indexOf('function rejoinNeedsBuildServer(');
  const rejoinSrc = rejoinAt === -1 ? '' : serverSrc.slice(rejoinAt, serverSrc.indexOf('\n}', rejoinAt) + 2);
  check('lifted the rejoin rule the yes write depends on',
    rejoinSrc.length > 0,
    'without it the lift below dies naming neither this suite nor the function it wanted');
  const seasonYesUpdates = new Function('stampBuildQueuedServer',
    rejoinSrc + '\n' + yesSrc + '\nreturn seasonYesUpdates;')(function () {});

  /* ⚠ THEY MUST HAVE BEEN OUT BEFORE, and the first version of this fixture was not —
     seasonYesUpdates only stamps needsDayAssignedAt when the customer was previously out
     (a no, a back next year, or the office badge). A first-time yes asks for no day at
     all, so a fixture without a prior answer proved nothing about the placer. This is
     also the more dangerous case: somebody actively coming back into the season. */
  const debtor = { name: 'Approved By Email', phone: '8015550001', address: '9 Pine', city: 'Lehi',
                   rsvpStatus: 'no' };
  const afterYes = Object.assign({}, debtor, seasonYesUpdates(debtor, function () { return '2026-09-01T10:00:00Z'; }));
  check('the real yes write does record a genuine reply',
    afterYes.rsvpStatus === 'yes' && !!afterYes.rsvpRespondedAt,
    'if this stopped being true the check below would pass for the wrong reason');
  api.setInvoices(new Map([['8015550001', { data: billed(400, 0) }]]));
  check('a customer who owes and approves BY EMAIL is still out of the season',
    api.isOutForSeason(afterYes) === true,
    'this is the guarantee in her own words — approving over email must not move an ' +
    'unpaid member forward on the schedule');
  api.setInvoices(new Map([['8015550001', { data: billed(400, 400) }]]));
  check('and the same customer, once last season is paid, is in',
    api.isOutForSeason(afterYes) === false,
    'the hold has to release, or paying achieves nothing');

  /* ⚠ THE YES ALSO STAMPS needsDayAssignedAt — "an instruction the planner consumes".
     That is the path this guarantee actually rides on: the placer must refuse them
     rather than acting on the instruction. */
  check('the yes really does ask for a day, so the placer is the thing being trusted',
    !!afterYes.needsDayAssignedAt,
    'if it stopped asking, the check below would be guarding nothing');
  const placer = lift('placeUnscheduledOnNextDay');
  check('and the placer refuses anybody the season rule holds',
    /if\(typeof isOutForSeason === 'function' && isOutForSeason\(d\)\) return;/.test(placer),
    'without this line an unpaid customer who approves by email is put straight onto ' +
    'the next day going');

  /* ---------------------------------------------------------------------
     4e. Paid last season, still never answered — it has to reach the Inbox.
         Addie: "if someone pays that didn't pay last year, but also didn't
         approve email than that needs to show in system inbox."
     --------------------------------------------------------------------- */
  const noticeSb = [
    'const ARREARS_KIND = ' + JSON.stringify(money.ARREARS_KIND) + ';',
    'const centsOf = ' + money.centsOf.toString() + ';',
    'const arrearsOnInvoice = ' + money.arrearsOnInvoice.toString() + ';',
    'const arrearsSettled = ' + money.arrearsSettled.toString() + ';',
    'function effectiveRsvpStatus(d){ let s = String((d||{}).rsvpStatus||"").toLowerCase();' +
      ' if(s === "yes" && !(d||{}).rsvpRespondedAt) s = ""; return s; }',
    lift('arrearsPaidNotApproved'),
    'return { arrearsPaidNotApproved };'
  ].join('\n');
  check('lifted arrearsPaidNotApproved out of the page, whole', liftOk(lift('arrearsPaidNotApproved')));
  const nApi = new Function(noticeSb)();
  const silent = { name: 'Silent' };

  check('paid off last season and never answered — the note is raised',
    nApi.arrearsPaidNotApproved(silent, billed(400, 400)) === true,
    'this is the one moment nothing else tells her about: they leave the owes list and ' +
    'are still not scheduled');
  check('still owing — no note yet',
    nApi.arrearsPaidNotApproved(silent, billed(400, 200)) === false,
    'the money is still the thing holding them, and that is already on a list');
  check('never carried a debt — no note',
    nApi.arrearsPaidNotApproved(silent, billed(0, 0)) === false,
    'this note is only about somebody who owed and has now squared up');
  /* ⚠ ONLY THE SILENT. Somebody who answered has answered — a note asking whether they
     approve would be arguing with a decision already given, and a panel that raises
     notes about settled answers is one the office learns to scroll past. */
  check('they said yes for real — nothing to ask',
    nApi.arrearsPaidNotApproved({ rsvpStatus: 'yes', rsvpRespondedAt: 'x' }, billed(400, 400)) === false);
  check('they said no — not asked again',
    nApi.arrearsPaidNotApproved({ rsvpStatus: 'no' }, billed(400, 400)) === false);
  check('back next year — not asked again',
    nApi.arrearsPaidNotApproved({ rsvpStatus: 'backnextyear' }, billed(400, 400)) === false);
  /* ⚠ A BARE STORED YES IS NOT AN APPROVAL (RS-19) — an import or a hand-edit. Those
     people genuinely have not answered, and are exactly who this note is for. */
  check('a bare stored yes with no reply behind it still counts as silent',
    nApi.arrearsPaidNotApproved({ rsvpStatus: 'yes' }, billed(400, 400)) === true,
    'that shape is an import or the assumed yes at conversion, not an answer');

  const sweep = lift('noticeArrearsPaidNotApproved');
  /* ⚠ THE TOPIC IS A CHOICE OF TWO NOW (2026-09-02), and both must still be there.
     The note was widened past arrears — any customer who has paid and never answered
     raises one — so the arrears wording became one branch of a pair rather than the
     only sentence. What has not changed, and is what this check is for, is that it
     lands in the System folder: she asked for the system inbox by name. */
  check('the note goes to the System folder of the Inbox',
    /folder: 'System'/.test(sweep) &&
    /'Paid Last Season — Still Needs to RSVP'/.test(sweep) &&
    /'Paid — Still Needs to RSVP'/.test(sweep),
    'she asked for the system inbox by name');
  check('it is raised once per customer per season',
    /if\(d\.arrearsPaidNoticeAt\) continue;/.test(sweep) &&
    /arrearsPaidNoticeAt: serverTimestamp\(\)/.test(sweep),
    'a note repeated on every payment is one nobody reads');
  /* ⚠ THE CUSTOMER WRITE, NOT THE INVOICE WRITE. seasonResetWrite() slices the invoice
     update; this flag lives on jobAddresses beside the other season-scoped ones, and the
     first version of this check looked in the wrong half of the reset. */
  /* ⚠ THE END IS FOUND RELATIVE TO THE START. `seasonResetAt: serverTimestamp()` also
     appears EARLIER, in the snapshot write a few hundred lines above, so a bare indexOf
     put the end before the start and handed back an empty string — a check that finds
     nothing and reports on nothing. That is why the "was it found at all" check above
     it exists. */
  const custResetAt = admin.indexOf("return updateDoc(doc(db,'jobAddresses', a.id), {");
  const custResetWrite = custResetAt === -1 ? ''
    : admin.slice(custResetAt, admin.indexOf('seasonResetAt: serverTimestamp()', custResetAt));
  check('the customer half of the reset was found',
    custResetWrite.length > 0 && /chargeNewMemberFee: false/.test(custResetWrite),
    'a check that cannot find its target reports green for the worst possible reason');
  check('and the stamp is cleared by Start New Season',
    /arrearsPaidNoticeAt: null,/.test(custResetWrite),
    'left standing, somebody noticed last season could never be noticed again');
  check('a failed write retries rather than losing the note',
    /arrearsNoticedThisSession\.delete\(item\.id\);/.test(sweep),
    'a note nobody gets is the whole failure this exists to prevent');
  check('it reads the bill the house is on, like the hold does',
    /d\.billToPhone/.test(sweep) && /custInvoiceKey\(d\)/.test(sweep),
    'the note and the hold must never be about different invoices');
  /* ⚠ HUNG OFF THE INVOICES LISTENER, which is the one place every payment lands
     whatever door it came in by — the dropdown on either screen, a PayPal capture
     written by the server, and the payment importer. */
  const invListener = admin.slice(admin.indexOf('function loadInvoices(){'),
                                  admin.indexOf('let custByPhoneDigits'));
  check('the sweep runs whenever any payment lands',
    /noticeArrearsPaidNotApproved\(\)/.test(invListener),
    'detecting this at each payment door would be four copies of one rule');
  check('and it cannot throw into the listener or block the screens',
    /noticeArrearsPaidNotApproved\(\)\.catch\(/.test(invListener),
    'a note is a side effect of a payment landing and must never hold up the render');

  /* ---------------------------------------------------------------------
     4f. Entering a debt from before the app tracked it, and paying one
         season at a time. Addie: this is the first year on the system, so
         2025's unpaid bills are in her spreadsheet and nowhere else.
     --------------------------------------------------------------------- */
  check('there is a box for a debt from a previous season',
    /id="editCustArrears"/.test(admin) && /id="editCustArrearsSeason"/.test(admin),
    'the Fees box cannot do this job — a manual fee raises the bill and does NOT hold ' +
    'them out of the season, so a crew would still be sent');
  const saveArr = admin.slice(admin.indexOf('if(newArrearsAmount > 0){'),
                              admin.indexOf('if(newArrearsAmount > 0){') + 900);
  check('what it writes is a real carried line, so it holds them',
    /kind: ARREARS_KIND/.test(saveArr) && /source: 'office'/.test(saveArr),
    'without the kind it is just a fee and the crew still goes out; without the source ' +
    'this box would rebuild the line Start New Season wrote');
  /* ⭐ Addie, 2026-09-01: "we need to emphasize that is last years payment so someone
     doesn't get mad and think they are charged twice." The reason text is what the
     printed and emailed invoice prints for this row, and what their portal shows. */
  /* ⚠ THE YEAR GOES IN THE FIELD THE REST OF THE APP ALREADY READS. A parallel session
     added `year` on the arrears note and arrearsYearOnInvoice to read it; this box briefly
     wrote `season` instead, which is a second name for one fact and is how the badge on
     the row and the line on the bill start naming different years for one debt. */
  /* ⚠ REPOINTED, NOT WEAKENED, 2026-08-31: this matched `year: newArrearsSeason || ''`
     — the empty fallback — and that fallback is gone, because a blank box now saves the
     assumed season instead of nothing. The claim was never about the `|| ''`; it is that
     the year is stored under `year` and not under a second name. */
  check('the box stores the year in the shared field, not a name of its own',
    /year: newArrearsSeason/.test(saveArr) && !/season: newArrearsSeason/.test(saveArr),
    'arrearsYearOnInvoice reads `year`; anything else is invisible to it');
  /* ⭐ AND A BLANK BOX IS THE ASSUMED SEASON, never nothing. Addie, 2026-08-31: "assume
     if they havent paid for a previous season its always 2025", then "so it assumes 2025
     season and adjust everything youve done to be centered around that". A debt stored
     with no season is what produced the "Unpaid last season" wording she objected to. */
  check('a blank season box saves the assumed season rather than an empty one',
    /\.trim\(\) \|\| ARREARS_ASSUMED_SEASON;/.test(saveArr) ||
    /trim\(\) \|\| ARREARS_ASSUMED_SEASON/.test(admin),
    'an empty year on the note is the ambiguity the assumption exists to remove');
  /* ⚠ AND THE SERVER'S COPY MUST AGREE, because it is what the portal shows the customer
     while asking them for money. Run over the same notes rather than compared by eye. */
  const clientYear = new Function('ARREARS_KIND', lift('arrearsYearOnInvoice') + '\nreturn arrearsYearOnInvoice;')('arrears');
  const sYearAt = serverSrc.indexOf('function arrearsYearServer(');
  const serverYear = new Function('ARREARS_KIND_SERVER',
    serverSrc.slice(sYearAt, serverSrc.indexOf('\n}', sYearAt) + 2) + '\nreturn arrearsYearServer;')('arrears');
  const yearCases = [
    { changeFeeNotes: [{ amount: 400, kind: 'arrears', year: '2025' }] },
    { changeFeeNotes: [{ amount: 400, kind: 'arrears', year: 2025 }] },
    { changeFeeNotes: [{ amount: 400, kind: 'arrears', reason: 'Unpaid balance carried from the 2024 season' }] },
    { changeFeeNotes: [{ amount: 400, kind: 'arrears', reason: 'no year in here' }] },
    { changeFeeNotes: [{ amount: 30, reason: 'Light change' }] },
    { changeFeeNotes: [] }
  ];
  const yearDisagreed = yearCases.filter(c => clientYear(c) !== serverYear(c));
  check('the office screen and the portal name the SAME year for a debt',
    yearDisagreed.length === 0,
    'two different years for one debt is exactly what "charged twice" looks like to a ' +
    'customer: ' + JSON.stringify(yearDisagreed));
  check('and a line written before the year field existed still names itself',
    clientYear(yearCases[2]) === '2024' && serverYear(yearCases[2]) === '2024',
    'the fallback reads the year out of the reason text');

  check('and the line the CUSTOMER reads names the season and says it is not this year\'s',
    /Unpaid balance from the ' \+ newArrearsSeason \+ ' season/.test(saveArr) &&
    /not a charge for this year/.test(saveArr),
    'a line on a bill with no year on it is exactly what reads as being charged twice');

  const createOrder = serverSrc.slice(serverSrc.indexOf('exports.paypalCreateOrder'),
                                      serverSrc.indexOf('exports.paypalCaptureOrder'));
  check('PayPal charges last season first, not the whole balance',
    /const arrearsLeft = Math\.min\(arrearsOutstandingServer\(inv\), balanceDue\)/.test(createOrder) &&
    /payingLastSeason \? arrearsLeft : balanceDue/.test(createOrder),
    'before this a customer owing $400 on an $850 bill could not pay the $400 that ' +
    'would get their lights hung — it was all of it or Venmo');
  check('and never more than they owe',
    /Math\.min\(arrearsOutstandingServer\(inv\), balanceDue\)/.test(createOrder),
    'a carried figure larger than the balance must not overcharge them');
  check('it tells the portal which season it just quoted',
    /payingLastSeason,/.test(createOrder) && /arrearsSeason:/.test(createOrder),
    'a button showing less than the balance with nothing saying why reads as a double charge');
  check('the portal is sent the figure rather than working it out again',
    /record\.arrearsOutstanding = arrearsOutstandingServer\(data\)/.test(serverSrc),
    'a third copy of a money rule would be outside money-parity entirely — and it ' +
    'would be the copy the customer reads');

  const site = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  check('the portal says whose season the payment is for',
    /renderArrearsNotice/.test(site) && /it is not a second charge for this year/.test(site),
    'her words: "so someone doesn\'t get mad and think they are charged twice"');
  check('and it reads the server\'s figure, never its own sum of the ledger',
    /rec\.arrearsOutstanding/.test(site) && !/kind === 'arrears'/.test(site),
    'index.html must not become a third copy of the carried-balance rule');
  check('it promises this year\'s amount comes next, which is what she asked for',
    /will show here as the next payment/.test(site),
    '"next years payment will show up after they paid that year"');
  /* ⚠ THE BUG THIS FOUND. onApprove set "Paid in Full" and $0 unconditionally — right
     while the button always charged the whole balance, and wrong the moment a part
     payment exists, which is now the commonest payment on this page. */
  const onApprove = site.slice(site.indexOf('onApprove: function(data)'),
                               site.indexOf('onApprove: function(data)') + 2600);
  check('paying part of a bill no longer claims Paid in Full',
    !/statusEl\.textContent = 'Paid in Full';/.test(onApprove),
    'told they were paid in full, a customer stops — and the balance they still owe is ' +
    'never asked for again by anybody');
  check('it re-reads the invoice instead of assuming',
    /renderCustomerInvoicePage\(reloadKey/.test(onApprove),
    'whatever they just paid, the panel then shows what the books actually say');
  check('and a failed re-read still takes the pay panel down',
    /could not refresh the invoice after payment/.test(onApprove),
    'the money HAS been taken — showing four more ways to pay would be worse');

  /* ---------------------------------------------------------------------
     4g. Switching what you are paying for, after the card form is open.
         Addie: "if I push on 2025 payment than do credit/debit dropdown but
         than decide to switch to full payment it does not automatically
         changed to full payment. It still shows 2025 payment."
     --------------------------------------------------------------------- */
  {
    /* ⚠ RUN, NOT MATCHED. The whole failure was an assumption about the SDK's
       lifecycle that read perfectly as source — there was even a comment stating it.
       What must be true is that the open form is TAKEN DOWN, so the teardown is
       executed against a fake SDK that records what happened to it. */
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="paypal-button-container">old</div>' +
                          '<div id="paypal-card-button-container">open card form</div>');
    const closed = [];
    let rendered = 0;
    const resetSrc = (function () {
      const at = site.indexOf('function resetPaypalButtons(){');
      return at === -1 ? '' : site.slice(at, site.indexOf('\n}', at) + 2);
    })();
    check('the teardown was lifted whole', liftOk(resetSrc));

    const api2 = new Function('document', resetSrc + `
      return {
        run: resetPaypalButtons,
        arm: function(list){ paypalButtonsRendered = true; paypalButtonInstances = list; },
        state: function(){ return {rendered: paypalButtonsRendered, n: paypalButtonInstances.length}; }
      };
      function renderPaypalButtons(){ rendered++; }
      var paypalButtonsRendered = false;
      var paypalButtonInstances = [];
    `.replace('rendered++', 'globalThis.__rendered++'))(dom.window.document);

    globalThis.__rendered = 0;
    api2.arm([
      { close: function(){ closed.push('card'); return Promise.resolve(); } },
      { close: function(){ closed.push('paypal'); return Promise.resolve(); } }
    ]);
    api2.run();
    check('switching the amount closes the open card form',
      closed.indexOf('card') !== -1 && closed.indexOf('paypal') !== -1,
      'nothing in the browser can revise an order PayPal has already created — the ' +
      'form has to go; got ' + JSON.stringify(closed));
    check('and both containers are emptied',
      dom.window.document.getElementById('paypal-card-button-container').innerHTML === '' &&
      dom.window.document.getElementById('paypal-button-container').innerHTML === '',
      'close() is the tidy way; clearing the container is what guarantees it');
    check('and the buttons are built again for the new amount',
      globalThis.__rendered === 1,
      'taking them down without putting them back leaves no way to pay at all');
    check('the tracked instances are forgotten, so a second switch cannot close them twice',
      api2.state().n === 0);

    /* ⚠ A close() THAT THROWS MUST NOT STOP THE TEARDOWN. The SDK rejects when a button
       is already gone, and an unhandled rejection there would leave the containers half
       cleared — a dead card form on screen with no way to pay. */
    globalThis.__rendered = 0;
    dom.window.document.getElementById('paypal-card-button-container').innerHTML = 'still here';
    api2.arm([
      { close: function(){ throw new Error('already closed'); } },
      { close: function(){ closed.push('second'); return Promise.resolve(); } }
    ]);
    let threw = false;
    try { api2.run(); } catch (e) { threw = true; }
    check('a close() that throws does not abandon the teardown',
      !threw && closed.indexOf('second') !== -1 &&
      dom.window.document.getElementById('paypal-card-button-container').innerHTML === '',
      'a half-cleared panel is a dead card form with no way to pay');

    /* ⚠ AND IT DOES NOTHING WHEN THERE IS NOTHING UP, or opening the invoice page would
       render the buttons and immediately tear them down again. */
    globalThis.__rendered = 0;
    api2.run();
    check('it is a no-op when no buttons are rendered', globalThis.__rendered === 0);
  }

  /* ⭐ AND WHAT THE CUSTOMER SEES AFTER THEY PAY LAST SEASON. Addie: "how much the full
     amount should show as after they pay 2025... And 2025 unpaid payment should
     disapear." RUN through the real renderer, because both claims are about what is on
     the screen and neither can be read off the source. */
  {
    const { JSDOM } = require('jsdom');
    const pd = new JSDOM('<div id="invPayChoice" style="display:none">' +
      '<button class="pay-choice" data-scope="arrears"><span id="payChoiceArrearsTitle"></span>' +
      '<span id="payChoiceArrearsAmt"></span><span id="payChoiceArrearsWhy"></span></button>' +
      '<button class="pay-choice" data-scope="all"><span id="payChoiceAllAmt"></span>' +
      '<span id="payChoiceAllWhy"></span></button></div>');
    const liftSite = function (name) {
      const at = site.indexOf('function ' + name + '(');
      return at === -1 ? '' : site.slice(at, site.indexOf('\n}', at) + 2);
    };
    const pay = new Function('document', [
      'var portalPayScope="arrears", portalArrearsLeft=0, portalTotalDue=0;',
      'function centsOf(n){return Math.round(((Number(n)||0)+Number.EPSILON)*100);}',
      'function fmt(n){return "$"+(Number(n)||0).toFixed(2);}',
      liftSite('portalPayableNow'), liftSite('renderPayChoice'), liftSite('paintPayChoice'),
      'return {render: renderPayChoice, payable: portalPayableNow};'
    ].join('\n'))(pd.window.document);
    const doc = pd.window.document;
    const shown = () => doc.getElementById('invPayChoice').style.display !== 'none';

    pay.render({ record: { arrearsOutstanding: 400, arrearsSeason: '2025' } }, 850);
    check('while they owe 2025, both amounts are offered',
      shown() && doc.getElementById('payChoiceArrearsAmt').textContent === '$400.00' &&
      doc.getElementById('payChoiceAllAmt').textContent === '$850.00',
      'got ' + doc.getElementById('payChoiceArrearsAmt').textContent + ' / ' +
      doc.getElementById('payChoiceAllAmt').textContent);

    /* Her two asks, in one state: the invoice re-read after paying the $400. */
    pay.render({ record: { arrearsOutstanding: 0, arrearsSeason: '2025' } }, 450);
    check('once 2025 is paid the 2025 option disappears',
      !shown(),
      'a button offering to charge them again for a season they have just settled');
    check('and what is payable becomes the rest of this year, not nothing',
      pay.payable() === 450,
      'the scope is still "arrears" at that moment, so this is where a naive read ' +
      'returns 0 and the customer is shown nothing to pay; got ' + pay.payable());

    /* ⚠ A PART payment of the DEBT must leave the option up for the remainder — this is
       the case that separates "hide it when they paid" from "hide it when it is gone". */
    pay.render({ record: { arrearsOutstanding: 250, arrearsSeason: '2025' } }, 700);
    check('a part payment of 2025 leaves the remainder offered',
      shown() && doc.getElementById('payChoiceArrearsAmt').textContent === '$250.00' &&
      doc.getElementById('payChoiceAllAmt').textContent === '$700.00',
      'got ' + doc.getElementById('payChoiceArrearsAmt').textContent + ' / ' +
      doc.getElementById('payChoiceAllAmt').textContent);
  }

  /* ⭐ AND IF PAYPAL KEEPS ITS WINDOW OPEN ANYWAY. The teardown is meant to close it, but
     a window that survives still holds an order for the OLD amount, and completing it
     would charge that while this page shows the new figure. */
  check('the page knows when a payment window is actually open',
    /onClick: function\(\)\{ paypalFlowOpen = true; \}/.test(site) &&
    /onCancel: function\(\)\{\s*paypalFlowOpen = false;/.test(site),
    'without this it cannot tell a switch made before the window opened from one made ' +
    'after, and only the second is dangerous');
  check('backing out of a payment rebuilds the buttons for the current choice',
    /onCancel: function\(\)\{[\s\S]{0,400}resetPaypalButtons\(\);/.test(site),
    'otherwise the next press is still priced from the abandoned attempt');
  check('an error and a completed payment both clear it too',
    /onError: function\(\)\{\s*paypalFlowOpen = false;/.test(site) &&
    /onApprove: function\(data\)\{\s*paypalFlowOpen = false;/.test(site),
    'a flag that only ever goes true would warn on every switch for the rest of the visit');
  /* ⚠ READ BEFORE THE TEARDOWN, which is what clears the flag. Written the other way
     round it is always false and the warning can never appear. */
  const switchBlock = site.slice(site.indexOf('var hadWindowOpen = paypalFlowOpen;'),
                                 site.indexOf('var hadWindowOpen = paypalFlowOpen;') + 900);
  /* ⚠ THE ORDER IS THE WHOLE CHECK. resetPaypalButtons is what clears the flag, so a
     read placed after it is always false and the warning could never appear — the same
     shape of fault as reading a snapshot after the write that wipes it. */
  const choiceBlock = site.slice(site.indexOf("closest('#invPayChoice .pay-choice')"),
                                 site.indexOf('/* Which payment methods the portal offers'));
  check('the flag is read BEFORE the teardown clears it',
    choiceBlock.indexOf('var hadWindowOpen = paypalFlowOpen;') !== -1 &&
    choiceBlock.indexOf('var hadWindowOpen = paypalFlowOpen;') <
      choiceBlock.indexOf('resetPaypalButtons();'),
    'read afterwards it is always false and the warning could never appear');
  check('and it says the amount they would now be paying',
    /portalPayableNow\(\)/.test(switchBlock) && /has been closed/.test(switchBlock),
    'money going one way while the screen says another is worth interrupting somebody over');
  check('the warning clears itself when no window was open',
    /swEl\.style\.display = 'none';/.test(switchBlock),
    'a warning left standing from an earlier switch is one nobody reads');
  check('and there is an element for it to write into',
    /id="paypalSwitchMsg"/.test(site),
    'a filler with no element is a silent no-op');

  /* Every control that changes what will be charged has to trigger it — fixing only
     the one Addie hit would leave the identical bug behind the tip buttons. */
  const choiceHandler = site.slice(site.indexOf("closest('#invPayChoice .pay-choice')"),
                                   site.indexOf("closest('#invPayChoice .pay-choice')") + 1800);
  check('changing what you are paying for takes the buttons down',
    /resetPaypalButtons\(\)/.test(choiceHandler),
    'this is the bug she reported');
  /* ⚠ THE END ANCHOR IS THE LISTENER, NOT THE ELEMENT. `customTipInput` also appears
     INSIDE the tip button handler (it writes the figure into that box), so slicing to
     the element's first mention cut the block off before the line under test and failed
     a check about correct code. */
  const tipBtns = site.slice(site.indexOf("document.querySelectorAll('.tip-option-btn')"),
                             site.indexOf("getElementById('customTipInput').addEventListener('input'"));
  check('and so does picking a tip',
    /resetPaypalButtons\(\)/.test(tipBtns),
    'a tip picked after the card form is open would be left out of an order that ' +
    'already exists — fixing only the choice would be half a fix');
  const tipInput = site.slice(site.indexOf("getElementById('customTipInput').addEventListener('input'"),
                              site.indexOf("function parseLightsDescription"));
  check('a typed tip re-renders when the box is left, not on every keystroke',
    /addEventListener\('change', function\(\)\{\s*resetPaypalButtons\(\);/.test(tipInput) &&
    !/'input', function\(\)\{[\s\S]{0,200}resetPaypalButtons/.test(tipInput),
    'tearing the buttons down on each keystroke would close a card form somebody is ' +
    'in the middle of filling in');
  check('and the rendered buttons are tracked so there is something to close',
    /paypalButtonInstances\.push\(cardBtn\)/.test(site) &&
    /paypalButtonInstances\.push\(ppBtn\)/.test(site),
    'without the references the teardown can only clear the container and the SDK is ' +
    'left holding a form it thinks is live');

  /* ---------------------------------------------------------------------
     5. The ledger has to survive the two invoice rebuilds, or the debt
        disappears again on the next ordinary save. The whole design rests
        on this, and neither rebuild is in a place a run can reach cheaply.
     --------------------------------------------------------------------- */
  const editRebuild = admin.slice(admin.indexOf('const priorFees = Array.isArray(inv.data.changeFeeNotes)'),
                                  admin.indexOf('invoiceUpdates.changeFees = rebuiltFees;') + 40);
  /* ⚠ REPOINTED 2026-09-01, AND NOW RUN RATHER THAN MATCHED. This asserted the literal
     `f.kind !== 'manual'`, so legitimately extending the filter (to also rebuild the
     office's own carried line) failed a check about correct code — the same slow-fuse
     shape as S82 and S129. What must be true is about WHICH NOTES SURVIVE, so the real
     filter is lifted and run over one note of each kind. */
  const keptFilterSrc = editRebuild.slice(editRebuild.indexOf('priorFees.filter('),
                                          editRebuild.indexOf('const rebuiltFeeNotes'));
  const keptFilter = new Function('ARREARS_KIND',
    'const priorFees = arguments[1]; return ' + keptFilterSrc.replace(/;\s*$/, '') + ';');
  const survivors = keptFilter('arrears', [
    { amount: 30, kind: 'manual', reason: 'typed on this form' },
    { amount: 30, reason: 'Light change' },
    { amount: 400, kind: 'arrears', reason: 'carried by Start New Season' },
    { amount: 250, kind: 'arrears', source: 'office', reason: 'typed in the arrears box' }
  ]).map(f => f.reason);

  check('an automatic carried balance survives an ordinary Edit Customer save',
    survivors.indexOf('carried by Start New Season') !== -1,
    'this is the whole design: the debt has to outlive a save that only fixed a phone ' +
    'number; got ' + JSON.stringify(survivors));
  check('and so does an automatic light-change fee',
    survivors.indexOf('Light change') !== -1,
    'editing a customer must never quietly cancel a fee the system charged them');
  check('the manual fee is rebuilt from the form, not kept',
    survivors.indexOf('typed on this form') === -1,
    'that box owns its own line');
  check('and so is the office-typed carried balance',
    survivors.indexOf('typed in the arrears box') === -1,
    'the box that wrote it owns it — otherwise editing the figure would add a second ' +
    'line rather than change the one that is there');
  check('and it re-sums the ledger it kept',
    /rebuiltFeeNotes\.reduce/.test(editRebuild),
    'keeping the note but not counting it puts the line on the invoice for $0');

  const sync = lift('syncPayerInvoice');
  check('syncPayerInvoice does not rewrite the fee ledger',
    !/changeFeeNotes:/.test(sync),
    'it rebuilds install from house prices on every Edit Customer save — writing the ' +
    'ledger there would wipe the carried debt');
  check('and it still counts the ledger in the status it saves',
    /existing\.changeFees/.test(sync),
    'a status that ignores the debt reads Paid in Full on a bill that is not');

  /* ⚠ THE CUSTOMER HAS TO BE ABLE TO SEE AND PAY IT, or carrying the debt is a
     hold with no route out. Both fields were already in the whitelist, which is
     why this design needed no server change — asserted so a tidy-up cannot
     quietly remove them and strand every held customer. */
  const server = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
  const whitelist = server.slice(server.indexOf('const INVOICE_READ_FIELDS'),
                                 server.indexOf('function sanitizeInvoice'));
  check('the portal still receives the fee ledger',
    /'changeFees'/.test(whitelist) && /'changeFeeNotes'/.test(whitelist),
    'without both, a held customer cannot see the debt that is holding them, and ' +
    'the balance they are asked to pay is not the balance we hold them against');


  /* ---- the tag All Customers prints under the season badge --------------
     ⭐ Owner, 2026-08-31: "we need a seperate tag for people who havent paid for
     2025 can you just add another one under the same badge that says unpaid
     2025."

     ⚠ THE WORDS ARE RUN, NOT MATCHED. houseArrearsTag is its own function for
     exactly that reason, and the year in it is read off the debt rather than
     typed — a tag with 2025 written into it would call a 2026 debt a 2025 one
     the moment a season turns. */
  {
    const tag = api.tag;
    const owing = { name: 'Owes', phone: '8015550001', address: '1 Elm St', city: 'Lehi',
                    rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };

    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: billed(400, 0) }]]));
    check('a customer who still owes gets a tag naming the year of the debt',
      tag(owing) === 'Unpaid 2025',
      'got "' + tag(owing) + '" — the fixture note carries year 2026, so a tag ' +
      'reading 2025 would mean the year had been typed rather than read');

    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: billed(400, 400) }]]));
    check('and a customer who has paid it gets none',
      tag(owing) === '',
      'got "' + tag(owing) + '" — a tag on somebody who is square is worse than ' +
      'no tag: the office rings them for money they do not owe');

    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: billed(800, 400) }]]));
    check('a part payment still leaves the tag on',
      tag(owing) === 'Unpaid 2025',
      'got "' + tag(owing) + '" — half of last season is still last season, and ' +
      'the season hold already refuses to release them');

    /* ⚠ A NOTE FROM BEFORE THE YEAR FIELD EXISTED, and with no four digits in its
       sentence either, so neither route to a year can answer. */
    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: {
      changeFeeNotes: [{ amount: 400, kind: 'arrears', reason: 'Unpaid balance carried over' }],
      changeFees: 400, deposit: 0, credits: 0 } }]]));
    check('an older debt with no year on it still says what it is',
      tag(owing) === 'Unpaid 2025',
      'got "' + tag(owing) + '" — a bare "Unpaid" reads as THIS season’s bill, ' +
      'which is the one thing this tag is not about');

    /* ⚠ AND A HOUSE ON SOMEBODY ELSE'S BILL IS JUDGED BY THAT BILL. The tag reads
       through billToPhone, so the tenant is tagged when the landlord's bill is the
       one still carrying the debt — and can never name a different year from the
       money figure the Route column prints beside it. */
    const tenant = { name: 'Tenant', phone: '8015559999', address: '2 Oak Ave', city: 'Lehi',
                     billToPhone: '(801) 555-0001', rsvpStatus: 'yes',
                     rsvpRespondedAt: '2026-09-01T00:00:00Z' };
    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: billed(400, 0) }]]));
    check('a house billed elsewhere is tagged off the bill it is actually on',
      tag(tenant) === 'Unpaid 2025',
      'got "' + tag(tenant) + '" — reading their own key instead would tag nobody, ' +
      'and the debt would be invisible on every row it belongs to');
    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: billed(400, 400) }]]));
    check('and is untagged once that bill is settled',
      tag(tenant) === '',
      'got "' + tag(tenant) + '"');

    api.setInvoices(new Map());
    check('a customer with no invoice at all is not tagged',
      tag(owing) === '',
      'got "' + tag(owing) + '" — no bill is not the same as an unpaid one');
    check('and neither is a missing record', tag(null) === '', 'got "' + tag(null) + '"');
  }

  /* ---------------------------------------------------------------------
     6. TWO AMOUNTS ON THE PORTAL, AND THE TIP THAT WAS BEING EATEN (2026-08-31)

     Addie, looking at a bill carrying last year's balance: "it says pay 1,146 but
     should only show 200", and then: "2 button options for last year and full
     payment."

     ⚠ EVERY CHECK IN THIS SECTION RUNS THE SHIPPED CODE. The bug it was written
     over — a $30 tip on a $200 part payment being booked as $230 against the bill
     and $0 to the crew — is invisible to a regex: the old line was correct-looking
     arithmetic that only went wrong once the button stopped charging the whole
     balance. Reading the source would have passed it every day it was broken.
     --------------------------------------------------------------------- */
  const captureSrc = serverSrc.slice(serverSrc.indexOf('exports.paypalCaptureOrder'),
                                     serverSrc.indexOf('exports.paypalCaptureOrder') + 6000);
  const splitFrom = captureSrc.indexOf('const owed =');
  const splitTo   = captureSrc.indexOf('tip = Math.max(', splitFrom);
  const splitSrc  = captureSrc.slice(splitFrom, captureSrc.indexOf('\n', splitTo));
  check('the capture split was lifted out of the Cloud Function', splitFrom !== -1 && splitTo !== -1,
    'nothing below this line is testing what ships');

  /* arrearsOutstandingServer and centsOf are handed in from js/money.js — the twin
     money-parity already holds identical to the server's copy — so this runs the
     real rule rather than a fixture that would agree with itself. */
  const splitPayment = new Function('inv', 'capturedAmount', 'arrearsOutstandingServer', 'centsOf',
    'let serviceAmount = capturedAmount; let tip = 0;\n' + splitSrc +
    '\nreturn { serviceAmount: serviceAmount, tip: tip };');
  function split(inv, captured) {
    return splitPayment(inv, captured, money.arrearsOutstanding, money.centsOf);
  }

  const carrying = {
    install: 946, removal: 0, changeFees: 200, credits: 0, deposit: 0,
    changeFeeNotes: [{ amount: 200, kind: 'arrears', year: '2025',
                       reason: 'Unpaid balance from the 2025 season' }]
  };

  const partWithTip = split(carrying, 230);
  check('a $30 tip on a $200 part payment reaches the crew',
    money.centsOf(partWithTip.tip) === 3000,
    'THE BUG: the old rule called anything under the balance service, so the tip was ' +
    'booked as bill payment and recorded as $0; got tip ' + partWithTip.tip);
  check('and the $200 still settles last season',
    money.centsOf(partWithTip.serviceAmount) === 20000,
    'if the tip is carved out of the wrong side, the debt survives a payment that cleared it; ' +
    'got service ' + partWithTip.serviceAmount);

  const partNoTip = split(carrying, 200);
  check('paying last season with no tip books no tip',
    money.centsOf(partNoTip.serviceAmount) === 20000 && money.centsOf(partNoTip.tip) === 0,
    'got ' + JSON.stringify(partNoTip));

  const allNoTip = split(carrying, 1146);
  check('choosing everything owing settles the whole bill',
    money.centsOf(allNoTip.serviceAmount) === 114600 && money.centsOf(allNoTip.tip) === 0,
    'the second button must not turn the balance into a tip; got ' + JSON.stringify(allNoTip));

  const allWithTip = split(carrying, 1176);
  check('and a tip on top of everything owing is still a tip',
    money.centsOf(allWithTip.serviceAmount) === 114600 && money.centsOf(allWithTip.tip) === 3000,
    'got ' + JSON.stringify(allWithTip));

  const noArrears = { install: 946, removal: 0, changeFees: 0, credits: 0, deposit: 0, changeFeeNotes: [] };
  check('a customer with nothing carried is split exactly as before',
    money.centsOf(split(noArrears, 946).serviceAmount) === 94600 &&
    money.centsOf(split(noArrears, 976).tip) === 3000,
    'this change must not move the ordinary payment, which is nearly every payment');
  check('and a short payment against an ordinary bill is all service, no tip',
    money.centsOf(split(noArrears, 400).serviceAmount) === 40000 &&
    money.centsOf(split(noArrears, 400).tip) === 0,
    'an underpayment is not a gratuity');

  /* Floating point: $230 against a $200 debt has been the shape of every rounding
     bug in this repo. A cent adrift here books the whole payment as a tip. */
  const crumbs = { install: 0.1, removal: 0, changeFees: 200, credits: 0, deposit: 0,
                   changeFeeNotes: [{ amount: 200, kind: 'arrears', reason: '2025' }] };
  check('a crumb does not turn a payment into a tip',
    money.centsOf(split(crumbs, 200).serviceAmount) === 20000,
    'got ' + JSON.stringify(split(crumbs, 200)));

  /* ---- the choice itself ---- */
  check('the customer can now choose the whole balance instead',
    /const payingLastSeason = arrearsLeft > 0 && !payAll;/.test(createOrder) &&
    /const \{ phone, tipAmount, payAll \}/.test(createOrder),
    'her words: "2 button options for last year and full payment"');
  check('and the choice arrives as a flag, never as an amount',
    !/Number\(request\.data[^)]*amount/i.test(createOrder) &&
    /payingLastSeason \? arrearsLeft : balanceDue/.test(createOrder),
    'a browser that can name a figure can name $0.01 — both figures must stay ' +
    'the server\'s own');

  /* ---- and what the customer is shown ---- */
  const payable = site.slice(site.indexOf('function portalPayableNow()'),
                             site.indexOf('function renderPayChoice'));
  const payableOk = liftOk(payable) && /function portalPayableNow\(\)/.test(payable);
  check('portalPayableNow was lifted out of the portal', payableOk,
    'the portal has no single answer to "what are we charging them right now", so the ' +
    'four checks below cannot run at all');
  /* ⚠ A MISSING LIFT REPORTS, IT DOES NOT THROW. Left unguarded this crashed the whole
     file with one unattributable ReferenceError when run against a page that predates
     the function — which is exactly the run (red-first, §9.6) where the failures need
     to be readable. */
  const payableFn = payableOk
    ? new Function('portalPayScope', 'portalArrearsLeft', 'portalTotalDue',
        payable + '\nreturn portalPayableNow();')
    : function () { return null; };
  check('the panel offers last season\'s figure, not the balance',
    payableFn('arrears', 200, 1146) === 200,
    'THE BUG SHE FOUND: "it says pay 1,146 but should only show 200" — the page ' +
    'printed the balance above a button charging the arrears, and pre-filled Venmo ' +
    'with it, which is money collected wrongly rather than a display fault');
  check('choosing everything owing offers the balance',
    payableFn('all', 200, 1146) === 1146);
  check('a customer with nothing carried is offered their balance as always',
    payableFn('arrears', 0, 946) === 946);
  check('and the arrears figure can never exceed the balance on screen',
    payableFn('arrears', 900, 400) === 400,
    'a carried line larger than what is left must not ask for more than they owe');

  check('the tip and the Venmo link follow the amount actually being charged',
    /currentServiceDue = portalPayableNow\(\)/.test(site) &&
    /var total = currentServiceDue \+ currentTipAmount/.test(site) &&
    /venmoBtn\.href = 'https:\/\/venmo\.com\/HighLightingUtah\?txn=pay&amount=' \+ total\.toFixed\(2\)/.test(site),
    'Venmo is typed by hand at the other end — whatever this link says is what ' +
    'actually arrives, so a wrong number here is a wrong payment, not a wrong label');
  check('the portal sends the choice to the server',
    /payAll: portalPayScope === 'all'/.test(site),
    'without it the second button charges last season again and nothing says why');
  check('last season gets its own card on the bill',
    /still owing<\/div>/.test(site) && /This season\\u2019s total/.test(site),
    'her words: "I need the unpaid last year to look more obvious but still nice ' +
    'and organized"');
  /* ⚠ AND THE TWO CARDS ARE RUN, NOT READ. Splitting one bill into two subtotals is
     arithmetic a regex cannot check, and a card whose lines do not add up to its own
     total is worse than the single list it replaced — it looks like a mistake in the
     books rather than a layout. Money already received is applied oldest-debt-first,
     the same order the hold reads it in. */
  /* ⚠ BOTH LINE ENDINGS, 2026-08-31. This searched for '\n}\n' alone, which does not
     exist in a CRLF checkout — so on Windows the slice ran off the end, the lift came
     back empty, and the whole file died with a bare "renderInvoiceBreakdown is not
     defined" before a single check scored. Green on Linux CI, unrunnable on the
     machine the office actually uses. CLAUDE.md §7 says it outright: write \r?\n. */
  const bdStart = site.indexOf('function renderInvoiceBreakdown(record, n){');
  const bdFrom = site.lastIndexOf("box.style.display = 'block';",
                   site.indexOf('function renderScheduleStrip'));
  const bdEndLf = site.indexOf('\n}\n', bdFrom);
  const bdEndCrLf = site.indexOf('\r\n}\r\n', bdFrom);
  const bdEnd = bdEndCrLf !== -1 && (bdEndLf === -1 || bdEndCrLf < bdEndLf)
    ? bdEndCrLf + 5 : bdEndLf + 3;
  const bdSrc = site.slice(bdStart, bdEnd);
  check('renderInvoiceBreakdown was lifted whole', liftOk(bdSrc), bdSrc.slice(0, 60));
  const bdBox = { innerHTML: '', style: {} };
  const breakdown = new Function('document', 'fmt', 'escapeHtmlPortal', 'centsOf',
    'ARREARS_KIND', 'arrearsOnInvoice', bdSrc + '\nreturn renderInvoiceBreakdown;')(
    { getElementById: function () { return bdBox; } },
    function (n) { return '$' + Number(n).toFixed(2); },
    String, money.centsOf, money.ARREARS_KIND, money.arrearsOnInvoice);
  function bill(rec, n) {
    breakdown(rec, n);
    const out = {};
    const re = /<span>([^<]*)<\/span><span[^>]*>[^\d−-]*([−-]?)\$([\d.]+)<\/span>/g;
    let m;
    while ((m = re.exec(bdBox.innerHTML))) out[m[1]] = Number(m[3]) * (m[2] ? -1 : 1);
    return out;
  }
  const arrearsNotes = [{ amount: 200, kind: 'arrears', year: '2025',
                          reason: 'Unpaid balance from the 2025 season' }];

  const unpaid = bill({ changeFeeNotes: arrearsNotes, creditNotes: [],
                        arrearsOutstanding: 200, arrearsSeason: '2025' },
                      { install: 946, removal: 0, changeFees: 200, credits: 0, deposit: 0, totalDue: 1146 });
  check('the bill from her screenshot splits into 200 and 946',
    unpaid['Still owing'] === 200 && unpaid['This season\u2019s total'] === 946 &&
    unpaid['Balance due'] === 1146,
    'got ' + JSON.stringify(unpaid));

  const partly = bill({ changeFeeNotes: arrearsNotes, creditNotes: [],
                        arrearsOutstanding: 0, arrearsSeason: '2025' },
                      { install: 946, removal: 0, changeFees: 200, credits: 0, deposit: 250, totalDue: 896 });
  check('a payment spanning both seasons is shown on the card it went to',
    partly['Payments received'] === -50 && partly['This season\u2019s total'] === 896 &&
    partly['Still owing'] === undefined,
    'the 200 that cleared last season must not also be printed against this one, ' +
    'where it would make the subtotal miss by 200; got ' + JSON.stringify(partly));

  const short = bill({ changeFeeNotes: arrearsNotes, creditNotes: [],
                       arrearsOutstanding: 100, arrearsSeason: '2025' },
                     { install: 946, removal: 0, changeFees: 200, credits: 0, deposit: 100, totalDue: 1046 });
  check('a part payment against last season shows on last season\u2019s card',
    short['Unpaid balance'] === 200 && short['Paid or credited so far'] === -100 &&
    short['Still owing'] === 100 && short['This season\u2019s total'] === 946,
    'got ' + JSON.stringify(short));

  const plain = bill({ changeFeeNotes: [], creditNotes: [], arrearsOutstanding: 0 },
                     { install: 946, removal: 0, changeFees: 0, credits: 0, deposit: 100, totalDue: 846 });
  check('a customer carrying nothing still gets the one plain list',
    plain['This season\u2019s total'] === undefined && plain['Balance due'] === 846,
    'two cards for one season is ceremony around a number that needs none; got ' +
    JSON.stringify(plain));

  check('and the breakdown still never sums the ledger itself',
    /record\.arrearsOutstanding/.test(site) && !/kind === 'arrears'/.test(site),
    'the card needs to know WHICH line is last season\'s, which is what ARREARS_KIND ' +
    'is imported for — what is still outstanding stays the server\'s answer');


  /* ---- what the form does when it OPENS --------------------------------
     ⚠ ALL THREE OF THESE WERE FOUND MISSING BY A RED-CHECK. Every check above is
     about the tag or the save; nothing looked at the moment the form is filled in,
     so blanking the season box, overwriting a season somebody typed, and turning
     the suggested amount into a real value all went straight through. */
  {
    const fillStart = admin.indexOf('const ecOfficeArrears = ecFeeNotes.find(');
    const fill = fillStart === -1 ? '' :
      admin.slice(fillStart, admin.indexOf('updateEditCustArrearsSummary(ecFeeNotes);', fillStart));
    check('the arrears part of the open is findable', !!fill);
    check('the season box opens on the recorded season, else the assumed one',
      /\(ecOfficeArrears && ecOfficeArrears\.year\) \|\| ARREARS_ASSUMED_SEASON/.test(fill),
      'opening blank is the ambiguity the assumption removes; opening on the ' +
      'constant regardless throws away a season somebody typed on purpose');
    /* ⚠ THE ONE THAT GUARDS MONEY. A real value in the amount box means every
       ordinary save of any customer — opened to fix a phone number — writes a debt
       of their whole year's price onto them AND holds them off the schedule until
       it is paid. A placeholder cannot do that. */
    check('the amount is SUGGESTED, never filled in',
      /ecArrEl\.placeholder = /.test(fill) && !/ecArrEl\.value = /.test(fill),
      'a pre-filled amount turns opening a record into charging somebody');
    check('and there is a one-click way to accept the suggestion',
      /editCustArrearsSameAsThis/.test(admin) && /dispatchEvent\(new Event\('input'\)\)/.test(admin),
      'without it she is typing the same number she was just shown, which is the ' +
      'typing the suggestion exists to save');
  }

  /* ---- and the season is ASSUMED rather than asked for ------------------
     ⭐ Addie, 2026-08-31, twice. First "assume if they havent paid for a previous
     season its always 2025", then, having found the Which season box: "we
     actually want to use that just modify this … so it assumes 2025 season and
     adjust everything youve done to be centered around that."

     ⚠ SHE WAS SHOWN THE COST AND CHOSE IT. A debt carried out of THIS season is a
     2026 debt, and while the constant says 2025 the tag calls it a 2025 one. Every
     debt on the book today did come from 2025, and "Unpaid last season" on the
     older notes was the ambiguity she was actually objecting to. The reasoning for
     the derived year it replaces is kept in MON-45 — it is the argument for moving
     the constant, not for reinstating the derivation. */
  {
    const tag = api.tag;
    const assumed = (admin.match(/const ARREARS_ASSUMED_SEASON = '([^']*)';/) || [])[1];
    check('the assumed season is one named constant in the page', !!assumed,
      'typed into each place that needs it, moving it next year is a hunt rather ' +
      'than a line');
    /* ⚠ ASSERTED BY VALUE, deliberately, so that moving it is a DELIBERATE act with a
       failing check to update — the same reason run-all pins BULK_CHUNK_SIZE. */
    check('and today it is 2025', assumed === '2025',
      'got "' + assumed + '" — if this moved on purpose, update this check and the ' +
      'ruling behind it in the same commit');

    const owing = { name: 'Owes', phone: '8015550001', address: '1 Elm St', city: 'Lehi',
                    rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };
    /* ⚠ THE FIXTURE NOTE SAYS 2026 ON PURPOSE. This is the whole of her ruling: the
       tag ignores what the note says and reports the assumed season. A version that
       went back to reading the note would answer 2026 here and pass every other
       check in this block. */
    api.setInvoices(new Map([['8015550001', { id: '8015550001', data: billed(400, 0) }]]));
    check('a debt whose note names another season still reads the assumed one',
      tag(owing) === 'Unpaid 2025',
      'got "' + tag(owing) + '" against a note carrying year 2026 — this is the ' +
      'ruling, and the one check that fails if the derived year comes back');
  }

  /* ---------------------------------------------------------------------
     A YES IS NOT A PAYMENT, AND THE RSVP USED TO SAY IT WAS (2026-09-01)

     RS-24 holds a debtor out of the season EVEN WHEN THEY ANSWER YES — and the
     RSVP confirmation nonetheless ended on "We'll get you scheduled!". The one
     group guaranteed not to get a crew was the one being promised one.

     ⚠ THE BROWSER SPECS CANNOT REACH ANY OF THIS. test/rsvp-arrears.spec.js runs
     against a fake Firebase, so a portalRsvp that stopped returning the figure
     entirely would leave all eight of them green. This is that half.
     --------------------------------------------------------------------- */
  const rsvpAt = serverSrc.indexOf('exports.portalRsvp');
  const rsvpSrc = rsvpAt === -1 ? ''
    : stripComments(serverSrc.slice(rsvpAt, serverSrc.indexOf('exports.portalSetGateCode', rsvpAt)));

  check('portalRsvp was found, whole', !!rsvpSrc && rsvpSrc.length > 400,
    'every check below slices this — an empty slice would pass them all vacuously');

  check('the RSVP answer carries what is still owed from last season',
    /arrearsOutstanding: owed\.outstanding/.test(rsvpSrc) &&
    /arrearsSeason: owed\.season/.test(rsvpSrc),
    'without these two the confirmation cannot know, and goes back to promising ' +
    'an install to somebody RS-24 holds out of the season');

  /* ⚠ REPOINTED, NOT WEAKENED (2026-09-01). These four asserted the lookup INLINE
     in portalRsvp — that is, they were pinned to where the code happened to sit.
     The quote-approval door needed the same lookup, so it moved into the shared
     arrearsForCustomer and these began failing on correct code: the §7 slow-fuse
     shape, and the same one that already caught S82, S129 and the folder-names
     suite. What must be true is that portalRsvp ASKS the one rule, on a yes, and
     returns both fields; the bill-key rule, the fail-safe and the logging are
     properties of the helper and are asserted against it below. */
  check('a yes asks the one shared rule for what they owe',
    /response === 'yes' \? await arrearsForCustomer\(oldData\)/.test(rsvpSrc),
    'and only a yes — somebody saying no or back next year is not being scheduled ' +
    'anyway, so reading an invoice for them is a Firestore read per answer for nothing');

  check('and portalRsvp does not resolve an invoice for itself',
    !/collection\('invoices'\)/.test(rsvpSrc),
    'a second lookup here is a second copy of "does this customer owe", which is ' +
    'how two screens start making different claims about one rule');

  /* ⚠ AND THE PAGE MUST NOT WORK IT OUT FOR ITSELF, the same rule the payment
     card already follows: index.html repeats the server's OUTSTANDING figure and
     never sums the fee ledger to get it.

     ⭐ REPOINTED 2026-09-01 (RS-31). This used to read `showChangesQuestion`, the
     RSVP confirmation screen. A yes now goes straight into the portal, so that
     function is gone and the check was matching an empty string — failing on
     correct code, which is the slow-fuse shape CLAUDE.md §7 records for S82, S129
     and the folder-names suite: pinned to WHERE a rule happened to live rather
     than to what must be true.

     The rule is unchanged and is asserted on the screen that shows the figure now,
     `renderInvoiceBreakdown`.

     ⚠ IT IS NOT "the function never mentions the ledger", which was the shape of
     the old check and is WRONG here — this one reads `changeFeeNotes` on purpose,
     to LIST each fee as its own line, and `arrearsOnInvoice` to say what was
     carried BEFORE anything was paid. Both are legitimate. The one figure that
     must never be re-derived in the browser is what is STILL OWED, so that is what
     is pinned: `lastSeasonLeft` comes from `record.arrearsOutstanding`, which
     portalInvoice computes, and from nothing else. A version that summed the
     ledger for it would put a second copy of the arrears rule in the page. */
  const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const invAt = idx.indexOf('function renderInvoiceBreakdown(');
  /* ⚠ String.fromCharCode(10), NOT a backslash-n literal. Written as an escape it
     did not survive the script that inserted this block and became a real newline
     inside the quotes — a syntax error. CLAUDE.md §5 records the same trap for the
     $$ column and for run-all.js's word boundaries. */
  const invEnd = idx.indexOf(String.fromCharCode(10) + '}', invAt);
  const invSrc = invAt === -1 ? '' : stripComments(idx.slice(invAt, invEnd + 2));
  check('the portal repeats the server’s outstanding figure, never its own',
    !!invSrc && /lastSeasonLeft\s*=\s*Number\(record\.arrearsOutstanding\)/.test(invSrc),
    'got: ' + JSON.stringify(invSrc.slice(0, 160)));


  /* ---- the badge IS the gate --------------------------------------------
     ⭐ Addie, 2026-08-31: "they should not be able to have the confirmed tag if they
     havent paid for a previous year … so it should look for anyone who is confirmed
     and put them in schedule … make sure they cant have the confirmed tag if they
     are breaking a rule so if you break one of the rules they automatically change
     the badge to pending mainly just the havent paid for last year", and "you
     shouldnt have to manually add them to pending".

     ⚠ MEASURED ON HER BOOK FIRST: 956 customers, 951 held out with "no RSVP yet", 2
     for owing from 2025, 1 back next year, 1 scheduled. The rule had emptied the
     season, and it was live because a TEST send stamps rsvpSentAt just as a real one
     does.

     ⚠ THESE RUN THE PREDICATE. "Confirmed means they will be scheduled" is a claim
     about two functions agreeing, and the only way to check it is to ask both. */
  {
    const badge = api.badge, out = api.out;
    const base = { name: 'A', phone: '8015550001', address: '1 Elm St', city: 'Lehi' };
    const yes  = { rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-01T00:00:00Z' };
    const clear = new Map([['8015550001', { id: '8015550001', data: billed(0, 0) }]]);
    const owing = new Map([['8015550001', { id: '8015550001', data: billed(400, 0) }]]);
    const replied = Object.assign({}, base, yes);

    api.setInvoices(clear);
    check('somebody who replied Yes is CONFIRMED',
      badge(replied) === 'confirmed' && out(replied) === false,
      'got "' + badge(replied) + '" — "anyone who is confirmed is scheduled"');
    /* ⚠ THE 951. They used to read Confirmed while every scheduler dropped them, which
       is the complaint that started all of this. Pending is the honest word, and it is
       what lets one-confirmed mean one-scheduled. */
    check('and somebody who has never answered is PENDING, not falsely Confirmed',
      badge(base) === 'pending' && out(base) === true,
      'got "' + badge(base) + '" — a badge saying Confirmed about somebody no crew is ' +
      'going to is the bug, whichever way the rule is set');

    api.setInvoices(owing);
    check('a replier who owes for a previous season is PENDING too',
      badge(replied) === 'pending' && out(replied) === true,
      'got "' + badge(replied) + '" — "they should not be able to have the confirmed ' +
      'tag if they havent paid for a previous year"');

    api.setInvoices(clear);
    check('a set queued to come back is PENDING',
      badge(Object.assign({}, replied, {needsLightRecycle: true})) === 'pending',
      'a house whose lights are being collected is not one to send a crew to');
    check('but a mover keeping their customer is confirmed',
      badge(Object.assign({}, replied, {needsLightRecycle: true, recycleKeepingCustomer: true})) === 'confirmed',
      'their old set comes back AND a new one is built — they are still in the season');
    /* ⚠ A NEW HANG IS IN WITHOUT A REPLY, because we deliberately never ask them. */
    check('and a new customer nobody was ever going to ask is confirmed',
      badge(Object.assign({}, base, {chargeNewMemberFee: true})) === 'confirmed',
      'requiring an answer to a question we never send is a test nobody can pass');

    check('Back Next Year stays its own answer rather than collapsing into Pending',
      badge(Object.assign({}, base, {maybeNextYear: true})) === 'maybe' &&
      badge(Object.assign({}, base, {rsvpStatus: 'backnextyear'})) === 'maybe',
      'Pending is somebody we want who is blocked; Back Next Year is somebody who ' +
      'told us no for now, and the office toggles that one by hand');
    /* ⚠ AND A FLAT NO IS ITS OWN ANSWER AGAIN (2026-09-04). This line used to
       assert 'maybe' alongside the two above; the claim it was making — an answered
       no is not Pending — is unchanged, and the key it lands on is. Addie asked for
       the two to be told apart on the badge so the two follow-up emails have
       something to aim at. */
    check('and a flat no is its own answer, neither Pending nor Back Next Year',
      badge(Object.assign({}, base, {rsvpStatus: 'no'})) === 'no',
      'got "' + badge(Object.assign({}, base, {rsvpStatus: 'no'})) + '"');

    /* ⚠ THE INVARIANT SHE ASKED FOR, IN BOTH DIRECTIONS AND IN BOTH RULE STATES:
       "anyone who is confirmed is scheduled but if one person is confirmed there
       should be one person on the schedule." Confirmed and in-the-season are ONE
       fact, so the count on the badges and the count on the schedule cannot drift —
       whichever way SEASON_ELIGIBILITY is set. */
    const cases = [
      {}, yes, {maybeNextYear: true}, {rsvpStatus: 'no'}, {rsvpStatus: 'backnextyear'},
      Object.assign({needsLightRecycle: true}, yes),
      Object.assign({needsLightRecycle: true, recycleKeepingCustomer: true}, yes),
      {chargeNewMemberFee: true}
    ];
    /* ⚠ BOTH LEVERS, because forceRule can only ever turn the rule ON — the page's
       own constant already has it live, so a `forceRule(false)` mode was silently
       testing the live rule twice and calling one of them "off". Caught by reading
       the harness rather than by a failure, which is exactly how a vacuous case
       survives. */
    [[true, 'rule live'], [false, 'rule off']].forEach(function(mode){
      api.forceRule(mode[0]);
      api.forceOff(!mode[0]);
      [['clear', clear], ['owing', owing]].forEach(function(pair){
        api.setInvoices(pair[1]);
        cases.forEach(function(extra, n){
          const d = Object.assign({}, base, extra);
          check('confirmed means scheduled — ' + mode[1] + ', ' + pair[0] + ' case ' + n,
            (badge(d) === 'confirmed') === (out(d) === false),
            'badge said "' + badge(d) + '" and isOutForSeason said ' + out(d) +
            ' — the screen and the scheduler must not disagree about one customer');
        });
      });
    });
    api.forceRule(false);
    api.forceOff(false);
    api.setInvoices(clear);
  }

  /* ---------------------------------------------------------------------
     THE SECOND DOOR INTO A YES — approving a quote (2026-09-01)

     For an existing member quoteRespond writes seasonYesUpdates, so RS-24 holds
     a debtor out of the season through this door exactly as through the RSVP
     link — and all three of the page's approval endings promised an install.
     Fixing one door and leaving the other is half a fix by this repo's own name
     for it, and would leave two screens contradicting each other about one rule.
     --------------------------------------------------------------------- */
  const helperAt = serverSrc.indexOf('async function arrearsForCustomer(');
  const helperSrc = helperAt === -1 ? ''
    : stripComments(serverSrc.slice(helperAt, serverSrc.indexOf('\n}', helperAt) + 2));

  check('there is ONE server helper for what a customer owes', !!helperSrc,
    'arrearsForCustomer is what stops the quote door becoming a second copy of ' +
    'the lookup — two copies is how two screens start making different claims');

  check('both doors ask it rather than looking the invoice up themselves',
    (serverSrc.match(/await arrearsForCustomer\(/g) || []).length >= 2 &&
    (stripComments(serverSrc).match(/collection\('invoices'\)\.doc\(billKey\)/g) || []).length === 1,
    'portalRsvp and quoteRespond must both call the helper, and only the helper ' +
    'may resolve the bill key');

  check('the helper reads the bill the house is on, not the house\u2019s own key',
    /digitsOnly\(d\.billToPhone\)\s*\|\|\s*invoiceKeyFor\(d\)/.test(helperSrc),
    'RS-24 verbatim: if Dana pays for Kyle and Dana did not pay, Kyle\u2019s lights ' +
    'were not paid for either');

  check('and it answers nought rather than throwing',
    /catch \(e\)/.test(helperSrc) && /return none;/.test(helperSrc) &&
    /console\.error\('\[HU\] arrearsForCustomer failed/.test(helperSrc),
    'silence is the fail-safe: telling somebody they owe money we cannot prove ' +
    'they owe is worse than not warning them about a real debt — and it is logged, ' +
    'because nothing may fail quietly');

  const qrAt = serverSrc.indexOf('exports.quoteRespond');
  const qrSrc = qrAt === -1 ? '' : stripComments(serverSrc.slice(qrAt));
  check('quoteRespond returns the figure, and only for an approve it can attribute',
    /* ⚠ ANCHORED TO THE ASSIGNMENT, NOT THE BARE CONDITION — the red-check caught
       this one vacuous: `action === 'approve' && memberRef` is ALSO the condition on
       the season write twenty lines above, so the sabotage that dropped it from the
       arrears line matched the other occurrence and sailed through. */
    /const approverOwes = \(action === 'approve' && memberRef\)/.test(qrSrc) &&
    /arrearsOutstanding: approverOwes\.outstanding/.test(qrSrc),
    'alreadyMember is deliberately wider than memberRef — a debt cannot be looked ' +
    'up for somebody we cannot identify — and telling a customer who just DECLINED ' +
    'that they owe money is a chase');

  /* ⚠ WEAKER THAN THE BROWSER SPECS, AND SAID SO RATHER THAN PRETENDED OTHERWISE.
     test/rsvp-arrears.spec.js drives the formCompleted ending for real. The other
     two — the member "keep everything the same" ending and the portal's own
     quoteApprovedMsg — need stub shapes this suite does not build, so all that is
     asserted here is that they still route through the one helper. That catches a
     revert; it does not prove what renders. */
  const idxSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  check('all three approval endings go through the one wording rule',
    (idxSrc.match(/quoteScheduleSub\(/g) || []).length >= 4,
    'the helper is declared once and called at three endings — a site that stops ' +
    'calling it goes back to promising an install to somebody held out of the season');

  check('and the page still never sums the fee ledger itself',
    /function quoteScheduleSub\(/.test(idxSrc) &&
    !/quoteScheduleSub[\s\S]{0,400}changeFeeNotes/.test(idxSrc),
    'the figure is the server\u2019s — a third copy of the carried-balance maths ' +
    'here would sit outside money-parity and would be the one the customer reads');

  /* ---------------------------------------------------------------------
     Nothing goes into the system until last season is paid
     (Dax, 2026-09-02)

     ⚠ THIS IS THE HALF THE BROWSER TESTS CANNOT SEE. test/arrears-lock.spec.js
     proves the screen — the pop-up, the shut tabs — but it runs against a fake
     Firebase, so it would stay green with the server wide open. "Before anything
     goes into the system" is a claim about the DATABASE: portalSave is a public
     callable, and a hidden tab is not a lock.
     --------------------------------------------------------------------- */
  {
    const fnSrc = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
    const at = fnSrc.indexOf('exports.portalSave = onCall(');
    const saveSrc = at === -1 ? '' : stripComments(fnSrc.slice(at, fnSrc.indexOf('\nexports.', at + 10)));

    check('portalSave refuses to write while last season is outstanding',
      !!saveSrc && /arrearsHoldBlocks\(/.test(saveSrc) && /throw arrearsHoldError\(/.test(saveSrc),
      'the portal can be driven from a browser console with nothing but a token — ' +
      'if the write is not refused here, the hold is a suggestion');

    /* ⚠ AND IT REFUSES BEFORE IT READS A SINGLE FIELD. Ordering, not presence:
       a check that runs after the updates are assembled leaves a version of this
       function in which a held customer's data has already been touched. */
    check('and it refuses before it assembles any update',
      !!saveSrc && saveSrc.indexOf('arrearsHoldBlocks(') !== -1 &&
      saveSrc.indexOf('arrearsHoldBlocks(') < saveSrc.indexOf('const updates = {}'),
      'the hold has to come first, or the refusal is decoration on work already done');

    /* ⚠ CANCELLING IS EXEMPT BY NAME. Somebody trying to LEAVE must never be told
       to pay first — they stop replying instead, and the office never learns why.
       Dax's own call when the scope was put to him. */
    check('cancelling is exempt from the hold',
      !!saveSrc && /section\s*!==\s*'cancel'/.test(saveSrc),
      'a customer who wants out must be able to say so whatever they owe');

    /* ⚠ AND THE RSVP ANSWER IS NEVER HELD, which is RS-33 and is the reason the
       whole season still works: the answer is recorded before the portal loads, and
       a customer who owes money is exactly the one whose yes or no is most needed. */
    const rsvpAt = fnSrc.indexOf('exports.portalRsvp = onCall(');
    const rsvpSrc = rsvpAt === -1 ? '' : stripComments(fnSrc.slice(rsvpAt, fnSrc.indexOf('\nexports.', rsvpAt + 10)));
    check('portalRsvp is never held',
      !!rsvpSrc && !/arrearsHoldBlocks\(/.test(rsvpSrc),
      'holding the ANSWER would lose the one thing RS-33 turns on');

    /* ⚠ NOR IS THE GATE CODE, and that is not an oversight either: the gate-code
       question is put to a held customer on the way past (it is asked BEFORE the
       pop-up), so a question we insist on asking has to be answerable. */
    const gcAt = fnSrc.indexOf('exports.portalSetGateCode = onCall(');
    const gcSrc = gcAt === -1 ? '' : stripComments(fnSrc.slice(gcAt, fnSrc.indexOf('\nexports.', gcAt + 10)));
    check('portalSetGateCode is never held',
      !!gcSrc && !/arrearsHoldBlocks\(/.test(gcSrc),
      'the gate code is still asked of a held customer, so it must still save');

    /* ⚠ AND THE HOLD FAILS OPEN, the opposite direction to the season hold and for
       the reason arrearsForCustomer already answers nought on an unreadable invoice:
       refusing a save because we could not READ a bill locks out a customer who may
       owe nothing at all. */
    const holdAt = fnSrc.indexOf('async function arrearsHoldBlocks(');
    const holdSrc = holdAt === -1 ? '' : stripComments(fnSrc.slice(holdAt, fnSrc.indexOf('\n}', holdAt) + 2));
    check('the hold reads the shared figure rather than its own',
      !!holdSrc && /arrearsForCustomer\(/.test(holdSrc) && !/changeFeeNotes/.test(holdSrc),
      'a second copy of the carried-balance maths here would be the copy deciding ' +
      'whether a customer is locked out of their own account');

    /* ---- and the portal screen reads the server's figure, never its own ---- */
    const site2 = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const lockAt = site2.indexOf('function applyArrearsLock(');
    const lockSrc = lockAt === -1 ? '' : stripComments(site2.slice(lockAt, site2.indexOf('\n}', lockAt) + 2));
    check('the portal lock is decided by arrearsOutstanding, not by its own sum',
      !!lockSrc && !/changeFeeNotes/.test(lockSrc) &&
      /applyArrearsLock\(Number\(record\.arrearsOutstanding\)/.test(stripComments(site2)),
      'money-parity holds two copies of this rule together; a third in the page ' +
      'would be outside it and would be the one a customer meets');

    /* ⚠ THE TAB LIST AND THE TAB BUTTONS HAVE TO AGREE, and this is not a style
       check: 'sides' was missing from PORTAL_TAB_NAMES and the Sides tab therefore
       never opened at all — activatePortalTab hid every panel it named and never
       showed that one. Silent, customer-facing, and invisible to a source read of
       any single piece. */
    const namesLine = /var PORTAL_TAB_NAMES = \[([^\]]*)\]/.exec(site2);
    const named = namesLine ? namesLine[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean) : [];
    const onPage = Array.from(new Set(
      (site2.match(/data-tab="([a-z]+)"/g) || []).map(m => m.replace(/.*"([a-z]+)".*/, '$1'))
    ));
    const missing = onPage.filter(t => named.indexOf(t) === -1);
    check('every tab button on the page is one activatePortalTab knows about',
      named.length > 0 && missing.length === 0,
      'these tabs have a button and no entry in PORTAL_TAB_NAMES, so clicking them ' +
      'blanks the card instead of opening them: ' + missing.join(', '));
  }

  /* ---------------------------------------------------------------------
     Report
     --------------------------------------------------------------------- */
  console.log('\n=== Last season\'s unpaid bill: carried, and holding the season ===\n');
  failures.forEach(f => console.log('  FAIL  ' + f));
  if (!failures.length) console.log('  PASS  every check');
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  if (fail) {
    console.log('A customer who paid must never be held out of the season, and a customer');
    console.log('who did not pay must never be sent a crew. Fix the rule, not this file.\n');
    process.exit(1);
  }
})().catch(function (e) {
  console.error('\narrears-hold.test.js could not run:', e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
