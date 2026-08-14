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

    /* ⚠ EXPECTED TO FAIL — this is checklist test 17, a KNOWN BUG: "Pending-quote
     * approve/decline view does not show." Searching index.html finds no
     * portal-side quote review at all; the approve/decline flow only exists on
     * the emailed link. This spec stays red until that view is built. Do NOT
     * weaken it to make the suite green (CLAUDE.md §9.6). */
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