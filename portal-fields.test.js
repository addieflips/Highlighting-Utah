/* WHAT THE CUSTOMER'S OWN PAGE CAN ACTUALLY SEE
 * =============================================
 * `npm run test:portal-fields` — its own file per R-018.
 *
 * The member portal never touches Firestore directly. Everything it knows about a
 * customer comes back through `portalLookup` / `portalSave`, and both return
 * `sanitizeRecord(data)` — which copies across **only** the names in
 * `PORTAL_READ_FIELDS` and drops everything else. CLAUDE.md states the consequence in one
 * line: *"A field the client reads must be in that function's read whitelist or the
 * customer never sees it."*
 *
 * ⚠ AND IT FAILS AS `undefined`, WHICH IS THE WHOLE PROBLEM. There is no error. The
 * property is simply absent, `|| ''` and `|| 0` and `|| []` turn it into a plausible
 * empty, and the page renders as though the record genuinely held nothing.
 *
 * WHAT THIS FILE DOES, AND WHY IT IS THE OTHER DIRECTION
 * -----------------------------------------------------
 * There were already checks that specific named fields are in the whitelist —
 * `lightsLockedUntil`, `askSameAsLastYear`, `cannotBillNoEmail`, `scheduledDate`. Every
 * one asks *"is this listed field correct?"*, so **a field never put on the list is
 * absent from the question rather than answered wrongly**. That is the same blind spot
 * the dated-field census hit on 2026-08-29, in a second place.
 *
 * So this runs from the CODE back to the LIST: every property `index.html` reads off a
 * record that came through `sanitizeRecord` must either be whitelisted, or be named below
 * with the reason it is not. Silence is what let five of them sit.
 *
 * WHAT IT FOUND ON THE DAY IT WAS WRITTEN (2026-08-30)
 * ---------------------------------------------------
 * The member portal's **sides-changed re-quote**. A customer changes which sides of their
 * house are lit; the portal raises a quote and — per its own comment, and Addie's words
 * on 2026-08-18, *"we should be able to find what their old # was no matter what"* —
 * carries everything the old record knew so whoever prices it can hand back whatever
 * still fits. It reads five of those six values off `currentJobAddressData`, and
 * `customerNumber`, `measuredFeet`, `numberOfBins`, `lightColors` and `housePrice` are
 * **not** in `PORTAL_READ_FIELDS`. Measured by running the real `sanitizeRecord` over a
 * real record shape:
 *
 *     existingCustomerNumber: ''      existingNumberOfBins: 0
 *     existingMeasuredFeet:   0       existingLightColors:  []
 *     oldPrice:               0       existingLightsDescription: 'Warm White, Red'  ← the only survivor
 *
 * So the office's "On file" strip read **"On file: no number"** above an instruction
 * reading *"same number, same bin, same lights"* — and finding the number meant opening
 * All Customers, which is the one lookup that strip exists to save.
 *
 * ⚠ THE EXCLUSION IS RIGHT AND WAS NOT REVERSED. That whitelist's own comment names
 * *"pricing, customer number, bin assignments"* as things that never leave the server, and
 * a value the browser is handed only to echo back to us proves nothing anyway. The fix is
 * `requoteOnFile` in admin.html, which derives them from the live customer at render time
 * — which also fixes the staleness a stored snapshot always had.
 *
 * ⚠ TWO EXISTING CHECKS ASSERTED THOSE FIELD NAMES APPEAR IN THE PAYLOAD and passed
 * throughout, over a payload that could only ever send blanks. Naming a field is not
 * carrying a value, and that is the distinction this file exists to hold.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let passed = 0, failed = 0;
const failures = [];

function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++;
  failures.push({ name, why });
  console.log('  FAIL  ' + name + (why ? '\n        ' + why : ''));
}

const idx = read('index.html');
const fns = read('functions/index.js');

/* stripComments — LIFTED OUT OF run-all.js, NOT COPIED (the repo's "lift, don't stub"
   rule). It carries two hard-won fixes a fresh copy would not have: `/*` is only a
   comment after start-of-line, whitespace or one of ;{}()[], and `//` is only stripped
   when not preceded by a colon, so the 57 lines holding an https:// keep their tails.

   ⚠ IT IS HERE BECAUSE ONE OF THIS FILE'S OWN CHECKS CAUGHT ITSELF. The check that no
   notice says "we cannot bill you" failed on the COMMENT above the notice explaining why
   it must not say that — a test a comment can satisfy, and in this case fail, is not
   testing code. Suites 58, 274, 275 and import-build-flag each learned this separately. */
const stripComments = (function () {
  const suite = read('run-all.js');
  const start = suite.indexOf('const stripComments = s =>');
  if (start === -1) {
    throw new Error(
      'stripComments could not be found in run-all.js. It was lifted rather than copied ' +
      'so the two cannot drift; if it moved or was renamed, repoint this lift — do NOT ' +
      'paste a fresh copy in here.');
  }
  /* To the end of the statement, not a magic number: the declaration ends at the first
     `;` that closes it, which is the line holding the `//` replace. Same lift as
     import-build-flag.test.js, deliberately identical so both stay repointable together. */
  const end = suite.indexOf("'$1');", start);
  if (end === -1) throw new Error('stripComments was found but its end could not be located in run-all.js');
  // eslint-disable-next-line no-eval
  const fn = eval('(function(){ ' + suite.slice(start, end + "'$1');".length) + ' return stripComments; })()');
  if (typeof fn !== 'function') throw new Error('the lifted stripComments did not evaluate to a function');
  return fn;
})();
/* ⚠ THE LIFT IS WORTH NOTHING IF THE THING LIFTED NO LONGER STRIPS. Proven against a
   fixture rather than assumed — a helper that quietly returns its input makes every
   negative check below pass for free, which is this file's own worst failure mode. */
{
  const fixture = 'a: 1, /* cannot bill you */ b: 2, // cannot bill you\nvar url = "https://x/y";';
  const out = stripComments(fixture);
  check('the lifted stripComments really strips',
    !/cannot bill you/.test(out) && /b: 2/.test(out) && /https:\/\/x\/y/.test(out),
    'got: ' + out);
}
const idxCode = stripComments(idx);

/* ---------------------------------------------------------------------------
 * The landmarks, asserted before anything is derived from them. An extractor that has
 * quietly stopped matching reports NO violations — a green build for the worst possible
 * reason, and the same shape as a suite that cannot find its target and skips.
 * ------------------------------------------------------------------------- */
const listMatch = fns.match(/const PORTAL_READ_FIELDS = \[([\s\S]*?)\n\];/);
check('PORTAL_READ_FIELDS is findable in functions/index.js', !!listMatch,
  'renamed or removed — repoint this file rather than deleting it');

const WHITELIST = listMatch
  ? new Set(listMatch[1].match(/'([A-Za-z0-9_]+)'/g).map(s => s.slice(1, -1)))
  : new Set();
check('and it is not empty', WHITELIST.size > 10,
  'got ' + WHITELIST.size + ' — a whitelist read as empty would make every check below ' +
  'fail for the wrong reason');

check('sanitizeRecord is what filters it', /PORTAL_READ_FIELDS\.forEach/.test(fns),
  'if the filtering moves, this whole file is asserting a contract nothing enforces');
check('and every portal record goes through it',
  (fns.match(/record: sanitizeRecord\(/g) || []).length === 2,
  'portalLookup and portalSave. A third return path that skipped it would send the whole ' +
  'customer record to the browser — got ' +
  (fns.match(/record: sanitizeRecord\(/g) || []).length);

/* ---------------------------------------------------------------------------
 * WHICH VARIABLES HOLD A SANITISED RECORD.
 *
 * ⚠ SCOPED DELIBERATELY, AND THE EXCLUSIONS ARE NOT LAZINESS. `currentLookupRecord` comes
 * from `portalInvoice`, which has its OWN whitelist (`INVOICE_READ_FIELDS`) plus fields it
 * derives — `lightChangeFreeUntil` among them — so sweeping it against PORTAL_READ_FIELDS
 * would report a false hole on correct code, and a gate that cries wolf is one people
 * learn to click past. `rec` is `currentJobAddressData || currentLookupRecord || {}`, so
 * which whitelist applies depends on which one is populated at the time; it is not
 * decidable here and is deliberately left out rather than guessed at.
 *
 * `known` is the local `var known = opts.knownRecord || null` — the record `portalLookup`
 * already found, passed through as an option so the invoice page does not look it up a
 * second time. It is swept under its LOCAL name, because `knownRecord` only ever appears
 * as an object key and never with a property read after it, so sweeping that name finds
 * nothing at all and the check would pass over a holder it never examined.
 * ------------------------------------------------------------------------- */
const HOLDERS = ['currentJobAddressData', 'addrDoc', 'known'];

check('the holders this sweeps still exist in index.html',
  HOLDERS.every(h => idx.indexOf(h + '.') !== -1),
  'renamed: ' + HOLDERS.filter(h => idx.indexOf(h + '.') === -1).join(', '));
check('and each is assigned from a portalLookup/portalSave record',
  /currentJobAddressData = addrDoc/.test(idx) &&
  /addrDoc = lookupRes\.record/.test(idx) &&
  /var known = opts\.knownRecord/.test(idx),
  'if one of these ever holds a record read straight from Firestore, this sweep is ' +
  'asking the wrong whitelist about it');

/* ---------------------------------------------------------------------------
 * THE ALLOWED EXCEPTIONS. Each one names WHY it is read without being whitelisted.
 *
 * ⚠ AN EXCEPTION MUST STILL DESCRIBE SOMETHING. A name here that nothing in index.html
 * reads any more excuses nothing and hides the rename, so that is checked too — the same
 * rule `queue-date.test.js` applies to its own dormant-portal list.
 * ------------------------------------------------------------------------- */
const NOT_WHITELISTED = {
  portalToken:
    'NOT A READ AT ALL. `addrDoc.portalToken = lookupRes.token` puts the session token ' +
    'onto the object in the browser; it arrives beside the record, not inside it.',
  customerNumber:
    'DELIBERATELY SERVER-ONLY — named in PORTAL_READ_FIELDS\' own comment. The one place ' +
    'that reads it is the sides-changed re-quote payload, where it can only ever send "". ' +
    'admin.html derives it live through `requoteOnFile`; the stored value is the fallback ' +
    'for a quote whose customer has since gone.',
  housePrice:
    'DELIBERATELY SERVER-ONLY (pricing). It reaches `changed.oldPrice` as 0, which the ' +
    'quote card renders as the sentence being absent rather than as a false "$0.00" — so ' +
    'it degrades to silence, not to a wrong claim.',
  measuredFeet:
    'DELIBERATELY SERVER-ONLY. Same re-quote payload, same live-derivation fix.',
  numberOfBins:
    'DELIBERATELY SERVER-ONLY (bin assignments). Same re-quote payload, same fix.',
  lightColors:
    'DELIBERATELY SERVER-ONLY. `lightsDescription` IS whitelisted and is what the office ' +
    'actually reads, so the colours are not lost — only this second copy of them.'
};

/* ---------------------------------------------------------------------------
 * THE SWEEP.
 * ------------------------------------------------------------------------- */
const JS_BUILTINS = new Set(['length', 'map', 'filter', 'forEach', 'indexOf', 'slice',
  'join', 'trim', 'toLowerCase', 'toUpperCase', 'split', 'replace', 'push', 'concat',
  'hasOwnProperty', 'toString', 'charAt', 'substring', 'includes', 'sort', 'some',
  'every', 'find', 'keys', 'valueOf', 'match']);

const seen = new Map();   // property -> holders that read it
HOLDERS.forEach(h => {
  const re = new RegExp(h.replace(/\$/g, '\\$') + '\\.([A-Za-z0-9_]+)', 'g');
  let m;
  while ((m = re.exec(idx)) !== null) {
    if (JS_BUILTINS.has(m[1])) continue;
    if (!seen.has(m[1])) seen.set(m[1], new Set());
    seen.get(m[1]).add(h);
  }
});

check('the sweep found properties to check',
  seen.size >= 15,
  'found ' + seen.size + ' — a regex that has stopped matching reports no violations, ' +
  'which is a green build for the worst possible reason');

const unlisted = [...seen.keys()].filter(p => !WHITELIST.has(p)).sort();
const undeclared = unlisted.filter(p => !NOT_WHITELISTED[p]);

check('every property the portal reads is whitelisted, or says why not',
  undeclared.length === 0,
  undeclared.length
    ? 'these come back UNDEFINED and there is nothing on screen to say so: ' +
      undeclared.map(p => p + ' (read via ' + [...seen.get(p)].join(', ') + ')').join('; ') +
      '\n        Either add it to PORTAL_READ_FIELDS in functions/index.js, or — if it is ' +
      'deliberately server-only — add it to NOT_WHITELISTED here with the reason and make ' +
      'sure whatever displays it derives the value some other way.'
    : undefined);

const stale = Object.keys(NOT_WHITELISTED).filter(p => !seen.has(p));
check('and no exception names a property nothing reads any more',
  stale.length === 0,
  'stale: ' + stale.join(', ') + ' — an exception that describes nothing excuses nothing ' +
  'and hides the rename');

const pointless = Object.keys(NOT_WHITELISTED).filter(p => WHITELIST.has(p));
check('and no exception covers a property that IS whitelisted',
  pointless.length === 0,
  'now whitelisted, so the exception is misleading: ' + pointless.join(', '));

Object.keys(NOT_WHITELISTED).forEach(p => {
  check('the exception for ' + p + ' gives a reason',
    String(NOT_WHITELISTED[p]).length > 40,
    'a one-word reason is how the next person decides it was never important');
});

/* ---------------------------------------------------------------------------
 * THE SECOND SWEEP: the holders whose whitelist depends on where they were filled from.
 *
 * `currentLookupRecord` comes from `portalInvoice`, which sends `INVOICE_READ_FIELDS`
 * plus a handful it derives onto the record itself. `rec` is
 * `currentJobAddressData || currentLookupRecord || {}`, so WHICH list applies depends on
 * which one is populated at the time — not decidable from the source.
 *
 * ⭐ SO THE CLAIM IS WEAKER AND STILL WORTH MAKING: a property in NEITHER list can never
 * arrive from EITHER source, whichever one happened to fill it. That is a real hole with
 * no ambiguity in it. It came back clean on the day it was written, which is the point of
 * writing it now rather than after something breaks — this is the half that would
 * otherwise catch a field being quietly DROPPED from a whitelist that something still
 * reads, the reverse of the bug above and just as silent.
 * ------------------------------------------------------------------------- */
const invMatch = fns.match(/const INVOICE_READ_FIELDS = \[([\s\S]*?)\];/);
check('INVOICE_READ_FIELDS is findable too', !!invMatch,
  'the second sweep below cannot run without it, and a sweep that cannot run reports no ' +
  'violations');

const INVOICE_LIST = invMatch
  ? new Set(invMatch[1].match(/'([A-Za-z0-9_]+)'/g).map(x => x.slice(1, -1)))
  : new Set();
/* Fields portalInvoice attaches to the record after the whitelist copy — read out of the
   function rather than listed here, so a new one is covered the day it is added. */
const DERIVED = new Set((fns.match(/record\.([A-Za-z0-9_]+) =/g) || [])
  .map(x => x.slice('record.'.length, -2)));
check('and the fields portalInvoice derives are found', DERIVED.size > 0,
  'listing them here instead would be a second copy that stops matching');

const UNION = new Set([...WHITELIST, ...INVOICE_LIST, ...DERIVED]);
const AMBIGUOUS = ['rec', 'currentLookupRecord'];
const unionMisses = [];
AMBIGUOUS.forEach(h => {
  const re = new RegExp('\\b' + h + '\\.([A-Za-z0-9_]+)', 'g');
  let m;
  while ((m = re.exec(idx)) !== null) {
    if (JS_BUILTINS.has(m[1]) || UNION.has(m[1]) || NOT_WHITELISTED[m[1]]) continue;
    unionMisses.push(h + '.' + m[1]);
  }
});
check('nothing is read off a record that neither whitelist could have filled',
  unionMisses.length === 0,
  [...new Set(unionMisses)].join(', ') + ' — in neither PORTAL_READ_FIELDS nor ' +
  'INVOICE_READ_FIELDS, so it arrives undefined whichever call filled the record');

/* ---------------------------------------------------------------------------
 * THE OTHER DIRECTION: WHITELISTED AND NEVER READ.
 *
 * R-010's shape. Sending a field the page never looks at is not dangerous, but it means
 * any protection the whitelist's own comment CLAIMS for that field does not exist — and
 * the comment reads as though it does.
 *
 * ⭐ THAT IS NOT HYPOTHETICAL. `askSameAsLastYear` and `cannotBillNoEmail` are each in
 * the list with a comment saying they are there "so the portal cannot contradict the
 * office" / "so the portal cannot show a customer as settled while the office is chasing
 * them". Neither string appears anywhere in index.html. The flag arrives and nothing
 * looks at it, so the portal can still do both of those things. Two checks in run-all.js
 * assert only that the NAME is in the whitelist while their failure text describes the
 * protection — the P-001 shape, a rule stated as fact about a guard that was never built.
 *
 * ⚠ SO EACH ONE IS DECLARED WITH WHAT IS AND IS NOT TRUE OF IT. Silence is what let two
 * of them read as protections for months.
 * ------------------------------------------------------------------------- */
const WHITELISTED_UNREAD = {
  /* ⭐ askSameAsLastYear AND cannotBillNoEmail WERE HERE UNTIL 2026-08-30 and are
     deliberately gone. Both were "sent, never read" — each whitelisted with a comment
     claiming a protection that nothing in index.html implemented (Q-028). Addie: "make a
     protection", so both are now read and rendered, and the checks below assert that.
     Their entries are removed rather than reworded: an unread-declaration that describes
     a field the portal now reads is exactly what this file's own staleness check exists
     to fail on. */
  seasonStatus:
    'SENT, NEVER READ. The four answers — cancellation asked for, address changed, ' +
    'changes needed, changes settled — are the OFFICE\'s view of where a customer is. ' +
    'The portal renders its own tabs from what it can do next, not from this.',
  seasonStatusAt:
    'SENT, NEVER READ. The date beside seasonStatus; same reason.',
  cancellationReason:
    'WRITTEN, NEVER READ BACK. The Cancel tab saves it (portalSave section "cancel") and ' +
    'never shows it again, so somebody returning cannot see what they told us. Harmless ' +
    'today; it is here so the next person does not read the whitelist entry as proof the ' +
    'page displays it.',
  quoteDetailQuoteId:
    'NOT READ OFF THE RECORD. index.html has a LOCAL `var quoteDetailQuoteId` for the ' +
    'quote-details form, which is a different thing that happens to share the name — a ' +
    'trap worth naming, because a search for the string finds eleven hits and none of ' +
    'them is a record read.'
};

const readAnywhere = new Set();
['currentJobAddressData', 'addrDoc', 'known', 'rec', 'currentLookupRecord', 'record']
  .forEach(h => {
    const re = new RegExp('\\b' + h + '\\.([A-Za-z0-9_]+)', 'g');
    let m;
    while ((m = re.exec(idx)) !== null) readAnywhere.add(m[1]);
  });

const neverRead = [...WHITELIST].filter(f => !readAnywhere.has(f)).sort();
const unexplained = neverRead.filter(f => !WHITELISTED_UNREAD[f]);

check('every whitelisted field is read by the portal, or says why it is not',
  unexplained.length === 0,
  'sent to every customer\'s browser and never looked at: ' + unexplained.join(', ') +
  '\n        Either read it in index.html, drop it from PORTAL_READ_FIELDS, or add it to ' +
  'WHITELISTED_UNREAD here saying what is and is not true of it. A whitelist comment ' +
  'claiming a protection the page does not implement is worse than no comment.');

const staleUnread = Object.keys(WHITELISTED_UNREAD).filter(f => readAnywhere.has(f));
check('and no unread-declaration names a field the portal now reads',
  staleUnread.length === 0,
  'now read, so the declaration is misleading: ' + staleUnread.join(', ') +
  ' — delete the entry rather than leaving it to be believed');

const goneUnread = Object.keys(WHITELISTED_UNREAD).filter(f => !WHITELIST.has(f));
check('and no unread-declaration names a field that left the whitelist',
  goneUnread.length === 0,
  'no longer whitelisted: ' + goneUnread.join(', '));

/* ⚠ AND THE TWO CHECKS THAT DESCRIBED A PROTECTION THEY DO NOT TEST were corrected in
   the same change. This asserts the correction, so it cannot quietly go back. */
{
  const suite = read('run-all.js');
  check('run-all.js no longer claims whitelist membership is the protection',
    !/in PORTAL_READ_FIELDS so the portal cannot contradict the office/.test(suite) &&
    !/in PORTAL_READ_FIELDS so the portal cannot show a customer as settled/.test(suite),
    'those two check only that the NAME is in the list; saying it stops the portal ' +
    'contradicting the office is a guarantee nothing in index.html provides');
}

/* ---------------------------------------------------------------------------
 * AND THE TWO PROTECTIONS ARE ACTUALLY WIRED (Q-028, 2026-08-30).
 *
 * ⚠ ASSERTED AT THE CALL SITE, NOT ONLY AT THE RENDERER. The whole finding was a flag
 * that arrived and was never looked at; a renderer nothing calls is the same failure one
 * level up, and this repo has shipped that twice (the house-tab strip, the recycle
 * "bin says" box).
 * ------------------------------------------------------------------------- */
check('the no-email notice exists and is called',
  /function renderNoEmailNotice\(record\)\{/.test(idx) &&
  /renderNoEmailNotice\(currentJobAddressData \|\| currentLookupRecord\)/.test(idx),
  'the flag arriving and nothing reading it is the whole of what Q-028 was about');
check('and it is fed the record that actually carries the flag',
  !/renderNoEmailNotice\(record\);/.test(idx),
  '`record` there is the portalInvoice record, which carries neither cannotBillNoEmail ' +
  'nor the email fields — the notice would never appear');
check('and it hides itself once an email is on file',
  /if\(!rec\.cannotBillNoEmail \|\| hasEmail\)/.test(idx),
  'the flag is only cleared by the next nightly pass, so a stored-only reading would go ' +
  'on nagging somebody who has already done what was asked');
check('the open-question notice reads askSameAsLastYear',
  /\} else if\(rec\.askSameAsLastYear\)\{/.test(idx),
  'without it the strip promises "we\'ll be in touch with your install date" to somebody ' +
  'the office has not booked');
check('and it sits below the scheduled-date branch',
  idx.indexOf('else if(when){') !== -1 &&
  idx.indexOf('else if(when){') < idx.indexOf('} else if(rec.askSameAsLastYear){'),
  'a house with a date has been decided in practice; telling them we are still working ' +
  'it out is the same contradiction pointing the other way');
check('and neither notice asks the customer to chase us',
  !/cannot bill you/i.test(idxCode),
  /* ⚠ COMMENTS STRIPPED. The first version of this read the raw file and failed on the
     comment above the notice explaining why it must not say this. */
  '"we cannot bill you" is alarming to somebody who has done nothing wrong and gives ' +
  'them nothing to act on');

/* ---------------------------------------------------------------------------
 * AND BOTH NOTICES ARE RUN, NOT READ.
 *
 * ⚠ EVERY CLAIM ABOVE IS ABOUT SOURCE. The claim that matters is about A LINE ON A PAGE,
 * and this repo has been caught three times by a check that matched the source of a
 * message which could never reach the screen — the ledger render on 2026-08-19 being the
 * one that cost a bug report. Both renderers are lifted and driven against jsdom.
 * ------------------------------------------------------------------------- */
{
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* no jsdom in this checkout */ }
  if (!JSDOM) {
    console.log('  NOTE  jsdom not installed — the two render checks were skipped. ' +
      'Run npm install; a source-only pass is a weaker claim than it looks.');
  } else {
    const lift = name => {
      const at = idx.indexOf('function ' + name + '(');
      if (at === -1) throw new Error(name + ' not found in index.html — repoint this lift');
      /* To the closing brace at column 0, not a character count (CLAUDE.md §7). */
      const end = idx.indexOf('\n}', at);
      return idx.slice(at, end + 2);
    };

    // ---- the no-email notice -------------------------------------------
    {
      const dom = new JSDOM('<div id="invNoEmail" style="display:none"></div>');
      const fn = new Function('document', 'currentJobAddressData', 'currentLookupRecord',
        lift('renderNoEmailNotice') + '\nreturn renderNoEmailNotice;'
      )(dom.window.document, null, null);
      const el = dom.window.document.getElementById('invNoEmail');

      fn({ cannotBillNoEmail: true, email: '', email2: '' });
      check('a payer we cannot bill is told so, in words, on the page',
        el.style.display === 'block' && /email address/i.test(el.textContent),
        'got display=' + el.style.display + ' text=' + JSON.stringify(el.textContent.slice(0, 90)));
      check('and it says nothing is wrong with their account',
        /nothing is wrong/i.test(el.textContent),
        'they have done nothing wrong, and a bare "we cannot bill you" reads as though ' +
        'they had');
      check('and it tells them where to fix it',
        /Your Details/.test(el.textContent) && /901-0011/.test(el.textContent),
        'a warning with no next step is the phone call it was meant to prevent');

      fn({ cannotBillNoEmail: true, email: 'dana@x.com' });
      check('and it goes the moment an email is on the record',
        el.style.display === 'none',
        'the flag is only cleared by the next nightly pass — a stored-only reading would ' +
        'nag somebody who has already done what was asked');

      fn({ cannotBillNoEmail: false, email: '' });
      check('and an ordinary customer never sees it',
        el.style.display === 'none',
        'a warning that appears when nothing is wrong is the next one people skim past');

      fn({});
      check('and a record that has not loaded shows nothing',
        el.style.display === 'none',
        'the portal reads the flag before jobAddresses has necessarily landed');
    }

    // ---- the open-question strip ---------------------------------------
    {
      const dom = new JSDOM('<div id="portalScheduleStrip" style="display:none"></div>');
      const fn = new Function('document', 'portalNiceDate',
        lift('renderScheduleStrip') + '\nreturn renderScheduleStrip;'
      )(dom.window.document, v => String(v));
      const el = dom.window.document.getElementById('portalScheduleStrip');

      fn({ askSameAsLastYear: true });
      check('somebody who declined a re-quote is not promised an install date',
        el.style.display === 'block' &&
        !/We'll be in touch with your install date/.test(el.textContent) &&
        /last year/i.test(el.textContent),
        'got: ' + JSON.stringify(el.textContent.slice(0, 110)));
      check('and the strip says the ball is with us',
        /Nothing needed from you/i.test(el.textContent),
        'nobody has asked them for anything — somebody in the office has to decide');

      fn({ askSameAsLastYear: true, scheduledDate: '2026-11-18' });
      check('but a house with a date is told its date, flag or no flag',
        /2026-11-18/.test(el.textContent) && !/last year/i.test(el.textContent),
        'a date in hand means it was decided in practice; still saying we are working it ' +
        'out is the same contradiction pointing the other way');

      fn({ askSameAsLastYear: true, completed: true });
      check('and an installed house is told it is installed',
        /Installed/.test(el.textContent),
        'the flag can outlive the question it was raised for');

      fn({});
      check('and an ordinary customer still gets the ordinary line',
        /on the list for this season/i.test(el.textContent),
        'the new branch must not swallow the case it sits next to');
    }
  }
}

/* ---------------------------------------------------------------------------
 * AND THE FIX FOR THE FIVE IS ACTUALLY WIRED.
 *
 * ⚠ ASSERTED SEPARATELY FROM THE RULE, because this repo has been caught more than once
 * proving a helper works while nothing called it — the house-tab strip, and the recycle
 * "bin says" box whose listener silently never applied. The exceptions above say admin
 * derives these live; if it stopped, the strip would go back to reading blanks and every
 * check here would still pass.
 * ------------------------------------------------------------------------- */
const admin = read('admin.html');
check('admin.html has requoteOnFile',
  /function requoteOnFile\(d\)\{/.test(admin),
  'the exceptions above claim admin derives these live — without it they are just blanks ' +
  'with an excuse attached');
check('and the "On file" strip actually calls it',
  /const onFile = requoteOnFile\(d\);/.test(admin),
  'a helper nothing calls is the shape this repo has shipped twice');
check('and the strip reads the derived values, not the stored snapshot',
  /'On file: '\+[\s\S]{0,400}onFile\.number/.test(admin) &&
  !/'On file: '\+[\s\S]{0,400}d\.existingCustomerNumber/.test(admin),
  'reading d.existingCustomerNumber there is exactly the blank this file was written for');
check('but the stored snapshot is still the fallback',
  /existingCustomerNumber\) \|\| ''/.test(admin) &&
  /number: live\.customerNumber \|\| stored\.number/.test(admin),
  'a quote whose customer has been deleted has only the snapshot, and a stale number is ' +
  'worth more than no number');

/* ------------------------------------------------------------------------- */
console.log('');
console.log('=== What the customer\'s own page can actually see ===');
console.log('');
console.log('  ' + WHITELIST.size + ' fields whitelisted; ' + seen.size +
  ' read in index.html; ' + unlisted.length + ' not whitelisted, all declared.');
console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
