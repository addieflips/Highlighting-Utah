/*
 * WHAT A CUSTOMER SEES BEFORE THEIR BILL HAS ACTUALLY GONE OUT
 *
 * Addie, 2026-09-02: "I want to make it clear to the member that this is there
 * payment however they do not need to pay until after they get an invoice from us."
 *
 * ⚠ THE CARD SAID "CURRENT BALANCE" FROM THE MOMENT A HOUSE WAS PRICED, which is
 * months before the nightly run bills anybody. So a customer signing in during
 * October to check their colours read a number that looks due today, above a pay
 * button — while the banner directly above it told them we would be in touch with
 * their install date. Nothing on the page reconciled the two.
 *
 * WHY THIS IS A BROWSER SPEC AND NOT A NODE CHECK. Every claim here is about a
 * sentence a customer READS, and this repo's oldest lesson is that a message in the
 * source is not a message on the screen — the arrears notice sat unrendered for a
 * fortnight with node-level checks green over it, because the stub never sent the
 * field that drives it. So this opens the real portal and reads it.
 *
 * ⭐ THE THIRD TEST IS THE ONE THAT MATTERS. A carried debt from last season lands on
 * this year's bill BEFORE this year's bill is issued, so `billIssued` is honestly
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

async function openPortal(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  stub.thrown = thrown;
  return stub;
}

test.describe('Your price, before the bill goes out', () => {

  /* ⭐ THE ONE ADDIE ASKED FOR. A priced house, nothing billed yet. */
  test('says the number is their price and that nothing is due yet', async ({ page }) => {
    const stub = await openPortal(page, invoiceWith({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));

    const notice = page.locator('#invNotBilledYet');
    await expect(notice).toBeVisible({ timeout: 8000 });
    await expect(notice).toContainText('nothing to pay yet');
    /* Both halves of what she asked for: it IS their payment, and it is not due
       until the invoice arrives. Either sentence alone leaves the other question
       open, and the open question is what generates the phone call. */
    await expect(notice).toContainText('what your lights cost this season');
    await expect(notice).toContainText('invoice');

    /* ⚠ THE LABEL IS THE HALF SOMEBODY SKIMS. A paragraph under a heading reading
       "Current Balance" loses to the heading. */
    await expect(page.locator('#invAmountLabel')).toHaveText(/Your Price This Season/i);

    /* ⚠ AND THE MONEY IS STILL SHOWN. "Nothing to pay yet" must not read as
       "we have not priced you" — that is a different message with its own box. */
    await expect(page.locator('#invAmount')).toContainText('450');

    stub.assertNoRealCalls();
    expect(stub.thrown, stub.thrown.join('\n')).toEqual([]);
  });

  /* Paying early is real — `prepaid` is a value the master sheet already carries —
     so this notice explains, it does not block. A guard that refused money somebody
     is trying to give us would be a worse bug than the confusion it fixes. */
  test('and does not take the pay buttons away', async ({ page }) => {
    await openPortal(page, invoiceWith({
      invoicedAt: null, deposit: 0, lastPaymentAt: null, lastPaymentMethod: null
    }));
    await expect(page.locator('#invNotBilledYet')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#payButtonsWrap')).toBeVisible();
    await expect(page.locator('#invNotBilledYet')).toContainText('welcome to pay early');
  });

  /* ⭐ THE ONE THAT COSTS MONEY IF IT IS WRONG. */
  test('but stays silent when they owe for last season', async ({ page }) => {
    const withArrears = invoiceWith({
      invoicedAt: null, deposit: 0, credits: 0, lastPaymentAt: null, lastPaymentMethod: null
    });
    const inv = withArrears.invoices[CUST.invoiceKey];
    inv.changeFees = 300;
    inv.changeFeeNotes = [{
      amount: 300, kind: 'arrears', source: 'office', year: '2025',
      reason: 'Unpaid balance from the 2025 season — not a charge for this year'
    }];

    await openPortal(page, withArrears);

    /* The arrears notice speaks for this customer; ours must not contradict it. */
    await expect(page.locator('#invArrearsNotice')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#invNotBilledYet')).toBeHidden();
    /* And the label goes back, because for them the figure really is a balance. */
    await expect(page.locator('#invAmountLabel')).toHaveText(/Current Balance/i);
  });

  /* Once the bill has gone, the page reverts to what it always said. */
  test('and disappears once the invoice has been sent', async ({ page }) => {
    await openPortal(page, invoiceWith({ invoicedAt: '2026-11-05T02:00:00-07:00' }));
    await expect(page.locator('#invAmount')).toContainText('250', { timeout: 8000 });
    await expect(page.locator('#invNotBilledYet')).toBeHidden();
    await expect(page.locator('#invAmountLabel')).toHaveText(/Current Balance/i);
  });

  /* ⚠ THE FAIL-SAFE DIRECTION, and the reason index.html tests `=== false` rather
     than `!billIssued`. An older cached page, or a portalInvoice that fell over part
     way, sends no field at all — and telling somebody holding a real invoice that
     they need not pay it is the expensive way to be wrong. Silence is correct. */
  test('says nothing at all when the server did not tell us', async ({ page }) => {
    /* The field is absent, not false — an older deployed function, or a page the
       customer left open across a deploy. Reproduced through the stub rather than by
       calling the renderer directly, because what has to hold is what the PAGE does
       with a record it did not get the field on. */
    await openPortal(page, invoiceWith({
      __noBillIssued: true, invoicedAt: null, deposit: 0,
      lastPaymentAt: null, lastPaymentMethod: null
    }));
    await expect(page.locator('#invAmount')).toContainText('450', { timeout: 8000 });
    await expect(page.locator('#invNotBilledYet')).toBeHidden();
    await expect(page.locator('#invAmountLabel')).toHaveText(/Current Balance/i);
  });
});
