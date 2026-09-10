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

check('the office colour-change stamp was found in admin.html',
  officeSites.length === 1,
  'found ' + officeSites.length + '. A matcher that has stopped matching reports no ' +
  'violations at all, which is the worst kind of green.');
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

console.log('');
failures.forEach(f => console.log('  FAIL  ' + f));
console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');

if (fail) {
  console.log('A colour change that reaches no list is a customer who asked for');
  console.log('something and got silence. The empty tab looks identical either way,');
  console.log('which is why the doors are counted here instead of trusted.\n');
}
process.exit(fail ? 1 : 0);
