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
  /* ---- the SHORT link, loaded the way a phone loads it --------------------
   * Addie, 2026-08-31, on a quote text: "Still bringing me here" — the site
   * chrome with nothing between the header and the footer.
   *
   * ⚠ NOTHING HAD EVER LOADED THIS PAGE AT /q/<token>. Suite S281 proved the
   * _redirects rule exists and that the path pattern extracts a token, and both
   * were right — but a regex passing is not a page booting. index.html imported
   * "./js/money.js" relatively, and this file is served at MORE THAN ONE PATH:
   * Netlify 200-rewrites /q/<token> and /home to it. At /q/<token> that relative
   * import asked for /q/js/money.js, 404'd, and the whole module died — every
   * script dead, header and footer still drawn because they are static HTML.
   * So the short link had never once worked, and nothing anywhere went red.
   *
   * ⚠ THE REWRITE IS SIMULATED, because the test server is a plain static file
   * server and would 404 on /q/ — exactly as it would have done in CI. Netlify
   * answers that path with this file, so the spec does the same. */
  test('the short link boots the app and opens the quote', async ({ page }) => {
    const stub = await installFirebaseStub(page);
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e));
    const INDEX = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.html'), 'utf8');
    await page.route(u => u.pathname === '/q/' + TOKEN, r =>
      r.fulfill({ status: 200, contentType: 'text/html', body: INDEX }));

    await page.goto('/q/' + TOKEN);

    /* The module actually ran. Without this the checks below can pass on a dead
       page — every element they look for is static HTML that renders anyway. */
    await expect.poll(async () =>
      page.evaluate(() => typeof window.__HU_CALLS__ !== 'undefined'),
      { timeout: 5000 }).toBe(true);

    /* And it reached the quote, by the same route the long link uses. */
    await expect.poll(async () => page.evaluate(() => location.hash),
      { timeout: 5000 }).toBe('#/quote-details?token=' + TOKEN);
    await expect(page.locator('#page-quote-details')).toHaveClass(/active/);

    expect(errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ⚠ AND THE CLASS OF BUG, NOT JUST THE ONE LINE. index.html is served at /,
     at /home and at /q/<token>, so ANY relative import here dies at two of those
     three — silently, because a module that fails to load throws nowhere a
     person can see. This is cheaper to keep true than to rediscover. */
  test('index.html has no relative imports, which break under /q/', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.html'), 'utf8');
    const relative = (src.match(/^\s*import[^\n]*from\s+["']\.{0,2}\//gm) || [])
      .filter(l => !/from\s+["']\//.test(l));
    expect(relative, 'served at /q/<token> these resolve to /q/... and 404, ' +
      'killing every script on the page').toEqual([]);
  });
  /* ---- the TEXT link, all the way through --------------------------------
   * Addie, 2026-08-31: "On text if they click on the link and approve it will
   * currently show the form and move them to convert to costumer right or is the
   * text link not going to connect that way?"
   *
   * A fair question, because the two links are NOT the same shape. The email
   * button carries &action=approve; the text link is a bare /q/<token> with no
   * action at all, so it lands on the three-answer screen first. What follows is
   * whether pressing Approve there reaches the same place.
   *
   * ⚠ AND THE TWO CUSTOMERS GO DIFFERENT WAYS ON PURPOSE — which is the real
   * answer. A new lead gets the install-details form. An existing member never
   * does; they are asked "anything changing this year?", because we already hold
   * their colours and re-collecting them invites a second build of a house that
   * already has lights. */
  test('the text link: a NEW customer approves and gets the details form', async ({ page }) => {
    const stub = await installFirebaseStub(page);
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e));
    const INDEX = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.html'), 'utf8');
    await page.route(u => u.pathname === '/q/' + TOKEN, r =>
      r.fulfill({ status: 200, contentType: 'text/html', body: INDEX }));

    await page.goto('/q/' + TOKEN);
    const onPage = page.locator('#page-quote-details');
    await onPage.getByRole('button', { name: /approve/i }).first().click();

    /* The approval is recorded... */
    await expect.poll(async () => (await stub.calls()).some(c =>
      c.name === 'quoteRespond' && c.payload.action === 'approve' &&
      c.payload.quoteToken === TOKEN), { timeout: 5000 }).toBe(true);
    /* ...and the form they must fill in is on screen. Without it the office never
       gets the colours, and quoteStage never moves the card. */
    await expect(page.locator('#quoteDetailFormWrap')).toBeVisible({ timeout: 5000 });

    expect(errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ⭐ THE MEMBER PATH, WHICH IS THE ONE QT-21 FIXED. No form is coming for them,
     so "No, keep everything the same" is what settles the card — and until
     2026-08-31 it wrote nothing at all and the card stuck in Awaiting Response. */
  test('the text link: a MEMBER approves, keeps everything, and it is recorded', async ({ page }) => {
    const MEMBER = QUOTES.pendingForExistingCustomer.data.quoteToken;
    const stub = await installFirebaseStub(page);
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e));
    const INDEX = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.html'), 'utf8');
    await page.route(u => u.pathname === '/q/' + MEMBER, r =>
      r.fulfill({ status: 200, contentType: 'text/html', body: INDEX }));

    await page.goto('/q/' + MEMBER);
    const onPage = page.locator('#page-quote-details');
    await onPage.getByRole('button', { name: /approve/i }).first().click();

    /* They are asked the member question, NOT handed the new-customer form. */
    await expect(onPage.getByRole('button', { name: /keep everything the same/i }))
      .toBeVisible({ timeout: 5000 });
    await expect(page.locator('#quoteDetailFormWrap')).toBeHidden();

    await onPage.getByRole('button', { name: /keep everything the same/i }).click();

    /* ⭐ THE WRITE THAT MOVES THE CARD. Before QT-21 this call did not exist and the
       screen simply said "Perfect, you're all set" while the office saw no change. */
    await expect.poll(async () => (await stub.calls()).some(c =>
      c.name === 'quoteMemberKeptDetails' && c.payload.quoteToken === MEMBER),
      { timeout: 5000 }).toBe(true);
    await expect(onPage.locator('#quoteLinkConfirmMsg')).toContainText(/all set/i);

    expect(errs).toEqual([]);
    await stub.assertNoRealCalls();
  });
});

/* ---------------------------------------------------------------------------
 * THE SHORT REFERRAL LINK — /r/<token>  (REF-11)
 *
 * Addie, 2026-09-04: "make sure the link isnt crazy long try to shorten it so in the
 * rsvp refferal button it looks nice in the email/text."
 *
 *   https://highlightingutah.com/?ref=<20 chars>#/quote   61 characters
 *   https://highlightingutah.com/r/<8 chars>              39 characters
 *
 * ⚠ THIS SPEC EXISTS BECAUSE THE /q/ ONE ABOVE HAD TO BE WRITTEN THE HARD WAY. The
 * short quote link passed a source check for its _redirects rule and its path pattern
 * and had NEVER ONCE WORKED — index.html is served at more than one path, a relative
 * import died under /q/, and every script on the page went with it. The referral link
 * is the same mechanism at a new path, so it gets the same proof: the app boots, and it
 * ends up somewhere useful with the token remembered.
 * ------------------------------------------------------------------------- */
test.describe('The short referral link', () => {
  const REF = 'k3n8x2qa';

  test('/r/<token> boots the app, opens the quote form and remembers the referral', async ({ page }) => {
    const stub = await installFirebaseStub(page);
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e));
    const INDEX = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.html'), 'utf8');
    /* The rewrite is simulated for the same reason the /q/ one is: the test server is a
       plain static file server and would 404 on /r/, exactly as it would in CI. */
    await page.route(u => u.pathname === '/r/' + REF, r =>
      r.fulfill({ status: 200, contentType: 'text/html', body: INDEX }));

    await page.goto('/r/' + REF);

    /* The module actually ran — every element below is static HTML that renders on a
       dead page, so without this the rest can pass on a page whose scripts all died. */
    await expect.poll(async () =>
      page.evaluate(() => typeof window.__HU_CALLS__ !== 'undefined'),
      { timeout: 5000 }).toBe(true);

    /* It lands on the quote form, which is what the link is FOR. */
    await expect.poll(async () => page.evaluate(() => location.hash),
      { timeout: 5000 }).toBe('#/quote');
    await expect(page.locator('#page-quote')).toHaveClass(/active/);

    /* ⚠ AND THE TOKEN IS REMEMBERED, which is the half that pays somebody $25. A link
       that opens the right page and forgets who sent them is a referral that silently
       never counts — and nothing anywhere would go red. */
    await expect.poll(async () => page.evaluate(() => {
      try { return sessionStorage.getItem('hu.referredByToken'); } catch (e) { return 'THREW'; }
    }), { timeout: 5000 }).toBe(REF);

    expect(errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ⚠ THE OLD SPELLING KEEPS WORKING, FOR EVER. Links already pasted into somebody's
     messages carry ?ref=, and a referral that quietly stops counting is the one failure
     nobody reports — the customer just never gets their $25. */
  test('the old ?ref= spelling still counts', async ({ page }) => {
    const stub = await installFirebaseStub(page);
    await page.goto('/index.html?ref=' + REF + '#/quote');
    await expect.poll(async () => page.evaluate(() => {
      try { return sessionStorage.getItem('hu.referredByToken'); } catch (e) { return 'THREW'; }
    }), { timeout: 5000 }).toBe(REF);
    await stub.assertNoRealCalls();
  });
});
