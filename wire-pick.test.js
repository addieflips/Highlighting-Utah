/*
 * Picking a wire colour off a picture of the house — Highlighting Utah
 *
 * Dax, 2026-09-17: "when customers decide white wire its optional, and if they dont answer it
 * then there is a spot in our system messages that shows us a picture of their house and we
 * can mark there wire type there and there is no default color so they dont get assigned a
 * color until we go into system messages and assign them one."
 *
 * The "no default" half is already enforced in nine places. This gate is about the OTHER
 * half — the one door where the unanswered question gets answered — and every way it can go
 * wrong is silent:
 *
 *   - The card writes over a colour somebody already picked, because it believed its own
 *     notice instead of the customer record.
 *   - A button is drawn for a customer who no longer exists, so pressing it does nothing —
 *     the exact class of bug Addie has asked about by name.
 *   - 'Any' (the old form default) is read as an answer, so the house it belongs to is
 *     never asked about again and quietly keeps a colour nobody chose.
 *   - The wire is saved and the bundle is NOT queued to be rebuilt, so the warehouse makes
 *     the set that was already on the shelf.
 *   - The notice is closed while the customer write failed, which reads as answered.
 *   - Street View is asked for on the one key that has it turned off, and the card says
 *     "no picture" for every house in the book.
 *
 * R-018 says not to add checks to run-all.js, so this is one file, one job.
 *
 * Run:  node wire-pick.test.js      (or: npm run test:wirepick)
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; } else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}
function eq(label, got, want) {
  check(label, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
}
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
/* Walks to the matching brace — CLAUDE.md §7 bans a fixed window and run-all enforces it. */
function lift(name) {
  let start = admin.indexOf('async function ' + name + '(');
  if (start < 0) start = admin.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let k = admin.indexOf('{', start), d = 0;
  for (; k < admin.length; k++) {
    if (admin[k] === '{') d++;
    else if (admin[k] === '}') { d--; if (!d) break; }
  }
  return admin.slice(start, k + 1);
}

const NAMES = ['wirePickCustomerFor', 'wirePickAnswer', 'wirePickCardHtml',
               'wirePickHeading', 'wirePickStreetView', 'wirePickSet', 'wirePickWireRows'];
const SRC = {};
NAMES.forEach(function (n) { SRC[n] = lift(n); });
check('every function this gate tests was found in admin.html',
  NAMES.every(function (n) { return SRC[n]; }),
  'a gate that cannot find its target must never report green. Missing: ' +
  NAMES.filter(function (n) { return !SRC[n]; }).join(', '));

const TOPIC = (admin.match(/const WIRE_PICK_TOPIC = '([^']+)'/) || [])[1] || '';
check('the topic is a real string', !!TOPIC, 'WIRE_PICK_TOPIC could not be read');

/* The real functions, run against a tiny world of stubs. Nothing here re-implements the
   thing under test: every stub is a thing admin.html gets from somewhere else. */
function build(world) {
  const w = Object.assign({
    jobAddresses: [],
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); },
    toast: function () {},
    logActivity: function () {},
    renderMessagesList: function () {},
    warehouseRebuildFields: function () { return []; },
    updateDoc: async function () {},
    doc: function (db, col, id) { return col + '/' + id; },
    db: {},
    serverTimestamp: function () { return 'TS'; },
    WIRE_PICK_TOPIC: TOPIC,
    fetch: async function () { throw new Error('no fetch in this test'); },
    console: console
  }, world || {});
  const keys = Object.keys(w);
  const body = NAMES.map(function (n) { return SRC[n]; }).join('\n') +
    '\nreturn {' + NAMES.join(', ') + '};';
  return new Function(keys.join(','), body).apply(null, keys.map(function (k) { return w[k]; }));
}

console.log('\n=== What the card says ===');

const custBlank = {id: 'c1', data: {name: 'Blank Wire', phone: '(801) 555-0101',
  address: '1 Elm St, Alpine', wireColor: '', lat: 40.45, lng: -111.77}};
const custWhite = {id: 'c2', data: {name: 'Chose White', phone: '8015550202', wireColor: 'White'}};
const custAny   = {id: 'c3', data: {name: 'Old Any', phone: '8015550303', wireColor: 'Any'}};

let api = build({jobAddresses: [custBlank, custWhite, custAny]});

eq('a notice on another topic draws no card',
  api.wirePickCardHtml({id: 'm0', data: {topic: 'Quote Approved', customerId: 'c1'}}), '');

const blankCard = api.wirePickCardHtml({id: 'm1', data: {topic: TOPIC, customerId: 'c1'}});
check('a customer with no wire colour is offered both answers',
  /data-wireset="White"/.test(blankCard) && /data-wireset="Green"/.test(blankCard), blankCard.slice(0, 200));
check('the card carries the notice id and the customer id',
  /data-wirepick="m1"/.test(blankCard) && /data-wirepickcust="c1"/.test(blankCard));
check('and it asks for a picture of that house',
  /data-wirepickphoto="c1"/.test(blankCard));

const whiteCard = api.wirePickCardHtml({id: 'm2', data: {topic: TOPIC, customerId: 'c2'}});
check('a customer who already has a wire colour is not asked again',
  /White/.test(whiteCard) && !/data-wireset/.test(whiteCard), whiteCard.slice(0, 160));

/* ⚠ THE ONE THAT LOOKS LIKE AN ANSWER AND IS NOT. 'Any' was the old form default, so it is
   precisely the customer who never answered — reading it as a colour is how a house keeps a
   wire nobody chose, which is the whole fault this notice exists to end. */
const anyCard = api.wirePickCardHtml({id: 'm3', data: {topic: TOPIC, customerId: 'c3'}});
check("the old 'Any' is not an answer, so that house is still asked about",
  /data-wireset="White"/.test(anyCard), anyCard.slice(0, 160));

/* ⚠ A BUTTON THAT CANNOT WORK IS NOT DRAWN. */
const goneCard = api.wirePickCardHtml({id: 'm4', data: {topic: TOPIC, customerId: 'nope'}});
check('a notice whose customer is gone says so and offers no buttons',
  !/data-wireset/.test(goneCard) && /no longer on file/i.test(goneCard), goneCard.slice(0, 160));

console.log('=== Finding the customer behind the notice ===');

eq('the id wins when it is there',
  (api.wirePickCustomerFor({customerId: 'c2', phone: '(801) 555-0101'}) || {}).id, 'c2');
eq('and a notice with no id falls back to the phone, punctuation and all',
  (api.wirePickCustomerFor({phone: '801-555-0303'}) || {}).id, 'c3');
eq('a notice with neither matches nobody',
  api.wirePickCustomerFor({}), null);

console.log('=== Pressing a button ===');

const pendingAsync = [];
function run(label, fn) { pendingAsync.push(Promise.resolve().then(fn).catch(function (err) {
  check(label, false, 'threw: ' + (err && err.message));
})); }

run('saving a wire colour', async function () {
  const writes = [];
  const a = build({
    jobAddresses: [JSON.parse(JSON.stringify(custBlank))],
    warehouseRebuildFields: function (before, updates) {
      return (String(before.wireColor || '') !== String(updates.wireColor || '')) ? ['wireColor'] : [];
    },
    updateDoc: async function (ref, updates) { writes.push([ref, updates]); }
  });
  await a.wirePickSet('m1', 'c1', 'Green', null);
  eq('the colour lands on the customer record',
    writes[0] && [writes[0][0], writes[0][1].wireColor], ['jobAddresses/c1', 'Green']);
  /* ⚠ THE HALF THAT IS INVISIBLE UNTIL A BUNDLE IS WRONG. A wire change IS a build. */
  check('and the bundle is queued to be built again',
    writes[0] && writes[0][1].needsLightBuild === true,
    'a set already made as "Check lights" would stay on the shelf: ' + JSON.stringify(writes[0] && writes[0][1]));
  eq('then the notice is closed',
    writes[1] && [writes[1][0], writes[1][1].responded, writes[1][1].wirePickedAs],
    ['messages/m1', true, 'Green']);
});

run('a colour somebody already picked', async function () {
  const writes = [];
  const a = build({
    jobAddresses: [JSON.parse(JSON.stringify(custWhite))],
    updateDoc: async function (ref, updates) { writes.push([ref, updates]); }
  });
  await a.wirePickSet('m2', 'c2', 'Green', null);
  eq('is never written over from a stale card', writes.length, 0);
});

run('a customer who has gone', async function () {
  const writes = [];
  const a = build({jobAddresses: [], updateDoc: async function (r, u) { writes.push([r, u]); }});
  await a.wirePickSet('m9', 'ghost', 'White', null);
  eq('writes nothing at all', writes.length, 0);
});

run('a refused customer write', async function () {
  const writes = [];
  const a = build({
    jobAddresses: [JSON.parse(JSON.stringify(custBlank))],
    updateDoc: async function (ref, updates) {
      if (String(ref).indexOf('jobAddresses') === 0) throw new Error('permission-denied');
      writes.push([ref, updates]);
    }
  });
  await a.wirePickSet('m1', 'c1', 'White', null);
  /* ⚠ A CLOSED NOTICE OVER A FAILED WRITE IS THE WORST OUTCOME HERE: the question is gone
     from the folder and the answer never reached the record. */
  eq('leaves the notice open', writes.length, 0);
});

run('anything that is not one of the two answers', async function () {
  const writes = [];
  const a = build({
    jobAddresses: [JSON.parse(JSON.stringify(custBlank))],
    updateDoc: async function (r, u) { writes.push([r, u]); }
  });
  await a.wirePickSet('m1', 'c1', 'Any', null);
  await a.wirePickSet('m1', 'c1', '', null);
  eq('is refused', writes.length, 0);
});

console.log('=== The picture ===');

/* ⚠ TWO KEYS, DIFFERENT APIS ENABLED — Street View answers on one of the page's keys and is
   switched off on the other. A loop that stopped at the first key would show "no picture" for
   every house on the day the wrong key came first. */
run('a key with Street View switched off', async function () {
  const asked = [];
  const a = build({
    rmMapsKeys: function () { return ['KEY_NO_SV', 'KEY_WITH_SV']; },
    fetch: async function (url) {
      asked.push(url);
      const denied = url.indexOf('KEY_NO_SV') !== -1;
      return {json: async function () {
        return denied ? {status: 'REQUEST_DENIED'}
                      : {status: 'OK', location: {lat: 40.4499, lng: -111.7700}};
      }};
    }
  });
  const shot = await a.wirePickStreetView(40.45, -111.77);
  check('is not the end of it — the next key is tried', asked.length === 2, JSON.stringify(asked));
  check('and the picture comes back on the key that works',
    !!shot.url && shot.url.indexOf('KEY_WITH_SV') !== -1, JSON.stringify(shot));
});

run('a house Google has never driven past', async function () {
  const asked = [];
  const a = build({
    rmMapsKeys: function () { return ['K1', 'K2']; },
    fetch: async function (url) {
      asked.push(url);
      return {json: async function () { return {status: 'ZERO_RESULTS'}; }};
    }
  });
  const shot = await a.wirePickStreetView(40.45, -111.77);
  eq('is not retried on the other key', asked.length, 1);
  check('and says so instead of showing a broken image',
    shot.url === null && /no Street View/i.test(shot.note), JSON.stringify(shot));
});

console.log('=== The wiring, and the door the notice comes from ===');

const clean = stripComments(admin);

/* ⚠ THE FUNCTION'S OWN BODY, NOT THE REST OF THE FILE. A slice running to the end of
   admin.html also contains the System tab's copy of both calls, so deleting the live
   Inbox's wiring left this green — caught by the red-check, which is what it is for. */
const commList = stripComments(lift('renderMessagesList'));
check('the Communication Centre draws the card',
  /wirePickCardHtml\(item\)/.test(commList),
  'the live Inbox is the screen the office actually reads');
check('and wires its buttons',
  /wirePickWireRows\(list\)/.test(commList),
  'a card with no handlers is a button that does nothing');
/* ⚠ FROM THE RENDERER, NOT FROM THE ROW. The System tab wires its handlers in
   renderSystemMessagesTab, which sits ABOVE systemNoticeRow in the file — a slice starting
   at the row would miss the wiring call and pass while the buttons were dead. */
const sysTab = clean.slice(clean.indexOf('function renderSystemMessagesTab'));
check('the older System tab draws the same card from the same function',
  /wirePickCardHtml\(item\)/.test(sysTab) && /wirePickWireRows\(list\)/.test(sysTab),
  'two screens drawing one notice differently is how they start disagreeing');

check('the topic is a System notice',
  new RegExp('SYSTEM_NOTICE_TOPICS = \\[\\s*WIRE_PICK_TOPIC').test(clean),
  'otherwise it reads as a customer message and lands in the reply queue');
check('and it files under Warehouse & Lights',
  /\[WIRE_PICK_TOPIC\]: 'warehouse'/.test(clean),
  'an unlisted topic falls silently into Everything else');

/* The notice is raised at ONE door — the customer save — and only when the wire is genuinely
   blank. A sweep over the book would bury the folder; a notice for an answered customer is a
   question nobody can act on. */
/* ⚠ THE CUSTOMER SAVE, NOT THE FIRST jobAddresses WRITE IN THE FILE. Six places create one
   (the test builders among them) and the first of them is not this door, so anchoring on the
   collection name alone tested the wrong function and still went green. needsDayAssignedAt is
   written at this door and nowhere else. */
const saveIdx = clean.indexOf('needsDayAssignedAt: serverTimestamp()');
const afterSave = clean.slice(saveIdx, saveIdx + 6000);
check('a customer saved with no wire colour raises the notice',
  /if\(!wireColor\)\{[\s\S]*?topic: WIRE_PICK_TOPIC/.test(afterSave.replace(/\s*\n\s*/g, '')),
  'nothing else asks for a wire colour on a house that has never been hung');
check('the notice carries the customer id, which is what the card resolves',
  /customerId: newAddrRef\.id/.test(afterSave),
  'without it the card can only guess from a phone number');
/* ⚠ SCOPED TO THE NOTICE'S OWN BLOCK. The save handler catches several other writes the
   same way further down — matching anywhere after the topic passed with this catch deleted. */
const noticeBlockStart = afterSave.indexOf('if(!wireColor){');
const noticeBlock = noticeBlockStart < 0 ? ''
  : afterSave.slice(noticeBlockStart, afterSave.indexOf('availableCustomerNumbers', noticeBlockStart));
check('and a notice that cannot be written never loses the customer',
  /\.catch\(/.test(noticeBlock) && /console\.error\(/.test(noticeBlock),
  'the record is already saved by this point, so a failed notice must not throw');

const cardSrc = SRC.wirePickCardHtml || '';
check('the card reads the customer record, not the notice, for the answer',
  /wirePickAnswer\(cust\)/.test(cardSrc),
  'the wire can also be set from Edit Customer, the portal or the sheet sync');

/* ---------------------------------------------------------------------------
 * ⭐ ASKED AT THE CONVERT, NOT ONLY AFTERWARDS  ([[WH-42]], 2026-09-18)
 *
 * Addie: "when they choose any or they don't choose any they just leave it at any that it
 * notifies us when we push convert to costumer before it converts it will come up with a
 * pop that says pick a wire color for costumer or something similar to that."
 *
 * ⛔ THIS ADDS A DOOR AND CLOSES NONE. Everything above still holds: no default colour, the
 * System Message still raised for an unanswered house, the card still the place it gets
 * answered later. What was missing is that the question was only ever asked AFTER the
 * customer existed — the one moment somebody is already looking at that house was the one
 * moment nobody was asked.
 *
 * ⚠ EVERY CHECK HERE IS ABOUT THE TWO PATHS AGREEING. Convert automatically and Fill in
 * manually both call `fillAddCustFromQuote` first, which sets the box from the QUOTE, so an
 * answer applied on only one of them leaves the other silently keeping the quote's blank —
 * and blank is a legal value, so it fails quietly rather than throwing.
 * ------------------------------------------------------------------------- */
{
  const popup = stripComments(lift('showConvertQuoteChoice'));
  const auto = stripComments(lift('autoConvertQuoteToCustomer'));
  const apply = stripComments(lift('applyConvertWirePick'));
  const opts = stripComments(lift('convertWireOptionsHtml'));

  check('the convert popup asks for a wire colour',
    /id="convertQuoteWire"/.test(popup),
    'she is asked at the one moment somebody is already looking at that house');

  /* ⚠ THE OPTIONS ARE READ OFF THE REAL FORM, never typed into the popup. A second list is
     how this starts offering a colour `#addCustWireColor` cannot save. */
  check('and its options come from the Add Customer select rather than a second list',
    !!opts && /getElementById\('addCustWireColor'\)/.test(opts) && /real\.options/.test(opts),
    'two lists is how the popup offers a colour the form cannot save');
  check('so the popup spells no colour name of its own',
    !/'White'|"White"|>White<|'Green'|"Green"|>Green</.test(popup),
    'got a hard-coded colour in showConvertQuoteChoice');

  /* ⚠ BOTH PATHS, AND THIS IS THE CHECK THAT EARNS THE BLOCK. */
  check('the manual path applies the answer AFTER the quote has filled the form',
    apply && popup.indexOf('applyConvertWirePick(') > popup.indexOf('fillAddCustFromQuote('),
    'applied first, the quote\'s own blank overwrites it and the picker does nothing');
  check('and the automatic path carries it through as well',
    /autoConvertQuoteToCustomer\(quoteId, d, wire\)/.test(popup) &&
    /applyConvertWirePick\(wirePick\)/.test(auto),
    'one path wired and one not is a picker that works every other press');
  check('and the automatic path applies it after the fill too',
    auto.indexOf('applyConvertWirePick(') > auto.indexOf('fillAddCustFromQuote('),
    'same ordering trap, one function further along');

  /* ⛔ A CALLER THAT WAS NEVER ASKED MUST NOT BE ANSWERED FOR. `undefined` means no picker
     was shown; blanking the box there takes a wire colour off a house nobody asked about. */
  check('a convert with no picker behind it leaves the quote\'s own value alone',
    /wirePick !== undefined/.test(auto),
    'an unasked caller must not have a blank written for it');

  /* ⚠ READ BEFORE close(). The overlay is removed by close(), so a value read after it is
     blank — which is itself legal here, so it would fail silently rather than throw. */
  const manualBtn = popup.slice(popup.indexOf("convertQuoteManualBtn').addEventListener"));
  const autoBtn = popup.slice(popup.indexOf("convertQuoteAutoBtn').addEventListener"));
  check('the manual button reads the answer before it closes the popup',
    manualBtn.indexOf('convertWireSel ? convertWireSel.value') < manualBtn.indexOf('close()'),
    'read after close() the select is gone and the answer reads blank, silently');
  check('and so does the automatic one',
    autoBtn.indexOf('convertWireSel ? convertWireSel.value') < autoBtn.indexOf('close()'),
    'read after close() the select is gone and the answer reads blank, silently');

  /* -------------------------------------------------------------------------
   * ⭐ AND IT REFUSES  ([[WH-43]], 2026-09-18)
   *
   * Addie, told the picker only asked: "make it required for us to choose wire before we
   * convert to costumer."
   *
   * ⚠ THIS REVERSES [[WH-42]]'s OWN "ask, never refuse" AND THE CHECK THAT HELD IT, which
   * read "leaving it unanswered still converts". R-024. The old reasoning is kept rather
   * than deleted because it is the cost being paid rather than a mistake: [[WH-40]] exists
   * because there is sometimes genuinely nothing to answer from, and Cancel is now the only
   * way past that. She was told twice and asked for it anyway.
   * ⛔ AND IT IS THE POPUP THAT REFUSES, NOT THE ADD CUSTOMER SAVE — asserted below,
   * because closing that door too would make the [[WH-40]] notice unraisable at the one
   * door that raises it, which is WH-40 deleted as a side effect of a different ruling.
   * ----------------------------------------------------------------------- */

  /* ⚠ THE FIRST DRAFT OF THE CHECK THIS REPLACES FAILED ON CORRECT CODE, which is worth
     keeping: it looked for `disabled` within a fixed window of the select, and caught the
     LIGHTS guard on the Convert automatically button a few lines below. A fixed-length
     window is banned in this repo by name (§7) and this is why. Both handlers' own bodies
     are asserted instead. */
  check('leaving it unanswered refuses, on both buttons',
    /if\(!wire\)\{/.test(manualBtn) && /if\(!wire\)\{/.test(autoBtn),
    'she asked for it to be required, and a disabled button is still reachable by keyboard');
  /* ⚠ BEFORE close(), OR THE POPUP VANISHES ON A PRESS THAT DID NOTHING — which is a
     button that looks broken, on the one screen this ruling is about. */
  check('and a refused press leaves the popup up',
    manualBtn.indexOf('if(!wire)') < manualBtn.indexOf('close()') &&
    autoBtn.indexOf('if(!wire)') < autoBtn.indexOf('close()'),
    'returning after close() removes the popup and says nothing');

  /* ⚠ THE HANDLER IS THE BACKSTOP. What she actually sees is the button being off. */
  const gate = popup.slice(popup.indexOf('function refreshConvertWireGate'));
  check('the buttons are held while it is blank',
    /setConvertBtn\(convertManualBtn, !picked/.test(gate) &&
    /setConvertBtn\(convertAutoBtn, !picked \|\| !hasLights/.test(gate),
    'a refusal that only happens on the press is a button that looks broken');
  check('and the lights refusal still stands beside it',
    /!hasLights \?/.test(gate),
    'the wire guard must not swallow the one this popup cannot fix');
  check('one place decides whether a button is off',
    !/convertQuoteAutoBtn[^\r\n]*disabled|convertQuoteManualBtn[^\r\n]*disabled/.test(popup),
    'half in the markup and half in the gate is how the two start disagreeing about a button');
  check('and it says why it is off, not just that it is',
    /why\.textContent = off \? offWhy : okWhy/.test(popup),
    'a greyed button under its ordinary wording is a button that looks broken');

  /* ⛔ THE BLANK OPTION STAYS IN THE LIST AND IS RELABELLED. Dropped, the select opens
     preselected on the first real colour and one press saves White onto a house nobody
     looked at — the invented colour WH-35 and WH-40 both exist to stop, arriving by
     accident through the very change meant to make somebody choose. */
  /* ⚠ THE FIRST DRAFT OF THIS CHECK WAS WEAK AND THE RED-CHECK CAUGHT IT: it refused
     `.filter(`, and the sabotage that drops the blank one spells it `Array.prototype
     .filter.call(` — no literal `.filter(` anywhere in it. What has to be true is that
     EVERY option the form has is offered, so that is what is asserted: the mapper walks
     `real.options` itself and nothing narrows it. */
  check('the blank option survives as a placeholder rather than being dropped',
    /o\.value \? o\.textContent :/.test(opts) &&
    /map\.call\(real\.options,/.test(opts) && !/filter/.test(opts) && !/slice/.test(opts),
    'with no blank to open on, one press silently saves the first colour in the list');
  check('and it no longer offers itself as a way through',
    !/warehouse will check/.test(opts),
    'its own wording describes a route this popup no longer has');
  check('the note says what is missing rather than what a blank would cost',
    /Pick one before converting/.test(popup) && !/System Message/.test(popup),
    'the old wording described a blank reaching the record, which it no longer can');

  /* ⛔ AND THE ADD CUSTOMER SAVE IS DELIBERATELY UNTOUCHED. Its blank-wire branch is what
     raises the WH-40 System Message, and it is the only door that raises one. A customer
     typed in from scratch is not a conversion. */
  /* ⚠ THE STRETCH BETWEEN READING THE BOX AND WRITING THE CUSTOMER — which is the only
     place a refusal could sit. Anywhere past the write is too late to refuse anything, and
     that is where the notice's own `if(!wireColor)` lives. */
  const wireRead = clean.indexOf("getElementById('addCustWireColor').value");
  const beforeWrite = wireRead < 0 ? ''
    : clean.slice(wireRead, clean.indexOf('needsDayAssignedAt: serverTimestamp()', wireRead));
  check('the Add Customer save still lets a blank wire through',
    !!beforeWrite && !/if\(!wireColor\)/.test(beforeWrite) && /if\(!lightsDescription\)\{/.test(beforeWrite),
    'requiring it there makes the WH-40 notice unraisable at the one door that raises it');

  /* -------------------------------------------------------------------------
   * AND IT IS RUN, NOT READ
   *
   * ⚠ EVERY CLAIM ABOVE IS ABOUT A BUTTON BEING OFF ON SCREEN, and this repo has been
   * caught four times by a check that matched the source of something that could never
   * reach the page. So the real popup is rendered against jsdom and the buttons are
   * pressed. Without jsdom it NOTEs itself away rather than passing quietly.
   * ----------------------------------------------------------------------- */
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* not installed — reported below */ }
  /* ⛔ A MISSING jsdom IS A FAILURE HERE, NOT A SKIP. These are the only checks that prove
     the buttons are actually off; letting them note themselves away is the silent-skip
     failure this repo records in four other places. jsdom is a committed devDependency and
     the whole `npm test` chain already needs `npm install`. */
  check('jsdom is installed, so the popup below is really driven', !!JSDOM,
    'run npm install — without it nothing here proves a button is off');
  if (JSDOM) {
    /* The real Add Customer select, because the picker reads its options off it. */
    const dom = new JSDOM('<body><select id="addCustWireColor">' +
      '<option value="" selected>&mdash; not chosen, warehouse will check &mdash;</option>' +
      '<option value="White">White</option><option value="Green">Green</option></select></body>');
    const doc = dom.window.document;
    const converted = [];
    /* ⚠ LIFTED, NEVER STUBBED — a stub of `convertWireOptionsHtml` or `applyConvertWirePick`
       would decide the very thing under test. */
    const api = new Function('esc', 'jobAddresses', 'quoteChargesSetupFee', 'quotePhotoList',
      'perFootRate', 'showApplyRequoteChoice', 'fillAddCustFromQuote', 'goToAddCustomerForm',
      'toast', 'autoConvertQuoteToCustomer', 'fmtMoney', 'NEW_MEMBER_FEE', 'document',
      [lift('convertWireOptionsHtml'), lift('applyConvertWirePick'), lift('showConvertQuoteChoice')]
        .join('\n') + '\nreturn {open: showConvertQuoteChoice};')(
      function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
          return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
      },
      [], function () { return false; }, function () { return [{}]; }, 2,
      function () {}, function () { return {photoCount: 1, pricedFrom: 'quote'}; },
      function () {}, function () {},
      function () { converted.push([].slice.call(arguments)); },
      function (n) { return '$' + n; }, 30, doc);

    const quote = {name: 'Test House', street: '1 Elm', city: 'Lehi', phone: '8015550000',
      email: 'a@b.com', quotedPrice: 400, lightsDescription: 'Warm White', wireColor: ''};
    api.open('q1', quote);
    const sel = doc.getElementById('convertQuoteWire');
    const auto = doc.getElementById('convertQuoteAutoBtn');
    const man = doc.getElementById('convertQuoteManualBtn');
    const note = doc.getElementById('convertQuoteWireNote');
    const why = function (b) { return b.querySelector('span').textContent; };
    const click = function (el) { el.dispatchEvent(new dom.window.Event('click', {bubbles: true})); };

    check('a quote with no wire opens on the placeholder',
      sel && sel.value === '' && sel.options.length === 3 &&
      sel.options[0].textContent === '— pick one —' && sel.options[1].value === 'White',
      'every option the form has must be offered, with the blank one relabelled');
    check('and both buttons are off',
      auto.disabled === true && man.disabled === true,
      'auto ' + auto.disabled + ', manual ' + man.disabled);
    check('each saying to pick a wire first',
      /Pick a wire colour/.test(why(auto)) && /Pick a wire colour/.test(why(man)),
      'a greyed button under its ordinary wording is a button that looks broken');
    check('and the note says so too',
      /Pick one before converting/.test(note.textContent) &&
      note.style.color.indexOf('ember') > -1,
      note.textContent);
    click(man);
    click(auto);
    check('pressing either one while blank does nothing and leaves the popup up',
      converted.length === 0 && !!doc.querySelector('.needsfix-popup-overlay'),
      'a press that closes the popup and converts nobody is a button that looks broken');

    sel.value = 'Green';
    sel.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    check('picking one turns both buttons on',
      auto.disabled === false && man.disabled === false,
      'auto ' + auto.disabled + ', manual ' + man.disabled);
    check('and gives them their own wording back',
      /Save them now/.test(why(auto)) && /Add a Customer form/.test(why(man)),
      why(auto) + ' / ' + why(man));
    check('and the note names the wire it will save',
      /Green wire/.test(note.textContent), note.textContent);
    click(auto);
    check('and now it converts, carrying the answer',
      converted.length === 1 && converted[0][2] === 'Green' &&
      !doc.querySelector('.needsfix-popup-overlay'),
      JSON.stringify(converted));

    /* ⚠ THE WIRE GUARD MUST NOT SWALLOW THE LIGHTS ONE. A fixture with colours cannot see
       this, which is why there is a second one without them. */
    converted.length = 0;
    api.open('q2', {name: 'No Colours', street: '2 Oak', city: 'Lehi', phone: '8015550001',
      email: 'c@d.com', quotedPrice: 400, lightsDescription: '', wireColor: 'White'});
    const auto2 = doc.getElementById('convertQuoteAutoBtn');
    const man2 = doc.getElementById('convertQuoteManualBtn');
    check('a quote that already names a wire opens on it',
      doc.getElementById('convertQuoteWire').value === 'White',
      doc.getElementById('convertQuoteWire').value);
    check('so the manual path is open — it is where the no-colours message sends her',
      man2.disabled === false, man2.disabled);
    check('but no light colours still holds the automatic one',
      auto2.disabled === true, auto2.disabled);
    check('and it names the colours rather than the wire',
      /no light colours/i.test(why(auto2)),
      'the reason this popup cannot fix is the one that decides what she does next');
  }

  /* ⚠ AND THE ANSWER IS VISIBLE ON THE PATH THAT NEVER SHOWS HER THE FORM. */
  check('the automatic path names the wire it saved',
    /wirePick \? ', on ' \+ wirePick \+ ' wire' : ''/.test(auto),
    'that path never shows the form, so the toast is the only place it can be seen');
}

/* ---------------------------------------------------------------------------
 * ⭐ THE CUSTOMER IS ASKED AGAIN — ANY, GREEN, WHITE  ([[OPT-21]], 2026-09-18)
 *
 * Addie: "They should see Any, Green, White. With instructions on what to pick. If they
 * click any or keep it at any then it should allow us to pick and require us to pick the
 * wire."
 *
 * ⚠ THIS REVERSES [[OPT-12]], which took the question off the detail form outright (R-024),
 * and that row is marked rather than deleted because its reasoning is what makes this safe:
 * OPT-12 was refusing an INVENTED answer. The old control defaulted to 'Any' and STORED the
 * word, so most quotes carried a cord nobody had chosen. The question was never the fault.
 *
 * ⛔ SO EVERY CHECK HERE IS ULTIMATELY ABOUT ONE SENTENCE: "Any" stores NOTHING. A blank is
 * what the rest of the app already understands — whWireLabel reads it as Check lights
 * ([[WH-35]]), the System Message is raised off it ([[WH-40]]), and the convert popup
 * refuses to convert past it ([[WH-43]]), which is the second half of her own sentence.
 *
 * ⛔ AND THE PORTAL IS DELIBERATELY UNTOUCHED. `wireColor` is still out of
 * PORTAL_WRITE_FIELDS and PORTAL_READ_FIELDS, and test/wire-colour.spec.js still asserts
 * there is no control on the Changes tab. She asked about the form a NEW customer fills in;
 * offering "Any" to a member who already has Green would be offering to erase it.
 * ------------------------------------------------------------------------- */
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fns = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  /* The three radio pills, as one block. Anchored on the row's own id so a check about
     what she SEES cannot be answered by markup somewhere else on a 9,000-line page. */
  const rowAt = idx.indexOf('id="qdWireRow"');
  const wireRow = rowAt < 0 ? '' : idx.slice(rowAt, idx.indexOf('</div>', idx.indexOf('radio-row', rowAt)));

  check('the detail form asks for a wire colour again', !!wireRow,
    'OPT-21 put the question back on the form a new customer fills in');
  check('and it offers her three, in her order: Any, Green, White',
    /value="" checked>\s*Any/.test(wireRow) &&
    wireRow.indexOf('value="Green"') > wireRow.indexOf('value=""') &&
    wireRow.indexOf('value="White"') > wireRow.indexOf('value="Green"'),
    'Any first and pre-picked — "keep it at any" only means anything if that is where it starts');
  /* ⛔ THE VALUE IS THE RULING. A pill reading Any that POSTS the word 'Any' is exactly the
     stored default OPT-12 was written to refuse, and it would head a warehouse pile
     "Any wire" — a cord nobody makes. */
  check('and the Any pill carries no value at all',
    !/value="Any"/i.test(wireRow) && /name="wire_color" value=""/.test(wireRow),
    'a pill that posts the word Any is the invented colour OPT-12 refused, wearing a label');
  check('and it says what to pick and what Any means',
    /blends in with your roofline/i.test(wireRow) && /we&rsquo;ll choose/i.test(wireRow),
    'she asked for instructions — a picker with three bare words is the question without the help');

  /* ⚠ THE TWO COPIES OF ONE RULE. The browser decides what the radio posts and the server
     decides what is stored; a public callable reached with only a quote token cannot take
     the browser's word for it. money-parity's shape applied to a choice. */
  /* ⚠ `lift` READS admin.html AND THESE TWO DO NOT LIVE THERE — a lift() here returns ''
     and every check below it passes vacuously. Both are pulled from their own file. */
  const liftFrom = (src, decl) => {
    const i = src.indexOf(decl);
    return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i));
  };
  const qdChoice = liftFrom(idx, 'function qdWireChoice(');
  const svChoice = liftFrom(fns, 'function quoteWireChoiceServer(');
  check('both halves of the rule were found at all',
    !!qdChoice && !!svChoice,
    'a gate that cannot find its target must never report green');
  check('the browser holds the White-or-Green rule in its own function',
    /w === 'White' \|\| w === 'Green'/.test(qdChoice),
    'written inline in a 60-line submit handler it could only ever be read, never run');
  check('and the server holds the same one',
    /w === 'White' \|\| w === 'Green'/.test(svChoice),
    'the browser is a suggestion here — quoteSaveDetails is reached with nothing but a token');
  /* ⚠ RUN, NOT MATCHED. Two copies agreeing in their source is not two copies agreeing. */
  const runChoice = src => new Function('return (' + src.trim() + ')')();
  const qdFn = qdChoice ? runChoice(qdChoice + '\n}') : null;
  const svFn = svChoice ? runChoice(svChoice + '\n}') : null;
  check('and run side by side they answer the same for every value the form can post',
    !!qdFn && !!svFn && ['', 'Any', 'any', 'White', 'Green', 'white', 'Red', null, undefined, ' White ']
      .every(v => qdFn(v) === svFn(v)),
    'a browser and a server that disagree put a colour on a quote the office cannot save');
  check('and both refuse the word Any',
    !!qdFn && qdFn('Any') === '' && !!svFn && svFn('Any') === '',
    'this is the whole ruling: Any is an answer, and the way to record it is to store nothing');
  check('and both keep the two real colours exactly',
    !!qdFn && qdFn('White') === 'White' && qdFn('Green') === 'Green' &&
    !!svFn && svFn('White') === 'White' && svFn('Green') === 'Green',
    'a quote White is the one White the sweep keeps — see wireSweepClassify');

  /* ⛔ ABSENT, NOT BLANK, ON BOTH SIDES. `wireColor: ''` would erase a colour a re-quote
     prefilled off the member's own record (memberPrefill copies it onto the quote), which
     is this file's oldest rule — a blank never wipes what the record has — applied to the
     one field where a blank is also a legitimate answer. */
  const qdSubmit = (function () {
    const i = idx.indexOf("quoteDetailFormEl.addEventListener('submit'");
    return i < 0 ? '' : stripComments(idx.slice(i, idx.indexOf('\nfunction splitPhoneOrEmail', i)));
  })();
  check('the browser adds no key when they said Any',
    /if\(qdWire\) detailPayload\.wireColor = qdWire/.test(qdSubmit) &&
    !/wireColor:/.test(qdSubmit.slice(qdSubmit.indexOf('var detailPayload'), qdSubmit.indexOf('var qdWire'))),
    'a posted blank erases a wire a re-quote prefilled off the member\'s own record');
  const svSave = (function () {
    const i = fns.indexOf('exports.quoteSaveDetails');
    return i < 0 ? '' : stripComments(fns.slice(i, fns.indexOf('publicQuoteLookup', i)));
  })();
  check('and the server writes no field when they said Any',
    /if \(quoteWire\) quoteUpdate\.wireColor = quoteWire/.test(svSave) &&
    /quoteWireChoiceServer\(details\.wireColor\)/.test(svSave),
    'same erasure, one layer down — and the emailed-link path is the common one');
  /* ⚠ THE WHITELIST IS WHAT MAKES IT REACH THE QUOTE AT ALL. houseSides was lost exactly
     this way once: sent by the browser, dropped by the function, nothing wrong on screen. */
  check('and the update really is the object the whitelist built',
    /await db\.collection\('quotes'\)\.doc\(quoteId\)\.update\(quoteUpdate\)/.test(svSave),
    'a second update object here is how half the form silently stops being saved');
}

Promise.all(pendingAsync).then(function () {
  console.log('');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  console.log((failures.length ? '\n' : '') + pass + ' passed, ' + fail + ' failed\n');
  if (fail) {
    console.log('This card writes a colour onto a customer record and closes the only notice');
    console.log('that asks for it. A wrong answer here is indistinguishable, on every screen');
    console.log('afterwards, from a colour somebody chose.\n');
  }
  process.exit(fail ? 1 : 0);
});
