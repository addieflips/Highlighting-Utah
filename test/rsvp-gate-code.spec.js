/*
 * The gate code, asked on the way past an RSVP yes
 *
 * Addie, 2026-08-31: "Lets do gate code before changes."
 *
 * ⭐ WHY IT IS WORTH A STEP AT ALL. The RSVP is the one email every customer
 * opens and acts on, so it is the cheapest chance each season to catch a wrong
 * gate code before a crew is standing at a locked gate. Checklist row 218 is
 * the same argument from the other end — that one is about the email naming
 * the code, this is about the customer correcting it.
 *
 * ⚠ EVERY CLAIM HERE IS ABOUT WHAT IS ON SCREEN AND WHAT REACHED THE SERVER,
 * so these RUN the page. A source check cannot tell a step that renders from
 * one that is built and never shown — which is the failure this repo has
 * shipped more than once.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

async function openRsvpYes(page, token, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) thrown.push('console: ' + m.text());
  });
  await page.goto(`/index.html#/payment?token=${token}&rsvp=yes`);
  stub.thrown = thrown;
  return stub;
}

/* A customer with no gate code on file. Built from the standard fixture so it
   stays in step with the real shape — a hand-written record would drift. */
function noGateCode() {
  const c = JSON.parse(JSON.stringify(CUSTOMERS.standard));
  c.id = 'cust-nogate';
  c.token = 'testtokennogate0001';
  c.record.gateCode = '';
  return { customers: { nogate: c } };
}

/* ⚠ "MOVED ON" IS THE PORTAL NOW, NOT A CONFIRMATION MESSAGE (2026-09-01).
   Dax asked for the RSVP buttons to "automatically send the customer to their
   member portal", so the gate-code step hands off straight to it. These tests
   are about the GATE CODE and are unchanged in substance — what they assert
   after it is simply the screen that now follows. */
test.describe('Gate code on the RSVP yes', () => {

  /* ⚠ ORDER IS THE RULING. "Gate code before changes" — so the changes
     question must NOT be on screen while the gate code is being asked, or the
     customer answers whichever they happen to see first. */
  /* ⚠ WHAT THIS CANNOT SEE, SAID PLAINLY. A red-check that ran the changes
     question ALONGSIDE the gate step was NOT caught, and that is the correct
     answer rather than a gap: the step hides the message and the button row
     either way, so the end state is identical and there is nothing on screen
     for a spec to observe. The ordering that matters — that the customer is
     asked one question at a time — is what is asserted below.
     ⚠ AND NOTHING HERE REACHES functions/index.js. These run against a fake
     Firebase, so a broken server return leaves every one of them green. That
     half is gate-code.test.js. */
  test('it is asked BEFORE the changes question, not beside it', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);

    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();
    await expect(page.locator('#rsvpConfirmBtnRow')).toBeHidden();
    await expect(page.locator('#rsvpOpenPortalBtn')).toBeHidden();
    await expect(page.locator('#rsvpConfirmMsg')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ THE RSVP IS ALREADY SAVED BEFORE ANY OF THIS. Nothing in the gate-code
     step can cost somebody their answer — which is what makes it safe to put a
     question in front of them at all. */
  test('the yes is already recorded before the gate code is asked', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();

    const calls = await stub.calls();
    const rsvp = calls.filter(c => c.name === 'portalRsvp');
    expect(rsvp.length).toBe(1);
    expect(rsvp[0].payload.response).toBe('yes');

    stub.assertNoRealCalls();
  });

  /* ⭐ CONFIRM WHAT WE HOLD, rather than asking a question we know the answer
     to. Asking "do you have a gate code?" of somebody who gave us 4417 last
     year invites them to tap No, which reads as them removing it. */
  test('a customer with a code on file is asked to confirm it, by value', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);

    await expect(page.locator('#rsvpGateCodeQuestion')).toContainText('4417');
    await expect(page.locator('#rsvpGateCodeQuestion')).toContainText(/still right/i);
    await expect(page.locator('#rsvpGateCodeYesBtn')).toContainText(/that's right/i);
    await expect(page.locator('#rsvpGateCodeNoBtn')).toContainText(/has changed/i);

    stub.assertNoRealCalls();
  });

  /* ⚠ CONFIRMING WRITES NOTHING. Writing the same value back would stamp
     gateCodeUpdatedAt for a change nobody made. */
  test('confirming an unchanged code saves nothing and moves on', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);
    await page.locator('#rsvpGateCodeYesBtn').click();

    await expect(page.locator('#invBreakdown')).toBeVisible();
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();
    await expect(page.locator('#rsvpConfirmCard')).toBeHidden();

    const calls = await stub.calls();
    expect(calls.filter(c => c.name === 'portalSetGateCode').length).toBe(0);

    stub.assertNoRealCalls();
  });

  test('a customer with no code on file is asked whether there is one', async ({ page }) => {
    const stub = await openRsvpYes(page, 'testtokennogate0001', noGateCode());

    await expect(page.locator('#rsvpGateCodeQuestion')).toContainText(/is there a gate code/i);
    await expect(page.locator('#rsvpGateCodeYesBtn')).toContainText(/yes, i have one/i);

    stub.assertNoRealCalls();
  });

  test('saying there is none goes straight to the portal', async ({ page }) => {
    const stub = await openRsvpYes(page, 'testtokennogate0001', noGateCode());
    await page.locator('#rsvpGateCodeNoBtn').click();

    await expect(page.locator('#invBreakdown')).toBeVisible();
    const calls = await stub.calls();
    expect(calls.filter(c => c.name === 'portalSetGateCode').length).toBe(0);

    stub.assertNoRealCalls();
  });

  /* ⭐ THE ONE THAT MATTERS: a typed code actually reaches the server. */
  test('a new code is saved, and the customer is told', async ({ page }) => {
    const stub = await openRsvpYes(page, 'testtokennogate0001', noGateCode());

    await page.locator('#rsvpGateCodeYesBtn').click();
    await page.locator('#rsvpGateCodeInput').fill('#0754');
    await page.locator('#rsvpGateCodeSaveBtn').click();

    await expect.poll(async () => {
      const calls = await stub.calls();
      const c = calls.filter(x => x.name === 'portalSetGateCode');
      return c.length ? c[c.length - 1].payload.gateCode : null;
    }, { timeout: 5000 }).toBe('#0754');

    await expect(page.locator('#invBreakdown')).toBeVisible({ timeout: 5000 });

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ AN EMPTY BOX MUST NOT CLEAR A CODE WE ALREADY HOLD. */
  test('an empty box saves nothing', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);

    await page.locator('#rsvpGateCodeNoBtn').click();      // "It has changed"
    await page.locator('#rsvpGateCodeInput').fill('');
    await page.locator('#rsvpGateCodeSaveBtn').click();

    await expect(page.locator('#invBreakdown')).toBeVisible();
    const calls = await stub.calls();
    expect(calls.filter(c => c.name === 'portalSetGateCode').length).toBe(0);

    stub.assertNoRealCalls();
  });

  /* ⚠ IT FAILS OPEN. A refused save must never strand somebody mid-RSVP —
     their answer is already recorded, and the field is reachable under My Info.
     This is the whole safety argument for putting a step here at all. */
  test('a failed save still lets them through, and says where to fix it', async ({ page }) => {
    const c = JSON.parse(JSON.stringify(CUSTOMERS.standard));
    c.id = 'cust-gatefail';
    c.token = 'forcegatefail';
    c.record.gateCode = '';
    const stub = await openRsvpYes(page, 'forcegatefail', { customers: { gatefail: c } });

    await page.locator('#rsvpGateCodeYesBtn').click();
    await page.locator('#rsvpGateCodeInput').fill('1234');
    await page.locator('#rsvpGateCodeSaveBtn').click();

    await expect(page.locator('#rsvpGateCodeStatus')).toContainText(/my info/i);
    /* And it does not stop there — it moves them on by itself. */
    await expect(page.locator('#invBreakdown')).toBeVisible({ timeout: 6000 });

    stub.assertNoRealCalls();
  });

  /* ⚠ NOBODY SITTING THE SEASON OUT IS ASKED. A "no" answer means no crew is
     coming, so a gate code is a question with no purpose behind it. */
  test('a No answer is never asked for a gate code', async ({ page }) => {
    const stub = await installFirebaseStub(page);
    await page.goto(`/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=no`);

    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/sorry to miss you/i);
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();

    stub.assertNoRealCalls();
  });

});
