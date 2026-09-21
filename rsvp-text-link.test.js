/*
 * One link, three answers — the text-message RSVP
 * Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Addie, 2026-09-21: "We need to send out a text message RSVP which means we need
 * one link which will take people to a page that says Yes, Back Next year and No."
 *
 * ⭐ THE EMAIL RSVP IS THREE LINKS AND A TEXT CANNOT BE. The email carries
 * {{rsvp_yes_button}}, {{rsvp_no_button}} and {{rsvp_back_button}} — three addresses
 * hidden behind three words. A text message is plain characters: it can hide nothing
 * behind anything, and three near-identical 50-character URLs in a body billed in
 * 160-character segments is both unreadable and two messages. So the text carries ONE
 * address, `/a/<token>`, and the PAGE carries the three answers.
 *
 * ⛔ THE CHECK THAT EARNS THE FILE IS THE ROUND TRIP. The address is ONE CLAIM WRITTEN
 * TWICE — `rsvpTextLinkFrom` in admin.html BUILDS it, and a reader in index.html PARSES
 * it — in two files that nothing else compares. Change the path on one side and the
 * office goes on texting several hundred customers a link that opens the marketing
 * site, with every other gate in this repo green and no error anywhere. So this file
 * feeds the builder's own output into the page's own reader and requires the token
 * back. That is the shape this repo keeps getting bitten by: the towns list in
 * search-visibility, the bins count on two sheets, {{photo}} in two renderers.
 *
 * ⛔ AND THE SECOND ONE IS THE CONFIRM-TAP BYPASS. `rsvpAwaitConfirmTap` exists because
 * a corporate mail scanner really did fetch `rsvp=no` and `rsvp=back` for two customers
 * on work addresses, at 3:42am, and only an unrelated failure stopped a paying customer
 * being moved to Maybe Next Year. The answer page taps through that guard with
 * {tapped:true}, because the customer has just tapped a button we drew — so the one
 * thing that must never become reachable is a route from the ADDRESS to that flag.
 * Everything in §4 is about that, and those are the checks to keep if the rest of this
 * is ever rewritten.
 *
 * ⚠ handleRsvpLink AND handleBackNextYear ARE STUBBED HERE, DELIBERATELY, AGAINST THIS
 * REPO'S USUAL LIFT-NOT-STUB RULE. The claim under test is WHICH of them each button
 * calls and WITH WHAT — not what they then do, which is the email route's behaviour,
 * unchanged, and already covered by run-all.js and test/rsvp-link.spec.js. Lifting them
 * would drag in portalRsvp, the gate-code step and the portal loader and prove none of
 * this any better. The two names ARE asserted to exist, so a rename cannot leave these
 * stubs standing in for functions that are gone.
 *
 * R-018: one file, one job, wired into `npm test`.
 *
 * Run:  node rsvp-text-link.test.js      (or: npm run test:textrsvp)
 */

const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const index = read('index.html');
const admin = read('admin.html');
const redirects = read('_redirects');
const headers = read('_headers');
const robots = read('robots.txt');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* Match the code, never the prose describing it. Every name checked below also appears
   in the comment explaining it — Suites 58, 274, 275 and 300 each learned this
   separately, and CLAUDE.md §7 has the general form. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
          .replace(/<!--[\s\S]*?-->/g, ' ');
}

/* Lifts a function by name out of a source file, slicing to its closing brace at
   column 0 — the terminator every other harness here relies on. `async` first: matching
   only `function NAME(` hands back a body full of bare `await`, a parse error that kills
   the whole file as one unattributable crash (CLAUDE.md §5). */
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

/* ================================================================ 1. the plumbing
 * Four files have to agree that /a/ is a thing, and each one is silent on its own:
 * no rewrite is a 404 on every link the office texted; no no-cache header is a
 * stale copy of the app answering a live link; no Disallow is a crawler fetching
 * the page that decides whether somebody gets a crew.
 * ============================================================================== */
check('_redirects rewrites /a/* to the app',
  /^\/a\/\*\s+\/index\.html\s+200\s*$/m.test(redirects),
  'without it Netlify has no file at that address and every texted link is a 404');
check('_headers keeps /a/* out of the browser cache',
  /^\/a\/\*\s*$/m.test(headers),
  'it is index.html under another address, matching neither /index.html nor / — ' +
  'so without this line it is the one address a browser may hold a stale copy of');
check('robots.txt keeps crawlers off /a/',
  /^Disallow: \/a\/\s*$/m.test(robots),
  'the token in that path is the whole of the credential in the customer\'s text');
/* ⚠ AND IT MUST NOT BECOME A SEARCH RESULT. /a/ is somebody's private link; the
   sitemap names marketing paths only, and search-visibility.test.js asserts it holds
   EXACTLY those. This is the same refusal it makes for /payment and /share. */
check('and /a/ is not published in the sitemap',
  read('sitemap.xml').indexOf('/a/') === -1,
  'publishing a token path invites exactly the fetch the Disallow above forbids');

/* ========================================================= 2. the round trip
 * The address, built in admin.html and parsed in index.html. See the header.
 * ========================================================================== */
const linkFn = lift(admin, 'rsvpTextLinkFrom');
check('admin.html still has rsvpTextLinkFrom', !!linkFn,
  'the office builds the texted address here; without it there is nothing to compare');

/* The page's own reader, taken out of index.html rather than retyped here. A pattern
   written in this file would agree with itself and say nothing about what ships. */
const readerPat = (stripComments(index)
  .match(/m\s*=\s*(\/\^\\\/a\\\/[^\n]*?)\.exec\(/) || [])[1];
check('index.html still has the /a/ reader, and its pattern is findable', !!readerPat,
  'nothing turns the rewritten path back into a route');

if (linkFn && readerPat) {
  const buildLink = new Function(linkFn + '\nreturn rsvpTextLinkFrom;')();
  const re = new Function('return ' + readerPat + ';')();
  /* ⚠ A REAL-LENGTH TOKEN, READ OFF THE GENERATOR, not a short invented one. run-all's
     own S287 was caught by a six-character fixture that passed while the shipped text
     ran to 172 characters. */
  const tokLen = Number(((lift(admin, 'generatePortalToken') || '')
    .match(/i\s*<\s*(\d+)\s*;/) || [])[1]) || 0;
  check('the token length is read off the generator', tokLen > 0,
    'without it this file is guessing at the number that decides whether a text fits');
  const tok = 'a1b2c3d4e5f6g7h8i9j0'.slice(0, tokLen || 20);
  const url = buildLink(tok);

  const pathOf = u => u.replace(/^https?:\/\/[^/]+/, '');
  const m = re.exec(pathOf(url));
  check('the page reads back the exact token the office put in the text',
    !!m && m[1] === tok,
    'admin built ' + JSON.stringify(url) + ' and the reader got ' +
    JSON.stringify(m && m[1]) + '. These are one address written in two files, and a ' +
    'mismatch is several hundred customers sent a link that opens the marketing site');
  check('and the two agree on the path, not merely on the token',
    pathOf(url) === '/a/' + tok,
    'got ' + JSON.stringify(pathOf(url)));

  /* ⚠ THE READER MUST REFUSE WHAT IS NOT A LINK, or a bare /a/ mints an empty token and
     the customer is told their link is broken when they never had one. */
  check('a bare /a/ and a nested path are not links',
    re.exec('/a/') === null && re.exec('/a/' + tok + '/extra') === null,
    'an empty or nested match would send a token of "" to portalRsvp');
  check('and a trailing slash still is one',
    (re.exec('/a/' + tok + '/') || [])[1] === tok,
    'phones and messaging apps add one; it is the same link');

  /* ⚠ AND THE WHOLE POINT OF THE SHORTENING. The text is held to one 160-character
     segment by run-all's S287, and the address is most of what it spends. */
  /* ⚠ THIS USED TO LIFT rsvpTextMessageFor AND RUN IT, and it died with a bare
     "rsvpTextMessageParts is not defined" the day [[EM-23]] made the wording a template
     she edits — the extraction trap, and the whole of `npm test` went down with it.
     ⛔ IT WAS REPOINTED RATHER THAN GIVEN THE CHAIN. Lifting six more functions in here
     would make this file a second opinion about the WORDING, which is not its job and
     is exactly what rsvp-text-wording.test.js owns — including the long-name case this
     check used to make. What belongs here is the ADDRESS, so that is what it asserts:
     how much of the one segment the link spends, which is a property of the link alone
     and cannot go stale when she edits a template. */
  check('the address leaves room for a sentence in the same message',
    160 - url.length >= 100,
    'got ' + url.length + ' characters of address, leaving ' + (160 - url.length) +
    ' for the words — under that there is no wording she could pick that fits');
  check('and the new link is shorter than the portal one it replaced',
    url.length < ('https://highlightingutah.com/#/payment?token=' + tok).length,
    'the move was partly to buy characters back; got ' + url.length);
}

/* ============================================== 3. the page, run against a real DOM
 * Every claim here is about a BUTTON THAT EXISTS and WHAT IT CALLS, which a regex
 * cannot see — this repo has shipped a message that was in the source and could never
 * reach the screen at least three times.
 * ============================================================================== */
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }

const askFn = lift(index, 'handleRsvpAsk');
check('index.html has handleRsvpAsk', !!askFn,
  'the page the one link opens');
/* ⚠ NAMED SO THE STUBS BELOW CANNOT STAND IN FOR FUNCTIONS THAT ARE GONE. */
check('and the two handlers it delegates to are still there',
  /function handleRsvpLink\(/.test(index) && /function handleBackNextYear\(/.test(index),
  'a renamed handler would leave the stubs in this file testing nothing');

/* The real card markup, sliced out of index.html by its id and balanced on <div>.
   Hand-written markup here would pass whether the shipped page had the buttons or
   not — the vacuous-fixture trap CLAUDE.md names in four places. */
function sliceCard(id) {
  const at = index.indexOf('id="' + id + '"');
  if (at === -1) return '';
  const start = index.lastIndexOf('<div', at);
  let depth = 0, i = start;
  const tag = /<\/?div\b/g;
  tag.lastIndex = start;
  let mm;
  while ((mm = tag.exec(index))) {
    depth += mm[0] === '<div' ? 1 : -1;
    i = mm.index;
    if (depth === 0) break;
  }
  const close = index.indexOf('>', i);
  return index.slice(start, close + 1);
}
const cardHtml = sliceCard('rsvpConfirmCard');
check('the answer card markup is findable', !!cardHtml && cardHtml.indexOf('rsvpAskRow') !== -1,
  'the three buttons live inside #rsvpConfirmCard');

/* ⚠ THE THREE BUTTONS ARE CHECKED BY NAME, AND SO ARE THEIR WORDS. Addie asked for a
   page "that says Yes, Back Next year and No" — the email's three words, which is what
   makes a texted answer and an emailed one plainly the same question. */
if (cardHtml) {
  [['rsvpAskYesBtn', '>Yes<'], ['rsvpAskBackBtn', '>Back Next Year<'], ['rsvpAskNoBtn', '>No<']]
    .forEach(([id, words]) => {
      check('the card carries ' + id + ' reading ' + words,
        cardHtml.indexOf('id="' + id + '"') !== -1 && cardHtml.indexOf(words) !== -1,
        'got: ' + (cardHtml.match(/id="rsvpAsk\w+"/g) || []).join(', '));
    });
  /* ⚠ ITS OWN ROW. #rsvpConfirmBtnRow is reused AFTER an answer for the portal buttons,
     so sharing it would put "Yes, Take Me to My Portal" beside an unanswered "No". */
  check('and they sit in their own row, hidden until the page asks',
    /id="rsvpAskRow"[^>]*display:none/.test(cardHtml),
    'a row that starts visible shows three answers to everybody the email route sends here');
}

if (JSDOM && askFn && cardHtml) {
  function runAsk(tapWhich) {
    const dom = new JSDOM('<!doctype html><body><div id="lookupFormWrap"></div>' + cardHtml + '</body>');
    const doc = dom.window.document;
    const calls = [];
    /* The two handlers are the recorders described in this file's header: the claim is
       WHICH one each button calls and with what, not what it then does. */
    const fn = new Function('document', 'window', 'console', 'CALLS',
      'var handleRsvpLink = function(){ CALLS.push(["link"].concat([].slice.call(arguments))); };' +
      'var handleBackNextYear = function(){ CALLS.push(["back"].concat([].slice.call(arguments))); };' +
      askFn + '\nreturn handleRsvpAsk;')(doc, dom.window, console, calls);
    fn('tok123');
    const row = doc.getElementById('rsvpAskRow');
    const shownBefore = row.style.display;
    if (tapWhich) doc.getElementById(tapWhich).click();
    return { doc, calls, shownBefore, row, body: doc.body };
  }

  const opened = runAsk(null);
  check('opening the link shows the three answers and asks the question',
    opened.shownBefore === 'flex' &&
    /having lights this season/i.test(opened.doc.getElementById('rsvpConfirmMsg').textContent),
    'row display was ' + JSON.stringify(opened.shownBefore) + ', message was ' +
    JSON.stringify(opened.doc.getElementById('rsvpConfirmMsg').textContent));
  /* ⛔ AND OPENING IT RECORDS NOTHING. This is the scanner case: a fetch can open the
     page, and must leave no answer behind. */
  check('and opening it on its own answers nothing at all',
    opened.calls.length === 0,
    'got ' + JSON.stringify(opened.calls) + ' — a page that answers on open is the ' +
    '3:42am mail-scanner bug the confirm tap was built for');

  const yes = runAsk('rsvpAskYesBtn');
  check('Yes hands to handleRsvpLink as a yes, already tapped',
    yes.calls.length === 1 && yes.calls[0][0] === 'link' &&
    yes.calls[0][1] === 'tok123' && yes.calls[0][2] === 'yes' &&
    yes.calls[0][3] && yes.calls[0][3].tapped === true,
    'got ' + JSON.stringify(yes.calls));
  const no = runAsk('rsvpAskNoBtn');
  check('No hands to handleRsvpLink as a no, already tapped',
    no.calls.length === 1 && no.calls[0][0] === 'link' &&
    no.calls[0][2] === 'no' && no.calls[0][3] && no.calls[0][3].tapped === true,
    'got ' + JSON.stringify(no.calls));
  /* ⚠ BACK NEXT YEAR IS A DIFFERENT FUNCTION AND A DIFFERENT PAGE. Its confirmation is
     #backNextYearConfirm inside #page-home, which only `rsvp-back` opens — without the
     class the customer watches this card sit unchanged while the answer records out of
     sight. That is the half a source check cannot see. */
  const back = runAsk('rsvpAskBackBtn');
  check('Back Next Year hands to handleBackNextYear, already tapped',
    back.calls.length === 1 && back.calls[0][0] === 'back' &&
    back.calls[0][1] === 'tok123' && back.calls[0][2] && back.calls[0][2].tapped === true,
    'got ' + JSON.stringify(back.calls));
  check('and it moves them to the page its confirmation is on',
    back.body.ownerDocument.body.className.indexOf('rsvp-back') !== -1,
    'got className ' + JSON.stringify(back.body.className) + ' — without rsvp-back the ' +
    'answer records on a screen the customer cannot see');

  /* ⚠ A DOUBLE TAP MUST NOT SEND TWO DIFFERENT ANSWERS. An impatient second tap on a
     phone lands on whatever is under the finger, which is a different button. */
  const twice = runAsk('rsvpAskYesBtn');
  twice.doc.getElementById('rsvpAskNoBtn').click();
  twice.doc.getElementById('rsvpAskYesBtn').click();
  check('a second tap after answering sends nothing more',
    twice.calls.length === 1,
    'got ' + JSON.stringify(twice.calls) + ' — the row must go and the handlers must be ' +
    'dropped, or a double tap answers twice and the last one wins');
  check('and the row is taken off screen once they have answered',
    twice.row.style.display === 'none',
    'got ' + JSON.stringify(twice.row.style.display));
} else if (!JSDOM) {
  console.log('  note: jsdom is not installed, so the page itself was not run — ' +
    'run `npm install` (CLAUDE.md §3: a skipped render check is not a pass)');
}

/* ================================================ 4. the bypass is unreachable
 * {tapped:true} switches off the guard that exists because a mail scanner really did
 * answer for two customers. The whole safety of it is that no address can produce it.
 * ============================================================================== */
const tapFn = lift(index, 'rsvpAwaitConfirmTap');
check('rsvpAwaitConfirmTap is still the one gate', !!tapFn,
  'both doors call it; a second copy is how one answer goes back to recording on open');
if (tapFn) {
  const body = stripComments(tapFn);
  check('it honours an already-made tap strictly, never on a truthy value',
    /opts\s*&&\s*opts\.tapped\s*===\s*true/.test(body),
    'a truthy test lets a stray string or a 1 from anywhere switch the guard off');
  /* ⛔ AND THE GUARD ITSELF IS INTACT. The tapped path is an addition; with no opts the
     function must still refuse to proceed until the button is pressed. */
  check('and with no options it still waits for the button',
    /btnEl\.onclick\s*=\s*function/.test(body) && /rowEl\.style\.display\s*=\s*'flex'/.test(body),
    'the email route must still require a tap — that is what this function is for');
  check('and it still fails towards not recording when the button is missing',
    /if\(!rowEl\s*\|\|\s*!btnEl\)/.test(body),
    'proceeding without a button silently restores the behaviour this was written to remove');
}

/* ⛔ THE ADDRESS CANNOT REACH THE FLAG. Three separate ways it could, each refused. */
/* ⚠ SLICED TO A STRUCTURAL ANCHOR, NEVER A CHARACTER COUNT. CLAUDE.md §7 bans a
   fixed-length extraction window by name and run-all.js enforces it: the first draft of
   this used 2000 characters, the new branch's own comment pushed the call past the end,
   and two checks below failed on code that is right. */
const routerSlice = (() => {
  const at = index.indexOf("var rsvp = params.get('rsvp');");
  if (at === -1) return '';
  const end = index.indexOf("} else if(hash === '/share')", at);
  return end === -1 ? '' : stripComments(index.slice(at, end));
})();
check('the router branch for the answer page is findable', !!routerSlice,
  'without it nothing below is actually looking at the router');
if (routerSlice) {
  check('the router hands handleRsvpAsk the token and nothing else',
    /handleRsvpAsk\(token\)/.test(routerSlice),
    'passing anything parsed from the query into that call is the one way an address ' +
    'could ever switch the confirm guard off');
  check('and it still calls handleRsvpLink with no options',
    /handleRsvpLink\(token,\s*rsvp\)\s*;/.test(routerSlice),
    'the email route must keep its confirm tap; a third argument here would remove it ' +
    'from every RSVP email link at once');
  /* ⚠ AND `ask` IS TESTED BEFORE THE PORTAL FALLBACK, which matches on the token alone —
     so an `ask` added after it signs the customer into their whole account and never
     draws the buttons, which is exactly what this link exists to stop.
     ⚠ THE CONDITION IS READ, NOT THE WORDS. The first draft asked only whether
     "rsvp === 'ask'" appeared before "loadPortalByToken", and the red-check walked
     straight through it: `if(false && rsvp === 'ask'` leaves every one of those words
     exactly where they were while the branch can never run, and the customer silently
     gets their whole account. That is the `if(false &&` trap CLAUDE.md records three
     times over — a text check cannot tell a live guard from a dead one. */
  const askCond = (routerSlice.match(/if\(([^)]*rsvp === 'ask'[^)]*)\)/) || [])[1] || '';
  check('the ask branch is a live guard on the token and the parameter',
    /\btoken\b/.test(askCond) && !/\bfalse\b/.test(askCond),
    'condition was ' + JSON.stringify(askCond) + ' — it must actually decide something');
  check('and rsvp=ask is tested before the sign-me-in fallback',
    !!askCond &&
    routerSlice.indexOf("rsvp === 'ask'") < routerSlice.indexOf('loadPortalByToken'),
    'ordered the other way the customer lands on their account, which is the page the ' +
    'one link exists to skip');
}
/* ⛔ AND NOTHING ANYWHERE TURNS A QUERY INTO THAT OBJECT.
   ⚠ IT CAPTURES THE VALUE RATHER THAN TESTING FOR THE ABSENCE OF ONE. The first draft
   was `/tapped\s*:\s*(?!true\b)/` and matched every correct line in the file: `\s*` is
   greedy but BACKTRACKS, so it gave back the space and the lookahead then ran against
   " true" and passed. A negative lookahead behind a variable-width match can almost
   always be satisfied by backtracking — capture and compare instead. */
const tappedValues = (stripComments(index).match(/tapped\s*:\s*[^,}\s]+/g) || [])
  .map(s => s.split(':')[1].trim());
check('every tapped flag in the page is the literal true, written at a call site',
  tappedValues.length > 0 && tappedValues.every(v => v === 'true'),
  'got ' + JSON.stringify(tappedValues) + ' — anything computed there is a route from ' +
  'the address to the switched-off guard');
/* ⚠ AND THE LINK NAMES NO ANSWER. `rsvp=yes` is answerable by a fetch; `ask` is not.
   ⚠ COMMENTS STRIPPED FIRST: the paragraph explaining this very rule contains both
   "/a/" and "rsvp=yes", so the unstripped version failed on a correct file — the
   Suite 58 trap, which this repo has now hit in six separate places. */
const codeOnly = stripComments(index);
check('the texted link asks rather than answering',
  /rsvp=ask/.test(codeOnly) && !/\/a\/[^'"]*rsvp=(yes|no|back)/.test(codeOnly),
  'an answer in the address is a thing a mail scanner can submit');

/* ========================================== 5. the referral offer ([[REF-43]])
 * The RSVP email carries {{referral_button}} whatever the customer answers, so an
 * emailed customer always has their link. A texted one has none: measured, the message
 * runs 129–143 characters and a second address takes it to 199–213, against a 160-
 * character segment — and two links in front of somebody who has one question to answer
 * is the thing /a/ was built to avoid. So the offer lives on the PAGE.
 *
 * ⛔ AND ONLY ON THE BACK NEXT YEAR CARD, because that is the only answer whose screen
 * is the end of the journey. A yes and a no are handed to the portal, which draws Refer
 * a Friend from the token portalLookup mints. Back Next Year never loads the portal —
 * so that customer, and only that customer, had no route to their own link at all.
 * ============================================================================== */
const fns = read('functions/index.js');

check('the text itself carries no referral link, deliberately',
  linkFn && !/\/r\//.test(lift(admin, 'rsvpTextMessageFor') || ''),
  'a second address takes the message past one 160-character segment and puts two ' +
  'links in front of somebody who has one question to answer — the offer is the page\'s job');
/* ⚠ [[REF-21]]'s RULE IS THAT AN RSVP SEND WITH NO OFFER IN IT SAYS SO. A referral that
   silently is not going out produced the same green "Done — sent 312" as one where
   everybody got theirs, and only reading the code could answer why. */
check('and the office is told where the offer appears instead',
  /The referral offer is not in the text/.test(admin) &&
  /Refer a Friend is a tab/.test(admin),
  'a send carrying no referral must say so before it goes, not leave it to be discovered');

/* ---- the server hands back a token, and only for the one answer that needs it ---- */
const rsvpFn = (() => {
  const at = fns.indexOf('exports.portalRsvp');
  if (at === -1) return '';
  const end = fns.indexOf('\n});', at);
  return end === -1 ? '' : fns.slice(at, end + 4);
})();
check('portalRsvp is findable', !!rsvpFn, 'nothing below is looking at the server');
if (rsvpFn) {
  const body = stripComments(rsvpFn);
  check('it returns a referral token only for Back Next Year',
    /response === 'backnextyear'[\s\S]{0,120}ensureReferralToken/.test(body) &&
    /referralToken:/.test(body),
    'a yes and a no go to the portal, which mints and draws its own — returning one ' +
    'for them is a field nobody reads, and minting one is a write nobody asked for');
  /* ⚠ THE SEASON RULE IS ensureReferralToken's AND IS NOT RE-DECIDED HERE. [[REF-25]]
     and [[REF-42]] govern what a link from a previous season is worth; minting a raw one
     would hand out a token that bypasses all of it. */
  check('and it mints through ensureReferralToken, never a bare generate',
    /ensureReferralToken\(match\.id, match\.data\)/.test(body) &&
    !/generateReferralToken\(/.test(body),
    'a raw token here would sidestep the season stamp every other referral path respects');
}

/* ---- the card, run against a real DOM ---- */
const backFn = lift(index, 'showBackReferral');
check('index.html has showBackReferral', !!backFn, 'the block the card draws');
const backHtml = sliceCard('backNextYearCard');
check('the Back Next Year card markup is findable',
  !!backHtml && backHtml.indexOf('backReferBlock') !== -1,
  'the offer lives inside #backNextYearCard');

/* ⚠ "NEXT SEASON'S", THE ONE WORD THAT DIFFERS FROM THE EMAIL'S OWN SENTENCE. [[REF-23]]:
   somebody who shares while sitting the season out has no bill this year, so their $25
   comes off the next one. This is the single audience for whom "this season" cannot be
   true, so the email's wording copied across would be a promise against a bill that will
   never exist. */
if (backHtml) {
  check('the offer says the $25 comes off NEXT season',
    /next season/i.test(backHtml) && !/off this season/i.test(backHtml),
    'REF-23: this customer has no bill this year, so "this season" is a discount ' +
    'against a bill that will never exist');
}

if (JSDOM && backFn && backHtml) {
  function runBack(token) {
    const dom = new JSDOM('<!doctype html><body>' + backHtml + '</body>');
    const doc = dom.window.document;
    const shared = [];
    /* portalReferralLink is LIFTED — the address is the thing under test, and a stub
       would let this card start handing out a link that differs from the portal's.
       portalShareLink is a recorder: what it does is the portal's behaviour, already
       proved there; what matters here is that the button reaches it at all. */
    const fn = new Function('document', 'window', 'SHARED',
      (lift(index, 'portalReferralLink') || '') +
      '\nvar portalShareLink = function(i, s){ SHARED.push(i && i.value); };' +
      backFn + '\nreturn showBackReferral;')(doc, dom.window, shared);
    fn(token);
    return { doc, shared, block: doc.getElementById('backReferBlock') };
  }

  const withTok = runBack('ab12cd34');
  check('a real token draws the offer with the portal\'s own address',
    withTok.block.style.display === 'block' &&
    /\/r\/ab12cd34$/.test(withTok.doc.getElementById('backReferLink').value),
    'got display ' + JSON.stringify(withTok.block.style.display) + ' and link ' +
    JSON.stringify(withTok.doc.getElementById('backReferLink').value));
  check('and the button hands the link to the portal\'s own share handler',
    (withTok.doc.getElementById('backReferShareBtn').click(), withTok.shared.length === 1 &&
     /\/r\/ab12cd34$/.test(withTok.shared[0])),
    'got ' + JSON.stringify(withTok.shared) + ' — a second share implementation here ' +
    'would be the one that breaks in the in-app browser a texted link opens in');

  /* ⛔ THE GUARD [[REF-21]] ASKS FOR: nothing rather than a dead link. */
  ['', null, undefined, '   '].forEach(t => {
    const none = runBack(t);
    check('no token (' + JSON.stringify(t) + ') draws no offer at all',
      none.block.style.display !== 'block',
      'a share box holding half an address is worse than no offer');
  });
}

/* ⚠ AND IT IS DRAWN AFTER THE ANSWER IS RECORDED, never before or on a failure. Above
   the confirmation it reads as something to do before their answer counts; on the error
   path it invites somebody to share a link while being told we could not save what they
   said. */
const backHandler = lift(index, 'handleBackNextYear');
if (backHandler) {
  const b = stripComments(backHandler);
  const call = b.indexOf('showBackReferral(');
  const okMsg = b.indexOf('look forward to seeing you next year');
  check('the offer is drawn only after the answer comes back ok',
    call !== -1 && okMsg !== -1 && call > okMsg,
    'it must sit inside the success branch, after the confirmation');
  check('and never on the failure path',
    !/catch\([\s\S]*showBackReferral/.test(b),
    'inviting somebody to share a link while telling them their answer was not saved');
}
/* ⛔ AND IT IS DRAWN FOR THAT ANSWER AND NO OTHER — asserted HERE because a browser spec
   cannot express it. One was written and the red-check proved it could not fail:
   #backReferBlock sits in #page-home, which `rsvp-minimal` without `rsvp-back` hides
   with !important, so on a yes it is invisible because its whole PAGE is rather than
   because anything decided not to draw it. Making the stub hand a token to every answer
   left every test green. This one bites: wire the call into handleRsvpLink — the tidy-up
   somebody will reach for, reasoning that everybody should see the offer — and it fails. */
const askFnBody = askFn ? stripComments(askFn) : '';
const linkHandler = lift(index, 'handleRsvpLink');
/* ⚠ THE DECLARATION IS NOT A CALL, and the first draft of this counted it as one and so
   failed on correct code — `function showBackReferral(` matches any "name followed by a
   bracket" pattern just as well as a call does. Subtract it rather than loosening the
   match, which would stop counting the calls too. */
const codeIdx = stripComments(index);
const refCalls = (codeIdx.match(/(?:^|[^.\w])showBackReferral\s*\(/g) || []).length -
                 (codeIdx.match(/function\s+showBackReferral\s*\(/g) || []).length;
check('showBackReferral is called from the Back Next Year handler and nowhere else',
  refCalls === 1 &&
  !/showBackReferral\s*\(/.test(askFnBody) &&
  !/showBackReferral\s*\(/.test(stripComments(linkHandler || '')),
  'a yes and a no are handed to the portal, which draws its own Refer a Friend tab — ' +
  'a second offer on the card would compete with it, and on those routes the card is ' +
  'torn down anyway, so it would be drawn where nobody can see it');

/* ------------------------------------------------------------------ summary */
console.log('');
console.log('rsvp-text-link — one link, three answers');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('');
  failures.forEach(f => console.log('  - ' + f));
  process.exitCode = 1;
}
console.log('');
