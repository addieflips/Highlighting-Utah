/*
 * The member-portal auto-reply — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-09-16: "can we get an automation email set up for someone who makes a change
 * in the member portal. Like saying something like we'll make sure to make this change on
 * your house."
 *
 * This is the first email in the app that goes TO a member BECAUSE OF something the member
 * did, and every way it can go wrong is silent:
 *
 *   - Send when nothing changed. The preferences form posts all six of its fields on every
 *     save whether they were touched or not, so `updates` is NOT a list of changes. Read as
 *     one it emails the whole book "you changed your wire colour" every time somebody fixes
 *     a note. Worse, an unticked box arrives as '' while the record stores `false` — the
 *     same answer spelt two ways — so the naive comparison reports the tick boxes changing
 *     on EVERY save of EVERY customer. That trap is already written down above
 *     portalChangeValueText; this gate is what stops the auto-reply walking into it.
 *   - Send the wrong thing. 'info' is phone, email and gate code, and 'cancel' is somebody
 *     leaving — "we'll make sure to make this change on your house" is wrong for both, and
 *     [[MSG-18]] already settled that an ordinary My Info save is deliberately quiet.
 *   - Send nothing, for ever, and look fine doing it. Switched off, no template picked, or
 *     a template she has since renamed away: all three are a card that reads as set up and
 *     a member who hears nothing.
 *   - Promise a price we have not quoted. Changing which sides are lit raises a re-quote.
 *
 * ⚠ AND THE DETECTION IS SHARED, NOT COPIED. `portalChangedFieldNames` answers "did this
 * field change" for BOTH the office activity log and this email. Two copies is how the
 * history records a change the confirmation never mentions. The checks below RUN both
 * renderings over one input rather than matching their source, because every claim here is
 * about what a member READS.
 *
 * R-018 says not to add checks to run-all.js, so this is one file, one job, wired into
 * `npm test`.
 *
 * Run:  node portal-change-email.test.js      (or: npm run test:pce)
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');

const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const funcs = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const pendingChecks = [];
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}
function eq(label, got, want) {
  check(label, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}

/* ⚠ COMMENTS ARE STRIPPED BEFORE ANY SOURCE CHECK. Suites 58, 274, 275 and 300 each learned
   this separately: the paragraphs above these functions NAME the tokens and the sections
   they handle, so a plain search finds the explanation and calls it the code. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const fnsBare = stripComments(funcs);
/* ⚠ admin.html IS STRIPPED OF ITS **HTML** COMMENTS, NOT ITS JS ONES, and the difference
   is not a nicety: running the JS block-comment strip over a 1.5MB HTML file pairs a
   comment opener in one CSS rule with a closer thousands of lines later and silently
   swallows whole panels
   — measured here, it ate this card and reported five controls missing on markup that is
   demonstrably present. The risk this strip exists to cover is the prose introducing the
   card naming its own controls, and that prose is an HTML comment. */
const adminBare = admin.replace(/<!--[\s\S]*?-->/g, ' ');

/* Walks to the matching brace rather than taking a fixed window — CLAUDE.md §7 bans a
   magic length by name, and run-all.js's own structure check enforces it. */
function liftServer(name, kind) {
  const open = kind === 'obj' ? '{' : (kind === 'arr' ? '[' : '{');
  const close = kind === 'obj' ? '}' : (kind === 'arr' ? ']' : '}');
  /* ⚠ `async function NAME(` IS TRIED FIRST, and that is not a nicety. A lift anchored on
     `function NAME(` starts its cut AFTER the `async`, so sendPortalChangeEmail arrives as a
     plain function full of bare `await` — a parse error that kills the whole file as one
     unattributable crash hundreds of lines from the cause. CLAUDE.md §5 records this
     costing Suite 269 a run, and it cost this file one too. */
  let start = -1;
  if (kind === 'fn') {
    start = funcs.indexOf('async function ' + name + '(');
    if (start < 0) start = funcs.indexOf('function ' + name + '(');
  } else {
    start = funcs.indexOf('const ' + name + ' =');
  }
  if (start < 0) return '';
  let k = funcs.indexOf(open, start), d = 0;
  if (k < 0) return '';
  for (; k < funcs.length; k++) {
    if (funcs[k] === open) d++;
    else if (funcs[k] === close) { d--; if (!d) break; }
  }
  return funcs.slice(start, k + 1) + (kind === 'fn' ? '' : ';');
}

/* ============================================================================
   1. WHAT THE MEMBER IS TOLD — run, never matched
   ========================================================================= */
console.log('\n=== The auto-reply names what actually changed ===');

const parts = [
  liftServer('PORTAL_CHANGE_LABELS', 'obj'),
  liftServer('PORTAL_CHANGE_EMPTY_TEXTS', 'arr'),
  liftServer('portalChangeValueText', 'fn'),
  liftServer('portalChangedFieldNames', 'fn'),
  liftServer('describePortalChanges', 'fn'),
  liftServer('portalChangeLabels', 'fn')
];
const NEEDED = ['PORTAL_CHANGE_LABELS', 'PORTAL_CHANGE_EMPTY_TEXTS', 'portalChangeValueText',
                'portalChangedFieldNames', 'describePortalChanges', 'portalChangeLabels'];
check('every piece of the auto-reply was found in functions/index.js',
  parts.every(Boolean),
  'a gate that cannot find its target must never report green. Missing: ' +
  NEEDED.filter((n, i) => !parts[i]).join(', '));

let labelsOf = null, describeOf = null, fieldsOf = null;
if (parts.every(Boolean)) {
  const r = new Function(parts.join('\n') +
    '\nreturn {labels: portalChangeLabels, describe: describePortalChanges,' +
    ' fields: portalChangedFieldNames};')();
  labelsOf = r.labels; describeOf = r.describe; fieldsOf = r.fields;
}

if (labelsOf) {
  /* ⛔ THE ONE THAT WOULD HAVE EMAILED THE WHOLE BOOK. Every field here is at the value the
     record already holds; the tick box is the false-versus-blank pair. A save of an
     untouched preferences form must name nothing at all. */
  eq('an untouched preferences save names nothing',
    labelsOf(
      { wireColor: 'White', outletTimer: 'No', specificOutlet: false,
        specificOutletNotes: '', notes: '', installPreference: 'October' },
      { wireColor: 'White', outletTimer: 'No', specificOutlet: '',
        specificOutletNotes: '', notes: '', installPreference: 'October' }),
    []);

  eq('a real colour change names the new colours',
    labelsOf({ lightsDescription: 'Red, Green' }, { lightsDescription: 'Warm White' }),
    ['The light colours on your house — now Warm White']);

  /* ⚠ ONE ANSWER STORED IN TWO FIELDS IS ONE LINE. Ticking the box while typing the note
     changes both, and two lines would tell the member they made two changes. */
  eq('the outlet pair is one line, not two',
    labelsOf({ specificOutlet: false, specificOutletNotes: '' },
             { specificOutlet: true, specificOutletNotes: 'the one by the garage' }),
    ['Which outlet we plug into']);

  eq('the sides pair is one line, not two',
    labelsOf({ houseSides: 2, houseSidesList: ['Front', 'Back'] },
             { houseSides: 3, houseSidesList: ['Front', 'Back', 'Left'] }).length, 1);

  /* ⛔ SIDES PROMISE NOTHING ABOUT THE PRICE. Changing them raises a re-quote, so the line
     has to say an updated price is coming — otherwise the template's closing sentence
     promises the work at the old figure. */
  check('changing sides says an updated price is coming',
    /updated price/i.test(labelsOf({ houseSides: 2 }, { houseSides: 4 })[0] || ''),
    'got: ' + JSON.stringify(labelsOf({ houseSides: 2 }, { houseSides: 4 })));

  /* ⛔ [[MSG-18]]'s rule, from the member's side. */
  eq('My Info fields are never named — not a change to the house',
    labelsOf({ name: 'Jo', phone: '8015550111', email: 'a@b.com', gateCode: '1234', address: '1 Elm' },
             { name: 'Jo Smith', phone: '8015550999', email: 'c@d.com', gateCode: '9999', address: '2 Oak' }),
    []);
  eq('a cancellation is never named',
    labelsOf({ cancellationReason: '' }, { cancellationReason: 'Moved away' }), []);

  eq('a field the record never held, arriving at its default, is not a change',
    labelsOf({}, { outletTimer: '', notes: '', specificOutlet: '' }), []);

  eq('two real changes give two lines',
    labelsOf({ wireColor: 'White', notes: '' }, { wireColor: 'Green', notes: 'ring first' }),
    ['Your wire colour — now Green', 'The note you have left us']);

  /* ⚠ THEIR OWN WORDS ARE NOT PASTED WHOLE INTO AN EMAIL, and `notes` is not echoed at
     all — it is theirs and can be a paragraph. */
  const long = labelsOf({ lightsDescription: 'Red' }, { lightsDescription: 'X'.repeat(300) })[0];
  check('a very long value is cut rather than pasted whole', long.length < 120,
    'line was ' + long.length + ' characters');
  check('the note is acknowledged without quoting it back',
    labelsOf({ notes: '' }, { notes: 'secret gate is round the back' })[0].indexOf('secret') === -1,
    'the note text was echoed into the email');
}

/* ⭐ THE TWO RENDERINGS MUST AGREE ABOUT WHAT MOVED. The office history and the member's
   email are written for different readers, so their WORDS differ on purpose — but a change
   in one and silence in the other is the bug the split exists to prevent. */
if (labelsOf && describeOf && fieldsOf) {
  console.log('\n=== The office history and the member email agree about what moved ===');
  const HOUSE = ['lightsDescription', 'wireColor', 'outletTimer', 'specificOutlet',
                 'specificOutletNotes', 'installPreference', 'notes', 'houseSides', 'houseSidesList'];
  const before = { lightsDescription: 'Red', wireColor: 'White', outletTimer: 'No',
                   specificOutlet: false, specificOutletNotes: '', notes: '',
                   installPreference: 'October', houseSides: 2, houseSidesList: ['Front', 'Back'] };
  let agreed = 0, disagreed = [];
  HOUSE.forEach(function (f) {
    const after = Object.assign({}, before);
    after[f] = (f === 'houseSides') ? 4
      : (f === 'houseSidesList') ? ['Front', 'Back', 'Left']
      : (f === 'specificOutlet') ? true : 'something else';
    const inLog = describeOf(before, after).length > 0;
    const inMail = labelsOf(before, after).length > 0;
    if (inLog === inMail) agreed++; else disagreed.push(f + ' (log:' + inLog + ' mail:' + inMail + ')');
  });
  check('every house field the history records, the email also names',
    disagreed.length === 0, disagreed.join(', '));
  check('and the sweep actually exercised all nine', agreed + disagreed.length === HOUSE.length);
}

/* ============================================================================
   2. WHEN IT SENDS AND WHEN IT STAYS QUIET — run against a fake Firestore
   ========================================================================= */
console.log('\n=== It sends only when it should ===');

function harness(opts) {
  opts = opts || {};
  const sent = [];
  const written = [];
  /* ⚠ A DELETED DOCUMENT IS AN ABSENT KEY, NOT A KEY HOLDING `undefined`. hasOwnProperty
     answers true for the second, so the fake Firestore reported the deleted template as
     existing and the check passed on code that had never been tested — the vacuous-fixture
     trap, caught by this check failing the right way round. */
  const docs = Object.assign({
    'settings/portalChangeEmail': { enabled: true, templateId: 'tpl1', templateName: 'Member Portal Change' },
    'settings/emailjs': { serviceId: 's1', templateId: 't1', publicKey: 'pk', privateKey: 'sk' },
    'emailTemplates/tpl1': { name: 'Member Portal Change', subject: 'We have got your change',
                             body: 'Hi {{name}},<br>{{change}}<br>{{portal_button}}' }
  }, opts.docs || {});
  Object.keys(docs).forEach(function (k) { if (docs[k] === undefined) delete docs[k]; });
  function ref(p) {
    return {
      get: async () => ({ exists: Object.prototype.hasOwnProperty.call(docs, p),
                          data: () => docs[p] }),
      update: async (u) => { written.push({ path: p, update: u }); }
    };
  }
  const db = { collection: (c) => ({ doc: (id) => ref(c + '/' + id) }) };
  const sandbox = {
    db: db,
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return opts.refuse
        ? { ok: false, text: async () => 'Gmail_API: quota exceeded' }
        : { ok: true, text: async () => 'OK' };
    },
    ensureToken: async () => 'tok123',
    properNameServer: (n) => String(n || '').split(' ')[0],
    escServer: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    templateSubjectOr: (t, f) => (String((t && t.subject) || '').trim() || f),
    console: { log: () => {}, error: () => {}, warn: () => {} }
  };
  /* ⚠ THE CONSTANT IS LIFTED, NEVER RE-TYPED HERE. A copy in this file is a second
     opinion about how long the quiet window is, and the copy that falls behind is the one
     that stops demanding anything — the seven fixtures that went on passing against the
     old bin cutoff are this repo's own worked example. */
  const quietConst = (/const PORTAL_CHANGE_EMAIL_QUIET_MINUTES\s*=\s*\d+;/.exec(funcs) || [''])[0];
  const code = quietConst + '\n' + liftServer('sendPortalChangeEmail', 'fn') +
    '\nreturn sendPortalChangeEmail;';
  const fn = new Function(...Object.keys(sandbox), code)(...Object.values(sandbox));
  return { fn, sent, written, docs };
}

const QUIET = (/const PORTAL_CHANGE_EMAIL_QUIET_MINUTES\s*=\s*(\d+);/.exec(fnsBare) || [])[1];
check('the quiet window is a named constant, not a number typed inline', !!QUIET,
  'PORTAL_CHANGE_EMAIL_QUIET_MINUTES was not found');

const LABELS = ['Your wire colour — now Green'];

function step(label, opts, record, labels, want) {
  const h = harness(opts);
  pendingChecks.push(h.fn('cust1', record, labels).then(function (res) {
    check(label, res.sent === want.sent,
      'sent=' + res.sent + ' because "' + res.why + '"');
    if (want.mails !== undefined) {
      check(label + ' — mails out', h.sent.length === want.mails,
        'got ' + h.sent.length + ' mail(s)');
    }
    if (want.body) want.body(h, res);
  }).catch(function (err) {
    check(label, false, 'threw: ' + err.message);
  }));
}

const CUST = { name: 'Jo Smith', email: 'jo@example.com' };

step('an ordinary change is emailed', {}, CUST, LABELS, { sent: true, mails: 1,
  body: function (h) {
    const p = h.sent[0].template_params;
    check('the email goes to the member, not the office', p.to_email === 'jo@example.com', p.to_email);
    check('the change is named in the body', p.body.indexOf('Your wire colour') !== -1, p.body);
    check('{{name}} is resolved to their first name', p.body.indexOf('Hi Jo,') !== -1, p.body);
    check('{{portal_button}} becomes a real link carrying their token',
      p.body.indexOf('tok123') !== -1 && p.body.indexOf('{{portal_button}}') === -1, p.body);
    check('the send is stamped so the same change is not confirmed twice',
      h.written.some(w => w.update && w.update.portalChangeEmailAt), JSON.stringify(h.written));
  } });

/* ⛔ NOTHING CHANGED IS THE COMMONEST CASE AND MUST COST NOTHING. It returns before it
   reads a single setting, so a re-saved form cannot even touch Firestore. */
step('nothing changed sends nothing', {}, CUST, [], { sent: false, mails: 0 });

/* ⛔ OFF UNTIL SHE TURNS IT ON. This mails real customers the moment it works, so the
   deploy that adds it must not start doing that. */
step('switched off sends nothing', { docs: { 'settings/portalChangeEmail': { enabled: false, templateId: 'tpl1' } } },
  CUST, LABELS, { sent: false, mails: 0 });
/* ⛔ NEVER CONFIGURED AT ALL IS THE CASE THAT MATTERS ON THE DEPLOY THAT ADDS THIS, and
   it is a different fixture from `enabled: false`: the settings document does not exist, so
   the test has to be "is it explicitly true" rather than "is it not false". A red-check
   swapping one for the other passed every other check in this file — which is exactly how
   a feature ships quietly emailing the whole book the first time somebody saves a form. */
step('never configured sends nothing — it is off until she turns it on',
  { docs: { 'settings/portalChangeEmail': undefined } }, CUST, LABELS, { sent: false, mails: 0 });
step('a settings document with no enabled field sends nothing',
  { docs: { 'settings/portalChangeEmail': { templateId: 'tpl1' } } }, CUST, LABELS, { sent: false, mails: 0 });
step('on with no template picked sends nothing',
  { docs: { 'settings/portalChangeEmail': { enabled: true, templateId: '' } } },
  CUST, LABELS, { sent: false, mails: 0 });
/* ⛔ A DELETED TEMPLATE SENDS NOTHING RATHER THAN INVENTED WORDING — [[EM-16]]'s lesson.
   A built-in fallback body is wording she never wrote going out over her name. */
step('a deleted template sends nothing rather than wording she never wrote',
  { docs: { 'emailTemplates/tpl1': undefined } }, CUST, LABELS, { sent: false, mails: 0 });
step('a member with no email on file is skipped', {}, { name: 'Jo' }, LABELS, { sent: false, mails: 0 });
step('EmailJS not set up on the server sends nothing',
  { docs: { 'settings/emailjs': { serviceId: 's1' } } }, CUST, LABELS, { sent: false, mails: 0 });

/* ⚠ THE DEDUPE IS ON THE WORDING, NOT ON WHICH FIELDS MOVED. Fingerprinting the fields
   would suppress a real red-then-blue correction and leave the member holding an email
   naming the colour they backed out of — a stale confirmation is worse than a second one. */
step('the identical change inside the window is not confirmed twice', {},
  Object.assign({ portalChangeEmailKey: LABELS.join(' | '),
                  portalChangeEmailAt: { toMillis: () => Date.now() - 60 * 1000 } }, CUST),
  LABELS, { sent: false, mails: 0 });
step('a DIFFERENT change inside the window still gets its own email', {},
  Object.assign({ portalChangeEmailKey: 'Your wire colour — now Red',
                  portalChangeEmailAt: { toMillis: () => Date.now() - 60 * 1000 } }, CUST),
  LABELS, { sent: true, mails: 1 });
step('the same change again long afterwards is confirmed', {},
  Object.assign({ portalChangeEmailKey: LABELS.join(' | '),
                  portalChangeEmailAt: { toMillis: () => Date.now() - 48 * 3600 * 1000 } }, CUST),
  LABELS, { sent: true, mails: 1 });

/* ⚠ STAMPED ONLY AFTER THE SEND SUCCEEDS, so a refusal does not open a quiet window that
   suppresses the retry as well as the send that never happened. */
step('a refused send is not stamped', { refuse: true }, CUST, LABELS, { sent: false, mails: 1,
  body: function (h) {
    check('a refusal writes no stamp', h.written.length === 0, JSON.stringify(h.written));
  } });

/* ⭐ [[MSG-27]]'s RULE, APPLIED TO A TEMPLATE SHE EDITS. The whole point of this email is
   saying WHICH change we have got down. A body edited later that happens to drop
   {{change}} would send "we'll make sure to make this change on your house" naming no
   change at all — the same bug re-armed, with nothing anywhere going red. */
step('a template with no {{change}} still says what changed',
  { docs: { 'emailTemplates/tpl1': { name: 'x', subject: 's', body: 'Hi {{name}} — all sorted.' } } },
  CUST, LABELS, { sent: true, mails: 1,
  body: function (h) {
    check('the list is appended when the token was deleted',
      h.sent[0].template_params.body.indexOf('Your wire colour') !== -1,
      h.sent[0].template_params.body);
  } });

/* ============================================================================
   3. THE WIRING — asserted separately, because the mechanism can be perfect
      and reach nobody
   ========================================================================= */
console.log('\n=== It is actually wired into portalSave ===');

const SECTIONS = (/const PORTAL_CHANGE_EMAIL_SECTIONS\s*=\s*\[([^\]]*)\]/.exec(fnsBare) || [, ''])[1];
check('the auto-reply runs for the lights section', /'lights'/.test(SECTIONS), SECTIONS);
check('the auto-reply runs for the preferences section', /'preferences'/.test(SECTIONS), SECTIONS);
check('the auto-reply runs for the sides section', /'sides'/.test(SECTIONS), SECTIONS);
/* ⛔ THESE TWO ARE EXCLUDED ON PURPOSE AND THE EXCLUSION IS THE RULE. 'info' is [[MSG-18]]
   ("changing gate code or phone number should not notify us") and 'cancel' is somebody
   leaving — thanking them for a change we will make is the wrong thing to send. */
check('it never runs for My Info', !/'info'/.test(SECTIONS), SECTIONS);
check('it never runs for a cancellation', !/'cancel'/.test(SECTIONS), SECTIONS);

const saveAt = fnsBare.indexOf('exports.portalSave');
const saveEnd = fnsBare.indexOf('exports.portalRsvp');
const saveBody = saveAt > -1 && saveEnd > saveAt ? fnsBare.slice(saveAt, saveEnd) : '';
check('portalSave was found', !!saveBody);
check('portalSave calls the auto-reply',
  saveBody.indexOf('sendPortalChangeEmail(') !== -1,
  'the mechanism can be perfect and still reach nobody');
check('and it is gated on the three sections rather than running for every save',
  saveBody.indexOf('PORTAL_CHANGE_EMAIL_SECTIONS') !== -1);
/* ⚠ AFTER THE WRITE. An email describing a change that then failed to save is worse than
   no email — it tells the member their house is set up in a way it is not. */
const writeAt = saveBody.indexOf(".update(updates)");
const mailAt = saveBody.indexOf('sendPortalChangeEmail(');
check('the email is sent AFTER the record is written, never before',
  writeAt > -1 && mailAt > writeAt, 'write at ' + writeAt + ', mail at ' + mailAt);
/* ⚠ AND IT CANNOT BREAK THE SAVE. The record is already correct by that line, so the worst
   a throw could do is tell the member their change did not work when it did. */
const mailRegion = saveBody.slice(Math.max(0, mailAt - 400), mailAt + 200);
check('a refused email can never fail the save',
  /try\s*\{/.test(mailRegion) && /catch/.test(saveBody.slice(mailAt, mailAt + 500)),
  'the call is not wrapped');

console.log('\n=== The office can switch it on and pick the wording ===');
check('the card exists in Automation Emails', adminBare.indexOf('id="portalChangeEmailCard"') !== -1);
['pceOn', 'pceTemplate', 'pceSaveBtn', 'pceMakeTmplBtn', 'pceStatus'].forEach(function (id) {
  check('the card has its ' + id + ' control', adminBare.indexOf('id="' + id + '"') !== -1);
});
check('the card is loaded at login',
  adminBare.indexOf('loadPortalChangeEmailSettings();') !== -1);
/* ⚠ THE PICKER REFILLS WHEN THE TEMPLATE LIST CHANGES, or it goes on naming a template
   that has been renamed or deleted — the failure the quote pickers already have a line for. */
check('the picker refills when the template list changes',
  adminBare.indexOf("renderPortalChangeEmailCard === 'function'") !== -1);
/* ⛔ AND IT REFILLS IN PRESERVE MODE, which is the half a behavioural check cannot see.
   The renderer can keep an unsaved tick perfectly and the bug still be back, because the
   SNAPSHOT is what decides which mode it runs in — pass syncFromSaved here and every
   template edit resets the card again, with the jsdom checks above still green. The
   red-check proved exactly that: sabotaging this one call was the only one of twenty-one
   that got through, until this line existed. Wiring is asserted separately from mechanism. */
const tplSnapCall = (function () {
  const at = adminBare.indexOf("renderPortalChangeEmailCard === 'function'");
  return at < 0 ? '' : adminBare.slice(at, adminBare.indexOf('\n', at));
})();
check('and the snapshot redraw never resyncs from the saved settings',
  tplSnapCall.indexOf('syncFromSaved') === -1 && /renderPortalChangeEmailCard\(\s*\)/.test(tplSnapCall),
  'the template snapshot calls it as: ' + tplSnapCall.trim());
/* ⭐ BY ID, NOT BY NAME — [[EM-16]]'s lesson. A template she renames would be found on this
   screen and not on the server, so the card would look set up and every member change would
   silently go unanswered. */
const saveHandler = adminBare.slice(adminBare.indexOf("pceSaveBtn')?.addEventListener"),
                                    adminBare.indexOf("pceSaveBtn')?.addEventListener") + 1400);
check('the card stores the template by id',
  /templateId:\s*id/.test(saveHandler), saveHandler.slice(0, 300));
/* ⭐ ONE PRESS, NOT FOUR (2026-09-17). Addie: "I already gave you a template to work with."
   She had, twice, and being walked back through supplying it is the complaint — so the
   button creates the template, picks it, ticks the box and SAVES, in one go.
   ⚠ THIS REVERSES AN INVARIANT THIS FILE USED TO HOLD, and the old checks are repointed
   rather than deleted so the reversal is deliberate and visible. They asserted the handler
   never wrote `portalChangeEmailCfg`, because back then it only PICKED a template on screen
   and a card claiming a saved pick that a reload would lose is a lie. It really saves now,
   so the claim is true — what has to be asserted instead is that it saves BEFORE it says so.
   ⚠ AND NOTE THE OLD CHECKS WOULD HAVE PASSED ANYWAY: they matched the literal
   `portalChangeEmailCfg.templateId =`, and the new code writes `portalChangeEmailCfg = next`.
   A check pinned to the spelling of an assignment rather than to what must be true — the
   S82/S129 shape, in my own file. */
const makeHandler = (function () {
  const at = adminBare.indexOf("pceMakeTmplBtn')?.addEventListener");
  if (at < 0) return '';
  const end = adminBare.indexOf("pceSaveBtn')?.addEventListener", at);
  return stripComments(adminBare.slice(at, end > at ? end : adminBare.length));
})();
check('the make-a-template button was found', !!makeHandler);
check('one press really does switch it on',
  /enabled:\s*true/.test(makeHandler) && /setDoc\(/.test(makeHandler),
  'the whole point is that she does not have to press this, then tick, then Save');
/* ⛔ SAVED BEFORE IT SAYS SO. The card claiming it is on while the write is still in
   flight — or failed — is the same lie the old invariant was protecting against, pointing
   the other way: she would walk away believing members are being answered. */
/* ⚠ AND THE CHECK IS THAT IT LOOKS ONE UP, not that a guard is SHAPED right. The first
   version asserted `if (!hit)` existed and that the create sat after it — a sabotage
   replacing the lookup with `let hit = null` left both true and sailed straight through,
   so it proved the punctuation and not the behaviour. Caught by the red-check. */
check('an existing template is found before anything is created',
  makeHandler.indexOf('emailTemplates.find(') !== -1 &&
  makeHandler.indexOf('emailTemplates.find(') < makeHandler.indexOf('addDoc('),
  'without the lookup, pressing this twice writes the built-in wording back over hers: ' +
  makeHandler.slice(0, 300));
check('and it saves before it claims to have',
  makeHandler.indexOf('setDoc(') < makeHandler.indexOf('Members who change something now get it'),
  'the success line must sit after the await, not before it');
check('and a failed save says so instead',
  /catch[\s\S]{0,120}Could not switch it on/.test(makeHandler),
  'a silent failure here leaves her thinking every member is getting an answer');
/* ⚠ AND IT NEVER OVERWRITES WORDING SHE HAS EDITED. Pressing it twice, or after she has
   reworded the template, must switch the EXISTING one on rather than writing the built-in
   copy back over her words. */
check('and an existing template is switched on, never rewritten',
  /if\s*\(!hit\)/.test(makeHandler) && makeHandler.indexOf('body: DEFAULT_PORTAL_CHANGE_BODY') > makeHandler.indexOf('if (!hit)'),
  'the create branch must sit INSIDE the not-found guard: ' + makeHandler.slice(0, 300));

/* ⭐ THE STARTING WORDING IS HERS (pasted 2026-09-16, and again 2026-09-17) AND IS ASSERTED,
   because it is what the first email she ever sends actually says. `Write me one to start
   from` writes exactly this, so losing {{change}} out of it would mean an auto-reply that
   thanks somebody and never names what they changed. `sendPortalChangeEmail` appends the
   list when the body places no token, and that is the safety net rather than the design.
   ⚠ THESE FOUR WERE SILENTLY LOST ONCE, in the edit that rewrote the makeHandler block
   just above — the replaced region ran past them to the same anchor, the count went 96 → 95,
   and it read as the repoint costing one check. Check what a large replacement swallows. */
const defaultBody = (function () {
  const at = adminBare.indexOf('const DEFAULT_PORTAL_CHANGE_BODY =');
  if (at < 0) return '';
  /* ⚠ CUT AT THE NEXT DECLARATION, NOT AT A CHARACTER COUNT — §7 bans fixed-length windows,
     and the body grows every time she rewords it. */
  const end = adminBare.indexOf('document.getElementById(', at);
  return adminBare.slice(at, end > at ? end : adminBare.length);
})();
check('the starting wording was found', !!defaultBody);
check('and it names what changed', defaultBody.indexOf('{{change}}') !== -1,
  'her draft thanks them for "the changes you requested" and would never say which');
check('and it greets them by name', defaultBody.indexOf('{{name}}') !== -1, defaultBody.slice(0, 200));
/* ⚠ THE BUTTON MUST WRITE THE CONSTANT, NOT A STRING OF ITS OWN. An inline body here means
   editing the wording above changes nothing anybody receives. */
/* ⚠ SCOPED TO THE addDoc CALL, and the red-check is why. The handler also MIRRORS the new
   template into the local `emailTemplates` list, and that mirror carries
   `body: DEFAULT_PORTAL_CHANGE_BODY` too — so a file-wide test was satisfied by the mirror
   while the real write had been sabotaged to an inline string. A check that passes on the
   copy of a thing rather than the thing. */
const addDocCall = (function () {
  const at = makeHandler.indexOf('addDoc(collection(db,\'emailTemplates\')');
  if (at < 0) return '';
  let d = 0, k = makeHandler.indexOf('(', at);
  for (;; k++) { if (makeHandler[k] === '(') d++; else if (makeHandler[k] === ')') { d--; if (!d) break; } }
  return makeHandler.slice(at, k + 1);
})();
check('the template write was found', !!addDocCall, makeHandler.slice(0, 400));
check('and "use the wording you gave us" writes exactly that constant',
  /body:\s*DEFAULT_PORTAL_CHANGE_BODY/.test(addDocCall), addDocCall.slice(0, 400));
/* ⛔ AND IT DOES NOT LABEL ITSELF AN AUTOMATIC REPLY. Her first paste ended "This is auto-
   Reply" and a grey footer saying so was added; she pasted the wording again the next day
   WITHOUT that line, which is the answer — it was her labelling the message to me, not copy
   for a customer. Checked so a later session does not helpfully put it back. */
check('and it does not announce itself as an automatic reply',
  !/automatic reply/i.test(defaultBody) && !/auto-\s*reply/i.test(defaultBody),
  'she removed that line herself on the second paste: ' + defaultBody.slice(-200));
check('and it ends on her sign-off',
  /'Best,<br>' \+[\s\S]{0,40}'Highlighting Utah';/.test(defaultBody), defaultBody.slice(-200));

check('the server loads the template by that id, never by name',
  /emailTemplates'\)\.doc\(String\(cfg\.templateId\)\)/.test(fnsBare),
  'a name lookup here is a second opinion about which of her emails this is');


/* ============================================================================
   1b. A TICK BOX HAS THREE SPELLINGS — the bug this feature nearly shipped on
   ========================================================================= */
console.log('\n=== Yes/No fields are read the same way whichever spelling arrives ===');

/* ⛔ FOUND BY RUNNING THE DIFF, NOT BY READING IT (2026-09-16). `portalChangeValueText`
   answered `v ? 'yes' : 'no'` for the `yesno` kind, and the STRING 'No' is truthy — so
   `specificOutlet`, whose radios in index.html post 'Yes'/'No', was wrong in BOTH
   directions at once:
     - a real switch from No to Yes produced NO history row and NO line in this email;
     - a record holding boolean `false`, saved against a posted 'No' with nobody touching
       anything, reported "no → yes" EVERY time — which on this path is an email to a
       customer about a change they did not make, the exact failure the whole gate exists
       to prevent.
   Both directions are checked here, and so is the original blank-versus-false trap the
   old line was written to close, because the fix had to keep that closed to be a fix. */
if (labelsOf && describeOf) {
  eq('a real outlet switch No → Yes is seen',
    labelsOf({ specificOutlet: 'No' }, { specificOutlet: 'Yes' }), ['Which outlet we plug into']);
  eq('and Yes → No is seen too',
    labelsOf({ specificOutlet: 'Yes' }, { specificOutlet: 'No' }), ['Which outlet we plug into']);
  eq('a record holding boolean false, saved against a posted No, is NOT a change',
    labelsOf({ specificOutlet: false }, { specificOutlet: 'No' }), []);
  eq('a record holding boolean true, saved against a posted Yes, is NOT a change',
    labelsOf({ specificOutlet: true }, { specificOutlet: 'Yes' }), []);
  /* ⚠ THE ORIGINAL TRAP MUST STAY CLOSED. '' and false are the same answer spelt two
     ways; reading them as different reported every customer's tick boxes changing on
     every save, which is what the line being fixed was written to prevent. */
  eq('blank and false are still the same answer',
    labelsOf({ specificOutlet: false }, { specificOutlet: '' }), []);
  eq('and the office history agrees about the real switch',
    describeOf({ specificOutlet: 'No' }, { specificOutlet: 'Yes' }), ['Specific outlet: no → yes']);
}

/* ⚠ PAIRED RULE. admin.html's `changeValueText` is the office copy of the same decision and
   change-log.test.js already requires the two to agree; this asserts the FIX reached both,
   because a fix in one of a pair is half a fix and the half that is missed is silent. */
/* ⚠ WALKED TO THE CLOSING BRACE, NEVER A FIXED WINDOW. The first version of this check
   took "the next 1200 characters" and failed on a correct file the moment the fix arrived
   with its explanation attached — CLAUDE.md §7 bans a magic length by name and run-all.js
   enforces it, and writing one anyway is how that rule keeps earning its place. */
const officeYesNo = (function () {
  const at = admin.indexOf('function changeValueText(');
  if (at < 0) return '';
  let k = admin.indexOf('{', at), d = 0;
  for (; k < admin.length; k++) {
    if (admin[k] === '{') d++;
    else if (admin[k] === '}') { d--; if (!d) break; }
  }
  return stripComments(admin.slice(at, k + 1));
})();
check('the office copy of the Yes/No rule was fixed too',
  /'false'/.test(officeYesNo) && /toLowerCase\(\)/.test(officeYesNo),
  'admin.html still reads the truthiness of the string');

/* ============================================================================
   4. THE CARD, RUN AGAINST jsdom — a redraw must not throw away her tick
   ========================================================================= */
console.log('\n=== The card keeps what she has typed ===');

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* reported below, never skipped silently */ }
check('jsdom is installed so the card can actually be drawn', !!JSDOM,
  'run npm install — a gate that silently skips is a gate that reports green for the wrong reason');

if (JSDOM) {
  function liftAdmin(name) {
    const start = admin.indexOf('function ' + name + '(');
    if (start < 0) return '';
    let k = admin.indexOf('{', start), d = 0;
    for (; k < admin.length; k++) {
      if (admin[k] === '{') d++;
      else if (admin[k] === '}') { d--; if (!d) break; }
    }
    return admin.slice(start, k + 1);
  }
  const rCard = liftAdmin('renderPortalChangeEmailCard');
  const rStatus = liftAdmin('renderPortalChangeEmailStatus');
  check('both card renderers were found in admin.html', !!rCard && !!rStatus,
    'missing: ' + [!rCard && 'renderPortalChangeEmailCard', !rStatus && 'renderPortalChangeEmailStatus']
      .filter(Boolean).join(', '));

  if (rCard && rStatus) {
    /* ⚠ THE MARKUP IS CUT OUT OF admin.html, never hand-written here. A fixture carrying its
       own copy of the card proves the copy works and says nothing at all about the card the
       office opens — the vacuous-fixture trap this repo names in four other places. */
    const cardStart = admin.indexOf('<div class="card" id="portalChangeEmailCard"');
    const cardHtml = cardStart > -1 ? admin.slice(cardStart, admin.indexOf('</div>', admin.indexOf('id="pceStatus"'))) + '</div></div>' : '';
    check('the real card markup was lifted out of admin.html', !!cardHtml);

    function makeCard(cfg, templates) {
      const dom = new JSDOM('<body>' + cardHtml + '</body>');
      const doc = dom.window.document;
      const sandbox = {
        document: doc,
        esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        emailTemplates: templates,
        portalChangeEmailCfg: cfg
      };
      const fn = new Function(...Object.keys(sandbox),
        rStatus + '\n' + rCard + '\nreturn renderPortalChangeEmailCard;')(...Object.values(sandbox));
      return { doc, render: fn };
    }
    const TPLS = [{ id: 'tpl1', data: { name: 'Member Portal Change' } },
                  { id: 'tpl2', data: { name: 'Something Else' } }];
    const SAVED_OFF = { enabled: false, templateId: '', templateName: '' };

    /* ⛔ THE BUG THIS EXISTS FOR. The card is wired into the emailTemplates snapshot so the
       picker follows a rename — and that snapshot fires on every template edit, which is
       exactly what she is doing while this card is open. The first version reset both
       controls from the SAVED settings on every redraw, so the Save that followed wrote
       enabled:false over the box she had just ticked. */
    {
      const c = makeCard(SAVED_OFF, TPLS);
      c.render({ syncFromSaved: true });
      c.doc.getElementById('pceOn').checked = true;
      c.doc.getElementById('pceTemplate').value = 'tpl1';
      c.render();                       // a template elsewhere was edited
      check('a redraw keeps a tick box she has not saved yet',
        c.doc.getElementById('pceOn').checked === true,
        'the redraw unticked it — the next Save would store enabled:false');
      check('a redraw keeps a template she has picked but not saved',
        c.doc.getElementById('pceTemplate').value === 'tpl1',
        'got ' + c.doc.getElementById('pceTemplate').value);
      check('and it says out loud that the change is not saved yet',
        /not saved yet/i.test(c.doc.getElementById('pceStatus').textContent),
        c.doc.getElementById('pceStatus').textContent);
    }
    /* ⚠ AND THE OTHER DIRECTION, or "preserve everything" would pass this file while making
       the card unable to show what is actually stored. */
    {
      const c = makeCard({ enabled: true, templateId: 'tpl2', templateName: 'Something Else' }, TPLS);
      c.render({ syncFromSaved: true });
      check('loading from the stored settings does set the tick box',
        c.doc.getElementById('pceOn').checked === true);
      check('and does pick the stored template',
        c.doc.getElementById('pceTemplate').value === 'tpl2',
        c.doc.getElementById('pceTemplate').value);
      check('with the status naming it rather than warning',
        /Something Else/.test(c.doc.getElementById('pceStatus').textContent),
        c.doc.getElementById('pceStatus').textContent);
    }
    /* ⚠ A DELETED TEMPLATE IS NAMED, not quietly unpicked — otherwise the card reads exactly
       like one she never set up, on a feature whose only symptom is an email nobody gets. */
    {
      const c = makeCard({ enabled: true, templateId: 'gone', templateName: 'The Old One' }, TPLS);
      c.render({ syncFromSaved: true });
      const txt = c.doc.getElementById('pceTemplate').textContent;
      check('a deleted template is still named on the card', /The Old One/.test(txt), txt);
      check('and the status says nothing is being sent',
        /deleted/i.test(c.doc.getElementById('pceStatus').textContent),
        c.doc.getElementById('pceStatus').textContent);
    }
    /* ⚠ ON WITH NOTHING PICKED IS THE STATE THAT LOOKS FINE AND SENDS NOTHING. */
    {
      const c = makeCard({ enabled: true, templateId: '', templateName: '' }, TPLS);
      c.render({ syncFromSaved: true });
      check('on with no template picked says so',
        /no template is picked/i.test(c.doc.getElementById('pceStatus').textContent),
        c.doc.getElementById('pceStatus').textContent);
    }
  }
}

Promise.all(pendingChecks).then(function () {
  console.log('');
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');
  if (fail) {
    console.log('An auto-reply that fires on an untouched form emails the whole book about');
    console.log('changes nobody made; one that never fires looks exactly like one that is');
    console.log('switched off. Neither shows up anywhere but in a member\'s inbox.\n');
  }
  process.exit(fail ? 1 : 0);
});
