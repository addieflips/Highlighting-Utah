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

  /* Is the friend ALREADY a customer by some other door (added by hand, a second quote)?
     The $25 is only ever given when the quote CARRYING THE TOKEN is converted. */
  function friendOnBook(qd) {
    const ph = digits(qd.phone), em = String(qd.email || '').trim().toLowerCase();
    const hit = custs.filter(c => (ph && digits(c.d.phone) === ph) || (em && String(c.d.email || '').trim().toLowerCase() === em));
    if (!hit.length) return 'friend NOT a customer';
    const c = hit[0];
    return 'FRIEND IS ALREADY A CUSTOMER (added ' + day(c.d.createdAt) + (c.d.referredByCustomerId ? ', linked' : ', not linked to referrer') + ')';
  }
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
      (!conv && h ? '  ' + friendOnBook(q.d) : '') +
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
  custs.filter(c => (c.d.referralCredits || []).length).forEach(c => {
    console.log('  ' + nick(c.id) + ' entries: ' + (c.d.referralCredits || []).map(e =>
      '[' + day(e.creditedAt) + ' season ' + e.season + (e.revoked ? ' revoked ' + day(e.revokedAt) : '') + (e.waived ? ' waived' : '') +
      (custById[e.referredCustomerId] ? '' : ' friend-record-gone') + ']').join(' '));
  });
  console.log('\n--- referred friends who are customers: were they charged the $30 set-up fee? ---');
  custs.filter(c => c.d.referredByCustomerId).forEach(c => {
    const b = inv[keyOf(c.d)];
    console.log('  customer #' + (c.d.customerNumber || '?') + ' (referred by ' + nick(c.d.referredByCustomerId) + ')' +
      '  fee box ' + (c.d.chargeNewMemberFee === true ? 'TICKED' : 'off') +
      '  bill: ' + (b ? 'fee applied ' + (b.newMemberFeeApplied === true ? 'YES' : 'no') + ', install $' + (Number(b.install) || 0) +
        ', paid $' + (Number(b.deposit) || 0) + ', status ' + (b.status || '?') + (b.invoiceEmailSent ? ', invoice sent' : '') : 'no invoice'));
  });
  /* ONE CUSTOMER, ON REQUEST. LOOKUP is part of a name the office typed into the dispatch; the
     customer it matches is shown by customer number and the friends by initials only. */
  const look = String(process.env.LOOKUP || '').trim().toLowerCase();
  if (look) {
    const ini = n => String(n || '').trim().split(/\s+/).map(w => w[0] || '').join('').toUpperCase() || '?';
    const words = look.split(/\s+/).filter(Boolean);
    const hits = custs.filter(c => words.every(w => String(c.d.name || '').toLowerCase().includes(w)));
    console.log('\n=== Lookup: ' + hits.length + ' customer(s) matched ===');
    hits.forEach(c => {
      const d = c.d, b = inv[keyOf(d)];
      const toks = [d.referralToken].concat((d.referralTokensPast || []).map(p => typeof p === 'string' ? p : p && p.token)).filter(Boolean);
      console.log('\n customer #' + (d.customerNumber || '?') + '  rsvp ' + (d.rsvpStatus || '-') + '  referral link ' + (d.referralToken ? 'yes' : 'NONE') +
        '  referralCount ' + (d.referralCount || 0) + (d.billToPhone ? '  billed to another payer' : ''));
      (d.referralCredits || []).forEach(e => console.log('   credited: ' + ini(e.referredName) + ' on ' + day(e.creditedAt) + ' season ' + e.season +
        (e.revoked ? ' REVOKED' : '') + (e.waived ? ' CROSSED OFF' : '')));
      (d.referralBlocks || []).forEach(x => console.log('   refused: ' + ini(x.referredName) + ' on ' + day(x.at) + ' — ' + String(x.why || '').replace(/\(.*?\)/g, '')));
      qs.docs.forEach(q => {
        const qd = q.data() || {};
        if (toks.indexOf(String(qd.referredByToken || '').trim()) === -1) return;
        console.log('   quote via her link: ' + ini(qd.name) + ' on ' + day(qd.createdAt) + '  status ' + (qd.status || '?') +
          (qd.convertedToCustomerAt ? ' CONVERTED ' + day(qd.convertedToCustomerAt) : ' not converted') + (qd.quoteArchived ? ' ARCHIVED' : '') +
          (qd.referralCredited ? ' (credit step ran)' : ''));
      });
      /* A friend who did not use the link may have typed her name instead. */
      const sur = String(d.name || '').trim().split(/\s+/).pop().toLowerCase();
      if (sur.length >= 4) qs.docs.forEach(q => {
        const qd = q.data() || {};
        if (toks.indexOf(String(qd.referredByToken || '').trim()) !== -1) return;
        const f = Object.keys(qd).find(k => k !== 'name' && typeof qd[k] === 'string' && qd[k].toLowerCase().includes(sur));
        if (f && String(qd.name || '').toLowerCase().indexOf(sur) === -1) console.log('   quote NAMING her (no link): ' + ini(qd.name) + ' on ' + day(qd.createdAt) +
          '  in field "' + f + '"  status ' + (qd.status || '?') + (qd.convertedToCustomerAt ? ' CONVERTED' : ''));
      });
      custs.forEach(o => { if (o.d.referredByCustomerId === c.id) console.log('   customer linked as referred by her: #' + (o.d.customerNumber || '?') + ' ' + ini(o.d.name)); });
      if (b) console.log('   her bill: credit lines ' + JSON.stringify((b.creditNotes || []).map(n => (n.kind || 'other') + ' $' + n.amount)) + ', status ' + (b.status || '?'));
    });
  }
  console.log('\n(this year = ' + year + '; an entry only counts on the bill for the season it is stamped with)');
})().catch(e => { console.error('referral-digest failed: ' + (e && e.message)); process.exit(1); });
