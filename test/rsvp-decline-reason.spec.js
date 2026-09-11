/*
 * WHY THEY SAID NO — THE OPTIONAL REASON, IN THE REAL PORTAL ([[RS-58]])
 *
 * Addie, 2026-09-11: "okay i need it to be optional choice", then the wording —
 * "Should be Moved, Finances, etc. However Moved should also give option change
 * address which will keep them and confrim them for that year along with send them
 * to requotes" — and "There should also be an option for other and if they put other
 * than a note section will show up that they can put in there reason."
 *
 * ⚠ WHY A BROWSER SPEC AND NOT ONLY THE NODE GATES. run-all.js RUNS the callable and
 * reads what it writes, and address-move.test.js RUNS the move; between them they
 * prove the server. Neither can see a BUTTON. Every claim below is about something
 * appearing, or not appearing, after a tap — and this repo's oldest lesson is that a
 * message in the source is not a message on the screen: the Add Folder input that
 * worked except for the Enter key, the Use-it button destroyed between mousedown and
 * mouseup, the recycle "bin says" box whose listener silently never applied. Every one
 * of those was green in source checks.
 *
 * ⚠ AND ONE OF THEM WAS IN THIS FEATURE. The first draft of the Moved button called a
 * `switchPortalTab` that does not exist, behind a `typeof` guard — so it would have
 * moved nobody to the form and said nothing about it. Only driving the button finds
 * that, which is why the last test here follows it all the way to the address boxes.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

/* ⚠ THE REASONS ARE READ OUT OF THE SHIPPED PAGE, never typed here. They are folder
   names in three files already; a fourth copy in a spec is a fourth thing to keep in
   step, and it would pass while the picker drew something else. */
const REASONS = (function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = /var RSVP_DECLINE_REASONS = \[([\s\S]*?)\];/.exec(src);
  const out = m ? (m[1].match(/'([^']+)'/g) || []).map(x => x.slice(1, -1)) : [];
  if (!out.length) throw new Error('index.html has no RSVP_DECLINE_REASONS to read');
  return out;
})();

async function openDeclined(page, extra) {
  const stub = await installFirebaseStub(page, (extra && extra.overrides) || {});
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  /* ⭐ ARRIVED BY SAYING NO, which is the state the picker exists for and the one a
     customer actually reaches — the RSVP email link lands them here having already
     answered. Driving the real link rather than seeding the record is what proves the
     picker follows the answer instead of some other condition. */
  await page.goto(`/index.html#/payment?token=${CUST.token}&rsvp=${(extra && extra.answer) || 'no'}`);
  stub.thrown = thrown;
  return stub;
}

const reasonBlock = p => p.locator('#portalRsvpReason');
const reasonBtn = (p, r) => p.locator(`#portalRsvpReasonBtns [data-rsvpreason="${r}"]`);

async function record(page) {
  return page.evaluate((tok) => {
    const c = window.__HU_FIXTURES__.byToken(tok);
    return c ? JSON.parse(JSON.stringify(c.record)) : null;
  }, CUST.token);
}

test.describe('The optional reason after a no', () => {

  test('it is offered after the answer is recorded, not before', async ({ page }) => {
    const stub = await openDeclined(page);
    /* ⛔ THE ANSWER FIRST. This is the whole shape of the feature: somebody who closes
       the tab on this screen has still declined. */
    await expect.poll(async () => (await record(page)).rsvpStatus, { timeout: 8000 }).toBe('no');
    await expect(reasonBlock(page)).toBeVisible();
    expect(stub.thrown).toEqual([]);
  });

  test('and it offers exactly the reasons the server will accept', async ({ page }) => {
    await openDeclined(page);
    await expect(reasonBlock(page)).toBeVisible();
    const shown = await page.locator('#portalRsvpReasonBtns [data-rsvpreason]')
      .evaluateAll(els => els.map(e => e.dataset.rsvpreason));
    expect(shown).toEqual(REASONS);
  });

  /* ⚠ NOT OFFERED TO SOMEBODY WHO SAID YES. The picker keying off the wrong condition
     would ask a confirmed customer why they are not having lights. */
  test('somebody who said yes is never asked why', async ({ page }) => {
    const stub = await openDeclined(page, { answer: 'yes' });
    await expect.poll(async () => (await record(page)).rsvpStatus, { timeout: 8000 }).toBe('yes');
    await expect(reasonBlock(page)).toBeHidden();
    expect(stub.thrown).toEqual([]);
  });

  test('one tap sends it, with no second button to press', async ({ page }) => {
    const stub = await openDeclined(page);
    await reasonBtn(page, 'Finances').click();
    await expect(page.locator('#portalRsvpReasonStatus')).toContainText(/thank you/i);
    const r = await record(page);
    expect(r.rsvpDeclineReason).toBe('Finances');
    /* ⛔ AND THE ANSWER IS UNTOUCHED BY IT. */
    expect(r.rsvpStatus).toBe('no');
    expect(stub.thrown).toEqual([]);
  });

  /* ⚠ AND IT IS NOT ASKED AGAIN ON A LATER VISIT. Re-asking reads as the first answer
     not having saved, which is the complaint half this portal's history is about.
     ⚠ A RELOAD CANNOT TEST THIS and the first version of it tried: the stub re-seeds its
     fixtures through addInitScript on every page load, so a reload wipes the reason that
     was just written and the picker correctly reappears. A customer who ALREADY has one
     on file is the real second visit. */
  test('and somebody who has already said why is not asked again', async ({ page }) => {
    const already = JSON.parse(JSON.stringify(CUSTOMERS));
    already.standard.record.rsvpDeclineReason = 'Finances';
    const stub = await openDeclined(page, { overrides: { customers: already } });
    await expect.poll(async () => (await record(page)).rsvpStatus, { timeout: 8000 }).toBe('no');
    await expect(reasonBlock(page)).toBeHidden();
    expect(stub.thrown).toEqual([]);
  });

  /* ⭐ OTHER OPENS A BOX AND SENDS NOTHING YET. Addie: "if they put other than a note
     section will show up that they can put in there reason." */
  test('Other opens a note and sends nothing until it is written', async ({ page }) => {
    const stub = await openDeclined(page);
    await expect(reasonBlock(page)).toBeVisible();
    await expect(page.locator('#portalRsvpReasonNote')).toBeHidden();
    await reasonBtn(page, 'Other').click();
    await expect(page.locator('#portalRsvpReasonNote')).toBeVisible();
    /* ⛔ NOTHING SENT. Sending on the tap would file "Other" with no words behind it,
       which is the one reason that says nothing at all on its own. */
    const calls = (await stub.calls()).filter(c => c.name === 'portalRsvp' && c.payload.declineReason);
    expect(calls.length).toBe(0);
    expect(stub.thrown).toEqual([]);
  });

  test('and their own words are sent with it', async ({ page }) => {
    await openDeclined(page);
    await reasonBtn(page, 'Other').click();
    await page.locator('#portalRsvpReasonText').fill('Selling the house in November');
    await page.locator('#portalRsvpReasonSend').click();
    await expect(page.locator('#portalRsvpReasonStatus')).toContainText(/thank you/i);
    const r = await record(page);
    expect(r.rsvpDeclineReason).toBe('Other');
    expect(r.rsvpDeclineNote).toBe('Selling the house in November');
  });

  /* ⭐ MOVED IS THE ONE ANSWER THAT CAN UNDO ITSELF. Addie: "Moved should also give
     option change address which will keep them and confrim them for that year along
     with send them to requotes." */
  test('Moved offers the way back, and only after the reason is recorded', async ({ page }) => {
    const stub = await openDeclined(page);
    await expect(page.locator('#portalRsvpMoved')).toBeHidden();
    await reasonBtn(page, 'Moved').click();
    await expect(page.locator('#portalRsvpMoved')).toBeVisible();
    expect((await record(page)).rsvpDeclineReason).toBe('Moved');
    expect(stub.thrown).toEqual([]);
  });

  /* ⚠ NO OTHER REASON OFFERS IT. Finances is still a no. */
  test('and no other reason offers it', async ({ page }) => {
    await openDeclined(page);
    await reasonBtn(page, 'Finances').click();
    await expect(page.locator('#portalRsvpReasonStatus')).toContainText(/thank you/i);
    await expect(page.locator('#portalRsvpMoved')).toBeHidden();
  });

  /* ⛔ THE ONE THAT ONLY A BROWSER CAN ANSWER. The first draft called a function that
     does not exist, behind a `typeof` guard — the button would have done nothing at
     all and said nothing about it. This follows it to the boxes. */
  test('the button really reaches the address form', async ({ page }) => {
    const stub = await openDeclined(page);
    await reasonBtn(page, 'Moved').click();
    await expect(page.locator('#portalRsvpMoved')).toBeVisible();
    await page.locator('#portalRsvpMovedBtn').click();
    await expect(page.locator('#infoMovedForm')).toBeVisible();
    await expect(page.locator('#movedStreet')).toBeVisible();
    expect(stub.thrown).toEqual([]);
  });

  /* ⭐ AND THE MOVE SENT FROM THERE ASKS TO BE PUT BACK IN. The server decides — the
     browser only says where the request came from — so what is asserted here is the
     flag reaching the call, with address-move.test.js holding what it then does. */
  test('and the move it sends is marked as coming from the decline', async ({ page }) => {
    const stub = await openDeclined(page);
    await reasonBtn(page, 'Moved').click();
    await page.locator('#portalRsvpMovedBtn').click();
    await page.locator('#movedStreet').fill('9 Oak St');
    await page.locator('#movedCity').fill('Springville');
    await page.locator('#movedSaveBtn').click();
    await expect.poll(async () => {
      const calls = await stub.calls();
      return calls.some(c => c.name === 'portalChangeAddress' && c.payload.fromDecline === true);
    }, { timeout: 8000 }).toBe(true);
  });

  /* ⚠ THE FLAG BEING SPENT IS NOT ASSERTED HERE, deliberately, and this note is the
     record of why rather than a gap. A second move cannot be driven through this page:
     the move offer FOLDS ITSELF AWAY once one has been sent (address-move.spec.js asserts
     that, and it is what stops a customer submitting twice), so `#infoMovedLink` is gone
     and there is nothing left to click. The claim — that `portalMoveConfirmsSeason` is
     read once and cleared in the same breath, so no later ordinary move carries it — is
     about a module variable rather than about the screen, and it is asserted in run-all.js
     Suite 323 where that kind of claim belongs. */
});
