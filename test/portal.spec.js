/*
 * Member Portal — browser specs
 *
 * All 8 specs are GREEN. This file originally targeted five KNOWN FAILURES
 * on the Project To-Do checklist (tests 9, 11, 14, 15, 17) — t15 went green
 * first, and t9/t11/t14/t17 followed once their failures were traced to bugs
 * in THIS TEST HARNESS (a fake portalInvoice shape, a synchronous fake
 * onSnapshot, a missing window.paypal.FUNDING, and a spec that tested the
 * wrong scenario for t17) rather than in index.html itself.
 *
 * Each title starts with its checklist id (t8, t9, t11, t14, t15, t17) so the
 * automated test and the manual checklist row (TEST_SEED in admin.html) point
 * at each other instead of drifting apart (§9.1). Every TEST_SEED row that has
 * a matching spec here has been reworded to say what's automated and what
 * still needs a human pass — check there before re-testing something by hand
 * that this file already proves.
 *
 * Everything runs against a fake Firebase (tests/firebase-stub.js). Every test
 * ends by asserting the page never reached a real backend.
 *
 * ROUTE NOTE: the portal lives at  #/payment  and the personalised email link
 * is  #/payment?token=XXXX  — read out of index.html's router, not guessed.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, QUOTES } = require('./fixtures');

/* Fresh stub per test. Playwright gives each test its own page, so there is no
 * shared state to leak between them. */
async function open(page, path, overrides) {
  const stub = await installFirebaseStub(page, overrides);

  /* Capture anything the page complains about. Without this, a JS error inside
   * index.html shows up only as "element not visible" twenty seconds later,
   * which points at the test rather than the real cause. */
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

  await page.goto(path);
  stub.pageErrors = pageErrors;
  return stub;
}

/* The portal is tab-based: #portalTabsLayout holds panels switched by
 * [data-tab="..."] buttons (payment, info, lights, changes, contact, cancel).
 * Only the open tab's contents are visible, so a test MUST open the tab it
 * cares about — otherwise every field reads empty and every button reports
 * "element is not visible", which looks like a broken selector and is not. */
async function openTab(page, name) {
  await page.locator('#portalTabsLayout').waitFor({ state: 'visible' });
  await page.locator(`[data-tab="${name}"]`).first().click();
}

test.describe('Member Portal', () => {

  /* ---- t9 — the personalised link ---------------------------------------
   * KNOWN FAILURE: "Does not open straight to the account."
   * The token in {{portal_link}} emails should sign them in with no typing.
   */
  test('t9 — a personalised link opens straight to the account', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}`);

    /* Their name proves the account actually loaded, not just the page.
     * It lives in the #infoName INPUT, so it is a value, not page text —
     * getByText() cannot see input values and this originally failed for that
     * reason alone, not because sign-in was broken. */
    await openTab(page, 'info');
    await expect(page.locator('#infoName')).toHaveValue(cust.record.name);

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

    /* The real SDK is never fetched — paypal.com is blocked. tests/firebase-stub
     * serves a test double instead, so the page's OWN setupPaypalButtonsIfNeeded()
     * runs for real and renders through it. What is proved here is that the
     * portal decides to offer PayPal and wires up a button; whether PayPal
     * itself works is not something a test may check (CLAUDE.md §9.11). */
    await openTab(page, 'payment');

    await expect.poll(() => page.evaluate(() => !!window.__HU_PAYPAL_LOADED__),
      { message: 'the portal should have loaded the PayPal SDK when provider allows cards. ' +
                 'paypalAvailable() needs BOTH provider in (paypal|both) AND a non-empty ' +
                 'paypalClientId, read from siteContent/main.' })
      .toBeTruthy();

    /* If it did not load, the page almost certainly threw on the way there.
     * Surface that rather than leaving a bare "expected true, got false". */
    if (!(await page.evaluate(() => !!window.__HU_PAYPAL_LOADED__))) {
      throw new Error('PayPal SDK never loaded. Page errors:\n' +
        (stub.pageErrors.length ? stub.pageErrors.join('\n') : '(none reported)'));
    }

    const container = page.locator('#paypal-button-container');
    await expect(container).toBeVisible();
    await expect(container.getByTestId('paypal-fake-button')).toBeVisible();

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

    /* The portal has three separate save buttons — #infoSaveBtn (contact
     * details), #lightsSaveBtn (colours) and #changesSaveBtn. Target the one
     * this test means. A getByRole('button', {name:/save/i}) match timed out
     * here because it could not settle on one. */
    await openTab(page, 'info');
    const before = (await stub.calls()).length;
    await page.locator('#infoSaveBtn').click();

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
   * Checklist test 17, "Quote review": find someone in Quote Requests who has
   * been priced but is NOT yet a paying customer (no invoice), then sign in
   * to the Member Portal with their phone + last name. Expected: instead of
   * an invoice, the portal shows the quote details, the price, and Approve /
   * Decline buttons.
   *
   * The original version of this spec used CUSTOMERS.pendingRsvp (an
   * existing customer, WITH an invoice) with a token link, and asserted a
   * getByRole button-name match against /decline/i. Neither matched the real
   * app: an existing customer's portalInvoice lookup always succeeds, which
   * unconditionally hides #quoteReviewCard (index.html renderCustomerInvoicePage) —
   * the quote review only ever appears for someone with NO invoice yet, found
   * via tryShowQuoteReview(). And the real Decline button's text is "Not
   * Right Now" (id quoteDeclineBtn), which /decline/i never matched — so this
   * spec could not have passed no matter what the app did. Fixed to use the
   * QUOTES fixture (a quote-only lead, no CUSTOMERS/INVOICES entry) signed in
   * through the lookup form, and to target the real #quoteApproveBtn /
   * #quoteDeclineBtn ids per CLAUDE.md §9.3 (prefer an existing id over a
   * text/role guess).
   */
  test('t17 — a customer with a pending quote is offered approve or decline', async ({ page }) => {
    const quote = QUOTES.pendingReview;
    const stub = await open(page, '/index.html#/payment');

    await page.fill('#lookupPhone', quote.data.phone);
    await page.fill('#lookupLastName', quote.lastNameInput);
    await page.click('#lookupBtn');

    await expect(page.locator('#quoteReviewCard')).toBeVisible();
    /* "$495.00", not "$495". The portal's fmt() shows cents on every amount as
       of 2026-08-14, so it agrees with the invoice email (toFixed(2) on the
       server) and with fmtMoney in admin. Three places showing the same money
       three different ways is how a customer ends up ringing to ask which
       number is real. */
    await expect(page.locator('#quotePriceAmount')).toHaveText('$495.00');
    await expect(page.locator('#quoteAddressDisplay')).toHaveText(quote.data.address);

    await expect(page.locator('#quoteApproveBtn')).toBeVisible();
    await expect(page.locator('#quoteDeclineBtn')).toBeVisible();

    const calls = await stub.calls();
    expect(calls.some(c => c.name === 'publicQuoteLookup'),
      'signing in with only a quote on file should look the quote up').toBeTruthy();

    stub.assertNoRealCalls();
  });

  /* ---- t17, the other half: an EXISTING customer with a quote waiting ----
   * The spec above covers somebody who has ONLY a quote. This covers somebody
   * who is already a customer, already has an invoice, and ALSO has a quote
   * waiting on them — a returning customer being re-quoted for next season.
   *
   * That case was genuinely broken: the quote card only ever rendered when
   * portalInvoice found NOTHING, so anyone who had ever been billed could not
   * see a new quote at all, and the only way to approve one was the emailed
   * link. Delete the email and you had to telephone. index.html now calls
   * offerPendingQuote() once the account has rendered.
   */
  test('t17b — an existing customer is offered a quote that is still waiting', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUSTOMERS.pendingRsvp.token}`);

    // Their account renders as normal — the balance is not replaced by the quote.
    await expect(page.locator('#invAmount')).toBeVisible();
    // ...and the waiting quote is offered underneath it.
    await expect(page.locator('#quoteReviewCard')).toBeVisible();
    await expect(page.locator('#quotePriceAmount')).toHaveText('$640.00');
    await expect(page.locator('#quoteApproveBtn')).toBeVisible();

    stub.assertNoRealCalls();
  });

  /* A quote that has already been answered must NOT be offered again — an
   * Approve button on a settled decision invites a second answer to a question
   * already closed. CUSTOMERS.standard has an APPROVED quote on file. */
  test('an already-approved quote is not offered for approval again', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${CUSTOMERS.standard.token}`);

    await expect(page.locator('#invAmount')).toBeVisible();
    await expect(page.locator('#quoteReviewCard')).toBeHidden();

    stub.assertNoRealCalls();
  });

  /* ---- behaviour that already works — these should be GREEN today --------
   * Worth having: they prove the harness itself is sound. If these ever fail
   * alongside the ones above, suspect the stub before suspecting the app.
   */
  test('t8 — a wrong last name is refused, and says so', async ({ page }) => {
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
