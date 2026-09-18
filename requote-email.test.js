/*
 * WHY RE-QUOTE EMAILS WERE NOT GOING OUT
 *
 * Addie, 2026-09-17: "Can you also check why requote emails aren't getting sent out".
 *
 * ⛔ NOTHING WAS BROKEN ABOUT THE EMAIL. The template is looked up by EXACT name —
 * getEmailTemplateByName is `t.data.name === name` — against quoteTemplateNames.requote,
 * which ships as the string "ReQuotes". A template named anything else is not found, and
 * a re-quote raised off an EXISTING CUSTOMER then refused to send outright, while a first
 * quote fell back to a built-in body and kept going out. That asymmetry is the bug: the
 * one kind of send that had a dead end was the one she was trying to make.
 *
 * ⚠ AND THE RIGHT WORDS WERE ALREADY IN THE FILE. DEFAULT_REQUOTE_BODY existed and was
 * read only by the button that SEEDS the templates; buildQuoteEmailHtml fell back to
 * DEFAULT_QUOTE_TEMPLATE_BODY for everything, so a re-quote that did get through was sent
 * the first-quote wording — "here's your quote" to somebody who already has one.
 *
 * ⚠ IT RUNS THE RULE rather than matching its source wherever it can, because every claim
 * here is about WHICH WORDS REACH A CUSTOMER. The four structural checks say so in as
 * many words, and strip comments first — Suites 58, 274, 275 and 300 each learned that a
 * check searching source text finds its own explanation.
 *
 * Its own file, per R-018.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}

/* indexOf, and `async function` first — extractFn dropping the async keyword has cost
   this repo three separate runs (§5). */
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
/* ⚠ THE BODIES ARE MULTI-LINE STRING CONCATENATIONS, so the declaration cannot be cut at
   the first semicolon — one inside the wording would truncate it. Quote state is tracked
   and the cut is made at the first `;` OUTSIDE a string. */
function liftConst(src, name) {
  const i = src.indexOf('const ' + name + ' =');
  if (i === -1) throw new Error('cannot find const ' + name);
  let q = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (q) {
      if (ch === '\\') { j++; continue; }
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'" || ch === '`') q = ch;
    else if (ch === ';') return src.slice(i, j + 1);
  }
  throw new Error('unterminated const ' + name);
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

console.log('\n=== Re-quote emails: the send no longer dies on a template name ===\n');

/* ---------------------------------------------------------------------------
 * 1. WHICH WORDING A QUOTE FALLS BACK TO.
 * ⚠ isRequote is LIFTED, never stubbed (§3). A stub would decide the very thing
 *   under test — whether this email is a re-quote — and the checks would prove
 *   nothing about the rule that ships.
 * ------------------------------------------------------------------------- */
const S = new Function(
  liftConst(admin, 'DEFAULT_QUOTE_TEMPLATE_BODY') + '\n' +
  liftConst(admin, 'DEFAULT_REQUOTE_BODY') + '\n' +
  liftConst(admin, 'DEFAULT_QUOTE_NUDGE_BODY') + '\n' +
  lift(admin, 'isRequote') + '\n' +
  lift(admin, 'quoteDefaultBodyFor') + '\n' +
  'return {quoteDefaultBodyFor: quoteDefaultBodyFor, isRequote: isRequote,' +
  ' NEW: DEFAULT_QUOTE_TEMPLATE_BODY, RQ: DEFAULT_REQUOTE_BODY, NUDGE: DEFAULT_QUOTE_NUDGE_BODY};'
)();

/* ⚠ THE THREE BODIES MUST DIFFER, or every check below passes whatever the rule does.
   This is the vacuous-fixture trap this repo keeps re-learning. */
check('the three built-in bodies are actually different from each other',
  S.NEW !== S.RQ && S.RQ !== S.NUDGE && S.NEW !== S.NUDGE,
  'with two of them equal the rule cannot be tested at all');
check('and the re-quote wording says it has been re-measured',
  /re-measured|updated your/i.test(S.RQ),
  'the words are the point: got "' + String(S.RQ).slice(0, 60) + '"');

/* The two ways a quote is a re-quote, straight out of isRequote: raised off an existing
   customer, or the office pressed Re-quote on one that had already gone out. */
const firstQuote = { name: 'Priya Nandi', quotedPrice: 400 };
const requoteByCustomer = { name: 'Ashley Wray', quotedPrice: 500, existingCustomerId: 'h-wray' };
const requoteByButton = { name: 'Rachel Oslund', quotedPrice: 500, requoteCount: 1 };

check('a first quote falls back to the first-quote wording',
  S.quoteDefaultBodyFor(firstQuote, 'quote') === S.NEW);
check('a re-quote off an existing customer falls back to the RE-QUOTE wording',
  S.quoteDefaultBodyFor(requoteByCustomer, 'quote') === S.RQ,
  'this is the send that used to refuse outright');
check('and so does one raised by the Re-quote button',
  S.quoteDefaultBodyFor(requoteByButton, 'quote') === S.RQ,
  'this one DID send, and sent the first-quote wording to somebody who already had a quote');
check('a nudge keeps its own wording whatever kind of quote it is about',
  S.quoteDefaultBodyFor(requoteByCustomer, 'nudge') === S.NUDGE &&
  S.quoteDefaultBodyFor(firstQuote, 'nudge') === S.NUDGE,
  'the nudge body is rendered again on the server and Suite 33 fails if the two disagree');

/* ---------------------------------------------------------------------------
 * 2. THE WIRING. Asserted separately from the rule, because a correct rule
 *    nothing calls changes nothing on screen — this repo has shipped that
 *    exact shape before (the recycle "bin says" box).
 * ------------------------------------------------------------------------- */
const bare = strip(admin);
const builder = strip(lift(admin, 'buildQuoteEmailHtml'));

check('the one renderer the preview and the send share asks the rule',
  /const body = template \? template\.data\.body : quoteDefaultBodyFor\(d, kind\)/.test(builder),
  'preview and send both go through here, so a second answer here splits what she sees from what is sent');
check('and it no longer names a default body for itself',
  builder.indexOf('DEFAULT_QUOTE_TEMPLATE_BODY') === -1,
  'a second opinion about the fallback is how a re-quote gets sent the first-quote wording again');

/* ⚠ SCOPED TO THE SEND HANDLER'S OWN BODY. "Can't find a template called" is spelled in
   three places in this file — the email send, the email preview and the TEXT send — so a
   file-wide search would be answered by one of the others and prove nothing about this. */
const sendStart = bare.indexOf("const tmplName = quoteTemplateFor(d, 'quote');");
check('the send handler is still found where the check expects it', sendStart !== -1);
const sendBlock = bare.slice(sendStart, bare.indexOf('const cfg = await getEmailjsConfig();', sendStart));
check('a missing re-quote template no longer stops the send',
  sendBlock.indexOf('return;') === -1,
  'this refusal is what Addie was hitting; got:\n' + sendBlock.slice(0, 300));
check('and the send records that it fell back, so it can say so',
  /const quoteUsedBuiltInBody = !template;/.test(sendBlock),
  '"nothing should fail quietly" pointing the other way — she still has to be told to pick a template');
/* ⚠ SCOPED TO THE SENDING FUNCTION'S OWN BODY, and that is the point rather than
   tidiness: a note written outside sendQuoteEmailNow would be a ReferenceError at the
   one moment it matters — thrown INSIDE the try that has already sent the email, so the
   customer gets it and the office is told the send failed. Every source check in this
   file would still be green. The declaration must also come first: `const` is hoisted
   into the temporal dead zone, so reading it above its declaration throws too. */
const sendFn = (function(){
  const at = bare.indexOf('async function sendQuoteEmailNow(');
  if (at === -1) return '';
  let depth = 0, started = false;
  for (let j = bare.indexOf('{', at); j < bare.length; j++) {
    if (bare[j] === '{') { depth++; started = true; }
    else if (bare[j] === '}') { depth--; if (started && depth === 0) return bare.slice(at, j + 1); }
  }
  return '';
})();
check('the sending function is still found where the check expects it', sendFn.length > 0);
check('the success line names the wording that actually went out',
  /quoteUsedBuiltInBody \? ' Used the built-in '/.test(sendFn) &&
  /Quote email settings to use your own/.test(sendFn),
  'a send that silently used different words is how she finds out from a customer');
check('and the flag it reads is declared in that same function, before it is read',
  sendFn.indexOf('const quoteUsedBuiltInBody') !== -1 &&
  sendFn.indexOf('const quoteUsedBuiltInBody') < sendFn.indexOf('quoteUsedBuiltInBody ?') &&
  sendFn.indexOf('const tmplName') !== -1,
  'out of scope this throws inside the try that has already sent the email');

/* ⚠ THE PREVIEW HAS TO AGREE WITH THE SEND. A preview that refuses where the send
   proceeds is worse than no preview — it says the email cannot go when it can. */
const prevStart = bare.indexOf('let tmplName = quoteTemplateFor(d, kind);');
check('the preview is still found where the check expects it', prevStart !== -1);
/* ⚠ THE END ANCHOR IS THE CALL, NOT ITS ARGUMENTS (repointed 2026-09-17). It was
   written out in full as `buildQuoteEmailHtml(d, kind, template);` and the builder
   then gained a fourth argument — so indexOf answered -1, `slice` ran to the end of
   the FILE, and every check below read code it was never meant to see. It failed on
   correct code and the message pointed at the preview, which was fine.

   ⚠ AND A MISSING ANCHOR IS NOW A NAMED FAILURE RATHER THAN A SILENT WIDENING.
   That is the half that cost the time: -1 is a legal second argument to slice, so
   the slice does not throw, it just quietly becomes the wrong thing — a check that
   cannot find its target must say so, which this repo has already had to learn about
   suites that skip. */
const prevEnd = bare.indexOf('const built = await buildQuoteEmailHtml(', prevStart);
check('the preview block has both of its anchors',
  prevStart !== -1 && prevEnd !== -1,
  'without the end anchor the slice runs to the end of the file and every check ' +
  'below this reads unrelated code — repoint it rather than widening what it accepts');
const prevBlock = (prevStart === -1 || prevEnd === -1) ? '' : bare.slice(prevStart, prevEnd);
check("the preview's refusal is scoped to the nudge",
  /if\(!template && kind !== 'quote'\)\{/.test(prevBlock),
  'got:\n' + prevBlock.slice(0, 300));
/* ⚠ THE ONE SURVIVING existingCustomerId CLAUSE IS A BORROW, NOT A REFUSAL, AND IT IS
   DELIBERATELY KEPT. A re-quote raised by the BUTTON, on a book with no ReQuotes
   template but a Quote Email one, goes on using HER OWN wording exactly as it did
   before; only the dead end was removed. The first draft of this check demanded the
   clause be gone entirely — which forbids correct code, and would have silently
   changed the words on a send that was already working. */
check('the surviving existingCustomerId clause is the template borrow, not a refusal',
  /if\(!template && kind === 'quote' && !d\.existingCustomerId && getEmailTemplateByName/.test(prevBlock) &&
  prevBlock.split('existingCustomerId').length - 1 === 1,
  'got:\n' + prevBlock.slice(0, 400));
/* ⚠ SCOPED TO THE BORROW'S OWN BRACES. The first version sliced from the borrow to the
   END of the block and found the NUDGE refusal's return a few lines below it — failing
   on correct code, and reporting the one refusal that is meant to be there. */
const borrowAt = prevBlock.indexOf("if(!template && kind === 'quote'");
const borrowBlock = prevBlock.slice(borrowAt, prevBlock.indexOf("if(!template && kind !== 'quote')", borrowAt));
check('and that borrow does not refuse anything — it swaps the template and carries on',
  borrowAt !== -1 && /template = getEmailTemplateByName\(tmplName\)/.test(borrowBlock) &&
  borrowBlock.indexOf('return;') === -1,
  'a borrow that returns is the dead end wearing a different clause; got:\n' + borrowBlock.slice(0, 300));

/* ⚠ THE PROVENANCE LINE IS A CLAIM ABOUT WHERE THE WORDS CAME FROM. Left
   unconditional it would point her at a template that does not exist. */
check('the preview only claims a template when there is one',
  /\(template\s*\r?\n?\s*\? 'Pulled live from/.test(bare),
  'the one screen meant to explain the send must not send her to edit nothing');
check('and says which built-in wording it is showing instead',
  /Using the <strong>built-in '\+\(isRequote\(d\) \? 're-quote' : 'quote'\)\+' wording<\/strong>/.test(bare));

console.log('\n=======================================================');
console.log('Re-quote emails — ' + passed + ' passed, ' + failed + ' failed');
console.log('=======================================================\n');
process.exit(failed ? 1 : 0);
