/*
 * ANY, GREEN, WHITE — AND "ANY" STORES NOTHING  ([[OPT-21]], 2026-09-18)
 *
 * Addie: "They should see Any, Green, White. With instructions on what to pick. If they
 * click any or keep it at any then it should allow us to pick and require us to pick the
 * wire."
 *
 * ⚠ THIS REVERSES [[OPT-12]], which took the question off this form outright the day
 * before (R-024). What that ruling was really refusing was an INVENTED answer: the old
 * control defaulted to 'Any' and STORED the word, so most quotes carried a cord nobody had
 * chosen. The question was never the fault, and this file is the proof of the difference —
 * the pill says Any and the save carries no wire colour at all.
 *
 * ⛔ WHY A BROWSER SPEC AND NOT A SOURCE CHECK. Every claim here is either something she
 * SEES on a form or something the page POSTS, and this repo has been caught four times by
 * a source check passing over a control that could never run. wire-pick.test.js holds the
 * rule itself (the two copies of White-or-Green, run side by side); this holds the wiring.
 *
 * ⛔ AND THE PORTAL IS DELIBERATELY NOT TOUCHED — test/wire-colour.spec.js still asserts
 * there is no wire control on the Changes tab, and it still passes. She asked about the
 * form a NEW customer fills in; offering "Any" to a member who already has Green would be
 * offering to erase it.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { QUOTES } = require('./fixtures');

const TOKEN = QUOTES.pendingReview.data.quoteToken;
const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

/* Approve first, because the detail form is what FOLLOWS an approval — a spec that only
   navigates never sees it, which is the trap [[RS-57]] records for the RSVP link. */
async function openDetailForm(page) {
  const stub = await installFirebaseStub(page);
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED.test(m.text())) errs.push('console: ' + m.text());
  });
  await page.goto('/index.html#/quote-details?token=' + TOKEN + '&action=approve');
  await expect(page.locator('#quoteDetailFormWrap')).toBeVisible({ timeout: 8000 });
  stub.errs = errs;
  return stub;
}

/** What the page actually posted to quoteSaveDetails on the last submit. */
async function lastDetails(stub) {
  const calls = await stub.calls();
  const saves = calls.filter(c => c.name === 'quoteSaveDetails');
  expect(saves.length).toBeGreaterThan(0);
  return saves[saves.length - 1].payload.details || {};
}

/** Fill in the one thing the form refuses to submit without, then submit. */
async function pickAColourAndSubmit(page) {
  await page.locator('.qd-simple-swatch[data-color="Warm White"]').click();
  await page.locator('#quoteDetailForm button[type="submit"]').click();
}

test.describe('The wire colour on the detail form', () => {

  test('she sees three answers, in her order, with Any already picked', async ({ page }) => {
    const stub = await openDetailForm(page);
    const row = page.locator('#qdWireRow');
    await expect(row).toBeVisible();

    const pills = row.locator('input[name="wire_color"]');
    await expect(pills).toHaveCount(3);
    /* ⛔ THE ORDER AND THE DEFAULT ARE BOTH HERS. "keep it at any" only means anything
       if Any is where the form starts. */
    await expect(pills.nth(0)).toBeChecked();
    await expect(pills.nth(0)).toHaveValue('');
    await expect(pills.nth(1)).toHaveValue('Green');
    await expect(pills.nth(2)).toHaveValue('White');
    await expect(row).toContainText(/Any/);
    await expect(row).toContainText(/Green/);
    await expect(row).toContainText(/White/);

    expect(stub.errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  test('and instructions telling her what to pick and what Any means', async ({ page }) => {
    const stub = await openDetailForm(page);
    /* She asked for instructions by name. A picker with three bare words is the question
       without the help, which is how "Any" gets picked for the wrong reason. */
    await expect(page.locator('#qdWireRow')).toContainText(/blends in with your roofline/i);
    await expect(page.locator('#qdWireRow')).toContainText(/we.ll choose the one/i);
    await stub.assertNoRealCalls();
  });

  /* ⛔ THE CHECK THIS FILE EXISTS FOR. Leaving it on Any must send NO wire colour — not
     the word 'Any', and not a blank either. A blank would erase a colour a re-quote
     prefilled off the member's own record; the word would head a warehouse pile
     "Any wire", the invented cord [[OPT-12]] was written to stop. */
  test('leaving it on Any sends no wire colour at all', async ({ page }) => {
    const stub = await openDetailForm(page);
    await pickAColourAndSubmit(page);

    const details = await lastDetails(stub);
    expect('wireColor' in details).toBe(false);
    /* And the rest of the form still went, so this is not a submit that silently failed. */
    expect(details.lightsDescription).toBe('Warm White');

    expect(stub.errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  test('picking Green sends Green', async ({ page }) => {
    const stub = await openDetailForm(page);
    await page.locator('#qdWireRow input[value="Green"]').check();
    await pickAColourAndSubmit(page);

    expect((await lastDetails(stub)).wireColor).toBe('Green');
    expect(stub.errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ⚠ WHITE IS THE ONE WORTH ITS OWN TEST. A White that came from a quote is the ONE White
     the sweep keeps ([[OPT-18]]) — `wireSweepClassify`'s own note says a White on a quote
     is a customer ticking White precisely BECAUSE the form defaults to Any. This test is
     what keeps that sentence true. */
  test('picking White sends White, which is the White the sweep keeps', async ({ page }) => {
    const stub = await openDetailForm(page);
    await page.locator('#qdWireRow input[value="White"]').check();
    await pickAColourAndSubmit(page);

    expect((await lastDetails(stub)).wireColor).toBe('White');
    expect(stub.errs).toEqual([]);
    await stub.assertNoRealCalls();
  });

  /* ⚠ AND CHANGING YOUR MIND BACK TO ANY MUST STILL SEND NOTHING. Ticking Green and then
     Any is the path a check that only ever tested the untouched default cannot reach. */
  test('ticking a colour and then going back to Any sends nothing again', async ({ page }) => {
    const stub = await openDetailForm(page);
    await page.locator('#qdWireRow input[value="White"]').check();
    await page.locator('#qdWireRow input[value=""]').check();
    await pickAColourAndSubmit(page);

    expect('wireColor' in (await lastDetails(stub))).toBe(false);
    expect(stub.errs).toEqual([]);
    await stub.assertNoRealCalls();
  });
});
