/*
 * Email links opened by a customer whose browser REMEMBERS a portal login
 *
 * ⭐ WHY THIS FILE EXISTS. Every other spec in this folder opens its link in a
 * browser with empty storage. Real customers are not in that state, and
 * neither is the office when it tests: index.html REMEMBERS a sign-in in
 * localStorage (`huPortalToken` / `huPortalCreds`), and `handleRsvpLink` calls
 * `savePortalLogin(token)` itself — so pressing Yes or No on an RSVP email
 * CREATES the remembered login that the next link is then opened with.
 *
 * ⚠ THAT IS A DIFFERENT PAGE STATE, AND IT HAS ITS OWN BUG. Addie, 2026-08-31,
 * after the router class-name fix shipped: "back next year goes to member
 * portal". It still did, for her and not for the specs, purely because she had
 * clicked Yes on a previous test and the specs had not.
 *
 * So every spec here seeds a saved login FIRST and then opens the link, which
 * is the ordinary case, not an edge case.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, QUOTES } = require('./fixtures');

const CUST = CUSTOMERS.standard;
const QUOTE_TOKEN = QUOTES.pendingReview.data.quoteToken;

/* The stub aborts every real Google/Firebase/PayPal host by design (§9.4) and
   the browser logs each abort as a console error, so "no console errors at
   all" would fail on the guard doing its job. A thrown script error still
   arrives through 'pageerror' and is still caught. */
const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

/* Seeds the remembered login BEFORE any of index.html's scripts run — which is
   what makes this the state a returning customer is actually in. addInitScript
   runs on every navigation, ahead of page scripts, so the saved-login block at
   the top of index.html sees it on its very first read. */
async function openSignedIn(page, hash) {
  const stub = await installFirebaseStub(page);
  const scriptErrors = [];
  page.on('pageerror', e => scriptErrors.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) {
      scriptErrors.push('console: ' + m.text());
    }
  });
  await page.addInitScript(token => {
    try { localStorage.setItem('huPortalToken', token); } catch (e) {}
  }, CUST.token);
  await page.goto('/index.html' + hash);
  stub.scriptErrors = scriptErrors;
  return stub;
}

test.describe('Email links, with a login already remembered', () => {

  /* ---- the one Addie reported twice ------------------------------------- */
  test('Back Next Year is not swallowed by the remembered login', async ({ page }) => {
    const stub = await openSignedIn(page, `#/?token=${CUST.token}&rsvp=back`);

    /* 1. The answer still has to reach the server, and has to be the RIGHT
          one — 'backnextyear' keeps their lights, a 'no' queues them for
          recycling. */
    await expect.poll(async () => {
      const calls = await stub.calls();
      const r = calls.filter(c => c.name === 'portalRsvp');
      return r.length ? r[r.length - 1].payload.response : null;
    }, { timeout: 6000 }).toBe('backnextyear');

    /* 2. They must be looking at the confirmation, NOT their account. */
    await expect(page.locator('#backNextYearConfirm')).toBeVisible();
    await expect(page.locator('#backNextYearConfirmMsg')).toContainText(/next year/i);
    await expect(page.locator('#portalTabsLayout')).toBeHidden();

    /* 3. And the address bar must not have been rewritten to the portal —
          this is the actual mechanism, so assert it directly rather than
          inferring it from what is on screen. */
    expect(await page.evaluate(() => window.location.hash)).not.toContain('/payment');

    expect(stub.scriptErrors).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* The two RSVP links that land on /payment carry a query, so they were never
     at risk from the same rule — but they share the page the redirect targets,
     so a fix to it must not disturb them. */
  /* ⭐ RENAMED AND REPOINTED 2026-09-01, and the guarantee is unchanged. Dax:
     the RSVP buttons "should also automatically send the customer to their
     member portal", so a yes now DOES end on the account — which is what the
     old title ruled out. The thing this test has always actually asserted is
     the line that has not moved: `#page-quote-details` stays hidden. That is
     the router bug it exists for — a signed-in customer pressing Yes being
     handed the new-customer install form — and it is still proved here. */
  test('Yes lands on the portal, never on the install-details form', async ({ page }) => {
    const stub = await openSignedIn(page, `#/payment?token=${CUST.token}&rsvp=yes`);

    /* ⚠ NOTHING STANDS BETWEEN A YES AND THE ACCOUNT ANY MORE (2026-09-02). The
       gate code is asked as a dialog once they are already inside, so the bill is
       what to wait for; the question is checked on top of it rather than in front. */
    await expect(page.locator('#invBreakdown')).toBeVisible();
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();
    /* Yes is the finishing answer for a customer who already has a code on file:
       it confirms what we hold and closes, without a pointless write. */
    await page.locator('#rsvpGateCodeYesBtn').click();
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();
    await expect(page.locator('#invBreakdown')).toBeVisible();
    await expect(page.locator('#page-quote-details')).toBeHidden();

    expect(stub.scriptErrors).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ⚠ THE EXPECTATION INVERTED, THE GUARANTEE DID NOT (RS-33, 2026-09-01). A No now
     goes straight into the account by design, so "not the account" is no longer the
     right assertion — but the reason this spec exists is unchanged and is what is
     checked instead: a remembered sign-in must never SWALLOW the answer. That was the
     #251 bug, where the saved login hijacked the route and portalRsvp was never
     called at all. Deleting this spec because its wording went stale would drop the
     only guard on that. */
  test('No is still recorded even with a login already remembered', async ({ page }) => {
    const stub = await openSignedIn(page, `#/payment?token=${CUST.token}&rsvp=no`);

    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }, { timeout: 8000 }).toBe('no');

    await expect(page.locator('#page-quote-details')).toBeHidden();

    expect(stub.scriptErrors).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ---- the quote buttons, in the same state ----------------------------- */
  test('Approve Quote records the approval', async ({ page }) => {
    const stub = await openSignedIn(page, `#/quote-details?token=${QUOTE_TOKEN}&action=approve`);

    await expect.poll(async () => {
      const calls = await stub.calls();
      return calls.some(c => c.name === 'quoteRespond' &&
        c.payload.action === 'approve' && c.payload.quoteToken === QUOTE_TOKEN);
    }, { timeout: 6000 }).toBe(true);

    /* And they are on the quote, not on their balance. */
    expect(await page.evaluate(() => window.location.hash)).toContain('/quote-details');

    expect(stub.scriptErrors).toEqual([]);
    await stub.assertNoRealCalls();
  });

  test('Decline Quote asks first, then records the decline', async ({ page }) => {
    const stub = await openSignedIn(page, `#/quote-details?token=${QUOTE_TOKEN}&action=decline`);

    /* Decline is deliberately a two-step — it asks before it records, because
       a decline cannot be taken back from the customer's side. */
    /* ⚠ MATCHED ON THE WORDS THE BUTTON ACTUALLY CARRIES. The confirm step
       renders "No thanks — close it out" (or, on an add-on quote, "No thanks —
       just my usual lights") — it never says "decline" anywhere a customer can
       read, so a /decline/i matcher finds nothing and reports a product failure
       that is really a spec failure. That is the t17 lesson from portal.spec.js,
       repeated here because it cost a run. */
    const onPage = page.locator('#page-quote-details');
    await expect(onPage.locator('#quoteLinkConfirmMsg')).toContainText(/are you sure|is that right/i);
    await onPage.getByRole('button', { name: /close it out|just my usual lights/i }).first()
      .click({ timeout: 6000 });

    await expect.poll(async () => {
      const calls = await stub.calls();
      return calls.some(c => c.name === 'quoteRespond' && c.payload.action === 'decline');
    }, { timeout: 6000 }).toBe(true);

    expect(stub.scriptErrors).toEqual([]);
    await stub.assertNoRealCalls();
  });

});
