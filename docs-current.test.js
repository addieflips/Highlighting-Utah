#!/usr/bin/env node
/* ============================================================================
 * THE MAP AND THE RULINGS MOVE WITH THE CODE — enforced, not remembered.
 *
 * Addie, 2026-08-28: "make sure its in just like you have to test everytime
 * before merging you have to update the system map and the question map".
 *
 * ⭐ THIS IS A `read` RULE BEING PROMOTED, WHICH IS THE RULEBOOK'S OWN INSTRUCTION.
 * CLAUDE.md §6: "A `read` rule that gets violated twice must be promoted to `code` or
 * `hook`. Text alone is not enforcement." §9.9 item 6 has drifted exactly that way and
 * says so about itself — on 2026-08-26 system-map.md still described needsLightBuild as
 * being set from lightsDescription, five days after that stopped being true, and
 * nothing anywhere went red. That file is the one document written to be TRUSTED by
 * somebody who does not read code, so a stale line in it is worse than a stale line
 * anywhere else: she acts on it.
 *
 * WHAT IT ASKS, AND WHY EACH HALF IS SHAPED THIS WAY
 *
 *   1. Source changed  →  system-map.md must have changed too.
 *      Decidable, and objective: git knows.
 *
 *   2. A commit message quotes her  →  the questions map must have changed too.
 *      ⭐ THIS IS THE HALF THAT LOOKED IMPOSSIBLE. R-023 records that the obligation to
 *      append "cannot be enforced — no check can see a conversation", and that is still
 *      true in general. But there is one signal that is not a conversation and IS in the
 *      repo: a commit message quoting her. If a change is being justified by something
 *      she said, a ruling was involved, and the map is where it belongs. It cannot catch
 *      a ruling nobody wrote down anywhere — nothing can — but it catches the case that
 *      actually happens, which is acting on her words and recording them in the commit
 *      instead of the map.
 *
 * ⚠ AND BOTH TAKE A STATED REASON INSTEAD. A gate with no way past it gets satisfied by
 * a junk line added to system-map.md to make it green, which is worse than nothing: the
 * document then carries noise AND the check has been defeated. So a commit may say
 *   No system-map change: <why>          /  No ruling this change: <why>
 * and that satisfies it. That is not a loophole, it is the point — the choice is between
 * a deliberate sentence and silence, and silence is what this removes.
 *
 * ⚠ IT MUST NEVER PASS QUIETLY WHEN IT CANNOT SEE. A shallow clone, or a run on main
 * itself, means there is no diff to judge. That is reported as a NOTE naming the reason,
 * never as a pass — a check that cannot find its target and says nothing is a green
 * build for the worst possible reason, which this repo has already shipped twice.
 * ========================================================================== */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const ROOT = __dirname;

let passed = 0, failed = 0, notes = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push({ name, detail });
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(msg) { notes++; console.log('  NOTE  ' + msg); }

const git = args => {
  try { return execSync('git ' + args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim(); } catch (e) { return null; }
};

/* The files a reader of system-map.md is being told about. Tests and docs are not here
   on purpose: a change to a suite alters no behaviour she could read about. */
const SOURCE = /^(admin\.html|index\.html|employee\.html|functions\/index\.js|js\/[^/]+\.js|firestore\.rules)$/;

console.log('');
console.log('=== Do the maps move with the code? ===');
console.log('');

const base = (function () {
  for (const ref of ['origin/main', 'main']) {
    const mb = git('merge-base ' + ref + ' HEAD');
    if (mb) return { ref, sha: mb };
  }
  return null;
})();

if (!base) {
  note('no main branch to compare against — a shallow clone, or a fork with no origin. ' +
       'Nothing was judged. This is NOT a pass: run it where the history exists.');
} else {
  const head = git('rev-parse HEAD');
  if (base.sha === head) {
    note('HEAD is the merge base, so this change is empty or this is main itself. ' +
         'Nothing to judge — which is correct here, not a pass being assumed.');
  } else {
    const changed = (git('diff --name-only ' + base.sha + '..HEAD') || '').split('\n')
      .map(s => s.trim()).filter(Boolean);
    const log = git('log --format=%B ' + base.sha + '..HEAD') || '';
    const touchedSource = changed.filter(f => SOURCE.test(f));

    check('the diff against ' + base.ref + ' could be read',
      changed.length > 0,
      'git returned no changed files at all, so nothing below proves anything');

    /* 1. system-map.md */
    if (touchedSource.length) {
      const said = /No system-map change:\s*\S/i.test(log);
      check('system-map.md moved with the code',
        changed.indexOf('system-map.md') !== -1 || said,
        touchedSource.join(', ') + ' changed and system-map.md did not.\n        ' +
        'That file is the one document written to be trusted by somebody who does not ' +
        'read code, so a stale line in it gets ACTED ON.\n        ' +
        'Update it — do not regenerate it, a wholesale rewrite loses the hard-won ' +
        'detail. Or, if this change genuinely alters nothing it describes, put a line ' +
        'in the commit message reading:\n            No system-map change: <why>');
    } else {
      note('no source file changed, so system-map.md was not required.');
    }

    /* 2. the questions map */
    const quotesHer = /(^|\s)(Addie|Owner|owner)\b[^\n]{0,60}?[:,]\s*["“]/.test(log);
    if (quotesHer) {
      const said = /No ruling this change:\s*\S/i.test(log);
      check('a change that quotes her also records the ruling',
        changed.indexOf('claude/questions-map.md') !== -1 || said,
        'a commit message here quotes her, and claude/questions-map.md did not change.' +
        '\n        If she decided something, R-023 says the row goes in THE SAME change ' +
        'that acts on it — a ruling recorded only in a commit message is one nobody will ' +
        'find again.\n        If the quotation is background rather than a new decision, ' +
        'say so:\n            No ruling this change: <why>');
    } else {
      note('no commit message here quotes her, so no ruling was detected. ⚠ That is a ' +
           'signal, not a proof — a ruling given in conversation and never written down ' +
           'anywhere is invisible to this and to everything else.');
    }
  }
}

console.log('');
if (failed) {
  console.log('  ' + failed + ' failure(s):');
  failures.forEach(f => console.log('   - ' + f.name));
  console.log('');
}
console.log(passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
process.exit(failed ? 1 : 0);
