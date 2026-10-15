/* A MEMBER'S ERROR ROW CLEARS ONCE THEIR RECORD SAYS IT WENT THROUGH ([[MSG-34]])
 * `npm run test:errorsettled` — its own file per R-018. The real errorSettledBy is lifted
 * out of admin.html and RUN; the rows are shaped like the ones in the folder on 14 October.
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
const a = admin.indexOf('const ERROR_SETTLED_ANSWERS');
const b = admin.indexOf('];', a);
check('the answers table was found', a > 0 && b > a);
const code = admin.slice(a, b + 2) + '\n' + extractFn(admin, 'errorSettledBy') + '\n' + extractFn(admin, 'toJsDate');
const settled = new Function('MEMBER_ERROR_TOPIC', code + '\nreturn errorSettledBy;')('Member Error');
const M = 'Member Error';
const row = (key, when) => ({ topic: M, errorKey: key, createdAt: new Date(when) });

check('a Yes the record holds clears', settled(row('Answering Yes to the RSVP email|internal', '2026-10-10'), { rsvpStatus: 'yes' }, null) === 'answer on record');
check('a Yes the record does NOT hold stays', settled(row('Answering Yes to the RSVP email|internal', '2026-10-10'), { rsvpStatus: '' }, null) === '');
check('a Yes where the record says no stays (somebody to ring)', settled(row('Answering Yes to the RSVP email|internal', '2026-10-10'), { rsvpStatus: 'no' }, null) === '');
check('a No clears only on no', settled(row('Answering No to the RSVP email|internal', '2026-10-10'), { rsvpStatus: 'no' }, null) === 'answer on record' &&
  settled(row('Answering No to the RSVP email|internal', '2026-10-10'), { rsvpStatus: 'yes' }, null) === '');
check('Back Next Year clears only on backnextyear', settled(row('Answering Back Next Year from the RSVP email|internal', '2026-10-10'), { rsvpStatus: 'backnextyear' }, null) === 'answer on record');
check('a card row clears when a payment lands AFTER it', settled(row('Paying by card or PayPal|started a card payment # times', '2026-10-14T08:00:00Z'), {}, { lastPaymentAt: new Date('2026-10-14T15:58:00Z') }) === 'paid since');
check('a card row stays when the last payment was BEFORE it', settled(row('Paying by card or PayPal|x', '2026-10-14T08:00:00Z'), {}, { lastPaymentAt: new Date('2026-10-12T15:58:00Z') }) === '');
check('a card row stays with no bill', settled(row('Starting a card or PayPal payment|x', '2026-10-14'), {}, null) === '');
check('a row that names nobody stays', settled(row('Answering Yes to the RSVP email|internal', '2026-10-10'), null, null) === '');
check('an admin error is never touched', settled({ topic: 'Admin Error', errorKey: 'Answering Yes to the RSVP email|x', createdAt: new Date() }, { rsvpStatus: 'yes' }, null) === '');
check('any other member fault stays', settled(row('Saving your light colours|internal', '2026-10-10'), { rsvpStatus: 'yes' }, null) === '');

const noComments = admin.replace(/\/\*[\s\S]*?\*\//g, '');
check('the sweep asks it beside the fixed-fault rule', /if\(errorFixedBy\(m\.data\) \|\| errorSettledFor\(m\.data\)\) due\.push\(m\.id\);/.test(noComments));
check('and the sweep runs again when the customers arrive', /clearFixedErrors\(\);/.test(extractFn(noComments, 'loadJobAddresses')));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
