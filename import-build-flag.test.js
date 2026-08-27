/* WHO TELLS THE WAREHOUSE A HOUSE NEEDS BUILDING
 * ==============================================
 * `npm run test:import-build` — its own file per R-018.
 *
 * Six places create a `jobAddresses` record. Until 2026-08-26, TWO of them never set
 * `needsLightBuild`: the Bulk Updates importer (`rbImportBtn`) and the Invoice Bulk
 * Update importer (`ibImportBtn`). A house added by either kept its colours, its wire
 * and its timer and appeared in Needs Building nowhere at all — no bundle was made, and
 * the crew arrived at the house with nothing for it. `rbApplyTickedAdds`, the sheet
 * comparison path, was fixed on 2026-08-19 and is the model this follows.
 *
 * WHAT THIS FILE HOLDS TRUE
 *   1. Both ADD branches set the flag.
 *   2. It is literally `true` — never `pattern ? true : false`. Questions map WH-20:
 *      "we want to build everyone." A row with no colours belongs in the warehouse's own
 *      "Waiting on light colours" block, which is visible and actionable; gating the flag
 *      makes those houses invisible instead, which is the bug being closed.
 *   3. Neither UPDATE branch touches it. This is the most likely thing to go wrong and
 *      the most expensive: an import that matched an existing customer must never
 *      re-queue them, or a 900-row press rebuilds the entire book.
 *   4. `rbApplyTickedAdds` still sets it, ungated.
 *
 * ⚠ THESE ARE STRUCTURAL CHECKS, AND THAT IS A DELIBERATE EXCEPTION TO THE HOUSE RULE.
 * R-017 says assert on meaning, never on source strings, and CLAUDE.md's own repeated
 * lesson is "run the code, don't grep the source". Driving these two handlers for real
 * needs the whole Bulk Updates DOM — eighteen textareas, a Firestore stub, the
 * localStorage batching job and a geocoder — and a harness that elaborate fails for its
 * own reasons and gets deleted within a month. Recorded here as a knowing trade rather
 * than left to look like an oversight. What makes it survivable is that the claims are
 * about a literal flag in a literal object, which is the one shape a text check reads
 * honestly.
 *
 * ⚠ AND THE ONE THING THAT MAKES A TEXT CHECK DISHONEST IS COMMENTS. The explanatory
 * comment beside each flag CONTAINS THE WORDS `needsLightBuild: true`, so a check that
 * searched the raw block would stay green with the real flag deleted — a test a comment
 * can satisfy is not testing code. Every window here is passed through the SAME
 * `stripComments` the main suite uses, lifted out of `run-all.js` rather than copied, so
 * the two can never drift. Suites 58, 274 and 275 each learned this separately.
 *
 * ⚠ WINDOWS ARE CLIPPED AT A REAL STRUCTURAL MARKER, NEVER A CHARACTER COUNT. CLAUDE.md
 * §7 bans fixed-length extraction windows by name — and the meta-check that enforces it
 * reads only `run-all.js`, so nothing but this paragraph stops one appearing here. A
 * generous window from `rbImportBtn` swallows the whole of `ibImportBtn`, and the first
 * handler then appears to contain the second one's code.
 *
 * ⚠ EVERY WINDOW ASSERTS ITS OWN LANDMARKS FIRST. An extractor that has quietly stopped
 * matching reports NO violations — a green build for the worst possible reason, the same
 * shape as a suite that cannot find its target and skips.
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

/* ---------------------------------------------------------------------------
 * stripComments — LIFTED, NOT COPIED.
 *
 * It lives in run-all.js and carries two hard-won fixes that a fresh copy would not
 * have: `/*` is only treated as a comment after start-of-line, whitespace or one of
 * ;{}()[], (so one inside an attribute or a string survives), and `//` is only stripped
 * when not preceded by a colon (57 lines in admin.html hold an https:// and were having
 * their tails deleted). Both of those bugs fail in the SILENT direction — a negative
 * check passes for free over code it never looked at.
 *
 * run-all.js is a script, not a module, so the helper is read out of its source and
 * evaluated. That is the repo's own "lift, don't stub" rule (CLAUDE.md §3): a second
 * copy of a subtle helper is the copy that stops matching.
 * ------------------------------------------------------------------------- */
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
     `;` that closes it, which is the line holding the `//` replace. */
  const end = suite.indexOf("'$1');", start);
  if (end === -1) throw new Error('stripComments was found but its end could not be located in run-all.js');
  const src = suite.slice(start, end + "'$1');".length);
  const fn = eval('(function(){ ' + src + ' return stripComments; })()');
  if (typeof fn !== 'function') throw new Error('the lifted stripComments did not evaluate to a function');
  return fn;
})();

/* The lift is worth nothing if the thing lifted no longer strips. Proven against a
   fixture rather than assumed — the same red-check-yourself rule silent-failures.test.js
   uses. Both directions: a comment goes, real code stays. */
{
  const fixture = 'a: 1, /* needsLightBuild: true */ b: 2, // needsLightBuild: true\nc: 3';
  const out = stripComments(fixture);
  check('the lifted stripComments really strips comments',
    !/needsLightBuild/.test(out),
    'it returned ' + JSON.stringify(out) + ' — every check below leans on this, so a ' +
    'strip that has stopped working makes the whole file pass for free');
  check('and it leaves real code alone',
    /a: 1/.test(out) && /b: 2/.test(out) && /c: 3/.test(out),
    'a strip that eats code would make every positive check fail for the wrong reason');
}

const admin = read('admin.html');

/* ---------------------------------------------------------------------------
 * The windows.
 * ------------------------------------------------------------------------- */
function between(src, from, to, label) {
  const a = src.indexOf(from);
  if (a === -1) throw new Error(label + ': opening marker not found — ' + from);
  const b = to ? src.indexOf(to, a) : src.length;
  if (b === -1) throw new Error(label + ': closing marker not found — ' + to);
  return src.slice(a, b);
}

/* rbImportBtn — clipped at the Invoice Bulk Update banner, which is the next top-level
   construct in the file. Without this clip the Bulk Updates handler appears to contain
   the invoice importer's code and every check below answers about the wrong tool. */
const RB = between(admin,
  "document.getElementById('rbImportBtn').addEventListener",
  '// --- Invoice Bulk Update ---', 'rbImportBtn');

/* ibImportBtn — clipped at its own closer. */
const IB = between(admin,
  "document.getElementById('ibImportBtn').addEventListener",
  "return document.getElementById('ibImportBtn'); }));", 'ibImportBtn');

check('the two importers are separate windows',
  RB.length > 2000 && IB.length > 500 && !RB.includes('ibImportBtn') && !IB.includes('rbImportBtn'),
  'RB=' + RB.length + ' IB=' + IB.length + ' — if one window contains the other, every ' +
  'result below is about the wrong handler');

/* Inside each, the add branch and the update branch. The `else` of the existing/new
   test is the divide; both are anchored on the object literal each branch writes. */
const RB_ADD    = between(RB, 'const newDoc = {', null, 'rbImportBtn add branch');
const RB_UPDATE = between(RB, 'if(existing){', 'const newDoc = {', 'rbImportBtn update branch');
const IB_ADD    = between(IB, "await addDoc(collection(db,'jobAddresses'), {", null, 'ibImportBtn add branch');
const IB_UPDATE = between(IB, 'if(existingCust){', "await addDoc(collection(db,'jobAddresses'), {", 'ibImportBtn update branch');

/* ⚠ LANDMARKS FIRST. A branch that no longer matches produces an empty or wrong slice,
   and every "does not set the flag" check below then passes for free. These assert each
   window really is the branch it claims to be, using something unrelated to the flag. */
check('the Bulk Updates ADD branch is the one that writes a customer',
  /street: street/.test(RB_ADD) && /portalToken: generatePortalToken\(\)/.test(RB_ADD),
  'the add-branch window does not look like the newDoc literal');
check('the Bulk Updates UPDATE branch is the one that edits a customer',
  /updateDoc\(doc\(db,'jobAddresses',existing\.id\), updates\)/.test(RB_UPDATE),
  'the update-branch window does not contain the update write');
check('the Invoice ADD branch is the one that writes a customer',
  /difficulty: 'Unrated'/.test(IB_ADD) && /customersCreated\+\+/.test(IB_ADD),
  'the invoice add-branch window does not look like the addDoc literal');
check('the Invoice UPDATE branch is the one that edits a customer',
  /custUpdates/.test(IB_UPDATE) && /updateDoc\(doc\(db,'jobAddresses',existingCust\.id\)/.test(IB_UPDATE),
  'the invoice update-branch window does not contain the update write');

/* ⚠ AND IT RED-CHECKS ITSELF, ON THE REAL WINDOWS, EVERY RUN.
 *
 * The fixture above proves stripComments strips. That is not the same claim as "this
 * file's checks cannot be satisfied by a comment", which is what actually matters — and
 * with the real flags in place there is nothing left in the file for the strip to catch,
 * so gutting it would change nothing and the build would stay green. That is precisely
 * the sabotage silent-failures.test.js was caught missing until its fixture was made to
 * go through the same code path the real files do.
 *
 * So: take each REAL add branch, delete the real flag, and put it back as a COMMENT. The
 * positive check above must go red on that. Deliberately not written as "the comment must
 * name the field" — the comments happen not to today, that is a wording choice rather
 * than an invariant, and a check pinned to prose fails on correct code the moment
 * somebody rewrites a sentence (S82, S129, the folder-names suite). This asserts the
 * protection instead, which is true whatever the comments say.
 */
[['Bulk Updates', RB_ADD], ['Invoice Bulk Update', IB_ADD]].forEach(([label, win]) => {
  const sabotaged = win.replace(/needsLightBuild\s*:\s*true\s*,/,
    '/* needsLightBuild: true */');
  check('a commented-out flag would NOT satisfy the ' + label + ' check',
    sabotaged !== win && !/needsLightBuild\s*:/.test(stripComments(sabotaged)),
    'the flag put back as a comment still reads as set, so every positive check in this ' +
    'file could be satisfied by prose. A test a comment can satisfy is not testing code');
});

/* ---------------------------------------------------------------------------
 * 1 + 2. Both ADD branches set it, and set it to a literal true.
 * ------------------------------------------------------------------------- */
function flagValue(win) {
  const m = /needsLightBuild\s*:\s*([^,\r\n]+)/.exec(stripComments(win));
  return m ? m[1].trim() : null;
}

[['Bulk Updates (rbImportBtn)', RB_ADD], ['Invoice Bulk Update (ibImportBtn)', IB_ADD]].forEach(([label, win]) => {
  check(label + ' flags a newly added house for the warehouse',
    /needsLightBuild\s*:/.test(stripComments(win)),
    'a house added here keeps its colours and appears in Needs Building nowhere at ' +
    'all — no bundle is made and the crew arrives with nothing for it');

  check(label + ' sets it to a literal true, not a condition',
    flagValue(win) === 'true',
    'found ' + JSON.stringify(flagValue(win)) + '. Questions map WH-20: ungated, "we ' +
    'want to build everyone." A row with no colours belongs in the warehouse\'s own ' +
    '"Waiting on light colours" block — gating the flag makes those houses invisible, ' +
    'which is the bug this closes (WH-17, WH-18)');
});

/* ---------------------------------------------------------------------------
 * 3. Neither UPDATE branch touches it. The expensive one.
 * ------------------------------------------------------------------------- */
[['Bulk Updates (rbImportBtn)', RB_UPDATE], ['Invoice Bulk Update (ibImportBtn)', IB_UPDATE]].forEach(([label, win]) => {
  check(label + ' does NOT re-queue a customer it matched',
    !/needsLightBuild/.test(stripComments(win)),
    'an import that matches an existing customer must never flip this flag. Questions ' +
    'map WH-21. These tools write hundreds of records per press, so a row that matches ' +
    'and re-queues rebuilds the whole book — every house already built goes back on the ' +
    'warehouse list and somebody makes a second set for it');
});

/* ---------------------------------------------------------------------------
 * 4. The path that was already right stays right.
 * ------------------------------------------------------------------------- */
{
  const adds = between(admin, 'async function rbApplyTickedAdds(statusEl){', 'if(!list.length && !added.ran)', 'rbApplyTickedAdds');
  check('the sheet-comparison add path still flags the house',
    /needsLightBuild\s*:/.test(stripComments(adds)),
    'rbApplyTickedAdds is the path the other two were brought into line with — it was ' +
    'fixed on 2026-08-19 and losing it reopens hole B from the third direction');
  check('and it is still ungated there too',
    /needsLightBuild\s*:\s*true\s*,/.test(stripComments(adds)),
    'same rule, same reason: WH-20');
}

/* ---------------------------------------------------------------------------
 * 5. AND NOTHING UN-TELLS THE WAREHOUSE BECAUSE A FIELD IS EMPTY.
 *
 * The other direction, and the one that actually bit. Two places write the build flag
 * from a colour box: the Edit Customer save and the house-details panel on an All
 * Customers row. Both decide the same thing — "the colours changed, so rebuild" — and
 * both have a tail for the case where the box is EMPTY.
 *
 * Addie, 2026-08-21 (questions map WH-17): "big problem, she went to the recycle but not
 * to the build." Blank colours mean the build cannot be DONE yet, not that it is not
 * OWED. That is the whole reason the warehouse has a "Waiting on light colours" block:
 * a house dropped from the flag is in NEITHER list, which is invisible rather than
 * blocked.
 *
 * Edit Customer was fixed that day. The All Customers panel was missed and kept
 * `: false` until 2026-08-26 — one rule, two writers, one repaired. Nothing asserted
 * that the two agreed, which is the shape money-parity.test.js exists to prevent
 * elsewhere.
 *
 * ⚠ RUN, NOT GREPPED. The claim is about what the expression RETURNS for a house whose
 * build is owed, and a text check cannot see arithmetic. Each tail is lifted out of the
 * real file and evaluated against the four cases that matter.
 * ------------------------------------------------------------------------- */
{
  const WRITERS = [
    { label: 'the All Customers house-details panel', fn: 'attachAddressRowHandlers',
      re: /needsLightBuild:\s*(newLights[^\r\n]*?),\r?\n/, cust: 'existingCust', now: 'newLights' },
    { label: 'the Edit Customer save', fn: null,
      re: /addrUpdates\.needsLightBuild\s*=\s*(newLightsDescription[\s\S]*?);/, cust: 'item.data', now: 'newLightsDescription' }
  ];

  WRITERS.forEach(w => {
    const hay = w.fn ? between(admin, 'function ' + w.fn, null, w.fn) : admin;
    const m = w.re.exec(stripComments(hay));
    check(w.label + ' still decides the build flag from the colours',
      !!m,
      'the expression was not found — if it moved or was reshaped, repoint this lift ' +
      'rather than deleting the check; what must stay true is below');
    if (!m) return;

    const body = m[1];
    check(w.label + ' does not clear the flag when the colour box is empty',
      !/:\s*false\s*$/.test(body.trim()),
      'found a tail of `: false`. WH-17: blank colours mean the build cannot be DONE ' +
      'yet, not that it is not OWED. A house dropped from the flag appears in neither ' +
      'the build queue nor the Waiting on light colours block — invisible, not blocked, ' +
      'and no bundle is made for it');

    /* And prove it by running it, for the case that bit: a house whose build is owed
       and whose colours have never been filled in.

       ⚠ THE TWO WRITERS NAME THEIR INPUTS DIFFERENTLY — the panel reads the old value
       off the record (`existingCust.lightsDescription`), the Edit Customer save has it
       in a local (`oldLightsForBuild`). Every name both could use is supplied as a
       parameter so one runner drives both, rather than a copy of the expression per
       writer, which is the duplication this whole check exists to catch. */
    const run = new Function('existingCust', 'item', 'newLights', 'newLightsDescription',
      'oldLightsForBuild', 'return (' + body.replace(/;$/, '') + ');');
    const call = (rec, now, old) => run(rec, { data: rec }, now, now, old);
    const owed  = { lightsDescription: '', needsLightBuild: true };
    const built = { lightsDescription: 'Red, Green', needsLightBuild: false };
    check(w.label + ' keeps a build that is still owed',
      call(owed, '', '') === true,
      'saving with an empty colour box must leave an outstanding build outstanding');
    check(w.label + ' does not invent a build that is finished',
      call(built, 'Red, Green', 'Red, Green') === false,
      'a house whose bundle is made must not be re-queued by a save that changed nothing');
    check(w.label + ' still queues a real colour change',
      call(built, 'Red, Blue', 'Red, Green') === true,
      'a genuinely different pattern is a new bundle and must reach the warehouse');
  });
}

/* ---------------------------------------------------------------------------
 * Nothing new travels in the batching job.
 *
 * Bulk Updates imports BULK_CHUNK_SIZE rows, saves its place to localStorage and reloads
 * the page. Anything the import reads that is not one of the eighteen rbAreaIds boxes has
 * to be carried in that saved job, or the first batch behaves one way and every batch
 * after it behaves another — which is exactly what happened to the name flip on
 * 2026-08-17: fifty rows right and nine hundred wrong, looking identical to the flip
 * never working at all. A literal `true` reads no element, so nothing new travels. Suite
 * 41 walks every getElementById in the import and would fail if that changed; this check
 * states the claim locally so the reasoning is where the change is.
 * ------------------------------------------------------------------------- */
check('the added flag reads nothing from the page',
  !/needsLightBuild\s*:\s*[^,\r\n]*getElementById/.test(stripComments(RB_ADD)),
  'a flag derived from a DOM value would have to be carried in hu.bulkImportJob.v1, or ' +
  'it would differ across the reload boundary mid-import');

/* ------------------------------------------------------------------------- */
console.log('');
console.log('=== Who tells the warehouse a house needs building ===');
console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name + (f.why ? '\n     ' + f.why : '')));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
