/*
 * The quote link a customer is actually sent — browser specs
 *
 * Checklist test 19 records: "The approval link works but the accept-my-quote
 * button does not." This file is that failure, pinned down.
 *
 * There are TWO shapes of quote link in admin.html, and only one of them
 * carries an action:
 *
 *   #/quote-details?token=XXX&action=approve   the coloured buttons INSIDE the
 *                                              email body, and the link printed
 *                                              on the quote card
 *   #/quote-details?token=XXX                  the "View Your Quote" button the
 *                                              EmailJS wrapper puts on every
 *                                              quote and nudge email, and the
 *                                              {{link}} in both SMS templates
 *
 * index.html's router only calls handleQuoteLink() when the action is one of
 * approve / decline / maybe_next_year. With no action it does nothing at all,
 * so the second link lands the customer on the install-details form — headed
 * "Thanks for approving!", which they never did — with no way to approve, and
 * no quoteDetailToken set, so the form cannot even be submitted.
 *
 * That is the majority of the links customers receive. Everything runs against
 * the fake Firebase; every spec ends by asserting no real backend was reached.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { QUOTES } = require('./fixtures');

const TOKEN = QUOTES.pendingReview.data.quoteToken;

/* SCRIPT errors only. The stub deliberately aborts every request to a real
   Google, Firebase or PayPal host, and the browser logs each abort as a console
   error — so asserting "no console errors at all" fails on the guard doing its
   job. A thrown TypeError still arrives through 'pageerror' and is still
   caught: that is what turned up the hoisting bug this fix was written against.
   Any console error that is not a blocked resource is kept too. */
const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

async function openQuoteLink(page, query) {
  const stub = await installFirebaseStub(page);
  const scriptErrors = [];
  page.on('pageerror', e => scriptErrors.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) {
      scriptErrors.push('console: ' + m.text());
    }
  });
  await page.goto('/index.html#/quote-details?' + query);
  stub.scriptErrors = scriptErrors;
  return stub;
}

test.describe('The quote link', () => {

  /* ---- t19 — the link with no action ------------------------------------
   * This is the "View Your Quote" button on every quote and nudge email, and
   * the link in both text-message templates. */
  test('t19 — a link with no action still lets the customer approve', async ({ page }) => {
    const stub = await openQuoteLink(page, 'token=' + TOKEN);

    /* Something must offer the three answers. Matched on the customer-facing
       wording, because that is what the person is looking for on the page. */
    const onPage = page.locator('#page-quote-details');
    await expect(onPage.getByRole('button', { name: /approve/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(onPage.getByRole('button', { name: /maybe next year/i }).first()).toBeVisible();
    await expect(onPage.getByRole('button', { name: /not right now|decline/i }).first()).toBeVisible();

    expect(stub.scriptErrors).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* Pressing it must actually record the approval, not just look like it. */
  test('t19 — approving from that link records the approval', async ({ page }) => {
    const stub = await openQuoteLink(page, 'token=' + TOKEN);

    await page.locator('#page-quote-details')
      .getByRole('button', { name: /approve/i }).first().click();

    await expect.poll(async () => {
      const calls = await stub.calls();
      return calls.some(c => c.name === 'quoteRespond' &&
        c.payload.action === 'approve' && c.payload.quoteToken === TOKEN);
    }, { timeout: 5000 }).toBe(true);

    await stub.assertNoRealCalls();
  });

  /* The link WITH an action is the half that already worked. It is here so a
     fix to the above cannot quietly break it. */
  test('t19 — the emailed approve button still goes straight through', async ({ page }) => {
    const stub = await openQuoteLink(page, 'token=' + TOKEN + '&action=approve');

    await expect.poll(async () => {
      const calls = await stub.calls();
      return calls.some(c => c.name === 'quoteRespond' && c.payload.action === 'approve');
    }, { timeout: 5000 }).toBe(true);

    await stub.assertNoRealCalls();
  });
});
