/* WHO A CUSTOMER REFERRED, WHEN, AND WHETHER IT HAS TURNED INTO MONEY ([[REF-45]])
 * `npm run test:referral-people` — its own file per R-018.
 * Addie, 2026-10-14: "show who someone enrolled and when they enrolled them and if they
 * converted to costumer or not ... if not converted to costumer than can show pending discount."
 * ⚠ RUN, NOT MATCHED: the real referralPeopleRows / referralPeopleHtml are lifted out of
 * admin.html with the real helpers they call, never stubbed.
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
function extractFn(src, name) {
  let i = src.indexOf('\nfunction ' + name + '(');
  if (i === -1) throw new Error('could not find function ' + name);
  i++;
  let depth = 0, started = false;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('no end for ' + name);
}
const NAMES = ['referralPeopleRows', 'referralPeopleHtml', 'referralPendingQuotes', 'referralTokensOf',
  'referralSeasonForBill', 'referralEntrySeason', 'toJsDate'];
const code = NAMES.map(n => extractFn(admin, n)).join('\n');
const sandbox = new Function('REFERRAL_CREDIT', 'fmtMoney', 'esc', 'houseIsOnTheBill',
  code + '\nreturn {referralPeopleRows, referralPeopleHtml};');
const api = sandbox(25, n => '$' + Number(n).toFixed(2),
  s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  () => true);

const year = new Date().getFullYear();
const referrer = {
  referralToken: 'tokNOW',
  referralCredits: [
    { referredCustomerId: 'c1', referredName: 'Kelly Friend', creditedAt: year + '-09-25T15:00:00Z', season: year },
    { referredCustomerId: 'c2', referredName: 'Crossed Off', creditedAt: year + '-09-20T15:00:00Z', season: year, waived: true }
  ],
  referralBlocks: [{ quote: 'q9', referredName: 'Same Phone', why: 'the phone number or email is the same as theirs', at: year + '-09-10T15:00:00Z' }]
};
const quotes = [
  { id: 'q1', data: { name: 'Kelly Friend', referredByToken: 'tokNOW', createdAt: year + '-09-13T15:00:00Z',
                      convertedToCustomerAt: year + '-09-25T15:00:00Z', convertedToCustomerId: 'c1', referralCredited: true } },
  { id: 'q2', data: { name: 'Waiting Wendy', referredByToken: 'tokNOW', createdAt: year + '-10-05T15:00:00Z' } },
  { id: 'q3', data: { name: 'Someone Else', referredByToken: 'OTHER', createdAt: year + '-10-06T15:00:00Z' } },
  { id: 'q4', data: { name: 'Archived Al', referredByToken: 'tokNOW', createdAt: year + '-10-01T15:00:00Z', quoteArchived: true } }
];
const rows = api.referralPeopleRows(referrer, quotes);
const by = n => rows.find(r => r.name === n);
check('every referral is listed once (credited, crossed off, pending, refused)', rows.length === 4, JSON.stringify(rows.map(r => r.name)));
check('a converted friend reads as a customer', by('Kelly Friend') && by('Kelly Friend').state === 'customer');
check('a converted friend\'s "used the link" date is their QUOTE date, not the credit date',
  by('Kelly Friend') && by('Kelly Friend').usedAt.toISOString().slice(5, 10) === '09-13');
check('a friend not yet converted is PENDING', by('Waiting Wendy') && by('Waiting Wendy').state === 'pending');
check('another customer\'s link is not listed', !by('Someone Else'));
check('an archived quote is not pending', !by('Archived Al'));
check('a crossed-off credit says so', by('Crossed Off') && by('Crossed Off').state === 'waived');
check('a refused use is listed with its reason', by('Same Phone') && by('Same Phone').state === 'refused' && /phone/.test(by('Same Phone').why));
check('newest first', rows[0].name === 'Waiting Wendy');

const html = api.referralPeopleHtml(rows);
check('the table shows a pending discount', /Pending \$25\.00/.test(html));
check('the table shows the $25 off for a customer', /\$25\.00 off/.test(html));
check('the table names the people', /Kelly Friend/.test(html) && /Waiting Wendy/.test(html));
check('no referrals draws nothing', api.referralPeopleHtml([]) === '');
check('a name is escaped', /&lt;b&gt;/.test(api.referralPeopleHtml([{ name: '<b>x', usedAt: null, state: 'pending' }])));

const noComments = admin.replace(/\/\*[\s\S]*?\*\//g, '');
check('the Discounts box draws the table', /statusLine\.innerHTML\s*=\s*money\.join\(''\)\s*\+\s*\r?\n?\s*referralPeopleHtml\(referralPeopleRows\(d,/.test(noComments));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
