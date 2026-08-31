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
  /* ---- a link that no longer matches a quote -----------------------------
   * Addie, 2026-08-31, sent a screenshot of "Something went wrong" from a real
   * approve link and asked why the form would not come up.
   *
   * ⚠ THE SERVER REPORTS A MISS BY THROWING. quoteRespond does
   * `throw new HttpsError('not-found')`, which REJECTS the callable — so the
   * "we couldn't find your quote" branch behind `if(!res || !res.ok)` was
   * unreachable, and an out-of-date link read as the site being broken.
   *
   * ⚠ THIS ONLY TESTS ANYTHING BECAUSE THE STUB THROWS TOO. It used to resolve
   * {ok:false}, which is gentler than production — so the specs exercised a
   * path real customers never reach. Making the stub faithful is half of this
   * fix; without it, every check below passes on the broken code. */
  test('a link whose quote no longer exists says so, not "something went wrong"', async ({ page }) => {
    const stub = await openQuoteLink(page, 'token=qt_nolongeraquote&action=approve');

    const msg = page.locator('#quoteLinkConfirmMsg');
    await expect(msg).toBeVisible({ timeout: 5000 });
    /* What she must NOT see: the generic failure, which sends her hunting for
       an outage that is not happening. */
    await expect(msg).not.toHaveText(/something went wrong/i);
    /* What she should see: that the LINK is the problem, and what to do. */
    await expect(msg).toHaveText(/couldn.t find your quote/i);
    await expect(msg).toHaveText(/out of date/i);

    /* And the form must be hidden — an install-details form over a quote that
       does not exist cannot be submitted, which is the dead end this whole
       screen exists to avoid. */
    await expect(page.locator('#quoteDetailFormWrap')).toBeHidden();

    await stub.assertNoRealCalls();
  });

  /* ⚠ A REAL OUTAGE MUST STILL SAY SO. The risk of the fix above is the
     opposite error: relabelling every failure as "your link is old" would hide
     a genuine server fault behind a reassuring sentence. Anything that is not
     a not-found keeps the generic wording. */
  test('a genuine server failure still reads as a failure, not a stale link', async ({ page }) => {
    const stub = await openQuoteLink(page, 'token=qt_forceinternal&action=approve');

    const msg = page.locator('#quoteLinkConfirmMsg');
    await expect(msg).toBeVisible({ timeout: 5000 });
    await expect(msg).toHaveText(/something went wrong/i);
    await expect(msg).not.toHaveText(/out of date/i);

    await stub.assertNoRealCalls();
  });
});
