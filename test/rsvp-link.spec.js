/*
 * RSVP email links — browser specs
 *
 * ⭐ WHY THESE ARE BROWSER SPECS AND NOT SOURCE CHECKS. Every claim here is
 * about WHAT IS ON THE SCREEN after a customer presses a button in an email.
 * The bug these were written against was one wrong class name in the router:
 * every message, every handler and every button was present and correct in the
 * source, and a customer pressing Approve still landed on the new-customer
 * install-details form. A regex over index.html passes on that code. Running
 * it does not. (CLAUDE.md §5, "a message that is in the source is not a
 * message on the screen".)
 *
 * THE THREE LINKS, read out of admin.html's template renderer rather than
 * guessed — {{rsvp_yes_button}} / {{rsvp_no_button}} / {{rsvp_back_button}}:
 *     Yes            #/payment?token=XXXX&rsvp=yes
 *     No             #/payment?token=XXXX&rsvp=no
 *     Back Next Year #/?token=XXXX&rsvp=back
 * The first two are answered by handleRsvpLink, the third by
 * handleBackNextYear. Change a URL in admin.html and change it here.
 *
 * Each spec asserts THREE things, because the bug satisfied the first one on
 * its own: the answer that reached the server, the confirmation the customer
 * reads, and — the half that was broken — that the quote-details FORM is not
 * what they are looking at.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

async function open(page, path) {
  const stub = await installFirebaseStub(page);

  /* ⚠ THROWN JS AND CONSOLE NOISE ARE KEPT APART, DELIBERATELY. A script that
     THREW is a product failure and is asserted empty below. A console line is
     not: the stub aborts every real backend URL by design (§9.4), and a font
     or an image that will not load in a sandbox reports the same way — so
     asserting on those makes the spec fail for reasons that have nothing to do
     with the page. They are still collected, and printed when something else
     fails, because that is when they are worth reading. */
  const thrown = [];
  const consoleNoise = [];
  page.on('pageerror', e => thrown.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleNoise.push(m.text()); });
  await page.goto(path);
  stub.thrown = thrown;
  stub.consoleNoise = consoleNoise;
  return stub;
}

/* The one assertion the old code failed. #page-quote-details is where a NEW
 * customer fills in colours, wire and timer — an existing member answering an
 * RSVP has all of it on file already and must never be shown it. */
async function expectNotTheQuoteForm(page) {
  await expect(page.locator('#page-quote-details')).toBeHidden();
  await expect(page.locator('#quoteDetailForm')).toBeHidden();
}

test.describe('RSVP email links', () => {

  test('Yes — confirms them for the season and offers the portal, not the form', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}&rsvp=yes`);

    /* 1. What reached the server. */
    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('yes');

    /* 2. What they read. */
    await expect(page.locator('#rsvpConfirmCard')).toBeVisible();
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/confirmed for this season/i);
    await expect(page.locator('#rsvpOpenPortalBtn')).toBeVisible();
    await expect(page.locator('#rsvpNoChangesBtn')).toBeVisible();

    /* 3. What they must NOT be looking at. */
    await expectNotTheQuoteForm(page);

    /* Minimal mode: a receipt, not the website. Nothing to browse away into. */
    await expect(page.locator('header')).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('No — records the no and says so, without dropping them in the form', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}&rsvp=no`);

    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('no');

    await expect(page.locator('#rsvpConfirmCard')).toBeVisible();
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/sorry to miss you/i);
    /* The reason box is OFFERED, never demanded — the no is already saved. */
    await expect(page.locator('#rsvpOpenPortalBtn')).toContainText(/tell us why/i);

    await expectNotTheQuoteForm(page);
    await expect(page.locator('header')).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('Back Next Year — its own status and its own confirmation on the home page', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/?token=${cust.token}&rsvp=back`);

    /* ⚠ 'backnextyear', NOT 'no'. They are two different answers: a no queues
       the lights for recycling, Back Next Year deliberately does not. */
    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('backnextyear');

    await expect(page.locator('#backNextYearConfirm')).toBeVisible();
    await expect(page.locator('#backNextYearConfirmMsg')).toContainText(/next year/i);

    await expectNotTheQuoteForm(page);
    await expect(page.locator('header')).toBeHidden();

    /* The rest of the home page is off — otherwise the confirmation is a line
       floating above the marketing site they did not ask to visit. */
    await expect(page.locator('#page-home .page-hero').first()).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

});
