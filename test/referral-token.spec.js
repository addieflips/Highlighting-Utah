/*
 * THE REFERRAL TOKEN HAS TO SURVIVE THE TRIP FROM THE LINK TO THE FORM
 * ====================================================================
 * REF-33. Addie shared her referral link with two people through the phone share
 * sheet, both filled the quote form in, and NEITHER counted — and on the one she
 * then converted, the $30 set-up fee was still charged.
 *
 * Both symptoms are one fact: `referredByToken` never reached the quote.
 * `quoteChargesSetupFee` waives the fee on that field and `creditReferralIfAny`
 * pays the $25 on it, so with it missing the friend is charged and the referrer
 * earns nothing — silently, on both sides. Nothing anywhere went red.
 *
 * The cause was storage. The token rode in sessionStorage alone, which is PER TAB:
 * a link tapped in Messages opens in that app's in-app browser, and closing it or
 * tapping "Open in Safari" loses it. On a phone that is the ordinary path, which is
 * why both of hers went the same way rather than one of them.
 *
 * ⭐ THESE RUN THE REAL PAGE AND READ THE REAL WRITE. The last assertion in the
 * important specs is the quote document the page actually tried to save, taken off
 * the Firebase stub — not a helper called in isolation, and not a source match.
 * `referralQuoteFields` lives inside index.html's module script and is deliberately
 * not on `window`, so the only honest way to ask "would this quote carry the
 * referral" is to submit one. The hoisting bug that once wrote the token under the
 * key "undefined" was caught by a browser spec and could not have been caught by
 * anything else; this is that same class of fault one layer along.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');

const TOKEN = 'k7m2npqr';
const OTHER = 'zzz44444';

const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

/* Netlify rewrites /r/* to index.html (see _redirects). The static test server does
   not, so it is mimicked here — these specs are about the PAGE's behaviour on that
   URL, and the rewrite rule itself has its own Netlify check. */
async function serveRewrites(page) {
  await page.route('**/r/*', async route => {
    const url = new URL(route.request().url());
    if (!/^\/r\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return route.continue();
    const res = await route.fetch({ url: url.origin + '/index.html' });
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: await res.text()
    });
  });
}

async function open(page) {
  const stub = await installFirebaseStub(page);
  await serveRewrites(page);
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) errs.push('console: ' + m.text());
  });
  stub.scriptErrors = errs;
  return stub;
}

const stored = page => page.evaluate(() => ({
  session: sessionStorage.getItem('hu.referredByToken'),
  local: localStorage.getItem('hu.referredByToken'),
  at: localStorage.getItem('hu.referredByTokenAt'),
  search: location.search
}));

/* Fill and submit the real public quote form, then hand back the quote document the
   page tried to write. This is the whole question, end to end. */
async function submitQuote(page, stub) {
  await page.evaluate(() => { window.__HU_WRITES__ = []; });
  /* Every required field, by its real name — `street`, not `address`, and the
     contact-method select, without which the browser blocks submission and the spec
     fails for a reason that has nothing to do with referrals. */
  await page.locator('#quoteForm [name="name"]').fill('Kyle New');
  await page.locator('#quoteForm [name="phone"]').fill('8015559999');
  await page.locator('#quoteForm [name="email"]').fill('kyle@example.com');
  await page.locator('#quoteForm [name="street"]').fill('1 Elm St');
  await page.locator('#quoteForm [name="city"]').fill('Lehi');
  await page.locator('#quoteForm [name="zip"]').fill('84043');
  await page.locator('#quoteForm [name="contact_method"]').selectOption({ index: 1 });
  await page.locator('#quoteForm button[type="submit"]').click();
  await expect.poll(async () =>
    (await stub.writes()).filter(w => w.op === 'add' && w.ref && /quotes/.test(JSON.stringify(w.ref))).length,
    { timeout: 10000 }
  ).toBeGreaterThan(0);
  const writes = await stub.writes();
  const add = writes.filter(w => w.op === 'add').pop();
  return (add && add.data) || {};
}

test.describe('The referral token', () => {
  /* ⚠ index.html is large and these specs load it two or three times each — a link
     visit, then a return through the front door, then a real form submission. The
     repo-wide 20s per-test limit is tuned for single-load specs and these time out on
     it while asserting nothing. Raised here only, rather than globally. */
  test.describe.configure({ timeout: 60000 });


  test('a /r/ link is remembered durably and stays in the address bar', async ({ page }) => {
    const stub = await open(page);
    await page.goto('/r/' + TOKEN);
    await page.waitForFunction(() => location.hash === '#/quote', null, { timeout: 15000 });

    const seen = await stored(page);
    expect(seen.session, 'this visit must remember it').toBe(TOKEN);
    expect(seen.local, 'and it must survive the tab closing').toBe(TOKEN);
    expect(Number(seen.at), 'an undated token is treated as too old to trust').toBeGreaterThan(0);
    /* ⚠ THE HALF THAT SURVIVES A CHANGE OF BROWSER. Storage cannot follow somebody out
       of an in-app browser into Safari; the URL can, and it is the only thing that
       makes "Open in Safari" work. This used to be stripped for a tidy address bar. */
    expect(seen.search, 'the link must still carry its own answer').toContain('ref=' + TOKEN);

    expect(stub.scriptErrors, 'the referral path must not throw').toEqual([]);
    await stub.assertNoRealCalls();
  });

  test('the quote still carries the referral after the tab that opened the link is gone',
    async ({ page }) => {
      const stub = await open(page);
      await page.goto('/r/' + TOKEN);
      await page.waitForFunction(() => location.hash === '#/quote', null, { timeout: 15000 });

      /* HER FAILURE, REPRODUCED: the friend taps the link in Messages, reads the page,
         and comes back later through the front door. sessionStorage is per tab, so it
         is gone — nothing about the referral should be. */
      await page.evaluate(() => sessionStorage.clear());
      await page.goto('/index.html#/quote');

      const quote = await submitQuote(page, stub);
      expect(quote.referredByToken,
        'this is the $25 and the $30 waiver, both lost when this is missing').toBe(TOKEN);
      await stub.assertNoRealCalls();
    });

  test('somebody who came to us directly carries no referral at all', async ({ page }) => {
    const stub = await open(page);
    await page.goto('/index.html#/quote');
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
    await page.goto('/index.html#/quote');

    const quote = await submitQuote(page, stub);
    /* ⚠ THE FIELD IS OMITTED, NEVER SENT EMPTY. A blank token on every quote in the
       book reads as a link that failed rather than a customer who came directly. */
    expect('referredByToken' in quote).toBe(false);
    await stub.assertNoRealCalls();
  });

  test('a remembered token older than the window is not used', async ({ page }) => {
    const stub = await open(page);
    await page.goto('/r/' + TOKEN);
    await page.waitForFunction(() => location.hash === '#/quote', null, { timeout: 15000 });

    await page.evaluate(() => {
      sessionStorage.clear();
      /* 91 days — one past the window. A token that lived for ever would credit a
         referrer for a quote submitted a year later on a link that has since rotated. */
      localStorage.setItem('hu.referredByTokenAt', String(Date.now() - 91 * 86400000));
    });
    await page.goto('/index.html#/quote');

    const quote = await submitQuote(page, stub);
    expect('referredByToken' in quote).toBe(false);
    await stub.assertNoRealCalls();
  });

  test('an undated remembered token is not used either', async ({ page }) => {
    const stub = await open(page);
    await page.goto('/index.html#/quote');
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.setItem('hu.referredByToken', 'k7m2npqr');
      localStorage.removeItem('hu.referredByTokenAt');
    });
    await page.goto('/index.html#/quote');

    /* Nothing writes one without the other, so an unstamped token predates this build
       or was edited by hand. Too old to trust beats keeping it for ever. */
    const quote = await submitQuote(page, stub);
    expect('referredByToken' in quote).toBe(false);
    await stub.assertNoRealCalls();
  });

  test('a second link wins over the one remembered from before', async ({ page }) => {
    const stub = await open(page);
    await page.goto('/r/' + TOKEN);
    await page.waitForFunction(() => location.hash === '#/quote', null, { timeout: 15000 });
    await page.goto('/r/' + OTHER);
    await page.waitForFunction(() => location.hash === '#/quote', null, { timeout: 15000 });

    /* Opening a second person's link says who sent them THIS time; the older one is
       stale by exactly the amount that matters. */
    const quote = await submitQuote(page, stub);
    expect(quote.referredByToken).toBe(OTHER);
    await stub.assertNoRealCalls();
  });

  test('the long ?ref= spelling still works, and is durable now too', async ({ page }) => {
    const stub = await open(page);
    /* Every link already pasted into somebody's messages carries this spelling. */
    await page.goto('/index.html?ref=' + TOKEN + '#/quote');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/index.html#/quote');

    const quote = await submitQuote(page, stub);
    expect(quote.referredByToken).toBe(TOKEN);
    await stub.assertNoRealCalls();
  });
});
