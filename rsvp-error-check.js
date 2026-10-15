#!/usr/bin/env node
/* ============================================================================
 * DID THE RSVP ANSWER SAVE? — read-only (2026-10-14).
 * The Errors folder holds "Answering Yes to the RSVP email — internal" rows from the billing
 * outage (8–12 October) and two older ones. Each is matched to a customer by the last six
 * characters of their link. This says, for each, whether the record now holds an answer and
 * when it was given, so the office knows which rows are settled and which customers to ring.
 * Customer NUMBERS and token tails only — no names, no full tokens. Firestore .get() only.
 * ========================================================================== */
'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'highlighting-utah' });
const day = v => { const t = v && v.toDate ? v.toDate() : (v ? new Date(v) : null);
  return t && !isNaN(t) ? t.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-'; };
(async () => {
  const tails = String(process.env.TAILS || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const cs = await admin.firestore().collection('jobAddresses').get();
  const inv = await admin.firestore().collection('invoices').get();
  const invById = {}; inv.docs.forEach(d => { invById[d.id] = d.data() || {}; });
  const key = d => String(d.billToPhone || '').replace(/\D/g, '') || String(d.phone || '').replace(/\D/g, '') || String(d.email || '').trim().toLowerCase();
  console.log('\n=== RSVP error rows: did the answer reach the record? ===\n');
  tails.forEach(t => {
    const hit = cs.docs.filter(x => String((x.data() || {}).portalToken || '').endsWith(t));
    if (!hit.length) { console.log('  …' + t + '  NO CUSTOMER holds a link ending this way'); return; }
    hit.forEach(x => {
      const d = x.data() || {}, b = invById[key(d)] || {};
      console.log('  …' + t + '  #' + (d.customerNumber || '?') + '  rsvp ' + (d.rsvpStatus || 'NONE') +
        '  answered ' + day(d.rsvpRespondedAt) + (d.rsvpVia ? ' via ' + d.rsvpVia : '') +
        '  last payment ' + day(b.lastPaymentAt) + (b.lastPaymentMethod ? ' (' + b.lastPaymentMethod + ')' : '') +
        '  bill ' + (b.status || '?'));
    });
  });
})().catch(e => { console.error('rsvp-error-check failed: ' + (e && e.message)); process.exit(1); });
