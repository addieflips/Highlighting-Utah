/*
 * How big a photograph is allowed to reach Cloudinary — Highlighting Utah
 *
 * Addie, 2026-09-18, after the picture service switched itself off on 9/9 and took every
 * photograph in the app down with it — asked what else was worth doing, she chose this.
 *
 * ⛔ THE DOWNSCALER WAS ALWAYS THERE AND ALMOST NEVER FIRED, which is the whole bug. It
 * only ran on a file over NINE MEGABYTES, and an ordinary phone photograph is three to
 * six — so virtually every picture in the book was stored at full camera resolution while
 * being shown at 400px and printed at an inch and a half. Storage and bandwidth are what
 * Cloudinary bills for, so that was the whole of the bill for no visible benefit.
 *
 * Every way this can be undone is silent — a photograph that is too big looks identical to
 * one that is right, on every screen, for ever. So:
 *
 *   - the threshold goes back up (a revert, or a "9" typed back in), and nothing looks
 *     different until the account is disabled again;
 *   - a call site is left spelling the numbers out for itself, so five of six move and one
 *     does not — the shape this repo has been bitten by whenever one rule lives in six
 *     places (the bins count, the put-into wording, the quote renderers);
 *   - somebody "saves more" by dropping the DIMENSION instead of the bytes, which is the
 *     one that shows, on the printed crew sheet first, where nobody is looking at a screen;
 *   - a new upload path is added and simply never shrinks, which is how ten of the paths
 *     in this file already behave (see the note at the foot of this file).
 *
 * ⚠ THE BEHAVIOURAL CHECK IS THE ONE THAT EARNS THE FILE. Matching the source proves the
 * constant is written down; it cannot prove a four-megabyte photograph is actually caught.
 * So the real `shrinkImageFileIfTooLarge` is LIFTED and RUN against stubs, and the claim
 * asserted is the one that matters: a file that used to pass through untouched now reaches
 * the decoder. Run against the OLD threshold the same check fails, which is what makes it
 * a test rather than a restatement.
 *
 * R-018 says not to add checks to run-all.js, so this is one file, one job.
 *
 * Run:  node photo-size.test.js      (or: npm run test:photosize)
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

/* ⚠ COMMENTS ARE STRIPPED BEFORE ANY SEARCH FOR A NUMBER, and this file would fail on
   correct code without it: the block that explains the change quotes the old
   `9*1024*1024` as the thing it replaced. Suites 58, 274, 275 and 300 each had to learn
   this separately — a check that reads its own explanation is reading the wrong thing. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const code = stripComments(admin);

/* Walks to the matching brace — CLAUDE.md §7 bans a fixed-length window and run-all
   enforces it. This one is not async, but the async form is tried first anyway so the
   helper does not quietly return '' if that ever changes. */
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

/* ---- 1. the numbers exist, and are bounded in BOTH directions ------------- */

function constValue(name) {
  const m = code.match(new RegExp('const\\s+' + name + '\\s*=\\s*([0-9.*\\s]+);'));
  if (!m) return null;
  // Only digits, dots, spaces and '*' ever reach here — the regex above allows nothing else.
  try { return Function('"use strict";return (' + m[1] + ')')(); } catch (e) { return null; }
}

const PHOTO_BYTES = constValue('PHOTO_SHRINK_OVER_BYTES');
const PHOTO_DIM = constValue('PHOTO_MAX_DIMENSION');
const PHOTO_Q = constValue('PHOTO_JPEG_QUALITY');
const BPM_BYTES = constValue('BPM_SHRINK_OVER_BYTES');
const BPM_DIM = constValue('BPM_MAX_DIMENSION');
const BPM_Q = constValue('BPM_JPEG_QUALITY');

check('the photo threshold is declared', PHOTO_BYTES !== null);
check('the photo dimension is declared', PHOTO_DIM !== null);
check('the photo quality is declared', PHOTO_Q !== null);
check('the blueprint threshold is declared', BPM_BYTES !== null);
check('the blueprint dimension is declared', BPM_DIM !== null);
check('the blueprint quality is declared', BPM_Q !== null);

/* ⛔ THE CEILING IS THE POINT OF THIS FILE. An ordinary phone photograph is 3–6 MB, so a
   threshold at or above 3 MB means the common case is not caught and the change has been
   undone — which is exactly what nine megabytes was. */
check('an ordinary phone photo is caught (threshold under 3 MB)',
  PHOTO_BYTES !== null && PHOTO_BYTES < 3 * 1024 * 1024,
  'threshold is ' + (PHOTO_BYTES / 1024 / 1024).toFixed(2) + ' MB');
check('the blueprint threshold is under 3 MB too',
  BPM_BYTES !== null && BPM_BYTES < 3 * 1024 * 1024,
  'threshold is ' + (BPM_BYTES / 1024 / 1024).toFixed(2) + ' MB');

/* ⚠ AND A FLOOR, which guards the opposite mistake. Squeezing harder by dropping the
   DIMENSION is the change that shows: a crew sheet prints a photo at an inch and a half,
   which is ~450px of ink, and the roof measurement shots are looked at closely. 1200px is
   comfortably clear of every use; below it somebody is trading the printed sheet for
   storage without saying so. */
check('the photo dimension is not squeezed below 1200px',
  PHOTO_DIM !== null && PHOTO_DIM >= 1200, 'dimension is ' + PHOTO_DIM);
check('a blueprint keeps at least as much detail as a photo',
  BPM_DIM !== null && PHOTO_DIM !== null && BPM_DIM >= PHOTO_DIM,
  'blueprint ' + BPM_DIM + ' vs photo ' + PHOTO_DIM);
check('the quality is still a real JPEG quality',
  PHOTO_Q > 0.6 && PHOTO_Q <= 1 && BPM_Q > 0.6 && BPM_Q <= 1,
  'photo ' + PHOTO_Q + ', blueprint ' + BPM_Q);

/* ---- 2. nothing types the numbers out for itself ------------------------- */

const calls = code.match(/shrinkImageFileIfTooLarge\([^)]*\)/g) || [];
/* The declaration itself is in that list and names its parameters, not values. */
const callSites = calls.filter(c => c.indexOf('maxBytes') === -1);

check('every call site was found', callSites.length > 0);

const withNumbers = callSites.filter(c => /\d\s*\*\s*1024|\b9\b|\b2000\b|\b2400\b|0?\.8[56]/.test(c));
check('no call site spells the numbers out for itself',
  withNumbers.length === 0, withNumbers.join(' | '));

const photoCalls = callSites.filter(c => c.indexOf('PHOTO_SHRINK_OVER_BYTES') !== -1);
const bpmCalls = callSites.filter(c => c.indexOf('BPM_SHRINK_OVER_BYTES') !== -1);

/* ⚠ A CENSUS, NOT A CEILING, and it is deliberately written down rather than derived: a
   call site DISAPPEARING is as interesting as one arriving, because an upload path that
   stops shrinking is invisible on every screen. If you add or remove one, change this
   number in the same commit and say why. */
check('six photograph upload paths shrink, and one blueprint path does',
  photoCalls.length === 6 && bpmCalls.length === 1,
  photoCalls.length + ' photo, ' + bpmCalls.length + ' blueprint');

check('every photo call passes all three constants together',
  photoCalls.every(c => c.indexOf('PHOTO_MAX_DIMENSION') !== -1 && c.indexOf('PHOTO_JPEG_QUALITY') !== -1),
  photoCalls.join(' | '));
check('the blueprint call passes its own three',
  bpmCalls.every(c => c.indexOf('BPM_MAX_DIMENSION') !== -1 && c.indexOf('BPM_JPEG_QUALITY') !== -1),
  bpmCalls.join(' | '));

/* ⚠ THE CONSTANTS MUST BE DECLARED BEFORE THE FIRST THING THAT READS THEM. admin.html's
   module script is one scope and a `const` sits in the temporal dead zone until its own
   line runs — these are only ever read from inside functions called long afterwards, so
   this is belt and braces rather than a live bug. It is asserted because the same shape
   HAS bitten this repo for real: [[MEM-01]] records a `var` beside a function hoisting as
   undefined and a feature silently never working. */
check('the constants are declared before the first call site',
  code.indexOf('const PHOTO_SHRINK_OVER_BYTES') < code.indexOf('shrinkImageFileIfTooLarge(files[i]'),
  'declared at ' + code.indexOf('const PHOTO_SHRINK_OVER_BYTES'));

/* ---- 3. RUN it: a 4 MB photograph is actually caught --------------------- */

const src = lift('shrinkImageFileIfTooLarge');
check('the shrinker was found to run', src.length > 0);

/* Returns whether the decode path was ENTERED. The stub Image fails on load, so the
   promise still resolves with the original file either way — which is precisely why the
   assertion is about createObjectURL rather than about the returned value. A check on the
   return would pass whatever the threshold said. */
function entersDecoder(sizeBytes, maxBytes, dimension, quality) {
  let entered = false;
  const sandbox = Function('src', 'onCreate', `
    let URL = {
      createObjectURL: function(f){ onCreate(); return 'blob:stub'; },
      revokeObjectURL: function(){}
    };
    function Image(){
      const self = this;
      Object.defineProperty(self, 'src', {
        set: function(){ setTimeout(function(){ if(self.onerror) self.onerror(); }, 0); }
      });
    }
    let document = { createElement: function(){ throw new Error('canvas not reached'); } };
    ${src}
    return shrinkImageFileIfTooLarge;
  `)(src, function () { entered = true; });

  return sandbox({ type: 'image/jpeg', size: sizeBytes, name: 'house.jpg' }, maxBytes, dimension, quality)
    .then(function () { return entered; });
}

const FOUR_MB = 4 * 1024 * 1024;
const ONE_MB = 1 * 1024 * 1024;

Promise.all([
  entersDecoder(FOUR_MB, PHOTO_BYTES, PHOTO_DIM, PHOTO_Q),
  entersDecoder(ONE_MB, PHOTO_BYTES, PHOTO_DIM, PHOTO_Q),
  entersDecoder(FOUR_MB, 9 * 1024 * 1024, 2000, 0.85)
]).then(function (r) {
  const [bigCaught, smallSkipped, bigUnderOldRule] = r;

  /* ⭐ THE CHECK THE WHOLE FILE EXISTS FOR. */
  check('an ordinary 4 MB phone photo is now shrunk before upload', bigCaught === true);

  /* ⚠ AND THE OTHER DIRECTION, or a threshold of zero would pass the check above while
     re-encoding every thumbnail in the book for nothing. */
  check('a photo already small enough is left completely alone', smallSkipped === false);

  /* ⚠ THIS IS THE RED-CHECK, RUN EVERY TIME RATHER THAN ONCE BY HAND. It proves the check
     above can fail: the same 4 MB file against the OLD nine-megabyte rule must NOT be
     caught. If this ever returns true the assertion above has stopped meaning anything —
     the vacuous-fixture trap this repo names in a dozen places. */
  check('red-check: the same photo was NOT caught under the old 9 MB rule',
    bigUnderOldRule === false);

  done();
}).catch(function (err) {
  check('the shrinker ran without throwing', false, String((err && err.message) || err));
  done();
});

function done() {
  console.log('');
  console.log('=== How big a photograph reaches Cloudinary ===');
  console.log('');
  console.log('  photographs   shrink over ' + (PHOTO_BYTES / 1024 / 1024).toFixed(2) +
    ' MB, down to ' + PHOTO_DIM + 'px at q' + PHOTO_Q);
  console.log('  blueprints    shrink over ' + (BPM_BYTES / 1024 / 1024).toFixed(2) +
    ' MB, down to ' + BPM_DIM + 'px at q' + BPM_Q);
  console.log('');
  /* ⚠ REPORTED, NOT FAILED, AND DELIBERATELY SO. Ten other paths reach
     uploadOneToCloudinary with no shrink at all — the website gallery, the hero images,
     house details, the layout map and expense receipts among them, all of which take a
     file a person picked. Widening to those is its own change: several can legitimately be
     a PNG with transparency, and this shrinker always writes JPEG, so a background would
     appear where one never was. Named here so the next session finds it as a decision
     rather than as an oversight. */
  const uploads = (code.match(/uploadOneToCloudinary\(/g) || []).length;
  console.log('  NOTE  ' + uploads + ' call(s) of uploadOneToCloudinary in admin.html; ' +
    (photoCalls.length + bpmCalls.length) + ' of those paths shrink first.');
  console.log('        The rest upload the file as picked. That is NOT a failure and is');
  console.log('        not widened here — some of them can be a PNG with transparency and');
  console.log('        this shrinker always writes JPEG. See the note in this file.');
  console.log('');
  failures.forEach(function (f) { console.log('  FAIL  ' + f); });
  if (failures.length) console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
