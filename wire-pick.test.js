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

  /* ⛔ IT ASKS, IT NEVER REFUSES — [[WH-40]] exists because there is often genuinely nothing
     to answer from yet. A guard that blocks a legitimate conversion has no way round it. */
  /* \u26a0 AND THE FIRST DRAFT OF THIS CHECK FAILED ON CORRECT CODE, which is worth keeping:
     it looked for `disabled` within a fixed window of the select, and caught the LIGHTS
     guard on the Convert automatically button a few lines below. A fixed-length window is
     banned in this repo by name (\u00a77) and this is why. What has to be true is that neither
     button turns the wire into a refusal \u2014 so that is what is asserted, on each handler. */
  check('leaving it unanswered still converts',
    !/if\s*\(\s*!\s*wire\b/.test(manualBtn) && !/if\s*\(\s*!\s*wire\b/.test(autoBtn) &&
    !/convertQuoteWire[^\r\n]*disabled|disabled[^\r\n]*convertQuoteWire/.test(popup),
    'blocking the convert on this is the one thing WH-40 says not to do');
  check('and the blank option says what not answering costs',
    /Check[\s\S]{0,40}lights/.test(popup) && /System Message/.test(popup),
    'a blank with no consequence beside it reads as an optional extra');

  /* ⚠ AND THE ANSWER IS VISIBLE ON THE PATH THAT NEVER SHOWS HER THE FORM. */
  check('the automatic path names the wire it saved',
    /wirePick \? ', on ' \+ wirePick \+ ' wire' : ''/.test(auto),
    'that path never shows the form, so the toast is the only place it can be seen');
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
