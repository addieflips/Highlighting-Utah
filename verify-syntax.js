/*
 * Verification gate A — Highlighting Utah
 *
 * Two checks, both of which have broken the live site before:
 *   1. Every inline <script> in the three HTML files must parse.
 *   2. <div> opens must equal </div> closes (an unbalanced div silently
 *      swallows every panel below it).
 * Plus a parse check on functions/index.js.
 *
 * Replaces the python3 heredoc that used to live in CLAUDE.md §3 gate A.
 * Same checks, but runs on Mac, Windows and CI with no python dependency.
 *
 * Run:  node scripts/verify-syntax.js       (or: npm run verify)
 * Exits 0 if clean, 1 if anything fails.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Resolve the repo root whether this is run from the root or from scripts/.
const ROOT = fs.existsSync(path.join(__dirname, 'admin.html'))
  ? __dirname
  : path.join(__dirname, '..');

const HTML_FILES = ['index.html', 'admin.html', 'employee.html'];

let pass = 0, fail = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

/* Pull the inline scripts out of an HTML file.
 *
 * Classic scripts and type="module" scripts are kept APART and checked
 * separately. Concatenating them would force the classic code to be parsed in
 * strict mode, where a handful of legal-but-old constructs are syntax errors —
 * that would report failures that do not exist in a real browser. */
function extractScripts(html) {
  const classic = [], modules = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;                 // external file, nothing inline to parse
    if (/type\s*=\s*["']?(application\/json|application\/ld\+json|text\/template)/i.test(attrs)) continue;
    (/type\s*=\s*["']?module/i.test(attrs) ? modules : classic).push(m[2]);
  }
  return { classic: classic.join('\n;\n'), modules: modules.join('\n;\n') };
}

function parseCheck(label, code, ext) {
  if (!code.trim()) return;                                  // nothing of that kind in this file
  const tmp = path.join(os.tmpdir(), 'hu-verify-' + Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    check(label, true);
  } catch (err) {
    const msg = String(err.stderr || err.stdout || err.message)
      .split('\n').filter(l => l.trim()).slice(0, 4).join('\n        ');
    check(label, false, msg);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* temp file, never fatal */ }
  }
}

console.log('\n=== Gate A: inline JS syntax + <div> balance ===\n');

HTML_FILES.forEach(file => {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { check(file + ' exists', false, 'not found at ' + full); return; }
  const html = fs.readFileSync(full, 'utf8');

  const { classic, modules } = extractScripts(html);
  parseCheck(file + ' — inline script parses', classic, '.js');
  parseCheck(file + ' — module script parses', modules, '.mjs');

  const opens = (html.match(/<div\b/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  check(file + ' — <div> balance (' + opens + ' open / ' + closes + ' close)',
    opens === closes,
    opens === closes ? '' : 'a mismatch hides every panel after the unclosed div — find it before pushing');
});

// Cloud Functions are plain CommonJS, so a direct --check is enough.
const fnsPath = path.join(ROOT, 'functions', 'index.js');
if (fs.existsSync(fnsPath)) {
  try {
    execFileSync(process.execPath, ['--check', fnsPath], { stdio: 'pipe' });
    check('functions/index.js parses', true);
  } catch (err) {
    check('functions/index.js parses', false,
      String(err.stderr || err.message).split('\n').slice(0, 4).join('\n        '));
  }
} else {
  check('functions/index.js exists', false, 'not found at ' + fnsPath);
}

/*
 * Mangled characters.
 *
 * Added 2026-08-18, after eleven of them were found sitting in main. Every one
 * was an em dash that had become a raw U+0014 control character, or a § / ⭐
 * that had become U+FFFD, the "I could not decode this" replacement character.
 * They get in when a file is read as one encoding and written back as another —
 * some editor or script in the chain does not speak UTF-8 — and they are
 * invisible: an editor renders U+0014 as nothing at all, so a sentence just
 * quietly loses its punctuation and nobody sees a reason to look.
 *
 * They were all in comments that time, which is luck, not design. The same
 * mangling inside a customer-facing string would put a control character in an
 * email, and inside a Firestore field name or an element id it would break the
 * app outright. Neither node --check nor the div count can see any of it,
 * because the file is still perfectly valid JavaScript.
 *
 * Tabs, newlines and carriage returns are the only control characters a source
 * file legitimately contains.
 */
const TEXT_FILES = HTML_FILES.concat([
  'functions/index.js', 'js/money.js', 'js/test-seed.js',
  'run-all.js', 'money-parity.test.js', 'selector-contract.test.js',
]);
let mangled = [];
TEXT_FILES.forEach(file => {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const bad = (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
                code === 127 || code === 0xFFFD;
    if (!bad) continue;
    const line = text.slice(0, i).split('\n').length;
    mangled.push(file + ':' + line + '  U+' +
      code.toString(16).toUpperCase().padStart(4, '0') +
      '  …' + text.slice(Math.max(0, i - 30), i + 12).replace(/\n/g, '\\n') + '…');
  }
});
check('no mangled characters in any source file',
  mangled.length === 0,
  mangled.length
    ? mangled.slice(0, 12).join('\n        ') +
      (mangled.length > 12 ? '\n        …and ' + (mangled.length - 12) + ' more' : '') +
      '\n        A U+0014 is almost always an em dash that lost its encoding; U+FFFD is a character' +
      '\n        something could not decode. Put the real character back — do not delete the line.'
    : '');

/* ⭐ MIXED LINE ENDINGS IN ONE FILE (added 2026-08-24, after it happened twice in a
   day). Every source file here is CRLF throughout; an edit that writes LF lines into
   one leaves it mixed, and mixed is the state that causes damage quietly:

     - it produced an 82,754-line pull request for a 30-line change, because git saw
       every line as rewritten. Nothing was broken, but the diff was unreviewable and
       it would have collided head-on with anyone else working from main.
     - it silently broke two red-check anchors. A script searching for
       "const addr = ...\r\n  if(!addr)" simply did not match, reported "anchor not
       found", and the sabotage it was meant to run never ran. A verification step
       that quietly does nothing is worse than one that fails.

   ⚠ IT REPORTS THE MINORITY ENDING, not "this file is CRLF". Which convention a file
   uses is not this check's business and has flipped before in this repo — CLAUDE.md
   has recorded it as CRLF and as LF at different times, and both were true of some
   checkout. What is never right is one file holding both.

   ⚠ AND A FILE WITH NO NEWLINES AT ALL PASSES. Zero of each is not mixed. */
const mixed = [];
TEXT_FILES.forEach(file => {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const raw = fs.readFileSync(full, 'latin1');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length - crlf;
  if (crlf && lf) {
    mixed.push(file + '  ' + crlf + ' CRLF and ' + lf + ' LF — the ' +
      (crlf < lf ? crlf + ' CRLF' : lf + ' LF') + ' line(s) are the odd ones out');
  }
});
check('no file mixes CRLF and LF line endings',
  mixed.length === 0,
  mixed.length
    ? mixed.join('\n        ') +
      '\n        Normalise the whole file to whichever ending it already mostly uses.' +
      '\n        A mixed file makes an unreviewable diff and makes text anchors fail silently.'
    : '');

/* ⭐ A CARRIAGE RETURN THAT IS NOT A LINE ENDING (added 2026-08-28, because the check
   above did not catch it and I am the one who shipped it). c5eb93d extracted hcFixRow
   with a python edit and left 28 lines carrying \r\r\n — a stray CR sitting in front of
   the real ending. That commit's own notes record catching a line-ending slip in exactly
   that function and fixing it; the fix swapped one flavour of damage for another.

   ⚠ AND EVERY GATE PASSED, INCLUDING THE ONE ABOVE. Mixed-endings counts CRLF against
   LF, and \r\r\n is neither: the \n is preceded by an \r, so it counts as CRLF, and the
   extra \r is invisible to it. Zero LF, no mixing, green. It survived four merges.

   ⚠ IT IS HARMLESS TO A BROWSER, which is precisely why it needs a gate rather than a
   reader. A CR is whitespace to a parser, so nothing renders wrong and nothing throws —
   the damage is to every diff and every text anchor from then on, which is the same
   damage the mixed-endings check exists to stop, arriving by a door it does not watch.

   ⚠ SCOPED TO A CR THAT IS NOT FOLLOWED BY \n, so it says nothing about which ending a
   file uses — the check above already refuses to have that argument, for a reason it
   states, and this one must not start it. A lone CR mid-line is caught by the same rule
   and is the same kind of accident. */
const strayCR = [];
TEXT_FILES.forEach(file => {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const raw = fs.readFileSync(full, 'latin1');
  const hits = (raw.match(/\r(?!\n)/g) || []).length;
  if (hits) {
    /* Name the first one: "28 somewhere in a 54,000-line file" is a report, not a lead. */
    const at = raw.search(/\r(?!\n)/);
    const line = raw.slice(0, at).split('\n').length;
    strayCR.push(file + '  ' + hits + ' stray carriage return(s), first at line ' + line);
  }
});
check('no file carries a carriage return that is not a line ending',
  strayCR.length === 0,
  strayCR.length
    ? strayCR.join('\n        ') +
      '\n        A \\r\\r\\n reads as CRLF to every other check here, so nothing else will' +
      '\n        ever tell you. Strip the extra \\r — do not normalise the whole file.'
    : '');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
