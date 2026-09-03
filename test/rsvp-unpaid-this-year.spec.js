/*
 * APPROVING WHILE THIS YEAR'S BILL IS UNPAID (added 2026-09-03)
 *
 * Addie, over a Test row reading UNPAID $946.00 / ON HOLD / "Not scheduled — no RSVP
 * yet": "I approved this again through the approval link in email however the badge
 * still says on hold", then "945 is unpaid but can show as yes on the badge since this
 * isn't unpaid from last month its unpaid from this month. or this year."
 *
 * ⚠ THE SEASON BADGE IS NOT THE RSVP PILL, and no spec covered it. rsvp-record.spec.js
 * presses the same buttons but reads the RSVP pill through effectiveRsvpStatus with
 * seasonRuleIsLive STUBBED FALSE — so it says nothing about the badge she is actually
 * looking at, which goes through seasonBadgeKey -> isOutForSeason -> the confirmed-only
 * rule. That rule is live, and it needs a DATED yes: rsvpStatus 'yes' with no
 * rsvpRespondedAt reads exactly like her screenshot.
 *
 * ⚠ AND THE VARIABLE HER RECORD HAS THAT EVERY PASSING SPEC LACKS IS AN UNPAID BILL.
 * The portal's hold is keyed on arrearsOutstanding — LAST season's debt — so a current
 * bill must not touch the RSVP at all. This drives that case end to end: press the
 * emailed Yes, read the record back, and run the office's own badge rule on it.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const TOKEN = CUSTOMERS.standard.token;

/* The office's badge rule, lifted whole rather than restated — a copy here would agree
   with itself and prove nothing about the row on her screen. seasonRuleIsLive is the
   REAL one, not stubbed: stubbing it false is exactly what let the existing spec pass
   while the badge she is looking at said something else. */
function officeBadge(record) {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const braced = (name) => {
    const at = admin.search(new RegExp('(?:async )?function ' + name + '\\('));
    if (at === -1) throw new Error('admin.html has no ' + name + '()');
    let i = admin.indexOf('{', at), depth = 0, q = '', com = '';
    for (; i < admin.length; i++) {
      const c = admin[i], prev = admin[i - 1], next = admin[i + 1];
      if (com) {
        if (com === '*' && c === '*' && next === '/') { com = ''; i++; }
        else if (com === '/' && c === '\n') com = '';
        continue;
      }
      if (!q && c === '/' && next === '*') { com = '*'; i++; continue; }
      if (!q && c === '/' && next === '/') { com = '/'; i++; continue; }
      if (q) { if (c === q && prev !== '\\') q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) return admin.slice(at, i + 1) + '\n'; }
    }
    throw new Error('could not lift ' + name + '() whole');
  };
  return new Function('enrollmentYearOf', 'houseArrearsOutstanding', 'allCustInvoiceFor',
    'let seasonRuleOffForMeasurement = false;\n' +
    braced('seasonRuleIsLive') + braced('audienceQuoteJoinYear') + braced('audienceNeverAsked') +
    braced('effectiveRsvpStatus') + braced('houseOwesFromLastSeason') +
    braced('isOutForSeason') + braced('seasonBadgeKey') +
    'return {badge: seasonBadgeKey, live: seasonRuleIsLive};'
  )(() => null, () => 0, () => null);
}

test.describe('Approving while this year’s bill is unpaid', () => {

  test('the confirmed-only rule really is live, so this test means something', async () => {
    /* ⚠ WITHOUT THIS THE WHOLE FILE IS VACUOUS. If the rule is switched off, every
       record reads confirmed and the checks below pass whatever the code does. */
    expect(officeBadge().live()).toBe(true);
  });

  test('a dated yes reads Confirmed; an undated one reads On hold', async () => {
    const api = officeBadge();
    expect(api.badge({ rsvpStatus: 'yes', rsvpRespondedAt: '2026-09-03T10:00:00Z' })).toBe('confirmed');
    /* This is her screenshot: the answer is on the record and the badge still holds,
       because nothing dated it. */
    expect(api.badge({ rsvpStatus: 'yes' })).toBe('pending');
  });

  test('pressing the emailed Yes dates the reply, even with a bill outstanding',
    async ({ page }) => {
      const c = JSON.parse(JSON.stringify(CUSTOMERS.standard));
      /* Her case: money owed for THIS season, and nothing carried from last one. The
         portal's hold reads arrearsOutstanding, so a current bill must not reach it. */
      c.record.arrearsOutstanding = 0;
      const stub = await installFirebaseStub(page, { customers: { standard: c } });
      await page.goto(`/index.html#/payment?token=${c.token}&rsvp=yes`);

      await expect.poll(async () => {
        const calls = await stub.calls();
        return calls.some(x => x.name === 'portalRsvp');
      }, { timeout: 8000 }).toBe(true);

      const record = await page.evaluate((tok) => {
        const f = window.__HU_FIXTURES__.byToken(tok);
        return f ? JSON.parse(JSON.stringify(f.record)) : null;
      }, c.token);

      expect(record.rsvpStatus).toBe('yes');
      expect(record.rsvpRespondedAt,
        'an undated yes is exactly the ON HOLD row she reported').toBeTruthy();
      expect(officeBadge().badge(record),
        'the season badge is what she reads, not the RSVP pill').toBe('confirmed');

      stub.assertNoRealCalls();
    });
});
