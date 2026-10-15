/* MORE THAN ONE MANUAL DISCOUNT ([[MON-83]]) — `npm run test:discounts`, its own file per R-018.
 * Addie, 2026-10-14: "Why can't add more then one discount manually". The Edit Customer box held
 * ONE manual line and rebuilt it on every save, so a second discount replaced the first, and a
 * kind-less credit from the Invoices tab was loaded into the box and written back beside itself.
 * The save's own credit rebuild is lifted out and RUN against a real-shaped invoice.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
let passed = 0, failed = 0;
function check(name, ok, why) {
  if (ok) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}
/* The slice from the kept-notes filter to the line that totals them is the rebuild itself. */
const a = admin.indexOf('const keptNotes = priorNotes.filter(function(c){');
const b = admin.indexOf('const rebuiltCredits = rebuiltNotes.reduce', a);
check('the Edit Customer credit rebuild was found', a > 0 && b > a);
const body = admin.slice(a, b);
function run(priorNotes, newManualDiscount, newDiscountReason) {
  const boxes = { editCustManualDiscount: { value: String(newManualDiscount || '') }, editCustDiscountReason: { value: newDiscountReason || '' } };
  const document = { getElementById: id => boxes[id] };
  const f = new Function('priorNotes', 'newManualDiscount', 'newDiscountReason', 'referralCreditNotes', 'item', 'newReferralCount', 'document',
    body + '\nreturn {notes: rebuiltNotes, box: boxes};'.replace('boxes', 'document'));
  const out = f(priorNotes, newManualDiscount, newDiscountReason, () => [], { data: {} }, 0, document);
  return { notes: out.notes, box: boxes };
}
const first = { amount: 20, reason: 'Loyalty', kind: 'manual', date: '2026-10-01' };
const r1 = run([first], 15, 'Price match');
check('a second manual discount is ADDED, the first one stays', r1.notes.length === 2 &&
  r1.notes.some(n => n.reason === 'Loyalty' && n.amount === 20) && r1.notes.some(n => n.reason === 'Price match' && n.amount === 15),
  JSON.stringify(r1.notes));
check('the box is emptied once the discount is on the bill (a second Save cannot add it twice)', r1.box.editCustManualDiscount.value === '');
const r2 = run([first], 0, '');
check('saving with the box empty leaves every discount where it is', r2.notes.length === 1 && r2.notes[0] === first);
const invTab = { amount: 10, reason: 'Credit', date: '2026-10-02' };
const r3 = run([first, invTab], 0, '');
check('a credit added on the Invoices tab is kept once, never doubled', r3.notes.filter(n => n.reason === 'Credit').length === 1);
const r4 = run([{ amount: 25, reason: 'Referral — Jane', kind: 'referral' }], 0, '');
check('referral lines are still rebuilt from the referrals (not kept as manual)', r4.notes.length === 0);

const noComments = admin.replace(/\/\*[\s\S]*?\*\//g, '');
check('opening a customer starts the box empty, it no longer loads one line into it',
  /getElementById\('editCustManualDiscount'\)\.value = '';\r?\n\s*document\.getElementById\('editCustDiscountReason'\)\.value = '';/.test(noComments) &&
  !/editCustManualDiscount'\)\.value = ecManual/.test(noComments));
check('the Invoices tab Add credit logs the amount it added (no undefined name)', !/fmtMoney\(amount\) \+ ' credit for '/.test(noComments));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
