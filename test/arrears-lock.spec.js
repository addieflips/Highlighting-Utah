/*
 * Last season, asked for before this one
 *
 * Dax, 2026-09-02: "make sure it forces them to pay for their last year lights
 * before they can do anything and before anything goes into the system", then
 * the shape of it: "it should be a pop up that doesnt go away until they pay in
 * full that comes after the gate code and says pay for last season before we put
 * you on the schedule for this one".
 *
 * ⚠ THESE RUN THE PAGE, because every claim here is about what is on screen and
 * what can still be pressed. A source check cannot tell a tab that is disabled
 * from one that merely looks it, and it cannot tell a dialog that refuses Escape
 * from one that never had a handler because it was never shown.
 *
 * ⚠ AND NOTHING HERE REACHES functions/index.js. These run against a fake
 * Firebase, so the SERVER half of the hold — portalSave refusing the write, which
 * is what makes "before anything goes into the system" true — is green here
 * whatever the server does. That half is arrears-hold.test.js.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, INVOICES } = require('./fixtures');

const CUST = CUSTOMERS.standard;
const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

/* The same builder rsvp-arrears.spec.js uses, and deliberately the same shape:
   a fee-ledger line tagged `arrears` with the year pinned to it, with the
   deposit cleared — the standard invoice carries $200 already paid, which would
   cancel the carried balance and quietly make this the SETTLED case. */
function withArrears(amount, year) {
  const base = JSON.parse(JSON.stringify(INVOICES[CUST.invoiceKey]));
  base.changeFees = (Number(base.changeFees) || 0) + amount;
  base.changeFeeNotes = (base.changeFeeNotes || []).concat([{
    amount: amount, kind: 'arrears', source: 'office', year: String(year),
    reason: 'Unpaid balance carried from the ' + year + ' season'
  }]);
  base.deposit = 0;
  base.credits = 0;
  return { invoices: { [CUST.invoiceKey]: base } };
}

async function open(page, url, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) thrown.push('console: ' + m.text());
  });
  await page.goto(url);
  stub.thrown = thrown;
  return stub;
}

const tabState = page => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.portal-tab-btn').forEach(b => { out[b.dataset.tab] = b.disabled ? 'locked' : 'open'; });
  return out;
});

test.describe('A customer who owes for last season', () => {

  /* ⚠ THE ORDER IS THE RULING. Dax put the pop-up AFTER the gate code, so the
     gate question must be alone on screen first — two dialogs at once and the
     customer answers whichever they happen to see. */
  test('is asked for the gate code first, and only then held', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}&rsvp=yes`, withArrears(315, 2025));

    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();
    await expect(page.locator('#arrearsLockCard')).toBeHidden();

    await page.locator('#rsvpGateCodeYesBtn').click();

    await expect(page.locator('#arrearsLockCard')).toBeVisible();
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⭐ THE FIGURE AND THE REASON, in the words that were asked for. */
  test('is told the amount and why it matters, in one card', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}`, withArrears(315, 2025));

    await expect(page.locator('#arrearsLockCard')).toBeVisible();
    await expect(page.locator('#arrearsLockAmount')).toHaveText('$315.00');
    await expect(page.locator('#arrearsLockBody')).toContainText(/2025 season/);
    await expect(page.locator('#arrearsLockBody')).toContainText(/schedule until it is paid in full/i);
    /* ⚠ AND IT SAYS WHAT IT IS NOT. A figure smaller than the balance above it,
       with no explanation, reads as a second charge for this year — MON-37. */
    await expect(page.locator('#arrearsLockBody')).toContainText(/not a second charge/i);
    await expect(page.locator('#arrearsLockPayBtn')).toContainText('$315.00');

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ THIS IS THE ONE THE ASK TURNS ON: "a pop up that doesnt go away". Every
     other dialog on this page closes on Escape and on a backdrop click, so this
     is a deliberate exception and it has to be proved rather than assumed. */
  test('cannot dismiss it with Escape or by clicking away', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}`, withArrears(315, 2025));
    await expect(page.locator('#arrearsLockCard')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#arrearsLockCard')).toBeVisible();

    await page.locator('#arrearsLockBackdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#arrearsLockCard')).toBeVisible();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⭐ AND PAYING HAS TO BE ONE PRESS AWAY (Dax: "make it easy for them to pay
     for"). The one control on the card is not a dismiss — it lands them on the
     pay buttons. */
  test('the one button on it lands them on the pay buttons', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}`, withArrears(315, 2025));
    await page.locator('#arrearsLockPayBtn').click();

    await expect(page.locator('#payButtonsWrap')).toBeVisible();
    await expect(page.locator('.portal-tab-btn[data-tab="payment"]')).toHaveClass(/active/);
    /* ⚠ AND THE DEMAND DOES NOT VANISH WITH THE CARD. The invoice's own
       last-season block carries the same sentence, so the screen they are left on
       still says why they are on it. */
    await expect(page.locator('#invBreakdown')).toContainText(/can.t book your install/i);

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ "BEFORE THEY CAN DO ANYTHING" — the half of the hold a customer meets. */
  test('cannot open the tabs that make work for us', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}`, withArrears(315, 2025));
    await expect(page.locator('#arrearsLockCard')).toBeVisible();

    expect(await tabState(page)).toEqual({
      payment: 'open', info: 'locked', sides: 'locked', lights: 'locked',
      changes: 'locked', contact: 'open', cancel: 'open'
    });

    stub.assertNoRealCalls();
  });

  /* ⚠ AND THE THREE THAT STAY OPEN ARE NOT AN OVERSIGHT. Contact is the dispute
     route the card itself points at — locking it turns a disagreement about the
     figure into a customer who simply stops answering. Cancel is the way out for
     somebody who is leaving, who must never be told to pay first. */
  test('can still reach the Cancel tab, held or not', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}&rsvp=no`, withArrears(315, 2025));

    await expect(page.locator('#tabPanel-cancel')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.portal-tab-btn[data-tab="cancel"]')).not.toBeDisabled();
    await expect(page.locator('.portal-tab-btn[data-tab="contact"]')).not.toBeDisabled();

    stub.assertNoRealCalls();
  });
});

test.describe('A customer who owes nothing', () => {

  /* ⚠ THE OTHER HALF OF EVERY HOLD, and the one that is expensive to get wrong:
     an ordinary customer must not meet any of this. */
  test('sees no card and no locked tab', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}`);
    await expect(page.locator('#invBreakdown')).toBeVisible();

    await expect(page.locator('#arrearsLockCard')).toBeHidden();
    expect(await tabState(page)).toEqual({
      payment: 'open', info: 'open', sides: 'open', lights: 'open',
      changes: 'open', contact: 'open', cancel: 'open'
    });

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ A CARRIED LINE THEY HAVE ALREADY PAID IS THE SETTLED CASE. The debt is
     still ON the invoice as a fee-ledger note for ever — what decides the hold is
     what is still OUTSTANDING against it, and holding somebody who has paid would
     be the worst version of this feature. */
  test('is not held by a carried balance that has been paid off', async ({ page }) => {
    const settled = withArrears(315, 2025);
    settled.invoices[CUST.invoiceKey].deposit = 315;
    const stub = await open(page, `/index.html#/payment?token=${CUST.token}`, settled);
    await expect(page.locator('#invBreakdown')).toBeVisible();

    await expect(page.locator('#arrearsLockCard')).toBeHidden();
    await expect(page.locator('.portal-tab-btn[data-tab="lights"]')).not.toBeDisabled();

    stub.assertNoRealCalls();
  });
});

/* ============================================================================
 * The Sides tab, which had never once opened
 *
 * Found while building the lock: 'sides' was missing from PORTAL_TAB_NAMES, so
 * activatePortalTab hid all six tabs it DID name and never showed this one —
 * the customer got the tab strip above an empty card. The button, the panel and
 * the handler were each correct on their own, which is exactly why no source
 * check caught it and why this test runs the page.
 * ========================================================================== */
test('The Sides tab opens at all', async ({ page }) => {
  const stub = await open(page, `/index.html#/payment?token=${CUST.token}`);
  await expect(page.locator('#invBreakdown')).toBeVisible();

  await page.locator('.portal-tab-btn[data-tab="sides"]').click();

  await expect(page.locator('#tabPanel-sides')).toBeVisible();
  await expect(page.locator('#tabPanel-payment')).toBeHidden();
  /* And back again — a tab that opens but cannot be left is the same fault. */
  await page.locator('.portal-tab-btn[data-tab="payment"]').click();
  await expect(page.locator('#tabPanel-sides')).toBeHidden();
  await expect(page.locator('#tabPanel-payment')).toBeVisible();

  expect(stub.thrown).toEqual([]);
  stub.assertNoRealCalls();
});
