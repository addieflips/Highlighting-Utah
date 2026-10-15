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
/* ⛔ THE LIFT LIST IS WORKED OUT, NOT TYPED — and the FIRST real run of this script is
   why. It shipped with a hand-written list copied from nightly-invoice.test.js, main had
   since split four helpers out of the invoice body, and every single bill died on
   `invoiceEmailPlaceServer is not defined`. The run reported 0 bills would send, which
   read as a fact about the book and was a fact about my list.
   ⚠ THAT IS THE EXTRACTION-LIST TRAP FOR THE THIRTEENTH TIME in this repo, and twelve
   hand-maintained lists is enough: a list that must be edited whenever somebody else
   refactors is a list that will be wrong again. So the closure is computed — start at
   runInvoiceBatch, add every name it calls that this file DEFINES, repeat until nothing
   new appears.
   ⚠ `ensureToken` IS HELD BACK DELIBERATELY and is the one name that must never be
   lifted: the real one WRITES a portal token, and a dry run that edits the book by being
   looked at is not a dry run. Everything else is better taken from the source than
   described by me — which is how the real `findTemplateSnapByName` and `tplNameKey` now
   arrive, replacing a flattener of my own that disagreed with the server's and sent every
   bill to the built-in wording. */
const NEVER_LIFT = new Set(['ensureToken']);
const DEFINED = new Set([...fns.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\(/gm)].map(m => m[1]));
function liftClosure(seed) {
  const want = new Set(seed);
  for (let pass = 0; pass < 20; pass++) {
    const body = [...want].map(lift).join('\n');
    let added = 0;
    for (const m of body.matchAll(/(?<![.\w])([A-Za-z0-9_]+)\s*\(/g)) {
      const n = m[1];
      if (DEFINED.has(n) && !want.has(n) && !NEVER_LIFT.has(n)) { want.add(n); added++; }
    }
    if (!added) return [...want];
  }
  return [...want];
}
const LIFTED = liftClosure(['runInvoiceBatch']);
const num = re => Number((fns.match(re) || [])[1]);
/* ⛔ A CONSTANT IS LIFTED AS ITS DECLARATION, NEVER AS ITS VALUE RE-DERIVED HERE —
   the lift-closure lesson one level down, and it cost a wrong answer about live bills.
   The template names are written `'Nightly Auto-Invoice — Unpaid'` in the source, so
   capturing the text BETWEEN THE QUOTES hands back the six characters `—` rather than
   an em dash; through JSON.stringify those arrived in the sandbox as themselves, the run
   asked for a name no template could carry, and the report said NOT ON FILE about two
   templates that were sitting right there. Pulling the whole `const X = …;` line in lets
   the sandbox's own parser read the escape exactly as node reads it in production. */
const CONSTS = ['NEW_MEMBER_FEE', 'BILL_HELD_DAYS', 'NIGHTLY_UNPAID_TEMPLATE', 'NIGHTLY_PAID_TEMPLATE'];
const decl = name => (fns.match(new RegExp('^const ' + name + ' = [^\\n]*?;', 'm')) || [])[0];

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
  /* ⚠ AND THE CONSTANTS ARE COUNTED THE SAME WAY. A declaration that stops matching comes
     through as `undefined` in the sandbox, which for a template NAME is a lookup for
     nothing and reads on the report as the office having renamed something. */
  const missingConsts = CONSTS.filter(n => !decl(n));
  if (missingConsts.length) {
    say('⛔ could not lift the constant(s): ' + missingConsts.join(', '));
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
    jobAddresses, invoices, messages: {},
    /* ⚠ SEEDED so the server's OWN findTemplateSnapByName can read them out of the fake
       database exactly as it reads the real one — that is what removes my flattener. */
    emailTemplates: templates.reduce((o, t, i) => { o['t' + i] = t; return o; }, {})
  });

  const sent = [];
  const asked = [];
  const fakeFetch = async (url, init) => {
    try { sent.push(JSON.parse(init.body).template_params); } catch (e) { sent.push({}); }
    return { ok: true, text: async () => 'ok' };
  };
  /* ⛔ THE TEMPLATE LOOKUP IS THE SERVER'S OWN, not a stub. The first version matched
     names with a flattener I wrote here, it disagreed with `tplNameKey`, and EVERY bill
     fell back to the built-in wording while the templates sat right there on file — a
     second opinion answering about itself, which is the mistake this repo has been bitten
     by over the bins count and the put-into wording. `findTemplateSnapByName` now comes
     in with the closure and reads `emailTemplates` out of the FAKE database, seeded above
     from the real one, so the matching under test is the matching that ships.
     ⚠ `__record` only WATCHES: it notes which name was asked for and hands straight to
     the real function. An observer is not a second opinion. */
  const sandbox = LIFTED.map(lift).join('\n\n') + `
const __realFind = findTemplateSnapByName;
findTemplateSnapByName = async function(n){ const r = await __realFind(n); __asked.push({ name: n, found: !(r && r.empty) }); return r; };
function templateSubjectOr(t, f){ return (t && t.subject) || f; }
async function ensureToken(id, d){ return 'DRYRUN-TOKEN'; }
${CONSTS.map(decl).join('\n')}
return runInvoiceBatch('dry-run');
`;
  const quiet = { log: () => {}, error: () => {}, warn: () => {} };
  const fn = new Function('db', 'admin', 'fetch', 'console', '__asked', sandbox);
  const res = await fn(fake, adminStub, fakeFetch, quiet, asked);

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
  /* ⛔ ASKED FOR IS NOT FOUND, AND THAT GAP IS THE WHOLE POINT OF PRINTING BOTH. The run
     falls back to a built-in body rather than stopping a bill — right, and it means a
     renamed template sends wording nobody wrote in a run nobody is watching. The first
     real read of this said "Template missing" ten times over 24 live bills. QT-42's shape:
     a template found on the screen and not by the thing that sends.
     ⚠ TEMPLATE NAMES ARE OUR OWN SETTINGS, NOT ANYBODY'S DETAILS, so they may be printed
     where a customer's name may not — and they have to be, or "missing" leaves nothing to
     act on. PROC-36 is about people. */
  const wanted = [];
  asked.forEach(a => { if (!wanted.some(w => w.name === a.name)) wanted.push(a); });
  if (!wanted.length) say('   template asked for: (none)');
  wanted.forEach(w => say('   template asked for: ' + w.name +
    (w.found ? '   ✓ on file' : '   ⛔ NOT ON FILE — the built-in wording went out instead')));
  /* ⚠ TWO TEMPLATES UNDER ONE NAME, AND THE LOOKUP TAKES WHICHEVER COMES BACK FIRST.
     Every sender in this app finds a template BY NAME, so a duplicate means the wording
     a customer gets is decided by Firestore's document order — and editing "the" template
     can leave the other copy, with the old wording, as the one that sends. Counted on the
     exact stored name, which needs no flattener and so is no second opinion about matching. */
  const byName = {};
  templates.forEach(t => {
    const n = String(t && t.name || '(unnamed)').trim();
    byName[n] = (byName[n] || 0) + 1;
  });
  const twice = Object.keys(byName).filter(n => byName[n] > 1);
  if (twice.length) {
    say('');
    say('   ⚠ TWO TEMPLATES SHARE ONE NAME, so which wording sends is whichever comes');
    say('     back first — and editing one leaves the other able to send the old words:');
    twice.sort().forEach(n => say('        · ' + n + '  ×' + byName[n]));
  }
  if (wanted.some(w => !w.found)) {
    say('');
    say('   ⛔ THE WORDING YOU EDITED IS NOT THE WORDING THIS RUN SENDS.');
    say('      Either rename a template below to the name above, or pick it in');
    say('      Automation → Nightly Invoice (that writes unpaidTemplateName /');
    say('      paidTemplateName on settings/nightlyInvoiceAutomation).');
    say('      The ' + templates.length + ' templates on file are named:');
    templates.map(t => String(t && t.name || '(unnamed)').trim())
      .sort().forEach(n => say('        · ' + n));
  }
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
