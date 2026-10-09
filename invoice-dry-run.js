/* WHAT TONIGHT'S INVOICE RUN WOULD DO, WITHOUT DOING ANY OF IT
 * ===========================================================
 * Actions → "Dry run the nightly invoice" → Run workflow, then read the job log.
 *
 * Addie, 2026-10-09, with 49 houses waiting and billing suspended at Google:
 * "next time I need to make sure invoice will send with email in the right way to the
 * right people." Those 49 bills go out in one burst the moment billing is restored, and
 * the only way to be sure beforehand is to RUN the thing and read what comes out.
 *
 * ⛔ IT RUNS THE REAL runInvoiceBatch. Not a description of it, not a second copy — the
 * shipped function, lifted out of functions/index.js, over a snapshot of the real book,
 * against her real templates. Anything less answers a question about a model of the run
 * rather than the run. Every token hole found on 2026-10-06 lived in the half no harness
 * had ever exercised.
 *
 * ⛔ AND IT CANNOT SEND OR WRITE ANYTHING, BY CONSTRUCTION RATHER THAN BY CARE.
 *   - The real Firestore handle is used for READS ONLY, and `invoice-dry-run.test.js`
 *     pins every one of them to an exact `.get()` shape and counts them.
 *   - The batch is handed a FAKE, in-memory database built from that snapshot. Every
 *     write it makes lands in a JavaScript object and is thrown away. The real `db` is
 *     never passed to it — that is the whole safety argument, and it is one line.
 *   - `fetch` is a fake that records the email and returns ok. EmailJS is never called.
 *   - `ensureToken` is stubbed: minting a portal token is a WRITE, and a dry run that
 *     edits the book by being looked at is not a dry run ([[RS-65]]'s rule).
 *
 * ⛔ AND IT NAMES NOBODY ([[PROC-36]]). The output is an Actions log anybody with repo
 * access can read. It reports COUNTS and amounts, and the one sample email it prints is
 * scrubbed of that customer's name, address, email and token first. Who is on tonight's
 * list belongs in the admin portal, which already shows her.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const MAX_CUSTOMERS = 5000;
const MAX_INVOICES = 5000;

admin.initializeApp();
const db = admin.firestore();

const out = [];
const say = s => { out.push(s); console.log(s); };
const money = n => '$' + (Number(n) || 0).toFixed(2);

/* ---- the real rules, lifted ------------------------------------------- */
const fns = fs.readFileSync(path.join(__dirname, 'functions/index.js'), 'utf8');
function lift(name) {
  for (const opener of ['async function ' + name + '(', 'function ' + name + '(']) {
    const at = fns.indexOf(opener);
    if (at === -1) continue;
    const end = fns.indexOf('\n}', at);
    if (end === -1) return '';
    return fns.slice(at, end + 2);
  }
  return '';
}
/* ⚠ THE SAME CENSUS nightly-invoice.test.js KEEPS, and for the same reason: a name that
   stops being lifted arrives as a bare ReferenceError from the middle of a run. This repo
   records being caught by that twelve times. */
const LIFTED = ['runInvoiceBatch', 'houseIsOnTheBillServer', 'computeInvoiceStatusServer',
  'invoiceKeyFor', 'digitsOnly', 'todayStrInDenver', 'tryFirestore', 'invoiceDueDateServer',
  'invoiceSeasonYearServer', 'endOfFebruaryServer', 'centsOf', 'properNameServer',
  'payerHouseOfServer', 'heldBillReason', 'heldBillWorkDoneAt', 'reportHeldBill',
  'clearHeldBill', 'toMillis', 'logNightlyInvoiceRun', 'nightlyInvoiceTemplateNameServer'];
const num = re => Number((fns.match(re) || [])[1]);
const str = re => (fns.match(re) || [])[1];

/* ---- a fake database. Every write the run makes lands here and is dropped. ---- */
function makeFakeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed));
  const writes = [];
  const docApi = (col, id) => ({
    id: id,
    get: async () => ({ exists: !!(store[col] && store[col][id]),
                        data: () => store[col] && store[col][id] }),
    set: async (v, o) => { writes.push({ op: 'set', col, id });
      store[col] = store[col] || {};
      store[col][id] = Object.assign({}, (o && o.merge) ? store[col][id] : {}, v); },
    update: async (v) => { writes.push({ op: 'update', col, id });
      store[col] = store[col] || {};
      store[col][id] = Object.assign({}, store[col][id], v); }
  });
  const empty = { docs: [], forEach: () => {}, empty: true, size: 0 };
  return {
    writes, store,
    collection: (col) => ({
      doc: (id) => docApi(col, id),
      add: async () => { writes.push({ op: 'add', col }); return { id: 'dry' }; },
      get: async () => {
        const rows = Object.keys(store[col] || {}).map(id => ({
          id, ref: docApi(col, id), data: () => store[col][id], exists: true }));
        return { docs: rows, forEach: f => rows.forEach(f), empty: !rows.length, size: rows.length };
      },
      where: () => ({ get: async () => empty, limit: () => ({ get: async () => empty }) })
    })
  };
}
const Timestamp = {
  now: () => { const ms = Date.now(); return { __ts: ms, toDate: () => new Date(ms) }; },
  fromMillis: (m) => ({ __ts: m, toDate: () => new Date(m) })
};
const adminStub = { firestore: Object.assign(() => ({}), {
  Timestamp, FieldValue: { serverTimestamp: () => ({ __sv: true }), increment: n => ({ __inc: n }) }
}) };

/* A Firestore Timestamp does not survive JSON, and the run compares dates. Put the
   shape back so heldBillReason and the due-date maths see what they see in production. */
function reviveDates(obj) {
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (v && typeof v === 'object' && typeof v._seconds === 'number') {
      const ms = v._seconds * 1000;
      obj[k] = { __ts: ms, seconds: v._seconds, toDate: () => new Date(ms), toMillis: () => ms };
    }
  }
  return obj;
}

(async function main() {
  say('WHAT THE NIGHTLY INVOICE WOULD DO — DRY RUN, NOTHING SENT, NOTHING SAVED');
  say('='.repeat(72));
  say('Read at ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
  say('');

  const missing = LIFTED.filter(n => !lift(n));
  if (missing.length) {
    say('⛔ could not lift: ' + missing.join(', '));
    process.exit(1);
  }

  /* ---- READ ONLY. Four reads, and the real handle is never used again. ---- */
  const jobAddresses = {}, invoices = {}, templates = [];
  let emailjs = {}, autoDoc = {}, pricing = {};
  const custSnap = await db.collection('jobAddresses').limit(MAX_CUSTOMERS).get();
  custSnap.forEach(d => { jobAddresses[d.id] = reviveDates(d.data() || {}); });
  const invSnap = await db.collection('invoices').limit(MAX_INVOICES).get();
  invSnap.forEach(d => { invoices[d.id] = reviveDates(d.data() || {}); });
  const tplSnap = await db.collection('emailTemplates').get();
  tplSnap.forEach(d => templates.push(d.data() || {}));
  const setSnap = await db.collection('settings').get();
  setSnap.forEach(d => {
    if (d.id === 'emailjs') emailjs = d.data() || {};
    if (d.id === 'nightlyInvoiceAutomation') autoDoc = d.data() || {};
    if (d.id === 'pricing') pricing = d.data() || {};
  });

  say('Read from the live book: ' + Object.keys(jobAddresses).length + ' customers, ' +
      Object.keys(invoices).length + ' invoices, ' + templates.length + ' templates.');
  say('');

  const fake = makeFakeDb({
    settings: { emailjs, nightlyInvoiceAutomation: autoDoc },
    pricing: { config: pricing.config || pricing || {} },
    jobAddresses, invoices, messages: {}
  });

  /* ⚠ THE REAL TEMPLATES, matched the way the server matches them — flattened dashes
     and case, because an em dash and a hyphen are indistinguishable in a text box and
     that difference once sent the built-in wording instead of hers. */
  const flat = s => String(s || '').toLowerCase().replace(/[‐-―−-]/g, '').replace(/\s+/g, '');
  const tplByName = {};
  templates.forEach(t => { if (t.name) tplByName[flat(t.name)] = t; });

  const sent = [];
  const asked = [];
  const fakeFetch = async (url, init) => {
    try { sent.push(JSON.parse(init.body).template_params); } catch (e) { sent.push({}); }
    return { ok: true, text: async () => 'ok' };
  };
  const sandbox = LIFTED.map(lift).join('\n\n') + `
async function findTemplateSnapByName(n){
  __asked.push(n);
  const t = __tpl[__flat(n)];
  return t ? { empty:false, docs:[{ data: () => t }] } : { empty:true, docs:[] };
}
function templateSubjectOr(t, f){ return (t && t.subject) || f; }
async function ensureToken(id, d){ return 'DRYRUN-TOKEN'; }
const NEW_MEMBER_FEE = ${num(/const NEW_MEMBER_FEE = (\d+)/)};
const BILL_HELD_DAYS = ${num(/const BILL_HELD_DAYS = (\d+)/)};
const NIGHTLY_UNPAID_TEMPLATE = ${JSON.stringify(str(/const NIGHTLY_UNPAID_TEMPLATE = '([^']+)'/))};
const NIGHTLY_PAID_TEMPLATE = ${JSON.stringify(str(/const NIGHTLY_PAID_TEMPLATE = '([^']+)'/))};
return runInvoiceBatch('dry-run');
`;
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  const fn = new Function('db', 'admin', 'fetch', 'console', '__asked', '__tpl', '__flat', sandbox);
  const res = await fn(fake, adminStub, fakeFetch, quiet, asked, tplByName, flat);

  /* ---- 1. WHO WOULD GET ONE ------------------------------------------- */
  say('1. WHO WOULD BE EMAILED');
  say('-'.repeat(72));
  say('   ⭐ BILLS THAT WOULD SEND      : ' + res.sentCount);
  const total = sent.reduce((n, p) => {
    const m = String(p && p.body || '').match(/\$([0-9,]+\.[0-9]{2})/);
    return n + (m ? Number(m[1].replace(/,/g, '')) : 0);
  }, 0);
  say('   (first money figure on each) : ' + money(total));
  say('');
  say('   Nobody else, and why:');
  say('     not finished yet            : ' + res.skippedNotDone);
  say('     still flagged needs-fix     : ' + res.skippedNeedsFix);
  say('     no email address on file    : ' + res.skippedNoEmail);
  say('     held for an unfinished house: ' + (res.heldNames || []).length);
  say('     errors during the run       : ' + res.errorCount);
  (res.errors || []).forEach(e => say('        ! ' + String(e).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(email removed)')));
  say('');
  say('   ⚠ A shared bill waits for its LAST house, so "held" is the rule working,');
  say('     not a fault — but it is the commonest reason a bill you expected is absent.');
  say('');

  /* ---- 2. WHAT THE EMAIL ACTUALLY SAYS --------------------------------- */
  say('2. WHAT THE EMAIL ACTUALLY SAYS');
  say('-'.repeat(72));
  say('   template asked for: ' + (asked.length ? [...new Set(asked)].join(', ') : '(none)'));
  if (!sent.length) {
    say('   No email would go out, so there is no body to show.');
  } else {
    /* ⛔ EVERY UNFILLED CODE, COUNTED ACROSS EVERY BILL. This is the check that would
       have caught {{credit_lines}} before 41 customers saw it: a token the renderer
       does not know about comes out as its own characters and reaches an inbox. */
    const holes = {};
    sent.forEach(p => {
      (String(p && p.body || '').match(/\{\{[a-zA-Z_]+\}\}/g) || [])
        .forEach(t => { holes[t] = (holes[t] || 0) + 1; });
    });
    const names = Object.keys(holes);
    if (names.length) {
      say('   ⛔ CODES THAT WOULD REACH CUSTOMERS AS RAW TEXT:');
      names.forEach(t => say('        ' + t + '  on ' + holes[t] + ' bill(s)'));
      say('      Fix the template or the renderer before this run goes out.');
    } else {
      say('   ✓ no unfilled {{codes}} in any of the ' + sent.length + ' bodies.');
    }
    say('');
    /* One sample, scrubbed. The point is the WORDING and the figures, never the person. */
    const sample = sent[0];
    let body = String(sample.body || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '(email removed)')
      .replace(/DRYRUN-TOKEN/g, '(their token)');
    const who = String(sample.to_name || '').trim();
    if (who) body = body.split(who).join('(customer name)');
    say('   One bill, with the customer scrubbed out:');
    say('   ' + '-'.repeat(68));
    body.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
        .forEach(l => say('   | ' + l.slice(0, 150)));
    say('   ' + '-'.repeat(68));
    say('   subject: ' + String(sample.subject || '(none)'));
  }
  say('');

  /* ---- 3. NOTHING WAS SENT OR SAVED ------------------------------------ */
  say('3. AND NONE OF IT HAPPENED');
  say('-'.repeat(72));
  say('   emails handed to the fake sender : ' + sent.length + '  (EmailJS was never called)');
  say('   writes made to the fake database : ' + fake.writes.length + '  (thrown away)');
  say('   writes made to the REAL database : 0  — the run was never given the real handle');
  say('');
  say('='.repeat(72));
  say('Read §2 first. A raw {{code}} there is a customer seeing it; everything else is');
  say('about who, which §1 answers by count.');
})().catch(e => {
  console.error('invoice-dry-run failed: ' + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
