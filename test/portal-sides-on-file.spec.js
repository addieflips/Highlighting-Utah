/*
 * What the Sides tab says we already hold ([[OPT-24]])
 *
 * Addie, 2026-09-19: "can we backfill the sides for existing customers".
 *
 * Nearly the whole book has a COUNT of sides on file and no names. This tab drew
 * those ~956 people four empty boxes — the identical screen a record we hold
 * nothing at all for gets. So the one number that decides their price was
 * invisible on the one screen where they can change it, and an innocent tick of
 * two boxes on a house we have down as three re-quotes them for a change they did
 * not know they were making.
 *
 * ⚠ THESE RUN THE PAGE, and that is the whole reason the file exists. Every claim
 * here is a SENTENCE A CUSTOMER READS and a BOX THAT IS OR IS NOT TICKED — and
 * this repo has been caught three times by a check that matched the source of a
 * message which could never reach the screen. run-all Suite 63 runs the rule; only
 * a browser can say the rule reaches the card.
 *
 * ⛔ AND THE REFUSAL IS TESTED HERE TOO. The office form fills its boxes from the
 * count ([[OPT-07]]) because a guess somebody SEES and corrects before saving is
 * not a claim. Here the person ticking is the customer, so a pre-ticked box saved
 * without reading becomes THEIR answer — on the field [[OPT-03]] says decides
 * which half of a roof gets lit. Nothing is pre-ticked, and that is asserted.
 *
 * ⚠ THE FIXTURE HAD TO BE GIVEN A COUNT. CUSTOMERS.standard carries no houseSides
 * at all, so against it every assertion below passes whether the feature is there
 * or not — the vacuous-fixture trap. Each test overrides the record itself.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const CUST = CUSTOMERS.standard;
const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

/* A copy of the standard customer with the sides fields set to whatever this test
   is about. Deep-copied, because the fixtures object is shared across the file. */
function withSides(fields) {
  const base = JSON.parse(JSON.stringify(CUST));
  Object.assign(base.record, fields);
  return { customers: { standard: base } };
}

async function openSides(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) thrown.push('console: ' + m.text());
  });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  await expect(page.locator('#invBreakdown')).toBeVisible();
  await page.locator('.portal-tab-btn[data-tab="sides"]').click();
  await expect(page.locator('#tabPanel-sides')).toBeVisible();
  stub.thrown = thrown;
  return stub;
}

const ticked = page => page.locator('.portal-side-pick:checked').count();

test.describe('The Sides tab and what we already hold', () => {

  test('a house with a count and no names is told the count', async ({ page }) => {
    const stub = await openSides(page, withSides({ houseSides: 3, houseSidesList: null }));

    const note = page.locator('#sidesOnFileNote');
    await expect(note).toBeVisible();
    await expect(note).toContainText('3 sides on file');
    /* ⚠ THE NUMBER TWICE, ON PURPOSE. Sides change the PRICE rather than adding a
       fee, so the sentence has to say how to avoid that, not only that it happens. */
    await expect(note).toContainText('still tick 3');
    await expect(note).toContainText('price does not change');

    /* ⛔ AND NOT ONE BOX IS TICKED FOR THEM. */
    expect(await ticked(page)).toBe(0);

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('a house that has said which sides reads them back, not the count', async ({ page }) => {
    const stub = await openSides(page,
      withSides({ houseSides: 2, houseSidesList: ['Back', 'Front'] }));

    const note = page.locator('#sidesOnFileNote');
    await expect(note).toBeVisible();
    /* Canonical order, not the order it happened to be stored in. */
    await expect(note).toContainText('On file for you: Front, Back');
    await expect(note).not.toContainText('but not which ones');

    /* Their own answer IS ticked — that is what makes the silence above a refusal
       rather than the renderer simply not working. */
    expect(await ticked(page)).toBe(2);
    await expect(page.locator('.portal-side-pick[value="Front"]')).toBeChecked();
    await expect(page.locator('.portal-side-pick[value="Back"]')).toBeChecked();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('a house nobody has ever measured is told nothing at all', async ({ page }) => {
    const stub = await openSides(page, withSides({ houseSides: null, houseSidesList: null }));

    /* ⚠ NOT "1 side on file". portalSideCount floors an unrecorded house at 1 so the
       portal and the server cannot disagree about a re-quote; borrowing that floor
       here would invent a one-side answer for the whole book, in the first person. */
    await expect(page.locator('#sidesOnFileNote')).toBeHidden();
    expect(await ticked(page)).toBe(0);

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('and the line moves when they answer, under the same Saved', async ({ page }) => {
    const stub = await openSides(page, withSides({ houseSides: 2, houseSidesList: null }));

    await expect(page.locator('#sidesOnFileNote')).toContainText('2 sides on file');

    /* The same count they are already down for, so this names sides without
       changing the number — no confirm, no re-quote, which is the common first save
       for every one of the ~956. */
    await page.locator('.portal-side-pick[value="Front"]').check();
    await page.locator('.portal-side-pick[value="Left"]').check();
    await page.locator('#sidesSaveBtn').click();

    await expect(page.locator('#sidesSaveStatus')).toContainText('Saved');
    /* ⚠ THE POINT OF THE TEST. Without the re-draw after the mirror, "Saved." sits
       above a line still saying we were never told which sides. */
    await expect(page.locator('#sidesOnFileNote')).toContainText('On file for you: Front, Left');
    await expect(page.locator('#sidesOnFileNote')).not.toContainText('but not which ones');

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });
});
