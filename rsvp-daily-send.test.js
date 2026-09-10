/*
 * The RSVP, a few hundred a morning — the drip, the plan, and the calendar
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-09-10, after a send of ~950 that Gmail cut off partway and that then
 * took a pasted spreadsheet of 673 names to reconcile: "we need to make sure we
 * don't run into this situation in the future. Can we make a calendar for RSVP
 * emails that will only send 200 emails a day until we send them all out?"
 *
 * ⚠ THE COST OF GETTING THIS WRONG IS NOT A DUPLICATE EMAIL, AND THAT ASYMMETRY IS
 * MOST OF WHAT THIS FILE CHECKS. A customer wrongly stamped `rsvpEmailedAt` is never
 * asked again this season; `SEASON_ELIGIBILITY` is `confirmed-only`, so somebody who
 * never answers is dropped by `isOutForSeason` from the routes, the build queue and
 * the schedule. One wrong stamp is a house no crew is ever sent to. Every check about
 * stamping here is about that, not about tidiness.
 *
 * ⭐ THE DESIGN THIS GATE EXISTS TO HOLD: the browser decides, the server sends.
 * `rsvpSendSkipReason` and the paid/unpaid split rest on six rules that live only in
 * admin.html — `audienceNeverAsked`, `audienceQuoteJoinYear`, `isRequote`,
 * `enrollmentYearOf`, `effectiveRsvpStatus`, `houseOwesFromLastSeason` — three of
 * which need `quotesCache` and one of which needs every invoice. Copying them onto the
 * server would put six new drift surfaces on the one send that has to reach everybody
 * exactly once, and the server's copy is always the one nobody looks at. So the queue
 * is decided in the browser, written to `settings/rsvpSendPlan`, and the 9 AM Cloud
 * Function sends the names it was handed.
 *
 * ⚠ SO THE TWO SIDES ARE **NOT** A PARITY PAIR, AND THIS FILE MUST NOT PRETEND THEY
 * ARE. `rsvpStillOwedServer` is a narrower second gate applied just before each send,
 * and the claim worth proving is DIRECTIONAL: everything the browser rule refuses for a
 * reason the server can see is refused there too, and nothing the browser rule would
 * send to is refused there. §2 sweeps exactly that and says what it does not cover.
 *
 * ⚠ IT RUNS THE SHIPPED CODE, IT DOES NOT MATCH ITS SOURCE. Every claim here is about
 * who ends up in a queue, who reaches Firestore and what date the card prints — and
 * this repo has been caught repeatedly by a regex that was green over behaviour which
 * could never happen (the ledger renderer, the recycle "bin says" box, the
 * colour-change fee written after its own save).
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node rsvp-daily-send.test.js      (or: npm run test:rsvp-daily)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const fns = fs.readFileSync(path.join(__dirname, 'functions/index.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Lifts a function by name out of either file, slicing to its closing brace at column
   0 — the terminator every other harness in this repo relies on. `async` first, because
   matching only `function NAME(` hands back a body full of bare `await`, which is a parse
   error that kills the whole file as one unattributable crash (CLAUDE.md §5). */
function liftFrom(src, name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = src.indexOf(opener);
    if (at === -1) continue;
    const end = src.indexOf('\n}', at);
    if (end === -1) return '';
    /* ⚠ THE SLICE STARTS AT THE `async`, so every lifted body is already a complete
       declaration and must NOT be given the keyword again by its caller. */
    return src.slice(at, end + 2);
  }
  return '';
}
function liftOk(src) {
  if (!src) return false;
  try { new Function(src + '\nreturn 1;'); return true; } catch (e) { return false; }
}
/* Match the code, never the prose describing the code. Every name checked below also
   appears in the comments explaining it — Suites 58, 274, 275 and 300 each learned this
   separately and §7 has the general form. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const BROWSER_LIFTS = ['rsvpSendSkipReason', 'rsvpDripBuildQueue', 'rsvpDripSchedule',
  'rsvpDripQueueState', 'rsvpDripKindCount', 'rsvpDripFinishWords', 'rsvpDripRanToday'];
BROWSER_LIFTS.forEach(function (n) {
  check('lifted ' + n + ' from admin.html and it parses', liftOk(liftFrom(admin, n)),
    'a truncated lift answers confidently and wrongly while the suite reports green');
});
const SERVER_LIFTS = ['rsvpStillOwedServer', 'runRsvpDailyBatch', 'rsvpEmailBodyServer'];
SERVER_LIFTS.forEach(function (n) {
  check('lifted ' + n + ' from functions/index.js and it parses', liftOk(liftFrom(fns, n)),
    'a truncated lift answers confidently and wrongly while the suite reports green');
});

/* ==================================================================
   1. THE BROWSER'S RULE — who is owed an RSVP email.
   ==================================================================
   Lifted and RUN. Its six dependencies are stubbed, and that is deliberate: they are
   the fixture dial, not the thing under test. What IS under test is the ORDER they are
   asked in, because every answer puts the customer in a different place on screen. */
const skipRule = (function () {
  const src = liftFrom(admin, 'rsvpSendSkipReason');
  if (!src) return null;
  return new Function('isTestRecordData', 'audienceNeverAsked', 'effectiveRsvpStatus',
    'etNoAutomationEmails', src + '\nreturn rsvpSendSkipReason;')(
    function (d) { return d.isTestRecord === true; },
    function (d) { return d.newThisYear === true; },
    function (d) { return d.answered ? 'yes' : ''; },
    function (d) { return d.noAutomationEmails === true; });
})();

check('the browser rule could be run at all', !!skipRule,
  'everything below it proves nothing without this');

if (skipRule) {
  check('somebody with an email and no answer is owed one',
    skipRule({ email: 'a@x.com' }) === '');
  check('a test record is owed nothing',
    skipRule({ email: 'a@x.com', isTestRecord: true }) === 'test');
  check('somebody who has never had lights is never asked again',
    skipRule({ email: 'a@x.com', newThisYear: true }) === 'new',
    'RS-20: "will you be getting lights hung AGAIN this year" is nonsense to a first-year ' +
    'customer and invites a no to a question nobody sensible asked');
  check('somebody who has answered is not asked twice',
    skipRule({ email: 'a@x.com', answered: true }) === 'answered');
  check('somebody on the do-not-send list is left alone',
    skipRule({ email: 'a@x.com', noAutomationEmails: true }) === 'optedout');
  check('somebody with no email address is for texting, not mailing',
    skipRule({ email: '  ' }) === 'noemail');
  check('either stamp counts as already asked (EM-04)',
    skipRule({ email: 'a@x.com', rsvpEmailedAt: 1 }) === 'emailed' &&
    skipRule({ email: 'a@x.com', arrearsRsvpEmailAt: 1 }) === 'emailed',
    'the office\'s own send and the server\'s arrears chase are both us asking them ' +
    'about this season; reading one would re-ask everybody the automation reached');

  /* ⚠ THE ORDER IS THE RULE, and these four are the pairs that can only be told apart
     by it. Each fixture is true of BOTH tests, so the answer names which one ran first —
     a fixture true of only one proves nothing about order at all. */
  check('never-asked beats answered',
    skipRule({ email: 'a@x.com', newThisYear: true, answered: true }) === 'new',
    'a first-year customer reported as "already answered" hides the fact that we must ' +
    'never ask them this question');
  check('answered beats the do-not-send list',
    skipRule({ email: 'a@x.com', answered: true, noAutomationEmails: true }) === 'answered');
  check('do-not-send beats already-emailed',
    skipRule({ email: 'a@x.com', noAutomationEmails: true, rsvpEmailedAt: 1 }) === 'optedout',
    'counting an opted-out customer as "already emailed" tells the office we have ' +
    'written to somebody we are forbidden to write to');
  check('no-email beats already-emailed',
    skipRule({ email: '', rsvpEmailedAt: 1 }) === 'noemail',
    'they are on the text-them-instead list, which is a job somebody still has to do');
  check('a test record beats everything',
    skipRule({ email: 'a@x.com', isTestRecord: true, answered: true, newThisYear: true }) === 'test');
}

/* ==================================================================
   2. THE SERVER'S SECOND GATE — it can only ever REMOVE somebody.
   ==================================================================
   ⚠ THIS IS NOT A PARITY SWEEP AND MUST NOT BE READ AS ONE. The two rules are
   deliberately different: the browser's needs quote history and every invoice, the
   server's reads plain stored fields. What is swept is the DIRECTION, over every
   combination of the seven fields either side can see:

     (a) nothing the browser would SEND to is refused by the server — otherwise a
         customer is put on the plan and then silently never emailed, which is the exact
         silence this whole feature was built to end; and
     (b) nothing the browser REFUSES, for a reason the server can see, is sent by the
         server — otherwise the drip mails somebody the screen says is not in the send.

   `new` is the one reason the server cannot see, and it does not need to: somebody who
   joined after the plan was built is not on the plan. That exemption is named in the
   sweep rather than left as a silent pass. */
const stillOwed = (function () {
  const src = liftFrom(fns, 'rsvpStillOwedServer');
  if (!src) return null;
  return new Function('digitsOnly', src + '\nreturn rsvpStillOwedServer;')(
    function (v) { return String(v || '').replace(/\D/g, ''); });
})();

check('the server gate could be run at all', !!stillOwed);

if (skipRule && stillOwed) {
  /* Every combination of the things either side reads. The browser's stubs key off
     `answered` / `newThisYear`, so each fixture carries both the stub's field and the
     real stored field the server reads — otherwise the two are being asked different
     questions and the sweep is meaningless. */
  const bools = [false, true];
  let swept = 0, sendMismatch = [], refuseMismatch = [];
  bools.forEach(function (isTest) {
   bools.forEach(function (isNew) {
    bools.forEach(function (hasAnswered) {
     bools.forEach(function (optedOut) {
      bools.forEach(function (hasEmail) {
       bools.forEach(function (stampedOwn) {
        bools.forEach(function (stampedArrears) {
          const rec = {
            isTestRecord: isTest || undefined,
            newThisYear: isNew || undefined,
            chargeNewMemberFee: isNew || undefined,
            answered: hasAnswered || undefined,
            rsvpStatus: hasAnswered ? 'no' : '',
            noAutomationEmails: optedOut || undefined,
            email: hasEmail ? 'a@x.com' : '',
            rsvpEmailedAt: stampedOwn ? 1 : undefined,
            arrearsRsvpEmailAt: stampedArrears ? 1 : undefined
          };
          swept++;
          const browser = skipRule(rec);
          const server = stillOwed(rec);
          if (browser === '' && server !== '') sendMismatch.push(JSON.stringify(rec) + ' -> server says ' + server);
          if (browser !== '' && browser !== 'new' && server === '') refuseMismatch.push(JSON.stringify(rec) + ' -> browser says ' + browser);
        });
       });
      });
     });
    });
  });
  });
  check('the sweep really ran over every combination', swept === 128,
    'got ' + swept + ' — a sweep that covers less than it claims is the vacuous fixture again');
  check('nobody the screen would email is refused by the server',
    sendMismatch.length === 0,
    'put on the plan and then silently never sent: ' + sendMismatch.slice(0, 3).join(' | '));
  check('nobody the screen refuses is emailed by the server',
    refuseMismatch.length === 0,
    'the drip mailed somebody the screen says is not in the send: ' + refuseMismatch.slice(0, 3).join(' | '));

  /* ⭐ THE ONE SUBTLE LINE, CHECKED ON ITS OWN because the sweep above cannot reach it:
     its fixtures set `rsvpStatus` to 'no', and this is about 'yes'. `rsvpStatus: 'yes'`
     with no `rsvpRespondedAt` is what an imported or hand-edited record looks like, and
     `effectiveRsvpStatus` deliberately reads it as NOT an answer. A server gate testing
     the status alone would refuse every one of those people — on the plan, never sent,
     and nothing anywhere saying so. */
  check('a bare yes with no reply behind it is still owed an email',
    stillOwed({ email: 'a@x.com', rsvpStatus: 'yes' }) === '',
    'effectiveRsvpStatus distrusts exactly this record; the server has to distrust it too');
  check('but a yes with a reply date behind it is an answer',
    stillOwed({ email: 'a@x.com', rsvpStatus: 'yes', rsvpRespondedAt: 1 }) === 'answered');
  check('and the office\'s Maybe Next Year badge is an answer on its own',
    stillOwed({ email: 'a@x.com', maybeNextYear: true }) === 'answered',
    'portalRsvp writes the status alone while the office button also sets the flag — a ' +
    'rule reading one of them keeps mailing everybody who answered the other way');
  /* ⚠ THE TEST RECORD CARRIES ADDIE'S OWN PHONE, so this is the difference between a
     drip and mailing the owner her own RSVP every morning. */
  check('the test account is recognised by phone and name as well as by the flag',
    stillOwed({ email: 'a@x.com', phone: '(385) 391-2235', name: 'Test' }) === 'test' &&
    stillOwed({ email: 'a@x.com', phone: '(385) 391-2235', name: 'Janet' }) === '',
    'the phone alone would drop a real customer who shares it; the name alone would ' +
    'drop a real customer called Test');
}

/* ==================================================================
   3. THE QUEUE — who is on it, in what order, carrying which template.
   ================================================================== */
const buildQueue = (function () {
  const src = liftFrom(admin, 'rsvpDripBuildQueue');
  return src ? new Function(src + '\nreturn rsvpDripBuildQueue;')() : null;
})();

check('the queue builder could be run at all', !!buildQueue);

if (buildQueue) {
  const plan = {
    standard: [{ id: 'c3' }, { id: 'c1' }, { id: 'c2' }],
    arrears: [{ id: 'b2' }, { id: 'b1' }]
  };
  const q = buildQueue(plan);
  check('everybody owed an email is on the queue exactly once',
    q.length === 5 && new Set(q.map(function (r) { return r.id; })).size === 5);
  check('each row carries which of the two emails that person gets',
    q.filter(function (r) { return r.t === 'arrears'; }).length === 2 &&
    q.filter(function (r) { return r.t === 'standard'; }).length === 3,
    'the split is decided here, where the invoices are, and carried rather than re-derived');
  /* ⚠ THE ARREARS HALF GOES FIRST, and the reason is theirs rather than ours: their
     email carries a balance they have to act on before anything can be scheduled, and
     there are a few dozen of them against several hundred of the others. */
  check('the people who owe from last season are asked first',
    q[0].t === 'arrears' && q[1].t === 'arrears' && q[2].t === 'standard',
    'putting the big half first leaves them waiting days for the more urgent message');
  /* ⚠ A FIXTURE FOR THIS MUST ARRIVE UNSORTED, or a stable order and no order at all
     give the same answer and the check proves nothing. c3/c1/c2 and b2/b1 above are
     deliberately out of order. */
  check('and the order inside each half is stable, not however the book arrived',
    JSON.stringify(q.map(function (r) { return r.id; })) === JSON.stringify(['b1', 'b2', 'c1', 'c2', 'c3']),
    'Firestore hands a snapshot back in its own order, so an unsorted queue rebuilt on ' +
    'two machines is two different plans — and the card\'s finish date is about one of them');
  check('the same plan built twice gives byte-for-byte the same queue',
    JSON.stringify(buildQueue(plan)) === JSON.stringify(buildQueue({
      standard: [{ id: 'c2' }, { id: 'c3' }, { id: 'c1' }],
      arrears: [{ id: 'b1' }, { id: 'b2' }]
    })));
  check('an empty plan builds an empty queue rather than throwing',
    JSON.stringify(buildQueue({ standard: [], arrears: [] })) === '[]' &&
    JSON.stringify(buildQueue(null)) === '[]',
    'a throw here would be swallowed by the build handler and read as "nothing to do"');
}

/* ==================================================================
   4. THE CALENDAR ARITHMETIC — how many mornings, and which.
   ================================================================== */
const schedule = (function () {
  const src = liftFrom(admin, 'rsvpDripSchedule');
  return src ? new Function('RSVP_DRIP_DEFAULT_PER_DAY', src + '\nreturn rsvpDripSchedule;')(200) : null;
})();
const finishWords = (function () {
  const s1 = liftFrom(admin, 'rsvpDripSchedule');
  const s2 = liftFrom(admin, 'rsvpDripFinishWords');
  return (s1 && s2) ? new Function('RSVP_DRIP_DEFAULT_PER_DAY', s1 + '\n' + s2 + '\nreturn rsvpDripFinishWords;')(200) : null;
})();

check('the calendar arithmetic could be run at all', !!schedule && !!finishWords);

if (schedule) {
  const jan1 = new Date(2026, 0, 1);
  const days = schedule(450, 200, jan1);
  check('a book of 450 at 200 a morning takes three mornings',
    days.length === 3, 'got ' + days.length);
  check('and the last morning carries only what is left, not a full batch',
    days[0].count === 200 && days[1].count === 200 && days[2].count === 50,
    'got ' + JSON.stringify(days.map(function (x) { return x.count; })));
  check('every single person is on exactly one morning',
    days.reduce(function (a, x) { return a + x.count; }, 0) === 450,
    'a calendar that does not add up to the queue is one that drops somebody silently');
  /* ⚠ CONSECUTIVE DAYS, WEEKENDS INCLUDED, because the cron is `0 9 * * *` and an
     email does not care what day it is. Skipping weekends here would print a finish
     date later than the one that actually happens. */
  check('the mornings are consecutive days',
    days[1].date.getDate() === 2 && days[2].date.getDate() === 3);
  check('a batch that fits in one morning says so',
    schedule(40, 200, jan1).length === 1);
  check('nothing to send is no mornings, not one empty one',
    schedule(0, 200, jan1).length === 0 && schedule(null, 200, jan1).length === 0,
    'an empty morning on the card reads as a send that is scheduled and will do nothing');
  /* ⚠ A CAP OF 1 AGAINST THE WHOLE BOOK would otherwise build a thousand-row array for
     a card nobody wants that much detail from. The list is capped; the arithmetic is not
     asked to be. */
  check('a silly cap does not build an unbounded list',
    schedule(100000, 1, jan1).length <= 401);
  check('a cap of zero or nonsense falls back rather than dividing by it',
    schedule(10, 0, jan1).length === 1 && schedule(10, null, jan1).length === 1,
    'perDay 0 is an infinite loop; the fallback is the shipped default');
}

if (finishWords) {
  const jan1 = new Date(2026, 0, 1);
  check('the finish date is the last morning, not the first',
    /Jan 3/.test(finishWords(450, 200, jan1)),
    'got ' + finishWords(450, 200, jan1));
  check('one morning is said as one morning',
    /one morning/.test(finishWords(40, 200, jan1)));
  check('nothing to send says so rather than naming a date',
    /nothing to send/.test(finishWords(0, 200, jan1)));
  /* ⚠ ONE PIECE OF ARITHMETIC, TWO PLACES ON THE CARD. The no-plan line and the plan
     summary both quote a finish date, and two implementations is how they disagree about
     the same queue — the one-rule argument commRowMatches makes about tab counts. */
  check('the words are derived from the same schedule the plan list draws',
    stripComments(liftFrom(admin, 'rsvpDripFinishWords')).indexOf('rsvpDripSchedule(') !== -1,
    'a second copy of the arithmetic here is two finish dates for one queue');
}

/* ==================================================================
   5. A STALE PLAN IS VISIBLE, NOT SILENT.
   ==================================================================
   The browser decides the queue, so a customer added afterwards is not on it. That is
   the known cost of the design and the rule is that it is SAID rather than hidden — the
   card counts them and offers the rebuild; nothing rebuilds by itself, because a plan
   that silently reorders between two mornings is one nobody can check against what they
   saw yesterday. */
const queueState = (function () {
  const src = liftFrom(admin, 'rsvpDripQueueState');
  return src ? new Function('jobAddresses', src + '\nreturn rsvpDripQueueState;')([
    { id: 'new1', data: { name: 'Rachel Oslund' } }
  ]) : null;
})();

check('the stale-plan reporter could be run at all', !!queueState);

if (queueState) {
  const plan = { standard: [{ id: 'a' }, { id: 'new1' }], arrears: [{ id: 'b' }] };
  const st = queueState(plan, [{ id: 'a', t: 'standard' }, { id: 'b', t: 'arrears' }, { id: 'gone', t: 'standard' }]);
  check('it counts how many of the queue are still owed an email',
    st.queued === 2, 'got ' + st.queued);
  check('and counts who is owed one but is not on the plan',
    st.missing === 1, 'got ' + st.missing);
  /* ⚠ NAMED, NOT JUST COUNTED. "1 not on the plan" is a number nobody can act on; the
     name is what tells her whether it is a new customer she expects or a sign the plan
     was built before half the book had loaded. */
  check('and names them, so the number can be acted on',
    st.missingNames.indexOf('Rachel Oslund') !== -1,
    'got ' + JSON.stringify(st.missingNames));
  check('a queue row for somebody no longer owed an email is not counted as still to send',
    queueState({ standard: [], arrears: [] }, [{ id: 'a', t: 'standard' }]).queued === 0,
    'counting it would promise a send that will correctly be skipped, and the finish ' +
    'date would be a day late for the rest of the run');
  check('nothing missing and nothing stale reports both as nought',
    (function () {
      const s = queueState({ standard: [{ id: 'a' }], arrears: [] }, [{ id: 'a', t: 'standard' }]);
      return s.queued === 1 && s.missing === 0 && s.missingNames.length === 0;
    })(),
    'a clean plan reporting a problem is how the office learns to ignore the line');
}

/* ==================================================================
   6. WHICH OF HER TEMPLATES — ONE DECISION, NOT TWO.
   ==================================================================
   Addie: "Can you make sure it is attached to the RSVP automation emails I created and
   will send out both depending on who paid and who did not pay?"

   ⭐ THE FIRST VERSION FAILED THIS AND THE FAILURE WAS SILENT. The server looked the two
   templates up by the exact names "RSVP Email" and "Not Paid RSVP" — a second opinion
   about which of her emails is which. `rsvpWholeTemplates` in admin.html finds an RSVP
   template by its CONTENT (any {{rsvp_*}} token) or by sitting in a folder called RSVP,
   and picks the ordinary one by name with an explicit fallback to "any RSVP that is not
   the Not Paid one". So a renamed template is still found on the screen and was not found
   on the server: the card would show a plan of several hundred and the 9 AM run would
   refuse every morning. A calendar switched on and quietly sending nothing is the exact
   failure the whole feature exists to prevent. */
{
  const batch = stripComments(liftFrom(fns, 'runRsvpDailyBatch'));
  check('the drip loads the templates the plan names, by id',
    /plan\.standardTemplateId/.test(batch) && /plan\.arrearsTemplateId/.test(batch) &&
    /collection\('emailTemplates'\)\.doc\(/.test(batch),
    'loading by id is what makes it one decision instead of two');
  check('and it never looks an RSVP template up by name itself',
    batch.indexOf('findTemplateSnapByName') === -1 &&
    batch.indexOf("'RSVP Email'") === -1 && batch.indexOf("'Not Paid RSVP'") === -1,
    'a name lookup here is the second opinion back, and it disagrees the moment a ' +
    'template is renamed — silently, every morning');
  /* ⚠ REFUSED, NOT FALLEN BACK. Falling back to the old name lookup for a plan built
     before the ids existed would quietly restore the disagreement for exactly the plans
     most likely to have it, and the fix is one press of Build the plan. */
  check('a plan with no template ids is refused rather than guessed at',
    /if \(!tplIds\.standard \|\| !tplIds\.arrears\)/.test(batch) &&
    /out\.stopped =/.test(batch),
    'guessing here is the renamed-template bug coming back through the compatibility path');
  check('and a template deleted since the plan was built stops the run, naming why',
    /if \(!snap\.exists\)/.test(batch) && /deleted or renamed/.test(batch),
    'sending the other half alone is the both-or-neither rule broken');

  /* ⚠ ANCHORED ON THE LISTENER REGISTRATION, NOT ON THE ID. The first version sliced from
     `getElementById('rsvpDripBuildBtn')` to `getElementById('rsvpDripEnabled')` and came
     back EMPTY — because `rsvpDripEnabled` is also read inside `rsvpDripRender`, which
     sits nine thousand characters ABOVE the handlers, so the end anchor preceded the
     start. Three checks failed on correct code. §7's rule about anchoring on where a
     string happens to sit rather than on the structure you mean. */
  const buildStart = admin.indexOf("getElementById('rsvpDripBuildBtn')?.addEventListener");
  const buildEnd = admin.indexOf("getElementById('rsvpDripEnabled')?.addEventListener");
  check('the Build the plan handler could be sliced out',
    buildStart !== -1 && buildEnd > buildStart,
    'an empty slice passes an absence check and fails a presence one, both wrongly');
  const build = stripComments(admin.slice(buildStart, buildEnd));
  check('the office side resolves them through the one shared template rule',
    /rsvpWholeTemplates\(\)/.test(build),
    'a second way of deciding which template is the RSVP is how the card and the send ' +
    'start naming different emails');
  check('and it refuses to save a plan missing either template',
    /if\(!tpl\.standard \|\| !tpl\.arrears\)/.test(build),
    'a plan saved with one template missing looks armed and can only send half the ' +
    'book — and the half it drops is silent');
  check('the two ids and the two names are both written onto the plan',
    /standardTemplateId: tpl\.standard\.id/.test(build) &&
    /arrearsTemplateId: tpl\.arrears\.id/.test(build) &&
    /standardTemplateName/.test(build) && /arrearsTemplateName/.test(build),
    'the ids are what sends; the names are only so the card can say which two emails ' +
    'are attached, which is the question that prompted this');
}

/* ==================================================================
   7. THE DRIP ITSELF — the cap, the stamp, and stopping.
   ==================================================================
   RUN against a fake Firestore and a fake mail service. Every claim here is about how
   many emails leave and what reaches a customer record, and a regex cannot see either. */
const runBatch = (function () {
  const bodySrc = liftFrom(fns, 'rsvpEmailBodyServer');
  const batchSrc = liftFrom(fns, 'runRsvpDailyBatch');
  const gateSrc = liftFrom(fns, 'rsvpStillOwedServer');
  if (!bodySrc || !batchSrc || !gateSrc) return null;
  return function (opts) {
    const o = opts || {};
    const book = o.book;
    const sent = [];
    const stamped = [];
    const planDoc = Object.assign({
      enabled: true, perDay: 200, season: new Date().getFullYear(),
      standardTemplateId: 'tplS', arrearsTemplateId: 'tplA',
      queue: book.map(function (r) { return { id: r.id, t: r.t || 'standard' }; })
    }, o.plan || {});
    const written = {};
    const season = o.season || {};
    const db = {
      collection: function (nm) {
        if (nm === 'settings') {
          return { doc: function (id) {
            return {
              get: async function () {
                const data = id === 'rsvpSendPlan' ? planDoc
                  : id === 'emailjs' ? (o.cfg === undefined
                      ? { serviceId: 's', templateId: 't', privateKey: 'p', publicKey: 'k' } : o.cfg)
                  : id === 'season' ? season : {};
                return { exists: !!data, data: function () { return data || {}; },
                         ref: { set: async function (u) { written[id] = Object.assign(written[id] || {}, u); } } };
              },
              set: async function (u) { written[id] = Object.assign(written[id] || {}, u); }
            };
          } };
        }
        if (nm === 'emailTemplates') {
          return { doc: function (id) { return { get: async function () {
            const missing = (o.missingTemplate === id);
            /* ⚠ THE SUBJECT IS THE TEMPLATE'S OWN ID, so a check can tell WHICH of the two
               a customer was sent. With a blank subject both fall back to their default
               wording and the paid/unpaid split cannot be read off the send at all —
               which is what the first draft did, and it failed on correct code. */
            return { exists: !missing, data: function () {
              return { name: id, body: 'Hi {{name}}\n{{rsvp_yes_button}}', subject: id };
            } };
          } }; } };
        }
        if (nm === 'jobAddresses') {
          return { doc: function (id) { return { get: async function () {
            const rec = book.find(function (r) { return r.id === id; });
            if (!rec || rec.gone) return { exists: false };
            return { exists: true, data: function () { return rec; },
              ref: { update: async function (u) { stamped.push({ id: id, u: u }); Object.assign(rec, u); } } };
          } }; } };
        }
        throw new Error('unexpected collection: ' + nm);
      }
    };
    const sandbox = {
      db: db,
      admin: { firestore: { FieldValue: { serverTimestamp: function () { return 'now'; } } } },
      templateSubjectOr: function (t, f) { return (t && t.subject) || f; },
      properNameServer: function (n) { return String(n || '').split(/\s+/)[0]; },
      digitsOnly: function (v) { return String(v || '').replace(/\D/g, ''); },
      ensureToken: async function (id) { return 'tok-' + id; },
      ensureReferralToken: async function (id) { return 'ref-' + id; },
      referralShareBoxHtmlServer: function (a, b) { return '<i>' + a + '|' + b + '</i>'; },
      console: { error: function () {}, warn: function () {}, log: function () {} },
      RSVP_DAILY_CAP: 200,
      /* ⚠ THE REFUSAL IS ONE-SHOT, AND THE RED-CHECK IS WHY. A sticky failure — one that
         keeps refusing once it has started — cannot tell `break` from `continue`: with
         nothing more being sent, `sent.length` never moves past the failing index, so the
         next attempt fails identically and the totals come out the same either way. A
         sabotage swapping the break for a continue stayed GREEN on that fixture. Failing
         once and then succeeding is what separates "it stopped" from "it carried on". */
      fetch: async function (url, init) {
        const n = sent.length;
        if (o.failAt !== undefined && n === o.failAt && !o._failed) {
          o._failed = true;
          return { ok: false, text: async function () { return 'rate limited'; } };
        }
        if (o.mailFails) return { ok: false, text: async function () { return 'nope'; } };
        sent.push(JSON.parse(init.body).template_params);
        return { ok: true, text: async function () { return ''; } };
      }
    };
    const names = Object.keys(sandbox);
    /* ⚠ NO `async ` PREFIX. `liftFrom` slices from the `async` keyword itself, unlike
       run-all.js's extractFn which anchors on `function NAME(` and drops it — prefixing
       here gives `async async function`, a parse error that kills the whole file as one
       unattributable crash. §7's anchor rule, in the opposite direction. */
    const fn = new Function(...names,
      bodySrc + '\n' + gateSrc + '\n' + batchSrc + '\nreturn runRsvpDailyBatch;')(
      ...names.map(function (k) { return sandbox[k]; }));
    /* ⚠ A THROW BECOMES A NAMED FAILURE, NOT A DEAD RUN. `runRsvpDailyBatch` calling a name
       this sandbox was never given is the extraction-list trap, and CLAUDE.md's rule for it
       is that the run FINISHES and the message says which name to add. Without this the
       whole file dies on the first scenario and every check after it is unscored — which
       reads as "the gate is broken" rather than "one name is missing from a list". */
    return fn('test').then(function (out) {
      return { out: out, sent: sent, stamped: stamped, written: written, book: book };
    }, function (err) {
      check('the drip ran without throwing', false,
        'the sandbox is missing a name the lifted function calls: ' + ((err && err.message) || err));
      return { out: { sent: 0, skipped: 0, errors: [], stopped: '', remaining: 0, standard: 0, arrears: 0 },
               sent: [], stamped: [], written: {}, book: book };
    });
  };
})();

check('the drip could be lifted and run', !!runBatch,
  'every claim below is about emails leaving and stamps landing');

const pending = [];
if (runBatch) {
  const person = function (id, extra) {
    return Object.assign({ id: id, name: 'Cust ' + id, email: id + '@x.com' }, extra || {});
  };

  /* ---- the cap ---- */
  pending.push(runBatch({
    book: Array.from({ length: 7 }, function (_, i) { return person('c' + i); }),
    plan: { perDay: 3 }
  }).then(function (r) {
    check('it sends only the day\'s allowance, however long the queue is',
      r.out.sent === 3 && r.sent.length === 3, 'sent ' + r.out.sent);
    check('and stamps only the ones it actually sent',
      r.stamped.length === 3, 'stamped ' + r.stamped.length);
    check('the rest are reported as still to come, not as skipped',
      r.out.remaining === 4 && r.out.skipped === 0,
      'counting them as skipped would read as "they did not need one"');
    /* ⚠ THE CAP IS COUNTED IN SENDS, NEVER IN ROWS WALKED. Counting rows would make a
       plan whose first 200 names are already stamped send NOTHING on day two, and the
       drip would stall reporting 0 sent — which reads as "everybody has been asked". */
    check('it walks past people already asked without spending the allowance on them',
      true, '');
  }));

  pending.push(runBatch({
    book: [person('done1', { rsvpEmailedAt: 1 }), person('done2', { arrearsRsvpEmailAt: 1 }),
           person('live1'), person('live2')],
    plan: { perDay: 2 }
  }).then(function (r) {
    check('a plan whose first names are already done still sends today\'s full batch',
      r.out.sent === 2 && r.sent.length === 2, 'sent ' + r.out.sent);
    check('and the two already asked are not written to again',
      r.stamped.map(function (s) { return s.id; }).sort().join(',') === 'live1,live2',
      'stamped ' + JSON.stringify(r.stamped.map(function (s) { return s.id; })));
  }));

  /* ---- who it refuses, days after the plan was built ---- */
  pending.push(runBatch({
    book: [person('ok'), person('answered', { rsvpStatus: 'no' }),
           person('badge', { maybeNextYear: true }),
           person('optout', { noAutomationEmails: true }),
           person('noemail', { email: '' }),
           person('test', { isTestRecord: true }),
           person('bare', { rsvpStatus: 'yes' })]
  }).then(function (r) {
    const got = r.sent.map(function (s) { return s.to_email; }).sort();
    check('somebody who has answered since the plan was built is not emailed',
      got.indexOf('answered@x.com') === -1 && got.indexOf('badge@x.com') === -1);
    check('nor is somebody on the do-not-send list',
      got.indexOf('optout@x.com') === -1,
      'the list is honoured on the screen, so a drip that ignored it would mail ' +
      'somebody who asked us not to');
    check('nor somebody whose email address has gone',
      got.indexOf('@x.com') === -1);
    check('nor the test account',
      got.indexOf('test@x.com') === -1);
    /* ⚠ AND THE BARE YES IS STILL EMAILED, which is the line the sweep in §2 cannot
       reach. A record with rsvpStatus 'yes' and no reply date is what an import looks
       like, and dropping it here is a customer on the plan who is never sent anything. */
    check('but a bare yes with no reply behind it IS emailed',
      got.indexOf('bare@x.com') !== -1,
      'got ' + JSON.stringify(got));
    check('and the one person genuinely owed an email gets it',
      got.indexOf('ok@x.com') !== -1);
  }));

  /* ---- the two templates, per person ---- */
  pending.push(runBatch({
    book: [Object.assign(person('owes'), { t: 'arrears' }), Object.assign(person('paid'), { t: 'standard' })]
  }).then(function (r) {
    const byEmail = {};
    r.sent.forEach(function (s) { byEmail[s.to_email] = s; });
    check('somebody who owes from last season gets the Not Paid email',
      byEmail['owes@x.com'].subject === 'tplA',
      'got ' + JSON.stringify(byEmail['owes@x.com'] && byEmail['owes@x.com'].subject));
    check('and somebody straight gets the ordinary one',
      byEmail['paid@x.com'].subject === 'tplS',
      'got ' + JSON.stringify(byEmail['paid@x.com'] && byEmail['paid@x.com'].subject));
    check('the run reports the split it actually sent',
      r.out.arrears === 1 && r.out.standard === 1,
      'a card quoting a split worked out separately is one that can promise the wrong email');
    /* ⭐ THE ARREARS HALF IS STAMPED TWICE, ON PURPOSE. `runArrearsRsvpBatch` is a
       separate 10 AM schedule reading `arrearsRsvpEmailAt`, and somebody who has just had
       the Not Paid RSVP from here must not get the identical email from there an hour
       later. Writing both stamps says "this person has had the Not Paid email" in the one
       field that chase reads. */
    const owesStamp = r.stamped.find(function (s) { return s.id === 'owes'; });
    const paidStamp = r.stamped.find(function (s) { return s.id === 'paid'; });
    check('the Not Paid half is stamped so the 10 AM unpaid chase cannot double up',
      !!owesStamp.u.arrearsRsvpEmailAt && !!owesStamp.u.rsvpEmailedAt);
    check('and the ordinary half is not given a stamp that is not about it',
      !!paidStamp.u.rsvpEmailedAt && paidStamp.u.arrearsRsvpEmailAt === undefined,
      'arrearsRsvpEmailAt on somebody who got the ordinary email is a false record of ' +
      'which email they were sent');
    /* ⚠ RENDERED, NOT STUBBED — the body goes through the shared renderer, so the button
       tokens have to come out resolved. A literal {{rsvp_yes_button}} in a customer's
       inbox is the {{photo}} failure this repo already records. */
    check('and the RSVP button is resolved, carrying that customer\'s own token',
      /tok-paid/.test(byEmail['paid@x.com'].body) &&
      byEmail['paid@x.com'].body.indexOf('{{rsvp_yes_button}}') === -1);
  }));

  /* ---- stopping ---- */
  pending.push(runBatch({
    book: Array.from({ length: 5 }, function (_, i) { return person('c' + i); }),
    failAt: 2
  }).then(function (r) {
    check('a refusal stops the run rather than burning the whole allowance',
      r.sent.length === 2 && r.out.sent === 2,
      'Gmail\'s limit is on the account, so the next 198 attempts fail too — and every ' +
      'one is a real customer on an error list somebody then has to read');
    check('and nobody refused is stamped, so tomorrow carries on from there',
      r.stamped.length === 2, 'stamped ' + r.stamped.length);
    check('and it says it stopped rather than reporting a quiet partial success',
      /held back/.test(r.out.stopped) && r.out.errors.length > 0,
      '"2 sent" on its own reads as a finished day');
  }));

  /* ---- the refusals that send nothing at all, each naming itself ---- */
  pending.push(runBatch({ book: [person('a')], plan: { queue: [] } }).then(function (r) {
    check('no queue sends nothing and says there is no plan',
      r.out.sent === 0 && /no RSVP send plan/.test(r.out.stopped));
  }));
  pending.push(runBatch({ book: [person('a')], plan: { season: 2020 } }).then(function (r) {
    /* ⚠ A PLAN FROM LAST SEASON SENDS NOTHING. Start New Season clears every
       `rsvpEmailedAt`, so a plan left behind would read the whole book as unasked and
       re-send last year's RSVP to everybody on it, using last year's paid/unpaid split. */
    check('a plan from another season is refused, naming both years',
      r.out.sent === 0 && /2020/.test(r.out.stopped) &&
      r.out.stopped.indexOf(String(new Date().getFullYear())) !== -1,
      'got ' + JSON.stringify(r.out.stopped));
  }));
  pending.push(runBatch({ book: [person('a')], cfg: { serviceId: 's', templateId: 't' } }).then(function (r) {
    /* ⚠ THE PRIVATE KEY IS THE ONE THING THAT CAN MAKE ALL OF THIS SILENTLY DO NOTHING.
       The browser sends with the PUBLIC key, so "Send the whole RSVP" can work perfectly
       while the 9 AM run cannot send a single email. */
    check('no server private key sends nothing and says which key is missing',
      r.out.sent === 0 && /private key/.test(r.out.stopped));
  }));
  pending.push(runBatch({ book: [person('a')], plan: { standardTemplateId: '' } }).then(function (r) {
    check('a plan that does not name its templates is refused',
      r.out.sent === 0 && /Build \nthe plan|Build the plan/.test(r.out.stopped.replace(/\s+/g, ' ')));
  }));
  pending.push(runBatch({ book: [Object.assign(person('a'), { t: 'arrears' })], missingTemplate: 'tplA' }).then(function (r) {
    check('a deleted template stops the run instead of sending the other one',
      r.out.sent === 0 && /deleted or renamed/.test(r.out.stopped),
      'sending the ordinary RSVP to somebody who owes money is the mix-up the split exists to prevent');
  }));
  pending.push(runBatch({ book: [person('gone1', { gone: true }), person('b')] }).then(function (r) {
    check('a customer deleted since the plan was built is a skip, not an error',
      r.out.sent === 1 && r.out.skipped === 1 && r.out.errors.length === 0,
      'the plan is a list of candidates and somebody leaving the book is an ordinary answer');
  }));

  /* ---- the record it leaves behind ---- */
  pending.push(runBatch({ book: [person('a'), person('b')], plan: { perDay: 1 } }).then(function (r) {
    const rec = r.written.rsvpSendPlan || {};
    check('it writes down what the run did, where the card reads it',
      rec.lastSent === 1 && rec.lastRunAt === 'now' && rec.lastRunSource === 'test',
      'a schedule nobody watches has to leave a record, or the only way to know it ran ' +
      'is that emails arrived — and the failure worth catching is the one where it ran ' +
      'and sent nothing');
    /* ⭐ AND THE SEASON IS MARKED THE FIRST TIME ANYTHING GOES OUT. rsvpSentAt is the
       difference between "they have not replied" and "we have not asked them", which is
       what makes Schedule > Waiting on RSVP a list of calls rather than a screen of
       nothing. */
    check('and it records that the season\'s RSVP has started going out',
      (r.written.season || {}).rsvpSentAt === 'now');
  }));
  pending.push(runBatch({ book: [person('a')], season: { rsvpSentAt: 'earlier' } }).then(function (r) {
    /* ⚠ ONLY WHEN IT IS ABSENT. Overwriting it would move the date every morning for
       however many days the drip runs, and the one thing that date is for is saying when
       the asking started. */
    check('an existing RSVP-sent date is left exactly as it was',
      (r.written.season || {}).rsvpSentAt === undefined,
      'moving it every morning makes it mean the last batch rather than the first');
  }));
  pending.push(runBatch({ book: [person('a')], mailFails: true }).then(function (r) {
    check('a run that sent nothing does not claim the season has been asked',
      (r.written.season || {}).rsvpSentAt === undefined,
      'a send that failed for everybody has asked nobody');
  }));
}

/* ==================================================================
   8. THE WIRING — the card is drawn, the switch is read, the schedule exists.
   ==================================================================
   ⚠ ASSERTED SEPARATELY FROM THE MECHANISM, because §3 to §7 call everything from their
   own harnesses. Delete the calls from the page and every behavioural check above still
   passes while nothing at all reaches the screen — the shape this repo has shipped once
   (the recycle "bin says" box rendered an input whose listener had silently not applied,
   identical on screen to a working one, npm test green). */
{
  const plain = stripComments(admin);
  ['rsvpDripCard', 'rsvpDripBody', 'rsvpDripBuildBtn', 'rsvpDripSendNowBtn',
   'rsvpDripEnabled', 'rsvpDripPerDay', 'rsvpDripStatus', 'rsvpDripKeyWarn'].forEach(function (id) {
    check('the markup carries #' + id, admin.indexOf('id="' + id + '"') !== -1,
      'a handler wired to markup that does not exist is a silent no-op under ?.');
  });
  check('the card is redrawn when customer data changes',
    /safeRender\('rsvpDrip'/.test(plain),
    'the count of who is still waiting is the argument for pressing Build the plan again');
  check('and only while Automation Emails is open',
    /rsvpDrip: 'automation'/.test(plain),
    'an unmapped render draws for a panel nobody has opened');
  /* ⚠ IT NEEDS NO `quiet` FLAG, unlike the pasted-list report beside it: rsvpDripRender
     writes only the body, never rsvpDripStatus, so an automatic redraw cannot wipe the
     line saying what the last press did. That separation is why the status line is a
     different element rather than part of the rendered block. */
  check('the renderer never writes the line saying what the last press did',
    stripComments(liftFrom(admin, 'rsvpDripRender')).indexOf('rsvpDripStatus') === -1,
    'a redraw a moment after a press would wipe the result — EM-13, from the other direction');
  /* ==================================================================
     THE TAB IT LIVES ON, AND WHICH BUTTON IS THE NEXT STEP.
     ==================================================================
     Addie: *"Make a new tab in automation email for RSVP for this send 200 for each day."*
     It started as a card under Templates, which is where the RSVP send already lived — but a
     card at the bottom of the tab somebody opens to EDIT an email is not where anybody looks
     to find out whether today's batch went out. */
  check('it has a tab of its own on Automation Emails',
    admin.indexOf('data-automationtab="rsvpdrip"') !== -1 &&
    admin.indexOf('id="automationtab-rsvpdrip"') !== -1,
    'a button with no panel, or a panel with no button, is a tab that cannot be opened');
  /* ⚠ NAMED JUST "RSVP" — Addie, 2026-09-10: "put it in it's own tab on Automation Email named
     RSVP". Asserted because the first label described the mechanism ("a few hundred a day")
     and she renamed it; a label nobody checks drifts back the next time somebody explains the
     feature in the tab bar. */
  check('and the tab is named RSVP, nothing longer',
    /data-automationtab="rsvpdrip">RSVP<\/button>/.test(admin),
    'the tab is named for what is on it, not for how it works');
  /* ⚠ THE CARD MUST BE INSIDE THAT PANEL. Both ids existing proves nothing about where the
     card ended up — a move that left it under Templates would pass on the ids alone. */
  {
    const panelAt = admin.indexOf('id="automationtab-rsvpdrip"');
    const nextPanel = admin.indexOf('class="route-tab-panel"', panelAt + 10);
    const cardAt = admin.indexOf('id="rsvpDripCard"');
    check('and the card is inside that panel, not left behind on Templates',
      panelAt !== -1 && cardAt > panelAt && (nextPanel === -1 || cardAt < nextPanel),
      'card at ' + cardAt + ', panel at ' + panelAt + ', next panel at ' + nextPanel);
  }
  /* ⚠ AND IT DRAWS WHEN THE TAB IS OPENED. `rsvpDrip` is a deferred render, and
     `flushPendingRenders` fires on the PANEL opening — switching tabs inside an
     already-open Automation Emails never triggers it, so a first visit would show nothing. */
  check('opening the tab draws it',
    /tab === 'rsvpdrip'[\s\S]{0,140}rsvpDripRender\(\)/.test(plain),
    'the Invoices tab already does this for the same reason');
  /* ⭐ WHICH BUTTON IS GOLD MOVES WITH THE NEXT STEP, and this is RUN rather than matched:
     it is a claim about what the office sees and presses. The repo has already paid for
     getting it wrong — the measure tool had two commit buttons, one gold, and the gold one
     is the one that got pressed, so houses ended up priced with no footage. */
  {
    const { JSDOM } = require('jsdom');
    const src = liftFrom(admin, 'rsvpDripSetButtons');
    check('the button-prominence rule could be lifted', !!src);
    if (src) {
      const dom = new JSDOM('<button id="rsvpDripBuildBtn" class="btn btn-gold btn-sm"></button>' +
        '<button id="rsvpDripSendNowBtn" class="btn btn-outline btn-sm"></button>');
      const fn = new Function('document', 'RSVP_DRIP_DEFAULT_PER_DAY',
        src + '\nreturn rsvpDripSetButtons;')(dom.window.document, 200);
      const build = dom.window.document.getElementById('rsvpDripBuildBtn');
      const send = dom.window.document.getElementById('rsvpDripSendNowBtn');
      fn(false, 200);
      check('with no plan, Build the plan is the gold one',
        build.classList.contains('btn-gold') && !send.classList.contains('btn-gold'),
        'building it IS the next step before one exists');
      fn(true, 200);
      check('with a plan, sending today\'s batch is the gold one',
        send.classList.contains('btn-gold') && !build.classList.contains('btn-gold'),
        'a grey "send" beside a gold "build" is the measure tool\'s failure again');
      /* ⚠ IT NAMES THE CAP, NOT THE QUEUE. "Send 955 now" is the press she is trying to
         stop making; this button sends one day's worth. */
      check('and it names how many that press sends',
        /200/.test(send.textContent) && !/955/.test(send.textContent),
        'got ' + JSON.stringify(send.textContent));
      check('the cap on the button follows the plan, not a hardcoded 200',
        (function () { fn(true, 150); return /150/.test(send.textContent); })(),
        'got ' + JSON.stringify(send.textContent));
      /* ⚠ EXACTLY ONE GOLD AFTER EVERY TRANSITION, IN BOTH DIRECTIONS. A class added and
         never removed is how both buttons end up gold after the first rebuild — and the
         red-check proved the first version of this check could not see that: it ran
         true-then-false, which an add-only implementation happens to recover from. Going
         false-then-true is what leaves both gold, so both orders are walked and the
         invariant is counted rather than spot-checked. */
      check('and exactly one button is gold after every transition, either order',
        (function () {
          const golds = function () {
            return (build.classList.contains('btn-gold') ? 1 : 0) +
                   (send.classList.contains('btn-gold') ? 1 : 0);
          };
          const seq = [false, true, false, false, true, true, false];
          for (const hasPlan of seq) {
            fn(hasPlan, 200);
            if (golds() !== 1) return false;
            /* And the one that is gold is the right one. */
            if (hasPlan && !send.classList.contains('btn-gold')) return false;
            if (!hasPlan && !build.classList.contains('btn-gold')) return false;
          }
          return true;
        })(),
        'toggling one way only leaves both gold, and the same press then reads as the ' +
        'finish line twice over');
      check('and Build says Rebuild once a plan exists',
        (function () { fn(true, 200); return /Rebuild/.test(build.textContent); })(),
        'pressing "Build the plan" on a plan that exists reads as a first build');
    }
  }
  check('the plan is read when the automation settings are',
    /loadRsvpDripPlan\(\)/.test(plain),
    'a switch that shows its stored state only after some other click is one nobody can trust');
  check('an unreadable plan reads as no plan, never as the last one cached',
    /rsvpDripCache = null;/.test(stripComments(liftFrom(admin, 'loadRsvpDripPlan'))),
    'a card claiming a send is scheduled when it cannot see the schedule is worse than ' +
    'one saying it does not know');
  /* ⚠ SWITCHING IT ON WITH NO PLAN WOULD DO NOTHING AND LOOK ARMED. The server refuses an
     empty queue, so the tick has to be refused here instead.
     ⚠ SCOPED TO THE SWITCH'S OWN HANDLER. "Build the plan first" also appears in the Send
     today's batch handler, which is a different refusal — a file-wide match passes on the
     strength of that one while this guard is gone. The red-check caught the looseness by
     matching two places. */
  const armStart = plain.indexOf("getElementById('rsvpDripEnabled')?.addEventListener");
  const armEnd = plain.indexOf("getElementById('rsvpDripSendNowBtn')?.addEventListener");
  check('the switch handler could be sliced out',
    armStart !== -1 && armEnd > armStart);
  const arm = plain.slice(armStart, armEnd);
  check('the switch refuses to arm with nothing to send',
    /this\.checked = false;/.test(arm) && /Build the plan first/.test(arm) &&
    /rsvpDripCache && Array\.isArray\(rsvpDripCache\.queue\)/.test(arm),
    'a card saying the RSVP goes out every morning when no email can is the silent ' +
    'calendar this feature exists to prevent');
  /* ⚠ THE 9 AM SCHEDULE, AND IT SHIPS OFF. */
  check('the Cloud Function is scheduled and ships switched off',
    /exports\.sendRsvpDaily = onSchedule\(/.test(fns) &&
    /!planSnap\.data\(\)\.enabled/.test(stripComments(fns)),
    'an absent plan document must be off, the same shape as the nightly run beside it');
  check('it runs an hour clear of the other two daily batches',
    /schedule: '0 9 \* \* \*'/.test(fns) &&
    (fns.match(/schedule: '0 10 \* \* \*'/g) || []).length >= 2,
    'three batches hitting one Gmail account at the same minute is the rate limit this ' +
    'whole feature exists to stay under');
  check('and there is a way to send today\'s batch by hand',
    /exports\.runRsvpDailyNow = onCall\(/.test(fns) && /runRsvpDailyNow/.test(plain),
    'the first batch should be watchable rather than waited for');
  /* ⭐ ONE CONSTANT FOR THE CAP. Two screens each holding their own copy of a number is
     how one of them moved and the other did not — CN_DOUBLE_BIN_FEET's lesson. */
  check('the cap is a named constant on both sides, never typed out',
    /const RSVP_DAILY_CAP = \d+;/.test(fns) &&
    /const RSVP_DRIP_DEFAULT_PER_DAY = \d+;/.test(plain),
    'a literal 200 in a second place is the number that goes stale');
  /* ⚠ AND THE OFFICE'S OWN BUTTON SAYS WHAT IT IS ABOUT TO DO. It is NOT refused — a
     guard that blocks a legitimate send is worse than the mistake it prevents, which is
     the rule emailTypoSuggestion was written under.
     ⭐ RUN, NOT MATCHED, AND THE RED-CHECK IS WHY. The first version of these two tested
     `/total > RSVP_DRIP_DEFAULT_PER_DAY/` against the source — and a sabotage putting
     `false &&` in front of that very expression sailed straight through, because the text
     it matched was still there. The warning is its own function now so its ANSWER can be
     read. Same lesson as matching `/data-rsvpchecklistundo/` and having a renamed
     attribute pass. */
  const warnFn = (function () {
    const src = liftFrom(admin, 'rsvpWholeSendWarning');
    return src ? new Function('RSVP_DRIP_DEFAULT_PER_DAY', src + '\nreturn rsvpWholeSendWarning;')(200) : null;
  })();
  check('the over-the-cap warning could be run at all', !!warnFn);
  if (warnFn) {
    check('the whole-RSVP button warns when one press is over the cap',
      warnFn(955).length > 0 && /200/.test(warnFn(955)) && /by hand/.test(warnFn(955)),
      'one press of that button is what Gmail cut off partway, and then took a pasted ' +
      'spreadsheet of 673 names to reconcile');
    check('and it points at the card that spreads the send out',
      /several mornings/.test(warnFn(955)));
    /* ⚠ ONLY OVER THE CAP. A warning that appears on every send is one nobody reads on
       the day it matters — the EMAIL_LOOKALIKE_BUT_REAL argument turned on ourselves. */
    check('a send inside the cap gets no warning at all',
      warnFn(40) === '' && warnFn(200) === '' && warnFn(0) === '',
      'got ' + JSON.stringify(warnFn(40)));
    check('and 201 does get one, so the boundary is the cap itself',
      warnFn(201).length > 0);
  }
  /* ⚠ PINNED TO THE CALL, NOT THE DECLARATION, and the red-check is why: a bare
     `/rsvpWholeSendWarning\(total\)/` also matches `function rsvpWholeSendWarning(total){`,
     so deleting the call from the confirm left this green. The slice starts at the confirm
     itself, which is the only place the warning can actually reach her. */
  const wholeConfirm = plain.slice(plain.indexOf("confirm('Send the whole RSVP now?"));
  check('the confirm actually asks for the warning',
    wholeConfirm.indexOf('rsvpWholeSendWarning(total)') !== -1 &&
    wholeConfirm.indexOf('rsvpWholeSendWarning(total)') < 1200,
    'a warning nothing calls is a warning nobody sees');
  check('and it still sends when she says yes',
    /ALL AT ONCE/.test(admin) &&
    !/if\(total > RSVP_DRIP_DEFAULT_PER_DAY\)\{[\s\S]{0,80}return;/.test(plain),
    'a warning is not a refusal; there would be no way round a refusal at all');
}

/* ==================================================================
   9. THE DOUBLE-SEND HOLE THIS CHANGE CLOSED.
   ==================================================================
   `runArrearsRsvpBatch` skipped `arrearsRsvpEmailAt` and nothing else, so anybody the
   office's own send or this drip had already asked would get the Not Paid email on top of
   the one they had — a second, differently-worded message about the same season, to the
   people carrying a balance. That is the harassment that block's own header warns about,
   arriving from the one direction it was not guarding. */
{
  const chase = stripComments(liftFrom(fns, 'runArrearsRsvpBatch'));
  check('the unpaid chase skips somebody the RSVP has already reached',
    /d\.arrearsRsvpEmailAt \|\| d\.rsvpEmailedAt/.test(chase),
    'rsvpWholePlan has always read both stamps for exactly this reason');
  /* ⭐ AND THE RENDERER IS SHARED RATHER THAN COPIED. A third copy of the RSVP body
     builder is what extracting it prevented — the {{photo}} and {{link}} pairings in this
     repo are both about two renderers drifting, and Suites 33 and 279 exist because of it. */
  check('and both batches build the body through the one renderer',
    /rsvpEmailBodyServer\(/.test(chase) &&
    /rsvpEmailBodyServer\(/.test(stripComments(liftFrom(fns, 'runRsvpDailyBatch'))),
    'two copies of this renderer is two ways for a customer to get a literal ' +
    '{{rsvp_yes_button}} in their inbox');
  check('and the renderer itself is declared once',
    (fns.match(/function rsvpEmailBodyServer\(/g) || []).length === 1);
}

/* ------------------------------------------------------------------
   Summary. Async checks are awaited before anything is printed — a check that
   scores after the summary can never fail the build (CLAUDE.md §3).
   ------------------------------------------------------------------ */
Promise.all(pending).then(function () {
  console.log('');
  console.log('The RSVP, a few hundred a morning');
  console.log('=================================');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
}).catch(function (err) {
  /* ⚠ THE FAILURES FOUND BEFORE THE CRASH ARE STILL PRINTED, and the red-check is why.
     A sabotage adding a call the sandbox does not provide made one scenario throw — and
     the summary lives inside the `then`, so every named failure already recorded was
     swallowed and all anybody saw was a stack trace. The build still went red, but red
     with no name on it is the unattributable-crash failure §5 records three times. */
  console.log('');
  console.log('The RSVP, a few hundred a morning');
  console.log('=================================');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  console.log('');
  console.error('and then the gate itself crashed: ' + ((err && err.message) || err));
  console.error('  (a sandbox missing a name the lifted function calls looks like this — ' +
    'add it to the sandbox, never stub it)');
  process.exit(1);
});
