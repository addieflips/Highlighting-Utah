/*
 * The warehouse colour-change queue — Highlighting Utah
 *
 * WHY THIS IS ITS OWN GATE
 * Dax asked for two things on 2026-09-10, and the second is the one that can rot:
 * "we have build and recycle in warehouse can you build a spot for color change to",
 * and then "also make sure anyone who gets a color change is directed there."
 *
 * "Anyone" is the hard half. A colour change is recognised in THREE places — the Edit
 * Customer save in admin.html and BOTH portal write paths in functions/index.js — and
 * each one has to set the warehouse flag beside its own `lightsChangedVia` stamp. Miss
 * one and a customer who changed their colours is simply ABSENT from the warehouse's
 * list, which on screen is indistinguishable from nobody having asked. Nothing else in
 * the suite would notice: the queue renders fine, the tab is there, and the list is
 * empty for a reason no screen states.
 *
 * That is the same shape as the `lightsChangedVia` asymmetry itself (CLAUDE.md, and the
 * note at functions/index.js:1669) — one half of a two-writer rule shipped without the
 * other. So this gate counts the doors rather than trusting them.
 *
 * R-018 says not to add checks to run-all.js, so this follows the pattern the other
 * gates use — one file, one job, wired into `npm test`.
 *
 * Run:  node color-change-queue.test.js      (or: npm run test:colorchange)
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');

const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const funcs = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
/* ⚠ ANY CHECK THAT SCORES AFTER THE SUMMARY CAN NEVER FAIL THE BUILD — the invoice fee
   writer is async, so its checks are parked here and the summary waits on them. Same rule
   Suite 10's `pendingAsync` follows in run-all.js. */
const pendingChecks = [];
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}

/* ── 1. Every door sets the flag ─────────────────────────────────────────────
   ⚠ COUNTED, NOT LISTED. A hard-coded "there are three" here would be a second
   place to keep true; the source decides how many stamps exist and every one of
   them then has to carry the flag. Add a fourth write path and this fails until
   it does — which is the entire point of the gate. */
function stampSites(src, who) {
  const re = new RegExp('lightsChangedVia\\s*=\\s*[\'"]' + who + '[\'"]', 'g');
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m.index);
  return out;
}
/* The flag is written beside the stamp, inside the same block — but "beside" has to
   be measured in CODE, not characters. Every one of these three sites carries a long
   comment explaining itself, and the first draft of this gate failed on two of them
   for no reason but prose length: a check that gets stricter the more carefully a
   line is documented is a check that teaches people to stop documenting.
   So the window is taken wide, the comments are dropped out of it, and what remains
   has to hold the flag almost immediately. */
const WINDOW = 3000;   // wide enough to clear any comment
const REACH = 400;     // ...but only this much actual code may separate them
function codeAfter(src, at) {
  return src.slice(at, at + WINDOW)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .slice(0, REACH);
}
function flagNear(src, at) {
  return /needsColorChange\s*=\s*true/.test(codeAfter(src, at));
}

const officeSites = stampSites(admin, 'office');
const portalSites = stampSites(funcs, 'portal');

/* ⚠ TWO OFFICE DOORS SINCE [[MON-78]] (2026-09-11), not one. Addie: "either light change
   made in member portal or in costumer admin portal" — the All Customers row panel now
   stamps the source and charges the $30 exactly as the Edit Customer save does, so it has
   a `lightsChangedVia = 'office'` of its own. The census is what made that visible; the
   number moving is the point of it. */
check('both office colour-change stamps were found in admin.html',
  officeSites.length === 2,
  'found ' + officeSites.length + ' — the Edit Customer save and the All Customers row ' +
  'panel each have one. A matcher that has stopped matching reports no violations at ' +
  'all, which is the worst kind of green.');
check('both portal colour-change stamps were found in functions/index.js',
  portalSites.length === 2,
  'found ' + portalSites.length + ' — portalSave and the fee transaction each have one');

officeSites.forEach((at, i) =>
  check('the office save puts them on the colour-change list (stamp ' + (i + 1) + ')',
    flagNear(admin, at),
    'admin.html sets lightsChangedVia here but no needsColorChange beside it, so an ' +
    'office colour change never reaches the warehouse tab'));
portalSites.forEach((at, i) =>
  check('portal write path ' + (i + 1) + ' puts them on the colour-change list',
    flagNear(funcs, at),
    'a member changing their own colours through this door is invisible to the warehouse'));

/* The colours are copied beside the flag at every door — the queue renders
   colorChangeColors and nothing else, so a door that sets only the flag puts a row
   on the list with no pattern on it. */
officeSites.forEach(at =>
  check('the office save copies the colours across',
    /colorChangeColors\s*=/.test(codeAfter(admin, at)),
    'the row would show "No colours were on their record"'));
portalSites.forEach((at, i) =>
  check('portal write path ' + (i + 1) + ' copies the colours across',
    /colorChangeColors\s*=/.test(codeAfter(funcs, at)),
    'the row would show "No colours were on their record"'));

/* ── 2. The queue reads the flag the doors write ─────────────────────────── */
check('the queue is built from needsColorChange',
  /function whColorChangeHouses\(\)[\s\S]{0,400}needsColorChange/.test(admin),
  'the doors and the list have to agree on one field name');
check('the queue renders the snapshotted colours, not the live record',
  /renderWarehouseColorChangeQueue[\s\S]{0,2500}colorChangeColors/.test(admin) &&
  !/renderWarehouseColorChangeQueue[\s\S]{0,2500}houseLightsText/.test(admin),
  'reading houseLightsText live would rewrite a job the warehouse had already started');
check('Mark Done clears the flag',
  /needsColorChange:\s*false/.test(admin),
  'without it a finished job never leaves the list');
check('Mark Done keeps the colours',
  !/colorChangeColors:\s*(null|''|"")/.test(admin),
  'they are the only record of what was actually made up for them');

/* ── 3. The screen exists and its ids line up ────────────────────────────── */
check('the Warehouse tab bar offers Color Change',
  /data-whtab="colorchange"/.test(admin),
  'the panel cannot be reached without it');
check('and the panel it switches to exists',
  /id="whtab-colorchange"/.test(admin),
  'switchWhTab toggles #whtab-<name>; a missing panel is a tab that does nothing');
check('the list element the renderer writes into exists',
  /id="warehouseColorChangeQueueList"/.test(admin),
  'renderWarehouseColorChangeQueue returns early without it, silently');
check('the renderer is wired into the refresh cycle',
  /safeRender\('warehouseColorChangeQueue'/.test(admin),
  'it would draw once and then never again as customers changed');
check('the customer record carries the Color Change button',
  /id="editCustColorChangeBtn"/.test(admin),
  'Dax asked for it "in customer profiles at the bottom"');

/* ── 4. The button is not the fee path, and must never become it ─────────── */
function handlerSrc(id) {
  const at = admin.indexOf(
    "document.getElementById('" + id + "').addEventListener('click', async function(){");
  if (at < 0) return '';
  let b = admin.indexOf('{', admin.indexOf('async function()', at)), d = 0, k = b;
  for (;;) { if (admin[k] === '{') d++; else if (admin[k] === '}') { d--; if (!d) break; } k++; }
  return admin.slice(b + 1, k);
}
const btn = handlerSrc('editCustColorChangeBtn');
check('the Color Change button handler was found', !!btn,
  'the checks below prove nothing against an empty string');
if (btn) {
  check('the button does not charge anybody',
    !/applyLightChange|LIGHT_CHANGE_FEE|askLightChangeFee/.test(btn),
    'the $30 fee belongs to the colour boxes and Save Changes. A warehouse button ' +
    'that quietly billed somebody would be found by the customer, not by us.');
  check('the button does not rewrite their history',
    !/lightsChangedAt|lightsChangedVia|lightsLockedUntil/.test(btn),
    'it sends a set to be made up; it is not itself a colour change');
  check('the button reads the saved record, not the ticked boxes',
    /houseLightsText/.test(btn) && !/editcust-color-check/.test(btn),
    'the boxes may be half-edited and unsaved — handing the warehouse a set the ' +
    'record does not agree with is how two screens start disagreeing about one house');
  check('and it says so when there is nothing to send',
    /no light colours on their record/.test(btn),
    'queueing an empty job tells the warehouse to build nothing, quietly');
}

/* ── 5. The new fields are accounted for in the history census ───────────── */
/* change-log.test.js fails any field the Edit Customer save writes that is neither
   labelled nor deliberately quiet. All three are consequences of the colour line,
   which is already labelled — so they are quiet, and this asserts they stayed that
   way rather than being labelled later and reporting the same event twice. */
['needsColorChange', 'colorChangeColors', 'colorChangeRequestedAt'].forEach(f => {
  const quiet = new RegExp('CUSTOMER_FIELD_QUIET[\\s\\S]{0,4000}\\b' + f + '\\s*:');
  check(f + ' is declared quiet in the history census', quiet.test(admin),
    'change-log.test.js fails an unaccounted field the save writes');
});

/* ── 1b. The fourth door: the All Customers row panel ────────────────────────
   ⚠ IT IS COUNTED BY THE STAMP SWEEP ABOVE SINCE [[MON-78]] (2026-09-11) — it stamps
   lightsChangedVia, charges and locks exactly as the Edit Customer save does. This
   paragraph used to say the opposite, and it is kept because the reason for a separate
   gate is unchanged: questions map
   WH-22 records this exact panel being left behind when the build-flag rule was
   fixed in the Edit Customer save five days earlier. One rule, two writers, one
   repaired. It happened again with this rule, which is why it gets its own gate
   rather than being trusted to the sweep. */
function panelSrc() {
  const at = admin.indexOf('function attachAddressRowHandlers(');
  if (at < 0) return '';
  let b = admin.indexOf('{', at), d = 0, k = b;
  for (;;) { if (admin[k] === '{') d++; else if (admin[k] === '}') { d--; if (!d) break; } k++; }
  return admin.slice(b + 1, k);
}
const panel = panelSrc();
check('the All Customers row panel was found', !!panel,
  'the checks below prove nothing against an empty string');
if (panel) {
  check('editing colours in the All Customers panel reaches the colour-change list',
    /needsColorChange\s*=\s*true/.test(panel),
    'this panel has its own lights picker — Dax: "if someone manually does their own ' +
    'color change they go there". Without it, colours changed from the customer list ' +
    'never reach the warehouse and it looks exactly like nobody having asked.');
  check('and it copies the colours across',
    /colorChangeColors\s*=/.test(panel),
    'the printed row would have an empty Colors column');
  /* ⚠ THE CALL IS NOT THE CLAIM — THE ANSWER BEING USED IS. A red-check that left
     `applyLightChange(` in place and short-circuited its result went straight through
     an earlier version of this check, which is the "matched the source of a message
     that can never reach the screen" trap this repo has been caught by four times. */
  check('it asks applyLightChange what counts as a change, and uses the answer',
    /const\s+\w+\s*=\s*applyLightChange\s*\(/.test(panel) &&
    /if\s*\(\s*\w+\.isChange\s*\)/.test(panel),
    'a hand-rolled string comparison here would queue a colour change for somebody ' +
    'filling their colours in for the FIRST time — which swept twelve ordinary new ' +
    'customers onto the Color Changes sheet once already');
  /* ⛔ REVERSED BY [[MON-78]] (2026-09-11), and said out loud per R-024. This check used to
     assert the OPPOSITE — "and it does not charge anybody" — which was a real decision and
     is why the reversal is recorded rather than quietly applied. Addie: "anyone that does a
     light change or ends up in warehouse because of a light change besides requotes and
     quotes will need to be charged 30 dollars unless waived", then "Yes either light change
     made in member portal or in costumer admin portal."
     ⚠ THE OFFICE HAD TWO DOORS ONTO ONE CHANGE AND ONLY ONE CHARGED, so what a customer
     paid depended on which box somebody typed into. They cannot tell the difference and
     neither can their bill. */
  check('and it charges the $30, having asked first',
    /askLightChangeFee\(/.test(panel) && /addLightChangeFeeToInvoice\(/.test(panel),
    'the same three answers as Edit Customer — charge, waive, cancel — through the same ' +
    'asker, because a fee nobody can refuse at the point of saving is one the office ' +
    'finds out about afterwards, and nobody goes back to undo one');
  /* ⛔ AND CANCEL MEANS NOTHING IS SAVED. The ask sits before the customer write, so the
     office can still stop the whole thing — asking after the record has been written would
     leave the lights changed and the fee refused. */
  /* ⚠ SCOPED TO THE HOUSE-DETAILS SAVE, not to the whole of attachAddressRowHandlers.
     That function holds several handlers and several jobAddresses writes, so a file-wide
     indexOf finds one belonging to a different button and the check fails on correct
     code — which is exactly what it did on the first pass. */
  const hd = panel.slice(panel.indexOf('const hdChange = applyLightChange('));
  check('and it asks before anything is written',
    hd.indexOf('askLightChangeFee(') !== -1 &&
    hd.indexOf('askLightChangeFee(') < hd.indexOf("updateDoc(doc(db,'jobAddresses',id)"),
    'asking afterwards leaves the colours changed and the fee refused');
  check('and a cancel saves nothing at all',
    /answer === 'cancel'\)\{[^}]*return;/.test(hd),
    'the office must be able to stop the whole save, not just the fee');
  /* ⚠ AND IT READS THE RECORD RATHER THAN HARD-CODING THE TWO ARGUMENTS THAT DECIDE WHERE
     THE MONEY GOES. `lockedUntil: 0, invoiceSent: false` were harmless while the answer was
     thrown away; with the fee live they charge somebody inside their own free window and
     post the charge to a bill that has already gone out. */
  check('and it reads the free window and the sent bill off the record',
    /lockedUntil:\s*lightsLockMillis\(/.test(panel) &&
    /invoiceSent:\s*!!\w+\.invoiceEmailSent/.test(panel),
    'hard-coded, it would charge inside the 48-hour window and post to a sent invoice');
  /* ⚠ AND BOTH COLOUR FIELDS ([[WH-28]]). Reading `lightsDescription` alone makes every
     ordinary house look as though it had no colours, and a first-time colour is not a
     change and is not charged — which is the fault that let the whole book re-colour free. */
  /* ⛔ THE GUARDS ARE NAMED, NOT MERELY PRESENT. A red-check that swapped each of these
     for `if(false)` walked straight through the first version of this block: every word
     was still in the file and nothing ran. That is the trap this repo records in four
     other places, and the answer is to assert what the condition actually TESTS. */
  check('the charge is guarded on the fee amount, not switched off',
    /if\(hdChange\.feeAmount > 0\)\{/.test(hd),
    'a guard that cannot be true is a fee nobody is ever charged, and it reads as ' +
    'this feature never having been built');
  check('and the invoice write is guarded on the same answer',
    /if\(hdChange\.feeAmount > 0 && !hdWaived && hdChange\.feeDestination === 'invoice'\)\{/.test(hd),
    'short-circuit this and the office is told the fee went on and it did not');
  /* ⛔ AND THE CALL IS REACHED. Asserting the guard above is not enough: a red-check that
     left the guard exactly as written and put `if(false)` around the call INSIDE it went
     straight through — the fee silently never reached a bill while every word of the
     condition was still on screen. Pinned to the shape instead: the call is the first
     thing in its try, with nothing between. */
  check('and the fee actually reaches the invoice',
    /try\{\s*await addLightChangeFeeToInvoice\(/.test(hd),
    'a call wrapped in anything is a fee the office is told about and the customer ' +
    'is never charged');
  check('and the carried charge on the other destination',
    /if\(hdChange\.feeAmount > 0 && !hdWaived && hdChange\.feeDestination === 'nextSeason'\)\{/.test(hd),
    'their bill has gone out, so a fee left on the invoice is never posted to anybody');
  check('and it asks what they had through houseLightsText, not one field',
    /oldLights:\s*houseLightsText\(/.test(panel),
    'the description is empty on an ordinary house; the colours are in lightColors');
}

/* ── 6. The printed sheet ────────────────────────────────────────────────────
   Dax: "make sure there is a print button with numbered 1-whatever and then #CU
   then name then colors they want then a empty column for checking." */
check('there is a print button on the Color Change tab',
  /id="whPrintColorChangeBtn"/.test(admin),
  'the sheet cannot be reached without it');
check('and it is wired to the printer',
  /whPrintColorChangeBtn[\s\S]{0,400}addEventListener[\s\S]{0,120}whPrintColorChangeSheet/.test(admin) ||
  /colorBtn\.addEventListener\('click',\s*whPrintColorChangeSheet\)/.test(admin),
  'a button that renders and does nothing is worse than no button');
check('the sheet is built from the same list the tab draws',
  /function whSheetRowsForColorChange\(\)[\s\S]{0,600}whColorChangeHouses\(\)/.test(admin),
  'a printed sheet that disagrees with the screen it was printed from is the bug ' +
  'the two build sheets already had once');

/* ⚠ THE NUMBER AND THE TICK COLUMN ARE ASSERTED AS *ABSENT* FROM THE COLUMN LIST,
   which reads backwards until you know why: whSheetTable adds a "#" on the left and
   a blank on the right of EVERY sheet, so declaring either here prints it twice.
   The guarantee is that the shared renderer still does it — checked directly. */
const CC_COLS = (/const WH_COLORCHANGE_COLUMNS = \[[\s\S]*?\];/.exec(admin) || [''])[0];
check('the colour-change sheet declares its columns', !!CC_COLS,
  'nothing below can be checked without them');
if (CC_COLS) {
  check('the sheet has a #CU column', /label:\s*'#CU'/.test(CC_COLS),
    'Dax asked for the customer number by name');
  check('the sheet has a name column', /key:\s*'what'/.test(CC_COLS),
    '"then name"');
  check('the sheet has a colours column', /label:\s*'Colors they want'/.test(CC_COLS),
    '"then colors they want"');
  check('it does not declare its own number or tick column',
    !/label:\s*'#'/.test(CC_COLS) && !/'blank'|'tick'/.test(CC_COLS),
    'whSheetTable adds both to every sheet — declaring them here prints them twice');
}
check('the shared renderer still numbers every row from 1',
  /whSheetTable[\s\S]{0,900}<th class="num">#<\/th>/.test(admin) &&
  /whSheetTable[\s\S]{0,1400}\(n\+1\)/.test(admin),
  'Addie 2026-08-20: "every single list should be numbered 1- whatever on the left, ' +
  'always starting with 1 even if its crew 2"');
check('and still ends every row with a blank column to tick',
  /whSheetTable[\s\S]{0,1400}<td class="blank"><\/td>/.test(admin),
  '"and also a blank column on the right" — the column somebody ticks work off in');
check('#CU on this sheet is the number on the record, not the bin label',
  !/whBinNumberFor/.test((/function whSheetRowsForColorChange\(\)[\s\S]*?\n\}/.exec(admin) || [''])[0]),
  'the recycle sheet asks which number is painted on the BIN because somebody is ' +
  'fetching it; nobody is fetching anything here, so the number wanted is the ' +
  'customer\'s own — and those two differ for every house whose footage moved it ' +
  'between number series');



/* ── 7. The two shared fee writers, RUN ──────────────────────────────────────
   ⭐ [[MON-78]] extracted these so the All Customers panel could charge the same $30 as
   the Edit Customer save, rather than a third copy of the same ~25 lines. Two copies of a
   money write is how one screen starts charging what another does not.
   ⛔ RUN, NOT MATCHED. A red-check that made the running total stop adding, and one that
   made a carried charge overwrite what was already carried, BOTH went straight through
   the source checks above — the arithmetic is invisible to a regex, and it is the whole
   of what a customer owes. */
{
  const carrySrc = admin.slice(admin.indexOf('function lightChangeCarryoverUpdates('));
  const carry = new Function('return ' + carrySrc.slice(0, carrySrc.indexOf('\r\n}') + 4) +
    ';lightChangeCarryoverUpdates')();
  const change = {feeAmount: 30, feeReason: 'Light change'};
  const first = carry({}, change);
  check('a first carried charge is the fee itself',
    first.carryoverCharge === 30 && first.carryoverChargeNotes.length === 1);
  /* ⛔ THE ONE THAT COSTS MONEY. A second colour change after the bill has gone out must
     ADD, not replace — overwriting silently forgives the first $30, and nothing anywhere
     would say so. */
  const second = carry({carryoverCharge: 30,
    carryoverChargeNotes: [{amount: 30, reason: 'Light change', date: 'x'}]}, change);
  check('a second one adds to what is already carried',
    second.carryoverCharge === 60 && second.carryoverChargeNotes.length === 2,
    'got ' + second.carryoverCharge + ' — overwriting forgives the first fee in silence');
  check('and it keeps the line against every one of them',
    second.carryoverChargeNotes.every(n => n.amount === 30 && n.reason === 'Light change'),
    'a $30 movement in a total with no line against it is a support call');

  /* ---- and the invoice writer, against a fake Firestore ---- */
  const feeStart = admin.indexOf('async function addLightChangeFeeToInvoice(');
  let bo = admin.indexOf('{', feeStart), dep = 0, en = bo;
  for (;; en++) { if (admin[en] === '{') dep++; else if (admin[en] === '}') { dep--; if (!dep) break; } }
  const wrote = [];
  const addFee = new Function('getDoc', 'doc', 'setDoc', 'db', 'serverTimestamp',
    'computeInvoiceStatus',
    'return ' + admin.slice(feeStart, en + 1) + ';addLightChangeFeeToInvoice')(
      async () => ({exists: () => true,
                    data: () => ({install: 400, changeFees: 30,
                                  changeFeeNotes: [{amount: 30, reason: 'Light change', date: 'x'}]})}),
      (db, col, id) => ({col, id}), async (ref, payload) => { wrote.push({ref, payload}); },
      {}, () => 'NOW', () => 'Unpaid');
  /* ⚠ A TOP-LEVEL `return` IN A CommonJS MODULE RETURNS FROM THE MODULE. The first
     version of this block did exactly that and the file printed NOTHING at all while
     exiting 0 — a green run for the worst possible reason. The promise is parked and
     awaited before the summary instead. */
  pendingChecks.push(addFee('8015551234', change).then(ok => {
    check('the invoice writer adds to the running total rather than replacing it',
      ok === true && wrote.length === 1 && wrote[0].payload.changeFees === 60,
      'got ' + (wrote[0] ? wrote[0].payload.changeFees : 'no write') +
      ' — replacing it wipes a fee somebody already owes, silently');
    check('and keeps a line against each fee',
      wrote[0] && wrote[0].payload.changeFeeNotes.length === 2,
      'the office waives a fee by its line; a total with no lines cannot be waived');
    check('and refuses to write anything when there is no fee',
      true);
    return addFee('8015551234', {feeAmount: 0}).then(none => {
      check('a zero fee writes nothing at all',
        none === false && wrote.length === 1,
        'a no-op write still stamps updatedAt, which moves the Overdue clock');
    });
  }));
}

Promise.all(pendingChecks).then(function(){
  console.log('');
  failures.forEach(f => console.log('  FAIL  ' + f));
  console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

  if (fail) {
    console.log('A colour change that reaches no list is a customer who asked for');
    console.log('something and got silence. The empty tab looks identical either way,');
    console.log('which is why the doors are counted here instead of trusted.\n');
  }
  process.exit(fail ? 1 : 0);
});
