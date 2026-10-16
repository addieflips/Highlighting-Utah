/* THE ONE SHE EDITED LAST IS THE ONE THAT SENDS
 * ==============================================
 * `npm run test:templatepick`. Its own file per R-018. Ruling [[EM-35]].
 *
 * Addie, told she had two templates stored under one name and should delete the spare:
 * "Why do I need to delete the old copy and make a new one. Can you make it so that it
 * will register changes?"
 *
 * ⛔ TWO TEMPLATES CAN SHARE A NAME AND EVERY SENDER LOOKS ONE UP BY NAME. Before this the
 * winner was whichever Firestore handed back first — `where(…).limit(1)` on the server and
 * `.find()` in the browser — so editing "the" template could leave the other copy, with
 * the old wording, as the one customers receive. An edit that does not register reads as
 * the editor being broken, which is how it was reported.
 *
 * ⛔ THE CHECK THAT EARNS THE FILE IS THE PARITY RUN. The rule lives twice —
 * `pickNewestTemplate` in admin.html, `pickNewestTemplateServer` in functions/index.js —
 * because one is a browser module and the other is Node inside Cloud Functions. Both are
 * LIFTED out of the shipped files and run over the SAME templates: if they ever disagree
 * about the winner, the office previews one wording and the customer receives another, and
 * nothing else anywhere would notice. money-parity's shape applied to a choice.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + label); }
}

const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const fns = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');

/* ⚠ LIFTED, NEVER RE-WRITTEN HERE. A copy of the rule in this file would agree with
   itself and say nothing about what ships — the mistake the dry run made about its own
   template matching the day before this. Sliced between real anchors rather than by a
   character count, which §7 bans by name. */
function lift(src, startAnchor, endAnchor, what) {
  const a = src.indexOf(startAnchor);
  if (a === -1) throw new Error('could not find ' + what + ' (start anchor)');
  const b = src.indexOf(endAnchor, a);
  if (b === -1) throw new Error('could not find ' + what + ' (end anchor)');
  return src.slice(a, b);
}

const browserSrc = lift(admin, 'function tplEditedMillis(t){', 'function getEmailTemplateByName(', 'the browser picker');
const serverSrc = lift(fns, 'function tplEditedMillisServer(d) {', 'async function findTemplateSnapByName(', 'the server picker');

const pickBrowser = new Function(browserSrc + '\nreturn pickNewestTemplate;')();
const pickServer = new Function(serverSrc + '\nreturn pickNewestTemplateServer;')();

/* The two copies read different shapes, because that is what they are handed in life: the
   browser holds {id, data} off its snapshot cache, the server holds query documents whose
   data() is a function. One fixture, both shapes, so a disagreement cannot hide in the
   accessor. */
const ts = ms => ({ toMillis: () => ms });
function asBrowser(rows) { return rows.map(r => ({ id: r.id, data: r.d })); }
function asServer(rows) { return rows.map(r => ({ id: r.id, data: () => r.d })); }
function bothPick(rows) {
  const b = pickBrowser(asBrowser(rows));
  const s = pickServer(asServer(rows));
  return { b: b && b.id, s: s && s.id, agree: (b && b.id) === (s && s.id) };
}

console.log('');
console.log('--- the most recently edited copy wins ---');
console.log('');

const EDITED_LAST = [
  { id: 'old', d: { name: 'Nightly Auto-Invoice', body: 'the old wording', updatedAt: ts(1000) } },
  { id: 'new', d: { name: 'Nightly Auto-Invoice', body: 'the wording she just typed', updatedAt: ts(9000) } }
];
let r = bothPick(EDITED_LAST);
check('the copy with the newer updatedAt is the one that sends', r.b === 'new' && r.agree,
  'browser picked ' + r.b + ', server picked ' + r.s);

/* ⚠ ORDER IN MUST NOT DECIDE IT. The old behaviour was first-match-wins on both sides, so
   a fixture that happens to list the newest first passes whether this works or not — the
   same list is fed in reversed and must give the same answer. */
r = bothPick(EDITED_LAST.slice().reverse());
check('and it does not matter which order they arrive in', r.b === 'new' && r.agree,
  'this is the check the old first-match behaviour fails');

r = bothPick([
  { id: 'a', d: { name: 'X', body: 'words', createdAt: ts(500) } },
  { id: 'b', d: { name: 'X', body: 'words', updatedAt: ts(400) } }
]);
check('an edit beats a later-created copy only by its own date, with createdAt as the fallback',
  r.b === 'a' && r.agree,
  'a template nobody has edited since it was made has only createdAt to go on');

console.log('');
console.log('--- a blank copy can never win ---');
console.log('');

/* ⛔ THE SHIPPED-TEMPLATE FILLER PATCHES AN EMPTY SHELL BY ITSELF, so a shell really can be
   the most recently touched copy of a name — and a template with no body sends an empty
   email. Date alone would hand her customers a blank invoice. */
r = bothPick([
  { id: 'hers', d: { name: 'X', body: 'her real wording', updatedAt: ts(1000) } },
  { id: 'shell', d: { name: 'X', body: '   ', updatedAt: ts(9999) } }
]);
check('a blank body loses to a real one however new it is', r.b === 'hers' && r.agree,
  'browser picked ' + r.b + ', server picked ' + r.s);
r = bothPick([
  { id: 'shellA', d: { name: 'X', body: '', updatedAt: ts(10) } },
  { id: 'shellB', d: { name: 'X', updatedAt: ts(20) } }
]);
check('and when every copy is blank it still answers, rather than nothing',
  !!r.b && r.agree,
  'returning undefined here would send the built-in wording, which is a different bug');

console.log('');
console.log('--- two undated copies pick the same one every time ---');
console.log('');

const UNDATED = [
  { id: 'zzz', d: { name: 'X', body: 'one' } },
  { id: 'aaa', d: { name: 'X', body: 'two' } }
];
const first = bothPick(UNDATED);
const again = bothPick(UNDATED.slice().reverse());
check('the document id is the last tiebreak, so the winner is stable',
  first.b === 'aaa' && again.b === 'aaa' && first.agree && again.agree,
  'arrival order is not stable across reloads; the wording would change between sends ' +
  'with nothing on the record to explain it');

console.log('');
console.log('--- a single template is unaffected ---');
console.log('');

r = bothPick([{ id: 'only', d: { name: 'X', body: 'words' } }]);
check('one template of that name is simply returned', r.b === 'only' && r.agree);
check('and an empty list answers nothing rather than throwing',
  pickBrowser([]) === undefined && pickServer([]) === undefined);

console.log('');
console.log('--- a timestamp arrives in more than one shape ---');
console.log('');

/* ⚠ Firestore hands the browser a Timestamp with toMillis(); the admin SDK can hand the
   server `_seconds`; an imported or hand-written record can hold a plain string. A shape
   one copy understands and the other does not is a disagreement about which wording
   sends, so every shape is run through both. */
const SHAPES = [
  ['toMillis()', { updatedAt: ts(9000) }, { updatedAt: ts(1000) }],
  ['_seconds', { updatedAt: { _seconds: 9 } }, { updatedAt: { _seconds: 1 } }],
  ['seconds', { updatedAt: { seconds: 9 } }, { updatedAt: { seconds: 1 } }],
  ['an ISO string', { updatedAt: '2026-10-15T00:00:00Z' }, { updatedAt: '2026-01-01T00:00:00Z' }]
];
for (const [what, newer, older] of SHAPES) {
  /* ⚠ THE IDS ARE CHOSEN SO THE TIEBREAK CANNOT GIVE THE RIGHT ANSWER BY ACCIDENT, and a
     red-check is what demanded it: with ids 'older'/'newer' a copy that had stopped
     reading `_seconds` scored both templates 0, fell through to the id tiebreak, and
     'newer' sorts before 'older' — so the sabotage passed. The newest copy is now the
     one the tiebreak would LOSE, which is the only arrangement that proves the date was
     read at all. */
  const rows = [
    { id: 'aaa-older', d: Object.assign({ name: 'X', body: 'old' }, older) },
    { id: 'zzz-newer', d: Object.assign({ name: 'X', body: 'new' }, newer) }
  ];
  const got = bothPick(rows);
  check('a date given as ' + what + ' is read the same way by both copies',
    got.b === 'zzz-newer' && got.agree,
    'browser picked ' + got.b + ', server picked ' + got.s);
}
/* A junk date must read as "no date", never as the epoch beating a real stamp or as NaN
   poisoning the sort — a NaN comparator leaves the order to the engine. */
r = bothPick([
  { id: 'real', d: { name: 'X', body: 'words', updatedAt: ts(5000) } },
  { id: 'junk', d: { name: 'X', body: 'words', updatedAt: 'whenever' } }
]);
check('an unreadable date loses to a real one rather than scrambling the sort',
  r.b === 'real' && r.agree);

console.log('');
console.log('--- the lookups go through the rule, and nothing picks first-match ---');
console.log('');

/* ⚠ THE WIRING IS ASSERTED SEPARATELY FROM THE RULE. Everything above runs the picker from
   its own harness, so deleting the call from either lookup would leave all of it green
   while both senders went back to first-match — the shape this repo has shipped once
   before (the recycle "bin says" box, rendered with no listener and green all the way). */
check('the browser lookup asks the rule instead of taking the first match',
  /function getEmailTemplateByName\(name\)\{\s*const hits = emailTemplates\.filter\(t => t\.data\.name === name\);\s*return hits\.length \? pickNewestTemplate\(hits\) : undefined;/.test(admin),
  'emailTemplates.find(…) is arbitrary among duplicates');
check('and the server lookup filters every match and asks the rule',
  /const hits = all\.docs\.filter\(\(d\) => tplNameKey\(\(d\.data\(\) \|\| \{\}\)\.name\) === want\);/.test(fns) &&
  /docs: \[pickNewestTemplateServer\(hits\)\]/.test(fns));
/* ⛔ THE EXACT-NAME QUERY IS THE HALF THAT HAD TO GO. It returned an arbitrary one of the
   duplicates and short-circuited before the picker could see any of them, so leaving it in
   place makes every check above unreachable in production while they all pass here. */
check('the arbitrary exact-name short-circuit is gone',
  !/where\('name', '==', name\)\.limit\(1\)/.test(fns),
  'where(…).limit(1) answers before the picker is ever consulted');
check('the server still flattens dashes and case when matching the name',
  /const want = tplNameKey\(name\);/.test(fns),
  'an em dash, en dash and hyphen are indistinguishable in a text box');

console.log('');
console.log('--- an edit writes the date the rule reads ---');
console.log('');

/* ⛔ WITHOUT THIS THE WHOLE RULE IS INERT, and silently: the picker would sort by a field
   nothing writes, every copy would score 0, and the tiebreak alone would decide — so her
   edit still would not register and every check above would still pass. */
const saveBlock = lift(admin, "const editingId = document.getElementById('etEditingId').value;", "statusEl.textContent = 'Saved!'", 'the template editor save');
check('saving an existing template stamps updatedAt',
  /updateDoc\(doc\(db,'emailTemplates', editingId\), \{[^}]*updatedAt: serverTimestamp\(\)\}\)/.test(saveBlock),
  'the field the picker sorts on is written by exactly one press');
check('and creating one stamps it too, so a new copy beats an older undated one',
  /addDoc\(collection\(db,'emailTemplates'\), \{[^}]*updatedAt: serverTimestamp\(\)\}\)/.test(saveBlock));
/* ⚠ AND THE BLANK-SHELL FILLER MUST NOT STAMP IT. It patches a template whose body is
   empty, on load, with nobody pressing anything — stamping there would make a shell the
   most recently touched copy of its name, which is what the blank-body rank above is
   already defending against. Belt and braces, deliberately: this one is cheap. */
const fillerBlock = lift(admin, 'if(!String(existing.data.body || \'\').trim() && preset.body) patch.body = preset.body;', 'could not fill in the blank template', 'the shipped-template filler');
check('the automatic blank-template filler does NOT stamp it',
  !/updatedAt/.test(fillerBlock),
  'an automatic patch is not somebody editing a template');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
