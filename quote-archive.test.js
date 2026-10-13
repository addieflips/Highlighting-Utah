#!/usr/bin/env node
/* ============================================================================
 * AN UNANSWERED QUOTE GOES TO THE ARCHIVE THIRTY DAYS AFTER IT FIRST WENT OUT
 * `npm run test:quote-archive` — its own file per R-018. [[QT-52]].
 *
 * Addie, 2026-10-13: "Awaiting responses in quotes should go in archive after 30 days of
 * sending first email." The ladder ([[QT-49]]) already archived at its third rung, but only
 * a quote that reached rung two — so one whose automatic email failed, or that went to
 * somebody who asked for a phone call, sat in Awaiting Response for ever.
 *
 * ⛔ RUN, NOT MATCHED. Every claim is date arithmetic on a record, so the real
 * `quoteArchiveDueServer` is lifted out of functions/index.js and run over fixtures.
 * ⛔ AND THE FIRST SEND IS STAMPED BY EVERY DOOR. quoteSentAt is rewritten by the
 * office's own Nudge button, so the 30 days are measured from `quoteFirstSentAt`; a door
 * that sends without stamping it would leave that quote measured from a LATER date. The
 * census below counts every write of quoteSentAt / quoteManuallySent in admin.html and
 * requires each to carry the stamp.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); return; }
  fail++; failures.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

/* Brace-matched lift, strings and comments skipped — the same walk money-parity uses. */
function extractFn(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  let depth = 0, inLine = false, inBlock = false, quote = null, esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (esc) { esc = false; continue; }
    if (quote) { if (ch === '\\') esc = true; else if (ch === quote) quote = null; continue; }
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i++; } continue; }
    if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(m.index, i + 1);
  }
  return null;
}

const fns = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

console.log('\n--- The rule, run ---\n');
const dueSrc = extractFn(fns, 'quoteArchiveDueServer');
const msSrc = extractFn(fns, 'toMillis');
check('quoteArchiveDueServer and toMillis can be lifted', !!dueSrc && !!msSrc);
const daysConst = /const QUOTE_ARCHIVE_DAYS = (\d+);/.exec(fns);
check('the archive is thirty days, as she said', !!daysConst && daysConst[1] === '30',
  'found ' + (daysConst ? daysConst[1] : 'no constant'));

let due = () => false;
try {
  due = new Function(msSrc + '\n' + extractFn(fns, 'quoteFirstSentMs') + '\n' + 'const QUOTE_ARCHIVE_DAYS = ' + (daysConst ? daysConst[1] : 30) + ';\n' +
    dueSrc + '\nreturn quoteArchiveDueServer;')();
} catch (e) { check('the rule runs', false, e.message); }

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 13, 16, 0);
const ago = d => new Date(NOW - d * DAY);
const open = extra => Object.assign({ quotedPrice: 400, approvalStatus: 'pending', status: 'new' }, extra);

check('an unanswered quote first sent 30 days ago is archived',
  due(open({ quoteFirstSentAt: ago(30) }), NOW) === true);
check('and one sent 29 days ago is not',
  due(open({ quoteFirstSentAt: ago(29) }), NOW) === false);
check('the FIRST send decides, not the last nudge — a quote nudged yesterday but first sent 31 days ago is archived',
  due(open({ quoteFirstSentAt: ago(31), quoteSentAt: ago(1) }), NOW) === true,
  'quoteSentAt is rewritten by the office Nudge button; reading it would keep a chased quote open for ever');
check('a quote whose automatic nudge never went out is still archived on time',
  due(open({ quoteFirstSentAt: ago(35), quoteNudgeTextAskedAt: ago(25) }), NOW) === true,
  'this is the case the ladder could never reach: no quoteNudgeEmailedAt, so no rung three');
check('an APPROVED quote waiting on its form is never archived — they said yes',
  due(open({ quoteFirstSentAt: ago(60), approvalStatus: 'approved' }), NOW) === false);
check('declined and maybe-next-year are left alone (already closed)',
  due(open({ quoteFirstSentAt: ago(60), approvalStatus: 'declined' }), NOW) === false &&
  due(open({ quoteFirstSentAt: ago(60), approvalStatus: 'maybe_next_year' }), NOW) === false);
check('an archived or closed quote is not archived again',
  due(open({ quoteFirstSentAt: ago(60), quoteArchived: true }), NOW) === false &&
  due(open({ quoteFirstSentAt: ago(60), status: 'closed' }), NOW) === false);
check('an unpriced quote is not archived — nobody has been asked anything',
  due({ approvalStatus: 'pending', quoteFirstSentAt: ago(60) }, NOW) === false);
check('a quote never sent is not archived',
  due(open({}), NOW) === false);
check('an OLD quote with no first-send stamp falls back to the EARLIER of its two send dates',
  due(open({ quoteSentAt: ago(2), quoteManuallySentAt: ago(40) }), NOW) === true &&
  due(open({ quoteSentAt: ago(2), quoteManuallySentAt: ago(20) }), NOW) === false,
  'the fallback can only be late, never early — both stamps can be rewritten by a later send');

console.log('\n--- It runs before the gates ---\n');
const batch = extractFn(fns, 'runQuoteNudgeBatch') || '';
const passAt = batch.indexOf('archiveStaleQuotes(');
const seasonAt = batch.indexOf('denverMonth >= 11');
const switchAt = batch.indexOf("source === 'schedule' && (!setSnap.exists");
check('the archive pass is called by the daily batch', passAt > -1);
check('ahead of the November stop and the on/off switch — those are about chasing, and archiving chases nobody',
  passAt > -1 && seasonAt > passAt && switchAt > passAt,
  'positions: archive ' + passAt + ', season ' + seasonAt + ', switch ' + switchAt);
const archiver = extractFn(fns, 'archiveStaleQuotes') || '';
check('the pass asks the one rule, and writes the reason the card shows',
  /quoteArchiveDueServer\(/.test(archiver) && /quoteArchivedReason/.test(archiver));

console.log('\n--- Every door that sends stamps the first send ---\n');
check('the stamp helper exists and never overwrites a stamp already there',
  /function quoteFirstSentStamp\(d\)\{\s*return \(d && d\.quoteFirstSentAt\) \? \{\} : \{quoteFirstSentAt: serverTimestamp\(\)\};/.test(admin));
/* Each write that marks a quote sent: quoteSentAt set to a timestamp, or quoteManuallySent
   set true. ⚠ A CENSUS, NOT A FLOOR — a new door is a deliberate edit to this number. */
const lines = admin.split(/\r?\n/);
const doors = [];
lines.forEach((l, i) => {
  if (/quoteSentAt:\s*serverTimestamp\(\)|\{quoteManuallySent: true, quoteManuallySentAt: serverTimestamp\(\)\}/.test(l)) doors.push(i);
});
const unstamped = doors.filter(i => !lines.slice(Math.max(0, i - 2), i + 6).join('\n').includes('quoteFirstSentStamp('));
check('there are six doors that mark a quote sent', doors.length === 6,
  'found ' + doors.length + ' — a door added or removed; check it stamps quoteFirstSentAt and change this number');
check('and every one of them stamps the first send', unstamped.length === 0,
  'lines without the stamp: ' + unstamped.map(i => i + 1).join(', '));
check('a re-quote clears the first-send stamp with the send date — a new price is a new quote',
  /quoteSentAt: null,\r?\n\s*quoteFirstSentAt: null,/.test(admin));

console.log('\n--- The Send text sub-section (QT-54), run ---\n');
{
  const names = ['daysSince', 'quoteWasSentOut', 'quoteStage', 'quoteFirstSentDays', 'quoteNeedsText'];
  const srcs = names.map(n => extractFn(admin, n));
  check('the text rule and what it reads can be lifted', srcs.every(Boolean),
    'missing: ' + names.filter((n, i) => !srcs[i]).join(', '));
  let needs = () => false;
  try { needs = new Function('let quoteTextWaitDays = 10;\n' + srcs.join('\n') + '\nreturn quoteNeedsText;')(); }
  catch (e) { check('the text rule runs', false, e.message); }
  const ts = d => ({ toDate: () => new Date(Date.now() - d * DAY) });
  const q = extra => Object.assign({ quotedPrice: 400, approvalStatus: 'pending', quoteSentAt: ts(12), quoteFirstSentAt: ts(12) }, extra);
  check('a quote first emailed 12 days ago with no reply is owed a text', needs(q({})) === true);
  check('one emailed 9 days ago is not yet', needs(q({ quoteSentAt: ts(9), quoteFirstSentAt: ts(9) })) === false);
  check('marked texted, it goes back to Awaiting response', needs(q({ quoteNudgeTextedAt: ts(0) })) === false);
  check('past the email rung, it is not owed a text any more', needs(q({ quoteNudgeEmailedAt: ts(1) })) === false);
  check('an approved quote waiting on its form is never owed a text — they answered',
    needs(q({ approvalStatus: 'approved' })) === false);
  check('a re-send does not hide it — the FIRST send decides', needs(q({ quoteSentAt: ts(1) })) === true);
}
const markSrc = extractFn(admin, 'markQuoteTexted') || '';
check('Mark as texted writes the stamp the ladder reads', /quoteNudgeTextedAt: serverTimestamp\(\)/.test(markSrc));
check('and the list is wired to it', /data-marktexted/.test(admin) && /markQuoteTexted\(b\.dataset\.marktexted/.test(admin));

console.log('\n=== Unanswered quotes go to the archive after 30 days ===\n');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
