/* WHAT THE ERROR FOLDER ACTUALLY HOLDS — WITHOUT NAMING ANYBODY
 * =============================================================
 * `node error-digest.js`, run by `.github/workflows/error-digest.yml` and by
 * nothing else. Addie, 2026-09-19: "how can we make it so errors are generated
 * first, you read the errors you fix the errors than fix the errors in admin
 * portal since those errors are no longer needed" — the loop she wants is
 * raise → READ → fix → clear, and three of those four already worked. This is
 * the read.
 *
 * ⛔ IT ONLY READS, AND THAT IS ENFORCED RATHER THAN PROMISED. The service
 * account this runs as deploys Cloud Functions, so it can write anything in the
 * project; the only thing standing between that and this script is the script
 * itself. `error-digest.test.js` fails the build if a write, update, delete,
 * add, set or batch call ever appears in this file. Do not add one — if
 * something needs to be written, it belongs in the app where Addie can see it.
 *
 * ⛔ AND IT NAMES NOBODY. Every row here carries who hit the fault ([[MSG-10]],
 * built so the OFFICE can ring them) — a staff address, a customer name, six
 * characters of a portal token. None of that helps fix a bug, and this output
 * lands in a GitHub Actions log that anybody with repo access can read. So the
 * identity fields are dropped and the body is scrubbed of anything
 * email-shaped. What survives is the fault: what broke, where, in which
 * browser, how often, and when it was first and last seen.
 * ⚠ THE SCRUB IS BELT AND BRACES OVER THE FIELD DROP, deliberately. The admin
 * reporter writes "Signed in as: …" into the message BODY as well as into
 * `staffEmail`, so dropping the field alone would still print the address.
 *
 * ⚠ IT READS THE WHOLE `messages` COLLECTION AND FILTERS IN MEMORY, on purpose.
 * A `where('topic','in',[…]).orderBy('createdAt')` needs a composite index, and
 * adding one means a hand-run `firebase deploy --only firestore:indexes` that
 * CI does not do — a report that cannot run until somebody deploys an index is
 * a report nobody runs. The collection is one season of post; reading it is
 * cheap and needs nothing deployed.
 */
'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const MEMBER_ERROR_TOPIC = 'Member Error';
const ADMIN_ERROR_TOPIC = 'Admin Error';
const MAX_DOCS = 5000;

/* Anything email-shaped, and the reporter's own "Signed in as" line. */
function scrub(text) {
  return String(text || '')
    .replace(/^\s*Signed in as:.*$/gim, 'Signed in as: (removed)')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(email removed)');
}

function asDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') { try { return v.toDate(); } catch (err) { return null; } }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function day(d) { return d ? d.toISOString().slice(0, 10) : '(no date)'; }

/* The shipped list, lifted out of admin.html so the report can say which faults
   SHOULD already have been swept. Wrapped: a parse failure degrades to "could
   not read the list" rather than taking the whole report down, because the
   report is useful without it and useless if it cannot run. */
function fixedErrorList() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
    const a = src.indexOf('const FIXED_ERRORS = [');
    if (a === -1) return null;
    const b = src.indexOf('\n];', a);
    if (b === -1) return null;
    const body = src.slice(a, b + 3) + '\nreturn FIXED_ERRORS;';
    return new Function('MEMBER_ERROR_TOPIC', 'ADMIN_ERROR_TOPIC', body)(
      MEMBER_ERROR_TOPIC, ADMIN_ERROR_TOPIC);
  } catch (err) {
    return null;
  }
}

/* The same normalisation admin.html uses, so "covered by an entry" here means
   what it means there. Copied rather than imported because this file runs on
   Node with no DOM; the gate asserts the two agree. */
function needle(text) {
  return String(text || '').toLowerCase().replace(/[0-9]+/g, '#').replace(/\s+/g, ' ').trim();
}
function coveredBy(list, d) {
  if (!Array.isArray(list)) return null;
  const key = needle(d.errorKey);
  const topic = String(d.topic || '');
  if (!key) return null;
  for (const e of list) {
    if (e && e.topic && String(e.topic) !== topic) continue;
    const n = needle(e && e.match);
    if (n.length >= 12 && key.indexOf(n) !== -1) return e;
  }
  return null;
}

/* ⛔ MATCHING THE NEEDLE IS NOT THE WHOLE RULE, AND THE FIRST VERSION OF THIS
   REPORT PRETENDED IT WAS. `clearFixedErrors` also holds the report to a DATE
   FLOOR: anything written on or after `fixedOn` survives, because a fix that did
   not take re-reports itself and sweeping it would delete the evidence.
   ⚠ SO "covered and still here" LUMPED TWO OPPOSITE ANSWERS TOGETHER. One is
   housekeeping — the sweep has not run, reload admin. The other is NEWS: the
   fault came back AFTER its fix shipped, which on an RSVP means a customer's
   answer was lost anyway and somebody has to ring them. Reported as one number,
   the second hides inside the first, and it is the only one worth acting on.
   The first reading of the real folder had exactly one of each and they were
   read as the same thing. */
function afterTheFix(entry, when) {
  if (!entry || !when) return false;
  const b = String(entry.fixedOn || '').split('-');
  if (b.length !== 3) return false;
  const floor = new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  return isNaN(floor.getTime()) ? false : when >= floor;
}

async function main() {
  admin.initializeApp();
  const db = admin.firestore();

  const snap = await db.collection('messages').limit(MAX_DOCS).get();
  const fixed = fixedErrorList();

  const groups = new Map();
  let total = 0, errors = 0;
  snap.forEach(function (doc) {
    total++;
    const d = doc.data() || {};
    const topic = String(d.topic || '');
    if (topic !== MEMBER_ERROR_TOPIC && topic !== ADMIN_ERROR_TOPIC) return;
    errors++;
    const key = String(d.errorKey || '(no errorKey)');
    let g = groups.get(key);
    if (!g) {
      g = { key: key, topic: topic, count: 0, first: null, last: null, sample: '', covered: coveredBy(fixed, d) };
      groups.set(key, g);
    }
    g.count++;
    const when = asDate(d.createdAt);
    if (when) {
      if (!g.first || when < g.first) g.first = when;
      if (!g.last || when > g.last) g.last = when;
    }
    if (!g.sample) g.sample = scrub(d.message).split('\n').filter(Boolean).slice(0, 6).join('\n     ');
  });

  const list = Array.from(groups.values()).sort(function (a, b) { return b.count - a.count; });

  console.log('');
  console.log('=== The Errors folder, by fault ===');
  console.log('');
  console.log('messages read: ' + total + (total >= MAX_DOCS ? ' (hit the ' + MAX_DOCS + ' cap)' : ''));
  console.log('error reports: ' + errors + '   distinct faults: ' + list.length);
  console.log('FIXED_ERRORS entries loaded: ' + (fixed ? fixed.length : 'could not read the list'));
  console.log('');

  if (!list.length) {
    console.log('  Nothing. No Member Error or Admin Error rows at all.');
  }

  const awaitingSweep = [];
  const cameBack = [];
  list.forEach(function (g, i) {
    console.log((i + 1) + '. [' + g.topic + ']  x' + g.count + '   ' + day(g.first) + ' → ' + day(g.last));
    if (g.covered && afterTheFix(g.covered, g.last)) {
      cameBack.push(g);
      console.log('   ⛔ THE FIX DID NOT TAKE. Its entry ("' + g.covered.match + '") shipped ' +
        g.covered.fixedOn + ' and this fault was reported again on ' + day(g.last) +
        '. It is NOT swept, on purpose — this is new news, not housekeeping.');
    } else if (g.covered) {
      awaitingSweep.push(g);
      console.log('   ⚠ FIXED, WAITING TO BE SWEPT ("' + g.covered.match + '", fixed ' +
        g.covered.fixedOn + '). It goes on the next admin load.');
    }
    console.log('   key: ' + g.key.slice(0, 160));
    if (g.sample) console.log('     ' + g.sample);
    console.log('');
  });

  console.log('=== What to do with this ===');
  console.log('');
  console.log('A fault with no entry is one nobody has fixed, or one fixed without its entry.');
  console.log(awaitingSweep.length
    ? awaitingSweep.length + ' fault(s) (' + awaitingSweep.reduce(function (n, g) { return n + g.count; }, 0) +
      ' report(s)) are fixed and waiting — open admin and they go. If they are still here after that, the sweep IS broken.'
    : 'Nothing is sitting fixed-but-unswept.');
  if (cameBack.length) {
    console.log('');
    console.log('⛔ ' + cameBack.length + ' fault(s) came back AFTER their fix shipped. Read those first —');
    console.log('   a member one means a customer\'s answer was lost anyway and they think they told us.');
  }
  console.log('');
  console.log('Nobody is named in this report on purpose. Open the Errors badge in admin for who hit what.');
}

main().then(function () { process.exit(0); }).catch(function (err) {
  console.error('error digest failed: ' + (err && err.stack || err));
  process.exit(1);
});
