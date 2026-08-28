/*
 * The questions map — Highlighting Utah
 *
 * WHY THIS EXISTS
 * Addie, 2026-08-26: "any questions we answer about this christmas lights either
 * through code or through here is added to the map so you can refer back to that
 * instead of us reanswering the same questions and answering inconsistently."
 *
 * `claude/questions-map.md` holds her rulings — the judgement calls only she can make.
 * Not how the code works (system-map.md), not conventions (CLAUDE.md), not technical
 * constraints. Only decisions a person made.
 *
 * ⚠ WHAT THIS GATE CANNOT DO, SAID PLAINLY. It cannot tell that a ruling was given in a
 * chat and never written down. Nothing can — the suite cannot see a conversation. The
 * obligation to append is a human one and lives in CLAUDE.md beside §9.9. Do not add a
 * check here that pretends otherwise, and in particular do NOT add a staleness check on
 * the map's own date: it would fail on every day nobody decided anything, and a gate
 * that cries wolf is one the office learns to click past — the EMAIL_LOOKALIKE_BUT_REAL
 * argument, applied to ourselves.
 *
 * WHAT IT DOES CATCH, which is the failure that actually happens silently:
 *   - a half-written row (a column missing, so the answer or its proof is gone)
 *   - a duplicate or malformed ID
 *   - a status outside the four the file declares
 *   - ⭐ a `Superseded → #X` pointing at a row somebody deleted. This is the important
 *     one. Six answers here reversed an earlier answer, and the earlier answer is kept
 *     BECAUSE it was sound at the time — it is the argument against rebuilding the old
 *     behaviour. Delete the target and the current ruling loses the only thing
 *     explaining why it is right, while still reading as authoritative.
 *   - ⭐ an answered `intent` question in docs/open-questions.md that never reached the
 *     map. That file's own header has always said every answer becomes a map entry so
 *     it is never asked twice; until now nothing checked it. This is the one place the
 *     "answered and not written down" failure IS machine-visible, because the question
 *     went through the log.
 *
 * R-018 says not to add checks to run-all.js, so this follows the other gates: one
 * file, one job, wired into `npm test`. R-019's tiering is used as written — integrity
 * BLOCKS, the reminder and the coverage figures are NOTES and never fail the build.
 *
 * ⚠ THE MAP MAY LEGITIMATELY BE ABSENT on a branch that predates it. Missing file is a
 * note and exit 0, never a failure — a gate that reds every old branch gets disabled.
 *
 * Run:  node questions-map.test.js      (or: npm run test:questions)
 */

const fs = require('fs');
const path = require('path');

const MAP_REL   = 'claude/questions-map.md';
const QLOG_REL  = 'docs/open-questions.md';
const MAP_PATH  = path.join(__dirname, 'claude', 'questions-map.md');
const QLOG_PATH = path.join(__dirname, 'docs', 'open-questions.md');

/* Answered questions from before the map existed cannot name a row in it. They are
   reported as notes, not failures. Anything answered on or after this date must. */
const MAP_BORN = '2026-08-26';

const STATUSES = ['Standing', 'Superseded', 'Closed', 'Decided — not built'];
const ID_RE    = /^[A-Z]{2,5}-\d{2}$/;

let pass = 0, fail = 0;
const failures = [];
const notes = [];

/* ⚠ A FAILURE HAS TO BE READABLE OUT OF CONTEXT. Addie, 2026-08-26: "failures should
   read legibility so you can understand it when we ask you questions about failures."
   She pastes a red run into a chat and asks what it means, and the answer has to be in
   what she pasted — not in the repo, not in this file, not in the line number alone.
   So every failure carries FIVE things: the file, the line, which row, WHAT THAT ROW
   SAYS, and the one-line fix. `row MON-09 has all six columns — found 5 at line 53`
   was the old output and it fails that test: it names no file, quotes no row, and
   suggests nothing. */
function check(label, ok, ctx) {
  if (ok) { pass++; return; }
  fail++;
  ctx = ctx || {};
  failures.push({
    file:    ctx.file    || MAP_REL,
    line:    ctx.line    || 0,
    id:      ctx.id      || '',
    subject: ctx.subject || '',
    problem: ctx.problem || label,
    fix:     ctx.fix     || ''
  });
}
function note(text) { notes.push(text); }

/* The Question cell, shortened, so a failure quotes the ruling rather than its id. */
const subjectOf = r => {
  const q = (r.cells && r.cells[1] ? r.cells[1] : '').replace(/[*`~]/g, '').trim();
  return q.length > 88 ? q.slice(0, 87) + '…' : q;
};

/* ⚠ \r?\n throughout. The repo's HTML is CRLF and a hand-written doc can arrive either
   way depending on the editor — the §7 trap that has bitten a red-check in this repo
   already. Never split on a bare \n. */
const lines = s => s.split(/\r?\n/);

// ---------------------------------------------------------------------------
// 0. The map exists, or we stop here quietly.
// ---------------------------------------------------------------------------
if (!fs.existsSync(MAP_PATH)) {
  console.log('\n=== The questions map ===\n');
  console.log('  NOTE  claude/questions-map.md is not on this branch — nothing to check.');
  console.log('        That is expected on a branch older than 2026-08-26.\n');
  console.log('0 passed, 0 failed\n');
  process.exit(0);
}

const map = fs.readFileSync(MAP_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 1. Parse the ruling tables.
//    A ruling row is a table row whose first cell is an ID. Prose, headings and
//    the header/separator rows are all skipped by that test alone, so the parser
//    never needs to know which sections exist — sections can be added freely.
// ---------------------------------------------------------------------------
const rows = [];
lines(map).forEach((line, i) => {
  if (line.slice(0, 1) !== '|') return;
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (!cells.length) return;
  if (!/^[A-Z]{2,5}-\d{2}$/.test(cells[0].replace(/^~~|~~$/g, ''))) return;
  rows.push({ line: i + 1, cells, id: cells[0].replace(/^~~|~~$/g, '') });
});

check('the map holds rulings at all', rows.length > 0, {
  problem: 'no ruling rows were found at all',
  fix: 'a ruling row is a table row whose first cell is an id like MON-01. If the ' +
       'table shape changed, this parser needs changing with it.'
});

// ---------------------------------------------------------------------------
// 2. Shape: six columns, every one filled.
//    ⚠ A missing cell is not cosmetic. Lose the answer column and the row still
//    renders as a tidy line of pipes while saying nothing.
// ---------------------------------------------------------------------------
const COLS = ['#', 'Question', 'Her answer', 'Decided', "Where it's proved", 'Status'];
rows.forEach(r => {
  check('row ' + r.id + ' has all six columns', r.cells.length === 6, {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'this row has ' + r.cells.length + ' columns, not 6',
    fix: 'a | was deleted or a cell merged into its neighbour. The six, in order: ' +
         COLS.join(' | ')
  });
  if (r.cells.length !== 6) return;
  r.cells.forEach((c, n) => {
    check('row ' + r.id + ' has a ' + COLS[n], c.replace(/[~\s]/g, '') !== '', {
      line: r.line, id: r.id, subject: subjectOf(r),
      problem: 'the "' + COLS[n] + '" cell is empty',
      fix: n === 2 ? 'without an answer the row is a question nobody answered — ' +
                     'fill it in or delete the row'
         : n === 4 ? 'name the function or doc that proves it, or the row is a claim'
         : 'fill it in'
    });
  });
});

// ---------------------------------------------------------------------------
// 2b. A row recorded from now on must be a QUESTION, answered in HER OWN WORDS.
//
//     Addie, 2026-08-28, having checked a row and found her answer in it but not the
//     question she had actually been asked: "lets fix it so the questions and answer is
//     in the map and it has to add that everytime we make a decision".
//
//     ⚠ THE "EVERY TIME" HALF CANNOT BE CHECKED BY ANYTHING, and pretending otherwise
//     would be the worst outcome here. No program can see a conversation, so nothing can
//     tell that a ruling was given and never written down — that is stated at the top of
//     CLAUDE.md and it is still true. What CAN be enforced is that every row which DOES
//     exist is trustworthy, and these two checks are the difference between a row that
//     settles an argument in six weeks and one that starts a new one:
//
//       - a QUESTION, not a topic. "The three RSVP answers, and what each does" is a
//         heading; you cannot tell from it what was actually asked, so you cannot tell
//         whether her answer covers your case.
//       - HER OWN WORDS, quoted. A paraphrase is my reading of what she meant, and the
//         whole purpose of this map — her words — is "so you can refer back to that
//         instead of us reanswering the same questions and answering inconsistently".
//         A paraphrase drifts; a quotation cannot.
//
//     ⚠ FROM A CUTOFF, AND OLDER ROWS ARE A NOTE — NEVER A FAILURE. 115 of the 182 rows
//     that predate this carry no quotation, and 2 are topics rather than questions. A
//     gate that goes red on 117 rows nobody is going to rewrite tonight is a gate that
//     gets deleted by the weekend. Same decision, for the same reason, as the eleven
//     older open-questions entries this file already reports as notes.
//
//     ⚠ A BACK-DATED ROW DODGES BOTH CHECKS AND NOTHING HERE CAN STOP IT. Red-checking
//     found this and it is reported rather than papered over: put yesterday's date in the
//     Decided column and the row is "old", so neither rule applies. There is no ground
//     truth to test against — a row added today legitimately CAN record a ruling from
//     three weeks ago, which is the whole reason the column is hand-written.
//     ⚠ AND SINCE R-024 THAT COLUMN DECIDES WHICH OF TWO ANSWERS IS FOLLOWED, so a wrong
//     date is now a correctness bug rather than untidiness: it can make the app obey the
//     answer she changed her mind about. Get the date right.
//
//     ⚠ AND THE QUOTE TEST ASKS FOR A QUOTATION, NOT A LENGTH. Something between double
//     quotes, long enough not to be an incidental phrase like "soft" or "no". It cannot
//     tell whether the words are really hers — a determined paraphrase in quote marks
//     passes — so this is a floor under carelessness, not a proof of provenance.
// ---------------------------------------------------------------------------
const OWN_WORDS_FROM = '2026-08-28';
const isNewRow = r => r.cells.length === 6 && r.cells[3].trim().slice(0, 10) >= OWN_WORDS_FROM;
const hasQuote = cell => /"[^"]{15,}"/.test(cell) || /“[^”]{15,}”/.test(cell);

let oldNoQuote = 0, oldNoQuestion = 0;
rows.forEach(r => {
  if (r.cells.length !== 6) return;
  const q = r.cells[1], a = r.cells[2];
  if (isNewRow(r)) {
    check('row ' + r.id + ' records a question, not a topic', q.indexOf('?') !== -1, {
      line: r.line, id: r.id, subject: subjectOf(r),
      problem: 'the Question cell has no question mark in it: "' + q.slice(0, 70) + '"',
      fix: 'write the question she was actually asked. A heading tells a later reader ' +
           'what the row is ABOUT; only the question tells them whether her answer ' +
           'covers the case in front of them.'
    });
    check('row ' + r.id + ' answers in her own words', hasQuote(a), {
      line: r.line, id: r.id, subject: subjectOf(r),
      problem: 'the answer carries no quotation of what she actually said',
      fix: 'quote her, verbatim, inside double quotes — typos and all. This map exists ' +
           '"so you can refer back to that instead of us reanswering the same questions ' +
           'and answering inconsistently", and a paraphrase is the thing that drifts.'
    });
  } else {
    if (!hasQuote(a)) oldNoQuote++;
    if (q.indexOf('?') === -1) oldNoQuestion++;
  }
});
if (oldNoQuote || oldNoQuestion) {
  note(oldNoQuote + ' row(s) written before ' + OWN_WORDS_FROM + ' do not quote her, and ' +
    oldNoQuestion + ' record a topic rather than a question. Not failures — they predate ' +
    'the rule and rewriting them wholesale would be inventing quotations. Fix one when you ' +
    'next touch that area and can check what she actually said.');
}

// ---------------------------------------------------------------------------
// 3. IDs: well formed and unique.
//    ⚠ A duplicate ID is worse than a missing one — a Superseded pointer then
//    resolves to two different answers and the reader picks whichever they read first.
// ---------------------------------------------------------------------------
const seen = new Map();
rows.forEach(r => {
  check('ID ' + r.id + ' is well formed', ID_RE.test(r.id), {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: '"' + r.id + '" is not a well-formed id',
    fix: 'two to five capitals, a hyphen, two digits — MON-01, WH-14, PROC-07'
  });
  check('ID ' + r.id + ' is unique', !seen.has(r.id), {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'the id ' + r.id + ' is already used at line ' + seen.get(r.id),
    fix: 'give this row the next free number in its area. A duplicate id makes a ' +
         'Superseded pointer resolve to two different answers.'
  });
  if (!seen.has(r.id)) seen.set(r.id, r.line);
});
const ids = new Set(rows.map(r => r.id));

// ---------------------------------------------------------------------------
// 4. Status comes from the declared set.
//    ⚠ Checked against the file's OWN prose, not a list copied into this test. A
//    vocabulary written down twice is a vocabulary that drifts — the lesson from
//    lifting the collection list out of firestore.rules rather than copying it.
// ---------------------------------------------------------------------------
STATUSES.forEach(s => {
  check('the map still declares the status "' + s + '"',
    map.indexOf('**' + s + '**') !== -1, {
    problem: 'the map no longer explains the status "' + s + '" in its header',
    fix: 'this gate reads the vocabulary from the file\'s own prose so the two ' +
         'cannot drift. Either restore the explanation, or change the STATUSES ' +
         'list in questions-map.test.js to match the new vocabulary.'
  });
});

rows.forEach(r => {
  if (r.cells.length !== 6) return;
  const status = r.cells[5];
  const base = status.split('→')[0].trim();
  check('row ' + r.id + ' has a known status', STATUSES.indexOf(base) !== -1, {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'the Status cell reads "' + status + '"',
    fix: 'one of: ' + STATUSES.join(' / ') + ' (Superseded also needs "→ #ID")'
  });
});

// ---------------------------------------------------------------------------
// 5. Superseded pointers resolve. ⭐ The one this gate is really for.
// ---------------------------------------------------------------------------
rows.forEach(r => {
  if (r.cells.length !== 6) return;
  const status = r.cells[5];
  if (status.indexOf('Superseded') !== 0) return;

  const m = /→\s*#?([A-Z]{2,5}-\d{2})/.exec(status);
  check('row ' + r.id + ' says what superseded it', !!m, {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'marked Superseded but does not say what replaced it',
    fix: 'write "Superseded → #ID" naming the row that now holds the answer. ' +
         'Without it this old ruling reads as simply wrong, when it is actually ' +
         'the reason the current one is right.'
  });
  if (!m) return;

  check('row ' + r.id + ' points at a row that exists', ids.has(m[1]), {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'points at ' + m[1] + ', and there is no row ' + m[1] + ' in the map',
    fix: 'somebody deleted or renamed ' + m[1] + '. Find where that answer went and ' +
         'repoint this row at it. ⭐ THIS IS THE FAILURE THIS GATE EXISTS FOR — the ' +
         'current ruling has just lost the only thing explaining why it is right.'
  });
  check('row ' + r.id + ' is not superseded by itself', m[1] !== r.id, {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'points at itself',
    fix: 'name the row that replaced it, not this one'
  });
});

// Any ID named anywhere in the prose resolves too, so a rewrite of the header
// cannot quietly reference a row that has gone.
const prose = map.replace(/^\|.*$/gm, '');
const referenced = new Set((prose.match(/\b[A-Z]{2,5}-\d{2}\b/g) || []));
[...referenced].forEach(id => {
  if (id === 'MON-01' && !ids.has(id)) { /* example in the header prose */ }
  check('prose reference to ' + id + ' resolves', ids.has(id), {
    id: id,
    problem: 'the header prose names row ' + id + ', which is not in any table',
    fix: 'either the row was deleted and the sentence needs updating, or the id ' +
         'was mistyped'
  });
});

// ---------------------------------------------------------------------------
// 6. The file dates itself.
// ---------------------------------------------------------------------------
const dated = /Last updated:\s*(\d{4}-\d{2}-\d{2})/.exec(map);
check('the map carries a Last updated date', !!dated, {
  problem: 'there is no "Last updated: YYYY-MM-DD" line',
  fix: 'add one at the foot of the file. Without it nobody can tell a live file ' +
       'from an abandoned one.'
});
if (dated) {
  check('that date parses', !isNaN(new Date(dated[1]).getTime()), {
    problem: '"' + dated[1] + '" is not a real date',
    fix: 'use YYYY-MM-DD'
  });
}

// Every row's Decided cell is a date, "(settled)", "(chat)" or "(standing)" — the
// four forms the header declares. A free-text date is how "August" ends up in a
// column that is sorted and compared.
rows.forEach(r => {
  if (r.cells.length !== 6) return;
  const d = r.cells[3];
  check('row ' + r.id + ' has a readable Decided cell',
    /^\d{4}-\d{2}-\d{2}/.test(d) || /^\([a-z ]+\)$/.test(d) || d === '—', {
    line: r.line, id: r.id, subject: subjectOf(r),
    problem: 'the Decided cell reads "' + d + '"',
    fix: 'a date as YYYY-MM-DD when a dated message exists, otherwise (settled), ' +
         '(chat) or (standing) — the four forms the header declares'
  });
});

// ---------------------------------------------------------------------------
// 7. The link to docs/open-questions.md.
//    ⭐ That file's header has always said every answer becomes a map entry so it is
//    never asked twice. This is the half that was never enforced.
// ---------------------------------------------------------------------------
if (!fs.existsSync(QLOG_PATH)) {
  note('docs/open-questions.md is not on this branch — the link check was skipped.');
} else {
  const qlog = fs.readFileSync(QLOG_PATH, 'utf8');
  const qLines = lines(qlog);

  const qSubject = e => {
    const t = (e.body.split('\n').find(l => l.trim()) || '').replace(/[*`#]/g, '').trim();
    return t.length > 88 ? t.slice(0, 87) + '…' : t;
  };

  const entries = [];
  qLines.forEach((line, i) => {
    const m = /^##\s+(Q-\d{3})\s*·\s*([a-z]+)\s*·\s*(.+)$/.exec(line);
    if (m) entries.push({ id: m[1], kind: m[2], rest: m[3], line: i + 1, body: '' });
  });
  entries.forEach((e, n) => {
    const from = e.line;
    const to = n + 1 < entries.length ? entries[n + 1].line - 1 : qLines.length;
    e.body = qLines.slice(from, to).join('\n');
    e.answered = /answered/i.test(e.rest);
    const d = /(\d{4}-\d{2}-\d{2})/.exec(e.rest);
    e.date = d ? d[1] : '';
  });

  check('open-questions.md still parses into Q entries', entries.length > 0, {
    file: QLOG_REL,
    problem: 'no Q entries could be read out of the file',
    fix: 'the heading shape "## Q-00n · kind · state · date" has changed; this ' +
         'parser needs changing with it'
  });

  const answeredIntent = entries.filter(e => e.kind === 'intent' && e.answered);

  answeredIntent.forEach(e => {
    check(e.id + ' records a resulting map change',
      /Resulting map change/i.test(e.body), {
      file: QLOG_REL, line: e.line, id: e.id, subject: qSubject(e),
      problem: 'marked answered, but never says what the answer changed',
      fix: 'add a "**Resulting map change:**" line. This file\'s own header ' +
           'promises every answer becomes a map entry so it is never asked twice — ' +
           'this is that promise.'
    });
  });

  // From MAP_BORN, an answered intent question must name a row here.
  answeredIntent.forEach(e => {
    const named = (e.body.match(/\b[A-Z]{2,5}-\d{2}\b/g) || []).filter(x => ids.has(x));
    const isNew = e.date && e.date >= MAP_BORN;
    if (isNew) {
      check(e.id + ' names the map row it created', named.length > 0, {
        file: QLOG_REL, line: e.line, id: e.id, subject: qSubject(e),
        problem: 'answered ' + e.date + ' and names no row in ' + MAP_REL,
        fix: 'if the answer was a ruling from Addie, add it to ' + MAP_REL + ' and ' +
             'name the new row id here. If it was a factual answer with no ruling ' +
             'in it, say so in the Resulting map change line.'
      });
    } else if (!named.length) {
      note(e.id + ' predates the map (' + (e.date || 'undated') +
        ') and names no row — fold it in when that area is next touched.');
    }
  });

  const open = entries.filter(e => !e.answered || /still open/i.test(e.rest));
  if (open.length) {
    note(open.length + ' question' + (open.length === 1 ? '' : 's') +
      ' still open in docs/open-questions.md: ' + open.map(e => e.id).join(', '));
  }
}

// ---------------------------------------------------------------------------
// 8. Notes — R-019's bottom tier. These never fail the build.
// ---------------------------------------------------------------------------
const byStatus = {};
rows.forEach(r => {
  if (r.cells.length !== 6) return;
  const base = r.cells[5].split('→')[0].trim();
  byStatus[base] = (byStatus[base] || 0) + 1;
});

/* ⚠ THE COUNT IS MEASURED HERE, NEVER WRITTEN DOWN. CLAUDE.md's own test-seed count
   was wrong twice — 108 for eight days, then 125 while the seed held 12 — because it
   was a sentence rather than a measurement. Print it, do not record it. */
note('The map holds ' + rows.length + ' rulings (' +
  Object.keys(byStatus).sort().map(k => byStatus[k] + ' ' + k).join(', ') + ')' +
  (dated ? ', last updated ' + dated[1] : '') + '.');

const unproved = rows.filter(r => r.cells.length === 6 && r.cells[4].indexOf('`') === -1);
note(unproved.length + ' of ' + rows.length + ' rows have no code anchor in ' +
  '"Where it\'s proved" — those are claims, not proofs. Give one a `functionName` ' +
  'when you next touch that area.');

note('⭐ IF THIS SESSION GOT A RULING FROM ADDIE, ADD A ROW BEFORE YOU FINISH. ' +
  'No check can see a conversation; this line is the whole enforcement.');

// ---------------------------------------------------------------------------
// 9. The report.
//    ⚠ FAILURES ARE GROUPED BY ROW, not printed one per check. One broken row can
//    trip four checks, and four lines about the same row reads as four problems.
// ---------------------------------------------------------------------------
const w = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length); };

console.log('\n=== The questions map ===\n');
console.log('  ' + w('status', 24) + 'rows');
Object.keys(byStatus).sort().forEach(k => console.log('  ' + w(k, 24) + byStatus[k]));
console.log('');
notes.forEach(n => console.log('  NOTE  ' + n));

if (failures.length) {
  const groups = new Map();
  failures.forEach(f => {
    const key = f.file + '|' + f.line + '|' + f.id;
    if (!groups.has(key)) groups.set(key, { file: f.file, line: f.line, id: f.id, subject: f.subject, items: [] });
    groups.get(key).items.push(f);
  });

  console.log('\n  ' + failures.length + ' problem' + (failures.length === 1 ? '' : 's') +
    ' in ' + groups.size + ' place' + (groups.size === 1 ? '' : 's') + '.\n');

  [...groups.values()].forEach(g => {
    console.log('  ' + g.file + (g.line ? ':' + g.line : '') + (g.id ? '  —  ' + g.id : ''));
    if (g.subject) console.log('    "' + g.subject + '"');
    g.items.forEach(f => {
      console.log('    FAIL  ' + f.problem);
      if (f.fix) {
        String(f.fix).replace(/(.{1,84})(\s|$)/g, '$1\n').trim().split('\n')
          .forEach((l, i) => console.log('          ' + (i === 0 ? '→ ' : '  ') + l.trim()));
      }
    });
    console.log('');
  });

  /* ⚠ SO A PASTED EXCERPT EXPLAINS ITSELF. Addie pastes a red run into a chat and
     asks what it means; without this the reader has to have the repo open to know
     what file is even being discussed. */
  console.log('  ── what this is ' + '─'.repeat(58));
  console.log('  ' + MAP_REL + ' holds Addie\'s rulings — the judgement calls only she');
  console.log('  can make, so the same question is never answered two different ways.');
  console.log('  This gate checks the file is internally sound. It CANNOT tell that a');
  console.log('  ruling was given and never written down; nothing can.');
  console.log('  Run it alone with:  npm run test:questions');
  console.log('  ' + '─'.repeat(74));
}

console.log((failures.length ? '' : '\n') + pass + ' passed, ' + fail + ' failed, ' +
  notes.length + ' notes\n');

process.exit(fail ? 1 : 0);
