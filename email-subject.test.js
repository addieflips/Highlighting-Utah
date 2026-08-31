/*
 * EVERY EMAIL SAYS WHAT IT IS, IN THE INBOX
 *
 * Addie, 2026-08-31: "how do we add subject to the RSVP emails. I need a
 * subject on all them... we just need them to know it a christmas light RSVP."
 *
 * ⚠ SIXTEEN OF TWENTY emailjs.send calls in admin.html passed no subject at
 * all. Twelve of those are dead UI (KNOWN_MISSING_IDS); the four live ones plus
 * the two server sends are what this gate holds.
 *
 * ⚠ IT RUNS THE SUBJECT BUILDERS rather than matching their source, because
 * every claim here is about a STRING THAT ENDS UP IN AN INBOX — and a check
 * that greps for the word "subject" passes on a send that never reaches one.
 *
 * Its own file, per R-018.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const fns = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}

/* Lifts a function out of a source file by name, to the matching closing brace.
   indexOf rather than a regex, and it tries `async function` first — extractFn
   dropping the async keyword has cost this repo three separate runs (§5). */
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

console.log('\n=== Email subject lines: does every send carry one? ===\n');

// ---------------------------------------------------------------- browser ---
/* etTemplateIsRsvp is LIFTED, never stubbed (§3). A stub here would decide the
   RSVP answer itself and the check would prove nothing about the real rule. */
const browserSandbox = new Function(
  lift(admin, 'etTemplateIsRsvp') + '\n' +
  lift(admin, 'defaultEmailSubject') + '\n' +
  'return { defaultEmailSubject: defaultEmailSubject, etTemplateIsRsvp: etTemplateIsRsvp };'
)();
const subjectFor = browserSandbox.defaultEmailSubject;

const rsvpTemplate  = { data: { name: 'RSVP 2026', body: 'Hi {{name}} {{rsvp_yes_button}} {{rsvp_no_button}}' } };
const rsvpByFolder  = { data: { name: 'Season check-in', body: 'Hi there', folderName: 'RSVP' } };
const invoiceTpl    = { data: { name: 'Nightly Auto-Invoice — Unpaid', body: 'Hi' } };
const receiptTpl    = { data: { name: 'Payment Received — Balance Remaining', body: 'Hi' } };
const quoteTpl      = { data: { name: 'New Quote', body: 'Hi' } };
const randomTpl     = { data: { name: 'Thank you note', body: 'Hi' } };

/* ⭐ THE ONE SHE ASKED FOR. A customer glancing at their phone has to be able
   to tell this is about Christmas lights without opening it. */
const rsvpSubject = subjectFor(rsvpTemplate);
check('an RSVP template says it is about Christmas lights',
  /christmas light/i.test(rsvpSubject),
  'got: "' + rsvpSubject + '" — the whole point is that the customer knows what it is from the inbox');
check('an RSVP subject reads as a question, not a statement',
  /yes or no|\?/i.test(rsvpSubject),
  'got: "' + rsvpSubject + '" — it is an RSVP, so it should look like one');
check('an RSVP folder alone is enough to get the RSVP subject',
  /christmas light/i.test(subjectFor(rsvpByFolder)),
  'etTemplateIsRsvp accepts either the buttons or the folder; the subject must follow both');

/* Fallbacks by kind. A receipt titled "Your Christmas lights this year - a
   quick yes or no" would be worse than no subject at all. */
check('a billing template does not get the RSVP subject',
  !/christmas light/i.test(subjectFor(invoiceTpl)) && /invoice/i.test(subjectFor(invoiceTpl)),
  'got: "' + subjectFor(invoiceTpl) + '"');
check('a receipt template reads as billing',
  /invoice/i.test(subjectFor(receiptTpl)), 'got: "' + subjectFor(receiptTpl) + '"');
check('a quote template reads as a quote',
  /quote/i.test(subjectFor(quoteTpl)), 'got: "' + subjectFor(quoteTpl) + '"');

/* ⚠ NO SUBJECT IS NEVER THE ANSWER. Every branch has to return something —
   an empty subject line is the state this whole change exists to end. */
[rsvpTemplate, invoiceTpl, quoteTpl, randomTpl, {data:{}}, {}, null, undefined].forEach((t, i) => {
  const out = subjectFor(t);
  check('subject #' + i + ' is never blank',
    typeof out === 'string' && out.trim().length > 3,
    'got: ' + JSON.stringify(out) + ' — a send with no subject is what this gate exists to stop');
  check('subject #' + i + ' names the business or the season',
    /highlighting utah|christmas/i.test(out),
    'got: "' + out + '" — a bare subject with no sender cue reads as spam');
});

/* ⭐ THE TEMPLATE'S OWN SUBJECT WINS. This is what makes the box in the editor
   mean anything, and a red-check that ignores it would leave the office typing
   into a field nothing reads. */
const src = lift(admin, 'emailSubjectFor');
check('emailSubjectFor prefers the template subject over the default',
  /template\.data\.subject/.test(src) && src.indexOf('template.data.subject') < src.indexOf('defaultEmailSubject'),
  'the saved subject has to be read first, or the editor box does nothing');
check('a blank template subject falls back rather than sending nothing',
  /\|\|\s*defaultEmailSubject/.test(src.replace(/\s+/g, ' ')),
  'every template saved before today has no subject field, so the fallback is what makes this work at all');
check('emailSubjectFor strips HTML the token resolver may add',
  /replace\(\/<\[\^>\]\*>\/g/.test(src),
  'resolveLinkTokens turns some tokens into <a> tags; a subject line must be plain text');

/* ---- every LIVE sender actually passes it -------------------------------- */
/* ⚠ The dead senders are deliberately NOT required to. quickEmail*, bulkAuto*,
   rsvpInclude* and pib* have no markup — every id is in KNOWN_MISSING_IDS — so
   those functions return on their first line and requiring a subject there
   would be a check nobody can act on. */
const LIVE_SENDERS = [
  ['Preview & Send bulk (the RSVP path)', "to_email: member.data.email"],
  ['Preview & Send test',                 "to_email: testEmail"],
  ['Automation Emails modal bulk',        "customer_name: name,"],
  ['payment receipt',                     "await emailjs.send(serviceId, templateId, { to_email: email, to_name: d.name"],
  ['test invoice',                        "to_email: sendTo"]
];
LIVE_SENDERS.forEach(([label, anchor]) => {
  /* ⚠ AN AMBIGUOUS ANCHOR IS A FAILURE, NOT A DETAIL, and this one earned its
     place immediately: the payment-receipt anchor was first written as
     "to_email: email, to_name: d.name || ''", which appears TWICE — the second
     time inside one of the DEAD quickEmail senders, earlier in the file. So
     indexOf found the dead one and reported the live sender as bare when it was
     not. A check pinned to the wrong copy is worse than no check, because it
     reads as evidence. */
  const occurrences = admin.split(anchor).length - 1;
  check(label + ' is identified unambiguously', occurrences === 1,
    'the anchor matches ' + occurrences + ' places, so this check may be reading the wrong sender');
  if (occurrences !== 1) return;
  /* Scoped to the send call itself, not the file — a file-wide search for
     "subject" finds the four quote senders and passes while this one is bare. */
  const i = admin.indexOf(anchor);
  const window_ = admin.slice(Math.max(0, i - 400), i + 400);
  check(label + ' passes a subject',
    /subject:/.test(window_),
    'this send reaches a real customer with an empty subject line');
});

// ----------------------------------------------------------------- server ---
const serverSandbox = new Function(
  lift(fns, 'templateSubjectOr') + '\nreturn templateSubjectOr;')();

check('server: a template subject wins',
  serverSandbox({ subject: 'Custom one' }, 'fallback') === 'Custom one');
check('server: a blank subject falls back',
  serverSandbox({ subject: '   ' }, 'fallback') === 'fallback',
  'whitespace is not a subject line');
check('server: a missing template falls back',
  serverSandbox(null, 'fallback') === 'fallback');

['receiptSubject', 'invoiceSubject'].forEach(v => {
  check('server: ' + v + ' is defined before it is sent',
    fns.indexOf('const ' + v + ' =') !== -1 &&
    fns.indexOf('const ' + v + ' =') < fns.indexOf('subject: ' + v),
    'declared after use is a ReferenceError inside the nightly run, where nobody is watching');
});
check('server: the nightly invoice send carries a subject',
  /template_params: \{[^}]*subject: invoiceSubject/.test(fns),
  'this is the one email every customer gets');
check('server: the payment receipt carries a subject',
  /template_params: \{[^}]*subject: receiptSubject/.test(fns));

/* ⚠ NOT PARITY, AND SAYING SO. The two copies do NOT have to agree: the server
   only ever sends billing, so it deliberately has no RSVP or quote branch. What
   they must share is the rule that a saved subject wins over a default. */
check('both copies let the saved subject win',
  /template\.data\.subject/.test(lift(admin, 'emailSubjectFor')) &&
  /tplData && tplData\.subject/.test(lift(fns, 'templateSubjectOr')),
  'if these diverge, the office sets a subject and only half the emails obey it');

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) {
  console.log('An email would go out with the wrong subject line, or none at all.\n');
  process.exit(1);
}
