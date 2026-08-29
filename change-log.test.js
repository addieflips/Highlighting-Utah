#!/usr/bin/env node
/* ============================================================================
 * WHAT CHANGED ON A CUSTOMER, IN WORDS — every editable field is accounted for.
 *
 * Addie, 2026-08-28, after every state a customer can be in had been given a date:
 * "Okay how can we get it so everything has stamps". Dates finished the STATES —
 * queued, built, hung, invoiced, paid, recycled. They cannot finish the EDITS. A
 * date can say the address moved on 3 October and never what it moved FROM, and
 * that is always the question being asked.
 *
 * So the Edit Customer save diffs what it is about to write against what the
 * record held, and logs one plain sentence per changed field.
 *
 * ⚠ THE FAILURE THIS GATE EXISTS FOR IS SILENCE. A field with no label does not
 * throw, does not warn, and does not appear — it simply never shows up in
 * anybody's history, which is indistinguishable from that field never having been
 * edited. So this is a CENSUS: every field the save handler writes must be either
 * LABELLED or explicitly QUIET, and a new one that is neither fails the build.
 *
 * ⚠ QUIET MUST CARRY A REASON, and the reason is checked. "Quiet" and "forgotten"
 * look identical in a list of field names, and a census cannot tell them apart —
 * the reason is the only thing that can, and it is written by whoever added the
 * field, when they still know why.
 *
 * ⚠ AND IT RUNS THE DIFF. A census proves a field is accounted for; only running
 * it proves the SENTENCE is right — that an unticked box saved as '' over a
 * stored false reports nothing, which is the difference between a log people read
 * and one they learn to scroll past.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let passed = 0, failed = 0, notes = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(m) { notes++; console.log('  NOTE  ' + m); }

const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

console.log('');
console.log('=== What changed on a customer ===');
console.log('');

/* ---------------------------------------------------------------------------
 * 0. Lift the real functions and run them.
 *
 * ⚠ LIFTED, NEVER RE-IMPLEMENTED. A second copy of the labels written here would
 * agree with itself about exactly the thing under test and say nothing at all
 * about the page. fmtMoney and toJsDate are stubbed only because they are shared
 * helpers with their own coverage; the labels, the quiet list, the value renderer
 * and the diff are all the shipped ones.
 * ------------------------------------------------------------------------- */
function lift(name, kind) {
  const re = new RegExp('(?:^|\\n)(?:const|function)\\s+' + name + '\\b');
  const m = re.exec(admin);
  if (!m) return '';
  const start = m.index + (admin[m.index] === '\n' ? 1 : 0);
  if (kind === 'arr') {
    const i = admin.indexOf('[', start);
    return admin.slice(start, admin.indexOf(']', i) + 2);
  }
  if (kind === 'obj') {
    let i = admin.indexOf('{', start), d = 0, k = i;
    for (;;) { if (admin[k] === '{') d++; else if (admin[k] === '}') { d--; if (!d) break; } k++; }
    return admin.slice(start, admin.indexOf(';', k) + 1);
  }
  let i = admin.indexOf('{', start), d = 0, k = i;
  for (;;) { if (admin[k] === '{') d++; else if (admin[k] === '}') { d--; if (!d) break; } k++; }
  return admin.slice(start, k + 1);
}

const parts = ['CUSTOMER_FIELD_LABELS', 'CUSTOMER_FIELD_QUIET'].map(n => lift(n, 'obj'))
  .concat([lift('CHANGE_EMPTY_TEXTS', 'arr')])
  .concat(['changeValueText', 'describeCustomerChanges', 'customerChangeSentence'].map(n => lift(n)))
  /* ⚠ NOT THROUGH lift(): it walks to the next brace, and the next brace after a
     plain number is the body of whatever function follows — which is how a lift of a
     one-line constant swallows a hundred lines of prose and dies on the first apostrophe
     in it. A number is matched as a number. */
  .concat([(/const CHANGE_LOG_MAX_FIELDS\s*=\s*\d+;/.exec(admin) || [''])[0]]);

check('every piece of the change log was found in admin.html', parts.every(Boolean),
  'a gate that cannot find its target must never report green — CLAUDE.md §9.2. ' +
  'Missing: ' + ['CUSTOMER_FIELD_LABELS', 'CUSTOMER_FIELD_QUIET', 'CHANGE_EMPTY_TEXTS',
    'changeValueText', 'describeCustomerChanges', 'customerChangeSentence',
    'CHANGE_LOG_MAX_FIELDS'].filter((n, i) => !parts[i]).join(', '));

let LABELS = {}, QUIET = {}, describe = null, sentence = null, valueText = null, MAXF = 0;
if (parts.every(Boolean)) {
  const fn = new Function('fmtMoney', 'toJsDate',
    parts.join('\n') +
    '\nreturn {LABELS: CUSTOMER_FIELD_LABELS, QUIET: CUSTOMER_FIELD_QUIET,' +
    ' describe: describeCustomerChanges, sentence: customerChangeSentence,' +
    ' valueText: changeValueText, MAXF: CHANGE_LOG_MAX_FIELDS};');
  const r = fn(
    n => '$' + (Number(n) || 0).toFixed(2),
    v => (v instanceof Date ? v : (v && typeof v.toDate === 'function' ? v.toDate() : null)));
  LABELS = r.LABELS; QUIET = r.QUIET; describe = r.describe;
  sentence = r.sentence; valueText = r.valueText; MAXF = r.MAXF;
}

/* ---------------------------------------------------------------------------
 * 1. The census — every field the save writes is labelled or deliberately quiet.
 * ------------------------------------------------------------------------- */
/* ⚠ READ OUT OF THE HANDLER, NOT TYPED HERE. A list of field names copied into
   this file is a second place to keep true, and the copy that falls behind is the
   one nobody is looking at — the exact shape of every "one rule, two writers" bug
   in this repo. So the handler is parsed and it is the handler that decides what
   this gate demands. */
function handlerSrc() {
  const at = admin.indexOf(
    "document.getElementById('editCustSaveBtn').addEventListener('click', async function(){");
  if (at < 0) return '';
  let b = admin.indexOf('{', admin.indexOf('async function()', at)), d = 0, k = b;
  for (;;) { if (admin[k] === '{') d++; else if (admin[k] === '}') { d--; if (!d) break; } k++; }
  return admin.slice(b + 1, k);
}
const H = handlerSrc();
check('the Edit Customer save handler was found', !!H,
  'the census below proves nothing against an empty string');

/* ⚠ BOTH SHAPES. Twenty-six fields arrive in one object literal and the rest are
   assigned one at a time on a branch — a census reading only the literal would miss
   every conditional field, which is most of the interesting ones. */
function fieldsWritten(src) {
  const out = new Set();
  let re = /addrUpdates\.([A-Za-z0-9_]+)\s*=[^=]/g, m;
  while ((m = re.exec(src))) out.add(m[1]);
  const i = src.indexOf('addrUpdates = {');
  if (i > -1) {
    let d = 0, k = src.indexOf('{', i);
    const start = k;
    for (;;) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } k++; }
    const lit = src.slice(start + 1, k);
    let lre = /(?:^|,)\s*([A-Za-z0-9_]+)\s*:/g, lm;
    while ((lm = lre.exec(lit))) out.add(lm[1]);
  }
  return [...out].sort();
}
const written = H ? fieldsWritten(H) : [];
check('the census found the fields the save writes', written.length > 30,
  'found ' + written.length + '. A matcher that has quietly stopped matching reports ' +
  'no violations at all, which is the worst kind of green.');

const unaccounted = written.filter(f => !(f in LABELS) && !(f in QUIET));
check('every field the save writes is either labelled or deliberately quiet',
  unaccounted.length === 0,
  'unaccounted: ' + unaccounted.join(', ') +
  '.\n        Give it a label in CUSTOMER_FIELD_LABELS so an edit to it shows in the ' +
  'customer\'s history, or put it in CUSTOMER_FIELD_QUIET with the reason it does not ' +
  'need one. Left out, edits to it are invisible — which reads exactly like the field ' +
  'never being edited.');

const both = Object.keys(LABELS).filter(f => f in QUIET);
check('no field is both labelled and quiet', both.length === 0,
  'in both lists: ' + both.join(', ') + ' — one of the two is a leftover, and which ' +
  'one wins depends on nothing anybody chose.');

const noReason = Object.keys(QUIET).filter(f => !QUIET[f] || String(QUIET[f]).length < 12);
check('every quiet field says why it is quiet', noReason.length === 0,
  'no reason given: ' + noReason.join(', ') + '. Quiet and forgotten look identical ' +
  'in a list of names, and this census cannot tell them apart either.');

const emptyLabel = Object.keys(LABELS).filter(f => {
  const s = LABELS[f];
  return !(typeof s === 'string' ? s : (s && s.label));
});
check('every labelled field has words to show', emptyLabel.length === 0,
  'no label: ' + emptyLabel.join(', ') + ' — a blank label prints ": old → new" ' +
  'with nothing saying which field moved');

/* ⚠ THE OTHER DIRECTION. A label for a field the handler no longer writes is dead
   weight rather than a fault, so it is a NOTE — but an unnoticed pile of them is how
   the list stops describing the form. */
const stale = Object.keys(LABELS).filter(f => written.indexOf(f) === -1);
if (stale.length) note(stale.length + ' labelled field(s) the save no longer writes: ' +
  stale.join(', ') + '. Not a failure — they may be written elsewhere — but if the ' +
  'form has dropped one, drop its label too.');

/* ---------------------------------------------------------------------------
 * 2. The diff, RUN.
 * ------------------------------------------------------------------------- */
if (describe) {
  const t = (before, updates) => describe(before, updates);

  check('a changed field is reported, both sides of it',
    t({outletTimer: 'off'}, {outletTimer: 'on'})[0] === 'Timer: off → on',
    '"the timer changed" without saying from what is a worse answer than none');

  check('a field that did not move is not reported',
    t({name: 'Jane', phone: '8015551234'}, {name: 'Jane', phone: '8015551234'}).length === 0,
    'a log that reports changes nobody made is one nobody reads');

  /* ⚠ THE CASE THAT MADE THIS RUN RATHER THAN READ. An unticked box comes back '' and
     the record stores false — different values, the same fact. Compared raw, EVERY save
     of every customer would report a row of tick boxes changing. */
  check('an unticked box saved over a stored false reports nothing',
    t({wantsMailedInvoice: false}, {wantsMailedInvoice: ''}).length === 0,
    "'' and false are the same answer and reporting them as a change is noise on " +
    'every single save');
  check('and a box genuinely being ticked does report',
    /Wants a posted invoice: no → yes/.test(t({wantsMailedInvoice: false},
      {wantsMailedInvoice: true})[0] || ''));

  check('a field being filled in for the first time says it was blank',
    t({}, {gateCode: '4412'})[0] === 'Gate code: (blank) → 4412',
    '"Gate code:  → 4412" reads as a rendering fault rather than somebody filling it in');
  check('and a field being cleared says so too',
    t({gateCode: '4412'}, {gateCode: ''})[0] === 'Gate code: 4412 → (blank)',
    'clearing a gate code is exactly the edit somebody will later want explained');

  check('money is shown as money',
    t({housePrice: 400}, {housePrice: 450})[0] === 'House price: $400.00 → $450.00',
    '"400 → 450" beside a list of prices invites the wrong reading');

  check('a field the save did not touch is never reported',
    t({phone: '8015551234'}, {name: 'Jane'}).every(s => s.indexOf('Phone') === -1),
    'reporting a field absent from the write claims an edit that did not happen');

  /* ⚠ ONE ENTRY, SEVERAL FIELDS. A save is one event — somebody sat down and changed
     four things — and a row each turns an afternoon of tidying into a wall. */
  const many = t({outletTimer: 'off', housePrice: 400},
                 {outletTimer: 'on', housePrice: 450});
  check('several fields in one save come back as several lines',
    many.length === 2);
  /* ⚠ THE ORDER IS THE LABEL MAP'S, NOT THE SAVE'S, so two saves touching the same
     fields read the same way round however the handler happened to assign them. Asserted
     as "both present after the name" rather than in a fixed order — pinning the order
     here would fail the day somebody adds a field in the middle of the map, on code that
     is right. */
  const one = sentence('Jane Smith', many);
  check('and they read as one sentence naming the customer',
    /^Edited Jane Smith — /.test(one) &&
    one.indexOf('Timer: off → on') > -1 && one.indexOf('House price: $400.00 → $450.00') > -1,
    'an entry that does not name who it is about cannot be read in a list');

  /* ⚠ AND THE CAP IS SAID, NOT SILENT. A list that quietly stops is worse than a short
     one, because nothing on screen says anything is missing. */
  const lots = [];
  for (let i = 0; i < MAXF + 3; i++) lots.push('Thing ' + i + ': a → b');
  const capped = sentence('Jane Smith', lots);
  check('a save touching more fields than fit says how many are not shown',
    capped.indexOf('(and 3 more)') > -1,
    'a list that just ends leaves nothing on screen saying it was cut');
  check('and it does not print them all',
    capped.indexOf('Thing ' + (MAXF + 1) + ':') === -1);

  check('nothing changed produces no sentence at all', sentence('Jane Smith', []) === '',
    'an entry reading "Edited Jane Smith —" is a record of nothing');

  /* ⚠ A NOTE RUNS TO PARAGRAPHS and one carried whole pushes every other change off
     the screen. Cut, and the cut is visible. */
  const long = 'x'.repeat(200);
  const noteLine = t({notes: ''}, {notes: long})[0];
  check('a very long note is cut rather than filling the entry',
    noteLine.length < 120 && noteLine.indexOf('…') > -1,
    'one note can be longer than everything else in the list put together');

  /* ⚠ THE NOISE CASE, AND IT IS THE ONE THAT DECIDES WHETHER THE LOG GETS READ.
     Records predating a field do not carry it, so the first save after one was added
     reports the form's own defaults as though somebody typed them. Measured on a thin
     fixture: six such lines out of nine, on a save that changed one thing. */
  check('a field the record never held, written empty, is not an edit',
    t({}, {referralCount: 0, houseSides: 1, gateCode: ''}).length === 1,
    'the first save after a field is added would otherwise report it for every ' +
    'customer in the book, which is how a log becomes something people scroll past');
  check('and the one carrying a real value still reports',
    t({}, {referralCount: 0, houseSides: 1, gateCode: ''})[0] ===
      'Sides of the house: (blank) → 1',
    'the rule is about a field arriving EMPTY, not about a field arriving at all — ' +
    'a first save that really does set something must still say so');
  /* ⚠ ABSENT, NOT MERELY EMPTY. A stored value going to blank is a real edit — usually
     the exact one somebody will later want explained. */
  check('but a stored value being cleared is still an edit',
    t({gateCode: '4412'}, {gateCode: ''})[0] === 'Gate code: 4412 → (blank)');

  check('a list field reads as a list',
    t({lightColors: ['Red']}, {lightColors: ['Red', 'Green']})[0] ===
      'Light colours picked: Red → Red, Green',
    'an array printed raw comes out as [object Object] or with brackets nobody types');

  check('a drawing is reported as saved or none, never as a URL',
    t({}, {layoutMapUrl: 'https://res.cloudinary.com/x/y.png'})[0] ===
      'Layout drawing: none → saved',
    'an eighty-character URL in a list of one-line changes is the whole line');

  check('a missing before-record does not throw and reports the new values',
    t(null, {name: 'Jane'})[0] === 'Name: (blank) → Jane',
    'a record that failed to load must not take the save down with it');
  check('and no updates at all comes back empty', t({name: 'Jane'}, null).length === 0);
}

/* ---------------------------------------------------------------------------
 * 3. The wiring — asserted separately from the rule.
 *
 * ⚠ THIS SUITE RUNS THE DIFF FROM ITS OWN HARNESS, so deleting the call from the
 * save handler would leave every check above green while nothing was ever logged.
 * That is the exact shape this repo has shipped before — the recycle "bin says" box
 * that rendered an input whose listener had silently not applied.
 * ------------------------------------------------------------------------- */
if (H) {
  const iDiff = H.indexOf('describeCustomerChanges(item.data, addrUpdates)');
  const iWrite = H.indexOf("updateDoc(doc(db,'jobAddresses', editCustomerId), addrUpdates)");
  const iLog = H.indexOf('customerChangeSentence(');
  check('the save handler takes the diff', iDiff > -1,
    'without this call nothing is ever logged and the whole gate above proves nothing');
  check('and writes it to the activity log', iLog > -1);
  check('the diff is taken BEFORE the record is written',
    iDiff > -1 && iWrite > -1 && iDiff < iWrite,
    'item.data is mirrored from the cache the moment the save lands, so a diff taken ' +
    'afterwards compares the new record with itself and reports nothing ever changing');
  check('and the entry is written AFTER it',
    iLog > -1 && iWrite > -1 && iLog > iWrite,
    'an entry for a save that then failed is a history of something that did not happen');
  check('the log call is not awaited',
    !/await\s+logActivity\(customerChangeSentence/.test(H),
    'a note about a change must never be able to break the change — it carries its ' +
    'own catch and every other logActivity call in the page is fire-and-forget');
}

/* ---------------------------------------------------------------------------
 * 3b. A WAIVED FEE IS A DECISION, AND IT LEFT NO TRACE AT ALL.
 *
 * `lightFeeWaived` is a LOCAL VARIABLE in the Edit Customer save. It decides whether the
 * $30 light-change fee is charged and then goes out of scope: nothing is written, no field
 * moves, and the only thing that ever said it happened was a toast, which is gone the
 * moment somebody looks away.
 *
 * ⚠ THE ASYMMETRY IS THE FAULT. A fee that IS charged lands on the invoice as a
 * `changeFeeNotes` entry with its own amount, reason and date, and `historyNoteRows` reads
 * it straight onto the customer's history. A fee that is WAIVED produced nothing anywhere,
 * so "why was this customer not charged for changing their colours" had no answer and the
 * record was indistinguishable from one where nobody was ever asked.
 *
 * ⚠ AND THE EDIT LOG COULD NEVER HAVE COVERED IT: that sentence lists what CHANGED, and a
 * waiver is precisely a thing that did not.
 * ------------------------------------------------------------------------- */
{
  const at = admin.indexOf("logActivity(customerChangeSentence");
  const region = at > -1 ? admin.slice(at, admin.indexOf('Pool bookkeeping', at)) : '';
  check('the waiver region was found', region.length > 0,
    'the checks below prove nothing against a string that is not there');

  check('waiving the light-change fee is recorded',
    /logActivity\('Waived the '/.test(region),
    'the only thing that said it happened was a toast, and a toast is gone the moment ' +
    'somebody looks away — "why was this customer not charged" had no answer anywhere');

  /* ⚠ THE AMOUNT IS THE WHOLE QUESTION. "A fee was waived" beside a name leaves the one
     thing anybody is asking — how much — exactly where it was. */
  check('and it says how much',
    /fmtMoney\(lightChange\.feeAmount\)/.test(region),
    'a waiver with no amount answers nothing');

  /* ⚠ GUARDED ON BOTH, NOT ON THE FLAG ALONE. `lightFeeWaived` starts false and stays
     false when there was no fee to waive in the first place — but a future edit that
     defaults it the other way would log a waiver on every ordinary save, which is how a
     log stops being read. */
  check('and only when there really was a fee to waive',
    /lightChange\.feeAmount > 0 && lightFeeWaived/.test(region),
    'guarded on the flag alone, an ordinary save would eventually log a waiver that ' +
    'never happened — and a log with invented rows in it is one nobody trusts');

  /* ⚠ ITS OWN ROW, NOT FOLDED INTO THE EDIT SENTENCE. That sentence is capped at twelve
     fields, so a waiver folded in would be the first line dropped by the cap and the last
     one anybody would think to look for. */
  const iEdit = region.indexOf('customerChangeSentence');
  const iWaive = region.indexOf("logActivity('Waived the '");
  check('it is a row of its own, after the edit row',
    iEdit > -1 && iWaive > -1 && iWaive > iEdit,
    'edit at ' + iEdit + ', waiver at ' + iWaive);

  /* ⚠ AND IT IS AFTER THE WRITE, like every other row here: an entry for a save that then
     failed is a history of something that did not happen. */
  const iWrite = region.indexOf("updateDoc(doc(db,'jobAddresses', editCustomerId)");
  const whole = at > -1 ? admin.slice(admin.lastIndexOf('const custChanges', at), admin.indexOf('Pool bookkeeping', at)) : '';
  check('and it is written after the record is',
    whole.indexOf("updateDoc(doc(db,'jobAddresses'") > -1 &&
    whole.indexOf("logActivity('Waived the '") > whole.indexOf("updateDoc(doc(db,'jobAddresses'"),
    'an entry for a save that then failed is a history of something that did not happen');

  /* ⚠ NOT AWAITED — a note about a decision must never be able to break the decision, the
     same guarantee every other logActivity call in this handler carries. */
  check('and it cannot break the save',
    !/await\s+logActivity\('Waived the '/.test(region),
    'every other logActivity call in this page is fire-and-forget and carries its own catch');
}

/* ---------------------------------------------------------------------------
 * 4. THE CUSTOMER'S OWN HALF — and the two copies agree about every word.
 *
 * ⭐ THE OFFICE HALF LOOKED COMPLETE, WHICH IS WHY NOBODY NOTICED (2026-08-29). The
 * activity log is written only from admin.html, so a timer switched on in Edit Customer
 * produced "Timer: no → yes" and the same switch flicked by the CUSTOMER in their own
 * portal produced nothing at all — not a stamp, not a line. Addie's list ended "or changed
 * timer settings this date. Changed address this date", and half of both was missing.
 *
 * ⚠ TWO COPIES, SO A PARITY TEST — the same answer this repo gives the invoice maths, and
 * for the same reason: a browser ES module and a Node function cannot share code. What
 * keeps it small is the SCOPE: the portal can only ever write PORTAL_WRITE_FIELDS, so the
 * server table is exactly that set, and this runs both copies over every one of them.
 *
 * ⚠ IT ASSERTS THEY AGREE, AND SEPARATELY THAT THEY ARE RIGHT. Two copies wrong in the
 * same way agree perfectly — the lesson money-parity already carries in its own comment.
 * ------------------------------------------------------------------------- */
{
  const fns = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  function liftServer(name, kind) {
    const re = new RegExp('(?:^|\\n)(?:const|function|async function)\\s+' + name + '\\b');
    const m = re.exec(fns);
    if (!m) return '';
    const start = m.index + (fns[m.index] === '\n' ? 1 : 0);
    const open = kind === 'arr' ? '[' : '{';
    const close = kind === 'arr' ? ']' : '}';
    let i = fns.indexOf(open, start), d = 0, k = i;
    if (i < 0) return '';
    for (; k < fns.length; k++) {
      if (fns[k] === open) d++;
      else if (fns[k] === close) { d--; if (!d) break; }
    }
    return fns.slice(start, k + 1) + (kind === 'fn' ? '' : ';');
  }
  const sParts = [
    liftServer('PORTAL_CHANGE_LABELS', 'obj'),
    liftServer('PORTAL_CHANGE_EMPTY_TEXTS', 'arr'),
    liftServer('portalChangeValueText', 'fn'),
    liftServer('describePortalChanges', 'fn'),
    liftServer('portalChangeSentence', 'fn'),
    /* ⚠ MATCHED AS A NUMBER, NOT LIFTED. lift walks to the next brace, and the next brace
       after a plain number is the body of whatever function follows — which is how a lift
       of a one-line constant swallows a hundred lines of prose. The office copy learned
       this the same way, and its comment says so. */
    (/const PORTAL_CHANGE_MAX_FIELDS\s*=\s*\d+;/.exec(fns) || [''])[0]
  ];
  check('every piece of the portal change log was found in functions/index.js',
    sParts.every(Boolean),
    'a gate that cannot find its target must never report green. Missing: ' +
    ['PORTAL_CHANGE_LABELS', 'PORTAL_CHANGE_EMPTY_TEXTS', 'portalChangeValueText',
     'describePortalChanges', 'portalChangeSentence', 'PORTAL_CHANGE_MAX_FIELDS']
      .filter((n, i) => !sParts[i]).join(', '));

  let sLabels = {}, sDescribe = null, sSentence = null;
  if (sParts.every(Boolean)) {
    const r = new Function(sParts.join('\n') +
      '\nreturn {L: PORTAL_CHANGE_LABELS, d: describePortalChanges, s: portalChangeSentence};')();
    sLabels = r.L; sDescribe = r.d; sSentence = r.s;
  }

  /* ⚠ THE SCOPE IS READ OUT OF PORTAL_WRITE_FIELDS, never typed here. That list is what
     the portal can actually write and is where a new portal field gets added; a copy in
     this file is a second place to keep true, and the copy that falls behind is the one
     that stops demanding anything. */
  const wf = [];
  {
    const at = fns.indexOf('const PORTAL_WRITE_FIELDS = {');
    const block = at > -1 ? fns.slice(at, fns.indexOf('\n};', at)) : '';
    let m;
    const re = /'([A-Za-z0-9_]+)'/g;
    while ((m = re.exec(block))) if (['info', 'preferences', 'lights', 'sides', 'cancel']
      .indexOf(m[1]) === -1) wf.push(m[1]);
  }
  check('the portal-writable fields were read out of PORTAL_WRITE_FIELDS',
    wf.length >= 14,
    'found ' + wf.length + ' — a scope that has stopped matching demands nothing');

  /* ⚠ EVERY FIELD THE PORTAL CAN WRITE IS IN BOTH TABLES. A field one side knows and the
     other does not is silence on that side: the office would report it and the customer's
     own change of it would vanish, or the other way round — and neither throws. */
  const missingServer = wf.filter(f => !(f in sLabels));
  const missingBrowser = wf.filter(f => !(f in LABELS));
  check('every field the portal can write has a label on the server',
    missingServer.length === 0,
    'no label: ' + missingServer.join(', ') +
    '.\n        An unlabelled field is silence — the customer changes it and nothing ever ' +
    'appears on their history, which looks exactly like them never having changed it.');
  check('and the same fields have one in the office copy',
    missingBrowser.length === 0,
    'no label: ' + missingBrowser.join(', ') +
    '. The two tables must cover the same fields or they spell the same save differently.');

  /* ⚠ RUN SIDE BY SIDE OVER EVERY FIELD, in the four shapes that actually go wrong: a
     blank filling in, a value changing, a value being cleared, and — the one that bit the
     office copy — an unticked box arriving as '' over a stored false. */
  if (sDescribe && describe) {
    const CASES = [
      ['a blank being filled in', undefined, 'something'],
      ['a value changing', 'before', 'after'],
      ['a value being cleared', 'before', ''],
      ['an unticked box over a stored false', false, ''],
      ['a ticked box', false, true],
      ['a number arriving', 0, 3]
    ];
    const disagree = [];
    wf.forEach(f => {
      CASES.forEach(([label, a, b]) => {
        const was = {}; was[f] = a;
        const now = {}; now[f] = b;
        const x = describe(was, now).join(' | ');
        const y = sDescribe(was, now).join(' | ');
        if (x !== y) disagree.push(f + ' / ' + label + ': office "' + x + '" vs portal "' + y + '"');
      });
    });
    check('both copies say exactly the same thing about every portal field',
      disagree.length === 0,
      disagree.slice(0, 6).join('\n        ') +
      (disagree.length > 6 ? '\n        ...and ' + (disagree.length - 6) + ' more' : '') +
      '\n        Change one and change the other in the same push — the office and the ' +
      'customer must not describe one save two ways.');

    /* ⚠ AND THEY ARE RIGHT, NOT MERELY EQUAL. Two copies wrong in the same way agree
       perfectly, which is exactly what money-parity warns about in its own comment. The
       tick-box case is the one that was actually wrong once. */
    check('an unticked box saved over a stored false reports nothing, both sides',
      sDescribe({ specificOutlet: false }, { specificOutlet: '' }).length === 0 &&
      describe({ specificOutlet: false }, { specificOutlet: '' }).length === 0,
      'the same bug the office copy shipped once: read blank-first, every save of every ' +
      'customer reports a row of tick boxes changing');
    /* ⚠ THIS CHECK WAS VACUOUS ON THE FIRST PASS AND THE RED-CHECK CAUGHT IT, which is
       worth writing down because the reason is not obvious: `hasOwnProperty` is TRUE for a
       key explicitly set to undefined, so every fixture written as `{f: undefined}` sails
       past the guard without reaching it — and for a yes/no field the two sides render
       'no' either way, so the earlier `a === b` return fires first and the guard is never
       consulted at all. Dropping it entirely left the whole section green.
       ⚠ IT TAKES A FIELD GENUINELY ABSENT AND A NEW VALUE THAT RENDERS AS AN EMPTY TEXT
       BUT NOT AS '(blank)' — a zero. Then a = '(blank)', b = '0', the values differ, and
       the guard is the only thing standing between that and a row of noise on the history
       of every record written before the field existed. */
    check('a field the record never held, arriving at its own default, is not an edit',
      sDescribe({}, { houseSides: 0 }).length === 0 &&
      describe({}, { houseSides: 0 }).length === 0,
      'server: ' + JSON.stringify(sDescribe({}, { houseSides: 0 })) +
      ', office: ' + JSON.stringify(describe({}, { houseSides: 0 })) +
      '. Every record written before a field existed would report it on the first save ' +
      'that touched it — a row of noise on the history of the whole book.');
    /* ⚠ AND A RECORD THAT REALLY DID HOLD IT STILL REPORTS THE CHANGE. The guard must skip
       the never-held case and nothing else; a version that skipped every zero would hide
       somebody dropping from three sides to none. */
    check('but a field that really was there and went to zero still reports',
      sDescribe({ houseSides: 3 }, { houseSides: 0 }).length === 1 &&
      describe({ houseSides: 3 }, { houseSides: 0 }).length === 1,
      'server: ' + JSON.stringify(sDescribe({ houseSides: 3 }, { houseSides: 0 })));
    check('a real change really is reported',
      /Timer: \(blank\) → yes/.test(sDescribe({}, { outletTimer: 'yes' }).join('')),
      'got: ' + sDescribe({}, { outletTimer: 'yes' }).join(' | '));

    /* ⚠ THE SENTENCE SAYS IT WAS THEM. Every other row in the activity log is one of the
       four people who share the dashboard, so a portal edit worded like an office one is
       the log actively answering "who changed this" wrongly. */
    check('the portal sentence says the customer did it themselves',
      /themselves|their portal/i.test(sSentence(['Timer: no → yes'])),
      'got: ' + sSentence(['Timer: no → yes']));
    check('and it is capped, and says that it is capped',
      /and 3 more/.test(sSentence(Array.from({ length: 15 }, (_, i) => 'F' + i + ': a → b'))),
      'got: ' + sSentence(Array.from({ length: 15 }, (_, i) => 'F' + i + ': a → b')));
    check('nothing changed produces no sentence at all',
      sSentence([]) === '' && sSentence(null) === '',
      'an entry saying nothing changed is a row nobody can act on');
  }

  /* ⚠ AND IT IS ACTUALLY CALLED, ON THE REAL SAVE PATH, IN THE RIGHT ORDER. The rule can
     be perfect while nothing invokes it — the split this repo has been caught by twice
     today. The diff must be taken BEFORE the write (afterwards it compares the record with
     itself) and posted AFTER it (a line about a save that then failed is a history of
     something that did not happen). */
  const at = fns.indexOf('exports.portalSave');
  const body = at > -1 ? fns.slice(at, fns.indexOf('\nexports.', at + 10)) : '';
  const iDiff = body.indexOf('describePortalChanges(oldData, updates)');
  const iWrite = body.indexOf("jobAddresses').doc(match.id).update(updates)");
  const iLog = body.indexOf('logPortalChange(match.id');
  check('portalSave takes the diff before it writes',
    iDiff > -1 && iWrite > -1 && iDiff < iWrite,
    'diff at ' + iDiff + ', write at ' + iWrite +
    '. Taken afterwards it compares the new record with itself and reports nothing.');
  check('and posts the entry after the write has landed',
    iLog > -1 && iWrite > -1 && iLog > iWrite,
    'an entry for a save that then failed is a history of something that did not happen');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
if (failed) {
  console.log('');
  console.log('Failing: ' + failures.join(' | '));
  process.exit(1);
}
