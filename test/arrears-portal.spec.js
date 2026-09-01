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
