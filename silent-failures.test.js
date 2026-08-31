/*
 * Highlighting Utah — nothing fails quietly
 *
 *   npm run test:silent
 *
 * ⭐ THE ONE RULE THIS ENFORCES: no EMPTY catch block anywhere may be BARE.
 * An empty catch is often exactly right — "logging must never break a save path",
 * "private browsing, so the login just won't be remembered" — and this file does not
 * argue with any of them. What it refuses is an empty catch that does not say why,
 * because that is indistinguishable from one somebody forgot to finish.
 *
 * Owner's rule, 2026-08-25: "nothing should fail quietly."
 *
 * ⚠ WHY NOT A COUNT. The obvious gate is "the number of empty catches must never
 * rise", and it does not work: the count goes up for good reasons as often as bad,
 * so a red build says nothing about which kind happened, and within a week somebody
 * is raising the ceiling to get past it. Requiring a REASON scales — it says WHICH
 * catch is new, the fix is one sentence written by whoever added it, and it was
 * already the house style before this file existed. (It was 61 of 84 when the
 * silent-failure map was written; it is all of them now.)
 *
 * ⚠ AND WHY IN-BODY, NOT NEARBY. A comment three lines above a try can be about
 * anything — the function, the write, the branch — and code moves. A comment inside
 * the braces is attached to the thing it explains and travels with it.
 *
 * ⚠ THE SCANNER MUST PROVE IT STILL WORKS. A brace-matcher that quietly stops
 * matching reports zero bare catches, which is a GREEN build for exactly the wrong
 * reason — the same shape as a test that cannot find its target and skips. So every
 * file also asserts a floor on how many catch blocks were found at all.
 *
 * Ported from claude/sweep-silent-failures.py, which is the scanner that produced
 * the counts in claude/silent-failures.md. Kept in step by the totals below.
 */

const fs = require('fs');
const path = require('path');

const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '\n          ' + extra : ''));
    failures.push(name);
  }
}
function suite(t) { console.log('\n=== ' + t + ' ==='); }

/* Blank out strings, template literals and comments so brace matching is not fooled
 * by a '}' inside a string. LENGTH IS PRESERVED — every character is replaced by a
 * space rather than removed — so an offset in the blanked copy is the same offset in
 * the real file, which is what lets a failure name a real line number. */
function blankNoise(js) {
  const out = js.split('');
  let i = 0;
  const n = js.length;
  while (i < n) {
    const c = js[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (js[j] === '\\') { j += 2; continue; }
        if (js[j] === c) break;
        /* ⚠ A QUOTE STRING CANNOT SPAN A LINE, and saying so BOUNDS THE DAMAGE
           of any future mis-read. The 2026-08-31 bug ran one phantom string for
           2576 characters across 52 lines; with this, the worst a mistake can
           cost is the rest of one line. A template literal legitimately spans
           lines, so only ' and " stop here. */
        if (js[j] === '\n' && c !== '`') break;
        j++;
      }
      /* Unterminated on its line: it was never a string. Blank nothing and step
         over the one character, rather than swallowing everything after it. */
      if (j >= n || js[j] !== c) { i++; continue; }
      for (let k = i; k < Math.min(j + 1, n); k++) if (js[k] !== '\n') out[k] = ' ';
      i = j + 1; continue;
    }
    if (c === '/' && js[i + 1] === '/') {
      let j = js.indexOf('\n', i);
      if (j < 0) j = n;
      for (let k = i; k < j; k++) out[k] = ' ';
      i = j; continue;
    }
    if (c === '/' && js[i + 1] === '*') {
      let j = js.indexOf('*/', i);
      j = j < 0 ? n : j + 2;
      for (let k = i; k < j; k++) if (js[k] !== '\n') out[k] = ' ';
      i = j; continue;
    }
    /* ⭐ A REGEX LITERAL IS NOT CODE EITHER, AND THIS IS WHY THE GATE WENT BLIND
       (fixed 2026-08-31). index.html line 3202 holds

           replace(/[&<>"']/g, function(c){ ... })

       and a scanner that does not know regexes sees the " inside that character
       class, opens a string, and runs to the next " — 2576 characters and 52
       lines later. Everything between was invisible, including a genuinely bare
       `}catch(err){}`. The gate reported green because it could not see it.
       ⚠ THAT IS THE WORST WAY FOR THIS PARTICULAR GATE TO FAIL, and its own
       header says so: a matcher that has quietly stopped matching reports NO
       bare catches, which is a green build for exactly the wrong reason. */
    if (c === '/' && regexStartsAt(js, i)) {
      let j = i + 1, inClass = false, ok = false;
      while (j < n) {
        const d = js[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;              /* unterminated — not a regex */
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;  /* a / inside [...] is literal */
        else if (d === '/') { ok = true; break; }
        j++;
      }
      if (ok) {
        for (let k = i; k < j + 1; k++) if (js[k] !== '\n') out[k] = ' ';
        i = j + 1; continue;
      }
      /* Not a regex after all — fall through and treat it as division. */
    }
    i++;
  }
  return out.join('');
}

/* Can a `/` at this position begin a REGEX, or is it division? Decided by the
   last significant character before it — the standard rule, and the only part
   of this that needs judgement.
   ⚠ IT ERRS TOWARDS DIVISION. Reading a division sign as a regex would blank
   real code, which is the failure being fixed; reading a regex as division only
   risks the older behaviour, now bounded to one line by the string rule above. */
const REGEX_MAY_FOLLOW = new Set(['return', 'typeof', 'instanceof', 'in', 'of',
  'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await']);
function regexStartsAt(js, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(js[k])) k--;
  if (k < 0) return true;                     /* start of input */
  const c = js[k];
  if ('(,=:[!&|?{};+-*%~^<>'.indexOf(c) !== -1) return true;
  if (/[A-Za-z0-9_$]/.test(c)) {              /* a word: only a keyword allows one */
    let e = k;
    while (e >= 0 && /[A-Za-z0-9_$]/.test(js[e])) e--;
    return REGEX_MAY_FOLLOW.has(js.slice(e + 1, k + 1));
  }
  return false;                               /* after ) ] . or a literal: division */
}

/* Everything outside a <script> is blanked rather than cut out, for the same reason:
 * offsets keep mapping to real line numbers in the real file. A <script src=…> has no
 * body of ours to scan. */
function scriptsOnly(file) {
  const s = read(file);
  if (!file.endsWith('.html')) return s;
  const keep = new Array(s.length).fill(' ');
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(s))) {
    const a = m.index + m[0].indexOf('>') + 1;
    for (let k = a; k < a + m[1].length; k++) keep[k] = s[k];
  }
  for (let k = 0; k < s.length; k++) if (s[k] === '\n') keep[k] = '\n';
  return keep.join('');
}

/* The block that opens at or after `from`, as [open, close]. */
function blockAt(clean, from) {
  const o = clean.indexOf('{', from);
  if (o < 0) return null;
  let depth = 0;
  for (let i = o; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') { depth--; if (!depth) return [o, i]; }
  }
  return null;
}

function scan(file) { return scanText(scriptsOnly(file)); }
/* ⚠ THE REAL FILES AND THE FIXTURE GO THROUGH THIS SAME FUNCTION, deliberately. A
   fixture with its own copy of the classification proves the copy works and says
   nothing about the code that runs — which is how the first version of the
   self-test sat green while `bare.push` was disabled underneath it. */
function scanText(js) {
  const clean = blankNoise(js);
  const all = [], empty = [], bare = [];
  const re = /\bcatch\b\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(clean))) {
    const span = blockAt(clean, m.index + m[0].length - 1);
    if (!span) continue;
    const [o, c] = span;
    const line = js.slice(0, o).split('\n').length;
    const row = { line: line, fn: enclosingFn(js, o) };
    all.push(row);
    if (clean.slice(o + 1, c).trim()) continue;   // does something — not this file's business
    empty.push(row);
    const body = js.slice(o + 1, c);
    if (body.indexOf('//') < 0 && body.indexOf('/*') < 0) bare.push(row);
  }
  return { all: all, empty: empty, bare: bare };
}

function enclosingFn(js, pos) {
  let best = null, m;
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
  const head = js.slice(0, pos);
  while ((m = re.exec(head))) best = m[1];
  return best || '(top level)';
}

/* ⚠ FLOORS, NOT EXACT COUNTS. An exact count is the ceiling test rejected above,
 * wearing different clothes — it would go red every time somebody legitimately adds
 * a try/catch. These exist only so a scanner that has stopped scanning cannot report
 * a clean bill of health. Set well under the real numbers on 2026-08-26
 * (admin 310, index 41, employee 24, functions 31). */
const FILES = [
  /* ⚠ RAISED 2026-08-31, and this is the point: the old floors were met while the
     scanner was BLIND to whole regions — 351 of admin's 366, 49 of index's 61, 21 of
     employee's 32 — because a quote inside a regex opened a phantom string that ran
     for dozens of lines. A floor set under a broken scanner is a floor that certifies
     the breakage. These are set just under today's real counts. */
  { file: 'admin.html', floor: 340 },
  { file: 'index.html', floor: 55 },
  { file: 'employee.html', floor: 28 },
  { file: 'functions/index.js', floor: 30 }
];

/* ⭐ THE SCANNER PROVES ITSELF FIRST, ON A FIXTURE (added 2026-08-26).
 *
 * ⚠ THE HOLE THIS CLOSES, FOUND BY RED-CHECKING THIS FILE. With no bare catch left
 * in the repo, gutting the detection — `if (false) bare.push(row)` — changes nothing
 * and the run stays green. A gate at zero cannot be red-checked against the real
 * files at all, because there is nothing left for it to find. So it is red-checked
 * against a fixture that DOES have something to find, every run. The floors above
 * catch a scanner that has stopped seeing catch blocks; these catch one that still
 * sees them and has stopped judging them.
 *
 * The fixture deliberately includes the two things that break a naive matcher: a
 * brace inside a string, and a brace inside a comment. */
suite('Silent failures — the scanner can still tell the difference');
{
  const FIX = [
    'function a(){ try{ x(); }catch(e){} }',                       // 2: bare
    'function b(){ try{ x(); }catch(e){ /* quiet on purpose: reason */ } }',
    'function c(){ try{ x(); }catch(e){ console.error("} not a brace", e); } }',
    'function d(){ try{ x(); }catch(e){} /* a reason AFTER the braces is not in them */ }',
    'function e(){ /* } */ try{ x(); }catch(e){ // said inside',
    '  } }',
    /* ⭐ THE 2026-08-31 BUG, IN ONE LINE. A regex character class holding a quote.
       A scanner that does not know regex literals opens a string on that " and
       runs to the next one, swallowing every catch in between — which is exactly
       what hid four bare catches across three files while this gate reported
       green. If line 7's catch stops being found, that blindness is back. */
    'function f(){ var t = s.replace(/[&<>"\']/g, esc); try{ x(); }catch(e){} }',
    /* And the other half: a / that is DIVISION must not be read as a regex, or
       real code gets blanked instead — the same damage from the other side. */
    'function g(){ var r = (a + b) / 2; try{ x(); }catch(e){ /* fine */ } }',
    /* ⚠ LINE 9 IS THE ONE THAT ISOLATES REGEX AWARENESS. Line 7 above does not:
       the one-line bound below rescues it on its own, so BOTH fixes had to be
       removed together before it noticed — which a red-check caught. Here the
       phantom string opens on the regex quote and closes on the "z" LATER IN THE
       SAME LINE, so it swallows the catch between them. Only knowing the regex
       is a regex saves this one. */
    'function h(){ var t = s.replace(/"/g, x); try{ y(); }catch(e){ /* r */ } var u = "z"; }',
    /* ⚠ AND LINES 10-11 ISOLATE THE ONE-LINE BOUND. A regex after `)` is read as
       division on purpose — erring that way is safer — so this quote DOES open a
       phantom string. Without the bound it runs to the "z" on the next line and
       eats the catch; with it, the damage stops at the end of its own line. This
       is the belt to the regex braces, and it is what keeps any future mis-read
       cheap. */
    'function i(){ if (a) /"/.test(s);',
    '  try{ x(); }catch(e){ /* r */ } var q = "z"; }'
  ].join('\n');
  const r = scanText(FIX);
  const bareLines = r.bare.map(function (b) { return b.line; });
  const emptyLines = r.empty.map(function (b) { return b.line; });
  check('the fixture\'s nine catch blocks are all found', r.all.length === 9,
    'found ' + r.all.length + ' — a brace inside a string or a comment, or a quote ' +
    'inside a regex, is throwing the matcher off');
  check('the bare ones, and only they, are reported bare',
    bareLines.length === 3 && bareLines[0] === 1 && bareLines[1] === 4 && bareLines[2] === 7,
    'expected lines 1, 4 and 7 (bare, reason-outside-the-braces, and the one after ' +
    'a regex holding a quote); got ' + bareLines.join(', '));
  check('an empty catch with a reason in it is not reported',
    emptyLines.indexOf(2) >= 0 && bareLines.indexOf(2) < 0);
  check('a catch that does something is not empty at all, even if it holds a brace',
    emptyLines.indexOf(3) < 0,
    'the "}" inside that string must not close the block early');
  check('a reason written OUTSIDE the braces does not count',
    bareLines.indexOf(4) >= 0,
    'a comment beside a try can be about anything, and code moves away from it');
  check('a // reason inside a multi-line catch does count',
    emptyLines.indexOf(5) >= 0 && bareLines.indexOf(5) < 0);
}

suite('Silent failures — every empty catch says why');

const totals = { all: 0, empty: 0, bare: 0 };
FILES.forEach(function (t) {
  const r = scan(t.file);
  totals.all += r.all.length;
  totals.empty += r.empty.length;
  totals.bare += r.bare.length;

  check(t.file + ' — the scanner still finds catch blocks (' + r.all.length + ')',
    r.all.length >= t.floor,
    'found ' + r.all.length + ', expected at least ' + t.floor + '. A brace matcher ' +
    'that has stopped matching reports NO bare catches, which is a green build for ' +
    'the wrong reason. Fix the scanner before trusting the line below.');

  check(t.file + ' — no empty catch is left without a reason',
    r.bare.length === 0,
    r.bare.length
      ? r.bare.map(function (b) { return t.file + ':' + b.line + '  in ' + b.fn; }).join('\n          ') +
        '\n          Write the reason INSIDE the braces: catch(e){ /* quiet on ' +
        'purpose: <what is lost, and why that is acceptable> */ }. If nothing ' +
        'acceptable can be written, it is not a quiet failure — say it to whoever ' +
        'is standing there (a toast or a status line) or, for a background job, put ' +
        'it in a System note. See claude/silent-failures.md.'
      : '');
});

/* ⭐ THE THREE THINGS BUILT ON 2026-08-26 SO A FAILURE KEEPS. Asserted here as
 * STRUCTURE only — that each mechanism still exists and is still reached. What each
 * one actually says, and what it does when forced to fail, is run against a fake
 * Firestore and a real DOM in run-all.js (suites 38 and 108); duplicating that here
 * would be two copies of one check, and CLAUDE.md §9.1 says not to. */
suite('Silent failures — the three ways a failure now keeps');
{
  const admin = read('admin.html');
  check('a customer number that will not pool raises a System note',
    /async function noticeCustomerNumberStuck\(/.test(admin) &&
    /topic: 'Customer Number Needs Fixing'/.test(admin),
    'the documented cause of "a customer number appears on two houses"');
  check('and every pool write that can lose one calls it',
    (admin.match(/noticeCustomerNumberStuck\(/g) || []).length >= 6,
    'one call is the declaration; the rest are the sites. Found ' +
    (admin.match(/noticeCustomerNumberStuck\(/g) || []).length);

  check('a panel that throws draws a bar instead of nothing',
    /function noteRenderFailure\(/.test(admin) && /function retryFailedRenders\(/.test(admin) &&
    /catch\(err\)\{ noteRenderFailure\(label, fn, err\); \}/.test(admin),
    'safeRender is the silence behind "a section renders empty for no reason"');

  check('a background job that stops raises a System note after a streak',
    /async function bgJobFailed\(/.test(admin) &&
    /topic: 'A Background Check Has Stopped'/.test(admin) &&
    /BG_FAIL_STREAK_TO_NOTE\s*=\s*[2-9]/.test(admin),
    'a Health Check that has quietly stopped checking reads as good news');
  check('and both background jobs report into it',
    /bgJobFailed\('healthCheck'/.test(admin) && /bgJobFailed\('invoiceAutoSync'/.test(admin));
  check('and both of them also report success, or the streak never resets',
    /bgJobOk\('healthCheck'\)/.test(admin) && /bgJobOk\('invoiceAutoSync'\)/.test(admin),
    'without the reset, one bad tick notes for ever and a recovered job never ' +
    'notes again');
}

console.log('\n' + '='.repeat(55));
console.log(totals.all + ' catch blocks read, ' + totals.empty + ' of them empty, ' +
  totals.bare + ' without a reason');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\nFailures:\n  - ' + failures.join('\n  - '));
  console.log('='.repeat(55) + '\n');
  process.exit(1);
}
console.log('='.repeat(55) + '\n');
