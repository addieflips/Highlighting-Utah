/*
 * Paying is not the same as saying yes
 *
 * Dax, 2026-09-02: "make sure that after they pay in the member portal that it
 * updates in all customers ... if they went into the member portal and paid and
 * havent actually clicked yes on the rsvp it should move them to pending after
 * they pay ... so they have to click yes on rsvp if they want their lights hung
 * this year", and then: "you could just have it ask them after they pay too and
 * if they dont answer it then it should pop up in our system where we can see it
 * so we know to email them."
 *
 * ⚠ WHAT THIS FILE CAN AND CANNOT REACH, said plainly. A real PayPal capture
 * cannot be driven here, so the trigger — onApprove handing showRsvpAskIfUnanswered
 * to the re-render — is checked in run-all.js Suite 290 against the source, and the
 * WHEN-to-ask rule is run there as a lifted function. What is proved here is the
 * half only a browser can see: that the dialog is really on the page, that its
 * three answers reach the server through the same handler the portal's own RSVP
 * block uses, and that answering closes it.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

/* A customer who has never answered — the one this whole flow is about. */
function silent() {
  const c = JSON.parse(JSON.stringify(CUST));
  c.record.rsvpStatus = '';
  delete c.record.rsvpRespondedAt;
  return { customers: { standard: c } };
}

async function openPortal(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) thrown.push('console: ' + m.text());
  });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  await expect(page.locator('#invBreakdown')).toBeVisible();
  stub.thrown = thrown;
  return stub;
}

/* ⚠ RAISED BY HAND, AND THE COMMENT IS THE POINT. In production a completed
   payment raises this; a capture cannot be faked here, so the class is added
   directly. That makes every assertion below about the DIALOG rather than about
   when it appears — which is exactly the split described at the top. */
const raise = page => page.evaluate(() => document.getElementById('rsvpAskModal').classList.add('show'));

test.describe('The question a payment asks', () => {

  test('the card is on the page, with all three answers on it', async ({ page }) => {
    const stub = await openPortal(page, silent());
    await expect(page.locator('#rsvpAskCard')).toBeHidden();

    await raise(page);

    await expect(page.locator('#rsvpAskCard')).toBeVisible();
    await expect(page.locator('#rsvpAskBody')).toContainText(/hung this year/i);
    /* ⚠ THE SENTENCE THAT MAKES IT WORTH ASKING. Without it this is a poll; with
       it, it says why an answer is the thing standing between them and a crew. */
    await expect(page.locator('#rsvpAskBody')).toContainText(/can.t put anyone on the schedule/i);
    await expect(page.locator('#rsvpAskBtnRow [data-portalrsvp="yes"]')).toBeVisible();
    await expect(page.locator('#rsvpAskBtnRow [data-portalrsvp="backnextyear"]')).toBeVisible();
    await expect(page.locator('#rsvpAskBtnRow [data-portalrsvp="no"]')).toBeVisible();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⭐ THE ONE THAT MATTERS: the answer reaches the server. The buttons carry
     data-portalrsvp, so they are handled by the SAME delegated listener the portal's
     own RSVP block uses — that is why there is no second copy of this logic to drift. */
  test('Yes reaches the server and closes the card', async ({ page }) => {
    const stub = await openPortal(page, silent());
    await raise(page);

    await page.locator('#rsvpAskBtnRow [data-portalrsvp="yes"]').click();

    await expect.poll(async () => {
      const calls = await stub.calls();
      const r = calls.filter(c => c.name === 'portalRsvp');
      return r.length ? r[r.length - 1].payload.response : null;
    }, { timeout: 5000 }).toBe('yes');

    await expect(page.locator('#rsvpAskCard')).toBeHidden();
    /* And they are left in their portal, not on a confirmation screen. */
    await expect(page.locator('#invBreakdown')).toBeVisible();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('Back next year is an answer too, and also closes it', async ({ page }) => {
    const stub = await openPortal(page, silent());
    await raise(page);

    await page.locator('#rsvpAskBtnRow [data-portalrsvp="backnextyear"]').click();

    await expect.poll(async () => {
      const calls = await stub.calls();
      const r = calls.filter(c => c.name === 'portalRsvp');
      return r.length ? r[r.length - 1].payload.response : null;
    }, { timeout: 5000 }).toBe('backnextyear');
    await expect(page.locator('#rsvpAskCard')).toBeHidden();

    stub.assertNoRealCalls();
  });

  /* ⚠ IT HAS A WAY OUT, AND THAT IS THE DIFFERENCE FROM THE ARREARS LOCK. That one
     withholds something until they pay; this is asked of somebody who has just PAID,
     and trapping them after they have done what we asked would be the wrong way
     round. The System note in admin is the backstop for anyone who closes it. */
  test('"I\'ll decide later" closes it, and answers nothing', async ({ page }) => {
    const stub = await openPortal(page, silent());
    await raise(page);

    await page.locator('#rsvpAskLater').click();

    await expect(page.locator('#rsvpAskCard')).toBeHidden();
    const calls = await stub.calls();
    expect(calls.filter(c => c.name === 'portalRsvp')).toEqual([]);

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('and so does clicking away from it', async ({ page }) => {
    const stub = await openPortal(page, silent());
    await raise(page);

    await page.locator('#rsvpAskBackdrop').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('#rsvpAskCard')).toBeHidden();
    stub.assertNoRealCalls();
  });
});
