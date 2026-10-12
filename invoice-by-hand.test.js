/* "THEY ALREADY HAVE THEIR INVOICE" (EM-28, 2026-10-12). `npm run test:invoice-by-hand`.
   Its own file per R-018.

   Addie: "can we make a place in invoice were we can check mark if someone got there
   invoice manually as well in case we did that seperate from the report", then "If I
   send it to someone manually it also shouldn't show test copy at the top."

   Two things, one flag (`invoiceSentByHand` on every house on the bill):
     - a tick on each Invoice List row, and
     - "Send it to the customer" beside the test send, which mails the real invoice with
       no test note and ticks the bill afterwards.
   The 7 PM run reads the flag and does not email that bill. What the run does with it
   is RUN in nightly-invoice.test.js; this file runs the office half and holds the
   wiring between the two. */
'use strict';
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
const adminSrc = read('admin.html');
const fnsSrc = read('functions/index.js');

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.log('  FAIL - ' + name + (detail ? '\n         ' + detail : ''));
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
function between(src, from, to) {
  const a = src.indexOf(from);
  if (a === -1) return '';
  const b = src.indexOf(to, a + from.length);
  return b === -1 ? '' : src.slice(a, b);
}

/* ---- The office half, RUN. The three functions are lifted as one slice; what they
   stand on (the bill's houses, Firestore, the toast) is faked, because the claim here
   is what THESE functions write and draw, not how a bill's houses are found. ---- */
const lifted = between(adminSrc, 'function invoiceHandState(invoiceKey){', '\nfunction renderInvoicesList(){');
check('the by-hand functions were found', lifted.length > 500);

function sandbox(houses, opts) {
  opts = opts || {};
  const writes = [], toasts = [], logs = [];
  let renders = 0;
  const jobAddresses = houses.map(h => ({ id: h.id, data: Object.assign({}, h.data) }));
  const env = {
    billedHousesFor: () => (opts.noHouses ? [] : houses),
    toJsDate: v => (v instanceof Date ? v : (v && v.toDate ? v.toDate() : null)),
    niceDate: d => 'D' + d.getDate(),
    esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    serverTimestamp: () => 'SERVER_TS',
    db: {},
    doc: (db, col, id) => col + '/' + id,
    updateDoc: async (ref, fields) => { if (opts.failOn === ref) throw new Error('refused'); writes.push([ref, fields]); },
    jobAddresses,
    invoiceDisplayName: () => 'Dana Payer',
    toast: m => toasts.push(m),
    logActivity: (...a) => logs.push(a),
    renderInvoicesList: () => { renders++; },
    console: { error() {} }
  };
  const names = Object.keys(env);
  const fns = new Function(...names, lifted +
    '\nreturn { state: invoiceHandState, row: invoiceByHandRowHtml, set: setInvoiceSentByHand };')(...names.map(n => env[n]));
  return { fns, writes, toasts, logs, jobAddresses, renders: () => renders };
}

const twoHouses = () => [
  { id: 'payer', data: { name: 'Dana Payer' } },
  { id: 'kid', data: { name: 'Kyle Kid' } }
];

(async function () {
  {
    const s = sandbox(twoHouses());
    const html = s.fns.row('8015550444');
    check('an untouched bill shows the tick, unticked, and says Not sent yet',
      /data-invbyhand="8015550444"/.test(html) && !/ checked/.test(html) && html.includes('Not sent yet')
        && html.includes('Invoice given by hand'));
  }
  {
    const s = sandbox([{ id: 'a', data: { invoiceEmailSent: true, invoiceEmailSentAt: new Date(2026, 9, 9) } }]);
    const html = s.fns.row('k');
    check('a bill the 7 PM run emailed says so, and is not ticked',
      html.includes('Emailed by the 7 PM run D9') && !/ checked/.test(html));
  }
  {
    const s = sandbox([{ id: 'a', data: {} }, { id: 'b', data: { invoiceSentByHand: true, invoiceSentByHandAt: new Date(2026, 9, 12) } }]);
    const html = s.fns.row('k');
    check('a bill is ticked when ANY house on it carries the mark (it need not be the payer)',
      / checked/.test(html) && html.includes('Marked as given by hand D12') && html.includes('will not email it'));
  }
  {
    const s = sandbox([], { noHouses: true });
    check('an invoice with no customer behind it offers no tick', s.fns.row('k') === '');
    const ok = await s.fns.set('k', true, null);
    check('and marking one writes nothing and says why',
      ok === false && s.writes.length === 0 && s.toasts.length === 1);
  }
  {
    const s = sandbox(twoHouses());
    const ok = await s.fns.set('8015550444', true, null);
    check('ticking writes the mark on EVERY house on the bill',
      ok === true && s.writes.length === 2
        && s.writes.every(w => w[1].invoiceSentByHand === true && w[1].invoiceSentByHandAt === 'SERVER_TS')
        && s.writes.map(w => w[0]).join() === 'jobAddresses/payer,jobAddresses/kid',
      JSON.stringify(s.writes) + ' — the 7 PM run asks whether ANY house on the bill is still waiting, so the payer alone is not enough');
    check('ticking NEVER writes invoiceEmailSent itself',
      s.writes.every(w => !('invoiceEmailSent' in w[1])),
      'that flag is what tells the 7 PM run the billing is finished — set from the office it would skip the join fee and any carried charge');
    check('and the screen is told at once: cache mirrored, list redrawn, toast, activity log',
      s.jobAddresses.every(a => a.data.invoiceSentByHand === true) && s.renders() === 1
        && s.toasts.length === 1 && /will not email/.test(s.toasts[0]) && s.logs.length === 1);
  }
  {
    const s = sandbox([{ id: 'a', data: { invoiceSentByHand: true } }]);
    await s.fns.set('k', false, null);
    check('unticking clears both the mark and its date',
      s.writes.length === 1 && s.writes[0][1].invoiceSentByHand === false && s.writes[0][1].invoiceSentByHandAt === null
        && s.jobAddresses[0].data.invoiceSentByHand === false);
  }
  {
    const s = sandbox(twoHouses(), { failOn: 'jobAddresses/kid' });
    const box = { checked: true };
    const ok = await s.fns.set('8015550444', true, box);
    check('a refused write is SAID, the box goes back, and nothing claims it was saved',
      ok === false && box.checked === false && s.toasts.length === 1 && /Could not save/.test(s.toasts[0])
        && s.renders() === 0 && s.logs.length === 0);
  }
  {
    const s = sandbox(twoHouses());
    await s.fns.set('8015550444', true, null, { quiet: true });
    check('the quiet form (used after a by-hand send) still writes and redraws, without a second toast',
      s.writes.length === 2 && s.toasts.length === 0 && s.renders() === 1);
  }

  /* ---- The wiring, as text with comments stripped. ---- */
  const list = stripComments(between(adminSrc, '\nfunction renderInvoicesList(){', '\nfunction ') +
    between(adminSrc, '\nfunction renderInvoicesList(){', "data-edit=\"invoices\"]').forEach"));
  check('every invoice row draws the tick', list.includes('invoiceByHandRowHtml(item.id)'));
  check('and the tick is listened to, and calls the writer with the box state',
    /\[data-invbyhand\]'\)\.forEach\(function\(cb\)\{\s*cb\.addEventListener\('change', function\(\)\{ setInvoiceSentByHand\(cb\.dataset\.invbyhand, cb\.checked, cb\); \}\);/.test(list));

  const season = between(adminSrc, 'completed: false, invoiceEmailSent: false, scheduled: false', 'removalDone');
  check('Start New Season clears the mark in the SAME write as invoiceEmailSent',
    /invoiceSentByHand: false, invoiceSentByHandAt: null/.test(stripComments(season)),
    'left standing, next season\'s bill would never be emailed to them');

  /* The by-hand SEND. */
  const send = stripComments(between(adminSrc, 'async function invTestSend(toCustomer){', "getElementById('invRealSendBtn')"));
  check('the send knows a real send only by === true', /const real = toCustomer === true;/.test(send),
    'the plain button\'s click handler passes an event, which is truthy');
  /* ⛔ NO TEST NOTE ON EITHER BUTTON (EM-29). It was first kept on the office's own copy;
     Addie: "why still show this?", then "Dont show test on that anyore". */
  check('neither button draws a test note any more',
    !/Test copy/.test(send) && !/Test copy\./.test(stripComments(adminSrc)),
    'the office copy is exactly what the customer would get');
  check('and both greet the customer by name, never "Test"',
    send.includes("to_name: d.name || ''") && !/to_name:[^,]*'Test'/.test(send));
  check('the plain button still writes NOTHING: the tick is behind the real send only',
    /if\(real\)\{\s*const ticked = await setInvoiceSentByHand\(key, true/.test(send)
      && send.split('setInvoiceSentByHand(').length === 2,
    'with the note gone, what the two buttons write is the only difference left between them');
  const iConfirm = send.indexOf('if(!confirm('), iSend = send.indexOf('emailjs.send('), iTick = send.indexOf('setInvoiceSentByHand(key, true');
  check('a real send asks first, sends, THEN ticks the bill — all three present and in that order',
    iConfirm !== -1 && iSend !== -1 && iTick !== -1 && iConfirm < iSend && iSend < iTick);
  check('the question is only asked on a real send, and says what the 7 PM run will still add',
    /if\(real\)\{[\s\S]*?owedLater[\s\S]*?if\(!confirm\(/.test(send) && send.includes('NOT ON THIS COPY YET'));
  check('a tick that fails after the send is said out loud', send.includes('could NOT be marked as given by hand'));
  check('both buttons exist and are wired to opposite answers',
    adminSrc.includes('id="invTestSendBtn"') && adminSrc.includes('id="invRealSendBtn"')
      && adminSrc.includes("getElementById('invTestSendBtn').addEventListener('click', function(){ invTestSend(false); })")
      && adminSrc.includes("getElementById('invRealSendBtn').addEventListener('click', function(){ invTestSend(true); })"));

  /* The server branch: where it sits is the money argument. */
  const run = stripComments(between(fnsSrc, 'const unbilled = active.filter(', "template_params: { to_email: email"));
  const iHand = run.indexOf('h.data.invoiceSentByHand === true');
  const iInvWrite = run.indexOf('invRef.set(');
  const iNoEmail = run.indexOf('if (!email) {');
  const iFetch = run.indexOf("fetch('https://api.emailjs.com");
  check('the 7 PM run reads the mark AFTER the invoice is written and BEFORE the no-email branch and the send',
    iHand !== -1 && iInvWrite !== -1 && iNoEmail !== -1 && iFetch !== -1
      && iInvWrite < iHand && iHand < iNoEmail && iNoEmail < iFetch,
    [iInvWrite, iHand, iNoEmail, iFetch].join(' < ') + ' — above the invoice write it would waive the bill; below the send it would email them anyway');
  check('the two files spell the field the same way',
    adminSrc.includes('invoiceSentByHand: true') && fnsSrc.includes('invoiceSentByHand === true'));
  check('the run reports how many it did not email, and the office screen shows it',
    /sentByHandCount, sentByHandNames/.test(run + fnsSrc) && adminSrc.includes("r.sentByHandCount+' not emailed (already given by hand)'"));

  console.log('\ninvoice-by-hand: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.log('invoice-by-hand crashed: ' + (err && err.stack || err)); process.exit(1); });
