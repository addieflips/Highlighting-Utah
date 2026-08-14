/*
 * Member Portal — browser specs
 *
 * These target the five KNOWN FAILURES on the Project To-Do checklist
 * (tests 9, 11, 14, 15, 17). They are expected to go RED on the first run.
 * That is the point: red first, then fix the code until they go green
 * (CLAUDE.md §9.6). Do NOT weaken a spec to make it pass.
 *
 * Each title starts with its checklist id so the automated test and the manual
 * checklist row point at each other instead of drifting apart (§9.1).
 *
 * Everything runs against a fake Firebase (tests/firebase-stub.js). Every test
 * ends by asserting the page never reached a real backend.
 *
 * ROUTE NOTE: the portal lives at  #/payment  and the personalised email link
 * is  #/payment?token=XXXX  — read out of index.html's router, not guessed.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

/* Fresh stub per test. Playwright gives each test its own page, so there is no
 * shared state to leak between them. */
async function open(page, path, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  await page.goto(path);
  return stub;
}

test.describe('Member Portal', () => {

  /* ---- t9 — the personalised link ---------------------------------------
   * KNOWN FAILURE: "Does not open straight to the account."
   * The token in {{portal_link}} emails should sign them in with no typing.
   */
  test('t9 — a personalised link opens straight to the account', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}`);

    // Their name proves the account actually loaded, not just the page.
    await expect(page.getByText(cust.record.name)).toBeVisible();

    // And they must NOT be asked to sign in again.
    await expect(page.locator('#lookupForm')).toBeHidden();

    const calls = await stub.calls();
    expect(calls.some(c => c.name === 'portalLookup' && c.payload.token === cust.token),
      'the page should have looked the customer up by token').toBeTruthy();

    stub.assertNoRealCalls();
  });

  /* ---- t11 — paying by card ---------------------------------------------
   * KNOWN FAILURE: "Only a Venmo link — no PayPal button."
   * index.html reads paymentProvider and falls back to 'venmo'. This runs the
   * page with the setting at 'both', which is the cheap fix worth trying
   * before touching any code — if this goes green with no code change, the
   * bug was only ever a Firestore setting.
   */
  test('t11 — a PayPal button renders when the provider allows cards', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUSTOMERS.standard.token}`, {
      settings: { main: { paymentProvider: 'both', paypalClientId: 'test-client-id-not-a-real-one' } }
    });

    const container = page.locator('#paypal-button-container');
    await expect(container).toBeVisible();
    await expect(container.locator('iframe, button, [role="button"]').first())
      .toBeVisible({ timeout: 10_000 });

    stub.assertNoRealCalls();
  });

  /* ---- t14 — the preferences the office cannot see -----------------------
   * KNOWN FAILURE: "Wire colour / outlet timer / install timing / notes have
   * nowhere to be viewed in admin." The customer-side half is tested here:
   * whatever they change must actually leave the browser as a portalSave.
   * The admin-side half needs its own spec once there is somewhere to look.
   */
  test('t14 — changing a preference sends it to the server', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUSTOMERS.standard.token}`);

    await expect(page.locator('#portalTabsLayout')).toBeVisible();

    const before = (await stub.calls()).length;
    await page.getByRole('button', { name: /save/i }).first().click();

    await expect.poll(async () => (await stub.calls()).length,
      { message: 'clicking Save should have produced a portalSave call' })
      .toBeGreaterThan(before);

    const saves = (await stub.calls()).filter(c => c.name === 'portalSave');
    expect(saves.length, 'a preference change must reach portalSave').toBeGreaterThan(0);

    stub.assertNoRealCalls();
  });

  /* ---- t15 — RSVP -------------------------------------------------------
   * KNOWN FAILURE: "Not behaving as specified."
   * The rule that matters most: ONLY "no" may ever trigger light recycling.
   * "Back next year" is a distinct third answer and must NOT recycle.
   */
  test('t15 — an RSVP link records the answer without asking them to sign in', async ({ page }) => {
    const cust = CUSTOMERS.pendingRsvp;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}&rsvp=yes`);

    await expect(page.locator('#lookupForm')).toBeHidden();

    const rsvpCalls = (await stub.calls()).filter(c => c.name === 'portalRsvp');
    expect(rsvpCalls.length, 'following an RSVP link should record the answer').toBeGreaterThan(0);
    expect(rsvpCalls[0].payload.token).toBe(cust.token);

    stub.assertNoRealCalls();
  });

  /* ---- t17 — a pending quote --------------------------------------------
   * KNOWN FAILURE: "Pending-quote approve/decline view does not show."
   */
  test('t17 — a customer with a pending quote is offered approve or decline', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUSTOMERS.pendingRsvp.token}`, {
      customers: {
        pendingRsvp: {
          ...CUSTOMERS.pendingRsvp,
          record: { ...CUSTOMERS.pendingRsvp.record, quoteDetailQuoteId: 'quote-pending-1' }
        }
      }
    });

    await expect(page.getByRole('button', { name: /approve|accept/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /decline/i })).toBeVisible();

    stub.assertNoRealCalls();
  });

  /* ---- behaviour that already works — these should be GREEN today --------
   * Worth having: they prove the harness itself is sound. If these ever fail
   * alongside the ones above, suspect the stub before suspecting the app.
   */
  test('a wrong last name is refused, and says so', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment');

    await page.fill('#lookupPhone', '8015550142');
    await page.fill('#lookupLastName', 'NotTheRightName');
    await page.click('#lookupBtn');

    await expect(page.locator('#lookupEmpty')).toBeVisible();
    stub.assertNoRealCalls();
  });

  test('a customer who cancelled sees the turned-off message, not their account',
    async ({ page }) => {
      const stub = await open(page,
        `/index.html#/payment?token=${CUSTOMERS.deactivated.token}`);

      await expect(page.locator('#portalDeactivatedMsg')).toBeVisible();
      await expect(page.locator('#portalTabsLayout')).toBeHidden();

      stub.assertNoRealCalls();
    });

  /* ---- the guard itself --------------------------------------------------
   * If the stub ever stops intercepting, every test above would quietly start
   * hitting production. This asserts the block list is live.
   */
  test('the stub blocks real Firebase — the guard is working', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment');

    const reached = await page.evaluate(async () => {
      try {
        await fetch('https://firestore.googleapis.com/v1/projects/highlighting-utah/databases');
        return true;
      } catch (e) { return false; }
    });

    expect(reached, 'a real Firestore call must be blocked, not allowed through').toBeFalsy();
    expect(() => stub.assertNoRealCalls()).toThrow(/REAL backend/);
  });
});
