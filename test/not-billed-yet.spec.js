/*
 * WHAT A CUSTOMER SEES BEFORE THEIR BILL HAS ACTUALLY GONE OUT
 *
 * Addie, 2026-09-02: "I want to make it clear to the member that this is there
 * payment however they do not need to pay until after they get an invoice from us."
 * Then, 2026-09-03, having seen it as an inline box: "make it more obvious...
 * like a popup" — then, having seen a mockup with a second "Pay now" button, asked
 * for a plain notice with one dismiss button instead, since the real pay buttons
 * are already on this same screen. Then, same day, having seen the popup fire on
 * an ordinary sign-in: "This should only pull up when they push RSVP Approve. It
 * should not pop up every time they open there member portal." [[MON-60]]
 *
 * ⚠ "RSVP APPROVE" IS THE EMAIL LINK, NOT ANY OTHER YES. openPortalAfterYes —
 * reached only from handleRsvpLink's yes branch, i.e. `?rsvp=yes` in the URL — is
 * the one and only caller that sets showPriceModalOnLoad. The post-payment "are you
 * having lights this year?" ask and the in-portal Changes-tab RSVP toggle both
 * answer RSVP too, through the same portalRsvp call, but neither one goes through
 * openPortalAfterYes and neither one may raise this pop-up. That distinction is
 * the point of the second describe block below.
 *
 * ⚠ THE CARD SAID "CURRENT BALANCE" FROM THE MOMENT A HOUSE WAS PRICED, which is
 * months before the nightly run bills anybody. So a customer signing in during
 * October to check their colours read a number that looks due today, above a pay
 * button — while the banner directly above it told them we would be in touch with
 * their install date. Nothing on the page reconciled the two. That problem is what
 * all of this fixes; the label switch (see below) still happens on every sign-in —
 * only the interrupting pop-up is now restricted to the RSVP-approve moment.
 *
 * WHY THIS IS A BROWSER SPEC AND NOT A NODE CHECK. Every claim here is about a
 * sentence a customer READS, and this repo's oldest lesson is that a message in the
 * source is not a message on the screen — the arrears notice sat unrendered for a
 * fortnight with node-level checks green over it, because the stub never sent the
 * field that drives it. So this opens the real portal and reads it.
 *
 * ⭐ THE ARREARS TEST IS THE ONE THAT MATTERS. A carried debt from last season lands
 * on this year's bill BEFORE this year's bill is issued, so `billIssued` is honestly
 * false while the money is genuinely payable now — and that customer is being held
 * off the schedule until they pay. "There is nothing to pay yet" is the exact
 * sentence that would keep them out of the season.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, INVOICES } = require('./fixtures');

const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

/* The same customer, with their invoice put into a given state. Built off the real
   fixture rather than hand-written, so a change to INVOICE_READ_FIELDS reaches these
   tests instead of leaving them asserting against a shape production no longer sends. */
function invoiceWith(changes) {
  const base = JSON.parse(JSON.stringify(INVOICES[CUST.invoiceKey]));
  Object.assign(base, changes);
  return { invoices: { [CUST.invoiceKey]: base } };
}

/* A copy of the standard customer with no gate code on file, so the RSVP-approve
   flow's gate-code confirmation step never appears — see gate-code.test.js /
   rsvp-gate-code.spec.js for that step on its own. Kept separate from CUST so a
   test that goes through openPortalAfterYes is not incidentally testing two
   features at once. */
function noGateCodeOverrides(invoiceChanges) {
  const c = JSON.parse(JSON.stringify(CUST));
  c.record.gateCode = '';
  const inv = JSON.parse(JSON.stringify(INVOICES[CUST.invoiceKey]));
  Object.assign(inv, invoiceChanges);
  return {
    customers: { [CUST.id]: c },
    invoices: { [CUST.invoiceKey]: inv }
  };
}

async function openPortal(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  stub.thrown = thrown;
  return stub;
}

/* The RSVP-approve link itself — the one and only trigger this pop-up may fire on. */
async function openViaRsvpApprove(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  await page.goto(`/index.html#/payment?token=${CUST.token}&rsvp=yes`);
  stub.thrown = thrown;
  return stub;
}

test.describe('Your price, before the bill goes out — pop-up scope', () => {

  /* ⭐ THE ONE ADDIE ASKED FOR, 2026-09-03. An ordinary sign-in must never raise
     this dialog, even when every money condition that would allow it is true. */
  test('does not pop up on an ordinary sign-in, even when unbilled and priced', async ({ page }) => {
    const stub = await openPortal(page, invoiceWith({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));

    await expect(page.locator('#invAmount')).toContainText('450', { timeout: 8000 });
    /* The label still tells the truth on a plain sign-in — only the pop-up is
       restricted. Losing this would be trading one bug for another. */
    await expect(page.locator('#invAmountLabel')).toHaveText(/Your Price This Season/i);
    await expect(page.locator('#portalPriceModal')).toBeHidden();

    stub.assertNoRealCalls();
    expect(stub.thrown, stub.thrown.join('\n')).toEqual([]);
  });

  /* Same as above, reached the other ordinary way in — a saved token with no rsvp
     param, which is how a returning customer's bookmark or auto-login behaves. */
  test('does not pop up on a saved-token load either', async ({ page }) => {
    await installFirebaseStub(page, invoiceWith({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));
    await page.goto(`/index.html#/payment?token=${CUST.token}`);
    await expect(page.locator('#invAmount')).toContainText('450', { timeout: 8000 });
    await expect(page.locator('#portalPriceModal')).toBeHidden();
  });
});

test.describe('Your price, before the bill goes out — on RSVP Approve', () => {

  /* ⭐ THE ONE THAT HAS TO KEEP WORKING. The whole point of MON-60 is narrowing
     WHEN this shows, not removing it — somebody who just approved for the season
     and has nothing billed yet should still see it, once. */
  test('pops up after RSVP Approve, saying the number is their price and nothing is due', async ({ page }) => {
    const stub = await openViaRsvpApprove(page, noGateCodeOverrides({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));

    const modal = page.locator('#portalPriceModal');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await expect(modal).toContainText('No payment due yet');
    await expect(modal).toContainText('Your price this season');
    await expect(modal).toContainText('invoice');
    await expect(page.locator('#portalPriceModalAmount')).toContainText('450');
    await expect(page.locator('#invAmountLabel')).toHaveText(/Your Price This Season/i);
    await expect(page.locator('#invAmount')).toContainText('450');

    stub.assertNoRealCalls();
    expect(stub.thrown, stub.thrown.join('\n')).toEqual([]);
  });

  /* One button only — never a second "Pay now" that would charge nothing when
     pressed, since the real pay buttons are already on this same screen. */
  test('dismisses to the real pay buttons rather than acting as a second one', async ({ page }) => {
    await openViaRsvpApprove(page, noGateCodeOverrides({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));
    const modal = page.locator('#portalPriceModal');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await expect(modal).toContainText('payment options are available below');

    const closeBtn = page.locator('#portalPriceModalCloseBtn');
    await expect(closeBtn).toHaveText(/Got it/i);
    await closeBtn.click();
    await expect(modal).toBeHidden();
    await expect(page.locator('#payButtonsWrap')).toBeVisible();
  });

  /* Clicking the backdrop is the same dismiss as the button. */
  test('also dismisses on a backdrop click', async ({ page }) => {
    await openViaRsvpApprove(page, noGateCodeOverrides({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));
    const modal = page.locator('#portalPriceModal');
    await expect(modal).toBeVisible({ timeout: 8000 });
    await page.locator('#portalPriceModalBackdrop').click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden();
  });

  /* ⭐ THE ONE THAT COSTS MONEY IF IT IS WRONG. */
  test('but stays silent when they owe for last season, even after RSVP Approve', async ({ page }) => {
    const overrides = noGateCodeOverrides({
      invoicedAt: null, deposit: 0, credits: 0, lastPaymentAt: null, lastPaymentMethod: null
    });
    overrides.invoices[CUST.invoiceKey].changeFees = 300;
    overrides.invoices[CUST.invoiceKey].changeFeeNotes = [{
      amount: 300, kind: 'arrears', source: 'office', year: '2025',
      reason: 'Unpaid balance from the 2025 season — not a charge for this year'
    }];

    await openViaRsvpApprove(page, overrides);

    /* The arrears notice/lock speaks for this customer; ours must not contradict it. */
    await expect(page.locator('#portalPriceModal')).toBeHidden();
    await expect(page.locator('#invAmountLabel')).toHaveText(/Current Balance/i);
  });

  /* Once the bill has gone, the page reverts to what it always said — RSVP Approve
     or not. */
  test('and stays hidden once the invoice has already been sent', async ({ page }) => {
    await openViaRsvpApprove(page, noGateCodeOverrides({ invoicedAt: '2026-11-05T02:00:00-07:00' }));
    await expect(page.locator('#invAmount')).toContainText('250', { timeout: 8000 });
    await expect(page.locator('#portalPriceModal')).toBeHidden();
    await expect(page.locator('#invAmountLabel')).toHaveText(/Current Balance/i);
  });

  /* ⚠ THE FAIL-SAFE DIRECTION, and the reason index.html tests `=== false` rather
     than `!billIssued`. An older cached page, or a portalInvoice that fell over part
     way, sends no field at all — and telling somebody holding a real invoice that
     they need not pay it is the expensive way to be wrong. Silence is correct. */
  test('says nothing at all when the server did not tell us, even after RSVP Approve', async ({ page }) => {
    await openViaRsvpApprove(page, noGateCodeOverrides({
      __noBillIssued: true, invoicedAt: null, deposit: 0,
      lastPaymentAt: null, lastPaymentMethod: null
    }));
    await expect(page.locator('#invAmount')).toContainText('450', { timeout: 8000 });
    await expect(page.locator('#portalPriceModal')).toBeHidden();
    await expect(page.locator('#invAmountLabel')).toHaveText(/Current Balance/i);
  });
});
