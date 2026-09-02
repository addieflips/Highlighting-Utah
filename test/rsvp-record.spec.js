/*
 * What the customer record LOOKS LIKE after a button is pressed
 *
 * Addie, 2026-09-02: "it says pending for RSVP. However the last button I pushed
 * was no. I didn't put a note or push cancel or anything but should automatically
 * be no and put in recycle."
 *
 * ⭐ THE GAP THIS CLOSES. Every RSVP spec in this suite asserts the CALL — that the
 * page sent `response: 'no'`. Not one asserted the RESULT, because the stub's
 * portalRsvp never wrote anything: it looked the customer up and returned. So the
 * half of the flow that actually matters to the office — what the record becomes —
 * had no coverage at all, on any answer.
 *
 * ⚠ THE STUB NOW WRITES THE SAME FIELDS THE SERVER WRITES, in the same combinations.
 * A no and a back next year are NOT symmetric: only a no queues the recycle, only a
 * back next year raises maybeNextYear, and a fake that blurred that would hide the one
 * difference between the two answers.
 *
 * ⚠ AND IT ENDS ON THE OFFICE'S OWN BADGE RULE, lifted out of admin.html and run over
 * whatever the record became. That is the whole round trip in one assertion — press a
 * button, and read the words the office will read — which is the form her report took
 * and the form nothing here could answer.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const TOKEN = CUSTOMERS.standard.token;

/* The office's card rule, lifted rather than restated — a second copy here would
   agree with itself and prove nothing about the screen she is looking at. */
function officeRsvpLabel(record) {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const braced = (name) => {
    const at = admin.indexOf('function ' + name + '(');
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
  return new Function('audienceNeverAsked', 'seasonRuleIsLive',
    braced('effectiveRsvpStatus') + braced('rsvpStatusLabel') +
    'return function(r){ return rsvpStatusLabel(effectiveRsvpStatus(r)); };'
  )(function () { return false; }, function () { return false; })(record);
}

async function pressAndRead(page, url) {
  const stub = await installFirebaseStub(page, {});
  await page.goto(url);
  /* Wait on the write itself rather than on a timer: the answer is what is being
     asserted, and a sleep would make this flaky on a slow machine. */
  await expect.poll(async () => {
    const calls = await stub.calls();
    return calls.some(c => c.name === 'portalRsvp');
  }, { timeout: 8000 }).toBe(true);
  const record = await page.evaluate((tok) => {
    const c = window.__HU_FIXTURES__.byToken(tok);
    return c ? JSON.parse(JSON.stringify(c.record)) : null;
  }, TOKEN);
  return { stub, record };
}

test.describe('What a pressed RSVP button leaves on the record', () => {

  /* ⭐ HER REPORT, AS A TEST. No note, no Cancel pressed — the button alone. */
  test('No records the no and queues the recycle, with nothing else pressed', async ({ page }) => {
    const { stub, record } = await pressAndRead(page, `/index.html#/payment?token=${TOKEN}&rsvp=no`);

    expect(record.rsvpStatus).toBe('no');
    expect(record.needsLightRecycle, 'a no must queue their lights to come back').toBe(true);
    expect(record.rsvpRespondedAt, 'a real reply must be dated, or it reads as an assumed answer').toBeTruthy();
    expect(record.maybeNextYear, 'a no is not a back next year').toBe(false);

    stub.assertNoRealCalls();
  });

  test('and the office card then says No, not Pending', async ({ page }) => {
    const { stub, record } = await pressAndRead(page, `/index.html#/payment?token=${TOKEN}&rsvp=no`);
    expect(officeRsvpLabel(record)).toBe('No');
    stub.assertNoRealCalls();
  });

  /* ⚠ THE OPPOSITE ANSWER, because the two are deliberately not symmetric and a
     check on only one of them would not notice them being merged. */
  test('Back Next Year raises the badge and does NOT queue a recycle', async ({ page }) => {
    const { stub, record } = await pressAndRead(page, `/index.html#/?token=${TOKEN}&rsvp=back`);

    expect(record.rsvpStatus).toBe('backnextyear');
    expect(record.maybeNextYear).toBe(true);
    expect(record.needsLightRecycle, 'back next year must never queue a recycle').toBeFalsy();
    expect(officeRsvpLabel(record)).toBe('Back Next Year');

    stub.assertNoRealCalls();
  });

  test('Yes records a dated reply', async ({ page }) => {
    const { stub, record } = await pressAndRead(page, `/index.html#/payment?token=${TOKEN}&rsvp=yes`);

    expect(record.rsvpStatus).toBe('yes');
    expect(record.rsvpRespondedAt, 'without a date this is the assumed yes the office distrusts').toBeTruthy();
    expect(officeRsvpLabel(record)).toBe('Yes');

    stub.assertNoRealCalls();
  });
});
