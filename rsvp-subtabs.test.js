/*
 * THE RSVP TAB'S SUB-TABS
 *
 * Addie, 2026-09-11: "at the top we got a lot going on. We can probably move
 * emails that didn't get sent out over to RSVP in it's own sub tab. And Text the
 * RSVP can go in it's own sub tab as well in RSVP."
 *
 * ⚠ THIS IS A LAYOUT CHANGE WITH ONE BEHAVIOURAL TRAP IN IT, and the trap is the
 * only reason this file exists. The Automation tab handler clears `active` from
 * EVERY `.route-tab-btn` and `.route-tab-panel` under #panel-automation — a
 * panel-wide query. Reusing those class names for the sub-tabs would leave the
 * RSVP tab opening with no sub-panel active at all: a blank tab, which reads as
 * the feature being broken rather than as a naming collision. The obvious future
 * "tidy-up" is to rename these to match, so it is asserted rather than trusted.
 *
 * ⚠ IT RUNS THE SWITCHER against jsdom rather than matching its source, because
 * every claim here is about WHICH PANEL IS ON SCREEN.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}
function lift(name) {
  let i = admin.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find ' + name);
  let depth = 0, started = false;
  for (let j = admin.indexOf('{', i); j < admin.length; j++) {
    if (admin[j] === '{') { depth++; started = true; }
    else if (admin[j] === '}') { depth--; if (started && depth === 0) return admin.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}

console.log('\n=== The RSVP tab\'s sub-tabs ===\n');

/* ---------------- the collision, which is the whole point ---------------- */
{
  /* The sub-tab markup, sliced from the RSVP panel's opening to the Invoices tab. */
  const from = admin.indexOf('id="automationtab-rsvpdrip"');
  const to = admin.indexOf('id="automationtab-invoices"');
  const panel = admin.slice(from, to);
  check('the RSVP panel really does hold the three sub-panels',
    /id="rsvpsub-daily"/.test(panel) && /id="rsvpsub-failed"/.test(panel) &&
    /id="rsvpsub-text"/.test(panel),
    'renamed? update this file rather than deleting it');
  check('the two moved cards are inside the RSVP panel now, not on Templates',
    panel.indexOf('id="sendFailureCard"') !== -1 && panel.indexOf('id="rsvpTextCard"') !== -1,
    'that is the move she asked for');
  /* ⚠ SCOPED TO THE TEMPLATES PANEL, and deliberately NOT widened to "this id appears
     once in the whole file". A red-check that pasted a second rsvpTextCard OUTSIDE the
     panel passed here and was caught by run-all.js Suite 1's duplicate-id check instead,
     which is where that belongs — §9.1 says not to duplicate a check across the three
     systems. This one answers "did the card really leave Templates"; that one answers
     "is any id written twice anywhere". */
  const templates = admin.slice(admin.indexOf('id="automationtab-templates"'), from);
  check('and they are no longer on the Templates tab (not left in both places)',
    templates.indexOf('id="sendFailureCard"') === -1 &&
    templates.indexOf('id="rsvpTextCard"') === -1,
    'a card in two places is two ids, and getElementById takes the first');
  /* ⚠ THE COLLISION. */
  check('the sub-tab buttons do NOT use the class the Automation handler sweeps',
    !/class="[^"]*\broute-tab-btn\b[^"]*"[^>]*data-rsvptab/.test(panel) &&
    /class="rsvp-subtab-btn/.test(panel),
    'the panel-wide clear would strip them and the RSVP tab would open blank');
  check('nor do the sub-panels use the swept panel class',
    !/class="[^"]*\broute-tab-panel\b[^"]*"[^>]*id="rsvpsub-/.test(panel) &&
    /class="rsvp-subtab-panel"/.test(panel));
  check('the sub-tab classes are styled, so they are not invisible buttons',
    /\.rsvp-subtab-btn\{/.test(admin) && /\.rsvp-subtab-btn\.active\{/.test(admin));
}

/* ---------------- the switcher, run ---------------- */
let jsdom = null;
try { jsdom = require('jsdom'); } catch (e) { /* reported below */ }
if (!jsdom) {
  console.log('  NOTE  jsdom is not installed — run `npm install`. The behavioural half did not run.');
} else {
  const { JSDOM } = jsdom;
  const dom = new JSDOM(
    '<div id="panel-automation">' +
    '<button class="rsvp-subtab-btn active" data-rsvptab="daily">Daily send</button>' +
    '<button class="rsvp-subtab-btn" data-rsvptab="failed">Did not send' +
    '<span id="rsvpSubtabFailedCount" hidden></span></button>' +
    '<button class="rsvp-subtab-btn" data-rsvptab="text">Text the RSVP</button>' +
    '<div class="rsvp-subtab-panel" id="rsvpsub-daily"></div>' +
    '<div class="rsvp-subtab-panel" id="rsvpsub-failed" hidden></div>' +
    '<div class="rsvp-subtab-panel" id="rsvpsub-text" hidden></div>' +
    '</div>');
  let drew = 0;
  const api = new Function('document', 'renderSendFailureCard', `
    let rsvpSubtab = 'daily';
    ${lift('rsvpSubtabShow')}
    return { show: rsvpSubtabShow, at: () => rsvpSubtab };
  `)(dom.window.document, () => { drew++; });

  const shown = () => ['daily', 'failed', 'text']
    .filter(k => !dom.window.document.getElementById('rsvpsub-' + k).hidden);
  const lit = () => Array.from(dom.window.document.querySelectorAll('.rsvp-subtab-btn.active'))
    .map(b => b.getAttribute('data-rsvptab'));

  api.show('text');
  check('picking a sub-tab shows exactly that one panel',
    shown().length === 1 && shown()[0] === 'text', shown().join(','));
  check('and exactly one button is lit',
    lit().length === 1 && lit()[0] === 'text', lit().join(','));
  api.show('failed');
  check('switching moves both the panel and the highlight together',
    shown()[0] === 'failed' && lit()[0] === 'failed',
    'a lit tab over the wrong panel is the shape the folder badge already had once');
  check('opening the failures sub-tab redraws the list',
    drew > 0,
    'rendered by a listener that has usually already fired — stale or empty otherwise');
  /* ⚠ A BAD NAME MUST NOT LEAVE EVERY PANEL HIDDEN. Whatever calls this later — a
     saved preference, a deep link — an unknown value falls back to the first tab
     rather than to a blank screen. */
  api.show('nonsense');
  check('an unknown sub-tab falls back to Daily send rather than showing nothing',
    shown().length === 1 && shown()[0] === 'daily', shown().join(','));
  check('and the remembered sub-tab follows what is on screen',
    api.at() === 'daily', api.at());
}

/* ---------------- the count, which is what replaces the hidden card -------- */
{
  const src = lift('renderSendFailureCard');
  /* ⚠ THE CARD USED TO HIDE ITSELF UNTIL A SEND LOST SOMEBODY, and its own note says
     why: it has to be noticed on the DAY it appears, because until those people are
     emailed they cannot RSVP and an unanswered customer is out of the season. Behind
     a sub-tab that hiding is worse than useless, so the tab wears the number. */
  check('the failure count is written onto the sub-tab',
    /rsvpSubtabFailedCount/.test(src),
    'otherwise the card is hidden behind a tab nobody has a reason to open');
  check('the badge is hidden when there is nothing to report',
    /badge\.hidden\s*=\s*!passes\.length/.test(src),
    'a permanent 0 beside a tab reads as a broken counter');
  check('and the empty sub-tab says so rather than looking broken',
    /rsvpNoFailuresNote/.test(src) && /id="rsvpNoFailuresNote"/.test(admin));
  check('the card still hides itself when there are no failures',
    /if\(!passes\.length\)\{ card\.hidden = true; return; \}/.test(src));
  /* ⚠ AND THE BADGE IS SET BEFORE THAT EARLY RETURN, or it never clears.
     ⚠ THE FIRST VERSION OF THIS CHECK WAS VACUOUS AND THE RED-CHECK CAUGHT IT: it
     measured where `rsvpSubtabFailedCount` first appears, which is the getElementById
     LOOKUP — and the lookup stays put when the write is moved. It measures the WRITE
     now. A check pinned to a name rather than to the statement that matters is the
     same shape as the slow-fuse checks §7 names. */
  check('the badge is updated before the early return, so it clears when fixed',
    src.indexOf('badge.textContent') !== -1 &&
    src.indexOf('badge.textContent') < src.indexOf('card.hidden = true'),
    'set after the return, a badge would stick on the last number for ever');
}

/* ---------------- the handler is actually wired ---------------- */
{
  check('the sub-tab buttons are wired to the switcher',
    /querySelectorAll\('\[data-rsvptab\]'\)/.test(admin) &&
    /rsvpSubtabShow\(this\.getAttribute\('data-rsvptab'\)\)/.test(admin),
    'a rendered button with no listener looks identical to a working one');
  /* ⚠ THE LINE THAT MAKES THE WHOLE THING SURVIVE THE PANEL-WIDE CLEAR. */
  const auto = admin.slice(admin.indexOf("document.querySelectorAll('[data-automationtab]')"));
  const body = auto.slice(0, auto.indexOf('async function loadEmailjsSettings'));
  check('opening the RSVP tab re-asserts the sub-tab state',
    /rsvpSubtabShow\(rsvpSubtab\)/.test(body),
    'without this the RSVP tab opens with whichever sub-panel was last showing, or none');
}

/* ---------------- nothing promises the cards are still on Templates -------- */
{
  check('the Templates copy no longer says the no-email list is underneath it',
    admin.indexOf('listed underneath for texting') === -1,
    'it points at RSVP → Text the RSVP now — copy that names a place it is not is worse than none');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
