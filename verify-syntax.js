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

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
