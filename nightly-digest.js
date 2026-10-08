/* WHY THE NIGHTLY INVOICE DID OR DID NOT SEND — WITHOUT NAMING ANYBODY
 * ====================================================================
 * `node nightly-digest.js`, run by `.github/workflows/nightly-digest.yml` and by
 * nothing else. Addie, 2026-10-08: "So tonight an invoice should have gone out
 * but looks like it didn't can you check to see why?" — and the answer was
 * entirely in her Firestore, which nothing outside the admin portal could read.
 *
 * ⛔ THE ONE THING THIS EXISTS FOR: A RUN THAT IS SWITCHED OFF LEAVES NO TRACE.
 * `sendNightlyInvoices` reads settings/nightlyInvoiceAutomation and, if
 * `enabled` is not true, RETURNS BEFORE LOGGING ANYTHING — its own comment says
 * "do nothing, don't even log". So "no invoice arrived" has two completely
 * different causes that look identical from outside: the switch is off, or the
 * run fired and found nobody to bill. Nothing on any screen separates them,
 * because the screen that would (Last 10 nightly runs) is fed by the log the
 * off-switch never writes to. This prints the switch AND the log, so the two
 * are never confused again.
 *
 * ⛔ IT ONLY READS, AND THAT IS ENFORCED RATHER THAN PROMISED — the same rule as
 * error-digest.js, for the same reason. The service account this runs as deploys
 * Cloud Functions, so it can write anything in the project; the only thing
 * standing between that and this script is the script itself.
 * `nightly-digest.test.js` fails the build if a write, update, delete, add, set
 * or batch call appears here. Do not add one: nothing about diagnosing a run
 * needs to change a record, and a tool that can bill people is not a tool you
 * run to find out whether people were billed.
 *
 * ⛔ AND IT NAMES NOBODY. A run log carries `noEmailNames` and `heldNames` —
 * real customers — and the Errors folder's own reader already settled this
 * ([[PROC-36]]): the output lands in a GitHub Actions log that anybody with repo
 * access can read, so what survives is the FAULT, never the person. Counts and
 * reasons here; who it was lives in the admin portal, where it is useful and
 * access-controlled. Do not "improve" this by adding names back.
 *
 * ⚠ IT READS WHOLE COLLECTIONS AND FILTERS IN MEMORY, on purpose — the same
 * argument error-digest.js makes: an indexed query needs a hand-run
 * `firebase deploy --only firestore:indexes` that CI does not do, and a report
 * that cannot run until somebody deploys an index is a report nobody runs.
 */
'use strict';

const admin = require('firebase-admin');

const MAX_RUNS = 14;          // a fortnight of nights is enough to see a pattern
const MAX_CUSTOMERS = 5000;

admin.initializeApp();
const db = admin.firestore();

const n = v => Number(v) || 0;
const when = ts => {
  try { return ts && ts.toDate ? ts.toDate().toISOString().replace('T', ' ').slice(0, 16) : '—'; }
  catch (e) { return '—'; }
};
/* An error line can quote a customer name or a template the office typed. The
   template name is the useful half and carries no person, so email-shaped text
   and a trailing "'s bill:" owner are removed and the rest is kept. */
const scrub = t => String(t || '')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(email removed)')
  .replace(/left out of .*?'s bill:/g, "left out of (a customer)'s bill:");

(async function main() {
  const out = [];
  const say = s => { out.push(s); console.log(s); };

  say('NIGHTLY INVOICE — WHY IT DID OR DID NOT SEND');
  say('='.repeat(64));
  say('Read at ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
  say('');

  /* ---- 1. THE SWITCH. The one cause that leaves no other trace. ---------- */
  say('1. THE SWITCH  (settings/nightlyInvoiceAutomation)');
  say('-'.repeat(64));
  let auto = null;
  try {
    const snap = await db.collection('settings').doc('nightlyInvoiceAutomation').get();
    auto = snap.exists ? (snap.data() || {}) : null;
  } catch (e) { say('   could not read it: ' + e.message); }

  if (auto === null) {
    say('   ⛔ THE DOCUMENT DOES NOT EXIST. `!autoSnap.exists` is the first half of the');
    say('      gate, so the 7 PM run returns immediately and logs NOTHING. This alone');
    say('      explains an invoice that never arrived and left no row.');
  } else if (auto.enabled !== true) {
    say('   ⛔ NIGHTLY INVOICING IS **OFF**  (enabled = ' + JSON.stringify(auto.enabled) + ')');
    say('      This is the whole answer. The 7 PM run reads this flag first and returns');
    say('      before logging, so there is no row in Last 10 nightly runs and no error');
    say('      anywhere — indistinguishable from a run that found nobody to bill.');
    say('      FIX: Invoices → Nightly Automation → switch it back on. Then press Send');
    say('      Invoices Now to catch up tonight rather than waiting for 7 PM.');
  } else {
    say('   ✓ nightly invoicing is ON (enabled = true), so the run did fire.');
    say('     Whatever happened is in the run log below, not in the switch.');
  }
  if (auto) {
    /* ⛔ WHEN was it switched on? That is the whole remaining question once the switch
       reads ON and the log is EMPTY: either it was turned on just now (so no 7 PM has
       passed yet, and nothing is wrong) or it has been on for weeks and the scheduled
       function is not firing at all. Those need completely different answers.
       ⚠ KEYS AND DATES ONLY, NEVER OTHER VALUES. This document has held `alertPhone`,
       and PROC-36's rule is that this output names nobody. */
    say('   fields on the document: ' + Object.keys(auto).sort().join(', '));
    Object.keys(auto).forEach(function (k) {
      if (!/At$|^updated|^created|Date$/i.test(k)) return;
      say('   ' + k + ': ' + when(auto[k]));
    });
    const u = String(auto.unpaidTemplateName || '').trim();
    const p = String(auto.paidTemplateName || '').trim();
    say('   template for bills still owing : ' + (u || '(standard)'));
    say('   template for bills paid in full: ' + (p || '(standard)'));
  }
  say('');

  /* ---- 2. THE RUN LOG --------------------------------------------------- */
  say('2. THE LAST ' + MAX_RUNS + ' RUNS  (nightlyInvoiceLog)');
  say('-'.repeat(64));
  let runs = [];
  try {
    const snap = await db.collection('nightlyInvoiceLog').get();
    snap.forEach(d => runs.push(d.data() || {}));
    runs.sort((a, b) => {
      const ta = a.runAt && a.runAt.toMillis ? a.runAt.toMillis() : 0;
      const tb = b.runAt && b.runAt.toMillis ? b.runAt.toMillis() : 0;
      return tb - ta;
    });
    runs = runs.slice(0, MAX_RUNS);
  } catch (e) { say('   could not read it: ' + e.message); }

  if (!runs.length) {
    say('   ⛔ NO RUNS LOGGED AT ALL. Either the switch has never been on, or the');
    say('      scheduled function is not firing. Check 1 above first.');
  } else {
    for (const r of runs) {
      const bits = [n(r.sentCount) + ' sent'];
      if (n(r.errorCount)) bits.push(n(r.errorCount) + ' ERRORS');
      if (n(r.skippedNotDone)) bits.push(n(r.skippedNotDone) + ' skipped (not completed)');
      if (n(r.skippedNeedsFix)) bits.push(n(r.skippedNeedsFix) + ' skipped (needs fix)');
      if (n(r.skippedNoEmail)) bits.push(n(r.skippedNoEmail) + ' NO EMAIL');
      if (Array.isArray(r.heldNames) && r.heldNames.length) {
        bits.push(r.heldNames.length + ' held bills (work done, not billed)');
      }
      say('   ' + when(r.runAt) + '  [' + (r.triggeredBy || '?') + ']  ' + bits.join(', '));
      (Array.isArray(r.errors) ? r.errors : []).forEach(e => say('        ! ' + scrub(e)));
    }
    const last = runs[0];
    say('');
    say('   The most recent run: ' + when(last.runAt) + ', triggered by "' +
        (last.triggeredBy || '?') + '", ' + n(last.sentCount) + ' sent.');
  }
  say('');

  /* ---- 3. WAS THERE ANYTHING TO SEND? ----------------------------------
     The question behind hers. A run that sends nothing is CORRECT when nobody
     is eligible, and `invoiceEmailSent` is permanent for the season — so a
     house caught by an earlier press of Send Invoices Now will never bill
     again, however many nights pass. Counts only; no names. */
  say('3. IS THERE ANYTHING WAITING TO BE BILLED?  (jobAddresses)');
  say('-'.repeat(64));
  try {
    const snap = await db.collection('jobAddresses').limit(MAX_CUSTOMERS).get();
    let total = 0, done = 0, doneUnbilled = 0, doneUnbilledNoEmail = 0,
        doneUnbilledNeedsFix = 0, alreadyBilled = 0;
    /* A date is not a person. When the work finished says whether the money has been
       sitting still for one night or for a month. */
    let newestMs = 0, oldestMs = 0, newestDone = '', oldestDone = '';
    snap.forEach(d => {
      const c = d.data() || {};
      total++;
      const isDone = c.completed === true;
      const sent = c.invoiceEmailSent === true;
      if (isDone) done++;
      if (sent) alreadyBilled++;
      if (isDone && !sent) {
        doneUnbilled++;
        const email = String(c.email || c.billToEmail || '').trim();
        if (!email) doneUnbilledNoEmail++;
        if (c.needsFix) doneUnbilledNeedsFix++;
        const ms = c.completedAt && c.completedAt.toMillis ? c.completedAt.toMillis() : 0;
        if (ms) {
          if (ms > newestMs) { newestMs = ms; newestDone = when(c.completedAt); }
          if (!oldestMs || ms < oldestMs) { oldestMs = ms; oldestDone = when(c.completedAt); }
        }
      }
    });
    say('   customers on the books          : ' + total);
    say('   marked completed                : ' + done);
    say('   already billed this season      : ' + alreadyBilled);
    say('   ⭐ COMPLETED AND NOT YET BILLED : ' + doneUnbilled);
    if (newestDone) say('   newest of those finished at   : ' + newestDone);
    if (oldestDone) say('   oldest of those finished at   : ' + oldestDone);
    if (doneUnbilledNoEmail) say('        of those, with NO email on file: ' + doneUnbilledNoEmail);
    if (doneUnbilledNeedsFix) say('        of those, still flagged needs-fix: ' + doneUnbilledNeedsFix);
    say('');
    if (doneUnbilled === 0) {
      say('   ⭐ NOTHING WAS WAITING. A run that sends nothing here is CORRECT, not');
      say('      broken. `invoiceEmailSent` is permanent for the season, so anybody');
      say('      caught by an earlier Send Invoices Now will never bill again — which');
      say('      is exactly what an unexpectedly quiet night looks like.');
    } else {
      say('   ⚠ ' + doneUnbilled + ' house(s) are finished and unbilled, so there IS money');
      say('     waiting. If the switch is on and the last run sent 0, read its skip');
      say('     counts above: a shared bill waits for its LAST house, so one unfinished');
      say('     sibling holds the whole bill (that is the rule, not a fault).');
    }
  } catch (e) { say('   could not read it: ' + e.message); }
  say('');

  /* ---- 4. DO THE TEMPLATES IT WILL ASK FOR EXIST? ----------------------- */
  say('4. THE TEMPLATES THE RUN WILL LOOK FOR  (emailTemplates)');
  say('-'.repeat(64));
  try {
    const snap = await db.collection('emailTemplates').get();
    const names = [];
    snap.forEach(d => { const t = d.data() || {}; if (t.name) names.push(String(t.name)); });
    const flat = s => String(s || '').toLowerCase().replace(/[—–-]/g, '').replace(/\s+/g, '');
    for (const [label, picked, standard] of [
      ['bills still owing', String((auto || {}).unpaidTemplateName || '').trim(), 'Nightly Auto-Invoice — Unpaid'],
      ['bills paid in full', String((auto || {}).paidTemplateName || '').trim(), 'Nightly Auto-Invoice — Paid Receipt']
    ]) {
      const want = picked || standard;
      const hit = names.find(nm => flat(nm) === flat(want));
      say('   ' + label + ': wants "' + want + '" → ' +
          (hit ? 'found' : 'NOT FOUND, will fall back'));
    }
    say('   (' + names.length + ' templates on file)');
    say('   ⚠ A missing template never stops a bill — the run drops to the standard');
    say('     name, then to built-in wording, and says so in the log. So this is');
    say('     almost never the reason nothing sent; it changes the WORDING, not the send.');
  } catch (e) { say('   could not read it: ' + e.message); }

  say('');
  say('='.repeat(64));
  say('Read §1 first. If the switch is off, that is the answer and nothing else');
  say('matters. If it is on, §2 says what the run decided and §3 says whether it');
  say('had anything to decide about.');
})().catch(e => {
  console.error('nightly-digest failed: ' + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
