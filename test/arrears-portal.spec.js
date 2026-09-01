/*
 * WHAT A CUSTOMER WHO OWES FROM LAST SEASON ACTUALLY SEES
 *
 * Addie, 2026-09-01, with a screenshot of a $1,146 balance: "it is still
 * making them pay in full. We need this seperate. We need them to pay 2025
 * before this years payment comes up."
 *
 * ⚠ THE MECHANISM EXISTED AND NOTHING DROVE IT. PR #257 built the split —
 * paypalCreateOrder charges the carried balance first, portalInvoice sends the
 * figure, and renderArrearsNotice explains it — and every check on it was
 * node-level (arrears-hold, money-parity). The STUB did not even return
 * arrearsOutstanding, so no browser test could have seen the notice whether it
 * rendered or not.
 *
 * That is this repo's oldest lesson: a message that is in the source is not a
 * message on the screen. These specs open the real portal and read it.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, INVOICES } = require('./fixtures');

const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

/* Their real invoice, plus a carried 2025 balance — the shape Addie's
   screenshot shows: this year's install, and last season's debt as its own
   fee-ledger line. */
function withArrears(amount, year) {
  const base = JSON.parse(JSON.stringify(INVOICES[CUST.invoiceKey]));
  base.changeFees = (Number(base.changeFees) || 0) + amount;
  base.changeFeeNotes = (base.changeFeeNotes || []).concat([{
    amount: amount, kind: 'arrears', source: 'office', year: String(year),
    reason: 'Unpaid balance from the ' + year + ' season — not a charge for this year'
  }]);
  /* ⚠ THE PAYMENTS ARE CLEARED, AND THAT IS THE WHOLE FIXTURE (2026-09-01). The
     standard invoice already carries a $200 deposit, which exactly cancelled a $200
     carried balance — so this built a customer who had ALREADY PAID last season while
     the test's name said they owed for it. It passed only because the stub computed
     arrearsOutstanding WITHOUT subtracting payments, unlike the real
     arrearsOutstandingServer; the moment the stub was made faithful, both tests using
     it went red on correct code. A carried debt with money already against it is the
     SETTLED case and is tested separately below. */
  base.deposit = 0;
  base.credits = 0;
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

test.describe('Paying last season before this one', () => {

  /* ⭐ THE ONE ADDIE REPORTED. Without this the customer sees one combined
     balance and reads it as being charged for both years at once. */
  test('the notice says what is being paid, and that it is not a second charge', async ({ page }) => {
    const stub = await openPortal(page, withArrears(200, 2025));

    const notice = page.locator('#invArrearsNotice');
    await expect(notice).toBeVisible({ timeout: 8000 });
    await expect(notice).toContainText('$200.00');
    await expect(notice).toContainText('2025');
    /* ⚠ The reassurance is the point, not decoration: the figure on the button
       is SMALLER than the balance above it, which without a word of
       explanation reads as a mistake or as a double charge. */
    await expect(notice).toContainText(/not a second charge/i);

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ AND IT SAYS WHAT COMES NEXT. "Once it is paid, this year's will show
     here" is what makes one smaller figure legible as a first instalment
     rather than as the whole bill going wrong. */
  test('it names this year as the next payment', async ({ page }) => {
    const stub = await openPortal(page, withArrears(200, 2025));
    await expect(page.locator('#invArrearsNotice')).toContainText(/next payment/i, { timeout: 8000 });
    stub.assertNoRealCalls();
  });

  /* ⚠ THE NOTICE MUST NOT APPEAR FOR EVERYBODY. A customer with nothing
     carried has one balance and one payment, and a paragraph about last season
     on their screen is a question they then have to ring and ask about. */
  test('a customer with nothing carried sees no notice at all', async ({ page }) => {
    const stub = await openPortal(page);
    /* The account has to have loaded, or this passes because nothing rendered. */
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#invArrearsNotice')).toBeHidden();
    stub.assertNoRealCalls();
  });

  /* ⚠ A SETTLED DEBT IS NOT AN OUTSTANDING ONE. arrearsOutstanding is capped
     at the balance due, so once they have paid it the notice goes — otherwise
     a paid-up customer is told for ever that they owe for 2025. */
  test('a debt already covered by payment shows no notice', async ({ page }) => {
    const o = withArrears(200, 2025);
    const inv = o.invoices[CUST.invoiceKey];
    inv.deposit = (Number(inv.install) || 0) + (Number(inv.removal) || 0) + (Number(inv.changeFees) || 0);
    const stub = await openPortal(page, o);
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#invArrearsNotice')).toBeHidden();
    stub.assertNoRealCalls();
  });

});

/* ---- HOW THE PAYMENT PANEL IS LAID OUT ---------------------------------
 *
 * Addie, 2026-09-01: "I don't want a venmo QR code anymore and I want venmo
 * under other payments not showing at all cause I want venmo to be a last
 * resort", then "venmo will be under other payments which will need to be a
 * dropdown to see venmo."
 *
 * ⚠ EVERY CLAIM HERE IS ABOUT WHAT IS ON SCREEN AND IN WHAT ORDER, which is
 * exactly what a source check cannot see.
 */
test.describe('The payment panel', () => {

  test('Venmo is not visible until the dropdown is opened', async ({ page }) => {
    const stub = await openPortal(page);
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });

    /* The dropdown itself is there... */
    const other = page.locator('#otherPaymentsPanel');
    await expect(other).toBeVisible();
    await expect(other).toContainText(/other payment options/i);
    /* ...but Venmo inside it is not, because it is shut. */
    await expect(page.locator('#venmoPayBtn')).toBeHidden();

    stub.assertNoRealCalls();
  });

  test('opening it reveals Venmo, with the amount already on the link', async ({ page }) => {
    const stub = await openPortal(page);
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });

    await page.locator('#otherPaymentsPanel summary').click();
    const venmo = page.locator('#venmoPayBtn');
    await expect(venmo).toBeVisible();
    /* ⚠ THE AMOUNT MUST STILL BE PRE-FILLED. Shutting the panel on every render
       must not rebuild it and lose the href written just before. */
    await expect(venmo).toHaveAttribute('href', /venmo\.com.*amount=\d+\.\d\d/);

    stub.assertNoRealCalls();
  });

  /* ⚠ THE QR IS GONE, NOT HIDDEN. It was a ~30KB base64 image shipped to every
     customer on every load, and it asked them to type the amount in
     themselves — which is how a payment arrives for the wrong figure. */
  test('the Venmo QR code is gone from the page entirely', async ({ page }) => {
    const stub = await openPortal(page);
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
    expect(await page.locator('#qrPanel').count()).toBe(0);
    expect(await page.locator('img[alt*="Venmo" i]').count()).toBe(0);
    stub.assertNoRealCalls();
  });

  /* ⚠ AND THE OLD DIVIDER GOES WITH IT — "— or pay with Venmo —" announced
     Venmo as an equal alternative, which is the opposite of a last resort. */
  test('nothing announces Venmo as an equal alternative', async ({ page }) => {
    const stub = await openPortal(page);
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
    expect(await page.locator('#paypalOrNote').count()).toBe(0);
    stub.assertNoRealCalls();
  });

});
