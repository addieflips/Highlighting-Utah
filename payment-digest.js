#!/usr/bin/env node
/* ============================================================================
 * WHY ARE CARD PAYMENTS NOT COMING IN? — read-only, names nobody (2026-10-14).
 * Addie: "No payments after 8:19 Am even though invoices got sent which is not normal",
 * after SuAnne wrote that the portal would not take her card.
 *
 * Reads two things and writes NOTHING:
 *   1. Cloud Logging for the PayPal functions — how many calls, which failed, and the
 *      error text with every digit run and email address scrubbed out.
 *   2. The invoices — when payments were last recorded, by hour, no names.
 * ========================================================================== */
'use strict';
const { execFileSync } = require('child_process');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'highlighting-utah' });

const HOURS = Number(process.env.HOURS || 72);
const since = new Date(Date.now() - HOURS * 3600e3).toISOString();
const scrub = s => String(s || '').replace(/[^\s@]+@[^\s@]+/g, '<email>').replace(/\d{4,}/g, '#').slice(0, 400);
const mt = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function logs(filter, limit) {
  const out = execFileSync('gcloud', ['logging', 'read', filter, '--project=highlighting-utah',
    '--limit=' + limit, '--format=json', '--order=desc'], { maxBuffer: 64 * 1024 * 1024 }).toString();
  return JSON.parse(out || '[]');
}

(async () => {
  console.log('\n=== PayPal, last ' + HOURS + ' hours (Mountain time), naming nobody ===\n');
  const svc = ['paypalcreateorder', 'paypalcaptureorder', 'paypalwebhook', 'portalinvoice', 'portallookup', 'publicconfig'];
  const base = 'resource.type="cloud_run_revision" AND timestamp>="' + since + '" AND resource.labels.service_name=(' +
    svc.map(s => '"' + s + '"').join(' OR ') + ')';

  /* 1. Requests: one line per call, with its HTTP status. */
  const reqs = logs(base + ' AND log_id("run.googleapis.com/requests")', 3000);
  const by = {};
  reqs.forEach(e => {
    const s = e.resource.labels.service_name, st = (e.httpRequest && e.httpRequest.status) || 0;
    by[s] = by[s] || { total: 0, ok: 0, bad: 0, statuses: {}, last: '', lastOk: '' };
    const b = by[s]; b.total++; b.statuses[st] = (b.statuses[st] || 0) + 1;
    if (st >= 200 && st < 300) { b.ok++; if (!b.lastOk) b.lastOk = e.timestamp; } else b.bad++;
    if (!b.last) b.last = e.timestamp;
  });
  svc.forEach(s => {
    const b = by[s];
    if (!b) { console.log(s.padEnd(20) + ' no calls at all'); return; }
    console.log(s.padEnd(20) + ' calls ' + b.total + ', ok ' + b.ok + ', failed ' + b.bad +
      '  statuses ' + JSON.stringify(b.statuses) + '  last call ' + mt(b.last) + (b.lastOk ? ', last OK ' + mt(b.lastOk) : ''));
  });

  /* 1b. Every real (non-preflight) create and capture, in time order — times only. An order
     created and never captured is somebody who reached PayPal and did not get through it. */
  console.log('\n--- each PayPal step, oldest first (OPTIONS preflights left out) ---');
  reqs.filter(e => /paypal(create|capture)order/.test(e.resource.labels.service_name) &&
    e.httpRequest && e.httpRequest.requestMethod === 'POST')
    .sort((a, b) => a.timestamp < b.timestamp ? -1 : 1)
    .forEach(e => console.log('   ' + mt(e.timestamp).padEnd(22) + (e.resource.labels.service_name === 'paypalcreateorder' ? 'order created ' : 'PAYMENT TAKEN ') +
      ' status ' + e.httpRequest.status + '  ' + (e.httpRequest.latency || '')));

  /* 2. Errors written by the functions themselves, newest first, scrubbed. */
  console.log('\n--- error lines from the PayPal functions (newest first) ---');
  const errs = logs(base + ' AND severity>=WARNING AND NOT log_id("run.googleapis.com/requests")', 60);
  if (!errs.length) console.log('   none');
  errs.forEach(e => {
    const txt = e.textPayload || (e.jsonPayload && (e.jsonPayload.message || JSON.stringify(e.jsonPayload))) || '';
    console.log('   ' + mt(e.timestamp) + '  ' + e.resource.labels.service_name + '  ' + e.severity + '  ' + scrub(txt));
  });

  /* 3. When money last landed, from the invoices themselves. */
  console.log('\n--- payments recorded on invoices, by day (Mountain) ---');
  const snap = await admin.firestore().collection('invoices').get();
  const days = {}; let paypal = 0, other = 0, lastPay = 0;
  snap.forEach(d => {
    const v = d.data() || {}, t = v.lastPaymentAt && v.lastPaymentAt.toDate ? v.lastPaymentAt.toDate() : null;
    if (!t || t.getTime() < Date.now() - HOURS * 3600e3) return;
    const k = t.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' }) + ' ' + (v.lastPaymentMethod || 'unrecorded');
    days[k] = (days[k] || 0) + 1;
    if (v.lastPaymentMethod === 'paypal') paypal++; else other++;
    if (t.getTime() > lastPay) lastPay = t.getTime();
  });
  Object.keys(days).sort().forEach(k => console.log('   ' + k.padEnd(28) + days[k]));
  console.log('   newest payment: ' + (lastPay ? mt(new Date(lastPay).toISOString()) : 'none in window') + '   (paypal ' + paypal + ', other ' + other + ')');

  /* 4. The portal's own payment settings — provider and whether a client id is set. */
  const pc = await admin.firestore().collection('siteContent').doc('main').get();
  const p = pc.exists ? pc.data() : {};
  const id = String(p.paypalClientId || '');
  console.log('\n--- siteContent/main (what the portal reads) ---\n   paymentProvider: ' + (p.paymentProvider || '(unset — portal falls back to venmo)') +
    ', paypalClientId set: ' + !!id + ' (' + id.length + ' chars, starts ' + id.slice(0, 2) + ')');
})().catch(e => { console.error('payment-digest failed: ' + (e && e.message)); process.exit(1); });
