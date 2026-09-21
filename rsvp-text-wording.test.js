/*
 * What the RSVP text actually says
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-09-21, told the Text the RSVP card was already in Automation Emails but
 * that the sentence inside it was not: "Okay do it with updated code."
 *
 * ⭐ THE RSVP EMAIL HAS ALWAYS BEEN A TEMPLATE AND THE TEXT WAS A SENTENCE IN
 * admin.html. So the one message she could not reach from the screen was the one going
 * to the customers the email cannot reach at all — changing a word meant changing the
 * source. `rsvpTextMessageParts` makes it a template she picks, with the built-in
 * wording as the floor.
 *
 * ⛔ THE CHECK THAT EARNS THE FILE IS THE FALLBACK CHAIN, and it is here rather than in
 * rsvp-text-link.test.js because it is a different claim about a different failure.
 * That file asks whether the ADDRESS survives the trip between two files. This one asks
 * what happens when the wording is not there — and every one of those cases is silent
 * by construction:
 *   · nothing picked        → the built-in wording, which is the old behaviour exactly
 *   · picked, then renamed  → getEmailTemplateByName is an EXACT, case-sensitive match,
 *                             so it answers undefined and looks identical to
 *   · picked, not loaded    → the template list has not landed yet
 *   · picked, but empty     → renders down to a bare address
 * Three of those four must fall back and SAY SO. The fourth must NOT fall back, because
 * falling back there puts the built-in wording over the top of a template she chose, on
 * a send of several hundred, with nothing anywhere going red. A single `if (!tmpl)`
 * handles all four identically and passes every other gate in this repo.
 *
 * ⛔ AND THE SECOND ONE IS WHAT A TEXT CANNOT CARRY. An email template holds
 * {{rsvp_yes_button}}, {{referral_button}}, {{photo}}, {{houses_block}} — things on a
 * page. This app has already mailed customers a literal "{{photo}}" once (the bulk
 * nudge, 2026-08-17), and the lesson was not that the token was the wrong one: it was
 * that nothing was counting what it could not render. Every token that is not {{name}}
 * or {{link}} must come out, and the count must come back with the message.
 *
 * ⚠ THE RULES ARE LIFTED, NEVER STUBBED. What is under test is what the Copy button
 * puts on the clipboard, so a stubbed renderer would decide the very thing being
 * checked — and this is the message several hundred customers get.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node rsvp-text-wording.test.js      (or: npm run test:textwording)
 */

const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Match the code, never the prose describing it — every name checked below also
   appears in the comment explaining it. CLAUDE.md §7, and the Suite 58 trap. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
          .replace(/<!--[\s\S]*?-->/g, ' ');
}

/* `async` first: matching only `function NAME(` hands back a body full of bare
   `await`, a parse error that kills the whole file as one unattributable crash. */
function lift(src, name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = src.indexOf(opener);
    if (at === -1) continue;
    const end = src.indexOf('\n}', at);
    if (end === -1) return '';
    return src.slice(at, end + 2);
  }
  return '';
}

/* ======================================================== 0. the sandbox
 * Everything the chain touches, lifted. The preamble seeds the two module-level
 * values the page owns — which template is picked, and whether the list has landed —
 * so each case below is reached by setting them rather than by a second copy of the
 * rule deciding for itself.
 * ====================================================================== */
const DEFAULT_BODY_SRC = (admin.match(/const RSVP_TEXT_DEFAULT_BODY =[\s\S]*?;\r?\n/) || [])[0] || '';
check('the built-in wording is findable', !!DEFAULT_BODY_SRC,
  'without it every case below renders an empty body and passes on nothing');

const NAMES = ['htmlEmailToPlainText', 'properName', 'firstName', 'getEmailTemplateByName',
               'rsvpTextRenderBody', 'rsvpTextMessageParts', 'rsvpTextMessageFor', 'smsSegments'];
const SRCS = NAMES.map(n => lift(admin, n));
check('every rule in the chain is findable', SRCS.every(Boolean),
  NAMES.filter((n, i) => !SRCS[i]).join(', ') + ' missing');

let api = null;
if (DEFAULT_BODY_SRC && SRCS.every(Boolean)) {
  api = new Function('picked', 'loaded', 'templates',
    DEFAULT_BODY_SRC + '\n' +
    'let rsvpTextTemplateName = picked;\n' +
    'let etTemplatesLoaded = loaded;\n' +
    'let emailTemplates = templates;\n' +
    SRCS.join('\n') + '\n' +
    'return {parts: rsvpTextMessageParts, msg: rsvpTextMessageFor,\n' +
    '        render: rsvpTextRenderBody, segs: smsSegments,\n' +
    '        defaultBody: RSVP_TEXT_DEFAULT_BODY};');
}

/* A real-length address, so every character count below is the one that ships.
   The token length is read off the generator rather than typed: rsvp-text-link's
   own note records a six-character fixture that passed while the shipped message
   ran to 172 characters. */
const TOK_LEN = Number(((lift(admin, 'generatePortalToken') || '').match(/i\s*<\s*(\d+)\s*;/) || [])[1]);
check('the token length is read off the generator', TOK_LEN > 0,
  'without it this file is guessing at the only number that decides whether the ' +
  'message fits in one text');
const LINK = 'https://highlightingutah.com/a/' + 'a'.repeat(TOK_LEN || 20);

const tmpl = (name, body, extra) => Object.assign(
  { id: name, data: Object.assign({ name: name, body: body }, extra || {}) });

/* ================================================== 1. nothing picked at all
 * The floor, and the old behaviour exactly. A book that has never opened the card
 * is on this branch, so it is the one that must not change.
 * ====================================================================== */
if (api) {
  const a = api('', true, []);
  const p = a.parts({ name: 'Nora Noemail' }, LINK);
  check('nothing picked uses the built-in wording', p.source === 'builtin',
    'got ' + p.source);
  check('and it still names them and ends on the address',
    /^Hi Nora,/.test(p.text) && p.text.indexOf(LINK) === p.text.length - LINK.length,
    'got ' + JSON.stringify(p.text) + ' — a text cannot hide a link behind a word, so ' +
    'the address has to be visible and easy to tap');
  check('and it still fits in one message', a.segs(p.text) === 1,
    'got ' + p.text.length + ' characters');
  /* ⚠ THE NAME IS THE ONLY PART THAT VARIES, so a count against one short name
     proves the least of it. */
  check('and still fits for a long first name',
    a.segs(a.msg({ name: 'Christopherjames Vanderhoeven' }, LINK)) === 1,
    'got ' + a.msg({ name: 'Christopherjames Vanderhoeven' }, LINK).length + ' characters');
  check('somebody with no name still gets a sentence that reads',
    /^Hi there,/.test(a.msg({}, LINK)), 'got ' + JSON.stringify(a.msg({}, LINK)));
  /* ⚠ THE GREETING IS THE APP'S OWN RULE NOW. The old built-in sentence did its own
     .split(/\s+/)[0], which renders "The Hollands" as "Hi The," — the exact case
     firstName exists for, and not a rare one on a book of households. */
  check('and a household name is not cut in half',
    /^Hi The Hollands,/.test(a.msg({ name: 'The Hollands' }, LINK)),
    'got ' + JSON.stringify(a.msg({ name: 'The Hollands' }, LINK)));
}

/* ============================================ 2. picked, and really there
 * ====================================================================== */
if (api) {
  const a = api('RSVP Text', true, [tmpl('RSVP Text', 'Lights this year, {{name}}? {{link}}')]);
  const p = a.parts({ name: 'Nora Noemail' }, LINK);
  check('a picked template is what goes out', p.source === 'template' &&
    p.text === 'Lights this year, Nora? ' + LINK,
    'got ' + p.source + ' / ' + JSON.stringify(p.text));
  /* ⚠ THE WHOLE POINT OF THE CHANGE: her words reach the customer. A check that only
     asserted the source would pass with the built-in body rendered under a
     'template' label. */
  check('and the words are hers, not the built-in ones',
    p.text.indexOf('Highlighting Utah') === -1,
    'got ' + JSON.stringify(p.text) + ' — the built-in sentence leaked through');
  /* ⚠ HER PLACEMENT OF {{link}} WINS, AND IS NOT DOUBLED. Appending unconditionally
     would put the address in twice and add 51 characters to every message. */
  check('the address is not repeated when she placed it herself',
    p.text.split(LINK).length - 1 === 1,
    'got ' + (p.text.split(LINK).length - 1) + ' copies of the address');
  const noLink = api('RSVP Text', true, [tmpl('RSVP Text', 'Lights this year, {{name}}?')])
    .parts({ name: 'Nora' }, LINK);
  check('and a template that forgets the link still ends on one',
    noLink.text.indexOf(LINK) === noLink.text.length - LINK.length,
    'got ' + JSON.stringify(noLink.text) + ' — a text with no address in it asks a ' +
    'question the customer has no way to answer');
}

/* =============================== 3. the four silent cases, told apart
 * ⛔ THIS IS THE SECTION THE FILE EXISTS FOR. Three of these must fall back; the
 * fourth must not. One `if (!tmpl)` satisfies every other gate in the repo and gets
 * the fourth one wrong, silently, on a send of several hundred.
 * ====================================================================== */
if (api) {
  const renamed = api('RSVP Text', true, [tmpl('RSVP Text v2', 'Hi {{name}} {{link}}')]);
  const p = renamed.parts({ name: 'Nora' }, LINK);
  check('a renamed template falls back rather than sending nothing',
    p.source === 'missing' && /Highlighting Utah/.test(p.text),
    'got ' + p.source + ' — refusing would cost her the send and leave her on a card ' +
    'with nothing to press; there is a correct wording sitting right there');
  /* ⚠ AND IT REMEMBERS WHAT SHE ASKED FOR. Without the name the card cannot say which
     template has gone, and "it has been renamed" is the one sentence that tells her
     what to do about it. */
  check('and it still names the template she picked', p.wanted === 'RSVP Text',
    'got ' + JSON.stringify(p.wanted));

  /* ⛔ THE ONE THAT MUST NOT FALL BACK. */
  const loading = api('RSVP Text', false, []).parts({ name: 'Nora' }, LINK);
  check('a template list that has not loaded WAITS rather than guessing',
    loading.source === 'loading' && loading.text === '',
    'got ' + loading.source + ' / ' + JSON.stringify(loading.text) +
    ' — falling back here sends the built-in wording over the top of a template she ' +
    'picked, to several hundred people, and nothing anywhere would say so');
  /* ⚠ AND NOT LOADED IS NOT THE SAME AS NOTHING PICKED. With no template picked there
     is nothing to wait for, so the card must not sit saying "loading" for ever on a
     book that has never opened it. */
  check('but with nothing picked there is nothing to wait for',
    api('', false, []).parts({ name: 'Nora' }, LINK).source === 'builtin',
    'a card that waits for a list it does not need never draws');

  const blank = api('RSVP Text', true, [tmpl('RSVP Text', '')]).parts({ name: 'Nora' }, LINK);
  check('an empty template body falls back rather than sending a bare address',
    blank.source === 'blank' && /Highlighting Utah/.test(blank.text),
    'got ' + blank.source + ' / ' + JSON.stringify(blank.text) +
    ' — a naked link sent to somebody not expecting to hear from us reads as a scam');
  /* ⚠ AND SO DOES ONE WHOSE ONLY CONTENT WAS THINGS A TEXT CANNOT CARRY. This is the
     likelier way to reach that state than an empty box: picking the RSVP EMAIL, whose
     body is mostly buttons, out of the same dropdown. */
  const buttonsOnly = api('RSVP Email', true,
    [tmpl('RSVP Email', '{{rsvp_yes_button}}{{rsvp_no_button}}{{rsvp_back_button}}')])
    .parts({ name: 'Nora' }, LINK);
  check('and so does one that was nothing but buttons',
    buttonsOnly.source === 'blank' && /Highlighting Utah/.test(buttonsOnly.text),
    'got ' + buttonsOnly.source + ' / ' + JSON.stringify(buttonsOnly.text) +
    ' — picking the RSVP email out of the same dropdown is the likeliest way to get here');
}

/* ================================== 4. what a text cannot carry comes out
 * ====================================================================== */
if (api) {
  /* ⚠ THE TOKENS ARE IN THE MIDDLE OF THE SENTENCE, NOT ALL AT THE END, and that is
     the whole of what makes the last check here bite. The first draft put them in a run
     at the end, so removing them left only trailing spaces — which .trim() takes off
     anyway. Deleting the whitespace repair passed, and the fixture, not the check, was
     what could not fail. */
  const a = api('RSVP Text', true, [tmpl('RSVP Text',
    'Hi {{name}}, {{rsvp_yes_button}} lights this year? {{rsvp_no_button}} ' +
    '{{rsvp_back_button}} {{referral_button}} up to you {{photo}} — let us know')]);
  const p = a.parts({ name: 'Nora' }, LINK);
  check('no token survives into the message',
    !/\{\{|\}\}/.test(p.text),
    'got ' + JSON.stringify(p.text) + ' — this app has mailed a customer a literal ' +
    '"{{photo}}" once already');
  check('and every one of them is counted and named', p.dropped.length === 5 &&
    p.dropped.indexOf('rsvp_yes_button') !== -1 && p.dropped.indexOf('photo') !== -1,
    'got ' + JSON.stringify(p.dropped) + ' — the failure in 2026 was not the token, it ' +
    'was that nothing was counting what it could not render');
  /* ⚠ {{name}} AND {{link}} ARE NOT "DROPPED" — they were carried. Counting them would
     make the card warn about the two tokens that worked. */
  check('but the two a text can carry are not counted as losses',
    p.dropped.indexOf('name') === -1 && p.dropped.indexOf('link') === -1,
    'got ' + JSON.stringify(p.dropped));
  /* ⚠ AND THE HOLE THEY LEAVE IS CLOSED UP. Five tokens removed from the middle of a
     sentence leave five runs of spaces, which is what the customer would read. */
  check('and the gaps they leave do not reach the customer',
    !/ {2,}/.test(p.text) && !/\n{3,}/.test(p.text) && p.text === p.text.trim(),
    'got ' + JSON.stringify(p.text));
  /* ⚠ HTML IS STRIPPED TOO. The templates are written in a rich editor, so a body
     picked out of that list carries tags — and a text has no tags, it has characters. */
  const html = api('RSVP Text', true,
    [tmpl('RSVP Text', '<p>Hi <b>{{name}}</b>,<br>lights this year?</p>')])
    .parts({ name: 'Nora' }, LINK);
  check('HTML in the body arrives as words, not as code',
    html.text.indexOf('<') === -1 && /^Hi Nora,\nlights this year\?/.test(html.text),
    'got ' + JSON.stringify(html.text));
}

/* ================================= 5. the counter, and who it is about
 * ⚠ A TEMPLATE SHE CAN EDIT CAN CROSS 160 WITH NOTHING GOING RED, which is the whole
 * reason the count is on screen. So the count has to be about the person it breaks
 * for, not whoever happens to sort first.
 * ====================================================================== */
if (api) {
  const a = api('', true, []);
  check('a message inside one segment is billed as one', a.segs('x'.repeat(160)) === 1,
    '160 is the boundary, not 159');
  check('and one character more is billed as two', a.segs('x'.repeat(161)) === 2,
    'the boundary is what the warning turns on');

  const longest = lift(admin, 'rsvpTextLongestNameOn');
  check('the card has a rule for whose name the count is about', !!longest,
    'a count taken from the first customer on the list says nothing about whether ' +
    'the send fits — the name is the only part that varies');
  if (longest) {
    const pick = new Function(lift(admin, 'properName') + '\n' + lift(admin, 'firstName') +
      '\n' + longest + '\nreturn rsvpTextLongestNameOn;')();
    const book = [{ data: { name: 'Al Short' } },
                  { data: { name: 'Christopherjames Vanderhoeven' } },
                  { data: { name: 'Bo Mid' } }];
    check('and it finds the longest first name, not the first or the last row',
      pick(book).name === 'Christopherjames Vanderhoeven',
      'got ' + JSON.stringify(pick(book)) + ' — a fixture where the longest name sorts ' +
      'first proves nothing, so this one puts it in the middle');
    check('and an empty list answers nobody rather than throwing',
      pick([]) === null, 'the card draws before the book has loaded');
  }
}

/* ============================ 6. the card, and the paths that reach a customer
 * ⚠ SOURCE CHECKS, AND THEY SAY SO. Everything above RUNS; this section can only
 * read, and what it reads is the WIRING — which this repo has been caught by three
 * times, most recently with a referral block that was in the source and could never
 * reach the screen.
 * ====================================================================== */
{
  const code = stripComments(admin);

  check('the preview and the Copy button ask the same rule',
    (code.match(/rsvpTextMessageParts\s*\(/g) || []).length >= 4,
    'a preview with its own idea of the wording is a card that shows one message and ' +
    'puts another on the clipboard — and the clipboard is the half that reaches a customer');

  /* ⛔ THE ONE THAT WOULD REACH A CUSTOMER. Both copy paths must refuse while the
     templates are loading; either one left unguarded is the silent wrong-wording send. */
  /* ⚠ SCOPED TO THE LIST RENDERER, WHICH IS WHERE THAT BUTTON IS WIRED. The first
     draft sliced from data-rsvptext= to the next mention of rsvpTextCopyAll, which ran
     8439 characters and swallowed renderRsvpTextPreview — whose own guard is spelled
     the same, so deleting the button's guard passed. A window that reaches a neighbour
     is the trap CLAUDE.md §7 names, in this file's own red-check. */
  const listRender = stripComments(lift(admin, 'rsvpTextRender'));
  check('the list renderer is findable', !!listRender,
    'without it the three checks below read an empty string and pass on nothing');
  check('the per-row Copy button refuses while the templates are loading',
    /data-rsvptext/.test(listRender) && /source === 'loading'/.test(listRender),
    'without it the fallback puts the built-in sentence on the clipboard and nothing says so');
  /* ⚠ AND THE PREVIEW FOLLOWS THE LIST. It is built from this same list — the sample
     customer and the longest name on it — so a renderer that does not redraw it shows
     a count belonging to whoever was on screen last. Asserted HERE rather than by
     finding the call anywhere in the file: loadRsvpTextSettings and the templates
     snapshot both call it too, so a file-wide search passes with this one deleted. */
  check('and drawing the list redraws the picker and the preview',
    /renderRsvpTextTemplatePicker\s*\(\s*\)/.test(listRender) &&
    /renderRsvpTextPreview\s*\(\s*\)/.test(listRender),
    'the preview counts characters for the longest name on the list it is drawn beside');
  const all = lift(admin, 'rsvpTextCopyAll');
  check('and so does Copy them all', /source === 'loading'/.test(stripComments(all)),
    'the bulk path is the one that reaches several hundred people in a press');
  /* ⚠ AND IT ASKS BEFORE IT MINTS ANYTHING. Checked inside the loop it would write a
     portal token to every customer on the list and then refuse. */
  check('and it asks before it writes a single token',
    stripComments(all).indexOf("source === 'loading'") <
    stripComments(all).indexOf('rsvpTextTokenFor'),
    'checked inside the loop it writes to the whole list and then refuses');
  /* ⚠ AND THE BULK PRESS SAYS WHICH WORDING WENT. It is the one path with no preview
     next to it, so the status line is the only place it can be said. */
  check('and the bulk press names the wording that went out',
    /wording\.source === 'template'/.test(stripComments(all)),
    'nothing should fail quietly — a fallback nobody is told about is one nobody fixes');

  /* ⚠ THE PREVIEW MUST NOT WRITE. Drawing a list is not a reason to write to a few
     hundred customer records; generatePortalToken is pure, rsvpTextTokenFor is not. */
  const preview = stripComments(lift(admin, 'renderRsvpTextPreview') + '\n' +
                                lift(admin, 'rsvpTextPreviewLink'));
  check('drawing the preview mints no tokens',
    !/rsvpTextTokenFor/.test(preview) && /generatePortalToken\s*\(/.test(preview),
    'a panel that edits the book by being looked at is the kind of thing nobody suspects');

  /* ⚠ AND THE WIRING IS ASSERTED SEPARATELY FROM THE MECHANISM. Every behavioural
     check above runs the rules from this file's own harness, so deleting the calls
     from the page would leave all of them green and nothing on screen. */
  /* ⚠ THE MARKUP IS READ OFF THE RAW FILE, NOT THE STRIPPED COPY, and the first draft
     of this check failed on a correct page because of it: stripComments runs over the
     whole of admin.html, and a /* inside a string somewhere above line 4000 opens a
     comment that swallows the card's own markup. The comment-stripping rule is about
     not reading PROSE as code; a tag name is not prose, and a tag is matched here with
     its element so a sentence mentioning the id cannot stand in for it. */
  check('the card draws its own picker and preview',
    /renderRsvpTextTemplatePicker\s*\(\s*\)/.test(code) &&
    /renderRsvpTextPreview\s*\(\s*\)/.test(code) &&
    /<select id="rsvpTextTmpl"/.test(admin) &&
    /<div id="rsvpTextPreview"/.test(admin),
    'the mechanism can be perfect and reach nobody');
  /* ⚠ AND THE TEMPLATE SNAPSHOT REDRAWS IT, for the same reason the quote pickers are
     redrawn there: an edit to the template she picked has to reach the preview, or the
     card goes on showing words that are no longer in it. */
  const loader = lift(admin, 'loadEmailTemplates');
  check('a change to the templates redraws the picker and the preview',
    /renderRsvpTextTemplatePicker/.test(loader) && /renderRsvpTextPreview/.test(loader),
    'a rename, a deletion or an edit has to reach a card that claims to be live');
  /* ⚠ A CALL, NOT A MENTION. `loadRsvpTextSettings()` matches its own DECLARATION —
     `async function loadRsvpTextSettings(){` contains those exact characters — so the
     first draft passed with the call deleted from start-up. Declarations are subtracted
     rather than the match being loosened. */
  const loadCalls = (code.match(/(?:^|[^.\w])loadRsvpTextSettings\s*\(/g) || []).length -
                    (code.match(/function\s+loadRsvpTextSettings\s*\(/g) || []).length;
  check('and the choice is loaded at start-up', loadCalls >= 1,
    'unloaded, rsvpTextTemplateName is "" and every book silently falls back to the ' +
    'built-in wording however carefully she picked one');

  /* ⚠ THE CHOICE IS A SETTING, NOT A COLLECTION. settings/{id} is already open to
     signed-in staff; a new collection is denied by default and fails SILENTLY in a
     listener, which is [[MSG-15]]'s own note. */
  /* ⚠ THE READ AND THE WRITES, NOT JUST ONE END. The first draft tested only that
     the string appeared somewhere, so a red-check that repointed the LOADER alone
     passed — and a choice written to one place and read from another is a picker that
     silently forgets every selection, which is exactly the shape this file exists to
     catch. Three sites: the loader, the change handler, and the make button. */
  const settingsDoc = (code.match(/doc\(db,'settings','rsvpText'\)/g) || []).length;
  check('the choice is stored in settings, where staff can already write',
    settingsDoc >= 3,
    'got ' + settingsDoc + ' of the three sites — a new collection needs a hand-run ' +
    'firestore:rules deploy that CI does not do, and fails SILENTLY in a listener');
  check('and it is read back from the same place it is written',
    /getDoc\(doc\(db,'settings','rsvpText'\)\)/.test(stripComments(lift(admin, 'loadRsvpTextSettings'))),
    'read from anywhere else, the picker forgets every choice and every book quietly ' +
    'falls back to the built-in wording');

  /* ⚠ AND THE BUTTON THAT MAKES ONE NEVER OVERWRITES HERS. Pressed twice, the second
     press must pick the template she has edited rather than putting the shipped
     wording back over the top of it. */
  const make = code.slice(code.indexOf("getElementById('rsvpTextMakeTmplBtn')"));
  check('making the template never overwrites one that exists',
    /if\(!getEmailTemplateByName\(RSVP_TEXT_TEMPLATE_NAME\)\)/.test(
      make.slice(0, make.indexOf('loadRsvpTextSettings') + 1 || make.length)) ||
    /if\(!getEmailTemplateByName\(RSVP_TEXT_TEMPLATE_NAME\)\)/.test(make.slice(0, 2500)),
    'a second press would put the shipped wording back over her own edits');
  check('and it seeds it with the built-in wording',
    /body: RSVP_TEXT_DEFAULT_BODY/.test(make.slice(0, 2500)),
    'a blank template is a blank page to write from; the point is that the first thing ' +
    'she opens is the message that has been going out');
}

/* ------------------------------------------------------------------ summary */
console.log('');
console.log('rsvp-text-wording — what the RSVP text actually says');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('');
  failures.forEach(f => console.log('  - ' + f));
  process.exitCode = 1;
}
console.log('');
