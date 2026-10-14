#!/usr/bin/env node
/* ============================================================================
 * WHY IS THE $25 REFERRAL NOT COMING OFF? — read-only, names nobody (2026-10-14).
 * Addie: "anyone that enrolls someone and then they get converted to costumer should
 * get 25 dollars off referalls. It looks like the discount is not taking affect."
 *
 * Walks every step a referral has to pass, and counts where each one stopped:
 *   1. the friend's quote carries the link's token (referredByToken)
 *   2. the quote was converted to a customer
 *   3. the conversion stamped the quote (referralCredited) — credited OR refused
 *   4. the referrer's record holds an entry for it (referralCredits[])
 *   5. the referrer's BILL carries a "Referral" credit line for it
 * Firestore .get() only. People are shown as "referrer #1", never by name.
 * ========================================================================== */
'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'highlighting-utah' });
const fs = admin.firestore();
const digits = s => String(s || '').replace(/\D/g, '');
const keyOf = d => digits(d.billToPhone) || digits(d.phone) || String(d.email || '').trim().toLowerCase();
const day = v => { const t = v && v.toDate ? v.toDate() : (v ? new Date(v) : null); return t && !isNaN(t) ? t.toISOString().slice(0, 10) : '-'; };

(async () => {
  const [qs, cs, is] = await Promise.all(['quotes', 'jobAddresses', 'invoices'].map(c => fs.collection(c).get()));
  const custs = cs.docs.map(d => ({ id: d.id, d: d.data() || {} }));
  const byToken = {};
  custs.forEach(c => {
    if (c.d.referralToken) byToken[c.d.referralToken] = { c, current: true };
    (Array.isArray(c.d.referralTokensPast) ? c.d.referralTokensPast : []).forEach(p => {
      const t = typeof p === 'string' ? p : (p && p.token);
      if (t && !byToken[t]) byToken[t] = { c, current: false };
    });
  });
  const custById = {}; custs.forEach(c => { custById[c.id] = c; });
  const inv = {}; is.docs.forEach(d => { inv[d.id] = d.data() || {}; });
  const alias = new Map(); const nick = id => { if (!alias.has(id)) alias.set(id, 'referrer #' + (alias.size + 1)); return alias.get(id); };

  console.log('\n=== Referrals, step by step (names left out) ===\n');
  const quotes = qs.docs.map(d => ({ id: d.id, d: d.data() || {} })).filter(q => String(q.d.referredByToken || '').trim());
  console.log('quotes carrying a referral token: ' + quotes.length);
  quotes.sort((a, b) => day(a.d.createdAt) < day(b.d.createdAt) ? -1 : 1).forEach((q, i) => {
    const h = byToken[String(q.d.referredByToken).trim()];
    const conv = q.d.convertedToCustomerId || '';
    const friend = conv && custById[conv];
    let step;
    if (!h) step = 'token matches NO customer';
    else if (!q.d.convertedToCustomerAt && q.d.status !== 'closed') step = 'not converted yet';
    else if (q.d.referralCredited !== true) step = 'CONVERTED BUT NEVER CREDITED OR REFUSED';
    else {
      const ent = (h.c.d.referralCredits || []).find(e => e && conv && e.referredCustomerId === conv);
      const blk = (h.c.d.referralBlocks || []).find(b => b && b.quote === q.id);
      step = ent ? ('credited ' + day(ent.creditedAt) + ' season ' + ent.season + (ent.revoked ? ' REVOKED' : '') + (ent.waived ? ' WAIVED' : ''))
        : blk ? ('refused: ' + String(blk.why || '').replace(/\(.*?\)/g, '').slice(0, 90))
        : 'stamped credited but NO entry on the referrer';
    }
    console.log('  quote ' + String(i + 1).padStart(2) + '  ' + day(q.d.createdAt) + '  ' + (h ? nick(h.c.id) + (h.current ? '' : ' (OLD link)') : '-') +
      '  status ' + (q.d.status || '?') + (conv ? ' → customer' + (friend ? '' : ' (deleted)') : '') +
      '  fee ' + (q.d.chargeSetupFee === false ? 'waived' : q.d.chargeSetupFee === true ? 'CHARGED' : 'unset') + '  ⇒ ' + step);
  });

  console.log('\n--- each referrer: entries on the record vs the line on their bill ---');
  const year = new Date().getFullYear();
  custs.filter(c => (c.d.referralCredits || []).length || Number(c.d.referralCount) > 0).forEach(c => {
    const e = c.d.referralCredits || [];
    const live = e.filter(x => x && !x.revoked && !x.waived);
    const k = keyOf(c.d), b = inv[k];
    const lines = b ? (b.creditNotes || []).filter(n => n && (n.kind === 'referral' || /^Referral/.test(n.reason || ''))) : [];
    const sum = lines.reduce((s, n) => s + (Number(n.amount) || 0), 0);
    console.log('  ' + nick(c.id).padEnd(14) + ' entries ' + e.length + ' (live ' + live.length + ', seasons ' +
      JSON.stringify(live.map(x => x.season)) + ')  referralCount ' + (c.d.referralCount || 0) +
      '  rsvp ' + (c.d.rsvpStatus || '-') + (c.d.billToPhone ? '  billed elsewhere' : '') +
      '  bill: ' + (b ? 'referral lines ' + lines.length + ' = $' + sum + ', credits total $' + (Number(b.credits) || 0) +
        ', status ' + (b.status || '?') + (b.invoiceEmailSent ? ', invoice sent' : '') : 'NO INVOICE FOUND'));
  });
  console.log('\n(this year = ' + year + '; an entry only counts on the bill for the season it is stamped with)');
})().catch(e => { console.error('referral-digest failed: ' + (e && e.message)); process.exit(1); });
