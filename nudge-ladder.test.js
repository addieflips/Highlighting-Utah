/*
 * THE NUDGE LADDER — text, then email, then archived
 *
 * Addie, 2026-09-18: "On awaiting responses we should get a notification to nudge them
 * through text after 10 days than after 10 more days if they still haven't responded then
 * they should be sent an automatic email. After 10 more days after the email if they did
 * not respond then they should be put in archived."
 *
 * And, asked where a late reply is then found: "They should be in archived in completed."
 *
 * ⛔ RUNG ONE IS A NOTIFICATION TO US, NOT A TEXT TO THEM. Her sentence is "WE should get a
 * notification to nudge them through text" — a person sends the text. Nothing in this
 * feature sends an SMS, and that is what she asked for rather than caution on my part: an
 * automatic text costs money per message, goes to somebody who has not replied, and cannot
 * be taken back. Rung two IS automatic, because she said so in as many words.
 *
 * ⚠ EVERY CLAIM HERE IS ARITHMETIC ON DATES, so the rule is RUN rather than matched — a
 * regex cannot see which rung a stamp puts somebody on. The structural checks say so where
 * they are structural, and strip comments first: Suites 58, 274, 275 and 300 each learned
 * that a check searching source text finds its own explanation.
 *
 * Its own file, per R-018.
 *
 * Run:  node nudge-ladder.test.js      (or: npm run test:ladder)
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const fns = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* indexOf, and `async function` first — extractFn dropping the async keyword has cost this
   repo three separate runs (§5). */
function lift(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i === -1) i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find function ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}

console.log('\n=== The nudge ladder ===\n');

/* ---- 1. the rung rule, RUN ------------------------------------------------- */
/* ⚠ toMillis IS LIFTED, NEVER STUBBED. It is how every stamp becomes a number, so a stub
   would decide the very arithmetic under test. The extraction-list trap this repo records
   ten times over. */
const rung = new Function('q', 'nowMs', 'waitDays',
  'const QUOTE_NUDGE_WAIT_DAYS = 10;\n' + lift(fns, 'toMillis') + '\n' +
  lift(fns, 'quoteLadderRungDue') + '\nreturn quoteLadderRungDue(q, nowMs, waitDays);');

const NOW = Date.UTC(2026, 8, 18);
/* ⚠ THE SHAPE FIRESTORE REALLY HANDS BACK. The first draft used { toMillis() } and every
   rung check failed on correct code: toMillis() in functions/index.js reads .toDate() or
   .seconds and falls through to new Date(v), which is NaN for a bare object — so every
   fixture answered "no stamp" and the ladder looked dead. A fixture the reader cannot read
   proves nothing about the reader. */
const daysAgo = n => ({ toDate: () => new Date(NOW - n * 86400000) });
const R = (q, w) => rung(q, NOW, w || 10);

check('a quote sent 9 days ago is not due for anything',
  R({ quoteSentAt: daysAgo(9) }) === null,
  'firing early turns a ten-day ladder into whatever the run interval happens to be');
check('at 10 days we are told to text them',
  R({ quoteSentAt: daysAgo(10) }) === 'text',
  'rung one — and it is a job for a person, never an automatic SMS');
check('and still only that at 19 days, if nobody has texted',
  R({ quoteSentAt: daysAgo(19) }) === 'text',
  'the ladder must not skip a rung just because the quote is old — each one is owed in turn');

check('10 days after we were told to text, the email goes',
  R({ quoteSentAt: daysAgo(30), quoteNudgeTextAskedAt: daysAgo(10) }) === 'email',
  'rung two, the one automatic send she asked for');
check('but not 9 days after',
  R({ quoteSentAt: daysAgo(29), quoteNudgeTextAskedAt: daysAgo(9) }) === null,
  '"after 10 more days" is measured from the rung before it, not from the quote');

check('10 days after the email, the quote is archived',
  R({ quoteSentAt: daysAgo(40), quoteNudgeTextAskedAt: daysAgo(20), quoteNudgeEmailedAt: daysAgo(10) }) === 'archive',
  'rung three ends the chase');
check('but not 9 days after',
  R({ quoteSentAt: daysAgo(39), quoteNudgeTextAskedAt: daysAgo(19), quoteNudgeEmailedAt: daysAgo(9) }) === null,
  'the same gap governs every rung');

/* ⛔ THE ORDER IS THE WHOLE RULE. Read earliest-rung-first, a quote that had already been
   emailed would match the text rung again on every run — the text stamp is what gates it
   and nothing above it ever clears. This fixture is old enough to satisfy all three. */
check('a quote already emailed never drops back to the text rung',
  R({ quoteSentAt: daysAgo(90), quoteNudgeTextAskedAt: daysAgo(80), quoteNudgeEmailedAt: daysAgo(70) }) === 'archive',
  'reading up the ladder instead of down re-asks for a text every run and nobody is archived');

/* ⚠ A QUOTE THAT WAS NEVER SENT IS NOT WAITING ON A REPLY, and a missing stamp must answer
   "not due" rather than firing on the epoch — which is what a bare date comparison does. */
check('a quote that was never sent is not on the ladder at all',
  R({}) === null,
  'no stamp means no clock; the other way round archives the whole book on the first run');

/* ⚠ THE OFFICE'S OWN WAIT SETTING DRIVES EVERY RUNG, not just the first. */
check('the wait setting moves every rung together',
  R({ quoteSentAt: daysAgo(6) }, 5) === 'text' &&
  R({ quoteSentAt: daysAgo(20), quoteNudgeTextAskedAt: daysAgo(6) }, 5) === 'email',
  'a setting that moved only the first rung would space the ladder differently from what it says');

/* ---- 2. what each rung actually does --------------------------------------- */
const batch = (() => { try { return strip(lift(fns, 'runQuoteNudgeBatch')); } catch (e) { return ''; } })();
check('the batch was found', !!batch,
  'renamed? repoint this file rather than deleting it — an empty slice passes everything below');

/* ⛔ NOTHING SENDS A TEXT. This is the check that holds her ruling, and it is a refusal:
   if an SMS is ever added here it must be a deliberate change to this line, not a drift. */
check('the text rung sends nothing to the customer',
  !/twilio|sendSms|sendText|messages\.create/i.test(batch),
  'she asked to be TOLD to text them — an automatic SMS costs money per message and cannot be recalled');
check('the text rung stamps the quote and lists them for a person',
  /quoteNudgeTextAskedAt: admin\.firestore\.FieldValue\.serverTimestamp\(\)/.test(batch) &&
  /textThese\.push/.test(batch),
  'without the stamp the same quote is re-listed every run; without the list nobody is told');

check('the email rung stamps its own rung',
  /quoteNudgeEmailedAt: admin\.firestore\.FieldValue\.serverTimestamp\(\)/.test(batch),
  'the archive rung is measured from this — unstamped, nobody is ever archived');
/* ⛔ AND quoteSentAt IS NOT RESET. It used to be, so the second nudge was another ten days
   out; with a stamp per rung that reset re-opens the text rung for ever. */
check('and does not reset the clock the ladder started from',
  !/quoteSentAt: admin\.firestore\.FieldValue\.serverTimestamp\(\)/.test(batch),
  'resetting it re-opens rung one on the next run and the ladder never reaches the archive');

check('the archive rung sets the flag the Closed tab reads',
  /quoteArchived: true/.test(batch) && /quoteArchivedAt/.test(batch),
  'Addie: "They should be in archived in completed" — quoteArchived is what puts a card there');
check('and says why it was archived',
  /quoteArchivedReason/.test(batch),
  'the card renders the reason; without one an automatic archive reads as somebody closing it by hand');

/* ⚠ A QUOTE WITH NO EMAIL ADDRESS MUST NOT BE MARCHED ON TO THE ARCHIVE. The email rung
   cannot be completed for them, so stamping it would archive somebody in ten days having
   been sent nothing at all. They stay on the human list until a person acts. */
const emailRung = batch.slice(batch.indexOf("if (rung === 'archive')"));
check('somebody we cannot email is flagged for a person, not stamped',
  /prefersNotEmail\(q\.contactMethod\) \|\| !q\.email/.test(emailRung) &&
  emailRung.indexOf('humanFollowUp.push') < emailRung.indexOf('quoteNudgeEmailedAt'),
  'stamped instead, they are archived ten days later having been sent nothing at all');

/* ---- 3. the office is not shown a setting that does nothing ---------------- */
/* ⛔ The ladder sends exactly one automatic email, so "nudge at most N" has nothing left to
   cap. A box that silently does nothing is worse than no box. */
check('the max-nudges box is gone from the automation card',
  !/id="qNudgeMax"/.test(admin),
  'left in place, somebody sets it to 5, expects five emails and gets one');
check('and nothing writes maxNudges any more',
  !/maxNudges:/.test(strip(admin)),
  'a setting still being stored while nothing reads it is the quiet half of this bug');
check('the wait-days box stays, because it sets every rung',
  /id="qNudgeWaitDays"/.test(admin),
  'it is the one number in the ladder the office still decides');
check('and the card says what the ladder actually does',
  /archived/i.test(admin.slice(admin.indexOf('id="qNudgeWaitDays"'),
                               admin.indexOf('id="qNudgeWaitDays"') + 1400)),
  'three rungs over a month is not something to leave somebody to infer from one number');

/* ---- 4. the office is actually shown rung one ------------------------------ */
/* ⛔ THIS IS THE WHOLE FEATURE, AND IT IS ASSERTED SEPARATELY FROM THE MECHANISM. The stamp
   is written whether or not anybody looks, so with this block deleted the ladder marches
   somebody to the email rung ten days later having told nobody to do anything — every check
   above still green, and nothing on screen. That is the shape this repo has shipped once
   already (the recycle "bin says" box). */
const render = (() => { try { return lift(admin, 'renderQuoteNudgeStatus'); } catch (e) { return ''; } })();
check('the automation card renderer was found', !!render,
  'renamed? repoint this rather than deleting it');
check('the people to text are rendered, not just stored',
  /textNudgeList/.test(render) && /Text these/.test(render),
  'a list nothing draws is a notification nobody gets — and the stamp moves them on regardless');
check('their phone number is a link you can press',
  /href="tel:/.test(render),
  'the one action this list exists to prompt is a text; making somebody retype the number is the friction that stops it happening');
check('and somebody with no phone says so rather than showing nothing',
  /no phone on file/.test(render),
  'a blank where the number goes reads as a rendering fault, and this list is acted on at speed');
check('every rung is reported on the run line',
  /lastRunAskedToText/.test(render) && /lastRunArchived/.test(render),
  'an archive nobody is told about is a quote that vanishes off the tab overnight');

console.log('\n=======================================================');
console.log('The nudge ladder — ' + passed + ' passed, ' + failed + ' failed');
console.log('=======================================================\n');
process.exit(failed ? 1 : 0);
